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
  availableShipIds,
  chipClass,
  chipLabel,
  chipTitle,
  conditionCheckHtml,
  freeDeckIds,
  renderDeckStatus,
  renderGantt,
  reset,
  setBiCompact,
  statusPanelHtml,
  statusPanelWatches,
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

// ---- ④'' 紧凑态：状态移交悬停，判定本身一个字不改 ----

test('紧凑态默认关：不摆开关也没人动过它时，甘特条还是原来那条', () => {
  reset({ fleets: FOUR_IDLE_FLEETS, combinedFlag: 1, sortie: SORTIE })
  assert.match(renderGantt(), /<div class="g-item">/, '默认就该是常规排布，现状玩家零影响')
  assert.doesNotMatch(renderGantt(), /g-peek/)
})

test('紧凑态的甘特条只留队号，状态不常驻', () => {
  reset({ fleets: FOUR_IDLE_FLEETS, combinedFlag: 1, sortie: SORTIE })
  setBiCompact(true)
  const html = renderGantt()
  assert.match(html, /data-fleet-peek="2"[^>]*>2舰</, '队号还得在，不然没东西可悬停')
  assert.doesNotMatch(html, /出击中|待命|编队中/, '状态该移交悬停卡了')
  assert.doesNotMatch(html, /g-supply/, '补给记号同理')
})

test('紧凑态移交的是摆法不是判定：悬停卡里那句仍然分得清出击/编队/待命', () => {
  // 这条族的 bug 全长在判断上。摆法改了之后，同一条判定必须还在同一份产物里。
  reset({ fleets: FOUR_IDLE_FLEETS, combinedFlag: 1, sortie: SORTIE })
  setBiCompact(true)
  assert.match(renderDeckStatus(2), /出击中/)
  assert.doesNotMatch(renderDeckStatus(2), /待命/)
  reset({ fleets: FOUR_IDLE_FLEETS, combinedFlag: 1 })
  setBiCompact(true)
  assert.match(renderDeckStatus(2), /编队中/)
  reset({ fleets: FOUR_IDLE_FLEETS })
  setBiCompact(true)
  assert.match(renderDeckStatus(2), /待命/)
  // 常规态与紧凑态读的是同一份，两边永远说同一句话
  setBiCompact(false)
  assert.match(renderGantt(), new RegExp(renderDeckStatus(2).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})

// ---- ⑤ 非联合舰队自己出击 ----

test('非联合第3舰队自己出击：顶栏写「出击中」', () => {
  reset({
    fleets: FOUR_IDLE_FLEETS,
    sortie: { active: true, practice: false, deckId: 3 },
  })
  assert.equal(chipLabel(3), '出击中')
  assert.match(chipTitle(3), /出击中/)
  assert.match(chipTitle(3), /点击查看舰队/)
  assert.match(chipClass(3), /\bon\b/)
  assert.match(chipClass(3), /\bsortie\b/)
  assert.doesNotMatch(chipClass(3), /\bback\b/)
  assert.doesNotMatch(chipClass(3), /\bcombined\b/)
  assert.equal(chipLabel(2), '空闲')
  assert.equal(chipLabel(4), '空闲')
})

test('非联合第4舰队自己出击：只翻第4舰队', () => {
  reset({
    fleets: FOUR_IDLE_FLEETS,
    sortie: { active: true, practice: false, deckId: 4 },
  })
  assert.equal(chipLabel(4), '出击中')
  assert.equal(chipLabel(3), '空闲')
})

test('非联合第2舰队自己出击：同样写「出击中」且不进空闲清单', () => {
  reset({
    fleets: FOUR_IDLE_FLEETS,
    sortie: { active: true, practice: false, deckId: 2 },
  })
  assert.equal(chipLabel(2), '出击中')
  assert.deepEqual(freeDeckIds(), [3, 4])
})

test('出击舰队不进空闲清单，甘特条与紧凑态状态都写「出击中」', () => {
  reset({
    fleets: FOUR_IDLE_FLEETS,
    sortie: { active: true, practice: false, deckId: 3 },
  })
  assert.deepEqual(freeDeckIds(), [2, 4])
  const html = renderGantt()
  assert.match(html, /<span class="k">3舰<\/span><span class="g-idle">出击中<\/span>/)
  assert.match(html, /<span class="k">2舰<\/span><span class="g-idle">待命<\/span>/)
  assert.match(html, /<span class="k">4舰<\/span><span class="g-idle">待命<\/span>/)
  assert.match(renderDeckStatus(3), /出击中/)
})

test('远征规划不会拿正在海上的舰凑队', () => {
  reset({
    fleets: [
      { id: 1 },
      { id: 2 },
      { id: 3, ships: [301, 302] },
      { id: 4, ships: [401] },
    ],
    sortie: { active: true, practice: false, deckId: 3 },
    ships: { 301: {}, 302: {}, 401: {} },
  })
  assert.deepEqual(availableShipIds(), [401])
})

test('演习不算单队出击：第3舰队仍空闲且可派', () => {
  reset({
    fleets: FOUR_IDLE_FLEETS,
    sortie: { active: true, practice: true, deckId: 3 },
  })
  assert.equal(chipLabel(3), '空闲')
  assert.ok(freeDeckIds().includes(3))
})

test('sortie.active 落下后，非联合第3舰队恢复空闲', () => {
  reset({
    fleets: FOUR_IDLE_FLEETS,
    sortie: { active: false, practice: false, deckId: 3 },
  })
  assert.equal(chipLabel(3), '空闲')
  assert.ok(freeDeckIds().includes(3))
})

test('非联合舰队出击中不看补给：人在海上不挂未补给色', () => {
  reset({
    fleets: [{ id: 1 }, { id: 2 }, { id: 3, unsupplied: true }, { id: 4 }],
    sortie: { active: true, practice: false, deckId: 3 },
  })
  assert.equal(chipLabel(3), '出击中')
  assert.doesNotMatch(chipClass(3), /\bunsupplied\b/)
})

// ---- ⑥ 铉的条件检查尾句 ----

test('非联合第3舰队出击中：条件检查尾句写正在出击', () => {
  reset({
    fleets: FOUR_IDLE_FLEETS,
    sortie: { active: true, practice: false, deckId: 3 },
  })
  assert.match(conditionCheckHtml(3), /该舰队正在出击，返港后可用/)
  assert.doesNotMatch(conditionCheckHtml(3), /该舰队正在远征/)
})

test('联合随伴第2舰队出击中：条件检查尾句同样写正在出击', () => {
  reset({ fleets: FOUR_IDLE_FLEETS, combinedFlag: 1, sortie: SORTIE })
  assert.match(conditionCheckHtml(2), /该舰队正在出击，返港后可用/)
})

test('远征中的舰队：条件检查尾句保留正在远征', () => {
  reset({
    fleets: [{ id: 3, mission: [1, 5, Date.now() + 1000, 0] }],
  })
  assert.match(conditionCheckHtml(3), /该舰队正在远征，返港后可用/)
  assert.doesNotMatch(conditionCheckHtml(3), /该舰队正在出击/)
})

test('空闲舰队：条件检查结果没有在外尾句', () => {
  reset({ fleets: [{ id: 3 }] })
  const html = conditionCheckHtml(3)
  assert.doesNotMatch(html, /该舰队正在出击/)
  assert.doesNotMatch(html, /该舰队正在远征/)
})

// ---- ⑦ 铭的状态面板徽记 ----

test('非联合出击中的舰队：状态面板挂出击中徽记', () => {
  reset({
    fleets: [{ id: 3 }],
    sortie: { active: true, practice: false, deckId: 3 },
  })
  assert.match(statusPanelHtml(), /<span class="deck-badge">出击中<\/span>/)
  assert.doesNotMatch(statusPanelHtml(), /<span class="deck-badge">远征中<\/span>/)
})

test('联合随伴第2舰队：状态面板挂出击中徽记', () => {
  reset({ fleets: [{ id: 2 }], combinedFlag: 1, sortie: SORTIE })
  assert.match(statusPanelHtml(), /<span class="deck-badge">出击中<\/span>/)
})

test('远征中的舰队：状态面板保留远征中徽记', () => {
  reset({
    fleets: [{ id: 3, mission: [1, 5, Date.now() + 1000, 0] }],
  })
  assert.match(statusPanelHtml(), /<span class="deck-badge">远征中<\/span>/)
  assert.doesNotMatch(statusPanelHtml(), /<span class="deck-badge">出击中<\/span>/)
})

test('空闲舰队：状态面板不挂在外徽记', () => {
  reset({ fleets: [{ id: 3 }] })
  assert.doesNotMatch(statusPanelHtml(), /<span class="deck-badge">(?:出击|远征)中<\/span>/)
})

test('状态面板监听出击状态补丁，出海与返港会刷新徽记', () => {
  assert.equal(statusPanelWatches('sortie'), true)
})
