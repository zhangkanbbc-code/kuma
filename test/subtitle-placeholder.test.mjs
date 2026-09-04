// 字幕占位句不许上屏（2026-08-25）。
//
// poi-plugin-subtitle 在「这一条没有转写」时写的是一句**占位文本**而不是留空，
// 中日各一句，两句都带着 kcwiki 的网址：
//   · 日文 229 格：「このサブタイトルに対応するサブタイトルがありません！…」
//   · 中文 259 格：「本字幕暂时没有翻译 请到舰娘百科(https://zh.kcwiki.moe/)协助我们翻译」
//
// 日文那句一直被 isSubtitlePlaceholder 认着（图鉴侧靠它挡下整页占位），
// **中文那句从前一个字都没拦过**——实时字幕会把「请到舰娘百科协助我们翻译」
// 连网址一起打在玩家屏幕上。这是玩家能看见的最难堪的一种错字幕：
// 它长得像一句台词，还带着招募文案。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import voiceSceneSlots from '../dist/shared/voice-scene-slots.js'

const { isSubtitlePlaceholder } = voiceSceneSlots
const subtitle = fs.readFileSync(new URL('../src/renderer/voice-subtitle.ts', import.meta.url), 'utf8')

const JA_PLACEHOLDER =
  'このサブタイトルに対応するサブタイトルがありません！艦これ中国語ウィキ（https://zh.kcwiki.moe/）に参加して、この内容を一緒に完成しましょう！'
const ZH_PLACEHOLDER = '本字幕暂时没有翻译 请到舰娘百科(https://zh.kcwiki.moe/)协助我们翻译'

test('中日两句占位句都认得出来', () => {
  assert.equal(isSubtitlePlaceholder(JA_PLACEHOLDER), true, '日文占位句漏了')
  assert.equal(isSubtitlePlaceholder(ZH_PLACEHOLDER), true, '中文占位句漏了——它会连网址打在玩家屏幕上')
})

test('正常台词一句都不许被误伤', () => {
  for (const line of [
    '提督，今天也辛苦了',
    '司令官、どうしました？',
    '这条要去舰娘百科查一查', // 含「舰娘百科」但不是占位句
    '本字幕的翻译已经完成',
    '',
    null,
    undefined,
  ]) {
    assert.equal(isSubtitlePlaceholder(line), false, `误伤了正常文本：${String(line)}`)
  }
})

test('真包里的占位句全部落网，过滤后 0 格带 kcwiki 网址', (t) => {
  const dir = new URL('../assets/lodes/', import.meta.url)
  const read = (name) => {
    const file = new URL(name, dir)
    if (!fs.existsSync(file)) return null
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    return raw.data ?? raw
  }
  const zh = read('subtitle-zh.json')
  const ja = read('subtitle-ja.json')
  if (!zh || !ja) {
    t.skip('本机没有 subtitle 包')
    return
  }
  let zhHits = 0
  let jaHits = 0
  const leaked = []
  for (const [pack, table, bump] of [
    ['subtitle-zh', zh, () => (zhHits += 1)],
    ['subtitle-ja', ja, () => (jaHits += 1)],
  ]) {
    for (const [mstId, rows] of Object.entries(table)) {
      for (const [slot, value] of Object.entries(rows ?? {})) {
        const text = `${value ?? ''}`
        if (isSubtitlePlaceholder(text)) {
          bump()
          continue
        }
        // 过滤之后**一格都不许**还带着 kcwiki 的网址
        if (/zh\.kcwiki|kcwiki\.moe/i.test(text)) leaked.push(`${pack} ${mstId}:${slot}`)
      }
    }
  }
  assert.deepEqual(leaked, [], `过滤后仍有格子带着 kcwiki 网址：${leaked.slice(0, 5).join(' , ')}`)
  // 数量钉住：掉到 0 说明判据被改坏了（或包换了形态），该来看一眼而不是默默放行
  assert.ok(zhHits >= 200, `subtitle-zh 只认出 ${zhHits} 格占位句，判据多半被改窄了`)
  assert.ok(jaHits >= 200, `subtitle-ja 只认出 ${jaHits} 格占位句，判据多半被改窄了`)
})

test('实时字幕取文本时过这道滤，不是取完再补救', () => {
  assert.ok(
    /const captionText = \(value: unknown\): string => \{[\s\S]{0,200}isSubtitlePlaceholder\(text\) \? '' : text/.test(
      subtitle,
    ),
    'captionText 没有把占位句当空处理',
  )
  // subtitle 两支（中文优先、日文兜底）都得过滤，漏一支就等于没做
  assert.ok(
    subtitle.includes('const zhLine = captionText(subtitleZh[`${id}`]?.[key])'),
    '中文那支没过滤',
  )
  assert.ok(
    subtitle.includes('const jaLine = captionText(subtitleJa[`${id}`]?.[key])'),
    '日文兜底那支没过滤——中文是占位句时会退到日文占位句，等于原地踏步',
  )
  // kcwiki 那一支同样要过滤（它是 2026-08-25 接进来的第三个源）
  assert.ok(
    /const zh = captionText\(row\?\.zh\)[\s\S]{0,120}captionText\(row\?\.ja\)/.test(subtitle),
    'kcwiki 那支没过滤',
  )
})
