// 铭 · 废弃装备类任务的自研推导。
//
// 原料只有两样：中文任务正文（任务库 quests-scn）与游戏一手主数据（api_start2）。
// 正文说「废弃什么、几个」，主数据说「那个名字是哪件装备 / 哪个装备类别」。
// 中间隔着三道坎，这个模块就是这三道坎：
//
//   1. **句子归属**——正文里「废弃」和「准备」经常挤在同一句，先后顺序还两种都有
//      （1137 是先准备后废弃，1141 是废弃项后面直接串着准备项）。按标点切段、
//      逐段记住「当前动词是谁」，段里的名字就归谁。归错了会把要准备的装备当成要废弃的。
//   2. **分配式数量**——「A、B、C 各 3 个」「舰战、舰爆、舰攻各 9 个，爆雷兵装、机枪各 8 个」。
//      一个「各 N」只结算**到此为止还没拿到数量的那些**，不是整句。1161 一句里就有两组。
//   3. **名称归一**——正文写「12.7cm联装高角炮」，数据写「12.7cm连装高角炮」（連/联/连）；
//      正文写「三式战 飞燕（无印）」，数据写「三式战 飞燕」；1108 的 memo2 干脆是繁体。
//      归一层把简/繁/日三套汉字折到同一形态，再剥掉 ★/练度/无印 这类限定后缀。
//
// 口径（**这是自己算出来的，不是抄谁的编码**）：
//   一个类别名先落到游戏自己的 `api_mst_slotitem_equiptype`（api_type[2]，下称 category）。
//   只有当这个名字指的是**跨多个 category 的一族**时，才去找一个「成员恰好等于这一族」
//   的 iconType 或 cardType 来表达——两级都要试，因为它们各自兜得住的族不同：
//   「增设装甲」（category 16「追加装甲」成员为 0，真东西在 27 中型/28 大型）只有
//   iconType 23 恰好等于 27∪28；「魚雷」系（5∪32）只有 cardType 3 恰好对上，
//   iconType 5 还会把特殊潜航艇（甲標的）一并算进来——那在游戏自己的类别表里是另一类装备。
//   反过来，「爆雷兵装」「机枪兵装」「机关部强化」这些看着像要 icon 的，实测
//   category 与 icon 的成员集合**逐件相同**（15≡17、21≡15、17≡19），怎么写都一样，
//   一律取 category——少一层间接，也少一次会过期的假设。
//
// 集合比较只算**提督能持有的装备**：深海装备在主数据里被 `api_sortno = 0` 显式标出
// （实测自军 584 件全部 >0、深海 157 件全部 = 0，`api_broken` 全零同样只出现在深海侧），
// 它们进不了库存也废弃不了。不滤掉的话，大口径主炮 icon 3 会因为两件深海炮而与
// category 3 不等，魚雷 cardType 3 也会因为七件深海鱼雷对不上族——凭空多出假分歧。
//
// 拿不准就整条不做：任一段名字解析不出（且不是可安全跳过的道具/资源），整条弃用。
// 缺子任务的追踪器分母偏小、进度虚高，比没有追踪器更坏。
//
// **日文原文是权威层**（2026-08-21 立）：中文正文是译文，会丢字。凡中文与第二解码器
// 分歧、或中文自身含混，先查游戏自己的日文原文（账本 `questlist` 报文里的
// `api_detail` 是一手；账本没见过的任务，用离线对账脚本从任务元数据包的日文字段核对，
// 那是游戏原文的转录，不是谁的编码）。本文件下方的仲裁台账逐条写了依据。

import { foldCjkVariants } from '../../shared/cjk-fold'
import type { QpTask } from '../../shared/qp-types'

// ---- 名称归一 ----
//
// 简/繁/日三套汉字的对位折叠在 shared/cjk-fold（远征名解析共用同一张表）；
// 这里只做装备名特有的那两步：剥限定括号、剥 ★/练度后缀。

const QUALIFIER_IN_BRACKET = /(无印|無印|★|☆|lv\.|以上|不问|不問|max|熟练|熟練|改修|要求)/i
const BRACKET_PAIRS: [string, string][] = [
  ['(', ')'], ['「', '」'], ['『', '』'], ['【', '】'], ['〔', '〕'], ['[', ']'],
]
const STRIP_CHARS = /[「」『』【】〔〕[\]（）()“”"'‘’\s]/g

/**
 * 剥掉「（无印）」「（★max）」「(Lv.70以上)」这类限定括号。
 * 名字自带的括号（「九七式舰攻（九三一空）」「61cm三连装（酸素）鱼雷」）原样留着——
 * 反正后面 STRIP_CHARS 会把括号本身去掉，两侧同样处理就还是对得上。
 */
const dropQualifierBrackets = (text: string): string => {
  let out = text
  for (const [open, close] of BRACKET_PAIRS) {
    let from = 0
    for (let guard = 0; guard < 32; guard += 1) {
      const start = out.indexOf(open, from)
      if (start < 0) break
      const end = out.indexOf(close, start + 1)
      if (end < 0) break
      if (QUALIFIER_IN_BRACKET.test(out.slice(start + 1, end))) {
        out = out.slice(0, start) + out.slice(end + 1)
        from = start
      } else {
        from = end + 1
      }
    }
  }
  return out
}

export const normalizeEquipName = (raw: string): string => {
  let text = `${raw ?? ''}`.normalize('NFKC')
  text = dropQualifierBrackets(text)
  text = text.replace(/[★☆]\s*\+?\s*(?:\d+|max)?/gi, '')
  text = text.replace(STRIP_CHARS, '')
  return foldCjkVariants(text).toLowerCase()
}

// ---- 索引 ----

export interface ScrapRuleContext {
  /** 归一名 → 装备 mstId */
  equipByName: ReadonlyMap<string, number>
  /** 归一名 → 装备类别 id（api_type[2]）集合；多值表示这个名字指一族 */
  typeByName: ReadonlyMap<string, number[]>
  /** 归一名 → 「这是道具/资源，不是装备」；出现在废弃句里静默跳过 */
  nonEquip: ReadonlySet<string>
  /** 装备类别集合 → 单个 api_type 键；表达不了返回 null */
  keyOfTypes: (typeIds: number[]) => QpTask | null
}

// 正文用的俗名/简称/错字，与游戏类别名对不上，逐条给出依据。
// **只收在正文里真出现过的**——猜着往里加等于给未来的错解析开口子。
const TYPE_ALIASES: { text: string; types: number[]; why: string }[] = [
  { text: '舰战', types: [6], why: '「艦上戦闘機」的通用简称（1107/1120/1161）' },
  { text: '舰爆', types: [7], why: '「艦上爆撃機」的通用简称' },
  { text: '舰攻', types: [8], why: '「艦上攻撃機」的通用简称' },
  { text: '水侦', types: [10], why: '「水上偵察機」的通用简称（677/1151）' },
  { text: '舰上轰炸机', types: [7], why: '旧译；kcwiki 展示名 2026-08 起改直译系「舰上爆击机」' },
  { text: '水上轰炸机', types: [11], why: '旧译；对应「水上爆撃機」' },
  { text: '多用途水上机', types: [11], why: '1116 正文把水爆写成「水上轰炸机/多用途水上机」' },
  { text: '机枪', types: [21], why: '「対空機銃」；正文一律省掉「对空」二字' },
  { text: '机铳', types: [21], why: '同上，另一种译法' },
  { text: '暴雷', types: [15], why: '1131 正文把「爆雷」写成「暴雷」，同音错字' },
  {
    text: '增设装甲',
    types: [27, 28],
    why:
      '正文按游戏的「強化」类页面写。主数据里 category 16「追加装甲」成员为 0，' +
      '真东西全在 27（中型）/28（大型）——写 16 这条任务永远计不了数（1130）',
  },
]

const NON_EQUIP_KEYWORDS = [
  '燃料', '弹药', '钢材', '铝土', '铝', '资材', '家具币', '家具箱', '开发资材',
  '高速建造材', '高速修复材', '改修资材', '熟练搭乘员', '夜间熟练搭乘员',
  '战斗详报', '勋章', '改装设计图', '新型兵装资材', '新型航空兵装资材',
  '新型火炮兵装资材', '新型喷进装备开发资材', '海外舰最新技术', '补强增设',
  '应急修理女神', '应急修理要员', '洋上补给',
]

export const buildScrapRuleContext = (
  masterRaw: any,
  localizationData: any,
): ScrapRuleContext | null => {
  const items: any[] = masterRaw?.api_mst_slotitem ?? []
  if (!items.length) return null
  const equipByName = new Map<string, number>()
  const equipZh = (localizationData?.entities?.equip ?? {}) as Record<string, { zh?: string }>
  const put = (map: Map<string, number>, name: string, id: number) => {
    const key = normalizeEquipName(name)
    // 同名撞车时留**小 id**：改造前的原型才是正文裸写名字时说的那件
    if (key && (!map.has(key) || (map.get(key) as number) > id)) map.set(key, id)
  }
  for (const item of items) {
    put(equipByName, `${item?.api_name ?? ''}`, Number(item?.api_id))
    const zh = equipZh[`${item?.api_id}`]?.zh
    if (zh) put(equipByName, zh, Number(item?.api_id))
  }

  const typeByName = new Map<string, number[]>()
  const typeZh = (localizationData?.entities?.equipType ?? {}) as Record<string, { zh?: string }>
  for (const type of masterRaw?.api_mst_slotitem_equiptype ?? []) {
    const id = Number(type?.api_id)
    if (!(id > 0)) continue
    for (const name of [`${type?.api_name ?? ''}`, typeZh[`${id}`]?.zh ?? '']) {
      const key = normalizeEquipName(name)
      if (key && !typeByName.has(key)) typeByName.set(key, [id])
    }
  }
  for (const alias of TYPE_ALIASES) {
    const key = normalizeEquipName(alias.text)
    if (key) typeByName.set(key, alias.types)
  }

  const nonEquip = new Set<string>()
  for (const name of NON_EQUIP_KEYWORDS) nonEquip.add(normalizeEquipName(name))
  for (const useitem of masterRaw?.api_mst_useitem ?? []) {
    const key = normalizeEquipName(`${useitem?.api_name ?? ''}`)
    if (key) nonEquip.add(key)
  }
  const itemZh = (localizationData?.entities?.item ?? {}) as Record<string, { zh?: string }>
  for (const entry of Object.values(itemZh)) {
    const key = normalizeEquipName(`${entry?.zh ?? ''}`)
    if (key) nonEquip.add(key)
  }

  const sameMembers = (left: any[], right: any[]) => {
    if (left.length !== right.length) return false
    const ids = new Set(right.map((item) => item.api_id))
    return left.every((item) => ids.has(item.api_id))
  }
  // 提督能持有的那些（见文件头）：深海装备只有 api_sortno 显式为 0，缺这个字段的行不算深海
  const ownable = items.filter((item) => item?.api_sortno !== 0)
  const keyOfTypes = (typeIds: number[]): QpTask | null => {
    const members = ownable.filter((item) => typeIds.includes(item?.api_type?.[2]))
    if (!members.length) return null
    if (typeIds.length === 1) return { kind: 'scrapCategory', category: typeIds[0], count: 1 }
    // 跨类别的一族：找一个成员恰好等于这一族的 icon / cardType 来表达。
    // icon 在前只是因为它先有实例（增设装甲）；两级都试，谁对得上用谁，对不上就不做。
    const levels: [number, (id: number) => QpTask][] = [
      [3, (id) => ({ kind: 'scrapIconType', iconType: id, count: 1 })],
      [1, (id) => ({ kind: 'scrapCardType', cardType: id, count: 1 })],
    ]
    for (const [index, make] of levels) {
      for (const key of new Set(members.map((item) => Number(item?.api_type?.[index])))) {
        const byKey = ownable.filter((item) => Number(item?.api_type?.[index]) === key)
        if (sameMembers(byKey, members)) return make(key)
      }
    }
    return null
  }

  return { equipByName, typeByName, nonEquip, keyOfTypes }
}

// ---- 正文解析 ----

const CN_DIGITS: Record<string, number> = {
  一: 1, 二: 2, 两: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
}
const parseCount = (raw: string): number => {
  const token = `${raw}`.normalize('NFKC').replace(/,/g, '')
  if (/^\d+$/.test(token)) return parseInt(token, 10)
  if (token.length === 1) return CN_DIGITS[token] ?? 1
  if (token.startsWith('十')) return 10 + (CN_DIGITS[token[1]] ?? 0)
  if (token.endsWith('十')) return (CN_DIGITS[token[0]] ?? 1) * 10
  const [tens, ones] = token.split('十')
  return (CN_DIGITS[tens] ?? 1) * 10 + (CN_DIGITS[ones] ?? 0)
}

const COUNT = String.raw`(\d+|[一二两兩三四五六七八九十]+)`
const UNIT = String.raw`(?:个|個|件|门|門|架|只|隻|台|具|支|座|副|把|挺|组|組|套)`
const SCRAP_VERB = /废弃|廢棄|拆解|销毁|銷毀|舍弃|捨棄/
const PREPARE_VERB = /准备|準備|备好|備好/
// 「装备」既是动词也是名词，判错就丢数量：
// - 前面是 类/系/同/各/的 或一个引号收尾 → 名词（「类装备各两个」「“舰攻”装备各9件」）
// - 后面直接跟 ×/数字/各/标点/句末 → 名词（「鱼雷装备×15」）
// 其余才是动词（「第一装备栏装备『三式爆雷投射机』」）。
const EQUIP_WORD = String.raw`(?<![类類系同各的”』」】"])(?:装备|裝備)(?![×xX*各、，,。！!\s\d]|$)`
const OTHER_VERB = new RegExp(
  `${EQUIP_WORD}|配备|配備|编入|編入|旗舰|旗艦|秘书舰|秘書艦|搭载|搭載|为旗|為旗|作为|作為|投入`,
)
// 正文里的建议/说明句不得产生任务：「其中的爆雷兵装推荐选择…」曾让原型多出一条
// （同族的坑在出击类里也踩过：「6-4建议携带秋津洲」被当成要打 6-4）。
const ADVICE_SENTENCE = /推荐|推薦|建议|建議|尽量|盡量|参见|參見|据说|據說|疑似|注意/

type Verb = 'none' | 'scrap' | 'prepare' | 'other'

interface Pending {
  names: string[]
  /** 「A 或 B」共用一个计数槽：任一命中都算同一格 */
  alt: boolean
  /** 名字是引号括起来的 = 正文在明确点名，不是散文噪音 */
  quoted: boolean
  count: number | null
}

/**
 * 把一句话切成「这一段归哪个动词」。
 *
 * 段的粒度是标点分出来的小块。**废弃/装备这类动词管整块**——它们在正文里既可能
 * 写在名字前（「废弃『A』×8」），也可能写在名字后（1116「『A』『B』『C』各废弃3个」），
 * 从中间劈开会把「各」和「3个」分到两段，分配式数量当场失效。
 * 只有「准备」要就地劈：一块里前半是废弃项、后半是准备项的写法真实存在
 * （1114 的 memo2 用一个空格把两半接在一起）。
 */
const segmentsOf = (sentence: string, inherited: Verb): { verb: Verb; text: string }[] => {
  const out: { verb: Verb; text: string }[] = []
  let verb: Verb = inherited
  // 除标点外还在「空格 + 动词」处断句：memo2 里有整句只用空格分隔的写法
  // （687「…12.7cm连装炮B型改二 废弃10cm连装高角炮 ×5、94式高射装置 ×1 准备开发资材50个」），
  // 不断的话整块会被前面的「旗舰」占住，废弃项一条都收不到。
  // 只在动词前断，名字自带的空格（「三式战 飞燕」）不受影响。
  const chunks = sentence
    .split(/[，,、；;：:及和与與並并]/)
    .flatMap((part) => part.split(/\s+(?=废弃|廢棄|拆解|销毁|銷毀|准备|準備|备好|備好|装备|裝備|配备|配備|编入|編入)/))
  for (const chunk of chunks) {
    const parts = chunk.split(PREPARE_VERB)
    parts.forEach((text, index) => {
      // 「准备」之后的半块归准备；但**下一块要重新认动词**——
      // 正文里「准备…，废弃…」这个顺序是常态（1152/1153/1154 都是），
      // 一旦进了准备就再也不看动词，后面的废弃项会整段丢掉。
      if (index > 0) {
        verb = 'prepare'
      } else {
        const scrapAt = text.search(SCRAP_VERB)
        const otherAt = text.search(OTHER_VERB)
        if (scrapAt >= 0 && (otherAt < 0 || scrapAt < otherAt)) verb = 'scrap'
        else if (otherAt >= 0) verb = 'other'
      }
      if (!text) return
      out.push({ verb, text: text.replace(SCRAP_VERB, '') })
    })
  }
  return out
}

/** 段里的名字候选：引号包起来的优先；没有引号就把数量与类别后缀剥掉，整段当一个名字试。 */
const namesIn = (text: string): { names: string[]; alt: boolean; quoted: boolean } => {
  const quoted = [...text.matchAll(/[「『【“"]([^」』】”"]+)[」』】”"]/g)].map((m) => m[1])
  if (quoted.length) return { names: quoted, alt: false, quoted: true }
  const bare = text
    .normalize('NFKC')
    // 数量写在名字**前面**也有（1123「废弃2个九七式舰攻（九三一空）」），前后各剥一次
    .replace(new RegExp(String.raw`^(?:掉|了|不需要的|同样的|同名的?)+`), '')
    .replace(new RegExp(String.raw`^各?${COUNT}\s*${UNIT}`), '')
    .replace(new RegExp(String.raw`各[^0-9一二两兩三四五六七八九十]{0,6}?(?:[×xX*]\s*)?${COUNT}[\s\S]*$`), '')
    .replace(new RegExp(String.raw`\s*[×xX*]\s*${COUNT}[\s\S]*$`), '')
    .replace(new RegExp(String.raw`${COUNT}\s*${UNIT}[\s\S]*$`), '')
    .replace(/(?:类装备|類裝備|系装备|系裝備|兵装|兵裝|装备|裝備|类|類|系)+$/, '')
    .replace(/(?:各|的)+$/, '')
    .trim()
  if (!bare) return { names: [], alt: false, quoted: false }
  // 「九六式陆攻或一式陆攻×3」：两件里凑够 3 个，共用一个计数槽
  const alts = bare.split(/或者|或|または/).map((name) => name.trim()).filter(Boolean)
  return alts.length > 1
    ? { names: alts, alt: true, quoted: false }
    : { names: [bare], alt: false, quoted: false }
}

/** 段里出现的全部数量，按出现顺序。「『瑞雲』×6『彗星』×3」这种不带分隔符的并列要靠它对位。 */
const countsIn = (text: string): number[] =>
  [...text.normalize('NFKC').matchAll(new RegExp(String.raw`[×xX*]\s*${COUNT}`, 'g'))]
    .map((match) => parseCount(match[1]))

const countIn = (text: string): { count: number; distributed: boolean } | null => {
  const normalized = text.normalize('NFKC')
  const each = normalized.match(new RegExp(String.raw`各[^0-9一二两兩三四五六七八九十]{0,6}?(?:[×xX*]\s*)?${COUNT}\s*${UNIT}?`))
  if (each) return { count: parseCount(each[1]), distributed: true }
  const times = normalized.match(new RegExp(String.raw`[×xX*]\s*${COUNT}`))
  if (times) return { count: parseCount(times[1]), distributed: false }
  const withUnit = normalized.match(new RegExp(String.raw`${COUNT}\s*${UNIT}`))
  if (withUnit) return { count: parseCount(withUnit[1]), distributed: false }
  return null
}

export interface DerivedScrapRule {
  tasks: QpTask[]
  /**
   * 口径存疑。方向是**偏紧**（可能少计）：正文用「A 或 B」列举两件时，我们按列举的
   * 那两件共用一个计数槽落地，而不去猜正文是不是想说整个类别。
   * 与编成条件那侧的 approx（未知条件放行 → 偏多）方向相反，但记号与含义一致：
   * 这个数不精确，UI 标 ≈，别当成可交付的凭据。
   *
   * 「系/类/兵装」后缀曾经也走这里，2026-08-21 已由日文原文裁成族级读法，不再标 ≈。
   */
  approx: boolean
  notes: string[]
}

// ---- 仲裁台账（2026-08-21，依据写在这里，别只留结论）----
//
// 「口径分歧」= 同一句正文，另一种读法会算进不同的一批装备。逐条查完之后，
// 大部分是**写法不同、算进去的装备逐件相同**：
//
// · 爆雷/爆雷兵装 → category 15，与 iconType 17 成员逐件相同（实测 17 件）；
//   机枪/机枪兵装 → category 21 ≡ iconType 15（21 件）；
//   机关部强化   → category 17 ≡ iconType 19（5 件）。三处都不是分歧，取 category。
// · 大口径主炮   → category 3 与 iconType 3 只差两件**深海**装备（mstId 1578/1579），
//   滤掉深海之后逐件相同（48 件），对玩家不是分歧。
// · 增设装甲     → 只有 iconType 23 能一键表达（见文件头）。也不是分歧，是唯一解。
//
// 真分歧原有两条，2026-08-21 用**日文原文**（游戏一手）当场裁掉，approx 双双摘除：
//
//   ① 677/Fw4 —— 日文原文三项同式：「「大口径主砲」系装備x4、「水上偵察機」系装備x2、
//      「魚雷」系装備x3を廃棄」。**引号名 + 系 一贯是族级宽集合**，不是那一个 category。
//      裁决：采宽读法。逐族核过主数据（只算 api_sortno>0 的可持有装备）：
//        · 「大口径主砲」系 = category 3，48 件；icon 3 同 48 件 —— 宽窄同一批，无差别。
//        · 「水上偵察機」系 = category 10，24 件（其中 icon 10 的 17 件、icon 50 的 7 件）。
//          这一项恰好是「宽到哪里为止」的反例：**不能**升到 icon 10——
//          icon 10 会把水上爆撃機 14 件一并算进来，那在游戏类别表里是 category 11，
//          另一类装备。族 = 游戏自己的 equiptype 类，就是 category 10。
//        · 「魚雷」系 = 魚雷(category 5，18 件) ∪ 潜水艦魚雷(category 32，13 件) = 31 件，
//          恰好等于 cardType 3。**不含**特殊潜航艇（甲標的 3 件）——它和鱼雷同 icon 5，
//          但在 equiptype 表里是 category 22，是另一类装备；升到 icon 5 会多算这 3 件。
//      **宽读法，待实测复核**：下次这条周任在役时，废弃一件潜水舰鱼雷即可拿到服务器铁证
//      （粗档/达成会不会跟着动）。本机既往两轮达成流水（2026-08-07 / 08-13）里提督废弃的
//      全是普通鱼雷，对宽窄两读法没有区分力，所以账本裁不动、只能靠日文原文。
//
//   ② 1105/Fy7 —— 日文原文「九六式や一式陸攻**等の**陸上攻撃機x3廃棄」。
//      「等の」是类别口径：九六式/一式陆攻只是举例，銀河这类同属陸上攻撃機的照样算数。
//      中文译文把「等」字丢了，才看着像穷举列举两件。裁决：整个「陸上攻撃機」类别
//      （category 47，可持有 27 件）。这一条的依据在中文正文里根本不存在，
//      所以走下方 ARBITRATED 表逐条落地，而不是去改解析器。
//
// 「系/类/兵装」后缀因此不再是「含混」的标志，而是**族级**的标志：
// 名字先按游戏自己的 equiptype 类解析，只有主数据证明这一族跨了多个 category 时
// 才升级（现役只有「魚雷」一例，见 WIDE_FAMILY）。
const WIDENING_SUFFIX = /系装备|系裝備|系|兵装|兵裝|类装备|類裝備|类|類/

/**
 * 「X」系 = 跨 category 的族。**只收主数据能证明跨类的那些**——
 * 猜着往里加等于把别人的装备算进玩家的进度条。
 */
const WIDE_FAMILY: { text: string; types: number[]; why: string }[] = [
  {
    text: '鱼雷',
    types: [5, 32],
    why:
      '「「魚雷」系装備」含潜水舰鱼雷（日文原文裁决，见上）；' +
      '5∪32 在可持有装备里恰好等于 cardType 3，31 件',
  },
]

interface RawEntry {
  names: string[]
  alt: boolean
  count: number
  widened: boolean
}

const WIDE_FAMILY_TYPES = new Map(
  WIDE_FAMILY.map((entry) => [normalizeEquipName(entry.text), entry.types]),
)

/**
 * 一个名字 → 一个废弃目标。
 * `wide` = 正文在这个名字后面写了「系/类/兵装」，按族级读（见仲裁台账）。
 * 整名解不出时再按「/」拆一次：正文用斜杠并列的是**同一类的两个译法**
 * （1116「水上轰炸机/多用途水上机」都指水上爆撃機），而装备名自己也带斜杠
 * （「14inch/45 三連装砲」），所以顺序必须是先整名后拆分，不能反过来。
 */
const resolveTarget = (
  name: string,
  ctx: ScrapRuleContext,
  wide = false,
): QpTask | null | 'skip' => {
  const key = normalizeEquipName(name)
  if (!key) return 'skip'
  // 具体装备优先于道具表：「战斗粮食」既是道具名也是真装备（mstId 145），
  // 先查道具表会把 1139 的第三个子项吃掉。
  const equipId = ctx.equipByName.get(key)
  if (equipId) return { kind: 'scrapEquip', equipId, count: 1 }
  const typeIds = (wide ? WIDE_FAMILY_TYPES.get(key) : undefined) ?? ctx.typeByName.get(key)
  if (typeIds) return ctx.keyOfTypes(typeIds)
  if (ctx.nonEquip.has(key)) return 'skip'
  if (name.includes('/')) {
    const parts = name.split('/').map((part) => resolveTarget(part, ctx, wide))
    const tasks = parts.filter((part): part is QpTask => !!part && part !== 'skip')
    const same = tasks.length === parts.length &&
      tasks.every((task) => JSON.stringify(task) === JSON.stringify(tasks[0]))
    if (same && tasks.length) return tasks[0]
  }
  return null
}

const finalize = (raw: RawEntry[], ctx: ScrapRuleContext): DerivedScrapRule | null => {
  const groups: QpTask[][] = []
  const notes: string[] = []
  let approx = false
  for (const entry of raw) {
    const group: QpTask[] = []
    for (const name of entry.names) {
      const target = resolveTarget(name, ctx, entry.widened)
      if (target === null) return null // 名字解析不出：整条弃用，不留半截追踪器
      if (target === 'skip') {
        // 正文常把要准备的道具/资源直接串在废弃项后面（1141）。跳过，但记一笔。
        notes.push(`跳过道具/资源「${name}」`)
        continue
      }
      group.push({ ...target, count: entry.count } as QpTask)
      if (entry.widened && target.kind !== 'scrapEquip') {
        notes.push(`「${name}」带「系/类/兵装」后缀，按族级读`)
      }
    }
    if (!group.length) continue
    if (entry.alt && group.length > 1) {
      approx = true
      notes.push(`「${entry.names.join(' 或 ')}」按正文列举的两件共用一个计数槽`)
    }
    groups.push(group)
  }
  if (!groups.length) return null
  // 同一个目标在正文里写了两遍：合并，别造出两个槽
  const seen = new Map<string, number>()
  const merged: QpTask[][] = []
  for (const group of groups) {
    const key = group.map((task) => JSON.stringify({ ...task, count: 0 })).join('|')
    const at = seen.get(key)
    if (at !== undefined) {
      merged[at] = merged[at].map((task, index) => ({
        ...task,
        count: Math.max(task.count, group[index]?.count ?? 0),
      }))
      continue
    }
    seen.set(key, merged.length)
    merged.push(group)
  }
  // 槽号显式且连续：备选组共用一格，其余一格一项。留空让下标兜底会在
  // 「备选组占两个下标」时错开一格，进度数组从此串位。
  const tasks: QpTask[] = []
  merged.forEach((group, slot) => {
    for (const task of group) tasks.push({ ...task, slot })
  })
  return { tasks, approx, notes }
}

const parseOne = (text: string, ctx: ScrapRuleContext): DerivedScrapRule | null => {
  if (!text || !SCRAP_VERB.test(text)) return null
  const raw: RawEntry[] = []
  // 动词跨句延续：正文经常把一份废弃清单拆到两句里
  // （691「废弃『中口径主炮』系装备×4、『副炮』系装备×4。『机枪』系装备×4，准备好1600铝材！」）。
  // 每句各自重置的话，第二句那一项会整条丢掉——分母偏小、进度虚高，比没有追踪器更坏。
  let verb: Verb = 'none'
  for (const sentence of text.split(/[。．！!？?\n]/)) {
    if (!sentence.trim()) continue
    // 建议/说明句不得产生任务：「其中的爆雷兵装推荐选择…」曾让原型多出一条
    // （同族的坑在出击类里踩过：「6-4建议携带秋津洲」被当成要打 6-4）。
    if (ADVICE_SENTENCE.test(sentence)) continue
    const segments = segmentsOf(sentence, verb)
    verb = segments.length ? segments[segments.length - 1].verb : verb
    // 动词写在名字**后面**的写法（1116「『A』『B』『C』各废弃3个」）：只有这一句
    // 在动词之前没出现过别的动词时才敢往前收，否则会把「旗舰X的第一格装备Y，废弃Z」
    // 里的 Y 也当成要废弃的（1140 实测会中招）。
    const firstVerbIndex = segments.findIndex((segment) => segment.verb !== 'none')
    const adoptable = firstVerbIndex >= 0 && segments[firstVerbIndex].verb === 'scrap'
    let pending: Pending[] = []
    let seenScrap = false
    for (const segment of segments) {
      const active = segment.verb === 'scrap' || (segment.verb === 'none' && adoptable && !seenScrap)
      if (segment.verb === 'scrap') seenScrap = true
      if (!active) {
        if (segment.verb !== 'none') pending = []
        continue
      }
      const { names, alt, quoted } = namesIn(segment.text)
      const count = countIn(segment.text)
      const widened = WIDENING_SUFFIX.test(segment.text.normalize('NFKC'))
      // 「『瑞雲』×6『彗星』×3」——名字与数量交替、中间不带分隔符（654/696 都是这么写的）。
      // 名字数与数量数相等且都不是「各」时按位配对；否则走下面的常规流程。
      const inline = countsIn(segment.text)
      if (!alt && !pending.length && names.length > 1 && inline.length === names.length && !count?.distributed) {
        names.forEach((name, index) => {
          raw.push({ names: [name], alt: false, count: inline[index], widened })
        })
        continue
      }
      // 引号并列的是**各自一项**（1120「『舰战』『舰爆』『舰攻』各×4」= 三个计数槽）；
      // 只有「A 或 B」那种备选才共用一格。早期把并列也塞进一格，三项进度会挤在一个槽里。
      if (alt) pending.push({ names, alt: true, quoted, count: null })
      else for (const name of names) pending.push({ names: [name], alt: false, quoted, count: null })
      if (!count) continue
      if (count.distributed) {
        // 「各 N」只结算到此为止还没拿到数量的项：1161 一句里有两组，各结各的
        for (const item of pending) {
          if (item.count == null) {
            raw.push({ names: item.names, alt: item.alt, count: count.count, widened })
            item.count = count.count
          }
        }
        pending = []
      } else {
        const last = pending[pending.length - 1]
        if (last && last.count == null) {
          raw.push({ names: last.names, alt: last.alt, count: count.count, widened })
          last.count = count.count
          pending = pending.slice(0, -1).filter((item) => item.count == null)
        }
      }
    }
    // 句子读完还有没拿到数量的废弃项 = 这一句我们没读懂（687 desc 的「一座『94式高高射装置』」
    // 就是量词没认出来）。宁可整条弃用，也不能交一份缺子项的清单出去。
    // 判定谁算「没读懂」：
    // - 道具/资源不算（660 句尾的「※…需要『熟练搭乘员』」本来就不是废弃项）；
    // - 引号点名的算——正文明确点了这件东西，我们却没读出数量；
    // - 没引号但解析得出真目标的也算；
    // - 剩下的散文（673 memo2「批量拆解也可以」、696 memo2「任务完成后材料消耗」）不算。
    const stranded = pending.filter((item) => {
      if (item.count != null) return false
      const targets = item.names.map((name) => resolveTarget(name, ctx))
      if (targets.every((target) => target === 'skip')) return false
      return item.quoted || targets.some((target) => target && target !== 'skip')
    })
    if (stranded.length) return null
  }
  return raw.length ? finalize(raw, ctx) : null
}

// ---- 仲裁落地：日文原文写了、中文译文里根本不存在的那一条 ----
//
// 只收「信息在中文正文里查无此物」的情形。正文解得出来的一律走解析器——
// 把解析器也能解的东西钉成表，表和解析器会悄悄分叉，改了一边另一边还绿。
// 类别一律按**名字**经主数据解析，不写编号：主数据换代时是「查不到、退回解析器」，
// 而不是「编号还在、指向变了却没人发现」。
const ARBITRATED: Record<number, { typeName: string; count: number; why: string }> = {
  1105: {
    typeName: '陸上攻撃機',
    count: 3,
    why:
      '日文原文「九六式や一式陸攻等の陸上攻撃機x3廃棄」——「等の」是类别口径，' +
      '中文译文丢了「等」字才像穷举两件；銀河这类同属陸上攻撃機的照样算数',
  },
}

/**
 * 从中文任务正文推导废弃清单。
 * desc 与 memo2 各解一遍取更完整的那份：两者互有残缺（1130 的 desc 是空的，
 * 1153 的 desc 把「九四式爆雷投射机」写成了「炸弹投射机」，而 660 的 memo2
 * 只有注意事项没有清单）。谁解得出更多子项就用谁，同分取 memo2。
 */
export const deriveScrapRule = (
  desc: string,
  memo2: string,
  ctx: ScrapRuleContext | null,
  questId?: number,
): DerivedScrapRule | null => {
  if (!ctx) return null
  const ruling = questId ? ARBITRATED[questId] : undefined
  if (ruling) {
    const target = ctx.keyOfTypes(ctx.typeByName.get(normalizeEquipName(ruling.typeName)) ?? [])
    // 主数据里查不到这个类别名（换代/改名）就别硬套裁决，退回解析器按正文来
    if (target) {
      return {
        tasks: [{ ...target, count: ruling.count, slot: 0 } as QpTask],
        approx: false,
        notes: [ruling.why],
      }
    }
  }
  const fromDesc = parseOne(`${desc ?? ''}`, ctx)
  const fromMemo = parseOne(`${memo2 ?? ''}`, ctx)
  if (!fromDesc) return fromMemo
  if (!fromMemo) return fromDesc
  return fromMemo.tasks.length >= fromDesc.tasks.length ? fromMemo : fromDesc
}
