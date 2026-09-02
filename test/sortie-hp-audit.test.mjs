// 出击途中的权威 HP 对账：解析漏报了大破，权威值到达时要把它抓出来并补喊一声。
//
// 危险方向只有一个——**本地说没大破、权威说大破**。反过来（误报）只是虚惊，
// 补喊一句「其实她没破」除了添乱没有别的作用，所以那一向只修数、不出声。
//
// 时序实测（这套东西到底挡得住什么）写在 src/shared/sortie-hp-audit.ts 的头注里。
// 一句话：ship_deck 是进击动作自己带出来的，它挡不住这一步，挡的是下一步。
//
// 三段都跑真代码：
// · 判据本体直接 import dist/shared/sortie-hp-audit.js；
// · 铭侧的对账与 ship_deck 归约器由 fixtures/store-hp-audit.mjs 从 store.ts 切片真编译；
// · 铃侧的补发由 fixtures/detect-taiha-notice.mjs 从 lg.ts 切片真编译。
// 一条源码正则都不写：「危险方向判反了」「去重豁免装在错的那一层」这两个错法，
// 字面看着都对，只有连着跑几场才现形。
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

import audit from '../dist/shared/sortie-hp-audit.js'
import {
  reset,
  runAudit,
  runShipDeck,
  shipDeckBody,
  shipOf,
  stateOf,
  storeSource,
  warnings,
} from './fixtures/store-hp-audit.mjs'
import {
  fShipsWithTaiha,
  resetSent,
  returnToPort,
  runDetect,
  sortieOf,
} from './fixtures/detect-taiha-notice.mjs'

const { auditSortieHp } = audit

// 战斗视图里的一艘舰，只留判据会读的那几个键。
const bs = (patch = {}) => ({
  index: 0,
  rosterId: 100,
  name: '我舰',
  hpEnd: 40,
  hpMax: 40,
  sunk: false,
  escaped: false,
  ...patch,
})

/** 权威侧：`{ [rosterId]: nowhp }` → 查询函数。 */
const authority = (map) => (id) => map[id]

// ════════ 一、判据本体 ════════

test('解析值与权威值相同：一条都不报', () => {
  const out = auditSortieHp([bs({ hpEnd: 31 })], authority({ 100: 31 }))
  assert.deepEqual(out, [])
})

test('漏报大破（本地 50% → 权威 20%）：报出来，且标成危险方向', () => {
  const out = auditSortieHp([bs({ hpEnd: 20, hpMax: 40 })], authority({ 100: 8 }))
  assert.equal(out.length, 1)
  assert.equal(out[0].parsed, 20)
  assert.equal(out[0].authoritative, 8)
  assert.equal(out[0].dangerous, true)
})

test('误报大破（本地 20% → 权威 50%）：照样报不一致，但不是危险方向', () => {
  const out = auditSortieHp([bs({ hpEnd: 8, hpMax: 40 })], authority({ 100: 20 }))
  assert.equal(out.length, 1)
  assert.equal(out[0].dangerous, false)
})

test('本地本来就说大破、只是数值差一点：不是危险方向', () => {
  // 10/40 = 25% 已经在线上；权威 5/40 更低，但玩家早就被警告过了。
  const out = auditSortieHp([bs({ hpEnd: 10, hpMax: 40 })], authority({ 100: 5 }))
  assert.equal(out.length, 1)
  assert.equal(out[0].dangerous, false)
})

test('大破线取 25%：正好 25% 算大破，高一丝不算', () => {
  // 本地 26/40（65%）→ 权威 10/40（正好 25%）：踩线即大破，危险方向成立。
  assert.equal(auditSortieHp([bs({ hpEnd: 26, hpMax: 40 })], authority({ 100: 10 }))[0].dangerous, true)
  // 本地 26/40 → 权威 11/40（27.5%）：没到线，只是掉血。
  assert.equal(auditSortieHp([bs({ hpEnd: 26, hpMax: 40 })], authority({ 100: 11 }))[0].dangerous, false)
})

test('已沉、已退避、敌我不分的那几艘一律跳过', () => {
  const ships = [
    bs({ rosterId: 100, sunk: true, hpEnd: 30 }),
    bs({ rosterId: 101, escaped: true, hpEnd: 30 }),
    bs({ rosterId: null, hpEnd: 30 }),
  ]
  assert.deepEqual(auditSortieHp(ships, authority({ 100: 1, 101: 1, 102: 1 })), [])
})

test('权威侧查不到这艘舰：跳过，不当成不一致', () => {
  // 局部报文本来就只覆盖出击编成，「这份报文没提她」不等于「我们算错了」。
  assert.deepEqual(auditSortieHp([bs({ hpEnd: 30 })], authority({})), [])
})

// ════════ 二、真流水对照钉子 ════════
//
// 2026-08-26～27 账本里 161 场 ship_deck 全量重放过一遍，逐舰对账**零不一致**。
// 这里钉住其中两场：一场贴着大破线（25.8%，判据线偏一点就会红），
// 一场是当天 62-5。它们的作用是「不误伤」——绝大多数场次必须零动作。

const REAL = JSON.parse(
  fs.readFileSync(fileURLToPath(new URL('./fixtures/sortie-hp-audit-real.json', import.meta.url)), 'utf8'),
)

test('真流水：解析值与游戏自报耐久逐舰相同，对账零动作', () => {
  assert.ok(REAL.length >= 2, '钉子少了；真流水样本不该被删空')
  for (const round of REAL) {
    const hp = Object.fromEntries(round.shipDeck.map((s) => [s.api_id, s.api_nowhp]))
    assert.deepEqual(
      auditSortieHp(round.fShips, authority(hp)),
      [],
      `${round.at} map ${round.map} cell ${round.cell} 不该有不一致`,
    )
  }
})

test('真流水：那一场确实有人挂彩、且有人贴着大破线（钉子本身没退化成全员满血）', () => {
  const sharp = REAL[0]
  const hurt = sharp.fShips.filter((s) => s.hpEnd < s.hpMax)
  assert.ok(hurt.length >= 3, '这一场挂彩的太少，钉不住「有伤也不误报」')
  const lowest = Math.min(...sharp.fShips.map((s) => s.hpEnd / s.hpMax))
  assert.ok(lowest > 0.25 && lowest < 0.27, `最低血比应当贴着大破线，实际 ${lowest}`)
})

// ════════ 三、铭：ship_deck 到达时的对账 ════════

/** 一支六人队；`taihaAt` 那几位在**权威侧**是大破，解析侧照 `parsedHp` 给。 */
const fleet = () => Array.from({ length: 6 }, (_unused, i) => shipOf(i))

test('解析漏报大破 + ship_deck 到达：战斗视图被改回权威值，并推一格更正计数', () => {
  const fShips = fleet()
  fShips[2] = shipOf(2, { hpEnd: 30 }) // 解析说 30/40 = 75%，没破
  reset({ fShips })
  const sections = runShipDeck(shipDeckBody({ 100: 40, 101: 40, 102: 8, 103: 40, 104: 40, 105: 40 }))

  const s = stateOf()
  assert.equal(s.sortie.battle.fShips[2].hpEnd, 8, '战斗视图要就地纠正成权威值')
  assert.equal(s.sortie.taihaCorrections, 1, '危险方向命中要推更正计数')
  assert.ok(sections.includes('sortie'), '要派发 sortie，镝与铃才会重跑')
  assert.ok(sections.includes('ships'))
})

test('哨兵日志：记下舰名、解析值、权威值与解析路径', () => {
  const fShips = fleet()
  fShips[2] = shipOf(2, { hpEnd: 30 })
  reset({ fShips, battle: { kind: 'day', hasNight: true } })
  runShipDeck(shipDeckBody({ 100: 40, 101: 40, 102: 8, 103: 40, 104: 40, 105: 40 }))

  const lines = warnings()
  assert.equal(lines.length, 1)
  assert.match(lines[0], /我舰3/)
  assert.match(lines[0], /我们 30/)
  assert.match(lines[0], /游戏 8\/40/)
  assert.match(lines[0], /漏报大破/)
  assert.match(lines[0], /6-5 节点 12/)
  assert.match(lines[0], /day\+night/, '解析路径要记：夜战合并是另一条代码路径')
})

test('哨兵日志与对账台账：不一致落进 battleReconciliation，带舰名', () => {
  const fShips = fleet()
  fShips[1] = shipOf(1, { hpEnd: 30 })
  reset({ fShips })
  runShipDeck(shipDeckBody({ 100: 40, 101: 8, 102: 40, 103: 40, 104: 40, 105: 40 }))

  const rec = stateOf().battleReconciliation
  assert.equal(rec.mismatched, 1)
  assert.equal(rec.records.length, 1)
  const item = rec.records[0].discrepancies[0]
  assert.equal(item.kind, 'hp')
  assert.equal(item.ours, 30)
  assert.equal(item.game, 8)
  assert.equal(item.who, '我舰2')
  assert.equal(rec.records[0].map, 65, '海域按 area*10+no 记')
})

test('解析正确：零动作零日志——不改视图、不推计数、不派发 sortie', () => {
  const fShips = fleet()
  fShips[3] = shipOf(3, { hpEnd: 12 }) // 解析说她 12/40（已经是大破），权威也说 12
  reset({ fShips })
  const sections = runShipDeck(shipDeckBody({ 100: 40, 101: 40, 102: 40, 103: 12, 104: 40, 105: 40 }))

  assert.deepEqual(sections, ['ships', 'decks'], '一致时不该多派发任何 section')
  assert.equal(stateOf().sortie.taihaCorrections, 0)
  assert.deepEqual(warnings(), [])
  assert.deepEqual(stateOf().battleReconciliation.records, [])
  assert.equal(stateOf().battleReconciliation.checked, 1, '查过了要计数，只是没话说')
})

test('误报大破（权威其实更健康）：修数、记日志，但不补喊', () => {
  const fShips = fleet()
  fShips[0] = shipOf(0, { hpEnd: 8 }) // 解析说旗舰大破
  reset({ fShips })
  runShipDeck(shipDeckBody({ 100: 30, 101: 40, 102: 40, 103: 40, 104: 40, 105: 40 }))

  assert.equal(stateOf().sortie.battle.fShips[0].hpEnd, 30)
  assert.equal(stateOf().sortie.taihaCorrections, 0, '误报只是虚惊，不该补喊')
  assert.equal(warnings().length, 1, '但哨兵照样记——这是抓解析 bug 的证据')
  assert.doesNotMatch(warnings()[0], /漏报大破/)
})

test('演习不对账：那边的伤害本来就不持久', () => {
  const fShips = fleet()
  fShips[2] = shipOf(2, { hpEnd: 30 })
  reset({ fShips, sortie: { practice: true }, battle: { practice: true } })
  const sections = runShipDeck(shipDeckBody({ 100: 40, 101: 40, 102: 8, 103: 40, 104: 40, 105: 40 }))
  assert.deepEqual(sections, ['ships', 'decks'])
  assert.deepEqual(warnings(), [])
})

test('不在出击中：ship_deck 只是回港看编成，不对账', () => {
  const fShips = fleet()
  fShips[2] = shipOf(2, { hpEnd: 30 })
  reset({ fShips, sortie: { active: false } })
  const sections = runShipDeck(shipDeckBody({ 100: 40, 101: 40, 102: 8, 103: 40, 104: 40, 105: 40 }))
  assert.deepEqual(sections, ['ships', 'decks'])
  assert.deepEqual(warnings(), [])
})

test('回港那一支（announce=false）：照样修数记日志，但一句都不喊', () => {
  const fShips = fleet()
  fShips[4] = shipOf(4, { hpEnd: 30 })
  reset({ fShips })
  // 账本已被权威值盖过（port 里 applyShipUpdates 先跑），这里直接调对账本体。
  stateOf().player.ships[104].nowhp = 8
  const sections = runAudit(9000, false)

  assert.equal(stateOf().sortie.battle.fShips[4].hpEnd, 8)
  assert.equal(stateOf().sortie.taihaCorrections, 0, '舰队已经到家，「继续前进会被击沉」说的不是这个局面')
  assert.equal(warnings().length, 1)
  assert.ok(sections.includes('sortie'))
})

test('接线：port 归约器仍然调对账，且传的是 false', () => {
  // 那个归约器本体牵着入渠/泊地修理/活动海域一大串，切进来要补十几个跟对账
  // 毫无关系的桩。行为由上一条钉（真的 runSortieHpAudit(_, false)），
  // 这一条只盯「port 里那一行还在」——两条合起来才完整。
  assert.match(
    storeSource,
    /sections\.push\(\.\.\.runSortieHpAudit\(ts, false\)\)/,
    'port 归约器里的对账调用不见了，或者 announce 被改成了 true',
  )
})

// ════════ 四、铃：补发那一声 ════════

/** 打一场：大破名单由 `taihaIndexes` 决定；`corrections` 是铭侧推到的更正计数。 */
const fight = (battleCount, taihaIndexes, { corrections = 0, count = 12, ...patch } = {}) =>
  runDetect(
    sortieOf({
      battleCount,
      currentCell: battleCount,
      taihaCorrections: corrections,
      battle: { fShips: fShipsWithTaiha(taihaIndexes, count) },
      ...patch,
    }),
  )

test('补发：正文前缀「修正：」，标题仍走原来那三档', () => {
  resetSent()
  returnToPort()
  // 第 1 战解析说谁都没破 → 一声不吭
  assert.equal(fight(1, []).length, 0)
  // 权威值到达，铭把 index 3 纠正成大破并推了一格
  const out = fight(1, [3], { corrections: 1 })
  assert.equal(out.length, 1)
  assert.match(out[0].title, /我舰4大破 · 撤退/, '标题按三档沿用，不另起一套')
  assert.ok(out[0].detail.startsWith('修正：'), `正文要以「修正：」开头，实际「${out[0].detail}」`)
  assert.match(out[0].detail, /3-5 第 1 战/)
})

test('补发走的是同一套三档：旗舰被纠正成大破 → forced', () => {
  resetSent()
  returnToPort()
  const out = fight(1, [0], { corrections: 1 })
  assert.equal(out.length, 1)
  assert.match(out[0].title, /旗舰我舰1大破 · 本战结束后强制返航/)
  assert.ok(out[0].detail.startsWith('修正：'))
})

test('补发走的是同一套三档：二队旗舰被纠正成大破 → protected（她不会沉）', () => {
  resetSent()
  returnToPort()
  const out = fight(1, [6], { corrections: 1 })
  assert.equal(out.length, 1)
  assert.match(out[0].title, /二队旗舰我舰7大破/)
  assert.match(out[0].detail, /无击沉风险/)
  assert.ok(out[0].detail.startsWith('修正：'))
})

test('更正豁免出击级去重：protected 已经说过一次，更正照样要响', () => {
  resetSent()
  returnToPort()
  // 第 1 战正常报出 protected
  assert.equal(fight(1, [6]).length, 1)
  // 第 2 战她还在名单里 → 原去重照旧压住
  assert.equal(fight(2, [6]).length, 0)
  // 第 2 战对账发现还漏了别人？不——这一格就是同一位，但这是**更正**，必须响
  const fixed = fight(2, [6], { corrections: 1 })
  assert.equal(fixed.length, 1, 'protected 的出击级去重要给更正让路')
  assert.ok(fixed[0].detail.startsWith('修正：'))
})

test('更正只响一次：同一格更正再跑几遍探测都不重复', () => {
  resetSent()
  returnToPort()
  assert.equal(fight(1, [3], { corrections: 1 }).length, 1)
  assert.equal(fight(1, [3], { corrections: 1 }).length, 0, '同一次更正不该说第二遍')
  assert.equal(fight(1, [3], { corrections: 1 }).length, 0)
})

test('零追发：没有更正时，原来的单场去重一个字都没松', () => {
  resetSent()
  returnToPort()
  assert.equal(fight(1, [3]).length, 1)
  assert.equal(fight(1, [3]).length, 0)
  assert.equal(fight(1, [3]).length, 0)
})

test('回港再出门：新一趟的第一次更正照样响（去重键含出击标识）', () => {
  resetSent()
  returnToPort()
  assert.equal(fight(1, [3], { corrections: 1 }).length, 1)
  returnToPort()
  // 新出击：startTs 变了，计数从 1 重新起算
  const next = runDetect(
    sortieOf({
      startTs: 2000,
      battleCount: 1,
      taihaCorrections: 1,
      battle: { fShips: fShipsWithTaiha([3], 12) },
    }),
  )
  assert.equal(next.length, 1, '换了一趟出击，同样是第 1 次更正，必须重新可发')
  assert.ok(next[0].detail.startsWith('修正：'))
})

test('没经过归港那一帧就开下一趟：更正照样响', () => {
  // 这一支是两层豁免真正会被用到的地方。直接开下一趟时 taihaSeen 没被清空，
  // 而新出击的第 1 战若还是同一批舰，去重签名与上一趟的第 1 战**一模一样**——
  // 单场去重会把这条更正整个吞掉。出击标识（startTs）在这里是唯一的分辨依据。
  resetSent()
  returnToPort()
  assert.equal(fight(1, [3], { corrections: 1 }).length, 1)
  const next = runDetect(
    sortieOf({
      startTs: 2000, // 新一趟，但中间没有 active=false 的那一帧
      battleCount: 1,
      taihaCorrections: 1,
      battle: { fShips: fShipsWithTaiha([3], 12) },
    }),
  )
  assert.equal(next.length, 1, '同签名 + 新出击的更正被吞了')
  assert.ok(next[0].detail.startsWith('修正：'))
})

test('同一场里签名没变但更正到了：单场去重要给它让路', () => {
  // 契约本身。铭当前的危险方向必然让大破名单**变大**（有人越过了线），
  // 所以签名照例会变；这一条钉的是「万一签名没变」时的保证——
  // 去重方案将来若改成按战次/按出击记键，更正不能因此被静默吞掉。
  resetSent()
  returnToPort()
  assert.equal(fight(2, [3]).length, 1)
  assert.equal(fight(2, [3]).length, 0, '没有更正时照旧压住')
  assert.equal(fight(2, [3], { corrections: 1 }).length, 1, '更正必须穿过单场去重')
})
