/**
 * 在籍舰实例的属性三层拆解：目前裸值 / 装备给予 / 可提升余量。
 *
 * 与图鉴的「形态潜力分层」是姊妹口径——图鉴答「这一形态练满能到哪」，
 * 这里答「你这一艘现在的面板由什么构成、还能再长多少」。
 *
 * 逐项口径（可提升段沿用图鉴的来源色语，方便两个面板对读）：
 * - 火力/雷装/对空/装甲：裸值 = 主数据初始 + 近代化改修（一手精确）；
 *   装备给予 = 面板 − 裸值（含装备原始值、改修★与套装加成，正是「装备给的一切」）；
 *   可提升 = 近代化改修余量（kind: mod）。
 * - 运：裸值 = 面板（装备不改运）；可提升 = 改修余量到主数据上限（kind: mod）。
 * - 耐久：裸值 = 当前最大耐久（已含结婚与改修）；可提升 = 未婚时的结婚档位
 *   （kind: marriage）+ 改修到 api_taik[1]（kind: mod）。
 * - 回避/对潜/索敌：裸值按成长公式（初始值来自社区矿脉，Lv99 上限用实例
 *   一手 [1]；对潜再加改修点）。全空槽时直接取面板当裸值——那就是一手裸值。
 *   装备给予 = 面板 − 裸值；可提升 = 成长余量（≤99 用 grow 色，婚后用 over99 色）。
 *   初始值缺资料且带着装备时，裸值/成长余量拆不出来，照实标缺（数据诚实）。
 */
import { levelGrowth, MARRIED_LEVEL_CAP, marriageHpBonus, marriedMaxHp } from './ship-growth'
import type { MasterShip, MasterSlotitem, PlayerShip } from './mg-types'

export type StatLayerKind = 'equip' | 'grow' | 'over99' | 'marriage' | 'mod'

export interface InstanceStatRow {
  label: string
  /** 目前裸值；带装备且初始值缺资料时为 null（拆不出来，不硬造） */
  bare: number | null
  /** 依次追加的绝对值段（值为轨道上的到达点，不是增量） */
  segments: { value: number | null; kind: StatLayerKind }[]
  tip: string
}

/** 三维初始值（社区矿脉：kcwiki 数据 → wikiwiki 舰页），缺资料传 null */
export interface GrowthInitValues {
  kaihi: number | null
  taisen: number | null
  sakuteki: number | null
}

const clampUp = (value: number) => Math.max(0, value)

/** 近代化改修四项 + 运：裸值一手精确，装备差值含套装/改修★ */
const modernizableRow = (
  label: string,
  panel: number,
  base: number,
  kyouka: number,
  max: number,
  equipRaw: number,
): InstanceStatRow => {
  const bare = base + kyouka
  const equipGiven = panel - bare
  const extra = equipGiven - equipRaw // 套装加成 + 装备改修★（面板反推，口径同 fleet-calc）
  const modRemain = clampUp(max - bare)
  const tip = [
    `目前裸值 ${bare}（初始 ${base}${kyouka ? ` + 近代化改修 ${kyouka}` : ''}）`,
    equipGiven
      ? `装备给予 ${equipGiven > 0 ? '+' : ''}${equipGiven}（装备原始值 ${equipRaw}${
          extra ? `，套装/改修★ ${extra > 0 ? '+' : ''}${extra}` : ''
        }）`
      : '装备对此项无加成',
    modRemain ? `近代化改修余量 +${modRemain} → 上限 ${max}` : `近代化改修已满（上限 ${max}）`,
  ].join('\n')
  return {
    label,
    bare,
    segments: [
      { value: equipGiven !== 0 ? panel : null, kind: 'equip' },
      { value: modRemain ? panel + modRemain : null, kind: 'mod' },
    ],
    tip,
  }
}

const luckRow = (ship: PlayerShip, mst: MasterShip): InstanceStatRow => {
  const remain = clampUp(mst.maxLuck - ship.lucky)
  return {
    label: '运',
    bare: ship.lucky,
    segments: [{ value: remain ? ship.lucky + remain : null, kind: 'mod' }],
    tip: `目前裸值 ${ship.lucky}（装备不改运）\n${
      remain ? `近代化改修余量 +${remain} → 上限 ${mst.maxLuck}` : `近代化改修已满（上限 ${mst.maxLuck}）`
    }`,
  }
}

const hpRow = (ship: PlayerShip, mst: MasterShip): InstanceStatRow => {
  const married = ship.lv > 99
  const bonus = marriageHpBonus(mst.baseTaik)
  const afterMarriage = marriedMaxHp(mst.baseTaik, mst.maxTaik)
  const marriageTo =
    !married && afterMarriage != null && afterMarriage > ship.maxhp ? afterMarriage : null
  const modTo = mst.maxTaik > Math.max(ship.maxhp, marriageTo ?? 0) ? mst.maxTaik : null
  return {
    label: '耐久',
    bare: ship.maxhp,
    segments: [
      { value: marriageTo, kind: 'marriage' },
      { value: modTo, kind: 'mod' },
    ],
    tip: [
      `目前最大耐久 ${ship.maxhp}${married ? '（已含结婚加成）' : ''}`,
      marriageTo != null ? `结婚 +${bonus}（档位按未婚初始耐久分档）→ ${marriageTo}` : '',
      modTo != null ? `改修上限 ${modTo}` : `已到改修上限 ${mst.maxTaik}`,
    ]
      .filter(Boolean)
      .join('\n'),
  }
}

/** 回避/对潜/索敌：成长公式拆裸值，一手 [1] 当 Lv99 上限 */
const growthStatRow = (
  label: string,
  panel: number,
  max99: number,
  init: number | null,
  ship: PlayerShip,
  equipRaw: number,
  hasEquip: boolean,
  kyouka = 0,
): InstanceStatRow => {
  const capLv = ship.lv > 99 ? MARRIED_LEVEL_CAP : 99
  const growText = `随等级成长：估算 = 初始 + ⌊(上限−初始)×Lv÷99⌋，Lv99 上限取实例一手值`
  // 全空槽：面板就是一手裸值，不需要公式（公式反而带 ±1 估算误差）
  if (!hasEquip) {
    const bare = panel
    // 成长终点：有初始值走公式；缺初始值但 Lv≤99 时终点就是一手上限本身；
    // 婚后缺初始值算不出斜率，照实说算不出
    const growTo =
      max99 > 0
        ? init != null
          ? levelGrowth(init, max99, capLv)
          : ship.lv <= 99
            ? max99
            : null
        : null
    const remain = growTo != null ? clampUp(growTo + kyouka - bare) : null
    return {
      label,
      bare,
      segments: [
        { value: remain ? bare + remain : null, kind: ship.lv > 99 ? 'over99' : 'grow' },
      ],
      tip: [
        `目前裸值 ${bare}（未装备，面板即一手裸值${kyouka ? `，含改修 ${kyouka}` : ''}）`,
        remain == null
          ? max99 <= 0
            ? '成长余量：当前记录缺少 Lv99 上限，无法计算'
            : '成长余量：暂缺初始值，无法计算婚后成长'
          : remain
            ? `至 Lv${capLv} 估算可成长 +${remain}`
            : `已达 Lv${capLv} 成长上限`,
        growText,
      ].join('\n'),
    }
  }
  if (init == null || max99 <= 0) {
    // 带装备又缺初始值：裸值/装备拆不出来。面板照画（equip 色兜底），缺口写明。
    return {
      label,
      bare: null,
      segments: [{ value: panel, kind: 'equip' }],
      tip: [
        `面板 ${panel}（含装备）`,
        max99 <= 0
          ? '当前记录缺少 Lv99 上限，无法拆分裸值'
          : '暂缺初始值，无法拆分裸值与装备加成',
      ].join('\n'),
    }
  }
  const grown = levelGrowth(init, max99, ship.lv)
  const bare = (grown ?? 0) + kyouka
  const equipGiven = panel - bare
  const future = (levelGrowth(init, max99, capLv) ?? bare) + kyouka
  const remain = clampUp(future - bare)
  return {
    label,
    bare,
    segments: [
      { value: equipGiven !== 0 ? panel : null, kind: 'equip' },
      { value: remain ? panel + remain : null, kind: ship.lv > 99 ? 'over99' : 'grow' },
    ],
    tip: [
      `估算裸值 ${bare}（成长计算${kyouka ? ` + 改修 ${kyouka}` : ''} · 误差 ±1）`,
      equipGiven
        ? `装备给予 ${equipGiven > 0 ? '+' : ''}${equipGiven}（装备原始值 ${equipRaw}${
            equipGiven - equipRaw ? '，其余为套装加成或估算误差' : ''
          }）`
        : '装备对此项无加成',
      remain ? `至 Lv${capLv} 估算可成长 +${remain}` : `已达 Lv${capLv} 成长上限`,
      growText,
    ].join('\n'),
  }
}

/**
 * 组装九行属性条。equips 传该实例身上装备的 master 条目（含补强增设）；
 * init 传三维初始值矿脉查得的结果，缺就 null。
 */
export const instanceStatRows = (
  ship: PlayerShip,
  mst: MasterShip,
  equips: MasterSlotitem[],
  init: GrowthInitValues,
): InstanceStatRow[] => {
  const sum = (pick: (e: MasterSlotitem) => number) =>
    equips.reduce((acc, e) => acc + (pick(e) || 0), 0)
  const hasEquip = equips.length > 0
  const ky = (i: number) => ship.kyouka[i] ?? 0
  return [
    hpRow(ship, mst),
    modernizableRow('火力', ship.karyoku, mst.baseHoug, ky(0), mst.maxHoug, sum((e) => e.houg)),
    modernizableRow('装甲', ship.soukou, mst.baseSouk, ky(3), mst.maxSouk, sum((e) => e.souk)),
    modernizableRow('雷装', ship.raisou, mst.baseRaig, ky(1), mst.maxRaig, sum((e) => e.raig)),
    modernizableRow('对空', ship.taiku, mst.baseTyku, ky(2), mst.maxTyku, sum((e) => e.tyku)),
    growthStatRow('回避', ship.kaihi, ship.kaihiMax, init.kaihi, ship, sum((e) => e.houk), hasEquip),
    growthStatRow('对潜', ship.taisen, ship.taisenMax, init.taisen, ship, sum((e) => e.tais), hasEquip, ky(6)),
    growthStatRow('索敌', ship.sakuteki, ship.sakutekiMax, init.sakuteki, ship, sum((e) => e.saku), hasEquip),
    luckRow(ship, mst),
  ]
}
