// 成长三维（回避/对潜/索敌）端点表与**标定闸门**的行为级护栏。
//
// 这一层是七项面板反推的上线开关：这三项的裸值主数据不下发，要拿端点插值算，
// 而端点表会无声腐坏（C2 历年单独抬高过成长上限，官方公告只说「谁的哪一项 up」）。
// 所以夹具全部取自**真账本快照**（423 舰全量，观测日 2026-08-06）——
// 编出来的数验不出「公式对不对」，只有真面板能。
//
// 与它配套的两处：`shared/fit-bonus.ts` 的七项反推（test/fit-bonus-runtime.test.mjs）、
// `renderer/fleet-calc.ts` 的取数与缓存（源码级接线钉在 core-regressions）。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import shipGrowth from '../dist/shared/ship-growth.js'
import shipStatsPatches from '../dist/shared/ship-stats-patches.js'
import fitBonus from '../dist/shared/fit-bonus.js'

const {
  SHIP_GROWTH_KEYS,
  calibrateGrowth,
  growthEndpoints,
  growthGateKey,
  growthReverseEnabled,
  growthValueAt,
  levelGrowth,
} = shipGrowth
const { SHIP_GROWTH_NOTICES, SHIP_STAT_GAPS, SHIP_STAT_PATCHES, SHIP_STAT_SUSPECT_CELLS } =
  shipStatsPatches
const { observedFitBonus } = fitBonus

const pack = JSON.parse(
  fs.readFileSync(new URL('../assets/lodes/ship-stats.json', import.meta.url), 'utf8'),
).data

/** 账本快照里的一艘舰摊成闸门样本；不写的字段按「干净、无近代化改修」。 */
const sample = (over) => ({
  rosterId: 1,
  formId: 1,
  name: 'x',
  lv: 1,
  panel: {},
  liveMax: {},
  aswKyouka: 0,
  clean: true,
  ...over,
})

// ---- ① 插值公式：拿真面板验零残差 ----

test('插值公式 base + ⌊(max−base)×Lv÷99⌋：真面板逐格零残差', () => {
  // 矢矧改二乙（形态 668）Lv141，账本 2026-08-06 实拍。端点取包里的 init 与
  // 游戏一手的 Lv99 上限；三项面板值分别 104 / 101 / 79。
  // Lv>99 不封顶，按同斜率继续长——婚舰的面板就是这么来的。
  for (const [key, init, max, panel] of [
    ['evasion', 42, 86, 104],
    ['asw', 30, 80, 101],
    ['los', 15, 60, 79],
  ]) {
    assert.equal(levelGrowth(init, max, 141), panel, `${key} 的插值与真面板对不上`)
  }
  // Lv99 处插值恒等于 max，与 init 无关——init 端的误差在高等级舰上正好归零，
  // 低等级舰才是闸门最敏感的地方（这条性质是「unverified 仍准出数」的第一条理由）
  for (const init of [0, 15, 42, 85]) assert.equal(levelGrowth(init, 86, 99), 86)
  // Lv1 处就是 init 本身
  assert.equal(levelGrowth(42, 86, 1), 42)
})

test('端点：持有形态一律以游戏一手的 Lv99 上限为准，包里那一格只兜未持有形态', () => {
  // 大和改二重（916）：包里 max 62（账本一手裁的），kcwiki 基座当时还是 60。
  const fromPack = growthEndpoints(pack, 916, 'evasion', null)
  assert.equal(fromPack.max, 62)
  assert.equal(fromPack.maxState, 'ledger')
  // 传了一手值就压过包，且印证档改判 ledger——哪怕一手与包不同
  const live = growthEndpoints(pack, 916, 'evasion', 63)
  assert.equal(live.max, 63, '一手没压过包里那一格')
  assert.equal(live.maxState, 'ledger')
  // 包没加载时不硬造：两头都是 null，`growthValueAt` 跟着 null
  const none = growthEndpoints(null, 916, 'evasion', null)
  assert.deepEqual(none, { init: null, initState: null, max: null, maxState: null })
  assert.equal(growthValueAt(none, 99), null)
  // 缺一头也算不了——不拿另一头凑，也不摆 0
  assert.equal(growthValueAt({ init: 25, initState: 'single', max: null, maxState: null }, 99), null)
})

// ---- ② 闸门：空槽舰零残差才过，残差非零就禁用并留台账 ----

test('干净样本零残差 → pass；`对潜`要先扣掉近代化改修 kyouka[6]', () => {
  const verdicts = calibrateGrowth(pack, [
    // 矢矧改二乙 Lv141（真值），当成空槽舰算
    sample({ rosterId: 7001, formId: 668, name: '矢矧改二乙', lv: 141,
      panel: { evasion: 104, asw: 101, los: 79 },
      liveMax: { evasion: 86, asw: 80, los: 60 } }),
  ])
  for (const key of SHIP_GROWTH_KEYS) {
    const verdict = verdicts.get(growthGateKey(668, key))
    assert.equal(verdict.state, 'pass', `${key} 没过闸`)
    assert.equal(verdict.residual, 0)
    assert.ok(growthReverseEnabled(verdict.state))
  }
  // 近代化改修只加在对潜面板上（api_kyouka = [火,雷,空,甲,运,耐,潜]）：
  // 同一艘舰改修 +5 时面板 106，扣掉才回到 101——不扣就会被当成「上限过时」误判 fail
  const withKyouka = calibrateGrowth(pack, [
    sample({ rosterId: 7001, formId: 668, name: '矢矧改二乙', lv: 141, aswKyouka: 5,
      panel: { evasion: 104, asw: 106, los: 79 },
      liveMax: { evasion: 86, asw: 80, los: 60 } }),
  ])
  assert.equal(withKyouka.get(growthGateKey(668, 'asw')).state, 'pass')
  // 反向：回避/索敌没有近代化改修项，面板多出来的就是真残差
  const wrong = calibrateGrowth(pack, [
    sample({ rosterId: 7001, formId: 668, name: '矢矧改二乙', lv: 141, aswKyouka: 5,
      panel: { evasion: 109, asw: 106, los: 79 },
      liveMax: { evasion: 86, asw: 80, los: 60 } }),
  ])
  assert.equal(wrong.get(growthGateKey(668, 'evasion')).state, 'fail')
})

test('残差非零 → fail：禁用反推，并把台账那几栏原样带出来', () => {
  // 账本 423 舰全量扫描里唯一的残差，一年多没变：第三〇号海防艦（638）Lv1
  // 回避 kcwiki 初始 39、实测 38 —— 是 kcwiki 那一格错，不是公式错。
  const verdicts = calibrateGrowth(pack, [
    // 面板/上限全部照抄账本：kaihi[38,77] taisen[30,65] sakuteki[2,11]，改修全 0
    sample({ rosterId: 7572, formId: 638, name: '第三〇号海防艦', lv: 1,
      panel: { evasion: 38, asw: 30, los: 2 },
      liveMax: { evasion: 77, asw: 65, los: 11 } }),
  ])
  const bad = verdicts.get(growthGateKey(638, 'evasion'))
  assert.equal(bad.state, 'fail')
  assert.equal(bad.expected, 39)
  assert.equal(bad.observed, 38)
  assert.equal(bad.residual, -1)
  // 「成长值疑似过时」台账要写的几栏：谁、哪一项、期望、实测、等级
  assert.equal(bad.rosterId, 7572)
  assert.equal(bad.name, '第三〇号海防艦')
  assert.equal(bad.lv, 1)
  assert.equal(bad.key, 'evasion')
  // 禁用：宁缺毋滥，不把成长上修误报成装备加成
  assert.equal(growthReverseEnabled('fail'), false)
  assert.equal(growthReverseEnabled('noEndpoint'), false)
  // 同一形态别的项不连坐
  assert.notEqual(verdicts.get(growthGateKey(638, 'asw')).state, 'fail')
})

test('同一形态多艘：任一艘干净样本 fail 就整格 fail，后来的 pass 不许翻案', () => {
  const order = (samples) => calibrateGrowth(pack, samples).get(growthGateKey(638, 'evasion')).state
  const good = sample({ rosterId: 1, formId: 638, name: 'a', lv: 1,
    panel: { evasion: 39 }, liveMax: { evasion: 77 } })
  const bad = sample({ rosterId: 2, formId: 638, name: 'b', lv: 1,
    panel: { evasion: 38 }, liveMax: { evasion: 77 } })
  assert.equal(order([bad, good]), 'fail', 'fail 之后又来一艘对得上的，就把禁用翻掉了')
  assert.equal(order([good, bad]), 'fail')
})

test('没有干净样本 → unverified：照常出数，但界面必须标出来', () => {
  // 这个形态手上每一艘都装着东西：右边那个「Σ装备加成 = 0」不是事实，
  // 只是我们那张预期表的说法——拿它当判据就成了自证，所以不判 pass。
  const verdicts = calibrateGrowth(pack, [
    sample({ rosterId: 9, formId: 916, name: '大和改二重', lv: 180, clean: false,
      panel: { evasion: 90, asw: 70, los: 95 },
      liveMax: { evasion: 62, asw: 48, los: 68 } }),
  ])
  const verdict = verdicts.get(growthGateKey(916, 'evasion'))
  assert.equal(verdict.state, 'unverified')
  assert.equal(verdict.residual, undefined, '没验过就不该有残差')
  // 准出数（否则带装备的舰整片关掉，而那正是这个功能唯一有意义的对象）
  assert.equal(growthReverseEnabled('unverified'), true)
  assert.equal(growthReverseEnabled('pass'), true)
})

test('端点缺一头 → noEndpoint：整项不出，不摆 0', () => {
  // Glorious改（740/741）三项 init 三张票都没有，是包里仅有的 6 个缺口
  assert.ok(SHIP_STAT_GAPS.some((gap) => gap.formId === 740 && gap.end === 'init'))
  assert.equal(pack.forms['740'].evasion.init, null)
  assert.equal(pack.forms['740'].evasion.initState, null, '值缺了却还报着印证档 = 空口白话')
  const verdicts = calibrateGrowth(pack, [
    sample({ rosterId: 5, formId: 740, name: 'Glorious改', lv: 60,
      panel: { evasion: 50 }, liveMax: { evasion: 80 } }),
  ])
  assert.equal(verdicts.get(growthGateKey(740, 'evasion')).state, 'noEndpoint')
})

// ---- ③ 官方公告播种的指名对象（4/7 上方修正）----

test('4/7 公告点名的四艘：三项的裁决与印证档逐格钉死', () => {
  // 公告只说「谁的哪一项 up」，不说加多少。按通道拆开读之后，
  // 只有 回避/対潜/索敌 是无声型（主数据看不见），才进闸门的风险区。
  const notices = SHIP_GROWTH_NOTICES.filter((one) => one.at === '2026-04-07')
  assert.equal(notices.length, 3)
  const serverSide = notices.flatMap((one) => one.forms.map((form) => [form.formId, one.serverStats]))
  const serverStatsOf = new Map(serverSide)
  // 矢矧改二/改二乙：対空max / 運max 都走 api_mst_ship，会自愈，不设防
  assert.deepEqual(serverStatsOf.get(663), [])
  assert.deepEqual(serverStatsOf.get(668), [])
  // 大和改二/改二重 回避、磯風乙改/浜風乙改 対潜：纯服务端项，闸门的风险区
  assert.deepEqual(serverStatsOf.get(911), ['evasion'])
  assert.deepEqual(serverStatsOf.get(916), ['evasion'])
  assert.deepEqual(serverStatsOf.get(557), ['asw'])
  assert.deepEqual(serverStatsOf.get(558), ['asw'])

  // 逐舰的出包值与它凭什么：
  //   大和改二重 回避 62 —— 账本一手 api_kaihi[1]（kcwiki 60 确认过时，wikiwiki 已跟到 62）
  assert.deepEqual(pack.forms['916'].evasion.max, 62)
  assert.equal(pack.forms['916'].evasion.maxState, 'ledger')
  //   其余三艘都不在籍，闸门裁不了 → §裁决二 取 wikiwiki，标 patched（待印证）
  for (const [formId, key, value, base] of [
    [911, 'evasion', 68, 67],
    [557, 'asw', 72, 71],
    [558, 'asw', 74, 73],
  ]) {
    assert.equal(pack.forms[`${formId}`][key].max, value)
    assert.equal(pack.forms[`${formId}`][key].maxState, 'patched', `${formId} 的印证档说过头了`)
    const patch = SHIP_STAT_PATCHES.find(
      (one) => one.formId === formId && one.key === key && one.end === 'max',
    )
    assert.ok(patch, `${formId} ${key} 没有补丁台账`)
    assert.equal(patch.value, value)
    assert.equal(patch.base, base, '补丁没钉住写下时 kcwiki 基座那一格 = 上游改了也不会自失效')
    assert.equal(patch.via, 'wikiwiki')
  }
})

test('补丁台账自带来路与依据，挂牌格明知故犯地留在基座值上', () => {
  for (const patch of SHIP_STAT_PATCHES) {
    assert.ok(['ledger', 'wikiwiki'].includes(patch.via), `${patch.formId} 的票来路不明`)
    assert.ok(patch.why.length >= 10, `${patch.formId} ${patch.key} 没写凭什么`)
    assert.ok(Number.isInteger(patch.value) && patch.value >= 0)
    assert.ok(patch.base === null || Number.isInteger(patch.base))
  }
  // §裁决二 那条规则唯一的已知反例：Nevada改 Mod.2 索敌，账本一手 52＝kcwiki，
  // wikiwiki 53 —— 由账本票直接裁掉，不落规则，且要留在挂牌清单里而不是被抹掉
  const nevada = SHIP_STAT_SUSPECT_CELLS.find((one) => one.formId === 936 && one.key === 'los')
  assert.ok(nevada, '规则的反例被从挂牌清单里抹掉了')
  assert.equal(nevada.kept, 52)
  assert.equal(nevada.wikiwiki, 53)
  assert.equal(pack.forms['936'].los.max, 52, '挂牌格的出包值该留在基座上')
})

// ---- ④ 与七项反推合流：干净舰与加成舰的对照 ----

test('干净舰与加成舰对照：同一形态，前者定标、后者读出加成', () => {
  const formId = 668
  const lv = 141
  const liveMax = { evasion: 86, asw: 80, los: 60 }
  const clean = sample({ rosterId: 1, formId, name: '矢矧改二乙', lv,
    panel: { evasion: 104, asw: 101, los: 79 }, liveMax })
  const verdicts = calibrateGrowth(pack, [clean])
  const gate = {}
  const base = {}
  for (const key of SHIP_GROWTH_KEYS) {
    const state = verdicts.get(growthGateKey(formId, key)).state
    gate[key] = state
    base[key] = growthReverseEnabled(state)
      ? growthValueAt(growthEndpoints(pack, formId, key, liveMax[key]), lv)
      : null
  }
  assert.deepEqual(base, { evasion: 104, asw: 101, los: 79 })

  // 同一形态的另一艘：装了一件（原始值 回避+2 対潜+7 索敌+3），且有 回避+3 / 索敌+1 的蓝字
  const observed = observedFitBonus({
    panel: {
      fire: 50, torpedo: 60, aa: 70, armor: 40,
      evasion: 104 + 2 + 3,
      asw: 101 + 7,
      los: 79 + 3 + 1,
    },
    base: { fire: 50, torpedo: 60, aa: 70, armor: 40, ...base },
    kyouka: [0, 0, 0, 0, 0, 0, 0],
    equips: [{ evasion: 2, asw: 7, los: 3, star: 0 }],
    gate,
  })
  assert.deepEqual(observed.stats, { evasion: 3, los: 1 })
  assert.deepEqual(observed.skipped, [], '过了闸的项不该被跳过')
  assert.deepEqual(observed.unverified, [], 'pass 的项不该再挂「没标定过」')
  assert.equal(observed.any, true)

  // 闸门禁用之后：那一项整行不出，且如实说得出为什么（不是「它没有加成」）
  const blocked = observedFitBonus({
    panel: { fire: 50, torpedo: 60, aa: 70, armor: 40, evasion: 109, asw: 108, los: 83 },
    base: { fire: 50, torpedo: 60, aa: 70, armor: 40, evasion: null, asw: 101, los: 79 },
    kyouka: [0, 0, 0, 0, 0, 0, 0],
    equips: [{ evasion: 2, asw: 7, los: 3, star: 0 }],
    gate: { evasion: 'fail', asw: 'pass', los: 'unverified' },
  })
  assert.deepEqual(blocked.skipped.map((one) => [one.key, one.gate]), [['evasion', 'fail']])
  assert.deepEqual(blocked.unverified, ['los'])
  assert.equal(blocked.rows.some((row) => row.key === 'evasion'), false)
})
