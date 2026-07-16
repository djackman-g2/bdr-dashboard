import { useState } from 'react'
import Badge from './Badge.jsx'

// Detail view for accounts the light run has indexed but no deep run has
// researched yet — there is no data/accounts/{slug}.json, only the index
// stub (SF basics). Main job: let the user kick off the deep research that
// was previously unreachable (the button lived on the 404ing detail page).
export default function PendingAccount({ entry, onBack, onRefresh, refreshPending }) {
  const [linkedin, setLinkedin] = useState(false)

  return (
    <div className="space-y-4">
      <div>
        <button onClick={onBack} className="text-sm text-info-500 hover:text-info-600 hover:underline dark:text-info-400">
          ← All accounts
        </button>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">{entry.name}</h1>
          <a
            href={`https://${entry.domain}`}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-info-500 hover:text-info-600 hover:underline dark:text-info-400"
          >
            {entry.domain}
          </a>
          <Badge tone="amber">not researched yet</Badge>
        </div>
        {entry.industry && <p className="mt-1 text-sm text-zinc-500">{entry.industry}</p>}
      </div>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Only Salesforce basics have been synced for this account (nightly light run). Run a deep refresh to
          build the full dossier — firmographics, news, signals, ICP contacts, Gong history, G2 presence, and
          messaging. Takes a few minutes; this page updates automatically when it lands.
        </p>
        {onRefresh ? (
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={() => onRefresh('deep', { linkedin })}
              disabled={refreshPending}
              title="Full pipeline: enrichment, news, contacts, messaging (uses ZoomInfo credits; daily cap applies)"
              className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-brand-500"
            >
              {refreshPending ? '⟳ research queued…' : '⟳ Run deep research'}
            </button>
            <label
              title="Opt this run into LinkedIn contact verification (low-volume; reserve for accounts you're about to call)"
              className="flex cursor-pointer items-center gap-1 text-xs text-zinc-600 dark:text-zinc-400"
            >
              <input
                type="checkbox"
                checked={linkedin}
                onChange={(e) => setLinkedin(e.target.checked)}
                disabled={refreshPending}
                className="h-3.5 w-3.5 accent-primary-500"
              />
              LinkedIn verify
            </label>
          </div>
        ) : (
          <p className="mt-3 text-xs text-zinc-500">Local server not running — start it to queue research.</p>
        )}
      </section>
    </div>
  )
}
