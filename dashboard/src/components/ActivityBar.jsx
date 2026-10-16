import { useRef } from 'react'
import { TYPE_LABELS } from '../lib/tracker.js'

const BTN_TONE =
  'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800'

const LONG_PRESS_MS = 500

// Fixed one-tap logging strip, visible on every view. Tap = count it.
// LONG-PRESS = also attach to the targeted contact (sets lastTouch, advances
// its step when it has a hook). Groove is the system of record for activity
// stats — this bar is just the fastest way to attach a touch to a contact.
export default function ActivityBar({ tracker, targetContact, onClearTarget, onLog, onUndo, busy }) {
  const timer = useRef(null)
  const firedLong = useRef(false)
  if (!tracker) return null
  const { today, types } = tracker
  const counts = today.counts ?? {}
  const last = today.activities[today.activities.length - 1]

  const log = (type, attach) => onLog(type, attach && targetContact ? targetContact.id : undefined)

  // Long-press via pointer events (mouse + touch). The click that follows a
  // completed long-press is swallowed by firedLong.
  const press = {
    onPointerDown: (type) => () => {
      firedLong.current = false
      timer.current = setTimeout(() => {
        firedLong.current = true
        log(type, true)
      }, LONG_PRESS_MS)
    },
    cancel: () => clearTimeout(timer.current),
    onClick: (type) => () => {
      clearTimeout(timer.current)
      if (!firedLong.current) log(type, false)
      firedLong.current = false
    },
  }

  return (
    <footer className="shrink-0 border-t border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-1.5">
        {types.map((type) => (
          <button
            key={type}
            disabled={busy}
            onPointerDown={press.onPointerDown(type)}
            onPointerUp={press.cancel}
            onPointerLeave={press.cancel}
            onPointerCancel={press.cancel}
            onClick={press.onClick(type)}
            onContextMenu={(e) => e.preventDefault()}
            title={`${TYPE_LABELS[type]}${targetContact ? ` · long-press to log to ${targetContact.name ?? 'target'}` : ''}`}
            className={`rounded-md border px-2.5 py-1 text-sm font-medium select-none disabled:opacity-50 ${BTN_TONE}`}
          >
            {TYPE_LABELS[type]} <span className="tabular-nums opacity-80">{counts[type] ?? 0}</span>
          </button>
        ))}
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
          {last && (
            <button
              disabled={busy}
              onClick={() => onUndo(last.id)}
              title={`Undo last: ${TYPE_LABELS[last.type]}`}
              className="rounded-md border border-zinc-300 px-2 py-0.5 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              ↩ undo {TYPE_LABELS[last.type].toLowerCase().replace(/s$/, '')}
            </button>
          )}
        </span>
      </div>
    </footer>
  )
}
