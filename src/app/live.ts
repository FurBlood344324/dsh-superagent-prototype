/**
 * What the Host's role Sessions are doing right now, and the report each finished run hands to the chief of staff.
 * The feed of steps is bounded: the panel polls it while a role works, so an old step scrolls out instead of growing
 * without end, and a run stays listed for a while after it went idle so its report can still be read.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

/** Every role preset id starts with this, so a Session created from one is a role at work. */
export const ROLE_PREFIX = 'superagent-'
/** The chief of staff's preset id: it receives the reports, and its own turns are never reported about. */
export const CHIEF_PRESET = 'superagent-chief-of-staff'
/** Steps one run keeps; the older ones scroll out. */
const KEEP_STEPS = 120
/** Longest text of one step, so one essay or tool argument cannot fill the panel. */
const STEP_CHARS = 500
/** Runs kept at once; the oldest idle run leaves when a new one starts. */
const KEEP_RUNS = 30

/** What one line of a run's feed is: the task it was given, something it said, or a tool it reached for. */
export type LiveKind = 'user' | 'say' | 'tool'

/** One line of a run's feed. */
export interface LiveStep {
  readonly at: string
  readonly kind: LiveKind
  readonly text: string
}

/** One role Session as the panel lists it. */
export interface RunView {
  readonly id: string
  /** Agent preset id the Session runs under. */
  readonly preset: string
  /** Title the run is listed by: its preset until the first instruction arrives, then that instruction's first line. */
  readonly title: string
  readonly status: 'running' | 'idle'
  readonly startedAt: string
  readonly updatedAt: string
  /** Turn the run is in; one turn is one instruction and everything the model does for it. */
  readonly turn: number
  readonly steps: number
  readonly last: string
}

/** One run with its feed, which the panel fetches only for the run it expanded. */
export interface RunDetailView extends RunView {
  readonly feed: readonly LiveStep[]
}

/** What the chief of staff is told when a run finishes. */
export interface HandoffReport {
  readonly sessionId: string
  readonly preset: string
  readonly title: string
  readonly startedAt: string
  readonly endedAt: string
  readonly turns: number
  readonly tools: readonly { name: string; count: number }[]
  readonly last: string
}

/** What a tracker needs from the Host. */
export interface LiveHost {
  readonly context: Context
  readonly lifetime: AbortSignal
  /** True once the Host is stopping, so a report in flight is not started. */
  closing(): boolean
  /** Whether this Session is one an automated task started, which is the work the chief of staff is told about. */
  automated(sessionId: string): boolean
  /** Sends one finished run's report to the chief of staff Session. */
  handoff(report: HandoffReport): Promise<void>
}

interface Run {
  readonly id: string
  readonly preset: string
  title: string
  status: 'running' | 'idle'
  readonly startedAt: string
  updatedAt: string
  turn: number
  steps: number
  last: string
  readonly feed: LiveStep[]
  readonly counts: Map<string, number>
  /** Turns that produced something said; a turn that only failed has nothing to report. */
  says: number
  reportedTurn: number
}

/** The text blocks of a message, joined; anything else (an image, a tool call) is not a step. */
function textOf(content: readonly { readonly type: string }[]): string {
  return content.flatMap(part => {
    if (part.type !== 'text') return []
    const text = (part as { readonly text?: unknown }).text
    return typeof text === 'string' ? [text] : []
  }).join('\n').trim()
}
/** One readable line for a step. */
function line(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > STEP_CHARS ? flat.slice(0, STEP_CHARS) + '…' : flat
}
/** The first line of an instruction, which becomes the run's title. */
const firstLine = (text: string): string => line(text.split('\n').find(line => line.trim().length > 0) ?? text).slice(0, 80)

/**
 * Follows the role Sessions this Host runs and answers two questions: what is a role doing now, and what did it finish.
 * It tracks a Session whose preset starts with `superagent-`, keeps a bounded feed of its steps, and on the end of a turn
 * hands the chief of staff a report, which is the one place the operator's attention is decided.
 */
export class LiveRuns {
  private readonly runs = new Map<string, Run>()
  private readonly disposers: (() => void)[] = []
  constructor(private readonly host: LiveHost) {}

  /** Subscribe to agent and Session events; call once at startup. */
  install(): void {
    const ctx = this.host.context
    this.disposers.push(
      ctx.on('agent/created', ({ agent }) => { this.created(agent) }),
      ctx.on('agent/status', ({ agent, status }) => { const run = this.runs.get(agent.id); if (run) run.status = status === 'running' ? 'running' : 'idle' }),
      ctx.on('agent/disposed', ({ agent }) => { const run = this.runs.get(agent.id); if (run) run.status = 'idle' }),
      ctx.on('session/event', (session, event) => { this.event(session, event) }),
    )
  }

  /** Every run the panel lists, newest first. */
  view(): RunView[] {
    return [...this.runs.values()].sort((left, right) => right.startedAt.localeCompare(left.startedAt)).map(shallow)
  }

  /** One run with its feed, or undefined when the Host never tracked it. */
  detail(id: string): RunDetailView | undefined {
    const run = this.runs.get(id)
    return run ? { ...shallow(run), feed: [...run.feed] } : undefined
  }

  /** Release the subscriptions; the runs stay readable for the life of the object. */
  dispose(): void { for (const dispose of this.disposers.splice(0).reverse()) dispose() }

  private created(agent: Agent): void {
    const header = agent.session.header
    const preset = header.agentPreset
    // A role's own forked subagent inherits its preset; it is part of the run, not a run that reports on its own.
    if (!preset?.startsWith(ROLE_PREFIX) || header.parentSession !== undefined || header.origin === 'subagent') return
    if (this.runs.has(agent.id)) return
    const at = new Date().toISOString()
    const run: Run = { id: agent.id, preset, title: preset, status: agent.status === 'running' ? 'running' : 'idle', startedAt: at, updatedAt: at,
      turn: 0, steps: 0, last: '', feed: [], counts: new Map(), says: 0, reportedTurn: 0 }
    this.runs.set(agent.id, run)
    this.prune()
  }

  private event(session: Session, event: SessionEvent): void {
    const run = this.runs.get(session.id)
    if (!run) return
    switch (event.type) {
      case 'turn/start':
        run.turn = event.data.turn
        run.status = 'running'
        break
      case 'turn/end':
        run.status = 'idle'
        this.report(run)
        break
      case 'user/message': {
        const text = textOf(event.data.content)
        if (!text) break
        // The task prompt names the run; a later message is just another step.
        if (run.steps === 0) run.title = firstLine(text)
        this.push(run, 'user', line(text))
        break
      }
      case 'assistant/message': {
        const text = textOf(event.data.message.content)
        if (!text) break
        run.says += 1
        this.push(run, 'say', line(text))
        break
      }
      case 'tool/call': {
        const name = event.data.name
        run.counts.set(name, (run.counts.get(name) ?? 0) + 1)
        this.push(run, 'tool', line(name + ' ' + event.data.arguments))
        break
      }
      default: return
    }
    run.updatedAt = new Date().toISOString()
  }

  private push(run: Run, kind: LiveKind, text: string): void {
    const at = new Date().toISOString()
    run.feed.push({ at, kind, text })
    if (run.feed.length > KEEP_STEPS) run.feed.splice(0, run.feed.length - KEEP_STEPS)
    run.steps += 1
    run.last = text
  }

  /**
   * Hand the chief of staff one report per finished turn of an automated run. A Session a person talks to is theirs, not a
   * run to report on, and the chief of staff never reports to itself.
   */
  private report(run: Run): void {
    if (run.preset === CHIEF_PRESET || run.reportedTurn >= run.turn || run.says === 0) return
    if (!this.host.automated(run.id)) return
    if (this.host.closing() || this.host.lifetime.aborted) return
    run.reportedTurn = run.turn
    const endedAt = new Date().toISOString()
    const report: HandoffReport = { sessionId: run.id, preset: run.preset, title: run.title, startedAt: run.startedAt, endedAt,
      turns: run.turn, tools: [...run.counts].map(([name, count]) => ({ name, count })).sort((left, right) => right.count - left.count),
      last: run.feed.filter(step => step.kind === 'say').at(-1)?.text ?? '' }
    void this.host.handoff(report).catch(error => this.host.context.logger.warn('dsh-superagent could not hand a run to the chief of staff: %s', String(error)))
  }

  /** Drop the oldest idle runs once the list grows past its bound. */
  private prune(): void {
    if (this.runs.size <= KEEP_RUNS) return
    const idle = [...this.runs.values()].filter(run => run.status === 'idle').sort((left, right) => left.startedAt.localeCompare(right.startedAt))
    for (const run of idle.slice(0, this.runs.size - KEEP_RUNS)) this.runs.delete(run.id)
  }
}

/** The run without its feed and internal counters, which is what the list pays for. */
function shallow(run: Run): RunView {
  return { id: run.id, preset: run.preset, title: run.title, status: run.status, startedAt: run.startedAt, updatedAt: run.updatedAt,
    turn: run.turn, steps: run.steps, last: run.last }
}
