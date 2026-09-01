// 点位字母：罗盘的 api_no（数字）→ 海图上写的那个字母（A/B/M…）。
//
// 玩家认的是字母，报文里只有数字，两者的对照表来自 poi-fcd-map 矿脉（MIT）。
// shi / ji 各自的海图卡本来就各有一份局部 letterOf；这个模块是给「只需要一句
// 地点文案、不画海图」的地方用的（履历卡、收容库），省得为一行字再抄一遍。
//
// 拿不到字母就退回 `#号`——与 shi 同口径。**不猜字母**：矿脉没覆盖的活动图新点位
// 编不出来，写个错字母比写编号更骗人。
import { queryLode } from './kernel'
import { mapCodeOf } from '../shared/map-id'

let route: any = null
let asked = false

/** 按需拉矿脉包。只拉一次（kernel 的 queryLode 本身也按 id 缓存），失败就一直退编号。 */
export const ensureMapCellLetters = (onReady?: () => void) => {
  if (asked) return
  asked = true
  void queryLode('poi-fcd-map')
    .then((lode) => {
      if (!lode?.data) return
      route = lode.data
      onReady?.()
    })
    .catch((error) => {
      console.warn('[kanso] 海图点位字母表读取失败', error)
    })
}

/** 点位字母；表还没到手或这一格没覆盖时退回 `#号`。 */
export const mapCellLetter = (map: number, cell: number): string =>
  route?.[mapCodeOf(map)]?.route?.[`${cell}`]?.[1] ?? `#${cell}`

/**
 * 一句话地点：`6-5 M 点`，Boss 点补个括号（与首见志的措辞同一套，
 * 玩家在战斗界面看到的就是那一句）。
 */
export const mapPlaceText = (map: number, cell: number, isBoss = false): string =>
  `${mapCodeOf(map)} ${mapCellLetter(map, cell)} 点${isBoss ? '（Boss）' : ''}`
