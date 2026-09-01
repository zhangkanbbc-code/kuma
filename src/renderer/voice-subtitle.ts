// 游戏语音字幕：只消费游戏 webview 实际发起的 /kcs/sound/ 请求。
// 舰娘、NPC 与深海台词均来自本地矿脉；中文缺失时才回退日文。
// 非战斗语音显示在游戏画面底部，战斗语音改为顶层弹幕：
// 我方（含友军舰队）自左向右，敌方自右向左。
import {
  masterShipName,
  mg,
  onMgChange,
  queryLode,
  queryMasterRaw,
} from './kernel'
import { canonicalAbyssalSpeakerLabel } from './abyssal-name'
import { resolveVoiceRequest, setShipGraph, type VoiceRequestCue } from './kcs-voice'
import { entityNamePlain, localizedEntityId } from './localization'
import {
  buildVoiceFallbackIds,
  buildVoiceTranslationIndex,
  normalizeVoiceLine,
} from '../shared/voice-lineage'
import { voicePlaybackObservationAt } from '../shared/voice-playback-observations'
import {
  buildShipFormCodeMap,
  foldVoiceLineForCompare,
  isSubtitlePlaceholder,
  kcwikiSlotIndex,
  planVoiceCorrections,
  regularSubtitleSlots,
  seasonOccupiedFrom,
  seasonalTextIndex,
  type KcwikiSlotLine,
} from '../shared/voice-scene-slots'
import {
  captionHideAtMs,
  captionMinHoldMs,
  danmakuDurationSeconds,
} from '../shared/voice-caption-hold'
import { shouldRenderCaption } from '../shared/voice-request-gate'
import {
  normalizeVoiceCaptionSize,
  VOICE_CAPTION_SIZE_DEFAULT,
  VOICE_CAPTION_SIZE_PATH,
} from '../shared/voice-caption-size'
import { normalizeVoiceText } from '../shared/voice-text'

const remote = require('@electron/remote')
const { ipcRenderer } = require('electron')
const config = remote.require('./config')

interface VoiceEvent {
  pathname?: string
  ts?: number
}

interface VoiceBroadcaster {
  addListener: (event: string, listener: (cue: VoiceEvent) => void) => unknown
}

type SubtitleTable = Record<string, Record<string, string>>

interface ExtraSubtitleLine {
  name: string
  jp: string
  zh: string
  en?: string
  time?: number
}

type ExtraSubtitleTable = Record<string, ExtraSubtitleLine | ExtraSubtitleLine[]>

interface WikiwikiVoiceLine {
  key: string
  voiceId?: number
  scene: string
  ja: string
  page: string
}

type WikiwikiVoiceTable = Record<string, WikiwikiVoiceLine[]>

interface WikiwikiAbyssVoiceLine {
  key: string
  scene: string
  ja: string
  page: string
  slot?: 'opening' | 'attack' | 'damage' | 'sunk'
  suffix?: number
}

type WikiwikiAbyssVoiceTable = Record<string, WikiwikiAbyssVoiceLine[]>

interface CaptionLine {
  speaker: string
  text: string
  delay: number
  /**
   * 台词的着色语义。受损四档：light=小破、mid=中破、heavy=大破、sunk=击沉；
   * wedding=ケッコンカッコカリ（婚礼台词）。三者都不成立时不带。
   */
  tone?: 'light' | 'mid' | 'heavy' | 'sunk' | 'wedding'
  /**
   * 这一句对应的音轨地址。底部字幕拿它去游戏页查真实时长（决定挂到什么时候）。
   * 取词那几条路各自造 CaptionLine 时并不知道地址，所以由 `consume` 统一补上；
   * 调试入口（debugShowVoiceCue）没有地址，那条自然落回字数估算。
   */
  pathname?: string
}

type CaptionMode = 'bottom' | 'friendly' | 'enemy'

let subtitleZh: SubtitleTable = {}
let subtitleJa: SubtitleTable = {}
let subtitleNpc: ExtraSubtitleTable = {}
let subtitleEnemies: ExtraSubtitleTable = {}
let wikiwikiVoice: WikiwikiVoiceTable = {}
let wikiwikiAbyssVoice: WikiwikiAbyssVoiceTable = {}
/** 短剧/群像语音（kc9997）的译文表，档名（裸编号）→ 一段中文。 */
let seasonalSkits: Record<string, { season?: string; scene?: string; zh?: string }> = {}
let voiceZhByJa = new Map<string, string>()
/**
 * 被季节语音占着的槽位（形态 mstId → 槽位集合）。判据与图鉴侧同一份，
 * 见 `shared/voice-scene-slots` 的 `seasonOccupiedSlots`。
 */
let seasonOccupied = new Map<number, Set<number>>()
/**
 * kcwiki 台词按槽位查表（形态 → 槽位 → 中日两列）。
 *
 * 发行版里 `wikiwiki-voice` 不随包，字幕层此前实际只剩 subtitle-zh/ja 一个源；
 * 而主来源 `kcwiki-voice` 早就随包、NOTICE 在册，只是没接进来。
 * 它**只补空格**，同一格 subtitle 有值一律不覆盖（音轨转写是文本权威）。
 */
let kcwikiBySlot = new Map<number, Map<number, KcwikiSlotLine>>()
/**
 * 季节台词按舰分组（`kcwiki-seasonal-voice` 的 `ships`）。
 *
 * 只服务一件事：耳测台账确证「这一格此刻挂的就是**那一条**」时，把那一条打出来。
 * 不做任何按日期的当季推断。
 */
let seasonalShips: Record<string, { key?: string; zh?: string; ja?: string }[] | undefined> = {}
/**
 * 季节台词的**文本指纹**按形态分组（折叠后的中日两列都收）。
 *
 * 只服务一件事：判「这个形态的 subtitle 表还剩几格常规台词」时，认出季节污染的那几格
 *（见 shared/voice-scene-slots 的 `regularSubtitleSlots`）。查表面沿改装链放宽——
 * kcwiki 的季节包把整族台词都记在基础形态的形态码下，改形态那边一条都查不到。
 */
let seasonalFoldedByForm = new Map<number, Set<string>>()
let voiceFallbackOf = new Map<number, number[]>()
let loading: Promise<void> | null = null
let ready = false
let pending: VoiceEvent[] = []
let hideTimer: ReturnType<typeof setTimeout> | null = null
let hourlyTimer: ReturnType<typeof setTimeout> | null = null
const lineTimers = new Set<ReturnType<typeof setTimeout>>()
let friendlyLane = 0
let enemyLane = 0
let captionsEnabled = Boolean(config.get('kanso.voiceCaptions', true))

/**
 * 底部字幕的世代号。**每出一句就自增，清场也自增。**
 *
 * 退场时刻要等一次异步查询（问游戏页这条音轨多长）才定得下来，那期间屏幕上挂的
 * 可能已经不是当初那一句了：2026-08-22 那次事件风暴（见下面 captionShownAt 的头注）
 * 证明字幕层不能把「上游只会发一次」当前提。查询回来时世代对不上就什么都不做——
 * 否则会拿旧那一句的时长去续新那一句的命，或者把玩家刚关掉的字幕重新挂上退场计时。
 */
let captionGeneration = 0

const clearCaptionVisuals = () => {
  captionGeneration += 1
  if (hideTimer) clearTimeout(hideTimer)
  if (hourlyTimer) clearTimeout(hourlyTimer)
  hideTimer = null
  hourlyTimer = null
  for (const timer of lineTimers) clearTimeout(timer)
  lineTimers.clear()
  const subtitle = document.querySelector<HTMLElement>('#voice-subtitle')
  subtitle?.classList.remove('show', 'voice-wedding')
  subtitle?.querySelector<HTMLElement>('.voice-subtitle-speaker')?.replaceChildren()
  subtitle?.querySelector<HTMLElement>('.voice-subtitle-line')?.replaceChildren()
  document.querySelector<HTMLElement>('#voice-danmaku')?.replaceChildren()
}

export const setVoiceCaptionsEnabled = (enabled: boolean) => {
  captionsEnabled = enabled
  if (!enabled) clearCaptionVisuals()
}

/**
 * 字幕的**基准**字号（px）。屏幕上生效的是它乘游戏画面当前倍率——那道乘法在样式表里
 *（index.html 的 `--voice-caption-px`），倍率由镇壳写在 `#game-wrapper` 上。
 *
 * 初值自己从 config 读，不等钥推：钥装配失败这条设置就会静默失效，而字幕层
 * 在钥之前很久就已经开始出字了（同 lg 的建造剧透开关那条注释）。
 */
export const setVoiceCaptionSize = (px: unknown) => {
  document.documentElement.style.setProperty(
    '--voice-caption-base',
    `${normalizeVoiceCaptionSize(px)}px`,
  )
}
setVoiceCaptionSize(config.get(VOICE_CAPTION_SIZE_PATH, VOICE_CAPTION_SIZE_DEFAULT))

const loadData = async () => {
  const [raw, zh, ja, npc, enemies, wikiwiki, wikiwikiAbyss, seasonal, kcwikiVoice, kcwikiShips] =
    await Promise.all([
      queryMasterRaw(),
      queryLode('subtitle-zh'),
      queryLode('subtitle-ja'),
      queryLode('subtitle-npc'),
      queryLode('subtitle-enemies'),
      queryLode('wikiwiki-voice'),
      queryLode('wikiwiki-abyss-voice'),
      queryLode('kcwiki-seasonal-voice'),
      // 后两个只为算「哪些槽位被季节语音占着」——判据要与图鉴侧一字不差，
      // 而那份判据要的就是这几个源（见 seasonOccupiedSlots）
      queryLode('kcwiki-voice'),
      queryLode('kcwiki-ships'),
    ])
  setShipGraph(raw?.data?.api_mst_shipgraph ?? [])
  voiceFallbackOf = buildVoiceFallbackIds(
    raw?.data?.api_mst_ship ?? [],
    raw?.data?.api_mst_shipupgrade ?? [],
  )
  subtitleZh = (zh?.data ?? {}) as SubtitleTable
  subtitleJa = (ja?.data ?? {}) as SubtitleTable
  subtitleNpc = (npc?.data ?? {}) as ExtraSubtitleTable
  subtitleEnemies = (enemies?.data ?? {}) as ExtraSubtitleTable
  wikiwikiVoice = (wikiwiki?.data ?? {}) as WikiwikiVoiceTable
  wikiwikiAbyssVoice = (wikiwikiAbyss?.data ?? {}) as WikiwikiAbyssVoiceTable
  seasonalSkits = (seasonal?.data?.skits ?? {}) as typeof seasonalSkits
  seasonalShips = (seasonal?.data?.ships ?? {}) as typeof seasonalShips
  voiceZhByJa = buildVoiceTranslationIndex(subtitleJa, subtitleZh)
  // 分拣**只跑一次**，导出两张表：季节闸 + kcwiki 按槽位查表。
  // 各调一次就是把 17434 行的分拣跑两遍（实测一遍 ~83ms）。
  const plan = planVoiceCorrections({
    voice: (kcwikiVoice?.data ?? null) as never,
    subtitleJa,
    subtitleZh,
    seasonalShips: (seasonal?.data?.ships ?? null) as never,
    codeMap: kcwikiShips?.data ? buildShipFormCodeMap(kcwikiShips.data) : null,
  })
  // 缺任何一个源就算不出来，那时这张表是空的＝谁都不拦，字幕照旧出。
  // 这一层是「有实证才闭嘴」，不是「拿不准就整片静音」。
  seasonOccupied = seasonOccupiedFrom(plan.rowsByForm)
  kcwikiBySlot = kcwikiSlotIndex(plan.rowsByForm)
  seasonalFoldedByForm = seasonalTextIndex(seasonalShips)
  ready = true
}

const ensureData = () => {
  loading ??= loadData().catch((error) => {
    loading = null
    console.warn('[kanso] 游戏语音字幕资料加载失败', error)
  })
  return loading
}

// 受损语音的分档着色（用户 2026-08-11 要求小破/中破/大破/击沉四档）：
// 我方 19/20/21 是全舰统一的受损语音槽、22=轟沈（wikiwiki 语音表 100+ 舰
// 实证：19/20=小破、20 兼旗舰大破、21=中破/大破）；深海 damage 槽是音轨
// 后缀 30/31、sunk 是 40/41。击沉语音无需血量，槽位即语义。
const DAMAGE_VOICE_SLOTS = new Set([19, 20, 21])
const SUNK_VOICE_SLOT = 22

// 婚礼台词是**语音类别**，不是时间窗：矿脉里 24 号槽的场景名就是「ケッコンカッコカリ」
// （wikiwiki-voice 61 艘逐条标注，无一例外；subtitle-ja/zh 各 758 艘有这个键）。
// 于是染粉的判据只有槽位一个，天然只作用于开口的那一艘——不需要「婚礼报文后 N 秒
// 内该舰的字幕」这种窗口，也就没有「窗口漂到别人头上」这类失效模式。
// （28 号槽是「ケッコン後母港」，婚后每次点她都会响，属于日常台词，不染。）
const WEDDING_VOICE_SLOT = 24
const ENEMY_DAMAGE_SUFFIXES = new Set([30, 31])
const ENEMY_SUNK_SUFFIXES = new Set([40, 41])

// 该舰在当前战斗视图里的最差血量比（hpEnd 是**整场结算值**，不是播放那一刻）。
const worstRatioFor = (mstId: number, side: 'friendly' | 'enemy'): number | null => {
  const battleShips =
    side === 'friendly' ? mg.sortie?.battle?.fShips : mg.sortie?.battle?.eShips
  const ratios = (battleShips ?? [])
    .filter((ship) => ship.mstId === mstId && ship.hpMax > 0 && !ship.escaped)
    .map((ship) => ship.hpEnd / ship.hpMax)
  let worst = ratios.length ? Math.min(...ratios) : null
  if (worst == null && side === 'friendly') {
    // 战斗视图没有（罕见：语音晚到等）时退回母港编成的当前血量
    for (const deck of mg.decks) {
      for (const id of deck.ships) {
        const ship = mg.ships[id]
        if (!ship || ship.shipId !== mstId || !(ship.maxhp > 0)) continue
        const ratio = ship.nowhp / ship.maxhp
        if (worst == null || ratio < worst) worst = ratio
      }
    }
  }
  return worst
}

// 我方受损弹幕的档位以**台词槽位**为准（wikiwiki 语音表 300+ 舰无一例外：
// 19=小破、20=小破②与旗艦大破同一音轨、21=中破/大破、22=轟沈），不再拿
// 整场结束血量分档——台词在动画中途播出，该舰后续又挨打时小破台词会被涂成
// 大破红（实测 2026-08-12：伊势 59→12/78，小破弹幕飘红）。血量只做两处消歧：
// 21 轨分中破/大破；20 轨仅当「旗舰且确已大破」按旗艦大破涂红，其余按小破②。
const friendlyDamageTone = (
  voiceId: number,
  mstId: number,
): 'light' | 'mid' | 'heavy' | null => {
  if (!DAMAGE_VOICE_SLOTS.has(voiceId)) return null
  if (voiceId === 19) return 'light'
  const ratio = worstRatioFor(mstId, 'friendly')
  if (voiceId === 20) {
    const flagship = mg.sortie?.battle?.fShips.find((ship) => ship.index === 0)
    return flagship?.mstId === mstId && ratio != null && ratio <= 0.25 ? 'heavy' : 'light'
  }
  return ratio != null && ratio <= 0.25 ? 'heavy' : 'mid'
}

// 深海受损音轨（30/31）不分档——只能按血量涂；口径与我方旧实现相同，
// 已知偏差：用的是整场结算血量，动画中途会偏深一档，深海侧可接受。
const enemyDamageTone = (mstId: number): 'light' | 'mid' | 'heavy' | null => {
  const worst = worstRatioFor(mstId, 'enemy')
  if (worst == null) return null
  if (worst <= 0.25) return 'heavy'
  if (worst <= 0.5) return 'mid'
  return 'light'
}

/**
 * 取一格字幕文本：去掉两端空白，**占位句当空**。
 *
 * poi-plugin-subtitle 在「这一条没有转写」时写的是一句占位文本而不是留空，
 * 中日各一句（判据见 shared/voice-scene-slots 的 isSubtitlePlaceholder）。
 * 中文那句长这样：「本字幕暂时没有翻译 请到舰娘百科(https://zh.kcwiki.moe/)协助我们翻译」
 * ——真包里 259 格，从前一个字都没拦过，直接连网址打在玩家屏幕上。
 *
 * 当空处理而不是原样显示：这一格本来就没有台词，说「没有」比说一句招募文案诚实。
 */
const captionText = (value: unknown): string => {
  const text = `${value ?? ''}`.trim()
  return isSubtitlePlaceholder(text) ? '' : text
}

/**
 * 台账确证「这一格此刻挂的就是那一条季节台词」时，把**那一条**取出来。
 *
 * 与图鉴侧同一手（`ji.ts` 的 mountedSeasonalLine → 那一条季节行给播放钮）：
 * 平时季节台词不按地址硬拼——过季点下去播的是平时那句，那不是能播，是骗人。
 * 但「此刻挂的是哪一条」如果**查得出来**，情况就反过来了：播的正是它。
 *
 * ⚠️ **一格一证，只由证据授予**。官方换文件的时点、换哪几艘、换的是哪一句，
 * 都不是日历能算出来的——这里绝不做「按今天的日期猜当季」那种推断。
 * 台账里没有条目的格子照旧走季节闸（不出字幕）。
 */
const mountedSeasonalText = (mstId: number, voiceId: number): string => {
  const key = voicePlaybackObservationAt(mstId, voiceId)?.mountedSeasonalKey
  if (!key) return ''
  const line = seasonalShips[`${mstId}`]?.find((entry) => entry?.key === key)
  const zh = captionText(line?.zh)
  return zh ? normalizeVoiceText(zh) : captionText(line?.ja)
}

const shipCaption = (cue: Extract<VoiceRequestCue, { kind: 'ship' }>): CaptionLine[] => {
  // 先问台账：这一格此刻挂的是哪一条季节台词？查得出来就打那一条——
  // 它比下面两道闸更准（闸说的是「两边都不保证」，而这里是「已经确证是这一条」）。
  // 所以它必须排在闸之前，否则会被闸当成「不确定」一起静音掉。
  const mounted = mountedSeasonalText(cue.mstId, cue.voiceId)
  if (mounted) {
    return [{
      speaker: entityNamePlain('ship', cue.mstId, masterShipName(cue.mstId)),
      text: mounted,
      delay: 0,
    }]
  }
  // 这一格被季节语音占过：官方当季把槽位上的**音频文件**换成季节版，
  // 而字幕表记的是抓包那一刻的那一句——当季与过季各对一半，两边都不保证。
  // 图鉴侧 2026-08-23 已经裁过同一件事（不给播放钮），这里沿用同一份判据：
  // 不出字幕，静默降级，与本文件下面「不确定就不出」同一口径。
  //
  // 按**将要播放的那个形态**（cue.mstId）查——文本可以沿改装链借，音轨永远
  // 按当前形态拼。也刻意不判「现在是不是季节期」：那要靠日期猜官方换没换文件，
  // 猜错就是当着玩家的面打错一句话（本仓故意没有当季判定，护栏禁着）。
  if (seasonOccupied.get(cue.mstId)?.has(cue.voiceId)) return []
  // 第二条证据渠道：耳测台账里判 season-slot 的那几格（图鉴侧的 voicePlaybackFor
  // 同样两条都认）。上面那条包判据靠的是「字幕表里躺着的正好是一句季节台词」——
  // 它只抓得住**抓包发生在季期**的那个方向。反方向（字幕表记的是平时那句、
  // 当季播的是季节版，也就是用户 2026-08-23 亲测报的那种）在包里一点痕迹都没有，
  // 只有人耳听得出来，所以台账是这一族唯一的出路。实测两条渠道零重叠。
  if (voicePlaybackObservationAt(cue.mstId, cue.voiceId)?.verdict === 'season-slot') return []
  const key = `${cue.voiceId}`
  /** 这一形态的 kcwiki 台词：中文优先、过标点体例归一，都空就是空。 */
  const kcwikiAt = (id: number): string => {
    const row = kcwikiBySlot.get(id)?.get(cue.voiceId)
    const zh = captionText(row?.zh)
    return zh ? normalizeVoiceText(zh) : captionText(row?.ja)
  }
  // 实体级回退：当前形态整份资料都不存在时，才沿改装链找最近的前置形态。
  // 当前形态只要已有任一语言的表，就不拿前置形态补单个缺行，避免新旧台词混拼。
  //
  // ⚠️ **选形态只看 subtitle / wikiwiki 有没有整份表，kcwiki 不参与选形态**。
  // 把 kcwiki 也算进「本形态有源」会重演「小桶挡整页」：早霜改二自己只有 7 行
  // kcwiki、没有 subtitle 表，而 早霜改 有整整 52 格——让它在自己这一层停下，
  // 屏幕上就从 52 格掉回 7 格。实测这么改会让 8 个形态共 225 格倒退
  //（早霜改二/初月改二/Richelieu Deux/早波改二/秋月改二/初雪改二/藤波改二/白雪改二）。
  // kcwiki 的位置是**选定形态之后补空格**，以及全链一份表都没有时单独扛起一个形态。
  //
  // ⚠️ **「有表」判的是「还剩常规台词」，不是「表这个对象存不存在」**。
  // 2026-08-27 用户实测的杰维斯改（394）中破无字幕就死在这一字之差上：
  // 她和未改（519）的 subtitle 表**各只有一个键「2」**，还是同一句夏季限定台词——
  // 一句常规台词都没有，却足以让链停在这里，把后面 27 格全挡掉。
  // 判据与剔除理由见 shared/voice-scene-slots 的 `regularSubtitleSlots`。
  let sourceId: number | null = null
  let text = ''
  const chain = voiceFallbackOf.get(cue.mstId) ?? [cue.mstId]
  // 季节证据沿**整条链**查：kcwiki 的季节包把整族台词记在基础形态的形态码下，
  // 只查当前形态会漏掉改形态上那条一模一样的季节孤条（394 漏、519 中，就是这道缝）。
  const chainSeasonal = chain
    .map((id) => seasonalFoldedByForm.get(id))
    .filter((set): set is Set<string> => set != null && set.size > 0)
  const isSeasonalText = chainSeasonal.length
    ? (value: string): boolean => {
      const folded = foldVoiceLineForCompare(value)
      return Boolean(folded) && chainSeasonal.some((set) => set.has(folded))
    }
    : null
  for (const id of chain) {
    const hasSubtitle = regularSubtitleSlots({
      ja: subtitleJa[`${id}`],
      zh: subtitleZh[`${id}`],
      seasonOccupied: seasonOccupied.get(id),
      isSeasonalText,
    }).length > 0
    const wikiLines = wikiwikiVoice[`${id}`]
    if (!hasSubtitle && !wikiLines?.length) continue
    sourceId = id
    if (hasSubtitle) {
      // 中文那一支过一道**标点体例归一**（行尾不写句号、省略号后不许再接句号），
      // 与图鉴台词卷同一份判据（shared/voice-text）——同一句话在两处不许长得不一样。
      // 日文回退**不动**：那是原文转写，不是我们的翻译。
      const zhLine = captionText(subtitleZh[`${id}`]?.[key])
      text = zhLine ? normalizeVoiceText(zhLine) : captionText(subtitleJa[`${id}`]?.[key])
    } else {
      const line = wikiLines!.find((entry) => entry.voiceId === cue.voiceId)
      const reused = line ? voiceZhByJa.get(normalizeVoiceLine(line.ja)) : ''
      text = reused ? normalizeVoiceText(reused) : `${line?.ja ?? ''}`
    }
    // 同一形态内补空：subtitle 那一格没有转写（或写的是占位句）时才轮到 kcwiki。
    // **有值一律不覆盖**——音轨转写是文本权威，kcwiki 是转写层。
    if (!text) text = kcwikiAt(id)
    break
  }
  // 全链一份 subtitle/wikiwiki 表都没有：这时 kcwiki 单独扛起一个形态。
  // 新实装的那批舰就落在这里——从前她们一个字都没有。
  //
  // ⚠️ 这一支**逐格沿链**，与上面主循环的「有表就停在本形态」不是一回事，也不矛盾：
  // 主循环那道闸防的是**新旧台词混拼**——本形态有整份自己的台词，就不该拿前置形态
  // 的旧词去补它的单个缺行。而这里本形态压根没有「自己的那份台词」，kcwiki 又只是
  // 补空层（对改形态它只收与未改**有差分**的台词，缺的那些格本来就等于「沿用未改」）。
  // 于是本形态该格取不到时接着往前置形态借，与它的定位一致。
  // 杰维斯改 394 的中破正是这一格：她的 kcwiki 桶有 32 格却没有 21，
  // 而未改 519 的 21 格里躺着那句「Lucky Jervisは……沈まない！」。
  if (sourceId == null) {
    for (const id of chain) {
      if (!kcwikiBySlot.get(id)?.size) continue
      const borrowed = kcwikiAt(id)
      if (!borrowed) continue
      sourceId = id
      text = borrowed
      break
    }
  }
  if (sourceId == null) return []
  if (!text) return []
  const tone =
    cue.voiceId === SUNK_VOICE_SLOT
      ? 'sunk'
      : cue.voiceId === WEDDING_VOICE_SLOT
        ? 'wedding'
        : friendlyDamageTone(cue.voiceId, cue.mstId)
  return [{
    speaker: entityNamePlain('ship', cue.mstId, masterShipName(cue.mstId)),
    text,
    delay: 0,
    ...(tone ? { tone } : {}),
  }]
}

const enemySpeaker = (fallback: string): string => {
  const localizedId = Number(localizedEntityId('abyssShip', fallback))
  if (Number.isInteger(localizedId) && localizedId >= 1_500) {
    return entityNamePlain('abyssShip', localizedId, fallback)
  }
  const canonical = canonicalAbyssalSpeakerLabel(fallback)
  const entry = Object.entries(mg.master.ships).find(
    ([id, ship]) => Number(id) >= 1_500 && ship.name === canonical,
  )
  return entry ? entityNamePlain('abyssShip', Number(entry[0]), fallback) : fallback
}

/**
 * Boss 开场字幕的**前半截**：舰型名（`api_flavor_info[].api_class_name`）。
 *
 * 主数据里根本没有这个信息，只有开场台词框给——想显示
 * 「深海新鋭駆逐艦 駆逐ラ級ζ-壊」这种完整称呼只能从这儿取，此前只有后半截。
 *
 * 走一遍译名层再上屏：**查得到用中文、查不到保原文**（这几个词现在一个都不在词表里，
 * 所以眼下都是日文原样，将来词表补上会自动跟着变）。名字是名字，不自己编译法。
 */
const flavorSpeaker = (className: string | undefined, name: string): string => {
  const label = `${className ?? ''}`.trim()
  if (!label) return name
  const typeId = localizedEntityId('shipType', label)
  const localized = typeId ? entityNamePlain('shipType', typeId, label) : label
  return `${localized} ${name}`.trim()
}

/**
 * 短剧/群像语音（kc9997）：多位舰娘同台的一段演出，没有单一形态归属。
 * 文本住在季节包的 `skits` 栏——档名是裸编号（`1188` = 西村舰队出击前的对白）。
 * **随包只有中文译文**（同季节台词域的许可口径），所以没有译文就不出字幕。
 */
const skitCaptions = (cue: Extract<VoiceRequestCue, { kind: 'skit' }>): CaptionLine[] => {
  const entry = seasonalSkits[cue.voiceId]
  const text = normalizeVoiceText(`${entry?.zh ?? ''}`.trim())
  if (!text) return []
  return [{ speaker: `${entry?.scene || '短剧'}`, text, delay: 0 }]
}

const extraCaptions = (
  cue: Extract<VoiceRequestCue, { kind: 'npc' | 'enemy' }>,
): CaptionLine[] => {
  // 深海音轨的后缀即槽位（矿脉实证 damage=30/31、sunk=40/41）；
  // 受损行按敌舰实际血量分档，击沉行槽位即语义
  const enemySuffix = Number.parseInt(`${cue.voiceId}`.slice(-2), 10)
  const enemyDamaged = cue.kind === 'enemy' && ENEMY_DAMAGE_SUFFIXES.has(enemySuffix)
  const enemySunk = cue.kind === 'enemy' && ENEMY_SUNK_SUFFIXES.has(enemySuffix)
  const enemyToneOf = (mstId: number): { tone?: CaptionLine['tone'] } => {
    const tone = enemySunk ? 'sunk' : enemyDamaged ? enemyDamageTone(mstId) : null
    return tone ? { tone } : {}
  }
  const raw = (cue.kind === 'npc' ? subtitleNpc : subtitleEnemies)[cue.voiceId]
  if (raw) {
    return (Array.isArray(raw) ? raw : [raw]).flatMap((entry) => {
      const entryZh = `${entry.zh ?? ''}`.trim()
      const text = entryZh ? normalizeVoiceText(entryZh) : `${entry.jp ?? ''}`.trim()
      if (!text) return []
      const fallbackSpeaker = `${entry.name || ''}`.trim()
      return [{
        speaker: cue.kind === 'enemy' ? enemySpeaker(fallbackSpeaker) : fallbackSpeaker,
        text,
        delay: Number.isInteger(entry.time) && Number(entry.time) >= 0 ? Number(entry.time) : 0,
      }]
    })
  }
  if (cue.kind !== 'enemy') return []

  const flavorVoices = mg.sortie?.battle?.flavorVoices ?? []
  const exact = flavorVoices.find((entry) => entry.voiceId === cue.voiceId)
  if (exact) {
    return [{
      speaker: flavorSpeaker(
        exact.className,
        entityNamePlain(
          'abyssShip',
          exact.mstId,
          exact.shipName || masterShipName(exact.mstId),
        ),
      ),
      text: exact.message,
      delay: 0,
      ...enemyToneOf(exact.mstId),
    }]
  }

  // 开幕报文给出当前深海形态、音轨键与原文。后续攻击/受创/击沉音轨沿用同一键前缀，
  // 最后两位是场景后缀；仅在 WIKIWIKI 同一精确 No. 已收录该后缀时补字幕。
  const stem = cue.voiceId.slice(0, -2)
  const opening = flavorVoices.find(
    (entry) => entry.voiceId.endsWith('10') && entry.voiceId.slice(0, -2) === stem,
  )
  const suffix = Number.parseInt(cue.voiceId.slice(-2), 10)
  const line = opening && Number.isInteger(suffix)
    ? wikiwikiAbyssVoice[`${opening.mstId}`]?.find((entry) => entry.suffix === suffix)
    : null
  if (!opening || !line) return []
  return [{
    speaker: flavorSpeaker(
      opening.className,
      entityNamePlain(
        'abyssShip',
        opening.mstId,
        opening.shipName || masterShipName(opening.mstId),
      ),
    ),
    text: line.ja,
    delay: 0,
    ...enemyToneOf(opening.mstId),
  }]
}

const captionsFor = (cue: VoiceRequestCue): CaptionLine[] =>
  cue.kind === 'ship'
    ? shipCaption(cue)
    : cue.kind === 'skit'
      ? skitCaptions(cue)
      : extraCaptions(cue)

// 台词着色的 class 名。受损四档共用 dmg- 前缀（它们是同一根轴上的分档），
// 婚礼另起一个名字——它跟破损程度不是一回事，写成 dmg-wedding 会让下一个人
// 以为粉色也是一档伤害。
const toneClass = (tone: CaptionLine['tone']): string =>
  !tone ? '' : tone === 'wedding' ? 'voice-wedding' : `dmg-${tone}`

/** 游戏页那个 webview。只用到 executeJavaScript，所以按结构写类型，不牵 electron 的类型进来 */
type GameWebview = HTMLElement & { executeJavaScript(code: string): Promise<unknown> }

/**
 * 问游戏页：这一条语音解出来有多长（毫秒）？查不到给 null。
 *
 * 走的是和自检卡、截图同一条路（`webview.executeJavaScript` 读一个只读快照），
 * 不发请求、不碰播放。快照是**逐帧**的数组，同一条语音可能被多个帧解过，
 * 取最大的那个：短的那份多半是被截断/半路失败的解码。
 *
 * 查不到不是异常，是这条链正常的一档降级——webview 还没挂上、那个帧没装上钩子、
 * 这一条已经被 24 条的环挤出去了，都会落到这里。调用方按 audioMs=null 走字数兜底，
 * 玩家看到的只是「这一句按估算退场」。所以这里既不报错也不打日志：
 * 一条走得通的降级路上刷 console 只会把真问题淹掉（错误处理里裸 console 还有自激前科）。
 */
const voiceAudioMs = (pathname: string | undefined): Promise<number | null> => {
  if (!pathname) return Promise.resolve(null)
  const webview = document.querySelector<GameWebview>('#game-wrapper webview')
  if (!webview) return Promise.resolve(null)
  return webview
    .executeJavaScript('window.kansoGameAudioStats ? window.kansoGameAudioStats() : null')
    .then((result) => {
      const frames = Array.isArray(result) ? result : []
      let longest: number | null = null
      for (const frame of frames) {
        const rows = (frame as { voiceDurations?: unknown } | null)?.voiceDurations
        if (!Array.isArray(rows)) continue
        for (const row of rows as { path?: unknown; ms?: unknown }[]) {
          if (`${row?.path ?? ''}` !== pathname) continue
          const ms = Number(row?.ms)
          if (Number.isFinite(ms) && ms > 0 && (longest == null || ms > longest)) longest = ms
        }
      }
      return longest
    })
    .catch(() => null)
}

const showSubtitle = ({ speaker: speakerText, text, tone, pathname }: CaptionLine) => {
  const host = document.querySelector<HTMLElement>('#voice-subtitle')
  const speaker = host?.querySelector<HTMLElement>('.voice-subtitle-speaker')
  const line = host?.querySelector<HTMLElement>('.voice-subtitle-line')
  if (!captionsEnabled || !host || !speaker || !line || !text) return

  speaker.textContent = speakerText
  line.textContent = text
  // 底部字幕是**同一个**常驻元素反复复用：上一句染过的色必须先摘干净，
  // 否则婚礼那一句之后，母港里每一句台词都会继续挂着粉。
  host.classList.remove('voice-wedding')
  if (tone === 'wedding') host.classList.add('voice-wedding')
  host.classList.remove('show')
  // 同一句连续触发时也重新开始淡入和停留计时。
  void host.offsetWidth
  requestAnimationFrame(() => host.classList.add('show'))
  // 退场分两段（判据全在 shared/voice-caption-hold）：先撑住一个最短展示，
  // 到期**不直接退**，而是先问游戏页这条音轨真有多长，问到就续到音轨结束。
  // 之所以不在一开始就问：那时游戏多半还没解码完（howler 先取字节再 decode 再播），
  // 问了也是空手；等到最短展示到期，这一条早已解出来了。
  const generation = ++captionGeneration
  const shownAt = Date.now()
  const textLength = [...text].length
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    hideTimer = null
    void voiceAudioMs(pathname).then((audioMs) => {
      // 查询在途时来了新字幕、或者被清场了——那一句的时长跟这一句无关
      if (generation !== captionGeneration) return
      const remaining = captionHideAtMs({ shownAtMs: shownAt, textLength, audioMs }) - Date.now()
      if (remaining <= 0) {
        host.classList.remove('show')
        return
      }
      // 只续这一次：第二段到期直接退场，不再问第二遍
      if (hideTimer) clearTimeout(hideTimer)
      hideTimer = setTimeout(() => {
        hideTimer = null
        host.classList.remove('show')
      }, remaining)
    })
  }, captionMinHoldMs(textLength))
}

const showDanmaku = (
  { speaker, text, tone }: CaptionLine,
  direction: Exclude<CaptionMode, 'bottom'>,
) => {
  const host = document.querySelector<HTMLElement>('#voice-danmaku')
  if (!captionsEnabled || !host || !text) return
  const item = document.createElement('span')
  const lane = direction === 'friendly' ? friendlyLane++ % 4 : enemyLane++ % 4
  // 战斗语音不做密度限制：每个实际请求都立即放出，速度按台词长短给（判据在
  // shared/voice-caption-hold）——弹幕要的是**读完**，长句用固定 6 秒会没读完就飘出去。
  // 只按台词算，speaker 前缀不计入：名字是眼睛一扫就过的，不占阅读时间。
  const duration = danmakuDurationSeconds([...text].length)
  item.className = `voice-danmaku-item ${direction}${tone ? ` ${toneClass(tone)}` : ''}`
  item.style.setProperty('--voice-lane', `${lane}`)
  item.style.setProperty('--voice-duration', `${duration}s`)
  item.textContent = speaker ? `${speaker}：${text}` : text
  const remove = () => item.remove()
  item.addEventListener('animationend', remove, { once: true })
  host.appendChild(item)
  setTimeout(remove, Math.ceil(duration * 1000) + 500)
}

const modeFor = (cue: VoiceRequestCue): CaptionMode => {
  if (cue.kind === 'enemy') return 'enemy'
  if (cue.kind === 'ship' && mg.sortie?.active && mg.sortie.battle) return 'friendly'
  return 'bottom'
}

const renderLine = (line: CaptionLine, mode: CaptionMode) => {
  if (!captionsEnabled) return
  if (mode === 'bottom') showSubtitle(line)
  else showDanmaku(line, mode)
}

const scheduleLines = (lines: CaptionLine[], mode: CaptionMode) => {
  if (!captionsEnabled) return
  for (const line of lines) {
    if (line.delay <= 0) {
      renderLine(line, mode)
      continue
    }
    const timer = setTimeout(() => {
      lineTimers.delete(timer)
      renderLine(line, mode)
    }, line.delay)
    lineTimers.add(timer)
  }
}

const displayAtPlaybackTime = (cue: VoiceRequestCue, lines = captionsFor(cue)) => {
  const mode = modeFor(cue)
  // 30..53 是整点报时资源：游戏会提前请求，实际播放发生在下一个整点。
  // 与 poi-plugin-subtitle 的处理一致，避免登录时把尚未播放的时报提前刷出来。
  if (cue.kind === 'ship' && cue.voiceId >= 30 && cue.voiceId <= 53) {
    if (hourlyTimer) clearTimeout(hourlyTimer)
    const nextHour = new Date()
    nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0)
    hourlyTimer = setTimeout(() => {
      hourlyTimer = null
      // 出击/演习中游戏本来就不播时报——预取那一刻在母港，到点时人已经出门了。
      // 门查的是**到点这一刻**的状态，不是排定时刻：出击途中排下的这一个，
      // 只要回港赶得及，照常出。
      //
      // 丢弃而不是顺延：游戏回港后不会补播这个整点，跟着丢才对得上耳朵听到的。
      // 下一个整点若在母港，游戏会重新预取，字幕自然跟着回来。
      if (mg.sortie?.active) return
      scheduleLines(lines, mode)
    }, Math.max(0, +nextHour - Date.now()))
    return
  }
  scheduleLines(lines, mode)
}

/**
 * 路径 → 上一次为它出字幕的时刻。**字幕层不把「上游只会发一次」当前提**。
 *
 * 2026-08-22 用户实机撞到过一次：「听过即存」让游戏页替我们再发一次读缓存请求，
 * 那一次同样被 webRequest 拦到、又 emit 了一遍 `kancolle.voice`，于是自激成
 * 每秒二十几条事件；底部字幕被反复重画（每次重画都把退场计时器重置），
 * 看起来就是「卡住不消失 + 在几句之间高速轮换」。
 * 上游那条边已经在 main/kcs-resource 的闸门里堵死了，这里是第二道：
 * 就算再有事件风暴，同一条语音在窗口内也只出一次字幕、只挂一次退场计时器。
 */
const captionShownAt = new Map<string, number>()

const consume = (event: VoiceEvent) => {
  if (!captionsEnabled) return
  const pathname = typeof event.pathname === 'string' ? event.pathname : ''
  const ts = typeof event.ts === 'number' ? event.ts : Date.now()
  if (!pathname || Date.now() - ts > 15000) return
  if (!shouldRenderCaption(captionShownAt, pathname, Date.now())) return
  // 演习双方都是真实舰娘，同一音轨无法可靠区分我方/对手；按产品约定整场不显示语音文字。
  if (mg.sortie?.active && mg.sortie.practice) return
  const cue = resolveVoiceRequest(pathname)
  if (!cue) {
    // 路径就认不出：目录名不在 shipgraph 里，或编号既非混淆值也非裸编号。
    // **这一档才是解析器的活**。
    void ipcRenderer.invoke('mg:voice-unmatched', {
      pathname,
      kind: 'unresolved',
      reason: 'unresolved',
      ts,
    })
    return
  }
  // 取词那几条路只认 cue，不知道地址；地址在这里统一补上——底部字幕靠它查真时长。
  const lines = captionsFor(cue).map((line) => ({ ...line, pathname }))
  if (!lines.length) {
    // 归属认出来了，只是本地矿脉没有这一条文本。跟解析器无关——多半是
    // wikiwiki-voice 独有、按许可口径不随包造成的，改代码补不出来。
    // 混进上面那一档会让人以为「认不出的有几十条」，进而白折腾解析器。
    void ipcRenderer.invoke('mg:voice-unmatched', {
      pathname,
      kind: cue.kind,
      reason: cue.kind === 'ship' ? 'no-text' : 'no-voice-id',
      voiceId: `${cue.voiceId}`,
      ...('mstId' in cue ? { mstId: cue.mstId } : {}),
      ts,
    })
    return
  }
  displayAtPlaybackTime(cue, lines)
}

/**
 * **仅调试**：放一条已经解析好的语音提示（门控同诊断面板 KANSO_DEBUG_UI）。
 *
 * 婚礼台词（24 号槽）一艘舰一生只播一次，戒指又不可再生——染粉这件事在真机上
 * 没有第二次验收机会。所以编的只有 cue 本身：取词、回退、染色、展示全部走
 * 生产路径（captionsFor → displayAtPlaybackTime），看到的就是真播那一句的样子。
 */
export const debugShowVoiceCue = (cue: VoiceRequestCue) => {
  if (process.env.KANSO_DEBUG_UI !== '1') return
  void ensureData().then(() => displayAtPlaybackTime(cue))
}

const flushPending = () => {
  // 资料没加载成就不消费：空表上逐条匹配失败会把「包没读成」
  // 污染成成批的 mg:voice-unmatched 误报（这些语音都没字幕≠事实）。
  // 队列留着，等下一次 ensureData 成功再放行。
  if (!ready) return
  const queued = pending
  pending = []
  queued.forEach(consume)
}

export const initVoiceSubtitles = (broadcaster: VoiceBroadcaster) => {
  broadcaster.addListener('kancolle.voice', (event) => {
    if (!captionsEnabled) return
    if (!ready) {
      pending = [...pending.slice(-127), event]
      void ensureData().then(flushPending)
      return
    }
    consume(event)
  })
  onMgChange((keys) => {
    if (!keys.includes('master')) return
    loading = null
    ready = false
    void ensureData().then(flushPending)
  })
  void ensureData().then(flushPending)
}
