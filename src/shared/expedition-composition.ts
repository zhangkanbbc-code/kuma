// 远征编成条件的解析器(从 bi.ts 抽出,让测试能拿真函数打真矿脉)。
//
// 判定诚实度的关键在这里:舰种映射不到 → types=null → 界面显示 ◌「无法自动判定」,
// 绝不假装 ✓/✗。护栏测试对整个 wikiwiki-expedition 包断言解析覆盖率 100%——
// 未来矿脉刷新引入新舰种写法时测试先红,轮不到玩家在面板上看到一排 ◌。
//
// 一条远征可能有**多套可行编成**,判定按「任一分支满足即可」:
//   1. 「或」分支(43:护卫空母船团 或 轻空母船团)——原先摊平成同时要求,
//      走护卫空母分支的合法编成会被误判 ✗(2026-08-13 用户点名复查)。
//   2. wiki 原文里「(駆1海防3)(護母1駆2他1)…の編成でも成功する」列出的变体
//      编成(4/5/9/42/43/A3~A6 共 9 条)——海防舰刷闪党的常用配置全在这批里,
//      不认它们就是对着合法编成报 ✗。记法规整,逐组解析;解析不动的组
//      宁可丢弃也不猜(见 parseSuccessVariants)。
//
// 两个曾被静默丢掉的语义,现在都进模型:
//   - 「(1驱逐+1海防不可)」= 禁混搭:2 个坑必须同一舰种凑满(homogeneous)。
//   - 「护卫空母」≠ 轻空母:主数据 api_tais 恰好只长在护卫空母身上
//     (大鷹 35/鳳翔改二戦 34,龍驤等普通轻母没有),cve 标记让判定端
//     用 stype=7 且基础对潜>0 落实,不能拿任意轻母顶包。

// 舰种中文名 → stype 集(宽松匹配;映射不到 → null = 无法判定)
const TYPE_RULES: [RegExp, number[]][] = [
  [/海防/, [1]],
  [/驱逐|駆逐/, [2]],
  [/轻巡|軽巡/, [3]],
  [/雷巡/, [4]],
  [/重巡/, [5]],
  [/航巡/, [6]],
  [/护卫空母|護衛空母|护母|護母|轻空母|軽空母|轻母|軽母/, [7]],
  [/航战/, [10]],
  [/战舰/, [8, 9, 10]],
  [/装母/, [18]],
  [/正规空母|空母/, [11, 18]],
  [/潜水母舰|潜母/, [20]],
  [/潜艇|潜水/, [13, 14]],
  [/水母/, [16]],
  [/扬陆|揚陸/, [17]],
  [/工作/, [19]],
  [/练巡|練巡/, [21]],
  [/补给/, [22]],
]

const CVE_RE = /护卫空母|護衛空母|护母|護母/

export interface CompReq {
  label: string
  types: number[] | null // null = 解析失败(无法自动判定)
  count: number
  flagship: boolean
  wildcard: boolean // 其他/任意
  /** 要求护卫空母:stype 7 且主数据基础对潜 > 0,普通轻母不算 */
  cve: boolean
  /** 多舰种组禁混搭(「1驱逐+1海防不可」):须单一舰种凑满 count */
  homogeneous: boolean
}

export interface CompBranch {
  /** 单编成为空串;多分支为「编成一/编成二」;变体为「wiki 变体N」 */
  label: string
  reqs: CompReq[]
}

const HOMOGENEOUS_MARK = '@禁混搭@'
const FLAG_MARK = '@旗舰@'

const parseBranchText = (text: string): CompReq[] => {
  const reqs: CompReq[] = []
  const tokens = `${text}`
    .replace(/[（(][^（）()]*[）)]/g, (m2) => {
      if (/旗舰|旗艦/.test(m2)) return FLAG_MARK
      // 「(1驱逐+1海防不可)」:禁混搭注记要进模型,不能静默丢掉
      if (/^[（(]\s*1.+\+\s*1.+不可\s*[）)]$/.test(m2)) return HOMOGENEOUS_MARK
      return ''
    })
    // 「练巡旗舰+海防舰*2」(A4)的 + 是并列分隔符,与空格同义;
    // 唯一会出现 + 的注记(1驱逐+1海防不可)已在上一步转成标记,不会误伤
    .split(/[\s，,、\n+＋]+/)
    .filter(Boolean)
  for (const token of tokens) {
    const homogeneous = token.includes(HOMOGENEOUS_MARK)
    const cleanToken = token.replace(new RegExp(HOMOGENEOUS_MARK, 'g'), '')
    const m = cleanToken.match(/^(.+?)(?:\*(\d+))?$/)
    if (!m) continue
    let namePart = m[1]
    const count = m[2] ? parseInt(m[2], 10) : 1
    const flagship = namePart.includes(FLAG_MARK) || /旗舰|旗艦/.test(namePart)
    namePart = namePart.replace(new RegExp(FLAG_MARK, 'g'), '').replace(/必须|固定|旗舰|旗艦/g, '')
    const label = cleanToken.replace(new RegExp(FLAG_MARK, 'g'), '(旗舰)').replace(/\*\d+/, '')
    if (!namePart || /^(任意|其他|他)$/.test(namePart)) {
      reqs.push({
        label: cleanToken.replace(new RegExp(FLAG_MARK, 'g'), ''),
        types: null,
        count,
        flagship,
        wildcard: true,
        cve: false,
        homogeneous: false,
      })
      continue
    }
    const typeSet = new Set<number>()
    let unknown = false
    for (const part of namePart.split('/')) {
      const rule = TYPE_RULES.find(([re]) => re.test(part))
      if (rule) rule[1].forEach((t) => typeSet.add(t))
      else if (part.trim()) unknown = true
    }
    reqs.push({
      label,
      types: unknown || !typeSet.size ? null : [...typeSet],
      count,
      flagship,
      wildcard: false,
      cve: CVE_RE.test(namePart),
      homogeneous,
    })
  }
  return reqs
}

// wiki 变体编成的紧凑记法:「(軽母(旗艦)1駆1海防3他1)」。词表是封闭的——
// 全组每个字都要被吃掉才算解析成功,吃不干净整组丢弃(宁缺毋猜)。
const VARIANT_TOKEN =
  /(護母|护母|軽母|轻母|軽巡|轻巡|練巡|练巡|海防|駆逐|驱逐|駆|軽|他)([（(]旗[艦舰][）)])?(\d+)/g
const VARIANT_TYPES: Record<string, number[] | null> = {
  護母: [7], 护母: [7],
  軽母: [7], 轻母: [7],
  軽巡: [3], 轻巡: [3], 軽: [3],
  練巡: [21], 练巡: [21],
  海防: [1],
  駆逐: [2], 驱逐: [2], 駆: [2],
  他: null, // wildcard
}

/** 从 wiki 原文里抽出「…の編成でも成功する」前面列出的变体编成。 */
export const parseSuccessVariants = (raw: string): CompBranch[] => {
  const text = `${raw ?? ''}`
  const anchor = text.indexOf('の編成でも成功')
  if (anchor < 0) return []
  // 从锚点往前收集连续的括号组(内层可再嵌一层「(旗艦)」)
  const groups: string[] = []
  let end = anchor
  while (end > 0) {
    let i = end - 1
    while (i >= 0 && /\s/.test(text[i])) i--
    if (text[i] !== ')' && text[i] !== '）') break
    let depth = 0
    let j = i
    for (; j >= 0; j--) {
      const ch = text[j]
      if (ch === ')' || ch === '）') depth++
      else if (ch === '(' || ch === '（') {
        depth--
        if (depth === 0) break
      }
    }
    if (j < 0 || depth !== 0) break
    groups.unshift(text.slice(j + 1, i))
    end = j
  }
  const out: CompBranch[] = []
  for (const rawGroup of groups) {
    const group = rawGroup.replace(/\s+/g, '')
    const reqs: CompReq[] = []
    let consumed = 0
    for (const m of group.matchAll(VARIANT_TOKEN)) {
      consumed += m[0].length
      const word = m[1]
      const flagship = !!m[2]
      const count = parseInt(m[3], 10)
      const types = VARIANT_TYPES[word] ?? null
      reqs.push({
        label: `${word}${flagship ? '(旗舰)' : ''}`,
        types,
        count,
        flagship,
        wildcard: word === '他',
        cve: CVE_RE.test(word),
        homogeneous: false,
      })
    }
    // 吃不干净的组整组丢弃:半懂不懂的变体拿去判定就是在猜
    if (!reqs.length || consumed !== group.length) continue
    out.push({ label: `wiki 变体${out.length + 1}`, reqs })
  }
  return out
}

/**
 * 解析一条远征的全部可行编成分支。
 * @param text 编成条件文本(kcwiki/wikiwiki 的 composition)
 * @param rawText wiki 要求原文(escortText/rawComposition),用于抽变体编成
 */
export const parseCompositionBranches = (
  text: string,
  rawText?: string | null,
): CompBranch[] => {
  // 「或」只在词首出现(前面必有空白/换行);A4 的「或练巡旗舰+…」连写也在此切开
  const segments = `${text}`.replace(/^\s*或/, '').split(/[\s\n]+或/)
  const HAN = '一二三四五六七八九'
  const branches: CompBranch[] = segments
    .map((segment) => parseBranchText(segment))
    .filter((reqs) => reqs.length)
    .map((reqs, index, all) => ({
      label: all.length > 1 ? `编成${HAN[index] ?? index + 1}` : '',
      reqs,
    }))
  for (const variant of parseSuccessVariants(rawText ?? '')) branches.push(variant)
  return branches.length ? branches : [{ label: '', reqs: [] }]
}

/** 判定端喂进来的舰只视图:stype + 是否护卫空母(主数据基础对潜>0)。 */
export interface CompShipView {
  stype: number
  cve: boolean
}

/**
 * 单条编成要求的判定。多舰种禁混搭组取「单一舰种的最大数」;
 * 旗舰要求看 ships[0]。types=null(无法判定)的要求不该喂进来。
 */
export const compReqStatus = (
  req: CompReq,
  ships: CompShipView[],
): { matched: number; ok: boolean; flagOk: boolean | null } => {
  const fits = (ship: CompShipView) =>
    !!req.types?.includes(ship.stype) && (!req.cve || ship.cve)
  let matched: number
  if (req.homogeneous) {
    const byType = new Map<number, number>()
    for (const ship of ships) {
      if (fits(ship)) byType.set(ship.stype, (byType.get(ship.stype) ?? 0) + 1)
    }
    matched = byType.size ? Math.max(...byType.values()) : 0
  } else {
    matched = ships.filter(fits).length
  }
  const flagOk = req.flagship ? ships.length > 0 && fits(ships[0]) : null
  return { matched, ok: matched >= req.count && flagOk !== false, flagOk }
}
