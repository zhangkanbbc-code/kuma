// 零网络；主数据只读。esbuild 临时产物只写系统临时目录，退出时清理。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import { auditQuestEntities } from './lib/quest-entity-audit.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const args = process.argv.slice(2)
let temp
try {
  let masterPath = process.env.APPDATA ? path.join(process.env.APPDATA, 'kuma', 'snapshots', 'kcsapi_api_start2_getData.json') : null
  let json = false
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--json') json = true
    else if (args[i] === '--master' && args[i + 1] && !args[i + 1].startsWith('--')) masterPath = path.resolve(args[++i])
    else throw new Error('用法：quest-entity-audit.mjs [--master <api_start2 快照 JSON>] [--json]')
  }
  if (!masterPath || !fs.existsSync(masterPath)) throw new Error('缺少主数据快照，请用 --master 指定 api_start2 JSON；默认读取 APPDATA 下 kuma/snapshots/kcsapi_api_start2_getData.json')
  const snapshot = read(masterPath)
  const master = snapshot.body?.api_data ?? snapshot.api_data ?? snapshot
  if (!Array.isArray(master.api_mst_slotitem)) throw new Error('主数据 JSON 缺少 api_mst_slotitem')
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-quest-entity-audit-'))
  const output = path.join(temp, 'runtime.cjs')
  buildSync({ stdin: { contents: [
    'export * from "./src/renderer/task-entity-match"',
    'export * from "./src/renderer/task-entity-index"',
    'export { normalizeExpeditionDispNo } from "./src/renderer/expedition-name-index"',
    'export * from "./src/renderer/task-entity-marks"',
    'export * from "./src/shared/quest-emphasis"',
    'export * from "./src/renderer/kcwiki-zh"',
    'export * from "./src/renderer/zh-simplify"',
  ].join('\n'), resolveDir: root }, outfile: output, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' })
  const runtime = createRequire(import.meta.url)(output)
  const lode = (name) => read(path.join(root, 'assets', 'lodes', `${name}.json`))
  const opencc = lode('opencc-t2s')
  runtime.installTaskEntityFold(opencc.data.chars)
  runtime.installZhSimplifier(opencc)
  const entities = runtime.simplifyLocalizationEntities(lode('kcwiki-localization').data.entities)
  const expeditions = runtime.simplifyKcwikiExpeditionData(lode('kcwiki-expedition').data)
  entities.expedition = Object.fromEntries((master.api_mst_mission ?? []).flatMap((mission) => {
    const zh = expeditions[runtime.normalizeExpeditionDispNo(mission.api_disp_no)]?.nameZh
    return zh ? [[mission.api_id, { zh }]] : []
  }))
  const localized = (domain, id, original) => entities[domain]?.[id]?.zh || entities[domain]?.[id]?.ja || original
  const indexes = runtime.buildTaskEntityIndexes(master, localized, expeditions, runtime.simplifyKcwikiShipsData(lode('kcwiki-ships').data))
  const result = auditQuestEntities(runtime.simplifyQuestScnData(lode('quests-scn').data), indexes, runtime)
  if (json) console.log(JSON.stringify(result, null, 2))
  else {
    const { total, matched, unmatched, partial } = result.summary
    console.log(`总词条 ${total} / 命中 ${matched} / 未命中 ${unmatched} / 部分命中 ${partial}（按出现次数）`)
    for (const [label, rows] of [['未命中', result.unmatched], ['部分命中', result.partial]]) {
      console.log(`\n${label}：${rows.length} 个聚合词条；候选仅为编辑距离提示，不是实体判决`)
      for (const row of rows) console.log(`「${row.term}」 ×${row.count} [${row.codes.join('、')}] → ${row.nearest ? `${row.nearest.kind}/${row.nearest.id} ${row.nearest.name}（别名 ${row.nearest.alias}；距离 ${row.nearest.distance}）` : '无候选'}`)
    }
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  if (temp) fs.rmSync(temp, { recursive: true, force: true })
}
