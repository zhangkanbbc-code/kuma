// 游戏美术资源（立绘/卡面/横幅）的本地取图。
//
// 资源表与 createCipher 移植自 poi views/utils/ship-img-cipher.ts
// (https://github.com/poooi/poi, MIT License, Copyright (c) poi contributors)，
// 路径拼装同 views/utils/ship-img.ts。
//
// 纪律：本地缓存优先（含 .hack 覆盖）；缓存里没有时**回退到游戏自己的资源服务器**，
// 与 poi 同（见下方 remoteUrl 处的说明：kcs2 静态美术 ≠ kcsapi，两者性质不同）。
// 该回退可在钥里关闭，关掉后行为退回「只读缓存」。
const path = require('path')
const fs = require('fs')
const { ipcRenderer } = require('electron')
const { pathToFileURL } = require('url')
const remote = require('@electron/remote')

import { setEquipIconSpriteProvider } from './equip-icon'
import { sanitizeShipArtMap, shipArtKey, type ShipArtPathEntry } from '../shared/ship-art-path'

const CACHE_PATH: string = remote.getGlobal('DEFAULT_CACHE_PATH')
const { getCacheCandidatePaths } = require(
  path.join(remote.getGlobal('ROOT'), 'assets', 'preload', 'kcs-resource-path'),
)

// 「田中的魔法」——kcs2 资源文件名的混淆表，改动即失效，原样保留
const RESOURCE = [
  6657, 5699, 3371, 8909, 7719, 6229, 5449, 8561, 2987, 5501, 3127, 9319, 4365, 9811, 9927, 2423,
  3439, 1865, 5925, 4409, 5509, 1517, 9695, 9255, 5325, 3691, 5519, 6949, 5607, 9539, 4133, 7795,
  5465, 2659, 6381, 6875, 4019, 9195, 5645, 2887, 1213, 1815, 8671, 3015, 3147, 2991, 7977, 7045,
  1619, 7909, 4451, 6573, 4545, 8251, 5983, 2849, 7249, 7449, 9477, 5963, 2711, 9019, 7375, 2201,
  5631, 4893, 7653, 3719, 8819, 5839, 1853, 9843, 9119, 7023, 5681, 2345, 9873, 6349, 9315, 3795,
  9737, 4633, 4173, 7549, 7171, 6147, 4723, 5039, 2723, 7815, 6201, 5999, 5339, 4431, 2911, 4435,
  3611, 4423, 9517, 3243,
]

const createKey = (t: string): number => {
  let e = 0
  for (let i = 0; i < t.length; i++) e += t.charCodeAt(i)
  return e
}

const createCipher = (id: number, seed: string): string => {
  const r = parseInt(`${id}`.match(/\d+/)?.[0] ?? '', 10)
  if (!Number.isFinite(r)) return ''
  const s = createKey(seed)
  const a = seed.length || 1
  return (((17 * (r + 7) * RESOURCE[(s + r * a) % 100]) % 8973) + 1000).toString()
}

export type ShipImgType =
  | 'banner'
  | 'banner_g' // 沉没后的灰色横幅；只存在损伤形态，见 shipImageUrl
  | 'card'
  | 'remodel'
  | 'character_up'
  | 'character_full'
  | 'full'
  | 'supply_character'
  | 'album_status'

export type SlotItemImgType =
  | 'airunit_banner'
  | 'airunit_fairy'
  | 'airunit_name'
  | 'btxt_flat'
  | 'cart_t'
  | 'card'
  | 'item_character'
  | 'item_on'
  | 'item_up'
  | 'remodel'
  | 'statustop_item'

/** 该图在缓存里的绝对路径；不存在返回 null（.hack 覆盖优先，同 poi） */
const cachedFiles = new Map<string, string>()
// 负结果单独记且带 TTL：游戏随时可能把这张图下载进缓存目录，「本地没有」
// 永久缓存的话，关着远端回退时这张图直到重启都显示不出来。
const cachedMisses = new Map<string, number>()
const MISS_RECHECK_MS = 60_000
const cachedFile = (pathname: string): string | null => {
  const hit = cachedFiles.get(pathname)
  if (hit) return hit
  const missUntil = cachedMisses.get(pathname)
  if (missUntil != null && Date.now() < missUntil) return null
  const candidates: string[] = getCacheCandidatePaths(CACHE_PATH, pathname)
  for (const file of candidates) {
    try {
      fs.accessSync(file, fs.constants.R_OK)
      cachedFiles.set(pathname, file)
      cachedMisses.delete(pathname)
      return file
    } catch (_e) {
      /* 试下一个 */
    }
  }
  cachedMisses.set(pathname, Date.now() + MISS_RECHECK_MS)
  return null
}

// ---- 未缓存时的回退：游戏自己的资源服务器 ----
//
// 为什么这不违反「被动只读」：三原则那条说的是**绝不主动请求 kcsapi**——
// kcsapi 是会改/暴露账号状态的游戏 API，替玩家请求它等于替玩家操作。
// 而 /kcs2/resources/*.png 是静态美术资源，取它跟游戏自己加载一张图是同一件事：
// 不改状态、不消耗、不产生任何玩家行为记录。两者性质不同，不该一刀切。
// （poi 的 views/utils/ship-img.ts 就是这么做的：先找本地缓存与 .hack 覆盖，
//   找不到就把 <img src> 指向 https://{游戏服务器}{路径}。我们此前只做了前半段。）
//
// 仍然守住的边界：只在**已经识别出游戏服务器**时才回退（说明你正连着游戏），
// 且可在钥里关掉；关掉后行为与之前完全一致——只读缓存。
export interface MapArtLayer {
  imageUrl: string
  x: number
  y: number
}

export interface MapArtManifest {
  width: number
  height: number
  layers: MapArtLayer[]
}

const mapArtCache = new Map<string, Promise<MapArtManifest | null>>()

const notifyArtSourceChange = () => {
  if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('kanso:art-source-change'))
}

let gameHost: string | null = null
export const setGameHost = (host: string | null) => {
  const next = host && /^[\w.-]+$/.test(host) ? host : null
  // 主机没变就什么都别做。这个函数在启动时用记住的主机调一次，游戏加载完
  // 又会被 kancolle.server.change 用**同一个**主机再调一次（还有一条补读路径）。
  // 原来无条件执行，于是每次都白扔一遍地图美术缓存（下次打开海域要重新取），
  // 并把 art-source-change 广播出去让全文档重扫一遍。
  // 实测启动到游戏加载完这段窗口里，这个事件发了 4 次。
  if (next === gameHost) return
  gameHost = next
  mapArtCache.clear()
  clearDeadArtUrls() // 换了主机，之前「取不到」的结论一律作废
  notifyArtSourceChange()
}

// api_mst_shipgraph.api_version[0] 是官方图片换版号。季节立绘沿用同一路径，
// 必须把它带进远端 URL 才能绕过 Chromium/CDN 对旧图片的长期缓存。
let shipImageVersion = new Map<number, string>()
export type ShipGraphLayout = Record<string, [number, number]>
let shipGraphLayouts = new Map<number, ShipGraphLayout>()
// api_mst_shipgraph.api_filename——全身立绘的文件名尾巴就是它。
// 一度以为那是防爬取的随机串（实测 2026-08-09 才发现不是）：語音目录 kc{filename}
// 用的是同一个值，時雨改三的语音在 kcxgkywfhkphjf/，立绘就叫
// 0961_6849_xgkywfhkphjf.png。所以 full 系列完全算得出来，不必等游戏下过。
let shipGraphFilename = new Map<number, string>()
export const setShipImageGraph = (mstShipgraph: any[]) => {
  const next = new Map<number, string>()
  const layouts = new Map<number, ShipGraphLayout>()
  const filenames = new Map<number, string>()
  for (const graph of mstShipgraph ?? []) {
    const id = Number(graph?.api_id)
    const version = Array.isArray(graph?.api_version) ? graph.api_version[0] : null
    if (id > 0 && version != null && `${version}`) {
      next.set(id, `${version}`)
    }
    if (id > 0 && typeof graph?.api_filename === 'string' && /^[a-z0-9]+$/i.test(graph.api_filename)) {
      filenames.set(id, graph.api_filename)
    }
    if (id > 0) {
      const layout: ShipGraphLayout = {}
      for (const [key, value] of Object.entries(graph)) {
        if (
          /^api_(?:battle|boko|kaisyu|kaizo|map|ensyuf|ensyue|wed[abcd]?|pa|pab)(?:_[nd])?$/.test(key) &&
          Array.isArray(value) &&
          value.length >= 2 &&
          Number.isFinite(Number(value[0])) &&
          Number.isFinite(Number(value[1]))
        ) {
          layout[key] = [Number(value[0]), Number(value[1])]
        }
      }
      if (Object.keys(layout).length) layouts.set(id, layout)
    }
  }
  shipImageVersion = next
  shipGraphLayouts = layouts
  shipGraphFilename = filenames
  // 主数据重来一遍就重新试一次那些「取不到」的图。
  // 官方给某艘舰补了立绘时，多数情况版本号会跟着变（URL 就变了、本来也不会命中
  // 死链表）；但也有原地新增、版本号不动的情况，这一下就是给它兜底。
  clearDeadArtUrls()
  notifyArtSourceChange()
}

/** 游戏各场景摆放透明立绘时使用的原生锚点；横幅/卡面是已裁切资源，不应再套位移。 */
export const shipGraphLayout = (mstId: number): ShipGraphLayout | null =>
  shipGraphLayouts.get(mstId) ?? null

/**
 * 这个形态**现行**的图片版本号（`api_mst_shipgraph.api_version[0]`）。
 *
 * 它是立绘档案卡唯一能从主数据精确拿到的东西：官方在同一个地址上换图会把它推上去，
 * 所以「档案里那几份有没有一份是现行这版」是可对账的事实。
 * 但它**不说明**换上去的是不是季节版——主数据里没有那个标记
 *（逐字段穷举的结论记在 shared/seasonal-collect 的文件头）。
 * 主数据没到位时返回空串，调用方据此说「还不知道」，别显示成「没有」。
 */
export const shipImageVersionOf = (mstId: number): string => shipImageVersion.get(mstId) ?? ''

let allowRemoteArt = true
export const setAllowRemoteArt = (v: boolean) => {
  allowRemoteArt = v
  mapArtCache.clear()
  clearDeadArtUrls() // 关了再开，之前因为「不许取」而失败的要重新试
  notifyArtSourceChange()
}
export const remoteArtState = () => ({ enabled: allowRemoteArt, host: gameHost })

const remoteUrl = (pathname: string): string | null =>
  allowRemoteArt && gameHost ? `https://${gameHost}${pathname}` : null

const staticResourceUrl = (pathname: string): string | null => {
  const file = cachedFile(pathname)
  return file ? pathToFileURL(file).href : remoteUrl(pathname)
}

// ---- 装备类别图标：游戏自己的雪碧图 ----
//
// poi 的 SVG 剪影与游戏原版形状对不上（水上机原版带浮筒；48/49/51 poi 上游
// 发的甚至是邻位复制品——2026-08-11 用户逐一指出后全目录核实）。游戏把全部
// 类别图标发在 /kcs2/img/common/common_icon_weapon.{json,png}（45×45 图集，
// 帧名 common_icon_weapon_id_N），取它就是与游戏逐像素一致的第一手图形。
// 拿不到（离线且本地镜像没有）时由 equip-icon 退回 poi SVG，再退文字。
interface SlotIconFrame { x: number; y: number; w: number; h: number }
let slotIconFrames: Map<number, SlotIconFrame> | null = null
let slotIconSheet: { w: number; h: number } | null = null
let slotIconLoading = false

const ensureSlotIconAtlas = (): void => {
  if (slotIconFrames || slotIconLoading) return
  slotIconLoading = true
  void (async () => {
    const data = await readStaticJson<{
      frames?: Record<string, { frame?: SlotIconFrame }>
      meta?: { size?: { w?: number; h?: number } }
    }>('/kcs2/img/common/common_icon_weapon.json')
    const size = data?.meta?.size
    if (!data?.frames || !Number.isInteger(size?.w) || !Number.isInteger(size?.h)) {
      slotIconLoading = false // 游戏还没连上、镜像也没有：下次渲染再试
      return
    }
    const frames = new Map<number, SlotIconFrame>()
    for (const [key, value] of Object.entries(data.frames)) {
      const id = Number(key.match(/_id_(\d+)$/)?.[1])
      const frame = value?.frame
      if (Number.isInteger(id) && frame && Number.isFinite(frame.x)) {
        frames.set(id, { x: frame.x, y: frame.y, w: frame.w, h: frame.h })
      }
    }
    if (!frames.size) {
      slotIconLoading = false
      return
    }
    slotIconFrames = frames
    slotIconSheet = { w: size!.w!, h: size!.h! }
    notifyArtSourceChange()
  })()
}

/** 类别图标的图集切片样式；游戏图形不可用时给 null（equip-icon 退 SVG）。
 *  背景尺寸/位置全用百分比——与渲染尺寸无关，xs/sm/lg 同一份样式都对。 */
export const slotIconSpriteStyle = (iconId: number): string | null => {
  ensureSlotIconAtlas()
  if (!slotIconFrames || !slotIconSheet) return null
  const frame = slotIconFrames.get(iconId)
  if (!frame || frame.w <= 0 || frame.h <= 0) return null
  const image = staticResourceUrl('/kcs2/img/common/common_icon_weapon.png')
  if (!image) return null
  const posX = slotIconSheet.w > frame.w ? (frame.x / (slotIconSheet.w - frame.w)) * 100 : 0
  const posY = slotIconSheet.h > frame.h ? (frame.y / (slotIconSheet.h - frame.h)) * 100 : 0
  return (
    `background-image:url('${image}');` +
    `background-size:${(slotIconSheet.w / frame.w) * 100}% ${(slotIconSheet.h / frame.h) * 100}%;` +
    `background-position:${posX}% ${posY}%`
  )
}
setEquipIconSpriteProvider(slotIconSpriteStyle)

// 交给锚用 net.fetch 取。
//
// 原先这里是 node 的 https.get，那条路**不走 Chromium 网络栈**：没有 UA、
// 没有 Referer、不吃 HTTP 缓存，服务器侧看跟浏览器请求完全是两种东西。
// poi 全仓库没有一处 https.get/http.get，网络请求一律走 fetch / net.fetch。
// 别独创请求方式——十年没出事的那套照抄就行。
//
// 换过来还白捡一个好处：net.fetch 会命中 Chromium 磁盘缓存，玩家在游戏里
// 打开过那张图之后，我们这边根本不会再产生网络请求。
const readRemoteJson = <T>(url: string): Promise<T | null> =>
  ipcRenderer.invoke('kanso:map-art-json', url) as Promise<T | null>

const readStaticJson = async <T>(pathname: string): Promise<T | null> => {
  const file = cachedFile(pathname)
  if (file) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as T
    } catch (error) {
      console.warn('[kanso] 本地地图美术元数据无效', file, error)
      return null
    }
  }
  const url = remoteUrl(pathname)
  return url ? readRemoteJson<T>(url) : null
}

// ---- 游戏自己下过的真实路径 ----
//
// 新深海舰的立绘路径推不出来：駆逐ラ級ζ-壊(2297) 的真实路径是
// /kcs2/resources/ship/full/2297_d_1270_yjgagupbvcov.png，比我们按 cipher
// 拼出的 /ship/full/2297_1270.png 多了 `_d` 中缀和一段 12 位随机串。
// 那串防的就是推导，所以只能记下游戏实际请求过的路径（锚在 onBeforeRequest 里收）。
const learnedArt = new Map<string, string>()
const loadLearnedArt = () => {
  try {
    const file = path.join(remote.getGlobal('APPDATA_PATH'), 'ship-art-paths.json')
    if (!fs.existsSync(file)) return
    for (const [key, value] of Object.entries(
      sanitizeShipArtMap(JSON.parse(fs.readFileSync(file, 'utf8'))),
    )) {
      learnedArt.set(key, value)
    }
  } catch (error) {
    // 学过的路径没了只是回到「按 cipher 拼」，不该影响启动
    console.warn('[kanso] 舰船美术路径表读取失败，按空表继续', error)
  }
}
loadLearnedArt()

/** 锚广播「游戏刚下了这张图」时调用；新路径要让已经画出来的格子重画 */
export const noteLearnedShipArt = (entry: ShipArtPathEntry): void => {
  if (!entry?.pathname || !(entry.mstId > 0)) return
  const key = shipArtKey(entry.mstId, entry.type)
  if (learnedArt.get(key) === entry.pathname) return
  learnedArt.set(key, entry.pathname)
  // 这条以前多半是 404 过的，死链表里那条现在无意义了
  clearDeadArtUrls()
  notifyArtSourceChange()
}

/**
 * 这张图实际该不该带 `_dmg` 后缀。两个取图入口共用，免得改一处漏一处。
 *
 * 顺序有讲究：`banner_g`（沉没横幅）只存在损伤形态，必须判在深海重置**之前**
 * 返回——poi 是先强制它 damaged=true 再跑深海重置，结果深海舰又被抹回不带
 * `_dmg` 的路径；而实测 2297 的真实资源就是 `banner_g_dmg`。
 */
const resolveDamagedSuffix = (mstId: number, type: ShipImgType, damaged: boolean): boolean => {
  if (type === 'album_status') return false
  if (type === 'banner_g') return true
  // 深海舰（>1500）损伤图与常态相同，北方栖姫系除外（同 poi）
  if (mstId > 1500 && ![1587, 1588, 1589, 1590].includes(mstId)) return false
  return damaged
}

// 只有全身立绘的文件名带 api_filename 尾巴。实测 27/27 条真实路径都符合，
// 而 banner / card / remodel 这些一条都没有——所以不能对所有类型都加。
const FULL_TYPES = new Set(['full', 'full_dmg'])

/** 按主数据推算的路径。学不到真实路径时用它，两个取图入口共用。 */
const guessArtPath = (mstId: number, ntype: string): string | null => {
  const cipher = createCipher(mstId, `ship_${ntype}`)
  if (!cipher) return null
  const tail = FULL_TYPES.has(ntype) ? shipGraphFilename.get(mstId) : undefined
  const padId = `${mstId}`.padStart(4, '0')
  return `/kcs2/resources/ship/${ntype}/${padId}_${cipher}${tail ? `_${tail}` : ''}.png`
}

/**
 * 这张图在游戏资源树里的路径。**它是档案里的身份**（与图鉴逐格点亮同一个键），
 * 所以取图与入档必须用同一份推导——各写一份必然漂移，而漂移的表现是
 * 「图显示出来了、格子却不亮」，不报错。
 */
export const shipImagePath = (mstId: number, type: ShipImgType, damaged = false): string | null => {
  const ntype = `${type}${resolveDamagedSuffix(mstId, type, damaged) ? '_dmg' : ''}`
  // 游戏下过的真实路径永远优先——它是事实，我们拼的只是推测
  // （2297 那种在 id 后面插 `_d` 的变体就只能靠学，主数据里没有可推的依据）
  return learnedArt.get(shipArtKey(mstId, ntype)) ?? guessArtPath(mstId, ntype)
}

/** 舰娘立绘的 URL：本地缓存优先，未缓存则回退游戏资源服务器（可在钥里关） */
export const shipImageUrl = (mstId: number, type: ShipImgType, damaged = false): string | null => {
  const pathname = shipImagePath(mstId, type, damaged)
  if (!pathname) return null
  const file = cachedFile(pathname)
  if (file) return pathToFileURL(file).href
  const remote = remoteUrl(pathname)
  const version = shipImageVersion.get(mstId)
  return remote && version ? `${remote}?version=${encodeURIComponent(version)}` : remote
}

/**
 * 「显示即入档」：这张舰船美术刚在艦素里**显示成功**了，顺手让主进程留一份进档案。
 *
 * ---- 为什么要有这一句（2026-08-23 用户实机报的脱节）----
 * 他打开立绘页，整张立绘好端端显示着，收集格却写「0/6 图种」。
 * 两本账各说各的：**显示**走这个文件（缓存命中 + 游戏资源服务器回退），
 * **点亮**认档案层，而档案层此前只收「游戏页面自己请求资源」那条钩子——
 * 艦素自己摆出来的图根本不经过它。
 *
 * 补法不是把点亮判据放宽去认缓存（缓存会被整盘丢弃，收集进度会随时蒸发），
 * 而是把显示这件事本身变成一次入档。从此「看见了」与「点亮了」是一件事的两面。
 *
 * **不在热路径上**：调用方在 `<img>` 的 load 事件里发一条单向 IPC 就完事，
 * 显示不等转存；取字节、去重、落盘全在主进程异步做（main/archive-capture）。
 */
export const noteShipArtDisplayed = (pathname: string, url: string, version?: string): void => {
  if (!pathname || !url) return
  try {
    // `version` 只在调用方手上有主数据现行版号时才带（图鉴画廊那条路）：
    // 本机缓存命中时地址是 `file://…`，从地址里提不出版本，而版本是版本对账的判据。
    ipcRenderer.send('kanso:archive-capture-art', { pathname, url, version: version ?? '' })
  } catch (_error) {
    // 入档失败只是这一张没留住，不该影响正在显示的这一帧
  }
}

/** 装备图鉴用的卡面 */
export const slotItemImageUrl = (mstId: number, type: SlotItemImgType = 'card'): string | null => {
  // 深海装备（1500+）确实没有 card 卡面，但**有自己的装备图**——旧实现在这里
  // 一刀切 return null，把能取到的那张也挡掉了。实测 2026-08-09 逐类型探过：
  //   深海飞机（1549 深海復讐艦攻）  只有 item_up，是真实装备立绘
  //   深海火炮（1653 / 1502）        只有 btxt_flat，那是**装备名的艺术字**，
  //                                  不是装备图，当卡面用会很怪，所以不换过去
  // 于是只把 card 换成 item_up；火炮类照样取不到，交给调用方的 404 回退。
  //
  // 别再改回「减 1000 去取玩家装备的图」那一版：玩家装备最大 id 才 588，
  // 减完必然落在有效段里，会稳定显示成完全无关的卡面。
  const effective: SlotItemImgType = mstId >= 1500 && type === 'card' ? 'item_up' : type
  const pathname = slotItemPath(mstId, effective)
  if (!pathname) return null
  const file = cachedFile(pathname)
  return file ? pathToFileURL(file).href : remoteUrl(pathname)
}

const slotItemPath = (mstId: number, type: SlotItemImgType): string | null => {
  const cipher = createCipher(mstId, `slot_${type}`)
  if (!cipher) return null
  return `/kcs2/resources/slot/${type}/${`${mstId}`.padStart(4, '0')}_${cipher}.png`
}

// 装备的全部贴图。标签是逐张看图定的（2026-08-09），不是照类型名猜的：
//   item_up        纯装备，无妖精
//   item_character 纯妖精，举着装备
//   item_on        上面两者的合成图 —— 所以「拆分」指的就是前两张
//   card           带边框/星级/名字的完整卡面（图鉴用的那张）
//   remodel        改修界面的小卡，带边框与图标
//   statustop_item 图鉴顶栏的金色标题条（No. + 装备名）
//   btxt_flat      装备名的艺术字，没有装备本体
//   airunit_*      只有基地航空队能带的机种才有
//   cart_t         四种装备实测全 404，留着让它自己落空
const SLOT_IMG_WANTED: [SlotItemImgType, string, boolean][] = [
  ['card', '卡面', true],
  ['item_on', '装备 · 带妖精', true],
  ['item_up', '装备 · 单体', true],
  ['item_character', '妖精 · 单体', true],
  ['remodel', '改修卡', true],
  ['airunit_banner', '基地队 · 横幅', false],
  ['airunit_fairy', '基地队 · 妖精', false],
  ['airunit_name', '基地队 · 名牌', false],
  ['statustop_item', '图鉴标题', false],
  ['btxt_flat', '名牌', false],
  ['cart_t', '运输', false],
]

/**
 * 一次性摆出该装备能取到的全部贴图。
 *
 * 这里按**原类型**逐个取，不做 slotItemImageUrl 里那个 card→item_up 的替换——
 * 那是给「卡面位」用的兜底，而这里要如实标出每一张是哪一种。
 */
export const availableSlotItemImages = (
  mstId: number,
): { type: SlotItemImgType; url: string; label: string; big: boolean }[] => {
  const out: { type: SlotItemImgType; url: string; label: string; big: boolean }[] = []
  for (const [type, label, big] of SLOT_IMG_WANTED) {
    const pathname = slotItemPath(mstId, type)
    if (!pathname) continue
    const file = cachedFile(pathname)
    const url = file ? pathToFileURL(file).href : remoteUrl(pathname)
    if (url && !deadArtUrls.has(url)) out.push({ type, url, label, big })
  }
  return out
}

/**
 * 家具（装饰品）图。路径规则 2026-08-17 对资源服务器实测确认：
 * /kcs2/resources/furniture/{tree}/{id 三位补零}_{cipher(id,'furniture_{tree}')}.png
 * - normal：摆放完整图（约 1200 宽横图）——**部分家具没有**（壁挂类 578 实测 404）
 * - reward：247×307 展示卡（家具屋预览那张）——实测两类抽样全有，当回退/速览用
 * card/thumbnail/picture 等树不存在。
 */
const furniturePath = (furnitureId: number, tree: 'normal' | 'reward'): string | null => {
  if (!Number.isInteger(furnitureId) || furnitureId <= 0) return null
  const cipher = createCipher(furnitureId, `furniture_${tree}`)
  if (!cipher) return null
  return `/kcs2/resources/furniture/${tree}/${`${furnitureId}`.padStart(3, '0')}_${cipher}.png`
}

export const furnitureImageUrl = (
  furnitureId: number,
  tree: 'normal' | 'reward' = 'normal',
): string | null => {
  const pathname = furniturePath(furnitureId, tree)
  return pathname ? staticResourceUrl(pathname) : null
}

/**
 * BGM 音频。与「正在播放」嗅探（shared/kcs-bgm）同一棵树，cipher 规律
 * 2026-08-17 对嗅探真实样本与资源服务器实测确认：
 * /kcs2/resources/bgm/{port|battle}/{id 三位补零}_{cipher(id,'bgm_{kind}')}.mp3
 * 家具附带曲/母港曲在 port 树；海域移动曲与昼夜/Boss 战斗曲在 battle 树。
 */
export const bgmAudioUrl = (bgmId: number, kind: 'port' | 'battle'): string | null => {
  if (!Number.isInteger(bgmId) || bgmId <= 0) return null
  const cipher = createCipher(bgmId, `bgm_${kind}`)
  if (!cipher) return null
  return staticResourceUrl(`/kcs2/resources/bgm/${kind}/${`${bgmId}`.padStart(3, '0')}_${cipher}.mp3`)
}

/** 道具图鉴卡面。游戏资源以三位 useitem ID 直接命名，不使用舰船/装备的混淆串。 */
export const useItemImageUrl = (mstId: number): string | null => {
  if (!Number.isInteger(mstId) || mstId <= 0) return null
  // 这两项在 useitem 表里是装备的兼容入口，本体卡面仍在 slot 资源树。
  if (mstId === 50) return slotItemImageUrl(42, 'card') // 応急修理要員
  if (mstId === 76) return slotItemImageUrl(241, 'card') // 戦闘糧食(特別なおにぎり)
  // 当前游戏资源树没有这些 useitem 卡面；避免每次开目录都制造确定的 404。
  if ([2, 10, 44, 53, 103].includes(mstId)) return null
  return staticResourceUrl(`/kcs2/resources/useitem/card/${`${mstId}`.padStart(3, '0')}.png`)
}

/**
 * 读取游戏官方地图背景的精灵图描述。仅打开某张海域详情时调用；
 * 目录缩略图继续使用本地 FCD，避免每张图两次 JSON + 一张图集的批量请求。
 */
export const mapArtManifest = (areaId: number, mapNo: number): Promise<MapArtManifest | null> => {
  const key = `${areaId}-${mapNo}`
  const known = mapArtCache.get(key)
  if (known) return known
  const pending = (async () => {
    const dir = `${areaId}`.padStart(3, '0')
    const no = `${mapNo}`.padStart(2, '0')
    const base = `/kcs2/resources/map/${dir}/${no}`
    const [info, image] = await Promise.all([
      readStaticJson<{ bg?: Array<string | { img?: string; name?: string }> }>(`${base}_info.json`),
      readStaticJson<{ frames?: Record<string, { frame?: { x?: number; y?: number } }> }>(
        `${base}_image.json`,
      ),
    ])
    const atlas = staticResourceUrl(`${base}_image.png`)
    if (!info || !image?.frames || !atlas) return null
    const layers: MapArtLayer[] = []
    for (const entry of info.bg ?? []) {
      const name = typeof entry === 'string' ? entry : entry.img ?? entry.name
      if (!name) continue
      const frameEntry = Object.entries(image.frames).find(([frameName]) =>
        frameName.endsWith(`_${name}`),
      )?.[1]
      const x = frameEntry?.frame?.x
      const y = frameEntry?.frame?.y
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      layers.push({ imageUrl: atlas, x: -(x as number), y: -(y as number) })
    }
    return layers.length ? { width: 1200, height: 720, layers } : null
  })()
  mapArtCache.set(key, pending)
  return pending
}

// ---- 这里曾经有一个社区图标源（tsunkit）的降级补位，2026-08-22 整条退役 ----
//
// 发行产物的**对外请求只许指向游戏自己的服务器**，第三方服务零请求——
// 用户定的：「这也算是向外请求，我们最好能做到不额外增加玩家和服务器的负担」。
// 那个回退成型于「显式拉取中间路」被废弃之前（当时的口径是「点了才请求」），
// 是一件漏网旧物；何况 tsunkit 正是 2026-08-06 封过本项目出口 IP 的那家，
// 数据也无许可声明。缺图那一格现在只出文字说明，不发请求、也不写抱怨文案。
// 护栏：core-regressions 有一条「全仓不许出现 tsunkit.net」的断言盯着它别回来。

/** 一次性探出该舰在缓存里有哪些图，供图鉴排版 */
export const availableShipImages = (
  mstId: number,
): { type: ShipImgType; damaged: boolean; url: string; label: string; pathname: string }[] => {
  const out: {
    type: ShipImgType
    damaged: boolean
    url: string
    label: string
    /** 档案里的身份。显示成功之后拿它入档（见 noteShipArtDisplayed） */
    pathname: string
  }[] = []
  for (const [type, damaged, label] of SHIP_IMG_WANTED) {
    const url = shipImageUrl(mstId, type, damaged)
    const pathname = shipImagePath(mstId, type, damaged)
    if (url && pathname && !deadArtUrls.has(url)) out.push({ type, damaged, url, label, pathname })
  }
  return out
}

/**
 * 取过一次、服务器上确实没有的图。
 *
 * 官方资源目录里并不是每艘舰每种图都有——多数深海舰只有横幅。而这里是
 * 「先按 12 种全摆出来，谁 404 谁被删」：**每次重渲染都要重演一遍**，
 * 于是进母港那一下（mg 变化触发重渲染）就会闪过一排空框。
 * 实测飞行场栖姬：每次渲染摆 8 格，其中 7 格是死链，稳定后只剩 1 格。
 *
 * 只在本次会话内记，不落盘：error 事件分不清「服务器没有」和「这次网断了」，
 * 记进配置会让一次偶发失败永久藏掉一张真实存在的图。
 */
const deadArtUrls = new Set<string>()
export const markShipImageMissing = (url: string): void => {
  if (url) deadArtUrls.add(url)
}
/** 任何可能改变「这张图存不存在」的事件都要把它清空，别把一次取不到变成永久结论 */
export const clearDeadArtUrls = (): void => deadArtUrls.clear()

// big = 全身尺寸，排版时占大格；其余是横幅/卡面这类小图。
// 「立绘只有个头像」通常不是代码问题，而是缓存里只有 banner/card——
// 全身立绘要在游戏里打开该舰的图鉴页/改装页才会被游戏自己下载。
export const SHIP_IMG_WANTED: [ShipImgType, boolean, string, boolean][] = [
  ['full', false, '全身立绘', true],
  ['full', true, '全身 · 中破', true],
  ['character_full', false, '立绘', true],
  ['character_full', true, '立绘 · 中破', true],
  ['album_status', false, '图鉴立绘', true],
  ['remodel', false, '改装图', true],
  ['character_up', false, '半身', false],
  ['card', false, '卡面', false],
  ['card', true, '卡面 · 中破', false],
  ['banner', false, '横幅', false],
  ['banner', true, '横幅 · 中破', false],
  // 沉没后的灰色横幅（_g = gray）。出击里被击沉、演习里被击破都用它，
  // 所以标签不写「击沉」——玩家舰那批是演习对手被击破时下的。
  ['banner_g', true, '横幅 · 沉没', false],
  ['supply_character', false, '补给', false],
]

/** 尚未落到本地缓存的类型（开了远端回退时它们仍会显示，只是首次要走网络） */
export const missingShipImages = (mstId: number): { label: string; big: boolean }[] =>
  SHIP_IMG_WANTED.filter(([type, damaged]) => !cachedShipImage(mstId, type, damaged)).map(
    ([, , label, big]) => ({ label, big }),
  )

/** 只查本地缓存，不回退远端（诊断用） */
const cachedShipImage = (mstId: number, type: ShipImgType, damaged: boolean): string | null => {
  // 路径推导只有 `shipImagePath` 一份（含损伤后缀与「学到的真实路径优先」）：
  // 两处各写一份的话，「有没有落到本地缓存」会按错的文件名去查，而它不报错
  const pathname = shipImagePath(mstId, type, damaged)
  return pathname ? cachedFile(pathname) : null
}

/** 该图是否属于「大图」（排版用） */
export const isBigShipImg = (type: ShipImgType, damaged: boolean): boolean =>
  SHIP_IMG_WANTED.some(([t, d, , big]) => t === type && d === damaged && big)
