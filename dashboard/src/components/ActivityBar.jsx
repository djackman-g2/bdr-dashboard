import { useState } from 'react'
import { TYPE_LABELS, OUTCOME_LABELS, goalState, pace } from '../lib/tracker.js'

const STATE_TONE = {
  stretch: 'border-primary-400 bg-primary-100 text-primary-700 dark:border-primary-700 dark:bg-primary-950/60 dark:text-primary-300',
  floor: 'border-success-400 bg-success-100 text-success-700 dark:border-success-700 dark:bg-success-900/50 dark:text-success-300',
  below: 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800',
}

// Fixed one-tap logging strip, visible on every view (Groove has no API —
// speed of logging is the whole game). Tap = count it. Calls first ask the
// outcome (connect rate isn't in Groove and it's the best meeting predictor).
export default function ActivityBar({ tracker, onLog, onUndo, busy }) {
  const [pickingOutcome, setPickingOutcome] = useState(false)
  if (!tracker) return null
  const { goals, today, types } = tracker
  const counts = today.counts ?? {}
  const last = today.activities[today.activities.length - 1]
  const callPace = pace(counts.call ?? 0, goals.call?.floor)

  const log = (type, outcome) => {
    setPickingOutcome(false)
    onLog(type, outcome)
  }

  return (
    <footer className="shrink-0 border-t border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-1.5">
        {pickingOutcome ? (
          <>
            <span className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">Call outcome:</span>
            {Object.entries(OUTCOME_LABELS).map(([outcome, label]) => (
              <button
                key={outcome}
                disabled={busy}
                onClick={() => log('call', outcome)}
                className={`rounded-md border px-2.5 py-1 text-sm font-medium disabled:opacity-50 ${
                  outcome === 'connect'
                    ? 'border-success-400 bg-success-100 text-success-700 hover:bg-success-200 dark:border-success-700 dark:bg-success-900/50 dark:text-success-300'
                    : STATE_TONE.below
                }`}
              >
                {label}
              </button>
            ))}
            <button
              onClick={() => setPickingOutcome(false)}
              className="rounded-md px-2 py-1 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            >
              ✕ cancel
            </button>
          </>
        ) : (
          <>
            {types.map((type) => {
              const state = goalState(counts[type] ?? 0, goals[type]) ?? 'below'
              return (
                <button
                  key={type}
                  disabled={busy}
                  onClick={() => (type === 'call' ? setPickingOutcome(true) : log(type))}
                  title={goals[type] ? `${TYPE_LABELS[type]} — floor ${goals[type].floor ?? '—'} / stretch ${goals[type].stretch}` : TYPE_LABELS[type]}
                  className={`rounded-md border px-2.5 py-1 text-sm font-medium disabled:opacity-50 ${STATE_TONE[state]}`}
                >
                  {TYPE_LABELS[type]} <span className="tabular-nums opacity-80">{counts[type] ?? 0}</span>
                  {goals[type] && (
                    <span className="text-xs tabular-nums opacity-60">/{goals[type].floor ?? goals[type].stretch}</span>
                  )}
                </button>
              )
            })}
            <span className="ml-auto flex items-center gap-2 text-xs text-zinc-500">
              {callPace && callPace.need > 0 && callPace.perHour !== null && (
                <span className="tabular-nums">{callPace.perHour.toFixed(1)} calls/hr to floor by 5pm</span>
              )}
              {last && (
                <button
                  disabled={busy}
                  onClick={() => onUndo(last.id)}
                  title={`Undo last: ${TYPE_LABELS[last.type]}${last.outcome ? ` (${OUTCOME_LABELS[last.outcome]})` : ''}`}
                  className="rounded-md border border-zinc-300 px-2 py-0.5 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  ↩ undo {TYPE_LABELS[last.type].toLowerCase().replace(/s$/, '')}
                </button>
              )}
            </span>
          </>
        )}
      </div>
    </footer>
  )
}
