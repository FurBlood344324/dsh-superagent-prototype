/**
 * Automated tasks: a role, a prompt, and when to run it. A task is not a Session reminder; it starts a fresh
 * Session under the role's agent preset, which is what lets the chief of staff hand recurring work to a specialist.
 */

/** When a task runs. Local time, because the operator reads the clock on this machine. */
export type Cadence =
  | { readonly kind: 'every'; readonly minutes: number }
  | { readonly kind: 'daily'; readonly time: string }
  | { readonly kind: 'weekly'; readonly weekdays: readonly number[]; readonly time: string }

/** One completed attempt: which Session it opened, or why it failed. */
export interface TaskRun {
  readonly at: string
  readonly sessionId?: string
  readonly error?: string
}

/** A standing assignment from the operator to a role. */
export interface Task {
  readonly id: string
  readonly title: string
  /** Agent preset the run's Session starts under. */
  readonly preset: string
  readonly prompt: string
  readonly cadence: Cadence
  readonly enabled: boolean
  readonly createdAt: string
  /** ISO instant of the next run; recomputed after every attempt. */
  readonly nextRun: string
  readonly runs: number
  readonly lastRun?: TaskRun
}

/** What a tool or the panel needs to show about one task. */
export interface TaskView extends Task {
  /** Next run as local time, so a reader does not convert ISO in their head. */
  readonly nextRunLocal: string
  /** The cadence in words, as the tools and the panel show it. */
  readonly cadenceText: string
}

/** A task with the two derived fields every reader wants. */
export function taskView(task: Task): TaskView {
  return { ...task, nextRunLocal: localTime(task.nextRun), cadenceText: describeCadence(task.cadence) }
}

const WEEKDAYS: Record<string, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 }
const EVERY = /^every\s+(\d+)\s*(m|min|minute|minutes|h|hour|hours)$/i
const DAILY = /^daily\s+(\d{1,2}):(\d{2})$/i
const WEEKLY = /^weekly\s+([a-z,]+)\s+(\d{1,2}):(\d{2})$/i
/** Fastest cadence accepted: a role that fires every minute is a loop, not an automated task. */
export const MIN_EVERY_MINUTES = 5

function time(hour: number, minute: number): string {
  if (hour > 23 || minute > 59) throw new Error('time must be HH:MM between 00:00 and 23:59')
  return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0')
}

/** Parse the one-line cadence the tools take: `every 30m`, `every 2h`, `daily 09:00`, `weekly mon,thu 09:00`. */
export function parseWhen(when: string): Cadence {
  const text = when.trim()
  const every = EVERY.exec(text)
  if (every) {
    const size = Number(every[1]) * (every[2]!.toLowerCase().startsWith('h') ? 60 : 1)
    if (size < MIN_EVERY_MINUTES) throw new Error('every wants at least ' + MIN_EVERY_MINUTES + ' minutes')
    return { kind: 'every', minutes: size }
  }
  const daily = DAILY.exec(text)
  if (daily) return { kind: 'daily', time: time(Number(daily[1]), Number(daily[2])) }
  const weekly = WEEKLY.exec(text)
  if (weekly) {
    const weekdays = weekly[1]!.split(',').map(day => day.trim()).filter(Boolean).map(day => {
      const index = WEEKDAYS[day.toLowerCase()]
      if (index === undefined) throw new Error('unknown day ' + day + '; use mon,tue,wed,thu,fri,sat,sun')
      return index
    })
    if (weekdays.length === 0) throw new Error('weekly needs at least one day')
    return { kind: 'weekly', weekdays: [...new Set(weekdays)].sort(), time: time(Number(weekly[2]), Number(weekly[3])) }
  }
  throw new Error('when must be "every 30m", "every 2h", "daily 09:00" or "weekly mon,thu 09:00"')
}

/** Whether a local date matches the weekday part of a weekly cadence. */
function weekdayOf(date: Date): number { return date.getDay() === 0 ? 7 : date.getDay() }

/** The local instant a cadence is next due, strictly after `from`. */
export function nextRunAt(cadence: Cadence, from: Date = new Date()): Date {
  if (cadence.kind === 'every') return new Date(from.getTime() + cadence.minutes * 60_000)
  const [hour, minute] = cadence.time.split(':').map(Number) as [number, number]
  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset, hour, minute, 0, 0)
    if (candidate.getTime() <= from.getTime()) continue
    if (cadence.kind === 'weekly' && !cadence.weekdays.includes(weekdayOf(candidate))) continue
    return candidate
  }
  throw new Error('this cadence has no next run')
}

/** A stable, readable id from a title; the task id is what the operator (and the tools) name it by. */
export function taskId(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return slug || 'task'
}

/** A cadence in words, for tool output and the panel. */
export function describeCadence(cadence: Cadence): string {
  if (cadence.kind === 'every') return 'every ' + (cadence.minutes % 60 === 0 ? cadence.minutes / 60 + 'h' : cadence.minutes + 'm')
  const days = cadence.kind === 'weekly' ? ' on ' + cadence.weekdays.map(day => Object.keys(WEEKDAYS).find(key => WEEKDAYS[key] === day)).join(',') : ''
  return cadence.kind === 'daily' ? 'daily at ' + cadence.time : 'weekly at ' + cadence.time + days
}

/** Local time of an ISO instant, matching the clock the operator reads. */
export function localTime(iso: string): string {
  const date = new Date(iso)
  return date.toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

