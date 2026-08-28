// ---- 高角炮：种别相同、图标不同（2026-08-25 用户实机报）----
//
// 游戏的装备筛选把**小口径主炮**与**高角炮**分开列，而主数据里这两族的
// `api_type[2]` 同为 1（小口径主砲），差别只在 `api_type[3]` 图标号：
//   12.7cm連装砲   [1,1,1, 1,0]   ← 真·小口径主炮（29 件）
//   10cm連装高角砲 [1,1,1,16,0]   ← 高角炮（29 件）
// 只按种别分类就会把两族混成一栏，玩家按「小口径主炮」筛，翻出一堆高角炮。
//
// 图标 16 这条判据不是这里新发明的：`shared/ship-special-attack` 的
// `isHighAngleMount = iconIs(16)` 早就靠它判对空カットイン，本文件与它同源。
// 中文名取仓里既有译名台账（scripts/localization.mjs 的 `高角砲 → 高角炮`），不新造词。
//
// ---- 2026-08-25 用户裁决：不分种别，凡图标 16 一律是高角炮 ----
// 头一版只拆了种别 1（小口径主砲），因为另外三族没实测过。用户当天拍板：
// **「这个 icon 的图标意思就是高角炮，毋庸置疑是高角炮类」**——于是四族全拆。
// 主数据全量实测，图标 16 散在这四个种别里：
//     种别 1 小口径主砲 29 件   种别 2 中口径主砲  3 件（5inch連装両用砲(集中配備) 等）
//     种别 4 副砲      16 件   种别 3 大口径主砲  1 件（深海15inch連装砲後期型）
// 深海那一件同样归高角炮：玩家在游戏里根本看不到深海装备的分类，另立一套标准
// 只会让判据多一个分支，而那个分支永远没有实测能校准它。按图标一致性走。
export const HIGH_ANGLE_ICON = 16
/**
 * 高角炮在**筛选面**上的合成类别号。取负数：主数据的 equiptype id 全是正的，撞不上。
 * 它只活在分类/筛选这一层，不进任何战斗判定——那些照旧按 `api_type[2]` 走
 * （高角炮在制空、弹着观测里本来就算主炮，别顺手改坏）。
 */
export const HIGH_ANGLE_CATEGORY = -HIGH_ANGLE_ICON
export const HIGH_ANGLE_CATEGORY_NAME = '高角炮'

/**
 * 分类/筛选用的「有效类别」：**图标是高角的一律单独成类**，其余就是 `api_type[2]`。
 *
 * 不分种别（用户裁决，见头注）：判据只有图标一条，没有「哪几个种别才算」的名单——
 * 名单就意味着下一次官方把高角炮塞进第五个种别时，这里会默默漏掉它。
 */
export const effectiveEquipCategory = (type2: number, iconId: number): number =>
  iconId === HIGH_ANGLE_ICON ? HIGH_ANGLE_CATEGORY : type2

/** 合成类别的显示名；真类别交回调查表（本地化仍走 entityNamePlain）。 */
export const equipCategoryFallbackName = (category: number, packName?: string): string =>
  category === HIGH_ANGLE_CATEGORY ? HIGH_ANGLE_CATEGORY_NAME : (packName ?? `分类${category}`)
