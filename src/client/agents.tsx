/**
 * Agents tab: the operator's standing team. Each card starts a new Session under that role's agent preset, so the
 * team is usable from the panel without visiting Settings. The four shipped roles are `src/agents.ts`; anything the
 * Role Maker adds is a file the Host registered, so the tab asks the Host for those instead of a build-time list.
 */
import type { CSSProperties } from 'react'
import { ROSTER } from '../agents.ts'
import { usePoll } from './api.ts'
import { InboxPanel, LivePanel } from './live.tsx'
import { Button, Icon } from './controls.tsx'
import type { DshSuperagentKey } from './locales.ts'
import { usePanel } from './provider.tsx'
import type { T } from './text.ts'

/** One roster field as a dictionary key; the roster holds the agent, the dictionaries hold its words. */
const copy = (t: T, agent: string, field: 'name' | 'role' | 'blurb') => t(`agent.${agent}.${field}` as DshSuperagentKey)

/** The avatar tint a card sets on its avatar; the theme supplies saturation and lightness. */
const tint = (hue: number) => ({ '--dt-agent-hue': hue } as CSSProperties)

export function AgentsPage({ startAgent }: { startAgent: (preset: string) => void }) {
  const { t, call } = usePanel()
  // Roles created while the Host runs live in its registry, not in this bundle; polling is what makes a new card appear.
  const { data } = usePoll(() => call('GET roles', {}), [])
  const added = data?.roles ?? []
  const broken = data?.problems ?? []
  // Tasks the roles run on their own schedule; the chief of staff assigns them in conversation, this tab pauses them.
  const { data: scheduled } = usePoll(() => call('GET tasks', {}), [])
  const tasks = scheduled?.tasks ?? []
  return <section className="dt-agents" aria-label={t('tab.agents')}>
    <p className="dt-hint">{t('agentsIntro')}</p>
    <InboxPanel />
    <LivePanel />
    <ul className="dt-agent-grid">
      {ROSTER.map(agent => <li key={agent.id} className="dt-agent-card">
        <div className="dt-agent-head">
          <span className="dt-agent-avatar" style={tint(agent.hue)} aria-hidden="true">
            <Icon name={agent.icon} size={18} />
          </span>
          <div className="dt-agent-id">
            <h3 className="dt-agent-name">{copy(t, agent.key, 'name')}</h3>
            <span className="dt-agent-role">{copy(t, agent.key, 'role')}</span>
          </div>
        </div>
        <p className="dt-agent-blurb">{copy(t, agent.key, 'blurb')}</p>
        <div className="dt-agent-foot">
          <Button variant="outline" size="sm" icon={<Icon name="message" size={14} />}
            aria-label={t('agent.startAgent', { agent: copy(t, agent.key, 'name') })} onClick={() => startAgent(agent.id)}>
            {t('agent.start')}
          </Button>
        </div>
      </li>)}
      {added.map(role => <li key={role.id} className="dt-agent-card">
        <div className="dt-agent-head">
          <span className="dt-agent-avatar" style={tint(role.hue)} aria-hidden="true">
            <Icon name={role.icon} size={18} />
          </span>
          <div className="dt-agent-id">
            <h3 className="dt-agent-name">{role.name}</h3>
            {/* The preset id is how the chief of staff names this role when it delegates, so the card shows it. */}
            <span className="dt-agent-role">{role.id}</span>
          </div>
        </div>
        <p className="dt-agent-blurb">{role.description}</p>
        <div className="dt-agent-foot">
          <Button variant="outline" size="sm" icon={<Icon name="message" size={14} />}
            aria-label={t('agent.startAgent', { agent: role.name })} onClick={() => startAgent(role.id)}>
            {t('agent.start')}
          </Button>
        </div>
      </li>)}
    </ul>
    {broken.length > 0 && <p className="dt-hint">{t('agent.broken')}:{' '}
      {broken.map(problem => problem.file + ': ' + problem.message).join(' | ')}</p>}
    <h3 className="dt-block-title">{t('tasks.head')}</h3>
    {tasks.length === 0 ? <p className="dt-hint">{t('tasks.none')}</p> : <ul className="dt-agent-grid">
      {tasks.map(task => <li key={task.id} className="dt-agent-card">
        <div className="dt-agent-head">
          <span className="dt-agent-avatar" style={tint(task.enabled ? 152 : 0)} aria-hidden="true">
            <Icon name="clock" size={18} />
          </span>
          <div className="dt-agent-id">
            <h3 className="dt-agent-name">{task.title}</h3>
            <span className="dt-agent-role">{task.preset}</span>
          </div>
        </div>
        <p className="dt-agent-blurb">{task.cadenceText} · {task.nextRunLocal} · {task.runs} {t('task.runs')}</p>
        <div className="dt-agent-foot">
          <Button variant="outline" size="sm"
            onClick={() => void call('POST tasks/:id/control', { id: task.id, body: { action: task.enabled ? 'pause' : 'resume' } })}>
            {task.enabled ? t('task.pause') : t('task.resume')}
          </Button>
          <Button size="sm"
            onClick={() => void call('POST tasks/:id/control', { id: task.id, body: { action: 'delete' } })}>
            {t('task.delete')}
          </Button>
        </div>
      </li>)}
    </ul>}
    <p className="dt-hint">{t('agentsFoot')}</p>
  </section>
}

