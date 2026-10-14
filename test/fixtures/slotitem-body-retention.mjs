import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../..', import.meta.url))
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-slotitem-retention-'))
const source = fs.readFileSync(path.join(root, 'src/main/mg/ledger.ts'), 'utf8').replaceAll('\r\n', '\n')
const method = name => {
  const start = source.indexOf(`  ${name} =`)
  const end = source.indexOf('\n  }\n', start)
  if (start < 0 || end < start) throw new Error(`账本方法锚点失效：${name}`)
  return source.slice(start, end + 4)
}
const entry = path.join(dir, 'readers.ts')
fs.writeFileSync(entry, `import { EQUIP_FULL_LIST_PATHS } from ${JSON.stringify(path.join(root, 'src/shared/senka-ranking.ts'))}
export const readers = db => new class { constructor(public db: any) {}
${method('loadLatestSlotitemList')}
${method('loadLatestAuthoritativeQuestList')}
${source.slice(source.indexOf('  queryEquipSyncTs ='), source.indexOf('  queryLateEquipEventTs ='))}
}(db)`)
await build({ entryPoints: [entry, path.join(root, 'src/main/mg/slotitem-body-retention.ts'), path.join(root, 'src/main/mg/ledger-maintenance-worker.ts')],
  outdir: dir, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  plugins: [{ name: 'offline-timing', setup(b) {
    b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'offline-timing' }))
    b.onLoad({ filter: /.*/, namespace: 'offline-timing' }, () => ({ contents: 'export const ipcMain = { handle: () => {} }', loader: 'js' }))
  } }] })
const require = createRequire(import.meta.url)
export const { SlotitemBodyRetention, clearSlotitemBodyBatch, runLedgerMaintenance } = require(path.join(dir, 'slotitem-body-retention.js'))
export const { readers } = require(path.join(dir, 'readers.js'))
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }))
