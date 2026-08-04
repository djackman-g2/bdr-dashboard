// One-shot repair: tracker accounts whose id drifted from the research-index
// slug (e.g. "spreedly" created from the Groove account name while the
// dossier lives at data/accounts/spreedly-com.json). The draft engine and
// hook-angle matcher load the dossier by tracker account id, so a drifted id
// silently drops all research. Renames the account id to the index slug and
// repoints every contact row; if an account with the target slug already
// exists, the drifted one is merged into it. Idempotent.
//
//   npm run repair:account-slugs -- --dry-run
//   npm run repair:account-slugs
import fs from 'node:fs/promises'
import path from 'node:path'
import { paths } from '../lib/config.js'
import { readStore, updateStore } from '../lib/trackerStore.js'

const DRY = process.argv.includes('--dry-run')

let index
try {
  index = JSON.parse(await fs.readFile(path.join(paths.dataDir, 'index.json'), 'utf8'))
} catch {
  console.error('no research index (data/index.json) — nothing to repair against')
  process.exit(1)
}
const slugByName = new Map(
  (index.accounts ?? []).filter((a) => a.name && a.slug).map((a) => [a.name.toLowerCase(), a.slug])
)

const hasDossier = async (slug) => {
  try {
    await fs.access(path.join(paths.accountsDir, `${slug}.json`))
    return true
  } catch {
    return false
  }
}

// Plan against a fresh read; the ids double-checked inside the serialized write.
const store = await readStore()
const renames = [] // { from, to, merge }
for (const a of store.accounts) {
  if (await hasDossier(a.id)) continue
  const slug = slugByName.get(a.name.toLowerCase())
  if (!slug || slug === a.id || !(await hasDossier(slug))) continue
  renames.push({ from: a.id, to: slug, merge: store.accounts.some((x) => x.id === slug) })
}

if (!renames.length) {
  console.log('all tracker account ids already match their dossiers — nothing to do')
  process.exit(0)
}
for (const r of renames) {
  const contacts = store.contacts.filter((c) => c.accountId === r.from).length
  console.log(`${r.from} → ${r.to}${r.merge ? ' (merge into existing)' : ''} · ${contacts} contact(s)`)
}
if (DRY) {
  console.log(`\n[DRY RUN] ${renames.length} account(s) would be repaired`)
  process.exit(0)
}

await updateStore((s) => {
  for (const { from, to } of renames) {
    const src = s.accounts.find((a) => a.id === from)
    if (!src) continue
    const dst = s.accounts.find((a) => a.id === to)
    if (dst) {
      // Merge: keep the existing row, fill any fields only the drifted one had.
      dst.sfId ??= src.sfId
      dst.g2Slug ??= src.g2Slug
      dst.playType ??= src.playType
      dst.flags = [...new Set([...(dst.flags ?? []), ...(src.flags ?? [])])]
      s.accounts.splice(s.accounts.indexOf(src), 1)
    } else {
      src.id = to
    }
    for (const c of s.contacts) if (c.accountId === from) c.accountId = to
  }
})
console.log(`\nrepaired ${renames.length} account(s) — drafts and hook angles now see the dossiers`)
