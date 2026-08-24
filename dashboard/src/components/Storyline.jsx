import { useEffect, useState } from 'react'
import Badge from './Badge.jsx'
import { formatDate } from '../lib/format.js'

// Storyline card — read-only view of data/accounts/<slug>.storyline.json: the
// account's one thesis (SPINE) split into per-contact CHAPTERS, plus the claims
// ledger that caps how a draft may reference a colleague and the verification
// gate. Same file the draft engine loads (GET /api/storyline/:accountId reuses
// its loader), so what shows here is what a draft was actually grounded on.
// Editing happens by hand in desktop sessions — nothing here writes.
//
// Most accounts have no storyline: 404 renders nothing at all.
const CHIP = {
  blocked: { tone: 'red', label: 'BLOCKED' },
  midflow: { tone: 'amber', label: 'mid-flow' },
  ready: { tone: 'green', label: 'ready' },
}

// Cast status is free text in a hand-authored file — match on content, not on
// an exact enum, and default to ready when the field is absent.
function castChip(status) {
  const s = (status ?? '').toUpperCase()
  if (s.includes('BLOCKED')) return CHIP.blocked
  if (s.includes('MID-FLOW') || s.includes('MID FLOW') || s.includes('MIDFLOW')) return CHIP.midflow
  return CHIP.ready
}

function VerificationItem({ item }) {
  const status = (item.status ?? '').toLowerCase()
  if (status === 'cleared') {
    return (
      <li className="text-sm text-success-700 dark:text-success-300">
        <span className="mr-1">✓</span>
        {item.item}
      </li>
    )
  }
  if (status === 'failed') {
    return (
      <li className="text-sm font-bold text-brand-700 dark:text-brand-300">
        <span className="mr-1">✕</span>
        {item.item}
        {item.fallback && <span className="font-normal"> — fallback: {item.fallback}</span>}
      </li>
    )
  }
  return (
    <li className="text-sm text-brand-700 dark:text-brand-300">
      <span className="mr-1">•</span>
      {item.item}
      {item.fallback && <span className="text-zinc-500"> — fallback: {item.fallback}</span>}
    </li>
  )
}

export default function Storyline({ slug, serverUp }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!serverUp) return
    let live = true
    setData(null)
    setError(null)
    ;(async () => {
      try {
        const res = await fetch(`/api/storyline/${encodeURIComponent(slug)}`)
        if (res.status === 404) return // no storyline for this account — card stays hidden
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error ?? `HTTP ${res.status}`)
        }
        const json = await res.json()
        if (live) setData(json)
      } catch (err) {
        if (live) setError(err.message)
      }
    })()
    return () => {
      live = false
    }
  }, [slug, serverUp])

  if (error) {
    return (
      <section className="rounded-lg border border-warning-300 bg-warning-50 p-3 text-xs text-warning-700 dark:border-warning-700 dark:bg-warning-700/20 dark:text-warning-300">
        Storyline failed to load: {error}
      </section>
    )
  }
  if (!data) return null

  const cast = data.cast ?? []
  const ledger = data.claims_ledger ?? []
  const verification = data.verification ?? []
  const pending = verification.filter((v) => (v.status ?? '').toLowerCase() === 'pending')

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 flex flex-wrap items-center gap-2 border-l-2 border-brand-500 pl-2">
        <h2 className="text-sm font-semibold tracking-wide text-zinc-500 uppercase">Storyline</h2>
        {data.mode && (
          <Badge
            tone={data.mode === 'full_custom' ? 'blue' : 'gray'}
            title={
              data.mode === 'full_custom'
                ? 'Every email step is drafted — the storyline carries the whole arc'
                : 'Groove templates own the flow; the storyline fires in the free slots'
            }
          >
            {data.mode}
          </Badge>
        )}
        {data.created && <span className="text-xs text-zinc-500">created {formatDate(data.created)}</span>}
        {data.ae_owner && <span className="text-xs text-zinc-500">AE: {data.ae_owner}</span>}
      </div>

      {/* Pending verification is a pre-send gate — it leads the card. */}
      {pending.length > 0 && (
        <p className="mb-3 rounded border border-brand-300 bg-brand-100 p-2 text-sm font-medium text-brand-700 dark:border-brand-900 dark:bg-brand-950 dark:text-brand-300">
          {pending.length} verification item{pending.length === 1 ? '' : 's'} pending — check before sending
        </p>
      )}

      {data.spine && <p className="text-sm text-zinc-600 dark:text-zinc-400">{data.spine}</p>}

      {cast.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-zinc-500">Cast</p>
          {/* Wide table scrolls inside its own box — the page never scrolls sideways. */}
          <div className="mt-1 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-zinc-500">
                  <th className="py-1 pr-3 font-medium">Contact</th>
                  <th className="py-1 pr-3 font-medium">Chapter</th>
                  <th className="py-1 pr-3 font-medium">Angle</th>
                  <th className="py-1 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {cast.map((c, i) => {
                  const chip = castChip(c.status)
                  return (
                    <tr key={i} className="border-t border-zinc-200 align-top dark:border-zinc-800">
                      <td className="py-1.5 pr-3">
                        <span className="font-medium">{c.contact}</span>
                        {c.title && <span className="block text-xs text-zinc-500">{c.title}</span>}
                      </td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">
                        <span className="font-mono text-xs">{c.chapter}</span>
                      </td>
                      <td className="py-1.5 pr-3 text-zinc-600 dark:text-zinc-400">{c.chapter_angle}</td>
                      <td className="py-1.5">
                        <Badge tone={chip.tone} title={c.status || undefined}>
                          {chip.label}
                        </Badge>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {ledger.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-zinc-500">
            Claims ledger{' '}
            <span className="font-normal">
              — a draft may only reference a colleague at this state's phrasing, never beyond it
            </span>
          </p>
          <ul className="mt-1 space-y-2">
            {ledger.map((c, i) => (
              <li key={i} className="rounded border border-zinc-200 p-2 dark:border-zinc-700">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{c.colleague}</span>
                  <Badge tone="gray">{c.state}</Badge>
                </div>
                {c.allowed && <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">“{c.allowed}”</p>}
                {c.requires && <p className="mt-0.5 text-xs text-warning-700 dark:text-warning-300">requires: {c.requires}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {verification.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-zinc-500">Verification gate</p>
          <ul className="mt-1 space-y-1">
            {verification.map((v, i) => (
              <VerificationItem key={i} item={v} />
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
