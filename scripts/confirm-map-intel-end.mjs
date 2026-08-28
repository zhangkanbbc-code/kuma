// 人工核实结束日之后，把某张常规图内该舰的所有限定点转成**已收窗**。
//
// 2026-08-22 批次 4 起改写第一方台账 `assets/lodes/map-drop-windows.json`
//（限定期窗口这一域的唯一出处），不再写 map-intel 的候选包。
//
// 为什么这里没有 candidate → diff → approve 那道闸：那道闸的存在理由是
// **map-intel.json 不入仓**，改动没有 git diff 可看。台账入仓，改完直接 `git diff`
// 就是逐行审阅，再套一层候选只是多一道手续。
//
// 「已收窗」是三态里唯一**只能由人写**的状态：官方不公告结束日，上游总表也只会
// 「不再列出」而不给日期。对照报告能把它列成 `ledger-only` 提醒你，但写不写、
// 写哪一天，是人的判断——所以这条命令**强制要求写凭据**。
//
// 用法：
//   node scripts/confirm-map-intel-end.mjs <海域> <舰娘ID> <YYYY-MM-DD> "<凭据>" [--kind=official]
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { confirmLedgerWindowEnd } from './lib/map-drop-windows.mjs'
import { jstDate } from './map-intel.mjs'

const args = process.argv.slice(2).filter((one) => !one.startsWith('--'))
const kind = process.argv.find((one) => one.startsWith('--kind='))?.slice(7) ?? 'official'
const [map, shipText, until, why] = args
const shipId = Number(shipText)
if (!/^\d+-\d+$/.test(map ?? '') || !Number.isInteger(shipId) || !until || !why) {
  throw new Error(
    '用法：npm run lodes:map-intel-confirm-end -- <海域> <舰娘ID> <YYYY-MM-DD> "<凭据>" [--kind=official|ledger|community]\n' +
      '  凭据要写清是哪一份、什么口径——「已收窗」这一格没有凭据就与凭空捏造无法区分。',
  )
}
if (!['official', 'ledger', 'community'].includes(kind)) {
  throw new Error(`凭据种类不认得：${kind}（只有 official / ledger / community）`)
}

const root = path.join(fileURLToPath(import.meta.url), '..', '..')
const file = path.join(root, 'assets', 'lodes', 'map-drop-windows.json')
const pack = JSON.parse(readFileSync(file, 'utf8'))
const confirmedAt = jstDate(new Date())
const changed = confirmLedgerWindowEnd(pack.data, {
  map,
  shipId,
  until,
  confirmedAt,
  evidence: { kind, note: why },
})
pack.data.compiledAt = confirmedAt
pack.data.revision = confirmedAt.replaceAll('-', '.')
pack.meta.version = confirmedAt.replaceAll('-', '.')
pack.meta.fetchedAt = new Date().toISOString()
writeFileSync(file, `${JSON.stringify(pack, null, 1)}\n`, 'utf8')
console.log(
  `[lodes] ${map} 舰娘 ${shipId}：${changed} 个点转为已收窗（${until}，凭据 ${kind}）` +
    '\n[lodes] 台账已就地改写——跑一次 `git diff assets/lodes/map-drop-windows.json` 逐行过目。',
)
