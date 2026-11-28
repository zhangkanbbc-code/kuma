// BGM 反查的渲染层收口（2026-11-28 起）。
//
// 主数据配曲、本机留存的配曲变动、活动期间手抄的留存、家具附带曲，攒成一份反查索引
//（判据在 shared/bgm-usage）。海域卷的 BGM 页签、海域页的 BGM 行、家具详情、顶栏「正在播放」
// 共用这一份；同一份主数据只攒一次，攒好了在 document 上广播 `kuma:bgm-usage-change`。
import { mg, masterRawEpoch, queryMapBgmHistory, queryMasterRaw } from './kernel'
import { elink } from './link'
import { namedBattleBgmIds } from './bgm-names'
import { EVENT_MAP_BGM } from '../shared/event-map-bgm'
import { HEARD_BGM_NAMES, HEARD_PORT_BGM_NAMES } from '../shared/bgm-heard'
import { LOCAL_PORT_BGM_NAMES, type KcsBgmKind } from '../shared/kcs-bgm'
import { bgmUsageKey, bgmUsagePlaces, buildBgmUsage, type BgmUsage } from '../shared/bgm-usage'
import { lastMapBgmRowOf, type MapBgmRow, type MapBgmSpan } from '../shared/map-bgm-history'

export const BGM_USAGE_EVENT = 'kuma:bgm-usage-change'

let index: Map<string, BgmUsage> | null = null
let history: MapBgmSpan[] = []
// 按主数据版本只试一次：还没登录（主数据为空）时不至于每次渲染都去问一趟主进程，
// 主数据一到版本号就变，自然再试
let triedEpoch = -1
let loading = false

const furnitureOf = (data: any): { id: number; bgmId: number }[] =>
  (Array.isArray(data?.api_mst_furniture) ? data.api_mst_furniture : [])
    .map((f: any) => ({ id: Number(f?.api_id) || 0, bgmId: Number(f?.api_bgm_id) || 0 }))
    .filter((f: { id: number; bgmId: number }) => f.id > 0 && f.bgmId > 0)

/**
 * 没攒过、或主数据换了版，就重攒一份。各处渲染时随手调，同一份主数据下是零成本的同步判断。
 * 主数据换版时配曲留存也刚在主进程记过（store 的 start2 先记账、后推送），一并重取。
 */
export const ensureBgmUsage = (): void => {
  const epoch = masterRawEpoch()
  if (loading || epoch === triedEpoch) return
  triedEpoch = epoch
  loading = true
  void (async () => {
    try {
      const raw = await queryMasterRaw()
      if (!raw?.data) return
      const rows = await queryMapBgmHistory().catch(() => [])
      history = Array.isArray(rows) ? rows : []
      index = buildBgmUsage({
        master: Array.isArray(raw.data.api_mst_mapbgm) ? raw.data.api_mst_mapbgm : [],
        history,
        archive: EVENT_MAP_BGM.flatMap((archive) => archive.maps),
        furniture: furnitureOf(raw.data),
      })
      document.dispatchEvent(new CustomEvent(BGM_USAGE_EVENT))
    } catch (error) {
      console.warn('[kuma] BGM 反查索引构建失败', error)
    } finally {
      loading = false
      // 攒的这段时间里主数据又换了版：再来一遍
      if (masterRawEpoch() !== epoch) ensureBgmUsage()
    }
  })()
}

/** 这首曲的反查结果；索引还没攒好给 null，攒好了但哪儿都没用到也给 null */
export const bgmUsageOf = (kind: KcsBgmKind, id: number): BgmUsage | null =>
  index?.get(bgmUsageKey(kind, id)) ?? null

export const bgmUsageReady = (): boolean => index != null

/** 用到过的全部曲子（至少一处） */
export const bgmUsageAll = (): BgmUsage[] => [...(index?.values() ?? [])]

/** 留存从哪一刻开始（最早那一段的首次见到）；还没留存过给 null */
export const bgmHistoryStart = (): number | null =>
  history.length ? Math.min(...history.map((span) => span.firstSeen)) : null

/** 撤场的活动图：照留存拼回它最后那一行配曲（主数据里没有这张图时才该用） */
export const recordedMapBgmRowOf = (mapId: number): MapBgmRow | null => lastMapBgmRowOf(history, mapId)

/**
 * 收了名字的号（含没有任何地方在用的），BGM 总表搜索时用来列「其余曲目」。
 * 战斗树：誊写层 + 耳测层；母港树：主数据 + 耳测层 + 本地补名。
 */
export const namedBgmIds = (kind: KcsBgmKind): number[] => {
  const ids =
    kind === 'battle'
      ? [...namedBattleBgmIds(), ...HEARD_BGM_NAMES.map((entry) => entry.id)]
      : [
          ...Object.keys(mg.master.bgms ?? {}).map(Number),
          ...HEARD_PORT_BGM_NAMES.map((entry) => entry.id),
          ...Object.keys(LOCAL_PORT_BGM_NAMES).map(Number),
        ]
  return [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))].sort((a, b) => a - b)
}

/**
 * 曲名旁的「N 处」：悬停看用在哪，点了跳到海域卷 BGM 页签那一行。
 * 索引还没攒好或一处都没有就不出，不渲染空链接。
 */
export const bgmUsesLinkHtml = (kind: KcsBgmKind, id: number): string => {
  ensureBgmUsage()
  const places = bgmUsagePlaces(bgmUsageOf(kind, id))
  if (!places) return ''
  return `<span class="bgm-uses">${elink('bgm', bgmUsageKey(kind, id), `${places} 处`)}</span>`
}
