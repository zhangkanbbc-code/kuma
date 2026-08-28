// 铭 · 任务规则源的已知错误台账（形态照 event-bonus 的 KNOWN_SOURCE_CONFLICTS）。
//
// **这不是「我们觉得上游不对」，是「游戏自己的日文原文和上游对不上」。**
// 每条都逐条列明：哪个任务、哪个上游、它编成什么样、错在哪、日文原文逐字是什么、
// 第三方独立票站哪边、改成什么。留在源码里是为了挡住两件事：
//   ① 照通则「上游优先」把错值判回去（谁都会觉得 kcwiki 比自研可信）；
//   ② 上游哪天修好了却没人发现，台账继续硬套一个过期的值。
//   ②由 `applyQuestSourceConflicts` 的**指纹核对**兜住：上游现在编的东西与
//   `upstream` 对不上就**不打补丁**，只告警——源改了就该重新核，不该继续照旧改写。
//
// ---- 这两处不是逐条手误，是上游的结构性缺口（所以要逐条核，不能只修撞见的那几条）----
//
// **缺口 A：kcwiki-quest-req 的演习 schema 里根本没有评价档。**
// 它只有 `victory: true / 缺省` 两种状态，解码只能落成「B 以上」或「胜负不限」。
// 于是**所有要求 A/S 判定的演习任务在这个源里一律被编成 B**——偏松、会多计。
// 逐条拿日文原文核过线上由 kcwiki 供给的 28 条演习任务（2026-08-21）：
//   · 22 条日文原文本来就没有评价字母（「「演習」で8回以上「勝利」」这类）→ B 是对的；
//   · 301/C1、303/Cd1 的日文连「勝利」都没有（「「演習」を行おう／挑もう」）→ 胜负不限，
//     kcwiki 的 `victory` 缺省正好对，poi 的 `practice` 也站这边——**不是冲突，别顺手改**；
//   · 余下 6 条日文写明了【A判定】/【S判定】→ 就是下面这 6 条。
//
// **缺口 B：kcwiki 远征条目的 `objects[].id` 写成数组时，解码成一个共享计数槽**
// （任一命中即算）。这个编码本身**不是错的**——410/Dw2、411/Dw3 的日文原文正是
// 「「東京急行」**系**遠征を…成功させよ」，两条支线择一，共享槽才对，账本也实证过
// （2026-08-03 / 08-10 / 08-17 三次交付，本地 1/1；411 两次 7/7）。
// 只有 434/Dy1 的日文是「…の**各任務を**…実施せよ」，五个远征各一次。
// 所以这一条是**逐条核出来的例外，不是整族翻案**。
//
// **缺口 C：poi/kcwiki 把「具名装备」读成「该装备的类别」**（2026-08-21 EO 退场时暴露）。
// EO 退场前这几条由 EO 供给，上游的编码从没上过线；EO 一走它们才落到 kcwiki/poi 身上。
// 日文原文写的是加了引号的具体装备名（「91式高射装置」x4）或加了「系」的族级
// （「魚雷」**系**装備x3），两种都不是裸类别——逐条见下方 677 / 1103 / 1138。
import type { QpTask, QpTrackerSource } from '../../shared/qp-types'

export interface QuestSourceConflict {
  questId: number
  code: string
  /** 出错的上游规则源 */
  source: QpTrackerSource
  /** 上游**现在**编成什么样。对不上就说明源已改动，补丁作废并告警。 */
  upstream: QpTask[]
  /** 游戏自己的日文原文（去掉 <br> 之后逐字照抄），这是裁决依据 */
  jp: string
  /** 第三方独立票（与日文原文一致才算数）；没有就写 null，靠中文正文 + 日文原文两票 */
  third: string | null
  /** 错在哪 + 中文正文怎么说 */
  why: string
  /** 修正值 */
  tasks: QpTask[]
  /**
   * 修正之后这条要不要标 ≈。只在**裁出来的是「较松者」而不是原文写死的值**时为 true
   * ——那种情况下计数会偏多，UI 必须如实显示，否则就是「不标推定」。
   * 缺省 = 不动上游的 approx。
   */
  approx?: boolean
}

const drill = (rank: number, count: number): QpTask[] => [{ kind: 'exercise', rank, count, slot: 0 }]
const drillUpstream = (count: number): QpTask[] => [{ kind: 'exercise', rank: 4, count }]

export const KNOWN_QUEST_SOURCE_CONFLICTS: readonly QuestSourceConflict[] = Object.freeze([
  {
    questId: 331,
    code: 'C31',
    source: 'kcwiki',
    upstream: drillUpstream(3),
    jp: '艦載機演習任務：正規空母旗艦他1隻計2隻以上及び駆逐艦2隻を含む空母機動部隊を編成。艦載機の練度向上と装備充実を図る！同機動部隊で、本日中に演習を【A判定】以上3回勝利せよ！',
    third: null,
    why: 'kcwiki 的演习 schema 没有评价档，A 被编成 B（偏松、会多计）；中文 memo2「取得A及以上的胜利3次」与日文一致',
    tasks: drill(5, 3),
  },
  {
    questId: 332,
    code: 'C32',
    source: 'kcwiki',
    upstream: drillUpstream(4),
    jp: '六周年記念演習：軽巡クラス1隻と駆逐艦または海防艦計3隻以上を含む6隻編成の特務艦隊を編成。同艦隊による演習で本日中に【S判定】以上4回勝利せよ！',
    third: null,
    why: '同缺口 A；中文 memo2「单日内取得4次S或SS胜」与日文一致',
    tasks: drill(6, 4),
  },
  {
    questId: 335,
    code: 'C35',
    source: 'kcwiki',
    upstream: drillUpstream(3),
    jp: '「新しき盾」演習任務：重巡「摩耶」及び重巡「羽黒」を擁する艦隊による演習「新しき盾」を実施する。本「新しき盾」演習において、本日中に【S判定】勝利3回以上達成せよ！',
    third: null,
    why: '同缺口 A；中文 memo2「摩耶+羽黑，单日演习3次S胜」与日文一致',
    tasks: drill(6, 3),
  },
  {
    questId: 336,
    code: 'C37',
    source: 'kcwiki',
    upstream: drillUpstream(4),
    jp: '輸送船団演習任務：補給艦または揚陸艦、海防艦を計2隻以上含む輸送船団を編成、同輸送船団及び護衛艦艇による演習で、本日中に【A判定】勝利4回以上達成せよ。',
    third: null,
    why: '同缺口 A；中文 memo2「演习获得A及以上胜利四次」与日文一致',
    tasks: drill(5, 4),
  },
  {
    questId: 337,
    code: 'Cq2',
    source: 'kcwiki',
    upstream: drillUpstream(3),
    jp: '駆逐艦演習任務：第十八駆逐隊「霞」「霰」「陽炎」「不知火」の4隻を含む演習艦隊を編成。同艦隊で本日中に演習で【S判定】勝利3回以上を達成せよ！精鋭十八駆に落ち度など無し！',
    third: 'poi-quest-goal 编 practice_win_s ×3',
    why: '同缺口 A；中文 memo2「单日内取得3次演习S胜」与日文一致，poi 也站 S',
    tasks: drill(6, 3),
  },
  {
    questId: 339,
    code: 'Cq3',
    source: 'kcwiki',
    upstream: drillUpstream(3),
    jp: '駆逐艦演習任務：第十九駆逐隊「磯波」「浦波」「綾波」「敷波」の4隻を含む演習艦隊を編成。同艦隊で本日中に演習で【S判定】勝利3回以上を達成せよ！精鋭十九駆、じゃ、見ててよね！',
    third: 'poi-quest-goal 编 practice_win_s ×3',
    why: '同缺口 A；中文 memo2「取得3次S胜」与日文一致，poi 也站 S',
    tasks: drill(6, 3),
  },
  {
    questId: 434,
    code: 'Dy1',
    source: 'kcwiki',
    upstream: [
      { kind: 'expedition', missionId: 3, count: 1, slot: 0 },
      { kind: 'expedition', missionId: 5, count: 1, slot: 0 },
      { kind: 'expedition', missionId: 9, count: 1, slot: 0 },
      { kind: 'expedition', missionId: 100, count: 1, slot: 0 },
      { kind: 'expedition', missionId: 101, count: 1, slot: 0 },
    ],
    jp: '海上護衛任務：遠征任務「警備任務」「海上護衛任務」「兵站強化任務」「海峡警備行動」「タンカー護衛任務」の各任務を、海防艦・駆逐艦などを主軸とした護衛艦艇で実施せよ！',
    third: 'poi-quest-goal 编成五条独立的 mission_success，各 1 次',
    why:
      '缺口 B：五个远征被塞进同一个计数槽，跑成任一即满——**做完一个远征就会误报达成**。' +
      '日文是「の各任務を…実施せよ」，中文 memo2 除了「各完成一次」还写了进度档 ' +
      '「50%(3/5)→80%(4/5)→達成(5/5)」——五个子项这件事是游戏自己的粗档算出来的',
    tasks: [
      { kind: 'expedition', missionId: 3, count: 1, slot: 0 },
      { kind: 'expedition', missionId: 5, count: 1, slot: 1 },
      { kind: 'expedition', missionId: 9, count: 1, slot: 2 },
      { kind: 'expedition', missionId: 100, count: 1, slot: 3 },
      { kind: 'expedition', missionId: 101, count: 1, slot: 4 },
    ],
  },
  // ---- 以下六条是 EO 退场（2026-08-21）后才落到 kcwiki/poi 头上的 ----
  // 它们此前一直由 EO 供给，上游的编码从没上过线。拆除时的全目录逐条 diff
  // 把它们逐个照了出来，各自拿游戏日文原文重裁。
  {
    questId: 333,
    code: 'C33',
    source: 'kcwiki',
    upstream: drillUpstream(3),
    jp: '航空戦隊演習任務：航空母艦3隻以上及び駆逐艦2隻以上を含む航空戦隊を編成。艦隊戦演習により、戦技及び練度向上を図る。同航空戦隊で、本日中に演習を【S判定】勝利3回以上達成せよ！',
    third: null,
    why: '同缺口 A（kcwiki 演习 schema 没有评价档，S 被编成 B、偏松会多计）；中文 memo2「取得演习S胜3次」与日文一致',
    tasks: drill(6, 3),
  },
  {
    questId: 334,
    code: 'C34',
    source: 'kcwiki',
    upstream: drillUpstream(6),
    jp: '航空戦隊演習任務：航空母艦3隻以上及び駆逐艦2隻以上を含む航空戦隊を編成。大規模演習により、さらなる戦技及び練度向上を図る。同航空戦隊で、本日中に演習を【S判定】勝利6回以上達成せよ！',
    third: null,
    why: '同 333，只是次数是 6；中文 memo2「取得演习S胜6次」与日文一致',
    tasks: drill(6, 6),
  },
  {
    questId: 878,
    code: 'B113',
    source: 'kcwiki',
    upstream: [
      { kind: 'bossKill', map: [1, 4], rank: 6, count: 3, slot: 0 },
      { kind: 'mapGoal', map: [1, 6], count: 3, slot: 1 },
    ],
    jp: '艦隊旗艦に軽巡級または駆逐艦、さらに3隻以上の駆逐艦または海防艦を含む輸送護衛艦隊を編成、防衛ラインの強化のため、南西諸島防衛線及び鎮守府近海航路における作戦を継続的に成功させよ！',
    third: null,
    why:
      'kcwiki 给 1-4 编了 S，但**日文原文通篇没有评价字母**（只说「作戦を継続的に成功させよ」）；' +
      '中文 memo2 也只写「可能需要1-4胜利3次」，连字母带把握都没有。EO 当年编的是 A——' +
      '三方（日文原文 / EO / kcwiki）没有两票一致，按定式取较松者：' +
      '「胜利」的下限是 B 判定（出击 C 及以下是败北/引き分け），落 B + ≈。' +
      '偏松会多计，与 ≈ 同向；编成 S 则是偏紧，会让做到了的人一直显示没做到。' +
      '1-6 那一格是到达终点（罗盘事件 8），不看评价，原样留用',
    tasks: [
      { kind: 'bossKill', map: [1, 4], rank: 4, count: 3, slot: 0 },
      { kind: 'mapGoal', map: [1, 6], count: 3, slot: 1 },
    ],
    approx: true,
  },
  {
    questId: 677,
    code: 'Fw4',
    source: 'kcwiki',
    upstream: [
      { kind: 'scrapCategory', category: 3, count: 4, slot: 0 },
      { kind: 'scrapCategory', category: 10, count: 2, slot: 1 },
      { kind: 'scrapCategory', category: 5, count: 3, slot: 2 },
    ],
    jp: '艦娘の継戦支援体制の整備強化を実施する！「大口径主砲」系装備x4、「水上偵察機」系装備x2、「魚雷」系装備x3を廃棄、鋼材3,600を準備せよ！　※任務達成後、準備した資源は消費します。',
    third: null,
    why:
      '缺口 C：第三格的日文是「魚雷」**系**装備 —— 带「系」是族级读法，' +
      '涵盖 `api_type[1]=3` 的整族（魚雷 category 5 + 潜水艦魚雷 category 32），' +
      '实测比 kcwiki 编的裸 category 5 多出 13 件（潜水艦53cm艦首魚雷、後期型艦首魚雷、' +
      '21inch艦首魚雷発射管…）。编窄了是**少计**：拿潜艇鱼雷去废弃永远不涨，' +
      '玩家做完了进度条还差着。中文 desc「鱼雷系装备3个」同样带「系」。' +
      '前两格 kcwiki 编对了（大口径主砲 category 3 / 水上偵察機 category 10 的族与类同集合），原样留用',
    tasks: [
      { kind: 'scrapCategory', category: 3, count: 4, slot: 0 },
      { kind: 'scrapCategory', category: 10, count: 2, slot: 1 },
      { kind: 'scrapCardType', cardType: 3, count: 3, slot: 2 },
    ],
  },
  {
    questId: 1103,
    code: 'Fy5',
    source: 'poi',
    upstream: [{ kind: 'scrapCategory', category: 5, count: 3, slot: 0 }],
    jp: '「61cm三連装(酸素)魚雷」x3廃棄、開発資材x60と「九三式水中聴音機」「13号対空電探改」各x2を準備せよ！　※任務達成後、用意した開発資材及び必要装備(低改修値のもの優先)は消費します。',
    third: null,
    why:
      '缺口 C 的反向：日文写的是**加引号的具体装备名**「61cm三連装(酸素)魚雷」（mstId 125），' +
      'poi 却编成整个鱼雷类别（`slotitemType2:[5]`，实测 18 件都算）。' +
      '这是**误涨**——废弃任意一件鱼雷都会 +1，三件杂鱼雷就报达成。' +
      '中文 desc 也逐字写着「废弃「61cm三联装（酸素）鱼雷」×3」',
    tasks: [{ kind: 'scrapEquip', equipId: 125, count: 3, slot: 0 }],
  },
  {
    questId: 1138,
    code: 'Fy11',
    source: 'poi',
    upstream: [{ kind: 'scrapCategory', category: 17, count: 4, slot: 0 }],
    jp: '旗艦に秋月型駆逐艦を配備し、「91式高射装置」x4を廃棄。ボーキサイト1,300、鋼材480、高速建造材x4、開発資材x16を準備せよ！(任務達成後、準備した資源・資材は消費します)',
    third: null,
    why:
      '同 1103 的具名装备被读成类别，但 poi 这条**连类别都串了**：它写 `slotitemType2:[17]`，' +
      '而 `api_type[2]=17` 是「機関部強化」（改良型艦本式タービン/強化型艦本式缶/新型高温高圧缶），' +
      '不是高射装置（91式高射装置 mstId 120 的 `api_type[2]` 是 36）。' +
      '照这个编码跑，废弃再多高射装置也永远不涨，废弃锅炉倒会涨——两头都错。' +
      '中文 desc/memo2 同样逐字写着「废弃“91式高射装置”×4」',
    tasks: [{ kind: 'scrapEquip', equipId: 120, count: 4, slot: 0 }],
  },
])

/** 顺序无关的任务比较：槽号显式化之后按 JSON 排序比对。 */
const canonical = (tasks: QpTask[]): string =>
  tasks
    .map((task, index) => JSON.stringify({
      ...task,
      slot: Number.isInteger(task.slot) && (task.slot as number) >= 0 ? task.slot : index,
    }, Object.keys(task).concat('slot').sort()))
    .sort()
    .join('|')

export const sameQuestTasks = (left: QpTask[], right: QpTask[]): boolean =>
  canonical(left) === canonical(right)

/**
 * 把台账落到已装好的追踪器上。**只动台账里逐条列明的那几个 questId**。
 *
 * 三道核对，任一不过就跳过并告警——宁可继续用上游的错值，也不能拿一份过期的
 * 修正去改写一个已经变了样的东西（那种错法既看不见又说不清）：
 *   1. 这条任务当前真由台账写明的那个源供给；
 *   2. 上游现在编出来的东西与 `upstream` 指纹逐字对得上；
 *   3. 修正值确实与上游不同（相同就说明源修好了，台账该退休）。
 */
export const applyQuestSourceConflicts = <
  T extends { source: QpTrackerSource; tasks: QpTask[]; approx: boolean },
>(
  trackers: Map<number, T>,
  onSkip?: (conflict: QuestSourceConflict, reason: string) => void,
): number => {
  let patched = 0
  for (const conflict of KNOWN_QUEST_SOURCE_CONFLICTS) {
    const tracker = trackers.get(conflict.questId)
    if (!tracker) {
      onSkip?.(conflict, '当前没有追踪器')
      continue
    }
    if (tracker.source !== conflict.source) {
      onSkip?.(conflict, `当前由 ${tracker.source} 供给，不是台账写的 ${conflict.source}`)
      continue
    }
    if (!sameQuestTasks(tracker.tasks, conflict.upstream)) {
      onSkip?.(conflict, '上游编码已与台账记录的不同，修正作废，请重新核对日文原文')
      continue
    }
    tracker.tasks = conflict.tasks.map((task) => ({ ...task }))
    // 只往「更不确定」的方向加，不替上游把 ≈ 摘掉
    if (conflict.approx) tracker.approx = true
    patched += 1
  }
  return patched
}
