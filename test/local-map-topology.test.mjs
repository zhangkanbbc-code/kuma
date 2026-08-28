// 缺包时的本机实测点位图（自扩展体检待裁 1，2026-08-23 用户拍板选项 C）。
//
// 判据全在纯函数里，这里真跑：给一份合成的遭遇志 + 航迹，看长出来的是什么。
// 钉的是三条边界——只画走过的、不猜字母、推不出边就不连线——
// 外加「四包皆无才出，任何一个包到位就整块让位」。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { buildSync } from 'esbuild'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-local-map-topology-'))
const output = path.join(tempDir, 'local-map-topology.cjs')
buildSync({
  entryPoints: [fileURLToPath(new URL('../src/shared/local-map-topology.ts', import.meta.url))],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'silent',
})
const require = createRequire(import.meta.url)
const { localMapTopology, officialMapMaterialAbsent } = require(output)

test.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

test('让位判据：四个包都没有这张图才出，任何一个到位就整块让位', () => {
  const none = { fcdTopology: false, routing: false, drops: false, enemyComps: false }
  assert.equal(officialMapMaterialAbsent(none), true)
  // 逐个包单独到位，都要让位——这一层不与任何官方资料并存
  for (const key of ['fcdTopology', 'routing', 'drops', 'enemyComps']) {
    assert.equal(
      officialMapMaterialAbsent({ ...none, [key]: true }),
      false,
      `${key} 到位之后本机视图还赖着不走`,
    )
  }
})

test('从遭遇志 + 航迹长出点位与连线，点位是边号不是猜出来的字母', () => {
  // 合成：出击起点 → #3（打过 2 战）→ #12（Boss，打过 5 战）
  const chronicle = {
    cells: [
      { cell: 3, count: 2 },
      { cell: 12, count: 5 },
    ],
    bossCells: [12],
  }
  const branches = {
    '-1': { 3: 7 },
    3: { 12: 5 },
  }
  const topo = localMapTopology(chronicle, branches)

  assert.equal(topo.linksUnavailable, false)
  assert.deepEqual(
    topo.nodes.map((node) => [node.cell, node.battles, node.boss, node.start, node.depth]),
    [
      [3, 2, false, true, 0],
      [12, 5, true, false, 1],
    ],
  )
  // 出击起点（-1）不是一个点位，别画一条从虚空来的线
  assert.deepEqual(topo.links, [{ from: 3, to: 12, count: 5 }])
  assert.deepEqual(topo.layers, [[3], [12]])
  // 一个字母都没有：字母是 fcd 那份资料的东西，这一层不猜。
  // 只看**值**（字段名当然有字母），点位身份必须全是数字边号
  const values = topo.nodes.flatMap((node) => Object.values(node)).concat(
    topo.links.flatMap((link) => Object.values(link)),
    topo.layers.flat(),
  )
  for (const value of values) {
    assert.equal(typeof value === 'number' || typeof value === 'boolean', true, `${value} 不是边号`)
  }
})

test('只画走过的边：没走过的一条都不补，也不为「像张图」硬连', () => {
  const topo = localMapTopology(
    { cells: [{ cell: 3, count: 1 }], bossCells: [] },
    { '-1': { 3: 1 }, 3: { 7: 2, 9: 1 } },
  )
  // 走过的两条分歧都在，且各带自己的次数
  assert.deepEqual(topo.links, [
    { from: 3, to: 7, count: 2 },
    { from: 3, to: 9, count: 1 },
  ])
  // 7 与 9 之间从没走过——绝不能凭「它们都在下一层」连起来
  assert.equal(
    topo.links.some((link) => (link.from === 7 && link.to === 9) || (link.from === 9 && link.to === 7)),
    false,
  )
  // 走过但没打过仗的点照样有格子（battles=0 不等于不存在）
  assert.deepEqual(
    topo.nodes.filter((node) => node.battles === 0).map((node) => node.cell),
    [7, 9],
  )
})

test('推不出边就只列点位，不硬造拓扑', () => {
  const chronicle = { cells: [{ cell: 3, count: 2 }, { cell: 12, count: 5 }], bossCells: [12] }
  for (const branches of [null, undefined, {}, { '-1': { 3: 4 } }]) {
    const topo = localMapTopology(chronicle, branches)
    assert.equal(topo.linksUnavailable, true, '没有点到点的一手观测时不许说自己有边')
    assert.deepEqual(topo.links, [])
    // 点位照旧长得出来——存在层不受知识层拖累
    assert.deepEqual(topo.nodes.map((node) => node.cell), [3, 12])
  }
})

test('遭遇志空的就是空的：不摆一张凭空的图', () => {
  assert.deepEqual(localMapTopology(null, null).nodes, [])
  assert.deepEqual(localMapTopology({ cells: [], bossCells: [] }, {}).nodes, [])
  // 次数为 0 / 边号非法的行整条跳过，不落进 0 号点位
  const topo = localMapTopology({ cells: [{ cell: 0, count: 3 }], bossCells: [0] }, { 0: { 5: 0 } })
  assert.deepEqual(topo.nodes, [])
})

test('航迹串不起来的点位排在最后一层，不藏起来', () => {
  // 老样本：只记了战斗、没记航迹的那几个点（#20），与串得起来的一段并存
  const topo = localMapTopology(
    { cells: [{ cell: 3, count: 1 }, { cell: 20, count: 4 }], bossCells: [] },
    { '-1': { 3: 1 }, 3: { 12: 1 } },
  )
  assert.equal(topo.nodes.find((node) => node.cell === 20).depth, -1)
  assert.deepEqual(topo.layers, [[3], [12], [20]])
  assert.equal(
    topo.nodes.some((node) => node.cell === 20),
    true,
    '连不上起点的点位被藏起来了——那是把事实藏起来',
  )
})

test('起点缺失（老账本没记航迹起点）时照样排得出层', () => {
  const topo = localMapTopology({ cells: [], bossCells: [] }, { 3: { 12: 2 }, 12: { 15: 1 } })
  // 一个 start 都没有，全体连不上起点 → 全归最后一层，但边照画
  assert.deepEqual(topo.nodes.map((node) => node.start), [false, false, false])
  assert.deepEqual(topo.links, [
    { from: 3, to: 12, count: 2 },
    { from: 12, to: 15, count: 1 },
  ])
  assert.deepEqual(topo.layers, [[3, 12, 15]])
})

test('渲染路径：缺包段挂着让位判据，且带路三段照旧跟着出', () => {
  const ji = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  // ① 早退分支仍旧带 routingHtml（16ae871 修的那条盲区不许回潮）
  const start = ji.indexOf('const mapGraphHtml = (info: any): string => {')
  assert.ok(start > 0)
  const body = ji.slice(start, ji.indexOf('\n}\n', start))
  assert.equal(
    (body.match(/routingHtml\(code\)/g) ?? []).length,
    2,
    'mapGraphHtml 的两条 return 各要带一次 routingHtml(code)',
  )
  // ② 本机实测段的出场判据是那个纯函数，四个包逐个喂进去——不许在渲染层另写一套
  const local = ji.slice(
    ji.indexOf('const localMapGraphHtml = '),
    ji.indexOf('// ---- 节点图（04 稿）----'),
  )
  assert.ok(local.length > 0, '找不到本机实测段')
  assert.match(local, /officialMapMaterialAbsent\(\{/)
  for (const key of ['fcdTopology:', 'routing:', 'drops:', 'enemyComps:']) {
    assert.match(local, new RegExp(key.replace(':', ':')), `让位判据少喂了 ${key}`)
  }
  assert.match(local, /if \(!officialAbsent \|\| mapId <= 0\) return/)
  // ③ 挂牌措辞：说清这张图画的是什么；不写抱怨也不造紧迫感。
  // 「官方资料到位前的…会让位给官方资料」是解释实现，按 2026-08-26 文案清扫裁定
  //（族 7）删；缩成「只画你自己走过的边」。「会让位」这条真行为不靠措辞守——
  // 它的判据就是上面那个 officialAbsent 闸门（本测已钉），删了措辞照旧红。
  assert.match(local, /只画你自己走过的边/)
  assert.equal(/请更新|尽快|赶紧|遗憾|可惜/.test(local), false, '挂牌写了抱怨或催促')
  // ④ 拓扑一律由纯函数给，渲染层不自己算边
  assert.match(local, /const topo = localMapTopology\(chronicle, branches\)/)
  assert.equal(/\.edges\b/.test(local), false, '渲染层自己去翻 edges 了——判据该只有一份')
})
