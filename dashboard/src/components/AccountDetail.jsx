import { useState } from 'react'
import Badge, { ConfidenceBadge, VerifiedValueBadge, ContactVerificationBadge } from './Badge.jsx'
import SignalsTimeline from './SignalsTimeline.jsx'
import ChatPanel from './ChatPanel.jsx'
import AiVisibility from './AiVisibility.jsx'
import Community from './Community.jsx'
import SfActivity from './SfActivity.jsx'
import Storyline from './Storyline.jsx'
import { formatDate, formatDateTime, formatMoney, relativeTime } from '../lib/format.js'
import { toBullets } from '../lib/prose.js'

function Section({
  title,
  children,
  aside,
  onSectionRefresh,
  refreshPending,
  refreshLabel = '⟳ refresh',
  refreshTitle = 'Refresh just this section (fast, free — no enrichment credits, no deep-cap slot)',
}) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 flex items-center gap-2 border-l-2 border-brand-500 pl-2">
        <h2 className="text-sm font-semibold tracking-wide text-zinc-500 uppercase">{title}</h2>
        {aside}
        {onSectionRefresh && (
          <button
            onClick={onSectionRefresh}
            disabled={refreshPending}
            title={refreshTitle}
            className="ml-auto rounded-md border border-primary-400 px-2 py-0.5 text-xs font-semibold text-primary-700 hover:bg-primary-600 hover:text-white disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-primary-700 dark:text-primary-300 dark:hover:text-white"
          >
            {refreshPending ? '⟳ queued…' : refreshLabel}
          </button>
        )}
      </div>
      {children}
    </section>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="text-sm">{children ?? '—'}</dd>
    </div>
  )
}

// Long pipeline prose renders as bullets (display-only — the JSON is untouched
// and every sentence is kept). Short text stays a paragraph.
function Prose({ text, className = 'text-sm text-zinc-600 dark:text-zinc-400' }) {
  if (!text) return null
  const bullets = toBullets(text)
  if (!bullets) return <p className={className}>{text}</p>
  return (
    <ul className={`list-outside list-disc space-y-1 pl-4 marker:text-zinc-400 dark:marker:text-zinc-600 ${className}`}>
      {bullets.map((b, i) => (
        <li key={i}>{b}</li>
      ))}
    </ul>
  )
}

function SourceList({ sources }) {
  if (!sources?.length) return null
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-zinc-500">
      {sources.map((s, i) => (
        <li key={i}>
          {s.url ? (
            <a href={s.url} target="_blank" rel="noreferrer" className="text-info-500 hover:text-info-600 hover:underline dark:text-info-400">
              {s.source}
            </a>
          ) : (
            <span className="font-medium">{s.source}</span>
          )}
          {s.note && <span> — {s.note}</span>}
        </li>
      ))}
    </ul>
  )
}

function VerifiedValue({ label, vv }) {
  if (!vv) return <Field label={label}>—</Field>
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="text-sm">
        <span className="mr-2 font-medium">{vv.display ?? vv.value ?? '—'}</span>
        <VerifiedValueBadge status={vv.status} />
        <SourceList sources={vv.sources} />
      </dd>
    </div>
  )
}

// Failures get the warning panel; sources skipped by standing policy (kind:
// "deferred_by_design") render as one quiet line — they're expected, not alarming.
function SourcesMissing({ sources }) {
  const missing = sources ?? []
  const failed = missing.filter((s) => s.kind !== 'deferred_by_design')
  const deferred = missing.filter((s) => s.kind === 'deferred_by_design')
  if (!missing.length) return null
  return (
    <div className="space-y-2">
      {failed.length > 0 && (
        <div className="rounded-lg border border-warning-300 bg-warning-50 p-3 text-sm dark:border-warning-700 dark:bg-warning-700/20">
          <p className="font-medium text-warning-700 dark:text-warning-300">
            {failed.length} source{failed.length === 1 ? '' : 's'} unavailable this run
          </p>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-warning-700 dark:text-warning-300/90">
            {failed.map((s, i) => (
              <li key={i}>
                <span className="font-medium">{s.source}</span> — {s.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {deferred.length > 0 && (
        <p className="text-xs text-zinc-500">
          Deferred by policy:{' '}
          {deferred.map((s, i) => (
            <span key={i} title={s.reason}>
              {i > 0 && ' · '}
              {s.source}
            </span>
          ))}
        </p>
      )}
    </div>
  )
}

export default function AccountDetail({ account, activity, onBack, onRefresh, refreshPending }) {
  const a = account
  const sf = a.salesforce ?? {}
  const fg = a.firmographics ?? {}
  // LinkedIn verification is opt-in per refresh — keeps automation volume a
  // deliberate choice for the accounts you're actually about to call.
  const [linkedin, setLinkedin] = useState(false)

  return (
    // flex column (not space-y): flex gaps don't collapse with the command
    // bar's negative margins, so content never slides under it at scroll 0.
    <div className="flex flex-col gap-4">
      {/* ---- Sticky command bar: identity + refresh controls stay in reach ---- */}
      <div className="sticky top-0 z-10 rounded-lg border border-zinc-200 bg-white/95 px-3 py-2.5 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <button onClick={onBack} className="text-sm text-info-500 hover:text-info-600 hover:underline lg:hidden dark:text-info-400">
            ←
          </button>
          <h1 className="text-lg font-bold tracking-tight">{a.name}</h1>
          <a
            href={`https://${a.domain}`}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-info-500 hover:text-info-600 hover:underline dark:text-info-400"
          >
            {a.domain}
          </a>
          {a.status === 'archived' && <Badge tone="gray">archived</Badge>}
          <ConfidenceBadge level={a.confidence} />
          <Badge tone="blue">{a.refresh_mode} refresh</Badge>
          <span className="text-xs text-zinc-500" title={a.refreshed_at}>
            refreshed {relativeTime(a.refreshed_at)}
            {a.last_deep_refresh_at && ` · last deep ${relativeTime(a.last_deep_refresh_at)}`}
          </span>
          {onRefresh && (
            <span className="ml-auto flex items-center gap-2">
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
              <button
                onClick={() => onRefresh('deep', { linkedin })}
                disabled={refreshPending}
                title="Full pipeline: enrichment, news, contacts, messaging (uses ZoomInfo credits; daily cap applies)"
                className="rounded-md bg-brand-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-600 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-brand-500"
              >
                {refreshPending ? '⟳ refresh queued…' : '⟳ Deep refresh'}
              </button>
            </span>
          )}
        </div>
      </div>

      <Prose text={fg.description} className="max-w-4xl text-sm text-zinc-600 dark:text-zinc-400" />

      <SourcesMissing sources={a.sources_missing} />

      {/* ---- Workbench grid: working column + reference column ---- */}
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
        {/* Working column: what you use while writing / calling */}
        <div className="min-w-0 space-y-4 xl:col-span-2">
          {onRefresh && <ChatPanel key={a.slug} slug={a.slug} />}

          {a.messaging && (a.messaging.angles?.length || a.messaging.openers?.length || a.messaging.things_to_probe?.length) && (
            <Section
              title="Messaging"
              aside={a.messaging.generated_at && <span className="text-xs text-zinc-500">generated {relativeTime(a.messaging.generated_at)}</span>}
              onSectionRefresh={onRefresh && (() => onRefresh('section', { section: 'messaging' }))}
              refreshPending={refreshPending}
            >
              {a.messaging.angles?.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-zinc-500">Angles</p>
                  <ul className="mt-1 space-y-2">
                    {a.messaging.angles.map((m, i) => (
                      <li key={i} className="text-sm">
                        {m.angle}
                        <p className="text-xs text-zinc-500">grounded in: {m.grounded_in}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {a.messaging.openers?.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-medium text-zinc-500">Openers</p>
                  <ul className="mt-1 space-y-2">
                    {a.messaging.openers.map((o, i) => (
                      <li key={i} className="rounded border border-zinc-200 bg-zinc-50 p-2 text-sm dark:border-zinc-700 dark:bg-zinc-800/50">
                        {o}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {a.messaging.things_to_probe?.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-medium text-zinc-500">Things to probe (research ≠ qualification)</p>
                  <ul className="mt-1 list-inside list-disc space-y-1 text-sm">
                    {a.messaging.things_to_probe.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                </div>
              )}
            </Section>
          )}

          <AiVisibility slug={a.slug} data={a.ai_visibility} serverUp={!!onRefresh} />

          <Community slug={a.slug} data={a.community} serverUp={!!onRefresh} />

          <Storyline key={a.slug} slug={a.slug} serverUp={!!onRefresh} />

          <Section
            title={`ICP contacts (${a.icp_contacts?.length ?? 0})`}
            onSectionRefresh={onRefresh && (() => onRefresh('section', { section: 'contacts' }))}
            refreshPending={refreshPending}
            refreshLabel="⟳ find more"
            refreshTitle="Find more contacts via ZoomInfo: free search, then paid enrich on up to 5 new best-fit contacts (logged). Adds to the list — existing contacts are never touched."
          >
            {a.icp_contacts?.length ? (
              <ul className="grid gap-3 lg:grid-cols-2">
                {a.icp_contacts.map((c, i) => (
                  <li key={i} className="rounded border border-zinc-200 p-3 dark:border-zinc-700">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{c.name}</span>
                      <ContactVerificationBadge verification={c.verification} />
                    </div>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">{c.title}</p>
                    <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-zinc-500">
                      {c.department && <span>{c.department}</span>}
                      {c.seniority && <span>{c.seniority}</span>}
                      {c.email && (
                        <a href={`mailto:${c.email}`} className="text-info-500 hover:text-info-600 hover:underline dark:text-info-400">
                          {c.email}
                        </a>
                      )}
                      {c.linkedin_url && (
                        <a href={c.linkedin_url} target="_blank" rel="noreferrer" className="text-info-500 hover:text-info-600 hover:underline dark:text-info-400">
                          LinkedIn
                        </a>
                      )}
                      {c.salesforce_contact_id && <span className="font-mono">SF: {c.salesforce_contact_id}</span>}
                    </div>
                    {c.why_icp && <p className="mt-2 text-sm">{c.why_icp}</p>}
                    <SourceList sources={c.sources} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-zinc-500">No ICP contacts recorded.</p>
            )}
          </Section>

          <Section title="Signals">
            <SignalsTimeline signals={a.signals} />
          </Section>

          {a.news?.length > 0 && (
            <Section
              title="News"
              onSectionRefresh={onRefresh && (() => onRefresh('section', { section: 'news' }))}
              refreshPending={refreshPending}
            >
              <ul className="space-y-3">
                {a.news.map((n, i) => (
                  <li key={i}>
                    <div className="flex flex-wrap items-center gap-2">
                      <a href={n.url} target="_blank" rel="noreferrer" className="text-sm font-medium text-info-500 hover:text-info-600 hover:underline dark:text-info-400">
                        {n.title}
                      </a>
                      {!n.date_confirmed_on_page && <Badge tone="amber">⚠ date unconfirmed</Badge>}
                    </div>
                    <p className="text-xs text-zinc-500">
                      {n.publisher} · {formatDate(n.published_at)}
                    </p>
                    <p className="mt-1 text-sm">{n.summary}</p>
                    {n.relevance && (
                      <p className="mt-0.5 text-sm text-zinc-500 italic">
                        <span className="font-medium not-italic text-zinc-600 dark:text-zinc-400">Why it matters: </span>
                        {n.relevance}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>

        {/* Reference column: the facts behind the working material */}
        <div className="min-w-0 space-y-4">
          <SfActivity activity={activity} onRefresh={onRefresh} refreshPending={refreshPending} />

          <Section title="Salesforce" aside={<span className="text-xs text-zinc-500">synced {relativeTime(sf.synced_at)}</span>}>
            <dl className="grid grid-cols-2 gap-3">
              <Field label="Account ID">
                <span className="font-mono text-xs">{sf.account_id}</span>
              </Field>
              <Field label="Industry">{sf.industry}</Field>
              <Field label="Employees (CRM)">{sf.number_of_employees?.toLocaleString()}</Field>
              <Field label="Billing">
                {[sf.billing_city, sf.billing_state, sf.billing_country].filter(Boolean).join(', ') || '—'}
              </Field>
            </dl>
            {sf.bdr_notes && (
              <div className="mt-3">
                <p className="text-xs text-zinc-500">BDR notes</p>
                <Prose text={sf.bdr_notes} className="mt-0.5 text-sm" />
              </div>
            )}
            {sf.open_opportunities?.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-medium text-zinc-500">Open opportunities</p>
                <ul className="mt-1 space-y-2">
                  {sf.open_opportunities.map((o) => (
                    <li key={o.id} className="rounded border border-zinc-200 p-2 text-sm dark:border-zinc-700">
                      <div className="font-medium">{o.name}</div>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-zinc-500">
                        <span>{o.stage}</span>
                        {o.amount != null && <span>{formatMoney(o.amount)}</span>}
                        {o.close_date && <span>closes {formatDate(o.close_date)}</span>}
                        {o.owner && <span>AE: {o.owner}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {sf.crm_history_notes && (
              <div className="mt-3">
                <p className="text-xs text-zinc-500">CRM history</p>
                <Prose text={sf.crm_history_notes} className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400" />
              </div>
            )}
          </Section>

          <Section title="Firmographics">
            <dl className="grid grid-cols-2 gap-3">
              <VerifiedValue label="Employees" vv={fg.employees} />
              <VerifiedValue label="Revenue" vv={fg.revenue_usd} />
              <Field label="Founded">{fg.founded_year}</Field>
              <Field label="HQ">{fg.hq}</Field>
              <Field label="Ownership">{fg.ownership}</Field>
              <Field label="Categories">{fg.categories?.join(', ')}</Field>
            </dl>
            {fg.linkedin_url && (
              <a href={fg.linkedin_url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-info-500 hover:text-info-600 hover:underline dark:text-info-400">
                LinkedIn company page
              </a>
            )}
          </Section>

          {a.g2 && (a.g2.products?.length || a.g2.presence_summary) && (
            <Section
              title="G2 presence"
              onSectionRefresh={onRefresh && (() => onRefresh('section', { section: 'g2' }))}
              refreshPending={refreshPending}
            >
              {a.g2.products?.map((p) => (
                <div key={p.slug} className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                  <a
                    href={`https://www.g2.com/products/${p.slug}/reviews`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-info-500 hover:text-info-600 hover:underline dark:text-info-400"
                  >
                    {p.name || p.slug}
                  </a>
                  {p.rating != null && (
                    <span>
                      <span className="text-star">★</span> {p.rating} ({p.review_count} reviews)
                    </span>
                  )}
                  {p.categories?.length > 0 && <span className="text-xs text-zinc-500">{p.categories.join(' · ')}</span>}
                </div>
              ))}
              <Prose text={a.g2.presence_summary} />
            </Section>
          )}

          {a.hiring && (a.hiring.open_roles_total != null || a.hiring.notes) && (
            <Section
              title="Hiring"
              aside={a.hiring.as_of && <span className="text-xs text-zinc-500">as of {formatDate(a.hiring.as_of)}</span>}
              onSectionRefresh={onRefresh && (() => onRefresh('section', { section: 'hiring' }))}
              refreshPending={refreshPending}
            >
              <div className="flex flex-wrap items-center gap-3 text-sm">
                {a.hiring.open_roles_total != null && (
                  <span>
                    <span className="text-lg font-semibold">{a.hiring.open_roles_total}</span> open roles
                  </span>
                )}
                {a.hiring.direction && (
                  <Badge tone={a.hiring.direction === 'growing' ? 'green' : a.hiring.direction === 'shrinking' ? 'red' : 'gray'}>
                    {a.hiring.direction}
                  </Badge>
                )}
                {a.hiring.careers_url && (
                  <a href={a.hiring.careers_url} target="_blank" rel="noreferrer" className="text-xs text-info-500 hover:text-info-600 hover:underline dark:text-info-400">
                    careers page
                  </a>
                )}
              </div>
              {a.hiring.role_mix?.length > 0 && (
                <p className="mt-2 text-sm">
                  {a.hiring.role_mix.map((r) => `${r.function}: ${r.count}`).join(' · ')}
                </p>
              )}
              <div className="mt-2">
                <Prose text={a.hiring.notes} />
              </div>
            </Section>
          )}

          {a.gong?.available && (
            <Section
              title="Gong history"
              aside={a.gong.retrieved_at && <span className="text-xs text-zinc-500">retrieved {relativeTime(a.gong.retrieved_at)}</span>}
              onSectionRefresh={onRefresh && (() => onRefresh('section', { section: 'gong' }))}
              refreshPending={refreshPending}
            >
              <Prose text={a.gong.summary} className="text-sm" />
              {a.gong.last_call_at && <p className="mt-1 text-xs text-zinc-500">Last call: {formatDateTime(a.gong.last_call_at)}</p>}
            </Section>
          )}

          {a.discrepancies?.length > 0 && (
            <Section title="Source discrepancies">
              <ul className="space-y-3">
                {a.discrepancies.map((d, i) => (
                  <li key={i} className="text-sm">
                    <span className="font-mono text-xs">{d.field}</span>
                    <ul className="mt-1 flex flex-wrap gap-2">
                      {d.values.map((v, j) => (
                        <li key={j}>
                          <Badge tone="gray">
                            {v.source}: {String(v.value)}
                            {v.as_of && ` (${v.as_of})`}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1 text-zinc-600 dark:text-zinc-400">{d.resolution}</p>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {a.corrections_applied?.length > 0 && (
            <Section title="Corrections applied">
              <ul className="list-inside list-disc text-sm">
                {a.corrections_applied.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      </div>
    </div>
  )
}
