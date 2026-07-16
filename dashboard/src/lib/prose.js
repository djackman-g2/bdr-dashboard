// Render-time bulletizing of pipeline prose. The dossier JSON stays untouched —
// this only changes how long paragraph fields display. Every character of the
// source text ends up in exactly one bullet; nothing is dropped or rewritten.

// Common abbreviations that end in "." but don't end a sentence.
const ABBREV =
  /(?:\b(?:Sr|Jr|Dr|Mr|Mrs|Ms|St|No|Inc|Corp|Ltd|Co|vs|approx|est|Dept|Gov|Univ|Rev|Gen|Col|Capt|Sgt|Fig|Vol|Ch|Sec|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|U\.S|U\.K|D\.C|e\.g|i\.e)\.|\b[A-Z]\.)$/

// Split prose into sentence-ish bullets. Splits on ". " / "! " / "? " when the
// next chunk starts like a sentence, guarding known abbreviations. Returns null
// when bulleting wouldn't help (short text or a single sentence).
export function toBullets(text) {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  if (trimmed.length < 160) return null

  const parts = []
  let current = ''
  // Walk sentence-final punctuation followed by whitespace + a sentence opener.
  const re = /[.!?]["')\]]?\s+(?=[A-Z0-9"'(\[])/g
  let last = 0
  let m
  while ((m = re.exec(trimmed)) !== null) {
    const end = m.index + m[0].length
    const candidate = current + trimmed.slice(last, end)
    const beforeBreak = candidate.trimEnd()
    if (ABBREV.test(beforeBreak)) {
      // Not a real sentence end — keep accumulating.
      current = candidate
    } else {
      parts.push(beforeBreak)
      current = ''
    }
    last = end
  }
  const tail = (current + trimmed.slice(last)).trim()
  if (tail) parts.push(tail)

  if (parts.length < 2) return null
  return parts
}
