// 「音频先行骨架」的纯策略层：哪些格该摆出播放占位、探测回来的结果怎么记。
//
// ---- 这个域为什么存在（2026-08-23 用户拍板）----
// 他的原话大意：「即便没有台词的新船，也应该把播放放出来——理论上能知道这句话
// 什么时候会说，先把播放占位放上；等我弄到语音识别模型或上游更新了，再更新文字」。
//
// 在这之前，文本层全空的形态台词卷是**整页空白**：没有词就没有行，没有行就没有钮，
// 于是新实装舰在艦素里等于不存在。可「这艘舰在 2 号槽会说话」这件事**与有没有文字无关**——
// 官方语音的槽位空间是固定的（1..53，见 voice-scene-slots 那张实证对照表），
// 缺的只是转写。所以这一层把两件事拆开：**先按场合摆出骨架，文字到了再填**。
//
// ---- 与「键必须有文本背书」那条家法的关系（要害，别混）----
// 那条家法（015f68e 立、ea69980 与 dfd49ce 两轮修正）防的是**错配**：
// 屏幕上显示 A、点下去播 B。它的前提是**这一行主张了一句台词**——
// 有主张才谈得上主张错。
//
// 骨架行**不主张任何文本**（文字位是一个中性短横），所以结构上不可能错配：
// 玩家点它得到的是「这个地址上现在放的那一段」，而界面从头到尾没说那是哪一句。
// 因此家法不适用，占位允许。
// ⚠️ 反过来也要成立：**一旦这一格将来有了文本**（上游更新 / 自译 / 将来的 ASR 草稿），
// 它就变成一条正常行，文本背书那套判据**即刻接管**——骨架让位，不许两套并存。
//
// ---- 探测：一次点击一次请求，永不批量 ----
// 骨架行的钮点下去才去取那一格（单文件、受钥里那个开关管、档案优先照旧）。
// **打开页面不许扫全槽**——那会把一次浏览变成对游戏服务器的 53 连发。
// 探测失败也是数据：404 说明官方根本没有这一格，如实记进台账，格子转成无配音态。
// 骨架因此**靠点击自我修剪**，越用越准。
// 无配音格仍旧点得动（`voiceProbeShortCircuits` 的 `recheck` 旁路）：官方哪天补了这一句，
// 手点一下就能再问一次。

import { localDayOf, localMonthOf } from './local-calendar'
import {
  bareVoiceSceneName,
  specialVoiceScene,
  specialVoiceSlotIdsFor,
} from './voice-scene-slots'
import { OBFUSCATED_VOICE_FROM } from './voice-sound-path'

/** 混淆槽位空间的上界（与 kcs-voice 的 VOICE_KEYS 同一条线）。54 起是裸编号，见下。 */
export const VOICE_SLOT_MAX = 53

/**
 * 探测结论。
 *  · `kept`    取到了：字节进档案，这一格从此有实物背书；
 *  · `absent`  官方没有这一格（404）——**这是事实，不是失败**，记进台账；
 *  · `blocked` 钥里关掉了「未缓存的立绘/语音从游戏资源服务器取」，或还没识别出服务器；
 *  · `error`   这一次没取成（断网、超时、5xx）。**不记台账**——
 *              一次网络抖动不该被固化成「官方没有」。
 */
export type VoiceProbeVerdict = 'kept' | 'absent' | 'blocked' | 'error'

/**
 * HTTP 状态 → 结论。**只有 404/410 才算「官方没有」**。
 *
 * 这条判据单独拿出来是因为它最容易写松：把 5xx、超时、被代理拦截也当成
 * 「官方没有」，就会在一次网络抖动之后永久把一格好好的语音判死，
 * 而界面上它和真的没有长得一模一样。
 */
export const voiceProbeVerdictOf = (status: number): VoiceProbeVerdict => {
  if (status === 200) return 'kept'
  if (status === 404 || status === 410) return 'absent'
  return 'error'
}

/** 一条「官方没有这一格」的台账记录。 */
export interface VoiceAbsentEntry {
  /** 音轨路径，形如 `/kcs/sound/kc123/100234.mp3` */
  pathname: string
  /**
   * **问的是哪一天**（毫秒）。这个字段是这条记录的一半内容：
   * 「官方没有」离开日期就不成其为事实，界面上那一格的悬停写的就是它
   *（`voiceAbsentDayOf`），钥里按月分组清理也按它分。
   */
  at: number
  /** 当时的 HTTP 状态。只可能是 404/410——写进来是为了将来能复核 */
  status: number
}

export const VOICE_ABSENT_REQUIRED_FIELDS = ['pathname', 'at', 'status'] as const

/** 台账条数上限。一艘舰最多 53 格，两万条够几百艘舰探满。 */
export const VOICE_ABSENT_MAX_ENTRIES = 20_000

// ---- 90 天自动过期退役（2026-08-23 用户拍板）----
//
// 这里原先有一个 `VOICE_ABSENT_RECHECK_DAYS = 90`：台账条目满 90 天就当没记过，
// 让骨架自己回来。用户当天把这条口径整个反掉，理由是**它在撒谎**——
// 「2026-08-23 问过，那天官方没有」是一件**带日期的事实**，自动忘掉它并不等于
// 事实过期了，只等于界面把「问过了，没有」伪装回「还没问过」。
//
// 反转的前提是这一格已经有两条自愈的活路，用不着靠遗忘：
//  ① 无配音格**可点重探**（6031186 的 `recheck` 旁路）——官方今天补了配音，
//     玩家手点一下当场就问得到，比等满 90 天快得多；
//  ② 游戏里真播到那一句就**自动入档**（拦截侧一直在收），`planVoiceAbsentUpdate`
//     的 `kept` 分支随即把这条「没有」撤掉。
// 清理权因此归玩家：钥里按月列出、按月清（`groupVoiceAbsentByMonth` /
// `voiceAbsentAfterClear`），要重来一遍是他自己按的，不是系统替他忘的。
//
// ⚠️ `at` 的语义没有跟着退役——它反而更重要了（见字段注释）。重探再 404 仍旧刷新
// 它（`planVoiceAbsentUpdate` 的 record 分支），只是刷新的意义从「重新计 90 天」
// 变成「这条事实的日期换成了今天」。

export const sanitizeVoiceAbsentEntry = (raw: unknown): VoiceAbsentEntry | null => {
  if (typeof raw !== 'object' || raw === null) return null
  const value = raw as Record<string, unknown>
  const pathname = `${value.pathname ?? ''}`
  if (!/^\/kcs\/sound\/(?:kc[A-Za-z0-9_-]+|titlecall)\/[A-Za-z0-9_-]+\.mp3$/.test(pathname)) {
    return null
  }
  const at = Number(value.at)
  const status = Number(value.status)
  if (!Number.isFinite(at) || at <= 0) return null
  if (status !== 404 && status !== 410) return null
  return { pathname, at: Math.floor(at), status }
}

/**
 * 这条「官方没有」还作数吗。**记着就作数**——没有时间条件（2026-08-23 起，
 * 理由见上面那段「90 天自动过期退役」）。推翻它的只有两件事：重探取到了、
 * 或玩家自己在钥里把它清掉。
 */
export const voiceAbsentStillValid = (entry: VoiceAbsentEntry | null | undefined): boolean =>
  !!entry

// ---- 无配音格可点重探（2026-08-23 用户拍板）----
//
// 那时台账还有 90 天的自动复探期，它解决的是「官方后来实装了，那一格自己会回来」，
// 可它太钝：官方今天补了配音，玩家得等到第 90 天才看得见。用户的裁定是
// **玩家要能随时手点再问一次**。（同一天稍后，自动复探期本身也退役了——
// 手点这条路反过来成了它退役的前提之一。）
//
// ---- 为什么不是把短路拆掉 ----
// 那道短路挡的是**重复**：同一页上一格点了 404、再点还是 404，不该又发一次请求。
// 它的对象是「系统自己决定要不要探」。而玩家手点是**明确的意图表达**——
// 他知道这一格记着「没有」，就是要再问一次。两件事量纲不同，所以不是放宽阈值，
// 是给显式点击开一条旁路：`recheck` 为真时短路不成立，其余一个字都没改。
//
// ⚠️ 旁路只对**一次点击一次请求**开放。这里仍旧没有、也不许有批量入口——
// 一个「把整页的无配音格全重探一遍」的钮就是 53 连发，与整个域的前提相反。

/**
 * 这一次探测该不该短路成「已知官方没有」（不发请求，直接回 absent）。
 *
 * @param recheck 玩家显式点了那个无配音格：**点击就是意图**，短路不成立。
 *   骨架探测钮那条路不传它，行为一字不变。
 */
export const voiceProbeShortCircuits = (input: {
  known: VoiceAbsentEntry | null | undefined
  recheck?: boolean
}): boolean => {
  if (input.recheck) return false
  return voiceAbsentStillValid(input.known)
}

/**
 * 探测回来之后台账该怎么动。
 *  · `record` 记一条 / **刷新已有那条的 `at`**（再 404 就把「问的是哪一天」换成今天，
 *             界面上那一格的悬停日期随之更新）；
 *  · `drop`   官方后来实装了：把这条撤掉，格子转回正常；
 *  · `keep`   不动（错误、被拦、或本来就没记过）。
 *
 * ⚠️ 条数上限只挡**新增**，不挡刷新：已经在台账里的那条永远写得动。
 * 挡住它的后果是台账一满，重探的结果就悄悄丢了——而界面上看不出任何区别。
 */
export type VoiceAbsentLedgerAction =
  | { kind: 'keep' }
  | { kind: 'record'; entry: VoiceAbsentEntry }
  | { kind: 'drop' }

export const planVoiceAbsentUpdate = (input: {
  pathname: string
  verdict: VoiceProbeVerdict
  status: number
  at: number
  /** 这条路径在台账里已经有一条了吗 */
  known: boolean
  /** 台账现有条数 */
  size: number
}): VoiceAbsentLedgerAction => {
  // 取到了：这一格从此有实物背书，「官方没有」那条结论当场作废
  if (input.verdict === 'kept') return input.known ? { kind: 'drop' } : { kind: 'keep' }
  // 只有 404/410 才动台账——一次网络抖动不该被固化成「官方没有」
  if (input.verdict !== 'absent') return { kind: 'keep' }
  if (!input.known && input.size >= VOICE_ABSENT_MAX_ENTRIES) return { kind: 'keep' }
  const entry = sanitizeVoiceAbsentEntry({
    pathname: input.pathname,
    at: input.at,
    status: input.status,
  })
  return entry ? { kind: 'record', entry } : { kind: 'keep' }
}

// ---- 台账的读法与清理（2026-08-23，自动过期退役的另一半）----
//
// 自动过期没了，取而代之的是**把日期摆出来 + 把清理权交给玩家**：
//  · 界面上那一格的悬停写「YYYY-MM 问过的那天，官方那会儿没有」（`voiceAbsentDayOf`）；
//  · 钥里按月列出、按月清（`groupVoiceAbsentByMonth` / `voiceAbsentAfterClear`）。
// 判据全在这一层，渲染层只消费——**别在渲染路径上现算**（一屏骨架五十几行，
// 装配期算一次是这个仓库一贯的性能口径）。
//
// 「本地年月」不是随手选的：玩家看到的日期是他自己那天按下鼠标的日期，
// 换算成 JST 或 UTC 会让「我昨天点的」对不上界面上写的那一天。
// 换算本身在 shared/local-calendar（账本那边按月清理用的是同一份，
// 两处各写各的必然分叉——同一天点两个清理钮会落在两个不同的月上）。

/**
 * 这条记录**是哪一天问的**（本地日历，`YYYY-MM-DD`）。
 * 时间戳不成形（0、NaN、负数）时给空串——不编一个日期出来。
 */
export const voiceAbsentDayOf = (at: number): string => localDayOf(at)

/** 这条记录归哪一个月（本地日历，`YYYY-MM`）。同上，读不出给空串。 */
export const voiceAbsentMonthOf = (at: number): string => localMonthOf(at)

export interface VoiceAbsentMonthGroup {
  /** 本地年月，`YYYY-MM` */
  month: string
  count: number
}

/**
 * 按月点数。**新月在前**（钥里那一列从最近一次探测读起）。
 *
 * 日期读不出来的条目不进任何一组：它们在界面上无从归属，硬塞进某个月就是编。
 * 它们仍旧留在台账里，只有「全部清理」带得走——这一点在下面那个函数里成立。
 */
export const groupVoiceAbsentByMonth = (
  entries: readonly VoiceAbsentEntry[] | null | undefined,
): VoiceAbsentMonthGroup[] => {
  const counts = new Map<string, number>()
  for (const entry of entries ?? []) {
    const month = voiceAbsentMonthOf(Number(entry?.at))
    if (!month) continue
    counts.set(month, (counts.get(month) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([month, count]) => ({ month, count }))
    .sort((left, right) => (left.month < right.month ? 1 : left.month > right.month ? -1 : 0))
}

/**
 * 清理之后**剩下**的条目。
 *
 * @param month `YYYY-MM` = 只清那一月；`null` = 全部清掉。
 *   传进来的月份对不上任何一条时一条都不删（宁可什么都没发生，
 *   也不要「点了清理，结果清掉了别的月」）。
 */
export const voiceAbsentAfterClear = (
  entries: readonly VoiceAbsentEntry[] | null | undefined,
  month: string | null,
): VoiceAbsentEntry[] => {
  if (month == null) return []
  return [...(entries ?? [])].filter((entry) => voiceAbsentMonthOf(Number(entry?.at)) !== month)
}

/**
 * 这个形态该摆哪些骨架行：**没被文本行占住的槽位，全摆**——
 * 混淆段 1..53，**再接上已知的裸编号槽位**（900 特殊攻击、990~993 夜战僚舰分支、
 * 141/241 西村舰队…，表在 shared/voice-scene-slots 的 SPECIAL_VOICE_SLOTS）。
 *
 * @param covered   已经有文本行占住的槽位——**骨架只填空，绝不与正常行并存**
 *                  （文本一到，那一格就该由文本背书那套判据接管）。
 * 已知官方没有的槽位（absent 台账）不在这里过滤：那些格照样摆行，由渲染层
 * 摆成无配音态——「官方没有」是要**展示**的事实，不是要藏起来的行。
 *
 * ---- 裸编号那一段为什么也摆（2026-08-23 补）----
 * 同一条裁定的第二处落点。玩家发动特殊攻击时游戏播的就是 `900.mp3`——
 * 本机台账里 Richelieu改 的这一条被记成「认不出」16 次，也就是说**她确实说了**，
 * 而图鉴上连一行都没有。多数舰点 900 会 404，那正是设计：一次点击一次请求，
 * 404 转成显式无配音态、下次不再摆钮，骨架靠点击自我修剪。
 * ⚠️ 判据用**表**不用值域：54..899 里绝大多数编号根本不存在，按值域摆行等于
 * 在界面上铺几百行、并鼓励玩家去逐个骚扰游戏服务器。
 *
 * ---- 限定形态的那几格（2026-08-23 补）----
 * 表里带 `onlyMst` 的项（917/918 = Graf Zeppelin 系专用夜战）**只在名单里的形态摆**。
 * 全局摆就是在别的 800+ 形态页上各铺两行死格——点下去必 404，还把台账撑大一圈。
 * @param mstId 当前形态。不传 = 只摆全局那些（限定槽位宁可少摆，不铺死格）。
 */
export const voiceSkeletonSlots = (input: {
  covered: ReadonlySet<number>
  mstId?: number | null
}): number[] => {
  const out: number[] = []
  for (let slot = 1; slot <= VOICE_SLOT_MAX; slot++) {
    if (input.covered.has(slot)) continue
    out.push(slot)
  }
  for (const slot of specialVoiceSlotIdsFor(input.mstId ?? null)) {
    if (!input.covered.has(slot)) out.push(slot)
  }
  return out
}

// ---- 亲历显形：档案里的表外裸编号自动长行（2026-08-23 用户拍板）----
//
// ---- 它补的是哪个洞 ----
// 上面那张表是**主动摆行**的判据，只认写死的名单——这是对的，可它有个必然的时差：
// 官方新发明一个裸编号（下一期活动的友军舰队、某舰的新特殊攻击），从「玩家在游戏里
// 听到」到「艦素的表收进来」之间，那一句在图鉴里不存在。而**这段时间里实物早就
// 躺在档案里了**（拦截侧 08-22 起按值域认裸编号来路并入档）。
//
// 于是这一层把判据倒过来：**存在性由实物本身背书**。档案里这个形态目录下有一条
// `<裸编号>.mp3`，就说明她真的在那一格说过话——不必问表收没收，也不发一次请求。
// 「表外新编号的收编时差」由此闭环：玩家听过一次即自动显形。
//
// ---- 归属规则 = 目录即身份 ----
// 友军/未来新编号的语音就住在**说话那艘舰自己的音声目录**下
//（`/kcs/sound/kc<api_filename>/<裸编号>.mp3`）。目录名 → 形态由 shipgraph 反查；
// **一个目录名映射多个形态时，每个匹配形态的页面都长这行**——共用目录就是语音真共用，
// 如实显示，不去猜「其实只属于其中一个」。
//
// ---- 三条纪律（与深海档案段同族）----
// ① **不主张文本**：中性短横。表外编号没有可考的台词，硬安一句就是编。
// ② **只播档案实物**（file://，零网络，不回退 CDN）：这一段摆出来的前提就是「档案里有」。
// ③ **不做探测钮**：表外空间无法枚举——探测钮的前提是「知道该探哪一格」，这里没有。
//    能证实的显示，不能证实的不硬造。

export interface BareArchiveVoiceRow {
  slot: number
  scene: string
  /** 音轨路径。档案实物按它取（renderer/voice-archive 的 `archivedVoiceUrlOf`） */
  pathname: string
}

/**
 * 这个形态该长哪几条「档案里的表外裸编号」行。
 *
 * @param filename   该形态的音轨目录名（`api_mst_shipgraph[].api_filename`）。
 *                   主数据没到位就是 null——那时一行都不长（目录即身份，没有目录就没有身份）。
 * @param slotsOfDir 目录名 → 档案里留下过实物的裸编号。索引在**装配期**算一次，
 *                   不在渲染路径上扫全表（深海批已有先例，扩展的就是那一份）。
 * @param covered    这一页**已经摆过行**的槽位：文本行 + 骨架行。同一格不摆两行——
 *                   表内槽位由骨架/正常行管，这里只捡它们没管到的。
 */
export const bareArchiveVoiceRows = (input: {
  filename: string | null | undefined
  slotsOfDir: (dir: string) => readonly number[]
  covered: ReadonlySet<number>
}): BareArchiveVoiceRow[] => {
  const dir = `${input.filename ?? ''}`
  if (!dir) return []
  const out: BareArchiveVoiceRow[] = []
  const seen = new Set<number>()
  for (const slot of input.slotsOfDir(dir) ?? []) {
    // 混淆段（1..53）与混淆值域（≥100000）都不归这里管：前者是正常槽位、由骨架摆，
    // 后者根本不是裸编号（`encodeVoiceFile` 的值域是 [100000, 199172]）。
    if (!Number.isInteger(slot) || slot <= VOICE_SLOT_MAX) continue
    if (slot >= OBFUSCATED_VOICE_FROM) continue
    if (input.covered.has(slot) || seen.has(slot)) continue
    seen.add(slot)
    out.push({
      slot,
      // 表里有名字就用表里的（141/241 那一对），表外按 KC3 语义推，推不出给「音轨 #N」
      scene: specialVoiceScene(slot) || bareVoiceSceneName(slot),
      pathname: `/kcs/sound/kc${dir}/${slot}.mp3`,
    })
  }
  // 与既有行同一条排序键（槽位号）：141 与 143 本来就该挨着，
  // 把表外的一律甩到 993 后面反而读不成一段。
  out.sort((left, right) => left.slot - right.slot)
  return out
}

// ---- 时报的跨形态指路（2026-08-23，判例：大泊）----
//
// ---- 它补的是什么 ----
// 大泊（995）基础形态在游戏里真没有时报：wikiwiki 的時報表逐形态列 ×/◯，
// 她那一列整列是 ×，大泊改（1000）那一列整列是 ◯。随包资料是同一个样子——
// 995 的 wikiwiki 桶 29 行、时报 0 条；1000 的 56 行里 24 条是时报。
// 于是基础页的时报段摆着 24 个探测钮，玩家一个个点下去全是 404，
// 而**那 24 条台词艦素其实有**，只是记在链上另一形态名下。这一行就是去那边的路标。
//
// ---- 为什么只指路、不下结论（要害，别写歪）----
// 「随包资料里别的形态才有」**推不出**「本形态没有」。这个仓有现成的反例：
// 国後的字幕资料缺 30–53，可她在游戏里真的会报时——那正是骨架行与探测钮存在的
// 理由（「不展示代表没有，既然不是没有为何不展示」那条裁定见 renderer/modules/ji.ts）。所以：
//  · **一个探测钮都不拆**，无配音态照旧——这一行只加信息，不减功能；
//  · 措辞只说「收录在 X」。不许写「本形态没有时报」「时报随改造追加」这类断言：
//    前者是从资料缺口反推事实，后者是替官方宣布一条设计规则，两句都没有出处。
//
// ---- 三条不出现 ----
// ① 本形态自己有**任何**一条时报文本行 —— 页面上已经读得到，指路是多余的；
// ② 深海侧 —— 深海没有 1..53 那个槽位空间，时报无从谈起；
// ③ 链上找不到成规模时报的形态 —— 没有路可指就不摆路标。

/** 时报段的槽位区间（HH00 → 30+小时，见 voice-scene-slots 的 `hourlyVoiceSlot`）。 */
export const HOURLY_VOICE_SLOT_FIRST = 30
export const HOURLY_VOICE_SLOT_LAST = 53

/**
 * 「成规模」的门槛。
 *
 * 24 格里零星三五条是资料残片，指过去玩家点开只看到几行，路标就成了误导。
 * 20 是「整套时报基本齐了」的保守线：随包资料里收了时报的形态几乎都是满 24 条
 * （大泊改 24、夕張改二特 24…），落在 1..19 的属于半截资料，不指。
 */
export const HOURLY_POINTER_MIN_ROWS = 20

export const isHourlyVoiceSlot = (slot: unknown): boolean =>
  Number.isInteger(slot) &&
  (slot as number) >= HOURLY_VOICE_SLOT_FIRST &&
  (slot as number) <= HOURLY_VOICE_SLOT_LAST

/** 一组槽位里落在时报段的有几个（按槽位去重由调用方的 Set 保证）。 */
export const countHourlyVoiceSlots = (slots: Iterable<number>): number => {
  let count = 0
  for (const slot of slots) if (isHourlyVoiceSlot(slot)) count += 1
  return count
}

export interface HourlyVoicePointerInput {
  /** 当前形态。链上等于它的那一级不算「另一形态」 */
  mstId: number
  /** 本形态时报段里**有文本行**的格数。>0 就不指路（页面上已经读得到） */
  ownHourlyTextRows: number
  /**
   * 同一改造链的各形态（含本形态），**按链序**——离原型近的在前，
   * shared/ship-remodel-chain 的 `chainOf` 给出的就是这个序。
   * `hourlyRows` = 随包资料里**该形态自己**的时报文本格数。
   */
  chain: readonly { mstId: number; hourlyRows: number }[]
  /** 深海侧不出这一行 */
  abyss?: boolean
}

/**
 * 该把时报指到哪个形态去；不该指路时返回 null。
 *
 * 多个形态都够格时取**链序里第一个**：链序是「离原型多远」，第一个达标的就是
 * 玩家最可能先练到、也最可能已经拿在手里的那一级。全部列出来会变成一串舰名清单，
 * 而玩家要的只是「去哪读」。
 */
export const hourlyVoicePointerTarget = (input: HourlyVoicePointerInput): number | null => {
  if (input.abyss) return null
  if (input.ownHourlyTextRows > 0) return null
  return (
    input.chain.find(
      (form) => form.mstId !== input.mstId && form.hourlyRows >= HOURLY_POINTER_MIN_ROWS,
    )?.mstId ?? null
  )
}
