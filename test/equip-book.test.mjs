import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'
import { buildSync } from 'esbuild'
import book from '../dist/shared/equip-book.js'
import { renderEquipBookFoot } from './fixtures/render-equip-book-foot.mjs'

const {
  EQUIP_BOOK_PAGE_SIZE, equipBookPageOf, parsePictureBookEquipPage, sanitizeEquipBookMap,
  mergeEquipBookPage, noteEquipSeen, equipHeldOnce, equipBookPagesRead,
} = book

// 合成样本只复用协议条目形状，不代表任何实际库存或图鉴读取记录。
const entry = (id) => ({
  api_index_no: id, api_state: [1, 0, 0, 0, 0], api_table_id: [id],
  api_name: '12cm単装砲', api_type: [1, 1, 1, 1], api_souk: 0, api_houg: 1,
  api_flag: [1, 0, 0, 0, 0, 0, 0, 0], api_info: '…',
})
const isEquipMstId = (id) => new Set([142, 143, 144]).has(id)
const data = { api_list: [entry(144), entry(142), entry(143), entry(142)] }
const post = { api_type: '2', api_no: '3' }
const empty = () => sanitizeEquipBookMap(null)

test('装备页按主数据取首个编号，去重升序；接受数字参数与 api_data 外壳', () => {
  const expected = { page: 3, unlocked: [142, 143, 144] }
  assert.deepEqual(parsePictureBookEquipPage(data, post, isEquipMstId), expected)
  assert.deepEqual(parsePictureBookEquipPage({ api_data: data }, { api_type: 2, api_no: 3 }, isEquipMstId), expected)
})

test('相同装备形状放在舰船页也整份落空', () => {
  assert.equal(parsePictureBookEquipPage(data, { ...post, api_type: '1' }, isEquipMstId), null)
})

test('不在装备主数据的编号跳过，主数据未到位不认出装备', () => {
  assert.deepEqual(parsePictureBookEquipPage({ api_list: [entry(141), entry(142)] }, post, isEquipMstId), { page: 3, unlocked: [142] })
  assert.deepEqual(parsePictureBookEquipPage(data, post, () => false), { page: 3, unlocked: [] })
})

test('空页也保存读过时间', () => {
  for (const apiData of [{ api_result: 1, api_result_msg: '成功', api_data: null }, null, { api_list: [] }]) {
    const parsed = parsePictureBookEquipPage(apiData, { api_type: '2', api_no: '10' }, isEquipMstId)
    assert.deepEqual(parsed, { page: 10, unlocked: [] })
    const map = empty()
    assert.equal(mergeEquipBookPage(map, parsed, 1000), 0)
    assert.equal(map.pages['10'], 1000)
    assert.deepEqual(equipBookPagesRead(map), [10])
  }
})

test('api_state 首项必须严格等于 1', () => {
  for (const state of [0, '1']) {
    assert.deepEqual(parsePictureBookEquipPage({ api_list: [{ ...entry(142), api_state: [state, 0, 0, 0, 0] }] }, post, isEquipMstId), { page: 3, unlocked: [] })
  }
})

test('重复合并新增数为零，页时间取新且旧报文不回退', () => {
  const map = empty()
  const parsed = parsePictureBookEquipPage(data, post, isEquipMstId)
  assert.equal(mergeEquipBookPage(map, parsed, 1000), 3)
  assert.equal(mergeEquipBookPage(map, parsed, 2000), 0)
  assert.equal(mergeEquipBookPage(map, parsed, 500), 0)
  assert.equal(map.pages['3'], 2000)
  assert.equal(map.unlocked['142'], 2000)
  mergeEquipBookPage(map, { page: 1, unlocked: [] }, 2000)
  assert.deepEqual(equipBookPagesRead(map), [1, 3])
})

test('库存新增去重，重复不覆盖首次时间', () => {
  const map = empty()
  assert.equal(noteEquipSeen(map, [142, 143, 142], 1000), 2)
  assert.equal(noteEquipSeen(map, [142, 144], 2000), 1)
  assert.equal(map.seen['142'], 1000)
  assert.equal(map.seen['144'], 2000)
})

test('曾持有是图鉴解锁与库存见过的并集', () => {
  const map = { pages: {}, unlocked: { 142: 1000 }, seen: { 143: 1000 } }
  assert.equal(equipHeldOnce(map, 142), true)
  assert.equal(equipHeldOnce(map, 143), true)
  assert.equal(equipHeldOnce(map, 144), false)
})

test('每页容量与跨页边界', () => {
  assert.equal(EQUIP_BOOK_PAGE_SIZE, 70)
  for (const [sortno, page] of [[70, 1], [71, 2], [142, 3], [588, 9]]) assert.equal(equipBookPageOf(sortno), page)
})

test('持久表清洗垃圾、负数键与非法时间', () => {
  for (const raw of [null, 'x', -1, { pages: { '-1': 1000 }, unlocked: { '-2': 1000 }, seen: { '-3': 1000 } }]) {
    assert.deepEqual(sanitizeEquipBookMap(raw), { pages: {}, unlocked: {}, seen: {} })
  }
  assert.deepEqual(sanitizeEquipBookMap({ pages: { 1: 1000, x: 1000 }, unlocked: { 142: 2000, 143: 'bad' }, seen: { 144: -1 } }), { pages: { 1: 1000 }, unlocked: { 142: 2000 }, seen: {} })
})

test('请求类型、页号与响应形状不合法时落空', () => {
  for (const api_no of [undefined, '', 0, -1, 1.5, 'bad']) assert.equal(parsePictureBookEquipPage(data, { api_type: 2, api_no }, isEquipMstId), null)
  assert.equal(parsePictureBookEquipPage(data, { api_type: 3, api_no: 1 }, isEquipMstId), null)
  assert.equal(parsePictureBookEquipPage({}, post, isEquipMstId), null)
  assert.equal(parsePictureBookEquipPage({ api_data: {} }, post, isEquipMstId), null)
  assert.equal(parsePictureBookEquipPage(undefined, post, isEquipMstId), null)
  assert.equal(parsePictureBookEquipPage(null, { api_type: '1', api_no: '10' }, isEquipMstId), null)
  assert.equal(parsePictureBookEquipPage(null, { api_type: '2', api_no: '0' }, isEquipMstId), null)
})

const equips = [142, 143, 144, 145].map((id, at) => ({ api_id: id, api_sortno: at === 3 ? 588 : id }))
test('脚注真编译：未读图鉴时提示补齐，款数按持有与曾持有并集去重', () => {
  const html = renderEquipBookFoot({ equips, held: [142, 143], once: [143, 144] })
  assert.match(html, /图鉴页尚未读取/)
  assert.match(html, /已解锁 <b[^>]*>3<\/b> \/ 4 款 · 当前持有 2/)
  assert.match(html, /width:75%/)
})

test('脚注真编译：页码压成区间，只列总页数以内的页', () => {
  const html = renderEquipBookFoot({ equips, pages: [1, 3, 4, 5, 6, 7, 8, 9, 10] })
  assert.match(html, /已解锁来自游戏图鉴页与库存记录 · 图鉴页已读取 第 1、3–9 页 \/ 共 9 页/)
  assert.doesNotMatch(html, /10/)
  assert.equal(renderEquipBookFoot({ equips: [] }), '')
})

test('持久层真运行：空页通知、延迟写、立即保存游标、重载与退出刷盘', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-equip-book-store-'))
  fs.mkdirSync(path.join(dir, 'main'))
  fs.mkdirSync(path.join(dir, 'shared'))
  for (const rel of ['main/equip-book-store.ts', 'main/atomic-json.ts', 'shared/equip-book.ts']) {
    fs.copyFileSync(new URL('../src/' + rel, import.meta.url), path.join(dir, rel))
  }
  const env = path.join(dir, 'main/env.ts')
  const log = path.join(dir, 'main/crash-log.ts')
  const outfile = path.join(dir, 'store.cjs')
  fs.writeFileSync(env, `export const APPDATA_PATH = ${JSON.stringify(dir)}`)
  fs.writeFileSync(log, 'export const safeConsole = () => {}')
  fs.writeFileSync(path.join(dir, 'main/perf-time.ts'), 'export const timeMain = (_scope, fn) => fn()')
  buildSync({
    entryPoints: [path.join(dir, 'main/equip-book-store.ts')],
    outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  })
  const require = createRequire(import.meta.url)
  const store = require(outfile)
  const file = path.join(dir, 'equip-book.json')
  assert.equal(store.rememberEquipBookPage({ api_result: 1, api_result_msg: '成功', api_data: null }, { api_type: 2, api_no: 10 }, isEquipMstId, 1000), true)
  assert.equal(store.rememberEquipBookPage({ api_list: [] }, { api_type: 2, api_no: 10 }, isEquipMstId, 2000), false)
  assert.equal(fs.existsSync(file), false)
  assert.equal(store.rememberEquipSeen([142], 1000), 1)
  store.noteEquipBookBackfill(7)
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(saved.schemaVersion, 1)
  assert.equal(saved.scannedEventId, 7)
  assert.equal(saved.book.pages['10'], 2000)
  delete require.cache[require.resolve(outfile)]
  const reloaded = require(outfile)
  assert.equal(reloaded.equipBookBackfillCursor(), 7)
  assert.equal(reloaded.equipBook().seen['142'], 1000)
  assert.equal(reloaded.rememberEquipSeen([142, 143], 3000), 1)
  reloaded.flushEquipBook()
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).book.seen['143'], 3000)
  const copy = reloaded.equipBook()
  copy.seen['144'] = 4000
  assert.equal(reloaded.equipBook().seen['144'], undefined)
})
