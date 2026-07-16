import { formatDate, relativeTime } from '../lib/format.js'

const TYPE_ICON = { call: '☏', email: '✉', task: '☑', event: '📅' }

function Touch({ label, item }) {
  if (!item) return null
  return (
    <div className="rounded border border-zinc-200 p-2 dark:border-zinc-700">
      <p className="text-xs font-medium text-zinc-500">
        {label}
        <span className="ml-2 font-normal" title={item.at}>{relativeTime(item.at)}</span>
      </p>
      <p className="mt-0.5 text-sm font-medium">{item.subject || '—'}</p>
      <p className="text-xs text-zinc-500">
        {item.owner && <>by {item.owner}</>}
        {item.who && <> → {item.who}</>}
      </p>
      {item.snippet && <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{item.snippet}</p>}
    </div>
  )
}

// Salesforce activity sidecar (written by fast "activity" runs — SOQL only,
// no credits, no cap slot). CRM touches are record activity, never proof of
// engagement or employment.
export default function SfActivity({ activity, onRefresh, refreshPending }) {
  const a = activity
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 flex items-center gap-2 border-l-2 border-brand-500 pl-2">
        <h2 className="text-sm font-semibold tracking-wide text-zinc-500 uppercase">SF activity</h2>
        {a?.retrieved_at && (
          <span className="text-xs text-zinc-500" title={a.retrieved_at}>as of {relativeTime(a.retrieved_at)}</span>
        )}
        {onRefresh && (
          <button
            onClick={() => onRefresh('activity')}
            disabled={refreshPending}
            title="Fast Salesforce-only pull: latest calls, emails, and meetings on this account (free — no enrichment credits, no deep-cap slot)"
            className="ml-auto rounded-md border border-primary-400 px-2 py-0.5 text-xs font-semibold text-primary-700 hover:bg-primary-600 hover:text-white disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-primary-700 dark:text-primary-300 dark:hover:text-white"
          >
            {refreshPending ? '⟳ queued…' : '⟳ refresh'}
          </button>
        )}
      </div>

      {!a && (
        <p className="text-sm text-zinc-500">
          No activity pulled yet — hit refresh for a fast Salesforce-only look at who last called or reached out
          (takes ~a minute, uses no credits).
        </p>
      )}

      {a?.error && (
        <p className="rounded border border-warning-300 bg-warning-50 p-2 text-sm text-warning-700 dark:border-warning-700 dark:bg-warning-700/20 dark:text-warning-300">
          {a.error}
        </p>
      )}

      {a && !a.error && (
        <div className="space-y-2">
          <Touch label="Last call" item={a.last_call} />
          <Touch label="Last outreach" item={a.last_outreach} />
          <Touch label="Last meeting" item={a.last_meeting} />
          {!a.last_call && !a.last_outreach && !a.last_meeting && (
            <p className="text-sm text-zinc-500">No completed activity on this account in Salesforce.</p>
          )}
          {a.activities?.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
                Recent activity ({a.activities.length})
              </summary>
              <ul className="mt-1.5 space-y-1.5">
                {a.activities.map((t, i) => (
                  <li key={i} className="flex gap-2 text-xs">
                    <span className="shrink-0 text-zinc-400" title={t.type}>{TYPE_ICON[t.type] ?? '·'}</span>
                    <span className="min-w-0">
                      <span className="font-medium">{t.subject || t.type}</span>
                      {t.scheduled && <span className="ml-1 rounded-full border border-zinc-300 px-1 text-[10px] text-zinc-500 dark:border-zinc-700">scheduled</span>}
                      <span className="text-zinc-500"> · {formatDate(t.at)}{t.owner && ` · ${t.owner}`}{t.who && ` → ${t.who}`}</span>
                      {t.snippet && <span className="block truncate text-zinc-500" title={t.snippet}>{t.snippet}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="text-[11px] text-zinc-500">CRM touches are record activity — not proof of engagement or employment.</p>
        </div>
      )}
    </section>
  )
}
