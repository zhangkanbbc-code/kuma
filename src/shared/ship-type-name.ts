// 编成门标签里的舰种词规范表（2026-09-01 起）。
//
// ---- 为什么要有这个文件 ----
// 钦的任务行「要凑什么」与详情抽屉的「编成检查」显示的是同一份 `group.label`，
// 而这份 label 由两个规则源分别产出，各说各的话：
//   · kcwiki-quest-req 的编成门直接抄上游 requirements 里的**日文舰种词**（「駆逐」「軽巡」）；
//   · 艦素自研那一侧（手写规则 + 从中文正文推导）出的是**中文**（「驱逐舰」「轻巡级」）。
// 于是同一列里「駆逐 ×3」与「驱逐舰 ×3」并排——同一个概念两种写法。
// 2026-08-25 立的语言总则（见 enemy-formation.ts 文件头）在这一列上还没落实：
// 玩家可见文案统一中文，同一概念不许两张表两种写法。
//
// ---- 分层纪律（与阵形名那一份同构）----
// 规则包与解码器里的字符串**保持源文不动**——`kcwiki-quest-rules` 的 FRIENDLY_STYPE_TOKENS
// 仍以日文为键，考古要能逐字对回上游。中文化只发生在**追踪器装配完成之后、任何消费端之前**
// 那一个出口（`quest-counter.ts` 的 `localizeFleetGoalLabels`）：那里改一次，
// 任务行的 `qpFleetNeedItems` 与抽屉的 `evaluateFleetGoal` 两条腿同时受益，不会一边中文一边日文。
//
// ---- 不新立文案源 ----
// 表里每个中文词都不是这里现造的，逐个有出处：
//   · 26 个舰种词全部是自研侧 `quest-fleet-rules.ts` 的 STYPE_ALIASES 已有的键
//     （护栏 test/ship-type-name.test.mjs 逐条核对，并核「中文词的舰种集 ⊇ 日文词的」）；
//   · 「任意舰」「其它舰」本来就在用——前者是 `decodeKcwikiRequirement` 给秘书舰任意档的说法，
//     后者是 `evaluateFleetGoal` 给 allowOnlyGoalShips 那一行的说法；
//   · 「低速战舰」是 `kanso-quest-rules.ts` 手写规则里已有的 label 原文。
// 长短两档**各译各的**：「駆逐」→「驱逐」、「駆逐艦」→「驱逐舰」。上游写短我们不擅自写长，
// 那是在替规则包加话；两侧的长短本来就跟着任务正文走。
//
// ---- 认不出的词一律原样放行 ----
// 舰名（時雨 / 長門改二 / Saratoga）、舰级（陽炎级）、队名（第八驱逐队）都是专有名词，
// 表里没有就原样上屏——最坏退回今天的混排，绝不硬翻、绝不吞字。
//
// 这个文件**不 import 任何东西**：`node --test` 直接跑 .ts 时，无扩展名的相对值导入
// 会让整份文件加载不起来（同 `ship-class-name.ts` 文件头那一条）。

/**
 * 舰种词 → 规范中文写法。**封闭表**：键是两个规则源实际产出过的写法，
 * 上游冒出新词时护栏当场红（判据取 `FRIENDLY_STYPE_TOKENS` 的全集），
 * 修法是补一格，不是让混排悄悄回来。
 *
 * 值等于键的几条（空母/水母/航巡/重巡/装甲空母/潜水空母）照样列出来：
 * 「这个词已经核过、就是规范写法」与「这个词还没人管过」是两回事，
 * 留白会让下一个人以为漏了。
 */
export const SHIP_TYPE_JA_ZH: Record<string, string> = {
  // ---- 日文（kcwiki-quest-req 的 FRIENDLY_STYPE_TOKENS 全集）----
  駆逐: '驱逐',
  駆逐艦: '驱逐舰',
  軽巡: '轻巡',
  軽巡洋艦: '轻巡洋舰',
  重巡: '重巡',
  重巡洋艦: '重巡洋舰',
  航巡: '航巡',
  航空巡洋艦: '航空巡洋舰',
  空母: '空母',
  正規空母: '正规空母',
  軽母: '轻母',
  軽空母: '轻空母',
  装甲空母: '装甲空母',
  戦艦: '战舰',
  航戦: '航战',
  航空戦艦: '航空战舰',
  海防艦: '海防舰',
  潜水艦: '潜水舰',
  潜水空母: '潜水空母',
  潜水母艦: '潜水母舰',
  水母: '水母',
  水上機母艦: '水上机母舰',
  練習巡洋艦: '练习巡洋舰',
  重雷装巡洋艦: '重雷装巡洋舰',
  補給艦: '补给舰',
  揚陸艦: '扬陆舰',
  // ---- 日文（舰种以外的选择器，同样由 resolveFriendlyShipToken 认）----
  // 「艦」是 kcwiki 编「任何一艘都算」的占位（'any'），出现位形如「任意舰 ×2」
  // 「旗舰 任意舰 Lv90↑」。照抄一个「艦」字上屏，玩家读不出它是占位还是舰名。
  艦: '任意舰',
  他の艦: '其它舰',
  高速艦: '高速舰',
  低速戦艦: '低速战舰',
  // ---- 繁体（自研侧从任务正文切片取词，2605B3 的正文整条是繁体）----
  // 与日文那一批同一种毛病：同一列里「戰艦」与「战舰」并排。
  戰艦: '战舰',
  輕巡洋艦: '轻巡洋舰',
  驅逐艦: '驱逐舰',
}

/**
 * 把一条标签切成「词」与「分隔符」交替的段。偶数下标是词，奇数下标是原样分隔符。
 *
 * 分隔符两个规则源写法不同——kcwiki 是 `' / '`（`tokens.join(' / ')`），
 * 自研侧是 `'/'`（`label += '/' + atom.label`）。**捕获着切、原样拼回**，
 * 中文化不顺手把谁的排版改成另一个人的。
 *
 * 本文件私有：外面要切词走 `mapLabelWords` / `shipTypeLabelTokens`，
 * 各自再切一遍就是让「同一套切法」这句话失效的第一步。
 */
const shipTypeLabelSegments = (label: string): string[] =>
  `${label ?? ''}`.split(/(\s*\/\s*)/)

/** 一条标签里的词（去掉分隔符与前后空白）。护栏与出口共用同一套切法。 */
export const shipTypeLabelTokens = (label: string): string[] =>
  shipTypeLabelSegments(label)
    .filter((_, index) => index % 2 === 0)
    .map((word) => word.trim())
    .filter(Boolean)

/**
 * 逐词改写一条标签：偶数段是词、交给 `replace`，奇数段是分隔符、原样留着。
 * `replace` 返回 `undefined` 就是「这个词放行」——一个字节都不动。
 *
 * 只动词本身，词前后的空白与分隔符一个字节都不碰——
 * 「另一艘（黑潮改二 / 亲潮改二）」这种括号里带斜杠的标签切开再拼回必须完全相同。
 *
 * **三张口径表共用这一份切法与拼法**（舰种词、专有名词 `ship-proper-name.ts`、
 * 国籍词组 `ship-nation-name.ts`）：各写一遍必然漂移，
 * 漂移的表现是「测试绿着、界面混排」——那正是这一列要消灭的东西。
 */
export const mapLabelWords = (
  label: string,
  replace: (word: string) => string | undefined,
): string =>
  shipTypeLabelSegments(label)
    .map((segment, index) => {
      if (index % 2 === 1) return segment // 分隔符原样
      const parts = /^(\s*)([\s\S]*?)(\s*)$/.exec(segment)
      if (!parts) return segment
      const zh = replace(parts[2])
      return zh === undefined ? segment : `${parts[1]}${zh}${parts[3]}`
    })
    .join('')

/** 编成门标签的舰种词规范写法。**整词匹配**：表里有就换，没有就原样放行。 */
export const localizeShipTypeWords = (label: string): string =>
  mapLabelWords(label, (word) => SHIP_TYPE_JA_ZH[word])

/**
 * 这条标签里**没被规范表认出**的词（护栏用）。**与 `localizeShipTypeWords` 同一套切法**：
 * 判定逻辑各写一份必然漂移，漂移的表现是「测试绿着、界面混排」。
 *
 * 正常情况下这里剩下的应当只有专有名词——舰名、舰级、队名。
 */
export const unmappedShipTypeTokens = (label: string): string[] =>
  shipTypeLabelTokens(label).filter((token) => !(token in SHIP_TYPE_JA_ZH))
