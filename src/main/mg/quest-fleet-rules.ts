// 铭 · 编成条件的自研推导。
//
// 计数那一轴（打哪张图、几次、什么评价）由 quest-sortie/practice/mission-rules 解出来；
// 这个模块解的是另一半——**这一队编成得长什么样**才算数。
// 产出是引擎既有的 `QpFleetGoal`（`groups` 的合取），判定走同一个 `evaluateFleetGoal`，
// 与 kcwiki 源共用一份；不另造第二种形状。
//
// 认得出四种「要求」，逐档加上去的：
//  · 舰种数量（「轻巡1+驱逐3」「以航空母舰为旗舰」）→ `stypes`；
//  · 具名舰与旗舰（「以时雨改三为旗舰」「含白露改二」）→ `ships` + `flagship`；
//  · 舰级（「秋月型」「吹雪级」）→ `ctypes`；
//  · 凑数与国籍（「四选二」「美英澳荷舰娘3艘」）→ 一个组装下并集，`amount` 就是 N。
//
// **位置（几号舰）一概不做**：引擎的 `position` 只表达得了「第 N 号位必须是某某」，
// 而正文里的位置要求几乎都带「顺序可互换」（B130 的长门/陆奥）或「另一只置于2号舰」
// （Cy7），是 EO 用 Group-or 编的形状，`groups` 的合取装不下。落一半会把门装严，
// 所以只留旗舰那一维——那一维是「1号位」的安全子集。
//
// ## 安全方向：只往松了裁
//
// 编成门错在两个方向的后果**完全不对称**：
//  · 门比实际松 → 有些不该算的编成也计了数 → 计数偏多 → 这正是 `approx`（UI 的 ≈）的语义；
//  · 门比实际严 → **游戏计了、我们拦了** → 进度条永远差一格，玩家看着以为没打够。
// 后者是硬伤，前者是已标注的不确定。所以本模块的每一条取舍都朝「松」的方向倒：
//  · 舰种词一律取**最宽**的合理解释（「轻巡级」→ 轻巡/雷巡/练巡三种，不是只认轻巡）；
//  · 读不准的原子一律**丢掉**（少一个组＝门更松），绝不猜一个更严的；
//  · 组间的「或」（「海防舰3艘 或 驱逐舰4艘」）引擎表达不了 → 整条门弃用，不硬编一半。
//
// ## 正文优先级：desc 先、memo2 后
//
// 与计数轴相反。计数轴上 memo2 是攻略体、写得比 desc 规整；编成轴上恰好倒过来——
// memo2 是玩家的速记，会把游戏接受的范围写窄：C33 的 memo2 写「3正规空母」，
// 游戏实际接受轻空母/装甲空母（desc 写的是「航空母舰3只」，与游戏一致）。
// **速记写窄 = 门变严 = 会拦住游戏算了的编成**，正是上面那条硬伤。
// 所以编成轴以 desc 为准，desc 解不出才退回 memo2。
//
// ## 正文里的队名：查 shared/hist-fleets，不靠 memo2 补名单
//
// 正文写「派出「第八驱逐队」出击」时，成员名单在**第一方馆藏** `shared/hist-fleets` 里，
// 不再指望 kcwiki 的攻略注（memo2）替游戏正文补。三条口径：
//  · 期别按注册表自己的 `questRefs` 裁，裁不出来落最宽的并集并标 ≈，**永不默认选最新的一期**；
//  · **正文自己列了成员就以正文为准**，队名不再另立一组（见 demoteAppositionSquads）；
//  · 队名在门里只回答「这支队有谁」，几艘、旗不旗仍由正文解 —— 注册表不许变成第二套规则表。
//
// 顺带的实测更正：接入前以为「47 条门全靠 memo2 撑着」，逐条量下来 **44 条的门其实来自
// `kcwiki-quest-req` 规则包**（第一规则源），根本没走这个模块；真正落在自研这一侧、
// 需要队名解析的只有 B157 / B209 / 2606Cm1 / F136 那几条。注册表对那 44 条的作用是
// **对账票**（逐条覆盖核对写在 test/quest-selfderive.test.mjs 的 HIST_FLEET_RECONCILE），
// 不是改源 —— 上游有的一律不覆盖，那是「只填空位」这条纪律。
//
// ## 舰种词的出处
//
// 一手主数据 `api_mst_stype`（日文名）+ `kcwiki-localization.entities.shipType`（中文名）
// 合成基础索引，再补一张**口语别名表**（「轻巡」「空母系」「输送舰」「DD」这些正文里
// 真出现过的写法）。别名表只做「词 → 舰种号」的对位，不含任何任务级的编码。
import { foldCjkVariants } from '../../shared/cjk-fold'
import { HIST_FLEETS, memberFormIds } from '../../shared/hist-fleets'
import { shipNationalityIdFromSortId } from '../../shared/ship-nationality'
import { buildShipRemodelChains } from '../../shared/ship-remodel-chain'
import { augmentShipGroupsFromQuestText, buildKcwikiRuleContext } from './kcwiki-quest-rules'

import type { HistFleetEntry } from '../../shared/hist-fleets'
import type { QpFleetGoal, QpFleetGoalGroup } from '../../shared/qp-types'

/**
 * 口语别名 → 舰种号。值是**最宽**的合理解释（见文件头「安全方向」）。
 *
 * **不收两字母的舰种缩写**（DD/CL/CA/AO/AR…）：正文里的拉丁字母大多是舰名
 * （Ark Royal、Samuel B.Roberts、Gotland andra），两字母缩写会从舰名当中割出来
 * ——实测「Ark Royal」被认成 AR（工作舰）+ AR，Cy1 因此凭空长出一道工作舰门。
 * 用到缩写的正文（2606Bm1 的「AO、LHA均可」）同一句里都另有中文写法，不吃亏。
 *
 * 导出是给护栏用的：`shared/ship-type-name.ts` 把日文舰种词译成中文时，
 * 译出来的词必须是这里已有的键、且语义不窄于原词——那就证明中文这一半没有另立新说法。
 */
export const STYPE_ALIASES: Record<string, number[]> = {
  海防: [1], 海防舰: [1],
  驱逐: [2], 驱逐舰: [2],
  轻巡: [3], 轻巡洋舰: [3],
  雷巡: [4], 重雷装巡洋舰: [4],
  // 「重巡」含航巡：B87 的 memo2 自注「航巡可代替重巡」，EO 在 By8/Cy5 也一律编 [5,6]。
  // 按字面只认 [5] 会把四航巡的合规编成拦下。
  重巡: [5, 6], 重巡洋舰: [5, 6],
  航巡: [6], 航空巡洋舰: [6],
  轻空母: [7], 轻母: [7], 轻航母: [7],
  // 「战舰」不写「航空」时把航空战舰一起算：2605B3 的正文写「88级以上的战舰2只」，
  // 游戏实际接受大和改二重（航空战舰）+ 武藏改二 这一队，账本里 63 次真出击都是这么打的。
  // 按 api_mst_stype 的字面（8/9）落地会把它们全拦下——这正是「门比游戏严」的硬伤。
  战舰: [8, 9, 10], 战列舰: [8, 9, 10],
  航战: [10], 航空战舰: [10], 航空战列舰: [10],
  正规空母: [11], 正规母舰: [11], 正规航母: [11],
  // 「潜水舰」一律含潜水空母：B17 的正文写「伊号潜水艇2艘」，伊58改 这类是潜水空母（14），
  // 游戏一贯把它们算进潜水艦要求；按 api_mst_stype 的字面（13）落地就会把它们拦掉。
  潜艇: [13, 14], 潜水舰: [13, 14], 潜水艇: [13, 14],
  潜水空母: [14], 潜母: [14],
  水母: [16], 水上机母舰: [16], 水上机母: [16],
  扬陆舰: [17], 登陆舰: [17],
  装甲空母: [18], 装母: [18],
  工作舰: [19],
  潜水母舰: [20],
  练巡: [21], 练习巡洋舰: [21],
  补给舰: [22],
  // ---- 族名：一律取最宽 ----
  // 「空母」不写「正规」时，游戏一贯把轻空母/装甲空母一起算（B49 的 memo2 反过来
  // 写「轻空母不可」是那一条自己的额外限制，不是「空母」这个词的含义）。
  空母: [7, 11, 18], 航空母舰: [7, 11, 18], 空母系: [7, 11, 18], 空母级: [7, 11, 18],
  正规空母系: [7, 11, 18], 航母: [7, 11, 18], 航空母舰系: [7, 11, 18],
  // 「轻巡级/系」把雷巡与练巡都算进来（B127 的 memo2 自注「雷巡可行」，
  // Cy3 的 desc 自注「雷巡除外」——两种都有，取宽的那种，见文件头）。
  轻巡级: [3, 4, 21], 轻巡系: [3, 4, 21], 轻巡洋舰级: [3, 4, 21],
  重巡级: [5, 6], 重巡系: [5, 6], 重巡洋舰级: [5, 6],
  // 输送/运输：LHA 与 AO 两种，正文里两个词混用（2606Bm1 的 memo2 自注「AO、LHA均可」）。
  // 不收「输送船」——「输送船团演习」里的「输送船团」是队名不是舰种（C37 实测多长出一道门）。
  输送舰: [17, 22], 运输舰: [17, 22],
}

/** 正文里出现在舰种词位置、但不是「要求」的词——见到就跳过，不当原子。 */
const FREE_TOKENS = ['自由舰', '任意舰', '其他舰', '其它舰', '他舰']

export interface FleetRuleContext {
  /** 归一后的舰种词 → 舰种号；认不出返回 null */
  stypeIdsOf: (token: string) => number[] | null
  /**
   * 归一后的舰名 → 该名字在判定里代表哪些形态。
   *
   * **形态口径与 kcwiki 源同一份**（2026-08-18 用户两轮实锤定谳，见 kcwiki-quest-rules）：
   * 素名（链根，「時雨」「扶桑」）＝任意形态；写明形态（「白露改」）＝**只认写明的**。
   * 写明形态的追加形态由 `augmentShipGroupsFromQuestText` 按正文列举补入，
   * 这里一个结构推断都不做。
   */
  shipIdsOf: (name: string) => number[] | null
  /** 归一后的舰名 → 它所属的舰级号（「秋月型」「吹雪级」这类引用） */
  ctypeOf: (name: string) => number | null
  /** 指定国籍（ship-nationality id）的全部舰娘 mstId。国籍按 api_sort_id 编号段判定，
   *  与装备加成、图鉴筛选共用 shared/ship-nationality 那一份，不另立一套 */
  nationalityShips: (natIds: number[]) => number[]
  /** 该形态起前向可达的全部形态（不含自身）——只在正文明说「改二也可」时才用 */
  laterForms: (mstId: number) => number[]
  /** 按正文**列举**的舰名补入追加形态（与 kcwiki 源共用同一台机器，口径只有一份） */
  augmentFromText: (draft: { fleetGoal?: QpFleetGoal }, questText: string) => void
  /**
   * 归一后的**队名** → 史实编队候选（`shared/hist-fleets` 那一份第一方馆藏）。
   * 同名多期时把候选全给出来，选哪一期由调用方按注册表自己的 `questRefs` 裁——
   * 这个函数只认名字，不认任务。查不到返回 null。
   */
  histFleetsOf: (token: string) => readonly HistFleetEntry[] | null
  /** 候选条目的成员展开成 mstId：素名整链、写明形态只认列举、未实装的一位直接跳过 */
  histFleetShips: (entries: readonly HistFleetEntry[]) => number[]
  /** 索引里最长的词有多少字（最长匹配扫描用） */
  maxTokenLength: number
}

/**
 * 队名索引的最短钥匙：**三字起**。
 * 两字缩写（「二驱」「七驱」）单独出现时歧义太大，与 STYPE_ALIASES 不收 DD/CL/CA 同源；
 * 三字起的「二七驱」「四水战」才收。
 */
const HIST_FLEET_MIN_KEY = 3

/** 正文与索引走同一把钥匙：NFKC → 简繁日折叠 → 去括号空白 → 小写 */
const foldToken = (raw: string): string =>
  foldCjkVariants(`${raw ?? ''}`.normalize('NFKC'))
    .replace(/[\s「」『』【】（）()[\]“”"'’·]/g, '')
    .toLowerCase()

export const buildFleetRuleContext = (
  masterRaw: any,
  localizationData?: any,
): FleetRuleContext | null => {
  const index = new Map<string, number[]>()
  const add = (name: unknown, id: unknown) => {
    if (typeof name !== 'string' || !name) return
    const stype = Number(id)
    if (!Number.isInteger(stype) || stype <= 0) return
    const key = foldToken(name)
    if (!key) return
    const ids = index.get(key) ?? []
    if (!ids.includes(stype)) ids.push(stype)
    index.set(key, ids)
  }
  // 一手：api_mst_stype 的日文名（戦艦 → 8/9、補給艦 → 15/22 都是同名两号，天然合并）
  for (const stype of masterRaw?.api_mst_stype ?? []) add(stype?.api_name, stype?.api_id)
  // 本地化：中文舰种名
  for (const [id, entry] of Object.entries<any>(localizationData?.entities?.shipType ?? {})) {
    add(entry?.zh, id)
    add(entry?.ja, id)
  }
  if (!index.size) return null
  // 口语别名最后进，压过同名的基础项（基础项与别名冲突的只有「补给舰」，值一致）
  for (const [name, ids] of Object.entries(STYPE_ALIASES)) index.set(foldToken(name), [...ids])

  // 舰名索引：日文名（一手主数据）+ 中文译名（本地化包），走同一把折叠钥匙。
  // 形态展开借 kcwiki 源那份上下文——两个源对「素名 vs 写明形态」必须是同一个口径，
  // 各写一份迟早会漂。
  const kcwiki = buildKcwikiRuleContext(masterRaw)
  const ships = new Map<string, number[]>()
  // 正文里的**表面长度**可能比索引钥匙长：foldToken 会把空格、间隔号、引号去掉，
  // 「Samuel B.Roberts」表面 16 字、钥匙 15 字。扫描窗口按钥匙长度取就永远够不到它，
  // 那艘舰在凑数名单里就少一个——集合小了、N 没变，门就比游戏严（B185/Cy6 实测）。
  let maxSurface = 0
  const addShip = (name: unknown, ids: number[]) => {
    if (typeof name !== 'string') return
    const key = foldToken(name)
    if (!key) return
    maxSurface = Math.max(maxSurface, name.length)
    const merged = ships.get(key) ?? []
    for (const id of ids) if (!merged.includes(id)) merged.push(id)
    ships.set(key, merged)
  }
  // 中文译名与常用词撞车的那几艘：**中文名不进索引**（日文/拉丁名照进）。
  // 全目录比对 862 条译名与任务正文常用词，撞上的只有这三条：
  // 胜利=Victorious、厌战=Warspite、无畏=Intrepid。
  // 「胜利」尤其致命——「演习胜利三次」满目录都是，Cs1/Cm2 等 14 条因此凭空长出
  // 一道「必须带 Victorious」的门（实测把 500 队真编成全拦下）。
  // 这三艘在正文里一律写拉丁名（Cy1 的「Warspite」），封掉中文名不吃亏。
  const COMMON_WORD_ZH_NAMES = new Set(['胜利', '勝利', '厌战', '厭戰', '无畏', '無畏'])
  const zhNames = new Map<number, string>()
  for (const [id, entry] of Object.entries<any>(localizationData?.entities?.ship ?? {})) {
    const mstId = Number(id)
    if (Number.isInteger(mstId) && mstId > 0 && typeof entry?.zh === 'string') {
      zhNames.set(mstId, entry.zh)
    }
  }
  for (const [name, ids] of kcwiki.shipIdsByName) {
    addShip(name, ids.flatMap((mstId) => kcwiki.expandShipForms(mstId)))
    for (const mstId of ids) {
      const zh = zhNames.get(mstId)
      if (zh && !COMMON_WORD_ZH_NAMES.has(zh)) addShip(zh, kcwiki.expandShipForms(mstId))
    }
  }

  // 舰级索引：任意舰名 → 它的 api_ctype。正文写的「秋月型」「吹雪级」都是拿**级名舰**
  // 指代整个舰级，索引里每艘舰都挂上自己的级号即可。
  const ctypes = new Map<string, number>()
  for (const ship of masterRaw?.api_mst_ship ?? []) {
    if ((ship?.api_sortno ?? 0) <= 0) continue
    const ctype = Number(ship.api_ctype)
    if (!Number.isInteger(ctype) || ctype <= 0) continue
    for (const name of [ship.api_name, zhNames.get(Number(ship.api_id))]) {
      const key = foldToken(`${name ?? ''}`)
      if (key && !ctypes.has(key)) ctypes.set(key, ctype)
    }
  }
  // 国籍 → 成员：编号段判定与装备加成、图鉴筛选共用 shared/ship-nationality 那一份
  const shipsByNationality = new Map<number, number[]>()
  for (const ship of masterRaw?.api_mst_ship ?? []) {
    if ((ship?.api_sortno ?? 0) <= 0) continue
    const nationality = shipNationalityIdFromSortId(ship.api_sort_id)
    if (!nationality) continue
    const bucket = shipsByNationality.get(nationality) ?? []
    bucket.push(Number(ship.api_id))
    shipsByNationality.set(nationality, bucket)
  }

  // 史实编队队名索引（单一出处是 shared/hist-fleets，这里只做「名字 → 条目」的对位，
  // 一个成员都不在这里新造）。成员表为空的条目**不进门**：第六舰队（潜母1+潜水4）、
  // 海上护卫总队那几条游戏就是按舰种判的，注册表在门里没有可落的成员表，
  // 硬接只会把门装严；它们的价值在图鉴标注。
  //
  // **门里一律按整条改造链展开，写明形态那一维不带进来。**
  // 注册表的 `form: 'exact'` 记的是「立这一期的那条任务要哪个形态」——cd-04 第四航空战队
  // 记的是 A60 要的 伊勢改／日向改，而同样引用四航战的 B132 要的是 改二。
  // 拿 exact 的形态去装门，B132 带 伊勢改二 的合规编成会被拦下（门比游戏严，硬伤方向）。
  // 队名在门里回答的是「**这支队有谁**」，「要哪个形态」由正文自己说（正文为准）。
  // 形态语义原样留在注册表里给图鉴用，那边要的正是精确形态。
  const histByName = new Map<string, HistFleetEntry[]>()
  const histShipsById = new Map<string, number[]>()
  const chains = buildShipRemodelChains(
    (masterRaw?.api_mst_ship ?? [])
      .filter((ship: any) => (ship?.api_sortno ?? 0) > 0)
      .map((ship: any) => ({
        id: Number(ship.api_id),
        sortNo: Number(ship.api_sortno) || Number(ship.api_id),
        afterId: parseInt(ship.api_aftershipid, 10) || 0,
      })),
    (masterRaw?.api_mst_shipupgrade ?? []).map((upgrade: any) => ({
      targetId: Number(upgrade.api_id) || 0,
      currentShipId: Number(upgrade.api_current_ship_id) || 0,
      originalShipId: Number(upgrade.api_original_ship_id) || 0,
      stage: Number(upgrade.api_upgrade_level) || 0,
    })),
  )
  const wholeChain = (mstId: number): number[] =>
    chains.chainOf.get(chains.rootOf.get(mstId) ?? mstId) ?? [mstId]
  const entryShips = (entry: HistFleetEntry): number[] => {
    const members: number[] = []
    for (const member of entry.members) {
      // 未实装的成员（夏潮）没有 id，门里这一位**直接跳过**，不是「算 0 艘」。
      for (const seed of memberFormIds(member.ref)) {
        for (const id of wholeChain(seed)) if (!members.includes(id)) members.push(id)
      }
    }
    return members
  }
  for (const entry of HIST_FLEETS) {
    const members = entryShips(entry)
    if (!members.length) continue
    histShipsById.set(entry.id, members)
    for (const name of [entry.name.zh, entry.name.ja, ...entry.aliases]) {
      const key = foldToken(name)
      if (key.length < HIST_FLEET_MIN_KEY) continue
      const list = histByName.get(key) ?? []
      if (!list.includes(entry)) list.push(entry)
      histByName.set(key, list)
    }
  }

  let maxTokenLength = maxSurface
  for (const key of index.keys()) maxTokenLength = Math.max(maxTokenLength, key.length)
  for (const key of ships.keys()) maxTokenLength = Math.max(maxTokenLength, key.length)
  for (const key of ctypes.keys()) maxTokenLength = Math.max(maxTokenLength, key.length)
  for (const key of histByName.keys()) maxTokenLength = Math.max(maxTokenLength, key.length)
  return {
    stypeIdsOf: (token) => {
      const ids = index.get(foldToken(token))
      return ids?.length ? [...ids] : null
    },
    shipIdsOf: (name) => {
      const ids = ships.get(foldToken(name))
      return ids?.length ? [...ids] : null
    },
    ctypeOf: (name) => ctypes.get(foldToken(name)) ?? null,
    nationalityShips: (natIds) => {
      const out: number[] = []
      for (const id of natIds) for (const mstId of shipsByNationality.get(id) ?? []) out.push(mstId)
      return [...new Set(out)]
    },
    laterForms: (mstId) => kcwiki.reachableForms(mstId),
    augmentFromText: (draft, questText) =>
      augmentShipGroupsFromQuestText(draft, kcwiki, questText, zhNames),
    histFleetsOf: (token) => histByName.get(foldToken(token)) ?? null,
    histFleetShips: (entries) => {
      const out: number[] = []
      for (const entry of entries) {
        // 索引里那份是装配期算好的；传进来的若是临时拼的条目（对账脚本按单个成员拆条
        // 来量覆盖）就现算一份，两条路走的是同一个 entryShips
        for (const id of histShipsById.get(entry.id) ?? entryShips(entry)) {
          if (!out.includes(id)) out.push(id)
        }
      }
      return out
    },
    maxTokenLength,
  }
}

// ---- 正文预处理 ----

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

/** wiki 链接写法「目标|显示」只留显示名：desc 里的「加贺|加贺改二（戊/护）」前半是链接目标 */
const unwrapWikiLinks = (text: string): string =>
  text.replace(/「([^「」|]*)\|([^「」]*)」/g, '「$2」')

/**
 * 分句：编成描述不跨逗号。
 * 顿号（、）**不切**——它在编成句里是并列原子的分隔符（「戰艦2隻、輕巡洋艦1隻」），
 * 切开就没法判断两个原子之间连的是「且」还是「或」。
 */
const CLAUSE_SPLIT = /[。．！!？?\n｜，,；;：:]/

/** 说明/建议句：见到就整块弃用，与出击类同一份口径 */
const ADVICE = /建议|建議|推荐|推薦|注意|据说|據說|疑似|参见|參見|奖励|獎勵|前置|开放条件|開放條件|完成度变化|完成度變化|更新前|更新后|更新後|不确定|不確定|待验证|待驗證|需验证|需驗證/
/**
 * 排除/限定：本模块表达不了「除外」「仅限」，见到就把这一句丢掉（少一条要求＝门更松）。
 * 「仅」要一起挡：By14「僚舰**仅**包含1～3艘海防舰」的重点是「不许有别的舰种」，
 * 只把「海防舰」那一半落地会漏掉限制、还会把范围下限读成下限之上（1～3 读成 ≥3）。
 */
const EXCLUSION = /不可|不能|不得|不算|不含|不再|除外|以外|禁止|无法|無法|之外|不需要|不必|仅|僅/
/** 编成信号：一句里没有这些词，里头的舰种词就只是叙事，不是编成要求 */
const COMPOSITION = /编成|編成|舰队|艦隊|部队|部隊|旗舰|旗艦|僚舰|僚艦|伴随|伴隨|随行|隨行|携带|攜帶|包含|含有|配备|配備|编入|編入|基干|基幹|骨干|骨幹|核心|组成|組成|使用|率领|率領|带领|帶領|投入|派出|派遣|由|以/
/**
 * 「这一句确实在规定编成」的**强**信号。只有它才配把整条标 ≈。
 *
 * 上面那份 COMPOSITION 收了「以」「由」「舰队」这类弱词——用来判断舰种词算不算要求
 * 够用，用来判断「有没有一道我们没读出来的门」就太松了：全目录 483 条追踪器里
 * 有 341 条能撞上弱词，全标 ≈ 等于把 ≈ 变成噪音，还会连带关掉
 * repairContradictedCompleteProgress（那个修正只处理非近似条目）。
 */
const STRONG_COMPOSITION = /旗舰|旗艦|僚舰|僚艦|编成|編成|编入|編入|包含|含有|携带|攜帶|伴随|伴隨|随行|隨行|基干|基幹|骨干|骨幹|为核心|為核心|组成|組成/
/** 敌方舰种不算数 */
const ENEMY_PREFIX = /[敌敵]|深海/

const NUM = String.raw`(\d+|[一二两兩三四五六七八九十]+)`
const UNIT = String.raw`[艘只隻名位个個門门]`
/**
 * 数量写在舰种词**前**：「3正规空母」「两艘驱逐舰」「四艘「重巡洋舰」」「共计2艘海防舰」。
 * `(?<!第)` 挡住序数：「第十六驱逐队」「第二十七驱逐队」里的数字是队号不是数量。
 */
const COUNT_BEFORE = new RegExp(String.raw`(?<!第)(?<!最多|最大|至多|上限)(?:${NUM}\s*[～~〜\-–—]\s*)?${NUM}\s*${UNIT}?\s*(?:以上|及以上)?\s*(?:的)?\s*[「『【（(]*\s*$`)
/** 数量写在舰种词**后**：「驱逐舰2只」「驱逐舰×4」「驱逐舰合计4艘以上」 */
const COUNT_AFTER = new RegExp(String.raw`^\s*[』」】）)]*\s*(?:共计|共計|合计|合計|总计|總計|计|計|共)?\s*(?:[×xX*]\s*)?(?:${NUM}\s*[～~〜\-–—]\s*)?${NUM}\s*${UNIT}`)
/** 等级下限：「Lv.88以上的战舰」「88级以上的战舰」——只挂给紧跟其后的那一个原子 */
const LEVEL_BEFORE = new RegExp(String.raw`(?:lv\.?\s*)?(\d+)\s*(?:级|級)?\s*以上\s*(?:的)?\s*[「『【（(]*\s*$`, 'i')
/**
 * 旗舰词与舰种词之间只允许这些连接字，多一个字都不认。
 * 认宽了会把旗舰门安到别的舰种头上——那是**门变严**的方向，硬伤。
 * 尤其 `+`：memo2 用它分隔互相独立的编成位（「秋月型旗舰+2航空战舰」的旗舰是秋月型，
 * 不是航空战舰），放进来就会把 Cy13 的旗舰门错安在航空战舰上。
 */
const FLAGSHIP_LINK = /^[\s为為是作以的「」『』【】“”0-9一二两兩三四五六七八九十艘只隻名位个個共合总總计計以上]*$/
const FLAGSHIP_WORD = /旗舰|旗艦/g
/** 数量与「或」并列的组间选择：引擎的 fleetGoal 是 groups 的合取，表达不了它 */
const COUNTED_OR = /或|\/|、或|或者/
/**
 * 舰种词后面紧跟这些就不是「一条编成要求」：
 *  · 「驱逐队」是部队番号（「第十六驱逐队」更不是十六艘驱逐舰）；
 *  · 「轻巡演习舰队」是给这支队起的名字——Cy3 的正文已经写过「3只以上轻巡级」，
 *    末尾这个「轻巡…舰队」再算一遍就凭空多要一艘（实测把 5 艘的合规编成打成不通过）。
 */
const NOT_A_STYPE_SUFFIX = /^(?:[队隊团團]|(?:演习|演習|训练|訓練)?(?:舰队|艦隊|部队|部隊|战队|戰隊|编队|編隊|船团|船團)|派遣|作战|作戰|任务|任務)/
/**
 * 「轻巡、驱逐**等**」「海防舰、水雷战队以及水上飞机母舰**等**」是举例不是穷举。
 * 按字面落地就成了「必须带海防舰」——D29 的四个远征里有的根本不要海防舰，
 * 那道门会把它们全拦下。所以这个原子往后到下一个原子之间只要出现「等」，整个原子丢掉。
 * `(?![级級])` 放过「等级」。
 */
const OPEN_ENDED = /等(?![级級])/
/**
 * 「可以加入1艘轻巡级」「最多3艘」——写在原子前面的**允许**而不是**要求**。
 * 按要求落地就成了「必须带」，比游戏严（Cq4「驱逐/海防4艘（可以加入1艘轻巡级）」实测）。
 */
const PERMISSIVE = /可以|可选|可選|也可|亦可|允许|允許|可加|可携|可帶|可带|最多|最大|至多|上限|不超过|不超過/
/**
 * 「明石/水母合计1艘」的「水母」：斜杠/顿号前面那一截我们没读出来（明石是具名舰），
 * 只把后半截落地就成了「必须带水母」（B134 实测）。→ 整个原子丢掉。
 * 前面带数字的不算（「共计2艘以上、海防舰2艘」的顿号是并列不是枚举残缺）。
 */
const ENUM_TAIL = /^[^0-9]*[^\s、/,，。：:「」『』“”][/、]\s*$/
/** 「另外1艘**其他**正规空母」= 真的追加名额，不是把同一批舰重述一遍 */
const EXTRA_SLOT = /其他|其它|另外|另1|另一|再[携带带編编]|追加/
/**
 * 「四选二」「之中2艘」「中的一个」「凑3」——一串具名舰里**挑几艘**。
 * 引擎表达得了（并成一个组、amount=N），但那是下一档的活；本档见到就整条弃用，
 * 因为按「各自一个名额」落地会把「三选一」读成「三艘都要」——门变严，硬伤方向。
 */
const CHOOSE_AMONG = new RegExp([
  String.raw`${NUM}\s*[选選]\s*${NUM}`,
  String.raw`[之其]?中\s*(?:的)?\s*(?:至少|任意|任选|任選)?\s*${NUM}\s*(?:[艘只隻名个個位]|以上)`,
  String.raw`[之其]中\s*(?:的)?\s*(?:至少|任意|任选|任選)?\s*${NUM}(?![-0-9])`,
  '任选', '任選', '任意一[艘只隻名]', '其中之一', '中的一[个個艘只隻]', '选[其一]',
  String.raw`凑\s*${NUM}`, '中至少', '任意的?[一二三四]',
].join('|'))

/** 「四选二」「之中2艘以上」「中的一艘」「凑3」——凑几艘？数不出来返回 null，调用方整条弃用。 */
const chooseAmount = (folded: string): number | null => {
  const pick = folded.match(new RegExp(String.raw`${NUM}\s*[选選]\s*${NUM}`))
  if (pick) return parseCount(pick[2])
  const among = folded.match(new RegExp(
    String.raw`[之其]?中\s*(?:的)?\s*(?:至少|任意|任选|任選)?\s*${NUM}\s*(?:[艘只隻名个個位]|以上)`,
  ))
  if (among) return parseCount(among[1])
  const heap = folded.match(new RegExp(String.raw`凑\s*${NUM}`))
  if (heap) return parseCount(heap[1])
  if (/任选|任選|其中之一|中的一[个個艘只隻]|任意一[艘只隻名]|选[其一]/.test(folded)) return 1
  return null
}
/** 引号跨度：里头是本档认不出的实体时整句弃用 */
const QUOTED_SPAN = /[「『【“][^「」『』【】“”]*[」』】”]/g
/**
 * 队号的**行文写法**：「四航战」「第四战队」「第十驱逐队」「水雷战队」。
 * 这些是部队番号，里头的舰种词不是编成要求。必须带数字或「第」才算，
 * 免得把「巡洋舰战队」这种泛称也盖掉（那里的舰种词是真要求）。
 */
const SQUADRON_TEXT = /[「『【“]?(?:第|[一二三四五六七八九十百零〇0-9]){1,4}(?:航[战]队?|[驱][逐]?队|水雷[战]队|[战]队|[舰]队|小队)[」』】”]?/g
/** 队号：「二七驱」「第十一驱逐队」「第一航空战队」「三一驱第一小队」 */
const SQUADRON_SPAN = /^第?[一二三四五六七八九十百零〇0-9]+[驱駆逐]*[队隊]?(?:第?[一二三四五六七八九十0-9]*小?[队隊])?$|[战戰]队|[战戰]隊|航[战戰]|小[队隊]|方面[舰艦][队隊]/
/** 判断拉丁字母残留之前先摘掉的：评价字母、Lv、BOSS、点位号 */
const LATIN_NOISE = /lv\.?\s*\d+|[sabc]\s*[?？]?\s*(?:胜|勝|判定)|boss|[a-z]\s*点|p\s*\d/gi

/** 队名解出来的一队：成员集合 + 显示名 + 「期别没裁出来」标记 */
interface SquadPick {
  ships: number[]
  label: string
  /** 期别裁不出来、落了最宽的并集 → 门偏松，整条标 ≈ */
  approx: boolean
}
type SquadResolve = (token: string) => SquadPick | null

/** 队名解析关掉：第一遍读正文用它，读出来的东西与接注册表之前一个字节不差 */
const NO_SQUAD: SquadResolve = () => null

/**
 * 队名 → 成员，期别按**注册表自己的 `questRefs`** 裁。
 *
 * 选期别的判据只有一个：候选里哪几条点名了这条任务。这是第一方数据，
 * 不是从正文里猜期别词——「精锐」那类词既表示改二档又只是修饰语（A81 vs B85），
 * 拿它当判据会选错期（分析 §4.1）。
 * 裁完仍不止一条（2606Cm1 的前期/后期两条都点了它）就落**并集**并标 ≈：
 * 候选名单越全门越松，与本文件头「安全方向只往松了裁」同向。
 * **永不默认选最新的一期。**
 */
const squadResolverOf = (ctx: FleetRuleContext, code: string): SquadResolve =>
  (token) => {
    const candidates = ctx.histFleetsOf(token)
    if (!candidates?.length) return null
    const named = candidates.filter((entry) =>
      entry.questRefs.some((ref) => ref.code === code))
    const picked = named.length ? named : candidates
    const ships = ctx.histFleetShips(picked)
    if (!ships.length) return null
    return {
      ships,
      label: picked.map((entry) => entry.name.zh).join('/'),
      approx: picked.length > 1,
    }
  }

interface Atom {
  /** 原文里的词（做 label 用） */
  label: string
  /** 归一后的词本身；判「同一个词被写了两遍」用它，不用舰种号
   *  （舰种号做过加宽，「重巡」含航巡，拿号判会把「重巡洋舰或航空巡洋舰」误判成二选一） */
  tokens: string[]
  /** 具名舰的形态集合；空 = 这是个舰种原子 */
  ships: number[]
  /** 舰级号（「秋月型」「吹雪级」） */
  ctypes: number[]
  stypes: number[]
  amount: number
  /** 数量是「几选几」裁出来的，不是跟在舰名后面的总数 → 不许被归一成 1 */
  chosen: boolean
  /** 正文明写了数量（没写时按 1 读，是「至少一艘」的最小读法） */
  counted: boolean
  flagship: boolean
  /** 正文明说这是**追加**的名额（「另外1艘其他正规空母」），不是把同一批舰重述一遍 */
  extraSlot: boolean
  /** 这个名字后面跟着一段我们认不出的省略形态（「凤翔改二/战」的「/战」）→ 放宽到后继形态 */
  widen: boolean
  /** 国籍组：「美英澳荷出身的舰娘3艘」的 3 是这一组自己的数量，不许归一成 1 */
  nation: boolean
  /** 队名组：「第三十二驱逐队3艘以上」的 3 同样是这一组自己的数量，不许归一成 1 */
  squad: boolean
  /** 队名的期别没裁出来、落了最宽的并集 → 整条标 ≈ */
  squadApprox: boolean
  lv?: number
  start: number
  end: number
}

interface ClauseRead {
  atoms: Atom[]
  /** 这一句里有我们表达不了的东西（组间「或」/名单残缺），整条门弃用 */
  blocked: boolean
  /**
   * 弃用的理由**是组间「或」**（而不是「名单里有一艘认不出」那种残缺）。
   * 两者对本侧的处置一样（整条弃用），但对**另一侧**的效力不同：
   * 「或」说明正文里真有一道二选一，另一侧把它读成「都要」就会把门装严 → 该否掉另一侧；
   * 残缺只说明这一侧自己没读全，管不着另一侧读出来的东西（2606Cm1 的 memo2 被
   * 一个 `gray|` 样式标记判成残缺，不该把 desc 那侧的队名门一起否掉）。
   */
  blockedByOr: boolean
  /** 这一句里出现过编成信号但一个原子都没解出来 */
  unread: boolean
}

/**
 * 国籍词 → ship-nationality id。1 个字的简称（美/英/澳/荷）也收，
 * 但只在「国籍串 + 舰娘/舰艇」这个整体里才算数（见 matchNationRun），
 * 免得正文里随处可见的「美」「英」变成一道门。
 *
 * **导出是给护栏当判据用的**（同 STYPE_ALIASES）：这张词典与下面那份中心词表
 * 合起来正是「国籍组标签」的产地，`shared/ship-nation-name.ts` 那张统一写法表
 * 的护栏要拿产地当判据——判据取自被验证的那张表自己，抄漏一格就永远发现不了。
 */
export const NATION_TOKENS: Record<string, number[]> = {
  日本: [1], 日: [1], 德国: [2], 德意志: [2], 德: [2], 意大利: [3], 意: [3],
  美国: [4], 美军: [4], 美: [4], uss: [4], 英国: [5], 英: [5],
  法国: [6], 法兰西: [6], 法: [6], 俄罗斯: [7], 苏联: [7], 苏: [7], 俄: [7],
  泰国: [8], 泰: [8], 挪威: [9], 挪: [9], 瑞典: [10], 瑞: [10],
  荷兰: [11], 荷: [11], 澳大利亚: [12], 澳洲: [12], 澳: [12],
  // 「海外舰」= 非日本籍的全部（Cy14 的 memo2 就用这个词指代法国舰）
  海外: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 外国: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
}
const NATION_KEYS = Object.keys(NATION_TOKENS).sort((a, b) => b.length - a.length)
/**
 * 国籍串后面的中心词全集。**长的在前**：alternation 先试「舰娘」再退到「舰」，
 * 顺序即优先级，重排会让「法国舰娘」只量到「法国舰」。
 * 与 NATION_TOKENS 一样导出给护栏当判据（见上）。
 */
export const NATION_HEAD_NOUNS = [
  '舰娘', '艦娘', '舰艇', '艦艇', '舰船', '艦船', '军舰', '軍艦', '舰', '艦', '船',
] as const
/** 国籍串后面必须跟这些词才算数：「美英澳荷**出身的舰娘**」「法国**舰艇**」「3名法国**舰娘**」 */
const NATION_SUFFIX = new RegExp(
  `^\\s*(?:出身的?|籍|系)?\\s*(?:${NATION_HEAD_NOUNS.join('|')})`,
)
/** 国籍串内部的分隔符 */
const NATION_SEP = /^[\s/／、,，和及与與或]*/

interface EntityHit {
  start: number
  end: number
  ships: number[]
  stypes: number[]
  ctypes?: number[]
  /** 认得出、但不是一条编成要求（地名里的舰名）——只为了不让它掉进「读不出」的残余里 */
  noise: boolean
  /** 后面跟着一段斜杠省写的形态（「凤翔改二」后面那个「战」）→ 这一组要放宽到后继形态 */
  abbrev?: boolean
  /** 这是一串国籍词（「美英澳荷出身的舰娘」）——数量是它自己的，不是舰名串的总数 */
  nation?: boolean
  /** 这是一个队名（「第三十二驱逐队」）——成员来自史实编队注册表，数量同样是它自己的 */
  squad?: boolean
  /** 队名的期别没裁出来（多期并集）→ 门偏松 */
  squadApprox?: boolean
}

/**
 * 舰名后面紧跟这些就不是那艘舰：
 *  · `型`/`级` = 舰级引用（「秋月型」「白露型驱逐舰」），本档不做，留给残余去判「读不出」
 *    ——按舰名落地会把「秋月型任意一艘」读成「必须是秋月本人」；
 *  · 地名后缀 = 那是地图名（「昭南本土航线」「宗谷海峡」），根本不是编成要求。
 */
const SHIP_CLASS_SUFFIX = /^[型级級]/
/**
 * 舰名后面省写的另一个形态：斜杠式（「凤翔改二」后面那个「战」、「三隈改二」后面那个「改二特」）
 * 与括号式（「最上改二（或改二特）」「龙凤改二（含改二戊）」「三隈改二(特)」）。
 * 这一截索引里查不到，认成「读不出的实体」会把整句弃用；标成已知残余、让 widen 放宽形态就够了。
 */
const FORM_ABBREV_SLASH = /^[/／]([一-鿿]{1,4})/
const FORM_ABBREV_PAREN = /^[」』】”]*[（(]\s*(?:或|含|或者)?\s*([一-鿿]{1,4})\s*[）)]/
/**
 * 省写形态里不许出现的字：出现了说明已经越过省写、读到下一段正文了（「/战旗舰+5任意舰」）。
 * **「或」也在其中**：F103 的 memo2「以山風改二/丁**或**時雨改二為秘書艦」里，
 * 斜杠后面按最长四字量出来的是「丁或時雨」，把二选一的另一半整个吞进省写段，
 * 门就只剩山風改二一支——时雨改二当秘书舰会被拦下，硬伤方向。
 */
const NOT_A_FORM = /[旗僚舰艦队隊号位的了在与和或者及]/

/**
 * 把 `rest` 开头那段「省写形态」量出来：先按最长试，越界的字（旗/僚/舰…）一出现就缩短；
 * 缩到能被索引认出来的（「/雪风改二」那种真舰名）就不算省写，让正常扫描去认。
 */
const formAbbrevLength = (rest: string, ctx: FleetRuleContext): number => {
  for (const pattern of [FORM_ABBREV_SLASH, FORM_ABBREV_PAREN]) {
    const hit = rest.match(pattern)
    if (!hit) continue
    const head = hit[0].slice(0, hit[0].length - hit[1].length)
    for (let len = hit[1].length; len >= 1; len -= 1) {
      const run = hit[1].slice(0, len)
      if (NOT_A_FORM.test(run)) continue
      if (ctx.shipIdsOf(run) || ctx.stypeIdsOf(run)) return 0
      return head.length + len + (pattern === FORM_ABBREV_PAREN ? hit[0].length - head.length - hit[1].length : 0)
    }
  }
  return 0
}
const SHIP_IN_PLACE_NAME = /^(?:本土|航[线線路]|海域|近海|方面|泊地|环礁|環礁|群岛|群島|诸岛|諸島|水道|沿岸|海[峡峽]|[湾灣岛島]|作战|作戰|方向|水域)/

/**
 * 一段文字里认得出的实体（舰种词 + 具名舰），最长匹配、扫到就整体跳过
 * ——「轻巡洋舰」不会退化成「轻巡」，「时雨改二」不会退化成「时雨」。
 */
/** 词的两侧是不是「字」——一个字的舰名只在两边都不是字时才认（见 scanEntities） */
const WORD_CHAR = /[一-鿿ぁ-んァ-ヶー々A-Za-z0-9]/

/**
 * 从 `i` 起量一串国籍词：「美英澳荷出身的舰娘」「法国舰艇」「美军（USS）舰娘」。
 * 必须以「舰娘/舰艇/舰」收尾才算——单个「美」「英」在正文里太常见。
 */
const matchNationRun = (
  folded: string,
  i: number,
  ctx: FleetRuleContext,
): { end: number; ships: number[] } | null => {
  const natIds: number[] = []
  let at = i
  for (;;) {
    const sep = at > i ? (folded.slice(at).match(NATION_SEP)?.[0].length ?? 0) : 0
    const from = at + sep
    const key = NATION_KEYS.find((token) => folded.startsWith(token, from))
    if (!key) break
    for (const id of NATION_TOKENS[key]) if (!natIds.includes(id)) natIds.push(id)
    at = from + key.length
  }
  if (!natIds.length) return null
  // 「（USS）」这类夹注跳过去再看后缀
  const tail = folded.slice(at).replace(/^[\s（(][^）)]{0,8}[）)]/, (match) => ' '.repeat(match.length))
  const suffix = tail.match(NATION_SUFFIX)
  if (!suffix) return null
  const ships = ctx.nationalityShips(natIds)
  return ships.length ? { end: at + (folded.length - at - tail.length) + suffix[0].length, ships } : null
}

const scanEntities = (
  folded: string,
  ctx: FleetRuleContext,
  squad: SquadResolve,
): EntityHit[] => {
  const hits: EntityHit[] = []
  for (let i = 0; i < folded.length; ) {
    let consumed = 0
    // 国籍串优先：「美英澳荷出身的舰娘」里的每个字单看都不是实体，合起来才是
    const nation = matchNationRun(folded, i, ctx)
    if (nation) {
      hits.push({ start: i, end: nation.end, ships: nation.ships, stypes: [], noise: false, nation: true })
      i = nation.end
      continue
    }
    for (let len = Math.min(ctx.maxTokenLength, folded.length - i); len >= 1; len -= 1) {
      const raw = folded.slice(i, i + len)
      // 一个字的舰名（「潮」「曙」「漣」「朧」）只在**两边都不是字**时才认：
      // 引号里、顿号之间的「胧」是舰名，「退潮」「曙光」里的可不是。
      // 不认它们会把 B143「「翔鹤」「瑞鹤」…「胧」「秋云」」读少一艘（照样安全，但白丢一条要求）；
      // 无条件认会凭空长出具名舰门——那才是门变严的方向。
      if (len === 1 && (WORD_CHAR.test(folded[i - 1] ?? '') || WORD_CHAR.test(folded[i + 1] ?? ''))) {
        continue
      }
      // 词内不许含分隔符/数字：扫描是逐字的，跨越标点拼出来的「词」不是词。
      // **空格不算分隔符**——外文舰名自带它（Ark Royal、Samuel B.Roberts、Gambier Bay），
      // 把空格挡在外面这些舰就永远认不出来（Cy1/B185 实测各漏一艘，凑数集因此偏小、门变严）。
      // 索引那把钥匙（foldToken）本来就把空格去掉了，两边对得上。
      if (/[、/+,。「」『』【】（）()0-9]/.test(raw)) continue
      if (FREE_TOKENS.includes(raw)) { consumed = len; break }
      // 队名**先于舰名**匹配：正文写「第三十二驱逐队」时，成员来自注册表那一份，
      // 不靠 memo2 替游戏正文补名单。同样走最长匹配，队名比舰名长，天然占先。
      const squadHit = squad(raw)
      if (squadHit) {
        hits.push({
          start: i,
          end: i + len,
          ships: [...squadHit.ships],
          stypes: [],
          noise: false,
          squad: true,
          squadApprox: squadHit.approx,
        })
        consumed = len
        break
      }
      const ships = ctx.shipIdsOf(raw)
      const stypes = ships ? null : ctx.stypeIdsOf(raw)
      if (!ships && !stypes) continue
      const rest = folded.slice(i + len)
      // 「秋月型」「吹雪级」不是那一艘，是整个舰级。判定走 QpFleetGoalGroup.ctypes。
      if (ships && SHIP_CLASS_SUFFIX.test(rest)) {
        const ctype = ctx.ctypeOf(raw)
        if (!ctype) break
        hits.push({ start: i, end: i + len + 1, ships: [], stypes: [], ctypes: [ctype], noise: false })
        consumed = len + 1
        break
      }
      hits.push({
        start: i,
        end: i + len,
        ships: ships ?? [],
        stypes: stypes ?? [],
        noise: Boolean(ships) && SHIP_IN_PLACE_NAME.test(rest),
      })
      consumed = len
      const abbrev = ships ? formAbbrevLength(rest, ctx) : 0
      if (abbrev) {
        hits[hits.length - 1].abbrev = true
        hits.push({ start: i + len, end: i + len + abbrev, ships: [], stypes: [], noise: true })
        consumed = len + abbrev
      }
      break
    }
    i += consumed || 1
  }
  return hits
}

/**
 * 队名与具名舰之间只隔这些字 = 那个队名是**给这一串舰起的名字**（同位语），不是另一条要求。
 * `·` 是被 SQUADRON_TEXT 盖掉的番号占位符（「第三战队**第二小队**的“比睿”“雾岛”」）。
 */
const SQUAD_APPOSITION_GAP = /^[\s·的「」『』【】“”（）()、]*$/

/**
 * 「队名 + 它的成员」这种同位语写法里，队名不再是一条独立要求 —— 正文已经把名单列出来了，
 * **以正文为准**。见到就把队名降成 `noise`：位置照旧算「认得出」
 * （不然会掉进 unknownSpansOf 的残余里把整句弃用），但不落原子、不进凑数名单。
 *
 * 实测的两个方向都要挡：
 *  · 队名在前：Cy4「第七驱逐队「胧」「曙」「涟」「潮」」、B184「第十五驱逐队「早潮改二」…」、
 *    B207 的 memo2「第三十二驱逐队（凉波、早波、玉波、滨波）」；
 *  · 队名在后：B206「组成夕云型第二驱逐队为中核」——前面那个「夕云型」才是要求。
 *
 * 反过来，中间隔着并列词的**不是**同位语，是并列的候选：
 * B209「第三十二驱逐队**及**“朝霜”中2艘」——那两者一起进凑数名单，队名照落。
 *
 * 第二道判据不看位置只看成员：**这一句里点名的舰只要有一艘是这支队的成员**，
 * 就说明正文已经在列这支队的名单了（Cy15 的标题【第三战队演习】离「比睿」隔着半句，
 * 位置判据够不着，但比睿本人就在第三战队里）。同样以正文为准，队名降成 noise。
 * 队名里没有的舰（B209 的「朝霜」不属第三十二驱逐队）不算，那是并列的另一个候选。
 */
const demoteAppositionSquads = (folded: string, hits: EntityHit[]): void => {
  const isNamedHit = (hit: EntityHit) =>
    !hit.noise && !hit.squad && (hit.ships.length > 0 || (hit.ctypes?.length ?? 0) > 0)
  for (let index = 0; index < hits.length; index += 1) {
    const hit = hits[index]
    if (!hit.squad || hit.noise) continue
    let apposed = false
    for (let after = index + 1; after < hits.length && !apposed; after += 1) {
      if (hits[after].noise) continue
      apposed = isNamedHit(hits[after]) &&
        SQUAD_APPOSITION_GAP.test(folded.slice(hit.end, hits[after].start))
      break
    }
    for (let before = index - 1; before >= 0 && !apposed; before -= 1) {
      if (hits[before].noise) continue
      apposed = isNamedHit(hits[before]) &&
        SQUAD_APPOSITION_GAP.test(folded.slice(hits[before].end, hit.start))
      break
    }
    if (!apposed) {
      apposed = hits.some((other) =>
        isNamedHit(other) &&
        other.ships.length > 0 &&
        other.ships.every((mstId) => hit.ships.includes(mstId)))
    }
    if (apposed) hit.noise = true
  }
}

/**
 * 这一句里有没有本档认不出的实体（舰级、认不出的舰名）。
 *
 * 有的话整句弃用。理由是实测的：Cy1「含有「Warspite」「金刚」「Ark Royal」「Nelson」
 * 以及J级驱逐舰4艘以上」的真意是「这七艘里凑四艘」（memo2 自注「其中四艘或以上」），
 * 只把认得出的「驱逐舰4艘」落地就成了「必须四艘驱逐舰」——比游戏严，会拦下
 * 四艘全是战舰/空母的合规编成。**认一半比不认更危险**，所以宁可整句不认。
 *
 * 认得出的实体（含 Warspite 这类外文舰名）先从残余里抠掉再判，
 * 否则装上舰名索引之后每一句有外文舰名的都会被自己判成「读不出」。
 */
const unknownSpansOf = (
  clause: string,
  folded: string,
  hits: EntityHit[],
  ctx: FleetRuleContext,
): string[] => {
  const known = new Array<boolean>(folded.length).fill(false)
  // 队号那一维**不认队名命中**：括号里写「第三战队演习」时，队名被注册表认走之后
  // 只剩「演习」，拿它去判「这是不是一个队号」会判成「读不出的实体」，整句连
  // 比睿/雾岛一起丢掉（Cy15/C77 实测）。所以队号判定用的那份残余把队名的字留着。
  const knownButSquad = new Array<boolean>(folded.length).fill(false)
  for (const hit of hits) {
    for (let i = hit.start; i < hit.end; i += 1) {
      known[i] = true
      if (!hit.squad) knownButSquad[i] = true
    }
  }
  const residueOf = (from: number, to: number, mask: boolean[]) => {
    let out = ''
    for (let i = from; i < to && i < folded.length; i += 1) if (!mask[i]) out += clause[i] ?? folded[i]
    return out
  }
  const spans: string[] = []
  for (const match of clause.matchAll(QUOTED_SPAN)) {
    const start = (match.index ?? 0) + 1
    const end = start + match[0].length - 2
    // 队号判定要在**去数字之前**做：「二七驱」把数字先吃掉就只剩「驱」，认不出是队号了
    const squadResidue = residueOf(start, end, knownButSquad)
      .replace(/[\s、/+,和及与與或者以]/g, '')
    const residue = residueOf(start, end, known)
      .replace(/[\s、/+,和及与與或者以]/g, '')
    // 数字与量词不是「实体」：【榛名改二乙/丙+金刚改二丙+**2艘**驱逐舰】里剩下的
    // 「2艘」是数量，当成读不出的舰名会把整句连成员一起丢掉（B190 实测）
    const bare = residue.replace(/[0-9一二两兩三四五六七八九十艘只隻名个個位上共计計总總合]/g, '')
    // 队号（「二七驱」「第十一驱逐队」「第一航空战队」）不是一条读不出的编成要求：
    // 正文要么在同一句里把成员列全（B121 的「白露改二」「时雨改二」），要么根本没列
    // ——列全了就该照列的解，没列就本来也解不出。把队号当未知实体会连成员一起丢掉。
    if (bare && !SQUADRON_SPAN.test(squadResidue)) spans.push(match[0].slice(1, -1))
  }
  const stripped = residueOf(0, folded.length, known).normalize('NFKC').replace(LATIN_NOISE, '')
  if (/[A-Za-z]/.test(stripped)) spans.push(stripped)
  return spans
}

/**
 * 这一段认不出的文字看着像不像**舰名**。
 *
 * 只影响要不要标 ≈，不影响装不装门（装门那边一律按「认不出就整句不认」办，
 * 判错也只是门更松）。地名（「东部奥廖尔海」「2-3」「南西诸岛防卫线」）满目录都是，
 * 拿它当「有一道没读出来的编成门」会把 ≈ 打到七成任务头上，≈ 就没信息量了。
 */
const strongOf = (clause: string): boolean => STRONG_COMPOSITION.test(clause)

const PLACE_LIKE = /\d\s*-\s*\d|海域|近海|沿岸|方面|泊地|环礁|環礁|水道|航路|诸岛|諸島|群岛|群島|镇守府|鎮守府|海峡|海峽|作战|作戰|警戒|哨戒|终点|終點|资源|資源|防卫线|防衛線|任务|任務|[海洋湾灣]$/

/** 这个原子指的是具体的舰（具名舰或舰级），而不是一整个舰种 */
const isNamed = (atom: Atom): boolean => atom.ships.length > 0 || atom.ctypes.length > 0

/** 一句里扫出全部舰种原子。最长匹配，扫到就整体跳过——「轻巡洋舰」不会退化成「轻巡」。 */
const readClause = (clause: string, ctx: FleetRuleContext, squad: SquadResolve): ClauseRead => {
  const blank: ClauseRead = { atoms: [], blocked: false, blockedByOr: false, unread: false }
  if (!clause.trim()) return blank
  if (ADVICE.test(clause)) return blank
  // 整句以「或者」开头 = 这一句是**另一套**编成方案（B138「…，或者驱逐舰4艘的舰队」）。
  // 分句是逐句读的，读到第二套会把它当成追加要求 → 门比游戏严。整条弃用。
  if (/^\s*(?:或者|或是|或)/.test(clause)) {
    return { atoms: [], blocked: true, blockedByOr: true, unread: false }
  }
  // 队号先盖掉再扫：「最新锐「四航战」的第一舰队」里的「四航战」是第四航空戦隊的简称，
  // 不盖掉就会被读成「航空战舰4艘」（B132 实测凭空多要三艘）。盖成等长的占位符，
  // 后面所有下标都还对得上原文。
  // **注册表认得的队名不盖**：那不是一段该丢掉的番号，是一份查得到成员的队名，
  // 留给 scanEntities 去落成一个具名舰组（`ctx.histFleetsOf` 的判据与那边同一个）。
  const folded = foldCjkVariants(clause.normalize('NFKC')).toLowerCase()
    .replace(SQUADRON_TEXT, (match) => (ctx.histFleetsOf(match) ? match : '·'.repeat(match.length)))
  const hits = scanEntities(folded, ctx, squad)
  demoteAppositionSquads(folded, hits)

  // 「A、B、C 里凑 N 艘」：并成**一个**组（ships/ctypes 取并集、amount=N）。
  // selectorMatches 本来就是「命中任一」，一个组正好装得下；
  // 按「各自一个名额」落地才会把「三选二」读成「三艘都要」，那是门变严的方向。
  //
  // 这一段**排在编成信号之前**：凑数记号本身就是要求，不靠「编成/舰队」那类词背书。
  // Bq6 的 memo2 把它写成独立一句「「冲波改」或「朝霜改」中的一艘」，一个编成词都没有，
  // 按编成信号过滤会把这句整个跳过，只留下前一句的「配以「高波改」」——
  // 三选一就成了「必须带高波改」（实测被拦 36 队）。
  const namedHits = hits.filter((hit) => !hit.noise && (hit.ships.length || hit.ctypes?.length))
  const chosen = namedHits.length ? chooseAmount(folded) : null
  if (namedHits.length && CHOOSE_AMONG.test(folded)) {
    // 数不出来就整条弃用——宁可不装门，也不猜一个可能偏严的 N
    if (chosen == null || chosen > namedHits.length) {
      return { atoms: [], blocked: true, blockedByOr: false, unread: false }
    }
    // 名单里有一艘认不出，凑数集就是**残缺**的：同样的 N 配更小的集合＝门更严。
    // 2605B2 的「吞武里」在本地化包里没有中文译名（zh 原样是 Thonburi），
    // 十一选三就成了十选三，带吞武里的合规编成会被拦下。→ 整条弃用。
    if (unknownSpansOf(clause, folded, hits, ctx).length) {
      return { atoms: [], blocked: true, blockedByOr: false, unread: strongOf(clause) }
    }
    const first = namedHits[0]
    const last = namedHits[namedHits.length - 1]
    return {
      atoms: [{
        label: namedHits
          .map((hit) => clause.slice(hit.start, hit.end).replace(/[「」『』【】“”"']/g, ''))
          .join('/'),
        tokens: namedHits.map((hit) => folded.slice(hit.start, hit.end)),
        ships: [...new Set(namedHits.flatMap((hit) => hit.ships))],
        ctypes: [...new Set(namedHits.flatMap((hit) => hit.ctypes ?? []))],
        stypes: [],
        amount: chosen,
        counted: true,
        flagship: false,
        extraSlot: false,
        chosen: true,
        nation: false,
        // 凑数组的数量由「中N艘」裁定，队名只贡献候选成员 → 不再是「队名自带数量」
        squad: false,
        squadApprox: namedHits.some((hit) => hit.squadApprox),
        widen: false,
        start: first.start,
        end: last.end,
      }],
      blocked: false,
      blockedByOr: false,
      unread: false,
    }
  }

  const hasComposition = COMPOSITION.test(clause)
  // ≈ 只在**强**信号上打：这一句明写了旗舰/僚舰/编成，我们却读不出来，那才是真有门没装
  const strong = STRONG_COMPOSITION.test(clause)
  if (EXCLUSION.test(clause)) return { atoms: [], blocked: false, blockedByOr: false, unread: strong }
  if (!hasComposition) return blank

  const unknown = unknownSpansOf(clause, folded, hits, ctx)
  if (unknown.length) {
    return {
      atoms: [],
      blocked: false,
      blockedByOr: false,
      unread: strong && unknown.some((span) => !PLACE_LIKE.test(span.trim())),
    }
  }

  const atoms: Atom[] = []
  hits.forEach((hit, index) => {
    if (hit.noise) return
    const rest = folded.slice(hit.end)
    // 「驱逐队」是部队番号不是舰种（「第十六驱逐队」更不是十六艘驱逐舰）
    if (hit.stypes.length && NOT_A_STYPE_SUFFIX.test(rest)) return
    // 「敌驱逐舰」「深海栖舰」不是自军编成要求
    if (ENEMY_PREFIX.test(folded.slice(Math.max(0, hit.start - 2), hit.start))) return
    // 「凤翔改二/战」「三隈改二/改二特」「龙凤改二（含改二戊）」：斜杠或括号后面那截是
    // 省写的另一个形态，索引里查不到。只认写明的形态就会把「凤翔改二战」「龙凤改二戊」
    // 拦下——门变严，硬伤方向。见到这种收尾就放宽到后继形态。
    const next = hits.slice(index + 1).find((other) => !other.noise)
    // 队名组不放宽形态：成员的形态语义由注册表逐条写死（素名整链 / 写明形态只认列举），
    // 再按后继形态放宽等于绕开那份口径做结构推断（一之一）。
    const widen = Boolean(hit.ships.length) && !hit.squad && (
      hit.abbrev || (/^[（(]/.test(rest) && !(next && next.start <= hit.end + 2))
    )
    // 省写形态那一截并进这个原子：留在外面的话，「凤翔改二**/战**旗舰+3驱逐舰」
    // 里的斜杠会被后面的「组间或」判定当成二选一，把整条门作废（C70/B190 实测）。
    const tail = hit.abbrev ? hits[index + 1] : undefined
    const end = tail?.noise ? tail.end : hit.end
    atoms.push({
      label: clause.slice(hit.start, end).replace(/[「」『』【】“”"']/g, ''),
      tokens: [folded.slice(hit.start, hit.end)],
      ships: [...hit.ships],
      ctypes: [...(hit.ctypes ?? [])],
      stypes: [...hit.stypes],
      amount: 1,
      counted: false,
      flagship: false,
      extraSlot: false,
      chosen: false,
      nation: Boolean(hit.nation),
      squad: Boolean(hit.squad),
      squadApprox: Boolean(hit.squadApprox),
      widen,
      start: hit.start,
      end,
    })
  })
  // 一个实体都没有 = 这一句本来就没在规定编成，不是「读不出」
  if (!atoms.length) return blank

  // 舰种词紧挨着具名舰 = 那是在**称呼**这艘舰（「改装航空巡洋舰「三隈改二」」
  //「编成空母「云鹰」为旗舰」），不是另一条要求。当成要求会凭空多要一艘：
  // B196 的三隈改二特是水上机母舰，「航空巡洋舰≥1」那道门把它一个人的编成拦下了（实测）。
  for (let index = atoms.length - 1; index >= 0; index -= 1) {
    const atom = atoms[index]
    if (!atom.stypes.length) continue
    const next = atoms[index + 1]
    const previous = atoms[index - 1]
    // 舰种词在前：「改装航空巡洋舰「三隈改二」」
    const labels = next && isNamed(next) &&
      /^[\s「『【“（(]*$/.test(folded.slice(atom.end, next.start))
    // 舰种词在后：「「大淀」型轻巡」（B159 的 desc，那个「轻巡」说的就是大淀本人）、
    // 「“秋月型”驱逐舰」（舰级后面那个舰种同样是在称呼它，不是另加一艘驱逐）
    const gap = previous ? folded.slice(previous.end, atom.start) : ''
    const labelled = previous && isNamed(previous) && (
      /^[」』】”\s]*[型级級]$/.test(gap) ||
      (previous.ctypes.length > 0 && /^[」』】”\s]*$/.test(gap))
    )
    if (labels || labelled) atoms.splice(index, 1)
  }
  if (!atoms.length) return blank

  // 相邻具名舰并成一组的两种情形，都是「同一个位置的另一种写法」，不是「两艘都要」：
  //  ① 「云鹰」（八幡丸也可）——括号里那艘是别名
  //    （八幡丸是云鹰的**前身**，放宽到后继形态够不着它，只能靠这条并集）；
  //  ② 「「白露改」/「白露改二」为旗舰」「龙田改二/龙田改」——斜杠两边是**同一艘舰的两个形态**。
  //     判别线是「名字互为前缀」或「形态集合有交集」；B37 的「「初春」/「子日」」两边
  //     既不互为前缀也不共形态，那才是真的四艘都要。
  for (let index = atoms.length - 1; index > 0; index -= 1) {
    const atom = atoms[index]
    const previous = atoms[index - 1]
    if (!isNamed(atom) || !isNamed(previous)) continue
    // 队名不参与「同一个位置的另一种写法」这类合并：一支队不是一艘舰的别名，
    // 也不是它的另一个形态。并进去会把「队名 或 某某舰」这种真正的组间二选一
    // 抹成一个并集组，引擎就不知道自己表达不了它了（Bq13 实测：「六水战驱逐2艘
    // 或 由良改二」被并成一个组，结果门要求「2驱逐 且 1六水战/由良改二」——
    // 比游戏严，会把「夕张改二+由良改二」这一支合规编成拦下）。
    if (atom.squad || previous.squad) continue
    const between = folded.slice(previous.end, atom.start)
    // 别名必须真有一个左括号：「爱宕」「高雄」「鸟海」「摩耶」这种紧挨着的引号串
    // 是**四艘都要**（B13 的第四战队），并成一组就退化成「四选一」了
    const alias = /^[\s」』】”]*[（(][\s「『【“]*$/.test(between)
    const slashed = /^[\s/／、「」『』【】“”]*$/.test(between)
    const sameShip = slashed && (
      atom.ships.some((mstId) => previous.ships.includes(mstId)) ||
      atom.tokens.some((token) => previous.tokens.some((other) =>
        token.startsWith(other) || other.startsWith(token)))
    )
    // 斜杠串正后面跟着「旗舰」= 这一串是**同一个位置**的候选，不是「都要」：
    // 一支队只有一个旗舰。B160「丹阳/雪风改二旗舰的舰队」、C70「凤翔改二/战旗舰」、
    // B190「榛名改二乙/丙+金刚改二丙」都是这个形状；照「两艘都要」落地会把
    // 只带其中一艘的合规编成拦下。B37「「初春」/「子日」/「若叶」/「初霜」」后面
    // 没有旗舰，仍旧是四艘都要。
    const oneSlot = slashed &&
      /^[\s」』】”]*(?:旗舰|旗艦|为旗舰|為旗艦)/.test(folded.slice(atom.end))
    if (!alias && !sameShip && !oneSlot) continue
    previous.ships = [...new Set([...previous.ships, ...atom.ships])]
    previous.ctypes = [...new Set([...previous.ctypes, ...atom.ctypes])]
    previous.tokens = [...previous.tokens, ...atom.tokens]
    previous.label += `/${atom.label}`
    previous.widen = previous.widen || atom.widen
    previous.flagship = previous.flagship || atom.flagship
    previous.end = atom.end
    atoms.splice(index, 1)
  }
  // 「「丹阳」**或**归还后的「雪风改二」」「「最上改二」或「最上改二特」」= 二选一，
  // 一个组装得下（ships 是并集，selectorMatches 本来就是「命中任一」）。
  // 并的是**整句里全部具名舰**：正文常在两个名字之间塞一长串修饰
  // （「「最上改二」或特殊改装航空巡洋舰「最上改二特」」），只看相邻两个会漏。
  // 并宽了只会让门更松，漏了才会把「二选一」读成「都要」。
  // 队名同样不进这个并集（理由见上一段的 Bq13）
  const shipAtoms = atoms.filter((atom) => isNamed(atom) && !atom.squad)
  if (shipAtoms.length >= 2 && /或/.test(folded.slice(shipAtoms[0].end, shipAtoms[shipAtoms.length - 1].start))) {
    const head = shipAtoms[0]
    for (const atom of shipAtoms.slice(1)) {
      head.ships = [...new Set([...head.ships, ...atom.ships])]
      head.ctypes = [...new Set([...head.ctypes, ...atom.ctypes])]
      head.tokens = [...head.tokens, ...atom.tokens]
      head.label += `/${atom.label}`
      head.widen = head.widen || atom.widen
      head.end = atom.end
      atoms.splice(atoms.indexOf(atom), 1)
    }
  }

  // 相邻同类词合并成一个「组」：中间只隔并列符号（不含数字）→ 是并集
  //（「运输舰、水上机母舰或航空战舰」是一个组；「战舰2隻、轻巡1隻」是两个组）。
  //
  // **两侧舰种有交集就不是并集，是二选一**：B201「3艘以上海防舰**或者**海防舰和驱逐舰
  // 合计4艘以上」——同一个舰种出现在「或」的两边，说明这是两套方案在比较，不是在并列。
  // 并成一组会得到「海防/驱逐≥4」，把只带 3 海防的合规编成拦下（实测）。
  const raw: Atom[] = []
  let overlapped = false
  for (const atom of atoms) {
    const previous = raw[raw.length - 1]
    const between = previous ? folded.slice(previous.end, atom.start) : null
    // **只并舰种词**。并列的具名舰是「都要」不是「二选一」（B37「「初春」/「子日」/
    // 「若叶」/「初霜」」EO 编的是四条 且），并成一个组会把四艘的要求读成一艘。
    // 真的「几选几」上面已经整条弃用了。
    if (
      previous && between !== null && !isNamed(previous) && !isNamed(atom) &&
      /^[\s、/+和及或者与與,「」『』“”]*$/.test(between)
    ) {
      if (previous.tokens.some((token) => atom.tokens.includes(token))) {
        overlapped = true
        continue
      }
      previous.stypes = [...new Set([...previous.stypes, ...atom.stypes])]
      previous.tokens = [...previous.tokens, ...atom.tokens]
      previous.label += `/${atom.label}`
      previous.end = atom.end
      continue
    }
    raw.push(atom)
  }
  if (overlapped) return { atoms: [], blocked: true, blockedByOr: true, unread: false }
  // 丢原子的三种理由里只有一种代表「有门没读出来」（→ ≈）：
  // 枚举残缺（前半截是我们认不出的具名舰）。举例式（「…等」）与允许式（「可以加入」）
  // 说的都是「本来就没这道硬要求」——把它们也标 ≈ 是给 D23/D29/Dy1 这类
  // 根本没有编成条件的远征任务凭空扣帽子（实测）。
  let halfRead = false
  const merged = raw.filter((atom, index) => {
    const gap = folded.slice(index ? raw[index - 1].end : 0, atom.start)
    if (OPEN_ENDED.test(folded.slice(atom.end, raw[index + 1]?.start ?? folded.length))) return false
    if (PERMISSIVE.test(gap)) return false
    // 「明石/水母合计1艘」：前半截我们没读出来，只落后半截就成了「必须带水母」（B134 实测）
    if (ENUM_TAIL.test(gap)) {
      halfRead = true
      return false
    }
    return true
  })
  if (!merged.length) return { atoms: [], blocked: false, blockedByOr: false, unread: halfRead && strong }

  // 数量与等级。**取值范围只到相邻原子为止，而且写在后面的数量归前一个原子**：
  // 「驱逐舰2只以上的空母机动部队」里的「2只」是驱逐舰的，越过它读给空母就凭空
  // 多要一艘空母（C31/Cq1 实测）。所以先逐个吃掉「词在前、数在后」的那种，
  // 剩下的文字才轮到下一个原子往前找。
  const claimed = new Array<number>(merged.length).fill(0)
  merged.forEach((atom, index) => {
    const after = folded.slice(atom.end, merged[index + 1]?.start ?? folded.length)
    const head = after.match(COUNT_AFTER)
    if (!head) return
    // 「1～3艘」是区间：取**下界**（上界表达不了，取上界会把门装严）
    atom.amount = parseCount(head[1] ?? head[2])
    atom.counted = true
    claimed[index] = (head.index ?? 0) + head[0].length
  })
  merged.forEach((atom, index) => {
    const from = index ? merged[index - 1].end + claimed[index - 1] : 0
    const before = folded.slice(from, atom.start)
    const level = before.match(LEVEL_BEFORE)
    // **等级下限吃掉的数字不再当数量**：「以Lv.96以上的驱逐舰为旗舰」里的 96 是等级，
    // COUNT_BEFORE 照样能从「96以上的」上匹配出一个数量，落地就成了「96 艘驱逐舰」
    // ——比游戏严到没有任何编成过得去（F134 实测）。两个模式抢同一串数字时听等级的，
    // 数量退回 1（「至少一艘」的最小读法，往松的方向）。
    if (!atom.counted && !level) {
      const tail = before.match(COUNT_BEFORE)
      if (tail) {
        atom.amount = parseCount(tail[1] ?? tail[2])
        atom.counted = true
      }
    }
    if (level) atom.lv = parseInt(level[1], 10)
    if (EXTRA_SLOT.test(before)) atom.extraSlot = true
  })

  // 组间「或」：两个各自带数量的原子被「或」连起来 = 二选一，引擎表达不了
  let blocked = false
  for (let index = 1; index < merged.length; index += 1) {
    const between = folded.slice(merged[index - 1].end, merged[index].start)
    // 只有当两侧至少一侧写明数量时才算「计数级的或」；纯词并列已经在上面合并过了
    if (COUNTED_OR.test(between) && (merged[index - 1].counted || merged[index].counted)) {
      blocked = true
    }
  }
  if (blocked) return { atoms: [], blocked: true, blockedByOr: true, unread: false }

  // 旗舰：只认「旗舰词」与舰种词之间连接字极短的那种写法
  for (const hit of folded.matchAll(FLAGSHIP_WORD)) {
    const at = hit.index ?? 0
    const end = at + hit[0].length
    let best: Atom | null = null
    let bestGap = Infinity
    for (const atom of merged) {
      const gap = atom.end <= at
        ? folded.slice(atom.end, at)
        : atom.start >= end
          ? folded.slice(end, atom.start)
          : ''
      if (!FLAGSHIP_LINK.test(gap)) continue
      if (gap.length < bestGap) {
        bestGap = gap.length
        best = atom
      }
    }
    if (best) best.flagship = true
  }
  return { atoms: merged, blocked: false, blockedByOr: false, unread: halfRead && strong }
}

interface TextRead {
  groups: QpFleetGoalGroup[]
  blocked: boolean
  unread: boolean
  /** 弃用的理由是组间「或」（口径见 ClauseRead.blockedByOr） */
  blockedByOr: boolean
  /** 这一侧用到的队名有期别没裁出来（多期并集）→ 门偏松 */
  squadApprox: boolean
  /** 「几选几」那一组（正文写明凑数记号时才有） */
  heap?: QpFleetGoalGroup
}

const shipsOfAtom = (atom: Atom, ctx: FleetRuleContext): number[] =>
  atom.widen
    ? [...new Set([...atom.ships, ...atom.ships.flatMap((mstId) => ctx.laterForms(mstId))])]
    : atom.ships

const readText = (raw: string, ctx: FleetRuleContext, squad: SquadResolve): TextRead => {
  const text = unwrapWikiLinks(`${raw ?? ''}`.normalize('NFKC'))
  let collected: Atom[] = []
  let blocked = false
  let blockedByOr = false
  let unread = false
  for (const clause of text.split(CLAUSE_SPLIT)) {
    const read = readClause(clause, ctx, squad)
    if (read.blocked) blocked = true
    if (read.blockedByOr) blockedByOr = true
    if (read.unread) unread = true
    collected.push(...read.atoms)
  }
  const squadApprox = collected.some((atom) => atom.squadApprox)
  // 「几选几」的候选名单常被逗号切开：Bq6 的 memo2 是「…，配以「高波改」，「冲波改」或
  // 「朝霜改」中的一艘，…」——凑数记号落在最后一句，前面那句的「高波改」按分句读就成了
  // 「必须带」。所以只要整条正文里出现一个凑数组，就把**全文的具名舰/舰级**都并进去。
  // 并宽了只会让门更松（候选多了几艘），漏了才会把「三选一」读成「都要」。
  const heap = collected.find((atom) => atom.chosen)
  if (heap) {
    // **旗舰不并进凑数名单**：旗舰是另一个位置，不是名单里的一员。
    // B167「以「最上改二（或改二特）」作为旗舰，配备时雨・满潮・朝云・山云其中2艘」
    // 并成一个组之后成了「这五个里凑2艘、且旗舰在这五个里」——時雨当旗舰＋満潮也能过，
    // 游戏不认（门比游戏松）；同时 `atom.ships` 不带 widen，最上改二**特**当旗舰
    // 反而被拦下（门比游戏严，硬伤方向）。两头都错，只能拆开：
    // 旗舰各自成组（n=1），凑数组只装真正的候选池。
    const mergeable = (atom: Atom) =>
      atom !== heap && !atom.flagship && (atom.ships.length > 0 || atom.ctypes.length > 0)
    for (const atom of collected) {
      if (!mergeable(atom)) continue
      heap.ships = [...new Set([...heap.ships, ...atom.ships])]
      heap.ctypes = [...new Set([...heap.ctypes, ...atom.ctypes])]
      heap.label += `/${atom.label}`
      if (atom.chosen) heap.amount = Math.min(heap.amount, atom.amount)
    }
    collected = collected.filter((atom) => !mergeable(atom))
  }

  // 同一套舰种被写了两遍：多半是**换个说法重述**（Bm7「以驱逐舰为旗舰，…驱逐舰4艘」
  // 说的就是那四艘里的旗舰），当成两个独立名额会凭空多要一艘（编成成员去重会判不通过）。
  // 只有正文明说「**其他**」「另外」的才是真的追加名额（C46「以正规空母为旗舰，
  // 且包含1艘**其他**正规空母」）。合并方向是取最宽：数量取大的、旗舰要求取并集。
  const groups: QpFleetGoalGroup[] = []
  const slotOf = new Map<string, QpFleetGoalGroup>()
  let heapGroup: QpFleetGoalGroup | undefined
  for (const atom of collected) {
    const ships = shipsOfAtom(atom, ctx)
    const named = ships.length > 0 || atom.ctypes.length > 0
    const key = [
      [...ships].sort((a, b) => a - b).join(','),
      [...atom.ctypes].sort((a, b) => a - b).join(','),
      [...atom.stypes].sort((a, b) => a - b).join(','),
    ].join('|')
    const existing = atom.extraSlot ? undefined : slotOf.get(key)
    if (existing) {
      existing.amount = Math.max(existing.amount, atom.amount)
      if (atom.flagship) existing.flagship = true
      if (atom.lv !== undefined) existing.lv = Math.min(existing.lv ?? atom.lv, atom.lv)
      continue
    }
    const group: QpFleetGoalGroup = {
      label: atom.label,
      ships,
      stypes: atom.stypes,
      // **具名舰组的数量恒为 1**，除非是「几选几」裁出来的：正文里跟在一串舰名后面的
      // 数字是那一串的**总数**，不是最后那一艘要几条（C27「矶风乙改、浜风乙改、
      // 浦风丁改、谷风丁改四艘编成」按字面读就成了「四艘谷风丁改」）。
      // 队名组与国籍组一样，数量是**这一组自己的**（「第三十二驱逐队3艘以上」的 3
      // 说的是这一队要凑三艘），不是「跟在一串舰名后面的总数」那种要归一成 1 的情形。
      amount: named && !atom.chosen && !atom.nation && !atom.squad ? 1 : atom.amount,
    }
    if (atom.ctypes.length) group.ctypes = atom.ctypes
    // 具名舰/舰级组一律**不占去重名额**（B149 那条纪律的一般化）：EO 的条件是彼此独立的
    // 谓词——「雪風在队里 且 駆逐艦≥4」说的是四艘驱逐里可以有雪風；QpFleetGoal 默认要求
    // 各组占用不同的舰，照办就变成「雪風 + 另外四艘驱逐」，比游戏严一艘（C51 实测被拦）。
    // 组自己的数量线仍在 evaluateFleetGoal 里独立校验，放开的只是「不许同一艘」。
    if (named) group.overlapOk = true
    if (atom.chosen) heapGroup = group
    if (atom.flagship) group.flagship = true
    if (atom.lv !== undefined) group.lv = atom.lv
    groups.push(group)
    if (!atom.extraSlot) slotOf.set(key, group)
  }
  return { groups, blocked, blockedByOr, unread, squadApprox, heap: heapGroup }
}

/**
 * desc 先、memo2 后（口径见文件头）。
 * **例外：哪一侧把「几选几」读出来了就听哪一侧**——同一件事，一侧读成「三选一」、
 * 另一侧读成「三艘都要」，前者才是对的（B192 的 desc 写「1艘…(白露/有明/夕暮)成员」
 * 看不出凑数，memo2 写「3选1」写得明明白白；照 desc 落地会多要两艘，实测拦下 69 队）。
 */
const pickSide = (fromDesc: TextRead, fromMemo: TextRead): { picked: TextRead; other: TextRead } => {
  const descFirst = fromDesc.heap || !fromMemo.heap
    ? Boolean(fromDesc.groups.length)
    : false
  return descFirst
    ? { picked: fromDesc, other: fromMemo }
    : { picked: fromMemo, other: fromDesc }
}

const hasShipGroup = (read: TextRead): boolean =>
  read.groups.some((group) => Array.isArray(group.ships) && group.ships.length > 0)

/**
 * 另一侧看见「或」，也要看被采用的这一侧有没有具名舰组。
 * B160 的 desc 写「以「丹阳」**或**归还后的「雪风改二」作为旗舰」（二选一），
 * memo2 写「丹阳/雪风改二旗舰」（斜杠，读起来像并列）——只看 memo2 会把二选一
 * 落成两艘都要（实测拦下 77 队）。但另一侧的「或」若只是**舰种数量**上的二选一
 * （B125 的 memo2「两艘驱逐舰或两艘海防舰」），它管不着这一侧读出来的具名舰门，
 * 一律弃用就白丢了三条本来对的门（B125/C70/B190 实测）。
 */
const otherVetoes = (picked: TextRead, other: TextRead): boolean =>
  other.blockedByOr && hasShipGroup(picked)

export interface DerivedFleetRule {
  fleetGoal?: QpFleetGoal
  /** 门比实际松（有没读全的要求）→ 计数可能偏多 */
  approx: boolean
  notes: string[]
}

/**
 * 从中文任务正文推导编成条件门。
 *
 * 返回 null = 正文里看不出任何编成要求（不是「读失败」，是「没有」）。
 * 返回 `{ approx: true }` 而 `fleetGoal` 为空 = **看得出有门但读不出来**，
 * 这一条的计数因此可能偏多，UI 该标 ≈——这比装作没门诚实。
 */
export const deriveFleetRule = (
  questId: number,
  code: string,
  desc: string,
  memo2: string,
  ctx: FleetRuleContext,
): DerivedFleetRule | null => {
  const ruling = FLEET_ARBITRATED[questId]
  if (ruling?.drop) {
    return { approx: true, notes: [ruling.why] }
  }
  // ---- 哪一侧说了算，按**接注册表之前**的读法定 ----
  //
  // 队名解析只补内容，不许把「desc 说了算还是 memo2 说了算」翻过来：
  // By13 的 desc 只写「第七驱逐队4艘」、memo2 写明了「胧改／曙改／涟改／潮改」，
  // 让队名把 desc 顶上去会把形态限定整个冲掉，门反而更松。
  // 老读法两侧都没成门时（B209 的 desc 被凑数名单残缺否掉、2606Cm1 两侧都读不出）
  // 本来就没有可保的东西，那时按带队名的读法重新定。
  // 队名解析要知道自己在解哪一条任务：期别按注册表的 questRefs 裁（见 squadResolverOf）
  const squad = squadResolverOf(ctx, code)
  const baseDesc = readText(desc, ctx, NO_SQUAD)
  const baseMemo = readText(memo2, ctx, NO_SQUAD)
  const fromDesc = readText(desc, ctx, squad)
  const fromMemo = readText(memo2, ctx, squad)
  const base = pickSide(baseDesc, baseMemo)
  const baseHasGate = Boolean(base.picked.groups.length) &&
    !base.picked.blocked &&
    !otherVetoes(base.picked, base.other)
  const descFirst = baseHasGate
    ? base.picked === baseDesc
    : pickSide(fromDesc, fromMemo).picked === fromDesc
  const picked = descFirst ? fromDesc : fromMemo
  const other = descFirst ? fromMemo : fromDesc
  const notes: string[] = []
  if (!picked.groups.length) {
    if (picked.blocked || other.blocked) {
      return {
        approx: true,
        notes: ['正文的编成要求是「A几艘 或 B几艘」的组间二选一，引擎的编成门是 groups 的合取，表达不了 → 整条门弃用并标 ≈'],
      }
    }
    if (picked.unread || other.unread) {
      return {
        approx: true,
        notes: ['正文写了编成要求但本档读不出（具名舰/舰级/排除词）→ 不装门并标 ≈，计数会偏多'],
      }
    }
    return null
  }
  if (picked.blocked || otherVetoes(picked, other)) {
    return {
      approx: true,
      notes: ['正文里有本引擎表达不了的组间「或」；只落一半会把门装严，整条弃用并标 ≈'],
    }
  }
  const goal: QpFleetGoal = { groups: picked.groups }

  // 两侧都读出了凑数组就取**并集**：候选名单越全，门越松。
  // B202 的 desc 写「“秋月”…中的3艘」（一艘舰），memo2 写「(秋月型+…)其中3艘」（一整级），
  // 只听 desc 会把带初月改的合规编成拦下——两边并起来正好是游戏的口径。
  if (picked.heap && other.heap) {
    const mine = picked.heap
    const theirs = other.heap
    if (Array.isArray(mine.ships) && Array.isArray(theirs.ships)) {
      mine.ships = [...new Set([...mine.ships, ...theirs.ships])]
    }
    if (theirs.ctypes?.length) mine.ctypes = [...new Set([...(mine.ctypes ?? []), ...theirs.ctypes])]
    mine.amount = Math.min(mine.amount, theirs.amount)
    if (!theirs.flagship) delete mine.flagship
  }

  // ---- 具名舰的形态：两条放宽，都由正文自己背书 ----
  //
  // 底线口径是「写明形态就只认写明的」（与 kcwiki 源同一份，见 FleetRuleContext.shipIdsOf）。
  // 但中文正文有两种写法会让底线变得比游戏严，都得放宽——**严了会拦住游戏算了的编成**：
  const questText = `${desc ?? ''}｜${memo2 ?? ''}`
  //  ① 正文明说「改二也可」「改造后也可」：By13 的「【胧改、曙改、涟改、潮改】（改二也可）」
  //     按字面只认「改」，把改二的合规编成全拦下。这是正文自己写的放宽，不是结构推断。
  if (LATER_FORMS_OK.test(questText)) {
    for (const group of goal.groups) {
      if (!Array.isArray(group.ships) || !group.ships.length) continue
      const extra = group.ships.flatMap((mstId) => ctx.laterForms(mstId))
      group.ships = [...new Set([...group.ships, ...extra])]
    }
    notes.push('正文明说「改二也可」，具名舰放宽到后继形态')
  }
  //  ② 「凤翔改二/战」那截省写：见 Atom.widen，已在读句时按组放宽。
  //  ③ 剩下的按 kcwiki 那套**只认列举**：文本里独立点名的追加形态由 augment 补入，
  //     一个结构推断都不做。
  ctx.augmentFromText({ fleetGoal: goal }, questText)

  // 只看**采用的那一侧**读没读全。另一侧读不出不算数——2606Bm2 的 desc 把编成写全了，
  // memo2 的「【输送舰（AO、LHA均可）】」带拉丁字母读不出，拿它去标 ≈ 是冤枉。
  // 但另一侧读出的组**更多**，说明本侧确实漏了要求 → 门偏松，标 ≈。
  let approx = picked.unread || other.groups.length > picked.groups.length
  if (approx) notes.push('正文里还有本侧没读全的编成要求，门偏松 → 标 ≈')
  // 队名的期别没裁出来（注册表里同名多期、questRefs 又都点了这一条）→ 落的是并集，
  // 候选名单比游戏那一期宽 → 门偏松，按 ≈ 的语义诚实标注
  if (picked.squadApprox) {
    approx = true
    notes.push('正文点的队名在注册表里有多期、期别裁不出来 → 落最宽的并集组并标 ≈')
  }
  if (ruling?.noFlagship) {
    for (const group of goal.groups) delete group.flagship
    approx = true // 裁出来的是「较松者」，不是正文写死的 → ≈ 保留
  }
  if (ruling) notes.push(ruling.why)
  return { fleetGoal: goal, approx, notes }
}

/** 正文自己写的形态放宽：「（改二也可）」「改二以上」「改造后也可以」 */
const LATER_FORMS_OK = /改二(?:也|亦)?可|改二以[上后後]|改造[后後](?:也|亦)?可|以[上后後](?:也|亦)?可|改[后後](?:也|亦)?可/

// ---- 仲裁台账（依据一律是游戏自己的日文原文，不是第二个解码器的编码）----
//
// 定式：**日文原文 > 账本回放实测 > 三方两票 > approx**。
// 两种裁法：
//  · `drop` = 整条不装门（正文按字面读会把门装**严**——严＝会拦住游戏算了的编成，硬伤方向）；
//  · `noFlagship` = 门照装，只把「旗舰」那一维拆掉（正文说旗舰、别的源说不限，裁不动就取较松者）。
export const FLEET_ARBITRATED: Record<
  number,
  { drop?: boolean; noFlagship?: boolean; keep?: boolean; why: string }
> = {
  372: {
    keep: true,
    why:
      'Cy13 的自研门比 EO 的**判定**严一格：我们要求旗舰是秋月型，EO 跑起来只要求队里有秋月型。' +
      '但这不是编码分歧——EO 的数据里那条 ShipV2 写的就是 `flagship=true`，' +
      '是它的消费端 evalShipCond 在 shipId==0（纯舰级条件）时提前 return 了，把旗舰这一维丢掉。' +
      '中文 desc「以“秋月型”驱逐舰为旗舰」、memo2「需要秋月型旗舰」、EO 的编码三票一致要旗舰，' +
      '只有 EO 的实现漏判。→ 按三票落地，不跟着漏判走。' +
      '（账本窗口内 Cy13 从未受领——它是年常 6 月任务——回放对它无话可说。）',
  },
  364: {
    keep: true,
    why:
      'C73 的自研门比 EO 严一格：正文写「金刚改二丙」，我们只认这个形态；EO 那条 ShipV2 的 ' +
      'remodelCmp=0（Any＝同改造链），连素体金刚都算。这正是 2026-08-18 用户两轮实锤否掉的' +
      '「按改造链默认展开」——本工作区的口径是**写明形态只认写明的**，追加形态只由正文列举补入' +
      '（见 kcwiki-quest-rules 的 buildKcwikiRuleContext）。中文 desc 与 memo2 两处都写' +
      '「金刚改二丙」，kcwiki-quest-req 没有 364 条目、第三票弃权，账本窗口内这条从未受领。' +
      '→ 按本工作区口径落写明形态，不跟着 EO 的链展开走。' +
      '**这是本模块唯一一处有意比 EO 严的方向**，若日后回放抓到「游戏计了、门拦了」，先翻这一条',
  },
  996: {
    keep: true,
    why: '同 364：正文写明「榛名改二乙/丙」「金刚改二丙」，EO 的 remodelCmp=0 把整条金刚链都算进来。依据与处置同上',
  },
  1025: {
    noFlagship: true,
    why:
      'B208 的 desc「以“白雪改二”旗舰」与 memo2「以白雪改二为旗舰」两处都写了旗舰，' +
      'EO 编的却是「白雪改二+（不限位置）且 吹雪级凑2」。三方点票：中文正文一票「要旗舰」，' +
      'EO 一票「不要」，kcwiki-quest-req 没有 1025 条目、wikiwiki-quests 的 condRaw 只记前置解锁，' +
      '第三票弃权；账本里这条从没受领过，回放也裁不动。' +
      '按「三方无两票即取较松者」拆掉旗舰这一维（保留「队里要有白雪改二」），并标 ≈——' +
      '装着旗舰门而万一游戏不要求，就会把游戏算了的编成拦下，那是硬伤方向',
  },
}
