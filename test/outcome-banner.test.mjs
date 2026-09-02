// 战果槽的两件事：
//
// ① **基地防空不顶掉路径预测**（用户 2026-08-26 实报并拍板）。基地空袭是路上发生的事
//    （api_req_map/next 顺带捎来 api_destruction_battle），玩家仍在前往下一点的途中；
//    防空打完游戏直接进选阵型，再没有报文能把「前往 X 点」推回来——一被顶掉就是永久丢失。
//    定的是：防空摞在预测**上方**，两者同屏。
//
// ② **追击提示接敌联合的夜战判别式**。这一条 2026-08-11 按「护卫没杀完就打不到主力」
//    写死过，用户 2026-08-26 纠正该口径、警告条已改用 shared/enemy-night-target，
//    这处漏了：当晚实战敌护卫只剩 1 舰小破（判别式 2.0 < 3，应直击主力），
//    提示却还在说主力够不着。
//
// 断言对着产物 HTML；判别式引真的那一份（桩成「有活口就打不到」等于把 bug 复活）。
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  battleOf,
  renderHeadingBanner,
  renderOutcomeBanner,
  shipOf,
  sortieOf,
} from './fixtures/render-di-battle.mjs'

const nodeOf = (cell, eventId) => ({ cell, eventId, eventKind: 0, note: '' })

// ---- ① 基地防空 ----

test('基地防空结算摞在「前往 X 点」预测上方，不替换它', () => {
  const sortie = sortieOf({
    nodes: [nodeOf(7, 4)],
    currentCell: 7,
    battle: battleOf({ kind: 'baseDefense', air: null }),
  })
  const html = renderOutcomeBanner(sortie)
  assert.ok(html.includes('基地防空结算'), '防空条本身要在')
  assert.ok(html.includes('前往 7 点'), '路径预测不许被防空顶掉')
  assert.ok(
    html.indexOf('基地防空结算') < html.indexOf('前往 7 点'),
    '防空要在预测的上方',
  )
  // 两条各是一枚独立的 verdict 槽，不是拼进同一条
  assert.equal((html.match(/class="verdict/g) ?? []).length, 2)
})

test('防空那条摞上去的预测，与没打过防空时的预测长得一样', () => {
  const nodes = [nodeOf(7, 4)]
  const cruising = renderHeadingBanner(sortieOf({ nodes, currentCell: 7 }))
  const afterDefense = renderOutcomeBanner(
    sortieOf({ nodes, currentCell: 7, battle: battleOf({ kind: 'baseDefense', air: null }) }),
  )
  assert.ok(afterDefense.endsWith(cruising), '摞上去的应当就是原样那一条')
})

test('没有战斗时仍然只有「前往 X 点」一条', () => {
  const html = renderOutcomeBanner(sortieOf({ nodes: [nodeOf(3, 5)], currentCell: 3 }))
  assert.equal((html.match(/class="verdict/g) ?? []).length, 1)
  assert.ok(html.includes('前往 3 点'))
  assert.ok(!html.includes('基地防空'))
})

// ---- ② 追击提示 ----

/**
 * 敌联合的昼战刚打完（还没进夜战）：主力全员健在，护卫按 `escortHp` 摆。
 * `escortHp` 里给 0 就是沉了。
 */
const afterDayVsCombined = (escortHp) => {
  const eShips = [
    ...Array.from({ length: 6 }, (_, i) => ({
      ...shipOf(i, `敌主力${i + 1}`),
      hpStart: 100,
      hpEnd: 60,
      hpMax: 100,
    })),
    ...escortHp.map((hp, i) => ({
      ...shipOf(6 + i, `敌护卫${i + 1}`),
      hpStart: 40,
      hpEnd: hp,
      hpMax: 40,
      sunk: hp <= 0,
    })),
  ]
  return sortieOf({
    nodes: [nodeOf(9, 5)],
    currentCell: 9,
    battle: battleOf({ kind: 'day', hasNight: false, eShips }),
  })
}

test('护卫六舰健在 → 说预计与敌护卫交战，且不再有「摸不到」那条尾巴', () => {
  const html = renderOutcomeBanner(afterDayVsCombined([40, 40, 40, 40, 40, 40]))
  assert.ok(html.includes('夜战估算与敌护卫交战'))
  assert.ok(html.includes('护卫剩余 6 舰'))
  assert.ok(!html.includes('摸不到'), '「主力夜战摸不到」是直译腔，已删')
  assert.ok(!html.includes('夜战只与敌护卫交战'), '旧的断言式口径不许回潮')
})

test('护卫只剩 1 舰小破 → 判别式 2.0 < 3，改说预计与主力交战', () => {
  // 用户当晚的实战局面：护卫队旗舰（position 0）小破未沉，其余五舰全灭。
  // 算分 = 旗舰存活 10 + 该舰小破 10 = 20（十分之一整数），未过阈值 30 → 打一队。
  const html = renderOutcomeBanner(afterDayVsCombined([30, 0, 0, 0, 0, 0]))
  assert.ok(html.includes('敌护卫已残破 · 夜战估算与主力交战'))
  assert.ok(html.includes('主力剩余合计 HP 360'), '给的是主力残存合计，不是全体')
  assert.ok(!html.includes('摸不到'))
  assert.ok(!html.includes('已歼灭'), '还有一艘活口，不能说歼灭')
})

test('护卫全灭 → 仍是确定机制那一句，不挂「预计」', () => {
  const html = renderOutcomeBanner(afterDayVsCombined([0, 0, 0, 0, 0, 0]))
  assert.ok(html.includes('敌护卫已歼灭 · 夜战将与主力交战'))
  assert.ok(html.includes('剩余合计 HP 360'))
  assert.ok(!html.includes('估算与'), '全灭是确定机制，这一句不该降级成估算')
})

test('敌方不是联合编成时那一支没动过', () => {
  const eShips = Array.from({ length: 6 }, (_, i) => ({
    ...shipOf(i, `敌舰${i + 1}`),
    hpStart: 100,
    hpEnd: 60,
    hpMax: 100,
  }))
  const html = renderOutcomeBanner(
    sortieOf({
      nodes: [nodeOf(9, 5)],
      currentCell: 9,
      battle: battleOf({ kind: 'day', hasNight: false, eShips }),
    }),
  )
  assert.ok(html.includes('夜战可攻击剩余敌舰（合计 HP 360）'))
})
