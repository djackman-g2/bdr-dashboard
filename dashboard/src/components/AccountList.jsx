import { useMemo, useState } from 'react'
import { relativeTime } from '../lib/format.js'

// Confidence as a quiet dot — the rail is scanned, not read.
const CONFIDENCE_DOT = {
  high: 'bg-success-500',
  medium: 'bg-warning-500',
  low: 'bg-brand-400',
}

// "All" = the working book. Archived accounts (left the BDR universe — e.g.
// the FY27 reassignment wave) are kept forever but only shown on their own tab.
const STATUS_FILTERS = [
  { key: 'all', label: 'All', match: (a) => a.status !== 'archived' },
  { key: 'researched', label: 'Researched', match: (a) => a.status === 'active' },
  { key: 'pending', label: 'Pending', match: (a) => a.status === 'pending_research' },
  { key: 'archived', label: 'Archived', match: (a) => a.status === 'archived' },
]

export default function AccountList({ index, query, selected, onOpen }) {
  const accounts = index?.accounts ?? []
  const [statusKey, setStatusKey] = useState('all')
  const [industry, setIndustry] = useState('')

  const industries = useMemo(
    () => [...new Set(accounts.map((a) => a.industry).filter(Boolean))].sort(),
    [accounts]
  )

  const statusMatch = STATUS_FILTERS.find((s) => s.key === statusKey)?.match ?? (() => true)
  // Denominator for the count line: the current tab's population, so search/
  // industry narrowing reads as "x of <tab total>", never inflated by archived.
  const baseTotal = useMemo(() => accounts.filter(statusMatch).length, [accounts, statusKey])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return accounts.filter(
      (a) =>
        statusMatch(a) &&
        (!industry || a.industry === industry) &&
        (!q || [a.name, a.domain, a.industry, a.top_signal].filter(Boolean).some((f) => f.toLowerCase().includes(q)))
    )
  }, [accounts, query, statusKey, industry])

  if (!accounts.length) {
    return <p className="mt-10 text-center text-sm text-zinc-500">No accounts in the index yet.</p>
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1 px-3 pt-2">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s.key}
            onClick={() => setStatusKey(s.key)}
            aria-pressed={statusKey === s.key}
            className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition ${
              statusKey === s.key
                ? 'border-primary-500 bg-primary-100 text-primary-700 dark:border-primary-500 dark:bg-primary-950/60 dark:text-primary-300'
                : 'border-zinc-300 text-zinc-500 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-500'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="px-3 pt-1.5">
        <select
          value={industry}
          onChange={(e) => setIndustry(e.target.value)}
          aria-label="Filter by industry"
          className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-600 outline-none focus:border-primary-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400 dark:focus:border-primary-400"
        >
          <option value="">All industries</option>
          {industries.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
      </div>
      <p className="px-3 pt-2 pb-1 text-[11px] text-zinc-500">
        {filtered.length} of {baseTotal} account{baseTotal === 1 ? '' : 's'}
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
