import { useState } from 'react'
import Badge from './Badge.jsx'
import { relativeTime } from '../lib/format.js'

// 7G-1 — AI-visibility card (the AEO play). Shows whether this company comes
// up when a buyer asks an LLM for a shortlist in their category, and who gets
// cited. The check runs server-side (2-3 small completions through the chat
// proxy — no MCPs, no credits); results land in the dossier's ai_visibility
// section and SSE reloads the page data. Honesty rule: if the company DOES
// appear, the angle flips to "you're showing up — here's who controls whether
// that continues"; the result is data, never copy to bend.
export default function AiVisibility({ slug, data, serverUp }) {
  const [running, setRunning] = useState(false)
  const [error, setError] = useState(null)

  if (!data && !serverUp) return null

  async function run() {
    setRunning(true)
    setError(null)
    try {
      const res = await fetch(`/api/ai-visibility/${slug}`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      // The dossier file changed on disk — SSE pushes the reload; nothing to do.
    } catch (err) {
      setError(err.message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 flex items-center gap-2 border-l-2 border-brand-500 pl-2">
        <h2 className="text-sm font-semibold tracking-wide text-zinc-500 uppercase">AI visibility</h2>
        {data?.as_of && <span className="text-xs text-zinc-500">as of {relativeTime(data.as_of)}</span>}
        {serverUp && (
          <button
            onClick={run}
            disabled={running}
            title="Ask an LLM the questions a buyer would (category shortlist, head-to-head, reviews) and record whether this company shows up and whether G2 is cited. Runs server-side in seconds; no enrichment credits."
            className="ml-auto rounded-md border border-primary-400 px-2 py-0.5 text-xs font-semibold text-primary-700 hover:bg-primary-600 hover:text-white disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-primary-700 dark:text-primary-300 dark:hover:text-white"
          >
            {running ? '⟳ running…' : data ? '⟳ re-run' : '⟳ run check'}
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
          Not yet run — checks whether this company shows up when a buyer asks an LLM for a shortlist
          in their category, and who gets cited.
        </p>
      ) : (
        <>
          {data.summary && <p className="mb-3 text-sm font-medium">{data.summary}</p>}
          <ul className="space-y-3">
            {data.queries.map((q, i) => (
              <li key={i} className="rounded border border-zinc-200 p-2 dark:border-zinc-700">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={q.company_appeared ? 'green' : 'red'}>
                    {q.company_appeared ? 'appeared' : 'absent'}
                  </Badge>
                  <span className="text-sm font-medium">“{q.prompt}”</span>
                  {q.g2_cited && <Badge tone="blue">G2 cited</Badge>}
                </div>
                {q.companies_returned?.length > 0 && (
                  <p className="mt-1 text-xs text-zinc-500">
                    Returned: {q.companies_returned.join(', ')}
                  </p>
                )}
                {q.sources_cited?.length > 0 && (
                  <p className="mt-0.5 text-xs text-zinc-500">Sources: {q.sources_cited.join(' · ')}</p>
                )}
                {q.raw_excerpt && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-info-500 hover:text-info-600 dark:text-info-400">
                      raw answer ({q.model})
                    </summary>
                    <pre className="mt-1 max-h-64 overflow-auto rounded bg-zinc-50 p-2 text-xs whitespace-pre-wrap text-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-400">
                      {q.raw_excerpt}
                    </pre>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
