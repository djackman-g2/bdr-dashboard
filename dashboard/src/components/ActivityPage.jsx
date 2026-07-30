import { useEffect, useMemo, useState } from 'react'
import { TYPE_LABELS, OUTCOME_LABELS, goalState, pace, connectRate, patchTrackerContact, watchTrackerContact, personaLabel } from '../lib/tracker.js'
import { formatDate, relativeTime } from '../lib/format.js'
import AutoGrowTextarea from './AutoGrowTextarea.jsx'

const STATE_TEXT = {
  stretch: 'text-primary-700 dark:text-primary-300',
  floor: 'text-success-700 dark:text-success-400',
  below: 'text-zinc-700 dark:text-zinc-300',
}
const STATE_BAR = { stretch: 'bg-primary-500', floor: 'bg-success-500', below: 'bg-warning-500' }
const STATE_LABEL = { stretch: 'stretch hit', floor: 'above floor', below: null }

// One goal card. The bar runs to the stretch target with a tick at the floor,
// so 55/60 calls reads "above floor", not "missed stretch".
function GoalCard({ type, count, goal, now }) {
  const state = goalState(count, goal)
  const target = goal.stretch ?? goal.floor
  const pct = Math.min((count / target) * 100, 100)
  const floorPct = goal.floor && goal.stretch ? (goal.floor / goal.stretch) * 100 : null
  const p = pace(count, goal.floor ?? goal.stretch, now)
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">{TYPE_LABELS[type]}</span>
        {STATE_LABEL[state] && <span className={`text-xs font-medium ${STATE_TEXT[state]}`}>{STATE_LABEL[state]}</span>}
      </div>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${STATE_TEXT[state]}`}>
        {count}
        <span className="ml-1 text-sm font-normal text-zinc-500">
          / {goal.floor ? `${goal.floor} floor` : ''}
          {goal.floor && goal.stretch ? ' · ' : ''}
          {goal.stretch ? `${goal.stretch} stretch` : ''}
        </span>
      </p>
      <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div className={`h-full rounded-full ${STATE_BAR[state]}`} style={{ width: `${pct}%` }} />
        {floorPct && <div className="absolute inset-y-0 w-0.5 bg-zinc-500/70" style={{ left: `${floorPct}%` }} title={`floor: ${goal.floor}`} />}
      </div>
      {p && p.need > 0 && (
        <p className="mt-2 text-xs text-zinc-500 tabular-nums">
          {p.perHour === null
            ? `${p.need} short of ${goal.floor ? 'floor' : 'target'} — day over`
            : `${p.need} to ${goal.floor ? 'floor' : 'target'} · ${p.perHour.toFixed(1)}/hr by 5pm`}
        </p>
      )}
    </div>
  )
}

const watchInputCls =
  'w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm outline-none hover:border-zinc-300 focus:border-primary-500 focus:bg-white dark:hover:border-zinc-700 dark:focus:bg-zinc-950'

// One watchlist row — a hand-picked contact worth tracking closely (usually
// out-of-flow or high-stakes). Flow state / last touch / replied come from
// the Groove mirror; next move + notes are the dashboard-only fields.
function WatchRow({ c, o, accountName, busy, onPatch, targeted, onTarget }) {
  const [draft, setDraft] = useState({ nextAction: c.nextAction ?? '', notes: c.notes ?? '' })
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }))
  const save = (k) => () => {
    const v = draft[k].trim()
    if (v === (c[k] ?? '')) return
    onPatch(c.id, { [k]: v || null })
  }
  const inFlow = o?.flow != null || o?.flow_day != null
  const lastTouch = [c.lastTouch, o?.last_outbound].filter(Boolean).sort().pop()
  const overdue = c.nextDate && c.nextDate < new Date().toLocaleDateString('en-CA') && c.status !== 'dead'

  return (
    <tr className="border-t border-zinc-100 align-top hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/40">
      <td className="py-1 pr-1">
        <button
          onClick={() => onTarget(c.id)}
          disabled={busy}
          title={targeted ? 'Activity target — long-press a bar button to log to this contact' : 'Set as activity target'}
          aria-label={targeted ? 'Clear activity target' : 'Set as activity target'}
          className={targeted ? 'text-primary-600 dark:text-primary-400' : 'text-zinc-300 hover:text-primary-500 dark:text-zinc-600'}
        >
          {targeted ? '◉' : '◎'}
        </button>
      </td>
      <td className="min-w-32 py-1 pr-2">
        <span className="text-sm font-medium">{c.name ?? 'unnamed'}</span>
        <div className="text-[11px] text-zinc-500">
          {accountName}
          {c.persona ? ` · ${personaLabel(c.persona)}` : ''}
        </div>
      </td>
      <td className="py-1 pr-2 text-xs whitespace-nowrap">
        {inFlow ? (
          <span className="text-primary-600 dark:text-primary-400" title={o.flow ?? 'Groove flow'}>
            in flow{o.flow_day != null ? ` · day ${o.flow_day}` : ''}
          </span>
        ) : (
          <span className="text-zinc-400">out of flow</span>
        )}
        {o?.replied && (
          <div className="mt-0.5 inline-block rounded-full border border-success-400 bg-success-100 px-1.5 text-[10px] text-success-700 dark:border-success-700 dark:bg-success-900/50 dark:text-success-300">
            ✉ replied
          </div>
        )}
      </td>
      <td className="py-1 pr-2 text-xs whitespace-nowrap text-zinc-500">{lastTouch ? relativeTime(lastTouch) : '—'}</td>
      <td className="min-w-32 py-1 pr-2">
        {inFlow ? (
          <span
            className="block px-1 py-0.5 text-sm text-zinc-600 dark:text-zinc-400"
            title={`Groove owns this schedule${o.flow ? ` (${o.flow})` : ''} — auto-stamped by the due-list upload`}
          >
            {c.nextAction ?? 'in flow'}
          </span>
        ) : (
          <input
            value={draft.nextAction}
            onChange={set('nextAction')}
            onBlur={save('nextAction')}
            placeholder="next move"
            aria-label="Next move"
            className={watchInputCls}
          />
        )}
      </td>
      <td className="py-1 pr-2 whitespace-nowrap">
        {inFlow ? (
          <span className={`text-xs tabular-nums ${overdue ? 'text-brand-600 dark:text-brand-300' : 'text-zinc-500'}`}>{c.nextDate ?? '—'}</span>
        ) : (
          <input
            type="date"
            value={c.nextDate ?? ''}
            onChange={(e) => onPatch(c.id, { nextDate: e.target.value || null })}
            aria-label="Next date"
            className={`rounded border border-zinc-300 bg-white px-1 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-950 ${
              overdue ? 'border-brand-400 text-brand-600 dark:text-brand-300' : ''
            }`}
          />
        )}
      </td>
      <td className="min-w-48 py-1 pr-2">
        <AutoGrowTextarea
          value={draft.notes}
          onChange={set('notes')}
          onBlur={save('notes')}
          placeholder="notes — context Groove doesn't hold"
          aria-label="Notes"
          className={watchInputCls}
        />
      </td>
      <td className="py-1 text-right whitespace-nowrap">
        <button
          onClick={() => onPatch(c.id, { watch: false })}
          disabled={busy}
          title="Remove from watchlist (contact row stays in Accounts)"
          aria-label="Remove from watchlist"
          className="text-warning-500 hover:text-zinc-400"
        >
          ★
        </button>
      </td>
    </tr>
  )
}

// Contact-first add: search everyone actually being touched — tracker rows
// AND the full Groove mirror — and pin them from here, no account setup.
// Mirror-only picks get their tracker account/contact rows created
// server-side (POST /api/tracker/watch).
function WatchSearch({ tracker, outreach, accountName, busy, onWatch }) {
  const [q, setQ] = useState('')

  const candidates = useMemo(() => {
    const trackerRows = tracker.contacts
      .filter((c) => !c.watch && c.name)
      .map((c) => ({
        key: c.id,
        payload: { contactId: c.id },
        name: c.name,
        title: c.title,
        account: accountName.get(c.accountId) ?? c.accountId,
        source: 'tracker',
      }))
    // Mirror contacts that already have a tracker row show up as that row —
    // only list the ones the working layer hasn't seen yet.
    const seenSf = new Set(tracker.contacts.map((c) => c.sfContactId).filter(Boolean))
    const seenName = new Set(tracker.contacts.filter((c) => c.name).map((c) => c.name.toLowerCase()))
    const mirrorRows = (outreach?.contacts ?? [])
      .filter((o) => o.sf_contact_id && !seenSf.has(o.sf_contact_id) && !(o.name && seenName.has(o.name.toLowerCase())))
      .map((o) => ({
        key: o.sf_contact_id,
        payload: { sfContactId: o.sf_contact_id },
        name: o.name,
        title: o.title,
        account: o.account_name,
        source: o.flow ? `Groove · ${o.flow}` : 'Groove',
      }))
    return [...trackerRows, ...mirrorRows]
  }, [tracker, outreach, accountName])

  const needle = q.trim().toLowerCase()
  const hits =
    needle.length < 2
      ? []
      : candidates
          .filter((c) => [c.name, c.account, c.title].filter(Boolean).some((s) => s.toLowerCase().includes(needle)))
          .slice(0, 8)

  const pick = (c) => {
    onWatch(c.payload)
    setQ('')
  }

  return (
    <div className="relative mt-2">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && hits[0]) pick(hits[0])
          if (e.key === 'Escape') setQ('')
        }}
        disabled={busy}
        placeholder="add a contact — search by name, account, or title (tracker + Groove)"
        aria-label="Search contacts to watch"
        className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm outline-none focus:border-primary-500 dark:border-zinc-700 dark:bg-zinc-950"
      />
      {hits.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {hits.map((c) => (
            <li key={c.key}>
              <button
                onClick={() => pick(c)}
                disabled={busy}
                className="flex w-full items-baseline gap-2 px-2 py-1.5 text-left text-sm hover:bg-zinc-50 disabled:opacity-50 dark:hover:bg-zinc-800/60"
              >
                <span className="font-medium">{c.name}</span>
                <span className="truncate text-xs text-zinc-500">
                  {[c.title, c.account].filter(Boolean).join(' · ')}
                </span>
                <span className="ml-auto shrink-0 text-[10px] text-zinc-400 uppercase">{c.source}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {needle.length >= 2 && hits.length === 0 && (
        <p className="mt-1 text-xs text-zinc-500">No match in the tracker or Groove mirror — add them to Groove first, or add the row in Accounts.</p>
      )}
    </div>
  )
}

// Full tracker view (#/activity): the watchlist mini-CRM (hand-picked
// contacts, Groove-mirror state + dashboard-only notes) plus goals + pace,
// connect rate, today's log with per-row undo, and the day-by-day trend.
// Activity itself is tracked in Groove — the manual tallies here are just
// the quick pace counter fed by the bottom bar.
export default function ActivityPage({ tracker, outreach, onUndo, busy, mutate, targetId, onTarget }) {
  // Re-render every minute so the pace math tracks the clock.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  // Groove-mirror lookup (same rule as Accounts: sfContactId authoritative,
  // bare name as fallback for rows created before the id existed).
  const outreachLookup = useMemo(() => {
    const byId = new Map()
    const byName = new Map()
    for (const o of outreach?.contacts ?? []) {
      if (o.sf_contact_id) byId.set(o.sf_contact_id, o)
      if (o.name) byName.set(o.name.toLowerCase(), o)
    }
    return { byId, byName }
  }, [outreach])

  if (!tracker) return <p className="mt-10 text-center text-sm text-zinc-500">Loading tracker…</p>

  const matchOutreach = (c) =>
    (c.sfContactId && outreachLookup.byId.get(c.sfContactId)) ||
    (c.name && outreachLookup.byName.get(c.name.toLowerCase())) ||
    null
  const accountName = new Map(tracker.accounts.map((a) => [a.id, a.name]))
  const watched = tracker.contacts.filter((c) => c.watch)
  const onPatch = (id, patch) => mutate(patchTrackerContact(id, patch))
  const onWatch = (payload) => mutate(watchTrackerContact(payload))

  const { goals, today, history } = tracker
  const counts = today.counts ?? {}
  const rate = connectRate(today)
  const goalTypes = Object.keys(goals).filter((t) => TYPE_LABELS[t])
  const outcomeCounts = today.activities.reduce((acc, a) => {
    if (a.outcome) acc[a.outcome] = (acc[a.outcome] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-bold tracking-tight">Activity</h1>
      <p className="mt-1 text-sm text-zinc-500">
        {formatDate(today.date)} · Groove is the activity system-of-record — this page is your watchlist + a quick pace counter (log from
        the bar below on any page)
      </p>

      <section className="mt-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold tracking-wide text-zinc-500 uppercase">Watchlist</h2>
          <span className="text-xs text-zinc-500">
            hand-picked contacts · flow state + replies from the Groove mirror
            {outreach && ` (synced ${relativeTime(outreach.retrieved_at)})`}
          </span>
        </div>
        <WatchSearch tracker={tracker} outreach={outreach} accountName={accountName} busy={busy} onWatch={onWatch} />
        {watched.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">
            Nothing watched yet — search above for anyone you've added to Groove or Salesforce (the ☆ on{' '}
            <a href="#/accounts" className="text-primary-600 hover:underline dark:text-primary-400">Accounts</a> rows still works too) to pin the
            people you're hitting out-of-flow or working strategically.
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[52rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-zinc-500">
                  <th className="py-1 pr-1 font-normal" aria-label="Target"></th>
                  <th className="py-1 pr-2 font-normal">Contact</th>
                  <th className="py-1 pr-2 font-normal">Groove</th>
                  <th className="py-1 pr-2 font-normal">Last touch</th>
                  <th className="py-1 pr-2 font-normal">Next move</th>
                  <th className="py-1 pr-2 font-normal">Date</th>
                  <th className="py-1 pr-2 font-normal">Notes</th>
                  <th className="py-1 font-normal" aria-label="Unwatch"></th>
                </tr>
              </thead>
              <tbody>
                {watched.map((c) => (
                  <WatchRow
                    key={c.id}
                    c={c}
                    o={matchOutreach(c)}
                    accountName={accountName.get(c.accountId) ?? c.accountId}
                    busy={busy}
                    onPatch={onPatch}
                    targeted={c.id === targetId}
                    onTarget={onTarget}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {goalTypes.map((type) => (
          <GoalCard key={type} type={type} count={counts[type] ?? 0} goal={goals[type]} now={now} />
        ))}

        <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <span className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">Connect rate</span>
          <p className="mt-1 text-2xl font-bold tabular-nums">
            {rate === null ? '—' : `${Math.round(rate * 100)}%`}
            <span className="ml-1 text-sm font-normal text-zinc-500">
              {today.outcome_calls ? `${today.connects}/${today.outcome_calls} dials` : 'no outcomes yet'}
            </span>
          </p>
          <p className="mt-2 text-xs text-zinc-500">
            {Object.entries(OUTCOME_LABELS)
              .map(([k, label]) => `${label} ${outcomeCounts[k] ?? 0}`)
              .join(' · ')}
          </p>
          <p className="mt-1 text-xs text-zinc-500">Replies {counts.reply ?? 0} · Meetings {counts.meeting ?? 0}</p>
        </div>
      </div>

      {today.activities.length > 0 && (
        <section className="mt-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-semibold tracking-wide text-zinc-500 uppercase">Today's log</h2>
          <ul className="mt-2 max-h-64 space-y-0.5 overflow-y-auto">
            {[...today.activities].reverse().map((a) => (
              <li key={a.id} className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                <span className="w-16 shrink-0 text-xs text-zinc-500 tabular-nums">
                  {new Date(a.ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                </span>
                <span className="font-medium">{TYPE_LABELS[a.type]}</span>
                {a.outcome && (
                  <span
                    className={
                      a.outcome === 'connect'
                        ? 'text-xs text-success-700 dark:text-success-400'
                        : 'text-xs text-zinc-500'
                    }
                  >
                    {OUTCOME_LABELS[a.outcome]}
                  </span>
                )}
                <button
                  disabled={busy}
                  onClick={() => onUndo(a.id)}
                  className="ml-auto text-xs text-zinc-400 hover:text-brand-500 disabled:opacity-50"
                  title="Remove this entry"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {history.length > 0 && (
        <section className="mt-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-semibold tracking-wide text-zinc-500 uppercase">Trend</h2>
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-zinc-500">
                <th className="py-1 font-normal">Day</th>
                <th className="py-1 font-normal">Calls</th>
                <th className="py-1 font-normal">Emails</th>
                <th className="py-1 font-normal">LI</th>
                <th className="py-1 font-normal">Vid</th>
                <th className="py-1 font-normal">InM</th>
                <th className="py-1 font-normal">Connect</th>
                <th className="py-1 font-normal">Mtgs</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {history.map((d) => {
                const callState = goalState(d.counts.call ?? 0, goals.call) ?? 'below'
                const emailState = goalState(d.counts.email ?? 0, goals.email) ?? 'below'
                return (
                  <tr key={d.date} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="py-1 text-xs text-zinc-500">{formatDate(d.date)}</td>
                    <td className={`py-1 ${STATE_TEXT[callState]}`}>{d.counts.call ?? 0}</td>
                    <td className={`py-1 ${STATE_TEXT[emailState]}`}>{d.counts.email ?? 0}</td>
                    <td className="py-1">{d.counts.linkedin ?? 0}</td>
                    <td className="py-1">{d.counts.video ?? 0}</td>
                    <td className="py-1">{d.counts.inmail ?? 0}</td>
                    <td className="py-1">{d.outcome_calls ? `${Math.round((d.connects / d.outcome_calls) * 100)}%` : '—'}</td>
                    <td className="py-1">{d.counts.meeting ?? 0}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
