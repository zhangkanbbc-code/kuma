import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import voiceOverlay from '../dist/shared/voice-overlay.js'
import voiceText from '../dist/shared/voice-text.js'

const { applyVoiceOverlay, voiceOverlayJaIndex } = voiceOverlay
const { isUntranslatedVoiceText } = voiceText

test('缺译判据只认空白与没有 CJK 的拉丁字母文本', () => {
  assert.equal(isUntranslatedVoiceText(''), true)
  assert.equal(isUntranslatedVoiceText(' \t\n'), true)
  assert.equal(isUntranslatedVoiceText('Burning Love!!'), true)
  assert.equal(isUntranslatedVoiceText('……'), false)
  assert.equal(isUntranslatedVoiceText('♪'), false)
  assert.equal(isUntranslatedVoiceText('开火！'), false)
})

test('缺译且日文原文一致时叠上译文，不改传入的上游行表', () => {
  const upstream = {
    78: [{ key: '021-Atk1', scene: '攻击1', ja: ' Burning Love！！ ', zh: 'Burning Love！！' }],
  }
  const result = applyVoiceOverlay(
    upstream,
    {
      entries: {
        '021-Atk1': {
          pack: 'kcwiki-voice',
          ja: 'Burning Love！！',
          zh: '燃烧的爱！！',
        },
      },
    },
    'kcwiki-voice',
  )

  assert.equal(result.data[78][0].zh, '燃烧的爱！！')
  assert.equal(upstream[78][0].zh, 'Burning Love！！')
  assert.deepEqual(result.appliedKeys, ['021-Atk1'])
  assert.deepEqual(result.retiredKeys, [])
  assert.deepEqual(result.warnings, [])
})

test('上游已有中文时跳过并列入退役候选', () => {
  const result = applyVoiceOverlay(
    {
      78: [{ key: '021-Atk1', scene: '攻击1', ja: 'Burning Love！！', zh: '燃烧的爱！！' }],
    },
    {
      entries: {
        '021-Atk1': {
          pack: 'kcwiki-voice',
          ja: 'Burning Love！！',
          zh: '另一份译文',
        },
      },
    },
    'kcwiki-voice',
  )

  assert.equal(result.data[78][0].zh, '燃烧的爱！！')
  assert.deepEqual(result.appliedKeys, [])
  assert.deepEqual(result.retiredKeys, ['021-Atk1'])
})

test('上游日文原文变化时跳过并告警', () => {
  const result = applyVoiceOverlay(
    {
      78: [{ key: '021-Atk1', scene: '攻击1', ja: 'Burning Love!', zh: '' }],
    },
    {
      entries: {
        '021-Atk1': {
          pack: 'kcwiki-voice',
          ja: 'Burning Love！！',
          zh: '燃烧的爱！！',
        },
      },
    },
    'kcwiki-voice',
  )

  assert.equal(result.data[78][0].zh, '')
  assert.deepEqual(result.appliedKeys, [])
  assert.deepEqual(result.retiredKeys, [])
  assert.deepEqual(result.warnings, [
    {
      key: '021-Atk1',
      pack: 'kcwiki-voice',
      upstreamJa: 'Burning Love!',
      overlayJa: 'Burning Love！！',
    },
  ])
})

test('上游 ja 为空且 zh 误填日文时叠上译文，已有 ja 的中文行不受影响', () => {
  const result = applyVoiceOverlay(
    {
      993: [
        {
          key: '593-DockMedDmg',
          scene: '中破入渠',
          ja: '',
          zh: 'やっべ、こりゃーダメだ。休むぜ～いいだろ？',
        },
        {
          key: '593-Sec1',
          scene: '秘书舰1',
          ja: '日文原文',
          zh: '正常译文里保留アカシ这个专名',
        },
      ],
    },
    {
      entries: {
        '593-DockMedDmg': {
          pack: 'kcwiki-voice',
          ja: 'やっべ、こりゃーダメだ。休むぜ～いいだろ？',
          zh: '糟了，这下真不行了。让我歇会儿～可以吧？',
        },
        '593-Sec1': {
          pack: 'kcwiki-voice',
          ja: '日文原文',
          zh: '不该覆盖',
        },
      },
    },
    'kcwiki-voice',
  )

  assert.equal(result.data[993][0].zh, '糟了，这下真不行了。让我歇会儿～可以吧？')
  assert.equal(result.data[993][1].zh, '正常译文里保留アカシ这个专名')
  assert.deepEqual(result.appliedKeys, ['593-DockMedDmg'])
  assert.deepEqual(result.retiredKeys, ['593-Sec1'])
  assert.deepEqual(result.warnings, [])
})

test('日文索引同时收 keyed 条目与 byJa 条目', () => {
  const index = voiceOverlayJaIndex({
    entries: {
      '021-Atk1': {
        pack: 'kcwiki-voice',
        ja: ' Burning　Love！！ ',
        zh: '燃烧的爱！！',
      },
    },
    byJa: [{ ja: 'Open fire!', zh: '开火！' }],
  })

  assert.equal(index.get('BurningLove!!'), '燃烧的爱！！')
  assert.equal(index.get('Openfire!'), '开火！')
})

test('图鉴常规行、图鉴季节行与实时字幕共用译文 overlay', () => {
  const catalog = fs.readFileSync(
    new URL('../src/renderer/modules/ji.ts', import.meta.url),
    'utf8',
  )
  const subtitle = fs.readFileSync(
    new URL('../src/renderer/voice-subtitle.ts', import.meta.url),
    'utf8',
  )

  assert.match(catalog, /queryLode\('kuma-voice-zh'\)/)
  assert.match(catalog, /applyVoiceOverlay\([\s\S]*?'kcwiki-voice'/)
  assert.match(catalog, /applyVoiceOverlay\([\s\S]*?'kcwiki-seasonal-voice'/)
  assert.match(
    catalog,
    /lodeCreditMark\(kumaVoiceZhLode\.meta, '中文译文来源：kuma 自译'\)/,
  )
  assert.match(subtitle, /queryLode\('kuma-voice-zh'\)/)
  assert.match(subtitle, /const overlayZh = isUntranslatedVoiceText\(zhLine\)/)
  assert.equal(
    [...catalog.matchAll(/voiceZhByJa = buildVoiceZhByJa\(/g)]
      .length,
    1,
  )
  assert.equal(
    [...subtitle.matchAll(/voiceZhByJa = buildVoiceZhByJa\(/g)]
      .length,
    1,
  )
})
