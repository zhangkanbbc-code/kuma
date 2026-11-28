// 历史战损：返港后弹孔「修复」成四角碎裂、积水抽干留下锈渍（实验性，维护者 2026-11-28 定）。
//
// 出击中的弹孔与积水是「当次伤害」；一回港，弹孔收口、四个角的碎裂随之长出来，水抽干、原来的水线附近留锈。
// 四角碎裂随伤害累计长大：先在一个角出现，掉血越多亮起的角越多、各自往里裂得越深；
// 伤到大破线（缺失 75%），左右两头各自的上下碎裂在中段接上，像一块玻璃板摔碎了两头。
// 几何按 (舰, 种子) 在看伤势之前一次算完，伤势只决定每条裂纹画出多长、碎角多大——跨档只延伸不跳位，
// 入渠时按维修进度原路缩回。纯逻辑层，无 DOM/Electron 依赖。

import { hashSeed, mulberry32, type GlassPoint, type GlassPolygon, type GlassPolyline, type RowZones } from './hit-glass'

/** 缺失多少血量时四角碎裂长满、左右两头各自接上（大破线） */
export const SCAR_FULL_LOSS = 0.75
/**
 * 四个角依次亮起的缺失血量，跟着伤势档走（2026-11-28 他看实机「没有补状态呀」：擦伤的碎裂只有几个像素，等于没画）：
 * 擦伤一角、小破（缺 25%）两角、中破（缺 50%）三角、再深一点四角，大破线两头接上
 */
const CORNER_STARTS = [0, 0.25, 0.5, 0.6] as const

export type ScarCorner = 'lt' | 'lb' | 'rt' | 'rb'
export const SCAR_CORNERS: readonly ScarCorner[] = ['lt', 'lb', 'rt', 'rb']

interface CornerGeometry {
  readonly corner: ScarCorner
  /** 碎角的顶点（角点在第一个），按 scale 绕角点长大 */
  readonly chip: GlassPolygon
  readonly origin: GlassPoint
  /** 从碎角沿端边走向同侧另一个角的主裂（两头在 meet 接上） */
  readonly main: GlassPolyline
  /** 往行内伸的两道支裂（先浅后深） */
  readonly branches: readonly [GlassPolyline, GlassPolyline]
}

interface SideGeometry {
  readonly side: 'l' | 'r'
  /** 两头接上之后，断线与端边之间那块碎板的折光面 */
  readonly facet: GlassPolygon
  /** 碎板里的两道小裂（接上之后才有） */
  readonly shards: readonly GlassPolyline[]
}

export interface ScarGeometry {
  readonly width: number
  readonly height: number
  /** 按亮起先后排好的四个角 */
  readonly order: readonly ScarCorner[]
  readonly corners: Readonly<Record<ScarCorner, CornerGeometry>>
  readonly sides: readonly [SideGeometry, SideGeometry]
}

const r1 = (n: number): number => Math.round(n * 10) / 10
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))

/** 一次算完一轮带伤的四角碎裂顶点（与伤势无关） */
export const scarGeometry = (shipId: number, seedKey: number, width: number, height: number): ScarGeometry => {
  const rng = mulberry32(hashSeed(shipId * 7 + 3, seedKey))
  const W = Math.max(120, Math.round(width))
  const H = Math.max(24, Math.round(height))
  const rand = (lo: number, hi: number) => lo + rng() * (hi - lo)
  // 亮起先后：先右端（左端压着头像与左缘色条，轻伤画在那边看不见），再左端，左右交替；上下角按种子挑
  const firstRight: ScarCorner = rng() < 0.5 ? 'rt' : 'rb'
  const firstLeft: ScarCorner = rng() < 0.5 ? 'lt' : 'lb'
  const order: ScarCorner[] = [firstRight, firstLeft, firstRight === 'rt' ? 'rb' : 'rt', firstLeft === 'lt' ? 'lb' : 'lt']
  const corners = {} as Record<ScarCorner, CornerGeometry>
  const sides: SideGeometry[] = []
  for (const side of ['l', 'r'] as const) {
    // 先在左端的坐标里算（x 从端边往里量），右端整体镜像
    const mx = (x: number) => (side === 'l' ? r1(x) : r1(W - x))
    const meetY = H * rand(0.4, 0.6)
    const meetX = rand(7, 15)
    const topX = rand(12, 24)
    const botX = rand(12, 24)
    const k1: GlassPoint = [rand(15, 28), meetY * rand(0.4, 0.62)]
    const k2: GlassPoint = [rand(15, 28), meetY + (H - meetY) * rand(0.38, 0.6)]
    const build = (top: boolean): CornerGeometry => {
      const y = (v: number) => r1(top ? v : H - v)
      const edgeX = top ? topX : botX
      const kink = top ? k1 : ([k2[0], H - k2[1]] as GlassPoint)
      const meet: GlassPoint = [meetX, top ? meetY : H - meetY]
      const chipW = rand(20, 34)
      const chipH = H * rand(0.24, 0.36)
      const chip: GlassPolygon = [
        [mx(0), y(0)],
        [mx(chipW), y(0)],
        [mx(chipW * rand(0.5, 0.66)), y(chipH * rand(0.36, 0.52))],
        [mx(chipW * rand(0.22, 0.34)), y(chipH * rand(0.62, 0.8))],
        [mx(0), y(chipH)],
      ]
      // 主裂从碎角的内缘出发，经折点走到会合点
      const main: GlassPolyline = [
        [mx(Math.min(edgeX, chipW * 0.6)), y(Math.max(1, chipH * 0.45))],
        [mx(kink[0]), y(kink[1])],
        [mx(meet[0]), y(meet[1])],
      ]
      // 两道支裂都是陡峭的斜裂（40°～75°，带一个折点），不沿上下缘平拉——那会像横穿装备格的电线
      // （11-26 他嫌过「横向电线感」）。支裂一从碎角内缘往行里斜扎；支裂二在碎角外侧从边缘起裂
      const steep = (x0: number, y0: number, len: number): GlassPolyline => {
        const ang = (rand(40, 75) * Math.PI) / 180
        const x1 = x0 + Math.cos(ang) * len
        const y1 = y0 + Math.sin(ang) * len
        const kx = (x0 + x1) / 2 + rand(-2.5, 2.5)
        const ky = (y0 + y1) / 2 + rand(-2, 2)
        return [
          [mx(x0), y(y0)],
          [mx(kx), y(ky)],
          [mx(x1), y(Math.min(H * 0.82, y1))],
        ]
      }
      const b1 = steep(chipW * 0.62, chipH * 0.42, H * rand(0.42, 0.7))
      const b2 = steep(chipW + rand(8, 22), 0, H * rand(0.28, 0.48))
      const corner = `${side}${top ? 't' : 'b'}` as ScarCorner
      return { corner, chip, origin: [mx(0), y(0)], main, branches: [b1, b2] }
    }
    const t = build(true)
    const b = build(false)
    corners[t.corner] = t
    corners[b.corner] = b
    const facet: GlassPolygon = [
      [mx(0), 0],
      [mx(topX), 0],
      [mx(k1[0]), r1(k1[1])],
      [mx(meetX), r1(meetY)],
      [mx(k2[0]), r1(k2[1])],
      [mx(botX), H],
      [mx(0), H],
    ]
    const shards: GlassPolyline[] = [
      [
        [mx(meetX), r1(meetY)],
        [mx(rand(2, 5)), r1(meetY + rand(-10, -4))],
      ],
      [
        [mx(k2[0]), r1(k2[1])],
        [mx(rand(1, 4)), r1(k2[1] + rand(2, 7))],
      ],
    ]
    sides.push({ side, facet, shards })
  }
  return { width: W, height: H, order, corners, sides: sides as [SideGeometry, SideGeometry] }
}

/** 一个角一亮起就先崩掉的那一块（之后随伤势继续长）：刚亮起的角就得看得清，不能只有几个像素 */
const CORNER_ONSET = 0.45

/** 四个角各长到哪（0..1）：按亮起先后各有起点，一亮起先崩一小块，缺失血量到大破线时全部长满 */
export const scarExtents = (geometry: Pick<ScarGeometry, 'order'>, loss: number): Record<ScarCorner, number> => {
  const out = { lt: 0, lb: 0, rt: 0, rb: 0 } as Record<ScarCorner, number>
  if (!(loss > 0)) return out
  geometry.order.forEach((corner, i) => {
    const start = CORNER_STARTS[i]
    if (i > 0 && loss < start) return
    out[corner] = CORNER_ONSET + (1 - CORNER_ONSET) * clamp01((loss - start) / (SCAR_FULL_LOSS - start))
  })
  return out
}

/** 一个角长到 e 时各部分画出多少（主裂、两道支裂按先后接力；碎角稍晚才崩出来） */
export const scarParts = (e: number) => ({
  main: clamp01(e),
  branch1: clamp01((e - 0.15) / 0.5),
  branch2: clamp01((e - 0.4) / 0.45),
  chip: clamp01(e / 0.9),
})

/** 两头接上之后碎板的显形程度 */
export const scarMerge = (topE: number, botE: number): number => clamp01((Math.min(topE, botE) - 0.86) / 0.14)

export interface ScarSvgInput {
  /** 同一页里唯一的前缀（取舰 id），用来给 mask 起名 */
  readonly id: number | string
  readonly shipId: number
  readonly seedKey: number
  readonly zones: RowZones
  /** 历史缺失血量（0..1）；入渠时由调用方乘上（1 − 维修进度） */
  readonly loss: number
}

const pathOf = (pts: GlassPolyline): string => pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' ')
const pointsOf = (poly: GlassPolygon): string => poly.map(([x, y]) => `${x},${y}`).join(' ')

/**
 * 四角碎裂层：内容列下方压到约四成浓度（比弹孔的三成略显，旧伤要看得出来但不抢数据）。
 * 裂纹 pathLength=100、按长到多少给 dashoffset；碎角绕角点缩放。每条都带 data-scar 标记，
 * 返港转化时按旧伤与新伤各自的长度做一次延伸动画（见 ru.ts）。没有伤返回空串。
 */
export const hitScarSvg = ({ id, shipId, seedKey, zones, loss }: ScarSvgInput): string => {
  if (!(loss > 0.004)) return ''
  const geo = scarGeometry(shipId, seedKey, zones.width, zones.height)
  const ext = scarExtents(geo, loss)
  const W = geo.width
  const H = geo.height
  const maskId = `scar-safe-${id}`
  let facets = ''
  let cracks = ''
  let chips = ''
  for (const side of geo.sides) {
    const merge = scarMerge(ext[`${side.side}t` as ScarCorner], ext[`${side.side}b` as ScarCorner])
    if (merge > 0.01) {
      facets += `<polygon class="scar-facet" data-scar="${side.side}:facet" points="${pointsOf(side.facet)}" style="fill:var(--hit-glass-frost)" opacity="${(merge * 0.7).toFixed(2)}"/>`
      for (const [i, shard] of side.shards.entries()) {
        cracks += `<path class="scar-crack" data-scar="${side.side}:shard${i}" pathLength="100" d="${pathOf(shard)}" fill="none" style="stroke:var(--hit-scar)" stroke-width=".6" stroke-dasharray="100 100" stroke-dashoffset="${(100 * (1 - merge)).toFixed(1)}"/>`
      }
    }
  }
  for (const corner of SCAR_CORNERS) {
    const e = ext[corner]
    if (e <= 0.001) continue
    const g = geo.corners[corner]
    const parts = scarParts(e)
    const line = (key: string, pts: GlassPolyline, drawn: number, sw: number, op: number) => {
      if (drawn <= 0.001) return ''
      const d = pathOf(pts)
      const off = (100 * (1 - drawn)).toFixed(1)
      return `<path class="scar-crack" data-scar="${corner}:${key}:dark" pathLength="100" d="${d}" fill="none" style="stroke:var(--hit-glass-dark)" stroke-width="${(sw + 0.35).toFixed(2)}" stroke-dasharray="100 100" stroke-dashoffset="${off}" opacity=".3" transform="translate(.5,.5)"/><path class="scar-crack" data-scar="${corner}:${key}" pathLength="100" d="${d}" fill="none" style="stroke:var(--hit-scar)" stroke-width="${sw}" stroke-dasharray="100 100" stroke-dashoffset="${off}" opacity="${op}"/>`
    }
    cracks += line('main', g.main, parts.main, 1, 0.92)
    cracks += line('b1', g.branches[0], parts.branch1, 0.75, 0.74)
    cracks += line('b2', g.branches[1], parts.branch2, 0.65, 0.62)
    if (parts.chip > 0.01) {
      const [ox, oy] = g.origin
      const s = parts.chip.toFixed(3)
      const tf = parts.chip >= 0.999 ? '' : ` transform="translate(${ox} ${oy}) scale(${s}) translate(${-ox} ${-oy})"`
      const pts = pointsOf(g.chip)
      chips += `<g class="scar-chip" data-scar="${corner}:chip" data-ox="${ox}" data-oy="${oy}"${tf}><polygon points="${pts}" style="fill:var(--hit-glass-void)" opacity=".86"/><polygon points="${pts}" fill="none" style="stroke:var(--hit-scar-rim)" stroke-width=".85" opacity=".8"/></g>`
    }
  }
  if (!facets && !cracks && !chips) return ''
  const maskRects = zones.avoid
    .map((a) => `<rect x="${Math.max(0, a.x0)}" y="${Math.max(0, a.y0)}" width="${Math.max(4, a.x1 - a.x0)}" height="${Math.max(4, a.y1 - a.y0)}" rx="4" fill="rgb(102,102,102)"/>`)
    .join('')
  return `<svg class="scar-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:${W}px"><defs><mask id="${maskId}"><rect x="0" y="0" width="${W}" height="${H}" fill="white"/>${maskRects}</mask></defs><g mask="url(#${maskId})">${facets}${cracks}${chips}</g></svg>`
}

// ---- 锈渍：积水抽干后留在原来水线附近 ----

export interface RustSvgInput {
  readonly shipId: number
  readonly seedKey: number
  readonly width: number
  readonly height: number
  /** 留下锈渍的那条水线（行高的百分比，取历次积水的最高液面） */
  readonly level: number
  /** 浓淡 0..1：入渠除锈时随进度变淡 */
  readonly strength: number
}

/**
 * 旧水线上一道深浅不一、断断续续的锈痕（潮线），贴着它的一串碎锈点，几道往下淌的锈迹，水线下一层往下渐淡的锈色。
 * 全部按 (舰, 种子) 确定性生成，水线越高（积过的水越多）锈点与锈迹越多。没有锈返回空串。
 */
export const hitRustSvg = ({ shipId, seedKey, width, height, level, strength }: RustSvgInput): string => {
  if (!(level > 0.4) || !(strength > 0.02)) return ''
  const W = Math.max(120, Math.round(width))
  const H = Math.max(24, Math.round(height))
  const rng = mulberry32(hashSeed(shipId * 11 + 5, seedKey))
  const lineY = r1(H * (1 - level / 100))
  const heavy = clamp01(level / 52)
  // 潮线：一段段长短不一的折线，粗细与浓淡各不同，中间留缺口
  let tide = ''
  for (let x = rng() * 18; x < W; ) {
    const len = 22 + rng() * 90
    const pts: string[] = []
    for (let t = 0; t <= len; t += 7 + rng() * 6) pts.push(`${r1(x + t)},${r1(lineY + (rng() * 2 - 1) * 1.1)}`)
    tide += `<polyline points="${pts.join(' ')}" fill="none" style="stroke:var(${rng() < 0.45 ? '--hit-rust-deep' : '--hit-rust'})" stroke-width="${(0.8 + rng() * 1.1).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" opacity="${(0.4 + rng() * 0.35).toFixed(2)}"/>`
    x += len + 6 + rng() * 34
  }
  // 碎锈点：小、扁、成簇，多数在潮线下方一点
  let specks = ''
  const speckCount = Math.round(18 + heavy * 26)
  for (let i = 0; i < speckCount; i++) {
    const x = r1(rng() * W)
    const y = r1(lineY - 1 + rng() * 4.5)
    specks += `<ellipse cx="${x}" cy="${y}" rx="${r1(0.7 + rng() * 3.2)}" ry="${r1(0.5 + rng() * 1.1)}" style="fill:var(${rng() < 0.5 ? '--hit-rust-deep' : '--hit-rust'})" opacity="${(0.35 + rng() * 0.4).toFixed(2)}"/>`
  }
  // 淌下的锈迹：上粗下细、略歪
  let streaks = ''
  const drips = Math.round(4 + heavy * 6)
  for (let i = 0; i < drips; i++) {
    const x = r1(W * ((i + 0.15 + rng() * 0.7) / drips))
    const len = 3 + rng() * 10
    const x1 = r1(x + (rng() * 2 - 1) * 1.4)
    const y1 = r1(Math.min(H - 1, lineY + len))
    streaks += `<path d="M${x} ${r1(lineY + 0.5)}L${x1} ${y1}" fill="none" style="stroke:var(--hit-rust-deep)" stroke-width="${(1 + rng() * 0.9).toFixed(2)}" stroke-linecap="round" opacity="${(0.28 + rng() * 0.3).toFixed(2)}"/><path d="M${x1} ${y1}L${r1(x1 + (rng() * 2 - 1))} ${r1(Math.min(H - 1, y1 + 2 + rng() * 4))}" fill="none" style="stroke:var(--hit-rust)" stroke-width=".6" stroke-linecap="round" opacity=".3"/>`
  }
  // 水线下渐淡的锈色：几条越往下越淡的横带
  let tint = ''
  for (let i = 0; i < 4; i++) {
    tint += `<rect x="0" y="${r1(lineY + i * 3)}" width="${W}" height="3" style="fill:var(--hit-rust)" opacity="${(0.11 - i * 0.025).toFixed(3)}"/>`
  }
  return `<svg class="rust-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:${W}px" opacity="${clamp01(strength).toFixed(2)}">${tint}${streaks}${tide}${specks}</svg>`
}
