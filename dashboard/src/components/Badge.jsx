// Tones map to G2 Elevate semantic hues (see index.css @theme).
const TONES = {
  green: 'bg-success-100 text-success-700 dark:bg-success-900 dark:text-success-300 border-success-300 dark:border-success-700',
  amber: 'bg-warning-50 text-warning-700 dark:bg-warning-700/30 dark:text-warning-300 border-warning-300 dark:border-warning-700',
  red: 'bg-brand-100 text-brand-700 dark:bg-brand-950 dark:text-brand-300 border-brand-300 dark:border-brand-900',
  gray: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400 border-zinc-300 dark:border-zinc-700',
  blue: 'bg-info-100 text-info-600 dark:bg-info-900/40 dark:text-info-400 border-info-400/60 dark:border-info-900',
}

export default function Badge({ tone = 'gray', children, title }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${TONES[tone]}`}
    >
      {children}
    </span>
  )
}

export function ConfidenceBadge({ level }) {
  if (!level || level === 'none') return <Badge tone="gray">not researched</Badge>
  const tone = level === 'high' ? 'green' : level === 'medium' ? 'amber' : 'red'
  return <Badge tone={tone}>confidence: {level}</Badge>
}

// Non-negotiable rule 3: unverified_estimate always renders a warning badge.
export function VerifiedValueBadge({ status }) {
  if (status === 'verified') return <Badge tone="green">verified</Badge>
  if (status === 'unverified_estimate') return <Badge tone="amber" title="Single-source or stale enrichment value — cross-check before quoting">⚠ unverified estimate</Badge>
  return <Badge tone="gray">unknown</Badge>
}

// Non-negotiable rule 4: unverified contacts carry an explicit warning.
export function ContactVerificationBadge({ verification }) {
  if (verification?.status === 'verified') {
    return <Badge tone="green" title={`via ${verification.method}`}>verified</Badge>
  }
  return (
    <Badge tone="amber" title={verification?.note || 'No independent confirmation of current employment'}>
      ⚠ unconfirmed — verify before outreach
    </Badge>
  )
}
