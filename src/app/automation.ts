/**
 * Runs the operator's automated tasks: at its due minute a task starts a fresh Session under the role's agent
 * preset and hands it the task prompt, so a role works on a schedule without anyone opening the app.
 */
import { KV } from '../kv.ts'
import { describeCadence, nextRunAt, parseWhen, taskId, taskView, type Task, type TaskView } from '../core/tasks.ts'
import type { Store } from './store.ts'

/** The Session operations a run needs; narrowed so a test can drive the scheduler without a Host. */
export interface AutomationSessions {
  create(request: { cwd: string; agentPreset: string }): Promise<{ sessionId: string }>
  prompt(request: { requestId: string; sessionId: string; mode: 'queue'; content: readonly { type: 'text'; text: string }[] },
    signal: AbortSignal): Promise<unknown>
}

/** Everything the scheduler reads from the Host. */
export interface AutomationHost {
  readonly sessions: AutomationSessions
  readonly store: Store
  /** Directory each run's Session opens in; the state directory always exists, a project clone may not. */
  readonly cwd: string
  readonly logger: { warn(message: string, ...args: unknown[]): void; info(message: string, ...args: unknown[]): void }
  /** True once the plugin is stopping, so a tick in flight does not start another Session. */
  closing(): boolean
  /** Agent preset ids this Host knows, so a task cannot be assigned to a role that does not exist. */
  presets(): Promise<readonly string[]>
}

/** One assignment the tools accept. */
export interface AssignInput {
  readonly title: string
  readonly preset: string
  readonly prompt: string
  /** `every 30m`, `every 2h`, `daily 09:00` or `weekly mon,thu 09:00`. */
  readonly when: string
}

/** The task clock: one timer, due tasks run in order, and every change re-arms the next wake. */
export class Automation {
  private timer: NodeJS.Timeout | undefined
  private readonly stopped = new AbortController()
  private running = false
  constructor(private readonly host: AutomationHost) {}

  /** Every task, newest first, with the next run in local time. */
  list(): TaskView[] {
    return this.host.store.keys(KV.tasks.entry.prefix)
      .map(name => this.host.store.get(name as never) as Task | undefined)
      .filter((task): task is Task => task !== undefined)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map(taskView)
  }

  /** Read one task, or explain that no task holds that id. */
  get(id: string): Task {
    const task = this.host.store.get(KV.tasks.entry(id)) as Task | undefined
    if (!task) throw new Error('no task ' + id + '; list_tasks shows the ids')
    return task
  }

  /** Create a task. A role that does not exist is refused here, not at the first run an hour later. */
  async assign(input: AssignInput): Promise<TaskView> {
    const cadence = parseWhen(input.when)
    const presets = await this.host.presets()
    if (!presets.includes(input.preset)) throw new Error('no role ' + input.preset + '; known roles: ' + presets.join(', '))
    const id = taskId(input.title)
    const existing = this.host.store.get(KV.tasks.entry(id)) as Task | undefined
    if (existing) throw new Error('task ' + id + ' already exists; delete_task or pick another title')
    const task: Task = { id, title: input.title, preset: input.preset, prompt: input.prompt, cadence, enabled: true,
      createdAt: new Date().toISOString(), nextRun: nextRunAt(cadence).toISOString(), runs: 0 }
    this.write(task)
    this.arm()
    this.host.logger.info('dsh-superagent task %s assigned to %s, %s', id, task.preset, describeCadence(cadence))
    return taskView(task)
  }

  /** Pause, resume, run now, or delete one task. */
  async control(id: string, action: 'pause' | 'resume' | 'run' | 'delete'): Promise<TaskView | { deleted: string }> {
    const task = this.get(id)
    if (action === 'delete') {
      this.host.store.delete(KV.tasks.entry(id))
      this.arm()
      return { deleted: id }
    }
    if (action === 'pause' || action === 'resume') {
      const next = { ...task, enabled: action === 'resume',
        nextRun: action === 'resume' ? nextRunAt(task.cadence).toISOString() : task.nextRun }
      this.write(next)
      this.arm()
      return taskView(next)
    }
    const ran = await this.attempt(task)
    const next = { ...task, runs: task.runs + 1, lastRun: ran, nextRun: nextRunAt(task.cadence).toISOString() }
    this.write(next)
    this.arm()
    return taskView(next)
  }

  /** Start the clock. Tasks whose slot passed while the Host was down move to their next slot instead of firing a backlog. */
  start(): void {
    const now = new Date()
    for (const view of this.list()) {
      const task = this.get(view.id)
      if (Date.parse(task.nextRun) <= now.getTime()) this.write({ ...task, nextRun: nextRunAt(task.cadence, now).toISOString() })
    }
    this.arm()
  }

  /** Stop the clock and abandon a prompt in flight; a Session already created stays and keeps its work. */
  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.stopped.abort()
  }

  /** Wake at the earliest due time; called after every change so a pause or a new task takes effect at once. */
  private arm(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    const due = this.list().filter(task => task.enabled).map(task => Date.parse(task.nextRun)).sort((left, right) => left - right)[0]
    if (due === undefined) return
    // Timers overflow past the 32-bit ceiling; a day is the longest wait worth arming, and the tick rearms itself.
    const delay = Math.min(Math.max(due - Date.now(), 0), 86_400_000)
    this.timer = setTimeout(() => { void this.tick() }, delay)
    this.timer.unref?.()
  }

  private async tick(): Promise<void> {
    this.timer = undefined
    if (this.host.closing() || this.running) return
    this.running = true
    try {
      const now = Date.now()
      for (const view of this.list()) {
        if (!view.enabled || Date.parse(view.nextRun) > now) continue
        const task = this.get(view.id)
        const ran = await this.attempt(task)
        this.write({ ...task, runs: task.runs + 1, lastRun: ran, nextRun: nextRunAt(task.cadence).toISOString() })
        if (ran.error) this.host.logger.warn('dsh-superagent task %s failed: %s', task.id, ran.error)
      }
    } finally {
      this.running = false
      this.arm()
    }
  }

  /** Open the role's Session and hand it the task; the failure is recorded rather than thrown, so one bad run does not stop the cadence. */
  private async attempt(task: Task): Promise<{ at: string; sessionId?: string; error?: string }> {
    const at = new Date().toISOString()
    if (this.stopped.signal.aborted) return { at, error: 'the Host is stopping' }
    try {
      const session = await this.host.sessions.create({ cwd: this.host.cwd, agentPreset: task.preset })
      await this.host.sessions.prompt({ requestId: 'run:' + task.id + ':' + at, sessionId: session.sessionId, mode: 'queue',
        content: [{ type: 'text', text: '[' + task.title + '] ' + task.prompt }] }, this.stopped.signal)
      return { at, sessionId: session.sessionId }
    } catch (error) {
      return { at, error: error instanceof Error ? error.message : String(error) }
    }
  }

  private write(task: Task): void { this.host.store.set(KV.tasks.entry(task.id), task) }
}

