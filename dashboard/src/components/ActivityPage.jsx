import { useEffect, useState } from 'react'
import { TYPE_LABELS, OUTCOME_LABELS, goalState, pace, connectRate } from '../lib/tracker.js'
import { formatDate } from '../lib/format.js'

const STATE_TEXT = {
  stretch: 'text-primary-700 dark:text-primary-300',
  floor: 'text-success-700 dark:text-success-400',
  below: 'text-zinc-700 dark:text-zinc-300',
}
const STATE_BAR = { stretch: 'bg-primary-500', floor: 'bg-success-500', below: 'bg-warning-500' }
const STATE_LABEL = { stretch: 'stretch hit', floor: 'above floor', below: null }

// One goal card. The bar runs to the stretch target with a tick at the floor,
// so 55/60 calls reads "above floor", not "missed stretch".
function GoalCard({ type, count, goal, now }) {
  const state = goalState(count, goal)
  const target = goal.stretch ?? goal.floor
  const pct = Math.min((count / target) * 100, 100)
  const floorPct = goal.floor && goal.stretch ? (goal.floor / goal.stretch) * 100 : null
  const p = pace(count, goal.floor ?? goal.stretch, now)
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">{TYPE_LABELS[type]}</span>
        {STATE_LABEL[state] && <span className={`text-xs font-medium ${STATE_TEXT[state]}`}>{STATE_LABEL[state]}</span>}
      </div>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${STATE_TEXT[state]}`}>
        {count}
        <span className="ml-1 text-sm font-normal text-zinc-500">
          / {goal.floor ? `${goal.floor} floor` : ''}
          {goal.floor && goal.stretch ? ' · ' : ''}
          {goal.stretch ? `${goal.stretch} stretch` : ''}
        </span>
      </p>
      <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div className={`h-full rounded-full ${STATE_BAR[state]}`} style={{ width: `${pct}%` }} />
        {floorPct && <div className="absolute inset-y-0 w-0.5 bg-zinc-500/70" style={{ left: `${floorPct}%` }} title={`floor: ${goal.floor}`} />}
      </div>
      {p && p.need > 0 && (
        <p className="mt-2 text-xs text-zinc-500 tabular-nums">
          {p.perHour === null
            ? `${p.need} short of ${goal.floor ? 'floor' : 'target'} — day over`
            : `${p.need} to ${goal.floor ? 'floor' : 'target'} · ${p.perHour.toFixed(1)}/hr by 5pm`}
        </p>
      )}
    </div>
  )
}

// Full tracker view (#/activity): goals + pace, connect rate, today's log
// with per-row undo, and the day-by-day trend.
export default function ActivityPage({ tracker, onUndo, busy }) {
  // Re-render every minute so the pace math tracks the clock.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  if (!tracker) return <p className="mt-10 text-center text-sm text-zinc-500">Loading tracker…</p>

  const { goals, today, history } = tracker
  const counts = today.counts ?? {}
  const rate = connectRate(today)
  const goalTypes = Object.keys(goals).filter((t) => TYPE_LABELS[t])
  const outcomeCounts = today.activities.reduce((acc, a) => {
    if (a.outcome) acc[a.outcome] = (acc[a.outcome] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-bold tracking-tight">Activity</h1>
      <p className="mt-1 text-sm text-zinc-500">
        {formatDate(today.date)} · counts reset at midnight · log from the bar below on any page
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {goalTypes.map((type) => (
          <GoalCard key={type} type={type} count={counts[type] ?? 0} goal={goals[type]} now={now} />
        ))}

        <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <span className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">Connect rate</span>
          <p className="mt-1 text-2xl font-bold tabular-nums">
            {rate === null ? '—' : `${Math.round(rate * 100)}%`}
            <span className="ml-1 text-sm font-normal text-zinc-500">
              {today.outcome_calls ? `${today.connects}/${today.outcome_calls} dials` : 'no outcomes yet'}
            </span>
          </p>
          <p className="mt-2 text-xs text-zinc-500">
            {Object.entries(OUTCOME_LABELS)
              .map(([k, label]) => `${label} ${outcomeCounts[k] ?? 0}`)
              .join(' · ')}
          </p>
          <p className="mt-1 text-xs text-zinc-500">Replies {counts.reply ?? 0} · Meetings {counts.meeting ?? 0}</p>
        </div>
      </div>

      {today.activities.length > 0 && (
        <section className="mt-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-semibold tracking-wide text-zinc-500 uppercase">Today's log</h2>
          <ul className="mt-2 max-h-64 space-y-0.5 overflow-y-auto">
            {[...today.activities].reverse().map((a) => (
              <li key={a.id} className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                <span className="w-16 shrink-0 text-xs text-zinc-500 tabular-nums">
                  {new Date(a.ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                </span>
                <span className="font-medium">{TYPE_LABELS[a.type]}</span>
                {a.outcome && (
                  <span
                    className={
                      a.outcome === 'connect'
                        ? 'text-xs text-success-700 dark:text-success-400'
                        : 'text-xs text-zinc-500'
                    }
                  >
                    {OUTCOME_LABELS[a.outcome]}
                  </span>
                )}
                <button
                  disabled={busy}
                  onClick={() => onUndo(a.id)}
                  className="ml-auto text-xs text-zinc-400 hover:text-brand-500 disabled:opacity-50"
                  title="Remove this entry"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {history.length > 0 && (
        <section className="mt-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-semibold tracking-wide text-zinc-500 uppercase">Trend</h2>
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-zinc-500">
                <th className="py-1 font-normal">Day</th>
                <th className="py-1 font-normal">Calls</th>
                <th className="py-1 font-normal">Emails</th>
                <th className="py-1 font-normal">LI</th>
                <th className="py-1 font-normal">Vid</th>
                <th className="py-1 font-normal">InM</th>
                <th className="py-1 font-normal">Connect</th>
                <th className="py-1 font-normal">Mtgs</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {history.map((d) => {
                const callState = goalState(d.counts.call ?? 0, goals.call) ?? 'below'
                const emailState = goalState(d.counts.email ?? 0, goals.email) ?? 'below'
                return (
                  <tr key={d.date} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="py-1 text-xs text-zinc-500">{formatDate(d.date)}</td>
                    <td className={`py-1 ${STATE_TEXT[callState]}`}>{d.counts.call ?? 0}</td>
                    <td className={`py-1 ${STATE_TEXT[emailState]}`}>{d.counts.email ?? 0}</td>
                    <td className="py-1">{d.counts.linkedin ?? 0}</td>
                    <td className="py-1">{d.counts.video ?? 0}</td>
                    <td className="py-1">{d.counts.inmail ?? 0}</td>
                    <td className="py-1">{d.outcome_calls ? `${Math.round((d.connects / d.outcome_calls) * 100)}%` : '—'}</td>
                    <td className="py-1">{d.counts.meeting ?? 0}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
