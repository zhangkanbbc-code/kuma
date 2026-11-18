import retiredPack from './quests-scn-retired-20261115.json' with { type: 'json' }

// 维护者裁决 2026-11-15：退场任务用 HEAD 固定正文，保留原规则覆盖。
// 只保留这组回归所需的旧认领候选，避免随季节新增条目改变历史场景。
export const historicalQuestPack = live => ({
  ...live,
  data: { ...live.data, ...retiredPack.data },
  unnumbered: { B218: live.unnumbered.B218 },
})
