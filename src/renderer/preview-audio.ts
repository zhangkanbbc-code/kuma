// 两个试听播放器之间的总机：BGM 的 ♪ 词条（bgm-preview）与鉴的语音钮（modules/ji）。
// 它俩各自守着一个模块级 Audio 单例，互不相识——ji 不该被 bgm-preview import
// （模块边界），所以「互相认识」这件事收在这个很小的中间层里。
//
// 管三件事：
//
// - **不叠音**：谁要开口，先把另一个按停。只是暂停、不归零，那边下次点还能接着放。
// - **试听时压住游戏声音**：任一边真的在响（play() 兑现且未停）就往主进程报一声，
//   主进程转给游戏页的 preload，那边把游戏音量乘 0；都不响了再报一声恢复。
//   两边的状态在这里合并，**只在合并结果变了的时候发**。
// - **当前这一条是谁**：正在听（或停在半路）的是哪一边、叫什么名字、它的 Audio 在哪。
//   悬浮迷你播放条（renderer/preview-bar）只读这里，不认识任何一个播放器——
//   于是「铭·按号试听」这类新入口只要走同一条链，条子自动跟着动，不必再分叉一份。
const { ipcRenderer } = require('electron')

export type PreviewOwner = 'bgm' | 'voice'

/**
 * 一个播放器交给总机的三件事。**`resume` 必须走播放器自己那条正常出声的路**
 * （重新 claim、重新取音量、重新打词条记号），迷你条上的续播才跟再点一次 ♪ 完全等价；
 * 绕过去直接 `audio.play()` 就会漏掉压游戏音量那一步，表现是「从条子上续播，游戏还哑着」。
 */
export interface PreviewPlayerHandle {
  /** 按停：只暂停、不归零，回头还能接着放 */
  pause: () => void
  /** 从暂停处接着放。没有可续的东西时自行空转 */
  resume: () => void
  /** 当前那个 Audio 实例。还没造出来就给 null（两边都是用到才 new） */
  audio: () => HTMLAudioElement | null
}

/**
 * 这一次「不响了」是哪一种。要害在 `pause` 与另外两种的分野：
 * 暂停是**试听还在**（进度留着，条子该继续摆着等你接着放），
 * 播完与出错是**试听没了**（条子该消失、状态清零）。
 */
export type PreviewStopReason = 'pause' | 'ended' | 'error'

// 主进程侧的收货口在 src/main/index.ts（游戏 webContents 那一段）
const ACTIVE_CHANNEL = 'kanso:preview-audio-active'

const players = new Map<PreviewOwner, PreviewPlayerHandle>()
const playing = new Set<PreviewOwner>()
const labels = new Map<PreviewOwner, string>()
const watchers = new Set<() => void>()
let active: PreviewOwner | null = null
let lastSent = false
let hold = 0

/** 当前这一条试听。没有（谁都没开过口，或都播完了）时给 null。 */
export interface ActivePreview {
  owner: PreviewOwner
  /** 摆给玩家看的名字：曲名，或「舰名 · 场合」 */
  label: string
  audio: HTMLAudioElement | null
  /** 此刻真的在响，还是停在半路 */
  playing: boolean
}

const emit = () => {
  if (hold > 0) return
  const isActive = playing.size > 0
  if (isActive !== lastSent) {
    lastSent = isActive
    ipcRenderer.send(ACTIVE_CHANNEL, isActive)
  }
  // 上报只在变化时发（游戏那边一压一放看得见），看客一律照叫：
  // 条子上的播放/暂停钮、时间、滑条禁用与否都跟着这里翻面。
  for (const watch of [...watchers]) watch()
}

/** 登记这个播放器。每个播放器装一次（模块加载时）。 */
export const registerPreviewPlayer = (owner: PreviewOwner, handle: PreviewPlayerHandle) => {
  players.set(owner, handle)
}

/**
 * 声明占用：先把别人按停，再把自己记成在响。
 *
 * 别人被按停会走到 `notePreviewStopped`，那一下若照发就是一串 false → true 的抖动；
 * 所以整段期间把上报与看客都压住，末尾只发一次合并后的结果。
 *
 * @param label 摆给玩家看的名字。BGM 侧点 ♪ 的当口就知道曲名，语音侧知道舰名与场合。
 *   续播（resume）也要照传一次——被按停期间别人可能已经把名字换过了。
 */
export const claimPreviewPlayback = (owner: PreviewOwner, label = '') => {
  hold++
  try {
    for (const [id, handle] of players) if (id !== owner) handle.pause()
  } finally {
    hold--
  }
  playing.add(owner)
  active = owner
  if (label) labels.set(owner, label)
  emit()
}

/**
 * 暂停 / 播完 / 播放失败：这一边不响了。
 *
 * 理由缺省按 `pause` 算——那是**保守的那一头**：条子继续摆着（进度确实还在），
 * 顶多多留一会儿；反过来把暂停当播完，玩家的进度就连同条子一起没了。
 */
export const notePreviewStopped = (owner: PreviewOwner, reason: PreviewStopReason = 'pause') => {
  playing.delete(owner)
  if (reason !== 'pause' && active === owner) {
    active = null
    labels.delete(owner)
  }
  emit()
}

/** 当前这一条试听是什么。迷你条每次重画都问一次。 */
export const activePreview = (): ActivePreview | null => {
  if (!active) return null
  return {
    owner: active,
    label: labels.get(active) ?? '',
    audio: players.get(active)?.audio() ?? null,
    playing: playing.has(active),
  }
}

/**
 * 播放 / 暂停一下当前这一条——**等价于再点一次那枚 ♪ 或 ▶**。
 * 判断留在这里而不是搬进条子：多一处判断就多一处漂移，而漂移的表现是
 * 「从条子上按暂停，游戏声音没放回来」，不报错。
 */
export const toggleActivePreview = () => {
  if (!active) return
  const handle = players.get(active)
  if (!handle) return
  if (playing.has(active)) handle.pause()
  else handle.resume()
}

/** 装一个看客：当前这一条变了（换人、换曲、响停、播完）就叫一声。 */
export const onPreviewChange = (watch: () => void) => {
  watchers.add(watch)
}
