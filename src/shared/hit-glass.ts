// 防弹玻璃弹孔（实验性，交接包「编队被弹与特色入渠动画」v2，维护者 2026-11-27 定稿；取代 11-26 的单调缺角）：
// 每一发命中在名卡上留一个弹孔，四种碎裂样式（防弹蛛网 / 斜射长裂 / 钢化碎冰 / 边缘崩缺）按种子确定性轮换，
// 落点只挑行内的留白（舰名右缘到血条左缘、装备尾到行右缘、上下缘窄带），新裂纹碰到旧裂纹或破口就停（T 型止裂），
// 单发高伤直接崩出不对称破口并四散蹦飞碎片；入渠按维修进度逐孔逆向收口。
// 纯逻辑层，无 DOM/Electron 依赖：行内各列的像素位置由调用方量好传进来（rowZonesOf），这里只算几何与拼 SVG。
// 参考实现与逐条防坑见交接包审片台的同名函数（buildBulletHole / clipPolylineToExisting / buildGlassSvg …）。

export type HitGlassTier = 'light' | 'medium' | 'heavy' | 'sunk'
export type GlassPoint = readonly [number, number]
export type GlassPolygon = readonly GlassPoint[]
export type GlassPolyline = readonly GlassPoint[]

export type CrackStyle = 'spiderweb' | 'starburst' | 'mosaic' | 'edge-cleave'
export const CRACK_STYLES: readonly CrackStyle[] = ['spiderweb', 'starburst', 'mosaic', 'edge-cleave']
export type GlassHoleKind = 'shell' | 'asw'
export type HolePower = 1 | 2 | 3 | 4

export interface GlassRay {
  /** 从弹着中心指向外端（正向延展、逆向收口都沿这个方向） */
  readonly pts: GlassPolyline
  readonly strong: boolean
}

export interface GlassShard {
  readonly poly: GlassPolygon
  readonly ang: number
  readonly speed: number
  readonly large: boolean
}

export interface GlassHole {
  readonly idx: number
  readonly style: CrackStyle
  readonly edge: boolean
  readonly x: number
  readonly y: number
  readonly power: HolePower
  readonly singleLoss: number
  readonly massive: boolean
  readonly kind: GlassHoleKind
  readonly corePts: GlassPolygon
  readonly rays: readonly GlassRay[]
  readonly rings: readonly GlassPolyline[]
  readonly facets: readonly GlassPolygon[]
  /** 崩掉的破口：一律直连弹着核心或卡片上下缘，绝不浮空 */
  readonly spallPolys: readonly GlassPolygon[]
  readonly shards: readonly GlassShard[]
}

export interface GlassRect {
  readonly x0: number
  readonly x1: number
  readonly y0: number
  readonly y1: number
}

export interface GlassSafeZone extends GlassRect {
  /** 抽样权重 */
  readonly w: number
  /** 放得下单发重击的大破口 */
  readonly bigOk: boolean
}

/** 行内各列的真实像素位置（相对行左上角）；缺的列按锐的六列网格推一个兜底值 */
export interface RowLayout {
  readonly width: number
  readonly height: number
  /** .who 里文字（舰名 / 能力片 / Lv）实际的最右缘 */
  readonly whoRight?: number | null
  readonly hpc?: GlassRect | null
  readonly fa2?: GlassRect | null
  readonly cond?: GlassRect | null
  readonly eq?: GlassRect | null
  /** 装备格实际占到的最右缘（装备少时右边还有一段留白） */
  readonly eqContentRight?: number | null
}

export interface RowZones {
  readonly width: number
  readonly height: number
  /** 内容区：裂纹压到约三成浓度 */
  readonly avoid: readonly GlassRect[]
  /** 弹孔优先落点 */
  readonly safe: readonly GlassSafeZone[]
}

const r1 = (n: number): number => Math.round(n * 10) / 10
const r2 = (n: number): number => Math.round(n * 100) / 100
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))

export const hashSeed = (a: number, b: number): number => {
  let h = (2166136261 ^ (a | 0)) >>> 0
  h = Math.imul(h, 16777619) >>> 0
  h = (h ^ ((b * 2654435761) >>> 0)) >>> 0
  h = Math.imul(h, 16777619) >>> 0
  return h >>> 0
}

export const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---- 行内安全区 ----

/**
 * 锐编队行的六列网格（index.html `.fleet-skin .ship`：48px / minmax(96px,1fr) / 100px / 52px / 40px / 150px，
 * 列距 8px，开关作用域里左内边距 20px、右 14px）推出来的列位置。只在还没量到真实像素时兜底用。
 */
const gridFallback = (W: number, H: number) => {
  const eq = { x0: W - 164, x1: W - 14, y0: 10, y1: H - 10 }
  const cond = { x0: W - 212, x1: W - 172, y0: 8, y1: H - 8 }
  const fa2 = { x0: W - 272, x1: W - 220, y0: 14, y1: H - 14 }
  const hpc = { x0: W - 380, x1: W - 280, y0: 8, y1: H - 8 }
  return { whoRight: Math.round(Math.max(120, (W - 388) * 0.62)), hpc, fa2, cond, eq }
}

/** 由量到的列位置算出内容避让区与弹孔安全区（审片台 measureRowZones 的纯函数部分） */
export const rowZonesOf = (layout: RowLayout): RowZones => {
  const W = Math.max(120, Math.round(layout.width))
  const H = Math.max(24, Math.round(layout.height))
  const fb = gridFallback(W, H)
  const whoRight = layout.whoRight ?? fb.whoRight
  const hpc = layout.hpc ?? fb.hpc
  const fa2 = layout.fa2 ?? fb.fa2
  const cond = layout.cond ?? fb.cond
  const eq = layout.eq ?? fb.eq
  const eqContentRight = layout.eqContentRight ?? eq.x1
  const avoid: GlassRect[] = [
    { x0: 12, x1: Math.ceil(whoRight + 6), y0: 4, y1: H - 4 }, // 头像 + 舰名 / 能力片 / Lv
    { x0: Math.floor(hpc.x0 - 4), x1: Math.ceil(hpc.x1 + 4), y0: 4, y1: H - 4 }, // 血条与数字
    { x0: Math.floor(fa2.x0 - 2), x1: Math.ceil(fa2.x1 + 2), y0: 10, y1: H - 10 }, // 油弹条
    { x0: Math.floor(cond.x0 - 4), x1: Math.ceil(cond.x1 + 4), y0: 5, y1: H - 5 }, // 疲劳圆环
    { x0: Math.floor(eq.x0 - 2), x1: Math.ceil(eqContentRight + 4), y0: 9, y1: H - 9 }, // 装备格
  ]
  const safe: GlassSafeZone[] = []
  // 主安全区：舰名文字右缘 → 血条左缘（整行最宽敞的天然留白）
  const mainX0 = Math.round(whoRight + 14)
  const mainX1 = Math.round(hpc.x0 - 14)
  if (mainX1 - mainX0 >= 18) safe.push({ x0: mainX0, x1: mainX1, y0: 9, y1: H - 9, w: 7.5, bigOk: true })
  // 次安全区：装备末尾 → 行最右缘
  const tailX0 = Math.round(eqContentRight + 10)
  const tailX1 = Math.round(W - 8)
  if (tailX1 - tailX0 >= 12) safe.push({ x0: tailX0, x1: tailX1, y0: 9, y1: H - 9, w: 3.5, bigOk: tailX1 - tailX0 >= 22 })
  // 顶缘 / 底缘窄带（沿卡片上下边，避开居中排布的文字与装备）
  safe.push({ x0: Math.round(whoRight + 4), x1: Math.round(W - 14), y0: 4, y1: 8, w: 2.2, bigOk: false })
  safe.push({ x0: Math.round(whoRight + 4), x1: Math.round(W - 14), y0: H - 8, y1: H - 4, w: 2.2, bigOk: false })
  return { width: W, height: H, avoid, safe }
}

// ---- 2D 几何：T 型止裂与包含判定 ----

/** 线段 AB 与 CD 相交时返回交点在 AB 上的参数 t（不含两端极近处），否则 null */
export const segIntersectT = (
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): number | null => {
  const rX = bx - ax
  const rY = by - ay
  const sX = dx - cx
  const sY = dy - cy
  const denom = rX * sY - rY * sX
  if (Math.abs(denom) < 1e-6) return null
  const qpx = cx - ax
  const qpy = cy - ay
  const t = (qpx * sY - qpy * sX) / denom
  const u = (qpx * rY - qpy * rX) / denom
  if (t > 0.03 && t < 0.99 && u >= -0.02 && u <= 1.02) return t
  return null
}

export const pointInPoly = (px: number, py: number, poly: GlassPolygon): boolean => {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-9) + xi) inside = !inside
  }
  return inside
}

type Segment = readonly [GlassPoint, GlassPoint]

/** 已有弹孔的放射裂、环裂与破口边，作为新裂纹的止裂线 */
export const holeSegments = (holes: readonly GlassHole[]): Segment[] => {
  const segs: Segment[] = []
  for (const hole of holes) {
    for (const ray of hole.rays) for (let i = 0; i < ray.pts.length - 1; i++) segs.push([ray.pts[i], ray.pts[i + 1]])
    for (const ring of hole.rings) segs.push([ring[0], ring[1]])
    for (const poly of hole.spallPolys) for (let i = 0; i < poly.length; i++) segs.push([poly[i], poly[(i + 1) % poly.length]])
  }
  return segs
}

/** 新裂纹折线碰到既有裂纹或破口边界就截停（T 型交汇）；终点落进既有弹核或破口也提前停住 */
export const clipPolylineToExisting = (
  pts: GlassPolyline,
  existingSegs: readonly Segment[],
  existingHoles: readonly GlassHole[],
): GlassPolyline => {
  if (!existingSegs.length || pts.length < 2) return pts
  const out: GlassPoint[] = [pts[0]]
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i]
    const [bx, by] = pts[i + 1]
    let bestT = 1
    for (const [p1, p2] of existingSegs) {
      const t = segIntersectT(ax, ay, bx, by, p1[0], p1[1], p2[0], p2[1])
      if (t !== null && t < bestT) bestT = t
    }
    if (bestT < 1) {
      out.push([r1(ax + (bx - ax) * bestT), r1(ay + (by - ay) * bestT)])
      return out
    }
    if (existingHoles.some((h) => Math.hypot(bx - h.x, by - h.y) < 8 || h.spallPolys.some((poly) => pointInPoly(bx, by, poly)))) {
      out.push([r1(ax + (bx - ax) * 0.45), r1(ay + (by - ay) * 0.45)])
      return out
    }
    out.push(pts[i + 1])
  }
  return out
}

// ---- 落点 ----

export const HOLE_MIN_DIST = 44
export const HOLE_MIN_DIST_MASSIVE = 54
const HOLE_MIN_DIST_RELAXED = 36

interface BulletPoint {
  x: number
  y: number
  forceEdge?: boolean
}

/** 安全区里抽一个落点：严守最小中心距、不落进既有破口；放不下就转边缘崩缺，再放不下返回 null（不硬叠第二个核） */
const pickSafeBulletPoint = (
  rng: () => number,
  zones: RowZones,
  existing: readonly GlassHole[],
  massive: boolean,
  forEdge: boolean,
): BulletPoint | null => {
  const { width: W, height: H, safe } = zones
  const minDist = massive ? HOLE_MIN_DIST_MASSIVE : HOLE_MIN_DIST
  let pool: readonly GlassSafeZone[]
  if (forEdge) {
    // 边缘崩缺沿卡片上下缘取点（避开最左头像区）
    const minX = Math.max(84, safe[0]?.x0 ?? Math.round(W * 0.34))
    pool = [
      { x0: minX, x1: Math.round(W - 18), y0: 0, y1: 0, w: 3, bigOk: true },
      { x0: minX, x1: Math.round(W - 18), y0: H, y1: H, w: 3, bigOk: true },
    ]
  } else {
    const big = massive ? safe.filter((zone) => zone.bigOk) : safe
    pool = big.length ? big : safe
  }
  if (!pool.length) return null
  const totalW = pool.reduce((s, zone) => s + zone.w, 0)
  const sampleZone = (): GlassSafeZone => {
    let r = rng() * totalW
    for (const zone of pool) {
      r -= zone.w
      if (r <= 0) return zone
    }
    return pool[0]
  }
  let best: BulletPoint | null = null
  let bestDist = -1
  for (let attempt = 0; attempt < 48; attempt++) {
    const zone = sampleZone()
    const x = Math.round(zone.x0 + rng() * Math.max(2, zone.x1 - zone.x0))
    const y = zone.y0 === zone.y1 ? zone.y0 : Math.round(zone.y0 + rng() * Math.max(2, zone.y1 - zone.y0))
    if (existing.some((h) => h.spallPolys.some((poly) => pointInPoly(x, y, poly)))) continue
    const d = existing.length ? Math.min(...existing.map((h) => Math.hypot(h.x - x, h.y - y))) : 999
    if (d >= minDist) return { x, y }
    if (d > bestDist) {
      bestDist = d
      best = { x, y }
    }
  }
  if (best && bestDist >= HOLE_MIN_DIST_RELAXED) return best
  if (!forEdge) {
    const edge = pickSafeBulletPoint(rng, zones, existing, false, true)
    if (edge) return { ...edge, forceEdge: true }
  }
  return null
}

// ---- 单发碎裂几何 ----

export interface BulletHoleInput {
  shipId: number
  seedKey: number
  /** 本轮带伤里的第几个弹孔（同舰递增，参与种子） */
  idx: number
  /** 这一发掉的血占最大耐久 */
  singleLoss: number
  /** 单发高伤：直接崩出大破口 */
  massive: boolean
  kind: GlassHoleKind
  zones: RowZones
  existing: readonly GlassHole[]
  forcedStyle?: CrackStyle
}

/** 单发威力档：1 擦伤针孔 … 4 大片崩碎 */
export const holePowerOf = (singleLoss: number, massive: boolean): HolePower =>
  massive || singleLoss >= 0.48 ? 4 : singleLoss >= 0.28 ? 3 : singleLoss >= 0.13 ? 2 : 1

/**
 * 生成一发的碎裂几何。四种样式各有防违和红线：不画脱离中心的浮空黑块、不画「大圆盘 + 中间实心点」的眼珠核、
 * 不画对称五角星；裂纹线宽保持纤细。返回 null＝安全区都满了，这一发不再叠第二个核。
 */
export const buildBulletHole = (input: BulletHoleInput): GlassHole | null => {
  const { shipId, seedKey, idx, singleLoss, massive, kind, zones, existing, forcedStyle } = input
  const W = zones.width
  const H = zones.height
  const rng = mulberry32(hashSeed(shipId * 97 + idx * 31, seedKey * 17 + Math.round(singleLoss * 100)))
  let style: CrackStyle
  if (forcedStyle) {
    style = forcedStyle
  } else {
    // 同舰相邻两发自动错开样式
    const prevStyle = existing.length ? existing[existing.length - 1].style : null
    const pool = CRACK_STYLES.filter((s) => s !== prevStyle)
    style = pool[Math.floor(rng() * pool.length)]
  }
  const pt = pickSafeBulletPoint(rng, zones, existing, massive, style === 'edge-cleave')
  if (!pt) return null
  if (pt.forceEdge) style = 'edge-cleave'

  let x = pt.x
  let y = pt.y
  const power = holePowerOf(singleLoss, massive)
  // 克制的弹着核半径（不画成卡通圆盘）
  const coreR = [0, 1.4, 1.9, 2.5, 3.3][power]

  const corePts: GlassPoint[] = []
  const rawRays: { ang: number; len: number; strong: boolean; pts: GlassPolyline }[] = []
  const rawRings: GlassPolyline[] = []
  const facets: GlassPolygon[] = []
  const spallPolys: GlassPolygon[] = []
  const shards: GlassShard[] = []
  let edge = false
  const at = (cx: number, cy: number, ang: number, len: number): GlassPoint => [r1(cx + Math.cos(ang) * len), r1(cy + Math.sin(ang) * len)]

  if (style === 'edge-cleave') {
    // ④ 边缘崩缺：贴顶缘或底缘的锐角缺口 + 陡峭入内的解理裂纹
    edge = true
    const topSide = y <= H * 0.5
    y = topSide ? 0 : H
    const dirY = topSide ? 1 : -1
    const notchW = [0, 8, 12, 17, 25][power] + rng() * 4
    const notchD = [0, 5, 8, 13, 18][power] + rng() * 3
    const skew = (rng() - 0.5) * 8
    const apexX = r1(x + skew)
    const apexY = r1(y + dirY * notchD)
    const leftX = r1(x - notchW * 0.54)
    const rightX = r1(x + notchW * 0.54)
    // 加一个自然的中间折点，像真实崩裂而不是等腰三角形
    const midLX = r1((leftX + apexX) * 0.5 + (rng() - 0.5) * 3)
    const midLY = r1(y + dirY * notchD * (0.42 + rng() * 0.18))
    const cutPoly: GlassPolygon = [[leftX, y], [rightX, y], [apexX, apexY], [midLX, midLY]]
    corePts.push(...cutPoly)
    if (power >= 2) {
      spallPolys.push(cutPoly)
      shards.push({ poly: cutPoly, ang: Math.atan2(dirY, skew * 0.12), speed: 0.9 + power * 0.22, large: true })
    }
    const rCount = [0, 3, 4, 6, 8][power]
    for (let i = 0; i < rCount; i++) {
      const spread = ((i / Math.max(1, rCount - 1)) - 0.5) * 2.1 + (rng() - 0.5) * 0.24
      const ang = Math.atan2(dirY, spread)
      const len = (12 + rng() * 28) * (power >= 3 ? 1.25 : 0.85)
      const mid = at(apexX, apexY, ang + (rng() - 0.5) * 0.24, len * 0.48)
      rawRays.push({ ang, len, strong: i % 2 === 0 || power >= 4, pts: [[apexX, apexY], mid, at(apexX, apexY, ang, len)] })
    }
    for (let i = 0; i < rawRays.length - 1; i++) {
      if (rng() < 0.55) continue
      rawRings.push([rawRays[i].pts[1], rawRays[i + 1].pts[1]])
      if (power >= 3 && i % 2 === 0) facets.push([[apexX, apexY], rawRays[i].pts[1], rawRays[i + 1].pts[1]])
    }
    if (power >= 3) {
      const extraN = power >= 4 ? 5 : 2
      for (let e = 0; e < extraN; e++) {
        const ang = Math.atan2(dirY, (rng() - 0.5) * 2.2)
        const sz = 4 + rng() * 6
        shards.push({ poly: [[apexX, apexY], at(apexX, apexY, ang, sz), at(apexX, apexY, ang + 0.55, sz * 0.8)], ang, speed: 0.9 + rng() * 0.9, large: false })
      }
    }
  } else if (style === 'starburst') {
    // ② 斜射长裂：紧致的斜向微破口 + 双向锯齿长裂 + 细羽毛分支
    const axis = (rng() < 0.5 ? -1 : 1) * (0.26 + rng() * 0.46)
    const rx = coreR * 1.45
    const ry = coreR * 0.65
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2
      const lx = Math.cos(a) * rx * (0.85 + rng() * 0.25)
      const ly = Math.sin(a) * ry * (0.85 + rng() * 0.25)
      corePts.push([r1(x + lx * Math.cos(axis) - ly * Math.sin(axis)), r1(y + lx * Math.sin(axis) + ly * Math.cos(axis))])
    }
    const mainLen = [0, 18, 28, 42, 64][power]
    for (const dir of [-1, 1]) {
      const ang = axis + (dir < 0 ? Math.PI : 0)
      const len = mainLen * (0.8 + rng() * 0.35)
      const kink = (rng() - 0.5) * 0.3
      const p0: GlassPoint = [x, y]
      const p1 = at(x, y, ang + kink, len * 0.45)
      const p2 = at(x, y, ang + kink * 0.35, len)
      rawRays.push({ ang, len, strong: true, pts: [p0, p1, p2] })
      const featherN = power + 1
      for (let f = 0; f < featherN; f++) {
        const t = 0.28 + (f / featherN) * 0.62
        const bx = p0[0] + (p1[0] - p0[0]) * Math.min(1, t * 1.35)
        const by = p0[1] + (p1[1] - p0[1]) * Math.min(1, t * 1.35)
        const side = f % 2 === 0 ? 1 : -1
        const fang = ang + side * (0.52 + rng() * 0.45)
        const flen = (8 + rng() * 14) * (power >= 3 ? 1.15 : 0.8)
        rawRays.push({ ang: fang, len: flen, strong: false, pts: [[r1(bx), r1(by)], at(bx, by, fang, flen * 0.55), at(bx, by, fang + side * 0.14, flen)] })
      }
    }
    if (power >= 3) {
      // 沿弹道贴着中心撕出一块锐角窄碎口（不浮空）
      const lA = coreR * (power >= 4 ? 3.8 : 2.3)
      const lB = coreR * (power >= 4 ? 2.6 : 1.7)
      const wedge: GlassPolygon = [[x, y], at(x, y, axis - 0.28, lA), at(x, y, axis + 0.12, lB), at(x, y, axis + Math.PI - 0.35, coreR * 1.3)]
      spallPolys.push(wedge)
      shards.push({ poly: wedge, ang: axis, speed: 1.15, large: true })
      facets.push([wedge[0], wedge[1], rawRays[0].pts[1]])
      const extra = power >= 4 ? 5 : 2
      for (let e = 0; e < extra; e++) {
        const a = axis + (rng() - 0.5) * 1.6 + (e % 2 ? Math.PI : 0)
        const sz = 4 + rng() * 6
        shards.push({ poly: [[x, y], at(x, y, a, sz * 1.3), at(x, y, a + 0.3, sz * 0.7)], ang: a, speed: 1.0 + rng() * 0.85, large: false })
      }
    }
  } else if (style === 'mosaic') {
    // ③ 钢化碎冰：非对称错落的多边形冰裂（不画同心圆雷达图、不画外圈浮空黑块）
    const spokes = [0, 5, 6, 8, 9][power]
    const angs = Array.from({ length: spokes }, (_, i) => (i / spokes) * Math.PI * 2 + (rng() - 0.5) * 0.52).sort((a, b) => a - b)
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + (rng() - 0.5) * 0.4
      corePts.push(at(x, y, a, coreR * (0.65 + rng() * 0.55)))
    }
    const midPts: GlassPoint[] = []
    angs.forEach((a, i) => {
      const len = (11 + rng() * (power * 9)) * (i % 2 === 0 ? 1.15 : 0.78)
      const mFrac = 0.42 + rng() * 0.24
      const kink = (rng() - 0.5) * 0.42
      const mPt = at(x, y, a + kink, len * mFrac)
      midPts.push(mPt)
      rawRays.push({ ang: a, len, strong: i % 2 === 0 || power >= 4, pts: [[x, y], mPt, at(x, y, a + kink * 0.4, len)] })
    })
    // 只连部分相邻折点的斜向交联，避免画成蜘蛛网雷达图
    for (let i = 0; i < spokes; i++) {
      const j = (i + 1) % spokes
      if (rng() > 0.34) rawRings.push([midPts[i], midPts[j]])
      if ((i + power) % 2 === 0 && rng() > 0.35) facets.push([[x, y], midPts[i], midPts[j]])
    }
    if (power >= 3) {
      // 只在中心交汇处崩脱 1–2 片紧连核心的冰块
      const chunkCount = power >= 4 ? 2 : 1
      for (let c = 0; c < chunkCount; c++) {
        const i = Math.floor((c * spokes) / chunkCount + rng() * 2) % spokes
        const j = (i + 1) % spokes
        const fa = power >= 4 ? 0.92 : 0.68
        const fb = power >= 4 ? 0.88 : 0.62
        const pA: GlassPoint = [r1(x + (midPts[i][0] - x) * fa), r1(y + (midPts[i][1] - y) * fa)]
        const pB: GlassPoint = [r1(x + (midPts[j][0] - x) * fb), r1(y + (midPts[j][1] - y) * fb)]
        const chip: GlassPolygon = [[x, y], pA, pB]
        spallPolys.push(chip)
        shards.push({ poly: chip, ang: (angs[i] + angs[j]) * 0.5, speed: 0.95 + rng() * 0.65, large: true })
      }
      const extra = power >= 4 ? 5 : 2
      for (let e = 0; e < extra; e++) {
        const i = Math.floor(rng() * spokes)
        const j = (i + 1) % spokes
        shards.push({ poly: [[x, y], midPts[i], midPts[j]], ang: angs[i], speed: 0.85 + rng() * 0.9, large: false })
      }
    }
  } else {
    // ① 防弹蛛网：极细的放射丝裂 + 贴近核心的断续环裂 + 中心直连的崩口
    const rayCount = [0, 5, 7, 10, 13][power] + Math.floor(rng() * 2)
    const ringCount = [0, 1, 2, 2, 3][power]
    for (let i = 0; i < 7; i++) {
      const ang = (i / 7) * Math.PI * 2 + (rng() - 0.5) * 0.35
      corePts.push(at(x, y, ang, coreR * (0.7 + rng() * 0.5)))
    }
    const rayAngles = Array.from({ length: rayCount }, (_, i) => (i / rayCount) * Math.PI * 2 + (rng() - 0.5) * ((Math.PI * 2) / rayCount) * 0.55).sort((a, b) => a - b)
    rayAngles.forEach((ang, i) => {
      const isLong = i % 2 === 0 || power >= 4
      const minLen = [0, 8, 12, 18, 26][power]
      const maxLen = [0, 17, 26, 40, 62][power]
      const len = minLen + rng() * (maxLen - minLen) * (isLong ? 1 : 0.6)
      const midFrac = 0.42 + rng() * 0.22
      const kink = (rng() - 0.5) * (isLong ? 0.26 : 0.16)
      rawRays.push({
        ang,
        len,
        strong: isLong && (power >= 3 || i % 3 === 0),
        pts: [[x, y], at(x, y, ang + kink, len * midFrac), at(x, y, ang + kink * 0.45, len)],
      })
    })
    for (let rIdx = 0; rIdx < ringCount; rIdx++) {
      const baseR = coreR * (2.1 + rIdx * 1.7) + rng() * 1.8
      for (let i = 0; i < rawRays.length; i++) {
        if (rng() < (rIdx === 0 ? 0.18 : 0.42)) continue
        const rA = rawRays[i]
        const rB = rawRays[(i + 1) % rawRays.length]
        if (baseR > Math.min(rA.len, rB.len) * 0.82) continue
        rawRings.push([at(x, y, rA.ang, baseR * (0.86 + rng() * 0.24)), at(x, y, rB.ang, baseR * (0.86 + rng() * 0.24))])
      }
    }
    const facetCount = power >= 4 ? 4 : power === 3 ? 2 : power === 2 ? 1 : 0
    for (let k = 0; k < facetCount; k++) {
      const i = Math.floor(rng() * rawRays.length)
      const rA = rawRays[i]
      const rB = rawRays[(i + 1) % rawRays.length]
      const d1 = coreR * 1.5
      const d2 = d1 + coreR * (1.8 + rng() * 1.4)
      facets.push([at(x, y, rA.ang, d1), at(x, y, rA.ang, d2), at(x, y, rB.ang, d2 * 0.92), at(x, y, rB.ang, d1)])
    }
    if (power >= 3) {
      // 单发重击：顶点锚定在真实放射裂方向上的不对称破口（一侧撕得更宽，不画对称五角星）
      const biasAng = rng() * Math.PI * 2
      const nVerts = power >= 4 ? 7 : 5
      const breach: GlassPoint[] = []
      for (let i = 0; i < nVerts; i++) {
        const ray = rawRays[Math.floor((i * rawRays.length) / nVerts)]
        const align = 0.5 + 0.5 * Math.cos(ray.ang - biasAng)
        const rad = power >= 4 ? coreR * (1.25 + align * 2.15 + rng() * 0.75) : coreR * (0.95 + align * 1.15 + rng() * 0.45)
        breach.push(at(x, y, ray.ang, rad))
      }
      spallPolys.push(breach)
      const shardCount = power >= 4 ? 7 : 3
      for (let e = 0; e < shardCount; e++) {
        const ang = (e / shardCount) * Math.PI * 2 + (rng() - 0.5) * 0.5
        const large = e < (power >= 4 ? 3 : 1)
        const sz = large ? 7 + rng() * 6 : 4 + rng() * 4.5
        const ox = x + Math.cos(ang) * coreR * 0.9
        const oy = y + Math.sin(ang) * coreR * 0.9
        shards.push({ poly: [[r1(ox), r1(oy)], at(ox, oy, ang - 0.42, sz), at(ox, oy, ang + 0.26, sz * 1.25)], ang, speed: (large ? 1.1 : 0.95) + rng() * 0.8, large })
      }
    } else if (power === 2) {
      const ang = rng() * Math.PI * 2
      shards.push({ poly: [[r1(x), r1(y)], at(x, y, ang, 4.2), at(x, y, ang + 0.65, 3.4)], ang, speed: 0.55, large: false })
    }
  }

  // T 型止裂：新裂纹遇到既有裂纹或破口边界即停，不互相乱穿；环裂落进既有弹核或破口就剔掉
  const existingSegs = holeSegments(existing)
  const rays = rawRays
    .map((ray) => ({ pts: clipPolylineToExisting(ray.pts, existingSegs, existing), strong: ray.strong }))
    .filter((ray) => ray.pts.length >= 2)
  const rings = rawRings.filter(([p1, p2]) => {
    if (existing.some((h) => Math.hypot(p1[0] - h.x, p1[1] - h.y) < 12 || Math.hypot(p2[0] - h.x, p2[1] - h.y) < 12)) return false
    return !existing.some((h) => h.spallPolys.some((poly) => pointInPoly(p1[0], p1[1], poly) || pointInPoly(p2[0], p2[1], poly)))
  })
  return { idx, style, edge, x, y, power, singleLoss, massive, kind, corePts, rays, rings, facets, spallPolys, shards }
}

// ---- 入渠逐孔逆向焊修 ----

export interface HoleRepairState {
  status: 'intact' | 'healing' | 'done'
  /** 外环与折光收拢 0..1 */
  ringRetract: number
  /** 放射裂纹从尖端缩回核心 0..1 */
  rayRetract: number
  /** 破口向心闭合 0..1 */
  voidClose: number
  /** 焊修微光强度 0..1（只沿裂纹与破口棱边，不画圆） */
  weldGlow: number
}

const INTACT: HoleRepairState = { status: 'intact', ringRetract: 0, rayRetract: 0, voidClose: 0, weldGlow: 0 }
const DONE: HoleRepairState = { status: 'done', ringRetract: 1, rayRetract: 1, voidClose: 1, weldGlow: 0 }

/**
 * 入渠进度 progress（0..1，null＝不在渠）下这个弹孔修到哪一步：按单发威力轻→重排队各占一段，
 * 每段内精确逆向三拍——外环与折光先收 → 放射裂从外尖端缩回核心 → 中心破口闭合。
 */
export const holeRepairState = (holes: readonly GlassHole[], hole: GlassHole, progress: number | null): HoleRepairState => {
  if (progress == null || !holes.length || progress <= 0.001) return INTACT
  const ordered = [...holes].sort((a, b) => a.power - b.power || a.idx - b.idx)
  const rank = ordered.indexOf(hole)
  const n = ordered.length
  const start = rank / n
  const end = (rank + 1) / n
  if (progress >= end) return DONE
  if (progress <= start) return INTACT
  const local = clamp01((progress - start) / (end - start))
  return {
    status: 'healing',
    ringRetract: clamp01(local / 0.34),
    rayRetract: clamp01((local - 0.08) / 0.68),
    voidClose: clamp01((local - 0.56) / 0.44),
    weldGlow: Math.sin(local * Math.PI),
  }
}

// ---- SVG ----

const pointsOf = (poly: GlassPolygon): string => poly.map(([x, y]) => `${x},${y}`).join(' ')
const pathOf = (pts: GlassPolyline): string => pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' ')
const scaleAround = (x: number, y: number, s: number): string =>
  s >= 0.999 ? '' : ` transform="translate(${x} ${y}) scale(${s.toFixed(3)}) translate(${-x} ${-y})"`

export interface GlassSvgInput {
  /** 同一页里唯一的前缀（取舰 id），用来给 mask 起名 */
  readonly id: number | string
  readonly holes: readonly GlassHole[]
  /** 当前伤势档（定裂纹颜色）；null＝还没到小破线，按小破色 */
  readonly tier: HitGlassTier | null
  readonly zones: RowZones
  /** 入渠维修进度；null＝不在渠 */
  readonly progress: number | null
  /** 要员焊补态：裂纹转琥珀焊缝色 */
  readonly welded?: boolean
}

const strokeOfTier = (tier: HitGlassTier | null): string =>
  tier === 'sunk'
    ? 'var(--hit-glass-sunk)'
    : tier === 'heavy'
      ? 'var(--hit-glass-heavy)'
      : tier === 'medium'
        ? 'var(--hit-glass-mid)'
        : 'var(--hit-glass-light)'

/**
 * 整张玻璃层（审片台 buildGlassSvg）：①折光面 → ②纤细裂纹（pathLength=100，正向 100→0 飙开、逆向 0→100 缩回）
 * → ③崩落破口压住裂纹 → ④无破口时的紧致针孔核。内容列下方的裂纹用 mask 压到约三成浓度；
 * 所有破口另在 void mask 里从裂纹层镂空，闭合缩放与破口同频，破口里永远不透出放射线。全修好返回空串。
 */
export const hitGlassSvg = ({ id, holes, tier, zones, progress, welded = false }: GlassSvgInput): string => {
  if (!holes.length) return ''
  const W = zones.width
  const H = zones.height
  const strokeCol = welded ? 'var(--hit-glass-weld)' : strokeOfTier(tier)
  const rimCol = welded ? 'var(--hit-glass-weld)' : tier === 'heavy' ? 'var(--hit-glass-heavy-rim)' : strokeCol
  const safeId = `glass-safe-${id}`
  const voidId = `glass-void-${id}`
  const states = holes.map((hole) => holeRepairState(holes, hole, progress))
  if (states.every((state) => state.status === 'done')) return ''

  const maskRects = zones.avoid
    .map((a) => `<rect x="${Math.max(0, a.x0)}" y="${Math.max(0, a.y0)}" width="${Math.max(4, a.x1 - a.x0)}" height="${Math.max(4, a.y1 - a.y0)}" rx="4" fill="rgb(84,84,84)"/>`)
    .join('')
  let voidCuts = ''
  let facetLayer = ''
  let crackLayer = ''
  let voidLayer = ''
  let coreLayer = ''
  holes.forEach((h, i) => {
    const rep = states[i]
    if (rep.status === 'done') return
    const healing = rep.status === 'healing'
    const col = healing ? 'var(--hit-aqua)' : h.kind === 'asw' && !welded ? 'var(--asw-sonar)' : strokeCol
    const hRim = healing ? 'var(--hit-weld-spark)' : rimCol
    const baseAlpha = h.power >= 4 ? 0.95 : h.power === 3 ? 0.82 : 0.66
    const rayOff = (rep.rayRetract * 100).toFixed(1)
    const ringOff = (rep.ringRetract * 100).toFixed(1)
    const facetOp = (1 - rep.ringRetract) * baseAlpha * 0.85
    const vScale = Math.max(0, 1 - rep.voidClose)
    const vTf = scaleAround(h.x, h.y, vScale)
    const hid = ` data-hid="${h.idx}"`
    const center = ` data-cx="${h.x}" data-cy="${h.y}"`

    if (vScale > 0.02) {
      for (const poly of h.spallPolys) voidCuts += `<polygon class="hole-void-cut"${hid}${center} points="${pointsOf(poly)}" fill="black"${vTf}/>`
    }
    if (h.facets.length && facetOp > 0.01) {
      facetLayer += h.facets.map((f) => `<polygon class="hole-facet"${hid} points="${pointsOf(f)}" style="fill:var(--hit-glass-frost)" opacity="${facetOp.toFixed(2)}"/>`).join('')
    }
    if (rep.rayRetract < 0.995) {
      for (const ray of h.rays) {
        const d = pathOf(ray.pts)
        const sw = ray.strong ? (h.power >= 4 ? 0.88 : 0.72) : 0.55
        const swDark = ray.strong ? 1.05 : 0.75
        const op = (ray.strong ? 0.78 : 0.48) * baseAlpha
        const shift = ray.strong ? '.6,.6' : '.45,.45'
        // 焊修光沿裂纹本身走（低透明宽描边），不叠圆形光环
        const glow =
          (healing && ray.strong && rep.weldGlow > 0.05) || (welded && ray.strong)
            ? `<path class="hole-ray"${hid} pathLength="100" d="${d}" fill="none" style="stroke:${welded && !healing ? 'var(--hit-damecon)' : 'var(--hit-aqua)'}" stroke-width="2.4" stroke-dasharray="100 100" stroke-dashoffset="${rayOff}" opacity="${(0.28 * (healing ? rep.weldGlow : 1)).toFixed(2)}"/>`
            : ''
        crackLayer += `${glow}<path class="hole-ray"${hid} pathLength="100" d="${d}" fill="none" style="stroke:var(--hit-glass-dark)" stroke-width="${swDark}" stroke-dasharray="100 100" stroke-dashoffset="${rayOff}" opacity="${ray.strong ? '.36' : '.24'}" transform="translate(${shift})"/><path class="hole-ray hole-ray-main"${hid} pathLength="100" d="${d}" fill="none" style="stroke:${col}" stroke-width="${sw}" stroke-dasharray="100 100" stroke-dashoffset="${rayOff}" opacity="${op.toFixed(2)}"/>`
      }
    }
    if (rep.ringRetract < 0.995) {
      for (const seg of h.rings) {
        const d = pathOf(seg)
        crackLayer += `<path class="hole-ring"${hid} pathLength="100" d="${d}" fill="none" style="stroke:var(--hit-glass-dark)" stroke-width=".75" stroke-dasharray="100 100" stroke-dashoffset="${ringOff}" opacity=".24" transform="translate(.4,.4)"/><path class="hole-ring"${hid} pathLength="100" d="${d}" fill="none" style="stroke:${col}" stroke-width=".6" stroke-dasharray="100 100" stroke-dashoffset="${ringOff}" opacity="${(0.54 * baseAlpha).toFixed(2)}"/>`
      }
    }
    if (h.spallPolys.length && vScale > 0.02) {
      voidLayer += `<g class="hole-void-group"${hid}${center}${vTf}>${h.spallPolys
        .map((poly) => {
          const pts = pointsOf(poly)
          const rimGlow =
            healing && rep.weldGlow > 0.05
              ? `<polygon points="${pts}" fill="none" style="stroke:var(--hit-weld-spark)" stroke-width="2.6" opacity="${(0.3 * rep.weldGlow).toFixed(2)}"/>`
              : ''
          return `<polygon points="${pts}" style="fill:var(--hit-glass-void)" opacity="${h.power >= 4 ? 0.92 : 0.84}"/>${rimGlow}<polygon points="${pts}" fill="none" style="stroke:${hRim}" stroke-width="${h.power >= 4 ? 1.05 : 0.85}" opacity=".86"/>`
        })
        .join('')}</g>`
    }
    if (!h.edge && !h.spallPolys.length && vScale > 0.02) {
      const pts = pointsOf(h.corePts)
      const coreWeld =
        healing && rep.weldGlow > 0.05
          ? `<polygon points="${pts}" fill="none" style="stroke:var(--hit-weld-spark)" stroke-width="2.3" opacity="${(0.32 * rep.weldGlow).toFixed(2)}"/>`
          : ''
      // 针孔核：极小的粉碎多边形 + 一点亮芯（半径 1 上下，不是「大圆盘 + 实心点」的眼珠）
      coreLayer += `<g class="hole-core-group"${hid}${center}${vTf}>${coreWeld}<polygon points="${pts}" style="fill:var(--hit-glass-core-pit);stroke:${hRim};stroke-width:.65" opacity=".76"/><circle cx="${h.x}" cy="${h.y}" r="${(0.7 + h.power * 0.25).toFixed(2)}" style="fill:var(--hit-glass-core)" opacity=".68"/></g>`
    }
  })
  const defs = `<defs><mask id="${safeId}"><rect x="0" y="0" width="${W}" height="${H}" fill="white"/>${maskRects}</mask><mask id="${voidId}"><rect x="0" y="0" width="${W}" height="${H}" fill="white"/>${voidCuts}</mask></defs>`
  // 宽度钉成像素：行宽变了弹孔原地不动、不被拉扁（下一次量到新列位置前，内容区蒙版可能差几像素）
  return `<svg class="glass-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:${W}px">${defs}<g mask="url(#${safeId})"><g mask="url(#${voidId})">${facetLayer}${crackLayer}</g>${voidLayer}${coreLayer}</g></svg>`
}

export interface WaterInput {
  /** 积水液面（行高的百分比） */
  readonly level: number
  /** 当前倾角（deg，正＝右沉）与受创时的倾角：液面斜率跟当前倾角走，入渠扶正时逐渐变平 */
  readonly listNow: number
  readonly listBase: number
  readonly docked: boolean
  readonly width: number
  readonly height: number
  /** 涟漪位置与节奏的种子（舰 id）：同一艘每次画出来一样，输出逐字节不变才不会打断正在跑的动画 */
  readonly seed?: number
}

/** 液面波形的半高（px）：样式表里水线与涟漪贴图的基线在它下面这么多像素 */
const WATER_CREST = 5

/**
 * 分层进水液面（交接包审片台 buildWaterSvg 的取代品）：右侧（破口侧）略深，入渠时随进度抽干、随扶正变平。
 * 外壳定液面高度与斜率；里面是平静的水体，水线上间歇有一道浪从行的一端走到另一端、停一阵再走回来
 *（周期与错相按舰稳定随机）。浪就是水线本身的一段起伏，形状与动画在样式表，只动 transform（合成线程）。
 * 演变：11-27 他报「进水没有动态特效」→ 两层正弦整条滚；11-28 他报「波纹太规律」→ 原地鼓起的涟漪；
 * 「像中间突然凸起一块」→ 半路淡入淡出的浪串；「浪出现至少也得从左端到右端（或者反过来）」→ 横穿整行的浪串；
 * 「波纹的样式也不要这么突兀……和旁边的平静的水面脱节了」→ 浪改成水线自己的起伏，高低不齐、两头收平。
 */
export const hitWaterHtml = ({ level, listNow, listBase, docked, width: W, height: H, seed = 0 }: WaterInput): string => {
  if (level <= 0.4) return ''
  const baseY = H * (1 - level / 100)
  const slope = Math.min(6, (level / 50) * 5.2) * (listBase > 0 ? listNow / Math.max(0.2, listBase) : docked ? 0 : 1)
  // 卡片顺时针右沉时，水平的液面在卡片坐标里是右高左低：右侧（破口侧）水更深
  const yL = baseY + slope
  const yR = baseY - slope
  const tilt = (Math.atan2(yR - yL, Math.max(1, W)) * 180) / Math.PI
  const rng = mulberry32(hashSeed(seed, 0x5ea))
  // 一个单程周期 13～19s；错相落在一来一回之内，起步时浪在哪一端、往哪走都随舰
  const period = 13 + rng() * 6
  const swell = `<i class="swell" style="--rt:${period.toFixed(2)}s;--rd:${(-rng() * period * 2).toFixed(2)}s"></i>`
  return `<span class="water-body${docked ? ' dock' : ''}" style="--water-top:${(yL - WATER_CREST).toFixed(1)}px;--water-tilt:${tilt.toFixed(3)}deg"><i class="surface"></i>${swell}</span>`
}

// ---- 头像裁角与故障错相（与弹孔无关，跟着这一轮带伤的种子走） ----

export interface HitAvatarVars {
  readonly topSide: boolean
  readonly fcTilt: number
  readonly fcSunkTilt: number
  readonly fcClipMid: string
  readonly fcClipHeavy: string
  readonly fcClipSunk: string
  readonly gDur: number
  readonly gDelay: number
}

/** 头像倾斜 / 裁角与大破故障错相的随机量：同舰同一轮带伤稳定，修满后换一套 */
export const hitAvatarVars = (shipId: number, seedKey: number): HitAvatarVars => {
  const rng = mulberry32(hashSeed(shipId, seedKey))
  const topSide = rng() < 0.5
  const gDur = r2(3.5 + rng() * 0.9)
  const gDelay = -r2(0.15 + rng() * (gDur - 0.3))
  const tiltSign = rng() < 0.65 ? -1 : 1
  return {
    topSide,
    fcTilt: r1((2.0 + rng() * 1.1) * tiltSign),
    fcSunkTilt: r1((7.2 + rng() * 2.8) * tiltSign),
    fcClipMid: topSide
      ? 'polygon(0 0, 82% 0, 100% 24%, 100% 100%, 0 100%)'
      : 'polygon(0 0, 100% 0, 100% 76%, 82% 100%, 0 100%)',
    fcClipHeavy: topSide
      ? 'polygon(0 0, 74% 0, 100% 34%, 100% 100%, 0 100%)'
      : 'polygon(0 0, 100% 0, 100% 66%, 74% 100%, 0 100%)',
    fcClipSunk: topSide
      ? 'polygon(0 0, 74% 0, 100% 34%, 100% 66%, 68% 100%, 0 100%)'
      : 'polygon(0 0, 68% 0, 100% 34%, 100% 66%, 74% 100%, 0 100%)',
    gDur,
    gDelay,
  }
}

/** 行上要挂的头像倾斜、头像裁角与大破故障错相变量（编队行 style 里用） */
export const hitAvatarCssVars = (shipId: number, seedKey: number): string => {
  const v = hitAvatarVars(shipId, seedKey)
  return [
    `--fc-tilt:${v.fcTilt}deg`,
    `--fc-sunk-tilt:${v.fcSunkTilt}deg`,
    `--fc-clip-mid:${v.fcClipMid}`,
    `--fc-clip-heavy:${v.fcClipHeavy}`,
    `--fc-clip-sunk:${v.fcClipSunk}`,
    `--g-dur:${v.gDur}s`,
    `--g-delay:${v.gDelay}s`,
  ].join(';')
}
