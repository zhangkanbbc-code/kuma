// 「加入镇守府」的出处归因：这一艘是在哪张图哪个点位捞上来的，还是建造出来的。
//
// 为什么要单独一层：join 事件本身只是「上一份舰队快照里没有她、这一份里有」，
// 报文里没有任何字段说她怎么来的。出处只能从旁边两条**一手记录**借：
// - 掉落：battleresult 的 `api_get_ship`（当场也进遭遇志的 drop_mst），地点取那一战的图/点；
// - 建造：`kousyou/getship` 的 `api_ship.api_id`——那是**在籍 id**，精确到这一个实例。
//
// 实时归因（ship-life）与老记录回算（ledger 迁移）共用这一个函数，
// 两边跑不出第二套口径。
//
// 认领纪律（这个功能最容易骗人的地方就在这）：
// - 建造凭在籍 id 对号入座，没有歧义，先判它；
// - 掉落只有图鉴号可比。同一艘图鉴舰在窗口内连掉两次就会撞车，所以
//   **一条掉落只能被认领一次**，且按时间先后先到先得：join 是按获得顺序产生的
//   （在籍 id 递增），掉落也是，FIFO 配对天然对齐——包括「一次出击连掉两艘同名舰、
//   回港时两条 join 同一时刻落账」这种最容易张冠李戴的情形。
// - 认不到就返回 null。**确认不了就不标**：不写「未知」，也不拿窗口外的掉落硬凑。
//
// 已知会漏判的一种情形（宁可漏，不敢猜）：母港满员时游戏照样下发 api_get_ship，
// 那条掉落进了遭遇志却从没入籍。若窗口内随后又真捞到同一艘，FIFO 会把那条
// 「没接住的」派给她，地点就错了一格。窗口收到 12 小时是为了压住这一类；
// 报文里没有任何字段能区分接住没接住，所以只能承认这条边界。

/** 一条待归因的「加入镇守府」。 */
export interface ShipJoinRecord {
  ts: number
  /** 在籍 id（玩家持有实例），建造侧靠它精确匹配 */
  rosterId: number
  /** 图鉴号，掉落侧只有它可比 */
  mstId: number
}

/** 一次确认过的掉落（战斗结算当场记下的图/点）。 */
export interface ShipDropSighting {
  ts: number
  mstId: number
  map: number
  cell: number
  isBoss: boolean
}

/** 一次建造领取（getship）。mstId <= 0 表示报文里没读出来，只按在籍 id 认。 */
export interface ShipBuildReceipt {
  ts: number
  rosterId: number
  mstId: number
}

export type ShipJoinOrigin =
  | {
      origin: 'drop'
      /** 认领掉的那条掉落在入参数组里的下标，调用方据此把它划掉 */
      sourceIndex: number
      sourceTs: number
      map: number
      cell: number
      isBoss: boolean
    }
  | { origin: 'build'; sourceIndex: number; sourceTs: number }

/**
 * 认领时间窗。掉落/建造在**这么久之前**发生才算得上是这条 join 的来源。
 *
 * 12 小时：实测掉落到入籍只隔几十秒（回港那一刻才出现在舰队里），
 * 但玩家可能打完一场就搁着不回港。放宽到半天足够宽，又不至于让上个月的
 * 一条同名掉落跨过来认亲。
 */
export const SHIP_JOIN_ORIGIN_WINDOW_MS = 12 * 3600 * 1000

interface Indexed<T> {
  at: number
  row: T
}

const groupBy = <T extends { ts: number }>(
  rows: T[],
  keyOf: (row: T) => number,
): Map<number, Indexed<T>[]> => {
  const groups = new Map<number, Indexed<T>[]>()
  rows.forEach((row, at) => {
    const key = keyOf(row)
    const bucket = groups.get(key)
    if (bucket) bucket.push({ at, row })
    else groups.set(key, [{ at, row }])
  })
  for (const bucket of groups.values()) {
    bucket.sort((left, right) => left.row.ts - right.row.ts || left.at - right.at)
  }
  return groups
}

/**
 * 给每条 join 找出处。返回数组与 `joins` **一一对齐**（同下标同一条），
 * 认不到的位置是 null。
 *
 * 入参不必排好序：内部按「时刻 → 在籍 id」重排后再逐条认领，
 * 所以同一时刻落账的多条 join 会按获得顺序（在籍 id 递增）配对。
 */
export const matchShipJoinOrigins = (
  joins: ShipJoinRecord[],
  sources: { drops?: ShipDropSighting[]; builds?: ShipBuildReceipt[] } = {},
  options: { windowMs?: number } = {},
): (ShipJoinOrigin | null)[] => {
  const result: (ShipJoinOrigin | null)[] = joins.map(() => null)
  if (!joins.length) return result
  const windowMs = options.windowMs ?? SHIP_JOIN_ORIGIN_WINDOW_MS
  const dropsByMst = groupBy(sources.drops ?? [], (row) => row.mstId)
  const buildsByRoster = groupBy(sources.builds ?? [], (row) => row.rosterId)
  const claimedDrops = new Set<number>()
  const claimedBuilds = new Set<number>()
  const inWindow = (join: ShipJoinRecord, ts: number) =>
    ts <= join.ts && join.ts - ts <= windowMs

  const order = joins
    .map((join, at) => ({ join, at }))
    .sort(
      (left, right) =>
        left.join.ts - right.join.ts ||
        left.join.rosterId - right.join.rosterId ||
        left.at - right.at,
    )

  for (const { join, at } of order) {
    // 建造：在籍 id 是这一个实例的身份证，对上就没有第二种解释。
    // 仍然套时间窗——在籍 id 万一被游戏回收，上个月那条不该跨过来。
    const build = (buildsByRoster.get(join.rosterId) ?? []).find(
      (entry) =>
        !claimedBuilds.has(entry.at) &&
        inWindow(join, entry.row.ts) &&
        (entry.row.mstId <= 0 || entry.row.mstId === join.mstId),
    )
    if (build) {
      claimedBuilds.add(build.at)
      result[at] = { origin: 'build', sourceIndex: build.at, sourceTs: build.row.ts }
      continue
    }
    // 掉落：同图鉴号的最早一条未被认领的。先到先得，一条只认一次。
    const drop = (dropsByMst.get(join.mstId) ?? []).find(
      (entry) => !claimedDrops.has(entry.at) && inWindow(join, entry.row.ts),
    )
    if (drop) {
      claimedDrops.add(drop.at)
      result[at] = {
        origin: 'drop',
        sourceIndex: drop.at,
        sourceTs: drop.row.ts,
        map: drop.row.map,
        cell: drop.row.cell,
        isBoss: drop.row.isBoss,
      }
    }
  }
  return result
}
