// 深海往期 boss 语音的**考古推测**：由档名结构反推「这一条该叫什么名字」。
//
// ---- 为什么需要 ----
// 深海语音能不能试听，分界是 `subtitle-enemies` 有没有记该形态的**完整官方档名**。
// 那个包 2023 年弃更，覆盖有空洞（米駆逐棲姫 2204 就漏网）。件 B 的亲历台账只
// 覆盖得到「玩家自己打过」的 boss；往期活动的 boss 没有亲历机会，只能考古。
//
// ---- 档名结构（已实证）----
//     档名 = 前缀 + 形态号 + 行号        605229710 = 605 | 2297 | 10
// 形态号写法两种（与 `abyss-voice-file` 同一套实证）：mstId ≥ 2000 用四位的 mstId
// 本身；1500–1999 用三位的 `mstId - 1000`。行号首位是場合号（1 開幕前…5 未知）。
//
// ---- 前缀规律：**钉不死**（2026-08-25 考证结论，别再重猜一遍）----
// 拿两个现成样本库量过——随包 `subtitle-enemies` 的 309 条官方档名 + 本机未匹配
// 台账的 25 条实际请求，合计 84 个形态：
//   · 前缀**不是固定值**，也不是按形态号段切分，而是一个**随版本递增的序号**：
//     它大体随 mstId 单调上升（最大前缀口径下 83 个相邻对里只有 10 次回落，
//     回落全出在「同一形态被后来的活动重新收录」那几条上）；
//   · 一只 boss 与它的 `-壊` 形态**共用同一个前缀**（1745/1748→394、1755/1758→397、
//     1783/1786→414、1793/1796→417、1846/1849→431，无一例外）；
//   · 但步长不规则。对 69 个无歧义样本做留一交叉验证：
//         最近邻      命中 39/69（57%），±1 内 48/69（70%）
//     另外三种规则更差（最近的下界 / 下界+1 / 线性插值，命中率都在四成以下）。
//     最近邻最好，**也不到六成**。
//
// ---- 两读歧义（同日实测，别当成 bug 去「修」）----
// 1500–1999 的形态有两种写法，于是有些老档名**两读都成立**：
//     3505871（北方棲姫 1587）= 35 | 0587 | 1   也 = 350 | 587 | 1
// 结构本身分不出谁真。随包 309 条里 12 条落在这一档。切前缀时**唯一解才认**，
// 两读的一律不进样本索引（无歧义的 69 个形态才进）——宁可样本少，不要拿
// 一半概率的前缀去污染最近邻。试听那边则把两读都列成候选，让用户点。
//
// ---- 写法也有可能性排序（2026-08-25 同批量出来的第二件事）----
// 1500–1999 那三种写法不是等概率的。拿同两批样本里**读法唯一**的 56 个低段形态数：
//     四位 mstId 本身 32 · 补零四位 14 · 三位 32→10   （56 个形态里 0 个混用写法）
// 「同一形态从不混用」是要害：一条档名确认之后，那个形态其余各行的写法就定了。
// 于是候选排序 = 前缀名次（大头，最近邻 57% 对 ±1 的 6.5%）× 写法名次（3 倍差），
// 前缀名次压倒写法名次，所以按前缀分组、组内按写法排。留一交叉验证实测：
//     真档名排在候选第一位  165/328，naive（写法照 `abyssVoiceFormSegments` 原序）86/328
//     真档名根本不在候选里   84/328 —— 前缀落在 ±2 之外，那些只能手输
// 而**同形态已有一条已知档名**时（前缀与写法都定了）：下一行首选即中 301/317。
// 所以 UI 的账是这样：一个形态的头一行要试十来次，中了之后剩下几行基本一点就中。
//
// 写法与年代确实相关（三位只出现在前缀 64–354、补零四位 284–610、四位 mstId 383–466），
// 但三段互相重叠、样本又只有 56 个，**没拿它当规则**——排错了只是多点几下，
// 而一条聪明但错的规律会骗到下一个人。记在这里，省得后来者再量一遍。
//
// 所以这里**不假装能算出来**：给一串按可能性排序的候选（最近邻，再 ±1、±2），
// UI 拿它当默认值，旁边留手输的口子。一次一条人肉点，绝不自动扫号。

import { parseAbyssVoiceFile } from './abyss-voice-file'

/**
 * 形态号那一段的**全部**合法写法（与 `abyss-voice-file` 同一套实证）：
 *   · mstId ≥ 2000 —— 四位的 mstId 本身，只有一种写法；
 *   · 1500–1999   —— **三种写法都在真包里出现过**：
 *       三位的 `mstId-1000`（`33265330` = 332|653|30）、
 *       补前导零的四位（`27605571` = 276|0557|1）、
 *       以及四位的 mstId 本身（`383172210` = 383|1722|10）。
 *     切前缀和拼档名都必须三种全试——只认一种会漏掉一大半（实测 84 → 28）。
 */
export const abyssVoiceFormSegments = (mstId: number): string[] =>
  mstId >= 2_000
    ? [`${mstId}`]
    : [`${mstId - 1_000}`, `${mstId - 1_000}`.padStart(4, '0'), `${mstId}`]

/** 主写法（拼档名时的默认）。 */
export const abyssVoiceFormSegment = (mstId: number): string => abyssVoiceFormSegments(mstId)[0]!

/**
 * 由（前缀, 形态, 行号）拼出档名。任一段不合法就返回 null——**不拼半成品地址**。
 */
export const abyssVoiceFileOf = (
  prefix: number | string,
  mstId: number,
  lineNo: number | string,
): string | null => {
  const head = `${prefix ?? ''}`.trim()
  const tail = `${lineNo ?? ''}`.trim()
  if (!/^\d{2,3}$/.test(head)) return null
  if (!Number.isInteger(mstId) || mstId < 1_500) return null
  if (!/^[1-5]$|^[1-5][01]$/.test(tail)) return null
  return `${head}${abyssVoiceFormSegment(mstId)}${tail}`
}

/**
 * 从一条**已知归属**的档名里切出前缀。
 *
 * 不能拿 `indexOf(形态号)` 找位置——三位形态号完全可能先在前缀里撞上一次
 *（实测这么写 84 个形态只认出 28 个）。按前缀长度 2/3 逐个试，且要求剩下那一截
 * 是合法行号，才算切对。切不出唯一解就返回 null。
 */
export const abyssVoicePrefixCandidates = (file: string, mstId: number): number[] =>
  [...new Set(abyssVoiceReadings(file, mstId).map((reading) => reading.prefix))].sort(
    (a, b) => a - b,
  )

/**
 * 一条档名在这个形态下的**全部合法读法**：每一读给出（前缀, 形态号写法下标）。
 *
 * 切前缀与认写法是同一次扫描的两个投影，各写一遍必然漂移——而漂移的表现是
 * 「前缀切得出来、写法却认不出」这类自相矛盾，不报错。
 */
const abyssVoiceReadings = (
  file: string,
  mstId: number,
): { prefix: number; writing: number }[] => {
  const segments = abyssVoiceFormSegments(mstId)
  const out: { prefix: number; writing: number }[] = []
  for (let writing = 0; writing < segments.length; writing += 1) {
    const segment = segments[writing]!
    for (const head of [2, 3]) {
      if (file.slice(head, head + segment.length) !== segment) continue
      const tail = file.slice(head + segment.length)
      if (!/^[1-5]$|^[1-5][01]$/.test(tail)) continue
      const prefix = Number(file.slice(0, head))
      if (Number.isFinite(prefix)) out.push({ prefix, writing })
    }
  }
  return out
}

/**
 * 这条已知档名的形态号**用的是哪一种写法**（`abyssVoiceFormSegments` 的下标）。
 * 两读都成立时返回 null——与切前缀同一条纪律：唯一解才认。
 */
export const abyssVoiceFormWritingOf = (file: string, mstId: number): number | null => {
  const writings = new Set(
    abyssVoiceReadings(`${file ?? ''}`.trim(), mstId).map((reading) => reading.writing),
  )
  return writings.size === 1 ? [...writings][0]! : null
}

/** 唯一解才认；两读都成立时返回 null（理由见头注「两读歧义」）。 */
export const abyssVoicePrefixOf = (file: string, mstId: number): number | null => {
  const found = abyssVoicePrefixCandidates(file, mstId)
  return found.length === 1 ? found[0]! : null
}

/**
 * 由（前缀, 形态, 行号）拼出**全部**候选档名——1500–1999 的形态有两种写法，
 * 哪一种在服务器上得试过才知道。≥2000 只有一条。
 */
export const abyssVoiceFileCandidates = (
  prefix: number | string,
  mstId: number,
  lineNo: number | string,
): string[] => {
  const head = `${prefix ?? ''}`.trim()
  const tail = `${lineNo ?? ''}`.trim()
  if (!/^\d{2,3}$/.test(head)) return []
  if (!Number.isInteger(mstId) || mstId < 1_500) return []
  if (!/^[1-5]$|^[1-5][01]$/.test(tail)) return []
  return abyssVoiceFormSegments(mstId).map((segment) => `${head}${segment}${tail}`)
}

/** 形态 → 前缀 的样本索引（从任意一批已知档名建）。 */
export const buildAbyssPrefixIndex = (
  files: Iterable<string>,
  isAbyssMstId: (mstId: number) => boolean,
): Map<number, number> => {
  const index = new Map<number, number>()
  for (const raw of files) {
    const file = `${raw ?? ''}`.trim()
    if (!/^\d+$/.test(file)) continue
    const parsed = parseAbyssVoiceFile(file, isAbyssMstId)
    if (!parsed?.mstId) continue
    const prefix = abyssVoicePrefixOf(file, parsed.mstId)
    if (prefix == null) continue
    // 同一形态出现多个前缀时取**大**的：那是后来的活动重新收录的那一版，
    // 与「前缀是递增序号」一致，也更可能是现在还挂在服务器上的那一份
    index.set(parsed.mstId, Math.max(index.get(parsed.mstId) ?? 0, prefix))
  }
  return index
}

/**
 * 猜这个形态的前缀，按可能性从高到低给候选。
 *
 * 最近邻打头（实测命中 57%），再向两侧各探 `spread` 个。已知的形态直接返回它自己
 * 的前缀（那不是猜）。索引为空就给空数组——**没有样本就不猜**。
 */
export const guessAbyssVoicePrefixes = (
  mstId: number,
  index: ReadonlyMap<number, number>,
  spread = 2,
): number[] => {
  const known = index.get(mstId)
  if (known != null) return [known]
  let nearest: number | null = null
  let best = Number.POSITIVE_INFINITY
  for (const [id, prefix] of index) {
    const distance = Math.abs(id - mstId)
    if (distance < best) {
      best = distance
      nearest = prefix
    }
  }
  if (nearest == null) return []
  const out: number[] = []
  for (let step = 0; step <= spread; step += 1) {
    for (const candidate of step === 0 ? [nearest] : [nearest + step, nearest - step]) {
      if (candidate >= 10 && candidate <= 999 && !out.includes(candidate)) out.push(candidate)
    }
  }
  return out
}

/**
 * 形态号三种写法的可能性名次（`abyssVoiceFormSegments` 的下标，最可能的在前）。
 * 实测 56 个低段形态：四位 mstId 本身 32 · 补零四位 14 · 三位 10（见头注）。
 */
export const ABYSS_VOICE_WRITING_RANK: readonly number[] = [2, 1, 0]

/**
 * 这一行该试哪几个档名，**按可能性从高到低**。UI 拿它逐个点，用户耳测判响没响。
 *
 * 排序 = 前缀名次（大头）× 写法名次；`known` 里给这个形态**已经确认过的档名**时，
 * 它用的写法提到最前——同一形态从不混用写法（56 个形态零例外），
 * 这一条把「头一行试十来次」摊成「其余各行基本一点就中」（实测 301/317）。
 *
 * 索引里没样本、或行号/形态不合法时给空数组——**没有样本就不猜**。
 */
export const abyssVoiceGuessCandidates = (
  mstId: number,
  lineNo: number | string,
  index: ReadonlyMap<number, number>,
  known: readonly string[] = [],
  spread = 2,
): string[] => {
  const seen = new Set<number>()
  const order: number[] = []
  for (const file of known) {
    const writing = abyssVoiceFormWritingOf(`${file ?? ''}`.trim(), mstId)
    if (writing != null && !seen.has(writing)) {
      seen.add(writing)
      order.push(writing)
    }
  }
  for (const writing of ABYSS_VOICE_WRITING_RANK) {
    if (!seen.has(writing)) {
      seen.add(writing)
      order.push(writing)
    }
  }
  const out: string[] = []
  for (const prefix of guessAbyssVoicePrefixes(mstId, index, spread)) {
    const files = abyssVoiceFileCandidates(prefix, mstId, lineNo)
    for (const writing of order) {
      const file = files[writing]
      if (file && !out.includes(file)) out.push(file)
    }
  }
  return out
}
