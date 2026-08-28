// 把「联合编成第 2 舰队算不算空闲」这条判定的三处真码原样切出来编一遍，
// 好让护栏对着**产物 HTML / 真返回值**下断言，而不是拿正则去比对源码文本。
//
// 为什么非得切真的：这一族 bug 的全部形态都是「判断写漏了一个分支」，
// 源码文本却长得人畜无害——把 `combinedEscortState(d.id)` 那一项从 filter 里删掉、
// 或者把 sortie 分支和 formed 分支的文案对调，正则匹配一条也拦不住，界面却已经在骗人了。
//
// 判定本体 `combinedEscortState` **引真的那一份**（从 kernel.ts 原样切走），不打桩：
// 桩一写成「联合就算出击」，「编队中/出击中」两态的分界就在测试里被抹平了，
// 而那条分界正是这次要守的东西。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const read = (...rel) => fs.readFileSync(path.join(ROOT, ...rel), 'utf8').replace(/\r\n/g, '\n')

const kernel = read('src', 'renderer', 'kernel.ts')
const header = read('src', 'renderer', 'header-status.ts')
const bi = read('src', 'renderer', 'modules', 'bi.ts')

const cutFrom = (src, from, to, label) => {
  const start = src.indexOf(from)
  assert.ok(start >= 0, `切不到「${label}」的起点，这条守卫的锚点要跟着改`)
  const end = to === null ? src.length : src.indexOf(to, start + from.length)
  assert.ok(end > start, `切不到「${label}」的终点，这条守卫的锚点要跟着改`)
  return src.slice(start, end)
}

// ---- 判定本体（真的，不打桩）----
const ESCORT_STATE = cutFrom(
  kernel,
  "export type CombinedEscortState = 'sortie' | 'formed'",
  null,
  '内核的 combinedEscortState',
)

// ---- 顶栏远征芯片：三态判定 + class 表 + 整个 expeditionsHtml ----
const HEADER_CHIPS = cutFrom(
  header,
  "type ExpeditionChipState = 'away' | 'back' | 'unsupplied' | 'idle'",
  '\n// 「在外 → 归来」发生在倒计时归零那一刻',
  '顶栏远征芯片 expeditionsHtml',
)

// ---- 铉：空闲舰队清单 + 甘特条 ----
const BI_DECKS = cutFrom(
  bi,
  'const expeditionDecks = (): Deck[] =>',
  '\nconst pickDeck = ',
  '铉的 expeditionDecks / freeDecks',
)
const BI_GANTT = cutFrom(
  bi,
  'const fleetStatusHtml = (): string => {',
  '\nconst nativeRewardItems = ',
  '铉的甘特条 fleetStatusHtml',
)
// 远征规划的舰候选池：队号那头剔干净了，舰这头也得剔——否则方案会去拆随伴舰队。
const BI_POOL = cutFrom(
  bi,
  '// 可用池：排除远征在途、入渠中、大破',
  '\n// 取舍顺序：闲置优先',
  '铉的 availableShips',
)

const HARNESS = `
type Deck = any
type PlayerShip = any

export const mg: any = {
  decks: [],
  ships: {},
  ndocks: [],
  master: { missions: {} },
  combinedFlag: 0,
  sortie: null,
}

// 规划器的两项用户偏好（保护某队 / 排除某舰）与联合无关，给空表；
// 用例要试它们的时候直接往这上面写。
export const plannerPrefs: any = { protectedDeckIds: [], excludedRosterIds: [] }

// 与本次要守的行为无关，给最平淡的桩。转义用真口径（属性值里的引号必须被吃掉），
// 否则 title 断言会在一个假的转义上过关。
const esc = (s: unknown) => \`\${s ?? ''}\`.replace(/[&<>"']/g, (c) => \`&#\${c.charCodeAt(0)};\`)
const fmtCountdownShort = (_ts: number, done = '') => done || '0:00:00'
const entityNamePlain = (_kind: string, _id: number, name: string) => name
const fleetLabel = (deck: any) => ({ canonical: \`第\${deck.id}舰队\`, custom: null })
// 未补给：由夹具直接摆布（真判定是锐的 isUnsupplied，与这条守卫无关）
export const unsuppliedDeckIds = new Set<number>()
const fleetHasUnsupplied = (deck: any) => unsuppliedDeckIds.has(deck.id)
// 甘特条右侧的补给角标：本条只看左边那格状态词，给个恒定桩免得把断言写脆
const supplyIconHtml = (_deck: any) => '<span class="g-supply"></span>'

${ESCORT_STATE}
${HEADER_CHIPS}
${BI_DECKS}
${BI_GANTT}
${BI_POOL}

export { expeditionsHtml, fleetStatusHtml, freeDecks, expeditionChipState, availableShips }
`

const loaded = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-combined-escort-'))
  const entry = path.join(dir, 'escort.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'escort.cjs')
  buildSync({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  })
  return createRequire(import.meta.url)(outfile)
})()

/**
 * 摆一局。
 *
 * `fleets`  每项 { id, mission?: [state, missionId, returnTs, 0], ships?: number[], unsupplied?: boolean }
 * `combinedFlag` 0 未编成 / 1 空母机动 / 2 水上打击 / 3 运输护卫
 * `sortie` 直接给 SortieView 的相关几位：{ active, practice, deckId }
 * `ships`  在籍表 { [rosterId]: { id, lv, cond, nowhp, maxhp, slot, slotEx } }，
 *          缺省项补成「满血低练」——远征候选池只在乎「够不够得着」，属性不参与这条判定
 * `ndocks` 入渠位 [{ shipId }]
 */
export const reset = ({ fleets = [], combinedFlag = 0, sortie = null, ships = {}, ndocks = [] } = {}) => {
  loaded.mg.decks = fleets.map((f) => ({
    id: f.id,
    name: `第${f.id}艦隊`,
    mission: f.mission ?? [0, 0, 0, 0],
    ships: f.ships ?? [],
  }))
  loaded.mg.ships = Object.fromEntries(
    Object.entries(ships).map(([id, s]) => [
      id,
      { id: Number(id), lv: 1, cond: 49, nowhp: 30, maxhp: 30, slot: [-1, -1, -1, -1], slotEx: 0, ...s },
    ]),
  )
  loaded.mg.ndocks = ndocks
  loaded.mg.combinedFlag = combinedFlag
  loaded.mg.sortie = sortie
  loaded.plannerPrefs.protectedDeckIds = []
  loaded.plannerPrefs.excludedRosterIds = []
  loaded.unsuppliedDeckIds.clear()
  for (const f of fleets) if (f.unsupplied) loaded.unsuppliedDeckIds.add(f.id)
}

/** 常规四支队，2/3/4 都没在远征。 */
export const FOUR_IDLE_FLEETS = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]

export const renderHeaderChips = () => loaded.expeditionsHtml()
export const renderGantt = () => loaded.fleetStatusHtml()
/** 铉眼里的「空闲舰队」队号清单 */
export const freeDeckIds = () => loaded.freeDecks().map((d) => d.id)
/** 铉的远征方案能拿来凑队的那些舰（在籍 id） */
export const availableShipIds = () => loaded.availableShips().map((s) => s.id)

/**
 * 从顶栏产物里把某一枚芯片整段抠出来。
 *
 * 芯片只有一层 span（里面的 <i>/<em>/<b> 各自闭合），所以到第一个 `</span>` 就收——
 * 收晚一个就会把下一枚芯片的文字也吞进来，断言会在别人的字上过关。
 * `data-fleet` 恒紧跟 class：远征那枚后面还跟着 data-timer，所以此处只锚到 data-fleet。
 */
export const chipOf = (deckId) => {
  const html = renderHeaderChips()
  const re = new RegExp(`<span class="hs-chip exp[^"]*" data-fleet="${deckId}"[\\s\\S]*?</span>`)
  const hit = re.exec(html)
  assert.ok(hit, `顶栏产物里找不到第 ${deckId} 舰队的芯片\n${html}`)
  return hit[0]
}

/** 芯片上那两三个字（<em> 或 <b> 里的文本） */
export const chipLabel = (deckId) => {
  const hit = /<(?:em|b)[^>]*>([^<]*)<\/(?:em|b)>/.exec(chipOf(deckId))
  return hit ? hit[1] : ''
}

/** 芯片的 class 串 */
export const chipClass = (deckId) => /class="([^"]*)"/.exec(chipOf(deckId))[1]

/** 芯片的 title（已解转义回可读文本，断言里好写） */
export const chipTitle = (deckId) => {
  const raw = /title="([^"]*)"/.exec(chipOf(deckId))[1]
  return raw.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
}
