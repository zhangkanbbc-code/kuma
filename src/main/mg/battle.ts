// 铭 · 战斗报文回放。把 /kcsapi 战斗响应归一化成带真实阶段序的 BattleView：
// - 伤害/HP 采用 API 实测值，不做伤害公式预测；
// - 主力、护卫、友军均先规范化为各自 0-5，再映射到稳定的 0-11 视图索引；
// - 阶段顺序由战斗类型矩阵决定并写入 stage，显示层不得再次按固定权重重排；
// - 联合舰队雷击位置、夜转昼、友军、特殊攻击多舰归属和应急修理均在这里结算。
import type {
  AirCombatView,
  AirSpecialAttackView,
  BattleAttack,
  BattleDiscrepancy,
  BattleEquipmentView,
  BattleFlavorVoice,
  BattleSide,
  BattleShipView,
  BattleStageView,
  BattleView,
  RankPrediction,
} from '../../shared/mg-types'
import { requiredSunkForA } from '../../shared/battle-rank'
import { SPECIAL_ATTACK_SEGMENT_ORDER } from '../../shared/fleet-special-attack'

export interface FleetEquipmentContext {
  instanceId: number
  mstId: number
  slot: number | 'ex'
  planeCount: number | null
  planeCapacity: number | null
  level: number
  alv: number
}

export interface FleetShipContext {
  rosterId: number
  mstId: number
  name: string
  lv: number
  nowHp?: number
  maxHp?: number
  equipments?: FleetEquipmentContext[]
}

// 我方舰名、装备等上下文由 store 提供（避免 parser 依赖全局状态）
export interface FleetContext {
  // 必须保留空位；位置就是 API 舰位，不能先 filter 再压紧。
  fleetShips: (deckId: number) => (FleetShipContext | null)[]
  masterName: (mstId: number) => string
  masterMaxEq?: (mstId: number) => number[]
  combinedType?: () => number // 0 通常 / 1 空母机动 / 2 水上打击 / 3 输送护卫
}

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' ? v : fallback)
const positive = (v: unknown): v is number => typeof v === 'number' && v > 0
const hitStateFromCl = (
  cl: unknown,
  damage: number,
): NonNullable<BattleAttack['hits'][number]['hitState']> =>
  typeof cl === 'number' ? (cl === 0 ? 'miss' : 'hit') : damage > 0 ? 'hit' : 'unknown'
const leadingOffset = (values: any, invalid: (v: unknown) => boolean = (v) => num(v) < 0): number =>
  Array.isArray(values) && values.length > 0 && invalid(values[0]) ? 1 : 0

const flavorMessage = (value: unknown): string =>
  `${value ?? ''}`
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .trim()

// api_flavor_info 的**每一个字段都是字符串型**（本机账本 20/20 实测：
// api_type="4"、api_voice_id="605229710"、api_boss_ship_id="2297"）。
// 拿 === 跟数字比会静默失配，所以这里一律先转成文本再解析。
const parseFlavorVoices = (body: any): BattleFlavorVoice[] => {
  if (!Array.isArray(body?.api_flavor_info)) return []
  return body.api_flavor_info.flatMap((raw: any) => {
    const mstId = Number.parseInt(`${raw?.api_boss_ship_id ?? ''}`, 10)
    const voiceId = `${raw?.api_voice_id ?? ''}`.trim()
    const message = flavorMessage(raw?.api_message)
    if (!Number.isInteger(mstId) || mstId < 1_500 || !/^\d+$/.test(voiceId) || !message) return []
    // 舰型名（深海新鋭駆逐艦 这种）主数据里没有，只有这里给；台词框自带的标签
    // 也可能夹着 <br>，与台词同一条清洗规则过一遍再存。
    const className = flavorMessage(raw?.api_class_name)
    return [{
      mstId,
      voiceId,
      shipName: `${raw?.api_ship_name ?? ''}`.trim(),
      ...(className ? { className } : {}),
      message,
    }]
  })
}

interface BuiltFleet {
  ships: BattleShipView[]
  mainOffset: number
  escortOffset: number
}

const makeShip = (
  index: number,
  fleet: BattleShipView['fleet'],
  position: number,
  mstId: number,
  rosterId: number | null,
  name: string,
  lv: number,
  hp: number,
  maxHp: number,
  escaped: boolean,
  equipment?: BattleEquipmentView[],
): BattleShipView => ({
  index,
  fleet,
  position,
  mstId,
  rosterId,
  name,
  lv,
  hpStart: hp,
  hpEnd: hp,
  hpMax: maxHp,
  damageDealt: 0,
  sunk: false,
  defeated: false,
  escaped,
  repairItemUsed: null,
  equipment,
})

const pushFriendFleet = (
  out: BattleShipView[],
  nowhps: any,
  maxhps: any,
  deck: (FleetShipContext | null)[],
  base: number,
  limit: number,
): number => {
  if (!Array.isArray(nowhps)) return 0
  const hpOffset = leadingOffset(nowhps)
  const maxOffset = leadingOffset(maxhps)
  for (let raw = hpOffset; raw < nowhps.length; raw += 1) {
    const position = raw - hpOffset
    if (position >= limit) break
    const info = deck[position] ?? null
    const rawHp = num(nowhps[raw], -1)
    const rawMax = num(maxhps?.[position + maxOffset], -1)
    const escaped = rawHp < 0
    // 空位和退避都可能是 -1；有在籍实例才保留为“退避舰”，纯空位跳过。
    if (!info && rawHp < 0) continue
    const hp = escaped ? Math.max(0, info?.nowHp ?? 0) : Math.max(0, rawHp)
    const hpMax = rawMax > 0 ? rawMax : Math.max(1, info?.maxHp ?? hp)
    out.push(
      makeShip(
        base + position,
        base >= 6 ? 'escort' : 'main',
        position,
        info?.mstId ?? 0,
        info?.rosterId ?? null,
        info?.name ?? `僚舰${position + 1}`,
        info?.lv ?? 0,
        hp,
        hpMax,
        escaped,
        info?.equipments?.map((item) => ({
          ...item,
          planeSource: item.planeCount == null ? null : 'sortie',
        })),
      ),
    )
  }
  return hpOffset
}

const buildFriendShips = (body: any, deckId: number, ctx: FleetContext): BuiltFleet => {
  const ships: BattleShipView[] = []
  const combined = Array.isArray(body.api_f_nowhps_combined)
  const mainOffset = pushFriendFleet(
    ships,
    body.api_f_nowhps,
    body.api_f_maxhps,
    ctx.fleetShips(deckId),
    0,
    combined ? 6 : 7,
  )
  const escortOffset = combined
    ? pushFriendFleet(
        ships,
        body.api_f_nowhps_combined,
        body.api_f_maxhps_combined,
        ctx.fleetShips(2),
        6,
        6,
      )
    : 0
  return { ships, mainOffset, escortOffset }
}

const pushEnemyFleet = (
  out: BattleShipView[],
  kes: any,
  lvs: any,
  nowhps: any,
  maxhps: any,
  slots: any,
  base: number,
  ctx: FleetContext,
  fleet: BattleShipView['fleet'] = base >= 6 ? 'escort' : 'main',
): number => {
  if (!Array.isArray(kes)) return 0
  const shipOffset = leadingOffset(kes, (v) => !positive(v))
  const hpOffset = leadingOffset(nowhps)
  const maxOffset = leadingOffset(maxhps)
  const lvOffset = leadingOffset(lvs)
  const slotOffset =
    Array.isArray(slots) && slots.length > 0 && !Array.isArray(slots[0]) ? 1 : 0
  for (let raw = shipOffset; raw < kes.length; raw += 1) {
    const position = raw - shipOffset
    if (position >= 6) break
    const mstId = num(kes[raw], -1)
    if (mstId <= 0) continue
    const hp = Math.max(0, num(nowhps?.[position + hpOffset]))
    const hpMax = Math.max(1, num(maxhps?.[position + maxOffset], hp))
    const rawSlots = Array.isArray(slots?.[position + slotOffset])
      ? slots[position + slotOffset]
      : undefined
    const maxEq = ctx.masterMaxEq?.(mstId) ?? []
    const equipment: BattleEquipmentView[] | undefined = rawSlots?.flatMap(
      (rawMstId: unknown, slot: number) => {
        const itemMstId = num(rawMstId, -1)
        if (itemMstId <= 0) return []
        const capacity = Math.max(0, num(maxEq[slot]))
        return [{
          mstId: itemMstId,
          instanceId: null,
          slot,
          planeCount: capacity > 0 ? capacity : null,
          planeCapacity: capacity > 0 ? capacity : null,
          planeSource: capacity > 0 ? 'master' as const : null,
          level: 0,
          alv: 0,
        }]
      },
    )
    out.push(
      makeShip(
        base + position,
        fleet,
        position,
        mstId,
        null,
        ctx.masterName(mstId),
        num(lvs?.[position + lvOffset]),
        hp,
        hpMax,
        false,
        equipment,
      ),
    )
  }
  return shipOffset || hpOffset
}

const buildEnemyShips = (body: any, ctx: FleetContext): BuiltFleet => {
  const ships: BattleShipView[] = []
  const mainOffset = pushEnemyFleet(
    ships,
    body.api_ship_ke,
    body.api_ship_lv,
    body.api_e_nowhps,
    body.api_e_maxhps,
    body.api_eSlot,
    0,
    ctx,
  )
  const escortOffset = pushEnemyFleet(
    ships,
    body.api_ship_ke_combined,
    body.api_ship_lv_combined,
    body.api_e_nowhps_combined,
    body.api_e_maxhps_combined,
    body.api_eSlot_combined,
    6,
    ctx,
  )
  return { ships, mainOffset, escortOffset }
}

const buildNpcFriendShips = (
  body: any,
  ctx: FleetContext,
): { ships: BattleShipView[]; offset: number; productionType: number | null } => {
  const info = body?.api_friendly_info
  const ships: BattleShipView[] = []
  if (!info) return { ships, offset: 0, productionType: null }
  // 原值直传，不在这里翻译成档位名——语义只钉住了 2（见 mg-types 的 friendlyProductionType）
  const productionType = typeof info.api_production_type === 'number' ? info.api_production_type : null
  const offset = pushEnemyFleet(
    ships,
    info.api_ship_id,
    info.api_ship_lv,
    info.api_nowhps,
    info.api_maxhps,
    // 友军装备那一格的键名是**大写 S 的 api_Slot**（2026-08-26 21:09 本机账本实测），
    // 与敌方的 api_eSlot / 我方的 api_slot 都不同名。小写那个一直取不到东西，
    // 友军舰的装备整列是空的。两种拼法都收，旧报文若真用小写也不丢。
    info.api_Slot ?? info.api_slot,
    0,
    ctx,
    'friend',
  )
  return { ships, offset, productionType }
}

// ---- 伤害应用与规范化索引 ----

interface Sim {
  f: BattleShipView[]
  e: BattleShipView[]
  friend: BattleShipView[]
  attacks: BattleAttack[]
  stages: BattleStageView[]
  hpFloor: number
  nextStage: number
  nextAction: number
  offsets: {
    fMain: number
    fEscort: number
    eMain: number
    eEscort: number
    friend: number
  }
  activeDeck: [number, number] | null
  repairItems: Map<number, { instanceId: number; mstId: number }[]>
}

const shipList = (sim: Sim, side: BattleSide): BattleShipView[] =>
  side === 0 ? sim.f : side === 1 ? sim.e : sim.friend

const shipAt = (side: BattleShipView[], index: number) => side.find((s) => s.index === index)

const sideOffsets = (sim: Sim, side: BattleSide): [number, number] => {
  if (side === 0) return [sim.offsets.fMain, sim.offsets.fEscort]
  if (side === 1) return [sim.offsets.eMain, sim.offsets.eEscort]
  return [sim.offsets.friend, 0]
}

const normalizeIndex = (sim: Sim, side: BattleSide, raw: number): number => {
  if (raw < 0) return raw
  const [mainOffset, escortOffset] = sideOffsets(sim, side)
  if (side === 2) return raw - mainOffset
  // 两支舰队都带相同前导占位时，扁平索引整体只需减一次。
  if (mainOffset === escortOffset) return raw - mainOffset
  const rawEscortBase = 6 + escortOffset
  return raw >= rawEscortBase ? 6 + (raw - rawEscortBase) : raw - mainOffset
}

/**
 * 夜战舰位换算：`api_active_deck` 说的是这一场夜战由主力（1）还是护卫（2）出阵，
 * 报文里的舰位按那支队伍算，要还原成 0-11 的视图舰位。
 *
 * **友军夜战段不走这一步**——它的舰位本来就是贯穿敌方联合两队的绝对下标。
 * 判据是同一份 `api_friendly_battle.api_hougeki` 里的装备指纹（2026-08-26 21:09
 * 本机账本，敌联合 + 强友军）：`api_si_list[1] = [1644,1644]` 只在
 * `api_eSlot_combined[0]` 里有（护卫 #0 = 绝对 6），而 `api_si_list[5] = [1581,1583]`
 * 只在 `api_eSlot[1]` 里有（主力 #1）——同一段里 6 与 1 各自对上各自的队，
 * 绝对下标坐实。那一场 `api_active_deck = [2,1]`，照 deck=1 换算的话
 * 「≥6 减 6」会把友军打向护卫 #2（绝对 8）的 159 伤挪到早已沉没的主力 #2 头上，
 * 敌方反击的攻击舰 6 也会被记成主力 #0。用户实报的「友军伤害没反馈在血条上」
 * 就是这么丢的：伤害确实结算了，只是落进了一具尸体。
 *
 * 主力/护卫两队谁在夜战出阵，对友军段没有意义——友军是替我方去清敌护卫的，
 * 它打的那支队伍与我方夜战接敌的那支本来就不是同一个问题。
 */
const activeDeckIndex = (
  sim: Sim,
  side: BattleSide,
  index: number,
  deckRelative: boolean,
): number => {
  if (!deckRelative || side === 2 || !sim.activeDeck) return index
  if (!shipList(sim, side).some((ship) => ship.fleet === 'escort')) return index
  const deck = side === 0 ? sim.activeDeck[0] : sim.activeDeck[1]
  if (deck === 2 && index >= 0 && index < 6) return index + 6
  if (deck === 1 && index >= 6) return index - 6
  return index
}

const targetSideOf = (attackerSide: BattleSide): BattleSide => (attackerSide === 1 ? 0 : 1)

const fleetSpan = (sim: Sim, side: BattleSide): number => {
  if (side === 2) return 6
  const ships = shipList(sim, side)
  if (ships.some((ship) => ship.fleet === 'escort')) return 12
  return Math.max(6, ...ships.map((ship) => ship.index + 1))
}

// 支援炮击的旧数组用长度 7/13 表示前导占位 0；按舰队槽位数识别，不能只看首值正负。
const combatArrayOffset = (sim: Sim, side: BattleSide, values: any): number =>
  Array.isArray(values) && values.length === fleetSpan(sim, side) + 1 ? 1 : 0

// 当前雷击数组固定预留第 7 槽：普通六舰队也是 7 项，但第 0 项仍是第一舰，
// 多出来的是末尾槽，不能按「长度 = 舰数 + 1」误判为前导占位。
// 只有同一报文的 HP 舰表本身带前导占位时，雷击数组才沿用该偏移。
const torpedoArrayOffset = (sim: Sim, side: BattleSide): number => {
  if (side === 2) return 0
  const [mainOffset] = sideOffsets(sim, side)
  return mainOffset
}

// stage3 数组下标 → 舰位置。主力段（base 0）与护卫段（base 6）各减自己的前导占位，
// 落在占位格上返回 -1。**承伤数组与 api_*_sp_list 共用这一份**——两处各算一遍
// 迟早会漂，联合舰队的护卫段尤其容易错。
const stage3Position = (sim: Sim, side: BattleSide, base: number, i: number): number => {
  const [mainOffset, escortOffset] = sideOffsets(sim, side)
  const offset = base >= 6 ? escortOffset : mainOffset
  return i < offset ? -1 : base + i - offset
}

const nextAction = (sim: Sim): number => sim.nextAction++

const addStage = (
  sim: Sim,
  phase: BattleAttack['phase'],
  label: string,
  source: string,
  air: AirCombatView | null = null,
  simultaneous = false,
): number => {
  const order = sim.nextStage++
  sim.stages.push({ order, phase, label, source, simultaneous, air })
  return order
}

// 応急修理（要員 42 / 女神 43）的发动结算。
//
// **一舰一场只发动一枚**——wikiwiki「応急修理要員」：
// 「1艦娘が1戦闘中に複数消費することは無い」。
// **发动过之后本场不再被轰沈判定**——同页：
// 「ダメコンによって復活した戦闘は、戦闘開始時は大破でなかったものと同じ扱いに
// なるため、その戦闘中に再度轟沈することは無い」。
//
// 这两条不是并列的两条规则，是同一个机制的因和果：发动的那一刻这艘舰拿到轰沈保护，
// 于是本场再也压不到 0——压不到 0，就轮不到第二枚。所以交界处没有矛盾可言：
// 「不再轰沈」在前，「不消耗第二枚」是它的推论。发动过的舰再挨致死伤害时，
// 既不沉、也不吃第二枚，那一击按不致死结算（削伤害见 applyHit）。
//
// 交叉验证（两个独立实现，结论一致）：
// - KC3Kai BattlePrediction.js `Ship.takeDamage` 第一句就是
//   `if (ship.dameConConsumed && ship.hp - damage <= 0) { return ship; }`；
// - KC3Kai/kancolle-replay kcsim.js `takeDamage`：取出道具之后
//   `if (ship.side==0) ship.protection = true`，而 protection 直到本节点战斗
//   结算（results 那段）才复位——可见「一场」含昼战 + 夜战，与本文件一致。
//
// 「一场」在本文件里就是一个 BattleView：昼战 parseBattle 与夜战 mergeNight
// 共用同一批 BattleShipView 对象，所以 `repairItemUsed` 本身即「本场已发动」的
// 标记，不必另立一套舰位集合；下一个点是新的 parseBattle，标记自然归零。
const useRepairItem = (sim: Sim, ship: BattleShipView): number | null => {
  if (ship.rosterId == null || ship.hpEnd > 0) return null
  // 本场已经发动过：第二枚不消耗。正常情况下 applyHit 的保护已经让她压不到 0，
  // 走不到这里；这一句是把规则写在它该在的地方，也兜住将来新增的调用点。
  if (ship.repairItemUsed != null) return null
  const items = sim.repairItems.get(ship.index) ?? []
  const at = items.findIndex((item) => item.mstId === 42 || item.mstId === 43)
  if (at < 0) return null
  const [item] = items.splice(at, 1)
  ship.repairItemUsed = item.mstId
  // 要員回最大耐久的两成、女神回满，**没有旗舰特例**。
  // wikiwiki 那句「50％程度まで耐久値を回復し、中破状態に戻る」挂在
  // 「旗艦装備時の効果」小节下，说的是旗舰大破时玩家选进击、
  // 「進撃後最初の戦闘開始時」被消耗掉的那一枚——那是开战之前的事，
  // 落到报文里已经体现在 hpStart 上，不归这一层结算。
  // 战斗中归零发动这一路，两个独立实现都是两成：
  // KC3Kai `Math.floor(ship.maxHp * 0.2)`、
  // kancolle-replay kcsim.js `if (repair == 42) ship.HP = Math.floor(.2*ship.maxHP)`；
  // 女神两边也都是回满（kcsim 另外把燃弹补满，那是补给不是血量）。
  ship.hpEnd = item.mstId === 43 ? ship.hpMax : Math.max(1, Math.floor(ship.hpMax / 5))
  ship.sunk = false
  ship.defeated = false
  return item.mstId
}

const applyHit = (
  sim: Sim,
  targetSide: BattleSide,
  target: number,
  rawDamage: number,
  attackerSide: BattleSide,
  attacker: number,
): { damage: number; protect: boolean; sunk: boolean; repairItem: number | null } => {
  let damage = Math.max(0, Math.floor(rawDamage))
  const protect = rawDamage > 0 && Math.abs(rawDamage % 1) > 0.05
  const ship = shipAt(shipList(sim, targetSide), target)
  let sunk = false
  let repairItem: number | null = null
  if (ship && !ship.escaped) {
    const before = ship.hpEnd
    // 本场发动过应急修理的舰带着轰沈保护（见 useRepairItem 上面的规则出处）：
    // 这一击不许把她打到 0，于是下面的 defeated/sunk/第二枚全都自然不成立。
    //
    // 真实报文其实走不到这里——保护是服务端做的，致死伤害发过来时已经被削过，
    // 削过的标志就是上面那条小数尾巴（protect），floor 之后本就压不到 0。
    // 这一句兜的是解析层自己与游戏血量对不齐的情况：宁可少判一次沉，不凭空判沉。
    //
    // 削成「刚好留 1」而不是整击作废，是为了让 hits[].damage、ship.hpEnd 和
    // 攻击方 damageDealt 三者继续自洽——血条时间轴是照 hits[].damage 重放的
    //（shared/battle-hp-timeline.ts），作废整击会让重放对不上 hpEnd。
    // kcsim.js 同一处也是削伤害而不是作废（血量已是 1 时直接削成 0）。
    if (ship.repairItemUsed != null && damage > 0 && before - damage <= 0) {
      damage = Math.max(0, before - 1)
    }
    ship.hpEnd = Math.max(sim.hpFloor, before - damage)
    // 演习画面固定保留 1 HP，但“伤害刚好打到 1”和“实际越过 0、仅显示 1”
    // 是两种内部状态；击破线始终是 before - damage <= 0，不能拿显示下限 1 代替。
    const defeated = damage > 0 && before > 0 && before - damage <= 0
    if (defeated) ship.defeated = true
    // hpFloor 是演习等场景的血量显示下限，不是死亡线；真正击沉只认 0 HP。
    sunk = damage > 0 && before > 0 && ship.hpEnd <= 0
    // 击沉是累积状态；后续 overkill 不能把先前的击沉覆盖回 false。
    if (sunk) ship.sunk = true
    if (targetSide === 0 && sim.hpFloor === 0 && sunk) {
      repairItem = useRepairItem(sim, ship)
      if (repairItem) sunk = false
    }
  }
  if (attacker >= 0) {
    const atk = shipAt(shipList(sim, attackerSide), attacker)
    if (atk) atk.damageDealt += damage
  }
  return { damage, protect, sunk, repairItem }
}

// 特殊攻击中每一击的实际攻击舰偏移。没有表的 CI 仍按单舰多击处理。
// 表本身住在 shared/fleet-special-attack.ts：显示层要照同一份把摊开的段收回一组。
const MULTI_ATTACK_ORDER = SPECIAL_ATTACK_SEGMENT_ORDER

interface AttackStageOptions {
  phase: BattleAttack['phase']
  label: string
  source: string
  ciKind: 'day' | 'night'
  sideOverride?: BattleSide
  night?: boolean
}

const resolveHougekiSide = (
  h: any,
  i: number,
  firstTarget: number,
  sideOverride?: BattleSide,
): { side: BattleSide; legacyShift: number } => {
  if (sideOverride === 2) {
    // 友军夜战段里敌我双方都会出手：eflag=1 是深海反击友军，不能一股脑记成友军侧，
    // 否则敌方那几击会落到敌舰血量上（友军舰永远不掉血、敌舰凭空受创）。
    if (Array.isArray(h.api_at_eflag)) {
      return { side: h.api_at_eflag[i] === 1 ? 1 : 2, legacyShift: 0 }
    }
    return { side: 2, legacyShift: 0 }
  }
  if (sideOverride != null) return { side: sideOverride, legacyShift: 0 }
  if (Array.isArray(h.api_at_eflag)) return { side: h.api_at_eflag[i] === 1 ? 1 : 0, legacyShift: 0 }
  // 旧报文没有 eflag：敌我 HP 位于同一套 1 基数组，目标在我方主力范围内即敌攻。
  const mainRange = 6
  return { side: firstTarget < mainRange ? 1 : 0, legacyShift: mainRange }
}

/**
 * `api_hougeki.api_n_mother_list`：这一击是**空母夜间攻击**（舰载机打的，不是主炮）。
 *
 * 三处容易写错，逐条钉住：
 *
 * 1. **判 `== 1`。** EO 判的是 `== -1`，那是错的：2017-09-30 那次提交里 `.Skip(1)`
 *    与 `== -1` 是配套的（跳过 1 基点补位，所以判 -1 说得通），2017-11-19 去掉了
 *    `.Skip(1)` 却忘了改判定，此后四个文件一路抄到今天——它甚至跟自己仓里的
 *    `kcmemo.md` 自相矛盾，那行白纸黑字写着「空母夜間攻撃フラグ（== 1 なら true）」。
 * 2. **它按「攻击次序」排，不是按舰位。** 与 `api_at_list` / `api_at_eflag` 等长
 *    （本账本 8/8、7/7 逐条核过），所以直接用同一个下标 `i` 取，不做任何位置换算。
 * 3. **旧格式下标 0 的 `-1` 是补位不是码值。** 判 `== 1` 天然躲开它；而且同下标的
 *    `api_at_list[0]` 也是 -1、上面已经 `return` 掉了，两条防线都在。
 *
 * 发动方是敌是我由同一条记录的 `side`（`api_at_eflag`）决定：本账本 4 次亮灯
 * **全是对方的航母**（三次深海、一次演习对手的龍鳳改二戊），自己的航母一次都没触发过。
 * 所以这里只标「这一击是舰载机打的」，不替它定边。
 */
const isCarrierNightAttack = (h: any, i: number): boolean =>
  Array.isArray(h?.api_n_mother_list) && h.api_n_mother_list[i] === 1

const applyHougeki = (sim: Sim, h: any, options: AttackStageOptions) => {
  if (!h) return
  const stage = addStage(sim, options.phase, options.label, options.source)
  if (!Array.isArray(h.api_at_list)) return
  // 这一段的舰位要不要按 api_active_deck 换算。友军夜战段一律不换（见 activeDeckIndex 头注）。
  const deckRelative = !!options.night && options.sideOverride !== 2
  h.api_at_list.forEach((rawAttackerValue: any, i: number) => {
    let rawAttacker = num(rawAttackerValue, -1)
    if (rawAttacker < 0) return
    const dfs: any[] = Array.isArray(h.api_df_list?.[i]) ? h.api_df_list[i] : []
    const dmgs: any[] = Array.isArray(h.api_damage?.[i]) ? h.api_damage[i] : []
    const cls: any[] = Array.isArray(h.api_cl_list?.[i]) ? h.api_cl_list[i] : []
    const ciRaw = options.ciKind === 'night' ? h.api_sp_list?.[i] : h.api_at_type?.[i]
    const ci = typeof ciRaw === 'number' && ciRaw > 0 ? ciRaw : null
    const equipmentMstIds = Array.isArray(h.api_si_list?.[i])
      ? h.api_si_list[i].map(Number).filter((id: number) => id > 0)
      : []
    const carrierNight = isCarrierNightAttack(h, i)
    const { side, legacyShift } = resolveHougekiSide(h, i, num(dfs[0], -1), options.sideOverride)
    // 友军夜战段我方全程旁观：友军打敌、敌反击友军，两个方向都不涉及我方舰队
    const targetSide: BattleSide =
      options.sideOverride === 2 ? (side === 2 ? 1 : 2) : targetSideOf(side)
    if (legacyShift && rawAttacker >= legacyShift) rawAttacker -= legacyShift
    const multiOrder = ci != null ? MULTI_ATTACK_ORDER[ci] : undefined

    if (multiOrder) {
      dmgs.forEach((raw: any, j: number) => {
        let rawTarget = num(dfs[j], -1)
        if (rawTarget < 0) return
        if (legacyShift && rawTarget >= legacyShift) rawTarget -= legacyShift
        const attacker = activeDeckIndex(
          sim,
          side,
          normalizeIndex(sim, side, rawAttacker + (multiOrder[j] ?? 0)),
          deckRelative,
        )
        const target = activeDeckIndex(
          sim,
          targetSide,
          normalizeIndex(sim, targetSide, rawTarget),
          deckRelative,
        )
        const hit = applyHit(sim, targetSide, target, num(raw), side, attacker)
        const hitState = hitStateFromCl(cls[j], hit.damage)
        sim.attacks.push({
          phase: options.phase,
          side,
          attacker,
          ciType: ci,
          ciKind: options.ciKind,
          stage,
          action: nextAction(sim),
          stageLabel: options.label,
          source: options.source,
          simultaneous: false,
          equipmentMstIds: equipmentMstIds.length ? equipmentMstIds : undefined,
          ...(carrierNight ? { carrierNightAttack: true as const } : {}),
          hits: [
            {
              target,
              damage: hit.damage,
              critical: cls[j] === 2,
              hitState,
              miss: hitState === 'miss',
              protect: hit.protect,
              sunk: hit.sunk,
              repairItem: hit.repairItem,
            },
          ],
        })
      })
      return
    }

    const attacker = activeDeckIndex(
      sim,
      side,
      normalizeIndex(sim, side, rawAttacker),
      deckRelative,
    )
    const attack: BattleAttack = {
      phase: options.phase,
      side,
      attacker,
      ciType: ci,
      ciKind: options.ciKind,
      stage,
      action: nextAction(sim),
      stageLabel: options.label,
      source: options.source,
      simultaneous: false,
      equipmentMstIds: equipmentMstIds.length ? equipmentMstIds : undefined,
      ...(carrierNight ? { carrierNightAttack: true as const } : {}),
      hits: [],
    }
    dmgs.forEach((raw: any, j: number) => {
      let rawTarget = num(dfs[j], -1)
      if (rawTarget < 0) return
      if (legacyShift && rawTarget >= legacyShift) rawTarget -= legacyShift
      const target = activeDeckIndex(
        sim,
        targetSide,
        normalizeIndex(sim, targetSide, rawTarget),
        deckRelative,
      )
      const hit = applyHit(sim, targetSide, target, num(raw), side, attacker)
      const hitState = hitStateFromCl(cls[j], hit.damage)
      attack.hits.push({
        target,
        damage: hit.damage,
        critical: cls[j] === 2,
        hitState,
        miss: hitState === 'miss',
        protect: hit.protect,
        sunk: hit.sunk,
        repairItem: hit.repairItem,
      })
    })
    if (attack.hits.length) sim.attacks.push(attack)
  })
}

const applyRaigekiAtStage = (
  sim: Sim,
  r: any,
  phase: BattleAttack['phase'],
  label: string,
  source: string,
  stage: number,
) => {
  const applySide = (rai: any, ydam: any, cl: any, side: 0 | 1) => {
    if (!Array.isArray(rai)) return
    const targetSide: BattleSide = side === 0 ? 1 : 0
    const attackerOffset = torpedoArrayOffset(sim, side)
    rai.forEach((rawTargetValue: any, rawAttacker: number) => {
      if (rawAttacker < attackerOffset) return
      const rawTarget = num(rawTargetValue, -1)
      if (rawTarget < 0) return
      const attacker = normalizeIndex(sim, side, rawAttacker)
      const target = normalizeIndex(sim, targetSide, rawTarget)
      const hit = applyHit(sim, targetSide, target, num(ydam?.[rawAttacker]), side, attacker)
      const hitState = hitStateFromCl(cl?.[rawAttacker], hit.damage)
      sim.attacks.push({
        phase,
        side,
        attacker,
        ciType: null,
        ciKind: null,
        stage,
        action: nextAction(sim),
        stageLabel: label,
        source,
        simultaneous: true,
        hits: [
          {
            target,
            damage: hit.damage,
            critical: num(cl?.[rawAttacker]) === 2,
            hitState,
            miss: hitState === 'miss',
            protect: hit.protect,
            sunk: hit.sunk,
            repairItem: hit.repairItem,
          },
        ],
      })
    })
  }
  applySide(r.api_frai, r.api_fydam, r.api_fcl, 0)
  applySide(r.api_erai, r.api_eydam, r.api_ecl, 1)
}

const applyRaigeki = (
  sim: Sim,
  r: any,
  phase: BattleAttack['phase'],
  label: string,
  source: string,
) => {
  if (!r) return
  const stage = addStage(sim, phase, label, source, null, true)
  applyRaigekiAtStage(sim, r, phase, label, source, stage)
}

const applyOpeningTorp = (sim: Sim, o: any, label = '开幕雷击', source = 'api_opening_atack') => {
  if (!o) return
  const stage = addStage(sim, 'openingTorp', label, source, null, true)
  if (!Array.isArray(o.api_frai_list_items) && !Array.isArray(o.api_erai_list_items)) {
    applyRaigekiAtStage(sim, o, 'openingTorp', label, source, stage)
    return
  }
  const applySide = (raiItems: any, ydamItems: any, clItems: any, side: 0 | 1) => {
    if (!Array.isArray(raiItems)) return
    const targetSide: BattleSide = side === 0 ? 1 : 0
    // *_list_items 是当前 0 基格式，数组位置就是攻击舰位置；普通六舰队也会给 7 项。
    const attackerOffset = 0
    raiItems.forEach((targets: any, rawAttacker: number) => {
      if (rawAttacker < attackerOffset) return
      if (!Array.isArray(targets)) return
      const attacker = normalizeIndex(sim, side, rawAttacker - attackerOffset)
      const attack: BattleAttack = {
        phase: 'openingTorp',
        side,
        attacker,
        ciType: null,
        ciKind: null,
        stage,
        action: nextAction(sim),
        stageLabel: label,
        source,
        simultaneous: true,
        hits: [],
      }
      targets.forEach((rawTargetValue: any, j: number) => {
        const rawTarget = num(rawTargetValue, -1)
        if (rawTarget < 0) return
        const target = normalizeIndex(sim, targetSide, rawTarget)
        const raw = num(ydamItems?.[rawAttacker]?.[j])
        const hit = applyHit(sim, targetSide, target, raw, side, attacker)
        const rawCl = clItems?.[rawAttacker]?.[j]
        const hitState = hitStateFromCl(rawCl, hit.damage)
        attack.hits.push({
          target,
          damage: hit.damage,
          critical: rawCl === 2,
          hitState,
          miss: hitState === 'miss',
          protect: hit.protect,
          sunk: hit.sunk,
          repairItem: hit.repairItem,
        })
      })
      if (attack.hits.length) sim.attacks.push(attack)
    })
  }
  applySide(o.api_frai_list_items, o.api_fydam_list_items, o.api_fcl_list_items, 0)
  applySide(o.api_erai_list_items, o.api_eydam_list_items, o.api_ecl_list_items, 1)
}

// 航空 stage3：只有承伤数组，无逐舰攻击者。
const applyStage3 = (
  sim: Sim,
  s3: any,
  phase: BattleAttack['phase'],
  label: string,
  source: string,
  stage: number,
  base: number,
  attackerOverride?: BattleSide,
) => {
  if (!s3) return
  const applySide = (
    dam: any,
    cl: any,
    bak: any,
    rai: any,
    targetSide: 0 | 1,
  ) => {
    if (!Array.isArray(dam)) return
    // NPC 友军航空只打敌方；不把不存在的“友军承伤”映到我方。
    if (attackerOverride === 2 && targetSide === 0) return
    const attackerSide: BattleSide = attackerOverride ?? (targetSide === 0 ? 1 : 0)
    const attack: BattleAttack = {
      phase,
      side: attackerSide,
      attacker: -1,
      ciType: null,
      ciKind: null,
      stage,
      action: nextAction(sim),
      stageLabel: label,
      source,
      simultaneous: false,
      hits: [],
    }
    dam.forEach((raw: any, i: number) => {
      if (num(raw, -1) < 0) return
      const targeted =
        num(raw) > 0 ||
        num(cl?.[i], 0) > 0 ||
        num(bak?.[i], 0) > 0 ||
        num(rai?.[i], 0) > 0
      if (!targeted) return
      const target = stage3Position(sim, targetSide, base, i)
      if (target < 0) return
      const hit = applyHit(sim, targetSide, target, num(raw), attackerSide, -1)
      attack.hits.push({
        target,
        damage: hit.damage,
        // 航空 api_*cl_flag 的 1 表示暴击，与炮击 cl_list 不同。
        critical: num(cl?.[i]) === 1,
        // stage3 没有逐击命中判定；正伤害可确认命中，零伤只能标为未知。
        hitState: hit.damage > 0 ? 'hit' : 'unknown',
        miss: false,
        protect: hit.protect,
        sunk: hit.sunk,
        repairItem: hit.repairItem,
      })
    })
    if (attack.hits.length) sim.attacks.push(attack)
  }
  applySide(s3.api_fdam, s3.api_fcl_flag, s3.api_fbak_flag, s3.api_frai_flag, 0)
  applySide(s3.api_edam, s3.api_ecl_flag, s3.api_ebak_flag, s3.api_erai_flag, 1)
}

/**
 * 航空 stage3 的 api_f_sp_list / api_e_sp_list：把「这一格挨了哪种特殊投弹」收成舰位表。
 *
 * **它不是対空噴進弾幕。** 这条曾被当成弹幕接线，四票推翻，证据链记在这里防止改回去：
 *
 * 1. **游戏客户端本体**（main.js 反混淆）：`AirWarStage3Model` 里
 *    `SP_ATTACK_TYPE = { BOUNCE_BOM: 1 }`——整份文件里这个枚举只有这一个成员；
 *    唯一消费点 `getBounce(i)` 拿 `arr[i].indexOf(BOUNCE_BOM) > -1` 判定，
 *    **i 是被打的那条舰**。2022-05-27 实装。
 * 2. **字段说明（apilist）**：「味方喰らった特殊攻撃種類」——「喰らった」＝挨的，
 *    并注明与同格的 bak_flag 同时立。
 * 3. **KC3Kai**：读取点就在 bak_flag 分支里，按承伤方下标取。
 * 4. **本机账本实测**：三次亮灯逐条对过——亮的格 3/3 正好是 bak_flag 立着的那格；
 *    而三场里唯一带 12cm30連装噴進砲改二 的舰（瑞鳳改二乙）**一次都没对上**；
 *    三场敌方旗舰都挂着深海艤装水上汎用襲撃機（反跳爆撃机），全队仅此一件。
 *
 * 対空噴進弾幕在报文里**根本没有字段**（客户端是按装备算出的对空特效类型 + 该舰零伤
 * 本地推演动画的），所以别再拿这一格去标弹幕，也别在这里推演弹幕。
 *
 * 下标与同一段的承伤数组对齐，所以位置换算直接走 `stage3Position`，
 * 护卫段（stage3_combined）自然落到 6-11。
 *
 * 两个形态上的坑：这对数组**用 null 补位**（同段其它 stage3 数组补的是 0），
 * 每格是「null 或种类号数组」而不是平铺 0/1——照平铺读一次都读不出来，故逐格容忍。
 *
 * 要求同格 bak_flag 也立着：字段说明里这两者本来就是同时立的，而它另有一个
 * 「本不该存在的一侧也会冒出这个数组」的已知毛病（空袭一类只有一侧会挨打的场合）——
 * 拿这条同时性当闸门，正好把那种幽灵格静默挡在屏幕外，既不报错也不上屏。
 */
const toSpecialAttacks = (
  sim: Sim,
  kouku: any,
  side: 0 | 1,
  attackerOverride?: BattleSide,
): AirSpecialAttackView[] => {
  // NPC 友军航空只打敌方；这一段的 f 侧不是我方舰队，别把它映到我方舰位上。
  if (attackerOverride === 2 && side === 0) return []
  const key = side === 0 ? 'api_f_sp_list' : 'api_e_sp_list'
  const bakKey = side === 0 ? 'api_fbak_flag' : 'api_ebak_flag'
  const out: AirSpecialAttackView[] = []
  for (const [s3, base] of [
    [kouku.api_stage3, 0],
    [kouku.api_stage3_combined, 6],
  ] as const) {
    const list = s3?.[key]
    if (!Array.isArray(list)) continue
    const bak = s3?.[bakKey]
    list.forEach((raw: any, i: number) => {
      if (!Array.isArray(raw)) return
      const kinds = raw.map((v: any) => num(v, -1)).filter((v: number) => v > 0)
      if (!kinds.length) return
      if (num(bak?.[i], 0) <= 0) return
      const pos = stage3Position(sim, side, base, i)
      if (pos < 0) return
      out.push({ pos, kinds })
    })
  }
  return out
}

const toAirView = (
  sim: Sim,
  kouku: any,
  attackerOverride?: BattleSide,
): AirCombatView | null => {
  if (!kouku || !kouku.api_stage1) return null
  const s1 = kouku.api_stage1
  const s2 = kouku.api_stage2
  const airFire = s2?.api_air_fire
  // 对空 CI 实际用掉的装备。种别号只说是第几种，这一列才说是哪几件打出来的。
  // 只做「取正整数」这一层清洗：**种别号已经排到 53 还在涨**（本账本就见过
  // 1/2/3/5/8/9/37/41/45/47），装备表同理会长，所以这里不设任何上界、也不查表校验，
  // 认不出的照原值透出，交给显示端「认识的翻译、不认识的原样显示」。
  const cutinItems = Array.isArray(airFire?.api_use_items)
    ? airFire.api_use_items.map((v: unknown) => num(v, -1)).filter((v: number) => v > 0)
    : []
  const fCount2 = num(s2?.api_f_count)
  const eCount2 = num(s2?.api_e_count)
  const spF = toSpecialAttacks(sim, kouku, 0, attackerOverride)
  const spE = toSpecialAttacks(sim, kouku, 1, attackerOverride)
  return {
    seiku: typeof s1.api_disp_seiku === 'number' ? s1.api_disp_seiku : null,
    fCount: num(s1.api_f_count),
    fLost: num(s1.api_f_lostcount),
    eCount: num(s1.api_e_count),
    eLost: num(s1.api_e_lostcount),
    fLost2: num(s2?.api_f_lostcount),
    eLost2: num(s2?.api_e_lostcount),
    touchF: num(s1.api_touch_plane?.[0], -1),
    touchE: num(s1.api_touch_plane?.[1], -1),
    aaCutinIdx: airFire ? num(airFire.api_idx, -1) : null,
    aaCutinKind: airFire ? num(airFire.api_kind, -1) : null,
    // 下面几个一律「没亮就整个不写这个键」：旧快照本来就没有，缺省即「没有」，
    // 快照里也不必为每一波航空战多存一堆零和空数组。
    ...(cutinItems.length ? { aaCutinItems: cutinItems } : {}),
    ...(fCount2 > 0 ? { fCount2 } : {}),
    ...(eCount2 > 0 ? { eCount2 } : {}),
    ...(spF.length ? { spAttackF: spF } : {}),
    ...(spE.length ? { spAttackE: spE } : {}),
  }
}

const applyKoukuAtStage = (
  sim: Sim,
  kouku: any,
  phase: BattleAttack['phase'],
  label: string,
  source: string,
  stage: number,
  attackerOverride?: BattleSide,
) => {
  if (!kouku) return
  applyStage3(sim, kouku.api_stage3, phase, label, source, stage, 0, attackerOverride)
  applyStage3(sim, kouku.api_stage3_combined, phase, label, source, stage, 6, attackerOverride)
}

const applyKouku = (
  sim: Sim,
  kouku: any,
  phase: BattleAttack['phase'],
  label: string,
  source: string,
  attackerOverride?: BattleSide,
) => {
  if (!kouku) return
  const stage = addStage(sim, phase, label, source, toAirView(sim, kouku, attackerOverride))
  const squadronPlanes = Array.isArray(kouku.api_squadron_plane)
    ? kouku.api_squadron_plane.flatMap((raw: any) => {
        const mstId = num(raw?.api_mst_id)
        return mstId > 0 ? [{ mstId, count: Math.max(0, num(raw?.api_count)) }] : []
      })
    : []
  // 这一波是第几基地出的。不设上界校验（基地数是会长的），只要是正整数就照收。
  const baseId = num(kouku.api_base_id)
  const view =
    squadronPlanes.length || baseId > 0
      ? sim.stages.find((item) => item.order === stage)
      : undefined
  if (view) {
    if (squadronPlanes.length) view.squadronPlanes = squadronPlanes
    if (baseId > 0) view.airBaseId = baseId
  }
  applyKoukuAtStage(sim, kouku, phase, label, source, stage, attackerOverride)
}

const asWaves = (v: any): any[] => (Array.isArray(v) ? v : v ? [v] : [])

const applySupport = (sim: Sim, info: any, label: string, source: string) => {
  if (!info) return
  const air = info.api_support_airatack
  const stage = addStage(sim, 'support', label, source, toAirView(sim, air))
  const hourai = info.api_support_hourai
  // 打支援的是第几舰队、由哪几条舰组成。伤害数字旁边点得出名字，这一段才不是匿名的。
  // 支援舰队的编成**不在我方战斗舰表里**（它不参战、没有 HP 行），所以只能存 mstId，
  // 不能像别处那样按舰位去查——真去查会取到本队同位置的另一条舰。
  const supportDeckId = num(hourai?.api_deck_id)
  const supportShips = Array.isArray(hourai?.api_ship_id)
    ? hourai.api_ship_id.map((v: unknown) => num(v, -1)).filter((v: number) => v > 0)
    : []
  if (supportDeckId > 0 || supportShips.length) {
    const view = sim.stages.find((item) => item.order === stage)
    if (view) view.support = { deckId: supportDeckId, shipMstIds: supportShips }
  }
  if (hourai && Array.isArray(hourai.api_damage)) {
    const attack: BattleAttack = {
      phase: 'support',
      side: 0,
      attacker: -1,
      ciType: null,
      ciKind: null,
      stage,
      action: nextAction(sim),
      stageLabel: label,
      source,
      simultaneous: false,
      hits: [],
    }
    const offset = combatArrayOffset(sim, 1, hourai.api_damage)
    hourai.api_damage.forEach((raw: any, i: number) => {
      if (i < offset || num(raw) <= 0) return
      const target = i - offset
      const hit = applyHit(sim, 1, target, num(raw), 0, -1)
      attack.hits.push({
        target,
        damage: hit.damage,
        critical: num(hourai.api_cl_list?.[i]) === 2,
        hitState: 'hit',
        miss: false,
        protect: hit.protect,
        sunk: hit.sunk,
        repairItem: hit.repairItem,
      })
    })
    if (attack.hits.length) sim.attacks.push(attack)
  }
  applyKoukuAtStage(sim, air, 'support', label, source, stage)
}

const repairItemsFor = (
  ctx: FleetContext,
  deckId: number,
  combined: boolean,
): Map<number, { instanceId: number; mstId: number }[]> => {
  const result = new Map<number, { instanceId: number; mstId: number }[]>()
  const add = (deck: (FleetShipContext | null)[], base: number, limit: number) => {
    deck.forEach((ship, position) => {
      if (!ship || position >= limit) return
      const items = (ship.equipments ?? []).filter((item) => item.mstId === 42 || item.mstId === 43)
      if (items.length) result.set(base + position, items.map((item) => ({ ...item })))
    })
  }
  add(ctx.fleetShips(deckId), 0, combined ? 6 : 7)
  if (combined) add(ctx.fleetShips(2), 6, 6)
  return result
}

// ---- 胜败预测 ----

const predictRankWith = (
  fShips: BattleShipView[],
  eShips: BattleShipView[],
  airRaid: boolean,
  isDefeated: (ship: BattleShipView) => boolean,
): RankPrediction => {
  const alive = (s: BattleShipView) => s.hpStart > 0 && !s.escaped
  const f = fShips.filter(alive)
  const e = eShips.filter(alive)
  const sumStart = (list: BattleShipView[]) => list.reduce((acc, s) => acc + s.hpStart, 0)
  const sumTaken = (list: BattleShipView[]) => list.reduce((acc, s) => acc + Math.max(0, s.hpStart - s.hpEnd), 0)
  const fStart = sumStart(f) || 1
  const eStart = sumStart(e) || 1
  const fTaken = sumTaken(f)
  const fGauge = Math.floor((fTaken / fStart) * 100)
  const eGauge = Math.floor((sumTaken(e) / eStart) * 100)
  const fSunk = f.filter(isDefeated).length
  const eSunk = e.filter(isDefeated).length
  // 游戏口径（wikiwiki 勝利判定）：完全勝利 S = 敌全灭且我方「損害が全く無い」，
  // 也就是承伤合计为 0（舰载机损失不计）。这里必须看未取整的 fTaken：
  // fGauge 经 Math.floor，联合舰队血池大到个位数承伤也不足 1%，会被舍成 0%。
  // 2026-08-27 用户在 62-4 实测证伪旧写法：承伤 3/688 ≈ 0.44% → 0%，
  // 艦素报「完全胜利」，游戏结算只给普通 S。
  //
  // fSunk === 0 不是冗余：演习里 hpFloor 为 1，入场就剩 1 HP 的舰被击破时
  // hpEnd 仍显示 1，承伤合计为 0，只有 defeated 这一路能看出她已经被打掉。
  //
  // 空袭战 / 雷达射击战我方不出手，敌全灭这一半永远不成立——把通常战那套
  // 「敌全灭 + 零承伤」原样套上去，等于把这两类节点无条件排除在完全胜利之外。
  // 2026-08-28 用户在 62-5 途中空袭点实测：我方承伤 0，游戏结算画面给
  // 「完全勝利!!S」，而艦素只报了普通 S。所以这一路只看我方这半边。
  const perfect = airRaid
    ? fSunk === 0 && fTaken === 0
    : fSunk === 0 && fTaken === 0 && e.length > 0 && eSunk >= e.length
  const base = { fGauge, fTaken, eGauge, fSunk, fCount: f.length, eSunk, eCount: e.length, perfect }

  if (airRaid) {
    // 空袭战不存在「按损害率给的普通 S」：这里的 S 就是完全勝利，判据是承伤点数为 0，
    // 不是 floor 过的损害率。两路证据独立指向同一结论——
    //
    // 一、游戏自己的结算字节。2026-08-28 用账本里 61 场已结算空袭战对照 api_win_rank
    //     （battle_snapshots.rank 存的是 result.rank ← body.api_win_rank，是游戏下发的
    //     原始字节，不是我们的预测，不构成自证）：
    //       承伤 0   → 游戏给 S，44/44 无例外；
    //       承伤 >0 → 游戏一次都没给过 S，15/15（损害率 6% 那场也只给 A）。
    //     其中两场正踩 floor 陷阱：4/709 与 5/626 都被舍成 0%，旧写法据此报「S 可以确定」，
    //     而游戏结算是 A——与 62-4 通常战那次同构。
    // 二、wikiwiki「勝利条件」页 · 空襲戦マスでの勝利条件（页面更新 2025-03-20）原文：
    //       「自艦隊の被害がゼロor女神等による回復で被ダメージ率0%以下で完全勝利S。」
    //       「以後自艦隊の被害が増えるごとにA、B、C、D、Eと評価が下がる。」
    //     10% 一档的边界该页写的是「おそらく10%毎」——是推定不是明证，所以 A~E 的阈值
    //     按推定值原样保留，只有 S 这一条有实测背书。
    //
    // ⚠️ 已知未验的边角：同页还写着「ダメコン発動かつ他の艦にダメージがない場合、
    // （完全勝利ではない）勝利Sになる模様」——即应急修理要员触发时游戏给普通 S。
    // 该句 wiki 自己标「模様」，且账本 61 场里一场都没触发过修理要员（无样本可自证），
    // 故此处不为它开分支；真遇到样本再按实测收。
    //
    // 雷达射击战（ld_shooting）与空袭战共用这条路：同页记「勝敗条件は空襲戦と同じ模様」。
    const rank = fTaken === 0 ? 'S' : fGauge < 10 ? 'A' : fGauge < 20 ? 'B' : fGauge < 50 ? 'C' : fGauge < 80 ? 'D' : 'E'
    return { rank, sure: fTaken === 0, ...base }
  }
  if (fSunk === 0) {
    if (eSunk >= e.length && e.length > 0) return { rank: 'S', sure: true, ...base }
    if (e.length > 1 && eSunk >= requiredSunkForA(e.length)) return { rank: 'A', sure: true, ...base }
    if (e[0] && isDefeated(e[0])) return { rank: 'B', sure: true, ...base }
    if (eGauge > fGauge * 2.5) return { rank: 'B', sure: false, ...base }
    if (eGauge > fGauge * 0.9) return { rank: 'C', sure: false, ...base }
    return { rank: 'D', sure: false, ...base }
  }
  if (eSunk >= e.length && e.length > 0) return { rank: 'B', sure: false, ...base }
  if (e[0] && isDefeated(e[0]) && fSunk < eSunk) return { rank: 'B', sure: false, ...base }
  if (eGauge > fGauge * 2.5) return { rank: 'B', sure: false, ...base }
  if (eGauge > fGauge * 0.9) return { rank: 'C', sure: false, ...base }
  return { rank: fGauge >= 80 ? 'E' : 'D', sure: false, ...base }
}

/** 通常出击：只把真实沉没计入胜负条件。 */
export const predictRank = (
  fShips: BattleShipView[],
  eShips: BattleShipView[],
  airRaid: boolean,
): RankPrediction => predictRankWith(fShips, eShips, airRaid, (ship) => ship.sunk)

/**
 * 演习专用：击破舰停在 HP1；必须使用伤害结算时记录的 defeated，
 * 不能把所有 HP1 都当击破，也不能复用永远为 false 的真实 sunk。
 */
export const predictPracticeRank = (
  fShips: BattleShipView[],
  eShips: BattleShipView[],
): RankPrediction => predictRankWith(fShips, eShips, false, (ship) => ship.defeated)

export const reconcileBattle = (
  view: BattleView,
  body: any,
): BattleDiscrepancy[] => {
  const out: BattleDiscrepancy[] = []

  if (typeof body?.api_dests === 'number') {
    const ours = view.eShips.filter((ship) => view.practice ? ship.defeated : ship.sunk).length
    if (ours !== body.api_dests) out.push({ kind: 'sunk', ours, game: body.api_dests })
  }

  if (Number.isInteger(body?.api_mvp) && body.api_mvp > 0) {
    const main = view.fShips.filter((ship) => ship.fleet !== 'escort')
    const best = Math.max(...main.map((ship) => ship.damageDealt), 0)
    const tied = main.filter((ship) => ship.damageDealt === best)
    const gameMvp = body.api_mvp as number
    if (tied.length && !tied.some((ship) => ship.position + 1 === gameMvp)) {
      out.push({ kind: 'mvp', ours: tied[0].position + 1, game: gameMvp })
    }
  }

  if (
    view.prediction.sure === true &&
    typeof body?.api_win_rank === 'string' &&
    view.prediction.rank !== body.api_win_rank
  ) {
    out.push({ kind: 'rank', ours: view.prediction.rank, game: body.api_win_rank })
  }

  return out
}

// ---- 阶段规划 ----

const isNightPath = (apiPath: string) =>
  apiPath.includes('midnight') || apiPath.includes('sp_midnight')
const isNightToDay = (apiPath: string) => apiPath.includes('night_to_day')
const isRadarBattle = (apiPath: string) => apiPath.includes('ld_shooting')

const KIND_BY_PATH = (apiPath: string): BattleView['kind'] => {
  if (apiPath.includes('ld_shooting')) return 'radar'
  if (apiPath.includes('ld_airbattle')) return 'airraid'
  if (apiPath.includes('airbattle')) return 'airbattle'
  if (isNightToDay(apiPath)) return 'nightday'
  if (isNightPath(apiPath)) return 'nightonly'
  return 'day'
}

const ownFleetType = (apiPath: string, ctx: FleetContext): number => {
  if (apiPath.includes('battle_water')) return 2
  if (apiPath.includes('each_battle_water')) return 2
  if (
    apiPath.includes('/api_req_combined_battle/battle') ||
    apiPath.includes('/api_req_combined_battle/each_battle')
  ) {
    const type = ctx.combinedType?.() ?? 1
    return type === 2 ? 2 : type === 3 ? 3 : 1
  }
  return ctx.combinedType?.() ?? 0
}

const enemyIsCombined = (body: any, apiPath: string): boolean =>
  apiPath.includes('/ec_') ||
  apiPath.includes('/each_') ||
  (Array.isArray(body.api_ship_ke_combined) && body.api_ship_ke_combined.some(positive))

const parseActiveDeck = (body: any): [number, number] | null =>
  Array.isArray(body.api_active_deck)
    ? [num(body.api_active_deck[0], 1), num(body.api_active_deck[1], 1)]
    : null

const parseNightStages = (sim: Sim, body: any, dawn: boolean) => {
  applySupport(sim, body.api_n_support_info, '夜战支援', 'api_n_support_info')
  if (dawn) {
    applyHougeki(sim, body.api_n_hougeki1, {
      phase: 'night',
      label: '夜战第一轮',
      source: 'api_n_hougeki1',
      ciKind: 'night',
      night: true,
    })
    applyHougeki(sim, body.api_n_hougeki2, {
      phase: 'night',
      label: '夜战第二轮',
      source: 'api_n_hougeki2',
      ciKind: 'night',
      night: true,
    })
  }
  applyHougeki(sim, body.api_friendly_battle?.api_hougeki, {
    phase: 'friendly',
    label: '友军舰队',
    source: 'api_friendly_battle.api_hougeki',
    ciKind: 'night',
    sideOverride: 2,
    night: true,
  })
  applyHougeki(sim, body.api_hougeki, {
    phase: 'night',
    label: dawn ? '夜战追击' : '夜战',
    source: 'api_hougeki',
    ciKind: 'night',
    night: true,
  })
}

const applyGun = (
  sim: Sim,
  body: any,
  source: 'api_hougeki1' | 'api_hougeki2' | 'api_hougeki3',
  phase: 'gun1' | 'gun2' | 'gun3' | 'radar',
  label: string,
) =>
  applyHougeki(sim, body[source], {
    phase,
    label,
    source,
    ciKind: 'day',
  })

const parseDayStages = (sim: Sim, body: any, apiPath: string, ctx: FleetContext) => {
  for (const [i, wave] of asWaves(body.api_air_base_injection).entries()) {
    applyKouku(sim, wave, 'lbas', `基地喷气强袭${i + 1}`, `api_air_base_injection[${i}]`)
  }
  applyKouku(sim, body.api_injection_kouku, 'injection', '舰队喷气强袭', 'api_injection_kouku')
  // 陆航的波次编号：报文给了 api_base_id 就按「第 N 基地的第 M 波」数，
  // 没给（旧报文）才退回全局波次。账本实测一次出击的四波是 [2,2,3,3]——
  // 按全局数会写成「第 3 波」「第 4 波」，其实那是第 3 基地自己的第 1、2 波。
  const lbasWaves = asWaves(body.api_air_base_attack)
  const lbasSeen = new Map<number, number>()
  for (const [i, wave] of lbasWaves.entries()) {
    const baseId = num(wave?.api_base_id)
    let label = `基地航空第${i + 1}波`
    if (baseId > 0) {
      const nth = (lbasSeen.get(baseId) ?? 0) + 1
      lbasSeen.set(baseId, nth)
      label = `第${baseId}基地第${nth}波`
    }
    applyKouku(sim, wave, 'lbas', label, `api_air_base_attack[${i}]`)
  }
  applyKouku(sim, body.api_friendly_kouku, 'friendlyAir', '友军航空', 'api_friendly_kouku', 2)
  applyKouku(
    sim,
    body.api_kouku,
    'air',
    apiPath.includes('ld_airbattle') ? '敌空袭' : '第一航空战',
    'api_kouku',
  )
  applyKouku(sim, body.api_kouku2, 'air2', '第二航空战', 'api_kouku2')
  applySupport(sim, body.api_support_info, '支援舰队', 'api_support_info')
  applyHougeki(sim, body.api_opening_taisen, {
    phase: 'openingAsw',
    label: '开幕对潜',
    source: 'api_opening_taisen',
    ciKind: 'day',
  })
  applyOpeningTorp(sim, body.api_opening_atack)

  const radar = isRadarBattle(apiPath)
  const fleetType = ownFleetType(apiPath, ctx)
  const enemyCombined = enemyIsCombined(body, apiPath)
  const g1: 'gun1' | 'radar' = radar ? 'radar' : 'gun1'
  const g2: 'gun2' | 'radar' = radar ? 'radar' : 'gun2'
  const g3: 'gun3' | 'radar' = radar ? 'radar' : 'gun3'
  const radarLabel = (fallback: string) => (radar ? '长距离雷达射击' : fallback)

  if (fleetType === 0 && !enemyCombined) {
    applyGun(sim, body, 'api_hougeki1', g1, radarLabel('主力炮击第一轮'))
    applyGun(sim, body, 'api_hougeki2', g2, radarLabel('主力炮击第二轮'))
    applyRaigeki(sim, body.api_raigeki, 'torp', '闭幕雷击（同时）', 'api_raigeki')
    return
  }
  if (fleetType === 0 && enemyCombined) {
    applyGun(sim, body, 'api_hougeki1', g1, radarLabel('敌护卫交战'))
    applyRaigeki(sim, body.api_raigeki, 'torp', '闭幕雷击（同时）', 'api_raigeki')
    applyGun(sim, body, 'api_hougeki2', g2, radarLabel('联合炮击第二轮'))
    applyGun(sim, body, 'api_hougeki3', g3, radarLabel('联合炮击第三轮'))
    return
  }
  if (fleetType === 2) {
    applyGun(sim, body, 'api_hougeki1', g1, radarLabel('主力炮击第一轮'))
    applyGun(sim, body, 'api_hougeki2', g2, radarLabel('主力炮击第二轮'))
    applyGun(sim, body, 'api_hougeki3', g3, radarLabel('护卫舰队炮击'))
    applyRaigeki(sim, body.api_raigeki, 'torp', '闭幕雷击（同时）', 'api_raigeki')
    return
  }
  // 空母机动 / 输送护卫
  if (!enemyCombined) {
    applyGun(sim, body, 'api_hougeki1', g1, radarLabel('护卫舰队炮击'))
    applyRaigeki(sim, body.api_raigeki, 'torp', '闭幕雷击（同时）', 'api_raigeki')
    applyGun(sim, body, 'api_hougeki2', g2, radarLabel('主力炮击第一轮'))
    applyGun(sim, body, 'api_hougeki3', g3, radarLabel('主力炮击第二轮'))
    return
  }
  applyGun(sim, body, 'api_hougeki1', g1, radarLabel('主力炮击第一轮'))
  applyGun(sim, body, 'api_hougeki2', g2, radarLabel('护卫舰队炮击'))
  applyRaigeki(sim, body.api_raigeki, 'torp', '闭幕雷击（同时）', 'api_raigeki')
  applyGun(sim, body, 'api_hougeki3', g3, radarLabel('主力炮击第二轮'))
}

/**
 * 两个战斗级小事实，都是「不发生就整个字段不存在」，所以一律缺省即没有、不写键。
 *
 * - `api_air_base_rescue_type`：基地航空队的「カタリナ救助活動」，值 = 弹出几个救助气泡。
 *   apilist 原文写着「発生しなかった場合は存在しない」，正好解释了账本 32/32 全非零。
 *   **PBY-5A Catalina 是必要不充分条件**：32 场里每场都带着它、且每场只装 1 格就触发了
 *   （所以「要带 ≥3 架」那个说法已被证伪），而带了它却没触发的对照场次有 8 次。
 *   取值只见过 1 和 2，但**不设上界**——apilist 写的是 1～3，枚举本来就会长。
 * - `api_balloon_cell`：这一格有阻塞气球。**推断级**，见 mg-types 里的判据说明。
 */
const battleCellFlags = (body: any): { airBaseRescue?: number; balloonCell?: true } => {
  const rescue = num(body?.api_air_base_rescue_type)
  const balloon = num(body?.api_balloon_cell)
  return {
    ...(rescue > 0 ? { airBaseRescue: rescue } : {}),
    ...(balloon > 0 ? { balloonCell: true as const } : {}),
  }
}

const markEscaped = (ships: BattleShipView[], values: any, base: number) => {
  if (!Array.isArray(values)) return
  for (const raw of values) {
    const position = num(raw, 0) - 1
    const ship = shipAt(ships, base + position)
    if (ship) ship.escaped = true
  }
}

const initSim = (
  f: BuiltFleet,
  e: BuiltFleet,
  npc: { ships: BattleShipView[]; offset: number },
  ctx: FleetContext,
  deckId: number,
  practice: boolean,
  activeDeck: [number, number] | null,
): Sim => ({
  f: f.ships,
  e: e.ships,
  friend: npc.ships,
  attacks: [],
  stages: [],
  hpFloor: practice ? 1 : 0,
  nextStage: 0,
  nextAction: 0,
  offsets: {
    fMain: f.mainOffset,
    fEscort: f.escortOffset,
    eMain: e.mainOffset,
    eEscort: e.escortOffset,
    friend: npc.offset,
  },
  activeDeck,
  repairItems: repairItemsFor(
    ctx,
    deckId,
    f.ships.some((ship) => ship.fleet === 'escort'),
  ),
})

const assignBattleParams = (
  ships: BattleShipView[],
  fleet: BattleShipView['fleet'],
  values: any,
) => {
  if (!Array.isArray(values)) return
  const offset = leadingOffset(values, (value) => !Array.isArray(value))
  for (const ship of ships.filter((entry) => entry.fleet === fleet)) {
    const row = values[ship.position + offset]
    if (!Array.isArray(row)) continue
    ship.params = [
      num(row[0]),
      num(row[1]),
      num(row[2]),
      num(row[3]),
    ]
  }
}

// 昼战/空袭/夜战开幕包 → 新建 BattleView
export const parseBattle = (
  apiPath: string,
  body: any,
  ctx: FleetContext,
  ts: number,
): BattleView => {
  const deckId = num(body.api_deck_id, 1)
  const practice = apiPath.includes('/api_req_practice/')
  const builtF = buildFriendShips(body, deckId, ctx)
  const builtE = buildEnemyShips(body, ctx)
  assignBattleParams(builtF.ships, 'main', body.api_fParam)
  assignBattleParams(builtF.ships, 'escort', body.api_fParam_combined)
  assignBattleParams(builtE.ships, 'main', body.api_eParam)
  assignBattleParams(builtE.ships, 'escort', body.api_eParam_combined)
  const npc = buildNpcFriendShips(body, ctx)
  const activeDeck = parseActiveDeck(body)
  const sim = initSim(builtF, builtE, npc, ctx, deckId, practice, activeDeck)
  markEscaped(sim.f, body.api_escape_idx, 0)
  markEscaped(sim.f, body.api_escape_idx_combined, 6)

  const night = isNightPath(apiPath)
  const dawn = isNightToDay(apiPath)
  if (night) parseNightStages(sim, body, false)
  else {
    if (dawn) parseNightStages(sim, body, true)
    parseDayStages(sim, body, apiPath, ctx)
  }

  const formation = Array.isArray(body.api_formation) ? body.api_formation : []
  const kind = KIND_BY_PATH(apiPath)
  const touch = Array.isArray(body.api_touch_plane)
    ? [num(Number(body.api_touch_plane[0]), -1), num(Number(body.api_touch_plane[1]), -1)] as [number, number]
    : null
  return {
    kind,
    practice,
    hasNight: night || dawn,
    fFormation: num(formation[0]),
    eFormation: num(formation[1]),
    engagement: num(formation[2]),
    fShips: sim.f,
    eShips: sim.e,
    friendShips: sim.friend,
    friendlyProductionType: npc.productionType,
    stages: sim.stages,
    attacks: sim.attacks,
    air: toAirView(sim, body.api_kouku),
    air2: toAirView(sim, body.api_kouku2),
    airInjection: toAirView(sim, body.api_injection_kouku),
    flarePos: Array.isArray(body.api_flare_pos)
      ? [num(body.api_flare_pos[0], -1), num(body.api_flare_pos[1], -1)]
      : null,
    detection: Array.isArray(body.api_search)
      ? [num(body.api_search[0]), num(body.api_search[1])]
      : null,
    nightContact: touch,
    smokeType: num(body.api_smoke_type),
    ...battleCellFlags(body),
    activeDeck,
    hasSupport: sim.stages.some((stage) => stage.phase === 'support'),
    flavorVoices: parseFlavorVoices(body),
    prediction: practice
      ? predictPracticeRank(sim.f, sim.e)
      : predictRank(sim.f, sim.e, kind === 'airraid' || kind === 'radar'),
    result: null,
    ts,
  }
}

const baseDefensePlanes = (raw: any): BattleEquipmentView[] =>
  Array.isArray(raw)
    ? raw.flatMap((plane: any, slot: number) => {
        const mstId = num(plane?.api_mst_id)
        if (mstId <= 0) return []
        return [{
          mstId,
          instanceId: null,
          slot,
          planeCount: Math.max(0, num(plane?.api_count)),
          planeCapacity: null,
          planeSource: 'sortie' as const,
          level: 0,
          alv: 0,
        }]
      })
    : []

const buildBaseDefenseShips = (body: any): BuiltFleet => {
  const nowhps = Array.isArray(body?.api_f_nowhps) ? body.api_f_nowhps : []
  const maxhps = Array.isArray(body?.api_f_maxhps) ? body.api_f_maxhps : []
  const planesByBase =
    body?.api_air_base_attack?.api_map_squadron_plane &&
    typeof body.api_air_base_attack.api_map_squadron_plane === 'object'
      ? body.api_air_base_attack.api_map_squadron_plane
      : {}
  const ships = nowhps.flatMap((rawHp: any, position: number) => {
    const hp = num(rawHp, -1)
    if (hp < 0) return []
    const maxHp = Math.max(1, num(maxhps[position], hp))
    return [makeShip(
      position,
      'main',
      position,
      0,
      null,
      `第${position + 1}基地航空队`,
      0,
      hp,
      maxHp,
      false,
      baseDefensePlanes(planesByBase[`${position + 1}`]),
    )]
  })
  return { ships, mainOffset: 0, escortOffset: 0 }
}

// 基地防空不是独立战斗端点，而是 map/start 或 map/next 内的
// api_destruction_battle。把三列基地耐久视作无在籍 ID 的临时单位，
// 才能复用真实航空 stage3 伤害、制空与逐击流水，又不会回写舰娘 HP。
export const parseBaseDefenseBattle = (
  body: any,
  ctx: FleetContext,
  ts: number,
): BattleView => {
  const builtF = buildBaseDefenseShips(body)
  const builtE = buildEnemyShips(body, ctx)
  const sim = initSim(
    builtF,
    builtE,
    { ships: [], offset: 0 },
    ctx,
    1,
    false,
    null,
  )
  const rawKouku = body?.api_air_base_attack
  const mapPlanes =
    rawKouku?.api_map_squadron_plane && typeof rawKouku.api_map_squadron_plane === 'object'
      ? Object.values(rawKouku.api_map_squadron_plane).flat()
      : []
  const kouku = rawKouku
    ? {
        ...rawKouku,
        api_squadron_plane: mapPlanes,
      }
    : null
  applyKouku(
    sim,
    kouku,
    'air',
    '基地防空',
    'api_destruction_battle.api_air_base_attack',
  )
  const formation = Array.isArray(body?.api_formation) ? body.api_formation : []
  return {
    kind: 'baseDefense',
    practice: false,
    hasNight: false,
    fFormation: num(formation[0]),
    eFormation: num(formation[1]),
    engagement: num(formation[2]),
    fShips: sim.f,
    eShips: sim.e,
    friendShips: [],
    friendlyProductionType: null,
    stages: sim.stages,
    attacks: sim.attacks,
    air: toAirView(sim, kouku),
    air2: null,
    airInjection: null,
    flarePos: null,
    detection: null,
    nightContact: null,
    smokeType: 0,
    activeDeck: null,
    hasSupport: false,
    baseDefenseLostKind: num(body?.api_lost_kind, -1),
    flavorVoices: [],
    prediction: predictRank(sim.f, sim.e, true),
    result: null,
    ts,
  }
}

// 夜战包并入既有昼战：以夜战包开局 HP 自校正，再按真实夜战阶段追加。
export const mergeNight = (
  prev: BattleView,
  body: any,
  ctx: FleetContext,
  ts: number,
): BattleView => {
  const floor = prev.practice ? 1 : 0
  const anchor = (ships: BattleShipView[], nowhps: any, base: number) => {
    if (!Array.isArray(nowhps)) return
    const offset = leadingOffset(nowhps)
    nowhps.forEach((hp: any, raw: number) => {
      if (raw < offset || num(hp, -1) < 0) return
      const ship = shipAt(ships, base + raw - offset)
      if (ship && typeof hp === 'number') {
        ship.hpEnd = Math.max(floor, hp)
        if (floor === 0) {
          ship.sunk = ship.hpEnd === 0
          ship.defeated = ship.sunk
        }
      }
    })
  }
  anchor(prev.fShips, body.api_f_nowhps, 0)
  anchor(prev.fShips, body.api_f_nowhps_combined, 6)
  anchor(prev.eShips, body.api_e_nowhps, 0)
  anchor(prev.eShips, body.api_e_nowhps_combined, 6)

  const npc = buildNpcFriendShips(body, ctx)
  const activeDeck = parseActiveDeck(body) ?? prev.activeDeck
  const repairItems = repairItemsFor(
    ctx,
    num(body.api_deck_id, 1),
    prev.fShips.some((ship) => ship.fleet === 'escort'),
  )
  // 同一场昼夜战里已经发动过的要员/女神不能在夜战再次被当作可用。
  // 根治在结算层：useRepairItem 见到 repairItemUsed 已置位就直接不发动，
  // 而且 applyHit 的轰沈保护让她根本压不到 0。这里再把用掉的那一件从夜战
  // 的可用表里摘掉，是双保险——顺带让「她还剩几件」这份表本身不说谎。
  for (const ship of prev.fShips) {
    if (ship.repairItemUsed == null) continue
    const items = repairItems.get(ship.index)
    const used = items?.findIndex((item) => item.mstId === ship.repairItemUsed) ?? -1
    if (items && used >= 0) items.splice(used, 1)
  }
  const sim: Sim = {
    f: prev.fShips,
    e: prev.eShips,
    friend: npc.ships.length ? npc.ships : prev.friendShips,
    attacks: prev.attacks,
    stages: prev.stages,
    hpFloor: floor,
    nextStage: prev.stages.reduce((max, stage) => Math.max(max, stage.order + 1), 0),
    nextAction: prev.attacks.reduce((max, attack) => Math.max(max, attack.action + 1), 0),
    offsets: { fMain: 0, fEscort: 0, eMain: 0, eEscort: 0, friend: npc.offset },
    activeDeck,
    repairItems,
  }
  parseNightStages(sim, body, false)
  const touch = Array.isArray(body.api_touch_plane)
    ? [num(Number(body.api_touch_plane[0]), -1), num(Number(body.api_touch_plane[1]), -1)] as [number, number]
    : prev.nightContact
  const flavorVoices = parseFlavorVoices(body)
  return {
    ...prev,
    friendShips: sim.friend,
    friendlyProductionType: npc.productionType ?? prev.friendlyProductionType ?? null,
    stages: sim.stages,
    attacks: sim.attacks,
    hasNight: true,
    flarePos: Array.isArray(body.api_flare_pos)
      ? [num(body.api_flare_pos[0], -1), num(body.api_flare_pos[1], -1)]
      : prev.flarePos,
    detection: Array.isArray(body.api_search)
      ? [num(body.api_search[0]), num(body.api_search[1])]
      : prev.detection,
    nightContact: touch,
    smokeType: num(body.api_smoke_type, prev.smokeType),
    // 夜战包也带这两格（账本里昼夜包成对出现）。昼战包已经立过的不许被夜战包抹掉：
    // 卡特琳娜救助本来就只在昼间的陆航段发生，夜战包不带它是常态，不是「没发生」。
    ...battleCellFlags(body),
    activeDeck,
    hasSupport: sim.stages.some((stage) => stage.phase === 'support'),
    flavorVoices: flavorVoices.length ? flavorVoices : prev.flavorVoices,
    prediction: prev.practice
      ? predictPracticeRank(prev.fShips, prev.eShips)
      : predictRank(prev.fShips, prev.eShips, false),
    ts,
  }
}

// 0.1 早期快照没有有序阶段/友军/双 MVP 等字段。回灌时就地升级，
// 让旧复盘至少保持可读；新报文仍全部走上面的严格解析路径。
export const upgradeBattleView = (raw: any): BattleView | null => {
  if (!raw || typeof raw !== 'object') return null
  const battle = raw as BattleView
  const hadDefeatedState = [...((raw as any).fShips ?? []), ...((raw as any).eShips ?? [])]
    .some((ship: any) => typeof ship?.defeated === 'boolean')
  const upgradeShips = (ships: any, fallbackFleet: BattleShipView['fleet']) => {
    if (!Array.isArray(ships)) return []
    const legacyEscort =
      ships.some((ship: any) => ship?.fleet === 'escort') ||
      ships.some((ship: any) => num(ship?.index) > 6) ||
      (ships.length > 6 && ships.every((ship: any) => ship?.fleet == null))
    return ships.map((ship: any) => {
      const index = num(ship?.index)
      const fleet = ship?.fleet ?? (legacyEscort && index >= 6 ? 'escort' : fallbackFleet)
      return {
        ...ship,
        index,
        fleet,
        position: ship?.position ?? (fleet === 'escort' ? index - 6 : index),
        escaped: ship?.escaped === true,
        repairItemUsed: typeof ship?.repairItemUsed === 'number' ? ship.repairItemUsed : null,
        defeated:
          ship?.defeated === true ||
          (battle.practice !== true && ship?.sunk === true),
        equipment: Array.isArray(ship?.equipment) ? ship.equipment : undefined,
      } as BattleShipView
    })
  }
  battle.fShips = upgradeShips(battle.fShips, 'main')
  battle.eShips = upgradeShips(battle.eShips, 'main')
  battle.friendShips = upgradeShips((battle as any).friendShips, 'friend')
  // 旧快照没存过友军档位。缺省 null = 不标，不去替旧场次推断（那时候的报文早就没了）
  battle.friendlyProductionType =
    typeof (battle as any).friendlyProductionType === 'number'
      ? (battle as any).friendlyProductionType
      : null
  battle.activeDeck = Array.isArray((battle as any).activeDeck) ? (battle as any).activeDeck : null
  battle.detection = Array.isArray((battle as any).detection) ? (battle as any).detection : null
  battle.nightContact = Array.isArray((battle as any).nightContact) ? (battle as any).nightContact : null
  battle.smokeType = num((battle as any).smokeType)
  battle.flavorVoices = Array.isArray((battle as any).flavorVoices)
    ? (battle as any).flavorVoices
    : []
  if (battle.result && typeof (battle.result as any).mvpCombined !== 'number') {
    battle.result.mvpCombined = -1
  }

  const legacyLabels: Record<BattleAttack['phase'], string> = {
    lbas: '基地航空',
    injection: '舰队喷气强袭',
    air: '第一航空战',
    air2: '第二航空战',
    friendlyAir: '友军航空',
    support: '支援舰队',
    openingAsw: '开幕对潜',
    openingTorp: '开幕雷击',
    gun1: '炮击第一轮',
    gun2: '炮击第二轮',
    gun3: '炮击第三轮',
    torp: '闭幕雷击',
    night: '夜战',
    friendly: '友军舰队',
    radar: '长距离雷达射击',
  }
  const attacks = Array.isArray((battle as any).attacks) ? battle.attacks : []
  const stages: BattleStageView[] = []
  let stage = -1
  let lastPhase: BattleAttack['phase'] | null = null
  attacks.forEach((attack: any, action: number) => {
    const phase = attack.phase as BattleAttack['phase']
    if (phase !== lastPhase) {
      stage += 1
      lastPhase = phase
      stages.push({
        order: stage,
        phase,
        label: legacyLabels[phase] ?? `${phase}`,
        source: 'legacy-snapshot',
        simultaneous: phase === 'openingTorp' || phase === 'torp',
        air:
          phase === 'air'
            ? battle.air
            : phase === 'air2'
              ? battle.air2
              : phase === 'injection'
                ? battle.airInjection
                : null,
      })
    }
    attack.stage = typeof attack.stage === 'number' ? attack.stage : stage
    attack.action = typeof attack.action === 'number' ? attack.action : action
    attack.stageLabel = attack.stageLabel ?? legacyLabels[phase] ?? `${phase}`
    attack.source = attack.source ?? 'legacy-snapshot'
    attack.simultaneous = attack.simultaneous ?? (phase === 'openingTorp' || phase === 'torp')
    attack.ciKind =
      attack.ciKind ?? (phase === 'night' || phase === 'friendly' ? 'night' : attack.ciType ? 'day' : null)
    if (Array.isArray(attack.hits)) {
      attack.hits = attack.hits.map((hit: any) => ({
        ...hit,
        hitState:
          hit?.hitState === 'miss' || hit?.hitState === 'hit' || hit?.hitState === 'unknown'
            ? hit.hitState
            : hit?.miss === true
              ? 'miss'
              : num(hit?.damage) > 0
                ? 'hit'
                : phase === 'lbas' ||
                    phase === 'injection' ||
                    phase === 'air' ||
                    phase === 'air2' ||
                    phase === 'friendlyAir' ||
                    phase === 'support'
                  ? 'unknown'
                  : 'hit',
        miss: hit?.miss === true,
        repairItem: typeof hit?.repairItem === 'number' ? hit.repairItem : null,
      }))
    }
  })
  // 旧版演习快照只保留了 HP1 与逐击伤害，没有单独保存“击破判定”。
  // 按原阶段顺序重放 HP，只有实际越过 0 HP 才标 defeated；刚好剩 1 HP 仍保持可行动。
  if (battle.practice && !hadDefeatedState) {
    const hp = new Map<string, number>()
    const seed = (side: 0 | 1, ships: BattleShipView[]) => {
      for (const ship of ships) {
        ship.defeated = false
        hp.set(`${side}:${ship.index}`, Math.max(1, num(ship.hpStart, 1)))
      }
    }
    seed(0, battle.fShips)
    seed(1, battle.eShips)
    for (const attack of [...attacks].sort(
      (left, right) => left.stage - right.stage || left.action - right.action,
    )) {
      const targetSide: 0 | 1 = attack.side === 1 ? 0 : 1
      const targets = targetSide === 0 ? battle.fShips : battle.eShips
      for (const hit of attack.hits ?? []) {
        const ship = shipAt(targets, num(hit.target, -1))
        if (!ship || ship.defeated) continue
        const key = `${targetSide}:${ship.index}`
        const before = hp.get(key) ?? Math.max(1, ship.hpStart)
        const damage = Math.max(0, Math.floor(num(hit.damage)))
        if (damage > 0 && before - damage <= 0) ship.defeated = true
        hp.set(key, Math.max(1, before - damage))
      }
    }
  }
  if (!Array.isArray((battle as any).stages)) battle.stages = stages
  battle.hasSupport = battle.stages.some((item) => item.phase === 'support')
  // 早期版本曾把完全胜利写成不存在的 SS；同时旧快照没有 perfect 标记。
  // 由已经升级好的战斗终局重新生成，历史复盘与实时战斗统一显示 S / S（完全胜利）。
  // 旧快照把空袭与雷达射击都记为 ldair；按已有阶段无损迁移，
  // 避免历史复盘继续套用通常战的击沉目标文案。
  if ((raw as any).kind === 'ldair') {
    battle.kind = battle.stages.some((stage) => stage.phase === 'radar')
      ? 'radar'
      : 'airraid'
  }
  battle.prediction = battle.practice
    ? predictPracticeRank(battle.fShips, battle.eShips)
    : predictRank(
        battle.fShips,
        battle.eShips,
        battle.kind === 'airraid' || battle.kind === 'radar',
      )
  return battle
}
