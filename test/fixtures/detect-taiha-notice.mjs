// 把铃的大破探测（`detectTaiha` 连同它那两个去重集合）**原样切出来**真编译一遍，
// 好让护栏对着「到底发了几条通知、每条写的什么」下断言。
//
// 做法照搬 test/fixtures/render-di-battle.mjs 与 render-ru-row.mjs：整段从 lg.ts 切走，
// 源码一个字不改，它引用到的外部名字在这里补桩。
// **不断言源码文本**——「去重键少了出击标识」「闸门装在 danger 档上」这类写法
// 正则一条也拦不住：它们全是运行期状态，只有连着跑几场才看得出来。
//
// 分档判定（shared/taiha-verdict）**引真的那一份**，不补桩：桩一写成「有大破就红档」，
// protected 这一档到底有没有接上就看不出来了。
//
// ⚠ 同一段还被 test/fixtures/escape-consumers.mjs 切了一份（那边把**真的**退避三件套
// 与 engagedShips 编进来，钉的是「退避舰不再进大破名单」）。两份的桩边界不同、
// 各有各的用处，但切的是同一段源码：**改动 detectTaiha 时两边的 import 都要跟着带齐**，
// 少一个名字那边不会编译失败，只会在跑到那条分支时抛 ReferenceError。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const source = fs.readFileSync(
  path.join(ROOT, 'src', 'renderer', 'modules', 'lg.ts'),
  'utf8',
).replace(/\r\n/g, '\n')

const cut = (from, to, label) => {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `lg.ts 里找不到「${label}」，这条守卫的锚点要跟着改`)
  return source.slice(start, end)
}

// 两个去重集合与 detectTaiha 是一体的，必须切在一起：
// 只切函数不切状态的话，「集合在哪一层、什么时候清空」这件事就整个不在护栏里了。
const DETECT_TAIHA = cut(
  '// 大破（阻断级）\nlet taihaSeen = new Set<string>()',
  '// 应急修理（要員 42 / 女神 43）',
  '大破探测 detectTaiha（含 taihaSeen / protectedTaihaSeen）',
)

const TAIHA_VERDICT = path.join(ROOT, 'src', 'shared', 'taiha-verdict.ts').replace(/\\/g, '/')

const HARNESS = `
import {
  ESCORT_FLAGSHIP_INDEX,
  flagshipHasDameconIn,
  isTaihaShip,
  taihaVerdictOf,
} from '${TAIHA_VERDICT}'

type BattleShipView = any
type EntityRef = any

export const mg: any = { sortie: null, master: { ships: {}, slotitems: {} }, ships: {}, slotitems: {} }

// 发出去的通知逐条记下来：护栏问的就是「发了几条、第几条写的什么」。
export const sent: any[] = []
const notify = (
  event: string,
  title: string,
  detail: string,
  ref?: EntityRef,
  presentation?: any,
) => { sent.push({ event, title, detail, ref, presentation }) }

// 本地化在这条路上只是透传（lg.ts 那一步是为了与应急修理横幅统一字形），
// 与去重无关，给最平淡的桩。
const entityNamePlain = (_kind: string, _id: number, name: string) => name

// 勿扰暂留队列：detectTaiha 只在「归港」那一支碰它。空队列 = 没有待补发的，
// 也就是这份护栏关心的默认局面。
const heldQueue: any[] = []
const dndActive = () => false
const flushHeld = () => {}

${DETECT_TAIHA}

export { detectTaiha }
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-lg-taiha-'))
  const entry = path.join(dir, 'detect.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'detect.cjs')
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
 * 摆一次账本状态然后跑一遍探测。返回**这一次**新发出的通知（不是累计），
 * 好让用例一场一场地数。
 */
export const runDetect = (sortie) => {
  loaded.mg.sortie = sortie
  const before = loaded.sent.length
  loaded.detectTaiha()
  return loaded.sent.slice(before)
}

/** 累计发过的全部通知；跨用例要清就调 resetSent。 */
export const sentNotices = () => loaded.sent.slice()
export const resetSent = () => { loaded.sent.length = 0 }

/**
 * 归港：`active` 落下的那一帧。detectTaiha 正是在这里清空两个去重集合，
 * 所以用例想「回港再出门」就调它——那是真代码的清空路径，不是测试自己伸手改状态。
 */
export const returnToPort = () => runDetect({ active: false, practice: false, battle: null })

/** 战斗视图里的一艘舰；只有判定真会读的那几个键。 */
export const shipOf = (index, patch = {}) => ({
  index,
  rosterId: 100 + index,
  mstId: 200 + index,
  name: `我舰${index + 1}`,
  fleet: 'main',
  hpStart: 50,
  hpEnd: 50,
  hpMax: 50,
  sunk: false,
  escaped: false,
  equipment: [],
  ...patch,
})

/**
 * 一支编队，把 `taihaIndexes` 那几位打成大破（5/50 = 0.1）。
 *
 * 联合与否由 lg.ts 读 `fleet === 'escort'` 判定，而 `fleet` 在 battle.ts 那边是按
 * **段的 base** 定的（主力段 base=0）——所以单队 7 舰的遊撃部隊连第七位也是 main，
 * 超过 7 位才有护卫段。这里照那个真构造给，别一律按 index≥6 发 escort：
 * 那样单队第七位会被误当成二队旗舰，「非联合时位 6 照常算危险」这条就永远试不到。
 */
export const fShipsWithTaiha = (taihaIndexes, count = 12) => {
  const combined = count > 7
  const ships = Array.from({ length: count }, (_, i) =>
    shipOf(i, { fleet: combined && i >= 6 ? 'escort' : 'main' }),
  )
  for (const i of taihaIndexes) ships[i] = { ...ships[i], hpEnd: 5 }
  return ships
}

/**
 * 一次出击的最小视图；逐例只覆盖自己关心的键。
 *
 * `taihaCorrections` 是铭侧权威 HP 对账推的那一格（见 shared/sortie-hp-audit）：
 * 0 = 这一场没有更正，走原来的去重；推一格 = 这一条是更正，两层去重都要豁免。
 */
export const sortieOf = (patch = {}) => ({
  active: true,
  practice: false,
  mapArea: 3,
  mapNo: 5,
  deckId: 1,
  bossCell: -1,
  nodes: [],
  currentCell: 1,
  battle: null,
  battleCount: 1,
  taihaCorrections: 0,
  startTs: 1000,
  ...patch,
})
