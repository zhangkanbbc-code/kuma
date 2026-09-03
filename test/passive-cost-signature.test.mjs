import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import equipStockSignatureModule from '../dist/shared/equip-stock-signature.js'
import jiBookDepsModule from '../dist/shared/ji-book-deps.js'

const { equipStockSignature } = equipStockSignatureModule
const {
  JI_ALL_BOOK_DEPENDENCIES,
  JI_BOOK_DEPENDENCIES,
  jiBookNeedsRender,
} = jiBookDepsModule

const read = (rel) => fs.readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8')
const copy = (value) => structuredClone(value)
const baseStock = () => ({
  ships: [
    { id: 101, shipId: 1, slot: [501, 502], slotEx: 503, hp: 30, cond: 49 },
    { id: 102, shipId: 2, slot: [0, 0], slotEx: 0, hp: 20, cond: 40 },
  ],
  airBases: [
    {
      areaId: 6,
      rid: 1,
      planes: [
        { slotId: 504, count: 18, cond: 1 },
        { slotId: 0, count: 0, cond: 0 },
      ],
    },
  ],
  slotitems: {
    501: { mstId: 10, level: 0, alv: 0, locked: false },
    502: { mstId: 11, level: 3, alv: 0, locked: true },
    503: { mstId: 12, level: 0, alv: 0, locked: false },
    504: { mstId: 13, level: 0, alv: 7, locked: true },
  },
})
const signatureOf = (state) => equipStockSignature(state.ships, state.airBases, state.slotitems)

test('装备仓库签名忽略 HP 与疲劳，HP-only ships 补丁不失效', () => {
  const before = baseStock()
  const after = copy(before)
  after.ships[0].hp = 7
  after.ships[0].cond = 12
  assert.equal(signatureOf(after), signatureOf(before))
})

test('装备仓库签名在卸下一件装备时变化', () => {
  const before = baseStock()
  const after = copy(before)
  after.ships[0].slot[1] = 0
  assert.notEqual(signatureOf(after), signatureOf(before))
})

test('装备仓库签名在装备换到另一艘舰时变化', () => {
  const before = baseStock()
  const after = copy(before)
  after.ships[0].slot[0] = 0
  after.ships[1].slot[0] = 501
  assert.notEqual(signatureOf(after), signatureOf(before))
})

test('装备仓库签名覆盖补强增设槽', () => {
  const before = baseStock()
  const after = copy(before)
  after.ships[0].slotEx = 0
  after.ships[1].slotEx = 503
  assert.notEqual(signatureOf(after), signatureOf(before))
})

test('装备仓库签名覆盖陆航换机与中队归属', () => {
  const before = baseStock()
  const changedPlane = copy(before)
  changedPlane.airBases[0].planes[0].slotId = 502
  assert.notEqual(signatureOf(changedPlane), signatureOf(before))

  const changedSquad = copy(before)
  changedSquad.airBases[0].areaId = 7
  changedSquad.airBases[0].rid = 2
  assert.notEqual(signatureOf(changedSquad), signatureOf(before))
})

test('装备仓库签名在装备入手或废弃时变化', () => {
  const before = baseStock()
  const acquired = copy(before)
  acquired.slotitems[505] = { mstId: 14, level: 0, alv: 0, locked: false }
  assert.notEqual(signatureOf(acquired), signatureOf(before))

  const discarded = copy(before)
  delete discarded.slotitems[502]
  assert.notEqual(signatureOf(discarded), signatureOf(before))
})

test('装备仓库签名覆盖改修等级、熟练度与锁定状态', () => {
  const before = baseStock()
  for (const [field, value] of [
    ['level', 4],
    ['alv', 1],
    ['locked', false],
  ]) {
    const after = copy(before)
    after.slotitems[502][field] = value
    assert.notEqual(signatureOf(after), signatureOf(before), field)
  }
})

test('装备仓库签名覆盖舰实例与舰形态归属', () => {
  const before = baseStock()
  const roster = copy(before)
  roster.ships[0].id = 999
  assert.notEqual(signatureOf(roster), signatureOf(before))

  const form = copy(before)
  form.ships[0].shipId = 101
  assert.notEqual(signatureOf(form), signatureOf(before))
})

test('鉴的卷依赖表与各卷源码读取面一致', () => {
  assert.deepEqual(JI_ALL_BOOK_DEPENDENCIES, ['master'])
  assert.deepEqual(JI_BOOK_DEPENDENCIES, {
    ship: ['ships', 'decks', 'slotitems', 'useitems', 'materials', 'basic', 'sortie', 'quests'],
    roster: [],
    equip: [
      'ships',
      'decks',
      'slotitems',
      'useitems',
      'materials',
      'airBases',
      'ndocks',
      'sortie',
      'quests',
    ],
    stock: [],
    abyss: ['eventAreas', 'sortie'],
    map: ['ships', 'decks', 'slotitems', 'basic', 'eventAreas', 'sortie', 'mapGauges'],
    item: ['ships', 'slotitems', 'useitems', 'materials', 'basic', 'quests'],
  })
})

test('materials 不重画海域卷，但会重画真正读取库存的道具卷', () => {
  assert.equal(jiBookNeedsRender(['materials'], 'map'), false)
  assert.equal(jiBookNeedsRender(['materials'], 'item'), true)
})

test('任何卷收到外壳依赖 master 都重画', () => {
  for (const book of ['ship', 'roster', 'equip', 'stock', 'abyss', 'map', 'item']) {
    assert.equal(jiBookNeedsRender(['master'], book), true, book)
  }
})

test('仓库与鉴都只在归属签名变化时失效', () => {
  const stock = read('renderer/modules/equip-stock.ts')
  const ji = read('renderer/modules/ji.ts')
  assert.match(stock, /if \(next === rowCacheSignature\) return false/)
  assert.match(
    stock,
    /if \(!invalidateStockRowsIfEquipmentChanged\(\)\) return false\s+refreshStockView\(\)\s+return true/,
  )
  assert.match(
    ji,
    /const stockChanged =[\s\S]*?refreshStockViewIfEquipmentChanged\(\)\s+if \(stockChanged\) invalidateEquippedInstIds\(\)/,
  )
  assert.match(
    ji,
    /if \(!stockChanged && keys\.some\(\(k\) => \['furnitures', 'basic'\]\.includes\(k\)\)\)/,
    'HP-only ships 与家具/basic 同拍时，签名跳过不能吞掉家具直刷',
  )
  assert.doesNotMatch(ji, /invalidateStockRows/)
  assert.match(ji, /jiBookNeedsRender\(keys, activeBook\)/)
})

test('资源趋势窗先过输出闸门再补准星和逐元素监听，被动回程走 trend 键', () => {
  const trend = read('renderer/resource-trend-window.ts')
  const start = trend.indexOf('const render = () => {')
  const end = trend.indexOf('const refresh = async', start)
  assert.ok(start >= 0 && end > start, '找不到趋势窗 render 边界')
  const render = trend.slice(start, end)
  const gate = render.indexOf("if (!commitPaneHtml(root, 'trend', html)) return")
  const pointer = render.indexOf('wireChartPointer()')
  const paint = render.indexOf('paintPointer()')
  const binding = render.indexOf("querySelectorAll<HTMLElement>('[data-range]')")
  assert.ok(gate >= 0 && gate < pointer && pointer < paint && paint < binding)
  assert.match(trend, /if \(passive\) deferPassive\(root, 'trend', render\)\s+else render\(\)/)
  assert.match(trend, /setTimeout\(\(\) => void refresh\(true\), 500\)/)
})

test('任务树用统一视图态，稳定 details 键与 keepView 归零语义都保留', () => {
  const tree = read('renderer/quest-tree-window.ts')
  assert.match(
    tree,
    /data-tree-code="\$\{esc\(node\.entry\.code\)\}" data-keep="\$\{esc\(node\.entry\.code\)\}"/,
  )
  assert.match(tree, /commitPaneHtml\(root, 'quest-tree', html\)/)
  const commitAt = tree.indexOf("commitPaneHtml(root, 'quest-tree', html)")
  const keepAt = tree.indexOf('if (!keepView)', commitAt)
  const zeroAt = tree.indexOf('scroller.scrollTop = 0', keepAt)
  assert.ok(commitAt >= 0 && commitAt < keepAt && keepAt < zeroAt)
  assert.doesNotMatch(tree, /const prevScroll|const prevOpen|const searchFocused|const searchSelection/)
  assert.match(tree, /deferPassive\(root, 'quest-tree', render\)/)
})

test('任务树冒烟探针每次 render 仍会在提交后更新', () => {
  const tree = read('renderer/quest-tree-window.ts')
  const renderStart = tree.indexOf('const render = () => {')
  const renderEnd = tree.indexOf('const selectTask', renderStart)
  const render = tree.slice(renderStart, renderEnd)
  const commitAt = render.indexOf("commitPaneHtml(root, 'quest-tree', html)")
  const treeProbeAt = render.indexOf('document.body.dataset.kansoQuestTree')
  const packProbeAt = render.indexOf('document.body.dataset.kansoQuestPack')
  assert.ok(commitAt >= 0 && commitAt < treeProbeAt && treeProbeAt < packProbeAt)
})

test('镝只给两条异步回程计时，仍不进入推迟名单', () => {
  const di = read('renderer/modules/di.ts')
  assert.match(di, /timedRun\('async:di-battle-history'/)
  assert.match(di, /timedRun\('async:di-first-seen'/)
  assert.doesNotMatch(di, /deferPassive\(/)
})
