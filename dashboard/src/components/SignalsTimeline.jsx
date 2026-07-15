import { useMemo, useState } from 'react'
import Badge from './Badge.jsx'
import { formatDate, daysAgo } from '../lib/format.js'

const RANGES = [
  { key: '7', label: '7d', days: 7 },
  { key: '30', label: '30d', days: 30 },
  { key: '90', label: '90d', days: 90 },
  { key: 'all', label: 'All', days: Infinity },
  { key: 'custom', label: 'Custom' },
]

const TYPE_TONES = {
  funding: 'green',
  product_launch: 'blue',
  partnership: 'blue',
  hiring: 'green',
  intent_surge: 'amber',
  layoffs: 'red',
  leadership_change: 'amber',
  acquisition: 'blue',
}

// Rule 10: signals arrive as timestamped events; all range filtering happens here, client-side.
export default function SignalsTimeline({ signals }) {
  const [range, setRange] = useState('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const filtered = useMemo(() => {
    const sorted = [...(signals ?? [])].sort((a, b) => (a.date < b.date ? 1 : -1))
    if (range === 'custom') {
      return sorted.filter(
        (s) => (!customFrom || s.date >= customFrom) && (!customTo || s.date <= customTo),
      )
    }
    const { days } = RANGES.find((r) => r.key === range)
    return sorted.filter((s) => daysAgo(s.date) <= days)
  }, [signals, range, customFrom, customTo])

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`px-2.5 py-1 text-xs font-medium ${
                range === r.key
                  ? 'bg-primary-600 text-white dark:bg-primary-400 dark:text-primary-950'
                  : 'bg-white text-zinc-600 hover:bg-primary-100 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        {range === 'custom' && (
          <span className="flex items-center gap-1 text-xs">
            <input
              type="date"
              aria-label="From date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 dark:border-zinc-700 dark:bg-zinc-900"
            />
            –
            <input
              type="date"
              aria-label="To date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </span>
        )}
        <span className="text-xs text-zinc-500">
          {filtered.length} of {signals?.length ?? 0} events
        </span>
      </div>

      <ul className="mt-3 space-y-3">
        {filtered.map((s, i) => (
          <li key={i} className="flex gap-3">
            <div className="w-20 shrink-0 pt-0.5 text-xs text-zinc-500">{formatDate(s.date)}</div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={TYPE_TONES[s.type] || 'gray'}>{s.type}</Badge>
                {s.source_url ? (
                  <a
                    href={s.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-info-500 hover:text-info-600 hover:underline dark:text-info-400"
                  >
                    {s.source_name || 'source'}
                  </a>
                ) : (
                  s.source_name && <span className="text-xs text-zinc-500">{s.source_name}</span>
                )}
              </div>
              <p className="mt-1 text-sm">{s.summary}</p>
              {s.probe && (
                <p className="mt-1 text-sm text-zinc-500 italic">
                  <span className="font-medium not-italic text-zinc-600 dark:text-zinc-400">Probe: </span>
                  {s.probe}
                </p>
              )}
            </div>
          </li>
        ))}
        {!filtered.length && <li className="text-sm text-zinc-500">No signals in this range.</li>}
      </ul>
    </div>
  )
}
