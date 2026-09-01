// 友军遭遇志：收录、合并计次、从 events 回放补录、铎的两层并列展示。
//
// ════ 夹具是真包 ════
// `fixtures/battle-friendly-fleet.json` 与 friendly-fleet-battle.test.mjs 共用同一份
// （2026-08-26 晚本机账本，脱敏体检记录见那个文件的头注）。这里用的是它的
// `api_friendly_info` 段：两支编成不同、api_production_type 一个 2 一个 3。
//
// ════ 为什么这几条要行为级 ════
// ① 判重键：手搓报文会把「同一支友军每次下发的字段都一模一样」这个假设搓进去，
//    而真包里 api_nowhps 逐次都在变（友军是带着伤来的）——指纹要是把血量算进去，
//    同一支友军会裂成好几支，源码读起来却完全正常。
// ② 幂等：真往内存库里插两遍才看得见第二遍到底进没进去。
// ③ 两层并列：写成「有实测就不显示资料层」这种择一显示，正则钉不住，只能数产物。
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  FRIENDLY_REQUEST_NAME,
  friendlyFleetKey,
  groupFriendlySightings,
  parseFriendlyInfo,
  replayFriendlySightings,
} from '../src/shared/friendly-fleet.ts'
// 这一份走 dist：ledger-retention 还引着别的 shared 模块，直接 import .ts
// 会撞上 Node 的「相对导入必须带扩展名」（既有的 ledger-retention.test.mjs 同样走 dist）
import retention from '../dist/shared/ledger-retention.js'
import {
  DDL_TEXT,
  logFriendlyFleet,
  queryFriendlyFleets,
  rawRows,
  rowCount,
  wipe,
} from './fixtures/friendly-fleet-ledger.mjs'
import { renderFriendlySection } from './fixtures/render-du-friendly.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PACKETS = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'battle-friendly-fleet.json'), 'utf8'),
)

/** 真包里的两段 api_friendly_info。 */
const INFO_4 = PACKETS.friendlyNight.night.data.api_friendly_info // 4 舰，ptype 2
const INFO_5 = PACKETS.bossNight.night.data.api_friendly_info // 5 舰，ptype 3

const sightingOf = (info, over = {}) => {
  const parsed = parseFriendlyInfo(info)
  return {
    fleetKey: friendlyFleetKey(parsed.ships),
    ts: 1787749749483,
    map: 624,
    cell: 47,
    difficulty: 2,
    requestType: 1,
    productionType: parsed.productionType,
    ships: parsed.ships,
    ...over,
  }
}

// ---- ① 收录：字段完整，production_type 存原值 ----

test('友军编成按真包逐字段收下来：mstId / Lv / 装备 / 补强增设 / 语音号', () => {
  const parsed = parseFriendlyInfo(INFO_4)
  assert.deepEqual(parsed.ships.map((s) => s.mstId), [553, 554, 716, 708])
  assert.deepEqual(parsed.ships.map((s) => s.lv), [93, 93, 73, 72])
  // 装备来自 api_Slot（**大写 S**）。读成小写就会整排落空，而空数组在别处看不出异常。
  assert.deepEqual(parsed.ships[0].slot, [290, 290, 490, 365, 140])
  assert.deepEqual(parsed.ships[2].slot, [379, 286, 240, -1, -1])
  assert.deepEqual(parsed.ships.map((s) => s.slotEx), [129, 129, 412, 412])
  assert.deepEqual(parsed.ships.map((s) => s.voiceId), [160, 160, 162, 162])
  assert.deepEqual(parsed.ships.map((s) => s.voiceP), [1, 2, 0, 0])
  assert.deepEqual(parsed.ships[0].param, [88, 0, 85, 94])
  assert.equal(parsed.ships[0].maxHp, 78)
})

test('大写 S 那条腿是真的在读 api_Slot：改成小写键就读不到装备', () => {
  const { api_Slot: slots, ...withoutCapital } = INFO_4
  const parsed = parseFriendlyInfo({ ...withoutCapital, api_slot_lowercase_decoy: slots })
  assert.deepEqual(parsed.ships.map((s) => s.slot), [[], [], [], []])
  // 反过来：真字段在的时候必须读到（不然上面那条断言是靠巧合绿的）
  assert.deepEqual(parseFriendlyInfo(INFO_4).ships[0].slot, [290, 290, 490, 365, 140])
})

test('api_production_type 只存原值，不翻译成任何标签', () => {
  assert.equal(parseFriendlyInfo(INFO_4).productionType, 2)
  assert.equal(parseFriendlyInfo(INFO_5).productionType, 3)
  // 同一次強力要請下这两个值都出现过（2026-08-26 实弹），所以它不是要請档位。
  // 显示层不许由它推出「強力」二字——这里连解读的位置都不给留。
  const record = groupFriendlySightings([
    sightingOf(INFO_4, { requestType: null }),
  ])[0]
  assert.deepEqual(record.productionTypes, [2])
  const html = renderFriendlySection([record], [])
  assert.ok(!html.includes('強力'), 'production_type 不许被渲染成「強力」')
  assert.ok(!html.includes('通常'), 'production_type 不许被渲染成「通常」')
  assert.ok(!html.includes('production'), '原值不上屏')
})

test('不是友军战的包不产生记录', () => {
  assert.equal(parseFriendlyInfo(undefined), null)
  assert.equal(parseFriendlyInfo(null), null)
  assert.equal(parseFriendlyInfo({}), null)
  assert.equal(parseFriendlyInfo({ api_ship_id: [] }), null)
  // 昼战包本来就没有这一段
  assert.equal(PACKETS.friendlyNight.day.data.api_friendly_info, undefined)
})

// ---- ② 同支友军二遇合并计次 ----

test('同一支友军二遇：合并成一条，计次 2，最近时刻取靠后那次', () => {
  const early = sightingOf(INFO_4, { ts: 1000 })
  const late = sightingOf(INFO_4, { ts: 9000 })
  const [record] = groupFriendlySightings([early, late])
  assert.equal(record.count, 2)
  assert.equal(record.firstTs, 1000)
  assert.equal(record.lastTs, 9000)
  assert.deepEqual(record.cells, [{ cell: 47, count: 2 }])
})

test('同支友军在不同点位遇到：点位各自计次，不并成一个数', () => {
  const rows = [
    sightingOf(INFO_4, { ts: 1000, cell: 47 }),
    sightingOf(INFO_4, { ts: 2000, cell: 47 }),
    sightingOf(INFO_4, { ts: 3000, cell: 31 }),
  ]
  const [record] = groupFriendlySightings(rows)
  assert.equal(record.count, 3)
  // 次数降序
  assert.deepEqual(record.cells, [{ cell: 47, count: 2 }, { cell: 31, count: 1 }])
})

test('编成不同就是两支：4 舰那支与多一艘的 5 舰那支不许合并', () => {
  const grouped = groupFriendlySightings([sightingOf(INFO_4, { ts: 1000 }), sightingOf(INFO_5, { ts: 2000 })])
  assert.equal(grouped.length, 2)
  assert.notEqual(friendlyFleetKey(parseFriendlyInfo(INFO_4).ships), friendlyFleetKey(parseFriendlyInfo(INFO_5).ships))
})

test('判重键不含血量：友军带伤来的那两次仍是同一支', () => {
  // 真包实测：潜水舰那支两次 api_nowhps 分别是 …30,30 与 …29,31。
  const hurt = { ...INFO_4, api_nowhps: INFO_4.api_nowhps.map((hp) => Math.max(1, hp - 7)) }
  assert.equal(
    friendlyFleetKey(parseFriendlyInfo(INFO_4).ships),
    friendlyFleetKey(parseFriendlyInfo(hurt).ships),
  )
  assert.equal(groupFriendlySightings([sightingOf(INFO_4, { ts: 1 }), sightingOf(hurt, { ts: 2 })]).length, 1)
})

test('难度不同不合并：丙难度的实测不许挂到甲难度名下', () => {
  const grouped = groupFriendlySightings([
    sightingOf(INFO_4, { ts: 1000, difficulty: 2 }),
    sightingOf(INFO_4, { ts: 2000, difficulty: 4 }),
  ])
  assert.equal(grouped.length, 2)
})

// ---- ③ 要請类型：来自 set_friendly_request，缺席是「不知道」 ----

test('要請类型取此刻之前最后一次 set_friendly_request', () => {
  const sightings = replayFriendlySightings([
    { ts: 10, path: '/kcsapi/api_get_member/mapinfo', body: { api_data: [{ api_id: 624, api_eventmap: { api_selected_rank: 2 } }] } },
    { ts: 20, path: '/kcsapi/api_req_member/set_friendly_request', body: { api_data: {} }, post: { api_request_flag: '1', api_request_type: '1' } },
    { ts: 30, path: '/kcsapi/api_req_map/start', body: { api_data: { api_maparea_id: 62, api_mapinfo_no: 4, api_no: 47 } } },
    { ts: 40, path: '/kcsapi/api_req_combined_battle/ec_midnight_battle', body: { api_data: { api_friendly_info: INFO_4 } } },
    // 中途切成通常要請，之后那一场就该记 0
    { ts: 50, path: '/kcsapi/api_req_member/set_friendly_request', body: { api_data: {} }, post: { api_request_flag: '1', api_request_type: '0' } },
    { ts: 60, path: '/kcsapi/api_req_combined_battle/ec_midnight_battle', body: { api_data: { api_friendly_info: INFO_4 } } },
  ])
  assert.deepEqual(sightings.map((s) => s.requestType), [1, 0])
  assert.deepEqual(sightings.map((s) => s.difficulty), [2, 2])
  assert.deepEqual(sightings.map((s) => [s.map, s.cell]), [[624, 47], [624, 47]])
})

test('从没收到过 set_friendly_request：要請类型留 null，不回灌成「通常」', () => {
  const [sighting] = replayFriendlySightings([
    { ts: 30, path: '/kcsapi/api_req_map/start', body: { api_data: { api_maparea_id: 62, api_mapinfo_no: 4, api_no: 47 } } },
    { ts: 40, path: '/kcsapi/api_req_combined_battle/ec_midnight_battle', body: { api_data: { api_friendly_info: INFO_4 } } },
  ])
  assert.equal(sighting.requestType, null, '不知道 ≠ 通常要請')
  // 关联不上就整段不标
  const [record] = groupFriendlySightings([sighting])
  assert.deepEqual(record.requestTypes, [])
  assert.equal(record.unknownRequest, 1)
  const html = renderFriendlySection([record], [])
  assert.ok(!html.includes(FRIENDLY_REQUEST_NAME[0]))
  assert.ok(!html.includes(FRIENDLY_REQUEST_NAME[1]))
})

test('回放跟着 map/next 走点位，难度跟着 select_eventmap_rank 改', () => {
  const sightings = replayFriendlySightings([
    { ts: 10, path: '/kcsapi/api_get_member/mapinfo', body: { api_data: [{ api_id: 624, api_eventmap: { api_selected_rank: 2 } }] } },
    { ts: 15, path: '/kcsapi/api_req_map/select_eventmap_rank', body: { api_data: {} }, post: { api_maparea_id: '62', api_map_no: '4', api_rank: '4' } },
    { ts: 20, path: '/kcsapi/api_req_map/start', body: { api_data: { api_maparea_id: 62, api_mapinfo_no: 4, api_no: 23 } } },
    { ts: 30, path: '/kcsapi/api_req_map/next', body: { api_data: { api_maparea_id: 62, api_mapinfo_no: 4, api_no: 47 } } },
    { ts: 40, path: '/kcsapi/api_req_combined_battle/ec_midnight_battle', body: { api_data: { api_friendly_info: INFO_4 } } },
  ])
  assert.equal(sightings.length, 1)
  assert.equal(sightings[0].cell, 47)
  assert.equal(sightings[0].difficulty, 4)
})

test('位置不明的友军包不落表：宁可少一条，也不挂到错的图上', () => {
  const sightings = replayFriendlySightings([
    { ts: 40, path: '/kcsapi/api_req_combined_battle/ec_midnight_battle', body: { api_data: { api_friendly_info: INFO_4 } } },
  ])
  assert.deepEqual(sightings, [])
})

// ---- ④ 回填幂等 ----

test('回放两遍写进真表：行数不变，计次也不翻倍', () => {
  wipe()
  const events = [
    { ts: 10, path: '/kcsapi/api_get_member/mapinfo', body: { api_data: [{ api_id: 624, api_eventmap: { api_selected_rank: 2 } }] } },
    { ts: 20, path: '/kcsapi/api_req_member/set_friendly_request', body: { api_data: {} }, post: { api_request_flag: '1', api_request_type: '1' } },
    { ts: 30, path: '/kcsapi/api_req_map/start', body: { api_data: { api_maparea_id: 62, api_mapinfo_no: 4, api_no: 47 } } },
    { ts: 40, path: '/kcsapi/api_req_combined_battle/ec_midnight_battle', body: { api_data: { api_friendly_info: INFO_4 } } },
    { ts: 50, path: '/kcsapi/api_req_combined_battle/ec_midnight_battle', body: { api_data: { api_friendly_info: INFO_5 } } },
    { ts: 60, path: '/kcsapi/api_req_combined_battle/ec_midnight_battle', body: { api_data: { api_friendly_info: INFO_4 } } },
  ]
  for (const sighting of replayFriendlySightings(events)) logFriendlyFleet(sighting)
  assert.equal(rowCount(), 3)
  const first = queryFriendlyFleets(624, 2)
  assert.equal(first.length, 2, '两支友军')
  assert.equal(first.find((r) => r.ships.length === 4).count, 2)

  // 再跑一遍整份回放——一行都不许多，**而且不许是靠吞异常做到的**。
  // 主键本身就会挡下重复插入，所以「行数没变」这一条单独看不出 OR IGNORE 在不在：
  // 少了它每一行都会撞约束抛错、被 catch 静默吞掉，行数照样是 3。
  // 差别在这里——重跑必须一条 warn 都不产生，走的是正常路径而不是错误路径。
  const warned = []
  const realWarn = console.warn
  console.warn = (...args) => warned.push(args.join(' '))
  try {
    for (const sighting of replayFriendlySightings(events)) logFriendlyFleet(sighting)
  } finally {
    console.warn = realWarn
  }
  assert.equal(rowCount(), 3, '重跑回填不许重复写入')
  assert.deepEqual(warned, [], '重跑是干净的空操作，不是撞了约束再把异常吞掉')
  assert.deepEqual(queryFriendlyFleets(624, 2), first, '重跑后聚合结果逐字段不变')
})

test('落表的字段真的进了对应的列', () => {
  wipe()
  logFriendlyFleet(sightingOf(INFO_4, { ts: 777, cell: 31, difficulty: 3, requestType: 0 }))
  const [row] = rawRows()
  assert.equal(row.ts, 777)
  assert.equal(row.map, 624)
  assert.equal(row.cell, 31)
  assert.equal(row.difficulty, 3)
  assert.equal(row.request_type, 0)
  assert.equal(row.production_type, 2)
  assert.equal(JSON.parse(row.comp).length, 4)
  assert.ok(row.fleet_key.includes('553'))
})

test('要請类型未知时落的是 NULL，不是 0', () => {
  wipe()
  logFriendlyFleet(sightingOf(INFO_4, { ts: 888, requestType: null }))
  assert.equal(rawRows()[0].request_type, null)
  assert.deepEqual(queryFriendlyFleets(624, 2)[0].requestTypes, [])
})

test('同一支友军同一时刻只可能有一行（主键就是这么定的）', () => {
  wipe()
  logFriendlyFleet(sightingOf(INFO_4, { ts: 555 }))
  logFriendlyFleet(sightingOf(INFO_4, { ts: 555, cell: 99 }))
  assert.equal(rowCount(), 1)
  assert.ok(DDL_TEXT.includes('PRIMARY KEY (fleet_key, ts)'))
})

// ---- 永久表 ----

test('友军遭遇志是永久表，任何清理路径都碰不到它', () => {
  assert.ok(retention.LEDGER_PERMANENT_TABLES.includes('friendly_fleets'))
  assert.ok(!retention.LEDGER_ROLLING_TABLES.includes('friendly_fleets'))
  assert.notEqual(retention.LEDGER_NOTIFY_TABLE, 'friendly_fleets')
})

// ---- ③ 铎的两层并列展示 ----

const packFleet = { ships: [{ id: 553, name: '伊势改二' }, { id: 554, name: '日向改二' }], note: '强友军' }
const seenRecord = () =>
  groupFriendlySightings([sightingOf(INFO_4, { ts: 1000 }), sightingOf(INFO_4, { ts: 2000 })])[0]

test('两层都有内容时并列显示，谁也不顶替谁', () => {
  const html = renderFriendlySection([seenRecord()], [packFleet], { 553: { name: '伊勢改二' } })
  assert.ok(html.includes('你遇到的友军'), '本地实测层要在')
  assert.ok(html.includes('友军编成资料'), '随包资料层也要在')
  assert.ok(html.includes('op-friend seen'), '实测行')
  assert.ok(/<div class="op-friend">/.test(html), '资料行')
  assert.ok(!html.includes('这个难度暂无友军编成资料'), '有内容就不许出空态')
})

test('只有本地实测时：显示实测，不拿「还没有资料」盖掉它', () => {
  const html = renderFriendlySection([seenRecord()], [])
  assert.ok(html.includes('你遇到的友军'))
  assert.ok(!html.includes('友军编成资料'), '资料层空就整层不出现')
  assert.ok(!html.includes('这个难度暂无友军编成资料'))
})

test('只有随包资料时维持原样', () => {
  const html = renderFriendlySection([], [packFleet])
  assert.ok(html.includes('友军编成资料'))
  assert.ok(!html.includes('你遇到的友军'))
  assert.ok(!html.includes('这个难度暂无友军编成资料'))
})

test('两层都空才显示空态', () => {
  const html = renderFriendlySection([], [])
  assert.ok(html.includes('这个难度暂无友军编成资料'))
  // 比的是**层标**在不在：空态那句话里也含「友军编成资料」四个字，
  // 光搜字串会被它自己骗过去
  assert.ok(!html.includes('<div class="op-sub">'), '两层都空时一个层标也不摆')
  assert.ok(!html.includes('op-friend'), '一行都不摆')
})

test('实测行按口径列：编成带 Lv、要請类型、点位与次数、最近时刻', () => {
  const html = renderFriendlySection([seenRecord()], [], { 553: { name: '伊勢改二' } })
  assert.ok(html.includes('Lv93'), '编成带等级')
  assert.ok(html.includes('data-el="mstShip:553"'), '舰名连进图鉴')
  assert.ok(html.includes(FRIENDLY_REQUEST_NAME[1]), '要請类型')
  assert.ok(html.includes('点位 47 ×2'), '点位与次数')
  assert.ok(html.includes('最近 TS2000'), '最近时刻')
})

test('两层并列是真并列，不是择一显示', () => {
  // 把实测层去掉，资料层的内容必须原样还在——若实现写成
  // `seen.length ? seenHtml : packHtml`，这一条与上面「两层都有」那条会同时绿，
  // 所以这里比的是**同一份 pack 在有/无实测两种局面下的产物**。
  const withSeen = renderFriendlySection([seenRecord()], [packFleet])
  const withoutSeen = renderFriendlySection([], [packFleet])
  const packPart = withoutSeen
  assert.ok(withSeen.endsWith(packPart), '资料层不因为本地有实测而被削掉或改写')
})

// ---- ④ 一支友军横排一行（2026-08-28 用户截图报「太粗糙了」） ----
//
// 病根不在这段 HTML 而在 CSS：`.mod-du .op-friend span { display: block }` 本意是让
// 末尾备注独占一行，可 elink / 实体术语 / 头像壳子生成的**全都是 span**，于是一支
// 友军的每个舰名各占一行，连 join 用的「·」都单独一行。所以这一组要两头都钉：
// 产物这边舰名进得了同一个横排容器，CSS 那边不许再拿裸标签去压块级。

test('一支友军的舰名横排在同一容器里，不再拿「·」当分隔', () => {
  const html = renderFriendlySection([], [packFleet])
  const row = html.slice(html.indexOf('<div class="op-friend">'))
  assert.ok(row.includes('<div class="op-friend-ships">'), '舰名进横排容器')
  const ships = row.slice(row.indexOf('op-friend-ships'), row.indexOf('op-fnote'))
  assert.equal((ships.match(/op-friend-ship"/g) ?? []).length, 2, '两艘各一格')
  assert.ok(!ships.includes(' · '), '横排交给 flex gap，不再靠分隔符')
  assert.ok(row.includes('<span class="op-fnote">强友军</span>'), '备注挂显式类名')
})

test('资料层连不上主数据的舰名只出名字，不硬安一个头像', () => {
  const html = renderFriendlySection([], [{ ships: [{ id: 553, name: '伊势改二' }, { name: '某舰' }] }])
  assert.ok(html.includes('data-ship-id="553"'), '有号的摆头像')
  const noId = html.slice(html.indexOf('某舰') - 200, html.indexOf('某舰'))
  assert.ok(!noId.includes('data-ship-id="undefined"'), '无号不猜号')
  assert.equal((html.match(/data-ship-id=/g) ?? []).length, 1, '只有一个头像')
})

test('实测层每艘也带头像，装备只进悬停不进一眼位置', () => {
  const items = { 290: { name: '【甲装备】' }, 490: { name: 'Ｘ' }, 365: { name: 'Ｙ' }, 140: { name: 'Ｚ' }, 129: { name: '【增设装备】' } }
  const html = renderFriendlySection([seenRecord()], [], { 553: { name: '伊勢改二' } }, items)
  assert.ok(html.includes('data-ship-id="553"'), '实测层也摆头像')
  const cell = html.slice(html.indexOf('op-friend-ship"'), html.indexOf('Lv93'))
  assert.ok(cell.includes('title="'), '装备明细走 title')
  const title = cell.slice(cell.indexOf('title="') + 7, cell.indexOf('"', cell.indexOf('title="') + 7))
  assert.ok(title.includes('【甲装备】'), '常规槽的装备名进悬停')
  assert.ok(title.includes('增设 【增设装备】'), '补强增设那一格标出来')
  // 一眼位置只有舰名与练度：装备名只在 title 里出现，屏幕上读不到
  // （同一件装备会在好几艘身上重复，所以比的不是出现次数，是「摘掉 title 还剩没剩」）
  assert.ok(html.includes('【甲装备】'), '夹具确实带上了这件装备')
  assert.ok(!html.replace(/ title="[^"]*"/g, '').includes('【甲装备】'), '摘掉 title 就没有装备名了')
  assert.ok(!html.replace(/ title="[^"]*"/g, '').includes('增设'), '「增设」标签也只在悬停里')
  // 查不到名的装备号原样显示，不编名字
  const bare = renderFriendlySection([seenRecord()], [], {}, {})
  assert.ok(bare.includes('#290'), '主数据缺装备时给号')
})

test('.op-friend 里压块级的规则不许再用裸标签选择器', () => {
  // 这一条盯的是**下一次**：任何 `.op-friend xxx { display:block }` 只要末段是裸标签，
  // 就又会把舰名链接、实体术语、头像壳子一起压竖。只允许收窄到类名。
  const css = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8')
  const offenders = []
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selector.includes('.op-friend') || !/display\s*:\s*block/.test(body)) continue
    for (const part of selector.split(',')) {
      const last = part.trim().split(/[\s>]+/).pop() ?? ''
      if (last && !last.startsWith('.')) offenders.push(part.trim())
    }
  }
  assert.deepEqual(offenders, [], '压块级只许按类名点名')
})
