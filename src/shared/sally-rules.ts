// 出击识别札的**出击限制表**（第一方小表，每期活动一次手录）。
//
// ## 这张表补的是哪个洞
//
// shared/sally-names 记「札号叫什么」，shared/sally-lock 记「现在查不查札」，
// 但「哪张图贴哪枚札、哪几枚进不去」这一层此前一格都没有——
// sally-lock 的头注写着「对照表看这里」，把玩家甩去 kcwiki 自己翻。
// 这张表就是把那份对照表的**图级**部分录进来。
//
// **只做资料展示，不做判断。** sally-lock 那条结论原封不动：
// 「这支队能不能进那张图」仍旧不是艦素能算的（札绑的是**阶段**不是图，
// 还要再按编成类型分，且有些阶段明确允许混札）。这里摆的是攻略表本身，
// 不是对某支具体舰队的裁决。
//
// ## 出处
//
// wikiwiki「反撃！第三十一戦隊の戦い」活动页主表（出撃識別札の付与 / 出撃制限表），
// 2026-08-26 逐格核对。中文名走 shared/sally-names（录自 kcwiki「2026年夏季活动」）。
//
// ## 通则（wikiwiki 原文）
//
// 「難易度に関係なく、各艦娘に初めて出撃した海域の札が付与されます。
//   丙・丁難度では札の制限を無視して出撃出来ますが、札の変更・削除は不可能です。」
// 即：札随首次出击贴上（丙丁也照贴）、贴上之后不能改也不能删。
// 支援舰队不贴札、也不受限。
//
// ## 刻意没录的两件事
//
// - **段级明细**（同一张图 P1/P2… 各贴哪一枚）：在 wiki 各海域分页上，本表只录图级。
//   sally-lock 头注举过例——E-2 里 P1 解谜/P1 绿条/P2 血条各要一枚，
//   图级 grants 是这几枚的并集。要做段级得另开一批。
// - **「通关后限制解除」**：kcwiki 单源，没有第二票，不进数据。
//   它本来也不必建模——游戏在 mapinfo 里逐图下发 api_limit_flag，
//   通关与低难度两种解除都落在那个字段上（判据见 shared/sally-lock）。

import { EVENT_DIFFICULTIES } from './map-intel'

import type { EventDifficulty } from './map-intel'

export interface SallyMapRule {
  /** 活动区 id（api_maparea_id） */
  area: number
  /** 图号：E-N 的 N */
  mapNo: number
  /**
   * 出击即贴的札（全难度通贴，丙丁也贴）。值是 api_sally_area 号，
   * 名字查 shared/sally-names。
   */
  grants: number[]
  /**
   * 禁止入场的札，按难度分。没有这一档 = 那个难度不查札。
   * 丙丁一律不列（通则：丙丁无视札的限制）。
   */
  bannedByDifficulty: Partial<Record<EventDifficulty, number[]>>
  /**
   * wiki 上写着、但**上游自己没确认是哪一枚**的禁入项，原文照录。
   *
   * 单独一格是刻意的：混进 `bannedByDifficulty` 就等于替上游把它认成了某一枚札，
   * 而它现在连是不是札都没写死。展示层照原文摆一枚灰 chip，不猜。
   */
  unconfirmed?: string[]
}

// 62 区五张图的出撃識別札。5 与 6 两枚在下面每一行里都是**同进同出**
// （grants 一起给、banned 一起禁），所以即便这两号的序次将来被推翻，
// 这张表算出来的 chip 集合一个字都不会变。
export const SALLY_MAP_RULES: readonly SallyMapRule[] = [
  // ── 62 区「反撃！第三十一戦隊の戦い」(2026 年夏) ──
  {
    area: 62,
    mapNo: 1,
    grants: [1, 2],
    bannedByDifficulty: { 甲: [3, 4, 5, 6, 7, 8], 乙: [3, 4, 5, 6, 7, 8] },
  },
  {
    area: 62,
    mapNo: 2,
    grants: [1, 3, 4],
    bannedByDifficulty: { 甲: [5, 6, 7, 8], 乙: [5, 6, 7, 8] },
  },
  {
    area: 62,
    mapNo: 3,
    grants: [2, 5, 6],
    bannedByDifficulty: { 甲: [3, 4, 7, 8], 乙: [3, 4, 7, 8] },
  },
  {
    area: 62,
    mapNo: 4,
    grants: [7, 8],
    bannedByDifficulty: { 甲: [1, 2, 3, 4, 5, 6], 乙: [1, 2, 3, 4, 5, 6] },
    // wiki 主表在这一格的禁入名单末尾多写了一项「??作戦」——上游自己没写明是哪一枚。
    // 照源保留，不猜。
    unconfirmed: ['??作戦'],
  },
  {
    // E-5 是特例：只有甲难度查札，**乙也放开**（其余各图是甲乙都查）。
    area: 62,
    mapNo: 5,
    grants: [9, 10, 11, 12, 13],
    bannedByDifficulty: { 甲: [1, 2, 3, 4, 5, 6, 7, 8] },
  },
]

const KEY = (area: number, mapNo: number) => `${area}-${mapNo}`
const BY_KEY = new Map(SALLY_MAP_RULES.map((rule) => [KEY(rule.area, rule.mapNo), rule]))

/** 查不到就返回 null——调用方整段不渲染，别在这里编规则 */
export const sallyMapRuleOf = (
  area: number | null | undefined,
  mapNo: number | null | undefined,
): SallyMapRule | null => {
  if (!Number.isFinite(area) || !Number.isFinite(mapNo)) return null
  return BY_KEY.get(KEY(Number(area), Number(mapNo))) ?? null
}

/** 通则一句话，挂在段标题的悬停上。wikiwiki 原文的中文转述，逐字固定。 */
export const SALLY_RULE_GENERAL_NOTE = '札随首次出击贴上，丙丁也贴，之后不能换不能摘'

/** 甲乙两档都查札时的尾注 */
export const SALLY_RULE_FOOTNOTE_CD = '丙丁不受限 · 支援舰队不贴札'
/** 只有甲档查札时的尾注（62-5） */
export const SALLY_RULE_FOOTNOTE_B = '乙以下不受限 · 支援舰队不贴札'

export interface SallyRuleView {
  /** 出击即贴的札号 */
  grants: number[]
  /** 禁入的札号 */
  banned: number[]
  /** 禁入名单的小标：「甲乙禁入」/「甲禁入」 */
  bannedLabel: string
  /** 查札的那几档难度，甲乙丙丁序 */
  restricted: EventDifficulty[]
  /** 上游未确认的禁入项，原文 */
  unconfirmed: string[]
  /** 尾注 */
  footnote: string
}

/**
 * 把一张图的札规则摊成展示层直接能用的形状。
 *
 * 逻辑放在 shared 而不是渲染层，是为了这一段能被直接调用验证：
 * 只断言 du.ts 的源码文本里有「禁入」两个字，名单算反了它照样绿。
 */
export const sallyRuleView = (rule: SallyMapRule | null): SallyRuleView | null => {
  if (!rule) return null
  const restricted = EVENT_DIFFICULTIES.filter(
    (difficulty) => (rule.bannedByDifficulty[difficulty]?.length ?? 0) > 0,
  )
  return {
    grants: [...rule.grants],
    // 查札的各档名单本表内是同一份（护栏钉着这一条），取第一档即可
    banned: [...(restricted.length ? (rule.bannedByDifficulty[restricted[0]] ?? []) : [])],
    bannedLabel: `${restricted.join('')}禁入`,
    restricted: [...restricted],
    unconfirmed: [...(rule.unconfirmed ?? [])],
    // 甲乙都锁 → 丙丁两档放开；只锁甲（62-5 特例）→ 乙以下全放开
    footnote: restricted.includes('乙') ? SALLY_RULE_FOOTNOTE_CD : SALLY_RULE_FOOTNOTE_B,
  }
}
