// 「这件装备能从哪儿弄到」——把几张按**来源**组织的表反查成按结果的答案。
//
// 三条渠道各有一张现成的表，只是都写成了正方向：
//   · 改修更新：equip-upgrades 说「A ★max 可以更新成 B」，要问的是「B 从哪来」；
//   · 初期装备：kcwiki-ships 说「这艘舰带哪几件」，要问的是「哪些舰带它」；
//   · 任务奖励与开发在别处，各有各的判据，这里不掺。
//
// **活动奖励查不到**：本地这几份资料都没有入手方法字段（kcwiki 的装备表只标
// 能不能开发/改修，wikiwiki 的装备总页也没有），所以界面上如实说「不收录」
// 并给 wiki 链接，不拿「没列出」冒充「没有这条途径」。

export interface EquipUpgradeRow {
  eq_id?: number
  improvement?:
    | ({ convert?: { id_after?: number; lvl_after?: number } | null; basis?: string } | null)[]
    | null
}

/**
 * 改修事实表里一行的置信档（`basis` 那一格说的是「这个数现在有多硬」）。
 *
 * 判据只看开头那几个字——`basis` 的写法由 `scripts/build-equip-improve.mjs` 收口，
 * 护栏逐条钉着只许用约定的那四档，所以这里不必做模糊匹配。
 */
export type ImproveBasisTier = 'default' | 'rule' | 'official' | 'measured'

export const improveBasisTier = (basis: string | null | undefined): ImproveBasisTier => {
  const text = `${basis ?? ''}`
  if (text.startsWith('游戏内实测')) return 'measured'
  if (text.startsWith('机制通则推定')) return 'rule'
  if (text.includes('官方公告')) return 'official'
  return 'default'
}

/**
 * 这一件装备在改修卡上该挂哪一枚角标。
 *
 * 角标是**置信提示**，不是来源声明：只有偏离「照资料整理」那一档的才值得说一句。
 * 同一件里几档并存时挂 `rule`——「这一格是按机制推出来的」比「这一格实测过」
 * 更需要让人看见：前者是提醒，后者是加分，提醒不该被加分压掉。
 */
export const improveEntryTier = (
  improvement: EquipUpgradeRow['improvement'],
): ImproveBasisTier => {
  let best: ImproveBasisTier = 'default'
  for (const row of improvement ?? []) {
    const tier = improveBasisTier(row?.basis)
    if (tier === 'rule') return 'rule'
    if (tier === 'measured' || (tier === 'official' && best === 'default')) best = tier
  }
  return best
}

export interface UpgradeSource {
  /** 改修更新前的那件装备 */
  fromId: number
  /** 更新后保留的改修星级（多数是 0，即从头再改） */
  levelAfter: number
}

/**
 * 哪些装备改修更新之后会变成它。
 *
 * 同一件源装备可能有多条更新路径指向同一个结果（不同僚舰/星级档），
 * 这里按源装备去重——玩家关心的是「拿哪件去更新」，不是走第几条分支。
 */
export const upgradeSourcesOf = (
  rows: Iterable<EquipUpgradeRow> | null | undefined,
  targetId: number,
): UpgradeSource[] => {
  const out = new Map<number, UpgradeSource>()
  if (!rows || !(targetId > 0)) return []
  for (const row of rows) {
    const fromId = Number(row?.eq_id)
    if (!(fromId > 0)) continue
    for (const step of row.improvement ?? []) {
      const after = Number(step?.convert?.id_after)
      if (after !== targetId) continue
      const levelAfter = Number(step?.convert?.lvl_after)
      const known = out.get(fromId)
      // 同源多条路径时保留星级最高的那条：那是玩家最想知道的上限
      if (!known || (Number.isFinite(levelAfter) && levelAfter > known.levelAfter)) {
        out.set(fromId, { fromId, levelAfter: Number.isFinite(levelAfter) ? levelAfter : 0 })
      }
    }
  }
  return [...out.values()].sort((a, b) => a.fromId - b.fromId)
}

// ---- 「不可改修」与「还没收录」是两件事 ----
//
// 改修表按**能改的那些**逐件列，不能改的根本不出现在表里。于是「查不到这一件」
// 有两种来路：上游看过了、它就是不能改；或者它是刚实装的、上游还没收。
// 混成一句话说，玩家看到的就是一个替官方下的结论。
//
// 判据照抄装备加成那边已经用熟的那条（shared/fit-bonus 的 fitPackUncovered）：
// 包里收到第几号，是这份资料的**覆盖边界**——边界之内查不到 = 真的不能改；
// 边界之外 = 还没收录。号段这条判据对改修表成立的理由与加成表同源：
// 两份都是按装备 id 顺序整理的全量表，不是挑着收的。

/** 改修表覆盖到的最大装备 id。 */
export const improvePackCoverageMax = (
  rows: Iterable<EquipUpgradeRow> | null | undefined,
): number => {
  let max = 0
  for (const row of rows ?? []) {
    const id = Number(row?.eq_id)
    if (Number.isFinite(id) && id > max) max = id
  }
  return max
}

/** 这件装备落在改修表的覆盖范围之外吗（= 该说「暂未收录」而不是「不可改修」）。 */
export const improvePackUncovered = (
  rows: Iterable<EquipUpgradeRow> | null | undefined,
  equipId: number,
  coverageMax?: number,
): boolean => {
  if (!(equipId > 0)) return false
  const max = Number.isFinite(coverageMax) ? (coverageMax as number) : improvePackCoverageMax(rows)
  // 包一条都没有（没装/没拉）时不下任何结论：那是「资料没到」，不是「号段之外」
  if (!(max > 0)) return true
  return equipId > max
}

export interface KcwikiShipRow {
  ID?: number
  装备?: { 初期装备?: number[] | null } | null
}

/**
 * 哪些舰初期携带它（得到那艘舰就等于得到这件装备，拆解也行）。
 *
 * 同一艘舰的各改造形态在库里各占一条，同一个 mstId 也可能带两件同型装备，
 * 都按舰 mstId 去重——列表要的是「找哪艘舰」，不是「有几个格子」。
 */
export const initialEquipShips = (
  rows: Iterable<KcwikiShipRow> | null | undefined,
  targetId: number,
): number[] => {
  const out = new Set<number>()
  if (!rows || !(targetId > 0)) return []
  for (const row of rows) {
    const shipId = Number(row?.ID)
    if (!(shipId > 0)) continue
    for (const equipId of row.装备?.初期装备 ?? []) {
      if (Number(equipId) === targetId) out.add(shipId)
    }
  }
  return [...out].sort((a, b) => a - b)
}
