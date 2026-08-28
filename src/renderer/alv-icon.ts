// 舰载机熟练度（api_alv 1–7）的图形标记。
//
// 游戏里熟练度不是数字，是机体角上的一枚标记。此前各处都显示裸数字
// （仓库 `3`、镝 `熟练 3`、图鉴 `≫3`），既和游戏对不上，也要玩家自己换算。
//
// 图形按 poi 的 assets/img/airplane/alv{1..7}.png 逐张核对（2026-08-08 实测）：
//   1–3 = 1–3 条竖杠（蓝）
//   4–6 = 1–3 道斜杠（橙）
//   7   = 两个人字形 »（金）
//
// **自己画 SVG 而不是搬那七张 PNG**：它们底色是浅的、和深色面板不搭，
// 更要紧的是那些位图看着是游戏美术的直接提取，来源不明——这仓库对来源
// 不明的素材一向不入库（同 assets/lodes 的处理）。形状本身很简单，
// 用项目自己的调色板画一份，顺带解决缩放与主题。
// 装备类别图标那边用的是 poi 的 **SVG**（MIT，poi 自绘），性质不同，保持原样。

/** 竖杠档（1–3）与斜杠档（4–6）的配色。7 单独一档 */
const BAR_COLOR = '#7db4d8'
const SLASH_COLOR = '#e8a33d'
const CHEVRON_COLOR = '#e8c66a'

const bars = (n: number): string =>
  Array.from({ length: n }, (_, i) => {
    const x = 5 + i * 5
    return `<rect x="${x}" y="3" width="2.6" height="14" rx="1.1" fill="${BAR_COLOR}" />`
  }).join('')

const slashes = (n: number): string =>
  Array.from({ length: n }, (_, i) => {
    const x = 4.5 + i * 5
    return `<path d="M${x + 3} 3 L${x} 17" stroke="${SLASH_COLOR}" stroke-width="2.6" stroke-linecap="round" />`
  }).join('')

const chevrons = (): string =>
  [0, 5.5]
    .map(
      (dx) =>
        `<path d="M${6 + dx} 4 L${11 + dx} 10 L${6 + dx} 16" fill="none" stroke="${CHEVRON_COLOR}"
          stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />`,
    )
    .join('')

const SHAPES: Record<number, () => string> = {
  1: () => bars(1), 2: () => bars(2), 3: () => bars(3),
  4: () => slashes(1), 5: () => slashes(2), 6: () => slashes(3),
  7: chevrons,
}

/** 悬停文字：图形之外仍要能读到确切档位，不能只剩看图猜 */
export const alvTitle = (alv: number): string =>
  alv === 7 ? '熟练度 7（最高）' : `熟练度 ${alv}`

/**
 * 熟练度标记。alv 0 或超出 1–7 一律返回空串——
 * 非舰载机的 alv 恒为 0，画个「零」出来会被当成「熟练度是零」。
 */
export const alvIconHtml = (alv: number, options: { className?: string } = {}): string => {
  const level = Math.trunc(alv)
  const shape = SHAPES[level]
  if (!shape) return ''
  const cls = ['alv-icon', options.className].filter(Boolean).join(' ')
  return `<svg class="${cls}" viewBox="0 0 24 20" role="img" aria-label="${alvTitle(level)}"
    ><title>${alvTitle(level)}</title>${shape()}</svg>`
}
