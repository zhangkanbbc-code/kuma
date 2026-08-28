// 舰级真名：`api_ctype` → 舰级显示名。
//
// ---- 为什么不能拿「级里图鉴编号最小的那艘 + 级」当级名 ----
//
// 游戏的图鉴编号（`api_sortno`）有历史怪癖：早期实装的舰排在前面，与「谁是这一级的
// 首舰」没有关系。实证：**雪風 sortno=5、陽炎 sortno=91**，于是阳炎型（api_ctype 30）
// 被显示成「雪风级」。同病的还有 Johnston 顶掉 Fletcher（弗莱彻级 → 约翰斯顿级）、
// Samuel B.Roberts 顶掉 John C.Butler（约翰·C·巴特勒级 → 塞缪尔·B·罗伯茨级）、
// Libeccio 顶掉 Maestrale（西北风级 → 西南风级）。全表跑下来 140 个舰级里 53 个是错的
// ——不是个别例外，是那个启发式本身站不住。
//
// ---- 正法 ----
//
// 随包 `kcwiki-ships` 的 `级别` 字段就是舰级真名（装备加成词表那一批已实证 105 条
// 舰级名与 api_ctype 一一对得上，做法见 `scripts/lib/fit-bonus-vocab.mjs`）。
// kcwiki 写「◯◯型」，本项目 chip 的口径是「◯◯级」，末字归一即可。
//
// 同一个 ctype 会收到多个写法（改造形态记成「改最上型」、外军舰级中英混写、
// 「猫鲨级 SS-238」这种带舷号的细分），按四条依次判：
//   ① **成级名的优先**——末字是「级」的，压过「猫鲨级 SS-238」「600吨冷藏船」这类；
//   ② **非「改／改装／重近代化改装」前缀的优先**——那是改造形态的级名，不是本级；
//   ③ 票多的优先；④ 短的优先（同分时「最上级」压过更长的变体）。
// 「?型」这种占位写法直接不投票。
//
// 索引里查不到的舰级**由调用方退回原启发式**，这里如实不给——不硬造名字。
//
// 这个文件**不 import 任何东西**：`node --test` 直接跑 .ts 时，无扩展名的相对值导入
// 会让整份文件加载不起来（同 `fit-bonus-corrections.ts` 文件头那一条）。

/** kcwiki「模块:舰娘数据」的一行，只取这两个字段。 */
export interface ShipClassNameRow {
  ID?: unknown
  级别?: unknown
}

/** kcwiki 写「◯◯型」，chip 的口径是「◯◯级」；不带这两个后缀的原样留着。 */
export const normalizeShipClassName = (name: string): string => {
  const text = `${name ?? ''}`.trim()
  if (!text) return ''
  return /[型級]$/.test(text) ? `${text.slice(0, -1)}级` : text
}

const REMODEL_CLASS_PREFIX = /^(重近代化改装|改装|改)/

/**
 * 建 `api_ctype` → 舰级真名 的索引。
 *
 * @param rows    kcwiki-ships 的行（`Object.values(lode.data)` 或它的 Map 值）
 * @param ctypeOf 形态 mstId → `api_ctype`（主数据；查不到回 0）
 */
export const buildShipClassNameIndex = (
  rows: Iterable<ShipClassNameRow | null | undefined>,
  ctypeOf: (mstId: number) => number,
): Map<number, string> => {
  const votes = new Map<number, Map<string, number>>()
  for (const row of rows) {
    const ctype = Number(ctypeOf(Number(row?.ID)))
    const raw = Array.isArray(row?.级别) ? row.级别[0] : null
    const name = normalizeShipClassName(`${raw ?? ''}`)
    // 「?型」是上游还没填的占位，别当成级名
    if (!(ctype > 0) || !name || name.includes('?') || name.includes('？')) continue
    const box = votes.get(ctype) ?? new Map<string, number>()
    box.set(name, (box.get(name) ?? 0) + 1)
    votes.set(ctype, box)
  }
  const index = new Map<number, string>()
  for (const [ctype, box] of votes) {
    const best = pickClassName(box)
    if (best) index.set(ctype, best)
  }
  return index
}

/** 同一个 ctype 收到多个写法时按四条依次判（见文件头）。 */
const pickClassName = (box: Map<string, number>): string | null =>
  [...box.entries()]
    .map(([name, count]) => ({
      name,
      count,
      clean: name.endsWith('级') ? 1 : 0,
      base: REMODEL_CLASS_PREFIX.test(name) ? 0 : 1,
    }))
    .sort(
      (left, right) =>
        right.clean - left.clean ||
        right.base - left.base ||
        right.count - left.count ||
        left.name.length - right.name.length ||
        (left.name < right.name ? -1 : 1),
    )[0]?.name ?? null

/** `wikiwiki-ship-profile` 的一行，只取这两个字段（`舰级` 形如 `['Brooklyn級', 5]`）。 */
export interface ShipClassProfileRow {
  shipId?: unknown
  shipClass?: unknown
}

/**
 * 自补层：拿 `wikiwiki-ship-profile` 的舰级名**补缺，不覆盖**。
 *
 * 为什么要有这一层（自扩展体检待裁 3，2026-08-23 用户拍板「启发式只填空」）：
 * kcwiki 索引查不到的 ctype，调用方会退回启发式「链上头舰名 + 级」——而那个启发式
 * 按 `api_sortno` 最小的那艘取名，全表跑下来 140 个舰级里 53 个是错的。更糟的是它**不稳**：
 * 一艘新舰若加进一个「既有但 kcwiki 没覆盖」的 ctype 且 sortno 更小，整个舰级当场改名，
 * 而覆盖率护栏（`missing.length <= 5`）看不出来。
 *
 * 所以在启发式**之前**再插一层真名来源，把启发式挤到只剩「两个源都没有」的空白格。
 * **补缺不覆盖**是这一层的全部纪律：kcwiki 已经给出的一个字都不动——两个源在同一格
 * 各说各的时，谁对是数据问题，不该由「谁后跑」决定。
 *
 * 就地改传进来的 `index` 并原样返回（调用方拿它当缓存）。
 */
export const supplementShipClassNames = (
  index: Map<number, string>,
  rows: Iterable<ShipClassProfileRow | null | undefined>,
  ctypeOf: (mstId: number) => number,
): Map<number, string> => {
  const votes = new Map<number, Map<string, number>>()
  for (const row of rows) {
    const ctype = Number(ctypeOf(Number(row?.shipId)))
    if (!(ctype > 0) || index.has(ctype)) continue // ← 补缺不覆盖
    const raw = Array.isArray(row?.shipClass) ? row.shipClass[0] : row?.shipClass
    const name = normalizeShipClassName(`${raw ?? ''}`)
    if (!name || name.includes('?') || name.includes('？')) continue
    const box = votes.get(ctype) ?? new Map<string, number>()
    box.set(name, (box.get(name) ?? 0) + 1)
    votes.set(ctype, box)
  }
  for (const [ctype, box] of votes) {
    const best = pickClassName(box)
    if (best) index.set(ctype, best)
  }
  return index
}
