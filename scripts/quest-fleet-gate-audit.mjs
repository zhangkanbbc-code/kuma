// 零网络；主数据快照和矿脉只读。引擎临时产物由 quest-engine 写入系统临时目录并清理。
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { auditQuestFleetGates } from './lib/quest-fleet-gate-audit.mjs'
import { loadQuestEngine, loadLodes, QUEST_LODE_IDS, offlineHost, quiet } from './lib/quest-engine.mjs'
import { QUEST_CATEGORY_LETTERS } from '../src/shared/quest-observed.ts'
import { questCodeFamily } from '../src/shared/quest-period.ts'

export const runFleetGateAudit = async ({ masterPath, master: masterOverride, lodes: lodeOverrides } = {}) => {
  masterPath ??= process.env.APPDATA
    ? path.join(process.env.APPDATA, 'kuma', 'snapshots', 'kcsapi_api_start2_getData.json') : null
  if (!masterOverride && (!masterPath || !fs.existsSync(masterPath))) throw new Error('缺少主数据快照，请用 --master 指定 api_start2 JSON；默认读取 APPDATA 下 kuma/snapshots/kcsapi_api_start2_getData.json')
  const snapshot = masterOverride ? { body: masterOverride } : JSON.parse(fs.readFileSync(masterPath, 'utf8'))
  const master = snapshot.body?.api_data ?? snapshot.body ?? snapshot.api_data ?? snapshot
  if (!Array.isArray(master.api_mst_ship)) throw new Error('主数据 JSON 缺少 api_mst_ship')
  const lodes = lodeOverrides ?? loadLodes(QUEST_LODE_IDS)
  if (!lodes['quests-scn']) throw new Error('缺少 quests-scn 任务库，无法体检')
  const scn = lodes['quests-scn']
  const catalog = { ...scn.data }
  const quests = {}
  const unnumbered = []
  let nextId = Math.max(0, ...Object.keys(catalog).map(Number)) + 1
  // 假设游戏下发未定号条目，走引擎本身的认领；编号仅在本次离线审计里分配。
  for (const entry of Object.values(scn.unnumbered ?? {})) {
    const family = questCodeFamily(entry.code)
    const category = Object.entries(QUEST_CATEGORY_LETTERS).find(([, letter]) => letter === family)?.[0]
    if (!category) continue // SF1 等旧特殊码没有可认领的游戏分类。
    const no = nextId++
    quests[no] = { no, title: entry.titleJa, category: Number(category), state: 1, type: 4, progressFlag: 0 }
    catalog[no] = entry
    unnumbered.push({ questId: no, code: entry.code, needsGate: /包含|含有|旗舰|僚舰|伴随|编入|以「/.test(`${entry.desc} ${entry.memo2}`) })
  }
  const { createQuestEngine } = await loadQuestEngine()
  const state = { player: { quests, decks: [], ships: {}, slotitems: {}, materials: [], useitems: {} }, sortie: null }
  const engine = createQuestEngine(offlineHost({ lodes, snapshot, state: () => state }))
  quiet(() => engine.init(master))
  const trackers = engine.state().trackers
  const missing = unnumbered.flatMap(row => {
    const tracker = trackers[row.questId]
    const reason = !tracker ? '无追踪器' : row.needsGate && !tracker.fleetGoal ? '未读出编成门' : null
    return reason ? [{ ...row, reason }] : []
  })
  return { ...auditQuestFleetGates(catalog, trackers), unnumbered, missing }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2)
    let masterPath
    let json = false
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--json') json = true
      else if (args[i] === '--master' && args[i + 1] && !args[i + 1].startsWith('--')) masterPath = path.resolve(args[++i])
      else throw new Error('用法：quest-fleet-gate-audit.mjs [--master <api_start2 快照 JSON>] [--json]')
    }
    const result = await runFleetGateAudit({ masterPath })
    if (json) console.log(JSON.stringify(result, null, 2))
    else {
      const { total, sources, clear, noCount, suspicious } = result.summary
      console.log(`编成门 ${total}（${Object.entries(sources).map(([source, count]) => `${source} ${count}`).join(' / ')}）/ 数字未报警 ${clear} / 无舰数 ${noCount} / 可疑 ${suspicious}`)
      console.log('可疑仅供人工复核：正文数字可能指自由位、上限或全队规模。')
      console.log(`假设认领 ${result.unnumbered.length} 条 / 缺追踪器或编成门 ${result.missing.length}`)
      for (const row of result.missing) console.error(`${row.code}：${row.reason}`)
      for (const row of result.suspicious) {
        console.log(`\n${row.code} / ${row.questId} / ${row.source} / approx=${row.approx} / 门 ${row.requiredShips} < 正文 ${row.maxTextShips}`)
        console.log(`  ${row.groups.map(({ label, amount }) => `${label}×${amount}`).join(' + ')}`)
        console.log(`  ${row.excerpt}`)
      }
    }
    if (result.missing.length) process.exitCode = 1
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
