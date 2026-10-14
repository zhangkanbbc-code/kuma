import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { atomicWriteJsonSync } from '../atomic-json'
import { SLOTITEM_BODY_PATH, SLOTITEM_BODY_RETENTION_DAYS } from '../../shared/ledger-retention'

type Db = { prepare(sql: string): any }
type State = { backupReady: boolean; cleanupDone: boolean; vacuumDone: boolean; vacuumTimeouts?: number }

const nextSlotitemBody = (db: Db, cutoff: number, afterId: number) => db.prepare(`SELECT id FROM events
  WHERE path = ? AND id > ? AND ts < ? AND body IS NOT NULL
    AND id != (SELECT MAX(id) FROM events WHERE path = ? AND body IS NOT NULL)
  ORDER BY id LIMIT 1`).get(SLOTITEM_BODY_PATH, afterId, cutoff, SLOTITEM_BODY_PATH)

// 一条整表通常约 129 KB；单批只改一条，下一批让出主线程。游标不重复扫描已清行。
export const clearSlotitemBodyBatch = (db: Db, cutoff: number, afterId = 0) => {
  const started = performance.now()
  const row = nextSlotitemBody(db, cutoff, afterId)
  if (row) db.prepare('UPDATE events SET body = NULL WHERE id = ?').run(row.id)
  return { id: row?.id ?? afterId, changes: row ? 1 : 0, ms: performance.now() - started }
}

// VACUUM / VACUUM INTO 只在独立进程执行；同一实现供副本量测与退出维护使用。
export const runLedgerMaintenance = (input: { dbPath: string; backupPath?: string; check?: boolean }, timeoutMs: number, signal?: AbortSignal): Promise<boolean> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'ledger-maintenance-worker.js'),
      input.dbPath, ...(input.check ? ['--check'] : input.backupPath ? [input.backupPath] : [])], {
      cwd: path.dirname(input.dbPath), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    })
    let stderr = '', timedOut = false
    child.stderr.on('data', data => { stderr += data.toString() })
    let settled = false
    const finish = (ok: boolean, error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      if (error) reject(error)
      else resolve(ok)
    }
    const cancel = () => {
      // 杀独立进程可中断原生 sqlite 调用；VACUUM 是事务，未完成不会换掉原库。
      timedOut = true
      child.kill()
    }
    const timer = setTimeout(cancel, timeoutMs)
    signal?.addEventListener('abort', cancel, { once: true })
    child.on('error', error => finish(false, error))
    child.on('close', code => finish(!timedOut && code === 0,
      !timedOut && code !== 0 ? new Error(`账本维护进程退出 ${code}: ${stderr.trim()}`) : undefined))
  })

export class SlotitemBodyRetention {
  private running = false
  private stopped = false
  private backupAbort = new AbortController()
  private state: State = { backupReady: false, cleanupDone: false, vacuumDone: false, vacuumTimeouts: 0 }
  readonly backupPath: string
  private statePath: string

  constructor(private db: Db, private dbPath: string, private enabled: () => boolean) {
    this.backupPath = `${dbPath}.before-slotitem-trim.sqlite`
    this.statePath = `${dbPath}.slotitem-trim.json`
    if (fs.existsSync(this.statePath)) this.state = JSON.parse(fs.readFileSync(this.statePath, 'utf8'))
  }

  private save = () => atomicWriteJsonSync(this.statePath, this.state)

  async prune(now = Date.now()) {
    if (this.running || this.stopped || !this.enabled()) return
    const cutoff = now - SLOTITEM_BODY_RETENTION_DAYS * 86_400_000
    // 没有新变化就不再复制/校验整库；旧版或失败后留下的备份仍需校验后回收。
    if (!nextSlotitemBody(this.db, cutoff, 0) && !fs.existsSync(this.backupPath)) return
    this.running = true
    let cursor = 0, changes = 0, maxMs = 0, totalMs = 0
    try {
      if (!this.state.backupReady || !fs.existsSync(this.backupPath)) {
        // 保留清理前的完整库，供内置「从备份恢复」校验/恢复使用；不覆盖旧备份。
        // 2026-10-15 修正：只保留到清理提交、主库完整性校验成功，不作为永久备份。
        const ok = await runLedgerMaintenance({ dbPath: this.dbPath, backupPath: this.backupPath }, 120_000, this.backupAbort.signal)
        if (this.stopped) {
          console.warn(`[kuma] mg: 装备正文清理中止，保留备份 ${this.backupPath}`)
          return
        }
        if (!ok) throw new Error('装备正文清理前备份超时')
        this.state.backupReady = true
        this.save()
      }
      if (!this.state.vacuumDone) { this.state.cleanupDone = false; this.save() }
      while (!this.stopped && this.enabled()) {
        const batch = clearSlotitemBodyBatch(this.db, cutoff, cursor)
        cursor = batch.id
        changes += batch.changes
        totalMs += batch.ms
        maxMs = Math.max(maxMs, batch.ms)
        if (changes === 1 && batch.changes) {
          this.state.cleanupDone = false
          this.state.vacuumDone = false
          this.state.vacuumTimeouts = 0
          this.save()
        }
        if (!batch.changes) {
          // 每条 UPDATE 已自动提交；完整性检查读 WAL 快照，不占用游戏主线程。
          if (!await runLedgerMaintenance({ dbPath: this.dbPath, check: true }, 120_000, this.backupAbort.signal)) {
            throw new Error('主库完整性校验未完成')
          }
          this.state.cleanupDone = true
          this.state.backupReady = false
          this.save()
          fs.rmSync(this.backupPath)
          console.log('[kuma] mg: 装备正文清理提交且主库完整性校验通过，已删除临时备份')
          break
        }
        await new Promise<void>(resolve => setImmediate(resolve))
      }
      if (this.state.backupReady) console.warn(`[kuma] mg: 装备正文清理中止，保留备份 ${this.backupPath}`)
      console.log(`[kuma] mg: 装备整表正文清理 ${changes} 行；单批最多 ${maxMs.toFixed(2)}ms，SQL 合计 ${totalMs.toFixed(2)}ms`)
    } catch (error) {
      console.warn(`[kuma] mg: 装备正文清理或校验失败，保留备份 ${this.backupPath}`, error)
      throw error
    } finally { this.running = false }
  }

  stop() { this.stopped = true; this.backupAbort.abort() }

  get needsVacuum() { return this.enabled() && this.state.cleanupDone && !this.state.vacuumDone && (this.state.vacuumTimeouts ?? 0) < 3 }

  // 调用前账本必须关闭并完成 WAL checkpoint；备份在首次清理前已经完成。
  async compactOnQuit(timeoutMs = 3500) {
    if (!this.needsVacuum) return false
    const ok = await runLedgerMaintenance({ dbPath: this.dbPath }, timeoutMs)
    if (ok) { this.state.vacuumDone = true; this.state.vacuumTimeouts = 0; this.save() }
    else {
      this.state.vacuumTimeouts = (this.state.vacuumTimeouts ?? 0) + 1
      this.save()
      console.warn(this.state.vacuumTimeouts >= 3
        ? '[kuma] mg: 退出压实连续 3 次超时，暂停尝试，等待新的清理变化'
        : `[kuma] mg: 退出压实超时 ${this.state.vacuumTimeouts}/3，下次退出重试`)
    }
    return ok
  }
}
