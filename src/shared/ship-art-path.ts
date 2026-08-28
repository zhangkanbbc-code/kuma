// 从游戏自己请求过的资源路径里，认出「这是哪艘舰的哪种图」。
//
// 为什么需要这个：新深海舰的立绘路径推不出来。实测 2026-08-09，
// 駆逐ラ級ζ-壊(2297) 的全身立绘真实路径是
//   /kcs2/resources/ship/full/2297_d_1270_yjgagupbvcov.png
// 其中 1270 是 createCipher(2297,'ship_full') 我们算得出，但还多了一个 `_d`
// 中缀和一串 12 位随机后缀——后者是防爬取用的，没有任何办法推导。
// 我们按老格式拼出的 /ship/full/2297_1270.png 只会 404，于是图鉴里一片空白。
//
// 所以改成「游戏下过什么，我们就记什么」：只读游戏自己发出的请求，
// 不主动探测、不猜测、不去第三方站抓图。玩家在游戏里见过的舰，图鉴里就能有。

import { damageTierOf } from './battle-damage'

/**
 * 这艘舰该不该换成受损立绘（`_dmg` 变体）。
 *
 * 游戏硬规则：**nowhp/maxhp ≤ 50%（中破线）起换**，大破不再换第二张——
 * 官方每种图只有「常态」与 `_dmg` 两个变体，中破与大破共用后者。
 * 判据与 poi 同：`views/components/ship/ship-item.tsx`、
 * `views/components/main/parts/mini-ship/mini-ship-row.tsx`、
 * `views/components/main/parts/repair-panel.tsx` 三处清一色 `isDamaged={hpPercentage <= 50}`
 * （入渠中的舰在 poi 那边也照 HP 换图，所以这里同样只看血量，不看是不是在渠里）。
 *
 * 阈值不在这里另写一个数字：走 battle-damage 的 damageTierOf（≤25% 大破 / ≤50% 中破），
 * 破损档的口径全项目就那一份，挪线时不会只挪一半。
 */
export const shipArtDamaged = (nowhp: number, maxhp: number): boolean => {
  if (!Number.isFinite(nowhp) || !(maxhp > 0)) return false
  const tier = damageTierOf(nowhp, maxhp)
  return tier === 'medium' || tier === 'heavy'
}

/** 一条学到的图：哪艘舰、哪种图、真实路径 */
export interface ShipArtPathEntry {
  mstId: number
  type: string
  pathname: string
}

// 形如 /kcs2/resources/ship/{type}/{4位id}{随便什么}.png
// type 允许字母/数字/下划线（banner_g_dmg、banner3、character_full_dmg 都要收）。
// id 之后不限制格式——正是因为格式会变，这里才不能写死。
const SHIP_ART = /^\/kcs2\/resources\/ship\/([a-z0-9_]+)\/(\d{4})(?:[_.][^/]*)?\.png$/i

/**
 * 认出一条 ship 美术路径。不是这类路径时返回 null。
 *
 * 只认 4 位 id 起头的文件名——游戏的 padId 固定补到 4 位，
 * 放宽到任意位数会把别的资源（比如带日期的图集）也误收进来。
 */
export const parseShipArtPath = (pathname: string): ShipArtPathEntry | null => {
  const m = SHIP_ART.exec(pathname)
  if (!m) return null
  const mstId = Number(m[2])
  if (!Number.isInteger(mstId) || mstId <= 0) return null
  return { mstId, type: m[1].toLowerCase(), pathname }
}

/** 存储用的键；一艘舰的一种图只留一条（新的覆盖旧的，跟着官方换版走） */
export const shipArtKey = (mstId: number, type: string): string => `${mstId}/${type}`

/**
 * 把学到的路径表收敛成干净结构。读盘时用——文件是我们自己写的，
 * 但没必要信任它的内容（手改过、版本变过、写到一半断电过都有可能）。
 */
export const sanitizeShipArtMap = (raw: unknown): Record<string, string> => {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'string') continue
    const parsed = parseShipArtPath(value)
    if (!parsed) continue
    // 键必须跟路径本身对得上，防止一条被张冠李戴地挂到别的舰下面
    if (key !== shipArtKey(parsed.mstId, parsed.type)) continue
    out[key] = value
  }
  return out
}
