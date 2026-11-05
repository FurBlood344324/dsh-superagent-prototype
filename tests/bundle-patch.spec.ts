/** The bundle's patch, read with the entry-list dialect DSH reads bundle patches with, and the agent preset it defines. */
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { ROSTER } from '../src/agents.ts'
import { ROLE_TOOLSET } from '../src/roles.ts'
import { RoleRegistry } from '../src/app/roles.ts'
import { ROUTER_PRESET, WORKER_PRESET } from '../src/app/sessions.ts'

const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })

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
    'preset-superagent-editor', 'preset-superagent-role-maker'])
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
})

/** A role card the registry accepts; a test overrides one field to make it a card the registry refuses. */
const PERSONA = 'You are the operator analyst. You read the numbers before you read the story, you say what the evidence' +
  ' supports and what it does not, and you end with the one decision the numbers point at.'
const roleFile = (id: string, over: Record<string, unknown> = {}): string =>
  JSON.stringify({ id, name: 'Analyst', description: 'Turns numbers into one decision.', persona: PERSONA, ...over })

it('offers the chief every role preset the deployment installed, and only the ones that load', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'superagent-choices-'))
  dirs.push(dir)
  const roles = join(dir, 'roles')
  await mkdir(roles)
  await writeFile(join(roles, 'analyst.json'), roleFile('superagent-analyst'))
  await writeFile(join(roles, 'broken.json'), roleFile('superagent-broken', { persona: 'too short' }))
  await writeFile(join(roles, 'engineer.json'), roleFile('superagent-engineer'))
  await writeFile(join(roles, 'extra.json'), roleFile('superagent-extra'))
  await writeFile(join(roles, 'README.md'), 'not a role card')

  const rows = await patched()
  const chief = flat(presetOf(rows, 'superagent-chief-of-staff').plugins)
  const subagent = chief.find(row => row.name === '@deepseek-ai/dsh-tool-subagent' && row.id === 'tool-subagent')?.config as {
    allowedAgentPresets?: string[] | { __jsExpr: string } } | undefined
  // Delegation keeps its provider, tool name and model choice; the preset enum is the only thing that grows.
  expect(Object.keys(subagent ?? {}).sort()).toEqual(['allowedAgentPresets', 'modelSelectionSettings', 'provider', 'toolName'])

  // The Host tree a preset row's expression is evaluated against: the plugin entry that names the state directory, and the presets
  // this patch declares. Both are read from the composed configuration the Loader holds when the preset mounts.
  const host = {
    *entries() {
      yield { options: { id: 'dsh-superagent', name: 'dsh-superagent', config: { stateDir: dir } } }
      for (const agent of ROSTER) {
        yield { options: { id: 'preset-' + agent.id, name: '@deepseek-ai/dsh-agent-preset', config: { id: agent.id } } }
      }
      yield { options: { id: 'preset-superagent-extra', name: '@deepseek-ai/dsh-agent-preset', config: { id: 'superagent-extra' } } }
    },
  }
  const cordis = createRequire(createRequire(import.meta.url).resolve('@deepseek-ai/cordis/package.json'))
  const { evaluate } = await import(cordis.resolve('@deepseek-ai/cordis-plugin-loader')) as {
    evaluate(ctx: unknown, expression: string): unknown }
  const configured = subagent?.allowedAgentPresets
  const choices = configured === undefined ? [] : Array.isArray(configured) ? configured
    : evaluate({ get: (name: string) => name === 'loader' ? host : undefined }, configured.__jsExpr) as string[]

  const shipped = ROSTER.filter(agent => agent.key !== 'chiefOfStaff').map(agent => agent.id)
  for (const id of shipped) expect(choices).toContain(id)
  expect(choices).not.toContain('superagent-chief-of-staff')
  // The same folder the registry reads: it registers the analyst and refuses the broken card, the duplicate id and the id the patch
  // already declares. The enum is exactly the shipped roster plus those registered roles, so the two sources cannot drift.
  const presets = { list: async () => [...shipped, 'superagent-extra'].map(id => ({ id })), register: async () => async () => {} }
  const registry = new RoleRegistry({ get: name => name === 'agentPresets' ? presets : undefined,
    logger: { warn: () => {}, info: () => {} } }, roles)
  await registry.reload()
  expect(registry.view().roles.map(role => role.id)).toEqual(['superagent-analyst'])
  expect(choices).toEqual([...shipped, ...registry.view().roles.map(role => role.id)])
  // What the model is offered, in order: the four shipped roles, then the card the folder holds, and nothing else.
  expect(choices).toEqual(['superagent-researcher', 'superagent-engineer', 'superagent-editor', 'superagent-role-maker', 'superagent-analyst'])
})

/** The rows each role preset should carry, in order: its persona, then the shared toolset the registry also mounts. */
const expectedToolset = ['persona', ...flat(ROLE_TOOLSET as never).map(row => row.id)]

it('gives every role preset the working toolset of the shipped standard preset', async () => {
  const rows = await patched()
  for (const agent of ROSTER) {
    // Parity is the point: a role agent that lacks the workflow engine, the fork, the schedules or the goals cannot do the work
    // the operator just picked it for. Host-scope tools (vault memory, bulk_read, cordis inspect) arrive outside the preset.
    expect(flat(presetOf(rows, agent.id).plugins).map(row => row.id), agent.id).toEqual(expectedToolset)
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
