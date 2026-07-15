import { useCallback, useEffect, useRef, useState } from 'react'
import AccountList from './components/AccountList.jsx'
import AccountDetail from './components/AccountDetail.jsx'
import { fetchIndex, fetchAccount, fetchStatus, requestRefresh, subscribeEvents } from './lib/data.js'
import { formatDateTime } from './lib/format.js'

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
  const slugRef = useRef(slug)
  slugRef.current = slug

  const loadIndex = useCallback(() => {
    fetchIndex().then(setIndex).catch((e) => setError(e.message))
  }, [])

  useEffect(loadIndex, [loadIndex])

  const loadStatus = useCallback(() => {
    fetchStatus().then(setStatus).catch(() => setStatus(null))
  }, [])

  // Live updates from the local server: data file changes + job lifecycle.
  useEffect(() => {
    loadStatus()
    return subscribeEvents({
      onData: (e) => {
        if (e.path.endsWith('index.json')) loadIndex()
        const current = slugRef.current
        if (current && e.path.endsWith(`accounts/${current}.json`)) {
          fetchAccount(current).then(setAccount).catch(() => {})
        }
      },
      onJob: (e) => {
        loadStatus()
        if (e.type === 'failed') setNotice({ tone: 'error', text: `Refresh failed: ${e.job.query} — ${e.error ?? 'see run log'}` })
        if (e.type === 'finished') setNotice({ tone: 'ok', text: `Refresh finished: ${e.job.query}` })
      },
    })
  }, [loadIndex, loadStatus])

  const refresh = useCallback((q, mode) => {
    setNotice(null)
    requestRefresh(q, mode)
      .then((r) => setNotice({ tone: 'ok', text: `Queued ${mode} refresh for ${r.job.query}` }))
      .catch((e) => setNotice({ tone: 'error', text: e.message }))
  }, [])

  // Is a job for this query already queued or running?
  const jobFor = useCallback(
    (q) => status?.running?.query === q || status?.queue?.some((j) => j.query === q),
    [status]
  )

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
  }, [slug])

  // "/" focuses search from anywhere (except while typing in an input).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        e.preventDefault()
        navigate(null)
        requestAnimationFrame(() => searchRef.current?.focus())
      }
      if (e.key === 'Escape' && slug) navigate(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [slug, navigate])

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-4 py-6">
      <header className="flex items-center gap-3">
        <button onClick={() => navigate(null)} className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-500 text-[10px] font-extrabold text-white">
            G2
          </span>
          BDR Account Research
        </button>
        <span className="text-xs text-zinc-500">
          {index && `index ${formatDateTime(index.generated_at)}`}
        </span>
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
        <button
          onClick={() => setDark(!dark)}
          className="ml-auto rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          title="Toggle theme"
        >
          {dark ? '☀︎ light' : '☾ dark'}
        </button>
      </header>

      {notice && (
        <div
          aria-live="polite"
          className={
            notice.tone === 'error'
              ? 'mt-4 flex items-start justify-between rounded-lg border border-brand-300 bg-brand-50 p-3 text-sm text-brand-700 dark:border-brand-900 dark:bg-brand-950/60 dark:text-brand-300'
              : 'mt-4 flex items-start justify-between rounded-lg border border-success-300 bg-success-100 p-3 text-sm text-success-700 dark:border-success-700 dark:bg-success-900/60 dark:text-success-300'
          }
        >
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss notice" className="ml-3 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg border border-brand-300 bg-brand-50 p-3 text-sm text-brand-700 dark:border-brand-900 dark:bg-brand-950/60 dark:text-brand-300">
          Failed to load data: {error}
        </div>
      )}

      {!slug && (
        <main className="mt-4">
          <input
            ref={searchRef}
            type="search"
            name="account-search"
            aria-label="Search accounts"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='Search accounts… (press "/" to focus)'
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-primary-600 focus:ring-2 focus:ring-primary-300/50 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-primary-400 dark:focus:ring-primary-700/40"
          />
          {index ? (
            <AccountList index={index} query={query} onOpen={(s) => navigate(s)} />
          ) : (
            !error && <p className="mt-10 text-center text-sm text-zinc-500">Loading…</p>
          )}
        </main>
      )}

      {slug && (
        <main className="mt-4">
          {account ? (
            <AccountDetail
              account={account}
              onBack={() => navigate(null)}
              onRefresh={status ? (mode) => refresh(account.domain, mode) : null}
              refreshPending={jobFor(account.domain)}
            />
          ) : (
            !error && <p className="mt-10 text-center text-sm text-zinc-500">Loading {slug}…</p>
          )}
        </main>
      )}
    </div>
  )
}
