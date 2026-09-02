// 改造的道具消耗：当场自扣，别等下一次全量下发。
//
// 用户实弹撞出来的缺口（2026-08-28 23:39 Richelieu改 → Richelieu Deux，消耗改装
// 設計図 ×1 + 海外艦最新技術 ×2）：这两笔在道具履历里标着「远征归来」。
// api_req_kaisou/remodeling 的响应体只有 api_result，舰体状态靠紧跟的 ship3 恢复，
// **道具没有对应的恢复**；持有数只在全量下发时作差落账，于是消耗要等下一次全量
// 才被差出来——那次恰好是 23:44:51 远征归来后的刷新，归因就跟着记错了。
// （08-20 铃谷改二那张图纸更极端：改造 16:45:56，落账 19:00:00。）
//
// 消耗数查主数据 api_mst_shipupgrade，行按**改造前**形态认。下面的报文与主数据行
// 都是逐字真样本（见 fixtures/store-remodel-cost 的 REAL_POST / ROW_*）。
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  REAL_POST,
  REAL_REMODEL_SLOT_BODY,
  REAL_REMODEL_SLOT_POST,
  REMODEL_TS,
  IMPROVE_266,
  ROW_AKAGI_K2_FROM_BOTAI,
  ROW_AKAGI_K2_FROM_KAI,
  ROW_RICHELIEU_DEUX,
  ROW_YAMATO_K2,
  costTable,
  feedRemodeling,
  feedRemodelSlot,
  feedOpenExslot,
  feedHangarExpand,
  feedUseitemSync,
  materials,
  reset,
  slotitems,
  upgradeRowFrom,
  upgrades,
  useitemLog,
  useitems,
} from './fixtures/store-remodel-cost.mjs'

// 那一晚的真持有数（账本 useitem_log 的 total 反推）：图纸 7、海外舰技术 6
const STOCK = { 58: 7, 100: 6 }
const RICHELIEU = { 3447: 392 } // 在籍 3447 = Richelieu改（mst 392）

test('改修当场扣事实表里的特殊道具：更新路线消歧后扣炮熕资材与战斗详报', () => {
  reset(
    { 170: 498 },
    {
      useitems: { 75: 12, 78: 4, 94: 9 },
      slotitems: { 4346: { mstId: 266, level: 10 } },
      materials: [0, 0, 0, 0, 0, 0, 120, 98],
      improveEntries: [IMPROVE_266],
    },
  )
  const sections = feedRemodelSlot(REAL_REMODEL_SLOT_POST, REAL_REMODEL_SLOT_BODY)
  assert.deepEqual(sections.sort(), ['materials', 'slotitems', 'useitems'])
  assert.deepEqual(useitems(), { 75: 11, 78: 3, 94: 9 }, '不能把另一条更新路线的兵装资材扣掉')
  assert.deepEqual(materials(), REAL_REMODEL_SLOT_BODY.api_after_material)
  assert.deepEqual(slotitems()[4346], { id: 4346, mstId: 267, level: 0 })
  assert.deepEqual(
    useitemLog().map((one) => [one.ts, one.changes]),
    [
      [REMODEL_TS, [{ id: 75, delta: -1, total: 11 }]],
      [REMODEL_TS, [{ id: 78, delta: -1, total: 3 }]],
    ],
  )
})

test('改修自扣后的下一次全量不重记；事实表没写这一档就不扣', () => {
  reset(
    { 170: 498 },
    {
      useitems: { 75: 12, 78: 4 },
      slotitems: { 4346: { mstId: 266, level: 10 } },
      improveEntries: [IMPROVE_266],
    },
  )
  feedRemodelSlot(REAL_REMODEL_SLOT_POST, REAL_REMODEL_SLOT_BODY)
  const afterSelfDeduct = useitemLog().length
  feedUseitemSync({ 75: 11, 78: 3 })
  assert.equal(useitemLog().length, afterSelfDeduct)

  reset(
    { 170: 498 },
    {
      useitems: { 75: 12, 78: 4 },
      slotitems: { 4346: { mstId: 266, level: 10 } },
      improveEntries: [{ eq_id: 266, improvement: [{ convert: { id_after: 267 }, costs: {} }] }],
    },
  )
  assert.deepEqual(feedRemodelSlot(REAL_REMODEL_SLOT_POST, REAL_REMODEL_SLOT_BODY).sort(), [
    'materials',
    'slotitems',
  ])
  assert.deepEqual(useitems(), { 75: 12, 78: 4 })
  assert.equal(useitemLog().length, 0)
})

test('普通改修失败没有更新后装备时，按二号舰认路线并照实扣特殊道具', () => {
  reset(
    { 170: 498 },
    {
      useitems: { 75: 12, 78: 4, 94: 9 },
      slotitems: { 4346: { mstId: 266, level: 10 } },
      improveEntries: [IMPROVE_266],
    },
  )
  const body = {
    api_remodel_flag: 0,
    api_remodel_id: [266, 266],
    api_after_material: [7869, 10346, 91671, 5915, 508, 52, 112, 90],
    api_voice_ship_id: 0,
    api_voice_id: 0,
  }
  const post = { ...REAL_REMODEL_SLOT_POST, api_certain_flag: '0' }
  assert.deepEqual(feedRemodelSlot(post, body).sort(), ['materials', 'useitems'])
  assert.deepEqual(useitems(), { 75: 11, 78: 3, 94: 9 })
  assert.deepEqual(slotitems()[4346], { id: 4346, mstId: 266, level: 10 })
})

test('开补强增设槽与格纳库扩容都当场扣，随后全量不重记', () => {
  reset(
    { 7341: { mstId: 560, slotEx: 0 }, 939: 560 },
    { useitems: { 64: 1, 105: 1 } },
  )
  assert.deepEqual(feedOpenExslot({ api_id: '7341' }).sort(), ['ships', 'useitems'])
  assert.deepEqual(
    feedHangarExpand(
      { api_ship_id: '939', api_slot_pos: '4' },
      { api_onslot_max: [18, 15, 15, 3, 0] },
    ).sort(),
    ['ships', 'useitems'],
  )
  assert.deepEqual(useitems(), { 64: 0, 105: 0 })
  assert.equal(useitemLog().length, 2)
  feedUseitemSync({ 64: 0, 105: 0 })
  assert.equal(useitemLog().length, 2, '三端点自扣都必须成为下一次全量的对账基准')
})

test('改造当场扣道具：图纸 −1、海外舰最新技术 −2，且这两笔进账本', () => {
  reset(RICHELIEU, { useitems: STOCK, upgradeRows: [ROW_RICHELIEU_DEUX] })
  const sections = feedRemodeling(REAL_POST)
  assert.deepEqual(sections, ['useitems'])
  assert.equal(useitems()[58], 6, '改装設計図 没扣')
  assert.equal(useitems()[100], 4, '海外艦最新技術 没扣两个')
  assert.deepEqual(
    useitemLog().map((one) => [one.ts, one.changes]),
    [
      [REMODEL_TS, [{ id: 58, delta: -1, total: 6 }]],
      [REMODEL_TS, [{ id: 100, delta: -2, total: 4 }]],
    ],
    '落账时刻必须是改造那一刻，否则归因还是会挂到别的操作上',
  )
})

test('消耗为 0 的字段不产生记录', () => {
  reset(RICHELIEU, { useitems: { ...STOCK, 65: 1, 78: 4, 77: 9, 75: 12 }, upgradeRows: [ROW_RICHELIEU_DEUX] })
  feedRemodeling(REAL_POST)
  assert.deepEqual(
    useitemLog().flatMap((one) => one.changes.map((change) => change.id)),
    [58, 100],
    '这一行只要图纸与海外舰技术，别的道具一个都不该动',
  )
  assert.equal(useitems()[65], 1)
  assert.equal(useitems()[78], 4)
})

test('随后的全量下发不双扣：作差拿的是自扣后的账', () => {
  reset(RICHELIEU, { useitems: STOCK, upgradeRows: [ROW_RICHELIEU_DEUX] })
  feedRemodeling(REAL_POST)
  const afterSelfDeduct = useitemLog().length
  // 游戏过一会儿下发全量，报的正是扣完之后的数
  feedUseitemSync({ 58: 6, 100: 4 })
  assert.equal(useitemLog().length, afterSelfDeduct, '全量作差又记了一遍，履历里就有两笔消耗')
  assert.equal(useitems()[58], 6)
  assert.equal(useitems()[100], 4)
})

test('全量下发仍报旧数时照实补差：自扣不是把后续观测焊死', () => {
  // 服务器那一侧还没结算完（或艦素自扣错了）——账要跟游戏走，不跟自己走
  reset(RICHELIEU, { useitems: STOCK, upgradeRows: [ROW_RICHELIEU_DEUX] })
  feedRemodeling(REAL_POST)
  feedUseitemSync({ 58: 7, 100: 6 })
  assert.equal(useitems()[58], 7)
  assert.deepEqual(useitemLog().at(-1).changes.sort((a, b) => a.id - b.id), [
    { id: 58, delta: 1, total: 7 },
    { id: 100, delta: 2, total: 6 },
  ])
})

test('主数据查无这艘舰的改造行：不扣不崩', () => {
  reset(RICHELIEU, { useitems: STOCK, upgradeRows: [] })
  assert.deepEqual(feedRemodeling(REAL_POST), [])
  assert.deepEqual(useitems(), STOCK)
  assert.equal(useitemLog().length, 0)
})

test('认不出是哪一艘（中途启动艦素）：不扣不崩', () => {
  reset({}, { useitems: STOCK, upgradeRows: [ROW_RICHELIEU_DEUX] })
  assert.deepEqual(feedRemodeling(REAL_POST), [])
  assert.equal(useitemLog().length, 0)
})

// 主数据按**改造后**形态建索引，一个目标可以有多行（可逆改装的每条来路各一行）。
// 请求侧只给在籍 id，当刻只知道改造前是谁——认错这一头就会把回边的「全零」
// 当成正着改的素材单（或者反过来，回一趟戊白扣两张图纸一个弹射器）。
test('同一目标两行：按改造前形态认，回边不扣素材', () => {
  const rows = [ROW_AKAGI_K2_FROM_KAI, ROW_AKAGI_K2_FROM_BOTAI]
  const stock = { 58: 5, 65: 3, 78: 4, 77: 9 }
  // 赤城改（277）→ 赤城改二：图纸2 + 弹射1 + 详报1 + 航空资材2
  reset({ 100: 277 }, { useitems: stock, upgradeRows: rows })
  feedRemodeling({ api_id: '100' })
  assert.deepEqual(useitems(), { 58: 3, 65: 2, 78: 3, 77: 7 })
  // 赤城改二戊（599）→ 赤城改二：回边，一个都不扣
  reset({ 100: 599 }, { useitems: stock, upgradeRows: rows })
  assert.deepEqual(feedRemodeling({ api_id: '100' }), [])
  assert.deepEqual(useitems(), stock)
})

test('新型高温高圧缶不进道具账：那是装备，改造后紧跟的 slot_item 全量会补', () => {
  // 大和改（136）→ 大和改二：图纸3 + 详报1 + 缶2，主数据里唯一带 boiler 的一行
  reset({ 7: 136 }, { useitems: { 58: 5, 78: 4 }, upgradeRows: [ROW_YAMATO_K2] })
  feedRemodeling({ api_id: '7' })
  assert.deepEqual(useitems(), { 58: 2, 78: 3 })
  assert.deepEqual(
    useitemLog().flatMap((one) => one.changes.map((change) => change.id)),
    [58, 78],
    '缶被当成道具扣掉，账上就会凭空少两个别的东西',
  )
})

test('改造行反查认的是 api_current_ship_id，不是目标形态', () => {
  reset({}, { upgradeRows: [ROW_RICHELIEU_DEUX] })
  assert.equal(upgradeRowFrom(392)?.targetShipId, 969, '392 是改造前形态，该认得出这一行')
  assert.equal(upgradeRowFrom(969), null, '969 是改造后形态，从它出发没有下一步')
  assert.equal(upgradeRowFrom(0), null)
  // 主数据那一头照旧按目标形态存（鉴的改造需求页读的是这个索引）
  assert.deepEqual(Object.keys(upgrades()), ['969'])
})

// 消耗字段 → 道具编号。58/100 有实测对账（08-28 那次改造），其余四项与
// shared/kcwiki-upgrade 的别名表同号；写串一个号就是从玩家账上扣错东西。
test('消耗字段对应的道具编号', () => {
  assert.deepEqual(costTable(), [
    ['drawingCount', 58],
    ['catapultCount', 65],
    ['reportCount', 78],
    ['aviationMatCount', 77],
    ['armsMatCount', 75],
    ['techCount', 100],
  ])
})
