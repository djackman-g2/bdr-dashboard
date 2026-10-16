import { useEffect, useMemo, useState } from 'react'
import { TYPE_LABELS, personaLabel, fetchSignals, patchTrackerAccount } from '../lib/tracker.js'

// A due contact rendered as a selectable chip: click makes it the activity
// bar's target (long-press a bar button to log against it).
function ContactChip({ c, accountName, targeted, onTarget }) {
  return (
    <button
      onClick={() => onTarget(c.id)}
      title={targeted ? 'Target — long-press an activity button to log to this contact' : 'Set as activity target'}
      className={`inline-flex max-w-full items-baseline gap-1.5 rounded-full border px-2.5 py-1 text-left text-xs ${
        targeted
          ? 'border-primary-500 bg-primary-100 text-primary-800 ring-1 ring-primary-400 dark:bg-primary-950/60 dark:text-primary-200'
          : 'border-zinc-300 bg-white hover:border-primary-400 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-primary-500'
      }`}
    >
      <span className="font-medium">{c.name ?? `to find: ${personaLabel(c.persona)}`}</span>
      <span className="truncate text-zinc-500">
        {accountName} · step {c.step}
        {c.nextAction ? ` · ${c.nextAction}` : ''}
      </span>
    </button>
  )
}

const chips = (list, accName, targetId, onTarget) =>
  list.length > 0 ? (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {list.map((c) => (
        <ContactChip key={c.id} c={c} accountName={accName[c.accountId] ?? c.accountId} targeted={c.id === targetId} onTarget={onTarget} />
      ))}
    </div>
  ) : (
    <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-600">nothing here</p>
  )

// #/day — signals worth breaking cadence for, today's due/to-find contacts,
// and the end-of-day prospecting worklist. No fixed time blocks: the actual
// day doesn't run on a schedule, so this just surfaces what's worth doing.
export default function DayPage({ tracker, targetId, onTarget, busy, mutate }) {
  const [signals, setSignals] = useState(null)
  const [signalsError, setSignalsError] = useState(null)

  const loadSignals = () => {
    fetchSignals()
      .then((s) => {
        setSignals(s)
        setSignalsError(null)
      })
      .catch((e) => setSignalsError(e.message))
  }
  useEffect(loadSignals, [])

  const slotted = useMemo(() => {
    if (!tracker) return null
    const today = new Date().toLocaleDateString('en-CA')
    const accName = Object.fromEntries(tracker.accounts.map((a) => [a.id, a.name]))
    const workable = tracker.contacts.filter((c) => !['dead', 'meeting'].includes(c.status))
    const due = workable
      .filter((c) => c.nextDate && c.nextDate <= today && c.status !== 'to-find')
      .sort((a, b) => (a.nextDate < b.nextDate ? -1 : a.nextDate > b.nextDate ? 1 : b.step - a.step))
    const toFind = workable.filter((c) => c.status === 'to-find')
    const isEmailish = (c) => /mail|linkedin|\bli\b|connect/i.test(c.nextAction ?? '')
    return { accName, due, toFind, calls: due.filter((c) => !isEmailish(c)), emails: due.filter(isEmailish) }
  }, [tracker])

  if (!tracker || !slotted) return <p className="mt-10 text-center text-sm text-zinc-500">Loading tracker…</p>

  const counts = tracker.today.counts ?? {}
  const flagged = tracker.accounts.filter((a) => a.flags.length > 0)
  const notStarted = tracker.accounts.filter((a) => a.playType && a.threadIds.length === 0)
  const needsSecondThread = tracker.accounts.filter((a) => a.playType && a.threadIds.length === 1)

  const dismissSignal = (accountId, fingerprint) => {
    const account = tracker.accounts.find((a) => a.id === accountId)
    mutate(patchTrackerAccount(accountId, { signalSeen: [...(account?.signalSeen ?? []), fingerprint] }))
    setSignals((s) => s && { ...s, fresh: s.fresh.filter((f) => !(f.accountId === accountId && f.fingerprint === fingerprint)) })
  }

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-bold tracking-tight">Day</h1>
        <p className="text-sm text-zinc-500">
          {slotted.due.length} due · {slotted.toFind.length} to find · click a contact to target it, then long-press an
          activity button below to log against them
        </p>
      </div>
      <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-zinc-500 tabular-nums">
        {['call', 'email', 'linkedin', 'video', 'inmail'].map((t) => (
          <span key={t}>
            {TYPE_LABELS[t]} {counts[t] ?? 0}
          </span>
        ))}
      </p>

      <section className="mt-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold tracking-wide text-zinc-500 uppercase">Signals</h2>
          <span className="text-xs text-zinc-500">when to break cadence, or double-tap someone stuck mid-flow</span>
          <button onClick={loadSignals} title="Refresh signals" className="ml-auto text-xs text-zinc-400 hover:text-primary-500">
            ⟳
          </button>
        </div>

        {flagged.length > 0 && (
          <p className="mt-2 text-xs text-brand-600 dark:text-brand-300">
            Flags first: {flagged.map((a) => `${a.name} — ${a.flags.join(', ')}`).join(' · ')}
          </p>
        )}

        {signalsError && <p className="mt-2 text-xs text-brand-600 dark:text-brand-300">Signals failed to load: {signalsError}</p>}

        {signals && (
          <>
            <div className="mt-3">
              <h3 className="text-xs font-semibold text-zinc-500">Fresh — worth a one-off</h3>
              {signals.fresh.length === 0 ? (
                <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-600">nothing new since last check</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {signals.fresh.map((f) => (
                    <li
                      key={`${f.accountId}:${f.fingerprint}`}
                      className="flex items-start gap-2 rounded-md border border-primary-300 bg-primary-50 px-2 py-1 text-sm dark:border-primary-800 dark:bg-primary-950/40"
                    >
                      <span className="flex-1">
                        <span className="font-medium">{f.accountName}</span> — {f.why}
                        <span className="ml-1 text-xs text-zinc-500">({f.contacts.map((c) => c.name).join(', ')})</span>
                      </span>
                      <button
                        onClick={() => dismissSignal(f.accountId, f.fingerprint)}
                        disabled={busy}
                        title="Seen it — dismiss"
                        className="shrink-0 text-xs text-zinc-400 hover:text-primary-600 disabled:opacity-50"
                      >
                        ✕ seen it
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mt-3">
              <h3 className="text-xs font-semibold text-zinc-500">Stuck mid-flow — double-tap candidates</h3>
              {signals.stuck.length === 0 ? (
                <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-600">nobody's overdue for a double-tap</p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {signals.stuck.map((s) => (
                    <ContactChip
                      key={s.contactId}
                      c={{ id: s.contactId, name: s.name, accountId: s.accountId, step: `day ${s.flowDay}, ${s.daysSince}d no reply` }}
                      accountName={s.accountName}
                      targeted={s.contactId === targetId}
                      onTarget={onTarget}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </section>

      <section className="mt-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold tracking-wide text-zinc-500 uppercase">Due today</h2>
        <div className="mt-2">
          <h3 className="text-xs font-semibold text-zinc-500">Calls</h3>
          {chips(slotted.calls, slotted.accName, targetId, onTarget)}
        </div>
        <div className="mt-3">
          <h3 className="text-xs font-semibold text-zinc-500">Emails / LinkedIn</h3>
          {chips(slotted.emails, slotted.accName, targetId, onTarget)}
        </div>
      </section>

      <section className="mt-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold tracking-wide text-zinc-500 uppercase">To-find</h2>
        {chips(slotted.toFind, slotted.accName, targetId, onTarget)}
      </section>

      <section className="mt-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold tracking-wide text-zinc-500 uppercase">End of day — prospecting worklist</h2>
          <span className="text-xs text-zinc-500">Sales Nav targets, ranked</span>
        </div>
        <div className="mt-2">
          <h3 className="text-xs font-semibold text-zinc-500">Not started</h3>
          {notStarted.length === 0 ? (
            <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-600">none</p>
          ) : (
            <p className="mt-1 text-sm">{notStarted.map((a) => a.name).join(' · ')}</p>
          )}
        </div>
        <div className="mt-3">
          <h3 className="text-xs font-semibold text-zinc-500">Needs a 2nd thread</h3>
          {needsSecondThread.length === 0 ? (
            <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-600">none</p>
          ) : (
            <p className="mt-1 text-sm">{needsSecondThread.map((a) => a.name).join(' · ')}</p>
          )}
        </div>
      </section>
    </div>
  )
}
