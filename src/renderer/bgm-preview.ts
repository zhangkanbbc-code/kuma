// BGM 试听（2026-08-17 用户拍板的一批）。家具附带曲、海域曲的 ♪ 词条：
// 点击播放、再点同一首暂停、**暂停后再点从停下的地方接着放**、点别的自动换曲——
// 同时只有一首（与语音试听同容忍度：重渲染丢掉按钮高亮态不丢播放，因为 Audio 是
// 模块级单例）。判据收在 shared/preview-audio，与语音试听共用一份。
// 与语音试听之间还隔着一道总机（renderer/preview-audio）：谁开口谁把另一个按停，
// 并顺手把游戏页的声音压到 0。
// 音量随钥里的语音预览音量。
//
// ---- 播放源的三档优先级（2026-08-24 起）----
//  ① **档案实物**：这首在游戏里响过、字节留下来了 → 播 `file://`，**零网络**。
//     活动曲撤场之后这一档是唯一能响的来源，所以它排第一。
//  ② **本机缓存文件**：Chromium 缓存里还在 → 同样是本地文件（kcs-image 的缓存优先）。
//  ③ **现取**：向游戏自己的资源服务器要一次，**只在玩家点了那一下**。
//     这一档受钥里「不联网补取美术资源」（`kanso.remoteArt`，与立绘/语音同一个开关）管：
//     关掉之后 `bgmAudioUrl` 直接给 null，此时若档案里也没有，就诚实说明为什么不能听，
//     **不渲染点不响的死按钮**。
import { bgmAudioUrl, remoteArtState } from './kcs-image'
import { esc } from './kernel'
import { previewVoiceVolume } from './kcs-voice'
import { bgmNameOf, ensureBgmNames } from './bgm-names'
import { archivedBgmUrl, ensureBgmArchive } from './bgm-archive'
import { claimPreviewPlayback, notePreviewStopped, registerPreviewPlayer } from './preview-audio'
import { previewClickAction } from '../shared/preview-audio'

// api_mst_bgm 是**母港曲**名字表（101 起的港/家具/季节曲）；battle 树的同号
// 是另一首曲子——把港曲名安到战斗曲头上是张冠李戴（实测 1-1 昼战 118 撞名
// 「鎮守府の秋祭り」）。战斗曲的名字因此不从主数据取，改由誊写层按战斗树资源号
// 直查（矿脉包 kcwiki-bgm）与第一方耳测层补齐；三层都没有仍旧只标号，不编。

/** 可点的 BGM 词条（放不出声时退化成纯文字 + 说明，绝不渲染死按钮） */
export const bgmPreviewHtml = (bgmId: number, kind: 'port' | 'battle'): string => {
  if (!(bgmId > 0)) return ''
  ensureBgmNames()
  void ensureBgmArchive()
  const song = bgmNameOf(kind, bgmId)
  const name = esc(song ?? `#${bgmId}`)
  // 档案优先：留下来的那一份是玩家自己在游戏里听到过的字节，播它零网络、
  // 也不受官方哪天换掉/撤掉文件影响。
  const archived = archivedBgmUrl(kind, bgmId)
  const url = archived ?? bgmAudioUrl(bgmId, kind)
  if (!url) {
    // 到这里说明：档案里没有、缓存里也没有，而现取又被钥里的开关关掉了。
    // 与语音格同一口径——如实说明原因，别让玩家对着一个点不响的按钮猜。
    const why = remoteArtState().enabled
      ? '本机暂无该曲 · 首次游戏播放后归档'
      : '本机暂无该曲 · 远程获取已关闭'
    return `<span class="bgm-pv muted" title="${esc(why)}">${name}</span>`
  }
  const from = archived ? '档案实物 · 零联网 · ' : ''
  // 曲名提示只在**真没查到名字**时出——查到了还说「无官方曲名」就是自相矛盾
  const hint = song ? '' : '官方曲名尚未公布 · 仅显示编号 · '
  // data-bgm-label 是**给迷你播放条看的名字**。点下去那一刻曲名就在手上，
  // 不必让条子回头去认词条的文本（那份文本还带着 ♪ 与各种记号）。
  return `<span class="bgm-pv${archived ? ' kept' : ''}" data-bgm-url="${esc(url)}" data-bgm-label="${name}" title="${from}${hint}试听 · 单击暂停 / 继续播放">♪ ${name}</span>`
}

let audio: HTMLAudioElement | null = null
/** 当前这一条的曲名。续播时要照样报给总机——被按停期间别人可能已经把名字换过了。 */
let label = ''

/** 词条的三种样子：在响 / 停在半路 / 什么都不是。同时只有一枚词条带着记号。 */
const markEntry = (el: HTMLElement | null, state: 'playing' | 'paused' | null) => {
  document.querySelectorAll('.bgm-pv.playing').forEach((n) => n.classList.remove('playing'))
  document.querySelectorAll('.bgm-pv.paused').forEach((n) => n.classList.remove('paused'))
  if (el && state) el.classList.add(state)
}

// 被语音试听按停时走这里：暂停就够了，不归零——玩家回头点同一条还能接着放。
// 词条上的记号从「在响」换成「停在半路」，界面上看得出它还留着进度。
// 迷你播放条上的暂停钮走的也是这一个（它只认总机，不认识这个模块）。
const pause = () => {
  if (!audio || audio.paused) return
  audio.pause()
  const playingEl = document.querySelector<HTMLElement>('.bgm-pv.playing')
  markEntry(playingEl, playingEl ? 'paused' : null)
  notePreviewStopped('bgm', 'pause')
}

/**
 * 真正出声的那一步。点词条与迷你条上的续播共用这一份——各写一遍必然漂移，
 * 而漂移的表现是「有一条路续播归零了 / 有一条路忘了压游戏声音」，都不报错。
 *
 * @param restart true 才重设 src。续播那一路**一个字节都不许碰 src**：重设即归零。
 */
const start = (el: HTMLElement | null, url: string, restart: boolean, name: string) => {
  if (!audio) {
    audio = new Audio()
    audio.addEventListener('ended', () => {
      markEntry(null, null)
      notePreviewStopped('bgm', 'ended')
    })
    // 半路断流 / 文件坏掉：play() 那个 promise 早就兑现过了，不走失败那一支。
    // 不在这里报一声，游戏音量就一直压着不放，迷你条也一直挂着一条放不动的曲子。
    audio.addEventListener('error', () => {
      markEntry(null, null)
      notePreviewStopped('bgm', 'error')
    })
  }
  if (restart) audio.src = url
  audio.volume = previewVoiceVolume() // 每次播放前取：钥里改音量后已存在的实例也要跟上
  label = name
  markEntry(el, null)
  // 先占位再出声：语音那边当场按停，游戏声音也随即压下去
  claimPreviewPlayback('bgm', label)
  void audio.play().then(
    () => {
      if (el) el.classList.add('playing')
    },
    (error) => {
      notePreviewStopped('bgm', 'error')
      console.warn('[kanso] BGM 试听失败', url, error)
    },
  )
}

// 迷你条上的续播：等价于回头再点一次那枚停在半路的词条。
// 词条本身可能已经被重渲染冲掉了（翻了一页），那就只出声、不打记号——
// 声音不该因为界面翻页而续不上。
const resume = () => {
  if (!audio || !audio.paused || audio.ended || !audio.src) return
  start(document.querySelector<HTMLElement>('.bgm-pv.paused'), audio.src, false, label)
}

registerPreviewPlayer('bgm', { pause, resume, audio: () => audio })

export const initBgmPreview = () => {
  void ensureBgmArchive()
  document.addEventListener('click', (event) => {
    const el = (event.target as HTMLElement).closest<HTMLElement>('[data-bgm-url]')
    if (!el) return
    const url = el.dataset.bgmUrl!
    const action = previewClickAction(audio, url)
    if (action === 'pause') {
      pause()
      return
    }
    start(el, url, action === 'restart', el.dataset.bgmLabel ?? '')
  })
}
