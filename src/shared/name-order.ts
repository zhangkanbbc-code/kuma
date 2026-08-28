/**
 * 「按名称」排序的统一口径：按**界面上显示的那个名字**走拼音序。
 *
 * 从前各处写的是 `localeCompare(…, 'ja')`——排的是日文原名的假名序，
 * 而列表上写着的是中文译名，于是屏幕上看到的顺序毫无规律可循
 * （「朝潮」在「鹿岛」后面还是前面，取决于玩家看不见的那串日文）。
 * 2026-08-21 用户拍板：按显示的中文名排，ICU 默认的 zh 排序即拼音序。
 *
 * 两条实现要点：
 * - **locale 必须显式写死**。应用带 `--lang=en-GB` 启动，省略 locale 会跟着
 *   运行环境走，中文名当场落回码位序。
 * - **Collator 只建一次**。它是这里唯一有构造代价的东西，写进比较器里
 *   就是「一次排序造上千个 Collator」。
 *
 * 排序键与所见一致是原则：没有中文译名、界面上回退显示日文原名的那些舰，
 * 就按屏幕上那串回退名参与排序，不去偷看它们的日文字段。
 */
const collator = new Intl.Collator('zh-Hans')

/** 比较两个「界面上显示的名字」。空名一律沉在最前，不抛错。 */
export const compareDisplayNames = (
  left: string | null | undefined,
  right: string | null | undefined,
): number => collator.compare(left ?? '', right ?? '')
