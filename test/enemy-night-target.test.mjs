// 敌联合舰队：夜战会打到哪一队。
//
// 这一份**直接 import 真模块**（dist/shared/enemy-night-target.js）并真渲染那条横幅，
// 断言的是真代码的行为：阈值写成 >3、大破忘了记 0 分、PT 系数漏掉、
// 「全灭」那条短路删掉，这里逐条都会红——正是源码正则拦不住的那一类。
//
// 机制出处逐条记在 src/shared/enemy-night-target.ts 的头注里（带来源与免责）。
// **判别式是暂定式、有例外观测**，所以这里也一并钉住「文案只许说预计」。
import assert from 'node:assert/strict'
import test from 'node:test'

import nightTarget from '../dist/shared/enemy-night-target.js'
import { battleOf, renderBlockedBossNight, shipOf, sortieOf } from './fixtures/render-di-battle.mjs'

const { enemyNightTargetOf, isPtShipName } = nightTarget

/** hpMax 固定 100，比例即百分数，好把「恰好中破线」这种边界写清楚。 */
const foe = (hp, over = {}) => ({ sunk: false, hp, hpMax: 100, flagship: false, pt: false, ...over })

test('敌二队全灭：夜战必打一队（这条是确定机制，不进算分）', () => {
  assert.equal(enemyNightTargetOf([foe(0, { sunk: true, flagship: true }), foe(0, { sunk: true })]), 'main')
  // 敌方根本不是联合编成时同解
  assert.equal(enemyNightTargetOf([]), 'main')
})

test('二队五艘无伤：打二队', () => {
  // 旗舰存活 +1，五艘各 +1 = 6.0 ≥ 3
  const escort = [foe(100, { flagship: true }), foe(100), foe(100), foe(100), foe(100)]
  assert.equal(enemyNightTargetOf(escort), 'escort')
})

test('旗舰已沉 + 两艘中破：1.4 分，打一队', () => {
  // 旗舰沉 → 不加那 +1，且她自己记 0；两艘中破 0.7×2 = 1.4 < 3
  const escort = [foe(0, { sunk: true, flagship: true }), foe(40), foe(40)]
  assert.equal(enemyNightTargetOf(escort), 'main')
})

test('恰好 3.0 分：打二队（阈值是「≥3」，不是「>3」）', () => {
  // 旗舰存活 +1，旗舰自身无伤 +1，僚舰无伤 +1 = 3.0
  assert.equal(enemyNightTargetOf([foe(100, { flagship: true }), foe(100)]), 'escort')
})

test('大破不计分：残存两艘全大破 → 打一队', () => {
  // 旗舰存活 +1，但两艘都在大破档各记 0 = 1.0 < 3
  assert.equal(enemyNightTargetOf([foe(20, { flagship: true }), foe(20)]), 'main')
})

test('PT 的中破系数是 0.5，足以把总分压到阈值以下', () => {
  // 旗舰存活 +1 + 旗舰无伤 +1 = 2.0，再加三艘中破：
  // 普通舰 0.7×3 = 2.1 → 4.1 ≥ 3 打二队；PT 0.5×3 = 1.5 → 3.5… 还是过线，
  // 所以取两艘：普通 2.0+1.4 = 3.4 ≥ 3 → escort；PT 2.0+1.0 = 3.0 → 也恰好过线。
  // 真正能分开的是「旗舰自身中破」那种：旗舰存活 +1 + 旗舰中破 + 两僚舰中破。
  const withCoef = (pt) => [
    foe(40, { flagship: true, pt }),
    foe(40, { pt }),
    foe(40, { pt }),
  ]
  // 普通：1 + 0.7×3 = 3.1 ≥ 3 → 打二队
  assert.equal(enemyNightTargetOf(withCoef(false)), 'escort')
  // PT：1 + 0.5×3 = 2.5 < 3 → 打一队。系数漏掉就会误报成「接触不到」
  assert.equal(enemyNightTargetOf(withCoef(true)), 'main')
})

test('小破与无伤同为满分，中破才降档', () => {
  // 小破（>50%）：1 + 1 + 1 = 3.0 → escort
  assert.equal(enemyNightTargetOf([foe(60, { flagship: true }), foe(60)]), 'escort')
  // 中破（≤50%）：1 + 0.7 + 0.7 = 2.4 → main
  assert.equal(enemyNightTargetOf([foe(50, { flagship: true }), foe(50)]), 'main')
})

test('PT 名认的是主数据原名里的词干', () => {
  // 随包资料 kcwiki-localization 里 mstId 1637 起 ja 与 zh 都是「PT小鬼群」
  assert.equal(isPtShipName('PT小鬼群'), true)
  assert.equal(isPtShipName('駆逐イ級'), false)
  assert.equal(isPtShipName(null), false)
  assert.equal(isPtShipName(undefined), false)
})

// ---- 镝的夜战阻断条：判别式有没有真接上 ----

/** Boss 格、昼战刚打完、battleresult 还没到——横幅只在这个窗口出声。 */
const atBossBefore = (eShips) =>
  sortieOf({
    bossCell: 3,
    currentCell: 3,
    nodes: [{ cell: 3, eventId: 5 }],
    battle: battleOf({ kind: 'day', hasNight: false, result: null, eShips }),
  })

/** 敌联合：0–5 一队、6–11 二队；只列出要摆的那几艘。 */
const enemyFleet = (escortHps, flagshipHp = 100) => {
  const main = Array.from({ length: 6 }, (_, i) => ({
    ...shipOf(i, `敌舰${i + 1}`),
    fleet: 'main',
    position: i,
    hpEnd: i === 0 ? flagshipHp : 50,
    hpMax: 100,
    name: i === 0 ? '戦艦棲姫' : `敌舰${i + 1}`,
    sunk: i === 0 ? flagshipHp <= 0 : false,
  }))
  const escort = escortHps.map((hp, i) => ({
    ...shipOf(6 + i, `护卫${i + 1}`),
    fleet: 'escort',
    position: i,
    hpEnd: hp,
    hpMax: 100,
    name: `护卫${i + 1}`,
    sunk: hp <= 0,
  }))
  return [...main, ...escort]
}

test('敌二队全灭：不出横幅（夜战必达旗舰，没有要提示的决策）', () => {
  assert.equal(renderBlockedBossNight(atBossBefore(enemyFleet([0, 0, 0]))), null)
})

test('敌方不是联合编成：不出横幅', () => {
  assert.equal(renderBlockedBossNight(atBossBefore(enemyFleet([]))), null)
})

test('二队仍有战力：用估算标注无法攻击主力，措辞不写成确定', () => {
  const html = renderBlockedBossNight(atBossBefore(enemyFleet([100, 100, 100])))
  assert.match(html, /敌护卫仍有战力 · 夜战估算无法攻击 戦艦棲姫/)
  assert.match(html, /夜战将消耗弹药/)
  assert.match(html, /撤退可用<\/span>/)
  assert.match(html, /verdict v-warn/)
  // 判别式非官方、有例外观测，一律只说「估算」
  assert.match(html, /估算/)
})

test('二队只剩两艘大破：反过来提示这是斩杀机会', () => {
  // 旗舰存活 +1 + 两艘大破各 0 = 1.0 < 3 → 打一队。
  // 旧写法「还有活的就接触不到」会在这里给出**相反**的建议。
  const html = renderBlockedBossNight(atBossBefore(enemyFleet([20, 20])))
  assert.match(html, /敌护卫已残破 · 夜战估算可攻击 戦艦棲姫/)
  assert.match(html, /夜战可攻击主力旗舰/)
  assert.match(html, /夜战机会<\/span>/)
  assert.match(html, /verdict v-cyan/)
})

test('敌一队旗舰已沉时不出横幅：没有可斩杀的目标了', () => {
  assert.equal(renderBlockedBossNight(atBossBefore(enemyFleet([100, 100, 100], 0))), null)
})

test('battleresult 已到 / 已打过夜战 / 非 Boss 格：都不出横幅', () => {
  const eShips = enemyFleet([100, 100, 100])
  const withPatch = (patch) =>
    sortieOf({
      bossCell: 3,
      currentCell: 3,
      nodes: [{ cell: 3, eventId: 5 }],
      battle: battleOf({ kind: 'day', hasNight: false, result: null, eShips, ...patch }),
    })
  assert.equal(renderBlockedBossNight(withPatch({ result: { rank: 'S' } })), null)
  assert.equal(renderBlockedBossNight(withPatch({ hasNight: true })), null)
  const offBoss = sortieOf({
    bossCell: 3,
    currentCell: 2,
    nodes: [{ cell: 2, eventId: 4 }],
    battle: battleOf({ kind: 'day', hasNight: false, result: null, eShips }),
  })
  assert.equal(renderBlockedBossNight(offBoss), null)
})
