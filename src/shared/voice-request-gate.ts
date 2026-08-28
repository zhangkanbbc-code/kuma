// 语音请求的闸门：把「这一次 /kcs/sound 请求该不该走管线」从 Electron 里拆出来。
//
// ---- 为什么非拆不可（2026-08-22 用户实机撞出来的自激循环）----
// 「听过即存」的取字节那一半，是**让游戏页自己**对同一个 URL 再发一次
// `fetch(url, { cache: 'only-if-cached' })`。那一次 fetch 同样会被主进程的
// `webRequest.onBeforeRequest` 拦到——于是：
//   游戏播一句 → 我们 emit 字幕 + 问页面要字节 → 页面 fetch → **又**被拦到
//   → 又 emit 一次字幕 + 又问页面要字节 → …
// 而且 `askableFrames` 一次问两帧，每轮请求数还翻倍。实测（用户档案 index.json）：
// 单条 154 秒内被记 333 次「听过」≈ 每秒 2.16 次，10 条同时在跳——
// 底部字幕于是每秒被重画二十几次、在十来句之间轮换，看起来就是「卡住不消失 +
// 高速闪烁」。字幕的退场计时器本身是好的，是**上游事件风暴**把它一遍遍重置了。
//
// 这一层就是防止它再发生的结构性护栏，逻辑全是纯函数，护栏能真的调用它
// （不是去正则匹配源码文本，见 shared/source-pattern-guards-miss-logic-bugs）。

/**
 * 自己发出的读缓存请求，允许在这个窗口内认领（毫秒）。
 *
 * 窗口从「问出去」那一刻起算、**认领之后也不延长**——它必须是有界的，
 * 否则一条卡住的循环能靠不断认领把自己续命。
 * 一次询问会发给**两帧**（见 kcs-resource 的 askableFrames），所以窗口内
 * 允许认领多次，不能做成一次性的。
 * 4 秒的依据：preload 那边等 1.2 秒再读（等响应落进缓存），读本身是毫秒级；
 * 留三倍余量给忙帧。而这 4 秒里玩家重播同一句会被一并吞掉——
 * 那时上一条字幕还挂在屏幕上（停留 4.2~9 秒，长句还会续到音轨播完，见 shared/voice-caption-hold），看不出差别。
 */
export const SELF_FETCH_WINDOW_MS = 4_000

/**
 * 同一个 URL 两次「问页面要字节」之间的最小间隔。
 *
 * 取 10 分钟的理由：自激循环的周期是 preload 里那 1.2 秒，比它小三个数量级——
 * 只要间隔远大于循环周期，循环就**跑不起来**（第二轮直接被这道闸拦下）。
 * 而它又足够短，能让「第一次问的时候响应还没落进缓存」的那一条，在玩家过一阵
 * 再点开她时补上一次机会。
 */
export const ASK_COOLDOWN_MS = 10 * 60 * 1000

/** 同一个 URL 一次运行里最多问几次。冷却之外的第二道硬上限。 */
export const MAX_ASKS_PER_URL = 3

/** 同一条语音在这个窗口内重复触发时只出一次字幕。 */
export const CAPTION_DEDUPE_MS = 1_500

interface AskRecord {
  /** 已经问过几次 */
  asks: number
  /** 最近一次问的时刻 */
  askedAt: number
  /** 自己那次 fetch 的认领窗口失效时刻；0 = 已被认领或已过期 */
  claimUntil: number
}

export interface VoiceRequestGate {
  /**
   * 这一次请求是不是**我们自己**刚才让页面发的那次读缓存请求。
   *
   * 代价说清楚：认领窗口（4 秒）内玩家**重播同一句**也会被当成我们自己那一次，
   * 于是不出字幕。那几秒里上一条字幕还挂在屏幕上，看不出差别；
   * 而反过来（不认领）就是文件头那个自激循环，量级完全不同。
   */
  claimSelfFetch: (url: string, now: number) => boolean
  /** 该不该问页面要这一条的字节。返回 true 时已经记下这次询问并武装认领窗口。 */
  shouldAsk: (url: string, now: number) => boolean
  /** 诊断用：闸门里记着多少条 */
  size: () => number
}

export const createVoiceRequestGate = (
  options: {
    askCooldownMs?: number
    maxAsks?: number
    selfFetchWindowMs?: number
    maxEntries?: number
  } = {},
): VoiceRequestGate => {
  const askCooldownMs = options.askCooldownMs ?? ASK_COOLDOWN_MS
  const maxAsks = options.maxAsks ?? MAX_ASKS_PER_URL
  const selfFetchWindowMs = options.selfFetchWindowMs ?? SELF_FETCH_WINDOW_MS
  // 一次运行里能听到的语音条数有限（几千条封顶）；仍然设上限，别让它无限长
  const maxEntries = options.maxEntries ?? 20_000
  const records = new Map<string, AskRecord>()

  const prune = (now: number) => {
    if (records.size <= maxEntries) return
    // 最久没再动过的先扔。扔掉只是让那条重新获得一次询问机会，没有副作用。
    const ordered = [...records.entries()].sort((left, right) => left[1].askedAt - right[1].askedAt)
    for (const [key] of ordered.slice(0, records.size - maxEntries)) records.delete(key)
    void now
  }

  return {
    claimSelfFetch: (url, now) => {
      const record = records.get(url)
      // 窗口只由「问出去的那一刻」决定，认领**不延长**它——有界才关得死循环
      return !!record && !!record.claimUntil && now <= record.claimUntil
    },
    shouldAsk: (url, now) => {
      const record = records.get(url)
      if (record) {
        if (record.asks >= maxAsks) return false
        if (now - record.askedAt < askCooldownMs) return false
        record.asks += 1
        record.askedAt = now
        record.claimUntil = now + selfFetchWindowMs
        return true
      }
      records.set(url, { asks: 1, askedAt: now, claimUntil: now + selfFetchWindowMs })
      prune(now)
      return true
    },
    size: () => records.size,
  }
}

/**
 * 字幕层的重复触发闸门（**与上面那道各自独立**）。
 *
 * 为什么两道都要：上面那道保证「不会有事件风暴」，这道保证「就算有，字幕也不抖」。
 * 2026-08-22 那次故障里退场计时器是好的，坏在每次重画都把它重置——
 * 所以字幕层不能把「上游只会发一次」当前提。
 *
 * @param lastByPath 调用方持有的状态：路径 → 上一次出字幕的时刻
 */
export const shouldRenderCaption = (
  lastByPath: Map<string, number>,
  pathname: string,
  now: number,
  windowMs = CAPTION_DEDUPE_MS,
): boolean => {
  const last = lastByPath.get(pathname)
  if (last != null && now - last < windowMs) return false
  lastByPath.set(pathname, now)
  // 状态是调用方的，别让它无限长；语音路径条数有限，几千条足够
  if (lastByPath.size > 4_000) {
    const ordered = [...lastByPath.entries()].sort((left, right) => left[1] - right[1])
    for (const [key] of ordered.slice(0, lastByPath.size - 4_000)) lastByPath.delete(key)
  }
  return true
}

/**
 * 游戏资源 URL 里的 `?version=`。
 *
 * **这是 2026-08-22 那次故障的另一半根因**：游戏真实请求带版本参数
 *（实测缓存里 `…/kcs/sound/kcxgkywfhkphjf/193212.mp3?version=112`，
 * 3343/3672 条舰船美术 URL 同样带），而 Chromium 的缓存键**是完整 URL**。
 * 取字节那一半此前用 `new URL(pathname, location)` 重拼，把 query 丢了，
 * 于是 `only-if-cached` 永远打不中——玩家档案里 0 条实物就是这么来的。
 *
 * 版本号同时也是**季节差分的身份**：官方换季就换一次 version，
 * 同一槽位的当季版与平时版因此是两个不同的缓存条目、两份不同的实物。
 */
export const resourceVersionOf = (url: string): string => {
  const matched = /[?&]version=([\w.-]{1,32})(?:&|$)/.exec(`${url ?? ''}`)
  return matched ? matched[1] : ''
}
