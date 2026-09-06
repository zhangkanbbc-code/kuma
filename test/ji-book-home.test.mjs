import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import ts from 'typescript'

const jiSource = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
const declarationStart = jiSource.indexOf('export const bookHomeState =')
const declarationEnd = jiSource.indexOf('\n\nconst BOOKS', declarationStart)
assert.notEqual(declarationStart, -1, '找不到 bookHomeState')
assert.notEqual(declarationEnd, -1, '找不到 bookHomeState 的声明边界')

const declaration = ts.transpileModule(
  jiSource.slice(declarationStart, declarationEnd).replace('export const', 'const'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText
const bookHomeState = new Function(`${declaration}\nreturn bookHomeState`)()
const bookTabsHandler = jiSource.slice(
  jiSource.indexOf("pane.querySelector('.book-tabs')"),
  jiSource.indexOf("pane.querySelector<HTMLElement>('[data-act=\"miss-close\"]')"),
)

const states = () => ({
  ship: {
    open: true,
    memorialOpen: 77,
    selectedRoot: 123,
    selectedForm: 124,
    npcName: '明石',
    search: '雪',
    chip: '驱逐',
  },
  equip: {
    open: true,
    mode: 'lab',
    selected: 501,
    search: '炮',
    chip: '主炮',
    typeFilter: 1,
  },
  abyss: {
    open: true,
    tab: 'equip',
    selected: 1501,
    search: '深海',
    equipChip: '主炮',
  },
  map: {
    open: true,
    selected: 62,
    difficulty: '甲',
    personalNode: 'A',
  },
  item: {
    open: true,
    selected: 10,
    search: '家具',
    cat: 'furniture',
  },
})

test('舰娘卷回首页：关抽屉与纪念册，保留选中舰、NPC 位和筛选', () => {
  const before = states()
  const result = bookHomeState('ship', before)

  assert.equal(result.wasHome, false)
  assert.deepEqual(result.patch.ship, {
    ...before.ship,
    open: false,
    memorialOpen: 0,
  })
  assert.equal(result.patch.ship.selectedRoot, 123)
  assert.equal(result.patch.ship.selectedForm, 124)
  assert.equal(result.patch.ship.npcName, '明石')
  assert.equal(before.ship.open, true, '纯函数改写了输入状态')
  assert.equal(
    bookHomeState('ship', { ...before, ship: { ...before.ship, open: false } }).wasHome,
    true,
  )
  assert.match(bookTabsHandler, /if \(tab\.dataset\.book === activeBook\)[\s\S]*bookHomeState\(activeBook,/)
  assert.doesNotMatch(bookTabsHandler, /jiNav\.record/)
  assert.equal([...bookTabsHandler.matchAll(/\brender\(\)/g)].length, 1)
  assert.match(
    jiSource,
    /\$\{active \? ' title="再点一次回到本卷首页"' : ''\}/,
    '选中卷页缺少再次点击提示，或提示被加到了未选中卷页',
  )
})

test('装备卷回首页：关抽屉并从实验室回目录，保留筛选', () => {
  const before = states()
  const result = bookHomeState('equip', before)

  assert.equal(result.wasHome, false)
  assert.deepEqual(result.patch.equip, {
    ...before.equip,
    open: false,
    mode: 'catalog',
  })
  assert.equal(result.patch.equip.search, '炮')
  assert.equal(before.equip.mode, 'lab', '纯函数改写了输入状态')
  assert.equal(
    bookHomeState('equip', {
      ...before,
      equip: { ...before.equip, open: false, mode: 'catalog' },
    }).wasHome,
    true,
  )
  assert.equal(
    bookHomeState('equip', {
      ...before,
      equip: { ...before.equip, open: false, mode: 'today' },
    }).patch.equip.mode,
    'catalog',
  )
})

test('深海卷回首页：关抽屉，保留舰/装备页签与筛选', () => {
  const before = states()
  const result = bookHomeState('abyss', before)

  assert.equal(result.wasHome, false)
  assert.deepEqual(result.patch.abyss, {
    ...before.abyss,
    open: false,
  })
  assert.equal(result.patch.abyss.tab, 'equip')
  assert.equal(before.abyss.open, true, '纯函数改写了输入状态')
  assert.equal(
    bookHomeState('abyss', { ...before, abyss: { ...before.abyss, open: false } }).wasHome,
    true,
  )
})

test('海域卷回首页：关抽屉，保留已选海域与难度', () => {
  const before = states()
  const result = bookHomeState('map', before)

  assert.equal(result.wasHome, false)
  assert.deepEqual(result.patch.map, {
    ...before.map,
    open: false,
  })
  assert.equal(result.patch.map.difficulty, '甲')
  assert.equal(before.map.open, true, '纯函数改写了输入状态')
  assert.equal(
    bookHomeState('map', { ...before, map: { ...before.map, open: false } }).wasHome,
    true,
  )
})

test('道具卷回首页：关抽屉，保留搜索与分类', () => {
  const before = states()
  const result = bookHomeState('item', before)

  assert.equal(result.wasHome, false)
  assert.deepEqual(result.patch.item, {
    ...before.item,
    open: false,
  })
  assert.equal(result.patch.item.search, '家具')
  assert.equal(before.item.open, true, '纯函数改写了输入状态')
  assert.equal(
    bookHomeState('item', { ...before, item: { ...before.item, open: false } }).wasHome,
    true,
  )
})

test('列表卷回首页：不产生状态写回，只要求滚顶', () => {
  const result = bookHomeState('roster', states())

  assert.equal(result.wasHome, true)
  assert.deepEqual(result.patch, {})
  assert.match(jiSource, /roster: '\.roster-book \.twrap, \.roster-book \.qa-app'/)
})

test('仓库卷回首页：不产生状态写回，只要求滚顶', () => {
  const result = bookHomeState('stock', states())

  assert.equal(result.wasHome, true)
  assert.deepEqual(result.patch, {})
  assert.match(jiSource, /stock: '\.stock-book \.es-table-wrap, \.stock-book \.es-furniture'/)
})
