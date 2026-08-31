// 把镝（di.ts）的**战型分类那一段**原样切出来真编译一遍：
// `isDamageOnlyBattle` / `isDayFlowBattle` / `battleTypeLabel` / `battleForecastLead`。
//
// 手法与同目录的 render-di-battle.mjs、render-di-heading.mjs 相同：源码一个字不改，
// 引用到的外部名字在这里补桩。**不用正则钉源码文本**——加一档时漏了某一路分支、
// 或者把对潜空袭错挂进「只算我方损害率」那一族，正则一条也拦不住，
// 只有把真的那份函数跑一遍才看得出来。
//
// 用它的护栏：test/sub-air-raid.test.mjs。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const source = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'modules', 'di.ts'), 'utf8')

// 从「只算我方损害率」那条判据的头注切起，切到下一个函数为止：
// 四个函数是连着的一段，中间的注释一并带走。
const start = source.indexOf('// 「只算我方损害率」的节点')
const end = source.indexOf('const battleUsesEngagement =', start)
assert.ok(
  start >= 0 && end > start,
  'di.ts 里找不到战型分类那一段（isDamageOnlyBattle…battleForecastLead），这条守卫的锚点要跟着改',
)
const SECTION = source.slice(start, end)

const HARNESS = `
type BattleView = any

${SECTION}

export { isDamageOnlyBattle, isDayFlowBattle, battleTypeLabel, battleForecastLead }
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-di-battle-type-'))
  const entry = path.join(dir, 'kind.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'kind.cjs')
  buildSync({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  })
  return outfile
})()

const loaded = createRequire(import.meta.url)(bundle)

export const isDamageOnlyBattle = (battle) => loaded.isDamageOnlyBattle(battle)
export const isDayFlowBattle = (battle) => loaded.isDayFlowBattle(battle)
export const battleTypeLabel = (battle) => loaded.battleTypeLabel(battle)
export const battleForecastLead = (battle) => loaded.battleForecastLead(battle)
