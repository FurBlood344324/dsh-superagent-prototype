// @vitest-environment jsdom
// Agents tab: the roster, its copy, and the Session each card starts.
import { expect, it } from 'vitest'
import { ROSTER } from '../src/agents.ts'
import { en, zh } from '../src/client/locales.ts'
import { all, click, mount, text, usePanel } from './fixtures/panel.tsx'
import { server } from './fixtures/panel-server.ts'

usePanel()

it('offers one card per roster agent and starts a Session under its preset', async () => {
  await mount(en)
  await click('Agents')
  expect(all('.dt-agent-card')).toHaveLength(ROSTER.length)
  expect(text()).toContain('Chief of Staff')
  await click(all('.dt-agent-card button')[0]!)
  expect(server.started).toEqual([ROSTER[0]!.id])
})

it('shows a role the Role Maker wrote and starts its Session by the preset id it registered', async () => {
  server.roles = [{ id: 'superagent-analyst', name: 'Analyst', description: 'Turns numbers into one decision.', icon: 'search', hue: 12,
    file: 'analyst.json' }]
  await mount(en)
  await click('Agents')
  expect(all('.dt-agent-card')).toHaveLength(ROSTER.length + 1)
  // The card names the preset id, because that is what the chief of staff passes when it delegates to the role.
  expect(text()).toContain('superagent-analyst')
  await click(all('.dt-agent-card button').at(-1)!)
  expect(server.started).toEqual(['superagent-analyst'])
  server.roles = []
})

it('says which role files the Host refused, instead of hiding them', async () => {
  server.rolesProblems = [{ file: 'broken.json', message: 'persona: Too small' }]
  await mount(en)
  await click('Agents')
  expect(text()).toContain('broken.json')
  server.rolesProblems = []
})

it('lists the automated tasks a role runs and lets the operator pause one', async () => {
  server.tasks = [{ id: 'morning-brief', title: 'Morning brief', preset: 'superagent-researcher',
    prompt: 'Read the open issues and write a short brief.', cadence: { kind: 'daily', time: '09:00' }, enabled: true,
    createdAt: '2026-11-03T09:00:00.000Z', nextRun: '2026-11-04T06:00:00.000Z', nextRunLocal: '04.11.2026 09:00',
    cadenceText: 'daily at 09:00', runs: 2 }]
  await mount(en)
  await click('Agents')
  // The card names the role the task runs under, so the operator knows who does the work.
  expect(text()).toContain('Morning brief')
  expect(text()).toContain('superagent-researcher')
  expect(text()).toContain('daily at 09:00')
  await click('Pause')
  expect(server.controlled).toEqual([{ id: 'morning-brief', action: 'pause' }])
  server.tasks = []
  server.controlled = []
})

it('words every roster agent in both languages', () => {
  const dictionaries = [zh, en] as unknown as Record<string, string>[]
  for (const agent of ROSTER) {
    for (const field of ['name', 'role', 'blurb']) {
      expect(dictionaries.map(dictionary => dictionary[`agent.${agent.key}.${field}`]), `${agent.key}.${field}`).toEqual([expect.any(String),
        expect.any(String)])
    }
  }
})
it('lists a role at work with the steps of the run it expands, and opens that Session', async () => {
  const run = { id: 'session-keeper', preset: 'superagent-vault-keeper', title: 'Haftalık senkron', status: 'running' as const,
    startedAt: '2026-11-04T08:40:00Z', updatedAt: '2026-11-04T08:42:00Z', turn: 1, steps: 2, last: 'Grafı ölçtüm: 412 düğüm.' }
  server.runs = [run]
  server.runFeeds = { 'session-keeper': { ...run, feed: [
    { at: '2026-11-04T08:41:00Z', kind: 'user', text: 'Briefi oku' },
    { at: '2026-11-04T08:42:00Z', kind: 'say', text: 'Grafı ölçtüm: 412 düğüm.' }] } }
  await mount(en)
  await click('Agents')
  expect(text()).toContain('Haftalık senkron')
  expect(text()).toContain('Running')
  expect(text()).toContain('2 steps')
  // The feed is fetched only for the run the operator expanded.
  expect(all('.dt-step')).toHaveLength(0)
  await click(all('.dt-run-head')[0]!)
  expect(all('.dt-step')).toHaveLength(2)
  expect(text()).toContain('412')
  await click(all('.dt-run-foot button')[0]!)
  expect(server.opened).toEqual(['session-keeper'])
  server.runs = []
  server.runFeeds = {}
  server.opened = []
})

it('shows the inbox the chief of staff writes to and marks a message read when it is opened', async () => {
  server.inbox = { items: [{ id: 'inbox-1', at: '2026-11-04T09:00:00Z', from: 'superagent-chief-of-staff',
    title: 'Haftalık senkron bitti', text: 'İki not bağlandı; karar gereken bir şey yok.', sessionId: 'session-keeper', read: false }],
  unread: 1 }
  await mount(en)
  await click('Agents')
  expect(text()).toContain('Haftalık senkron bitti')
  expect(text()).toContain('1 unread')
  await click(all('.dt-inbox-head')[0]!)
  expect(server.opened).toEqual(['session-keeper'])
  expect(server.inbox.items[0]!.read).toBe(true)
  expect(server.inbox.unread).toBe(0)
  server.inbox = { items: [], unread: 0 }
  server.opened = []
})
