/**
 * Turns role files into agent presets while the Host runs. The four shipped roles are declared in the bundle patch;
 * everything the Role Maker adds is a JSON file in the profile state directory, read here and registered through the
 * agent-preset service, so a new role is usable in the same Host process that wrote it.
 */
import { watch, type FSWatcher } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ROLES_README, parseRoleSpec, rolePlugins, type RoleIcon, type RoleSpec } from '../roles.ts'

/** One role as the panel shows it. */
export interface RoleView {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly icon: RoleIcon
  readonly hue: number
  /** File name inside the roles folder, so a broken role can be pointed at. */
  readonly file: string
}

/** A role file the registry refused, with the reason it was refused. */
export interface RoleProblem {
  readonly file: string
  readonly message: string
}

/** The panel's whole view of the folder: what became a role, what did not, and where the folder is. */
export interface RoleListView {
  readonly dir: string
  readonly roles: readonly RoleView[]
  readonly problems: readonly RoleProblem[]
}

/** The slice of the agent-preset service this file needs. */
export interface PresetService {
  list(): Promise<readonly { id: string }[]>
  register(definition: { id: string; name: string; description: string; order: number; plugins: unknown[] }):
    Promise<() => Promise<void>>
}

/** The slice of the Cordis context this file needs, so tests can drive it without a Host. */
export interface RegistryContext {
  get(name: string): unknown
  logger: { warn(message: string, ...args: unknown[]): void; info(message: string, ...args: unknown[]): void }
}

/** How long a burst of file writes has to settle before the folder is reread; editors write in two or three steps. */
const SETTLE_MS = 150

/** Reads the roles folder, keeps it in step with the agent-preset service, and answers the panel's view of it. */
export class RoleRegistry {
  private readonly disposers = new Map<string, { text: string; dispose: () => Promise<void> }>()
  private roles: RoleView[] = []
  private problems: RoleProblem[] = []
  private watcher: FSWatcher | undefined
  private timer: NodeJS.Timeout | undefined
  constructor(private readonly ctx: RegistryContext, readonly dir: string) {}

  /** What the panel renders: registered roles, refused files, and the folder the Role Maker writes into. */
  view(): RoleListView { return { dir: this.dir, roles: this.roles, problems: this.problems } }

  /** Create the folder with its readme, load what is there, then follow it. */
  async start(): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const readme = join(this.dir, 'README.md')
    await readFile(readme, 'utf8').catch(() => writeFile(readme, ROLES_README, 'utf8'))
    await this.reload()
    this.watcher = watch(this.dir, () => this.schedule())
    this.watcher.on('error', error => this.ctx.logger.warn('dsh-superagent roles: folder watch stopped: %s', String(error)))
  }

  /** Unregister every role this registry added and stop watching. Roles already running in a Session keep their revision. */
  async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.watcher?.close()
    this.watcher = undefined
    const entries = [...this.disposers.values()]
    this.disposers.clear()
    this.roles = []
    for (const entry of entries) await entry.dispose().catch(() => undefined)
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => { this.timer = undefined; void this.reload().catch(error => this.ctx.logger.warn('dsh-superagent roles: reload failed: %s', String(error))) }, SETTLE_MS)
  }

  /** Reread the folder: register what changed, retire what left. One bad file never stops the others. */
  async reload(): Promise<void> {
    const presets = this.ctx.get('agentPresets') as PresetService | undefined
    if (!presets) { this.ctx.logger.warn('dsh-superagent roles: no agent-preset service, roles stay unregistered'); return }
    const names = (await readdir(this.dir)).filter(name => name.endsWith('.json')).sort()
    const files = new Map<string, { spec: RoleSpec; text: string; file: string }>()
    const problems: RoleProblem[] = []
    for (const file of names) {
      const text = await readFile(join(this.dir, file), 'utf8').catch(() => '')
      try {
        const spec = parseRoleSpec(text, file)
        if (files.has(spec.id)) { problems.push({ file, message: 'another file already declares ' + spec.id }); continue }
        files.set(spec.id, { spec, text, file })
      } catch (error) { problems.push({ file, message: error instanceof Error ? error.message : String(error) }) }
    }
    // A role the bundle patch or another plugin already declares keeps its own definition; the file is a mistake worth showing.
    const ours = new Set(this.disposers.keys())
    const foreign = new Set((await presets.list()).map(row => row.id).filter(id => !ours.has(id)))
    for (const [id, entry] of files) {
      if (foreign.has(id)) {
        problems.push({ file: entry.file, message: id + ' is already a preset; rename the role or delete the file' })
        files.delete(id)
      }
    }
    for (const [id, entry] of [...this.disposers]) {
      const next = files.get(id)
      if (next && next.text === entry.text) continue
      this.disposers.delete(id)
      await entry.dispose().catch(error => this.ctx.logger.warn('dsh-superagent roles: could not retire %s: %s', id, String(error)))
    }
    let order = 50
    for (const [id, entry] of files) {
      order += 1
      if (this.disposers.has(id)) continue
      try {
        const dispose = await presets.register({ id, name: entry.spec.name, description: entry.spec.description, order,
          plugins: rolePlugins(entry.spec) })
        this.disposers.set(id, { text: entry.text, dispose })
      } catch (error) { problems.push({ file: entry.file, message: error instanceof Error ? error.message : String(error) }) }
    }
    this.roles = [...files].map(([id, entry]) => ({ id, name: entry.spec.name, description: entry.spec.description,
      icon: entry.spec.icon, hue: entry.spec.hue, file: entry.file }))
    this.problems = problems
    if (problems.length > 0) this.ctx.logger.warn('dsh-superagent roles: %d file(s) refused: %s', problems.length,
      problems.map(problem => problem.file + ': ' + problem.message).join(' | '))
  }
}

