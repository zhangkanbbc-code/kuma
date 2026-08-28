// 海图包的空壳条目不许被当成「有拓扑」（2026-08-25）。
//
// 上游 poi 的 fcd/map.json 会给还没人补坐标的新图先落一个空壳
// （`{ spots: {}, route: {} }`）。空对象是真值，于是四处消费点的 `fcd?.spots`
// 一律放行，空壳一路走到画图那一步：`Math.min(...[])` 是 Infinity，
// viewBox 拼成 "Infinity NaN"。
//
// 判据抽进了 shared/fcd-topology.ts，所以这份护栏**能真跑**：先钉判据本身，
// 再钉「那条会炸的算式确实会炸」（说明闸门守的是什么），最后钉五个消费点
// 都改用了同一条判据、没有谁还留着旧的真值判断。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import fcdTopology from '../dist/shared/fcd-topology.js'

const { fcdTopologyUsable } = fcdTopology
const di = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
const ji = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')

const FULL = {
  spots: { A: [10, 20, 'start'], B: [30, 40, ''] },
  route: { 1: [null, 'A'], 2: ['A', 'B'] },
}

test('空壳判成不可用——这是整条修复的支点', () => {
  assert.equal(fcdTopologyUsable({ spots: {}, route: {} }), false, '两格都空还说能画')
  assert.equal(fcdTopologyUsable({ spots: {}, route: { 1: [null, 'A'] } }), false, '只有边没有坐标，不知道画在哪')
  assert.equal(fcdTopologyUsable({ spots: { A: [1, 2, ''] }, route: {} }), false, '只有点没有边，连不起来')
})

test('正常条目照常放行，缺条目/坏形状一律拦下', () => {
  assert.equal(fcdTopologyUsable(FULL), true, '正常的一条被拦了——那会把好图一起弄没')
  assert.equal(fcdTopologyUsable(null), false)
  assert.equal(fcdTopologyUsable(undefined), false)
  assert.equal(fcdTopologyUsable({}), false)
  assert.equal(fcdTopologyUsable({ spots: null, route: null }), false)
})

test('闸门守的是什么：空 spots 会让 viewBox 变成一串非有限数', () => {
  // 把 seaCardHtml 里那段算式原样搬过来，对着空壳跑一遍。这一条不是在测我们的
  // 代码，是把「为什么必须拦」钉成可执行的事实——以后谁想把判据放宽回真值判断，
  // 先看这里会得到什么。
  //
  // 实算的结果是 `viewBox="Infinity Infinity -Infinity -Infinity"`
  //（`Math.min(...[])` 是 Infinity，`Math.max(...[])` 是 -Infinity，
  // 相减得 -Infinity 而不是 NaN）。四个数没有一个是有限的，SVG 画不出来。
  const empty = {}
  const xs = Object.values(empty).map((p) => p[0])
  const ys = Object.values(empty).map((p) => p[1])
  const minX = Math.min(...xs) - 40
  const minY = Math.min(...ys) - 40
  const w = Math.max(...xs) - minX + 80
  const h = Math.max(...ys) - minY + 80
  assert.equal(`${minX} ${minY} ${w} ${h}`, 'Infinity Infinity -Infinity -Infinity')
  for (const n of [minX, minY, w, h]) assert.ok(!Number.isFinite(n))
  // 而正常条目算出来四个数全是有限的
  const okXs = Object.values(FULL.spots).map((p) => p[0])
  const okYs = Object.values(FULL.spots).map((p) => p[1])
  const okMinX = Math.min(...okXs) - 40
  const okMinY = Math.min(...okYs) - 40
  for (const n of [okMinX, okMinY, Math.max(...okXs) - okMinX + 80, Math.max(...okYs) - okMinY + 80]) {
    assert.ok(Number.isFinite(n), '正常条目也算出了非有限数')
  }
})

// ---- 五个消费点都改用同一条判据 ----

test('镝的两处（海图卡 + 航迹条的海图钮）都走 fcdTopologyUsable', () => {
  assert.ok(
    di.includes("import { fcdTopologyUsable } from '../../shared/fcd-topology'"),
    'di 没引判据',
  )
  assert.ok(di.includes('if (fcdTopologyUsable(fcd)) {'), '海图卡还在用旧判断')
  assert.ok(
    di.includes('fcdTopologyUsable(fcdMap?.data?.[mapKeyOf(s)])'),
    '航迹条的「海图」钮还在用旧判断——空壳会挂出一个点开是空白的钮',
  )
  // 旧写法一处都不许剩
  assert.ok(!di.includes('if (fcd?.spots) {'), 'seaCardHtml 的旧真值判断又回来了')
  assert.ok(
    !di.includes('Boolean(fcdMap?.data?.[mapKeyOf(s)]?.spots)'),
    'hasSea 的旧真值判断又回来了',
  )
})

test('鉴的三处（节点图 / 迷你图 / 让位判据）都走 fcdTopologyUsable', () => {
  assert.ok(
    ji.includes("import { fcdTopologyUsable } from '../../shared/fcd-topology'"),
    'ji 没引判据',
  )
  assert.ok(ji.includes('if (!fcdTopologyUsable(fcd)) {'), 'mapGraphHtml 还在用旧判断')
  assert.ok(ji.includes('if (!fcdTopologyUsable(fcd)) return null'), 'miniMapSvg 还在用旧判断')
  assert.ok(
    ji.includes('fcdTopology: fcdTopologyUsable(fcdMapLode?.data?.[code])'),
    '「四包皆无才让位」把空壳读成了「官方已收录」——新图上连本机点位图也不出',
  )
  assert.ok(!/if \(!fcd\?\.spots \|\| !fcd\?\.route\)/.test(ji), '旧的真值判断又回来了')
  assert.ok(
    !ji.includes('fcdTopology: Boolean(fcdMapLode?.data?.[code])'),
    '让位判据的旧真值判断又回来了',
  )
})

test('空壳走的是新图那条兜底路径，挂牌与带路三段都还在', () => {
  // mapGraphHtml 的早退分支必须带 localMapGraphHtml + routingHtml 一起走
  // （self-expansion.test.mjs 钉过 routingHtml 那一半，这里钉「空壳也走这条路」）
  const start = ji.indexOf('if (!fcdTopologyUsable(fcd)) {')
  assert.notEqual(start, -1)
  const branch = ji.slice(start, ji.indexOf('\n  }', start))
  assert.ok(branch.includes('localMapGraphHtml(info, code, credit)'), '空壳没走本地兜底图')
  assert.ok(branch.includes('routingHtml(code)'), '空壳把带路三段一起吞掉了')
})

// ---- 上游闸：本机那份包里不许有空壳 ----

test('本机的 poi-fcd-map 包里没有空壳条目', (t) => {
  const file = new URL('../assets/lodes/poi-fcd-map.json', import.meta.url)
  if (!fs.existsSync(file)) {
    // 矿脉包不入仓（gitignore），没有就跳过——这条是给维护者刷新包时用的闸门
    t.skip('本机没有 poi-fcd-map 包')
    return
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  const maps = raw.data ?? raw
  const shells = Object.entries(maps)
    .filter(([, entry]) => !fcdTopologyUsable(entry))
    .map(([code]) => code)
  // 空壳本身是上游合法的占位，不是坏包——所以这条闸门放在这里（维护者刷新包时
  // 会红），**不放进 lode-validation**：那边校验不过是整包丢弃，会在新活动开幕
  // 当天把全部海图的点位字母、小地图、航迹一起弄没，比一张坏图严重得多。
  assert.deepEqual(
    shells,
    [],
    `上游给这些图落了空壳：${shells.join(' , ')}。渲染侧已经会走兜底路径，` +
      `这条只是提醒维护者：等上游补了坐标再刷一次包`,
  )
})
