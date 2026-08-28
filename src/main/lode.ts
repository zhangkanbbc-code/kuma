// 矿脉 · 社区数据包加载器。
// 纪律：规则数据不硬编码——条件/改修/带路/推定数值全部走版本化数据包，
// 游戏更新只发包不改代码；每个包必须带来源与抓取日期，消费端负责展示。
// 两层目录：内置包（仓库 assets/lodes/，pin 版本随代码发布）
//          用户包（%APPDATA%/kuma/lodes/，同 id 覆盖内置——手动导入/更新通道）
import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'

import { APPDATA_PATH, ROOT } from './env'
import { validateLodePack } from './lode-validation'
import { applyQuestTextCorrectionsToPack } from '../shared/quest-text-corrections'

export interface LodeMeta {
  id: string
  name: string
  version: string
  source: string // 「谁说的」：如 KC3Kai / akashi-list / TsunDB
  sourceUrl?: string
  fetchedAt: string // 「多新」：ISO 日期
  note?: string
}

interface LodePack {
  meta: LodeMeta
  data: unknown
}

interface CachedPack {
  mtimeMs: number
  size: number
  pack: LodePack | null
}

const BUILTIN_DIR = path.join(ROOT, 'assets', 'lodes')
const USER_DIR = path.join(APPDATA_PATH, 'lodes')
const packCache = new Map<string, CachedPack>()

const readPack = (file: string): LodePack | null => {
  try {
    // 数据包最终会进入渲染层；先限制体积，再做结构校验，不能把“JSON 可解析”
    // 误当成“可安全渲染”。
    const stat = fs.statSync(file)
    const cached = packCache.get(file)
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached.pack
    }
    if (stat.size > 32 * 1024 * 1024) {
      console.warn('[kanso] lode: pack too large, ignored', file)
      packCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, pack: null })
      return null
    }
    const result = validateLodePack(JSON.parse(fs.readFileSync(file, 'utf8')))
    if (result.ok) {
      // 第一方校正台账叠在这里：这是包变成内存对象的唯一入口，主进程的计数引擎与
      // 渲染层的 `lode:get` 都从 loadAll() 出来，叠一次两边就不会分叉。
      // 用户包（%APPDATA%）走同一条路，同样受校正——校正钉着上游原文，
      // 用户那份要是已经改对了，`from` 对不上就自动跳过。
      const pack = applyQuestTextCorrectionsToPack(result.pack as LodePack)
      packCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, pack })
      return pack
    }
    console.warn('[kanso] lode: invalid pack, ignored', file, result.error)
    packCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, pack: null })
  } catch (e) {
    console.warn('[kanso] lode: bad pack', file, e)
  }
  return null
}

const scanDir = (dir: string): Map<string, LodePack> => {
  const packs = new Map<string, LodePack>()
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.json')) continue
      const pack = readPack(path.join(dir, name))
      if (pack) packs.set(pack.meta.id, pack)
    }
  } catch (_e) {
    // 目录不存在等于没有包
  }
  return packs
}

// 文件内容有 mtime 缓存，但 readdir+stat 曾经每次调用都做：
// clearitemget 热路径上调 getLode、计数引擎初始化一次要 7 个包 = 14 次目录扫描。
// 给目录清单加几秒 TTL；手动导入新包最多晚这几秒被看到。
const DIR_TTL_MS = 5000
let dirCache: { at: number; packs: Map<string, LodePack> } | null = null
const loadAll = (): Map<string, LodePack> => {
  if (dirCache && Date.now() - dirCache.at < DIR_TTL_MS) return dirCache.packs
  const packs = scanDir(BUILTIN_DIR)
  for (const [id, pack] of scanDir(USER_DIR)) {
    packs.set(id, pack) // 用户包覆盖内置
  }
  dirCache = { at: Date.now(), packs }
  return packs
}

// 主进程内部取包（铭的计数引擎等）；渲染层走 IPC
export const getLode = (id: string): LodePack | null => loadAll().get(`${id}`) ?? null

ipcMain.handle('lode:list', () => [...loadAll().values()].map((p) => p.meta))

ipcMain.handle('lode:get', (_event, id: string) => loadAll().get(`${id}`) ?? null)

fs.mkdirSync(USER_DIR, { recursive: true })
