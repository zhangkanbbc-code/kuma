// 把 store.ts 的战果包字段读取器那一段原样切出来编译一遍，取其中的战后奖励读取器
// `battleRewardsOf`：节点道具掉落（api_get_useitem）、EO 击破奖励（api_get_exmap_useitem_id）、
// 活动海域攻略奖励（api_get_eventitem / api_select_reward_dict）。
//
// 切法与 store-result-readers.mjs 相同（同一段、同一对锚点），只是单独成文件：
// 读取器尚未实现时这里导出 undefined，由测试当场报红，不连累共用那份夹具的其它测试。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const source = fs
  .readFileSync(path.join(ROOT, 'src', 'main', 'mg', 'store.ts'), 'utf8')
  .replace(/\r\n/g, '\n')

const from = 'const dropShipGetMessage = (dropShip: any): string => {'
const to = 'const enemyPreviewOf ='
const start = source.indexOf(from)
const end = source.indexOf(to, start)
assert.ok(start >= 0 && end > start, 'store.ts 里找不到「战果包字段读取器」，这条守卫的锚点要跟着改')

// 没有 battleRewardsOf 这个名字时 typeof 给 'undefined'，不会因未声明而编不过。
const HARNESS = `
${source.slice(start, end)}

const battleRewardsReader = typeof battleRewardsOf === 'function' ? battleRewardsOf : undefined
export { battleRewardsReader }
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-store-battle-rewards-'))
  const entry = path.join(dir, 'rewards.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'rewards.cjs')
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

export const { battleRewardsReader } = createRequire(import.meta.url)(bundle)
