// 战果包里两条「结算之后才知道」的小字段：
// **护卫退避选项**（api_escape_flag / api_escape）与**解锁的新海域**（api_next_map_ids）。
//
// 两处坑：退避这条与战斗包里那个同名的 api_escape_idx 不是一回事——那个说
// 「谁已经退避掉了」，这个说「现在问你要不要让这几条退」；解锁那条是**混型**，
// 常规海域是数字、活动海域是字符串。
//
// 真报文取自 test/fixtures/battle-result-coverage.json（账本本身不入仓），
// 退避那一条是账本里唯一的一次。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { battleOf, renderResultStrip } from './fixtures/render-di-battle.mjs'
import { escapeOfferOf, nextMapIdsOf } from './fixtures/store-result-readers.mjs'

const resultFixtures = JSON.parse(
  fs.readFileSync(new URL('./fixtures/battle-result-coverage.json', import.meta.url), 'utf8'),
)
const pick = (name) => {
  const found = resultFixtures.find((one) => one.name === name)
  assert.ok(found, `fixture 里没有 ${name}`)
  return structuredClone(found)
}

// ---- 护卫退避选项 ----
//
// 2026-08-26 改形：从前只读 api_escape_idx，读出来叫 positions；现在 escape / tow
// 两组各归各位（tow = 陪她一起走的护卫舰，単艦退避时为空）。
// 真报文那一条的**期望值没变**——本机唯一那次样本 escape_idx=[2,3]、
// 根本没有 tow_idx，所以它现在落在 escape 里、tow 是空的。

test('真报文：1 基舰位换成 0 基，type 原值保留不解释', () => {
  const { body } = pick('result-escape-offer')
  assert.deepEqual(body.api_escape.api_escape_idx, [2, 3])
  // ⚠️ 这次样本有两个舰位、且**没有** api_tow_idx——两组各读各的就是为了这种时候
  assert.equal(body.api_escape.api_tow_idx, undefined)
  assert.deepEqual(escapeOfferOf(body), { escape: [1, 2], tow: [], type: 1 })
})

test('護衛退避：大破舰与护卫舰各归各组，都换成 0 基', () => {
  assert.deepEqual(
    escapeOfferOf({
      api_escape_flag: 1,
      api_escape: { api_escape_idx: [3], api_tow_idx: [8], api_escape_type: 1 },
    }),
    { escape: [2], tow: [7], type: 1 },
  )
  // 単艦退避没有护卫：tow 是空数组，不是缺席
  assert.deepEqual(
    escapeOfferOf({ api_escape_flag: 1, api_escape: { api_escape_idx: [5] } }),
    { escape: [4], tow: [], type: 0 },
  )
})

test('flag 没立就没有选项，哪怕 api_escape 还挂着', () => {
  assert.equal(escapeOfferOf({ api_escape_flag: 0, api_escape: { api_escape_idx: [2] } }), null)
  assert.equal(escapeOfferOf({}), null)
  assert.equal(escapeOfferOf({ api_escape_flag: 1, api_escape: null }), null)
  assert.equal(escapeOfferOf({ api_escape_flag: 1, api_escape: { api_escape_idx: [] } }), null)
  // 两组都空才算没有；只要有一组有人就是一次真选项
  assert.equal(
    escapeOfferOf({ api_escape_flag: 1, api_escape: { api_escape_idx: [], api_tow_idx: [] } }),
    null,
  )
  assert.deepEqual(
    escapeOfferOf({ api_escape_flag: 1, api_escape: { api_tow_idx: [4] } }),
    { escape: [], tow: [3], type: 0 },
  )
})

const resultBase = {
  rank: 'A',
  mvp: -1,
  mvpCombined: -1,
  baseExp: 180,
  dropShipMstId: null,
  dropShipName: null,
  firstClear: false,
}

test('渲染：结果条多一枚芯片，点名是哪几条', () => {
  const html = renderResultStrip(
    battleOf({ result: { ...resultBase, escapeOffer: { escape: [1, 2], tow: [], type: 1 } } }),
  )
  assert.match(html, /可退避 <b>我舰2 · 我舰3<\/b>/)
  // 只报是哪几条，不替游戏解释谁大破谁护卫
  assert.ok(!html.includes('大破'))
  // 没有护卫组就不摆那一段（悬停里那句「护卫退避选项」是芯片自己的说明，不算一段）
  assert.ok(!html.includes('<em>护卫</em>'))
})

test('渲染：有护卫舰时两段都点名，各自是谁一目了然', () => {
  const html = renderResultStrip(
    battleOf({ result: { ...resultBase, escapeOffer: { escape: [2], tow: [7], type: 1 } } }),
  )
  assert.match(html, /可退避 <b>我舰3<\/b> <em>护卫<\/em> <b>我舰8<\/b>/)
})

test('渲染：舰位指不到人时那一段不出，芯片不留半句空话', () => {
  const html = renderResultStrip(
    battleOf({ result: { ...resultBase, escapeOffer: { escape: [1], tow: [99], type: 1 } } }),
  )
  assert.match(html, /可退避 <b>我舰2<\/b>/)
  assert.ok(!html.includes('<em>护卫</em>'))
})

// ---- 解锁的新海域 ----

test('真报文：[16] 转数并上屏成 1-6', () => {
  const { body } = pick('result-eo-first-clear')
  assert.deepEqual(nextMapIdsOf(body), [16])
})

test('混型：常规海域是数字、活动海域是字符串，两种都收；转不出的整项丢掉', () => {
  assert.deepEqual(nextMapIdsOf({ api_next_map_ids: [16, '624', 0, -1, 'x', null] }), [16, 624])
  assert.deepEqual(nextMapIdsOf({}), [])
})

test('渲染：解锁芯片写海域号，没解锁就不出', () => {
  const base = {
    rank: 'S',
    mvp: -1,
    mvpCombined: -1,
    baseExp: 190,
    dropShipMstId: null,
    dropShipName: null,
    firstClear: true,
  }
  assert.match(
    renderResultStrip(battleOf({ result: { ...base, nextMapIds: [16] } })),
    /解锁 <b>[\s\S]*1-6/,
  )
  assert.ok(!renderResultStrip(battleOf({ result: base })).includes('解锁'))
})
