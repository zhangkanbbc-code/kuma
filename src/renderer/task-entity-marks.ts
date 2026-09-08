// 正文与维护者审计共用原文坐标命中；审计不扩展引号，避免把短别名伪装成整词命中。
import type { buildTaskEntityIndexes } from './task-entity-index'
import type { QuestMark } from '../shared/quest-emphasis'
import { QUEST_SHIP_TYPE_GROUPS } from '../shared/quest-ship-type-groups'
import { allowTaskEquipTypeAlias, allowTaskShipAlias, allowTaskShipTypeAlias, markTaskEntityHits, rangesOverlap, taskEntityTextDomainAllowed } from './task-entity-match'

export const taskEntityRawMarks = (
  indexes: ReturnType<typeof buildTaskEntityIndexes>,
  text: string,
  code: string,
  // 紧凑串坐标下的国籍段（markTaskEntityHits 的 acceptAlias 就是在紧凑串上跑的）；
  // 传原文坐标的那份进来会整体错位，见 nationalityRangesInPackedText
  nationalityRanges: { start: number; length: number }[],
): QuestMark[] => {
  const { mapNameIndex, shipClassIndex, shipTypeIndex, equipTypeIndex, missionNameIndex, equipNameIndex, itemNameIndex, shipNameIndex } = indexes
  const marks: QuestMark[] = []
  const push = (
    hits: { start: number; length: number; entry: { id: number } }[],
    kind: QuestMark['kind'],
  ) => {
    for (const hit of hits) {
      marks.push({ start: hit.start, length: hit.length, kind, ref: hit.entry.id })
    }
  }
  // 「驱逐队」「航空队」是部队编制名，不是舰种。chips 那边只列一次无所谓，
  // 正文里却会把编制名的头两个字涂成舰种色——一句话里点三下「驱逐」，像标错了。
  const notUnitName = (candidate: { text: string; start: number; alias: string }) =>
    !/^[队隊]/.test(candidate.text.slice(candidate.start + candidate.alias.length))
  // 海域名走词典时沿用 chips 的领域限制：远征说明、前置备注里的同名作战不该被
  // 当成本任务的目标海域。海域码和 wiki 链接是形态铁证，不受这条限制（见 emphasisMarks）。
  if (taskEntityTextDomainAllowed('map', code)) push(markTaskEntityHits(mapNameIndex, text, 3), 'map')
  push(markTaskEntityHits(shipClassIndex, text, 3), 'shipClass')
  for (const hit of markTaskEntityHits(shipTypeIndex, text, 2, {
    acceptAlias: (candidate) => allowTaskShipTypeAlias(candidate) && notUnitName(candidate),
  })) {
    const group = QUEST_SHIP_TYPE_GROUPS.find((entry) => entry.aliases.includes(hit.alias))
    marks.push({
      start: hit.start, length: hit.length,
      kind: group ? 'shipTypeGroup' : 'shipType',
      ref: group ? group.key : hit.entry.id,
    })
  }
  push(
    markTaskEntityHits(equipTypeIndex, text, 2, {
      acceptAlias: (candidate) => allowTaskEquipTypeAlias(candidate) && notUnitName(candidate),
    }),
    'equipType',
  )
  push(markTaskEntityHits(missionNameIndex, text, 4), 'expedition')
  push(markTaskEntityHits(equipNameIndex, text, 3, { allowQuotedSingle: true }), 'equip')
  push(markTaskEntityHits(itemNameIndex, text, 3, { allowQuotedSingle: true }), 'item')
  push(
    markTaskEntityHits(shipNameIndex, text, 2, {
      skipClassSuffix: true,
      allowQuotedSingle: true,
      acceptAlias: (candidate) =>
        allowTaskShipAlias(candidate) &&
        !nationalityRanges.some((hit) => rangesOverlap(candidate, hit)),
    }),
    'ship',
  )
  return marks
}
