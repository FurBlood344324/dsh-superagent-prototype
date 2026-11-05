/** Automated tasks: the cadence grammar, the next-run arithmetic, and the scheduler that starts a role's Session. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Automation, type AutomationHost } from '../src/app/automation.ts'
import { apply } from '../src/tools/assign.ts'
import { Store } from '../src/app/store.ts'
import { KV } from '../src/kv.ts'
import { MIN_EVERY_MINUTES, nextRunAt, parseWhen, taskId, taskView, type Task } from '../src/core/tasks.ts'

const dirs: string[] = []
const stores: Store[] = []
afterEach(async () => {
  for (const store of stores.splice(0)) store.close()
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

/** One assignment most tests use; the fields under test are overridden per case. */
const ASSIGN = { title: 'Morning brief', preset: 'superagent-researcher',
  prompt: 'Read the open issues and write a short brief.', when: 'daily 09:00' }

async function host(over: Partial<AutomationHost> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'superagent-tasks-'))
  dirs.push(dir)
  const store = new Store(join(dir, 'orchestrator.sqlite'), () => {})
  stores.push(store)
  const created: string[] = []
  const prompts: string[] = []
  const base: AutomationHost = {
    sessions: {
      create: async request => { created.push(request.agentPreset); return { sessionId: 'session-' + created.length } },
      prompt: async request => { prompts.push(request.content.map(part => part.text).join(' ')) },
    },
    store, cwd: dir, logger: { warn: () => {}, info: () => {} }, closing: () => false,
    presets: async () => ['superagent-chief-of-staff', 'superagent-researcher'],
  }
  return { automation: new Automation({ ...base, ...over }), store, sessions: { created, prompts } }
}

it('reads the one-line cadence the tools take', () => {
  expect(parseWhen('every 30m')).toEqual({ kind: 'every', minutes: 30 })
  expect(parseWhen('every 2h')).toEqual({ kind: 'every', minutes: 120 })
  expect(parseWhen('daily 09:00')).toEqual({ kind: 'daily', time: '09:00' })
  expect(parseWhen('weekly mon,thu 09:00')).toEqual({ kind: 'weekly', weekdays: [1, 4], time: '09:00' })
  // The error has to teach the grammar, because the caller is a model that cannot see the tool docs.
  expect(() => parseWhen('every minute')).toThrow(/when must be/)
  expect(() => parseWhen('every 2m')).toThrow(new RegExp(String(MIN_EVERY_MINUTES)))
  expect(() => parseWhen('daily 25:00')).toThrow(/time/)
  expect(() => parseWhen('weekly funday 09:00')).toThrow(/unknown day/)
})

it('computes the next run strictly after now', () => {
  const from = new Date(2026, 10, 3, 12, 0, 0)
  expect(nextRunAt({ kind: 'daily', time: '13:00' }, from)).toEqual(new Date(2026, 10, 3, 13, 0, 0))
  // A slot already gone waits for tomorrow rather than firing twice.
  expect(nextRunAt({ kind: 'daily', time: '09:00' }, from)).toEqual(new Date(2026, 10, 4, 9, 0, 0))
  expect(nextRunAt({ kind: 'every', minutes: 30 }, from).getMinutes()).toBe(30)
  // 2026-11-03 is a Tuesday; the next Monday is the ninth.
  expect(nextRunAt({ kind: 'weekly', weekdays: [1], time: '09:00' }, from)).toEqual(new Date(2026, 10, 9, 9, 0, 0))
})

it('derives a task id from the title the operator wrote', () => {
  expect(taskId('Weekly PR sweep')).toBe('weekly-pr-sweep')
  expect(taskId('  ??  ')).toBe('task')
})

it('assigns a task to a role, refusing labels the Host cannot run', async () => {
  const { automation } = await host()
  const task = await automation.assign(ASSIGN)
  expect(task).toMatchObject({ id: 'morning-brief', preset: 'superagent-researcher', enabled: true, runs: 0 })
  expect(task.cadenceText).toBe('daily at 09:00')
  await expect(automation.assign({ ...ASSIGN, title: 'Another', preset: 'superagent-analyst' }))
    .rejects.toThrow(/no role superagent-analyst/)
  await expect(automation.assign({ ...ASSIGN, when: 'every 5m' })).rejects.toThrow(/already exists/)
})

it('runs a task now by opening its role Session and handing it the prompt', async () => {
  const { automation, sessions } = await host()
  await automation.assign(ASSIGN)
  const task = await automation.control('morning-brief', 'run') as { runs: number; lastRun?: { sessionId?: string } }
  expect(sessions.created).toEqual(['superagent-researcher'])
  expect(sessions.prompts[0]).toContain('Read the open issues')
  expect(task.runs).toBe(1)
  expect(task.lastRun?.sessionId).toBe('session-1')
})

it('records a failed run and keeps the cadence instead of stopping the task', async () => {
  const { automation } = await host({ sessions: { create: async () => { throw new Error('model offline') }, prompt: async () => {} } })
  await automation.assign(ASSIGN)
  const task = await automation.control('morning-brief', 'run') as { enabled: boolean; lastRun?: { error?: string }; nextRun: string }
  expect(task.lastRun?.error).toBe('model offline')
  expect(task.enabled).toBe(true)
  expect(Date.parse(task.nextRun)).toBeGreaterThan(Date.now())
})

it('pauses, resumes and deletes without losing the record', async () => {
  const { automation, store } = await host()
  await automation.assign(ASSIGN)
  expect(await automation.control('morning-brief', 'pause')).toMatchObject({ enabled: false })
  expect(await automation.control('morning-brief', 'resume')).toMatchObject({ enabled: true })
  expect(await automation.control('morning-brief', 'delete')).toEqual({ deleted: 'morning-brief' })
  expect(automation.list()).toEqual([])
  expect(store.get(KV.tasks.entry('morning-brief'))).toBeUndefined()
  await expect(automation.control('morning-brief', 'pause')).rejects.toThrow(/no task/)
})

it('moves a task whose slot passed while the Host was down to its next slot instead of firing it late', async () => {
  const { automation, store } = await host()
  await automation.assign({ ...ASSIGN, when: 'every 30m' })
  const stale: Task = { ...store.get(KV.tasks.entry('morning-brief')) as Task, nextRun: new Date(Date.now() - 3_600_000).toISOString() }
  store.set(KV.tasks.entry('morning-brief'), stale)
  automation.start()
  expect(Date.parse(automation.list()[0]!.nextRun)).toBeGreaterThan(Date.now())
  automation.stop()
})

it('mounts the task tools inside a role and reaches the Host scheduler through the Runtime service', async () => {
  const assigned: unknown[] = []
  const view = { id: 'morning-brief', title: 'Morning brief', preset: 'superagent-researcher', prompt: 'p', cadence: { kind: 'daily', time: '09:00' },
    enabled: true, createdAt: '2026-11-03T09:00:00.000Z', nextRun: '2026-11-04T06:00:00.000Z', runs: 0 }
  const tools: Record<string, { execute: (args: unknown) => Promise<unknown> }> = {}
  const stub = {
    assign: async (input: unknown) => { assigned.push(input); return view },
    list: () => [{ ...view, nextRunLocal: '04.11.2026 09:00', cadenceText: 'daily at 09:00' }],
    control: async (id: string, action: string) => action === 'delete' ? { deleted: id } : view,
  }
  apply({ tools: { register: (definition: { name: string }) => { tools[definition.name] = definition as never } },
    get: (name: string) => name === 'orchestrator' ? { tasks: stub } : undefined } as never)
  await tools.assign_task!.execute({ role: 'superagent-researcher', title: 'Morning brief', prompt: 'Read the open issues.', when: 'daily 09:00' })
  expect(assigned).toEqual([{ title: 'Morning brief', preset: 'superagent-researcher', prompt: 'Read the open issues.', when: 'daily 09:00' }])
  expect(await tools.list_tasks!.execute({})).toMatchObject({ tasks: [{ id: 'morning-brief', when: 'daily at 09:00' }] })
  expect(await tools.control_task!.execute({ id: 'morning-brief', action: 'delete' })).toEqual({ deleted: 'morning-brief' })
  // A role whose Host is not running gets a sentence, not a stack trace.
  await expect(tools.list_tasks!.execute({})).resolves.toBeTruthy()
  const orphan = {} as Record<string, { execute: (args: unknown) => Promise<unknown> }>
  apply({ tools: { register: (definition: { name: string }) => { orphan[definition.name] = definition as never } }, get: () => undefined } as never)
  await expect(orphan.list_tasks!.execute({})).rejects.toThrow(/not running/)
})

it('registers task tool parameters as plain JSON data', () => {
  const definitions: { name: string, parameters: Record<string, unknown> }[] = []
  apply({ tools: { register: (definition: never) => { definitions.push(definition) } }, get: () => undefined } as never)
  expect(definitions.map(definition => definition.name)).toEqual(['assign_task', 'list_tasks', 'control_task'])
  for (const definition of definitions) {
    // DSH refuses a schema whose own keys are not all enumerable strings; zod's hidden `~standard` marker
    // aborted every turn before the model call until the schema was projected to plain JSON.
    expect(Reflect.ownKeys(definition.parameters).every(key => typeof key === 'string'
      && Object.prototype.propertyIsEnumerable.call(definition.parameters, key))).toBe(true)
    expect(JSON.parse(JSON.stringify(definition.parameters))).toEqual(definition.parameters)
  }
})

it('shows the next run in the reader clock', async () => {
  const { automation } = await host()
  expect(taskView(await automation.assign(ASSIGN)).nextRunLocal).toBeTruthy()
})

