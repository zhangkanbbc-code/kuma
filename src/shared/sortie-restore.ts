// 跨重启回放上一场出击时的归位规则——**判据的单一出处**。
//
// ---- 规则 ----
// 落盘快照里的 `sortie` 可能是 `active: true`（艦素在出击/演习会话中途被关掉，
// 那一刻的 domainSnapshot 就是这个样子）。回放进来时一律按**非现役**落地：
// 艦素重启后没有任何证据证明游戏仍在那场会话里。回港清理本来就是这个语义
//（store 的回港 reducer：「保留最近一场供镝复盘，标记非现役」），
// 重启只是提前走到同一终态。
//
// ---- 为什么这条规则要有名字、要有护栏 ----
// 它守的不是账目，是**母港里的语音字幕**。`voice-subtitle` 有两处闸门读
// `mg.sortie.active`：
//   · `modeFor` —— `active && battle` 时台词改道成顶部弹幕（不再走底部字幕条）；
//   · 演习拦截 —— `active && practice` 时整场一个字都不出。
// 会话若以 `active: true` 复活，这两道闸会在母港里持续误伤，窗口任意长
//（直到下一条 port 报文才关），表现就是「字幕间歇性消失」。
//
// 规则本身自 2026-08-23 起就在 `main/mg/store.ts` 的 hydrateDomain 里，
// 只是从前没有名字也没有护栏——而它是那种**写反了不报错、只在母港静默咬人**的判断。
// 抽出来是为了让护栏能脱开 Electron 真跑：store.ts 一 import 就会打开真账本
// 并跑迁移，测试绝不能碰用户的库。
//
// ---- 边界：只动 active ----
// 其余字段一个都不许改。battle / practice / updatedTs / 节点与掉落全部原样保留——
// 镝的复盘视图靠它们，且**不伪造时间戳**（updatedTs 是那场会话最后一次更新的时刻，
// 重启不是一次「更新」）。代价是出击中重启的那半场，镝的「当前出击」会降级成
// 非现役形制；后续战斗报文照常入账不丢数据，回港后一切照旧。

export interface RestorableSortie {
  active?: boolean
  sunkShips?: unknown
  anchorageRepairs?: unknown
  escaped?: unknown
  [key: string]: unknown
}

/**
 * 把落盘的出击切片按「上一场，已结束」归位。
 *
 * @returns 新对象（不就地改入参）。`active` 强制 false；`sunkShips`、
 *          `anchorageRepairs`、`escaped` 补成数组（都是后加的字段，更老的快照
 *          没有它们——读取面在渲染层，留 undefined 会逼每个消费点各自 `?? []`
 *          兜一遍）；**其余字段原样**。
 */
export const restoreSortieAcrossRestart = <T extends RestorableSortie>(
  sortie: T,
): T & { active: false; sunkShips: unknown[]; anchorageRepairs: unknown[]; escaped: unknown[] } => ({
  ...sortie,
  active: false,
  sunkShips: Array.isArray(sortie.sunkShips) ? sortie.sunkShips : [],
  anchorageRepairs: Array.isArray(sortie.anchorageRepairs) ? sortie.anchorageRepairs : [],
  escaped: Array.isArray(sortie.escaped) ? sortie.escaped : [],
})
