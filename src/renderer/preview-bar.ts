// 试听的悬浮迷你播放条：右下角一枚小胶囊，一行摆完「在听什么 · 播放/暂停 · 拖到哪 · 时间」。
//
// 它解决的是「想从哪里听就从哪里听」——♪ 词条与语音钮只有开关两态，一首三分钟的曲子
// 想跳到副歌无处可跳；而词条本身长在模块面板里，翻一页就看不见了。
//
// ---- 两条不许违反的纪律 ----
//
// ① **挂 body，只挂一次**。模块面板既裁 overflow 又是 transform 包含块：长在模块行里的
//    浮层 absolute 会被裁掉、fixed 会算错位置（仓史踩过）。而模块 HTML 是被动重渲、
//    整块重画的，任何住在模块行里的持久 UI 都活不过下一次刷新。所以这枚节点在装配时
//    一次性挂进 body，此后**只切显隐、绝不重建**，与任何模块的渲染路径零交集。
// ② **状态一律问总机**（renderer/preview-audio），自己不记「现在在放谁」。播放/暂停也是
//    转手交给总机——绕过去直接 audio.play() 就漏掉了压游戏音量那一步，表现是
//    「从条子上续播，游戏还哑着」，而且不报错。
import { activePreview, onPreviewChange, toggleActivePreview } from './preview-audio'

/** 这几件事发生时进度或时长可能变了，条子要跟着重画。 */
const AUDIO_EVENTS = ['play', 'pause', 'timeupdate', 'durationchange', 'loadedmetadata'] as const

let host: HTMLElement | null = null
let nameEl: HTMLElement | null = null
let toggleEl: HTMLButtonElement | null = null
let seekEl: HTMLInputElement | null = null
let timeEl: HTMLElement | null = null

/** 此刻挂着监听的那个 Audio。播放器换了实例就要摘旧挂新，否则条子会盯着一个死实例。 */
let bound: HTMLAudioElement | null = null

/**
 * 玩家的手正按在滑条上。
 *
 * 拖动期间 `timeupdate` 每秒来四次，照写就是「手往右拖、滑块自己弹回去」——
 * 拖不动。所以拖动态期间**只认滑条自己的值**，松手（change）那一下才写回 currentTime。
 */
let dragging = false

const mmss = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--'
  const total = Math.floor(seconds)
  return `${Math.floor(total / 60)}:${`${total % 60}`.padStart(2, '0')}`
}

/**
 * 能拖的时长。
 *
 * 远端 mp3 在拿到元数据之前 duration 是 NaN，直播式的流则是 Infinity——两种都**不能拖**
 * （没有终点，滑条的刻度无从谈起）。这里统一折成 0，由调用方据此禁用滑条、时长位写「--:--」，
 * 而不是渲染一根拖了没反应的假滑条。
 */
const seekableDuration = (audio: HTMLAudioElement | null): number => {
  const value = audio?.duration
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

const currentTimeOf = (audio: HTMLAudioElement | null): number => {
  const value = audio?.currentTime
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/** 只画，不改状态。总机叫一声、Audio 报一次事件，都落到这里。 */
const paint = () => {
  if (!host || !nameEl || !toggleEl || !seekEl || !timeEl) return
  const info = activePreview()
  if (!info) {
    // 播完 / 出错 / 从来没开过口：条子退场，状态清零。
    bindAudio(null)
    host.classList.remove('show')
    document.body.classList.remove('kanso-preview-on')
    seekEl.value = '0'
    return
  }
  bindAudio(info.audio)
  host.classList.add('show')
  document.body.classList.add('kanso-preview-on')

  nameEl.textContent = info.label || '试听'
  nameEl.title = info.label || '试听'
  toggleEl.textContent = info.playing ? '⏸' : '▶'
  toggleEl.setAttribute('aria-label', info.playing ? '暂停' : '继续播放')
  toggleEl.title = info.playing ? '暂停' : '接着放'

  const duration = seekableDuration(info.audio)
  const at = currentTimeOf(info.audio)
  if (duration > 0) {
    seekEl.disabled = false
    seekEl.max = `${duration}`
    if (!dragging) seekEl.value = `${Math.min(at, duration)}`
  } else {
    // 时长还不知道（或根本没有终点）：滑条禁用，时间照走。
    // 摆一根拖了没反应的滑条比没有滑条更糟。
    seekEl.disabled = true
    seekEl.max = '0'
    seekEl.value = '0'
  }
  const shown = dragging && duration > 0 ? Number(seekEl.value) : at
  timeEl.textContent = `${mmss(shown)} / ${duration > 0 ? mmss(duration) : '--:--'}`
}

function bindAudio(audio: HTMLAudioElement | null) {
  if (bound === audio) return
  if (bound) for (const type of AUDIO_EVENTS) bound.removeEventListener(type, paint)
  bound = audio
  if (bound) for (const type of AUDIO_EVENTS) bound.addEventListener(type, paint)
  // 换了一条就不该还锁在上一条的拖动态里
  dragging = false
}

const applySeek = () => {
  const info = activePreview()
  const audio = info?.audio ?? null
  const duration = seekableDuration(audio)
  const target = Number(seekEl?.value)
  dragging = false
  if (audio && duration > 0 && Number.isFinite(target)) {
    // 远端 mp3 的跳转靠服务器认 Range（Chromium 自己会发范围请求）；不认就跳不动，
    // 那是服务器的事，这里能做的只是不写出界的值。file:// 的档案实物天然跳得动。
    try {
      audio.currentTime = Math.min(Math.max(0, target), duration)
    } catch (error) {
      // 元数据还没到手时写 currentTime 会抛。吞掉就成了「拖了没反应还查不出为什么」
      console.warn('[kanso] 试听跳转失败', target, error)
    }
  }
  paint()
}

const build = (): HTMLElement => {
  const el = document.createElement('div')
  el.id = 'preview-bar'
  el.setAttribute('role', 'group')
  el.setAttribute('aria-label', '试听')

  nameEl = document.createElement('span')
  nameEl.className = 'pb-name'

  toggleEl = document.createElement('button')
  toggleEl.className = 'pb-toggle'
  toggleEl.type = 'button'
  toggleEl.addEventListener('click', () => {
    toggleActivePreview()
    paint()
  })

  seekEl = document.createElement('input')
  seekEl.className = 'pb-seek'
  seekEl.type = 'range'
  seekEl.min = '0'
  seekEl.max = '0'
  seekEl.step = '0.01'
  seekEl.value = '0'
  seekEl.setAttribute('aria-label', '播放进度')
  // input 在拖动全程连发（键盘方向键也走它）：进拖动态，时间位跟着手走，但先不动 currentTime。
  seekEl.addEventListener('input', () => {
    dragging = true
    paint()
  })
  // change 是松手（或键盘操作结束）那一下：此刻才真跳。
  seekEl.addEventListener('change', applySeek)

  timeEl = document.createElement('span')
  timeEl.className = 'pb-time'

  el.appendChild(nameEl)
  el.appendChild(toggleEl)
  el.appendChild(seekEl)
  el.appendChild(timeEl)
  return el
}

/**
 * 装条子。**整个装配期只跑一次**，此后这枚节点一直住在 body 里，靠 `.show` 切显隐。
 * 没有任何模块会重建它，也没有任何 onMgChange 路径经过它。
 */
export const initPreviewBar = () => {
  if (host) return
  host = build()
  document.body.appendChild(host)
  onPreviewChange(paint)
  paint()
}
