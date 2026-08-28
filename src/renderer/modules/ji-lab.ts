// 组合实验室（2026-08-12 用户提议）：在装备图鉴里模拟/查询配装的各种 CI。
//
// 形态：选一艘仓库舰娘 → 按可装备规则往虚拟槽里放装备 → 实时报四类结论：
//   夜战特殊攻击（shared/night-cutin，wikiwiki 夜戦 口径）
//   昼战弹着观测（shared/day-spotting，确保/优势两档发动率）
//   对空 CI（shared/ship-special-attack，poi/wikiwiki 对空砲火表）
//   先制对潜（同上，wikiwiki 発動条件）
// 只读模拟：不动游戏、不动真实配装。虚拟装备一律按未改修算（改修对判定
// 无影响，只影响数值；数值行已注明口径）。
import { esc, hangarExpansionOf, hangarSlotCapacity, masterShipName, mg } from '../kernel'
import { elinkHtml } from '../link'
import { entityNameHtml, entityNamePlain, localizationVersion } from '../localization'
import { shipCanEquipItem } from '../../shared/equipability'
import { nightCutinsOf, type NightCutinEquip } from '../../shared/night-cutin'
import { nightBasePower } from '../../shared/night-battle'
import { spottingMultiplier, type SpottingShip } from '../../shared/day-spotting'
import {
  openingAswOf,
  shipAacis,
  shipAaciCeiling,
  type SpecialAbilityEquip,
  type SpecialAbilityShip,
} from '../../shared/ship-special-attack'

export const labHost = document.createElement('div')
labHost.className = 'ji-lab'

interface LabState {
  rosterId: number
  /** 常规槽 + 最后一格补强增设；0 = 空 */
  slots: number[]
  flagship: boolean
}
const state: LabState = { rosterId: 0, slots: [], flagship: true }
let mstRaw: any = null

const shipOf = (rosterId: number) => mg.ships[rosterId]
const masterShipOf = (mstId: number) => mg.master.ships[mstId]
const masterEquipOf = (mstId: number) => mg.master.slotitems[mstId]

const equipDisplayName = (mstId: number) =>
  entityNamePlain('equip', mstId, masterEquipOf(mstId)?.name ?? `装备${mstId}`)

/** 可列入候选的装备主数据 id，小到大。1500 以上是深海栖舰专用装备，不列。
 *  名字索引与 datalist 两处原来各写一遍同样的枚举+过滤，口径收在这里。 */
const catalogEquipIds = (): number[] =>
  Object.keys(mg.master.slotitems)
    .map(Number)
    .filter((id) => id > 0 && id < 1500)
    .sort((a, b) => a - b)

// 名字 → mstId（datalist 回填用）。译名与日文原名都收；重名以小 id 为准。
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
  state.slots = Array.from({ length: slotNum + 1 }, (_, index) => {
    const instId = index < slotNum ? ship.slot[index] : ship.slotEx
    return instId > 0 ? (mg.slotitems[instId]?.mstId ?? 0) : 0
  })
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
  const previousEx = state.slots.length ? state.slots[state.slots.length - 1] : 0
  const regular = state.slots.slice(0, Math.max(0, state.slots.length - 1))
  state.slots = Array.from({ length: slotNum + 1 }, (_, index) =>
    index < slotNum ? (regular[index] ?? 0) : previousEx,
  )
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
    .map((mstId, index) => ({ mstId, index }))
    .filter((entry) => entry.mstId > 0)

/** 摆进虚拟槽、且在装备主数据里**查得到**的那些。缺条目时跳过：
 *  原来三处都是 masterEquipOf(mstId)! 非空断言，缺一件就让 paint 每次抛
 *  TypeError，实验室从此静止且不给任何提示。缺件另有一行说明。 */
const virtualEquipMasters = () =>
  virtualEquips().flatMap(({ mstId, index }) => {
    const master = masterEquipOf(mstId)
    return master ? [{ mstId, index, master }] : []
  })

const missingEquipNoteHtml = (): string => {
  const missing = virtualEquips().filter(({ mstId }) => !masterEquipOf(mstId))
  if (!missing.length) return ''
  return `<div class="lab-note">有 ${missing.length} 件装备查不到（${esc(
    missing.map(({ mstId }) => `ID ${mstId}`).join('、'),
  )}），这几格按空算</div>`
}

const nightHtml = (stype: number, stats: ReturnType<typeof adjustedStats>) => {
  const equips: NightCutinEquip[] = virtualEquipMasters().map(({ mstId, master }) => ({
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
    equipment: equips.map((item) => ({ type2: item.type2, level: 0 })),
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
      <span class="aux" title="火力+雷装">夜战基本攻击力 ${Math.floor(base)}</span></div>
    ${rows}
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

const specialEquips = (): SpecialAbilityEquip[] =>
  virtualEquipMasters().map(({ mstId, master }) => ({
    mstId,
    type2: master.type2,
    iconId: master.iconId,
    antiAir: master.tyku,
    asw: master.tais,
  }))

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
  const hint =
    entries.length && ceiling > Math.max(...entries.map((entry) => entry.fixed))
      ? `<div class="lab-note">这艘舰按舰型上限还有固定击坠 ${ceiling} 的组合，当前配装没吃满。</div>`
      : ''
  return `<div class="lab-card"><div class="h"><b>对空 CI</b></div>${rows}${hint}</div>`
}

const oaswHtml = (stats: ReturnType<typeof adjustedStats>) => {
  const shipView = specialShipView(stats.asw)
  const hit = openingAswOf(shipView, specialEquips())
  return `<div class="lab-card"><div class="h"><b>先制对潜</b>
      <span class="aux">表示对潜 ${stats.asw}（含虚拟装备，未计改修/熟练）</span></div>
    ${
      hit
        ? `<div class="lab-row"><b>可发动</b><span>${esc(hit.basis)}</span></div>`
        : '<div class="lab-none">当前组合不满足先制对潜条件</div>'
    }
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
      return `<div class="lab-slot">
      <span class="k">${label}${capHtml}</span>
      <input data-lab-slot="${index}" list="ji-lab-equips" placeholder="输入装备名检索…"
        value="${mstId ? esc(equipDisplayName(mstId)) : ''}">
      ${mstId ? `<span class="x" data-lab-clear="${index}" title="清空此格">✕</span>` : ''}
    </div>`
    })
    .join('')
}

// ---- 两份 datalist：全库枚举，按输入身份短路 ----
//
// paint 被鉴的 render 尾部**无条件**调用（materials 变一次也算），而这两份候选表
// 都要走全库：装备那份还要逐件问可装备性，一次重绘上千次判定。
// 输入是整体换新对象的（mg.ships / mg.master.slotitems 随补丁替换、mstRaw 随
// start2 替换），所以按**身份**比就够，不必逐条比内容；译名表是异步落地的，
// 单独记一份版本号，否则译名到得晚就永远显示日文原名。
let equipOptionsMemo: {
  slotitems: unknown
  raw: unknown
  shipMstId: number
  version: number
  html: string
} | null = null
const equipOptionsHtml = () => {
  const ship = shipOf(state.rosterId)
  if (!ship) return ''
  const version = localizationVersion()
  if (
    equipOptionsMemo &&
    equipOptionsMemo.slotitems === mg.master.slotitems &&
    equipOptionsMemo.raw === mstRaw &&
    equipOptionsMemo.shipMstId === ship.shipId &&
    equipOptionsMemo.version === version
  ) {
    return equipOptionsMemo.html
  }
  const options: string[] = []
  for (const id of catalogEquipIds()) {
    if (!shipCanEquipItem(mstRaw, ship.shipId, id)) continue
    options.push(`<option value="${esc(equipDisplayName(id))}"></option>`)
  }
  const html = `<datalist id="ji-lab-equips">${options.join('')}</datalist>`
  equipOptionsMemo = {
    slotitems: mg.master.slotitems,
    raw: mstRaw,
    shipMstId: ship.shipId,
    version,
    html,
  }
  return html
}

let shipOptionsMemo: { ships: unknown; version: number; html: string } | null = null
const shipOptionsHtml = () => {
  const version = localizationVersion()
  if (shipOptionsMemo && shipOptionsMemo.ships === mg.ships && shipOptionsMemo.version === version) {
    return shipOptionsMemo.html
  }
  const rows = Object.values(mg.ships)
    .map((ship) => ({
      ship,
      label: `${entityNamePlain('ship', ship.shipId, masterShipName(ship.shipId))} Lv${ship.lv} #${ship.id}`,
    }))
    .sort((a, b) => b.ship.lv - a.ship.lv)
  const html = `<datalist id="ji-lab-ships">${rows
    .map((row) => `<option value="${esc(row.label)}"></option>`)
    .join('')}</datalist>`
  shipOptionsMemo = { ships: mg.ships, version, html }
  return html
}

const paint = () => {
  const ship = shipOf(state.rosterId)
  if (!ship) {
    labHost.innerHTML = `<div class="lab-head">
        <b>组合实验室</b>
        <span class="aux">选一艘仓库舰娘，摆装备看她能发动哪些 CI</span>
      </div>
      <div class="lab-pick"><span class="k">舰娘</span>
        <input id="ji-lab-ship" list="ji-lab-ships" placeholder="输入舰名检索仓库…"></div>
      ${shipOptionsHtml()}`
    return
  }
  // 选中这艘舰改造完了（3 格→4 格）就得先把虚拟槽按新形态对齐，
  // 否则下面每一处 index 都是按旧格数算的。
  alignSlots()
  const master = masterShipOf(ship.shipId)
  const stats = adjustedStats()
  labHost.innerHTML = `<div class="lab-head" title="虚拟装备按未改修/未熟练算">
      <b>组合实验室</b>
    </div>
    <div class="lab-pick"><span class="k">舰娘</span>
      <input id="ji-lab-ship" list="ji-lab-ships" value="${esc(`${entityNamePlain('ship', ship.shipId, masterShipName(ship.shipId))} Lv${ship.lv} #${ship.id}`)}">
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
      ${oaswHtml(stats)}
    </div>
    ${shipOptionsHtml()}
    ${equipOptionsHtml()}`
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
      paint()
      return
    }
    const slotIndex = target.dataset.labSlot
    if (slotIndex !== undefined) {
      const index = Number(slotIndex)
      const id = equipIdByName(target.value)
      const ship = shipOf(state.rosterId)
      if (id && ship && shipCanEquipItem(mstRaw, ship.shipId, id)) {
        state.slots[index] = id
      } else if (!target.value.trim()) {
        state.slots[index] = 0
      }
      paint()
    }
  })
  labHost.addEventListener('click', (event) => {
    const target = event.target as HTMLElement
    const clear = target.closest<HTMLElement>('[data-lab-clear]')
    if (clear) {
      state.slots[Number(clear.dataset.labClear)] = 0
      paint()
      return
    }
    if (target.closest('[data-lab-reset]')) {
      loadShip(state.rosterId)
      paint()
      return
    }
    if (target.closest('[data-lab-flag]')) {
      state.flagship = !state.flagship
      paint()
    }
  })
}

/** 装备卷切到实验室模式时由鉴调用：挂宿主 + 重画。 */
export const mountLab = (slot: HTMLElement, raw: any) => {
  mstRaw = raw
  wire()
  if (labHost.parentElement !== slot) slot.appendChild(labHost)
  paint()
}
