// 试听播放器的点击循环判据。BGM 的 ♪ 词条与鉴的语音钮共用这一份——
// 两边各写一遍必然漂移，而漂移的表现是「有一边点了续不上、从头再来」，不报错。
//
// 循环是：播放 → 暂停 → **从暂停处接着放**。
// 「接着放」的要害在**别重设 src**：重设等于把 currentTime 归零，
// 听感上就成了「暂停了个寂寞，又从头来一遍」。
// 播完（ended）之后 src 还挂着同一首，那不是「暂停中」——再点该从头播。

export type PreviewClickAction = 'pause' | 'resume' | 'restart'

/** 只看 Audio 的这三项。摊成接口是为了在测试里把各种组合直接摆出来。 */
export interface PreviewAudioState {
  src: string
  paused: boolean
  ended: boolean
}

/**
 * 这一下点击该干什么。
 *
 * - `pause`：正在响的同一条 → 按停（不归零，好接着放）
 * - `resume`：同一条、停在半路 → 直接 play()，**调用方不许碰 src**
 * - `restart`：换了一条、播完了、或还没有 Audio → 重设 src 从头播
 */
export const previewClickAction = (
  audio: PreviewAudioState | null | undefined,
  url: string,
): PreviewClickAction => {
  if (!audio || audio.src !== url) return 'restart'
  if (!audio.paused) return 'pause'
  return audio.ended ? 'restart' : 'resume'
}
