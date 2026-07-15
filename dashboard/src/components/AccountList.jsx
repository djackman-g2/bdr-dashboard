import { useMemo } from 'react'
import Badge, { ConfidenceBadge } from './Badge.jsx'
import { relativeTime } from '../lib/format.js'

export default function AccountList({ index, query, onOpen }) {
  const accounts = index?.accounts ?? []

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return accounts
    return accounts.filter((a) =>
      [a.name, a.domain, a.industry, a.top_signal].filter(Boolean).some((f) => f.toLowerCase().includes(q)),
    )
  }, [accounts, query])

  if (!accounts.length) {
    return <p className="mt-10 text-center text-sm text-zinc-500">No accounts in the index yet.</p>
  }

  return (
    <div className="mt-4">
      <p className="mb-2 text-xs text-zinc-500">
        {filtered.length} of {accounts.length} account{accounts.length === 1 ? '' : 's'}
      </p>
      <ul className="space-y-2">
        {filtered.map((a) => (
          <li key={a.slug} className="[contain-intrinsic-size:auto_7rem] [content-visibility:auto]">
            <button
              onClick={() => onOpen(a.slug)}
              className="w-full rounded-lg border border-zinc-200 bg-white p-4 text-left transition hover:border-primary-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-primary-500"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-semibold">{a.name}</span>
                <span className="text-xs text-zinc-500">{a.domain}</span>
                {a.status === 'archived' && <Badge tone="gray">archived</Badge>}
                <ConfidenceBadge level={a.confidence} />
                <span className="ml-auto text-xs text-zinc-500" title={a.refreshed_at}>
                  refreshed {relativeTime(a.refreshed_at)}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                {a.industry && <span>{a.industry}</span>}
                {a.employees_display && <span>{a.employees_display} employees</span>}
              </div>
              {a.top_signal && <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">{a.top_signal}</p>}
            </button>
          </li>
        ))}
      </ul>
      {!filtered.length && (
        <p className="mt-10 text-center text-sm text-zinc-500">No accounts match “{query}”.</p>
      )}
    </div>
  )
}
