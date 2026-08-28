// 节点图 → 敌编成小节的跳转（2026-08-27 用户提议）。
//
// 守三件事，前两件都编**真的渲染代码**跑真逻辑（护栏别只断言源码文本）：
//   ① 落点判据：哪些点位算「有敌编成可跳」。判宽了的表现是资源点也长出手势、
//      点下去滚到空处；判窄了是明明有一节却点不动。两样都不报错。
//   ② 两端的标记与锚：图上那个 <g> 与下面那一行，属性名和点位名必须对得上，
//      而且要跟 enemyCompRowSelector 找的是同一个东西——一边改名另一边还在找旧名，
//      同样不报错，只是「点了没反应」。
//   ③ 缺包时那张临时点位图**一个格子都不可点**：它的格子是罗盘边号不是点位字母，
//      硬按边号去找小节会找错行，而找错行比不能点更糟。
//   ④ 目标那一节折着的时候，**滚之前先真展开**：折起来的段是 display:none，
//      没有盒子的东西滚不动也闪不了，整次点击静默空转（2026-08-28 实报的
//      「点了没反应」）。这一组同样跑真代码——顺序问题，看源码文本看不出来。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { transformSync } from 'esbuild'

import jump from '../dist/shared/map-node-jump.js'
import { buildDrawer, loadHarness as loadRevealHarness } from './fixtures/section-reveal-dom.mjs'

const { ENEMY_COMP_ANCHOR_ATTR, MAP_NODE_JUMP_ATTR, enemyCompNodes, enemyCompRowSelector } = jump

const jiSource = fs
  .readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n')

const sliceBetween = (from, to, label) => {
  const start = jiSource.indexOf(from)
  const end = jiSource.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `ji.ts 里找不到「${label}」，这条守卫的锚点要跟着改`)
  return jiSource.slice(start, end)
}

// ---- 把两处真模板切出来，补最小桩之后真跑 ----

const NODE_BLOCK = sliceBetween(
  '  const nodes = Object.entries(spots)',
  '\n  return `<div class="sec"><div class="sec-h">节点图',
  '节点图的点位模板',
)
const ROW_BLOCK = sliceBetween(
  '      // 锚：节点图上点了这个点位就落到这一行',
  '\n    })',
  '敌编成小节的行模板',
)

const HARNESS = `
declare const globalThis: any
// 常数取**真的那两个**（globalThis 注入，免得这里再抄一份名字——抄一份就守不住改名了）
const MAP_NODE_JUMP_ATTR: string = globalThis.__kansoJump.MAP_NODE_JUMP_ATTR
const ENEMY_COMP_ANCHOR_ATTR: string = globalThis.__kansoJump.ENEMY_COMP_ANCHOR_ATTR
// 与本次要守的行为无关，补最小桩（转义用真口径：属性值里的引号必须被吃掉）
const esc = (s: unknown) => \`\${s ?? ''}\`.replace(/[&<>"']/g, (c) => \`&#\${c.charCodeAt(0)};\`)

export const buildNodes = (
  spots: any, battlesAt: any, bossLetters: any, jumpNodes: any, S: number, R: number, FS: number,
) => {
${NODE_BLOCK}
  return nodes
}

export const buildRow = (node: string, comps: string) => {
${ROW_BLOCK}
}
`

const loadHarness = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-map-jump-'))
  const file = path.join(dir, 'harness.cjs')
  fs.writeFileSync(file, transformSync(HARNESS, { loader: 'ts', format: 'cjs' }).code)
  globalThis.__kansoJump = { MAP_NODE_JUMP_ATTR, ENEMY_COMP_ANCHOR_ATTR }
  return createRequire(fileURLToPath(import.meta.url))(file)
}

const harness = loadHarness()

/** 按点位字母拆开画出来的 <g>：标签文字就是点位名 */
const groupsByLetter = (svg) =>
  new Map(
    svg
      .split('<g ')
      .slice(1)
      .map((group) => [/>([^<]*)<\/text>/.exec(group)?.[1], group]),
  )

// ---- ① 落点判据 ----

const withComps = { enemyComps: [{ formation: 1 }] }

test('有敌编成的点位才是落点：只记了掉落的点位、空条目都不是', () => {
  const nodes = enemyCompNodes({
    // 途中点：目录里有它，但只有掉落没有编成——下面根本不长小节
    A: { enemyComps: [], ships: [{ id: 470 }] },
    B: withComps,
    // 资源点 / 气旋：条目在，字段都没有
    C: {},
    D: { ships: [] },
    Z1: { enemyComps: [{}, {}] },
  })
  assert.deepEqual(nodes, ['B', 'Z1'])
})

test('还没收录这张图就是空数组，不是抛错——新图上整段跳转只是不生效', () => {
  assert.deepEqual(enemyCompNodes(null), [])
  assert.deepEqual(enemyCompNodes(undefined), [])
  assert.deepEqual(enemyCompNodes({}), [])
})

test('点位按名字排序：图上圈的顺序与下面小节的顺序读起来是同一条线', () => {
  assert.deepEqual(enemyCompNodes({ Z: withComps, A: withComps, M: withComps }), ['A', 'M', 'Z'])
})

// ---- ② 两端的标记与锚 ----

test('可跳的点位带标记与手势类，没落点的点位两样都不带', () => {
  const svg = harness.buildNodes(
    { A: [10, 20, 'start'], B: [30, 40, ''], C: [50, 60, ''] },
    new Map([['B', 3]]),
    new Set(['C']),
    new Set(['B', 'C']), // A 是出击起点，下面没有它的敌编成
    1,
    12,
    11,
  )
  const groups = groupsByLetter(svg)
  assert.deepEqual([...groups.keys()], ['A', 'B', 'C'])
  for (const letter of ['B', 'C']) {
    assert.match(groups.get(letter), /class="[^"]*\bmg-jump\b/, `${letter} 点该带手势类`)
    assert.ok(
      groups.get(letter).includes(`${MAP_NODE_JUMP_ATTR}="${letter}"`),
      `${letter} 点该带可跳标记`,
    )
  }
  // 没落点的那个：连手势都不给。做出可点的样子却点下去什么都不发生，比不可点更糟
  assert.doesNotMatch(groups.get('A'), /\bmg-jump\b/)
  assert.ok(!groups.get('A').includes(MAP_NODE_JUMP_ATTR))
  // 圈和字一个像素都没动（视觉除手势外不变）
  assert.ok(groups.get('A').includes('<circle cx="10" cy="20"'))
  assert.match(groups.get('A'), /class="mg-n start"/)
})

test('小节的锚就是点击时要找的那一个：属性名与点位名两端对得上', () => {
  const row = harness.buildRow('Z1', '<div class="rt-r">编成</div>')
  // enemyCompRowSelector 拼出来的 `[属性="Z1"]`，去掉方括号就该原样出现在这一行上
  const wanted = enemyCompRowSelector('Z1').slice(1, -1)
  assert.ok(row.includes(wanted), `锚与选择器对不上：行是 ${row}`)
  assert.match(row, /^<div class="rt-row" /)
  // 点位名照旧摆在左栏，锚不顶替可见文案
  assert.ok(row.includes('<span class="rt-from">Z1</span>'))

  // 图上那一端用的是同一个点位名
  const svg = harness.buildNodes({ Z1: [1, 2, ''] }, new Map(), new Set(), new Set(['Z1']), 1, 12, 11)
  assert.ok(svg.includes(`${MAP_NODE_JUMP_ATTR}="Z1"`))
})

test('点位名里的引号不会把选择器拼断——拼断是一次崩溃，不是一次跳不动', () => {
  assert.equal(enemyCompRowSelector('A'), `[${ENEMY_COMP_ANCHOR_ATTR}="A"]`)
  assert.equal(enemyCompRowSelector('A"B'), `[${ENEMY_COMP_ANCHOR_ATTR}="A\\"B"]`)
  assert.equal(enemyCompRowSelector('A\\B'), `[${ENEMY_COMP_ANCHOR_ATTR}="A\\\\B"]`)
})

// ---- ③ 临时点位图 / 接线纪律 ----

test('缺包时的临时点位图一个格子都不发可跳标记', () => {
  // 它的格子是罗盘边号（见 shared/local-map-topology），不是敌编成那套点位字母。
  // 走到这条路的前提又是四个包都没这张图，那时下面本来也没有敌编成可跳。
  // 只看真代码：那一段的注释里正解释着「为什么不发这个标记」，连注释一起搜必然自摆乌龙
  const localGraph = sliceBetween(
    'const localMapGraphHtml = ',
    '// ---- 节点图（04 稿）----',
    '临时点位图',
  )
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
  assert.ok(!localGraph.includes(MAP_NODE_JUMP_ATTR), '临时点位图不该按边号去认点位字母')
  assert.ok(!localGraph.includes('mg-jump'))
})

test('一张图一个委托，不逐节点挂监听', () => {
  // 点位数随图走（活动图三十多个），而 wire 每次换 DOM 都重跑一遍。
  // 这一条只能守源码：监听器挂了几个，渲染结果里看不出来。
  assert.match(jiSource, /pane\.querySelectorAll<SVGSVGElement>\('\.mapgraph'\)\.forEach/)
  assert.ok(
    !jiSource.includes(`querySelectorAll<SVGGElement>('[${MAP_NODE_JUMP_ATTR}]')`),
    '别逐节点 addEventListener',
  )
  // 判据两端共用一个出口：图与小节都读 enemyCompNodes
  assert.equal((jiSource.match(/enemyCompNodes\(/g) ?? []).length, 2)
})

test('可跳的点位只多一个手势，别的视觉不变', () => {
  const css = fs
    .readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n')
  assert.match(css, /\.mod-ji \.mg-n\.mg-jump \{ cursor: pointer; \}/)
  // 落地高亮借既有脉冲与 --accent，不新增颜色
  assert.match(css, /\.mod-ji \.rt-row\.focus \{\n\s+animation: header-status-pulse /)
  // 减少动态效果那一档要把它一起关掉（与战斗行同列）
  assert.match(css, /\.mod-di \.brow\.focus,\n\s+\.mod-ji \.rt-row\.focus,/)
})

// ---- ④ 折起来的那一节：先展开再滚（2026-08-28 用户报「点了没反应」的真身）----
//
// 「敌编成」不在 ALWAYS_OPEN 里，打开抽屉时是折起来的，而折起来的段是 display:none。
// 于是从前这一路是：委托挂着、选择器也找得到那一行，只是那一行没有盒子——
// scrollIntoView 一寸不滚、脉冲一个像素不闪、rect 全是 0，整次点击静默空转，
// 一行日志都不留（隔离实例上 1-1 与 62-5 各复现一次坐实）。
//
// 这几条都编**真的 revealSection 与真的点击处理体**跑：「滚之前有没有先展开」
// 是顺序问题，源码正则写反了照样绿。

const revealHarness = loadRevealHarness({ MAP_NODE_JUMP_ATTR, enemyCompRowSelector })

const clickNode = (fixture) => {
  revealHarness.registerBooks(fixture.pane, fixture.books)
  revealHarness.makeJumpHandler(fixture.pane)({ target: fixture.circle })
}

test('折起来的那一节：display:none 是真的没有盒子，这就是「点了没反应」的物理原因', () => {
  const css = fs
    .readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n')
  // 这条 CSS 是本条守卫的前提：它若改了，下面几条的意义要重新想
  assert.match(css, /\[data-foldable\]:not\(\[data-open\]\) > \*:not\(\[data-fold-head\]\) \{ display: none; \}/)
  const { row, sec } = buildDrawer()
  assert.equal(sec.hasAttribute('data-open'), false)
  assert.equal(row.visible, false)
})

test('点一个点位：滚的**那一刻**目标必须已经有盒子了，不能滚完再展开', () => {
  const fixture = buildDrawer({ node: 'Z' })
  clickNode(fixture)

  assert.equal(fixture.row.scrollCalls.length, 1, 'scrollIntoView 该恰好被调一次')
  // 顺序判据：终态是「开着 + 滚过」，中间顺序反了也是这个终态，所以只能问滚的那一刻
  assert.equal(
    fixture.row.scrollCalls[0].visibleAtCall,
    true,
    '滚的时候这一节还折着——那次滚动一寸也不会走，脉冲也不会闪',
  )
  assert.deepEqual(fixture.row.scrollCalls[0].options, { behavior: 'smooth', block: 'start' })
  assert.equal(fixture.sec.hasAttribute('data-open'), true)
  // 落地脉冲照旧挂上（rAF 在夹具里是同步跑的）
  assert.ok(fixture.row.classList.contains('focus'))
})

test('展开要记进折叠账本，光改属性不算——下一次被动重渲会照着账本把它折回去', () => {
  const fixture = buildDrawer({ node: 'Z' })
  clickNode(fixture)
  assert.ok(
    fixture.books.opened.has('敌编成'),
    '只 setAttribute 的话，脉冲还没闪完就被 apply() 折回去了（图鉴是被动重渲的重灾区）',
  )
  assert.equal(fixture.books.closed.size, 0, '常规段记的是「开着的」那本账')
})

test('本来就开着的那一节：不重复记账，照样滚照样闪', () => {
  const fixture = buildDrawer({ node: 'M', open: true })
  clickNode(fixture)
  assert.equal(fixture.row.scrollCalls.length, 1)
  assert.equal(fixture.row.scrollCalls[0].visibleAtCall, true)
  assert.equal(fixture.books.opened.size, 0, '没折着就不用改账')
  assert.ok(fixture.row.classList.contains('focus'))
})

test('没装过折叠的树上 revealSection 是安静的 false，不是抛错', () => {
  // 走到这里的是「这棵树根本没登记折叠」——跳转不该因此变成一次崩溃
  const fixture = buildDrawer({ node: 'Z' })
  assert.equal(revealHarness.revealSection(fixture.row), false)
  assert.equal(revealHarness.revealSection(null), false)
  assert.equal(revealHarness.revealSection(undefined), false)
})

test('点在没有可跳标记的地方：不展开、不滚、什么都不做', () => {
  // 资源点、气旋、图上的空白都走这一支——不该顺手把「敌编成」掀开
  const fixture = buildDrawer({ node: 'Z' })
  revealHarness.registerBooks(fixture.pane, fixture.books)
  revealHarness.makeJumpHandler(fixture.pane)({ target: fixture.pane })
  assert.equal(fixture.row.scrollCalls.length, 0)
  assert.equal(fixture.sec.hasAttribute('data-open'), false)
  assert.equal(fixture.books.opened.size, 0)
})
