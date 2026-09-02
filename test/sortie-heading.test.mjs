// 航行中那枚 ▶ 的朝向：角度算式 + 渲染产物。
//
// 这一族的错法都不报错、源码文本护栏也逮不到：
//   ① y 轴方向弄反——「向下的边」画成向上，角度看着都是合法数字，只是全场镜像了；
//   ② 兜底写反——`return null` 那几支若少一支，缺资料的活动图会拿 NaN 去转，
//      而源码里那行 `if (!from || !to) return null` 照样在。
// 所以①用真 fcd 数据里方向已知的边做金标（正右/正下/正左/斜上各一），
// ②真渲染一遍看产物：有角度必须带 rotate，没角度必须与改动前逐字节相同。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { sortieHeadingDeg } from '../src/shared/sortie-route.ts'
import { renderOutcomeBanner } from './fixtures/render-di-heading.mjs'

// ---- ① 逐分支：合成图 ----

// 一张四方向的合成图。中心 C=(100,100)，四邻各在正方向上 50 像素处。
// 坐标第三位是 fcd 真包里的类型字段，这里原样带着，好证明「只读前两位」。
const CROSS = {
  route: {
    0: [null, 'C'], // 「进入出发点」的伪边：出击第一条边没有起点
    1: ['C', 'E'],
    2: ['C', 'S'],
    3: ['C', 'W'],
    4: ['C', 'N'],
    5: ['C', 'NE'],
    6: ['C', 'ghost'], // 终点在 route 里有名字，spots 里却没有坐标
    7: ['C', 'C'], // 两端重合
  },
  spots: {
    C: [100, 100, 'start'],
    E: [150, 100, ''],
    S: [100, 150, ''],
    W: [50, 100, ''],
    N: [100, 50, ''],
    NE: [150, 50, ''],
  },
}

test('四个正方向：0=右 90=下 180=左 -90=上，与屏幕坐标系同向', () => {
  assert.equal(sortieHeadingDeg(CROSS, 1), 0)
  assert.equal(sortieHeadingDeg(CROSS, 2), 90)
  assert.equal(sortieHeadingDeg(CROSS, 3), 180)
  assert.equal(sortieHeadingDeg(CROSS, 4), -90)
  // 右上 45°：y 朝下，所以「往上」是负角。这一条专治「把 dy 取反」那种改法
  assert.equal(sortieHeadingDeg(CROSS, 5), -45)
})

test('出击第一条边（起点是 null 的伪边）不转', () => {
  assert.equal(sortieHeadingDeg(CROSS, 0), null)
})

test('图不在资料里就不转（部分活动图 fcd 根本没收）', () => {
  assert.equal(sortieHeadingDeg(null, 1), null)
  assert.equal(sortieHeadingDeg(undefined, 1), null)
  assert.equal(sortieHeadingDeg({}, 1), null)
  assert.equal(sortieHeadingDeg({ spots: CROSS.spots }, 1), null)
})

test('边查无此号就不转（新图/改版后边号对不上）', () => {
  assert.equal(sortieHeadingDeg(CROSS, 999), null)
})

test('任一端缺坐标就不转，两端重合也不转', () => {
  assert.equal(sortieHeadingDeg(CROSS, 6), null)
  assert.equal(sortieHeadingDeg(CROSS, 7), null)
  // 坐标位不是数字（资料脏了）同样退回不转，绝不拿 NaN 去转
  const dirty = { route: { 1: ['C', 'X'] }, spots: { C: [0, 0], X: ['80', null] } }
  assert.equal(sortieHeadingDeg(dirty, 1), null)
})

test('边号本身不是数字就不转', () => {
  assert.equal(sortieHeadingDeg(CROSS, null), null)
  assert.equal(sortieHeadingDeg(CROSS, undefined), null)
  assert.equal(sortieHeadingDeg(CROSS, NaN), null)
})

// ---- ② 真数据金标 ----

const packFile = fileURLToPath(new URL('../assets/lodes/poi-fcd-map.json', import.meta.url))
const pack = fs.existsSync(packFile)
  ? JSON.parse(fs.readFileSync(packFile, 'utf8')).data
  : null
const needPack = pack ? false : '缺 assets/lodes/poi-fcd-map.json'

// 每条金标都写清「这条边在图上长什么样」，好让人不跑代码也能复核方向对不对。
const GOLDEN = [
  ['2-4', 11, 'I(633,452)→K(769,452)：同一高度往右，正右', 0],
  ['2-4', 3, 'B(279,343)→C(324,233)：右上，偏上多于偏右', -67.8],
  ['2-4', 1, 'F(473,170)→A(223,140)：一路往左，几乎正左', -173.2],
  ['7-4', 8, 'F(545,367)→H(679,516)：右下，下多于右', 48],
  ['7-4', 23, 'M(911,462)→P(933,331)：几乎正上', -80.5],
  // 2-4 与 7-4 都没有正下的边，正下与正左各从别的常规图取一条
  ['4-5', 10, 'I→J：同一横坐标往下，正下', 90],
  ['1-6', 10, 'L→I：同一高度往左，正左', 180],
]

test('真 fcd 数据：方向已知的七条边逐条对上', { skip: needPack }, () => {
  for (const [code, cell, why, expect] of GOLDEN) {
    const map = pack[code]
    assert.ok(map, `${code} 不在随包海图里，这条金标的锚点要跟着改`)
    assert.equal(sortieHeadingDeg(map, cell), expect, `${code} #${cell} ${why}`)
  }
})

test('真 fcd 数据：金标那几条边的坐标确实指着那个方向', { skip: needPack }, () => {
  // 上一条把角度钉死，这一条独立回答「凭什么说它向下」——直接看两端坐标谁大谁小。
  const sign = (value) => (value > 0 ? 1 : value < 0 ? -1 : 0)
  const expectSign = { 0: [1, 0], 90: [0, 1], 180: [-1, 0], '-80.5': [1, -1], 48: [1, 1], '-67.8': [1, -1], '-173.2': [-1, -1] }
  for (const [code, cell, why, expect] of GOLDEN) {
    const map = pack[code]
    const [from, to] = map.route[cell]
    const dx = map.spots[to][0] - map.spots[from][0]
    const dy = map.spots[to][1] - map.spots[from][1]
    assert.deepEqual([sign(dx), sign(dy)], expectSign[String(expect)], `${code} #${cell} ${why}`)
  }
})

test('真 fcd 数据：每条边的角度都落在坐标差该在的象限', { skip: needPack }, () => {
  // 全量不变式，比金标更难糊弄：只要 y 轴方向被弄反，成百上千条边会一起红。
  let checked = 0
  for (const [code, map] of Object.entries(pack)) {
    for (const [cell, ends] of Object.entries(map?.route ?? {})) {
      const deg = sortieHeadingDeg(map, Number(cell))
      if (deg == null) continue
      const dx = map.spots[ends[1]][0] - map.spots[ends[0]][0]
      const dy = map.spots[ends[1]][1] - map.spots[ends[0]][1]
      const at = `${code} #${cell} ${ends[0]}→${ends[1]}`
      assert.ok(deg >= -180 && deg <= 180, `${at} 角度越界：${deg}`)
      if (dy > 0) assert.ok(deg > 0 && deg < 180, `${at} 往下走的边角度该在 (0,180)，实得 ${deg}`)
      if (dy < 0) assert.ok(deg < 0 && deg > -180, `${at} 往上走的边角度该在 (-180,0)，实得 ${deg}`)
      if (dx > 0) assert.ok(Math.abs(deg) < 90, `${at} 往右走的边角度该在 ±90 内，实得 ${deg}`)
      if (dx < 0) assert.ok(Math.abs(deg) > 90, `${at} 往左走的边角度该在 ±90 外，实得 ${deg}`)
      checked += 1
    }
  }
  assert.ok(checked > 2000, `只核了 ${checked} 条边，随包海图不该这么小`)
})

// ---- ③ 渲染产物 ----

/**
 * 箭头形状的基准，**2026-08-25 重录**：从 ▶ 字符换成有头有尾的内联 SVG。
 *
 * 重录的是**形状**，判据一个字没动——原来那条「没角度必须与改动前逐字节相同」
 * 之所以要跟着改基准，正是因为它钉的是「零痕迹」而不是「零变化」：
 * 真正不许变的是**算不出角度时不许出现 transform / rotate / class="arrow"**，
 * 那几条断言原样留着。三角形字符转到哪个角度看着都一样，这才是换形状的理由。
 */
const ARROW_SVG =
  '<svg class="arrow-svg" viewBox="0 0 16 8" aria-hidden="true" focusable="false">' +
  '<path fill="currentColor" d="M1 3.15 H9 V0.5 L15.4 4 L9 7.5 V4.85 H1 Z"/></svg>'

const sortieAt = (cell, extra = {}) => ({
  active: true,
  practice: false,
  mapArea: 2,
  mapNo: 4,
  bossCell: 0,
  battle: null,
  nodes: [{ cell, eventId: 4, note: '' }],
  ...extra,
})

test('渲染：算得出角度时，箭头带 rotate，文案一个字不变', () => {
  const html = renderOutcomeBanner(sortieAt(2), { '2-4': pack?.['2-4'] ?? CROSS })
  assert.match(html, /<span class="ic"><span class="arrow" style="transform:rotate\(-?\d+(\.\d)?deg\)">/)
  assert.ok(
    html.includes(`">${ARROW_SVG}</span></span>`),
    '转的那一枚不是基准里的形状（换形状要连基准一起重录，并在 commit 里说明）',
  )
  assert.match(html, /前往 B 点/)
  assert.match(html, /class="act">航行中</)
})

test('渲染：箭头有头有尾、长宽比拉得开 —— 转了才看得出指哪边', () => {
  // 这一条钉的是「为什么换形状」：等边三角形（▶）转到哪个角度看着都一样。
  const html = renderOutcomeBanner(sortieAt(2), { '2-4': pack?.['2-4'] ?? CROSS })
  assert.doesNotMatch(html, /▶/, '又退回三角形字符了 —— 转了也读不出朝向')
  const box = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(ARROW_SVG)
  assert.ok(box, '基准里没有 viewBox，量不出长宽比')
  const [w, h] = [Number(box[1]), Number(box[2])]
  assert.ok(w / h >= 1.6, `长宽比只有 ${w / h}，还是看不出头尾`)
  // 形状本身要真的有「杆」和「头」两截：箭头那三点比箭杆宽
  assert.ok(/H9 V0\.5 L/.test(ARROW_SVG), '基准里那一笔不再是「箭杆收进箭头」的走法')
  // 渲染尺寸由样式给（14~16px 长、6~8px 宽那一档），别让它缩成一个点
  const css =
    fs.readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8') +
    fs.readFileSync(new URL('../src/renderer/assets/battle-replay.css', import.meta.url), 'utf8')
  const rule = /\.mod-di \.verdict \.ic \.arrow-svg \{([^}]*)\}/.exec(css)
  assert.ok(rule, '样式里没有箭头的尺寸规则')
  const px = (name) => Number(new RegExp(`${name}:\\s*(\\d+)px`).exec(rule[1])?.[1])
  assert.ok(px('width') >= 14 && px('width') <= 16, `箭头长 ${px('width')}px，跑出 14~16 那一档`)
  assert.ok(px('height') >= 6 && px('height') <= 8, `箭头宽 ${px('height')}px，跑出 6~8 那一档`)
})

test('渲染：正下的边转 90 度、正左的边转 180 度', { skip: needPack }, () => {
  const down = renderOutcomeBanner({ ...sortieAt(10), mapArea: 4, mapNo: 5 }, pack)
  assert.match(down, /style="transform:rotate\(90deg\)"/)
  const left = renderOutcomeBanner({ ...sortieAt(10), mapArea: 1, mapNo: 6 }, pack)
  assert.match(left, /style="transform:rotate\(180deg\)"/)
})

test('渲染：算不出角度时零痕迹——朝右的箭头，一个属性都不多加', () => {
  // 图不在资料里（活动图常态）
  const noMap = renderOutcomeBanner(sortieAt(2), {})
  assert.ok(noMap.includes(`<span class="ic">${ARROW_SVG}</span>`), '缺图时该原样输出朝右箭头')
  assert.doesNotMatch(noMap, /transform|rotate|class="arrow"/)
  // 出击第一条边：起点是 null，同样不装懂
  const firstLeg = renderOutcomeBanner(sortieAt(0), { '2-4': pack?.['2-4'] ?? CROSS })
  assert.ok(firstLeg.includes(`<span class="ic">${ARROW_SVG}</span>`))
  assert.doesNotMatch(firstLeg, /transform|rotate/)
  // 边查无此号
  const unknown = renderOutcomeBanner(sortieAt(9999), { '2-4': pack?.['2-4'] ?? CROSS })
  assert.doesNotMatch(unknown, /transform|rotate/)
})

test('渲染：演习没有海图，那条横幅照旧不带箭头', () => {
  const practice = renderOutcomeBanner(
    {
      ...sortieAt(2),
      practice: true,
      mapArea: 0,
      mapNo: 0,
      nodes: [],
      practiceOpponent: { name: '对手', rank: '中将', level: 90, deckName: '第一舰队', ships: [] },
    },
    pack ?? {},
  )
  assert.match(practice, /<span class="ic">演<\/span>/)
  assert.doesNotMatch(practice, /transform|rotate|class="arrow"/)
})
