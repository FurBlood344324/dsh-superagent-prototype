/** Role files: the schema the Role Maker writes against, and the registry that turns them into live agent presets. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { RoleRegistry, type PresetService } from '../src/app/roles.ts'
import { ROLE_TOOLSET, parseRoleSpec, roleHue, rolePlugins } from '../src/roles.ts'

const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })

/** A persona long enough to pass the schema, so a test about another field is not a test about length. */
const PERSONA = 'You are the operator analyst. You read the numbers before you read the story, you say what the evidence' +
  ' supports and what it does not, and you end with the one decision the numbers point at.'

function file(over: Record<string, unknown> = {}): string {
  return JSON.stringify({ id: 'superagent-analyst', name: 'Analyst', description: 'Turns numbers into one decision.', persona: PERSONA, ...over })
}

function fakePresets(): PresetService & { registered: string[]; disposed: string[] } {
  const registered: string[] = []
  const disposed: string[] = []
  return { registered, disposed,
    list: async () => registered.filter(id => !disposed.includes(id)).map(id => ({ id })),
    register: async definition => {
      // The Host refuses a second declaration with the same id; a role file that names an existing preset must be reported, not thrown at the panel.
      if (registered.includes(definition.id) && !disposed.includes(definition.id)) throw new Error('Duplicate agent preset: ' + definition.id)
      registered.push(definition.id)
      return async () => { disposed.push(definition.id) }
    } }
}

async function folder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'superagent-roles-'))
  dirs.push(dir)
  return dir
}

it('reads a role file and fills the card defaults', () => {
  const role = parseRoleSpec(file())
  expect(role.id).toBe('superagent-analyst')
  expect(role.icon).toBe('briefcase')
  expect(role.hue).toBe(roleHue('superagent-analyst'))
  expect(parseRoleSpec(file({ icon: 'code', hue: 12 }))).toMatchObject({ icon: 'code', hue: 12 })
})

it('names the field a bad role file got wrong', () => {
  expect(() => parseRoleSpec('{ nope')).toThrow(/not valid JSON/)
  expect(() => parseRoleSpec(file({ id: 'analyst' }))).toThrow(/id must look like/)
  expect(() => parseRoleSpec(file({ persona: 'short' }))).toThrow(/persona/)
  expect(() => parseRoleSpec(file({ hue: 400 }))).toThrow(/hue/)
  // A role file carries no toolset: a typo there has to fail rather than be ignored.
  expect(() => parseRoleSpec(file({ tools: ['bash'] }))).toThrow(/tools/)
})

it('mounts the role persona first, then the same toolset every role gets', () => {
  const plugins = rolePlugins(parseRoleSpec(file()))
  expect(plugins[0]).toEqual({ id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: PERSONA } })
  expect(plugins.slice(1)).toEqual(ROLE_TOOLSET)
})

it('registers the roles in the folder, reports the files it refuses, and retires what left', async () => {
  const dir = await folder()
  await writeFile(join(dir, 'analyst.json'), file())
  await writeFile(join(dir, 'broken.json'), file({ id: 'superagent-broken', persona: 'too short' }))
  const presets = fakePresets()
  const registry = new RoleRegistry({ get: name => name === 'agentPresets' ? presets : undefined, logger: { warn: () => {}, info: () => {} } }, dir)
  await registry.reload()
  expect(registry.view().roles.map(role => role.id)).toEqual(['superagent-analyst'])
  expect(registry.view().problems.map(problem => problem.file)).toEqual(['broken.json'])
  // A role written while the Host runs is picked up by the next reload; that is what the Role Maker relies on.
  await writeFile(join(dir, 'editorial.json'), file({ id: 'superagent-editorial', name: 'Editorial' }))
  await registry.reload()
  expect(registry.view().roles.map(role => role.id)).toEqual(['superagent-analyst', 'superagent-editorial'])
  expect(presets.registered).toContain('superagent-editorial')
  // Deleting a file retires its preset; the file that stays is not re-registered.
  await rm(join(dir, 'analyst.json'))
  await registry.reload()
  expect(registry.view().roles.map(role => role.id)).toEqual(['superagent-editorial'])
  expect(presets.disposed).toContain('superagent-analyst')
  await registry.stop()
  expect(presets.disposed).toContain('superagent-editorial')
})

it('leaves a preset the patch already declares to the patch, and says so', async () => {
  const dir = await folder()
  await writeFile(join(dir, 'chief.json'), file({ id: 'superagent-chief-of-staff', name: 'Impostor' }))
  const presets = fakePresets()
  presets.registered.push('superagent-chief-of-staff')
  const registry = new RoleRegistry({ get: name => name === 'agentPresets' ? presets : undefined, logger: { warn: () => {}, info: () => {} } }, dir)
  await registry.reload()
  expect(registry.view().roles).toEqual([])
  expect(registry.view().problems[0]?.message).toMatch(/already a preset/)
})

it('writes the folder readme so a role author can read the format where the roles are', async () => {
  const dir = await folder()
  const registry = new RoleRegistry({ get: name => name === 'agentPresets' ? fakePresets() : undefined, logger: { warn: () => {}, info: () => {} } }, dir)
  await registry.start()
  expect(await readFile(join(dir, 'README.md'), 'utf8')).toMatch(/Each <id>.json file in this folder is a standing role/)
  await registry.stop()
})

