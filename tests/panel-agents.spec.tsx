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

it('words every roster agent in both languages', () => {
  const dictionaries = [zh, en] as unknown as Record<string, string>[]
  for (const agent of ROSTER) {
    for (const field of ['name', 'role', 'blurb']) {
      expect(dictionaries.map(dictionary => dictionary[`agent.${agent.key}.${field}`]), `${agent.key}.${field}`).toEqual([expect.any(String),
        expect.any(String)])
    }
  }
})
