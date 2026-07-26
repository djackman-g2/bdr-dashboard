import { useMemo, useState } from 'react'
import {
  addTrackerAccount,
  patchTrackerAccount,
  deleteTrackerAccount,
  addTrackerContact,
  patchTrackerContact,
  deleteTrackerContact,
  personaForTitle,
  personaLabel,
} from '../lib/tracker.js'
import { relativeTime } from '../lib/format.js'

const STATUS_TONE = {
  'to-find': 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  active: 'bg-info-100 text-info-700 dark:bg-info-950/60 dark:text-info-300',
  replied: 'bg-success-100 text-success-700 dark:bg-success-900/50 dark:text-success-300',
  meeting: 'bg-primary-100 text-primary-700 dark:bg-primary-950/60 dark:text-primary-300',
  dead: 'bg-zinc-100 text-zinc-400 line-through dark:bg-zinc-800 dark:text-zinc-600',
}

const inputCls =
  'w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm outline-none hover:border-zinc-300 focus:border-primary-500 focus:bg-white dark:hover:border-zinc-700 dark:focus:bg-zinc-950'
const selectCls =
  'rounded border border-zinc-300 bg-white px-1 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-950'

// One inline-editable contact row. Text fields save on blur; selects on
// change. Rows without a hook render red and the step "+" is blocked —
// no hook, no advance (the server enforces it too).
function ContactRow({ c, personas, statuses, busy, onPatch, onDelete, targeted, onTarget }) {
  const [draft, setDraft] = useState({
    name: c.name ?? '',
    title: c.title ?? '',
    hook: c.hook ?? '',
    nextAction: c.nextAction ?? '',
  })
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }))
  const save = (k, { emptyAs = null } = {}) => () => {
    const v = draft[k].trim()
    if (v === (c[k] ?? '')) return
    onPatch(c.id, { [k]: v || emptyAs })
  }
  const hookMissing = !(c.hook ?? '').trim()
  const angle = c.persona ? personas[c.persona]?.hookAngle : null
  const overdue = c.nextDate && c.nextDate < new Date().toLocaleDateString('en-CA') && c.status !== 'dead'

  return (
    <tr
      className={`border-t border-zinc-100 align-top dark:border-zinc-800 ${
        hookMissing && c.status !== 'dead'
          ? 'bg-brand-50 dark:bg-brand-950/30'
          : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/40'
      }`}
    >
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
        <input
          value={draft.name}
          onChange={set('name')}
          onBlur={save('name')}
          placeholder="to find…"
          aria-label="Contact name"
          className={`${inputCls} ${!c.name ? 'italic' : 'font-medium'}`}
        />
      </td>
      <td className="min-w-32 py-1 pr-2">
        <input value={draft.title} onChange={set('title')} onBlur={save('title')} placeholder="title" aria-label="Title" className={inputCls} />
      </td>
      <td className="py-1 pr-2">
        <select
          value={c.persona ?? ''}
          onChange={(e) => onPatch(c.id, { persona: e.target.value || null })}
          disabled={busy}
          aria-label="Persona"
          className={selectCls}
        >
          <option value="">—</option>
          {Object.keys(personas).map((k) => (
            <option key={k} value={k}>
              {personaLabel(k)}
            </option>
          ))}
        </select>
      </td>
      <td className="py-1 pr-2 whitespace-nowrap">
        <span className="inline-flex items-center gap-1">
          <button
            onClick={() => onPatch(c.id, { step: c.step - 1 })}
            disabled={busy || c.step <= 1}
            aria-label="Step back"
            className="rounded border border-zinc-300 px-1 text-xs disabled:opacity-30 dark:border-zinc-700"
          >
            −
          </button>
          <span className="w-4 text-center text-sm tabular-nums">{c.step}</span>
          <button
            onClick={() => onPatch(c.id, { step: c.step + 1 })}
            disabled={busy || c.step >= 6 || hookMissing}
            title={hookMissing ? 'No hook, no advance past step 1' : 'Advance step'}
            aria-label="Advance step"
            className="rounded border border-zinc-300 px-1 text-xs disabled:opacity-30 dark:border-zinc-700"
          >
            +
          </button>
        </span>
      </td>
      <td className="py-1 pr-2 text-xs whitespace-nowrap text-zinc-500">{c.lastTouch ? relativeTime(c.lastTouch) : '—'}</td>
      <td className="min-w-28 py-1 pr-2">
        <input
          value={draft.nextAction}
          onChange={set('nextAction')}
          onBlur={save('nextAction')}
          placeholder="next action"
          aria-label="Next action"
          className={inputCls}
        />
      </td>
      <td className="py-1 pr-2">
        <input
          type="date"
          value={c.nextDate ?? ''}
          onChange={(e) => onPatch(c.id, { nextDate: e.target.value || null })}
          aria-label="Next date"
          className={`${selectCls} ${overdue ? 'border-brand-400 text-brand-600 dark:text-brand-300' : ''}`}
        />
      </td>
      <td className="min-w-48 py-1 pr-2">
        <div className="flex items-start gap-1">
          <input
            value={draft.hook}
            onChange={set('hook')}
            onBlur={save('hook', { emptyAs: '' })}
            placeholder={angle ? angle : 'hook — required to advance'}
            aria-label="Hook"
            className={`${inputCls} ${hookMissing ? 'placeholder:text-brand-400/70' : ''}`}
          />
          {angle && hookMissing && (
            <button
              onClick={() => {
                setDraft((d) => ({ ...d, hook: angle }))
                onPatch(c.id, { hook: angle })
              }}
              disabled={busy}
              title={`Start from the ${personaLabel(c.persona)} angle — then personalize with pulled proof`}
              className="mt-0.5 shrink-0 text-xs text-primary-600 hover:underline dark:text-primary-400"
            >
              ⚡use angle
            </button>
          )}
        </div>
      </td>
      <td className="py-1 pr-2">
        <select
          value={c.status}
          onChange={(e) => onPatch(c.id, { status: e.target.value })}
          disabled={busy}
          aria-label="Status"
          className={`${selectCls} ${STATUS_TONE[c.status] ?? ''}`}
        >
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </td>
      <td className="py-1 text-right">
        <button
          onClick={() => onDelete(c.id)}
          disabled={busy}
          aria-label="Delete contact"
          className="text-xs text-zinc-400 hover:text-brand-500 disabled:opacity-50"
        >
          ✕
        </button>
      </td>
    </tr>
  )
}

function AccountCard({ account, contacts, tracker, index, busy, mutate, navigate, targetId, onTarget }) {
  const [newFlag, setNewFlag] = useState('')
  const [importing, setImporting] = useState(false)
  const singleThreaded = account.playType && account.threadIds.length < 2
  const inIndex = (index?.accounts ?? []).find((a) => a.slug === account.id)
  const researched = inIndex?.status === 'active'
  const toFind = contacts.filter((c) => c.status === 'to-find').length

  // Pull the dossier's ICP contacts in as rows (client-side — the dossier is
  // already served at /data). Dedupe by name; persona guessed from title.
  const importFromDossier = async () => {
    setImporting(true)
    try {
      const dossier = await fetch(`/data/accounts/${account.id}.json`).then((r) => (r.ok ? r.json() : null))
      const have = new Set(contacts.map((c) => c.name?.toLowerCase()).filter(Boolean))
      const fresh = (dossier?.icp_contacts ?? []).filter((ic) => ic.name && !have.has(ic.name.toLowerCase()))
      if (!fresh.length) return mutate(Promise.reject(new Error('no new named contacts in the dossier')))
      for (const ic of fresh) {
        await mutate(
          addTrackerContact({
            accountId: account.id,
            name: ic.name,
            title: ic.title ?? null,
            persona: personaForTitle(ic.title, tracker.personas),
          })
        )
      }
    } finally {
      setImporting(false)
    }
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <header className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
        {inIndex ? (
          <button onClick={() => navigate(account.id)} className="font-semibold hover:text-primary-600 hover:underline dark:hover:text-primary-400">
            {account.name}
          </button>
        ) : (
          <span className="font-semibold">{account.name}</span>
        )}
        <select
          value={account.playType ?? ''}
          onChange={(e) => mutate(patchTrackerAccount(account.id, { playType: e.target.value || null }))}
          disabled={busy}
          aria-label="Play type"
          className={selectCls}
        >
          <option value="">no play</option>
          {tracker.play_types.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        {singleThreaded && (
          <span className="rounded-full border border-warning-400 bg-warning-100 px-2 py-0.5 text-xs font-medium text-warning-700 dark:border-warning-600 dark:bg-warning-950/60 dark:text-warning-300">
            single-threaded ⚠
          </span>
        )}
        {/* Flags render BEFORE any send decision — that's their whole job. */}
        {account.flags.map((f) => (
          <span
            key={f}
            className="inline-flex items-center gap-1 rounded-full border border-brand-300 bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 dark:border-brand-800 dark:bg-brand-950/50 dark:text-brand-300"
          >
            {f}
            <button
              onClick={() => mutate(patchTrackerAccount(account.id, { flags: account.flags.filter((x) => x !== f) }))}
              disabled={busy}
              aria-label={`Remove flag ${f}`}
              className="opacity-60 hover:opacity-100"
            >
              ✕
            </button>
          </span>
        ))}
        <input
          value={newFlag}
          onChange={(e) => setNewFlag(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newFlag.trim()) {
              mutate(patchTrackerAccount(account.id, { flags: [...account.flags, newFlag.trim()] }))
              setNewFlag('')
            }
          }}
          placeholder="+ flag ⏎"
          aria-label="Add flag"
          className="w-24 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs outline-none hover:border-zinc-300 focus:border-primary-500 dark:hover:border-zinc-700"
        />
        <span className="ml-auto flex items-center gap-2 text-xs text-zinc-500">
          {toFind > 0 && <span>{toFind} to find</span>}
          {researched && (
            <button
              onClick={importFromDossier}
              disabled={busy || importing}
              title="Import named ICP contacts from the research dossier"
              className="rounded border border-zinc-300 px-2 py-0.5 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {importing ? 'importing…' : '⤓ dossier contacts'}
            </button>
          )}
          <button
            onClick={() => mutate(addTrackerContact({ accountId: account.id }))}
            disabled={busy}
            className="rounded border border-zinc-300 px-2 py-0.5 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            + contact
          </button>
          <button
            onClick={() => {
              if (window.confirm(`Remove ${account.name} and its ${contacts.length} contact row(s) from the tracker? (SF + research dossier untouched)`)) {
                mutate(deleteTrackerAccount(account.id))
              }
            }}
            disabled={busy}
            aria-label="Remove account from tracker"
            className="text-zinc-400 hover:text-brand-500 disabled:opacity-50"
          >
            ✕
          </button>
        </span>
      </header>
      {contacts.length > 0 ? (
        <div className="overflow-x-auto px-3 pb-2">
          <table className="w-full min-w-[56rem] text-sm">
            <thead>
              <tr className="text-left text-xs text-zinc-500">
                <th className="py-1 pr-1 font-normal" aria-label="Target"></th>
                <th className="py-1 pr-2 font-normal">Contact</th>
                <th className="py-1 pr-2 font-normal">Title</th>
                <th className="py-1 pr-2 font-normal">Persona</th>
                <th className="py-1 pr-2 font-normal">Step</th>
                <th className="py-1 pr-2 font-normal">Last touch</th>
                <th className="py-1 pr-2 font-normal">Next action</th>
                <th className="py-1 pr-2 font-normal">Next date</th>
                <th className="py-1 pr-2 font-normal">Hook</th>
                <th className="py-1 pr-2 font-normal">Status</th>
                <th className="py-1 font-normal"></th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <ContactRow
                  key={c.id}
                  c={c}
                  personas={tracker.personas}
                  statuses={tracker.contact_statuses}
                  busy={busy}
                  onPatch={(id, patch) => mutate(patchTrackerContact(id, patch))}
                  onDelete={(id) => mutate(deleteTrackerContact(id))}
                  targeted={c.id === targetId}
                  onTarget={onTarget}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-3 py-2 text-xs text-zinc-500">
          No contact rows yet — “+ contact” adds a to-find placeholder{researched ? ', or pull the dossier’s ICP contacts in' : ''}.
        </p>
      )}
    </section>
  )
}

// #/accounts — the working layer over the book. Thin by design: Salesforce
// stays system-of-record, the research dossiers stay the intel source; this
// is just who's being worked, at what step, with what hook.
export default function AccountsPage({ tracker, index, busy, mutate, navigate, targetId, onTarget }) {
  const [query, setQuery] = useState('')

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || !index) return []
    const have = new Set((tracker?.accounts ?? []).map((a) => a.id))
    return index.accounts
      .filter((a) => a.status !== 'archived' && !have.has(a.slug))
      .filter((a) => a.name?.toLowerCase().includes(q) || a.domain?.includes(q))
      .slice(0, 8)
  }, [query, index, tracker])

  if (!tracker) return <p className="mt-10 text-center text-sm text-zinc-500">Loading tracker…</p>

  const contactsFor = (id) => tracker.contacts.filter((c) => c.accountId === id)
  const accounts = [...tracker.accounts].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight">Accounts</h1>
        <p className="text-sm text-zinc-500">
          {accounts.length} in play · {tracker.contacts.length} contact rows
        </p>
        <div className="relative ml-auto">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Add account from the book…"
            aria-label="Add account from the book"
            className="w-64 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-primary-600 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-primary-400"
          />
          {candidates.length > 0 && (
            <ul className="absolute right-0 z-10 mt-1 w-72 rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              {candidates.map((a) => (
                <li key={a.slug}>
                  <button
                    onClick={() => {
                      setQuery('')
                      mutate(addTrackerAccount({ id: a.slug, name: a.name }))
                    }}
                    className="flex w-full items-baseline gap-2 px-3 py-1 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <span className="font-medium">{a.name}</span>
                    <span className="text-xs text-zinc-500">{a.domain}</span>
                    {a.status === 'active' && <span className="ml-auto text-xs text-success-600 dark:text-success-400">researched</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {accounts.length === 0 && (
          <p className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
            Nothing in play yet. Add accounts with the search above, or bulk-seed the researched ones:{' '}
            <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">cd server && npm run seed:tracker -- --contacts</code>
          </p>
        )}
        {accounts.map((a) => (
          <AccountCard
            key={a.id}
            account={a}
            contacts={contactsFor(a.id)}
            tracker={tracker}
            index={index}
            busy={busy}
            mutate={mutate}
            navigate={navigate}
            targetId={targetId}
            onTarget={onTarget}
          />
        ))}
      </div>
    </div>
  )
}
