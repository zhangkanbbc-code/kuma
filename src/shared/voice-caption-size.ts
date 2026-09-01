// 语音字幕的字号：玩家调**基准**，屏幕上生效的是「基准 × 游戏画面当前倍率」。
// **纯计算，不碰 DOM 也不碰 node 内建**——渲染层打包目标是 browser，而这份判据
// 要能脱开界面直接喂数字测。
//
// 为什么要乘倍率：字幕画在界面层（`#game-wrapper` 里那两个兄弟节点），游戏画面
// 缩放动的是 webview 的 zoomFactor，字幕一点都不跟——固定倍率 75% 时游戏整个缩小，
// 字幕还是原来那么大，压在画面上格外突兀（2026-08-31 玩家反馈）。
// 倍率取的就是 `shared/game-scale` 那个 `scale`（钥的「游戏画面」卡上写的那个百分比），
// 于是游戏 100% 时实际字号 = 基准字号，一个数就能对上。
//
// 真正把数写上屏的是 renderer/voice-subtitle 的 `--voice-caption-base` 与
// renderer/index 的 `--game-scale`，相乘那一步在 index.html 的 CSS 里
//（`--voice-caption-px`）——乘法交给样式表，倍率变化就不必逐条改行内样式。

/**
 * 叶子路径。**读写一律走叶子**，理由同 game-scale：config 的 setByPath 写叶子时会把
 * 父对象就地变成「只有这一个键」的半份对象，整对象读到那份半份就不再回落默认值。
 */
export const VOICE_CAPTION_SIZE_PATH = 'kanso.voiceCaptionSize'

/**
 * 默认 = 可配之前那条 CSS 的封顶值（`clamp(13px, 1.55vw, 20px)` 的 20px）。
 * 常见的最大化窗口本来就顶在这一档上，老玩家一个键都没存过，开出来还是原样。
 */
export const VOICE_CAPTION_SIZE_DEFAULT = 20

/** 手调的上下限。小于这个读不出字，大于这个一句话能横穿整块画面 */
export const VOICE_CAPTION_SIZE_MIN = 10
export const VOICE_CAPTION_SIZE_MAX = 40

/** 一按加减动几个像素 */
export const VOICE_CAPTION_SIZE_STEP = 1

/** 摆在卡上的常用档。默认那一档必须在里面，否则开箱那一下没有一个亮着的 */
export const VOICE_CAPTION_SIZE_CHIPS = [14, 16, 18, 20, 24, 28, 32] as const

/**
 * 战斗弹幕相对底部字幕的比例。
 *
 * 可配之前两处各写死一个 clamp：底部字幕封顶 20px、弹幕封顶 19px。合成一个旋钮之后
 * 这 1px 的差额靠这个系数原样留着——不留的话，开箱第一眼弹幕就比从前大了一号。
 */
export const VOICE_DANMAKU_SIZE_RATIO = 0.95

/**
 * 认回一个基准字号：非数字、超界、带小数的一律收拾干净。
 * 配置被人手改花了也不该画出一行看不见或者糊满屏的字。
 *
 * **数字与非数字两条路分开**：`Number('')` 与 `Number([])` 都是 0，一律走 Number 的话，
 * 「这一格是空的」会被当成「他选了 0px」再收到下限上去——那是把缺值伪装成一次选择。
 * 真给了个数（含加减按钮递出来的越界值）才收进上下限，其余回默认。
 */
export const normalizeVoiceCaptionSize = (raw: unknown): number => {
  const value =
    typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN
  if (!Number.isFinite(value)) return VOICE_CAPTION_SIZE_DEFAULT
  const rounded = Math.round(value)
  return Math.min(VOICE_CAPTION_SIZE_MAX, Math.max(VOICE_CAPTION_SIZE_MIN, rounded))
}

/**
 * 屏幕上真正生效的字号（渲染层 CSS px），保留一位小数——
 * 钥那张卡显示的就是这个数，与样式表里那道乘法同源同值。
 *
 * 倍率是从 `computeGameLayout` 量出来的，可能是 0（面板还没摆开）或者负数尾巴，
 * 那种时候按 1 算：宁可显示基准值，也不显示一个 0px。
 */
export const effectiveVoiceCaptionPx = (base: unknown, gameScale: unknown): number => {
  const size = normalizeVoiceCaptionSize(base)
  const scale = typeof gameScale === 'number' ? gameScale : Number(gameScale)
  const factor = Number.isFinite(scale) && scale > 0 ? scale : 1
  return Math.round(size * factor * 10) / 10
}
