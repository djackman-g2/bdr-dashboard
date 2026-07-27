import { useCallback, useEffect, useRef, useState } from 'react'
import { CopyBtn } from './AccountsPage.jsx'

// Due page — the morning batch desk. Upload the Groove flow due-list export
// (Name,Email,SFDC ID,Account,Current Step) and the server drafts one
// thread-aware next-step message per person (scripts/draft-due-csv.js);
// results render here with copy buttons, grouped by account with the
// account's flags on top. Results also live in data/drafts/due-<date>.{json,md}.

function badge(text, tone) {
  const tones = {
    play: 'border-primary-300 bg-primary-100 text-primary-700 dark:border-primary-700 dark:bg-primary-950/60 dark:text-primary-300',
    channel: 'border-zinc-300 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400',
    error: 'border-red-300 bg-red-100 text-red-700 dark:border-red-800 dark:bg-red-950/60 dark:text-red-300',
  }
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] ${tones[tone]}`}>{text}</span>
  )
}

function DraftCard({ r }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{r.name}</span>
        {r.step && <span className="text-xs text-zinc-500">{r.step}</span>}
        <span className="grow" />
        {r.error ? badge('failed', 'error') : (
          <>
            {badge(r.draft.play, 'play')}
            {badge(r.draft.channel, 'channel')}
          </>
        )}
      </div>
      {r.error ? (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">
          {r.error} — draft this one by hand from the Accounts page (✍).
        </p>
      ) : (
        <div className="mt-2 space-y-2">
          {r.draft.subject && (
            <div className="flex items-center gap-2">
              <span className="min-w-0 truncate text-sm font-medium">{r.draft.subject}</span>
              <CopyBtn text={r.draft.subject} label="copy subject" />
            </div>
          )}
          <div className="flex items-start gap-2">
            <p className="min-w-0 grow whitespace-pre-wrap rounded bg-zinc-50 p-2 text-sm leading-relaxed dark:bg-zinc-950/60">
              {r.draft.body}
            </p>
            <CopyBtn text={r.draft.body} label="copy body" />
          </div>
        </div>
      )}
    </div>
  )
}

export default function DuePage() {
  const [status, setStatus] = useState(null)
  const [results, setResults] = useState(null)
  const [error, setError] = useState(null)
  const fileRef = useRef(null)

  const poll = useCallback(async () => {
    try {
      const res = await fetch('/api/draft-due')
      if (res.ok) setStatus(await res.json())
    } catch {
      /* server hiccup — next poll retries */
    }
  }, [])

  useEffect(() => {
    poll()
  }, [poll])

  useEffect(() => {
    if (!status?.running) return
    const t = setInterval(poll, 2500)
    return () => clearInterval(t)
  }, [status?.running, poll])

  // Load the newest results file on mount and again when a run finishes.
  useEffect(() => {
    const path = status?.latest?.path
    if (!path) return
    fetch(path, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setResults(j))
      .catch(() => {})
  }, [status?.latest?.path, status?.finishedAt])

  const upload = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    const text = await file.text()
    const rows = Math.max(0, text.trim().split('\n').length - 1)
    if (!window.confirm(`Draft messages for "${file.name}" (~${rows} people)? One API call per person, a few minutes total.`)) return
    setError(null)
    try {
      const res = await fetch('/api/draft-due', {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv' },
        body: text,
      })
      if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`)
    } catch (err) {
      setError(err.message)
    }
    poll()
  }

  const drafts = results?.drafts ?? []
  const byAccount = new Map()
  for (const r of drafts) {
    if (!byAccount.has(r.account)) byAccount.set(r.account, [])
    byAccount.get(r.account).push(r)
  }
  const today = new Date().toLocaleDateString('en-CA')

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold">Due today</h2>
        <span className="grow" />
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={upload} />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={status?.running}
          className="rounded-md border border-primary-400 bg-primary-100/80 px-3 py-1.5 text-sm font-medium text-primary-700 hover:bg-primary-200 disabled:opacity-50 dark:border-primary-700 dark:bg-primary-950/60 dark:text-primary-300 dark:hover:bg-primary-900"
        >
          ⇪ Upload due-list CSV
        </button>
      </div>
      <p className="text-xs text-zinc-500">
        Export today's due list from Groove (Flows → due) and upload it — the server builds context per person
        (dossier, persona, thread history, flags) and drafts every message. Failed rows never block the rest.
      </p>

      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}

      {status?.running && (
        <div
          className="rounded-md border border-primary-300 bg-primary-50 p-3 text-sm dark:border-primary-800 dark:bg-primary-950/40"
          aria-live="polite"
        >
          <span className="animate-pulse motion-reduce:animate-none">⟳ drafting…</span>{' '}
          {status.total ? `${status.done}/${status.total}` : 'resolving contacts'}
          {status.failed > 0 && <span className="text-red-600 dark:text-red-400"> · {status.failed} failed</span>}
          {status.lastLine && <p className="mt-1 truncate font-mono text-xs text-zinc-500">{status.lastLine}</p>}
        </div>
      )}

      {!status?.running && status?.finishedAt && status.exitCode !== 0 && (
        <p className="rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
          The last batch exited with an error{status.lastLine ? ` — ${status.lastLine}` : ''}. Check the upload and retry.
        </p>
      )}

      {results ? (
        <>
          <p className="text-xs text-zinc-500">
            {results.date === today ? 'Today' : results.date} · {drafts.filter((r) => r.draft).length} drafted
            {drafts.some((r) => r.error) && ` · ${drafts.filter((r) => r.error).length} failed`} · from{' '}
            {results.source}
            {results.date !== today && ' — stale: upload today’s export.'}
          </p>
          {[...byAccount].map(([account, list]) => {
            const flags = [...new Set(list.flatMap((r) => r.draft?.flag_warnings ?? []))]
            return (
              <section key={account} className="space-y-2">
                <h3 className="text-sm font-bold">
                  {account} <span className="font-normal text-zinc-500">({list.length})</span>
                </h3>
                {flags.map((f) => (
                  <p
                    key={f}
                    className="rounded-md border border-warning-300 bg-warning-100/60 p-2 text-xs text-zinc-700 dark:border-warning-950 dark:bg-warning-950/40 dark:text-zinc-300"
                  >
                    ⚑ {f}
                  </p>
                ))}
                {list.map((r) => (
                  <DraftCard key={`${r.contactId}-${r.name}`} r={r} />
                ))}
              </section>
            )
          })}
        </>
      ) : (
        !status?.running && (
          <p className="mt-10 text-center text-sm text-zinc-500">
            No batch yet — upload the Groove due-list CSV to draft everyone due today.
          </p>
        )
      )}
    </div>
  )
}
