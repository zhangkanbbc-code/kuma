// 钥 · 主进程侧：缓存急救（清理 Chromium 缓存目录后重启）与应用重启。
// 清理白名单外一律不碰：保 Network(Cookies)/config.json/mg.sqlite/snapshots/lodes/
// voice-archive 与 art-archive（「听过即存」「见过即存」的语音与立绘档案，
// 是玩家资产不是缓存）。
// 缓存目录运行中被锁——标记后在 will-quit 阶段删除，再自动拉起。
import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import { pipeline } from 'stream/promises'

import { app, dialog, ipcMain } from 'electron'

import config = require('./config')
import { APPDATA_PATH } from './env'
import ledger from './mg/ledger'
import { registerCriticalQuitWork } from './quit-guard'

// 缓存损坏白屏的急救清单（实测口径：双实例锁竞争后 Cache 目录损坏导致游戏白屏）。
// **这是白名单式的：清单外一律不碰。**
export const CACHE_DIRS = ['Cache', 'Code Cache', 'GPUCache', 'Service Worker', 'Session Storage', 'blob_storage']

/**
 * 保住名单：这些是**玩家的东西**，不是缓存，急救时一根汗毛都不能动。
 *
 * 白名单机制本来就保得住它们（不在 CACHE_DIRS 里就删不到），
 * 这张表是显式写出来给下一个人看的，并且有护栏逐条核对（test/voice-archive.test.mjs）——
 * 「忘了漏一个」与「明知故犯」是两回事，而这里漏一个的代价是玩家的资产没了。
 *
 * `voice-archive` / `art-archive` 是 2026-08-22 加入的：「听过即存」的语音档案
 * 与「见过即存」的立绘档案。
 * 卡加载时清缓存是**正常操作**，不能顺手把玩家攒了半年的收集进度一起清掉；
 * 何况季节语音过季就再也听不到、活动限定深海舰的立绘绝版后再也见不到，
 * 删掉等于永久失去。
 */
export const PRESERVED_ENTRIES = [
  'Network', // 登录 cookie
  'config.json',
  'mg.sqlite',
  'snapshots',
  'lodes',
  'backups',
  'screenshots',
  'ship-art-paths.json',
  'voice-archive',
  'art-archive',
  // 2026-08-24：「响过即存」的 BGM 档案。活动曲随活动撤场，撤场之后档案里
  // 那一份就是唯一还能听到的来源——与语音过季、深海立绘绝版是同一类永久失去。
  'bgm-archive',
  // 2026-08-23：「官方没有这一格语音」的探测台账。它不是玩家的资产，
  // 但删了就要让玩家把那些格**再点一遍**去问同一个服务器要同一个 404——
  // 而「一次点击一次请求」正是这个域的前提，白让人点第二遍等于把它打折。
  'voice-absent.json',
]

let clearOnQuit = false
let restoreOnQuit: string | null = null
let restoreConfigOnQuit: Record<string, unknown> | null = null
const DB_PATH = path.join(APPDATA_PATH, 'mg.sqlite')
const BACKUP_MAGIC = Buffer.from('KANSO-BACKUP\0', 'ascii')
const BACKUP_SCHEMA = 1
const MAX_BACKUP_META = 4 * 1024 * 1024

const sha256File = (file: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const input = fs.createReadStream(file)
    input.on('error', reject)
    hash.on('error', reject)
    hash.on('finish', () => resolve(hash.digest('hex')))
    input.pipe(hash)
  })

const writeBackupBundle = async (destination: string) => {
  const sqliteTemp = path.join(APPDATA_PATH, `mg.backup-${process.pid}-${Date.now()}.sqlite`)
  const bundleTemp = `${destination}.kanso-${process.pid}-${Date.now()}.tmp`
  try {
    ledger.backupDatabase(sqliteTemp)
    const stat = fs.statSync(sqliteTemp)
    const metadata = Buffer.from(JSON.stringify({
      schemaVersion: BACKUP_SCHEMA,
      createdAt: Date.now(),
      appVersion: app.getVersion(),
      sqliteBytes: stat.size,
      sqliteSha256: await sha256File(sqliteTemp),
      config: config.snapshot(),
    }), 'utf8')
    if (metadata.length > MAX_BACKUP_META) throw new Error('配置数据异常过大，无法写入备份')
    const header = Buffer.alloc(BACKUP_MAGIC.length + 4)
    BACKUP_MAGIC.copy(header)
    header.writeUInt32BE(metadata.length, BACKUP_MAGIC.length)
    fs.writeFileSync(bundleTemp, Buffer.concat([header, metadata]))
    await pipeline(fs.createReadStream(sqliteTemp), fs.createWriteStream(bundleTemp, { flags: 'a' }))
    fs.copyFileSync(bundleTemp, destination)
  } finally {
    fs.rmSync(sqliteTemp, { force: true })
    fs.rmSync(bundleTemp, { force: true })
  }
}

const readBackupBundle = async (
  source: string,
  stagedDatabase: string,
): Promise<Record<string, unknown> | null> => {
  const fd = fs.openSync(source, 'r')
  try {
    const prefix = Buffer.alloc(BACKUP_MAGIC.length + 4)
    const read = fs.readSync(fd, prefix, 0, prefix.length, 0)
    if (read < BACKUP_MAGIC.length || !prefix.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)) {
      // 向后兼容旧版纯 SQLite 履历备份。
      const sqliteHeader = Buffer.alloc(16)
      fs.readSync(fd, sqliteHeader, 0, sqliteHeader.length, 0)
      if (sqliteHeader.toString('ascii') !== 'SQLite format 3\u0000') {
        throw new Error('不是 kuma 的备份或历史记录文件')
      }
      fs.copyFileSync(source, stagedDatabase)
      return null
    }
    const metadataLength = prefix.readUInt32BE(BACKUP_MAGIC.length)
    if (!(metadataLength > 0 && metadataLength <= MAX_BACKUP_META)) {
      throw new Error('备份元数据长度无效')
    }
    const metadataBuffer = Buffer.alloc(metadataLength)
    if (fs.readSync(fd, metadataBuffer, 0, metadataLength, prefix.length) !== metadataLength) {
      throw new Error('备份文件不完整')
    }
    const metadata = JSON.parse(metadataBuffer.toString('utf8')) as Record<string, unknown>
    if (metadata.schemaVersion !== BACKUP_SCHEMA) {
      throw new Error(`不支持的备份版本：${metadata.schemaVersion ?? '未知'}`)
    }
    const databaseOffset = prefix.length + metadataLength
    await pipeline(
      fs.createReadStream(source, { start: databaseOffset }),
      fs.createWriteStream(stagedDatabase),
    )
    const stat = fs.statSync(stagedDatabase)
    if (stat.size !== metadata.sqliteBytes) throw new Error('备份中的数据库长度校验失败')
    if (await sha256File(stagedDatabase) !== metadata.sqliteSha256) {
      throw new Error('备份中的数据库校验和不一致')
    }
    const restoredConfig = metadata.config
    if (!restoredConfig || typeof restoredConfig !== 'object' || Array.isArray(restoredConfig)) {
      throw new Error('备份中的配置数据无效')
    }
    return restoredConfig as Record<string, unknown>
  } finally {
    fs.closeSync(fd)
  }
}

ipcMain.handle('yu:clear-cache-restart', () => {
  clearOnQuit = true
  app.relaunch()
  app.quit()
})

ipcMain.handle('yu:relaunch', () => {
  app.relaunch()
  app.quit()
})

ipcMain.handle('yu:appdata-path', () => APPDATA_PATH)

/**
 * 随发行版分发的说明文件（NOTICE.md / LICENSE / 使用说明.md）的绝对路径。
 *
 * 打包产物里它们在 `resources/`（打包脚本的 extraResource），**不在 app.asar 内**：
 * asar 里的路径给 `shell.openPath` 是打不开的——系统的资源管理器/记事本
 * 看不见 asar 这个虚拟文件系统，只会静静失败。开发态回落到仓库根。
 *
 * 文件存不存在这里不判：交给 shell.openPath 报，与「打开 crash.log」同一种做法
 *（伪造一个空文件比让系统说「找不到」更糟）。
 */
ipcMain.handle('yu:doc-path', (_event, name: unknown) => {
  const file = `${name ?? ''}`
  // 只认列出来的这几份。渲染层传什么就拼什么等于把主进程的文件系统开给它。
  if (!['NOTICE.md', 'LICENSE', '使用说明.md'].includes(file)) return ''
  return path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), file)
})

ipcMain.handle('yu:backup-ledger', async () => {
  const stamp = new Date().toISOString().slice(0, 10)
  const picked = await dialog.showSaveDialog({
    title: '备份 kuma 数据与设置',
    defaultPath: path.join(app.getPath('documents'), `kuma 完整备份-${stamp}.kuma-backup`),
    filters: [{ name: 'kuma 完整备份', extensions: ['kuma-backup'] }],
  })
  if (picked.canceled || !picked.filePath) return { ok: false, canceled: true }
  try {
    await writeBackupBundle(picked.filePath)
    return { ok: true, path: picked.filePath }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('yu:restore-ledger', async () => {
  const picked = await dialog.showOpenDialog({
    title: '恢复 kuma 数据与设置',
    properties: ['openFile'],
    filters: [
      // 旧扩展名只加不减：改名前存下的备份必须还能被选中
      { name: 'kuma 备份', extensions: ['kuma-backup', 'kanso-backup', 'sqlite', 'db'] },
    ],
  })
  const source = picked.filePaths[0]
  if (picked.canceled || !source) return { ok: false, canceled: true }
  const staged = path.join(APPDATA_PATH, `mg.restore-${process.pid}-${Date.now()}.sqlite`)
  try {
    restoreConfigOnQuit = await readBackupBundle(source, staged)
    ledger.validateDatabase(staged)
    restoreOnQuit = staged
    app.relaunch()
    app.quit()
    return { ok: true, complete: Boolean(restoreConfigOnQuit) }
  } catch (error) {
    restoreConfigOnQuit = null
    fs.rmSync(staged, { force: true })
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
})

// 备份恢复与缓存急救抽成幂等函数：正常退出走 will-quit；
// quit-guard 的 4 秒硬退（Windows 走 taskkill /T，也不触发 will-quit）也会补跑它——
// 否则用户被告知「恢复成功」，重启后看到的还是旧账本。
const runPendingQuitWork = () => {
  if (restoreOnQuit) {
    const staged = restoreOnQuit
    restoreOnQuit = null // 先置空保证幂等（bail 与 will-quit 不会重复执行）
    const rollback = path.join(APPDATA_PATH, 'mg.pre-restore.sqlite')
    const previousConfig = config.snapshot()
    try {
      ledger.closeDatabase()
      fs.copyFileSync(DB_PATH, rollback)
      fs.rmSync(`${DB_PATH}-wal`, { force: true })
      fs.rmSync(`${DB_PATH}-shm`, { force: true })
      fs.copyFileSync(staged, DB_PATH)
      if (restoreConfigOnQuit) config.restoreSnapshot(restoreConfigOnQuit)
      fs.rmSync(staged, { force: true })
      fs.rmSync(rollback, { force: true })
      console.info(`[kanso] yu: ${restoreConfigOnQuit ? 'complete backup' : 'legacy ledger'} restored`)
    } catch (error) {
      console.error('[kanso] yu: ledger restore failed', error)
      try {
        if (fs.existsSync(rollback)) fs.copyFileSync(rollback, DB_PATH)
        if (restoreConfigOnQuit) config.restoreSnapshot(previousConfig)
        fs.rmSync(rollback, { force: true })
        fs.rmSync(staged, { force: true })
      } catch (rollbackError) {
        console.error('[kanso] yu: ledger restore rollback failed', rollbackError)
      }
    }
  }
  if (!clearOnQuit) return
  clearOnQuit = false
  for (const dir of CACHE_DIRS) {
    try {
      fs.rmSync(path.join(APPDATA_PATH, dir), { recursive: true, force: true })
    } catch (e) {
      console.warn('[kanso] yu: cache dir removal failed', dir, e)
    }
  }
  console.log('[kanso] yu: cache cleared, relaunching')
}

app.on('will-quit', runPendingQuitWork)
registerCriticalQuitWork(runPendingQuitWork)
