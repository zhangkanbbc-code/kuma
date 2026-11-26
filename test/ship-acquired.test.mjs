import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import acquired from '../dist/shared/ship-acquired.js'

const { acquiredShipsOf } = acquired
const read = (file) => fs.readFileSync(new URL(file, import.meta.url), 'utf8')

// 2026-11-26 他选秃鹫当 2611B2 的奖励，新舰入库要等回港才响：任务奖励与战斗掉落只给图鉴号。
// 报文形状取自账本 13:03:16 那条 clearitemget（只留本测试用到的字段）。
test('任务奖励里的舰娘（api_type 11）与战斗掉落都认得出图鉴号，别的奖励不认', () => {
  const clear = {
    api_material: [0, 0, 0, 0],
    api_bounus_count: 2,
    api_bounus: [
      { api_type: 11, api_count: 1, api_item: { api_ship_id: 1053, api_name: 'Vautour' } },
      { api_type: 12, api_count: 2, api_item: { api_id: 129, api_name: '熟練見張員', api_slotitem_level: 5 } },
      { api_type: 1, api_count: 1, api_item: { api_id: 7, api_name: '' } },
    ],
  }
  assert.deepEqual(acquiredShipsOf('/kcsapi/api_req_quest/clearitemget', clear), [1053])
  assert.deepEqual(acquiredShipsOf('/kcsapi/api_req_quest/clearitemget', { api_bounus: [{ api_type: 1, api_count: 2, api_item: { api_id: 6 } }] }), [])
  assert.deepEqual(acquiredShipsOf('/kcsapi/api_req_quest/clearitemget', {}), [])
  for (const path of ['/kcsapi/api_req_sortie/battleresult', '/kcsapi/api_req_combined_battle/battleresult']) {
    assert.deepEqual(acquiredShipsOf(path, { api_get_ship: { api_ship_id: 637, api_ship_name: 'Fletcher' } }), [637])
    assert.deepEqual(acquiredShipsOf(path, { api_win_rank: 'S' }), [], '没掉落')
  }
  // 演习没有掉落；建造领取报文自带整艘舰，store 当场入账，不走这里
  assert.deepEqual(acquiredShipsOf('/kcsapi/api_req_practice/battle_result', { api_get_ship: { api_ship_id: 1 } }), [])
  assert.deepEqual(acquiredShipsOf('/kcsapi/api_req_kousyou/getship', { api_ship: { api_ship_id: 1 } }), [])
})

test('报文落地后主进程推 mg:ship-acquired，铃当场提醒，回港的老路照旧', () => {
  const main = read('../src/main/mg/index.ts')
  assert.match(main, /const acquiredShips = acquiredShipsOf\(apiPath, body\)\n\s*if \(acquiredShips\.length\) broadcastShipAcquired\(\{ ts, mstIds: acquiredShips \}\)/)
  assert.match(main, /webContents\.send\('mg:ship-acquired', cue\)/)
  const kernel = read('../src/renderer/kernel.ts')
  assert.match(kernel, /ipcRenderer\.on\('mg:ship-acquired', onShipAcquiredCue\)/)
  assert.match(kernel, /ipcRenderer\.removeListener\('mg:ship-acquired', onShipAcquiredCue\)/)
  const lg = read('../src/renderer/modules/lg.ts')
  assert.match(lg, /onShipAcquired\(detectAcquiredShips\)/)
  assert.match(lg, /const fresh = noteAcquiredShips\(cue\.mstIds, cue\.ts\)/)
  assert.match(lg, /const fresh = observeOwnedShips\(\)/)
})
