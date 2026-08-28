// 活动海域 / 活动海图的判定——**单一出处**。
//
// 判据用游戏自己的标记 `api_mst_maparea.api_type`（常设 0 / 活动 1），比「id > 10」
// 这种猜测可靠；老版本主数据没有该字段时才回退到 id 阈值。两条分支都要保留：
// 回退分支还在被历史快照（以及测试里的旧格式样本）走到。
//
// 原先这段判定在铎、鉴、账本 store 里各写了一份（表达式一字不差地重复三遍），
// 锱要用时就该出现第四份了。改造链家族「三份手搓各自坏」的教训摆在那里，
// 这次先抽出来再用。新代码要判活动海域一律 import 这里，别再写第四份。
//
// 与 `shared/map-id.ts` 的 `isEventMapArea(area > 7)` 不是一回事：那条是**没有主数据**
// 时按 mapId 猜区属（历史归档、编号解码），这里是**手里有主数据**时按游戏的标记认。

export type EventAreaView = {
  /** 主数据是否带 `api_type` 字段（决定走标记判定还是 id 阈值兜底） */
  hasEventTypeFlag: boolean
  /** 活动海域（maparea）的 id 集合 */
  eventAreaIds: Set<number>
  /** 活动海图（mapinfo）清单，保持传入顺序 */
  eventMaps: any[]
}

/**
 * @param areas `api_mst_maparea` 原样数组
 * @param mapInfos `api_mst_mapinfo` 原样数组（不传则 eventMaps 为空）
 */
export const detectEventAreas = (
  areas: readonly any[] | null | undefined,
  mapInfos: readonly any[] | null | undefined = [],
): EventAreaView => {
  const rows = areas ?? []
  const hasEventTypeFlag = rows.some((a) => typeof a?.api_type === 'number')
  const eventAreaIds = new Set<number>(
    rows.filter((a) => (hasEventTypeFlag ? a?.api_type === 1 : (a?.api_id ?? 0) > 10)).map((a) => a?.api_id),
  )
  // 兜底分支这里刻意**不**过 eventAreaIds：老格式下 mapinfo 的区号本身就是判据，
  // 不要求该区一定出现在 maparea 表里（这是抽取前铎的行为，原样保留）。
  const eventMaps = (mapInfos ?? []).filter((m) =>
    hasEventTypeFlag ? eventAreaIds.has(m?.api_maparea_id) : m?.api_maparea_id > 10,
  )
  return { hasEventTypeFlag, eventAreaIds, eventMaps }
}

/**
 * 主数据里有没有活动海图（大活动进行中的判据）。
 *
 * 只认**有额外海图**的大活动——秋刀魚祭这类季节企划没有海图，
 * 不该被算成「活动进行中」（那套的侦测在 `shared/seasonal-campaign.ts`）。
 *
 * @param masterData `api_start2` 的 data 段
 */
export const hasEventMaps = (masterData: any): boolean =>
  detectEventAreas(masterData?.api_mst_maparea, masterData?.api_mst_mapinfo).eventMaps.length > 0

/**
 * 矿脉包说某条掉落属于「本期活动」，这个语境现在还成不成立？
 *
 * 包里的 `event.status: 'active'`（`shared/map-intel.ts`）是**落包那一刻**写死的
 * 字面量，活动结束了它也不会自己变成 `'ended'`。玩家不更新包，捞船单子就会一直
 * 把那批船列在「当前活动图可捞」底下，催他去打一张已经不存在的图。主数据是一手的：
 * 活动图从 `api_mst_mapinfo` 里撤掉了，那就是活动关了。
 *
 * **主数据不可用（null/undefined）时返回 true＝维持包的说法。** 这条是要害：
 * `hasEventMaps(null)` 自己会返回 false，直接拿它当判据就等于把「没有证据」
 * 读成「确认没有活动」——从没跑过游戏、mst 还是 null 的机器上，单子会凭空
 * 宣布活动已经结束。查不到不等于没有。
 */
export const eventContextStillOpen = (masterData: any): boolean =>
  masterData == null ? true : hasEventMaps(masterData)
