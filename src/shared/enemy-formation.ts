// 阵形名的唯一规范表（2026-08-25 起）。
//
// ---- 为什么要有这个文件 ----
// 鉴的敌编成格此前是两条腿两种话：`comp.formation` 是数字（本机遭遇志/游戏 api 值）
// 时查表出中文「单纵阵」，是字符串（汇编包照抄 kcwiki/wikiwiki 的日文简写「単縦 複縦」）
// 时原样上屏——同一页里中日混排。2026-08-25 他拍板统一中文，并立下语言总则：
// 玩家可见文案统一中文，同一概念不许两张表两种写法。
//
// ---- 分层纪律 ----
// 汇编包（map-enemy-comps / map-intel）里的字符串**保持源文的日文简写不动**——
// 那是转写忠实性的一部分，考古要能逐字对回上游。中文化只发生在渲染这一层。
// 映射认不出的词**保留原文不硬翻**；护栏测试（test/enemy-formation.test.mjs）
// 会拿两个矿脉包的真实数据逐词过一遍，上游冒出新写法时当场红，而不是悄悄混排回去。

/** 数字阵形 id → 中文名（游戏 api 的阵形编号；11–14 是联合舰队的警戒航行序列） */
export const ENEMY_FORMATION: Record<number, string> = {
  1: '单纵阵',
  2: '复纵阵',
  3: '轮形阵',
  4: '梯形阵',
  5: '单横阵',
  6: '警戒阵',
  11: '第一警戒',
  12: '第二警戒',
  13: '第三警戒',
  14: '第四警戒',
}

/** 汇编包里的日文简写/缩写 → 与数字分支同一套中文名 */
export const FORMATION_JA_ZH: Record<string, string> = {
  単縦: '单纵阵',
  複縦: '复纵阵',
  輪形: '轮形阵',
  梯形: '梯形阵',
  単横: '单横阵',
  警戒: '警戒阵',
  // 联合舰队警戒航行序列的缩写（map-intel 实见「第三」「第四」两种，四个一并备齐）
  第一: '第一警戒',
  第二: '第二警戒',
  第三: '第三警戒',
  第四: '第四警戒',
}

/**
 * 整串别名：上游把**一个**阵形写成带空白的整句时（实见「第三警戒 航行序列」），
 * 按词切会把它剁碎——所以先去空白整串匹配，命中就直接定名。
 */
export const FORMATION_FULL_ALIASES: Record<string, string> = {
  第一警戒航行序列: '第一警戒',
  第二警戒航行序列: '第二警戒',
  第三警戒航行序列: '第三警戒',
  第四警戒航行序列: '第四警戒',
}

/**
 * 阵形的显示文本，两种形态一个出口：
 *  · 数字 → 查 `ENEMY_FORMATION`，查不到写「阵形N」（如实报号，不编）；
 *  · 字符串 → 先整串对别名表，再按空白切词逐个映射，「単縦 複縦」→「单纵阵/复纵阵」；
 *    认不出的词保留原文——宁可露出一个日文词提醒去补表，也不硬翻。
 */
export const formationText = (value: number | string): string => {
  if (typeof value === 'number') return ENEMY_FORMATION[value] ?? `阵形${value}`
  const alias = FORMATION_FULL_ALIASES[value.replace(/\s+/g, '')]
  if (alias) return alias
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => FORMATION_JA_ZH[token] ?? token)
    .join('/')
}

/**
 * 可缺的阵形值的显示文本：**无值不出、有值必出**。
 *
 * 给「这一格可能压根没有阵形」的显示位用（镝的阵形胶囊那族）。从前那几处是直接
 * 下标 `ENEMY_FORMATION[...]`，绕过规范出口——官方加一个新阵形号（联合舰队那四个
 * 就是后来加的），表里查不到就落成空串：`.gpill` 自带边框和内边距，屏幕上于是多出
 * 一枚**空胶囊**；没写 `??` 的那两处则整枚消失。
 *
 * 两侧都要守住：
 *  · 有值 → 一定出字。认不出的号码兜底成「阵形N」，如实报号，不编也不空着；
 *  · 无值 → 一个字都不出。`null` / `undefined` / 空串是「没有这一格」，
 *    数字 `0` 同理——那是「这一战没有阵形」（基地空袭那类），不是「未知阵形」，
 *    翻成「阵形0」是凭空造一枚胶囊。
 */
export const optionalFormationText = (
  value: number | string | null | undefined,
): string => {
  if (value == null) return ''
  if (typeof value === 'number') return value > 0 ? formationText(value) : ''
  return value.trim() ? formationText(value) : ''
}

/**
 * 这串上游写法里映射不到中文的词（护栏用）。**与 `formationText` 同一套判定**：
 * 判定逻辑若各写一份必然漂移，漂移的表现是「测试绿着、界面混排」。
 */
export const unmappedFormationTokens = (raw: string): string[] => {
  if (FORMATION_FULL_ALIASES[raw.replace(/\s+/g, '')]) return []
  return raw
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !(token in FORMATION_JA_ZH))
}
