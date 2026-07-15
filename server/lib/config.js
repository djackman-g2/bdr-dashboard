// Loads config/config.json and resolves project paths. The server never
// hardcodes SOQL, ports, caps, or cron expressions — they live in config.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/config.json'), 'utf8'))

export const paths = {
  root: ROOT,
  accountsDir: path.join(ROOT, config.paths.accounts_dir),
  index: path.join(ROOT, config.paths.index),
  meta: path.join(ROOT, config.paths.meta),
  dataDir: path.join(ROOT, 'data'),
  logsDir: path.join(ROOT, config.paths.logs_dir ?? 'logs'),
  promptsDir: path.join(ROOT, 'prompts'),
  dashboardDist: path.join(ROOT, 'dashboard/dist'),
}
