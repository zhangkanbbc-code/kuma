// 第零幕可选开幕风格：配置键、合法项、优先级与机甲舱门催门彩蛋台词。
// 用户显式选定风格（非 auto）时，优先级高于活动海图幕、季节企划幕与日历兜底。

export const WELCOME_STYLE_CONFIG_KEY = 'kuma.launchWelcomeStyle'

export const WELCOME_STYLES = [
  'auto',
  'cic-ice',
  'cic-amber',
  'anime-blue',
  'anime-dusk',
  'mech-split',
  'mech-quad',
] as const

export type WelcomeStyle = (typeof WELCOME_STYLES)[number]
export type CustomWelcomeStyle = Exclude<WelcomeStyle, 'auto'>

export const WELCOME_STYLE_SET: ReadonlySet<string> = new Set(WELCOME_STYLES)

export const normalizeWelcomeStyle = (value: unknown): WelcomeStyle =>
  typeof value === 'string' && WELCOME_STYLE_SET.has(value) ? (value as WelcomeStyle) : 'auto'

export interface WelcomeStyleConfig {
  get(key: string, fallback: unknown): unknown
}

export const readWelcomeStyle = (config: WelcomeStyleConfig): WelcomeStyle =>
  normalizeWelcomeStyle(config.get(WELCOME_STYLE_CONFIG_KEY, 'auto'))

export const isCicWelcomeStyle = (style: WelcomeStyle): style is 'cic-ice' | 'cic-amber' =>
  style === 'cic-ice' || style === 'cic-amber'

export const isAnimeWelcomeStyle = (style: WelcomeStyle): style is 'anime-blue' | 'anime-dusk' =>
  style === 'anime-blue' || style === 'anime-dusk'

export const isMechWelcomeStyle = (style: WelcomeStyle): style is 'mech-split' | 'mech-quad' =>
  style === 'mech-split' || style === 'mech-quad'

/** 需要「上次退出」快照简报缓存的风格（科技控制台与机甲舱门）。 */
export const isBriefWelcomeStyle = (style: WelcomeStyle): boolean =>
  isCicWelcomeStyle(style) || isMechWelcomeStyle(style)

/** 机甲舱门彩蛋：三件就绪后迟迟不点门，VR 目镜层随机轮换显示，不连着重复。 */
export const MECH_NUDGE_LINES = [
  'クマー……クマー……才、才没有等得无聊呢クマ。球磨过得很充实クマ！',
  'クマ？门锁已经就绪了クマ。提督不是在等球磨从里面开吧クマ？',
  '提督，光盯着目镜看，舱门可不会自己开クマ。点一下就行クマ',
  '选机甲舱门算是很有眼光クマ……但总得按下去才算启动クマ！',
  '哼哼，这扇装甲门也很结实クマ……不过不开的话可看不到里面クマ',
  '球磨可不是门外的毛绒摆件クマ。再干等下去要闹别扭了クマー',
  '再不开门，球磨就要冬眠了クマ……',
  '多摩都等得打起瞌睡了クマ',
] as const

/** 只在本次显示了上次快照简报时才进候选池。 */
export const MECH_NUDGE_BRIEF_LINE = '报告提督，港区状态都列在目镜两侧了クマ。不进来确认一下吗クマ？'

/** 低概率温柔彩蛋台词与触发概率（约 5%）。 */
export const MECH_NUDGE_RARE_LINE = '提督，辛苦了クマー。想先发会儿呆也可以，回过神再点门就好クマ'
export const MECH_NUDGE_RARE_RATE = 0.05

export interface PickMechNudgeOptions {
  hasBrief?: boolean
  random?: () => number
}

export const pickMechNudgeLine = (
  previous: string | null,
  { hasBrief = false, random = Math.random }: PickMechNudgeOptions = {},
): string => {
  if (previous !== MECH_NUDGE_RARE_LINE && random() < MECH_NUDGE_RARE_RATE) {
    return MECH_NUDGE_RARE_LINE
  }
  const base: readonly string[] = hasBrief
    ? [...MECH_NUDGE_LINES, MECH_NUDGE_BRIEF_LINE]
    : MECH_NUDGE_LINES
  const pool = previous ? base.filter((line) => line !== previous) : base
  const index = Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)))
  return pool[index]
}
