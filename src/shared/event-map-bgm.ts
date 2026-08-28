// 活动海域配曲的**留存**（游戏一手，非转写）。
//
// ## 为什么必须提前录
//
// 活动区的 `api_mst_mapbgm` 行会随活动撤场一起从 `api_start2` 里消失——
// 与活动区名、图名同一个毛病（那两样已由账本的 `event_map_catalog` 在关服时固化）。
// 配曲这一格没人固化过：活动一结束，图鉴里那张图的 BGM 行就再也拼不出来，
// 而它**在活动期间是拿得到的**。所以趁在场先抄一份。
//
// ## 这份数据是什么
//
// 逐格照抄提督本机 `api_start2` 快照里的 `api_mst_mapbgm` 行，字段名原样保留
// ——它是**游戏自己下发的事实**，不是从哪个站转写来的，也没有任何人的判断掺在里面。
// 曲名不在这里：这张表只管「哪张图的哪一步用哪个资源号」，
// 号到名字的事归 `shared/kcs-bgm` 那三层（主数据 / 誊写层 / 耳测层）。
//
// ## 纪律
//
//  · **只录在场期间亲手抄到的**。往期活动一律不补——那些行早就撤了，
//    没有一手来源，靠社区表格倒推出来的东西不配放在「游戏一手」这个名义下。
//  · 每一批标明取自哪一天的主数据快照，日后要复核有据可查。
//  · 撤场之后这份是唯一来源；撤场之前**永远以当下的主数据为准**（官方期中改过配曲
//    的先例是有的），所以调用方必须先查主数据、查不到才回落到这里。

export interface EventMapBgmRow {
  /** `api_mst_mapbgm.api_id`（= 区号×10 + 图号，如 62-3 是 623） */
  mapId: number
  /** 海域 MAP 画面 */
  api_moving_bgm: number
  /** [道中昼战, 道中夜战] */
  api_map_bgm: readonly [number, number]
  /** [Boss 昼战, Boss 夜战] */
  api_boss_bgm: readonly [number, number]
}

export interface EventMapBgmArchive {
  /** `api_maparea_id` */
  area: number
  /** 区名，照活动期间主数据里的原文 */
  areaName: string
  /** 这一批抄自哪一天的主数据快照 */
  capturedAt: string
  maps: readonly EventMapBgmRow[]
}

export const EVENT_MAP_BGM: readonly EventMapBgmArchive[] = [
  {
    area: 62,
    areaName: '反撃！第三十一戦隊の戦い',
    capturedAt: '2026-08-24',
    maps: [
      { mapId: 621, api_moving_bgm: 275, api_map_bgm: [276, 276], api_boss_bgm: [277, 277] },
      { mapId: 622, api_moving_bgm: 275, api_map_bgm: [276, 276], api_boss_bgm: [277, 277] },
      { mapId: 623, api_moving_bgm: 275, api_map_bgm: [276, 276], api_boss_bgm: [277, 277] },
      { mapId: 624, api_moving_bgm: 279, api_map_bgm: [280, 280], api_boss_bgm: [281, 281] },
      // 62-5 的 Boss 换回了旧号 124（「決戦！北大西洋」），不是前四张那套。
      // 这首的初出是 2018 初秋活动「抜錨！連合艦隊、西へ！」的 E-5 最终 Boss，
      // 那张图与 62-5 同属大西洋战场（62-5＝ブレスト沖/大西洋/イギリス本土沖/バルト海），
      // 所以是照战场复用老曲，不是随手挑的号
      { mapId: 625, api_moving_bgm: 279, api_map_bgm: [280, 280], api_boss_bgm: [124, 124] },
    ],
  },
]

const BY_MAP_ID = new Map(
  EVENT_MAP_BGM.flatMap((archive) => archive.maps.map((row) => [row.mapId, row])),
)

/**
 * 撤场活动图的配曲留存。
 *
 * **调用方必须先查当下的主数据**，查不到才用这里——活动还在场时以官方当刻下发的为准。
 */
export const archivedMapBgmOf = (mapId: number): EventMapBgmRow | null =>
  BY_MAP_ID.get(mapId) ?? null
