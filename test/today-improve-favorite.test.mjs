// 「今日改修」收藏（2026-09-25 维护者裁决）：按装备款式收藏；页顶一个「收藏」组，
// 今天能改的照原样排前，今天不能改的排后标灰并画出哪几天能改；各类别组不再重复列收藏款；
// 收藏开关在行的展开层（「装备详情 ›」旁）。断言对着真编译出来的整段 HTML 下。
import assert from 'node:assert/strict'
import test from 'node:test'

import { expandedOf, foldedOf, todayGroupsHtml, todayRows } from './fixtures/render-today-improve.mjs'

const 装备表 = {
  1: { api_id: 1, api_name: '12.7cm連装砲', api_type: [1, 1, 1, 1] },
  3: { api_id: 3, api_name: '13号対空電探', api_type: [5, 8, 12, 11] },
  5: { api_id: 5, api_name: '61cm四連装魚雷', api_type: [2, 5, 5, 5] },
}
const 方案 = (eq_id, days) => ({
  eq_id,
  improvement: [{
    helpers: [{ ship_ids: [-1], days }],
    costs: { p1: { devmats: 1, devmats_sli: 2, screws: 1, screws_sli: 2 }, fuel: 10, ammo: 10, steel: 10, baux: 0 },
  }],
})
const 账本 = (over = {}) => ({
  equips: 装备表,
  shipMst: { 182: { api_id: 182, api_name: '明石' } },
  equipTypes: { 1: '小口径主砲', 12: '小型電探', 5: '魚雷' },
  day: 2,
  // 1 与 5 周二能改；3 只有周一、周三
  eo: [方案(1, [2]), 方案(3, [1, 3]), 方案(5, [2])],
  favorites: [1, 3],
  mg: {
    ships: { 1: { id: 1, shipId: 182, lv: 60, slot: [-1, -1, -1, -1], slotEx: 0 } },
    slotitems: {
      301: { mstId: 1, level: 0, alv: 0, locked: false },
      302: { mstId: 3, level: 0, alv: 0, locked: false },
      303: { mstId: 5, level: 0, alv: 0, locked: false },
    },
    decks: [{ id: 1, name: '第1', mission: [0], ships: [1, -1, -1, -1, -1, -1] }],
    materials: { 0: 9999, 1: 9999, 2: 9999, 3: 9999, 6: 9999, 7: 9999 },
  },
  ...over,
})

/** 整段拆成一组一组：[组键, 组 HTML] */
const 分组 = (html) => html.split('<div class="grp-box">').slice(1).map((part) => [/data-grp-key="([^"]*)"/.exec(part)?.[1], part])
/** 某款装备那一整条 <details>（今天的方案或灰行） */
const 行 = (html, id) => new RegExp(`<details class="improve-item" data-equip="${id}"[\\s\\S]*?</details>`).exec(html)?.[0] ?? ''

test('今天的方案不变：收藏款仍是真方案并带收藏标记，灰行不算进方案条数', () => {
  const rows = todayRows(账本())
  assert.deepEqual(rows.map((r) => r.equipId).sort(), [1, 5])
  assert.equal(rows.find((r) => r.equipId === 1).favorite, true)
  assert.equal(rows.find((r) => r.equipId === 5).favorite, false)
})

test('收藏组在最上面：今天能改的在前，今天不能改的在后；类别组不再重复列收藏款', () => {
  const html = todayGroupsHtml(账本())
  const groups = 分组(html)
  assert.equal(groups[0][0], 'equipToday:收藏')
  const fav = groups[0][1]
  assert.match(fav.slice(0, fav.indexOf('</div>')), /收藏/)
  assert.ok(fav.includes('data-equip="1"') && fav.includes('data-equip="3"'))
  assert.ok(fav.indexOf('data-equip="1"') < fav.indexOf('data-equip="3"'))
  for (const [key, part] of groups.slice(1)) {
    assert.ok(!part.includes('data-equip="1"') && !part.includes('data-equip="3"'), `${key} 重复列了收藏款`)
  }
  // 小口径主砲组只有收藏款那一件，搬走后整组不再出现；鱼雷照旧在自己的组
  assert.ok(!groups.some(([key]) => key === 'equipToday:小口径主砲'))
  assert.ok(groups.find(([key]) => key === 'equipToday:魚雷')[1].includes('data-equip="5"'))
})

test('今天不能改的收藏标灰：写明今日不可改修，并用周历点出能改的日子', () => {
  const grey = 行(todayGroupsHtml(账本()), 3)
  assert.ok(grey, '收藏组里缺了今天不能改的那一款')
  assert.match(foldedOf(grey), /class="row[^"]*\bghost\b/)
  assert.match(foldedOf(grey), /今日不可改修/)
  assert.ok(grey.includes('<span class="day on" title="星期一">一</span>'))
  assert.ok(grey.includes('<span class="day on" title="星期三">三</span>'))
  assert.ok(grey.includes('<span class="day" title="星期二">二</span>'))
  // 今天能改的收藏款不标灰
  assert.doesNotMatch(foldedOf(行(todayGroupsHtml(账本()), 1)), /\bghost\b/)
})

test('收藏开关在展开层：已收藏写「★ 已收藏」，未收藏写「☆ 收藏」，灰行也能取消', () => {
  const html = todayGroupsHtml(账本())
  const on = expandedOf(行(html, 1))
  assert.match(on, /data-improve-favorite="1"[^>]*>\s*★ 已收藏/)
  assert.ok(on.includes('data-improve-open="1"'))
  assert.match(expandedOf(行(html, 5)), /data-improve-favorite="5"[^>]*>\s*☆ 收藏/)
  const grey = expandedOf(行(html, 3))
  assert.match(grey, /data-improve-favorite="3"[^>]*>\s*★ 已收藏/)
  assert.ok(grey.includes('data-improve-open="3"'))
  // 开关不进折叠态：行本身点一下是展开
  assert.ok(!foldedOf(行(html, 1)).includes('data-improve-favorite'))
})

test('没有收藏时不出收藏组，其余版面照旧', () => {
  const html = todayGroupsHtml(账本({ favorites: [] }))
  assert.ok(!html.includes('equipToday:收藏'))
  assert.ok(!html.includes('data-improve-favorite="1"') || html.includes('☆ 收藏'))
  assert.ok(分组(html).find(([key]) => key === 'equipToday:小口径主砲')[1].includes('data-equip="1"'))
})

test('收藏组同样受筛选与搜索约束；筛空了就不出收藏组', () => {
  const noRadar = todayGroupsHtml(账本({ match: (e) => e.api_id !== 3 }))
  assert.equal(分组(noRadar)[0][0], 'equipToday:收藏')
  assert.ok(!noRadar.includes('data-equip="3"'))
  const onlyTorpedo = todayGroupsHtml(账本({ match: (e) => e.api_id === 5 }))
  assert.ok(!onlyTorpedo.includes('equipToday:收藏'))
})

test('收藏款手上已经没有了也照样列成灰行；名单里查无此款的编号静默跳过', () => {
  const base = 账本()
  const { 302: _gone, ...slotitems } = base.mg.slotitems
  const html = todayGroupsHtml({ ...base, favorites: [1, 3, 999], mg: { ...base.mg, slotitems } })
  assert.match(foldedOf(行(html, 3)), /今日不可改修/)
  assert.ok(!html.includes('data-equip="999"'))
})
