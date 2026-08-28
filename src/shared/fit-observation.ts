// 装备加成**实测栏**的归键与合并（纯函数层）。
//
// 面板反推给出的是「这艘舰这一套配装的七项差值」。要把它摆成一张读得懂的表，
// 得先回答三个问题，三个都错过：
//
//   ① **一次观察的键是什么。** 原先按「舰」归，★ 不在键里，于是同一艘舰装了
//      ★0 与 ★2 各一件时，界面标成「2 件 ★2」——那个 ★2 是 `Math.max` 拍出来的，
//      不是观察到的东西。用户实拍的活案例：赤城改二戊 × 流星改(一航戦/熟練)
//      ★0＋★2 各一件。所以键是 **(装备, 舰形态, ★多重集, 件数)**：★ 进键，
//      而且是**整个多重集**，不是最大值也不是平均值。
//   ② **混★ 的行能不能直读。** 不能。「只有这一件」的直读资格来自「差值只能归给这一件」，
//      而混★ 时差值还得在两个星级档之间分摊——归不到单一档位上。所以混★ 一律
//      摘掉直读徽记，并如实标「混★」。宁可少说一句，不说一句不准的。
//   ③ **哪些行该并。** 同 ★、同件数、同读数、同证据强度的几艘舰是同一条信息，
//      并成一行列舰名；★ 不同的**绝不并**（那正是 ① 要防的）。
//
// 这一层不碰 DOM、不读账本，纯输入输出——护栏在 test/fit-observation.test.mjs。
//
// **这个文件只准 `import type`**：`node --test` 直接跑 .ts 时，无扩展名的相对**值**导入
// 会让整份文件加载不起来（同 `fit-bonus-corrections.ts` 文件头那一条）。

import type { FitExpected, FitObserved, FitStatKey, FitStats } from './fit-bonus'

/**
 * 这一次观察与**当下那张预期表**比对的结论。
 *
 * 只有三种，「说不准」单独占一档：
 *   · `match` —— 预期完整，且面板差值逐项与预期相等；
 *   · `mismatch` —— 比得出来，但对不上。**最有信息量的一档**（多半是某一边的条件没算对）；
 *   · `unknown` —— 比不出来（预期表有未收录/待定/按海域的行，或那一项被闸门挡下了）。
 *
 * 这是「当下预期表」的函数，预期表一更新结论就可能变——**不许落盘**
 *（`FitObservationRecord` 里没有这一栏，别加）。
 */
export type FitObservationVerdict = 'match' | 'mismatch' | 'unknown'

/**
 * 比对一次观察与预期。
 *
 * 比的是**面板七项**：`panelKeys` 由调用方给（`FIT_PANEL_KEYS`）——这个文件只准
 * `import type`，取不到那个值。预期表里的命中/射程/爆装本来就不进面板、也反推不出来，
 * 不在比对范围内，它们非零不影响结论。
 *
 * 判 `unknown` 的几种场合，共同点都是「预期这一侧不是一份完整的账」：
 *   · `expected.complete` 为假 —— 未收录的装备 / 条件待定的行 / 按出击海域生效的行，
 *     三者任一都让合计只是**下限**，拿下限去比出来的「相等」是碰巧，不是印证。
 *     包没加载时求值器也回 `complete: false`，这一条一并挡住。
 *   · 某一项被成长闸门挡下（没出行）而预期在那一项上有数 —— 那一格根本没读到，
 *     没读到就不能说「对上了」。
 *   · 一项都没出行 —— 什么都没比过。
 *
 * 反过来，**被挡下的项上预期为 0** 不算 unknown：那一格两侧都不出数，
 * 折起来也没有藏住任何本来看得见的东西。
 */
export const fitObservationVerdict = (
  expected: FitExpected | null | undefined,
  observed: FitObserved,
  panelKeys: readonly FitStatKey[],
): FitObservationVerdict => {
  if (!expected?.complete) return 'unknown'
  if (!observed.rows.length) return 'unknown'
  for (const key of panelKeys) {
    const row = observed.rows.find((one) => one.key === key)
    // 这一项没出行：预期在这儿有数就是「没读到、比不了」，预期是 0 就不必比
    if (!row) {
      if (expected.stats[key]) return 'unknown'
      continue
    }
    if ((expected.stats[key] ?? 0) !== row.observed) return 'mismatch'
  }
  return 'match'
}

/** 一艘舰上、这件装备的一次观察。 */
export interface FitObservationSample {
  /** 在籍 id（同一形态可能有好几艘，界面要指得出是哪一艘） */
  rosterId: number
  /** 舰形态 mstId —— 观察键的一部分 */
  formId: number
  name: string
  lv: number
  /** 这艘舰上这件装备**逐件**的改修★；长度即件数 */
  stars: readonly number[]
  /** 面板反推的七项差值（火力/雷装/对空/装甲 + 过了标定闸门的 回避/对潜/索敌） */
  stats: FitStats
  /** 这艘舰上再没有第二件有加成记录的装备 —— 直读的**候选**（还要不混★才算数） */
  soleCandidate: boolean
  /** 与预期表比对的结论（`fitObservationVerdict`）。不填 = 没比过，按 `unknown` 算 */
  verdict?: FitObservationVerdict
}

/** 排好序的★多重集：`[2, 0]` → `[0, 2]`。归键与显示都以它为准。 */
export const fitObservationStars = (stars: readonly number[]): number[] =>
  [...stars].map((star) => Number(star) || 0).sort((left, right) => left - right)

/**
 * 观察键：**(装备, 舰形态, ★多重集, 件数)**。
 *
 * 件数其实由★多重集的长度决定，仍旧写进键里——键是给人读也给将来落盘用的，
 * 「2 件」这件事该在键面上看得见，而不是要数一下点分隔符才知道。
 */
export const fitObservationKey = (
  equipMstId: number,
  formId: number,
  stars: readonly number[],
): string => {
  const sorted = fitObservationStars(stars)
  return `${equipMstId}|${formId}|★${sorted.join('.')}|x${sorted.length}`
}

/** 同一批★吗（混★判据）。 */
export const fitObservationMixedStar = (stars: readonly number[]): boolean =>
  new Set(fitObservationStars(stars)).size > 1

/** 显示用的★文本：`★+2`；混★ 时把实际观察到的几个都列出来 `★0/★2`。 */
export const fitObservationStarLabel = (stars: readonly number[]): string => {
  const sorted = fitObservationStars(stars)
  if (!sorted.length) return ''
  // 混★ 时每个星级各带一个★号（`★0/★2`）——`★0/2` 会被读成「★0 装了 2 件」
  return [...new Set(sorted)].map((star) => `★${star}`).join('/')
}

/** 稳定文本形式，只用来判「两行的读数是不是同一个」。键按字典序，零值不写。 */
const dumpStats = (stats: FitStats | null | undefined): string =>
  Object.entries(stats ?? {})
    .filter(([, value]) => value)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}${value! > 0 ? '+' : ''}${value}`)
    .join(',')

export interface FitObservationRow {
  /** 合并键：同 ★、同件数、同读数、同证据强度、同比对结论的几艘并成一行 */
  key: string
  ships: { rosterId: number; formId: number; name: string; lv: number }[]
  count: number
  /** 排好序的★多重集 —— 显示的★必须是这个，不许是 max 或平均 */
  stars: number[]
  starLabel: string
  mixedStar: boolean
  stats: FitStats
  /** 可以直读成「这一件的加成」：候选成立**且**不混★ */
  sole: boolean
  /** 各项皆 0 —— 折叠段的成员 */
  allZero: boolean
  /** 与预期比对的结论。`match` 的那几行由调用方折起来，不一艘一行摊开 */
  verdict: FitObservationVerdict
}

/** 排序档位：不符的最前，相符的垫底（那一档整个会被折起来）。 */
const VERDICT_RANK: Readonly<Record<FitObservationVerdict, number>> = {
  mismatch: 0,
  unknown: 1,
  match: 2,
}

/**
 * 把逐舰观察归并成显示行。
 *
 * 排序（C1）：**与预期不符的行最前**（那是最有信息量的一档，绝不能被挤下去），
 * 其次是比不出来的，与预期相符的垫底——那一档会被调用方整个折起来。
 * 同一档之内：非零行在前，其中「只有这一件」的直读行最前；件数多的在前，
 * 同件数按等级降序（等级高的那一艘面板更稳）。各项皆 0 的行排在最后，
 * 由调用方折成一行——这里只保证它们在末尾且彼此有序。
 */
export const groupFitObservations = (
  samples: readonly FitObservationSample[],
): FitObservationRow[] => {
  const byKey = new Map<string, FitObservationRow>()
  for (const sample of samples) {
    const stars = fitObservationStars(sample.stars)
    const mixedStar = fitObservationMixedStar(stars)
    // 混★ 取消直读资格：差值归不到单一星级档上
    const sole = sample.soleCandidate && !mixedStar
    const statsText = dumpStats(sample.stats)
    // 比对结论**进合并键**：读数一样但一艘对得上、一艘对不上，那是两条信息。
    // 并成一行等于把「这一艘和资料不符」这件事藏进另一艘的行里
    //（同 ① 那条「★ 进键」的道理：并的前提是两艘说的是同一件事）。
    const verdict = sample.verdict ?? 'unknown'
    const key = `★${stars.join('.')}|x${stars.length}|${statsText}|${sole ? 'sole' : 'sum'}|${verdict}`
    const row = byKey.get(key)
    if (row) {
      row.ships.push({
        rosterId: sample.rosterId,
        formId: sample.formId,
        name: sample.name,
        lv: sample.lv,
      })
      continue
    }
    byKey.set(key, {
      key,
      ships: [
        { rosterId: sample.rosterId, formId: sample.formId, name: sample.name, lv: sample.lv },
      ],
      count: stars.length,
      stars,
      starLabel: fitObservationStarLabel(stars),
      mixedStar,
      stats: { ...sample.stats },
      sole,
      allZero: !statsText,
      verdict,
    })
  }
  const rows = [...byKey.values()]
  for (const row of rows) row.ships.sort((left, right) => right.lv - left.lv || left.rosterId - right.rosterId)
  return rows.sort(
    (left, right) =>
      VERDICT_RANK[left.verdict] - VERDICT_RANK[right.verdict] ||
      Number(left.allZero) - Number(right.allZero) ||
      Number(right.sole) - Number(left.sole) ||
      right.count - left.count ||
      (right.ships[0]?.lv ?? 0) - (left.ships[0]?.lv ?? 0) ||
      (left.key < right.key ? -1 : 1),
  )
}

/**
 * 落盘用的一条观察记录的**形状**（C4）。
 *
 * 账本表是 `fit_observations`（`src/main/mg/ledger.ts`），主键就是这里的
 * (装备, 舰形态, ★多重集, 件数)——**★进主键**，所以升星是新增一条，
 * 不覆盖旧星级那一条：「★2 时曾测得 火力+3」是一条独立的、仍然为真的观察。
 *
 * 时间用毫秒整数（不是 ISO 串）：账本里所有时间列都是毫秒整数，
 * ISO 串在 sqlite 里既排不了序也占三倍地方。
 *
 * **没有「与预期符不符」这一栏，也不许加**：观察本身是事实，「符不符」是它与
 * *当下那张*预期表的关系——表一更新，落盘的那个结论就成了骗人的旧账。
 */
export interface FitObservationRecord {
  /** `fitObservationKey(...)` 的产物 */
  key: string
  equipMstId: number
  formId: number
  stars: number[]
  count: number
  stats: FitStats
  sole: boolean
  /** 最近一次观察到它的时刻（毫秒） */
  seenAt: number
  /** 头一次观察到它的时刻（毫秒）。落盘后才有；写入方不填 */
  firstSeenAt?: number
}

/** 把一条显示行拆回逐舰的落盘记录（一行可能并了好几艘，落盘要逐舰各一条）。 */
export const fitObservationRecordsOf = (
  equipMstId: number,
  rows: readonly FitObservationRow[],
  seenAt: number,
): FitObservationRecord[] =>
  rows.flatMap((row) =>
    row.ships.map((ship) => ({
      key: fitObservationKey(equipMstId, ship.formId, row.stars),
      equipMstId,
      formId: ship.formId,
      stars: [...row.stars],
      count: row.count,
      stats: { ...row.stats },
      sole: row.sole,
      seenAt,
    })),
  )
