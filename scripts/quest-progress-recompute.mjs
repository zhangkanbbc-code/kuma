// 敌空母击沉任务 · 当前周期回算。
//
// 只接受显式账本副本路径；默认 readOnly dry-run，传 --write 才以最终重放值覆盖副本。
// 副本目录还需带 snapshots/kcsapi_api_start2_getData.json；lodes/ 可选，缺省读仓库内置包。
//
// 用法：
//   node scripts/quest-progress-recompute.mjs --db <副本绝对路径>
//   node scripts/quest-progress-recompute.mjs --db <副本绝对路径> --write
//   node scripts/quest-progress-recompute.mjs --db <副本绝对路径> --quest 220,211,217
//   --now <ISO 或毫秒>
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const args = process.argv.slice(2)
const option = (name) => {
  const exact = args.indexOf(`--${name}`)
  if (exact >= 0) return args[exact + 1]
  const inline = args.find((arg) => arg.startsWith(`--${name}=`))
  return inline?.slice(name.length + 3)
}
const flag = (name) => args.includes(`--${name}`)
const dbArg = option('db')
if (!dbArg) {
  console.error('缺 --db <账本副本绝对路径>')
  process.exit(2)
}
if (!path.isAbsolute(dbArg)) {
  console.error(`--db 必须是绝对路径：${dbArg}`)
  process.exit(2)
}
const dbPath = path.resolve(dbArg)
if (!fs.existsSync(dbPath)) {
  console.error(`账本副本不存在：${dbPath}`)
  process.exit(2)
}
const liveCandidates = process.env.APPDATA
  ? [
      path.resolve(process.env.APPDATA, 'kuma', 'mg.sqlite'),
      path.resolve(process.env.APPDATA, 'kanso', 'mg.sqlite'),
    ]
  : []
if (liveCandidates.some((candidate) => candidate.toLowerCase() === dbPath.toLowerCase())) {
  console.error(`拒绝打开用户账本真库；请先复制到临时目录：${dbPath}`)
  process.exit(2)
}

const questText = option('quest') ?? '220,211,217'
const targetQuestIds = [...new Set(
  questText
    .split(',')
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0),
)].sort((left, right) => left - right)
if (!targetQuestIds.length) {
  console.error(`--quest 没有合法任务号：${questText}`)
  process.exit(2)
}
const nowText = option('now')
let now = Date.now()
if (nowText !== undefined) {
  now = Date.parse(nowText)
  if (Number.isNaN(now)) now = Number(nowText)
  if (!Number.isFinite(now)) throw new Error(`--now 不是合法的 ISO 时刻或毫秒：${nowText}`)
}
const write = flag('write')
const dataDir = path.dirname(dbPath)
process.env.KANSO_DATA_DIR = dataDir

const {
  QUEST_LODE_IDS,
  loadLodes,
  loadMasterSnapshot,
  loadQuestSinkReplay,
  masterRawOf,
} = await import('./lib/quest-engine.mjs')
const masterSnapshot = loadMasterSnapshot()
if (!masterSnapshot) {
  console.error(
    `副本缺主数据快照：${path.join(dataDir, 'snapshots', 'kcsapi_api_start2_getData.json')}`,
  )
  process.exit(2)
}
const lodes = loadLodes(QUEST_LODE_IDS)
const { recomputeSinkQuestProgress, planQuestProgressChanges, overwriteQuestProgress } =
  await loadQuestSinkReplay()
const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite')
const db = new DatabaseSync(dbPath, { readOnly: !write })

try {
  const events = db
    .prepare(
      `SELECT id, ts, path, body, post_body AS postBody
       FROM events ORDER BY ts ASC, id ASC`,
    )
    .all()
  const battles = db
    .prepare(
      `SELECT id, ts, map, cell, snapshot
       FROM battle_snapshots WHERE practice = 0 ORDER BY ts ASC, id ASC`,
    )
    .all()
  const replay = recomputeSinkQuestProgress({
    targetQuestIds,
    events,
    battles,
    now,
    masterRaw: masterRawOf(masterSnapshot),
    getLode: (id) => lodes[id] ?? null,
  })
  if (replay.eligibleQuestIds.join(',') !== targetQuestIds.join(',')) {
    const rejected = targetQuestIds.filter((id) => !replay.eligibleQuestIds.includes(id))
    throw new Error(`不是“纯 sinkEnemy 且目标含 stype 7/11”的任务：${rejected.join(',')}`)
  }
  if (replay.missingBattleSnapshots.length) {
    throw new Error(
      `受领窗口内缺战斗快照 events=${replay.missingBattleSnapshots.join(',')}`,
    )
  }
  const changes = planQuestProgressChanges(db, replay)
  if (write) overwriteQuestProgress(db, changes)

  console.log(`模式：${write ? 'write（最终值覆盖）' : 'dry-run（只读，不写）'}`)
  console.log(`账本副本：${dbPath}`)
  console.log(`回算时刻：${new Date(now).toISOString()}`)
  console.log('任务  old  new  diff')
  for (const change of changes) {
    const diff = change.diff >= 0 ? `+${change.diff}` : `${change.diff}`
    console.log(
      `${String(change.questId).padEnd(5)} ${String(change.oldValue).padStart(3)}  ` +
        `${String(change.newValue).padStart(3)}  ${diff.padStart(4)}`,
    )
  }

  const excluded = new Map()
  for (const row of replay.excluded) {
    const key = `${row.ts}:${row.map}:${row.cell}:${row.mstId}`
    const entry = excluded.get(key) ?? { ...row, questIds: [] }
    entry.questIds.push(row.questId)
    excluded.set(key, entry)
  }
  console.log(`被剔除的对潜空袭：${excluded.size} 场/舰`)
  for (const row of [...excluded.values()].sort((left, right) => left.ts - right.ts)) {
    console.log(
      `${new Date(row.ts).toISOString()} map=${row.map} cell=${row.cell} ` +
        `mst=${row.mstId} quest=${[...new Set(row.questIds)].sort((a, b) => a - b).join(',')}`,
    )
  }
} finally {
  db.close()
}
