// 沿用 useitem-cause-ledger 的 esbuild 切片手法，真构造器和 V14 在临时库执行。
// V15 起同时切入资源归类、详情迁移、事务助手及逐笔读写，复用同一份真 SQL。
// 不直接 import ledger.ts；不加载其默认实例。历史迁移与定时清理不属于此夹具。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'

const source = fs.readFileSync(new URL('../../src/main/mg/ledger.ts', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n')
const sliceBetween = (from, to) => {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `V14 账本夹具锚点失效：${from}`)
  return source.slice(start, end)
}
const constructor = sliceBetween('  constructor() {', '\n  private dropPhantomConsumableUseitemRowsV14 =')
const migration = sliceBetween('  private dropPhantomConsumableUseitemRowsV14 =', '\n  // 批量写包进一个事务')
const batch = sliceBetween('  private runBatch =', '\n  record =')
const deltaMethods = sliceBetween('  logDelta =', '\n  queryDeltaSummary =')
const shared = fileURLToPath(new URL('../../src/shared/material-delta-detail.ts', import.meta.url)).replaceAll('\\', '/')
const harness = `
import { buildDeltaDetail, replayDeltaCategoryFixes } from ${JSON.stringify(shared)}
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
export const openLedger = (APPDATA_PATH: string, questProgressV13: any = []) => {
  const DB_PATH = path.join(APPDATA_PATH, 'mg.sqlite')
  const SNAPSHOT_DIR = path.join(APPDATA_PATH, 'snapshots')
  return new class Ledger {
    private db: any
    private pruneTimer: any
    private prune = () => {}
    private recomputeCarrierSinkProgressV13 = () => questProgressV13
${constructor}
${migration}
${batch}
${deltaMethods}
    close = () => { clearInterval(this.pruneTimer); this.db.close() }
  }()
}
`
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-phantom-ledger-harness-'))
const entry = path.join(dir, 'ledger.ts')
const outfile = path.join(dir, 'ledger.cjs')
fs.writeFileSync(entry, harness)
buildSync({ entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' })
export const { openLedger } = createRequire(import.meta.url)(outfile)
