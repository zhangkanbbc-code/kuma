// 季节占槽的格子不出实时字幕（2026-08-25）。
//
// 官方当季会把某些槽位上的**音频文件**换成季节版，字幕表记的却是抓包那一刻的
// 那一句——当季与过季各对一半，两边都不保证。用户 2026-08-23 亲测报过一次：
// 秋津洲播的是盛夏闲聊语音，屏幕上打的是常规台词。
//
// 图鉴侧当天已经裁过同一件事（那些格子不给播放钮），裁决原文：
// **过季点下去播平时那句、当季播季节那句，两边都不保证，那就不给。**
// 这份护栏把同一份裁决延伸到实时字幕。字幕比播放钮更不能将就——播放钮点不点在
// 玩家，字幕是直接打在屏幕上的一句话，错了就是当着人的面说错。
//
// 判据必须是**同一份**：`seasonOccupiedSlots` 就是 `planVoiceCorrections` 的
// season-slot 那一档换个索引形状，一个字都没改。各写一份必然漂移，
// 而漂移的表现是「图鉴说这一格不保证、字幕却照打」。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import voiceSceneSlots from '../dist/shared/voice-scene-slots.js'

const { planVoiceCorrections, seasonOccupiedSlots, voiceSlotOfKey } = voiceSceneSlots
const subtitle = fs.readFileSync(new URL('../src/renderer/voice-subtitle.ts', import.meta.url), 'utf8')

// ---- 合成样本：一艘舰，2 号槽被季节语音占着，3 号槽正常 ----
//
// 2 号槽（Sec1 秘书舰1）：kcwiki 记着平时那句，而音轨（subtitle-ja/zh）里躺着的
// 是一句季节台词——这正是「这一格当季被顶了」的双源取证。
// 3 号槽（Sec2 秘书舰2）：三边一致，正常格子。
const SHIP = 100
const sample = () => ({
  voice: {
    [`${SHIP}`]: [
      { key: '080-Sec1', scene: '秘书舰1', ja: 'いつものあいさつ', zh: '平时那句' },
      { key: '080-Sec2', scene: '秘书舰2', ja: 'ふつうのせりふ', zh: '普通那句' },
    ],
  },
  subtitleJa: { [`${SHIP}`]: { 2: 'なつのおしゃべり', 3: 'ふつうのせりふ' } },
  subtitleZh: { [`${SHIP}`]: { 2: '盛夏的闲聊', 3: '普通那句' } },
  seasonalShips: { [`${SHIP}`]: [{ zh: '盛夏的闲聊' }] },
  codeMap: null,
})

test('样本确实被判成 season-slot（判据没走别的分支）', () => {
  // 先确认这份合成样本走的就是 ④-a 那一档。走成 audio-text 或 no-subtitle 的话，
  // 下面几条会「绿得没有意义」——测的就不是季节占槽了。
  const { stats } = planVoiceCorrections(sample())
  assert.equal(stats.seasonSlot, 1, `样本没落进 season-slot 档：${JSON.stringify(stats)}`)
  assert.equal(voiceSlotOfKey('080-Sec1'), 2)
  assert.equal(voiceSlotOfKey('080-Sec2'), 3)
})

test('被季节占着的槽位进索引，没被占的不进', () => {
  const occupied = seasonOccupiedSlots(sample())
  assert.ok(occupied.get(SHIP)?.has(2), '季节占槽的 2 号槽没进索引——字幕会照打')
  assert.equal(occupied.get(SHIP)?.has(3), false, '正常的 3 号槽被误拦，字幕会凭空消失')
})

test('索引与图鉴侧逐格一致——两个消费面必须是同一份裁决', () => {
  // 直接拿 planVoiceCorrections 的产物重算一遍，两边逐格对。
  // 这一条挡的是「有人给字幕侧另写一套判据」——那种漂移不报错，
  // 表现是图鉴说这一格不保证、字幕却照打。
  const input = sample()
  const expected = new Map()
  for (const [formId, rows] of planVoiceCorrections(input).rowsByForm) {
    for (const row of rows) {
      if (row.fix !== 'season-slot') continue
      const slot = row.slot ?? voiceSlotOfKey(row.key)
      if (slot == null) continue
      if (!expected.has(formId)) expected.set(formId, new Set())
      expected.get(formId).add(slot)
    }
  }
  const actual = seasonOccupiedSlots(input)
  assert.deepEqual(
    [...actual].map(([id, set]) => [id, [...set].sort((a, b) => a - b)]),
    [...expected].map(([id, set]) => [id, [...set].sort((a, b) => a - b)]),
  )
})

test('缺源时索引是空的——「有实证才闭嘴」，不是「拿不准就整片静音」', () => {
  assert.equal(seasonOccupiedSlots({ ...sample(), seasonalShips: null }).size, 0)
  assert.equal(seasonOccupiedSlots({ ...sample(), voice: null }).size, 0)
  assert.equal(seasonOccupiedSlots({ ...sample(), subtitleZh: null }).size, 0)
})

// ---- 字幕侧接线 ----

test('shipCaption 在取文本之前就把季节占槽的格子挡掉', () => {
  const start = subtitle.indexOf('const shipCaption = (')
  assert.notEqual(start, -1, 'shipCaption 不见了')
  const body = subtitle.slice(start, subtitle.indexOf('\n}', start))
  const gate = body.indexOf('seasonOccupied.get(cue.mstId)?.has(cue.voiceId)')
  assert.notEqual(gate, -1, '实时字幕又开始打季节占槽那一格了')
  // 锚点用 `const key =`（整段取文本的起点）而不是某一个源的名字：
  // 2026-08-25 kcwiki 接进查表序列后，源的先后会变，钉某一个源的旧锚会
  // 「绿得没意义」——闸门排在 subtitleZh 之前、却排在 kcwiki 之后照样是漏。
  assert.ok(
    gate < body.indexOf('const key ='),
    '闸门排在取文本之后——那说明它多半没拦住，或者拦得靠运气',
  )
  assert.ok(/has\(cue\.voiceId\)\) return \[\]/.test(body), '拦下之后不是静默返回空')
  // 按**将要播放的那个形态**查（cue.mstId），不是文本来源那艘：
  // 文本可以沿改装链借，音轨永远按当前形态拼
  assert.ok(!/seasonOccupied\.get\(sourceId\)/.test(body), '拿文本来源那艘去查了，形态错位')
})

test('耳测台账判 season-slot 的格子也不出字幕（第二条证据渠道）', () => {
  // 包判据只抓得住「抓包发生在季期」那个方向；反方向（字幕表记的是平时那句、
  // 当季播季节版，也就是用户亲测报的那种）在包里一点痕迹都没有，只有人耳听得出来。
  // 图鉴侧的 voicePlaybackFor 本来就两条都认，字幕侧不许只认一条。
  const start = subtitle.indexOf('const shipCaption = (')
  const body = subtitle.slice(start, subtitle.indexOf('\n}', start))
  assert.ok(
    /voicePlaybackObservationAt\(cue\.mstId, cue\.voiceId\)\?\.verdict === 'season-slot'\) return \[\]/.test(
      body,
    ),
    '耳测台账那条渠道没接上——包里查不到的那一族会继续打错字幕',
  )
  // 台账里判 slot-offset / unknown 的**不**在这条闸门内（那是另一种病，另有治法），
  // 别把整份台账一刀切成静音
  assert.ok(!/voicePlaybackObservationAt\([^)]*\)\) return \[\]/.test(body), '整份耳测台账被一刀切静音了')
  // 台账里现在确实有 season-slot 条目，否则这条闸门等于没接
  const ledger = fs.readFileSync(
    new URL('../src/shared/voice-playback-observations.ts', import.meta.url),
    'utf8',
  )
  assert.ok(ledger.includes("verdict: 'season-slot'"), '台账里一条 season-slot 都没有？')
})

test('字幕侧引的是共享判据，且把它要的源都装上了', () => {
  assert.ok(
    subtitle.includes("from '../shared/voice-scene-slots'"),
    '字幕侧没引共享判据——多半是自己另写了一套',
  )
  // 2026-08-25 起分拣只跑一次、导两张表（季节闸 + kcwiki 查表），
  // 所以这里认的是 seasonOccupiedFrom(plan.rowsByForm) 那一步
  assert.ok(subtitle.includes('seasonOccupiedFrom(plan.rowsByForm)'), '没有算这张表')
  assert.ok(
    subtitle.includes('const plan = planVoiceCorrections({'),
    '分拣没有只跑一次——各调一次就是把 17434 行分拣跑两遍',
  )
  for (const pack of ['kcwiki-voice', 'kcwiki-ships', 'kcwiki-seasonal-voice', 'subtitle-ja', 'subtitle-zh']) {
    assert.ok(subtitle.includes(`queryLode('${pack}')`), `判据要的源少了 ${pack}，表会恒为空`)
  }
})

test('没有引入「现在是不是季节期」的日期判定', () => {
  // 本仓故意没有当季判定：那要靠日期猜官方换没换文件，猜错就是打错字幕。
  // core 那边有一条禁 `当季.*new Date` 的护栏，这里守住新加的这条路不开这个口子。
  const scene = fs.readFileSync(new URL('../src/shared/voice-scene-slots.ts', import.meta.url), 'utf8')
  const at = scene.indexOf('export const seasonOccupiedSlots')
  assert.notEqual(at, -1)
  const fn = scene.slice(at, scene.indexOf('\n}', at))
  assert.ok(!/new Date|Date\.now|getMonth/.test(fn), 'seasonOccupiedSlots 开始按日期猜当季了')
})
