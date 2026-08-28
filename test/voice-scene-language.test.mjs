// 台词卷「场合」那一列的语言。
//
// ---- 为什么会有这份护栏（2026-08-25 汉化清点）----
// 同一页台词表里 kcwiki 的行早就是中文场合名（`秘书舰1`、`建造完成`），wikiwiki 那一支
// 却原样摆着日文（`入手/ログイン`、`母港1 / 詳細`、`建造完了`）——**一页两种语言并排**。
// 深海那边同理：subtitle-enemies 那一支走 `abyssVoiceRowLabel` 已是中文，wikiwiki
// 深海页那一支还在摆 `開幕前`/`砲撃`/`被弾`。这是**场合名不是台词**，不在「台词原文列」
// 的豁免内。
//
// 中文一个字都不新编：两侧都拿本仓既有的实证对照表去查（槽位→场合、行号族→场合），
// 查不到就**保留原文**。这份护栏拿真包全量过一遍，钉的是逻辑输出不是源码文本。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  voiceSceneOfSlot,
  wikiwikiVoiceScene,
} from '../src/shared/voice-scene-slots.ts'
import abyssFile from '../dist/shared/abyss-voice-file.js'

const { abyssWikiVoiceScene } = abyssFile

const lode = (name) =>
  JSON.parse(fs.readFileSync(new URL(`../assets/lodes/${name}`, import.meta.url), 'utf8')).data

const hasKana = (text) => /[ぁ-ゖァ-ヺ]/.test(text)

// wikiwiki 那两个包不随仓库分发（上游未声明许可，见 .gitignore 的白名单块）：
// 克隆下来的树里没有它们，缺包时跳过而不是红。维护者机器上包齐，照跑全量。
const skipMissingLode = (name) =>
  fs.existsSync(new URL(`../assets/lodes/${name}`, import.meta.url))
    ? false
    : `缺矿脉包：${name}（npm run lodes:fetch）`

// ---------------------------------------------------------------- 舰娘页（wikiwiki）

test('舰娘场合名:槽位查得到就说中文,查不到保原文', () => {
  // 中文取自 VOICE_SCENE_SLOTS——那本来就是 kcwiki 那一列的措辞，两支就此说同一种话
  assert.equal(wikiwikiVoiceScene(1, '入手/ログイン'), voiceSceneOfSlot(1))
  assert.equal(wikiwikiVoiceScene(5, '建造完了'), '建造完成')
  assert.equal(wikiwikiVoiceScene(13, '編成'), '编成')
  assert.equal(wikiwikiVoiceScene(41, '11'), '时报 11:00')
  // 槽位查不到（季节/周年/活动那些）→ 原样保留，不硬翻
  assert.equal(wikiwikiVoiceScene(null, '冬 / バレンタイン'), '冬 / バレンタイン')
  assert.equal(wikiwikiVoiceScene(9_999, '周 年 / 十三周年記念'), '周 年 / 十三周年記念')
  assert.equal(wikiwikiVoiceScene(null, ''), '')
})

test('舰娘场合名护栏:真包里能定槽位的行,一条日文都不许剩', {
  skip: skipMissingLode('wikiwiki-voice.json'),
}, () => {
  const pack = lode('wikiwiki-voice.json')
  let rows = 0
  let named = 0
  const leftJa = new Set()
  for (const lines of Object.values(pack)) {
    for (const line of Array.isArray(lines) ? lines : []) {
      const slot = line.voiceId ?? null
      const scene = wikiwikiVoiceScene(slot, `${line.scene ?? ''}`)
      rows++
      // 「能定槽位」= 实证对照表给得出中文名。那些行必须不再带假名。
      if (slot != null && voiceSceneOfSlot(slot)) {
        named++
        if (hasKana(scene)) leftJa.add(`${slot}|${line.scene}→${scene}`)
      }
    }
  }
  assert.ok(rows > 3000, `只扫到 ${rows} 行，收集器多半坏了`)
  assert.ok(named / rows > 0.6, `只有 ${named}/${rows} 行定得到槽位，比实测低太多`)
  assert.deepEqual([...leftJa], [], '定得到槽位的行还在摆日文场合名')
})

test('舰娘场合名护栏:定不到槽位的那批如实保原文,不硬翻', {
  skip: skipMissingLode('wikiwiki-voice.json'),
}, () => {
  const pack = lode('wikiwiki-voice.json')
  for (const lines of Object.values(pack)) {
    for (const line of Array.isArray(lines) ? lines : []) {
      const slot = line.voiceId ?? null
      if (slot != null && voiceSceneOfSlot(slot)) continue
      assert.equal(
        wikiwikiVoiceScene(slot, `${line.scene ?? ''}`),
        `${line.scene ?? ''}`.trim(),
        '查不到中文的行被动过了——那就是编的',
      )
    }
  }
})

// ---------------------------------------------------------------- 深海页（wikiwiki）

test('深海场合名:按包里的 suffix 查同一张行号表', () => {
  // 10/20/30/40 的首位就是 ABYSS_VOICE_SCENES 的族号，与 subtitle-enemies 那一支同源
  assert.equal(abyssWikiVoiceScene(10, '開幕前'), '开幕')
  assert.equal(abyssWikiVoiceScene(20, '砲撃'), '炮击')
  assert.equal(abyssWikiVoiceScene(30, '被弾'), '被弹')
  assert.equal(abyssWikiVoiceScene(40, '撃沈'), '击沉')
  // 表外 / 没有 suffix → 保留原文
  assert.equal(abyssWikiVoiceScene(null, '家具（お詫び掛け軸）'), '家具（お詫び掛け軸）')
  assert.equal(abyssWikiVoiceScene(50, 'セリフ'), 'セリフ')
})

test('深海场合名护栏:真包里带 suffix 的行全部说中文', {
  skip: skipMissingLode('wikiwiki-abyss-voice.json'),
}, () => {
  const pack = lode('wikiwiki-abyss-voice.json')
  let rows = 0
  let named = 0
  const leftJa = new Set()
  for (const lines of Object.values(pack)) {
    for (const line of Array.isArray(lines) ? lines : []) {
      rows++
      const scene = abyssWikiVoiceScene(line.suffix, `${line.scene ?? ''}`)
      if (scene === `${line.scene ?? ''}`.trim()) continue // 查不到，保原文
      named++
      if (hasKana(scene)) leftJa.add(`${line.suffix}|${line.scene}→${scene}`)
    }
  }
  assert.ok(rows > 2000, `只扫到 ${rows} 行，收集器多半坏了`)
  assert.ok(named / rows > 0.9, `只有 ${named}/${rows} 行补上了中文场合名`)
  assert.deepEqual([...leftJa], [], '补名之后还带着假名')
})
