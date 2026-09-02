// v12 迁移真 SQL 护栏：从 ledger.ts 原样切出迁移方法，放进临时 node:sqlite 账本跑。
// 不直接 import ledger.ts——它的默认实例会打开用户真库。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ledgerSource = fs
  .readFileSync(path.join(ROOT, 'src', 'main', 'mg', 'ledger.ts'), 'utf8')
  .replace(/\r\n/g, '\n')

const start = ledgerSource.indexOf('  private backfillUseitemCausesV12 = ()')
const end = ledgerSource.indexOf('\n\n  // 任务领域快照曾经只 merge 页面', start)
assert.ok(start >= 0 && end > start, 'ledger.ts 的 v12 道具归因迁移锚点变了')
const migration = ledgerSource.slice(start, end)
const actionsStart = ledgerSource.indexOf('  private actionsSinceLastUseitemSync = ()')
const actionsEnd = ledgerSource.indexOf('\n\n  // 道具变化：', actionsStart)
assert.ok(actionsStart >= 0 && actionsEnd > actionsStart, 'ledger.ts 的实时归因窗口锚点变了')
const realtimeActions = ledgerSource.slice(actionsStart, actionsEnd)
const logStart = ledgerSource.indexOf('  logUseitems = (')
const logEnd = ledgerSource.indexOf('\n\n  // ---- 通知历史', logStart)
assert.ok(logStart >= 0 && logEnd > logStart, 'ledger.ts 的道具写入锚点变了')
const realtimeLog = ledgerSource.slice(logStart, logEnd)
const sharedPath = path
  .join(ROOT, 'src', 'shared', 'useitem-cause.ts')
  .replaceAll('\\', '/')

const HARNESS = `
import {
  isUseitemFullSyncPath,
  resolveUseitemCause,
  type UseitemCauseAction,
} from ${JSON.stringify(sharedPath)}

class UseitemCauseLedger {
  db: any
  private lastRecordedEventId: number | null = null
  constructor(db: any) { this.db = db }
  private runBatch = (count: number, fn: () => void) => {
    if (count <= 1) {
      fn()
      return
    }
    this.db.exec('BEGIN IMMEDIATE')
    try {
      fn()
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
${migration}
${realtimeActions}
${realtimeLog}
  migrate = () => this.backfillUseitemCausesV12()
  pointAtEvent = (id: number) => { this.lastRecordedEventId = id }
}

export const makeLedger = (db: any) => new UseitemCauseLedger(db)
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-useitem-cause-ledger-'))
  const entry = path.join(dir, 'ledger.ts')
  const outfile = path.join(dir, 'ledger.cjs')
  fs.writeFileSync(entry, HARNESS)
  buildSync({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  })
  return outfile
})()

export const makeLedger = createRequire(import.meta.url)(bundle).makeLedger
