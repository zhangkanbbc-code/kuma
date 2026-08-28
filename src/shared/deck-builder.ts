// デッキビルダー（deck builder）v4 编成交换格式。
//
// 这是社区的事实标准：制空権シミュレータ、作戦室(Jervis)、各类模拟器都吃它。
// 支持它就等于让艦素的编成不再是孤岛——「信息不孤岛」在编成侧最低成本的兑现。
//
// 规范出处：YSRKEN 的格式解说 gist
// https://gist.github.com/YSRKEN/74219bd3f99624a38c8ecc0d32ddd257
// **2026-08-08 与上游原文逐字核对过**，本地《矿脉-数据源普查》里记的两处与它不符：
//   · 装备 `id` 是**数字**，不是字符串（舰娘 `id` 才是带引号的字符串）；
//   · `mas` 文档写「字符串」，而官方示例里给的是数字 7。
// 所以：**读要宽、写要定一种**。下面 numOf 对两种形态都收，导出统一写数字。
//
// 纪律：这个格式只用来「看」和「交换」。导入进来是拿去对照与核对的，
// 艦素不会、也不能替你去游戏里编成。

export interface DeckBuilderItem {
  mstId: number
  /** 改修度 0–10 */
  rf: number
  /** 舰载机熟练度 0–7；非舰载机没有这一项 */
  mas?: number
}

export interface DeckBuilderShip {
  /** 舰娘图鉴 id（api_ship_id / mstId） */
  mstId: number
  lv: number
  /** 运；-1 表示「用默认值」，即未指定 */
  luck: number
  /** 常规格 1–5，按位置；空格为 null。第 5 格是大和改二这类五格舰的（见 MAX_SLOTS） */
  slots: (DeckBuilderItem | null)[]
  /** 补强增设格 */
  exSlot: DeckBuilderItem | null
}

export interface DeckBuilderFleet {
  /** 1–6 号位；空位为 null */
  ships: (DeckBuilderShip | null)[]
}

export interface DeckBuilderDeck {
  hqLv: number
  /** 第 1–4 舰队；不存在的队为 null */
  fleets: (DeckBuilderFleet | null)[]
}

const MAX_FLEETS = 4
const MAX_SHIPS = 6
/**
 * 常规格上限 5。曾经是 4，于是大和改二这类五格舰的第 5 格被 slice 掉——
 * 导出给别人看的编成静悄悄少一件装备，最该看清的那一件（多是主炮或电探）。
 *
 * 上游 gist 只列到 `i4`：它写在五格舰进游戏之前，通篇按四格描述。但它自己给出的
 * 规则是「**三格以下的舰，`i(スロット数+1)` 就是补强增设**」——也就是说
 * `i1..i(槽数)` 是常规格、再往后一个才是增设，槽数本来就是随舰走的变量。
 * 2026-08-20 逐个查了下游实装（本地 poi-master 里没有 deckbuilder 实现，
 * 那份互通是各计算器自己做的）：
 *   · 制空権シミュレータ noro6/kc-web `src/classes/convert.ts`：读用
 *     `for (i = 0; i < master.slotCount; i++) items[`i${i+1}`]`，增设取
 *     `ix` 或 `i${master.slotCount + 1}`；写用 `deckItem[`i${j+1}`]` 不设上限。
 *   · gkcoi Nishisonic `src/type.ts`：舰的 items 类型明写 `i1..i5, ix`
 *     （基地那一份才只到 i4——陆航就是四格），取值也是 i1..i5 + ix。
 *   · 作戦室 kcjervis/jervis `src/utils/deckbuilder.ts`：`DeckItems` 同样含 `i5`。
 * 三份独立实装都吃 `i5`，写也写得出，据此放开到 5。
 *
 * ⚠ 遗留的一处含混（改这个之前就有，不因放开而变坏）：按上游那条规则，
 * 四格舰的增设可能被某些产出方写成 `i5`。这里是纯格式层、拿不到主数据的槽数，
 * 分不清那到底是第 5 格还是增设，一律当第 5 格读——总好过原先整条丢掉。
 */
const MAX_SLOTS = 5

/** 数字或数字字符串都收——上游两种都在野外出现过 */
const numOf = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))

// ---- 导出 ----

const encodeItem = (item: DeckBuilderItem): Record<string, number> => {
  const out: Record<string, number> = { id: item.mstId, rf: clamp(Math.round(item.rf), 0, 10) }
  // 「非舰载机不写 mas」是上游明写的；熟练度 0 也不写，0 本来就是默认
  if (item.mas != null && item.mas > 0) out.mas = clamp(Math.round(item.mas), 0, 7)
  return out
}

const encodeShip = (ship: DeckBuilderShip): Record<string, unknown> => {
  const items: Record<string, unknown> = {}
  ship.slots.slice(0, MAX_SLOTS).forEach((item, index) => {
    if (item) items[`i${index + 1}`] = encodeItem(item)
  })
  if (ship.exSlot) items.ix = encodeItem(ship.exSlot)
  return {
    id: `${ship.mstId}`, // 舰娘 id 必须是带引号的字符串，这是规范明写的
    lv: ship.lv,
    luck: ship.luck,
    items,
  }
}

/** 编成 → v4 JSON 对象。空队、空位一律省略（规范允许，也让输出短得多） */
export const encodeDeckBuilder = (deck: DeckBuilderDeck): Record<string, unknown> => {
  const out: Record<string, unknown> = { version: 4, hqlv: deck.hqLv }
  deck.fleets.slice(0, MAX_FLEETS).forEach((fleet, fleetIndex) => {
    if (!fleet) return
    const ships: Record<string, unknown> = {}
    fleet.ships.slice(0, MAX_SHIPS).forEach((ship, shipIndex) => {
      if (ship) ships[`s${shipIndex + 1}`] = encodeShip(ship)
    })
    if (Object.keys(ships).length) out[`f${fleetIndex + 1}`] = ships
  })
  return out
}

export const deckBuilderJson = (deck: DeckBuilderDeck): string =>
  JSON.stringify(encodeDeckBuilder(deck))

/**
 * 载入链接。**注意这串 URL 里带着你的编成数据**，
 * 所以只把它放进剪贴板，要不要贴出去由用户自己决定，艦素不会主动打开。
 */
export const deckBuilderUrl = (deck: DeckBuilderDeck): string =>
  `http://kancolle-calc.net/deckbuilder.html?predeck=${encodeURIComponent(deckBuilderJson(deck))}`

// ---- 导入 ----

export interface DeckBuilderParseResult {
  deck: DeckBuilderDeck | null
  /** 读不出来时的人话原因；成功时为 null */
  error: string | null
  /** 读出来了但有可疑之处（版本不是 4、字段缺失等），照实列出，不静默 */
  warnings: string[]
}

const parseItem = (raw: unknown): DeckBuilderItem | null => {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const mstId = numOf(obj.id)
  if (mstId == null || mstId <= 0) return null
  const rf = numOf(obj.rf) ?? 0
  const mas = numOf(obj.mas)
  return {
    mstId: Math.round(mstId),
    rf: clamp(Math.round(rf), 0, 10),
    ...(mas != null && mas > 0 ? { mas: clamp(Math.round(mas), 0, 7) } : {}),
  }
}

const parseShip = (raw: unknown): DeckBuilderShip | null => {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const mstId = numOf(obj.id)
  if (mstId == null || mstId <= 0) return null
  const items = (obj.items ?? {}) as Record<string, unknown>
  const slots: (DeckBuilderItem | null)[] = []
  for (let i = 1; i <= MAX_SLOTS; i++) slots.push(parseItem(items[`i${i}`]))
  return {
    mstId: Math.round(mstId),
    lv: Math.max(1, Math.round(numOf(obj.lv) ?? 1)),
    // -1 = 未指定，原样保留；别默默换成 0，那会被读成「运是零」
    luck: Math.round(numOf(obj.luck) ?? -1),
    slots,
    exSlot: parseItem(items.ix),
  }
}

/**
 * 解析 v4 JSON。整串 JSON、或带 `?predeck=` 的载入链接都收。
 *
 * 读不出来就明说读不出来——不返回一个空编成冒充「读到了但是空的」。
 */
export const parseDeckBuilder = (input: string): DeckBuilderParseResult => {
  const warnings: string[] = []
  let text = `${input ?? ''}`.trim()
  if (!text) return { deck: null, error: '没有内容可读', warnings }
  // 载入链接：把 predeck 参数取出来
  const fromUrl = text.match(/[?&]predeck=([^&#\s]+)/)
  if (fromUrl) {
    try {
      text = decodeURIComponent(fromUrl[1])
    } catch (_e) {
      return { deck: null, error: '这条链接里的 predeck 参数解不开（URL 编码可能被截断）', warnings }
    }
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (_e) {
    return { deck: null, error: '不是合法的 JSON。请把整段内容（含首尾大括号）一起粘贴', warnings }
  }
  if (!raw || typeof raw !== 'object') return { deck: null, error: '内容不是一个 JSON 对象', warnings }
  const obj = raw as Record<string, unknown>
  const version = numOf(obj.version)
  if (version == null) warnings.push('这段数据没写 version，按 v4 解析')
  else if (version !== 4) warnings.push(`这段数据标的是 version ${version}，kuma 按 v4 解析，字段可能对不上`)

  const fleets: (DeckBuilderFleet | null)[] = []
  for (let f = 1; f <= MAX_FLEETS; f++) {
    const rawFleet = obj[`f${f}`]
    if (!rawFleet || typeof rawFleet !== 'object') {
      fleets.push(null)
      continue
    }
    const fleetObj = rawFleet as Record<string, unknown>
    const ships: (DeckBuilderShip | null)[] = []
    for (let s = 1; s <= MAX_SHIPS; s++) ships.push(parseShip(fleetObj[`s${s}`]))
    fleets.push(ships.some(Boolean) ? { ships } : null)
  }
  if (!fleets.some(Boolean)) {
    return { deck: null, error: '没读到任何舰队（f1–f4 都是空的）', warnings }
  }
  const hqLv = numOf(obj.hqlv)
  if (hqLv == null) warnings.push('没写司令部等级，相关加成的推算可能不准')
  return { deck: { hqLv: hqLv == null ? 0 : Math.round(hqLv), fleets }, error: null, warnings }
}

/** 编成里出现的全部舰娘图鉴 id（去重，按出现顺序） */
export const deckShipIds = (deck: DeckBuilderDeck): number[] => [
  ...new Set(deck.fleets.flatMap((f) => (f?.ships ?? []).flatMap((s) => (s ? [s.mstId] : [])))),
]

/** 编成里出现的全部装备图鉴 id（含增设格，去重） */
export const deckItemIds = (deck: DeckBuilderDeck): number[] => [
  ...new Set(
    deck.fleets.flatMap((f) =>
      (f?.ships ?? []).flatMap((s) =>
        s ? [...s.slots, s.exSlot].flatMap((i) => (i ? [i.mstId] : [])) : [],
      ),
    ),
  ),
]
