import { useEffect, useMemo, useState } from 'react'
import { TYPE_LABELS, goalState, connectRate, personaLabel } from '../lib/tracker.js'

// The fixed daily template. Hours are local decimals (8.5 = 8:30am).
const BLOCKS = [
  { id: 'setup', label: 'Setup & prioritize', start: 8, end: 8.5, kind: 'setup' },
  { id: 'calls1', label: 'Power hour — calls', start: 8.5, end: 10, kind: 'calls' },
  { id: 'emails', label: 'Email block', start: 10, end: 11, kind: 'emails' },
  { id: 'calls2', label: 'Call block 2', start: 11, end: 12, kind: 'calls' },
  { id: 'lunch', label: 'Lunch', start: 12, end: 13, kind: 'break' },
  { id: 'research', label: 'Research — fill the to-finds', start: 13, end: 14, kind: 'research' },
  { id: 'calls3', label: 'Call block 3', start: 14, end: 16, kind: 'calls' },
  { id: 'wrap', label: 'Wrap-up', start: 16, end: 17, kind: 'wrap' },
]

const hhmm = (h) => `${Math.floor(h) % 12 || 12}:${h % 1 ? '30' : '00'}`

const STATE_TEXT = {
  stretch: 'text-primary-700 dark:text-primary-300',
  floor: 'text-success-700 dark:text-success-400',
  below: 'text-warning-700 dark:text-warning-400',
}

// A due contact rendered as a selectable chip: click makes it the activity
// bar's target (long-press a bar button to log against it).
function ContactChip({ c, accountName, targeted, onTarget }) {
  return (
    <button
      onClick={() => onTarget(c.id)}
      title={targeted ? 'Target — long-press an activity button to log to this contact' : 'Set as activity target'}
      className={`inline-flex max-w-full items-baseline gap-1.5 rounded-full border px-2.5 py-1 text-left text-xs ${
        targeted
          ? 'border-primary-500 bg-primary-100 text-primary-800 ring-1 ring-primary-400 dark:bg-primary-950/60 dark:text-primary-200'
          : 'border-zinc-300 bg-white hover:border-primary-400 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-primary-500'
      }`}
    >
      <span className="font-medium">{c.name ?? `to find: ${personaLabel(c.persona)}`}</span>
      <span className="truncate text-zinc-500">
        {accountName} · step {c.step}
        {c.nextAction ? ` · ${c.nextAction}` : ''}
      </span>
    </button>
  )
}

// #/day — the fixed time-blocked template with today's due contacts slotted
// in and Module 1's live counts pulled through (wrap-up fills itself).
export default function DayPage({ tracker, targetId, onTarget }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  const slotted = useMemo(() => {
    if (!tracker) return null
    const today = new Date().toLocaleDateString('en-CA')
    const accName = Object.fromEntries(tracker.accounts.map((a) => [a.id, a.name]))
    const workable = tracker.contacts.filter((c) => !['dead', 'meeting'].includes(c.status))
    const due = workable
      .filter((c) => c.nextDate && c.nextDate <= today && c.status !== 'to-find')
      .sort((a, b) => (a.nextDate < b.nextDate ? -1 : a.nextDate > b.nextDate ? 1 : b.step - a.step))
    const toFind = workable.filter((c) => c.status === 'to-find')
    const isEmailish = (c) => /mail|linkedin|\bli\b|connect/i.test(c.nextAction ?? '')
    const emails = due.filter(isEmailish)
    const calls = due.filter((c) => !isEmailish(c))
    // Even chunks across the three call blocks, keeping due-date order.
    const per = Math.ceil(calls.length / 3) || 1
    return {
      accName,
      due,
      toFind,
      byBlock: {
        emails,
        calls1: calls.slice(0, per),
        calls2: calls.slice(per, per * 2),
        calls3: calls.slice(per * 2),
      },
    }
  }, [tracker])

  if (!tracker || !slotted) return <p className="mt-10 text-center text-sm text-zinc-500">Loading tracker…</p>

  const counts = tracker.today.counts ?? {}
  const rate = connectRate(tracker.today)
  const h = now.getHours() + now.getMinutes() / 60
  const flagged = tracker.accounts.filter((a) => a.flags.length > 0)
  const singleThreaded = tracker.accounts.filter((a) => a.playType && a.threadIds.length < 2)

  const chips = (list) =>
    list.length > 0 ? (
      <div className="mt-2 flex flex-wrap gap-1.5">
        {list.map((c) => (
          <ContactChip key={c.id} c={c} accountName={slotted.accName[c.accountId] ?? c.accountId} targeted={c.id === targetId} onTarget={onTarget} />
        ))}
      </div>
    ) : (
      <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-600">nothing due here</p>
    )

  const goalLine = (type) => {
    const goal = tracker.goals[type]
    if (!goal) return null
    const n = counts[type] ?? 0
    const state = goalState(n, goal)
    return (
      <span className={STATE_TEXT[state] ?? ''}>
        {TYPE_LABELS[type]} {n}
        {goal.floor ? `/${goal.floor} floor` : `/${goal.stretch}`}
        {state === 'floor' ? ' ✓' : state === 'stretch' ? ' ✓✓' : ''}
      </span>
    )
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-bold tracking-tight">Day</h1>
      <p className="mt-1 text-sm text-zinc-500">
        {slotted.due.length} due · {slotted.toFind.length} to find · click a contact to target it, then long-press an
        activity button below to log against them
      </p>

      <ol className="mt-4 space-y-2">
        {BLOCKS.map((b) => {
          const current = h >= b.start && h < b.end
          const past = h >= b.end
          return (
            <li
              key={b.id}
              className={`rounded-lg border bg-white p-3 dark:bg-zinc-900 ${
                current
                  ? 'border-primary-400 ring-1 ring-primary-300/60 dark:border-primary-600 dark:ring-primary-800/60'
                  : 'border-zinc-200 dark:border-zinc-800'
              } ${past ? 'opacity-60' : ''}`}
            >
              <div className="flex items-baseline gap-2">
                <span className="w-24 shrink-0 text-xs text-zinc-500 tabular-nums">
                  {hhmm(b.start)}–{hhmm(b.end)}
                </span>
                <span className="text-sm font-semibold">{b.label}</span>
                {current && (
                  <span className="rounded-full bg-primary-100 px-2 py-0.5 text-xs text-primary-700 dark:bg-primary-950/60 dark:text-primary-300">
                    now
                  </span>
                )}
                {b.kind === 'calls' && (
                  <span className="ml-auto text-xs text-zinc-500 tabular-nums">{counts.call ?? 0} calls so far</span>
                )}
                {b.kind === 'emails' && (
                  <span className="ml-auto text-xs text-zinc-500 tabular-nums">{counts.email ?? 0} emails so far</span>
                )}
              </div>

              {b.kind === 'setup' && (
                <div className="mt-2 space-y-1 text-xs">
                  {flagged.length > 0 && (
                    <p className="text-brand-600 dark:text-brand-300">
                      Flags first:{' '}
                      {flagged.map((a) => `${a.name} — ${a.flags.join(', ')}`).join(' · ')}
                    </p>
                  )}
                  {singleThreaded.length > 0 && (
                    <p className="text-warning-700 dark:text-warning-400">
                      Single-threaded ⚠: {singleThreaded.map((a) => a.name).join(', ')} — add a second thread today
                    </p>
                  )}
                  <p className="text-zinc-500">
                    {slotted.due.length} contact{slotted.due.length === 1 ? '' : 's'} due · {slotted.toFind.length} to-find row
                    {slotted.toFind.length === 1 ? '' : 's'} for the research block
                  </p>
                </div>
              )}
              {(b.id === 'calls1' || b.id === 'calls2' || b.id === 'calls3') && chips(slotted.byBlock[b.id])}
              {b.kind === 'emails' && chips(slotted.byBlock.emails)}
              {b.kind === 'research' && chips(slotted.toFind)}
              {b.kind === 'wrap' && (
                <div className="mt-2 space-y-1 text-sm">
                  <p className="flex flex-wrap gap-x-3 tabular-nums">
                    {['call', 'email', 'linkedin', 'video', 'inmail'].map((t) => (
                      <span key={t}>{goalLine(t)}</span>
                    ))}
                  </p>
                  <p className="text-xs text-zinc-500 tabular-nums">
                    Connect rate {rate === null ? '—' : `${Math.round(rate * 100)}% (${tracker.today.connects}/${tracker.today.outcome_calls})`} ·
                    Replies {counts.reply ?? 0} · Meetings {counts.meeting ?? 0}
                  </p>
                  <p className="text-xs text-zinc-500">Auto-filled from the activity log — nothing to re-enter.</p>
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
