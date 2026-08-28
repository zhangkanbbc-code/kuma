// 把镝战斗视图的**对阵区**（arenaHtml 与它下面的 sideRowsHtml）原样切出来真编译一遍，
// 好让全歼横线那条护栏对着产物 HTML 下断言。
//
// 做法照搬 render-di-battle.mjs：整段从 di.ts 切走，源码一个字不改，
// 它引用到的外部名字在这里补桩；只补**真的会执行到**的那几个。
//
// 「横线挂在哪一层」这件事只能对着产物验：内层那枚 inline 少包一层、或者把小标也一起包
// 进去，样式表一个字都不用改就变形了——正则钉源码是钉不住的。
// 全歼判据 `fleetWipeStage` **引真的那一份**：桩成「有沉船就算全歼」的话，
// 「谁被全歼」这条腿写反了，横线照样挂得整整齐齐、护栏一片绿。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const source = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'modules', 'di.ts'), 'utf8')

const sliceBetween = (from, to, label) => {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `di.ts 里找不到「${label}」，这条守卫的锚点要跟着改`)
  return source.slice(start, end)
}

// 从伤害位数一路切到结果条之前：sideRowsHtml（护卫队那一行的队名）、wipedNameHtml、
// wipeNoteHtml、mainFleetWipe、arenaHtml（标题栏的主力队名）全在这一段里。
// 三处 .wiped 落点一次编出来——切了标题栏不切护卫行，漏一处也看不见。
const ARENA = sliceBetween(
  'const dmgDigits = (ships: BattleShipView[]): number =>',
  'const resultStripHtml = (b: BattleView): string => {',
  '对阵区 arenaHtml（含 sideRowsHtml / wipedNameHtml）',
)

const FLEET_WIPE = path.join(ROOT, 'src', 'shared', 'fleet-wipe.ts').replace(/\\/g, '/')

const HARNESS = `
import { fleetWipeStage } from '${FLEET_WIPE}'

type BattleView = any
type BattleShipView = any
type SortieView = any
type NightDeck = any
type NightEngagement = any

const ENT: any = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (c: string) => ENT[c])

// 舰行本身与这条护栏无关，收成一枚可辨认的桩；队名那一层才是要看的。
const browHtml = (_b: any, side: any, ship: any, mark: string) =>
  \`<div class="brow" data-side="\${side}">\${esc(ship.name)}\${mark}</div>\`
const nightEngagementOf = (_b: any) => null
const isDamageOnlyBattle = (b: any) => b.kind === 'airraid' || b.kind === 'radar'
const formationPill = (_f: any) => ''
const fleetLabel = (deck: any) => ({ canonical: deck.name })
const mapIdOf = (area: number, no: number) => area * 10 + no
const firstKillBadgeInSortieHtml = (..._a: any[]) => ''
const mg: any = { decks: [] }

${ARENA}

export { arenaHtml, sideRowsHtml, wipedNameHtml, mg }
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-di-arena-'))
  const entry = path.join(dir, 'arena.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'arena.cjs')
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

export const renderArena = (battle, sortie = {}) =>
  loaded.arenaHtml(battle, {
    active: true,
    practice: false,
    mapArea: 1,
    mapNo: 5,
    deckId: 1,
    currentCell: 1,
    startTs: 0,
    ...sortie,
  })

/** 一条只够画对阵区的最小战斗视图；逐例只覆盖自己关心的键。 */
export const battleOf = (patch = {}) => ({
  kind: 'day',
  practice: false,
  enemyDeckName: null,
  fFormation: 1,
  eFormation: 1,
  fShips: [],
  eShips: [],
  attacks: [],
  prediction: { fGauge: 0 },
  ...patch,
})
