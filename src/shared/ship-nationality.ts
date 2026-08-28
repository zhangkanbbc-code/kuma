// EO ShipNationality 的本地镜像。
//
// 国籍不是游戏直接下发的字段；ElectronicObserver 按 api_sort_id（EO SortID）
// 的官方编号段判定。主进程任务条件、渲染层筛选与装备加成必须共用这一份，
// 避免各模块按舰名或舰级各猜一套。
export interface ShipNationalityMeta {
  id: number
  key: string
  label: string
  short: string
  aliases: readonly string[]
}

export const SHIP_NATIONALITIES: readonly ShipNationalityMeta[] = [
  { id: 1, key: 'japanese', label: '日本', short: '日', aliases: ['日本', '日本籍', '日籍'] },
  { id: 2, key: 'german', label: '德国', short: '德', aliases: ['德国', '德意志', '德国籍', '德籍'] },
  { id: 3, key: 'italian', label: '意大利', short: '意', aliases: ['意大利', '意大利籍', '意籍'] },
  { id: 4, key: 'american', label: '美国', short: '美', aliases: ['美国', '美军', '美国籍', '美籍', 'USS'] },
  { id: 5, key: 'british', label: '英国', short: '英', aliases: ['英国', '英国籍', '英籍'] },
  { id: 6, key: 'french', label: '法国', short: '法', aliases: ['法国', '法兰西', '法国籍', '法籍'] },
  { id: 7, key: 'russian', label: '俄罗斯', short: '俄', aliases: ['俄罗斯', '俄国', '苏联', '苏俄', '俄籍'] },
  { id: 8, key: 'thai', label: '泰国', short: '泰', aliases: ['泰国', '泰国籍', '泰籍'] },
  { id: 9, key: 'norwegian', label: '挪威', short: '挪', aliases: ['挪威', '挪威籍', '挪籍'] },
  { id: 10, key: 'swedish', label: '瑞典', short: '瑞', aliases: ['瑞典', '瑞典籍', '瑞籍'] },
  { id: 11, key: 'dutch', label: '荷兰', short: '荷', aliases: ['荷兰', '荷兰籍', '荷籍'] },
  { id: 12, key: 'australian', label: '澳大利亚', short: '澳', aliases: ['澳大利亚', '澳洲', '澳大利亚籍', '澳籍'] },
]

const SHIP_NATIONALITY_BY_ID = new Map(
  SHIP_NATIONALITIES.map((nationality) => [nationality.id, nationality]),
)

export const shipNationalityById = (
  id: number,
): ShipNationalityMeta | null => SHIP_NATIONALITY_BY_ID.get(id) ?? null

/**
 * **窄段**（36000–36099 里的泰 / 挪两段）的已见号位。
 *
 * 别的段都由**整千的**官方块界划开（30000 德、31000 意、…、37000 荷、38000 澳），
 * 只有 36060 与 36100 这两条界不是整千——它们是 EO 在两簇观测值中间**画出来的**，
 * 不是官方声明过的块界。窄到什么程度：泰段现存最大 36052、界在 36060，只剩 7 个号位。
 *
 * 而 `api_sort_id` 的低三位其实是「号位（两位）+ 形态（一位）」：
 * Thonburi 36051 / Thonburi改 36052 是号位 3605；Norge 36071/36072 是 3607，
 * Eidsvold 36081/36082 是 3608（2026-08-23 从本机主数据快照逐条读出）。
 * 于是**同一号位内**的新形态（Thonburi改二会落在 36053–36059）判得准，
 * 而一个**全新号位**落在窄段里判不准：泰国若再添一舰，多半拿号位 3606，
 * 那正好越过 36060 这条画出来的界，号段表会把它**静默说成挪威籍**——
 * 不报错、不落 unknown，界面上就是错的那一国。
 *
 * 所以窄段只认已见号位，新号位落「未归类」：**判不出来是一种状态，不是另一国**
 *（自扩展两层公约的名分层；「未归类」在界面上有格子，见 `SHIP_NATIONALITY_UNCLASSIFIED`）。
 * 失效方向也是安全的——哪天挪威真的补了号位 3606，这里显形成「未归类」等着有人加一行，
 * 而不是替官方把它认成别国。整千界的宽段不受这条约束（那些界是官方的，不是猜的）。
 */
const NARROW_SEGMENT_SLOTS: ReadonlyMap<number, ReadonlySet<number>> = new Map([
  [8, new Set([3605])], // 泰：Thonburi 36051 / Thonburi改 36052
  [9, new Set([3607, 3608])], // 挪：Norge 36071·36072 / Eidsvold 36081·36082
])

/** 这个号在所属窄段里有没有已见号位撑着；不是窄段的一律放行。 */
export const shipNationalitySlotAttested = (nationalityId: number, sortId: number): boolean => {
  const slots = NARROW_SEGMENT_SLOTS.get(nationalityId)
  return !slots || slots.has(Math.floor(sortId / 10))
}

const segmentIdFromSortId = (value: number): number => {
  if (value < 30000) return 1
  if (value < 31000) return 2
  if (value < 32000) return 3
  if (value < 33000) return 4
  if (value < 34000) return 5
  if (value < 35000) return 6
  if (value < 36000) return 7
  if (value < 36060) return 8
  if (value < 36100) return 9
  if (value < 37000) return 10
  if (value < 38000) return 11
  if (value < 39000) return 12
  return 0
}

export const shipNationalityIdFromSortId = (sortId: unknown): number => {
  const value = Number(sortId)
  if (!Number.isFinite(value) || value < 1000) return 0
  const id = segmentIdFromSortId(value)
  return shipNationalitySlotAttested(id, value) ? id : 0
}

/**
 * 「未归类」桶的编号。
 *
 * 号段表判不出国籍时 `shipNationalityIdFromSortId` 给 0——这是对的（不猜）。但界面上
 * 0 已经被「没在筛国籍」占着，于是那些舰在国籍这一维上既不属于任何一国、也没有一格
 * 可以站，等于凭空消失。分类维度必须有一个兜底格：**判不出来是一种状态，不是不存在**
 *（自扩展两层公约的名分层）。新号段被认领之后这一格自动空掉。
 */
export const SHIP_NATIONALITY_UNCLASSIFIED = -1

/** 这艘舰进哪个国籍桶：判得出来就是那一国，判不出来进「未归类」。 */
export const shipNationalityBucketOf = (sortId: unknown): number =>
  shipNationalityIdFromSortId(sortId) || SHIP_NATIONALITY_UNCLASSIFIED

export const shipNationalityOf = (
  ship: { api_sort_id?: unknown } | null | undefined,
): ShipNationalityMeta | null =>
  shipNationalityById(shipNationalityIdFromSortId(ship?.api_sort_id))
