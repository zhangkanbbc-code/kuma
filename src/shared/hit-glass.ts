// 单调缺角玻璃碎裂几何（实验性，维护者裁决 2026-11-26）：
// 按 (shipId, seedKey, width, height) 在分档之前一次性算出全部像素顶点，
// 小破 → 中破 → 大破 → 击沉只解锁既有路径与缺口，跨档绝不重算跳位。
// 纯逻辑层，无 DOM/Electron 依赖，供锐编队面板与单元测试共用。

export type HitGlassTier = 'light' | 'medium' | 'heavy' | 'sunk'
export type HitGlassArch = 0 | 1 | 2 | 3
export type GlassPoint = readonly [number, number]
export type GlassPolygon = readonly GlassPoint[]
export type GlassPolyline = readonly GlassPoint[]

export interface HitGlassGeometry {
  readonly arch: HitGlassArch
  readonly width: number
  readonly height: number
  readonly topSide: boolean
  readonly shardOrigin: string
  readonly extraOrigin: string
  readonly fcTilt: number
  readonly fcSunkTilt: number
  readonly fcClipMid: string
  readonly fcClipHeavy: string
  readonly fcClipSunk: string
  readonly gDur: number
  readonly gDelay: number
  readonly lineA: GlassPolyline
  readonly lineB: GlassPolyline
  readonly lineC: GlassPolyline
  readonly stubAB: GlassPolyline
  readonly cutA: GlassPolygon
  readonly cutB: GlassPolygon
  readonly cutC: GlassPolygon
  readonly shardA: GlassPolygon
  readonly shardB: GlassPolygon
  readonly shardC: GlassPolygon
  readonly midCracks: readonly GlassPolyline[]
  readonly midSubCracks: readonly GlassPolyline[]
  /** 中破的暗面：角缺构型是 A、B 之间那一圈；顶边 / 底边 V 构型没有（见 V 分支的维护者裁决） */
  readonly midFacets: readonly GlassPolygon[]
  readonly heavyCracks: readonly GlassPolyline[]
  readonly heavySubCracks: readonly GlassPolyline[]
  readonly sunkCracks: readonly GlassPolyline[]
  readonly sunkSubCracks: readonly GlassPolyline[]
  readonly heavyFacet: GlassPolygon
  readonly sunkFacet2: GlassPolygon
}

export interface HitGlassLayers {
  readonly cuts: readonly GlassPolygon[]
  readonly cracks: readonly GlassPolyline[]
  readonly subCracks: readonly GlassPolyline[]
  readonly bevels: readonly GlassPolyline[]
  readonly facets: readonly GlassPolygon[]
  readonly shard: GlassPolygon | null
  readonly extraShard: GlassPolygon | null
}

const hashSeed = (shipId: number, seedKey: number): number => {
  let h = (2166136261 ^ (shipId | 0)) >>> 0
  h = Math.imul(h, 16777619) >>> 0
  h = (h ^ ((seedKey * 2654435761) >>> 0)) >>> 0
  h = Math.imul(h, 16777619) >>> 0
  return h >>> 0
}

const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rand = (rng: () => number, min: number, max: number): number =>
  Math.round(min + rng() * (max - min))

const round1 = (n: number): number => Math.round(n * 10) / 10
const round2 = (n: number): number => Math.round(n * 100) / 100

/**
 * 一次算完一艘舰当前受伤周期的全部缺角与裂纹顶点（与档位无关）。
 * 四种冲击构型：0 右上角 / 1 右下角 / 2 顶缘 V 口 / 3 底缘 V 口。
 */
export const hitGlassGeometry = (
  shipId: number,
  seedKey: number,
  width: number,
  height: number,
): HitGlassGeometry => {
  const rng = mulberry32(hashSeed(shipId, seedKey))
  const W = Math.max(120, Math.round(width))
  const H = Math.max(24, Math.round(height))
  const hs = H / 48
  const sy = (v: number): number => Math.max(2, Math.round(v * hs))

  const arch = (((shipId | 0) + (seedKey | 0) + Math.floor(rng() * 2)) & 3) as HitGlassArch
  const gDur = round2(3.5 + rng() * 0.9)
  const gDelay = -round2(0.15 + rng() * (gDur - 0.3))
  const tiltSign = rng() < 0.65 ? -1 : 1
  const fcTilt = round1((2.0 + rng() * 1.1) * tiltSign)
  const fcSunkTilt = round1((7.2 + rng() * 2.8) * tiltSign)

  const kinkedLine = (x0: number, y0: number, x1: number, y1: number, jitter = 5) => {
    const mx = Math.round((x0 + x1) * 0.5 + (rng() * 2 - 1) * jitter)
    const my = Math.round((y0 + y1) * 0.5 + (rng() * 2 - 1) * (jitter * 0.6))
    return {
      pts: [
        [x0, y0],
        [mx, my],
        [x1, y1],
      ] as GlassPolyline,
      mx,
      my,
    }
  }

  const s1Top = Math.round(W * (0.44 + rng() * 0.10))
  const s1Bot = s1Top + rand(rng, -34, -14) * (rng() < 0.5 ? 1 : -1)
  const s1 = kinkedLine(s1Top, 0, s1Bot, H, 5)

  const s2Top = Math.round(W * (0.21 + rng() * 0.10))
  const s2Bot = s2Top + rand(rng, 14, 34) * (rng() < 0.5 ? 1 : -1)
  const s2 = kinkedLine(s2Top, 0, s2Bot, H, 5)

  const s1BranchX = s1.mx + rand(rng, 18, 36) * (s1Bot > s1Top ? -1 : 1)
  const s2BranchX = s2.mx + rand(rng, 16, 30) * (s2Bot > s2Top ? -1 : 1)

  const topSide = arch === 0 || arch === 2
  const yOf = (d: number): number => (topSide ? d : H - d)

  const fcClipMid = topSide
    ? 'polygon(0 0, 82% 0, 100% 24%, 100% 100%, 0 100%)'
    : 'polygon(0 0, 100% 0, 100% 76%, 82% 100%, 0 100%)'
  const fcClipHeavy = topSide
    ? 'polygon(0 0, 74% 0, 100% 34%, 100% 100%, 0 100%)'
    : 'polygon(0 0, 100% 0, 100% 66%, 74% 100%, 0 100%)'
  const fcClipSunk = topSide
    ? 'polygon(0 0, 74% 0, 100% 34%, 100% 66%, 68% 100%, 0 100%)'
    : 'polygon(0 0, 68% 0, 100% 34%, 100% 66%, 74% 100%, 0 100%)'

  const sunkFacet2: GlassPolygon = [
    [s2Top, 0],
    [s1Top, 0],
    [s1.mx, s1.my],
    [s1Bot, H],
    [s2Bot, H],
    [s2.mx, s2.my],
  ]

  if (arch === 0 || arch === 1) {
    const aTop = rand(rng, 12, 17)
    const aSide = sy(rand(rng, 11, 15))
    const aKx = Math.round(aTop * 0.52)
    const aKy = Math.round(aSide * 0.48)
    const bTop = aTop + rand(rng, 12, 16)
    const bSide = Math.min(H - 6, aSide + sy(rand(rng, 10, 14)))
    const bKx = Math.round(bTop * 0.48)
    const bKy = Math.round(bSide * 0.52)

    const r1End = W - bTop - rand(rng, 22, 42)
    const r2End = W - bTop - rand(rng, 58, 92)
    const rad1 = kinkedLine(W - bKx, yOf(bKy), r1End, yOf(H), 4)
    const rad2 = kinkedLine(W - bTop, yOf(0), r2End, yOf(H), 5)
    const cTop = rand(rng, 15, 22)
    const cSide = Math.min(Math.max(4, H - bSide - 2), sy(rand(rng, 12, 16)))

    const lineA: GlassPolyline = [
      [W - aTop, yOf(0)],
      [W - aKx, yOf(aKy)],
      [W, yOf(aSide)],
    ]
    const lineB: GlassPolyline = [
      [W - bTop, yOf(0)],
      [W - bKx, yOf(bKy)],
      [W, yOf(bSide)],
    ]
    const lineC: GlassPolyline = [
      [W, yOf(H - cSide)],
      [W - cTop, yOf(H)],
    ]
    const stubAB: GlassPolyline = [
      [W - aKx, yOf(aKy)],
      [W - bKx, yOf(bKy)],
    ]
    const cutA: GlassPolygon = [
      [W - aTop, yOf(0)],
      [W, yOf(0)],
      [W, yOf(aSide)],
      [W - aKx, yOf(aKy)],
    ]
    const cutB: GlassPolygon = [
      [W - bTop, yOf(0)],
      [W, yOf(0)],
      [W, yOf(bSide)],
      [W - bKx, yOf(bKy)],
    ]
    const cutC: GlassPolygon = [
      [W, yOf(H - cSide)],
      [W, yOf(H)],
      [W - cTop, yOf(H)],
    ]
    const shardB: GlassPolygon = [
      [W - bTop, yOf(0)],
      [W - aTop, yOf(0)],
      [W - aKx, yOf(aKy)],
      [W, yOf(aSide)],
      [W, yOf(bSide)],
      [W - bKx, yOf(bKy)],
    ]
    const heavyFacet: GlassPolygon = [
      [W - bTop, yOf(0)],
      [W - bKx, yOf(bKy)],
      [rad1.mx, rad1.my],
      [r1End, yOf(H)],
      [r2End, yOf(H)],
      [rad2.mx, rad2.my],
    ]
    const radBridge: GlassPolyline = [
      [rad1.mx, rad1.my],
      [rad2.mx, rad2.my],
    ]

    return {
      arch,
      width: W,
      height: H,
      topSide,
      shardOrigin: topSide ? '96% 18%' : '96% 82%',
      extraOrigin: topSide ? '96% 82%' : '96% 18%',
      fcTilt,
      fcSunkTilt,
      fcClipMid,
      fcClipHeavy,
      fcClipSunk,
      gDur,
      gDelay,
      lineA,
      lineB,
      lineC,
      stubAB,
      cutA,
      cutB,
      cutC,
      shardA: cutA,
      shardB,
      shardC: cutC,
      midCracks: [lineB, [[W - bKx, yOf(bKy)], [rad1.mx, rad1.my]]],
      midSubCracks: [stubAB],
      midFacets: [shardB],
      heavyCracks: [rad1.pts, rad2.pts, s1.pts],
      heavySubCracks: [lineC, radBridge],
      sunkCracks: [rad1.pts, rad2.pts, s1.pts, s2.pts],
      sunkSubCracks: [
        radBridge,
        [[s1.mx, s1.my], [s1BranchX, yOf(0)]],
        [[s2.mx, s2.my], [s2BranchX, yOf(H)]],
      ],
      heavyFacet,
      sunkFacet2,
    }
  }

  // arch 2 (top V) / arch 3 (bottom V)
  const impX = Math.round(W * (0.60 + rng() * 0.16))
  const impPct = Math.round((impX / W) * 100)
  const aL = rand(rng, 10, 14)
  const aR = rand(rng, 10, 15)
  const aD = sy(rand(rng, 7, 10))
  const bL = aL + rand(rng, 9, 13)
  const bR = aR + rand(rng, 10, 14)
  const bD = Math.min(Math.round(H * 0.45), aD + sy(rand(rng, 7, 10)))

  const vLEnd = impX - bL - rand(rng, 18, 34)
  const vREnd = Math.min(W - 6, impX + bR + rand(rng, 18, 36))
  const vL = kinkedLine(impX - 2, yOf(bD), vLEnd, yOf(H), 4)
  const vR = kinkedLine(impX + 2, yOf(bD), vREnd, yOf(H), 4)
  const cTop = rand(rng, 16, 22)
  const cSide = Math.min(Math.round(H * 0.42), sy(rand(rng, 13, 17)))

  const lineA: GlassPolyline = [
    [impX - aL, yOf(0)],
    [impX, yOf(aD)],
    [impX + aR, yOf(0)],
  ]
  const lineB: GlassPolyline = [
    [impX - bL, yOf(0)],
    [impX, yOf(bD)],
    [impX + bR, yOf(0)],
  ]
  const lineC: GlassPolyline = [
    [W, yOf(H - cSide)],
    [W - cTop, yOf(H)],
  ]
  const stubAB: GlassPolyline = [
    [impX, yOf(aD)],
    [impX, yOf(bD)],
  ]
  const cutA: GlassPolygon = [
    [impX - aL, yOf(0)],
    [impX + aR, yOf(0)],
    [impX, yOf(aD)],
  ]
  const cutB: GlassPolygon = [
    [impX - bL, yOf(0)],
    [impX + bR, yOf(0)],
    [impX, yOf(bD)],
  ]
  const cutC: GlassPolygon = [
    [W, yOf(H - cSide)],
    [W, yOf(H)],
    [W - cTop, yOf(H)],
  ]
  const shardB: GlassPolygon = [
    [impX - bL, yOf(0)],
    [impX - aL, yOf(0)],
    [impX, yOf(aD)],
    [impX + aR, yOf(0)],
    [impX + bR, yOf(0)],
    [impX, yOf(bD)],
  ]
  const heavyFacet: GlassPolygon = [
    [impX, yOf(bD)],
    [vL.mx, vL.my],
    [vLEnd, yOf(H)],
    [vREnd, yOf(H)],
    [vR.mx, vR.my],
  ]
  const vBridge: GlassPolyline = [
    [vL.mx, vL.my],
    [vR.mx, vR.my],
  ]

  return {
    arch,
    width: W,
    height: H,
    topSide,
    shardOrigin: topSide ? `${impPct}% 12%` : `${impPct}% 88%`,
    extraOrigin: topSide ? '96% 84%' : '96% 16%',
    fcTilt,
    fcSunkTilt,
    fcClipMid,
    fcClipHeavy,
    fcClipSunk,
    gDur,
    gDelay,
    lineA,
    lineB,
    lineC,
    stubAB,
    cutA,
    cutB,
    cutC,
    shardA: cutA,
    shardB,
    shardC: cutC,
    // 维护者裁决 2026-11-26：中破不画外圈 B。交接包原稿的 B 与缺口 A 都是 V、彼此平行，读起来像「≫」双裂纹；
    // 改为两道裂纹从缺口尖端放射出去（方案三，审片页对比后定），也不画 A、B 之间的暗面。
    // 大破照旧沿 B 崩开，B 那圈在大破时才第一次出现。角缺构型（arch 0 / 1）不受影响。
    midCracks: [[[impX, yOf(aD)], [vL.mx, vL.my]]],
    midSubCracks: [[[impX, yOf(aD)], [vR.mx, vR.my]]],
    midFacets: [],
    heavyCracks: [vL.pts, vR.pts, s1.pts],
    heavySubCracks: [lineC, vBridge],
    sunkCracks: [vL.pts, vR.pts, s1.pts, s2.pts],
    sunkSubCracks: [
      vBridge,
      [[s1.mx, s1.my], [s1BranchX, yOf(0)]],
      [[s2.mx, s2.my], [s2BranchX, yOf(H)]],
    ],
    heavyFacet,
    sunkFacet2,
  }
}

export const hitGlassLayers = (geo: HitGlassGeometry, tier: HitGlassTier): HitGlassLayers => {
  if (tier === 'light') {
    return {
      cuts: [],
      cracks: [geo.lineA],
      subCracks: [geo.stubAB],
      bevels: [],
      facets: [],
      shard: null,
      extraShard: null,
    }
  }
  if (tier === 'medium') {
    return {
      cuts: [geo.cutA],
      cracks: geo.midCracks,
      subCracks: geo.midSubCracks,
      bevels: [geo.lineA],
      facets: geo.midFacets,
      shard: geo.shardA,
      extraShard: null,
    }
  }
  if (tier === 'heavy') {
    return {
      cuts: [geo.cutB],
      cracks: geo.heavyCracks,
      subCracks: geo.heavySubCracks,
      bevels: [geo.lineB],
      facets: [geo.heavyFacet],
      shard: geo.shardB,
      extraShard: null,
    }
  }
  return {
    cuts: [geo.cutB, geo.cutC],
    cracks: geo.sunkCracks,
    subCracks: geo.sunkSubCracks,
    bevels: [geo.lineB, geo.lineC],
    facets: [geo.heavyFacet, geo.sunkFacet2],
    shard: geo.shardC,
    extraShard: geo.shardB,
  }
}

/** 行上要挂的头像倾斜、头像裁角与大破故障错相变量（编队行 style 里用）。 */
export const hitGlassCssVars = (geo: HitGlassGeometry): string =>
  [
    `--fc-tilt:${geo.fcTilt}deg`,
    `--fc-sunk-tilt:${geo.fcSunkTilt}deg`,
    `--fc-clip-mid:${geo.fcClipMid}`,
    `--fc-clip-heavy:${geo.fcClipHeavy}`,
    `--fc-clip-sunk:${geo.fcClipSunk}`,
    `--g-dur:${geo.gDur}s`,
    `--g-delay:${geo.gDelay}s`,
  ].join(';')
