// 零网络；主数据快照和矿脉只读。引擎临时产物由 quest-engine 写入系统临时目录并清理。
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { auditQuestFleetGates } from './lib/quest-fleet-gate-audit.mjs'
import { loadQuestEngine, loadLodes, QUEST_LODE_IDS, offlineHost, quiet } from './lib/quest-engine.mjs'

export const runFleetGateAudit = async ({ masterPath } = {}) => {
  masterPath ??= process.env.APPDATA
    ? path.join(process.env.APPDATA, 'kuma', 'snapshots', 'kcsapi_api_start2_getData.json') : null
  if (!masterPath || !fs.existsSync(masterPath)) throw new Error('缺少主数据快照，请用 --master 指定 api_start2 JSON；默认读取 APPDATA 下 kuma/snapshots/kcsapi_api_start2_getData.json')
  const snapshot = JSON.parse(fs.readFileSync(masterPath, 'utf8'))
  const master = snapshot.body?.api_data ?? snapshot.body ?? snapshot.api_data ?? snapshot
  if (!Array.isArray(master.api_mst_ship)) throw new Error('主数据 JSON 缺少 api_mst_ship')
  const lodes = loadLodes(QUEST_LODE_IDS)
  if (!lodes['quests-scn']) throw new Error('缺少 quests-scn 任务库，无法体检')
  const { createQuestEngine } = await loadQuestEngine()
  const state = { player: { quests: {}, decks: [], ships: {}, slotitems: {}, materials: [], useitems: {} }, sortie: null }
  const engine = createQuestEngine(offlineHost({ lodes, snapshot, state: () => state }))
  quiet(() => engine.init(master))
  return auditQuestFleetGates(lodes['quests-scn'].data, engine.state().trackers)
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
      for (const row of result.suspicious) {
        console.log(`\n${row.code} / ${row.questId} / ${row.source} / approx=${row.approx} / 门 ${row.requiredShips} < 正文 ${row.maxTextShips}`)
        console.log(`  ${row.groups.map(({ label, amount }) => `${label}×${amount}`).join(' + ')}`)
        console.log(`  ${row.excerpt}`)
      }
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
