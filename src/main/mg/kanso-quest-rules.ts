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
  equip: (name: string) => number
  useitem: (name: string) => number
  /** 血条号/格子字母 → 入边号；表里没有或 poi-fcd 算不出都抛 MissingEntity */
  nodes: (map: QpMapRef, ref: string) => number[]
}

class MissingEntity extends Error {}

const group = (
  label: string,
  amount: number,
  init: Partial<QpFleetGoalGroup>,
): QpFleetGoalGroup => ({
  label,
  ships: 'any',
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
  {
    // memo：对最上型用 3 轻巡系素材近代化改修成功 2 次；备钢/弹 1100。
    // 素材舰种与对象舰在动作事件里未校验 → 标 ≈ 且 partial
    questId: 718,
    code: 'G10',
    build: () => ({
      approx: true,
      partial: true,
      tasks: [{ kind: 'action', action: 'powerup', label: '近代化改修（最上型）', count: 2 }],
      stockGoals: [
        { kind: 'material', id: 2, label: '钢材', count: 1100 },
        { kind: 'material', id: 1, label: '弹药', count: 1100 },
      ],
    }),
  },
  {
    questId: 719,
    code: 'G11',
    build: () => ({
      approx: true,
      partial: true,
      tasks: [{ kind: 'action', action: 'powerup', label: '近代化改修（最上型）', count: 2 }],
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
        secretary: { label: '潜水舰/潜水空母', ships: 'any', stypes: [13, 14] },
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
  for (const ship of friendly) {
    const id = Number(ship.api_id)
    nameToId.set(`${ship.api_name}`, id)
    natOf.set(id, shipNationalityIdFromSortId(ship.api_sort_id))
    stypeOf.set(id, Number(ship.api_stype) || 0)
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
