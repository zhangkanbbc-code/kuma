import assert from 'node:assert/strict'
import test from 'node:test'

import { mergeAirBases, replaceAirBases } from '../dist/main/mg/air-bases.js'
import { airBaseCustomName } from '../src/shared/air-base-name.ts'

const squad = (areaId, rid, distance, slotId = 0) => ({
  api_area_id: areaId,
  api_rid: rid,
  api_name: `第${rid}基地航空隊`,
  api_distance: distance,
  api_action_kind: rid === 1 ? 1 : 0,
  api_plane_info: [{
    api_slotid: slotId,
    api_count: slotId ? 18 : undefined,
    api_max_count: slotId ? 18 : undefined,
    api_state: slotId ? 1 : 0,
    api_cond: 0,
  }],
})

test('mapinfo air-base payload retains normal and event areas in one snapshot', () => {
  const ts = 1_785_866_523_226
  const rows = replaceAirBases([
    squad(6, 1, { api_base: 9, api_bonus: 0 }, 14852),
    squad(7, 1, { api_base: 0, api_bonus: 0 }),
    squad(62, 1, { api_base: 7, api_bonus: 2 }, 2905),
  ], ts)

  assert.deepEqual(rows.map((row) => row.areaId), [6, 7, 62])
  assert.equal(rows[0].distance, 9)
  assert.equal(rows[2].distance, 9)
  assert.equal(rows[0].planes[0].count, 18)
  assert.equal(rows[0].planes[0].cond, 0)
  assert.equal(rows.every((row) => row.ts === ts), true)
})

test('scoped air-base refresh preserves other areas and fills a missing area id', () => {
  const previous = replaceAirBases([
    squad(6, 1, 9, 100),
    squad(62, 1, 8, 200),
  ], 100)
  const incoming = squad(undefined, 1, { api_base: 7, api_bonus: 1 }, 300)
  const merged = mergeAirBases(previous, [incoming], 62, 200)

  assert.deepEqual(merged.map((row) => [row.areaId, row.rid]), [[6, 1], [62, 1]])
  assert.equal(merged.find((row) => row.areaId === 6)?.planes[0].slotId, 100)
  assert.equal(merged.find((row) => row.areaId === 62)?.planes[0].slotId, 300)
  assert.equal(merged.find((row) => row.areaId === 62)?.distance, 8)
})

// 2026-08-25 汉化清点：游戏默认发的中队名是日文「第N基地航空隊」，而锐/铎的抬头
// 左边刚写完中文（「第N航空队」/「第N中队」），右边紧跟这串日文。玩家自己起的名字
// 仍旧原样保留——那是 UGC，不翻译也不隐藏。
test('陆航中队名:游戏默认的日文名不上屏,玩家起的名字原样保留', () => {
  // 拿真的 replaceAirBases 出来的行，不是手搓对象——默认名长什么样由上游决定
  const rows = replaceAirBases([squad(6, 1, 9), squad(6, 2, 8)], 100)
  assert.equal(rows[0].name, '第1基地航空隊', '上游默认名变了，下面的判定要跟着改')
  for (const row of rows) {
    assert.equal(airBaseCustomName(row), null, `默认名「${row.name}」漏上屏了`)
  }

  // 玩家改过名的：一个字都不许动
  assert.equal(airBaseCustomName({ rid: 1, name: '第一機動部隊' }), '第一機動部隊')
  assert.equal(airBaseCustomName({ rid: 1, name: '我的航空队' }), '我的航空队')
  // 编号对不上就不是默认名（第2队起名叫「第1基地航空隊」是玩家干的）
  assert.equal(airBaseCustomName({ rid: 2, name: '第1基地航空隊' }), '第1基地航空隊')
  // 空名与空白名一律当没起过
  assert.equal(airBaseCustomName({ rid: 1, name: '' }), null)
  assert.equal(airBaseCustomName({ rid: 1, name: '   ' }), null)
})
