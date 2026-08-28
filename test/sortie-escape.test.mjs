// 退避：旗舰装了艦隊司令部施設，战果之后玩家点了「退避」，那一艘（連合護衛退避时
// 还带一艘护卫）就被送回港，之后的节点不再参战。
//
// 三层各自有护栏：
//   1. 判据（shared/sortie-escape）—— 舰位换在籍 id、名单增量、返港即解除
//   2. 落账（store 的 onGobackPort）—— 只在玩家真点了之后落，没 offer 就 warn 不猜
//   3. 消费（fleet-calc.engagedShips）—— 制空/索敌/输送量/大破名单一律排除她
//
// 时序上要点名的一件事：**游戏问过不算数**。battleresult 里的 escapeOffer 只是
// 「现在问你要不要让这几条退」，玩家没点也照样发；goback_port 到了才是「答应了」。
import assert from 'node:assert/strict'
import test from 'node:test'

import sortieEscape from '../dist/shared/sortie-escape.js'
import {
  detectTaiha,
  engagedShips,
  escapedInSortie,
  isEscapedInSortie,
  notices,
  setSortie,
} from './fixtures/escape-consumers.mjs'
import { feedGobackPort, reset, sortie, warnings } from './fixtures/store-escape-reducers.mjs'

const { escapedShipsOf, newEscapeEntries, rosterAtEscapePosition } = sortieEscape

// ---- 判据：舰位 → 在籍 id ----

const SINGLE = { main: [101, 102, 103, 104, 105, 106], escort: [] }
const COMBINED = { main: [101, 102, 103, 104, 105, 106], escort: [201, 202, 203, 204, 205, 206] }
const STRIKE_FORCE = { main: [101, 102, 103, 104, 105, 106, 107], escort: [] } // 遊撃部隊：单队 7 舰

test('連合舰队：0–5 落主力，6–11 落护卫队（偏移 6）', () => {
  assert.equal(rosterAtEscapePosition(COMBINED, 0), 101)
  assert.equal(rosterAtEscapePosition(COMBINED, 5), 106)
  assert.equal(rosterAtEscapePosition(COMBINED, 6), 201)
  assert.equal(rosterAtEscapePosition(COMBINED, 11), 206)
  assert.equal(rosterAtEscapePosition(COMBINED, 12), null)
})

test('遊撃部隊是单队 7 舰：位 6 是她自己那一队的第七个人，不去找第二队', () => {
  assert.equal(rosterAtEscapePosition(STRIKE_FORCE, 6), 107)
  // 通常舰队没有第七个人：越界就是 null，不回一个 undefined 出去
  assert.equal(rosterAtEscapePosition(SINGLE, 6), null)
})

test('空位与非法舰位一律 null，不硬凑一个人出来', () => {
  assert.equal(rosterAtEscapePosition({ main: [101, -1, 103], escort: [] }, 1), null)
  assert.equal(rosterAtEscapePosition(SINGLE, -1), null)
  assert.equal(rosterAtEscapePosition(SINGLE, 1.5), null)
})

// ---- 判据：名单增量 ----

const describe = (rosterId) => ({ mstId: rosterId + 900, name: `舰${rosterId}` })
const at = { cell: 12, ts: 1_700_000_000_000 }

test('護衛退避两艘一起收，各带各的角色', () => {
  assert.deepEqual(
    newEscapeEntries({ escape: [1], tow: [7] }, COMBINED, [], at, describe),
    [
      { rosterId: 102, mstId: 1002, name: '舰102', role: 'escaped', cell: 12, ts: at.ts },
      // 位 7 = 护卫队第二人（偏移 6），不是第一人
      { rosterId: 202, mstId: 1102, name: '舰202', role: 'tow', cell: 12, ts: at.ts },
    ],
  )
})

test('単艦退避：没有护卫，只收一条', () => {
  const fresh = newEscapeEntries({ escape: [2], tow: [] }, STRIKE_FORCE, [], at, describe)
  assert.equal(fresh.length, 1)
  assert.equal(fresh[0].role, 'escaped')
})

test('已经在名单里的不重复收；同一次里两组指到同一个人也只收一条', () => {
  assert.deepEqual(
    newEscapeEntries({ escape: [1], tow: [] }, COMBINED, [{ rosterId: 102 }], at, describe),
    [],
  )
  const twice = newEscapeEntries({ escape: [1], tow: [1] }, COMBINED, [], at, describe)
  assert.equal(twice.length, 1)
  assert.equal(twice[0].role, 'escaped', '重复时保留先收的那个角色')
})

test('没有 offer 就没有增量——「游戏问过」与「玩家点了」不是一回事', () => {
  assert.deepEqual(newEscapeEntries(null, COMBINED, [], at, describe), [])
  assert.deepEqual(newEscapeEntries(undefined, COMBINED, [], at, describe), [])
})

// ---- 判据：从状态推导 / 返港即解除 ----

const entry = { rosterId: 102, mstId: 1002, name: '舰102', role: 'escaped', cell: 12, ts: at.ts }

test('退避态可从状态推导：同一份出击算多少次都是同一个答案', () => {
  const s = { active: true, practice: false, escaped: [entry] }
  assert.deepEqual(escapedShipsOf(s), [entry])
  assert.deepEqual(escapedShipsOf(s), escapedShipsOf(s))
})

test('返港即解除：active 落下的那一刻名单就不再生效', () => {
  assert.deepEqual(escapedShipsOf({ active: false, practice: false, escaped: [entry] }), [])
})

test('演习与缺失出击都不算退避；老快照缺字段当成空，不是崩', () => {
  assert.deepEqual(escapedShipsOf({ active: true, practice: true, escaped: [entry] }), [])
  assert.deepEqual(escapedShipsOf(null), [])
  assert.deepEqual(escapedShipsOf(undefined), [])
  assert.deepEqual(escapedShipsOf({ active: true, practice: false, escaped: undefined }), [])
})

// ---- 落账：goback_port ----

const NAMES = {
  101: { mstId: 1, name: '大淀' },
  102: { mstId: 2, name: '鈴谷改二' },
  103: { mstId: 3, name: '熊野改二' },
  107: { mstId: 7, name: '夕張改二' },
  201: { mstId: 11, name: '由良改二' },
  202: { mstId: 12, name: '朝潮改二丁' },
}

test('連合護衛退避：第二队的位映射对，两艘都落到出击上', () => {
  reset({
    decks: { 1: [101, 102, 103, 104, 105, 106], 2: [201, 202, 203, 204, 205, 206] },
    ships: NAMES,
    combinedFlag: 1,
    sortie: { currentCell: 9 },
    offer: { escape: [1], tow: [6], type: 1 },
  })
  const sections = feedGobackPort(1_700_000_000_777)
  assert.deepEqual(sections, ['sortie'])
  assert.deepEqual(sortie().escaped, [
    { rosterId: 102, mstId: 2, name: '鈴谷改二', role: 'escaped', cell: 9, ts: 1_700_000_000_777 },
    { rosterId: 201, mstId: 11, name: '由良改二', role: 'tow', cell: 9, ts: 1_700_000_000_777 },
  ])
})

test('遊撃部隊単艦退避：没有第二队，位 6 落在自己队里', () => {
  reset({
    decks: { 1: [101, 102, 103, 104, 105, 106, 107] },
    ships: NAMES,
    combinedFlag: 0,
    offer: { escape: [6], tow: [], type: 1 },
  })
  feedGobackPort()
  assert.deepEqual(sortie().escaped.map((one) => [one.rosterId, one.role]), [[107, 'escaped']])
})

test('没在联合却报了 6 以上的位：指不到人就不落，不去第二队乱找', () => {
  reset({
    decks: { 1: [101, 102, 103, 104, 105, 106], 2: [201, 202] },
    ships: NAMES,
    combinedFlag: 0, // 第二队在编成里，但这一趟不是联合出击
    offer: { escape: [6], tow: [], type: 1 },
  })
  assert.deepEqual(feedGobackPort(), [])
  assert.deepEqual(sortie().escaped, [])
})

test('到了 goback_port 却没有 offer：记一条 warn，不猜是谁走了', () => {
  reset({ ships: NAMES })
  assert.deepEqual(feedGobackPort(), [])
  assert.deepEqual(sortie().escaped, [])
  assert.equal(warnings().length, 1)
  assert.match(warnings()[0], /没有退避选项/)
})

test('重复到达不重复落：同一个人只记一次', () => {
  reset({ ships: NAMES, offer: { escape: [1], tow: [], type: 1 } })
  feedGobackPort()
  assert.deepEqual(feedGobackPort(), [], '第二次一条都不该新增')
  assert.equal(sortie().escaped.length, 1)
})

test('演习与非出击都不落', () => {
  reset({ ships: NAMES, sortie: { practice: true }, offer: { escape: [1], tow: [], type: 1 } })
  assert.deepEqual(feedGobackPort(), [])
  assert.deepEqual(sortie().escaped, [])

  reset({ ships: NAMES, sortie: null })
  assert.deepEqual(feedGobackPort(), [])
})

test('新出击的默认值里就有这张空表，不是 undefined', () => {
  reset({ ships: NAMES })
  assert.deepEqual(sortie().escaped, [])
})

// ---- 消费：算数的地方要把她排除，喊话的地方不再喊她 ----

const FLEET = [{ id: 101 }, { id: 102 }, { id: 103 }]
const escapedSortie = (patch = {}) => ({
  active: true,
  practice: false,
  escaped: [{ rosterId: 102, mstId: 2, name: '鈴谷改二', role: 'escaped', cell: 9, ts: at.ts }],
  ...patch,
})

test('engagedShips 把退避的舰拿掉，其余原样按序留下', () => {
  setSortie(escapedSortie())
  assert.deepEqual(engagedShips(FLEET), [{ id: 101 }, { id: 103 }])
  assert.equal(isEscapedInSortie(102), true)
  assert.equal(escapedInSortie(102).role, 'escaped')
  assert.equal(escapedInSortie(101), null)
})

test('返港后 engagedShips 全放行——没有「忘了恢复」这条路', () => {
  setSortie(escapedSortie({ active: false }))
  assert.deepEqual(engagedShips(FLEET), FLEET)
  assert.equal(isEscapedInSortie(102), false)
  setSortie(null)
  assert.deepEqual(engagedShips(FLEET), FLEET)
})

// 铃的大破警告：判据用战斗视图自带的 escaped（api_escape_idx / 血量 -1）
const battleShip = (over = {}) => ({
  index: 0,
  rosterId: 101,
  mstId: 1,
  name: '大淀',
  hpEnd: 40,
  hpMax: 40,
  sunk: false,
  escaped: false,
  ...over,
})
const inBattle = (fShips) => ({
  active: true,
  practice: false,
  battle: { fShips },
  battleCount: 2,
  nodes: [{ cell: 9, eventId: 4 }],
  currentCell: 9,
  bossCell: -1,
  mapArea: 6,
  mapNo: 5,
})

test('铃：已退避的舰再破也不喊——她被送回港了，那句话说的不是她', () => {
  setSortie(inBattle([battleShip({ rosterId: 102, name: '鈴谷改二', hpEnd: 5, escaped: true })]))
  detectTaiha()
  assert.deepEqual(notices(), [])
})

test('铃：同一战里还在场的那条照喊，一个字不少', () => {
  setSortie(
    inBattle([
      battleShip({ rosterId: 102, name: '鈴谷改二', hpEnd: 5, escaped: true }),
      battleShip({ rosterId: 103, name: '熊野改二', hpEnd: 4 }),
    ]),
  )
  detectTaiha()
  assert.equal(notices().length, 1)
  assert.match(notices()[0].title, /熊野改二/)
  assert.ok(!notices()[0].title.includes('鈴谷改二'), '退避的那条不该出现在名单里')
  assert.ok(!notices()[0].detail.includes('鈴谷改二'))
})
