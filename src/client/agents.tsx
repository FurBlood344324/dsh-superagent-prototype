/**
 * Agents tab: the operator's standing team. Each card starts a new Session under that role's agent preset, so the
 * team is usable from the panel without visiting Settings; the roster itself is `src/agents.ts`.
 */
import type { CSSProperties } from 'react'
import { ROSTER } from '../agents.ts'
import { Button, Icon } from './controls.tsx'
import type { DshSuperagentKey } from './locales.ts'
import { usePanel } from './provider.tsx'
import type { T } from './text.ts'

/** One roster field as a dictionary key; the roster holds the agent, the dictionaries hold its words. */
const copy = (t: T, agent: string, field: 'name' | 'role' | 'blurb') => t(`agent.${agent}.${field}` as DshSuperagentKey)

export function AgentsPage({ startAgent }: { startAgent: (preset: string) => void }) {
  const { t } = usePanel()
  return <section className="dt-agents" aria-label={t('tab.agents')}>
    <p className="dt-hint">{t('agentsIntro')}</p>
    <ul className="dt-agent-grid">
      {ROSTER.map(agent => <li key={agent.id} className="dt-agent-card">
        <div className="dt-agent-head">
          <span className="dt-agent-avatar" style={{ '--dt-agent-hue': agent.hue } as CSSProperties} aria-hidden="true">
            <Icon name={agent.icon} size={18} />
          </span>
          <div className="dt-agent-id">
            <h3 className="dt-agent-name">{copy(t, agent.key, 'name')}</h3>
            <span className="dt-agent-role">{copy(t, agent.key, 'role')}</span>
          </div>
        </div>
        <p className="dt-agent-blurb">{copy(t, agent.key, 'blurb')}</p>
        <div className="dt-agent-foot">
          <Button variant="outline" size="sm" icon={<Icon name="message" size={14} />} onClick={() => startAgent(agent.id)}>
            {t('agent.start')}
          </Button>
        </div>
      </li>)}
    </ul>
    <p className="dt-hint">{t('agentsFoot')}</p>
  </section>
}
