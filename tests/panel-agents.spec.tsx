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
