// 把 store.ts 里那两个战斗归约器（`onDayBattle` / `onNightBattle`，连同它们脚下的
// `syncBattleHp` / `collectSunkShips` / `newSortie`）**原样切出来**真编译一遍，
// 好让护栏对着真报文喂「防空视图在场 → 夜战包到达」这一串，再对 state.sortie 下断言。
//
// ⚠️ **不许直接 import store.ts**：那个文件一路拉到 `../env`（`app.getVersion()`），
// node --test 载不进 electron；而且 import 就会打开用户的真账本并跑迁移。
// 手法与 fixtures/store-escape-reducers.mjs、fixtures/store-anchorage-reducer.mjs 相同：
// 判据一个字不改。「夜战该不该并进防空视图」这种事，正则匹配源码文本写反了照样绿。
//
// 换成桩的只有牵 electron 的那一处（语音台账的落盘层）与舰队上下文；
// `parseBattle` / `mergeNight` / `parseBaseDefenseBattle` / `newSunkEntries`
// 一律**引真的那一份**——桩一写成「夜战包不改 HP」，被修掉的污染就在测试里复活了。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
// store.ts 是 CRLF 存的；锚点里写 \n 会一个都对不上，先统一成 LF 再切。
const source = fs
  .readFileSync(path.join(ROOT, 'src', 'main', 'mg', 'store.ts'), 'utf8')
  .replace(/\r\n/g, '\n')

const sliceBetween = (from, to, label) => {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `store.ts 里找不到「${label}」，这条守卫的锚点要跟着改`)
  return source.slice(start, end)
}

// syncBattleHp / collectSunkShips / onDayBattle / onNightBattle 是连着的一段，整段切
const BATTLE_REDUCERS = sliceBetween(
  'const syncBattleHp = (battle:',
  '// ---- 归约器表：path →',
  '战斗归约器（syncBattleHp…onNightBattle）',
)

const NEW_SORTIE = (() => {
  const head = 'const newSortie = (partial: Partial<SortieView>): SortieView => ({'
  const start = source.indexOf(head)
  assert.ok(start >= 0, 'store.ts 里找不到 newSortie，这条守卫的锚点要跟着改')
  const end = source.indexOf('\n})', start)
  assert.ok(end > start, 'newSortie 没有可识别的结尾')
  return source.slice(start, end + 3)
})()

// esbuild 是 bundle 模式、入口写在临时目录，所以给绝对路径（正斜杠，Windows 也认）
const abs = (...parts) => path.join(ROOT, ...parts).replace(/\\/g, '/')
const BATTLE = abs('src', 'main', 'mg', 'battle.ts')
const SORTIE_MOURNING = abs('src', 'shared', 'sortie-mourning.ts')

const HARNESS = `
import { mergeNight, parseBaseDefenseBattle, parseBattle } from '${BATTLE}'
import { newSunkEntries } from '${SORTIE_MOURNING}'

type SortieView = any
type Section = string

export const state: any = {
  player: { ships: {}, decks: [], combinedFlag: 0, slotitems: {} },
  master: { ships: {} },
  sortie: null,
}

// 语音亲历台账是落盘层（经 ../env 牵 electron），换成一张表：
// 既不碰磁盘，又能断言这两个入口都照旧记过一次。
export const voiceCalls: any[] = []
const recordAbyssVoiceSightings = (voices: any, _ts: number) => { voiceCalls.push(voices) }

// 战斗解析器取我方舰队信息的桥。本份护栏不测编成读取，给一份固定的六人队即可；
// 在籍 id 与 fixtures/../core-regressions 的 battleContext 同一套（deckId*100 + 位次）。
const fleetContext: any = {
  fleetShips: (deckId: number) =>
    Array.from({ length: 6 }, (_unused, i) => ({
      rosterId: deckId * 100 + i,
      mstId: deckId * 100 + i,
      name: \`D\${deckId}-\${i + 1}\`,
      lv: 1,
      nowHp: 50,
      maxHp: 50,
      equipments: [],
    })),
  masterName: (mstId: number) => \`E\${mstId}\`,
  masterMaxEq: () => [],
  combinedType: () => state.player.combinedFlag,
}

${NEW_SORTIE}

${BATTLE_REDUCERS}

export { newSortie, onDayBattle, onNightBattle, parseBaseDefenseBattle, fleetContext }
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-battle-reducers-'))
  const entry = path.join(dir, 'reducers.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'reducers.cjs')
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

/**
 * 摆一局出击。
 *
 * @param options.sortie  出击切片补丁；`null` = 没在出击
 * @param options.ships   `{ [rosterId]: nowhp }`，玩家在籍舰的当前血（供 syncBattleHp 回写）
 */
export const reset = ({ sortie = {}, ships = {} } = {}) => {
  loaded.state.player.ships = {}
  for (const [id, nowhp] of Object.entries(ships)) {
    loaded.state.player.ships[+id] = { id: +id, shipId: +id, nowhp, maxhp: 50 }
  }
  loaded.state.player.decks = [{ id: 1, ships: Object.keys(ships).map(Number) }]
  loaded.state.player.combinedFlag = 0
  loaded.state.sortie =
    sortie === null ? null : loaded.newSortie({ deckId: 1, currentCell: 12, ...sortie })
  loaded.voiceCalls.length = 0
}

/** 直接把进点报文内嵌的基地防空结算挂上 sortie.battle（map/start、map/next 就是这么干的）。 */
export const seedBaseDefense = (body, ts = 1_700_000_000_000) => {
  loaded.state.sortie.battle = loaded.parseBaseDefenseBattle(body, loaded.fleetContext, ts)
  return loaded.state.sortie.battle
}

export const feedDayBattle = (apiPath, body, ts = 1_700_000_000_000) =>
  loaded.onDayBattle(apiPath)(body, {}, ts)

export const feedNightBattle = (apiPath, body, ts = 1_700_000_000_001) =>
  loaded.onNightBattle(apiPath)(body, {}, ts)

export const sortie = () => loaded.state.sortie
export const playerShips = () => loaded.state.player.ships
export const voiceCalls = () => loaded.voiceCalls
