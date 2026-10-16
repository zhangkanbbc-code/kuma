import assert from 'node:assert/strict'
import test from 'node:test'

import {
  battleOf,
  renderOutcomeBanner,
  renderResultStrip,
  sortieOf,
} from './fixtures/render-di-battle.mjs'

// 两边用不同损失值，同时检查排列顺序与数值归属。
const battleWithLosses = (kind) => {
  const battle = battleOf({ kind })
  return {
    ...battle,
    prediction: {
      ...battle.prediction,
      rank: 'B',
      perfect: false,
      fGauge: 17,
      fTaken: 51,
      eGauge: 63,
      eSunk: 0,
    },
  }
}

test('航空战预测先显示我方损失，再显示敌方损失，数值各归其方', () => {
  const html = renderOutcomeBanner(sortieOf({ battle: battleWithLosses('airbattle') }))
  assert.match(html, /<b>航空战预测 B · 我方损失 17% · 敌方损失 63%<\/b>/)
})

test('航空战结果条先我后敌，B 胜条件的除法仍是敌损失除以我损失', () => {
  const html = renderResultStrip(battleWithLosses('airbattle'))
  assert.match(html, /<span class="rchip">损害比 <b>我 17% \/ 敌 63%<\/b><\/span>/)
  assert.match(
    html,
    /战果比超过 2\.5×<\/span><span class="r">63% \/ 17%<\/span>/,
  )
})

test('昼战预测说明先我后敌，夜战提示仍在损失读数之后', () => {
  const html = renderOutcomeBanner(sortieOf({ battle: battleWithLosses('day') }))
  assert.match(
    html,
    /<span>我方损失 17% · 敌方损失 63% · 夜战可攻击剩余敌舰（合计 HP 300）<\/span>/,
  )
})

test('只有空袭的战斗仍只显示我方损失，数值取 fGauge', () => {
  const battle = battleWithLosses('airraid')
  const banner = renderOutcomeBanner(sortieOf({ battle }))
  const strip = renderResultStrip(battle)
  assert.match(banner, /我方损失 17%<\/b>/)
  assert.match(strip, /<span class="rchip">我方损失 <b>17%<\/b><\/span>/)
  assert.doesNotMatch(banner, /敌方损失|63%/)
  assert.doesNotMatch(strip, /损害比|敌方损失|63%/)
})
