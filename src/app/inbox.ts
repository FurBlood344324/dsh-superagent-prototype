/** The operator's inbox: the short messages a role, or the chief of staff on a role's behalf, decides the operator must read. */
import { randomUUID } from 'node:crypto'
import { KV } from '../kv.ts'
import type { Store } from './store.ts'

/** One message waiting for the operator. */
export interface InboxItem {
  readonly id: string
  readonly at: string
  /** Agent preset id of the Session that wrote it, or `panel` when a person did. */
  readonly from: string
  readonly title: string
  readonly text: string
  /** Session the message is about, so the panel can open it. */
  readonly sessionId?: string
  readonly read: boolean
}

/** What the panel shows: the newest messages and how many of them the operator has not read. */
export interface InboxView {
  readonly items: readonly InboxItem[]
  readonly unread: number
}

/** One message to record. */
export interface InboxMessage {
  readonly from: string
  readonly text: string
  readonly title?: string
  readonly sessionId?: string
}

/** How many messages the panel shows; the store keeps them all, and the count covers every unread one. */
const SHOWN = 40

/**
 * Keeps the operator's inbox in the same store as the rest of the Host's state, so a message survives a restart.
 * The relay tool writes here; the panel reads, and marks one read without removing it.
 */
export class Inbox {
  constructor(private readonly store: Pick<Store, 'get' | 'set' | 'keys'>, private readonly now: () => string = () => new Date().toISOString()) {}

  /** Record one message and return it as the panel will show it. */
  add(message: InboxMessage): InboxItem {
    const text = message.text.trim()
    if (!text) throw new Error('an inbox message needs text')
    const title = (message.title?.trim() || text.split('\n')[0] || text).slice(0, 80)
    const item: InboxItem = { id: `inbox-${randomUUID()}`, at: this.now(), from: message.from, title, text,
      ...(message.sessionId ? { sessionId: message.sessionId } : {}), read: false }
    this.store.set(KV.inbox.item(item.id), item)
    return item
  }

  /** The newest messages, newest first, with the count of every unread one. */
  view(): InboxView {
    const items = this.store.keys(KV.inbox.item).map(name => this.store.get(name) as InboxItem | undefined)
      .filter((item): item is InboxItem => item !== undefined)
      .sort((left, right) => right.at.localeCompare(left.at))
    return { items: items.slice(0, SHOWN), unread: items.filter(item => !item.read).length }
  }

  /** Mark one message read; `false` when no message holds that id. */
  markRead(id: string): boolean {
    const item = this.store.get(KV.inbox.item(id)) as InboxItem | undefined
    if (!item) return false
    if (!item.read) this.store.set(KV.inbox.item(id), { ...item, read: true })
    return true
  }
}
