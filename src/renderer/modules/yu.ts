// 钥 (Yu) · 设置。配置直读写主进程 config（remote，同 poi 口径）：
// 代理（即时生效）/ 登录会话 / 完整数据备份 / 缓存急救 / 矿脉数据包一览 / 社区上报（挂牌）/ 关于。
// 纪律：改动即存；运行健康不靠猜测，直接显示主进程回报；上报类默认关且未实装前不可开。
//
// 卡片按**分类分页**摆（页签在面板顶部，一次只画一类）。归属表在
// shared/settings-sections，这里只消费：卡的次序、页签的次序都从那份表来。
import { crashLog, onCrash } from '../crash-guard'
import { setAllowRemoteArt } from '../kcs-image'
import { setAllowRemoteVoice } from '../kcs-voice'
import { setVoiceCaptionSize, setVoiceCaptionsEnabled } from '../voice-subtitle'
import { setOverlayEntranceEnabled } from '../launch-glow'
import { reloadVoiceAbsent } from '../voice-probe'
import {
  getGameScaleLive,
  getGameScaleMode,
  getGameScaleStep,
  setGameScaleMode,
  setGameScaleStep,
} from '../game-scale'
import {
  esc,
  fmtDateTime,
  getUiZoom,
  lodeCredit,
  onUiZoom,
  queryLode,
  setSunkEffectsEnabled,
  setUiZoom,
  trackMountCleanup,
  uiGet,
  uiSet,
  withViewStateKept,
} from '../kernel'
import {
  normalizeSettingsSection,
  settingsCardsOf,
  SETTINGS_SECTION_UI_KEY,
  SETTINGS_SECTIONS,
} from '../../shared/settings-sections'
import type { SettingsCardId, SettingsSectionId } from '../../shared/settings-sections'
import {
  LODE_CREDIT_INTRO,
  LODE_CREDIT_SHARE_ALIKE,
  LODE_CREDIT_SOURCES,
} from '../../shared/lode-credits'
import {
  CONSUMED_LODE_IDS,
  consumedLodeImpact,
  consumedLodeOf,
  isSelfFetchLode,
  manualOnlyReason,
} from '../../shared/lode-ids'
import {
  DEFAULT_GAME_URL,
  GAME_URL_CONFIG_KEY,
  isValidGameUrl,
} from '../../shared/game-url'
import {
  GAME_SCALE_MODE_LABEL,
  GAME_SCALE_MODES,
  GAME_SCALE_STEPS,
} from '../../shared/game-scale'
import {
  effectiveVoiceCaptionPx,
  normalizeVoiceCaptionSize,
  VOICE_CAPTION_SIZE_CHIPS,
  VOICE_CAPTION_SIZE_DEFAULT,
  VOICE_CAPTION_SIZE_PATH,
  VOICE_CAPTION_SIZE_STEP,
} from '../../shared/voice-caption-size'
import { LAUNCH_GLOW_CONFIG_KEY, LAUNCH_GLOW_DEFAULT } from '../../shared/launch-glow'
import { mapIntelCatalog } from '../../shared/map-intel'
import { groupVoiceAbsentByMonth } from '../../shared/voice-probe-plan'
import type { VoiceAbsentEntry } from '../../shared/voice-probe-plan'
import {
  clampLedgerRetentionDays,
  LEDGER_RETENTION_DAYS_MAX,
} from '../../shared/ledger-retention'
import type { LedgerMonthCount } from '../../shared/ledger-retention'
import {
  lodePackHealth,
  mapIntelHealth,
  STALE_DAYS,
  UPSTREAM_STALE_DAYS,
} from '../../shared/lode-health'
import {
  checkBarkEndpoint,
  checkNtfyServer,
  checkNtfyTopic,
  clampPushIdleMinutes,
  isValidPushKey,
  isWeakNtfyTopic,
  NTFY_SERVER_PLACEHOLDER,
  NTFY_TOPIC_WEAK_LENGTH,
  PUSH_CONFIG_PATHS,
  PUSH_DEFAULTS,
  PUSH_IDLE_MINUTES_MAX,
  PUSH_IDLE_MINUTES_MIN,
  PUSH_KEY_ERROR,
  PUSH_KEY_LENGTH,
  PUSH_PROVIDERS,
  readPushSettings,
} from '../../shared/push-config'
import type { PushConfigField, PushProvider } from '../../shared/push-config'
import { registerModule } from '../mu'
import {
  setBuildSpoilerEnabled,
  setEventBannerEffectsEnabled,
  setPushEnabled,
  setPushPresence,
} from './lg'

import type { LodeMeta } from '../kernel'

const { ipcRenderer } = require('electron')
const remote = require('@electron/remote')
const config = remote.require('./config')

/**
 * 调试/开发态。**门与铭、锚两个诊断模块同一道**（mu.ts 里那句一模一样），
 * 别为设置另发明一个开关：多一个开关就多一处「以为关着其实开着」。
 * 关着时「矿脉健康度」那张维护者工具卡整张不装配（判据在 shared/settings-sections）。
 */
const DEBUG_UI = process.env.KANSO_DEBUG_UI === '1'

let pane: HTMLElement
/**
 * 正看着哪一类。**开面板时从配置读回上次那一格**（与史的视图页签同一条路：
 * kernel 的 uiGet/uiSet → 主进程 config.json）。认不出的值由 shared 那份兜回默认，
 * 不会渲染成空白页。
 */
let activeSection: SettingsSectionId = normalizeSettingsSection(
  uiGet<string>(SETTINGS_SECTION_UI_KEY, ''),
)
let lodes: LodeMeta[] = []
/**
 * 清单**读回来了没有**——不能拿 `lodes.length` 当这件事的判据。
 *
 * 一个包都没有时（产物被裁、asar 坏掉、开发态把 assets/lodes 挪走），
 * 空清单和「还没读完」长得一模一样，两张卡就永远停在「正在读取……」／「加载中…」。
 * 2026-08-22 发布前的「一个包都没有」降级档实测：等 30 秒仍是这两句话——
 * 而这张卡存在的意义正是**如实报缺**，停在加载态等于把「全缺」说成「马上就好」。
 */
let lodesLoaded = false
/** 海域情报包**读取出错**的原因；「包本来就没装」不是错，那种情况这里保持 null */
let mapIntelError: string | null = null

/** 一个帧里音频钩子的现况。字段与 assets/preload/game-audio.js 里那份快照一一对应 */
interface GameAudioFrameStats {
  /** 这个帧的路径，用来认出是主帧还是哪个 iframe */
  frame: string
  /** 每条捕获路各记下过多少个资源地址 */
  captures: { xhr: number; fetch: number; blob: number; fileReader: number; objectUrl: number }
  /** 还挂着的 WebAudio 源，按分类 */
  sources: { voice: number; bgm: number; other: number }
  /** 还挂着的 audio/video 元素，按分类 */
  media: { voice: number; bgm: number; other: number }
  /** 最近解过的音频，新的在后面 */
  decodes: { path: string; category: 'voice' | 'bgm' | 'other' }[]
  /** 最近解过的**语音**有多长。字幕层拿它算这一句该挂到什么时候，这张卡不展示 */
  voiceDurations: { path: string; ms: number }[]
}
/**
 * 自检读回来的东西。**维护者工具**（只在 `KANSO_DEBUG_UI=1` 下装配）。
 * null = 还没读过；空数组 = 读到了，但一个帧都没装上钩子——那是真坏了。
 */
let audioSelfTest: GameAudioFrameStats[] | null = null
let audioSelfTestError: string | null = null
let audioSelfTestReading = false
let appdataPath = ''
let proxyStatus: {
  state: 'applying' | 'ok' | 'error'
  description: string
  message: string
  updatedAt: number
} | null = null
let loginHealth: {
  lastPersistedAt: number | null
  lastFlushedAt: number | null
  lastError: string | null
} | null = null
let backupMessage = ''
/**
 * 「重新载入游戏页面」按下去之后的回话。它值得留一句：设置浮层正盖着游戏区，
 * 玩家按完看不见页面有没有动——不吭声就只能关掉浮层去猜。
 */
let gameUrlMessage: { tone: 'ok' | 'bad'; text: string } | null = null
/**
 * 语音档案的占用。异步拉一次就缓存住：这张卡不该为了显示一行占用去发同步 IPC。
 * 缺省 null = 还没拉到，界面显示「统计中」而不是假装是 0。
 */
let voiceArchiveUsage: {
  bytes: number
  kept: number
  heard: number
  /** `null` = 不限量（2026-08-23 起的默认） */
  maxBytes: number | null
  lockedKept: number
  lockedBytes: number
  full: boolean
} | null = null
/**
 * 「没出字幕」的语音台账三态。**这三件事的成因完全不同，不能混成一个数**：
 * 路径认不出才是解析器的活；「归属可解但本地没译文」改代码补不出来
 *（多是 wikiwiki 独有、按许可口径不随包）；混着说会让人白折腾解析器。
 */
let voiceUnmatchedStats: { unresolved: number; noText: number; noVoiceId: number } | null = null
/**
 * 「官方没有」台账的全部条目。**这一份不会自己变小**——2026-08-23 起
 * 90 天自动过期退役（判据在 shared/voice-probe-plan），清理权归玩家，
 * 这张卡就是那个入口。缺省 null = 还没拉到，显示「统计中」而不是假装是 0。
 */
let voiceAbsentLedger: VoiceAbsentEntry[] | null = null
/**
 * 主账本的保留期设置、占用与按月行数。缺省 null = 还没拉到。
 * 同一条裁定的另一处落点：2026-08-23 起账本也不再按日期自动清理
 *（判据在 shared/ledger-retention），保留天数由玩家自己填。
 */
let ledgerRetention: {
  /** 0 = 不限（默认） */
  retentionDays: number
  bytes: number
  months: LedgerMonthCount[]
} | null = null
/** 立绘档案的占用。与语音档案分开两份：两者能分别清空，数字也不该合并显示。 */
let artArchiveUsage: {
  bytes: number
  kept: number
  seen: number
  forms: number
  /** `null` = 不限量（2026-08-23 起的默认） */
  maxBytes: number | null
  lockedKept: number
  lockedBytes: number
  full: boolean
} | null = null
/** BGM 档案的占用。与语音/立绘各自一份：三者能分别清空，数字也不该合并显示。 */
let bgmArchiveUsage: {
  bytes: number
  kept: number
  heard: number
  /** `null` = 不限量（与另外两族同一条默认） */
  maxBytes: number | null
  lockedKept: number
  lockedBytes: number
  full: boolean
} | null = null
/**
 * 「发送测试推送」的就地结果。失败用红色状态条、原因原样显示，不粉饰；
 * 发送中单独一档（working），别让「正在发送」长得像「已成功」。
 */
let pushMessage: { tone: 'ok' | 'bad' | 'working'; text: string } | null = null

/**
 * 目标类型。ntfy 排在前面且是默认：它在安卓上收得到、服务器还能自架；
 * Bark 走苹果 APNs，安卓装不了那个 app，所以它是次选。
 * 标签只写平台和目标名——这是要发布的设置界面，不该假定用的人是谁。
 */
const PUSH_PROVIDER_LABELS: [PushProvider, string][] = [
  ['ntfy', '安卓 · ntfy'],
  ['bark', 'iOS · Bark'],
]

/** 输入框 → 配置叶子。只认这几个，别的一律不写 config */
const PUSH_INPUT_FIELDS = [
  'ntfyServer',
  'ntfyTopic',
  'ntfyToken',
  'barkEndpoint',
  'barkKey',
] as const satisfies readonly PushConfigField[]

const isPushInputField = (field: string | undefined): field is (typeof PUSH_INPUT_FIELDS)[number] =>
  (PUSH_INPUT_FIELDS as readonly string[]).includes(field ?? '')

const PROXY_KINDS: [string, string][] = [
  ['none', '直连'],
  ['socks5', 'SOCKS5'],
  ['http', 'HTTP'],
  ['pac', 'PAC 脚本'],
]

type GameAudioMode = 'all' | 'voice' | 'bgm'
const GAME_AUDIO_MODES: [GameAudioMode, string][] = [
  ['all', '全部声音'],
  ['voice', '仅语音'],
  ['bgm', '仅 BGM'],
]

type GameAudioVolumeField = 'volume' | 'voiceVolume' | 'bgmVolume'

/**
 * 每一项的上限只写在这一张表里。总音量只做衰减（>100% 等于把语音和 BGM
 * 一起放大，失真也一起来），语音/BGM 允许主动放大到 200%。
 * 读值 clamp、滑条 max、提交 clamp 三处都从这里取——这三个数曾经各写各的。
 */
const GAME_AUDIO_VOLUME_MAX = {
  volume: 100,
  voiceVolume: 200,
  bgmVolume: 200,
} as const satisfies Record<GameAudioVolumeField, 100 | 200>

const isAudioVolumeField = (field: string | undefined): field is GameAudioVolumeField =>
  field != null && field in GAME_AUDIO_VOLUME_MAX

/** 界面输入的百分比落进该项的合法区间；空框/非数字按 0 算（即滑条最左端） */
const clampAudioPercent = (field: GameAudioVolumeField, percent: number): number =>
  Math.max(0, Math.min(GAME_AUDIO_VOLUME_MAX[field], Number.isFinite(percent) ? percent : 0))

/** 配置里读出的倍率（0–1 或 0–2）。读不出数回默认 1，而不是 clamp 成 0 静音 */
const readAudioVolume = (field: GameAudioVolumeField): number => {
  const raw = Number(config.get(`kanso.gameAudio.${field}`, 1))
  if (!Number.isFinite(raw)) return 1
  return Math.max(0, Math.min(GAME_AUDIO_VOLUME_MAX[field] / 100, raw))
}

const audioVolumeHtml = <F extends GameAudioVolumeField>(
  field: F,
  label: string,
  value: number,
  // 上限仍在调用处写成字面量（读这段 HTML 的人一眼看见滑条能拉到哪），
  // 但类型绑在上表上：写得和表不一致，tsc 当场报错。
  maxPercent: (typeof GAME_AUDIO_VOLUME_MAX)[F],
): string => {
  const percent = Math.round(value * 100)
  return `<div class="yline yaudio-line">
    <span>${label}</span>
    <input type="range" class="yaudio-range" data-audio-volume="${field}" min="0"
      max="${maxPercent}" step="1" value="${percent}">
    <b class="yaudio-value" data-audio-value="${field}">${percent}%</b>
  </div>`
}

const toggleHtml = (key: string, label: string, note: string, value: boolean, disabled = false, hint = ''): string => `
  <div class="yrow${disabled ? ' dis' : ''}">
    <span class="ytx"><b>${esc(label)}</b><span>${esc(note)}</span></span>
    <span class="ysw${value ? ' on' : ''}" ${disabled ? `title="${esc(hint)}"` : `data-toggle="${esc(key)}"`}><i></i></span>
  </div>`

/** 游戏页那个 webview。只用到 executeJavaScript，所以按结构写类型，不牵 electron 的类型进来 */
type GameWebview = HTMLElement & { executeJavaScript(code: string): Promise<unknown> }

/**
 * 从游戏页读回音频钩子的现况。走的是和「截图」同一条路（`webview.executeJavaScript`），
 * 只读一个统计对象出来，不发请求、不碰播放。
 */
const readAudioSelfTest = (): void => {
  if (audioSelfTestReading) return
  const webview = document.querySelector<GameWebview>('#game-wrapper webview')
  if (!webview) {
    audioSelfTest = null
    audioSelfTestError = '游戏页还没挂上，等它出来再读'
    render()
    return
  }
  audioSelfTestReading = true
  audioSelfTestError = null
  void webview
    .executeJavaScript('window.kansoGameAudioStats ? window.kansoGameAudioStats() : null')
    .then((result) => {
      audioSelfTest = (result as GameAudioFrameStats[] | null) ?? []
    })
    .catch((error: unknown) => {
      audioSelfTest = null
      audioSelfTestError = error instanceof Error ? error.message : String(error)
    })
    .finally(() => {
      audioSelfTestReading = false
      render()
    })
}

const AUDIO_CATEGORY_LABEL = { voice: '语音', bgm: 'BGM', other: '其他' } as const

/**
 * 游戏音频链路自检。**维护者工具**——只在 `KANSO_DEBUG_UI=1` 下装配
 *（归属表 shared/settings-sections 的 `DEBUG_ONLY_CARDS`）。
 *
 * 存在的理由：三条滑条不起作用时，坏的地方可能在任意一环——钩子没装进那个帧、
 * 资源地址没被记下、或者记下了但分类认错。光看「响不响」这三种分不开。
 * 这张卡把这三环各自的计数摊开，一眼能定位到是哪一环。
 *
 * 2026-08-26 修的那个 bug 正是第二环：游戏用 howler 装语音，
 * 它先装 onload 再调 send，而艦素当时把登记挂在 send 里，
 * 于是解码时地址还没记上，语音被当成普通音效——只吃总音量，语音滑条白拉。
 */
const gameAudioSelfTestCardHtml = (): string => {
  const head = `<div class="h"><b>游戏音频链路自检</b>
    <span class="aux"><span class="ybtn" data-act="audio-selftest-refresh">${
      audioSelfTestReading ? '读取中…' : '读一次'
    }</span></span></div>`

  if (audioSelfTestError) {
    return `${head}<div class="yhealth warn"><b>没读到</b>
      <span>${esc(audioSelfTestError)}</span></div>`
  }
  if (audioSelfTest === null) {
    return `${head}<div class="ynote">暂无读取记录。点右上角「读一次」，从游戏页取一份现况。</div>`
  }
  if (audioSelfTest.length === 0) {
    return `${head}<div class="yhealth bad"><b>一个帧都没装上钩子</b>
      <span>游戏页里找不到音频钩子，三条滑条都不会起作用。可在主控台查
      <span class="mono">failed to install game-audio</span>，确认 preload 是否启动。</span></div>`
  }

  const allDecodes = audioSelfTest.flatMap((frame) => frame.decodes)
  const voiceDecodes = allDecodes.filter((entry) => entry.category === 'voice').length
  const verdict = !allDecodes.length
    ? `<div class="ynote">暂无音频解码记录。在游戏里点一句台词、切一次港区，再回来重读。</div>`
    : voiceDecodes
      ? `<div class="yhealth ok"><b>语音认得出来</b>
          <span>最近 ${allDecodes.length} 条里有 ${voiceDecodes} 条认成语音，语音滑条这一路是通的。</span></div>`
      : `<div class="yhealth bad"><b>解了 ${allDecodes.length} 条，没有一条认成语音</b>
          <span>要么这几条本来就不是语音（先去点一句台词再读），
          要么地址没记上或者分类认错——看下面每条的路径。</span></div>`

  const frames = audioSelfTest
    .map((frame) => {
      const counts = (row: { voice: number; bgm: number; other: number }) =>
        `语音 ${row.voice} · BGM ${row.bgm} · 其他 ${row.other}`
      const decodeRows = frame.decodes.length
        ? frame.decodes
            .map(
              (entry) =>
                `<div class="yl-row"><span class="yl-map">${esc(
                  AUDIO_CATEGORY_LABEL[entry.category] ?? entry.category,
                )}</span><span class="mono">${esc(entry.path)}</span></div>`,
            )
            .reverse()
            .join('')
        : `<div class="yl-row"><span class="dim">这个帧暂无音频解码记录</span></div>`
      return `<div class="ynote" style="margin-top:8px">
          <b>${esc(frame.frame || '(读不出路径)')}</b><br>
          记下的地址：XHR ${frame.captures.xhr} · fetch ${frame.captures.fetch} ·
          Blob ${frame.captures.blob} · FileReader ${frame.captures.fileReader} ·
          objectURL ${frame.captures.objectUrl}<br>
          还挂着的 WebAudio 源：${counts(frame.sources)}<br>
          还挂着的音频元素：${counts(frame.media)}
        </div>
        <div class="ylayers">${decodeRows}</div>`
    })
    .join('')

  return `${head}${verdict}
    <div class="ynote" style="margin-top:8px">装上钩子的帧共 ${audioSelfTest.length} 个：</div>
    ${frames}`
}

/**
 * 矿脉健康度。**维护者工具**——只在 `KANSO_DEBUG_UI=1` 下装配
 *（归属表 shared/settings-sections 的 `DEBUG_ONLY_CARDS`）。
 *
 * 为什么不给玩家看（2026-08-24 用户拍板，原话「既然不随包玩家那边看不到，
 * 多此一举写这些干什么」）：没获随包许可的那些资料在玩家那份产物里**永远不会有**，
 * 缺包／停更／新鲜度是维护者的责任区（2026-08-21 既有裁定），
 * 玩家侧的信号已经在各栏目就地的占位上——再摆一张「缺 14 份」的清单，
 * 只是让他为一件自己做不了任何事的事担心。
 *
 * 卡本身照旧：面板里出现「待补」时，维护者要分得清是**包没装**还是
 * **这一层上游就没有**——前者跑一次抓取器就好，后者只能等，混成一句话会白折腾。
 */
const lodeHealthCardHtml = (): string => {
  if (!lodesLoaded) {
    return `<div class="h"><b>矿脉健康度</b></div>
      <div class="ynote">正在读取数据包清单……</div>`
  }
  const rows = lodePackHealth(CONSUMED_LODE_IDS, lodes, Date.now())
  const missing = rows.filter((row) => !row.present)
  const stale = rows.filter((row) => row.present && row.ageDays != null && row.ageDays > STALE_DAYS)
  const unknownAge = rows.filter((row) => row.present && row.ageDays == null)

  // 缺包分三种，各自能做的事完全不同——混成一句「缺 N 包，用到它们的面板会显示待补」
  // 既吓人又没用（2026-08-23 用户抓到这张卡整体过时，根因就是那一句）：
  //  · **不随发行版**的：上游没给再分发许可，拉一次就有；
  //  · **随包却不见了**的：产物被动过或包坏了，那是另一回事；
  //  · **拉不回来**的：建议跑 lodes:fetch 是错的，那条命令对它无效。
  // 每一条都逐包说清「缺了影响哪个面板的哪一格」，判据在 shared/lode-ids 的 `impact`。
  const manual = missing.filter((row) => manualOnlyReason(row.id))
  const selfFetch = missing.filter((row) => !manualOnlyReason(row.id) && isSelfFetchLode(row.id))
  const shouldBeBundled = missing.filter(
    (row) => !manualOnlyReason(row.id) && !isSelfFetchLode(row.id),
  )
  const impactList = (list: typeof missing) =>
    `<span class="yl-impacts">${list
      .map(
        (row) =>
          `<span class="yl-impact"><span class="mono">${esc(row.id)}</span>${
            consumedLodeImpact(row.id) ? ` —— ${esc(consumedLodeImpact(row.id))}` : ''
          }</span>`,
      )
      .join('')}</span>`
  const missingHtml =
    (selfFetch.length
      ? `<div class="yhealth warn"><b>${selfFetch.length} 包没有随发行版</b>
          <span>上游不许再分发，所以不随包；维护者侧跑 <span class="mono">npm run lodes:fetch</span>
          补进开发树，玩家那份产物里则永远没有。缺着时影响：</span>${impactList(selfFetch)}</div>`
      : '') +
    (shouldBeBundled.length
      ? `<div class="yhealth bad"><b>${shouldBeBundled.length} 包本该随发行版却不见了</b>
          <span>本该随包发的，不见了多半是文件损坏，重装一次即可。</span>
          ${impactList(shouldBeBundled)}</div>`
      : '') +
    (manual.length
      ? manual
          .map(
            (row) => `<div class="yhealth warn"><b>${esc(row.id)} 需要手动导入</b>
              <span>${esc(manualOnlyReason(row.id) ?? '')}；导出的文件放进下面写的用户包目录即可。
              缺着的时候：${esc(consumedLodeImpact(row.id))}。</span></div>`,
          )
          .join('')
      : '') +
    (missing.length
      ? ''
      : `<div class="yhealth ok"><b>${rows.length} 包齐全</b></div>`)

  const staleHtml = stale.length
    ? `<div class="yhealth warn"><b>${stale.length} 包超过 ${STALE_DAYS} 天没更新</b>
        <span>${stale
          .map((row) => `<span class="mono">${esc(row.id)}</span> ${row.ageDays} 天`)
          .join('、')}</span></div>`
    : ''
  const unknownHtml = unknownAge.length
    ? `<div class="yhealth warn"><b>${unknownAge.length} 包读不出更新日期</b>
        <span>${unknownAge.map((row) => `<span class="mono">${esc(row.id)}</span>`).join('、')}
        —— 当作未知，不按「刚更新」算。</span></div>`
    : ''

  // 上游停更单独一行：上面那两行说的是**我们**下载得多久了，这行说的是**上游**
  // 还动不动。两者不是一回事——刚下载的包也可能来自一个两年没人管的表。
  // 玩家侧不再逐处声明停更（2026-08-21 拍板），这一行是它唯一的落点。
  const discontinued = rows.filter(
    (row) =>
      row.present &&
      (row.discontinuedAt != null ||
        (row.upstreamAgeDays != null && row.upstreamAgeDays > UPSTREAM_STALE_DAYS)),
  )
  // 逐包说，不再一句通用话打包收尾。通用那句（「那之后加入游戏的内容不会出现在
  // 这几份资料里」）对多数包成立，但对**已经被后续层接住**的包就是虚惊一场——
  // kcwiki-quest-req 正是这样：它 2022 年就停了，而任务计数早已是四层链，
  // 本机 644 条追踪器全部就绪。那种情况在 shared/lode-ids 的 `upstreamNote` 里写清楚。
  const discontinuedHtml = discontinued.length
    ? `<div class="yhealth warn"><b>${discontinued.length} 包上游已停更</b>
        <span class="yl-impacts">${discontinued
          .map((row) => {
            const day = (row.discontinuedAt ?? row.upstreamUpdatedAt ?? '').slice(0, 10)
            const note =
              consumedLodeOf(row.id)?.upstreamNote ??
              '那之后加入游戏的内容不会出现在这份资料里，以游戏内与实测为准'
            return `<span class="yl-impact"><span class="mono">${esc(row.id)}</span> 停在 ${esc(day)} —— ${esc(note)}</span>`
          })
          .join('')}</span></div>`
    : ''

  // 判据是**装配之后**那份目录，不是底座包的原文：底座 `map-intel` 永不随包，
  // 拿它当判据会在玩家那份产物上报出「常规海域 0/0」——而三层汇编其实都在
  //（2026-08-22 发布前验收抓到的那条大病，根因同一处）。
  const intel = mapIntelHealth(mapIntelCatalog())
  const compGap = intel.comps.total - intel.comps.pinned
  const layerRows = intel.layers
    .map((layer) => {
      const cells = [
        layer.covered.length ? `<span class="yl-ok">${layer.covered.join('')}</span>` : '',
        layer.empty.length ? `<span class="yl-empty">${layer.empty.join('')} 上游无表</span>` : '',
        layer.absent.length ? `<span class="yl-absent">${layer.absent.join('')} 包内缺层</span>` : '',
      ].filter(Boolean)
      return `<div class="yl-row"><span class="yl-map">${esc(layer.map)}</span>${cells.join('')}</div>`
    })
    .join('')

  // 读取出错单独说一句：**统计照常摆**——它算的是装配之后生效的那份，
  // 常规海域三层各自独立，活动图底座读不出来不代表常规图也没了。
  // 从前这里是「出错就不摆统计」，那是统计还依赖底座时的写法。
  const intelHtml = `${
    mapIntelError
      ? `<div class="yhealth warn"><b>活动图底座读取失败</b>
          <span>${esc(mapIntelError)} · 重开面板或重启 kuma 再试</span></div>`
      : ''
  }<div class="ynote" style="margin-top:8px">
      <b>海域情报</b>：常规海域 ${intel.normalCovered}/${intel.normalTotal} 张有节点资料 ·
      敌编成 ${intel.comps.total.toLocaleString()} 套，已定号 ${intel.comps.pinned.toLocaleString()}${
        compGap ? `，<b>还差 ${compGap.toLocaleString()} 套未定号</b>` : '，全部定号 ✓'
      }
    </div>
    ${
      layerRows
        ? `<div class="ylayers">${layerRows}</div>`
        : ''
    }`

  return `<div class="h"><b>矿脉健康度</b></div>
    ${missingHtml}${staleHtml}${unknownHtml}${discontinuedHtml}
    ${intelHtml}`
}

/**
 * 资料来源与许可。**署名义务在这里集中履行一次**，模块里一个都不散布
 *（发布纪律：CC BY-NC-SA 3.0 第 4(d) 条要署名与改动说明、4(a) 条要随分发物提供许可证 URI；
 * NOTICE.md 管「随分发物提供」，这张卡管「应用内可查」）。
 *
 * 三件事这张卡**不做**，各有归属，别往回搬：
 *  · 日期与新鲜度 → 「矿脉健康度」卡（新鲜度是维护者的区域）；
 *  · 逐包 id 与「多新」 → 「矿脉数据包」卡；
 *  · 「眼前这个数谁说的」 → 模块里的 lodeCredit 悬停。悬停维持现状，
 *    许可不进悬停、两边也不互相跳转——在每条信息旁边挂一个许可入口，形式上就是散布署名。
 *
 * 文案与分组的唯一出处是 shared/lode-credits（静态表，不从 meta.license 生成）。
 */
const lodeCreditCardHtml = (): string => {
  const rows = LODE_CREDIT_SOURCES.map((source) => {
    // 来源名是外链：点击才联网，属「网络去向告知」的豁免项。
    // 没有 url 的那一组（艦素自行整理）落成纯文本，绝不渲染死链。
    const name = source.url
      ? `<a class="ycredit-name" href="${esc(source.url)}" target="_blank" rel="noreferrer">${esc(source.name)} ↗</a>`
      : `<span class="ycredit-name">${esc(source.name)}</span>`
    return `<div class="ycredit">${name}
      <span class="ycredit-lic">${esc(source.license)}</span>
      <span class="ycredit-what">${esc(source.provides)}</span>
    </div>`
  }).join('')
  const details = LODE_CREDIT_SOURCES.map(
    (source) => `<div class="ynote"><b>${esc(source.name)}</b>：${esc(source.detail)}</div>`,
  ).join('')
  return `<div class="h"><b>资料来源与许可</b></div>
    <div class="ynote">${esc(LODE_CREDIT_INTRO.lead)}<br>
      ${esc(LODE_CREDIT_INTRO.licenseNote)}<b>${esc(LODE_CREDIT_INTRO.emphasis)}</b></div>
    <div class="ycredits">${rows}</div>
    <div class="ynote">${esc(LODE_CREDIT_SHARE_ALIKE)}</div>
    <details class="yfold"><summary>逐项对照</summary>${details}</details>
    <div class="ynote">语音、立绘、BGM 档案与缓存里的游戏资产仅供本机自行使用。
      传播、散布或用于未经许可的商业目的，法律责任自行承担。</div>
    <div class="ynote">完整的第三方声明与许可证全文见随附的
      <span class="mono">NOTICE.md</span>。</div>
    <div class="yline"><span class="ybtn" data-act="open-notice">打开 NOTICE.md</span></div>`
}

/**
 * 手机推送。主叙事是**安卓 + ntfy**（用户手上是安卓机，Bark 只有 iOS 装得了）；
 * Bark 收成次级选项，留给家里用苹果的人。
 * 纪律都摆在卡面上：默认全关、频道名/地址得他亲手填、只推标题默认开、
 * 按钮点了才出网；ntfy 没有端到端加密这件事直说，不藏。
 */
const pushCardHtml = (): string => {
  // 逐叶子读（readPushSettings 只认那几个叶子路径）。整对象读会拿到 config
  // 写叶子时留下的半份对象，「只推标题」这类默认开的项会静默变成关——
  // 而那正是最不该出错的方向。
  const push = readPushSettings((path, fallback) => config.get(path, fallback))
  const isNtfy = push.provider === 'ntfy'

  const providerChips = PUSH_PROVIDER_LABELS.map(
    ([id, label]) =>
      `<span class="ychip${push.provider === id ? ' on' : ''}" data-push-provider="${id}">${label}</span>`,
  ).join('')

  // 空着不是错，是还没配；只有「填了但填错了」才报
  const server = checkNtfyServer(push.ntfyServer, push.ntfyTopic)
  const topic = checkNtfyTopic(push.ntfyTopic)
  const endpoint = checkBarkEndpoint(push.barkEndpoint)
  const problems = (
    isNtfy
      ? [
          push.ntfyServer && server.error ? server.error : '',
          push.ntfyTopic && topic.error ? topic.error : '',
          // 服务器不再有预置值，空着与频道名空着一样会让整条推送停在本机——都得说
          push.enabled && !push.ntfyServer ? '推送已启用，但服务器地址还空着，不会发出任何请求' : '',
          push.enabled && !push.ntfyTopic ? '推送已启用，但频道名还空着，不会发出任何请求' : '',
        ]
      : [
          push.barkEndpoint && endpoint.error ? endpoint.error : '',
          push.barkEncrypt && push.barkKey && !isValidPushKey(push.barkKey) ? PUSH_KEY_ERROR : '',
          push.enabled && push.barkEncrypt && !push.barkKey
            ? '已开加密但没有密钥 · 点「生成密钥」后填进 Bark App'
            : '',
          push.enabled && !push.barkEndpoint ? '推送已启用，但地址还空着，不会发出任何请求' : '',
        ]
  ).filter(Boolean)
  // 拦不住但要说：频道名短 = 口令短
  const advisories = [
    isNtfy && isWeakNtfyTopic(push.ntfyTopic)
      ? `频道名不到 ${NTFY_TOPIC_WEAK_LENGTH} 位。频道名即口令，过短易被猜到，可点「生成频道名」重新生成`
      : '',
  ].filter(Boolean)

  const ntfyFields = `
    <div class="ynote"><b>怎么用</b>：① 手机上装 <b>ntfy</b>（Google Play 或 F-Droid，开源免费）
    ② 下面填服务器与频道名，在 app 里 Subscribe 同一个频道
    ③ 回来点「发送测试推送」，手机响了就成了。</div>
    <div class="yline">服务器
      <input class="yin wide" data-push-field="ntfyServer" value="${esc(push.ntfyServer)}"
        placeholder="${esc(NTFY_SERVER_PLACEHOLDER)}">
      <span class="note9">要自己填；空着不会发送</span></div>
    <div class="yline">频道名
      <input class="yin wide" data-push-field="ntfyTopic" value="${esc(push.ntfyTopic)}"
        placeholder="点右边生成一个猜不到的">
      <span class="ybtn" data-act="push-gentopic">生成频道名</span></div>
    <div class="yline">访问令牌
      <input class="yin wide" data-push-field="ntfyToken" value="${esc(push.ntfyToken)}"
        placeholder="仅自架且开了鉴权时才需要（tk_…）"></div>
    ${toggleHtml(
      PUSH_CONFIG_PATHS.barkEncrypt,
      '端到端加密',
      'ntfy 不提供端到端加密，这一格用不上',
      false,
      true,
      '端到端加密只有 iOS · Bark 那条路有；ntfy 上内容在服务器端是明文的',
    )}`

  const barkFields = `
    <div class="ynote"><b>iOS 专用</b>：Bark 走苹果 APNs，安卓装不了这个 app。
    地址是 Bark App 首页给的那一整条，里面那串设备码等同于密码。</div>
    <div class="yline">推送地址
      <input class="yin wide" data-push-field="barkEndpoint" value="${esc(push.barkEndpoint)}"
        placeholder="https://api.day.app/你的设备码"></div>
    ${toggleHtml(
      PUSH_CONFIG_PATHS.barkEncrypt,
      '端到端加密',
      `默认开。开启后需在 Bark App 的「推送加密」里选 AES128 / CBC / PKCS7，KEY 填下面这 ${PUSH_KEY_LENGTH} 位`,
      push.barkEncrypt,
    )}
    <div class="yline">加密密钥
      <input class="yin wide" data-push-field="barkKey" value="${esc(push.barkKey)}"
        placeholder="${PUSH_KEY_LENGTH} 位，可点右边生成">
      <span class="ybtn" data-act="push-genkey">生成密钥</span></div>`

  const privacyNote = isNtfy
    ? `<div class="ynote">ntfy 没有端到端加密，内容在服务器上是明文。
      频道名就是口令，用生成的长随机名；要端到端加密只有 iOS · Bark 那条路`
    : `<div class="ynote">经 Bark 服务器与苹果推送通道各中转一次：
      开着加密两段都只看得到密文，关掉则能看到标题和正文`

  return `<div class="h"><b>手机推送</b><span class="aux">默认全关 · 人不在电脑前时提醒远征、入渠这些时刻</span></div>
    ${toggleHtml(
      PUSH_CONFIG_PATHS.enabled,
      '启用手机推送',
      '通知里的「手机推送」跟着这一档',
      push.enabled,
    )}
    <div class="yline">${providerChips}</div>
    ${isNtfy ? ntfyFields : barkFields}
    ${toggleHtml(
      PUSH_CONFIG_PATHS.titleOnly,
      '只推标题',
      '手机上只出现「远征 21 返港」这类时刻，正文（舰名、渠号）不上手机',
      push.titleOnly,
    )}
    ${toggleHtml(
      PUSH_CONFIG_PATHS.presenceHold,
      '人在电脑前暂缓推送',
      '默认开。你还在动键鼠时先不推',
      push.presenceHold,
    )}
    <div class="yline">空闲多久算离开
      <input class="yin w60" type="number" data-push-minutes value="${push.presenceIdleMinutes}"
        min="${PUSH_IDLE_MINUTES_MIN}" max="${PUSH_IDLE_MINUTES_MAX}" step="1">
      <span class="note9">分钟（${PUSH_IDLE_MINUTES_MIN}–${PUSH_IDLE_MINUTES_MAX}）·
        离开这么久之后，攒下的推送按发生顺序补上，标题带上「几分前」</span></div>
    <div class="yline"><span class="ybtn" data-act="push-test">发送测试推送</span></div>
    ${problems.map((text) => `<div class="ystatus bad">${esc(text)}</div>`).join('')}
    ${advisories.map((text) => `<div class="ystatus working">${esc(text)}</div>`).join('')}
    ${pushMessage ? `<div class="ystatus ${pushMessage.tone}">${esc(pushMessage.text)}</div>` : ''}
    ${privacyNote}
    存在本机 <span class="mono">${esc(appdataPath)}\\config.json</span>，
    里面有密钥，备份时当账号资料保管</div>`
}

/**
 * 上限那一句。**默认不限量**（2026-08-23 拍板）：「留不留、是不是太占位置」的决断
 * 归玩家自己，所以默认一条都不淘汰，档案只在他自己清空时变小。
 *
 * 设了上限才有淘汰，而淘汰**永远绕开「来源已不可再得」的条目**——
 * 过季语音、撤场活动的深海立绘，删了就是永久失去，不该被一条自动规则悄悄带走。
 * 所以还有「满了但删不动」这一档：如实说一声，让玩家自己决定扩容还是手动清理。
 */
const archiveLimitNote = (
  usage: { maxBytes: number | null; lockedKept: number; lockedBytes: number; full: boolean },
  unit: string,
): string => {
  const locked = usage.lockedKept
    ? `其中 <b>${usage.lockedKept}</b> ${unit}（${formatArchiveBytes(usage.lockedBytes)}）来源已不可再得，自动清理不会碰它们。`
    : ''
  if (usage.maxBytes == null) return `不设上限${locked ? ` ${locked}` : ''}`
  if (usage.full) {
    return (
      `${locked ? `${locked}<br>` : ''}已达上限 ${formatArchiveBytes(usage.maxBytes)}，` +
      '剩下的都是取不回来的，不会自动删。调大上限或手动清空才继续收'
    )
  }
  return `上限 ${formatArchiveBytes(usage.maxBytes)}，写满后先清理最久没再用到的。${locked}`
}

/** 上限输入框。留空或填 0 = 不限量（与主进程 archiveLimitBytes 同一条判据）。 */
const archiveLimitLine = (
  kind: 'voice' | 'art' | 'bgm',
  usage: { maxBytes: number | null } | null,
): string => {
  const mb = usage?.maxBytes == null ? '' : `${Math.round(usage.maxBytes / (1024 * 1024))}`
  const suggested = kind === 'art' ? 2048 : 500
  return `<div class="yline">占用上限
    <input class="yin w60" type="number" data-archive-limit="${kind}" value="${mb}"
      min="0" max="1048576" step="1" placeholder="不限">
    <span class="note9">MB · 留空或 0 = 不限量（默认）；参考值 ${suggested}</span></div>`
}

const formatArchiveBytes = (bytes: number): string => {
  if (!(bytes > 0)) return '0 MB'
  const mb = bytes / (1024 * 1024)
  return mb < 1 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${mb.toFixed(mb < 10 ? 1 : 0)} MB`
}

/** 拉一次档案占用；到货后只重画钥自己那一格。 */
const refreshVoiceArchiveUsage = () => {
  void ipcRenderer
    .invoke('mg:voice-archive-stats')
    .then((usage: typeof voiceArchiveUsage) => {
      voiceArchiveUsage = usage ?? null
      render()
    })
    .catch(() => {
      // 拿不到就一直显示「统计中」，不编一个 0 出来
    })
  void ipcRenderer
    .invoke('mg:art-archive-stats')
    .then((usage: typeof artArchiveUsage) => {
      artArchiveUsage = usage ?? null
      render()
    })
    .catch(() => {
      // 同上：拿不到就一直显示「统计中」，不编一个 0 出来
    })
  void ipcRenderer
    .invoke('mg:bgm-archive-stats')
    .then((usage: typeof bgmArchiveUsage) => {
      bgmArchiveUsage = usage ?? null
      render()
    })
    .catch(() => {
      // 同上：拿不到就一直显示「统计中」，不编一个 0 出来
    })
  void ipcRenderer
    .invoke('mg:voice-unmatched-stats')
    .then((stats: typeof voiceUnmatchedStats) => {
      voiceUnmatchedStats = stats ?? null
      render()
    })
    .catch(() => {
      // 同上：拿不到就不显示这一行，不编数
    })
  refreshVoiceAbsentLedger()
  refreshLedgerRetention()
}

/** 拉一次「官方没有」台账。分组在渲染时按 shared 那份纯函数算，这里只管取回来。 */
const refreshVoiceAbsentLedger = () => {
  void ipcRenderer
    .invoke('mg:voice-absent')
    .then((list: unknown) => {
      voiceAbsentLedger = Array.isArray(list) ? (list as VoiceAbsentEntry[]) : []
      render()
    })
    .catch(() => {
      // 拿不到就一直显示「统计中」，不编一个 0 出来
    })
}

/** 拉一次账本的保留期设置、占用与按月行数。分组判据在 shared，这里只管取回来。 */
const refreshLedgerRetention = () => {
  void ipcRenderer
    .invoke('mg:ledger-retention')
    .then((report: typeof ledgerRetention) => {
      ledgerRetention = report ?? null
      render()
    })
    .catch(() => {
      // 拿不到就一直显示「统计中」，不编一个 0 出来
    })
}

/** 一行月份：`2026-08 · 12,345 条 [清理]`。两处（账本、语音台账）共用同一条排版。 */
const monthLineHtml = (month: string, count: number, attr: string): string =>
  `<div class="yline"><span class="mono">${esc(month)}</span> · ${count.toLocaleString()} 条
    <span class="ybtn" ${attr}="${esc(month)}">清理</span></div>`

/**
 * 「记录保留与清理」那张卡。两块记录放在一起（账本 + 语音「官方没有」台账）：
 * 它们是同一件事的两处落点，分成两张卡就是两个孤岛。
 *
 * 判据都在 shared，这里只把结果摆出来：
 * 账本走 `planLedgerPrune` / `planLedgerMonthClear`（主进程执行），
 * 语音台账走 `groupVoiceAbsentByMonth` / `voiceAbsentAfterClear`。
 */
const retentionCardHtml = (): string => {
  const days = ledgerRetention?.retentionDays ?? 0
  const state = !ledgerRetention ? '统计中…' : days ? `保留 ${days} 天` : '永久保留'
  const ledgerBlock = !ledgerRetention
    ? '<div class="yline">占用统计中…</div>'
    : `<div class="yline"><b>事件・资源・战斗记录</b>
        <span class="note9">账本文件 ${formatArchiveBytes(ledgerRetention.bytes)}</span></div>
      ${
        ledgerRetention.months.length
          ? ledgerRetention.months
              .map((row) => monthLineHtml(row.month, row.count, 'data-ledger-clear'))
              .join('')
          : '<div class="yline"><span class="note9">暂无记录</span></div>'
      }`
  const voiceBlock = !voiceAbsentLedger
    ? '<div class="yline">占用统计中…</div>'
    : `<div class="yline"><b>语音「官方没有」记录</b>
        <span class="note9">共 ${voiceAbsentLedger.length.toLocaleString()} 条</span></div>
      ${
        voiceAbsentLedger.length
          ? `${groupVoiceAbsentByMonth(voiceAbsentLedger)
              .map((group) => monthLineHtml(group.month, group.count, 'data-absent-clear'))
              .join('')}
            <div class="yline"><span class="ybtn warn" data-absent-clear="all">全部清理</span></div>`
          : '<div class="yline"><span class="note9">暂无记录</span></div>'
      }`
  return `<div class="h"><b>记录保留与清理</b><span class="aux">${esc(state)}</span></div>
      <div class="ynote">保留天数留空 = 永久保留，也可以在下面按月清。
      遭遇志、舰娘人生、道具履历、装备实测与活动履历两种清理都不碰</div>
      <div class="yline">保留天数
        <input class="yin w60" type="number" data-ledger-retention value="${days || ''}"
          min="0" max="${LEDGER_RETENTION_DAYS_MAX}" step="1" placeholder="不限">
        <span class="note9">天 · 留空或 0 = 永久保留（默认）；填了就每天清掉更早的事件、资源、战斗与通知记录</span></div>
      ${ledgerBlock}
      ${voiceBlock}`
}

// ---- 逐卡的渲染出口 ----
//
// 一张卡一个函数，**各自读自己要的那几个配置**。归属表在 shared/settings-sections，
// 下面的注册表按 id 对上去；外壳（`.ycard` 与身份标记 `data-ycard`）由 renderCard
// 统一套上，卡自己不写——身份漏一张，分页和护栏就同时失灵。
//
// 从前这些卡是 render 里一整条模板串，十几次同步跨进程 config 读一趟全做完。
// 拆开之后只有**当前这一类**的卡会被求值，切页签不再顺手把别人的开关也读一遍。

const zoomCardHtml = (): string => {
  const zoom = getUiZoom()
  const zoomChips = [0.9, 1, 1.15, 1.3, 1.5, 1.7]
    .map(
      (z) =>
        `<span class="ychip${Math.abs(zoom - z) < 0.001 ? ' on' : ''}" data-zoom="${z}">${Math.round(z * 100)}%</span>`,
    )
    .join('')
  return `<div class="h"><b>界面缩放</b><span class="aux">即时生效</span></div>
    <div class="yline">${zoomChips}<span class="ylk" data-act="zoom-dec">－</span><span class="ylk" data-act="zoom-inc">＋</span>
      <b style="font-family:var(--mono);color:var(--text)">${Math.round(zoom * 100)}%</b></div>
    <div class="ynote">快捷键 <span class="mono">Ctrl +</span> / <span class="mono">Ctrl -</span> / <span class="mono">Ctrl 0</span>（回到 115%）。</div>`
}

/**
 * 游戏画面的倍率。自适应是从前那一档，默认不变。
 *
 * 档位那一行只在选了固定倍率时摆：自适应下它一个字都用不上，摆着只会让人以为
 * 两栏要各选一个。摆位置的判据在 shared/game-scale，这里只是那张表的界面。
 */
const gameScaleCardHtml = (): string => {
  const mode = getGameScaleMode()
  const step = getGameScaleStep()
  const modeChips = GAME_SCALE_MODES.map(
    (id) =>
      `<span class="ychip${mode === id ? ' on' : ''}" data-game-scale-mode="${id}">${GAME_SCALE_MODE_LABEL[id]}</span>`,
  ).join('')
  const stepChips = GAME_SCALE_STEPS.map(
    (value) =>
      `<span class="ychip${Math.abs(step - value) < 0.001 ? ' on' : ''}" data-game-scale-step="${value}">${Math.round(value * 100)}%</span>`,
  ).join('')
  return `<div class="h"><b>游戏画面</b><span class="aux">即时生效</span></div>
    <div class="yline">${modeChips}</div>
    ${mode === 'lock' ? `<div class="yline">${stepChips}</div>` : ''}
    <div class="ynote">固定倍率四周可能出现黑边</div>`
}

/**
 * 语音字幕的字号。**玩家调的是基准，读数那一格写的是实际生效值**（用户 2026-08-31 拍板）。
 *
 * 两个数都摆出来是因为它们会不一样：实际 = 基准 × 游戏画面当前倍率，固定倍率 75% 时
 * 基准 20 落到屏幕上是 15。只摆基准，玩家改完对不上眼睛看到的；只摆实际，那个数
 * 又不是他能直接选的（倍率不归这张卡管）。
 *
 * 倍率取的是**量出来**的那个（getGameScaleLive），不是选中的档位：自适应根本没有
 * 选中的档，固定倍率装不下时还会自己往下退。
 */
const currentCaptionSize = (): number =>
  normalizeVoiceCaptionSize(config.get(VOICE_CAPTION_SIZE_PATH, VOICE_CAPTION_SIZE_DEFAULT))

/**
 * 改一次字幕字号：落盘 → 当场推给字幕层 → 重画这张卡（两个读数都要跟着变）。
 * 没变就整套不做——顶到上下限时连按加号不该每按一次都写一遍盘、重画一次面板。
 */
const applyCaptionSize = (raw: number) => {
  const next = normalizeVoiceCaptionSize(raw)
  if (next === currentCaptionSize()) return
  config.set(VOICE_CAPTION_SIZE_PATH, next)
  setVoiceCaptionSize(next)
  render()
}

const captionSizeCardHtml = (): string => {
  const base = currentCaptionSize()
  const scale = getGameScaleLive()
  const chips = VOICE_CAPTION_SIZE_CHIPS.map(
    (value) =>
      `<span class="ychip${base === value ? ' on' : ''}" data-caption-size="${value}">${value}px</span>`,
  ).join('')
  return `<div class="h"><b>字幕字号</b><span class="aux">随游戏画面倍率 · 即时生效</span></div>
    <div class="yline">${chips}<span class="ylk" data-act="caption-size-dec">－</span><span class="ylk" data-act="caption-size-inc">＋</span>
      <b style="font-family:var(--mono);color:var(--text)" title="实际字号 = 基准 × 游戏画面当前倍率 ${Math.round(
        scale * 100,
      )}%">基准 ${base}px · 实际 ${effectiveVoiceCaptionPx(base, scale)}px</b></div>`
}

// 抬头那句不能写死「即时生效」：这一卡里最后那条（启动点亮动画）说的是「下次启动生效」,
// 两句摆在同一张卡上就是自相矛盾。改成留个口子，例外由那一条自己说清楚。
const uiHintsCardHtml = (): string => `<div class="h"><b>界面提示</b><span class="aux">即时生效 · 注明的除外</span></div>
  ${toggleHtml(
    'kanso.voiceCaptions',
    '显示语音文字',
    '母港走底部字幕，战斗走双向弹幕',
    config.get('kanso.voiceCaptions', true),
  )}
  ${toggleHtml(
    'kanso.eventBannerEffects',
    '新舰 / 大破 / 应急修理 / 婚礼置顶横幅与外框光效',
    '这几档光效的总闸 · 逐事件的开关在通知里',
    config.get('kanso.eventBannerEffects', true),
  )}
  ${toggleHtml(
    'kanso.sunkEffects',
    '击沉哀悼特效',
    '被击沉时界面失色、卡片碎裂，直到返港',
    config.get('kanso.sunkEffects', true),
  )}
  ${toggleHtml(
    'kanso.buildSpoiler',
    '提前显示建造结果',
    '在预览卡和完成通知里报舰名',
    config.get('kanso.buildSpoiler', false),
  )}
  ${toggleHtml(
    LAUNCH_GLOW_CONFIG_KEY,
    '启动点亮动画',
    '开 kuma 时先放一段入场动画，点一下直接到位 · 下次启动生效',
    config.get(LAUNCH_GLOW_CONFIG_KEY, LAUNCH_GLOW_DEFAULT),
  )}`

const trayCardHtml = (): string => `<div class="h"><b>托盘与后台</b><span class="aux">改动后重启 kuma 生效</span></div>
  ${toggleHtml(
    'kanso.tray.enabled',
    '显示托盘图标',
    '带未读条数，右键切勿扰或退出',
    config.get('kanso.tray.enabled', true),
  )}
  ${toggleHtml(
    'kanso.tray.closeToTray',
    '关闭按钮改为收进托盘',
    '默认关：点 ✕ 就是退出。开了 ✕ 只收起窗口，退出走托盘菜单',
    config.get('kanso.tray.closeToTray', false),
  )}
  ${toggleHtml(
    'kanso.tray.minimizeToTray',
    '最小化时收进托盘',
    '最小化后连任务栏一起收走，只留托盘图标',
    config.get('kanso.tray.minimizeToTray', false),
  )}
  <div class="ynote">收进托盘后从托盘、通知或再次启动都能唤回</div>`

const gameAudioCardHtml = (): string => {
  const rawMode = config.get('kanso.gameAudio.mode', 'all')
  const mode: GameAudioMode = rawMode === 'voice' || rawMode === 'bgm' ? rawMode : 'all'
  const modeChips = GAME_AUDIO_MODES.map(
    ([id, label]) =>
      `<span class="ychip${mode === id ? ' on' : ''}" data-audio-mode="${id}">${label}</span>`,
  ).join('')
  return `<div class="h"><b>游戏声音</b><span class="aux">即时生效</span></div>
    ${audioVolumeHtml('volume', '总音量', readAudioVolume('volume'), 100)}
    ${audioVolumeHtml('voiceVolume', '语音', readAudioVolume('voiceVolume'), 200)}
    ${audioVolumeHtml('bgmVolume', 'BGM', readAudioVolume('bgmVolume'), 200)}
    <div class="yline">${modeChips}</div>
    <div class="ynote">实际音量 = 总音量 × 分项；超过 100% 会放大，可能失真</div>`
}

const proxyCardHtml = (): string => {
  const proxyUse: string = config.get('proxy.use', 'none')
  const kindChips = PROXY_KINDS.map(
    ([kind, label]) =>
      `<span class="ychip${proxyUse === kind ? ' on' : ''}" data-proxy-use="${kind}">${label}</span>`,
  ).join('')
  let proxyDetail = ''
  if (proxyUse === 'socks5' || proxyUse === 'http') {
    // 逐叶子读，与 main/proxy.ts 的读法对齐。提交侧 config.set 写的也是叶子
    // （setByPath 会把 proxy.socks5 就地变成只有 host 的半份对象），
    // 整对象读到这份半份就不再回落默认值：改过主机后端口框空了，
    // 而真正生效的仍是主进程按叶子读到的 1080——显示与生效值从此对不上。
    const host: string = config.get(`proxy.${proxyUse}.host`, '127.0.0.1')
    const port: number = config.get(`proxy.${proxyUse}.port`, proxyUse === 'socks5' ? 1080 : 8118)
    proxyDetail = `<div class="yline">主机 <input class="yin" data-proxy-field="host" value="${esc(host ?? '')}">
      端口 <input class="yin w60" data-proxy-field="port" value="${esc(`${port ?? ''}`)}"></div>`
  } else if (proxyUse === 'pac') {
    const pacAddr: string = config.get('proxy.pacAddr', '')
    proxyDetail = `<div class="yline">PAC 地址 <input class="yin wide" data-proxy-field="pacAddr" value="${esc(pacAddr)}" placeholder="http://…/proxy.pac"></div>`
  }
  const statusTone =
    proxyStatus?.state === 'ok' ? 'ok' : proxyStatus?.state === 'error' ? 'bad' : 'working'
  const statusText = proxyStatus
    ? `${proxyStatus.description} · ${proxyStatus.message}`
    : '正在读取运行状态'
  return `<div class="h"><b>代理</b><span class="aux">保存后即时应用</span></div>
    <div class="yline">${kindChips}</div>
    ${proxyDetail}
    <div class="ystatus ${statusTone}">${esc(statusText)}</div>
    <div class="ynote">游戏与登录流量都走这个代理</div>`
}

/**
 * 游戏页面网址。poi 同款：地址栏摆进设置，玩家自己填。
 *
 * 三件事写在形态里：
 *  · **输入框里就是将要加载的那一条**，占位符是默认值——「填错了会怎样」不用读说明也看得见。
 *  · **写坏了照样能开**。判据在 shared/game-url，装 webview 时回落默认；这里只把
 *    「你填的这条用不上」如实说一声，不悄悄替他改掉输入框里的字（那样他会以为自己没保存上）。
 *    「恢复默认」＝把这一格清空，与说明句「留空就用默认那条」是同一句话、同一种样子。
 *  · **生效要按一下**。顶栏那个刷新按钮重取的是页面此刻停着的 URL，跟这一格无关，
 *    所以自己带一个按钮（主进程侧 yu:reload-game-url 按配置重新导航）。
 */
const gameUrlCardHtml = (): string => {
  const current: string = config.get(GAME_URL_CONFIG_KEY, DEFAULT_GAME_URL)
  const raw = typeof current === 'string' ? current : ''
  const unusable = raw.trim() !== '' && !isValidGameUrl(raw)
  return `<div class="h"><b>游戏页面网址</b><span class="aux">改完按一下重新载入</span></div>
    <div class="yline"><input class="yin wide" data-game-url value="${esc(raw)}"
        placeholder="${esc(DEFAULT_GAME_URL)}">
      <span class="ybtn" data-act="game-url-reset">恢复默认</span></div>
    <div class="yline"><span class="ybtn" data-act="game-url-reload">重新载入游戏页面</span></div>
    ${unusable ? '<div class="ystatus bad">这条不是 http / https 网址，游戏页仍按默认那条加载</div>' : ''}
    ${gameUrlMessage ? `<div class="ystatus ${gameUrlMessage.tone}">${esc(gameUrlMessage.text)}</div>` : ''}
    <div class="ynote">只认 http / https；留空就用默认那条</div>`
}

const loginCardHtml = (): string => {
  const healthText = loginHealth?.lastError
    ? `最近一次保存登录状态失败：${loginHealth.lastError}`
    : loginHealth?.lastFlushedAt
      ? `登录状态已保存 · ${fmtDateTime(loginHealth.lastFlushedAt)}`
      : loginHealth?.lastPersistedAt
        ? `已记住这次登录 · ${fmtDateTime(loginHealth.lastPersistedAt)}`
        : '没有新的 DMM 登录需要记住'
  return `<div class="h"><b>登录与会话</b></div>
    ${toggleHtml('kanso.persistLogin', '保持登录状态', 'DMM 会话延到 180 天，重启一般不用重登', config.get('kanso.persistLogin', true))}
    ${toggleHtml('kanso.dmmcookie', 'DMM 地区 Cookie 兼容', '大陆网络通常要开，关了可能撞区域限制页', config.get('kanso.dmmcookie', true))}
    ${toggleHtml(
      'kanso.remoteArt',
      '未缓存的立绘/语音从游戏资源服务器取',
      '关掉就只读缓存，不再向游戏资源服务器取',
      config.get('kanso.remoteArt', true),
    )}
    <div class="ystatus ${loginHealth?.lastError ? 'bad' : 'ok'}">${esc(healthText)}</div>`
}

const reportCardHtml = (): string => `<div class="h"><b>社区上报</b><span class="aux">默认关</span></div>
  ${toggleHtml('kanso.report.tsundb', 'TsunDB 上报', '把你的带路、掉落和敌编成记录提交给社区数据库', false, true, '上报功能尚未接入')}
  ${toggleHtml('kanso.report.poi', 'poi 统计上报', '把建造、开发和掉落记录提交到 api.poi.moe', false, true, '上报功能尚未接入')}`

const backupCardHtml = (): string => `<div class="h"><b>完整备份与恢复</b><span class="aux">历史数据 · 设置 · 收藏与个人备注</span></div>
  <div class="ynote">单文件打包历史数据库与 <span class="mono">config.json</span>（布局、通知规则、目标、收藏、备注）；
  登录 Cookie、游戏缓存、本地美术和矿脉包不在内。里面可能有代理账号与密码，当账号资料保管。</div>
  <div class="yline"><span class="ybtn" data-act="backup-ledger">创建完整备份</span><span class="ybtn warn" data-act="restore-ledger">从备份恢复并重启</span></div>
  ${backupMessage ? `<div class="ystatus ${backupMessage.startsWith('失败') ? 'bad' : 'ok'}">${esc(backupMessage)}</div>` : ''}`

const cacheRepairCardHtml = (): string => `<div class="h"><b>缓存修复</b><span class="aux">游戏白屏或贴图异常时使用</span></div>
  <div class="ynote">清理游戏缓存后自动重启。
  保留登录 Cookie、配置、事件账本、同步记录、矿脉包、遭遇志与三份档案</div>
  <div class="yline"><span class="ybtn warn" data-act="clear-cache">清理缓存并重启</span></div>`

// 魔改目录由主进程启动时建出来（kcs-resource 的 ensureModDir），这张卡只是把它打开——
// 玩家不必自己新建、也不必去找 %APPDATA%。路径不写在卡上：它跟着缓存路径走，
// 而按钮已经把人直接送到那儿了。
const modDirCardHtml = (): string => `<div class="h"><b>魔改文件夹</b><span class="aux">立绘、语音等游戏素材的本地替换；文件按游戏资源路径摆放</span></div>
  <div class="yline"><span class="ybtn" data-act="open-mod-dir">打开文件夹</span></div>`

const voiceArchiveCardHtml = (): string => `<div class="h"><b>语音档案</b><span class="aux">游戏里听过的语音自动入档</span></div>
  <div class="ynote">游戏播过的语音会转存一份到本机档案，图鉴台词页据此点亮。
  ${
    voiceArchiveUsage
      ? `当前 <b>${formatArchiveBytes(voiceArchiveUsage.bytes)}</b>，留住 ${voiceArchiveUsage.kept} 句，
         另有 ${voiceArchiveUsage.heard} 句只留下「听过」的记录。${archiveLimitNote(voiceArchiveUsage, '句')}`
      : '占用统计中…'
  }${
    voiceUnmatchedStats &&
    (voiceUnmatchedStats.unresolved || voiceUnmatchedStats.noText || voiceUnmatchedStats.noVoiceId)
      ? `<br>字幕没出来的那些分三类记着：${
          voiceUnmatchedStats.noText
            ? `<b>${voiceUnmatchedStats.noText}</b> 条认得出是谁在说，但本地资料包没有这句的译文；`
            : ''
        }${
          voiceUnmatchedStats.noVoiceId
            ? `<b>${voiceUnmatchedStats.noVoiceId}</b> 条认得出是深海/NPC/短剧、但本地没有那一条；`
            : ''
        }${
          voiceUnmatchedStats.unresolved
            ? `<b>${voiceUnmatchedStats.unresolved}</b> 条连是谁的都认不出。`
            : ''
        }`
      : ''
  }</div>
  ${archiveLimitLine('voice', voiceArchiveUsage)}
  <div class="yline"><span class="ybtn warn" data-act="clear-voice-archive">清空语音档案</span></div>`

const artArchiveCardHtml = (): string => `<div class="h"><b>立绘档案</b><span class="aux">游戏里见过的立绘自动入档</span></div>
  <div class="ynote">游戏取过的立绘会转存一份到本机档案，图鉴立绘页据此点亮。
  ${
    artArchiveUsage
      ? `当前 <b>${formatArchiveBytes(artArchiveUsage.bytes)}</b>，留住 ${artArchiveUsage.kept} 张
         （覆盖 ${artArchiveUsage.forms} 个形态），另有 ${artArchiveUsage.seen} 张只留下「见过」的记录。${archiveLimitNote(
           artArchiveUsage,
           '张',
         )}`
      : '占用统计中…'
  }</div>
  ${archiveLimitLine('art', artArchiveUsage)}
  <div class="yline"><span class="ybtn warn" data-act="clear-art-archive">清空立绘档案</span></div>`

const bgmArchiveCardHtml = (): string => `<div class="h"><b>BGM 档案</b><span class="aux">游戏里响过的 BGM 自动入档</span></div>
  <div class="ynote">游戏放过的 BGM 会转存一份到本机档案，海域卷的 ♪ 试听据此改走本地实物。
  ${
    bgmArchiveUsage
      ? `当前 <b>${formatArchiveBytes(bgmArchiveUsage.bytes)}</b>，留住 ${bgmArchiveUsage.kept} 首，
         另有 ${bgmArchiveUsage.heard} 首只留下「响过」的记录。${archiveLimitNote(
           bgmArchiveUsage,
           '首',
         )}`
      : '占用统计中…'
  }</div>
  ${archiveLimitLine('bgm', bgmArchiveUsage)}
  <div class="yline"><span class="ybtn warn" data-act="clear-bgm-archive">清空 BGM 档案</span></div>`

const diagnosticsCardHtml = (): string => {
  // 已知噪音（如 ResizeObserver 的再跑一轮通知）不算出错，否则这张卡片会常年报红
  const crashes = crashLog().filter((r) => !r.benign)
  return `<div class="h"><b>运行诊断</b><span class="aux">${
    crashes.length ? `本次运行 ${crashes.length} 处出错` : '本次运行未出错'
  }</span></div>
    <div class="ynote">每一条都记进 <span class="mono">${esc(appdataPath)}\\crash.log</span>。
    顶栏出现 <b>⚠</b> 角标时点它可以直接翻本次记录。</div>
    ${
      crashes.length
        ? `<div class="ystatus bad">${esc(
            crashes
              .slice(0, 3)
              .map((r) => `${r.scope}${r.count > 1 ? ` ×${r.count}` : ''}：${r.message}`)
              .join('\n'),
          )}</div>`
        : ''
    }
    <div class="yline"><span class="ybtn" data-act="open-crash-log">打开 crash.log</span></div>`
}

const lodePacksCardHtml = (): string => {
  const lodeRows = lodes
    .map(
      (meta) => `<tr><td class="mono">${esc(meta.id)}</td><td>${esc(meta.name)}</td>
        <td class="dim">${esc(lodeCredit(meta))}</td></tr>`,
    )
    .join('')
  return `<div class="h"><b>矿脉数据包</b><span class="aux">共 ${lodes.length} 包 · 「谁说的、多新」</span></div>
    <table class="ytable"><tbody>${
      lodeRows ||
      `<tr><td class="dim">${
        // 「上面那张卡列出了缺哪些」这句从前指的是矿脉健康度——而那张卡
        // 2026-08-24 起只在调试态装配，发行版里根本没有「上面那张卡」。
        // 这一格是玩家真会看到的，所以话要自己站得住，并且给一条他能做的事。
        lodesLoaded ? '一个数据包都没有，多半是文件损坏，重装一次即可' : '加载中…'
      }</td></tr>`
    }</tbody></table>
    <div class="ynote">用户包目录 <span class="mono">${esc(appdataPath)}\\lodes</span> 内同 id 的文件会覆盖内置包。</div>`
}

const aboutCardHtml = (): string => `<div class="h"><b>关于</b></div>
  <div class="ynote">kuma · 让各类信息彼此联动的舰队工作台。
  数据目录 <span class="mono">${esc(appdataPath)}</span>；事件账本默认永久保留，
  按月清理在「档案 · 记录保留与清理」里。</div>`

/**
 * 卡 id → 渲染出口。类型钉成 `Record<SettingsCardId, …>`：
 * shared 那份表里新增一张卡却忘了在这里接上，tsc 当场报错，不会静默少一张。
 */
const CARD_HTML: Record<SettingsCardId, () => string> = {
  zoom: zoomCardHtml,
  'game-scale': gameScaleCardHtml,
  'caption-size': captionSizeCardHtml,
  'ui-hints': uiHintsCardHtml,
  tray: trayCardHtml,
  'game-audio': gameAudioCardHtml,
  'game-audio-selftest': gameAudioSelfTestCardHtml,
  'voice-archive': voiceArchiveCardHtml,
  'art-archive': artArchiveCardHtml,
  'bgm-archive': bgmArchiveCardHtml,
  retention: retentionCardHtml,
  backup: backupCardHtml,
  proxy: proxyCardHtml,
  'game-url': gameUrlCardHtml,
  login: loginCardHtml,
  push: pushCardHtml,
  report: reportCardHtml,
  'lode-health': lodeHealthCardHtml,
  'lode-packs': lodePacksCardHtml,
  'lode-license': lodeCreditCardHtml,
  'cache-repair': cacheRepairCardHtml,
  'mod-dir': modDirCardHtml,
  diagnostics: diagnosticsCardHtml,
  about: aboutCardHtml,
}

/** 外壳统一在这里套：`data-ycard` 是这张卡在产物里的身份，分页与护栏都认它 */
const renderCard = (id: SettingsCardId): string =>
  `<div class="ycard" data-ycard="${id}">${CARD_HTML[id]()}</div>`

/**
 * 分类子顶栏。**不设「全部」**：十八张卡混在一起正是要治的病。
 * 页签窄了换行（样式表里 flex-wrap），不横向滚——一个面板只留一个滚动条。
 */
const sectionTabsHtml = (): string =>
  `<div class="ytabs">${SETTINGS_SECTIONS.map(
    (section) =>
      `<span class="ytab${section.id === activeSection ? ' on' : ''}" data-ysection="${section.id}">${esc(section.label)}</span>`,
  ).join('')}</div>`

const render = () => {
  if (!pane) return
  withViewStateKept(pane, () => {
    pane.innerHTML = `<div class="yu-app">${sectionTabsHtml()}${settingsCardsOf(
      activeSection,
      DEBUG_UI,
    )
      .map(renderCard)
      .join('')}</div>`
  })
}

registerModule({
  id: 'yu',
  title: '设置',
  order: 8.8,
  mount(el) {
    pane = el
    // 面板开着时出了新错误就刷一下诊断卡片。这个回调抛异常会被记账层吞掉
    // （它自己就在 catch 里），不会反过来变成新的崩溃，也不会递归。
    // 只在可见时重绘：render 要把当前这一类的卡连同同步跨进程 config 读全做一遍，
    // 错误风暴（每秒重复 emit 同一条）时藏在暂存区的面板也跟着抖就纯放大卡顿；
    // 收着时攒下的错误由 onShow 的 render 一次补上。
    // 可见时也要合并：一帧最多重绘一次，否则一串崩溃就是一串全量重建，
    // 而人眼在一帧内根本分不出中间那几版。
    let crashRenderFrame = 0
    const scheduleCrashRender = () => {
      if (crashRenderFrame || !pane.classList.contains('active')) return
      crashRenderFrame = requestAnimationFrame(() => {
        crashRenderFrame = 0
        if (pane.classList.contains('active')) render()
      })
    }
    const offCrash = onCrash(scheduleCrashRender)
    trackMountCleanup(() => {
      offCrash()
      if (crashRenderFrame) cancelAnimationFrame(crashRenderFrame)
      crashRenderFrame = 0
    })
    // 拖动期间每个 input 事件都同步 config.set = 一次阻塞 remote 调用 + 一次原子写盘，
    // 滑条肉眼发涩。150ms 尾随去抖：音量跟手感知不到延迟，写盘从几十次收敛到一两次。
    const volumeCommitTimers = new Map<string, ReturnType<typeof setTimeout>>()
    el.addEventListener('input', (e) => {
      const input = (e.target as HTMLElement).closest<HTMLInputElement>('input[data-audio-volume]')
      if (!input) return
      const field = input.dataset.audioVolume
      if (!isAudioVolumeField(field)) return
      const percent = clampAudioPercent(field, Number(input.value))
      const value = el.querySelector<HTMLElement>(`[data-audio-value="${field}"]`)
      if (value) value.textContent = `${Math.round(percent)}%`
      const pending = volumeCommitTimers.get(field)
      if (pending) clearTimeout(pending)
      volumeCommitTimers.set(
        field,
        setTimeout(() => {
          volumeCommitTimers.delete(field)
          config.set(`kanso.gameAudio.${field}`, percent / 100)
        }, 150),
      )
    })
    el.addEventListener('change', (e) => {
      const audioInput = (e.target as HTMLElement).closest<HTMLInputElement>(
        'input[data-audio-volume]',
      )
      if (audioInput) {
        // 松手时立即落盘（change 可能赶在去抖计时器之前，先冲掉再重绘，
        // 否则 render 读到旧值、滑条弹回去）
        const field = audioInput.dataset.audioVolume
        if (isAudioVolumeField(field)) {
          const pending = volumeCommitTimers.get(field)
          if (pending) {
            clearTimeout(pending)
            volumeCommitTimers.delete(field)
            config.set(`kanso.gameAudio.${field}`, clampAudioPercent(field, Number(audioInput.value)) / 100)
          }
        }
        render()
        return
      }
      const idleInput = (e.target as HTMLElement).closest<HTMLInputElement>(
        'input[data-push-minutes]',
      )
      if (idleInput) {
        // 区间只有 shared 那一份（clampPushIdleMinutes）；界面 min/max 与它同源。
        // 空框/乱填一律回默认值，绝不写 0 进去——0 分钟等于把门槛悄悄关掉。
        const minutes = clampPushIdleMinutes(idleInput.value)
        config.set(PUSH_CONFIG_PATHS.presenceIdleMinutes, minutes)
        setPushPresence(
          config.get(PUSH_CONFIG_PATHS.presenceHold, PUSH_DEFAULTS.presenceHold) !== false,
          minutes,
        )
        pushMessage = null
        render()
        return
      }
      const limitInput = (e.target as HTMLElement).closest<HTMLInputElement>(
        'input[data-archive-limit]',
      )
      if (limitInput) {
        // 留空、0、负数、乱填一律回**不限量**（与主进程 archiveLimitBytes 同一条判据）。
        // 这与推送那个门槛相反：那边 0 等于把门槛关掉所以要拒，这边 0 就是「不设上限」，
        // 而不设上限正是默认值，落到同一个行为上才不会因为写法差异变成会淘汰。
        const raw = limitInput.dataset.archiveLimit
        const kind = raw === 'art' || raw === 'bgm' ? raw : 'voice'
        const mb = Number.parseInt(limitInput.value, 10)
        const configKey =
          kind === 'art'
            ? 'kanso.archive.artMaxMB'
            : kind === 'bgm'
              ? 'kanso.archive.bgmMaxMB'
              : 'kanso.archive.voiceMaxMB'
        config.set(configKey, Number.isInteger(mb) && mb > 0 ? mb : 0)
        // 改完立刻重新统计：上限变了，「满没满」「有多少不可再得」都要重算
        refreshVoiceArchiveUsage()
        render()
        return
      }
      const retentionInput = (e.target as HTMLElement).closest<HTMLInputElement>(
        'input[data-ledger-retention]',
      )
      if (retentionInput) {
        // 留空、0、负数、乱填一律回**永久保留**（与主进程 planLedgerPrune 同一条判据）。
        // 与推送那个门槛相反：那边 0 等于把门槛悄悄关掉所以要拒，这边 0 就是默认值。
        config.set('kanso.ledger.retentionDays', clampLedgerRetentionDays(retentionInput.value))
        // 抬头那句「永久保留 / 保留 N 天」要跟着变，重新问一次主进程
        refreshLedgerRetention()
        render()
        return
      }
      const pushInput = (e.target as HTMLElement).closest<HTMLInputElement>('input[data-push-field]')
      if (pushInput) {
        // 逐叶子写（与 readPushSettings 的读法对齐）。整对象写会把这一份
        // 半成品覆盖掉别的叶子，改完服务器就把频道名抹了。
        const field = pushInput.dataset.pushField
        if (!isPushInputField(field)) return
        config.set(PUSH_CONFIG_PATHS[field], pushInput.value.trim())
        pushMessage = null // 改了配置，上一次的测试结论不再作数
        render()
        return
      }
      const gameUrlInput = (e.target as HTMLElement).closest<HTMLInputElement>('input[data-game-url]')
      if (gameUrlInput) {
        // 原样存他填的那一串（只去掉首尾空白）。**不在这里替他纠正**：
        // 认不出的值由装 webview 那一侧回落到默认，界面另有一条红字说明用不上——
        // 悄悄把输入框改回默认，他会以为自己压根没保存上，然后再填一遍。
        config.set(GAME_URL_CONFIG_KEY, gameUrlInput.value.trim())
        gameUrlMessage = null // 网址变了，上一次「已重新载入」不再作数
        render()
        return
      }
      const input = (e.target as HTMLElement).closest<HTMLInputElement>('input[data-proxy-field]')
      if (!input) return
      const field = input.dataset.proxyField!
      const use: string = config.get('proxy.use', 'none')
      if (field === 'pacAddr') {
        config.set('proxy.pacAddr', input.value.trim())
      } else if (use === 'socks5' || use === 'http') {
        if (field === 'port') {
          // 空框不写：parseInt('') || 0 会把 0 号端口真存进配置，主进程随即
          // 按 host:0 应用代理（连原来能用的那份也一起丢了）。什么都不写，
          // 下面的 render 会按叶子把框恢复成当前生效值。
          const port = Number.parseInt(input.value, 10)
          if (Number.isInteger(port) && port > 0 && port <= 65535) {
            config.set(`proxy.${use}.port`, port)
          }
        } else {
          config.set(`proxy.${use}.${field}`, input.value.trim())
        }
      }
      render()
    })
    el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement
      if (t.closest('input')) return
      const sectionTab = t.closest<HTMLElement>('[data-ysection]')
      if (sectionTab) {
        const next = normalizeSettingsSection(sectionTab.dataset.ysection)
        if (next !== activeSection) {
          activeSection = next
          uiSet(SETTINGS_SECTION_UI_KEY, next)
          // 换一类就是换一屏内容，上一类翻到哪儿不该跟过来。归零要赶在
          // withViewStateKept 拍快照**之前**：它只记下当时还在滚的容器，
          // 快照里没有的一律归零——先清零就等于「这一次不还原」。
          const app = pane.querySelector<HTMLElement>('.yu-app')
          if (app) app.scrollTop = 0
          render()
        }
        return
      }
      const act = t.closest<HTMLElement>('[data-act]')?.dataset.act
      const zoomChip = t.closest<HTMLElement>('[data-zoom]')
      if (zoomChip) {
        setUiZoom(parseFloat(zoomChip.dataset.zoom!))
        return
      }
      const gameScaleModeChip = t.closest<HTMLElement>('[data-game-scale-mode]')
      if (gameScaleModeChip) {
        // 重绘是为了那一行档位：换成固定倍率它才出来，换回自适应它才收走
        setGameScaleMode(gameScaleModeChip.dataset.gameScaleMode)
        render()
        return
      }
      const gameScaleStepChip = t.closest<HTMLElement>('[data-game-scale-step]')
      if (gameScaleStepChip) {
        setGameScaleStep(parseFloat(gameScaleStepChip.dataset.gameScaleStep!))
        render()
        return
      }
      const captionSizeChip = t.closest<HTMLElement>('[data-caption-size]')
      if (captionSizeChip) {
        applyCaptionSize(Number(captionSizeChip.dataset.captionSize))
        return
      }
      if (act === 'caption-size-inc') {
        applyCaptionSize(currentCaptionSize() + VOICE_CAPTION_SIZE_STEP)
        return
      }
      if (act === 'caption-size-dec') {
        applyCaptionSize(currentCaptionSize() - VOICE_CAPTION_SIZE_STEP)
        return
      }
      if (act === 'audio-selftest-refresh') {
        readAudioSelfTest()
        return
      }
      if (act === 'zoom-inc') {
        setUiZoom(getUiZoom() + 0.05)
        return
      }
      if (act === 'zoom-dec') {
        setUiZoom(getUiZoom() - 0.05)
        return
      }
      if (act === 'open-crash-log') {
        // 文件可能还不存在（一次没出过错就没写过），交给系统提示比自己伪造一个空文件好
        void ipcRenderer.invoke('kanso:crash-log-path').then((p: string) => {
          void remote.shell.openPath(p).then((error: string) => {
            if (error) alert(`打不开 crash.log：${error}\n路径：${p}`)
          })
        })
        return
      }
      if (act === 'open-notice') {
        // 打开的必须是**产物 resources/ 里那一份**：asar 内的路径 shell.openPath 打不开
        //（路径由主进程给，见 yu:doc-path）。开发态回落到仓库根的那一份。
        void ipcRenderer.invoke('yu:doc-path', 'NOTICE.md').then((p: string) => {
          if (!p) return
          void remote.shell.openPath(p).then((error: string) => {
            if (error) alert(`打不开 NOTICE.md：${error}\n路径：${p}`)
          })
        })
        return
      }
      if (act === 'game-url-reset') {
        // 「恢复默认」就是**把这一格清空**，不是往框里填一遍默认网址。
        // 两种写法效果一样，但填回去的话，「按按钮」与「自己把框删空」会留下两种
        // 长得不一样的界面，而说明句只说了「留空就用默认那条」——对不上的那一种
        // 会让人以为它们是两件事。
        config.set(GAME_URL_CONFIG_KEY, '')
        gameUrlMessage = null
        render()
        return
      }
      if (act === 'game-url-reload') {
        void ipcRenderer
          .invoke('yu:reload-game-url')
          .then((result: { ok: boolean; url: string } | null) => {
            // 找不到游戏页只有一种情况：webview 还没挂上来（刚启动、或刚崩过正在重挂）。
            // 那时候它自己就会按新配置装一遍，所以这句是「等一下再按」而不是报错
            gameUrlMessage = result?.ok
              ? { tone: 'ok', text: `已按 ${result.url} 重新载入` }
              : { tone: 'bad', text: '游戏页面还没就绪，等它出来再按一次' }
            render()
          })
        return
      }
      if (act === 'open-mod-dir') {
        // 目录由主进程那头保证存在（handler 里先 ensure 一次），这里只负责报失败：
        // 开得起来就什么都不弹；开不起来时要是静静地什么也不发生，比弹一句原因更让人无从下手
        void ipcRenderer
          .invoke('yu:open-mod-dir')
          .then((result: { ok: boolean; path: string; message: string } | null) => {
            if (result && !result.ok) {
              alert(`打不开魔改文件夹：${result.message || '未知原因'}\n路径：${result.path}`)
            }
          })
        return
      }
      if (act === 'clear-cache') {
        if (confirm('清理游戏缓存并重启 kuma？\n（登录状态、账本、配置、矿脉包、语音档案均保留）')) {
          void ipcRenderer.invoke('yu:clear-cache-restart')
        }
        return
      }
      if (act === 'clear-voice-archive') {
        // 说清后果再问：这些音频过季就再也收不回来了，不能用一句轻飘飘的「确定吗」带过
        if (
          confirm(
            '清空语音档案？\n' +
              '图鉴台词页上已点亮的格子会全部熄灭。\n' +
              '季节限定语音过季后游戏不再播放，请谨慎清除。',
          )
        ) {
          void ipcRenderer.invoke('mg:voice-archive-clear').then(() => {
            voiceArchiveUsage = null
            refreshVoiceArchiveUsage()
          })
        }
        return
      }
      if (act === 'clear-bgm-archive') {
        // 说清后果再问：活动曲随活动撤场，撤场之后档案里这一份就是唯一来源了
        if (
          confirm(
            '清空 BGM 档案？\n' +
              '海域卷的 ♪ 试听会退回「有缓存才响、没缓存要联网现取」。\n' +
              '活动曲随活动撤场，撤场之后游戏里不会再放。\n' +
              '清空后可能无法恢复，请谨慎清除。',
          )
        ) {
          void ipcRenderer.invoke('mg:bgm-archive-clear').then(() => {
            bgmArchiveUsage = null
            refreshVoiceArchiveUsage()
          })
        }
        return
      }
      if (act === 'clear-art-archive') {
        // 说清后果再问：季节立绘过季、活动限定深海舰撤场后就再也收不回来了，
        // 不能用一句轻飘飘的「确定吗」带过
        if (
          confirm(
            '清空立绘档案？\n' +
              '图鉴立绘页上已点亮的格子会全部熄灭。\n' +
              '季节限定立绘过季就换回去了，活动限定深海舰的图在活动撤场后也再见不到。\n' +
              '清空后无法恢复，请谨慎清除。',
          )
        ) {
          void ipcRenderer.invoke('mg:art-archive-clear').then(() => {
            artArchiveUsage = null
            refreshVoiceArchiveUsage()
          })
        }
        return
      }
      const ledgerClear = t.closest<HTMLElement>('[data-ledger-clear]')
      if (ledgerClear) {
        // 说清后果再问：这些是原始记录，删掉之后那段时间的统计与复盘就算不回来了。
        // 永久表（遭遇志、精矿、活动履历）不在删除范围里，所以那一句要如实说出来——
        // 不然玩家会以为按下去连自己的遭遇志一起没了。
        const month = `${ledgerClear.dataset.ledgerClear ?? ''}`
        const count = ledgerRetention?.months.find((row) => row.month === month)?.count ?? 0
        if (!count) return
        if (
          !confirm(
            `清理 ${month} 的 ${count.toLocaleString()} 条记录？\n` +
              '那段时间的事件、资源与战斗记录会删掉，相关统计和复盘就算不回来了。\n' +
              '遭遇志、舰娘人生、道具履历、装备实测与活动履历不受影响。',
          )
        ) {
          return
        }
        void ipcRenderer.invoke('mg:ledger-clear-month', { month }).then(() => {
          ledgerRetention = null
          refreshLedgerRetention()
        })
        return
      }
      const absentClear = t.closest<HTMLElement>('[data-absent-clear]')
      if (absentClear) {
        // 后果轻（清掉只是让那些格子回到可探测态，点一下就再问一次官方），
        // 但钥里的删除动作一律先问一声，这里随惯例——把「会发生什么」写清楚，
        // 不用一句轻飘飘的「确定吗」带过。
        const raw = `${absentClear.dataset.absentClear ?? ''}`
        const month = raw === 'all' ? null : raw
        const count =
          month == null
            ? (voiceAbsentLedger?.length ?? 0)
            : (groupVoiceAbsentByMonth(voiceAbsentLedger).find((g) => g.month === month)?.count ??
              0)
        if (!count) return
        const what =
          month == null ? `全部 ${count.toLocaleString()} 条` : `${month} 的 ${count} 条`
        if (!confirm(`清理 ${what}「官方没有」记录？\n这些格子回到可探测状态，可重新核实。`)) {
          return
        }
        void ipcRenderer.invoke('mg:voice-absent-clear', { month }).then(() => {
          voiceAbsentLedger = null
          refreshVoiceAbsentLedger()
          // 台词卷正开着的话，那些格子当场回到探测态（重取索引 + 广播重画）
          void reloadVoiceAbsent()
        })
        return
      }
      if (act === 'backup-ledger') {
        void ipcRenderer.invoke('yu:backup-ledger').then((result: any) => {
          if (result?.ok) backupMessage = `备份完成：${result.path}`
          else if (!result?.canceled) backupMessage = `失败：${result?.message ?? '无法创建备份'}`
          render()
        })
        return
      }
      if (act === 'restore-ledger') {
        if (confirm('从完整备份恢复会覆盖当前历史记录、设置、收藏与个人备注并自动重启。\n旧版备份文件只恢复历史记录。是否继续？')) {
          void ipcRenderer.invoke('yu:restore-ledger').then((result: any) => {
            if (!result?.ok && !result?.canceled) {
              backupMessage = `失败：${result?.message ?? '无法恢复备份'}`
              render()
            }
          })
        }
        return
      }
      if (act === 'push-gentopic') {
        // 频道名即口令：随机源与字母表跟发送那一侧同源（主进程 shared），
        // 渲染层不自备一套。生成后原样显示出来，供用户抄进手机上的 ntfy。
        void ipcRenderer.invoke('push:generate-topic').then((topic: string) => {
          if (!topic) return
          config.set(PUSH_CONFIG_PATHS.ntfyTopic, topic)
          pushMessage = {
            tone: 'ok',
            text: `已生成频道名：${topic}\n在手机的 ntfy 里 Subscribe 这个名字（频道名即口令，请勿公开）。`,
          }
          render()
        })
        return
      }
      if (act === 'push-genkey') {
        // 随机源与长度口径跟加密那一侧同源（主进程 shared/push-payload），
        // 渲染层不自备一套。生成后原样显示出来，供用户抄进 Bark App。
        void ipcRenderer.invoke('push:generate-key').then((key: string) => {
          if (!key) return
          config.set(PUSH_CONFIG_PATHS.barkKey, key)
          pushMessage = { tone: 'ok', text: `已生成密钥：${key}\n把它填进 Bark App 的「推送加密」（AES128 / CBC / PKCS7），两边必须一致。` }
          render()
        })
        return
      }
      if (act === 'push-test') {
        // 用户主动点击 = 允许的出站动作。走的是和真通知完全相同的那一条路径，
        // 不另开后门，所以「未启用/地址没填」也会如实报出来。
        // 唯一豁免的是在场门槛（immediate）：点按钮的人正坐在电脑前盯着手机等它响，
        // 「暂缓到你离开」在这里等于按钮坏了。豁免只此一处，铃从不带这个标。
        pushMessage = { tone: 'working', text: '正在发送……' }
        render()
        void ipcRenderer
          .invoke('push:send', {
            title: 'kuma · 测试推送',
            body: 'kuma 测试推送',
            group: 'kuma · 测试',
            immediate: true,
          })
          .then((result: { ok?: boolean; message?: string } | null) => {
            pushMessage = { tone: result?.ok === true ? 'ok' : 'bad', text: result?.message ?? '没有收到回报' }
            render()
          })
          .catch((error: unknown) => {
            pushMessage = { tone: 'bad', text: `发送失败：${error instanceof Error ? error.message : error}` }
            render()
          })
        return
      }
      const providerChip = t.closest<HTMLElement>('[data-push-provider]')
      if (providerChip) {
        const provider = providerChip.dataset.pushProvider
        if ((PUSH_PROVIDERS as readonly string[]).includes(provider ?? '')) {
          config.set(PUSH_CONFIG_PATHS.provider, provider)
          pushMessage = null // 换了目标，上一次的测试结论不再作数
          render()
        }
        return
      }
      const useChip = t.closest<HTMLElement>('[data-proxy-use]')
      if (useChip) {
        config.set('proxy.use', useChip.dataset.proxyUse)
        render()
        return
      }
      const audioModeChip = t.closest<HTMLElement>('[data-audio-mode]')
      if (audioModeChip) {
        const mode = audioModeChip.dataset.audioMode
        if (mode === 'all' || mode === 'voice' || mode === 'bgm') {
          config.set('kanso.gameAudio.mode', mode)
          render()
        }
        return
      }
      const toggle = t.closest<HTMLElement>('[data-toggle]')
      if (toggle) {
        const key = toggle.dataset.toggle!
        // 这几个默认开，取反时要按各自默认值读，否则第一次点会「开→开」
        const dflt = [
          'kanso.persistLogin',
          'kanso.dmmcookie',
          'kanso.remoteArt',
          'kanso.voiceCaptions',
          'kanso.eventBannerEffects',
          'kanso.sunkEffects',
          'kanso.tray.enabled',
          // 推送的三项保护默认开：取反时按各自默认读，否则第一次点会「开→开」
          PUSH_CONFIG_PATHS.barkEncrypt,
          PUSH_CONFIG_PATHS.titleOnly,
          PUSH_CONFIG_PATHS.presenceHold,
        ].includes(key)
        const next = !config.get(key, dflt)
        config.set(key, next)
        if (key === 'kanso.remoteArt') {
          setAllowRemoteArt(next)
          setAllowRemoteVoice(next)
        } else if (key === 'kanso.voiceCaptions') {
          setVoiceCaptionsEnabled(next)
        } else if (key === 'kanso.eventBannerEffects') {
          setEventBannerEffectsEnabled(next)
        } else if (key === 'kanso.sunkEffects') {
          setSunkEffectsEnabled(next)
        } else if (key === 'kanso.buildSpoiler') {
          setBuildSpoilerEnabled(next)
        } else if (key === LAUNCH_GLOW_CONFIG_KEY) {
          // 顶栏浮层那半段归同一个开关，而它是**当场生效**的：关掉连正在演的那一次
          // 也一并收掉，开着的话下次点开浮层就有。开机那一场当然只能下次启动才见得到
          // （说明里写的就是这件事），但没道理为了它把浮层这半段也一起吊到重启。
          setOverlayEntranceEnabled(next)
        } else if (key === PUSH_CONFIG_PATHS.enabled) {
          // 铃那边只拿它显示「总开关开没开」这行小字；发不发仍由主进程说了算
          setPushEnabled(next)
        } else if (key === PUSH_CONFIG_PATHS.presenceHold) {
          // 同上：铃拿它掐补发轮询的节拍，在场判定仍在主进程。
          // 关掉门槛时铃会把攒着的那些立刻补出去。
          setPushPresence(
            next,
            clampPushIdleMinutes(
              config.get(
                PUSH_CONFIG_PATHS.presenceIdleMinutes,
                PUSH_DEFAULTS.presenceIdleMinutes,
              ),
            ),
          )
        }
        if (key.startsWith('kanso.push.')) pushMessage = null
        render()
      }
    })
    onUiZoom(() => render())
    setAllowRemoteArt(config.get('kanso.remoteArt', true))
    setAllowRemoteVoice(config.get('kanso.remoteArt', true))
    setVoiceCaptionsEnabled(config.get('kanso.voiceCaptions', true))
    setEventBannerEffectsEnabled(config.get('kanso.eventBannerEffects', true))
    setSunkEffectsEnabled(config.get('kanso.sunkEffects', true))
    setBuildSpoilerEnabled(config.get('kanso.buildSpoiler', false))
    setOverlayEntranceEnabled(config.get(LAUNCH_GLOW_CONFIG_KEY, LAUNCH_GLOW_DEFAULT))
    // 进程级监听不随面板 innerHTML 生灭，重试装配会再挂一份：
    // 同一条推送重绘两遍（且旧那份还攥着上一张面板）。在 mount 同步段挂退订。
    const onProxyStatus = (_event: unknown, status: typeof proxyStatus) => {
      proxyStatus = status
      render()
    }
    ipcRenderer.on('yu:proxy-status', onProxyStatus)
    trackMountCleanup(() => ipcRenderer.removeListener('yu:proxy-status', onProxyStatus))
    const onLoginHealth = (_event: unknown, health: typeof loginHealth) => {
      loginHealth = health
      render()
    }
    ipcRenderer.on('yu:login-health', onLoginHealth)
    trackMountCleanup(() => ipcRenderer.removeListener('yu:login-health', onLoginHealth))
    void (async () => {
      mapIntelError = null // 重新装配就是重读一次，先把上一轮的失败清掉
      ;[lodes, appdataPath, proxyStatus, loginHealth] = await Promise.all([
        ipcRenderer.invoke('lode:list'),
        ipcRenderer.invoke('yu:appdata-path'),
        ipcRenderer.invoke('yu:proxy-status'),
        ipcRenderer.invoke('yu:login-health'),
        // 活动图底座单独探一次：覆盖统计已经改读**装配之后**那份目录，
        // 不再依赖这个包；这一探留着只为分清「包坏了/IPC 断了」与「本来就没装」。
        // 「包不存在」由 queryLode 返回 null 表达（底座永不随包，玩家那边就是 null，
        // 缺包由上面那行「缺 N 包」如实报），抛出来的才是读取出错。
        queryLode('map-intel').catch((error: unknown) => {
          mapIntelError = error instanceof Error ? error.message : String(error)
          console.warn('[kanso] 读取 map-intel 数据包失败：', error)
          return null
        }),
      ])
      lodes ??= []
      lodesLoaded = true
      appdataPath ??= ''
      render()
    })()
    render()
  },
  onShow: () => {
    // 档案占用每次打开设置时重取一次：它会因为玩游戏而增长，缓存住会越看越旧
    refreshVoiceArchiveUsage()
    render()
  },
})
