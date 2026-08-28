// 「看一眼演习对手」不许诞生一场会话（2026-08-25）。
//
// ---- 用户报的「字幕间歇性消失」的真凶 ----
// `newSortie` 默认 `active: true`。`get_practice_enemyinfo`（点开演习对手看编成）
// 从前没覆盖它，于是玩家**只是看了一眼对手**，就诞生一个 active 的「演习会话」。
// 而 voice-subtitle 的演习拦截是 `active && practice` → 整场零字幕，
// 从那一刻一直到下一条回港报文才解除。不打演习、只看看，窗口任意长。
//
// 用户動线正好踩满：看对手 → 回编成页调舰队 → 编成语音静默。
//
// ---- 为什么改 active 是安全的 ----
// 未卜先知/演习预测那条路判的是 `practice && practiceOpponent && !battle`
//（di.ts 的 practicePreview），**一个字都不看 active**——全仓逐点核过。
// 其余读 active 的地方要么本来就写着 `active && !practice`，要么还要求 `battle`。
//
// 这份护栏喂真报文跑**真 reducer**（切片编译，见 fixtures/practice-session-reducers.mjs）
// ——「看对手时 active 是不是 false」这种事，源码正则写反了照样绿。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  enemyInfoBody,
  feedEnemyInfo,
  feedPracticeBattle,
  newSortie,
  reset,
  sortie,
} from './fixtures/practice-session-reducers.mjs'

test('默认值仍然是 active: true——这条是病根，先钉住它没变', () => {
  // 改法是在调用点覆盖，不是改默认值：出击那几条依赖这个默认
  assert.equal(newSortie({}).active, true)
  assert.equal(newSortie({}).practice, false)
})

test('看对手编成：会话不是 active 的', () => {
  reset()
  const sections = feedEnemyInfo(enemyInfoBody())
  assert.deepEqual(sections, ['sortie'], '没有推送 sortie 变更')
  assert.equal(
    sortie().active,
    false,
    '看一眼对手就诞生了一场 active 会话——演习拦截会从这一刻掐掉所有语音字幕',
  )
  assert.equal(sortie().practice, true, 'practice 标记丢了')
})

test('看对手编成：预告数据一个字段都不少（未卜先知靠它）', () => {
  reset()
  feedEnemyInfo(enemyInfoBody())
  const opponent = sortie().practiceOpponent
  assert.ok(opponent, 'practiceOpponent 没建起来——预测卡会空掉')
  assert.equal(opponent.id, 12345)
  assert.equal(opponent.name, '对面提督')
  assert.equal(opponent.level, 99)
  assert.equal(opponent.rank, '中将')
  assert.equal(opponent.deckName, '第一舰队')
  assert.deepEqual(opponent.ships, [{ mstId: 131, level: 155, star: 3 }])
  // 预测那条路的判据是 practice && practiceOpponent && !battle，逐条成立
  assert.equal(sortie().battle, null, '预告阶段不该有 battle')
})

test('空编成的报文不建会话（原样保留的早退）', () => {
  reset()
  const sections = feedEnemyInfo(enemyInfoBody({ api_deck: { api_ships: [] } }))
  assert.deepEqual(sections, [])
  assert.equal(sortie(), null, '空编成也建了会话')
})

test('真开战：active 回到 true，且继承看对手时拿到的编成', () => {
  reset()
  feedEnemyInfo(enemyInfoBody())
  const sections = feedPracticeBattle()
  assert.deepEqual(sections, ['sortie'])
  assert.equal(sortie().active, true, '真开战没有把会话点亮——演习拦截会失效')
  assert.equal(sortie().practice, true)
  assert.equal(
    sortie().practiceOpponent?.name,
    '对面提督',
    '开战时没继承对手编成——预测/战果对照会断',
  )
  assert.equal(sortie().deckId, 2, 'deckId 没从 post 取')
  assert.ok(sortie().battle, '开战没有 battle')
})

test('没看过对手直接开战：照样是一场 active 会话，只是没有对手预告', () => {
  reset()
  feedPracticeBattle()
  assert.equal(sortie().active, true)
  assert.equal(sortie().practice, true)
  assert.equal(sortie().practiceOpponent, null)
})

test('模型用的判据与字幕侧那道闸逐字相同', () => {
  // 下一条测试拿 `active && practice` 当模型算静音窗口。模型与真闸一旦漂移，
  // 那条测试就会「绿得没意义」——所以先把真闸的写法钉在这里。
  const subtitle = fs.readFileSync(
    new URL('../src/renderer/voice-subtitle.ts', import.meta.url),
    'utf8',
  )
  assert.ok(
    subtitle.includes('if (mg.sortie?.active && mg.sortie.practice) return'),
    '字幕侧的演习拦截改写法了——下面那条模型要跟着改，否则算的不是同一件事',
  )
})

test('演习拦截的窗口：只覆盖真开战之后，不覆盖看对手那一段', () => {
  // 这是整件事的行为总结——直接按 voice-subtitle 那道闸的判据算一遍。
  const suppressed = (s) => !!(s?.active && s.practice)
  reset()
  feedEnemyInfo(enemyInfoBody())
  assert.equal(suppressed(sortie()), false, '看对手那一段仍在静音——bug 没修掉')
  feedPracticeBattle()
  assert.equal(suppressed(sortie()), true, '真演习时没静音——产品约定被破坏')
})
