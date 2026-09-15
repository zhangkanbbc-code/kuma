// 前置链三源仲裁表（维护者核 2026-08-17）：kcwiki × wikiwiki × KC3Kai。
//
// 三源 = kcwiki(quests-scn) × wikiwiki(任務页) × KC3Kai(quests_meta.json 的 unlock
// 前向边反转，api_id 键控无对齐歧义)。核对日期 2026-08-17。
//
// **只收硬裁决，弱证据不进表**：
// - KC3Kai 在双 wiki 一致集上完全吻合率 71%，不吻合的基本是它少记周期前置——
//   有系统性省略偏差。所以它站在「更小集合」一边不算数（可能只是共同省略），
//   只有它**肯定了争议项的存在**才算数（省略型偏差不会凭空发明一条前置）。
//   按此规则 36 个 2v1 里只有 5 个成立，其余 31 个弱倾向一律不裁。
// - B204/F128/F135 的悬空限时码经 EO 对照确认身份（#1020=2409B1、#1037=2508B1），
//   kcwiki 与 KC3Kai 两源一致：真前置就是已下线的限时任务；wikiwiki 给的替代链
//   全部自标「達成後？」。裁决保留限时码——判定端对库外码如实给「未同步」，
//   不猜测玩家当年做没做过。
// - B211 于 2026-09-06 按 wikiwiki、totoneko 第三票及维护者核实的限时前置过期事实
//   裁为仅 F132；这是逐项现行裁决，不推广为所有已下线限时前置自动失效。
// - F48 于 2026-09-06 按维护者核实的四份来源记录裁为 F4+F44；C2 是 kcwiki
//   独有主张，未采；英文 wiki 的 Cd1 经 F44 传递已隐含，不单列。
// - B216 于 2026-09-06 按 wikiwiki、kobayangame、zekamashi 三家正面主张
//   裁为 B207，待实测；kcwiki/tsunkit 前置栏未登记，不视为「无前置」主张。
//
// 复算方法（数据更新后）：拉 KC3Kai src/data/quests_meta.json，反转 unlock 得
// 前置主张，与 assets/review/quest-pre-reconcile.json 的 conflicts 逐条对表决，
// 强弱分级规则如上；个人取证材料另存维护者侧。
export interface QuestPreArbitrationEntry {
  /** 裁定的现行前置（可含库外的限时码——判定端会退「未同步」） */
  pre: string[]
  /** 裁决依据，详情面板原样展示 */
  basis: string
  /** 后续裁决的核实证据；旧条目仍沿用 basis 中的历史依据 */
  evidence?: string
  /** 核实日期（YYYY-MM-DD） */
  date?: string
}

export const QUEST_PRE_ARBITRATION: ReadonlyMap<string, QuestPreArbitrationEntry> = new Map([
  [
    'B217',
    {
      pre: ['Cs1', 'By17'],
      basis: 'kcwiki 前置为 Cs8、By17；Cs8 对应游戏编号 313，任务包按维护者定号保留码 Cs1，故前置归一为 Cs1、By17（维护者核 2026-09-15）',
      date: '2026-09-15',
    },
  ],
  [
    'B216',
    {
      pre: ['B207'],
      basis: 'wikiwiki、kobayangame、zekamashi 三家均明确列 B207；kcwiki、tsunkit 前置栏未登记，不视为无前置主张；裁为 B207，待实测（维护者核 2026-09-06）',
      evidence: 'wikiwiki 任務/出撃任務层、kobayangame.xyz 2026-06-01 攻略（20260529_ninmu6）、zekamashi.net/kancolle-kouryaku/suzunami-batubyou/ 任務情報与 comment-page-1/ 评论区实测（2026-05-30/06-23）均列 B207 为前提；kcwiki/tsunkit.net 前置栏未登记。裁为 [B207]；维护者核 2026-09-06。完整 HTTPS URL 见 docs/medium-F-quest-pre.md。',
      date: '2026-09-06',
    },
  ],
  [
    'F48',
    {
      pre: ['F4', 'F44'],
      basis: 'F4 获 wikiwiki、英文 wiki、kcwiki 2017 更新页支持，F44 获两 wiki 及 kcwiki 现行页支持；C2 为 kcwiki 独有主张，未采；Cd1 经 F44 传递不单列（维护者核 2026-09-06）',
      evidence: 'wikiwiki 任務/工廠任務：F4、F44（F4 标要検証）；英文 wiki en.kancollewiki.net（维护者核 2026-09-06）：Cd1、F4、F44；kcwiki 游戏更新/2017年1月10日：C2、F4、B89；kcwiki 现行任务页（quests-scn 2026.09.02）：F44、C2。裁为 [F4,F44]；C2 是 kcwiki 独有主张（现行与 2017 两页），未采；Cd1 经 F44 的 [Cd1,F42] 传递已隐含，不单列；B89 仅 2017 页，未采（维护者核 2026-09-06）',
      date: '2026-09-06',
    },
  ],
  [
    'B211',
    {
      pre: ['F132'],
      basis: 'wikiwiki 与 totoneko 攻略前提均仅 F132；限时 2507C1 随 2025-07 活动过期不再作前置（维护者核 2026-09-06）',
      evidence: 'wikiwiki 仅 F132；totoneko.net 2025-07-26 攻略前提任務仅 F132；限时 2507C1 随 2025-07 活动过期不再作前置（维护者核 2026-09-06）',
      date: '2026-09-06',
    },
  ],
  [
    'B100',
    {
      pre: ['B98', 'Bw5'],
      basis: 'kcwiki 与 KC3Kai 一致，KC3Kai 肯定 Bw5 存在；wikiwiki 漏记 Bw5',
    },
  ],
  [
    'Cq1',
    {
      pre: ['Bd1', 'C9'],
      basis: 'kcwiki 与 KC3Kai 一致，KC3Kai 肯定 C9；wikiwiki 写 B9 且自标待查证',
    },
  ],
  [
    'Cs3',
    {
      pre: ['Cd1'],
      basis: 'wikiwiki 与 KC3Kai 一致，KC3Kai 肯定 Cd1；kcwiki 写的 B6+C1 无第二源支持',
    },
  ],
  [
    'F61',
    {
      pre: ['A80', 'Fd4'],
      basis: 'wikiwiki 与 KC3Kai 一致，KC3Kai 肯定 Fd4；kcwiki 写 Fd3',
    },
  ],
  [
    'F91',
    {
      pre: ['B154', 'C46'],
      basis: 'wikiwiki 与 KC3Kai 一致，KC3Kai 肯定 C46 存在；kcwiki 漏记 C46',
    },
  ],
  [
    'B204',
    {
      pre: ['2409B1'],
      basis:
        'kcwiki 与 KC3Kai 一致：前置是 2024 秋限时任务「第三戦隊」緊急展開！；wikiwiki 的 B135+C15 自标待查证',
    },
  ],
  [
    'F128',
    {
      pre: ['2409B1', 'Cy15'],
      basis:
        'kcwiki 与 KC3Kai 一致：前置含 2024 秋限时任务「第三戦隊」緊急展開！；wikiwiki 只写 Cy15 且自标待查证',
    },
  ],
  [
    'F135',
    {
      pre: ['2508B1', 'F76'],
      basis:
        'kcwiki 与 KC3Kai 一致：前置含 2025 秋限时任务「秋の旗艦は……私ッ！」；wikiwiki 只写 F76 且自标待查证',
    },
  ],
])
