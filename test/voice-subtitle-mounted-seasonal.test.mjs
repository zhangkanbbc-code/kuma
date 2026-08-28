// 台账确证的那一格，实时字幕打季节文本（2026-08-25）。
//
// ---- 为什么这一条不违反「不做当季推断」 ----
// 季节台词平时**不按地址硬拼**：过季点下去播的是平时那句，打季节文本就是骗人。
// 但耳测台账里带 `mountedSeasonalKey` 的格子不一样——那是**已经查明**
// 「这个地址此刻放的就是季节包里的哪一条」（1003 号那格的档名
// `603-Sec1Seika2025` 是游戏方自己的命名，等于官方替我们确认了）。
// 确证之后，打那一条才是对的，静音反而是漏。
//
// ⚠️ 一格一证，只由证据授予：没有台账条目的格照旧走季节闸（不出字幕）。
// 这里**不许**出现任何按日期猜当季的代码——官方换文件的时点、换哪几艘、
// 换的是哪一句，都不是日历能算出来的。
//
// 图鉴侧是同一手（ji.ts 的 mountedSeasonalLine → 那一条季节行给播放钮）。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { captionOf } from './fixtures/render-ship-caption.mjs'

const subtitle = fs.readFileSync(new URL('../src/renderer/voice-subtitle.ts', import.meta.url), 'utf8')
const chain = (...ids) => new Map([[ids[0], ids]])

const MOUNTED = '603-Sec1Seika2025'
const setup = (overrides = {}) => ({
  voiceFallbackOf: chain(1003),
  subtitleZh: { 1003: { 2: '平时那一句' } },
  seasonOccupied: new Map([[1003, new Set([2])]]),
  observations: new Map([['1003:2', { verdict: 'season-slot', mountedSeasonalKey: MOUNTED }]]),
  seasonalShips: {
    1003: [
      { key: MOUNTED, zh: '夏天啦！头上！注意上空呀。', ja: '夏だ！頭上！上空注意だ' },
      { key: '603-Sec2Seika2025', zh: '别的季节行', ja: '' },
    ],
  },
  ...overrides,
})

test('确证过的那一格：打季节文本，而不是平时那句、也不是静音', () => {
  const caption = captionOf(setup(), 1003, 2)
  assert.equal(caption.length, 1, '确证过的格子被季节闸一起静音了')
  assert.equal(
    caption[0].text,
    '夏天啦！头上！注意上空呀',
    '打的不是台账确证的那一条（行尾句号按体例删掉）',
  )
})

test('季节文本优先于平时那句——闸不许把它吞掉', () => {
  // 这一格 subtitle 里躺着「平时那一句」，且季节闸把它标成不保证。
  // 台账确证之后，正确答案是季节那一条，两者都不能是「平时那一句」。
  const text = captionOf(setup(), 1003, 2)[0]?.text
  assert.notEqual(text, '平时那一句', '打成了平时那句——当季屏幕与音频对不上')
})

test('台账没有 mountedSeasonalKey 时，照旧走季节闸不出字幕', () => {
  const caption = captionOf(
    setup({ observations: new Map([['1003:2', { verdict: 'season-slot' }]]) }),
    1003,
    2,
  )
  assert.deepEqual(caption, [], '没有证据也打了季节文本——那就是按猜的了')
})

test('季节包里找不到那一条时，退回不出字幕（不硬凑）', () => {
  const caption = captionOf(setup({ seasonalShips: { 1003: [{ key: '别的key', zh: '别的' }] } }), 1003, 2)
  assert.deepEqual(caption, [], '档名对不上还是打了一句')
})

test('别的格子不受影响', () => {
  // 同一艘舰的 3 号槽没有台账条目，也不在季节闸里 → 照常出 subtitle
  const caption = captionOf(
    setup({ subtitleZh: { 1003: { 2: '平时那一句', 3: '三号槽那句' } } }),
    1003,
    3,
  )
  assert.equal(caption[0]?.text, '三号槽那句')
})

test('中文缺席时用季节包的日文原文', () => {
  const caption = captionOf(
    setup({ seasonalShips: { 1003: [{ key: MOUNTED, zh: '', ja: '夏だ！頭上！' }] } }),
    1003,
    2,
  )
  assert.equal(caption[0]?.text, '夏だ！頭上！')
})

test('这条路上没有任何按日期猜当季的代码', () => {
  const at = subtitle.indexOf('const mountedSeasonalText =')
  assert.notEqual(at, -1, 'mountedSeasonalText 不见了')
  const body = subtitle.slice(at, subtitle.indexOf('\n}', at))
  assert.ok(!/new Date|Date\.now|getMonth|当季/.test(body), '开始按日期猜当季了')
  // 证据来源必须是台账的 mountedSeasonalKey，不是别的推断
  assert.ok(body.includes('mountedSeasonalKey'), '不是由台账授予的')
  // 且要排在两道季节闸之前，否则会被闸当成「不确定」一起静音
  const gate = subtitle.indexOf('seasonOccupied.get(cue.mstId)?.has(cue.voiceId)')
  const call = subtitle.indexOf('const mounted = mountedSeasonalText(cue.mstId, cue.voiceId)')
  assert.notEqual(call, -1, 'shipCaption 里没有调用它')
  assert.ok(call < gate, '确证那一步排在季节闸之后——会被闸吞掉')
})
