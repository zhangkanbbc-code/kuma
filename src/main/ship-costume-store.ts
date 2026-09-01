// 记住「哪套衣装是谁的」，供图鉴按舰摆出衣装格。
//
// 起因与判据见 shared/ship-costume.ts：衣装的构图编号（5xxx/6xxx）在主数据的
// `api_mst_ship` 里根本不存在，立绘档案只能按路径里的四位号把它记在幽灵编号下，
// 按舰一张都查不到。归属的唯一出处是玩家自己开图鉴时游戏返回的 `picture_book`。
//
// 与 ship-art-store 同族（JSON 落盘 APPDATA、攒一下再写、读不出来就按空表继续），
// 只多一样：**回灌游标**。账本里躺着玩家过去开图鉴时的那些报文，启动时补一遍历史，
// 补到哪存在文件里，下次只扫新的——不然每次启动都要重解析几十份几万字的报文。

import path from 'path'
import fs from 'fs'

import { atomicWriteJsonSync } from './atomic-json'
import { APPDATA_PATH } from './env'
import {
  costumeOwnerOf as costumeOwnerIn,
  mergeShipCostumes,
  parsePictureBookCostumes,
  sanitizeShipCostumeMap,
  type ShipCostumeMap,
} from '../shared/ship-costume'
import { safeConsole } from './crash-log'

const FILE = path.join(APPDATA_PATH, 'ship-costumes.json')
const SCHEMA_VERSION = 1

let costumes: ShipCostumeMap = {}
/** 回灌扫到的最后一条 events.id。0 = 还没回灌过。 */
let scannedEventId = 0
let loaded = false
let saveTimer: ReturnType<typeof setTimeout> | null = null

const load = () => {
  if (loaded) return
  loaded = true
  try {
    if (!fs.existsSync(FILE)) return
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    costumes = sanitizeShipCostumeMap(raw?.costumes)
    const cursor = Number(raw?.scannedEventId)
    scannedEventId = Number.isInteger(cursor) && cursor > 0 ? cursor : 0
  } catch (error) {
    // 学过的归属没了只是回到「按舰查不到衣装」，绝不让它拦住启动
    safeConsole('warn', '[kanso] 衣装归属表读取失败，按空表继续', error)
    costumes = {}
    scannedEventId = 0
  }
}

const write = () => {
  try {
    atomicWriteJsonSync(FILE, {
      schemaVersion: SCHEMA_VERSION,
      scannedEventId,
      costumes,
    })
  } catch (error) {
    safeConsole('warn', '[kanso] 衣装归属表落盘失败', error)
  }
}

// 一次翻图鉴能带来上百条，逐条落盘没必要；攒一下再写。
const scheduleSave = () => {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    write()
  }, 4000)
  saveTimer.unref?.()
}

/**
 * 收下一份 `picture_book` 报文里的衣装归属。
 *
 * @param isShipMstId 「这个号是主数据里真实存在的一艘舰吗」——判据必须来自主数据，
 *   理由见 shared/ship-costume 的 parsePictureBookCostumes。
 * @returns 这一份带来了几条**新**归属（0 = 全是已知的，调用方不必通知界面）
 */
export const rememberPictureBookCostumes = (
  apiData: unknown,
  isShipMstId: (id: number) => boolean,
): number => {
  load()
  const learned = parsePictureBookCostumes(apiData, isShipMstId)
  if (!learned.length) return 0
  const changed = mergeShipCostumes(costumes, learned)
  if (changed) scheduleSave()
  return changed
}

/** 当前学到的全表（渲染层启动时取一次，之后靠广播增量更新）。 */
export const shipCostumes = (): ShipCostumeMap => {
  load()
  return { ...costumes }
}

/** 这个构图编号该算在哪个形态头上；没学到归属时如实返回它自己。 */
export const costumeOwnerOf = (graphId: number): number => {
  load()
  return costumeOwnerIn(costumes, graphId)
}

/** 回灌该从哪一条 events.id 之后接着扫。 */
export const shipCostumeBackfillCursor = (): number => {
  load()
  return scannedEventId
}

/**
 * 回灌完一段：把游标推到这一条，并**立即落盘**。
 *
 * 立即写而不是攒着：游标的意义是「这段不必再扫」，攒着写会在异常退出后
 * 让下次启动白扫一遍几十份大报文（数据不会错，只是白干）。
 */
export const noteShipCostumeBackfill = (lastEventId: number): void => {
  load()
  if (!Number.isInteger(lastEventId) || lastEventId <= scannedEventId) return
  scannedEventId = lastEventId
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  write()
}

/** 落盘（退出时调用，别把最后学到的几条丢掉）。 */
export const flushShipCostumes = (): void => {
  if (!saveTimer) return
  clearTimeout(saveTimer)
  saveTimer = null
  write()
}
