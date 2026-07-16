import { useCallback, useEffect, useRef, useState } from 'react'
import AccountList from './components/AccountList.jsx'
import AccountDetail from './components/AccountDetail.jsx'
import TodaysPicks from './components/TodaysPicks.jsx'
import PendingAccount from './components/PendingAccount.jsx'
import { fetchIndex, fetchAccount, fetchStatus, fetchSuggestions, requestRefresh, subscribeEvents } from './lib/data.js'
import { formatDateTime, relativeTime } from './lib/format.js'

function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const onChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  const slug = hash.startsWith('#/account/') ? hash.slice('#/account/'.length) : null
  return [slug, (s) => (window.location.hash = s ? `#/account/${s}` : '')]
}

function useTheme() {
  const [dark, setDark] = useState(() => localStorage.getItem('theme') !== 'light')
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])
  return [dark, setDark]
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
          <ul className="mt-2 space-y-1.5">
            {status.recent_runs.slice(0, 6).map((r, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${r.errors?.length ? 'bg-warning-500' : 'bg-success-500'}`} />
                <span className="font-medium">{(r.accounts_touched ?? []).join(', ') || r.mode}</span>
                <span className="text-xs text-zinc-500">
                  {r.mode} · {relativeTime(r.finished ?? r.started)}
                  {r.errors?.length ? ` · ${r.errors.length} note${r.errors.length === 1 ? '' : 's'}` : ''}
                </span>
              </li>
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
  const [slug, navigate] = useHashRoute()
  const [dark, setDark] = useTheme()
  const [index, setIndex] = useState(null)
  const [account, setAccount] = useState(null)
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

  // Live updates from the local server: data file changes + job lifecycle.
  useEffect(() => {
    loadStatus()
    return subscribeEvents({
      onData: (e) => {
        if (e.path.endsWith('index.json')) loadIndex()
        if (e.path.endsWith('suggestions.json')) loadSuggestions()
        const current = slugRef.current
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
  }, [loadIndex, loadStatus, loadSuggestions])

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
      return
    }
    setAccount(null)
    setError(null)
    fetchAccount(slug)
      .then(setAccount)
      .catch((e) => setError(e.message))
    detailRef.current?.scrollTo(0, 0)
  }, [slug])

  // "/" focuses search from anywhere (except while typing in an input).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        e.preventDefault()
        searchRef.current?.focus()
      }
      if (e.key === 'Escape' && slug) navigate(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [slug, navigate])

  return (
    <div className="flex h-screen flex-col">
      {/* ---- Top bar ---- */}
      <header className="flex shrink-0 items-center gap-3 border-b border-zinc-200 bg-white px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900">
        <button onClick={() => navigate(null)} className="flex items-center gap-2 text-base font-bold tracking-tight">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-500 text-[10px] font-extrabold text-white">
            G2
          </span>
          BDR Account Research
        </button>
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
          className="ml-auto rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          title="Toggle theme"
        >
          {dark ? '☀︎ light' : '☾ dark'}
        </button>
      </header>

      {/* ---- Two-pane workbench ---- */}
      <div className="flex min-h-0 flex-1">
        {/* Account rail. On narrow screens it swaps with the detail pane. */}
        <aside
          className={`w-full shrink-0 flex-col border-zinc-200 bg-white lg:flex lg:w-80 lg:border-r xl:w-96 dark:border-zinc-800 dark:bg-zinc-900 ${slug ? 'hidden' : 'flex'}`}
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
          className={`min-w-0 flex-1 overflow-y-auto bg-zinc-50 p-4 lg:block lg:p-6 dark:bg-zinc-950 ${slug ? 'block' : 'hidden'}`}
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

          {!slug && (
            <Home
              suggestions={suggestions}
              index={index}
              status={status}
              navigate={navigate}
              refresh={refresh}
              jobFor={jobFor}
            />
          )}

          {slug &&
            (account ? (
              <AccountDetail
                account={account}
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
    </div>
  )
}
