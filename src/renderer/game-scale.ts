// 游戏画面缩放的设置状态：钥（modules/yu）改，镇壳（index）应用。
// 两边都不各读各的配置——一处改完另一处还攥着旧值，界面上就会出现「选了但没变」。
// 档位表、判据与布局计算在 shared/game-scale，这里只管「现在是哪一档」和「改了通知谁」。
import {
  GAME_SCALE_DEFAULTS,
  GAME_SCALE_PATHS,
  normalizeGameScaleMode,
  normalizeGameScaleStep,
  type GameScaleMode,
} from '../shared/game-scale'

const remote = require('@electron/remote')
const config = remote.require('./config')

let mode: GameScaleMode = normalizeGameScaleMode(
  config.get(GAME_SCALE_PATHS.mode, GAME_SCALE_DEFAULTS.mode),
)
let step: number = normalizeGameScaleStep(
  config.get(GAME_SCALE_PATHS.step, GAME_SCALE_DEFAULTS.step),
)

// 应用者只有一个（镇壳里那块游戏区），所以不铺监听器数组：交上来一个动作，
// 改档时回调它。与 mu.ts 的 setLayoutDragHooks 同一种分工——判断在这边，摆 DOM 在那边。
let applier: (() => void) | null = null

/** 镇壳把「照当前设置重摆一次」交上来。登记时先摆一次，省得初值要两处各写一遍 */
export const setGameScaleApplier = (apply: () => void) => {
  applier = apply
  apply()
}

export const getGameScaleMode = (): GameScaleMode => mode
export const getGameScaleStep = (): number => step

/**
 * 眼下**量出来**的倍率（`computeGameLayout` 那个 scale），不是选中的档位。
 *
 * 两者不是一回事：自适应根本没有选中的档，固定倍率装不下时又会自己往下退。
 * 字幕字号要乘的是屏幕上真正生效的那个数，所以另存一份。镇壳每摆一次游戏区
 * 就写一次；读的人是钥那张「字幕字号」卡（显示实际生效值）。
 *
 * 屏幕上那道乘法**不走这里**——它在样式表里（`--voice-caption-px`），
 * 这个数只为了让设置页能把同一个值写成字。
 */
let liveScale = GAME_SCALE_DEFAULTS.step

/** 摆完一屏之后把量到的倍率交上来。0/负数/NaN 一律不收：那是面板还没摆开时的读数 */
export const noteGameScaleLive = (scale: number) => {
  if (Number.isFinite(scale) && scale > 0) liveScale = scale
}

export const getGameScaleLive = (): number => liveScale

export const setGameScaleMode = (raw: unknown) => {
  const next = normalizeGameScaleMode(raw)
  if (next === mode) return
  mode = next
  config.set(GAME_SCALE_PATHS.mode, next)
  applier?.()
}

export const setGameScaleStep = (raw: unknown) => {
  const next = normalizeGameScaleStep(raw)
  if (next === step) return
  step = next
  config.set(GAME_SCALE_PATHS.step, next)
  applier?.()
}
