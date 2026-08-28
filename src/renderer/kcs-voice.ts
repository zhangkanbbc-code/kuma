// 舰娘语音的取音。与立绘同一套纪律：本地缓存优先，未缓存回退游戏资源服务器
// （kcs 静态音频不是 kcsapi，取它等于游戏自己播一句，不改状态、不产生玩家行为）。
//
// **编号 → 文件名 → 路径**那三段推导住在 shared/voice-sound-path（含 MIT 出处署名）：
// 本文件顶上就 require 了 `@electron/remote`，脱开 Electron 连 import 都做不到，
// 而那三段是「写反了不报错、只是某天悄悄少一格」的逻辑，护栏必须能真的调用它。
// 路径形状取自 poi-plugin-subtitle 监听用的正则 /kcs\/sound\/(.*?)\/(.*?).mp3/，
// 目录名 = 'kc' + api_mst_shipgraph[].api_filename。
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')
const remote = require('@electron/remote')
const { ipcRenderer } = require('electron')

import {
  EXTRA_VOICE_DIRS,
  VOICE_KEYS,
  directVoiceIdOf,
  encodeVoiceFile,
  isPlayableVoiceId,
  parseVoiceSoundPath,
  voiceSoundPathname,
} from '../shared/voice-sound-path'

// 取址三段（编号 → 文件名 → 路径）住在 shared，这里原样转发：既有调用方一处不用改，
// 而护栏能脱开 Electron 真跑一遍那三段。
export { encodeVoiceFile, isPlayableVoiceId }

const CACHE_PATH: string = remote.getGlobal('DEFAULT_CACHE_PATH')
const { getCacheCandidatePaths } = require(
  path.join(remote.getGlobal('ROOT'), 'assets', 'preload', 'kcs-resource-path'),
)

// 141/241 曾被注成「结婚语音」——**是错的**，它们是西村艦隊那两条未混淆的
// 联合舰队台词（下面 resolveVoiceRequest 的注释一直是对的，两处早就打架）。
// 婚礼台词是常规的 **24 号槽**（ケッコンカッコカリ），走混淆算法；
// 28 号槽是婚后母港的日常台词。矿脉实证：wikiwiki-voice 61 艘的 24 号槽场景名
// 全是「ケッコンカッコカリ」，subtitle-ja/zh 各 758 艘有这个键，而 141/241
// 只有 4 艘（43/145/243/961）且原文都是「西村艦隊、これより主力部隊を援護するよ！」。

// mstId → api_filename（来自 api_mst_shipgraph；主数据到位后由 setShipGraph 灌入）
let graphOf = new Map<number, string>()
let idsByFilename = new Map<string, number[]>()
export const setShipGraph = (mstShipgraph: any[]) => {
  const m = new Map<number, string>()
  const reverse = new Map<string, number[]>()
  for (const g of mstShipgraph ?? []) {
    if (g?.api_id && g?.api_filename) {
      const id = Number(g.api_id)
      const filename = `${g.api_filename}`
      m.set(id, filename)
      reverse.set(filename, [...(reverse.get(filename) ?? []), id])
    }
  }
  graphOf = m
  idsByFilename = reverse
}

/** 该形态音轨目录名（api_mst_shipgraph 的 api_filename）。主数据没到位时 null。 */
export const voiceFilenameOf = (mstId: number): string | null => graphOf.get(mstId) ?? null

// 三个额外目录各写成独立成员（不是 `kind: 'npc' | 'enemy' | 'skit'` 一条）：
// 合成一条的话 `Extract<VoiceRequestCue, { kind: 'npc' | 'enemy' }>` 会得到 never，
// 消费端的窄化全部失效。
export type VoiceRequestCue =
  | { kind: 'ship'; mstId: number; voiceId: number }
  | { kind: 'npc'; voiceId: string }
  | { kind: 'enemy'; voiceId: string }
  | { kind: 'skit'; voiceId: string }

/**
 * 游戏语音 URL → 舰娘 mstId / 台词编号，或额外音轨 / 台词文件名。
 *
 * ---- 编号 ≤53 才混淆，54 起一律裸编号直出（2026-08-22 查实）----
 * 一手依据是 KC3Kai `src/library/modules/Meta.js` 的 `getFilenameByVoiceLine`：
 *   `lineNum <= 53 ? 100000 + 17*(ship_id+7)*diffs[lineNum-1] % 99173 : lineNum`
 * 此前这里只硬编码了 `0 / 141 / 241` 三个裸编号——那是 poi-plugin-subtitle 的局限
 *（它 `getVoiceMap()` 里只写了 141/241，注释还标着 HACK），不是游戏的局限。
 * 于是本机台账里 Richelieu改 与 大和改二重 的 `900.mp3` 被记成「认不出」16+7 次。
 * 已知的裸编号族（KC3Kai `Translation.js` 的 `_descToId` 表 + GotoBrowser
 * 的 `quotes_label.json` 双源一致）：
 *   129 = 放置②（好感/士气 ≥50）；141~161 / 241~261 / 342~350 = 友军舰队（末两位是海域）；
 *   900 = 特殊攻击（SpCutin），901~903 按二番舰分支，990~993 是金刚型夜战僚舰分支；
 *   917 / 918 = Graf Zeppelin 系专用夜战。
 * 所以判据改成**值域**而不是白名单：小于混淆下界的整数就是裸编号。
 * 认出归属之后，本地矿脉没有这一条译文是另一回事——台账里会如实记成
 * 「归属可解、无译文」，与「路径认不出」分开。
 *
 * kc9998 是深海战斗音轨，kc9999 是大淀、明石等 NPC 音轨，kc9997 是**短剧/群像**
 *（多位舰娘同台的一段演出，如西村舰队出击前的对白）。三者都没有单一 mstId 归属，
 * 保留音频文件名交给各自的本地字幕矿脉精确匹配。
 */
export const resolveVoiceRequest = (rawUrl: string): VoiceRequestCue | null => {
  const parsed = parseVoiceSoundPath(rawUrl)
  if (!parsed) return null
  const { dir: filename, encoded } = parsed
  if (filename === EXTRA_VOICE_DIRS.skit) return { kind: 'skit', voiceId: encoded }
  if (filename === EXTRA_VOICE_DIRS.enemy) return { kind: 'enemy', voiceId: encoded }
  if (filename === EXTRA_VOICE_DIRS.npc) return { kind: 'npc', voiceId: encoded }
  const ids = idsByFilename.get(filename) ?? []
  const direct = directVoiceIdOf(encoded)
  for (const mstId of ids) {
    if (direct != null) return { kind: 'ship', mstId, voiceId: direct }
    for (let voiceId = 1; voiceId <= VOICE_KEYS.length; voiceId++) {
      if (encodeVoiceFile(mstId, voiceId) === encoded) {
        return { kind: 'ship', mstId, voiceId }
      }
    }
  }
  return null
}

let gameHost: string | null = null
export const setVoiceHost = (host: string | null) => {
  gameHost = host && /^[\w.-]+$/.test(host) ? host : null
}
let allowRemote = true
export const setAllowRemoteVoice = (v: boolean) => {
  allowRemote = v
}

const cachedFile = (pathname: string): string | null => {
  const candidates: string[] = getCacheCandidatePaths(CACHE_PATH, pathname)
  for (const file of candidates) {
    try {
      fs.accessSync(file, fs.constants.R_OK)
      return file
    } catch (_e) {
      /* 试下一个 */
    }
  }
  return null
}

/**
 * 该舰某条语音的可播放 URL。
 * 返回 null 的三种情况都不同，调用方要分别措辞，别混成「没有」：
 * 缺 shipgraph（主数据没同步）/ 该 voiceId 不在可算范围 / 既没缓存又不许回退。
 */
export const voiceUrl = (mstId: number, voiceId: number): string | null => {
  const pathname = voicePathname(mstId, voiceId)
  if (!pathname) return null
  const file = cachedFile(pathname)
  if (file) return pathToFileURL(file).href
  // 未缓存时回退游戏自己的资源服务器，**受钥里那个开关管**——
  // 与立绘同一个开关（`kanso.remoteArt`，钥里写的就是「未缓存的立绘/语音…」）。
  // 三类网络边界（kcsapi 红线 / 静态资源白区受开关 / 档案零网络）
  // 写在 main/archive-capture 的文件头，别在这里各记一份。
  return allowRemote && gameHost ? `https://${gameHost}${pathname}` : null
}

/**
 * 该舰某个语音槽位在游戏资源树里的路径。**它是档案里的身份**——
 * 取音轨、判点亮、入档三处必须用同一份推导（那一份在 shared/voice-sound-path），
 * 各写一份必然漂移，而漂移的表现是「播得出来却不点亮」，不报错。
 */
export const voicePathname = (mstId: number, voiceId: number): string | null =>
  voiceSoundPathname(graphOf.get(mstId) ?? null, mstId, voiceId)

/**
 * 「播放即入档」：艦素自己刚把这一句播出去了，顺手让主进程留一份进档案。
 *
 * 此前语音档案只有一条进货渠道——**游戏页面**播放时锚在 onBeforeRequest 里挂钩。
 * 玩家在图鉴里点播放钮同样是「这一句在这台机器上响过」，一样该入档；
 * 而且入档之后那一格下次就走**档案实物**，天然不再受官方当季换文件影响。
 *
 * **不在热路径上**：单向 IPC 发完就返回，播放不等转存。
 */
export const noteVoicePlayed = (pathname: string, url: string): void => {
  if (!pathname || !url) return
  try {
    ipcRenderer.send('kanso:archive-capture-voice', { pathname, url })
  } catch (_error) {
    // 入档失败只是这一条没留住，不该影响正在播的这一句
  }
}

/**
 * 深海/NPC/短剧 的额外音轨使用 kc9998/kc9999/kc9997 下发的完整文件名，
 * 不经过舰娘 voiceId 混淆算法。只接受已由本地字幕包或游戏请求确认的数字键。
 */
export const extraVoiceUrl = (
  kind: Extract<VoiceRequestCue['kind'], 'enemy' | 'npc' | 'skit'>,
  voiceId: string,
): string | null => {
  if (!/^\d{1,12}$/.test(voiceId)) return null
  const directory = EXTRA_VOICE_DIRS[kind]
  const pathname = `/kcs/sound/kc${directory}/${voiceId}.mp3`
  const file = cachedFile(pathname)
  if (file) return pathToFileURL(file).href
  return allowRemote && gameHost ? `https://${gameHost}${pathname}` : null
}

export const voiceState = () => ({
  enabled: allowRemote,
  host: gameHost,
  graphReady: graphOf.size > 0,
})

// 图鉴试听的音量与游戏语音同一套设置（钥的总音量 × 语音倍率）。
// 裸 Audio 默认 1.0，等于只受系统音量摆布（2026-08-12 用户实锤）。
// Audio.volume 上限 1：语音倍率 >100% 是给游戏页内增益用的，这里只能封顶。
export const previewVoiceVolume = (): number => {
  try {
    const config = remote.require('./config')
    const master = Number(config.get('kanso.gameAudio.volume', 1))
    const voice = Number(config.get('kanso.gameAudio.voiceVolume', 1))
    const combined = (Number.isFinite(master) ? master : 1) * (Number.isFinite(voice) ? voice : 1)
    return Math.max(0, Math.min(1, combined))
  } catch (_e) {
    return 1
  }
}
