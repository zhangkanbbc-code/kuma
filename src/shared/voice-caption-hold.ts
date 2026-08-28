// 语音字幕停留多久。**底部字幕以音轨真实时长为准**——这是 2026-08-26 用户实报的
// 「长台词语音还在播、字幕先走了」的根因所在。
//
// 旧口径是一条纯字数公式：`min(9000, max(4200, 2400 + 字数*95))`。两处都偏短：
// 9 秒硬上限远短于真实的长音轨（整点报时、婚礼台词、长句十几到二十几秒的都有），
// 95ms/字也低于实际语速。于是长台词只要没有下一句顶掉它，就会先走一步。
//
// 现在拆成两段：先按旧公式撑住一个最短展示，到期再去问游戏页「这一条解出来多长」
// （`assets/preload/game-audio.js` 的 decodeAudioData 钩子记着 AudioBuffer.duration），
// 问到就续到音轨结束。问不到才落回字数估算，而估算本身也放宽了——旧那条是照着
// 「别挡屏幕太久」调的，代价正是把长句砍在半截。
//
// 三个函数都是纯的，护栏能真的调用它们（不是去正则匹配源码文本，
// 见 shared/source-pattern-guards-miss-logic-bugs）。

/**
 * 音轨结束之后再多挂一会儿（毫秒）。
 *
 * 两笔账：音轨末尾常有一段尾音/余白，`duration` 是文件长度不是「说完的那一刻」；
 * 退场本身还有一段淡出过渡。卡着 duration 整收，最后一个字看起来是被剪掉的。
 */
export const CAPTION_TAIL_MS = 1_200

/** 兜底估算的上限（毫秒）。盖得住最长的那批音轨，又不至于一句话霸着屏幕不走。 */
export const CAPTION_FALLBACK_CAP_MS = 24_000

/**
 * 第一段：最短展示时长（毫秒）。**旧公式原样搬过来，一个数都没改。**
 *
 * 它的职责变了：不再是「停留多久」，而是「什么时候该去问真时长」。
 * 短句本来就该在这个量级退场，问不问都一样；长句则要等到这一刻才问——
 * 那时游戏页早已解码完（howler 先取字节、再 decodeAudioData、再播），一问就有。
 */
export const captionMinHoldMs = (textLength: number): number =>
  Math.min(9_000, Math.max(4_200, 2_400 + textLength * 95))

/**
 * 最短展示到期那一刻的裁决：这条字幕该在**哪个绝对时刻**退场。
 *
 * 查得到真时长就照着音轨走——音轨播多久字幕挂多久，没有哪个判据比它更准。
 * 查不到（webview 不在、那一帧没装上钩子、这一条已经被环挤出去了）落回字数估算：
 * 220ms/字是贴着真实语速的量级，比旧那 95ms/字宽一倍有余；下界仍压着第一段，
 * 免得出现「兜底比最短展示还短」这种倒挂。
 *
 * 返回值是绝对时刻，调用方拿它和 now 比：已经过了就立刻退，没到就续到那一刻。
 * 真时长比第一段还短的短句因此天然是「到期即退」，不会倒着往回缩。
 *
 * @param audioMs 音轨真实时长（毫秒）；`null` = 没查到，走兜底
 */
export const captionHideAtMs = (input: {
  shownAtMs: number
  textLength: number
  audioMs: number | null
}): number => {
  if (input.audioMs != null && input.audioMs > 0) {
    return input.shownAtMs + input.audioMs + CAPTION_TAIL_MS
  }
  const relaxed = Math.min(
    CAPTION_FALLBACK_CAP_MS,
    Math.max(captionMinHoldMs(input.textLength), 2_400 + input.textLength * 220),
  )
  return input.shownAtMs + relaxed
}

/**
 * 战斗弹幕穿屏用多久（秒）。
 *
 * 弹幕这一族的约束和底部字幕不是一回事：它要的是**读完**而不是**听完**——
 * 一条从屏幕这头走到那头，眼睛得跟得上。固定 6 秒对短台词正合适，长句就成了
 * 「还没读完就飘出去」。所以 14 字以内维持原样（战斗里绝大多数台词都在这个量级），
 * 更长才逐字加时，上限 10 秒——再慢下一批弹幕就该堆上来了。
 *
 * 按百分之一秒的整数算再除回来：`6 + 16 * 0.12` 这种写法会掉进二进制小数的坑，
 * 而这个值要原样写进 CSS 变量。
 */
export const danmakuDurationSeconds = (textLength: number): number =>
  Math.min(1_000, 600 + Math.max(0, textLength - 14) * 12) / 100
