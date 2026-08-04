import { useRef, useState } from 'react'
import { TYPE_LABELS, OUTCOME_LABELS, goalState, pace } from '../lib/tracker.js'

const STATE_TONE = {
  stretch: 'border-primary-400 bg-primary-100 text-primary-700 dark:border-primary-700 dark:bg-primary-950/60 dark:text-primary-300',
  floor: 'border-success-400 bg-success-100 text-success-700 dark:border-success-700 dark:bg-success-900/50 dark:text-success-300',
  below: 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800',
}

const LONG_PRESS_MS = 500

// Fixed one-tap logging strip, visible on every view (Groove has no API —
// speed of logging is the whole game). Tap = count it. LONG-PRESS = also
// attach to the targeted contact (sets lastTouch, advances its step when it
// has a hook). Calls first ask the outcome (connect rate isn't in Groove and
// it's the best meeting predictor).
export default function ActivityBar({ tracker, targetContact, onClearTarget, onLog, onUndo, busy }) {
  // pickingOutcome: false | {attach: boolean}
  const [pickingOutcome, setPickingOutcome] = useState(false)
  const timer = useRef(null)
  const firedLong = useRef(false)
  if (!tracker) return null
  const { goals, today, types } = tracker
  const counts = today.counts ?? {}
  const last = today.activities[today.activities.length - 1]
  const callPace = pace(counts.call ?? 0, goals.call?.floor)

  const log = (type, outcome, attach) => {
    setPickingOutcome(false)
    onLog(type, outcome, attach && targetContact ? targetContact.id : undefined)
  }
  const fire = (type, attach) => (type === 'call' ? setPickingOutcome({ attach }) : log(type, undefined, attach))

  // Long-press via pointer events (mouse + touch). The click that follows a
  // completed long-press is swallowed by firedLong.
  const press = {
    onPointerDown: (type) => () => {
      firedLong.current = false
      timer.current = setTimeout(() => {
        firedLong.current = true
        fire(type, true)
      }, LONG_PRESS_MS)
    },
    cancel: () => clearTimeout(timer.current),
    onClick: (type) => () => {
      clearTimeout(timer.current)
      if (!firedLong.current) fire(type, false)
      firedLong.current = false
    },
  }

  return (
    <footer className="shrink-0 border-t border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-1.5">
        {pickingOutcome ? (
          <>
            <span className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
              Call outcome{pickingOutcome.attach && targetContact ? ` → ${targetContact.name ?? 'contact'}` : ''}:
            </span>
            {Object.entries(OUTCOME_LABELS).map(([outcome, label]) => (
              <button
                key={outcome}
                disabled={busy}
                onClick={() => log('call', outcome, pickingOutcome.attach)}
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
                  onPointerDown={press.onPointerDown(type)}
                  onPointerUp={press.cancel}
                  onPointerLeave={press.cancel}
                  onPointerCancel={press.cancel}
                  onClick={press.onClick(type)}
                  onContextMenu={(e) => e.preventDefault()}
                  title={`${TYPE_LABELS[type]}${goals[type] ? ` — floor ${goals[type].floor ?? '—'} / stretch ${goals[type].stretch}` : ''}${
                    targetContact ? ` · long-press to log to ${targetContact.name ?? 'target'}` : ''
                  }`}
                  className={`rounded-md border px-2.5 py-1 text-sm font-medium select-none disabled:opacity-50 ${STATE_TONE[state]}`}
                >
                  {TYPE_LABELS[type]} <span className="tabular-nums opacity-80">{counts[type] ?? 0}</span>
                  {goals[type] && (
                    <span className="text-xs tabular-nums opacity-60">/{goals[type].floor ?? goals[type].stretch}</span>
                  )}
                </button>
              )
            })}
            {targetContact && (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-primary-400 bg-primary-100 px-2 py-0.5 text-xs text-primary-700 dark:border-primary-700 dark:bg-primary-950/60 dark:text-primary-300"
                title="Long-press an activity button to log to this contact"
              >
                → {targetContact.name ?? 'unnamed contact'}
                <button onClick={onClearTarget} aria-label="Clear target contact" className="opacity-60 hover:opacity-100">
                  ✕
                </button>
              </span>
            )}
            <span className="ml-auto flex items-center gap-2 text-xs text-zinc-500">
              {today.spread && (
                <span
                  title={`Prospecting spread — add ~${today.spread.goal_people} NEW people from ~${today.spread.goal_accounts} DIFFERENT accounts today instead of grinding one account. Counts contacts added to the tracker today.`}
                  className={`rounded-md border px-2 py-0.5 tabular-nums ${
                    today.spread.accounts >= today.spread.goal_accounts
                      ? 'border-success-400 bg-success-100 text-success-700 dark:border-success-700 dark:bg-success-900/50 dark:text-success-300'
                      : 'border-zinc-300 dark:border-zinc-700'
                  }`}
                >
                  new adds {today.spread.people} ppl · {today.spread.accounts} accts
                  <span className="opacity-60"> / goal {today.spread.goal_people}×{today.spread.goal_accounts}</span>
                </span>
              )}
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
