// 主进程环境常量（同构自 poi lib/env.ts 的思路）。
// 同时挂到 global：webview preload 的隔离世界要用 remote.getGlobal 取值。

// 必须在任何业务模块被 require 之前——Node 只给「启用之后编译的模块」建 source map 缓存。
// 本文件是 index.ts 的第一个 import，所以这里就是最早的时机。
//
// 主进程与共享层是逐文件转译并带内联 map 的，但不开这一项那份 map 谁也不读：
// crash.log 里记的栈会指向 dist/main/*.js 的行号。开了之后直接指到 src/**/*.ts 的真实行。
// 实测：不带 → `at Object.boom (a.js:24:9)`；带 → `at Object.boom (a.ts:5:9)`。
process.setSourceMapsEnabled?.(true)

import { app } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { dataDirCandidates, planDataDir } from '../shared/data-dir'

export const KANSO_VERSION = app.getVersion()
export const ROOT = path.join(__dirname, '..', '..') // dist/main → 仓库根

// 端到端验收（scripts/quit-e2e.ps1）必须在**打包产物**上跑，又绝不能碰用户的正式账本。
// 「设 APPDATA 环境变量把 Electron 的 appData 指到副本」这条路是**假的**——
// 2026-08-20 实测（electron 43，本机）：APPDATA 指到临时目录后
// app.getPath('appData') 仍然返回真实的 ...\AppData\Roaming。
// 所以只能自己开一个口子：显式的数据目录覆盖。仅供验收用，正式运行不设。
export const DATA_DIR_OVERRIDDEN = Boolean(process.env.KANSO_DATA_DIR)

const existsSafe = (dir: string): boolean => {
  try {
    return fs.existsSync(dir)
  } catch {
    // 权限不足读不到就当它不在：判定要有个确定答案，而「不在」这一侧不会去动它
    return false
  }
}

/**
 * 数据目录 + 首启搬迁（2026-08-28 产品改名 艦素 → kuma）。
 *
 * 判定本身在 `shared/data-dir` 里（纯函数，穷举四情形有单测）；这里只负责
 * 真的搬那一下。**搬不动就继续用旧目录**——数据可用性高于目录名，
 * 失败的原因交给 crash.log（见 `DATA_DIR_MIGRATION_ERROR` 的读取方 crash-log.ts）。
 */
const resolveDataDir = (): { dir: string; error: string | null } => {
  // 冒烟测试用独立临时目录：绝不碰真实实例的配置/账本/缓存（避免文件锁撞车）。
  // 它与正式目录没有继承关系，不参与搬迁。
  if (!process.env.KANSO_DATA_DIR && process.env.KANSO_SMOKE) {
    return { dir: path.join(os.tmpdir(), 'kanso-smoke'), error: null }
  }
  const appData = app.getPath('appData')
  const candidates = dataDirCandidates(appData)
  const plan = planDataDir({
    appData,
    legacyExists: existsSafe(candidates.legacyDir),
    currentExists: existsSafe(candidates.dir),
    override: process.env.KANSO_DATA_DIR ? path.resolve(process.env.KANSO_DATA_DIR) : null,
  })
  if (!plan.migrate) return { dir: plan.dir, error: null }
  try {
    fs.renameSync(plan.legacyDir, plan.dir)
    return { dir: plan.dir, error: null }
  } catch (error) {
    // 并发的第二个实例可能刚好搬成功了——先复核，别把已经搬好的又退回旧路径
    if (existsSafe(plan.dir)) return { dir: plan.dir, error: null }
    const reason = error instanceof Error ? error.message : String(error)
    return {
      dir: plan.legacyDir,
      error: `数据目录搬迁失败，本次继续使用 ${plan.legacyDir}（目标 ${plan.dir}）：${reason}`,
    }
  }
}

const dataDir = resolveDataDir()

export const APPDATA_PATH = dataDir.dir
/** 首启搬迁失败时的原因；成功或无需搬迁时为 null。crash-log 启动时记它一条。 */
export const DATA_DIR_MIGRATION_ERROR = dataDir.error
export const DEFAULT_CACHE_PATH = path.join(APPDATA_PATH, 'MyCache')
export const DEFAULT_SCREENSHOT_PATH = path.join(APPDATA_PATH, 'screenshots')

global.KANSO_VERSION = KANSO_VERSION
global.ROOT = ROOT
global.APPDATA_PATH = APPDATA_PATH
global.DEFAULT_CACHE_PATH = DEFAULT_CACHE_PATH
global.DEFAULT_SCREENSHOT_PATH = DEFAULT_SCREENSHOT_PATH
