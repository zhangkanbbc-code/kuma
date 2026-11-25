// 战果评级按评级各上一色（维护者裁决 2026-11-25）：S 金、A 红、B 橙、C 蓝、D/E 灰。
// 范围：结算横幅「S 胜确定」那一段、结果条「判定 / 预测」芯片、海图节点上的评级小字母、
// 史的出击记录里的评级标签。横幅前半句（战斗类型 · 交战形态）改回正文色，评级那段才跳得出来。
// 认不出的评级（'?'、空）不上色。
//
// 唯一的判档出口是 src/shared/rank-tone.ts 的 rankToneClass：四处都只认它给的类名，
// 颜色由主题里的 --rank-s … --rank-e 六个变量给（深浅两套跟着主题走）。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { buildSync } from 'esbuild'

import { battleOf, renderOutcomeBanner, renderResultStrip, sortieOf } from './fixtures/render-di-battle.mjs'
import { runtimeHost } from '../scripts/lib/player-view-runtime.mjs'

const require = createRequire(import.meta.url)
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8').replace(/\r\n/g, '\n')
const flat = (html) => html.replace(/\s+/g, ' ')

const toneModule = () => {
  const file = path.join(ROOT, 'dist', 'shared', 'rank-tone.js')
  assert.ok(fs.existsSync(file), '缺少 src/shared/rank-tone.ts（构建后在 dist/shared/rank-tone.js）')
  return require(file)
}

// ---- 判档 ----

test('rankToneClass：六个评级各一档，完全胜利跟 S，认不出的不给类名', () => {
  const { rankToneClass } = toneModule()
  assert.equal(rankToneClass('S'), 'rank-s')
  assert.equal(rankToneClass('A'), 'rank-a')
  assert.equal(rankToneClass('B'), 'rank-b')
  assert.equal(rankToneClass('C'), 'rank-c')
  assert.equal(rankToneClass('D'), 'rank-d')
  assert.equal(rankToneClass('E'), 'rank-e')
  assert.equal(rankToneClass('S（完全胜利）'), 'rank-s')
  assert.equal(rankToneClass('?'), '')
  assert.equal(rankToneClass(''), '')
  assert.equal(rankToneClass('—'), '')
  assert.equal(rankToneClass(null), '')
  assert.equal(rankToneClass(undefined), '')
})

// ---- 主题变量 ----

test('主窗口与复盘窗口都定义六个评级色变量，评级类名各取各的变量', () => {
  const index = read('src/renderer/index.html')
  const replay = read('src/renderer/battle-replay.html')
  const css = [index, replay, read('src/renderer/assets/battle-replay.css')].join('\n')
  for (const tone of ['s', 'a', 'b', 'c', 'd', 'e']) {
    assert.match(index, new RegExp(`--rank-${tone}\\s*:`), `index.html 缺 --rank-${tone}`)
    assert.match(replay, new RegExp(`--rank-${tone}\\s*:`), `battle-replay.html 缺 --rank-${tone}`)
    assert.match(css, new RegExp(`\\.rank-${tone}\\b[^{]*\\{[^}]*var\\(--rank-${tone}\\)`), `.rank-${tone} 没有取 var(--rank-${tone})`)
  }
})

// ---- 结算横幅 ----

const resultOf = (rank, patch = {}) => ({
  rank,
  mvp: -1,
  mvpCombined: -1,
  baseExp: 100,
  dropShipMstId: null,
  dropShipName: null,
  firstClear: false,
  ...patch,
})
const settled = (rank, battlePatch = {}) =>
  flat(renderOutcomeBanner(sortieOf({ battle: battleOf({ result: resultOf(rank), ...battlePatch }) })))

test('结算横幅：「A 胜确定」整段包在 rank-a 里，战斗类型与交战形态在外面', () => {
  const html = settled('A')
  const m = html.match(/<([a-z]+) class="([^"]*\brank-a\b[^"]*)">([^<]*)<\/\1>/)
  assert.ok(m, `横幅里没有 rank-a 的评级段：${html}`)
  assert.equal(m[3].trim(), 'A 胜确定')
  const before = html.slice(0, html.indexOf(m[0]))
  assert.match(before, /day/, '战斗类型应在评级段之前、段外')
})

test('结算横幅：S 完全胜利整段跟 S 色；败北走各自评级色；认不出的评级不上色', () => {
  const perfect = settled('S', { prediction: { ...battleOf().prediction, perfect: true } })
  // 维护者裁决 2026-11-25：完全胜利写「S 完全胜利」，不加括号、不再跟「胜确定」
  assert.match(perfect, /class="[^"]*\brank-s\b[^"]*">S 完全胜利</)
  assert.doesNotMatch(perfect, /（完全胜利）|完全胜利 胜确定/)
  assert.match(settled('D'), /class="[^"]*\brank-d\b[^"]*">D 败确定</)
  assert.match(settled('C'), /class="[^"]*\brank-c\b[^"]*">C 败确定</)
  const unknown = settled('?')
  assert.match(unknown, /\? 判定确定/)
  assert.doesNotMatch(unknown, /\brank-[a-e]\b/)
})

// ---- 结果条 ----

test('结果条：判定芯片的评级字母带评级色，预测时按预测评级', () => {
  const prediction = battleOf().prediction
  const judged = flat(renderResultStrip(battleOf({ result: resultOf('B'), prediction: { ...prediction, rank: 'B', perfect: false } })))
  assert.match(judged, /判定 <b class="[^"]*\brank\b[^"]*\brank-b\b[^"]*">B<\/b>|判定 <b class="[^"]*\brank-b\b[^"]*\brank\b[^"]*">B<\/b>/)
  // 预测与结算不同时芯片保留「预测→结算」修正记录（既有文字不动），箭头两端各按各的评级上色
  const corrected = flat(renderResultStrip(battleOf({ result: resultOf('B') })))
  assert.match(corrected, /判定 [\s\S]*class="[^"]*\brank-s\b[^"]*">S 完全胜利<\/b>→<b class="[^"]*\brank-b\b[^"]*">B<\/b>/)
  const predicted = flat(renderResultStrip(battleOf({ result: null })))
  assert.match(predicted, /预测 <b class="[^"]*\brank-s\b[^"]*">S/)
})

// ---- 海图节点 ----

const sliceBetween = (source, from, to, label) => {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `${label} 的源码锚点变了`)
  return source.slice(start, end)
}

test('海图节点：每个打过的点旁的评级小字母按评级上色', (t) => {
  const di = read('src/renderer/modules/di.ts')
  const trail = sliceBetween(di, 'const gaugePillOf = (', '\n// 敌联合的夜战交战对象', 'trailHtml')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-rank-trail-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const entry = path.join(dir, 'trail.ts')
  fs.writeFileSync(entry, `import { fcdTopologyUsable } from ${JSON.stringify(path.join(ROOT, 'src/shared/fcd-topology.ts'))}
import { bossLettersOf, reachableSpots, sortieBossTarget } from ${JSON.stringify(path.join(ROOT, 'src/shared/sortie-boss.ts'))}
import { rankToneClass } from ${JSON.stringify(path.join(ROOT, 'src/shared/rank-tone.ts'))}
const replay = { id: 1 }
const renderingEmbedded = true
const mg = { mapGauges: {} }
const formationPill = () => ''
const mapIdOf = (area: number, no: number) => area * 10 + no
const mapKeyOf = (sortie: any) => \`\${sortie.mapArea}-\${sortie.mapNo}\`
const cellLetter = (_sortie: any, cell: number) => String.fromCharCode(64 + cell)
const nodeEventName = () => '战斗'
const spotBranches = () => []
const routeTallyFor = () => new Map()
const branchTallyText = () => ''
const branchLabelOf = () => ''
let fcdMap: any = null
const sortieMapOpen = false
const esc = (value: unknown) => String(value)
void rankToneClass
${trail}
export const render = () => trailHtml({
  practice: false, mapArea: 1, mapNo: 4, startTs: 1000, updatedTs: 3000, currentCell: 4,
  bossCell: 0, active: false, battle: null,
  nodes: [
    { cell: 1, eventId: 4, eventKind: 0, rank: 'A' },
    { cell: 2, eventId: 4, eventKind: 0, rank: 'S' },
    { cell: 3, eventId: 4, eventKind: 0, rank: 'D' },
    { cell: 4, eventId: 4, eventKind: 0 },
  ],
} as any, { id: 1 }, [])
`)
  const output = path.join(dir, 'trail.cjs')
  buildSync({ entryPoints: [entry], outfile: output, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' })
  const html = flat(require(output).render())
  assert.match(html, /<span class="[^"]*\br\b[^"]*\brank-a\b[^"]*">A<\/span>|<span class="[^"]*\brank-a\b[^"]*\br\b[^"]*">A<\/span>/)
  assert.match(html, /class="[^"]*\brank-s\b[^"]*">S<\/span>/)
  assert.match(html, /class="[^"]*\brank-d\b[^"]*">D<\/span>/)
})

// ---- 史 ----

test('史的出击记录：评级标签按评级上色，不再只分胜 / 负两色', () => {
  const { rankToneClass } = toneModule()
  const host = runtimeHost()
  const { battleHistoryHtml } = host.extract('src/renderer/modules/shi.ts', ['battleHistoryHtml'], {
    fmtDateTime: String, fmtTime: String, fmtDate: () => '2026-11-25', reviewBattleId: null,
    elink: () => '', esc: String, rankToneClass,
    jstHourOf: () => 12,
  }).api
  const rows = [
    { id: 1, ts: Date.parse('2026-11-25T10:00:00+09:00'), practice: false, rank: 'A' },
    { id: 2, ts: Date.parse('2026-11-25T10:05:00+09:00'), practice: false, rank: 'B' },
    { id: 3, ts: Date.parse('2026-11-25T10:10:00+09:00'), practice: false, rank: 'E' },
  ]
  const html = flat(battleHistoryHtml(rows, () => '1-4', 'local'))
  assert.match(html, /class="shi-rank [^"]*\brank-a\b[^"]*">A</)
  assert.match(html, /class="shi-rank [^"]*\brank-b\b[^"]*">B</)
  assert.match(html, /class="shi-rank [^"]*\brank-e\b[^"]*">E</)
  assert.doesNotMatch(html, /shi-rank (?:win|loss)\b/)
})

// ---- 预测横幅与舰娘生涯（维护者裁决 2026-11-25 续） ----
// 结算前的预测横幅同样给评级段上色：普通战斗、航空战、只挨打的战斗（空袭 / 雷达）三种写法都算。
// 「（预估）」和后面的损失率留在色段外，和结算横幅一样只染评级那一段。
// 舰娘生涯窗口里每位舰娘击沉记录列表的评级标签也按评级上色，认不出的评级不上色。

const predicted = (battlePatch = {}) =>
  flat(renderOutcomeBanner(sortieOf({ battle: battleOf({ result: null, ...battlePatch }) })))

test('预测横幅：评级段按预测评级上色，「（预估）」在色段外', () => {
  const prediction = battleOf().prediction
  const perfect = predicted()
  assert.match(perfect, /预测 <span class="[^"]*\brank-s\b[^"]*">S 完全胜利<\/span>/, perfect)
  const guess = predicted({ prediction: { ...prediction, rank: 'B', perfect: false, sure: false } })
  assert.match(guess, /预测 <span class="[^"]*\brank-b\b[^"]*">B<\/span>（预估）/, guess)
  const lost = predicted({ prediction: { ...prediction, rank: 'D', perfect: false } })
  assert.match(lost, /预测 <span class="[^"]*\brank-d\b[^"]*">D<\/span>/, lost)
  const unknown = predicted({ prediction: { ...prediction, rank: '?', perfect: false } })
  assert.doesNotMatch(unknown, /\brank-[a-e]\b|\brank-s\b/, '认不出的评级不上色')
})

test('预测横幅：航空战与只挨打的战斗两种写法也给评级段上色', () => {
  const prediction = battleOf().prediction
  const air = predicted({ kind: 'airbattle', prediction: { ...prediction, rank: 'A', perfect: false } })
  assert.match(air, /航空战预测 <span class="[^"]*\brank-a\b[^"]*">A<\/span>/, air)
  const raid = predicted({ kind: 'airraid', prediction: { ...prediction, rank: 'C', perfect: false } })
  assert.match(raid, /预测 <span class="[^"]*\brank-c\b[^"]*">C<\/span>/, raid)
})

test('舰娘生涯击沉记录：评级标签按评级上色，认不出的不上色', () => {
  const host = runtimeHost()
  const { killBattleHtml } = host.extract('src/renderer/ship-life-window.ts', ['killBattleHtml'], {
    placeText: () => '1-4 Boss',
    esc: String,
    fmtDate: () => '11-25',
  }).api
  const row = (rank) => flat(killBattleHtml({ ts: 0, map: 14, cell: 5, rank, snapshotId: 1, bossMstId: 1 }))
  assert.match(row('A'), /<span class="rank [^"]*\brank-a\b[^"]*">A<\/span>|<span class="[^"]*\brank-a\b[^"]*\brank\b[^"]*">A<\/span>/)
  assert.match(row('S'), /class="[^"]*\brank-s\b[^"]*">S<\/span>/)
  assert.match(row('E'), /class="[^"]*\brank-e\b[^"]*">E<\/span>/)
  assert.doesNotMatch(row('?'), /\brank-[a-e]\b|\brank-s\b/)
})

test('舰娘生涯窗口定义六个评级色变量，评级类名各取各的变量', () => {
  const page = read('src/renderer/ship-life.html')
  for (const tone of ['s', 'a', 'b', 'c', 'd', 'e']) {
    assert.match(page, new RegExp(`--rank-${tone}\\s*:`), `ship-life.html 缺 --rank-${tone}`)
    assert.match(page, new RegExp(`\\.rank-${tone}\\b[^{]*\\{[^}]*var\\(--rank-${tone}\\)`), `ship-life.html 的 .rank-${tone} 没有取 var(--rank-${tone})`)
  }
})
