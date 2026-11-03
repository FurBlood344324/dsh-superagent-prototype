/** The bundle's patch, read with the entry-list dialect DSH reads bundle patches with, and the agent preset it defines. */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { ROSTER } from '../src/agents.ts'
import { ROUTER_PRESET, WORKER_PRESET } from '../src/app/sessions.ts'

interface Row { id?: string; name: string; disabled?: unknown; config?: Record<string, unknown> & { plugins?: Row[] } | Row[] }
/** The patch as DSH reads it: Cordis's include plugin parses `!!js` scalars, and applies the inserts to an entry list. */
async function patched(): Promise<Row[]> {
  const cordis = createRequire(createRequire(import.meta.url).resolve('@deepseek-ai/cordis/package.json'))
  const include = cordis.resolve('@deepseek-ai/cordis-plugin-include')
  const { entryListSchema, applyEntryPatches } = await import(include) as {
    entryListSchema: unknown; applyEntryPatches(data: Row[], patches: unknown[], warn: (message: string) => void): Row[] }
  const yaml = await import(createRequire(include).resolve('js-yaml')) as { load(text: string, options: { schema: unknown }): unknown }
  const patches = yaml.load(readFileSync(join(import.meta.dirname, '..', 'cordis.patch.yml'), 'utf8'), { schema: entryListSchema }) as unknown[]
  const warnings: string[] = []
  const rows = applyEntryPatches([], patches, message => { warnings.push(message) })
  expect(warnings).toEqual([])
  return rows
}
/** Every plugin row of a preset, those inside groups too. */
const flat = (rows: readonly Row[]): Row[] => rows.flatMap(row => [row, ...Array.isArray(row.config) ? flat(row.config) : []])

/** A preset the patch defines, by its id. */
const presetOf = (rows: readonly Row[], id: string) => rows.map(row => row.config as { id?: string; order?: number; plugins: Row[] })
  .find(config => config?.id === id)!

it('defines the worker preset Executor Sessions run under, with a shell that moves long commands to the background', async () => {
  const rows = await patched()
  expect(rows.map(row => row.id)).toEqual(['dsh-superagent', 'dsh-superagent-github', 'dsh-superagent-feishu', 'dsh-superagent-worker-preset',
    'dsh-superagent-router-preset', 'preset-superagent-chief-of-staff', 'preset-superagent-researcher', 'preset-superagent-engineer',
    'preset-superagent-editor'])
  const preset = presetOf(rows, WORKER_PRESET)
  expect(preset.id).toBe(WORKER_PRESET)
  const plugins = flat(preset.plugins)
  const named = (name: string) => plugins.filter(row => row.name === name).map(row => row.config)
  expect(named('@deepseek-ai/dsh-bash-sandbox')).toEqual([{ timeoutMs: 5000, maxTimeoutMs: 5000 }])
  expect(named('@deepseek-ai/dsh-pwsh-sandbox')).toEqual([{ timeoutMs: 5000, maxTimeoutMs: 5000 }])
  expect(named('@deepseek-ai/dsh-tool-jobs')).toEqual([{ waitTimeoutMs: 5000, maxWaitTimeoutMs: 5000 }])
  expect(named('@deepseek-ai/dsh-tool-web')).toEqual([expect.objectContaining({ fetch: false })])
  // Spawned subagents run under standard, whose shell moves a command to the background only after 60 s; forked ones, which would run under
  // this preset, are left out.
  expect(named('@deepseek-ai/dsh-tool-subagent')).toEqual([expect.objectContaining({ provider: 'spawn', agentPreset: 'standard' })])
  // What a worker needs, and none of what asks a person, presents, plans, changes the profile, schedules, sets goals or runs workflows.
  for (const name of ['@deepseek-ai/dsh-tool-fs', '@deepseek-ai/dsh-tool-fs-search', '@deepseek-ai/dsh-tool-bash', '@deepseek-ai/dsh-tool-skill',
    '@deepseek-ai/dsh-tool-todo', '@deepseek-ai/dsh-tool-subagent', '@deepseek-ai/dsh-tool-subagent-control', '@deepseek-ai/dsh-compaction-basic',
    '@deepseek-ai/dsh-compaction-tool-result-pruner', '@deepseek-ai/dsh-agent-instructions']) expect(named(name).length).toBeGreaterThan(0)
  const names = plugins.map(row => row.name)
  for (const name of ['@deepseek-ai/dsh-tool-ask-user', '@deepseek-ai/dsh-tool-present', '@deepseek-ai/dsh-plan-mode', '@deepseek-ai/dsh-plugin-manager/tools',
    '@deepseek-ai/dsh-plugin-market/tools', '@deepseek-ai/dsh-tool-schedule', '@deepseek-ai/dsh-tool-goal', '@deepseek-ai/dsh-command-goal',
    '@deepseek-ai/dsh-tool-workflow', '@deepseek-ai/dsh-workflow-ptc']) expect(names).not.toContain(name)
})

it('defines the router preset the main Session runs under: the worker\'s 5-second shell and job waits, and only the tools it uses', async () => {
  const rows = await patched()
  const router = presetOf(rows, ROUTER_PRESET), worker = presetOf(rows, WORKER_PRESET)
  expect(router.order).toBe(91)
  const plugins = flat(router.plugins)
  const named = (preset: Row[], name: string) => preset.filter(row => row.name === name).map(row => row.config)
  for (const name of ['@deepseek-ai/dsh-bash-sandbox', '@deepseek-ai/dsh-pwsh-sandbox', '@deepseek-ai/dsh-tool-jobs']) {
    expect(named(plugins, name), name).toEqual(named(flat(worker.plugins), name))
  }
  // The tools its allow list keeps: skill, bash, read, read_image and the job tools; the file tools only read.
  for (const name of ['@deepseek-ai/dsh-tool-skill', '@deepseek-ai/dsh-skill-filesystem', '@deepseek-ai/dsh-tool-bash', '@deepseek-ai/dsh-tool-jobs',
    '@deepseek-ai/dsh-agent-instructions', '@deepseek-ai/dsh-time-context', '@deepseek-ai/dsh-compaction-basic',
    '@deepseek-ai/dsh-compaction-tool-result-pruner']) expect(named(plugins, name).length, name).toBeGreaterThan(0)
  expect(named(plugins, '@deepseek-ai/dsh-tool-fs')).toEqual([{ write: false, edit: false }])
  const names = plugins.map(row => row.name)
  for (const name of ['@deepseek-ai/dsh-tool-subagent', '@deepseek-ai/dsh-tool-subagent-control', '@deepseek-ai/dsh-tool-web', '@deepseek-ai/dsh-tool-fs-search',
    '@deepseek-ai/dsh-tool-todo', '@deepseek-ai/dsh-tool-ask-user', '@deepseek-ai/dsh-tool-present', '@deepseek-ai/dsh-plan-mode',
    '@deepseek-ai/dsh-plugin-manager/tools', '@deepseek-ai/dsh-plugin-market/tools', '@deepseek-ai/dsh-tool-schedule', '@deepseek-ai/dsh-tool-goal',
    '@deepseek-ai/dsh-command-goal', '@deepseek-ai/dsh-tool-workflow', '@deepseek-ai/dsh-workflow-ptc']) expect(names, name).not.toContain(name)
})


it('declares one role preset per roster agent, each with its own persona', async () => {
  const rows = await patched()
  for (const agent of ROSTER) {
    const preset = presetOf(rows, agent.id)
    expect(preset.id, agent.id).toBe(agent.id)
    const plugins = flat(preset.plugins)
    const persona = plugins.find(row => row.name === '@deepseek-ai/dsh-persona')?.config as { prefix?: string } | undefined
    // Every role agent carries the operator's language, so a Session does not answer in the harness's own.
    expect(persona?.prefix, agent.id).toContain('Answer in Turkish')
    expect(plugins.map(row => row.name), agent.id).toContain('@deepseek-ai/dsh-tool-skill')
  }
  // The chief of staff may hand a step to any other role by preset id.
  const chief = flat(presetOf(rows, 'superagent-chief-of-staff').plugins)
  const subagent = chief.find(row => row.name === '@deepseek-ai/dsh-tool-subagent')?.config as { allowedAgentPresets?: string[] }
  expect(subagent.allowedAgentPresets).toEqual(ROSTER.filter(agent => agent.key !== 'chiefOfStaff').map(agent => agent.id))
})

/**
 * The row ids the shipped `standard` preset carries, minus the two plugin admin rows it disables, plus the profile's
 * PTC presentation row: the operator asks for tools in one code block everywhere, and a role Session should not be the
 * one place where every call is a separate round trip.
 */
const ROLE_TOOLSET = ['persona', 'agent-instructions', 'time-context', 'tool-bash', 'tool-pwsh', 'tool-fs', 'tool-fs-search', 'tool-jobs',
  'tool-schedule', 'skill-filesystem', 'tool-skill', 'command-goal', 'tool-goal', 'planning', 'plan-mode', 'compaction', 'compaction-basic',
  'command-compact', 'tool-result-pruner', 'delegation', 'tool-subagent-control', 'tool-subagent-list-agents', 'tool-subagent',
  'tool-subagent-fork', 'workflow-ptc', 'tool-workflow', 'tool-ask-user', 'tool-todo', 'tool-web', 'tool-presentation', 'present']

it('gives every role preset the working toolset of the shipped standard preset', async () => {
  const rows = await patched()
  for (const agent of ROSTER) {
    // Parity is the point: a role agent that lacks the workflow engine, the fork, the schedules or the goals cannot do the work
    // the operator just picked it for. Host-scope tools (vault memory, bulk_read, cordis inspect) arrive outside the preset.
    expect(flat(presetOf(rows, agent.id).plugins).map(row => row.id), agent.id).toEqual(ROLE_TOOLSET)
  }
  // The two plugin admin rows stay out: `standard` disables them, and reconfiguring the profile is not a role's job.
  const chief = flat(presetOf(rows, 'superagent-chief-of-staff').plugins)
  expect(chief.map(row => row.name)).not.toContain('@deepseek-ai/dsh-plugin-manager/tools')
  expect(chief.map(row => row.name)).not.toContain('@deepseek-ai/dsh-plugin-market/tools')
  // The spawn tool offers a model choice, and the workflow engine is the spawn provider, so scale-out does not fork the caller's context.
  const spawn = chief.find(row => row.name === '@deepseek-ai/dsh-tool-subagent' && row.id === 'tool-subagent')
  expect(spawn?.config).toMatchObject({ provider: 'spawn', modelSelectionSettings: true })
  expect(chief.find(row => row.id === 'workflow-ptc')?.config).toEqual({ provider: 'spawn' })
})
