/**
 * Standing roles beyond the four this bundle declares in its patch. A role file is one JSON document in the profile
 * state directory's roles folder; the registry (src/app/roles.ts) turns it into an agent preset while the Host runs,
 * so a role the operator asks for is usable without rebuilding or restarting anything.
 *
 * The toolset is the same list the bundle's patch gives its own role presets. The two are locked together by
 * tests/bundle-patch.spec.ts, so a row added to one and not the other fails the suite rather than drifting.
 */
import { z } from 'zod'

/** One Cordis plugin row, the shape both the patch and agentPresets.register take. */
export interface RoleRow {
  readonly id: string
  readonly name: string
  readonly disabled?: boolean
  readonly config?: Record<string, unknown> | readonly RoleRow[]
}

/** Icon names controls.tsx can draw for a role avatar. */
export const ROLE_ICONS = ['briefcase', 'search', 'code', 'pen'] as const
export type RoleIcon = typeof ROLE_ICONS[number]

/** A role file: what the role is called, how it should behave, and how its card looks. */
export interface RoleSpec {
  /** Agent preset id; every role id starts with superagent- so the panel and the toolset rules can recognise one. */
  readonly id: string
  readonly name: string
  readonly description: string
  /** The persona text prepended to the role's system prompt. */
  readonly persona: string
  readonly icon: RoleIcon
  readonly hue: number
}

/** Ids must be stable, lowercase and recognisable as this bundle's; a Session preset chip shows them as they are. */
const ID = /^superagent-[a-z0-9]+(?:-[a-z0-9]+)*$/

const roleSpec = z.strictObject({
  id: z.string().regex(ID, 'id must look like superagent-<lowercase-words>'),
  name: z.string().min(1).max(60),
  description: z.string().min(1).max(200),
  // Short personas make a role that answers like the default agent with a different name; ask for a real character.
  persona: z.string().min(120).max(4000),
  icon: z.enum(ROLE_ICONS).default('briefcase'),
  hue: z.number().int().min(0).max(359).optional(),
})

/** The rows every role gets, in mount order. The persona is prepended by rolePlugins. */
export const ROLE_TOOLSET: readonly RoleRow[] = [
  { id: 'agent-instructions', name: '@deepseek-ai/dsh-agent-instructions', config: { maxBytes: 65536 } },
  { id: 'time-context', name: '@deepseek-ai/dsh-time-context' },
  { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash', disabled: process.platform === 'win32' },
  { id: 'tool-pwsh', name: '@deepseek-ai/dsh-tool-pwsh', disabled: process.platform !== 'win32' },
  { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs' },
  { id: 'tool-fs-search', name: '@deepseek-ai/dsh-tool-fs-search', config: { sampleOverCapGlobResults: false } },
  { id: 'tool-jobs', name: '@deepseek-ai/dsh-tool-jobs' },
  { id: 'tool-schedule', name: '@deepseek-ai/dsh-tool-schedule' },
  { id: 'skill-filesystem', name: '@deepseek-ai/dsh-skill-filesystem' },
  { id: 'tool-skill', name: '@deepseek-ai/dsh-tool-skill' },
  { id: 'command-goal', name: '@deepseek-ai/dsh-command-goal' },
  { id: 'tool-goal', name: '@deepseek-ai/dsh-tool-goal' },
  { id: 'planning', name: 'cordis:group', config: [{ id: 'plan-mode', name: '@deepseek-ai/dsh-plan-mode' }] },
  {
    id: 'compaction', name: 'cordis:group', config: [
      { id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic' },
      { id: 'command-compact', name: '@deepseek-ai/dsh-command-compact' },
      { id: 'tool-result-pruner', name: '@deepseek-ai/dsh-compaction-tool-result-pruner',
        config: { thresholdChars: 8192, headChars: 4096, tailChars: 1024 } },
    ],
  },
  {
    id: 'delegation', name: 'cordis:group', config: [
      { id: 'tool-subagent-control', name: '@deepseek-ai/dsh-tool-subagent-control' },
      { id: 'tool-subagent-list-agents', name: '@deepseek-ai/dsh-tool-subagent-control/list-agents' },
      { id: 'tool-subagent', name: '@deepseek-ai/dsh-tool-subagent',
        config: { provider: 'spawn', toolName: 'subagent', modelSelectionSettings: true, agentPreset: 'standard' } },
      { id: 'tool-subagent-fork', name: '@deepseek-ai/dsh-tool-subagent',
        config: { provider: 'fork', toolName: 'subagent_fork' } },
      { id: 'workflow-ptc', name: '@deepseek-ai/dsh-workflow-ptc', config: { provider: 'spawn' } },
      { id: 'tool-workflow', name: '@deepseek-ai/dsh-tool-workflow' },
    ],
  },
  { id: 'tool-ask-user', name: '@deepseek-ai/dsh-tool-ask-user' },
  { id: 'tool-todo', name: '@deepseek-ai/dsh-tool-todo', config: { allowParallelInProgress: true } },
  { id: 'tool-web', name: '@deepseek-ai/dsh-tool-web', config: { fetch: true, searchTimeoutMs: 60000 } },
  { id: 'tool-presentation', name: '@deepseek-ai/dsh-agent-tool-presentation', config: { mode: 'ptc' } },
  { id: 'present', name: '@deepseek-ai/dsh-tool-present' },
]

/** The tint a role card gets when the file names none; stable for an id, so a card keeps its colour across restarts. */
export function roleHue(id: string): number {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 360
  return hash
}

/** Parse one role file; the message names the field that is wrong, so the Role Maker can fix it without guessing. */
export function parseRoleSpec(text: string, file = 'role'): RoleSpec {
  let value: unknown
  try { value = JSON.parse(text) } catch (error) {
    throw new Error(file + ': not valid JSON: ' + (error instanceof Error ? error.message : String(error)))
  }
  const parsed = roleSpec.safeParse(value)
  if (!parsed.success) {
    const issues = parsed.error.issues.map(issue => (issue.path.join('.') || '(root)') + ': ' + issue.message).join('; ')
    throw new Error(file + ': ' + issues)
  }
  return { ...parsed.data, hue: parsed.data.hue ?? roleHue(parsed.data.id) }
}

/** The plugin rows a role preset mounts: its persona, then the shared toolset. */
export function rolePlugins(spec: RoleSpec): RoleRow[] {
  return [{ id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: spec.persona } }, ...ROLE_TOOLSET]
}

/** What the registry writes into an empty roles folder: the format, in the words a role author needs. */
export const ROLES_README = [
  '# Roles',
  '',
  'Each <id>.json file in this folder is a standing role: the Role Maker writes it, the Host turns it into an agent',
  'preset while it runs, and the Agents tab shows it as a card. Delete a file to retire its role.',
  '',
  '    {',
  '      "id": "superagent-analyst",',
  '      "name": "Analyst",',
  '      "description": "Turns a pile of numbers into one decision with its evidence.",',
  '      "persona": "You are the operator\'s analyst. ...",',
  '      "icon": "search",',
  '      "hue": 205',
  '    }',
  '',
  '- id starts with superagent-; lowercase words, dashes.',
  '- name and description are what the card and the preset chip show.',
  '- persona is the role character, at least 120 characters. It is the only part a role author writes freely.',
  '- icon is one of briefcase, search, code, pen; hue is the avatar tint in degrees.',
  '- The toolset is not part of the file: every role mounts the same working toolset as the shipped roles, and',
  '  tests/bundle-patch.spec.ts keeps that list equal to the one the patch declares.',
  '',
].join('\n')

