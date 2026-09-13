// 图鉴解锁与库存见过记录：延迟落盘，回灌游标立即落盘。
import path from 'path'
import fs from 'fs'
import { atomicWriteJsonSync } from './atomic-json'
import { APPDATA_PATH } from './env'
import { safeConsole } from './crash-log'
import {
  mergeEquipBookPage,
  noteEquipSeen,
  parsePictureBookEquipPage,
  sanitizeEquipBookMap,
  type EquipBookMap,
} from '../shared/equip-book'

const FILE = path.join(APPDATA_PATH, 'equip-book.json')
const SCHEMA_VERSION = 1
let book: EquipBookMap = sanitizeEquipBookMap(null)
let scannedEventId = 0
let loaded = false
let saveTimer: ReturnType<typeof setTimeout> | null = null

const load = () => {
  if (loaded) return
  loaded = true
  try {
    if (!fs.existsSync(FILE)) return
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    book = sanitizeEquipBookMap(raw?.book)
    const cursor = Number(raw?.scannedEventId)
    scannedEventId = Number.isInteger(cursor) && cursor > 0 ? cursor : 0
  } catch (error) {
    safeConsole('warn', '[kuma] 装备图鉴记录读取失败，按空表继续', error)
    book = sanitizeEquipBookMap(null)
    scannedEventId = 0
  }
}

const write = () => {
  try {
    atomicWriteJsonSync(FILE, { schemaVersion: SCHEMA_VERSION, scannedEventId, book })
  } catch (error) {
    safeConsole('warn', '[kuma] 装备图鉴记录落盘失败', error)
  }
}

const scheduleSave = () => {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    write()
  }, 4000)
  saveTimer.unref?.()
}

/** 新页（包括空页）或新解锁都需要通知界面；报文时间更新仍须保存。 */
export const rememberEquipBookPage = (
  apiData: unknown,
  post: Record<string, unknown>,
  isEquipMstId: (id: number) => boolean,
  ts: number,
): boolean => {
  load()
  const parsed = parsePictureBookEquipPage(apiData, post, isEquipMstId)
  if (!parsed) return false
  const newPage = book.pages[`${parsed.page}`] === undefined
  const added = mergeEquipBookPage(book, parsed, ts)
  scheduleSave()
  return newPage || added > 0
}

export const rememberEquipSeen = (mstIds: readonly number[], ts: number): number => {
  load()
  const added = noteEquipSeen(book, mstIds, ts)
  if (added) scheduleSave()
  return added
}

export const equipBook = (): EquipBookMap => {
  load()
  return { pages: { ...book.pages }, unlocked: { ...book.unlocked }, seen: { ...book.seen } }
}

export const equipBookBackfillCursor = (): number => {
  load()
  return scannedEventId
}

/** 游标表示这段已经保存，不能等延迟写入才落盘。 */
export const noteEquipBookBackfill = (lastEventId: number): void => {
  load()
  if (!Number.isInteger(lastEventId) || lastEventId <= scannedEventId) return
  scannedEventId = lastEventId
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  write()
}

export const flushEquipBook = (): void => {
  if (!saveTimer) return
  clearTimeout(saveTimer)
  saveTimer = null
  write()
}
