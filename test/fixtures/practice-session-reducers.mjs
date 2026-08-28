// 把演习那两个 reducer（看对手编成 / 真开战）与 `newSortie` **原样切出来**真编译一遍，
// 好让护栏喂真报文、对着 state.sortie 下断言。
//
// ⚠️ **不许直接 import store.ts**：那个文件一 import 就会打开用户的真账本并跑迁移
//（2026-08-25 亲测踩过一次）。所以走切片编译这条路，与
// fixtures/render-di-battle.mjs、fixtures/render-ship-caption.mjs 同一手法。
//
// 判据一个字不改——断言的是**真代码**的行为，不是源码正则：
// 「看对手时 active 是不是 false」这种事，正则写反了照样绿。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
// store.ts 是 CRLF 存的；跨行锚点按 \n 写，所以读进来先归一，免得锚点凭空找不到
const source = fs
  .readFileSync(path.join(ROOT, 'src', 'main', 'mg', 'store.ts'), 'utf8')
  .replace(/\r\n/g, '\n')

const sliceBetween = (from, to, label) => {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `store.ts 里找不到「${label}」，这条守卫的锚点要跟着改`)
  return source.slice(start, end)
}

/** `newSortie` 的默认值表——`active: true` 就住在这里，切它是为了不把默认值抄第二遍。 */
const NEW_SORTIE = (() => {
  const head = 'const newSortie = (partial: Partial<SortieView>): SortieView => ({'
  const start = source.indexOf(head)
  assert.ok(start >= 0, 'store.ts 里找不到 newSortie，这条守卫的锚点要跟着改')
  const end = source.indexOf('\n})', start)
  assert.ok(end > start, 'newSortie 没有可识别的结尾')
  return source.slice(start, end + 3)
})()

/**
 * 切一个 reducer 出来，改写成具名导出函数，**主体一个字不动**。
 * 结尾按它自己的终止符（2 空格缩进的 `},`）找——用下一个 reducer 的键当结尾会
 * 把中间的注释和 `},` 一起带进来。
 */
const asReducer = (name, head, label) => {
  const start = source.indexOf(head)
  assert.ok(start >= 0, `store.ts 里找不到「${label}」，这条守卫的锚点要跟着改`)
  const end = source.indexOf('\n  },\n', start)
  assert.ok(end > start, `「${label}」没有可识别的结尾`)
  // end 指向终止符（换行 + 两空格 + 右花括号 + 逗号）的开头；取 4 个字符正好拿到
  // 「换行 + 两空格 + 右花括号」，**不要**把那个逗号一起带上——带上就成了逗号
  // 表达式，下一个 export 当场语法错。
  const body = source.slice(start + head.indexOf('('), end + 4)
  return `export const ${name} = ${body}`
}

const ENEMY_INFO = asReducer(
  'getPracticeEnemyinfo',
  "'/kcsapi/api_req_member/get_practice_enemyinfo': (body, _post, ts) => {",
  '看对手编成 reducer',
)
const PRACTICE_BATTLE = asReducer(
  'practiceBattle',
  "'/kcsapi/api_req_practice/battle': (body, post, ts) => {",
  '演习开战 reducer',
)

const HARNESS = `
type SortieView = any
type Section = string

export const state: any = { sortie: null }

// 演习开战那条会调这两个；本夹具只关心会话字段，战斗解析给最小桩。
const fleetContext = {} as any
const parseBattle = (_path: string, _body: any, _ctx: any, ts: number) => ({ kind: 'practice', ts })

${NEW_SORTIE}

${ENEMY_INFO}

${PRACTICE_BATTLE}

export { newSortie }
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-practice-'))
  const entry = path.join(dir, 'practice.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'practice.cjs')
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

/** 从零开一局：清掉会话状态。 */
export const reset = () => {
  loaded.state.sortie = null
}

/** 当前会话（reducer 写进去的那一份）。 */
export const sortie = () => loaded.state.sortie

/** 喂一条「打开演习对手编成」报文。 */
export const feedEnemyInfo = (body, ts = 1_700_000_000_000) =>
  loaded.getPracticeEnemyinfo(body, {}, ts)

/** 喂一条「演习开战」报文。 */
export const feedPracticeBattle = (body = {}, post = { api_deck_id: '2' }, ts = 1_700_000_100_000) =>
  loaded.practiceBattle(body, post, ts)

/** `newSortie` 的默认值（用来证明「默认就是 active: true」这件事仍然成立）。 */
export const newSortie = loaded.newSortie

/** 一份最小可用的对手编成报文。 */
export const enemyInfoBody = (overrides = {}) => ({
  api_member_id: 12345,
  api_nickname: '对面提督',
  api_level: 99,
  api_rank: '中将',
  api_deckname: '第一舰队',
  api_deck: { api_ships: [{ api_ship_id: 131, api_level: 155, api_star: 3 }] },
  ...overrides,
})
