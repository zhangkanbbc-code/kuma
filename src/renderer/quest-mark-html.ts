import type { QuestMark } from '../shared/quest-emphasis'
import type { EntityRef } from './link'
import { QUEST_SHIP_TYPE_GROUPS } from '../shared/quest-ship-type-groups'

// 09-08 用户要求正文实体可点；涂色仍保留以示与芯片不同层。
// ship 的 ref 已是整条改造链的根 id，和 shipEntityHtml 的 entry.id 相同。
// 舰种／装备类别索引已剔除泛称，命中走 Catalog；chips 的 Group 分支仅处理
// 没被索引覆盖的「战舰／空母／电探」，这些泛称不凭空改成某个目录 id。
// 任务舰种接入后，舰种泛称保留在索引里，按共享组 key 转到集合；精确舰种仍走 Catalog。
const MARK_LINK_DOMAIN: Partial<Record<QuestMark['kind'], EntityRef['type']>> = {
  ship: 'mstShip',
  equip: 'mstEquip',
  item: 'useitem',
  map: 'map',
  nationality: 'shipNationality',
  shipClass: 'shipClass',
  shipType: 'shipTypeCatalog',
  equipType: 'equipTypeCatalog',
  expedition: 'expedition',
}

export const renderQuestMarkHtml = (
  mark: QuestMark,
  inner: string,
  link: (type: EntityRef['type'], id: number | string, html: string) => string,
): string => {
  const domain = MARK_LINK_DOMAIN[mark.kind]
  const group = mark.kind === 'shipTypeGroup'
    ? QUEST_SHIP_TYPE_GROUPS.find((entry) => entry.key === mark.ref)
    : undefined
  const content = group ? link('shipTypeGroup', group.stypes.join(','), inner)
    : domain && mark.ref != null ? link(domain, mark.ref, inner) : inner
  return `<span class="qh qh-${mark.kind}">${content}</span>`
}
