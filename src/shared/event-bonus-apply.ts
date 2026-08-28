// 活动特效倍卡的施加。
//
// 解析在 scripts/lib/event-bonus.mjs（维护期），这里只管**运行时怎么把倍率乘上去**。
//
// 页面原文的规则：「全图倍卡、点位倍卡、舰种倍卡与分组倍卡分别计算；
// 同一舰娘同时满足多个条件时，**各项补正叠乘**。」
//
// 三条容易写错的：
//   · 全图与点位是**两条独立的条目**，都命中就都乘（不是取大的那个）；
//   · 同一类别里同一 key 只算一次（同组不重复）；
//   · 倍卡**不分难度**——难度只影响解谜条件与资源基础值，已逐条核对过。
//
// 国籍那一类还有第四条：**先查例外台账，再落号段**。号段（api_sort_id）是 C2 的
// 图鉴排序编码，跨国改造形态不跟着走（Верный 落在日本段、UIT-25 落在德国段），
// 而策划的特効组是按舰名逐行点的。例外逐条带依据住在 `event-bonus-nationality.ts`。

import { eventNationalityRulingFor } from './event-bonus-nationality'
import type { EventNationalityRuling } from './event-bonus-nationality'

export interface EventBonusEntry {
  /** 适用范围原文，如 '全图' / 'P4 Boss（X点）' */
  scope: string
  by: 'stype' | 'nation' | 'ship' | 'equipGroup' | 'plane' | 'lbas' | string
  key: string
  value: number
  /** false = 区间或推定值，UI 要挂牌 */
  certain: boolean
}

export interface EventBonusShip {
  mstId: number
  /** master 原名，用于个别舰倍卡匹配 */
  name: string
  stype: number
  /** 国籍简称（'英' '意' '德'…），取自 shipNationalityOf().short */
  nationality: string | null
}

/** 倍卡表的舰种列名 ← stype。表里没有的舰种不给倍卡（不是给 1，是根本不匹配）。 */
const STYPE_LABEL: Record<number, string> = {
  1: '海防',
  2: '驱逐',
  3: '轻巡',
  5: '重巡',
  6: '航巡',
  13: '潜艇',
  14: '潜艇',
  16: '水母',
  20: '潜母',
}

/** 倍卡表用「苏」，本仓库的国籍表用「俄」——这一处必须显式对齐，不能靠字面相等。 */
const NATION_ALIAS: Record<string, string> = { 俄: '苏' }

const normalizedNation = (short: string | null): string | null =>
  short ? (NATION_ALIAS[short] ?? short) : null

/** 拆点位清单用的分隔符：上游顿号、逗号、斜杠、空白都用过 */
const NODE_SEPARATORS = /[、,，/／|｜\s]+/
/** 一个点位名：字母开头，可带数字（A / J2 / ZZ / Y1） */
const NODE_TOKEN = /^[A-Za-z]+\d*$/

/**
 * 一条 scope 覆盖哪些点位。
 *
 * 上游那一格的写法有三种，还会用换行混在同一个单元格里：
 *   ①「全图」/「全マップ」      —— 所有点位
 *   ②「P3 Boss（S点）」         —— **阶段名 + 点位**，点位是括号里那个；
 *                                  开头的 P3 是「第 3 阶段」，不是点位 P3
 *   ③「K、K1、K2、L」/「P3」    —— 裸点位清单
 *
 * 分辨法**逐行**来：这一行里出现了「X点」/「Xマス」就只认它标出来的点位，
 * 否则整行按顿号/逗号/斜杠拆成点位清单。
 *
 * 这条区分不是洁癖——本期 E5 同时存在**阶段 P2** 与**点位 P2**（行动半径 8）：
 *   ·「P2 Boss（J2点）」指的是 J2，一律按裸清单读会把这一行的倍率错发给点位 P2；
 *   · 单独一行的「P3」指的就是点位 P3，一律要求「X点」则会漏掉它，
 *     连同「L1、L2」一起——本期 E5 的陆航特効正好有三个点落在这两种写法上。
 */
export const scopeNodes = (scope: string): { all: boolean; nodes: Set<string> } => {
  const nodes = new Set<string>()
  let all = false
  for (const line of `${scope ?? ''}`.split('\n')) {
    const text = line.trim()
    if (!text) continue
    if (text.includes('全图') || text.includes('全マップ')) {
      all = true
      continue
    }
    const marked = [...text.matchAll(/([A-Za-z]+\d*)\s*(?:点|マス)/g)].map((m) => m[1])
    if (marked.length) {
      for (const node of marked) nodes.add(node)
      continue
    }
    for (const token of text.split(NODE_SEPARATORS)) {
      const trimmed = token.replace(/^[（(【['"]+|[）)】\]'"]+$/g, '').trim()
      if (NODE_TOKEN.test(trimmed)) nodes.add(trimmed)
    }
  }
  return { all, nodes }
}

/** 该 scope 是否适用于当前点位。'全图' 永远适用；其余按 `scopeNodes` 拆出来的点位清单认。 */
export const scopeApplies = (scope: string, nodeLetter: string | null): boolean => {
  if (!scope) return false
  const { all, nodes } = scopeNodes(scope)
  if (all) return true
  if (!nodeLetter) return false
  return nodes.has(nodeLetter)
}

export interface EventBonusResult {
  multiplier: number
  /** 参与叠乘的条目，供 UI 说明「凭什么是这个数」 */
  applied: EventBonusEntry[]
  /** 是否含区间/推定值——含则整个结果都不能当确定值 */
  certain: boolean
  /** 实际用来匹配国籍行的键（例外命中时是台账给的，否则是号段给的） */
  nation: string | null
  /** 命中的例外裁决；null = 走的号段缺省路径 */
  nationRuling: EventNationalityRuling | null
}

/**
 * 定这艘舰按哪个国籍键去匹配倍卡表。**先查例外，再落号段。**
 *
 * 号段是缺省规则（真外国舰零特判）；例外只收上游逐行点过名的那几艘，
 * 逐条带依据。`packPage` 对不上台账（换期了）时整段台账不生效——
 * 宁可退回号段，也不拿上一期的名单套这一期。
 */
export const eventBonusNationOf = (
  ship: Pick<EventBonusShip, 'mstId' | 'nationality'>,
  packPage: string | null = null,
): { nation: string | null; ruling: EventNationalityRuling | null } => {
  const ruling = eventNationalityRulingFor(ship.mstId, packPage)
  return ruling
    ? { nation: ruling.nation, ruling }
    : { nation: normalizedNation(ship.nationality), ruling: null }
}

/**
 * 算某舰在某点吃到的活动特效总倍率。
 *
 * `equipMstIdsByGroup` 是「装备组名 → 该组成员 mstId」的映射，由资料包给出；
 * 本函数不认装备名字——组成员表是资料，名字匹配是已知会出错的做法。
 *
 * `packPage` 是资料包当前指着的 kcwiki 活动页名，只用来给国籍例外台账定期号；
 * 不传（或对不上）就是纯号段——老行为。
 */
export const eventBonusFor = (
  ship: EventBonusShip,
  equipMstIds: readonly number[],
  entries: readonly EventBonusEntry[],
  nodeLetter: string | null,
  equipGroupMembers: Readonly<Record<string, readonly number[]>> = {},
  packPage: string | null = null,
): EventBonusResult => {
  const stypeLabel = STYPE_LABEL[ship.stype] ?? null
  const { nation, ruling } = eventBonusNationOf(ship, packPage)
  const equips = new Set(equipMstIds)
  const groupsOwned = new Set(
    Object.entries(equipGroupMembers)
      .filter(([, members]) => members.some((id) => equips.has(id)))
      .map(([group]) => group),
  )

  const applied: EventBonusEntry[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    if (!scopeApplies(entry.scope, nodeLetter)) continue
    const hit =
      (entry.by === 'stype' && stypeLabel === entry.key) ||
      (entry.by === 'nation' && nation === entry.key) ||
      (entry.by === 'ship' && ship.name === entry.key) ||
      (entry.by === 'equipGroup' && groupsOwned.has(entry.key))
    if (!hit) continue
    // 同一 scope + 类别 + key 只算一次（同组不重复）
    const dedupe = `${entry.scope}|${entry.by}|${entry.key}`
    if (seen.has(dedupe)) continue
    seen.add(dedupe)
    applied.push(entry)
  }

  return {
    multiplier: applied.reduce((product, entry) => product * entry.value, 1),
    applied,
    certain: applied.every((entry) => entry.certain),
    nation,
    nationRuling: ruling,
  }
}
