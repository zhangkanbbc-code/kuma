import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  beginSortie,
  feedBattleResult,
  finishSortie,
  lastSortieLevelUps,
  playerShips,
  reset as resetStore,
  sortie,
} from './fixtures/store-battle-result.mjs'
import {
  renderRow,
  reset as resetRow,
} from './fixtures/render-ru-row.mjs'

const TS = 1_700_000_006_000
const SHIP = { id: 102, shipId: 2, lv: 52, nowhp: 40, maxhp: 40 }
const NAMES = { 2: '鈴谷改二' }
const levelUpSortie = (at, patch = {}) => ({
  active: true,
  practice: false,
  escaped: [],
  levelUps: [{ rosterId: 102, from: 50, to: 52, at }],
  ...patch,
})

test('战果经验：主队跨一级、护卫队跨两级，未跨级舰不记', () => {
  resetStore({
    ships: [
      { id: 101, lv: 10 },
      { id: 102, lv: 20 },
      { id: 201, lv: 30 },
    ],
    battleShips: [
      { rosterId: 102, fleet: 'main', position: 1 },
      { rosterId: 101, fleet: 'main', position: 0 },
      { rosterId: 201, fleet: 'escort', position: 0 },
    ],
  })

  const sections = feedBattleResult({
    api_win_rank: 'S',
    api_get_ship_exp: [-1, 300, 400],
    api_get_exp_lvup: [
      [1_100, 1_150, 1_300],
      [2_100, 2_300],
    ],
    api_get_ship_exp_combined: [500],
    api_get_exp_lvup_combined: [
      [3_100, 3_150, 3_250, 3_500],
    ],
  }, TS)

  assert.ok(sections.includes('ships'))
  assert.equal(playerShips()[101].lv, 11)
  assert.equal(playerShips()[102].lv, 20)
  assert.equal(playerShips()[201].lv, 32)
  assert.deepEqual(sortie().levelUps, [
    { rosterId: 101, from: 10, to: 11, at: TS },
    { rosterId: 201, from: 30, to: 32, at: TS },
  ])
})

test('战果经验：同一出击两次升级累计为一条，起始等级不动', () => {
  resetStore({
    ships: [{ id: 102, lv: 1 }],
    battleShips: [{ rosterId: 102, fleet: 'main', position: 0 }],
  })

  feedBattleResult({
    api_win_rank: 'S',
    api_get_ship_exp: [100],
    api_get_exp_lvup: [[100, 150, 300]],
  }, TS)
  feedBattleResult({
    api_win_rank: 'S',
    api_get_ship_exp: [200],
    api_get_exp_lvup: [[300, 450, 700]],
  }, TS + 1_000)

  assert.equal(playerShips()[102].lv, 3)
  assert.deepEqual(sortie().levelUps, [
    { rosterId: 102, from: 1, to: 3, at: TS + 1_000 },
  ])
})

test('出击升级：返港连同 endedAt 留在内存，新出击清空', () => {
  resetStore({
    ships: [{ id: 102, lv: 1 }],
    battleShips: [{ rosterId: 102, fleet: 'main', position: 0 }],
  })
  feedBattleResult({
    api_win_rank: 'S',
    api_get_ship_exp: [100],
    api_get_exp_lvup: [[100, 150, 300]],
  }, TS)

  finishSortie(TS + 20_000)
  assert.deepEqual(lastSortieLevelUps(), {
    entries: [{ rosterId: 102, from: 1, to: 2, at: TS }],
    endedAt: TS + 20_000,
  })

  const next = beginSortie({ startTs: TS + 30_000 })
  assert.deepEqual(next.levelUps, [])
  assert.equal(lastSortieLevelUps(), null)
})

test('编成行：出击中一直显示 hold，且位置在经验值之后', (t) => {
  t.mock.method(Date, 'now', () => TS)
  resetRow({ sortie: levelUpSortie(TS - 60_000), names: NAMES })

  const html = renderRow({ ...SHIP, expNext: 12_345 })
  assert.match(
    html,
    /<em>· next 12,345<\/em> <em class="lvup hold" title="本次出击升级：50 → 52">↑50→52<\/em>/,
  )
  assert.doesNotMatch(html, /lvup hold" style=/)
  assert.match(
    renderRow({ ...SHIP, expNext: 0 }),
    /<span>Lv 52 <em class="lvup hold" title="本次出击升级：50 → 52">/,
  )
})

test('编成行：返港后从 endedAt 起续播淡出，位置在经验值之后', (t) => {
  t.mock.method(Date, 'now', () => TS)
  resetRow({
    sortie: { ...levelUpSortie(TS - 20_000), active: false },
    lastSortieLevelUps: {
      entries: [{ rosterId: 102, from: 50, to: 52, at: TS - 20_000 }],
      endedAt: TS - 1_234,
    },
    names: NAMES,
  })

  const html = renderRow({ ...SHIP, expNext: 12_345 })
  assert.match(
    html,
    /<em>· next 12,345<\/em> <em class="lvup" style="--lvup-elapsed:1234ms" title="本次出击升级：50 → 52">↑50→52<\/em>/,
  )
})

test('编成行：返港满六秒不再输出', (t) => {
  t.mock.method(Date, 'now', () => TS)
  resetRow({
    sortie: { ...levelUpSortie(TS - 20_000), active: false },
    lastSortieLevelUps: {
      entries: [{ rosterId: 102, from: 50, to: 52, at: TS - 20_000 }],
      endedAt: TS - 6_000,
    },
    names: NAMES,
  })

  assert.ok(!renderRow(SHIP).includes('class="lvup"'))
})

test('编成行：沙盘编成不显示升级标记', (t) => {
  t.mock.method(Date, 'now', () => TS)
  resetRow({ sortie: levelUpSortie(TS - 100), names: NAMES })

  assert.ok(!renderRow(SHIP, { deck: { id: -1 } }).includes('class="lvup"'))
})

test('编成行：碎裂与退避状态都不显示升级标记', (t) => {
  t.mock.method(Date, 'now', () => TS)
  resetRow({ sortie: levelUpSortie(TS - 100), names: NAMES, sunk: [102] })
  assert.ok(!renderRow(SHIP).includes('class="lvup"'))

  resetRow({
    sortie: levelUpSortie(TS - 100, {
      escaped: [{
        rosterId: 102,
        mstId: 2,
        name: '鈴谷改二',
        role: 'escaped',
        cell: 9,
        ts: TS - 200,
      }],
    }),
    names: NAMES,
  })
  assert.ok(!renderRow(SHIP).includes('class="lvup"'))
})

test('升级标记只用既有成功色，前 5.4 秒常亮、最后 0.6 秒淡出并收起盒子', () => {
  const html = fs.readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8')
  assert.match(
    html,
    /\.fleet-skin \.who > span em\.lvup \{[\s\S]*?display: inline-block;[\s\S]*?overflow: hidden;[\s\S]*?max-width: 6em;[\s\S]*?color: var\(--ok\);[\s\S]*?pointer-events: none;[\s\S]*?animation-delay: calc\(-1 \* var\(--lvup-elapsed, 0ms\)\);[\s\S]*?\}/,
  )
  assert.match(
    html,
    /\.fleet-skin \.who > span em\.lvup\.hold \{\s*animation: none; opacity: 1; max-width: 6em;\s*\}/,
  )
  const keyframes = html.match(/@keyframes ru-lvup-hint \{([\s\S]*?)\n    \}/)?.[1] ?? ''
  assert.match(keyframes, /0%, 90% \{ opacity: 1; max-width: 6em; \}/)
  assert.match(keyframes, /100% \{ opacity: 0; max-width: 0; margin: 0; padding: 0; \}/)
  assert.doesNotMatch(keyframes, /background|box-shadow|transform/)
})

test('出击升级临时态接在真实起止端点，写盘前不带记录', () => {
  const store = fs.readFileSync(new URL('../src/main/mg/store.ts', import.meta.url), 'utf8')
  const ledger = fs.readFileSync(new URL('../src/main/mg/ledger.ts', import.meta.url), 'utf8')
  assert.match(
    store,
    /'\/kcsapi\/api_req_map\/start':[\s\S]*?state\.sortie = beginSortie\(/,
  )
  assert.match(
    store,
    /'\/kcsapi\/api_port\/port':[\s\S]*?finishSortieLevelUps\(ts\)[\s\S]*?state\.sortie\.active = false/,
  )
  assert.match(store, /sortie:\s*state\.sortie\s*\?\s*\{ \.\.\.state\.sortie, levelUps: \[\] \}/)
  assert.match(ledger, /\{ \.\.\.sortie, active: false, levelUps: \[\] \}/)
})
