// 任务详情与维护者审计共用的数据 → 索引；不读文件、不碰 renderer 状态。
import { buildTaskMapNameIndex } from './map-name-index'
import { QUEST_SHIP_TYPE_GROUPS } from '../shared/quest-ship-type-groups'
import { buildTaskExpeditionNameIndex } from './expedition-name-index'
import { buildShipClassNameIndex } from '../shared/ship-class-name'
import type { ShipClassNameRow } from '../shared/ship-class-name'
import { buildShipRemodelChains } from '../shared/ship-remodel-chain'
import type { RemodelChainShip } from '../shared/ship-remodel-chain'
import { normalizeTaskEntityText as normalizeEntityText, TASK_SHIP_TEXT_ALIASES, TASK_EQUIP_TEXT_ALIASES, TASK_ITEM_TEXT_ALIASES } from './task-entity-match'

export type TaskEntityLocalizedName = (domain: 'ship' | 'equip' | 'map' | 'item' | 'shipType' | 'equipType' | 'expedition', id: number, original: string) => string

export interface EntityNameIndex {
  id: number
  name: string
  simple: string
  aliases: string[]
}
export interface ShipNameEntry extends EntityNameIndex {
  ctype: number
  stype: number
  sortNo: number
  members: number[]
}
export interface ShipClassEntry extends EntityNameIndex {
  members: ShipNameEntry[]
}
const SHIP_TYPE_ALIASES: Record<number, string[]> = {
  1: ['海防'], 2: ['驱逐'], 3: ['轻巡'], 4: ['雷巡'], 5: ['重巡'], 6: ['航巡'],
  7: ['轻母', '轻空母', '轻航母', '轻型航母'], 8: ['高速战舰'], 9: ['低速战舰'], 10: ['航战', '航空战舰'],
  11: ['空母', '正航', '正规空母'], 12: ['超弩级战舰'], 13: ['潜艇', '潜水舰'], 14: ['潜母'],
  16: ['水母'], 17: ['扬陆舰'], 18: ['装母', '装甲空母'], 19: ['工作舰'],
  20: ['潜水母舰'], 21: ['练巡'], 22: ['补给舰'],
}

const SHIP_TYPE_LABELS: Record<number, string> = {
  8: '高速战舰',
  9: '低速战舰',
}

const EQUIP_TYPE_ALIASES: Record<number, string[]> = {
  1: ['小口径炮'], 2: ['中口径炮'], 3: ['大口径炮'], 4: ['副炮'], 5: ['鱼雷'],
  6: ['舰战'], 7: ['舰爆'], 8: ['舰攻'], 9: ['舰侦'], 10: ['水侦'], 11: ['水爆'],
  12: ['小型电探', '电探'], 13: ['大型电探', '电探'], 14: ['声呐', '水听'], 15: ['爆雷'],
  21: ['机枪', '对空机枪'], 24: ['大发', '登陆艇'], 25: ['旋翼机'], 26: ['反潜机'],
  41: ['大艇', '大型飞行艇'], 45: ['水战'], 47: ['陆攻'], 48: ['陆战'], 49: ['陆侦'],
}

const EQUIP_TYPE_GENERIC_ALIASES: Record<number, Set<string>> = {
  12: new Set(['电探']),
  13: new Set(['电探']),
}

export const taskEntityAliases = (
  domain: 'ship' | 'equip' | 'map' | 'item' | 'shipType' | 'equipType' | 'expedition',
  id: number,
  original: string,
  extra: string[] = [],
  entityNamePlain: TaskEntityLocalizedName,
) =>
  [...new Set([original, entityNamePlain(domain, id, original), ...extra].map(normalizeEntityText).filter(Boolean))]
    .sort((a, b) => b.length - a.length)

export const buildTaskEntityIndexes = (
  data: any,
  entityNamePlain: TaskEntityLocalizedName,
  expeditionData: any = null,
  kcwikiShipData: any = null,
) => {
  const aliasesFor = (domain: Parameters<TaskEntityLocalizedName>[0], id: number, original: string, extra: string[] = []) =>
    taskEntityAliases(domain, id, original, extra, entityNamePlain)
  const friendly: any[] = []
  const shipById = new Map<number, any>()
  for (const s of data.api_mst_ship ?? []) {
    if (s.api_sortno) {
      friendly.push(s)
      shipById.set(s.api_id, s)
    }
  }
  // 改造链归属只认 shared/ship-remodel-chain：自己搭并查集就是第二套口径，
  // 可逆改装（改二⇄乙/丙）的回环边会让手搓的链根断在半路，与图鉴说法分叉。
  // 改造表**盖不全**：不需要设计图/图纸的那些改造根本不在 api_mst_shipupgrade 里
  //（实测 Tuscaloosa 923→928 就没有条目），所以每艘舰自己的 aftershipid 必须
  // 一并喂进去，由那边逐目标回退——不能因为升级表非空就整体弃用 aftershipid。
  const remodelShips: RemodelChainShip[] = []
  for (const ship of friendly) {
    const after = Number(ship.api_aftershipid)
    remodelShips.push({
      id: Number(ship.api_id),
      sortNo: Number(ship.api_sortno) || Number(ship.api_id),
      afterId: after > 0 ? after : 0,
    })
  }
  const chains = buildShipRemodelChains(
    remodelShips,
    (data.api_mst_shipupgrade ?? []).map((upgrade: any) => ({
      targetId: Number(upgrade?.api_id) || 0,
      currentShipId: Number(upgrade?.api_current_ship_id) || 0,
      originalShipId: Number(upgrade?.api_original_ship_id) || 0,
      stage: Number(upgrade?.api_upgrade_level) || 0,
    })),
  )
  // chainOf 的键就是根形态，值已经按「离根多远」排好——与图鉴同一份归属
  const shipNameIndex = [...chains.chainOf.entries()].flatMap(([rootId, memberIds]) => {
    const root = shipById.get(rootId)
    if (!root) return []
    const aliases = memberIds.flatMap((id) => {
      const form = shipById.get(id)
      return form
        ? aliasesFor('ship', id, `${form.api_name ?? ''}`, TASK_SHIP_TEXT_ALIASES[id] ?? [])
        : []
    })
    const uniqueAliases = [...new Set(aliases)].sort((a, b) => b.length - a.length)
    return [
      {
        id: Number(root.api_id),
        name: `${root.api_name ?? ''}`,
        simple: uniqueAliases[0] ?? normalizeEntityText(`${root.api_name ?? ''}`),
        aliases: uniqueAliases,
        ctype: Number(root.api_ctype) || 0,
        stype: Number(root.api_stype) || 0,
        sortNo: Number(root.api_sortno) || Number(root.api_id),
        members: [...memberIds],
      },
    ]
  })
  const rootsByClass = new Map<number, ShipNameEntry[]>()
  for (const ship of shipNameIndex) {
    if (!ship.ctype) continue
    const members = rootsByClass.get(ship.ctype) ?? []
    members.push(ship)
    rootsByClass.set(ship.ctype, members)
  }
  // 舰级名走与图鉴同一份真名索引（shared/ship-class-name）——「该级图鉴编号最小的那艘 + 级」
  // 那个启发式被 api_sortno 的历史怪癖坑了（雪風 sortno=5 而 陽炎=91，阳炎型显示成雪风级），
  // 140 个舰级里 53 个是错的。分类是基础设施，两个模块必须同一个出口，不许各参照各的。
  const trueClassName = buildShipClassNameIndex(
    Object.values(kcwikiShipData ?? {}) as ShipClassNameRow[],
    (mstId) => Number(shipById.get(mstId)?.api_ctype) || 0,
  )
  const shipClassIndex = [...rootsByClass.entries()].map(([ctype, members]) => {
    members.sort((a, b) => a.sortNo - b.sortNo)
    const lead = members[0]
    const leadAliases = aliasesFor('ship', lead.id, lead.name)
    const heuristic = `${entityNamePlain('ship', lead.id, lead.name)}级`
    const label = trueClassName.get(ctype) || heuristic
    // 旧写法（首舰名 + 型/级）**留在别名里**：任务文本与用户输入里两种叫法都有，
    // 正名是把显示名改对，不是把「雪风级」这个说法从反查里删掉。
    const aliases = [
      ...leadAliases.flatMap((name) => [`${name}型`, `${name}级`]),
      normalizeEntityText(heuristic),
      normalizeEntityText(label),
      ...(label.endsWith('级') ? [normalizeEntityText(`${label.slice(0, -1)}型`)] : []),
      `舰级${ctype}`,
    ]
    return {
      id: ctype,
      name: label,
      simple: normalizeEntityText(label),
      aliases: [...new Set(aliases.filter(Boolean))].sort((a, b) => b.length - a.length),
      members,
    }
  })
  const friendlyShipTypeIds = new Set(friendly.map((ship) => Number(ship.api_stype)))
  const shipTypeIndex = (data.api_mst_stype ?? [])
    .filter((type: any) => friendlyShipTypeIds.has(Number(type.api_id)))
    .map((type: any) => {
      const aliases = aliasesFor(
        'shipType',
        type.api_id,
        type.api_name,
        [
          ...(SHIP_TYPE_ALIASES[type.api_id] ?? []),
          ...QUEST_SHIP_TYPE_GROUPS.filter((group) => group.stypes.includes(Number(type.api_id)))
            .flatMap((group) => group.aliases),
        ],
      )
      return {
        id: type.api_id,
        name: SHIP_TYPE_LABELS[type.api_id] ?? entityNamePlain('shipType', type.api_id, type.api_name),
        simple: aliases[0] ?? normalizeEntityText(type.api_name),
        aliases,
      }
    })
  const equipNameIndex = (data.api_mst_slotitem ?? [])
    .filter((e: any) => e.api_id < 1500)
    .map((equip: any) => {
      const aliases = aliasesFor('equip', equip.api_id, equip.api_name, TASK_EQUIP_TEXT_ALIASES[equip.api_id] ?? [])
      return {
        id: equip.api_id,
        name: equip.api_name,
        simple: aliases[0] ?? normalizeEntityText(equip.api_name),
        aliases,
      }
    })
  const itemNameIndex = (data.api_mst_useitem ?? []).map((item: any) => {
    const aliases = aliasesFor('item', item.api_id, item.api_name, TASK_ITEM_TEXT_ALIASES[item.api_id] ?? [])
    return {
      id: item.api_id,
      name: entityNamePlain('item', item.api_id, item.api_name),
      simple: aliases[0] ?? normalizeEntityText(item.api_name),
      aliases,
    }
  })
  const mapNameIndex = buildTaskMapNameIndex(
    data.api_mst_mapinfo,
    data.api_mst_maparea,
    (map) => entityNamePlain('map', map.api_id, map.api_name),
    normalizeEntityText,
  )
  const equipTypeIndex = (data.api_mst_slotitem_equiptype ?? []).map((type: any) => {
    const blocked = EQUIP_TYPE_GENERIC_ALIASES[type.api_id] ?? new Set<string>()
    const aliases = aliasesFor(
      'equipType',
      type.api_id,
      type.api_name,
      EQUIP_TYPE_ALIASES[type.api_id] ?? [],
    ).filter((alias) => !blocked.has(alias))
    return {
      id: type.api_id,
      name: entityNamePlain('equipType', type.api_id, type.api_name),
      simple: aliases[0] ?? normalizeEntityText(type.api_name),
      aliases,
    }
  })
  const missionNameIndex = buildTaskExpeditionNameIndex(
    data.api_mst_mission,
    expeditionData,
    (mission) => entityNamePlain('expedition', mission.api_id, mission.api_name),
    () => {}, // 纯索引不登记显示译名；调用方在构建前登记
    normalizeEntityText,
  )
  // 家具名：无中文矿脉，原名照排。任务库写法是简化转写（「掛け軸」→「挂け轴」），
  // 靠 JP2CN 两侧归并对齐；≥4 字才收——「椅子」这种短名在奖励文本里会乱撞。
  const furnitureNameIndex = (data.api_mst_furniture ?? [])
    .filter((f: any) => `${f.api_title ?? ''}`.length >= 4)
    .map((f: any) => ({
      id: f.api_id,
      name: `${f.api_title}`,
      simple: normalizeEntityText(f.api_title),
      aliases: [normalizeEntityText(f.api_title)].filter(Boolean),
    }))
  return { shipNameIndex, shipClassIndex, shipTypeIndex, equipNameIndex, itemNameIndex, mapNameIndex, equipTypeIndex, missionNameIndex, furnitureNameIndex }
}
