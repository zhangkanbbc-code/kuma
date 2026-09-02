// 裸编号槽位（编号 ≥54，文件名就是编号本身）的护栏。
//
// ---- 这份护栏盯的是什么 ----
// 2026-08-22 查实：官方语音**编号 ≤53 才过混淆算法，54 起裸编号直出**。
// 拦截侧当天就按值域认出来了，可**展示侧**还被三道闸挡着：
//   ① `isPlayableVoiceId` 只认 1..53；② `encodeVoiceFile` 只会算混淆；
//   ③ 骨架空间上界写死 53。
// 后果是玩家真听过的那几句在图鉴里根本不存在——本机台账里 Richelieu改 的
// `900.mp3` 被记成「认不出」16 次，也就是说她确实说了，而界面上一行都没有。
//
// 每一条都是「写反了不报错、只是某天悄悄少一格」那一类，所以全部**真调用**，
// 不去正则匹配源码文本（见 shared/source-pattern-guards-miss-logic-bugs）。
import assert from 'node:assert/strict'
import test from 'node:test'

import soundPath from '../dist/shared/voice-sound-path.js'
import probePlan from '../dist/shared/voice-probe-plan.js'
import archivePlan from '../dist/shared/voice-archive-plan.js'
import sceneSlots from '../dist/shared/voice-scene-slots.js'

const { VOICE_KEYS, encodeVoiceFile, isPlayableVoiceId, voiceSoundPathname, directVoiceIdOf } =
  soundPath
const { sanitizeVoiceAbsentEntry, voiceAbsentStillValid } = probePlan
const { sanitizeVoiceArchiveEntry } = archivePlan
const { SPECIAL_VOICE_SLOT_IDS, isSpecialVoiceSlot, specialVoiceScene, voiceSceneOfSlot } =
  sceneSlots

// ---- ① 取址：裸编号不过混淆算法 ----

test('900 的文件名就是 900——一位都不许被混淆算法碰', () => {
  assert.equal(encodeVoiceFile(576, 900), '900')
  assert.equal(voiceSoundPathname('abcdefg', 576, 900), '/kcs/sound/kcabcdefg/900.mp3')
  // 同一形态的其它裸编号同理，且**与形态无关**（混淆编号才随 mstId 变）
  for (const slot of SPECIAL_VOICE_SLOT_IDS) {
    assert.equal(encodeVoiceFile(576, slot), `${slot}`)
    assert.equal(encodeVoiceFile(1, slot), `${slot}`, `槽位 ${slot} 的裸编号不该随形态变`)
  }
})

test('≤53 仍旧走混淆，一个字节都没变（回归闸）', () => {
  // 算式：(mstId + 7) * 17 * VOICE_KEYS[slot-1] % 99173 + 100000（poi-plugin-subtitle, MIT）
  for (const [mstId, slot] of [
    [1, 1],
    [576, 2],
    [518, 24],
    [200, 53],
  ]) {
    const expected = `${(((mstId + 7) * 17 * VOICE_KEYS[slot - 1]) % 99173) + 100000}`
    assert.equal(encodeVoiceFile(mstId, slot), expected, `(${mstId}, ${slot}) 的混淆编号变了`)
    // 混淆编号必然落在 [100000, 199172]——裸编号绝不可能长这样
    const value = Number(expected)
    assert.ok(value >= 100_000 && value <= 199_172)
    assert.equal(directVoiceIdOf(expected), null, '混淆编号被当成了裸编号')
  }
  assert.equal(voiceSoundPathname('lvjcqqulbluo', 1, 1), `/kcs/sound/kclvjcqqulbluo/${
    (((1 + 7) * 17 * VOICE_KEYS[0]) % 99173) + 100000
  }.mp3`)
})

test('未列入表的裸编号一律算不出地址——展示侧不按值域瞎探', () => {
  for (const slot of [0, -1, 54, 500, 899, 994, 1000]) {
    assert.equal(isSpecialVoiceSlot(slot), false, `${slot} 不该在表里`)
    assert.equal(encodeVoiceFile(576, slot), null, `${slot} 不该算出文件名`)
    assert.equal(voiceSoundPathname('abcdefg', 576, slot), null)
  }
  // 但**拦截侧**的宽判据不受影响：游戏真请求了 995，我们照旧认得出来路
  assert.equal(directVoiceIdOf('995'), 995)
})

test('取址侧认整张表——限定形态那两格也算得出地址（限定只管摆行）', () => {
  // 2026-08-23：917/918 带 `onlyMst`，**摆行**只在 Graf 家。可「算不算得出地址」
  // 是另一件事：别的舰若真在这一格留下过实物，档案照样该点得亮、播得出。
  // 把限定混进取址判据，就会把「她确实说了」重新变成图鉴里的不存在。
  for (const slot of [129, 917, 918]) {
    assert.equal(isSpecialVoiceSlot(slot), true, `${slot} 该在表里`)
    assert.equal(isPlayableVoiceId(slot), true)
    // 与形态无关：裸编号不过混淆算法
    assert.equal(encodeVoiceFile(576, slot), `${slot}`)
    assert.equal(encodeVoiceFile(432, slot), `${slot}`)
    assert.equal(voiceSoundPathname('abcdefg', 576, slot), `/kcs/sound/kcabcdefg/${slot}.mp3`)
  }
})

test('缺 shipgraph / 形态号非法时不硬拼地址', () => {
  assert.equal(voiceSoundPathname(null, 576, 900), null)
  assert.equal(voiceSoundPathname('', 576, 900), null)
  assert.equal(encodeVoiceFile(0, 900), null)
  assert.equal(encodeVoiceFile(-3, 1), null)
})

// ---- ② 播放钮判据：時雨家 141/241 的文本行有词无钮那一处 ----

test('141/241 可播放：subtitle 里有词的那几行，钮该回来', () => {
  // 随包 subtitle-ja/zh 里 4 艘（43/145/243/961）有 141/241 这两个键，
  // 原文都是「西村艦隊、これより主力部隊を援護するよ！」。
  // `isPlayableVoiceId` 只认 1..53 的那一版把它们的播放钮整个吞掉了：有词、无钮。
  assert.equal(isPlayableVoiceId(141), true)
  assert.equal(isPlayableVoiceId(241), true)
  assert.equal(voiceSoundPathname('abcdefg', 145, 141), '/kcs/sound/kcabcdefg/141.mp3')
  // 混淆段照旧
  assert.equal(isPlayableVoiceId(1), true)
  assert.equal(isPlayableVoiceId(53), true)
  assert.equal(isPlayableVoiceId(VOICE_KEYS.length + 1), false, '54 不在表里，不该可播放')
  assert.equal(isPlayableVoiceId(0), false)
  assert.equal(isPlayableVoiceId(2.5), false)
})

// ---- ③ 场合名 ----

test('裸编号槽位有场合名，且不侵占混淆段那张实证对照表', () => {
  assert.equal(specialVoiceScene(900), '特殊攻击')
  // 统一入口也认得它——subtitle 里 141/241 那几行的场合名靠这条路取
  assert.equal(voiceSceneOfSlot(900), '特殊攻击')
  assert.equal(voiceSceneOfSlot(141), '友军舰队（海域41）一')
  assert.equal(voiceSceneOfSlot(241), '友军舰队（海域41）二')
  assert.equal(voiceSceneOfSlot(129), '放置②')
  assert.equal(voiceSceneOfSlot(917), '夜战特殊（Graf）一')
  assert.equal(voiceSceneOfSlot(918), '夜战特殊（Graf）二')
  assert.equal(voiceSceneOfSlot(54), '', '表外编号不许凭空得到名字')
  // 混淆段那张表一个字都没动
  assert.equal(voiceSceneOfSlot(1), '获得/登录时')
  assert.equal(voiceSceneOfSlot(24), '结婚')
  assert.equal(voiceSceneOfSlot(30), '时报 00:00')
  assert.equal(voiceSceneOfSlot(53), '时报 23:00')
  assert.equal(specialVoiceScene(24), '', '混淆段的槽位不该在裸编号表里')
})

// ---- ④ 台账与档案：裸编号进得去也出得来 ----

test('「官方没有」的台账收得下 900，往返一趟不掉字段', () => {
  const pathname = '/kcs/sound/kcabcdefg/900.mp3'
  const entry = sanitizeVoiceAbsentEntry({ pathname, at: 1_800_000_000_000, status: 404 })
  assert.ok(entry, '900 被台账的路径判据挡在门外了——那样这一格永远转不成无配音态')
  assert.equal(entry.pathname, pathname)
  assert.equal(entry.status, 404)
  // 再喂一遍自己（落盘 → 读回）不该变形
  assert.deepEqual(sanitizeVoiceAbsentEntry({ ...entry }), entry)
  // 记着就作数（2026-08-23 起没有时间条件了，判据与出处在 voice-probe.test.mjs 那一节）
  assert.equal(voiceAbsentStillValid(entry), true)
})

test('档案条目的 voiceId 不再被卡在 53——那会把 900 静默归零', () => {
  const kept = sanitizeVoiceArchiveEntry({
    pathname: '/kcs/sound/kcabcdefg/900.mp3',
    mstId: 576,
    voiceId: 900,
    sha1: 'a'.repeat(16),
    version: '1',
    bytes: 12_345,
    firstHeard: 1,
    lastHeard: 2,
    heard: 3,
  })
  assert.ok(kept)
  assert.equal(kept.voiceId, 900)
})
