// 大破分档的两个下游：铃的通知（该不该再说一遍）与锐的出击中横幅（该不该说有风险）。
//
// 判定本体钉在 test/taiha-verdict.test.mjs，镝的警告条也在那份里。这一份钉的是
// **另外两处消费点**——同一条规则（联合二队旗舰受系统保护、旗舰大破没有进击选项）
// 原本各写各的，用户先后三次撞上：镝的红条、铃的重复通知、锐的风险句。
//
// 两段都直接跑真代码（fixtures 把整段切出来编译），不断言源码文本：
// 「去重键少了出击标识」「风险句接在 taiha 计数上而不是分档上」这两个错法
// 正则都拦不住——前者要连着跑几场才现形，后者写反了字面还是那几个字。
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  fShipsWithTaiha,
  resetSent,
  returnToPort,
  runDetect,
  sortieOf,
} from './fixtures/detect-taiha-notice.mjs'
import {
  renderVerdict,
  setLedger,
  shipOf,
  taihaTier,
} from './fixtures/render-ru-verdict.mjs'

// ---- 铃：protected 档整趟出击只说一次 ----
//
// 用户实报：联合二队旗舰大破后受轰沉保护可以继续进击，于是她留在大破名单里的
// **每一场战斗**都弹一次同样的通知。她的状态不随战斗变化，说一次就够。

/** 打一场：给这一趟出击推进到第 n 战，返回这一场新发出的通知。 */
const fightBattle = (battleCount, taihaIndexes, patch = {}) =>
  runDetect(
    sortieOf({
      battleCount,
      currentCell: battleCount,
      battle: { fShips: fShipsWithTaiha(taihaIndexes, patch.count ?? 12) },
      ...patch,
    }),
  )

test('同一出击内二队旗舰连续两场大破：protected 只发一次', () => {
  resetSent()
  returnToPort()
  const first = fightBattle(1, [6])
  assert.equal(first.length, 1)
  assert.match(first[0].title, /二队旗舰我舰7大破/)
  assert.match(first[0].detail, /她不会被击沉，可以继续进击/)
  // 第二场她还在大破名单里，但说的还是同一件事——不再发
  assert.deepEqual(fightBattle(2, [6]), [])
  // 第三、第四场同理，不是「只挡一次」
  assert.deepEqual(fightBattle(3, [6]), [])
  assert.deepEqual(fightBattle(4, [6]), [])
})

test('第二场新增危险舰：danger 照发，不被 protected 那道闸带走', () => {
  resetSent()
  returnToPort()
  assert.equal(fightBattle(1, [6]).length, 1) // protected
  const escalated = fightBattle(2, [2, 6])
  assert.equal(escalated.length, 1)
  assert.match(escalated[0].title, /我舰3大破 — 请撤退！/)
  // 二队旗舰受保护，不该被写进「可能被击沉」的名单
  assert.doesNotMatch(escalated[0].title, /我舰7/)
})

test('danger 档每场都发：那一档每场都有真实的进击/撤退决策', () => {
  resetSent()
  returnToPort()
  // 同一艘一队僚舰连着三场大破，三场都该出声——这不是噪音，是功能
  for (const battleCount of [1, 2, 3]) {
    const out = fightBattle(battleCount, [2])
    assert.equal(out.length, 1, `第 ${battleCount} 战该发 danger`)
    assert.match(out[0].title, /我舰3大破 — 请撤退！/)
  }
})

test('新出击（startTs 变了）：protected 重新可发', () => {
  resetSent()
  returnToPort()
  // 这一趟从第 2 战开始报，好把战次腾开：单场去重（taihaSeen）是另一层闸，
  // 新出击回到第 1 战时不该撞上这一趟已经用掉的战次键——这里要单独试的是
  // **出击标识**那一半，两层混在一起就分不清是谁挡的。
  assert.equal(fightBattle(2, [6]).length, 1)
  assert.deepEqual(fightBattle(3, [6]), [])
  // 下一趟出击：startTs 是另一个数，去重键跟着换，她该重新被提醒一次
  const nextSortie = runDetect(
    sortieOf({ startTs: 2000, battleCount: 1, battle: { fShips: fShipsWithTaiha([6]) } }),
  )
  assert.equal(nextSortie.length, 1)
  assert.match(nextSortie[0].title, /二队旗舰我舰7大破/)
})

test('回港把去重清干净：下一趟出击照常提醒', () => {
  resetSent()
  returnToPort()
  assert.equal(fightBattle(1, [6]).length, 1)
  assert.deepEqual(fightBattle(2, [6]), [])
  // 归港那一帧（active 落下）是真代码自己的清空路径
  returnToPort()
  // 连 startTs 都没换（同一个数）也该重新可发：清空靠的是归港，不是键碰巧变了
  assert.equal(fightBattle(1, [6]).length, 1)
})

test('去重按舰：换一艘二队旗舰（改编成后再出击）照样提醒一次', () => {
  resetSent()
  returnToPort()
  assert.equal(fightBattle(1, [6]).length, 1)
  // 同一趟出击里位 6 换了个人（rosterId 不同）——现实里改编成要回港，
  // 但键按舰而不是按舰位，这里钉的是「换了人就不算重复」这半边
  const swapped = fShipsWithTaiha([6])
  swapped[6] = { ...swapped[6], rosterId: 777, name: '另一艘' }
  const out = runDetect(sortieOf({ battleCount: 2, battle: { fShips: swapped } }))
  assert.equal(out.length, 1)
  assert.match(out[0].title, /二队旗舰另一艘大破/)
})

test('单舰队第七位大破不吃这道闸：非联合时她照常是 danger', () => {
  resetSent()
  returnToPort()
  // 7 舰遊撃部隊：全员 main，位 6 是自己那队的第七个人，每场都该照常喊
  const first = fightBattle(1, [6], { count: 7 })
  assert.equal(first.length, 1)
  assert.match(first[0].title, /我舰7大破 — 请撤退！/)
  assert.equal(fightBattle(2, [6], { count: 7 }).length, 1)
})

// ---- 锐：出击中横幅的风险句接分档 ----
//
// `· 大破进击有被击沉风险` 原来只看「有没有大破」。联合二队旗舰大破时她受保护，
// 这句在她身上是错的决策信息。大破**计数**照旧——她确实大破，维修视角的计数是对的。

const combinedFleets = (taihaIds = [], patch = {}) => ({
  1: [1, 2, 3, 4, 5, 6].map((id) => shipOf(id, taihaIds.includes(id) ? { nowhp: 5 } : {})),
  2: [7, 8, 9, 10, 11, 12].map((id) => shipOf(id, taihaIds.includes(id) ? { nowhp: 5 } : {})),
  ...patch,
})

test('联合出击中只有二队旗舰大破：有大破计数，没有风险句', () => {
  setLedger({ fleets: combinedFleets([7]), combinedFlag: 1 })
  const html = renderVerdict(1)
  assert.equal(taihaTier(1), 'protected')
  assert.match(html, /出击中 · 3-5/)
  // 计数照列：她确实大破，维修视角是对的
  assert.match(html, /大破 1 ⚠/)
  // 但她不会被击沉，这句在她身上是错的
  assert.doesNotMatch(html, /大破进击有被击沉风险/)
})

test('一队僚舰大破：风险句在', () => {
  setLedger({ fleets: combinedFleets([3]), combinedFlag: 1 })
  assert.equal(taihaTier(1), 'danger')
  const html = renderVerdict(1)
  assert.match(html, /大破 1 ⚠/)
  assert.match(html, /大破进击有被击沉风险/)
})

test('二队旗舰 + 一队僚舰同时大破：风险句照出（说的是那位僚舰）', () => {
  setLedger({ fleets: combinedFleets([3, 7]), combinedFlag: 1 })
  assert.equal(taihaTier(1), 'danger')
  const html = renderVerdict(1)
  assert.match(html, /大破 2 ⚠/)
  assert.match(html, /大破进击有被击沉风险/)
})

test('非联合旗舰大破且没带 damecon：强制返航档，也没有风险句', () => {
  // 游戏根本不给进击选项，「大破进击有风险」无从谈起
  setLedger({
    fleets: { 1: [1, 2, 3, 4, 5, 6].map((id) => shipOf(id, id === 1 ? { nowhp: 5 } : {})) },
    combinedFlag: 0,
  })
  assert.equal(taihaTier(1), 'forced')
  const html = renderVerdict(1)
  assert.match(html, /大破 1 ⚠/)
  assert.doesNotMatch(html, /大破进击有被击沉风险/)
})

test('旗舰带着女神：决定权回到玩家手里，风险句回来', () => {
  const flagship = shipOf(1, { nowhp: 5, slot: [900, -1, -1, -1] })
  setLedger({
    fleets: { 1: [flagship, ...[2, 3, 4, 5, 6].map((id) => shipOf(id))] },
    combinedFlag: 0,
    slotitems: { 900: { mstId: 43 } },
  })
  assert.equal(taihaTier(1), 'danger')
  assert.match(renderVerdict(1), /大破进击有被击沉风险/)
})

test('女神装在补强增设位上也算数', () => {
  const flagship = shipOf(1, { nowhp: 5, slotEx: 901 })
  setLedger({
    fleets: { 1: [flagship, ...[2, 3, 4, 5, 6].map((id) => shipOf(id))] },
    combinedFlag: 0,
    slotitems: { 901: { mstId: 42 } },
  })
  assert.equal(taihaTier(1), 'danger')
})

test('联合时看的是第 2 舰队的首位，不是按连号数出来的第 7 个人', () => {
  // 一队只有 4 个人（不满 6）：按「一队人数 + 位次」推连号的话二队旗舰会算到位 4，
  // 豁免整个落空。坐标按「哪一队的第几位」给，才不会随一队人数漂移。
  setLedger({
    fleets: {
      1: [1, 2, 3, 4].map((id) => shipOf(id)),
      2: [7, 8, 9, 10, 11, 12].map((id) => shipOf(id, id === 7 ? { nowhp: 5 } : {})),
    },
    combinedFlag: 1,
  })
  assert.equal(taihaTier(1), 'protected')
  assert.doesNotMatch(renderVerdict(1), /大破进击有被击沉风险/)
})

test('二队非旗舰大破：她没有保护，风险句照出', () => {
  setLedger({ fleets: combinedFleets([9]), combinedFlag: 1 })
  assert.equal(taihaTier(1), 'danger')
  assert.match(renderVerdict(1), /大破进击有被击沉风险/)
})

test('二队旗舰已退避：既有剔除不动，名单里没有她也就没有风险句', () => {
  setLedger({ fleets: combinedFleets([7]), combinedFlag: 1, escaped: [7] })
  assert.equal(taihaTier(1), null)
  const html = renderVerdict(1)
  assert.doesNotMatch(html, /大破 1 ⚠/)
  assert.doesNotMatch(html, /大破进击有被击沉风险/)
})

test('第 2 舰队自己的面板看到的是同一份合并判定', () => {
  // 联合时两队共用一份裁决（scopeShips 覆盖两队），风险句也该一致
  setLedger({ fleets: combinedFleets([7]), combinedFlag: 1 })
  assert.equal(taihaTier(2), 'protected')
  assert.doesNotMatch(renderVerdict(2), /大破进击有被击沉风险/)
})

test('没人大破时既无计数也无风险句', () => {
  setLedger({ fleets: combinedFleets(), combinedFlag: 1 })
  assert.equal(taihaTier(1), null)
  const html = renderVerdict(1)
  assert.match(html, /全员状态良好/)
  assert.doesNotMatch(html, /大破进击有被击沉风险/)
})
