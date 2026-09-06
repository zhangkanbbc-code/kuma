// 任务详情四类标签统一中文写法（2026-09-06 起）。
//
// ---- 为什么还要第四块拼图 ----
// 舰种词 `ship-type-name.ts`、专有名词 `ship-proper-name.ts`、国籍词组
// `ship-nation-name.ts` 三张表按设计只处理由 `' / '` 拼起来的**词**：编成检查与秘书舰
// 继续走这条三表链。目标装备、持有道具与装备类别的标签则是**整串一个名字**，解码器手里
// 已经带着 mstId；这三类按 id 回查 `kcwiki-localization.entities`，比把名字切成词再猜准确。
//
// ---- 不新造译名表 ----
// 中文名只取既有译名包的 `entities.equip / item / equipType / ship`。按 id 回查也不无条件
// 接管：当前 label 只有与词条的 ja、zh 或主数据同 id 的 api_name 等值时才换成 zh。
// 带「★max」「第1格」等判定条件的手写标签因此原样放行，不会被一个裸装备名吞掉修饰。
//
// ---- 与渲染层的分界 ----
// 下面的 `comparable` 与 `renderer/localization.ts` 的 `comparable` 是同一套：
// trim → NFKC → 全角括号折半角 → 去空白 → 小写。两处各写一份必然漂移；但
// `localization.ts` 住在渲染层，主进程不能 import，所以这里只能照抄，不能复用。
//
// 规则包与解码器里的源文保持不动。四类标签只在 `quest-counter.ts` 的
// `localizeQuestLabels` 那一个出口就地改写；认不出的词或名字一律原样放行。
import {
  buildShipProperNameIndex,
  localizeShipProperWords,
} from './ship-proper-name'
import { localizeShipNationWords } from './ship-nation-name'
import { localizeShipTypeWords } from './ship-type-name'

import type { ShipProperNameIndex } from './ship-proper-name'

/** 必须经 `buildQuestGoalNameIndex` 构造，手搓字面量会丢主数据名判据。 */
export interface QuestGoalNameIndex {
  properNames: ShipProperNameIndex
  entities: unknown
}

type EntityDomain = 'equip' | 'item' | 'equipType'
type MasterNames = Record<EntityDomain, Map<number, string>>

const masterNamesByIndex = new WeakMap<QuestGoalNameIndex, MasterNames>()

const clean = (value: unknown): string => `${value ?? ''}`.trim()

// 与 renderer/localization.ts 的 comparable 同一套；分层边界使两处不能直接 import。
const comparable = (value: unknown): string =>
  clean(value)
    .normalize('NFKC')
    .replace(/[（）]/g, (char) => (char === '（' ? '(' : ')'))
    .replace(/\s+/g, '')
    .toLowerCase()

const buildMasterNames = (masterRaw: unknown): MasterNames => {
  const names: MasterNames = {
    equip: new Map(),
    item: new Map(),
    equipType: new Map(),
  }
  const take = (domain: EntityDomain, rows: any[]) => {
    for (const row of rows) {
      const id = Number(row?.api_id)
      const name = clean(row?.api_name)
      if (Number.isInteger(id) && id > 0 && name) names[domain].set(id, name)
    }
  }
  take('equip', (masterRaw as any)?.api_mst_slotitem ?? [])
  take('item', (masterRaw as any)?.api_mst_useitem ?? [])
  take('equipType', (masterRaw as any)?.api_mst_slotitem_equiptype ?? [])
  return names
}

export const buildQuestGoalNameIndex = (
  sources: { masterRaw: unknown; localizationData: unknown },
): QuestGoalNameIndex => {
  const index: QuestGoalNameIndex = {
    properNames: buildShipProperNameIndex(sources),
    entities: (sources.localizationData as any)?.entities,
  }
  masterNamesByIndex.set(index, buildMasterNames(sources.masterRaw))
  return index
}

const localizedEntityName = (
  domain: EntityDomain,
  id: unknown,
  label: string,
  index: QuestGoalNameIndex,
): string => {
  const entry = (index.entities as any)?.[domain]?.[id as any]
  const zh = clean(entry?.zh)
  const target = comparable(label)
  const candidates = [
    comparable(entry?.ja),
    comparable(entry?.zh),
    comparable(masterNamesByIndex.get(index)?.[domain].get(Number(id))),
  ].filter(Boolean)
  return zh && candidates.includes(target) ? zh : label
}

const localizeShipWords = (label: string, properNames: ShipProperNameIndex): string =>
  localizeShipNationWords(
    localizeShipProperWords(localizeShipTypeWords(label), properNames),
  )

/** 一条追踪器（或规则草案）的四类标签就地中文化。幂等。 */
export const localizeQuestGoalLabels = (
  holder: { fleetGoal?: any; tasks?: any[]; stateGoal?: any; stockGoals?: any[] },
  index: QuestGoalNameIndex,
): void => {
  const localizeFleetGoal = (goal: any) => {
    for (const group of goal?.groups ?? []) {
      group.label = localizeShipWords(group.label, index.properNames)
    }
  }

  localizeFleetGoal(holder.fleetGoal)
  for (const task of holder.tasks ?? []) localizeFleetGoal(task.fleetGoal)

  const secretary = holder.stateGoal?.secretary
  if (secretary) secretary.label = localizeShipWords(secretary.label, index.properNames)
  for (const equipment of holder.stateGoal?.equipment ?? []) {
    equipment.label = localizedEntityName(
      'equip',
      equipment.mstIds?.[0],
      equipment.label,
      index,
    )
  }

  for (const goal of holder.stockGoals ?? []) {
    if (goal.kind === 'useitem') {
      goal.label = localizedEntityName('item', goal.id, goal.label, index)
    } else if (goal.kind === 'equip') {
      goal.label = localizedEntityName('equip', goal.id, goal.label, index)
    } else if (goal.kind === 'equipCategory' && goal.ids.length === 1) {
      goal.label = localizedEntityName('equipType', goal.ids[0], goal.label, index)
    }
  }
}
