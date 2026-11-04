/**
 * The Agents tab's two live views: the role Sessions at work right now with the steps each one took, and the inbox the
 * chief of staff writes to when something needs the operator. Both poll while the tab is open; the feed is fetched only
 * for the run the operator expanded, so a long list stays cheap.
 */
import { useEffect, useRef, useState } from 'react'
import { usePoll } from './api.ts'
import { Button } from './controls.tsx'
import { usePanel } from './provider.tsx'
import { errorText } from './text.ts'

/** Steps one expanded run shows; the newest are the ones that matter. */
const STEPS_SHOWN = 40
/** The class a step's kind is drawn with; written out so the stylesheet check sees each one used. */
const STEP_CLASS = { user: 'dt-step-user', say: 'dt-step-say', tool: 'dt-step-tool' } as const
/** Local wall-clock time of a step or a message. */
const time = (at: string): string => {
  const date = new Date(at)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
const notices = (): typeof Notification | undefined => typeof window !== 'undefined' && 'Notification' in window ? window.Notification : undefined

/** What the roles are doing now, one row per Session. */
export function LivePanel() {
  const { t, call, openSession, notify } = usePanel()
  const { data } = usePoll(() => call('GET runs'), [], 2000)
  const runs = data?.runs ?? []
  const [open, setOpen] = useState<string>()
  return <section className="dt-live" aria-label={t('live.head')}>
    <h3 className="dt-block-title">{t('live.head')}</h3>
    {runs.length === 0 ? <p className="dt-hint">{t('live.none')}</p> : <ul className="dt-list">
      {runs.map(run => <li key={run.id} className="dt-run">
        <button type="button" className="dt-run-head" aria-expanded={open === run.id}
          onClick={() => setOpen(open === run.id ? undefined : run.id)}>
          <span className={'dt-run-dot ' + run.status} aria-hidden="true" />
          <span className="dt-run-title">{run.title}</span>
          <span className="dt-run-meta">{run.status === 'running' ? t('live.running') : t('live.idle')} · {t('live.steps', { count: String(run.steps) })}</span>
        </button>
        <p className="dt-run-last">{run.last}</p>
        {open === run.id && <RunFeed id={run.id} />}
        <div className="dt-run-foot">
          <Button variant="outline" size="sm"
            onClick={() => { openSession(run.id).catch(error => notify(errorText(error))) }}>{t('live.open')}</Button>
        </div>
      </li>)}
    </ul>}
  </section>
}

/** One run's steps, newest last, refreshed while the run works. */
function RunFeed({ id }: { id: string }) {
  const { t, call } = usePanel()
  const { data } = usePoll(() => call('GET runs/:id', { id }), [id], 2000)
  const feed = (data?.feed ?? []).slice(-STEPS_SHOWN)
  return <ol className="dt-run-feed" aria-label={t('live.feed')}>
    {feed.map((step, index) => <li key={index} className={'dt-step ' + STEP_CLASS[step.kind]}>
      <span className="dt-step-when">{time(step.at)}</span>
      <span className="dt-step-text">{step.text}</span>
    </li>)}
  </ol>
}

/** The messages that need the operator: what the chief of staff decided they must read. */
export function InboxPanel() {
  const { t, call, openSession, notify } = usePanel()
  const { data, reload } = usePoll(() => call('GET inbox'), [], 5000)
  const items = data?.items ?? []
  const unread = data?.unread ?? 0
  const known = useRef<Set<string> | undefined>(undefined)
  // Announce a message that arrived while the panel was open; the first poll is the backlog, not news.
  useEffect(() => {
    if (!data) return
    const seen = known.current
    known.current = new Set(data.items.map(item => item.id))
    if (!seen) return
    const fresh = data.items.filter(item => !item.read && !seen.has(item.id))
    if (fresh.length === 0) return
    notify(t('inbox.new', { count: String(fresh.length) }))
    const Notice = notices()
    if (Notice?.permission === 'granted') new Notice(fresh[0]!.title, { body: fresh[0]!.text.slice(0, 160) })
  }, [data, notify, t])
  const openItem = (item: (typeof items)[number]) => {
    if (!item.read) void call('POST inbox/:id/read', { id: item.id }).then(() => reload()).catch(() => undefined)
    if (item.sessionId) openSession(item.sessionId).catch(error => notify(errorText(error)))
  }
  const ask = () => { const Notice = notices(); if (Notice) void Notice.requestPermission().then(() => reload()) }
  const canAsk = notices()?.permission === 'default'
  return <section className="dt-inbox" aria-label={t('inbox.head')}>
    <h3 className="dt-block-title">{t('inbox.head')}{unread > 0 && <span className="dt-count">{t('inbox.unread', { count: String(unread) })}</span>}</h3>
    {items.length === 0 ? <p className="dt-hint">{t('inbox.none')}</p> : <ul className="dt-list">
      {items.map(item => <li key={item.id} className={'dt-inbox-item' + (item.read ? '' : ' unread')}>
        <button type="button" className="dt-inbox-head" onClick={() => openItem(item)}>
          <span className="dt-inbox-title">{item.title}</span>
          <span className="dt-inbox-meta">{item.from} · {time(item.at)}</span>
        </button>
        <p className="dt-inbox-text">{item.text}</p>
      </li>)}
    </ul>}
    {canAsk && <Button variant="outline" size="sm" onClick={ask}>{t('inbox.notify')}</Button>}
  </section>
}
