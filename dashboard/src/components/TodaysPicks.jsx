import { relativeTime } from '../lib/format.js'

const TIER_LABEL = {
  open_opp: { text: 'open opp', cls: 'border-success-300 bg-success-100 text-success-700 dark:border-success-700 dark:bg-success-900/60 dark:text-success-300' },
  g2_intent: { text: 'G2 intent', cls: 'border-primary-300 bg-primary-100 text-primary-700 dark:border-primary-700 dark:bg-primary-950/60 dark:text-primary-300' },
  recent_activity: { text: 'recent CRM', cls: 'border-info-300 bg-info-100 text-info-700 dark:border-info-700 dark:bg-info-950/60 dark:text-info-300' },
  alphabetical: { text: 'backlog', cls: 'border-zinc-300 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400' },
}

// The nightly run ranks pending-research accounts and writes the shortlist to
// data/suggestions.json (auto_queue_deep=false). This panel is the morning
// picks workflow: review, then queue the ones worth today's cap slots.
export default function TodaysPicks({ suggestions, index, onOpen, onQueue, jobFor, deepCap }) {
  if (!suggestions?.suggestions?.length) return null

  // Hide rows already researched (or archived) since the list was generated.
  const stillPending = new Set(
    (index?.accounts ?? []).filter((a) => a.status === 'pending_research').map((a) => a.slug)
  )
  const rows = suggestions.suggestions.filter((s) => stillPending.has(s.slug))
  if (!rows.length) return null

  const capLeft = deepCap ? Math.max(0, deepCap.cap - deepCap.used - deepCap.pending) : null

  return (
    <section className="mt-4 rounded-lg border border-primary-300/60 bg-primary-50/40 p-4 dark:border-primary-800 dark:bg-primary-950/30">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold">Today's picks</h2>
        <span className="text-xs text-zinc-500" title={suggestions.generated_at}>
          ranked {relativeTime(suggestions.generated_at)}
          {typeof suggestions.pending_total === 'number' && ` · ${suggestions.pending_total} pending`}
        </span>
        {capLeft !== null && (
          <span className="ml-auto text-xs text-zinc-500">{capLeft} deep slot{capLeft === 1 ? '' : 's'} left today</span>
        )}
      </div>
      <ul className="divide-y divide-primary-200/60 dark:divide-primary-900/60">
        {rows.map((s) => {
          const tier = TIER_LABEL[s.tier] ?? TIER_LABEL.alphabetical
          const pending = jobFor?.(s.domain)
          return (
            <li key={s.slug} className="flex items-center gap-3 py-2">
              <button
                onClick={() => onOpen(s.slug)}
                className="shrink-0 text-sm font-semibold hover:text-primary-600 hover:underline dark:hover:text-primary-400"
              >
                {s.name}
              </button>
              <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${tier.cls}`}>{tier.text}</span>
              <span className="min-w-0 truncate text-xs text-zinc-500" title={s.reason}>{s.reason}</span>
              {onQueue && (
                <button
                  onClick={() => onQueue(s.domain)}
                  disabled={pending || capLeft === 0}
                  title={capLeft === 0 ? 'Daily deep cap reached' : 'Queue deep research (no LinkedIn — use the account page for that)'}
                  className="ml-auto shrink-0 rounded-md border border-brand-400 px-2 py-0.5 text-xs font-semibold text-brand-600 hover:bg-brand-500 hover:text-white disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-brand-600 dark:text-brand-400 dark:hover:text-white"
                >
                  {pending ? '⟳ queued' : '⟳ deep'}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
