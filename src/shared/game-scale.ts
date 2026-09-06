// 游戏画面按多大画：自适应（撑满可用区，倍率随窗口连续变）或固定倍率（按选定倍率画、
// 居中、四周留黑边）。**纯计算，不碰 DOM 也不碰 node 内建**——渲染层打包目标是 browser，
// 而这份判据要能脱开界面直接喂数字测。
//
// 真正摆位置的是 renderer/index.ts：拿 computeGameLayout 的结果去写 #game-wrapper 的宽，
// 高由 index.html 里那条 aspect-ratio 跟上，居中与黑边由 #game-area 的 flex + 黑底自然成立。
//
// 倍率的含义：1 = 游戏那 1200×720 个逻辑像素占页面上 1200×720 个 CSS 像素。
// 显示器的系统缩放是另一层：系统 125% 时这 1200 个 CSS 像素铺在 1500 个物理像素上，
// 仍然要重采样。所以固定倍率保证的是「倍率不随窗口变」，不是「哪台机器上都不插值」——
// 界面文案别写成清晰度承诺。

/** 游戏画面的逻辑尺寸（kcs2 的舞台大小） */
export const GAME_WIDTH = 1200
export const GAME_HEIGHT = 720

const ASPECT = GAME_WIDTH / GAME_HEIGHT

export const GAME_SCALE_MODES = ['fit', 'lock'] as const
export type GameScaleMode = (typeof GAME_SCALE_MODES)[number]

/** 玩家看到的模式名。id 与文案同处一份，别在渲染层另写一张表 */
export const GAME_SCALE_MODE_LABEL: Record<GameScaleMode, string> = {
  fit: '自适应',
  lock: '固定倍率',
}

/**
 * 档位集。1 是主档（游戏逻辑像素与 CSS 像素一比一）；两侧各留几档给
 * 「小窗口装不下 100%」和「4K 屏上 100% 太小」两头。
 *
 * 升序，`computeGameLayout` 降级时倒着走。
 */
export const GAME_SCALE_STEPS = [0.75, 1, 1.25, 1.5, 2] as const

const STEPS_DESC = [...GAME_SCALE_STEPS].sort((a, b) => b - a)

/**
 * 叶子路径。**读写一律走叶子**，理由同 toast-position：config 的 setByPath 写叶子时会把
 * 父对象就地变成「只有这一个键」的半份对象，整对象读到那份半份就不再回落默认值。
 */
export const GAME_SCALE_PATHS = {
  mode: 'kuma.gameScale.mode',
  step: 'kuma.gameScale.step',
} as const

/** 默认 = 可配之前那个写死的行为（自适应）。老玩家一个键都没存过，读出来的仍是原样 */
export const GAME_SCALE_DEFAULTS = {
  mode: 'fit' as GameScaleMode,
  step: 1,
}

export const normalizeGameScaleMode = (raw: unknown): GameScaleMode =>
  (GAME_SCALE_MODES as readonly string[]).includes(raw as string)
    ? (raw as GameScaleMode)
    : GAME_SCALE_DEFAULTS.mode

/** 档位表以外的值一律回主档：配置被人手改花了也不该画出一个没人选过的倍率 */
export const normalizeGameScaleStep = (raw: unknown): number => {
  const value = typeof raw === 'number' ? raw : Number(raw)
  return (GAME_SCALE_STEPS as readonly number[]).includes(value) ? value : GAME_SCALE_DEFAULTS.step
}

export interface GameLayoutInput {
  /** 可用区（#game-area）的宽高，渲染层 CSS px */
  areaWidth: number
  areaHeight: number
  mode: GameScaleMode
  /** 玩家选中的档位，固定倍率模式下才用得上 */
  lockStep: number
  /** 界面缩放。webview 的实际物理尺寸还要再乘这一层，所以锁定宽度要先除掉它 */
  uiZoom: number
}

export interface GameLayout {
  /** #game-wrapper 的宽（渲染层 CSS px） */
  width: number
  height: number
  /** 实际生效的倍率，也就是 webview 该拿到的 zoomFactor */
  scale: number
  /** 真按某一档摆的。false = 一档都装不下，退回自适应 */
  locked: boolean
  /** 实际用上的档位；自适应时为 null（含从选中档降下来的情况，值是降到的那一档） */
  step: number | null
  /** 左右两侧各一条黑边的宽、上下各一条的高 */
  barX: number
  barY: number
}

// Chromium 的布局粒度是 1/64 CSS px，比这更小的超出量画不出来。
// 放宽到这个量级是为了让「刚好装得下」不被浮点尾数判成装不下。
const EPS = 1 / 64

const letterbox = (areaWidth: number, areaHeight: number, width: number, height: number) => ({
  barX: Math.max(0, (areaWidth - width) / 2),
  barY: Math.max(0, (areaHeight - height) / 2),
})

/**
 * 摆一屏游戏画面。
 *
 * 自适应这一支与可配之前的算法逐字同构：宽取「区宽」与「区高 × 5/3」的小者，
 * 比例永远成立，横竖都只留黑边不裁内容（2026-08-12 用户实锤过被裁的那一版）。
 *
 * 固定倍率装不下时**往下退到还装得下的最大一档**，一档都装不下才回自适应。
 * 不出滚动条：游戏要靠鼠标坐标操作，露半张画面等于不能玩。
 */
export const computeGameLayout = (input: GameLayoutInput): GameLayout => {
  const areaWidth = Math.max(0, input.areaWidth)
  const areaHeight = Math.max(0, input.areaHeight)
  const zoom = input.uiZoom > 0 ? input.uiZoom : 1

  if (input.mode === 'lock') {
    const wanted = normalizeGameScaleStep(input.lockStep)
    for (const step of STEPS_DESC) {
      if (step > wanted) continue
      const width = (step * GAME_WIDTH) / zoom
      const height = (step * GAME_HEIGHT) / zoom
      if (width <= areaWidth + EPS && height <= areaHeight + EPS) {
        return {
          width,
          height,
          scale: step,
          locked: true,
          step,
          ...letterbox(areaWidth, areaHeight, width, height),
        }
      }
    }
  }

  const width = Math.min(areaWidth, areaHeight * ASPECT)
  const height = width / ASPECT
  return {
    width,
    height,
    scale: (width * zoom) / GAME_WIDTH,
    locked: false,
    step: null,
    ...letterbox(areaWidth, areaHeight, width, height),
  }
}
