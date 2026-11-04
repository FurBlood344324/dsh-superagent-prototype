// Live runs and the inbox: what a role is doing, what it hands the chief of staff, and what reaches the operator.
import { expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { Inbox } from '../src/app/inbox.ts'
import { CHIEF_PRESET, LiveRuns, type HandoffReport } from '../src/app/live.ts'
import type { Store } from '../src/app/store.ts'

type Handler = (...args: never[]) => void
/** A Cordis context with just what the tracker subscribes to. */
function fakeContext() {
  const handlers = new Map<string, Handler[]>()
  const context = {
    on(name: string, handler: Handler) { handlers.set(name, [...handlers.get(name) ?? [], handler]); return () => {} },
    logger: { warn: () => undefined, info: () => undefined },
    emit(name: string, ...args: unknown[]) { for (const handler of handlers.get(name) ?? []) (handler as (...rest: unknown[]) => void)(...args) },
  }
  return context
}
const session = (id: string) => ({ id }) as unknown as Session
const agent = (id: string, preset: string | undefined, extra: { parentSession?: string; origin?: 'subagent' } = {}) => ({
  id, status: 'running', session: { header: { agentPreset: preset, ...extra } },
}) as unknown as Agent
const event = <T extends SessionEvent['type']>(type: T, data: unknown) => ({ type, data }) as SessionEvent
const say = (text: string) => event('assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'text', text }] } })

it('follows a role Session, keeps its steps bounded, and hands one report per finished turn', async () => {
  const context = fakeContext()
  const handoffs: HandoffReport[] = []
  const live = new LiveRuns({ context: context as unknown as Context, lifetime: new AbortController().signal, closing: () => false, automated: () => true,
    handoff: async report => { handoffs.push(report) } })
  live.install()
  const keeper = agent('session-keeper', 'superagent-vault-keeper')
  context.emit('agent/created', { agent: keeper })
  expect(live.view()).toMatchObject([{ id: 'session-keeper', preset: 'superagent-vault-keeper', status: 'running', title: 'superagent-vault-keeper' }])

  context.emit('session/event', session('session-keeper'), event('turn/start', { turn: 1 }))
  context.emit('session/event', session('session-keeper'), event('user/message', { content: [{ type: 'text', text: '[Haftalik senkron]\nBriefi oku' }] }))
  context.emit('session/event', session('session-keeper'), say('Grafı ölçtüm: 412 düğüm.'))
  context.emit('session/event', session('session-keeper'), event('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'bash',
    arguments: '{"command":"python3 tools/vault-graf.py"}' }))
  const run = live.detail('session-keeper')!
  expect(run.title).toBe('[Haftalik senkron]')
  expect(run.steps).toBe(3)
  expect(run.feed.map(step => step.kind)).toEqual(['user', 'say', 'tool'])
  expect(run.last).toContain('vault-graf.py')

  context.emit('session/event', session('session-keeper'), event('turn/end', { turn: 1, reason: { kind: 'stop' } }))
  await vi.waitFor(() => expect(handoffs).toHaveLength(1))
  expect(handoffs[0]).toMatchObject({ sessionId: 'session-keeper', preset: 'superagent-vault-keeper', turns: 1,
    last: 'Grafı ölçtüm: 412 düğüm.', tools: [{ name: 'bash', count: 1 }] })

  // A second end of the same turn is not a second report.
  context.emit('session/event', session('session-keeper'), event('turn/end', { turn: 1, reason: { kind: 'stop' } }))
  expect(handoffs).toHaveLength(1)
})

it('never reports the chief of staff to itself, and leaves a role\'s forked subagents out of the list', async () => {
  const context = fakeContext()
  const handoffs: HandoffReport[] = []
  const live = new LiveRuns({ context: context as unknown as Context, lifetime: new AbortController().signal, closing: () => false, automated: () => true,
    handoff: async report => { handoffs.push(report) } })
  live.install()
  context.emit('agent/created', { agent: agent('session-chief', CHIEF_PRESET) })
  context.emit('agent/created', { agent: agent('session-fork', 'superagent-vault-keeper', { parentSession: 'session-keeper' }) })
  context.emit('agent/created', { agent: agent('session-other', 'standard') })
  expect(live.view().map(run => run.id)).toEqual(['session-chief'])

  context.emit('session/event', session('session-chief'), event('turn/start', { turn: 1 }))
  context.emit('session/event', session('session-chief'), say('Not edildi.'))
  context.emit('session/event', session('session-chief'), event('turn/end', { turn: 1, reason: { kind: 'stop' } }))
  expect(handoffs).toEqual([])
})

it('keeps the operator\'s inbox newest first and counts every unread message', () => {
  const records = new Map<string, unknown>()
  const store = {
    get: (name: string) => records.get(name),
    set: (name: string, value: unknown) => { records.set(name, value) },
    keys: (family: string | { prefix: string }) => { const prefix = typeof family === 'string' ? family : family.prefix
      return [...records.keys()].filter(name => name.startsWith(prefix)) },
  } as unknown as Pick<Store, 'get' | 'set' | 'keys'>
  let clock = 0
  const inbox = new Inbox(store, () => new Date(Date.UTC(2026, 10, 4, 10, clock++)).toISOString())
  const first = inbox.add({ from: 'superagent-vault-keeper', text: 'Graf 412 düğüm: 3 ada kaldı.\nKarar: bağ mı not mu?' })
  const second = inbox.add({ from: CHIEF_PRESET, text: 'Haftalık senkron bitti; iki not bağlandı.', title: 'Senkron',
    sessionId: 'session-keeper' })
  expect(inbox.view()).toMatchObject({ unread: 2 })
  expect(inbox.view().items.map(item => item.id)).toEqual([second.id, first.id])
  expect(inbox.view().items[0]).toMatchObject({ title: 'Senkron', sessionId: 'session-keeper', read: false })
  // Without a title, the first line is the label.
  expect(first.title).toBe('Graf 412 düğüm: 3 ada kaldı.')

  expect(inbox.markRead(first.id)).toBe(true)
  expect(inbox.markRead('inbox-missing')).toBe(false)
  expect(inbox.view().unread).toBe(1)
  expect(inbox.view().items.find(item => item.id === first.id)?.read).toBe(true)
})
it('leaves a Session a person is talking to alone, and reports only the work an automated task started', async () => {
  const context = fakeContext()
  const handoffs: HandoffReport[] = []
  const live = new LiveRuns({ context: context as unknown as Context, lifetime: new AbortController().signal, closing: () => false,
    automated: id => id === 'session-keeper', handoff: async report => { handoffs.push(report) } })
  live.install()
  context.emit('agent/created', { agent: agent('session-coach', 'superagent-english-coach') })
  context.emit('agent/created', { agent: agent('session-keeper', 'superagent-vault-keeper') })
  for (const id of ['session-coach', 'session-keeper']) {
    context.emit('session/event', session(id), event('turn/start', { turn: 1 }))
    context.emit('session/event', session(id), say('Bitti.'))
    context.emit('session/event', session(id), event('turn/end', { turn: 1, reason: { kind: 'stop' } }))
  }
  await vi.waitFor(() => expect(handoffs).toHaveLength(1))
  expect(handoffs[0]!.sessionId).toBe('session-keeper')
})
