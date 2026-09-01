// 立绘档案的纯策略层：什么算一条档案、哪些图种值得收、上限到了淘汰谁、占用怎么算。
//
// 与 voice-archive-plan 是同族设计，刻意保持同构（三态、指纹命名、只淘汰实物
// 不删见证）。**但不是同一份**：图种维度、单条上限、总量上限都不一样，
// 硬合成一份会让「改语音的淘汰规则顺手把立绘也改了」变成可能。
//
// 拆出来同样是为了**能脱开 Electron 真跑一遍**：上限与淘汰是那种「写反了也不报错、
// 只是某天默默把玩家攒了半年的档案清空」的逻辑（见 source-pattern-guards-miss-logic-bugs）。
//
// ⚠️ 唯一一处**故意共用**语音侧的东西是 `archiveLimitBytes`（把配置值收敛成
// 「字节数或不限量」）。它不是策略，是一句取值归一——两侧各写一份的话，
// 「0 算不算不限量」这种事迟早在一侧被改掉，而症状是某个档案开始悄悄淘汰。
// 策略本身（图种、单条上限、总量、豁免的分组键）仍旧各是各的，别顺手合并。

import { archiveLimitBytes } from './voice-archive-plan'

export { archiveLimitBytes }

/** 一条档案条目。`bytes === 0` 表示「见过但没留下实物」（半亮）。 */
export interface ArtArchiveEntry {
  /** 美术路径，形如 `/kcs2/resources/ship/full/0961_6849_xgkywfhkphjf.png` */
  pathname: string
  /** 归属形态。路径里的四位号就是它，所以这一项永远填得出 */
  mstId: number
  /** 图种：full / full_dmg / character_full / album_status / banner… */
  type: string
  /**
   * 请求这张图时带的 `?version=`。空串 = 那条 URL 本来就没有版本参数。
   *
   * 两个作用，与语音档案同：① **它是 Chromium 缓存键的一部分**，丢了它就永远
   * 读不到实物；② **它是季节差分的身份**——官方换季在同一个地址上换图并推高
   * version，所以同一个槽位的当季版与平时版是两个缓存条目、两份不同的实物。
   */
  version: string
  /** 实物内容的 sha1 前 16 位。同一槽位换过内容（季节版/常服）就是两条 */
  sha1: string
  /** 实物大小。0 = 只记下「游戏取过这张图」，没能留住字节 */
  bytes: number
  /** 首次见到 / 最近一次见到（毫秒） */
  firstSeen: number
  lastSeen: number
  /** 见到过几次 */
  seen: number
}

/**
 * 档案总量上限的默认值：**0 = 不限量**（2026-08-23 与语音档案同时拍板）。
 *
 * 理由与语音侧同一条（见 voice-archive-plan 的 VOICE_ARCHIVE_MAX_BYTES）：
 * 「留不留、是不是太占位置」的决断交给每个玩家，默认一条都不淘汰。
 * 想设上限的在钥里填数（`kanso.archive.artMaxMB`），填了才启用淘汰，
 * 而淘汰**永远绕开「不可再得」的条目**（见 artArchiveUnobtainable）。
 */
export const ART_ARCHIVE_MAX_BYTES = 0

/**
 * 建议值：**2 GB**。只用于钥里的提示文案，不再是默认行为。
 *
 * 数字依据（2026-08-22 在本机 Chromium 缓存上实测，不是拍的）：
 * 缓存里 2938 张游戏 PNG，中位 92 KB、p75 144 KB、p90 327 KB、p99 1.58 MB、
 * 最大 6.73 MB；其中 200 KB 以上那批（立绘级）**均值 609 KB**。
 * 可收集的立绘槽位约「1200 形态 × 常服/中破 2 种」= 2400 张，
 * 2400 × 609 KB ≈ **1.4 GB**——2 GB 刚好容得下「每个形态的常服+中破各留一份」，
 * 还留出余量给季节差分。语音档案的建议值是 500 MB（一条几十 KB），
 * 两者差四倍不是随手写的：立绘单张大得多。
 */
export const ART_ARCHIVE_SUGGESTED_MAX_BYTES = 2 * 1024 * 1024 * 1024

/**
 * 单条实物上限：**8 MB**。本机缓存里最大的一张游戏 PNG 是 6.73 MB，
 * 留一点余量给以后更大的图。超过的不收——那多半不是立绘，是别的东西走岔了路。
 */
export const ART_ARCHIVE_MAX_ENTRY_BYTES = 8 * 1024 * 1024

/**
 * 值得收进档案的图种。
 *
 * 只收**立绘级**的：横幅、卡面、补给小图这些是界面零件，不是收集品，
 * 全收会让档案被几百 KB 的小图塞满而真正的立绘反被淘汰。
 * 深海侧另有一条（见 shouldArchiveArtType）：官方极少给深海舰做全身立绘，
 * 多数只有横幅——那就是它们**唯一**的图，不收等于深海侧一格都亮不了。
 */
export const ART_ARCHIVE_TYPES = new Set([
  'full',
  'full_dmg',
  'character_full',
  'character_full_dmg',
  'album_status',
  'remodel',
  'remodel_dmg',
  'sp_remodel',
])

/** 深海舰额外收的图种。 */
export const ART_ARCHIVE_ABYSS_TYPES = new Set(['banner', 'banner_dmg'])

/** 深海舰的 mstId 下界（与项目其余各处同一条线）。 */
const ABYSS_FROM = 1_500

export const shouldArchiveArtType = (mstId: number, type: string): boolean =>
  ART_ARCHIVE_TYPES.has(type) || (mstId >= ABYSS_FROM && ART_ARCHIVE_ABYSS_TYPES.has(type))

/**
 * 档案的三态。**判据只认持久档案层，不认易失的 Chromium 缓存**——
 * 浏览器缓存默认只有一百来兆且超限整盘丢弃（见共享记忆 electron-disk-cache-size），
 * 拿它当点亮判据，等于让玩家的收集进度随时被浏览器抹掉一片。
 *
 *  · `none` 没见过：灰点。不写抱怨文案，也不去 wiki 取图。
 *  · `seen` 见过但没留下实物：半亮。这是**如实呈现**，不是失败——
 *           早年见过、当时还没有档案层的那些，就该长这样。
 *  · `kept` 有实物：全亮，可以看。
 */
export type ArtArchiveState = 'none' | 'seen' | 'kept'

export const artArchiveState = (entries: readonly ArtArchiveEntry[]): ArtArchiveState => {
  if (!entries.length) return 'none'
  return entries.some((entry) => entry.bytes > 0) ? 'kept' : 'seen'
}

/** 档案键：一条路径 + 内容指纹。同一槽位可以并存多份（季节版与常服）。 */
export const artArchiveKey = (pathname: string, sha1: string): string => `${pathname}|${sha1}`

/**
 * 实物文件相对档案根目录的位置。**主进程与渲染层共用这一份**：
 * 渲染层要在不发同步 IPC 的前提下自己算出图片地址（一屏几十格，
 * 每格一次 @electron/remote 同步调用会把界面钉住）。
 *
 * 指纹进文件名，同一槽位的多个版本（季节版与常服）才不会互相覆盖。
 */
export const artArchiveBlobPath = (pathname: string, sha1: string): string | null => {
  if (!sha1) return null
  // /kcs2/resources/ship/{type}/{file}.png
  const matched = /^\/kcs2\/resources\/ship\/([a-z0-9_]+)\/([A-Za-z0-9_.-]+)\.png$/i.exec(
    `${pathname ?? ''}`,
  )
  if (!matched) return null
  return `art/${matched[1].toLowerCase()}/${matched[2]}.${sha1}.png`
}

/** 美术路径的形状。它会被拿去拼本地文件名，也会回到界面上当图片源，不能裸信。 */
export const ART_ARCHIVE_PATH =
  /^\/kcs2\/resources\/ship\/[a-z0-9_]+\/\d{4}[A-Za-z0-9_.-]*\.png$/i

/**
 * 把一条（可能来自盘上、可能来自页面）的记录收敛成干净条目。认不出就 null。
 *
 * 与语音档案同：住在 shared 而不是主进程里，是为了**护栏能真的调用它**。
 */
export const sanitizeArtArchiveEntry = (raw: unknown): ArtArchiveEntry | null => {
  if (typeof raw !== 'object' || raw === null) return null
  const value = raw as Record<string, unknown>
  const pathname = `${value.pathname ?? ''}`
  const sha1 = `${value.sha1 ?? ''}`
  if (!ART_ARCHIVE_PATH.test(pathname)) return null
  if (sha1 && !/^[0-9a-f]{16}$/.test(sha1)) return null
  const matched = /^\/kcs2\/resources\/ship\/([a-z0-9_]+)\/(\d{4})/i.exec(pathname)
  if (!matched) return null
  const type = matched[1].toLowerCase()
  const mstId = Number(matched[2])
  if (!(mstId > 0)) return null
  // 版本参数收窄到「像版本号」的形状；认不出就当没有，**不整条丢弃**——
  // 版本记不下来只是少一层归因线索，实物本身仍然值得留住
  const rawVersion = `${value.version ?? ''}`
  const version = /^[\w.-]{1,32}$/.test(rawVersion) ? rawVersion : ''
  const num = (input: unknown, max: number) => {
    const parsed = Number(input)
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= max ? Math.floor(parsed) : 0
  }
  return {
    pathname,
    mstId,
    type,
    version,
    sha1,
    bytes: num(value.bytes, ART_ARCHIVE_MAX_ENTRY_BYTES),
    firstSeen: num(value.firstSeen, Number.MAX_SAFE_INTEGER),
    lastSeen: num(value.lastSeen, Number.MAX_SAFE_INTEGER),
    seen: Math.max(1, num(value.seen, 1_000_000_000)),
  }
}

/**
 * 这条路径的**这个版本**是不是已经留下实物了。
 *
 * 判据必须连版本一起看：官方换季会在同一个地址上换图并推高 `?version=`。
 * 只看路径的话，攒着去年那一份的槽位会被当成「已经有了」，当季这一份就再也
 * 不去取——而**活动限定的深海舰、过季的季节立绘，错过就是永久错过**。
 */
export const artArchiveHasBlobFor = (
  entries: readonly ArtArchiveEntry[],
  pathname: string,
  version: string,
): boolean =>
  entries.some(
    (entry) => entry.pathname === pathname && entry.bytes > 0 && entry.version === version,
  )

/**
 * 画廊尾接的「档案旧版卡」：档案里**不是官方现在放着的那几份**的实物。
 *
 * 2026-08-23 用户拍板拔掉收藏格 UI 之后，这是立绘档案**唯一**的展示面——
 * 图鉴的立绘画廊先摆官方现行那几张，末尾续排这里返回的这些
 *（原话「都显示在图鉴里面，接着放到这个角色『原版所有皮肤图』的下面接着展示」）。
 *
 * 判据只有一条：**现行显示的那几份不重复摆**。
 *  · `displayedPathnames` 是画廊这一轮真的摆出来的那几条资源路径。kcs2 把版本键
 *    编进文件名，所以「路径相同」就等于「官方现在放的就是它」；
 *  · 顺带把**内容相同**的那些也排掉：同一份字节早年在别的路径下也存过一次时，
 *    只按路径判会让同一张图在一页上出现两次（sha1 相同即同一份字节）。
 * 剩下的按图种归堆、堆内按留存时间从早到晚——同一图种攒过几版就顺着时间看下去。
 *
 * 档案是空的（多数玩家的多数舰）就返回空数组，画廊因此**一格都不多**。
 */
export const legacyArchivedArt = (
  entries: readonly ArtArchiveEntry[],
  displayedPathnames: Iterable<string>,
): ArtArchiveEntry[] => {
  const displayed = new Set<string>()
  for (const pathname of displayedPathnames) if (pathname) displayed.add(pathname)
  const currentSha1 = new Set<string>()
  for (const entry of entries) {
    if (entry.sha1 && entry.bytes > 0 && displayed.has(entry.pathname)) currentSha1.add(entry.sha1)
  }
  const seen = new Set<string>()
  const out: ArtArchiveEntry[] = []
  for (const entry of entries) {
    if (!(entry.bytes > 0) || !entry.sha1) continue
    if (displayed.has(entry.pathname) || currentSha1.has(entry.sha1)) continue
    if (seen.has(entry.sha1)) continue
    seen.add(entry.sha1)
    out.push(entry)
  }
  return out.sort(
    (left, right) =>
      left.type.localeCompare(right.type) ||
      left.firstSeen - right.firstSeen ||
      left.sha1.localeCompare(right.sha1),
  )
}

/**
 * 「来源已不可再得」的那些实物——**自动淘汰一律不碰**。语音侧同族，判据同理由。
 *
 * ---- 分组按「槽位」而不是按路径 ----
 * 与语音档案唯一的不同点在这里：kcs2 的美术 URL 把版本键**编进文件名**
 *（`0961_6849_xgkywfhkphjf.png`），官方换季会连路径一起换。
 * 所以「同一个地址上换了内容」在立绘侧的表现是「同一个 (形态, 图种) 下多了一条**新路径**」，
 * 按路径分组就永远看不到顶替关系。分组键因此取 `mstId/type`。
 *
 * 判据本身与语音侧一致：同槽位下存在另一条**更晚见到、且内容或版本不同**的记录，
 * 就说明这一条已经被顶替 → 不可再得 → 豁免。
 * 只有一条的按「可再得」处理（理由见 voice-archive-plan 同名函数）。
 */
export const artArchiveUnobtainable = (entries: readonly ArtArchiveEntry[]): Set<string> => {
  const bySlot = new Map<string, ArtArchiveEntry[]>()
  for (const entry of entries) {
    const key = `${entry.mstId}/${entry.type}`
    const list = bySlot.get(key) ?? []
    list.push(entry)
    bySlot.set(key, list)
  }
  const locked = new Set<string>()
  for (const list of bySlot.values()) {
    for (const entry of list) {
      if (!(entry.bytes > 0)) continue
      const superseded = list.some(
        (other) =>
          other !== entry &&
          other.lastSeen > entry.lastSeen &&
          (other.sha1 !== entry.sha1 ||
            other.version !== entry.version ||
            other.pathname !== entry.pathname),
      )
      if (superseded) locked.add(artArchiveKey(entry.pathname, entry.sha1))
    }
  }
  return locked
}

/**
 * 淘汰计划：给定当前条目与上限，算出该删哪几条。
 *
 * ⚠️ **不设上限（默认）就返回空**——一条都不淘汰。与语音侧同一条口径。
 *
 * 设了上限时，与语音档案同一套「离散度」排序，**不是纯 LRU**：
 *  ① 只淘汰有实物的（`bytes > 0`）——「见过」那条记录几十字节，删它省不下空间，
 *     却会把玩家的半亮格子打回未点亮，等于抹掉收集进度；
 *  ② **跳过「不可再得」的**（见 artArchiveUnobtainable）——活动限定深海舰的图
 *     在活动撤场后再也取不回来，而旧规则恰恰优先删它；
 *  ③ 剩下的里面，先淘汰**最久没再见到**的；
 *  ④ 同样久的，先淘汰**见得少**的；
 *  ⑤ 再同样，先淘汰**大的**。
 * 被淘汰的条目**不整条删除**，而是降级成「见过但没留下实物」。
 */
export const planArtArchiveEviction = (
  entries: readonly ArtArchiveEntry[],
  maxBytes: number | null = ART_ARCHIVE_MAX_BYTES,
): ArtArchiveEntry[] => {
  const limit = archiveLimitBytes(maxBytes)
  if (limit == null) return []
  const total = entries.reduce((sum, entry) => sum + Math.max(0, entry.bytes), 0)
  if (total <= limit) return []
  const locked = artArchiveUnobtainable(entries)
  const candidates = entries
    .filter((entry) => entry.bytes > 0 && !locked.has(artArchiveKey(entry.pathname, entry.sha1)))
    .sort(
      (left, right) =>
        left.lastSeen - right.lastSeen ||
        left.seen - right.seen ||
        right.bytes - left.bytes ||
        left.pathname.localeCompare(right.pathname),
    )
  const evicted: ArtArchiveEntry[] = []
  let freed = 0
  for (const entry of candidates) {
    if (total - freed <= limit) break
    evicted.push(entry)
    freed += entry.bytes
  }
  return evicted
}

/** 钥里那一行：档案占了多少、留住了几张、只见过没留住几张。 */
export interface ArtArchiveUsage {
  bytes: number
  kept: number
  seen: number
  /** 留下了实物的**形态**数（跨舰收集度的分子） */
  forms: number
  /** 玩家设的上限；`null` = 不限量（默认） */
  maxBytes: number | null
  /** 其中「来源已不可再得」的张数与占用——自动淘汰碰不到它们 */
  lockedKept: number
  lockedBytes: number
  /** 设了上限、超了，而能淘汰的都淘汰完仍旧超——不删不可再得的，交给玩家处置 */
  full: boolean
}

/**
 * @param formOf 把一条档案的 `mstId` 换算成它属于哪个**形态**。默认原样返回。
 *
 * 存在的理由只有一个：图鉴衣装用的是**独立构图编号**（5xxx/6xxx），主数据里
 * 没有这些号，而档案按路径里的四位号记归属。不换算的话，玩家收了村雨改二的
 * 四套衣装，「覆盖 N 个形态」会当场多数出四艘舰娘——数字不报错，只是不对。
 * 换算表学不到的照旧算它自己（如实，不猜；判据见 shared/ship-costume）。
 */
export const artArchiveUsage = (
  entries: readonly ArtArchiveEntry[],
  maxBytes: number | null = ART_ARCHIVE_MAX_BYTES,
  formOf: (mstId: number) => number = (mstId) => mstId,
): ArtArchiveUsage => {
  const limit = archiveLimitBytes(maxBytes)
  const bytes = entries.reduce((sum, entry) => sum + Math.max(0, entry.bytes), 0)
  const locked = artArchiveUnobtainable(entries)
  const lockedEntries = entries.filter(
    (entry) => entry.bytes > 0 && locked.has(artArchiveKey(entry.pathname, entry.sha1)),
  )
  const freed = planArtArchiveEviction(entries, limit).reduce((sum, entry) => sum + entry.bytes, 0)
  return {
    bytes,
    kept: entries.filter((entry) => entry.bytes > 0).length,
    seen: entries.filter((entry) => entry.bytes <= 0).length,
    forms: new Set(
      entries.filter((entry) => entry.bytes > 0).map((entry) => formOf(entry.mstId)),
    ).size,
    maxBytes: limit,
    lockedKept: lockedEntries.length,
    lockedBytes: lockedEntries.reduce((sum, entry) => sum + entry.bytes, 0),
    full: limit != null && bytes - freed > limit,
  }
}

/**
 * 必带的回溯归因字段。护栏逐项核对它不许少——
 * 少任何一项都会让「当季见到、清单还没誊写」的那些立绘失去回溯归因的依据。
 * 归因**不在存的时候做**，而是渲染时拿当时手上的清单现算，
 * 所以清单包更新之后，早就存下的实物会自动归位，不需要迁移。
 */
export const ART_ARCHIVE_REQUIRED_FIELDS = [
  'pathname',
  'mstId',
  'type',
  'version',
  'sha1',
  'bytes',
  'firstSeen',
  'lastSeen',
  'seen',
] as const
