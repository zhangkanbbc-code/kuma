// 一场战斗走的是哪种流程——战斗面板（镝）与动画复盘（shared/battle-anim-script）共用的判据。
// 原先是 di.ts 的私有函数；动画复盘也要问同样的问题，挪到这里只留一份，免得两处口径分家。

import type { BattleView } from './mg-types'

// 「只算我方损害率」的节点：我方全程不还手，敌全灭永远不成立，评级只看挨了多少。
// **对潜空袭（subAirRaid）不在这里**：它有我方的先制对潜与炮击，敌方潜艇是真能沉的，
// 胜负判定也照旧按击沉算——wikiwiki「戦闘について」写的是「勝敗判定は後方空母を除いた
// 潜水艦を全滅させればS勝利」，账本那场也是 3 沉 3 → 游戏给 S。
export const isDamageOnlyBattle = (battle: BattleView): boolean =>
  battle.kind === 'airraid' || battle.kind === 'baseDefense' || battle.kind === 'radar'

// 「这场走的是不是通常昼战那套流程」。对潜空袭除了战型名之外全跟 day 走——
// wikiwiki「戦闘について」：「戦闘自体は通常戦と同様の順番で進行する」，
// 它只是敌方多一条不可攻击的空母，先制对潜、炮击、追击夜战都照旧。
// 按 kind 逐处写 `=== 'day'` 的话，下一次加档必定漏掉其中一处。
export const isDayFlowBattle = (battle: BattleView): boolean =>
  battle.kind === 'day' || battle.kind === 'subAirRaid'

// 航向（同航 / 反航 / T 字）只在真有水面交战的场次里有意义：
// 纯航空战、空袭、雷达射击、基地防空、纯夜战都不报航向。
export const battleUsesEngagement = (battle: BattleView): boolean =>
  !isDamageOnlyBattle(battle) &&
  (battle.stages ?? []).some((stage) =>
    ['openingTorp', 'gun1', 'gun2', 'gun3', 'torp'].includes(stage.phase),
  )
