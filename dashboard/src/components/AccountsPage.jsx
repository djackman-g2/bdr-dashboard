import { useEffect, useMemo, useState } from 'react'
import {
  addTrackerAccount,
  patchTrackerAccount,
  deleteTrackerAccount,
  addTrackerContact,
  patchTrackerContact,
  deleteTrackerContact,
  streamDraft,
  fetchHookAngles,
  fetchPlays,
  createPlay,
  personaForTitle,
  personaLabel,
} from '../lib/tracker.js'
import { relativeTime } from '../lib/format.js'

export function CopyBtn({ text, label = 'copy' }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
      className="shrink-0 rounded border border-zinc-300 px-1.5 py-0.5 text-[10px] text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
    >
      {copied ? '✓ copied' : label}
    </button>
  )
}

// Send desk: server drafts real messaging for this contact — an enrollment
// pack (email1/2/3 + InMail + call points, pasted into the Groove flow's
// {!flow.*} fields at enrollment) or a single thread-aware next step.
function DraftPanel({ contact, accountName, onClose }) {
  const [kind, setKind] = useState('pack')
  const [state, setState] = useState({ status: 'loading' })
  const [live, setLive] = useState('') // streamed text while the model writes

  useEffect(() => {
    const ctrl = new AbortController()
    setState({ status: 'loading' })
    setLive('')
    streamDraft(contact.id, kind, {
      signal: ctrl.signal,
      onDelta: (t) => setLive((s) => s + t),
      onDone: (r) => setState({ status: 'done', ...r }),
      onError: (e) => setState({ status: 'error', error: e.message }),
    }).catch((e) => {
      if (e.name !== 'AbortError') setState({ status: 'error', error: e.message })
    })
    return () => ctrl.abort()
  }, [contact.id, kind])

  const d = state.draft
  const field = (label, subject, body) => (
    <div className="rounded border border-zinc-200 p-2 dark:border-zinc-800">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">{label}</span>
        {subject != null && (
          <>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{subject}</span>
            <CopyBtn text={subject} label="copy subject" />
          </>
        )}
        <CopyBtn text={body} label="copy body" />
      </div>
      <p className="mt-1 text-sm whitespace-pre-wrap">{body}</p>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 sm:p-8" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-full w-full max-w-2xl overflow-y-auto rounded-lg border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
      >
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">
            ✍ {contact.name ?? 'unnamed contact'} <span className="text-sm font-normal text-zinc-500">· {accountName}</span>
          </h2>
          <div className="ml-auto flex items-center gap-1">
            {[
              ['pack', 'enrollment pack'],
              ['next', 'next step'],
            ].map(([k, label]) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                disabled={state.status === 'loading'}
                className={`rounded-md border px-2 py-0.5 text-xs disabled:opacity-50 ${
                  kind === k
                    ? 'border-primary-400 bg-primary-100 text-primary-700 dark:border-primary-700 dark:bg-primary-950/60 dark:text-primary-300'
                    : 'border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800'
                }`}
              >
                {label}
              </button>
            ))}
            <button onClick={onClose} aria-label="Close" className="ml-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
              ✕
            </button>
          </div>
        </div>

        {state.status === 'loading' &&
          (live ? (
            // Raw JSON streaming in — not pretty, but watching it write beats a
            // spinner; the structured card replaces it the moment it's done.
            <pre className="mt-3 max-h-80 overflow-y-auto rounded border border-zinc-200 bg-zinc-50 p-2 text-xs whitespace-pre-wrap text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
              {live}
              <span className="animate-pulse motion-reduce:animate-none">▌</span>
            </pre>
          ) : (
            <p className="mt-6 animate-pulse text-center text-sm text-zinc-500 motion-reduce:animate-none">
              Reading dossier + plays + Groove history…{kind === 'next' ? '' : ' (pack takes ~30s of thinking before writing)'}
            </p>
          ))}
        {state.status === 'error' && (
          <p className="mt-4 rounded-lg border border-brand-300 bg-brand-50 p-3 text-sm text-brand-700 dark:border-brand-900 dark:bg-brand-950/60 dark:text-brand-300">
            {state.error}
          </p>
        )}

        {state.status === 'done' && !d && (
          <div className="mt-3">
            <p className="mb-1 text-xs text-warning-700 dark:text-warning-400">Response wasn't valid JSON — raw output:</p>
            {field('raw', null, state.raw ?? '(empty)')}
          </div>
        )}

        {d && (
          <div className="mt-3 space-y-2">
            {(d.flag_warnings ?? []).filter(Boolean).length > 0 && (
              <p className="rounded-lg border border-brand-300 bg-brand-50 p-2 text-xs font-medium text-brand-700 dark:border-brand-900 dark:bg-brand-950/60 dark:text-brand-300">
                ⚑ Before sending: {d.flag_warnings.join(' · ')}
              </p>
            )}
            <p className="text-xs text-zinc-500">
              <span className="rounded-full border border-primary-300 px-2 py-0.5 text-primary-700 dark:border-primary-700 dark:text-primary-300">
                {d.play}
              </span>{' '}
              {d.rationale}
            </p>
            {(d.emails ?? []).map((e) => field(e.slot, e.subject, e.body))}
            {d.linkedin_inmail && field('linkedin inmail', null, d.linkedin_inmail)}
            {d.call_points?.length > 0 && field('call points', null, d.call_points.map((p) => `• ${p}`).join('\n'))}
            {d.channel && field(d.channel + (d.subject ? '' : ' message'), d.subject ?? null, d.body ?? '')}
            <p className="text-[10px] text-zinc-400">
              Drafts are suggestions — read before sending; stats are limited to the canonical library. Regenerate by toggling pack/next.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// "+ new play" — a play is just a .md in data/plays/ with frontmatter; this
// form writes one via POST /api/plays and it's instantly matchable (⚡) and
// draftable (✍). trigger: persona = a plain reusable hook angle.
function NewPlayForm({ personaKeys, onCreated, onCancel }) {
  const [form, setForm] = useState({ name: '', trigger: 'persona', personas: ['any'], hook: '', notes: '' })
  const [triggers, setTriggers] = useState(['persona', 'ai_visibility', 'closed_lost', 'no_history', 'mid_flow', 'manual'])
  const [state, setState] = useState({ status: 'idle' })

  useEffect(() => {
    fetchPlays().then((r) => r.triggers?.length && setTriggers(r.triggers)).catch(() => {})
  }, [])

  const togglePersona = (key) =>
    setForm((f) => {
      if (key === 'any') return { ...f, personas: ['any'] }
      const rest = f.personas.filter((p) => p !== 'any')
      const next = rest.includes(key) ? rest.filter((p) => p !== key) : [...rest, key]
      return { ...f, personas: next.length ? next : ['any'] }
    })

  const submit = async () => {
    setState({ status: 'saving' })
    try {
      const created = await createPlay(form)
      setState({ status: 'idle' })
      onCreated(created)
    } catch (e) {
      setState({ status: 'error', error: e.message })
    }
  }

  const fieldCls =
    'w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm outline-none focus:border-primary-500 dark:border-zinc-700 dark:bg-zinc-950'
  return (
    <div className="mt-3 space-y-2 rounded border border-zinc-200 p-3 dark:border-zinc-800">
      <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">New play</p>
      <input
        value={form.name}
        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        placeholder="play name (becomes data/plays/{slug}.md)"
        aria-label="Play name"
        className={fieldCls}
      />
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="text-zinc-500">
          fires on{' '}
          <select
            value={form.trigger}
            onChange={(e) => setForm((f) => ({ ...f, trigger: e.target.value }))}
            aria-label="Trigger"
            className={selectCls}
          >
            {triggers.map((t) => (
              <option key={t} value={t}>
                {t === 'persona' ? 'persona match (always offered)' : t === 'manual' ? 'manual (never auto-fires)' : t.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </label>
        <span className="text-zinc-400">·</span>
        {['any', ...personaKeys].map((k) => (
          <label key={k} className="flex items-center gap-1 text-zinc-600 dark:text-zinc-400">
            <input type="checkbox" checked={form.personas.includes(k)} onChange={() => togglePersona(k)} />
            {k === 'any' ? 'any persona' : personaLabel(k)}
          </label>
        ))}
      </div>
      <textarea
        value={form.hook}
        onChange={(e) => setForm((f) => ({ ...f, hook: e.target.value }))}
        placeholder="hook template — one line, e.g. Companies comparing {category|your category} on G2 resolve to named accounts…"
        aria-label="Hook template"
        rows={2}
        className={fieldCls}
      />
      <p className="text-[10px] text-zinc-400">
        Tokens fill from the dossier: {'{company} {name} {category} {review_count} {competitor_count} {ai_question} {profile_url} {review_line} {recent_reviews_line}'} — use {'{token|fallback}'} to degrade gracefully.
      </p>
      <textarea
        value={form.notes}
        onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
        placeholder="notes for the draft engine (optional): angle, structure, proof to pull…"
        aria-label="Play notes"
        rows={3}
        className={fieldCls}
      />
      {state.status === 'error' && <p className="text-xs text-brand-600 dark:text-brand-300">{state.error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
          cancel
        </button>
        <button
          onClick={submit}
          disabled={state.status === 'saving'}
          className="rounded border border-primary-400 bg-primary-100 px-2 py-0.5 text-xs text-primary-700 disabled:opacity-50 dark:border-primary-700 dark:bg-primary-950/60 dark:text-primary-300"
        >
          {state.status === 'saving' ? 'saving…' : 'create play'}
        </button>
      </div>
    </div>
  )
}

// ⚡ hook angles — play-aware replacement for the old one-angle paste. Offers
// come from the server's matcher: every play whose trigger fires for this
// account, hook pre-filled with real dossier facts (no LLM call — instant,
// never invents a number). Picking one seeds the hook field; it's a starting
// line to edit, not sent copy. The generic persona angle stays at the bottom.
function HookAnglesModal({ contact, accountName, personaKeys, onPick, onClose }) {
  const [state, setState] = useState({ status: 'loading' })
  const [creating, setCreating] = useState(false)

  const load = () => {
    setState({ status: 'loading' })
    fetchHookAngles(contact.id)
      .then((r) => setState({ status: 'done', ...r }))
      .catch((e) => setState({ status: 'error', error: e.message }))
  }
  useEffect(load, [contact.id])

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 sm:p-8" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-full w-full max-w-xl overflow-y-auto rounded-lg border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
      >
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">
            ⚡ hook angles{' '}
            <span className="text-sm font-normal text-zinc-500">
              · {contact.name ?? 'unnamed contact'} · {accountName}
            </span>
          </h2>
          <button onClick={onClose} aria-label="Close" className="ml-auto text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
            ✕
          </button>
        </div>

        {state.status === 'loading' && <p className="mt-4 animate-pulse text-sm text-zinc-500 motion-reduce:animate-none">Matching plays against the dossier…</p>}
        {state.status === 'error' && (
          <p className="mt-4 rounded-lg border border-brand-300 bg-brand-50 p-3 text-sm text-brand-700 dark:border-brand-900 dark:bg-brand-950/60 dark:text-brand-300">
            {state.error}
          </p>
        )}

        {state.status === 'done' && (
          <>
            {!state.dossier && (
              <p className="mt-2 text-xs text-warning-700 dark:text-warning-400">
                No research dossier yet — only persona/history angles available. Run a refresh for fact-filled hooks.
              </p>
            )}
            <ul className="mt-3 space-y-2">
              {state.offers.map((o, i) => (
                <li key={i}>
                  <button
                    onClick={() => {
                      onPick(o.hook)
                      onClose()
                    }}
                    className="w-full rounded border border-zinc-200 p-2 text-left hover:border-primary-400 hover:bg-primary-50 dark:border-zinc-800 dark:hover:border-primary-600 dark:hover:bg-primary-950/30"
                  >
                    <span className="rounded-full border border-primary-300 px-2 py-0.5 text-[10px] text-primary-700 dark:border-primary-700 dark:text-primary-300">
                      {o.label}
                    </span>
                    <p className="mt-1 text-sm">{o.hook}</p>
                    <p className="mt-0.5 text-[10px] text-zinc-400">{o.why}</p>
                  </button>
                </li>
              ))}
              {state.offers.length === 0 && (
                <li className="text-sm text-zinc-500">No plays fire for this contact — set a persona, or write the hook by hand.</li>
              )}
            </ul>
          </>
        )}

        {creating ? (
          <NewPlayForm
            personaKeys={personaKeys}
            onCreated={() => {
              setCreating(false)
              load()
            }}
            onCancel={() => setCreating(false)}
          />
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="mt-3 text-xs text-primary-600 hover:underline dark:text-primary-400"
          >
            + new play — reusable angle, instantly available here and to ✍ draft
          </button>
        )}
      </div>
    </div>
  )
}

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
// Groove-mirror data for this contact (matched by sfContactId, name fallback).
// lastTouch and flow position come from the SF task trail — no manual entry.
function ContactRow({ c, o, personas, statuses, busy, onPatch, onDelete, targeted, onTarget, onDraft, accountName }) {
  const [anglesOpen, setAnglesOpen] = useState(false)
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
  // Flow-enrolled contacts: Groove owns the schedule. Next action/date render
  // read-only (auto-stamped by the morning due-list upload) — manual entry is
  // for out-of-flow contacts only, so the two can never drift.
  const inFlow = o?.flow != null || o?.flow_day != null

  return (
    <tr
      className={`border-t border-zinc-100 align-top dark:border-zinc-800 ${
        hookMissing && c.status !== 'dead'
          ? 'bg-brand-50 dark:bg-brand-950/30'
          : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/40'
      }`}
    >
      <td className="py-1 pr-1 whitespace-nowrap">
        <button
          onClick={() => onTarget(c.id)}
          disabled={busy}
          title={targeted ? 'Activity target — long-press a bar button to log to this contact' : 'Set as activity target'}
          aria-label={targeted ? 'Clear activity target' : 'Set as activity target'}
          className={targeted ? 'text-primary-600 dark:text-primary-400' : 'text-zinc-300 hover:text-primary-500 dark:text-zinc-600'}
        >
          {targeted ? '◉' : '◎'}
        </button>
        <button
          onClick={() => onPatch(c.id, { watch: !c.watch })}
          disabled={busy}
          title={c.watch ? 'On the watchlist (#/activity) — click to remove' : 'Watch — pin to the mini-CRM on #/activity'}
          aria-label={c.watch ? 'Remove from watchlist' : 'Add to watchlist'}
          className={`ml-0.5 ${c.watch ? 'text-warning-500' : 'text-zinc-300 hover:text-warning-500 dark:text-zinc-600'}`}
        >
          {c.watch ? '★' : '☆'}
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
      <td className="py-1 pr-2 text-xs whitespace-nowrap text-zinc-500">
        {(() => {
          const latest = [c.lastTouch, o?.last_outbound].filter(Boolean).sort().pop()
          return latest ? relativeTime(latest) : '—'
        })()}
        {o?.flow_day != null && (
          <div
            className="text-[10px] text-primary-600 dark:text-primary-400"
            title={o.flow ? `Groove flow: ${o.flow}` : 'Groove flow step'}
          >
            flow day {o.flow_day}
          </div>
        )}
      </td>
      <td className="min-w-28 py-1 pr-2">
        {inFlow ? (
          <span
            className="block px-1 py-0.5 text-sm text-zinc-600 dark:text-zinc-400"
            title={`Groove owns this schedule${o.flow ? ` (${o.flow})` : ''} — auto-stamped by the morning due-list upload`}
          >
            {c.nextAction ?? 'in flow'}
          </span>
        ) : (
          <input
            value={draft.nextAction}
            onChange={set('nextAction')}
            onBlur={save('nextAction')}
            placeholder="next action"
            aria-label="Next action"
            className={inputCls}
          />
        )}
      </td>
      <td className="py-1 pr-2 whitespace-nowrap">
        {inFlow ? (
          <span
            className={`px-1 py-0.5 text-xs tabular-nums ${overdue ? 'text-brand-600 dark:text-brand-300' : 'text-zinc-600 dark:text-zinc-400'}`}
            title="Auto-stamped from the Groove due list"
          >
            {c.nextDate ?? '—'}
          </span>
        ) : (
          <input
            type="date"
            value={c.nextDate ?? ''}
            onChange={(e) => onPatch(c.id, { nextDate: e.target.value || null })}
            aria-label="Next date"
            className={`${selectCls} ${overdue ? 'border-brand-400 text-brand-600 dark:text-brand-300' : ''}`}
          />
        )}
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
          {hookMissing && (
            <button
              onClick={() => setAnglesOpen(true)}
              disabled={busy}
              title="Pick a hook from the plays that fire for this account (fact-filled from the dossier)"
              className="mt-0.5 shrink-0 text-xs text-primary-600 hover:underline dark:text-primary-400"
            >
              ⚡angles
            </button>
          )}
        </div>
        {anglesOpen && (
          <HookAnglesModal
            contact={c}
            accountName={accountName}
            personaKeys={Object.keys(personas)}
            onPick={(hook) => {
              setDraft((d) => ({ ...d, hook }))
              onPatch(c.id, { hook })
            }}
            onClose={() => setAnglesOpen(false)}
          />
        )}
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
        {o?.replied && c.status !== 'replied' && c.status !== 'meeting' && (
          <button
            onClick={() => onPatch(c.id, { status: 'replied' })}
            disabled={busy}
            title={`Inbound email in Salesforce ${o.last_inbound ? relativeTime(o.last_inbound) : ''} — click to mark replied`}
            className="ml-1 rounded-full border border-success-400 bg-success-100 px-1.5 text-[10px] text-success-700 dark:border-success-700 dark:bg-success-900/50 dark:text-success-300"
          >
            ✉ replied?
          </button>
        )}
      </td>
      <td className="py-1 text-right whitespace-nowrap">
        <button
          onClick={() => onDraft(c)}
          disabled={busy}
          title="Draft messaging (enrollment pack / next step)"
          aria-label="Draft messaging"
          className="text-xs text-primary-600 hover:text-primary-700 disabled:opacity-50 dark:text-primary-400"
        >
          ✍ draft
        </button>
        <button
          onClick={() => onDelete(c.id)}
          disabled={busy}
          aria-label="Delete contact"
          className="ml-2 text-xs text-zinc-400 hover:text-brand-500 disabled:opacity-50"
        >
          ✕
        </button>
      </td>
    </tr>
  )
}

function AccountCard({ account, contacts, tracker, index, outreach, busy, mutate, navigate, targetId, onTarget, matchOutreach, onDraft }) {
  const [open, setOpen] = useState(false)
  const [newFlag, setNewFlag] = useState('')
  const [importing, setImporting] = useState(false)

  // Mirror contacts on this account (matched by SF account id, name fallback)
  // that have no tracker row yet — people worked in Groove/Sales Nav that the
  // tracker never saw. One click pulls them in.
  const grooveMissing = useMemo(() => {
    if (!outreach) return []
    const haveIds = new Set(contacts.map((c) => c.sfContactId).filter(Boolean))
    const haveNames = new Set(contacts.map((c) => c.name?.toLowerCase()).filter(Boolean))
    return outreach.contacts.filter(
      (o) =>
        (o.sf_account_id === account.sfId || o.account_name?.toLowerCase() === account.name.toLowerCase()) &&
        o.name &&
        !haveIds.has(o.sf_contact_id) &&
        !haveNames.has(o.name.toLowerCase())
    )
  }, [outreach, contacts, account])

  const importFromGroove = async () => {
    for (const o of grooveMissing) {
      await mutate(
        addTrackerContact({
          accountId: account.id,
          name: o.name,
          title: o.title ?? null,
          persona: personaForTitle(o.title, tracker.personas),
          sfContactId: o.sf_contact_id,
        })
      )
    }
  }
  const singleThreaded = account.playType && account.threadIds.length < 2
  const inIndex = (index?.accounts ?? []).find((a) => a.slug === account.id)
  const researched = inIndex?.status === 'active'
  const toFind = contacts.filter((c) => c.status === 'to-find').length
  const hooked = contacts.filter((c) => (c.hook ?? '').trim()).length

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
            sfContactId: ic.salesforce_contact_id ?? null,
          })
        )
      }
    } finally {
      setImporting(false)
    }
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      {/* Collapsed one-line row; expand for the contact table + account actions. */}
      <header className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex min-w-0 items-center gap-2 font-semibold hover:text-primary-600 dark:hover:text-primary-400"
        >
          <span className="text-xs text-zinc-400">{open ? '▾' : '▸'}</span>
          <span className="truncate">{account.name}</span>
        </button>
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
            {open && (
              <button
                onClick={() => mutate(patchTrackerAccount(account.id, { flags: account.flags.filter((x) => x !== f) }))}
                disabled={busy}
                aria-label={`Remove flag ${f}`}
                className="opacity-60 hover:opacity-100"
              >
                ✕
              </button>
            )}
          </span>
        ))}
        <span className="ml-auto text-xs whitespace-nowrap text-zinc-500 tabular-nums">
          {contacts.length} contact{contacts.length === 1 ? '' : 's'} · {hooked} hooked
          {toFind > 0 && ` · ${toFind} to find`}
          {grooveMissing.length > 0 && (
            <span className="text-primary-600 dark:text-primary-400"> · {grooveMissing.length} untracked in Groove</span>
          )}
        </span>
      </header>

      {open && (
        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 px-3 py-1.5 text-xs dark:border-zinc-800">
          {inIndex && (
            <button
              onClick={() => navigate(account.id)}
              className="text-info-500 hover:underline dark:text-info-400"
            >
              open dossier →
            </button>
          )}
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
            className="w-24 rounded border border-transparent bg-transparent px-1 py-0.5 outline-none hover:border-zinc-300 focus:border-primary-500 dark:hover:border-zinc-700"
          />
          <span className="ml-auto flex items-center gap-2 text-zinc-500">
            {grooveMissing.length > 0 && (
              <button
                onClick={importFromGroove}
                disabled={busy}
                title={`Add contacts you've touched in Groove/Sales Nav but aren't tracked: ${grooveMissing.map((o) => o.name).join(', ')}`}
                className="rounded border border-primary-300 px-2 py-0.5 text-primary-700 hover:bg-primary-50 disabled:opacity-50 dark:border-primary-700 dark:text-primary-300 dark:hover:bg-primary-950/40"
              >
                ⤓ {grooveMissing.length} from Groove
              </button>
            )}
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
              remove ✕
            </button>
          </span>
        </div>
      )}

      {open && contacts.length > 0 ? (
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
                  o={matchOutreach(c)}
                  personas={tracker.personas}
                  statuses={tracker.contact_statuses}
                  busy={busy}
                  onPatch={(id, patch) => mutate(patchTrackerContact(id, patch))}
                  onDelete={(id) => mutate(deleteTrackerContact(id))}
                  targeted={c.id === targetId}
                  onTarget={onTarget}
                  onDraft={onDraft}
                  accountName={account.name}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : open ? (
        <p className="px-3 py-2 text-xs text-zinc-500">
          No contact rows yet — “+ contact” adds a to-find placeholder{researched ? ', or pull the dossier’s ICP contacts in' : ''}.
        </p>
      ) : null}
    </section>
  )
}

// Accounts you're actively touching in Groove/Sales Nav (per the SF task
// trail) that aren't in the tracker at all — the Monday-list crowd. One click
// creates the account (with its SF id) and pulls its touched contacts in.
function GrooveUntracked({ outreach, tracker, busy, mutate }) {
  const groups = useMemo(() => {
    if (!outreach || !tracker) return []
    const haveSfIds = new Set(tracker.accounts.map((a) => a.sfId).filter(Boolean))
    const haveNames = new Set(tracker.accounts.map((a) => a.name.toLowerCase()))
    const byAccount = new Map()
    for (const o of outreach.contacts) {
      if (!o.name || !o.account_name) continue
      if (haveSfIds.has(o.sf_account_id) || haveNames.has(o.account_name.toLowerCase())) continue
      const key = o.sf_account_id ?? o.account_name
      if (!byAccount.has(key)) byAccount.set(key, { name: o.account_name, sfId: o.sf_account_id, contacts: [] })
      byAccount.get(key).contacts.push(o)
    }
    return [...byAccount.values()].sort((a, b) => b.contacts.length - a.contacts.length)
  }, [outreach, tracker])

  if (groups.length === 0) return null

  const slugify = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  const addAccount = async (g) => {
    await mutate(addTrackerAccount({ id: slugify(g.name), name: g.name, sfId: g.sfId ?? null }))
    for (const o of g.contacts) {
      await mutate(
        addTrackerContact({
          accountId: slugify(g.name),
          name: o.name,
          title: o.title ?? null,
          persona: personaForTitle(o.title, tracker.personas),
          sfContactId: o.sf_contact_id,
        })
      )
    }
  }

  return (
    <section className="mt-6 rounded-lg border border-dashed border-zinc-300 p-4 dark:border-zinc-700">
      <h2 className="text-sm font-semibold tracking-wide text-zinc-500 uppercase">
        In Groove, not in the tracker
      </h2>
      <p className="mt-1 text-xs text-zinc-500">
        Accounts with touches in the Salesforce task trail (last {outreach.window_days} days) that have no tracker row —
        flow enrollments, Sales Nav pulls, the Monday list. Add the ones you're actually working.
      </p>
      <ul className="mt-2 space-y-1">
        {groups.map((g) => (
          <li key={g.sfId ?? g.name} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{g.name}</span>
            <span className="text-xs text-zinc-500">
              {g.contacts.length} contact{g.contacts.length === 1 ? '' : 's'}:{' '}
              {g.contacts.slice(0, 4).map((o) => o.name).join(', ')}
              {g.contacts.length > 4 ? '…' : ''}
            </span>
            <button
              onClick={() => addAccount(g)}
              disabled={busy}
              className="ml-auto rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              + add to tracker
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

// #/accounts — the working layer over the book. Thin by design: Salesforce
// stays system-of-record, the research dossiers stay the intel source; this
// is just who's being worked, at what step, with what hook.
export default function AccountsPage({ tracker, index, outreach, busy, mutate, navigate, targetId, onTarget, onSync, syncPending }) {
  const [query, setQuery] = useState('')
  const [draftFor, setDraftFor] = useState(null) // contact being drafted for

  // Groove-mirror lookup: sfContactId is authoritative; bare name match is the
  // fallback for rows created before the id existed (collision risk accepted).
  const outreachLookup = useMemo(() => {
    const byId = new Map()
    const byName = new Map()
    for (const o of outreach?.contacts ?? []) {
      if (o.sf_contact_id) byId.set(o.sf_contact_id, o)
      if (o.name) byName.set(o.name.toLowerCase(), o)
    }
    return { byId, byName }
  }, [outreach])
  const matchOutreach = (c) =>
    (c.sfContactId && outreachLookup.byId.get(c.sfContactId)) ||
    (c.name && outreachLookup.byName.get(c.name.toLowerCase())) ||
    null

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
          {outreach && ` · Groove synced ${relativeTime(outreach.retrieved_at)}`}
        </p>
        {onSync && (
          <button
            onClick={onSync}
            disabled={busy || syncPending}
            title="Pull the Groove/SF task trail (free, ~3 min)"
            className="rounded-md border border-zinc-300 px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            {syncPending ? '⟳ syncing…' : '⟳ sync Groove'}
          </button>
        )}
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
            outreach={outreach}
            busy={busy}
            mutate={mutate}
            navigate={navigate}
            targetId={targetId}
            onTarget={onTarget}
            matchOutreach={matchOutreach}
            onDraft={setDraftFor}
          />
        ))}
      </div>

      <GrooveUntracked outreach={outreach} tracker={tracker} busy={busy} mutate={mutate} />

      {draftFor && (
        <DraftPanel
          contact={draftFor}
          accountName={tracker.accounts.find((a) => a.id === draftFor.accountId)?.name ?? draftFor.accountId}
          onClose={() => setDraftFor(null)}
        />
      )}
    </div>
  )
}
