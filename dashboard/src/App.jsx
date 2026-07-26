import { useCallback, useEffect, useRef, useState } from 'react'
import AccountList from './components/AccountList.jsx'
import AccountDetail from './components/AccountDetail.jsx'
import TodaysPicks from './components/TodaysPicks.jsx'
import PendingAccount from './components/PendingAccount.jsx'
import ActivityBar from './components/ActivityBar.jsx'
import ActivityPage from './components/ActivityPage.jsx'
import AccountsPage from './components/AccountsPage.jsx'
import DayPage from './components/DayPage.jsx'
import { fetchIndex, fetchAccount, fetchActivity, fetchStatus, fetchSuggestions, requestRefresh, subscribeEvents } from './lib/data.js'
import { fetchTracker, logActivity, undoActivity } from './lib/tracker.js'
import { formatDateTime, relativeTime } from './lib/format.js'

function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const onChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  const slug = hash.startsWith('#/account/') ? hash.slice('#/account/'.length) : null
  const view =
    hash === '#/activity' ? 'activity' : hash === '#/accounts' ? 'accounts' : hash === '#/day' ? 'day' : slug ? 'account' : 'home'
  return [slug, view, (s) => (window.location.hash = s ? `#/account/${s}` : '')]
}

function useTheme() {
  const [dark, setDark] = useState(() => localStorage.getItem('theme') !== 'light')
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])
  return [dark, setDark]
}

// One recent-run row: click to expand the full run record. Account names
// link through to their pages (runs store slugs; failures store the query).
function RunRow({ run, index, navigate }) {
  const [open, setOpen] = useState(false)
  const mins =
    run.started && run.finished ? ((Date.parse(run.finished) - Date.parse(run.started)) / 60000).toFixed(1) : null
  const findAccount = (t) => (index?.accounts ?? []).find((a) => a.slug === t || a.domain === t)
  const touched = run.accounts_touched ?? []
  return (
    <li className="rounded border border-transparent">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-2 rounded px-1 py-1 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${run.errors?.length ? 'bg-warning-500' : 'bg-success-500'}`} />
        <span className="font-medium">{touched.join(', ') || run.mode}</span>
        <span className="text-xs text-zinc-500">
          {run.mode} · {relativeTime(run.finished ?? run.started)}
          {mins && ` · ${mins} min`}
          {run.errors?.length ? ` · ${run.errors.length} note${run.errors.length === 1 ? '' : 's'}` : ''}
        </span>
        <span className="ml-auto text-xs text-zinc-400">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="mt-1 mb-2 ml-4 space-y-2 border-l border-zinc-200 pl-3 text-sm dark:border-zinc-700">
          <p className="text-xs text-zinc-500">
            {run.id && <span className="font-mono">{run.id} · </span>}
            trigger: {run.trigger ?? '—'} · started {formatDateTime(run.started)}
            {run.finished && ` · finished ${formatDateTime(run.finished)}`}
            {run.credits_consuming_calls?.length > 0 &&
              ` · ${run.credits_consuming_calls.length} paid call${run.credits_consuming_calls.length === 1 ? '' : 's'} (${[...new Set(run.credits_consuming_calls.map((c) => c.tool))].join(', ')})`}
          </p>
          {touched.length > 0 && (
            <p className="flex flex-wrap gap-x-2 text-xs">
              {touched.map((t) => {
                const acc = findAccount(t)
                return acc ? (
                  <button
                    key={t}
                    onClick={() => navigate(acc.slug)}
                    className="text-info-500 hover:text-info-600 hover:underline dark:text-info-400"
                  >
                    {acc.name}
                  </button>
                ) : (
                  <span key={t} className="text-zinc-500">{t}</span>
                )
              })}
            </p>
          )}
          {run.errors?.length > 0 && (
            <ul className="list-outside list-disc space-y-1 pl-4 text-xs text-warning-700 dark:text-warning-300">
              {run.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
          {run.notes?.length > 0 && (
            <ul className="list-outside list-disc space-y-1 pl-4 text-xs text-zinc-600 dark:text-zinc-400">
              {(Array.isArray(run.notes) ? run.notes : [run.notes]).map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}

// Workbench home — fills the detail pane when no account is open.
function Home({ suggestions, index, status, navigate, refresh, jobFor }) {
  const researched = (index?.accounts ?? []).filter((a) => a.status === 'active').length
  const pending = (index?.accounts ?? []).filter((a) => a.status === 'pending_research').length
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-bold tracking-tight">Workbench</h1>
      <p className="mt-1 text-sm text-zinc-500">
        {index
          ? `${researched} researched · ${pending} pending research · index ${formatDateTime(index.generated_at)}`
          : 'Loading index…'}
      </p>
      <TodaysPicks
        suggestions={suggestions}
        index={index}
        onOpen={(s) => navigate(s)}
        onQueue={status ? (domain) => refresh(domain, 'deep') : null}
        jobFor={jobFor}
        deepCap={status?.deep_cap}
      />
      {status?.recent_runs?.length > 0 && (
        <section className="mt-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-semibold tracking-wide text-zinc-500 uppercase">Recent runs</h2>
          <ul className="mt-2 space-y-0.5">
            {status.recent_runs.slice(0, 8).map((r, i) => (
              <RunRow key={r.id ?? i} run={r} index={index} navigate={navigate} />
            ))}
          </ul>
        </section>
      )}
      <p className="mt-6 text-xs text-zinc-500">
        Pick an account from the rail, or press <kbd className="rounded border border-zinc-300 px-1 dark:border-zinc-700">/</kbd> to
        search. Accounts marked “not researched yet” can be queued for deep research from their page.
      </p>
    </div>
  )
}

export default function App() {
  const [slug, view, navigate] = useHashRoute()
  const [dark, setDark] = useTheme()
  const [index, setIndex] = useState(null)
  const [account, setAccount] = useState(null)
  const [activity, setActivity] = useState(null)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState(null) // null = server not running (read-only)
  const [notice, setNotice] = useState(null)
  const searchRef = useRef(null)
  const detailRef = useRef(null)
  const slugRef = useRef(slug)
  slugRef.current = slug

  const [suggestions, setSuggestions] = useState(null)

  const loadIndex = useCallback(() => {
    fetchIndex().then(setIndex).catch((e) => setError(e.message))
  }, [])

  useEffect(loadIndex, [loadIndex])

  const loadSuggestions = useCallback(() => {
    fetchSuggestions().then(setSuggestions)
  }, [])

  useEffect(loadSuggestions, [loadSuggestions])

  const loadStatus = useCallback(() => {
    fetchStatus().then(setStatus).catch(() => setStatus(null))
  }, [])

  // ---- Outreach tracker (activity logging — server API, data/tracker.json) ----
  const [tracker, setTracker] = useState(null)
  const [trackerBusy, setTrackerBusy] = useState(false)
  const loadTracker = useCallback(() => {
    fetchTracker().then(setTracker).catch(() => setTracker(null))
  }, [])
  const serverUp = Boolean(status)
  useEffect(() => {
    if (serverUp) loadTracker()
  }, [serverUp, loadTracker])

  // Mutations respond with the full refreshed summary — no follow-up GET.
  // Every tracker write funnels through here: state + error notice + busy flag.
  const trackerMutate = useCallback((promise) => {
    setTrackerBusy(true)
    return promise
      .then(setTracker)
      .catch((e) => setNotice({ tone: 'error', text: `Tracker: ${e.message}` }))
      .finally(() => setTrackerBusy(false))
  }, [])
  const trackerLog = useCallback(
    (type, outcome, contactId) =>
      trackerMutate(logActivity({ type, ...(outcome ? { outcome } : {}), ...(contactId ? { contactId } : {}) })),
    [trackerMutate]
  )
  const trackerUndo = useCallback((id) => trackerMutate(undoActivity(id)), [trackerMutate])

  // The activity bar's target: long-press a bar button to log against this
  // contact (sets lastTouch, advances step when it has a hook). Selected from
  // the Accounts table (◎) or a Day-view chip; toggles off on reselect.
  const [targetId, setTargetId] = useState(null)
  const onTarget = useCallback((id) => setTargetId((cur) => (cur === id ? null : id)), [])
  const targetContact = (tracker?.contacts ?? []).find((c) => c.id === targetId) ?? null

  // Live updates from the local server: data file changes + job lifecycle.
  useEffect(() => {
    loadStatus()
    return subscribeEvents({
      onData: (e) => {
        if (e.path.endsWith('index.json')) loadIndex()
        if (e.path.endsWith('suggestions.json')) loadSuggestions()
        if (e.path.endsWith('tracker.json')) loadTracker() // keeps other tabs in sync
        const current = slugRef.current
        if (current && e.path.endsWith(`activity/${current}.json`)) {
          fetchActivity(current).then(setActivity)
        }
        if (current && e.path.endsWith(`accounts/${current}.json`)) {
          // First deep run just landed for a previously-pending account —
          // clear the 404 error so the full detail view takes over.
          fetchAccount(current)
            .then((a) => {
              setAccount(a)
              setError(null)
            })
            .catch(() => {})
        }
      },
      onJob: (e) => {
        loadStatus()
        if (e.type === 'failed') setNotice({ tone: 'error', text: `Refresh failed: ${e.job.query} — ${e.error ?? 'see run log'}` })
        if (e.type === 'finished') setNotice({ tone: 'ok', text: `Refresh finished: ${e.job.query}` })
      },
    })
  }, [loadIndex, loadStatus, loadSuggestions, loadTracker])

  const refresh = useCallback((q, mode, opts) => {
    setNotice(null)
    requestRefresh(q, mode, opts)
      .then((r) => setNotice({ tone: 'ok', text: `Queued ${mode} refresh for ${r.job.query}${opts?.linkedin ? ' (with LinkedIn verify)' : ''}` }))
      .catch((e) => setNotice({ tone: 'error', text: e.message }))
  }, [])

  // Is a job for this query already queued or running?
  const jobFor = useCallback(
    (q) => status?.running?.query === q || status?.queue?.some((j) => j.query === q),
    [status]
  )

  // Account file 404s but the index knows the slug → light-run stub only,
  // no deep research yet. Render the pending view instead of an error.
  const pendingEntry =
    slug && !account && error ? ((index?.accounts ?? []).find((a) => a.slug === slug) ?? null) : null

  useEffect(() => {
    if (!slug) {
      setAccount(null)
      setActivity(null)
      return
    }
    setAccount(null)
    setActivity(null)
    setError(null)
    fetchAccount(slug)
      .then(setAccount)
      .catch((e) => setError(e.message))
    fetchActivity(slug).then(setActivity)
    detailRef.current?.scrollTo(0, 0)
  }, [slug])

  // "/" focuses search from anywhere (except while typing in an input).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        e.preventDefault()
        searchRef.current?.focus()
      }
      if (e.key === 'Escape' && (slug || view !== 'home')) navigate(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [slug, view, navigate])

  return (
    <div className="flex h-screen flex-col">
      {/* ---- Top bar: G2 brand wallpaper banner behind a legibility scrim ---- */}
      <header className="relative shrink-0 overflow-hidden border-b border-zinc-200 dark:border-zinc-800">
        <img src="/banner.jpg" alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover object-[50%_40%]" />
        <div className="absolute inset-0 bg-gradient-to-r from-white/90 via-white/70 to-white/35 dark:from-zinc-950/90 dark:via-zinc-950/70 dark:to-zinc-950/35" />
        <div className="relative flex items-center gap-3 px-4 py-3">
        <button onClick={() => navigate(null)} className="flex items-center gap-2 text-base font-bold tracking-tight">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-500 text-[10px] font-extrabold text-white">
            G2
          </span>
          BDR Account Research
        </button>
        {[
          ['day', 'Day'],
          ['activity', 'Activity'],
          ['accounts', 'Accounts'],
        ].map(([v, label]) => (
          <button
            key={v}
            onClick={() => (window.location.hash = `#/${v}`)}
            className={`rounded-md border px-2 py-1 text-xs backdrop-blur ${
              view === v
                ? 'border-primary-400 bg-primary-100/80 text-primary-700 dark:border-primary-700 dark:bg-primary-950/60 dark:text-primary-300'
                : 'border-zinc-300 bg-white/80 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-400 dark:hover:bg-zinc-800'
            }`}
          >
            {label}
          </button>
        ))}
        {status?.running && (
          <span className="animate-pulse rounded-full border border-primary-300 bg-primary-100 px-2 py-0.5 text-xs text-primary-700 motion-reduce:animate-none dark:border-primary-700 dark:bg-primary-950/60 dark:text-primary-300">
            ⟳ {status.running.query} ({status.running.mode})
          </span>
        )}
        {status?.queue?.length > 0 && (
          <span className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs text-zinc-500 dark:border-zinc-700">
            {status.queue.length} queued
          </span>
        )}
        {!status && <span className="text-xs text-zinc-500">read-only — server offline</span>}
        <button
          onClick={() => setDark(!dark)}
          className="ml-auto rounded-md border border-zinc-300 bg-white/80 px-2 py-1 text-xs text-zinc-600 backdrop-blur hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-400 dark:hover:bg-zinc-800"
          title="Toggle theme"
        >
          {dark ? '☀︎ light' : '☾ dark'}
        </button>
        </div>
      </header>

      {/* ---- Two-pane workbench ---- */}
      <div className="flex min-h-0 flex-1">
        {/* Account rail. On narrow screens it swaps with the detail pane. */}
        <aside
          className={`w-full shrink-0 flex-col border-zinc-200 bg-white lg:flex lg:w-80 lg:border-r xl:w-96 dark:border-zinc-800 dark:bg-zinc-900 ${view !== 'home' ? 'hidden' : 'flex'}`}
        >
          <div className="shrink-0 border-b border-zinc-200 p-3 dark:border-zinc-800">
            <input
              ref={searchRef}
              type="search"
              name="account-search"
              aria-label="Search accounts"
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder='Search accounts… ("/")'
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-primary-600 focus:ring-2 focus:ring-primary-300/50 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-primary-400 dark:focus:ring-primary-700/40"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {index ? (
              <AccountList index={index} query={query} selected={slug} onOpen={(s) => navigate(s)} />
            ) : (
              !error && <p className="mt-10 text-center text-sm text-zinc-500">Loading…</p>
            )}
          </div>
        </aside>

        {/* Detail pane */}
        <main
          ref={detailRef}
          className={`min-w-0 flex-1 overflow-y-auto bg-zinc-50 p-4 lg:block lg:p-6 dark:bg-zinc-950 ${view !== 'home' ? 'block' : 'hidden'}`}
        >
          {notice && (
            <div
              aria-live="polite"
              className={
                notice.tone === 'error'
                  ? 'mb-4 flex items-start justify-between rounded-lg border border-brand-300 bg-brand-50 p-3 text-sm text-brand-700 dark:border-brand-900 dark:bg-brand-950/60 dark:text-brand-300'
                  : 'mb-4 flex items-start justify-between rounded-lg border border-success-300 bg-success-100 p-3 text-sm text-success-700 dark:border-success-700 dark:bg-success-900/60 dark:text-success-300'
              }
            >
              <span>{notice.text}</span>
              <button onClick={() => setNotice(null)} aria-label="Dismiss notice" className="ml-3 opacity-60 hover:opacity-100">✕</button>
            </div>
          )}

          {error && !pendingEntry && !(slug && !index) && (
            <div className="mb-4 rounded-lg border border-brand-300 bg-brand-50 p-3 text-sm text-brand-700 dark:border-brand-900 dark:bg-brand-950/60 dark:text-brand-300">
              Failed to load data: {error}
            </div>
          )}

          {view === 'home' && (
            <Home
              suggestions={suggestions}
              index={index}
              status={status}
              navigate={navigate}
              refresh={refresh}
              jobFor={jobFor}
            />
          )}

          {view === 'activity' &&
            (serverUp ? (
              <ActivityPage tracker={tracker} onUndo={trackerUndo} busy={trackerBusy} />
            ) : (
              <p className="mt-10 text-center text-sm text-zinc-500">
                Activity tracking needs the local server — it's offline (read-only mode).
              </p>
            ))}

          {view === 'accounts' &&
            (serverUp ? (
              <AccountsPage
                tracker={tracker}
                index={index}
                busy={trackerBusy}
                mutate={trackerMutate}
                navigate={navigate}
                targetId={targetId}
                onTarget={onTarget}
              />
            ) : (
              <p className="mt-10 text-center text-sm text-zinc-500">
                The account tracker needs the local server — it's offline (read-only mode).
              </p>
            ))}

          {view === 'day' &&
            (serverUp ? (
              <DayPage tracker={tracker} targetId={targetId} onTarget={onTarget} />
            ) : (
              <p className="mt-10 text-center text-sm text-zinc-500">
                The daily view needs the local server — it's offline (read-only mode).
              </p>
            ))}

          {slug &&
            (account ? (
              <AccountDetail
                account={account}
                activity={activity}
                onBack={() => navigate(null)}
                onRefresh={status ? (mode, opts) => refresh(account.domain, mode, opts) : null}
                refreshPending={jobFor(account.domain)}
              />
            ) : pendingEntry ? (
              <PendingAccount
                entry={pendingEntry}
                onBack={() => navigate(null)}
                onRefresh={status ? (mode, opts) => refresh(pendingEntry.domain, mode, opts) : null}
                refreshPending={jobFor(pendingEntry.domain)}
              />
            ) : (
              !error && <p className="mt-10 text-center text-sm text-zinc-500">Loading {slug}…</p>
            ))}
        </main>
      </div>

      {/* ---- One-tap activity logging, visible on every view ---- */}
      {serverUp && tracker && (
        <ActivityBar
          tracker={tracker}
          targetContact={targetContact}
          onClearTarget={() => setTargetId(null)}
          onLog={trackerLog}
          onUndo={trackerUndo}
          busy={trackerBusy}
        />
      )}
    </div>
  )
}
