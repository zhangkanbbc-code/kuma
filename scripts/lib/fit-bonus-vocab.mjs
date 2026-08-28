// 装备加成的**名字词表**：把 zh.kcwiki「模块:舰娘装备数据改」的中文名字空间
// 翻成 kuma 自己的 id 空间（形态 mstId / 舰级 api_ctype / 舰种 api_stype）。
//
// 为什么要有这一层：上游那张表的 `适用舰娘` 是**人写的中文名**，504 个不同取值。
// 其中绝大多数能靠三条机器规则落地（见下 `resolveShipToken`）：
//   ① 舰娘中文名 → 该形态的 mstId；
//   ② 舰级名（写作「◯◯级」，而 kcwiki 的 `级别[0]` 写作「◯◯型」）→ api_ctype；
//   ③ 舰种名 → api_stype。
// ①里的形态名两侧都收（kcwiki 中文名 + 主数据日文名），后者专治 Norge / Eidsvold /
// Graf Zeppelin 这类只有拉丁名的形态。剩下**17 个**是机器规则落不了地的：
// 舰种别名（轻型航母/正规航母/潜艇…）、上游自造的细分舰种（防空巡洋舰/轻航空巡洋舰/
// 兵装实验轻巡洋舰/改装航空巡洋舰/改装航空战列舰）、伪类目（全部舰船/其他阳炎型/
// 其他白露型/阳炎型改二）。那 17 条逐条写在下面的 `FIT_BONUS_NAME_VOCAB` 里，
// **每条都带依据**。
//
// ---- 本词表最关键的一条语义：`适用舰娘` 是「精确形态」，不是「整条改造链」----
//
// EO 的 `shipX`（精确形态）与 `shipS`（链首 id，全形态生效）搞反会让加成套错舰，
// 所以这条必须有实证，不能靠语感。实证在上游表自己身上——它**逐形态列举**：
//   · 106 号（試製15.5cm三連装砲改）额外收益2 写的是
//     「矢矧、矢矧改、矢矧改二、矢矧改二乙、霞、霞改、霞改二、霞改二乙、雪风、雪风改、
//       丹阳、雪风改二、矶风、矶风改、矶风乙改、滨风、滨风改、滨风乙改、…」；
//   · 140 号（15m二重測距儀+21号電探改二）额外收益 写「比睿、比睿改、比睿改二、
//     雾岛、雾岛改、雾岛改二」，额外收益2 单独写「比睿改二丙」并给不同的值；
//   · 144 号（試製51cm連装砲）把「翔鹤、翔鹤改」与「翔鹤改二、翔鹤改二甲」拆成两行，
//     两行的数值不同——按「链首=全形态」读，这两行会重叠，数值就自相矛盾。
// 全表按「链首=全形态」假设跑一遍，同一装备的不同行会产生 549 对重叠；
// 按「精确形态」假设则只剩 300 对，且那 300 对全是**条件不同的叠加行**
//（同一形态一行给改修分档、一行要求同时带电探），本来就该并存。
// 结论：一律按精确形态解析；本源**没有**「整条链」这种写法，
// schema 里的 `chains` 槽留着给第二批的面板反推与自补层用。

/**
 * 收益属性 → 第一方字段名。
 *
 * 刻意不沿用 `api_mst_slotitem` 的缩写（houg/raig/…）：产出物是我们自己的 schema，
 * 字段名自定，读的人不必先去背一张游戏内部缩写表。射程在上游是字符串（"1" = 抬一档）。
 */
export const FIT_BONUS_STAT_KEYS = Object.freeze({
  火力: 'fire',
  雷装: 'torpedo',
  爆装: 'bomb',
  对空: 'aa',
  装甲: 'armor',
  回避: 'evasion',
  对潜: 'asw',
  索敌: 'los',
  命中: 'accuracy',
  射程: 'range',
})

/** 收益类型 → 第一方名字。 */
export const FIT_BONUS_GAIN_KINDS = Object.freeze({
  通用: 'flat',
  改修: 'byStar',
  数量: 'byCount',
  区域: 'byArea',
})

/**
 * 出击区域限定收益（`收益类型:区域`）。整张表只有一条：268 号「北方迷彩(+北方装備)」。
 * 值是区域名，不是海域号——上游没给号，我们也不猜。
 */
export const FIT_BONUS_AREA_KEYS = Object.freeze({
  北方: 'north',
})

/**
 * `装备组合` 里那些**不是具名装备而是类目**的写法。
 *
 * 上游用「/」当同义词分隔（雷达＝电探），不是「或」——所以整串当一个类目键读。
 * 这里只给稳定键与原文，**不展开成 id 列表**：类目的判据（多少索敌算对水面电探）
 * 上游没写，我们也不替它拍板；留给第二批的面板反推去定，schema 里有 `equipGroups` 槽。
 */
export const FIT_BONUS_EQUIP_GROUPS = Object.freeze({
  '对水面雷达/电探': { key: 'radar-surface', zh: '对水面电探' },
  水上电探: { key: 'radar-surface', zh: '对水面电探' },
  '对空雷达/电探': { key: 'radar-aa', zh: '对空电探' },
  对空电探: { key: 'radar-aa', zh: '对空电探' },
  '精准对水面雷达/电探': { key: 'radar-surface-precise', zh: '高精度对水面电探' },
  对空机枪: { key: 'aa-gun', zh: '对空机铳' },
})

/**
 * 机器规则落不了地的 22 个名字。**每条都带依据**，改之前先看 `why`。
 *
 * kind 的含义：
 *   · `stype`        → api_stype 舰种（全形态）
 *   · `className`    → 交给舰级层解析这个名字（kcwiki `级别[0]`）
 *   · `wikiShipType` → kcwiki 自己那套 `舰种` 编号（它比 api_stype 多三档细分）
 *   · `classForms`   → 某舰级中，形态名满足条件的那些形态
 *   · `classRest`    → 某舰级中，**本装备其他条件行没有点名**的其余形态（「其他◯◯型」）
 *   · `all`          → 全部舰船
 *
 * `sibling` 是**自失效护栏**：该词只在与某个父类目同行出现时才有确定含义
 *（它是父类目的子集，同行时并集不变）。哪天上游单独用了它，转换器会报错要求重裁，
 * 而不是继续按一个只在旧用法下成立的解释往下算。
 */
export const FIT_BONUS_NAME_VOCAB = Object.freeze({
  // ---- 舰种别名：上游的叫法与 api_mst_stype 的日文名/我们的译名都对不上 ----
  轻型航母: { kind: 'stype', stypes: [7], why: 'api_mst_stype 7「軽空母」；上游按“轻型航母”叫' },
  正规航母: { kind: 'stype', stypes: [11], why: 'api_mst_stype 11「正規空母」' },
  装甲航母: { kind: 'stype', stypes: [18], why: 'api_mst_stype 18「装甲空母」' },
  战列舰: { kind: 'stype', stypes: [9], why: 'api_mst_stype 9「戦艦」' },
  战列巡洋舰: {
    kind: 'stype',
    stypes: [8],
    why:
      'api_mst_stype 8 的 api_name 现在也写「戦艦」（与 9 号重名），但它就是巡洋戦艦那一档：' +
      '本机主数据里 8 号 48 艘全是金刚型系与海外巡战，kcwiki 的 舰种=8 同一批人',
  },
  航空战列舰: { kind: 'stype', stypes: [10], why: 'api_mst_stype 10「航空戦艦」' },
  潜艇: { kind: 'stype', stypes: [13], why: 'api_mst_stype 13「潜水艦」' },
  航空潜艇: { kind: 'stype', stypes: [14], why: 'api_mst_stype 14「潜水空母」' },

  // ---- 上游自造的细分舰种：都是某个 api 舰种的真子集 ----
  //
  // 判定依据是 kcwiki 自己的 `舰种` 编号：它在 api 的 22 档之外多编了 23/24/25 三档，
  // 三档的成员在 api 侧分别落在 stype 3 / 6 / 3。用上游自己的编号解释上游自己的用词，
  // 比我们替它猜可靠。
  轻航空巡洋舰: {
    kind: 'wikiShipType',
    value: 23,
    sibling: '轻巡洋舰',
    why: 'kcwiki 舰种 23 = 哥特兰系（api_stype 3 的子集）；7 处用例都与「轻巡洋舰」同行',
  },
  兵装实验轻巡洋舰: {
    kind: 'wikiShipType',
    value: 25,
    sibling: '轻巡洋舰',
    why: 'kcwiki 舰种 25 = 夕张改二/改二特/改二丁（api_stype 3 的子集）；7 处用例都与「轻巡洋舰」同行',
  },
  改装航空巡洋舰: {
    kind: 'wikiShipType',
    value: 24,
    sibling: '航空巡洋舰',
    why:
      'kcwiki 舰种 24 = 最上改二/三隈改二/最上改二特（api_stype 6 的子集）；' +
      '3 处用例都与「航空巡洋舰」同行，两者并集正好等于 api_stype 6',
  },
  防空巡洋舰: {
    kind: 'className',
    name: '亚特兰大型',
    sibling: '轻巡洋舰',
    why:
      '游戏自己的日文原文实锤：Atlanta 的入手台词写「あたしは、Atlanta級防空巡洋艦、Atlanta」。' +
      '该级在 api 侧是 stype 3 的子集，7 处用例都与「轻巡洋舰」同行',
  },
  改装航空战列舰: {
    kind: 'stype',
    stypes: [10],
    sibling: '航空战列舰',
    why:
      'kcwiki 自己的 舰种 表里没有独立分组——舰种 10 的 9 艘（伊势改/日向改/扶桑改/山城改/' +
      '扶桑改二/山城改二/伊势改二/日向改二/大和改二重）本来就全是改装形态，与「航空战列舰」同域。' +
      '3 处用例都与「航空战列舰」同行，并集不变；哪天单独出现就会被 sibling 护栏拦下重裁',
  },

  // ---- 伪类目 ----
  全部舰船: { kind: 'all', why: '529 号 额外收益19：带对空电探时全舰通用 +对空2+回避2' },
  阳炎型改二: {
    kind: 'classForms',
    className: '阳炎型',
    nameIncludes: '改二',
    why: '阳炎型（api_ctype 30）中形态名含「改二」的那些；529 号用它并在 非适用舰娘 里单独剔掉秋云改二',
  },
  其他阳炎型: {
    kind: 'classRest',
    className: '阳炎型',
    why:
      '「其他」是相对**同一装备的其他条件行**说的：529 号把时雨改三/春雨改二/雪风改二/丹阳/' +
      '雪风/矶风乙改等逐条单列，剩下的归这一行。转换时按“本级全体减去本装备其他行点名的形态”展开',
  },
  其他白露型: {
    kind: 'classRest',
    className: '白露型',
    why: '同「其他阳炎型」，529 号的白露型那一行',
  },
})

/** 名字里的全角/半角与空白差异先抹平，再谈匹配。 */
export const normalizeFitBonusName = (value) =>
  `${value ?? ''}`
    .normalize('NFKC')
    .replace(/[（）]/g, (ch) => (ch === '（' ? '(' : ')'))
    .replace(/\s+/g, '')
    .trim()

/**
 * 名字解析器。
 *
 * @param {object} deps
 * @param {Array} deps.masterShips  api_mst_ship（友方形态，api_id < 1500 且 api_sortno > 0）
 * @param {Array} deps.masterStypes api_mst_stype
 * @param {Array} deps.kcwikiShips  kcwiki「模块:舰娘数据」的行（含 中文名 / 级别 / 舰种）
 * @param {(text: string) => string} deps.fold 简繁日字形折叠（仓库现成的 cjk-fold）
 */
export const createFitBonusNameResolver = ({ masterShips, masterStypes, kcwikiShips, fold }) => {
  const key = (value) => fold(normalizeFitBonusName(value))

  const shipById = new Map(masterShips.map((ship) => [Number(ship.api_id), ship]))

  // ① 形态名 → mstId。中文名（kcwiki）与日文名（主数据）都收，
  //    日文那一路专门救 Norge / Eidsvold / Graf Zeppelin 这类拉丁名。
  const formsByName = new Map()
  const addForm = (name, id) => {
    if (!name || !(id > 0) || !shipById.has(id)) return
    const k = key(name)
    const list = formsByName.get(k) ?? []
    if (!list.includes(id)) list.push(id)
    formsByName.set(k, list)
  }
  for (const row of kcwikiShips) addForm(row?.['中文名'], Number(row?.ID))
  for (const ship of masterShips) addForm(ship?.api_name, Number(ship?.api_id))

  // ② 舰级名 → api_ctype。kcwiki 的 `级别[0]` 写「◯◯型」，
  //    而 `适用舰娘` 写「◯◯级」——两种写法都进索引，省得调用方去猜。
  const ctypesByClassName = new Map()
  const classNameOfCtype = new Map()
  const addClass = (name, ctype) => {
    if (!name || !(ctype > 0)) return
    for (const variant of new Set([key(name), key(`${name}`.replace(/型$/, '级'))])) {
      const set = ctypesByClassName.get(variant) ?? new Set()
      set.add(ctype)
      ctypesByClassName.set(variant, set)
    }
  }
  const membersOfCtype = new Map()
  for (const ship of masterShips) {
    const ctype = Number(ship.api_ctype)
    if (!(ctype > 0)) continue
    membersOfCtype.set(ctype, [...(membersOfCtype.get(ctype) ?? []), Number(ship.api_id)])
  }
  for (const row of kcwikiShips) {
    const ctype = Number(shipById.get(Number(row?.ID))?.api_ctype)
    const name = row?.['级别']?.[0]
    addClass(name, ctype)
    if (name && ctype > 0 && !classNameOfCtype.has(ctype)) classNameOfCtype.set(ctype, name)
  }

  // ③ 舰种名 → api_stype（日文原名；中文别名走词表）
  const stypesByName = new Map()
  for (const type of masterStypes) {
    const k = key(type?.api_name)
    if (!k) continue
    stypesByName.set(k, [...(stypesByName.get(k) ?? []), Number(type.api_id)])
  }

  // ④ kcwiki 自己那套 舰种 编号 → 形态集合（词表里的 wikiShipType 用）
  const formsByWikiShipType = new Map()
  for (const row of kcwikiShips) {
    const id = Number(row?.ID)
    const wikiType = Number(row?.['舰种'])
    if (!(id > 0) || !(wikiType > 0) || !shipById.has(id)) continue
    formsByWikiShipType.set(wikiType, [...(formsByWikiShipType.get(wikiType) ?? []), id])
  }

  const classCtypes = (name) => [...(ctypesByClassName.get(key(name)) ?? [])]

  /**
   * 一个名字 → 归属。返回 null 表示落不了地（调用方负责挂台账，不许静默丢）。
   * `classRest` 要等同装备其他行都解析完才能展开，所以这里只把意图原样返回。
   */
  const resolve = (rawName) => {
    const name = normalizeFitBonusName(rawName)
    const k = key(name)

    const forms = formsByName.get(k)
    if (forms?.length) return { kind: 'forms', forms: [...forms], via: 'ship-name' }

    const ctypes = ctypesByClassName.get(k)
    if (ctypes?.size) return { kind: 'classes', classes: [...ctypes], via: 'class-name' }

    const stypes = stypesByName.get(k)
    if (stypes?.length) return { kind: 'types', types: [...stypes], via: 'stype-name' }

    const manual = FIT_BONUS_NAME_VOCAB[name] ?? FIT_BONUS_NAME_VOCAB[rawName]
    if (!manual) return null
    switch (manual.kind) {
      case 'stype':
        return { kind: 'types', types: [...manual.stypes], via: 'vocab', sibling: manual.sibling }
      case 'className': {
        const hit = classCtypes(manual.name)
        if (!hit.length) return null
        return { kind: 'classes', classes: hit, via: 'vocab', sibling: manual.sibling }
      }
      case 'wikiShipType': {
        const hit = formsByWikiShipType.get(manual.value) ?? []
        if (!hit.length) return null
        return { kind: 'forms', forms: [...hit], via: 'vocab', sibling: manual.sibling }
      }
      case 'classForms': {
        const hit = classCtypes(manual.className)
        if (!hit.length) return null
        const wanted = key(manual.nameIncludes)
        const picked = hit
          .flatMap((ctype) => membersOfCtype.get(ctype) ?? [])
          .filter((id) => key(shipById.get(id)?.api_name).includes(wanted))
        if (!picked.length) return null
        return { kind: 'forms', forms: picked, via: 'vocab', sibling: manual.sibling }
      }
      case 'classRest': {
        const hit = classCtypes(manual.className)
        if (!hit.length) return null
        return { kind: 'classRest', classes: hit, via: 'vocab' }
      }
      case 'all':
        return { kind: 'all', via: 'vocab' }
      default:
        return null
    }
  }

  return {
    resolve,
    membersOfCtype: (ctype) => [...(membersOfCtype.get(ctype) ?? [])],
    classNameOfCtype: (ctype) => classNameOfCtype.get(ctype) ?? '',
    hasForm: (id) => shipById.has(Number(id)),
    stypeIds: new Set(masterStypes.map((type) => Number(type.api_id))),
    ctypeIds: new Set(membersOfCtype.keys()),
  }
}
