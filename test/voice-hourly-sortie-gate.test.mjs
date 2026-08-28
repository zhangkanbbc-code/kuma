// 出击中过整点，不弹时报字幕（2026-08-27 用户实机撞到）。
//
// ---- 这一幕是怎么发生的 ----
// 30..53 号是整点报时资源，游戏**登录时就预取**，实际播放在下一个整点。
// 字幕层为此把这一条推迟到整点再放（防剧透，与 poi-plugin-subtitle 一致）。
// 缺的是到点那一刻的场景判断：预取时人在母港，到点时已经出击，
// 游戏在出击/战斗里根本不播这句语音，字幕却照弹——屏幕上出现了没人说过的话。
//
// ⚠️ 门必须查**到点那一刻**的状态，不是排定那一刻：出击途中排下的这一个，
// 只要回港赶得及，照常出。这两个方向反过来都会错，且都不报错。
//
// ⚠️ 丢弃，不顺延：游戏回港后不会补播这个整点。顺延会让字幕在一个
// 游戏根本没出声的时刻冒出来——那是把 bug 换了个时间点，不是修好。
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AT_PORT,
  IN_BATTLE,
  IN_PRACTICE,
  ON_SORTIE,
  millisToNextHour,
  runHourly,
} from './fixtures/hourly-voice-gate.mjs'

test('母港预取、出击中到点：不出字幕（用户实机撞到的那一幕）', () => {
  const run = runHourly({ atSchedule: AT_PORT, atFire: ON_SORTIE })
  assert.deepEqual(run.text, [], '出击中弹了时报字幕——游戏此刻并没有播这句')
})

test('母港预取、到点还在母港：照常出', () => {
  const run = runHourly({ atSchedule: AT_PORT, atFire: AT_PORT })
  assert.deepEqual(run.text, ['一点です。'], '母港整点该出的字幕被一起挡掉了')
  assert.equal(run.shown[0]?.mode, 'bottom', '时报跑到弹幕层去了')
})

test('出击途中排下的、回港后到点：照常出（门查的是到点时刻）', () => {
  // 把门写在 setTimeout 外面（查排定时刻）就会在这里翻车：
  // 排的时候在出击，直接不排，回港之后整点就哑了。
  const run = runHourly({ atSchedule: ON_SORTIE, atFire: AT_PORT })
  assert.deepEqual(run.text, ['一点です。'], '回港后到点没出字幕——门查成了排定时刻')
})

test('演习中到点：一样不出', () => {
  // 演习也是 `sortie.active`，游戏同样不播时报。
  const run = runHourly({ atSchedule: AT_PORT, atFire: IN_PRACTICE })
  assert.deepEqual(run.text, [], '演习中弹了时报字幕')
})

test('战斗中到点：一样不出', () => {
  const run = runHourly({ atSchedule: AT_PORT, atFire: IN_BATTLE })
  assert.deepEqual(run.text, [], '战斗中弹了时报字幕')
})

test('挡掉之后是丢弃，不留一个顺延的计时器', () => {
  const run = runHourly({ atSchedule: AT_PORT, atFire: ON_SORTIE })
  assert.deepEqual(run.remaining, [], '把这一句顺延到了以后——游戏回港不会补播这个整点')
})

test('防剧透那条没被改坏：到点之前一句都不出', () => {
  const run = runHourly({ atSchedule: AT_PORT, atFire: AT_PORT })
  assert.equal(run.shownBeforeHour, 0, '预取一到就把时报刷出来了——登录时会剧透整点台词')
  assert.equal(run.scheduled.length, 1, '时报没有被推迟到整点')
})

test('推迟的就是到下一个整点那段时间', () => {
  const before = millisToNextHour()
  const run = runHourly({ atSchedule: AT_PORT, atFire: AT_PORT })
  const after = millisToNextHour()
  const delay = run.scheduled[0]
  assert.ok(
    delay <= before && delay >= after - 1000,
    `推迟了 ${delay}ms，不是到下一个整点（${after}..${before}）`,
  )
})

test('时报的每一句都过这道门，不是只挡第一句', () => {
  const lines = [
    { speaker: '雪风', text: '一点です。', delay: 0 },
    { speaker: '雪风', text: '司令、起きてます？', delay: 0 },
  ]
  assert.deepEqual(
    runHourly({ atSchedule: AT_PORT, atFire: AT_PORT, lines }).text,
    ['一点です。', '司令、起きてます？'],
    '母港整点漏了后面几句',
  )
  assert.deepEqual(
    runHourly({ atSchedule: AT_PORT, atFire: ON_SORTIE, lines }).text,
    [],
    '出击中漏出了后面几句',
  )
})

test('这道门只管时报：别的语音出击中照常出', () => {
  // 门要是加在 displayAtPlaybackTime 顶上，战斗语音会跟着一起哑——
  // 那才是真的把功能砍了。29 与 54 卡在 30..53 两侧。
  for (const voiceId of [29, 54]) {
    const run = runHourly({
      atSchedule: IN_BATTLE,
      cue: { kind: 'ship', mstId: 1, voiceId },
      lines: [{ speaker: '雪风', text: '当たらなければどうということはない！', delay: 0 }],
    })
    assert.deepEqual(run.scheduled, [], `${voiceId} 号被当成时报推迟到整点了`)
    assert.equal(run.shownBeforeHour, 1, `${voiceId} 号在战斗中被挡掉了`)
    assert.equal(run.shown[0]?.mode, 'friendly', `${voiceId} 号没走战斗弹幕层`)
  }
})

test('敌方语音不受影响', () => {
  const run = runHourly({
    atSchedule: IN_BATTLE,
    cue: { kind: 'enemy', voiceId: 30 },
    lines: [{ speaker: '深海棲艦', text: '……', delay: 0 }],
  })
  assert.equal(run.shownBeforeHour, 1, '深海语音被时报那道门连坐了（kind 没查）')
  assert.equal(run.shown[0]?.mode, 'enemy')
})
