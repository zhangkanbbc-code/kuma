// 史 · 道具视图的「隐藏家具箱」开关。
//
// 家具箱（小/中/大）是日常任务的常客，一天能进一大堆，把真正稀有的道具挤出流水——
// 这枚开关把它们从**道具累计**与**变化流水**里一起撤掉，上面四个数跟着对。
//
// 断言全下在**真产物 HTML** 上（见 fixtures/render-shi-items.mjs 为什么非切真的）：
// 「哪些行不见了」「四个数对不对」正则匹配源码一条也拦不住。
// 识别按主数据名，所以这里造了一件游戏里还没有的「家具箱（特）」：
// 判据一旦退回 id 清单，只有它会红。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  MASTER_NAMES,
  clickToggle,
  configStore,
  configWrites,
  readPersisted,
  renderItems,
  selectedItem,
  setup,
  toggleState,
} from './fixtures/render-shi-items.mjs'

const T = Date.UTC(2026, 7, 20, 3, 0, 0)
const min = (n) => T - n * 60_000

/** 主数据名表 + 一件游戏里还没有的家具箱变种。 */
const NAMES = [...MASTER_NAMES, [999, '家具箱（特）']]

const SUMMARIES = [
  { id: 10, gained: 120, spent: 0, changes: 40, lastTs: min(1) },
  { id: 11, gained: 30, spent: 0, changes: 10, lastTs: min(2) },
  { id: 12, gained: 5, spent: 0, changes: 3, lastTs: min(3) },
  { id: 999, gained: 2, spent: 0, changes: 2, lastTs: min(4) },
  { id: 44, gained: 200, spent: 60, changes: 25, lastTs: min(5) },
  { id: 54, gained: 8, spent: 3, changes: 5, lastTs: min(6) },
]

const CHANGES = [
  { ts: min(1), itemId: 10, delta: 3, total: 120 },
  { ts: min(2), itemId: 44, delta: -2, total: 40 },
  { ts: min(3), itemId: 11, delta: 1, total: 30 },
  { ts: min(4), itemId: 54, delta: 1, total: 8 },
  { ts: min(5), itemId: 12, delta: 1, total: 5 },
  { ts: min(6), itemId: 999, delta: 1, total: 2 },
  { ts: min(7), itemId: 68, delta: 1, total: 1 },
]

const OWNED = { 10: 41, 11: 12, 12: 3, 44: 140, 54: 5, 68: 1, 999: 2 }

/** 摆一局：默认整份数据、开关关着。 */
const board = (extra = {}) => ({
  names: NAMES,
  summaries: SUMMARIES,
  changes: CHANGES,
  owned: OWNED,
  ...extra,
})

const slice = (html, from, to) => {
  const start = html.indexOf(from)
  assert.ok(start >= 0, `产物里没有「${from}」`)
  const end = html.indexOf(to, start)
  assert.ok(end > start, `产物里「${from}」之后没有「${to}」`)
  return html.slice(start, end)
}

/** 左栏「道具累计」那一块。 */
const itemList = (html) => slice(html, '<div class="shi-item-list">', '</section>')
/** 右栏道具变化流水那一块。 */
const timeline = (html) => slice(html, '<div class="shi-item-timeline">', '</section>')

const kpi = (html, label) => {
  const found = html.match(new RegExp(`<small>${label}</small><b[^>]*>([^<]*)</b>`))
  assert.ok(found, `产物里没有「${label}」这一格`)
  return found[1]
}

const FURNITURE = ['家具箱（小）', '家具箱（中）', '家具箱（大）', '家具箱（特）']
const OTHERS = ['改修資材', '勲章']

// ---- ① 关着＝现状不变 ----

test('开关关着：三种家具箱与新变种都在，别的道具也在', () => {
  setup(board())
  const html = renderItems()
  const left = itemList(html)
  const flow = timeline(html)
  for (const name of [...FURNITURE, ...OTHERS]) {
    assert.ok(left.includes(name), `关着时左栏该有「${name}」`)
    assert.ok(flow.includes(name), `关着时流水该有「${name}」`)
  }
  // 行本身还在（不是只剩个名字）
  for (const id of [10, 11, 12, 999]) {
    assert.ok(left.includes(`data-shi-item="${id}"`), `关着时左栏该有 #${id} 这一行`)
  }
})

test('开关关着：四个数照旧是全量', () => {
  setup(board())
  const html = renderItems()
  assert.equal(kpi(html, '有变化道具'), '6')
  assert.equal(kpi(html, '累计获得'), '+365')
  assert.equal(kpi(html, '累计消耗'), '−63')
  assert.equal(kpi(html, '变化记录'), '7')
})

// ---- ② 开着＝两处一起撤 ----

test('开关开着：家具箱从左栏与流水里都不出现', () => {
  setup(board({ hide: true }))
  const html = renderItems()
  const left = itemList(html)
  const flow = timeline(html)
  for (const name of FURNITURE) {
    assert.ok(!left.includes(name), `开着时左栏不该有「${name}」`)
    assert.ok(!flow.includes(name), `开着时流水不该有「${name}」`)
  }
  for (const id of [10, 11, 12, 999]) {
    assert.ok(!left.includes(`data-shi-item="${id}"`), `开着时左栏不该有 #${id} 这一行`)
  }
})

test('开关开着：别的道具一件都没少', () => {
  setup(board({ hide: true }))
  const html = renderItems()
  const left = itemList(html)
  const flow = timeline(html)
  for (const name of OTHERS) {
    assert.ok(left.includes(name), `开着时左栏该留着「${name}」`)
    assert.ok(flow.includes(name), `开着时流水该留着「${name}」`)
  }
  // 只在流水里出现过、没进累计表的那件也得留着
  assert.ok(flow.includes('甲種勲章'), '开着时流水该留着「甲種勲章」')
  assert.ok(left.includes('data-shi-item="44"'), '开着时左栏该留着 #44 这一行')
})

test('开关开着：四个数跟着对', () => {
  setup(board({ hide: true }))
  const html = renderItems()
  // 只剩 改修資材 + 勲章
  assert.equal(kpi(html, '有变化道具'), '2')
  assert.equal(kpi(html, '累计获得'), '+208')
  // 家具箱没有消耗，这一格开关前后本来就该一样
  assert.equal(kpi(html, '累计消耗'), '−63')
  // 7 条里 4 条是家具箱
  assert.equal(kpi(html, '变化记录'), '3')
})

// ---- ③ 按主数据名认，不是 id 清单 ----

test('识别按主数据名：游戏里还没有的「家具箱（特）」也落网', () => {
  setup(board({ hide: true }))
  const html = renderItems()
  assert.ok(!html.includes('家具箱（特）'), '按名识别的话，新变种不用改代码就该被藏起来')
  assert.ok(!html.includes('data-shi-item="999"'))
})

test('主数据名认不出来的道具不受牵连', () => {
  // 名表里根本没有 77 这个 id：主数据还没到手时宁可多显示一行，也不能顺手吞掉别人
  setup(
    board({
      hide: true,
      summaries: [{ id: 77, gained: 4, spent: 0, changes: 1, lastTs: min(1) }],
      changes: [{ ts: min(1), itemId: 77, delta: 4, total: 4 }],
    }),
  )
  const html = renderItems()
  assert.ok(html.includes('data-shi-item="77"'), '查不到名字的道具该照常显示')
  assert.equal(kpi(html, '有变化道具'), '1')
})

test('名字沾「家具」但不是箱子的道具不受牵连', () => {
  // 「家具」两个字不够——判据是整个「家具箱」
  setup(
    board({
      hide: true,
      names: [...NAMES, [123, '家具コイン']],
      summaries: [
        { id: 123, gained: 9, spent: 0, changes: 2, lastTs: min(1) },
        { id: 10, gained: 120, spent: 0, changes: 40, lastTs: min(2) },
      ],
      changes: [
        { ts: min(1), itemId: 123, delta: 9, total: 9 },
        { ts: min(2), itemId: 10, delta: 3, total: 120 },
      ],
    }),
  )
  const html = renderItems()
  assert.ok(itemList(html).includes('家具コイン'), '家具コイン 该留着')
  assert.ok(timeline(html).includes('家具コイン'))
  assert.ok(!itemList(html).includes('家具箱（小）'), '家具箱（小）该被藏起来')
  assert.equal(kpi(html, '有变化道具'), '1')
})

// ---- ④ 开关自己 ----

test('开关文案就五个字，不挂悬停也不报「已隐藏 N 条」', () => {
  setup(board())
  const off = renderItems()
  assert.match(
    off,
    /<button type="button" class="" data-shi-hide-furniture>隐藏家具箱<\/button>/,
    '关态：五个字，class 空',
  )
  setup(board({ hide: true }))
  const on = renderItems()
  assert.match(
    on,
    /<button type="button" class="on" data-shi-hide-furniture>隐藏家具箱<\/button>/,
    '开态：由 on 类自己表达，不另加话',
  )
  // 纪律七之二/五/六/七：开关不解释自己在干什么
  const chip = slice(on, '<div class="shi-item-filter">', '</div>')
  assert.ok(!chip.includes('title='), '开关不许挂悬停解说')
  assert.ok(!/已隐藏|条家具|太多|不显示|已过滤/.test(on), '隐藏状态由 on 态表达，不另起一句')
})

// ---- ⑤ 持久化 ----

test('开关初值读 ui.shi.hideFurnitureBox，默认关', () => {
  for (const key of Object.keys(configStore)) delete configStore[key]
  assert.equal(readPersisted(), false, '没写过配置就是关着＝现状不变')

  configStore['ui.shi.hideFurnitureBox'] = true
  assert.equal(readPersisted(), true, '写过 true 就该读回 true（重启仍记得）')

  configStore['ui.shi.hideFurnitureBox'] = false
  assert.equal(readPersisted(), false)
})

test('点一下开关：翻面并写回同一个键', () => {
  for (const key of Object.keys(configStore)) delete configStore[key]
  configWrites.length = 0
  setup(board())

  clickToggle()
  assert.equal(toggleState(), true)
  assert.deepEqual(
    configWrites.map((write) => write.key),
    ['shi.hideFurnitureBox'],
    '读的键与写的键必须是同一个，否则重启就忘',
  )
  assert.equal(configWrites[0].value, true)
  // 写进去的那份，下次启动读得回来
  assert.equal(readPersisted(), true)

  clickToggle()
  assert.equal(toggleState(), false)
  assert.equal(configWrites.at(-1).value, false)
  assert.equal(readPersisted(), false)
})

test('正选着家具箱时打开开关：连选择一起撤', () => {
  for (const key of Object.keys(configStore)) delete configStore[key]
  configWrites.length = 0
  setup(board({ selectedItemId: 11 }))

  clickToggle()
  assert.equal(selectedItem(), 0, '不能留一个指向看不见的行的筛选')
  assert.deepEqual(
    configWrites.map((write) => write.key),
    ['shi.hideFurnitureBox', 'shi.itemId'],
  )
})

test('正选着别的道具时打开开关：选择不动', () => {
  for (const key of Object.keys(configStore)) delete configStore[key]
  configWrites.length = 0
  setup(board({ selectedItemId: 44 }))

  clickToggle()
  assert.equal(selectedItem(), 44)
  assert.deepEqual(
    configWrites.map((write) => write.key),
    ['shi.hideFurnitureBox'],
  )
})

// ---- ⑥ 样式 ----

test('这枚开关的样式真在样式表里', () => {
  // 上面那些断言看的是「类挂对了没有」，一个都答不上「这个类有没有样式」——
  // 选择器漏了或被误删，产物 HTML 一模一样，屏幕上却是一枚没边框没点亮态的裸按钮。
  const html = fs.readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8')
  for (const selector of [
    '.mod-shi .shi-item-filter button,', // 与其余 chip 共用的底子
    '.mod-shi .shi-item-filter button:hover,',
    '.mod-shi .shi-item-filter button.on,', // 开态就靠它表达
    '.mod-shi .shi-item-filter {',
  ]) {
    assert.ok(html.includes(selector), `样式没了：${selector}`)
  }
})

test('选中某件道具时，流水只剩它 —— 隐藏开着也一样', () => {
  setup(board({ hide: true, selectedItemId: 44 }))
  const flow = timeline(renderItems())
  assert.ok(flow.includes('改修資材'))
  assert.ok(!flow.includes('勲章'), '选了一件就只看这一件')
  assert.ok(!flow.includes('家具箱'))
})
