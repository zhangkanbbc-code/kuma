// 把友军遭遇志的**建表语句与两个方法原样切出来**真编译一遍，跑在内存库上。
// 手法与 fixtures/store-friendly-request.mjs 同源。
//
// ⚠️ **不许直接 import ledger.ts**：那个文件一 import 就会打开用户的真账本并跑迁移。
//
// 为什么非得跑真 SQL：这一族的全部难点在幂等。
// 「回放两遍不会多出行」这件事是 `INSERT OR IGNORE` + 主键（指纹, 时刻）共同保证的，
// 少写一个 OR IGNORE、或者主键少一列，源码读起来一样自然，
// 只有真往库里插两遍才看得见第二遍到底进没进去。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const source = fs
  .readFileSync(path.join(ROOT, 'src', 'main', 'mg', 'ledger.ts'), 'utf8')
  .replace(/\r\n/g, '\n')

const sliceBetween = (from, to, label) => {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `ledger.ts 里找不到「${label}」，这条守卫的锚点要跟着改`)
  return source.slice(start, end)
}

// 建表语句连注释一起搬：注释里写着口径，搬走了下一个人还看得见
const DDL = sliceBetween(
  '-- 友军遭遇志：战斗报文带 api_friendly_info 时记一行。',
  '-- 出击预测样本',
  'friendly_fleets 建表语句',
)

/** 切一个方法出来，改写成具名导出函数。主体只把 `this.db` 换成 `db`，其余一个字不动。 */
const asMethod = (name, head, label) => {
  const start = source.indexOf(head)
  assert.ok(start >= 0, `ledger.ts 里找不到「${label}」，这条守卫的锚点要跟着改`)
  const end = source.indexOf('\n  }\n', start)
  assert.ok(end > start, `「${label}」没有可识别的结尾`)
  const body = source.slice(start + head.indexOf('('), end + 4)
  return `export const ${name} = ${body.replace(/this\.db/g, 'db')}`
}

const LOG = asMethod(
  'logFriendlyFleet',
  '  logFriendlyFleet = (sighting: FriendlyFleetSighting) => {',
  '友军遭遇写入 logFriendlyFleet',
)
const QUERY = asMethod(
  'queryFriendlyFleets',
  '  queryFriendlyFleets = (map: number, difficulty: number): FriendlyFleetRecord[] => {',
  '友军遭遇读取 queryFriendlyFleets',
)

const SHARED = path.join(ROOT, 'src', 'shared', 'friendly-fleet.ts').replace(/\\/g, '/')

const HARNESS = `
import { DatabaseSync } from 'node:sqlite'
import {
  groupFriendlySightings,
  type FriendlyFleetRecord,
  type FriendlyFleetShip,
  type FriendlyFleetSighting,
} from '${SHARED}'

const db: any = new DatabaseSync(':memory:')
db.exec(${JSON.stringify(DDL)})

${LOG}
${QUERY}

/** 库里到底有几行——聚合读不出来的重复只有数原始行才看得见。 */
export const rowCount = (): number =>
  db.prepare('SELECT COUNT(*) AS n FROM friendly_fleets').get().n

/** 原始行，用来验字段是不是真落到了对应的列上。 */
export const rawRows = (): any[] =>
  db.prepare('SELECT * FROM friendly_fleets ORDER BY ts').all()

export const wipe = () => { db.exec('DELETE FROM friendly_fleets') }
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-friendly-ledger-'))
  const entry = path.join(dir, 'ledger-slice.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'ledger-slice.cjs')
  buildSync({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['node:sqlite'],
    logLevel: 'silent',
  })
  return outfile
})()

const loaded = createRequire(import.meta.url)(bundle)

export const { logFriendlyFleet, queryFriendlyFleets, rowCount, rawRows, wipe } = loaded
/** 建表语句原文，供「这张表建了哪些列」一类的断言使用。 */
export const DDL_TEXT = DDL
