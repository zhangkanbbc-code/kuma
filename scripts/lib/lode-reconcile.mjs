import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { userDataPath } from './data-dir.mjs'
import { PENDING_IMPROVE_STAR_GAPS, diffImproveStarGaps } from './improve-star-gap.mjs'

const loadPack = (root, id) => {
  const file = path.join(root, 'assets', 'lodes', `${id}.json`)
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
}

const findNestedArray = (value, key) => {
  if (!value || typeof value !== 'object') return null
  if (Array.isArray(value[key])) return value[key]
  for (const child of Object.values(value)) {
    const found = findNestedArray(child, key)
    if (found) return found
  }
  return null
}

const masterSnapshot = () => {
  const files = [
    userDataPath('snapshots', 'kcsapi_api_start2_getData.json'),
    userDataPath('snapshots', 'master.json'),
  ]
  for (const file of files) {
    if (!existsSync(file)) continue
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    const ships = findNestedArray(raw, 'api_mst_ship')
    const upgrades = findNestedArray(raw, 'api_mst_shipupgrade')
    const missions = findNestedArray(raw, 'api_mst_mission')
    if (ships || upgrades || missions) {
      return {
        ships: ships ?? [],
        upgrades: upgrades ?? [],
        missions: missions ?? [],
      }
    }
  }
  return { ships: [], upgrades: [], missions: [] }
}

const NATIVE = [
  ['useitem:58', 'api_drawing_count'],
  ['useitem:65', 'api_catapult_count'],
  ['useitem:78', 'api_report_count'],
  ['useitem:77', 'api_aviation_mat_count'],
  ['useitem:94', 'api_arms_mat_count'],
  ['useitem:100', 'api_tech_count'],
  ['slotitem:87', 'api_boiler_count'],
]

const OLD_ITEM = {
  改装设计图: 58,
  战斗详报: 78,
  试制甲板用弹射器: 65,
  新型兵装资材: 94,
  新型火炮兵装资材: 75,
  新型航空兵装资材: 77,
  海外舰最新技术: 100,
  工厂资源: 104,
  开发资材: 3,
  高速建造材: 2,
  熟练搭乘员: 70,
  勋章: 57,
}

const needsMap = (entry) =>
  new Map(
    (entry?.needs ?? []).map((need) => [
      `${need.kind}:${need.id ?? need.nameJp}`,
      Number(need.count) || 0,
    ]),
  )

const reconcileRemodel = (root) => {
  const current = loadPack(root, 'wikiwiki-remodel')
  const old = loadPack(root, 'kcwiki-ships')
  if (!current || !old) return { available: false, reason: '缺少 wikiwiki-remodel 或 kcwiki-ships' }
  const master = masterSnapshot()
  const oldByMst = new Map(
    Object.values(old.data ?? {}).flatMap((entry) =>
      Number(entry?.ID) > 0 ? [[Number(entry.ID), entry]] : [],
    ),
  )
  const nativeMismatches = []
  const fallbackMismatches = []
  const activeUpgrades = master.upgrades.filter(
    (upgrade) =>
      Number(upgrade?.api_current_ship_id) > 0 &&
      Number(upgrade?.api_upgrade_level) > 0,
  )
  for (const upgrade of activeUpgrades) {
    const targetId = Number(upgrade?.api_id) || 0
    const currentNeeds = needsMap(current.data?.[targetId])
    for (const [identity, field] of NATIVE) {
      const nativeCount = Number(upgrade?.[field]) || 0
      if (nativeCount <= 0) continue
      const wikiwikiCount = currentNeeds.get(identity) ?? null
      if (wikiwikiCount !== nativeCount) {
        nativeMismatches.push({ targetId, identity, nativeCount, wikiwikiCount })
      }
    }
    const oldEntry = oldByMst.get(Number(upgrade?.api_current_ship_id))
    const raw = `${oldEntry?.改造?.图纸 ?? ''}`
    for (const match of raw.matchAll(/([^\sx×]+)\s*[x×]\s*(\d+)/g)) {
      const id = OLD_ITEM[match[1]]
      if (!id) continue
      const identity = `useitem:${id}`
      const oldCount = Number(match[2]) || 0
      const wikiwikiCount = currentNeeds.get(identity) ?? null
      if (wikiwikiCount !== oldCount) {
        fallbackMismatches.push({
          targetId,
          identity,
          oldCount,
          wikiwikiCount,
          oldName: match[1],
        })
      }
    }
  }
  return {
    available: true,
    wikiwikiTargets: Object.keys(current.data ?? {}).length,
    nativeRows: activeUpgrades.length,
    nativeMismatches,
    fallbackMismatches,
  }
}

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value ?? null
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonical(child)]),
  )
}

const stable = (value) => JSON.stringify(canonical(value))

const timeMinutes = (value) => {
  const match = `${value ?? ''}`.match(/^(\d{1,3}):(\d{2})$/)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

const rewardBase = (value) => {
  const base = Array.isArray(value) ? value[0] : value
  const numeric = Number(base)
  return Number.isFinite(numeric) ? numeric : 0
}

const normalizedDispNo = (value) => `${value ?? ''}`.replace(/^0+(?=\d)/, '')

const percentFromText = (value) => {
  const match = `${value ?? ''}`.match(/(\d+(?:\.\d+)?)\s*%/)
  return match ? Number(match[1]) / 100 : null
}

const reconcileExpeditions = (root) => {
  const current = loadPack(root, 'wikiwiki-expedition')
  const old = loadPack(root, 'kcwiki-expedition')
  if (!current || !old) return { available: false, reason: '缺少 wikiwiki-expedition 或 kcwiki-expedition' }
  const master = masterSnapshot()
  const apiByDisplay = new Map(
    master.missions.flatMap((mission) => {
      const id = normalizedDispNo(mission?.api_disp_no)
      return id ? [[id, mission]] : []
    }),
  )
  const fields = [
    'flagLv',
    'fleetLv',
    'minShips',
    'stats',
    'drumTotal',
    'drumShips',
  ]
  const rewardFields = ['hqExp', 'shipExp', 'fuel', 'ammo', 'steel', 'baux']
  const mismatches = []
  const apiMismatches = []
  const missing = []
  for (const [id, entry] of Object.entries(current.data ?? {})) {
    const mission = apiByDisplay.get(normalizedDispNo(id))
    if (!mission) {
      missing.push({ id, side: 'gameApi' })
    } else {
      const apiFields = [
        ['time', Number(mission.api_time), timeMinutes(entry?.time)],
        ['minShips', Number(mission.api_deck_num), Number(entry?.minShips)],
        ['useFuel', Number(mission.api_use_fuel), percentFromText(entry?.useFuelText)],
        ['useBull', Number(mission.api_use_bull), percentFromText(entry?.useBullText)],
      ]
      for (const [field, api, wikiwiki] of apiFields) {
        if (wikiwiki == null || !Number.isFinite(api)) continue
        if (Math.abs(api - wikiwiki) > 0.0001) {
          apiMismatches.push({ id, field, api, wikiwiki })
        }
      }
    }
    const fallback = old.data?.[id]
    if (!fallback) {
      missing.push({ id, side: 'kcwiki' })
      continue
    }
    if (timeMinutes(entry?.time) !== timeMinutes(fallback?.time)) {
      mismatches.push({
        id,
        field: 'time',
        wikiwiki: entry?.time ?? null,
        kcwiki: fallback?.time ?? null,
      })
    }
    for (const field of fields) {
      if (stable(entry?.[field]) !== stable(fallback?.[field])) {
        mismatches.push({ id, field, wikiwiki: entry?.[field] ?? null, kcwiki: fallback?.[field] ?? null })
      }
    }
    for (const field of rewardFields) {
      const currentReward = rewardBase(entry?.rewards?.[field])
      const fallbackReward = rewardBase(fallback?.rewards?.[field])
      if (currentReward !== fallbackReward) {
        mismatches.push({
          id,
          field: `rewards.${field}`,
          wikiwiki: currentReward,
          kcwiki: fallbackReward,
        })
      }
    }
  }
  for (const id of Object.keys(old.data ?? {})) {
    if (!current.data?.[id]) missing.push({ id, side: 'wikiwiki' })
  }
  for (const [id] of apiByDisplay) {
    if (!current.data?.[id]) missing.push({ id, side: 'wikiwikiFromGameApi' })
  }
  return {
    available: true,
    apiEntries: apiByDisplay.size,
    wikiwikiEntries: Object.keys(current.data ?? {}).length,
    kcwikiEntries: Object.keys(old.data ?? {}).length,
    apiMismatches,
    apiNativeCoverage: {
      rewardItems: master.missions.filter(
        (mission) =>
          (Array.isArray(mission?.api_win_item1) && Number(mission.api_win_item1[0]) > 0) ||
          (Array.isArray(mission?.api_win_item2) && Number(mission.api_win_item2[0]) > 0),
      ).length,
      sampleFleets: master.missions.filter(
        (mission) =>
          Array.isArray(mission?.api_sample_fleet) &&
          mission.api_sample_fleet.some((value) => Number(value) > 0),
      ).length,
      difficulties: master.missions.filter(
        (mission) => Number.isInteger(mission?.api_difficulty) && mission.api_difficulty > 0,
      ).length,
    },
    mismatches,
    missing,
  }
}

/**
 * 逐星加成 × 改修表的夹缝（自扩展体检待裁 4，2026-08-23 挂账）。
 *
 * **不参与任何判定**，只把台账与实况的对比带进报告：两个源在这几件装备上各说各的，
 * 谁对是数据问题，要用户人工核（kanlog/wiki）时一并裁，脚本不代拍。
 */
const reconcileImproveStarGap = (root) => {
  const akashi = loadPack(root, 'akashi-list')
  const upgrades = loadPack(root, 'equip-upgrades')
  if (!akashi || !upgrades) return { available: false, reason: '缺少 akashi-list 或 equip-upgrades' }
  const diff = diffImproveStarGaps({ akashi: akashi.data, upgrades: upgrades.data })
  return {
    available: true,
    note:
      'akashi 给得出逐星加成表、改修表连条目都没有的那几件。' +
      '改修表没有方案时逐星表整块渲染不到（连坐）；解开连坐可能更糟——' +
      '若那些装备本来就不可改修，摆一张逐星表就是显示一份不存在的东西。' +
      '两源谁对未裁，待 kanlog/wiki 人工核时一并裁。',
    ...diff.summary,
    pending: PENDING_IMPROVE_STAR_GAPS,
    mismatchRows: diff.rows,
  }
}

export const writeLodeReconciliation = (root) => {
  const report = {
    generatedAt: new Date().toISOString(),
    principle: '游戏 API → wikiwiki 事实层 → 专门化结构源 → kcwiki 中文本地化/最终兜底',
    remodel: reconcileRemodel(root),
    expedition: reconcileExpeditions(root),
    improveStarGap: reconcileImproveStarGap(root),
  }
  const reviewDir = path.join(root, 'assets', 'review')
  mkdirSync(reviewDir, { recursive: true })
  const output = path.join(reviewDir, 'source-reconciliation.json')
  writeFileSync(output, JSON.stringify(report, null, 2))
  return { output, report }
}
