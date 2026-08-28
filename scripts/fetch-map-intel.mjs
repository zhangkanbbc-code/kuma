// 单独刷新海域情报目录；显式运行，应用运行时绝不联网。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  fetchMapIntel,
  jstDate,
  loadMasterShipNames,
  loadNormalMapLast,
  preserveEventMaps,
  preserveLimitedHistory,
} from './map-intel.mjs'
import {
  assertNoPendingMapIntelCandidate,
  stageMapIntelCandidate,
} from './map-intel-review.mjs'

const root = path.join(fileURLToPath(import.meta.url), '..', '..')
const outDir = path.join(root, 'assets', 'lodes')
const shipsFile = path.join(outDir, 'kcwiki-ships.json')
const shipsPack = JSON.parse(readFileSync(shipsFile, 'utf8'))
const now = new Date()
const runDate = jstDate(now)
const cacheDir = path.join(os.tmpdir(), 'kanso-map-intel-cache', now.toISOString().slice(0, 10))
const output = path.join(outDir, 'map-intel.json')
if (existsSync(output)) {
  assertNoPendingMapIntelCandidate(output, process.argv.includes('--force'))
}
// 舰名解析：主数据快照权威、kcwiki 兜底（kcwiki 对新实装滞后，杉 2026-08 实锤）
const masterNames = loadMasterShipNames(root)
if (!masterNames) {
  console.warn('[lodes] ⚠ 没找到仓库上一级的 s2.json——舰名解析退回 kcwiki 单基准，新实装舰可能对不上')
}
const data = await fetchMapIntel(shipsPack, {
  cacheDir,
  minIntervalMs: 10_500,
  masterNames: masterNames ?? [],
  // 常规图清单以主数据推导——5-6 实装被写死表漏抓的教训(2026-08-11)
  mapLast: loadNormalMapLast(root),
})
const current = existsSync(output) ? JSON.parse(readFileSync(output, 'utf8')) : null
const preserved = current ? preserveEventMaps(data, current) : 0
const preservedLimited = current ? preserveLimitedHistory(data, current) : 0
const pack = {
  meta: {
    id: 'map-intel',
    name: '海域确认掉落与敌编成',
    version: runDate.replaceAll('-', '.'),
    source: '艦これ攻略 Wiki',
    sourceUrl: 'https://wikiwiki.jp/kancolle/',
    fetchedAt: now.toISOString(),
    upstreamUpdatedAt: null,
    license: 'WIKIWIKI 内容条款——仅用户显式拉取，不随包分发',
    // 玩家可见（lodeCredit 的「源」悬停）：一两句人话，不写考古。
    // 这个包的维护者备忘在 scripts/lode-sources.json 的 map-intel 条目 maintainerNote 里。
    note: '海域各点位确认过的掉落、限定掉落时段与敌方编成，不含掉落概率',
    ...(current?.meta?.eventRefresh ? { eventRefresh: current.meta.eventRefresh } : {}),
  },
  data,
}
mkdirSync(outDir, { recursive: true })
if (preserved) console.log(`[lodes]   保留活动维护包 ${preserved} 图（甲乙丙丁不改写）`)
if (preservedLimited) console.log(`[lodes]   保留限定历史 ${preservedLimited} 条`)
if (current) {
  stageMapIntelCandidate(output, current, pack)
} else {
  writeFileSync(output, JSON.stringify(pack))
  console.log(`[lodes] 首次生成，无旧包可比较：map-intel → ${output}`)
}
