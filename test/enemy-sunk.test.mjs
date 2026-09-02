import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

import battleModule from '../dist/main/mg/battle.js'
import enemySunkModule from '../dist/shared/enemy-sunk.js'

const { parseBattle } = battleModule
const { isEnemyReallySunk } = enemySunkModule

const battleFixture = JSON.parse(
  fs.readFileSync(new URL('./fixtures/battle-field-coverage.json', import.meta.url), 'utf8'),
).find((entry) => entry.name === 'sortie-battle-sub-air-raid')
assert.ok(battleFixture, 'fixture 里没有真实对潜空袭报文 #29731')

const fleetContext = {
  fleetShips: (deckId) =>
    Array.from({ length: 6 }, (_unused, index) => ({
      rosterId: deckId * 100 + index,
      mstId: deckId * 100 + index,
      name: `D${deckId}-${index + 1}`,
      lv: 1,
      nowHp: 50,
      maxHp: 50,
      equipments: [],
    })),
  masterName: (mstId) => `E${mstId}`,
  combinedType: () => 0,
}

const parsedSubAirRaid = () =>
  parseBattle(
    battleFixture.path,
    structuredClone(battleFixture.battle),
    fleetContext,
    Date.parse(battleFixture.source.ts),
  )

test('真实击沉只认 sunk，明确排除 unattackable', () => {
  assert.equal(isEnemyReallySunk({ sunk: true, unattackable: false }), true)
  assert.equal(isEnemyReallySunk({ sunk: true }), true)
  assert.equal(isEnemyReallySunk({ sunk: false, unattackable: false }), false)
  assert.equal(isEnemyReallySunk({ sunk: true, unattackable: true }), false)

  const battle = parsedSubAirRaid()
  assert.deepEqual(
    battle.eShips.map((ship) => isEnemyReallySunk(ship)),
    [true, true, true, false],
    '"N/A" 后方空母不能被 hpEnd=0 冒充成击沉',
  )
})

test('遭遇志 sunk_mask 与共享真实击沉判据同场一致', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-enemy-sunk-chronicle-'))
  const outfile = path.join(tempDir, 'chronicle.cjs')
  const require = createRequire(import.meta.url)
  globalThis.__enemySunkEncounter = null
  globalThis.__enemySunkState = {
    mapGauges: {},
    eventAreas: {},
    player: {
      combinedFlag: 0,
      decks: [],
      ships: {},
      slotitems: {},
      basic: null,
    },
    sortie: {
      active: false,
      practice: false,
      mapArea: 62,
      mapNo: 1,
      currentCell: 41,
      startTs: Date.parse(battleFixture.source.ts) - 60_000,
      battleCount: 1,
      deckId: 3,
      bossCell: -1,
      nodes: [{ cell: 41, eventId: 4 }],
      battle: parsedSubAirRaid(),
    },
  }
  try {
    await build({
      entryPoints: [fileURLToPath(new URL('../src/main/mg/chronicle.ts', import.meta.url))],
      outfile,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      logLevel: 'silent',
      plugins: [{
        name: 'enemy-sunk-chronicle-harness',
        setup(build) {
          const virtual = (filter, name) => build.onResolve(
            { filter },
            () => ({ path: name, namespace: 'enemy-sunk-chronicle-harness' }),
          )
          virtual(/^electron$/, 'electron')
          virtual(/^\.\/ledger$/, 'ledger')
          virtual(/^\.\/store$/, 'store')
          build.onLoad(
            { filter: /.*/, namespace: 'enemy-sunk-chronicle-harness' },
            ({ path: moduleName }) => ({
              contents: {
                electron: 'export const ipcMain = { handle: () => {} }',
                ledger: `
                  const noop = () => {}
                  export default new Proxy({}, {
                    get: (_target, key) => key === 'logEncounter'
                      ? (...args) => { globalThis.__enemySunkEncounter = args }
                      : noop
                  })
                `,
                store: 'export const getState = () => globalThis.__enemySunkState',
              }[moduleName],
              loader: 'js',
            }),
          )
        },
      }],
    })
    const { onChronicleApi } = require(outfile)
    onChronicleApi(
      '/kcsapi/api_req_sortie/battleresult',
      { api_win_rank: 'S' },
      {},
      Date.parse(battleFixture.source.ts),
    )
    assert.ok(globalThis.__enemySunkEncounter, '遭遇志没有落 logEncounter')
    assert.equal(globalThis.__enemySunkEncounter[8], 0b0111)
  } finally {
    delete globalThis.__enemySunkEncounter
    delete globalThis.__enemySunkState
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})
