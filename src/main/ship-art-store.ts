// 记住游戏自己下过的舰船美术路径，供图鉴取图。
//
// 起因见 shared/ship-art-path.ts：新深海舰的立绘路径带一段无法推导的随机串，
// 按老格式拼出来只会 404。改成「游戏下过什么就记什么」之后，玩家在游戏里
// 见过的舰，图鉴里就能显示——不主动探测，不去第三方站抓图。

import path from 'path'
import fs from 'fs'

import { atomicWriteJsonSync } from './atomic-json'
import { APPDATA_PATH } from './env'
import { parseShipArtPath, sanitizeShipArtMap, shipArtKey } from '../shared/ship-art-path'
import { safeConsole } from './crash-log'

const FILE = path.join(APPDATA_PATH, 'ship-art-paths.json')

// 一艘舰最多十几种图，全部舰种加起来也就几千条，放内存无压力。
let learned: Record<string, string> = {}
let loaded = false
let saveTimer: ReturnType<typeof setTimeout> | null = null

const load = () => {
  if (loaded) return
  loaded = true
  try {
    if (fs.existsSync(FILE)) {
      learned = sanitizeShipArtMap(JSON.parse(fs.readFileSync(FILE, 'utf8')))
    }
  } catch (error) {
    // 读不出来就当没学过，下次游戏跑起来会重新记；绝不让它拦住启动
    safeConsole('warn', '[kanso] 舰船美术路径表读取失败，按空表继续', error)
    learned = {}
  }
}

// 一场战斗能带来几十条新路径，逐条落盘没必要；攒一下再写。
const scheduleSave = () => {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      atomicWriteJsonSync(FILE, learned)
    } catch (error) {
      safeConsole('warn', '[kanso] 舰船美术路径表落盘失败', error)
    }
  }, 4000)
  saveTimer.unref?.()
}

/**
 * 记下游戏刚请求的一条美术路径。
 *
 * @returns 这一条是不是**新**的（调用方据此决定要不要通知渲染层刷新）
 */
export const rememberShipArtPath = (pathname: string): boolean => {
  load()
  const entry = parseShipArtPath(pathname)
  if (!entry) return false
  const key = shipArtKey(entry.mstId, entry.type)
  if (learned[key] === entry.pathname) return false
  // 官方换版会让同一张图换文件名，后来的一律覆盖先前的
  learned[key] = entry.pathname
  scheduleSave()
  return true
}

/** 当前学到的全表（渲染层启动时取一次，之后靠广播增量更新） */
export const shipArtPaths = (): Record<string, string> => {
  load()
  return { ...learned }
}

/** 落盘（退出时调用，别把最后几条学到的丢掉） */
export const flushShipArtPaths = () => {
  if (!saveTimer) return
  clearTimeout(saveTimer)
  saveTimer = null
  try {
    atomicWriteJsonSync(FILE, learned)
  } catch (error) {
    safeConsole('warn', '[kanso] 舰船美术路径表退出时落盘失败', error)
  }
}
