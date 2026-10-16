import { useMemo, useState } from 'react'
import { relativeTime } from '../lib/format.js'

// Confidence as a quiet dot — the rail is scanned, not read.
const CONFIDENCE_DOT = {
  high: 'bg-success-500',
  medium: 'bg-warning-500',
  low: 'bg-brand-400',
}

// An open opportunity means the account holds an AE's live deal — prospecting into
// it steps on Sean or Nick, so it is not a working account. `open_opps` is stamped by
// the nightly light run (Step 2b). ABSENT is deliberately NOT treated as clear: a
// missing field means "never checked", and hiding on unknown would make accounts
// disappear for the wrong reason. Only a non-empty array hides a row.
const hasOpenOpp = (a) => Array.isArray(a.open_opps) && a.open_opps.length > 0

const money = (n) =>
  typeof n === 'number' ? `$${Math.round(n).toLocaleString('en-US')}` : null

// Tooltip names the AE first — the point of the badge is "whose deal is this".
const openOppTitle = (a) =>
  a.open_opps
    .map((o) => [o.owner, o.name, o.stage, money(o.amount), o.close_date && `closes ${o.close_date}`].filter(Boolean).join(' · '))
    .join('\n')

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
  const [showOpenOpps, setShowOpenOpps] = useState(false)

  const industries = useMemo(
    () => [...new Set(accounts.map((a) => a.industry).filter(Boolean))].sort(),
    [accounts]
  )

  const statusMatch = STATUS_FILTERS.find((s) => s.key === statusKey)?.match ?? (() => true)
  // Denominator for the count line: the current tab's population, so search/
  // industry narrowing reads as "x of <tab total>", never inflated by archived.
  const baseTotal = useMemo(
    () => accounts.filter((a) => statusMatch(a) && (showOpenOpps || !hasOpenOpp(a))).length,
    [accounts, statusKey, showOpenOpps]
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return accounts.filter(
      (a) =>
        statusMatch(a) &&
        (showOpenOpps || !hasOpenOpp(a)) &&
        (!industry || a.industry === industry) &&
        (!q || [a.name, a.domain, a.industry, a.top_signal].filter(Boolean).some((f) => f.toLowerCase().includes(q)))
    )
  }, [accounts, query, statusKey, industry, showOpenOpps])

  // Surfaced as a count, never silent — an account vanishing with no explanation is
  // worse than one shown with a warning on it.
  const hiddenByOpp = useMemo(
    () => (showOpenOpps ? 0 : accounts.filter((a) => statusMatch(a) && hasOpenOpp(a)).length),
    [accounts, statusKey, showOpenOpps]
  )

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
      <p className="flex flex-wrap items-baseline gap-x-1.5 px-3 pt-2 pb-1 text-[11px] text-zinc-500">
        <span>
          {filtered.length} of {baseTotal} account{baseTotal === 1 ? '' : 's'}
        </span>
        {(hiddenByOpp > 0 || showOpenOpps) && (
          <button
            onClick={() => setShowOpenOpps((v) => !v)}
            aria-pressed={showOpenOpps}
            title="Accounts with an open opportunity belong to the AE — prospecting into them steps on Sean or Nick. Closed-Lost accounts are not hidden (winback)."
            className="text-brand-600 underline decoration-dotted underline-offset-2 hover:text-brand-500 dark:text-brand-400"
          >
            {showOpenOpps ? 'hide open opps' : `${hiddenByOpp} hidden · open opp`}
          </button>
        )}
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
                  {hasOpenOpp(a) && (
                    <span
                      title={openOppTitle(a)}
                      className="shrink-0 rounded-full border border-brand-500 px-1 text-[10px] font-medium text-brand-600 dark:text-brand-400"
                    >
                      open opp
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
