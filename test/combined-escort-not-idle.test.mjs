// 联合编成的第 2 舰队不是「空闲」（2026-08-27 用户报：联合出击中，顶栏把二队写成「空闲」）。
//
// 游戏里联合编成下第 2 舰队随第 1 舰队行动，不能单独派远征——所以她的
// `deck.mission` 恒为 [0,0,0,0]。凡是只看 mission 位推「无远征 = 空闲/可派」的地方
// 都会把她读错，而且**一处都不会报错**：界面只是安安静静地写着「空闲」，
// 甚至把她列进「这几支可以同时派出」。
//
// 这一组守四件事，全部对着真码的产物下断言（判定本体引真的 combinedEscortState）：
//   ① 联合 + 出击中 → 顶栏芯片写「出击中」，不是「空闲」
//   ② 联合 + 未出击 → 写「编队中」
//   ③ 未联合       → 一切照旧，仍是「空闲」
//   ④ 铉的空闲舰队清单把联合二队剔出去（出击与否都剔——她不可派）
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  FOUR_IDLE_FLEETS,
  chipClass,
  chipLabel,
  chipTitle,
  freeDeckIds,
  renderGantt,
  reset,
} from './fixtures/render-combined-escort.mjs'

const SORTIE = { active: true, practice: false, deckId: 1 }

// ---- ① 联合 + 出击中 ----

test('联合编成且出击中：顶栏第2舰队写「出击中」，不是「空闲」', () => {
  reset({ fleets: FOUR_IDLE_FLEETS, combinedFlag: 1, sortie: SORTIE })
  assert.equal(chipLabel(2), '出击中')
  assert.notEqual(chipLabel(2), '空闲', '这正是用户报的那两个字')
  assert.match(chipTitle(2), /随联合舰队出击中/)
  assert.match(chipTitle(2), /点击查看舰队/, '落点提示不许丢')
})

test('出击态复用远征「在外」那一枚，不新造颜色', () => {
  reset({ fleets: FOUR_IDLE_FLEETS, combinedFlag: 1, sortie: SORTIE })
  const cls = chipClass(2)
  assert.match(cls, /\bon\b/, '在外同款：.hs-chip.exp.on 的 --dock 边框')
  assert.match(cls, /\bcombined\b/, '要带 combined 标记，逐拍翻色那条路才认得出该跳过她')
  assert.doesNotMatch(cls, /\bback\b/, '她没有远征倒计时，不该沾「归来」')
})

test('联合出击中不看补给：人在海上，补给是回来以后的事（与远征在外同一优先级）', () => {
  reset({
    fleets: [{ id: 1 }, { id: 2, unsupplied: true }, { id: 3 }, { id: 4 }],
    combinedFlag: 1,
    sortie: SORTIE,
  })
  assert.equal(chipLabel(2), '出击中')
  assert.doesNotMatch(chipClass(2), /unsupplied/)
})

test('演习不是出击：联合编成下打演习，第2舰队仍是「编队中」', () => {
  reset({
    fleets: FOUR_IDLE_FLEETS,
    combinedFlag: 1,
    sortie: { active: true, practice: true, deckId: 1 },
  })
  assert.equal(chipLabel(2), '编队中')
})

test('出击的是别的队（联合已解编前的残留 deckId）不算联合出击', () => {
  reset({
    fleets: FOUR_IDLE_FLEETS,
    combinedFlag: 1,
    sortie: { active: true, practice: false, deckId: 3 },
  })
  assert.equal(chipLabel(2), '编队中', '联合出击恒由第1舰队具名，deckId 不是 1 就不是她在海上')
})

test('sortie.active 落下（返港）后不再是「出击中」', () => {
  reset({
    fleets: FOUR_IDLE_FLEETS,
    combinedFlag: 1,
    sortie: { active: false, practice: false, deckId: 1 },
  })
  assert.equal(chipLabel(2), '编队中')
})

// ---- ② 联合 + 未出击 ----

test('联合编成但没出击：顶栏第2舰队写「编队中」', () => {
  reset({ fleets: FOUR_IDLE_FLEETS, combinedFlag: 1 })
  assert.equal(chipLabel(2), '编队中')
  assert.notEqual(chipLabel(2), '空闲')
  assert.match(chipTitle(2), /已编入联合舰队/)
  assert.match(chipTitle(2), /点击查看舰队/)
})

test('编队中仍保留未补给警示：随队出击回来没补给照样要提示', () => {
  reset({
    fleets: [{ id: 1 }, { id: 2, unsupplied: true }, { id: 3 }, { id: 4 }],
    combinedFlag: 1,
  })
  assert.equal(chipLabel(2), '编队中', '状态词不被补给状况顶掉')
  assert.match(chipClass(2), /unsupplied/, '边框仍翻警示色')
  assert.match(chipTitle(2), /队内有舰未补给/)
  assert.match(chipTitle(2), /已编入联合舰队/, '两件事都要说，不许二选一')
})

test('三种联合编成（空母机动/水上打击/运输护卫）一视同仁', () => {
  for (const flag of [1, 2, 3]) {
    reset({ fleets: FOUR_IDLE_FLEETS, combinedFlag: flag })
    assert.equal(chipLabel(2), '编队中', `combinedFlag=${flag}`)
  }
})

// ---- ③ 未联合：一切照旧 ----

test('没有联合编成：第2舰队照旧是「空闲」', () => {
  reset({ fleets: FOUR_IDLE_FLEETS })
  assert.equal(chipLabel(2), '空闲')
  assert.doesNotMatch(chipClass(2), /combined/)
})

test('没有联合编成时，正在出击也不影响第2舰队的判定（她没跟着去）', () => {
  reset({ fleets: FOUR_IDLE_FLEETS, sortie: SORTIE })
  assert.equal(chipLabel(2), '空闲')
})

test('第3、4舰队不受联合影响：联合只由第1+第2舰队组成', () => {
  reset({ fleets: FOUR_IDLE_FLEETS, combinedFlag: 1, sortie: SORTIE })
  assert.equal(chipLabel(3), '空闲')
  assert.equal(chipLabel(4), '空闲')
  assert.doesNotMatch(chipClass(3), /combined/)
  assert.doesNotMatch(chipClass(4), /combined/)
})

test('远征分支原样保留：在远征的队仍走倒计时芯片，联合与否都不插手', () => {
  const returnAt = Date.now() + 3_600_000
  reset({
    fleets: [{ id: 1 }, { id: 2 }, { id: 3, mission: [1, 5, returnAt, 0] }, { id: 4 }],
    combinedFlag: 1,
    sortie: SORTIE,
  })
  assert.match(chipClass(3), /\bon\b/)
  assert.doesNotMatch(chipClass(3), /combined/)
})

// ---- ④ 铉：空闲舰队清单 ----

test('铉的空闲舰队清单剔除联合第2舰队：出击中不可派', () => {
  reset({ fleets: FOUR_IDLE_FLEETS, combinedFlag: 1, sortie: SORTIE })
  assert.deepEqual(freeDeckIds(), [3, 4], '第2舰队不该出现在「可派远征」的池子里')
})

test('铉的空闲舰队清单剔除联合第2舰队：编队中同样不可派', () => {
  reset({ fleets: FOUR_IDLE_FLEETS, combinedFlag: 1 })
  assert.deepEqual(freeDeckIds(), [3, 4], '编队中的她一样派不出去，出击与否都要剔')
})

test('没有联合编成时空闲清单照旧含第2舰队', () => {
  reset({ fleets: FOUR_IDLE_FLEETS })
  assert.deepEqual(freeDeckIds(), [2, 3, 4])
})

test('在远征的队本来就不在空闲清单里，这条没被改坏', () => {
  reset({
    fleets: [{ id: 1 }, { id: 2 }, { id: 3, mission: [1, 5, Date.now() + 1000, 0] }, { id: 4 }],
  })
  assert.deepEqual(freeDeckIds(), [2, 4])
})

// ---- ④' 铉的甘特条：同一条判定的另一处消费面 ----

test('铉的甘特条不把联合第2舰队写成「待命」', () => {
  reset({ fleets: FOUR_IDLE_FLEETS, combinedFlag: 1, sortie: SORTIE })
  const html = renderGantt()
  const row = /<div class="g-item"><span class="k">2舰<\/span>([\s\S]*?)<\/div>/.exec(html)
  assert.ok(row, `甘特条里找不到 2 舰那一行\n${html}`)
  assert.match(row[1], /出击中/)
  assert.doesNotMatch(row[1], /待命/, '这条甘特条正是用来一眼看「谁还能派」的')
})

test('铉的甘特条：联合未出击写「编队中」，未联合仍写「待命」', () => {
  reset({ fleets: FOUR_IDLE_FLEETS, combinedFlag: 1 })
  assert.match(renderGantt(), /<span class="k">2舰<\/span><span class="g-idle">编队中<\/span>/)
  reset({ fleets: FOUR_IDLE_FLEETS })
  assert.match(renderGantt(), /<span class="k">2舰<\/span><span class="g-idle">待命<\/span>/)
})
