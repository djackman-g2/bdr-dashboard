import { useState } from 'react'
import Badge from './Badge.jsx'
import { relativeTime } from '../lib/format.js'

// Community/UGC card — real user threads about this company (Reddit official
// API + Hacker News), LLM-classified for relevance. Feeds the ugc-narrative
// play: users' public chatter is what LLMs learn from. Runs server-side (two
// free HTTP sources + one small classification call — no MCPs, no credits).
// Guardrail: the classifier vets relevance, not tone — READ a thread before
// citing it in outreach, and never quote criticism back at the prospect.
const SENTIMENT_TONE = { positive: 'green', negative: 'red', mixed: 'amber', neutral: 'gray' }

export default function Community({ slug, data, serverUp }) {
  const [running, setRunning] = useState(false)
  const [error, setError] = useState(null)

  if (!data && !serverUp) return null

  async function run() {
    setRunning(true)
    setError(null)
    try {
      const res = await fetch(`/api/community/${slug}`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      // Dossier changed on disk — SSE pushes the reload.
    } catch (err) {
      setError(err.message)
    } finally {
      setRunning(false)
    }
  }

  const relevant = (data?.threads ?? []).filter((t) => t.relevant)
  const rejected = (data?.threads ?? []).length - relevant.length
  const redditSkipped = data?.sources_checked?.find((s) => s.source === 'reddit' && s.status !== 'ok')

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 flex items-center gap-2 border-l-2 border-brand-500 pl-2">
        <h2 className="text-sm font-semibold tracking-wide text-zinc-500 uppercase">Community chatter</h2>
        {data?.as_of && <span className="text-xs text-zinc-500">as of {relativeTime(data.as_of)}</span>}
        {serverUp && (
          <button
            onClick={run}
            disabled={running}
            title="Search Reddit + Hacker News for real user threads about this company (LLM-vetted for relevance). UGC feeds LLM buyer journeys — raw material for the ugc-narrative play. Free; no enrichment credits."
            className="ml-auto rounded-md border border-primary-400 px-2 py-0.5 text-xs font-semibold text-primary-700 hover:bg-primary-600 hover:text-white disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-primary-700 dark:text-primary-300 dark:hover:text-white"
          >
            {running ? '⟳ searching…' : data ? '⟳ re-run' : '⟳ run sweep'}
          </button>
        )}
      </div>

      {error && (
        <p className="mb-2 rounded border border-warning-300 bg-warning-50 p-2 text-xs text-warning-700 dark:border-warning-700 dark:bg-warning-700/20 dark:text-warning-300">
          {error}
        </p>
      )}

      {!data ? (
        <p className="text-sm text-zinc-500">
          Not yet run — sweeps Reddit + Hacker News for threads where this company's users are
          talking. That content feeds LLM buyer journeys (the ugc-narrative play).
        </p>
      ) : (
        <>
          {data.summary && <p className="mb-2 text-sm font-medium">{data.summary}</p>}
          {redditSkipped && (
            <p className="mb-2 rounded border border-warning-300 bg-warning-50 p-2 text-xs text-warning-700 dark:border-warning-700 dark:bg-warning-700/20 dark:text-warning-300">
              Reddit {redditSkipped.status === 'skipped_no_creds' ? 'not checked — no API creds in the Keychain' : `error: ${redditSkipped.note}`}
              {redditSkipped.status === 'skipped_no_creds' && ' (HN-only results)'}
            </p>
          )}
          {relevant.length === 0 ? (
            <p className="text-sm text-zinc-500">No relevant threads found in the window.</p>
          ) : (
            <ul className="space-y-2">
              {relevant.map((t, i) => (
                <li key={i} className="rounded border border-zinc-200 p-2 dark:border-zinc-700">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={t.feedback ? 'blue' : 'gray'}>{t.feedback ? 'feedback' : 'mention'}</Badge>
                    {t.sentiment && <Badge tone={SENTIMENT_TONE[t.sentiment] ?? 'gray'}>{t.sentiment}</Badge>}
                    <a
                      href={t.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-medium text-info-600 hover:underline dark:text-info-400"
                    >
                      {t.title}
                    </a>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    {[t.subreddit ?? (t.source === 'hackernews' ? 'Hacker News' : t.source), t.created, t.score != null && `↑${t.score}`, t.comments != null && `${t.comments} comments`]
                      .filter(Boolean)
                      .join(' · ')}
                    {t.note ? ` — ${t.note}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {rejected > 0 && (
            <p className="mt-2 text-xs text-zinc-500">
              {rejected} more hit{rejected === 1 ? '' : 's'} classified not-this-company and hidden.
            </p>
          )}
          <p className="mt-2 text-xs text-zinc-500">
            Read a thread before citing it — the classifier vets relevance, not tone.
          </p>
        </>
      )}
    </section>
  )
}
