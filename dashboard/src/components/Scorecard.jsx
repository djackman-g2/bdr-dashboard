// Self-score chips per draft message (gates.md): we-we count, failed mental
// gates, time-ask flag. Advisory — surfaces the judgment call, never blocks.
export default function Scorecard({ s }) {
  if (!s || typeof s !== 'object') return null
  const failed = (s.failed_gates ?? []).filter(Boolean)
  const refs = typeof s.self_refs === 'number' ? s.self_refs : null
  const chip = (text, tone) => (
    <span
      className={
        tone === 'bad'
          ? 'rounded-full border border-brand-300 px-1.5 py-px text-brand-700 dark:border-brand-900 dark:text-brand-300'
          : tone === 'warn'
            ? 'rounded-full border border-warning-400 px-1.5 py-px text-warning-700 dark:border-warning-700 dark:text-warning-400'
            : 'rounded-full border border-zinc-200 px-1.5 py-px text-zinc-400 dark:border-zinc-800 dark:text-zinc-500'
      }
    >
      {text}
    </span>
  )
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
      {refs != null && chip(`we-we ${refs}`, refs > 2 ? 'bad' : 'ok')}
      {failed.length > 0 ? chip(`gates: ${failed.join(' ')}`, 'bad') : chip('gates clean', 'ok')}
      {s.time_ask && chip('asks for time', 'warn')}
    </div>
  )
}
