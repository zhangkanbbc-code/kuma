/**
 * 家具箱的识别口径：认**主数据名**，不列 id。
 *
 * 家具箱（小/中/大）是日常任务的常客，一天能进十几个，混在道具流水里会把
 * 真正稀有的东西挤下去——史的道具视图给了个「隐藏家具箱」开关，靠这里认人。
 *
 * 为什么不写 id 清单（10/11/12）：清单是静态的，游戏新出一种家具箱就要等人来改
 * 一次代码；而 `api_mst_useitem` 的 `api_name` 是游戏自己发的，名字里带「家具箱」
 * 的新变种一出现就自动落网。
 *
 * 为什么认主数据名而不是屏幕上那个名字：译名层随时可能改字（同一个道具在不同
 * 模块曾有两种写法），主数据名是全仓唯一不动的那一份。
 */

/** 主数据名里带上这三个字的就是家具箱。 */
export const FURNITURE_BOX_MARK = '家具箱'

/** 主数据名（api_mst_useitem 的 api_name）是不是一件家具箱。 */
export const isFurnitureBoxName = (name: string | null | undefined): boolean =>
  typeof name === 'string' && name.includes(FURNITURE_BOX_MARK)

/**
 * 按 id 查主数据名判断。名字查不到（主数据还没到手）一律**当作不是**：
 * 宁可多显示一行，也不能因为主数据没读上来就把别的道具一起吞掉。
 */
export const isFurnitureBoxId = (
  id: number,
  names: ReadonlyMap<number, string>,
): boolean => isFurnitureBoxName(names.get(id))

/** 从一串带道具 id 的行里剔掉家具箱。`on` 为假时原样返回。 */
export const dropFurnitureBoxes = <T>(
  rows: readonly T[],
  idOf: (row: T) => number,
  names: ReadonlyMap<number, string>,
  on: boolean,
): readonly T[] => (on ? rows.filter((row) => !isFurnitureBoxId(idOf(row), names)) : rows)
