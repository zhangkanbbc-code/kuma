// 62-5 输送段的 TP 专用口径（shared/event-tp-rules + shared/transport-point）。
//
// 这一份有三个职责，按重要性排：
//
// 1. **钉住一手实测锚**：下面 ANCHOR_FLEET 是 2026-08-27 15:28–15:36 那场 62-5 联合出击的
//    真实编成（从本机账本 events 表逐舰复原：ship_deck rid=1,2 的 api_slot
//    ＋ api_get_member/slot_item 的实例→mstId ＋ start2 的主数据）。游戏结算画面给的是
//    `api_landing_hp.api_sub_value = 171`，输送条同时 800 → 629，两票都是 171。
//    本表算出来必须也是 171——这是整套口径唯一的硬地面。
// 2. **钉住取整时机**：同一支队，逐件取整 166、逐舰取整 167、累加到合计再取整 171。
//    三个数互不相同，所以这枚锚**能**把取整时机判出来。下面把三种都算一遍，
//    实现必须落在 171 那一档。
// 3. **防录入抄错**：EXPECT_* 是照 wikiwiki E5「輸送資源量(TP)の計算について」重新敲的一份，
//    与 src 那份各写各的。这类错不报错、界面上也看不出来——只会把 23 分静静算成 6 分。
import assert from 'node:assert/strict'
import test from 'node:test'

import eventTpRules from '../dist/shared/event-tp-rules.js'
import transportPoint from '../dist/shared/transport-point.js'

const { EVENT_TP_RULES, activeEventTpRuleOf, eventTpRuleOf, eventTpTableOf, TP_GAUGE_TYPE } =
  eventTpRules
const { TP_GENERAL, TP_GENERAL_BY_STYPE, transportPointOf } = transportPoint

const RULE = EVENT_TP_RULES.find((r) => r.area === 62 && r.mapNo === 5)
const TABLE = eventTpTableOf(RULE)

// ── 实测锚的真编成 ───────────────────────────────────────────────────────────
// 6DD 1BBV 1FBB 1CAV 1CA 1CVL 1CL，联合 12 舰。4 战全 S 胜、无退避、
// 无大破（最低 Prinz Eugen 改 23/63 = 36.5%，中破），所以 12 舰全部计入。
const ANCHOR_FLEET = [
  [ // 第1舰队
    // 大和改二重（航戦）
    { stype: 10, equips: [{ mstId: 276, name: '46cm三連装砲改' }, { mstId: 465, name: '試製51cm三連装砲' }, { mstId: 304, name: 'S9 Osprey' }, { mstId: 471, name: 'Loire 130M' }, { mstId: 365, name: '一式徹甲弾改' }, { mstId: 142, name: '15m二重測距儀+21号電探改二' }] },
    // Bismarck drei（高速戦艦）
    { stype: 8, equips: [{ mstId: 330, name: '16inch Mk.I連装砲' }, { mstId: 330, name: '16inch Mk.I連装砲' }, { mstId: 36, name: '九一式徹甲弾' }, { mstId: 471, name: 'Loire 130M' }] },
    // 最上改二特（航巡）
    { stype: 6, equips: [{ mstId: 68, name: '大発動艇' }, { mstId: 68, name: '大発動艇' }, { mstId: 68, name: '大発動艇' }, { mstId: 68, name: '大発動艇' }, { mstId: 35, name: '三式弾' }] },
    // 清霜改二丁（駆逐）
    { stype: 2, equips: [{ mstId: 68, name: '大発動艇' }, { mstId: 68, name: '大発動艇' }, { mstId: 68, name: '大発動艇' }] },
    // Prinz Eugen改（重巡）
    { stype: 5, equips: [{ mstId: 123, name: 'SKC34 20.3cm連装砲' }, { mstId: 123, name: 'SKC34 20.3cm連装砲' }, { mstId: 102, name: '九八式水上偵察機(夜偵)' }, { mstId: 278, name: 'SK レーダー' }, { mstId: 35, name: '三式弾' }] },
    // Gambier Bay Mk.II（軽空母）
    { stype: 7, equips: [{ mstId: 559, name: 'Ju87 D-4(Fliegerass)' }, { mstId: 578, name: 'SB2U-2' }, { mstId: 254, name: 'F6F-3N' }, { mstId: 68, name: '大発動艇' }] },
  ],
  [ // 第2舰队
    // Верный（駆逐）
    { stype: 2, equips: [{ mstId: 68, name: '大発動艇' }, { mstId: 68, name: '大発動艇' }, { mstId: 68, name: '大発動艇' }, { mstId: 129, name: '熟練見張員' }] },
    // 春雨改二（駆逐）
    { stype: 2, equips: [{ mstId: 68, name: '大発動艇' }, { mstId: 68, name: '大発動艇' }, { mstId: 68, name: '大発動艇' }] },
    // 村雨改二（駆逐）
    { stype: 2, equips: [{ mstId: 68, name: '大発動艇' }, { mstId: 68, name: '大発動艇' }, { mstId: 68, name: '大発動艇' }, { mstId: 129, name: '熟練見張員' }] },
    // 矢矧改二乙（軽巡）
    { stype: 3, equips: [{ mstId: 139, name: '15.2cm連装砲改' }, { mstId: 407, name: '15.2cm連装砲改二' }, { mstId: 58, name: '61cm五連装(酸素)魚雷' }, { mstId: 364, name: '甲標的 丁型改(蛟龍改)' }, { mstId: 129, name: '熟練見張員' }] },
    // 霞改二（駆逐）
    { stype: 2, equips: [{ mstId: 525, name: '特四式内火艇' }, { mstId: 68, name: '大発動艇' }, { mstId: 513, name: '阻塞気球' }, { mstId: 129, name: '熟練見張員' }] },
    // 天津風改二（駆逐）
    { stype: 2, equips: [{ mstId: 166, name: '大発動艇(八九式中戦車&陸戦隊)' }, { mstId: 68, name: '大発動艇' }, { mstId: 513, name: '阻塞気球' }, { mstId: 129, name: '熟練見張員' }] },
  ],
]

test('实测锚：那场 62-5 出击按专用表算出来就是游戏结算的 171', () => {
  const tp = transportPointOf(ANCHOR_FLEET, TABLE)
  // 游戏 api_landing_hp.api_sub_value = 171；输送条 800 → 629 也是 171
  assert.equal(tp.s, 171, 'S 胜 TP 必须等于游戏结算画面的 171')
  // 未取整的合计带 .75——正是这一位小数把取整时机判出来的
  assert.equal(tp.sExact, 171.75)
  assert.equal(tp.excludedShips, 0, '这一场无大破舰')
  assert.equal(tp.label, '62-5', '专用表要把图号透出来给芯片标注')
})

test('取整时机：逐件 166 / 逐舰 167 / 合计后取整 171——实现落在 171', () => {
  const equipTp = (e) => TABLE.equipTp(e)
  const shipBase = (u) => TABLE.stypeTp[u.stype] ?? 0

  // 逐件取整：舰种基础与每一件装备各自取整后再相加
  const perItem = ANCHOR_FLEET.flat().reduce(
    (sum, u) => sum + Math.floor(shipBase(u)) + u.equips.reduce((a, e) => a + Math.floor(equipTp(e)), 0),
    0,
  )
  // 逐舰取整：每艘自己的合计取整后再相加
  const perShip = ANCHOR_FLEET.flat().reduce(
    (sum, u) => sum + Math.floor(shipBase(u) + u.equips.reduce((a, e) => a + equipTp(e), 0)),
    0,
  )

  assert.equal(perItem, 166, '逐件取整会算成 166')
  assert.equal(perShip, 167, '逐舰取整会算成 167')
  // 三个数互不相同 → 这枚锚确实能判出取整时机
  assert.equal(new Set([perItem, perShip, 171]).size, 3)
  assert.equal(transportPointOf(ANCHOR_FLEET, TABLE).s, 171)
})

test('A 胜：各队 ⌊S队 × 0.7⌋ 相加（上游原文），这一场是 119', () => {
  const tp = transportPointOf(ANCHOR_FLEET, TABLE)
  // 第一舰队 60.0 → ⌊60×0.7⌋ = 42；第二舰队 111.75 → ⌊111⌋ → ⌊111×0.7⌋ = 77
  assert.equal(tp.a, 119)
})

test('非 62-5 语境：同一支队按通用表算仍是原来的 S205 / A143', () => {
  const tp = transportPointOf(ANCHOR_FLEET, TP_GENERAL)
  assert.equal(tp.s, 205)
  assert.equal(tp.a, 143)
  assert.equal(tp.label, null, '通用表不标图号，芯片才不会画出 [62-5]')
})

// ── 语境判据：什么时候该切到专用表 ───────────────────────────────────────────
const GAUGE_TP = { gaugeType: TP_GAUGE_TYPE, cleared: false }

test('输送段开着才用专用表；翻条 / 清了 / 图不在册一律回落通用', () => {
  // 输送段进行中（= 本机 2026-08-27 的真实状态：gaugeType 3、gaugeNum 2、未清）
  assert.equal(eventTpRuleOf(625, GAUGE_TP)?.label, '62-5')

  // 输送段打完翻到下一条血条（HP 条）→ 回落通用
  assert.equal(eventTpRuleOf(625, { gaugeType: 2, cleared: false }), null)
  // 击破计数条同理
  assert.equal(eventTpRuleOf(625, { gaugeType: 1, cleared: false }), null)
  // 这张图已攻略 → 回落通用
  assert.equal(eventTpRuleOf(625, { gaugeType: TP_GAUGE_TYPE, cleared: true }), null)
  // 活动结束：mapinfo 整表重建后这一格直接没了 → 回落通用，零残留
  assert.equal(eventTpRuleOf(625, undefined), null)
  assert.equal(eventTpRuleOf(625, null), null)
  // 血条类型还没读到（没打过输送战）→ 不猜，回落通用
  assert.equal(eventTpRuleOf(625, { gaugeType: null, cleared: false }), null)
  // 别的图即便正开着输送条，也不套 62-5 的表
  assert.equal(eventTpRuleOf(624, GAUGE_TP), null)
  assert.equal(eventTpRuleOf(25, GAUGE_TP), null)
})

test('activeEventTpRuleOf 从整份 mapGauges 里挑出正开着的那张图', () => {
  // 本机 2026-08-27 的真实 mapGauges 形状
  const live = {
    621: { gaugeType: 2, cleared: true },
    622: { gaugeType: 2, cleared: true },
    623: { gaugeType: 2, cleared: true },
    624: { gaugeType: 2, cleared: true },
    625: { gaugeType: 3, cleared: false },
  }
  assert.equal(activeEventTpRuleOf(live)?.label, '62-5')

  // 输送段结束（翻到 HP 条）
  assert.equal(activeEventTpRuleOf({ ...live, 625: { gaugeType: 2, cleared: false } }), null)
  // 活动结束：62 区整个不在册了
  assert.equal(activeEventTpRuleOf({ 15: { gaugeType: null, cleared: false } }), null)
  assert.equal(activeEventTpRuleOf({}), null)
  assert.equal(activeEventTpRuleOf(null), null)
  assert.equal(activeEventTpRuleOf(undefined), null)
})

// ── 分队取整 ────────────────────────────────────────────────────────────────
test('专用表联合编成分队各自取整；通用表整支合成一笔（两者不是同一个数）', () => {
  // 两队各 .5：分队取整两次各丢 0.5（共丢 1），整支合计则一点不丢
  const half = [
    [{ stype: 2, equips: [{ mstId: 75, name: 'ドラム缶(輸送用)' }] }], // 3.75 + 3.25 = 7.0
    [{ stype: 2, equips: [{ mstId: 526, name: '特四式内火艇改' }] }], // 3.75 + 13.5 = 17.25
  ]
  const perFleet = transportPointOf(half, TABLE)
  assert.equal(perFleet.sExact, 24.25)
  // ⌊7.0⌋ + ⌊17.25⌋ = 7 + 17 = 24（这里与整支合计 ⌊24.25⌋ = 24 恰好相同）
  assert.equal(perFleet.s, 24)

  // 造一个两种算法真的分岔的例子：两队各 .75
  const split = [
    [{ stype: 2, equips: [{ mstId: 75, name: 'ドラム缶(輸送用)' }, { mstId: 145, name: '戦闘糧食' }] }], // 3.75+3.25+0.75 = 7.75
    [{ stype: 2, equips: [{ mstId: 75, name: 'ドラム缶(輸送用)' }, { mstId: 145, name: '戦闘糧食' }] }], // 7.75
  ]
  const got = transportPointOf(split, TABLE)
  assert.equal(got.sExact, 15.5)
  assert.equal(got.s, 14, '分队各自取整：⌊7.75⌋ + ⌊7.75⌋ = 7 + 7 = 14')
  assert.notEqual(got.s, Math.floor(15.5), '整支合计会算成 15——上游写的是分队')

  // 通用表不分队（上游通用页没写这一层，本仓口径不动）
  assert.equal(TP_GENERAL.perFleet, false)
  const gen = transportPointOf(
    [
      [{ stype: 2, equips: [] }], // 5
      [{ stype: 2, equips: [] }], // 5
    ],
    TP_GENERAL,
  )
  assert.equal(gen.s, 10)
  assert.equal(gen.a, 7, '整支合计 ⌊10×0.7⌋ = 7；若分队则是 ⌊3.5⌋+⌊3.5⌋ = 6')
})

test('大破舰整舰连装备排除', () => {
  const wrecked = [
    [
      { stype: 2, equips: [{ mstId: 68, name: '大発動艇' }] }, // 3.75 + 6
      { stype: 2, wrecked: true, equips: [{ mstId: 68, name: '大発動艇' }] }, // 一律不计
    ],
  ]
  const tp = transportPointOf(wrecked, TABLE)
  assert.equal(tp.sExact, 9.75)
  assert.equal(tp.s, 9)
  assert.equal(tp.excludedShips, 1)
  assert.equal(tp.contributing, 1)
})

// ── 防抄错：逐格重敲一份对照表 ───────────────────────────────────────────────
// 照 wikiwiki E5「輸送資源量(TP)の計算について(2025秋E2より引用)」重敲，2026-08-27。
const EXPECT_EQUIP = {
  576: ['大発動艇(R35&フランス兵)', 24],
  514: ['特大発動艇+Ⅲ号戦車J型', 23],
  449: ['特大発動艇+一式砲戦車', 21],
  355: ['M4A1 DD', 20],
  230: ['特大発動艇+戦車第11連隊', 19],
  495: ['特大発動艇+チハ改', 19],
  482: ['特大発動艇+Ⅲ号戦車(北アフリカ仕様)', 19],
  494: ['特大発動艇+チハ', 17],
  436: ['大発動艇(II号戦車/北アフリカ仕様)', 16],
  166: ['大発動艇(八九式中戦車&陸戦隊)', 14],
  499: ['陸軍歩兵部隊+チハ改', 14],
  526: ['特四式内火艇改', 13.5],
  167: ['特二式内火艇', 12.5],
  525: ['特四式内火艇', 11.5],
  498: ['九七式中戦車 新砲塔(チハ改)', 9],
  497: ['九七式中戦車(チハ)', 7],
  68: ['大発動艇', 6],
  193: ['特大発動艇', 6],
  408: ['装甲艇(AB艇)', 6],
  409: ['武装大発', 6],
  496: ['陸軍歩兵部隊', 5],
  75: ['ドラム缶(輸送用)', 3.25], // 上游三家打架，取 wikiwiki 的 3.25（行注见 src）
  145: ['戦闘糧食', 0.75],
  150: ['秋刀魚の缶詰', 0.75],
  241: ['戦闘糧食(特別なおにぎり)', 0.75],
}

test('装备专表逐格与 wiki 相等，一件不多一件不少', () => {
  assert.equal(RULE.equips.length, Object.keys(EXPECT_EQUIP).length)
  for (const entry of RULE.equips) {
    const want = EXPECT_EQUIP[entry.mstId]
    assert.ok(want, `mstId ${entry.mstId}（${entry.name}）不在对照表里`)
    assert.equal(entry.name, want[0], `mstId ${entry.mstId} 的名字对不上`)
    assert.equal(entry.tp, want[1], `${entry.name} 的 TP 对不上`)
  }
  // id 不许重复：Map 建出来少一格是静默的
  assert.equal(new Set(RULE.equips.map((e) => e.mstId)).size, RULE.equips.length)
})

test('Ⅲ号戦車 用的是 CJK 罗马数字 U+2162，不是三个 ASCII I', () => {
  // 攻略表/截图一律排版成 ASCII "III"，照抄进来就永不命中——不报错，只把 23 分算成 6 分。
  // 游戏自己的 api_mst_slotitem 里 482/514 用 Ⅲ(U+2162)，而 436 用的却是 ASCII "II"。
  for (const mstId of [482, 514]) {
    const entry = RULE.equips.find((e) => e.mstId === mstId)
    assert.ok(entry.name.includes('Ⅲ'), `mstId ${mstId} 必须含 U+2162`)
    assert.ok(!/III/.test(entry.name), `mstId ${mstId} 不许出现 ASCII III`)
  }
  // 436 反过来：它在游戏里就是 ASCII II
  assert.ok(RULE.equips.find((e) => e.mstId === 436).name.includes('(II号'))
})

test('装备值都是 0.25 的整数倍——浮点累加才是精确的', () => {
  for (const entry of RULE.equips) {
    assert.equal(entry.tp * 4, Math.round(entry.tp * 4), `${entry.name} 不是 0.25 的整数倍`)
  }
})

// 舰种基础 = 通用値 × 0.75。这一份也重敲，顺带把 ×0.75 这条关系钉住。
// （上游那张表在被引用的 2025秋E2 页上，标题自带问号「通常時の0.75倍？」；
//   本仓的实测锚把航戦/航巡/軽巡/駆逐 四种从推测升成了实测。）
const EXPECT_STYPE = {
  2: 3.75, // 駆逐艦（实测锚覆盖）
  3: 1.5, // 軽巡洋艦（实测锚覆盖）
  6: 3, // 航空巡洋艦（实测锚覆盖）
  10: 5.25, // 航空戦艦（实测锚覆盖）
  14: 0.75, // 潜水空母
  16: 6.75, // 水上機母艦
  17: 9, // 揚陸艦
  20: 5.25, // 潜水母艦
  21: 4.5, // 練習巡洋艦
  22: 11.25, // 補給艦
}

test('舰种基础逐格 = 通用値 × 0.75', () => {
  assert.equal(RULE.modmap, 0.75)
  for (const [stype, want] of Object.entries(EXPECT_STYPE)) {
    assert.equal(TABLE.stypeTp[stype], want, `stype ${stype} 的基础值对不上`)
    assert.equal(TP_GENERAL_BY_STYPE[stype] * 0.75, want, `stype ${stype} 与 ×0.75 的关系断了`)
  }
  // 通用表没给分的舰种，专用表也不给（戦艦/空母/重巡/雷巡/海防/潜水/工作 一律 0）
  for (const stype of [5, 7, 8, 9, 11, 13, 18, 19]) {
    assert.equal(TABLE.stypeTp[stype] ?? 0, 0, `stype ${stype} 不该有基础值`)
  }
  // 潜水空母(0.75) 与 潜水母艦(5.25) 别写反——zekamashi / totoneko 两家都栽在这一格
  assert.equal(TABLE.stypeTp[14], 0.75)
  assert.equal(TABLE.stypeTp[20], 5.25)
})

test('表里没有的装备一律 0，不猜', () => {
  assert.equal(TABLE.equipTp({ mstId: 999999, name: '大発動艇(还没实装的新版本)' }), 0)
  assert.equal(TABLE.equipTp({ mstId: 129, name: '熟練見張員' }), 0)
})
