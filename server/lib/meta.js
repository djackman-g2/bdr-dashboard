// Serialized access to data/meta.json.
//
// Two writers exist: this server (job_queue + failure run entries) and the
// headless Claude pipeline (run log entries). To keep from clobbering each
// other, every server write is a fresh read-modify-write, all server writes
// are serialized through one promise chain, and writes are atomic
// (temp file + rename). The pipeline only appends to runs[]; the server only
// owns job_queue and timestamps, plus run entries for jobs that died without
// writing their own.
import fs from 'node:fs/promises'
import { paths } from './config.js'

let chain = Promise.resolve()

export async function readMeta() {
  const raw = await fs.readFile(paths.meta, 'utf8')
  return JSON.parse(raw)
}

// mutate(meta) edits in place or returns a replacement. Returns final meta.
export function updateMeta(mutate) {
  const run = async () => {
    const meta = await readMeta()
    const next = (await mutate(meta)) ?? meta
    const tmp = paths.meta + '.tmp'
    await fs.writeFile(tmp, JSON.stringify(next, null, 2) + '\n')
    await fs.rename(tmp, paths.meta)
    return next
  }
  const result = chain.then(run, run)
  chain = result.catch(() => {})
  return result
}
