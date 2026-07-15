export function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d)) return iso
  // Date-only strings parse as UTC midnight; format in UTC so the day doesn't shift.
  const opts = { year: 'numeric', month: 'short', day: 'numeric' }
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) opts.timeZone = 'UTC'
  return d.toLocaleDateString('en-US', opts)
}

export function formatDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d)) return iso
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function relativeTime(iso) {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  if (isNaN(then)) return iso
  const mins = Math.round((Date.now() - then) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.round(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.round(months / 12)}y ago`
}

export function formatMoney(n) {
  if (n == null) return '—'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

export function daysAgo(iso) {
  const then = new Date(iso).getTime()
  if (isNaN(then)) return Infinity
  return (Date.now() - then) / 86400000
}
