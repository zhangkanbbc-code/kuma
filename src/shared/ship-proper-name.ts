// 编成门标签里的**专有名词**（舰名 / 舰级 / 队名残段）统一中文写法（2026-09-01 起）。
//
// ---- 为什么还要再来一遍 ----
// 舰种词那一单（`ship-type-name.ts`）把「駆逐 ×3」与「驱逐舰 ×3」并成了一种说法，
// 但它按设计**只认舰种词**，专有名词一律原样放行——于是同一列里仍然并排着：
//   · kcwiki 源抄上游日文字形的舰名与舰级：「時雨」「長門改二」「陽炎级」；
//   · 主数据里本来就是拉丁字母的舰名：「Saratoga Mk.II」「Fletcher」「Warspite」；
//   · 艦素自研侧从中文正文切片取的简体写法：「时雨」「长门改二」「阳炎型」。
// 同一艘舰三种写法、同一个舰级两种后缀。用户 2026-09-01 拍板要统一。
//
// ---- 不新造译名表 ----
// 这个文件里**一个中文名都不是这里现造的**，全部按名回查既有数据源：
//   · 舰名：token → 主数据 `api_mst_ship` 的日文名（或译名包记的原名、或中文名本身）
//     → mstId → `kcwiki-localization.entities.ship[mstId].zh`。
//     那正是全应用其它地方显示中文舰名走的同一条路（渲染层的 `entityNamePlain('ship', …)`
//     读的就是这张表），掉落记录里的「扎拉 / 衣阿华 / 里诺」就是它的产物。
//     拉丁名（Saratoga Mk.II / Warspite / Верный）走同一条路拿到既定译名，
//     不在这里另开一份英译。
//   · 舰级：只做**字形归一 + 后缀归一**——把 token 的基名当舰名回查上面那条路，
//     再把末字交给 `ship-class-name.ts` 的 `normalizeShipClassName`。
//     **不改级名本身**：正文写「铃谷型」就出「铃谷级」，不替玩家换成舰级真名「最上级」——
//     那是在改门的说法，不是在统一写法。真名索引留给图鉴那一侧（它要的正是真名）。
//   · 残余的日/繁字形（队名「第四水雷戦隊」、正文碎片「補」）：交给 `cjk-fold.ts` 的
//     `foldCjkVariants` 这张仓里已有的对位表兜底，同样不新造字。
//
// ---- 「型」还是「级」----
// 选「级」。依据不是数人头（真舰级词按出现次数是 型 45 : 级 30，「型」反而多），
// 而是**本项目早就拍过板的口径**：`shared/ship-class-name.ts` 文件头写着
// 「kcwiki 写『◯◯型』，本项目 chip 的口径是『◯◯级』」，`normalizeShipClassName`
// 就是那条口径的唯一实现，图鉴的舰级芯片（ji.ts）与任务模块的舰级实体（qn.ts）
// 显示的全是「◯◯级」。编成门这一列若选「型」，它会变成全应用唯一说「型」的地方——
// 那正是这一单要消灭的东西。旁证两条：中文任务正文自己写的是「阳炎级/夕云级」
// （A88、C15）「弗莱彻级驱逐舰」（Cy6）；同列的舰种词「轻巡级」「重巡级」也已是「级」。
//
// ---- 认不出的一律原样放行（国籍词组归第三遍）----
// 「美英澳荷出身的舰娘」「法国舰艇」这类词组不是专有名词，这一遍认不出、原样放行，
// 由 `ship-nation-name.ts` 那张封闭表在最后一遍统一——三遍的分工写在
// `quest-counter.ts` 的 `localizeFleetGoalLabels` 文件注释里。
// 三条路都不命中就一个字节都不动。歧义（同一把钥匙查出两个不同中文名，如「宗谷」
// 对着灯塔补给／南极观测／特务舰三个译名）**同样放行**：宁可继续露原文，
// 也不替玩家在三个名字里挑一个。
import { foldCjkVariants } from './cjk-fold'
import { normalizeShipClassName } from './ship-class-name'
import { mapLabelWords } from './ship-type-name'

/** 舰级 token 的末字：三种写法都收，出口一律归到「级」。 */
const CLASS_SUFFIX = /[型级級]$/

const clean = (value: unknown): string => `${value ?? ''}`.trim()

/**
 * 索引与待查词走同一把钥匙：NFKC → 日/繁汉字对位折叠 → 小写 → 去空白。
 *
 * **只去空白，标点一个都不去**（与 `quest-fleet-rules` 的 `foldToken` 的分界就在这里）：
 * 那一份是拿来**认**舰的，连括号一起去掉能多认出几艘；这一份是拿来**换字**的，
 * 去掉括号就会把「朝潮改二(丁)」整个换成没有括号的「朝潮改二丁」——那是改自研侧
 * 写的排版，不是统一写法。
 * 空白例外：主数据写「Samuel B.Roberts」而上游备注写「Samuel B. Roberts」，
 * 差的就是那一个空格，不去就整条留在英文（同一行里另外四艘都已经是中文名了）。
 * 去空白只影响**认不认得出**，认出来之后上屏的是译名包里那个完整的中文名，
 * 不存在「顺手把玩家看到的空格吃掉」这回事。
 */
const nameKey = (raw: unknown): string =>
  foldCjkVariants(clean(raw).normalize('NFKC')).toLowerCase().replace(/\s+/g, '')

/** 值为 null 表示这把钥匙查出过两个不同的中文名（歧义），命中也不换。 */
export type ShipProperNameIndex = Map<string, string | null>

export interface ShipProperNameSources {
  /** `api_start2` 的 `api_data`（要 `api_mst_ship`）。 */
  masterRaw?: unknown
  /** `kcwiki-localization` 的 `data`（要 `entities.ship`）。 */
  localizationData?: unknown
}

/**
 * 建「任意写法 → 中文舰名」的索引。**装配期建一次**，别在每条标签上重扫主数据：
 * 3057 条主数据 × 五百多个 token 的线性回查是每次 `initQuestCounter` 都要付的账。
 *
 * 三把钥匙都指向同一个中文名：主数据的日文名、译名包记的日文原名（两者偶有出入，
 * 都收）、中文名自身（后者让整条出口**幂等**——已经是中文的 token 再跑一遍还是它）。
 */
export const buildShipProperNameIndex = (
  sources: ShipProperNameSources,
): ShipProperNameIndex => {
  const index: ShipProperNameIndex = new Map()
  const add = (raw: unknown, zh: string) => {
    const key = nameKey(raw)
    if (!key) return
    if (!index.has(key)) {
      index.set(key, zh)
      return
    }
    // 同一把钥匙两个不同答案 → 记成歧义，之后一律放行
    if (index.get(key) !== zh) index.set(key, null)
  }
  const masterNames = new Map<number, string>()
  for (const ship of (sources.masterRaw as any)?.api_mst_ship ?? []) {
    const mstId = Number(ship?.api_id)
    if (Number.isInteger(mstId) && mstId > 0) masterNames.set(mstId, clean(ship?.api_name))
  }
  const entities = (sources.localizationData as any)?.entities?.ship ?? {}
  for (const [idText, entry] of Object.entries<any>(entities)) {
    const mstId = Number(idText)
    const zh = clean(entry?.zh)
    if (!Number.isInteger(mstId) || mstId <= 0 || !zh) continue
    add(masterNames.get(mstId), zh)
    add(entry?.ja, zh)
    add(zh, zh)
  }
  return index
}

const lookup = (index: ShipProperNameIndex, raw: unknown): string | null => {
  const key = nameKey(raw)
  return key ? index.get(key) ?? null : null
}

/** 一个词被换掉的理由；`null` 是原样放行。护栏与出口共用这一个判据。 */
export type ShipProperVia = 'ship' | 'class' | 'fold' | null

export interface ShipProperVerdict {
  text: string
  via: ShipProperVia
}

/**
 * 单个词的判决。**三条路依次试，先命中先算**：
 *   ① 整词就是一艘舰的名字 → 换成它的中文名；
 *   ② 词以「型/级/級」收尾、去掉末字之后是一艘舰的名字 → 中文基名 + 归一后的末字；
 *   ③ 都不是 → 拿 `foldCjkVariants` 折一遍日/繁字形，折出不同的字就用折后的。
 *
 * ③ 只兜底、不认名字：它换的是**字**不是**词**，认不出的字原样留着（那张表自己的纪律）。
 * 真包上今天只有两个词落到 ③（队名「第四水雷戦隊」、正文碎片「補」），护栏把这份清单钉着。
 */
export const classifyShipProperToken = (
  token: string,
  index: ShipProperNameIndex,
): ShipProperVerdict => {
  const word = `${token ?? ''}`
  if (!word) return { text: word, via: null }
  const asShip = lookup(index, word)
  if (asShip) return { text: asShip, via: 'ship' }
  if (CLASS_SUFFIX.test(word)) {
    // 「Fletcher 级」的那个空格夹在基名与末字之间，归一后不留——
    // 同一份包里另一处写的就是「Fletcher级」，两种写法正是要消灭的东西。
    const base = word.slice(0, -1).trim()
    const zhBase = base ? lookup(index, base) : null
    if (zhBase) return { text: normalizeShipClassName(`${zhBase}${word.slice(-1)}`), via: 'class' }
  }
  const folded = foldCjkVariants(word)
  if (folded !== word) return { text: folded, via: 'fold' }
  return { text: word, via: null }
}

/**
 * 编成门标签里的专有名词规范写法。**整词匹配、分隔符与前后空白一个字节都不碰**——
 * 切法与 `localizeShipTypeWords` 同源（`mapLabelWords`），两遍各切各的必然漂移。
 *
 * 与舰种词那一遍的先后：**先舰种词、后专有名词**。反过来也跑得通（两边认的词不相交），
 * 但舰种词那一遍的判据是封闭表，先跑完它，落到这一遍的就都是它明确放行的词。
 */
export const localizeShipProperWords = (
  label: string,
  index: ShipProperNameIndex,
): string =>
  mapLabelWords(label, (word) => {
    const verdict = classifyShipProperToken(word, index)
    return verdict.via === null ? undefined : verdict.text
  })
