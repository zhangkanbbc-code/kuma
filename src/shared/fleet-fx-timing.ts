// 编队被弹动画与修理演出的节拍表（ms）。
//
// 2026-11-26 他要「略微拉长编队的变化动画，让每个步骤之间有呼吸的间隙而不是几乎一眨眼就完成」：
// 冲击那一下照旧干脆，之后的步骤错开，段与段之间留一口气（FX_BREATH）。
// - 被弹那几段走样式表，时刻由舰行上的 CSS 变量注入（ru.ts shipRow）；
// - 修理演出走 Web Animations，直接读 REPAIR_FX；
// - 整段要播多久也从这里算：锐在这段时间里重画时续挂同一份属性，输出不变就不换 DOM，
//   演出不再被「编队任务反查」那次重画拦腰截断（那是此前一眨眼就没的主因）。

/** 段与段之间的那口气 */
export const FX_BREATH = 160

/** 下标是被弹档 1–4（擦伤 / 小破线 / 中破线 / 大破线）；0 位不用 */
type BySeverity = readonly [0, number, number, number, number]

export const HIT_FX = {
  /** 冲击震动（样式表 ru-hit-shake-1..4，原值不动：冲击要干脆） */
  impact: [0, 190, 300, 420, 560] as BySeverity,
  /**
   * 扣血残影开始下降：震动的大幅摆动（前 40%，ru-hit-shake-3/4 关键帧 30%/38%）过后再停一口气，
   * 余颤与下降可以重叠。原先残影与震动同时起步、在自身 40% 处就开降。
   */
  drainAt: [0, 260, 340, 420, 500] as BySeverity,
  /** 残影下降时长（原 0.54 × 420/560/720/880 ≈ 230/300/390/475，拉长约一倍半） */
  drainDur: [0, 380, 460, 560, 680] as BySeverity,
  /** 残影降到底后淡掉 */
  ghostFade: 180,
  /** 跳字（原 760） */
  pop: 1000,
  /** 「中破 / 大破」盖章（原 240）：残影降完、再停一口气才盖下去 */
  stamp: 320,
  /** 跨进大破时的故障爆闪（样式表 ru-glitch-burst-bars / -text） */
  glitchBurst: 320,
  /** 崩飞碎角最长那条（击沉 620，中大破 480；与冲击同拍） */
  shard: 620,
} as const

/**
 * 战报驱动的被弹演出（交接包 v2，维护者 2026-11-27 定稿；数值照审片台）：
 * 反潜深弹先投后爆、鱼雷先切入水线再炸，扣血这一拍整体往后挪 lead；弹孔正向延展；崩飞碎片。
 */
export const HIT_REPORT_FX = {
  /** 反潜：声呐扫掠后第一颗深弹几时出手、相邻两颗隔多久、下坠多久；第 n 颗起爆＝detonate + (n-1)·step */
  aswDrop: { start: 55, step: 95, fall: 330, detonate: 390, ripple: 360, rippleAt: 90, bubblesAt: 110 },
  /** 起爆后的垂直水压浮沉 */
  heave: 480,
  /** 鱼雷：航迹从右切入水线的提前量、单条航迹时长、两条错开 */
  torpLead: 230,
  torpRun: 240,
  torpRunStep: 70,
  /** 鱼雷命中的倾侧（破口侧下沉后滞重晃荡落定） */
  list: 620,
  /** 弹孔正向延展：每个弹孔错开 holeStep；核心张开 → 裂纹飙开 → 环裂与折光接续 */
  spread: { holeStep: 75, core: 145, rayAt: 25, ray: 210, rayStep: 30, ringAt: 95, ring: 175, ringStep: 18, facetAt: 115, facet: 190 },
  /** 崩飞玻璃碎片：大块 / 小块时长，片与片错开 */
  shard: { large: 660, small: 540, step: 28, holeStep: 80 },
  /** 起爆 / 命中后的气泡与声呐环 */
  bubble: 680,
  bubbleJitter: 420,
  sonar: 560,
} as const

/** 反潜深弹第 dropCount 颗（最多 3 颗）起爆的时刻：扣血从这一刻起算 */
export const aswDetonateAt = (dropCount: number): number =>
  HIT_REPORT_FX.aswDrop.detonate + (Math.max(1, Math.min(3, dropCount)) - 1) * HIT_REPORT_FX.aswDrop.step

/** 一批新弹孔延展完要多久（最后一个弹孔的最后一笔） */
export const holeSpreadTotal = (holeCount: number): number => {
  if (holeCount <= 0) return 0
  const S = HIT_REPORT_FX.spread
  return (holeCount - 1) * S.holeStep + Math.max(S.core, S.rayAt + S.ray + 2 * S.rayStep, S.ringAt + S.ring + 3 * S.ringStep, S.facetAt + S.facet)
}

export const hitGhostAt = (severity: 1 | 2 | 3 | 4): number => HIT_FX.drainAt[severity]
export const hitGhostDur = (severity: 1 | 2 | 3 | 4): number => HIT_FX.drainDur[severity] + HIT_FX.ghostFade
export const hitStampAt = (severity: 1 | 2 | 3 | 4): number =>
  HIT_FX.drainAt[severity] + HIT_FX.drainDur[severity] + FX_BREATH

/** 被弹演出整段播完的时长：重画期间续挂被弹属性到这一刻 */
export const hitFxTotal = (severity: 1 | 2 | 3 | 4, crossedTier: boolean): number =>
  Math.max(
    HIT_FX.impact[severity],
    HIT_FX.pop,
    HIT_FX.shard,
    hitGhostAt(severity) + hitGhostDur(severity),
    crossedTier ? hitStampAt(severity) + Math.max(HIT_FX.stamp, HIT_FX.glitchBurst) : 0,
  )

/**
 * 修理演出各段的起点与时长。每种都是「冲击 / 起势 → 喘口气 → 修复光效与血条 → 飘字」。
 * 飘字与光点比血条晚一口气出现，等血条涨起来再报结果。
 */
export const REPAIR_FX = {
  damecon: {
    impact: 260, // 濒沉震颤 + 红闪
    dipEnd: 220, // 血条探底
    weldAt: 260 + FX_BREATH, // 琥珀焊光横扫、血条弹回
    rise: 700,
    weldFlash: 620,
    weldSweep: 560,
    popAt: 260 + FX_BREATH * 2,
  },
  goddess: {
    impact: 230,
    dipEnd: 210,
    reviveAt: 230 + FX_BREATH, // 圣金光晕截断击沉：碎角嵌回、血条与油弹拉满
    rise: 720,
    shardReturn: 620,
    goldFadeDelay: 220, // 旧裂纹转圣金后再淡掉
    goldFade: 720,
    flash: 900,
    sweep: 860,
    popAt: 230 + FX_BREATH * 2,
  },
  berth: {
    flagFlash: 480, // 工作舰微闪
    iconPulse: 420, // 修理设施图标逐个微亮
    iconStep: 70,
    beadAt: FX_BREATH, // 光珠沿连接线落下
    bead: 560,
    barAt: FX_BREATH + 340, // 光珠落到行上时血条上涨
    rise: 640,
    sweep: 700,
    crackHeal: 560,
    popAt: FX_BREATH + 340 + 480,
  },
  /**
   * 四套特色出渠（交接包 v2，数值照审片台）：残余裂纹精确逆向收口（外环折光先收 → 裂纹从尖端缩回 → 破口闭合），
   * 积水排空，按伤势种类各自的光效，血条滞后涨满。高速修复桶整体快一截（逆向收口 ×0.72）。
   */
  dockOut: {
    reverse: { ringAt: 20, ring: 190, rayAt: 70, ray: 360, voidAt: 280, void: 260, total: 580 },
    bucketScale: 0.72,
    drainAt: 60,
    drain: 760,
    bucketDrain: 460,
    barAt: 280,
    rise: 660,
    bucketBarAt: 120,
    bucketRise: 480,
    shell: { sweep: 760, flash: 620, bubblesAt: 220, popAt: 660 },
    torp: { sweep: 780, bubblesAt: 100, popAt: 680 },
    sub: { flash: 720, ringAt: 80, ring2At: 240, bubblesAt: 40, popAt: 640 },
    bucket: { sweep: 560, bubblesAt: 30, popAt: 420 },
  },
  /** 飘字（原 920） */
  pop: 1100,
  /** 光点（原 680 + 随机 0–320） */
  mote: 760,
  moteJitter: 360,
} as const

export type RepairFxKind = 'damecon' | 'goddess' | 'dock' | 'berth' | 'anchorage'
export type DockOutStyle = 'shell' | 'torp' | 'sub' | 'bucket'

/** 修理演出整段播完的时长：重画期间续挂底色等属性到这一刻。出渠按四套特色各自的飘字时刻算 */
/**
 * 返港转化（维护者 2026-11-28 定）：这一趟的弹孔逐个收口 → 四角碎裂从旧伤长到新伤；
 * 积水液面降下去、倾侧扶正 → 原来的水线留下锈渍。两路同时起，碎裂与锈渍各晚半拍，整段约 1.7s。
 * 弹孔收口的分段照出渠的逆向收口（dockOut.reverse）。
 */
export const RETURN_FX = {
  scarAt: 360,
  scar: 1100,
  drainAt: 140,
  drain: 1050,
  rightAt: 140,
  right: 900,
  rustAt: 760,
  rust: 900,
  total: 1660,
} as const

export const repairFxTotal = (kind: RepairFxKind, dockStyle?: DockOutStyle): number => {
  const tail = REPAIR_FX.pop
  switch (kind) {
    case 'damecon': return REPAIR_FX.damecon.popAt + tail
    case 'goddess': return REPAIR_FX.goddess.popAt + tail
    case 'dock': {
      const O = REPAIR_FX.dockOut
      const style = dockStyle ?? 'shell'
      const bucket = style === 'bucket'
      const bar = bucket ? O.bucketBarAt + O.bucketRise : O.barAt + O.rise
      return Math.max(O[style].popAt + tail, bar, O.drainAt + (bucket ? O.bucketDrain : O.drain))
    }
    default: return REPAIR_FX.berth.popAt + tail
  }
}
