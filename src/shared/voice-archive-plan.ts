// 语音档案的纯策略层：什么算一条档案、上限到了淘汰谁、占用怎么算。
//
// 拆出来是为了**能脱开 Electron 真跑一遍**。上限与淘汰是那种「写反了也不报错、
// 只是某天默默把玩家攒了半年的档案清空」的逻辑，护栏必须能真的调用它，
// 而不是去正则匹配源码文本（见 shared/source-pattern-guards-miss-logic-bugs）。

/** 一条档案条目。`bytes === 0` 表示「听过但没留下实物」（半亮）。 */
export interface VoiceArchiveEntry {
  /** 音轨路径，形如 `/kcs/sound/kc123/100234.mp3`。既是身份也是回放依据 */
  pathname: string
  /** 归属的舰娘 mstId；深海/NPC 音轨认不出归属时为 0 */
  mstId: number
  /** 官方语音编号：混淆段 1..53，或 54 起的裸编号（900 特殊攻击…）；深海/NPC 音轨没有编号时为 0 */
  voiceId: number
  /** 实物内容的 sha1 前 16 位。同一槽位换过内容（季节版/常规版）就是两条 */
  sha1: string
  /**
   * 游戏请求这条音轨时带的 `?version=`。空串 = 那条 URL 本来就没有版本参数
   *（kc9999 的 NPC 音轨实测就没有），不是「没记下来」。
   *
   * 为什么它必须进档案（2026-08-22 补）：
   * ① **它是缓存键的一部分**——丢了它就永远读不到实物（那次 0 条实物的根因）；
   * ② **它是季节差分的身份**——官方换季换一次 version，同一槽位的当季版与
   *    平时版因此是两个不同的缓存条目、两份不同的实物。清单层（季节台词包）
   *    什么时候誊写上游那一季，与玩家什么时候听到它**没有关系**：
   *    先按版本把实物收下来，等清单更新了自然对得上号（「先收后认」）。
   */
  version: string
  /** 实物大小。0 = 只记下「听过」这件事，没能留住字节 */
  bytes: number
  /** 首次听到 / 最近一次听到（毫秒） */
  firstHeard: number
  lastHeard: number
  /** 听到过几次。淘汰时是「舍不得删哪一条」的依据之一 */
  heard: number
}

/**
 * 一条档案记录必须带齐的字段。**护栏逐项核对它不许少**——
 * 少任何一项都会让「当季听到、清单还没誊写」的那些语音失去回溯归因的依据：
 *  · pathname 里含 `kc{api_filename}` 与混淆编号，(舰, 槽位) 由它唯一决定
 *    （反解要 api_mst_shipgraph，任何装过一次艦素并登录过的机器都有）；
 *  · version 是季节差分的身份；sha1 是内容指纹；firstHeard 是「你哪天听到的」。
 * 归因**不在存的时候做**，而是在渲染时拿当时手上的清单现算——
 * 所以清单包更新之后，早就存下的实物会自动归位，不需要迁移。
 */
export const VOICE_ARCHIVE_REQUIRED_FIELDS = [
  'pathname',
  'version',
  'sha1',
  'bytes',
  'firstHeard',
  'lastHeard',
  'heard',
] as const

/**
 * 档案上限的默认值：**0 = 不限量**（2026-08-23 拍板）。
 *
 * 原来默认 500 MB，写满就自动淘汰。用户看过之后把这个决断收回去了——
 * 原话大意：「留不留、是不是太占位置，交给每个玩家自己定；我有俩 2T 的盘，
 * 这点存储不算什么」。于是默认不设上限：**不设上限就一条都不淘汰**，
 * 档案只在玩家自己在钥里清空时才变小。
 *
 * 想设上限的仍然可以在钥里填一个数（`kanso.archive.voiceMaxMB`），
 * 填了才启用淘汰——而淘汰**永远绕开「不可再得」的条目**（见 voiceArchiveUnobtainable）。
 * 500 MB 这个数留在下面当**建议值**，给钥里的提示用，不再是默认行为。
 */
export const VOICE_ARCHIVE_MAX_BYTES = 0

/** 建议值（语音一条几十 KB，500 MB 够攒很多年）。只用于钥里的提示文案。 */
export const VOICE_ARCHIVE_SUGGESTED_MAX_BYTES = 500 * 1024 * 1024

/**
 * 把「上限」这个配置值收敛成两种结果：具体字节数，或 `null`＝**不限量**。
 *
 * 0、负数、NaN、空、非数字一律当不限量——默认就是不限量，
 * 而「读不出配置」与「玩家没设」应该落到同一个行为上，不该因为写法差异变成会淘汰。
 */
export const archiveLimitBytes = (raw: unknown): number | null => {
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null
}

/** 单条实物的上限。超过的不收：那多半不是语音，是别的东西走岔了路。 */
export const VOICE_ARCHIVE_MAX_ENTRY_BYTES = 4 * 1024 * 1024

/**
 * 档案的三态。**判据只认持久档案层，不认易失的 Chromium 缓存**——
 * 浏览器缓存默认只有一百来兆且超限整盘丢弃（见共享记忆 electron-disk-cache-size），
 * 拿它当点亮判据，等于让玩家的收集进度随时被浏览器抹掉一片。
 *
 *  · `none`  没听过：灰格。不写抱怨文案，也不去 wiki 取音频。
 *  · `heard` 听过但没留下实物：半亮。这是**如实呈现**，不是失败——
 *            早年听过、当时还没有档案层的那些，就该长这样。
 *  · `kept`  有实物：全亮，可播放。
 */
export type VoiceArchiveState = 'none' | 'heard' | 'kept'

export const voiceArchiveState = (entries: readonly VoiceArchiveEntry[]): VoiceArchiveState => {
  if (!entries.length) return 'none'
  return entries.some((entry) => entry.bytes > 0) ? 'kept' : 'heard'
}

/** 音轨路径的形状。它会被拿去拼本地文件名，也会回到界面上当播放源，不能裸信。 */
export const VOICE_ARCHIVE_PATH =
  /^\/kcs\/sound\/(?:kc[A-Za-z0-9_-]+|titlecall)\/[A-Za-z0-9_-]+\.mp3$/

/**
 * 把一条（可能来自盘上、可能来自页面）的记录收敛成干净条目。认不出就 null。
 *
 * 住在 shared 而不是主进程里，是为了**护栏能真的调用它**——
 * 「必带字段少了一个」这种事写反了不报错，只是某天让玩家的收集进度失去归因依据
 *（见 shared/source-pattern-guards-miss-logic-bugs）。
 */
export const sanitizeVoiceArchiveEntry = (raw: unknown): VoiceArchiveEntry | null => {
  if (typeof raw !== 'object' || raw === null) return null
  const value = raw as Record<string, unknown>
  const pathname = `${value.pathname ?? ''}`
  const sha1 = `${value.sha1 ?? ''}`
  if (!VOICE_ARCHIVE_PATH.test(pathname)) return null
  if (sha1 && !/^[0-9a-f]{16}$/.test(sha1)) return null
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
    mstId: num(value.mstId, 99_999),
    // 上界不是 53：54 起是裸编号（900 特殊攻击、990~993 夜战僚舰分支…），
    // 卡在 53 会把它们**静默归零**——那正是「写反了不报错、只是某天悄悄少一格」的病
    voiceId: num(value.voiceId, 9_999),
    sha1,
    version,
    bytes: num(value.bytes, VOICE_ARCHIVE_MAX_ENTRY_BYTES),
    firstHeard: num(value.firstHeard, Number.MAX_SAFE_INTEGER),
    lastHeard: num(value.lastHeard, Number.MAX_SAFE_INTEGER),
    heard: Math.max(1, num(value.heard, 1_000_000_000)),
  }
}

/**
 * 这条路径的**这个版本**是不是已经留下实物了。
 *
 * 判据必须连版本一起看：官方换季会在同一个地址上换文件并推高 `?version=`。
 * 只看路径的话，攒着去年那一份的槽位会被当成「已经有了」，当季这一份就再也
 * 不去取——而它过季之后永远取不回来。这正是「先收后认」的那个「先收」：
 * 清单层什么时候誊写上游那一季，与该不该现在把它收下来**没有关系**。
 */
export const voiceArchiveHasBlobFor = (
  entries: readonly VoiceArchiveEntry[],
  pathname: string,
  version: string,
): boolean =>
  entries.some(
    (entry) => entry.pathname === pathname && entry.bytes > 0 && entry.version === version,
  )

/** 档案键：一条路径 + 内容指纹。同一槽位可以并存多份（季节版与常规版）。 */
export const voiceArchiveKey = (pathname: string, sha1: string): string => `${pathname}|${sha1}`

/**
 * 实物文件相对档案根目录的位置。**主进程与渲染层共用这一份**：
 * 渲染层要在不发同步 IPC 的前提下自己算出播放地址（一屏台词几十行，
 * 每行一次 @electron/remote 同步调用会把界面钉住，见 assets/preload/resource-hack.js
 * 里那条同样的教训），所以这段推导不能只住在主进程里。
 *
 * 指纹进文件名，同一槽位的多个版本（季节版与常规版）才不会互相覆盖。
 */
export const voiceArchiveBlobPath = (pathname: string, sha1: string): string | null => {
  if (!sha1) return null
  const parts = `${pathname ?? ''}`.split('/')
  const dir = parts[3]
  const base = (parts[4] ?? '').replace(/\.mp3$/i, '')
  if (!dir || !base) return null
  return `sound/${dir}/${base}.${sha1}.mp3`
}

/**
 * 「来源已不可再得」的那些实物——**自动淘汰一律不碰**。
 *
 * ---- 这条豁免是补一处设计缝（2026-08-23）----
 * 档案的定位是「过季也能回顾，除非玩家自己清」。而原来的淘汰规则
 *（最久没听 → 听得少 → 大的）对**常规件**是成立的：删了还能再听到、再存一次。
 * 对**过季件**则直接违背那个定位：静默淘汰一条盛夏语音 = 永久失去，
 * 而它恰恰最符合「最久没再听到」——过季之后本来就再也不会响。
 * 换句话说，旧规则**优先删掉的正是最删不得的那一批**。
 *
 * ---- 判据只用档案自己的数据，不依赖任何清单 ----
 * 一条实物「不可再得」，等价于「这个地址上现在放的已经不是它了」。
 * 而这件事档案自己就记着：官方换季会在同一个地址上换文件并推高 `?version=`，
 * 于是同一条路径下会留下**内容不同的两条**。所以：
 *
 *   同一路径下，**存在另一条更晚听到、且内容或版本不同的记录** → 这一条已被顶替 → 不可再得。
 *
 * 「听过但没留下实物」的占位条同样算数：它更晚、版本又不同，就说明那个地址
 * 已经换了内容（只是那一次没能留住字节）。
 *
 * ---- 判不出来源状态的按「可再得」处理 ----
 * 一条路径下只有一份实物时，它多半就是现行那一份，删了还能再听到。
 * 这里**不做保守豁免**：全都豁免等于淘汰永不生效，那不是「保守」，是把开关拆了。
 * 真正的保守在别处——默认根本不设上限（见 VOICE_ARCHIVE_MAX_BYTES），
 * 设了上限而又全是豁免件时也**不淘汰**，改为在钥里如实说满了（见 voiceArchiveUsage.full）。
 */
export const voiceArchiveUnobtainable = (
  entries: readonly VoiceArchiveEntry[],
): Set<string> => {
  const byPath = new Map<string, VoiceArchiveEntry[]>()
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
      if (superseded) locked.add(voiceArchiveKey(entry.pathname, entry.sha1))
    }
  }
  return locked
}

/**
 * 淘汰计划：给定当前条目与上限，算出该删哪几条。
 *
 * ⚠️ **不设上限（默认）就返回空**——一条都不淘汰。这不是优化，是判据本身：
 * 2026-08-23 起「留不留」的决断归玩家，档案只在他自己清空时变小。
 *
 * 设了上限时，淘汰规则按「离散度」排，**不是纯 LRU**：
 *  ① 只淘汰有实物的（`bytes > 0`）——「听过」那条记录几十字节，删它省不下空间，
 *     却会把玩家的半亮格子打回未点亮，等于抹掉收集进度；
 *  ② **跳过「不可再得」的**（见 voiceArchiveUnobtainable）——删了就永久失去，
 *     而旧规则恰恰优先删它们；
 *  ③ 剩下的里面，先淘汰**最久没再听到**的；
 *  ④ 同样久的，先淘汰**听到次数少**的（听得多的多半是常用秘书舰，玩家更在意）；
 *  ⑤ 再同样，先淘汰**大的**。
 * 被淘汰的条目**不整条删除**，而是降级成「听过但没留下实物」——
 * 收集进度是玩家的资产，空间不够只是留不住实物，不该连见证一起没收。
 *
 * 候选全是豁免件时**返回空**（宁可超一点，也不删不可再得的）；
 * 那种情况由钥里的「档案已满」提示交给玩家处置。
 */
export const planVoiceArchiveEviction = (
  entries: readonly VoiceArchiveEntry[],
  maxBytes: number | null = VOICE_ARCHIVE_MAX_BYTES,
): VoiceArchiveEntry[] => {
  const limit = archiveLimitBytes(maxBytes)
  if (limit == null) return []
  const total = entries.reduce((sum, entry) => sum + Math.max(0, entry.bytes), 0)
  if (total <= limit) return []
  const locked = voiceArchiveUnobtainable(entries)
  const candidates = entries
    .filter((entry) => entry.bytes > 0 && !locked.has(voiceArchiveKey(entry.pathname, entry.sha1)))
    .sort(
      (left, right) =>
        left.lastHeard - right.lastHeard ||
        left.heard - right.heard ||
        right.bytes - left.bytes ||
        left.pathname.localeCompare(right.pathname),
    )
  const evicted: VoiceArchiveEntry[] = []
  let freed = 0
  for (const entry of candidates) {
    if (total - freed <= limit) break
    evicted.push(entry)
    freed += entry.bytes
  }
  return evicted
}

/** 钥里那一行：档案占了多少、留住了几条、只听过没留住几条。 */
export interface VoiceArchiveUsage {
  bytes: number
  kept: number
  heard: number
  /** 玩家设的上限；`null` = 不限量（默认） */
  maxBytes: number | null
  /** 其中「来源已不可再得」的条数与占用——自动淘汰碰不到它们 */
  lockedKept: number
  lockedBytes: number
  /**
   * 设了上限、已经超了，而能淘汰的都淘汰完仍旧超——此时**不删不可再得的**，
   * 由钥如实说一声，让玩家自己决定扩容还是手动清理。
   */
  full: boolean
}

export const voiceArchiveUsage = (
  entries: readonly VoiceArchiveEntry[],
  maxBytes: number | null = VOICE_ARCHIVE_MAX_BYTES,
): VoiceArchiveUsage => {
  const limit = archiveLimitBytes(maxBytes)
  const bytes = entries.reduce((sum, entry) => sum + Math.max(0, entry.bytes), 0)
  const locked = voiceArchiveUnobtainable(entries)
  const lockedEntries = entries.filter(
    (entry) => entry.bytes > 0 && locked.has(voiceArchiveKey(entry.pathname, entry.sha1)),
  )
  const freed = planVoiceArchiveEviction(entries, limit).reduce((sum, entry) => sum + entry.bytes, 0)
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
