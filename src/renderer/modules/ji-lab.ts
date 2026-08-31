// 组合实验室（2026-08-12 用户提议）：在装备图鉴里模拟/查询配装的各种 CI。
//
// 形态：选一艘仓库舰娘 → 按可装备规则往虚拟槽里放装备 → 实时报五类结论：
//   夜战特殊攻击（shared/night-cutin，wikiwiki 夜戦 口径）
//   昼战弹着观测（shared/day-spotting，确保/优势两档发动率）
//   对空 CI（shared/ship-special-attack，poi/wikiwiki 对空砲火表）
//   对空喷进弹幕（shared/aa-rocket-barrage，poi aapb 与 wikiwiki 两票）
//   先制对潜（shared/ship-special-attack，wikiwiki 発動条件）
// 只读模拟：不动游戏、不动真实配装。每格可填改修星（2026-08-30 用户拍板：喷进弹幕卡
// 原来只报得了 ★0 的下限）。五类**判定**都不看改修，吃 ★ 的只有两处数值：
//   喷进弹幕发动率——加重对空里的 √★ 一项（aa-rocket-barrage）
//   夜战基本攻击力——改修强化值（night-battle 的 nightImprovement）
// 昼战观测的装备索敌、先制对潜的表示对潜都按装备原始值算，不吃 ★，各卡里写明。
// 熟练度仍一律按未熟练：本页没有熟练度输入。
import {
  applyPaneHtml,
  esc,
  forgetCommittedHtml,
  hangarExpansionOf,
  hangarSlotCapacity,
  masterShipName,
  mg,
  onFilterInput,
} from '../kernel'
import { elinkHtml } from '../link'
import { entityNameHtml, entityNamePlain, localizationVersion } from '../localization'
import {
  SUGGEST_PREVIEW,
  closeSuggest,
  openSuggest,
  scheduleSuggestClose,
  suggestKeydown,
  type SuggestEntry,
  type SuggestField,
} from './ji-lab-suggest'
import { shipCanEquipItem } from '../../shared/equipability'
import { nightCutinsOf, type NightCutinEquip } from '../../shared/night-cutin'
import { nightBasePower } from '../../shared/night-battle'
import { spottingMultiplier, type SpottingShip } from '../../shared/day-spotting'
import {
  openingAswOf,
  shipAacis,
  shipAaciCeiling,
  ROCKET_LAUNCHER_K2_MST_ID,
  type SpecialAbilityEquip,
  type SpecialAbilityShip,
} from '../../shared/ship-special-attack'
import {
  rocketBarrageOf,
  type RocketBarrageEquip,
  type RocketBarrageShip,
} from '../../shared/aa-rocket-barrage'

export const labHost = document.createElement('div')
labHost.className = 'ji-lab'

interface LabState {
  rosterId: number
  /** 常规槽 + 最后一格补强增设；0 = 空 */
  slots: number[]
  /** 与 slots 同长同下标的改修星；空格恒 0 */
  stars: number[]
  flagship: boolean
}
const state: LabState = { rosterId: 0, slots: [], stars: [], flagship: true }
let mstRaw: any = null

const MAX_STAR = 10
const clampStar = (value: number): number =>
  Number.isFinite(value) ? Math.min(MAX_STAR, Math.max(0, Math.floor(value))) : 0
/** 读一格的 ★。两个数组理论上等长，但下标越界要给 0 而不是 undefined——
 *  undefined 进 Math.sqrt 出 NaN，会把整张卡的数字变成 NaN 而不报错。 */
const starAt = (index: number): number => clampStar(state.stars[index] ?? 0)

const shipOf = (rosterId: number) => mg.ships[rosterId]
const masterShipOf = (mstId: number) => mg.master.ships[mstId]
const masterEquipOf = (mstId: number) => mg.master.slotitems[mstId]

const equipDisplayName = (mstId: number) =>
  entityNamePlain('equip', mstId, masterEquipOf(mstId)?.name ?? `装备${mstId}`)

/** 可列入候选的装备主数据 id，小到大。1500 以上是深海栖舰专用装备，不列。
 *  名字索引与候选表两处原来各写一遍同样的枚举+过滤，口径收在这里。 */
const catalogEquipIds = (): number[] =>
  Object.keys(mg.master.slotitems)
    .map(Number)
    .filter((id) => id > 0 && id < 1500)
    .sort((a, b) => a - b)

// 名字 → mstId（回填用）。译名与日文原名都收；重名以小 id 为准。
// 失效判据要连译名版本一起算：译名表是启动后异步落地的，只按条数判的话，
// 译名到得比索引晚就永远进不了表——用户按译名输进去回填不出装备。
let nameIndex: Map<string, number> | null = null
let nameIndexKey = ''
const equipIdByName = (name: string): number => {
  const key = `${Object.keys(mg.master.slotitems).length}:${localizationVersion()}`
  if (!nameIndex || nameIndexKey !== key) {
    nameIndex = new Map()
    nameIndexKey = key
    for (const id of catalogEquipIds()) {
      const master = masterEquipOf(id)
      if (!master) continue
      for (const entry of [master.name, equipDisplayName(id)]) {
        if (entry && !nameIndex.has(entry)) nameIndex.set(entry, id)
      }
    }
  }
  return nameIndex.get(name.trim()) ?? 0
}

const slotNumOf = (ship: { shipId: number; slot: number[] }) =>
  masterShipOf(ship.shipId)?.slotNum ?? ship.slot.length

const loadShip = (rosterId: number) => {
  const ship = shipOf(rosterId)
  if (!ship) return
  state.rosterId = rosterId
  const slotNum = slotNumOf(ship)
  // 装备实例的改修星是 SlotitemInstance.level（store.ts 的 toSlotitemMap 由 api_level 落的，
  // 同结构里的 alv 是熟练度，别取错）。「还原实装」要连 ★ 一起装回来，不是只认 mstId。
  const instances = Array.from({ length: slotNum + 1 }, (_, index) => {
    const instId = index < slotNum ? ship.slot[index] : ship.slotEx
    return instId > 0 ? mg.slotitems[instId] : undefined
  })
  state.slots = instances.map((item) => item?.mstId ?? 0)
  state.stars = instances.map((item) => (item?.mstId ? clampStar(item.level) : 0))
}

/**
 * 选中这艘舰的格数变了（改造完成，比如 3 格改成 4 格）时把虚拟槽重新对齐。
 *
 * state.slots 是按**当时**的 slotNum 定长建的，末位固定是补强增设。格数变了
 * 却不重建：新格根本出不来，而补强那一格的下标还停在旧位置——它会被当成常规格
 * 参与判定，slotPickerHtml 的「补强」标签与 maxEq[index] 搭载数也跟着错格。
 * 已经摆好的模拟配装照位次搬过去，补强跟着搬到新的末位，不白丢用户的一手活。
 */
const alignSlots = () => {
  const ship = shipOf(state.rosterId)
  if (!ship) return
  const slotNum = slotNumOf(ship)
  if (state.slots.length === slotNum + 1) return
  // ★ 与装备同下标，得按同一套下标一起搬：只搬 slots 的话 ★ 全留在旧位置，
  // 每一格都配错装备。补强位一律按 slots 的旧长度取，不各自按自己的 length 取——
  // 两个数组万一长短不一，各取各的又会把补强的 ★ 配到别处。
  const previousLength = state.slots.length
  const carry = (list: readonly number[]) => {
    const previousEx = previousLength ? (list[previousLength - 1] ?? 0) : 0
    const regular = list.slice(0, Math.max(0, previousLength - 1))
    return Array.from({ length: slotNum + 1 }, (_, index) =>
      index < slotNum ? (regular[index] ?? 0) : previousEx,
    )
  }
  const stars = carry(state.stars)
  state.slots = carry(state.slots)
  state.stars = stars
}

/** 虚拟配装下的面板五维：实例面板 − 实装装备原始值 + 虚拟装备原始值。 */
const adjustedStats = () => {
  const ship = shipOf(state.rosterId)!
  const master = masterShipOf(ship.shipId)
  const currentIds = [...ship.slot, ship.slotEx]
    .filter((id) => id > 0)
    .map((id) => mg.slotitems[id]?.mstId ?? 0)
    .filter((id) => id > 0)
  const sum = (ids: number[], pick: (m: NonNullable<ReturnType<typeof masterEquipOf>>) => number) =>
    ids.reduce((total, id) => {
      const m = masterEquipOf(id)
      return total + (m ? pick(m) : 0)
    }, 0)
  const virtualIds = state.slots.filter((id) => id > 0)
  const delta = (pick: (m: NonNullable<ReturnType<typeof masterEquipOf>>) => number) =>
    sum(virtualIds, pick) - sum(currentIds, pick)
  return {
    slotNum: master?.slotNum ?? ship.slot.length,
    firepower: ship.karyoku + delta((m) => m.houg),
    torpedo: ship.raisou + delta((m) => m.raig),
    antiAir: ship.taiku + delta((m) => m.tyku),
    asw: ship.taisen + delta((m) => m.tais),
    los: ship.sakuteki + delta((m) => m.saku),
  }
}

const virtualEquips = () =>
  state.slots
    .map((mstId, index) => ({ mstId, index, level: starAt(index) }))
    .filter((entry) => entry.mstId > 0)

/** 摆进虚拟槽、且在装备主数据里**查得到**的那些。缺条目时跳过：
 *  原来三处都是 masterEquipOf(mstId)! 非空断言，缺一件就让 paint 每次抛
 *  TypeError，实验室从此静止且不给任何提示。缺件另有一行说明。 */
const virtualEquipMasters = () =>
  virtualEquips().flatMap(({ mstId, index, level }) => {
    const master = masterEquipOf(mstId)
    return master ? [{ mstId, index, level, master }] : []
  })

const missingEquipNoteHtml = (): string => {
  const missing = virtualEquips().filter(({ mstId }) => !masterEquipOf(mstId))
  if (!missing.length) return ''
  return `<div class="lab-note">有 ${missing.length} 件装备查不到（${esc(
    missing.map(({ mstId }) => `ID ${mstId}`).join('、'),
  )}），这几格按空算</div>`
}

const nightHtml = (stype: number, stats: ReturnType<typeof adjustedStats>) => {
  const entries = virtualEquipMasters()
  const equips: NightCutinEquip[] = entries.map(({ mstId, master }) => ({
    mstId,
    type2: master.type2,
    name: master.name,
    los: master.saku,
  }))
  const ship = shipOf(state.rosterId)!
  const kinds = nightCutinsOf(stype, equips)
  const base = nightBasePower({
    // 联合舰队第一舰队不参加夜战、警戒阵主力减半——两条都要「这艘在哪支舰队第几阵形」
    // 才判得了，实验室是单舰只读模拟，没有编成也没有阵形。按第二舰队（escort）算
    // 等于「不吃这两条限制」，与本页其余口径一致；这是刻意的取值，不是占位。
    role: 'escort',
    stype,
    // 耐久取真值。原来写死 hp:1/hpMax:100 恰好落在大破线以下：nightBasePower
    // 今天不读它，日后补上损伤补正就会静默按大破算，而这里根本没人改过参数。
    hp: ship.nowhp,
    hpMax: ship.maxhp,
    firepower: stats.firepower,
    torpedo: stats.torpedo,
    // 改修强化值这一项吃 ★（nightImprovement：主副砲/三式弾/徹甲弾/高射装置/探照灯 √★，
    // 魚雷 1.2√★）。原来写死 level:0，各格填了 ★ 也不进基本攻击力。
    equipment: entries.map(({ master, level }) => ({ type2: master.type2, level })),
  })
  const rows = kinds.length
    ? kinds
        .map(
          (kind) => `<div class="lab-row${kind.rolled ? '' : ' off'}" title="${esc(kind.basis)}">
        <b>${esc(kind.label)}</b><span class="mono">${kind.multiplier} 倍 × ${esc(kind.attacks)} 回</span>
        <span class="tag">${kind.rolled ? '参与判定' : '被更高倍率覆盖'}</span></div>`,
        )
        .join('')
    : '<div class="lab-none">当前组合没有夜战特殊攻击（通常攻击 1.0 倍 × 1 回）</div>'
  return `<div class="lab-card"><div class="h"><b>夜战特殊攻击</b>
      <span class="aux" title="火力 + 雷装 + 改修强化值（主砲/副砲/三式弾/徹甲弾/高射装置/探照灯 √★，魚雷 1.2√★）">夜战基本攻击力 ${Math.floor(base)}</span></div>
    ${rows}
    <div class="lab-note">种别判定不看 ★；★ 只进上面的基本攻击力</div>
  </div>`
}

const spottingHtml = (stats: ReturnType<typeof adjustedStats>) => {
  const ship = shipOf(state.rosterId)!
  const shipMaster = masterShipOf(ship.shipId)
  const spotting = (airState: number) => {
    const view: SpottingShip = {
      hp: ship.nowhp,
      hpMax: ship.maxhp,
      luck: ship.lucky,
      flagship: state.flagship,
      equipment: virtualEquipMasters().map(({ index, master }) => ({
        type2: master.type2,
        // 判定输入吃这一格的**实际**上限：弹着观测的前提之一是这一格搭载数 ≥1，
        // 而格納庫増設只会把上限抬高。扩过的舰读实例一手值（PlayerShip.onslotMax），
        // 没扩过的回落主数据原量——那种舰这里与从前完全一致。
        planeCount: index < (shipMaster?.slotNum ?? 0)
          ? hangarSlotCapacity(ship.id, index, shipMaster?.maxEq[index] ?? 0)
          : 0,
        los: master.saku,
      })),
    }
    return spottingMultiplier(view, airState)
  }
  const block = (label: string, airState: number) => {
    const outcome = spotting(airState)
    if (!outcome.rolls.length) return `<div class="lab-row off"><b>${label}</b><span>不满足前提（需主砲 + 有搭载数的水侦/水爆，且非大破）</span></div>`
    return `<div class="lab-row"><b>${label}</b><span class="mono">期望 ${outcome.expected.toFixed(2)} 倍</span></div>${outcome.rolls
      .map(
        (roll) => `<div class="lab-sub"><span>${esc(roll.type.label)}</span>
        <span class="mono">${roll.type.multiplier} 倍 × ${roll.type.attacks} 回 · ${(roll.chance * 100).toFixed(0)}%</span></div>`,
      )
      .join('')}`
  }
  return `<div class="lab-card"><div class="h"><b>昼战弹着观测</b>
      <span class="aux">运 ${ship.lucky} · ${state.flagship ? '旗舰 +15' : '随伴 +0'}<button class="lab-flag" data-lab-flag>${state.flagship ? '按随伴算' : '按旗舰算'}</button></span></div>
    ${block('制空确保', 1)}
    ${block('航空优势', 2)}
    <div class="lab-note">观测项里的装备索敌按主数据原始值算，不吃 ★</div>
  </div>`
}

const specialShipView = (asw: number): SpecialAbilityShip => {
  const ship = shipOf(state.rosterId)!
  const master = masterShipOf(ship.shipId)
  return {
    mstId: ship.shipId,
    name: master?.name ?? masterShipName(ship.shipId),
    stype: master?.stype ?? 0,
    ctype: master?.ctype ?? 0,
    slotNum: master?.slotNum ?? ship.slot.length,
    kai: master?.kai ?? false,
    asw,
  }
}

type EquipEntry = ReturnType<typeof virtualEquipMasters>[number]

const specialEquipView = ({ mstId, master }: EquipEntry): SpecialAbilityEquip => ({
  mstId,
  type2: master.type2,
  iconId: master.iconId,
  antiAir: master.tyku,
  asw: master.tais,
})

const specialEquips = (): SpecialAbilityEquip[] => virtualEquipMasters().map(specialEquipView)

/** 喷进弹幕的入参 = 对空CI 那套装备视图再加改修星（RocketBarrageEquip 本来就带 level）。 */
const barrageEquips = (): RocketBarrageEquip[] =>
  virtualEquipMasters().map((entry) => ({ ...specialEquipView(entry), level: entry.level }))

const aaciHtml = (stats: ReturnType<typeof adjustedStats>) => {
  const shipView = specialShipView(stats.asw)
  const equips = specialEquips()
  const entries = shipAacis(shipView, equips)
  const ceiling = shipAaciCeiling(shipView)
  const rows = entries.length
    ? entries
        .map(
          (entry) => `<div class="lab-row" title="${esc(entry.condition)}">
        <b>对空CI 类型 ${entry.id}</b><span class="mono">固定击坠 +${entry.fixed} · 倍率 ${entry.modifier}</span>
        <span class="tag">${esc(entry.scope)}</span></div>`,
        )
        .join('')
    : '<div class="lab-none">当前组合不发动对空 CI</div>'
  const notes = [
    entries.length && ceiling > Math.max(...entries.map((entry) => entry.fixed))
      ? `这艘舰按舰型上限还有固定击坠 ${ceiling} 的组合，当前配装没吃满`
      : '',
    '对空 CI 的成立条件不看 ★，填了改修也不多出一条',
  ].filter(Boolean)
  return `<div class="lab-card"><div class="h"><b>对空 CI</b></div>${rows}
    <div class="lab-note">${notes.join('<br>')}</div></div>`
}

const barrageHtml = () => {
  const ship = shipOf(state.rosterId)!
  const master = masterShipOf(ship.shipId)
  const shipView: RocketBarrageShip = {
    stype: master?.stype ?? 0,
    ctype: master?.ctype ?? 0,
    // 素对空要的是「不含装备」那个值。拿面板对空减装备原始值是反推，装备加成会留在
    // 里面；主数据初始值 + 近代化改修才是这个口径（对空不随等级涨，见 MasterShip）。
    baseAntiAir: (master?.baseTyku ?? 0) + (ship.kyouka[2] ?? 0),
    luck: ship.lucky,
  }
  const outcome = rocketBarrageOf(shipView, barrageEquips())
  const aux = `素对空 ${shipView.baseAntiAir}（不含装备）· 运 ${shipView.luck}${
    outcome.weightedAntiAir === null ? '' : ` · 加重对空 ${outcome.weightedAntiAir}`
  }`
  const head = `<div class="lab-card"><div class="h" title="开幕航空战发动，发动则这艘舰本次空袭完全免伤">
      <b>对空喷进弹幕</b>
      <span class="aux">${aux}</span></div>`
  // 三个值同生同死（见 aa-rocket-barrage），一并判掉：只判 rate 的话下面两处得写
  // 非空断言，而这一族断言在本文件已经害过一次（缺件让 paint 每次抛 TypeError）。
  if (outcome.rate === null || outcome.baseRate === null || outcome.weightedAntiAir === null) {
    const why = !outcome.eligible
      ? '能发动的只有航空战舰、正规空母、轻空母、装甲空母、水上机母舰、航空巡洋舰'
      : `需在虚拟槽里放 ${esc(equipDisplayName(ROCKET_LAUNCHER_K2_MST_ID))}`
    return `${head}<div class="lab-none">当前组合不发动喷进弹幕</div>
      <div class="lab-note">${why}</div></div>`
  }
  const rocketName = esc(equipDisplayName(ROCKET_LAUNCHER_K2_MST_ID))
  // 只带一根、又不是伊势型时，基本项就是全部——再单列一行会把同一个百分数写两遍，
  // 看着像算错了。加成存在时才拆，拆出来玩家才知道那 15/25 是从哪来的。
  const stacked = outcome.extraRocketBonus > 0 || outcome.iseBonus > 0
  const rows = [
    stacked
      ? `<div class="lab-sub"><span>(加重对空 ${outcome.weightedAntiAir} + 运 ${shipView.luck} × 0.9) ÷ 281</span>
          <span class="mono">${outcome.baseRate.toFixed(1)}%</span></div>`
      : '',
    outcome.extraRocketBonus
      ? `<div class="lab-sub"><span>${rocketName} ${outcome.rocketCount} 根 · 第二根起每根 +15</span>
          <span class="mono">+${outcome.extraRocketBonus}%</span></div>`
      : '',
    outcome.iseBonus
      ? `<div class="lab-sub"><span>伊势型</span><span class="mono">+${outcome.iseBonus}%</span></div>`
      : '',
  ].join('')
  // 公式不封顶，伊势改二堆满时算出来能过 100。头一行按 100 显示，原值留在说明里，
  // 免得玩家看见「157.8%」以为是算错了。
  const capped = outcome.rate > 100
  const notes = [
    capped ? `公式值 ${outcome.rate.toFixed(1)}%，按 100% 封顶显示` : '',
    '加重对空按各格填的 ★ 算：吃改修的是机铳 / 高角炮 / 高射装置，电探那一档没有改修项，填了也不动',
  ].filter(Boolean)
  return `${head}
    <div class="lab-row"><b>发动率</b><span class="mono">${capped ? '100.0' : outcome.rate.toFixed(1)}%</span></div>
    ${rows}
    <div class="lab-note">${notes.join('<br>')}</div>
  </div>`
}

const oaswHtml = (stats: ReturnType<typeof adjustedStats>) => {
  const shipView = specialShipView(stats.asw)
  const hit = openingAswOf(shipView, specialEquips())
  return `<div class="lab-card"><div class="h"><b>先制对潜</b>
      <span class="aux">表示对潜 ${stats.asw}（含虚拟装备的原始对潜值）</span></div>
    ${
      hit
        ? `<div class="lab-row"><b>可发动</b><span>${esc(hit.basis)}</span></div>`
        : '<div class="lab-none">当前组合不满足先制对潜条件</div>'
    }
    <div class="lab-note">对潜值按各装备的主数据原始值累加，不计 ★ 与熟练</div>
  </div>`
}

const slotPickerHtml = () => {
  const ship = shipOf(state.rosterId)!
  const shipMaster = masterShipOf(ship.shipId)
  const slotNum = shipMaster?.slotNum ?? ship.slot.length
  return state.slots
    .map((mstId, index) => {
      const isEx = index >= slotNum
      const label = isEx ? '补强' : `${index + 1} 格`
      const planeCap = !isEx ? (shipMaster?.maxEq[index] ?? 0) : 0
      // 搭载上限写成「原量 + 增量小字」：原量是主数据，小字是**这一艘**被格納庫増設
      // 抬高的部分。合成一个数就看不出哪部分是道具加的了。
      //
      // 悬停给同一句「搭载上限 2+1（格納庫増設）」：位置紧凑，屏幕上只写得下 2+1，
      // 道具正名靠悬停补。原量那一截也挂同一份 title——增量小字才 9px，只有它可悬停
      // 的话这句话基本摸不着。
      const extra = planeCap > 0 ? hangarExpansionOf(ship.id, index) : 0
      const capTip = extra > 0 ? esc(`搭载上限 ${planeCap}+${extra}（格納庫増設）`) : ''
      const capHtml = planeCap
        ? `<i${capTip ? ` title="${capTip}"` : ''}>${planeCap}</i>${
            extra > 0 ? `<i class="hx" title="${capTip}">+${extra}</i>` : ''
          }`
        : ''
      // 改修星只在这一格真有装备时出：空格给个 ★ 选择器既没意义，
      // 又会让空槽行跟填了装备的行一样宽。
      const star = starAt(index)
      const starHtml = mstId
        ? `<select class="lab-star${star ? ' on' : ''}" data-lab-star="${index}" title="改修星（0-${MAX_STAR}）">${Array.from(
            { length: MAX_STAR + 1 },
            (_, value) => `<option value="${value}"${value === star ? ' selected' : ''}>★${value}</option>`,
          ).join('')}</select>`
        : ''
      return `<div class="lab-slot">
      <span class="k">${label}${capHtml}</span>
      <input data-lab-slot="${index}" placeholder="输入装备名检索…" autocomplete="off"
        value="${mstId ? esc(equipDisplayName(mstId)) : ''}">
      ${starHtml}
      ${mstId ? `<span class="x" data-lab-clear="${index}" title="清空此格">✕</span>` : ''}
    </div>`
    })
    .join('')
}

// ---- 两份候选：全库枚举，按输入身份短路 ----
//
// 装备那份要走全库、还要逐件问可装备性，一次就是上千次判定。原来它挂在 paint 上
// （datalist 得随页面 HTML 一起吐出来），现在只有玩家真把浮层叫出来才算这笔账。
// 输入是整体换新对象的（mg.ships / mg.master.slotitems 随补丁替换、mstRaw 随
// start2 替换），所以按**身份**比就够，不必逐条比内容；译名表是异步落地的，
// 单独记一份版本号，否则译名到得晚就永远显示日文原名。

/** 候选行右侧那截类别小字。类别名在 start2 的 api_mst_slotitem_equiptype 上，
 *  与装备主数据分两张表，得自己按 type2 反查。 */
let equipTypeMemo: { raw: unknown; version: number; names: Map<number, string> } | null = null
const equipTypeName = (type2: number): string => {
  const version = localizationVersion()
  if (!equipTypeMemo || equipTypeMemo.raw !== mstRaw || equipTypeMemo.version !== version) {
    const names = new Map<number, string>()
    for (const type of mstRaw?.api_mst_slotitem_equiptype ?? []) {
      const id = Number(type?.api_id) || 0
      if (id > 0) names.set(id, entityNamePlain('equipType', id, `${type?.api_name ?? ''}`))
    }
    equipTypeMemo = { raw: mstRaw, version, names }
  }
  return equipTypeMemo.names.get(type2) ?? ''
}

let equipEntriesMemo: {
  slotitems: unknown
  raw: unknown
  shipMstId: number
  version: number
  entries: SuggestEntry[]
} | null = null
const equipEntries = (): SuggestEntry[] => {
  const ship = shipOf(state.rosterId)
  if (!ship) return []
  const version = localizationVersion()
  if (
    equipEntriesMemo &&
    equipEntriesMemo.slotitems === mg.master.slotitems &&
    equipEntriesMemo.raw === mstRaw &&
    equipEntriesMemo.shipMstId === ship.shipId &&
    equipEntriesMemo.version === version
  ) {
    return equipEntriesMemo.entries
  }
  const entries: SuggestEntry[] = []
  for (const id of catalogEquipIds()) {
    if (!shipCanEquipItem(mstRaw, ship.shipId, id)) continue
    const master = masterEquipOf(id)
    entries.push({
      // 填回去的还是译名：那头 equipIdByName 拿它反查 mstId
      value: equipDisplayName(id),
      // 日文原名不显示、但参与匹配——名字索引本来就两种名字都收，
      // 候选却只认译名的话，照日文原名输进去是「打得出、搜不到」
      alias: master?.name,
      hint: equipTypeName(master?.type2 ?? 0),
    })
  }
  equipEntriesMemo = {
    slotitems: mg.master.slotitems,
    raw: mstRaw,
    shipMstId: ship.shipId,
    version,
    entries,
  }
  return entries
}

let shipEntriesMemo: { ships: unknown; version: number; entries: SuggestEntry[] } | null = null
const shipEntries = (): SuggestEntry[] => {
  const version = localizationVersion()
  if (shipEntriesMemo && shipEntriesMemo.ships === mg.ships && shipEntriesMemo.version === version) {
    return shipEntriesMemo.entries
  }
  const entries = Object.values(mg.ships)
    .sort((a, b) => b.lv - a.lv)
    .map((ship) => {
      const name = entityNamePlain('ship', ship.shipId, masterShipName(ship.shipId))
      return {
        // 字面值一个字都不改：那头靠尾巴上的 #编号 精确定位到这一艘
        value: `${name} Lv${ship.lv} #${ship.id}`,
        label: name,
        alias: masterShipName(ship.shipId),
        hint: `Lv${ship.lv} · #${ship.id}`,
      }
    })
  shipEntriesMemo = { ships: mg.ships, version, entries }
  return entries
}

const SHIP_FIELD: SuggestField = {
  entries: shipEntries,
  previewNote: `等级最高的 ${SUGGEST_PREVIEW} 艘，输入舰名接着找`,
  emptyText: '仓库里没有匹配的舰娘',
}
const EQUIP_FIELD: SuggestField = {
  entries: equipEntries,
  previewNote: `这艘舰能装的前 ${SUGGEST_PREVIEW} 件，输入名字接着找`,
  emptyText: '没有匹配的装备（只列这艘舰装得上的）',
}
/** 这个输入框归哪一份候选管；两个都不是就不是联想框（★ 选择器等） */
const suggestFieldOf = (target: EventTarget | null): SuggestField | null => {
  if (!(target instanceof HTMLInputElement)) return null
  if (target.id === 'ji-lab-ship') return SHIP_FIELD
  return target.dataset.labSlot !== undefined ? EQUIP_FIELD : null
}

const labHtml = (): string => {
  const ship = shipOf(state.rosterId)
  if (!ship) {
    return `<div class="lab-head">
        <b>组合实验室</b>
        <span class="aux">选一艘仓库舰娘，摆装备看她能发动哪些 CI</span>
      </div>
      <div class="lab-pick"><span class="k">舰娘</span>
        <input id="ji-lab-ship" placeholder="输入舰名检索仓库…" autocomplete="off"></div>`
  }
  // 选中这艘舰改造完了（3 格→4 格）就得先把虚拟槽按新形态对齐，
  // 否则下面每一处 index 都是按旧格数算的。
  alignSlots()
  const master = masterShipOf(ship.shipId)
  const stats = adjustedStats()
  return `<div class="lab-head" title="虚拟装备的改修星按各格填的算，熟练度一律按未熟练">
      <b>组合实验室</b>
    </div>
    <div class="lab-pick"><span class="k">舰娘</span>
      <input id="ji-lab-ship" autocomplete="off" value="${esc(`${entityNamePlain('ship', ship.shipId, masterShipName(ship.shipId))} Lv${ship.lv} #${ship.id}`)}">
      <span class="x" data-lab-ship-clear title="清空舰娘与虚拟槽，重新选一艘">✕</span>
      <span class="lab-ship-meta">${elinkHtml('ship', ship.id, entityNameHtml('ship', ship.shipId, masterShipName(ship.shipId), { compact: true }))}
        <span class="mono">Lv${ship.lv} · 火${stats.firepower} 雷${stats.torpedo} 空${stats.antiAir} 潜${stats.asw} 索${stats.los} 运${ship.lucky}</span>
        <button data-lab-reset title="装回这艘舰当前的真实配装">还原实装</button></span>
    </div>
    <div class="lab-slots">${slotPickerHtml()}</div>
    ${missingEquipNoteHtml()}
    <div class="lab-results">
      ${nightHtml(master?.stype ?? 0, stats)}
      ${spottingHtml(stats)}
      ${aaciHtml(stats)}
      ${barrageHtml()}
      ${oaswHtml(stats)}
    </div>`
}

/** 这块面板在逐字节闸门里的键（applyPaneHtml 按 root + key 记上次提交的那份） */
const LAB_KEY = 'ji-lab'

/**
 * 被动重绘：输出与上次逐字节相同就整段不动 DOM。
 *
 * 实验室是被鉴的 render 尾部**无条件**调用的（materials 变一次也算），而重建
 * innerHTML 会把输入框连同正在敲的半个装备名一起换掉——自绘浮层的锚点也就没了。
 * 闸门口径与 kernel 那两道一致，这里只是把实验室这块也接进去。
 */
const paint = () => {
  // 真换了 DOM 就把浮层收掉：锚着的那个输入框已经不在文档里了，
  // 留着它就是一块贴在旧位置、点了也没人接的候选表
  if (applyPaneHtml(labHost, LAB_KEY, labHtml())) closeSuggest()
}

/**
 * 玩家自己动出来的重绘：先把逐字节记忆作废，这一次一定换 DOM。
 *
 * 改了输入框、状态却没变的那几种（敲了一半的名字、认不出的名字、同一件重敲一遍）
 * 全靠这一下把输入框抹回状态里的值——只走闸门的话输出没变，那串认不出的字会一直留着。
 */
const repaint = () => {
  forgetCommittedHtml(labHost, LAB_KEY)
  paint()
}

let wired = false
const wire = () => {
  if (wired) return
  wired = true
  labHost.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement
    if (target.id === 'ji-lab-ship') {
      const match = target.value.match(/#(\d+)\s*$/)
      const byId = match ? Number(match[1]) : 0
      if (byId && shipOf(byId)) {
        loadShip(byId)
      } else {
        // 没带 #id 的手输：按名字挑等级最高的一艘
        const wanted = target.value.replace(/\s+Lv\d+.*$/, '').trim()
        const candidates = Object.values(mg.ships)
          .filter((ship) =>
            entityNamePlain('ship', ship.shipId, masterShipName(ship.shipId)) === wanted ||
            masterShipName(ship.shipId) === wanted,
          )
          .sort((a, b) => b.lv - a.lv)
        if (candidates[0]) loadShip(candidates[0].id)
      }
      repaint()
      return
    }
    const starIndex = target.dataset.labStar
    if (starIndex !== undefined) {
      state.stars[Number(starIndex)] = clampStar(Number(target.value))
      repaint()
      return
    }
    const slotIndex = target.dataset.labSlot
    if (slotIndex !== undefined) {
      const index = Number(slotIndex)
      const id = equipIdByName(target.value)
      const ship = shipOf(state.rosterId)
      if (id && ship && shipCanEquipItem(mstRaw, ship.shipId, id)) {
        // 换成**别的**装备才把 ★ 归零：同一件重新选一遍（浮层回填经常这样）
        // 不该把刚填好的改修抹掉。
        if (state.slots[index] !== id) state.stars[index] = 0
        state.slots[index] = id
      } else if (!target.value.trim()) {
        state.slots[index] = 0
        state.stars[index] = 0
      }
      repaint()
    }
  })
  labHost.addEventListener('click', (event) => {
    const target = event.target as HTMLElement
    const clear = target.closest<HTMLElement>('[data-lab-clear]')
    if (clear) {
      const index = Number(clear.dataset.labClear)
      state.slots[index] = 0
      state.stars[index] = 0
      repaint()
      return
    }
    if (target.closest('[data-lab-ship-clear]')) {
      // 回到「未选舰娘」态，与启动时的初值一致。今天下一艘舰进来走的是 loadShip，
      // 两个数组都会被整体换掉，留着旧的也读不出去；清掉是不给日后留雷——
      // 「没选舰娘却存着上一艘的配装」这种状态迟早会被某处不查 rosterId 的代码读到。
      // flagship 不动：那是看结果的口径开关，不属于某一艘舰。
      state.rosterId = 0
      state.slots = []
      state.stars = []
      repaint()
      // 重绘换掉了整块 innerHTML，输入框是新的空 input——聚焦上去，
      // 玩家点完 ✕ 就能直接敲下一个舰名，不必再去点一次输入框。
      labHost.querySelector<HTMLInputElement>('#ji-lab-ship')?.focus()
      return
    }
    if (target.closest('[data-lab-reset]')) {
      loadShip(state.rosterId)
      repaint()
      return
    }
    if (target.closest('[data-lab-flag]')) {
      state.flagship = !state.flagship
      repaint()
    }
  })

  // ---- 自绘联想下拉的接线 ----
  //
  // 一律走 labHost 上的事件委托：重绘会把输入框整批换新，
  // 逐个 addEventListener 的话每次重绘都得重挂一遍（挂漏了就是「这一格不弹候选」）。
  labHost.addEventListener('focusin', (event) => {
    const field = suggestFieldOf(event.target)
    if (field) openSuggest(event.target as HTMLInputElement, field)
  })
  labHost.addEventListener('focusout', (event) => {
    if (suggestFieldOf(event.target)) scheduleSuggestClose()
  })
  // 组合期间不重列候选：那时框里是半截拼音，照它过滤只会得到一片空。
  // 组合结束后 onFilterInput 会补做一次，那时框里才是玩家真正要搜的词。
  onFilterInput(labHost, (event) => {
    const field = suggestFieldOf(event.target)
    if (field) openSuggest(event.target as HTMLInputElement, field)
  })
  labHost.addEventListener('keydown', (event) => {
    const field = suggestFieldOf(event.target)
    if (field) suggestKeydown(event, event.target as HTMLInputElement, field)
  })
}

/** 装备卷切到实验室模式时由鉴调用：挂宿主 + 重画。 */
export const mountLab = (slot: HTMLElement, raw: any) => {
  mstRaw = raw
  wire()
  if (labHost.parentElement !== slot) slot.appendChild(labHost)
  paint()
}
