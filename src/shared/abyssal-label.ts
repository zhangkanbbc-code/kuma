// wiki 敌编成表标注名的解析——维护期定号（scripts/lib/abyssal-id-pin.mjs）和
// 运行时模糊命中（镝的战前匹配）共用这一份。两边口径必须一致：同一个标注
// 在维护期算出的候选池和运行时算出的必须是同一批 id，否则「维护期定不下来、
// 运行时却匹配上了别的池」这种账没法对。
//
// 两侧的权限不同，这条线划在这里：
//   维护期（pinner）：可以用字母/HP 判据把池收敛到**单一 id**，产物过人工闸。
//   运行时（本模块的 poolOf）：只给**候选池**，绝不挑出单一 id——同名多形态
//   一旦在运行时猜错，就是在战斗界面上对着玩家说错敌人是谁。

const RANK_SUFFIX = /(flagship|elite)$/

/** 抹掉 wiki 链接标记残留（`[[名前]]` 断在单元格里会漏出方括号）。 */
export const stripAbyssalWikiMarkup = (value: unknown): string =>
  `${value ?? ''}`
    .normalize('NFKC')
    .replace(/\[\[/g, '')
    .replace(/\]\]?/g, '')
    .trim()

export interface AbyssalLabelParts {
  base: string
  rank: string
  position: string | null
  notes: string[]
  letter: string | null
  hp: number | null
}

/**
 * 拆开一个标注名。
 * @param label wiki 原文，如 `(後衛)軽母ヌ級elite(E)(艦載機白弱)`
 * @param isKnownBase 判断某个字符串是不是主数据里的名字（含带括号的正式名）
 */
export const parseAbyssalLabel = (
  label: string,
  isKnownBase: (text: string) => boolean = () => false,
): AbyssalLabelParts => {
  let text = stripAbyssalWikiMarkup(label)
  // 开头的 (後衛) 之类是站位说明，不是名字的一部分
  const position = text.match(/^[（(]([^（）()]*)[）)]/)?.[1] ?? null
  if (position) text = text.slice(position.length + 2).trim()

  const notes: string[] = []
  // 从右往左剥括号，但一旦剩下的部分已经是主数据里的名字就停手：
  // 「飛行場姫(哨戒機配備)」的括号是名字自带的。
  while (!isKnownBase(text) && !isKnownBase(text.replace(RANK_SUFFIX, '').trim())) {
    const match = text.match(/[（(]([^（）()]*)[）)]$/)
    if (!match) break
    notes.unshift(match[1])
    text = text.slice(0, match.index).trim()
  }
  const rank = text.match(RANK_SUFFIX)?.[1] ?? ''
  return {
    base: rank ? text.slice(0, -rank.length).trim() : text,
    rank,
    position,
    notes,
    letter: notes.map((note) => note.match(/^([A-Z])$/)?.[1]).find(Boolean) ?? null,
    hp: Number(notes.map((note) => note.match(/^HP(\d+)$/)?.[1]).find(Boolean)) || null,
  }
}

// ---------------------------------------------------------------- 展示层：基名 + 形态标注
//
// 译名查找（renderer/localization.ts 的 localizedLinkLabel）本来是**全名等值比对**，
// 于是凡是把形态标注拼进标注名的位置全部静默回落日文：词条里只有「軽母ヌ級改」，
// 而包里写的是「軽母ヌ級改 flagship 艦載機赤」，一个后缀就让整条落空。
// 实测两个矿脉包 21350 个敌舰位里 9440 位（44%）栽在这上面——不是缺译名，是调用姿势。
//
// 这里把标注切成「站位前缀 + 基名 + 形态标注」三段：基名去查译名，前后两段**原样保留**。
// 形态标注不翻译：`flagship`/`艦載機赤`/`(陸爆中)` 是 wiki 的形态记号，不是句子；
// 翻了反而对不上玩家在攻略站看到的写法。

/**
 * 形态标注的词表。**每一条都出自两个矿脉包的真实标注**（map-enemy-comps /
 * map-intel 全量归纳，2026-08-25 实测共 43 种组合），不是拍脑袋列的：
 *
 *   等级   flagship / elite
 *   舰载机 艦載機白 / 艦載機赤 / 艦載機黒 / 艦載機鳥白 / 艦載機鳥赤 / 艦載機鳥黒 / 艦載機白赤
 *   陆爆   (陸爆弱) / (陸爆中) / (陸爆強)
 *   点位   (空襲) / (偵察)
 *   进度   最終形態 / 前哨戦（可带 強/弱）
 *   编号   单个大写字母 (A)…(F)，也见不带括号的裸字母
 *
 * 词表**故意收得紧**：认不出的尾巴一律判定「这不是标注」，整条退回全名等值比对，
 * 宁可继续露日文提醒补词表，也不能把「駆逐イ級後期型」的「後期型」当标注剥掉，
 * 那会把玩家眼前的敌人换成另一艘舰。
 */
const ABYSS_ANNOTATION_TOKEN =
  /^(?:\s+|[（(）)]|flagship|elite|艦載機[白赤黒鳥]+|陸爆[弱中強]|最終形態|前哨戦|空襲|偵察|[弱中強]|[A-Z](?![A-Za-z]))/

/** 这段尾巴是否**整段**都由形态标注构成（空串算是）。 */
export const isAbyssAnnotation = (text: string): boolean => {
  let rest = text
  while (rest) {
    const token = ABYSS_ANNOTATION_TOKEN.exec(rest)
    if (!token) return false
    rest = rest.slice(token[0].length)
  }
  return true
}

export interface AbyssDisplayLabelParts {
  /** 基名之前原样保留的部分，如 `(後衛)`；没有就是空串 */
  head: string
  /** 去查译名的那一段 */
  base: string
  /** 基名之后原样保留的形态标注，如 ` flagship 艦載機赤`；没有就是空串 */
  tail: string
}

/**
 * 按 `isKnownBase` 把标注名切成三段。切不出来返回 null（调用方照旧走全名比对）。
 *
 * 基名从**长到短**试：`軽母ヌ級改flagship` 要先试整串再试 `軽母ヌ級改`，
 * 反过来就会在 `軽母ヌ級` 上提前收工，把 `改` 当成标注剥掉——那是另一艘舰。
 * 基名一侧只认 `isKnownBase` 的**等值**判断，尾巴一侧只认上面那张词表，两头都不模糊。
 */
export const splitAbyssalDisplayLabel = (
  label: string,
  isKnownBase: (text: string) => boolean,
): AbyssDisplayLabelParts | null => {
  const text = `${label ?? ''}`
  if (!text.trim()) return null
  // 开头的 (後衛) 之类是站位说明，不是名字的一部分（parseAbyssalLabel 同一条判据）
  const position = /^(?:[（(][^（）()]*[）)])\s*/.exec(text)
  const head = position?.[0] ?? ''
  const body = text.slice(head.length)
  for (let cut = body.length; cut > 0; cut--) {
    if (!isAbyssAnnotation(body.slice(cut))) continue
    // 基名与标注之间的空格归**标注**那半：`軽母ヌ級改 flagship` 切完要还能拼回原样，
    // 否则中文名会跟 flagship 挤成一坨。
    const base = body.slice(0, cut).replace(/\s+$/, '')
    if (base && isKnownBase(base)) return { head, base, tail: body.slice(base.length) }
  }
  return null
}

export interface AbyssalNameEntry {
  id: number
  name: string
  yomi?: string
}

export interface AbyssalNameIndex {
  isKnownBase: (text: string) => boolean
  parse: (label: string) => AbyssalLabelParts
  /** 整名 / 名+等级 完全一致时的最小 id；维护期 pinner 的快捷路径。 */
  exactIdOf: (label: string) => number | null
  /**
   * 一个标注对应的同名同级候选池（mstId 升序）。
   * 数字原样包一层；基名不在主数据里 → 空数组。
   * 等级没写出来时不能拿 '' 当条件——姫级在主数据里 api_yomi 常常是
   * flagship，这时取该基名全部等级的并集。
   */
  poolOf: (label: string | number) => number[]
}

export const createAbyssalNameIndex = (
  entries: Iterable<AbyssalNameEntry>,
): AbyssalNameIndex => {
  const names = new Set<string>()
  const byNameRank = new Map<string, number[]>()
  const exact = new Map<string, number>()
  for (const entry of entries) {
    const id = Number(entry.id)
    const name = `${entry.name ?? ''}`.trim()
    if (!Number.isInteger(id) || id <= 0 || !name) continue
    const yomi = `${entry.yomi ?? ''}`.trim()
    const rank = yomi === '-' ? '' : yomi
    names.add(name)
    const key = `${name}|${rank}`
    const pool = byNameRank.get(key) ?? []
    pool.push(id)
    byNameRank.set(key, pool)
    for (const alias of [name, `${name}${rank}`]) {
      const current = exact.get(alias)
      if (current == null || id < current) exact.set(alias, id)
    }
  }
  for (const ids of byNameRank.values()) ids.sort((left, right) => left - right)

  const isKnownBase = (text: string) => names.has(text)
  const parse = (label: string) => parseAbyssalLabel(label, isKnownBase)
  return {
    isKnownBase,
    parse,
    exactIdOf: (label) => exact.get(stripAbyssalWikiMarkup(label)) ?? null,
    poolOf: (label) => {
      if (typeof label === 'number') return [label]
      const parsed = parse(label)
      if (!names.has(parsed.base)) return []
      return parsed.rank
        ? [...(byNameRank.get(`${parsed.base}|${parsed.rank}`) ?? [])]
        : [...byNameRank.entries()]
            .filter(([key]) => key.slice(0, key.lastIndexOf('|')) === parsed.base)
            .flatMap(([, ids]) => ids)
            .sort((left, right) => left - right)
    },
  }
}
