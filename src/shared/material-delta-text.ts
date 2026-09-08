import type { DeltaDetail } from './material-delta-detail'
import type { MaterialDeltaRow } from './mg-types'

/** 名字由界面提供；这里仅拼文案，不从编号推测对象。 */
export interface DeltaDetailResolvers {
  shipByRoster(id: number): string | null
  shipByMst(mst: number): string | null
  slotitemByMst(mst: number): string | null
  questName(id: number): { code: string; name: string } | null
  missionName(id: number): { no: string; name: string } | null
  mapName(mapId: number): string | null
  cellLetter(map: number, cell: number): string | null
  itemName(id: number): string | null
}

export const describeDeltaDetail = (detail: DeltaDetail | null, r: DeltaDetailResolvers): string => {
  if (!detail) return '—'
  const ship = (id: number, mst = 0) => r.shipByRoster(id) || (mst ? r.shipByMst(mst) : null) || `#${mst || id}`
  const mstShip = (mst: number) => r.shipByMst(mst) || `#${mst}`
  const equip = (mst: number) => r.slotitemByMst(mst) || `#${mst}`
  const map = (id: number) => r.mapName(id) || `#${id}`
  switch (detail.kind) {
    case 'supply': {
      const count = detail.ships.length
      const names = detail.ships.slice(0, 6).map(id => ship(id)).join('、')
      return `${detail.mode === 1 ? '补给燃料' : detail.mode === 2 ? '补给弹药' : '补给'} ${count} 艘：${names}${count > 6 ? `等 ${count} 艘` : ''}${detail.onslot ? '，含舰载机' : ''}`
    }
    case 'dock': return `入渠 ${ship(detail.ship, detail.mst)}${detail.highspeed ? ' · 高速修复' : ''}`
    case 'build': return `建造 ${detail.recipe.slice(0, 4).join('/')}${detail.large ? ' · 大型建造' : ''}${detail.highspeed ? ' · 高速建造' : ''}`
    case 'craft': return `开发 ${detail.recipe.join('/')}${detail.multiple ? ' ×3' : ''}${detail.results.length ? ` → ${detail.results.map(mst => mst < 0 ? '失败' : equip(mst)).join('、')}` : ''}`
    case 'scrap': return `解体 ${detail.ships.map(s => ship(s.id, s.mst)).join('、')}${detail.withSlots ? ' · 装备一并解体' : ''}`
    case 'discard': {
      const names = detail.slotitems.filter(s => s.mst > 0).map(s => equip(s.mst))
      return `废弃装备 ${detail.slotitems.length} 件${names.length ? `：${names.join('、')}` : ''}`
    }
    case 'improve': return `改修 ${detail.mst ? equip(detail.mst) : `#${detail.slotitem}`}${detail.success ? detail.after ? ` → ${equip(detail.after.mst)} ★${detail.after.level}` : ' 成功' : ' 失败'}${detail.certain ? ' · 确实化' : ''}`
    case 'expedition': {
      const mission = r.missionName(detail.mission)
      return `远征 ${mission ? `${mission.no} ${mission.name}` : `#${detail.mission}`} · 第 ${detail.deck} 舰队 · ${{ great: '大成功', success: '成功', failed: '失败' }[detail.result]}`
    }
    case 'quest':
    case 'questCost': {
      const quest = r.questName(detail.quest)
      return `${detail.kind === 'quest' ? '任务' : '任务达成消耗'} ${quest ? `${quest.code} ${quest.name}` : `#${detail.quest}`}`
    }
    case 'airBase': return `基地航空队 第 ${detail.base} 基地 第 ${detail.squadron} 中队 ${detail.action === 'setPlane' ? '配置' : '补给'}`
    case 'airBaseSortie': return `基地航空队出击 ${map(detail.map)}`
    case 'mapItem': {
      const letter = detail.map && detail.cell ? r.cellLetter(detail.map, detail.cell) : null
      return `海域资源点${detail.map ? ` ${map(detail.map)}` : ''}${letter ? ` ${letter} 点` : ''}`
    }
    case 'shipRemodel': return `改造 ${mstShip(detail.from)} → ${mstShip(detail.to)}`
    case 'itemUse': return `${detail.paid ? '氪金道具' : '使用道具'}${detail.item == null ? '' : ` ${r.itemName(detail.item) || `#${detail.item}`}`}`
  }
}

export interface DeltaRowGroup {
  category: string
  count: number
  values: MaterialDeltaRow['values']
  rows: MaterialDeltaRow[]
}

/** 先按资源筛行，再合计八项净值；组内按时间倒序，原始输入保持不变。 */
export const groupDeltaRows = (rows: readonly MaterialDeltaRow[], resourceIdx: number | null): DeltaRowGroup[] => {
  const groups = new Map<string, DeltaRowGroup>()
  for (const row of rows) {
    if (resourceIdx != null && row.values[resourceIdx] === 0) continue
    let group = groups.get(row.category)
    if (!group) {
      group = { category: row.category, count: 0, values: [0, 0, 0, 0, 0, 0, 0, 0], rows: [] }
      groups.set(row.category, group)
    }
    group.count++
    group.rows.push(row)
    row.values.forEach((value, idx) => { group.values[idx] += value })
  }
  const score = (group: DeltaRowGroup) => resourceIdx == null
    ? group.values.slice(0, 4).reduce((sum, value) => sum + Math.abs(value), 0)
    : Math.abs(group.values[resourceIdx])
  return [...groups.values()].map(group => {
    group.rows.sort((a, b) => b.ts - a.ts)
    return group
  }).sort((a, b) => score(b) - score(a) || a.category.localeCompare(b.category, 'zh-CN'))
}
