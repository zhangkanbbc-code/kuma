// 艦素自研补充（逐条人工解码那一半）。
//
// 上游（KCWiki / poi）与自研推导（废弃/演习/远征/出击四类）都没有安全规则的
// 任务，在这里逐条人工解码。依据是本地任务库（quests-scn）的任务正文与补充说明
// （kcwiki 中文口径）；点位一律写血条号，边号由 quest-map-nodes 的九行校准表
// + poi-fcd 拓扑现算（多血条图的 Boss 字母以 wikiwiki / zh.kcwiki 海域页为准，
// 7-2：P1=G、P2=M；7-3：P1=E、P2=P，核对于 2026-08-10）。
//
// 纪律与上游相同：**只填空位，绝不覆盖**；解不干净的条款宁可不写（继续诚实
// 降级），拿不准的判定（如「胜利」是否要求 S）标 approx。舰娘/装备/道具一律
// 按**精确日文名**经主数据解析成 id——任何一个名字解析失败，整条规则丢弃并
// 告警，绝不猜。
import { questMapRefNodeIds } from './quest-map-nodes'

import type { KcwikiRuleContext } from './kcwiki-quest-rules'
import type { PoiFcdMapData } from './quest-map-nodes'
import type {
  QpFleetGoal,
  QpFleetGoalGroup,
  QpMapRef,
  QpStateGoal,
  QpStockGoal,
  QpTask,
} from '../../shared/qp-types'
import { shipNationalityIdFromSortId } from '../../shared/ship-nationality'
import { buildShipRemodelChains } from '../../shared/ship-remodel-chain'

export interface KansoQuestRule {
  questId: number
  code: string
  tasks: QpTask[]
  fleetGoal?: QpFleetGoal
  stateGoal?: QpStateGoal
  stockGoals?: QpStockGoal[]
  approx: boolean
  partial: boolean
}

// ---- 判定常量 ----
const S = 6
const A = 5
const B = 4

// 近代化改修那一族（Gy1-Gy4 / G10-G11）正文里的舰种口径。数字是 api_stype，
// 名字取自游戏 api_mst_stype：2 駆逐艦 / 3 軽巡洋艦 / 4 重雷装巡洋艦 /
// 5 重巡洋艦 / 6 航空巡洋艦 / 21 練習巡洋艦。
// 「軽巡」級 / 「重巡」級是**舰种集合**不是单一舰种，与 poi 的 quest_goal 同编码
// （Gy3 的 materialShipType 就是 [3,4,21]，Gy4 是 [5,6]）。
// Gy2 正文写的是「軽巡洋艦」而不是「軽巡」級，只算 3 一种——poi 那条也只写了 [3]。
const DESTROYER = [2]
const LIGHT_CRUISER_ONLY = [3]
const LIGHT_CRUISER_CLASS = [3, 4, 21]
const HEAVY_CRUISER_CLASS = [5, 6]

const boss = (area: number, info: number, rank: number, count: number): QpTask => ({
  kind: 'bossKill',
  map: [area, info],
  rank,
  count,
})
// 点位任务写的是**血条号/格子字母**（`P1`/`P2`/`goal`），边号一律由 h.nodes 从
// quest-map-nodes 的九行校准表 + poi-fcd 拓扑现算——源码里零硬编码边号。
// 缺 poi-fcd 或该点算不出入边时 h.nodes 抛 MissingEntity，**整条规则弃用**：
// 退化成空 nodes 会让 battleNode 变成整图通配（`!task.nodes.length` 那条分支），
// 一张多血条图上打哪一格都计数，比不计数错得多。
const node = (
  h: BuildHelpers,
  area: number,
  info: number,
  rank: number,
  count: number,
  ref: string,
  name: string,
): QpTask => ({
  kind: 'battleNode',
  map: [area, info],
  rank,
  count,
  nodes: h.nodes([area, info], ref),
  name,
})
const reach = (
  h: BuildHelpers,
  area: number,
  info: number,
  count: number,
  ref: string,
  name: string,
): QpTask => ({
  kind: 'nodeReach',
  map: [area, info],
  count,
  nodes: h.nodes([area, info], ref),
  name,
})

interface BuildHelpers {
  /** 精确日文名 → mstId 列表；解析失败抛 MissingEntity */
  ships: (...names: string[]) => number[]
  /** 同一改造链的全部形态（按链根名） */
  chain: (...rootNames: string[]) => number[]
  /** 指定国籍（ship-nationality id）的全部舰娘，可再按舰种过滤 */
  nationality: (natIds: number[], stypes?: number[]) => number[]
  /** 精确日文名 → 该舰的舰级号（api_ctype）；名字解析不了或主数据没这一项都抛 MissingEntity */
  ctype: (name: string) => number
  equip: (name: string) => number
  useitem: (name: string) => number
  /** 血条号/格子字母 → 入边号；表里没有或 poi-fcd 算不出都抛 MissingEntity */
  nodes: (map: QpMapRef, ref: string) => number[]
}

class MissingEntity extends Error {}

// 缺省 `ships` 必须是**空名单**而不是 `'any'`。
// `'any'` 在 selectorMatches 里是「任意舰都算」的短路分支，写在最前面：
// 一旦落上它，同一组里的 stypes/ctypes 根本不会被读到。于是
// `group('正规空母', 2, { stypes: [11, 18] })` 这种只给舰种的写法就成了
// 「任意 2 艘」——门看着在，其实全开（B152 等 10 条实测全开）。
// 真要「任意舰」的那一条（B155 的「全队规模 ≤5」）自己显式写 ships: 'any'。
const group = (
  label: string,
  amount: number,
  init: Partial<QpFleetGoalGroup>,
): QpFleetGoalGroup => ({
  label,
  ships: [],
  stypes: [],
  amount,
  ...init,
})

interface RuleDraft {
  questId: number
  code: string
  build: (h: BuildHelpers) => Omit<KansoQuestRule, 'questId' | 'code' | 'approx' | 'partial'> & {
    approx?: boolean
    partial?: boolean
  }
}

// 依据均为该任务在任务库里的补充说明；「memo」指其中的中文攻略口径。
const DRAFTS: RuleDraft[] = [
  // ---- 编成 ----
  {
    // memo：第一舰队编成，夕云改二旗舰+卷云+风云+秋云（全改二）
    questId: 197,
    code: 'A93',
    build: (h) => ({
      tasks: [],
      fleetGoal: {
        fleetId: 1,
        allowOnlyGoalShips: true,
        groups: [
          group('夕云改二', 1, { ships: h.ships('夕雲改二'), flagship: true }),
          group('卷云改二', 1, { ships: h.ships('巻雲改二') }),
          group('风云改二', 1, { ships: h.ships('風雲改二') }),
          group('秋云改二', 1, { ships: h.ships('秋雲改二') }),
        ],
      },
    }),
  },
  {
    // memo：将【胧改、曙改、涟改、潮改】（改二也可）编入第一舰队，4 艘编成
    questId: 198,
    code: 'A94',
    build: (h) => ({
      tasks: [],
      fleetGoal: {
        fleetId: 1,
        allowOnlyGoalShips: true,
        groups: [
          group('胧改', 1, { ships: h.ships('朧改') }),
          group('涟改', 1, { ships: h.ships('漣改') }),
          group('曙改/改二', 1, { ships: h.ships('曙改', '曙改二') }),
          group('潮改/改二', 1, { ships: h.ships('潮改', '潮改二') }),
        ],
      },
    }),
  },
  {
    // 期间限定月常（更新后口径）：花月/桐/竹/樫/榧/杉/潮/响 任选 5 艘以上
    questId: 199,
    code: '2606Am1',
    build: (h) => ({
      tasks: [],
      fleetGoal: {
        groups: [
          group('花月/桐/竹/樫/榧/杉/潮/响', 5, {
            ships: h.chain('花月', '桐', '竹', '樫', '榧', '杉', '潮', '響'),
          }),
        ],
      },
    }),
  },
  // ---- 远征 ----
  {
    // memo：远征 30（潜水艦派遣作戦）成功 2 次
    questId: 443,
    code: 'D39',
    build: () => ({
      tasks: [
        { kind: 'expedition', missionId: 30, count: 2 },
      ],
    }),
  },
  {
    // memo：远征 3/4/5/A1/A2 各成功 1 次
    questId: 446,
    code: 'D42',
    build: () => ({
      tasks: [
        { kind: 'expedition', missionId: 3, count: 1 },
        { kind: 'expedition', missionId: 4, count: 1 },
        { kind: 'expedition', missionId: 5, count: 1 },
        { kind: 'expedition', missionId: 100, count: 1 }, // A1 兵站強化任務
        { kind: 'expedition', missionId: 101, count: 1 }, // A2 海峽警備任務
      ],
    }),
  },
  // ---- 出击 ----
  {
    // memo：2 低速战舰/航空战舰 + 4 自由，2-4 Boss S 胜
    questId: 842,
    code: 'B89',
    build: () => ({
      tasks: [boss(2, 4, S, 1)],
      fleetGoal: {
        groups: [group('低速战舰/航空战舰', 2, { stypes: [8, 9, 10], speedMax: 5 })],
      },
    }),
  },
  {
    // memo：球磨改二/丁旗舰，2-2、3-2、7-3(P2) S 胜（S 存疑标 ≈），1-6 到达终点
    questId: 847,
    code: 'B163',
    build: (h) => ({
      approx: true,
      tasks: [
        reach(h, 1, 6, 1, 'goal', 'N'),
        boss(2, 2, S, 1),
        boss(3, 2, S, 1),
        node(h, 7, 3, S, 1, 'P2', '-2'),
      ],
      fleetGoal: {
        groups: [group('球磨改二/改二丁', 1, { ships: h.ships('球磨改二', '球磨改二丁'), flagship: true })],
      },
    }),
  },
  {
    // memo：第一舰队，7-2(P2)、5-5、6-2、6-5 Boss S 各 1
    questId: 872,
    code: 'Bq10',
    build: (h) => ({
      tasks: [
        node(h, 7, 2, S, 1, 'P2', '-2'),
        boss(5, 5, S, 1),
        boss(6, 2, S, 1),
        boss(6, 5, S, 1),
      ],
      fleetGoal: { groups: [], fleetId: 1 },
    }),
  },
  {
    // memo：1-5、7-1、7-2(P1、P2) 各 3 次 S 胜
    questId: 893,
    code: 'Bq8',
    build: (h) => ({
      tasks: [
        boss(1, 5, S, 3),
        boss(7, 1, S, 3),
        node(h, 7, 2, S, 3, 'P1', '-1'),
        node(h, 7, 2, S, 3, 'P2', '-2'),
      ],
    }),
  },
  {
    // memo：2 航空战舰为核心，1-4、1-5、2-3、7-2(P2) Boss S
    questId: 896,
    code: 'B131',
    build: (h) => ({
      tasks: [
        boss(1, 4, S, 1),
        boss(1, 5, S, 1),
        boss(2, 3, S, 1),
        node(h, 7, 2, S, 1, 'P2', '-2'),
      ],
      fleetGoal: { groups: [group('航空战舰', 2, { stypes: [10] })] },
    }),
  },
  {
    // memo：明石旗舰 + 3 驱逐，1-3/2-1/2-2/2-3 Boss A 各 1，1-6 到达终点
    questId: 912,
    code: 'By3',
    build: (h) => ({
      tasks: [
        boss(1, 3, A, 1),
        boss(2, 1, A, 1),
        boss(2, 2, A, 1),
        boss(2, 3, A, 1),
        reach(h, 1, 6, 1, 'goal', 'N'),
      ],
      fleetGoal: {
        groups: [
          group('明石', 1, { ships: h.ships('明石', '明石改'), flagship: true }),
          group('驱逐舰', 3, { stypes: [2] }),
        ],
      },
    }),
  },
  {
    // memo：含翔鹤、瑞鹤、胧、秋云（形态不限），3-5、5-2、7-2(P2)、6-5 S 胜
    questId: 913,
    code: 'B143',
    build: (h) => ({
      tasks: [
        boss(3, 5, S, 1),
        boss(5, 2, S, 1),
        node(h, 7, 2, S, 1, 'P2', '-2'),
        boss(6, 5, S, 1),
      ],
      fleetGoal: {
        groups: [
          group('翔鹤', 1, { ships: h.chain('翔鶴') }),
          group('瑞鹤', 1, { ships: h.chain('瑞鶴') }),
          group('胧', 1, { ships: h.chain('朧') }),
          group('秋云', 1, { ships: h.chain('秋雲') }),
        ],
      },
    }),
  },
  {
    // memo：Gotland andra 旗舰 + 驱逐 ≥1，2-4、4-2、4-4、4-5 各 S 一次
    questId: 917,
    code: 'B145',
    build: (h) => ({
      tasks: [boss(2, 4, S, 1), boss(4, 2, S, 1), boss(4, 4, S, 1), boss(4, 5, S, 1)],
      fleetGoal: {
        groups: [
          group('Gotland andra', 1, { ships: h.ships('Gotland andra'), flagship: true }),
          group('驱逐舰', 1, { stypes: [2] }),
        ],
      },
    }),
  },
  {
    // memo：Fletcher Mk.II 旗舰 + 美英澳荷 ≥3（含旗舰），1-5、7-1、6-2、6-5 各 S 胜 2 次
    questId: 921,
    code: 'B149',
    build: (h) => ({
      tasks: [boss(1, 5, S, 2), boss(7, 1, S, 2), boss(6, 2, S, 2), boss(6, 5, S, 2)],
      fleetGoal: {
        groups: [
          group('Fletcher Mk.II', 1, { ships: h.ships('Fletcher Mk.II'), flagship: true }),
          // 「含旗舰」：Fletcher 本人算在 3 艘里——不标 overlapOk 会被组间去重
          // 判成要 4 艘不同的美系（3美1日的标准编成打 S 不计数，2026-08-11 实锤）
          group('美/英/澳/荷舰娘', 3, { ships: h.nationality([4, 5, 11, 12]), overlapOk: true }),
        ],
      },
    }),
  },
  {
    // memo：含 Fletcher Mk.II（不必旗舰）的美英澳荷 4 艘，4-5、5-5、6-4 各 S 胜 2 次
    questId: 922,
    code: 'B150',
    build: (h) => ({
      tasks: [boss(4, 5, S, 2), boss(5, 5, S, 2), boss(6, 4, S, 2)],
      fleetGoal: {
        groups: [
          group('Fletcher Mk.II', 1, { ships: h.ships('Fletcher Mk.II') }),
          // 「含 Fletcher」：她算在 4 艘美英澳荷里，同 B149 的含旗舰口径
          group('美/英/澳/荷舰娘', 4, { ships: h.nationality([4, 5, 11, 12]), overlapOk: true }),
        ],
      },
    }),
  },
  {
    // memo：美/英航空母舰 ≥1，3-4、4-3、5-2、7-2(P2) 各 S 胜 1 次
    questId: 923,
    code: 'B151',
    build: (h) => ({
      tasks: [
        boss(3, 4, S, 1),
        boss(4, 3, S, 1),
        boss(5, 2, S, 1),
        node(h, 7, 2, S, 1, 'P2', '-2'),
      ],
      fleetGoal: {
        groups: [group('美/英航空母舰', 1, { ships: h.nationality([4, 5], [7, 11, 18]) })],
      },
    }),
  },
  {
    // memo：正规空母 ≥2，2-4、2-5、4-3 各 S 一次
    questId: 924,
    code: 'B152',
    build: () => ({
      tasks: [boss(2, 4, S, 1), boss(2, 5, S, 1), boss(4, 3, S, 1)],
      fleetGoal: { groups: [group('正规空母', 2, { stypes: [11, 18] })] },
    }),
  },
  {
    // memo：赤城改二/戊 + 加贺改二/戊/护，5-5、7-2(M)、6-2、6-5 Boss S 各 1
    questId: 926,
    code: 'B154',
    build: (h) => ({
      tasks: [
        boss(5, 5, S, 1),
        node(h, 7, 2, S, 1, 'P2', '-2'),
        boss(6, 2, S, 1),
        boss(6, 5, S, 1),
      ],
      fleetGoal: {
        groups: [
          group('赤城改二/戊', 1, { ships: h.ships('赤城改二', '赤城改二戊') }),
          group('加贺改二/戊/护', 1, { ships: h.ships('加賀改二', '加賀改二戊', '加賀改二護') }),
        ],
      },
    }),
  },
  {
    // memo：羽黑旗舰、全队 ≤5 艘，7-3(P1) Boss 胜利 4 次（「胜利」按 B 胜取，标 ≈）
    questId: 927,
    code: 'B155',
    build: (h) => ({
      approx: true,
      tasks: [node(h, 7, 3, B, 4, 'P1', '-1')],
      fleetGoal: {
        groups: [
          group('羽黑', 1, { ships: h.chain('羽黒'), flagship: true }),
          group('全队规模 ≤5', 0, { ships: 'any', maxAmount: 5 }),
        ],
      },
    }),
  },
  {
    // memo：羽黒/足柄/妙高/高雄/神风 任意 2 艘以上，7-3(P2)、7-2(P2)、4-2 各 S 胜 2 次
    questId: 928,
    code: 'By5',
    build: (h) => ({
      tasks: [
        node(h, 7, 3, S, 2, 'P2', '-2'),
        node(h, 7, 2, S, 2, 'P2', '-2'),
        boss(4, 2, S, 2),
      ],
      fleetGoal: {
        groups: [
          group('羽黒/足柄/妙高/高雄/神风', 2, {
            ships: h.chain('羽黒', '足柄', '妙高', '高雄', '神風'),
          }),
        ],
      },
    }),
  },
  {
    // memo：大鲸或迅鲸型旗舰 + 2 潜水舰/潜水空母的第一舰队，1-2、1-3、2-1、2-3 S 胜
    questId: 929,
    code: 'B156',
    build: (h) => ({
      tasks: [boss(1, 2, S, 1), boss(1, 3, S, 1), boss(2, 1, S, 1), boss(2, 3, S, 1)],
      fleetGoal: {
        fleetId: 1,
        groups: [
          group('大鲸/迅鲸型', 1, {
            ships: h.ships('大鯨', '迅鯨', '迅鯨改', '長鯨', '長鯨改'),
            flagship: true,
          }),
          group('潜水舰/潜水空母', 2, { stypes: [13, 14] }),
        ],
      },
    }),
  },
  {
    // memo：含白露改二与时雨改二（改三可），1-5、2-5、7-1、5-5、6-3 S 胜
    questId: 931,
    code: 'B158',
    build: (h) => ({
      tasks: [
        boss(1, 5, S, 1),
        boss(2, 5, S, 1),
        boss(7, 1, S, 1),
        boss(5, 5, S, 1),
        boss(6, 3, S, 1),
      ],
      fleetGoal: {
        groups: [
          group('白露改二', 1, { ships: h.ships('白露改二') }),
          group('时雨改二/改三', 1, { ships: h.ships('時雨改二', '時雨改三') }),
        ],
      },
    }),
  },
  {
    // memo：含雪风改二与时雨改二（改三按同型后继一并接受），4-5、5-3、5-5、6-4、6-5 S 胜
    questId: 935,
    code: 'B161',
    build: (h) => ({
      tasks: [
        boss(4, 5, S, 1),
        boss(5, 3, S, 1),
        boss(5, 5, S, 1),
        boss(6, 4, S, 1),
        boss(6, 5, S, 1),
      ],
      fleetGoal: {
        groups: [
          group('雪风改二', 1, { ships: h.ships('雪風改二') }),
          group('时雨改二/改三', 1, { ships: h.ships('時雨改二', '時雨改三') }),
        ],
      },
    }),
  },
  {
    // memo：能代改二旗舰 + 驱逐 ≥3，2-4、3-2、5-3、7-1 Boss S + 7-2(P2) S
    questId: 936,
    code: 'B164',
    build: (h) => ({
      tasks: [
        boss(2, 4, S, 1),
        boss(3, 2, S, 1),
        boss(5, 3, S, 1),
        boss(7, 1, S, 1),
        node(h, 7, 2, S, 1, 'P2', '-2'),
      ],
      fleetGoal: {
        groups: [
          group('能代改二', 1, { ships: h.ships('能代改二'), flagship: true }),
          group('驱逐舰', 3, { stypes: [2] }),
        ],
      },
    }),
  },
  {
    // memo：含曙改二与潮改二，2-3、3-2、4-4、5-4 S 胜
    questId: 937,
    code: 'B165',
    build: (h) => ({
      tasks: [boss(2, 3, S, 1), boss(3, 2, S, 1), boss(4, 4, S, 1), boss(5, 4, S, 1)],
      fleetGoal: {
        groups: [
          group('曙改二', 1, { ships: h.ships('曙改二') }),
          group('潮改二', 1, { ships: h.ships('潮改二') }),
        ],
      },
    }),
  },
  {
    // memo：矢矧改二（或乙）旗舰 + 驱逐 ≥2，1-4、2-5、5-3、5-5 S 胜
    questId: 940,
    code: 'B168',
    build: (h) => ({
      tasks: [boss(1, 4, S, 1), boss(2, 5, S, 1), boss(5, 3, S, 1), boss(5, 5, S, 1)],
      fleetGoal: {
        groups: [
          group('矢矧改二/改二乙', 1, { ships: h.ships('矢矧改二', '矢矧改二乙'), flagship: true }),
          group('驱逐舰', 2, { stypes: [2] }),
        ],
      },
    }),
  },
  {
    // memo：Gambier Bay Mk.II 旗舰 + Fletcher/Johnston ≥1 的第一舰队，
    // 2-4、3-5 各 S 胜 2 次，6-4 A 胜 2 次
    questId: 949,
    code: 'B170',
    build: (h) => ({
      tasks: [boss(2, 4, S, 2), boss(3, 5, S, 2), boss(6, 4, A, 2)],
      fleetGoal: {
        fleetId: 1,
        groups: [
          group('Gambier Bay Mk.II', 1, { ships: h.ships('Gambier Bay Mk.II'), flagship: true }),
          group('Fletcher 级', 1, { ships: h.chain('Fletcher', 'Johnston') }),
        ],
      },
    }),
  },
  {
    // memo：驱逐 ≥3，1-3、1-4、2-1、2-2 各 1 次 S 胜
    questId: 952,
    code: 'B171',
    build: () => ({
      tasks: [boss(1, 3, S, 1), boss(1, 4, S, 1), boss(2, 1, S, 1), boss(2, 2, S, 1)],
      fleetGoal: { groups: [group('驱逐舰', 3, { stypes: [2] })] },
    }),
  },
  {
    // memo：山风改二/丁旗舰，驱逐/海防（含旗舰）≥3，1-2、1-3、1-4、1-5 各一次 S 胜
    questId: 957,
    code: 'B172',
    build: (h) => ({
      tasks: [boss(1, 2, S, 1), boss(1, 3, S, 1), boss(1, 4, S, 1), boss(1, 5, S, 1)],
      fleetGoal: {
        groups: [
          group('山风改二/改二丁', 1, { ships: h.ships('山風改二', '山風改二丁'), flagship: true }),
          // 「含旗舰」：山风自己是驱逐，算在 3 艘里
          group('驱逐舰/海防舰', 3, { stypes: [1, 2], overlapOk: true }),
        ],
      },
    }),
  },
  {
    // memo：山风改二(丁)/江风改二/海风改二 任意两艘，2-2、7-2(P2)、5-1、6-4 各一次 S 胜
    questId: 958,
    code: 'B173',
    build: (h) => ({
      tasks: [
        boss(2, 2, S, 1),
        node(h, 7, 2, S, 1, 'P2', '-2'),
        boss(5, 1, S, 1),
        boss(6, 4, S, 1),
      ],
      fleetGoal: {
        groups: [
          group('山风改二(丁)/江风改二/海风改二', 2, {
            ships: h.ships('山風改二', '山風改二丁', '江風改二', '海風改二'),
          }),
        ],
      },
    }),
  },
  {
    // memo：含黑潮改二与亲潮改二，2-4、5-4、7-2(P2) 各 S 胜 2 次
    questId: 961,
    code: 'B174',
    build: (h) => ({
      tasks: [boss(2, 4, S, 2), boss(5, 4, S, 2), node(h, 7, 2, S, 2, 'P2', '-2')],
      fleetGoal: {
        groups: [
          group('黑潮改二', 1, { ships: h.ships('黒潮改二') }),
          group('亲潮改二', 1, { ships: h.ships('親潮改二') }),
        ],
      },
    }),
  },
  // ---- 演习 ----
  //
  // 演习的计数轴（评价 + 次数）由 quest-practice-rules 从中文正文推，推得准；缺的是另一半
  // ——**编成门**。quest-fleet-rules 那一档只往松了裁：读不准的原子一律丢掉（依据见那个
  // 文件头的「安全方向」），于是「旗舰是谁」「另一艘放 2 号位」「七艘里凑四艘」这类要求，
  // 在下面这十条上或者整条没落地、或者落成了另一个形状——松的紧的都有。
  //
  // poi 的 quest_goal 把这些编得很全（escortship / escortshiptype / escortshipclass /
  // flagship / flagshiptype / flagshipclass / secondship），但 decodePoiQuestGoal 的 bare()
  // 只认 description/required/init，带这些字段的整条被拒——上游有货，进不来。
  //
  // 所以这十条在这里逐条人工解码。**每条的编成口径都拿游戏日文原文核过**（wikiwiki
  // 「任務/演習任務」页的任務内容栏，2026-08-30 逐条抄回；318/Cm2 直接用本机账本
  // questlist 的 api_detail，那是一手），再与中文 desc/memo2、poi 的编码三方互证。
  // 三方不一致的按「只往松了裁」办，分歧写在那一条的注里（Cy3 有一处）。
  {
    // 日文原文（账本 api_detail）：伊良湖支援任務:軽巡二隻以上配備した第一艦隊で本日中に
    // 演習で3回「勝利」、その後、第一艦隊旗艦に戦闘糧食を2つ装備せよ！
    // 补的是「第一艦隊」这一维——自研推导只解舰种与数量，舰队号不在它的射程里；
    // 拿第二舰队打演习游戏一次都不算，我们照计。
    // 「勝利」没写评价字母 = B 判定以上（口径出处见 quest-practice-rules 文件头）。
    // 战斗粮食那一半**不装成 stateGoal**：它写在「その後」，演习期间本来就不该拦人，
    // 而 stateGoal 不满足会让钦的「当前编成可直接做」整个变空。partial 照旧。
    questId: 318,
    code: 'Cm2',
    build: () => ({
      partial: true,
      tasks: [{ kind: 'exercise', rank: B, count: 3 }],
      fleetGoal: { fleetId: 1, groups: [group('轻巡', 2, { stypes: [3] })] },
    }),
  },
  {
    // 日文原文：駆逐艦または海防艦計4隻(軽巡級1隻導入可能)を含む演習艦隊を編成、
    // 同演習艦隊による演習で本日中に【A判定】以上の勝利を4回以上達成せよ！
    // 自研推导把括号里的「可以加入」当允许丢掉了（那一步对），但剩下的「驱逐/海防4艘」
    // 比游戏**严**：3 驱逐 + 1 轻巡级游戏算，我们拦。两条数量线合起来才是原文——
    // 驱逐/海防 ≥3，且三者合计 ≥4。伞组是前一组的超集，标 overlapOk 不占去重名额，
    // 否则 3+4=7 个名额塞不进 6 艘。poi 的 escortshiptype 编的就是这两条线。
    // 「軽巡級1隻」这个上限不落地：那是给**凑数的那 4 艘**定的，不是全队上限，
    // 按全队上限落会把 4 驱逐 + 2 轻巡（后两艘是自由舰）的合规编成拦下。
    questId: 342,
    code: 'Cq4',
    build: () => ({
      tasks: [{ kind: 'exercise', rank: A, count: 4 }],
      fleetGoal: {
        groups: [
          group('驱逐舰/海防舰', 3, { stypes: [2, 1] }),
          group('驱逐/海防/轻巡级', 4, { stypes: [2, 1, 3, 4, 21], overlapOk: true }),
        ],
      },
    }),
  },
  {
    // 日文原文：「Warspite」「金剛」「Ark Royal」「Nelson」及びJ級駆逐艦から4隻以上含む
    // 艦隊を編成！同ティータイム艦隊で、本日中に【A判定】以上の勝利を4回以上達成せよ！
    // 自研推导整条弃门并标 ≈：正文的「四艘」跟在具名舰串后面，只落「驱逐舰4艘」会把
    // 「七艘里凑四艘」读成「必须四艘驱逐舰」（见 quest-fleet-rules 的 unknownSpansOf）。
    // 这里按原文并成一个组。J 級写**舰级**不写名单，因为原文写的就是「J級駆逐艦」，
    // 将来这一级加人自动跟上；memo2 那句只列了 Jervis/Janus/Javelin 三个人。
    questId: 345,
    code: 'Cy1',
    build: (h) => ({
      tasks: [{ kind: 'exercise', rank: A, count: 4 }],
      fleetGoal: {
        groups: [
          group('Warspite/金刚/Ark Royal/Nelson/J级驱逐舰', 4, {
            ships: h.chain('Warspite', '金剛', 'Ark Royal', 'Nelson'),
            ctypes: [h.ctype('Jervis')],
          }),
        ],
      },
    }),
  },
  {
    // 日文原文：旗艦に軽巡級(雷巡を除く)、旗艦含む3隻以上の軽巡級と随伴駆逐艦2隻を
    // 配備した軽巡演習艦隊を編成、同艦隊により本日中に演習で【A判定】以上の勝利を
    // 4回以上達成せよ！
    // 「雷巡を除く」原文只挂在**旗舰**那一维上，后半句「3隻以上の軽巡級」没有除外——
    // 所以旗舰收紧到轻巡/练巡，凑数那 3 艘仍按最宽的「轻巡级」（含雷巡）算。
    // 中文 memo2 与 poi 把 3 艘那一维也写成了不含雷巡（[3,21]），比原文严一格，
    // 是「门比游戏严」的方向，不跟。
    // 自研推导那一版旗舰门用的是含雷巡的全集：大井当旗舰它也放行。
    questId: 348,
    code: 'Cy3',
    build: () => ({
      tasks: [{ kind: 'exercise', rank: A, count: 4 }],
      fleetGoal: {
        groups: [
          group('轻巡/练巡', 1, { stypes: [3, 21], flagship: true, overlapOk: true }),
          group('轻巡级', 3, { stypes: [3, 4, 21] }),
          group('驱逐舰', 2, { stypes: [2] }),
        ],
      },
    }),
  },
  {
    // 日文原文：旗艦に「改装特務空母」、僚艦に「Fletcher級駆逐艦」または
    // 「John C.Butler級護衛駆逐艦」計2隻以上を含む任務部隊を編成。同艦隊で、
    // 本日中に【S判定】勝利を4回以上達成せよ！
    // 「改装特務空母」是 Gambier Bay Mk.II 的艦種名，指的就是这一个形态（poi 与 memo2
    // 都点了名），不是整条改造链——Gambier Bay 与改是護衛空母，不算。
    // 僚舰按**舰级**判：原文写的是两个级名，不是四个人名。按 memo2 那句「四选二」的
    // 名单落地会漏掉同为 Fletcher 級的 Richard P.Leary。
    // 自研推导把旗舰与僚舰并成了一个组：旗舰门整个没了，Gambier Bay Mk.II 本人还能顶
    // 一个僚舰名额，只带一艘 Fletcher 也算。
    questId: 354,
    code: 'Cy6',
    build: (h) => ({
      tasks: [{ kind: 'exercise', rank: S, count: 4 }],
      fleetGoal: {
        groups: [
          group('Gambier Bay Mk.II', 1, { ships: h.ships('Gambier Bay Mk.II'), flagship: true }),
          // 级名写中文真名（约翰·C·巴特勒级 = kcwiki-ships ctype 87 的「级别」原字，
          // 实体侧「涉及舰级」显示的就是它）——2026-09-01 用户拍板与同抽屉实体侧对齐。
          group('弗莱彻级/约翰·C·巴特勒级', 2, {
            ctypes: [h.ctype('Fletcher'), h.ctype('Samuel B.Roberts')],
          }),
        ],
      },
    }),
  },
  {
    // 日文原文：旗艦に「黒潮改二」または「親潮改二」、そのいずれかを二番艦とする
    // 演習艦隊で、本日中に【S判定】勝利を4回以上達成せよ！
    // 「二番艦」那一维自研推导一概不做（见 quest-fleet-rules 文件头），于是只剩旗舰门，
    // 另一艘随便带都算。position 引擎本来就判得了，这一条正好是它装得下的形状：
    // 1 号位与 2 号位各要这两艘里的一艘。
    questId: 355,
    code: 'Cy7',
    build: (h) => ({
      tasks: [{ kind: 'exercise', rank: S, count: 4 }],
      fleetGoal: {
        groups: [
          group('黑潮改二/亲潮改二', 1, {
            ships: h.ships('黒潮改二', '親潮改二'),
            flagship: true,
          }),
          group('另一艘（黑潮改二/亲潮改二）', 1, {
            ships: h.ships('黒潮改二', '親潮改二'),
            position: 2,
          }),
        ],
      },
    }),
  },
  {
    // 日文原文：「春雨」を旗艦として「村雨」「夕立」「五月雨」「白露」「時雨」のうち
    // 3隻以上を含む演習艦隊を編成。同演習艦隊で本日中に演習【A判定】勝利4回以上を
    // 達成せよ！
    // 自研推导把春雨与那五艘并成一个组凑 3 艘并标 ≈：旗舰门没了，春雨本人还能顶名额，
    // 于是只带村雨/夕立/五月雨也算。原文是两回事——春雨必须旗舰，另外五艘里再凑三艘。
    questId: 371,
    code: 'Cy12',
    build: (h) => ({
      tasks: [{ kind: 'exercise', rank: A, count: 4 }],
      fleetGoal: {
        groups: [
          group('春雨', 1, { ships: h.chain('春雨'), flagship: true }),
          group('村雨/夕立/五月雨/白露/时雨', 3, {
            ships: h.chain('村雨', '夕立', '五月雨', '白露', '時雨'),
          }),
        ],
      },
    }),
  },
  {
    // 日文原文：【艦隊防空演習】「秋月型」駆逐艦を旗艦として他に駆逐艦2隻、
    // 航空戦艦2隻以上の艦隊を編成。同演習艦隊で本日中に演習【A判定】勝利4回以上を
    // 達成せよ！
    // 分水岭是「他に」：那 2 艘驱逐舰在秋月型旗舰**之外**。中文 desc 的「另外2艘驱逐舰」
    // 与 memo2 的算式（旗舰 + 2 航战 + 2 驱逐 + 自由舰 = 6）同口径。
    // 自研推导给秋月型那组标了 overlapOk，秋月本人顶掉一个驱逐名额，只带 1 艘僚驱也算。
    questId: 372,
    code: 'Cy13',
    build: (h) => ({
      tasks: [{ kind: 'exercise', rank: A, count: 4 }],
      fleetGoal: {
        groups: [
          group('秋月型', 1, { ctypes: [h.ctype('秋月')], flagship: true }),
          group('驱逐舰', 2, { stypes: [2] }),
          group('航空战舰', 2, { stypes: [10] }),
        ],
      },
    }),
  },
  {
    // 日文原文：【フランス艦隊演習】フランス生まれの艦艇を旗艦に配備。同旗艦を含む
    // フランス艦艇3隻以上を配備した演習艦隊を編成。同艦隊で本日中に演習【A判定】
    // 勝利4回以上を達成せよ！Merci♪
    // 自研推导认出了「法国船 3 艘」，旗舰那一维没认出来——三艘法国舰随便摆哪都算。
    // 「同旗艦を含む」= 旗舰算在 3 艘里，所以是同一个组加一道旗舰门，不另起一组。
    questId: 373,
    code: 'Cy14',
    build: (h) => ({
      tasks: [{ kind: 'exercise', rank: A, count: 4 }],
      fleetGoal: {
        groups: [group('法国舰娘', 3, { ships: h.nationality([6]), flagship: true })],
      },
    }),
  },
  {
    // 日文原文：【後期二駆演習】「早霜」「秋霜」「清霜」の1隻を旗艦、僚艦に「早霜」
    // 「秋霜」「清霜」「朝霜」2隻を含む後期編成の夕雲型第二駆逐隊を含む艦隊で、
    // 本日中に演習【S判定】勝利4回以上を達成せよ！
    // 「旗舰从三艘里挑一个、僚舰再从四艘里挑两个」是两级嵌套的几选几，自研推导整条弃门
    // 并标 ≈。拆成「旗舰子集一道门 + 全集凑 3 艘一道门」两组就装得下：旗舰那组标
    // overlapOk——旗舰本人算在这 3 艘里，不另占名额。
    questId: 377,
    code: 'Cy16',
    build: (h) => ({
      tasks: [{ kind: 'exercise', rank: S, count: 4 }],
      fleetGoal: {
        groups: [
          group('早霜/秋霜/清霜', 1, {
            ships: h.chain('早霜', '秋霜', '清霜'),
            flagship: true,
            overlapOk: true,
          }),
          group('早霜/秋霜/清霜/朝霜', 3, {
            ships: h.chain('早霜', '秋霜', '清霜', '朝霜'),
          }),
        ],
      },
    }),
  },
  // ---- 工厂 / 装备 ----
  {
    // memo：Ark Royal 秘书舰，一号格 ★max Swordfish；废弃 Swordfish×1、Fulmar×2；
    // 备熟练搭乘员×1、弹药/铝各 1500
    questId: 654,
    code: 'Fy2',
    build: (h) => ({
      tasks: [
        { kind: 'scrapEquip', equipId: h.equip('Swordfish'), count: 1 },
        { kind: 'scrapEquip', equipId: h.equip('Fulmar'), count: 2 },
      ],
      stateGoal: {
        secretary: { label: 'Ark Royal', ships: h.chain('Ark Royal'), stypes: [] },
        equipment: [
          { label: 'Swordfish（★max·第1格）', mstIds: [h.equip('Swordfish')], slot: 1, maxModified: true },
        ],
      },
      stockGoals: [
        { kind: 'useitem', id: h.useitem('熟練搭乗員'), label: '熟练搭乘员', count: 1 },
        { kind: 'material', id: 1, label: '弹药', count: 1500 },
        { kind: 'material', id: 3, label: '铝土', count: 1500 },
      ],
    }),
  },
  {
    // memo：加贺改二护（限定该形态）第一格装 TBM-3D；废弃 TBF×2、流星×1、流星改×1；
    // 备弹药 1840、铝 6200、新型航空兵装资材×2、熟练搭乘员×1
    questId: 698,
    code: 'F91',
    build: (h) => ({
      tasks: [
        { kind: 'scrapEquip', equipId: h.equip('TBF'), count: 2 },
        { kind: 'scrapEquip', equipId: h.equip('流星'), count: 1 },
        { kind: 'scrapEquip', equipId: h.equip('流星改'), count: 1 },
      ],
      stateGoal: {
        secretary: { label: '加贺改二护', ships: h.ships('加賀改二護'), stypes: [] },
        equipment: [{ label: 'TBM-3D（第1格）', mstIds: [h.equip('TBM-3D')], slot: 1 }],
      },
      stockGoals: [
        { kind: 'material', id: 1, label: '弹药', count: 1840 },
        { kind: 'material', id: 3, label: '铝土', count: 6200 },
        { kind: 'useitem', id: h.useitem('新型航空兵装資材'), label: '新型航空兵装资材', count: 2 },
        { kind: 'useitem', id: h.useitem('熟練搭乗員'), label: '熟练搭乘员', count: 1 },
      ],
    }),
  },
  // 近代化改修族（Gy1-Gy4 / G10-G11）。六条的骨架一样：备资源 + 对某某舰用 N 艘
  // 某某舰改修成功 2 次。计数条件由 powerupCond 逐次校验（目标舰种/舰级 + 素材舰种
  // 与艘数），所以不再标 ≈；资源那一半走 stockGoals，两半合起来就是整条任务，
  // 也不 partial。
  //
  // 上游为什么都不管：poi 的 quest_goal 给 714-717 写了 materialShipType /
  // materialShipMinCount，decodePoiQuestGoal 的 bare() 只认 description/required/init，
  // 整条被拒；718/719 poi 根本没有。于是这四条一路掉到中文正文兜底，而正文里
  // 「成功2次」与「近代化改修」不在同一小句、够不着取数窗口 → 全都算成 count 1。
  // **玩家看见的「1 次就满」就是这么来的**（2026-08-30 反馈：Gy1 实际要操作两次）。
  {
    // memo：备钢 600、铝 300；对任意驱逐舰，每次同时用 3 艘驱逐舰改修成功 2 次
    questId: 714,
    code: 'Gy1',
    build: () => ({
      tasks: [{
        kind: 'action',
        action: 'powerup',
        label: '近代化改修（驱逐舰 · 素材驱逐舰 ×3）',
        count: 2,
        powerupCond: {
          targetStypes: DESTROYER,
          materialStypes: DESTROYER,
          minMaterials: 3,
        },
      }],
      stockGoals: [
        { kind: 'material', id: 2, label: '钢材', count: 600 },
        { kind: 'material', id: 3, label: '铝土', count: 300 },
      ],
    }),
  },
  {
    // memo：备钢 900、铝 500；对任意驱逐舰，每次同时用 3 艘**軽巡洋艦**改修成功 2 次。
    // 这条正文写的不是「軽巡」級，雷巡/练巡不算——poi 那条也只写了 [3]
    questId: 715,
    code: 'Gy2',
    build: () => ({
      tasks: [{
        kind: 'action',
        action: 'powerup',
        label: '近代化改修（驱逐舰 · 素材轻巡洋舰 ×3）',
        count: 2,
        powerupCond: {
          targetStypes: DESTROYER,
          materialStypes: LIGHT_CRUISER_ONLY,
          minMaterials: 3,
        },
      }],
      stockGoals: [
        { kind: 'material', id: 2, label: '钢材', count: 900 },
        { kind: 'material', id: 3, label: '铝土', count: 500 },
      ],
    }),
  },
  {
    // memo：备钢 800、铝 400；对任意「軽巡」級，每次同时用 3 艘「軽巡」級改修成功 2 次
    questId: 716,
    code: 'Gy3',
    build: () => ({
      tasks: [{
        kind: 'action',
        action: 'powerup',
        label: '近代化改修（轻巡级 · 素材轻巡级 ×3）',
        count: 2,
        powerupCond: {
          targetStypes: LIGHT_CRUISER_CLASS,
          materialStypes: LIGHT_CRUISER_CLASS,
          minMaterials: 3,
        },
      }],
      stockGoals: [
        { kind: 'material', id: 2, label: '钢材', count: 800 },
        { kind: 'material', id: 3, label: '铝土', count: 400 },
      ],
    }),
  },
  {
    // memo：备钢 900、弹 900；对任意「軽巡」級，每次同时用 3 艘「重巡」級改修成功 2 次
    questId: 717,
    code: 'Gy4',
    build: () => ({
      tasks: [{
        kind: 'action',
        action: 'powerup',
        label: '近代化改修（轻巡级 · 素材重巡级 ×3）',
        count: 2,
        powerupCond: {
          targetStypes: LIGHT_CRUISER_CLASS,
          materialStypes: HEAVY_CRUISER_CLASS,
          minMaterials: 3,
        },
      }],
      stockGoals: [
        { kind: 'material', id: 2, label: '钢材', count: 900 },
        { kind: 'material', id: 1, label: '弹药', count: 900 },
      ],
    }),
  },
  {
    // memo：备钢/弹 1100；对最上型，每次同时用 3 艘「軽巡」級改修成功 2 次。
    // 最上型按**舰级**判：这一级横跨重巡/航巡/軽空母/水母四个舰种（最上改二特是水母、
    // 鈴谷航改二是軽空母），按舰种判一个都圈不住。舰级号从主数据现查，不写死
    questId: 718,
    code: 'G10',
    build: (h) => ({
      tasks: [{
        kind: 'action',
        action: 'powerup',
        label: '近代化改修（最上型 · 素材轻巡级 ×3）',
        count: 2,
        powerupCond: {
          targetCtypes: [h.ctype('最上')],
          materialStypes: LIGHT_CRUISER_CLASS,
          minMaterials: 3,
        },
      }],
      stockGoals: [
        { kind: 'material', id: 2, label: '钢材', count: 1100 },
        { kind: 'material', id: 1, label: '弹药', count: 1100 },
      ],
    }),
  },
  {
    // memo：备钢/弹 1200；对最上型，每次同时用**4 艘**「重巡」級改修成功 2 次。
    // 素材是 4 艘不是 3 艘——正文与 wikiwiki 改装任務页同口径（要改修用「重巡」級 8 隻）
    questId: 719,
    code: 'G11',
    build: (h) => ({
      tasks: [{
        kind: 'action',
        action: 'powerup',
        label: '近代化改修（最上型 · 素材重巡级 ×4）',
        count: 2,
        powerupCond: {
          targetCtypes: [h.ctype('最上')],
          materialStypes: HEAVY_CRUISER_CLASS,
          minMaterials: 4,
        },
      }],
      stockGoals: [
        { kind: 'material', id: 2, label: '钢材', count: 1200 },
        { kind: 'material', id: 1, label: '弹药', count: 1200 },
      ],
    }),
  },
  {
    // memo：由良改二秘书舰，第1格 ★max 零式水上侦察机11型乙；废弃零侦×3、瑞云×3；
    // 备燃 1300、铝 1700、新型航空兵装资材×1、战斗详报×1、熟练搭乘员×3
    questId: 1106,
    code: 'F101',
    build: (h) => ({
      tasks: [
        { kind: 'scrapEquip', equipId: h.equip('零式水上偵察機'), count: 3 },
        { kind: 'scrapEquip', equipId: h.equip('瑞雲'), count: 3 },
      ],
      stateGoal: {
        secretary: { label: '由良改二', ships: h.ships('由良改二'), stypes: [] },
        equipment: [
          {
            label: '零式水上侦察机11型乙（★max·第1格）',
            mstIds: [h.equip('零式水上偵察機11型乙')],
            slot: 1,
            maxModified: true,
          },
        ],
      },
      stockGoals: [
        { kind: 'material', id: 0, label: '燃料', count: 1300 },
        { kind: 'material', id: 3, label: '铝土', count: 1700 },
        { kind: 'useitem', id: h.useitem('新型航空兵装資材'), label: '新型航空兵装资材', count: 1 },
        { kind: 'useitem', id: h.useitem('戦闘詳報'), label: '战斗详报', count: 1 },
        { kind: 'useitem', id: h.useitem('熟練搭乗員'), label: '熟练搭乘员', count: 3 },
      ],
    }),
  },
  {
    // memo：备 一式陆攻二二型甲(★max)×1、一式陆攻×2、熟练搭乘员×3。
    // 库存对照不校验 ★ → 标 ≈；无可计数动作 → partial
    questId: 1111,
    code: 'F105',
    build: (h) => ({
      approx: true,
      partial: true,
      tasks: [],
      stockGoals: [
        { kind: 'equip', id: h.equip('一式陸攻 二二型甲'), label: '一式陆攻 二二型甲（需★max）', count: 1 },
        { kind: 'equip', id: h.equip('一式陸攻'), label: '一式陆攻', count: 2 },
        { kind: 'useitem', id: h.useitem('熟練搭乗員'), label: '熟练搭乘员', count: 3 },
      ],
    }),
  },
  {
    // memo：备 キ102乙×1、二式复战屠龙丙型×1、熟练搭乘员×2、新型航空兵装资材×4
    questId: 1113,
    code: 'F107',
    build: (h) => ({
      partial: true,
      tasks: [],
      stockGoals: [
        { kind: 'equip', id: h.equip('キ102乙'), label: 'キ102乙', count: 1 },
        { kind: 'equip', id: h.equip('二式複戦 屠龍 丙型'), label: '二式复战 屠龙 丙型', count: 1 },
        { kind: 'useitem', id: h.useitem('熟練搭乗員'), label: '熟练搭乘员', count: 2 },
        { kind: 'useitem', id: h.useitem('新型航空兵装資材'), label: '新型航空兵装资材', count: 4 },
      ],
    }),
  },
  {
    // memo：川内改二或由良改二秘书舰，第1格 ★max 九八式水上侦察机(夜侦)；
    // 备 ★max 零式水上侦察机11型乙×1（★不校验标 ≈）、改修资材×13、开发资材×13、熟练搭乘员×3
    questId: 1117,
    code: 'F111',
    build: (h) => ({
      approx: true,
      tasks: [],
      partial: true,
      stateGoal: {
        secretary: { label: '川内改二/由良改二', ships: h.ships('川内改二', '由良改二'), stypes: [] },
        equipment: [
          {
            label: '九八式水上侦察机(夜侦)（★max·第1格）',
            mstIds: [h.equip('九八式水上偵察機(夜偵)')],
            slot: 1,
            maxModified: true,
          },
        ],
      },
      stockGoals: [
        { kind: 'equip', id: h.equip('零式水上偵察機11型乙'), label: '零式水上侦察机11型乙（需★max）', count: 1 },
        { kind: 'useitem', id: h.useitem('改修資材'), label: '改修资材', count: 13 },
        { kind: 'useitem', id: h.useitem('開発資材'), label: '开发资材', count: 13 },
        { kind: 'useitem', id: h.useitem('熟練搭乗員'), label: '熟练搭乘员', count: 3 },
      ],
    }),
  },
  {
    // memo：塞缪尔·B·罗伯茨 Mk.II 秘书舰，第1格 5inch单装炮 Mk.30（无需改修）；
    // 备开发资材×15、新型兵装资材×2、新型喷进装备开发资材×2、弹药 960
    questId: 1118,
    code: 'F112',
    build: (h) => ({
      tasks: [],
      partial: true,
      stateGoal: {
        secretary: {
          label: '塞缪尔·B·罗伯茨 Mk.II',
          ships: h.ships('Samuel B.Roberts Mk.II'),
          stypes: [],
        },
        equipment: [
          { label: '5inch单装炮 Mk.30（第1格）', mstIds: [h.equip('5inch単装砲 Mk.30')], slot: 1 },
        ],
      },
      stockGoals: [
        { kind: 'useitem', id: h.useitem('開発資材'), label: '开发资材', count: 15 },
        { kind: 'useitem', id: h.useitem('新型兵装資材'), label: '新型兵装资材', count: 2 },
        { kind: 'useitem', id: h.useitem('新型噴進装備開発資材'), label: '新型喷进装备开发资材', count: 2 },
        { kind: 'material', id: 1, label: '弹药', count: 960 },
      ],
    }),
  },
  {
    // memo：深雪改二秘书舰，第1格 发烟装置(烟幕)；备开发资材×12、新型兵装资材×2、
    // 发烟装置(烟幕)×2、燃 480、铝 350
    questId: 1127,
    code: 'F115',
    build: (h) => ({
      tasks: [],
      partial: true,
      stateGoal: {
        secretary: { label: '深雪改二', ships: h.ships('深雪改二'), stypes: [] },
        equipment: [
          { label: '发烟装置(烟幕)（第1格）', mstIds: [h.equip('発煙装置(煙幕)')], slot: 1 },
        ],
      },
      stockGoals: [
        { kind: 'useitem', id: h.useitem('開発資材'), label: '开发资材', count: 12 },
        { kind: 'useitem', id: h.useitem('新型兵装資材'), label: '新型兵装资材', count: 2 },
        { kind: 'equip', id: h.equip('発煙装置(煙幕)'), label: '发烟装置(烟幕)', count: 2 },
        { kind: 'material', id: 0, label: '燃料', count: 480 },
        { kind: 'material', id: 3, label: '铝土', count: 350 },
      ],
    }),
  },
  {
    // memo：榛名改二乙/丙秘书舰，第1格 35.6cm连装炮改三(炫光迷彩)★+3 以上；
    // 备开发资材×48、新型炮熕兵装资材×2、35.6cm连装炮×5、弹 900、铝 800
    questId: 1128,
    code: 'F116',
    build: (h) => ({
      tasks: [],
      partial: true,
      stateGoal: {
        secretary: { label: '榛名改二乙/丙', ships: h.ships('榛名改二乙', '榛名改二丙'), stypes: [] },
        equipment: [
          {
            label: '35.6cm连装炮改三(炫光迷彩)（★+3·第1格）',
            mstIds: [h.equip('35.6cm連装砲改三(ダズル迷彩仕様)')],
            slot: 1,
            minLevel: 3,
          },
        ],
      },
      stockGoals: [
        { kind: 'useitem', id: h.useitem('開発資材'), label: '开发资材', count: 48 },
        { kind: 'useitem', id: h.useitem('新型砲熕兵装資材'), label: '新型炮熕兵装资材', count: 2 },
        { kind: 'equip', id: h.equip('35.6cm連装砲'), label: '35.6cm连装炮', count: 5 },
        { kind: 'material', id: 1, label: '弹药', count: 900 },
        { kind: 'material', id: 3, label: '铝土', count: 800 },
      ],
    }),
  },
  {
    // memo：潜水舰系秘书舰，第1格 ★max 后期型舰首鱼雷(6门)；备开发资材×36、
    // 新型兵装资材×2、61cm三连装(酸素)鱼雷×4、熟练见张员×3、弹 800
    questId: 1129,
    code: 'F117',
    build: (h) => ({
      tasks: [],
      partial: true,
      stateGoal: {
        // 同 group() 的缺省：evaluateStateGoal 里 ships === 'any' 也是短路分支，
        // 写 'any' 会让后面的 stypes 读不到，秘书舰门变成「谁当都行」
        secretary: { label: '潜水舰/潜水空母', ships: [], stypes: [13, 14] },
        equipment: [
          {
            label: '后期型舰首鱼雷(6门)（★max·第1格）',
            mstIds: [h.equip('後期型艦首魚雷(6門)')],
            slot: 1,
            maxModified: true,
          },
        ],
      },
      stockGoals: [
        { kind: 'useitem', id: h.useitem('開発資材'), label: '开发资材', count: 36 },
        { kind: 'useitem', id: h.useitem('新型兵装資材'), label: '新型兵装资材', count: 2 },
        { kind: 'equip', id: h.equip('61cm三連装(酸素)魚雷'), label: '61cm三连装(酸素)鱼雷', count: 4 },
        { kind: 'equip', id: h.equip('熟練見張員'), label: '熟练见张员', count: 3 },
        { kind: 'material', id: 1, label: '弹药', count: 800 },
      ],
    }),
  },
  {
    // memo：清霜改二/丁秘书舰，第1格 12.7cm连装炮D型改二 ★+8 以上；
    // 备开发资材×22、新型炮熕兵装资材×1、12.7cm连装炮×10、弹 350、改修资材×8
    questId: 1132,
    code: 'F120',
    build: (h) => ({
      tasks: [],
      partial: true,
      stateGoal: {
        secretary: { label: '清霜改二/改二丁', ships: h.ships('清霜改二', '清霜改二丁'), stypes: [] },
        equipment: [
          {
            label: '12.7cm连装炮D型改二（★+8·第1格）',
            mstIds: [h.equip('12.7cm連装砲D型改二')],
            slot: 1,
            minLevel: 8,
          },
        ],
      },
      stockGoals: [
        { kind: 'useitem', id: h.useitem('開発資材'), label: '开发资材', count: 22 },
        { kind: 'useitem', id: h.useitem('新型砲熕兵装資材'), label: '新型炮熕兵装资材', count: 1 },
        { kind: 'equip', id: h.equip('12.7cm連装砲'), label: '12.7cm连装炮', count: 10 },
        { kind: 'material', id: 1, label: '弹药', count: 350 },
        { kind: 'useitem', id: h.useitem('改修資材'), label: '改修资材', count: 8 },
      ],
    }),
  },
  {
    // memo：清霜改二/丁或朝霜改二秘书舰，第1格 22号对水上电探改四(后期调整型)；
    // 备开发资材×40、13号对空电探改(后期型)★+4×1（★不校验标 ≈）、改修资材×6
    questId: 1133,
    code: 'F121',
    build: (h) => ({
      approx: true,
      tasks: [],
      partial: true,
      stateGoal: {
        secretary: {
          label: '清霜改二/改二丁/朝霜改二',
          ships: h.ships('清霜改二', '清霜改二丁', '朝霜改二'),
          stypes: [],
        },
        equipment: [
          {
            label: '22号对水上电探改四(后期调整型)（第1格）',
            mstIds: [h.equip('22号対水上電探改四(後期調整型)')],
            slot: 1,
          },
        ],
      },
      stockGoals: [
        { kind: 'useitem', id: h.useitem('開発資材'), label: '开发资材', count: 40 },
        { kind: 'equip', id: h.equip('13号対空電探改(後期型)'), label: '13号对空电探改(后期型)（需★+4）', count: 1 },
        { kind: 'useitem', id: h.useitem('改修資材'), label: '改修资材', count: 6 },
      ],
    }),
  },
  {
    // memo：時雨改二/改三或満潮改二秘书舰，第1格 ★max 22号对水上电探改四；
    // 备开发资材×22、新型兵装资材×2、22号对水上电探×4、改修资材×6
    questId: 1134,
    code: 'F122',
    build: (h) => ({
      tasks: [],
      partial: true,
      stateGoal: {
        secretary: {
          label: '時雨改二/改三/満潮改二',
          ships: h.ships('時雨改二', '時雨改三', '満潮改二'),
          stypes: [],
        },
        equipment: [
          {
            label: '22号对水上电探改四（★max·第1格）',
            mstIds: [h.equip('22号対水上電探改四')],
            slot: 1,
            maxModified: true,
          },
        ],
      },
      stockGoals: [
        { kind: 'useitem', id: h.useitem('開発資材'), label: '开发资材', count: 22 },
        { kind: 'useitem', id: h.useitem('新型兵装資材'), label: '新型兵装资材', count: 2 },
        { kind: 'equip', id: h.equip('22号対水上電探'), label: '22号对水上电探', count: 4 },
        { kind: 'useitem', id: h.useitem('改修資材'), label: '改修资材', count: 6 },
      ],
    }),
  },
  {
    // memo：雾岛改二丙秘书舰，第1格 35.6cm连装炮改二 ★+8 以上；废弃 35.6cm连装炮×8；
    // 备 35.6cm连装炮改×1、新型炮熕兵装资材×2、钢 7800、新型兵装资材×2
    questId: 1143,
    code: 'F128',
    build: (h) => ({
      tasks: [{ kind: 'scrapEquip', equipId: h.equip('35.6cm連装砲'), count: 8 }],
      stateGoal: {
        secretary: { label: '雾岛改二丙', ships: h.ships('霧島改二丙'), stypes: [] },
        equipment: [
          {
            label: '35.6cm连装炮改二（★+8·第1格）',
            mstIds: [h.equip('35.6cm連装砲改二')],
            slot: 1,
            minLevel: 8,
          },
        ],
      },
      stockGoals: [
        { kind: 'equip', id: h.equip('35.6cm連装砲改'), label: '35.6cm连装炮改', count: 1 },
        { kind: 'useitem', id: h.useitem('新型砲熕兵装資材'), label: '新型炮熕兵装资材', count: 2 },
        { kind: 'material', id: 2, label: '钢材', count: 7800 },
        { kind: 'useitem', id: h.useitem('新型兵装資材'), label: '新型兵装资材', count: 2 },
      ],
    }),
  },
  {
    // memo（2026 初夏限定）：废弃中口径主炮×20、大口径主炮×20、副炮×10、
    // 熟练max零式水上侦察机×10（熟练度不校验标 ≈）；备 12.7cm连装高角炮×10
    questId: 1150,
    code: '2605F3',
    build: (h) => ({
      approx: true,
      tasks: [
        { kind: 'scrapCategory', category: 2, count: 20 },
        { kind: 'scrapCategory', category: 3, count: 20 },
        { kind: 'scrapCategory', category: 4, count: 10 },
        { kind: 'scrapEquip', equipId: h.equip('零式水上偵察機'), count: 10 },
      ],
      stockGoals: [
        { kind: 'equip', id: h.equip('12.7cm連装高角砲'), label: '12.7cm连装高角炮', count: 10 },
      ],
    }),
  },
  {
    // memo：飞龙改三秘书舰，第1格 ★max 震电改二(舰战型改二)；备新型航空兵装资材×3、
    // 新型兵装资材×4、开发资材×160、熟练搭乘员×1、ネ式エンジン×1
    questId: 1163,
    code: 'F141',
    build: (h) => ({
      tasks: [],
      partial: true,
      stateGoal: {
        secretary: { label: '飞龙改三', ships: h.ships('飛龍改三'), stypes: [] },
        equipment: [
          {
            label: '震电改二(舰战型改二)（★max·第1格）',
            mstIds: [h.equip('震電改二(艦戦型改二)')],
            slot: 1,
            maxModified: true,
          },
        ],
      },
      stockGoals: [
        { kind: 'useitem', id: h.useitem('新型航空兵装資材'), label: '新型航空兵装资材', count: 3 },
        { kind: 'useitem', id: h.useitem('新型兵装資材'), label: '新型兵装资材', count: 4 },
        { kind: 'useitem', id: h.useitem('開発資材'), label: '开发资材', count: 160 },
        { kind: 'useitem', id: h.useitem('熟練搭乗員'), label: '熟练搭乘员', count: 1 },
        { kind: 'useitem', id: h.useitem('ネ式エンジン'), label: 'ネ式引擎', count: 1 },
      ],
    }),
  },
]

export const buildKansoQuestRules = (
  context: KcwikiRuleContext,
  masterRaw: any,
  fcd: PoiFcdMapData | null | undefined,
): KansoQuestRule[] => {
  // 改造链索引。禁止拿 aftershipid 手搓单值反向链：可逆改装（改二⇄乙/丙）
  // 的回环边会让链根回溯断在半路，改二之后的形态全漏——权威在 shared/ship-remodel-chain。
  const friendly: any[] = (masterRaw?.api_mst_ship ?? []).filter(
    (ship: any) => Number.isFinite(Number(ship?.api_id)) && Number(ship?.api_id) > 0 && ship?.api_sort_id,
  )
  const nameToId = new Map<string, number>()
  const natOf = new Map<number, number>()
  const stypeOf = new Map<number, number>()
  const ctypeOf = new Map<number, number>()
  for (const ship of friendly) {
    const id = Number(ship.api_id)
    nameToId.set(`${ship.api_name}`, id)
    natOf.set(id, shipNationalityIdFromSortId(ship.api_sort_id))
    stypeOf.set(id, Number(ship.api_stype) || 0)
    ctypeOf.set(id, Number(ship.api_ctype) || 0)
  }
  const chains = buildShipRemodelChains(
    friendly.map((ship) => ({
      id: Number(ship.api_id),
      sortNo: Number(ship.api_sortno) || Number(ship.api_id),
      afterId: parseInt(ship.api_aftershipid, 10) || 0,
    })),
    (masterRaw?.api_mst_shipupgrade ?? []).map((u: any) => ({
      targetId: Number(u.api_id) || 0,
      currentShipId: Number(u.api_current_ship_id) || 0,
      originalShipId: Number(u.api_original_ship_id) || 0,
      stage: Number(u.api_upgrade_level) || 0,
    })),
  )
  const chainOf = (id: number): number[] =>
    chains.chainOf.get(chains.rootOf.get(id) ?? id) ?? [id]
  const one = (name: string): number => {
    const direct = nameToId.get(name) ?? context.shipIdsByName.get(name)?.[0]
    if (!direct) throw new MissingEntity(`舰娘「${name}」`)
    return direct
  }
  const helpers: BuildHelpers = {
    ships: (...names) => names.map(one),
    chain: (...rootNames) => {
      const out = new Set<number>()
      for (const name of rootNames) for (const id of chainOf(one(name))) out.add(id)
      return [...out]
    },
    nationality: (natIds, stypes) => {
      const wanted = new Set(natIds)
      const out: number[] = []
      for (const [id, nat] of natOf) {
        if (!wanted.has(nat)) continue
        if (stypes && !stypes.includes(stypeOf.get(id) ?? 0)) continue
        out.push(id)
      }
      if (!out.length) throw new MissingEntity(`国籍 ${natIds.join('/')}`)
      return out
    },
    ctype: (name) => {
      const id = ctypeOf.get(one(name)) ?? 0
      if (!id) throw new MissingEntity(`舰娘「${name}」的舰级`)
      return id
    },
    equip: (name) => {
      const id = context.equipIdsByName.get(name)
      if (!id) throw new MissingEntity(`装备「${name}」`)
      return id
    },
    useitem: (name) => {
      const id = context.useitemIdsByName.get(name)
      if (!id) throw new MissingEntity(`道具「${name}」`)
      return id
    },
    nodes: (map, ref) => {
      const ids = questMapRefNodeIds(fcd, map, ref)
      // 空数组不能放行：battleNode 的 nodes 为空是「整图任意战斗都算」的意思，
      // 多血条图上会一路误涨。缺 poi-fcd 包时这里对每条点位规则都抛，
      // 那些任务整条降级到下一规则源或干脆不计——与名字解析失败同一处置。
      if (!ids.length) throw new MissingEntity(`${map[0]}-${map[1]} 的点位「${ref}」入边`)
      return ids
    },
  }
  const rules: KansoQuestRule[] = []
  for (const draft of DRAFTS) {
    try {
      const built = draft.build(helpers)
      rules.push({
        questId: draft.questId,
        code: draft.code,
        tasks: built.tasks,
        fleetGoal: built.fleetGoal,
        stateGoal: built.stateGoal,
        stockGoals: built.stockGoals,
        approx: built.approx ?? false,
        partial: built.partial ?? false,
      })
    } catch (error) {
      if (error instanceof MissingEntity) {
        // 名字解析失败＝主数据/上下文缺这一项。按纪律丢弃整条规则并告警，绝不猜。
        console.warn(`[kanso] qp: 艦素规则 ${draft.code} 跳过——${error.message} 无法解析`)
      } else {
        throw error
      }
    }
  }
  return rules
}
