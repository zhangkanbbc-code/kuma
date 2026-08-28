// NPC 友军舰队参战那一场：伤害落到谁头上、流水怎么写、追击提示按哪份判别式说话。
//
// ════ 夹具是真包 ════
// `fixtures/battle-friendly-fleet.json` 是 2026-08-26 晚本机账本里的两对昼夜战报文
// （敌联合 + 友军要請），只留响应体的 `api_data`。入库前逐份脱敏体检：
// token / session / cookie / passwd / user_id / member_id / mail / nickname /
// starttime / @ / http / uuid 全部零命中，顶层键清点后确认剩下的全是战斗字段
// （api_deck_id 是舰队号 1-4，不是身份）。战斗响应体本来就不带凭据，这里是核过一遍。
//
// ════ 为什么要真包 ════
// 这一族 bug 全是「舰位坐标系解释错了」，而坐标系只有真包才带得全：
// api_active_deck、敌联合的两队 HP、友军段与主夜战段各自的下标基准。
// 手搓的报文会把作者当时的误解一起搓进去，正是这次要修的那种错。
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import battle from '../dist/main/mg/battle.js'
import timeline from '../dist/shared/battle-hp-timeline.js'

const { parseBattle, mergeNight } = battle
const { shipHpTimeline } = timeline

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PACKETS = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'battle-friendly-fleet.json'), 'utf8'),
)

const ctx = {
  fleetShips: () => Array(12).fill(null),
  masterName: (mstId) => `舰${mstId}`,
  masterMaxEq: () => [],
  combinedType: () => 1,
}

/** 昼战包 → 夜战包，照实时那条路走一遍（store.ts 的 onDayBattle / onNightBattle）。 */
const replay = (pair) => {
  const day = parseBattle(pair.day.path.replace('/kcsapi', ''), pair.day.data, ctx, 1)
  return mergeNight(day, pair.night.data, ctx, 2)
}

const hpEnds = (ships) => ships.map((ship) => ship.hpEnd)

test('友军的炮击落在敌护卫身上，不被 api_active_deck 折到主力头上', () => {
  const view = replay(PACKETS.friendlyNight)
  // 这一场 api_active_deck = [2,1]：我方护卫出阵、敌方主力出阵。
  assert.deepEqual(view.activeDeck, [2, 1])

  const friendly = view.attacks.filter((attack) => attack.phase === 'friendly')
  assert.ok(friendly.length > 0, '友军段一击都没解析出来')

  // 报文里第一击的 api_df_list 是 [8,5]：8 = 敌护卫 #2（绝对下标），不是主力 #2。
  // 旧实现按 deck=1 做「≥6 减 6」，159 伤全落到主力 #2 头上——而主力 #2 昼战就沉了，
  // 于是这一击在血条上完全不见影：这正是用户实报的「友军伤害没反馈」。
  const bigHit = friendly
    .flatMap((attack) => (attack.side === 2 ? attack.hits : []))
    .find((hit) => hit.damage === 159)
  assert.ok(bigHit, '友军那一击 159 伤没解析出来')
  assert.equal(bigHit.target, 8, '159 伤该落在敌护卫 #2（绝对下标 8）')
  assert.equal(bigHit.sunk, true, '敌护卫 #2 昼战后只剩 15 HP，这一击必沉')
  assert.equal(view.eShips.find((ship) => ship.index === 8).hpEnd, 0)

  // 反过来钉住「没被挪到主力 #2」：主力 #2 昼战就沉了，友军段不该再动它一下。
  const ontoMain2 = friendly
    .flatMap((attack) => (attack.side === 2 ? attack.hits : []))
    .filter((hit) => hit.target === 2)
  assert.equal(ontoMain2.length, 0, '友军段不该有任何一击落在敌主力 #2 上')
})

test('友军段里敌方的反击，攻击舰也按绝对下标记（装备指纹核过）', () => {
  const view = replay(PACKETS.friendlyNight)
  const info = PACKETS.friendlyNight.night.data
  // api_si_list[1] = [1644,1644] 只在 api_eSlot_combined[0] 里有 → 攻击舰是敌护卫 #0，
  // 绝对下标 6。旧实现会把它记成主力 #0。这条断言连同下面的指纹核验一起，
  // 是「友军段用绝对下标」这个结论的原始证据。
  const si = info.api_friendly_battle.api_hougeki.api_si_list[1]
  assert.deepEqual(si, [1644, 1644])
  assert.ok(
    info.api_eSlot_combined[0].includes(1644),
    '1644 该在敌护卫 #0 的装备里',
  )
  assert.ok(
    !info.api_eSlot[0].includes(1644),
    '1644 不该在敌主力 #0 的装备里——不然这条指纹就分不出队',
  )
  const counterAttack = view.attacks.find(
    (attack) => attack.phase === 'friendly' && attack.side === 1 && attack.attacker === 6,
  )
  assert.ok(counterAttack, '敌方在友军段的反击该记在绝对下标 6（敌护卫 #0）')

  // 同一段里另一击的攻击舰是敌主力 #1（api_si_list[5] = [1581,1583] 只在 api_eSlot[1] 里）。
  // 两队的舰在同一段里各按各的绝对下标出现，正是「不是队内号」的实证。
  assert.ok(info.api_eSlot[1].includes(1581) && info.api_eSlot[1].includes(1583))
  assert.ok(
    view.attacks.some(
      (attack) => attack.phase === 'friendly' && attack.side === 1 && attack.attacker === 1,
    ),
    '敌主力 #1 的那一击该记在绝对下标 1',
  )
})

test('62-4 Boss 夜战：敌旗舰重放到 319/800，与游戏画面读数一致', () => {
  const view = replay(PACKETS.bossNight)
  // 真值来自用户人肉读游戏画面（2026-08-26 晚，最后开火结束时）：
  // 敌旗舰 319/800 中破。旧实现给的是 128/800——多扣的 191 = 友军那一击的 66+125，
  // 它本该落在敌护卫 #0（绝对下标 6）身上，被 api_active_deck 的换算折到了主力 #0。
  const flagship = view.eShips.find((ship) => ship.index === 0)
  assert.equal(flagship.hpEnd, 319)
  assert.equal(flagship.hpMax, 800)

  // 其余十一舰当时也全部核过，一起钉住：改坐标系时最容易「修好一个错开另一个」。
  assert.deepEqual(hpEnds(view.eShips), [319, 277, 0, 0, 366, 460, 0, 0, 0, 0, 0, 0])

  // 191 的去向：友军的瑞云夜袭打在敌护卫 #0 上，把它打沉了（用户亲眼看到友军击沉护卫）。
  const ontoEscortFlagship = view.attacks
    .filter((attack) => attack.phase === 'friendly' && attack.side === 2)
    .flatMap((attack) => attack.hits)
    .filter((hit) => hit.target === 6)
  assert.equal(
    ontoEscortFlagship.reduce((sum, hit) => sum + hit.damage, 0),
    191,
  )
  assert.equal(view.eShips.find((ship) => ship.index === 6).hpEnd, 0)
})

test('友军打出的伤害进得了敌舰血条时间轴', () => {
  const view = replay(PACKETS.friendlyNight)
  const friendlyStage = view.stages.find((stage) => stage.phase === 'friendly')
  assert.ok(friendlyStage, '友军段没进阶段表')

  // 敌主力 #5 在友军段挨了 40+76+87+35+100 = 338：血条图要能画出这一段的落差，
  // 而不是等到夜战段才一起掉。时间轴按 stage 分点，友军段自成一点。
  const target = view.eShips.find((ship) => ship.index === 5)
  const track = shipHpTimeline(view.attacks, target, true, false)
  assert.equal(track.mismatch, false, '重放末值与结算 hpEnd 对不上')
  const atFriendly = track.points.find((point) => point.stage === friendlyStage.order)
  assert.ok(atFriendly, '友军段在敌主力 #5 的血量轨迹上没有落点')
  assert.equal(atFriendly.before - atFriendly.hp, 338)
})

test('友军装备读的是大写 S 的 api_Slot', () => {
  const view = replay(PACKETS.friendlyNight)
  const info = PACKETS.friendlyNight.night.data.api_friendly_info
  // 报文里是 api_Slot（大写 S），与我方 api_slot / 敌方 api_eSlot 都不同名。
  assert.ok(Array.isArray(info.api_Slot))
  assert.equal(info.api_slot, undefined)
  assert.ok(
    view.friendShips.every((ship) => ship.equipment.length > 0),
    '友军舰的装备整列是空的——大概率又读回了小写那个键',
  )
})

test('api_production_type 原值入账，但语义未定所以 UI 不标', () => {
  assert.equal(replay(PACKETS.friendlyNight).friendlyProductionType, 2)
  assert.equal(replay(PACKETS.bossNight).friendlyProductionType, 3)

  // 本机账本穷举下来只有这两条带 api_friendly_info 的报文，值是 2 与 3，
  // 而后一场编成更大（多一艘酒匂改）。用户亲证前一场是強友軍要請，
  // 所以「2 = 強力」讲不通——这个字段看着是在标编成变体。
  // 曾打算按 `=== 2` 挂「强友军」标，被第二条样本证伪：那会把小的那次标成强。
  // 这条护栏钉的是**不许在拿到通常友军的对照样本之前把标加回去**。
  const source = fs.readFileSync(
    path.join(ROOT, 'src', 'renderer', 'modules', 'di.ts'),
    'utf8',
  )
  assert.ok(
    !source.includes('强友军'),
    'di.ts 又出现了「强友军」标：api_production_type 的档位语义至今只有 2 与 3 两个样本、' +
      '且更大的那次是 3，加标之前先拿到「确证是通常友军」的对照样本',
  )
})
