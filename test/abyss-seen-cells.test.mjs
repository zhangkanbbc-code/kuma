// 深海舰「我的遭遇」细化到点位（2026-08-25）。
//
// `cell` 从建表第一天起就在 encounters 里，只是 abyssSeenMaps 的 SQL 从没 SELECT 过
// ——于是深海舰页只说得出「7-4 ×5 场」，说不出是在哪个点碰上的。
//
// 归并口径抽进了 shared/abyss-seen，所以下面这批**真跑**。盯的都是「写反了不报错、
// 只是数字悄悄不对」那一类：
//  · 同一张图的不同点位被并成一格（那就等于白细化）；
//  · 点位读不出来的行被整条丢掉（「不知道在哪个点」被当成「没遇到过」）；
//  · 一场遭遇里同型舰出现两次被数成两场。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import abyssSeen from '../dist/shared/abyss-seen.js'

const { abyssSeenEntriesOf, abyssSeenSpotKey, foldAbyssSeen } = abyssSeen
const ledger = fs.readFileSync(new URL('../src/main/mg/ledger.ts', import.meta.url), 'utf8')
const ji = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
const html = fs.readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8')

/** 把若干条遭遇折进一份新索引，返回某一艘舰的结果。 */
const seenOf = (rows, mstId) => {
  const cache = new Map()
  for (const [comp, map, cell] of rows) foldAbyssSeen(cache, comp, map, cell)
  return abyssSeenEntriesOf(cache).find((entry) => entry.mstId === mstId)
}

const BOSS = 1501

test('同一张图的不同点位分开记，图级合计仍是总数', () => {
  const seen = seenOf(
    [
      [[BOSS], 74, 12],
      [[BOSS], 74, 12],
      [[BOSS], 74, 12],
      [[BOSS], 74, 5],
      [[BOSS], 74, 5],
      [[BOSS], 63, 9],
    ],
    BOSS,
  )
  assert.deepEqual(
    seen.maps,
    [
      { map: 74, n: 5, cells: [{ cell: 12, n: 3 }, { cell: 5, n: 2 }] },
      { map: 63, n: 1, cells: [{ cell: 9, n: 1 }] },
    ],
    '点位没有分开记，或者图级合计与逐点对不上',
  )
})

test('次数多的点位在前；同次数按边号升序（顺序不许每次刷新都在跳）', () => {
  const seen = seenOf(
    [
      [[BOSS], 74, 30],
      [[BOSS], 74, 4],
      [[BOSS], 74, 17],
      [[BOSS], 74, 17],
    ],
    BOSS,
  )
  assert.deepEqual(seen.maps[0].cells, [
    { cell: 17, n: 2 },
    { cell: 4, n: 1 },
    { cell: 30, n: 1 },
  ])
})

test('点位读不出来：整条遭遇照样算，只是不进逐点清单', () => {
  // 建表时 cell 是 NOT NULL，理论上不会缺；真缺了也**不许把遭遇丢掉**——
  // 「不知道在哪个点」不等于「没遇到过」。
  for (const bad of [null, undefined, 0, -1, 1.5, Number.NaN, '', 'x', {}]) {
    assert.equal(abyssSeenSpotKey(bad), 0, `${String(bad)} 应当归哨兵`)
  }
  const seen = seenOf(
    [
      [[BOSS], 74, null],
      [[BOSS], 74, undefined],
      [[BOSS], 74, 12],
    ],
    BOSS,
  )
  assert.equal(seen.maps[0].n, 3, '点位缺失的两条被丢了——遭遇次数少算')
  assert.deepEqual(seen.maps[0].cells, [{ cell: 12, n: 1 }], '哨兵混进了逐点清单')
  // 这就是 n 与 cells 各次数之和**可以不相等**的唯一原因，别拿它们互相校验
  const summed = seen.maps[0].cells.reduce((sum, one) => sum + one.n, 0)
  assert.notEqual(summed, seen.maps[0].n)
})

test('一场遭遇里同型舰出现两次只算一场', () => {
  const seen = seenOf([[[BOSS, BOSS, BOSS], 74, 12]], BOSS)
  assert.equal(seen.maps[0].n, 1, '按出场数放大了遭遇场次')
  assert.deepEqual(seen.maps[0].cells, [{ cell: 12, n: 1 }])
})

test('编成里的 0 / 负数不建条目', () => {
  const cache = new Map()
  foldAbyssSeen(cache, [0, -1, BOSS], 74, 12)
  assert.deepEqual([...cache.keys()], [BOSS])
})

// ---- 账本接线 ----

test('账本真的把 cell 取出来了，两条路共用同一个归并函数', () => {
  assert.ok(
    ledger.includes("SELECT map, cell, comp FROM encounters"),
    'abyssSeenMaps 的 SQL 又不取 cell 了——点位无从谈起',
  )
  // 全量重扫与结算后的增量并入必须是同一个函数：各写一份必然漂移，
  // 而两条路平时不会同时跑，数出来不一样也没人看得出来
  assert.equal(
    (ledger.match(/foldAbyssSeen\(/g) ?? []).length,
    2,
    '全量重扫与增量并入没有共用 foldAbyssSeen',
  )
  // 增量那条要真的把 cell 传进去（漏了就全落哨兵，界面上点位会慢慢消失）
  assert.ok(
    /this\.foldAbyssCaches\(comp, map, cell, sunkMask\)/.test(ledger),
    'logEncounter 没把 cell 传给增量并入',
  )
  assert.ok(
    /foldAbyssSeen\(this\.abyssSeenCache, comp, map, cell\)/.test(ledger),
    'foldAbyssCaches 里没把 cell 传下去',
  )
})

// ---- 渲染形制 ----

test('常规图细到点位，活动图只到图', () => {
  assert.ok(ji.includes('const abyssSeenChipHtml = (entry: AbyssSeenMap): string => {'), '遭遇格渲染函数不见了')
  // 活动图分支：年份 + 活动名 + 只要编号的图链
  assert.ok(ji.includes('const event = seenEventTagOf(entry.map)'), '没有判活动图')
  assert.ok(
    /mapEntityLabel\(entry\.map, code, \{\s*codeOnly: true,?\s*\}\)/.test(ji),
    '活动图那格没有只取编号——带上整串图名会把一行撑爆',
  )
  // 常规图分支：点位字母走 fcd 的 route，查无如实显示 #边号（既有口径，不猜字母）
  assert.ok(
    ji.includes("fcdMapLode?.data?.[code]?.route?.[`${cell}`]?.[1] ?? `#${cell}`"),
    '点位字母没走 fcd route，或者开始猜字母了',
  )
  // 逐点清单为空时退回图级「×N 场」，不摆一个空位置
  assert.ok(
    /if \(!cells\.length\) \{[\s\S]{0,200}×\$\{entry\.n\} 场|const total = `×\$\{entry\.n\} 场`/.test(ji),
    '点位取不到时没有退回图级场次',
  )
})

test('活动名撑不下要省略，年份不许被截掉', () => {
  assert.match(html, /\.mod-ji \.af-seen em \{[^}]*text-overflow: ellipsis/)
  assert.match(html, /\.mod-ji \.af-seen i \{[^}]*flex: none/)
})

test('活动年份走既有链路算，不另起一套', () => {
  const at = ji.indexOf('const seenEventTagOf =')
  assert.notEqual(at, -1, 'seenEventTagOf 不见了')
  const body = ji.slice(at, ji.indexOf('\n}', at))
  assert.ok(body.includes('eventAreaIds.has(areaId)'), '活动图判定没走既有的 eventAreaIds')
  assert.ok(body.includes('eventPeriodOf(info)'), '年份没走 eventPeriodOf 那条现成链路')
  // 退役活动图：mapInfos 里没有它时不许炸，如实给空年份
  assert.ok(
    /const year = info \? \(eventPeriodOf\(info\)\?\.text\.match/.test(body),
    '归档还没并回来时 info 是 undefined，这里会炸',
  )
})
