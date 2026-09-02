import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { correctLegacyDropForm } from '../scripts/lib/map-drops.mjs'
import atomicJson from '../dist/main/atomic-json.js'
import battle from '../dist/main/mg/battle.js'
import factoryStatsModule from '../dist/main/mg/factory-stats.js'
import lodeIdsModule from '../dist/shared/lode-ids.js'
import lodeValidation from '../dist/main/lode-validation.js'
import postBodyRedactModule from '../dist/main/mg/post-body-redact.js'
import powerupResultModule from '../dist/main/mg/powerup-result.js'
import questStateModule from '../dist/main/mg/quest-state.js'
import questPeriod from '../dist/shared/quest-period.js'
import routingEngineModule from '../dist/shared/routing-engine.js'
import remodelChainModule from '../dist/shared/ship-remodel-chain.js'
import slotitemMutationModule from '../dist/shared/slotitem-mutation.js'
import soundPath from '../dist/shared/voice-sound-path.js'
import voiceSlots from '../dist/shared/voice-scene-slots.js'
import gameAudioModule from '../assets/preload/game-audio.js'
import { abyssVoiceMstIdFromKey } from '../scripts/lib/kcwiki-voice.mjs'

const rendererIndexHtml = fs.readFileSync(
  new URL('../src/renderer/index.html', import.meta.url),
  'utf8',
)
const battleReplayCss = fs.readFileSync(
  new URL('../src/renderer/assets/battle-replay.css', import.meta.url),
  'utf8',
)
// 原有样式护栏继续按主页面的真实级联顺序检查；共享文件在 link 原位展开，
// 不把「仍写在 index.html 内联」误当成视觉规则本身。
const rendererSource = rendererIndexHtml.replace(
  '  <link rel="stylesheet" href="assets/battle-replay.css">\n',
  `<style>\n${battleReplayCss}</style>\n`,
)

const { atomicWriteJsonSync } = atomicJson
const {
  parseBaseDefenseBattle,
  parseBattle,
  predictPracticeRank,
  predictRank,
  reconcileBattle,
  upgradeBattleView,
} = battle
const { aggregateFactoryStats } = factoryStatsModule
const { validateLodePack } = lodeValidation
const { CONSUMED_LODE_IDS } = lodeIdsModule
const { API_TOKEN_PLACEHOLDER, redactPostBody } = postBodyRedactModule
const { buildPowerupResultCue } = powerupResultModule
const { reduceQuestList } = questStateModule
const { evaluateRoutingRules } = routingEngineModule
const { buildShipRemodelChains } = remodelChainModule
const { applySlotitemInventoryMutation, destroyedSlotitemIds } = slotitemMutationModule
const {
  GAME_AUDIO_POLICY,
  classifyGameAudioUrl,
  gameAudioGainFor,
  installGameAudioControl,
  normalizeGameAudioSettings,
} = gameAudioModule
const { questAnnualMonth, questPeriodFromCode, questPeriodKey, questPeriodStart } = questPeriod
const reconciliationFixtures = JSON.parse(
  fs.readFileSync(new URL('./fixtures/battle-reconciliation.json', import.meta.url), 'utf8'),
)

test('game audio master volume and voice/BGM-only modes use exact resource classes', () => {
  // 下面这些都是**从本机缓存里抄出来的真实地址形态**（2026-08-26，游戏 6.3.4.0）。
  // 游戏拼语音地址只有两族：舰娘台词走 voice_root（`/kcs/sound/kc<键>/<号>.mp3`，
  // 带 ?version=N），titlecall/tutorial 走 path_root（`/kcs2/resources/voice/<名>/<号>.mp3`）。
  // 从前这里写的 `/kcs/sound/titlecall/999.mp3` 是**臆造的**，游戏从不发这种地址，
  // 而真的那族当时一条都匹配不上——护栏绿着，titlecall 却在按普通音效播。
  assert.equal(
    classifyGameAudioUrl('https://w09s.kancolle-server.com/kcs/sound/kcikwmknqjpvkg/167370.mp3?version=15'),
    'voice',
  )
  // 9997~9999 那三个不查 ship_graph，键就是号本身
  assert.equal(
    classifyGameAudioUrl('https://w09s.kancolle-server.com/kcs/sound/kc9999/414.mp3'),
    'voice',
  )
  assert.equal(
    classifyGameAudioUrl('https://w09s.kancolle-server.com/kcs2/resources/voice/titlecall_1/047.mp3'),
    'voice',
  )
  assert.equal(
    classifyGameAudioUrl('https://w09s.kancolle-server.com/kcs2/resources/voice/titlecall_2/012.mp3'),
    'voice',
  )
  assert.equal(
    classifyGameAudioUrl('https://w09s.kancolle-server.com/kcs2/resources/bgm/battle/275_1741.mp3'),
    'bgm',
  )
  assert.equal(
    classifyGameAudioUrl('https://w09s.kancolle-server.com/kcs2/resources/bgm/port/102_2564.mp3'),
    'bgm',
  )
  // SE 就该是「其他」：它和 BGM 只差一个目录名，别把 se/battle/ 也算进 BGM
  assert.equal(
    classifyGameAudioUrl('https://w09s.kancolle-server.com/kcs2/resources/se/241.mp3'),
    'other',
  )
  assert.equal(
    classifyGameAudioUrl('https://203.104.209.7/kcs2/resources/se/battle/attack.mp3'),
    'other',
  )

  assert.deepEqual(
    normalizeGameAudioSettings({
      volume: 3,
      voiceVolume: -1,
      bgmVolume: 3,
      mode: 'invalid',
    }),
    {
    volume: 1,
    voiceVolume: 0,
    bgmVolume: 2,
    mode: 'all',
    },
  )
  const mixed = { volume: 0.5, voiceVolume: 1.8, bgmVolume: 0.4, mode: 'all' }
  assert.equal(gameAudioGainFor(mixed, 'voice'), 0.9)
  assert.equal(gameAudioGainFor(mixed, 'bgm'), 0.2)
  assert.equal(gameAudioGainFor(mixed, 'other'), 0.5)
  assert.equal(gameAudioGainFor({ ...mixed, mode: 'voice' }, 'voice'), 0.9)
  assert.equal(gameAudioGainFor({ ...mixed, mode: 'voice' }, 'bgm'), 0)
  assert.equal(gameAudioGainFor({ ...mixed, mode: 'voice' }, 'other'), 0)
  assert.equal(gameAudioGainFor({ ...mixed, mode: 'bgm' }, 'bgm'), 0.2)
  assert.equal(gameAudioGainFor({ ...mixed, mode: 'bgm' }, 'voice'), 0)
})

/**
 * 造一个够用的假 window：只摆钩子真会去碰的那几样。
 * `response` 特意做成**原型上的 getter**（真 XHR 就是这样），
 * 这样「读 response 时登记」那条兜底路也在测试里真跑到。
 */
const makeAudioWindow = (settings) => {
  const gains = []
  const dispatched = []
  class FakeXHR {
    constructor() {
      this._listeners = {}
      this._response = null
    }
    open(_method, url) {
      this._url = url
    }
    addEventListener(type, fn) {
      ;(this._listeners[type] ||= []).push(fn)
    }
    set onload(fn) {
      this.addEventListener('load', fn)
    }
    send() {
      this._response = new ArrayBuffer(8)
      this.responseURL = this._url
      // 监听器按注册顺序触发——真浏览器就是这样，也正是这个 bug 的成因
      for (const fn of this._listeners.load || []) {
        dispatched.push(fn)
        fn.call(this)
      }
    }
  }
  Object.defineProperty(FakeXHR.prototype, 'response', {
    configurable: true,
    get() {
      return this._response
    },
  })
  class FakeAudioParam {}
  class FakeGain {
    constructor() {
      this.gain = { value: 1 }
      gains.push(this)
    }
    connect() {}
    disconnect() {}
  }
  class FakeBufferSource {
    connect() {}
    disconnect() {}
    addEventListener() {}
  }
  Object.defineProperty(FakeBufferSource.prototype, 'buffer', {
    configurable: true,
    get() {
      return this._buffer ?? null
    },
    set(value) {
      this._buffer = value
    },
  })
  class FakeAudioContext {
    decodeAudioData(_buffer, success) {
      // 真 AudioBuffer 带 duration（秒）。这是整条链上唯一拿得到音轨真实长度的地方，
      // 字幕层就靠它算退场时刻（见 shared/voice-caption-hold）。
      const decoded = { decoded: true, duration: 18.4 }
      if (typeof success === 'function') {
        success(decoded)
        return decoded
      }
      return Promise.resolve(decoded)
    }
    createBufferSource() {
      return new FakeBufferSource()
    }
    createGain() {
      return new FakeGain()
    }
  }
  class FakeMedia {}
  Object.defineProperty(FakeMedia.prototype, 'volume', {
    configurable: true,
    get() {
      return this._volume ?? 1
    },
    set(value) {
      this._volume = value
    },
  })
  return {
    gains,
    window: {
      WeakMap,
      Map,
      Set,
      // 用子类：钩子会往 prototype / 静态位上写，直接给真的会污染整个测试进程
      URL: class TestUrl extends URL {},
      ArrayBuffer,
      location: { href: 'https://w09s.kancolle-server.com/kcs2/index.php' },
      XMLHttpRequest: FakeXHR,
      AudioContext: FakeAudioContext,
      AudioBufferSourceNode: FakeBufferSource,
      AudioParam: FakeAudioParam,
      HTMLMediaElement: FakeMedia,
      document: { addEventListener: () => {} },
      setInterval: () => 1,
      kansoPreloadBridge: { getGameAudioSettings: () => settings },
    },
  }
}

const withAudioWindow = (settings, body) => {
  const previousWindow = globalThis.window
  const { window, gains } = makeAudioWindow(settings)
  try {
    globalThis.window = window
    installGameAudioControl(GAME_AUDIO_POLICY)
    return body(window, gains)
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
}

/**
 * 游戏用 howler 2.2.0 装语音：`open` → `responseType='arraybuffer'` →
 * **装 onload** → `send`。艦素从前把「记下资源地址」挂在 `send` 里，
 * 于是它的监听器排在游戏 onload 后面：decodeAudioData 拿到 ArrayBuffer 时
 * 地址还没记上，语音就落进「其他」——只乘总音量，语音滑条 100% 和 30% 一样响
 *（2026-08-26 用户实机报的就是这个）。BGM 因为走 `<audio>` 那条链，一直是好的。
 *
 * 所以这条护栏必须**照抄那个顺序**：先装 onload 再 send。
 * 只测 classifyGameAudioUrl 是抓不到的——分类函数当时就是对的。
 */
test('game audio: howler 的装载顺序下语音仍吃语音分项', () => {
  const settings = { volume: 1, voiceVolume: 0.3, bgmVolume: 0.5, mode: 'all' }
  const playThroughHowler = (url) =>
    withAudioWindow(settings, (window, gains) => {
      const ctx = new window.AudioContext()
      const xhr = new window.XMLHttpRequest()
      xhr.open('GET', url, true)
      xhr.responseType = 'arraybuffer'
      let decoded = null
      // ↓ 顺序照抄 howler：先装 onload
      xhr.onload = function () {
        ctx.decodeAudioData(xhr.response, (buffer) => {
          decoded = buffer
        })
      }
      xhr.send()
      const before = gains.length
      const source = ctx.createBufferSource()
      source.buffer = decoded
      return gains[before].gain.value
    })

  assert.equal(
    playThroughHowler('https://w09s.kancolle-server.com/kcs/sound/kcikwmknqjpvkg/167370.mp3?version=15'),
    0.3,
    '舰娘语音没吃语音分项——多半又是登记比解码晚了',
  )
  assert.equal(
    playThroughHowler('https://w09s.kancolle-server.com/kcs2/resources/voice/titlecall_1/047.mp3'),
    0.3,
    'titlecall 没吃语音分项',
  )
  // SE 走同一条 WebAudio 链，但它不该被语音滑条带着走
  assert.equal(
    playThroughHowler('https://w09s.kancolle-server.com/kcs2/resources/se/241.mp3'),
    1,
    'SE 被算成语音了',
  )
})

test('game audio: BGM 走 <audio> 那条链，音量仍按 BGM 分项缩放', () => {
  const settings = { volume: 1, voiceVolume: 0.3, bgmVolume: 0.5, mode: 'all' }
  const applied = withAudioWindow(settings, (window) => {
    const media = new window.HTMLMediaElement()
    media.src = 'https://w09s.kancolle-server.com/kcs2/resources/bgm/port/102_2564.mp3'
    media.currentSrc = media.src
    media.volume = 1
    return media._volume
  })
  assert.equal(applied, 0.5)
})

test('game audio: 自检快照按帧报回捕获计数与最近解码', () => {
  const settings = { volume: 1, voiceVolume: 0.3, bgmVolume: 1, mode: 'all' }
  const snapshot = withAudioWindow(settings, (window) => {
    const ctx = new window.AudioContext()
    const xhr = new window.XMLHttpRequest()
    xhr.open('GET', 'https://w09s.kancolle-server.com/kcs/sound/kc9999/414.mp3', true)
    xhr.onload = function () {
      ctx.decodeAudioData(xhr.response, () => {})
    }
    xhr.send()
    return window.kansoGameAudioStats()
  })
  assert.equal(snapshot.length, 1, '顶层帧那份快照没登记上')
  assert.ok(snapshot[0].captures.xhr >= 1, 'XHR 那条捕获路一次都没记上')
  assert.deepEqual(snapshot[0].decodes, [{ path: '/kcs/sound/kc9999/414.mp3', category: 'voice' }])
  // 计数是只读的：快照里给的是副本，改它不该回写进钩子
  snapshot[0].captures.xhr = 999
})

/**
 * 长台词字幕提前消失（2026-08-26 用户实报）那件事的上游一半。
 *
 * 字幕退场此前只有一条字数公式，9 秒封顶——而时报/婚礼/长句的音轨十几到二十几秒
 * 都有，于是语音还在播、字幕先走了。真实长度只有 decodeAudioData 解完那一刻拿得到
 *（上游 webRequest 只看得见地址），所以钩子把它记下来，字幕层到期时来查。
 *
 * **单独一个只收语音的环**，不搭 stats.decodes 的车：那个环只有 10 条又什么都收，
 * 一进战斗满屏 SE 几秒就能把语音全冲出去，字幕到期时正好一条都查不着。
 */
test('game audio: 语音的真实时长单独记一份，SE 不占这个环', () => {
  const settings = { volume: 1, voiceVolume: 1, bgmVolume: 1, mode: 'all' }
  const load = (window, ctx, url) => {
    const xhr = new window.XMLHttpRequest()
    xhr.open('GET', url, true)
    xhr.onload = function () {
      ctx.decodeAudioData(xhr.response, () => {})
    }
    xhr.send()
  }
  const snapshot = withAudioWindow(settings, (window) => {
    const ctx = new window.AudioContext()
    load(window, ctx, 'https://w09s.kancolle-server.com/kcs/sound/kc9999/414.mp3?version=112')
    load(window, ctx, 'https://w09s.kancolle-server.com/kcs2/resources/se/241.mp3')
    return window.kansoGameAudioStats()
  })
  // 秒 → 毫秒；键是 pathname（?version= 不进去），与 kcs-resource emit 给字幕层的那一份对得上
  assert.deepEqual(snapshot[0].voiceDurations, [{ path: '/kcs/sound/kc9999/414.mp3', ms: 18_400 }])
})

test('game audio: 时长环收 24 条，满了扔最旧的——战斗里的音效冲不掉刚播的那句语音', () => {
  const settings = { volume: 1, voiceVolume: 1, bgmVolume: 1, mode: 'all' }
  const snapshot = withAudioWindow(settings, (window) => {
    const ctx = new window.AudioContext()
    for (let index = 0; index < 30; index += 1) {
      const xhr = new window.XMLHttpRequest()
      xhr.open('GET', `https://w09s.kancolle-server.com/kcs/sound/kc9999/${index}.mp3`, true)
      xhr.onload = function () {
        ctx.decodeAudioData(xhr.response, () => {})
      }
      xhr.send()
    }
    return window.kansoGameAudioStats()
  })
  const paths = snapshot[0].voiceDurations.map((entry) => entry.path)
  assert.equal(paths.length, 24)
  assert.equal(paths[0], '/kcs/sound/kc9999/6.mp3')
  assert.equal(paths.at(-1), '/kcs/sound/kc9999/29.mp3')
})

test('game audio controls install before game scripts and notifications reset per app session', () => {
  const preload = fs.readFileSync(
    new URL('../assets/preload/webview-preload.js', import.meta.url),
    'utf8',
  )
  const audio = fs.readFileSync(new URL('../assets/preload/game-audio.js', import.meta.url), 'utf8')
  const config = fs.readFileSync(new URL('../src/main/config.ts', import.meta.url), 'utf8')
  const fallback = fs.readFileSync(
    new URL('../src/main/webcontent-utils.ts', import.meta.url),
    'utf8',
  )
  const settings = fs.readFileSync(new URL('../src/renderer/modules/yu.ts', import.meta.url), 'utf8')
  const notifications = fs.readFileSync(
    new URL('../src/renderer/modules/lg.ts', import.meta.url),
    'utf8',
  )

  assert.match(preload, /getGameAudioSettings:/)
  assert.match(preload, /installInMainWorld\('game-audio', installGameAudioControl, \[GAME_AUDIO_POLICY\]\)/)
  assert.match(audio, /audioContextProto\.createBufferSource = function/)
  assert.match(audio, /Object\.defineProperty\(mediaProto, 'volume'/)
  assert.match(audio, /settings\.mode === 'all' \|\| settings\.mode === category/)
  assert.match(
    config,
    /gameAudio: \{ volume: 1, voiceVolume: 1, bgmVolume: 1, mode: 'all' \}/,
  )
  assert.match(fallback, /window\.kansoAudioControlInstalled/)
  assert.match(preload, /voiceVolume: Number\.isFinite\(rawVoiceVolume\)/)
  assert.match(preload, /bgmVolume: Number\.isFinite\(rawBgmVolume\)/)
  assert.match(settings, /data-audio-volume="\$\{field\}"/)
  assert.match(
    settings,
    /audioVolumeHtml\('voiceVolume', '语音', readAudioVolume\('voiceVolume'\), 200\)/,
  )
  assert.match(
    settings,
    /audioVolumeHtml\('bgmVolume', 'BGM', readAudioVolume\('bgmVolume'\), 200\)/,
  )
  assert.match(settings, /max="\$\{maxPercent\}"/)
  assert.match(settings, /data-audio-mode/)
  assert.match(settings, /仅语音/)
  assert.match(settings, /仅 BGM/)

  // 通知历史：回看恢复了，重放没有。`aa6c55c` 当初整个删掉历史是因为重开后
  // 陈旧通知会重新弹；现在历史落在账本里，靠 session 把两者分开——
  // 配置文件不再存历史，未读只算本次开机，恢复回来的一律按已读。
  assert.match(notifications, /uiSet\(LOG_KEY, \[\]\)/)
  assert.doesNotMatch(notifications, /uiGet<Notice\[\]>\(LOG_KEY/)
  assert.match(notifications, /const SESSION = Date\.now\(\)/)
  assert.match(notifications, /notice\.session === SESSION/)
  assert.match(notifications, /void markNoticesRead\('all'\)/)
  assert.doesNotMatch(notifications, /仅保留当前会话/)
  // ⚠️ 这三条整个反过来了（2026-08-23 用户拍板，出处与理由见 shared/ledger-retention
  // 的文件头与 test/ledger-retention.test.mjs）：通知历史那个写死的 14 日滚动退役，
  // 跟随钥里那个保留天数（不设就不清）。原先钉的是「脚注必须写出留存期」——
  // 现在没有固定留存期可写，改成钉**两处不许各说各话**：空态与脚注都不许再声称一个天数。
  assert.doesNotMatch(notifications, /保留 14 天/)
  // 2026-08-26 文案清扫：空态尾巴「收到的会留在这里」删掉，只留状态本体
  assert.match(notifications, /暂无通知<\/div>/)
  assert.match(notifications, /<div class="c-foot"><span class="lk" data-act="clear"/)
  const ledgerSrc = fs.readFileSync(new URL('../src/main/mg/ledger.ts', import.meta.url), 'utf8')
  assert.match(ledgerSrc, /CREATE TABLE IF NOT EXISTS notify_log/)
  // 手动的「清空通知历史」保留（铃里那个钮），自动那条按计划走
  assert.match(ledgerSrc, /DELETE FROM notify_log/)
  assert.doesNotMatch(ledgerSrc, /const NOTIFY_RETENTION_DAYS = 14/)

  const previousWindow = globalThis.window
  try {
    globalThis.window = {
      WeakMap,
      Map,
      Set,
      URL: class TestUrl {},
      location: { href: 'https://example.invalid/' },
      setInterval: () => 1,
      kansoPreloadBridge: {
        getGameAudioSettings: () => ({
          volume: 0.5,
          voiceVolume: 1.5,
          bgmVolume: 0.8,
          mode: 'voice',
        }),
      },
    }
    installGameAudioControl(GAME_AUDIO_POLICY)
    assert.equal(globalThis.window.kansoAudioControlInstalled, true)
    assert.equal(typeof globalThis.window.installKansoAudioControl, 'function')
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})

test('partial native upgrade tables keep legacy aftership remodel chains intact', () => {
  const result = buildShipRemodelChains(
    [
      { id: 517, sortNo: 317, afterId: 376 },
      { id: 376, sortNo: 1456, afterId: 0 },
      { id: 184, sortNo: 190, afterId: 185 },
      { id: 185, sortNo: 318, afterId: 318 },
      { id: 318, sortNo: 883, afterId: 0 },
    ],
    [{ targetId: 318, currentShipId: 185, originalShipId: 184, stage: 2 }],
  )
  assert.deepEqual(result.chainOf.get(517), [517, 376])
  assert.equal(result.rootOf.get(376), 517)
  assert.deepEqual(result.chainOf.get(184), [184, 185, 318])
})

test('equipment inventory mutations delete exact instances and add newly created items', () => {
  const slotitems = {
    101: { mstId: 1, level: 0, alv: 0, locked: false },
    102: { mstId: 2, level: 3, alv: 0, locked: true },
    103: { mstId: 3, level: 0, alv: 7, locked: false },
  }
  const post = { api_slotitem_ids: '101,103' }
  assert.deepEqual(destroyedSlotitemIds(post), [101, 103])
  assert.equal(
    applySlotitemInventoryMutation(
      slotitems,
      '/kcsapi/api_req_kousyou/destroyitem2',
      { api_get_material: [0, 0, 2, 0] },
      post,
    ),
    true,
  )
  assert.deepEqual(Object.keys(slotitems), ['102'])

  assert.equal(
    applySlotitemInventoryMutation(
      slotitems,
      '/kcsapi/api_req_kousyou/createitem',
      {
        api_get_item: {
          api_id: 104,
          api_slotitem_id: 4,
          api_level: 2,
          api_alv: 6,
          api_locked: 0,
        },
      },
      {},
    ),
    true,
  )
  assert.deepEqual(slotitems[104], { mstId: 4, level: 2, alv: 6, locked: false })
})

test('equipment inventory mutations cover remodel, recovery, item use, and lock changes', () => {
  const slotitems = {
    201: { mstId: 10, level: 4, alv: 0, locked: true },
    202: { mstId: 10, level: 0, alv: 0, locked: false },
  }
  assert.equal(
    applySlotitemInventoryMutation(
      slotitems,
      '/kcsapi/api_req_kousyou/remodel_slot',
      {
        api_remodel_flag: 1,
        api_use_slot_id: [202],
        api_after_slot: {
          api_id: 201,
          api_slotitem_id: 11,
          api_level: 0,
          api_alv: 0,
          api_locked: 1,
        },
      },
      {},
    ),
    true,
  )
  assert.equal(slotitems[202], undefined)
  assert.deepEqual(slotitems[201], { mstId: 11, level: 0, alv: 0, locked: true })

  assert.equal(
    applySlotitemInventoryMutation(
      slotitems,
      '/kcsapi/api_req_kousyou/remodel_slot_recover',
      {
        api_after_slot: {
          api_id: 201,
          api_slotitem_id: 11,
          api_level: 1,
          api_alv: 0,
          api_locked: 1,
        },
      },
      {},
    ),
    true,
  )
  assert.equal(slotitems[201].level, 1)

  assert.equal(
    applySlotitemInventoryMutation(
      slotitems,
      '/kcsapi/api_req_member/itemuse',
      {
        api_getitem: [{
          api_slotitem: {
            api_id: 203,
            api_slotitem_id: 12,
            api_level: 0,
            api_alv: 0,
            api_locked: 0,
          },
        }],
      },
      {},
    ),
    true,
  )
  assert.equal(slotitems[203].mstId, 12)

  assert.equal(
    applySlotitemInventoryMutation(
      slotitems,
      '/kcsapi/api_req_kaisou/lock',
      { api_locked: 1 },
      { api_slotitem_id: '203' },
    ),
    true,
  )
  assert.equal(slotitems[203].locked, true)
})

test('equipment inventory sync persists and replays without breaking scrap quest classification', () => {
  const main = fs.readFileSync(new URL('../src/main/mg/index.ts', import.meta.url), 'utf8')
  const store = fs.readFileSync(new URL('../src/main/mg/store.ts', import.meta.url), 'utf8')
  const ledger = fs.readFileSync(new URL('../src/main/mg/ledger.ts', import.meta.url), 'utf8')
  const quest = fs.readFileSync(new URL('../src/main/mg/quest-counter.ts', import.meta.url), 'utf8')

  assert.match(store, /applySlotitemInventoryMutation\([\s\S]*?destroyitem2/)
  assert.match(store, /slotitems: state\.player\.slotitems/)
  assert.match(main, /'slotitems',/)
  assert.match(main, /destroyedSlotitemIds\(postBody\)/)
  // context 一律带**动作前**才拿得到的那几样：被删的装备实例、远征 missionId
  // （归约器会把 deck.mission 清零）、近代化改修双方的图鉴 id（素材舰当场被删）
  assert.match(
    main,
    /onQuestApi\(apiPath, body, postBody, \{ destroyedSlotitems, expeditionMissionId, powerupShipIds \}\)/,
  )
  assert.match(main, /loadSlotitemMutationsSince\(slotitemBaselineTs\)/)
  assert.match(ledger, /loadLatestSlotitemList =/)
  assert.match(ledger, /loadSlotitemMutationsSince =/)
  assert.match(ledger, /'\/kcsapi\/api_req_kousyou\/remodel_slot'/)
  assert.match(ledger, /'\/kcsapi\/api_req_member\/itemuse'/)
  assert.match(quest, /context\.destroyedSlotitems \?\? store\.getState\(\)\.player\.slotitems/)
})

test('live state mutations broadcast every displayed slice without waiting for port', () => {
  const store = fs.readFileSync(new URL('../src/main/mg/store.ts', import.meta.url), 'utf8')
  const main = fs.readFileSync(new URL('../src/main/mg/index.ts', import.meta.url), 'utf8')
  const fleet = fs.readFileSync(new URL('../src/renderer/modules/ru.ts', import.meta.url), 'utf8')
  const expedition = fs.readFileSync(new URL('../src/renderer/modules/bi.ts', import.meta.url), 'utf8')
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const roster = fs.readFileSync(new URL('../src/renderer/modules/qa.ts', import.meta.url), 'utf8')

  for (const endpoint of [
    '/kcsapi/api_req_hensei/preset_select',
    '/kcsapi/api_req_hensei/lock',
    '/kcsapi/api_req_kaisou/lock',
    '/kcsapi/api_req_kaisou/slot_exchange_index',
    '/kcsapi/api_req_kaisou/slot_deprive',
    '/kcsapi/api_req_mission/start',
    '/kcsapi/api_req_mission/return_instruction',
    '/kcsapi/api_req_air_corps/change_deployment_base',
    '/kcsapi/api_req_air_corps/change_name',
    '/kcsapi/api_req_kousyou/createship_speedchange',
  ]) {
    assert.match(store, new RegExp(endpoint.replaceAll('/', '\\/')))
  }
  assert.match(store, /patchMaterialValues\(body\)/)
  assert.match(store, /applyMapMaterialDelta\(body\)/)
  assert.match(store, /Number\(post\.api_slot_dest_flag\) !== 0/)
  assert.match(store, /incrementUseitem\([\s\S]*?api_get_exmap_useitem_id/)
  assert.match(main, /'mapGauges',\s*'eventAreas',\s*'airBases'/)
  assert.match(
    fleet,
    /'airBases',\s*'eventAreas',\s*'sortie',/,
  )
  assert.match(fleet, /'ndocks',\s*'basic',\s*'master'/)
  assert.match(expedition, /'slotitems',\s*'ndocks',\s*'quests'/)
  assert.match(catalog, /'materials',\s*'basic',\s*'eventAreas'/)
  // 行缓存作废含 decks：在编标注（2026-08-17）跟着编成变化走
  assert.match(roster, /'ndocks',\s*'decks',\s*'basic',\s*'master'/)
})

test('reversible fallback remodels stay in one bounded chain', () => {
  const result = buildShipRemodelChains(
    [
      { id: 1, sortNo: 10, afterId: 2 },
      { id: 2, sortNo: 20, afterId: 1 },
    ],
    [],
  )
  assert.deepEqual(result.chainOf.get(1), [1, 2])
  assert.equal(result.rootOf.get(2), 1)
})

test('night-to-day battles are marked as having a night phase', () => {
  const result = parseBattle(
    '/kcsapi/api_req_combined_battle/ec_night_to_day',
    {
      api_f_nowhps: [10],
      api_f_maxhps: [10],
      api_ship_ke: [1501],
      api_ship_lv: [1],
      api_e_nowhps: [10],
      api_e_maxhps: [10],
      api_n_hougeki1: { api_at_list: [] },
    },
    {
      fleetShips: () => [{ rosterId: 1, mstId: 1, name: 'F', lv: 1 }],
      masterName: () => 'E',
    },
    Date.now(),
  )
  assert.equal(result.hasNight, true)
})

test('perfect victory remains S and is distinguished from an ordinary S without inventing SS', () => {
  const ship = (hpStart, hpEnd) => ({
    hpStart,
    hpEnd,
    escaped: false,
    sunk: hpEnd <= 0,
  })
  const perfect = predictRank([ship(50, 50)], [ship(10, 0)], false)
  const ordinary = predictRank([ship(50, 49)], [ship(10, 0)], false)
  assert.equal(perfect.rank, 'S')
  assert.equal(perfect.perfect, true)
  assert.equal(ordinary.rank, 'S')
  assert.equal(ordinary.perfect, false)

  const renderer = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  const questTypes = fs.readFileSync(new URL('../src/shared/qp-types.ts', import.meta.url), 'utf8')
  const upgraded = upgradeBattleView({
    kind: 'day',
    fShips: [ship(50, 50)],
    eShips: [ship(10, 0)],
    friendShips: [],
    attacks: [],
    stages: [],
    prediction: { rank: 'SS' },
  })
  assert.equal(upgraded.prediction.rank, 'S')
  assert.equal(upgraded.prediction.perfect, true)
  assert.match(renderer, /S（完全胜利）：敌全灭且我方零承伤/)
  assert.match(questTypes, /7: 'S（完全胜利）'/)
  assert.doesNotMatch(renderer, /rank\s*[:=][^,\n]*['"`]SS['"`]/)
})

test('sub-1% fleet damage is an ordinary S: 完全胜利 counts raw HP taken, not the floored gauge', () => {
  const ship = (hpStart, hpEnd) => ({
    hpStart,
    hpEnd,
    escaped: false,
    sunk: hpEnd <= 0,
  })
  // 2026-08-27 用户在 62-4 实测：联合舰队 12 舰血池 688，一舰挨开幕雷承伤 3，敌全灭。
  // 3/688 ≈ 0.44%，Math.floor 之后就是 0%——旧实现照 fGauge === 0 判「完全胜利」，
  // 而游戏结算画面只给普通「勝利S」。血池越大这条越容易踩到，联合舰队几乎必踩。
  const scratched = [ship(61, 58), ...Array.from({ length: 11 }, () => ship(57, 57))]
  const untouched = [ship(61, 61), ...Array.from({ length: 11 }, () => ship(57, 57))]
  const enemy = () => Array.from({ length: 6 }, () => ship(10, 0))

  const ordinary = predictRank(scratched, enemy(), false)
  assert.equal(ordinary.fGauge, 0, '前提：这点承伤 floor 之后确实显示 0%')
  // 判据本身要能被玩家看见：fTaken 是未取整的承伤合计，这一局就是 3 点。
  // 少了它，判定依据面板只有 fGauge 可读，就会画成「打叉 · 我方受损 0%」。
  assert.equal(ordinary.fTaken, 3)
  assert.equal(ordinary.rank, 'S')
  assert.equal(ordinary.perfect, false)

  const flawless = predictRank(untouched, enemy(), false)
  assert.equal(flawless.rank, 'S')
  assert.equal(flawless.perfect, true)
  assert.equal(flawless.fTaken, 0)
})

// 上一条钉的是数值，这条钉的是玩家真看到的那一行：勾选状态与右侧读数必须同口径。
// 旧写法读 fGauge，联合舰队挨个位数伤时画出来是「◌ 敌全灭且我方零受损 · 我方受损 0%」，
// 自己打自己的脸——0% 摆在那儿却不给完全胜利。
test('判定依据面板：「完全胜利」那一行的读数跟着承伤点数走，不是 floor 过的损害率', async () => {
  const { battleOf, renderResultStrip } = await import('./fixtures/render-di-battle.mjs')
  const predictionOf = (patch) => ({
    rank: 'S',
    perfect: false,
    sure: true,
    fGauge: 0,
    fTaken: 0,
    eGauge: 100,
    fSunk: 0,
    fCount: 12,
    eSunk: 6,
    eCount: 6,
    ...patch,
  })

  const scratched = renderResultStrip(battleOf({ prediction: predictionOf({ fTaken: 3 }) }))
  // 打叉与读数必须挨在同一行上对得起来：◌ + 「我方承伤 3」
  assert.match(
    scratched,
    /class="mk wait">◌<\/span>\s*<span>S（完全胜利）：敌全灭且我方零承伤<\/span><span class="r">我方承伤 3<\/span>/,
  )
  assert.doesNotMatch(scratched, /我方受损/)

  const flawless = renderResultStrip(
    battleOf({ prediction: predictionOf({ perfect: true }) }),
  )
  assert.match(
    flawless,
    /class="mk ok">✓<\/span>\s*<span>S（完全胜利）：敌全灭且我方零承伤<\/span><span class="r">我方承伤 0<\/span>/,
  )
})

// 空袭战 / 雷达射击战是上面那两条的孪生洞：我方不还手，「敌全灭」永远不成立，
// 所以照通常战那套写，完全胜利被 `!airRaid` 无条件排除；S 又照 floor 过的 fGauge 判。
// 2026-08-28 用户在 62-5 途中空袭点实测撞出来：承伤 0，游戏结算「完全勝利!!S」。
test('空袭战的 S 就是完全胜利：判据是承伤点数，不是 floor 过的损害率', () => {
  const ship = (hpStart, hpEnd) => ({ hpStart, hpEnd, escaped: false, sunk: hpEnd <= 0 })
  // 空袭战敌方全程满血——我方够不着，这正是「敌全灭」永不成立的那半边。
  const enemy = () => Array.from({ length: 6 }, () => ship(90, 90))

  const flawless = predictRank(Array.from({ length: 12 }, () => ship(57, 57)), enemy(), true)
  assert.equal(flawless.eSunk, 0, '前提：空袭战一艘敌舰都沉不了')
  assert.equal(flawless.rank, 'S')
  assert.equal(flawless.perfect, true, '承伤 0 的空袭战就是完全胜利')
  assert.equal(flawless.sure, true)

  // 有承伤就既不是完全胜利、也不该再是 S（账本 id=720：8/670 → 1%，游戏给 A）。
  const hurt = predictRank(
    [ship(61, 53), ...Array.from({ length: 11 }, () => ship(57, 57))],
    enemy(),
    true,
  )
  assert.equal(hurt.fTaken, 8)
  assert.equal(hurt.rank, 'A')
  assert.equal(hurt.perfect, false)

  // 账本实测的 floor 陷阱（id=743，6-2-4 图 37 点）：5/626 ≈ 0.8%，floor 之后就是 0%。
  // 旧写法照 fGauge <= 0 报「S 可以确定」，而游戏结算给的是 A。
  const floored = predictRank(
    [ship(65, 60), ...Array.from({ length: 11 }, () => ship(51, 51))],
    enemy(),
    true,
  )
  assert.equal(floored.fTaken, 5)
  assert.equal(floored.fGauge, 0, '前提：这点承伤 floor 之后确实显示 0%')
  assert.equal(floored.rank, 'A', '游戏结算给的是 A，不是 S')
  assert.equal(floored.perfect, false)
  assert.equal(floored.sure, false)
})

test('判定依据面板：空袭点的完全胜利行读承伤点数，A 行不会因为 floor 成 0% 而整表空转', async () => {
  const { battleOf, renderResultStrip } = await import('./fixtures/render-di-battle.mjs')
  const predictionOf = (patch) => ({
    rank: 'S',
    perfect: true,
    sure: true,
    fGauge: 0,
    fTaken: 0,
    eGauge: 0,
    fSunk: 0,
    fCount: 12,
    eSunk: 0,
    eCount: 6,
    ...patch,
  })

  const flawless = renderResultStrip(battleOf({ kind: 'airraid', prediction: predictionOf({}) }))
  assert.match(
    flawless,
    /class="mk ok">✓<\/span>\s*<span>S（完全胜利）：我方零承伤<\/span><span class="r">我方承伤 0<\/span>/,
  )

  // 5/626 被 floor 成 0%：完全胜利那行必须打叉、A 那行必须打勾。旧写法两行都读 fGauge，
  // 画出来是「✓ S 我方零受损 0%」配「◌ A」——整张表没有一行对得上真评级。
  const floored = renderResultStrip(
    battleOf({
      kind: 'airraid',
      prediction: predictionOf({ rank: 'A', perfect: false, sure: false, fTaken: 5 }),
    }),
  )
  assert.match(
    floored,
    /class="mk wait">◌<\/span>\s*<span>S（完全胜利）：我方零承伤<\/span><span class="r">我方承伤 5<\/span>/,
  )
  assert.match(floored, /class="mk ok">✓<\/span>\s*<span>A：我方损失低于 10%<\/span>/)
})

test('battle result conditions live inside the judgment chip without a duplicate sidebar card', () => {
  const renderer = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  const html = rendererSource
  assert.match(renderer, /<details class="rchip rank-card">/)
  assert.match(renderer, /<div class="rank-detail">/)
  assert.match(renderer, /b\.practice \? '对手旗舰击破' : '敌旗舰沉'/)
  assert.match(renderer, /或战果比超过 2\.5×/)
  assert.doesNotMatch(renderer, /const predictCardHtml/)
  assert.doesNotMatch(renderer, /\$\{b \? predictCardHtml\(b\) : ''\}/)
  assert.match(html, /\.mod-di \.rank-detail\s*\{[\s\S]*position:\s*absolute/)
  // 掉落仍然长在判定横幅里（右栏不重复第二张卡），但已从一行小字换成独占一行的实体卡
  assert.match(renderer, /\$\{battleDropChipHtml\(s, b\)\}<\/div>`/)
  assert.match(html, /\.mod-di \.battle-drop-chip \{[^}]*flex: 1 0 100%/)
  // 名字外面包了实体链接（.el）——entity-term 不再是 b 的直接子级，选择器必须是后代
  assert.match(html, /\.mod-di \.battle-drop-chip b \.entity-term \{ display: inline-flex; \}/)
  // 捞到的舰名链到舰娘图鉴：掉落只有主数据 id，走 mstShip 路由
  assert.match(renderer, /mstId > 0 \? elinkHtml\('mstShip', mstId, nameHtml\) : nameHtml/)
})

const fleet = (deckId, count = 6, equipmentByPosition = {}) =>
  Array.from({ length: count }, (_, i) => ({
    rosterId: deckId * 100 + i,
    mstId: deckId * 100 + i,
    name: `D${deckId}-${i + 1}`,
    lv: 1,
    nowHp: 50,
    maxHp: 50,
    equipments: equipmentByPosition[i] ?? [],
  }))

const battleContext = (combinedType = 0, equipmentByPosition = {}) => ({
  fleetShips: (deckId) => fleet(deckId, 6, deckId === 1 ? equipmentByPosition : {}),
  masterName: (mstId) => `E${mstId}`,
  combinedType: () => combinedType,
})

const battleBase = (combined = false) => ({
  api_deck_id: 1,
  api_f_nowhps: Array(6).fill(50),
  api_f_maxhps: Array(6).fill(50),
  api_ship_ke: Array.from({ length: 6 }, (_, i) => 1501 + i),
  api_ship_lv: Array(6).fill(1),
  api_e_nowhps: Array(6).fill(100),
  api_e_maxhps: Array(6).fill(100),
  api_formation: [1, 1, 1],
  ...(combined
    ? {
        api_f_nowhps_combined: Array(6).fill(40),
        api_f_maxhps_combined: Array(6).fill(40),
        api_ship_ke_combined: Array.from({ length: 6 }, (_, i) => 1601 + i),
        api_ship_lv_combined: Array(6).fill(1),
        api_e_nowhps_combined: Array(6).fill(80),
        api_e_maxhps_combined: Array(6).fill(80),
      }
    : {}),
})

const shelling = (damage, side = 0, ciType = 0) => ({
  api_at_list: [0],
  api_at_eflag: [side],
  api_at_type: [ciType],
  api_sp_list: [ciType],
  api_df_list: [[0]],
  api_damage: [[damage]],
  api_cl_list: [[damage > 0 ? 1 : 0]],
})

const withAllDayStages = (body) => ({
  ...body,
  api_hougeki1: shelling(1),
  api_hougeki2: shelling(2),
  api_hougeki3: shelling(3),
  api_raigeki: { api_frai: [0], api_fydam: [4], api_fcl: [1] },
})

test('友军夜战段按 eflag 分侧：敌方反击落在友军舰上，不落在敌舰或我方身上', () => {
  // api_friendly_battle.api_hougeki 里既有友军打深海的行（eflag=0），
  // 也有深海反击友军的行（eflag=1）。曾整段强制 side=2：敌方那几击被记成
  // 「友军攻击敌舰」，友军永远不掉血、敌舰凭空受创，血条回放与全歼判定连带失真。
  const body = {
    ...battleBase(false),
    api_friendly_info: {
      api_ship_id: [500, 501],
      api_ship_lv: [99, 99],
      api_nowhps: [30, 30],
      api_maxhps: [30, 30],
      api_slot: [Array(5).fill(-1), Array(5).fill(-1)],
    },
    api_friendly_battle: {
      api_hougeki: {
        api_at_list: [0, 0],
        api_at_eflag: [0, 1], // 行0：友军出手；行1：敌方反击
        api_sp_list: [0, 0],
        api_df_list: [[0], [1]], // 友军 → 敌 0 号；敌 → 友军 1 号
        api_damage: [[20], [15]],
        api_cl_list: [[1], [1]],
      },
    },
  }
  const view = parseBattle('/kcsapi/api_req_battle_midnight/battle', body, battleContext(), 0)
  assert.equal(view.eShips[0].hpEnd, 80, '友军的 20 点要落在敌 0 号身上')
  assert.equal(view.friendShips[1].hpEnd, 15, '敌方反击的 15 点要落在友军 1 号身上')
  assert.ok(view.fShips.every((s) => s.hpEnd === 50), '我方全程旁观，不许掉血')
  const friendlyRows = view.attacks.filter((a) => a.phase === 'friendly')
  assert.deepEqual(friendlyRows.map((a) => a.side), [2, 1])
})

test('battle flavor info preserves the exact abyss voice key and plain-text message', () => {
  const view = parseBattle(
    '/kcsapi/api_req_sortie/battle',
    {
      ...battleBase(false),
      api_ship_ke: [2297],
      api_ship_lv: [1],
      api_e_nowhps: [330],
      api_e_maxhps: [330],
      api_flavor_info: [{
        api_boss_ship_id: '2297',
        api_voice_id: '605229710',
        api_ship_name: '駆逐ラ級ζ-壊',
        api_message: '第一句<br>第二句',
      }],
    },
    battleContext(),
    0,
  )
  assert.deepEqual(view.flavorVoices, [{
    mstId: 2297,
    voiceId: '605229710',
    shipName: '駆逐ラ級ζ-壊',
    message: '第一句\n第二句',
  }])
})

test('battle ship loadouts preserve friendly instances and enemy master-backed plane slots', () => {
  const friendlyEquipment = [
    {
      instanceId: 901,
      mstId: 10,
      slot: 0,
      planeCount: 18,
      planeCapacity: 24,
      level: 6,
      alv: 7,
    },
    {
      instanceId: 902,
      mstId: 42,
      slot: 'ex',
      planeCount: null,
      planeCapacity: null,
      level: 0,
      alv: 0,
    },
  ]
  const context = {
    ...battleContext(0, { 0: friendlyEquipment }),
    masterMaxEq: (mstId) => (mstId === 1501 ? [12, 0, 0, 0, 0] : []),
  }
  const body = {
    ...battleBase(false),
    api_eSlot: [
      [1504, 1501, -1, -1, -1],
      ...Array.from({ length: 5 }, () => [-1, -1, -1, -1, -1]),
    ],
  }
  const view = parseBattle('/kcsapi/api_req_sortie/battle', body, context, 0)

  assert.deepEqual(view.fShips[0].equipment, [
    { ...friendlyEquipment[0], planeSource: 'sortie' },
    { ...friendlyEquipment[1], planeSource: null },
  ])
  assert.deepEqual(view.eShips[0].equipment, [
    {
      mstId: 1504,
      instanceId: null,
      slot: 0,
      planeCount: 12,
      planeCapacity: 12,
      planeSource: 'master',
      level: 0,
      alv: 0,
    },
    {
      mstId: 1501,
      instanceId: null,
      slot: 1,
      planeCount: null,
      planeCapacity: null,
      planeSource: null,
      level: 0,
      alv: 0,
    },
  ])
})

test('battle ship rows expand into linked equipment, loadout, and honest air-loss details', () => {
  const renderer = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  const html = rendererSource
  const types = fs.readFileSync(new URL('../src/shared/mg-types.ts', import.meta.url), 'utf8')

  assert.match(types, /export interface BattleEquipmentView/)
  assert.match(types, /planeSource: 'sortie' \| 'master' \| null/)
  assert.match(renderer, /const battleEquipmentHtml = /)
  assert.match(renderer, /isAbyssMstId\(item\.mstId\) \? 'abyssEquip' : 'mstEquip'/)
  // 航空损失只给到「舰队合计」这一层，绝不假装能摊到具体槽位。
  // 2026-08-26 文案清扫删了「（不逐槽分列）」这句自述，纪律改钉更硬的实现锚：
  // 数只从 fleetAirStages 的合计来，一行里同时给出「参战/损失」两个合计。
  assert.match(renderer, /const airStages = fleetAirStages\(b\)/)
  assert.match(renderer, /舰队航空阶段合计 参战 \$\{total\} · 损失 \$\{lost\}/)
  // 旧复盘没有装备快照时必须走空态，不能回落到现在的母港编成倒填。
  // 纪律本身在代码里，所以钉实现（早退分支）＋钉空态还在说「没有」。
  assert.match(renderer, /if \(ship\.equipment == null\)/)
  assert.match(renderer, /暂无当时装备记录/)
  assert.match(renderer, /data-battle-side="\$\{side\}"/)
  assert.match(renderer, /expandedBattleShips/)
  assert.match(renderer, /shipRow && !target\.closest\('\.el'\)/)
  assert.match(html, /\.mod-di \.bship-detail \{[\s\S]*animation: di-loadout-in/)
  assert.match(html, /\.mod-di \.beq \{[\s\S]*grid-template-columns:/)
})

test('battle views retain final parameters, used equipment, enemy touch, and squadron aircraft', () => {
  const body = {
    ...battleBase(false),
    api_fParam: Array.from({ length: 6 }, (_, index) => [10 + index, 20 + index, 30 + index, 40 + index]),
    api_eParam: Array.from({ length: 6 }, (_, index) => [50 + index, 60 + index, 70 + index, 80 + index]),
    api_hougeki1: {
      ...shelling(4),
      api_si_list: [[101, 102]],
    },
    api_kouku: {
      api_stage1: {
        api_disp_seiku: 1,
        api_f_count: 12,
        api_f_lostcount: 1,
        api_e_count: 9,
        api_e_lostcount: 3,
        api_touch_plane: [101, 1501],
      },
      api_squadron_plane: [
        { api_mst_id: 201, api_count: 18 },
        { api_mst_id: 202, api_count: 4 },
      ],
    },
  }
  const view = parseBattle('/kcsapi/api_req_sortie/battle', body, battleContext(), 0)

  assert.deepEqual(view.fShips[0].params, [10, 20, 30, 40])
  assert.deepEqual(view.eShips[5].params, [55, 65, 75, 85])
  assert.deepEqual(view.attacks.find((attack) => attack.source === 'api_hougeki1').equipmentMstIds, [101, 102])
  assert.deepEqual(view.stages.find((stage) => stage.source === 'api_kouku').squadronPlanes, [
    { mstId: 201, count: 18 },
    { mstId: 202, count: 4 },
  ])
  assert.equal(view.air.touchE, 1501)

  const renderer = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  const html = rendererSource
  assert.match(renderer, /air\.touchE > 0/)
  assert.match(renderer, /attack\.equipmentMstIds/)
  assert.match(renderer, /data-used-equipment="\$\{attack\.equipmentMstIds\.join\(','\)\}">装备详情/)
  assert.match(renderer, /const linkType = isAbyssMstId\(mstId\) \? 'abyssEquip' : 'mstEquip'/)
  assert.match(renderer, /usedEquipmentPopover\.addEventListener\('mouseenter'/)
  assert.match(html, /#di-used-equipment-popover\.show \{[\s\S]*pointer-events: auto/)
  assert.match(html, /#di-used-equipment-popover \{[\s\S]*padding-top: 5px/)
  assert.match(renderer, /stage\.squadronPlanes/)
  assert.match(renderer, /class="stage-main"/)
  assert.match(renderer, /class="stage-detail"/)
  assert.match(html, /\.mod-di \.stage-row \.stage-detail \{[\s\S]*flex-wrap: wrap/)
  assert.match(html, /\.mod-di \.stage-row \.stage-detail \.tag9\.squadron \{[\s\S]*white-space: normal/)
  assert.match(renderer, /b\.hasSupport \? `<span class="kv">支援舰队 <b>已到达/)
})

test('map-embedded base defense becomes a detailed air battle without mutating fleet ships', () => {
  const view = parseBaseDefenseBattle(
    {
      api_formation: [1, 3, 3],
      api_ship_ke: [1650, 2094, 2091],
      api_ship_lv: [1, 1, 1],
      api_e_nowhps: [500, 300, 300],
      api_e_maxhps: [500, 300, 300],
      api_eSlot: [[1561], [1625], [1574]],
      api_f_nowhps: [200, 200, 200],
      api_f_maxhps: [200, 200, 200],
      api_air_base_attack: {
        api_map_squadron_plane: {
          1: [
            { api_mst_id: 351, api_count: 18 },
            { api_mst_id: 221, api_count: 18 },
          ],
        },
        api_stage1: {
          api_f_count: 36,
          api_f_lostcount: 3,
          api_e_count: 48,
          api_e_lostcount: 31,
          api_disp_seiku: 2,
          api_touch_plane: [-1, -1],
        },
        api_stage2: null,
        api_stage3: {
          api_frai_flag: [0, 1, 0],
          api_erai_flag: [0, 0, 0],
          api_fbak_flag: [0, 1, 1],
          api_ebak_flag: [0, 0, 0],
          api_fcl_flag: [0, 0, 0],
          api_ecl_flag: [0, 0, 0],
          api_fdam: [0, 0, 8],
          api_edam: [0, 0, 0],
        },
      },
      api_lost_kind: 1,
    },
    battleContext(),
    123,
  )

  assert.equal(view.kind, 'baseDefense')
  assert.equal(view.fShips.length, 3)
  assert.equal(view.fShips[0].name, '第1基地航空队')
  assert.equal(view.fShips[0].rosterId, null)
  assert.equal(view.fShips[0].equipment.length, 2)
  assert.equal(view.fShips[2].hpEnd, 192)
  assert.equal(view.eShips[0].mstId, 1650)
  assert.equal(view.air.seiku, 2)
  assert.equal(view.stages[0].label, '基地防空')
  assert.deepEqual(view.stages[0].squadronPlanes, [
    { mstId: 351, count: 18 },
    { mstId: 221, count: 18 },
  ])
  assert.equal(view.attacks[0].hits.find((hit) => hit.damage === 8)?.target, 2)
  assert.equal(view.baseDefenseLostKind, 1)

  const store = fs.readFileSync(new URL('../src/main/mg/store.ts', import.meta.url), 'utf8')
  const renderer = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  assert.match(store, /body\.api_destruction_battle[\s\S]*parseBaseDefenseBattle/)
  assert.match(renderer, /基地防空结算/)
  assert.match(renderer, /baseDefense\s*\?\s*'基地航空队'/)
})

test('overkill cannot clear an enemy sunk by an earlier phase', () => {
  const body = {
    ...battleBase(false),
    api_e_nowhps: [10, ...Array(5).fill(100)],
    api_e_maxhps: [10, ...Array(5).fill(100)],
    api_hougeki1: shelling(15),
    api_hougeki2: shelling(5),
  }
  const result = parseBattle('/kcsapi/api_req_sortie/battle', body, battleContext(), 0)
  assert.equal(result.eShips[0].hpEnd, 0)
  assert.equal(result.eShips[0].sunk, true)
})

test('practice 1 HP floor is not treated as a sinking line', () => {
  const body = {
    ...battleBase(false),
    api_e_nowhps: [10, ...Array(5).fill(100)],
    api_e_maxhps: [10, ...Array(5).fill(100)],
    api_hougeki1: shelling(15),
  }
  const result = parseBattle('/kcsapi/api_req_practice/battle', body, battleContext(), 0)
  assert.equal(result.eShips[0].hpEnd, 1)
  assert.equal(result.eShips.filter((ship) => ship.sunk).length, 0)
  assert.equal(result.eShips[0].defeated, true)
  assert.equal(result.prediction.eSunk, 1)
  assert.equal(result.prediction.rank, 'B')
})

test('practice rank prediction uses internal defeats without treating every visible HP1 as defeated', () => {
  const allDefeated = parseBattle(
    '/kcsapi/api_req_practice/battle',
    {
      ...battleBase(false),
      api_e_nowhps: Array(6).fill(20),
      api_e_maxhps: Array(6).fill(20),
      api_hougeki1: {
        api_at_list: [0],
        api_at_eflag: [0],
        api_at_type: [0],
        api_sp_list: [0],
        api_df_list: [[0, 1, 2, 3, 4, 5]],
        api_damage: [Array(6).fill(99)],
        api_cl_list: [Array(6).fill(1)],
      },
    },
    battleContext(),
    0,
  )
  assert.ok(allDefeated.eShips.every((ship) => ship.hpEnd === 1))
  assert.ok(allDefeated.eShips.every((ship) => ship.defeated && !ship.sunk))
  assert.equal(allDefeated.prediction.rank, 'S')
  assert.equal(allDefeated.prediction.perfect, true)
  assert.equal(allDefeated.prediction.eSunk, 6)

  const legacy = structuredClone(allDefeated)
  for (const ship of [...legacy.fShips, ...legacy.eShips]) delete ship.defeated
  legacy.prediction = { ...legacy.prediction, rank: 'B', perfect: false, eSunk: 0 }
  const migrated = upgradeBattleView(legacy)
  assert.ok(migrated.eShips.every((ship) => ship.defeated && !ship.sunk))
  assert.equal(migrated.prediction.rank, 'S')
  assert.equal(migrated.prediction.eSunk, 6)

  const exactOneHp = parseBattle(
    '/kcsapi/api_req_practice/battle',
    {
      ...battleBase(false),
      api_e_nowhps: [2],
      api_e_maxhps: [2],
      api_ship_ke: [1501],
      api_ship_lv: [1],
      api_hougeki1: shelling(1),
    },
    battleContext(),
    0,
  )
  assert.equal(exactOneHp.eShips[0].hpEnd, 1)
  assert.equal(exactOneHp.eShips[0].defeated, false)
  assert.equal(exactOneHp.prediction.eSunk, 0)

  const visibleOneHp = {
    hpStart: 1,
    hpEnd: 1,
    hpMax: 20,
    escaped: false,
    sunk: false,
    defeated: false,
  }
  const untouched = {
    hpStart: 20,
    hpEnd: 20,
    hpMax: 20,
    escaped: false,
    sunk: false,
    defeated: false,
  }
  const honest = predictPracticeRank([untouched], [visibleOneHp])
  assert.equal(honest.eSunk, 0)
  assert.notEqual(honest.rank, 'S')

  const renderer = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  // 「演习专用口径：击破取内部判定，HP1 不自动视为击破」2026-08-26 按族 3 删了
  //（判定条件清单里逐条摆着同一件事）。口径本体是上面那几行纯函数断言；
  // 界面这一侧改钉演习专用的条件行与措辞分支——两处措辞不许倒回「击沉」。
  assert.match(renderer, /'S 胜：对手全员击破且我方无击破判定'/)
  assert.match(renderer, /b\.practice[\s\S]{0,60}\? '对手全员击破'[\s\S]{0,30}: '敌全灭'/)
})

test('battle reconciliation agrees on sunk count, MVP, and a sure rank', () => {
  const body = {
    ...battleBase(false),
    api_e_nowhps: [10, ...Array(5).fill(100)],
    api_e_maxhps: [10, ...Array(5).fill(100)],
    api_hougeki1: shelling(15),
  }
  const view = parseBattle('/kcsapi/api_req_sortie/battle', body, battleContext(), 0)
  assert.equal(view.prediction.sure, true)
  assert.deepEqual(
    reconcileBattle(view, {
      api_dests: 1,
      api_destsf: 1,
      api_mvp: 1,
      api_win_rank: 'B',
    }),
    [],
  )
})

test('battle reconciliation reports three independent authoritative mismatches', () => {
  const body = {
    ...battleBase(false),
    api_e_nowhps: [10, ...Array(5).fill(100)],
    api_e_maxhps: [10, ...Array(5).fill(100)],
    api_hougeki1: shelling(15),
  }
  const view = parseBattle('/kcsapi/api_req_sortie/battle', body, battleContext(), 0)
  assert.deepEqual(
    reconcileBattle(view, {
      api_dests: 0,
      api_mvp: 2,
      api_win_rank: 'A',
    }),
    [
      { kind: 'sunk', ours: 1, game: 0 },
      { kind: 'mvp', ours: 1, game: 2 },
      { kind: 'rank', ours: 'B', game: 'A' },
    ],
  )
})

test('battle reconciliation ignores MVP ties and ranks declared uncertain', () => {
  const view = parseBattle(
    '/kcsapi/api_req_sortie/battle',
    {
      ...battleBase(false),
      api_hougeki1: {
        api_at_list: [0, 1],
        api_at_eflag: [0, 0],
        api_at_type: [0, 0],
        api_sp_list: [0, 0],
        api_df_list: [[0], [1]],
        api_damage: [[10], [10]],
        api_cl_list: [[1], [1]],
      },
    },
    battleContext(),
    0,
  )
  view.prediction = { ...view.prediction, rank: 'C', sure: false }
  assert.deepEqual(
    reconcileBattle(view, {
      api_dests: 0,
      api_mvp: 2,
      api_win_rank: 'D',
    }),
    [],
  )
})

test('sanitized real battle and result pairs reconcile without discrepancies', () => {
  for (const fixture of reconciliationFixtures) {
    const view = parseBattle(fixture.path, fixture.battle, battleContext(), 0)
    assert.deepEqual(reconcileBattle(view, fixture.result), [], fixture.name)
  }
})

test('combined fleet phase plans preserve fleet-specific torpedo positions', () => {
  const cases = [
    ['/kcsapi/api_req_sortie/battle', withAllDayStages(battleBase(false)), 0, ['gun1', 'gun2', 'torp']],
    ['/kcsapi/api_req_combined_battle/ec_battle', withAllDayStages(battleBase(true)), 0, ['gun1', 'torp', 'gun2', 'gun3']],
    ['/kcsapi/api_req_combined_battle/battle', withAllDayStages(battleBase(false)), 1, ['gun1', 'torp', 'gun2', 'gun3']],
    ['/kcsapi/api_req_combined_battle/each_battle', withAllDayStages(battleBase(true)), 1, ['gun1', 'gun2', 'torp', 'gun3']],
    ['/kcsapi/api_req_combined_battle/battle_water', withAllDayStages(battleBase(false)), 2, ['gun1', 'gun2', 'gun3', 'torp']],
  ]
  for (const [apiPath, body, combinedType, expected] of cases) {
    const result = parseBattle(apiPath, body, battleContext(combinedType), 0)
    assert.deepEqual(result.stages.map((stage) => stage.phase), expected, apiPath)
    assert.deepEqual(result.attacks.map((attack) => attack.phase), expected, apiPath)
  }
})

test('night-to-day consumes both dawn shelling and the trailing night hougeki before day combat', () => {
  const result = parseBattle(
    '/kcsapi/api_req_combined_battle/ec_night_to_day',
    {
      ...battleBase(true),
      api_n_hougeki1: shelling(5),
      api_hougeki: shelling(7),
      api_hougeki1: shelling(3),
    },
    battleContext(0),
    0,
  )
  assert.deepEqual(result.attacks.map((attack) => attack.phase), ['night', 'night', 'gun1'])
  assert.equal(result.eShips[0].hpEnd, 85)
})

test('multi-ship special attacks credit every participating ship instead of the lead ship', () => {
  const body = {
    ...battleBase(false),
    api_hougeki1: {
      api_at_list: [0],
      api_at_eflag: [0],
      api_at_type: [100],
      api_df_list: [[0, 1, 2]],
      api_damage: [[10, 20, 30]],
      api_cl_list: [[1, 1, 1]],
    },
  }
  const result = parseBattle('/kcsapi/api_req_sortie/battle', body, battleContext(), 0)
  assert.deepEqual(result.attacks.map((attack) => attack.attacker), [0, 2, 4])
  assert.deepEqual(result.fShips.map((ship) => ship.damageDealt), [10, 0, 20, 0, 30, 0])
  assert.ok(result.attacks.every((attack) => attack.ciType === 100 && attack.ciKind === 'day'))
})

test('leading API sentinels normalize combined fleet indexes to 0-11', () => {
  const result = parseBattle(
    '/kcsapi/api_req_combined_battle/battle',
    {
      ...battleBase(true),
      api_f_nowhps: [-1, ...Array(6).fill(50)],
      api_f_maxhps: [-1, ...Array(6).fill(50)],
      api_f_nowhps_combined: [-1, ...Array(6).fill(40)],
      api_f_maxhps_combined: [-1, ...Array(6).fill(40)],
    },
    battleContext(1),
    0,
  )
  assert.deepEqual(result.fShips.map((ship) => ship.index), Array.from({ length: 12 }, (_, i) => i))
  assert.deepEqual(result.fShips.slice(0, 6).map((ship) => ship.fleet), Array(6).fill('main'))
  assert.deepEqual(result.fShips.slice(6).map((ship) => ship.fleet), Array(6).fill('escort'))
})

test('seven-ship strike forces retain their seventh ship without treating it as a combined escort', () => {
  const body = {
    ...battleBase(false),
    api_f_nowhps: Array(7).fill(50),
    api_f_maxhps: Array(7).fill(50),
    api_hougeki1: {
      ...shelling(12),
      api_at_list: [6],
    },
    api_raigeki: {
      api_frai: [-1, -1, -1, -1, -1, -1, 0],
      api_fydam: [0, 0, 0, 0, 0, 0, 9],
      api_fcl: [0, 0, 0, 0, 0, 0, 1],
    },
  }
  const result = parseBattle(
    '/kcsapi/api_req_sortie/battle',
    body,
    {
      fleetShips: (deckId) => fleet(deckId, deckId === 1 ? 7 : 6),
      masterName: (mstId) => `E${mstId}`,
      combinedType: () => 0,
    },
    0,
  )

  assert.equal(result.fShips.length, 7)
  assert.deepEqual(
    result.fShips.map((ship) => [ship.index, ship.position, ship.name, ship.fleet]),
    [
      [0, 0, 'D1-1', 'main'],
      [1, 1, 'D1-2', 'main'],
      [2, 2, 'D1-3', 'main'],
      [3, 3, 'D1-4', 'main'],
      [4, 4, 'D1-5', 'main'],
      [5, 5, 'D1-6', 'main'],
      [6, 6, 'D1-7', 'main'],
    ],
  )
  assert.deepEqual(result.attacks.map((attack) => attack.attacker), [6, 6])
  assert.equal(result.fShips[6].damageDealt, 21)

  const renderer = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  assert.match(renderer, /const main = ships\.filter\(\(x\) => x\.fleet !== 'escort'\)/)
  assert.match(renderer, /const fCombined = b\.fShips\.some\(\(x\) => x\.fleet === 'escort'\)/)
})

test('seven-ship strike forces take air damage on the right slots', () => {
  const parseAirDamage = (count, damage) =>
    parseBattle(
      '/kcsapi/api_req_sortie/battle',
      {
        ...battleBase(false),
        api_f_nowhps: Array(count).fill(50),
        api_f_maxhps: Array(count).fill(50),
        api_kouku: {
          api_stage3: {
            api_fdam: damage,
            api_fcl_flag: Array(count).fill(0),
            api_fbak_flag: Array(count).fill(0),
            api_frai_flag: Array(count).fill(0),
          },
        },
      },
      {
        fleetShips: (deckId) => fleet(deckId, deckId === 1 ? count : 6),
        masterName: (mstId) => `E${mstId}`,
        combinedType: () => 0,
      },
      0,
    )

  const strikeForce = parseAirDamage(7, [11, 0, 0, 0, 0, 0, 22])
  assert.equal(strikeForce.fShips[0].hpEnd, 39)
  assert.equal(strikeForce.fShips[5].hpEnd, 50)
  assert.equal(strikeForce.fShips[6].hpEnd, 28)

  const regularFleet = parseAirDamage(6, [11, 0, 0, 0, 0, 22])
  assert.equal(regularFleet.fShips[0].hpEnd, 39)
  assert.equal(regularFleet.fShips[5].hpEnd, 28)

  const battleSource = fs.readFileSync(new URL('../src/main/mg/battle.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(battleSource, /dam\.length === 7/)
})

test('battle hits distinguish confirmed misses, zero-damage hits, and unknown air zeroes', () => {
  const result = parseBattle(
    '/kcsapi/api_req_sortie/battle',
    {
      ...battleBase(false),
      api_hougeki1: {
        api_at_list: [0],
        api_at_eflag: [0],
        api_at_type: [0],
        api_sp_list: [0],
        api_df_list: [[0, 1]],
        api_damage: [[0, 0]],
        api_cl_list: [[0, 1]],
      },
      api_kouku: {
        api_stage3: {
          api_edam: [0, 0, 0, 0, 0, 0],
          api_ecl_flag: [0, 0, 0, 0, 0, 0],
          api_ebak_flag: [1, 0, 0, 0, 0, 0],
          api_erai_flag: [0, 0, 0, 0, 0, 0],
        },
      },
    },
    battleContext(),
    0,
  )
  const shellHits = result.attacks.find((attack) => attack.phase === 'gun1').hits
  assert.deepEqual(
    shellHits.map((hit) => [hit.damage, hit.hitState, hit.miss]),
    [
      [0, 'miss', true],
      [0, 'hit', false],
    ],
  )
  const airHit = result.attacks.find((attack) => attack.phase === 'air').hits[0]
  assert.deepEqual([airHit.damage, airHit.hitState, airHit.miss], [0, 'unknown', false])
})

test('the seventh strike-force ship can consume its own damage-control item', () => {
  const result = parseBattle(
    '/kcsapi/api_req_sortie/battle',
    {
      ...battleBase(false),
      api_f_nowhps: [50, 50, 50, 50, 50, 50, 10],
      api_f_maxhps: Array(7).fill(50),
      api_hougeki1: {
        api_at_list: [0],
        api_at_eflag: [1],
        api_at_type: [0],
        api_sp_list: [0],
        api_df_list: [[6]],
        api_damage: [[20]],
        api_cl_list: [[1]],
      },
    },
    {
      fleetShips: (deckId) =>
        fleet(deckId, deckId === 1 ? 7 : 6, deckId === 1 ? { 6: [{ instanceId: 700, mstId: 42 }] } : {}),
      masterName: (mstId) => `E${mstId}`,
      combinedType: () => 0,
    },
    0,
  )

  assert.equal(result.fShips[6].repairItemUsed, 42)
  assert.equal(result.fShips[6].hpEnd, 10)
  assert.equal(result.fShips[6].sunk, false)
})

test('modern seven-slot torpedo arrays keep slot zero as a real attacker', () => {
  const result = parseBattle(
    '/kcsapi/api_req_sortie/battle',
    {
      ...battleBase(false),
      api_opening_atack: {
        api_frai_list_items: Array(7).fill(null),
        api_fydam_list_items: Array(7).fill(null),
        api_fcl_list_items: Array(7).fill(null),
        api_erai_list_items: [[3], null, null, null, null, null, null],
        api_eydam_list_items: [[20], null, null, null, null, null, null],
        api_ecl_list_items: [[1], null, null, null, null, null, null],
      },
      api_raigeki: {
        api_frai: [0, -1, -1, -1, -1, -1, -1],
        api_fydam: [23, 0, 0, 0, 0, 0, 0],
        api_fcl: [1, 0, 0, 0, 0, 0, 0],
        api_erai: [5, -1, -1, -1, -1, -1, -1],
        api_eydam: [11, 0, 0, 0, 0, 0, 0],
        api_ecl: [1, 0, 0, 0, 0, 0, 0],
      },
    },
    battleContext(),
    0,
  )

  const opening = result.attacks.find((attack) => attack.phase === 'openingTorp')
  const friendlyClosing = result.attacks.find(
    (attack) => attack.phase === 'torp' && attack.side === 0,
  )
  const enemyClosing = result.attacks.find(
    (attack) => attack.phase === 'torp' && attack.side === 1,
  )
  assert.equal(opening?.attacker, 0)
  assert.equal(opening?.hits[0].target, 3)
  assert.equal(result.fShips[3].hpEnd, 30)
  assert.equal(friendlyClosing?.attacker, 0)
  assert.equal(friendlyClosing?.hits[0].target, 0)
  assert.equal(enemyClosing?.attacker, 0)
  assert.equal(enemyClosing?.hits[0].target, 5)
  assert.equal(result.fShips[5].hpEnd, 39)
  assert.equal(result.eShips[0].hpEnd, 77)
})

test('combined night active decks remap relative attacker and target indexes to escort fleets', () => {
  const result = parseBattle(
    '/kcsapi/api_req_combined_battle/midnight_battle',
    {
      ...battleBase(true),
      api_active_deck: [2, 2],
      api_hougeki: {
        ...shelling(9),
        api_sp_list: [3],
        api_at_type: [0],
      },
    },
    battleContext(1),
    0,
  )
  assert.equal(result.attacks[0].attacker, 6)
  assert.equal(result.attacks[0].hits[0].target, 6)
  assert.equal(result.attacks[0].ciType, 3)
  assert.equal(result.attacks[0].ciKind, 'night')
})

test('day and night shelling read CI ids from their own API fields', () => {
  const day = parseBattle(
    '/kcsapi/api_req_sortie/battle',
    {
      ...battleBase(false),
      api_hougeki1: {
        ...shelling(0),
        api_at_type: [2],
        api_sp_list: [3],
      },
    },
    battleContext(),
    0,
  )
  const night = parseBattle(
    '/kcsapi/api_req_battle_midnight/battle',
    {
      ...battleBase(false),
      api_hougeki: {
        ...shelling(0),
        api_at_type: [2],
        api_sp_list: [3],
      },
    },
    battleContext(),
    0,
  )
  assert.deepEqual(
    [day.attacks[0].ciKind, day.attacks[0].ciType],
    ['day', 2],
  )
  assert.deepEqual(
    [night.attacks[0].ciKind, night.attacks[0].ciType],
    ['night', 3],
  )
})

test('friendly fleets damage enemies without stealing player damage or MVP credit', () => {
  const result = parseBattle(
    '/kcsapi/api_req_battle_midnight/battle',
    {
      ...battleBase(false),
      api_friendly_info: {
        api_ship_id: [501],
        api_ship_lv: [80],
        api_nowhps: [60],
        api_maxhps: [60],
      },
      api_friendly_battle: { api_hougeki: shelling(12) },
    },
    battleContext(),
    0,
  )
  assert.equal(result.friendShips.length, 1)
  assert.equal(result.attacks[0].side, 2)
  assert.equal(result.eShips[0].hpEnd, 88)
  assert.ok(result.fShips.every((ship) => ship.damageDealt === 0))
})

test('damage control revives a sunk player ship and records the activation on the hit', () => {
  const result = parseBattle(
    '/kcsapi/api_req_sortie/battle',
    {
      ...battleBase(false),
      api_f_nowhps: [10, 50, 50, 50, 50, 50],
      api_f_maxhps: Array(6).fill(50),
      api_hougeki1: shelling(20, 1),
    },
    battleContext(0, { 0: [{ instanceId: 9001, mstId: 42 }] }),
    0,
  )
  assert.equal(result.fShips[0].hpEnd, 10)
  assert.equal(result.fShips[0].sunk, false)
  assert.equal(result.fShips[0].repairItemUsed, 42)
  assert.equal(result.attacks[0].hits[0].repairItem, 42)
})

test('zero-damage land-base and second-air-combat stages remain visible in stage data', () => {
  const emptyAir = {
    api_stage1: {
      api_disp_seiku: 0,
      api_f_count: 18,
      api_f_lostcount: 0,
      api_e_count: 12,
      api_e_lostcount: 0,
    },
    api_stage3: {
      api_edam: Array(6).fill(0),
      api_ecl_flag: Array(6).fill(0),
      api_ebak_flag: Array(6).fill(0),
      api_erai_flag: Array(6).fill(0),
    },
  }
  const result = parseBattle(
    '/kcsapi/api_req_sortie/airbattle',
    {
      ...battleBase(false),
      api_air_base_attack: [emptyAir],
      api_kouku2: emptyAir,
    },
    battleContext(),
    0,
  )
  assert.deepEqual(result.stages.map((stage) => stage.label), ['基地航空第1波', '第二航空战'])
  assert.ok(result.stages.every((stage) => stage.air?.fCount === 18))
  assert.equal(result.attacks.length, 0)
})

test('battle categories keep air raids, air battles, radar fire, and night transitions distinct', () => {
  const emptyAir = {
    api_stage1: {
      api_disp_seiku: 0,
      api_f_count: 18,
      api_f_lostcount: 0,
      api_e_count: 12,
      api_e_lostcount: 0,
    },
    api_stage3: {
      api_fdam: Array(6).fill(0),
      api_fcl_flag: Array(6).fill(0),
      api_fbak_flag: Array(6).fill(0),
      api_frai_flag: Array(6).fill(0),
      api_edam: Array(6).fill(0),
      api_ecl_flag: Array(6).fill(0),
      api_ebak_flag: Array(6).fill(0),
      api_erai_flag: Array(6).fill(0),
    },
  }
  const airRaid = parseBattle(
    '/kcsapi/api_req_sortie/ld_airbattle',
    { ...battleBase(false), api_kouku: emptyAir },
    battleContext(),
    0,
  )
  const airBattle = parseBattle(
    '/kcsapi/api_req_sortie/airbattle',
    { ...battleBase(false), api_kouku: emptyAir, api_kouku2: emptyAir },
    battleContext(),
    0,
  )
  const radar = parseBattle(
    '/kcsapi/api_req_sortie/ld_shooting',
    { ...battleBase(false), api_hougeki1: shelling(8, 1) },
    battleContext(),
    0,
  )
  const nightOnly = parseBattle(
    '/kcsapi/api_req_battle_midnight/battle',
    { ...battleBase(false), api_hougeki: shelling(8) },
    battleContext(),
    0,
  )
  const nightDay = parseBattle(
    '/kcsapi/api_req_combined_battle/ec_night_to_day',
    { ...battleBase(true), api_n_hougeki1: shelling(8), api_hougeki1: shelling(8) },
    battleContext(),
    0,
  )

  assert.equal(airRaid.kind, 'airraid')
  assert.deepEqual(airRaid.stages.map((stage) => stage.label), ['敌空袭'])
  assert.equal(airRaid.prediction.rank, 'S')
  assert.equal(airRaid.prediction.eSunk, 0)
  // 这一场我方承伤 0（api_fdam 全零）。空袭战我方不还手，敌全灭永远不成立，
  // 照通常战那套要求「敌全灭」等于把完全胜利无条件排除——2026-08-28 用户在 62-5
  // 途中空袭点实测：承伤 0，游戏结算给「完全勝利!!S」。所以这里是 true 而不是 false。
  assert.equal(airRaid.prediction.perfect, true)
  assert.equal(airBattle.kind, 'airbattle')
  assert.deepEqual(airBattle.stages.map((stage) => stage.label), ['第一航空战', '第二航空战'])
  assert.equal(radar.kind, 'radar')
  assert.ok(radar.stages.every((stage) => stage.phase === 'radar'))
  assert.equal(nightOnly.kind, 'nightonly')
  assert.equal(nightDay.kind, 'nightday')

  const legacy = structuredClone(airRaid)
  legacy.kind = 'ldair'
  assert.equal(upgradeBattleView(legacy).kind, 'airraid')

  const renderer = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  assert.match(renderer, /const isDamageOnlyBattle = /)
  // 空袭/雷达这类只算我方损害的节点，评级规则必须当场摆出来。
  // 2026-08-26 文案清扫删了「不要求击沉敌舰」「无需全灭…」那几句规则复述（族 3 玩家常识）——
  // 判定条件折叠卡里逐条列着同一件事，护栏改钉那份清单本体与口径半句，比钉复述更硬。
  assert.match(renderer, /const basis = damageOnly/)
  assert.match(renderer, /'S（完全胜利）：我方零承伤'/)
  assert.match(renderer, /'E：我方损失达到 80%'/)
  assert.match(renderer, /const rankSource = '判定来源：游戏结算'/)
  assert.match(renderer, /return '拂晓战'/)
  assert.match(renderer, /return '开幕夜战'/)
})

// 这条原本连支援数组一起断言「长度 7 = 1 基占位」，2026-08-30 被一份真报文判死：
// 支援数组是**定长**的（单队 7 槽 / 敌联合 12 槽，敌不满员补零），下标就是敌舰位。
// 判死过程与样本见 test/support-fleet-phase.test.mjs 与 fixtures/support-shelling-fixed-slots.json。
// 雷击那半边不受影响：它的前导占位是同一份报文的 api_ship_ke / api_e_nowhps 自己带的，
// 偏移从 HP 舰表推得，不是按长度猜的。
test('支援数组按敌舰位落位；雷击的前导占位仍随 HP 舰表换算', () => {
  const support = parseBattle(
    '/kcsapi/api_req_sortie/battle',
    {
      ...battleBase(false),
      api_support_info: {
        api_support_hourai: {
          api_damage: [0, 12, 0, 0, 0, 0, 0],
          api_cl_list: [0, 1, 0, 0, 0, 0, 0],
        },
      },
    },
    battleContext(),
    0,
  )
  assert.equal(support.eShips[1].hpEnd, 88, '下标 1 就是敌 #1，不让开占位')
  assert.equal(support.eShips[0].hpEnd, 100, '敌 #0 这一场没挨支援')
  assert.equal(support.attacks[0].hits[0].target, 1)

  const torpedo = parseBattle(
    '/kcsapi/api_req_sortie/battle',
    {
      ...battleBase(false),
      api_ship_ke: [-1, ...Array.from({ length: 6 }, (_, i) => 1501 + i)],
      api_ship_lv: [-1, ...Array(6).fill(1)],
      api_e_nowhps: [-1, ...Array(6).fill(100)],
      api_e_maxhps: [-1, ...Array(6).fill(100)],
      api_raigeki: {
        api_erai: [-1, 0, -1, -1, -1, -1, -1],
        api_eydam: [0, 9, 0, 0, 0, 0, 0],
        api_ecl: [0, 1, 0, 0, 0, 0, 0],
      },
    },
    battleContext(),
    0,
  )
  assert.equal(torpedo.fShips[0].hpEnd, 41)
  assert.equal(torpedo.attacks[0].attacker, 0)
  assert.equal(torpedo.attacks[0].hits[0].target, 0)
})

test('persisted pre-stage battle snapshots are upgraded into a renderable view', () => {
  const upgraded = upgradeBattleView({
    kind: 'nightonly',
    practice: false,
    hasNight: true,
    fFormation: 1,
    eFormation: 1,
    engagement: 1,
    fShips: [{ index: 0, mstId: 1, rosterId: 1, name: 'F', lv: 1, hpStart: 10, hpEnd: 10, hpMax: 10, damageDealt: 0, sunk: false }],
    eShips: [{ index: 0, mstId: 1501, rosterId: null, name: 'E', lv: 1, hpStart: 10, hpEnd: 10, hpMax: 10, damageDealt: 0, sunk: false }],
    attacks: [{
      phase: 'night',
      side: 0,
      attacker: 0,
      ciType: 3,
      hits: [{ target: 0, damage: 0, critical: false, miss: true, protect: false, sunk: false }],
    }],
    air: null,
    air2: null,
    airInjection: null,
    flarePos: null,
    hasSupport: false,
    prediction: { rank: 'D', sure: false, fGauge: 0, eGauge: 0, fSunk: 0, fCount: 1, eSunk: 0, eCount: 1 },
    result: { rank: 'A', baseExp: 1, mvp: 0, dropShipMstId: null, dropShipName: null, firstClear: false },
    ts: 0,
  })
  assert.ok(upgraded)
  assert.deepEqual(upgraded.friendShips, [])
  assert.equal(upgraded.stages[0].phase, 'night')
  assert.equal(upgraded.attacks[0].ciKind, 'night')
  assert.equal(upgraded.attacks[0].stageLabel, '夜战')
  assert.equal(upgraded.result.mvpCombined, -1)
})

test('combat renderer keeps zero-damage CI visible and does not use a fixed phase order', () => {
  const source = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  const specialAttackSource = fs.readFileSync(
    new URL('../src/shared/fleet-special-attack.ts', import.meta.url),
    'utf8',
  )
  assert.match(source, /dull:\s*total === 0 && !ci && !repair/)
  assert.match(source, /零伤命中/)
  assert.match(source, /命中判定不明/)
  assert.match(source, /'0伤'/)
  assert.match(source, /'0\?'/)
  assert.match(source, /ciLabel\(attack\.ciKind,\s*attack\.ciType\)/)
  assert.match(source, /specialAttackLabel\(ci,\s*kind === 'night' \? 'night' : 'day'\)/)
  assert.match(specialAttackSource, /DAY_ONLY_SPECIAL_ATTACK_LABEL[\s\S]*200:\s*'瑞云立体攻击'/)
  assert.match(specialAttackSource, /NIGHT_ONLY_SPECIAL_ATTACK_LABEL[\s\S]*200:\s*'瑞云夜袭'/)
  assert.match(source, /11:\s*'主鱼电CI（二击）'/)
  assert.match(source, /14:\s*'鱼雷·桶·水雷见张CI（二击）'/)
  assert.match(source, /`未收录特殊攻击 #\$\{ci\}`/)
  assert.doesNotMatch(source, /`CI:\$\{ci\}`/)
  assert.doesNotMatch(source, /PHASE_ORD/)
})

test('combined night UI distinguishes escort combat from a withdrawn or unavailable fleet', () => {
  const source = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  const html = rendererSource
  assert.match(source, /const nightEngagementOf = \(battle: BattleView\)/)
  assert.match(source, /battle\.activeDeck\?\.\[0\]/)
  assert.match(source, /敌护卫仍有战力 → 护卫交战/)
  assert.match(source, /敌护卫已无战力 → 主力交战/)
  assert.match(source, /我方主力撤出/)
  assert.match(html, /\.mod-di \.night-route/)
  assert.match(html, /\.mod-di \.night-state\.active/)
  assert.match(html, /\.mod-di \.night-state\.inactive/)
})

test('boss decision UI warns when surviving enemy escorts make the main flagship unreachable at night', () => {
  const source = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  const html = rendererSource
  assert.match(source, /const blockedBossNightHtml = \(s: SortieView, b: BattleView\)/)
  // 交战对象不再是「二队还有活口就打不到」，改走 shared 的算分判别式
  // （出处与免责见 shared/enemy-night-target 头注）。三个出口的**行为**钉在
  // test/enemy-night-target.test.mjs，这里只钉「确实接了那一份，没有回退成全灭判定」。
  assert.match(source, /const escortAlive = escort\.filter\(\(ship\) => ship\.hpEnd > 0/)
  assert.match(source, /enemyNightTargetOf\(/)
  assert.match(source, /夜战估算无法攻击/)
  assert.match(source, /夜战将消耗弹药/)
  assert.match(html, /\.mod-di \.verdict\.v-warn/)
  // 打得到旗舰那一面也要有话说，且用的是另一套配色
  assert.match(source, /夜战估算可攻击/)
  assert.match(html, /\.mod-di \.verdict\.v-cyan/)
})

test('map forecasts batch node history and keep small samples separate from mechanism estimates', () => {
  const ledger = fs.readFileSync(new URL('../src/main/mg/ledger.ts', import.meta.url), 'utf8')
  const chronicle = fs.readFileSync(new URL('../src/main/mg/chronicle.ts', import.meta.url), 'utf8')
  const combat = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const statistics = fs.readFileSync(new URL('../src/shared/statistics.ts', import.meta.url), 'utf8')
  const types = fs.readFileSync(new URL('../src/shared/mg-types.ts', import.meta.url), 'utf8')
  assert.match(ledger, /CREATE TABLE IF NOT EXISTS sortie_samples/)
  assert.match(ledger, /CREATE TABLE IF NOT EXISTS node_samples/)
  assert.match(ledger, /completed = 1 AND sortie_id <> \?/)
  assert.match(ledger, /rank IN \('S', 'A', 'B'\)/)
  assert.match(ledger, /taiha_count > 0/)
  assert.match(ledger, /GROUP BY cell/)
  assert.match(chronicle, /ledger\.markLatestNodeAdvanced\(sortie\.startTs\)/)
  assert.match(chronicle, /ledger\.finishSortieSample\(sortie\.startTs, ts, store\.getState\(\)\.player\.ships\)/)
  assert.match(chronicle, /ship\.hpEnd \/ Math\.max\(1, ship\.hpMax\) <= 0\.25/)
  assert.match(statistics, /export const PERSONAL_RATE_MIN_SAMPLES = 5/)
  assert.match(types, /export interface SortieForecastReport/)
  assert.match(types, /nodes: Record<number, NodeForecastSample>/)
  assert.match(chronicle, /ipcMain\.handle\('chron:forecast-map'/)
  assert.match(catalog, /mapForecastState\.report\.nodes\[Number\(edgeId\)\]/)
  assert.match(catalog, /const routePassRange = /)
  assert.match(catalog, /value\.total < PERSONAL_RATE_MIN_SAMPLES/)
  // 「这些数字是怎么算的」整块折叠按文案清扫裁定删了（族 7 UI 自我解说）。
  // 它护的是「主数值不依赖个人样本、个人记录只并列不混算」这条真行为，
  // 改钉那条行为本身的实现落点：机制估算与个人样本各走各的字段，不合并。
  assert.match(catalog, /historicalRate\(/)
  assert.doesNotMatch(combat, /routeCardHtml/)
})

test('map catalog consumes and refreshes its permanent local chronicle aggregate', () => {
  const types = fs.readFileSync(new URL('../src/shared/mg-types.ts', import.meta.url), 'utf8')
  const ledger = fs.readFileSync(new URL('../src/main/mg/ledger.ts', import.meta.url), 'utf8')
  const chronicle = fs.readFileSync(new URL('../src/main/mg/chronicle.ts', import.meta.url), 'utf8')
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const combat = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  const html = rendererSource

  assert.match(types, /export interface MapChronicleReport/)
  assert.match(ledger, /queryMapChronicle = \(map: number\): MapChronicleReport/)
  assert.match(ledger, /SELECT cell, COUNT\(\*\) n, MAX\(ts\) last FROM encounters/)
  assert.match(ledger, /SELECT to_cell, COUNT\(\*\) n FROM routes/)
  assert.doesNotMatch(
    ledger,
    /SELECT cell, drop_mst, COUNT\(\*\) n FROM encounters[^']+LIMIT 50/,
  )
  assert.match(chronicle, /ipcMain\.handle\('chron:map'/)
  assert.match(catalog, /jiIpc\.invoke\('chron:map', mapId\)/)
  assert.match(catalog, /const mapChronicleHtml = /)
  assert.match(catalog, /\$\{mapChronicleHtml\(info\)\}/)
  assert.match(catalog, /叠加本地遭遇志/)
  assert.match(catalog, /class="mg-e\$\{count \? ' on' : ''\}"/)
  assert.match(catalog, /battles \? 'fought' : ''/)
  assert.match(catalog, /isBoss \? 'boss' : ''/)
  // 旧钉照抄了手写的 `mapArea * 10 + mapNo`，把「图号怎么算」也钉死了，
  // 反过来逼着源码留着最后一处手搓图号（那里甚至留了注释说明不许改）。
  // 守卫要的是「出击反馈要作废该图的编年志缓存」，图号怎么算不归它管——
  // 单一出处是 shared/map-id 的 mapIdOf。
  assert.match(catalog, /invalidateMapChronicle\(mapIdOf\(mg\.sortie\.mapArea, mg\.sortie\.mapNo\)\)/)
  assert.doesNotMatch(catalog, /mapArea \* 10 \+/, '图号一律走 mapIdOf，不许再手搓')
  assert.match(catalog, /mapForecastState\.key = ''/)
  assert.match(catalog, /data-map-personal-node=/)
  assert.match(catalog, /data-map-drop-node=/)
  assert.match(catalog, /letterOf\(drop\.cell\) === personalNode/)
  assert.match(catalog, /ship\.nodes\.includes\(dropNode\)/)
  assert.match(html, /\.mod-ji \.map-personal-metrics/)
  assert.match(html, /\.mod-ji \.mg-e\.on/)
  assert.match(html, /\.mod-ji button\.map-node-filter\.on/)
  assert.match(html, /grid-template-columns: 34px 44px minmax\(0,1fr\) auto/)
  assert.match(html, /\.mod-ji \.map-personal-drop > \.el/)
  assert.match(combat, /data-act="drop-cell-filter"/)
  assert.match(combat, /s\.drops\.filter\(\(drop\) => drop\.cell === dropCellFilter\)/)
  assert.match(html, /\.mod-di \.drop-filter\.on/)
})

test('forecast risk includes formation and engagement while compact logs and drop ownership stay readable', () => {
  const model = fs.readFileSync(new URL('../src/shared/combat-forecast.ts', import.meta.url), 'utf8')
  const adapter = fs.readFileSync(new URL('../src/renderer/combat-forecast.ts', import.meta.url), 'utf8')
  const combat = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  const review = fs.readFileSync(new URL('../src/renderer/modules/shi.ts', import.meta.url), 'utf8')
  const ownership = fs.readFileSync(new URL('../src/renderer/ship-ownership.ts', import.meta.url), 'utf8')
  const html = rendererSource

  assert.match(model, /const defaultFriendlyFormation = /)
  assert.match(model, /natural: 0\.45, saiun: 0\.45/)
  assert.match(model, /const taihaChance = /)
  assert.match(model, /focused \/ targetCount \/ remaining/)
  assert.match(adapter, /master\.type2 === 9 && master\.name\.includes\('彩雲'\)/)
  assert.match(combat, /const actualEngagementText = \(battle: BattleView\)/)
  assert.match(combat, /同航 45% · 反航 30% · T有利 15% · T不利 10%/)
  assert.match(combat, /同航 45% · 反航 40% · T有利 15% · T不利 0%（彩云）/)
  // 航向加权必须写给用户看。演习预测面板照旧用 forecastEngagementText；
  // 机制估算面板改为原样渲染模型给的 assumptions（同一批百分比只有一个出处）。
  assert.match(combat, /航向加权：\$\{esc\(forecastEngagementText\(/)
  assert.match(model, /航向按同航45% \/ 反航30% \/ T有利15% \/ T不利10%加权/)
  assert.match(
    combat,
    /battleForecastLead\(b\)\)\}预测[\s\S]*?engagement \? ` · \$\{esc\(engagement\)\}`/,
  )
  assert.match(
    combat,
    /const airlineHtml[\s\S]*?const engagement = actualEngagementText\(b\)[\s\S]*?航向 <b>\$\{esc\(engagement\)\}<\/b>/,
  )
  assert.doesNotMatch(
    combat,
    /<div class="fs-h"><b>\$\{esc\(eName\)\}<\/b>[^\n]*\$\{engagement\}/,
  )
  // 旧钉钉的是转发壳 compactEquipmentLink 的存在。它只是原样转发默认长度，
  // 守卫真正要的是「战斗行内的装备名走统一的链接渲染」——名字换了不该算违规，
  // 少了统一出处才算。改成钉调用点直接走 equipmentLinkHtml，且只此一份实现。
  assert.match(combat, /const equipmentLinkHtml = \(mstId: number, maxChars: number \| null = 12\)/)
  assert.match(combat, /我触接 \$\{equipmentLinkHtml\(air\.touchF\)\}/)
  assert.match(combat, /敌触接 \$\{equipmentLinkHtml\(air\.touchE\)\}/)
  assert.match(combat, /\$\{equipmentLinkHtml\(plane\.mstId\)\}×\$\{plane\.count\}/)
  // 只禁定义与调用，源码注释里留着旧名字讲清这段历史是可以的
  assert.doesNotMatch(
    combat,
    /const compactEquipmentLink|compactEquipmentLink\(/,
    '不许再包一层只做转发的同义壳',
  )
  assert.match(combat, /chars\.slice\(0, maxChars\).*…/)
  assert.match(combat, /data-used-equipment="\$\{attack\.equipmentMstIds\.join\(','\)\}">装备详情/)
  assert.match(html, /\.mod-di \.lrow \.tag9\.used-equip \{[\s\S]*white-space: nowrap/)
  assert.match(html, /#di-used-equipment-popover\.show \{[\s\S]*pointer-events: auto/)
  assert.match(ownership, /export const isShipFamilyOwned/)
  // 结算掉落现在走独立的掉落卡，未持有徽章仍要跟着走
  assert.match(combat, /const battleDropChipHtml[\s\S]*?unownedShipBadgeHtml\(mstId\)/)
  assert.match(review, /unownedShipBadgeHtml\(entry\.dropMst\)/)
  assert.match(review, /archiveDropHtml/)
})

test('a taiha warning no longer swallows the battle result and its drop', () => {
  // 曾经的行为：verdictHtml 里大破分支直接 return，把后面整条战果条连同掉落一起替换掉，
  // 于是「Boss 战大破 + 捞到船」这种最该看清的时刻，掉落反而只剩右栏一张卡。
  const combat = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  const html = rendererSource

  // 警告与战果各占一槽，verdictHtml 把两者拼起来而不是二选一
  assert.match(combat, /const verdictHtml = \(s: SortieView\): string =>\s*`\$\{alertBannerHtml\(s\)\}\$\{outcomeBannerHtml\(s\)\}`/)
  assert.match(combat, /const alertBannerHtml[\s\S]*?大破[\s\S]*?return blockedBossNightHtml\(s, b\) \?\? ''/)
  // 战果槽里不许再出现大破分支的提前返回
  const outcome = combat.slice(combat.indexOf('const outcomeBannerHtml'))
  assert.doesNotMatch(outcome.slice(0, outcome.indexOf('const airlineHtml')), /大破 — 请选择撤退/)

  // 掉落是独占一行的实体卡，不再是塞在「基本经验 +xxx」后面的一行小字
  assert.match(combat, /<div class="battle-drop-chip">/)
  assert.doesNotMatch(combat, /class="battle-drop-inline">· 掉落/)
  assert.match(html, /\.mod-di \.battle-drop-chip \{[\s\S]*?flex: 1 0 100%/)
  // 两条横幅叠起来时中间不再各自描边
  assert.match(html, /\.mod-di \.verdict \+ \.verdict \{ border-top: none; \}/)
})

test('弾着観測射撃与先制对潜接进预测，两处「已知偏低」不再挂账', () => {
  const model = fs.readFileSync(new URL('../src/shared/combat-forecast.ts', import.meta.url), 'utf8')
  const spot = fs.readFileSync(new URL('../src/shared/day-spotting.ts', import.meta.url), 'utf8')
  const adapter = fs.readFileSync(new URL('../src/renderer/combat-forecast.ts', import.meta.url), 'utf8')
  const combat = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')

  // 四条前提缺一不可，倍率与观测种别定数照抄原表
  assert.match(spot, /airState !== 1 && airState !== 2/)
  assert.match(spot, /ship\.hp <= Math\.floor\(ship\.hpMax \* 0\.25\)/)
  assert.match(spot, /SEAPLANE\.has\(item\.type2\) && item\.planeCount > 0/, '空格的水侦不算')
  assert.match(spot, /multiplier: 1\.5, attacks: 1, divisor: 150/)
  assert.match(spot, /multiplier: 1\.2, attacks: 2, divisor: 130/, '連撃是 1.2 倍打两次')
  assert.match(spot, /FLAGSHIP_BONUS = 15/)
  // 艦隊索敵補正 2026-09-01 已按源文档实装（⌊√A+0.1A⌋，行为判据在
  // day-spotting.test.mjs 与 combat-forecast.test.mjs 里），旧的「未计，偏低」挂账随之撤掉
  assert.match(spot, /艦隊索敵補正/)
  assert.doesNotMatch(model, /艦隊索敵補正未计/)

  // 先制对潜直接复用编队页那套判据，不许在预测里另写一份
  assert.match(model, /import \{ openingAswOf \} from '\.\/ship-special-attack'/)
  assert.match(model, /const hasOpeningAsw = /)
  // 它是额外一轮，不是换算成倍率
  assert.match(
    model,
    /shellRounds\(attackers, attacker, defenders\) \+ \(hasOpeningAsw\(attacker\) \? 1 : 0\)/,
  )
  assert.doesNotMatch(model, /因此这里尚未计入——又一处已知偏低/)
  // 单队第二轮炮击也不再挂账：wikiwiki「敵味方艦隊のいずれか…戦艦(航空戦艦含む)がいる場合に発生」，
  // 本机 77 场单队昼战复核 20/20 命中、0 误报 0 漏报。空母不是判据（实测 12 次误报）。
  assert.match(model, /hasBattleship\(attackers\) \|\| hasBattleship\(defenders\)/)
  assert.match(model, /BATTLESHIP_STYPES\.has\(ship\.stype\)/)
  assert.doesNotMatch(model, /但触发条件本项目尚未查证/)
  assert.doesNotMatch(model, /已知的偏低/)

  // 制空按 stateMin 判：熟练度按最低算出来的那个，宁可少算
  assert.match(model, /spottingFactorOf\(ship, stateMin, fleetSpottingCorrection\(friendly\)\)/)
  // 艦隊索敵補正要的**素**索敵由适配层反推（面板索敵减回装備索敵），漏了就静默按 0 算
  assert.match(adapter, /baseLos: Math\.max\(/)
  // 适配层要把新字段喂进来，否则判据静默失效
  assert.match(adapter, /iconId: master\.iconId/)
  assert.match(adapter, /los: master\.saku/)
  assert.match(adapter, /ctype: master\?\.ctype/)
  assert.match(adapter, /roster\[0\] === ship\.id/, '旗舰补正只认各自舰队的第一位')

  assert.match(combat, /fc-layer spot[\s\S]{0,600}弹着观测/)
  assert.match(combat, /fc-layer asw[\s\S]{0,400}先制对潜/)
})

test('特殊效果发动概率:编队展开区的金框 pill,双形态由实测宽度定', () => {
  // 2026-09-01 用户拍板的形态：编队（ru）展开详情数据带之后一排金框 pill，
  // 宽度够就平铺、不够整排缩成一枚「特殊效果发动概率」，悬停展开明细卡、点击钉住。
  // **发动率本身的行为判据在 test/special-proc-rate.test.mjs**（真跑纯函数），
  // 这里只钉「接线没断」——各族没有各写一套、浮层没有就地挂、收纳不是按档位切。
  const fleet = fs.readFileSync(new URL('../src/renderer/modules/ru.ts', import.meta.url), 'utf8')
  const lab = fs.readFileSync(new URL('../src/renderer/modules/ji-lab.ts', import.meta.url), 'utf8')
  const html = rendererSource

  // 判定与发动率一律走共享层，编队页不许自己算一套
  assert.match(fleet, /from '\.\.\/\.\.\/shared\/special-proc-rate'/)
  assert.match(fleet, /procRatesOf\(subject, procRateFleetOf\(deck\)\)/)
  // 原始条目先按 group 合并，再一族映射一枚 pill；窄态同样从族视图逐族展开
  assert.match(fleet, /const groups = procRateGroupsOf\(entries\)/)
  assert.match(fleet, /groups\s*\n\s*\.map\(procRatePillHtml\)/)
  assert.doesNotMatch(fleet, /entries\s*\n\s*\.map\(procRatePillHtml\)/)
  assert.match(fleet, /groups\.flatMap\(\(group\) => group\.foldLines\)/)
  // AACI 条件所需的完整舰视图要喂进共享层，缺任一项都会静默漏候选
  for (const field of ['name: master.name', 'slotNum: master.slotNum', 'kai: master.kai', 'asw: ship.taisen']) {
    assert.ok(fleet.includes(field), `编队概率视图缺 ${field}`)
  }
  // 组合实验室的夜战与对空CI发动率都取同一份结论（两处分叉过一次就再也对不上）
  assert.match(lab, /nightEntriesOf,/)
  assert.match(lab, /aaciEntriesOf,/)
  assert.match(lab, /const entries = aaciEntriesOf\(/)
  assert.doesNotMatch(lab, /shipAacis\(/)
  // 摆在数据带（shipStatsHtml）之后
  assert.match(fleet, /\$\{shipStatsHtml\(deck, ship\)\}\s*\n\s*\$\{procRatesHtml\(deck, ship\)\}/)
  // 悬停卡走 link.ts 的富提示：它挂在 body 上（面板既裁 overflow 又带 transform 包含块），
  // 且点击即钉住——不许在面板里就地 absolute 一个浮层
  assert.match(fleet, /data-tip-title=/)
  assert.match(fleet, /PROC_RATE_CARD_TITLE/)
  // 阈值按**量出来的宽度**，不是按坞宽档位（.narrow 之类）切
  assert.match(fleet, /const foldProcRateRow/)
  assert.match(fleet, /contentWidthOf\(row\)/)
  assert.doesNotMatch(fleet, /narrow[\s\S]{0,80}pr-folded/)
  // 三处触发：整段重渲、坞宽变化、点开某一行
  assert.match(fleet, /foldMetrics\(pane\)\s*\n\s*foldProcRates\(pane\)/)
  assert.match(fleet, /host\.innerHTML = shipDetailHtml\(deck, ship\)\s*\n(?:\s*\/\/[^\n]*\n)*\s*foldProcRates\(host\)/)
  // 兜底样式：这一排永远只占一行，量得晚了宁可裁一截也不许换行去偷展开卡的高度
  assert.match(html, /\.fleet-skin \.proc-rates \{[^}]*flex-wrap: nowrap[^}]*\}/s)
  assert.match(html, /\.fleet-skin \.pr-pill\.pr-folded \{ display: none; \}/)
})

test('编队主行概率片只在折叠态显示，展开后由发动率 pill 接管', () => {
  const fleet = fs.readFileSync(new URL('../src/renderer/modules/ru.ts', import.meta.url), 'utf8')
  const html = rendererSource

  // 三类片都常驻主行：折叠态直接显示；展开/折叠只沿用既有 .open 局部 class 补丁，
  // 不重渲这一行，也不在两条渲染函数里各写一份状态判断。
  assert.match(
    fleet,
    /\}\$\{isFlag \? specialAttackChipsHtml\(deck\) : ''\}\$\{shipAbilityChipsHtml\(ship\)\}<span>/,
  )
  assert.match(fleet, /row\.classList\.toggle\('open'\)/)

  // 展开后只隐去旗舰特殊攻击与对空 CI；visibility 保留主行原占位，行高不会跳。
  const expandedRule =
    /\.fleet-skin \.ship\.open \.special-attack-chip,\s*\n\s*\.fleet-skin \.ship\.open \.ability-chip\.aaci \{([^}]*)\}/s.exec(
      html,
    )
  assert.ok(expandedRule, '展开态没有同时接管特殊攻击片与对空 CI 片')
  assert.match(expandedRule[1], /visibility:\s*hidden/, '展开态仍能看见概率类主行片')
  assert.doesNotMatch(expandedRule[1], /display:\s*none/, '隐藏概率片不该改变主行占位')

  // 先制对潜不属于概率 pill 族，必须继续走基础可见样式，不得卷进展开态选择器。
  assert.match(fleet, /class="ability-chip oasw"/)
  assert.doesNotMatch(expandedRule[0], /\.ability-chip\.oasw/)
})

test('夜战与昼战并列摆着，口径按 wikiwiki 抄录不照搬昼战那套', () => {
  const model = fs.readFileSync(new URL('../src/shared/combat-forecast.ts', import.meta.url), 'utf8')
  const night = fs.readFileSync(new URL('../src/shared/night-battle.ts', import.meta.url), 'utf8')
  const combat = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  const html = rendererSource

  // 上限 360，不是昼战那三个；基本攻击力没有昼战炮击的 +5 常数
  assert.match(night, /export const NIGHT_CAP = 360/)
  assert.match(night, /ship\.firepower \+\s*\n?\s*ship\.torpedo \+/)
  // 不吃阵形与交战形态补正，警戒阵主力减半是唯一例外
  assert.match(night, /formation === GUARD_FORMATION && ship\.role !== 'escort'/)
  assert.match(night, /GUARD_MAIN_PENALTY = 0\.5/)
  // 声呐爆雷不参与夜战炮击——照抄昼战那张表会虚报带满声呐的驱逐
  assert.doesNotMatch(night, /0\.75 \* root/)
  // 舰种集合走 kcs-domain 那一份，不许就地再抄
  assert.match(night, /import \{ CARRIER_STYPES \} from '\.\/kcs-domain'/)
  assert.doesNotMatch(night, /new Set\(\[7, 11, 18\]\)/)

  // 夜战单算一套，绝不并进昼战那个数
  assert.match(model, /night: \{ bPlus: nightBPlus, sa: nightSa, taiha: nightExtraTaiha \}/)
  assert.match(model, /const nightOutput = /)
  // 联合舰队夜战只有第二舰队；每舰一轮，不能套用昼战主力两轮
  assert.doesNotMatch(model, /nightOutput[\s\S]{0,900}shellRounds/)
  // 敌方夜战输出按昼战后还剩多少打折，否则大破风险会被系统性高估
  assert.match(model, /const surviving = clamp\(1 - friendlyPressure, 0, 1\)/)
  // 昼夜两段是独立的风险暴露，按 1−(1−昼)(1−夜) 合成；不许再发明一个系数
  assert.match(model, /1 - \(1 - taiha\) \* \(1 - nightOnlyTaiha\)/)
  assert.match(model, /enemy\.ships\.length \* night\.surviving/)

  assert.match(combat, /const nightForecastHtml = /)
  assert.match(combat, /追进夜战/)
  assert.match(combat, /无可攻击舰/, '编成里没人能夜战时要照实说，不能显示一个空的 0%')
  assert.match(html, /\.mod-di \.night-forecast \{/)
})

test('预测的三层加成要挂到面板上说清来源，不能只体现为一个变了的数', () => {
  const model = fs.readFileSync(new URL('../src/shared/combat-forecast.ts', import.meta.url), 'utf8')
  const adapter = fs.readFileSync(new URL('../src/renderer/combat-forecast.ts', import.meta.url), 'utf8')
  const combat = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  const html = rendererSource

  // 说明文字由 factors 生成，不写死——模型多接一层就自动多一行
  assert.match(model, /export const forecastAssumptions = /)
  assert.match(model, /factors\.landTargets > 0/)
  assert.match(model, /factors\.bonusShips > 0/)
  assert.match(model, /factors\.landBaseWaves > 0/)
  // 「未计入」只列模型确实没建的机制；局面事实（本点没派陆航）不算模型缺口
  assert.match(model, /未计入：夜战CI、夜间触接、旗舰特殊攻击（一斉射等）、烟幕、支援舰队、友军舰队/)
  assert.doesNotMatch(model, /活动特效、特殊攻击、烟幕、支援与基地航空队未自动假定发动/)
  // 已经建模的就不能再挂在「未计入」里
  assert.doesNotMatch(model, /未计入：[^']*夜战、/)
  assert.doesNotMatch(model, /未计入：[^']*弹着观测/)

  // 逐层挂牌，每层都要带得出凭据
  assert.match(combat, /const forecastLayersHtml = /)
  assert.match(combat, /fc-layer land[\s\S]{0,400}对地特攻/)
  assert.match(combat, /fc-layer bonus[\s\S]{0,400}活动特效倍卡/)
  assert.match(combat, /fc-layer lbas[\s\S]{0,400}基地航空/)
  // 含暂估值的要跟确定值长得不一样
  assert.match(combat, /bonus\.certain \? '' : ' unsure'/)
  assert.match(html, /\.fc-layer\.unsure \{[^}]*border-style: dashed/)
  // 倍卡明细要逐舰给出叠乘了哪几项，并带资料来源
  assert.match(adapter, /export const eventBonusFleetSummary = /)
  assert.match(adapter, /reasons: bonus\.applied\.map\(/)
  assert.match(adapter, /credit: context\.credit/)
  // 陆航明细与 landBaseWavesAt 必须同一判据，不能一个说派了一个说没派
  assert.match(adapter, /export const landBaseDispatchAt = /)
  assert.match(adapter, /wavesForCell\(sortie\.airBaseStrikes, squad\.rid, cell\)/g)
  assert.equal(
    (adapter.match(/wavesForCell\(sortie\.airBaseStrikes, squad\.rid, cell\)/g) ?? []).length,
    2,
    '陆航波次判据被复制成了两套写法',
  )
})

test('forecast fleet selection treats strike and combined fleets as real sortie units', () => {
  const model = fs.readFileSync(new URL('../src/shared/combat-forecast.ts', import.meta.url), 'utf8')
  const adapter = fs.readFileSync(new URL('../src/renderer/combat-forecast.ts', import.meta.url), 'utf8')
  const combat = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const fleet = fs.readFileSync(new URL('../src/renderer/modules/ru.ts', import.meta.url), 'utf8')

  assert.match(adapter, /requestedDeckId === 1 \|\| requestedDeckId === 2/)
  assert.match(adapter, /canonicalDeckId: 1, deckIds: \[1, 2\], combinedType: mg\.combinedFlag/)
  assert.match(adapter, /scope\.combinedType > 0 && id === 2 \? 'escort' : 'main'/)
  assert.match(adapter, /futureBattleDepth/)
  assert.match(adapter, /ship\.fuel \/ ship\.bull 是游戏最近一次同步的“当前剩余量”/)
  assert.match(model, /const combinedShellBonus = /)
  assert.match(model, /attackers\.combinedType <= 0 \|\| fleetRole\(attacker\) === 'escort'/)
  assert.match(model, /fleet\.combinedType > 0 && opponent\.combinedType <= 0/)
  assert.match(model, /friendly\.ships\.filter\(\(ship\) => fleetRole\(ship\) === fleetRole\(defender\)\)\.length/)
  assert.match(adapter, /const COMBINED_FLEET_LABEL/)
  assert.match(adapter, /export const forecastFleetLabelForDeck/)
  assert.match(adapter, /联合舰队'} · \$\{count\}舰/)
  assert.match(adapter, /scope\.canonicalDeckId === 3 && count === 7/)
  assert.match(adapter, /`游击舰队 · \$\{count\}舰`/)
  assert.match(catalog, /forecastFleetLabelForDeck\(deck\.id\)/)
  assert.match(combat, /forecastFleetLabelForDeck\(s\.deckId\)/)
  // 临战预测的 futureBattleDepth 必须是 0：mg.ships 已同步为此刻剩余燃弹，
  // 再按本轮已发生战数扣一次补给就是重复扣。调用改成多行后仍要钉住这个 0。
  assert.match(
    combat,
    /forecastConfirmedComp\(\s*s\.deckId,\s*comp,\s*abyssalStatsLode\?\.data \?\? \{\},\s*0,/,
  )
  assert.doesNotMatch(combat, /forecastConfirmedComp\(s\.deckId,[\s\S]{0,100}s\.battleCount/)
  // 联合舰队按主力/护卫分段这件事必须写给用户看，不能只在算式里。
  // 说明文字现在由模型按 factors 生成、镝原样渲染——只有一个出处，两处不会各说各话。
  assert.match(model, /联合舰队按主力\$\{factors\.mainCount\}舰 \+ 护卫\$\{factors\.escortCount\}舰分段计算/)
  // 声明整段现在收进「预测口径」折叠层（见 test/forecast-assumption-fold.test.mjs
  // 钉行为），但仍旧是**模型给的原话**逐条渲染：这两条钉的是那条链没断。
  assert.match(combat, /forecastAssumptionsHtml\(band\.assumptions\)/)
  assert.match(combat, /const forecastAssumptionsHtml[\s\S]{0,600}prebattle-model-rule/)
  assert.doesNotMatch(combat, /const combinedNote/, '说明文字回退成镝自己写死的了')
  // 索敌 33 的格子容量按**全量编成**认（6 / 遊撃 7 / 連合 12），不按扣掉退避之后还剩几个人：
  // 遊撃部隊只能靠「有 7 舰」认出来，退避一人就会被读成普通 6 格队，凭空吃掉一格空位补正。
  // 鉴的带路侧读 roster，锐两处读的 all / ships 同样是过滤前那一份（engaged 是另一个名字）。
  assert.match(catalog, /combined \? 12 : roster\.length === 7 \? 7 : 6/)
  assert.match(fleet, /inCombined\(deck\) \? 12 : all\.length === 7 \? 7 : 6/)
  assert.match(fleet, /combined \? 12 : ships\.length === 7 \? 7 : 6/)
})

test('resource trends use calendar-day tiles, a rolling ETA rate, cutoff baselines, and step changes', () => {
  const ledger = fs.readFileSync(new URL('../src/main/mg/ledger.ts', import.meta.url), 'utf8')
  const renderer = fs.readFileSync(new URL('../src/renderer/modules/zi.ts', import.meta.url), 'utf8')
  const review = fs.readFileSync(new URL('../src/renderer/modules/shi.ts', import.meta.url), 'utf8')
  const trend = fs.readFileSync(new URL('../src/renderer/resource-trend-window.ts', import.meta.url), 'utf8')
  const main = fs.readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
  const build = fs.readFileSync(new URL('../scripts/build.mjs', import.meta.url), 'utf8')
  const html = rendererSource
  assert.match(ledger, /ts = \(SELECT MAX\(ts\) FROM material_log WHERE ts < \?\)/)
  assert.match(renderer, /today\.setHours\(0, 0, 0, 0\)/)
  assert.match(renderer, /queryMaterialHistory\(todayStart\)/)
  assert.match(renderer, /todayDelta\(idx\)/)
  assert.match(renderer, /queryMaterialHistory\(rollingDayStart\)/)
  assert.match(renderer, /rollingDayRate\(idx\)/)
  assert.match(renderer, /首次载入\/重启回灌只记基线/)
  assert.match(renderer, /cue\.delta \+= delta/)
  assert.match(renderer, /MATERIAL_DELTA_HOLD_MS = 2400/)
  assert.match(renderer, /materialDeltaCueHtml\(idx\)/)
  assert.match(renderer, /if \(keys\.includes\('materials'\)\) observeMaterialChanges\(\)/)
  assert.match(html, /\.mod-zi \.tile \.h \.live-delta\.leaving/)
  assert.match(html, /@keyframes zi-material-delta-out/)
  assert.doesNotMatch(html, /zi-material-delta-in/)
  assert.match(renderer, /nextDay\.setHours\(24, 0, 0, 0\)/)
  assert.match(renderer, /return last\.values\[idx\] - first\.values\[idx\]/)
  assert.match(trend, /const t0 = historyWindowStart/)
  assert.match(trend, /const t1 = historyWindowEnd/)
  assert.match(trend, /历史仅覆盖/)
  assert.match(trend, /points\.push\(`\$\{x\},\$\{previousY\}`\)/)
  assert.match(renderer, /commitPaneHtml\(pane, 'zi', html\)/)
  assert.doesNotMatch(renderer, /zi-trend-launch|data-open-trend|openResourceTrendWindow/)
  assert.match(review, /data-open-resource-chart/)
  assert.match(review, /void openResourceTrendWindow\(\)/)
  assert.match(main, /new BrowserWindow\(\{[\s\S]*title: 'kuma · 资源增减折线图'/)
  assert.match(main, /ipcMain\.handle\('window:resource-trend'/)
  assert.match(main, /resourceTrendWindow\.focus\(\)/)
  assert.match(main, /resourceTrendWindow\.close\(\)/)
  assert.match(build, /'resource-trend': path\.join\(root, 'src', 'renderer', 'resource-trend-window\.ts'\)/)
  assert.doesNotMatch(renderer, /zi-trend-view|chartHtml|queryActionEvents/)
  assert.doesNotMatch(trend, /\/ spanMs\) \* 24 \* 3600 \* 1000/)
})

test('opening the sortie map screen warns about fleets that are not ready', () => {
  const main = fs.readFileSync(new URL('../src/main/mg/index.ts', import.meta.url), 'utf8')
  const kernel = fs.readFileSync(new URL('../src/renderer/kernel.ts', import.meta.url), 'utf8')
  const fleet = fs.readFileSync(new URL('../src/renderer/modules/ru.ts', import.meta.url), 'utf8')
  assert.match(main, /apiPath === '\/kcsapi\/api_get_member\/mapinfo'/)
  assert.match(main, /webContents\.send\('mg:sortie-screen', ts\)/)
  assert.match(kernel, /ipcRenderer\.on\('mg:sortie-screen'/)
  assert.match(fleet, /onSortieScreen\(warnSortieReadiness\)/)
  assert.match(fleet, /出击前检查：编成中存在大破舰/)
  assert.match(fleet, /出击前检查：可用舰队状态不佳/)
  assert.match(fleet, /showSortieReadinessToast/)
  // 陆航**不**在这一页报：海域选择页不区分你要去哪儿，在这里报等于去 1-1 也弹一次。
  // 它跟札一起挂在「打开了活动图」上（见下面那条测试）。
  const readiness = fleet.slice(
    fleet.indexOf('const warnSortieReadiness'),
    fleet.indexOf('onSortieScreen('),
  )
  assert.ok(readiness.length > 200, '取到的出击前检查片段不对')
  assert.doesNotMatch(readiness, /airBaseReadiness\(\)/, '陆航不该挂在海域选择页上')
  assert.match(fleet, /基地航空 \$\{airBase\.short\} 队未补给/)
  assert.match(fleet, /基地航空 \$\{airBase\.red\} 队红疲劳/)
  // 这条提醒必须落得到基地航空队页，否则点了没反应
  assert.match(fleet, /\{ type: 'fleet', id: AIR_BASE_TAB_ID \}/)
  assert.match(fleet, /id === AIR_BASE_TAB_ID \|\| mg\.decks\.some/)
})

test('opening the expedition screen follows the bottom 远征 tab and restores on leave', () => {
  const main = fs.readFileSync(new URL('../src/main/mg/index.ts', import.meta.url), 'utf8')
  const kernel = fs.readFileSync(new URL('../src/renderer/kernel.ts', import.meta.url), 'utf8')
  const host = fs.readFileSync(new URL('../src/renderer/mu.ts', import.meta.url), 'utf8')
  assert.match(main, /apiPath === '\/kcsapi\/api_get_member\/mission'/)
  assert.match(main, /webContents\.send\('mg:game-scene', scene\)/)
  assert.match(main, /broadcastGameScene\('mission'\)/)
  assert.match(main, /broadcastGameScene\('away'\)/)
  assert.match(kernel, /ipcRenderer\.on\('mg:game-scene'/)
  assert.match(kernel, /export const onGameScene/)
  assert.match(host, /onGameScene\(\(scene\) =>/)
  assert.match(host, /followGameMissionScene/)
  assert.match(host, /restoreGameMissionScene/)
  assert.match(host, /missionTabRestore = \{ dock: at\.dock, gi: at\.gi, id: prev \}/)
  assert.match(host, /if \(prev !== 'bi'\) activateModule\('bi'\)/)
  assert.match(host, /group\.active === saved\.id/)
  // 出发/强制归还/结算都还在远征流程里，不能当成离开。
  const sceneBlock = main.slice(
    main.indexOf("if (apiPath === '/kcsapi/api_get_member/mission')"),
    main.indexOf('if (sections.some((s) => DOMAIN_SECTIONS.has(s)))'),
  )
  assert.match(sceneBlock, /api_port\/port/)
  assert.match(sceneBlock, /api_get_member\/mapinfo/)
  assert.match(sceneBlock, /api_get_member\/practice/)
  assert.match(sceneBlock, /api_get_member\/questlist/)
  assert.doesNotMatch(sceneBlock, /api_req_mission\/start/)
  assert.doesNotMatch(sceneBlock, /api_req_mission\/result/)
})

test('基地航空队的就绪只看真会出门的队，且不把舰队的「可以出击」染红', () => {
  const fleet = fs.readFileSync(new URL('../src/renderer/modules/ru.ts', import.meta.url), 'utf8')
  const html = rendererSource

  assert.match(fleet, /const airBaseReadiness = /)
  // 待機/退避/休息中的队本来就不出门，算进来这行会常年亮着，最后被当噪音无视
  assert.match(fleet, /squad\.actionKind === 1 \|\| squad\.actionKind === 2/)
  // 没同步到陆航时返回 null——不知道就不说
  assert.match(fleet, /if \(!active\.length\) return null/)
  // 红疲劳与橙疲劳分开数：两者伤害不是一个量级，早先它们共用一个类看不出差别
  assert.match(fleet, /plane\.cond >= 3/)
  assert.match(fleet, /plane\.cond === 2/)
  // 陆航问题独占一行，不并进 problems——它不是这支舰队的就绪与否。
  // 旧钉写的是 `airBaseFlagHtml(deck)`，可那个 deck 参数从来没被读过（形参就叫 _deck）：
  // 钉着它反而与下面「陆航挂牌是全局常驻、跟看的是哪支队无关」的口径自相矛盾。
  // 参数已收掉，守卫的原意「基地航空旗标出现在编成抬头、且自成一栏」改钉这两条：
  assert.match(fleet, /const airBase = airBaseFlagHtml\(\)/)
  assert.match(fleet, /const flags = airBase \|\| sally \? `<span class="vflags">/)
  assert.doesNotMatch(fleet, /airBaseFlagHtml\((?!\))/, '陆航挂牌是全局的，不该按舰队传参')
  // 陆航挂牌是**全局常驻**(2026-08-11 用户三轮复现后拍板):开图探测每个
  // 游戏会话每区只响一次,返港重开后就是聋的——绑在它上面的提示必然
  // 忽隐忽现。有问题就亮、修好就灭,不再依赖任何屏幕/开图判据;
  // 就绪时不挂牌,常亮的「就绪」只会沦为背景板。
  assert.match(fleet, /const airBaseFlagHtml = /)
  assert.match(fleet, /new Set\(mg\.airBases\.map\(\(squad\) => squad\.areaId\)\)/)
  assert.match(fleet, /if \(!issues\.length\) return ''/)
  // readiness 按区取数:各区各挂一枚、按区标名——两个区一好一坏时
  // 不能合并成一句谎话
  assert.match(fleet, /const airBaseReadiness = \(areaId\?: number\)/)
  assert.match(fleet, /areaId == null \|\| squad\.areaId === areaId/)
  assert.match(fleet, /airBaseReadiness\(area\)/)
  assert.match(fleet, /airBaseReadiness\(areaId\)/)
  assert.match(fleet, /airBaseAreaLabel\(area\)/)
  // 开图警告同样拆开:札看活动区、陆航看该区驻队,都不成立才闭嘴
  assert.match(fleet, /const eventArea = activeAreasNow\(\)\.has\(areaId\)/)
  assert.match(fleet, /if \(!eventArea && !hasSquadsHere\) return/)
  // 札那条仍只在活动图说话
  assert.match(fleet, /const onEventMapScreen = /)
  assert.ok(fleet.includes('if (!areas.size) return false'), '活动没开时不该提札')
  // 札:出击途中看本趟是不是活动图;选图页上活动开着就说话(判据是
  // 可靠的 mapinfo/port,不依赖开图探测)
  assert.match(fleet, /let lastOpenedMapArea/)
  assert.ok(
    fleet.includes('if (sortie?.active && !sortie.practice) return areas.has(sortie.mapArea)'),
    '出击途中该看这一趟打的是不是活动图',
  )
  assert.ok(fleet.includes('return atMapSelect'), '选图页上活动开着就该说话')
  // 换了区要当场重画一次,保 toast 前后界面一致
  assert.match(fleet, /if \(changed\) render\(\)/)
  // 不知道就不说：退回识别札等于「队里带过活动札就一直亮」，切到 1-1 也不灭,
  // 那正是这条判据要治的毛病
  const relevant = fleet.slice(
    fleet.indexOf('const onEventMapScreen'),
    fleet.indexOf('const airBaseFlagHtml'),
  )
  assert.ok(relevant.length > 100, '取到的判据片段不对')
  assert.doesNotMatch(relevant, /ship\.sallyArea/, '不知道在哪张图时不该退回识别札')
  // 美术请求会因为已缓存而不再发；出击那一刻的海区是确知的，拿它校准
  assert.match(fleet, /const noteSortieArea = /)
  assert.match(fleet, /if \(keys\.includes\('sortie'\)\) noteSortieArea\(\)/)
  // 札的挂牌仍以「摊开的是活动图」为判据(陆航已改按区各判各的)
  assert.match(fleet, /if \(!onEventMapScreen\(\)\) return ''/)

  // 光记「最后摊开哪张图」不够：那个记忆一旦落在活动区就再没东西撤下来，
  // 回了母港两条照样亮着（实测过）。必须同时要求「现在站在海域选择页」。
  assert.match(fleet, /let atMapSelect = false/)
  // 「不在选图页就闭嘴」由 return atMapSelect 一并承担(上面已断言)
  assert.match(fleet, /const noteScreenLeft = /)
  assert.match(fleet, /noteScreenLeft\(keys\)/)
  // 回港要**比值**：patch 每次都捎带 lastPortTs，光看 key 在不在会每次都判成刚回港
  assert.ok(
    fleet.includes('if (mg.lastPortTs !== lastSeenPortTs)'),
    '回港判据不能只看 key 在不在',
  )
  assert.doesNotMatch(fleet, /keys\.includes\('lastPortTs'\)/, 'lastPortTs 每次 patch 都带，当不了信号')
  assert.doesNotMatch(fleet, /problems\.push\(`基地航空/)
  // 挂牌仍然独占一行（别被挤进裁决那行的角落看不见），只是改由 .vflags 承载：
  // 陆航与札两条并排共用这一行，各占一行会让裁决框到三行高。
  assert.match(html, /\.fleet-skin \.vflags \{[^}]*flex-basis: 100%/)
})

test('header status replaces the removed admiral room and fleet sidebar', () => {
  const index = fs.readFileSync(new URL('../src/renderer/index.ts', import.meta.url), 'utf8')
  const html = rendererSource
  const header = fs.readFileSync(new URL('../src/renderer/header-status.ts', import.meta.url), 'utf8')
  const modules = fs.readFileSync(new URL('../src/renderer/mu.ts', import.meta.url), 'utf8')
  const fleet = fs.readFileSync(new URL('../src/renderer/modules/ru.ts', import.meta.url), 'utf8')
  assert.match(index, /initHeaderStatus\(broadcaster\)/)
  assert.doesNotMatch(index, /modules\/lu/)
  assert.equal(fs.existsSync(new URL('../src/renderer/modules/lu.ts', import.meta.url)), false)
  assert.match(html, /id="header-status"/)
  assert.match(html, /#header-status \{[\s\S]*left: 50%; transform: translateX\(-50%\)/)
  assert.doesNotMatch(html, /\.mod-lu/)
  assert.match(header, /mg\.basic\.nickname/)
  assert.match(header, /RESOURCE_ORDER/)
  assert.match(header, /\[2, 3, 4\]/)
  assert.match(header, /mg\.ndocks\.filter/)
  assert.match(header, /registerEntityRoute\('timer'/)
  assert.doesNotMatch(modules, /\['銮', 'Lu'\]/)
  assert.doesNotMatch(modules, /\['lu', 'zi'\]/)
  assert.match(fleet, /registerEntityRoute\('fleet'/)
  assert.match(fleet, /const fleetHeaderHtml = \(deck: Deck\)/)
  // 基地航空队有自己的抬头，真实舰队走 fleetHeaderHtml——中间可以再插别的分支
  // （沙盘就是一个），所以别钉整条三元的写法
  assert.match(fleet, /airBaseActive \? airBaseHeaderHtml\(\)/)
  assert.match(fleet, /fleetHeaderHtml\(deck!\)/)
  assert.doesNotMatch(fleet, /const sideHtml/)
  assert.doesNotMatch(fleet, /<aside class="side">/)
  assert.doesNotMatch(fleet, /nextlineHtml|upcomingEvents|接下来：/)
  assert.doesNotMatch(html, /\.fleet-skin \.nextline/)
})

test('入渠芯片点开的是在修的那艘舰，而计时定位的锚原地不动', () => {
  const header = fs.readFileSync(new URL('../src/renderer/header-status.ts', import.meta.url), 'utf8')
  const links = fs.readFileSync(new URL('../src/renderer/link.ts', import.meta.url), 'utf8')
  const roster = fs.readFileSync(new URL('../src/renderer/modules/qa.ts', import.meta.url), 'utf8')
  const notices = fs.readFileSync(new URL('../src/renderer/modules/lg.ts', import.meta.url), 'utf8')
  const html = rendererSource
  const docks = header.match(/const docksHtml = \(\) => \{[\s\S]*?\n\}/)?.[0] ?? ''
  assert.ok(docks, 'docksHtml 应还在，且仍是一个顶层箭头函数')

  // ① 芯片的标记形状：etype/eid/data-timer 三者必须并存在同一枚芯片上。
  //    少了 etype/eid 就退回「点了闪自己」的自指；少了 data-timer，
  //    通知那头的 focusHeaderTimer 就再也找不到落点。
  assert.match(docks, /data-etype="ship"/, '入渠芯片要指向在修的那艘舰')
  assert.match(docks, /data-eid="\$\{dock\.shipId\}"/, 'eid 是在籍实例 id（rosterId），不是 mstId')
  assert.match(docks, /data-timer="ndock:\$\{dock\.id\}"/, '计时定位的锚必须留在原地')
  assert.match(docks, /class="\$\{ship \? 'el ' : ''\}hs-chip dock on"/, 'peek 只认 .el，且查不到舰时要退回普通芯片')
  // etype 用错粒度会「点开的是图鉴不是这一艘」——图鉴级实体在这里是错的
  assert.doesNotMatch(docks, /data-etype="mstShip"/, '入渠要看的是这一艘的伤势，不是图鉴条目')
  // 'ship' 这条路由确实是实例级、且落点是她自己的详情页
  assert.match(roster, /registerEntityRoute\('ship', \{[\s\S]*?locateRosterInList\(id\)/)
  assert.match(roster, /export const locateRosterInList = \(rosterId: number\) => \{[\s\S]*?state\.selected = rosterId[\s\S]*?detailEnter = true/)
  // 查不到舰时不许仍旧许诺「点击查看舰娘」，也不许再写回旧的自指文案
  assert.match(docks, /\$\{ship \? ' · 点击查看舰娘' : ''\}/)
  assert.doesNotMatch(header, /点击定位倒计时/, '自指的旧文案不许回潮')

  // ② 点击分流：`.el` 闸门必须挡在 data-timer 分支**之前**。两条监听会收到同一次点击
  //    （全局实体链接挂 document，顶栏这条挂 #header-status，冒泡由内向外 → 顶栏先吃到），
  //    顺序写反或闸门缺失，一次点击就会既闪芯片自己又打开实体视图。
  assert.match(links, /document\.addEventListener\('click'/, '全局实体点击在 document 上，顶栏的优先级判断以此为前提')
  assert.match(header, /host\.addEventListener\('click'/)
  assert.match(
    header,
    /if \(target\.closest\('\.el'\)\) return\s*\n\s*const timer = target\.closest<HTMLElement>\('\[data-timer\]'\)\s*\n\s*if \(timer\) navigate\(\{ type: 'timer'/,
    '带实体身份的芯片要让给实体路由，闸门必须在 timer 分支之前',
  )
  // 反向做法（顶栏 stopPropagation 独吞）会把 link.ts 里「点别处收起右键菜单」一起掐掉
  assert.doesNotMatch(header, /\.stopPropagation\(/, '顶栏点击不许掐冒泡')

  // ③ 通知 → 顶栏的定位路径必须完好：靠 [data-timer] 选择器查找 + pulse
  assert.match(header, /host\.querySelector<HTMLElement>\(`\[data-timer="\$\{CSS\.escape\(raw\)\}"\]`\)/)
  assert.match(header, /target\.classList\.add\('pulse'\)/)
  assert.match(header, /if \(kind === 'reset'\) activateModule\('qn'\)\s*\n\s*else focusHeaderTimer\(`\$\{kind\}:\$\{key\}`\)/)
  assert.match(html, /#header-status \.pulse \{ animation: header-status-pulse/)
  assert.match(header, /ndock: 'dock',/, 'ndock 计时仍要能右键找到它的通知规则')
  // 入渠完成通知本来就落在舰娘身上（不是计时自指），芯片这回跟它对齐了
  assert.match(notices, /notify\('dock',[\s\S]*?ship \? \{ type: 'ship', id: ship\.id \} : undefined\)/)

  // ④ `.el` 芯片的描边收拾按 .hs-chip.el 写，别再钉死某一种芯片
  assert.match(html, /#header-status \.hs-chip\.el \{ border-bottom-style: solid; \}/)
  assert.match(html, /#header-status \.hs-chip\.el\.peeked \{/)
  assert.doesNotMatch(html, /#header-status \.hs-chip\.build\.el/)
})

test('顶栏远征芯片按在外/归来/未补给三态上色，且归来跟着倒计时归零那一拍翻', () => {
  const header = fs.readFileSync(new URL('../src/renderer/header-status.ts', import.meta.url), 'utf8')
  const fleet = fs.readFileSync(new URL('../src/renderer/modules/ru.ts', import.meta.url), 'utf8')
  const html = rendererSource
  const bundle = fs.readFileSync(new URL('../dist/renderer/index.js', import.meta.url), 'utf8')

  // ---- ① 三态判定本身：从编译产物里切出来真跑，不比对源码文本 ----
  // 只断言源码长什么样的话，把 `now >= returnAt` 写反照样绿——那正是这条要防的。
  const hit = /\bexpeditionChipState\w* = \((\w+), (\w+), (\w+)\) =>([^;]+);/.exec(bundle)
  assert.ok(hit, '编译产物里找不到 expeditionChipState —— 三态判定被改名或被内联了')
  const stateOf = new Function(hit[1], hit[2], hit[3], `return (${hit[4]})`)

  const T = 1_700_000_000_000
  // 优先级：mission 进行中 → 在外；到点未收 → 归来；无 mission 且未补给 → 未补给；
  // 无 mission 且补给满 → 中性。前两态压过补给状况（人在海上，补给是回来以后的事）。
  assert.equal(stateOf(T + 60_000, false, T), 'away', '倒计时未到应当是「在外」')
  assert.equal(stateOf(T + 60_000, true, T), 'away', '在远征时补给状况不参与判定')
  assert.equal(stateOf(T, false, T), 'back', '归零那一刻就该翻成「归来」')
  assert.equal(stateOf(T - 1, false, T), 'back', '过了点仍是「归来」，不许掉回在外')
  assert.equal(stateOf(T + 1, false, T), 'away', '差 1ms 还没到，不许提前翻')
  assert.equal(stateOf(0, true, T), 'unsupplied', '在家且有舰未补给＝未补给态')
  assert.equal(stateOf(0, false, T), 'idle', '在家且补给满＝中性，不上色')

  // 翻转时刻必须与倒计时文字翻成「返港」是同一刻：fmtCountdownShort 的判据是
  // `remain <= 0`，即 now >= completeTime。一个先一个后就会出现「字写返港、框还是青的」。
  const kernel = fs.readFileSync(new URL('../src/renderer/kernel.ts', import.meta.url), 'utf8')
  const shortFmt = kernel.match(/export const fmtCountdownShort = \([\s\S]*?\n\}/)?.[0] ?? ''
  assert.match(shortFmt, /const remain = completeTime - Date\.now\(\)\s*\n\s*if \(remain <= 0\) return doneText/)
  assert.equal(stateOf(T, false, T), 'back', '文字在 now === completeTime 时已是「返港」，边框必须同拍')

  // ---- ② 翻转走的是逐拍轻量路径，不是等下一次 mg 变更 ----
  assert.match(
    header,
    /onTick\(\(\) => \{\s*\n\s*updateCountdowns\(host!\)\s*\n\s*syncExpeditionChipStates\(host!\)\s*\n\s*\}\)/,
    '归来态必须跟 updateCountdowns 同一拍翻，落在 mg 变更上就要等到下一条报文才变色',
  )
  const sync = header.match(/const syncExpeditionChipStates = \(root: HTMLElement\) => \{[\s\S]*?\n\}/)?.[0] ?? ''
  assert.ok(sync, 'syncExpeditionChipStates 应还在，且仍是顶层箭头函数')
  assert.match(sync, /classList\.toggle\('back'/, '轻量路径只 toggle class')
  assert.doesNotMatch(sync, /innerHTML|render\(\)/, '逐拍翻色不许打穿输出闸门去整条重建')
  assert.match(sync, /expeditionChipState\(/, '逐拍翻转与渲染必须共用同一份三态判定')

  // ---- ③ 未补给判定引锐的单一出处，不许在顶栏手搓一份燃弹对比 ----
  assert.match(fleet, /export const isUnsupplied = \(ship: PlayerShip\): boolean => \{/)
  assert.match(fleet, /ship\.fuel < master\.fuelMax \|\| ship\.bull < master\.bullMax/)
  assert.match(fleet, /export const fleetHasUnsupplied = \(deck: Deck\): boolean => fleetShips\(deck\)\.some\(isUnsupplied\)/)
  assert.match(fleet, /unsupplied: isUnsupplied\(ship\),/, '抬头裁决与顶栏必须共用同一份判定')
  assert.match(header, /import \{ fleetHasUnsupplied \} from '\.\/modules\/ru'/)
  assert.match(header, /expeditionChipState\(0, fleetHasUnsupplied\(deck\), now\)/)
  const expChips = header.match(/const expeditionsHtml = \(\) => \{[\s\S]*?\n\}/)?.[0] ?? ''
  assert.doesNotMatch(expChips, /fuelMax|bullMax/, '顶栏不许再手搓一份燃弹对比')
  // 编译产物里真跑一遍：fleetShips 空队（没有成员）不许被判成未补给
  const fh = /\bfleetHasUnsupplied\w* = \((\w+)\) =>([^;]+);/.exec(bundle)
  assert.ok(fh, '编译产物里找不到 fleetHasUnsupplied')
  assert.match(fh[2], /\.some\(isUnsupplied\w*\)/, '按队问的是「有没有任一舰未补给」')

  // ---- ④ 配色只引既有 token，且三态两两分得开（ΔE 实算在「色板」那条）----
  assert.match(html, /#header-status \.hs-chip\.exp\.on \{ border-color: color-mix\(in srgb, var\(--dock\) \d+%, var\(--line\)\); \}/)
  assert.match(html, /#header-status \.hs-chip\.exp\.on\.back \{ border-color: color-mix\(in srgb, var\(--gold\) \d+%, var\(--line\)\); \}/)
  assert.match(html, /#header-status \.hs-chip\.exp\.unsupplied \{ border-color: color-mix\(in srgb, var\(--warn\) \d+%, var\(--line\)\); \}/)
  // 归来＝全应用的「待领取」金，与建造坞「待领」同一句话；别各挑各的金
  assert.match(html, /#header-status \.hs-chip\.build\.ready \{ border-color: color-mix\(in srgb, var\(--gold\) \d+%, var\(--line\)\); \}/)
  const expCss = html.match(/#header-status \.hs-chip\.exp[\s\S]*?#header-status \.hs-chip\.el \{/)?.[0] ?? ''
  assert.ok(expCss, '远征三态那几行 CSS 应还在 .hs-chip.el 之前')
  assert.doesNotMatch(expCss, /#[0-9a-fA-F]{3,8}\b/, '远征芯片配色不许写裸 hex，只引 token')
})

test('full quest-counter refreshes preserve renderer references before live map progress patches', () => {
  const kernel = fs.readFileSync(new URL('../src/renderer/kernel.ts', import.meta.url), 'utf8')
  const stableSync = kernel.match(/const applyQpState = \(state: QpState\) => \{[\s\S]*?\n\}/)?.[0] ?? ''
  const onState = kernel.match(/const onState = \(_event: unknown, state: QpState\) => \{[\s\S]*?\n    \}/)?.[0] ?? ''

  assert.match(stableSync, /if \(!qpState\) \{[\s\S]*qpState = state/)
  assert.match(stableSync, /qpState\.trackers = state\.trackers/)
  assert.match(stableSync, /qpState\.progress = state\.progress/)
  assert.match(stableSync, /qpState\.serverFloors = state\.serverFloors/)
  assert.match(stableSync, /qpState\.packCredit = state\.packCredit/)
  assert.match(onState, /applyQpState\(state\)/)
  assert.doesNotMatch(onState, /qpState = state/)
  assert.match(kernel, /for \(const state of queuedStates\) applyQpState\(state\)/)
})

test('header shows the actual requested BGM before the admiral name without mistaking fanfares for music', () => {
  const resource = fs.readFileSync(new URL('../src/main/kcs-resource.ts', import.meta.url), 'utf8')
  const broadcaster = fs.readFileSync(new URL('../src/main/game-api-broadcaster.ts', import.meta.url), 'utf8')
  const store = fs.readFileSync(new URL('../src/main/mg/store.ts', import.meta.url), 'utf8')
  const header = fs.readFileSync(new URL('../src/renderer/header-status.ts', import.meta.url), 'utf8')
  const renderer = fs.readFileSync(new URL('../src/renderer/index.ts', import.meta.url), 'utf8')
  const html = rendererSource
  const bgm = fs.readFileSync(new URL('../src/shared/kcs-bgm.ts', import.meta.url), 'utf8')

  assert.match(bgm, /\/bgm\\\/\(port\|battle\)\\\//)
  assert.doesNotMatch(bgm, /\(port\|battle\|fanfare\)/)
  // 2026-08-24 起这一段多了「响过即入档」，解码后的路径先落到一个变量上再复用，
  // 所以判据跟着拆成两句——钉的仍是同一件事：**喂给解析器的是真实资源请求的路径**。
  assert.match(resource, /const bgmPath = decodeURIComponent\(pathname\)/)
  assert.match(resource, /parseKcsBgmPath\(bgmPath\)/)
  assert.match(broadcaster, /this\.emit\('kancolle\.bgm', cue\)/)
  assert.match(store, /for \(const raw of body\.api_mst_bgm \?\? \[\]\)/)
  assert.match(header, /applyPaneHtml\(host, 'header-status', `\$\{bgmHtml\(\)\}\$\{player\}/)
  // 「来源是真实资源请求、不是 fanfare 猜的」这条纪律由上面 kcs-bgm / resource /
  // broadcaster / store 四条各自守住，UI 文案不必再复述一遍；这里只钉两态都有 title，
  // 即「没识别到」要明说没识别到，不留空。
  assert.match(header, /title="当前未识别游戏 BGM"/)
  assert.match(header, /正在播放 · \$\{name\}/)
  assert.match(renderer, /initHeaderStatus\(broadcaster\)/)
  assert.match(html, /#header-status \.hs-bgm/)
  assert.match(html, /text-overflow: ellipsis/)
})

test('practice stays visible in the game header and every actionable notice keeps an exact landing target', () => {
  const header = fs.readFileSync(new URL('../src/renderer/header-status.ts', import.meta.url), 'utf8')
  const notices = fs.readFileSync(new URL('../src/renderer/modules/lg.ts', import.meta.url), 'utf8')
  const quest = fs.readFileSync(new URL('../src/renderer/modules/qn.ts', import.meta.url), 'utf8')
  const battle = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  assert.match(header, /data-practice="current"/)
  assert.match(header, /未打 \$\{info\.remain\}\/\$\{info\.total\}/)
  assert.match(header, /registerEntityRoute\('practice'/)
  assert.match(notices, /notice\.onclick = \(\) =>/)
  assert.match(notices, /goToNotice\(def, ref\)/)
  assert.match(notices, /type: 'questBatch'/)
  assert.match(notices, /type: 'timer', id: `reset:/)
  assert.match(notices, /type: 'battleCurrent'/)
  assert.match(quest, /registerEntityRoute\('questBatch'/)
  assert.match(battle, /registerEntityRoute\('battleCurrent'/)
})

test('practice opponents retain optional admiral and flagship context with legacy-safe rendering', () => {
  const types = fs.readFileSync(new URL('../src/shared/mg-types.ts', import.meta.url), 'utf8')
  const kernel = fs.readFileSync(new URL('../src/renderer/kernel.ts', import.meta.url), 'utf8')
  const store = fs.readFileSync(new URL('../src/main/mg/store.ts', import.meta.url), 'utf8')
  const header = fs.readFileSync(new URL('../src/renderer/header-status.ts', import.meta.url), 'utf8')
  assert.match(types, /level\?: number/)
  assert.match(types, /rank\?: string/)
  assert.match(types, /flagShipId\?: number/)
  assert.match(kernel, /level\?: number[\s\S]*rank\?: string[\s\S]*flagShipId\?: number/)
  assert.match(store, /typeof e\.api_enemy_level === 'number' \? e\.api_enemy_level : undefined/)
  assert.match(store, /typeof e\.api_enemy_rank === 'string' \? e\.api_enemy_rank : undefined/)
  assert.match(store, /typeof e\.api_enemy_flag_ship === 'number' \? e\.api_enemy_flag_ship : undefined/)
  assert.match(header, /if \(entry\.rank\) detail\.push\(entry\.rank\)/)
  assert.match(header, /typeof entry\.level === 'number'/)
  assert.match(header, /elink\('mstShip', entry\.flagShipId, masterShipName\(entry\.flagShipId\)\)/)
  assert.match(header, /entry\.state === 0 \? '○' : '✓'/)
  assert.doesNotMatch(header, /Lv0|军衔 —/)
})

test('fleet view stays complete during expeditions and only hints forward remodels', () => {
  const fleet = fs.readFileSync(new URL('../src/renderer/modules/ru.ts', import.meta.url), 'utf8')
  const fleetCalc = fs.readFileSync(new URL('../src/renderer/fleet-calc.ts', import.meta.url), 'utf8')
  const forecast = fs.readFileSync(new URL('../src/renderer/combat-forecast.ts', import.meta.url), 'utf8')
  const counter = fs.readFileSync(new URL('../src/main/mg/quest-counter.ts', import.meta.url), 'utf8')
  const remodel = fs.readFileSync(new URL('../src/renderer/remodel.ts', import.meta.url), 'utf8')
  const modules = fs.readFileSync(new URL('../src/renderer/mu.ts', import.meta.url), 'utf8')
  const html = rendererSource
  assert.doesNotMatch(fleet, /expeditionView|expExpanded|kcwiki-expedition/)
  // 旧钉写的是 `export const fleetViewHtml`。那个 export 是已删模块留下的口，
  // 全仓再没有第二个消费者，现已收回成模块内部函数——**这条守卫要的从来不是
  // 「它被导出」，而是「远征中的队照样把每一艘都渲染出来」**（fleetShips(deck).map），
  // 结构性断言原样保留，只是不再要求 export。
  assert.match(fleet, /const fleetViewHtml = \(deck: Deck\) =>[\s\S]*fleetShips\(deck\)\.map/)
  assert.doesNotMatch(fleet, /tag = `远征/)
  // 2026-08-30 反转：原先资源/编队/图鉴独占一格时不铺标签条（.tabless），省下的
  // 高度让给内容。但右键标签出「移动到」是换坞换格唯一的入口，没标签的那一格就
  // 再也挪不动——玩家得先把两个模块凑进同一格才看得见标签，而凑模块要用的正是
  // 这个菜单。tabless 整层退役，两个文件都不许回潮（渲染侧与样式侧各堵一头）。
  assert.doesNotMatch(modules, /tabless/, '单模块格又开始省标签条了')
  assert.doesNotMatch(html, /tabless/, '藏标签条的样式又回来了')
  assert.match(modules, /tabs\.className = 'dock-tabs'/)
  assert.doesNotMatch(modules, /mods\.length === 1 &&/, '标签条又挂上「格里几个模块」的条件了')
  assert.match(fleet, /import \{ invalidateRemodelOrder, progressiveRemodelOf.*\} from '\.\.\/remodel'/)
  assert.match(remodel, /export const progressiveRemodelOf =/)
  // 档位写实际那一档：铃谷改的下一档是改二，一律写「改」等于没说。
  // 剥掉改造链原型名，剩下的正好是游戏里的写法；改名换姓的（響改 → Верный）给全名。
  assert.match(fleet, /remodelStageLabel\(/)
  assert.match(fleet, /remodelChainRoot\(ship\.shipId\)/)
  assert.doesNotMatch(fleet, /">· 改 Lv\$\{/, '还写死着「改」')
  assert.match(remodel, /targetRank <= currentRank/)
  assert.match(remodel, /target\?\.afterShipId === ship\.shipId/)
  assert.match(fleet, /class="next-kai\$\{/)
  assert.match(fleet, /· \$\{esc\(nextStage\)\} Lv\$\{nextRemodel\.level\}/)
  assert.match(html, /\.fleet-skin \.who\s*\{[\s\S]*display:\s*flex/)
  assert.match(html, /\.fleet-skin \.who > b\s*\{[\s\S]*display:\s*inline-flex/)
  assert.match(html, /\.fleet-skin \.who > span\s*\{[\s\S]*display:\s*inline-flex/)
  assert.match(html, /\.fleet-skin\.narrow \.who\s*\{\s*display:\s*block/)
  assert.match(html, /\.fleet-skin\.narrow \.who > b, \.fleet-skin\.narrow \.who > span\s*\{\s*display:\s*block/)
  assert.match(fleet, /const effectiveSpeed = ship\.soku \|\| master\?\.soku \|\| 0/)
  assert.match(fleet, /sokuMin >= 20 \? '<b class="g">最速统一<\/b>'/)
  assert.match(fleet, /sokuMin >= 15 \? '<b class="g">高速\+统一<\/b>'/)
  assert.doesNotMatch(fleet, /Math\.min\(sokuMin, master\.soku\)/)
  assert.match(counter, /soku: s\.ships\[id\]\?\.soku \?\? 0/)
  assert.match(counter, /soku: ship\?\.soku \|\| master\.soku\.get\(mstId\) \|\| 0/)
  assert.match(forecast, /firepower: ship\.karyoku/)
  assert.match(forecast, /evasion: ship\.kaihi/)
  // 33 式数学核搬进 shared/fleet-los33（主进程出击样本共用）；
  // fleet-calc 只负责把 mg 实例解析成核输入，面板索敌照旧作起点
  assert.match(fleetCalc, /panelLos: ship\.sakuteki/)
  const los33Core = fs.readFileSync(new URL('../src/shared/fleet-los33.ts', import.meta.url), 'utf8')
  assert.match(los33Core, /let pureLos = ship\.panelLos/)
  // 2026-08-26 文案清扫：度量行 title 缩成「已含装备与近代化改修」——
  //「已含」这个防重复加的口径本体保留，实现自述（「游戏最终面板」「原始值」）删。
  assert.match(fleet, /title="已含装备与近代化改修"/)
  // 「蓝字对空不进制空值」「蓝字索敌已计入」两句按族 3（玩家常识）/族 7 删掉。
  // 真正要守的是数从哪来：制空只给裸值 + 熟练度区间，索敌走 fleetLos33 的四档系数。
  assert.match(fleet, /const airTitle = `裸制空 \$\{air\.basic\} · 不含熟练度加成`/)
  assert.match(fleet, /分支点系数：×1 \$\{losByFactor\[0\]\}/)
})

test('fleet view collapses combined fleets and keeps all land-base areas as a fifth category', () => {
  const fleet = fs.readFileSync(new URL('../src/renderer/modules/ru.ts', import.meta.url), 'utf8')
  const airBases = fs.readFileSync(new URL('../src/main/mg/air-bases.ts', import.meta.url), 'utf8')
  const store = fs.readFileSync(new URL('../src/main/mg/store.ts', import.meta.url), 'utf8')
  const main = fs.readFileSync(new URL('../src/main/mg/index.ts', import.meta.url), 'utf8')
  const types = fs.readFileSync(new URL('../src/shared/mg-types.ts', import.meta.url), 'utf8')
  const html = rendererSource

  assert.match(fleet, /const AIR_BASE_TAB_ID = 0/)
  assert.match(fleet, /\.filter\(\(deck\) => !\(mg\.combinedFlag > 0 && deck\.id === 2\)\)/)
  assert.match(fleet, /const combinedFleetLabel = \(\) => `\$\{COMBINED_FORMATION\[mg\.combinedFlag\][^`]+联合舰队`/)
  assert.match(fleet, /fleetDivisionHtml\(first, '主力舰队'\)/)
  assert.match(fleet, /fleetDivisionHtml\(second, '护卫舰队'\)/)
  assert.match(fleet, /const ships = scopeShips\(deck\)/)
  assert.match(fleet, /const slotCount = combined \? 12 : ships\.length === 7 \? 7 : 6/)
  assert.match(fleet, /entityTermHtml\('fleet', AIR_BASE_TAB_ID, '基地航空队'\)\}<span class="t">\$\{bases\.length\}队/)
  assert.match(fleet, /squad\.areaId === 6 \|\| squad\.areaId === 7/)
  assert.match(fleet, /eventAreas\.has\(squad\.areaId\) \|\| squad\.areaId > 10/)
  assert.match(fleet, /fleetAirPower\(airBaseSlots\(squad\), 1\)/)
  assert.match(fleet, /fleetAirPower\(airBaseSlots\(squad\), 2\)/)
  assert.match(fleet, /正在出击/)
  assert.match(fleet, /mg\.sortie\?\.active/)
  assert.match(
    fs.readFileSync(new URL('../src/renderer/kernel.ts', import.meta.url), 'utf8'),
    /deck\.id === 3 && deck\.ships\.filter\(\(id\) => id > 0\)\.length === 7[\s\S]*?'游击舰队'/,
  )
  assert.match(fleet, /label: inCombined\(deck\) \? '联合舰队' : fleetLabel\(deck\)\.canonical/)
  // 出击状态只留两处:页签徽记 + 裁决框(2026-08-18 用户指出抬头行的
  // 「正在出击 · 图号」小徽记与同排裁决框整句重复,已撤)
  assert.doesNotMatch(fleet, /fleet-sortie-state/)
  assert.doesNotMatch(html, /\.fleet-skin \.fleet-sortie-state/)
  assert.match(fleet, /出击中 · \$\{sortie\.mapArea\}-\$\{sortie\.mapNo\}/)
  // TP 芯片不再行内写「⚠大破N」(2026-08-18 用户指出与裁决框重复):
  // 大破由裁决框独家点名;芯片保留 warn 警示底,口径解释留在悬停 title 里
  assert.doesNotMatch(fleet, /⚠大破\$\{/)
  assert.match(fleet, /mchip\$\{tp\.excludedShips \? ' warn' : ''\}/)
  assert.match(fleet, /艘舰娘大破 · 到达扬陆点时大破的舰娘及其装备一律不计/)
  assert.match(fleet, /keys\.some\(\(k\) => \[[\s\S]*'airBases'[\s\S]*'eventAreas'/)
  assert.match(airBases, /const refreshedAreas = new Set\(incoming\.map/)
  assert.match(airBases, /existing\.filter\(\(squad\) => !refreshedAreas\.has\(squad\.areaId\)\)/)
  assert.match(airBases, /byKey\.set\(`\$\{squad\.areaId\}:\$\{squad\.rid\}`/)
  assert.match(store, /Array\.isArray\(body\?\.api_air_base\)/)
  assert.match(store, /replaceAirBases\(body\.api_air_base, ts\)/)
  assert.match(main, /'mapGauges',[\s\S]*'airBases',[\s\S]*'sortie'/)
  assert.match(types, /ts\?: number \/\/ 该海域最近一次自然同步时点/)
  assert.match(html, /\.fleet-skin \.ab-planes\s*\{[\s\S]*grid-template-columns:\s*repeat\(4/)
  assert.match(html, /\.fleet-skin\.narrow \.ab-planes\s*\{\s*grid-template-columns:\s*repeat\(2/)
})

test('map thumbnails stay readable and expose map codes plus live gauge progress', () => {
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const html = rendererSource
  assert.match(catalog, /const mapThumbOverlayHtml = \(info: any\): string =>/)
  assert.match(catalog, /class="map-thumb-code"/)
  assert.match(catalog, /gauge\.hpNow != null && gauge\.hpMax != null/)
  // 击破计数 2026-08-12 起改扣血口径:条画剩余,不再用 defeated 正着数
  assert.match(catalog, /remain \/ gauge\.required/)
  assert.match(catalog, /class="map-thumb-gauge\$\{cls\}"/)
  assert.match(catalog, /节点图<span class="mg-code">\$\{esc\(code\)\}<\/span>/)
  assert.match(html, /\.mod-ji \.face\.mapface\s*\{[\s\S]*background:\s*#18292c/)
  assert.match(html, /\.mod-ji \.map-thumb-gauge\.done i/)
  assert.match(html, /\.mod-ji \.mg-e\s*\{\s*stroke:\s*var\(--sub\);\s*opacity:\s*\.72/)
})

test('fleet equipment icons use the same entity peek route as equipment names', () => {
  const fleet = fs.readFileSync(new URL('../src/renderer/modules/ru.ts', import.meta.url), 'utf8')
  assert.match(fleet, /import \{ elink, elinkHtml, navigate, registerEntityRoute \} from '\.\.\/link'/)
  assert.match(fleet, /const equipPeekIconHtml = \(/)
  assert.match(fleet, /elinkHtml\('mstEquip', mstId, equipTypeIconHtml\(iconId, options\)/)
  assert.match(fleet, /chips\.push\(equipPeekIconHtml\(inst\.mstId, mst\.iconId, name/)
  assert.match(fleet, /equipPeekIconHtml\(inst!\.mstId, mst\.iconId, name, \{ className: 'sm' \}\)/)
})

test('roster ships keep permanent instance-level life records and expose them in the list preview', () => {
  const ledger = fs.readFileSync(new URL('../src/main/mg/ledger.ts', import.meta.url), 'utf8')
  const tracker = fs.readFileSync(new URL('../src/main/mg/ship-life.ts', import.meta.url), 'utf8')
  const main = fs.readFileSync(new URL('../src/main/mg/index.ts', import.meta.url), 'utf8')
  const roster = fs.readFileSync(new URL('../src/renderer/modules/qa.ts', import.meta.url), 'utf8')
  const html = rendererSource
  assert.match(ledger, /CREATE TABLE IF NOT EXISTS ship_life_state/)
  assert.match(ledger, /CREATE TABLE IF NOT EXISTS ship_life_events/)
  assert.match(ledger, /queryShipLife = \(rosterId: number/)
  assert.match(tracker, /const baselines = ledger\.loadShipLifeState\(\)/)
  assert.match(tracker, /kind: 'exp'/)
  assert.match(tracker, /kind: 'equipment'/)
  assert.match(tracker, /kind: 'sortie'/)
  assert.match(tracker, /kind: 'battle'/)
  assert.match(tracker, /assignmentSignature\(before\) !== assignmentSignature\(after\)/)
  assert.match(tracker, /return old\.mstId !== item\.mstId/)
  assert.doesNotMatch(tracker, /old\.level !== item\.level \|\| old\.alv !== item\.alv/)
  // 前五个实参的顺序是这条守卫要钉的东西；后面还能挂「归约前才取得到」的额外量
  // （hangarCapsBefore 就是一个），所以不锁右括号。
  assert.match(main, /onShipLifeApi\(apiPath, body, postBody, ts, sections/)
  assert.match(main, /ipcMain\.handle\('mg:ship-life'/)
  assert.match(roster, /<b>人生记录<\/b>/)
  assert.match(roster, /记录经验/)
  assert.match(roster, /出击胜利 B\+/)
  assert.match(roster, /演习胜利 B\+/)
  assert.match(ledger, /practice = 0[\s\S]*rank IN \('S', 'A', 'B'\)[\s\S]*AS wins/)
  assert.match(ledger, /practice = 1[\s\S]*rank IN \('S', 'A', 'B'\)[\s\S]*AS practiceWins/)
  assert.match(html, /\.mod-qa \.life-timeline/)
  assert.match(roster, /locateRosterInList\(instance\.id\)/)
  // 一场战斗会同时改变多艘舰 → 整批作废，不能只作废当前选中那艘。
  // 但作废靠推进代号而不是 clear：清掉会让正在看的人生记录塌成「正在读取…」再填回来。
  assert.match(roster, /lifeGeneration \+= 1/)
  assert.doesNotMatch(roster, /lifeReports\.clear\(\)/)
  assert.match(roster, /lifeLoaded\.get\(rosterId\) === generation/)
})

test('practice, fatigue, and activity accounting expose their actual freshness and scope', () => {
  const header = fs.readFileSync(new URL('../src/renderer/header-status.ts', import.meta.url), 'utf8')
  const fatigue = fs.readFileSync(new URL('../src/renderer/fatigue.ts', import.meta.url), 'utf8')
  const activity = fs.readFileSync(new URL('../src/renderer/modules/du.ts', import.meta.url), 'utf8')
  const review = fs.readFileSync(new URL('../src/renderer/modules/shi.ts', import.meta.url), 'utf8')
  const store = fs.readFileSync(new URL('../src/main/mg/store.ts', import.meta.url), 'utf8')
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const notify = fs.readFileSync(new URL('../src/renderer/modules/lg.ts', import.meta.url), 'utf8')
  const fleet = fs.readFileSync(new URL('../src/renderer/modules/ru.ts', import.meta.url), 'utf8')
  const roster = fs.readFileSync(new URL('../src/renderer/modules/qa.ts', import.meta.url), 'utf8')
  const resources = fs.readFileSync(new URL('../src/renderer/modules/zi.ts', import.meta.url), 'utf8')
  assert.match(header, /class="hs-chip practice/)
  assert.match(header, /registerEntityRoute\('practice'/)
  assert.match(fatigue, /if \(confirmed \|\| !prior \|\| prior\.cond !== ship\.cond\)/)
  assert.match(notify, /const confirmed = portTs > 0 && portTs !== lastCondSnapshotTs/)
  assert.match(notify, /trackCond\(confirmed\)/)
  assert.match(notify, /confirmed && mg\.lastPortTs \? mg\.lastPortTs : Date\.now\(\)/)
  assert.match(fatigue, /export const fatigueReadyTs/)
  assert.match(fatigue, /RED_FATIGUE_COND = 20/)
  assert.match(fatigue, /FATIGUE_READY_COND = 30/)
  assert.match(fleet, /fatigueReadyTs\(ship\.id, FATIGUE_READY_COND\)/)
  assert.match(roster, /band === 'red'[\s\S]*?' bad'/)
  assert.match(notify, /士气估算已恢复至 \$\{FATIGUE_READY_COND\}/)
  // 「下列各行只统计这一项」这句自我解说 2026-08-26 按族 7 删了。要守的事没变——
  // 分解仍只取当前那一种资源，改钉取数本身（比钉那句复述硬）＋卡名与净变化行的口径。
  assert.match(resources, /\.map\(\(d\) => \(\{ category: d\.category, value: d\.values\[breakdownRes\] \}\)\)/)
  assert.match(resources, /单项按来源/)
  assert.match(resources, /resource\.label\)\} · 7 日净变化/)
  assert.match(activity, /活动期净变化/)
  assert.doesNotMatch(activity, /<b>已消耗<\/b>/)
  assert.match(store, /period\.lastSeenTs = ts/)
  assert.match(review, /queryEventArchives\(\)/)
  assert.match(catalog, /const loadEventArchives = \(\)/)
  assert.match(notify, /const gameDayKey =/)
})

test('practice defeat judgments never become real ship losses and same-name sides stay explicit', () => {
  const tracker = fs.readFileSync(new URL('../src/main/mg/ship-life.ts', import.meta.url), 'utf8')
  const battle = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  assert.match(tracker, /if \(ship\.sunk && !sortie\.practice\)/)
  assert.match(battle, /击破判定/)
  assert.match(battle, /side === 0 \? '我' : side === 1 \? '对' : '友'/)
})

test('quest rows keep stable progress, reward, and status columns', () => {
  const quest = fs.readFileSync(new URL('../src/renderer/modules/qn.ts', import.meta.url), 'utf8')
  const html = rendererSource
  assert.match(html, /\.mod-qn \.q-rew \{ flex: 0 0 81px; width: 81px;/)
  assert.match(html, /\.mod-qn \.st-tag \{ flex: 0 0 68px; width: 68px;/)
  assert.match(quest, /class="q-work\$\{selected \? ' drawer-open' : ''\}"/)
  assert.match(html, /\.mod-qn \.q-drawer\s*\{[^}]*position:\s*relative;[^}]*flex:\s*0 0 0;/)
  assert.match(html, /\.mod-qn \.q-drawer\.open\s*\{[^}]*flex-basis:\s*clamp\(340px,\s*44%,\s*520px\);/)
  assert.match(html, /\.mod-qn\.narrow \.q-drawer\s*\{[^}]*position:\s*absolute;/)
  assert.match(html, /\.mod-qn \.reward-resource-grid\s*\{[^}]*repeat\(4,/)
  assert.match(quest, /class="q-top-primary"/)
  assert.match(quest, /class="q-control-strip"/)
  // 周期条前面那枚写着「周期」的清除芯片（period-timer + data-period-clear）已退役，
  // 别回潮：日/周/月自己就说清了，再挂一枚同款芯片当「全部」是重复。
  // 紧凑态的周期选择钮（.sel-btn）不在此列——它是那条筛选**唯一**的控件，
  // 不写维度名就只剩一个孤零零的「全部」，读不出选的是什么。
  assert.doesNotMatch(quest, /data-period-clear/)
  assert.doesNotMatch(quest, /class="period-timer[^"]*"[^>]*>\s*<span>周期<\/span>/)
  assert.match(html, /\.mod-qn \.q-period-strip::-webkit-scrollbar,[\s\S]*height: 4px;/)
  assert.match(html, /scrollbar-color: var\(--scrollbar-thumb\) var\(--scrollbar-track\);/)
  assert.match(quest, /data-quick-toggle/)
  // 状态筛选的字样收进 STATUS_FILTERS：常规态的芯片与紧凑态的下拉读同一份，
  // 改了一边两处会叫两个名字。芯片处因此改读 statusLabelOf。
  assert.match(quest, /\{ key: 'current', label: '已同步' \}/)
  assert.match(quest, /data-status="current"[\s\S]*?>\$\{statusLabelOf\('current'\)\} <b>\$\{current\}<\/b>/)
  assert.doesNotMatch(quest, /data-status="current">游戏/)
  assert.match(quest, /const inferredCompletedCodes = \(\): Set<string> =>/)
  assert.match(quest, /inferCompletedQuestCodes\(\s*lib\.values\(\),/)
  assert.match(quest, /Object\.values\(mg\.quests\)\.map\(\(quest\) => quest\.no\)/)
  assert.match(quest, /row\.inferredCompleted && periodOfRow\(row\)\[0\] === '单'/)
  assert.match(quest, /\{ key: 'completed', label: '已完成' \}/)
  assert.match(quest, /data-status="completed"[\s\S]*?>\$\{statusLabelOf\('completed'\)\} <b>\$\{completed\}<\/b>/)
  // 推断出来的「已完成」必须当场交代依据，不能让玩家以为游戏真报了这条。
  // 算法边界（只沿前置链、不认同级旁支）由 quest-chain-tree.test.mjs
  //「complete quest inference follows only observed downstream prerequisites」行为守住，
  // 这里只钉那句用户可见的推定依据。
  assert.match(quest, /推定已完成 · 依据后续任务解锁状态/)
  assert.match(quest, /const questChainNode = \(/)
  assert.match(quest, /elinkHtml\(\s*'quest',\s*entry\.id,/)
  assert.match(quest, /buildQuestChainTree\(current, lib\.values\(\), \{/)
  assert.match(quest, /maxDepth: 6/)
  assert.match(quest, /maxNodesPerDirection: 48/)
  // 「先看直接关系 · 点任务名会把详情切过去」是 UI 自我解说，2026-08-26 按族 7 删了。
  // 「点任务名切详情」这件事本来就该钉控件而不是钉那句话——下面的 questChainNode
  //（带 data-q 的可点节点）与 elinkHtml 就是它，钉那句不许回潮。
  assert.doesNotMatch(quest, /先看直接关系/, 'qn: 任务链的 UI 自我解说又回来了')
  assert.match(quest, /questChainDeeperHtml/)
  assert.match(quest, /questChainBranchHtml\(child, direction, inferred\)/)
  assert.match(html, /\.mod-qn \.chain-tree-list > li::before\s*\{[^}]*border-top:/)
  assert.match(html, /\.mod-qn \.chain-node\.me\s*\{[^}]*border-color:\s*var\(--accent\)/)
  assert.match(quest, /FACTORY_CATEGORY_KEYS = new Set\(\['supply', 'repair', 'build', 'develop', 'scrap', 'improve', 'remodel'\]\)/)
  assert.match(quest, /key: 'factory',\s*label: '工厂'/)
  assert.match(quest, /TASK_CATEGORIES\.find\(\(category\) => category\.test\(row\)\)/)
  assert.match(html, /\.mod-qn \.q-quick-panel\s*\{[^}]*display:\s*none;/)
  assert.match(html, /\.mod-qn \.q-quick-panel\.open\s*\{[^}]*display:\s*flex;/)
})

test('complete quest tree opens in a bounded independent window and returns to task details', () => {
  const main = fs.readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
  const build = fs.readFileSync(new URL('../scripts/build.mjs', import.meta.url), 'utf8')
  const kernel = fs.readFileSync(new URL('../src/renderer/kernel.ts', import.meta.url), 'utf8')
  const quest = fs.readFileSync(new URL('../src/renderer/modules/qn.ts', import.meta.url), 'utf8')
  const html = rendererSource
  const tree = fs.readFileSync(new URL('../src/renderer/quest-tree-window.ts', import.meta.url), 'utf8')
  const treeHtml = fs.readFileSync(new URL('../src/renderer/quest-tree.html', import.meta.url), 'utf8')
  const model = fs.readFileSync(new URL('../src/renderer/quest-chain-tree.ts', import.meta.url), 'utf8')

  assert.match(quest, /data-quest-tree[^>]*>完整任务树<\/button>/)
  // 这枚钮两种抬头都要摆，所以抽成 questTreeHtml 一份；常规抬头里它的位置没变：
  // 跟在搜索框后面收尾第一行，控制条紧随其后。
  assert.match(quest, /const questTreeHtml = `<button class="quest-tree-open" data-quest-tree/)
  assert.match(
    quest,
    /class="qsearch"[\s\S]{0,300}\$\{questTreeHtml\}[\s\S]{0,120}<\/div>\s*<div class="q-control-strip">/,
  )
  assert.match(html, /\.mod-qn\.narrow \.qsearch\s*\{[^}]*flex:\s*1 1 180px/)
  assert.match(html, /\.mod-qn\.narrow \.quest-tree-open\s*\{[^}]*order:\s*1/)
  assert.match(quest, /void openQuestTreeWindow\(state\.selected \?\? undefined\)/)
  assert.match(quest, /data-quest-tree-here/)
  assert.match(quest, /前置任务/)
  assert.match(quest, /后续任务/)
  assert.match(quest, /chain-tree-current[\s\S]*lane\('后续任务'/)
  assert.match(html, /\.mod-qn \.chain-deeper/)
  assert.match(kernel, /ipcRenderer\.invoke\('window:quest-tree', questId \?\? 0\)/)
  assert.match(main, /title: 'kuma · 完整任务树'/)
  assert.match(main, /ipcMain\.handle\('window:quest-tree'/)
  assert.match(main, /webContents\.send\('quest-tree:focus'/)
  assert.match(main, /loadFile\(path\.join\(ROOT, 'dist', 'renderer', 'quest-tree\.html'\)\)/)
  assert.match(main, /webContents\.send\('window:quest-tree-focus', questId\)/)
  assert.match(main, /smoke: quest tree \$\{count\} nodes/)
  assert.match(build, /'quest-tree': path\.join\(root, 'src', 'renderer', 'quest-tree-window\.ts'\)/)
  assert.match(build, /src', 'renderer', 'quest-tree\.html'/)
  assert.match(tree, /buildCompleteQuestForest\(quests\)/)
  assert.match(tree, /pathCodesToQuest\(forest, selectedId\)/)
  assert.match(tree, /data-expand-all/)
  assert.match(tree, /data-collapse-all/)
  assert.match(tree, /data-open-main=/)
  // 副标题那句自述已随发布侧文案清理删掉；它描述的行为本身改钉实现——
  // 树按主前置展开，主前置之外的「兼做」前置必须标在节点上（and-req 徽记 + 悬停列出）。
  assert.match(tree, /class="and-req" title="主前置之外还要同时完成：/)
  assert.match(tree, /quest-tree:focus/)
  assert.match(model, /第一条已知前置作为树上的主父节点/)
  assert.match(model, /extraParents:/)
  assert.match(treeHtml, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*330px/)
  assert.match(treeHtml, /\.complete-tree ul\s*\{[\s\S]*border-left:/)
  assert.match(treeHtml, /\.and-req/)
})

test('fleet instance navigation and resource charts keep exact, bounded, honest context', () => {
  const fleet = fs.readFileSync(new URL('../src/renderer/modules/ru.ts', import.meta.url), 'utf8')
  const roster = fs.readFileSync(new URL('../src/renderer/modules/qa.ts', import.meta.url), 'utf8')
  const resources = fs.readFileSync(new URL('../src/renderer/modules/zi.ts', import.meta.url), 'utf8')
  const review = fs.readFileSync(new URL('../src/renderer/modules/shi.ts', import.meta.url), 'utf8')
  const trend = fs.readFileSync(new URL('../src/renderer/resource-trend-window.ts', import.meta.url), 'utf8')
  const trendHtml = fs.readFileSync(new URL('../src/renderer/resource-trend.html', import.meta.url), 'utf8')
  const ledger = fs.readFileSync(new URL('../src/main/mg/ledger.ts', import.meta.url), 'utf8')
  const html = rendererSource
  assert.match(fleet, /registerEntityRoute\('fleetShip'/)
  assert.match(fleet, /const focusFleetShip = \(rosterId: number\)/)
  assert.match(fleet, /estimatedCond\(ship\.id, FATIGUE_READY_COND\)/)
  assert.match(roster, /navigate\(\{ type: 'fleetShip', id: ship\.id \}\)/)
  assert.match(trend, /queryActionEvents\(rangeStart, now\)/)
  // 聚合行为本身由上一行的 markerBuckets 守住，图例不必再复述机制；
  // 图例要守的是「这些点不是全部，明细得悬停看」——钉这句提示还在。
  assert.match(trend, /const markerBuckets = new Map/)
  assert.match(trend, /操作标记（悬停查看明细）/)
  assert.match(resources, /活动期间账号收支/)
  // 2026-08-26 文案清扫：「不等同于活动本身的消耗」这半句免责删了，口径本体缩短后仍在悬停里
  assert.match(resources, /期初期末差额，含远征、任务与日常操作/)
  assert.match(resources, /normalizeDeltaCategories/)
  assert.match(resources, /母港校准/)
  assert.match(resources, /queryEventSortieCosts\(active\[0\], active\[1\]\.firstSeenTs\)/)
  assert.match(resources, /活动出击航行消耗/)
  // 「不含入渠、基地航空补给…」那句「这里不含 X」2026-08-26 按族 A 删了。这一格的
  // 诚实性靠带数字的那半句撑着（记录不全的出击有几次，当场说出来），改钉它。
  assert.match(resources, /另有 \$\{activitySortieCosts\.skipped\} 次因出发记录不完整而未计入/)
  assert.match(ledger, /supply_baseline TEXT NOT NULL/)
  assert.match(ledger, /Number\(row\.completed\) === 1/)
  assert.match(ledger, /recoverOverwrittenSortieCosts/)
  assert.match(ledger, /WHERE sortie_id = \? AND completed = 0/)
  assert.match(ledger, /queryEventSortieCosts = \(/)
  assert.match(ledger, /sortieCosts/)
  assert.match(trend, /class="event-band"/)
  assert.match(trendHtml, /\.chart-op/)
  assert.match(html, /\.mod-zi \.activity-ledger/)
})

test('ship collection notes remain instance-safe and the roster caches only derived base rows', () => {
  const personal = fs.readFileSync(new URL('../src/renderer/ship-personal.ts', import.meta.url), 'utf8')
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const roster = fs.readFileSync(new URL('../src/renderer/modules/qa.ts', import.meta.url), 'utf8')
  const html = rendererSource
  assert.match(personal, /favoriteRoots: number\[\]/)
  assert.match(personal, /rosterNotes: Record<string, string>/)
  assert.match(personal, /离籍后 ID 备注保留/)
  // 「持有」段的排布机制自述已删；这里改钉备注本身指名到哪一艘——
  // 这正是本 test 名字里的 instance-safe，比原来那句排布说明更贴本意。
  assert.match(catalog, /当前持有<span class="aux">按改装链汇总<\/span>/)
  assert.match(catalog, /这一艘的备注 · ID \$\{entry\.id\}/)
  assert.match(catalog, /data-roster-note=/)
  assert.match(catalog, /data-ship-favorite=/)
  assert.match(catalog, /shipRosterNote\(entry\.rosterId\)/)
  assert.match(roster, /let rowCache: Row\[\] \| null = null/)
  assert.match(roster, /let out = \[\.\.\.rows\]/)
  assert.match(roster, /invalidateRowCache\(\)/)
  // CSV 表头是用户可见面，「实例」已按裁定换成自然语；钉整段尾部避免 '备注' 撞到别处，
  // 并补钉导出取的是每一艘自己的备注（不是改装链共用的那条）。
  assert.match(roster, /'锁船标签', '备注'\]/)
  assert.match(roster, /shipRosterNote\(r\.ship\.id\)/)
  assert.match(roster, /无更高改造/)
  assert.match(roster, /class="qa-sort-mobile"/)
  assert.match(roster, /querySelectorAll<HTMLElement>\('\[data-sort\]'\)/)
  assert.match(html, /\.mod-qa\.narrow table \{[^}]*min-width: 0/)
  assert.match(html, /\.mod-qa\.narrow tbody tr \{[^}]*flex-wrap: wrap/)
  // 单独界面窄了自动叠单列（auto-fit），不靠藏内容
  assert.match(html, /\.mod-qa \.dv-cols \{[^}]*repeat\(auto-fit, minmax\(320px, 1fr\)\)/)
  assert.doesNotMatch(html, /\.mod-qa table \{ min-width: 640px/)
})

test('every compact module releases fixed child widths instead of hard-cropping the dock', () => {
  const html = rendererSource
  assert.match(
    html,
    /@container jidrawer \(max-width: 540px\) \{[\s\S]*?\.mod-ji \.d-head, \.mod-ji \.detail \{[^}]*min-width: 0/,
  )
  assert.match(html, /\.mod-bi \.bi-app\.narrow \.detail > \* \{[^}]*min-width: 0/)
  assert.match(
    html,
    /\.mod-bi \.bi-app\.narrow \.exp-h-metrics \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/,
  )
  assert.match(html, /\.mod-bi \.bi-app\.narrow \.exp-h-net-main \{ grid-template-columns: 1fr/)
  assert.doesNotMatch(html, /\.mod-bi\.narrow \.exp-h-net-main/)
  assert.match(
    html,
    /@container \(max-width: 360px\) \{[\s\S]*?\.mod-mgstate \.mg-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/,
  )
  assert.match(html, /#lg-toasts \{[^}]*width: min\(250px, calc\(100vw - 24px\)\)/)
  assert.match(html, /\.mod-yu \.yin \{[^}]*max-width: 100%/)
  assert.match(html, /\.mod-yu \.ytable \{[^}]*table-layout: fixed/)
  assert.match(html, /\.mod-lg \.rcard \{ overflow-x: auto; \} \/\* 规则表窄了横向滚，不裁列 \*\//)
})

test('intentional view switches animate without making live data refreshes flash', () => {
  const html = rendererSource
  const modules = fs.readFileSync(new URL('../src/renderer/mu.ts', import.meta.url), 'utf8')
  const kernel = fs.readFileSync(new URL('../src/renderer/kernel.ts', import.meta.url), 'utf8')
  const links = fs.readFileSync(new URL('../src/renderer/link.ts', import.meta.url), 'utf8')
  const quest = fs.readFileSync(new URL('../src/renderer/modules/qn.ts', import.meta.url), 'utf8')
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const roster = fs.readFileSync(new URL('../src/renderer/modules/qa.ts', import.meta.url), 'utf8')
  const expedition = fs.readFileSync(new URL('../src/renderer/modules/bi.ts', import.meta.url), 'utf8')
  const review = fs.readFileSync(new URL('../src/renderer/modules/shi.ts', import.meta.url), 'utf8')
  assert.match(modules, /paneOf\.get\(other\)\?\.classList\.toggle\('active', on\)/)
  assert.match(html, /\.ws-pane\.active\s*\{[^}]*animation:\s*kanso-view-enter/)
  assert.match(html, /@keyframes kanso-view-enter/)
  assert.match(html, /#overlay-host\.show\s*\{[^}]*visibility:\s*visible;[^}]*opacity:\s*1;/)
  assert.match(html, /#overlay-host\.show \.ov-panel\s*\{[^}]*transform:\s*none;/)
  assert.match(html, /\.mod-ji \.ship-subview\.enter\s*\{[^}]*animation:\s*kanso-subview-enter/)
  assert.match(catalog, /function shipDetailPanelHtml\(enter = false\)/)
  assert.match(catalog, /panel\.innerHTML = shipDetailPanelHtml\(true\)/)
  assert.match(catalog, /const abyssDetailPanelHtml = \(ship: any, enter = false\)/)
  assert.match(catalog, /panel\.innerHTML = abyssDetailPanelHtml\(ship, true\)/)
  assert.match(html, /\.mod-shi \.shi-view\.enter\s*\{[^}]*animation:\s*kanso-subview-enter/)
  assert.match(review, /enterNextView = true\s+render\(\)/)
  assert.doesNotMatch(html, /\.mod-ji \.panel\.on\s*\{[^}]*animation:\s*kanso-view-enter/)
  assert.match(catalog, /id="ji-ship-panel"/)
  assert.match(catalog, /shipState\.dtab = next\s+updateShipDetailPanel\(\)/)
  assert.match(catalog, /shipState\.dtab === 'p-drop'[\s\S]*updateShipDetailPanel\(\)/)
  assert.match(catalog, /updateShipDetailPanel[\s\S]*?withViewStateKept\(pane, \(\) =>/)
  assert.match(html, /@starting-style\s*\{[\s\S]*?\.mod-qn \.q-drawer\.open:not\(\.stable\)\s*\{[^}]*flex-basis:\s*0;/)
  assert.match(html, /\.mod-qn \.q-drawer\.stable\s*\{[^}]*transition:\s*none/)
  assert.match(quest, /const drawerAlreadyOpen = !!selected && !!pane\.querySelector\('\.q-drawer\.open'\)/)
  assert.match(quest, /drawerAlreadyOpen \? ' stable' : ''/)
  assert.match(catalog, /const drawerWasOpen = !!pane\.querySelector\('\.book-wrap\.open'\)/)
  assert.match(catalog, /open && drawerWasOpen \? ' stable' : ''/)
  // 舰娘列表 2026-08-11 改成整面板接管的单独界面：进场动画只在用户主动打开时
  // 放一次（detailEnter 一次性旗标），mg 推着的重渲染不重播
  assert.match(roster, /qa-detail\$\{detailEnter \? ' enter' : ''\}/)
  assert.match(roster, /detailEnter = false\s+wireDetail\(detailRow\)/)
  assert.match(expedition, /const detailWasOpen = !!selected && !!pane\.querySelector\('\.bi-app\.open'\)/)
  assert.match(expedition, /detail\$\{detailWasOpen \? ' stable' : ''\}/)
  assert.match(html, /\.mod-ji \.drawer\.stable\s*\{[^}]*transition:\s*none/)
  assert.match(html, /\.mod-bi \.detail\.stable\s*\{[^}]*transition:\s*none/)
  assert.match(html, /\.mod-ji \.book-wrap\.open \.drawer:not\(\.stable\)/)
  assert.match(html, /\.mod-qa \.qa-detail\.enter\s*\{[^}]*animation:\s*kanso-subview-enter/)
  assert.match(html, /\.mod-bi \.bi-app\.open \.detail:not\(\.stable\)/)
  assert.match(html, /\.peek\.show\s*\{[^}]*visibility:\s*visible;[^}]*opacity:\s*1;/)
  assert.match(html, /\.cmenu\.show\s*\{[^}]*visibility:\s*visible;[^}]*opacity:\s*1;/)
  assert.match(html, /\.fleet-skin \.ship-detail\s*\{[^}]*max-height:\s*0;[^}]*opacity:\s*0;/)
  assert.match(html, /#cg-lightbox\.show\s*\{[^}]*visibility:\s*visible;[^}]*opacity:\s*1;/)
  assert.match(kernel, /export const exitWithMotion =/)
  assert.match(quest, /exitWithMotion\(pane\.querySelector<HTMLElement>\('\.q-drawer\.open'\), 'open', render\)/)
  assert.match(catalog, /const closeBookDrawer =/)
  assert.match(links, /const removePeekCard =/)
  assert.match(html, /@media \(prefers-reduced-motion:\s*reduce\)/)
  assert.doesNotMatch(html, /\.ws-pane\s*\{[^}]*animation:/)
})

test('interaction audit keeps toggles, countdowns, routes, and hidden refreshes coherent', () => {
  const html = rendererSource
  const links = fs.readFileSync(new URL('../src/renderer/link.ts', import.meta.url), 'utf8')
  const modules = fs.readFileSync(new URL('../src/renderer/mu.ts', import.meta.url), 'utf8')
  const kernel = fs.readFileSync(new URL('../src/renderer/kernel.ts', import.meta.url), 'utf8')
  const header = fs.readFileSync(new URL('../src/renderer/header-status.ts', import.meta.url), 'utf8')
  const fleet = fs.readFileSync(new URL('../src/renderer/modules/ru.ts', import.meta.url), 'utf8')
  const resources = fs.readFileSync(new URL('../src/renderer/modules/zi.ts', import.meta.url), 'utf8')
  const battle = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  const activity = fs.readFileSync(new URL('../src/renderer/modules/du.ts', import.meta.url), 'utf8')
  const expedition = fs.readFileSync(new URL('../src/renderer/modules/bi.ts', import.meta.url), 'utf8')
  const diagnostics = fs.readFileSync(new URL('../src/renderer/modules/mgstate.ts', import.meta.url), 'utf8')
  const notices = fs.readFileSync(new URL('../src/renderer/modules/lg.ts', import.meta.url), 'utf8')

  assert.match(links, /if \(\(e\.target as HTMLElement\)\.closest\('\[data-l10n-toggle\]'\)\) return/)
  assert.match(
    modules,
    /if \(isOverlay\(id\)\) \{\s*if \(overlayOpen !== id\) openOverlay\(id\)\s*return\s*\}/,
  )
  assert.match(kernel, /export const fmtCountdownShort = \(completeTime: number, doneText = '完成'\)/)
  assert.match(kernel, /if \(remain <= 0\) return doneText/)
  assert.doesNotMatch(kernel, /fmtCountdownShort[\s\S]{0,180}return '返港'/)
  assert.match(kernel, /el\.dataset\.cdsDone \?\? '完成'/)
  assert.match(header, /data-cds-done="返港"/)
  assert.match(header, /data-cds-done="已刷新"/)
  assert.match(fleet, /data-cds-done="已恢复"/)
  assert.match(fleet, /data-ready-ts=/)
  // 终态词随挂牌走（与 kernel 的 data-cds-done 同族）：裁决框仍是默认的「全员已就绪」，
  // 抬头那格的疲劳恢复时刻自带「士气已回满」。两处共用同一趟 tick，不许各起定时器。
  assert.match(fleet, /label\.textContent = label\.dataset\.readyDone \?\? '全员已就绪'/)
  assert.match(fleet, /data-ready-done="士气已回满"/)
  assert.match(fleet, /远征 \$\{deck\.mission\[1\]\} 即将返港/)
  assert.match(kernel, /export const nextWeeklyReset =/)
  assert.match(kernel, /export const nextMonthlyReset =/)
  assert.match(header, /key === 'weekly'\s*\? nextWeeklyReset\(\)/)
  assert.match(header, /key === 'monthly'\s*\? nextMonthlyReset\(\)/)
  assert.doesNotMatch(notices, /const JST_OFFSET/)
  assert.doesNotMatch(notices, /昼夜战模拟/)
  // 大破跳战斗详情而非舰娘图鉴——当下要看的是这一战的局面。
  // 多艘大破合并成一条后，ref 取领衔那艘，判定形状不变。
  assert.match(notices, /rosterId != null \? \{ type: 'battleCurrent', id: \w+\.rosterId \} : undefined/)
  assert.match(notices, /const unreadCount = \(\) =>/)
  assert.match(notices, /\(rules\[notice\.event\] \?\? DEFAULT_RULES\[notice\.event\]\)\?\.badge/)

  // 2026-08-25：这里改走 fleetLabel——deck.name 未改名时就是游戏默认的「第N艦隊」
  assert.match(activity, /elink\('fleet', deck\.id, fleetLabel\(deck\)/)
  assert.match(diagnostics, /elink\('fleet', deck\.id, canonical\)/)
  assert.match(
    expedition,
    /state\.area = null\s*state\.search = ''\s*state\.resourceFocus = null\s*state\.selected =/,
  )
  assert.match(modules, /export const isModuleAvailable =/)
  assert.match(resources, /isModuleAvailable\('du'\)/)
  assert.match(resources, /活动进度暂不可用/)
  assert.match(battle, /data-bship="\$\{ship\.rosterId\}"/)
  assert.match(battle, /registerEntityRoute\('battleCurrent',[\s\S]*open\(ref\)/)
  assert.match(battle, /scrollIntoView\(\{ behavior: 'smooth', block: 'center' \}\)/)
  assert.match(html, /\.mod-di \.brow\.focus\s*\{[^}]*animation:\s*header-status-pulse/)

  assert.match(fleet, /const render = \(force = false\) =>/)
  assert.match(resources, /const render = \(force = false\) =>/)
  assert.match(battle, /const render = \(pane: HTMLElement, force = false\) =>/)
  for (const source of [fleet, resources, battle]) {
    assert.match(source, /!force && !pane\.classList\.contains\('active'\)/)
  }
})

test('global entity links use distinct semantic colors and matching peek highlights', () => {
  const html = rendererSource
  const localization = fs.readFileSync(new URL('../src/renderer/localization.ts', import.meta.url), 'utf8')
  const links = fs.readFileSync(new URL('../src/renderer/link.ts', import.meta.url), 'utf8')
  const expected = {
    ship: 'ship',
    abys: 'abyss',
    equip: 'equip',
    map: 'map',
    item: 'item',
    quest: 'quest',
    exp: 'expedition',
    fleet: 'fleet',
    material: 'material',
    practice: 'practice',
    timer: 'timer',
    nationality: 'nationality',
  }
  const colors = []
  for (const [className, token] of Object.entries(expected)) {
    assert.match(html, new RegExp(`\\.e-${className} \\{ --entity-color: var\\(--entity-${token}\\);`))
    const color = html.match(new RegExp(`--entity-${token}:\\s*(#[0-9a-fA-F]{6})`))?.[1]
    assert.ok(color, `missing --entity-${token}`)
    colors.push(color.toLowerCase())
  }
  assert.equal(new Set(colors).size, colors.length)
  assert.match(
    html,
    /\.el\.peeked\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--entity-color, var\(--accent\)\)/,
  )
  assert.doesNotMatch(html, /\.el\.peeked\s*\{[^}]*rgba\(77,\s*184,\s*255/)
  assert.match(html, /\.el,\s*\.entity-term\s*\{\s*color:\s*var\(--entity-color/)
  assert.match(
    localization,
    /<span class="entity-term \$\{entityColorClass\(domain\)\}">\$\{body\}<\/span>/,
  )
  assert.match(links, /const colorClass = entityLinkColorClass\(type, id\)/)
  assert.match(links, /class="entity-term \$\{colorClass\}"/)
  for (let index = 0; index < 8; index++) {
    assert.match(html, new RegExp(`\\.e-material-${index} \\{ --entity-color: var\\(--r-`))
  }
  assert.match(localization, /type !== 'material'/)
  assert.match(localization, /`\$\{base\} e-material-\$\{materialIndex\}`/)
  const moduleDir = new URL('../src/renderer/modules/', import.meta.url)
  const routeSources = [
    fs.readFileSync(new URL('../src/renderer/header-status.ts', import.meta.url), 'utf8'),
    ...fs.readdirSync(moduleDir)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => fs.readFileSync(new URL(name, moduleDir), 'utf8')),
  ].join('\n')
  const registeredTypes = [...routeSources.matchAll(/registerEntityRoute\('([^']+)'/g)].map((match) => match[1])
  const mappedTypes = localization.match(/ENTITY_COLOR_CLASS_BY_LINK_TYPE[^=]*=\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
  for (const type of registeredTypes) {
    assert.match(mappedTypes, new RegExp(`\\n\\s*${type}:\\s*'e-`), `missing semantic color for ${type}`)
  }
})

test('standalone typed fields keep semantic colors without turning prose into keyword markup', () => {
  const localization = fs.readFileSync(new URL('../src/renderer/localization.ts', import.meta.url), 'utf8')
  const resources = fs.readFileSync(new URL('../src/renderer/modules/zi.ts', import.meta.url), 'utf8')
  const review = fs.readFileSync(new URL('../src/renderer/modules/shi.ts', import.meta.url), 'utf8')
  const diagnostics = fs.readFileSync(new URL('../src/renderer/modules/mgstate.ts', import.meta.url), 'utf8')
  const quests = fs.readFileSync(new URL('../src/renderer/modules/qn.ts', import.meta.url), 'utf8')
  const expeditions = fs.readFileSync(new URL('../src/renderer/modules/bi.ts', import.meta.url), 'utf8')
  const fleet = fs.readFileSync(new URL('../src/renderer/modules/ru.ts', import.meta.url), 'utf8')
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const activity = fs.readFileSync(new URL('../src/renderer/modules/du.ts', import.meta.url), 'utf8')
  const trend = fs.readFileSync(new URL('../src/renderer/resource-trend-window.ts', import.meta.url), 'utf8')

  assert.match(localization, /普通说明文字不做关键词扫描或自动染色/)
  assert.match(resources, /entityTermHtml\('material', idx, meta\.label\)/)
  assert.match(resources, /entityTermHtml\('material', st\.idx, meta\.label\)/)
  assert.match(diagnostics, /entityTermHtml\('material', i, MAT_LABELS\[i\]\)/)
  assert.match(diagnostics, /'高速建造材', '高速修复材', '开发资材', '改修资材'/)
  assert.doesNotMatch(diagnostics, /'建造', '修复', '开发', '改修'/)
  assert.match(quests, /elink\('material', index, resourceNames\[index\]\)/)
  assert.match(quests, /taskProseHtml\(row\.desc/)
  assert.match(quests, /<span class="k">涉及国籍<\/span>/)
  assert.match(quests, /entityNameHtml\('quest', row\.id, row\.name \|\| row\.observed\?\.title/)
  assert.match(expeditions, /entityNameHtml\('expedition', e\.dispNo/)
  assert.match(expeditions, /entityTermHtml\('material', materialIndex, label\)/)
  assert.match(fleet, /entityTermHtml\('fleet', deck\.id, displayName\)/)
  assert.match(catalog, /entityNameHtml\('shipType', form\.api_stype/)
  assert.match(catalog, /entityNameHtml\('equipType', cat/)
  assert.match(catalog, /entityNameHtml\('mapArea', info\.api_maparea_id/)
  assert.match(trend, /entityTermHtml\('material', series\.idx, series\.label\)/)

  assert.doesNotMatch(localization, /replace\([^)]*(燃料|弹药|钢材|铝土)/)
  assert.doesNotMatch(resources, /<div class="h"><span class="ic"[^]*<\/span>\$\{meta\.label\}<\/div>/)
  for (const action of ['建造', '开发', '改修', '修复']) {
    const escaped = action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    assert.doesNotMatch(
      [resources, diagnostics, quests, expeditions, fleet, catalog, trend].join('\n'),
      new RegExp(`entityTermHtml\\('material'[^\\n]*['"]${escaped}['"]\\)`),
      `${action} action must not inherit a similarly named material color`,
    )
  }
  assert.match(review, />建造 \$\{factoryStats\.ship/)
  assert.match(review, />开发 \$\{factoryStats\.item/)
  // 「改修工厂」在段头是**功能名**，不是资材名——它不许套 entityTermHtml('material')
  // 拿到改修资材那一色。段头后面挂着 aux 小字（今天能不能改 / 不可改修 / 暂无收录），
  // 所以三种收尾都放行，管住的仍是「裸文字」这条
  assert.match(catalog, /<div class="sec-h">改修工厂(<\/div>|<span class="aux)/)
  assert.match(trend, /label: '建造', glyph: '建'/)
  assert.match(trend, /label: '开发', glyph: '开'/)
  assert.match(trend, /label: '改修', glyph: '改'/)
  assert.match(activity, /elink\('material', -1, '资源统计 →'\)/)
  assert.doesNotMatch(activity, /elink\('material', 0, '资源统计 →'\)/)
})

test('nationality is one shared exact dimension across quests and catalog', () => {
  const shared = fs.readFileSync(new URL('../src/shared/ship-nationality.ts', import.meta.url), 'utf8')
  // 编成门 2026-08-21 起一律由 quest-fleet-rules 推导（EO 的条件树整层退场），
  // 国籍那一维随之搬家；判据不变：编号段只此一份，不许另立
  const fleetRules = fs.readFileSync(new URL('../src/main/mg/quest-fleet-rules.ts', import.meta.url), 'utf8')
  const quests = fs.readFileSync(new URL('../src/renderer/modules/qn.ts', import.meta.url), 'utf8')
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')

  assert.match(shared, /shipNationalityIdFromSortId/)
  assert.match(shared, /value < 30000\) return 1/)
  assert.match(fleetRules, /shipNationalityIdFromSortId\(ship\.api_sort_id\)/)
  assert.match(fleetRules, /nationalityShips: \(natIds: number\[\]\) => number\[\]/)
  assert.doesNotMatch(fleetRules, /国籍：未实现/)
  // 正文里的国籍仍然是可点链接，只是外面多套了一层文中提醒的记号
  assert.match(quests, /elinkHtml\('shipNationality', mark\.ref/)
  assert.match(catalog, /registerEntityRoute\('shipNationality'/)
  assert.match(catalog, /shipState\.nationalityFilter/)
  assert.doesNotMatch(catalog, /暂未加入国籍条件/)
  // 装备加成那一维 2026-08-22 走了个来回，两次都是跟着**源**走的：
  // 换源时随包的 kcwiki 底表把海外舰逐条列成形态与舰级，那一源确实没有国籍维度，
  // 于是槽也撤了（留一个永远空的槽只会误导）；同日晚些时候第一方自补层要转写
  // wikiwiki 的蓝字表，那边有「イギリス艦」「日駆逐」「イギリス空母」这类国籍类目，
  // 没有这一维就只能整行挂牌（567 整件 + 575/577/578 部分行）。所以槽回来了。
  // **判据仍旧只此一份**：fit-bonus 自己不许再抄一套编号段，视图那一维由 ji 用共享判据填。
  const fitBonus = fs.readFileSync(new URL('../src/shared/fit-bonus.ts', import.meta.url), 'utf8')
  assert.match(fitBonus, /nations\?: number\[\]/, '装备加成的国籍维度没了，自补层那几行会掉回挂牌')
  assert.doesNotMatch(
    fitBonus,
    /\b3[0-9]000\b|api_sort_id/,
    '装备加成又自己抄了一套国籍编号段 —— 判据只准有 ship-nationality 一份',
  )
  assert.match(catalog, /nationality: shipNationalityIdFromSortId\(/)
})

test('every renderer window uses the same dark scrollbar palette', () => {
  const main = rendererSource
  const trend = fs.readFileSync(new URL('../src/renderer/resource-trend.html', import.meta.url), 'utf8')
  const questTree = fs.readFileSync(new URL('../src/renderer/quest-tree.html', import.meta.url), 'utf8')
  const shipLife = fs.readFileSync(new URL('../src/renderer/ship-life.html', import.meta.url), 'utf8')
  for (const [name, html] of [
    ['main', main],
    ['resource trend', trend],
    ['quest tree', questTree],
    ['ship life', shipLife],
  ]) {
    assert.match(html, /:root\s*\{[^}]*color-scheme:\s*dark/)
    assert.match(html, /--scrollbar-track:\s*#10171d/)
    assert.match(html, /--scrollbar-thumb:\s*#334957/)
    assert.match(html, /scrollbar-width:\s*thin/)
    assert.match(
      html,
      /scrollbar-color:\s*var\(--scrollbar-thumb\)\s+var\(--scrollbar-track\)/,
      `${name} must override the light native scrollbar palette`,
    )
    assert.match(html, /::-webkit-scrollbar\s*\{\s*width:\s*8px;\s*height:\s*8px/)
    assert.match(html, /::-webkit-scrollbar-track\s*\{\s*background:\s*var\(--scrollbar-track\)/)
    assert.match(html, /::-webkit-scrollbar-thumb:hover\s*\{[^}]*var\(--scrollbar-thumb-hover\)/)
    assert.match(html, /::-webkit-scrollbar-thumb:active\s*\{[^}]*var\(--scrollbar-thumb-active\)/)
    const scrollbarRules = [...html.matchAll(/[^{}]*::-webkit-scrollbar[^{}]*\{[^}]*\}/g)]
      .map((match) => match[0])
      .join('\n')
    assert.doesNotMatch(scrollbarRules, /\b(?:white|#fff(?:fff)?|rgb\(255)/i)
  }
  assert.match(main, /#header-status\s*\{[^}]*scrollbar-width:\s*none/)
  assert.match(main, /\.dock-tabs\s*\{[^}]*scrollbar-width:\s*none/)
})

test('ship catalog groups sister ships and task links expose complete owned-aware entities', () => {
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const quest = fs.readFileSync(new URL('../src/renderer/modules/qn.ts', import.meta.url), 'utf8')
  const html = rendererSource
  assert.match(catalog, /root\.api_ctype !== shipState\.classFilter/)
  assert.match(catalog, /const rootsOfClass = \(ctype: number\)/)
  assert.match(catalog, /class="sister-head\$\{collapsible \? ' toggle'/)
  assert.match(catalog, /data-sister-toggle=/)
  assert.match(catalog, /uiSet\('ji\.collapsedShipClasses'/)
  assert.match(catalog, /每个官方 ctype 都必须有自己的舰级标题/)
  assert.match(catalog, /allSisters\.length > 1 \? '姊妹舰' : '同级舰'/)
  assert.match(catalog, /sister-arrow single/)
  assert.match(catalog, /const yomi = `\$\{root\.api_yomi \?\? ''\}`\.trim\(\)/)
  assert.match(catalog, /yomi \? esc\(yomi\) : '',[\s\S]*has \? '' : '未持有'/)
  // 2026-08-19 用户点名：装备加成条件里的舰级/舰名/需带装备都要有实体链接。
  // 2026-08-22 换成第一方 schema（who.forms / who.classes / need.with），三处链接照旧
  const fitWho = catalog.slice(
    catalog.indexOf('const fitWhoHtml'),
    catalog.indexOf('const fitGainHtml'),
  )
  assert.ok(fitWho.length > 200, '找不到装备加成的条件渲染段')
  assert.match(fitWho, /set\.forms[\s\S]{0,120}elink\('mstShip', id, masterShipName\(id\)\)/)
  assert.match(fitWho, /set\.classes[\s\S]{0,160}elink\('shipClass', ctype, shipClassLabel\(ctype\)\)/)
  assert.match(fitWho, /slot\.any[\s\S]{0,200}elinkHtml\(\s*'mstEquip',/)
  assert.match(catalog, /const CALENDAR_WEEKDAY_CHIPS = \[[\s\S]*\{ day: 1, label: '一'[\s\S]*\{ day: 0, label: '日'/)
  // 哪几天点亮由行为级护栏管（test/improve-card-layout.test.mjs 逐枚比对 title 与
  // days）；这里只钉「七天那张表仍是改修卡在用」——判断写反时正则拦不住，别重复钉
  assert.match(catalog, /const improveWeekHtml[\s\S]{0,240}CALENDAR_WEEKDAY_CHIPS\.map\(/)
  assert.doesNotMatch(catalog, /const DAY_LABELS = \['日', '月', '火', '水', '木', '金', '土'\]/)
  assert.match(catalog, /registerEntityRoute\('shipClass'/)
  assert.match(catalog, /registerEntityRoute\('shipTypeCatalog'/)
  assert.match(catalog, /registerEntityRoute\('shipTypeGroup'/)
  assert.match(catalog, /registerEntityRoute\('equipTypeCatalog'/)
  assert.match(catalog, /registerEntityRoute\('equipTypeGroup'/)
  assert.match(catalog, /const unlocked = !unlockStateKnown \|\| info\.api_id in mg\.mapGauges \|\| !!period\?\.ended/)
  assert.match(quest, /aliases: string\[\]/)
  assert.match(quest, /allowQuotedSingle/)
  assert.match(quest, /SHIP_TYPE_ALIASES/)
  assert.match(quest, /EQUIP_TYPE_ALIASES/)
  assert.match(quest, /allowTaskShipAlias/)
  assert.match(quest, /allowTaskShipTypeAlias/)
  assert.match(quest, /allowTaskEquipTypeAlias/)
  assert.match(quest, /taskEntityMemoText\(row\.memo2\)/)
  assert.match(quest, /taskEntityTextDomainAllowed\('map', row\.code\)/)
  assert.match(quest, /taskEntityTextDomainAllowed\('expedition', row\.code\)/)
  assert.match(quest, /export const questsMentioning = \([\s\S]*domain: 'ship' \| 'equip' \| 'item'/)
  assert.match(quest, /const rewardText = entry\?\.memo \?\? ''/)
  assert.match(catalog, /questsMentioning\(terms, domain\)/)
  assert.match(quest, /queryLode\('kcwiki-expedition'\)/)
  // 编成条件那一份反查料：EO 退场后 condText 不存在了，改读 fleetGoal 各组的 label
  assert.match(quest, /\(tracker\?\.fleetGoal\?\.groups \?\? \[\]\)\.map\(\(group\) => group\.label\)/)
  assert.doesNotMatch(quest, /condText/, 'condText 已随 EO 条件树退场，不该回潮')
  assert.match(quest, /matchAll\(\/\(\\d\+\)\\s\*\[-‐‑‒–—\]\\s\*\(\\d\+\)\/g\)/)
  assert.match(quest, /if \('map' in task\) mapRefs\.add/)
  assert.match(quest, /task\.kind === 'scrapEquip'/)
  assert.match(quest, /task\.kind === 'scrapCategory'/)
  assert.match(quest, /task\.kind === 'expedition'/)
  assert.match(quest, /elink\('shipClass'/)
  assert.match(quest, /const displayedClassIds = new Set\(classes\.map\(\(entry\) => entry\.id\)\)/)
  assert.match(quest, /\.filter\(\(entry\) => !displayedClassIds\.has\(entry\.ctype\)\)/)
  assert.doesNotMatch(quest, /q-class-members/)
  assert.match(quest, /elink\('shipTypeCatalog'/)
  assert.match(quest, /elink\('equipTypeCatalog'/)
  assert.match(quest, /const mapUnlocked =/)
  assert.match(html, /\.mod-qn \.q-entity-state\.unavailable/)
  assert.match(html, /\.mod-ji \.row\.ghost \.mini-map/)
})

test('roster is an independent section inside the catalog instead of a duplicate dock module', () => {
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const roster = fs.readFileSync(new URL('../src/renderer/modules/qa.ts', import.meta.url), 'utf8')
  const host = fs.readFileSync(new URL('../src/renderer/mu.ts', import.meta.url), 'utf8')
  const index = fs.readFileSync(new URL('../src/renderer/index.ts', import.meta.url), 'utf8')
  const html = rendererSource
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  assert.match(catalog, /type Book = 'ship' \| 'roster' \| 'equip'/)
  assert.match(catalog, /\['roster', '列表'\]/)
  assert.match(catalog, /\['ship', '舰娘'\],[\s\S]*\['item', '道具'\],\s*\['roster', '列表'\]/)
  assert.match(catalog, /rosterHost\.id = 'ji-roster-host'/)
  assert.match(catalog, /mountRosterView\(rosterHost\)/)
  assert.match(catalog, /rosterWasConnected = rosterHost\.isConnected/)
  assert.match(catalog, /appendChild\(rosterHost\)/)
  assert.match(catalog, /else if \(!rosterWasConnected\)\s*\{\s*refreshRosterView\(\)/)
  assert.match(catalog, /setRosterViewOpener\(\(\) =>/)
  assert.match(roster, /export const mountRosterView = \(element: HTMLElement\)/)
  assert.match(roster, /export const refreshRosterView =/)
  assert.doesNotMatch(roster, /rosterResizeObserver\?\.disconnect\(\)/)
  assert.match(roster, /export const setRosterViewOpener =/)
  assert.doesNotMatch(roster, /registerModule\(\{\s*id: 'qa'/)
  assert.doesNotMatch(roster, /data-act="to-ji"/)
  assert.match(host, /left: \[\['ji'\]\]/)
  // 这里原来还顺带钉着「图鉴独占左坞时省掉标签条」（.tabless）。2026-08-30 标签条改
  // 恒显之后那条断言与本测试的题意（列表是图鉴的一卷，不再是独立坞模块）无关，
  // 上面的 left: [['ji']] 已经把「左坞只有图鉴」守住了。恒显本身的护栏在
  // 「fleet view stays complete during expeditions」那条里。
  assert.doesNotMatch(host, /\['qa', /)
  assert.doesNotMatch(index, /import '\.\/modules\/qa'/)
  assert.match(html, /\.mod-ji \.roster-embed/)
  assert.doesNotMatch(readme, /\| `qa` \|/)
  assert.match(readme, /\| 回顾 \| `shi` \| 回顾/)
  assert.match(readme, /\| 左坞 \| 图鉴（含舰娘列表）/)
  assert.match(readme, /\| 顶栏弹窗 \| 回顾 · 通知 · 设置/)
})

test('battle results retain bounded local replay snapshots linked from ship life', () => {
  const ledger = fs.readFileSync(new URL('../src/main/mg/ledger.ts', import.meta.url), 'utf8')
  const main = fs.readFileSync(new URL('../src/main/mg/index.ts', import.meta.url), 'utf8')
  const chronicle = fs.readFileSync(new URL('../src/main/mg/chronicle.ts', import.meta.url), 'utf8')
  const tracker = fs.readFileSync(new URL('../src/main/mg/ship-life.ts', import.meta.url), 'utf8')
  const battle = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  // 履历行的实现 2026-08-31 从 qa 挪进 renderer/ship-life-events（人生记录弹窗
  // 摆的是同一条时间轴，文案源只许有一份）。守卫跟着挪，别对着老地址空转。
  const lifeRow = fs.readFileSync(
    new URL('../src/renderer/ship-life-events.ts', import.meta.url),
    'utf8',
  )
  assert.match(ledger, /CREATE TABLE IF NOT EXISTS battle_snapshots/)
  assert.match(ledger, /LIMIT 500/)
  assert.match(ledger, /queryBattleSnapshot = \(id: number\)/)
  assert.match(main, /ledger\.logBattleSnapshot\(ts, sortie\)/)
  assert.match(chronicle, /ipcMain\.handle\('chron:battles'/)
  assert.match(chronicle, /ipcMain\.handle\('chron:battle'/)
  assert.match(tracker, /snapshotId: battle\.result\.snapshotId/)
  assert.match(battle, /registerEntityRoute\('battle'/)
  assert.match(battle, /queryBattleSnapshot\(id\)/)
  // 主窗口走实体链接；独立窗口没有路由，由调用方给一版跨窗跳转（battleLink）。
  // 两支都必须在，缺哪一支那一边的复盘入口就成了死字。
  assert.match(lifeRow, /: elink\('battle', snapshotId, title\)/)
  assert.match(lifeRow, /titleHtml = options\.battleLink/)
  const lifeWindow = fs.readFileSync(
    new URL('../src/renderer/ship-life-window.ts', import.meta.url),
    'utf8',
  )
  assert.match(lifeWindow, /openBattleReplayWindow\(snapshotId\)/)
})

test('review node history remains independently browsable after the current sortie ends', () => {
  const types = fs.readFileSync(new URL('../src/shared/mg-types.ts', import.meta.url), 'utf8')
  const ledger = fs.readFileSync(new URL('../src/main/mg/ledger.ts', import.meta.url), 'utf8')
  const chronicle = fs.readFileSync(new URL('../src/main/mg/chronicle.ts', import.meta.url), 'utf8')
  const review = fs.readFileSync(new URL('../src/renderer/modules/shi.ts', import.meta.url), 'utf8')
  const html = rendererSource
  assert.match(types, /export interface NodeHistoryReport/)
  assert.match(ledger, /queryNodeHistoryIndex = \(/)
  assert.match(ledger, /queryNodeHistory = \(/)
  assert.match(chronicle, /ipcMain\.handle\('chron:node-history-index'/)
  assert.match(chronicle, /ipcMain\.handle\('chron:node-history'/)
  assert.match(review, /queryNodeHistory\(map, cell, 200\)/)
  assert.match(review, /data-shi-node=/)
  assert.match(review, /data-shi-node-title/)
  assert.match(review, /paintNodeSelection/)
  assert.match(review, /class="shi-view shi-nodes"/)
  assert.match(review, /shi-mapgraph-frame/)
  assert.doesNotMatch(review, /if \(!paintNodeSelection\(\)\) render\(\)/)
  assert.match(review, /正在读取该点的长期记录/)
  assert.match(review, /const shownNodeMap = \(\): number =>/)
  assert.match(review, /selectedNodeMap \?\? selectedNode\?\.map \?\? nodeIndex\[0\]\?\.map/)
  assert.match(review, /nodeSnapshotsBlock\(shownNodeMap\(\)\)/)
  assert.match(review, /data-shi-snapshots-title/)
  // 选中点位专属那块：整图那块必须留着，两块并排在底栏，且换点走补丁不整页重渲
  assert.match(review, /const nodeBattlesBlock = \(\)/)
  assert.match(review, /battle\.map === map && battle\.cell === cell/)
  assert.match(review, /data-shi-node-snapshots-title/)
  assert.match(review, /nodeSnapPanel\.hidden = !nodeSnaps/)
  assert.match(review, /class="shi-panel shi-recent-battles"/)
  assert.match(html, /\.mod-shi \.shi-node-timeline/)
  assert.match(html, /\.shi-node-timeline \{ height: 420px; \}/)
  assert.match(html, /shi-body:has\(\.shi-nodes\)/)
  assert.match(html, /\.mod-shi \.shi-mapgraph-frame/)
  assert.match(html, /\.mod-shi \.shi-mapgraph-card \{[\s\S]*height: 220px;/)
  assert.match(html, /#overlay-host \.ov-panel \{[\s\S]*height: min\(820px, 84vh\);/)
  assert.match(html, /\.mod-shi \.shi-nodes > \.shi-nodes-foot \{[\s\S]*max-height: 200px;/)
  assert.match(html, /\.mod-shi \.shi-nodes-foot > \.shi-panel\[hidden\] \{ display: none; \}/)
})

test('map catalog owns full-route planning while combat keeps only the current encounter', () => {
  const battle = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const html = rendererSource
  assert.doesNotMatch(battle, /queryLode\('kcwiki-routing'\)/)
  assert.doesNotMatch(battle, /routeCardHtml/)
  assert.match(battle, /preBattleMechanicHtml/)
  assert.match(catalog, /queryLode\('kcwiki-routing'\)/)
  assert.match(catalog, /const plannedRoutes = /)
  assert.match(catalog, /evaluateRoutingRules\(rules, context, candidates\)/)
  assert.match(catalog, /全图与路线预测/)
  assert.match(html, /\.mod-ji \.map-model-route/)
})

test('equipment catalog offers a complete today-first improvement view', () => {
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const kernel = fs.readFileSync(new URL('../src/renderer/kernel.ts', import.meta.url), 'utf8')
  const store = fs.readFileSync(new URL('../src/main/mg/store.ts', import.meta.url), 'utf8')
  const types = fs.readFileSync(new URL('../src/shared/mg-types.ts', import.meta.url), 'utf8')
  const html = rendererSource
  assert.match(catalog, /data-equip-mode="today">今日改修/)
  assert.match(catalog, /for \(const \[variant, imp\] of \(eo\.improvement \?\? \[\]\)\.entries\(\)\)/)
  assert.doesNotMatch(catalog, /const imp = eo\.improvement\[0\]/)
  // 「锁定装备不会计入素材」是游戏规则复述，按文案清扫裁定（族 3）删。
  // 同一枚「口径」角标护的另半句是真口径，改钉它，语义不放松。
  assert.match(catalog, /普通消耗用于可行性判断，确保成功时以上限为准/)
  assert.match(catalog, /满足当前编成条件/)
  assert.match(catalog, /需明石任第一舰队旗舰/)
  assert.match(catalog, /helpers 为空的少数条目代表日程资料缺失/)
  assert.match(catalog, /: '未改修'/)
  assert.doesNotMatch(catalog, /: '素'/)
  assert.match(catalog, /const day = jstDayOfWeek\(\)/)
  assert.match(catalog, /nextJstTime\(\[0\]\) - Date\.now\(\)/)
  assert.match(kernel, /export const jstDayOfWeek = \(ts = Date\.now\(\)\): number =>/)
  const jstDay = (ts) => new Date(ts + 9 * 3600 * 1000).getUTCDay()
  assert.equal(jstDay(Date.parse('2026-08-08T14:59:59Z')), 6)
  assert.equal(jstDay(Date.parse('2026-08-08T15:00:00Z')), 0)
  assert.match(types, /locked: boolean \/\/ 锁定装备不能作为改修素材/)
  assert.match(store, /locked: item\.api_locked === 1/)
  assert.match(html, /\.mod-ji \.today-summary/)
  assert.match(catalog, /<details class="improve-helper-more">/)
  assert.match(catalog, /<details class="equip-holder-more">/)
  assert.match(catalog, /全部装备舰/)
  // 全部候选走同一份列表渲染（超过 6 艘自己折起来）。2026-08-25 起它落在展开层，
  // 折叠态只报头一个 + 还有几艘；哪一层放什么由 test/today-improve-row.test.mjs 钉
  assert.match(catalog, /improvementHelperListHtml\(candidateIds, 6, '二号舰'\)/)
  assert.match(catalog, /elinkHtml\('mstEquip', eo\.eq_id, entityNameHtml\('equip'/)
  assert.match(catalog, /improvementMaterialLink\(6, '开发资材'\)/)
  assert.match(catalog, /improvementMaterialLink\(7, '改修资材'\)/)
  assert.match(catalog, /Array\.from\(\{ length: 10 \}/)
  assert.match(catalog, /各列为达到该星级后的累计提升/)
  assert.match(html, /\.mod-ji \.improve-star-table/)
  assert.match(html, /\.mod-ji \.equip-holder-more/)
})

test('roster marks fleet membership and keeps it fresh across deck changes', () => {
  const roster = fs.readFileSync(new URL('../src/renderer/modules/qa.ts', import.meta.url), 'utf8')
  const html = rendererSource
  // 在编反查：编队位 -1 是空位，旗舰是第 0 位
  // 2026-08-25：队名改走 fleetLabel（默认「第N艦隊」归一成中文，自定义名原样）
  assert.match(roster, /const label = fleetLabel\(deck\)/)
  assert.match(roster, /name: label\.custom \?\? label\.canonical/)
  assert.match(roster, /flagship: i === 0/)
  assert.match(roster, /fleet: fleetByShip\.get\(ship\.id\) \?\? null/)
  // 行内徽记 + 「在编」筛选片
  assert.match(roster, /class="infleet"/)
  assert.match(roster, /infleet: \(row\) => !!row\.fleet/)
  assert.match(roster, /smartChip\('infleet', '在编'\)/)
  // decks 变化必须作废行缓存，否则改编成后标注是旧账
  assert.match(roster, /'ships', 'slotitems', 'ndocks', 'decks', 'basic', 'master'/)
  assert.match(html, /\.mod-qa td\.nm \.infleet/)
})

test('furniture ownership flows from require_info into stock view and quest rewards', () => {
  const types = fs.readFileSync(new URL('../src/shared/mg-types.ts', import.meta.url), 'utf8')
  const store = fs.readFileSync(new URL('../src/main/mg/store.ts', import.meta.url), 'utf8')
  const kernel = fs.readFileSync(new URL('../src/renderer/kernel.ts', import.meta.url), 'utf8')
  const stock = fs.readFileSync(new URL('../src/renderer/modules/equip-stock.ts', import.meta.url), 'utf8')
  const quests = fs.readFileSync(new URL('../src/renderer/modules/qn.ts', import.meta.url), 'utf8')
  const match = fs.readFileSync(new URL('../src/renderer/task-entity-match.ts', import.meta.url), 'utf8')
  // 数据层：require_info 与家具屋两个端点都收，旧快照无家具时保持 null（未知≠没有）
  assert.match(types, /furnitures: number\[\] \| null/)
  assert.match(types, /\| 'furnitures'/)
  assert.match(store, /const toFurnitureIds = /)
  assert.match(store, /'\/kcsapi\/api_get_member\/furniture':/)
  assert.match(store, /furnitureLayout: Array\.isArray\(body\.api_basic\.api_furniture\)/)
  assert.match(kernel, /mg\.furnitures = s\.player\.furnitures \?\? null/)
  // 仓库装饰品视图：两轴切换 + 家具实体路由；未同步时如实说、不下「没有」的结论
  assert.match(stock, /data-es-view="furniture"/)
  assert.match(stock, /registerEntityRoute\('furniture'/)
  assert.match(stock, /持有情况尚未同步/)
  // 任务奖励识别：只从奖励文本认家具；mg.furnitures 为 null 时不标灰
  assert.match(quests, /matchedEntities\(furnitureNameIndex, taskEntityMemoText\(row\.memo\), 4\)/)
  assert.match(quests, /mg\.furnitures\s*\? availabilityWrap\(mg\.furnitures\.includes\(entry\.id\)/)
  // 简化转写对齐用的字形归并（「掛け軸」→「挂け轴」）
  assert.match(match, /掛: '挂', 軸: '轴', 団: '团', 記: '记', 餅: '饼', 鯨: '鲸'/)
})

test('catalog keeps a five-layer back/forward history instead of prev-next stepping', () => {
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const kernel = fs.readFileSync(new URL('../src/renderer/kernel.ts', import.meta.url), 'utf8')
  const html = rendererSource
  // 双栈的账在 nav-history.test.mjs 里编译真模块跑；这里只钉接线不被误删
  assert.match(catalog, /const JI_NAV_DEPTH = 5/)
  assert.match(catalog, /const jiNav = createNavHistory<JiNavLocation>\(JI_NAV_DEPTH\)/)
  assert.match(catalog, /jiNavTrack\(\)\s*\n\s*const bookTabs/, '历史对账要在 render 拼 HTML 之前')
  assert.match(catalog, /data-jinav="back"/)
  assert.match(catalog, /data-jinav="fwd"/)
  assert.match(catalog, /jiNavLast\.scroll = captureScrollProfile\(pane\)/, '入栈时连滚动剖面一起存档')
  assert.match(catalog, /applyScrollProfile\(pane, loc\.scroll\)/, '还原时把滚动位置一起还回去')
  // 上一舰/下一舰步进按钮已退役（2026-08-16 用户拍板，由历史返回/前进取代）
  assert.doesNotMatch(catalog, /ji-ship-prev/)
  assert.doesNotMatch(catalog, /ji-ship-next/)
  assert.match(kernel, /export const applyScrollProfile = /)
  assert.match(html, /\.mod-ji \.ji-nav-btn/)
  assert.doesNotMatch(html, /\.d-head \.pn/)
})

test('item catalog treats current inventory as a filter instead of a collection rate', () => {
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const types = fs.readFileSync(new URL('../src/shared/mg-types.ts', import.meta.url), 'utf8')
  const store = fs.readFileSync(new URL('../src/main/mg/store.ts', import.meta.url), 'utf8')
  const main = fs.readFileSync(new URL('../src/main/mg/index.ts', import.meta.url), 'utf8')
  const kernel = fs.readFileSync(new URL('../src/renderer/kernel.ts', import.meta.url), 'utf8')
  const html = rendererSource
  assert.match(catalog, /cat === 'owned' \? ''/)
  // 道具页不给收藏率（活动道具会回收，凑不齐是常态）。解释那半句按文案清扫
  // 裁定（族 3 玩家常识）删了，但「不给收藏率」这条行为不变：钉住页脚只报
  // 「当前显示 N 项 / 资料库共 N 项」两个绝对数，一旦有人加回百分比就红。
  assert.match(catalog, /资料库共 \$\{all\.length\} 项/)
  assert.doesNotMatch(catalog, /item-scope-note[\s\S]{0,200}?收藏率/)
  assert.match(catalog, /当前显示 <b>\$\{list\.length\}<\/b> 项/)
  assert.match(catalog, /resolveUseitemStock\(id, useitemMst\.get\(id\)\?\.api_name/)
  assert.match(catalog, /stock\.known \? `持有 ×\$\{count\}` : '尚未同步持有数量'/)
  assert.match(catalog, /库存按资源 \/ 提督状态 \/ 装备 \/ 道具四域合并/)
  assert.match(types, /furnitureCoins\?: number/)
  assert.match(types, /useitemsTs: number \| null/)
  assert.match(store, /p\.useitemsTs = ts/)
  assert.match(store, /api_basic\.api_fcoin/)
  assert.match(main, /patch\.useitemsTs = state\.player\.useitemsTs/)
  assert.match(kernel, /mg\.useitemsTs = s\.player\.useitemsTs \?\? null/)
  assert.doesNotMatch(catalog, /const ownedCount =/)
  assert.doesNotMatch(catalog, /持有 <b>\$\{ownedCount\}/)
  assert.match(html, /\.mod-ji \.item-scope-note/)
  assert.doesNotMatch(html, /\.mod-ji \.iprog/)
})

test('factory history joins build recipes to claimed ships and counts batched development results', () => {
  const types = fs.readFileSync(new URL('../src/shared/mg-types.ts', import.meta.url), 'utf8')
  const ledger = fs.readFileSync(new URL('../src/main/mg/ledger.ts', import.meta.url), 'utf8')
  const aggregator = fs.readFileSync(new URL('../src/main/mg/factory-stats.ts', import.meta.url), 'utf8')
  const main = fs.readFileSync(new URL('../src/main/mg/index.ts', import.meta.url), 'utf8')
  const store = fs.readFileSync(new URL('../src/main/mg/store.ts', import.meta.url), 'utf8')
  const kernel = fs.readFileSync(new URL('../src/renderer/kernel.ts', import.meta.url), 'utf8')
  const resources = fs.readFileSync(new URL('../src/renderer/modules/zi.ts', import.meta.url), 'utf8')
  const review = fs.readFileSync(new URL('../src/renderer/modules/shi.ts', import.meta.url), 'utf8')
  assert.match(types, /export interface FactoryStatsReport/)
  // 开发方向随秘书舰走：查询侧带 mstId→开发表 解析器，记账侧在 createitem 时
  // 补记当刻旗舰（响应体里没有这一项，reducer 跑之前读 store 才是开发那一瞬的状态）
  assert.match(
    ledger,
    /queryFactoryStats = \(\s*sinceTs: number,\s*secretaryTypeOf\?: \(mstId: number\) => string \| null,\s*\)/,
  )
  assert.match(main, /apiPath === '\/kcsapi\/api_req_kousyou\/createitem'[\s\S]{0,200}player\.ships\[flagInst\]\?\.shipId/)
  assert.match(main, /ledger\.queryFactoryStats\([\s\S]{0,120}secretaryDevTypeOf,\s*\)/)
  assert.match(aggregator, /api_req_kousyou\/getship/)
  assert.match(aggregator, /Array\.isArray\(data\?\.api_get_items\)/)
  assert.match(ledger, /不泄露 post_body 里的 api_token/)
  assert.match(main, /ipcMain\.handle\('mg:factory-stats'/)
  assert.match(kernel, /ipcRenderer\.invoke\('mg:factory-stats', sinceTs\)/)
  assert.match(store, /'\/kcsapi\/api_req_kousyou\/getship'/)
  assert.match(
    store,
    /applySlotitemInventoryMutation\([\s\S]*?'\/kcsapi\/api_req_kousyou\/getship'/,
  )
  // 2026-08-26 文案清扫：抬头副标缩成「已确认 N 次」、「不代表全服概率」整句根除（族 2）。
  // 「这是你自己的账」这层意思由「已确认 N 次」与逐格样本数（样本 N/M）承担，改钉它们。
  assert.match(review, /工厂实测<\/b><span>已确认 \$\{total\} 次/)
  assert.match(review, /<small>样本 \$\{attempts\}\/\$\{PERSONAL_RATE_MIN_SAMPLES\}<\/small>/)
  assert.match(review, /attempts >= PERSONAL_RATE_MIN_SAMPLES/)
  // 低样本不报百分比：脚注里的那句复述已删（行内本来就写着「样本 N/M」）。
  // 改钉分支的另一半 —— 样本不够时只出次数 + 样本标，绝不落到百分比那支。
  assert.match(
    review,
    /<b>\$\{outcome\.count\} 次<\/b><small>样本 \$\{attempts\}\/\$\{PERSONAL_RATE_MIN_SAMPLES\}<\/small>/,
  )
  assert.match(review, /queryFactoryStats\(now - 90 \* DAY_MS\)/)
  assert.match(review, /data-shi-view="\$\{view\}"/)
  assert.doesNotMatch(resources, /factoryStatsHtml|queryFactoryStats/)

  const event = (ts, path, post, data = null) => ({
    ts,
    path,
    postBody: JSON.stringify(post),
    body: data == null ? null : JSON.stringify({ api_result: 1, api_data: data }),
  })
  const create = (ts, dock, recipe) =>
    event(ts, '/kcsapi/api_req_kousyou/createship', {
      api_kdock_id: `${dock}`,
      api_item1: `${recipe[0]}`,
      api_item2: `${recipe[1]}`,
      api_item3: `${recipe[2]}`,
      api_item4: `${recipe[3]}`,
      api_item5: `${recipe[4]}`,
      api_large_flag: `${recipe[5]}`,
    })
  const claim = (ts, dock, mstId) =>
    event(ts, '/kcsapi/api_req_kousyou/getship', { api_kdock_id: `${dock}` }, { api_ship_id: mstId })
  const rows = [
    create(100, 1, [30, 30, 30, 30, 1, 0]),
    create(110, 2, [400, 100, 600, 30, 1, 0]),
    claim(120, 2, 20),
    // 模拟一次 getship 报文漏记：最近一次同槽建造应接到结果，旧记录留作 pending。
    create(130, 1, [999, 999, 999, 999, 20, 1]),
    claim(140, 1, 30),
    claim(150, 3, 40),
    event(
      160,
      '/kcsapi/api_req_kousyou/createitem',
      { api_item1: '10', api_item2: '10', api_item3: '10', api_item4: '10' },
      {
        api_create_flag: 1,
        api_get_items: [
          { api_slotitem_id: 5 },
          { api_slotitem_id: -1 },
          { api_slotitem_id: 5 },
        ],
      },
    ),
  ]
  const report = aggregateFactoryStats(rows, 100)
  assert.equal(report.ship.reduce((sum, row) => sum + row.attempts, 0), 2)
  assert.equal(report.pendingShips, 1)
  assert.equal(report.unmatchedShipResults, 1)
  assert.deepEqual(
    report.ship.find((row) => row.recipe[0] === 999)?.outcomes,
    [{ mstId: 30, count: 1 }],
  )
  assert.equal(report.item[0].attempts, 3)
  assert.deepEqual(report.item[0].outcomes, [
    { mstId: 5, count: 2 },
    { mstId: -1, count: 1 },
  ])

  // 开发行按「配方 × 秘书舰类型」分行：同配方在不同秘书舰下滚的是不同开发表。
  // secretaryMst 为 NULL 的老账单独归「未记录」一组，不并进任何类型。
  const dev = (ts, secretaryMst, itemMst) => ({
    ...event(
      ts,
      '/kcsapi/api_req_kousyou/createitem',
      { api_item1: '10', api_item2: '10', api_item3: '10', api_item4: '10' },
      { api_create_flag: 1, api_get_items: [{ api_slotitem_id: itemMst }] },
    ),
    secretaryMst,
  })
  const typed = aggregateFactoryStats(
    [dev(200, 501, 5), dev(210, 501, 6), dev(220, 502, 5), dev(230, null, 5)],
    100,
    (mstId) => (mstId === 501 ? '水雷系' : mstId === 502 ? '砲戦系' : null),
  )
  assert.deepEqual(
    typed.item.map((row) => [row.secretary, row.attempts]).sort(),
    [['水雷系', 2], ['砲戦系', 1], [null, 1]].sort(),
  )
  const torpedoRow = typed.item.find((row) => row.secretary === '水雷系')
  assert.deepEqual(torpedoRow.outcomes, [{ mstId: 5, count: 1 }, { mstId: 6, count: 1 }])
})

test('settings report live network health and provide verified ledger backup and restore', () => {
  const proxy = fs.readFileSync(new URL('../src/main/proxy.ts', import.meta.url), 'utf8')
  const login = fs.readFileSync(new URL('../src/main/login-keeper.ts', import.meta.url), 'utf8')
  const appMain = fs.readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
  const ledger = fs.readFileSync(new URL('../src/main/mg/ledger.ts', import.meta.url), 'utf8')
  const main = fs.readFileSync(new URL('../src/main/yu.ts', import.meta.url), 'utf8')
  const settings = fs.readFileSync(new URL('../src/renderer/modules/yu.ts', import.meta.url), 'utf8')
  assert.match(proxy, /ipcMain\.handle\('yu:proxy-status'/)
  // 「无需重启」是残检批清掉的防守尾巴（族 A）：钉热切换的状态串本体，并反钉尾巴回潮
  assert.match(proxy, /已应用/)
  assert.doesNotMatch(proxy, /无需重启/)
  assert.match(login, /ipcMain\.handle\('yu:login-health'/)
  assert.match(login, /lastFlushedAt/)
  assert.match(appMain, /app\.setPath\('userData', APPDATA_PATH\)/)
  assert.doesNotMatch(appMain, /if \(process\.env\.KANSO_SMOKE\) \{\s*app\.setPath\('userData'/)
  assert.match(ledger, /VACUUM INTO/)
  assert.match(ledger, /PRAGMA integrity_check\(1\)/)
  assert.match(main, /ipcMain\.handle\('yu:backup-ledger'/)
  assert.match(main, /ipcMain\.handle\('yu:restore-ledger'/)
  assert.match(main, /KANSO-BACKUP/)
  assert.match(main, /config\.restoreSnapshot/)
  assert.match(settings, /保存后即时应用/)
  assert.match(settings, /完整备份与恢复/)
  assert.match(settings, /代理账号与密码/)
})

test('new ships and taiha use manually dismissed top banners with persistent frame glow', () => {
  const notices = fs.readFileSync(new URL('../src/renderer/modules/lg.ts', import.meta.url), 'utf8')
  const settings = fs.readFileSync(new URL('../src/renderer/modules/yu.ts', import.meta.url), 'utf8')
  const config = fs.readFileSync(new URL('../src/main/config.ts', import.meta.url), 'utf8')
  const html = rendererSource
  const bannerSource = notices.slice(
    notices.indexOf('const showEventBanner'),
    notices.indexOf('let log: Notice[]'),
  )

  // 上横幅是**白名单**：没登记色调的事件一律拿不到横幅。
  // 从前这条钉的是 `def.id !== 'taiha' && def.id !== 'newShip'` 那句直写条件，
  // 应急修理进来之后改钉「表 + 无色调即拒」——白名单这层纪律没变，只是换了载体。
  const toneTable = notices.slice(
    notices.indexOf('const BANNER_TONE'),
    notices.indexOf('const BANNER_ORDER'),
  )
  assert.deepEqual(
    [...toneTable.matchAll(/^\s*(\w+): '(\w+)',/gm)].map(([, id, tone]) => [id, tone]),
    [['taiha', 'danger'], ['newShip', 'celebrate'], ['marriage', 'wedding']],
    '固定色调的横幅事件表变了',
  )
  assert.match(
    notices,
    /const tone = override \?\? BANNER_TONE\[def\.id\]\s*\n\s*if \(!eventBannerEffectsEnabled \|\| !tone\) return false/,
    '没登记色调的事件必须拿不到横幅，且总开关仍在同一处把住',
  )
  assert.match(
    notices,
    /const promotedToBanner =\s*[\s\S]*presentation\.banner !== false && showEventBanner\(displayDef, notice, presentation\.bannerTone\)/,
  )
  // 横幅接管了就不再叠一张内容重复的右下 Toast。routed() 是 na 过滤后的路由开关
  // （旧存档里躺着的非法 true 不许生效），banner 这条纪律与它是同一个表达式。
  assert.match(notices, /const toast = \(routed\('toast'\) \|\| blocking\) && !promotedToBanner/)
  assert.match(
    notices,
    /const routed = \(key: RouteKey\) => route\[key\] && !displayDef\.na\?\.includes\(key\)/,
    'na 必须在路由决策处统一过滤，不能只挡系统通知那一路',
  )
  assert.match(notices, /const sound = routed\('sound'\) \|\| blocking/)
  assert.match(notices, /const system = routed\('system'\)/)
  assert.match(notices, /class="close" title="关闭"/)
  assert.match(notices, /closeEventBanner\(notice\.key\)/)
  assert.doesNotMatch(bannerSource, /setTimeout/)
  assert.match(notices, /entityNamePlain\('ship', id, original\)/)
  assert.match(notices, /`新舰入库：\$\{names\.slice\(0, 3\)\.join\('、'\)\}/)
  assert.match(notices, /'新舰锁定确认'/)
  // 「新舰」按谱系判断（持有初霜改二后再捞到初霜不算新舰）这条纪律没变，
  // 但基线本体搬去了 ship-first-owned——首见志要的是同一个判定，不该两处各存一份。
  assert.match(notices, /const fresh = observeOwnedShips\(\)/)
  const owned = fs.readFileSync(new URL('../src/renderer/ship-first-owned.ts', import.meta.url), 'utf8')
  assert.match(owned, /export const expandFamilies = \(ids: Iterable<number>\)/)
  // 旧钉是 `if (ship.afterShipId > 0)`——钉住的是当时那套手搓并查集的写法，
  // 而那套写法本身就漏了原生升级表独有的边。原意「新舰要按整条谱系算」不变，
  // 改钉「谱系归属走共用的那一份」（行为判据见「首见的谱系归属……」一测）。
  assert.match(owned, /buildShipRemodelChains\(/)
  assert.match(owned, /afterId: ship\.afterShipId > 0 \? ship\.afterShipId : 0/)
  assert.doesNotMatch(owned, /const find = |const parent = new Map/, '首见基线不许再自己搓并查集')
  // 判定搬到了 ship-first-owned：只报基线里没有的谱系形态
  const ownedSrc = fs.readFileSync(new URL('../src/renderer/ship-first-owned.ts', import.meta.url), 'utf8')
  assert.match(ownedSrc, /\[\.\.\.current\]\.filter\(\(id\) => known\[id\] == null\)/)
  assert.doesNotMatch(notices, /const fresh = \[\.\.\.current\]\.filter\(\(id\) => !ownedBaseline/)
  // 外框光效同时只能有一种颜色。从前是写死的 if/else if（红压金），
  // 应急修理的两档绿进来之后改成表 + 优先级序列——「只一种、红最先」不变。
  assert.match(
    notices,
    /const FRAME_CLASS: Record<BannerTone, string> = \{[\s\S]*?danger: 'lg-frame-red',[\s\S]*?celebrate: 'lg-frame-gold',[\s\S]*?\}/,
  )
  // 婚礼的粉进来之后这条改钉「序列的形状」而不是那一行字面量：纪律没变——
  // 红仍在最前（发动损管之后该做的事仍然是撤退），三档警报仍整体压在两档庆祝之前。
  const framePriority = [
    ...notices
      .slice(notices.indexOf('const FRAME_PRIORITY'), notices.indexOf('const syncFrameGlow'))
      .matchAll(/'(\w+)'/g),
  ].map(([, tone]) => tone)
  assert.deepEqual(framePriority[0], 'danger', '外框优先级变了：红必须仍排在最前')
  for (const alarm of ['danger', 'goddess', 'repair']) {
    for (const cheer of ['wedding', 'celebrate']) {
      assert.ok(
        framePriority.indexOf(alarm) < framePriority.indexOf(cheer),
        `${cheer} 的外框压过了 ${alarm}——外框回答的是「现在该做什么」，庆祝不指示任何行动`,
      )
    }
  }
  assert.deepEqual(
    [...new Set(framePriority)].sort(),
    ['celebrate', 'danger', 'goddess', 'repair', 'wedding'],
    '有色调没进外框优先级序列：FRAME_PRIORITY.find 找不到它，外框就静默不亮',
  )
  assert.match(
    notices,
    /document\.body\.classList\.remove\(\.\.\.Object\.values\(FRAME_CLASS\)\)[\s\S]*?const winner = FRAME_PRIORITY\.find[\s\S]*?if \(winner\) document\.body\.classList\.add\(FRAME_CLASS\[winner\]\)/,
    '外框光效必须先清空再按优先级挂唯一一个',
  )
  // 36 = 顶栏（连边框整 34px）之上再留一线。2026-09-01 从 42 抬上来，抬起的那 6px
  // 全数让给游戏画面；再往上就压住抬头那排资源数字了，所以这条同时是上限判据。
  assert.match(html, /#lg-banners \{[^}]*position: fixed;[^}]*top: 36px/)
  assert.match(html, /\.lg-banner\.celebrate \{/)
  assert.match(html, /\.lg-banner\.danger \{/)
  assert.match(html, /body\.lg-frame-gold::after/)
  assert.match(html, /body\.lg-frame-red::after/)
  assert.match(html, /body\.lg-frame-gold::before/)
  assert.match(html, /body\.lg-frame-red::before/)
  assert.match(html, /border: 2px solid transparent/)
  assert.match(html, /lg-banner-gold-pulse/)
  assert.match(html, /lg-banner-red-pulse/)
  assert.match(html, /inset 0 0 44px rgba\(232, 198, 106, \.25\)/)
  assert.match(html, /inset 0 0 52px rgba\(224, 108, 117, \.31\)/)
  assert.match(config, /voiceCaptions: true/)
  assert.match(config, /eventBannerEffects: true/)
  assert.match(settings, /显示语音文字/)
  // 总闸的标签是**逐项枚举**：多一类横幅就得多列一项，否则设置页在少说一样
  assert.match(settings, /新舰 \/ 大破 \/ 应急修理 \/ 婚礼置顶横幅与外框光效/)
  assert.match(settings, /setVoiceCaptionsEnabled\(next\)/)
  assert.match(settings, /setEventBannerEffectsEnabled\(next\)/)
})

test('boss taiha stays a normal notice and battle hint without a retreat banner', () => {
  const notices = fs.readFileSync(new URL('../src/renderer/modules/lg.ts', import.meta.url), 'utf8')
  const combat = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')

  assert.match(notices, /const atBoss =[\s\S]*s\.currentCell === s\.bossCell[\s\S]*node\?\.eventId === 5/)
  // Boss 点大破不喊撤退（那里本来就没得选），只作普通提醒。
  // 同一战多艘大破合并成一条，标题里的主语是「谁」而不再是单艘舰名。
  // 钉的是措辞与「主语是 who」这两件事，不钉它写成三元还是别的形状——
  // 大破分档（旗舰强制返航 / 二队旗舰受保护）把这里改成了按档取标题。
  assert.match(notices, /`\$\{who\}在 Boss 战中大破`/)
  assert.match(notices, /const signature = `\$\{s\.battleCount\}:/, '大破提醒没有按战次+舰集合去重')
  assert.doesNotMatch(notices, /for \(const ship of s\.battle\.fShips\.filter\(isTaiha\)\)/, '大破又变回逐舰各发一条了')
  assert.match(notices, /atBoss \? \{ banner: false, priority: 'normal' \} : undefined/)
  assert.match(notices, /presentation\.priority === 'normal'[\s\S]*sev: 'warn'[\s\S]*locked: false/)
  assert.match(combat, /if \(atBoss\) \{[\s\S]*Boss 战结束：\$\{names\} 大破/)
  assert.match(combat, /本节点无进击选项/)
  const bossBranch = combat.match(/if \(atBoss\) \{[\s\S]*?\n      \}/)?.[0] ?? ''
  assert.doesNotMatch(bossBranch, /请选择撤退|建议撤退/)
})

test('successful modernization emits an exact split-column result without fabricating missing deltas', () => {
  // 照抄实测：Fletcher改 Mod.2（mst 628）rid 3813 Lv88，一次近代化改修后的真实回报。
  // 主数据 [初始, 上限] → 改修容量：火力 60-16=44、雷装 86-29=57、对空 92-45=47、装甲 54-17=37。
  const master = {
    baseHoug: 16, maxHoug: 60,
    baseRaig: 29, maxRaig: 86,
    baseTyku: 45, maxTyku: 92,
    baseSouk: 17, maxSouk: 54,
    baseLuck: 47, maxLuck: 113,
    baseTaik: 37, maxTaik: 56,
    baseTais: 0, maxTais: 0, // 玩家舰的 api_mst_ship 根本没有 api_tais
  }
  const before = {
    id: 3813,
    shipId: 628,
    karyoku: 71,
    raisou: 75,
    taiku: 99,
    soukou: 59,
    lucky: 47,
    maxhp: 37,
    taisen: 88,
  }
  const result = buildPowerupResultCue(
    before,
    {
      api_powerup_flag: 1,
      api_ship: {
        api_id: 3813,
        api_ship_id: 628,
        // [0] 是含装备的面板值，[1] 是不含装备的裸上限——两者不可比
        api_karyoku: [72, 60],
        api_raisou: [81, 86],
        api_taiku: [100, 92],
        api_soukou: [59, 54],
        api_lucky: [47, 113],
        api_maxhp: 37,
        api_taisen: [88, 93],
        api_kyouka: [44, 41, 37, 37, 0, 0, 0], // [火力,雷装,对空,装甲,运,耐久,对潜]
      },
    },
    123456,
    master,
  )
  assert.deepEqual(result, {
    ts: 123456,
    rosterId: 3813,
    mstId: 628,
    stats: [
      { key: 'firepower', before: 71, after: 72, room: 0, delta: 1 }, // 44/44，真满
      { key: 'torpedo', before: 75, after: 81, room: 16, delta: 6 }, // 41/57
      { key: 'antiAir', before: 99, after: 100, room: 10, delta: 1 }, // 37/47
    ],
  })
  // 旧判据是 after >= api_X[1]：火力 72≥60、对空 100≥92 都会被判成满。
  // 那是拿含装备的面板比不含装备的裸上限，装备一挂上几乎项项挂假「满」。
  assert.notEqual(result.stats.find((s) => s.key === 'antiAir').room, 0, '对空还有 10 点空间，不许说满')
  assert.notEqual(result.stats.find((s) => s.key === 'torpedo').room, 0, '雷装还有 16 点空间，不许说满')

  // 主数据给不出容量的项（对潜）只报增量，不说满没满
  const aswOnly = buildPowerupResultCue(
    { ...before, taisen: 80 },
    {
      api_powerup_flag: 1,
      api_ship: { api_id: 3813, api_ship_id: 628, api_taisen: [88, 93], api_kyouka: [0, 0, 0, 0, 0, 0, 8] },
    },
    1,
    master,
  )
  assert.deepEqual(aswOnly.stats, [{ key: 'asw', before: 80, after: 88, room: null, delta: 8 }])
  // 拿不到主数据时同样是「不知道」，不能退回去猜
  const noMaster = buildPowerupResultCue(
    before,
    { api_powerup_flag: 1, api_ship: { api_id: 3813, api_ship_id: 628, api_karyoku: [72, 60], api_kyouka: [44, 0, 0, 0, 0, 0, 0] } },
    1,
  )
  assert.equal(noMaster.stats[0].room, null)

  assert.equal(buildPowerupResultCue(before, { api_powerup_flag: 0, api_ship: {} }, 1), null)
  assert.equal(buildPowerupResultCue(undefined, { api_powerup_flag: 1, api_ship: {} }, 1), null)

  const main = fs.readFileSync(new URL('../src/main/mg/index.ts', import.meta.url), 'utf8')
  const kernel = fs.readFileSync(new URL('../src/renderer/kernel.ts', import.meta.url), 'utf8')
  const notices = fs.readFileSync(new URL('../src/renderer/modules/lg.ts', import.meta.url), 'utf8')
  const html = rendererSource
  assert.match(main, /webContents\.send\('mg:powerup-result', result\)/)
  assert.match(kernel, /ipcRenderer\.on\('mg:powerup-result', onPowerupResultCue\)/)
  assert.match(notices, /onPowerupResult\(showPowerupResultToast\)/)
  assert.match(notices, /强化成功 · \$\{esc\(shipName\)\}/)
  assert.match(notices, /navigate\(\{ type: 'ship', id: result\.rosterId \}\)/)
  assert.match(html, /\.lg-toast\.powerup-result \.powerup-grid \{[\s\S]*grid-template-columns/)
  // 卡片按 room 说话：0 才写「满」，有空间写「还可 +N」，判不了什么也不写
  assert.match(notices, /stat\.room === 0/)
  assert.match(notices, /还可 \+\$\{stat\.room\}/)
  assert.doesNotMatch(notices, /stat\.after >= stat\.max/, '又拿面板值比裸上限判满了')
  // 余量必须按主数据算，实例自报的那对数不是这个意思
  assert.match(main, /store\.getState\(\)\.master\.ships\[/)
})

test('authoritative quest tabs replace ghost active tasks and retain the server execution count', () => {
  const quest = (api_no, api_state) => ({
    api_no,
    api_state,
    api_category: 1,
    api_type: 1,
    api_title: `Q${api_no}`,
    api_progress_flag: 0,
  })
  const stale = Object.fromEntries(
    [201, 213, 214, 218, 302, 402, 403, 503, 606, 703, 920].map((id) => [
      id,
      {
        no: id,
        state: 2,
        category: 1,
        type: 1,
        title: `Q${id}`,
        progressFlag: 0,
      },
    ]),
  )
  const actual = [201, 213, 214, 302, 402, 503, 703, 920]
  const full = reduceQuestList(
    stale,
    null,
    { api_exec_count: 8, api_list: actual.map((id) => quest(id, 2)) },
    { api_tab_id: '0' },
  )
  assert.deepEqual(full.activeIds, actual)
  assert.equal(full.execCount, 8)
  assert.equal(full.quests[218], undefined)
  assert.equal(full.quests[403], undefined)
  assert.equal(full.quests[606], undefined)

  const activeOnly = reduceQuestList(
    { ...stale, 999: { ...stale[201], no: 999, state: 3 } },
    Object.keys(stale).map(Number),
    { api_exec_count: 8, api_list: actual.map((id) => quest(id, 2)) },
    { api_tab_id: '9' },
  )
  assert.equal(activeOnly.quests[218].state, 1)
  assert.equal(activeOnly.quests[999].state, 3)
  assert.deepEqual(activeOnly.activeIds, actual)

  const store = fs.readFileSync(new URL('../src/main/mg/store.ts', import.meta.url), 'utf8')
  const main = fs.readFileSync(new URL('../src/main/mg/index.ts', import.meta.url), 'utf8')
  const counter = fs.readFileSync(new URL('../src/main/mg/quest-counter.ts', import.meta.url), 'utf8')
  const renderer = fs.readFileSync(new URL('../src/renderer/modules/qn.ts', import.meta.url), 'utf8')
  assert.match(store, /reduceQuestList\(/)
  assert.match(store, /'\/kcsapi\/api_req_quest\/start'/)
  assert.match(store, /state\.player\.questActiveTs = ts/)
  // 受领判定与「为什么没在计数」必须共用同一道门。分成两处迟早会出现
  // 「诊断说在计数、实际一条没落」这种最难查的错。
  assert.match(counter, /player\.questActiveIds\.includes\(tracker\.questId\)/)
  assert.match(counter, /sameQuestPeriod\(tracker, observedAt, now\)/)
  assert.match(counter, /const blockReasonOf = \(tracker: Tracker, now: number\)/)
  assert.match(counter, /blocked: blockReasonOf\(t, now\)/)
  assert.match(counter, /if \(blockReasonOf\(t, now\)\) continue/)
  // 「没有可计数动作」不能混进受领门：它会抢在两道硬门前面返回，
  // activeTracked 就会把本该滤掉的追踪器也收进来
  assert.doesNotMatch(
    fs.readFileSync(new URL('../src/shared/qp-types.ts', import.meta.url), 'utf8'),
    /'noTasks'/,
  )
  assert.match(counter, /repairContradictedCompleteProgress\(\)/)
  assert.match(main, /reconcileQuestProgress\(\)/)
  assert.match(renderer, /mg\.questExecCount \?\?/)
  assert.match(renderer, /领取状态确认于/)
})

test('ship life records only API-confirmed remodels and folds their equipment transition', () => {
  const tracker = fs.readFileSync(new URL('../src/main/mg/ship-life.ts', import.meta.url), 'utf8')
  const main = fs.readFileSync(new URL('../src/main/mg/index.ts', import.meta.url), 'utf8')
  const ledger = fs.readFileSync(new URL('../src/main/mg/ledger.ts', import.meta.url), 'utf8')
  assert.match(main, /'\/kcsapi\/api_get_member\/ship3'/)
  assert.match(tracker, /pendingRemodels\.set\(targetId, ts\)/)
  assert.match(tracker, /apiPath === '\/kcsapi\/api_get_member\/ship3'/)
  assert.match(tracker, /changedEquipment && !confirmedRemodel/)
  assert.match(tracker, /启动回灌只能说明“当前最后已知状态”/)
  assert.match(ledger, /previousVersion < 5/)
  assert.match(ledger, /event\.ts >= action\.ts/)
  assert.match(ledger, /kind = 'equipment' AND roster_id = \? AND ts = \?/)
})

test('offline routing rules evaluate fleet composition, random branches, and LOS without false certainty', () => {
  const context = (overrides = {}) => ({
    shipCount: 6,
    counts: {
      DE: 0, DD: 5, CL: 1, CLT: 0, CA: 0, CAV: 0, CVL: 0,
      FBB: 0, BB: 0, BBV: 0, CV: 0, CVB: 0, SS: 0, SSV: 0,
      AV: 0, LHA: 0, AR: 0, AS: 0, CT: 0, AO: 0,
      'BB系': 0, 'CV系': 0, 'CA系': 0, 'SS系': 0, 'CL系': 1,
      lowSpeedBB: 0,
    },
    shipNames: [],
    flagshipName: '',
    flagshipTypes: ['CL', 'CL系'],
    speed: 10,
    los: { 1: 42, 2: 50, 3: 60, 4: 70 },
    equipmentShipCounts: { radar: 4, drum: 0, landingCraft: 0 },
    passed: [],
    phase: null,
    ...overrides,
  })

  const simple = evaluateRoutingRules(
    ['BB系+CV系>=1 去C', 'DD=6 去C', 'CL=1 且 DD>=4 去C', '其余去A'],
    context(),
    ['A', 'C'],
  )
  assert.equal(simple.status, 'certain')
  assert.deepEqual(simple.routes.map((route) => route.to), ['C'])

  const random = evaluateRoutingRules(
    [
      '舰队船数 1 · 去B概率 20% · 去C概率 80%',
      '舰队船数 6 · 去B概率 45% · 去C概率 55%',
    ],
    context(),
    ['B', 'C'],
  )
  assert.equal(random.status, 'possible')
  assert.deepEqual(
    random.routes.map((route) => [route.to, route.probability]),
    [['B', 45], ['C', 55]],
  )

  const losHigh = evaluateRoutingRules(
    ['分歧点系数=1，索敌>=41 去L索敌<35 去K索敌35~41之间 随机去K/L'],
    context(),
    ['K', 'L'],
  )
  assert.equal(losHigh.status, 'certain')
  assert.deepEqual(losHigh.routes.map((route) => route.to), ['L'])

  const unknownBefore = evaluateRoutingRules(
    ['未开启机关 去A', '其余去B'],
    context(),
    ['A', 'B'],
  )
  assert.equal(unknownBefore.status, 'possible')
  assert.deepEqual(new Set(unknownBefore.routes.map((route) => route.to)), new Set(['A', 'B']))

  const grouped = evaluateRoutingRules(
    [
      '舰队中 包含祥凤 且 包含夕张',
      'DD=2 且 CA=2 去G',
      '其余去F',
      '舰队中 不包含祥凤 且 不包含夕张 去F',
    ],
    context(),
    ['F', 'G'],
  )
  assert.equal(grouped.status, 'certain')
  assert.deepEqual(grouped.routes.map((route) => route.to), ['F'])

  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  assert.match(catalog, /evaluateRoutingRules\(rules, context, candidates\)/)
  assert.match(catalog, /const routingContextForDeck = /)
  assert.match(catalog, /decision\?\.status !== 'certain'/)
})

const routingPackUrl = new URL('../assets/lodes/kcwiki-routing.json', import.meta.url)
const hasFullRoutingPack = process.env.KANSO_TEST_FORCE_SYNTHETIC !== '1'
  && fs.existsSync(routingPackUrl)

test('the full local routing catalog remains executable', {
  skip: !hasFullRoutingPack,
}, () => {
  const routingPack = JSON.parse(fs.readFileSync(routingPackUrl, 'utf8')).data
  // 常规图这一半是**稳定的**（37 张图 211 个分歧点），所以照旧钉死。
  // 活动图那一半会随每期活动整批换掉，钉数字等于每期都要来改一次测试，
  // 所以只要求「有、且同样跑得动」，不钉张数（2026-08-26 并入 62 期时改成这样）。
  const regularNodes = Object.entries(routingPack)
    .filter(([code]) => Number(code.split('-')[0]) < 10)
    .flatMap(([, map]) => map.nodes)
  const eventNodes = Object.entries(routingPack)
    .filter(([code]) => Number(code.split('-')[0]) >= 10)
    .flatMap(([, map]) => map.nodes)
  assert.equal(regularNodes.length, 211)
  assert.ok(eventNodes.length > 0, '活动图带路已并进这个包，不该一张都没有')

  const context = (difficulty) => ({
    shipCount: 6,
    counts: {
      DE: 0, DD: 5, CL: 1, CLT: 0, CA: 0, CAV: 0, CVL: 0,
      FBB: 0, BB: 0, BBV: 0, CV: 0, CVB: 0, SS: 0, SSV: 0,
      AV: 0, LHA: 0, AR: 0, AS: 0, CT: 0, AO: 0,
      'BB系': 0, 'CV系': 0, 'CA系': 0, 'SS系': 0, 'CL系': 1,
      lowSpeedBB: 0,
    },
    shipNames: [],
    flagshipName: '',
    flagshipTypes: ['CL', 'CL系'],
    speed: 10,
    los: { 1: 42, 2: 50, 3: 60, 4: 70 },
    equipmentShipCounts: { radar: 4, drum: 0, landingCraft: 0 },
    passed: [],
    phase: null,
    difficulty,
  })
  // 四个难度加「难度未知」都过一遍：活动图规则按难度分叉，只跑一种等于半张表没试过
  for (const node of [...regularNodes, ...eventNodes]) {
    for (const difficulty of [null, '甲', '乙', '丙', '丁']) {
      assert.doesNotThrow(() => evaluateRoutingRules(node.rules, context(difficulty)))
    }
  }
})

test('daily decision links form a resource, expedition, quest, fleet, and event-progress loop', () => {
  const activity = fs.readFileSync(new URL('../src/renderer/modules/du.ts', import.meta.url), 'utf8')
  const expedition = fs.readFileSync(new URL('../src/renderer/modules/bi.ts', import.meta.url), 'utf8')
  const resources = fs.readFileSync(new URL('../src/renderer/modules/zi.ts', import.meta.url), 'utf8')
  const fleet = fs.readFileSync(new URL('../src/renderer/modules/ru.ts', import.meta.url), 'utf8')
  const html = rendererSource

  assert.match(activity, /GIMMICK_PROGRESS_KEY = 'du\.gimmick-progress\.v1'/)
  assert.match(activity, /intel\?\.revision/)
  assert.match(activity, /data-gimmick-step=/)
  assert.match(activity, /uiSet\(GIMMICK_PROGRESS_KEY, gimmickProgress\)/)

  // 计数按槽位读（备选远征共享槽，任务下标会串位），过滤式随之改写
  assert.match(expedition, /task\.kind !== 'expedition' \|\| task\.missionId !== e\.apiId/)
  assert.match(expedition, /qpTaskSlot\(task, index\)/)
  assert.match(expedition, /elink\('quest', questId, label\)/)
  assert.match(expedition, /export const focusExpeditionsForResource/)
  assert.match(expedition, /rewards\?\.greatItems/)
  assert.match(resources, /focusExpeditionsForResource\(parseInt\(button\.dataset\.expResource!/)
  assert.match(resources, /补充\$\{meta\?\.label/)

  assert.match(fleet, /queryFleetCheck\(\)/)
  assert.match(fleet, /check\.hasCond && check\.decks\.some\(\(id\) => deckIds\.includes\(id\)\)/)
  assert.match(fleet, /elink\('quest', id, questName\(id\)/)
  assert.match(html, /\.mod-du \.gm-step\.done/)
  assert.match(html, /\.mod-bi \.resource-focus/)
  assert.match(html, /\.fleet-skin \.fleet-quests/)
})

test('event planning matches owned special ships and checks one selected air target without flooding every node', () => {
  const activity = fs.readFileSync(new URL('../src/renderer/modules/du.ts', import.meta.url), 'utf8')
  const html = rendererSource
  assert.match(activity, /AIR_TARGET_KEY = 'du\.air-targets\.v1'/)
  assert.match(activity, /data-air-target=/)
  // 2026-08-26 文案清扫：「默认取资料中最远点」缩成「最远点」（族 7 UI 自我解说）。
  // 要守的是「没手选时用的是哪一支」这个分支本体，连同分支一起钉，比钉措辞硬。
  assert.match(activity, /airTargets\[airTargetKey\(info\)\] \? '手动选择' : '最远点'/)
  assert.match(activity, /可达 · 航程余量/)
  assert.match(activity, /不可达 · 航程缺/)
  assert.match(activity, /const shipFamilyId = \(mstId: number\)/)
  assert.match(activity, /elink\('ship', rosterId/)
  // 这段诚实性交代 2026-08-26 整句删了（族 2 自证清白）。它守的是
  // 「只认点名到舰的特效、绝不按名字猜」——改钉实现本体：只有带 id 的条目进匹配池，
  // 归并按改造链根（shipFamilyId），全程没有一处按名字比对。比钉那句话硬。
  assert.match(
    activity,
    /const exact = specials\.filter\(\(ship\): ship is typeof ship & \{ id: number \} => Boolean\(ship\.id\)\)/,
  )
  assert.match(activity, /exactByFamily\.get\(shipFamilyId\(ship\.shipId\)\)/)
  assert.match(html, /\.mod-du \.op-owned-row/)
  assert.match(html, /\.mod-du \.ab-target select/)
})

test('closed events leave the activity module, remain dated in maps, and centralize personal archives in review', () => {
  const host = fs.readFileSync(new URL('../src/renderer/mu.ts', import.meta.url), 'utf8')
  const activity = fs.readFileSync(new URL('../src/renderer/modules/du.ts', import.meta.url), 'utf8')
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const review = fs.readFileSync(new URL('../src/renderer/modules/shi.ts', import.meta.url), 'utf8')
  const store = fs.readFileSync(new URL('../src/main/mg/store.ts', import.meta.url), 'utf8')
  const ledger = fs.readFileSync(new URL('../src/main/mg/ledger.ts', import.meta.url), 'utf8')
  const html = rendererSource
  assert.match(host, /export const setModuleVisible = \(id: string, visible: boolean\)/)
  // 2026-08-12 起坞位过滤走 displayed = moduleVisible(存在) 且未被用户搁置
  assert.match(host, /g\.mods\.filter\(displayed\)/)
  assert.match(host, /tile\.hidden = !moduleVisible\(id\)/)
  assert.match(html, /\.element-tile\[hidden\] \{ display: none; \}/)
  // 活动图撤场后铎不再一律退场：有进行中的季节收集企划（任务点名/持有>0）时
  // 切到企划视图；道具随企划结束清零，两个信号都熄灭才交还坞位
  assert.match(activity, /setModuleVisible\('du', eventMaps\(\)\.length > 0 \|\| seasonalCampaigns\(\)\.length > 0\)/)
  assert.match(activity, /keys\.includes\('master'\)/)
  // 判定本体已抽到 shared/event-area.ts（铎/鉴/铭/锱同引一份），
  // 两条分支的行为由 test/event-area.test.mjs 真跑着守；这里只钉「铎还在引它」
  assert.match(activity, /import \{ detectEventAreas \} from '\.\.\/\.\.\/shared\/event-area'/)
  assert.match(activity, /const eventMaps = \(\): any\[\] => eventAreas\.eventMaps/)
  assert.match(ledger, /CREATE TABLE IF NOT EXISTS event_map_catalog/)
  assert.match(ledger, /observeEventMapCatalog = \(/)
  assert.match(ledger, /closeEventMapCatalog = \(/)
  assert.match(ledger, /dropsByMap/)
  assert.match(ledger, /sortiesByMap/)
  assert.match(store, /ledger\.observeEventMapCatalog\(/)
  assert.match(store, /ledger\.closeEventMapCatalog\(\+idStr, ts\)/)
  assert.match(catalog, /const mergeArchivedEventMaps = \(\)/)
  assert.match(catalog, /活动已结束/)
  assert.match(catalog, /来自活动期间保存的游戏数据/)
  assert.doesNotMatch(catalog, /本次活动归档|eventDrawerHtml|eventCatalogHtml/)
  assert.match(review, /<b>往期活动<\/b>/)
  assert.match(review, /queryEventArchives\(\)/)
  assert.doesNotMatch(html, /\.mod-ji \.event-map-archive/)
  assert.match(html, /\.mod-ji \.grp \.map-event-period/)
})

test('expedition planning protects fleets, excludes instances, estimates net yield, and keeps permanent result history', () => {
  const types = fs.readFileSync(new URL('../src/shared/mg-types.ts', import.meta.url), 'utf8')
  const ledger = fs.readFileSync(new URL('../src/main/mg/ledger.ts', import.meta.url), 'utf8')
  const main = fs.readFileSync(new URL('../src/main/mg/index.ts', import.meta.url), 'utf8')
  const expedition = fs.readFileSync(new URL('../src/renderer/modules/bi.ts', import.meta.url), 'utf8')
  const html = rendererSource
  assert.match(types, /export interface ExpeditionHistoryReport/)
  assert.match(ledger, /CREATE TABLE IF NOT EXISTS expedition_history/)
  assert.match(ledger, /logExpeditionResult = \(/)
  assert.match(ledger, /queryExpeditionHistory = \(/)
  assert.match(ledger, /averageMaterials/)
  assert.match(main, /ledger\.logExpeditionResult\(ts, expeditionMissionId, expeditionDeckId, body\)/)
  assert.match(main, /ipcMain\.handle\('mg:expedition-history'/)
  assert.match(expedition, /PLANNER_PREFS_KEY = 'bi\.planner-prefs\.v1'/)
  assert.match(expedition, /\? savedPlannerPrefs\.protectedDeckIds[\s\S]*: \[1\]/)
  assert.match(expedition, /data-exclude-ship=/)
  assert.match(expedition, /const estimatedNet = \(/)
  // 估算的净收益必须交代它没算什么，别让玩家当成实收——算式讲解已删，
  // 钉的是那句诚实性尾巴（不计大发/内火艇/大成功）。
  assert.match(expedition, /净收益不计大发、内火艇与大成功加成/)
  assert.match(expedition, /queryExpeditionHistory\(missionId, 40\)/)
  assert.match(expedition, /历史平均净收益/)
  // 2026-08-26 文案清扫缩短：出处声明与「没有保存 X」删了，「加成已含在内」这条
  // 读数前提照钉——不写清楚就没法把这个平均值和上面的估算净收益比。
  assert.match(expedition, /已包含大成功、大发等当次加成/)
  assert.match(html, /\.mod-bi \.exp-h-metrics/)
  assert.match(html, /\.mod-bi \.exp-h-net/)
  assert.match(html, /\.mod-bi \.pl-pref\.on/)
  // 关闭条钉在详情顶，滚内容不带走它
  assert.match(expedition, /class="backbar" data-act="close"[\s\S]*class="detail-scroll"/)
  assert.match(html, /\.mod-bi \.detail-scroll \{ flex: 1; min-height: 0; overflow-y: auto; \}/)
  assert.doesNotMatch(html, /\.mod-bi \.bi-app\.open \.detail \{[^}]*overflow-y:\s*auto/)
  // 按燃/时排时大字必须是燃料，不能改按该条最高收益资源顶上去
  assert.match(expedition, /if \(a\[4\] === pin && b\[4\] !== pin\) return -1/)
})

test('header preserves real ship and equipment capacity and links to cleanup views', () => {
  const store = fs.readFileSync(new URL('../src/main/mg/store.ts', import.meta.url), 'utf8')
  const types = fs.readFileSync(new URL('../src/shared/mg-types.ts', import.meta.url), 'utf8')
  const capacity = fs.readFileSync(new URL('../src/renderer/equip-capacity.ts', import.meta.url), 'utf8')
  const header = fs.readFileSync(new URL('../src/renderer/header-status.ts', import.meta.url), 'utf8')
  const roster = fs.readFileSync(new URL('../src/renderer/modules/qa.ts', import.meta.url), 'utf8')
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const fleet = fs.readFileSync(new URL('../src/renderer/modules/ru.ts', import.meta.url), 'utf8')
  assert.match(store, /maxShips: body\.api_basic\.api_max_chara/)
  assert.match(store, /maxSlotitems: body\.api_basic\.api_max_slotitem/)
  assert.match(types, /maxShips: number[\s\S]*maxSlotitems: number/)
  assert.match(capacity, /\[42, 43, 145, 146, 150, 241\]/)
  assert.match(capacity, /!CAPACITY_EXEMPT_EQUIP_IDS\.has\(item\.mstId\)/)
  assert.match(header, /countCapacitySlotitems\(mg\.slotitems\)/)
  assert.match(header, /data-capacity="ship"/)
  assert.match(header, /data-capacity="equip"/)
  assert.match(header, /type: capacity\.dataset\.capacity === 'ship' \? 'shipCapacity' : 'equipCapacity'/)
  assert.match(roster, /registerEntityRoute\('shipCapacity'/)
  // 视图预设行已砍(2026-08-18):清理入口改为直设筛选(applySmart('dupe'))
  assert.match(roster, /open: openRosterCleanup/)
  assert.match(roster, /applySmart\('dupe'\)/)
  assert.match(catalog, /registerEntityRoute\('equipCapacity'/)
  assert.match(catalog, /const current = countCapacitySlotitems\(mg\.slotitems\)/)
  assert.match(catalog, /activeBook = 'equip'/)
  assert.match(fleet, /maxSlotitems - countCapacitySlotitems\(mg\.slotitems\)/)
  assert.match(fleet, /shipRemain != null && shipRemain <= 5/)
  assert.match(fleet, /equipRemain != null && equipRemain <= 20/)
  assert.match(fleet, /出击前检查：仓库接近上限/)
})

test('departed roster ids are archived by explicit cause and remain readable from the ship catalog', () => {
  const ledger = fs.readFileSync(new URL('../src/main/mg/ledger.ts', import.meta.url), 'utf8')
  const tracker = fs.readFileSync(new URL('../src/main/mg/ship-life.ts', import.meta.url), 'utf8')
  const store = fs.readFileSync(new URL('../src/main/mg/store.ts', import.meta.url), 'utf8')
  const main = fs.readFileSync(new URL('../src/main/mg/index.ts', import.meta.url), 'utf8')
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const html = rendererSource
  assert.match(ledger, /idx_ship_life_terminal/)
  assert.match(ledger, /WHERE kind IN \('scrap', 'material', 'sunk'\)/)
  assert.match(ledger, /queryShipMemorial = \(rawMstIds: number\[\]\)/)
  assert.match(store, /post\.api_ship_id/)
  assert.match(store, /post\.api_id_items/)
  assert.match(tracker, /recordDepartures\(/)
  assert.match(tracker, /if \(ship\.sunk && !sortie\.practice\)/)
  assert.match(tracker, /kind: 'sunk'/)
  assert.match(main, /ipcMain\.handle\('mg:ship-memorial'/)
  assert.match(catalog, /<div class="sec-h">收容库/)
  assert.match(catalog, /拆解 <b>\$\{report\.scrapped\}/)
  assert.match(catalog, /作为改修素材 <b>\$\{report\.materials\}/)
  assert.match(catalog, />击沉 <b>\$\{report\.sunk\}/)
  assert.match(html, /\.mod-ji \.mem-entry\.sunk/)
})

test('every full-refresh module runs its rebuild through the view-state-preserving door', () => {
  // 滚动容器不再由各模块申报——判据（scrollTop 非零）运行时可测，
  // 申报制维护了 36 条清单还是漏了 5 处。这里只确认重建都走了那道门。
  // 2026-08-21 起那道门多了一层闸门（kernel commitPaneHtml：输出没变就不换 DOM），
  // 它内部就是 withViewStateKept；applyPaneHtml 是给「已经在回调里面」的镝用的裸版。
  // 三者任一都算走了门，裸 `pane.innerHTML =` 才是漏网。
  const DOORS = /(withViewStateKept\(\w+, \(\) => \{|commitPaneHtml\(\s*\w+|applyPaneHtml\(\s*\w+)/
  const modules = ['qa', 'ru', 'zi', 'qn', 'ji', 'di', 'shi', 'bi', 'du', 'lg', 'yu']
  for (const module of modules) {
    const source = fs.readFileSync(new URL(`../src/renderer/modules/${module}.ts`, import.meta.url), 'utf8')
    assert.match(source, DOORS, `${module} must preserve view state around full refreshes`)
  }
  // 闸门本身的两条纪律，错了都不报错、只是界面停在旧状态或监听叠加：
  const kernel = fs.readFileSync(new URL('../src/renderer/kernel.ts', import.meta.url), 'utf8')
  // (1) 闸门必须真的把重建裹进 withViewStateKept，不能只做字符串比较就直接换 DOM
  assert.match(
    kernel,
    /commitPaneHtml[\s\S]{0,400}?withViewStateKept\(root, \(\) => \{[\s\S]{0,40}?root\.innerHTML = html/,
  )
  // (2) 记忆按 root 元素弱引用：重试装配换了新面板元素，记忆必须自然作废
  //     （mu.ts freshPane 换元素，不换的话新面板是空的、却被判成「没变」而永远不画）
  assert.match(kernel, /const committedHtml = new WeakMap<HTMLElement, Map<string, string>>\(\)/)
  // (3) 局部换块之后要作废记忆，否则「DOM 已不是上次提交的那份」会被误判成没变。
  //     有局部换块的模块必须调 forgetCommittedHtml。
  for (const module of ['ji', 'shi']) {
    const source = fs.readFileSync(new URL(`../src/renderer/modules/${module}.ts`, import.meta.url), 'utf8')
    assert.match(source, /forgetCommittedHtml\(pane, '/, `${module} 有局部换块，必须作废记忆`)
  }
})

test('quest period keys cross the JST 05:00 reset boundary', () => {
  const before = Date.parse('2026-08-03T19:59:59Z') // JST 04:59:59
  const after = Date.parse('2026-08-03T20:00:00Z') // JST 05:00:00
  assert.equal(questPeriodFromCode('Bd1'), 'daily')
  assert.equal(questPeriodFromCode('2606Bm1'), null)
  assert.notEqual(questPeriodKey('daily', before), questPeriodKey('daily', after))
  assert.notEqual(
    questPeriodKey('weekly', Date.parse('2026-08-02T19:59:59Z')),
    questPeriodKey('weekly', Date.parse('2026-08-02T20:00:00Z')),
  )
  assert.notEqual(
    questPeriodKey('monthly', Date.parse('2026-07-31T19:59:59Z')),
    questPeriodKey('monthly', Date.parse('2026-07-31T20:00:00Z')),
  )
  assert.notEqual(
    questPeriodKey('quarterly', Date.parse('2026-08-31T19:59:59Z')),
    questPeriodKey('quarterly', Date.parse('2026-08-31T20:00:00Z')),
  )
  // 键面没变：`d:` 是日序号，月/季/年是「年-月序号」（月序号 0 起）
  assert.equal(questPeriodKey('monthly', Date.parse('2026-08-31T20:00:00Z')), 'm:2026-8')
  assert.equal(questPeriodKey('quarterly', Date.parse('2026-08-31T20:00:00Z')), 'q:2026-8')
  assert.equal(questPeriodKey('annual', Date.parse('2026-08-31T20:00:00Z'), 6), 'y:2026-5')
  assert.equal(questPeriodKey('annual', Date.parse('2026-08-31T20:00:00Z')), 'y:unknown')
})

test('周期起点：重置时刻一律 05:00 JST，键与起点同出一源', () => {
  // 起点是「战果补记该算哪个月」的判据（shared/senka），键只是它的字符串面。
  // 两者各写一套算术就会漂——这里钉的是同源。
  const reset = Date.parse('2026-09-01T20:00:00Z') // 2026-09-02 05:00 JST（周三）
  assert.equal(questPeriodStart('daily', reset), reset)
  assert.equal(questPeriodStart('daily', reset - 1), reset - 86_400_000)
  // 周一 05:00：2026-08-31 是周一
  assert.equal(questPeriodStart('weekly', reset), Date.parse('2026-08-30T20:00:00Z'))
  assert.equal(questPeriodStart('monthly', reset), Date.parse('2026-08-31T20:00:00Z'))
  assert.equal(questPeriodStart('quarterly', reset), Date.parse('2026-08-31T20:00:00Z'))
  assert.equal(questPeriodStart('annual', reset, 6), Date.parse('2026-05-31T20:00:00Z'))
  assert.equal(questPeriodStart('annual', reset, null), null, '重置月未知就不猜')
  // 起点自反：拿起点再算一次是同一期；起点前 1ms 一定是上一期
  for (const [kind, annual] of [['daily'], ['weekly'], ['monthly'], ['quarterly'], ['annual', 6]]) {
    const start = questPeriodStart(kind, reset, annual)
    assert.equal(questPeriodStart(kind, start, annual), start, kind)
    assert.equal(questPeriodKey(kind, start, annual), questPeriodKey(kind, reset, annual), kind)
    assert.notEqual(questPeriodKey(kind, start - 1, annual), questPeriodKey(kind, start, annual), kind)
  }
})

test('valid FCD lodes are accepted and attribute-injection coordinates are rejected', () => {
  const valid = {
    meta: {
      id: 'poi-fcd-map',
      name: 'map',
      version: '1',
      source: 'test',
      fetchedAt: new Date().toISOString(),
    },
    data: {
      '1-1': {
        spots: { A: [10, 20, 'start'] },
        route: { 1: [null, 'A'] },
      },
    },
  }
  assert.equal(validateLodePack(valid).ok, true)

  const malicious = structuredClone(valid)
  malicious.data['1-1'].spots.A[0] = '0" onload="require(1)'
  assert.equal(validateLodePack(malicious).ok, false)

  const invalidMeta = structuredClone(valid)
  invalidMeta.meta.upstreamUpdatedAt = { slice: 'not a timestamp' }
  assert.equal(validateLodePack(invalidMeta).ok, false)
})

test('map-intel lodes accept bounded lifecycle data and reject malformed enemy fleets', () => {
  const valid = {
    meta: {
      id: 'map-intel',
      name: 'map intel',
      version: '1',
      source: 'test',
      fetchedAt: new Date().toISOString(),
    },
    data: {
      schemaVersion: 1,
      maps: {
        '1-1': {
          source: 'test',
          sourceUrl: 'https://example.test/1-1',
          checkedAt: '2026-08-04',
          revision: '2026.08.04.1',
          nodes: {
            C: {
              ships: [
                {
                  id: 89,
                  limitedOnly: true,
                  limited: {
                    from: '2025-01-28',
                    until: null,
                    lastConfirmedAt: '2026-06-26',
                    status: 'active_confirmed',
                    statusChangedAt: '2026-06-26',
                  },
                  limitedHistory: [
                    {
                      from: '2024-01-01',
                      until: '2024-02-01',
                      lastConfirmedAt: '2024-01-31',
                      status: 'ended_confirmed',
                      statusChangedAt: '2024-02-02',
                    },
                  ],
                },
              ],
              emptyDrop: 'confirmed',
              enemyComps: [{ formation: '単縦陣', ships: ['軽巡ホ級', '駆逐イ級'] }],
            },
          },
        },
      },
    },
  }
  assert.equal(validateLodePack(valid).ok, true)

  const badDate = structuredClone(valid)
  badDate.data.maps['1-1'].nodes.C.ships[0].limited.until = '2024-01-01'
  assert.equal(validateLodePack(badDate).ok, false)

  const badFleet = structuredClone(valid)
  badFleet.data.maps['1-1'].nodes.C.enemyComps[0].ships = []
  assert.equal(validateLodePack(badFleet).ok, false)

  const badPending = structuredClone(valid)
  badPending.data.maps['1-1'].nodes.C.ships[0].limited.status = 'end_pending'
  badPending.data.maps['1-1'].nodes.C.ships[0].limited.until = '2026-08-04'
  assert.equal(validateLodePack(badPending).ok, false)
})

test('event map intel keeps 甲乙丙丁 as isolated data layers', () => {
  const node = (shipId, enemy) => ({
    nodes: {
      A: {
        ships: [{ id: shipId }],
        emptyDrop: 'unknown',
        enemyComps: [{ formation: '単縦陣', ships: [enemy] }],
      },
    },
    operations: {
      gimmicks: [{ title: '装甲破碎', steps: ['C点：S胜'] }],
      specialShips: [{ id: shipId, label: `舰娘 ${shipId}`, effect: 'E1 1.2x' }],
      friendlyFleets: [{ ships: [{ id: shipId, name: `舰娘 ${shipId}` }], note: '强友军' }],
      nodeDistances: { A: 5 },
    },
  })
  const pack = {
    meta: {
      id: 'map-intel',
      name: 'event intel',
      version: '1',
      source: 'test',
      fetchedAt: new Date().toISOString(),
    },
    data: {
      schemaVersion: 1,
      maps: {
        '62-1': {
          source: 'test',
          sourceUrl: 'https://example.test/event',
          checkedAt: '2026-08-04',
          revision: '2026.08.04',
          event: {
            name: 'test event',
            from: '2026-07-08',
            until: null,
            status: 'active',
            phaseOpenedAt: '2026-07-08T21:59:00+09:00',
          },
          difficulties: {
            甲: node(1, '戦艦棲姫'),
            乙: node(2, '重巡ネ級'),
            丙: node(3, '軽巡ツ級'),
            丁: node(4, '駆逐イ級'),
          },
        },
      },
    },
  }
  assert.equal(validateLodePack(pack).ok, true)

  const mixed = structuredClone(pack)
  mixed.data.maps['62-1'].nodes = node(9, '誤混入').nodes
  assert.equal(validateLodePack(mixed).ok, false)

  const unknown = structuredClone(pack)
  unknown.data.maps['62-1'].difficulties.超甲 = node(9, '誤混入')
  assert.equal(validateLodePack(unknown).ok, false)

  const impossibleRadius = structuredClone(pack)
  impossibleRadius.data.maps['62-1'].difficulties.甲.operations.nodeDistances.A = 100
  assert.equal(validateLodePack(impossibleRadius).ok, false)
})

test('annual quest counters use the verified reset month instead of a generic calendar year', () => {
  const note = '年常任务(6月) 完成指定远征'
  assert.equal(questAnnualMonth(note), 6)
  assert.equal(questPeriodFromCode('Dy1', note), 'annual')
  assert.equal(questPeriodFromCode('Dy1'), null)
  const before = Date.UTC(2026, 4, 31, 19, 59) // 2026-06-01 04:59 JST
  const after = Date.UTC(2026, 4, 31, 20, 1) // 2026-06-01 05:01 JST
  assert.notEqual(questPeriodKey('annual', before, 6), questPeriodKey('annual', after, 6))
})

test('quest details link expedition API ids and give inventory-aware choice reward guidance', () => {
  const quest = fs.readFileSync(new URL('../src/renderer/modules/qn.ts', import.meta.url), 'utf8')
  const counter = fs.readFileSync(new URL('../src/main/mg/quest-counter.ts', import.meta.url), 'utf8')
  const store = fs.readFileSync(new URL('../src/main/mg/store.ts', import.meta.url), 'utf8')
  const main = fs.readFileSync(new URL('../src/main/mg/index.ts', import.meta.url), 'utf8')
  const kernel = fs.readFileSync(new URL('../src/renderer/kernel.ts', import.meta.url), 'utf8')
  const notices = fs.readFileSync(new URL('../src/renderer/modules/lg.ts', import.meta.url), 'utf8')
  const types = fs.readFileSync(new URL('../src/shared/mg-types.ts', import.meta.url), 'utf8')
  const qpTypes = fs.readFileSync(new URL('../src/shared/qp-types.ts', import.meta.url), 'utf8')
  const html = rendererSource
  assert.match(quest, /elink\('expedition', task\.missionId,/)
  assert.doesNotMatch(quest, /elink\('expedition', mg\.master\.missions\[task\.missionId\]\?\.dispNo/)
  // 奖励串的切段与逐项解析 2026-08-28 搬去了 shared/quest-reward（钦 require 了
  // electron，测试 import 不进来，判断只能靠源码文本）。行为级护栏见
  // test/quest-reward-choice.test.mjs，这里只钉「详情确实用着它」。
  assert.match(quest, /questRewardChoiceGroups\(row\.memo, ctx\)/)
  assert.match(quest, /const rewardSectionsHtml = \(row: QRow\)/)
  assert.match(quest, /<h4>基础资源<\/h4>/)
  assert.match(quest, /<h4>固定奖励<\/h4>/)
  assert.match(quest, /<h4>角色奖励<\/h4>/)
  // h4 后面跟了「口径」悬停记号（第三批文案裁定把那句自行判断的提醒收进了悬停）
  assert.match(quest, /<h4>可选物品奖励\s/)
  assert.match(quest, /<summary>日文原文<\/summary>/)
  assert.match(quest, /class="q-drawer\$\{selected \? ' open' : ''\}\$\{drawerAlreadyOpen \? ' stable' : ''\}"/)
  assert.match(quest, /data-period="\$\{item\.period\}"/)
  assert.match(quest, /CATEGORY_FILTERS/)
  assert.match(quest, /只比较当前实际持有量/)
  assert.match(quest, /年任 · 每年/)
  // 2026-08-26 文案清扫：「保存在本机」这句自证删了，「重新领取后接着数」这件事照钉
  assert.match(quest, /当前任务未领取 · 重新领取后继续原进度/)
  assert.match(counter, /annualMonth: questAnnualMonth\(resetNote\)/)
  assert.match(counter, /questPeriodKey\(period, now, tracker\.annualMonth\)/)
  assert.match(counter, /仅交付清/)
  assert.match(counter, /deriveFallbackTracker/)
  assert.match(counter, /task\.missionId === 0 \|\| task\.missionId === missionId/)
  assert.match(counter, /actionIncrement\(action, body, post\)/)
  // 覆盖统计只数目录内任务（规则包带少数目录外条目，直接数 trackers.size 曾显示 646/644）
  assert.match(counter, /精确计数覆盖 \$\{trackedInCatalog\} \/ \$\{questTotal\} 条/)
  assert.match(counter, /if \(!inCatalog\(tracker\.questId\)\) continue/)
  assert.match(counter, /sourceCounts\[tracker\.source\] \+= 1/)
  // 2026-08-20 第二批文案清扫：逐源条数与源站名号撤出 packCredit（它进的是发布侧
  // 悬停），只留覆盖条数与规则日期；逐源拆分仍留在启动日志里给施工方看。
  const packCreditLine = counter.match(/packCredit = `[^`]*`/)?.[0] ?? ''
  assert.ok(packCreditLine, 'packCredit 该是一条模板串')
  assert.doesNotMatch(packCreditLine, /KCWiki|kcwiki|poi|EO/, '发布侧署名不该回潮')
  assert.match(counter, /个任务追踪器就绪（KCWiki \$\{sourceCounts\.kcwiki\}/)
  // EO（quest-trackers）2026-08-21 整层退场：源号、解码器、包名一个都不许回潮
  assert.doesNotMatch(counter, /quest-trackers|source: 'eo'|decodeCond|decodeTask/)
  // 点位边号零硬编码：血条号 → 格子字母走九行校准表，边号由 poi-fcd 现算
  assert.match(counter, /buildKansoQuestRules\(kcwikiContext, masterRaw, fcdPack\?\.data as any\)/)
  assert.match(counter, /partial: derived\.partial/)
  assert.match(qpTypes, /partial: boolean/)
  assert.match(notices, /if \(tracker\.partial\) continue/)
  assert.match(quest, /task\.rank <= 0[\s\S]*完成演习（胜负不限）/)
  assert.match(quest, /case 'battleWin':/)
  // 审计 C4：静默地不动改成说清卡在哪。四种「没有」不能混为一谈——
  // 引擎还在装载就说「规则库未收录」，是把「我还没查」写成了「没有」。
  // 两句必须各自存在、且说的不是同一件事（「还没查」≠「查了没有」）；
  // 「计数引擎 / 规则库」这两个施工者词已按裁定换成用户语，钉法照旧一句一钉。
  assert.match(quest, /精确计数尚未就绪/)
  assert.match(quest, /无法精确计数：暂无这条任务的判定资料/)
  assert.match(quest, /const blockedHtml = /)
  assert.match(quest, /QP_BLOCK_TEXT\[tracker\.blocked\]/)
  assert.doesNotMatch(quest, /本地没有这条任务的计数器/)
  assert.match(qpTypes, /periodStale/)
  assert.match(qpTypes, /notReceived/)
  assert.match(qpTypes, /领取状态仍为上一周期/)
  assert.match(qpTypes, /请在游戏内领取任务并打开一次任务页/)
  assert.match(quest, /领取状态确认于 \$\{fmtTime\(mg\.questActiveTs\)\}/)
  // 「艦素在线时领取、取消会即时同步」是实现自述，2026-08-26 按族 C 删了。
  // 这一格要守的是「新鲜度说得出来」，由上一行的时间戳钉着；改钉那句不许回潮。
  assert.doesNotMatch(quest, /(?:艦素|kuma)在线时领取/, 'qn: 受领同步的实现自述又回来了')
  assert.match(quest, /另有非计数条件 · 计数完成不等于可交付/)
  assert.match(types, /questsTs: number \| null/)
  assert.match(types, /questActiveTs: number \| null/)
  assert.match(store, /state\.player\.questsTs = ts/)
  assert.match(store, /'\/kcsapi\/api_req_quest\/start'/)
  assert.match(store, /questsTs: state\.player\.questsTs/)
  assert.match(store, /questActiveTs: state\.player\.questActiveTs/)
  assert.match(main, /patch\.questsTs = state\.player\.questsTs/)
  assert.match(main, /patch\.questActiveTs = state\.player\.questActiveTs/)
  assert.match(kernel, /questsTs: MgPlayer\['questsTs'\]/)
  assert.match(kernel, /questActiveTs: MgPlayer\['questActiveTs'\]/)
  assert.match(kernel, /mg\.questsTs = s\.player\.questsTs \?\? null/)
  assert.match(kernel, /mg\.questActiveTs = s\.player\.questActiveTs \?\? null/)
  assert.doesNotMatch(
    counter,
    /api_req_quest\/stop[\s\S]{0,500}delete progress/,
  )
  const questState = fs.readFileSync(new URL('../src/main/mg/quest-state.ts', import.meta.url), 'utf8')
  assert.match(questState, /detail: raw\.api_detail/)
  assert.match(questState, /getMaterial: Array\.isArray\(raw\.api_get_material\)/)
  assert.match(types, /detail\?: string[\s\S]*getMaterial\?: number\[\]/)
  assert.match(html, /\.mod-qn \.reward-stock\.recommend/)
  assert.match(html, /\.mod-qn \.annual-reset/)
})

test('game header keeps repair docks ahead of optional capacity and compacts before clipping', () => {
  const header = fs.readFileSync(new URL('../src/renderer/header-status.ts', import.meta.url), 'utf8')
  const html = rendererSource
  const expeditionAt = header.indexOf('<span class="hs-label">远</span>')
  const dockAt = header.indexOf('<span class="hs-label">渠</span>')
  const capacityAt = header.indexOf('${capacityHtml()}', dockAt)
  assert.ok(expeditionAt >= 0 && dockAt > expeditionAt && capacityAt > dockAt)
  // 2026-08-12 起状态条改吃满中段剩余宽度(flex:1 1 0),不再定宽居中
  assert.match(html, /#header-status \{\s*flex: 1 1 0; min-width: 0;/)
  assert.match(header, /host\.scrollWidth > host\.clientWidth/)
  assert.match(html, /#header-status\.compact \.hs-label \{ display: none; \}/)
})

test('battle trail abbreviates trailing state and never exposes a horizontal scrollbar', () => {
  const battle = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  const html = rendererSource
  // 2026-08-25：阵形改走 optionalFormationText，「没有阵形」从 null 变成空串，
  // 于是这里的可选链也跟着退掉。守的仍是同一件事——胶囊上的名字要短形化。
  assert.match(battle, /formation\.replace\(\/阵\$\/, ''\)/)
  assert.match(battle, /title="海域已攻略">攻略</)
  assert.match(battle, /title="已归港 · 战斗复盘">复盘</)
  assert.match(html, /\.mod-di \.trail \{[^}]*overflow: hidden/)
  assert.match(html, /\.mod-di \.di-app\.narrow \.te \{ width: 8px;/)
})

test('game voice requests show Chinese-first UI captions and directional battle danmaku', () => {
  const resource = fs.readFileSync(new URL('../src/main/kcs-resource.ts', import.meta.url), 'utf8')
  const main = fs.readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
  const voice = fs.readFileSync(new URL('../src/renderer/kcs-voice.ts', import.meta.url), 'utf8')
  const subtitle = fs.readFileSync(new URL('../src/renderer/voice-subtitle.ts', import.meta.url), 'utf8')
  const abyssNames = fs.readFileSync(new URL('../src/renderer/abyssal-name.ts', import.meta.url), 'utf8')
  const renderer = fs.readFileSync(new URL('../src/renderer/index.ts', import.meta.url), 'utf8')
  const html = rendererSource
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')

  assert.match(resource, /details\.webContentsId === gameWebContentsId/)
  assert.match(resource, /broadcaster\.emit\('kancolle\.voice'/)
  assert.match(main, /setKcsResourceGameWebContentsId\(webContent\.id\)/)
  assert.match(voice, /export const resolveVoiceRequest/)
  assert.match(voice, /export const extraVoiceUrl/)
  assert.match(voice, /\/kcs\/sound\/kc\$\{directory\}\/\$\{voiceId\}\.mp3/)
  assert.match(subtitle, /buildVoiceFallbackIds/)
  assert.match(subtitle, /voiceFallbackOf\.get\(cue\.mstId\)/)
  assert.match(subtitle, /speaker: entityNamePlain\('ship', cue\.mstId/)
  // 裸编号与额外目录的判据 2026-08-22 挪进 shared/voice-sound-path，
  // 于是这三条从「正则匹配源码文本」升级成**真调用**——判断写反了正则照样绿，
  // 而这一族错了的后果是给舰娘安上不属于她的台词（见 source-pattern-guards-miss-logic-bugs）。
  assert.deepEqual(soundPath.EXTRA_VOICE_DIRS, { skit: '9997', enemy: '9998', npc: '9999' })
  assert.equal(soundPath.directVoiceIdOf('900'), 900) // 编号 ≤53 才混淆，54 起裸编号直出
  assert.equal(soundPath.directVoiceIdOf('141'), 141)
  assert.equal(soundPath.directVoiceIdOf('193212'), null) // 混淆编号绝不能被当成裸编号
  assert.match(voice, /return \{ kind: 'ship', mstId, voiceId/)
  assert.match(subtitle, /queryLode\('subtitle-zh'\)/)
  assert.match(subtitle, /queryLode\('subtitle-ja'\)/)
  assert.match(subtitle, /queryLode\('subtitle-npc'\)/)
  assert.match(subtitle, /queryLode\('subtitle-enemies'\)/)
  assert.match(subtitle, /queryLode\('wikiwiki-voice'\)/)
  assert.match(subtitle, /queryLode\('wikiwiki-abyss-voice'\)/)
  assert.match(subtitle, /battle\?\.flavorVoices/)
  assert.match(subtitle, /ipcRenderer\.invoke\('mg:voice-unmatched'/)
  assert.match(abyssNames, /安齊奧沖棲姫: 'アンツィオ沖棲姫'/)
  assert.match(abyssNames, /巴達維亞沖棲姬: 'バタビア沖棲姫'/)
  // 2026-08-25 查表序列重构（kcwiki 接进来）后这一句挪进了 else 支，多一个 `!`
  assert.match(subtitle, /wikiLines!?\.find\(\(entry\) => entry\.voiceId === cue\.voiceId\)/)
  // 中文缺失才回退日文原文。2026-08-22 这一句拆成了两行——中文那一支要过一道标点
  // 体例归一（行尾不写句号），日文回退**不过**（那是原文转写，不是我们的翻译）。
  // 判据盯的还是同一件事：拿得到既有中文就用中文，拿不到才用日文。
  assert.match(subtitle, /const reused = line \? voiceZhByJa\.get\(normalizeVoiceLine\(line\.ja\)\) : ''/)
  assert.match(subtitle, /text = reused \? normalizeVoiceText\(reused\) : `\$\{line\?\.ja \?\? ''\}`/)
  assert.match(catalog, /queryLode\('wikiwiki-voice'\)/)
  assert.match(catalog, /queryLode\('wikiwiki-abyss-voice'\)/)
  // 深海字幕支仍旧拿**官方档名**当 key（能拼地址的只有这一组）。场合那一列
  // 2026-08-23 从写死的「音轨 #档名」改成 `abyssVoiceRowLabel` 实测补名——
  // 这一条只盯「key 还是 line.key、名字走那个共用函数」，补名本身的判据
  // 由 test/abyss-voice-archive 真调用验（见那边「行号与场合同族」一批）。
  assert.match(catalog, /abyssVoiceRow\(line\.key, abyssVoiceRowLabel\(line\.key, isAbyssMst\)/)
  assert.match(catalog, /extraVoiceUrl\('enemy', k\)/)
  assert.ok(catalog.indexOf('const enemySubtitle = abyss') < catalog.indexOf('// 首选：kcwiki'))
  assert.match(catalog, /形态适用范围按资料的改装阶段列区分/)
  // wikiwiki 行的 key：有 voiceId 就用编号（voiceRow 那条路靠它认槽位），没有才留原 key。
  // 2026-08-23 这条判据随「沿链续填」挪进了 shared/voice-scene-slots，
  // 于是这一条也从「正则匹配源码文本」升级成**真调用**（同上一段的理由）。
  {
    const keyed = voiceSlots.planVoiceFallbackChain({
      mstId: 1,
      tryIds: [1],
      covered: new Set(),
      correctedRowsOf: () => undefined,
      wikiwikiRowsOf: () => [
        { key: '吹雪改三#0-2', voiceId: 2, scene: '母港1', ja: 'お疲れ様です' },
        { key: '吹雪改三#2-9', scene: 'イベント', ja: 'いよいよね' },
      ],
      subtitleJaOf: () => undefined,
      subtitleZhOf: () => undefined,
    })
    assert.deepEqual(
      keyed.picks.map((pick) => pick.key),
      ['2', '吹雪改三#2-9'],
    )
  }
  // 同上：这一句 2026-08-22 拆成了两支（中文过标点体例归一、日文回退不过），
  // 2026-08-25 两支又各自套上 captionText（占位句当空——poi-plugin-subtitle 的
  // 中日两句占位文本都带着 kcwiki 网址，直接上屏就是打在玩家脸上）。
  // 判据盯的仍是同一件事：「中文优先、缺了才回退日文」，两支都必须还在。
  // 2026-08-25 查表序列重构：形态在循环里就选定了，取文本改用循环变量 id
  assert.match(subtitle, /const zhLine = captionText\(subtitleZh\[`\$\{id\}`\]\?\.\[key\]\)/)
  assert.match(subtitle, /: captionText\(subtitleJa\[`\$\{id\}`\]\?\.\[key\]\)/)
  assert.match(subtitle, /speaker\.textContent =/)
  assert.match(subtitle, /line\.textContent = text/)
  assert.match(subtitle, /item\.textContent = speaker \? `\$\{speaker\}：\$\{text\}` : text/)
  assert.match(subtitle, /if \(cue\.kind === 'enemy'\) return 'enemy'/)
  assert.match(
    subtitle,
    /cue\.kind === 'ship' && mg\.sortie\?\.active && mg\.sortie\.battle/,
  )
  assert.match(subtitle, /else showDanmaku\(line, mode\)/)
  // 弹幕速度 2026-08-26 从固定 6 秒改成按台词长短给（长句穿屏读不完）。
  // 判据本身在 shared/voice-caption-hold，由 test/voice-caption-hold.test.mjs 真调用；
  // 这里只钉「弹幕确实用的是那份判据、且只按台词算不含 speaker 前缀」。
  assert.match(subtitle, /const duration = danmakuDurationSeconds\(\[\.\.\.text\]\.length\)/)
  assert.match(subtitle, /friendlyLane\+\+ % 4/)
  assert.match(subtitle, /enemyLane\+\+ % 4/)
  assert.doesNotMatch(subtitle, /lastPath|lastPathTs/)
  assert.match(subtitle, /pending = \[\.\.\.pending\.slice\(-127\), event\]/)
  assert.match(subtitle, /setVoiceCaptionsEnabled/)
  assert.match(subtitle, /if \(!captionsEnabled\) return/)
  assert.match(subtitle, /if \(mg\.sortie\?\.active && mg\.sortie\.practice\) return/)
  assert.match(subtitle, /cue\.voiceId >= 30 && cue\.voiceId <= 53/)
  assert.match(renderer, /initVoiceSubtitles\(broadcaster\)/)
  assert.match(html, /#voice-subtitle \{[^}]*pointer-events: none; background: transparent/)
  assert.match(html, /id="voice-subtitle" aria-live="polite"/)
  assert.match(html, /#voice-danmaku \{[^}]*pointer-events: none; background: transparent/)
  assert.match(html, /\.voice-danmaku-item \{[^}]*width: max-content; max-width: none; white-space: nowrap/)
  assert.match(html, /\.voice-danmaku-item\.friendly \{[^}]*voice-danmaku-ltr/)
  assert.match(html, /\.voice-danmaku-item\.enemy \{[^}]*voice-danmaku-rtl/)
  assert.match(html, /@keyframes voice-danmaku-ltr \{\s*from \{ left: 0; transform: translateX\(-50%\); \}/)
  assert.match(html, /@keyframes voice-danmaku-rtl \{\s*from \{ right: 0; transform: translateX\(50%\); \}/)
  assert.match(html, /to \{ left: 100%; transform: translateX\(0\); \}/)
  assert.match(html, /to \{ right: 100%; transform: translateX\(0\); \}/)
  assert.match(html, /id="voice-danmaku" aria-live="polite"/)
})

test('localization lodes accept bounded bilingual entities and reject HTML-shaped ids', () => {
  const valid = {
    meta: {
      id: 'kcwiki-localization',
      name: 'localization',
      version: '1',
      source: 'test',
      fetchedAt: new Date().toISOString(),
    },
    data: {
      schemaVersion: 1,
      entities: {
        ship: {
          932: { ja: 'Indiana', zh: '印第安纳', source: 'kcdata' },
        },
        map: {
          11: { ja: '鎮守府正面海域', zh: '镇守府正面海域' },
        },
      },
    },
  }
  assert.equal(validateLodePack(valid).ok, true)

  const malicious = structuredClone(valid)
  malicious.data.entities.ship['1" onclick="require(1)'] = malicious.data.entities.ship[932]
  assert.equal(validateLodePack(malicious).ok, false)

  const unknownDomain = structuredClone(valid)
  unknownDomain.data.entities.unsafe = {}
  assert.equal(validateLodePack(unknownDomain).ok, false)
})

test('ship banner thumbnails keep the subject in frame', () => {
  const html = rendererSource
  // 默认档 2026-09-01 从贴右（100%）左移到 78%：脸在原图 x≈143，贴右会把它推到框左侧
  // 并切掉半张。78% 是「脸完整入框、左侧不进徽章也不进杂物」那一档，徽章右缘 x≈58。
  // 往回改成 right/100% 或往左越过 74%，这条就该红。
  assert.match(html, /\.ship-thumb img\s*\{[^}]*object-position:\s*78% center;[^}]*\}/)
  // 三个特调档各有各的框宽，不跟着默认走，改默认时一字不动
  assert.match(html, /\.ship-thumb\.avatar img\s*\{[^}]*object-position:\s*68% center;[^}]*\}/)
  assert.match(html, /\.ship-thumb\.plan img\s*\{[^}]*object-position:\s*75% center;[^}]*\}/)
  assert.match(
    html,
    /\.mod-shi \.factory-outcome \.ship-thumb\.factory img\s*\{[^}]*object-position:\s*68% center;[^}]*\}/,
  )

  // 取景百分比与**框宽**是一对，不能只动一半：窗口左沿 = p × (240 − 窗宽)，
  // 窗宽 = 60 × 框宽 ÷ 框高，所以框一变宽，同一个 p 取到的就是另一段画面。
  // avatar 档 2026-09-01 由 36×28 / 22×22 放宽到 46×28 / 36×22，p 跟着 65%→68%
  // （两处新框宽高比一致，窗口都落在原图 x≈96–195）。把三处框宽钉在这里，
  // 谁改了框宽而没回来重调上面那个 68%，这条就该红。
  assert.match(html, /\.fleet-skin \.fc \{[^}]*width: 46px; height: 28px;[^}]*\}/)
  assert.match(html, /\.fleet-skin \.fc \.ship-thumb\.avatar \{[^}]*width: 46px; height: 28px;/)
  assert.match(html, /\.mod-du \.op-owned-ship \.ship-thumb \{ width: 36px; height: 22px;/)
  assert.match(html, /\.mod-du \.op-friend-ship \.ship-thumb \{ width: 36px; height: 22px;/)

  // 编队舰行的头像列是定宽 grid 列，窄档另有一份；列比头像窄就会把头像裁掉，
  // 展开的详情卡又靠 margin-left 与这一列对齐。这三个数改一个就得一起改，
  // 所以这里断言的是**它们之间的关系**，不是各自的字面值。
  const px = (re, what) => {
    const m = html.match(re)
    assert.ok(m, `没匹配到${what}`)
    return Number(m[1])
  }
  const fcWidth = px(/\.fleet-skin \.fc \{[^}]*width: (\d+)px;/, '编队头像格宽')
  const col = px(/\.fleet-skin \.ship \{[^}]*grid-template-columns: (\d+)px minmax/, '宽档头像列')
  const narrowCol = px(/\.fleet-skin\.narrow \.ship \{[^}]*grid-template-columns: (\d+)px /, '窄档头像列')
  const indent = px(/\.fleet-skin \.ship-detail \{[^}]*margin: 0 0 0 (\d+)px;/, '详情卡左缩进')
  const openIndent = px(
    /\.fleet-skin \.ship\.open \.ship-detail \{[^}]*margin: 10px 0 4px (\d+)px;/,
    '展开态详情卡左缩进',
  )
  assert.ok(col >= fcWidth, `宽档头像列 ${col}px 放不下 ${fcWidth}px 的头像格`)
  assert.ok(narrowCol >= fcWidth, `窄档头像列 ${narrowCol}px 放不下 ${fcWidth}px 的头像格`)
  assert.equal(indent, col, '详情卡左缘要和头像列对齐')
  assert.equal(openIndent, col, '展开态详情卡左缘要和头像列对齐')
})

test('abyss occurrence maps request compact thumbnails with labeled confirmed nodes', () => {
  const source = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  assert.match(
    source,
    /miniMapSvg\(entry\.code,\s*entry\.mapId,\s*\{\s*compact:\s*true,\s*focusNodes:\s*entry\.nodes,/,
  )
  assert.match(source, /isFocused[\s\S]*?<text[^>]+>\$\{esc\(l\)\}<\/text>/)
  assert.match(source, /denseCompact[\s\S]*?if \(focusMode && !isFocused\)/)
  assert.match(source, /showFocusLabels = !denseCompact \|\| focused\.size <= 2/)
})

test('abyss details mirror ship art, optional voice, and encounter subviews', () => {
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const images = fs.readFileSync(new URL('../src/renderer/kcs-image.ts', import.meta.url), 'utf8')
  const fetcher = fs.readFileSync(new URL('../scripts/fetch-lodes.mjs', import.meta.url), 'utf8')
  assert.match(catalog, /type AbyssDetailTab = 'a-cg' \| 'a-voice' \| 'a-map'/)
  assert.match(catalog, /\{ id: 'a-cg', label: '立绘' \}/)
  assert.match(catalog, /hasVoiceLines\(ship\.api_id\)[\s\S]*id: 'a-voice'[\s\S]*label: '语音'/)
  assert.match(catalog, /\{ id: 'a-map', label: '遭遇地点' \}/)
  assert.match(catalog, /abyssState\.dtab === 'a-map'[\s\S]*abyssFormsAndMapsHtml\(ship\)/)
  assert.match(catalog, /abyssState\.dtab === 'a-voice'[\s\S]*voicePanelHtml\(ship\.api_id\)/)
  assert.match(catalog, /id="ji-abyss-panel"/)
  assert.match(catalog, /const heroArt = shipImageUrl\(s\.api_id, 'banner'\)/)
  // 立绘格子的破图处理如今舰娘与深海共用一套（原来只有深海侧有），
  // 所以属性名从 data-abyss-cg-* 改成中性的 data-cg-*
  assert.match(catalog, /data-cg-image/)
  // 舰娘侧与深海侧都要接（不钉次数——重设 innerHTML 的地方还要各补一次）
  assert.match(catalog, /function wireShipDetailPanel[\s\S]{0,120}wireCgImages\(panel\)/)
  // 深海侧经 wireShipDetailPanel 取得 wireCgImages（换块路径单独补挂，见换块护栏）
  assert.match(catalog, /function wireAbyssDetailPanel[\s\S]{0,400}wireShipDetailPanel\(panel\)/)
  assert.match(images, /export const setShipImageGraph/)
  assert.match(images, /api_version\)\s*\?\s*graph\.api_version\[0\]/)
  assert.match(images, /\?version=\$\{encodeURIComponent\(version\)\}/)
  assert.match(catalog, /setShipImageGraph\(raw\.data\?\.api_mst_shipgraph \?\? \[\]\)/)
  assert.match(fetcher, /fetchEmbeddedPageTitles\('Template:深海栖舰导航'\)/)
  assert.match(fetcher, /abyssVoiceMstIdFromKey\(key\)/)
  assert.equal(abyssVoiceMstIdFromKey('ShinkaiSeikan581-Intro'), 1581)
  assert.equal(abyssVoiceMstIdFromKey('ShinkaiSeikan1711-Intro'), 1711)
  assert.equal(abyssVoiceMstIdFromKey('080a-0000'), null)
})

test('ship and abyss stats share fixed scales and abyss equipment stays navigable', () => {
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const images = fs.readFileSync(new URL('../src/renderer/kcs-image.ts', import.meta.url), 'utf8')
  // 固定标尺搬进了公共渲染件 stat-bars.ts（列表详情预览也要用同一根标尺）
  const bars = fs.readFileSync(new URL('../src/renderer/stat-bars.ts', import.meta.url), 'utf8')
  assert.match(bars, /const STAT_SCALE: Record<string, number> = \{[\s\S]*耐久: 1000[\s\S]*火力: 300[\s\S]*回避: 200/)
  assert.match(catalog, /const cap = statScale\(label\)/)
  assert.match(catalog, /const abyssStatRow = \(label: string, value: number\)/)
  assert.match(catalog, /class="stat-grid abyss-stats"/)
  assert.match(catalog, /abyss \? 'abyssEquip' : 'mstEquip'/)
  assert.match(catalog, /class="ro-chip abyss-equip-link"/)
  // 这里真正要守的是「别减 1000 去取玩家装备的图」：玩家装备最大 id 才 588，
  // 减完必然落进有效段，会稳定显示成完全无关的卡面。
  // （原先还断言 `if (mstId >= 1500) return null`，但那句本身是错的——
  //   实测深海飞机在 item_up 下有真实装备立绘，一刀切把它也挡掉了。）
  assert.doesNotMatch(images, /mstId >= 1500 \? mstId - 1000/)
  assert.doesNotMatch(images, /mstId - 1000/, '任何形式的减 1000 取图都不行')
  assert.match(catalog, /深海装备无独立官方卡面/)
})

test('深海装备的卡面：card 换成 item_up，别去碰 btxt_flat', () => {
  const images = fs.readFileSync(new URL('../src/renderer/kcs-image.ts', import.meta.url), 'utf8')
  const at = images.indexOf('export const slotItemImageUrl')
  const body = images.slice(at, images.indexOf('\n}', at))
  // 实测 2026-08-09 逐类型探过：深海飞机(1549)只有 item_up 且是真实立绘，
  // 深海火炮(1653/1502)只有 btxt_flat 而那是装备名的艺术字、不是装备图。
  assert.ok(body.includes("'item_up'"), '深海装备的 card 该换成 item_up')
  assert.ok(body.includes('mstId >= 1500'), '换类型要限定在深海段，别动玩家装备')
  assert.ok(
    !body.includes("'btxt_flat'"),
    'btxt_flat 是艺术字标题不是装备图，不能拿来当卡面',
  )
  // 换过类型之后，路径必须用换后的那个——拿原 type 去拼，算出来是另一张图的名字
  assert.match(
    body,
    /slotItemPath\(mstId, effective\)/,
    '换算后的类型没用于生成路径，等于换了个寂寞',
  )
})

test('装备立绘栏摆的是各种拆分，标签不能张冠李戴', () => {
  const images = fs.readFileSync(new URL('../src/renderer/kcs-image.ts', import.meta.url), 'utf8')
  const at = images.indexOf('const SLOT_IMG_WANTED')
  assert.ok(at > 0, '没有装备贴图清单')
  // 找数组自己的收尾，别停在类型注解 `[...][]` 里的那个 ]
  const table = images.slice(at, images.indexOf('\n]', at))
  // 标签是逐张看图定的（2026-08-09）：item_up 纯装备、item_character 纯妖精、
  // item_on 是两者合成。这三条一旦标反，玩家看到的说明就是错的。
  for (const [type, must] of [
    ['item_up', '单体'],
    ['item_character', '妖精'],
    ['item_on', '带妖精'],
    ['card', '卡面'],
  ]) {
    const line = table.split('\n').find((l) => l.includes(`'${type}'`))
    assert.ok(line, `清单里缺 ${type}`)
    assert.ok(line.includes(must), `${type} 的标签该体现「${must}」：${line.trim()}`)
  }
  // 摆全部贴图时不能走 card→item_up 的兜底替换，否则会把 item_up 标成「卡面」
  const fnAt = images.indexOf('export const availableSlotItemImages')
  const fn = images.slice(fnAt, images.indexOf('\n}', fnAt))
  assert.ok(!fn.includes('slotItemImageUrl('), '这里要按原类型取，不能复用带替换的那个入口')
  assert.ok(fn.includes('slotItemPath('), '应直接按原类型拼路径')

  // 空态提示要能露出来：格子全 404 时靠 data-cg-empty
  const ji = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  assert.ok(ji.includes('data-cg-grid'), '贴图区没有标记，空态判断找不到它')
  assert.ok(ji.includes('data-cg-empty'), '没有空态提示')
  // 装备详情不走舰娘那两条 wire 路径，不单独接就一格都不显形
  assert.ok(ji.includes(".equip-cg-grid'"), 'wire 里没接装备贴图格子')
})

test('expedition fleet status rows include a real fuel and ammo supply check', () => {
  const source = fs.readFileSync(new URL('../src/renderer/modules/bi.ts', import.meta.url), 'utf8')
  const html = rendererSource
  assert.match(source, /ship\.fuel < master\.fuelMax/)
  assert.match(source, /ship\.bull < master\.bullMax/)
  // 状态本体抽成 deckStatusHtml：甘特条与紧凑态的悬停卡共用一份，
  // 补给记号是它的固定末项——两边都不许各写一版。
  assert.match(source, /return `\$\{status\}\$\{supplyIconHtml\(deck\)\}`/)
  assert.match(source, /<span class="k">\$\{deck\.id\}舰<\/span>\$\{deckStatusHtml\(deck\)\}/)
  assert.match(source, /class="g-exp-no"/)
  assert.match(source, /class="g-countdown" data-cds=/)
  assert.doesNotMatch(source, /g-track|g-bar|WINDOW_MS/)
  assert.match(html, /\.mod-bi \.gantt \{ display: flex;/)
  assert.doesNotMatch(html, /\.mod-bi \.g-track|\.mod-bi \.g-bar/)
  assert.match(source, /class="filter-strip"[\s\S]*class="type-chips"[\s\S]*class="sort-row"/)
  assert.match(html, /\.mod-bi \.filter-strip \{ display: grid; grid-template-columns: minmax\(0, 1fr\) auto;/)
  assert.match(html, /\.mod-bi \.bi-app\.narrow \.filter-strip, \.mod-bi \.bi-app\.open \.filter-strip \{ grid-template-columns: minmax\(0, 1fr\);/)
})

test('the Windows one-click launcher starts from its own folder and preserves startup errors', () => {
  const launcher = fs.readFileSync(new URL('../启动kuma.cmd', import.meta.url), 'utf8')
  const packager = fs.readFileSync(new URL('../scripts/package-win.mjs', import.meta.url), 'utf8')
  const packageJson = fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  assert.match(launcher, /cd \/d "%~dp0"/)
  assert.match(launcher, /if not exist "node_modules\\\.bin\\electron\.cmd"/)
  assert.match(launcher, /call npm\.cmd install/)
  assert.match(launcher, /call npm\.cmd run start/)
  assert.match(launcher, /if errorlevel 1 goto launch_failed/)
  assert.match(launcher, /pause/)
  // 打包前必须先构建，而且必须是**发行版**那一路：`--release` 关掉渲染层的外挂
  // sourcemap（三个 .map 合计 5.46MB，占 app.asar 的 18%，而正式包里没人读得到它）。
  // 不钉整条字面量——钉的是「先构建」和「构建是发行版」这两件事都还在。
  const scripts = JSON.parse(packageJson).scripts
  assert.match(scripts['package:win'], /^node scripts\/build\.mjs --release &&/)
  assert.match(scripts['package:win'], /&& node scripts\/package-win\.mjs$/)
  assert.match(packager, /executableName: 'kuma'/)
  assert.match(packager, /icon,/)
  assert.match(packager, /asar: true/)
  // 杀软持着刚解压的 exe，packager 紧接着 rename 整个模板目录 → EPERM。
  // 等待必须在 rename **之前**（afterExtract）；等在「失败后重试前」没用，
  // 下一轮是新解压的目录（实测外层退避到 5/10/20/30/30 秒仍每次都挂）。
  // 这里不钉死具体毫秒，只要求它长到能扛住一次扫描——1.8 秒已经证明不够。
  const waitMs = Number(packager.match(/afterExtract:[\s\S]*?setTimeout\(resolve, (\d+)\)/)?.[1])
  assert.ok(waitMs >= 8000, `afterExtract 的等待只有 ${waitMs}ms，实测 1800ms 扛不住杀软扫描`)
  assert.match(packager, /rmSync\(tempDir, \{ recursive: true, force: true \}\)/)
  assert.match(packager, /error\?\.code === 'EPERM'[\s\S]*error\?\.syscall === 'rename'/)
  // 清理要吞掉自己的异常，否则它会从 finally 冒出来盖掉真正的原因
  assert.match(packager, /const rmWithRetry = /)
  assert.match(packager, /留在原地不阻断打包/)
  assert.match(packager, /'requested-execution-level': 'asInvoker'/)
  assert.match(packager, /const shortcut = path\.join\(root, 'kuma\.lnk'\)/)
  assert.match(packager, /\$link\.TargetPath = \$env:KANSO_EXE/)
  assert.match(packager, /\$link\.IconLocation = \\"\$env:KANSO_EXE,0\\"/)
  assert.match(readme, /启动kuma\.cmd/)
  assert.match(readme, /release\/kuma-win32-x64\/kuma\.exe/)
})

test('user-facing renderer copy consistently uses 返港 terminology', () => {
  const root = new URL('../src/renderer/', import.meta.url)
  const legacyTerm = String.fromCodePoint(0x5f52, 0x6295)
  const pending = [root]
  const offenders = []
  while (pending.length) {
    const dir = pending.pop()
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir)
      if (entry.isDirectory()) pending.push(child)
      else if (/\.(?:ts|html)$/.test(entry.name) && fs.readFileSync(child, 'utf8').includes(legacyTerm)) {
        offenders.push(child.pathname)
      }
    }
  }
  assert.deepEqual(offenders, [])
})

test('periodic element rail stays hidden until the left edge is hovered', () => {
  const html = rendererSource
  assert.match(html, /main\s*\{[^}]*position:\s*relative;[^}]*padding-left:\s*7px;/)
  assert.match(html, /#element-rail\s*\{[^}]*position:\s*absolute;[^}]*width:\s*7px;/)
  assert.match(html, /#element-rail:hover\s*\{[^}]*width:\s*44px;/)
  assert.match(html, /#element-rail\s*>\s*\*\s*\{[^}]*opacity:\s*0;[^}]*pointer-events:\s*none;/)
  assert.match(html, /#element-rail:hover\s*>\s*\*\s*\{[^}]*opacity:\s*1;[^}]*pointer-events:\s*auto;/)
  assert.match(html, /#element-rail:has\(\.badge-n\)::after/)
})

// 同族的另一半在 `player-copy-ratchet.test.mjs`：那一条走 TS AST 语料（注释不算文案），
// 管的是**已裁定的句式与措辞**（拟人、替玩家推结论、口语叙事腔）；这一条按整份文件做正则，
// 管的是**直译腔词汇**。两条互不覆盖，加新词之前先想清楚该往哪边加。
test('player-facing copy avoids stiff Japanese calques', () => {
  const root = new URL('../src/renderer/', import.meta.url)
  const pending = [root]
  const offenders = []
  const calques =
    // 「够得到」是「手が届く」的直译腔（2026-08-26 用户当场退回夜战友军那句副行时点名）。
    // 「摸不到」同族同日：追击提示里的「主力夜战摸不到」——肢体隐喻当军语用，
    // 而且那句话本身还在重复前半句已经说过的事。正字示范是用完整军语作主体
    //（「敌主力舰队」），别拿够得到/摸不到/碰得着这类词代替。
    /所持|在籍|入手|泛用|周历|未观测|回港|轰沉|现编成|报酬|遂行中|任务所|在途|在泊|低练|图鉴新登录|制空値|勝利条件|係数|輸送物資量|二番舰|期间限定|未受领|非公式|个人实绩|够得到|摸不到/
  while (pending.length) {
    const dir = pending.pop()
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir)
      if (entry.isDirectory()) {
        pending.push(child)
        continue
      }
      if (!/\.(?:ts|html)$/.test(entry.name)) continue
      const source = fs
        .readFileSync(child, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      const hit = source.match(calques)
      if (hit) offenders.push(`${child.pathname}: ${hit[0]}`)
    }
  }
  assert.deepEqual(offenders, [])

  const quest = fs.readFileSync(new URL('../src/renderer/modules/qn.ts', import.meta.url), 'utf8')
  const event = fs.readFileSync(new URL('../src/renderer/modules/du.ts', import.meta.url), 'utf8')
  const notice = fs.readFileSync(new URL('../src/renderer/modules/lg.ts', import.meta.url), 'utf8')
  // 原来钉的是「自选奖励库存参考」——那句是 h4 的重复自述，第三批文案裁定里
  // 连同后半句一起收进了悬停。去掉直译味的落点其实是 h4 本身（「選択報酬」→
  // 「可选物品奖励」），改钉它，不随提示语增删漂移。
  assert.match(quest, /<h4>可选物品奖励\s/)
  assert.match(event, /锁船标签（札）/)
  // 原来钉的是空态里那句「十类事件（…）」，既点数又枚举——数字已漂移成 13 类，
  // 枚举整段按裁定删掉了。改钉当初真正要换掉的那个直译词的落点：
  // 「图鉴新登录」→「新舰入库」，写在事件表的 label 上，不随文案增删漂移。
  assert.match(notice, /id: 'newShip', label: '新舰入库'/)
})

test('retrospective module consolidates local histories without duplicating detail views', () => {
  const source = fs.readFileSync(new URL('../src/renderer/modules/shi.ts', import.meta.url), 'utf8')
  const kernel = fs.readFileSync(new URL('../src/renderer/kernel.ts', import.meta.url), 'utf8')
  const ledger = fs.readFileSync(new URL('../src/main/mg/ledger.ts', import.meta.url), 'utf8')
  const main = fs.readFileSync(new URL('../src/main/mg/index.ts', import.meta.url), 'utf8')
  const battle = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  assert.match(source, /id:\s*'shi'[\s\S]*title:\s*'回顾'/)
  // 资源曲线走逐日聚合通道（2026-08-23 下沉到 SQL；等价性护栏在 material-daily）
  assert.match(source, /queryDailyMaterialHistory\(materialSince, now\)/)
  assert.match(source, /queryBattleSnapshots\(500\)/)
  assert.match(source, /queryNodeHistoryIndex\(600\)/)
  assert.match(source, /queryEventArchives\(\)/)
  assert.match(source, /queryUseitemSummary\(0\)/)
  assert.match(source, /queryRecentUseitemChanges\(240\)/)
  assert.match(source, /按本地自然日/)
  assert.match(source, /openResourceTrendWindow\(\)/)
  assert.match(source, /elink\('battle'/)
  assert.match(source, /queryNodeHistory\(map, cell, 200\)/)
  assert.match(source, /void selectNode\(map, cell\)/)
  assert.match(source, /data-shi-practice-day/)
  assert.match(source, /data-shi-practice-session/)
  assert.match(source, /shi-history-day/)
  assert.match(source, /data-shi-node-map/)
  assert.match(source, /data-shi-spot/)
  assert.match(source, /queryLode\('poi-fcd-map'\)/)
  assert.match(source, /jstHourOf/)
  assert.match(source, /shi-chart-track/)
  assert.match(source, /shi-chart-scroll/)
  assert.match(kernel, /export const jstHourOf/)
  assert.doesNotMatch(source, /slice\(0, 20\)/)
  assert.doesNotMatch(source, /slice\(0, 21\)/)
  assert.doesNotMatch(source, /slice\(0, 80\)/)
  assert.doesNotMatch(source, /slice\(0, 30\)/)
  assert.match(kernel, /ipcRenderer\.invoke\('mg:useitem-changes', limit\)/)
  assert.match(main, /ipcMain\.handle\('mg:useitem-changes'/)
  assert.match(ledger, /FROM useitem_log\s+ORDER BY ts DESC\s+LIMIT \?/)
  assert.doesNotMatch(battle, /\$\{historyHtml\(\)\}|\$\{nodeHistoryHtml\(\)\}/)
  assert.doesNotMatch(battle, /data-act="node-history-toggle"/)
})

test('retrospective module is reachable from the top bar and responds to narrow panes', () => {
  const index = fs.readFileSync(new URL('../src/renderer/index.ts', import.meta.url), 'utf8')
  const host = fs.readFileSync(new URL('../src/renderer/mu.ts', import.meta.url), 'utf8')
  const html = rendererSource
  assert.match(index, /import '\.\/modules\/shi'/)
  assert.match(host, /\['shi', '回顾'\]/)
  assert.match(host, /OVERLAY_MODULES = \['shi', 'lg', 'yu', 'mgstate', 'anchor'\]/)
  assert.doesNotMatch(host, /\['zi', 'shi'\]/)
  assert.match(html, /\.mod-shi \.shi-overview-grid/)
  assert.match(html, /@container \(max-width: 520px\)[\s\S]*\.mod-shi \.shi-two-col \{ grid-template-columns: 1fr;/)
  assert.match(html, /\.mod-shi \.shi-body \{[\s\S]*overflow: auto;/)
  assert.match(html, /\.mod-shi \.shi-chart-scroll/)
  assert.match(html, /\.mod-shi \.shi-chart-track/)
  assert.match(html, /\.mod-shi \.shi-node-maps/)
  assert.match(html, /\.mod-shi \.shi-history-day h4/)
  assert.match(html, /\.mod-shi \.shi-mapgraph/)
  assert.match(html, /\.mod-shi \.shi-session-chips/)
})

test('diagnostic status, event log, and DevTools stay out of the normal top bar', () => {
  const index = fs.readFileSync(new URL('../src/renderer/index.ts', import.meta.url), 'utf8')
  const host = fs.readFileSync(new URL('../src/renderer/mu.ts', import.meta.url), 'utf8')
  const links = fs.readFileSync(new URL('../src/renderer/link.ts', import.meta.url), 'utf8')
  const html = rendererSource

  assert.match(host, /DIAGNOSTIC_MODULES = new Set\(\['mgstate', 'anchor'\]\)/)
  assert.match(host, /DEBUG_UI = process\.env\.KANSO_DEBUG_UI === '1'/)
  assert.match(
    host,
    /!hiddenModules\.has\(id\) && \(DEBUG_UI \|\| !DIAGNOSTIC_MODULES\.has\(id\)\)/,
  )
  assert.match(host, /if \(!moduleVisible\(mod\.id\)\) continue/)
  assert.doesNotMatch(html, /id="btn-devtools"/)
  assert.doesNotMatch(index, /webview\?\.openDevTools\(\)/)
  assert.doesNotMatch(html, /id="ws-nav"|id="nav-back"|id="nav-fwd"|id="nav-crumb"/)
  assert.doesNotMatch(links, /NavEntry|navBack|navForward|navCrumb|Alt\+←|Alt\+→/)
  assert.doesNotMatch(host, /data-split-group|splitOut|⊞/)
  assert.match(host, /class="dock-fold-btn" data-fold="1"/)
})

test('review battle replays open in a local side drawer instead of the covered combat module', () => {
  const review = fs.readFileSync(new URL('../src/renderer/modules/shi.ts', import.meta.url), 'utf8')
  const combat = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  const html = rendererSource
  assert.match(review, /elink\('battle', row\.id,[^\n]+, 'shi'\)/)
  assert.match(review, /queryBattleSnapshot\(id\)/)
  assert.match(review, /event\.stopPropagation\(\)/)
  assert.match(review, /renderBattleReplayDetail\(detail, selectedBattle\)/)
  // 2026-08-20 口径：抽屉里点航迹节点**也**不许切走模块。原钉只写了三个实参，
  // 改成钉「有没有把换片回调接上」——这才是「不切模块」在航迹那条路上的落点。
  // （原来那条路直通 di 的 openBattleSnapshot，它自带 activateModule('di')，
  // 于是本测试上一行的 doesNotMatch 明明是绿的，工作区照样被拽走。）
  assert.match(
    review,
    /handleBattleReplayDetailClick\(battleDetail, selectedBattle, target, \{\s*openSnapshot: \(id\) => void openReviewBattle\(id\),/,
    '抽屉没把航迹换片接到自己的 openReviewBattle 上',
  )
  assert.doesNotMatch(review, /activateModule\('di'\)/)
  assert.match(combat, /export const renderBattleReplayDetail/)
  assert.match(combat, /renderBattlePane\(pane, snapshot, true, true, options\?\.trailIndex \?\? battleHistory\)/)
  assert.match(html, /\.mod-shi \.shi-stage \{[\s\S]*display: flex;[\s\S]*overflow: hidden;/)
  assert.match(html, /\.mod-shi \.shi-battle-drawer \{[\s\S]*border-left:/)
})

test('native master and sortie fields stay connected to player-facing decisions', () => {
  const types = fs.readFileSync(new URL('../src/shared/mg-types.ts', import.meta.url), 'utf8')
  const store = fs.readFileSync(new URL('../src/main/mg/store.ts', import.meta.url), 'utf8')
  const battle = fs.readFileSync(new URL('../src/main/mg/battle.ts', import.meta.url), 'utf8')
  const ledger = fs.readFileSync(new URL('../src/main/mg/ledger.ts', import.meta.url), 'utf8')
  const combat = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const expedition = fs.readFileSync(new URL('../src/renderer/modules/bi.ts', import.meta.url), 'utf8')
  const activity = fs.readFileSync(new URL('../src/renderer/modules/du.ts', import.meta.url), 'utf8')
  const roster = fs.readFileSync(new URL('../src/renderer/modules/qa.ts', import.meta.url), 'utf8')
  const fleet = fs.readFileSync(new URL('../src/renderer/modules/ru.ts', import.meta.url), 'utf8')
  const images = fs.readFileSync(new URL('../src/renderer/kcs-image.ts', import.meta.url), 'utf8')

  assert.match(types, /export interface MasterShipUpgrade/)
  assert.match(store, /for \(const raw of body\.api_mst_shipupgrade \?\? \[\]\)/)
  assert.match(store, /buildTime:\s*s\.api_buildtime/)
  assert.match(store, /powup:\s*four\(s\.api_powup\)/)
  assert.match(store, /difficulty:\s*m\.api_difficulty/)
  assert.match(store, /winItem1:\s*pair\(m\.api_win_item1\)/)
  assert.match(store, /sampleFleet:\s*Array\.isArray\(m\.api_sample_fleet\)/)
  assert.match(catalog, /api_mst_shipupgrade/)
  assert.match(catalog, /mg\.master\.upgrades\[targetShipId\]/)
  assert.match(catalog, /field: 'drawingCount'/)
  assert.match(catalog, /field: 'catapultCount'/)
  assert.match(catalog, /field: 'reportCount'/)
  assert.match(catalog, /field: 'aviationMatCount'/)
  assert.match(catalog, /field: 'armsMatCount'/)
  assert.match(catalog, /\{ kind: 'useitem', id: 94, name: '新型兵装资材', field: 'armsMatCount' \}/)
  assert.match(catalog, /\{ kind: 'useitem', id: 100, name: '海外舰最新技术', field: 'techCount' \}/)
  assert.match(catalog, /\{ kind: 'slotitem', id: 87, name: '新型高温高压锅炉', field: 'boilerCount' \}/)
  // 别名表与串解析已提到 shared/kcwiki-upgrade.ts（编队卷的「下一改装」要共用同一套）
  const upgrade = fs.readFileSync(new URL('../src/shared/kcwiki-upgrade.ts', import.meta.url), 'utf8')
  assert.match(upgrade, /const KCWIKI_EQUIP_ALIAS: Record<string, number> = \{\s*新型高温高压锅炉: 87,/)
  assert.match(upgrade, /if \(equipId != null\) return \{ kind: 'slotitem', id: equipId \}/)
  assert.match(catalog, /const alias = kcwikiUpgradeNeedAlias\(name\)/)
  assert.match(catalog, /const alias = kcwikiUpgradeNeedAlias\(rawName\)/)
  assert.doesNotMatch(catalog, /\{ id: 75,[^}]+field:/)
  assert.match(types, /boilerCount: number/)
  assert.match(store, /boilerCount: Number\(raw\.api_boiler_count\) \|\| 0/)
  assert.match(catalog, /queryLode\('wikiwiki-remodel'\)/)
  assert.match(catalog, /covered\.has\(key\)/)
  assert.match(catalog, /needChipsHtml\(wiki\?\.图纸, mstId, predecessorId\)/)
  assert.match(catalog, /wikiwiki 改造チャート补 API 表外素材/)
  assert.match(catalog, /let remodelEquipNeeds = new Map<number, RemodelNeed\[\]>\(\)/)
  assert.match(catalog, /const targetMap = kind === 'slotitem' \? remodelEquipNeeds : remodelNeeds/)
  assert.match(catalog, /const equipRemodelUsageHtml = \(equipId: number\)/)
  assert.match(catalog, /\$\{equipRemodelUsageHtml\(e\.api_id\)\}/)
  // 2026-08-16 出处收纳：整行「数据来源 …」收成悬停小记号，行内只剩 remodelNeedCredit() 的记号
  assert.match(catalog, /\$\{remodelNeedCredit\(\)\}/)
  assert.match(catalog, /credit-mark/)
  assert.match(catalog, /api_afterbull/)
  assert.match(catalog, /api_mst_equip_limit_exslot/)
  assert.match(expedition, /游戏官方示例编成/)
  assert.match(expedition, /不代表成功条件或最优方案/)
  assert.match(expedition, /queryLode\('wikiwiki-expedition'\)/)
  // 这栏要守的是「奖励来自游戏内建字段、明细还没有」这条交代仍在，
  // 字段名按裁定不再上屏，所以钉「待资料补充」这半句，不钉 api_ 名。
  assert.match(expedition, /游戏内建奖励栏 · 概率与资源明细待资料补充/)

  assert.match(store, /enemyPreview:\s*enemyPreviewOf\(body\)/)
  assert.match(store, /flavor:\s*cellFlavorOf\(body\)/)
  assert.match(store, /cellData:\s*cellDataOf\(body\)/)
  assert.match(store, /selectRoute:\s*selectRouteOf\(body\)/)
  assert.match(combat, /交战前敌情/)
  assert.match(combat, /const previewEncounterCandidates = /)
  assert.match(combat, /previewIds\.every\(\(mstId, index\) => ships\[index\] === mstId\)/)
  assert.match(combat, /candidates\.length === 1 \? '已锁定 1 套编成'/)
  assert.match(combat, /`命中 \$\{candidates\.length\} 套候选`/)
  // 中段那句渲染说明（多套候选保留为区间）已按裁定删；行为本身没变，改钉抬头把
  // 候选套数摊在脸上，以及 summarizeEncounterForecasts + 区间格式化这条实现路径。
  assert.match(combat, /\$\{band\.candidates\} 套完整候选/)
  assert.match(combat, /const band = summarizeEncounterForecasts\(forecasts\)/)
  assert.match(combat, /preBattleMechanicHtml/)
  // 三格 <em> 副标（「敌我装备/面板计算」等）2026-08-26 按裁定删了（常驻方法声明）。
  // 「给的是区间不是单值」这件事改钉格式化函数本体，比钉副标硬。
  assert.match(combat, /<b>\$\{modelRangeText\(band\.bPlus\)\}<\/b>/)
  assert.doesNotMatch(combat, /\$\{routeCardHtml\(s\)\}/)
  assert.match(catalog, /全图与路线预测/)
  assert.match(catalog, /道中通过/)
  assert.match(catalog, /终点 S\/A/)
  assert.match(catalog, /forecastConfirmedComps/)
  assert.match(catalog, /evaluateRoutingRules/)
  assert.match(catalog, /queryLode\('wikiwiki-routing'\)/)
  assert.match(catalog, /const wikiwikiRoutingHtml = \(code: string\)/)
  // 「为什么这里是日文原文」那条折叠说明整块删了。它守的是「日文条件原样照录、
  // 不擅自转成可执行判定」——这条现在钉段名 + 渲染实现：段名自称日文一手，
  // 正文直接 esc(conditionJp) 输出，没有任何转换。
  assert.match(catalog, /日文一手分歧说明/)
  assert.match(catalog, /esc\(route\?\.conditionJp \?\? ''\)/)
  // 敌情卡脚注里那句「艦素不会代为操作」按裁定 2 撤下（纯机制处的顺带声明，
  // 封禁承诺只留在用户真有顾虑的位置）。只读纪律的护栏没丢：同一份 di.ts 由
  // 「演习只记录不代打」那条测试钉着 /挑谁打在游戏里点/。这里改钉脚注还在说
  // 阵型默认值这件事本身，别把整条脚注也删空。
  assert.match(combat, /水面战默认单纵阵（联合第四）、纯潜水编成默认单横阵（联合第一）/)
  assert.match(ledger, /json_extract\(comp, '\$\[\$\{index\}\]'\)/)
  assert.match(ledger, /boss_rank IN \('S', 'A'\)/)

  assert.match(battle, /body\.api_fParam/)
  assert.match(battle, /body\.api_eParam/)
  assert.match(battle, /h\.api_si_list/)
  assert.match(battle, /kouku\.api_squadron_plane/)
  assert.match(store, /body\.api_get_ship_exp/)
  assert.match(store, /body\.api_get_exp_lvup/)
  assert.match(store, /body\.api_enemy_info\?\.api_deck_name/)
  assert.match(store, /typeof body\.api_destsf === 'number'/)
  assert.match(roster, /repairDuration\(ship\.ndockTime\)/)
  assert.match(fleet, /repairQuoteHtml\(ship\)/)
  assert.match(activity, /mapFleetAllowanceLabels\(info\.api_sally_flag\)/)
  assert.match(images, /export const shipGraphLayout = /)
  assert.match(images, /battle\|boko\|kaisyu\|kaizo\|map\|ensyuf\|ensyue/)
  assert.match(catalog, /官方构图锚点/)
  // 「横幅与卡面已经裁切，不会重复套用坐标」这半句是 UI 自述，已随文案清理删。
  // 「游戏拿这些坐标…」那句也按本次文案清扫裁定（族 3 玩家常识）删了。
  // 两句护的都是同一条真行为：这组坐标只是给游戏完整画布用的资料，艦素自己绝不拿它摆位。
  // 文案没了，行为钉不能松——下面那条「坐标只被那张只读锚点表读一次」原样保留。
  assert.equal(
    (catalog.match(/shipGraphLayout\(/g) ?? []).length,
    1,
    '构图坐标被读了不止一次——它只该喂那张只读锚点表，不许拿去给立绘摆位',
  )
})

test('official lifetime record stays sanitized, normalized, and separate from local history', () => {
  const types = fs.readFileSync(new URL('../src/shared/mg-types.ts', import.meta.url), 'utf8')
  const store = fs.readFileSync(new URL('../src/main/mg/store.ts', import.meta.url), 'utf8')
  const main = fs.readFileSync(new URL('../src/main/mg/index.ts', import.meta.url), 'utf8')
  const kernel = fs.readFileSync(new URL('../src/renderer/kernel.ts', import.meta.url), 'utf8')
  const review = fs.readFileSync(new URL('../src/renderer/modules/shi.ts', import.meta.url), 'utf8')

  assert.match(types, /export interface PlayerRecord/)
  assert.match(store, /'\/kcsapi\/api_get_member\/record'/)
  assert.match(store, /parsed >= 0 && parsed <= 1[\s\S]*parsed \* 100/)
  assert.match(store, /api_air_base_expanded_info/)
  assert.doesNotMatch(store.match(/'\/kcsapi\/api_get_member\/record'[\s\S]*?return \['record'\]/)?.[0] ?? '', /api_member_id|api_cmt|api_photo_url/)
  assert.match(main, /patch\.record = state\.player\.record/)
  assert.match(kernel, /record: MgPlayer\['record'\]/)
  assert.match(review, /游戏官方生涯统计/)
  // 2026-08-17 起返港自带简版（胜负实时），完整版仍靠战绩页；不补零口径不变
  // 08-24 文案清洗把逐项枚举压成一句（一眼扫过的位置只留动作），语义不变：
  // 返港自动同步，更完整的一份仍靠游戏内战绩页。
  assert.match(review, /官方统计尚未同步 · 返港或打开游戏/)
  // 指路必须与游戏菜单逐字对上：游戏里写的是「戦績表示」，不许简中化（同 zi.ts:846）
  assert.match(review, /「戦績表示」页后同步/)
  // 末句设计辩解已删；2026-08-26「与下方本机明细分开计，不混算」也按族 2 删了。
  // 「不拿本地记录冒充生涯数据」这条纪律本来就是代码行为——没拿到官方战绩就整段
  // 走空态，绝不用本机 90 日明细顶上。它一直由下面这个分支护栏真正守着。
  assert.match(review, /const officialRecordHtml[\s\S]{0,200}if \(!record\) \{[\s\S]{0,120}shi-official-record empty/)
  const storeSrc = fs.readFileSync(new URL('../src/main/mg/store.ts', import.meta.url), 'utf8')
  assert.match(storeSrc, /materialMax: prev\?\.materialMax \?\? null/, '只有战绩页才有的字段保留旧值')
  // 2026-08-19 用户报「氪金扩船位后总览不同步」：port 报文自带的上限/舰数每次回港都刷
  assert.match(storeSrc, /shipCapacity: cap\(rawBasic\.api_max_chara\) \?\? prev\?\.shipCapacity \?\? null/)
  assert.match(storeSrc, /slotitemCapacity: cap\(rawBasic\.api_max_slotitem\) \?\? prev\?\.slotitemCapacity \?\? null/)
  assert.match(storeSrc, /shipCount: Array\.isArray\(body\.api_ship\) \? body\.api_ship\.length : prev\?\.shipCount \?\? null/)
  assert.match(storeSrc, /slotitemCount: prev\?\.slotitemCount \?\? null/, '装备计数口径未验证，仍保留战绩页快照')
  assert.match(storeSrc, /api_parallel_quest_count === 'number' && body\.api_parallel_quest_count > 0/)
})

test('local purchase ledger observes payitem packets, persists forever, and only manual rows are deletable', () => {
  // 2026-08-19 用户定名「本机氪金记录」：购买 = payitem 清单前后相减（只有增加算），
  // 消耗 = payitemuse 随用随记，manual = 玩家补记本机外的氪金
  const store = fs.readFileSync(new URL('../src/main/mg/store.ts', import.meta.url), 'utf8')
  const ledger = fs.readFileSync(new URL('../src/main/mg/ledger.ts', import.meta.url), 'utf8')
  const main = fs.readFileSync(new URL('../src/main/mg/index.ts', import.meta.url), 'utf8')
  const kernel = fs.readFileSync(new URL('../src/renderer/kernel.ts', import.meta.url), 'utf8')
  const review = fs.readFileSync(new URL('../src/renderer/modules/shi.ts', import.meta.url), 'utf8')
  const payShared = fs.readFileSync(new URL('../src/shared/pay-log.ts', import.meta.url), 'utf8')
  const html = rendererSource

  // 解析层：认不出的报文形状必须返回 null（当空清单会造假购买），首观测不造记录
  assert.match(payShared, /return null\s*\n\s*\}/)
  assert.match(payShared, /if \(!prev\) return \[\]/)
  // 归约层：payitem 观测 diff 出购买；payitemuse 记消耗并顺手刷新顶栏上限
  assert.match(store, /'\/kcsapi\/api_get_member\/payitem'/)
  assert.match(store, /if \(next === null\) return \[\]/)
  assert.match(store, /diffPayitemStocks\(prev\?\.items \?\? null, next\)/)
  assert.match(store, /'\/kcsapi\/api_req_member\/payitemuse'/)
  assert.match(store, /b\.maxShips = body\.api_max_chara/)
  // 持有基线跨重启（丢了会漏记或造假），记录本体是永久表
  assert.match(store, /payitems: state\.player\.payitems/)
  assert.match(ledger, /CREATE TABLE IF NOT EXISTS pay_log/)
  assert.match(ledger, /DELETE FROM pay_log WHERE id = \? AND kind = 'manual'/, '自动行是账，不许删')
  // 补记入口在主进程再验一遍（渲染层表单不是信任边界）
  assert.match(main, /mg:pay-log-add/)
  assert.match(main, /Number\.isInteger\(count\) \|\| count <= 0 \|\| count > 99/)
  assert.match(main, /patch\.payitems = state\.player\.payitems/)
  assert.match(kernel, /payitems: MgPlayer\['payitems'\]/)
  // 展示层：本机氪金记录 + 已购未用（2026-08-19 追问「买了还没用的」）+ 补记按钮/两段式删除
  assert.match(review, /本机氪金记录/)
  assert.match(review, /已购未用/)
  assert.match(review, /data-shi-pay-add/)
  assert.match(review, /payDelArmId !== id/)
  assert.match(review, /api_mst_payitem/)
  // 2026-08-19 用户指出：道具名要配图标，不是光秃秃一个字——同名 useitem 的图标直接复用
  assert.match(review, /const payItemIconHtml = /)
  assert.match(review, /\$\{payItemIconHtml\(row\.name\)\}/)
  assert.match(review, /\$\{payItemIconHtml\(item\.name\)\}/)
  assert.match(html, /\.shi-pay-row\.kind-manual \.k/)
})

test('pinning a rich tip captures the click so enclosing expandable cards stay open', () => {
  // 2026-08-19 用户报告：可展开卡里的「点击钉住」提示，一点钉住外层卡也收起——
  // 钉住监听原在 document 冒泡端，模块面板的开合处理先它一步吃到同一次点击。
  // 修法：捕获相 + stopPropagation，钉住就是 [data-tip] 点击的全部语义。
  const link = fs.readFileSync(new URL('../src/renderer/link.ts', import.meta.url), 'utf8')
  const pinBlock = link.match(/捕获相拦截[\s\S]*?\n    true,\n  \)/)?.[0] ?? ''
  assert.match(pinBlock, /event\.stopPropagation\(\)/)
  assert.match(pinBlock, /pinTip\(target\)/)
  assert.match(pinBlock, /hideMenu\(\)/, '捕获拦断会跳过「点外面关菜单」，这里补一手')
  assert.match(pinBlock, /\n    true,\n  \)/, '必须挂在捕获相，冒泡相晚于面板开合处理')
  // 2026-08-19 追加：钉住卡与悬停版同规则量高翻转——下方放不下就落在锚点上方，
  // 不再把超高的卡怼出屏幕下缘让用户自己拖
  assert.match(link, /const placePinnedCard = /)
  assert.match(link, /y = rect\.top - h - 6 - offset/)
  assert.match(link, /placePinnedCard\(card, anchor\.getBoundingClientRect\(\)/)
  assert.match(link, /placePinnedCard\(card, target\.getBoundingClientRect\(\)/)
  assert.doesNotMatch(link, /window\.innerHeight - 140/, '旧的「只钳左上角」定位不许回来')
})

test('persistent read-only banners stay hoverized and quest reset timers live in tooltips', () => {
  // 2026-08-19 用户点的两处：任务周期芯片的刷新倒计时挤成一团 → 收进悬停；
  // 「只读面板/请在游戏内操作」类常驻声明条 → 删或挪 title（口径句保住钉）
  const quest = fs.readFileSync(new URL('../src/renderer/modules/qn.ts', import.meta.url), 'utf8')
  const combat = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  assert.match(quest, /距刷新 \$\{fmtDurationLong\(item\.reset\)\}/)
  assert.doesNotMatch(quest, /data-cdl="\$\{item\.reset\}"/)
  assert.doesNotMatch(combat, /class="bfoot"/)
})

test('quit guard kills harvested renderer pids at the very last moment of a normal exit', () => {
  // 2026-08-19 用户实锤第三种残留：主进程正常退出、卡死的游戏渲染进程成孤儿——
  // 旧防线（主进程卡住才 taskkill 的 4 秒兜底 + 下次启动清扫）都罩不住。
  // 修法：退出前收割渲染 PID，'quit' 事件（主进程最后一刻）同步强杀，
  // 只杀「收割过 ∩ 此刻仍是同映像」的，防 PID 复用误杀。
  //
  // ⚠ 2026-08-20 第四种形态：上面那套写完之后**一枪没开过**。在打包产物上开
  // KANSO_QUIT_TRACE 实测：关窗退出时 before-quit 才触发，窗口与 webview guest 的
  // webContents 早已销毁，`getAllWebContents()` 返回空数组，收割集空 → 'quit' 里
  // 第一行就 return。所以 PID 必须**在渲染进程出生时**记下，不能等退出时现问。
  // 这几条只钉源码形状，真正的判据在 `npm run quit:e2e`（打包产物 + 真关窗）。
  const guard = fs.readFileSync(new URL('../src/main/quit-guard.ts', import.meta.url), 'utf8')
  assert.match(guard, /const harvestRendererPids = /)
  assert.match(guard, /contents\.getOSProcessId\(\)/)
  // 出生即记：这是第四种形态的修复点，退出时再问谁都问不到
  assert.match(guard, /app\.on\('web-contents-created', \(_event, contents\) => \{/)
  assert.match(guard, /contents\.on\('dom-ready', again\)/)
  // Chromium 自己那本子进程账（webContents 销毁后它还认得一阵子）也当一个源
  assert.match(guard, /app\.getAppMetrics\(\)/)
  assert.match(guard, /app\.on\('quit', \(\) => \{/)
  assert.match(guard, /\[\.\.\.rendererPids\]\.filter\(\(pid\) => alive\.has\(pid\)\)/)
  // 开火不等于打死：值得报警的是「杀了还没死」，正常退出不刷日志
  assert.match(guard, /仍有 \$\{stubborn\.length\} 个没死/)
  // 4 秒兜底走的是 taskkill 自杀整树，'quit' 不会触发——那条路上也得自己开枪
  assert.match(guard, /terminateSurvivors\('兜底'\)/)
  // 启动清残留一旦真清到了东西，就说明上一次退出漏了孤儿：这条必须落盘留证
  assert.match(guard, /启动时清掉上次残留的 \$\{stale\.length\} 个同映像进程/)
  // 旧的两条防线保留（主进程卡死兜底 + 启动清扫），不许因为新防线把它们拆了
  assert.match(guard, /killOwnProcessTree\(\)/)
  assert.match(guard, /export const reapOrphanKansoProcesses = /)
})

test('fleet equip strip shows empty slots with capacity hover and marks an open ex slot', () => {
  // 2026-08-19 用户点的：空装备格也要占位（悬停看该格搭载数）；
  // 补强增设开了没装用小标记（api_slot_ex 的 -1 = 开了没装，0 = 未开）
  const fleet = fs.readFileSync(new URL('../src/renderer/modules/ru.ts', import.meta.url), 'utf8')
  const html = rendererSource
  assert.match(fleet, /class="equip-icon eq-empty" title="第 \$\{i \+ 1\} 格 · 空\$\{capText\}"/)
  // 扩过的格写「原量+增量（道具正名）」：原量来自主数据 maxEq，增量是格納庫増設抬高的
  // 部分；没扩过的格照旧只写一个数。拼出来的 title 长什么样由 hangar-expand 那组
  // 行为级护栏对着产物 HTML 钉（正则分不出加法的两截有没有取反）。
  assert.match(fleet, /const cap = master\?\.maxEq\?\.\[i\] \?\? 0/)
  assert.match(fleet, /const extra = hangarExpansionOf\(ship\.id, i\)/)
  assert.match(fleet, / · 搭载上限 \$\{cap\}\+\$\{extra\}（格納庫増設）/)
  assert.match(fleet, / · 搭载 \$\{cap\}/)
  assert.match(fleet, /ship\.slotEx === -1/)
  assert.match(fleet, /eq-ex-mark" title="补强增设已开 · 未装备"/)
  assert.match(html, /\.fleet-skin \.eq \.eq-empty \{/)
  assert.match(html, /\.fleet-skin \.eq \.eq-ex-mark \{/)
})

test('battle-count estimates read the current fleet: TC bonus reapplied, flagship 1.5x, MVP still out', () => {
  // 2026-08-19 用户提问「能识别队里有没有练巡、在不在旗舰位吗」→ 两头改：
  // 账本把演习样本按**当场**练巡配置归一成无加成基线（不归一会与当前系数重复计算），
  // 显示层再按**当前编成**把练巡系数（仅演习）与旗舰 ×1.5 乘回去；MVP 无法预判仍不计入。
  const ledger = fs.readFileSync(new URL('../src/main/mg/ledger.ts', import.meta.url), 'utf8')
  const main = fs.readFileSync(new URL('../src/main/mg/index.ts', import.meta.url), 'utf8')
  const fleet = fs.readFileSync(new URL('../src/renderer/modules/ru.ts', import.meta.url), 'utf8')
  const combat = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  const shared = fs.readFileSync(new URL('../src/shared/practice-exp.ts', import.meta.url), 'utf8')

  assert.match(shared, /export const trainingCruiserSetup = /)
  // 账本侧：从快照 fShips 还原当场配置并除掉；拿不到舰种表就不动样本
  assert.match(ledger, /queryExpSamples = \(stypeOf\?:/)
  assert.match(ledger, /if \(practice && stypeOf\)/)
  assert.match(ledger, /Math\.round\(gained \/ tcDivisor\)/)
  assert.match(ledger, /tcNormalized: bucket\.tc/)
  assert.match(main, /ledger\.queryExpSamples\(\(mstId\) => store\.getState\(\)\.master\.ships\[mstId\]\?\.stype \?\? null\)/)
  // 显示侧：练巡只乘演习行，旗舰 ×1.5 通用；MVP 保持不计入
  assert.match(fleet, /\(row\.practice && tc \? 1 \+ tc\.bonusPct \/ 100 : 1\) \* \(isFlagship \? 1\.5 : 1\)/)
  // 2026-08-26 文案清扫：「已按当前第 N 舰队编成调整：…」的前缀与「MVP ×2 无法预判，
  // 不计入」那半句删了（族 7 UI 自我解说 / 族 3）。两件事照钉不误：加成逐条列出来，
  // 且乘的只有练巡与旗舰位这两项——MVP 不进 factorOf 就是「不计入」的硬证据。
  assert.match(fleet, /练巡 \$\{TC_PLACEMENT_LABEL\[tc\.placement\] \?\? tc\.placement\} Lv\$\{tc\.level\} → \+\$\{tc\.bonusPct\}%/)
  assert.match(fleet, /isFlagship \? '本舰在旗舰位 ×1\.5' : ''/)
  assert.doesNotMatch(fleet, /const factorOf = [\s\S]{0,200}mvp/i, 'MVP ×2 不许混进场次换算')
  // 2026-08-19 追加：活动图桶整体不参与（活动结束点位就消失），
  // 提示里放社区常用练级点静态参考（不硬造数字）。2026-08-20 第二批文案清扫把
  // 出处署名（zh.kcwiki 练级指南）从这句里撤了，静态清单本身必须还在。
  assert.match(fleet, /row\.practice \|\| !isEventMapArea\(mapAreaOf\(row\.map\)\)/)
  assert.match(fleet, /COMMUNITY_LEVELING_SPOTS/)
  assert.match(fleet, /社区常用练级点/)
  // 只看渲染那一行（源码注释里记着出处是对的，不该被这条护栏误伤）
  const levelingLine = fleet.match(/.*社区常用练级点：.*/)?.[0] ?? ''
  assert.ok(levelingLine, '社区常用练级点那一行该还在')
  assert.doesNotMatch(levelingLine, /kcwiki|wikiwiki/, '发布侧署名不该回潮')
  assert.match(fleet, /5-2 B\/C 空袭点/)
  // di 的演习预测卡与 ru 共用同一份配置判定，不再各写各的
  assert.match(combat, /trainingCruiserSetup\(/)
})

test('practice opponent selection immediately opens a legacy-safe prebattle forecast', () => {
  const types = fs.readFileSync(new URL('../src/shared/mg-types.ts', import.meta.url), 'utf8')
  const store = fs.readFileSync(new URL('../src/main/mg/store.ts', import.meta.url), 'utf8')
  const forecast = fs.readFileSync(new URL('../src/renderer/combat-forecast.ts', import.meta.url), 'utf8')
  const combat = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  const html = rendererSource

  assert.match(types, /export interface PracticeOpponentPreview/)
  assert.match(types, /practiceOpponent\?: PracticeOpponentPreview \| null/)
  assert.match(types, /maxHoug: number/)
  const reducer =
    store.match(/'\/kcsapi\/api_req_member\/get_practice_enemyinfo'[\s\S]*?return \['sortie'\]/)?.[0] ?? ''
  assert.match(reducer, /body\.api_deck\.api_ships/)
  assert.match(reducer, /api_ship_id/)
  assert.match(reducer, /api_level/)
  assert.doesNotMatch(reducer, /api_slotitem|api_cmt|api_enemy_comment/)
  assert.match(store, /practiceOpponent,\s*\}\)/)

  assert.match(forecast, /export const forecastPracticeOpponent/)
  assert.match(forecast, /const enemyFormations = \[1, 2, 3, 4, 5\]/)
  assert.match(forecast, /\[enemyMin, enemyMax\]\.flatMap/)
  assert.match(forecast, /forecastFleetForDeck\(deckId, 0, false\)/)
  // 口径已变（2026-08-10）：对手默认按通用配装（初期装备）建模，不再裸装——
  // 具体断言见「演习对手不按裸装建模」那条测试
  assert.match(forecast, /stockEquipmentFor/)
  assert.match(combat, /practiceOpponentPreviewHtml/)
  assert.match(combat, /activateModule\('di'\)/)
  // 2026-08-19 文案体检：预览态页脚声明条（被动只读/开战自动切换）随「常驻声明
  // 悬停化」口径一并撤下——切换行为本身由 verdictHtml 的实时态呈现，无需预告
  // 2026-08-20 发布侧文案清理：「为什么显示区间」整块（practice-preview-caveat）已删。
  // 「演习不给大破率」这条口径没丢，它现在长在预测格自己身上——那一格出「—」并写明原因。
  assert.match(combat, /<span>大破率<\/span><b>—<\/b><em>演习不结算战损<\/em>/)
  assert.match(html, /\.mod-di \.practice-preview-body/)
})

test('combined fleet formation updates the fleet view without waiting for port', () => {
  const store = fs.readFileSync(new URL('../src/main/mg/store.ts', import.meta.url), 'utf8')
  const main = fs.readFileSync(new URL('../src/main/mg/index.ts', import.meta.url), 'utf8')
  const fleet = fs.readFileSync(new URL('../src/renderer/modules/ru.ts', import.meta.url), 'utf8')

  const reducer =
    store.match(/'\/kcsapi\/api_req_hensei\/combined'[\s\S]*?return \['decks'\]/)?.[0] ?? ''
  assert.match(reducer, /body\?\.api_combined/)
  assert.match(reducer, /post\?\.api_combined_type/)
  assert.match(reducer, /combinedFleetTypeFromMutation\(/)
  assert.match(reducer, /state\.player\.combinedFlag/)
  assert.doesNotMatch(store, /api_req_kaisou\/deck_combined/)
  assert.match(main, /patch\.combinedFlag = state\.player\.combinedFlag/)
  assert.match(fleet, /keys\.some\(\(k\) => \[[\s\S]*?'decks'/)
})

test('atomic JSON writes replace an existing Windows file cleanly', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-atomic-'))
  const file = path.join(dir, 'state.json')
  try {
    atomicWriteJsonSync(file, { version: 1 })
    atomicWriteJsonSync(file, { version: 2, complete: true })
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { version: 2, complete: true })
    assert.deepEqual(fs.readdirSync(dir), ['state.json'])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('舰娘列表点行进入整面板接管的单独界面，不是行下展开也不是侧栏', () => {
  // 用户 2026-08-11 当场否掉下接式：「我不是说进入单独界面显示吗？怎么还是
  // 下接式的」。宽窄两种版式一律接管：列表与详情二选一渲染，返回键成对。
  const roster = fs.readFileSync(new URL('../src/renderer/modules/qa.ts', import.meta.url), 'utf8')
  const html = rendererSource
  // 渲染分支：选中即整面板换成详情页，列表分支里不再有任何预览挂点
  assert.match(roster, /const detailRow = all\.find\(\(r\) => r\.ship\.id === state\.selected\)/)
  assert.match(roster, /commitPaneHtml\(pane, 'qa', detailHtml\(detailRow\)\)/)
  assert.doesNotMatch(roster, /qa-row-preview/)
  assert.doesNotMatch(roster, /previewBody/)
  assert.doesNotMatch(html, /qa-row-preview/)
  assert.doesNotMatch(html, /\.mod-qa[^\n]*\.preview/)
  // 返回：按钮 + Esc 同义（输入框里的 Esc 不劫持），回列表后还原进详情前的滚动位置。
  // 2026-08-16 用户实锤：不能追着那一行滚——详情里收藏/取消收藏会改她的位次，
  // 追行会把视口带去她的新位置（顶端取消收藏后返回翻到一页外）。
  assert.match(roster, /data-act="dv-back"/)
  assert.match(roster, /e\.key !== 'Escape' \|\| e\.defaultPrevented/)
  assert.match(roster, /active instanceof HTMLInputElement \|\| active instanceof HTMLTextAreaElement/)
  // 捕获与还原必须打在**当前布局真正在滚**的那个容器上：宽态是 .twrap，
  // 窄态 CSS 把 .twrap 设成 overflow:visible、改由 .qa-app 整页滚。
  // 一律写死 .twrap 的话，窄布局里捕获拿到 0、还原写进一个不滚的元素，
  // 「详情→返回」永远回顶部——正是上面那条注释要防的症状。
  assert.match(roster, /listScrollTop = listScrollerOf\(\)\?\.scrollTop \?\? 0/)
  assert.match(roster, /const scroller = listScrollerOf\(\)/)
  assert.match(roster, /scroller\.scrollTop = listScrollTop/)
  assert.match(roster, /pane\.classList\.contains\('narrow'\)\s*\?\s*\['\.qa-app', '\.twrap'\]/)
  assert.match(roster, /element\.scrollHeight > element\.clientHeight/)
  assert.doesNotMatch(roster, /scrollIntoView\(\{ block: 'center' \}\)/)
  // 被看的实例离开仓库时退回列表，不留一页空详情
  assert.match(roster, /if \(state\.selected && !all\.some\(\(r\) => r\.ship\.id === state\.selected\)\) state\.selected = 0/)
  // Shift 对比 / Alt 钉窗两条老路径要写在打开详情之前，不能被它吃掉
  const clickHandler = roster.slice(roster.indexOf("pane.querySelector('tbody')?.addEventListener"))
  const openAt = clickHandler.indexOf('detailEnter = true')
  assert.ok(openAt > 0, '列表缺少打开详情的入口')
  assert.ok(clickHandler.indexOf('me.altKey') < openAt, 'Alt 钉窗要先于打开详情')
  assert.ok(clickHandler.indexOf('me.shiftKey') < openAt, 'Shift 对比要先于打开详情')
  // 详情页里有装备清单——「装备给予」条的来源要能就地对读
  assert.match(roster, /equipLinesHtml\(ship\)/)
  assert.match(roster, /dv-eq-empty">未装备/)
  // 外部定位入口直接打开单独界面（不再滚列表行）
  assert.match(roster, /state\.selected = rosterId\s+detailEnter = true\s+render\(\)/)
})

test('演习名簿与建造坞不再只活在悬停文本里', () => {
  const combat = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  const header = fs.readFileSync(new URL('../src/renderer/header-status.ts', import.meta.url), 'utf8')
  const notices = fs.readFileSync(new URL('../src/renderer/modules/lg.ts', import.meta.url), 'utf8')
  const html = rendererSource

  // 演习名簿摆在镝的空闲态：五个对手要看得到军衔/等级/旗舰/打没打
  assert.match(combat, /const practiceRosterHtml = /)
  assert.match(combat, /\$\{practiceRosterHtml\(\)\}/)
  assert.match(combat, /entry\.state !== 0/, '打没打要按 state 判')
  assert.match(combat, /nextJstTime\(\[3, 15\]\)/, '演习一天刷两次，倒计时不能写死一次')
  // 快照属于上一轮刷新周期时必须标出来，不能拿旧名簿冒充当前的
  assert.match(combat, /snapshot\.ts > reset - 12 \* 3600000/)
  // 「挑谁打在游戏里点，这里只记录」2026-08-26 按族 2（自证清白）删了。
  // 只读纪律改钉结构：名簿行是纯展示 div，没有任何可点的动作钮，也不发演习请求。
  assert.match(combat, /<div class="prac-row\$\{beaten \? ' done' : ''\}">/)
  assert.doesNotMatch(combat, /api_req_practice/, 'di 不许对演习发游戏请求')
  assert.match(html, /\.mod-di \.prac-card \{/)

  // 建造坞此前在界面上完全没有入口——连 timerInfo 里那条 kdock 分支都没人触发
  assert.match(header, /const buildDocksHtml = /)
  assert.match(header, /\$\{buildDocksHtml\(\)\}/)
  assert.match(header, /data-timer="kdock:\$\{dock\.id\}"/, '要让 kdock 的计时定位路径真的活起来')
  assert.match(header, /dock\.state === 3/, '完成待领要与建造中分开')
  // 大型/通常建造的阈值必须与铭里算高速建造材那处同一条，不能两处各用一个数
  assert.match(header, /dock\.recipeFuel > 1000/)
  const store = fs.readFileSync(new URL('../src/main/mg/store.ts', import.meta.url), 'utf8')
  assert.match(store, /dock\.recipeFuel > 1000 \? 10 : 1/)
  // 建造坞可预览：芯片本身就是 EntityLink（peek 只认 .el + data-etype）
  assert.match(header, /class="el hs-chip build \$\{cls\}" data-etype="kdock"/)
  assert.match(header, /registerEntityRoute\('kdock'/)
  assert.match(header, /抢完需高速建造材 ×\$\{large \? 10 : 1\}/)

  // 不剧透建造结果：**默认关**，由钥的开关统一控制预览卡与通知，口径只有一处。
  assert.match(notices, /前往工厂接收/)
  // 初值自己从 config 读（钥装配失败时用户设置不该静默失效），默认仍是关
  assert.match(
    notices,
    /let buildSpoilerEnabled = Boolean\(config\.get\('kanso\.buildSpoiler', false\)\)/,
    '提前显示建造结果必须默认关，且初值不能只等钥推送',
  )
  assert.match(notices, /const spoil = buildSpoilerEnabled && dock\.createdShipId > 0/)
  // 门禁只有一处：舰名和「点通知跳到哪」同开同关。只挡名字不挡 ref 的话，
  // 点一下 Toast 就直接落到那艘舰的图鉴，等于把答案递到脸上。
  assert.match(notices, /spoil \? \{ type: 'mstShip', id: dock\.createdShipId \} : undefined/)
  // 2026-08-12 起预览卡的剧透扩到建造中(带小头像),门仍是同一个开关
  assert.match(header, /isBuildSpoilerEnabled\(\) && dock\.state >= 2 && dock\.createdShipId > 0/)
  const settings = fs.readFileSync(new URL('../src/renderer/modules/yu.ts', import.meta.url), 'utf8')
  assert.match(settings, /config\.get\('kanso\.buildSpoiler', false\)/)
  assert.match(settings, /'提前显示建造结果'/)
  // 抬头待领芯片默认写「待领」(2026-08-16 空闲态两字宽后跟进,状态词与
  // 任务「待领取」同一套话);剧透开关开着时换成所造舰娘名字头两个字
  // (2026-08-12 用户定的),开关关着绝不带出名字
  assert.match(header, /esc\(spoiledChar \|\| '待领'\)/)
  assert.match(header, /isBuildSpoilerEnabled\(\) && dock\.createdShipId > 0/)
})

test('演习预测面板与出击面板吃同一套层，不能只给出击那格', () => {
  const combat = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  // 演习也有夜战、也吃弾着観測与先制对潜；这两块此前只加在了出击的机制估算面板上
  assert.match(combat, /nightForecastHtml\(forecast\.band, false\)/)
  assert.match(combat, /forecastLayersHtml\(s, forecast\.band, null, \[\]\)/)
  // 演习 HP 最低保留 1、不存在真实击沉，大破那格按该面板既有口径不给数
  assert.match(combat, /演习不结算战损/)
  // 原来钉的是 practice-preview-caveat 里的预告（该块已按文案裁定整块删）。
  // 改钉这条口径的实现开关：nightForecastHtml 的 showTaiha 默认 true，
  // 演习分支显式传 false，才会落到「—」那格。
  assert.match(combat, /const nightForecastHtml = \(band: EncounterForecastBand, showTaiha = true\)/)
  assert.match(combat, /nightForecastHtml\(forecast\.band, false\)/)
  // 出击那格照旧三项都给
  assert.match(combat, /\$\{nightForecastHtml\(band\)\}/)
})

test('托盘只做入口，不改默认的退出语义、也不自己判定未读与勿扰', () => {
  const tray = fs.readFileSync(new URL('../src/main/tray.ts', import.meta.url), 'utf8')
  const main = fs.readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
  const notifications = fs.readFileSync(new URL('../src/renderer/modules/lg.ts', import.meta.url), 'utf8')
  const settings = fs.readFileSync(new URL('../src/renderer/modules/yu.ts', import.meta.url), 'utf8')

  // ✕ 的语义默认不变：悄悄把「关闭」变成「隐藏」，用户会以为已经退出，
  // 实际进程还占着账本与登录态。要改必须在钥里显式打开。
  assert.match(tray, /config\.get\('kanso\.tray\.closeToTray', false\)/)
  assert.match(tray, /config\.get\('kanso\.tray\.minimizeToTray', false\)/)
  assert.match(settings, /'kanso\.tray\.closeToTray'/)
  assert.match(settings, /关闭：✕ 退出程序 · 开启：✕ 收起窗口，托盘菜单退出/)

  // 托盘让进程在窗口关闭后继续活着；冒烟就永远等不到退出
  assert.match(tray, /if \(process\.env\.KANSO_SMOKE \|\| !trayEnabled\(\)\) return/)

  // 未读与勿扰的判定都归铃，托盘只显示。两处各存一份就会互相打架。
  assert.match(notifications, /void pushTrayUnread\(unread\)/)
  assert.match(notifications, /const syncTrayDnd = \(\) => void pushTrayDnd\(dndActive\(\)\)/)
  assert.match(tray, /getWindow\(\)\?\.webContents\.send\('tray:toggle-dnd'\)/)
  assert.doesNotMatch(tray, /new Notification|displayBalloon/)

  // 退出中必须放行 close，否则「退出艦素」会被隐藏逻辑吃掉，永远退不掉
  assert.match(tray, /if \(quitting \|\| !closeToTray\(\)\) return false/)
  assert.match(tray, /app\.on\('before-quit', \(\) => \{\s*quitting = true/)

  // 'minimize' 不带 event，没有 preventDefault 可用——写了也是错觉
  assert.match(main, /win\.on\('minimize', \(\) => handleWindowMinimize\(win\)\)/)

  // 收进托盘后 renderer 的 window.focus() 是无效的，通知点开要走主进程 show()
  assert.match(notifications, /void showMainWindow\(\)/)
  assert.match(main, /ipcMain\.handle\('window:show', \(\) => showMainWindow\(\)\)/)
  assert.match(main, /app\.on\('second-instance', \(\) => showMainWindow\(\)\)/)
})

test('装备有了在籍轴，且与舰娘那一侧同口径', () => {
  const stock = fs.readFileSync(new URL('../src/renderer/modules/equip-stock.ts', import.meta.url), 'utf8')
  const category = fs.readFileSync(new URL('../src/renderer/equip-category.ts', import.meta.url), 'utf8')
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const header = fs.readFileSync(new URL('../src/renderer/header-status.ts', import.meta.url), 'utf8')

  // 一行一个实例。按 mstId 聚合就看不出哪一件动得了。
  assert.match(stock, /Object\.entries\(mg\.slotitems\)\.map/)

  // 陆航必须查。只查舰上会把出击中的攻击机报成「闲置」，用户照着去废弃就拆错了。
  // 判据 2026-08-27 收进 shared/equipped-slots（ji 的改修素材口径共用同一份），
  // 所以「查了陆航」要去那边验；这里验的是「仓库卷确实用的是那一份，没有另抄」。
  // 行为钉子（holder 形状 + 两个消费端的派生式）在 test/equipped-slots.test.mjs。
  const occupied = fs.readFileSync(new URL('../src/shared/equipped-slots.ts', import.meta.url), 'utf8')
  assert.match(occupied, /for \(const squad of airBases\)/)
  assert.match(occupied, /kind: 'airBase'/)
  assert.match(stock, /equipHolderMap\(Object\.values\(mg\.ships\), mg\.airBases\)/)
  assert.doesNotMatch(stock, /kind: 'airBase'/, '判据不许在消费方另抄一份')
  assert.match(stock, /spare: holder\.kind === 'idle' && !inst\.locked/)

  // 分类口径只有一份：两处各写一份会出现「图鉴归电探、仓库归其他」
  assert.match(category, /EQUIP_CHIP_TYPES/)
  assert.match(stock, /from '\.\.\/equip-category'/)
  assert.match(catalog, /from '\.\.\/equip-category'/)
  assert.doesNotMatch(stock, /const EQUIP_CHIP_TYPES/)
  assert.doesNotMatch(catalog, /const EQUIP_CHIP_TYPES/)

  // 非舰载机的 alv 恒为 0，显示成 0 会被读成「熟练度是零」
  assert.match(category, /export const isAirborneEquip/)
  // 判据 2026-08-23 从静态类别白名单换成主数据推导（`airborneEquipTypesOf`，见 equip-category
  // 的注释与 test/equip-category.test.mjs）——集合在装配期算一次，渲染只查表
  assert.match(stock, /if \(!isAirborneEquip\(row\.type2, airborneTypesNow\(\)\)\) return '<span class="es-dim">—<\/span>'/)
  assert.match(stock, /const airborneTypesNow = \(\): ReadonlySet<number> => \{/)
  assert.doesNotMatch(stock, /const AIRBORNE|EQUIP_CHIP_TYPES\.舰载机/, '判据不许在消费方另抄一份')

  // 抬头两格对称：舰娘进清理视图，装备也该进清理视图而不是图鉴
  assert.match(catalog, /open: openEquipCleanup,/)
  assert.match(catalog, /primary: '装备仓库 · 清理视图',/)
  assert.match(header, /点击打开装备仓库/)

  // 跳转带来的临时视图不能写进持久化，否则从抬头点过一次就永久改了默认筛选
  const cleanup = stock.slice(stock.indexOf('export const openEquipCleanup'), stock.indexOf('export const mountStockView'))
  assert.doesNotMatch(cleanup, /saveView\(\)/)

  // 不代操作：废弃/改修/卸装都在游戏里做
  // 「废弃与改修请在游戏里操作」那句是能力边界表白，按文案清扫裁定（族 2）删。
  // 它护的是「艦素不代操作」这条真行为——那条行为的钉子本来就是下面这一行，
  // 措辞没了它照旧红：只要有人接了废弃接口就当场失败。
  assert.doesNotMatch(stock, /api_req_kousyou\/destroyitem/)
})

test('远征编成不再先到先得，多队一起凑', () => {
  const planner = fs.readFileSync(new URL('../src/renderer/modules/bi.ts', import.meta.url), 'utf8')
  const matcher = fs.readFileSync(new URL('../src/shared/slot-matching.ts', import.meta.url), 'utf8')

  // 逐条要求 first-fit 是那个「有解却报无解」的根：一条要求把稀缺舰种吃光，
  // 后一条就凑不出，而换个分法明明可行。现在走真正的匹配。
  assert.match(planner, /matchSlots\(slots, pool, \(slot, ship\) => slot\.accepts\(ship\)\)/)
  assert.match(matcher, /export const matchSlots =/)
  assert.match(matcher, /augment\(current, seen\)/)
  assert.doesNotMatch(planner, /for \(const s of pool\) \{\s*if \(have >= req\.count\) break/)

  // 多队必须拼成一张图跑同一次匹配。一队一队地凑，先凑好的会把人吃光。
  assert.match(planner, /const allSlots = groups\.flatMap\(\(g\) => g\.slots\)/)
  assert.match(planner, /const holder = matchPlanSlots\(allSlots, pool\)/)
  assert.match(planner, /一队一队地凑是错的/)

  // 凑 Lv 不能为了数字破坏舰种条件
  assert.match(planner, /slots\[i\]\.accepts\(s\)/)

  // 抬练度时「谁被占了」必须看**整张** holder。只看本队那一段的话，
  // 几支队会各自把同一艘低练舰抓走，界面还照报「互不抢人」。
  assert.match(planner, /const busy = new Set\(holder\.filter\(Boolean\)\.map\(\(s\) => s!\.id\)\)/)
  assert.doesNotMatch(planner, /const view = holder\.slice\(/)
  assert.match(planner, /liftFleetLevel\(allSlots, holder, pool, group\.exped\.wiki\.fleetLv, offset, offset \+ span\)/)

  // 匹配只保证舰种与旗舰 Lv；合计 Lv、属性合计这些总量门槛要靠换人抬，
  // 否则方案自带一个 ✗。抬不动就如实报「仍差 N 项」，不假装凑齐。
  assert.match(planner, /const liftToPass = /)
  assert.match(planner, /checkShips\(e, segment\(\)\)\.fails/)
  assert.match(planner, /const CANDIDATE_SCAN = /)
  assert.match(planner, /const LIFT_ROUNDS = /)

  // 界面既然承诺「互不抢人」，就真验一次，别信算法
  assert.match(planner, /const clash = picked\.length !== new Set\(picked\)\.size/)
  // 「人凑得出」不等于「条件过得了」——只查前者会让尾注和逐队判定自相矛盾
  assert.match(planner, /const failing = plans\.filter\(\(p\) => p\.verdict\.fails > 0\)/)
  assert.match(planner, /条件满足 · 无舰娘冲突/)

  // 旗舰仍必须落在首位（判定按 ships\[0\] 认旗舰）
  assert.match(planner, /const flagIdx = picks\.findIndex\(\(p\) => p\.role === '旗舰'\)/)

  // 只读建议这条纪律没变。2026-08-26 文案清扫删了「编成与装备请在游戏内操作，这里只提供
  // 建议」这句只读表白（族 A 能力边界），纪律本身改钉实现：这一卡只出 HTML 与本地偏好，
  // 全模块不发任何编成写回请求。
  assert.doesNotMatch(planner, /api_req_hensei/, 'bi: 推荐编成方案不许真去改游戏编成')
  assert.match(planner, /title="为出击保留主力"/)
})

test('编成能与社区格式互通，但导入只作对照（审计 C5）', () => {
  const codec = fs.readFileSync(new URL('../src/shared/deck-builder.ts', import.meta.url), 'utf8')
  const fleet = fs.readFileSync(new URL('../src/renderer/modules/ru.ts', import.meta.url), 'utf8')

  // 两个 id 的类型是反的，抄错一个就跟社区工具对不上。
  // 上游 gist 明写舰娘 id 带引号、装备 id 不带；2026-08-08 逐字核过。
  assert.match(codec, /id: `\$\{ship\.mstId\}`/)
  assert.match(codec, /id: item\.mstId/)
  assert.match(codec, /https:\/\/gist\.github\.com\/YSRKEN/)

  // 野外 rf 有数字也有字符串、mas 文档写字符串而官方示例给数字 —— 读必须两种都吃
  assert.match(codec, /const numOf = \(value: unknown\)/)
  assert.match(codec, /读要宽、写要定一种/)

  // -1 是「未指定」，0 是「运真的是零」。混掉会把未知报成事实。
  assert.match(codec, /Math\.round\(numOf\(obj\.luck\) \?\? -1\)/)

  // 读不出来就明说，不返回空编成冒充成功
  assert.match(codec, /error: '不是合法的 JSON/)
  assert.match(codec, /未读取到舰队/)

  // 载入链接带着用户的编成数据：只进剪贴板，不主动打开外部站点
  assert.match(codec, /只把它放进剪贴板/)
  // 那两句自表白（「艦素不会自己打开它」「这是只读对照」）2026-08-26 按族 2 删了。
  // 它们守的事一直由上下这两条结构护栏真正守着：不开外链、不发编成请求——不放松。
  assert.doesNotMatch(fleet, /shell\.openExternal|window\.open/)

  // 导入不能落地：艦素不代操作游戏
  assert.doesNotMatch(fleet, /api_req_hensei/)

  // 五格舰（大和改二）：格式层放开到 i5 的行为测试在 deck-builder.test.mjs；
  // 这里钉展示端——「增」的位置随常规格数走，写死 4 会把第 5 格标成增设
  assert.match(fleet, /index === ship\.slots\.length \? '增' : index \+ 1/)
  assert.doesNotMatch(fleet, /index === 4 \? '增'/)
})

test('锱曲线补上悬停读数与拖选区间（审计 C3）', () => {
  const trend = fs.readFileSync(new URL('../src/renderer/resource-trend-window.ts', import.meta.url), 'utf8')

  // 净变化取区间两端的**余额差**。账本记的是余额快照，把中间收支相加会重复计。
  assert.match(trend, /const start = rowAt\(from\)/)
  assert.match(trend, /const end = rowAt\(to\)/)
  assert.match(trend, /cells\(end, start\)/)
  assert.match(trend, /不是把中间的收支相加/)

  // 阶梯曲线取「不晚于该时刻的最后一条」，不是最近的一条
  assert.match(trend, /if \(row\.ts > ts\) break/)

  // 鼠标移动**不能**走 render()：那会换掉 SVG 节点，拖到一半浏览器追踪的元素就没了
  // （实测拖选完全不生效，脱离文档的节点 getBoundingClientRect 全是 0）
  assert.match(trend, /const paintPointer = \(\)/)
  const pointer = trend.slice(trend.indexOf('const wireChartPointer'), trend.indexOf('const render ='))
  assert.doesNotMatch(pointer, /\brender\(\)/)
  assert.match(pointer, /paintPointer\(\)/)

  // client 坐标要按实际渲染宽度换算回 viewBox，直接用 offsetX 会整体偏移
  assert.match(trend, /const viewX = \(\(clientX - rect\.left\) \/ rect\.width\) \* 620/)

  // 整块重建后要把准星/选区补回去，否则切量程会把框选抹掉
  assert.match(trend, /wireChartPointer\(\)\s*\n\s*\/\/[^\n]*\n\s*paintPointer\(\)/)
})

test('札只报事实，不替玩家判「能不能进」', () => {
  const fleet = fs.readFileSync(new URL('../src/renderer/modules/ru.ts', import.meta.url), 'utf8')
  const lock = fs.readFileSync(new URL('../src/shared/sally-lock.ts', import.meta.url), 'utf8')
  const store = fs.readFileSync(new URL('../src/main/mg/store.ts', import.meta.url), 'utf8')
  const types = fs.readFileSync(new URL('../src/shared/mg-types.ts', import.meta.url), 'utf8')

  // 「能不能进」拿不到判据，所以不判。札绑在**阶段**上、还分编成类型、
  // 有些图明确允许几种札混用（E-1/E-2/E-3），而没有血条的阶段根本不下发 API。
  assert.match(lock, /札绑的是\*\*阶段\*\*不是图|札绑在\*\*阶段\*\*上/)
  assert.match(lock, /没有血条的阶段根本不下发 API/)
  assert.match(lock, /允许几种札混用/)
  assert.doesNotMatch(lock, /kind: 'conflict'/)
  assert.doesNotMatch(fleet, /札冲突/)
  assert.doesNotMatch(fleet, /进不去同一张|进不了/)

  // 查不查札认游戏的 limit_flag：低难度不锁与通关解锁都反映在它上面
  assert.match(types, /limitFlag: number \| null/)
  assert.match(store, /limitFlag: raw\.api_eventmap\?\.api_limit_flag \?\? null/)
  assert.match(lock, /gauge\.limitFlag === 1/)
  assert.match(lock, /通关后不再查札|通关之后不再查札|b 图通关之后不再查札/)
  assert.match(fleet, /当前不查札/)
  assert.match(fleet, /gauge\.cleared \? '已通关' : '未通关'/)

  // null/undefined 是「还没读到 mapinfo」，不等于 0——未知不能当成「不拦」
  assert.match(lock, /gauge\.limitFlag != null/)
  assert.match(fleet, /札限制未知/)

  // 打札与查不查札无关：丙难度实测照打，且不可逆
  assert.match(lock, /打札与查札无关/)
  // 「（丙难度实测照打，不因为不查札就不打）」这句括注 2026-08-26 按族 3 删了。
  // 「无关」这件事改钉结构：无札艘数的挂牌尾巴与 willTag 都不看 verdict.kind，
  // 查札/不查札/未知三支都照挂——比钉那句括注硬。
  assert.match(fleet, /const tail = verdict\.untagged \? ` · \$\{verdict\.untagged\} 艘将被打札` : ''/)
  assert.match(fleet, /const willTag = verdict\.untagged\s*\n\s*\? `\\n\$\{verdict\.untagged\} 艘无札 · 出击后永久打札`/)
  assert.match(fleet, /永久打札/)

  // 按札分组的名单铎里已经有了，锐不重复列，只给跳转
  assert.match(fleet, /按札分组的完整名单见「活动」/)
  assert.match(fleet, /data-sally-jump/)
  const roster = fs.readFileSync(new URL('../src/renderer/modules/du.ts', import.meta.url), 'utf8')
  assert.match(roster, /锁船标签（札）/)

  // 判断要靠攻略表，出处得挂上（「谁说的」）
  assert.match(fleet, /zh\.kcwiki\.cn/)

  // 面板与出击提醒共用同一个判定，两处各判一次迟早说法打架
  assert.match(fleet, /const currentSallyVerdict = /)
  // 「哪些活动区还在进行」的判据在 shared 里，有独立的行为测试；
  // 这里只钉「渲染层确实用了它、没自己再判一遍」
  assert.match(fleet, /activeEventAreaIds\(mg\.eventAreas\)/)
  assert.doesNotMatch(fleet, /period\.closed/, '判据只应有一份，在 shared/sally-lock')
  // 札只在**打开活动图**时提醒，不再挂在出击海域选择页——那一页不区分你要去哪儿，
  // 去常规图也弹「出击即打札」是假警报（札只在活动图落）。
  const warn = fleet.slice(fleet.indexOf('const warnSortieReadiness'), fleet.indexOf('onSortieScreen('))
  assert.doesNotMatch(warn, /currentSallyVerdict/, '出击前检查里不该再判札')
  assert.doesNotMatch(warn, /limitFlag/)
  const sally = fleet.slice(fleet.indexOf('const warnOnEventMapOpen'))
  assert.ok(sally.length > 200, '取到的开图提醒片段不对')
  assert.match(sally, /currentSallyVerdict\(scopeShips\(deck\)\)/)
  assert.match(sally, /activeAreasNow\(\)\.has\(areaId\)/, '常规图不落札，不该提醒')
  // 陆航跟札同一刻、同一个「点进去之前最后能改」的窗口，写进同一条 toast;
  // 但按**摊开的海区**取数——常规 6/7 区驻队也该提醒,别的区缺补给不掺和
  assert.match(sally, /airBaseReadiness\(areaId\)/, '陆航该按摊开的海区跟札一起挂在开图上')
  // 只说「出击后永久打札」，不说「进不去」——后者要按阶段对照攻略表，游戏不下发那份对照
  assert.match(sally, /出击后永久打札/)
  assert.doesNotMatch(sally, /进不去|不能出击|禁止/)
  assert.match(fleet, /addListener\('kancolle\.map\.open'/)

  // 「打开了哪张海域」kcsapi 不说：选区切区都不发请求，带图号的 api_req_map/start
  // 到手时札已经打上了。信号在静态资源上——打开海域必然取那张图的美术。
  const resource = fs.readFileSync(new URL('../src/main/kcs-resource.ts', import.meta.url), 'utf8')
  assert.match(resource, /\/\^\\\/kcs2\\\/resources\\\/map\\\/\(\\d\{3\}\)\\\/\(\\d\{2\}\)/)
  assert.match(resource, /kancolle\.map\.open/)
  // 只认游戏自己的请求：艦素的海域卷也取同一批 JSON，那不算玩家打开了图
  const openBlock = resource.slice(resource.indexOf('const opened ='), resource.indexOf('kancolle.map.open') + 200)
  assert.ok(
    resource.slice(0, resource.indexOf('const opened =')).lastIndexOf('gameWebContentsId') >
      resource.indexOf('registerKcsResourceProtocol'),
    '要在 gameWebContentsId 的分支里',
  )
  assert.ok(openBlock.includes('areaId'), '广播要带区号')
})

test('发行产物不许指向 tsunkit：整个运行时源码里连一个该站的地址都不许有', () => {
  // 2026-08-22 用户定的口径：**对外请求只许指向游戏自己的服务器**，第三方服务零请求
  //（原话大意「这也算是向外请求，我们最好能做到不额外增加玩家和服务器的负担」）。
  // tsunkit 的社区图标降级是「显式拉取中间路」废弃之前留下的漏网旧物，整条退役。
  //
  // 判据钉在**地址**上而不是「有没有出现 tsunkit 这个词」：
  // `src/shared/lode-ids.ts` 里还有一句「只能从 tsunkit.net 手动导出后放进用户包目录」——
  // 那是给人看的操作说明（KCNav 那份包本来就只能手动导入），删掉反而少了信息。
  // 说明可以留，地址不许有：只要源码里出现一个能被 fetch/img 拿去用的 URL 就红。
  const offenders = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(new URL(`${entry.name}/`, dir))
        continue
      }
      if (!/\.(?:ts|html)$/.test(entry.name)) continue
      const file = new URL(entry.name, dir)
      const text = fs.readFileSync(file, 'utf8')
      for (const match of text.matchAll(/(?:https?:)?\/\/[^\s'"`)]*tsunkit[^\s'"`)]*/gi)) {
        offenders.push(`${file.pathname} → ${match[0]}`)
      }
    }
  }
  walk(new URL('../src/', import.meta.url))
  assert.deepEqual(offenders, [], `运行时源码里出现了指向 tsunkit 的地址：\n${offenders.join('\n')}`)
})

test('矿脉清单与源码实际读取一致，健康度分清「没装」与「上游没有」', () => {
  // 这张表是健康度的判据。改了源码却忘了改表，会让「缺包」漏报或误报，
  // 所以直接从源码把 queryLode/getLode 的实参扫出来逐条核对。
  const ids = fs.readFileSync(new URL('../src/shared/lode-ids.ts', import.meta.url), 'utf8')
  // 条目可能写成一行也可能拆成多行（带 manualOnly 的那种），别要求 `{ id:` 同行
  const declared = [...ids.matchAll(/id: '([a-z0-9-]+)'/g)].map((m) => m[1]).sort()

  const roots = ['../src/renderer', '../src/main']
  const consumed = new Set()
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(new URL(`${entry.name}/`, dir))
      else if (entry.name.endsWith('.ts')) {
        const text = fs.readFileSync(new URL(entry.name, dir), 'utf8')
        for (const m of text.matchAll(/(?:queryLode|getLode)\('([a-z0-9-]+)'/g)) consumed.add(m[1])
      }
    }
  }
  for (const root of roots) walk(new URL(root + '/', import.meta.url))

  assert.deepEqual(declared, [...consumed].sort(), '清单与源码里实际读取的包对不上')

  const health = fs.readFileSync(new URL('../src/shared/lode-health.ts', import.meta.url), 'utf8')
  const settings = fs.readFileSync(new URL('../src/renderer/modules/yu.ts', import.meta.url), 'utf8')

  // 「有这一层但零节点」与「连这一层都没有」必须分开：用户能做的事不一样
  assert.match(health, /empty: EventDifficulty\[\]/)
  assert.match(health, /absent: EventDifficulty\[\]/)
  assert.match(settings, /上游无表/)
  assert.match(settings, /包内缺层/)

  // 日期读不出来时是 null，不是 0——0 会被读成「今天刚更新」。
  // 下载年龄与上游年龄共用同一个换算，所以钉在那个换算上。
  assert.match(health, /return Number\.isFinite\(stamp\) \? [^:]+ : null/)
  assert.match(health, /ageDays: daysSince\(meta\.fetchedAt\)/)
  assert.match(health, /upstreamAgeDays: daysSince\(meta\.upstreamUpdatedAt\)/)
  assert.match(settings, /更新状态未知/)

  // 健康度要看**装配之后**那份目录，不是某一个包的原文。
  // 底座 map-intel 永不随包：拿它当判据会在玩家那份产物上报出「常规海域 0/0」，
  // 而三层汇编其实都在（2026-08-22 发布前验收抓到的大病，根因同 overlay 那处）。
  assert.match(settings, /mapIntelHealth\(mapIntelCatalog\(\)\)/)
  assert.doesNotMatch(settings, /mapIntelHealth\(mapIntelPack/)

  // 拉得回来的和拉不回来的要分开。KCNav 拒绝自动化，对它建议 lodes:fetch
  // 是让人白折腾——这正是这张面板要避免的事。
  assert.match(ids, /manualOnly\?: string/)
  assert.match(ids, /KCNav 拒绝未授权自动化/)
  // 2026-08-23 起「拉得回来」那一档又拆成两半：**不随发行版**（拉一次就有）与
  // **本该随包却不见了**（重装即可）——两者能做的事不同，混着说就是从前那句
  // 「缺 N 包，用到它们的面板会显示待补」。逐条判据与影响文案在 test/lode-health.test.mjs。
  assert.match(
    settings,
    /const selfFetch = missing\.filter\(\(row\) => !manualOnlyReason\(row\.id\) && isSelfFetchLode\(row\.id\)\)/,
  )
  assert.match(settings, /const shouldBeBundled = missing\.filter\(/)
  // 这张卡 2026-08-24 起只在 KANSO_DEBUG_UI=1 下装配（维护者工具，判据在
  // shared/settings-sections 的 DEBUG_ONLY_CARDS，行为级护栏在 test/settings-sections）。
  // 所以卡上出现维护者命令名是对的；这条钉的仍是行为：
  // 拉不回来的那批要单列成「需要手动导入」，并把不能自动的原因原样摊出来。
  assert.match(settings, /const manual = missing\.filter\(\(row\) => manualOnlyReason\(row\.id\)\)/)
  assert.match(settings, /\$\{esc\(row\.id\)\} 需要手动导入/)
  assert.match(settings, /\$\{esc\(manualOnlyReason\(row\.id\) \?\? ''\)\}/)
})

test('编队行的札标记与铎同一套配色，且只在活动期出现', () => {
  const tag = fs.readFileSync(new URL('../src/renderer/sally-tag.ts', import.meta.url), 'utf8')
  const fleet = fs.readFileSync(new URL('../src/renderer/modules/ru.ts', import.meta.url), 'utf8')
  const event = fs.readFileSync(new URL('../src/renderer/modules/du.ts', import.meta.url), 'utf8')
  const html = rendererSource

  // 配色只有一份：两处各写一份，同一个札在两个面板里会是两种颜色，没法对照
  assert.match(tag, /export const TAG_COLORS = \[/)
  assert.match(event, /from '\.\.\/sally-tag'/)
  assert.match(fleet, /from '\.\.\/sally-tag'/)
  assert.doesNotMatch(event, /const TAG_COLORS = \[/)
  assert.match(event, /sallyTagColor\(tag\)/)

  // 只在活动期挂，平时是噪声。札名要按区查，所以带上当前活动区 id
  assert.match(fleet, /\$\{eventRunningNow\(\) \? sallyMarkHtml\(ship\.sallyArea, currentEventAreaId\(\)\) : ''\}/)

  // 贴在血条左边：标记与 .hpbody 同在 .hpc 内，靠 flex 排在前面
  assert.match(fleet, /<div class="hpbody">/)
  assert.match(html, /\.fleet-skin \.hpc \{ display: flex/)

  // 无札要和「已有札」明确分开——出击就会被打上，且不可逆
  assert.match(tag, /sally-mark none/)
  assert.match(html, /\.fleet-skin \.sally-mark\.none/)
  assert.match(tag, /永久获得对应阶段札/)

  // 札名（2026-08-22 起）：游戏一个字都不下发，名字来自第一方每期手录的小表。
  // 表里没有就照旧只显示号——这条回退不许被「顺手编一个」替掉。
  assert.match(tag, /from '\.\.\/shared\/sally-names'/)
  assert.match(tag, /const named = sallyTagNameOf\(areaId, tag\)/)
  assert.match(tag, /查不到就照旧只显示号/)
  // 编号在有名字时也不许丢——攻略表按编号排
  assert.match(tag, /出击识别札 \$\{tag\} · \$\{named\.name\}/)
  assert.match(event, /sallyTagNameOf\(areaId, tag\)/)
  assert.match(event, /札 \$\{tag\}/) // 没录到名字时的回退分支还在（2026-08-24 用词从「标签」统一成「札」）
})

test('装备表定列宽，「锁」不会被长舰名挤出框外', () => {
  const html = rendererSource
  // auto 布局下「所在」会被长舰名撑开，把最右的「锁」推出可视区——
  // 而那一列恰恰是清理时最要看的。实测 178~437px 全宽度都不出框。
  assert.match(html, /\.mod-es \.es-table \{ width: 100%; min-width: \d+px; table-layout: fixed;/)
  assert.match(html, /\.mod-es \.es-table th\.lk, \.mod-es \.es-table td\.lk \{ width: 34px; \}/)
  assert.match(html, /\.mod-es \.es-table td\.nm, \.mod-es \.es-table td\.wh \{ overflow: hidden; text-overflow: ellipsis; \}/)

  // 窄坞里表格横向滚，不去压「装备」那一列（用户拍板：宽表格给 min-width 后横向滚，
  // 绝不裁字段）。实测 437px 左坞下名字列 151px → 238px。
  // 三件缺一不可：表格有下限、滚动容器在、容器的祖先能收缩（否则整块 es-app 被撑出坞外）。
  assert.match(html, /\.mod-es \.es-table-wrap \{[^}]*overflow: auto/)
  assert.match(html, /\.mod-es \.es-app \{[^}]*min-width: 0;/)

  // 截断处画得出省略号：td 的 text-overflow 对「溢出的是 inline-flex 原子盒」无效，
  // 名字会被切在字形中间。省略号得落在最内层的名字上，且外壳不许超出单元格。
  assert.match(html, /\.mod-es \.es-namecell \{[^}]*max-width: 100%;/)
  assert.match(html, /\.mod-es \.es-namecopy > b \{[^}]*text-overflow: ellipsis;/)
})

test('工作区那条 main 规则不许写成裸元素选择器', () => {
  const html = rendererSource
  const shi = fs.readFileSync(new URL('../src/renderer/modules/shi.ts', import.meta.url), 'utf8')
  const bi = fs.readFileSync(new URL('../src/renderer/modules/bi.ts', import.meta.url), 'utf8')
  // 模块自己也用语义化 <main>，裸 main { display:flex; padding-left:7px } 会泼进去：
  // 史的 .shi-view 被当成 flex 项按 max-content 收窄（七卷实测占面板宽
  // 11%/32%/37%/42%/57%/72%/98%，只有显式改回 column 的「节点」卷是满的），
  // 镖收起的详情栏被 padding 撑成 8px 空边（width:0 + border-box）。
  assert.match(shi, /<main class="shi-body">/)
  assert.match(bi, /<main class="detail/)
  assert.match(html, /#app > main \{\s*flex: 1; display: flex; min-height: 0;/)
  // 逐条选择器查，别只查行首：`main, #app > main { … }` 一样是泄漏
  const bare = []
  for (const line of html.split('\n')) {
    const m = /^\s*([A-Za-z][A-Za-z0-9 ,#.>:_-]*?)\s*\{/.exec(line)
    if (!m) continue
    for (const one of m[1].split(',')) if (one.trim() === 'main') bare.push(line.trim())
  }
  assert.deepEqual(bare, [], `裸 main 选择器会泼进模块自己的 <main>：${bare.join(' | ')}`)
})

test('引用的 CSS 变量必须真有定义，别靠裸 hex 兜底', () => {
  // 速查浮层的底色写的是 `var(--panel, #12161d)`，而 `--panel` 全文从未定义过——
  // 于是它一直画的是那个裸 hex，且与面板基色 --bg1(#151c23) 并不相等：改主题时
  // 这一块不会跟着走。同型的还有任务类别 A 的 `var(--cA, #67c98a)`（值恰好等于 --ok）。
  // 这类缺陷不会报错、也不会在肉眼下露馅，只能靠「引用必须有定义」这条结构判据兜住。
  const html = rendererSource
  const dir = new URL('../src/renderer/', import.meta.url)
  const walk = (base) =>
    fs.readdirSync(base, { withFileTypes: true }).flatMap((entry) => {
      const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), base)
      return entry.isDirectory() ? walk(child) : /\.(ts|html|css)$/.test(entry.name) ? [child] : []
    })
  const sources = walk(dir).map((url) => fs.readFileSync(url, 'utf8'))
  const defined = new Set()
  for (const src of sources) {
    // 定义有两种落法：样式表/内联 style 里的 `--x:`，以及 JS 侧 setProperty('--x', …)
    for (const m of src.matchAll(/(--[a-z0-9-]+)\s*:/gi)) defined.add(m[1])
    for (const m of src.matchAll(/setProperty\(\s*['"`](--[a-z0-9-]+)/gi)) defined.add(m[1])
  }
  const missing = new Set()
  for (const src of sources) {
    for (const m of src.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) if (!defined.has(m[1])) missing.add(m[1])
  }
  assert.deepEqual([...missing], [], `这些变量只被引用、从未被定义：${[...missing].join(', ')}`)
  // 反向：速查浮层要引 token 本身，不许再退回「变量 + 裸 hex 兜底」的写法
  assert.match(html, /#kanso-command-palette \.cp-box \{[^}]*background: var\(--bg1\);/)
})

test('度量行：宽档与裁决共线一行，窄档才堆叠', () => {
  const html = rendererSource
  // 2026-08-21 用户分两步拍板，最终态是**紧凑优先**：
  //   第一步授权把 `.metrics` 从 `flex:2 1 320px` 改成 `flex:1 1 100%`（独占一行），
  //   图的是行宽关于面板宽单调、不再有「加宽反而变窄」的悬崖；
  //   第二步看过实机后撤回——「两行明显更适合窄框部分，宽度够还是应该用一行加省略号
  //   比较好」。抬头在宽档因此从 2 行回到 1 行（实测 57.0→32.1px）。
  //
  // 共线必然带来一处跳变：面板跨过 `.metrics`(320) + `.verdict`(210) 两个 basis 之和时，
  // 度量行的行宽掉一个「舰队名+裁决+间距」≈433px。**那不是缺陷，是预期的降级方式**——
  // 放不下的芯片进 ⋯ 收纳，点开还在，收纳的放回/滞回已在 25cf8a5 修好，
  // 不会出现「收进去再也回不来」。单调性的诉求让位于紧凑，是用户拍的板。
  //
  // 判据钉两件事：宽档共线（basis 是那个 320px 定值，不是 100%）、窄档堆叠。
  assert.match(html, /\.fleet-skin \.metrics \{\s*flex: 2 1 320px;/)
  assert.doesNotMatch(
    html,
    /\.fleet-skin \.metrics \{\s*flex: [\d.]+ [\d.]+ 100%/,
    '度量行又独占一整行了：抬头在宽档会变回两行，与 2026-08-21 的拍板相反',
  )
  // 裁决胶囊的下限不动：它是与度量行共线的另一半，改了共线的算术就变了
  assert.match(html, /\.fleet-skin \.verdict \{\s*flex: 1 1 210px;/)
  // 窄档（<700 面板）堆叠：两块各占一整行——这一档用户明说「两行明显更适合」
  assert.match(
    html,
    /\.fleet-skin\.narrow \.verdict, \.fleet-skin\.narrow \.metrics \{ flex-basis: 100%; \}/,
    '窄档的堆叠覆盖丢了：窄框里度量行会被裁决挤成一条缝',
  )
})

test('宽面板不留死角：钥设置居中、铎索引列随面板长、铃规则卡吃满右栏', () => {
  const html = rendererSource
  const lg = fs.readFileSync(new URL('../src/renderer/modules/lg.ts', import.meta.url), 'utf8')

  // 钥：760px 是正文可读行宽，但左贴边会在 1280 浮层里空出 519px 纯黑，
  // 而同一个浮层的「通知」页是满宽的——两页并排看像设置页少画了一块。
  // width:100% 不能省：只有 max-width 时 auto 外边距没有可分配的余量。
  assert.match(html, /\.mod-yu \.yu-app \{[^}]*width: 100%; max-width: 760px; margin-inline: auto;/)

  // 铎：索引列钉死 352px 时，面板拉到 1600 海域名照样省略（实测 5 条切 4 条，
  // 最长的还差 103px），右栏却一直有富余。下限必须仍是 352（窄档一步不退）。
  const colL = /\.mod-du \.colL \{ width: ([^;]+);/.exec(html)
  assert.ok(colL, '找不到 .mod-du .colL 的宽度声明')
  assert.match(colL[1], /^clamp\(352px, \d+%, \d+px\)$/, `索引列又被钉死了：${colL[1]}`)
  assert.match(html, /\.mod-du \.du-app\.narrow \.colL \{ width: 100%;/)

  // 铃：右栏只有这一张卡，flex:none 时卡下方剩一大片纯黑（1280 浮层里 300px）。
  // shrink 必须是 0：内容比可用高还高时要按内容撑，交给右栏自己滚。
  assert.match(html, /\.mod-lg \.rcard \{ flex: 1 0 auto;/)
  // 阈值就地输入框：裸 input 默认 size=20（实测 171px），横跨整列
  assert.match(lg, /<input class="thres" data-extra-num="bucketHigh"/)
  assert.match(html, /\.mod-lg \.thres \{[^}]*width: \d+ch;/, '阈值输入框没有按内容收宽')
})

test('横滚的标签条一律留细滚动条，不藏', () => {
  const html = rendererSource
  // 鉴的书页标签把滚动条藏了（scrollbar-width:none + ::-webkit-scrollbar:none），
  // 窄档最后一卷被推出可视区且零提示（实测 340px 面板溢出 68px）；
  // 锐的页签行同样横滚，却是 scrollbar-width:thin。统一到锐那一形态。
  assert.match(html, /\.mod-ji \.book-tabs \{[^}]*scrollbar-width: thin;/)
  assert.match(html, /\.fleet-skin \.ftabs \{[^}]*scrollbar-width: thin;/)
  assert.doesNotMatch(html, /book-tabs::-webkit-scrollbar/, '又把书页标签的滚动条藏起来了')
  assert.doesNotMatch(html, /\.mod-ji \.book-tabs \{[^}]*scrollbar-width: none/)
})

test('顶栏按钮是一族：形态只写一遍，弹窗组不再自成一套', () => {
  const html = rendererSource
  // 弹窗组（.ov-btn：回顾/通知/设置）与动作组（专注/截图/刷新）并排站在同一条顶栏里，
  // 却分两次写出来，漂出四项差异：高 22/25.1、圆角 4/3、内边距 0-9/3-10、字色 --sub/--text，
  // 外加动作组漏了 font-family:inherit 整组落回 Arial。两组的 hover 完全一致，
  // 可见本意就是同一枚按钮——所以形态收进 `header button` 一条，.ov-btn 只留独有的部分。
  const shared = /\n    header button \{([^}]*)\}/.exec(html)
  assert.ok(shared, '找不到 header button 规则')
  for (const decl of ['height: 22px', 'padding: 0 10px', 'border-radius: 3px', 'font-family: inherit', 'color: var(--text)']) {
    assert.ok(shared[1].includes(decl), `顶栏按钮少了共同形态：${decl}`)
  }
  const ov = /\n    \.ov-btn \{([^}]*)\}/.exec(html)
  assert.ok(ov, '找不到 .ov-btn 规则')
  for (const drifted of ['height', 'padding', 'border-radius', 'font-size', 'color', 'background']) {
    assert.ok(!ov[1].includes(drifted), `.ov-btn 又自己写了一份形态（${drifted}），两组会再漂开`)
  }
  // 激活态与角标锚点是它真正独有的，别连坐删掉
  assert.match(html, /\.ov-btn \{ position: relative; \}/)
  assert.match(html, /\.ov-btn\.on \{ background: var\(--accent-dim\);/)
})

test('镝的敌我两队不上下堆叠（2026-08-20 用户看过效果后否决：太占位置）', () => {
  const html = rendererSource
  // 舰名在窄容器里会被压到只剩 5.6px，「把敌队换行到我方下面」是很自然的修法，
  // 也确实能修好——但他试过，原话「太占位置了」。这条挡的是「下一个人重新想到同一个主意」。
  assert.doesNotMatch(html, /\.mod-di \.arena \{[^}]*flex-direction: column/)
  assert.doesNotMatch(html, /\.mod-di \.arena \{[^}]*flex-wrap: wrap/)
  assert.doesNotMatch(html, /@container[^{]*\{\s*\.mod-di \.arena \{ flex-direction: column/)
  // battle-col : sidebar = 1.35 : 1 也是他的排布，别顺手改
  assert.match(html, /\.mod-di \.battle-col \{ flex: 1\.35;/)
  assert.match(html, /\.mod-di \.sidebar \{ flex: 1;/)
})

test('镝的舰名不被伤害列的常驻空位挤死（余量流向文字，行内解决）', () => {
  const html = rendererSource
  const di = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')

  // 一、伤害列不为极端值常驻留位：宽度跟这一侧**实际打出的位数**走，上限五位
  //     （舰C 单场单舰伤害到不了六位）。0 显示成「—」，占一位。
  assert.match(di, /const dmgDigits = \(ships: BattleShipView\[\]\): number =>\s*Math\.min\(5, Math\.max\(1, \.\.\.ships\.map\(\(ship\) => String\(ship\.damageDealt \|\| 0\)\.length\)\)\)/)
  assert.match(di, /<div class="fside" style="--dmg-ch:\$\{dmgDigits\(b\.fShips\)\}">/)
  assert.match(di, /<div class="fside foe" style="--dmg-ch:\$\{dmgDigits\(b\.eShips\)\}">/)
  // ch 必须在 .dmg 自己的等宽字体下量；兜底值也得是 5，别让缺 var 时算成 0 宽
  assert.match(html, /\.mod-di \.brow \.dmg \{ width: calc\(var\(--dmg-ch, 5\) \* 1ch\);[^}]*font-family: var\(--mono\)/)
  assert.match(html, /\.mod-di \.brow \.dmg \{[^}]*text-align: right/)

  // 二、轨道要让余量真的流到 1fr 的名字列：
  //     伤害列 min-content（定尺、不参与抢余量），血条列上限改百分比封顶
  //     （死的 86px 会在窄档把余量吃光，名字永远停在下限上）
  const wide = /\.mod-di \.brow \{\s*display: grid; grid-template-columns: (.+?);/.exec(html)
  assert.ok(wide, '找不到 .mod-di .brow 的 grid-template-columns')
  assert.equal(wide[1], 'minmax(58px, 1fr) min-content minmax(40px, min(86px, 42%))')
  const narrow = /\.mod-di \.di-app\.narrow \.brow \{ grid-template-columns: (.+?);/.exec(html)
  assert.ok(narrow, '找不到窄态 .brow 的 grid-template-columns')
  assert.equal(narrow[1], 'minmax(50px, 1fr) min-content minmax(36px, min(70px, 42%))')

  // 三、格子实在放不下时先收舰绘（它和名字说的是同一件事），一刀切按容器宽，
  //     不用 flex-shrink——那样是逐行收，六行舰绘宽窄不一、名字起点参差。
  assert.match(html, /\.mod-di \.battle-col \{ container-type: inline-size; \}/)
  assert.match(html, /@container \(max-width: \d+px\) \{\s*\.mod-di \.brow \.nm > \.ship-thumb \{ width: \d+px; \}\s*\}/)
  assert.doesNotMatch(html, /\.mod-di \.brow \.nm > \.ship-thumb \{[^}]*flex-shrink/)

  // 四、2026-08-12 拍板的优先级没被推翻：徽记与展开箭头永不收缩，缩的仍是名字自己
  assert.match(html, /\.mod-di \.brow \.nm > \* \{ flex: 0 0 auto; \}/)
  assert.match(html, /\.mod-di \.brow \.nm > \.el \{ flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; \}/)
})

test('编队抬头不抢编队区的高度', () => {
  const html = rendererSource
  const fleet = fs.readFileSync(new URL('../src/renderer/modules/ru.ts', import.meta.url), 'utf8')
  // 陆航与札两条挂牌并排共占一行。各占一行的话裁决框就三行高，
  // 实测（993px 面板）会让抬头从 57px 涨到 91px，编队区从 197 掉到 161。
  assert.match(fleet, /<span class="vflags">\$\{sally\}\$\{airBase\}<\/span>/)
  assert.match(html, /\.fleet-skin \.vflags \{/)
  assert.doesNotMatch(html, /\.fleet-skin \.verdict \.ab-flag \{\s*flex-basis: 100%/)
})

test('装备仓库三级收拢，每级都把已装备的排在前', () => {
  const stock = fs.readFileSync(new URL('../src/renderer/modules/equip-stock.ts', import.meta.url), 'utf8')

  // 同一门炮持有 97 件，逐件铺开只是噪声。实测 2058 件收成 290 款。
  assert.match(stock, /const groupRows = /)
  assert.match(stock, /三级收拢/)
  assert.match(stock, /const groupRowHtml = /)
  assert.match(stock, /const variantRowHtml = /)
  assert.match(stock, /const instanceRowHtml = /)

  // 第二级：同状态档。闲置那几十件在每个字段上都一样，不该再往下分。
  assert.match(stock, /const variantsOf = /)
  assert.match(stock, /drillable: rows\[0\]\.holder\.kind !== 'idle'/)
  // 那句解释按文案清扫裁定（族 7 UI 自我解说）删了。护的行为不变：不可下钻的
  // 那一级必须换一枚**不同的记号**（dim 的「·」而不是可点的三角），
  // 否则玩家会去点一个点不开的三角。记号本身仍旧钉死。
  assert.match(stock, /es-caret dim">·<\/span>/)
  assert.match(stock, /\$\{open \? '▾' : '▸'\}<\/span>/)
  // 只有一件时再分一级是空转
  assert.match(stock, /if \(variant\.rows\.length === 1 && variant\.drillable\) return instanceRowHtml/)

  // 排序：装备中的在前（动它要先卸下来），其余按 ★ 倒序（别把改修过的当素材拆了）
  assert.match(stock, /const instanceOrder = /)
  assert.match(stock, /equipped\(a\) - equipped\(b\) \|\|\s*b\.inst\.level - a\.inst\.level/)
  assert.match(stock, /HOLDER_RANK\[b\.kind\] - HOLDER_RANK\[a\.kind\]/)

  // 筛掉一部分时要说清「N/M」，不能让摘要数与展开后的条数对不上
  assert.match(stock, /const filtered = group\.rows\.length < group\.owned/)
  assert.match(stock, /const groupWhereHtml = /)
  assert.match(stock, /闲置 \$\{group\.idle\}/)

  // 款名可跳图鉴；点空白仍走行上的展开。链接自己会处理，别被行点击吃掉。
  assert.match(stock, /elinkHtml\('mstEquip', group\.mstId/)
  assert.match(stock, /if \(target\.closest\('\.el'\)\) return/)

  // 预览：展开一款**不自动选中**，否则它一冒出来就关不掉；且必须有关闭入口
  assert.match(stock, /不自动选中/)
  assert.doesNotMatch(stock, /state\.selected = first\.rows\[0\]\.id/)
  assert.match(stock, /data-close-preview/)
  assert.match(stock, /if \(!state\.selected\) return ''/)
  // 星级按档汇总，不逐颗列：45 件就是 45 个 ★，那不是信息
  assert.match(stock, /const byStar = new Map<number, number>\(\)/)
  assert.doesNotMatch(stock, /\.map\(\(level\) => \(level > 0 \? `★\+\$\{level\}` : '★0'\)\)/)
})

test('装备预览只在点了实例时出现，且星级按档汇总', () => {
  const stock = fs.readFileSync(new URL('../src/renderer/modules/equip-stock.ts', import.meta.url), 'utf8')
  const html = rendererSource
  // 原来展开一款就自动选中第一件，这块面板于是一冒出来就关不掉
  // previewHtml 判断与渲染共用一次调用（它每次都全表 filter，双调是白付一遍）
  assert.match(stock, /const preview = previewHtml\(\)[\s\S]{0,80}<aside class="es-side">/)
  assert.match(html, /\.mod-es \.es-pv-x \{/)
  // 逐件的去向表格里已经有了（款 → 档 → 实例），预览不再重复列
  assert.doesNotMatch(stock, /es-pv-list/)
})

test('装备仓库三级在视觉上分得开', () => {
  const html = rendererSource
  // 原来款没设底色（透明＝bg0）而实例正好也是 bg0，父子同色分不出层级。
  // 现在明度成阶梯：款 bg2 > 档 bg1 > 实例 bg0。
  assert.match(html, /\.mod-es \.es-group td \{ background: var\(--bg2\);/)
  assert.match(html, /\.mod-es \.es-variant td \{ background: var\(--bg1\); \}/)
  assert.match(html, /\.mod-es \.es-inst td \{ background: var\(--bg0\);/)
  // 缩进也要成阶梯，否则光靠底色在窄栏里还是分不清
  assert.match(html, /\.mod-es \.es-variant td\.nm \{ padding-left: 24px; \}/)
  assert.match(html, /\.mod-es \.es-inst td\.nm \{ padding-left: 44px; \}/)
  // 绿条三级同粗会连成一整条柱子
  assert.match(html, /\.mod-es \.es-group\.spare td\.nm \{ box-shadow: inset 3px/)
  assert.match(html, /\.mod-es \.es-variant\.spare td\.nm \{ box-shadow: inset 2px/)
  assert.match(html, /\.mod-es \.es-inst\.spare td\.nm \{ box-shadow: inset 1px/)
  assert.doesNotMatch(html, /\.mod-es \.es-table tbody tr\.spare td\.nm/)
  // hover 不能跟档行同色，否则一悬停层级就糊了
  assert.match(html, /\.mod-es \.es-table tbody tr:hover td \{ background: var\(--bg3\); \}/)
})

test('分类表按主数据枚举校准，且不漏不重', () => {
  const equip = fs.readFileSync(new URL('../src/renderer/equip-category.ts', import.meta.url), 'utf8')
  const ship = fs.readFileSync(new URL('../src/renderer/ship-category.ts', import.meta.url), 'utf8')
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const roster = fs.readFileSync(new URL('../src/renderer/modules/qa.ts', import.meta.url), 'utf8')
  const stock = fs.readFileSync(new URL('../src/renderer/modules/equip-stock.ts', import.meta.url), 'utf8')

  // 2026-08-08 从 api_start2 枚举校准时修掉的三处归错——都会让人在错的
  // 分类里找不到东西，改回去要红
  const named = [...equip.matchAll(/^\s{2}([^\s:]+): \[([^\]]*)\]/gm)]
    .map(([, label, ids]) => [label, ids.split(',').map((x) => Number(x.trim()))])
  const groupOf = (id) => named.find(([, ids]) => ids.includes(id))?.[0] ?? '其他'
  assert.equal(groupOf(21), '对空', '対空機銃 曾被归进舰载机')
  assert.equal(groupOf(33), '其他', '照明弾 曾被归进舰载机')
  assert.equal(groupOf(22), '其他', '特殊潜航艇 曾被归进鱼雷')
  assert.equal(groupOf(47), '陆航', '陸上攻撃機')
  assert.equal(groupOf(10), '水上机', '水上偵察機')

  // 同一个类别只能落进一个分组，否则 chip 之间会重复计数
  const seen = new Set()
  for (const [, ids] of named) {
    for (const id of ids) {
      assert.ok(!seen.has(id), `类别 ${id} 落进了两个分组`)
      seen.add(id)
    }
  }

  // 海防舰图鉴内 51 形态，原来和工作舰一起塞在「其他」里
  assert.match(ship, /\['海防', \[1\]\]/)
  // 「其他」不写死名单，由具名分组反推——加新 chip 时不会忘了同步
  assert.match(ship, /export const isOtherShipType/)
  assert.match(equip, /export const isOtherEquipCategory/)
  assert.doesNotMatch(catalog, /SHIP_CHIPS\.slice\(/)
  assert.doesNotMatch(roster, /STYPE_CHIPS\.slice\(/)
  // 判断本身也只能有一份：图鉴 / 列表 / 仓库都走共享的 *ChipMatches。
  // 各写各的就是「其他」失灵那次的成因——文本对得上，行为是错的。
  assert.match(catalog, /shipChipMatches\(/)
  assert.match(catalog, /equipChipMatches\(/)
  assert.match(roster, /shipChipMatches\(/)
  assert.match(stock, /equipChipMatches\(/)
  for (const [name, src] of [['ji', catalog], ['qa', roster], ['stock', stock]]) {
    assert.doesNotMatch(src, /chip\[1\]\.length|types\.length \?/, `${name} 又自己判了一遍 chip 名单`)
  }

  // 「更多分类」面板上的数字必须等于点下去能看到的条数。原来两边数的不是同一批：
  // 舰娘按全部形态数、列表按根形态筛（航空战舰标 9 点进去 0 条）；
  // 装备数的是 api_mst_slotitem 全表，把深海装备也算进去了。
  assert.match(catalog, /const chainStypeIndex = /)
  assert.match(catalog, /chainStypeIndex\(\)\.get\(root\.api_id\)/, '精确筛要看整条改造链')
  assert.doesNotMatch(catalog, /for \(const ship of friendlyShips\.values\(\)\) \{\s*\n\s*counts\.set/)
  assert.match(catalog, /for \(const item of friendlyEquips\.values\(\)\)/, '装备计数要与这一卷列出的那批同源')
  // 主数据把 stype 8 与 9 都叫「戦艦」，面板里不能摆两个一模一样的格子
  assert.match(catalog, /const stypeSiblings = /)

  // 顶栏放不下就给「更多分类」，按主数据逐个列，名字不硬编码
  assert.match(catalog, /const shipMoreCategoriesHtml = /)
  assert.match(catalog, /const equipMoreCategoriesHtml = /)
  assert.match(catalog, /data-more-cat/)
  assert.match(stock, /const moreCategoriesHtml = /)
  assert.match(stock, /data-more-cat/)
  // 类别名一律取自主数据，取不到就退回「分类 N」，不编名字
  assert.match(stock, /equipCategoryFallbackName\(type2, equipTypeNames\.get\(type2\)\)/)
})

test('图鉴说明文只转述，不自作翻译；缺数据要明说是缺', () => {
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')

  // 图鉴说明文来自游戏自己下发的主数据，335 个基础形态都有；
  // 改造形态游戏发的是空 `<br>`，回落到本链初始形态并标明借自谁
  assert.match(catalog, /const getmesOf = /)
  assert.match(catalog, /api_getmes/)
  assert.match(catalog, /getmesHtml\(shipState\.selectedForm\)/, '说明文要真的挂进抽屉')
  assert.match(catalog, /rootOf\.get\(mstId\)/, '改造形态要回落到初始形态')
  // 中文只取现成对照（kcwiki 台词表的 *-Intro / 日中字幕包），取不到就只给原文
  assert.match(catalog, /endsWith\('-Intro'\)/)
  assert.match(catalog, /voiceZhByJa\.get\(normalizeVoiceLine/)
  // 「没有可靠中文对照，只给原文」按文案清扫裁定缩成「无中文对照」，语义不变：
  // 取不到现成对照时必须当场标出来，绝不自作翻译。
  assert.match(catalog, /无中文对照/)

  // 这块在抽屉最上面，而点开一艘舰第一眼该看到的是数据。整块默认收成一行，
  // 收起时用 peek 露一行正文，不至于要点开才知道里面是什么
  assert.match(catalog, /<details class="sec getmes">/)
  assert.doesNotMatch(catalog, /<details class="sec getmes" open/, '默认应当是收起的')
  assert.match(catalog, /class="gm-peek"/)
  // 没有中文对照时，peek 退回日文原文——否则那 71 条收起来是一片空白
  assert.match(catalog, /const peek = zh \? zh\.zh : jaText/)

  // 来源声明并到抽屉底部一处（默认收起）。原本每段各带一行，光改造那条就 65px，
  // 卡在改造链与属性之间，比整个图鉴说明块还占地方——而它每艘舰写的都一样。
  assert.match(catalog, /const shipSourceFootHtml = /)
  assert.match(catalog, /<details class="foot src-foot">/)
  assert.doesNotMatch(catalog, /class="rm-credit"/, '改造署名已并进底部，不该再占中间一行')
  // 声明不是删掉：版本与日期仍在，且随形态区分收录与否
  assert.match(catalog, /lodeCreditShort/)
  // 「上游」是施工者视角词，已按裁定换成「社区资料」；语义（这一形态没被收录、
  // 属性只剩游戏基础数据那几项）不变。本次文案清扫又把它缩成短句，改钉新说法。
  assert.match(catalog, /社区资料未收录这一形态/)
  // 「接入第三方资料后会逐项标注」——早就标了，这句话不再成立
  assert.doesNotMatch(catalog, /接入第三方资料后会逐项标注/)

  // 可装备判定的规则说明（舰娘侧与装备侧那份共享折叠）整块按文案清扫裁定
  //（族 3 玩家常识）删了：四句说的都是游戏自己的判定规则。护栏跟着收紧成
  // 「两侧都不许把它抄回来」——从前是「必须并成一份」，现在是「一份都不许有」。
  assert.doesNotMatch(catalog, /const equipRuleNoteHtml = /)
  assert.doesNotMatch(catalog, /规则：api_mst_equip_ship（单舰专属）优先于/, '两处规则说明已并成一份')
  assert.doesNotMatch(catalog, /单舰专属清单|完整覆盖而非追加/, '游戏规则复述又抄回界面了')

  // 海域抽屉里的口径说明原本是五段摊开的多行文字（实测占 271px）。
  // 收进 foldedNote 后每条只留一行抬头，正文点开才有。
  // 不钉调用次数——数字会随内容增删而错，下面按正文锚定才是真判据
  assert.match(catalog, /const foldedNote = /)
  // 名单随发布侧文案清理更新过。本次文案清扫又把其中四条整块删了
  //（掉落口径 / 敌编成口径 / 战斗估算口径 / 照录出处，族 4 与族 8），
  // 比收进折叠更彻底：不再有「摊在正文」的风险。护栏跟着收紧——
  // 长口径说明要么不在，要么必须在折叠里，绝不许直接摊在一眼位。
  for (const long of ['读数口径', '往期 · 限定期捞到']) {
    const at = catalog.indexOf(long)
    assert.ok(at > 0, `找不到「${long}」`)
    const before = catalog.slice(Math.max(0, at - 260), at)
    assert.ok(before.includes('foldedNote('), `「${long}」还摊在正文里，没收进折叠`)
  }
  for (const gone of [
    '照录自 akashi-list',
    '主数值来自战斗机制估算',
    '只列「确认能掉」；未列出 ≠ 确认不掉',
    '的敌编成会按每种实际组合分别保存，不展示出现率',
  ]) {
    assert.ok(!catalog.includes(gone), `「${gone}」又铺回界面了`)
  }
  // 署名走不带 note 的短版：note 是给维护者的口径备忘，
  // 57–149 字，摊在 aux 里会把一行撑成三四行
  assert.doesNotMatch(catalog, /esc\(lodeCredit\(fcdMapLode\.meta\)\)/)
  assert.doesNotMatch(catalog, /esc\(lodeCredit\(routingLode\.meta\)\)/)
  assert.doesNotMatch(catalog, /esc\(lodeCredit\(wikiwikiRoutingLode\.meta\)\)/)

  // 今日改修原本是全量平铺。分组后组间按「今天可做的条数」排——
  // 纯按类别 id 排会把能动手的那几条埋进中间，这一页就白做了
  assert.match(catalog, /type2: Array\.isArray\(equip\.api_type\)/)
  assert.match(catalog, /\.sort\(\(a, b\) => b\.ready - a\.ready \|\| a\.type2 - b\.type2\)/)
  // chip 栏两个模式共用：今日改修本来就受 equipMatches 过滤，只是没渲染出来
  assert.match(catalog, /const chipsRow = /)
  assert.equal((catalog.match(/\$\{chipsRow\}/g) ?? []).length, 2, '目录与今日改修都要有 chip 栏')

  // kcwiki 未收录的形态（实测 89 / 862）属性只剩六项，必须说清是缺资料而不是没有。
  // 辩护尾巴「不是这艘舰没有那几项」按 2026-08-26 文案清扫裁定（族 9）删了，
  // 挂牌本身与「缺就明说」这条行为照旧：三项全空时必须出挂牌，不许静默留白。
  assert.match(catalog, /gap-note/)
  assert.match(catalog, /回避 \/ 对潜 \/ 索敌暂无数据/)

  // 「史实」页原本是句占位文案；接上外链后就不该再走 TAB_NOTES 的兜底分支
  assert.match(catalog, /shipWikiLinksHtml\(shipState\.selectedForm\)/)
  assert.doesNotMatch(catalog, /'p-hist':/, '史实页已有实现，不该再留占位文案')
  // 史实页只是外站入口，不能让人以为点开就有全文。那句抬头按 2026-08-26 文案
  //（族 2 自证清白：「用系统浏览器打开」是在表白我们不内嵌）删了。要防的事由
  // 形态本身守住，而且更硬：这一页除了链接**没有别的内容**，且链接一律外开——
  // 只要有人往这一页塞正文或改成内嵌，下面两条就红。
  assert.match(catalog, /const shipWikiLinksHtml/)
  assert.match(catalog, /class="wiki-links">/)
  assert.match(catalog, /当前形态暂无外站条目/)
  // kancolle.wikia.com 是退役域名，只靠一层重定向活着
  assert.match(catalog, /kancolle\\\.wikia\\\.com/)
  assert.match(catalog, /kancolle\.fandom\.com/)
})

test('熟练度显示成游戏里的那枚标记，不是裸数字', async () => {
  const { alvIconHtml, alvTitle } = await import('../src/renderer/alv-icon.ts')

  // 0 与越界不画。非舰载机的 alv 恒为 0，画个「零」出来会被读成「熟练度是零」
  assert.equal(alvIconHtml(0), '')
  assert.equal(alvIconHtml(8), '')
  assert.equal(alvIconHtml(-1), '')

  // 1–3 竖杠、4–6 斜杠、7 人字形（2026-08-08 对着 poi 的 alv{1..7}.png 逐张核过）
  for (const [alv, count] of [[1, 1], [2, 2], [3, 3]]) {
    assert.equal((alvIconHtml(alv).match(/<rect /g) ?? []).length, count, `alv${alv} 应有 ${count} 条竖杠`)
  }
  for (const [alv, count] of [[4, 1], [5, 2], [6, 3]]) {
    const html = alvIconHtml(alv)
    assert.equal((html.match(/<path /g) ?? []).length, count, `alv${alv} 应有 ${count} 道斜杠`)
    assert.doesNotMatch(html, /<rect /, `alv${alv} 是斜杠档，不该混进竖杠`)
  }
  assert.equal((alvIconHtml(7).match(/<path /g) ?? []).length, 2, 'alv7 是两个人字形')

  // 图形之外仍要能读到确切档位——只剩看图猜就退步了
  for (let alv = 1; alv <= 7; alv++) {
    assert.match(alvIconHtml(alv), new RegExp(`<title>${alvTitle(alv)}</title>`))
  }

  // 三处显示点都走这一份；导出的 CSV 仍是数字，不能塞 SVG 进去
  const stock = fs.readFileSync(new URL('../src/renderer/modules/equip-stock.ts', import.meta.url), 'utf8')
  const battle = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  for (const [name, src] of [['equip-stock', stock], ['di', battle], ['ji', catalog]]) {
    assert.match(src, /alvIconHtml\(/, `${name} 要用共享的熟练度标记`)
  }
  assert.doesNotMatch(stock, /es-alv/, '裸数字那套样式已经不用了')
  assert.doesNotMatch(battle, /熟练 \$\{item\.alv\}/)
  assert.match(stock, /isAirborneEquip\(r\.type2, airborneTypesNow\(\)\) \? r\.inst\.alv : ''/, '导出仍是数字')
})

test('任务与远征：再次点击同一行回到列表', () => {
  // （舰娘列表 2026-08-11 改成整面板接管的单独界面，收起语义不再适用——
  //   它的交互护栏在「舰娘列表点行进入整面板接管的单独界面」那条。）
  const quest = fs.readFileSync(new URL('../src/renderer/modules/qn.ts', import.meta.url), 'utf8')
  const exped = fs.readFileSync(new URL('../src/renderer/modules/bi.ts', import.meta.url), 'utf8')
  // 走与关闭按钮同一套退场动画，否则两条路径关出来的观感不一样
  assert.match(quest, /if \(state\.selected === id\) \{[\s\S]{0,240}exitWithMotion\(pane\.querySelector<HTMLElement>\('\.q-drawer\.open'\), 'open', render\)/)
  assert.match(exped, /if \(state\.selected === id\) \{[\s\S]{0,200}exitWithMotion\(pane\.querySelector<HTMLElement>\('\.bi-app\.open'\), 'open', render\)/)
  // 点的是**别的**行时仍然是切换，不能一并关掉
  assert.match(quest, /state\.selected = id\s*\r?\n\s*render\(\)/)
  assert.match(exped, /state\.selected = id\s*\r?\n\s*render\(\)/)
})

// 上一条只比对源码文本，所以漏掉了下面这个：判断写错了，正则照样匹配得上。
// 这两个分类文件没有任何 import，能被 node 的类型剥离直接加载，于是这里
// 直接调函数验行为。
test('「其他」这个 chip 真的在筛，而不是形同虚设', async () => {
  const { shipChipMatches, SHIP_CHIPS, isOtherShipType } = await import('../src/renderer/ship-category.ts')
  const { equipChipMatches, EQUIP_CHIPS } = await import('../src/renderer/equip-category.ts')

  // 曾经的写法拿 `名单.length` 当前置条件，而「其他」的名单**必然是空的**
  // （它的定义就是「不属于任何具名分组」），整条分支被跳过 →
  // 点「其他」出来 332 条，和「全部」一模一样。
  assert.equal(shipChipMatches('其他', 2), false, '驱逐舰不该落进「其他」')
  assert.equal(shipChipMatches('其他', 17), true, '扬陆舰没有具名 chip，应落进「其他」')
  assert.equal(equipChipMatches('其他', 33), true, '照明弹没有具名 chip')
  assert.equal(equipChipMatches('其他', 12), false, '小型电探属于「电探」')

  // 具名 chip 各管各的，且「全部」不设限
  assert.equal(shipChipMatches('全部', 17), true)
  assert.equal(equipChipMatches('全部', 33), true)
  assert.equal(shipChipMatches('战舰', 9), true)
  assert.equal(shipChipMatches('战舰', 2), false)

  // 逐个舰种走一遍：必须落进恰好一个 chip，不多不少。
  // 少了 = 在任何 chip 下都找不到它；多了 = 两个 chip 重复计数。
  const shipLabels = SHIP_CHIPS.map(([label]) => label).filter((l) => l !== '全部' && l !== '收藏')
  for (let stype = 1; stype <= 22; stype++) {
    const hits = shipLabels.filter((label) => shipChipMatches(label, stype))
    assert.equal(hits.length, 1, `舰种 ${stype} 落进了 ${hits.length} 个分组：${hits.join('/')}`)
  }
  // 「其他」的口径与 isOtherShipType 是同一件事，不能各说各话
  for (let stype = 1; stype <= 22; stype++) {
    assert.equal(shipChipMatches('其他', stype), isOtherShipType(stype))
  }

  const equipLabels = EQUIP_CHIPS.filter((l) => l !== '全部')
  for (let type2 = 1; type2 <= 100; type2++) {
    const hits = equipLabels.filter((label) => equipChipMatches(label, type2))
    assert.equal(hits.length, 1, `装备类别 ${type2} 落进了 ${hits.length} 个分组：${hits.join('/')}`)
  }
})

test('主机没变时不要白扔美术缓存', () => {
  // setGameHost 会被调三次：启动时用记住的主机、补读一次、游戏加载完
  // kancolle.server.change 再来一次——后两次传的是**同一个**主机。
  // 原来无条件 clear + 广播，于是每次都把地图美术缓存扔掉（下次开海域要重取），
  // 并让全文档重扫。实测启动到游戏加载完这段窗口里事件发了 4 次，修完 3 次，
  // 少掉的正是游戏加载完那一次。
  //
  // kcs-image.ts 在模块顶层 require 了 @electron/remote，没法在 node 里直接
  // import 来做行为测试，所以这里只能钉源码——它证明不了判断写没写反，
  // 真正的判据是上面那组实测计数。
  const img = fs.readFileSync(new URL('../src/renderer/kcs-image.ts', import.meta.url), 'utf8')
  const fn = img.slice(img.indexOf('export const setGameHost'), img.indexOf('export const setAllowRemoteArt'))
  const guardAt = fn.search(/if \(next === gameHost\) return/)
  assert.ok(guardAt > 0, 'setGameHost 缺少「主机没变就返回」的短路')
  assert.ok(guardAt < fn.indexOf('mapArtCache.clear()'), '短路要在清缓存之前，否则等于没加')
  assert.ok(guardAt < fn.indexOf('notifyArtSourceChange()'), '短路要在广播之前')
  // 语音那边只赋值、没有副作用，不需要同样的短路
  const voice = fs.readFileSync(new URL('../src/renderer/kcs-voice.ts', import.meta.url), 'utf8')
  const vfn = voice.slice(voice.indexOf('export const setVoiceHost'))
  assert.doesNotMatch(vfn.slice(0, 200), /clear\(\)|dispatchEvent/)
})

test('「这张图取不到」只在本次会话内成立，不能变成永久结论', () => {
  const img = fs.readFileSync(new URL('../src/renderer/kcs-image.ts', import.meta.url), 'utf8')
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')

  // 官方资源目录里不是每艘舰每种图都有（多数深海舰只有横幅）。
  // 原来「先按 12 种全摆出来、谁 404 谁被删」，每次重渲染都重演一遍：
  // 实测飞行场栖姬每次摆 8 格、其中 7 格是死链，进母港那一下就闪一排空框。
  assert.match(img, /const deadArtUrls = new Set<string>\(\)/)
  assert.match(img, /!deadArtUrls\.has\(url\)/, 'availableShipImages 要跳过已知取不到的')
  // 格子先 hidden，加载完才现形——不先摆空框
  assert.match(catalog, /data-cg-cell hidden>/)
  assert.match(catalog, /cell\?\.removeAttribute\('hidden'\)/)
  // 但凡重设过 innerHTML 就必须补挂 load 监听：新 <img> 不带旧监听，
  // 而格子是 hidden 起手的 —— 漏一处就整页空白（实测切到「立绘」页时发生过）
  for (const fn of ['updateShipDetailPanel', 'updateAbyssDetailPanel']) {
    const at = catalog.indexOf(`function ${fn}`)
    if (at < 0) continue
    const body = catalog.slice(at, at + 900)
    assert.ok(body.includes('innerHTML'), `${fn} 应当重设 innerHTML`)
    assert.ok(
      body.includes('wireCgImages(panel)') || body.includes('wireAbyssDetailPanel(panel)'),
      `${fn} 重设 innerHTML 后没有补挂立绘监听`,
    )
  }

  // 关键安全性：这个结论**不落盘**，且任何可能改变「图存不存在」的事件都要清空。
  // 否则官方哪天给某艘舰补了立绘，我们会一直藏着它。
  assert.doesNotMatch(img, /config\.set\([^)]*dead/i, '死链表不许写进配置')
  assert.doesNotMatch(img, /localStorage[^\n]*dead/i)
  const clears = (img.match(/clearDeadArtUrls\(\)/g) ?? []).length
  assert.ok(clears >= 3, `只清了 ${clears} 处：主数据刷新 / 换主机 / 远端开关都要清`)
  const functionEnd = {
    setShipImageGraph: 'export const shipGraphLayout',
    setGameHost: 'let shipImageVersion',
    setAllowRemoteArt: 'export const remoteArtState',
  }
  for (const fn of ['setShipImageGraph', 'setGameHost', 'setAllowRemoteArt']) {
    const at = img.indexOf(`export const ${fn}`)
    assert.ok(at > 0, `找不到 ${fn}`)
    const end = img.indexOf(functionEnd[fn], at)
    assert.ok(end > at, `找不到 ${fn} 的结束锚点`)
    const body = img.slice(at, end)
    assert.ok(body.includes('clearDeadArtUrls()'), `${fn} 里没有清空死链表`)
  }
})

test('同一外观的深海难度变体借基础形态的立绘，但自己有就不借', () => {
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  // 飛行場姫 一族有 18 个条目（四难度 × 多期活动），只有最早那个 id 发布了立绘：
  // 实测 #1556 full=200，#1889 / #2095 都是 404。所以给非首个成员补一格「同型」。
  assert.match(catalog, /const family = self \? abyssFamily\(self\) : \[\]/)
  assert.match(catalog, /base\.api_id !== mstId/, '首个成员不该借自己')
  assert.match(catalog, /isBigShipImg\(image\.type, image\.damaged\)/, '只借全身尺寸，不借横幅')
  assert.match(catalog, /同型 \$\{entityNamePlain\('abyssShip', base\.api_id/, '借来的要标明借自谁')
  // 自己的立绘出来了就把同型那格撤掉，否则同一张图并排两次
  assert.match(catalog, /\[data-cg-cell\]\.big:not\(\[data-cg-family\]\):not\(\[hidden\]\)/)
  assert.match(catalog, /querySelectorAll\('\[data-cg-family\]'\)\.forEach\(\(el\) => el\.remove\(\)\)/)
})

test('实体名要么可点，要么本来就没有跳转目标——不许生成死链接', () => {
  const root = new URL('../src/renderer/', import.meta.url)
  const files = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const child = new URL(e.name + (e.isDirectory() ? '/' : ''), dir)
      if (e.isDirectory()) walk(child)
      else if (/\.ts$/.test(e.name)) files.push(child)
    }
  }
  walk(root)

  // entityTermHtml 只上色、**从不生成链接**（见 localization.ts）。
  // 所以「这个名字点不点得动」取决于外面有没有套 elink——全局盘过一次：
  // 69 处调用里 54 处的类型其实注册过路由，等于本可点却点不了。
  const term = fs.readFileSync(new URL('localization.ts', root), 'utf8')
  assert.match(term, /export const entityTermTrustedHtml[\s\S]{0,300}entity-term/)
  assert.doesNotMatch(
    term.slice(term.indexOf('export const entityTermTrustedHtml'), term.indexOf('export const entityNameHtml')),
    /class="el /,
    'entityTermHtml 不该自己变成链接——那会把每个「燃料」「第1舰队」都变可点',
  )

  // 跨模块引用这几处已经接上了链接。**id 必须是路由认得的那个**：
  // 目录分组路由做的是 Number(ref.id)，给它名字会 NaN 直接 return，
  // 渲染出来是链接、点了没反应（实测发生过：点「驱逐舰」行数 332→332）。
  const catalog = fs.readFileSync(new URL('modules/ji.ts', root), 'utf8')
  for (const [call, why] of [
    ["elinkHtml('shipTypeCatalog', list[0].api_stype", '舰娘目录分组头'],
    ["elinkHtml('equipTypeCatalog', type2", '今日改修分组头'],
    ["elinkHtml('equipTypeCatalog', groupCat", '装备目录分组头'],
    ["elinkHtml('shipTypeCatalog', stype", '可装备舰分组头'],
    ["elink('useitem', id", '改造需求道具'],
    ["elink('abyssShip', holders[0].id", '深海装备搭载舰'],
  ]) {
    assert.ok(catalog.includes(call), `${why} 没接链接或 id 传错：${call}`)
  }
  // 传名字给这两个路由 = 死链接
  assert.doesNotMatch(catalog, /elinkHtml\('(?:ship|equip)TypeCatalog', (?:typeName|name)\b/,
    '目录分组路由要数字 id，传名字点了没反应')
})

test('打包不许把工作目录里的杂物一起塞进产物', async () => {
  // ignore 是「列举排除」式的：根目录冒出新东西就会被默默打进去。
  // 实测踩过——agent 会话在 .claude/worktrees/ 下开的 git worktree（整份仓库副本）
  // 进了 app.asar：26.8 MB / 529 个文件，而那目录事后被删，只在产物里留下幽灵拷贝。
  // 清掉后 22.1 MB / 227 个文件。
  //
  // 这条护栏原来是比对 package-win.mjs 里那段源码文本的。规则拆成模块之后改成
  // **拿真路径跑判定**：「这条正则拦不拦得住那个路径」正是源码文本看不出来的那部分。
  const { PACKAGE_IGNORE, isPackageIgnored } = await import('../scripts/lib/package-ignore.mjs')
  assert.ok(PACKAGE_IGNORE.length >= 5, '排除清单被清空了')
  const excluded = [
    '/.git/config', '/.claude/worktrees/x/package.json', '/.gitignore', '/.packager-tmp/a',
    '/src/main/index.ts', '/test/core-regressions.test.mjs', '/scripts/build.mjs',
    '/release/kuma-win32-x64/x.exe', '/assets/review/quest-pre-reconcile.json',
    '/启动kuma.cmd', '/kuma.lnk', '/tsconfig.json',
    '/NVIDIA Corporation/NV_Cache/x.bin',
    // @electron/packager 的 DEFAULT_IGNORES：ignore 传函数之后那一组整组失效
    //（实读 dist/copy-filter.js 的 populateIgnoredPaths），必须自己兜住。
    // 少抄一条不会报错，只会在产物里静静多出一份东西。
    '/package-lock.json', '/yarn.lock', '/pnpm-lock.yaml',
    '/node_modules/.bin/electron', '/build/Release/foo.obj', '/node_gyp_bins/python3',
    // packager 的默认清单自己也漏了这个（它那条要求 package-lock.json 前面是 /，
    // 而这个文件名前面多一个点）——2026-08-21 拆 asar 时实测它确实进了产物。
    '/node_modules/.package-lock.json',
    '/docs/combat-bonus-sources.md', // 维护者侧规格文档，玩家产物里是噪音
    // 仓库 README 是开发者文档（构建、抓取、目录结构）。玩家那份是 使用说明.md，
    // 走 extraResource 落在产物根，不靠 asar。
    // README-玩家版.md 是**仓库首页**的玩家视角那一份，同样不进 asar：
    // 产物里的说明书只有 使用说明.md 一份，两份说明书打架比没有还糟。
    '/README.md', '/README-玩家版.md',
    // 外挂 sourcemap：发行版构建不生成它，这条闸拦的是「拿开发构建的 dist 直接打包」
    '/dist/renderer/index.js.map', '/dist/renderer/quest-tree.js.map',
  ]
  for (const file of excluded) {
    assert.equal(isPackageIgnored(file), true, `${file} 应当排除`)
  }
  // 反向：产物真正要用的东西一个都不许被误伤
  const kept = [
    '/dist/main/index.js', '/dist/renderer/index.html', '/dist/shared/qp-types.js',
    // .map 那条不许连 .js 一起误伤（`/dist/renderer/index.js.map` 与它只差一个后缀）
    '/dist/renderer/index.js',
    '/assets/preload/webview-preload.js', '/assets/data/server.json',
    '/assets/branding/kuma.ico', '/assets/lodes/quests-scn.json',
    '/NOTICE.md', '/LICENSE', '/package.json',
    // 子目录里的 README 不受根目录那条影响（现在没有，将来有也别一起误杀）
    '/node_modules/@electron/remote/README.md',
    '/node_modules/@electron/remote/index.js', // node_modules 交给 prune 裁，别自己动手
  ]
  for (const file of kept) {
    assert.equal(isPackageIgnored(file), false, `${file} 被排除清单误伤了`)
  }
})

test('玩家要能直接打开的三份文档：仓库里在、且真的会被复制出去', async () => {
  // 这三份走 extraResource 进 resources/，收尾再复制一份到产物根——
  // 打进 asar 的话双击打不开、shell.openPath 也打不开（钥的「打开 NOTICE.md」正是走 resources/）。
  // 这里守的是**上游那一半**：文件在不在仓库里、打包脚本认不认它们。
  // 产物那一半由拆 asar / 看产物根的人工核对接手（发布检查单 §四）。
  const docs = ['NOTICE.md', 'LICENSE', '使用说明.md']
  const script = fs.readFileSync(new URL('../scripts/package-win.mjs', import.meta.url), 'utf8')
  const listed = script.match(/const BUNDLED_DOCS = \[([^\]]*)\]/)?.[1] ?? ''
  for (const name of docs) {
    assert.ok(
      fs.existsSync(new URL(`../${name}`, import.meta.url)),
      `仓库里没有 ${name}，发行版里也就不会有`,
    )
    assert.ok(listed.includes(name), `package-win.mjs 的 BUNDLED_DOCS 漏了 ${name}`)
  }
  // 玩家那份说明书要真的写着玩家需要的东西——空文件/占位稿一样是「发出去了但没用」
  const manual = fs.readFileSync(new URL('../使用说明.md', import.meta.url), 'utf8')
  assert.ok(manual.length > 1500, '使用说明.md 短得不像一份说明书')
  for (const must of ['解压', '代理', '127.0.0.1', '8099', 'SOCKS5', '%APPDATA%\\kuma', 'NOTICE.md']) {
    assert.ok(manual.includes(must), `使用说明.md 里没写「${must}」`)
  }
  // 「哪些资料没随包」这句话必须跟着随包名单走：名单里已经有的东西还写着「没有随包」
  // 就是撒谎（2026-08-22 常规图三层随包之后，那句旧文案当场变成假话）。
  // 这条是**数据 × 文案**的交叉核对，不是钉某句措辞。
  const { BUNDLED_LODE_IDS: bundled } = await import('../scripts/lib/bundled-lodes.mjs')
  const limitsAt = manual.indexOf('## 六、已知限制')
  const limits = limitsAt >= 0 ? manual.slice(limitsAt) : ''
  assert.ok(limits, '使用说明.md 没有「已知限制」一节')
  const bundledClaims = [
    ['map-drops', '海域掉落目录'],
    ['map-enemy-comps', '敌编成'],
    // 2026-08-23 补：这三个也是随包的，说明书里再写「没随包」同样是撒谎
    ['kcwiki-voice', '语音台词'],
    ['kcwiki-expedition', '远征的收益'],
    ['kcwiki-routing', '中文带路'],
  ]
  // 只看**那一条**（从 `- ` 起到下一条 `- ` 为止）。按字数截窗会把紧跟着的
  // 「已经随包」那条也吃进来，于是护栏拿正确的文案报错——守卫本身就成了噪声源。
  const notBundledBullet =
    limits
      .split(/\n(?=- )/)
      .find((bullet) => bullet.includes('没有随包')) ?? ''
  assert.ok(notBundledBullet, '「已知限制」里没有那条「哪些资料没随包」')
  for (const [id, claim] of bundledClaims) {
    if (!bundled.includes(id)) continue
    assert.ok(
      !notBundledBullet.includes(claim),
      `${id} 已经随包了，「已知限制」里还写着「${claim}…没有随包」`,
    )
  }
  // 反过来也要成立：**不随包**的那批各自影响的域，说明书里得说得出来。
  // 逐个 id 去对文案会变成一张易碎的关键词表，所以只钉「域」这一层——
  // 2026-08-23 抓到的实况是说明书漏了远征、任务前置、路线三个域整整没提。
  const { CONSUMED_LODES: consumed } = await import('../dist/shared/lode-ids.js')
  const selfFetchIds = consumed.filter((entry) => entry.selfFetch).map((entry) => entry.id)
  assert.ok(selfFetchIds.length > 5, '不随包的那批不见了，这条交叉核对就落空了')
  for (const [id, keyword] of [
    ['equip-upgrades', '改修'],
    ['akashi-list', '逐星'],
    ['dev-recipes', '配方'],
    ['wikiwiki-remodel', '改造素材'],
    ['wikiwiki-item-exchange', '兑换目录'],
    ['wikiwiki-expedition', '远征'],
    ['wikiwiki-quests', '任务前置'],
    ['wikiwiki-routing', '分歧说明'],
  ]) {
    if (!selfFetchIds.includes(id)) continue
    assert.ok(
      notBundledBullet.includes(keyword),
      `${id} 不随包，「已知限制」那条却没提到「${keyword}」这个域`,
    )
  }
  // map-intel 这一条要写准：常规海域早就随包了，别再拿它吓玩家
  assert.ok(
    limits.includes('活动海域') && /常规海域[^。]*已经随包/.test(limits),
    '「已知限制」没把「常规海域已随包 / 只缺活动海域」这件事说清楚',
  )
  // 红线：不许教玩家降低系统防护
  for (const forbidden of ['杀软白名单', '关闭 Defender', '关闭实时保护', '添加信任区']) {
    assert.ok(!manual.includes(forbidden), `使用说明.md 越界了：${forbidden}`)
  }
  // 也不许声称「绝对安全 / 已通过安全检测」
  assert.doesNotMatch(manual, /绝对安全|已通过.{0,6}安全检测/)
})

test('矿脉目录走白名单：许可箱之外的包一个都不许进产物', async () => {
  // 2026-08-21 发布侧口径：只有「数据本身所在的源有明确、允许再分发的许可」的包随发行版走。
  // 这里是**许可护栏**，不是体积护栏——排除式清单在这一段根本不成立：
  // 新抓一个包就会被默默打进去，而漏一个的代价是侵权分发。
  const { isPackageIgnored } = await import('../scripts/lib/package-ignore.mjs')
  const { BUNDLED_LODE_IDS, NEVER_BUNDLED_LODE_IDS, REDISTRIBUTABLE_LICENSES } = await import(
    '../scripts/lib/bundled-lodes.mjs'
  )
  const sources = JSON.parse(
    fs.readFileSync(new URL('../scripts/lode-sources.json', import.meta.url), 'utf8'),
  )
  assert.ok(BUNDLED_LODE_IDS.length >= 16, `随包名单只剩 ${BUNDLED_LODE_IDS.length} 个，是不是被清空了`)

  // 名单里的进得去，名单外的（含目录内杂物）一律进不去——逐条真跑，不看源码文本
  for (const id of BUNDLED_LODE_IDS) {
    assert.equal(isPackageIgnored(`/assets/lodes/${id}.json`), false, `${id} 在随包名单里却被排除`)
  }
  for (const source of sources) {
    if (source.bundle === true) continue
    assert.equal(
      isPackageIgnored(`/assets/lodes/${source.id}.json`),
      true,
      `${source.id} 没标 bundle 却能进产物——许可事故`,
    )
  }
  for (const file of ['/assets/lodes/README.md', '/assets/lodes/akashi-list.json', '/assets/lodes/map-intel.json']) {
    assert.equal(isPackageIgnored(file), true, `${file} 不该进产物`)
  }
  // 维护者侧那几个即使将来有人手滑标了 bundle 也进不去（bundled-lodes 会直接抛）
  for (const id of NEVER_BUNDLED_LODE_IDS) {
    assert.equal(isPackageIgnored(`/assets/lodes/${id}.json`), true, `${id} 是永不随包的`)
  }

  // 许可一致性：凡是 bundle: true 的，licenseId 必须在允许再分发的那两种里
  for (const source of sources) {
    if (source.bundle !== true) continue
    assert.ok(
      REDISTRIBUTABLE_LICENSES.has(source.licenseId),
      `${source.id} 标了 bundle 却写着 licenseId=${source.licenseId}`,
    )
  }
})

test('随包的每个矿脉包都得在 NOTICE.md 里署上名', async () => {
  // MIT 要求「包含在所有副本中」，CC BY-NC-SA 的 4(a) 要求署名——两条都靠 NOTICE 这一份分发物履行。
  // 加了包忘了署名是最容易发生的一种失误，而它不会以任何方式报错，只会在发布之后才被人发现。
  // 署名集中在 NOTICE + 钥里那一页，不散布到每条信息下面（2026-08-21 用户拍板的 CC 执行铁律之一）。
  const { BUNDLED_LODE_IDS } = await import('../scripts/lib/bundled-lodes.mjs')
  const notice = fs.readFileSync(new URL('../NOTICE.md', import.meta.url), 'utf8')
  for (const id of BUNDLED_LODE_IDS) {
    assert.ok(
      notice.includes(`assets/lodes/${id}.json`),
      `${id} 随发行版分发却没在 NOTICE.md 里署名`,
    )
  }
  // CC 那一节的三项条件必须写全（只写「来自 kcwiki」不够）
  assert.match(notice, /creativecommons\.org\/licenses\/by-nc-sa\/3\.0/)
  assert.match(notice, /非商业性使用/)
  assert.match(notice, /相同方式共享/)
})

test('随包名单只有一份出处：.gitignore 的反选块必须与 bundle 标志一致', async () => {
  // .gitignore 读不了 JSON，所以那一段是**生成**的。手写两份必然漂移：
  // 加了一个包只改一处，结果要么仓库里没有那份数据、要么产物里多出一个不该有的。
  const { BUNDLED_LODE_IDS } = await import('../scripts/lib/bundled-lodes.mjs')
  const { withBundledBlock, gitignorePath } = await import('../scripts/sync-bundled-lodes.mjs')
  const current = fs.readFileSync(gitignorePath, 'utf8')
  assert.equal(
    withBundledBlock(current),
    current,
    '.gitignore 的随包名单过期了——跑 npm run lodes:sync-ignore',
  )
  // 反选块真的把这些包放进了仓库（`assets/lodes/` 目录本身没被忽略，所以 ! 有效）
  for (const id of BUNDLED_LODE_IDS) {
    assert.match(current, new RegExp(`^!assets/lodes/${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.json$`, 'm'))
  }
})

test('磁盘缓存上限：读不出数就回落到默认，绝不落到 0', async () => {
  const m = await import('../dist/shared/disk-cache.js')
  const { resolveDiskCacheMB, DEFAULT_DISK_CACHE_MB, MIN_DISK_CACHE_MB, MAX_DISK_CACHE_MB } = m.default ?? m

  // 0 是最危险的取值：Chromium 会把它当「用你自己的默认」，
  // 于是退回那个实测只有 103 MB 的上限，等于这个开关白设。
  for (const bad of [undefined, null, '', 'abc', NaN, 0, -1, -9999, {}]) {
    assert.equal(resolveDiskCacheMB(bad), DEFAULT_DISK_CACHE_MB, `${JSON.stringify(bad)} 应回落到默认值`)
  }
  // 钳制
  assert.equal(resolveDiskCacheMB(1), MIN_DISK_CACHE_MB, '过小的值要抬到下限')
  assert.equal(resolveDiskCacheMB(999999), MAX_DISK_CACHE_MB, '荒谬的大值要压到上限')
  // 正常值原样通过
  assert.equal(resolveDiskCacheMB(8192), 8192)
  assert.equal(resolveDiskCacheMB('4096'), 4096, '配置读回来可能是字符串')
  assert.equal(resolveDiskCacheMB(2048.7), 2048, '小数截断')
  // 默认值必须真的比 Chromium 自己挑的那个大一个量级，否则改了等于没改
  assert.ok(DEFAULT_DISK_CACHE_MB >= 2048, '默认值太小就留不住游戏素材')
})

test('磁盘缓存上限真的被设进 Chromium 开关', () => {
  const main = fs.readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
  assert.ok(main.includes("appendSwitch('disk-cache-size'"), '没设这个开关，缓存会停在 Chromium 自己那个过小的默认值')
  // 必须是字节数：这个开关的单位是字节，直接传 MB 会小 6 个数量级
  const line = main.split('\n').find((l) => l.includes("appendSwitch('disk-cache-size'"))
  assert.ok(line.includes('1024 * 1024'), `开关单位是字节，要把 MB 换算过去：${line.trim()}`)
})

test('对潜攻击不展示「本次攻击使用」——游戏那个字段给的是电探', async () => {
  const m = await import('../dist/shared/attack-equipment.js')
  const { attackEquipmentReliable } = m.default ?? m

  // 实测账本 #231/#216：五次对潜攻击 si_list 全是电探（506/315/88，type2=12），
  // 而同一批数据对水面舰给的都是主炮。所以只在打潜艇时封掉。
  assert.equal(attackEquipmentReliable(13), false, '潜水艦：si_list 不可信')
  assert.equal(attackEquipmentReliable(14), false, '潜水空母：si_list 不可信')

  // 水面目标一律照常显示，别把正常炮击的装备也吞了
  for (const stype of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16, 17, 18, 20, 21, 22]) {
    assert.equal(attackEquipmentReliable(stype), true, `舰种 ${stype} 是水面目标，装备应照常显示`)
  }

  // 取不到舰种时按可信处理——宁可多显示，也不要因为查不到主数据就整片消失
  for (const unknown of [undefined, null, NaN, Infinity]) {
    assert.equal(attackEquipmentReliable(unknown), true, `${unknown} 时不该误伤`)
  }
})

test('战斗行真的把可信度接进了装备标签的显示条件', () => {
  const di = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  assert.ok(di.includes('attackEquipmentReliable('), '没调用可信度判断')
  // 光调用不够——结果必须真的参与 usedEquipment 的条件，否则等于没接
  const line = di.split('\n').find((l) => l.includes('const usedEquipment ='))
  assert.ok(line, '找不到 usedEquipment 的赋值')
  assert.ok(
    line.includes('equipmentTrusted'),
    `可信度没参与显示条件，标签照样会冒出来：${line.trim()}`,
  )
})

test('学得会带随机串的立绘路径——那种路径推不出来，只能记', async () => {
  const m = await import('../dist/shared/ship-art-path.js')
  const { parseShipArtPath, shipArtKey, sanitizeShipArtMap } = m.default ?? m

  // 实测 2026-08-09：駆逐ラ級ζ-壊(2297) 的真实全身立绘路径。
  // 1270 是 createCipher(2297,'ship_full') 我们算得出，但还多了 _d 中缀
  // 和 12 位随机串——防的就是推导。按老格式拼的 2297_1270.png 只会 404。
  const real = '/kcs2/resources/ship/full/2297_d_1270_yjgagupbvcov.png'
  const got = parseShipArtPath(real)
  assert.ok(got, '带随机串的真实路径必须认得出来，否则这个功能等于没有')
  assert.equal(got.mstId, 2297)
  assert.equal(got.type, 'full')

  // 老格式照样要认
  assert.deepEqual(parseShipArtPath('/kcs2/resources/ship/banner/0628_6653.png'), {
    mstId: 628, type: 'banner', pathname: '/kcs2/resources/ship/banner/0628_6653.png',
  })
  // 清单外的类型也要收——banner_g_dmg 就是游戏在用而我们原先不知道的
  assert.equal(parseShipArtPath('/kcs2/resources/ship/banner_g_dmg/2297_d_6616.png')?.type, 'banner_g_dmg')
  assert.equal(parseShipArtPath('/kcs2/resources/ship/banner3/1518_8848.png')?.type, 'banner3')

  // 不是舰船美术的一律不收
  for (const no of [
    '/kcs2/resources/map/062/01_info.json',
    '/kcs2/resources/slot/card/0042_1234.png',
    '/kcs2/img/sortie/anything.png',
    '/kcs2/resources/ship/full/12_34.png', // id 不是 4 位，不是游戏的 padId
    '/evil/../kcs2/resources/ship/full/2297_1.png',
  ]) {
    assert.equal(parseShipArtPath(no), null, `不该收：${no}`)
  }

  // 存盘表要能挡住张冠李戴：键和路径对不上的条目直接丢
  const dirty = {
    [shipArtKey(2297, 'full')]: real,
    [shipArtKey(1501, 'full')]: real,          // 键说 1501，路径是 2297 → 丢
    'garbage': real,
    [shipArtKey(2297, 'banner')]: 12345,        // 不是字符串 → 丢
  }
  const clean = sanitizeShipArtMap(dirty)
  assert.deepEqual(Object.keys(clean), [shipArtKey(2297, 'full')], '只应留下自洽的那一条')
})

test('图鉴取图时学到的真实路径优先于推算路径', () => {
  const img = fs.readFileSync(new URL('../src/renderer/kcs-image.ts', import.meta.url), 'utf8')
  // 断言的是「学到的在 ?? 左边」这个意图，不是某段字面量的先后位置——
  // 上一版把推算路径的字面量当锚点，推算逻辑一提成函数护栏就误报了。
  // 2026-08-23 起路径推导只有 `shipImagePath` 一处（取图、查缓存、入档三个入口共用），
  // 所以这一行也只该出现一次——出现两次就说明有人又抄了一份推导。
  const lines = img.split('\n').filter((l) => l.includes('learnedArt.get(shipArtKey(mstId, ntype))'))
  assert.equal(lines.length, 1, '路径推导只该有一份（shipImagePath）')
  for (const l of lines) {
    const learned = l.indexOf('learnedArt.get')
    const nullish = l.indexOf('??')
    const guess = l.indexOf('guessArtPath')
    assert.ok(
      learned >= 0 && nullish > learned && guess > nullish,
      `顺序必须是「学到的 ?? 推算的」，写反了就永远用推算值：${l.trim()}`,
    )
  }
})

test('沉没横幅 banner_g 一律带 _dmg，深海舰也不例外', () => {
  const img = fs.readFileSync(new URL('../src/renderer/kcs-image.ts', import.meta.url), 'utf8')
  const start = img.indexOf('const resolveDamagedSuffix')
  assert.ok(start > 0, '找不到损伤后缀的判定函数')
  const body = img.slice(start, img.indexOf('\n}', start))

  // 顺序是这条规则的全部要害：banner_g 必须判在深海重置之前 return，
  // 否则深海舰会被抹回不带 _dmg 的路径——实测 2297 的真实资源是 banner_g_dmg。
  const gLine = body.indexOf("type === 'banner_g'")
  const abyssLine = body.indexOf('mstId > 1500')
  assert.ok(gLine > 0, 'banner_g 没有强制损伤形态')
  assert.ok(abyssLine > 0, '深海重置规则不见了')
  assert.ok(gLine < abyssLine, 'banner_g 必须判在深海重置之前，否则深海舰的沉没横幅路径会算错')

  // 2026-08-23 起路径推导收口到 `shipImagePath` 一处（损伤后缀 +「学到的真实路径优先」），
  // 各入口都从它拿：取图（shipImageUrl）、查本机已有的字节（localShipImage：
  // 缓存文件或档案实物）、以及「显示即入档」要用的那条身份
  //（availableShipImages / availableCostumeImages 的 pathname）。
  // 所以损伤后缀规则**只该被调用一次**——数量变多就说明有人又抄了一份，
  // 而抄岔了的表现是「图显示出来了、格子却不亮」（两边按不同的文件名各走各的），不报错。
  assert.equal(
    img.split('resolveDamagedSuffix(').length - 1,
    1,
    '损伤后缀规则被抄了第二份；它只该在 shipImagePath 里算一次',
  )
  for (const fn of [
    'shipImageUrl',
    'localShipImage',
    'availableShipImages',
    'availableCostumeImages',
  ]) {
    const at = img.indexOf(`const ${fn} = (`)
    assert.ok(at > 0, `找不到 ${fn}`)
    assert.ok(
      img.slice(at, img.indexOf('\n}', at)).includes('shipImagePath('),
      `${fn} 没走统一的路径推导`,
    )
  }
  // 清单里要有这一项，否则学到路径也不会显示
  assert.ok(img.includes("['banner_g', true,"), 'SHIP_IMG_WANTED 里没有沉没横幅')
})

test('全身立绘的文件名尾巴是 api_filename，不是随机串', async () => {
  // 一度判定这段尾巴无法推导、只能靠捕获游戏请求。实测推翻：语音目录 kc{filename}
  // 用的是同一个值——時雨改三语音在 kcxgkywfhkphjf/，立绘就叫
  // 0961_6849_xgkywfhkphjf.png。这条断言就是钉住这个对应关系。
  const img = fs.readFileSync(new URL('../src/renderer/kcs-image.ts', import.meta.url), 'utf8')

  // 尾巴只能加在 full 系列上：banner/card/remodel 的真实路径一条都没有这个尾巴，
  // 无差别地加会把本来正确的路径全变成 404
  const start = img.indexOf('const FULL_TYPES')
  assert.ok(start > 0, '没有限定哪些类型带 api_filename 尾巴')
  const decl = img.slice(start, img.indexOf('\n', start))
  assert.ok(decl.includes("'full'") && decl.includes("'full_dmg'"), 'full 系列要带尾巴')
  for (const t of ['banner', 'card', 'remodel', 'album_status', 'character_full']) {
    assert.ok(!decl.includes(`'${t}'`), `${t} 的真实路径没有 api_filename 尾巴，不能加`)
  }

  // 两个取图入口都要走同一套推算，别一处带尾巴一处不带
  const guessAt = img.indexOf('const guessArtPath')
  assert.ok(guessAt > 0, '推算路径没有收敛成一个函数')
  assert.ok(
    img.slice(guessAt, img.indexOf('\n}', guessAt)).includes('FULL_TYPES.has(ntype)'),
    '推算路径里没有按类型决定尾巴',
  )
  // 同上：推算路径也只在 shipImagePath 里调一次
  assert.equal(img.split('guessArtPath(').length - 1, 1, '推算路径只该在 shipImagePath 里调一次')

  // 学到的真实路径仍要压过推算值：2297 那种在 id 后插 `_d` 的变体推不出来
  const line = img.split('\n').find((l) => l.includes('learnedArt.get(shipArtKey(mstId, ntype)) ??'))
  assert.ok(line, '学到的路径没有作为首选')
})

test('对游戏服务器的请求不许自己造轮子，一律走 Chromium 网络栈', () => {
  // 判据来自用户：poi 那套用了近十年，独创的请求方式才可能踩雷。
  // poi 全仓库没有一处 https.get/http.get，网络请求一律 fetch / net.fetch。
  const files = ['src/renderer/kcs-image.ts', 'src/renderer/kcs-voice.ts', 'src/main/kcs-resource.ts', 'src/main/map-art-json.ts']
  for (const rel of files) {
    const src = fs.readFileSync(new URL('../' + rel, import.meta.url), 'utf8')
    for (const bad of ["require('https')", "require('http')", 'https.get(', 'http.get(']) {
      assert.ok(!src.includes(bad), `${rel} 用了 node 的 http 模块发请求（${bad}）——那条路不带 UA/Referer、不吃 HTTP 缓存，服务器侧看跟浏览器完全不同`)
    }
  }
})

test('海域美术元数据通道只放行游戏自己的那两个 JSON', () => {
  // 这个 IPC 对渲染层敞开，而矿脉数据会进同一个页面的 innerHTML；
  // 不钉死形状就等于给页面开了一个任意 URL 的代理。
  const src = fs.readFileSync(new URL('../src/main/map-art-json.ts', import.meta.url), 'utf8')
  assert.ok(src.includes('net.fetch('), '要走 Chromium 网络栈')
  assert.ok(src.includes("url.protocol !== 'https:'"), '只许 https')
  assert.ok(src.includes('kcs2/resources/map/'), '路径形状要钉死')
  assert.ok(src.includes('url.search'), '带查询串的地址要挡掉，否则路径校验可被绕开')
  assert.ok(/_\(\?:info\|image\)\\.json|info\|image/.test(src), '只放行 info/image 两个文件')
  assert.match(src, /AbortController/, '换成 net.fetch 后仍要保留请求超时')
  assert.match(src, /controller\.abort\(\)/, '超时必须真的中止请求，不能只结束等待')
})

test('远征方案缓存键覆盖所有会改变编成结论的舰娘状态', () => {
  const src = fs.readFileSync(new URL('../src/renderer/modules/bi.ts', import.meta.url), 'utf8')
  const at = src.indexOf('const planPoolSignature')
  const end = src.indexOf('const singlePlanCache', at)
  assert.ok(at > 0 && end > at, '找不到远征方案缓存签名')
  const body = src.slice(at, end)
  for (const fact of [
    'ship.shipId',
    'ship.karyoku',
    'ship.taiku',
    'ship.taisen',
    'ship.sakuteki',
    'ship.slot',
    'ship.slotEx',
    'deckOf.get(ship.id)',
  ]) {
    assert.ok(body.includes(fact), `缓存键漏了 ${fact}，状态变化后会继续复用旧方案`)
  }
})

test('分段折叠：各处的默认开合都按玩家定的口径来', () => {
  const ji = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const di = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')

  // 图鉴：属性、基础信息这些不折也不给折叠钮，其余默认折起来
  const at = ji.indexOf('const ALWAYS_OPEN')
  assert.ok(at > 0, '没有常驻段名单')
  const decl = ji.slice(at, ji.indexOf('\n', at))
  for (const name of ['属性', '装备槽', '装备加成', '估算数值', '作战概要']) {
    assert.ok(decl.includes(name), `「${name}」是打开就要看的段，不该可折叠`)
  }
  assert.ok(ji.includes('alwaysOpen: ALWAYS_OPEN'), '名单没接进折叠配置，等于白列')

  // 战斗：只折这三段，且战斗流水默认展开、另外两段默认折起来
  const cfgAt = di.indexOf('installSectionFolding(pane')
  assert.ok(cfgAt > 0, '战斗模块没启用分段折叠')
  const foldCfg = di.slice(cfgAt, cfgAt + 900)
  for (const name of ['战斗流水', '敌方编队', '当前点掉落']) {
    assert.ok(foldCfg.includes(name), `战斗模块该给「${name}」加折叠`)
  }
  assert.ok(foldCfg.includes('openByDefault'), '战斗流水要默认展开')
  const openLine = foldCfg.split('\n').find((l) => l.includes('openByDefault'))
  assert.ok(openLine.includes('战斗流水'), '默认展开的只该是战斗流水')
  assert.ok(!openLine.includes('敌方编队') && !openLine.includes('当前点掉落'), '这两段该默认折起来')
  // only 是必须的：右栏还有别的 .scard，不限定就会把它们一起折了
  assert.ok(foldCfg.includes('only:'), '没限定范围，右栏其他卡片会被误折')
})

test('折叠机制：状态按标题记，且 MutationObserver 不能自激', () => {
  const fold = fs.readFileSync(new URL('../src/renderer/section-fold.ts', import.meta.url), 'utf8')
  // 渲染是整棵 innerHTML 换掉，位置索引对不上，只能按标题文本记
  assert.ok(/opened\.(has|add|delete)/.test(fold), '没记住展开状态，重渲染后会自己收回去')
  // 渲染出口有十来个，逐个补调用迟早漏一处
  assert.ok(fold.includes('new MutationObserver'), '没盯 DOM 变化，换一个对象折叠状态就没了')
  const obsAt = fold.indexOf('new MutationObserver')
  const obsBlock = fold.slice(obsAt, obsAt + 200)
  assert.ok(obsBlock.includes('childList: true'), '要监听 childList')
  assert.ok(!obsBlock.includes('attributes: true'), '别监听 attributes，自己改属性会把自己再触发一遍')
  // 标题里的链接与小开关点了各有各的事，不能顺手折叠。
  // .tg 是战斗流水标题里的「展开全部 miss/零伤」，它就长在标题行上——
  // 不排除的话点它会连流水一起折起来。
  const guard = fold.split('\n').find((l) => l.includes(".closest('.el,"))
  assert.ok(guard, '点标题里的链接不该触发折叠')
  for (const sel of ['.el', 'a', 'button', 'input', '.tg']) {
    assert.ok(guard.includes(sel), `${sel} 该排除在折叠点击之外`)
  }
})

test('折叠三角不能被各模块原有的色条压掉', () => {
  const css = rendererSource
  const at = css.indexOf('.mod-ji .sec-h {')
  assert.ok(at > 0, '找不到分组标题样式')
  const rule = css.slice(at, css.indexOf('}', at))
  // 原本是 var(--sub)，比正文还淡，分类一多就扫不到
  assert.ok(!rule.includes('color: var(--sub)'), '标题不能用次要文字色，扫视时找不到')
  assert.ok(rule.includes('color: var(--text)'), '标题要用正文色')

  // 通用折叠规则（不认类名，靠 section-fold.ts 打的属性）
  assert.ok(css.includes('[data-foldable] > [data-fold-head]::before'), '缺少折叠三角')
  assert.ok(
    css.includes('[data-foldable]:not([data-open]) > *:not([data-fold-head])'),
    '折叠时没有隐藏内容',
  )

  // 要害：模块原有的 ::before 色条优先级比通用规则高，不写 :not([data-foldable])
  // 就会一直画色条、三角根本出不来。这个坑踩过一次。
  for (const sel of ['.mod-ji .sec:not([data-foldable])', '.mod-di .scard:not([data-foldable])']) {
    assert.ok(css.includes(sel), `${sel} 没给三角让位，折叠标记画不出来`)
  }
  // 战斗流水是 flex:1 撑满剩余高度的，折起来必须塌回一行
  assert.ok(
    css.includes('.mod-di .log[data-foldable]:not([data-open])'),
    '战斗流水折起来后没让它塌回去，会留一大片空白',
  )
})

test('深海同族归并要剥掉层层套的形态后缀', async () => {
  const m = await import('../dist/shared/abyss-family.js')
  const { abyssFamilyKey } = m.default ?? m

  // 这条是真踩过的：原实现先试 mode 再试壊，遇到「…バカンスmode-壊」时
  // mode 规则不匹配（那时结尾是「壊」），剥完壊已经没机会回头剥 mode，
  // 于是它自成一族、跟本体分了家。实测修好后族数 188 → 180。
  const base = abyssFamilyKey('集積地棲姫')
  for (const name of [
    '集積地棲姫',
    '集積地棲姫-壊',
    '集積地棲姫 バカンスmode',
    '集積地棲姫 バカンスmode-壊', // ← 三层后缀，就是它当年漏网
    '集積地棲姫改',
    '集積地棲姫改-壊',
  ]) {
    assert.equal(abyssFamilyKey(name), base, `「${name}」该跟本体同族`)
  }

  // II 是另一艘舰，绝不能被剥掉——剥了会把两族并成一族
  assert.notEqual(abyssFamilyKey('集積地棲姫II'), base, 'II 是别的舰，不是形态后缀')
  assert.equal(
    abyssFamilyKey('集積地棲姫II バカンスmode-壊'),
    abyssFamilyKey('集積地棲姫II'),
    'II 自己的形态还是要归到 II 名下',
  )

  // 剥离必须收敛，别写出会自增长的规则
  assert.equal(abyssFamilyKey('駆逐ラ級ζ'), abyssFamilyKey('駆逐ラ級ζ-壊'))
  assert.equal(abyssFamilyKey(''), '')
})

test('战斗里击沉的舰用灰色横幅，取不到时退回普通横幅而不是文字', () => {
  const art = fs.readFileSync(new URL('../src/renderer/entity-art.ts', import.meta.url), 'utf8')
  const di = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')

  assert.ok(art.includes("shipImageUrl(mstId, 'banner_g')"), '沉没态没去取灰色横幅')
  // 关键：banner_g 不是每艘都有，掉到文字占位比显示一张正常横幅差得多
  assert.ok(art.includes('data-thumb-fallback'), '没给灰色横幅备后路')
  const at = art.indexOf("img.matches('[data-ship-thumb]')")
  const handler = art.slice(at, art.indexOf('} else if', at))
  assert.ok(handler.includes('data-thumb-fallback'), '404 时没有先试后路')
  assert.ok(
    handler.indexOf('data-thumb-fallback') < handler.indexOf("classList.add('fallback')"),
    '得先退回普通横幅，再考虑文字占位',
  )
  // 补图路径也要认沉没态，否则重渲染后灰色横幅会被换回普通的
  assert.ok(art.includes('data-ship-sunk'), 'hydrate 补图时会丢掉沉没态')

  // 战斗行的沉没态跟着选中的阶段走（血条回放），但仍排除演习击破——演习不算真沉
  const line = di.split('\n').find((l) => l.includes("shipThumbHtml(ship.mstId, ship.name"))
  assert.ok(line, '找不到战斗行的缩略图')
  assert.ok(line.includes('sunk: view.sunkVisual'), `战斗行没接沉没态：${line.trim()}`)
  assert.match(
    di,
    /sunkVisual: sunkNow && !b\.practice/,
    '沉没判定不该改口径：演习击破不涂沉',
  )
})

test('kcwiki 的「图纸」字段是整串消耗，不能当数字用', async () => {
  const m = await import('../dist/shared/kcwiki-upgrade.js')
  const { parseKcwikiNeeds } = m.default ?? m

  // 真实踩过的那条：字段名叫「图纸」，装的却是「高速建造材x30 开发资材x180」。
  // 旧代码 parseInt 得 NaN，`stock >= NaN` 恒 false，于是拿改装设计图的库存
  // 去判一个根本不要图纸的改装，白白报「不足」。
  const needs = parseKcwikiNeeds('高速建造材x30 开发资材x180')
  assert.equal(needs.length, 2)
  assert.deepEqual(
    needs.map((n) => [n.name, n.count, n.kind, n.id]),
    [
      ['高速建造材', 30, 'useitem', 2],
      ['开发资材', 180, 'useitem', 3],
    ],
  )
  // 真是图纸的时候也要认得
  assert.deepEqual(parseKcwikiNeeds('改装设计图x2'), [
    { name: '改装设计图', count: 2, kind: 'useitem', id: 58 },
  ])
  // 全角×、混入装备、空值
  assert.equal(parseKcwikiNeeds('新型高温高压锅炉×2')[0].kind, 'slotitem')
  assert.deepEqual(parseKcwikiNeeds(undefined), [])
  assert.deepEqual(parseKcwikiNeeds(''), [])
  // 对不上别名表的必须留成 unknown 且没有 id——调用方要据此说「库存未知」而不是瞎判
  const odd = parseKcwikiNeeds('某种没见过的材料x3')[0]
  assert.equal(odd.kind, 'unknown')
  assert.equal(odd.id, undefined)
})

test('编队「下一改装」逐项对库存，不拿图纸库存顶别的材料', () => {
  const ru = fs.readFileSync(new URL('../src/renderer/modules/ru.ts', import.meta.url), 'utf8')
  assert.ok(!ru.includes('图纸×${blueprint}'), '还在把整串消耗当图纸数量显示')
  assert.ok(!/parseInt\(blueprint/.test(ru), '还在 parseInt 那个串')
  assert.ok(ru.includes('parseKcwikiNeeds('), '没改用共用解析')
  // 不知道就说不知道
  assert.ok(ru.includes('库存未知'), '缺少「不知道」这一档')
  const at = ru.indexOf('const remodelNeedStock')
  assert.ok(at > 0, '没有逐项查库存的函数')
  const fn = ru.slice(at, ru.indexOf('\n}', at))
  assert.ok(fn.includes('return null'), '对不上的项要返回 null 而不是硬给个数')
})

test('日期一律 ISO，不跟系统 locale 走', () => {
  const kernel = fs.readFileSync(new URL('../src/renderer/kernel.ts', import.meta.url), 'utf8')
  assert.match(kernel, /export const fmtDate = /, 'kernel 没有统一的日期格式化')
  assert.match(kernel, /getFullYear\(\)\}-\$\{pad\(d\.getMonth\(\) \+ 1\)\}-\$\{pad\(d\.getDate\(\)\)\}/, '不是 YYYY-MM-DD')

  // 裸 toLocaleDateString()/toLocaleString() 会给出 09/08/2026 这种日/月歧义写法。
  // 数字的 toLocaleString()（千分位）不在此列，所以只查跟在 Date 后面的。
  for (const rel of ['modules/di.ts', 'modules/ji.ts', 'modules/lg.ts', 'modules/shi.ts', 'modules/yu.ts']) {
    const src = fs.readFileSync(new URL(`../src/renderer/${rel}`, import.meta.url), 'utf8')
    const bad = [...src.matchAll(/new Date\([^)]*\)\.toLocale(?:Date|Time)?String\(\s*\)/g)]
    assert.equal(bad.length, 0, `${rel} 还有跟系统 locale 走的日期：${bad.map((m) => m[0]).join(', ')}`)
  }
})

const mapIntelTestPack = new URL('../assets/lodes/map-intel.json', import.meta.url)
test('掉落反查：按舰答「去哪捞」，不越界替目录下判断', {
  skip: fs.existsSync(mapIntelTestPack) ? false : '缺 map-intel 矿脉包',
}, async () => {
  const m = await import('../dist/shared/map-intel.js')
  const { applyMapIntelCatalog, confirmedDropSitesOf } = m.default ?? m
  const catalog = JSON.parse(
    fs.readFileSync(mapIntelTestPack, 'utf8'),
  )
  assert.ok(applyMapIntelCatalog(catalog.data ?? catalog), '随包目录载不进去')

  // 反查得出得来东西，而且形状对
  const musuki = confirmedDropSitesOf(1) // 睦月：常驻，掉点很多
  assert.ok(musuki.length > 5, `睦月该有不少掉点，实得 ${musuki.length}`)
  for (const site of musuki) {
    assert.match(site.map, /^\d+-\d+$/, `海域代号不对：${site.map}`)
    assert.ok(Array.isArray(site.nodes) && site.nodes.length, '点位不能为空')
    assert.equal(typeof site.limited, 'boolean')
    assert.equal(typeof site.limitedOnly, 'boolean')
  }
  // 同一张图不该被拆成多行——点位要并进同一条
  const codes = musuki.map((s) => `${s.map}|${s.difficulty ?? ''}`)
  assert.equal(new Set(codes).size, codes.length, '同图同难度出现了重复行')

  // 目录没收录的必须返回空数组，让调用方说「未列出 ≠ 确认不掉」，
  // 而不是编一个掉点出来
  assert.deepEqual(confirmedDropSitesOf(999999), [])

  // 换目录要让索引作废，否则会拿旧目录答新问题
  assert.ok(applyMapIntelCatalog({ schemaVersion: 1, maps: {} }))
  assert.deepEqual(confirmedDropSitesOf(1), [], '换了空目录还答得出掉点 = 索引没失效')
})

test('舰娘「获取」页先答去哪捞，链根掉点不冒充自己的', () => {
  const ji = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const at = ji.indexOf('const confirmedDropHtml')
  assert.ok(at > 0, '没有确认掉落的反查渲染')
  const fn = ji.slice(at, ji.indexOf('\nconst shipDropHtml', at))
  // 「未列出 ≠ 确认不掉」「掉率不在这份资料的范围内」两句折叠块按文案清扫裁定
  //（族 4）删。它们护的行为是「只摆确认能掉的，一条都不编」——那条行为的落点是
  // confirmedDropSitesOf 的空数组契约（同文件另有一测钉着），这里不再钉措辞。
  // 改造形态不掉落，要指向链根并写明，不能默默拿链根的掉点冒充自己的
  assert.ok(fn.includes('rootOf.get(mstId)'), '没有回退到改造链根')
  assert.ok(fn.includes('的掉点'), '拿链根掉点时没写明是谁的')
  assert.match(fn, /未改造形态/, '抬头没标这是链根的掉点')
  // 顺序：离线目录在前，本地遭遇志在后
  const drop = ji.slice(ji.indexOf("shipState.dtab === 'p-drop'"))
  assert.ok(
    drop.indexOf('confirmedDropHtml') < drop.indexOf('shipDropHtml'),
    '「去哪捞」应排在「你捞到过哪」前面',
  )
})

test('限定掉落带上截止日，同图多点取最早关门的那个', async () => {
  const m = await import('../dist/shared/map-intel.js')
  const { applyMapIntelCatalog, confirmedDropSitesOf } = m.default ?? m
  const win = (until) => ({ from: '2025-01-01', until, lastConfirmedAt: '2026-01-01' })
  assert.ok(
    applyMapIntelCatalog({
      schemaVersion: 1,
      maps: {
        '9-9': {
          source: 's', sourceUrl: 'u', checkedAt: '2026-01-01', revision: 'r',
          nodes: {
            A: { ships: [{ id: 700, limited: win('2026-12-31') }], emptyDrop: 'unknown', enemyComps: [] },
            B: { ships: [{ id: 700, limited: win('2026-09-01') }], emptyDrop: 'unknown', enemyComps: [] },
            C: { ships: [{ id: 701 }], emptyDrop: 'unknown', enemyComps: [] },
          },
        },
      },
    }),
  )
  const [site] = confirmedDropSitesOf(700, '2026-08-09')
  assert.equal(site.nodes.length, 2, '同图两点该并进一条')
  // 玩家要按最紧的那条安排行程，取晚的那个日期等于给了个宽松的假期限
  assert.equal(site.limitedUntil, '2026-09-01', '该取最早关门的截止日')
  assert.equal(site.limited, true)

  // 没有限定期的条目 limitedUntil 必须是 null，不能拿别人的日期填
  const [plain] = confirmedDropSitesOf(701, '2026-08-09')
  assert.equal(plain.limitedUntil, null)
  assert.equal(plain.limited, false)
})

const mapEnemyCompsPack = new URL('../assets/lodes/map-enemy-comps.json', import.meta.url)
test('敌编成换源：37 常规图逐条带 mstId，且只换编成这一域', {
  skip:
    fs.existsSync(mapEnemyCompsPack) && fs.existsSync(mapIntelTestPack)
      ? false
      : '缺 map-intel / map-enemy-comps 矿脉包',
}, async () => {
  const m = await import('../dist/shared/map-intel.js')
  const { applyMapEnemyComps, applyMapIntelCatalog, enemyCompIds, mapIntelEntries, mapIntelNode } =
    m.default ?? m
  const base = JSON.parse(fs.readFileSync(mapIntelTestPack, 'utf8')).data
  const comps = JSON.parse(fs.readFileSync(mapEnemyCompsPack, 'utf8')).data

  const snapshot = () => {
    const out = new Map()
    for (const [code, entry] of mapIntelEntries()) {
      const layers = entry.nodes
        ? [[undefined, entry.nodes]]
        : Object.entries(entry.difficulties ?? {}).map(([d, layer]) => [d, layer.nodes])
      for (const [difficulty, nodes] of layers) {
        for (const node of Object.keys(nodes)) {
          const resolved = mapIntelNode(code, node, '2026-08-22', difficulty)
          if (!resolved) continue
          out.set(`${code}|${difficulty ?? ''}|${node}`, {
            drops: resolved.ships.map((ship) => ship.id).sort((a, b) => a - b).join(','),
            emptyDrop: resolved.emptyDrop,
            comps: resolved.enemyComps
              .map((comp) => (enemyCompIds(comp) ?? []).join(','))
              .filter(Boolean)
              .sort(),
          })
        }
      }
    }
    return out
  }

  assert.ok(applyMapIntelCatalog(base), '底座载不进去')
  const before = snapshot()
  assert.ok(applyMapEnemyComps(comps), '汇编层载不进去')
  const after = snapshot()

  // ① 换源的收益：常规图的编成从此逐条有号。定不下来的编成在战斗前是黑盒——
  //    精确档整条跳过，玩家只能看模糊命中。
  let regular = 0
  let resolved = 0
  for (const [code, entry] of mapIntelEntries()) {
    if (!entry.nodes || !/^[1-7]-\d$/.test(code)) continue
    for (const node of Object.values(entry.nodes)) {
      for (const comp of node.enemyComps) {
        regular += 1
        if (enemyCompIds(comp)) resolved += 1
      }
    }
  }
  assert.ok(regular > 1_200, `常规图敌编成条数异常少：${regular}`)
  assert.equal(resolved, regular, `常规图还有 ${regular - resolved} 条编成定不到 mstId`)

  // ② 只换编成：掉落、空掉落标记、点位一格都不许动——这一改只迁一个域，
  //    整包换掉会把还没换源的掉落/限定期一起弄丢。
  assert.equal(after.size, before.size, '叠加后点位数变了')
  for (const [key, was] of before) {
    const now = after.get(key)
    assert.ok(now, `点位 ${key} 在叠加后消失了`)
    assert.equal(now.drops, was.drops, `${key} 的掉落被改动了`)
    assert.equal(now.emptyDrop, was.emptyDrop, `${key} 的空掉落标记被改动了`)
    // ③ 编成只许多不许少：kcwiki 独有的照收，现包独有的也照收（单源不丢）
    const nowSet = new Set(now.comps)
    for (const comp of was.comps) {
      assert.ok(nowSet.has(comp), `${key} 丢了一条原有编成：${comp}`)
    }
  }

  // ④ labels 必须与 ships 等长：展示层按下标取名，错位一格就是在战斗界面上说错敌人是谁
  for (const map of Object.values(comps.maps)) {
    for (const [node, list] of Object.entries(map.nodes)) {
      for (const comp of list) {
        assert.ok(comp.ships.every((id) => Number.isInteger(id) && id > 0), `${node} 的 ships 不全是号`)
        if (comp.labels) assert.equal(comp.labels.length, comp.ships.length, `${node} 的 labels 长度对不上`)
        assert.ok(Array.isArray(comp.votes) && comp.votes.length, `${node} 的编成没有印证票`)
      }
    }
  }
})

test('汇编层在没有底座时自建条目，但活动图的难度层一格不碰', async () => {
  const m = await import('../dist/shared/map-intel.js')
  const { applyMapEnemyComps, applyMapIntelCatalog, mapIntelMap, mapIntelNode } = m.default ?? m
  const node = (comps) => ({ ships: [{ id: 1 }], emptyDrop: 'unknown', enemyComps: comps })
  assert.ok(
    applyMapIntelCatalog({
      schemaVersion: 1,
      maps: {
        '9-1': {
          source: 's', sourceUrl: 'u', checkedAt: '2026-01-01', revision: 'r',
          nodes: { A: node([{ formation: 1, ships: ['駆逐イ級'] }]) },
        },
        '62-9': {
          source: 's', sourceUrl: 'u', checkedAt: '2026-01-01', revision: 'r',
          difficulties: { 甲: { nodes: { A: node([{ formation: 1, ships: [1501] }]) } } },
        },
      },
    }),
  )
  assert.ok(
    applyMapEnemyComps({
      schemaVersion: 1,
      compiledAt: '2026-08-22',
      maps: {
        '9-1': {
          source: 'c', sourceUrl: 'u', checkedAt: '2026-08-22', revision: 'r',
          nodes: {
            A: [{ formation: 1, ships: [1501], labels: ['駆逐イ級'], votes: ['kcwiki'] }],
            B: [{ formation: 2, ships: [1502], labels: ['駆逐ロ級'], votes: ['kcwiki'] }],
          },
        },
        // 活动图：底座走 difficulties，汇编层这一改不管它
        '62-9': {
          source: 'c', sourceUrl: 'u', checkedAt: '2026-08-22', revision: 'r',
          nodes: { A: [{ formation: 9, ships: [9999], votes: ['kcwiki'] }] },
        },
        // 底座根本没有的图：**必须自建**。底座 map-intel 是禁品、永不随包，
        // 玩家那份产物里它只有内置兜底的 1-1——从前这里写「不新建」，
        // 结果 37 图敌编成/掉落在 1-1 以外整层被丢弃，界面上一律「本地目录待更新」。
        // 开发机照不出来（仓库里有底座），2026-08-22 发布前在产物上验收才抓到。
        '8-8': {
          source: 'c', sourceUrl: 'u', checkedAt: '2026-08-22', revision: 'r',
          nodes: { A: [{ formation: 1, ships: [1501], votes: ['kcwiki'] }] },
        },
      },
    }),
  )
  const a = mapIntelNode('9-1', 'A', '2026-08-22')
  assert.deepEqual(a.enemyComps[0].ships, [1501], '常规图的编成没被换掉')
  assert.deepEqual(a.ships, [{ id: 1 }], '掉落被顺手改了')
  assert.ok(mapIntelNode('9-1', 'B', '2026-08-22'), '汇编层多出的点没被收下')
  assert.deepEqual(
    mapIntelNode('62-9', 'A', '2026-08-22', '甲').enemyComps[0].ships,
    [1501],
    '活动图的难度层被汇编层覆盖了',
  )
  const built = mapIntelNode('8-8', 'A', '2026-08-22')
  assert.ok(built, '底座没有这张图，汇编层也没把它建出来——玩家档上这一层会整层丢掉')
  assert.deepEqual(built.enemyComps[0].ships, [1501])
  assert.deepEqual(built.ships, [], '编成层不许顺手编出掉落来')
  // 自建的图要带上汇编层自己的出处，别留空壳（「源」角标会读它）
  assert.equal(mapIntelMap('8-8', undefined).checkedAt, '2026-08-22')
  // 活动图（有这张图但走 difficulties）仍旧一格不碰：顶层 nodes 不许被建出来
  assert.equal(mapIntelMap('62-9', undefined), null, '活动图被塞了一层顶层 nodes')
})

const mapDropsPack = new URL('../assets/lodes/map-drops.json', import.meta.url)
const mapDropWindowsPack = new URL('../assets/lodes/map-drop-windows.json', import.meta.url)
test('掉落换源：丢失的原有条目 0 条，限定期换到第一方台账后一格不丢', {
  skip:
    fs.existsSync(mapDropsPack) &&
    fs.existsSync(mapIntelTestPack) &&
    fs.existsSync(mapDropWindowsPack)
      ? false
      : '缺 map-intel / map-drops / map-drop-windows 矿脉包',
}, async () => {
  const m = await import('../dist/shared/map-intel.js')
  const {
    applyMapDropWindows,
    applyMapDrops,
    applyMapIntelCatalog,
    mapIntelEntries,
    mapIntelNode,
    mapDropsInfo,
  } = m.default ?? m
  const base = JSON.parse(fs.readFileSync(mapIntelTestPack, 'utf8')).data
  const drops = JSON.parse(fs.readFileSync(mapDropsPack, 'utf8')).data
  const windows = JSON.parse(fs.readFileSync(mapDropWindowsPack, 'utf8')).data

  // 限定期用一个**固定的今天**取快照：真的今天会让「限定期已过就隐藏」的过滤
  // 在两次快照之间悄悄变，那样这条护栏会在某一天自己变绿又自己变红。
  const TODAY = '2026-08-22'
  const snapshot = () => {
    const out = new Map()
    for (const [code, entry] of mapIntelEntries()) {
      const layers = entry.nodes
        ? [[undefined, entry.nodes]]
        : Object.entries(entry.difficulties ?? {}).map(([d, layer]) => [d, layer.nodes])
      for (const [difficulty, nodes] of layers) {
        for (const node of Object.keys(nodes)) {
          const resolved = mapIntelNode(code, node, TODAY, difficulty)
          if (!resolved) continue
          out.set(`${code}|${difficulty ?? ''}|${node}`, {
            drops: resolved.ships.map((ship) => ship.id).sort((a, b) => a - b),
            emptyDrop: resolved.emptyDrop,
            comps: resolved.enemyComps.length,
            limited: resolved.ships
              .filter((ship) => ship.limited || ship.limitedOnly || ship.limitedHistory)
              .map((ship) =>
                [
                  ship.id,
                  ship.limited?.from ?? '',
                  ship.limited?.until ?? '',
                  ship.limitedOnly ? 'only' : '',
                  ship.limitedHistory?.length ?? 0,
                ].join('/'),
              )
              .sort(),
          })
        }
      }
    }
    return out
  }

  // 台账里判了「已终了」的那几格：这些点位会（也应该）从当前掉落池里消失
  const endedPoints = new Set()
  for (const [code, layer] of Object.entries(windows.maps)) {
    for (const [node, list] of Object.entries(layer)) {
      for (const one of list) {
        const status = one.window?.status ?? 'active_confirmed'
        if (status === 'ended_undated' || status === 'ended_confirmed') {
          endedPoints.add(`${code}||${node}|${one.id}`)
        }
      }
    }
  }
  assert.ok(endedPoints.size > 0, '台账里一条已终了都没有——这条豁免该跟着删掉')

  assert.ok(applyMapIntelCatalog(base), '底座载不进去')
  const before = snapshot()
  assert.ok(applyMapDrops(drops), '掉落汇编层载不进去')
  const mid = snapshot()
  assert.ok(applyMapDropWindows(windows), '限定期台账载不进去')
  const after = snapshot()

  // 限定期这一域 2026-08-22 批次 4 起**只有台账一个出处**：掉落层叠完就该一条窗口都没有，
  // 全部由台账写回去。这条反向断言是「单一出处」的证据——掉落层要是还偷偷带着一份，
  // 两个出处会长期一致，直到某天不一致时谁也说不清界面上那个「限时」标是谁给的。
  let midLimited = 0
  for (const value of mid.values()) midLimited += value.limited.length
  assert.equal(midLimited, 0, '掉落层叠完还带着限定期窗口——那一域该只有台账一个出处')

  assert.equal(after.size, before.size, '叠加后点位数变了')
  let gained = 0
  for (const [key, was] of before) {
    const now = after.get(key)
    assert.ok(now, `点位 ${key} 在叠加后消失了`)
    // ① 单源照收不丢：现包独有的 2000 多条掉落一条都不许少（5-6 整图靠这条活着）
    const nowSet = new Set(now.drops)
    // 逐条裁过的**改钉**（LEGACY_DROP_FORM_CORRECTIONS）是唯一的例外：现包那一票记错了形态，
    // 改钉之后旧号当然不在了。「那一格还有没有这条船」照旧要成立，只是它现在指着对的那个形态。
    for (const id of was.drops) {
      const want = correctLegacyDropForm(id)
      // 台账判成**已终了**的限定条目是唯一会「少一条」的情形，而且是这一层的本职：
      // 上游指名说那批限定终了了，再把它摆在掉落池里就是继续指一条死路
      //（2026-08-28 鲑鱼 1-2-E 那一单）。允许消失的只有台账点名的那几格——
      // 别的地方少一条照旧当事故报，护栏不因此松口。
      if (endedPoints.has(`${key}|${want}`)) {
        assert.ok(!nowSet.has(want), `${key} 的 ${want} 台账判了已终了，却还留在掉落池里`)
        continue
      }
      assert.ok(
        nowSet.has(want),
        `${key} 丢了一条原有掉落：${id}${want === id ? '' : `（已裁定改钉为 ${want}）`}`,
      )
    }
    gained += now.drops.length - was.drops.length
    // ② 限定期窗口 2026-08-22 批次 4 从底座切到第一方台账 map-drop-windows：
    //    **换出处不许换内容**，144 条（92 条 limitedOnly、2 条带往期）一格不丢。
    //    丢了的表现是「限时标全没了」，而且形状没变、一条报错都不会有。
    //    改钉过的号在这里也要按改钉后的号比：窗口必须**跟着新号走**，
    //    既不许丢（那就是「宗谷只在限定期掉」这句话悄悄消失），也不许留在旧号上。
    const wasLimited = was.limited.map((line) => {
      const [id, ...rest] = line.split('/')
      return [correctLegacyDropForm(Number(id)), ...rest].join('/')
    })
    assert.deepEqual(now.limited, wasLimited.sort(), `${key} 的限定期被叠加弄丢或改了`)
    // ③ 空掉落标记从现包票取，值必须与底座一致
    assert.equal(now.emptyDrop, was.emptyDrop, `${key} 的空掉落标记被改动了`)
    // ④ 编成那一格不归这一层管
    assert.equal(now.comps, was.comps, `${key} 的敌编成被掉落层碰了`)
  }
  assert.ok(gained > 0, '换源没有带来任何新增条目——上游或解析可能坏了')

  // ⑤ 基线计数护栏（照批次 0 的 compare 报告口径）：跌破就是上游改版或解析器坏了，
  //    不是「社区又编辑了几条」
  let mapCount = 0
  let dropNodes = 0
  let shipRefs = 0
  for (const [code, entry] of Object.entries(drops.maps)) {
    assert.match(code, /^[1-7]-\d$/, `汇编层出现了非常规图 ${code}`)
    mapCount += 1
    for (const [node, value] of Object.entries(entry.nodes)) {
      if (value.ships.length) dropNodes += 1
      shipRefs += value.ships.length
      for (const ship of value.ships) {
        assert.ok(Array.isArray(ship.votes) && ship.votes.length, `${code}/${node} 的掉落没有印证票`)
        assert.equal(ship.limited, undefined, `${code}/${node} 混进了限定期字段`)
      }
    }
  }
  assert.equal(mapCount, 37)
  assert.ok(dropNodes >= 220, `掉落点只剩 ${dropNodes} 个（基线 ≥ 220）`)
  assert.ok(shipRefs >= 8_500, `掉落舰次只剩 ${shipRefs} 条（基线 ≥ 8500）`)
  // ⑥ 上游自述照录进包：掉落域算票的独立性判据全在这一行上
  assert.ok(
    drops.sourceNotes?.some((note) => note.includes('日wiki')),
    '包里没留上游的来源自述——那是「两 wiki 不独立」这条判断的唯一证据',
  )
  // ⑦ 展示层的「源」角标要说这一格数据自己的日期，不拿底座的日期背书
  assert.equal(mapDropsInfo('1-1').checkedAt, drops.maps['1-1'].checkedAt)
  assert.equal(mapDropsInfo('62-1'), null, '活动图没被这一层覆盖，该返回 null 让调用方退回底座')

  // ⑧ 台账规模基线：迁移前后逐条对过的那几个数。跌破就是迁移或装配漏了一大片。
  let ledgerEntries = 0
  let onlyCount = 0
  let historyCount = 0
  for (const [code, layer] of Object.entries(windows.maps)) {
    assert.match(code, /^[1-7]-\d$/, `台账出现了非常规图 ${code}`)
    for (const list of Object.values(layer)) {
      for (const one of list) {
        ledgerEntries += 1
        if (one.limitedOnly) onlyCount += 1
        if (one.history?.length) historyCount += 1
        // 每条必须写清凭什么与录入日期——没有凭据的台账条目与凭空捏造无法区分
        assert.ok(one.evidence?.kind, `${code} 的台账条目缺 evidence`)
        assert.match(one.evidence.recordedAt, /^\d{4}-\d{2}-\d{2}$/)
      }
    }
  }
  // 迁移基线 144；2026-08-28 补进 34 条「已终了」（上游用删除线逐条标出来的那批）
  assert.equal(ledgerEntries, 178, `限定期台账 ${ledgerEntries} 条（144 迁移基线 + 34 已终了）`)
  assert.equal(onlyCount, 126, `limitedOnly ${onlyCount} 条（92 迁移基线 + 34 已终了）`)
  assert.equal(historyCount, 2, `带往期窗口 ${historyCount} 条（迁移基线 2）`)
})

test('玩家那份产物没有底座：37 图掉落/编成/限定期照样全量可见', {
  skip:
    fs.existsSync(mapDropsPack) &&
    fs.existsSync(mapEnemyCompsPack) &&
    fs.existsSync(mapDropWindowsPack)
      ? false
      : '缺 map-drops / map-enemy-comps / map-drop-windows 矿脉包',
}, async () => {
  // 2026-08-22 发布前验收抓到的 🔴 大病：三个叠加函数都写着「底座没有的图不新建」，
  // 而底座 map-intel 是禁品、**永不随包**——玩家那份产物里它只有内置兜底的 1-1，
  // 于是 37 图掉落 + 37 图敌编成 + 25 图限定期在 1-1 以外整层被丢弃，
  // 界面上一律「本地目录待更新」。开发机照不出来（仓库里有底座）。
  //
  // 这条护栏就是把「玩家档」这个场景钉住：**先装一个空底座**（比真实情况还严——
  // 连内置 1-1 都没有），只叠随包那三层，然后数它。
  const m = await import('../dist/shared/map-intel.js')
  const {
    applyMapDropWindows,
    applyMapDrops,
    applyMapEnemyComps,
    applyMapIntelCatalog,
    mapIntelEntries,
    mapIntelNode,
  } = m.default ?? m
  const health = await import('../dist/shared/lode-health.js')
  const { mapIntelHealth } = health.default ?? health

  assert.ok(applyMapIntelCatalog({ schemaVersion: 1, maps: {} }), '空底座载不进去')
  assert.ok(applyMapEnemyComps(JSON.parse(fs.readFileSync(mapEnemyCompsPack, 'utf8')).data))
  assert.ok(applyMapDrops(JSON.parse(fs.readFileSync(mapDropsPack, 'utf8')).data))
  assert.ok(applyMapDropWindows(JSON.parse(fs.readFileSync(mapDropWindowsPack, 'utf8')).data))

  let nodes = 0
  let rawShips = 0
  let rawLimited = 0
  let comps = 0
  let shownShips = 0
  let shownLimited = 0
  for (const [code, entry] of mapIntelEntries()) {
    assert.match(code, /^[1-7]-\d$/, `玩家档里冒出了非常规图 ${code}`)
    for (const [name, raw] of Object.entries(entry.nodes ?? {})) {
      nodes += 1
      rawShips += raw.ships.length
      rawLimited += raw.ships.filter((ship) => ship.limited).length
      comps += raw.enemyComps.length
      // mapIntelNode 是「现在去哪捞」那一路：不再持续的限定专属条目由它隐去
      const node = mapIntelNode(code, name, '2026-08-22')
      shownShips += node.ships.length
      shownLimited += node.ships.filter((ship) => ship.limited).length
    }
  }
  // 与「有底座」那条迁移对照同一组数字：换掉底座不许改变常规图这三域的任何一格
  assert.equal(mapIntelEntries().length, 37, '玩家档只装出了这么几张图')
  assert.equal(nodes, 300)
  assert.equal(rawShips, 10_851)
  assert.equal(comps, 1_312)
  assert.equal(rawLimited, 178)
  // 隐去的是两批：那 10 条「上游不再列出、日子不明」的，加 2026-08-28 补进的
  // 34 条「上游指名说它终了」的——两批都只在限定期掉，都不该再摆给玩家当
  // 「现在去这儿捞」。数据里一条没删（上面 178 还在），隐的只是呈现。
  assert.equal(rawShips - shownShips, 44)
  assert.equal(shownLimited, 134)
  // 抽三张 1-1 以外的图逐项点一遍——只测 1-1 正是这个病躲过去的原因
  for (const code of ['1-5', '3-2', '7-3']) {
    const entry = mapIntelEntries().find(([key]) => key === code)?.[1]
    assert.ok(entry?.nodes && Object.keys(entry.nodes).length, `${code} 一个点都没有`)
    const total = Object.keys(entry.nodes).reduce(
      (sum, name) => sum + mapIntelNode(code, name, '2026-08-22').ships.length,
      0,
    )
    assert.ok(total > 0, `${code} 一条掉落都没有`)
    assert.ok(entry.checkedAt && entry.revision, `${code} 自建条目没带上出处`)
  }
  // 健康度那张卡也得跟着说真话（它从前读底座包的原文，玩家档上报 0/0）
  const stats = mapIntelHealth(m.mapIntelCatalog ? m.mapIntelCatalog() : null)
  assert.equal(stats.normalCovered, 37)
  assert.equal(stats.normalTotal, 37)
  assert.equal(stats.comps.pinned, stats.comps.total, '玩家档上应当全部有号')
})

test('捞船清单：分组按「会不会消失」而不是「有没有日期」，不造紧迫感', () => {
  const ji = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const at = ji.indexOf('const huntPlanHtml')
  assert.ok(at > 0, '没有捞船规划')
  const fn = ji.slice(at, ji.indexOf('\nconst shipCatalogHtml', at))
  // 舰C 里「有没有日期」和「会不会消失」不是一回事：常规图的限定掉落多是追加后
  // 一直开着的（kcwiki 本来就不给截止日），活动图才是真的会消失。
  // 拿「没有日期」当「快关门」催玩家，是凭空造出来的紧迫感。
  //
  // 那一整块口径折叠（「未列出 ≠ 确认不掉。没有倒计时 ≠ 不会结束。…」）与
  // 「活动结束后这些掉点就没了」按文案清扫裁定（族 4 与族 3）删了。护栏不放松，
  // 只是从「措辞在不在」换成「分组行为对不对」——文案能删，分组不能塌：
  assert.ok(fn.includes("s.event?.status === 'active'"), '没有把活动图单独分出来')
  // ① 活动组与常规限定组必须是**两个不同的组**，不能合并成一句「限定」
  assert.ok(fn.includes('const limitedStanding = '), '常规图限定组没了')
  assert.ok(fn.includes('当前活动图可捞'), '活动组抬头没了')
  assert.ok(fn.includes('限定掉落 · 常规图'), '常规图限定组抬头没了')
  // ② 只有真的算得出剩余天数的才进「限定期将至」；没有日期一律不催
  assert.ok(fn.includes('e.days != null && e.days <= HUNT_SOON_DAYS'), '「快关门」组的判据松了')
  assert.ok(!fn.includes('资料未写截止日'), 'null 是如实记录，不该说成资料没写')
  // ③ 活动结束的那批一条都不删，只换语境
  assert.ok(fn.includes('活动已结束 · 对应掉落当前不可获取'), '活动结束的那批被删掉了')
  // 截断要说出来
  assert.ok(fn.includes('另有 ${standing.length - shownStanding.length} 艘未列出'), '常驻组截断没写明')
})

test('改修预算：分档单价乘次数，通常/确保双单价不混成范围', async () => {
  const m = await import('../dist/shared/improve-budget.js')
  const { improveBudgetTo, mergeImproveBudgets, improveCostText, IMPROVE_MAX } = m.default ?? m

  const costs = {
    fuel: 10, ammo: 20, steel: 40, baux: 0,
    p1: { devmats: 2, devmats_sli: 2, screws: 1, screws_sli: 2, equips: [{ id: 1, eq_count: 1 }] },
    p2: { devmats: 2, devmats_sli: 3, screws: 1, screws_sli: 2, equips: [{ id: 1, eq_count: 2 }] },
  }

  // 次数按包内 ★0-5 / ★6-9 划分：★0 起手 6 次 p1 + 4 次 p2 = 10 次到满
  const full = improveBudgetTo(costs, 0)
  assert.equal(full.p1Times, 6)
  assert.equal(full.p2Times, 4)
  assert.equal(full.p1Times + full.p2Times, IMPROVE_MAX)
  // x/y 是「通常/确保」双单价（wikiwiki 原表头：必要資材(通常/確実)），
  // 不是浮动范围——2026-08-12 用户抓的实锤，此前误标成「48~62 范围」。
  // 开发资材 通常 = 6×2+4×2 = 20；全程确保 = 6×2+4×3 = 24
  assert.deepEqual(full.devmats, { normal: 6 * 2 + 4 * 2, certain: 6 * 2 + 4 * 3 })
  assert.equal(improveCostText(full.devmats), '20 · 确保 24')
  assert.equal(improveCostText(full.screws), '10 · 确保 20') // 10 次 × 通常1/确保2
  assert.equal(full.equips.get(1), 6 * 1 + 4 * 2)
  assert.equal(full.fuel, 10 * 10)
  // 两侧同值时只给一个数（此时通常=确保，无需区分）
  assert.equal(improveCostText({ normal: 12, certain: 12 }), '12')

  // 已经推过一半的只算剩下的
  const from6 = improveBudgetTo(costs, 6)
  assert.equal(from6.p1Times, 0)
  assert.equal(from6.p2Times, 4)
  assert.equal(improveCostText(from6.devmats), '8 · 确保 12')

  // 满星不该再报消耗
  const maxed = improveBudgetTo(costs, IMPROVE_MAX)
  assert.equal(maxed.p1Times + maxed.p2Times, 0)
  assert.equal(maxed.devmats.certain, 0)
  assert.equal(maxed.equips.size, 0)

  // 越界与脏数据不能算出负数或 NaN
  for (const bad of [-3, 99, 3.7]) {
    const b = improveBudgetTo(costs, bad)
    assert.ok(b.p1Times >= 0 && b.p2Times >= 0, `★${bad} 算出负次数`)
    assert.ok(Number.isFinite(b.devmats.certain), `★${bad} 算出 NaN`)
  }
  // 资料缺确保侧时退化成通常同值，不能崩也不能混进 0
  assert.equal(improveBudgetTo({ p1: { devmats: 2 } }, 0).devmats.certain, 12)
  assert.equal(improveBudgetTo(null, 0).devmats.certain, 0)

  // 合账：多件相加，双单价各自相加
  const total = mergeImproveBudgets([full, from6, from6])
  assert.equal(total.p1Times + total.p2Times, 10 + 4 + 4)
  assert.equal(improveCostText(total.devmats), '36 · 确保 48')
  assert.equal(total.equips.get(1), 14 + 8 + 8)
})

test('改修预算栏要摆出次数与口径，不只给一个合计数字', async () => {
  // 2026-08-25 改修卡回归设计稿骨架时，这条从「钉源码字面量」改成对着
  // 真渲染出来的两行下断言——原写法钉的是 improveBudgetHtml 里的模板片段，
  // 把判断写反了它照样绿（反模式二，见 shared/source-pattern-guards-miss-logic-bugs）。
  const { improveCardHtml } = await import('./fixtures/render-improve-card.mjs')
  const p1 = { devmats: 2, devmats_sli: 3, screws: 1, screws_sli: 2, equips: [{ id: 1, eq_count: 1 }] }
  const p2 = { devmats: 8, devmats_sli: 12, screws: 4, screws_sli: 6 }
  const conv = { devmats: 30, devmats_sli: 50, screws: 6, screws_sli: 10 }
  const 卡 = (instances, materials) =>
    improveCardHtml({
      equip: { api_id: 1, api_name: '样本炮' },
      equips: { 1: { api_id: 1, api_name: '样本炮' } },
      ships: { 91: { api_id: 91, api_name: '样本舰' } },
      materials,
      instances,
      eo: {
        eq_id: 1,
        improvement: [
          {
            basis: '整理参照',
            helpers: [{ ship_ids: [91], days: [1] }],
            convert: { id_after: 2, lvl_after: 0 },
            costs: { p1, p2, conv },
          },
        ],
      },
    })
  const sumsOf = (html) =>
    [...html.matchAll(/<div class="ak-sum"([^>]*)>([\s\S]*?)<\/div>/g)].map(([, attrs, body]) => ({
      attrs,
      body,
    }))

  // 次数要能核对：分档次数摆在推满那一行的悬停里
  const 一件 = sumsOf(卡([['1', { level: 0 }]], { 6: 9999, 7: 9999 }))
  assert.match(一件[0].body, /还需 <b>10<\/b> 次/, '没给升至 ★max 还需几次')
  assert.match(一件[0].attrs, /★0-5 档 6 次、★6-9 档 4 次/, '没交代这 10 次是怎么分档的')

  // **算一件**，不是把持有的全推满：97 件全推满会报出「968 次」，吓人且没有决策价值
  const 九十七件 = sumsOf(卡(Array.from({ length: 97 }, (_, i) => [`${i}`, { level: 0 }]), { 6: 9999, 7: 9999 }))
  assert.equal(九十七件[0].body, 一件[0].body, '预算随持有件数放大了——该按一件算')
  // 星级分布归并成「★0 ×97」，不是逐个列 97 遍
  assert.match(九十七件[0].attrs, /持有 97 件：★0 ×97/, '星级分布没归并')

  // 起点取手上**最高但未满**的那件：那才是会拿去推的那一件
  const 混合 = sumsOf(卡([['1', { level: 0 }], ['2', { level: 9 }]], { 6: 9999, 7: 9999 }))
  assert.match(混合[0].body, /升至 <b>★9→★max<\/b> · 还需 <b>1<\/b> 次/, '起点没取最高未满的那件')

  // 通常/确保是两种打法，不是范围：储备判定按两侧分三档说
  const 够 = 一件[0].body
  assert.match(够, /<i class="ok"[^>]*>✓<\/i>/, '储备够也得说一句')
  assert.match(够, /title="储备 9999 · 确保消耗充足"/, '「确保侧也够」这一档没了')
  const 中间 = sumsOf(卡([['1', { level: 0 }]], { 6: 46, 7: 9999 }))[0].body
  assert.match(中间, /储备 46 · 确保消耗缺 \d+/, '「够通常打、确保不够」这一档没了')
  const 不够 = sumsOf(卡([['1', { level: 0 }]], { 6: 3, 7: 9999 }))[0].body
  assert.match(不够, /储备 3 · 普通消耗缺 \d+/, '「通常也不够」这一档没了')
  // 库存拿不到时不能装作够
  assert.match(sumsOf(卡([['1', { level: 0 }]], undefined))[0].body, /库存未同步/, '缺少库存未知这一档')

  // 推满那一笔**不含更新**；要不要更新是另一个决定，另起一行给整条路线的合计
  assert.equal(一件.length, 2, '「连更新一起算」那一行不在了')
  assert.match(一件[0].body, /<b>44 <i>\(66\)<\/i><\/b>/, '推满那一笔混进了更新的消耗')
  assert.match(一件[1].body, /含更新消耗[\s\S]*<b>74 <i>\(116\)<\/i><\/b>/, '整条路线的合计不对')
})

test('等级经验表从在籍舰反推，查不到就说查不到、绝不插值', async () => {
  const m = await import('../dist/shared/level-exp.js')
  const { levelExpPointsOf, mergeLevelExp, expToLevel } = m.default ?? m

  // api_exp = [累计, 距下一级, 进度]；未满级的舰给出「升到 lv+1 所需累计」
  const points = levelExpPointsOf([
    { lv: 1, expTotal: 0, expNext: 100 },
    { lv: 9, expTotal: 3600, expNext: 900 },
    { lv: 99, expTotal: 1000000, expNext: 0 }, // 满级，给不出点
  ])
  assert.equal(points.get(2), 100)
  assert.equal(points.get(10), 4500)
  assert.equal(points.has(100), false, '满级舰不该产出等级点')

  const table = new Map()
  assert.equal(mergeLevelExp(table, points), true, '首次并入该报告有变化')
  assert.equal(mergeLevelExp(table, points), false, '同样的点再并一次不该说有变化')
  // 游戏调过表的话，新观测才是对的
  assert.equal(mergeLevelExp(table, new Map([[2, 120]])), true)
  assert.equal(table.get(2), 120)

  // 差值 = 目标累计 - 当前累计
  const ship = { lv: 5, expTotal: 1000, expNext: 500 }
  assert.equal(expToLevel(table, ship, 10), 4500 - 1000)
  assert.equal(expToLevel(table, ship, 5), 0, '已达标该是 0')
  // 表里没有的等级：null，不许拿相邻等级插出一个看起来精确的错数
  assert.equal(expToLevel(table, ship, 35), null)
  assert.equal(expToLevel(new Map(), ship, 10), null)
})

test('「还差 N 级」算不出经验时要说明原因，不静默留白', () => {
  const ru = fs.readFileSync(new URL('../src/renderer/modules/ru.ts', import.meta.url), 'utf8')
  const at = ru.indexOf('const levelGapExpHtml')
  assert.ok(at > 0, '没有经验缺口那半句')
  const fn = ru.slice(at, ru.indexOf('\n// 下一改装', at))
  assert.ok(fn.includes('经验资料暂缺'), '算不出时该有可见的占位而不是空白')
  // 原来还钉着「矿脉未就绪 / 矿脉里没这一级」的分支与「实测出…会自动补上」三句。
  // 那三句已按裁定压成一条 title——「不静默留白」这条纪律由上一行的占位守住，
  // 这里改钉：占位必须带上说明为什么没有的 title，且这条 title 不许把
  // 矿脉/包/实测这类施工者词摊给玩家。
  assert.ok(
    fn.includes('title="${esc(`暂无 Lv${targetLevel} 的经验数据`)}"'),
    '占位没有说明「没有的是哪一级的数据」',
  )
  assert.ok(!/矿脉|包内|实测/.test(fn), '算不出的说明里不该出现施工者词')
  // 表要真的在学，否则永远补不上
  assert.ok(ru.includes('observeLevelExp()'), '没有在渲染时学新的等级点')

  const shared = fs.readFileSync(new URL('../src/shared/level-exp.ts', import.meta.url), 'utf8')
  assert.ok(shared.includes('绝不插值补'), '缺少不插值的口径')
  assert.ok(!/interpolat|插值补全|estimate/i.test(shared.replace('绝不插值补', '')), '不该出现插值实现')
})

const shipExpTestPack = new URL('../assets/lodes/ship-exp.json', import.meta.url)
test('等级经验表用「从 Lv1 起算」的口径，不是结婚后重新计数的那套', {
  skip: fs.existsSync(shipExpTestPack) ? false : '缺 ship-exp 矿脉包',
}, () => {
  const pack = JSON.parse(
    fs.readFileSync(shipExpTestPack, 'utf8'),
  )
  const at = (level) => pack.data[String(level)]?.[1]

  // 低段两套口径一致，分不出来
  assert.equal(at(2), 100)
  assert.equal(at(10), 4500)
  assert.equal(at(35), 59500)
  assert.equal(at(99), 1_000_000)

  // Lv100 以上才见真章，而且**两个 wiki 都不能照搬**（2026-08-09 逐个核过）：
  //   wikiwiki.jp/kancolle「経験値」  Lv100 = 0、Lv130 =   785,000
  //   zh.kcwiki「经验值和头衔」        同上
  //   KC3Kai exp_ship.json           Lv130 = 1,785,000
  //   本地实测（api_exp[0] 反推）      Lv130 = 1,785,000  ← 游戏就是这个口径
  // 两个 wiki 是给人看的，结婚后从 0 重新数更直观；KC3Kai 是工具、跟 API 对齐。
  // 照搬任一 wiki 的表，Lv100 以上会全部少算 1,000,000。
  assert.equal(at(130), 1_785_000, 'Lv130 必须是从 Lv1 起算的 1,785,000')
  assert.equal(at(155), 5_470_000)
  assert.equal(at(188), 20_200_000)

  // Lv99→100 靠结婚而非经验，所以 Lv99 的 next 是 0、两级累计相同（都是 1,000,000）。
  // 要钉的是「Lv100 不是 0」——kcwiki 那套在这里正好是 0。
  assert.equal(at(100), 1_000_000, 'Lv100 被重置成了结婚后基准')
  assert.equal(pack.data['99'][0], 0, 'Lv99 该是升不上去（靠结婚）')
  let previous = -1
  for (let level = 1; level <= 188; level++) {
    const value = at(level)
    assert.ok(typeof value === 'number', `Lv${level} 缺失`)
    assert.ok(value >= previous, `Lv${level} 累计经验倒退`)
    previous = value
  }
})

test('沙盘是本地推演：只读舰的真实状态，绝不写回游戏', () => {
  const ru = fs.readFileSync(new URL('../src/renderer/modules/ru.ts', import.meta.url), 'utf8')
  const box = fs.readFileSync(new URL('../src/renderer/sandbox-fleet.ts', import.meta.url), 'utf8')

  // 状态住在共享模块：海域详情的路线预测也要读它，那才是它真正的用处
  assert.match(box, /export const SANDBOX_DECK_ID = -1/)
  assert.ok(box.includes('export const sandboxDeck'), '没有把沙盘包成 Deck')
  // 解体/改造掉的舰要自动掉出，否则面板会对着不存在的 rosterId 算
  assert.ok(box.includes('ships.filter((id) => mg.ships[id])'), '没有过滤掉已不存在的舰')

  // 关键纪律：沙盘只能改本地状态。任何写回游戏的调用都是越界——
  // 项目口径是「阵形/夜战/进退在游戏内操作，这里绝不代打」，编成同理。
  assert.ok(!/api_req|ipcRenderer\.(send|invoke)/.test(box), '沙盘不该发任何游戏请求')
  // 带方括号的是事件绑定里的选择器；不带的是渲染出来的属性，别切错地方
  const wireAt = ru.indexOf("'[data-sandbox-add]'")
  assert.ok(wireAt > 0, '找不到沙盘的事件绑定')
  const wire = ru.slice(wireAt, wireAt + 1200)
  assert.ok(!/api_req|ipcRenderer\.(send|invoke)/.test(wire), '沙盘的事件不该发游戏请求')

  // 装备沿用那艘舰当前的真实状态，不假装能换装
  // 2026-08-26 文案清扫：页脚两句去掉自表白（「不写回游戏」「取自这些舰当前的实际状态」），
  // 「这一页不是真舰队」仍由页脚措辞区分开；不写回那件事由上面的结构护栏守着
  assert.ok(ru.includes('装备与改修取当前状态'), '没说明装备取自何处')
  assert.ok(ru.includes("sandboxActive ? '本地推演' : '与游戏状态实时同步'"), '页脚没跟真实舰队区分开')
})

test('沙盘能当一支舰队拿去推演海域，且永远不算联合编组', () => {
  const forecast = fs.readFileSync(
    new URL('../src/renderer/combat-forecast.ts', import.meta.url),
    'utf8',
  )
  const ji = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')

  // 三条取舰路径都要认沙盘，漏一条就会拿空编成去算，得出「这套编成走不通」的错结论
  assert.ok(
    forecast.includes('id === SANDBOX_DECK_ID ? sandboxDeck()'),
    '预测取舰没认沙盘',
  )
  assert.ok(ji.includes('id === SANDBOX_DECK_ID ? sandboxDeck()'), '带路条件/kcnav 取舰没认沙盘')
  assert.equal(
    (ji.match(/id === SANDBOX_DECK_ID \? sandboxDeck\(\)/g) ?? []).length,
    2,
    '带路条件与 kcnav 编成两处都要认',
  )

  // 联合编组是游戏状态，沙盘没有——不特判会把 deckIds 算成 [1,2] 去 mg.decks 里捞
  const scopeAt = forecast.indexOf('export const forecastDeckScope')
  const scope = forecast.slice(scopeAt, forecast.indexOf('\n}', scopeAt))
  assert.ok(scope.includes('SANDBOX_DECK_ID'), '编组作用域没给沙盘特判')
  assert.ok(scope.includes('combinedType: 0'), '沙盘该永远是单队')

  // 没挑人时不该往选择器里塞一支空舰队
  assert.ok(ji.includes('sandboxRosterIds().length ? '), '空沙盘也进了舰队选择器')
})

test('开发表按日文名匹配，出货率标成估算而不是规则', () => {
  const ji = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const at = ji.indexOf('const devRecipeHtml')
  assert.ok(at > 0, '没有开发段')
  const fn = ji.slice(at, ji.indexOf('\nconst abyssCatalogHtml', at))

  // 表里用的是日文名，按 api_name 直查；绝不做模糊匹配——猜错会把配方安到别的装备上
  assert.ok(fn.includes('equipment?.[jpName]'), '没有按日文名直查')
  assert.match(ji, /devRecipeHtml\(e\.api_name,/, '装备详情没传日文名')

  // 游戏内部的开发表不公开，页面上的百分比是玩家攒出来的。那条口径折叠按文案
  // 清扫裁定（族 4）删了，但「必须标成估算」这条不放松——短词落在抬头 aux 上，
  // 与数值同屏，比折叠里那句更早被看到。
  assert.ok(fn.includes('社区统计估算'), '没把出货率标成估算')
  // 没收录的装备不摆空段——但你自己的开发实测是另一份数据，它该照常出现
  assert.ok(fn.includes('if (!list?.length) return mine'), '没收录时该整段不出现（自己的实测除外）')

  // wiki 的推定出货率与自己的实测并列，不合并：样本量差几个数量级
  assert.match(ji, /const factoryOwnHtml = /)
  assert.ok(ji.includes("factoryOwnHtml(mstId, 'item')"), '装备页没接上自己的开发实测')
  assert.ok(ji.includes("factoryOwnHtml(shipState.selectedForm, 'ship')"), '舰娘页没接上自己的建造实测')
  // 读失败要说读失败——空报告会被渲染成「你没造出过她」。辩护半句按文案清扫
  // 裁定（族 5）删，只留失败态本身；护栏钉的仍是「失败与空态是两个分支」。
  assert.match(ji, /工厂记录读取失败/)
  assert.match(ji, /if \(factoryStatsFailed\) \{/)
  // 账本里压根没有工厂记录时不摆空壳：那是「还没开始记」，不是「你没出过」
  assert.ok(ji.includes("if (!found.totalAttempts) return ''"), '没有工厂记录时该整段不出现')

  const parser = fs.readFileSync(new URL('../scripts/dev-recipes.mjs', import.meta.url), 'utf8')
  // 「－」是「这个组合开不出来」，当成 0 收进来会变成一条假的可行配方
  assert.ok(parser.includes('parseRate'), '没有单独处理出货率')
  assert.match(parser, /return null/, '开不出的组合该返回 null 而不是 0')
  // 秘书舰类型只认页面用的四种，别的丢掉而不是猜
  assert.ok(parser.includes("['砲戦系', '水雷系', '空母系', '潜水系']"), '秘书舰类型没有白名单')
})

test('全局速查只做直达，实体 id 从键取而不是从元素取', () => {
  const cp = fs.readFileSync(new URL('../src/renderer/command-palette.ts', import.meta.url), 'utf8')

  // mg.master.ships 等都是 Record<id, {...}>，id 在键上。
  // 从元素取会拿到 NaN，每条都被静默跳过——症状是「搜什么都是零结果」，
  // 而且不报错，实测栽过一次。
  assert.ok(cp.includes('Object.entries(mg.master.ships'), '舰娘该按键取 id')
  assert.ok(cp.includes('Object.entries(mg.master.slotitems'), '装备该按键取 id')
  assert.ok(!/Object\.values\(mg\.master\.(ships|slotitems)/.test(cp), '别再从元素里取 id')

  // 跳转一律交给 EntityLink，不自己实现落点，否则会和页面上的链接跳到两个地方
  assert.ok(cp.includes('navigate(item.ref)'), '没走 EntityLink')
  assert.ok(!/activateModule\(/.test(cp), '不该自己决定打开哪个模块')

  // 深海舰有自己的卷，混进来会让搜索结果里出现点不开的条目
  assert.ok(cp.includes('id >= 1500) continue'), '没排除深海侧的 id 段')

  // 启动时要独立隔离：命令面板坏掉不该拖累模块装配
  const index = fs.readFileSync(new URL('../src/renderer/index.ts', import.meta.url), 'utf8')
  assert.match(index, /initCommandPalette\(\)/)
  assert.match(index, /recordCrash\('startup:command-palette'/)
})

test('捞船清单可点筛选，且能退出', () => {
  const ji = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  assert.ok(ji.includes("huntFilter: '' as '' | 'catchable' | 'event'"), '没有筛选状态')
  assert.ok(ji.includes('data-hunt-filter="catchable"'), '「能查到掉点的 N 艘」不可点')
  assert.ok(ji.includes('data-hunt-filter="event"'), '「在当前活动图」不可点')
  // 它长在 <summary> 里，不拦默认行为会顺手把 details 折起来
  assert.ok(ji.includes('e.preventDefault() //'), '点筛选时没拦 summary 的默认行为')
  // 筛进去要能出来，否则看着像列表坏了
  assert.ok(ji.includes('hunt-active'), '筛选生效时没有可见提示')
  assert.ok(ji.includes('退出筛选'), '没有退出筛选的入口')
  // 只看「还缺的」——已持有的不该出现在捞船筛选里
  const at = ji.indexOf('if (shipState.huntFilter) {')
  const block = ji.slice(at, at + 420)
  assert.ok(block.includes('chainInstances(root.api_id).length > 0) return false'), '没排除已持有的')
})

test('预测区间配微条，大破用另一种色', () => {
  const ji = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const html = rendererSource
  assert.ok(ji.includes('const rangeBarHtml'), '没有微条')
  assert.ok(ji.includes("rangeBarHtml(band?.taiha, 'risk')"), '大破没走风险色')
  assert.ok(ji.includes("rangeBarHtml(band?.bPlus, 'good')"), 'B+ 没配微条')
  // 区间为零宽时也要看得见
  assert.ok(ji.includes('Math.max(1.5, hi - lo)'), '零宽区间会看不见')
  assert.match(html, /\.mbar\.risk::after \{ background: var\(--bad\)/, '风险色没跟正向区分开')
})

test('色板：次级文字可读，实体色两两分得开', () => {
  const html = rendererSource
  const varOf = (name) => {
    const hit = html.match(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})'))
    assert.ok(hit, `找不到 --${name}`)
    return hit[1]
  }
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const lin = (c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4)
  const lum = (hex) => {
    const [r, g, b] = rgb(hex).map(lin)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const contrast = (a, b) => {
    const [x, y] = [lum(a), lum(b)]
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
  }
  const lab = (hex) => {
    const [r, g, b] = rgb(hex).map(lin)
    const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047
    const y = r * 0.2126 + g * 0.7152 + b * 0.0722
    const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]
  }
  const deltaE = (a, b) => {
    const [A, B] = [lab(a), lab(b)]
    return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2])
  }

  // --dim 承担的是 11~11.5px 的小字：来源落款、辅助说明、页脚口径。
  // 「谁说的、多新」是这个项目的立身内容，不该是全 UI 最难读的字。
  // 原先 #5c6f7f 在 bg1 只有 3.30、bg3 掉到 2.62——连大字线 3.0 都不到。
  const dim = varOf('dim')
  assert.ok(contrast(dim, varOf('bg1')) >= 4.5, `--dim 在 bg1 只有 ${contrast(dim, varOf('bg1')).toFixed(2)}:1`)
  assert.ok(contrast(dim, varOf('bg3')) >= 3.5, `--dim 在 bg3 只有 ${contrast(dim, varOf('bg3')).toFixed(2)}:1`)
  // 但它仍是次级：跟 --sub 拉开层级，别一路提亮到分不出主次
  assert.ok(contrast(dim, varOf('bg1')) < contrast(varOf('sub'), varOf('bg1')), '--dim 不该亮过 --sub')

  // 实体色只表达「它是什么」，所以两两必须分得开。
  // 曾经 expedition(#efa46f) × material(#d9a06f) 只差 ΔE 8.9，而任务详情里
  // 「远征要求」和「资材奖励」会同屏出现。
  const entities = [...html.matchAll(/--entity-([a-z]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]])
  assert.ok(entities.length >= 12, `实体色只找到 ${entities.length} 个`)
  for (let i = 0; i < entities.length; i += 1) {
    for (let j = i + 1; j < entities.length; j += 1) {
      const d = deltaE(entities[i][1], entities[j][1])
      assert.ok(d >= 15, `${entities[i][0]} × ${entities[j][0]} 色差只有 ΔE ${d.toFixed(1)}`)
    }
  }
  // 实体色也要读得清——它们是链接文字，不是装饰
  for (const [name, hex] of entities) {
    const c = contrast(hex, varOf('bg1'))
    assert.ok(c >= 4.5, `--entity-${name} 在 bg1 只有 ${c.toFixed(2)}:1`)
  }

  // 2026-08-16 跨族挪档：状态/资源/功能三套体系与实体色之间曾撞车
  //（夜战↔开发资材同值 ΔE 0.0、警告↔铝土 8.6、任务↔开发 7.9、舰娘↔建造 10.9）。
  // 「同屏会共存的跨族对」必须 ΔE≥15——族内护栏拦不住这种杂乱感的来源。
  const crossPairs = [
    ['warn', 'r-baux'], ['gold', 'r-baux'], ['entity-item', 'r-baux'], ['entity-expedition', 'r-baux'],
    ['gold', 'r-ammo'], ['entity-item', 'r-ammo'], ['entity-material', 'r-ammo'],
    ['entity-quest', 'r-dev'], ['entity-fleet', 'r-dev'], ['voice-dmg-sunk', 'r-dev'],
    ['entity-quest', 'night'], ['entity-fleet', 'night'],
    ['entity-ship', 'r-build'], ['r-steel', 'r-build'], ['entity-fleet', 'r-build'],
    ['entity-equip', 'dock'], ['accent', 'dock'], ['entity-ship', 'dock'],
    ['r-baux', 'r-ammo'],
    // 2026-08-21 顶栏远征三态：同一枚「远」组里三队可以各占一态——
    // 在外(dock) / 归来(gold) / 未补给(warn) 会并排出现，三者两两必须一眼分得开。
    ['gold', 'warn'], ['gold', 'dock'], ['warn', 'dock'],
  ]
  for (const [a, b] of crossPairs) {
    const d = deltaE(varOf(a), varOf(b))
    assert.ok(d >= 15, `${a} × ${b} 同屏共存却只差 ΔE ${d.toFixed(1)}`)
  }
  // 接受的例外（挪它们代价大于收益，理由如下；再挤近就当场红）：
  // accent↔entity-ship：两者都是可点元素，混淆无害；挪舰娘蓝会动摇全局实体身份。
  // night↔r-dev：夜战芯片与开发资材几乎不同屏，分开到 ≥10 即可（曾同值）。
  assert.ok(deltaE(varOf('accent'), varOf('entity-ship')) >= 12, 'accent 与舰娘蓝挤到 ΔE 12 以下了')
  assert.ok(deltaE(varOf('night'), varOf('r-dev')) >= 10, '夜战与开发资材又挤回同色了')

  // 应急修理的绿色两档：同一战两艘各发动一种时两张横幅会并排挂着，
  // 「哪张是女神」必须一眼看出来，所以两档之间照实体色的标准算 ΔE≥15。
  const crew = varOf('damecon-crew')
  const goddess = varOf('damecon-goddess')
  assert.ok(
    deltaE(crew, goddess) >= 15,
    `要員绿 × 女神绿只差 ΔE ${deltaE(crew, goddess).toFixed(1)}，并排看会糊成一档`,
  )
  // 也不能被读成「又一条强化成功」——那条 Toast 用的是 --ok
  for (const [name, hex] of [['crew', crew], ['goddess', goddess]]) {
    assert.ok(
      deltaE(hex, varOf('ok')) >= 12,
      `--damecon-${name} 与 --ok 只差 ΔE ${deltaE(hex, varOf('ok')).toFixed(1)}`,
    )
    // 横幅标题就用这两个色，是字不是装饰
    assert.ok(
      contrast(hex, varOf('bg1')) >= 4.5,
      `--damecon-${name} 在 bg1 只有 ${contrast(hex, varOf('bg1')).toFixed(2)}:1`,
    )
  }

  // ケッコンカッコカリ 的粉。调色板里粉的邻居很多，而这一枚**必须一眼不是警报**：
  // 深海亮字、大破弹幕红、螺丝、演习粉、图鉴的结婚耐久段都在同一片色域里。
  // 婚礼横幅与大破横幅能同屏（母港办婚礼时上一趟出击的红横幅可能还没关），
  // 所以照实体色的标准算 ΔE≥15。
  const wedding = varOf('wedding')
  for (const neighbour of [
    'entity-abyss', 'abyss-ink', 'abyss-soft', 'voice-dmg-heavy', 'voice-dmg-sunk',
    'r-screw', 'entity-practice', 'stat-marriage', 'bad', 'gold',
  ]) {
    const d = deltaE(wedding, varOf(neighbour))
    assert.ok(d >= 15, `--wedding × --${neighbour} 只差 ΔE ${d.toFixed(1)}，会被读成同一件事`)
  }
  // 它是横幅标题与婚礼字幕的**文字**色，不是装饰
  assert.ok(
    contrast(wedding, varOf('bg1')) >= 4.5,
    `--wedding 在 bg1 只有 ${contrast(wedding, varOf('bg1')).toFixed(2)}:1`,
  )
  // 字幕压在游戏画面上（最深处按 bg0 算），同样要读得清
  assert.ok(
    contrast(wedding, varOf('bg0')) >= 4.5,
    `--wedding 在 bg0 只有 ${contrast(wedding, varOf('bg0')).toFixed(2)}:1`,
  )
  // 花瓣受光面/上沿高光那一枚也是字（婚礼字幕的舰名用它）
  assert.ok(
    contrast(varOf('wedding-lit'), varOf('bg1')) >= 4.5,
    '--wedding-lit 在 bg1 读不清',
  )
  // rgba 吃不下 hex 变量，所以氛围光走 --wedding-rgb 三元组。
  // 两者必须是同一个颜色——分家了就是「横幅一种粉、外框另一种粉」，没人会发现。
  const rgbTriplet = html.match(/--wedding-rgb:\s*(\d+),\s*(\d+),\s*(\d+)/)
  assert.ok(rgbTriplet, '找不到 --wedding-rgb')
  assert.deepEqual(
    rgbTriplet.slice(1, 4).map(Number),
    rgb(wedding),
    '--wedding 与 --wedding-rgb 不是同一个颜色了',
  )
})

test('战损分段：昼夜各挨多少，算不圆就不显示', async () => {
  const m = await import('../dist/shared/battle-phase-damage.js')
  const { dealtByPhaseOf } = m.default ?? m

  // side 是数字 0/1/2（0 我方 / 1 敌方 / 2 NPC 友军），不是字符串。
  // 当成字符串比会一条伤害都匹配不到，而没受伤的舰恰好「对得上」——
  // 实测差点因此得出「83% 可用」的假结论。
  const battle = {
    attacks: [
      { phase: 'gun1', side: 0, attacker: 0, hits: [{ target: 3, damage: 30 }] },
      { phase: 'torp', side: 0, attacker: 0, hits: [{ target: 3, damage: 5 }] },
      { phase: 'night', side: 0, attacker: 0, hits: [{ target: 3, damage: 20 }] },
      { phase: 'gun1', side: 1, attacker: 0, hits: [{ target: 0, damage: 999 }] }, // 敌方出手，不算我方输出
      { phase: 'air', side: 0, attacker: -1, hits: [{ target: 3, damage: 40 }] }, // 航空无逐舰归属
    ],
  }
  assert.deepEqual(dealtByPhaseOf(battle, 0, false), { day: 35, night: 20 })
  assert.deepEqual(dealtByPhaseOf(battle, 0, true), { day: 999, night: 0 })
  // 航空那 40 点 attacker = -1，没算进 0 号（它同一场也出了手），也不属于别的谁——
  // 逐舰之和小于「输出合计」是事实，不去凑平
  assert.deepEqual(dealtByPhaseOf(battle, 1, false), { day: 0, night: 0 })
  assert.deepEqual(dealtByPhaseOf(null, 0, false), { day: 0, night: 0 })

  // 受伤的分段挪去了 battle-hp-timeline：那边照解析层的规则逐击重放，
  // 不再用「两个总数按顺序分配再截断」凑中间值（行为测试见 battle-hp-timeline.test.mjs）。
  // 这里只守输出列那半——它仍然按昼/夜两段归并。
  const phase = await import('../dist/shared/battle-hp-timeline.js')
  assert.equal(typeof (phase.default ?? phase).shipHpTimeline, 'function')
  assert.equal((m.default ?? m).phaseMidHp, undefined, '两套阶段血量并存迟早说法打架')
  assert.equal((m.default ?? m).phaseDamageOf, undefined, '受伤的昼夜拆分已由时间轴取代')

  const di = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  assert.ok(di.includes('shipHpTimeline(b.attacks, ship, enemySide, b.practice)'), '战斗行没接时间轴')
  assert.ok(di.includes('side === 1)'), 'side 该按数字判敌我')
  // 输出列的昼/夜谁先谁后由 battlePhaseOrder 说了算（夜转昼是反的），见下面那条测试。
  // 血条那边不再需要这个判据——时间轴按真实 stage 序走，顺序自带。
  assert.match(di, /DAY_NIGHT_LABEL\[order\.first\]/)
})

test('演习的获取经验开战前就能算准，且算不出时不猜', () => {
  const rule = fs.readFileSync(new URL('../src/shared/practice-exp.ts', import.meta.url), 'utf8')
  const battle = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  const levelExp = fs.readFileSync(new URL('../src/renderer/level-exp.ts', import.meta.url), 'utf8')

  // 出击的基础经验是逐点固定值（游戏不下发），而演习有公开的闭式公式，
  // 输入只有对手旗舰与 2 号舰的等级——开战前就摆在对手详情里。
  assert.match(rule, /export const practiceBaseExp = /)
  assert.match(rule, /flagCum \/ 100 \+ secondCum \/ 300/)
  // 超过 500 之后按 √ 增长，不再线性——高练度对手的收益迅速见顶
  assert.match(rule, /raw <= 500 \? raw : 500 \+ Math\.sqrt\(raw - 500\)/)
  // 评价补正：S ×1.2，A/B 平；演习败北侧倍率另有说法，不收
  assert.match(rule, /S: 1\.2/)
  assert.match(rule, /演习\*\*败北\*\*侧倍率另有说法，不收/)

  // 练巡（舰种 CT）加成照抄 wiki，两处保留也照抄：
  // 旗舰+随伴只看旗舰练度；随伴 2 只那档 wiki 自注「未検証」，给下界不给带问号的数
  assert.match(rule, /export const trainingCruiserBonusPct = /)
  assert.match(rule, /flagship: \[5, 8, 12, 15, 20\]/)
  assert.match(rule, /both: \[10, 13, 16, 20, 25\]/)
  assert.match(rule, /未検証/)
  assert.match(rule, /TRAINING_CRUISER_STYPE = 21/)

  // 累计经验实测优先于矿脉，两边都没有就算不出——不许插值
  assert.match(levelExp, /export const cumulativeExpAt = /)
  assert.match(levelExp, /return lodeTable\.get\(level\) \?\? null/)
  assert.match(battle, /等级经验表未就绪/)
  assert.match(battle, /practiceExpMetricHtml\(s, opponent\)/)
})

test('「有没有这艘舰」全域一个口径：改造表盖不全，改造链要靠 aftershipid 兜底', () => {
  const quests = fs.readFileSync(new URL('../src/renderer/modules/qn.ts', import.meta.url), 'utf8')
  const ownership = fs.readFileSync(new URL('../src/renderer/ship-ownership.ts', import.meta.url), 'utf8')

  // 实测：api_mst_shipupgrade 只覆盖需要设计图/图纸的那些改造，
  // Tuscaloosa 923→928 就没有条目。只认那张表的话，名字索引会把一条改造链
  // 切成两个分组，于是「持有改造后形态」被判成没有本体——
  // 任务的涉及舰娘灰着，而图鉴同时显示持有 ×1。
  // 用真实主数据核过：627 个分组里有 211 个会这样误判（睦月/大井/北上都在内）。
  assert.match(quests, /for \(const ship of friendly\) \{\s*\n\s*const after = Number\(ship\.api_aftershipid\)/)
  assert.match(quests, /改造表\*\*盖不全\*\*/)

  // 判定本身与图鉴共用一份：自己比 members 就是第二套口径，迟早再分叉
  assert.match(quests, /entry\.members\.some\(\(id\) => isShipFamilyOwned\(id\)\)/)
  assert.doesNotMatch(quests, /Object\.values\(mg\.ships\)\.some\(\(ship\) => entry\.members\.includes/)

  // 旧钉断言的是 ship-ownership 里那句手搓 union（`if (ship.afterShipId > 0) union(...)`）。
  // 它钉住的是**当时的写法**，而那套写法本身就漏了另一半：只吃 aftershipid，
  // 原生升级表独有的边（Tuscaloosa 923↔928 这类双方 aftershipid 都为 0 的）
  // 整条丢掉——一样把一条链切成两个家族，只是漏的方向反过来。
  // 现在归属改走 shared/ship-remodel-chain（纪律：手搓单值反向链一律违规），
  // 守卫的原意「两类边一条都不许漏」照钉，改成钉这个：
  assert.match(ownership, /buildShipRemodelChains\(/)
  assert.match(ownership, /afterId: ship\.afterShipId > 0 \? ship\.afterShipId : 0/)
  assert.match(ownership, /Object\.values\(mg\.master\.upgrades\)\s*\n?\s*\.flat\(\)/)
  assert.doesNotMatch(ownership, /const union = /, '归属不许再自己搓并查集')
  // 改造链随 ships **与** upgrades 一起失效：只看 ships 的话，升级表迟到的那一拨边进不来
  assert.match(
    ownership,
    /masterSource === mg\.master\.ships && upgradeSource === mg\.master\.upgrades/,
  )

  // 上面几条仍是源码钉。真正的判据钉成行为：两类边分别单独存在时都得并成一族。
  const aftershipOnly = buildShipRemodelChains(
    [
      { id: 501, sortNo: 1, afterId: 502 },
      { id: 502, sortNo: 2, afterId: 0 },
    ],
    [],
  )
  assert.equal(aftershipOnly.rootOf.get(502), 501, 'aftershipid 独有的边不许丢（旧口径钉的就是这条）')
  const upgradeOnly = buildShipRemodelChains(
    [
      { id: 923, sortNo: 923, afterId: 0 },
      { id: 928, sortNo: 928, afterId: 0 },
    ],
    [{ targetId: 928, currentShipId: 923, originalShipId: 923, stage: 1 }],
  )
  assert.equal(upgradeOnly.rootOf.get(928), 923, '升级表独有的边同样不许丢（旧口径漏的就是这条）')
  assert.deepEqual(upgradeOnly.chainOf.get(923), [923, 928])
})

test('阶段切换有两种顺序，只有一种阶段的场次不该被当成换过阶段', async () => {
  const m = await import('../dist/shared/battle-phase-damage.js')
  const { battlePhaseOrder } = m.default ?? m

  // 昼战打完追击夜战
  assert.deepEqual(battlePhaseOrder('day', true), { first: 'day', second: 'night' })
  // 开幕夜战、天亮转昼——**顺序相反**，早先这里被当成「不分段」整个漏掉了
  assert.deepEqual(battlePhaseOrder('nightday', true), { first: 'night', second: 'day' })
  assert.deepEqual(battlePhaseOrder('nightday', false), { first: 'night', second: 'day' })

  // nightonly 的 hasNight 也是 true，但从头到尾都是夜战，没换过阶段——
  // 当成有阶段会让血条凭空换一次基准
  assert.equal(battlePhaseOrder('nightonly', true), null)
  // 昼战还没合并夜战包时也没有阶段可分（实时观战先定格在昼战结果）
  assert.equal(battlePhaseOrder('day', false), null)
  for (const kind of ['airbattle', 'airraid', 'radar', 'baseDefense']) {
    assert.equal(battlePhaseOrder(kind, true), null, `${kind} 是单阶段节点`)
  }

  const di = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  // 输出列与血条共用同一个判据（phaseOrderOf → battlePhaseOrder），别一处认 nightday 一处不认
  assert.match(di, /const phaseOrderOf = \(b: BattleView \| null\) =>\s*\n\s*b \? battlePhaseOrder\(b\.kind, b\.hasNight\) : null/)
  // 标签按实际先后写，不写死「昼在前」
  assert.match(di, /DAY_NIGHT_LABEL\[order\.first\]/)
  assert.match(di, /DAY_NIGHT_LABEL\[order\.second\]/)
  assert.doesNotMatch(di, /kind !== 'nightday'/, '又把夜转昼排除了')
})

test('血条跟着流水走：满格恒为最大血，选中哪一阶段就显示那一刻', () => {
  const di = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  const bar = di.slice(di.indexOf('const hpBarValues'), di.indexOf('const browHtml'))

  // 玩家原话：「昼战：30/40，然后夜战的时候血条从 30 开始扣」。
  // 一度理解成把满格换成 30，结果打出「7/7 大破」——总血量不会因为换阶段就变少。
  // 三截的算术与「选中阶段」的语义有行为测试（battle-hp-timeline.test.mjs），
  // 这里守的是渲染层没有绕过它：分母只能是 hpMax。
  assert.match(bar, /hpBarSegments\(view\.hpMax, view\.hp, view\.before\)/)
  assert.doesNotMatch(di, /phaseBase/, '又把满格换成阶段基准了')
  // 虚条基准分两档：跟随最新时是昼/夜段的段首（昼战里掉的全是虚条，进夜战才归于空
  // ——曾锚在内部阶段上，伤害分散的舰虚条只剩最后一小口）；玩家点住某一阶段时是
  // 那一阶段自己，虚条只画这一阶段掉的。两档的行为测试在 battle-stage-hp-focus.test.mjs，
  // 这里守的是渲染层没有把某一档接错。
  assert.match(di, /hpAtStage\(timeline, stage, stage \?\? segmentStartOf\(b\.attacks\)\)/)
  assert.match(bar, /\$\{view\.hp\}\/\$\{view\.hpMax\}/, '数字要写「该时刻 cur/max」')
  // 颜色按绝对血量：这一阶段没挨打的舰新伤那截是空的，但它可能本来就是中破，
  // 那时涂成健康色会骗人
  assert.match(bar, /ratio: view\.hp \/ \(view\.hpMax \|\| 1\)/)
  assert.match(bar, /hpClass\(ratio\)/)

  // 实/虚/空三截永远都在（宽度可为 0）：切阶段是就地改 width，元素增删会让过渡不跑。
  // 虚条 = 最近一段结算掉的；更早掉的归于空，不再有第二种伤色。
  assert.match(bar, /class="dl" style="width:\$\{ghostPct\}%"/)
  assert.match(bar, /class="dd" style="width:\$\{emptyPct\}%"/)
  assert.match(di, /remain\.style\.width = `\$\{target\.solidPct\}%`/, '切阶段没有就地改宽度')
  assert.doesNotMatch(bar, /sunkVisual\s*\?\s*\{/, '沉没又被特判成整条伤色了——条子只按实/虚/空一套模型画')
  assert.doesNotMatch(
    di.slice(di.indexOf('const applySelectedLogStage')),
    /\.innerHTML = hpBarHtml/,
    '整块重建 DOM 会把过渡吃掉',
  )

  // 两拍时序：第一拍把旧虚条扣干（落到上一段结算位），第二拍才落实血、接新虚条
  const beat = di.slice(di.indexOf('const animateHpBar'), di.indexOf('const applySelectedLogStage'))
  assert.match(beat, /ghost\.style\.width = '0%'/, '没有先扣干旧虚条的那一拍')
  assert.match(beat, /prefers-reduced-motion/, '两拍时序要尊重 reduced-motion')
  // 同一场战斗的重渲染（实时进夜战）也要动画：先记旧条、重建后拨回再动画
  assert.match(di, /lastBarFlipIdentity/, '实时推进的重渲染丢了动画路径')

  // 虚条是红斜杠，空段不着色（底轨即空）
  const htmlSrc = rendererSource
  const ghostRule = htmlSrc.slice(htmlSrc.indexOf('.mod-di .hpx .bar .dl'))
  assert.match(
    ghostRule.slice(0, ghostRule.indexOf('}')),
    /repeating-linear-gradient\([^)]*var\(--bad\)/,
    '虚条不是红斜杠了',
  )
  const emptyRule = htmlSrc.slice(htmlSrc.indexOf('.mod-di .hpx .bar .dd'))
  assert.doesNotMatch(
    emptyRule.slice(0, emptyRule.indexOf('}')),
    /background/,
    '空段又被着色了——更早掉的血应该露出底轨',
  )
  // 聚焦某一阶段时虚条换成蓝斜杠：那一截的含义换了（本阶段掉的，不是本段累计），
  // 也得和残血红的实血分开。类挂没挂上有行为测试，这里守的是配色还在
  const pinnedRule = htmlSrc.slice(htmlSrc.indexOf('.mod-di .hpx .bar.pinned .dl'))
  assert.match(
    pinnedRule.slice(0, pinnedRule.indexOf('}')),
    /repeating-linear-gradient\([^)]*var\(--accent\)/,
    '聚焦时的虚条不是蓝斜杠了',
  )

  // 流水每一行都是锚点，且能退回跟随最新
  assert.match(di, /data-act="log-stage" data-log-stage="\$\{row\.stage\}"/)
  assert.match(di, /回到最终结果/)
  // 换一场、或本场结算落定时回到跟随；实时观战期间不重置
  assert.match(di, /const stageIdentity = `\$\{identity\}:\$\{b\?\.result \? 'done' : 'live'\}`/)

  const html = rendererSource
  assert.match(html, /\.mod-di \.hpx \.bar > span \{ transition: width var\(--motion-view\)/)
  const reduced = html.slice(html.indexOf('@media (prefers-reduced-motion: reduce)'))
  assert.ok(
    reduced.slice(0, reduced.indexOf('}\n')).includes('.mod-di .hpx .bar > span') ||
      /\.mod-di \.hpx \.bar > span \{ transition: none/.test(reduced) ||
      reduced.includes('.mod-di .hpx .bar > span { transition: none !important; }') ||
      reduced.includes('.mod-di .hpx .bar > span'),
    '血条过渡没有尊重 prefers-reduced-motion',
  )

  // 昼战阶段不换基准：hasNight 由 midnight 报文置真，
  // 所以实时观战会先定格在昼战结果，进夜战后才接上下一截
  const battle = fs.readFileSync(new URL('../src/main/mg/battle.ts', import.meta.url), 'utf8')
  assert.match(battle, /hasNight: night \|\| dawn/)
})

test('图鉴详情局部换块后必须重绑逐元素控件，且不许叠加面板级委托', () => {
  // 「重建后不补」全量扫描（2026-08-10）钉下的三条口径。玩家实机报出的
  // 首例是收容库「查看人生记录」点了没反应；顺藤摸出同一只手的另外两处。
  const ji = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')

  // ① 收容库异步换块（outerHTML）后重绑展开按钮
  const memorialSwap = ji.slice(ji.indexOf('host.outerHTML = shipMemorialHtml'))
  assert.match(
    memorialSwap.slice(0, 400),
    /bindMemorialToggles\(/,
    '收容库异步换块后没有重绑展开按钮',
  )

  // ② 舰娘面板局部换块后重绑备注/前往列表/收容库（bindShipPanelControls 两处共用）
  const shipUpdate = ji.slice(
    ji.indexOf('function updateShipDetailPanel'),
    ji.indexOf('function wireShipDetailPanel'),
  )
  assert.match(shipUpdate, /bindShipPanelControls\(panel\)/, '舰娘面板换块后没有重绑逐元素控件')

  // ③ 深海面板换块只重绑逐元素控件；重挂 wireShipDetailPanel 会叠加委托，
  //    语音每切一次子页就多响一遍
  const abyssUpdate = ji.slice(
    ji.indexOf('function updateAbyssDetailPanel'),
    ji.indexOf('const closeBookDrawer'),
  )
  assert.match(abyssUpdate, /bindAbyssPanelControls\(panel\)/, '深海面板换块后没有重绑逐元素控件')
  assert.doesNotMatch(
    abyssUpdate,
    /wireShipDetailPanel\(/,
    '深海面板换块又重挂面板级委托了——监听会叠加',
  )
  // 立绘 error 兜底属于面板内逐元素绑定，必须住在可重绑的函数里
  const abyssBind = ji.slice(
    ji.indexOf('const bindAbyssPanelControls'),
    ji.indexOf('function wireAbyssDetailPanel'),
  )
  assert.match(abyssBind, /\.abyss-art img/, '深海立绘 error 兜底不在可重绑的函数里')
})

test('任务的相关系统按功能归类，限时只是时效标签', () => {
  // 曾把「限时」当第一分类直接查系统表：限定编成任务、限定工厂任务
  // 一律错指到「活动进度」。功能入口按非限时分类取；「活动进度」只在
  // 任务真的涉及活动海域时追加，两者可并存。
  const qn = fs.readFileSync(new URL('../src/renderer/modules/qn.ts', import.meta.url), 'utf8')
  assert.match(qn, /category\.key !== 'limited' && category\.test\(row\)/, '功能分类没有跳过限时')
  assert.match(qn, /isEventMapArea\(Math\.floor\(id \/ 10\)\)/, '活动进度入口没有以活动海域为条件')
  assert.doesNotMatch(
    qn,
    /SYSTEM_BY_CATEGORY\[categoryOf\(row\)\.key\]/,
    '又用显示分类直接查系统表了——限时会抢在功能分类前面',
  )
})

test('演习对手不按裸装建模：通用配装 + 敌方观测射击', () => {
  // 2026-08-10 实测：裸装建模把 D 败预测成 B+ 64–91%——对手双空母 84 机
  // 在模型里是 0 机，制空判定颠倒、敌方观测连击整层缺失。口径：玩家舰队
  // 默认不裸装（初期装备为下界），敌方作为玩家舰队要吃观测那一层。
  const rcf = fs.readFileSync(new URL('../src/renderer/combat-forecast.ts', import.meta.url), 'utf8')
  assert.match(rcf, /equipment: stockEquipmentFor\(entry\.mstId\)/, '演习对手又变回裸装了')
  assert.match(rcf, /enemySpotting: true/, '演习预测没把敌方当玩家舰队')
  const scf = fs.readFileSync(new URL('../src/shared/combat-forecast.ts', import.meta.url), 'utf8')
  assert.match(scf, /mirrorAirState/, '敌方制空状态该按我方镜像取')
  const di = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  assert.match(di, /通用配装/, '界面没交代装备按通用配装估算')
})

test('沙盘的移出入口要长在看得见的地方', () => {
  const ru = fs.readFileSync(new URL('../src/renderer/modules/ru.ts', import.meta.url), 'utf8')
  // 移除功能一直是好的，但入口只在上面的选人条上——人是在下面这张舰表里看编成的，
  // 找不到入口就等于不能移除。两处都要有。
  assert.ok(ru.includes('class="sand-out"'), '舰行上没有移出按钮')
  assert.ok(ru.includes('deck.id === SANDBOX_DECK_ID'), '移出按钮该只在沙盘出现')
  // 按钮长在可展开的行里，点它不该顺手把这行展开
  assert.ok(
    ru.includes("closest('[data-sandbox-remove]')) return"),
    '点移出会连带展开该行',
  )
})

test('有关任务标出做没做完，且「不在表里」只在拿到全量之后才敢解读', () => {
  const store = fs.readFileSync(new URL('../src/main/mg/store.ts', import.meta.url), 'utf8')
  const main = fs.readFileSync(new URL('../src/main/mg/index.ts', import.meta.url), 'utf8')
  const kernel = fs.readFileSync(new URL('../src/renderer/kernel.ts', import.meta.url), 'utf8')
  const quests = fs.readFileSync(new URL('../src/renderer/modules/qn.ts', import.meta.url), 'utf8')
  const atlas = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const html = rendererSource

  // 只有 tab 0「全部」是全量（实测一次给 118 条，不分页）。分类页当全集，
  // 会把没翻到的任务统统判成「不能接」——所以这个前提必须单独记一个时刻。
  assert.match(store, /if \(tabId === 0\) state\.player\.questsFullTs = ts/)
  assert.match(main, /patch\.questsFullTs = state\.player\.questsFullTs/)
  assert.match(kernel, /questsFullTs: MgPlayer\['questsFullTs'\]/)
  assert.match(quests, /authoritative: mg\.questsFullTs != null/)

  // 判据只有一份：鉴取钦导出的结论，两处各判一次迟早说法打架
  assert.match(quests, /export const questVerdicts = /)
  assert.match(atlas, /questVerdicts\(\)/)
  assert.doesNotMatch(atlas, /buildQuestAvailability\(/, '鉴不该自己再判一遍')

  // 「未解锁」得说出卡在哪条，否则等于没说；前置写成可点的
  assert.match(atlas, /const questMissingPreHtml = /)
  assert.match(atlas, /questByCode\(code\)/)
  // 这块抽屉很窄，不能拿多列 grid 硬排：名字列会被挤到一个字一行，
  // 而占 2/-1 的「缺 X」会跟名字叠在同一格（实测截图就是这样）
  assert.match(atlas, /class="q-rel-head"/)
  assert.doesNotMatch(html, /\.mod-ji \.q-rel \{[^}]*display: grid/)
  assert.doesNotMatch(html, /\.mod-ji \.q-pre \{/, '「缺 X」不该再靠 grid-column 抢格子')
  // 能动手的排在前，已完成沉底
  assert.ok(
    atlas.includes('claimable: 0') && atlas.includes('done: 5'),
    '排序没有把能做的提到前面',
  )
  // 状态是推出来的。2026-08-26 文案清扫按裁决书把「任务状态是推断的，不是游戏给的」
  // 与它的悬停（「游戏不提供任务履历…」「还没同步过完整任务表」）整句撤了，
  // 「推断」二字改挂到状态 chip 上（片三补做）。挂的只有 done / locked 两档：
  // 它们是从「不在任务表里」与前置状态推出来的，其余几档是任务表直接给的，
  // 一并标成推断反而是新的不实陈述。
  assert.match(atlas, /const inferred = status === 'done' \|\| status === 'locked'/)
  assert.match(atlas, /\$\{inferred \? '<i>推定<\/i>' : ''\}/)
  assert.match(html, /\.mod-ji \.q-st i \{/, 'chip 上那枚「推断」没有样式，会跟状态词一样大')
  //
  // 护栏保住的是这批文案背后**真正**要防的事，而且这一层比措辞更硬：
  // 没拿到全量任务表之前，不许把「没见过」解读成「已完成」——
  // 判定入口只有 questsFullTs 非空这一条路，空的时候必须走那条可执行动作的分支。
  assert.match(atlas, /mg\.questsFullTs == null/)
  assert.match(atlas, /任务状态无法判定 · 打开游戏任务「全部」页后同步/)

  // 周期任务的「已完成」只是本期，下期还会回来
  assert.match(atlas, /本期已完成/)
  assert.match(quests, /本期已完成/)

  // 钦那块灰行也用同一份结论：两处各判一次迟早说法打架。
  // 修之前实测两套在同一份数据上有 31 条**说反**（钦说已完成、鉴说还不能接）。
  assert.match(quests, /const verdict = ghost \? questVerdicts\(\)\.get\(row\.id\) : undefined/)
  assert.match(quests, /未解锁/)
})

test('战果账外差值全自动对账:明细截断不吞判据,补记不重复计算', () => {
  // 2026-08-17 用户报「补记点击实际没用」:根因是 slice(0,300) 把 EO 行挤出
  // 明细,自检误报漏记、补记被去重驳回。修法:截断只砍经验行 + 全自动补记。
  const ledger = fs.readFileSync(new URL('../src/main/mg/ledger.ts', import.meta.url), 'utf8')
  const main = fs.readFileSync(new URL('../src/main/mg/index.ts', import.meta.url), 'utf8')
  const kernel = fs.readFileSync(new URL('../src/renderer/kernel.ts', import.meta.url), 'utf8')
  const zi = fs.readFileSync(new URL('../src/renderer/modules/zi.ts', import.meta.url), 'utf8')
  // 截断走 capSenkaEntries(行为测试在 senka.test),不许回退裸 slice
  assert.match(ledger, /entries: capSenkaEntries\(entries\)/)
  assert.doesNotMatch(ledger, /entries\.slice\(0, 300\)/)
  // EO:主进程查账时按海域页观测自动补记,入账取重置点(防校准重复计算)
  assert.match(main, /ledger\.autoBookEoFromMapinfo\(when\)/)
  assert.match(ledger, /this\.logEoClear\(resetTs, mapId\)/)
  // 战果任务(2026-09-01 重立):补记与 EO 同款——只按账本存着的 clearitemget 报文补,
  // 入账时刻取报文观测时刻。判据的行为测试在 senka-quest-evidence,这里只钉接线。
  assert.match(main, /ledger\.autoBookQuestSenkaFromEvents\(when, questSenkaInfo\)/)
  assert.match(ledger, /this\.logQuestSenka\(Number\(row\.ts\), questId, info\.senka, info\)/)
  assert.doesNotMatch(zi, /data-senka-fix/)
  // 渲染层不再有写账的手:那条路的触发端是「已完成」推断,推断在月初重置那一刻
  // 必然失真(2026-09-01 用户账本实锤:两个从没做过的任务被记进 9 月账)
  assert.doesNotMatch(main, /ipcMain\.handle\('mg:senka-log-quest'/, '主进程还收着补记请求')
  for (const [name, source] of [['kernel', kernel], ['zi', zi]]) {
    assert.doesNotMatch(source, /invoke\('mg:senka-log-quest'/, `${name} 还在往主进程递补记`)
  }
  assert.doesNotMatch(zi, /logSenkaQuest/)
  // 入账与去重全走那一份纯判定,账本这边不许自己再写一套窗口算术
  assert.match(ledger, /const plan = planQuestSenkaBooking\(\{/)
  assert.doesNotMatch(
    ledger,
    /kind = 'quest' AND note = \? AND ts >= \?/,
    '同任务同月去重已被同任务同周期取代,旧 SQL 不许回潮',
  )
  // 重算任务战果:撤回只走账本那一个守卫方法(指纹与理由都写在那儿)
  assert.match(main, /ledger\.clearAutoBookedQuestSenka\(senkaMonthStart\(Date\.now\(\)\)\)/)
  assert.match(
    ledger,
    /DELETE FROM senka_log\s+WHERE kind = 'quest' AND ts = \? AND \(manual IS NULL OR manual != 1\)/,
    '撤回必须同时钉住 kind、「ts 恰等于月初」与「不是手动补记行」三个条件',
  )
  assert.doesNotMatch(ledger, /DELETE FROM senka_log WHERE ts >=/)
  // 手动补记行只有行尾那个删除钮删得掉，且两道门（kind + manual）都要过
  assert.match(
    ledger,
    /DELETE FROM senka_log WHERE id = \? AND kind = 'quest' AND manual = 1/,
    '删补记必须钉住 manual = 1，否则观测行也删得掉',
  )
  assert.doesNotMatch(main, /mg:senka-log-eo/)
  assert.doesNotMatch(kernel, /mg:senka-log-eo/)
})

test('任务前置链双源合并:钦与完整任务树同一份口径,分歧要让人看见', () => {
  // 2026-08-17 用户点的活:接入 wikiwiki 前提链并与 kcwiki 对账。
  // 行为测试在 quest-pre-merge/quest-availability/wikiwiki-quests 三个测试文件,
  // 这里只钉接线:两个窗口都走 mergeQuestPre + questPreSourceNoteHtml,不许各自手搓。
  const quests = fs.readFileSync(new URL('../src/renderer/modules/qn.ts', import.meta.url), 'utf8')
  const tree = fs.readFileSync(new URL('../src/renderer/quest-tree-window.ts', import.meta.url), 'utf8')
  for (const source of [quests, tree]) {
    assert.match(
      source,
      /mergeQuestPre\(\s*entry\.pre,\s*wwByCode\.get\(entry\.code\),\s*knownCodes,\s*QUEST_PRE_ARBITRATION\.get\(entry\.code\),\s*\)/,
    )
    assert.match(source, /questPreSourceNoteHtml\(/)
    assert.match(source, /queryLode\('wikiwiki-quests'\)/)
  }
  // 说明文案只有一份实现,两处窗口不许分叉
  const note = fs.readFileSync(new URL('../src/renderer/quest-pre-note.ts', import.meta.url), 'utf8')
  // 2026-08-26 第三批文案清扫(族 14):五句对账说明收拢成一枚短标 + 一句悬停。
  // 钉的东西没变,只是换了落点——分歧仍要让人看见(短标常驻)、按哪份判仍要说得出
  // (进 title),失效码仍按「未同步」处理。原先钉的三句原文已不存在,改钉新文案。
  assert.match(note, /⚖ 前置资料有分歧/, '分歧必须常驻可见,不许静默吞掉')
  assert.match(note, /title="\$\{esc\(parts\.join\(' · '\)\)\}"/, '分歧内容要收进悬停,不许丢')
  assert.match(note, /失效任务码/)
  assert.match(note, /状态记为「未同步」/)
  assert.match(note, /采用前者结论/)
  assert.doesNotMatch(quests, /前置资料有分歧/, '文案该 import,不该复制')
  assert.doesNotMatch(tree, /前置资料有分歧/, '文案该 import,不该复制')
  // 2026-08-20 第二批文案清扫：分歧要让人看见，但「是哪个 wiki 说的」不进发布侧。
  // 逐条依据仍在 shared/quest-pre-arbitration.ts 的 basis 台账里，只是不再原样渲染。
  assert.doesNotMatch(note, /三源仲裁（kcwiki × wikiwiki × KC3Kai）/, '出处署名不该回潮')
  assert.doesNotMatch(note, /前置来自 wikiwiki/, '出处署名不该回潮')
  assert.doesNotMatch(note, /kcwiki 的前置含已失效的码/, '出处署名不该回潮')
  assert.doesNotMatch(note, /两个 wiki 口径不一致/, '出处署名不该回潮')
  assert.doesNotMatch(note, /\$\{info\.basis/, '仲裁依据是维护者台账,不摆给玩家')
  const arbitration = fs.readFileSync(
    new URL('../src/shared/quest-pre-arbitration.ts', import.meta.url),
    'utf8',
  )
  assert.match(arbitration, /basis: 'kcwiki 与 KC3Kai 一致/, '台账本身要留着,方便日后对账')
  // 抓取侧:EO 公证(周期任务重编过号,code 不能裸信)+ 三方对账落 review
  const fetcher = fs.readFileSync(new URL('../scripts/fetch-lodes.mjs', import.meta.url), 'utf8')
  assert.match(fetcher, /normalizeJpName\(entry\.nameJp\) !== normalizeJpName\(peer\.name_jp\)/)
  assert.match(fetcher, /quest-pre-reconcile\.json/)
})

test('装备的「可获取途径」把几张正方向的表反查过来，查不到的那条如实说查不到', () => {
  const rule = fs.readFileSync(new URL('../src/shared/equip-sources.ts', import.meta.url), 'utf8')
  const atlas = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')

  // 三张表都写成了正方向，要问的都是反方向：
  // equip-upgrades 说「A 能更新成 B」，kcwiki-ships 说「这舰带哪几件」
  assert.match(rule, /export const upgradeSourcesOf = /)
  assert.match(rule, /export const initialEquipShips = /)
  assert.match(atlas, /const equipObtainHtml = /)
  assert.match(atlas, /\$\{equipObtainHtml\(e\.api_id, e\.api_name\)\}/, '装备详情没接上')

  // 任务那一列与「有关任务」同一份结论，不再各判一次
  assert.ok(
    atlas.slice(atlas.indexOf('const equipObtainHtml')).includes('questVerdicts()'),
    '可获取途径里的任务状态该复用同一份判定',
  )

  // 活动奖励本地查不到（几份资料都没有「怎么获得」这一栏）。那两句免责按文案
  // 清扫裁定（族 4）删了。要防的事没变——不许把「本地没查到」渲染成一个
  // 看起来完整的空清单，所以钉的是「查不到时走的是另一条空态分支」这条行为。
  assert.match(atlas, /if \(!blocks\.length\) \{/)
  assert.match(atlas, /暂无本地获取渠道资料/)

  // 同一艘舰带两件同型装备只算一艘；同一件源装备多条更新路径只列一次
  assert.ok(rule.includes('const out = new Set<number>()'), '初期携带没有按舰去重')
  assert.match(rule, /levelAfter > known\.levelAfter/, '同源多路径该保留星级最高的那条')
})

test('周期任务不当「前置没做完」的证据——一张当期快照答不了「你做过没有」', () => {
  const rule = fs.readFileSync(new URL('../src/shared/quest-availability.ts', import.meta.url), 'utf8')

  // 日/周/月/季/年常任务做完当期就从表里消失，下期又回来。
  // 拿「当期不在表里」当「没做完」，实测把 31 条早就做完的任务报成「还不能接」
  // （A56 卡在月常 Bm6、A59 同样、A60 顺着 B53 也卡在那里）。
  assert.match(rule, /export const isCyclicQuestCode = /)
  assert.ok(rule.includes("new Set(['d', 'w', 'm', 'q', 'y'])"), '周期标记表不对')
  const pre = rule.slice(
    rule.indexOf('const preSatisfied'),
    rule.indexOf('const state = input.observed.get'),
  )
  assert.ok(pre.length > 200, '取到的前置判据片段不对')
  assert.match(pre, /if \(isCyclicQuestCode\(code\)\) \{[\s\S]*?settled\.set\(code, true\)/)
  // 但周期任务**自己**的状态照常判，只是 done 要标成「本期」
  assert.match(rule, /cyclic: boolean/)
})

test('各队走向速览：一队一行并排比，判别沿用现成的带路引擎', () => {
  const atlas = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const html = rendererSource

  // 下面那张「可达路线」一次只答一支队（要切 tab），而玩家要做的判断是队与队之间的
  assert.match(atlas, /const fleetOutlookHtml = /)
  // difficulty 是 2026-08-26 接活动图带路时加的第五个参数：活动图规则按难度分叉
  assert.match(
    atlas,
    /routeOutlook\(plannedRoutes\(code, route, deck\.id, phase, difficulty\), targetLetters\)/,
  )
  assert.match(
    atlas,
    /\$\{fleetOutlookHtml\(info, code, route, routeTarget\.target\)\}/,
    '没接进海域详情',
  )
  // 整行可点，落到与 tab 同一个切换（两套切换迟早走样）
  assert.match(atlas, /class="fo-lane\$\{on\}" data-map-forecast-deck=/)
  assert.match(html, /\.mod-ji \.fo-lane \{/)

  // 走向按玩家**选定的**目标点算：多血条图上旧段 Boss 会一直占着目标位，
  // 而捞船的人本来就故意停在旧段 Boss。默认值仍取自你打过的 Boss 记录。
  assert.match(atlas, /const routeTargetOf = /)
  assert.match(atlas, /resolveRouteTarget\(/)
  assert.match(atlas, /data-map-route-target=/)
  assert.ok(atlas.includes('未选目标点'), '没选目标点时该直说没选')
  assert.ok(
    atlas.includes('暂无 Boss 记录；在「目标点」中选定，走向按其计算'),
    '没有 Boss 记录时没指路到目标点选择器',
  )
  assert.ok(!atlas.includes('bossLetters.add(route[route.length - 1]'), '又拿路线终点当 Boss 了')

  // 带路上下文里除 passed/phase 外全由这支队决定，而推演会在每格上再问一次。
  // 速览要对每支队各推一遍，不记一份就是几百次同样的计算（含 4 次索敌33）。
  assert.match(atlas, /const routingBaseCache = new Map/)
  assert.match(atlas, /resetRoutingBaseCache\(\) \/\/ 每次渲染重算一次队伍侧/)
  const base = atlas.slice(
    atlas.indexOf('const routingFleetBase'),
    atlas.indexOf('const mapDifficultyRank'),
  )
  assert.ok(base.length > 200, '取到的队伍侧片段不对')
  assert.doesNotMatch(base, /\bpassed\b/, '队伍侧掺进了 passed，缓存会把不同格的结果串在一起')
})

test('分歧实测从账本一路接到界面，不再是只写不读的一张表', () => {
  const ledger = fs.readFileSync(new URL('../src/main/mg/ledger.ts', import.meta.url), 'utf8')
  const chronicle = fs.readFileSync(new URL('../src/main/mg/chronicle.ts', import.meta.url), 'utf8')
  const kernel = fs.readFileSync(new URL('../src/renderer/kernel.ts', import.meta.url), 'utf8')
  const battle = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  const atlas = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')

  // routes 表一直在写（每进一格记一条），但聚合查询从来没人调用过——
  // 整条链断在 IPC 之前，界面上等于这份数据不存在。
  assert.match(ledger, /logRoute = \(/)
  assert.match(ledger, /queryRouteStats = \(map: number\)/, '改成按图批量取，逐点往返会把一次渲染拆成十几趟')
  assert.match(chronicle, /ipcMain\.handle\('chron:route-stats'/)
  assert.match(kernel, /ipcRenderer\.invoke\('chron:route-stats', map\)/)

  // 两处落地：战斗现场站在分歧点时、图鉴的整图分歧一览
  assert.match(battle, /branchTallyByLetter\(/)
  assert.match(battle, /branchTallyText\(routeTallyFor\(s\), letter\)/)
  assert.match(atlas, /chron:route-stats/)
  assert.match(atlas, /pathWalkedBound\(/)

  // 读失败要说读失败——空统计会被读成「你还没在这个点分歧过」，那是把故障说成事实。
  // 失败标记原先是模块级单例 routeTallyFailed；现在跟着「这张图」那条记录走
  //（两个宿主可能同时显示不同海域，单例会被对方清掉/串台）。原意照钉，换成钉那条记录的字段。
  assert.match(battle, /state\.failed = true/)
  assert.match(battle, /if \(state\.failed\) return '分歧实测读取失败'/)
  assert.match(battle, /const routeTallyByMap = new Map<string, RouteTallyState>\(\)/)
  assert.match(atlas, /failed: true/)
  // 辩护半句「不是「没有记录」」按文案清扫裁定（族 5）删了，只留失败态本身。
  // 护栏语义不放松：钉住「读失败」与「没记到」仍是两个互不相同的分支文案。
  assert.match(atlas, /航路志读取失败/)
  assert.match(atlas, /暂无航路记录/)
  assert.match(atlas, /tally\?\.failed/)

  // 只列真分过歧的点：去向只有一个的写出来是噪音
  assert.ok(
    battle.includes('entry.to.length >= 2') && atlas.includes('entry.to.length >= 2'),
    '把非分歧点也列了出来',
  )
})

test('出击海图：搬走右栏那张卡，浮层挂在 body 下', () => {
  const di = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  const html = rendererSource

  // seaCardHtml 已经画得更全（当前点光环 / 可选点 / 节点类型着色 / 节点摘要 / 来源署名），
  // 另画一张既重复又更简陋。展开的就是它本人。
  assert.ok(di.includes('seaPopEl.innerHTML = seaCardHtml(sortie)'), '浮层没用现成的海域卡')
  assert.ok(!di.includes('const sortieMapSvg'), '不该另画一张海图')

  // 搬走就不能留在原处，否则同屏出现两份
  const sidebar = di.slice(di.indexOf('<aside class="sidebar">'), di.indexOf('</aside>'))
  assert.ok(!sidebar.includes('seaCardHtml'), '右栏还留着一份，成了重复')

  // 拿不到离线拓扑就不给箭头，而不是摆一张空图；演习没有海图同样不给。
  // 2026-08-25 判据收紧：从「有 spots 这一格」改成 fcdTopologyUsable——
  // 上游给新图落的空壳 `{spots:{},route:{}}` 按真值判断是「有」，
  // 箭头会照挂而点开是一片空白（见 shared/fcd-topology.ts）。
  assert.ok(
    di.includes('!s.practice && fcdTopologyUsable(fcdMap?.data?.[mapKeyOf(s)])'),
    '缺拓扑/演习时仍给了箭头',
  )

  // 浮层必须挂在 body 下。面板内两条路都试过、都不行：
  //   absolute —— .trail 与 .battle-col 都有 overflow:hidden，直接被裁；
  //   fixed 放面板内 —— .ws-pane 自带 transform（matrix(1,0,0,1,0,0) 也算），
  //   它会成为 fixed 的包含块，于是「相对视口」变成「相对面板」，
  //   叠上 1.15 界面缩放后实测 left:1770px 渲染到 x=3514，飞出屏幕。
  assert.ok(di.includes('document.body.appendChild(seaPopEl)'), '浮层没挂到 body')
  assert.ok(di.includes('const closeSeaPop'), '没有关闭时的清理')
  // 顶格的 .sea-pop（body 级），不是 .mod-di 下那条
  assert.ok(/\n    \.sea-pop \{[^}]*position: fixed/.test(html), '浮层该是 fixed')
  // 定位算完才现形，否则会先在左上角闪一下
  assert.match(html, /\.sea-pop \{[^}]*visibility: hidden/, '没有先隐藏再定位')

  // 航线按 route 的**边**画（判据在 shared/sortie-route，那边有行为测试）。
  // 原来把访问过的字母首尾相连、还从 i=1 起步，出发点不在节点列表里，
  // 「起点 → 第一个点」那一段整个没画。
  assert.ok(di.includes('travelledEdges('), '航线没按边画')
  assert.ok(!/for \(let i = 1; i < visited\.length/.test(di), '又退回字母首尾相连了')
  assert.ok(di.includes('visitedSet.add(edge.from)'), '出发点没算成走过的点，会留成灰点')
})

test('输出栏按昼夜分段，没出手写 -- 而不是 0', async () => {
  const m = await import('../dist/shared/battle-phase-damage.js')
  const { dealtByPhaseOf } = m.default ?? m

  const battle = {
    attacks: [
      { phase: 'gun1', side: 0, attacker: 2, hits: [{ target: 0, damage: 30 }] },
      { phase: 'night', side: 0, attacker: 2, hits: [{ target: 1, damage: 70 }] },
      { phase: 'gun1', side: 1, attacker: 2, hits: [{ target: 0, damage: 99 }] }, // 敌方同位置，不该混进我方
      { phase: 'air', side: 0, attacker: -1, hits: [{ target: 0, damage: 50 }] }, // 航空无逐舰归属
    ],
  }
  assert.deepEqual(dealtByPhaseOf(battle, 2, false), { day: 30, night: 70 })
  assert.deepEqual(dealtByPhaseOf(battle, 2, true), { day: 99, night: 0 })
  // attacker=-1 的航空/支援不归任何一舰，所以逐舰之和会小于「输出合计」——
  // 这是事实，不去替它凑平
  assert.deepEqual(dealtByPhaseOf(battle, -1, false), { day: 50, night: 0 })
  assert.deepEqual(dealtByPhaseOf(null, 0, false), { day: 0, night: 0 })

  const di = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  const at = di.indexOf('const dealtHtml')
  assert.ok(at > 0, '没有分段输出')
  const fn = di.slice(at, di.indexOf('\nconst browHtml', at))
  // 单阶段的场次不该平白多出个提示
  assert.ok(fn.includes('const order = phaseOrderOf(b)') && fn.includes('if (!order) return'), '单阶段时也分了段')
  // 第一层只给合计：十几行都写「x + y」，那一列本来就窄，读起来比一个数还费劲
  assert.match(fn, /const total = ship\.damageDealt \|\| 0/)
  assert.doesNotMatch(fn, /<em>\+<\/em>/, '分段不该再摆在第一层')
  // 0 会被读成「打了但没伤害」，实际多半是那一段没出手
  assert.ok(fn.includes("value > 0 ? `${value}` : '--'"), '空段该写 -- 而不是 0')
  // 逐舰之和会小于合计（航空/支援没有逐舰归属），提示里要说清楚
  assert.match(fn, /无逐舰归属/)

  // 血条那一侧的判据见「打完夜战后血条换基准」那条测试
  // 谁算「两个阶段」交给 battlePhaseOrder 一处说了算。
  // 早先这里钉的是「排除 nightonly 与 nightday」——前半对，后半是错的：
  // nightday 是拂晓战（夜战打到天亮转昼战），实打实两个阶段，被这条断言一起挡在外面了。
  const tp = di.slice(di.indexOf('const phaseOrderOf'), di.indexOf('const phaseOrderOf') + 240)
  assert.ok(tp.includes('battlePhaseOrder(b.kind, b.hasNight)'), '两阶段判据该收在一处')
  assert.doesNotMatch(di, /kind !== 'nightday'/, '夜转昼有两个阶段，不该被排除')
})

test('战果：月边界是「前月末 22:00」，不是自然月', async () => {
  const m = await import('../dist/shared/senka.js')
  const { senkaMonthStart, senkaFromExp, EO_SENKA, SENKA_PER_EXP } = m.default ?? m
  const jst = (text) => Date.parse(`${text}+09:00`)
  const label = (at) => new Date(senkaMonthStart(at) + 9 * 3600 * 1000).toISOString().slice(0, 16)

  // 月末那两个小时已经算下个月了。只往前找边界会把它们错记到本月——实测栽过一次。
  assert.equal(label(jst('2026-08-09T16:00')), '2026-07-31T22:00')
  assert.equal(label(jst('2026-08-01T00:30')), '2026-07-31T22:00')
  assert.equal(label(jst('2026-07-31T21:59')), '2026-06-30T22:00')
  assert.equal(label(jst('2026-07-31T22:00')), '2026-07-31T22:00', '月末 22:00 起算下个月')
  assert.equal(label(jst('2026-08-31T23:00')), '2026-08-31T22:00')
  // 跨年
  assert.equal(label(jst('2026-01-01T05:00')), '2025-12-31T22:00')

  // 通常战果 = 提督经验 × 7/10000（wikiwiki 称号・戦果）
  assert.equal(SENKA_PER_EXP, 7 / 10000)
  assert.equal(senkaFromExp(10000), 7)
  assert.equal(senkaFromExp(0), 0)
  assert.equal(senkaFromExp(-500), 0, '经验倒退不该产生负战果')

  // EO 固定分值
  assert.equal(EO_SENKA[15], 75) // 1-5
  assert.equal(EO_SENKA[55], 200) // 5-5
  assert.equal(EO_SENKA[11], undefined, '非 EO 海域不该有分值')
})

test('战果账：只记增量、同月同图只记一次、说清记账起点', () => {
  const ledger = fs.readFileSync(new URL('../src/main/mg/ledger.ts', import.meta.url), 'utf8')
  const zi = fs.readFileSync(new URL('../src/renderer/modules/zi.ts', import.meta.url), 'utf8')

  // port 报文每次都带当前经验值，不去重会把「没变」也记成一笔
  const at = ledger.indexOf('logHqExp = ')
  const fn = ledger.slice(at, ledger.indexOf('\n  }', at))
  assert.ok(fn.includes('previous?.exp_total === experience'), '没跳过「值没变」')
  assert.ok(fn.includes('if (previous == null) return false'), '第一次该只记基线')
  assert.ok(fn.includes('if (delta <= 0) return false'), '经验倒退不该记负数')

  // EO 每个战果月只算一次
  const eoAt = ledger.indexOf('logEoClear = ')
  const eo = ledger.slice(eoAt, ledger.indexOf('\n  }', eoAt))
  assert.ok(eo.includes('senkaMonthStart(ts)'), 'EO 去重没有按战果月')

  // 游戏不下发战果，这是换算——必须说明它是怎么换算的。
  // 2026-08-26 文案清扫：「游戏不下发战果数值」那句自证与「这之前的补不回来」那句
  // 记账起点免责（用户点名实例）都删了。「是换算来的」这件事仍要当场说清，改钉
  // 卡头那句口径与公式本体；记账起点缺口的机制说明退回源码注释，不再上屏。
  assert.ok(zi.includes('换算自提督经验'), '没说明战果是换算的')
  assert.ok(zi.includes('通常 = 该月提督经验 ×7/10000'), '没给出换算公式')
  assert.ok(zi.includes('提督经验的历史值没有入库'), '记账起点缺口的源码注释丢了')

  // 账本行是复盘入口：任务行解析出名字并给实体链接，EO 行链到海域图鉴。
  // 「任务 893」这种裸编号等于让玩家自己再翻一遍任务列表（2026-08-12 用户点名）
  assert.match(zi, /elink\('quest', id, known \? `\$\{known\.code\}「\$\{known\.name\}」` : `\$\{id\}`\)/)
  assert.match(zi, /elink\('map', mapId, mapCodeOf\(mapId\)\)/)
  assert.match(zi, /queryLode\('quests-scn'\)/)
  // 资料库拿不到只影响显示，不许拖垮整个账本刷新
  assert.match(zi, /queryLode\('quests-scn'\)\.catch\(\(\) => null\)/)
})

test('任务战果只认固定给的，可选奖励里的不自动记', async () => {
  const m = await import('../dist/shared/senka.js')
  const { questFixedSenka } = m.default ?? m

  // kcwiki 的奖励文本有三种写法，都要收
  assert.equal(questFixedSenka('奖励:80战果 礼物箱'), 80)
  assert.equal(questFixedSenka('奖励:战果×350 改修资材×4'), 350)
  assert.equal(questFixedSenka('奖励:战果+200 以下奖励二选一： 勋章×1'), 200)

  // 「以下奖励」之后是选择奖励，玩家未必选战果——自动记账不能替他做主。
  // 实测 B170 的战果 800 就是跟 FR-1 Fireball 二选一的。
  assert.equal(
    questFixedSenka('奖励:以下奖励三选一： 改修资材×7 战斗详报 以下奖励二选一： 战果+800 FR-1 Fireball'),
    null,
  )
  assert.equal(questFixedSenka('奖励:燃料×300 弹药×300'), null)
  assert.equal(questFixedSenka(null), null)

  // 领奖报文里没有战果字段（实测 api_bounus 全是 type=1 资源），所以只能查表——
  // 这条来历要写在代码里，免得后人以为是偷懒
  const index = fs.readFileSync(new URL('../src/main/mg/index.ts', import.meta.url), 'utf8')
  assert.ok(index.includes('领奖报文里没有战果字段'), '没交代为什么查表而不是读报文')
  assert.ok(index.includes('logQuestSenka'), '没接任务战果记账')
})

const questSenkaTestPack = new URL('../assets/lodes/quests-scn.json', import.meta.url)
test('随包任务表的固定战果与可选战果口径对账', {
  skip: fs.existsSync(questSenkaTestPack) ? false : '缺 quests-scn 矿脉包',
}, async () => {
  const m = await import('../dist/shared/senka.js')
  const { questFixedSenka } = m.default ?? m
  const scn = JSON.parse(fs.readFileSync(questSenkaTestPack, 'utf8')).data
  let fixed = 0
  let skipped = 0
  for (const quest of Object.values(scn)) {
    const memo = [quest.memo, quest.memo2].filter(Boolean).join(' | ')
    if (!/战果/.test(memo)) continue
    if (questFixedSenka(memo)) fixed += 1
    else skipped += 1
  }
  assert.equal(fixed, 9, `固定战果任务应有 9 条，实得 ${fixed}`)
  assert.equal(skipped, 1, `按可选奖励跳过的应有 1 条，实得 ${skipped}`)
})

test('入渠排程按渠位并行，不是把工时一路相加', async () => {
  const m = await import('../dist/shared/repair-schedule.js')
  const { planRepairs } = m.default ?? m
  const H = 3600 * 1000
  const idle = (n) => Array.from({ length: n }, () => ({ freeAt: 0 }))

  // 4 渠 4 艘：最长那艘决定完工，串行相加会算成 16h——差 2 倍
  const four = planRepairs({ now: 0, slots: idle(4), durations: [2 * H, 5 * H, 1 * H, 8 * H] })
  assert.equal(four.remainMs, 8 * H)
  assert.equal(four.totalMs, 16 * H, '总工时仍然要给，它是另一个问题的答案')
  assert.equal(four.queued, 0)

  // 2 渠 4 艘：LPT 摊成 8 | 5+2+1，仍是 8h
  const two = planRepairs({ now: 0, slots: idle(2), durations: [2 * H, 5 * H, 1 * H, 8 * H] })
  assert.equal(two.remainMs, 8 * H)
  assert.equal(two.queued, 2)

  // 占用中的渠不是立刻可用——它得先修完手上这艘。
  // 忽略这点会把「4 渠全满」当「4 渠全空」，给出过于乐观的时刻。
  const busy = planRepairs({
    now: 0,
    slots: [{ freeAt: 3 * H }, { freeAt: 6 * H }, { freeAt: 0 }, { freeAt: 0 }],
    durations: [2 * H, 5 * H],
  })
  assert.equal(busy.remainMs, 6 * H, '在修的那艘也算进「全员就绪」')

  // 没有待修，但渠里还躺着在修的：全员就绪不是现在
  assert.equal(planRepairs({ now: 0, slots: [{ freeAt: 5 * H }], durations: [] }).remainMs, 5 * H)
  // 渠早就到点没去领：按现在算，不倒扣
  assert.equal(planRepairs({ now: 10 * H, slots: [{ freeAt: 0 }], durations: [2 * H] }).remainMs, 2 * H)
  // 一个渠都没有就没法排
  assert.equal(planRepairs({ now: 0, slots: [], durations: [H] }), null)

  const qa = fs.readFileSync(new URL('../src/renderer/modules/qa.ts', import.meta.url), 'utf8')
  assert.ok(qa.includes('planRepairs({'), '待修合账没接排程')
  assert.ok(
    qa.includes('freeAt: dock.shipId > 0 ? dock.completeTime : now'),
    '占用中的渠该等它修完',
  )
  // 「含正在修的那些——占用中的渠要先把手上这艘修完」这句解说 2026-08-26 按族 7 删了。
  // 「包含在修的」这件事本来就由上面那条 freeAt 断言真正守着；悬停这一侧改钉
  // 缩写后的口径还在（并行估算 + 排队艘数），不许连排队都不说。
  assert.ok(qa.includes('渠并行估算'), '没说明「全员就绪」是按渠位并行估算的')
  assert.ok(qa.includes('艘排队等空渠'), '没说明有几艘在排队等空渠')
})

test('账本不落 api_token 明文：入账前替换占位，存量 v6 一次性抹除', () => {
  // 行为钉：JSON 形态（广播器现行格式，querystring.parse 后 stringify）——
  // 凭据换占位，业务参数原样保留，JSON 结构不被破坏
  const token = '1acd0123456789abcdef0123456789abcdef954a'
  const redacted = redactPostBody(
    JSON.stringify({ api_token: token, api_verno: '1', api_id: '42' }),
  )
  assert.ok(!redacted.includes(token), 'JSON 形态的 api_token 没被抹掉')
  assert.deepEqual(JSON.parse(redacted), {
    api_token: API_TOKEN_PLACEHOLDER,
    api_verno: '1',
    api_id: '42',
  })
  // 表单串兜底：格式意外不该成为凭据放行的理由
  assert.equal(
    redactPostBody('api_token=deadbeef&api_id=3'),
    `api_token=${API_TOKEN_PLACEHOLDER}&api_id=3`,
  )
  // 没有凭据的原样通过（含 null），别为抹除去重写无关行
  assert.equal(redactPostBody('{"api_id":"7"}'), '{"api_id":"7"}')
  assert.equal(redactPostBody(null), null)

  // 源码钉：record 的 INSERT 只允许喂进抹除后的 post_body；存量走 v6 迁移
  const ledger = fs.readFileSync(new URL('../src/main/mg/ledger.ts', import.meta.url), 'utf8')
  assert.match(ledger, /snapshotOnly \? null : body, redactPostBody\(postBody\)/)
  assert.match(ledger, /if \(previousVersion < 6\) this\.redactStoredTokensV6\(\)/)
})

test('体检回归（2026-08）：一轮全量检查修掉的病灶不许回潮', () => {
  const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')

  // EO 特别战果只认 false→true 跃迁：按「观测到常驻 cleared 就记」的话，
  // 跨战果月后去重窗口清空，月初第一个包会给每张已破图凭空补一笔
  // 2026-08-25 接进 api_get_exmap_rate 时这个循环从单行 if 改成了带 continue 的守卫式，
  // 判据一个字没变（仍然只认 false→true 那一跃），锚点跟着形状走。
  // 行为侧的钉在 test/eo-senka-reported.test.mjs——那边真跑一遍归约看记了几笔、记了多少。
  const main = read('../src/main/mg/index.ts')
  assert.match(main, /prevEoCleared = new Set/)
  assert.match(main, /!gauge\?\.cleared \|\| prevEoCleared\.has\(Number\(id\)\)/)

  // 活动永久归档的分类收支不许再漏高速建造材（90 日滚动过后永远补不回来）
  const ledger = read('../src/main/mg/ledger.ts')
  assert.match(ledger, /SUM\(fastbuild\) fastbuild[\s\S]{0,200}FROM material_delta WHERE \$\{inWin\} GROUP BY category/)
  // 操作事件下发渲染层之前再兜一道 api_token 抹除（入账已占位；防旧库/异常写入的明文流出）。
  // 旧钉只断言表单格式的剥除正则——post_body 实为 JSON 串，那条正则从没匹配过，正是
  // 「源码文本钉拦不住逻辑错」的实例；行为钉在「账本不落 api_token 明文」那条测试里。
  assert.match(ledger, /row\.postBody = redactPostBody\(row\.postBody\)/)

  // 锐：pane 级委托只在 mount 挂一次；渲染循环里的 wireFleetPanel 不许再碰 root.addEventListener
  // （两者原先都带 export——那是已删模块留下的口，没有第二个消费者，现已收回成
  //  模块内部函数。守卫要的是「两半仍然分开、各挂各的」，不是「它们被导出」。）
  const ru = read('../src/renderer/modules/ru.ts')
  const wireAt = ru.indexOf('const wireFleetPanel')
  const delegatesAt = ru.indexOf('const bindFleetPanelDelegates')
  assert.ok(wireAt >= 0 && delegatesAt > wireAt, 'wireFleetPanel/bindFleetPanelDelegates 的拆分不见了')
  const wirePart = ru.slice(wireAt, delegatesAt)
  assert.ok(wirePart.length > 0, 'wireFleetPanel/bindFleetPanelDelegates 的拆分不见了')
  assert.doesNotMatch(
    wirePart,
    /root\.addEventListener/,
    'wireFleetPanel 每次渲染都跑：往常驻 pane 上挂监听会随渲染次数无限叠加',
  )
  assert.equal((ru.match(/bindFleetPanelDelegates\(pane/g) ?? []).length, 1)

  // 鉴：掉落重试按钮的绑定必须住在 bindShipPanelControls（换块路径共用），
  // 深海 hero 横幅的 404 兜底必须以 pane 为 scope（它在 #ji-abyss-panel 外）
  const ji = read('../src/renderer/modules/ji.ts')
  const bindShipPart = ji.slice(
    ji.indexOf('const bindShipPanelControls'),
    ji.indexOf('const shipMemorialHtml'),
  )
  assert.match(bindShipPart, /data-ship-drops-retry/)
  assert.match(ji, /bindAbyssHeroArt\(pane\)/)
  // akashi 的运行时拉取 2026-08-22 整层退役 → 装备抽屉里那个按钮与它的委托一起没了。
  // 判据反过来钉：应用里不许再有指向该站点的出网点或按钮。
  assert.doesNotMatch(ji, /data-akashi/, 'akashi 拉取按钮又回来了')
  assert.doesNotMatch(ji, /akashi-fit:/, 'akashi 的运行时 IPC 又回来了')
  // tsunkit 的社区图标降级 2026-08-22 同样整层退役（同一条口径的第二件漏网旧物）：
  // **发行产物的对外请求只许指向游戏自己的服务器**，第三方服务零请求——
  // 「点了才请求」那条中间路早就废了，它是废之前留下的。何况 tsunkit 正是
  // 2026-08-06 封过本项目出口 IP 的那家，数据也无许可声明。
  assert.doesNotMatch(ji, /data-community-icon/, 'tsunkit 图标按钮又回来了')
  assert.doesNotMatch(ji, /communityIconUrl|communityAllowed/, 'tsunkit 图标的消费点又回来了')
  assert.doesNotMatch(
    read('../src/renderer/kcs-image.ts'),
    /communityIconUrl/,
    'tsunkit 图标的地址构造又回来了',
  )
  // 深海战绩要能随遭遇刷新，不许停在启动快照
  assert.match(ji, /abyssKillsStale = true/)
  assert.match(ji, /const ensureAbyssKills/)

  // 铎：活动期资源查询失败要 latch，不许「失败→重绘→再查」自激
  const du = read('../src/renderer/modules/du.ts')
  assert.match(du, /spentFailedAreaId !== areaId/)
  // 镝：分歧实测失败也要钉 key，同一格不许风暴式重试
  //（字段从模块级单例搬进了「这张图」那条记录，纪律不变：失败也钉 key + 清 pending）
  const di = read('../src/renderer/modules/di.ts')
  assert.match(di, /state\.key = key\s*\n\s*state\.pending = null\s*\n\s*state\.failed = true/)
  // 镝：血条回放护栏 mismatch 必须被消费（标 ≈），不许算了不用
  assert.match(di, /mismatch: timeline\.mismatch/)
  assert.match(di, /hp-approx/)
  // 镝：海图浮层在面板不可见时必须收起（否则钉在屏幕左上角盖住别的模块）
  assert.match(di, /paneVisible && sortieMapOpen/)

  // 铃：出击自动勿扰要同步托盘；锁定级 Toast 不许被普通通知挤掉
  const lg = read('../src/renderer/modules/lg.ts')
  assert.match(lg, /detectTaiha\(\)[\s\S]{0,400}syncTrayDnd\(\)/)
  assert.match(lg, /dataset\.locked/)
  // 驱逐逻辑必须只有一份：近改结果那处曾另写「删最老一条」，
  // 于是大破 Toast 被四条普通通知悄悄挤掉——正是这条纪律要防的失信。
  assert.match(lg, /const evictOverflowToasts = \(box: HTMLElement\)/)
  assert.equal(
    (lg.match(/evictOverflowToasts\(box\)/g) ?? []).length,
    2,
    '两处塞 Toast 的地方都要走同一套「只赶未锁定」的驱逐',
  )
  assert.doesNotMatch(lg, /box\.firstElementChild!\.remove\(\)/, '删最老一条会挤掉锁定级 Toast')

  // 铆：换坞菜单先钉住目标格对象再摘人（removeFrom 清空源格会让格序号漂移）
  const mu = read('../src/renderer/mu.ts')
  assert.match(mu, /const targetGroup = gi >= 0/)

  // 昼战炮击轮的目标池互斥：有对潜能力的舰在潜艇在场时强制对潜，
  // 不能既拿满对水面炮击又拿满对潜（那是两倍输出）
  const forecast = read('../src/shared/combat-forecast.ts')
  assert.match(forecast, /const aswPriority = hasSubmarineTarget && attacker\.asw > 0/)
  assert.match(forecast, /\} else if \(hasSurfaceTarget\) \{/)

  // CSS：--sans 必须有定义（19 处 font 简写引用它，缺定义整条作废）
  const html = read('../src/renderer/index.html')
  assert.match(html, /--sans: 'Segoe UI'/)
  assert.match(html, /\.mod-lg \.dot\.na \{/)
})

test('体检回归（2026-08 第二轮）：性能与健壮性专项不许回潮', () => {
  const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')

  // 抓包桥必须是异步 IPC：回到 @electron/remote 同步调用，游戏的 XHR 回调
  // 就得等主进程把整条记账链跑完（回港大包一到游戏就卡一下）
  const preload = read('../assets/preload/webview-preload.js')
  assert.match(preload, /ipcRenderer\.send\('kanso:game-api', 'response'/)
  assert.doesNotMatch(preload, /remote\.require\('\.\/game-api-broadcaster'\)/)
  const broadcaster = read('../src/main/game-api-broadcaster.ts')
  assert.match(broadcaster, /ipcMain\.on\('kanso:game-api'/)
  assert.match(broadcaster, /getType\(\) !== 'webview'/, 'IPC 对任意渲染进程可达，主进程侧要有第二道门')

  // 游戏 Image.src 热路径：cacheDir 只在 preload 初始化读一次，查找走带记忆的 lookup。
  // 以前每张图 config.get（同步 IPC）+ 两次 accessSync；MyCache 不存在时仍空跑，
  // 进战斗只卡游戏画面、艦素大破闪烁还在动。
  const resourceHack = read('../assets/preload/resource-hack.js')
  assert.match(resourceHack, /const cacheDir = config\.get\([\s\S]*?return createResourceLookup\(cacheDir\)/)
  assert.doesNotMatch(resourceHack, /findHackFilePath\(/)
  assert.match(resourceHack, /resolveHackedResource\(el\.src, true\)/)
  assert.match(resourceHack, /resolveHackedResource\(absoluteUrl, true\)/)

  // 装配作用域：重试装配前必须退掉上次挂了一半的内核订阅（防双注册）
  const mu = read('../src/renderer/mu.ts')
  assert.match(mu, /runMountCleanup\(mod\.id\)/)
  assert.match(mu, /beginMountScope\(mod\.id\)/)
  assert.match(mu, /endMountScope\(\)/)
  const kernel = read('../src/renderer/kernel.ts')
  assert.match(kernel, /trackForMountScope\(\(\) => removeFrom\(patchListeners, cb\)\)/)

  // 差分短路：签名没变的舰整个跳过（曾对全部在籍舰重建 equipment + JSON 比较）
  const shipLife = read('../src/main/mg/ship-life.ts')
  assert.match(shipLife, /shipSignatures\.get\(ship\.id\) === signature\) continue/)

  // 战斗详情视图状态按宿主隔离：史与镝同屏时不许互踩
  const di = read('../src/renderer/modules/di.ts')
  assert.match(di, /adoptBattlePaneState\(pane\)/)
  assert.match(di, /commitBattlePaneState\(pane\)/)

  // 备份恢复/缓存急救要能在 4 秒硬退路径上执行（taskkill / app.exit 都不走 will-quit）
  const yu = read('../src/main/yu.ts')
  assert.match(yu, /registerCriticalQuitWork\(runPendingQuitWork\)/)
  const quitGuard = read('../src/main/quit-guard.ts')
  // 顺序才是要点：先补跑必须执行的收尾，再杀渲染进程，最后才 taskkill 整棵树
  assert.match(quitGuard, /runCriticalQuitWork\(\)[\s\S]{0,400}killOwnProcessTree\(\)/)
  assert.match(quitGuard, /taskkill[\s\S]*\/T[\s\S]*\/PID/)
  // 清残留仍在，但调用点挪到了「拿到单实例锁之后」——挂在 installQuitGuard 里会
  // 在第二个实例启动时误杀正在用的那个。时机与实现的护栏在 process-reap.test.mjs
  assert.match(quitGuard, /export const reapOrphanKansoProcesses/)
  assert.match(read('../src/main/index.ts'), /reapOrphanKansoProcesses\(\)/)

  // config：get 不许把 DEFAULTS 子对象的引用交出去；set 对对象不许 === 早退
  const config = read('../src/main/config.ts')
  assert.match(config, /JSON\.parse\(JSON\.stringify\(value\)\)/)
  assert.match(config, /typeof value !== 'object' \|\| value === null/)

  // EO 战果记账只在 basic 变化的包上跑（曾每包一次 SELECT senka_state）
  const main = read('../src/main/mg/index.ts')
  assert.match(main, /sections\.includes\('basic'\)[\s\S]{0,120}logHqExp/)

  // 快照落盘：紧凑序列化 + 挪出记账 tick
  const atomic = read('../src/main/atomic-json.ts')
  assert.match(atomic, /options\.pretty \? JSON\.stringify\(value, null, 2\) : JSON\.stringify\(value\)/)
  assert.match(atomic, /fsyncSync/)
  const ledger = read('../src/main/mg/ledger.ts')
  assert.match(ledger, /setImmediate\(\(\) => \{[\s\S]{0,120}atomicWriteJsonSync\(file/)
  // 批量写要走事务（runBatch），别退回逐条自动提交
  assert.match(ledger, /private runBatch = /)
  assert.ok((ledger.match(/this\.runBatch\(/g) ?? []).length >= 4, 'runBatch 的接线少于四处')

  // fmtK/fmtMonthDay 单一出处（曾两套口径，同一个数在锱和铨长得不一样）
  assert.match(kernel, /export const fmtK = /)
  // 名单加了独立资源趋势窗：它是另一个 BrowserWindow 的入口文件，曾自留第三份
  // fmtK；本来就 import kernel（initKernel/mg/onMgChange 都从那儿来），没有理由另写。
  for (const rel of [
    '../src/renderer/modules/zi.ts',
    '../src/renderer/modules/qa.ts',
    '../src/renderer/resource-trend-window.ts',
  ]) {
    assert.doesNotMatch(read(rel), /const fmtK = /, `${rel} 又长出本地 fmtK 了`)
  }
  // 入渠工时也是同一类「格式单一出处」：锐与鉴原先各写一份逐字节相同的实现
  assert.match(kernel, /export const repairDuration = /)
  for (const rel of ['../src/renderer/modules/ru.ts', '../src/renderer/modules/qa.ts']) {
    assert.doesNotMatch(
      read(rel),
      /const repairDuration = /,
      `${rel} 又长出本地 repairDuration 了`,
    )
  }
})

test('导出成文件只剩一份：转义/BOM/文件名戳收口，反馈仍归各模块自己', async () => {
  const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
  const m = await import('../dist/shared/csv-text.js')
  const { csvCell, csvText, stampedFileName } = m.default ?? m

  // 逗号/引号/换行都得整格包起来，格内引号翻倍——三份复制里任何一份漏掉，
  // 带逗号的舰名（Bismarck drei 这类倒还好，实例备注是玩家自由文本）就会串列
  assert.equal(csvCell('普通'), '普通')
  assert.equal(csvCell(12), '12')
  assert.equal(csvCell('带,逗号'), '"带,逗号"')
  assert.equal(csvCell('带"引号'), '"带""引号"')
  assert.equal(csvCell('带\r\n换行'), '"带\r\n换行"')

  // BOM 必须是 U+FEFF：Excel 不认无 BOM 的 UTF-8，中文列会整片乱码。
  // 行分隔是 CRLF（三份里这一条曾是分三次分别补上的，正是最容易落下的一处）
  const text = csvText([
    ['舰名', '备注'],
    ['雪风', '带,逗号'],
  ])
  assert.equal(text.codePointAt(0), 0xfeff)
  assert.equal(text, '﻿舰名,备注\r\n雪风,"带,逗号"')

  // 文件名戳按**本地**日期（不是 UTC）：跨零点导出的文件名不该跳到别的日子
  assert.equal(stampedFileName('kanso-ships', 'csv', new Date(2026, 7, 5)), 'kanso-ships-20260805.csv')
  assert.equal(stampedFileName('kanso-deck', 'json', new Date(2026, 11, 31)), 'kanso-deck-20261231.json')

  // 三处调用方都走共用收口，各自不再自留一份转义/写盘
  const exporters = [
    ['../src/renderer/modules/qa.ts', '舰娘列表'],
    ['../src/renderer/modules/equip-stock.ts', '装备仓库'],
    ['../src/renderer/modules/ru.ts', '编成互通'],
  ]
  for (const [rel, what] of exporters) {
    const source = read(rel)
    assert.match(source, /saveTextFile\(/, `${what} 没走共用的对话框+写盘`)
    assert.doesNotMatch(source, /const csvCell = /, `${what} 又长出本地 csvCell 了`)
    assert.doesNotMatch(source, /showSaveDialog/, `${what} 又自己开保存对话框了`)
    assert.doesNotMatch(source, /writeFileSync/, `${what} 又自己写盘了`)
  }

  // 反馈留在各模块（展示位置与文案都是分别拍过板的），而且**失败必须说失败**：
  // 批次 2 补的这三句不许在收口时被抹掉
  const roster = read('../src/renderer/modules/qa.ts')
  assert.match(roster, /outcome\.status === 'failed' \? '导出失败 ✕'/)
  const stock = read('../src/renderer/modules/equip-stock.ts')
  assert.match(stock, /flashExportBadge\(outcome\.status === 'failed' \? '导出失败 ✗'/)
  const fleet = read('../src/renderer/modules/ru.ts')
  assert.match(fleet, /outcome\.status === 'failed' \? '存文件失败 · 可使用「复制 JSON」'/)
  // 用户自己按取消不算失败：三处都得先把 canceled 摘出去，别报成「导出失败」
  for (const [rel, what] of exporters) {
    assert.match(read(rel), /if \(outcome\.status === 'canceled'\) return/, `${what} 把取消当成了失败`)
  }
})

test('锱与资源趋势窗共用一份曲线取数：同一段时间不许给两个答案', async () => {
  const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
  const m = await import('../dist/shared/material-history.js')
  const { prepareMaterialHistory, activeEventAreaOf, naturalRegenCap } = m.default ?? m

  const row = (ts, fuel) => ({ ts, values: [fuel, 0, 0, 0, 0, 0, 0, 0] })

  // 窗口前有记录 → 有基线：那条把时刻挪到 startTs（阶梯曲线的起始余额就是它）
  const withBase = prepareMaterialHistory([row(50, 100), row(200, 300)], 100, 500, 0)
  assert.equal(withBase.hasBaseline, true)
  assert.equal(withBase.observedStart, 100)
  assert.deepEqual(withBase.rows.map((r) => r.ts), [100, 200])

  // 窗口内才开始记 → 没有基线，净变化不该按整窗口宣称
  const noBase = prepareMaterialHistory([row(150, 100), row(200, 300)], 100, 500, 0)
  assert.equal(noBase.hasBaseline, false)
  assert.equal(noBase.observedStart, 150)

  // 挪时刻可能撞上原有的 startTs 行，同一时刻只留后一条（否则曲线上出现竖直段）
  const collide = prepareMaterialHistory([row(50, 100), row(100, 222)], 100, 500, 0)
  assert.deepEqual(collide.rows.map((r) => [r.ts, r.values[0]]), [[100, 222]])

  // 越过 endTs 的行直接丢
  assert.deepEqual(
    prepareMaterialHistory([row(100, 1), row(600, 9)], 100, 500, 0).rows.map((r) => r.ts),
    [100],
  )

  // material_log 只在余额变化时写。回港快照更新 → 最后已知余额水平延伸到那一刻；
  // 但**不越过 endTs**，离线期间不冒充「已观测到现在」
  const held = prepareMaterialHistory([row(100, 7)], 100, 500, 400)
  assert.deepEqual(held.rows.map((r) => [r.ts, r.values[0]]), [[100, 7], [400, 7]])
  const clamped = prepareMaterialHistory([row(100, 7)], 100, 500, 9_999)
  assert.deepEqual(clamped.rows.map((r) => r.ts), [100, 500])
  // 回港快照比最后一条还旧 → 什么都不补
  assert.deepEqual(prepareMaterialHistory([row(100, 7)], 100, 500, 50).rows.map((r) => r.ts), [100])
  // 一条都没有 → 空，而不是编一条平坦曲线
  assert.deepEqual(prepareMaterialHistory([], 100, 500, 400), {
    rows: [],
    hasBaseline: false,
    observedStart: null,
  })

  // 活动区：已关闭的不算，多个进行中取最近开的那个
  const area = (firstSeenTs, closed) => ({ firstSeenTs, lastSeenTs: firstSeenTs, closed })
  assert.equal(activeEventAreaOf({}), null)
  assert.equal(activeEventAreaOf({ 46: area(100, true) }), null)
  assert.deepEqual(activeEventAreaOf({ 46: area(100, false), 47: area(300, false) }), [
    47,
    area(300, false),
  ])

  // 自然回复线：Lv × 250 + 750；等级还没同步到就返回 null（不知道就不说）
  assert.equal(naturalRegenCap(120), 120 * 250 + 750)
  assert.equal(naturalRegenCap(0), 750)
  assert.equal(naturalRegenCap(undefined), null)
  assert.equal(naturalRegenCap(null), null)

  // 两个界面都从这一份取，不许再各自抄一遍
  for (const rel of ['../src/renderer/modules/zi.ts', '../src/renderer/resource-trend-window.ts']) {
    const source = read(rel)
    assert.match(source, /prepareMaterialHistory\(rows, startTs, endTs, mg\.lastPortTs \?\? 0\)/, rel)
    assert.match(source, /activeEventAreaOf\(mg\.eventAreas\)/, rel)
    assert.match(source, /naturalRegenCap\(mg\.basic\?\.level\)/, rel)
    assert.doesNotMatch(source, /level \* 250 \+ 750/, `${rel} 又把自然回复线抄了一份`)
    assert.doesNotMatch(source, /const withinEnd = rows\.filter/, `${rel} 又把曲线取数抄了一份`)
  }
})

test('战果月标签只此一份：月界在前月末 22:00，直接看月界会得到上个月', async () => {
  const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
  const m = await import('../dist/shared/senka.js')
  const { senkaMonthLabel, senkaMonthStart, senkaQuestPeriodStartedInMonth } = m.default ?? m

  // 2026-08 的战果月起点是 2026-07-31 22:00 JST。直接对它取月份会读成 7 月——
  // 「+9h 换 JST、+3 天稳落主体月」的算术原先在三处各写一遍，这里钉成一份。
  const aug = senkaMonthStart(Date.UTC(2026, 7, 10) - 9 * 3600 * 1000)
  assert.equal(new Date(aug).toISOString(), '2026-07-31T13:00:00.000Z')
  assert.equal(senkaMonthLabel(aug), '2026-08')
  // 月界那一刻本身也得算进新的月（+3 天的余量就是给它的）
  assert.equal(senkaMonthLabel(senkaMonthStart(aug)), '2026-08')
  // 2 月最短，+3 天也不会越过它
  assert.equal(senkaMonthLabel(senkaMonthStart(Date.UTC(2026, 1, 10) - 9 * 3600 * 1000)), '2026-02')
  // 跨年：1 月的月界落在去年 12/31，年份要跟着主体月走
  assert.equal(senkaMonthLabel(senkaMonthStart(Date.UTC(2026, 0, 10) - 9 * 3600 * 1000)), '2026-01')

  // 补记资格的判据（行为全测在 senka-quest-recount.test.mjs；这里只钉「同一份口径」）：
  // 判的是**当前周期的起点**落没落进本战果月，不是「本月是不是周期首月」——
  // 后者在月界与任务重置差着的那 7 小时里会把上个月的季任记进新月（2026-08-31 实锤）。
  const marAt = Date.UTC(2026, 2, 10) - 9 * 3600 * 1000
  const augAt = Date.UTC(2026, 7, 10) - 9 * 3600 * 1000
  const mar = senkaMonthStart(marAt)
  assert.equal(senkaQuestPeriodStartedInMonth('quarterly', mar, marAt), true)
  assert.equal(senkaQuestPeriodStartedInMonth('quarterly', aug, augAt), false)
  assert.equal(senkaQuestPeriodStartedInMonth('annual', aug, augAt, 8), true)
  assert.equal(senkaQuestPeriodStartedInMonth('annual', aug, augAt, 3), false)
  assert.equal(senkaQuestPeriodStartedInMonth('monthly', aug, augAt), true)
  // 错位窗口：8/31 22:30 JST 已属 9 月战果月，季任那一期却还是 6 月起的
  const slip = Date.UTC(2026, 7, 31, 13, 30) // = 2026-08-31 22:30 JST
  assert.equal(senkaMonthStart(slip), Date.UTC(2026, 7, 31, 13))
  assert.equal(senkaQuestPeriodStartedInMonth('quarterly', senkaMonthStart(slip), slip), false)

  const senkaSource = read('../src/shared/senka.ts')
  assert.equal(
    (senkaSource.match(/3 \* 24 \* 3600 \* 1000/g) ?? []).length,
    1,
    '「+3 天落主体月」的算术只许出现在 senkaMonthLabel 里',
  )
  assert.doesNotMatch(
    read('../src/renderer/modules/zi.ts'),
    /3 \* 24 \* 3600 \* 1000/,
    '锱又把战果月标签的算术抄了一份',
  )
})

test('可逆改装的形态切换不算「下一步改造」缺口', () => {
  // 用户实弹（2026-08-11）：五艘停在改二戊/甲的舰把回转素材顶成「道具缺 1」，
  // 需求队列的缺口全是虚数。赤城改二⇄戊、宗谷三形态这类互转是按需的形态
  // 切换，不是前进方向的待办——判据：从改造后形态沿改造边（aftershipid +
  // 原生升级表）还能走回当前形态。
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  assert.match(catalog, /const isFormSwitch = \(currentId: number, targetId: number\)/)
  assert.match(catalog, /addEdge\(Number\(upgrade\.currentShipId\) \|\| 0, Number\(targetText\)\)/)
  // 队列展示与锱用的聚合是同一道判定；切换行不进缺口合计
  assert.match(catalog, /const formSwitch = isFormSwitch\(need\.mstId, need\.targetId\)/)
  assert.match(catalog, /if \(isFormSwitch\(need\.mstId, need\.targetId\)\) \{\s*out\.switchShips\+\+/)
  assert.match(catalog, /⇄ 形态切换/)
  assert.match(catalog, /switchNeed: number/)
  // 边缓存随主数据/需求表重建一并作废（缓存必须带失效键的口径）
  assert.match(catalog, /remodelForwardEdges = null \/\/ 改造边随主数据走/)
  assert.match(catalog, /remodelForwardEdges = null \/\/ 需求表重建时/)
  const resources = fs.readFileSync(new URL('../src/renderer/modules/zi.ts', import.meta.url), 'utf8')
  // 「（可逆改装的形态切换不计入）」这句脚注 2026-08-26 按文案清扫族 C 删了
  //（每枚芯片的悬停已写「N 艘舰娘的下一步改造合计需要 M」）。判据不在那句话里——
  // 锱不自己数队列，它读的就是上面那道判定过的聚合，改钉这条接线。
  assert.match(resources, /const demand = useitemDemand\(hit\.id\)/)
  assert.match(resources, /demand\.queueShips\} 艘舰娘的下一步改造合计需要 \$\{demand\.queueNeed\}/)
  assert.doesNotMatch(resources, /queueNeed = /, '锱又自己算了一遍队列需求')
})

test('升级表同目标多行必须全留，素材按来路各归各', () => {
  // 实弹（2026-08-11，用户游戏截图证伪）：api_mst_shipupgrade 同一目标可以有
  // 多行——赤城改二←赤城改要图纸2+弹射1+详报1+航空资材2，赤城改二←戊全零。
  // 按目标收成单行时后行覆盖前行，wikiwiki 补充素材再按幸存行的 currentShipId
  // 挂前置，弹射器就被记到了戊→改二的回转上；remodel 排序拿回环行的大 stage
  // 还会把回转误判成「向更高阶推进」。
  const types = fs.readFileSync(new URL('../src/shared/mg-types.ts', import.meta.url), 'utf8')
  const store = fs.readFileSync(new URL('../src/main/mg/store.ts', import.meta.url), 'utf8')
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const remodel = fs.readFileSync(new URL('../src/renderer/remodel.ts', import.meta.url), 'utf8')
  assert.match(types, /upgrades: Record<number, MasterShipUpgrade\[\]>/)
  assert.match(store, /\(upgrades\[targetShipId\] \?\?= \[\]\)\.push\(/)
  // 需求反查：原生逐行读、wikiwiki 挂前进路径、去重键含前置
  assert.match(catalog, /for \(const upgrade of upgradeRows\) \{\s*for \(const spec of NATIVE_UPGRADE_NEEDS\)/)
  // 原生行在场时 0 也是权威（榛名乙→丙原生全零，wiki 把累计素材写在丙页上，
  // 不封口就凭空造需求）；回环边真消耗的三例（鈴谷/熊野航改二、三隈改二特）
  // 原生给正数，不受影响
  assert.match(
    catalog,
    /covered\.add\(`\$\{spec\.kind\}:\$\{targetId\}:\$\{upgrade\.currentShipId\}:\$\{spec\.id\}`\)/,
  )
  assert.match(catalog, /targetRows\.find\(\(row\) => !isFormSwitch\(row\.currentShipId, targetId\)\)/)
  assert.match(catalog, /const key = `\$\{kind\}:\$\{targetId\}:\$\{predecessorId\}:\$\{itemId\}`/)
  // 改装链抽屉：素材取链上显示的那条来路
  assert.match(catalog, /upgradeRows\.find\(\(row\) => Number\(row\.api_current_ship_id\) === chain\[i - 1\]\)/)
  // 指明来路却无此行 → 原生层不越权拿别行
  assert.match(catalog, /upgradeRows\.find\(\(row\) => row\.currentShipId === currentShipId\) \?\? null/)
  // remodel 档位序取各行最小 stage
  assert.match(remodel, /Math\.min\(order\.get\(target\) \?\? Number\.POSITIVE_INFINITY, upgrade\.stage\)/)
})

test('wikiwiki 改造明细按边取用，对不上来路就空着不错拿', () => {
  // 实弹（2026-08-11）：矿脉按目标一条时，榛名丙→乙这条回程边被挂上首次
  // 解锁（改二→乙）的 開発資材×390。真值按边——主条目/edges 各带 fromShipId，
  // 指明来路却无匹配明细时交给 kcwiki 逐边兜底，绝不错拿别的边。
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  // needChipsHtml：先对主条目声明的来路，再找 edges，最后才容旧格式（无声明）
  assert.match(catalog, /if \(Number\(wikiwikiEntry\.fromShipId\) === currentShipId\) return wikiwikiEntry/)
  assert.match(catalog, /edges\.find\(\(entry: any\) => Number\(entry\?\.fromShipId\) === currentShipId\)/)
  assert.match(catalog, /return Number\(wikiwikiEntry\.fromShipId\) > 0 \? null : wikiwikiEntry/)
  // 需求反查：主条目/edges 逐条按声明的来路挂账，没声明才退回前进路径启发
  assert.match(catalog, /const details = \[entry, \.\.\.\(Array\.isArray\(entry\?\.edges\) \? entry\.edges : \[\]\)\]/)
  assert.match(catalog, /Number\(detail\?\.fromShipId\) \|\| \(detail === entry \? heuristicPredecessorId : 0\)/)
  // 抽屉：可逆一对的素材检测按方向各自独立（用户指出此前只检向右），
  // 排布「空间即方向」：⇄ 居中、上组前进、下组回程，不画 →/← 小箭头；
  // 回程行的弹钢/等级取本节点自己的原生字段；回程素材只认 wikiwiki
  // 回程边（kcwiki 没写回程，raw 传 null）
  assert.match(catalog, /const paired = isFormSwitch\(predecessorId, mstId\)/)
  assert.match(catalog, /needChipsHtml\(null, predecessorId, mstId\)\.needs/)
  assert.match(catalog, /rm-arrow bi/)
  assert.match(catalog, /bi-glyph">⇄/)
  assert.match(catalog, /改造素材 · 改往/)
  assert.match(catalog, /改造素材 · 改回/)
  assert.match(catalog, /<span class="back">Lv \$\{s\.api_afterlv \?\? '\?'\}/)
  // kcwiki 图纸串兜底同理跳过全部形态切换边
  assert.match(catalog, /if \(afterId > 0 && isFormSwitch\(entry\.ID, afterId\)\) continue/)
  // 装配层：チャート首次出现是主条目（链上首解锁），再次出现与脚注回程进
  // edges；总表回程行（条件「-」+tooltip）补页落定后挂边
  const fetcher = fs.readFileSync(new URL('../scripts/fetch-lodes.mjs', import.meta.url), 'utf8')
  assert.match(fetcher, /if \(!pageReplaced\.has\(ids\[0\]\)\)/)
  assert.match(fetcher, /attachEdge\(out\[ids\[0\]\], \{ \.\.\.detail, source: 'chart' \}\)/)
  assert.match(fetcher, /source: 'footnote',/)
  assert.match(fetcher, /source: 'index' \}/)
  const parser = fs.readFileSync(
    new URL('../scripts/lib/wikiwiki-remodel.mjs', import.meta.url),
    'utf8',
  )
  assert.match(parser, /conversionOnly && !needs\.length/)
})

test('三维成长分层：一手上限优先、kcwiki 的 -1 当缺、缺资料不硬造', () => {
  // 游戏对持有形态下发 api_kaihi/taisen/sakuteki 的 [1]＝Lv99 上限（一手），
  // 从前 store 只留 [0] 把它丢了。成长公式与结婚档位的实测依据（183 艘
  // 空槽 544/546、12 艘婚舰全中）钉在 shared/ship-growth.ts 与其测试里。
  const types = fs.readFileSync(new URL('../src/shared/mg-types.ts', import.meta.url), 'utf8')
  const store = fs.readFileSync(new URL('../src/main/mg/store.ts', import.meta.url), 'utf8')
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  assert.match(types, /kaihiMax: number/)
  assert.match(store, /kaihiMax: Array\.isArray\(raw\.api_kaihi\) \? raw\.api_kaihi\[1\] \?\? 0 : 0/)
  // 图鉴属性区：持有形态的 Lv99 上限用一手值。2026-08-22 起端点整体走第一方
  // `ship-stats` 汇编包，「一手压过包」这条口径由 `growthEndpoints` 一处实现，
  // 行为级护栏在 test/ship-growth-gate.test.mjs——这里只钉「图鉴确实是从那条路取的」。
  assert.match(catalog, /回避: liveInstance\.kaihiMax/)
  assert.match(catalog, /shipGrowthEndpointsOf\(\s*shipState\.selectedForm,/)
  // 分层：等级成长→99、婚后 99→175、结婚耐久、改修余量，图例常驻
  assert.match(catalog, /levelGrowth\(base, max99, MARRIED_LEVEL_CAP\)/)
  assert.match(catalog, /marriedMaxHp\(pair\[0\], pair\[1\]\)/)
  assert.match(catalog, /STAT_LEGEND_HTML/)
  assert.match(catalog, /改造强化：较\$\{entityNamePlain\('ship', prevId, prevForm\.api_name\)\}初始/)
  // 三维全缺时的坦白话术保留——绝不摆一个看起来像真的数字。
  // 「不是这艘舰没有那几项」这条辩护尾巴与行内 <b> 强调按 2026-08-26 文案清扫裁定
  //（族 9）删了，缩成「回避 / 对潜 / 索敌暂无数据」。护栏语义不放松：真正要防的是
  //「三维全缺时摆出一个假数字」，所以钉的是**挂牌本身仍在**、且只在三行全空时出现。
  assert.match(catalog, /回避 \/ 对潜 \/ 索敌暂无数据/)
  assert.match(catalog, /growthRows\.every\(\(row\) => !row\)/)
})

test('受损语音弹幕按播放时刻血量分四档，通知弹窗默认锚在游戏画面右下', () => {
  // 弹幕着色（用户 2026-08-11，小破/中破/大破/击沉四档）：我方 19/20/21 是
  // 全舰统一受损语音槽、22=轟沈（wikiwiki 语音表 100+ 舰实证），深海
  // damage 槽=音轨后缀 30/31、sunk=40/41。受损音轨按战斗视图实际血量分：
  // ≤25% 大破红、≤50% 中破琥珀、更高小破黄；拿不到血量不上色，不猜档位；
  // 击沉语音槽位即语义。
  const subtitle = fs.readFileSync(new URL('../src/renderer/voice-subtitle.ts', import.meta.url), 'utf8')
  assert.match(subtitle, /const DAMAGE_VOICE_SLOTS = new Set\(\[19, 20, 21\]\)/)
  assert.match(subtitle, /const SUNK_VOICE_SLOT = 22/)
  assert.match(subtitle, /const ENEMY_DAMAGE_SUFFIXES = new Set\(\[30, 31\]\)/)
  assert.match(subtitle, /const ENEMY_SUNK_SUFFIXES = new Set\(\[40, 41\]\)/)
  assert.match(subtitle, /if \(worst <= 0\.25\) return 'heavy'/)
  assert.match(subtitle, /if \(worst <= 0\.5\) return 'mid'/)
  assert.match(subtitle, /return 'light'/)
  assert.match(subtitle, /if \(worst == null\) return null/)
  assert.match(subtitle, /dmg-\$\{tone\}/)
  const html = rendererSource
  for (const tone of ['light', 'mid', 'heavy', 'sunk']) {
    assert.match(
      html,
      new RegExp(`\\.voice-danmaku-item\\.dmg-${tone} \\{ color: var\\(--voice-dmg-${tone}\\); \\}`),
    )
  }
  // 通知弹窗（用户 2026-08-11）：默认锚游戏画面右下角、宽度压 250（他嫌 300 宽）；
  // 容器收起时退回 body，通知不能跟着容器一起隐身。
  // 参照系与角落自 2026-08-29 起玩家可选（3×4），「默认位置没变」与「容器收起退回 body」
  // 已改由行为级护栏看着——test/lg-toast-position.test.mjs 真造一张卡，看它最后挂在谁身上。
  // 这里只留 CSS 那两条：假 DOM 里没有布局，量不出来。
  assert.match(html, /#game-wrapper > #lg-toasts \{ position: absolute; \}/)
  assert.match(html, /#lg-toasts \{ position: fixed;[^\n]*width: min\(250px/)
})

test('通关阵容:打赢过 Boss 的编成聚合进海域图鉴,作个人带路参考', () => {
  // 2026-08-17 用户提议:海域记录里加「通关阵容」,到 Boss 率就是本地带路实测。
  const ledger = fs.readFileSync(new URL('../src/main/mg/ledger.ts', import.meta.url), 'utf8')
  const chron = fs.readFileSync(new URL('../src/main/mg/chronicle.ts', import.meta.url), 'utf8')
  const atlas = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const html = rendererSource
  // 只列赢过的;签名解析失败的行不冒充数据
  assert.match(ledger, /filter\(\(agg\) => agg\.wins > 0\)/)
  // 展示按舰组合并组:签名带等级,练级会把同一套船拆成一行一级(滨波实锤);
  // 等级/装备/33式取最近一次赢的那场
  assert.match(ledger, /decks\.map\(\(deck\) => deck\.map\(\(ship\) => ship\.mstId\)\)/)
  assert.match(ledger, /取最近一次赢的那场/)
  // 航迹按时间窗从 routes 还原(routes 不带场次 id,本场起点到下一场起点之间的边);
  // 「路线有变」= 多次通关走过不同路线,判绕路的直接信号
  assert.match(ledger, /const nextStart = starts\.find\(\(value\) => value > startTs\)/)
  assert.match(ledger, /agg\.pathVaried = new Set\(winPaths\)\.size > 1/)
  // 装备与 33 式没法从签名回溯——出击那一刻由铭落表(数学核与编成面板同一份)
  assert.match(ledger, /\['sortie_samples', 'fleet_equips', 'TEXT'\]/)
  assert.match(ledger, /\['sortie_samples', 'los33', 'REAL'\]/)
  const chronicle = fs.readFileSync(new URL('../src/main/mg/chronicle.ts', import.meta.url), 'utf8')
  assert.match(chronicle, /fleetEquips: fleetEquipsOf\(sortie\.deckId\)/)
  assert.match(chronicle, /los33: fleetLos33Of\(sortie\.deckId\)/)
  assert.match(chronicle, /los33Of\(ships, admiralLv, 1, slotCount\)/)
  const calc = fs.readFileSync(new URL('../src/renderer/fleet-calc.ts', import.meta.url), 'utf8')
  assert.match(calc, /return los33Of\(inputs, admiralLv, mapModifier, slotCount\)/, '编成面板与出击样本必须同一套 33 式数学')
  // 排序按出击次数+胜率倒序(用户口径),都同再看最近
  assert.match(ledger, /right\.sorties - left\.sorties \|\|\s*\n\s*winRate\(right\) - winRate\(left\)/)
  // 舰种标注共用 ship-category 的 STYPE_CN;主推头两套,其余显式按钮展开/收起。
  // 不用 <details>:抽屉随报文重渲染会抹掉 open 态,点开立刻缩回像完全藏住
  // (2026-08-17 用户实锤「没有更多」);展开态存模块状态,换图归位
  assert.match(atlas, /STYPE_CN\[stype\] \?\? mg\.master\.stypes\[stype\]/)
  assert.match(atlas, /rows\s*\n?\s*\.slice\(0, 2\)\s*\n?\s*\.map\(\(row, index\) => rowHtml\(row, index\)\)/)
  assert.match(atlas, /展开其余 \$\{rest\.length\} 套/)
  assert.match(atlas, /mapClearFleetsOpen = !mapClearFleetsOpen/)
  assert.match(atlas, /mapClearFleetsOpen = false \/\/ 换图回到只主推两套/)
  assert.doesNotMatch(atlas, /<details class="cf-more">/)
  // 标题带总数:只有两套的图一眼可知「没有更多」
  assert.match(atlas, /共 \$\{count\} 套/)
  // 航迹/装备/33式进展示:字母走 fcd,装备全队聚合+逐舰悬停,33式一位小数
  assert.match(atlas, /class="cf-path"/)
  assert.match(atlas, /class="cf-equips"/)
  // 装备聚合是类别图标 ×N,不是文字名平铺(2026-08-18 用户实锤「密密麻麻」);
  // 图标即装备实体链接,悬停出名字卡
  assert.match(atlas, /class="cf-eq">\$\{elinkHtml\(\s*\n?\s*'mstEquip',/)
  assert.doesNotMatch(atlas, /\$\{esc\(parts\.join\(' · '\)\)\}/)
  assert.match(html, /\.mod-ji \.map-clear-fleets \.cf-eq \{/)
  assert.match(atlas, /33式 <b>\$\{row\.los33\.toFixed\(1\)\}<\/b>/)
  assert.match(html, /\.mod-ji \.map-clear-fleets \.cf-path/)
  // 舰名点击开「通关那时」快照卡(2026-08-17 用户纠正:这行是历史快照,
  // 超链接不该指向现在的角色);卡挂 body,Esc 捕获阶段关卡不带走抽屉
  assert.match(atlas, /data-cf-snap="\$\{rowIndex\},\$\{deckIndex\},\$\{shipIndex\}"/)
  // 这条只管**通关阵容那一段**：它是历史快照，舰名点开该是「通关那时」的卡。
  // 别拿整份 ji.ts 当范围——同一份文件里「本机确认掉落」那类活数据链到现在的图鉴页
  // 才是对的，全文匹配会把对的一起判红（2026-08-22 实际撞过一次）。
  const clearFleets = atlas.slice(
    atlas.indexOf('const mapClearFleetsHtml'),
    atlas.indexOf('\nconst ', atlas.indexOf('const mapClearFleetsHtml') + 10),
  )
  assert.ok(clearFleets.length > 500, '通关阵容那一段没切出来')
  assert.doesNotMatch(clearFleets, /elink\('mstShip', ship\.mstId/, '通关阵容舰名不该直链活的图鉴页')
  assert.match(atlas, /document\.body\.appendChild\(cfSnapEl\)/)
  assert.match(atlas, /document\.addEventListener\('keydown', cfSnapEsc, true\)/)
  // 「（现在的这一页）」是 UI 自我解说，按文案清扫裁定（族 7）删；钮与去向不变
  assert.match(atlas, /data-act="cf-snap-open">打开图鉴</)
  assert.match(html, /\.cf-snap-host \{ position: fixed/)
  const roster = fs.readFileSync(new URL('../src/renderer/modules/qa.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(roster, /const STYPE_CN/, '舰种短名该从 ship-category 引,不该自留一份')
  // 难度/活动代与出击样本落表口径一致(mapGauges.selectedRank / eventAreas.firstSeenTs)
  assert.match(chron, /chron:map-clear-fleets/)
  assert.match(chron, /state\.mapGauges\[mapId\]\?\.selectedRank \?\? 0/)
  // 图鉴接入:与遭遇志同代失效。
  // 这行原先写的是「拉失败不立墓碑」,已与实情不符:空数组确实是合法答案(照常存成
  // 已加载),但「查不出来」不是——不记的话 finally 里的 scheduleRender 会把当代
  // 变成无限重试,UI 一直停在「正在读取出击样本…」。现在失败会立一块**按代的**
  // 墓碑,下一代(出击反哺推进代数)自然作废、届时重试。
  assert.match(atlas, /\$\{mapChronicleHtml\(info\)\}\s*\n\s*\$\{mapClearFleetsHtml\(info\)\}/)
  assert.match(atlas, /const generation = mapChronicleGeneration\.get\(mapId\) \?\? 0\s*\n\s*if \(mapClearFleetsLoaded/)
  // 空数组走成功路径(记成已加载,不是失败)
  assert.match(atlas, /mapClearFleets\.set\(mapId, Array\.isArray\(rows\) \? rows : \[\]\)/)
  // 墓碑只对当代有效,且只在代号没被推进时才记(过期的失败不许污染新代)
  assert.match(atlas, /if \(mapClearFleetsErrors\.get\(mapId\) === generation\) return/)
  assert.match(
    atlas,
    /if \(\(mapChronicleGeneration\.get\(mapId\) \?\? 0\) === generation\) \{\s*\n\s*mapClearFleetsErrors\.set\(mapId, generation\)/,
  )
  assert.match(atlas, /到 Boss 率：当前编成本图全部出击/)
  assert.match(html, /\.mod-ji \.map-clear-fleets \.cf-row/)
})

test('Toast 同类合并:一批同类通知折成一张卡,锁定级永不参与', () => {
  // 2026-08-17 用户点名:一次处理多了会瞬间占满那一条空间。
  // 同类非锁定的新通知折进已显示的卡(标题 ×N,正文换最新,倒计时重走);
  // 大破锁定卡承诺「需手动关闭」,既不被合并也不吞别人。
  const bell = fs.readFileSync(new URL('../src/renderer/modules/lg.ts', import.meta.url), 'utf8')
  assert.match(bell, /if \(!def\.locked\) \{\s*\n\s*const existing = /)
  assert.match(bell, /dataset\?\.event === def\.id && !\(child as HTMLElement\)\.dataset\.locked/)
  assert.match(bell, /existing\.dataset\.stack = `\$\{count\}`/)
  assert.match(bell, /`\$\{def\.label\} ×\$\{count\}`/)
  assert.match(bell, /`最新：\$\{detail\}`/)
  // 批量标题(任务完成 ×2)的计数要接着累加,不能从 1 重数
  assert.match(bell, /title\.match\(\/×\(\\d\+\)\/\)/)
  // 倒计时重走:旧移除计时必须清掉,不能让先到的那条带走整张合并卡
  assert.match(bell, /const prior = toastTimers\.get\(el\)/)
  assert.match(bell, /if \(prior\) clearTimeout\(prior\)/)
  // 合并卡点击进面板总览,不再指向第一条的详情
  assert.match(bell, /goToNotice\(def, el\.dataset\.merged \? undefined : ref\)/)
  // 「点哪儿会跳转」那一半（卡面只关闭 / 只有「→ ××」跳转,含合并卡的落点）
  // 已经在 test/lg-toast-click.test.mjs 里真点过一遍,这里不再钉句子文本。
})

test('联合舰队夜战追击提示与 Boss 警告同走一份判别式', () => {
  // 追击提示原先按「昼战没杀完护卫 → 夜战只与护卫交战」写死，那是把**全灭**
  // 当成了唯一放行条件。用户 2026-08-26 纠正该口径，当晚实战也逐字打脸：
  // 敌护卫只剩 1 舰小破（判别式 2.0 < 3，应直击主力），提示却还在说主力够不着。
  // 两处现在共用 shared/enemy-night-target。
  //
  // **三条分支的行为级护栏在 test/outcome-banner.test.mjs**（对着产物 HTML，
  // 判别式引真的那一份）——这里只钉「消费的是那份判别式、不是自造阈值」，
  // 措辞与算分正确与否交给那边，别再在这里钉句子文本。
  const combat = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  assert.match(combat, /const enemyCombined = b\.eShips\.some\(\(ship\) => ship\.fleet === 'escort'\)/)
  assert.match(combat, /enemyNightTargetOf\(/)
  assert.doesNotMatch(
    combat,
    /夜战只与敌护卫交战/,
    '旧的断言式口径（护卫没杀完就一定打不到主力）不许回潮',
  )
  // Boss 点的「夜战接触不到旗舰」警告是同一条机制的另一面，不许退化。
  // 规则复述半句已删（同一句的结论半句另有护栏钉着，见「敌护卫仍在就别进夜战」那条），
  // 改钉这条警告的抬头本身——它点名了「接触不到谁」，比规则复述更难被删空。
  //
  // 2026-08-26 抬头换了：原来数「还剩几艘」，但艘数并不决定交战对象——
  // 判别式按损伤算分（shared/enemy-night-target），且它是暂定式、有例外观测，
  // 所以措辞降为「预计」。艘数不再出现在文案里，这里跟着钉新抬头。
  assert.match(combat, /敌护卫仍有战力 · 夜战估算无法攻击 \$\{flagshipName\}/)
})

test('三维端点换源：运行时只认第一方汇编包，wikiwiki-ship-max 退成维护者侧选票', () => {
  // 2026-08-22 换源：从前 UI 直读 `wikiwiki-ship-max`，那个包无许可声明、不随发行版，
  // 于是**发布版**这一格只能显示占位。现在值走第一方 `ship-stats` 汇编（随包），
  // wikiwiki 只在 `lodes:fetch` 汇编时逐格投票。层级本身（一手 > 包）由
  // `growthEndpoints` 一处实现，行为级护栏在 test/ship-growth-gate.test.mjs。
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const roster = fs.readFileSync(new URL('../src/renderer/modules/qa.ts', import.meta.url), 'utf8')
  assert.match(catalog, /queryLode\('ship-stats'\)/)
  // 两处消费共用 fleet-calc 那一份端点，不各拉各的、各自失效
  assert.match(catalog, /shipGrowthEndpointsOf/)
  assert.match(roster, /shipGrowthEndpointsOf\(ship\.shipId, 'evasion', ship\.kaihiMax\)/)
  // 运行时**一行都不许再读** wikiwiki-ship-max（它是维护者侧选票，且不随包——
  // 读了它就等于让发布版依赖一个玩家手上没有的文件）。
  // 禁的是**代码**：注释里那句「原先直读 wikiwiki-ship-max」是换源的来龙去脉，
  // 恰恰要留着且要 grep 得到，所以比之前先把注释剥掉——否则这条护栏会去咬文档。
  const stripComments = (src) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*$/gm, '$1')
  for (const [name, src] of [['ji', catalog], ['qa', roster]]) {
    assert.doesNotMatch(
      stripComments(src),
      /wikiwiki-ship-max/,
      `${name} 还在读维护者侧的 wikiwiki-ship-max`,
    )
  }
  assert.ok(
    !CONSUMED_LODE_IDS.includes('wikiwiki-ship-max'),
    'wikiwiki-ship-max 还挂在运行时读取清单里——它已降为维护者侧选票',
  )
  // 收起的「资料来源与新鲜度」仍声明整条层级——这是本页唯一的出处落点
  // 破折号按文案清扫裁定（族 9）一律改「 · 」；这一行的内容一字未动
  assert.match(catalog, /三维初始值与 Lv99 上限 · 持有形态取游戏一手/)
  // 但小节抬头的常驻署名尾注不许回来（2026-08-20 用户拍板）
  assert.doesNotMatch(catalog, /敌我固定标尺/)
  assert.doesNotMatch(catalog, /三维上限取游戏一手/)
  // 「成长值疑似过时」台账只在诊断面板（铭，KANSO_DEBUG_UI 才装配）：
  // 玩家玩游戏时不需要看「哪张社区表过期了」，闸门已经替他把错数挡掉了。
  const diagnostics = fs.readFileSync(
    new URL('../src/renderer/modules/mgstate.ts', import.meta.url),
    'utf8',
  )
  assert.match(diagnostics, /growthGateReport/, '闸门台账没有落点 = 抓到的残差没人看得见')
  for (const rel of ['ji.ts', 'qa.ts', 'ru.ts', 'yu.ts']) {
    const source = fs.readFileSync(new URL(`../src/renderer/modules/${rel}`, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /growthGateReport/, `${rel}: 维护者侧台账铺到正式界面上了`)
  }
  // 装配：名字为主对齐，図鑑号只在重名时消歧（后缀行当主键会塌到素体上）
  const fetcher = fs.readFileSync(new URL('../scripts/fetch-lodes.mjs', import.meta.url), 'utf8')
  assert.match(fetcher, /834 行对齐只剩 590 个唯一 id 的实锤/)
  assert.match(fetcher, /candidates\.length !== 1 \|\| out\[id\]/)
})

test('api_afterbull 是弹药、api_afterfuel 是钢材——字段名陷阱不许再回潮', () => {
  // 两张游戏改装画面实拍交叉核定（2026-08-11）：赤城改二戊 弹2000/钢2800，
  // 主数据 afterbull=2000/afterfuel=2800；榛名改二乙 弹1300/钢1700，
  // afterbull=1300/afterfuel=1700。wikiwiki 改造总表（弾薬/鋼材列）同向。
  // 此前抽屉按「fuel=弹」兜底，kcwiki 缺值的形态弹钢互换。
  const types = fs.readFileSync(new URL('../src/shared/mg-types.ts', import.meta.url), 'utf8')
  const store = fs.readFileSync(new URL('../src/main/mg/store.ts', import.meta.url), 'utf8')
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  assert.match(types, /afterAmmo: number \/\/ ← api_afterbull/)
  assert.match(types, /afterSteel: number \/\/ ← api_afterfuel/)
  assert.match(store, /afterAmmo: s\.api_afterbull \?\? 0/)
  assert.match(store, /afterSteel: s\.api_afterfuel \?\? 0/)
  assert.match(catalog, /弹\$\{\s*wiki\?\.弹药 \?\? predecessor\?\.api_afterbull \?\? '\?'\s*\}/)
  assert.match(catalog, /钢\$\{wiki\?\.钢材 \?\? predecessor\?\.api_afterfuel \?\? '\?'\}/)
  assert.doesNotMatch(catalog, /弹\$\{\s*wiki\?\.弹药 \?\? predecessor\?\.api_afterfuel/)
})

test('列表详情预览的实例属性条：三层拆解 + 与图鉴共用渲染件和色语', () => {
  // 用户 2026-08-11：列表点开自己的舰娘后，属性也要像图鉴那样用条条展示，
  // 但分「目前裸值 / 装备给予额外值 / 可提升值」。数值口径的行为测试在
  // ship-stat-layers.test.mjs；这里钉接线：qa 用公共渲染件、矿脉层级不许绕。
  const roster = fs.readFileSync(new URL('../src/renderer/modules/qa.ts', import.meta.url), 'utf8')
  const bars = fs.readFileSync(new URL('../src/renderer/stat-bars.ts', import.meta.url), 'utf8')
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const html = rendererSource
  // 条条渲染单一出处：ji 与 qa 都从 stat-bars 导入，不再各留一份
  assert.match(bars, /export const statRowLayered/)
  // 装备给予写成「+N」增量（现在就在身上的），→ 只留给强化/成长的未来态
  // （用户 2026-08-11 纠正）；裸值未知的降级路径仍走 →
  assert.match(bars, /segment\.kind === 'equip' && init != null/)
  assert.match(bars, /\$\{delta >= 0 \? '\+' : ''\}\$\{delta\}/)
  assert.match(catalog, /import \{ statRowLayered, statScale, statWidth \} from '\.\.\/stat-bars'/)
  assert.match(roster, /import \{ statRowLayered \} from '\.\.\/stat-bars'/)
  assert.doesNotMatch(catalog, /const statRowLayered = \(/)
  // 三维初始值层级与图鉴一致：2026-08-22 起两处都吃第一方 ship-stats 汇编包，
  // 且共用 fleet-calc 那一份（原先 qa 自己拼 kcwiki + wikiwiki 舰页两段，口径写了两份）
  assert.match(roster, /shipGrowthEndpointsOf\(ship\.shipId, 'evasion', ship\.kaihiMax\)/)
  assert.match(roster, /shipGrowthEndpointsOf\(ship\.shipId, 'asw', ship\.taisenMax\)/)
  assert.match(roster, /shipGrowthEndpointsOf\(ship\.shipId, 'los', ship\.sakutekiMax\)/)
  assert.match(roster, /instanceStatRows\(ship, mst, equips, init\)/)
  // 主数据未就绪不画半截条，退回文字药丸
  assert.match(roster, /if \(!mst\) \{/)
  // 图例三个新语义常驻：裸值 / 装备给予 / 可提升（余量沿用图鉴色语）
  assert.match(roster, /目前裸值/)
  assert.match(roster, /装备给予/)
  assert.match(roster, /改修余量/)
  // 装备给予绿与轨道底色收编为 token；qa 侧栏有整套条条样式
  assert.match(html, /--stat-equip: #/)
  assert.match(html, /--stat-track: #/)
  assert.match(html, /\.mod-qa \.track \.sg-equip \{ background: var\(--stat-equip\)/)
  assert.match(html, /\.mod-qa \.stat \{ display: grid/)
  // 三层语义的计算口径钉在 shared（含空槽用面板当一手裸值、缺初始值照实标缺）
  const layers = fs.readFileSync(new URL('../src/shared/ship-stat-layers.ts', import.meta.url), 'utf8')
  assert.match(layers, /面板即一手裸值/)
  assert.match(layers, /拆不出来/)
})

test('舰娘搜索认得舰级/舰种等门类，「白露级」不再一无所获', () => {
  // 用户 2026-08-11 报的缺口：图鉴搜「白露级」无匹配——kcwiki 译名是
  // 「白露型」、本地化级名才是「白露级」，原搜索只看名字/假名/中文名/图鉴No.。
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const roster = fs.readFileSync(new URL('../src/renderer/modules/qa.ts', import.meta.url), 'utf8')
  for (const [name, src] of [['ji', catalog], ['qa', roster]]) {
    // 级/型两种叫法互认（kcwiki 级别[0]=白露型，本地化级名=白露级）
    assert.match(src, /q\.endsWith\('级'\)/, `${name} 要认「级」后缀`)
    assert.match(src, /\$\{q\.slice\(0, -1\)\}型/, `${name} 要把「级」换成「型」再比对`)
    assert.match(src, /级别\?\.\[0\]/, `${name} 要拿 kcwiki 舰级译名比对`)
    // 单字查询不进门类字段——「雷」不该把整个雷巡舰种拖出来
    assert.match(src, /q\.length[^\n]*2/, `${name} 门类匹配要有最短长度门槛`)
  }
  // 图鉴侧独有门类：本地化级名、舰种起始匹配、国籍、声优/画师
  assert.match(catalog, /shipClassLabel\(root\.api_ctype\)/)
  assert.match(catalog, /searchFold\(name\)\.startsWith\(q\)/)
  assert.match(catalog, /shipNationalityById\(shipNationalityIdFromSortId\(root\.api_sort_id\)\)/)
  // 国籍要连别名一起比对：「苏联」在国籍表里只是「俄罗斯」的别名
  //（2026-08-11 用户实搜「苏联」无匹配抓出来的）
  assert.match(catalog, /\[nationality\.label, \.\.\.nationality\.aliases\]/)
  // 声优/画师检索:kcwiki 为主,停收形态回退 wikiwiki 舰页档案
  assert.match(catalog, /声优 \?\? profile\?\.cv \?\? ''/)
  assert.match(catalog, /画师 \?\? profile\?\.artist \?\? ''/)
  // 搜索框要把新门类写进占位符，不然功能等于没有
  assert.match(catalog, /placeholder="名字 \/ 假名 \/ 舰级 \/ 舰种 \/ 编队 \/ 声优 \/ 图鉴No\."/)
  assert.match(roster, /placeholder="名字 \/ 假名 \/ 舰级 \/ 舰种"/)
})

test('图鉴搜索折叠：全角斜线/重音差异不再把已收录装备判成「没收录」', async () => {
  // 2026-08-12 实锤：主数据里是「20.3cm/50 連装砲改(SHS改良弾)」（半角斜线）与
  // 「13.8cm単装砲 Modèle 1927」（è 带重音），用户搜「20.3cm／50」（全角）和
  // 「Modele」（无重音）都零结果——装备明明收录了。查询与候选两侧同折后必须命中。
  const { searchFold } = await import('../src/renderer/search-fold.ts')
  const gun203 = '20.3cm/50 連装砲改(SHS改良弾)'
  const gun138 = '13.8cm単装砲 Modèle 1927'
  assert.ok(searchFold(gun203).includes(searchFold('20.3cm／50')), '全角斜线要能命中半角名')
  assert.ok(searchFold(gun138).includes(searchFold('Modele 1927')), '无重音要能命中带重音名')
  assert.ok(searchFold('modele').includes(searchFold('Modèle')), '反方向：带重音查询也要命中无重音名')
  // 折叠只是比对口径：常规 CJK 原样保留，日文名照常命中
  assert.equal(searchFold('連装砲'), '連装砲')
  assert.ok(searchFold(gun203).includes(searchFold('SHS改良弾')))
  // 活动 wiki 原文把斜线写成「20.3cm / 50」（两侧带空格）：空格并入斜线后命中
  assert.equal(searchFold('20.3cm / 50 連装砲改'), searchFold('20.3cm/50 連装砲改'))
  // 与斜线无关的空格保留：不同词不许并成一个
  assert.notEqual(searchFold('単装砲 modele'), searchFold('単装砲modele'))
  // searchFoldMap 的位置映射：连字成链要从折叠命中位置落回原文区间
  const { searchFoldMap } = await import('../src/renderer/search-fold.ts')
  const line = '【選択:20.3cm / 50 連装砲改(SHS改良弾)★+3 x1】'
  const { folded, map } = searchFoldMap(line)
  const at = folded.indexOf(searchFold(gun203))
  assert.ok(at >= 0, '折叠后要能在奖励原文里找到主数据全名')
  assert.equal(line[map[at]], '2', '命中起点要落回原文的「2」')
  // 图鉴装备搜索点确实两侧同折，不是单侧 toLowerCase
  const ji = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  assert.match(ji, /const q = searchFold\(equipState\.search\)/)
  assert.match(ji, /searchFold\(e\.api_name\)\.includes\(q\)/)
})

test('任务自选奖励：识别数对不上声明数时按原文兜底，别名认得 kcwiki 意译变体', () => {
  // 用户抓的实锤（2026-08-11）：2605B3 游戏里第 1 组三选一（含新型砲熕兵装資材
  // ×4），面板只列出两项——kcwiki 文本叫「新型火炮兵装资材」，与 useitem 日文名
  // 对不上就被静默丢掉。全库扫描 644 任务发现 102 组对不齐，修完别名剩 23 组，
  // 全是装备保有位/家具/战果/舰船奖励/源文笔误这类本来就该按原文列出的。
  const quest = fs.readFileSync(new URL('../src/renderer/modules/qn.ts', import.meta.url), 'utf8')
  // 解析本体 2026-08-28 搬去 shared/quest-reward（可 import，行为级护栏在
  // test/quest-reward-choice.test.mjs）；这里的源码文本钉子跟着换指向
  const reward = fs.readFileSync(new URL('../src/shared/quest-reward.ts', import.meta.url), 'utf8')
  const upgrade = fs.readFileSync(new URL('../src/shared/kcwiki-upgrade.ts', import.meta.url), 'utf8')
  const match = fs.readFileSync(new URL('../src/renderer/task-entity-match.ts', import.meta.url), 'utf8')
  const html = rendererSource
  // 完备性口径：文本自带的「N选一」声明数；识别少了、或压根没自报，都按原文补 raw 项
  assert.match(reward, /const hanCount = \(han: string \| undefined\)/)
  assert.match(reward, /declared: hanCount\(hit\[1\]\)/)
  assert.match(reward, /declared === 0 \|\| declared > accepted\.length/)
  assert.match(reward, /kind: 'raw'/)
  // 「选一」的三种写法，选项在标记的哪一侧不一样（少认一种，那一族整段落进固定奖励）
  assert.match(reward, /以下奖励\(\[二三四五六七八九\]\)选一/)
  assert.match(reward, /从下列奖励中\(\?:选择\|选一\)/)
  assert.match(reward, /以上\(\[二三四五六七八九\]\)者\(\?:选择其一\|选一\)/)
  assert.match(reward, /before: before === true/)
  // raw 项不参与库存比较与推荐，样式压暗虚线边
  assert.match(quest, /candidate\.kind !== 'material' && candidate\.kind !== 'raw'/)
  // 2026-08-26 文案清扫缩短：「本地资料没认出」这句自证删了，「不参与库存比较」照钉
  assert.match(quest, /按任务原文显示，不参与库存比较/)
  assert.match(html, /\.mod-qn \.reward-stock\.raw \{ border-style: dashed/)
  // 已对齐的 kcwiki 简中别名表喂进奖励解析（道具与装备两边）
  assert.match(quest, /kcwikiItemAliasById\.get\(id\) \?\? \[\]/)
  assert.match(quest, /kcwikiEquipAliasById\.get\(equip\.id\)/)
  // 组内别名门槛统一 2 字：两字机名（彗星/天山）是合法奖励选项
  assert.match(reward, /aliases\.filter\(\(entry\) => entry\.length >= 2\)/)
  // 数量必须紧跟自家名字(2026-08-12 用户抓的实锤:Bq8「熟练见张员 熟练搭乘员
  // 洋上补给×4」前两项被标成 ×4——原先在名字后 24 字符窗口乱捞,会抢走相邻
  // 选项的数量;全库扫描 108 任务/131 组中招)。同物双名连写「日文名「中文名」×N」
  // 数量挂其中一处:所有出现位置里取带数量的那处,处处不带才是 ×1
  // 名字与 ×N 之间允许夹改修星级(2026-08-13 用户抓的实锤:F142「二式爆雷」★+4×1
  // 被拆成「二式爆雷×1」+ 乱码 raw 项「」★+4×1」,鱼雷那组 ×2 还错读成 ×1)
  // 逐字节钉那条正则太脆（2026-08-28 加星级截断时它就得跟着改一次），
  // 数量/星级读得对不对由行为级护栏钉着：test/quest-reward-choice.test.mjs
  //「数量只算自家的」一格，用的是 Bq8 / B143 / F142 三条原文
  assert.match(reward, /\(\?:\[★☆\]\(\?<starGap>\\s\*\\\+\?\\s\*\)\(\?<star>\\d\+\)\)\?/)
  assert.match(reward, /\(\?:×\|x\|\\\*\)\(\?<gap>\\s\*\)\(\?<amount>\\d\+\)/)
  assert.match(reward, /matches\.find\(\(match\) => match\.amount != null\) \?\? matches\[0\]/)
  assert.doesNotMatch(reward, /start \+ simple\.length \+ 24/)
  // 归一化抹空白会把「×6 25mm三连装机铳」黏成「×625mm…」——数量吞掉邻项开头的
  // 口径数字(B143 实锤 ×625 + 乱码残渣「mm三连装机铳」,2026-08-13)。
  // 两阶段解析:先收齐所有实体名起点,数量里圈进任何名字的开头就截断到那里
  assert.match(reward, /const nameStarts: number\[\] = \[\]/)
  assert.match(reward, /const trimDigits = \(digits: string, digitStart: number\)/)
  assert.match(reward, /那串数字属于人家的名字/)
  // 星级数字同样过截断：B161「…Mk.30改★+4」后面紧跟「22号对水上电探改四」，
  // 不截就读成 ★+422，跨度盖住那个 22，整条 22 号电探被挤出面板
  assert.match(reward, /trimDigits\(starRaw, starStart\)/)
  // 资源数量(燃料×300 之类)同样过截断
  assert.match(reward, /trimDigits\(rawDigits, hit\.index \+ hit\.full\.length - rawDigits\.length\)/)
  // kcQuests「燃料燃料×700」连写只算一项；useitem 31–34 是资源入口，不进自选组
  assert.match(reward, /matchMaterialRewardName\(normalized, name\)/)
  assert.match(quest, /if \(isResourceMirrorUseitem\(id\)\) continue/)
  // 星级要摆到面板上(玩家决策依据),匹配跨度盖住整段后缀避免掩码残渣
  assert.match(quest, /rw-star/)
  // 同物双名连写时落点取**第一处**：挪到后一处，前一处会被短名再抠出一项
  assert.match(reward, /length: matches\[0\]\.end - matches\[0\]\.start/)
  assert.match(html, /\.mod-qn \.reward-stock \.rw-star \{ color: var\(--gold\)/)
  // 变体别名与缺字修补不许回退（每一条都来自全库扫描 + master 核对）
  for (const key of ['间宫: 54', '伊良湖: 59', 'Ne式引擎: 71', '新型航空器设计图: 74']) {
    assert.ok(upgrade.includes(key), `KCWIKI_ITEM_ALIAS 缺 ${key}`)
  }
  for (const key of ["'桶(运输用)': 75", "'增设装甲(中型舰)': 72", "'增设装甲(大型舰)': 73"]) {
    assert.ok(upgrade.includes(key), `KCWIKI_EQUIP_ALIAS 缺 ${key}`)
  }
  for (const ch of ['単:', '見:', '宮:', '対:', '職:', '鬥:', '緊:', '圧:']) {
    assert.ok(match.includes(ch), `JP2CN 缺 ${ch}`)
  }
})

test('掉落抓取以主数据名表为权威，出击中的编队不再被「暂缓出击」裁决', async () => {
  // 掉落侧（用户 2026-08-11 在 1-5 捞到杉、目录没有）：kcwiki-ships 对新实装
  // 整批滞后，舰名解析必须主数据快照权威、kcwiki 兜底，解析不出显式失败。
  const intel = fs.readFileSync(new URL('../scripts/map-intel.mjs', import.meta.url), 'utf8')
  const fetcher = fs.readFileSync(new URL('../scripts/fetch-map-intel.mjs', import.meta.url), 'utf8')
  const refresher = fs.readFileSync(new URL('../scripts/refresh-map-intel-limited.mjs', import.meta.url), 'utf8')
  assert.match(intel, /export const loadMasterShipNames/)
  assert.match(intel, /shipMatcher = \(shipsPack, masterNames = \[\]\)/)
  assert.match(intel, /unmatchedNames/)
  assert.match(fetcher, /loadMasterShipNames\(root\)/)
  assert.match(refresher, /loadMasterShipNames\(root\)/)
  // 2026-08-22 批次 4 起 refresh-map-intel-limited 降级成对照报告工具，但这条口径不变：
  // 舰名解析不出 = 报告静默缺一条差异，看不出任何异常，所以必须当场抛。
  // 钉的是「有这个判断且它抛」，不钉持有它的变量叫什么。
  assert.match(refresher, /unmatchedNames\.length/)
  assert.match(
    refresher.slice(refresher.indexOf('unmatchedNames.length')),
    /throw new Error/,
    '上游舰名解析不出时没有当场失败',
  )
  // 海域详情给 kanlog 挂人工对照外链——无公开 API，不抓取、不存概率。
  // 「不展示概率」「仅作人工对照」两句随 2026-08-26 文案清扫裁定（族 4）撤下，
  // 折叠块只留「资料核对 X」与外链一行。护栏改钉**行为**，比钉措辞更硬：
  // 外链只是一个 target=_blank 的 <a>，仓库里不许出现任何抓 kanlog 的代码，
  // 也不许有掉率字段落进渲染层。用户明令「只许人肉浏览，禁 API 禁自动化抓取」。
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  assert.match(catalog, /kanlog\.info\/map\/[^"]*" target="_blank" rel="noreferrer"/)
  assert.doesNotMatch(catalog, /fetch\([^)]*kanlog|kanlog[^\n]*fetch\(/, 'kanlog 被代码抓了')
  for (const rel of ['../scripts/fetch-map-intel.mjs', '../scripts/map-intel.mjs']) {
    const src = fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
    assert.doesNotMatch(src, /kanlog/, `${rel} 去抓 kanlog 了`)
  }
  // 限定掉落带活动批次标签（用户 2026-08-11）：展示层印【…】，校验层认可缺省。
  // 展示那一半改成**跑一遍真函数**——钉源码字面量的守卫在函数换文件时会红在
  // 一个与意图无关的地方（2026-08-22 就红过一次），也拦不住写反的实现。
  const { limitedWindowText } = await import('../dist/shared/limited-window.js').then(
    (mod) => mod.default ?? mod,
  )
  assert.equal(
    limitedWindowText({ from: '2025-10-29', until: null, lastConfirmedAt: '2026-06-26', label: '節分' }),
    '【節分】2025/10/29–暂无截止日期',
  )
  assert.equal(
    limitedWindowText({ from: '2025-10-29', until: '2026-01-31', lastConfirmedAt: '2026-06-26' }),
    '2025/10/29–2026/01/31',
    '没有批次标签时不许印出空的【】',
  )
  const validation = fs.readFileSync(new URL('../src/main/lode-validation.ts', import.meta.url), 'utf8')
  assert.match(validation, /window\.label !== undefined/)
  // 编队侧（用户 2026-08-11）：出击中的舰队报「出击中 · 图号」而不是暂缓/禁止出击；
  // 大破仍要点名轰沉风险
  const fleet = fs.readFileSync(new URL('../src/renderer/modules/ru.ts', import.meta.url), 'utf8')
  const verdictAt = fleet.indexOf('const verdictHtml')
  const verdictBody = fleet.slice(verdictAt, fleet.indexOf('// ---- 联合舰队 ----', verdictAt))
  assert.match(verdictBody, /出击中 · \$\{sortie\.mapArea\}-\$\{sortie\.mapNo\}/)
  assert.match(verdictBody, /大破进击有被击沉风险/)
  const sortieAt = verdictBody.indexOf('if (onSortie && sortie)')
  assert.ok(sortieAt >= 0 && sortieAt < verdictBody.indexOf("class=\"verdict ok\""), '出击分支要先于就绪裁决')
  const html = rendererSource
  assert.match(html, /\.fleet-skin \.verdict\.sortie \{/)
})

test('装备类别图标无冒名文件：自称 title 与文件名一致，内容两两不同', () => {
  // 2026-08-11 用户抓出夜間瑞雲与夜偵同图：poi 上游对 48/49/51 发的就是
  // 37/44/50 的逐字节复制。本仓已换成同剪影换色的自制衍生图——这条护栏
  // 防止未来同步上游素材时把冒名复制再带回来。
  const dir = new URL('../src/renderer/assets/slotitem/', import.meta.url)
  const seen = new Map()
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.svg')) continue
    const id = name.replace('.svg', '')
    const content = fs.readFileSync(new URL(name, dir), 'utf8')
    const title = content.match(/<title>([^<]*)<\/title>/)?.[1]
    if (title !== undefined) {
      assert.equal(title, id, `${name} 自称 <title>${title}</title>——图不对号`)
    }
    assert.equal(seen.get(content), undefined, `${name} 与 ${seen.get(content)} 内容逐字节相同（冒名复制）`)
    seen.set(content, name)
  }
})

test('装备类别图标优先游戏图集，陆航归属按大分類逐件判定', () => {
  // 用户 2026-08-11：poi 剪影与游戏原版形状不符（水上机原版带浮筒），且
  // Ho229（噴式戦闘爆撃機）被归在舰载机。主数据裁决：噴式各类别没有任何
  // 舰种能装（橘花改上舰走逐舰例外表），类别归属应是基地航空队向。
  const icon = fs.readFileSync(new URL('../src/renderer/equip-icon.ts', import.meta.url), 'utf8')
  const images = fs.readFileSync(new URL('../src/renderer/kcs-image.ts', import.meta.url), 'utf8')
  const category = fs.readFileSync(new URL('../src/renderer/equip-category.ts', import.meta.url), 'utf8')
  const html = rendererSource
  // 图集：游戏一手图形经 provider 注入；独立小窗没接线时仍是 SVG → 文字
  assert.match(icon, /setEquipIconSpriteProvider/)
  assert.match(icon, /class="equip-icon-game"/)
  assert.match(images, /\/kcs2\/img\/common\/common_icon_weapon\.json/)
  assert.match(images, /setEquipIconSpriteProvider\(slotIconSpriteStyle\)/)
  // 百分比定位：与渲染尺寸无关，xs/sm/lg 同一份样式都对
  assert.match(images, /background-size:\$\{\(slotIconSheet\.w \/ frame\.w\) \* 100\}%/)
  assert.match(html, /\.equip-icon \.equip-icon-game \{/)
  // 陆航判定按**大分類逐件**（用户 2026-08-11 两轮纠正：Ho229 是陆航 ≠ 橘花也是；
  // 我第一版把整族喷式一刀切进陆航，把能上舰的橘花错杀了）：
  // api_type[0]=21/22/25/26 是游戏一手的陆上机系口径——Ho229(21) 去陆航，
  // 橘花改/喷式景云改(3) 留在舰载机（56-59 整类对翔鹤改二甲等五舰开放）。
  assert.match(category, /舰载机: \[6, 7, 8, 9, 25, 26, 56, 57, 58, 59, 91, 94\]/)
  assert.match(category, /陆航: \[47, 48, 49, 53\]/)
  assert.match(category, /LAND_ONLY_T0 = new Set\(\[21, 22, 25, 26\]\)/)
  assert.match(category, /AVIATION_TYPES\.has\(type2\) && LAND_ONLY_T0\.has\(type0\)/)
  // 调用点必须把 api_type\[0\] 传进来，否则逐件例外是死代码
  const catalogSrc = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const stock = fs.readFileSync(new URL('../src/renderer/modules/equip-stock.ts', import.meta.url), 'utf8')
  assert.match(catalogSrc, /equipChipMatches\(equipState\.chip, cat, t0\)/)
  assert.match(stock, /equipChipMatches\(state\.chip, r\.type2, r\.type0\)/)
  // 主数据事实钉死：Ho229 大分類 21（陆上机系）、橘花改大分類 3（舰上机系）
  const s2Url = new URL('../../s2.json', import.meta.url)
  if (fs.existsSync(s2Url)) {
    const api = (() => { const raw = JSON.parse(fs.readFileSync(s2Url, 'utf8')); return raw.api_data ?? raw })()
    const ho229 = api.api_mst_slotitem.find((e) => e.api_id === 561)
    const kikka = api.api_mst_slotitem.find((e) => e.api_id === 200)
    assert.equal(ho229?.api_type?.[0], 21)
    assert.equal(kikka?.api_type?.[0], 3)
  }
})

test('装备页校准:局戦対爆迎撃换标、陆航半径/配置消耗、废弃返还与図鑑説明上屏', () => {
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  // 局地戦闘機/陸軍戦闘機(type2=48)的 houm/houk 一手语义是対爆/迎撃——
  // 抽屉(equipStatChips)与列表速览两处渲染都要走这条换标分支。
  //
  // 旧钉是「这三段文本各出现 2 次」：它把「两处各写一遍」本身当成了纪律，
  // 于是真收敛成一份时护栏反而失守（源码里甚至留了注释说不许收）。
  // 原意「两条渲染路径都按対爆/迎撃标」照钉，改成语义等价的写法：
  // 换标只有一份实现，两条路径都从它取值。
  assert.equal((catalog.match(/api_type\[2\] === 48/g) ?? []).length, 1, '换标判定只许有一份')
  assert.equal((catalog.match(/'api_houm' \? '对爆'/g) ?? []).length, 1)
  assert.equal((catalog.match(/'api_houk' \? '迎击'/g) ?? []).length, 1)
  assert.match(catalog, /const equipStatValues = \(e: any\): \{ label: string; value: number \}\[\]/)
  assert.equal(
    (catalog.match(/equipStatValues\(e\)\.map\(\(\{ label: shown, value \}\)/g) ?? []).length,
    2,
    '抽屉 chip 与列表速览两条渲染路径都要经过同一个口径函数',
  )
  // 两处的 markup 与文案仍各是各的（chip 带 class 且标签后有空格，速览不带）
  assert.match(catalog, /<span class="misc-stat">\$\{shown\} <b style="color:\$\{value > 0 \? 'var\(--ok\)' : 'var\(--bad\)'\}">/)
  assert.match(catalog, /return `\$\{shown\}<b style="color:\$\{value > 0 \? 'var\(--ok\)' : 'var\(--bad\)'\}">/)
  // 一手字段补上屏:行动半径 api_distance / 配置消耗 api_cost / 废弃返还 api_broken
  assert.match(catalog, /行动半径 <b>\$\{e\.api_distance\}/)
  assert.match(catalog, /铝\$\{e\.api_cost\}\/机/)
  assert.match(catalog, /废弃返还 <b>燃\$\{e\.api_broken\[0\]\}/)
  // 図鑑説明:主数据快照没有 api_info,akashi-list 的 item_intro 照录并署源
  assert.match(catalog, /item_intro/)
  assert.match(catalog, /図鑑説明/)
  // 主数据事实钉死:雷電(175) type2=48 且 houm/houk 非零(対爆5/迎撃2);
  // 一式陸攻(169) 半径9/配置12——这两组数字换了,说明字段语义动了,先查再改
  const s2Url = new URL('../../s2.json', import.meta.url)
  if (fs.existsSync(s2Url)) {
    const api = (() => { const raw = JSON.parse(fs.readFileSync(s2Url, 'utf8')); return raw.api_data ?? raw })()
    const raiden = api.api_mst_slotitem.find((e) => e.api_id === 175)
    assert.equal(raiden?.api_type?.[2], 48)
    assert.equal(raiden?.api_houm, 5)
    assert.equal(raiden?.api_houk, 2)
    const rikko = api.api_mst_slotitem.find((e) => e.api_id === 169)
    assert.equal(rikko?.api_distance, 9)
    assert.equal(rikko?.api_cost, 12)
  }
})

test('改修域单基准 = wikiwiki 改修表(2026-08-11 对账换源,EO 同构包)', () => {
  const sources = JSON.parse(fs.readFileSync(new URL('../scripts/lode-sources.json', import.meta.url), 'utf8'))
  const upgrades = sources.find((s) => s.id === 'equip-upgrades')
  assert.match(upgrades.source, /wikiwiki/)
  assert.equal(upgrades.parser, 'wikiwiki-kaishu')
  assert.equal(upgrades.format, 'text')
  // 消费端沿用 EO 形状:今日改修的 -1 哨兵语义靠 >0 过滤落进「无需指定二号舰」
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  assert.match(catalog, /ship_ids\.map\(Number\)\.filter\(\(id: number\) => id > 0\)/)
  assert.match(catalog, /无需指定二号舰/)
})

test('深海装备射程按档位翻译,含深海独有的第 5 档超超长', () => {
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  // 射程是档位不是数值:深海抽屉必须走 LENG_LABEL,第 5 档游戏写作「超長+」
  assert.match(catalog, /'无', '短', '中', '长', '超长', '超长\+'/)
  assert.match(catalog, /k === 'api_leng' \? LENG_LABEL\[e\[k\]\]/)
  // 主数据事实钉死:第 5 档两侧都存在——玩家侧 Ho229(561),深海侧 深海空超要塞(1630)。
  // 旧表只到 4 时 Ho229 的射程显示成「—」,这条护栏防再截短
  const s2Url = new URL('../../s2.json', import.meta.url)
  if (fs.existsSync(s2Url)) {
    const api = (() => { const raw = JSON.parse(fs.readFileSync(s2Url, 'utf8')); return raw.api_data ?? raw })()
    assert.equal(api.api_mst_slotitem.find((e) => e.api_id === 1630)?.api_leng, 5)
    assert.equal(api.api_mst_slotitem.find((e) => e.api_id === 561)?.api_leng, 5)
    const maxLeng = Math.max(...api.api_mst_slotitem.map((e) => e.api_leng ?? 0))
    assert.ok(maxLeng <= 5, `出现了第 ${maxLeng} 档射程,LENG_LABEL 要跟着扩`)
  }
})

test('深海舰抽屉:射程/对空CI/雷击命中上屏,航速0=陆上型,cvnb 拿不准不上屏', () => {
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  // 射程药丸走 LENG_LABEL;航速 0 按游戏对地判定(soku===0)标「陆上」
  assert.match(catalog, /射程 <b>\$\{LENG_LABEL\[leng\]/)
  assert.match(catalog, /s\.api_soku >= 5 \? '低速' : '陆上'/)
  // kc3_tacc 语义已核实(KC3 模拟器文档 torpedo accuracy)→ 雷击命中*;
  // kc3_cvnb 查无定义 → 不出现在展示表里
  assert.match(catalog, /\['kc3_tacc', '雷击命中\*'\]/)
  assert.doesNotMatch(catalog, /\['kc3_cvnb'/)
  assert.match(catalog, /对空CI <b>第\$\{aaci\}种/)
  // 真包锚定:防空棲姫(1628) kc3_aaci=5;飛行場姫(1556) 航速 0(陆上型)
  const packUrl = new URL('../assets/lodes/abyssal-stats.json', import.meta.url)
  const s2Url = new URL('../../s2.json', import.meta.url)
  if (fs.existsSync(packUrl) && fs.existsSync(s2Url)) {
    const pack = JSON.parse(fs.readFileSync(packUrl, 'utf8')).data
    assert.equal(pack['1628']?.kc3_aaci, 5)
    const api = (() => { const raw = JSON.parse(fs.readFileSync(s2Url, 'utf8')); return raw.api_data ?? raw })()
    assert.equal(api.api_mst_ship.find((s) => s.api_id === 1556)?.api_soku, 0)
  }
})

test('舰娘档案补缺:kcwiki 停收形态回退 wikiwiki 舰页(hero/装备槽/初期携带/搜索)', () => {
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const roster = fs.readFileSync(new URL('../src/renderer/modules/qa.ts', import.meta.url), 'utf8')
  // hero 行与装备槽:kcwiki 无条目时读 shipProfileByMst
  // （2026-08-20 第二批文案清扫：界面上的来源署名撤了,回退本身与「资料缺了」
  //   的坦白话术必须还在——缺资料不硬造是另一条纪律）
  assert.match(catalog, /shipProfileByMst\.get\(shipState\.selectedForm\)/)
  assert.match(catalog, /const profileSlots = shipProfileByMst\.get\(shipState\.selectedForm\)\?\.initialEquips/)
  // 2026-08-26 文案清扫按裁决书缩成「社区资料未收录这一形态」，语义不变
  assert.match(catalog, /社区资料未收录这一形态/)
  // 舰娘初期携带反查:kcwiki 行与档案补缺行并列进 initialEquipShips
  assert.match(catalog, /\.\.\.\[\.\.\.shipProfileByMst\.values\(\)\]/)
  // 列表侧:舰级搜索与预览行同样回退
  assert.match(roster, /shipProfileByMst\.get\(r\.ship\.shipId\)\?\.shipClass/)
  assert.match(roster, /queryLode\('wikiwiki-ship-profile'\)/)
})

test('任务奖励关联不兴字节命中:更长实体名自动挖掉再判(秋水 vs 試製 秋水)', () => {
  const quests = fs.readFileSync(new URL('../src/renderer/modules/qn.ts', import.meta.url), 'utf8')
  // 自动 overshadow:装备+道具全名册里包含查询名的更长名字,先挖再判;
  // 挖掉用哨兵符占位,不能用空串(拼接残片会凭空造出新命中)
  assert.match(quests, /name !== t && name\.length > t\.length && name\.includes\(t\)/)
  assert.match(quests, /join\('\\u0000'\)/)
  assert.match(quests, /invalidateAwardMask\(\)/)
  // 实锤事实钉死:B153(925) 的奖励是「試製 秋水」(351),与 秋水(352) 是两件装备。
  // 2026-08-21 quests-scn 换源到 zh.kcwiki 直取之后,奖励文本里的装备名改用
  // kcwiki 装备模块的中文名(旧的 kcdata 名大量留着日文原文),这条写成「试制 秋水」
  // ——**遮蔽风险一字不改地照旧存在**(长名含短名),钉的还是同一件事。
  const scnUrl = new URL('../assets/lodes/quests-scn.json', import.meta.url)
  const s2Url = new URL('../../s2.json', import.meta.url)
  if (fs.existsSync(scnUrl) && fs.existsSync(s2Url)) {
    const scn = JSON.parse(fs.readFileSync(scnUrl, 'utf8')).data
    assert.match(`${scn['925']?.memo}`, /试制 秋水/)
    const api = (() => { const raw = JSON.parse(fs.readFileSync(s2Url, 'utf8')); return raw.api_data ?? raw })()
    assert.equal(api.api_mst_slotitem.find((e) => e.api_id === 351)?.api_name, '試製 秋水')
    assert.equal(api.api_mst_slotitem.find((e) => e.api_id === 352)?.api_name, '秋水')
  }
  // 角色奖励同款保护(2026-08-12 用户抓的实锤:F138 奖励「震电改二(舰战型改二)」
  // 是装备,舰娘索引里 電 的改造链别名「电改」咬中其中两字,凭空多出「電 ×1」)
  // ——舰娘匹配前先用装备名占坑,被覆盖的命中一律不算
  assert.match(quests, /const equipRanges = taskEntityAliasRanges\(equipNameIndex, text, 3\)\s*\n\s*return excludeTaskHitsCoveredByAliases\(\s*\n\s*matchTaskEntityHits\(shipNameIndex, text, 2, \{ allowQuotedSingle: true, limit: 8 \}\),/)
  // 「相关内容」的涉及舰娘是另一条路径,同病灶第二回(2026-08-13 用户实锤:
  // F46 正文「紫电改二」让涉及舰娘冒出「电」)——装备命中先算,舰娘不得进其地盘
  assert.match(quests, /!equipHits\.some\(\(equipHit\) => rangesOverlap\(candidate, equipHit\)\)/)
  const equipHitsAt = quests.indexOf('const equipHits = matchTaskEntityHits(equipNameIndex, text, 3)')
  const shipsAt = quests.indexOf('const ships = matchTaskEntityHits(shipNameIndex, text, 2,')
  assert.ok(equipHitsAt >= 0 && shipsAt >= 0 && equipHitsAt < shipsAt, '装备命中必须先于舰娘匹配算出')
})



test('慢操作哨兵:分发计时归因 + 主进程网络事件计时 + 渲染挂死看门狗', () => {
  // 2026-08-13 用户报 5-5 进战斗分三段卡死,crash.log 一个字都没有——
  // 卡顿不抛异常,必须有自己的日志。三层覆盖:渲染分发慢(前两段卡)、
  // 主进程网络处理慢(游戏加载顿)、渲染进程挂死(第三段卡死,事后无法上报,
  // 靠挂死前最后一条面包屑定位凶手)。
  const kernel = fs.readFileSync(new URL('../src/renderer/kernel.ts', import.meta.url), 'utf8')
  const guard = fs.readFileSync(new URL('../src/renderer/perf-guard.ts', import.meta.url), 'utf8')
  const perfLog = fs.readFileSync(new URL('../src/main/perf-log.ts', import.meta.url), 'utf8')
  const crashLog = fs.readFileSync(new URL('../src/main/crash-log.ts', import.meta.url), 'utf8')
  const mgIndex = fs.readFileSync(new URL('../src/main/mg/index.ts', import.meta.url), 'utf8')
  const mainIndex = fs.readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
  // 内核两个分发点都走计时版;注册时捕获调用点做归因(监听器全是匿名箭头)
  assert.match(kernel, /timedEach\('kernel:patch', patchListeners, siteOf, \(cb\) => cb\(keys\)\)/)
  assert.match(kernel, /timedEach\('kernel:tick', tickListeners, siteOf, \(cb\) => cb\(\)\)/)
  assert.match(kernel, /listenerSites\.set\(cb, captureListenerSite\(\)\)/)
  // 每个监听器开跑前先报面包屑——挂死时这就是看门狗要写的凶手
  assert.match(guard, /kanso:perf-breadcrumb/)
  assert.match(guard, /SLOW_DISPATCH_MS = 80/)
  // ping 必须由主进程发起:页面隐藏时渲染层定时器被节流,自报心跳会误报挂死
  assert.match(guard, /ipcRenderer\.on\('kanso:perf-ping'/)
  assert.match(perfLog, /win\.webContents\.send\('kanso:perf-ping'\)/)
  assert.match(perfLog, /最后开跑未完成的监听器/)
  // 滚动限流与 crash.log 共用一份纪律(体积截半 + 同类限流)
  assert.match(crashLog, /export const createRollingLog = /)
  assert.match(perfLog, /createRollingLog\(path\.join\(APPDATA_PATH, 'perf\.log'\)/)
  // 主进程网络事件分段计时:主进程慢一拍,游戏加载就顿一拍
  assert.match(mgIndex, /解析 .*记账 .*归约 /)
  assert.match(mainIndex, /installPerfLogging\(\(\) => mainWindow\)/)
})

test('游戏自报粗档只在同一任务周期内当下限,隔周期的旧 flag 不垫账', () => {
  // 2026-08-12 用户实锤:Bd6 日任被「下限校正 ≥4/5」盖住正常运作的本地计数——
  // questlist 快照停在上个周期(日任隔天最常见)时,里面的 ≥50%/≥80% 说的是
  // 上一轮进度,游戏重置后证明不了本轮任何事,不能拿来垫清零重开的计数器。
  const counter = fs.readFileSync(new URL('../src/main/mg/quest-counter.ts', import.meta.url), 'utf8')
  assert.match(counter, /const flagFresh = questsTs != null && sameQuestPeriod\(t, questsTs, now\)/)
  assert.match(counter, /if \(flagFresh && \(flag === 1 \|\| flag === 2\) && t\.tasks\.length\)/)
})

test('出击面板战型名看 api_event_kind:夜战点不写「通常战」,昼战模型不硬套', () => {
  const battle = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  // 战型细分表:2 夜战 / 3 拂晓战 / 4 航空战 / 5 敌联合 / 6 长距离空袭 / 8 雷达射击。
  // 账本实锤对照(用户真实战斗):ekind1↔昼战(6-5 B/F/I)、ekind5↔ec_battle、ekind6↔ld_airbattle
  assert.match(battle, /NODE_BATTLE_KIND: Record<number, string> = \{\s*2: '夜战',/)
  assert.match(battle, /6: '长距离空袭',/)
  assert.match(battle, /8: '长距离雷达射击',/)
  // 到点展示全走 nodeEventName:banner / 航迹条 tooltip / 节点摘要
  assert.match(battle, /const eventName = node \? nodeEventName\(node\) : '—'/)
  assert.match(battle, /const title = `\$\{nodeEventName\(n\)\}/)
  assert.match(battle, /nodeEventName\(n\) : \(NODE_EVENT\[n\.eventId\] \?\? ''\)/)
  // 机制估算是昼战流程模型:夜战/航空战/空袭/雷达点明说不出数,不给误导性胜率;
  // 敌联合(kind 5)走模型自己的主力/护卫分段,不拦
  assert.match(battle, /暂无机制估算 · 当前点为/)
  assert.match(battle, /arrivedNode\.eventKind !== 5/)
  assert.match(battle, /NODE_BATTLE_KIND\[arrivedNode\.eventKind\] \?\? null/)
})

test('多子项任务进度条分段画:条与「N/M 项」同口径,tooltip 逐项报数', () => {
  const quests = fs.readFileSync(new URL('../src/renderer/modules/qn.ts', import.meta.url), 'utf8')
  // あ号这类多子项任务:整条画「平均完成率」时 90% 的条配「2/4 项」像自相矛盾。
  // 条按子项分段,各段填自己的完成率,填满的段换金色(与文字数的是同一批段)
  assert.match(quests, /pb seg/)
  assert.match(quests, /part\.ratio >= 1 \? ' class="ok"' : ''/)
  // tooltip 逐项报数,标签剥掉 HTML 只留纯文本——剥法收在 qpTaskLabelText 一处,
  // 列表行里顶掉正文的那一行也吃它,两处不各剥一遍
  assert.match(quests, /const qpTaskLabelText = \([\s\S]{0,200}?\.replace\(\/<\[\^>\]\*>\/g, ''\)/)
  assert.match(quests, /label: entries\.map\(\(\{ task \}\) => qpTaskLabelText\(task\)\)/)
  assert.match(quests, /\$\{part\.label\} \$\{part\.now\}\/\$\{part\.cap\}/)
  // 单子项任务的整条画法不变
  assert.match(quests, /<span class="pb"><i style="width:\$\{Math\.max\(3, precise\.pct\)\}%">/)
  const html = rendererSource
  assert.match(html, /\.pb\.seg b\.ok i/)
})

test('任务行的条件行顶掉正文:两半都与抽屉同源,不另占一行,不重复进度数字', () => {
  const quests = fs.readFileSync(new URL('../src/renderer/modules/qn.ts', import.meta.url), 'utf8')
  const body = quests.slice(quests.indexOf('const qpNeedHtml'), quests.indexOf('const qpStockCurrent'))
  assert.ok(body.length > 200 && body.length < 4000, 'qpNeedHtml 的位置变了,下面的断言就不作数了')
  // 没有任何判定资料的任务:行完全保持现状(正文照旧)
  assert.match(body, /if \(!tracker\) return ''/)
  assert.match(body, /if \(!items\.length\) return ''/)
  // 行动需求取详情抽屉计数器的同一处,不另立一份文案
  assert.match(body, /qpTaskLabelText\(task, \{ bare: true \}\)/)
  // 这行只说「要什么」:当前进度归进度条,不在这里再报一遍
  assert.doesNotMatch(body, /progress|serverFloors/)
  // 搜索每敲一键都会重渲:缓存按 tracker 身份 + 实体索引代号,别把它做成每键击重算
  assert.match(body, /cached\.tracker === tracker && cached\.version === entityIndexVersion/)
  // **替换**而不是追加:有条件行就不再渲正文那一段,两者共用 .plain 这一个位置。
  // 替换那一侧压着两道闸:类别白名单(白名单外一律回落到正文,行为判据见下一条守卫)
  // 与 partial(追踪器自报另有准备资源等非计数条件的,零头不许盖全单——D21 那种
  // 「准备 5000 钢材」写在正文里)。开头那个 `(` 必须贴着 PROSE_：写成
  // `(!PROSE_….has(…)` 闸就反了(白名单外的反倒替换),而少了这个字符的正则照样
  // 能在反了的那份代码里匹配上;partial 前面的 `!` 同理。
  assert.match(
    quests,
    /\(PROSE_REPLACING_CATEGORIES\.has\(category\.key\) && !qp\?\.trackers\[row\.id\]\?\.partial\s*\? qpNeedHtml\(row\)\s*: ''\)\s*\|\|\s*`<span class="plain">\$\{taskProseHtml\(/,
  )
  assert.match(body, /<span class="plain q-need"/)
  // 官方介绍在详情抽屉照旧全文可见
  assert.match(quests, /row\.desc \? `<p>\$\{taskProseHtml\(row\.desc, row\.code\)\}<\/p>`/)
  const html = rendererSource
  // 只改字色,行高与省略照 .plain 那一份走(不许自带 margin/行高把行撑高)
  assert.match(html, /\.mod-qn \.q-nm \.plain\.q-need \{ color: [^}]*\}/)
  assert.doesNotMatch(html, /\.q-need[^{]*\{[^}]*(margin|line-height|font-size)/)
  // 它是正文信息不是筛选表头,紧凑态不许砍掉;窄态跟着 .plain 的既有规则走
  assert.doesNotMatch(html, /\.q-need[^{]*\{[^}]*display:\s*none/)
})

// 编成门的标签语拿真结构跑一遍——判据落在**行为**上,不是源码里有没有某段文本。
// （qn.ts 载不进 node --test：它 import 渲染层一整摞。照 eo-senka-reported 的既例
//   把这一个纯函数原样取出来编译执行，测的是线上那份代码本身。）
test('编成门标签语:词取 group.label,形态只补旗舰/位次/等级/数量,上限组不进这一行', async () => {
  const { buildSync } = await import('esbuild')
  const source = fs.readFileSync(new URL('../src/renderer/modules/qn.ts', import.meta.url), 'utf8')
  const from = source.indexOf('const qpFleetNeedItems')
  const to = source.indexOf('\n\n', from)
  assert.ok(from >= 0 && to > from, 'qn.ts 里找不到 qpFleetNeedItems,这条守卫的锚点要跟着改')
  const js = buildSync({
    stdin: { contents: source.slice(from, to), loader: 'ts' },
    write: false,
    format: 'cjs',
  }).outputFiles[0].text
  const fleetItems = new Function(
    'esc',
    `${js.replace(/^"use strict";?/, '')}\nreturn qpFleetNeedItems`,
  )((s) => `${s ?? ''}`.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`))

  // 数量 1 不标 ×1;>1 才标。旗舰是前缀,不是另起一项
  assert.deepEqual(
    fleetItems({ groups: [
      { label: '軽巡', ships: [], stypes: [3], amount: 1, flagship: true },
      { label: '駆逐', ships: [], stypes: [2], amount: 3 },
    ] }),
    ['旗舰 軽巡', '駆逐 ×3'],
  )
  // 「限第 N 舰队」进这一行:漏掉它玩家会把队编在别处白打一场
  assert.deepEqual(
    fleetItems({ groups: [{ label: '空母', ships: [], stypes: [7], amount: 1 }], fleetId: 2 }),
    ['第2舰队', '空母'],
  )
  // 组一个都没有时,「第2舰队」不许单独成行(215/872 这两条就是空 groups + fleetId)
  assert.deepEqual(fleetItems({ groups: [], fleetId: 2 }), [])
  // amount=0 的组是「至多 N 艘」的上限,不是要凑的东西 → 不进这一行(190 的駆逐≤1)
  assert.deepEqual(
    fleetItems({ groups: [
      { label: '若葉改', ships: [240], stypes: [], amount: 1 },
      { label: '駆逐', ships: [], stypes: [2], amount: 0, maxAmount: 1 },
    ] }),
    ['若葉改'],
  )
  // 位次与等级门(182/859 的伊勢日向 1・2 号位 Lv50)
  assert.deepEqual(
    fleetItems({ groups: [
      { label: '伊勢改 / 日向改', ships: [82, 88], stypes: [], amount: 1, flagship: true, lv: 50 },
      { label: '伊勢改 / 日向改', ships: [82, 88], stypes: [], amount: 1, position: 2, lv: 50 },
    ] }),
    ['旗舰 伊勢改 / 日向改 Lv50↑', '2号位 伊勢改 / 日向改 Lv50↑'],
  )
  // label 是规则包原文,既进 HTML 又进 title 属性 → 必须转义
  assert.deepEqual(
    fleetItems({ groups: [{ label: 'Saratoga "Mk.II"', ships: [], stypes: [], amount: 1 }] }),
    ['Saratoga &#34;Mk.II&#34;'],
  )
})

// 顶掉正文的类别闸。判据落在**行为**上：把线上那份 categoryOf（连同它依赖的
// CAT_META/catOf/questText/TASK_CATEGORIES）原样取出来编译执行，喂**任务库真数据**，
// 看每一条落在白名单里还是外面。
//
// 钉的是 2026-09-01 用户当场抓到的信息丢失：F125 的真实要求有五项（黎塞留旗舰、
// 一二格 38cm四连装炮改 ×2、废弃 41cm连装炮 ×4、开发资材 ×20、海外舰最新技术 ×1），
// 追踪器只解出可计数的「废弃 41cm连装炮 ×4」一项；工厂族的正文本身就是需求清单，
// 顶掉它 = 把另外四项抹掉。所以 **E/F/G 码族一条都不许进白名单**。
test('条件行顶掉正文的类别闸:只放出击/演习/远征/编成,工厂族与判不出类别的一律留正文', async () => {
  const { buildSync } = await import('esbuild')
  const source = fs.readFileSync(new URL('../src/renderer/modules/qn.ts', import.meta.url), 'utf8')
  const entity = fs.readFileSync(new URL('../src/renderer/task-entity-match.ts', import.meta.url), 'utf8')
  const slice = (text, from, to, what) => {
    const at = text.indexOf(from)
    const end = text.indexOf(to, at + 1)
    assert.ok(at >= 0 && end > at, `找不到 ${what}，这条守卫的锚点要跟着改`)
    return text.slice(at, end)
  }
  const contents = [
    // 真的那张日→中归并表与 simplifyJp：questText 拿它归一化任务正文。
    // 去掉 export：混着 ESM 语法的话下面那句 module.exports 就写不出去了
    slice(entity, 'export const JP2CN', 'export const normalizeTaskEntityText', 'JP2CN/simplifyTaskEntityText')
      .replace(/^export /gm, ''),
    'const simplifyJp = simplifyTaskEntityText',
    slice(source, 'const CAT_META', 'const periodOf', 'CAT_META/catOf/catColor'),
    slice(source, 'const questTextCache', 'const TASK_CATEGORIES', 'questText'),
    slice(source, 'const TASK_CATEGORIES', 'const FACTORY_CATEGORY_KEYS', 'TASK_CATEGORIES'),
    slice(source, 'const categoryOf', '// 「即将重置」的时限', 'categoryOf/PROSE_REPLACING_CATEGORIES'),
    'module.exports = { catOf, categoryOf, PROSE_REPLACING_CATEGORIES }',
  ].join('\n\n')
  const js = buildSync({ stdin: { contents, loader: 'ts' }, write: false, format: 'cjs' }).outputFiles[0].text
  const shim = { exports: {} }
  new Function('module', 'exports', js)(shim, shim.exports)
  const { catOf, categoryOf, PROSE_REPLACING_CATEGORIES } = shim.exports

  const library = JSON.parse(
    fs.readFileSync(new URL('../assets/lodes/quests-scn.json', import.meta.url), 'utf8'),
  ).data
  const rows = Object.entries(library).map(([id, entry]) => ({ ...entry, id: Number(id) }))
  const byCode = new Map(rows.map((row) => [row.code, row]))
  const verdict = (code) => {
    const row = byCode.get(code)
    assert.ok(row, `任务库里没有 ${code}，这条守卫的数据前提变了`)
    const category = categoryOf(row)
    return { key: category.key, label: category.label, replaces: PROSE_REPLACING_CATEGORIES.has(category.key) }
  }

  // —— 本次 bug 的两条实例：正文里的要求远多于追踪器解得出的那一项 ——
  const f125 = byCode.get('F125')
  assert.ok(
    /开发资材/.test(f125.desc) && /海外舰最新技术/.test(f125.desc) && /黎塞留/.test(f125.desc),
    'F125 的正文不再写着那几项要求，这条守卫的前提要重新对一遍',
  )
  assert.deepEqual(verdict('F125'), { key: 'develop', label: '开发', replaces: false })
  const f128 = byCode.get('F128')
  assert.ok(
    /★\+8|★8|★\+８/.test(f128.desc + f128.memo2) && /钢材/.test(f128.desc),
    'F128 的正文不再写着装备位与钢材要求，这条守卫的前提要重新对一遍',
  )
  assert.deepEqual(verdict('F128'), { key: 'scrap', label: '废弃', replaces: false })

  // —— 白名单里的四类照旧替换（出击/演习/远征/编成各钉一条真任务）——
  assert.deepEqual(verdict('B18'), { key: 'sortie', label: '出击', replaces: true })
  assert.deepEqual(verdict('A12'), { key: 'formation', label: '编成', replaces: true })
  assert.deepEqual(verdict('C1'), { key: 'exercise', label: '演习', replaces: true })
  assert.deepEqual(verdict('D1'), { key: 'expedition', label: '远征', replaces: true })

  // —— 穷举：E/F/G 码族（补给/入渠/建造/开发/废弃/改修/改造）一条都不许进白名单 ——
  const factoryLeaks = rows
    .filter((row) => ['E', 'F', 'G'].includes(catOf(row.code)))
    .filter((row) => PROSE_REPLACING_CATEGORIES.has(categoryOf(row).key))
    .map((row) => `${row.code}→${categoryOf(row).label}`)
  assert.deepEqual(factoryLeaks, [], '工厂族任务的正文是完整需求清单，一条都不能被条件行顶掉')

  // —— 判不出类别的默认不替换：游戏里冒出任务库还没收的新任务时 code 是 '?' ——
  const unknown = { id: -1, code: '?', name: '未知任务', desc: '', memo: '', memo2: '' }
  assert.equal(PROSE_REPLACING_CATEGORIES.has(categoryOf(unknown).key), false)
  // 这是白名单不是黑名单：随手加一类也默认在外面，别写成「排除工厂族」
  assert.equal(PROSE_REPLACING_CATEGORIES.has('limited'), false)
  assert.equal(PROSE_REPLACING_CATEGORIES.size, 4)
})

test('夜间触接挂战斗流水行:与照明弹同口径,只报发动方不量化加成', () => {
  const battle = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  // 状态条芯片保留,另挂流水行(芯片太小且进击换点后被顶掉,实测用户漏看)
  assert.match(battle, /b\.nightContact && \(b\.nightContact\[0\] > 0 \|\| b\.nightContact\[1\] > 0\)/)
  assert.match(battle, /<span class="ph night">夜间触接<\/span>/)
  // 排在照明弹行前(同 stage 内 action -4 < -3),两行共用夜战段定位
  assert.match(battle, /action: -4,/)
  assert.match(battle, /action: -3,/)
  // 芯片版仍在(战斗状态条)
  assert.match(battle, /夜间触接 <b>\$\{esc\(nightContacts\)\}<\/b>/)
})

test('受伤语音弹幕按台词槽位定色:小破台词不再被整场结算血量涂成大破红', () => {
  const voice = fs.readFileSync(new URL('../src/renderer/voice-subtitle.ts', import.meta.url), 'utf8')
  // wikiwiki 语音表 300+ 舰无一例外:19=小破,20=小破②/旗艦大破同轨,21=中破/大破。
  // 实测 2026-08-12:伊势 59→12/78,小破台词在动画中途播出被 hpEnd 涂成红色。
  assert.match(voice, /if \(voiceId === 19\) return 'light'/)
  assert.match(voice, /const friendlyDamageTone = \(/)
  // 20 轨只有「旗舰且确已大破」才红;21 轨用血量分中破/大破
  assert.match(voice, /flagship\?\.mstId === mstId && ratio != null && ratio <= 0\.25 \? 'heavy' : 'light'/)
  // 我方不再整体按 hpEnd 分档(worstRatioFor 只服务消歧与深海侧)
  assert.doesNotMatch(voice, /DAMAGE_VOICE_SLOTS\.has\(cue\.voiceId\)\s*\?\s*damageToneFor/)
})

test('敌联合编成进机制估算:第 7 舰起标 escort,combinedType 联合位生效', () => {
  const forecast = fs.readFileSync(new URL('../src/renderer/combat-forecast.ts', import.meta.url), 'utf8')
  assert.match(forecast, /const combined = ids\.length > 6/)
  assert.match(forecast, /role: 'escort' as const/)
  assert.match(forecast, /combinedType: combined \? 4 : 0/)
})

test('海域进度条一律「剩余」语义:画剩余、数到 0/N 击破,通关归零不跳回满格', () => {
  const battle = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  const domain = fs.readFileSync(new URL('../src/renderer/modules/du.ts', import.meta.url), 'utf8')
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  // 2026-08-12 用户点名:「不是 1/6 到 6/6,是 6/6 到 0/6 击破」——与游戏血条同向
  assert.match(battle, /const remain = Math\.max\(0, gauge\.required - \(gauge\.defeated \?\? 0\)\)/)
  assert.match(battle, /\$\{remain\}\/\$\{gauge\.required\}/)
  assert.doesNotMatch(battle, /\$\{gauge\.defeated \?\? 0\}\/\$\{gauge\.required\}/)
  assert.match(domain, /Boss 剩 \$\{Math\.max\(0, gauge\.required - \(gauge\.defeated \?\? 0\)\)\}\/\$\{gauge\.required\}/)
  assert.doesNotMatch(domain, /击破 \$\{gauge\.defeated/)
  assert.match(catalog, /Boss 剩 \$\{remain\}\/\$\{gauge\.required\} 次/)
  assert.doesNotMatch(catalog, /击破 \$\{gauge\.defeated/)
  // 「扣式」(2026-08-17 用户点名):图鉴缩略图上 EO 的个位数击破改离散格,
  // 一颗一扣、剩几颗亮几颗;>9 次与血条制退回连续条,已攻略仍是绿满条
  const html = rendererSource
  assert.match(catalog, /if \(!gauge\.cleared && gauge\.required <= 9\)/)
  assert.match(catalog, /i < remain \? ' class="on"' : ''/)
  assert.match(catalog, /map-thumb-gauge count pips/)
  assert.match(html, /\.mod-ji \.map-thumb-gauge\.pips i\.on/)

  // 2026-08-20 用户点名：铎的海域卡上下两条要同向。血条那条原先
  // `cleared ? 100 : pct` —— 打通瞬间条子跳回满格，被读成「血条又满了」，
  // 而紧挨着的击破计数条打通是归零的。两条统一成「剩余」：通关＝剩 0＝空条。
  const duGaugeCard = domain.slice(
    domain.indexOf('const gaugeCardHtml'),
    domain.indexOf('const gimmickCardHtml'),
  )
  assert.ok(duGaugeCard.length > 0, '找不到铎的血条卡，护栏没在测它想测的东西')
  assert.match(duGaugeCard, /width:\$\{gauge\.cleared \? 0 : pct\}%/)
  assert.doesNotMatch(duGaugeCard, /gauge\.cleared \? 100/, '通关又跳回满格了')
  // 条子归零后，「已通关」只剩文字与 .gaug.done 的绿色在标——这两样不许再掉
  assert.match(duGaugeCard, /gauge\.cleared \? '✓ 已完成'/)
  assert.match(duGaugeCard, /class="gaug\$\{gauge\.cleared \? ' done' : ''\}"/)
  assert.match(html, /\.mod-du \.gaug\.done \.v \{ color: var\(--ok\); \}/)
})

test('交战前敌情候选按舰列合并:本地/目录同编成不再拆成重复卡,阵形逐个进估算', () => {
  const battle = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  const forecast = fs.readFileSync(new URL('../src/renderer/combat-forecast.ts', import.meta.url), 'utf8')
  // 签名只按舰列;阵形(含确认目录的多阵形字符串拆 token)是候选的属性
  assert.match(battle, /const signature = ships\.join\(','\)/)
  assert.match(battle, /formationTokensOf\(formation\)/)
  // 机制估算按阵形展开成多条(阵形吃炮击补正,不能合掉)
  assert.match(battle, /candidate\.formations\.map\(\(entry\) => \(\{\s*formation: entry\.formation,/)
  // 多阵形字符串以前只按表序第一个命中(単縦 梯形 複縦 会静默按复纵算)
  assert.match(forecast, /export const formationTokensOf/)
  assert.match(forecast, /replace\(\/航行序列\/g, ' '\)/)
})

test('建造剧透收在顶栏预览卡:带舰娘小头像,建造中与完成待领同门,不上游戏画面', () => {
  const header = fs.readFileSync(new URL('../src/renderer/header-status.ts', import.meta.url), 'utf8')
  const html = rendererSource
  const main = fs.readFileSync(new URL('../src/main/mg/index.ts', import.meta.url), 'utf8')
  // 剧透门:钥的开关 + 建造中/完成待领一视同仁;头像走预览卡 media 槽
  assert.match(header, /const spoiled = isBuildSpoilerEnabled\(\) && dock\.state >= 2 && dock\.createdShipId > 0/)
  assert.match(header, /media: spoiled \? shipThumbHtml\(dock\.createdShipId, spoiledName, \{ className: 'preview' \}\) : undefined/)
  // 芯片默认不剧透;开关开着时「待领」换舰娘名字头两个字(2026-08-12 定,08-16 扩两字)
  assert.match(header, /芯片本体默认写「待领」/)
  // 游戏画面浮层已撤(工厂内子页切换零请求,浮层会挡在开发/解体界面上——
  // 2026-08-12 用户拍板收进顶栏),不许悄悄回潮
  assert.doesNotMatch(html, /kdock-spoiler/)
  assert.doesNotMatch(main, /kancolle\.screen\.factory/)
})

test('Boss 点判定按字母不按 bosscell 边号:多入边 Boss 不再挂幽灵尾巴', () => {
  const battle = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  // api_bosscell_no 只是通往 Boss 的某一条边号(6-2 K:bosscell=11,J 边到达 api_no=18),
  // 数字直比在多入边 Boss 点永远不等 → 已到 Boss 还追加幽灵 Boss 尾巴
  assert.match(battle, /s\.nodes\.some\(\(n\) => n\.eventId === 5 \|\| cellLetter\(s, n\.cell\) === bossLetter\)/)
  assert.doesNotMatch(battle, /const reachedBoss = s\.nodes\.some\(\(n\) => n\.cell === s\.bossCell\)/)
  assert.doesNotMatch(battle, /const isBoss = n\.cell === s\.bossCell/)
})

test('当前点即 Boss 亮红光环;编队全员闪闪给金字「状态已满」', () => {
  const html = rendererSource
  const fleet = fs.readFileSync(new URL('../src/renderer/modules/ru.ts', import.meta.url), 'utf8')
  // .tn.boss 声明在 .tn.cur 之后,同权重把当前点高亮盖成暗红——cur.boss 合成样式补亮
  assert.match(html, /\.mod-di \.tn\.cur\.boss \{ border-color: var\(--enemy\)/)
  // 全员 cond≥49(游戏キラ阈值)→ 金色「状态已满」;有一人不到就照旧「无疲劳」
  assert.match(fleet, /ships\.every\(\(ship\) => ship\.cond >= 49\)/)
  assert.match(fleet, /<b style="color:var\(--gold\)">补给与士气已满<\/b>/)
})

test('航迹条走过的点按遭遇类型分色;能动分歧不再冒充普通分歧点', () => {
  const battle = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  const html = rendererSource
  // 类型全部来自罗盘事件(eventId/eventKind),夜战点用 kind 细分,不推测
  assert.match(battle, /n\.eventKind === 2 \|\| n\.eventKind === 3 \|\| n\.eventKind === 7/)
  assert.match(html, /\.mod-di \.tn\.night\.done \{ border-color: var\(--night\)/)
  assert.match(html, /\.mod-di \.tn\.whirl\.done/)
  // 能动分歧:离线判据=wikiwiki 航路表「能動分岐」;站上去时 api_select_route 权威
  assert.match(battle, /能動分岐/)
  assert.match(battle, /s\.selectRoute\.length > 0 \|\| isActiveBranchSpot\(mapKeyOf\(s\), letter\)/)
  assert.match(battle, /branchLabelOf\(s, letter\)/)
})

test('基础四资源接入道具卷「可从任务获得」:材料反查补足文本命中,覆盖面写明', () => {
  const quests = fs.readFileSync(new URL('../src/renderer/modules/qn.ts', import.meta.url), 'utf8')
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  // 四资源数值只在游戏 api_get_material 里(观测过的任务才有),资料库文本不记
  assert.match(quests, /export const questsAwardingMaterial = \(materialIndex: number\)/)
  assert.match(quests, /quest\.getMaterial\?\.\[materialIndex\] \?\? 0\) > 0/)
  // 道具卷:文本命中在前,材料反查按金额降序补足,同任务不重复;映射走唯一口径表
  assert.match(catalog, /USEITEM_MATERIAL_INDEX\[itemId\]/)
  assert.match(catalog, /questsAwardingMaterial\(materialIdx\)\.filter\(\(award\) => !listedIds\.has\(award\.id\)\)/)
  // 「四资源数值只有游戏任务列表会给，没同步过的任务不在此列」这句覆盖面声明按
  // 2026-08-26 文案清扫裁定（族 1 记账起点免责）删了。要防的事由行为钉住：
  // 材料反查只在四资源那几个 id 上启用，别的道具一律不走这条路。
  assert.match(catalog, /materialIdx !== undefined && materialIdx <= 3/)
})

test('活动突破奖励词条连字成链:主数据全名精确命中最长优先,单字舰名不进索引', () => {
  const domain = fs.readFileSync(new URL('../src/renderer/modules/du.ts', import.meta.url), 'utf8')
  // 精确命中不模糊:逐字扫描 + startsWith;长名先试(特四式内火艇改 不被 特四式内火艇 抢走)。
  // 「精确」按 searchFold 口径(2026-08-12:wiki 原文「20.3cm / 50」「Modele 1927」
  // 与主数据字面不等,连不上链),命中区间经 map 落回原文,链接文字保留 wiki 原文切片
  assert.match(domain, /entries\.sort\(\(a, b\) => b\.folded\.length - a\.folded\.length\)/)
  assert.match(domain, /byChar\.get\(folded\[i\]\)\?\.find\(/)
  assert.match(domain, /folded\.startsWith\(entry\.folded, i\)/)
  // 折叠会并字:命中两端必须落在原文字符边界,不许把原文字符切一半
  assert.match(domain, /map\[end\] !== map\[end - 1\]/)
  assert.match(domain, /elink\(hit\.domain, hit\.id, text\.slice\(start, end\)\)/)
  // 单字名(杉/松那批)不进索引:误链比漏链伤人;译名/别名同门槛
  assert.match(domain, /if \(folded\.length < 2\) return/)
  // kcwiki 简中译名与任务奖励同款别名表也进索引(2026-08-12:wiki 原文
  // 「九七式中战车(中三)」对不上主数据「九七式中戦車(チハ)」,用户误以为没收录)
  assert.match(domain, /entityNamePlain\('ship', id, ship\.name\)/)
  assert.match(domain, /entityNamePlain\('equip', id, item\.name\)/)
  assert.match(domain, /entityNamePlain\('item', item\.id, item\.name\)/)
  assert.match(domain, /rewardAliasById\(KCWIKI_EQUIP_ALIAS\)/)
  assert.match(domain, /rewardAliasById\(KCWIKI_ITEM_ALIAS\)/)
  // 译名表异步落地:索引缓存键必须带本地化版本,否则空译名索引被永久缓存
  assert.match(domain, /localizationVersion\(\)/)
  // 奖励行走链接化而不是纯 esc
  assert.match(domain, /linkifyRewardText\(reward\.text\)/)
})

test('推荐练级:临近改造排前,单向与双向(可逆)分列,已到级/最终形态不进列表', async () => {
  // 2026-08-12 用户提议:切到演习页时给出「还差几级就能改造」的在籍舰娘,
  // 双向(可逆)形态切换必须与单向正常改造分列——换形态不是练级待办。
  const { levelingGroups } = await import('../src/renderer/practice-leveling.ts')
  const groups = levelingGroups([
    { rosterId: 1, mstId: 100, level: 47, afterShipId: 101, afterLv: 50, progressive: true },
    { rosterId: 2, mstId: 200, level: 45, afterShipId: 201, afterLv: 75, progressive: true },
    // 可逆形态切换(progressive=false)另列一组
    { rosterId: 3, mstId: 300, level: 86, afterShipId: 301, afterLv: 88, progressive: false },
    // 已到级:不是「练级」目标,改造缺口另有面板管
    { rosterId: 4, mstId: 400, level: 90, afterShipId: 401, afterLv: 88, progressive: true },
    // 最终形态:没有下一改装
    { rosterId: 5, mstId: 500, level: 99, afterShipId: 0, afterLv: 0, progressive: false },
    // 同差距时等级高的排前(同样差 3 级,Lv97 比 Lv47 更该进演习队)
    { rosterId: 6, mstId: 600, level: 97, afterShipId: 601, afterLv: 100, progressive: true },
  ])
  assert.deepEqual(groups.oneWay.map((row) => row.rosterId), [6, 1, 2])
  assert.deepEqual(groups.reversible.map((row) => row.rosterId), [3])
  assert.equal(groups.oneWay[0].gap, 3)
  assert.equal(groups.oneWay[2].gap, 30)
  // 「总xxxx」经验差(2026-08-13 用户提议):调用方按等级经验表算好透传,
  // 没给(表未就绪)落 null,行里留空不猜
  assert.equal(groups.oneWay[0].expGap, null)
  const withExp = levelingGroups([
    { rosterId: 7, mstId: 700, level: 47, afterShipId: 701, afterLv: 50, progressive: true, expGap: 24300 },
  ])
  assert.equal(withExp.oneWay[0].expGap, 24300)
  // 「按等级/按经验」子分类(2026-08-13 用户提议):级差不等价于经验差——
  // Lv97 差 3 级要的经验远多于 Lv30 差 5 级。经验算不出的沉底
  const byExp = levelingGroups(
    [
      { rosterId: 1, mstId: 100, level: 97, afterShipId: 101, afterLv: 100, progressive: true, expGap: 320000 },
      { rosterId: 2, mstId: 200, level: 30, afterShipId: 201, afterLv: 35, progressive: true, expGap: 9000 },
      { rosterId: 3, mstId: 300, level: 40, afterShipId: 301, afterLv: 45, progressive: true, expGap: null },
    ],
    'exp',
  )
  assert.deepEqual(byExp.oneWay.map((row) => row.rosterId), [2, 1, 3])
  // 默认口径不变:按级差,同差距等级高的在前
  const byLevel = levelingGroups([
    { rosterId: 1, mstId: 100, level: 97, afterShipId: 101, afterLv: 100, progressive: true, expGap: 320000 },
    { rosterId: 2, mstId: 200, level: 30, afterShipId: 201, afterLv: 35, progressive: true, expGap: 9000 },
  ])
  assert.deepEqual(byLevel.oneWay.map((row) => row.rosterId), [1, 2])
  // 演习空闲态挂卡:名簿下面就是推荐练级;分类复用 progressiveRemodelOf
  // (可逆转换的回边不算「下一改装」,与图鉴/列表同口径)
  const di = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  assert.match(di, /\$\{practiceRosterHtml\(\)\}\s*\$\{practiceLevelingHtml\(\)\}/)
  // 选完演习对手后镝切到预览视图,空闲态的卡会被顶掉(2026-08-12 用户实测「没有啊」)
  // ——预览的滚动体内也要挂,且必须在 practice-preview-body 里,不然挤在滚动区外
  // 原锚点是 practice-preview-caveat（该块已按发布侧文案裁定整块删）。行为没变，
  // 换钉滚动体里最后一个还在的结构标记：练级卡必须排在 practice-preview-fleets
  // 之后、且仍闭在 practice-preview-body 这层 </div> 之内。
  assert.match(di, /practice-preview-fleets[\s\S]{0,1600}\$\{practiceLevelingHtml\(\)\}\s*<\/div>`/)
  assert.match(di, /progressive: progressiveRemodelOf\(ship\) != null/)
  assert.match(di, /levelingGroupHtml\('单向改造'/)
  assert.match(di, /levelingGroupHtml\('双向转换'/)
  // 经验差从 expNeededTo 来(实测优先于矿脉表);行里显示「总xxxx」,算不出留空
  assert.match(di, /expNeededTo\(\{ lv: ship\.lv, expTotal: ship\.expTotal, expNext: ship\.expNext \}, afterLv\)/)
  assert.match(di, /`总\$\{row\.expGap\.toLocaleString\(\)\}`/)
  // 「按等级/按经验」子分类两侧都接:演习卡(跨会话记住)与列表(切排序轴)
  assert.match(di, /levelingGroups\(inputs, levelingOrder, \{\s*finalOnly: levelingFinalOnly,\s*\}\)/)
  assert.match(di, /uiSet\('di\.levelingOrder', order\)/)
  // 「最终改造筛选」(2026-08-17 用户提议):判据是纯函数 isFinalRemodelTarget
  // (行为测试在 practice-leveling.test.mjs),演习卡跨会话记住开关
  assert.match(di, /data-act="lvl-final"/)
  assert.match(di, /uiSet\('di\.levelingFinal', levelingFinalOnly\)/)
  assert.match(di, /isFinalRemodelTarget\(master\.afterShipId, afterOf\)/)
  // 列表(持有舰娘)侧同口径接入:临近改造筛选点亮时套上按差距排序,
  // 双向(可逆)切换标 flip 单列,级差列可排序;这页不随游戏切到演习自动跳转。
  // 视图预设行 2026-08-18 用户拍板砍掉:四个带筛选的预设与筛选 chip 一一重复,
  // 纯排序的两个与表头重复——配套排序并进 SMART_SORTS,点亮筛选时生效
  const roster = fs.readFileSync(new URL('../src/renderer/modules/qa.ts', import.meta.url), 'utf8')
  assert.match(roster, /leveling: \{ sortKey: 'kaigap', sortDir: 1 \}/)
  assert.doesNotMatch(roster, /PRESETS|data-preset/)
  assert.match(roster, /applySmart\(state\.smart === chip\.dataset\.smart \? null : chip\.dataset\.smart\)/)
  assert.match(roster, /leveling: \(row\) => row\.kai\.state === 'near' \|\| row\.kai\.state === 'flip'/)
  assert.match(roster, /state: 'flip',\s*\n\s*next: entityNamePlain\('ship', master\.afterShipId, masterShipName\(master\.afterShipId\)\),\s*\n\s*gap: master\.afterLv - ship\.lv,\s*\n\s*expGap: expGapTo\(master\.afterLv\)/)
  assert.match(roster, /gapOf\(a\) - gapOf\(b\) \|\|\s*b\.ship\.lv - a\.ship\.lv/)
  assert.match(roster, /\$\{th\('kaigap', '改造'\)\}/)
  // 列表侧同步「总xxxx」经验差(2026-08-13 用户点名「图鉴的列表没有同步吧」):
  // near/flip 两态都带 expGap,与演习卡同一口径(expNeededTo,实测优先),算不出留空
  assert.match(roster, /expGap: expGapTo\(nextRemodel\.level\)/)
  assert.match(roster, /expNeededTo\(\{ lv: ship\.lv, expTotal: ship\.expTotal, expNext: ship\.expNext \}, target\)/)
  assert.ok((roster.match(/总\$\{row\.kai\.expGap\.toLocaleString\(\)\}/g) ?? []).length >= 2, 'near 与 flip 两态的单元格都要显示总经验差')
  // 列表侧子分类:临近改造筛选激活时给「按等级/按经验」,切的是排序轴 kaigap/kaiexp
  assert.match(roster, /data-lvlorder="kaigap"/)
  assert.match(roster, /data-lvlorder="kaiexp"/)
  assert.match(roster, /kaiexp: \(a, b\) => \{/)
  assert.match(roster, /chip\.dataset\.lvlorder/)
  // 列表侧「最终改造」子筛选:near/flip 两态都算好 finalGoal,开关只在临近改造视图出现
  assert.match(roster, /data-lvlfinal/)
  assert.match(roster, /chip\.dataset\.lvlfinal/)
  assert.match(roster, /finalGoal: isFinalRemodelTarget\(nextRemodel\.shipId, afterOf\)/)
  assert.match(roster, /finalGoal: isFinalRemodelTarget\(master\.afterShipId, afterOf\)/)
  assert.match(roster, /state\.smart === 'leveling' && state\.lvlFinal/)
  // qa 不许监听演习数据搞自动跳转(activateModule('ji') 是列表跳图鉴的正常导航)
  assert.doesNotMatch(roster, /mg\.practice|practiceOpponent/)

  // ---- 进阶分组置顶(2026-08-18 用户拍板「分组置顶」) ----
  // 白手玩家的痛点:两种排序都是「越便宜越靠前」,低级链尾船(海防/丸ゆ式
  // 一段改到头)天然刷屏,主力舰的改造规划被挤到列表深处。已上线的「最终改造」
  // 筛选帮不上忙——那批船的下一段恰好都是链尾,全部通过筛选(2026-08-18 实测)。
  // 口径:段≥2(改二及以上) ∨ (链尾一段改 ∧ Lv≥45,即「海外只有改一」档)。
  // 行为测试在 practice-leveling.test.mjs;这里钉两侧接线与「不筛掉、只分组」。
  assert.match(di, /advanced:\s*\n?\s*master && master\.afterShipId > 0\s*\n?\s*\? isAdvancedRemodelTarget\(master\.afterShipId, afterLv, stageOf, afterOf\)/)
  assert.match(di, /buildRemodelStageMap\(/)
  assert.match(di, /class="lvl-tier"/, '演习卡两组之间有「初段改造」分界线')
  assert.match(roster, /advanced: isAdvancedRemodelTarget\(nextRemodel\.shipId, nextRemodel\.level, stageOf, afterOf\)/)
  assert.match(roster, /advanced: isAdvancedRemodelTarget\(master\.afterShipId, master\.afterLv, stageOf, afterOf\)/)
  // 分组只在临近改造视图生效:普通列表点「改造」表头仍是纯级差语义
  assert.match(roster, /state\.smart === 'leveling' \? \(rowAdvanced\(b\) \? 1 : 0\) - \(rowAdvanced\(a\) \? 1 : 0\) : 0/)
  assert.match(roster, /advancedTier\(a, b\) \|\|/)
  // 表格分界行:只在按等级/按经验正序时插(换别的表头排序组不连续,不硬插)
  assert.match(roster, /lvl-tier-row/)
  assert.match(roster, /state\.sortDir === 1/)
  const html = rendererSource
  assert.match(html, /\.mod-di \.lvl-tier \{/)
  assert.match(html, /\.mod-qa \.lvl-tier-row td \{/)
  // 纯函数层:进阶行先于初段行,收藏仍最优先(哪怕收藏的是初段船)
  const { levelingGroups: lg2 } = await import('../src/renderer/practice-leveling.ts')
  const grouped = lg2([
    { rosterId: 1, mstId: 100, level: 58, afterShipId: 101, afterLv: 60, progressive: true },
    { rosterId: 2, mstId: 200, level: 75, afterShipId: 201, afterLv: 84, progressive: true, advanced: true },
    { rosterId: 3, mstId: 300, level: 55, afterShipId: 301, afterLv: 60, progressive: true, favorite: true },
  ])
  assert.deepEqual(grouped.oneWay.map((row) => row.rosterId), [3, 2, 1])
})

test('组合实验室挂在装备卷第三模式:只读模拟,复用共享判定层', () => {
  // 2026-08-12 用户提议:装备图鉴里加「组合实验室」查/模拟各种 CI 与配装。
  // 判定全部复用共享层(夜战CI/弹着观测/对空CI/先制对潜),实验室只做组装,
  // 不许在 UI 里另写一套判定表。
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const lab = fs.readFileSync(new URL('../src/renderer/modules/ji-lab.ts', import.meta.url), 'utf8')
  assert.match(catalog, /data-equip-mode="lab">组合实验室</)
  assert.match(catalog, /if \(labSlot\) mountLab\(labSlot, mst\)/)
  // 模式按钮的白名单必须认得 lab——上线时漏了,按钮点了毫无反应(用户实测)
  assert.match(catalog, /\['catalog', 'today', 'lab'\]\.includes\(mode\)/)
  assert.match(lab, /from '\.\.\/\.\.\/shared\/night-cutin'/)
  assert.match(lab, /from '\.\.\/\.\.\/shared\/day-spotting'/)
  assert.match(lab, /openingAswOf,\s*\n\s*shipAaciCeiling/)
  assert.match(lab, /aaciEntriesOf,/)
  // 装备候选按可装备规则过滤,不列这艘舰装不上的
  assert.match(lab, /shipCanEquipItem\(mstRaw, ship\.shipId, id\)/)
})

test('游戏画面等比包含:区域比 5:3 矮时留黑边,不裁游戏底部', () => {
  // 2026-08-12 用户实锤:非 5:3 比例下游戏画面底部被裁。旧写法 width:100% +
  // max-height:100%——高度被钳但宽度不缩,比例失真;缩放系数按宽度算,
  // 内容比可视区高,底下就切了。宽度显式取「区宽」与「区高×5/3」的小者
  // (cqw/cqh 需要 game-area 开 container-type:size),已在 Chromium 实测:
  // 900×300 容器 → 500×300,400×600 容器 → 400×240,两向都只留黑边。
  const html = rendererSource
  assert.match(html, /#game-area \{[^}]*container-type: size/s)
  assert.match(html, /#game-wrapper \{ width: min\(100cqw, calc\(100cqh \* \(1200 \/ 720\)\)\); aspect-ratio: 1200 \/ 720/)
})

test('顶栏状态条吃满中段剩余宽度,不再定宽居中被裁右侧', () => {
  // 2026-08-12 用户实锤:远征四个「领」+ 演习 + 舰装计数一起出现时,
  // min(1080px,56vw) 的定宽装不下,最右被 overflow:hidden 裁掉。
  // 改成普通 flex 成员(flex:1 1 0 + min-width:0),中段剩多少用多少;
  // 原来的 .spacer 撑位与状态条抢配额,必须一并去掉。
  const html = rendererSource
  assert.match(html, /#header-status \{\s*flex: 1 1 0; min-width: 0;/)
  assert.doesNotMatch(html, /header \.spacer/)
  assert.doesNotMatch(html, /<span class="spacer">/)
})

test('建造坞「待领」在剧透开关下换成所造舰娘名字头两个字', () => {
  // 2026-08-12 用户定的:开了钥的建造剧透后,抬头待领芯片直接标舰娘名字
  // (四个坞谁是谁一眼分清);默认是「待领」,不开开关不剧透。
  // 2026-08-16 空闲态改两字宽后,剧透也放两个字(单字名只有一个字,slice 兜底)。
  const header = fs.readFileSync(new URL('../src/renderer/header-status.ts', import.meta.url), 'utf8')
  assert.match(header, /isBuildSpoilerEnabled\(\) && dock\.createdShipId > 0/)
  assert.match(header, /\[\.\.\.entityNamePlain\('ship', dock\.createdShipId, masterShipName\(dock\.createdShipId\)\)\]\s*\.slice\(0, 2\)/)
  assert.match(header, /esc\(spoiledChar \|\| '待领'\)/)
})

test('导航条单击显示中的模块只收那一个,不再收起整个坞', () => {
  // 2026-08-12 用户实锤:点掉底坞任意一个模块,整个底坞(连同并排的其他模块)
  // 一起消失。改成「搁置」语义:只从坞里摘掉这一页,导航条元素块保留(变暗)
  // 作为唯一恢复入口;链接跳转到被搁置的模块时自动唤回;搁置名单随布局持久化。
  const mu = fs.readFileSync(new URL('../src/renderer/mu.ts', import.meta.url), 'utf8')
  const html = rendererSource
  assert.match(mu, /shelveModule\(mod\.id\)/)
  assert.doesNotMatch(mu, /setCollapsed\(dockOfModule\(mod\.id\), true\)/)
  // 搁置状态要随布局存档、并在装配对账时清掉未知 id
  assert.match(mu, /shelved: \[\]/)
  assert.match(mu, /layout\.shelved = layout\.shelved\.filter\(\(id\) => known\.has\(id\)\)/)
  // 跳转要能唤回被搁置的模块——链接指过来却毫无反应等于坏了
  assert.match(mu, /layout\.shelved = layout\.shelved\.filter\(\(x\) => x !== id\)/)
  // 元素块保留且有 shelved 视觉态;坞内铺设按 displayed(存在且未搁置)过滤
  assert.match(mu, /tile\.classList\.toggle\('shelved', isShelved\(id\)\)/)
  assert.match(mu, /mods: g\.mods\.filter\(displayed\)/)
  assert.match(html, /\.element-tile\.shelved \{ opacity: \.45; border-style: dashed; \}/)
})

test('窄框战斗行:徽记(初/展开箭头)永不裁切,空间不够让名字自己缩略', () => {
  // 2026-08-12 用户实锤:窄框下排在名字后面的徽记被裁——.nm 整体 overflow:hidden,
  // 长名把它们顶出可视区。名字截一半仍认得出,徽记裁掉就丢信息。
  //（旗/★MVP 同日按用户要求撤掉:旗舰永远第一行、MVP 结果条已有,行内是重复信息）
  const html = rendererSource
  assert.match(html, /\.mod-di \.brow \.nm > \* \{ flex: 0 0 auto; \}/)
  assert.match(html, /\.mod-di \.brow \.nm > \.el \{ flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; \}/)
})

test('战斗行网格不再溢出容器:血条先让宽,名字靠省略号收场', () => {
  // 2026-08-20 实测:容器 181px,而 minmax(58px,1fr)+34px+86px 的下限之和连同
  // gap/padding 要 198px——网格整体溢出 17px,最右的血条被 .battle-col 的
  // overflow:hidden 切掉(不是省略号,是硬裁)。后两列改成可收缩。
  // 2026-08-21 伤害列改成按内容收（min-content 跟着 .dmg 的 ch 宽），
  // 血条列的上限从死的 86px 改成 min(86px, 42%)——轨道形状变了，这里跟着按语义重写，
  // 挡的还是同一件事：三列下限装得进 181px、能让宽的是后两列、名字列的下限不许被调低。
  const html = rendererSource
  // 伤害列最宽的情形＝五位数；等宽字体下 1ch = 6.3px（10.5px Maple Mono 实测）
  const DMG_MAX_FLOOR = 5 * 6.3
  const track = /minmax\((\d+)px, 1fr\) (min-content) minmax\((\d+)px, min\((\d+)px, (\d+)%\)\)/
  const wide = html.match(
    /\.mod-di \.brow \{\s*display: grid; grid-template-columns: ([^;]+);/,
  )?.[1]
  const narrow = html.match(
    /\.mod-di \.di-app\.narrow \.brow \{ grid-template-columns: ([^;]+);/,
  )?.[1]
  for (const [label, decl] of [['宽态', wide], ['窄态', narrow]]) {
    assert.ok(decl, `${label}的 .brow 轨道声明没找到`)
    const m = decl.match(track)
    assert.ok(m, `${label}的轨道形状不对（名字 1fr / 伤害 min-content / 血条 minmax+百分比封顶）：${decl}`)
    const nameMin = Number(m[1])
    const hpMin = Number(m[3])
    const hpCap = Number(m[4])
    const hpPct = Number(m[5])
    // 下限之和 + gap(6×2) + padding(4×2) 必须真的塞得进曾经溢出的那个宽度
    assert.ok(
      nameMin + DMG_MAX_FLOOR + hpMin + 12 + 8 <= 181,
      `${label}的三列下限合计仍然装不进 181px 的实测容器`,
    )
    // 让宽的是血条不是名字：名字列的下限要守住
    assert.ok(hpMin < hpCap, `${label}的血条列必须能收缩`)
    assert.ok(nameMin >= 50, `${label}的名字列下限不该被顺手调低`)
    // 百分比封顶是让余量流向名字的那一半：写回死值，窄档余量又会被血条吃光
    assert.ok(hpPct > 0 && hpPct < 100, `${label}的血条列上限必须带百分比封顶`)
  }
})

test('双波航空战机损两波都算,血条行不再挂旗/★MVP 文字徽记', () => {
  // 2026-08-12 用户抓的实锤:双波航空战头部「机损 3/164」漏了第二波
  // (我 -1/敌 -58),与战斗流水对不上账。每波各自 stage1(互击)+stage2(对空炮火),
  // air2 = api_kouku2 的第二波,总数必须两波相加。
  const battle = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  assert.match(battle, /const fLoss = \(air \? air\.fLost \+ air\.fLost2 : 0\) \+ \(air2 \? air2\.fLost \+ air2\.fLost2 : 0\)/)
  assert.match(battle, /const eLoss = \(air \? air\.eLost \+ air\.eLost2 : 0\) \+ \(air2 \? air2\.eLost \+ air2\.eLost2 : 0\)/)
  // 旗/★MVP 行内文字徽记按用户要求撤掉(旗舰永远第一行、MVP 结果条已有)
  assert.doesNotMatch(battle, /<span class="mvp">/)
  assert.doesNotMatch(battle, /<i>旗<\/i>/)
  // 「主力」前缀只在联合舰队出现——单舰队挂「主力」是无中生有的分类
  // (2026-08-12 用户抓的实锤:通常战也写着「MVP 主力 日向改二」)
  // 2026-08-16 MVP 名改互链（shipLinkAt），主力前缀口径不变
  assert.match(battle, /\$\{combined \? '主力 ' : ''\}\$\{shipLinkAt\(b, 0, b\.result\.mvp\)\}/)
})

test('结算后的 MVP 与基本经验只在结果条一处,舰名紧跟「MVP」同行', () => {
  // 2026-08-18 用户指出横幅与结果条上下重复,当时只留了横幅一处;
  // 2026-08-20 他改口把这唯一一处挪进结果条:「对象可以直接接在MVP后面,
  // 联合舰队也同理,然后把这个放在这个地方空着的地方,后面的经验也同理,
  // 上面就可以空一部分区域出来」。横幅因此收成单行。
  const battle = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  const html = rendererSource

  // 唯一展示位在结果条:两枚 rchip,舰名在「MVP」之后的同一枚芯片里;
  // 联合舰队的两条各自裹一层 span,好让 CSS 把「主力 X」整体禁掉折行
  assert.match(
    battle,
    /<span class="rchip mvp">MVP <b>\$\{mvpNames\.map\(\(name\) => `<span>\$\{name\}<\/span>`\)\.join\(' \/ '\)\}<\/b><\/span>/,
  )
  assert.match(battle, /<span class="rchip">基本经验 <b>\+\$\{b\.result\.baseExp\}<\/b><\/span>/)
  // MVP/经验的组装必须在 resultStripHtml 里,不能又回到 outcomeBannerHtml。
  // 先剥掉行注释——搬迁的来龙去脉正写在那儿,不该被当成还在渲染
  const codeOnly = (src) => src.replace(/^[ \t]*\/\/.*$/gm, '')
  const banner = codeOnly(battle.slice(
    battle.indexOf('const outcomeBannerHtml'),
    battle.indexOf('const aaciDescribe'),
  ))
  assert.doesNotMatch(banner, /MVP/)
  assert.doesNotMatch(banner, /基本经验/)
  const strip = battle.slice(
    battle.indexOf('const resultStripHtml'),
    battle.indexOf('const logHtml'),
  )
  assert.match(strip, /const mvpNames = b\.result/)
  assert.match(strip, /护卫 \$\{shipLinkAt\(b, 0, 6 \+ \(b\.result\.mvpCombined \?\? -1\)\)\}/)
  // 「首次攻略！」是里程碑不是度量,留在横幅;横幅的度量副行(基本经验)整条消失
  assert.match(banner, /b\.result\.firstClear \? '<span>首次攻略！<\/span>' : ''/)
  // 芯片是 inline-flex(标签与名字同行),名字内部再禁一次折行
  assert.match(html, /\.mod-di \.rchip \{[\s\S]*?display: inline-flex/)
  assert.match(html, /\.mod-di \.rchip\.mvp b > span \{ white-space: nowrap; \}/)
})

test('结算横幅按评级写胜/败,不再一律「胜负确定」', () => {
  // 2026-08-20 用户当场指出:「A 胜负确定」在中文里既是废话又有歧义——
  // 评级本身已经分了阵营,A 就是胜,「负」不该跟着出现。
  const battle = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  // 剥掉行注释再断言:改动的来龙去脉正写在那儿,那不是渲染出去的文案
  assert.doesNotMatch(battle.replace(/^[ \t]*\/\/.*$/gm, ''), /胜负确定/)
  assert.match(battle, /\$\{esc\(resultRank\)\} \$\{rankOutcomeWord\(b\.result\.rank\)\}/)

  // 归类只认首字母,且认不出的评级(store 在 api_win_rank 缺失时落 '?')退回中性写法,
  // 不硬塞进胜或败——照抄源码里的判据跑一遍,免得只钉住文本而判断写反了没人管
  const fn = battle.slice(battle.indexOf('const rankOutcomeWord'))
  const body = fn.slice(0, fn.indexOf('\n}') + 2).replace(/: string/g, '')
  const rankOutcomeWord = new Function(`${body}; return rankOutcomeWord`)()
  for (const r of ['S', 'A', 'B']) assert.strictEqual(rankOutcomeWord(r), '胜确定', r)
  for (const r of ['C', 'D', 'E']) assert.strictEqual(rankOutcomeWord(r), '败确定', r)
  for (const r of ['?', '', 'X']) assert.strictEqual(rankOutcomeWord(r), '判定确定', `[${r}]`)
})

test('航迹节点单击回顾:打过的点接本地战斗快照回放', () => {
  // 2026-08-12 用户提议。匹配口径:本次出击时间窗内、同图同点的快照;
  // 上界必须卡 updatedTs——只卡下界会把同图**后来那次出击**的快照错认进来。
  // 正在实时显示的当前点与回放中正看着的那场不再挂点击。
  const battle = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  const html = rendererSource
  assert.match(battle, /entry\.ts >= s\.startTs/)
  assert.match(battle, /entry\.ts <= s\.updatedTs \+ 300000/)
  assert.match(
    battle,
    /snap && !\(isCur && !currentSnapshot\) && currentSnapshot\?\.id !== snap\.id/,
  )
  assert.match(battle, /data-replay-id="\$\{replayable\.id\}" role="button"/)
  // 2026-08-20：换片走一个可替换的通道，默认仍是 openBattleSnapshot——
  // 镝自己（live 宿主）一字未变，仍是「切到镝 + 换 replay」；
  // 嵌入宿主（史的抽屉）传自己的，就地换片不切模块。原钉直接写死了
  // openBattleSnapshot，把「镝的行为」和「所有宿主的行为」钉成了一件事。
  assert.match(battle, /void openSnapshot\(Number\(trailNode\.dataset\.replayId\)\)/)
  assert.match(
    battle,
    /openSnapshot: \(id: number\) => void = openBattleSnapshot/,
    '默认通道被换掉了：镝自己的航迹回放不该改道',
  )
  assert.match(battle, /options\?\.openSnapshot \?\? openBattleSnapshot/)
  assert.match(html, /\.mod-di \.tn\[data-replay-id\] \{ cursor: pointer; \}/)
  // 回放时航迹要用「这次出击已知最全的路径」——快照存的是打那一战时刻的
  // sortie,节点只到当时位置,直接拿来画航迹回放就成了单行道,后面的点回不去
  // (2026-08-12 用户实锤)。实时同 run 用 mg.sortie;否则取同 run 编号最大的
  // 快照,且必须绑 sortieId,嵌入式面板不许拿错 run 的路径。
  assert.match(
    battle,
    /trailHtml\(snapshot \? replayTrailSortie\(snapshot\) : s, snapshot, trailIndex\)/,
  )
  // 2026-08-20:单例 replayRunTrail 改成按快照 id 键控的小缓存——它有两个宿主
  // (镝面板 / 史的复盘抽屉),单例只在镝那条路上赋值,抽屉里那条单行道原样复发。
  // 原意「必须绑 sortieId」照钉,只是换成缓存条目上的那一层。
  assert.match(battle, /cached\?\.state === 'ready' && cached\.sortieId === snapshot\.sortieId/)
  assert.doesNotMatch(battle, /let replayRunTrail/, '不许再退回单例')
  assert.match(battle, /entry\.battleNo > best\.battleNo/)
  assert.match(battle, /replay\?\.id === snapshot\.id/)
})

test('wikiwiki 抓取按主机统一节奏,429 自适应放缓不硬怼', () => {
  // 2026-08-12 用户点名「会限流,只能柔和抓取」:台词页此前 1.2s 一页,
  // 整程 429 还按 30/60s 硬试。节奏收进 fetchWikiwikiPage 按主机排队:
  // 原站起步 10.5s(其余抓取点多年安全的间隔)、429 翻倍封顶 3 分钟、
  // 等待遵循 Retry-After 且下限逐次抬高、成功缓慢回落;调用方不再各自 sleep。
  const fetcher = fs.readFileSync(new URL('../scripts/fetch-lodes.mjs', import.meta.url), 'utf8')
  assert.match(fetcher, /host === 'wikiwiki\.jp' \? 10_500 : 250/)
  assert.match(fetcher, /pace\.pace = Math\.min\(180_000, Math\.max\(pace\.pace \* 2, pace\.base\)\)/)
  assert.match(fetcher, /pace\.pace = Math\.max\(pace\.base, Math\.round\(pace\.pace \* 0\.9\)\)/)
  assert.match(fetcher, /60_000 \* \(attempt \+ 1\)/)
  // 调用方的固定间隔一律拆掉,节奏只有一个旋钮
  assert.doesNotMatch(fetcher, /setTimeout\(resolve, 1_200\)/)
  assert.doesNotMatch(fetcher, /setTimeout\(resolve, 10_500\)/)
})

test('图鉴台词试听吃钥的音量设置,不再只随系统音量', () => {
  // 2026-08-12 用户实锤:试听用裸 Audio(默认 1.0),总音量/语音倍率全不生效。
  // 试听与游戏语音同一套口径:总音量 × 语音倍率,封顶 1(倍率>100% 是给
  // 游戏页内增益的);每次播放前重取,改完设置立即跟上。
  const voice = fs.readFileSync(new URL('../src/renderer/kcs-voice.ts', import.meta.url), 'utf8')
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  assert.match(voice, /kanso\.gameAudio\.volume/)
  assert.match(voice, /kanso\.gameAudio\.voiceVolume/)
  assert.match(voice, /Math\.max\(0, Math\.min\(1, combined\)\)/)
  assert.match(catalog, /voiceAudio\.volume = previewVoiceVolume\(\)/)
})

test('速览卡滚动即收:滚轮翻页不产生 mouseout,不收就钉在原地', () => {
  // 2026-08-12 用户实锤:悬停出浮窗后不移开鼠标直接滚轮翻页,浮窗卡在原地,
  // 直到指针挪到下一个实体才消失——滚动不移动指针,mouseout 压根不触发。
  // scroll 不冒泡,必须捕获阶段接;待弹的计时器也要掐,不然滚完 400ms 后
  // 又冒出一张锚点早已滚走的卡。钉住的卡是用户显式要的,不收。
  const link = fs.readFileSync(new URL('../src/renderer/link.ts', import.meta.url), 'utf8')
  const scrollHandler = link.match(/document\.addEventListener\(\s*'scroll',[\s\S]{0,400}?\{ capture: true, passive: true \},?\s*\)/)
  assert.ok(scrollHandler, '必须有捕获阶段的全局 scroll 监听')
  assert.match(scrollHandler[0], /clearTimeout\(peekTimer\)/)
  assert.match(scrollHandler[0], /clearTimeout\(tipTimer\)/)
  assert.match(scrollHandler[0], /hidePeek\(\)/)
  assert.match(scrollHandler[0], /hideTip\(\)/)
})

test('道具「可兑换列表」:固定手录+矿脉历年合流,兑换所得按名精确联实体', () => {
  // 2026-08-18 用户提议。数据分两路:勲章的常设三项是游戏内道具使用界面的
  // 固定选项,wiki 侧是散文,机器解析不可靠 → shared/item-exchange.ts 手录
  // (依据 wikiwiki 勲章页用途节+游戏内可实测);季节收集物(秋刀魚年次表/
  // 菱餅固定表)是 wikiwiki アイテム页的表格化目录 → 矿脉包,解析行为
  // 测试在 wikiwiki-item-exchange.test.mjs。豆/南瓜的收集回馈走限时任务,
  // 任务域另管,这里如实不收。
  const shared = fs.readFileSync(new URL('../src/shared/item-exchange.ts', import.meta.url), 'utf8')
  assert.match(shared, /57, \/\/ 勲章/)
  assert.match(shared, /\{ cost: 4, gets: '改装設計図x1' \}/)
  assert.match(shared, /\{ cost: 1, gets: '改修資材x4' \}/)
  const atlas = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  assert.match(atlas, /\$\{itemExchangeHtml\(u\.api_id\)\}/)
  assert.match(atlas, /queryLode\('wikiwiki-item-exchange'\)/)
  // 兑换所得文字里的装备/道具名做实体链接:最长匹配扫描,全角／＋＆归一后精确命中才联
  // (＆是 2026-08-18 用户问日语时带出的漏联:wiki 全角、主数据半角「寒冷地装備&甲板要員」)
  assert.match(atlas, /text\.replace\(\/／\/g, '\/'\)\.replace\(\/＋\/g, '\+'\)\.replace\(\/＆\/g, '&'\)/)
  assert.match(atlas, /exchangeGetsHtml/)
  // 2026-08-19 用户实锤:用途明细的「改造」行(吹雪改三 → 吹雪改三護（六式）)全是白字——
  // 索引里只有装备和道具。舰娘名垫底补缺入索引;間宮/伊良湖这类同字名维持道具优先
  // (兑换语境说的是补给品)。括号全角半角归一,替换必须 1:1 等长,否则展示切片错位
  assert.match(atlas, /\$\{friendlyEquips\.size\}:\$\{useitemMst\.size\}:\$\{friendlyShips\.size\}/)
  assert.match(atlas, /for \(const ship of friendlyShips\.values\(\)\)[\s\S]{0,220}!exchangeNameIndex\.has\(name\)[\s\S]{0,120}kind: 'mstShip', id: Number\(ship\.api_id\)/)
  assert.match(atlas, /\.replace\(\/（\/g, '\('\)\.replace\(\/）\/g, '\)'\)/)
  assert.match(atlas, /装备\/道具\/舰娘名称可打开详情/)
  // 同类补漏:建造参考的備考(「まるゆ狙い」这类点名别的舰)走同一套索引联实体
  assert.match(atlas, /<span class="br-note">\$\{exchangeGetsHtml\(note\)\}/)
  // 索引随主数据规模重建:首开道具页时装备表可能没就绪,一次性缓存会让装备名
  // 永远联不上(2026-08-18 用户实锤:道具联上了、装备全白字);给糧艦「伊良湖」
  // 这类带前缀道具名的内名一并入索引
  assert.match(atlas, /exchangeNameIndexSizes === sizes/)
  assert.match(atlas, /rawName\.match\(\/「\(\.\+\)」\$\/\)/)
  // wiki 格式短语机械可译才译,原文留悬停;译不动的原样留日文不猜
  assert.match(atlas, /每届最多兑 \$1 次/)
  assert.match(atlas, /每届限兑次数 wiki 未确证/)
  assert.match(atlas, /或改选 \$1/)
  assert.match(atlas, /offerZh !== row\.offer \? ` title="\$\{esc\(row\.offer\)\}"` : ''/)
  // 有数据才有区块:固定/兑换选项/历年三种,历年按年倒序
  assert.match(atlas, /if \(!hand && !lodeEntry\) return ''/)
  assert.match(atlas, /历年兑换<span class="aux">按年倒序/)
  const html = rendererSource
  assert.match(html, /\.mod-ji \.iex-row \{/)
  // 活动史類(節分の豆/南瓜/てるてる坊主/Xmas 盒):詳細格式五花八门不硬拆,
  // 按年份+原文速览收录(2026-08-18 用户追问「南瓜/节分豆呢」后补齐——
  // 别再按表头形状断言「wiki 没有」)
  assert.match(atlas, /历年活动兑换<span class="aux">按 wiki 原记逐年收录/)
  assert.match(atlas, /exchangeDetailZh/)
  // 具体作用(2026-08-18 用户点名「很多只有说明的道具」):总表詳細一句话
  // (60 件全覆盖) + 小节「用途」明细(16 件),原文收录 + 名字联实体
  assert.match(atlas, /\$\{itemFunctionHtml\(u\.api_id\)\}/)
  assert.match(atlas, /具体作用<span class="aux">/)
  assert.match(html, /\.mod-ji \.ifx-overview \{/)
  // 抓取护栏:低于实测基线(40 项/年次 30/固定 3/活动史 15/作用 35/用途 8)
  // 宁可失败不出残包
  const fetcher = fs.readFileSync(new URL('../scripts/fetch-lodes.mjs', import.meta.url), 'utf8')
  assert.match(fetcher, /count < 40 \|\| yearlyRows < 30 \|\| fixedRows < 3 \|\| historyRows < 15 \|\| overviewCount < 35 \|\| usageCount < 8/)
})

test('演习页的「日」按 JST 切,资源等本地日的账不受牵连', () => {
  // 2026-08-20 用户拍板。场次判定一直按 JST(practiceSessionOf → jstHourOf),
  // 日卡却按本地自然日切 —— 本机 UTC+8,JST 日界落在本地 23:00,
  // 于是一个晚场会被本地午夜劈成两张卡。日分组/筛选/标签统一到 JST。
  // 判据本身在 src/shared/jst-day.ts,真值在 test/jst-day.test.mjs 里跑。
  const review = fs.readFileSync(new URL('../src/renderer/modules/shi.ts', import.meta.url), 'utf8')
  const practice = review.slice(
    review.indexOf('const practiceViewHtml'),
    review.indexOf('const nodeTimelineHtml'),
  )
  assert.ok(practice.length > 0, '找不到演习视图,护栏没在测它想测的东西')
  assert.match(review, /import \{ fmtJstDate, jstDayStart \} from '\.\.\/\.\.\/shared\/jst-day'/)
  // 分组键、筛选键、标签三处必须是同一把尺;标签走 fmtJstDate 而不是
  // kernel 的 fmtDate —— 后者按本地日历念,UTC+8 下会把日卡标成前一天
  assert.match(practice, /const day = jstDayStart\(row\.ts\)/)
  assert.match(practice, /jstDayStart\(row\.ts\) !== selectedPracticeDay/)
  assert.match(practice, /<time>\$\{fmtJstDate\(day\)\}<\/time>/)
  assert.match(practice, /fmtJstDate\(selectedPracticeDay\)/)
  assert.doesNotMatch(practice, /localDayStart/, '演习视图里还留着本地日分组')
  assert.doesNotMatch(practice, /fmtDate\(/, '演习视图的日期标签还在按本地日历念')
  // 刷新时「选中的日卡还在不在」也得同尺,否则一刷新选中态就被判定为消失
  assert.match(review, /row\.practice && jstDayStart\(row\.ts\) === selectedPracticeDay/)
  // 战斗记录列的日轴是**一个**坐标系,不是两个能各自拨的开关:
  // 演习那列按 JST 日 + 拆早晚场,出击快照列仍按本地自然日、不拆场次
  assert.match(review, /type HistoryDayAxis = 'local' \| 'jstSession'/)
  assert.match(review, /groupByDay\(rows, jst \? jstDayStart : localDayStart\)/)
  assert.match(review, /\$\{jst \? fmtJstDate\(group\.day\) : fmtDate\(group\.day\)\}/)
  assert.match(review, /battleHistoryHtml\(visible, \(row\) => `演习 · [^`]*`, 'jstSession'\)/)
  // 资源视图的本地自然日是另一条口径,不许被这次改动顺手带走
  assert.match(review, /按本地自然日/)
  // 2026-08-23 起这把尺搬去了 shared/local-calendar（主进程的逐日聚合要用同一把），
  // 史这边改成 import——但它仍然必须是**本地自然日**那一把，不能顺手换成 JST
  assert.match(review, /import \{ localDayStart \} from '\.\.\/\.\.\/shared\/local-calendar'/)
})

test('等级排序的同级次序固定「快升级的在前」,不随升降序翻转', () => {
  // 2026-08-20 用户拍板。原先次键 expNext 写在 SORTERS.lv 里,被外层的
  // `sortDir * sorter(...)` 一起翻掉:等级列默认降序,于是同级里排在前面的
  // 反而是刚升完级、离下一级最远的那批。「谁快升级」跟看升序降序无关。
  const roster = fs.readFileSync(new URL('../src/renderer/modules/qa.ts', import.meta.url), 'utf8')
  assert.match(roster, /lv: \(a, b\) => a\.ship\.lv - b\.ship\.lv,/)
  assert.doesNotMatch(
    roster,
    /lv: \(a, b\) => a\.ship\.lv - b\.ship\.lv \|\| a\.ship\.expNext/,
    '次键又被塞回主键里,会跟着 sortDir 一起翻',
  )
  assert.match(roster, /const TIE_BREAKERS: Record<string, \(a: Row, b: Row\) => number> = \{\s*\n\s*lv: \(a, b\) => a\.ship\.expNext - b\.ship\.expNext,/)
  // 主键乘 sortDir、次键不乘 —— 这一行就是整条口径
  assert.match(roster, /rows\.sort\(\(a, b\) => state\.sortDir \* sorter\(a, b\) \|\| \(tie \? tie\(a, b\) : 0\)\)/)
  // 列表与导出必须共用这一次排序,否则 CSV 里的顺序跟屏幕上不一样
  assert.equal(
    (roster.match(/^\s*sortRows\(\w+\)$/gm) ?? []).length,
    2,
    '列表与导出这两个排序入口不再共用同一份口径',
  )
  assert.doesNotMatch(roster, /\.sort\(\(a, b\) => state\.sortDir \* sorter\(a, b\)\)/, '又有人在调用点自己拼排序了')
})

test('装备仓库「锁」列排的是锁定件数;dupe 退到清理入口的默认轴', () => {
  // 2026-08-20 用户拍板。表头「锁」原先挂的是 dupe(同款件数):点「锁」却按
  // 件数重排,列与轴对不上。dupe 没删 —— openEquipCleanup 仍按它排,
  // 且存档恢复靠 SORTERS[saved.sortKey] 认它,从 SORTERS 里拿掉会让老存档失效。
  const stock = fs.readFileSync(new URL('../src/renderer/modules/equip-stock.ts', import.meta.url), 'utf8')
  assert.match(stock, /\['locked', 'lk cx', '锁'\]/)
  assert.doesNotMatch(stock, /\['dupe', 'lk cx', '锁'\]/, '「锁」列又挂回件数轴了')
  assert.match(stock, /locked: \(a, b\) => a\.locked - b\.locked,/)
  assert.match(stock, /dupe: \(a, b\) => a\.rows\.length - b\.rows\.length,/, 'dupe 轴被删了,老存档会失效')
  // 首击让未锁的浮上来:写成升序 + 首击 sortDir=1,箭头 ▴ 与「件数由少到多」对得上
  assert.match(stock, /state\.sortDir = key === 'name' \|\| key === 'type' \|\| key === 'locked' \? 1 : -1/)
  // 清理入口的默认轴仍是 dupe,且仍不写进持久化(一次性意图)
  const cleanup = stock.slice(
    stock.indexOf('从抬头的装备容量点进来'),
    stock.indexOf('export const mountStockView'),
  )
  assert.match(cleanup, /state\.sortKey = 'dupe'/)
  assert.doesNotMatch(cleanup, /saveView\(\)/)
  // 注释与实现同口径:dupe 数的是**筛选后**的件数(group.rows.length),
  // 不是这一款的持有总数(group.owned)。原注释写成「按同款持有数排」,
  // 读注释的人会以为它读 owned。文字对不上实现,下一个人就会照注释「修」实现。
  assert.match(cleanup, /当前筛选后剩下的件数/)
  assert.match(cleanup, /group\.rows\.length/)
  assert.doesNotMatch(cleanup, /按同款持有数排/)
})

test('手机推送：默认全关、目标可选（ntfy 默认 / Bark 次选）、出网只在主进程、失败标注不许自激', () => {
  const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const lg = read('../src/renderer/modules/lg.ts')
  const yu = read('../src/renderer/modules/yu.ts')
  const push = read('../src/main/push.ts')
  const ntfy = read('../src/shared/ntfy-payload.ts')
  const pushConfig = read('../src/shared/push-config.ts')
  const main = read('../src/main/index.ts')
  const html = read('../src/renderer/index.html')
  const pushCode = strip(push)

  // —— 出网只有主进程那一处 ——
  // 渲染层拿得到地址（要显示在钥的输入框里），但从头到尾不发一个网络请求。
  const rendererDir = new URL('../src/renderer/', import.meta.url)
  const offenders = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir)
      if (entry.isDirectory()) walk(child)
      else if (entry.name.endsWith('.ts') && /(?<![.\w])fetch\s*\(/.test(fs.readFileSync(child, 'utf8'))) {
        offenders.push(entry.name)
      }
    }
  }
  walk(rendererDir)
  assert.deepEqual(offenders, [], '渲染层自己发起了网络请求；推送出网只许在 main/push.ts')
  assert.match(lg, /ipcRenderer\s*\n?\s*\.invoke\('push:send'/, '铃不再经由主进程发推送')
  assert.match(push, /ipcMain\.handle\('push:send'/)
  assert.match(main, /require\('\.\/push'\)/, '推送模块没在主进程入口接线')

  // —— 两种目标，构造分开、出网合一 ——
  // 加目标不该增加出网点：两条分支各自造出同一种 PushRequest，只有一处 fetch。
  assert.match(push, /const prepareNtfy = \(/)
  assert.match(push, /const prepareBark = \(/)
  assert.match(
    push,
    /settings\.provider === 'bark'\s*\n\s*\? prepareBark\(settings, notification\)\s*\n\s*: prepareNtfy\(settings, notification\)/,
    '目标分发不见了，或默认落到了 Bark（安卓装不了 Bark）',
  )
  // 出网走**应用自己的网络栈**（2026-08-23 全出口合规审计裁定）：Node 的全局 fetch
  // 用 Node 自己那套栈，会绕开玩家配的代理——全仓其余出口都在 Chromium 网络栈上。
  assert.match(push, /await net\.fetch\(request\.url, \{/)
  assert.equal((pushCode.match(/fetch\(/g) ?? []).length, 1, '出网点不止一处')
  assert.equal(
    /(?<![.\w])fetch\s*\(/.test(pushCode),
    false,
    '推送又用回了 Node 的全局 fetch（绕过玩家配的代理）',
  )

  // —— 默认全关 + 默认目标是 ntfy ——
  assert.match(push, /if \(!settings\.enabled\) \{[\s\S]{0,200}skipped: true/)
  // 频道名/地址没填 → skipped（那是「还没配」，不是失败）
  assert.match(pushCode, /if \(!topic\.value\) return notSent\(topic\.error!, topic\.empty\)/)
  assert.match(pushCode, /if \(!endpoint\.value\) return notSent\(endpoint\.error!, endpoint\.empty\)/)
  // 开着加密却拿不出合法密钥时必须失败，**不许退回明文**
  assert.match(
    push,
    /if \(settings\.barkEncrypt && !isValidPushKey\(settings\.barkKey\)\) return notSent\(PUSH_KEY_ERROR\)/,
  )
  // 用不用加密只看那个开关，绝不许「密钥不合法就自动降级成明文」
  assert.match(push, /encryptKey: settings\.barkEncrypt \? settings\.barkKey : null/)
  // 一次一发，绝不重试。注释里写着「绝不重试」四个字，所以查的是剥掉注释的代码。
  assert.doesNotMatch(pushCode, /for \(let attempt|retry|重试/, '推送里出现了重试')
  assert.match(push, /PUSH_TIMEOUT_MS = 10000/)
  assert.match(push, /setTimeout\(\(\) => controller\.abort\(\), PUSH_TIMEOUT_MS\)/)
  // 日志里只写主机名：完整地址那串设备码/频道名等同于密码
  assert.match(push, /pushEndpointHost\(request\.url\)/)
  assert.doesNotMatch(pushCode, /console\.\w+\([^)]*\$\{request\.url\}/, '把带频道名的完整地址写进日志了')
  assert.doesNotMatch(pushCode, /console\.\w+\([^)]*(ntfyTopic|barkKey)/, '频道名/密钥进日志了')

  // —— ntfy：中文标题必须编码，否则 node 的 fetch 在发出去之前就抛 ——
  assert.match(ntfy, /=\?UTF-8\?B\?\$\{Buffer\.from\(value, 'utf8'\)\.toString\('base64'\)\}\?=/)
  assert.match(ntfy, /'x-title': encodeNtfyHeader\(notification\.title\)/, '标题没走 RFC 2047 编码')
  assert.match(ntfy, /'x-priority'/)
  // 用 X- 规范名：服务端按 x-title/title/t 顺序取，而裸 Priority 会撞上 RFC 9218
  assert.doesNotMatch(ntfy, /headers\.title =|'title':/, '用了裸 Title 头')
  assert.doesNotMatch(ntfy, /headers\.priority =|'priority':/, '用了裸 Priority 头（会撞 RFC 9218）')
  // 频道名即口令：生成的必须够长，且走那个统一的无易混字符发生器
  assert.match(pushConfig, /NTFY_TOPIC_LENGTH = (2[0-9]|[3-9][0-9])/, '生成的频道名短于 20 位')
  assert.match(ntfy, /randomPushToken\(NTFY_TOPIC_LENGTH\)/, '频道名没走那个统一的随机发生器')
  assert.match(push, /ipcMain\.handle\('push:generate-topic'/)
  assert.match(push, /ipcMain\.handle\('push:generate-key'/)

  // —— 配置一律按叶子路径读写 ——
  for (const [name, src] of [['main/push.ts', push], ['modules/yu.ts', yu], ['modules/lg.ts', lg]]) {
    assert.doesNotMatch(
      src,
      /config\.(get|set)\(\s*'kanso\.push(\.ntfy|\.bark)?'\s*[,)]/,
      name + ' 整对象读写了 kanso.push',
    )
  }
  assert.match(push, /readPushSettings\(\(path, fallback\) => config\.get\(path, fallback\)\)/)
  assert.match(yu, /readPushSettings\(\(path, fallback\) => config\.get\(path, fallback\)\)/)
  assert.match(yu, /config\.set\(PUSH_CONFIG_PATHS\[field\], pushInput\.value\.trim\(\)\)/)

  // —— 铃的推送列：默认只开四类「时刻」，且每个事件都显式写出 push ——
  // 逐个写出来是关键：漏写会让旧存档合并（{...默认, ...存档}）后拿到
  // push: undefined，路由判定就从「按默认」滑成「随机地关着」。
  const rulesBlock = lg.slice(lg.indexOf('const DEFAULT_RULES'), lg.indexOf('// 可就地调的参数'))
  const pushColumn = [...rulesBlock.matchAll(/^\s*(\w+): \{[^}]*push: (true|false)/gm)].map(
    ([, id, value]) => [id, value === 'true'],
  )
  assert.equal(pushColumn.length, 13, '有事件没写 push 这一列')
  assert.deepEqual(
    pushColumn.filter(([, on]) => on).map(([id]) => id).sort(),
    ['build', 'dock', 'expedition', 'pracRefresh'],
    '推送默认开的事件集变了：只该是远征返港/入渠/建造/演习刷新这四个「时刻」',
  )
  // 旧存档合并：非大破按 {...默认, ...存档} 走（缺 push 键 = 该事件的默认值）；
  // 大破的本机四路仍锁死，但它的推送归用户，缺键按 false。
  assert.match(
    lg,
    /rules\[k\] = k === 'taiha' \? \{ \.\.\.rules\[k\], push: v\?\.push === true \} : \{ \.\.\.rules\[k\], \.\.\.v \}/,
    '旧存档合并口径变了：大破的推送必须缺键即关，本机四路仍不许被存档关掉',
  )
  assert.doesNotMatch(lg, /if \(rules\[k\] && k !== 'taiha'\)/, '大破整条被跳过，推送列就存不下来了')

  // —— 推送不跟勿扰、不合并、不被强制提醒带着走 ——
  // （在场门槛是另一回事：那一档不出网、进补发队列，守卫在下面那条测试里）
  // demo 是 ▶ 测试通知那一档（纯演示，不出网）；行为级的守卫在 test/lg-demo-notify.test.mjs
  assert.match(lg, /if \(routed\('push'\) && !demo\) pushOrHold\(notice, title, detail, displayDef\.label\)/)
  assert.doesNotMatch(lg, /routed\('push'\) \|\| blocking/, '强制提醒把推送一并打开了')
  assert.doesNotMatch(
    lg,
    /interface HeldNotice \{[^}]*push/,
    '暂留队列里出现了 push——推送要事件发生即发，不许攒到归港再一口气推',
  )
  // 强制提醒锁死的只是本机四路，推送那一格照常可点
  assert.match(lg, /if \(def\.locked && key !== 'push'\) return '<span class="dot lock"><\/span>'/)

  // —— 失败标注绝不许再触发推送（自激防线）——
  const failHandler = lg.slice(lg.indexOf('const markPushFailed'), lg.indexOf('let pushEnabledHint'))
  assert.ok(failHandler.length > 0, '找不到推送失败的标注函数')
  assert.doesNotMatch(failHandler, /notify\(/, '失败标注里又发了一条通知——那条会再次命中推送路由，一路自激')
  assert.doesNotMatch(failHandler, /sendNoticePush\(/, '失败标注里又发了一次推送')
  assert.match(failHandler, /notice\.pushError = message/)
  assert.match(lg, /const sendNoticePush = \(\s*\n?\s*notice: Notice/, '找不到推送发送函数')
  // 出网入口仍然只有一处：铃里 invoke('push:send') 就这一次，
  // 首发与补发都从它过（补发另开一条 invoke = 绕过主进程那道在场门槛）。
  assert.equal(
    (strip(lg).match(/\.invoke\('push:send'/g) ?? []).length,
    1,
    "铃里 invoke('push:send') 不止一处：补发绕过了统一的发送路径",
  )
  // 调 sendNoticePush 的只有两处：notify 那一路（pushOrHold）与补发循环。
  assert.equal(
    (strip(lg).match(/sendNoticePush\(/g) ?? []).length,
    2,
    '发推送的入口变了：只该是 notify 的 pushOrHold 与离场补发这两处',
  )
  assert.equal(
    (strip(lg).match(/pushOrHold\(/g) ?? []).length,
    1,
    'pushOrHold 被多处调用：事件发生即发只该由 notify 触发一次',
  )
  // 「没开/没填地址」不是失败，不许在记录上栽一行红字
  assert.match(lg, /if \(result\?\.ok \|\| result\?\.skipped\) return/)
  assert.match(lg, /n\.pushError \? `<span class="pusherr"/)
  assert.match(html, /\.mod-lg \.nrow \.tx \.pusherr \{/)
  // 铃里那份总开关只用来显示，不许拿它挡发送（判定权在主进程，两处会分家）
  assert.match(
    lg,
    /let pushEnabledHint = config\.get\(PUSH_CONFIG_PATHS\.enabled, PUSH_DEFAULTS\.enabled\) === true/,
  )
  assert.doesNotMatch(lg, /pushEnabledHint && routed|routed\('push'\) && pushEnabledHint/, '铃里长出了第二道推送门')

  // —— 钥的配置卡：安卓/ntfy 主叙事，Bark 收成次级选项 ——
  // 标签只写平台和目标名。艦素是要发布的产品，设置界面不许假定用的人是谁——
  // 「（家人）」这种只有作者自己看得懂的括注属于个人语境，回潮一次就被下面那条抓住。
  assert.match(yu, /\['ntfy', '安卓 · ntfy'\],\s*\n\s*\['bark', 'iOS · Bark'\],/, 'ntfy 不再是首选项')
  const pushCard = yu.slice(yu.indexOf('const PUSH_PROVIDER_LABELS'), yu.indexOf('const render ='))
  assert.ok(pushCard.length > 0, '找不到推送配置卡')
  assert.doesNotMatch(pushCard, /家人/, '推送卡文案又出现了「家人」这类个人语境的措辞')
  assert.match(yu, /data-push-provider="\$\{id\}"/)
  assert.match(yu, /<b>使用步骤<\/b>：① 安装 <b>ntfy<\/b>/)
  assert.match(yu, /订阅同名频道/)
  // 服务器 2026-08-23 起没有预置值了，上手步骤必须把「自己填」这一步说出来，
  // 否则玩家照着走完三步却一条也收不到（框是空的，压根没有目标）
  assert.match(yu, /填写服务器与频道名/)
  assert.match(yu, /placeholder="\$\{esc\(NTFY_SERVER_PLACEHOLDER\)\}"/, 'ntfy 服务器格又被填上默认值了')
  assert.match(yu, /data-act="push-gentopic"/)
  assert.match(yu, /data-act="push-genkey"/)
  assert.match(yu, /data-act="push-test"/)
  assert.match(yu, /ipcRenderer\.invoke\('push:generate-topic'\)/)
  assert.match(yu, /ipcRenderer\s*\n?\s*\.invoke\('push:send'/, '测试按钮没走真实推送路径')
  // ntfy 没有端到端加密这件事必须直说，而且那个开关要显式挂成不可用——
  // 静默忽略会让用户以为内容是加密的。
  // 2026-08-26 文案清扫撤了行内 <b> 强调（族 9），这句话本身照旧要在
  assert.match(yu, /'ntfy 不支持端到端加密'/)
  assert.match(yu, /内容在服务器端为明文/)
  assert.match(yu, /频道名即口令/)
  assert.match(
    yu,
    // 这条真正要钉的是后面那两个位置参数（value=false, disabled=true）；
    // 说明句的尾巴「不是被忽略了」已按裁定 §11 删，前半句照旧要在，
    // 所以正则只锁到句子开头，后面留活口。
    /'ntfy 不支持端到端加密[^']*',\s*\n\s*false,\s*\n\s*true,/,
    'ntfy 下的加密开关没被挂成不可用（disabled）',
  )
  // 「不会为此向游戏服务器多发一个请求」这句自证清白 2026-08-23 删了；剩下的那半句
  //「发送时机只跟铃的规则走」2026-08-26 也按裁决删了（族 C 末句自我解说）。
  // 它要说的事没变——钥不自己另起一条发送触发——但那从来就该钉实现而不是钉措辞：
  // 钥里 push:send 只有一处（用户手点的测试按钮，带 immediate），真正的时机在铃。
  assert.equal(
    (yu.match(/invoke\(\s*'push:send'/g) ?? []).length,
    1,
    '钥里出现了第二条推送发送路径——发送时机只该由铃的规则决定',
  )
  assert.match(yu, /immediate: true,/, '测试推送不该走在场门槛之外的别的口子')
  // 密钥这件事必须当面说清：备份会把它一起带走
  assert.match(yu, /config\.json<\/span> 包含密钥 · 备份时按账号资料保管/)
  // 只推标题默认开：取反时必须按默认值读，否则第一次点是「开→开」
  assert.match(
    yu,
    /PUSH_CONFIG_PATHS\.barkEncrypt,\s*\n\s*PUSH_CONFIG_PATHS\.titleOnly,\s*\n\s*PUSH_CONFIG_PATHS\.presenceHold,/,
  )
})

test('推送在场门槛：判定在主进程、deferred 不出网、补发按序且再变活跃就停', () => {
  const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const lg = read('../src/renderer/modules/lg.ts')
  const yu = read('../src/renderer/modules/yu.ts')
  const push = read('../src/main/push.ts')
  const pushConfig = read('../src/shared/push-config.ts')
  const pushCode = strip(push)
  const lgCode = strip(lg)

  // —— 判定在主进程，且在出网之前 ——
  // 空闲时间只有主进程读得到（powerMonitor 是主进程模块），比较口径只有
  // shared 的 shouldHoldForPresence 一处：渲染层若自己判，两处迟早分家成两道门。
  assert.match(push, /import \{ ipcMain, net, powerMonitor \} from 'electron'/)
  assert.equal(
    (pushCode.match(/getSystemIdleTime\(\)/g) ?? []).length,
    1,
    '读空闲时间的地方不止一处',
  )
  assert.match(pushCode, /shouldHoldForPresence\(settings, idleSeconds\)/, '门槛判定不见了')
  assert.equal(
    (strip(pushConfig).match(/presenceIdleMinutes\) \* 60/g) ?? []).length,
    1,
    '分钟→秒的换算不止一处：单位口径必须只有 shouldHoldForPresence 那一行',
  )
  // deferred 是与 ok/skipped 并列的第三种结局，且**一个字节都不出网**：
  // 判定必须排在 fetch 之前，出网点也仍然只有那一处。
  assert.match(push, /deferred\?: boolean/, 'PushSendResult 里没有 deferred 这一档')
  assert.match(pushCode, /ok: false,\s*\n\s*deferred: true,/)
  // 先确认两处都在：indexOf 找不到时返回 -1，少了这一句下面那条比较会「以假为真」
  assert.ok(pushCode.includes('shouldHoldForPresence(') && pushCode.includes('await net.fetch('))
  assert.ok(
    pushCode.indexOf('shouldHoldForPresence(') < pushCode.indexOf('await net.fetch('),
    '在场判定排在出网之后：deferred 的那一条已经发出去了',
  )
  assert.equal((pushCode.match(/fetch\(/g) ?? []).length, 1, '出网点不止一处')
  // 读不出空闲时间按「不在电脑前」算：门槛失灵的方向必须是照发，
  // 压着不发等于把提醒静默丢掉。也不许静默吞——日志里要留一行。
  assert.match(pushCode, /IDLE_UNKNOWN_SECONDS = 86400/)
  assert.match(pushCode, /catch \(error\) \{[\s\S]{0,300}console\.warn[\s\S]{0,200}return IDLE_UNKNOWN_SECONDS/)
  // 只读 handle：铃拿它掐补发节拍。它不写配置、不出网。
  assert.match(push, /ipcMain\.handle\('push:idle-seconds', \(\) => systemIdleSeconds\(\)\)/)
  // 门槛只有一个豁免口：钥里用户亲手点的那个测试按钮（他正盯着手机等响）。
  assert.match(pushCode, /if \(raw\.immediate !== true\) \{/, '豁免口松成了真值判断')
  assert.match(yu, /group: 'kuma · 测试',\s*\n\s*immediate: true,/, '测试按钮会被门槛挡住')
  assert.doesNotMatch(lgCode, /immediate/, '铃给自己开了绕过在场门槛的后门')

  // —— 门槛关着 = 行为与今天逐字一致 ——
  // 这一条是真行为测试（test/push-payload.test.mjs 里 shouldHoldForPresence 那条）；
  // 这里守的是「关着时不会有别的代码抢在前面拦一道」：铃只在收到 deferred 时入队。
  assert.equal(
    (lgCode.match(/holdPush\(\{/g) ?? []).length,
    1,
    '进补发队列的入口不止一处',
  )
  assert.match(
    lgCode,
    /if \(outcome === 'deferred'\) holdPush\(\{ notice, title, detail, group, ts \}\)/,
    '进队列的条件不再是「主进程说了 deferred」',
  )

  // —— 补发队列：上限 30、超出丢最老、逐条隔离 ——
  assert.match(lgCode, /const HELD_PUSH_MAX = 30/)
  assert.match(
    lgCode,
    /while \(heldPushQueue\.length > HELD_PUSH_MAX\) \{[\s\S]{0,200}heldPushQueue\.shift\(\)/,
    '补发队列没有上限，或超出时丢的不是最老那条',
  )
  const flush = lgCode.slice(
    lgCode.indexOf('const flushHeldPush'),
    lgCode.indexOf('export const setPushPresence'),
  )
  assert.ok(flush.length > 0, '找不到补发循环')
  assert.match(flush, /try \{[\s\S]{0,400}await sendNoticePush\([\s\S]{0,200}\} catch/, '补发没有逐条隔离')
  // 先出队再发（在飞的那条不留在队列里，免得同一刻的新暂缓把它从底下挤掉），
  // 再变活跃就退回队首并停下：剩余原样留队列，顺序也不乱。
  assert.match(flush, /const held = heldPushQueue\.shift\(\)!/, '补发时在飞的那条还留在队列里')
  assert.match(
    flush,
    /if \(outcome === 'deferred'\) \{\s*\n\s*heldPushQueue\.unshift\(held\)\s*\n\s*break\s*\n\s*\}/,
    '补发途中人回到电脑前却继续推，或把那条丢掉了',
  )
  assert.doesNotMatch(flush, /notify\(/, '补发循环里发了新通知——那条会再次命中推送路由，一路自激')
  assert.match(lgCode, /let flushingHeldPush = false/, '补发没有防重入')

  // —— 补发标题带时距，且时距文本只认 kernel 那一份口径 ——
  assert.match(lgCode, /heldPushTitle\(title, Date\.now\(\) - occurredTs\)/, '补发标题没带时距')
  assert.match(lgCode, /`\$\{title\}（\$\{repairDuration\(heldMs\)\}前）`/, '时距格式化又写了一套')
  assert.match(lg, /repairDuration,/, 'repairDuration 没从 kernel 取')
  assert.match(lgCode, /heldMs >= HELD_PUSH_MARK_MS \? /, '不到一分钟也硬挂「0分前」')

  // —— 补发节拍：每秒 tick 上按 30 秒节流问一次空闲时间 ——
  assert.match(lgCode, /onTick\(pollPushPresence\)/, '补发轮询没挂进装配作用域（重复装配会叠监听）')
  assert.match(lgCode, /const PUSH_IDLE_POLL_MS = 30000/)
  assert.match(lgCode, /if \(now - lastIdlePollTs < PUSH_IDLE_POLL_MS\) return/, '轮询没节流')
  assert.match(lgCode, /if \(!heldPushQueue\.length \|\| flushingHeldPush\) return/, '空队列也在问空闲时间')
  assert.match(lgCode, /\.invoke\('push:idle-seconds'\)/)
  assert.match(lgCode, /idle >= pushIdleSecondsHint/, '跨过阈值的判据写反或单位错了')

  // —— 钥的开关与分钟数：叶子读写、区间同源、默认开 ——
  assert.match(yu, /PUSH_CONFIG_PATHS\.presenceHold,\s*\n\s*'人在电脑前暂缓推送',/)
  assert.match(yu, /min="\$\{PUSH_IDLE_MINUTES_MIN\}" max="\$\{PUSH_IDLE_MINUTES_MAX\}"/, '界面区间没跟 shared 同源')
  assert.match(yu, /config\.set\(PUSH_CONFIG_PATHS\.presenceIdleMinutes, minutes\)/)
  assert.match(yu, /const minutes = clampPushIdleMinutes\(idleInput\.value\)/, '分钟数没过区间收口')
  // 文案要说清判据（键鼠空闲）与补发行为（离开后按序补、带时间标记）。
  // 「判据是全系统键鼠空闲时间」这种施工者句式已按裁定换成第二人称的说法，
  // 语义（按你动没动键鼠判定）不变。
  assert.match(yu, /检测到键鼠操作时暂缓推送/)
  assert.match(yu, /按发生顺序补发/)
  // 「标题带时间标记」原来在铃这边也写了一遍，整段推送机制自白已删；
  // 同一条信息仍由钥的在场门槛说明承担，护栏跟着挪到 yu。
  assert.match(yu, /标题包含「几分前」/)
})

test('应急修理发动：绿色两档横幅，要員与女神分色分文案，与大破共存且压在它上面', () => {
  const lg = fs.readFileSync(new URL('../src/renderer/modules/lg.ts', import.meta.url), 'utf8')
  const html = rendererSource

  // 42/43 这两个 id 已对真实 api_start2 主数据核实（2026-08-20：42 応急修理要員、
  // 43 応急修理女神）。这里钉的是「两档按 43 分岔」，不是凭记忆写的数字。
  assert.match(lg, /const goddess = ship\.repairItemUsed === 43/)
  assert.match(
    lg,
    /bannerTone: goddess \? 'goddess' : 'repair', icon: goddess \? '神' : '修'/,
    '两档没有分家：只靠色号分档，实机上两条横幅并排看会读成同一种绿',
  )
  // 同屏的三条横幅里，同一艘舰不能一处写「铃谷改二」、另一处写「鈴谷改二」
  assert.match(
    lg,
    /const names = taiha\.map\(\(ship\) => entityNamePlain\('ship', ship\.mstId, ship\.name\)\)/,
    '大破横幅的舰名又绕开本地化了：与应急修理横幅同屏时会两种字形',
  )
  // 堆叠次序：应急修理压在大破之上（它包含大破——要員回两成，人通常还是大破态）。
  // 靠 flex order 而不是插入顺序，所以两条横幅谁先到都不影响谁在上面。
  const order = lg.slice(lg.indexOf('const BANNER_ORDER'), lg.indexOf('let eventBannerEffectsEnabled'))
  const ranks = Object.fromEntries(
    [...order.matchAll(/^\s*(\w+): (\d+),/gm)].map(([, tone, rank]) => [tone, Number(rank)]),
  )
  assert.ok(ranks.repair < ranks.danger, '应急修理横幅不再排在大破之上')
  assert.ok(ranks.goddess < ranks.danger, '女神横幅不再排在大破之上')
  assert.ok(ranks.danger < ranks.celebrate)
  assert.match(lg, /el\.style\.order = `\$\{BANNER_ORDER\[tone\]\}`/, '次序没真的写到 DOM 上')
  // 两者必须能共存：应急修理这条不许把大破那条抑制掉（要員发动后仍是大破）
  assert.match(lg, /detectDamecon\(\)\s*\n\s*detectSunk\(\)\s*\n\s*detectTaiha\(\)/)
  const taihaDetector = lg.slice(lg.indexOf('const detectTaiha'), lg.indexOf('// 应急修理（要員 42'))
  assert.doesNotMatch(
    taihaDetector,
    /repairItemUsed/,
    '大破探测又开始看损管了：要員发动后仍是大破，两条横幅必须能共存',
  )

  // 文案口径（wikiwiki 机制，2026-08-20 核实）：本场战斗含夜战都不会再沉，
  // 风险在「继续进击」。不许写成「夜战有击沉风险」——那是错的。
  // 2026-08-26 文案清扫把「（含夜战）」的括注与「第二道保险」的拟物删了，
  // 三条口径本体一条不少：本场不沉 / 已消耗 / 要員发动后她仍是大破。
  assert.match(lg, /击沉保护已生效 · 女神已消耗/)
  assert.match(lg, /击沉保护已生效 · 已消耗/)
  assert.match(lg, /tier === 'heavy' \? ' · 当前仍为大破' : ''/)
  assert.doesNotMatch(lg, /夜战有击沉风险/)
  assert.doesNotMatch(lg, /夜战.{0,8}击沉风险/, '把「夜战还会沉」写进文案了，机制上是错的')
  // 破损档从我们自己算出的 hpEnd 读，不照抄规则文本（battle.ts 目前对要員一律 20%，
  // 没有旗舰 50% 特例——文案宁可跟着自家数字走，也不说界面上没有的数）
  assert.match(lg, /const tier = damageTierOf\(ship\.hpEnd, ship\.hpMax\)/)
  assert.match(lg, /DAMAGE_TIER_WORDS\.ship\[tier\]/, '破损档用词没走 battle-damage 那份单一出处')

  // 即时派发：不等 battleresult。本工作台的哲学是全程先知，不做防剧透。
  const detector = lg.slice(lg.indexOf('const detectDamecon'), lg.indexOf('const dameconNotice'))
  assert.doesNotMatch(detector, /battle\.result/, '应急修理横幅又被推迟到 battleresult 了')
  // 同一舰同一战只报一次（昼战 + 夜战合并会让同一条 repairItemUsed 被看到两遍）
  assert.match(detector, /const signature = `\$\{s\.battleCount\}:\$\{ship\.rosterId \?\? ship\.index\}:\$\{ship\.repairItemUsed\}`/)

  // 总开关仍然管得住：showEventBanner 一处把住 eventBannerEffectsEnabled，
  // 绿色横幅与金/红走同一个门。
  assert.match(lg, /if \(!eventBannerEffectsEnabled \|\| !tone\) return false/)

  // 样式：两档各有底色、上沿高光、呼吸动画与外框光效
  for (const tone of ['repair', 'goddess']) {
    assert.match(html, new RegExp(`\\.lg-banner\\.${tone} \\{`), `.lg-banner.${tone} 没有样式`)
    assert.match(html, new RegExp(`\\.lg-banner\\.${tone}::after`))
  }
  assert.match(html, /lg-banner-jade-pulse/)
  assert.match(html, /lg-banner-jade-bright-pulse/)
  assert.match(html, /body\.lg-frame-jade::after/)
  assert.match(html, /body\.lg-frame-jade-bright::after/)
  assert.match(html, /\.lg-banner\.repair \.copy b \{ color: var\(--damecon-crew\); \}/)
  assert.match(html, /\.lg-banner\.goddess \.copy b \{ color: var\(--damecon-goddess\); \}/)
})

test('ケッコンカッコカリ：一手信号是 path 到达，认不出也照常庆祝，花瓣自己散', () => {
  const lg = fs.readFileSync(new URL('../src/renderer/modules/lg.ts', import.meta.url), 'utf8')
  const kernel = fs.readFileSync(new URL('../src/renderer/kernel.ts', import.meta.url), 'utf8')
  const mgIndex = fs.readFileSync(new URL('../src/main/mg/index.ts', import.meta.url), 'utf8')
  const shipLife = fs.readFileSync(new URL('../src/main/mg/ship-life.ts', import.meta.url), 'utf8')
  const store = fs.readFileSync(new URL('../src/main/mg/store.ts', import.meta.url), 'utf8')
  const html = rendererSource

  // ① 一手信号：主进程按 path 发 cue，不靠渲染层去推「谁的 lv 从 99 跳到 100」
  assert.match(mgIndex, /const MARRIAGE_PATH = '\/kcsapi\/api_req_kaisou\/marriage'/)
  assert.match(store, /'\/kcsapi\/api_req_kaisou\/marriage':/, '归约里的婚礼分支没了')
  assert.doesNotMatch(lg, /lv\s*===?\s*99|>= 100/, '铃里长出了「lv 99→100」这类推断式判据')
  // 「当时等级」的快照必须早于归约：归约跑完那艘舰已经是 Lv100
  assert.ok(
    mgIndex.indexOf('const marriageTarget') < mgIndex.indexOf('const sections = store.handle'),
    '婚前快照取晚了：归约之后再取，「当时等级」就永远是 100',
  )
  // cue 必须晚于状态广播：抢在前面发，横幅点进去看到的还是婚前那份
  assert.ok(
    mgIndex.indexOf('broadcastMarriage({') > mgIndex.indexOf('broadcast(sections)'),
    'cue 抢在状态广播之前发了',
  )
  // 认舰只认 api_id：请求侧优先、响应侧兜底，两个都没有就 null
  assert.match(
    mgIndex,
    /\[Number\(postBody\.api_id\), Number\(\(body as any\)\?\.api_id\)\]\.find\(\(id\) => id > 0\) \?\? null/,
    '认舰口径变了：必须请求侧 api_id 优先、响应侧兜底、都没有就留 null',
  )

  // ② 退订随装配作用域（重试装配不叠一份），派发走隔离
  assert.match(kernel, /export const onMarriage = \(cb: MarriageListener\) => \{\s*\n\s*marriageListeners\.push\(cb\)\s*\n\s*trackForMountScope\(\(\) => removeFrom\(marriageListeners, cb\)\)/)
  assert.match(kernel, /safeEach\('kernel:marriage', marriageListeners/)
  assert.match(kernel, /ipcRenderer\.removeListener\('mg:marriage', onMarriageCue\)/, '初始化失败时没退掉 IPC 监听')
  assert.match(lg, /onMarriage\(detectMarriage\)/)

  // ③ 认不出是哪一艘时**照常庆祝，只是不指名**——绝不猜一艘
  const notice = lg.slice(lg.indexOf('const marriageNotice'), lg.indexOf('// ---- 通知中心面板 ----'))
  // 「报文」这类施工者词与「所以不指名」这半句 UI 自述已按发布侧文案裁定删掉；
  // 2026-08-26 再把文学腔的前半句（「镇守府迎来一场婚礼」）删掉——庆祝由标题承担。
  // 守卫本意不变：认不出时如实说没确认是哪一艘，绝不猜一艘。
  assert.match(notice, /'舰娘身份未确认'/)
  assert.match(notice, /rosterId != null \? \{ type: 'ship', id: rosterId \} : undefined/)
  // 「· 已记入她的人生记录」2026-08-26 按族 7 整句删了（落账与否玩家不必被告知）。
  // 原守卫是「认不出时不许声称落账」；现在两支都不声称，护栏跟着收紧成一律不许。
  assert.doesNotMatch(notice, /已记入她的人生记录/, '认不出时不许声称已经落账')
  // 降级路径不是「不庆祝」：横幅与花瓣照发（notify 与 startWeddingPetals 都在无条件那一段）
  const detector = lg.slice(lg.indexOf('const detectMarriage'), lg.indexOf('// ---- 通知中心面板 ----'))
  assert.doesNotMatch(detector, /if \(.*rosterId.*\) return/, '认不出就整个不庆祝了')
  assert.match(detector, /notify\(\.\.\.marriageNotice\(cue\), \{ bannerTone: 'wedding' \}\)/)
  assert.match(detector, /startWeddingPetals\(\)/)

  // ④ 花瓣：到时自己散（横幅与外框是手动关，两件事有意不同）
  assert.match(lg, /const WEDDING_PETAL_MS = 18_000/)
  assert.ok(
    /const WEDDING_PETAL_MS = (1[5-9]|20)_000/.test(lg),
    '庆祝时长跑出 15~20 秒这个区间了',
  )
  const petals = lg.slice(lg.indexOf('const stopWeddingPetals'), lg.indexOf('const ensureBannerHost'))
  assert.match(petals, /host\.classList\.add\('fading'\)/)
  assert.match(petals, /setTimeout\(stopWeddingPetals, WEDDING_FADE_MS/, '淡出之后没把花瓣层摘掉')
  // 注释里正解释着为什么不用它，所以先把注释剥掉再查代码
  const petalCode = petals.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(petalCode, /transitionend/, '拿 transitionend 收尾：窗口不可见时过渡不跑，花瓣层会永远挂着')
  assert.match(petals, /stopWeddingPetals\(\) \/\/ 连着办两场就重新计时，不叠两层花瓣/)
  // 花瓣只动 transform / opacity（合成器动画），且只落在两侧边带
  const petalCss = html.slice(html.indexOf('#lg-wedding {'), html.indexOf('@media (max-width: 680px)'))
  assert.match(petalCss, /@keyframes lg-wedding-fall/)
  assert.match(petalCss, /transform: translate3d\(var\(--petal-drift\), 118vh, 0\)/)
  assert.match(petalCss, /pointer-events: none/)
  assert.match(petals, /\(rightBand \? 85 : 1\)/, '花瓣不再只落在两侧边带了：中间是游戏画面')

  // ⑤ 两级开关：逐事件的在铃的矩阵里，总闸是 eventBannerEffects——花瓣也归它管
  assert.match(lg, /^\s*marriage: \{ badge: true, toast: true, system: false, sound: false, push: false \},$/m)
  assert.match(petals, /const startWeddingPetals = \(\) => \{\s*\n\s*if \(!eventBannerEffectsEnabled\) return/)
  assert.match(lg, /const clearEventBanners = \(\)[\s\S]{0,220}?stopWeddingPetals\(\)/, '总闸关掉时花瓣没跟着停')
  assert.match(lg, /const closeEventBanner = \(noticeKey: string\)[\s\S]{0,320}?syncWeddingPetals\(\)/, '手动关掉横幅时花瓣没跟着停')

  // ⑥ reduced-motion：花瓣停落，成为静态点缀（不是整个消失）
  const reduced = html.slice(html.indexOf('@media (prefers-reduced-motion: reduce)'))
  assert.match(reduced, /#lg-wedding \.petal \{\s*\n\s*animation: none !important;\s*\n\s*top: var\(--petal-y\); transform: none; opacity: \.62;/)
  assert.match(reduced, /body\.lg-frame-pink::before/, '粉框的呼吸动画没进 reduce 名单')

  // ⑦ 人生记录：新增 kind 与 remodel 同族，且**两处显示都得有自己的分支**——
  // 两个 copy 函数的最后一支都是击沉兜底，
  // 漏了分支就会把婚事显示成这艘舰沉了。
  assert.match(shipLife, /kind: 'marriage'/)
  assert.ok(
    shipLife.indexOf("if (apiPath === '/kcsapi/api_req_kaisou/marriage')") <
      shipLife.indexOf('if (sections.includes(\'ships\')'),
    '婚礼落账排在 syncShipStates 之后了：基线已跟到 Lv100，「当时等级」就说不出来了',
  )
  assert.match(shipLife, /detail: \{ level: prior\?\.level \?\? null \}/, '拿婚后的等级冒充「当时等级」')
  for (const [name, rel, marker, fallback] of [
    // 履历行 2026-08-31 从 qa 挪进 ship-life-events（在籍列表与人生记录弹窗共用一份）
    ['履历行', '../src/renderer/ship-life-events.ts', "event.kind === 'marriage'", "event.kind === 'sunk'"],
    ['ji', '../src/renderer/modules/ji.ts', "event.kind === 'marriage'", "'击沉',"],
  ]) {
    const src = fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
    assert.ok(src.includes(marker), `${name} 没给 marriage 事件写分支——会落进兜底的「被击沉」`)
    assert.ok(
      src.indexOf(marker) < src.indexOf(fallback),
      `${name} 的 marriage 分支排在兜底之后了`,
    )
    assert.match(src, /ケッコンカッコカリ · 当时 Lv \$\{detail\.level \?\? '\?'\}/)
  }
  assert.match(html, /\.mod-qa \.life-event\.marriage \.life-dot \{ background: var\(--wedding\)/)
  assert.match(html, /\.mod-ji \.mem-life-event\.marriage \.dot \{ background: var\(--wedding\)/)
})

test('婚礼台词的字幕按语音槽位精确匹配，不靠时间窗，也不粘在下一句上', () => {
  const subtitle = fs.readFileSync(new URL('../src/renderer/voice-subtitle.ts', import.meta.url), 'utf8')
  const html = rendererSource

  // ① 判据是槽位 24（ケッコンカッコカリ），不是「婚礼报文后 N 秒内该舰的字幕」。
  // 槽位天然只作用于开口的那一艘，也就没有「窗口漂到别人头上」这种失效模式。
  assert.match(subtitle, /const WEDDING_VOICE_SLOT = 24/)
  assert.match(subtitle, /cue\.voiceId === WEDDING_VOICE_SLOT\s*\n\s*\? 'wedding'/)
  assert.doesNotMatch(
    subtitle,
    /marriageAt|weddingUntil|weddingWindow/,
    '字幕染色又退回时间窗了：槽位能精确匹配就不该靠窗口',
  )
  // 28 号槽是「ケッコン後母港」——婚后每次点她都会响，属于日常台词，不染
  assert.doesNotMatch(subtitle, /=== 28|WEDDING_PORT_SLOT/, '把婚后日常母港台词也染粉了')

  // ② 底部字幕是同一个常驻元素反复复用：粉必须逐句摘挂，不能粘在下一句上
  assert.match(subtitle, /host\.classList\.remove\('voice-wedding'\)\s*\n\s*if \(tone === 'wedding'\) host\.classList\.add\('voice-wedding'\)/)
  assert.match(subtitle, /subtitle\?\.classList\.remove\('show', 'voice-wedding'\)/)
  // 婚礼不是伤害轴上的一档，class 名不许混进 dmg- 那一族
  assert.match(subtitle, /tone === 'wedding' \? 'voice-wedding' : `dmg-\$\{tone\}`/)

  // ③ 样式：整条（含舰名）染粉，走 token
  assert.match(html, /#voice-subtitle\.voice-wedding \.voice-subtitle-line \{ color: var\(--wedding\); \}/)
  assert.match(html, /#voice-subtitle\.voice-wedding \.voice-subtitle-speaker \{ color: var\(--wedding-lit\); \}/)
  assert.match(html, /#voice-danmaku \.voice-danmaku-item\.voice-wedding \{ color: var\(--wedding\); \}/)
})

test('友方被击沉：艦素界面失色到返港，游戏画面不动，编队卡碎裂，且可整体关掉', () => {
  const kernel = fs.readFileSync(new URL('../src/renderer/kernel.ts', import.meta.url), 'utf8')
  const lg = fs.readFileSync(new URL('../src/renderer/modules/lg.ts', import.meta.url), 'utf8')
  const fleet = fs.readFileSync(new URL('../src/renderer/modules/ru.ts', import.meta.url), 'utf8')
  const store = fs.readFileSync(new URL('../src/main/mg/store.ts', import.meta.url), 'utf8')
  const sortieRestore = fs.readFileSync(
    new URL('../src/shared/sortie-restore.ts', import.meta.url),
    'utf8',
  )
  const settings = fs.readFileSync(new URL('../src/renderer/modules/yu.ts', import.meta.url), 'utf8')
  const config = fs.readFileSync(new URL('../src/main/config.ts', import.meta.url), 'utf8')
  const html = rendererSource

  // ① 判据从状态推导，且三处共用一份（行为口径的护栏在 test/sortie-mourning.test.mjs）
  assert.match(kernel, /export const sortieSunkShips = \(\): SortieSunkShip\[\] => mourningShipsOf\(mg\.sortie\)/)
  assert.match(kernel, /import \{ mourningShipsOf \} from '\.\.\/shared\/sortie-mourning'/)
  assert.match(store, /import \{ newSunkEntries \} from '\.\.\/\.\.\/shared\/sortie-mourning'/)
  assert.doesNotMatch(
    kernel,
    /mourningLatched|sunkFlagSeen|hasMourned/,
    '哀悼态又被做成一次性标记了——重开界面就恢复不出正确状态',
  )
  // ② 名单在出击上累积，不是只看当前节点那一场（进击到下一格就该忘了）
  assert.match(store, /sortie\.sunkShips\.push\(\.\.\.fresh\)/)
  assert.match(store, /sunkShips: \[\],/, 'newSortie 没给沉没名单立初值')
  // 2026-08-25：回放归位（active 强制 false + sunkShips 补数组）收口成
  // shared/sortie-restore 的 restoreSortieAcrossRestart，好让护栏脱开 Electron 真跑
  //（store.ts 一 import 就会打开真账本并跑迁移）。盯的仍是同一件事：
  // 老快照没有 sunkShips 时补成数组，别把 undefined 丢给渲染层。
  assert.match(store, /const restored = restoreSortieAcrossRestart\(data\.sortie\)/)
  assert.match(
    sortieRestore,
    /sunkShips: Array\.isArray\(sortie\.sunkShips\) \? sortie\.sunkShips : \[\]/,
    '回放归位不再把 sunkShips 补成数组',
  )
  // 即时派发：昼战包、夜战包到达即收，不等 battleresult
  const dayBattle = store.slice(store.indexOf('const onDayBattle'), store.indexOf('const onNightBattle'))
  assert.match(dayBattle, /collectSunkShips\(ts\)/, '昼战包不再即时收沉没名单了')

  // ③ 失色只作用于艦素外壳；游戏画面容器蓄意不在名单里。
  // 扫**全文里每一条**带 kanso-mourning 的选择器，而不是截一段来看：
  // 早先这里按「从 body.kanso-mourning header 那行往后截」来查，结果把
  // `body.kanso-mourning #game-area,` 插在那一行**之前**就查不出来（变异实测漏网）。
  const mourningSelectors = [...html.matchAll(/(body\.kanso-mourning[^,{}]*)\s*[,{]/g)]
    .map(([, selector]) => selector.trim())
  assert.ok(mourningSelectors.length >= 4, `哀悼态选择器只找到 ${mourningSelectors.length} 条`)
  for (const selector of mourningSelectors) {
    for (const forbidden of ['#game-area', '#game-wrapper', 'webview']) {
      assert.ok(
        !selector.includes(forbidden),
        `${forbidden} 被卷进失色名单了（${selector}）——这次出击还得靠游戏画面收尾`,
      )
    }
    // 横幅与 Toast 只能以「被排除」的形式出现
    for (const layer of ['#lg-banners', '#lg-toasts']) {
      assert.ok(
        !selector.replaceAll(`:not(${layer})`, '').includes(layer),
        `${layer} 被卷进失色名单了（${selector}）——哀悼期间照样有要当场处理的提醒`,
      )
    }
  }
  for (const wanted of ['body.kanso-mourning header', 'body.kanso-mourning #element-rail', 'body.kanso-mourning .dock']) {
    assert.ok(mourningSelectors.includes(wanted), `${wanted} 不在失色名单里了`)
  }
  // 挂在 body 上的那一层（大浮层 / 富提示 / 钉住卡）也是艦素界面，反着写才不会漏
  assert.ok(
    mourningSelectors.includes('body.kanso-mourning > *:not(#app):not(#lg-banners):not(#lg-toasts)'),
    'body 直属那一层不再失色了：大浮层/富提示会在灰底上突然彩色',
  )
  const mourn = html.slice(
    html.indexOf('body.kanso-mourning header'),
    html.indexOf('@keyframes lg-frame-breathe'),
  )
  assert.match(mourn, /filter: grayscale\(1\)/)
  // 过渡写在**基础规则**上，否则解除时元素已不匹配 .kanso-mourning，颜色会「啪」地弹回来
  assert.match(html, /transition: filter var\(--motion-solemn\) ease;/)
  assert.match(html, /transition: flex-basis var\(--motion-view\) var\(--motion-ease\), border-color var\(--motion-fast\) ease, filter var\(--motion-solemn\) ease;/)

  // ④ 碎裂卡：判据与失色同源，纯 CSS，不引库
  assert.match(fleet, /const shattered = sunkEffectsEnabled\(\) && isSunkInSortie\(ship\.id\)/)
  assert.match(fleet, /shattered\s*\n?\s*\?\s*' shattered'/)
  assert.match(fleet, /<span class="shatter" aria-hidden="true"><\/span>/)
  assert.match(html, /\.fleet-skin \.ship\.shattered \{/)
  assert.match(html, /\.fleet-skin \.ship\.shattered \.shatter \{/)
  assert.match(html, /@keyframes ru-shatter-in/)

  // ⑤ 一个开关管住两样（失色 + 碎裂），默认开；关掉后击沉照样进通知记录
  assert.match(config, /sunkEffects: true/)
  assert.match(kernel, /let sunkEffectsOn = Boolean\(kernelConfig\.get\('kanso\.sunkEffects', true\)\)/)
  assert.match(
    kernel,
    /document\.body\.classList\.toggle\('kanso-mourning', sunkEffectsOn && sortieSunkShips\(\)\.length > 0\)/,
    '失色没被开关管住',
  )
  assert.match(settings, /击沉哀悼特效/)
  assert.match(settings, /setSunkEffectsEnabled\(next\)/)
  assert.match(settings, /'kanso\.sunkEffects',\n\s*'kanso\.tray\.enabled'/, '默认开的项没进取反白名单：第一次点会「开→开」')
  // 通知那条不受开关影响——开关只管画不画
  const sunkDetector = lg.slice(lg.indexOf('let sunkSeen'), lg.indexOf('// ---- 通知中心面板 ----'))
  assert.doesNotMatch(
    sunkDetector,
    /if \(!sunkEffectsEnabled\(\)\) return/,
    '关掉特效连击沉通知都不发了',
  )
  assert.match(sunkDetector, /notify\(\s*\n?\s*'shipSunk'/)
})

test('新事件的默认路由保守：横幅与记录为主，声音与推送都不默认开', () => {
  const lg = fs.readFileSync(new URL('../src/renderer/modules/lg.ts', import.meta.url), 'utf8')
  const rules = lg.slice(lg.indexOf('const DEFAULT_RULES'), lg.indexOf('// 可就地调的参数'))
  const routeOf = (id) => {
    const row = rules.match(new RegExp(`^\\s*${id}: \\{([^}]*)\\}`, 'm'))
    assert.ok(row, `${id} 没写进默认路由表`)
    return Object.fromEntries(
      [...row[1].matchAll(/(\w+): (true|false)/g)].map(([, key, value]) => [key, value === 'true']),
    )
  }
  assert.deepEqual(routeOf('damecon'), {
    badge: true, toast: true, system: false, sound: false, push: false,
  })
  assert.deepEqual(routeOf('shipSunk'), {
    badge: true, toast: true, system: true, sound: false, push: false,
  })
  // 事件表里两条都在，且都能跳到战斗详情
  const events = lg.slice(lg.indexOf('const EVENTS: EventDef[]'), lg.indexOf('interface Routes'))
  assert.match(events, /id: 'damecon'[^\n]*jump: 'di'/)
  assert.match(events, /id: 'shipSunk'[^\n]*jump: 'di'/)
})

test('战斗特效模拟台只在 KANSO_DEBUG_UI 下存在，且走生产代码路径', () => {
  const debugPanel = fs.readFileSync(new URL('../src/renderer/modules/mgstate.ts', import.meta.url), 'utf8')
  const kernel = fs.readFileSync(new URL('../src/renderer/kernel.ts', import.meta.url), 'utf8')

  assert.match(debugPanel, /const DEBUG_UI = process\.env\.KANSO_DEBUG_UI === '1'/)
  // 发布形态零痕迹：卡片 HTML 与它的点击委托都在门后
  assert.match(debugPanel, /const simCardHtml = \(\): string =>\s*\n\s*DEBUG_UI\s*\n\s*\?/)
  assert.match(debugPanel, /if \(DEBUG_UI\) \{\s*\n[\s\S]{0,220}?pane\.addEventListener\('click'/)
  // 模拟只编输入补丁，探测/排序/失色推导全走真的那一份
  assert.match(kernel, /export const debugApplyPatch = \(patch: MgPatch\) => \{\s*\n\s*if \(process\.env\.KANSO_DEBUG_UI !== '1'\) return\s*\n\s*applyMgPatch\(patch\)/)
  assert.match(debugPanel, /debugApplyPatch\(roster \? \{ sortie, ships: roster \} : \{ sortie \}\)/)
  // 八个入口：大破 / 要員 / 女神 / 两档同屏 / 击沉 / 婚舰 / 婚舰认不出 / 返港
  const actions = debugPanel.slice(debugPanel.indexOf('const SIM_ACTIONS'), debugPanel.indexOf('const simCardHtml'))
  assert.deepEqual(
    [...actions.matchAll(/\[\s*'([a-z-]+)',/g)].map(([, id]) => id),
    ['taiha', 'crew', 'goddess', 'both', 'sunk', 'wedding', 'wedding-anon', 'port'],
  )
  // 婚舰那两个入口也只编输入：一条 cue 走内核的真派发，字幕走取词/染色的生产路径。
  // 字幕那一路必须在场——戒指不可再生，「粉色档到底什么样」只能靠模拟看。
  assert.equal(
    (actions.match(/debugEmitMarriage\(\{/g) ?? []).length,
    2,
    '婚舰模拟没走内核那条 cue：认得出与认不出两条路都得从真派发过一遍',
  )
  assert.match(actions, /simWeddingVoice\(/, '婚舰模拟少了字幕染粉那一路，粉色档就没法验收')
  assert.match(
    kernel,
    /export const debugEmitMarriage = \(cue: MarriageCue\) => \{\s*\n\s*if \(process\.env\.KANSO_DEBUG_UI !== '1'\) return\s*\n\s*dispatchMarriage\(cue\)/,
    '婚舰模拟没走内核那条真的派发（报文到达与模拟必须同一条路）',
  )
  const subtitle = fs.readFileSync(new URL('../src/renderer/voice-subtitle.ts', import.meta.url), 'utf8')
  assert.match(
    subtitle,
    /export const debugShowVoiceCue = \(cue: VoiceRequestCue\) => \{\s*\n\s*if \(process\.env\.KANSO_DEBUG_UI !== '1'\) return\s*\n\s*void ensureData\(\)\.then\(\(\) => displayAtPlaybackTime\(cue\)\)/,
    '字幕模拟绕开了 captionsFor/displayAtPlaybackTime 这条生产路径',
  )
})

// 2026-08-20 第二批发布侧文案裁定（用户看图鉴属性区「敌我固定标尺 · kcwiki 中文数据 ·
// 三维上限取游戏一手」拍板）：「出处署名 + 标尺/方法声明」类常驻脚注全部撤出发布面，
// 理由是钥的矿脉面板已有统一声明。删的是**署名与方法**，留的是**口径与诚实标注**——
// 所以这条护栏必须双向钉：署名不许回潮，口径也不许被顺手删掉。
test('发布侧不挂出处署名与标尺声明，但口径与诚实标注一个不少', () => {
  // 行注释（含行尾的）与块注释里写出处是对的——机制与考据只活在源码注释里，
  // 这条护栏只管渲染出去的文案，所以先把注释剥干净再断言。
  // 行尾那一刀避开 `https://`（前面是冒号），这几个文件里的字符串字面量都不含 //。
  const readCode = (rel) =>
    fs
      .readFileSync(new URL(rel, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*$/gm, '$1')

  const catalog = readCode('../src/renderer/modules/ji.ts')
  const battle = readCode('../src/renderer/modules/di.ts')
  const fleet = readCode('../src/renderer/modules/ru.ts')
  const resource = readCode('../src/renderer/modules/zi.ts')
  const expedition = readCode('../src/renderer/modules/bi.ts')
  const bars = readCode('../src/renderer/stat-bars.ts')
  const abilities = readCode('../src/shared/ship-special-attack.ts')

  // ---- 删：常驻署名 / 标尺声明 / 独立成句的方法声明 ----
  for (const [name, source, gone] of [
    ['ji', catalog, [
      /敌我固定标尺/, /三维上限取游戏一手/, /与舰娘属性使用同一固定标尺/,
      /kcwiki 中文数据/, /kcwiki 未收录此形态/, /EO 数据/, /EO 的加成/, /按 EO 规则/,
      /EO 自注/, /原表出处/, /来源 tsunkit/, /Lv99 上限：wikiwiki/, /初始值：wikiwiki/,
      /kcwiki 台词翻译表/, /场景与译文均来自 kcwiki/, /规则来自 wikiwiki/,
      /路线图来自 poi 海图包/,
    ]],
    ['di', battle, [
      /按 wikiwiki 胜利条件计算/, /出处 wikiwiki/, /按 kcwiki「对陆补正」/,
      /按 wikiwiki「戦闘について」/, /海图 poi fcd/, /胜负按 wikiwiki 规则计算/,
    ]],
    ['ru', fleet, [/zh\.kcwiki 练级指南/, /计算规则参考 wikiwiki/, /依据：战斗计算模型/, /依据：33 式/]],
    ['zi', resource, [/wikiwiki 称号・戦果/, /月別ボーダー遷移/]],
    ['bi', expedition, [/含 wiki 变体/]],
    ['stat-bars', bars, [/固定标尺/]],
    ['ship-special-attack', abilities, [/据 wikiwiki 2026-08-07/]],
  ]) {
    for (const pattern of gone) {
      assert.doesNotMatch(source, pattern, `${name}: 出处署名/标尺声明回潮了 ${pattern}`)
    }
  }

  // ---- 留：结果口径、估算标注、空态诚实语（删署名时最容易被连坐的一批）----
  // 2026-08-26 文案清扫按裁定删了其中三句（「演习专用口径…」那段规则复述、
  // 「实际值可能再多 0～3」、「未计入鬼怒改二等单舰特殊加成」——族 3 玩家常识）。
  // 「防连坐」这条纪律本身不放松：口径半句照钉，估算标注/空态/读数前提换成这批之后
  // 仍在的锚点继续钉。
  assert.match(battle, /判定来源：游戏结算/)
  assert.match(battle, /p\.sure \? '' : '（估算）'/)
  assert.match(battle, /本地资料待更新/)
  assert.match(fleet, /到达扬陆点时大破的舰娘及其装备一律不计/)
  // 2026-08-26 文案清扫把中段自证（「游戏不下发战果数值，这里是按公式换算」）删了，
  // 「算出来的值与排名页对不齐」这条读数前提照钉（措辞缩成「游戏排名页」）
  assert.match(resource, /与游戏排名页可能有小数差/)

  // ---- 留：出处收纳机制本体（lodeCredit 悬停 + 图鉴那块收起的「资料来源与新鲜度」）----
  const kernel = fs.readFileSync(new URL('../src/renderer/kernel.ts', import.meta.url), 'utf8')
  assert.match(kernel, /export const lodeCreditMark = \(meta: LodeMeta, extra = ''\)/)
  assert.match(kernel, /class="credit-mark"/)
  assert.match(catalog, /<summary>资料来源与新鲜度<\/summary>/)

  // ---- 留：悬停里的刻度是坐标轴不是声明（0—cap 与「已超出刻度」都要在）----
  assert.match(bars, /\$\{label\}刻度 0—\$\{cap\}/)
  assert.match(bars, /已超出刻度/)
  assert.match(catalog, /\$\{label\}刻度 0—\$\{cap\}/)
})

// 2026-08-21 第三批发布侧文案裁定（总判据定稿：「这句话展示出来，玩家玩游戏的时候
// 需不需要直接看」）。三去处，护栏按去处分三段钉：
//   ① 数值旁的单短标注与当下状态（估算/推定/未同步/读取失败/空态）→ 常驻不动；
//   ② 句子型严谨说明 → 折叠或悬停。所以下面钉的是**宿主**：话还在，但必须在
//      foldedNote / title= / lodeCreditMark 的 extra 里，而不是常驻 div；
//   ③ 新鲜度/停更/来源健康 → 只在钥（设置）里说一次，模块里一句都不许有。
// 反向验证做过：把任一句挪回常驻 div、或把钥那行删掉，这条都会红。
test('第三批：严谨说明只在折叠/悬停里，停更与新鲜度只在钥里', async () => {
  const readCode = (rel) =>
    fs
      .readFileSync(new URL(rel, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*$/gm, '$1')

  const catalog = readCode('../src/renderer/modules/ji.ts')
  const battle = readCode('../src/renderer/modules/di.ts')
  const event = readCode('../src/renderer/modules/du.ts')
  const expedition = readCode('../src/renderer/modules/bi.ts')
  const quests = readCode('../src/renderer/modules/qn.ts')
  const review = readCode('../src/renderer/modules/shi.ts')
  const resource = readCode('../src/renderer/modules/zi.ts')
  const settings = readCode('../src/renderer/modules/yu.ts')
  const tree = readCode('../src/renderer/quest-tree-window.ts')

  // ---- ② 句子型严谨说明：话在，但宿主必须是折叠或悬停 ----
  for (const [name, source, hosted] of [
    // 2026-08-26 文案杂音清扫：ji 这一格原有的四条折叠与三条悬停整句删了
    //（「未列出 ≠ …」折叠族、出货率口径折叠、「不拿路线终点冒充」、
    //「这是本机的聚合记录…」）——那批是防守性免责，不再收进悬停而是根除。
    // 剩下的都是真读数前提，宿主仍必须是折叠或悬停：本条的语义没放松，
    // 反而多钉了三处这次新收进悬停的（下面后三条），防它们哪天又摊回常驻。
    ['ji', catalog, [
      /title="以本地装备后面板为准"/,
      /lodeCreditMark\([\s\S]{0,80}?'匿名实测频率 · 非游戏硬规则；确定带路条件见下方规则及实际罗盘'/,
      // 2026-08-22 反推扩到七项，这句口径跟着重写（宿主仍是悬停，不许挪回常驻）
      /title="回避\/对潜\/索敌按成长端点与等级插值；主炮适重与命中不进面板，无法推定">口径<\/span>/,
      /title="普通消耗用于可行性判断，确保成功时以上限为准">口径<\/span>/,
      // 这次新收进悬停的三处
      /title="差值就是这一件（含改修★）的加成"/,
      /title="最终面板 · 等级\/士气\/补给 · 装备属性\/★改修\/熟练度\/搭载 · 深海数值与装备"/,
      /title="名称 · 游戏基础数据 · 库存按资源 \/ 提督状态 \/ 装备 \/ 道具四域合并">源<\/span>/,
    ]],
    // di：「未列出 ≠ 确认不掉」那句 2026-08-26 按族 4 整句根除（见下方 doesNotMatch）；
    // 同批把「默认阵形」那句长脚注折进了悬停，改钉它——新收进来的更要防摊回常驻
    ['di', battle, [
      /class="l prebattle-note">默认阵形 <span class="credit-mark" title="水面战默认单纵阵（联合第四）、纯潜水编成默认单横阵（联合第一）">口径<\/span>/,
    ]],
    ['du', event, [
      /title="「某难度追加」是在共通之上的追加份">口径<\/span>/,
      /title="判定来源：游戏内提示">口径<\/span>/,
      /title="含远征、任务与日常消耗">口径<\/span>/,
      /title="完成判定来源：游戏内提示音与动画">口径<\/span>/,
    ]],
    ['bi', expedition, [
      /title="示例编成不代表成功条件或最优方案">口径<\/span>/,
      /title="属性合计包含舰载机数值 · 与判定值口径不同">口径<\/span>/,
    ]],
    // qn 这三条 2026-08-26 第三批清扫：前两条缩短后仍住在悬停里（照钉，措辞跟着改），
    // 第三条「这一格只显示游戏自报的粗档」是能力边界表白，整句根除，改钉下方 doesNotMatch
    ['qn', quests, [
      /title="只比较当前实际持有量">口径<\/span>/,
      /title="持有条件仅表示备齐">口径<\/span>/,
    ]],
    // shi 这两句 2026-08-26 从「收进悬停」升级成「整句根除」（族 2 自证清白 / 族 6），
    // 所以不再有可钉的宿主——改成下面更紧的 doesNotMatch：任何位置都不许再出现
    ['shi', review, []],
    // zi 这两条 2026-08-26 第三批清扫缩短后仍住在悬停里（中段自证与免责半句删掉）
    ['zi', resource, [
      /title="期初期末差额，含远征、任务与日常操作">口径<\/span>/,
      /title="通常 = 该月提督经验 ×7\/10000；[^"]*与游戏排名页可能有小数差">口径<\/span>/,
    ]],
    ['quest-tree', tree, [/title="状态只使用本机已同步记录；未同步不等于未完成">口径<\/span>/]],
  ]) {
    for (const pattern of hosted) {
      assert.match(source, pattern, `${name}: 这句严谨说明不在折叠/悬停里了 ${pattern}`)
    }
  }

  // 反向：原来那几行常驻容器不许回潮（它们是这批话的旧住址）
  assert.doesNotMatch(catalog, /class="hunt-foot"/, 'ji: 「未列出 ≠ 确认不掉」又铺回常驻脚注了')
  assert.doesNotMatch(battle, /class="l dp-note"/, 'di: 掉落口径又铺回常驻脚注了')
  assert.doesNotMatch(resource, /class="senka-foot"/, 'zi: 战果换算口径又铺回常驻脚注了')
  assert.doesNotMatch(review, /class="shi-note">这是本机记录/, 'shi: 演习口径又铺回常驻脚注了')
  assert.doesNotMatch(catalog, /class="index-foot">普通消耗/, 'ji: 改修可行性口径又铺回索引脚注了')
  assert.doesNotMatch(quests, /(?:艦素|kuma) ?不猜/, 'qn: 产品自述（七之二）又回来了')
  // 2026-08-26 文案清扫：这三句从「收进悬停」升级为「整句根除」，改钉不许回潮
  assert.doesNotMatch(battle, /未列出不等于确认不会掉/, 'di: 「未列出 ≠ 确认不掉」又回来了')
  assert.doesNotMatch(review, /不代表游戏服务器的永久战绩/, 'shi: 演习口径的自证句又回来了')
  assert.doesNotMatch(review, /不代表全服概率/, 'shi: 出货率的自证句又回来了')
  // 2026-08-26 第三批清扫：这几句从「收进悬停」升级为「整句根除」，一样钉不许回潮
  assert.doesNotMatch(quests, /只显示游戏自报的粗档/, 'qn: 「这一格只显示粗档」的能力边界表白又回来了')
  assert.doesNotMatch(quests, /只读检查当前各舰队/, 'qn: 「不自动编成」的只读表白又回来了')
  assert.doesNotMatch(resource, /下面的数字都取不到/, 'zi: 失败态的解释尾巴又回来了')
  assert.doesNotMatch(resource, /数据来自本地事件记录/, 'zi: 右栏页脚的自证清白又回来了')
  assert.doesNotMatch(resource, /提督经验的历史值没有记录/, 'zi: 记账起点免责（用户点名实例）又回来了')
  // 「点击条件可手动标记」这句 UI 自我解说同批删了（族 7）。「点得动」这件事
  // 改钉控件本体：每条都是带 data-gimmick-step 的按钮，点了真落存档——比钉那句话硬
  assert.match(event, /data-gimmick-step="\$\{esc\(key\)\}" aria-pressed=/, 'du: 机关格不再是可点控件')
  assert.match(event, /toggleGimmickStep\(gimmickStep\.dataset\.gimmickStep!\)/, 'du: 机关格点了不落存档')

  // ---- ③ 新鲜度/停更/来源健康：模块里一句都不许有 ----
  for (const [name, source] of [
    ['ji', catalog], ['di', battle], ['du', event], ['bi', expedition],
    ['qn', quests], ['shi', review], ['zi', resource],
  ]) {
    assert.doesNotMatch(source, /停更/, `${name}: 停更警示又回到模块常驻里了`)
  }
  assert.doesNotMatch(catalog, /内容最后一次人工修订/, 'ji: 带路资料的内容年龄又挂回面板了')
  assert.doesNotMatch(catalog, /已 3 年以上未更新/, 'ji: 过旧警示又挂回面板了')

  // 撤之前要有落点：钥的矿脉健康度里必须有这一行，台账在 shared 层
  assert.match(settings, /包上游已停更/, '钥里没有停更那一行——模块撤了就没人说了')
  assert.match(settings, /UPSTREAM_STALE_DAYS/)
  const health = fs.readFileSync(new URL('../src/shared/lode-health.ts', import.meta.url), 'utf8')
  assert.match(health, /export const DISCONTINUED_UPSTREAM/)
  assert.match(health, /discontinuedAt: DISCONTINUED_UPSTREAM\[id\] \?\? null/)
  // 台账当前是空的（唯一一条 EO fit-bonus 随 2026-08-22 换源退场）。判据改成
  // 「机制还在、且退场的那个包确实不再被运行时读」——钉一条已经不该存在的记录，
  // 就是把过期状态本身当成纪律。
  const lodeIds = fs.readFileSync(new URL('../src/shared/lode-ids.ts', import.meta.url), 'utf8')
  // 判据钉在**编译出来的清单**上，不钉源码里那一行长什么样：
  // 2026-08-23 给每条加了 impact 之后，`{ id: 'x' }` 这个形状就不存在了，
  // 而那时清单本身完全正确——护栏拿正确的代码报错，自己成了噪声源。
  const { CONSUMED_LODE_IDS: consumedIds } = await import('../dist/shared/lode-ids.js')
  assert.equal(consumedIds.includes('fit-bonus'), false, 'EO 的 fit-bonus 又被运行时读了')
  assert.equal(consumedIds.includes('kcwiki-fit-bonus'), true, '装备加成的新底表不在消费清单里')

  // ---- ① 单短标注与当下状态照旧常驻（这一改最容易被顺手连坐）----
  // 2026-08-26 文案清扫撤了行内 <b> 强调（族 9），空态本身照旧常驻
  assert.match(catalog, /加成表尚未收录当前装备/) // 空态
  assert.match(catalog, /加成表暂无本舰条目/) // 空态
  assert.match(battle, /记录已过期/) // 状态词
  assert.match(event, /<span class="mst lk">未同步<\/span>/) // 状态词
  assert.match(quests, /部分条件无法核对 · 计数为估算/) // 估算标注（本来就在悬停里）
  assert.match(resource, /活动开始前暂无资源记录/) // 空态诚实语
})
