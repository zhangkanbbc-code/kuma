import assert from 'node:assert/strict'
import test from 'node:test'
import voiceLineage from '../dist/shared/voice-lineage.js'

const { buildVoiceFallbackIds, buildVoiceTranslationIndex, normalizeVoiceLine } = voiceLineage

test('voice fallback follows the nearest previous remodel form and stops remodel cycles', () => {
  const fallback = buildVoiceFallbackIds([
    { api_id: 410, api_sortno: 210, api_aftershipid: '325' },
    { api_id: 325, api_sortno: 1418, api_aftershipid: '955' },
    { api_id: 955, api_sortno: 555, api_aftershipid: '960' },
    { api_id: 960, api_sortno: 560, api_aftershipid: '955' },
  ])

  assert.deepEqual(fallback.get(410), [410])
  assert.deepEqual(fallback.get(325), [325, 410])
  assert.deepEqual(fallback.get(955), [955, 325, 410])
  assert.deepEqual(fallback.get(960), [960, 955, 325, 410])
})

test('voice fallback refuses to invent ancestry for rootless cycles or abyssal ships', () => {
  const fallback = buildVoiceFallbackIds([
    { api_id: 7, api_sortno: 7, api_aftershipid: '8' },
    { api_id: 8, api_sortno: 8, api_aftershipid: '7' },
    { api_id: 1501, api_sortno: 0, api_aftershipid: '-1' },
  ])

  assert.deepEqual(fallback.get(7), [7])
  assert.deepEqual(fallback.get(8), [8])
  assert.equal(fallback.has(1501), false)
})

test('voice fallback prefers the native upgrade predecessor table for branches', () => {
  const fallback = buildVoiceFallbackIds(
    [
      { api_id: 10, api_sortno: 10, api_aftershipid: '20' },
      { api_id: 20, api_sortno: 20, api_aftershipid: '30' },
      { api_id: 30, api_sortno: 30, api_aftershipid: '20' },
      { api_id: 40, api_sortno: 40, api_aftershipid: '30' },
    ],
    [
      { api_id: 10, api_current_ship_id: 0 },
      { api_id: 20, api_current_ship_id: 10 },
      { api_id: 30, api_current_ship_id: 20 },
      { api_id: 40, api_current_ship_id: 20 },
    ],
  )

  assert.deepEqual(fallback.get(30), [30, 20, 10])
  assert.deepEqual(fallback.get(40), [40, 20, 10])
})

test('原生改造表没覆盖到的那些改装边，退回 api_aftershipid 补上', () => {
  // 2026-08-27 实测本机 start2 快照：`api_mst_shipupgrade` 359 行里只有 259 行建得出
  // 前置边，`api_aftershipid` 却有 555 条。差出来的那些形态**整条链只剩它自己**，
  // 「沿改装链借文本」对它们从来没生效过——杰维斯（519 →Lv45 394）就是其中一个，
  // 她在 shipupgrade 里一行都没有，改形态的中破字幕因此无处可借（用户实测：听见了、看不见字）。
  const fallback = buildVoiceFallbackIds(
    [
      { api_id: 519, api_sortno: 319, api_aftershipid: '394' },
      { api_id: 394, api_sortno: 1474, api_aftershipid: '0' },
      { api_id: 10, api_sortno: 10, api_aftershipid: '20' },
      { api_id: 20, api_sortno: 20, api_aftershipid: '0' },
    ],
    // 表非空（于是走原生分支），但只说得出 10→20 这一条，杰维斯那条只字未提
    [{ api_id: 20, api_current_ship_id: 10 }],
  )

  assert.deepEqual(fallback.get(394), [394, 519], '改装链只剩自己，沿链借文本对这一族仍旧没生效')
  assert.deepEqual(fallback.get(20), [20, 10], '原生表说得出的那条边被补边逻辑带歪了')
})

test('两张表都说得上话时以原生改造表为准，aftershipid 只填空不覆盖', () => {
  // 原生表能表达分支与可逆改装，aftershipid 是单向单链、遇到可逆改装会把方向猜反。
  // 所以补边只在原生表**沉默**的地方落子。
  const fallback = buildVoiceFallbackIds(
    [
      { api_id: 1, api_sortno: 1, api_aftershipid: '3' },
      { api_id: 2, api_sortno: 2, api_aftershipid: '0' },
      { api_id: 3, api_sortno: 3, api_aftershipid: '0' },
    ],
    [{ api_id: 3, api_current_ship_id: 2 }],
  )

  // aftershipid 说 3 的前置是 1，原生表说是 2——听原生表的
  assert.deepEqual(fallback.get(3), [3, 2], 'aftershipid 盖掉了原生改造表给的前置')
})

test('voice translations reuse only an unambiguous exact Japanese line', () => {
  const index = buildVoiceTranslationIndex(
    {
      1: { 1: ' 同じ　原文 ', 2: '曖昧' },
      2: { 1: '同じ原文', 2: '曖昧' },
    },
    {
      1: { 1: '同一译文', 2: '译文甲' },
      2: { 1: '同一译文', 2: '译文乙' },
    },
  )

  assert.equal(index.get(normalizeVoiceLine('同じ原文')), '同一译文')
  assert.equal(index.has(normalizeVoiceLine('曖昧')), false)
})
