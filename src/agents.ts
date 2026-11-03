/**
 * The role agents the panel's Agents tab offers. Each id is an agent preset this bundle declares in
 * `cordis.patch.yml`; the tab starts a new Session under it, so one list drives both sides and
 * `tests/bundle-patch.spec.ts` fails when the two drift apart.
 */

/** One role agent: the preset a Session starts under, the icon that stands for it, and its tint. */
export interface RosterAgent {
  /** Agent preset id, declared by this bundle's patch. */
  readonly id: string
  /** Copy key under `agent.<key>.` in the panel dictionaries. */
  readonly key: string
  /** Icon name from `controls.tsx`. */
  readonly icon: 'briefcase' | 'search' | 'code' | 'pen' | 'user'
  /** Hue of the avatar tint, in degrees; the theme supplies the saturation and lightness. */
  readonly hue: number
}

/** The operator's standing team, in the order the tab shows it. */
export const ROSTER: readonly RosterAgent[] = [
  { id: 'superagent-chief-of-staff', key: 'chiefOfStaff', icon: 'briefcase', hue: 32 },
  { id: 'superagent-researcher', key: 'researcher', icon: 'search', hue: 205 },
  { id: 'superagent-engineer', key: 'engineer', icon: 'code', hue: 152 },
  { id: 'superagent-editor', key: 'editor', icon: 'pen', hue: 282 },
  // The one role that builds the others; the chief of staff hands role requests to it.
  { id: 'superagent-role-maker', key: 'roleMaker', icon: 'user', hue: 340 },
]
