import { useMemo } from 'react'
import { relativeTime } from '../lib/format.js'

// Confidence as a quiet dot — the rail is scanned, not read.
const CONFIDENCE_DOT = {
  high: 'bg-success-500',
  medium: 'bg-warning-500',
  low: 'bg-brand-400',
}

export default function AccountList({ index, query, selected, onOpen }) {
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
    <div>
      <p className="px-3 pt-2 pb-1 text-[11px] text-zinc-500">
        {filtered.length} of {accounts.length} account{accounts.length === 1 ? '' : 's'}
      </p>
      <ul>
        {filtered.map((a) => {
          const isSel = a.slug === selected
          return (
            <li key={a.slug} className="[contain-intrinsic-size:auto_4.25rem] [content-visibility:auto]">
              <button
                onClick={() => onOpen(a.slug)}
                aria-current={isSel ? 'page' : undefined}
                className={`w-full border-l-2 px-3 py-2 text-left transition ${
                  isSel
                    ? 'border-brand-500 bg-zinc-100 dark:bg-zinc-800/70'
                    : 'border-transparent hover:bg-zinc-50 dark:hover:bg-zinc-800/40'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    title={a.confidence ? `confidence: ${a.confidence}` : 'not researched yet'}
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${CONFIDENCE_DOT[a.confidence] ?? 'bg-zinc-300 dark:bg-zinc-600'}`}
                  />
                  <span className="truncate text-sm font-semibold">{a.name}</span>
                  {a.status === 'archived' && (
                    <span className="shrink-0 rounded-full border border-zinc-300 px-1 text-[10px] text-zinc-500 dark:border-zinc-700">
                      archived
                    </span>
                  )}
                  <span className="ml-auto shrink-0 text-[10px] text-zinc-500" title={a.refreshed_at}>
                    {a.refreshed_at ? relativeTime(a.refreshed_at) : 'pending'}
                  </span>
                </div>
                <div className="mt-0.5 truncate pl-3.5 text-xs text-zinc-500">
                  {a.domain}
                  {a.industry && ` · ${a.industry}`}
                </div>
                {a.top_signal && (
                  <p className="mt-0.5 truncate pl-3.5 text-xs text-zinc-600 dark:text-zinc-400">{a.top_signal}</p>
                )}
              </button>
            </li>
          )
        })}
      </ul>
      {!filtered.length && (
        <p className="mt-10 px-3 text-center text-sm text-zinc-500">No accounts match “{query}”.</p>
      )}
    </div>
  )
}
