// BGM 档案的纯策略层：什么算一条档案、上限到了淘汰谁、占用怎么算。
//
// 与 `voice-archive-plan` / `art-archive-plan` 是同一族的第三个成员，
// 判据、字段名与淘汰规则**刻意保持一致**——三处行为不一样才是真正的坑
//（玩家在钥里看到的是同一张档案卡上的三行）。
//
// 拆出来的理由与另外两份相同：**能脱开 Electron 真跑一遍**。
// 上限与淘汰是那种「写反了也不报错、只是某天默默把玩家攒下的档案清空」的逻辑，
// 护栏必须能真的调用它，而不是去正则匹配源码文本
//（见 shared/source-pattern-guards-miss-logic-bugs）。

import type { KcsBgmKind } from './kcs-bgm'

/** 一条档案条目。`bytes === 0` 表示「响过但没留下实物」（半亮）。 */
export interface BgmArchiveEntry {
  /** 音轨路径，形如 `/kcs2/resources/bgm/battle/275_1741.mp3`。既是身份也是回放依据 */
  pathname: string
  /** 母港树 / 战斗树。两棵树的编号互不通用（见 shared/kcs-bgm 的 bgmMasterCandidates） */
  kind: KcsBgmKind
  /** 资源号（路径里那三位数） */
  id: number
  /** 实物内容的 sha1 前 16 位。同一号换过内容（官方改配曲/换编码）就是两条 */
  sha1: string
  /**
   * 请求这条音轨时带的 `?version=`。空串 = 那条 URL 本来就没有版本参数。
   * 与语音同理：它既是缓存键的一部分，也是「同一个号换过内容」的身份。
   */
  version: string
  /** 实物大小。0 = 只记下「响过」这件事，没能留住字节 */
  bytes: number
  /** 首次听到 / 最近一次听到（毫秒） */
  firstHeard: number
  lastHeard: number
  /** 响过几次。淘汰时是「舍不得删哪一条」的依据之一 */
  heard: number
}

/**
 * 一条档案记录必须带齐的字段。护栏逐项核对它不许少。
 *
 * `kind` 与 `id` 少不得：**两棵树同号是两首不同的曲子**
 *（battle/118 是「梅雨明けの白露」，port/118 是「鎮守府の秋祭り」），
 * 丢了 kind 的档案没法回放也没法归位。
 */
export const BGM_ARCHIVE_REQUIRED_FIELDS = [
  'pathname',
  'kind',
  'id',
  'version',
  'sha1',
  'bytes',
  'firstHeard',
  'lastHeard',
  'heard',
] as const

/**
 * 档案上限的默认值：**0 = 不限量**，与语音/立绘同一条口径
 *（2026-08-23 用户拍板：留不留交给玩家自己定）。
 * 不设上限就一条都不淘汰，档案只在玩家自己在钥里清空时才变小。
 */
export const BGM_ARCHIVE_MAX_BYTES = 0

/**
 * 建议值。只用于钥里的提示文案，不是默认行为。
 * BGM 一首一两分钟、约 1–3 MB，全部战斗曲加母港曲撑死几百兆，500 MB 绰绰有余。
 */
export const BGM_ARCHIVE_SUGGESTED_MAX_BYTES = 500 * 1024 * 1024

/** 单条实物的上限。BGM 比语音长得多，但再长也不该到这个数——超了多半走岔了路。 */
export const BGM_ARCHIVE_MAX_ENTRY_BYTES = 8 * 1024 * 1024

/**
 * 档案的三态，与语音同名同义：
 *  · `none`  没响过：不写抱怨文案；
 *  · `heard` 响过但没留下实物（缓存那会儿已经被驱逐）——如实呈现，不是失败；
 *  · `kept`  有实物：可零网络回放。
 */
export type BgmArchiveState = 'none' | 'heard' | 'kept'

export const bgmArchiveState = (entries: readonly BgmArchiveEntry[]): BgmArchiveState => {
  if (!entries.length) return 'none'
  return entries.some((entry) => entry.bytes > 0) ? 'kept' : 'heard'
}

/** 音轨路径的形状。它会被拿去拼本地文件名，也会回到界面上当播放源，不能裸信。 */
export const BGM_ARCHIVE_PATH = /^\/kcs2\/resources\/bgm\/(port|battle)\/(\d{3})_\d{4}\.mp3$/

/** 从路径反解 (树, 号)。形状不对返回 null。 */
export const bgmArchiveIdentity = (
  pathname: string,
): { kind: KcsBgmKind; id: number } | null => {
  const matched = BGM_ARCHIVE_PATH.exec(`${pathname ?? ''}`)
  if (!matched) return null
  const id = Number.parseInt(matched[2], 10)
  if (!Number.isInteger(id) || id <= 0) return null
  return { kind: matched[1] as KcsBgmKind, id }
}

/** 把一条（可能来自盘上、可能来自页面）的记录收敛成干净条目。认不出就 null。 */
export const sanitizeBgmArchiveEntry = (raw: unknown): BgmArchiveEntry | null => {
  if (typeof raw !== 'object' || raw === null) return null
  const value = raw as Record<string, unknown>
  const pathname = `${value.pathname ?? ''}`
  const identity = bgmArchiveIdentity(pathname)
  if (!identity) return null
  const sha1 = `${value.sha1 ?? ''}`
  if (sha1 && !/^[0-9a-f]{16}$/.test(sha1)) return null
  // 版本参数收窄到「像版本号」的形状；认不出就当没有，**不整条丢弃**
  const rawVersion = `${value.version ?? ''}`
  const version = /^[\w.-]{1,32}$/.test(rawVersion) ? rawVersion : ''
  const num = (input: unknown, max: number) => {
    const parsed = Number(input)
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= max ? Math.floor(parsed) : 0
  }
  return {
    pathname,
    // 树与号一律**从路径重新解出来**，不采信记录里写的那两个字段：
    // 这个桥对游戏页面上任何脚本都可达，让它自己说自己是哪棵树等于没有校验。
    kind: identity.kind,
    id: identity.id,
    sha1,
    version,
    bytes: num(value.bytes, BGM_ARCHIVE_MAX_ENTRY_BYTES),
    firstHeard: num(value.firstHeard, Number.MAX_SAFE_INTEGER),
    lastHeard: num(value.lastHeard, Number.MAX_SAFE_INTEGER),
    heard: Math.max(1, num(value.heard, 1_000_000_000)),
  }
}

/** 这条路径的**这个版本**是不是已经留下实物了。判据必须连版本一起看。 */
export const bgmArchiveHasBlobFor = (
  entries: readonly BgmArchiveEntry[],
  pathname: string,
  version: string,
): boolean =>
  entries.some(
    (entry) => entry.pathname === pathname && entry.bytes > 0 && entry.version === version,
  )

/** 档案键：一条路径 + 内容指纹。同一个号可以并存多份（官方换过内容）。 */
export const bgmArchiveKey = (pathname: string, sha1: string): string => `${pathname}|${sha1}`

/**
 * 实物文件相对档案根目录的位置。**主进程与渲染层共用这一份**：
 * 渲染层要在不发同步 IPC 的前提下自己算出播放地址（海域卷一屏十几个 ♪，
 * 每个一次同步调用会把界面钉住）。指纹进文件名，同一个号的多个版本才不会互相覆盖。
 */
export const bgmArchiveBlobPath = (pathname: string, sha1: string): string | null => {
  if (!sha1) return null
  const identity = bgmArchiveIdentity(pathname)
  if (!identity) return null
  const base = (pathname.split('/').pop() ?? '').replace(/\.mp3$/i, '')
  if (!base) return null
  return `bgm/${identity.kind}/${base}.${sha1}.mp3`
}

/**
 * 「来源已不可再得」的那些实物——**自动淘汰一律不碰**。判据与语音同构：
 * 同一路径下存在另一条更晚听到、且内容或版本不同的记录 → 这一条已被顶替。
 *
 * BGM 这边这条豁免尤其要紧：**活动曲随活动撤场**。活动一结束，那几个号在
 * 游戏里再也不会响，而它们恰恰最符合「最久没再听到」——旧式 LRU 会优先删掉
 * 最删不得的那一批。
 */
export const bgmArchiveUnobtainable = (entries: readonly BgmArchiveEntry[]): Set<string> => {
  const byPath = new Map<string, BgmArchiveEntry[]>()
  for (const entry of entries) {
    const list = byPath.get(entry.pathname) ?? []
    list.push(entry)
    byPath.set(entry.pathname, list)
  }
  const locked = new Set<string>()
  for (const list of byPath.values()) {
    for (const entry of list) {
      if (!(entry.bytes > 0)) continue
      const superseded = list.some(
        (other) =>
          other !== entry &&
          other.lastHeard > entry.lastHeard &&
          (other.sha1 !== entry.sha1 || other.version !== entry.version),
      )
      if (superseded) locked.add(bgmArchiveKey(entry.pathname, entry.sha1))
    }
  }
  return locked
}

/**
 * 把「上限」这个配置值收敛成两种结果：具体字节数，或 `null`＝**不限量**。
 * 与语音那一份同义；这里另写一份是为了让本模块能脱开另外两族单独跑。
 */
export const bgmArchiveLimitBytes = (raw: unknown): number | null => {
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null
}

/**
 * 淘汰计划：给定当前条目与上限，算出该删哪几条。
 * 规则与语音逐条对齐：不设上限返回空；只淘汰有实物的；跳过不可再得的；
 * 再按「最久没再听到 → 听得少 → 大的」排。候选全是豁免件时返回空。
 */
export const planBgmArchiveEviction = (
  entries: readonly BgmArchiveEntry[],
  maxBytes: number | null = BGM_ARCHIVE_MAX_BYTES,
): BgmArchiveEntry[] => {
  const limit = bgmArchiveLimitBytes(maxBytes)
  if (limit == null) return []
  const total = entries.reduce((sum, entry) => sum + Math.max(0, entry.bytes), 0)
  if (total <= limit) return []
  const locked = bgmArchiveUnobtainable(entries)
  const candidates = entries
    .filter((entry) => entry.bytes > 0 && !locked.has(bgmArchiveKey(entry.pathname, entry.sha1)))
    .sort(
      (left, right) =>
        left.lastHeard - right.lastHeard ||
        left.heard - right.heard ||
        right.bytes - left.bytes ||
        left.pathname.localeCompare(right.pathname),
    )
  const evicted: BgmArchiveEntry[] = []
  let freed = 0
  for (const entry of candidates) {
    if (total - freed <= limit) break
    evicted.push(entry)
    freed += entry.bytes
  }
  return evicted
}

/** 钥里那一行：档案占了多少、留住了几首、只响过没留住几首。 */
export interface BgmArchiveUsage {
  bytes: number
  kept: number
  heard: number
  /** 玩家设的上限；`null` = 不限量（默认） */
  maxBytes: number | null
  /** 其中「来源已不可再得」的条数与占用——自动淘汰碰不到它们 */
  lockedKept: number
  lockedBytes: number
  /** 设了上限、能淘汰的都汰完仍旧超：此时不删不可再得的，由钥如实说一声 */
  full: boolean
}

export const bgmArchiveUsage = (
  entries: readonly BgmArchiveEntry[],
  maxBytes: number | null = BGM_ARCHIVE_MAX_BYTES,
): BgmArchiveUsage => {
  const limit = bgmArchiveLimitBytes(maxBytes)
  const bytes = entries.reduce((sum, entry) => sum + Math.max(0, entry.bytes), 0)
  const locked = bgmArchiveUnobtainable(entries)
  const lockedEntries = entries.filter(
    (entry) => entry.bytes > 0 && locked.has(bgmArchiveKey(entry.pathname, entry.sha1)),
  )
  const freed = planBgmArchiveEviction(entries, limit).reduce((sum, entry) => sum + entry.bytes, 0)
  return {
    bytes,
    kept: entries.filter((entry) => entry.bytes > 0).length,
    heard: entries.filter((entry) => entry.bytes <= 0).length,
    maxBytes: limit,
    lockedKept: lockedEntries.length,
    lockedBytes: lockedEntries.reduce((sum, entry) => sum + entry.bytes, 0),
    full: limit != null && bytes - freed > limit,
  }
}
