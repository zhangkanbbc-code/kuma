// 动画复盘里兵牌按实际阵型排开（维护者 2026-11-26：「布局可以使用真实选择的阵型」）。
//
// 坐标约定：单位格里 x 是「前后」（正 = 更靠前），y 是「左右」。上屏时照游戏阵型选择图标的画法，
// **前进方向朝上**：单纵是竖着一列、旗舰在最上，单横是横着一排，轮形、梯形照图标的样子；
// 我方在左半边、敌方在右半边，敌方左右镜像（梯形斜向反过来）。
// 一度让两边各自朝对方（朝右 / 朝左）：单纵阵就成了横着一排，六张兵牌挤在半边舞台的一行里
// 缩到最小，上下大片空着（2026-11-26 首版预览）。
// 排出来的是阵型的相对形状；fitFormation 再按舞台大小缩放，并按实际间距定兵牌尺寸，保证不重叠。
//
// 形状照游戏的阵型图标取近似，不追求逐像素：要的是一眼认得出「这是轮形」「这是单横」。
// 舰位：0–5 主力（联合时第一舰队）、6–11 护卫（联合时第二舰队 / 游击部队第 7 位是 6）。

export interface FormationPoint {
  index: number
  x: number
  y: number
}

type Shape = (count: number) => [number, number][]

// 单纵：一路纵队，旗舰打头
const column: Shape = (count) => Array.from({ length: count }, (_, i) => [-i, 0])
// 复纵：两路纵队并行，旗舰领左路
const doubleColumn: Shape = (count) =>
  Array.from({ length: count }, (_, i) => [-Math.floor(i / 2) * 1.05, i % 2 === 0 ? -0.62 : 0.62])
// 轮形：旗舰居中，其余围成一圈
const ring: Shape = (count) => {
  const around = Math.max(0, count - 1)
  return Array.from({ length: count }, (_, i) => {
    if (i === 0) return [0, 0]
    const angle = (2 * Math.PI * (i - 1)) / Math.max(1, around)
    return [Math.cos(angle) * 1.15, Math.sin(angle) * 1.15]
  })
}
// 梯形：斜着一字排开
const echelon: Shape = (count) => Array.from({ length: count }, (_, i) => [-i * 0.72, i * 0.72])
// 单横：横着一字排开，旗舰居中
const lineAbreast: Shape = (count) => Array.from({ length: count }, (_, i) => [0, i - (count - 1) / 2])
// 警戒：前面一小队顶着，旗舰带后队
const vanguard: Shape = (count) =>
  Array.from({ length: count }, (_, i) => {
    if (i === 0) return [0, 0]
    if (i <= 2) return [-0.9, i === 1 ? -0.8 : 0.8]
    const rest = i - 3
    return [0.95 + Math.floor(rest / 2) * 0.05, rest % 2 === 0 ? -1.2 - Math.floor(rest / 2) * 0.6 : 1.2 + Math.floor(rest / 2) * 0.6]
  })

const SINGLE_SHAPES: Record<number, Shape> = {
  1: column,
  2: doubleColumn,
  3: ring,
  4: echelon,
  5: lineAbreast,
  6: vanguard,
}

// 联合舰队的四种航行序列：两支队伍各自的形状 + 两队的相对位置（第二舰队在前、贴近敌方）
// 弧形：以 (cx, cy) 为圆心、半径 r，在正前方 ±spread 弧度内均匀排开
const arc = (count: number, cx: number, cy: number, r: number, spread: number): [number, number][] =>
  Array.from({ length: count }, (_, i) => {
    const angle = count === 1 ? 0 : -spread + (2 * spread * i) / (count - 1)
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]
  })
const combinedShape = (formation: number, mainCount: number, escortCount: number): [number, number][] => {
  const shift = (points: [number, number][], dx: number, dy: number) => points.map(([x, y]) => [x + dx, y + dy] as [number, number])
  switch (formation) {
    case 11: // 第一警戒航行序列（对潜警戒）：护卫队在前横向展开，主力队在后成复纵
      return [...shift(doubleColumn(mainCount), -0.9, 0), ...shift(lineAbreast(escortCount), 1.3, 0)]
    case 12: // 第二警戒航行序列（前方警戒）：两队各成复纵，护卫队在前
      return [...shift(doubleColumn(mainCount), -2.3, 0), ...shift(doubleColumn(escortCount), 1.1, 0)]
    case 13: // 第三警戒航行序列（轮形）：主力居中成轮形，护卫队在前方围成一道弧
      return [...shift(ring(mainCount), -1.3, 0), ...arc(escortCount, -1.3, 0, 2.5, Math.PI * 0.42)]
    case 14: // 第四警戒航行序列（战斗队形）：两队各成单纵并行，护卫队靠前
    default:
      return [...shift(column(mainCount), -0.4, 0.8), ...shift(column(escortCount), 0.8, -0.8)]
  }
}

/**
 * 一方的阵型形状（单位格）。`indices` 是这一方实际在场的舰位（升序），
 * 退避的舰也照样占位——她在阵里有位置，只是不参战。
 */
export const formationPoints = (formation: number, indices: readonly number[]): FormationPoint[] => {
  const mainIdx = indices.filter((index) => index < 6)
  const escortIdx = indices.filter((index) => index >= 6)
  if (formation >= 11 && formation <= 14 && escortIdx.length && mainIdx.length) {
    const shape = combinedShape(formation, mainIdx.length, escortIdx.length)
    return [...mainIdx, ...escortIdx].map((index, at) => ({ index, x: shape[at][0], y: shape[at][1] }))
  }
  // 非联合：游击部队的第 7 位（舰位 6）接在队尾
  const ordered = [...mainIdx, ...escortIdx]
  const shape = (SINGLE_SHAPES[formation] ?? column)(ordered.length)
  return ordered.map((index, at) => ({ index, x: shape[at][0], y: shape[at][1] }))
}

export interface FittedToken {
  index: number
  /** 兵牌中心点（舞台像素） */
  cx: number
  cy: number
}

export interface FittedFormation {
  tokens: FittedToken[]
  /** 这一方兵牌的统一尺寸 */
  width: number
  height: number
}

export interface FitBox {
  left: number
  top: number
  width: number
  height: number
}

/** 兵牌的长宽比与尺寸上下限（小头像 + 名字 + 血条） */
export const TOKEN_ASPECT = 0.56
// 上限：维护者 2026-11-26 看过第一版说「兵牌做小点，这太大了」（原 128），收到 96
export const TOKEN_MAX_WIDTH = 96
// 下限按「小头像 44px 还认得出」定：舞台窄、阵型又长时宁可兵牌小，也不叠在一起
export const TOKEN_MIN_WIDTH = 44

/**
 * 把一方的阵型放进它那半边舞台。`side` 0 = 我方、1 = 敌方（左右镜像）；前进方向朝上，阵型在半边里居中。
 * 兵牌尺寸取「最近两舰的间距」能容下的最大值（夹在上下限之间），所以单纵这种长队会自动缩小、
 * 轮形这种紧凑阵型兵牌大一些；任何阵型下兵牌都不重叠。
 */
// maxWidth：敌我两边要统一尺寸时，由调用方先各自试一遍、取较小的那个再传进来
//（维护者 2026-11-26：敌方联合舰队兵牌被挤小了，我方也跟着变小，两边一样大）
export const fitFormation = (
  points: readonly FormationPoint[],
  side: 0 | 1,
  box: FitBox,
  maxWidth: number = TOKEN_MAX_WIDTH,
): FittedFormation => {
  if (!points.length) return { tokens: [], width: TOKEN_MAX_WIDTH, height: Math.round(TOKEN_MAX_WIDTH * TOKEN_ASPECT) }
  const flip = side === 1 ? -1 : 1
  // 左右 → 屏幕横向（敌方镜像），前后 → 屏幕纵向（前方朝上）
  const xs = points.map((point) => point.y * flip)
  const ys = points.map((point) => -point.x)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const spanX = maxX - minX
  const spanY = maxY - minY

  // 先按「兵牌不重叠」求单位格能放多大：任意两舰在 x 上至少隔一张牌宽、或在 y 上至少隔一张牌高
  const unitFor = (tokenW: number) => {
    const tokenH = tokenW * TOKEN_ASPECT
    let need = 0
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const dx = Math.abs(xs[i] - xs[j])
        const dy = Math.abs(ys[i] - ys[j])
        // 这一对要分开所需的最小单位格：沿 x 分开或沿 y 分开，取容易的那个
        const byX = dx > 0 ? (tokenW * 1.08) / dx : Infinity
        const byY = dy > 0 ? (tokenH * 1.12) / dy : Infinity
        need = Math.max(need, Math.min(byX, byY))
      }
    }
    return need
  }
  // 从大到小试兵牌宽度，取第一个能放进舞台的
  let tokenW = Math.max(TOKEN_MIN_WIDTH, Math.min(TOKEN_MAX_WIDTH, Math.floor(maxWidth)))
  let unit = 0
  for (; tokenW >= TOKEN_MIN_WIDTH; tokenW -= 4) {
    const tokenH = tokenW * TOKEN_ASPECT
    unit = unitFor(tokenW)
    const usedW = spanX * unit + tokenW
    const usedH = spanY * unit + tokenH
    if (usedW <= box.width && usedH <= box.height) break
  }
  tokenW = Math.max(TOKEN_MIN_WIDTH, tokenW)
  const tokenH = Math.round(tokenW * TOKEN_ASPECT)
  unit = unitFor(tokenW)
  // 还放不下（极窄的舞台）就整体压缩单位格，宁可贴近也不出框
  const fitUnit = Math.min(
    unit,
    spanX > 0 ? (box.width - tokenW) / spanX : unit,
    spanY > 0 ? (box.height - tokenH) / spanY : unit,
  )
  const usedW = spanX * fitUnit
  const usedH = spanY * fitUnit
  // 在半边里居中
  const originX = box.left + (box.width - usedW) / 2
  const originY = box.top + (box.height - usedH) / 2
  return {
    width: Math.round(tokenW),
    height: tokenH,
    tokens: points.map((point, at) => ({
      index: point.index,
      cx: Math.round(originX + (xs[at] - minX) * fitUnit),
      cy: Math.round(originY + (ys[at] - minY) * fitUnit),
    })),
  }
}
