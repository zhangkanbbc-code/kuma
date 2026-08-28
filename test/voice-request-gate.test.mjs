// 语音请求闸门的护栏。
//
// 钉的是 2026-08-22 用户实机撞到的那次回归：底部字幕「卡住不消失 + 在几句之间
// 高速轮换」。根因**不是**字幕的退场机制坏了（那个一直是好的），而是上游事件风暴
// 每秒二十几次把它重置——「听过即存」让游戏页替我们再发一次读缓存请求，
// 那一次同样被 webRequest 拦到，于是又出一次字幕、又问一次字节，自激成环。
//
// 所以这里两件事都要真跑一遍：①环关不关得死；②字幕层自己扛不扛得住风暴。
import assert from 'node:assert/strict'
import test from 'node:test'

import gate from '../dist/shared/voice-request-gate.js'
import plan from '../dist/shared/voice-archive-plan.js'

const {
  ASK_COOLDOWN_MS,
  CAPTION_DEDUPE_MS,
  SELF_FETCH_WINDOW_MS,
  createVoiceRequestGate,
  resourceVersionOf,
  shouldRenderCaption,
} = gate
const {
  VOICE_ARCHIVE_REQUIRED_FIELDS,
  sanitizeVoiceArchiveEntry,
  voiceArchiveHasBlobFor,
} = plan

const URL_A = 'https://w09s.kancolle-server.com/kcs/sound/kcxgkywfhkphjf/193212.mp3?version=112'
const URL_B = 'https://w09s.kancolle-server.com/kcs/sound/kcxgkywfhkphjf/152682.mp3?version=112'

test('自激循环关得死：我们自己那次读缓存请求不会再触发一次询问', () => {
  // 照真实回路模拟：一次「问」→ preload 1.2 秒后发 fetch（**两帧各一次**）
  // → 那两次 fetch 又走一遍 onBeforeRequest。缓存一直打不中（那正是故障当天的
  // 情形：URL 丢了 ?version=），所以「还没留住实物」恒为真。
  const g = createVoiceRequestGate()
  const ASK_DELAY = 1_200
  const FRAMES = 2
  let asks = 0
  let captions = 0
  /** 待发的自读请求：[时刻, url] */
  const scheduled = []

  const incoming = (url, now) => {
    if (g.claimSelfFetch(url, now)) return // 是我们自己发的，整段跳过
    captions++
    if (g.shouldAsk(url, now)) {
      asks++
      for (let frame = 0; frame < FRAMES; frame++) scheduled.push([now + ASK_DELAY, url])
    }
  }

  incoming(URL_A, 1_000) // 游戏真播了一句
  assert.equal(asks, 1)
  assert.equal(captions, 1)

  // 旧实现从这里开始指数发散（每轮请求数翻倍）。跑到队列自然枯竭为止，
  // 并给一个远大于任何合理值的上限，防止真发散时把测试挂死。
  let steps = 0
  while (scheduled.length && steps < 10_000) {
    steps++
    const [at, url] = scheduled.shift()
    incoming(url, at)
  }
  assert.ok(scheduled.length === 0, `回路必须自己枯竭，剩余 ${scheduled.length} 条`)
  assert.equal(asks, 1, '一次询问只该问一次，绝不能因为自己的 fetch 再问')
  assert.equal(captions, 1, '自己的 fetch 不该再出一次字幕')
  assert.equal(steps, FRAMES, '正好消化掉两帧各一次自读，然后停')
})

test('认领窗口是有界的：窗口过后同一条再响就是真播放', () => {
  const g = createVoiceRequestGate()
  assert.equal(g.shouldAsk(URL_A, 1_000), true)
  assert.equal(g.claimSelfFetch(URL_A, 1_000 + SELF_FETCH_WINDOW_MS - 1), true)
  // 认领**不延长**窗口——否则一条卡住的循环能靠不断认领给自己续命
  assert.equal(g.claimSelfFetch(URL_A, 1_000 + SELF_FETCH_WINDOW_MS + 1), false)
})

test('冷却期内不重复问；冷却过了还能补一次机会，但总次数封顶', () => {
  const g = createVoiceRequestGate()
  let now = 1_000
  assert.equal(g.shouldAsk(URL_A, now), true)
  now += ASK_COOLDOWN_MS - 1
  assert.equal(g.shouldAsk(URL_A, now), false, '冷却期内不该再问')
  now += 2
  assert.equal(g.shouldAsk(URL_A, now), true, '冷却过了要给第一次问太早的那条补机会')
  now += ASK_COOLDOWN_MS
  assert.equal(g.shouldAsk(URL_A, now), true)
  now += ASK_COOLDOWN_MS
  assert.equal(g.shouldAsk(URL_A, now), false, '同一条最多问三次，第二道硬上限')
})

test('不同 URL 各算各的（同一槽位换季就是另一个 URL）', () => {
  const g = createVoiceRequestGate()
  assert.equal(g.shouldAsk(URL_A, 1_000), true)
  assert.equal(g.shouldAsk(URL_B, 1_000), true)
  assert.equal(g.claimSelfFetch(URL_B, 1_100), true)
  assert.equal(g.size(), 2)
})

// ---- 字幕层：播完即退、多句不轮播 ----

test('同一条语音在窗口内只出一次字幕（退场计时器只挂一次）', () => {
  const seen = new Map()
  let now = 5_000
  assert.equal(shouldRenderCaption(seen, '/kcs/sound/kc1/1.mp3', now), true)
  assert.equal(shouldRenderCaption(seen, '/kcs/sound/kc1/1.mp3', now + 100), false)
  assert.equal(
    shouldRenderCaption(seen, '/kcs/sound/kc1/1.mp3', now + CAPTION_DEDUPE_MS + 1),
    true,
    '窗口过了要能再出——玩家隔一会儿再点她是真的又播了一次',
  )
})

test('事件风暴下不轮播：10 条语音各被打 20 次，只出 10 条字幕', () => {
  // 复现用户看到的那一幕：档案里 10 条路径同时以每秒 2 次的速度被重复触发。
  const seen = new Map()
  const paths = Array.from({ length: 10 }, (_, index) => `/kcs/sound/kc1/${100000 + index}.mp3`)
  let rendered = 0
  let triggered = 0
  let now = 0
  for (let round = 0; round < 20; round++) {
    now += 460 // 实测速率 ≈ 2.16 次/秒
    for (const path of paths) {
      triggered++
      if (shouldRenderCaption(seen, path, now)) rendered++
    }
  }
  assert.equal(triggered, 200)
  // 旧实现是 200 次全渲（于是字幕每秒重画二十几次、在十条之间轮换）。
  // 现在每条路径每 CAPTION_DEDUPE_MS 才可能再出一次，上界算得出来：
  const maxPerPath = Math.floor((20 * 460) / CAPTION_DEDUPE_MS) + 1
  assert.ok(
    rendered <= paths.length * maxPerPath,
    `每条路径最多 ${maxPerPath} 次，共 ${paths.length} 条，实际渲染 ${rendered}`,
  )
  assert.ok(rendered < triggered / 3, `字幕渲染次数应远小于触发次数，实际 ${rendered}/${triggered}`)
})

// ---- 版本参数：那次「0 条实物」的另一半根因 ----

test('从游戏真实 URL 里取得出 ?version=', () => {
  assert.equal(resourceVersionOf(URL_A), '112')
  assert.equal(
    resourceVersionOf('https://w09s.kancolle-server.com/kcs/sound/kc9999/414.mp3'),
    '',
    '本来就没有版本参数的（NPC 音轨实测）要给空串，不是编一个出来',
  )
  assert.equal(
    resourceVersionOf('https://host/kcs2/resources/ship/full/0961_6849_x.png?version=109&foo=1'),
    '109',
  )
})

test('「已经留住了」的判据连版本一起看：换季那一份必须还去取', () => {
  const kept = {
    pathname: '/kcs/sound/kc123/100234.mp3',
    version: '12',
    sha1: 'a'.repeat(16),
    bytes: 40_000,
    mstId: 0,
    voiceId: 0,
    firstHeard: 1,
    lastHeard: 2,
    heard: 1,
  }
  assert.equal(voiceArchiveHasBlobFor([kept], kept.pathname, '12'), true)
  assert.equal(
    voiceArchiveHasBlobFor([kept], kept.pathname, '13'),
    false,
    '官方换季推高了版本号，这一份是没见过的实物——过季就再也取不回来了',
  )
})

// ---- 「先收后认」：字段不许丢 ----

test('档案条目必带的回溯归因字段一个都不能少', () => {
  const entry = sanitizeVoiceArchiveEntry({
    pathname: '/kcs/sound/kc123/100234.mp3',
    version: '112',
    sha1: 'b'.repeat(16),
    bytes: 40_000,
    firstHeard: 1_700_000_000_000,
    lastHeard: 1_700_000_000_000,
    heard: 1,
  })
  assert.ok(entry)
  for (const field of VOICE_ARCHIVE_REQUIRED_FIELDS) {
    assert.ok(field in entry, `${field} 丢了——当季听到、清单还没誊写的那些就失去归因依据了`)
  }
  // 归因不在存的时候做：路径本身就带着 (舰, 槽位)，清单更新后自然对得上号
  assert.equal(entry.pathname, '/kcs/sound/kc123/100234.mp3')
  assert.equal(entry.version, '112')
})

test('版本参数形状不对时只丢版本，不丢整条实物', () => {
  const entry = sanitizeVoiceArchiveEntry({
    pathname: '/kcs/sound/kc123/100234.mp3',
    version: '<script>',
    sha1: 'c'.repeat(16),
    bytes: 40_000,
  })
  assert.ok(entry, '版本记不下来只是少一层线索，实物本身仍然值得留住')
  assert.equal(entry.version, '')
})

test('路径形状不对的一律拒（这个桥对游戏页任何脚本都可达）', () => {
  assert.equal(sanitizeVoiceArchiveEntry({ pathname: '/etc/passwd' }), null)
  assert.equal(sanitizeVoiceArchiveEntry({ pathname: '/kcs/sound/../../x.mp3' }), null)
  assert.equal(sanitizeVoiceArchiveEntry(null), null)
})
