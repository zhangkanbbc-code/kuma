// 台词中文译文的标点体例（2026-08-22 用户抽检自译包时当场裁的两条）。
//
//   ① 行尾句号一律不写；`？！～` 保留，**行内分句的句号也保留**，只删最末那一个。
//   ② `……。` 是病句，任何位置都修——中文语境里省略号与句号同级，不许连用。
//
// 判据住在 `src/shared/voice-text.ts`：**包构建期**（自译包 / 季节台词包落盘前）与
// **显示期**（图鉴台词卷、实时字幕浮层）共用同一份，不许各写各的。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { isVoiceTextNormalized, normalizeVoiceText } from '../src/shared/voice-text.ts'

test('① 行尾句号删掉，其余终止符原样留着', () => {
  assert.equal(normalizeVoiceText('是很棒的装备呢。'), '是很棒的装备呢')
  // ？！～ 带语气，不是单纯的终止符，一个都不许动
  assert.equal(normalizeVoiceText('提督，怎么了吗？'), '提督，怎么了吗？')
  assert.equal(normalizeVoiceText('我上了！'), '我上了！')
  assert.equal(normalizeVoiceText('好困啊～'), '好困啊～')
  assert.equal(normalizeVoiceText('还早呢……'), '还早呢……')
  // 连着几个句号也一并收掉
  assert.equal(normalizeVoiceText('好的。。'), '好的')
  // 行尾有空白时同样认得出
  assert.equal(normalizeVoiceText('作战完成。  '), '作战完成')
})

test('① 反例：行内分句的句号一个都不许动', () => {
  // 删了就把两句粘成一句——这条是体例的边界，不是「见句号就删」
  assert.equal(
    normalizeVoiceText('提督，三隈，恭候多时了。练度已经足够了。'),
    '提督，三隈，恭候多时了。练度已经足够了',
  )
  assert.equal(
    normalizeVoiceText('作战结束，舰队平安回到港口了。真是，太好了。'),
    '作战结束，舰队平安回到港口了。真是，太好了',
  )
  // 整行没有行尾句号时，行内那些原样不动
  assert.equal(normalizeVoiceText('他走了。我留下！'), '他走了。我留下！')
})

test('② `……。` 是病句：行尾行内一并修', () => {
  assert.equal(normalizeVoiceText('这也是……任务嘛……。'), '这也是……任务嘛……')
  // 行内：省略号自己就终止了句子，后面那个句号是重复终止
  assert.equal(
    normalizeVoiceText('测试，1，2……。好——！第三次改装，已经完成！'),
    '测试，1，2……好——！第三次改装，已经完成！',
  )
  // 单个省略号字符、以及省略号与句号之间夹空格的写法，同样认
  assert.equal(normalizeVoiceText('嗯…。'), '嗯…')
  assert.equal(normalizeVoiceText('嗯…… 。'), '嗯……')
  // 修完①之后不许再在行尾留下句号
  assert.equal(normalizeVoiceText('下一次的作战……。啊啊，我明白了。'), '下一次的作战……啊啊，我明白了')
})

test('行尾句号后面还挂着收尾符时，那个句号照样算行尾句号', () => {
  assert.equal(normalizeVoiceText('来，请。♪'), '来，请♪')
  assert.equal(normalizeVoiceText('Good night.（晚安。）'), 'Good night.（晚安）')
  assert.equal(normalizeVoiceText('他说「好的。」'), '他说「好的」')
  // 英文句点是英文句子的一部分，不是中文行尾句号——一个都不许动
  assert.equal(normalizeVoiceText("It's 11 o'clock."), "It's 11 o'clock.")
  assert.equal(normalizeVoiceText('Thanks.（谢啦。）'), 'Thanks.（谢啦）')
})

test('幂等：这个函数同时长在构建期与显示期，一行文本被过两遍是常态', () => {
  for (const sample of [
    '是很棒的装备呢。',
    '这也是……任务嘛……。',
    '来，请。♪',
    'Good night.（晚安。）',
    '提督，怎么了吗？',
    '',
  ]) {
    const once = normalizeVoiceText(sample)
    assert.equal(normalizeVoiceText(once), once, `不幂等：${sample}`)
    assert.equal(isVoiceTextNormalized(once), true)
  }
})

test('空值与非字符串一律给空串，不抛', () => {
  assert.equal(normalizeVoiceText(''), '')
  assert.equal(normalizeVoiceText(null), '')
  assert.equal(normalizeVoiceText(undefined), '')
})

// ---- 三份入仓的包必须已经合体例（缺包时跳过；test:lodes 会把它们列成必备） ----

const readLode = (id) => {
  const file = new URL(`../assets/lodes/${id}.json`, import.meta.url)
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
}

test('自译包的每一行译文都已合体例', (t) => {
  const pack = readLode('kanso-voice')
  if (!pack) {
    t.skip('缺 kanso-voice，跳过')
    return
  }
  const bad = []
  for (const [formId, rows] of Object.entries(pack.data.ships)) {
    for (const row of rows) {
      if (!isVoiceTextNormalized(row.zh)) bad.push(`${formId} ${row.key}：${row.zh.slice(-24)}`)
    }
  }
  assert.deepEqual(
    bad.slice(0, 8),
    [],
    `${bad.length} 行不合标点体例。跑 \`node scripts/voice-normalize-packs.mjs\` 就地改写`,
  )
})

test('译文 overlay 包的每一行译文都已合体例', (t) => {
  const pack = readLode('kanso-voice-zh')
  if (!pack) {
    t.skip('缺 kanso-voice-zh，跳过')
    return
  }
  const bad = []
  for (const [key, row] of Object.entries(pack.data.entries ?? {})) {
    if (!isVoiceTextNormalized(row.zh)) bad.push(key)
  }
  for (const [index, row] of (pack.data.byJa ?? []).entries()) {
    if (!isVoiceTextNormalized(row.zh)) bad.push(`byJa[${index}]`)
  }
  assert.deepEqual(bad.slice(0, 8), [], `${bad.length} 行不合标点体例`)
})

test('季节台词包的每一行译文都已合体例（它会被整份重抓，所以抓取器落盘前就得治）', (t) => {
  const pack = readLode('kcwiki-seasonal-voice')
  if (!pack) {
    t.skip('缺 kcwiki-seasonal-voice，跳过')
    return
  }
  const bad = []
  for (const [formId, rows] of Object.entries(pack.data.ships ?? {})) {
    for (const row of rows) {
      if (!isVoiceTextNormalized(row.zh)) bad.push(`${formId} ${row.key}`)
    }
  }
  for (const [key, skit] of Object.entries(pack.data.skits ?? {})) {
    if (!isVoiceTextNormalized(skit.zh)) bad.push(`skit ${key}`)
  }
  assert.deepEqual(bad.slice(0, 8), [], `${bad.length} 行不合标点体例`)
})

test('抓取器落盘前就调了归一——不然每次重抓都会把体例冲回去', () => {
  const fetcher = fs.readFileSync(
    new URL('../scripts/lib/kcwiki-seasonal-voice.mjs', import.meta.url),
    'utf8',
  )
  assert.match(fetcher, /import \{ normalizeVoiceText \} from '\.\.\/\.\.\/src\/shared\/voice-text\.ts'/)
  assert.match(fetcher, /const zh = normalizeVoiceText\(/)
})

test('显示面两处都过同一份归一：图鉴台词卷与实时字幕浮层', () => {
  const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
  const catalog = read('../src/renderer/modules/ji.ts')
  const subtitle = read('../src/renderer/voice-subtitle.ts')
  // 图鉴：常规台词行与季节台词行各一处
  assert.match(catalog, /const zhText = simplifyZh\(normalizeVoiceText\(zh\)\)/)
  assert.match(catalog, /const seasonZh = simplifyZh\(normalizeVoiceText\(line\.zh\)\)/)
  // 实时字幕：中文那一支过归一，日文回退不动（那是原文转写，不是我们的翻译）
  assert.match(subtitle, /const overlayZh = isUntranslatedVoiceText\(zhLine\)/)
  assert.match(subtitle, /text = overlayZh[\s\S]*?simplifyZh\(normalizeVoiceText\(overlayZh\)\)/)
  assert.match(subtitle, /: zhLine\s*\n?\s*\? simplifyZh\(normalizeVoiceText\(zhLine\)\)/)
  assert.doesNotMatch(subtitle, /normalizeVoiceText\(\s*`\$\{subtitleJa/, '日文回退被误过归一了')
})
