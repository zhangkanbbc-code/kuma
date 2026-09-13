// 初始化只读一次盘，之后由主进程整表广播更新。
const path = require('path')
const fs = require('fs')
const remote = require('@electron/remote')
import {
  equipHeldOnce as heldOnceIn,
  equipBookPagesRead as pagesReadIn,
  sanitizeEquipBookMap,
} from '../shared/equip-book'

let book = sanitizeEquipBookMap(null)
const loadEquipBook = () => {
  try {
    const file = path.join(remote.getGlobal('APPDATA_PATH'), 'equip-book.json')
    if (!fs.existsSync(file)) return
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    book = sanitizeEquipBookMap(raw?.book)
  } catch (error) {
    console.warn('[kuma] 装备图鉴记录读取失败，按空表继续', error)
  }
}
loadEquipBook()

export const noteEquipBook = (map: unknown): void => {
  book = sanitizeEquipBookMap(map)
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent('kuma:equip-book-change'))
  }
}

export const equipHeldOnce = (mstId: number): boolean => heldOnceIn(book, mstId)
export const equipBookPagesRead = (): number[] => pagesReadIn(book)
