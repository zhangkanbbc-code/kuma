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
  dock: {
    sweep: 760, // 水青扫波冲刷整行
    flash: 640,
    washAt: 120, // 旧缺角与裂纹在扫波经过时洗净
    wash: 600,
    barAt: 120 + FX_BREATH * 2, // 扫波过半后血条再涨满
    rise: 680,
    popAt: 120 + FX_BREATH * 2 + 680, // 涨满再报「入渠完成」
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
  /** 飘字（原 920） */
  pop: 1100,
  /** 光点（原 680 + 随机 0–320） */
  mote: 760,
  moteJitter: 360,
} as const

export type RepairFxKind = 'damecon' | 'goddess' | 'dock' | 'berth' | 'anchorage'

/** 修理演出整段播完的时长：重画期间续挂底色等属性到这一刻 */
export const repairFxTotal = (kind: RepairFxKind): number => {
  const tail = REPAIR_FX.pop
  switch (kind) {
    case 'damecon': return REPAIR_FX.damecon.popAt + tail
    case 'goddess': return REPAIR_FX.goddess.popAt + tail
    case 'dock': return REPAIR_FX.dock.popAt + tail
    default: return REPAIR_FX.berth.popAt + tail
  }
}
