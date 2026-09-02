// 大破了要不要撤：三档判定的行为。
//
// 这一份**直接 import 真模块**（dist/shared/taiha-verdict.js），断言的是真代码的行为：
// 旗舰位判反、联合二队旗舰的剔除忘了由联合标志把门、damecon 例外的方向写反，
// 这里逐条都会红——正是源码正则拦不住的那一类。
//
// 机制出处逐条记在 src/shared/taiha-verdict.ts 的头注里（每条带来源与源数），
// 这里只钉行为。要改口径先去改那份头注，别只改这里的期望值。
import assert from 'node:assert/strict'
import test from 'node:test'

import verdict from '../dist/shared/taiha-verdict.js'
import { battleOf, renderAlertBanner, shipOf, sortieOf } from './fixtures/render-di-battle.mjs'

const { flagshipHasDameconIn, hasDameconEquipped, taihaVerdictOf } = verdict

const at = (index, name) => ({ index, name })

// 战斗视图里的一艘舰：判定只看 index / rosterId / equipment 三样。
const battleShip = (index, equipment) => ({ index, rosterId: 100 + index, equipment })

test('单舰队旗舰大破且没带 damecon：强制返航，同场其他大破舰照样列名', () => {
  const out = taihaVerdictOf([at(0, '长门'), at(3, '陆奥')], false, false)
  assert.equal(out.tier, 'forced')
  assert.equal(out.flagship, '长门')
  // 整队都要回家，所以其余大破舰也列出来——但她们不再有轰沉风险可言。
  assert.deepEqual([...out.others], ['陆奥'])
})

test('旗舰一个人大破时 forced 的 others 是空的，不凑数', () => {
  const out = taihaVerdictOf([at(0, '长门')], false, false)
  assert.equal(out.tier, 'forced')
  assert.equal(out.flagship, '长门')
  assert.deepEqual([...out.others], [])
})

test('旗舰带 damecon：决定权回到玩家手里，照常红档且旗舰在名单里', () => {
  const out = taihaVerdictOf([at(0, '长门'), at(3, '陆奥')], false, true)
  assert.equal(out.tier, 'danger')
  assert.deepEqual([...out.names], ['长门', '陆奥'])
})

test('联合二队旗舰大破 + 一队僚舰大破：危险名单只有僚舰', () => {
  const out = taihaVerdictOf([at(2, '足柄'), at(6, '阿武隈')], true, false)
  assert.equal(out.tier, 'danger')
  // 二队旗舰受系统保护不会轰沉，把她写进「继续前进可能被击沉」就是错的决策信息。
  assert.deepEqual([...out.names], ['足柄'])
})

test('只有联合二队旗舰大破：保护说明档，不是红色警告', () => {
  const out = taihaVerdictOf([at(6, '阿武隈')], true, false)
  assert.equal(out.tier, 'protected')
  assert.equal(out.escortFlagship, '阿武隈')
})

test('非联合时的位 6 是遊撃部隊的第七个人，照常算危险', () => {
  // 单队 7 舰没有第二队；剔除必须由联合标志把门，不能只看 index。
  const out = taihaVerdictOf([at(6, '雪风')], false, false)
  assert.equal(out.tier, 'danger')
  assert.deepEqual([...out.names], ['雪风'])
})

test('联合一队旗舰大破仍是强制返航，不因为编成是联合就放行', () => {
  const out = taihaVerdictOf([at(0, '大和'), at(6, '阿武隈')], true, false)
  assert.equal(out.tier, 'forced')
  assert.equal(out.flagship, '大和')
  assert.deepEqual([...out.others], ['阿武隈'])
})

test('非旗舰带 damecon 不豁免：照常进红档名单', () => {
  // 用户裁决口径：消耗女神本身就是要避免的大损失，红色警告成立。
  // 判定函数只认旗舰那一位，第三参数说的就是旗舰。
  const out = taihaVerdictOf([at(3, '陆奥')], false, false)
  assert.equal(out.tier, 'danger')
  assert.deepEqual([...out.names], ['陆奥'])
})

test('没有大破舰就没有任何一档', () => {
  assert.equal(taihaVerdictOf([], false, false), null)
  assert.equal(taihaVerdictOf([], true, true), null)
})

test('优先级 forced > danger > protected，三档互斥', () => {
  const all = [at(0, '大和'), at(2, '足柄'), at(6, '阿武隈')]
  assert.equal(taihaVerdictOf(all, true, false).tier, 'forced')
  assert.equal(taihaVerdictOf(all, true, true).tier, 'danger')
  assert.equal(taihaVerdictOf([at(6, '阿武隈')], true, true).tier, 'protected')
})

test('damecon 认 42 与 43，别的装备一律不算', () => {
  assert.equal(hasDameconEquipped([{ mstId: 42 }]), true)
  assert.equal(hasDameconEquipped([{ mstId: 43 }]), true)
  assert.equal(hasDameconEquipped([{ mstId: 41 }, { mstId: 44 }]), false)
  assert.equal(hasDameconEquipped([]), false)
  assert.equal(hasDameconEquipped(undefined), false)
  // 空槽在账本里查不到实例，落成 undefined，不该炸也不该算成带了
  assert.equal(hasDameconEquipped([undefined, null]), false)
})

test('旗舰 damecon 优先读战斗视图自带的装备快照', () => {
  const fShips = [
    battleShip(0, [{ mstId: 42, slot: 3 }]),
    battleShip(1, [{ mstId: 43, slot: 0 }]),
  ]
  assert.equal(flagshipHasDameconIn(fShips), true)
  // 只看旗舰那一位：僚舰带着女神不算旗舰带了
  assert.equal(flagshipHasDameconIn([battleShip(0, []), battleShip(1, [{ mstId: 43, slot: 0 }])]), false)
})

test('补强增设位上的女神算数', () => {
  // slotEx 在账本侧就已经并进同一份 equipments（store.ts 末尾 push），slot 记 'ex'。
  const fShips = [battleShip(0, [{ mstId: 12, slot: 0 }, { mstId: 43, slot: 'ex' }])]
  assert.equal(flagshipHasDameconIn(fShips), true)
})

test('旧战斗快照没有 equipment 时退回账本按在籍 id 现查（含 slotEx）', () => {
  const fShips = [{ index: 0, rosterId: 77, equipment: undefined }]
  const ledger = {
    ships: { 77: { slot: [11, -1, -1, -1], slotEx: 12 } },
    slotitems: { 11: { mstId: 5 }, 12: { mstId: 43 } },
  }
  assert.equal(flagshipHasDameconIn(fShips, ledger), true)
  // 账本里那两件都不是 damecon 时不能误判成带了
  assert.equal(
    flagshipHasDameconIn(fShips, {
      ships: { 77: { slot: [11, -1, -1, -1], slotEx: -1 } },
      slotitems: { 11: { mstId: 5 } },
    }),
    false,
  )
  // 没有账本可查、或旗舰不在账本里：查不到就是查不到，不猜
  assert.equal(flagshipHasDameconIn(fShips), false)
  assert.equal(flagshipHasDameconIn(fShips, { ships: {}, slotitems: {} }), false)
})

test('战斗视图里没有旗舰位时不炸也不误报', () => {
  // 旗舰退避后位 0 可能整个不在名单里（escaped 的舰不入大破名单，也不该被当成带了女神）
  assert.equal(flagshipHasDameconIn([battleShip(2, [{ mstId: 42, slot: 0 }])]), false)
  assert.equal(flagshipHasDameconIn([]), false)
})

// ---- 镝的警告条产物：分档有没有真接上 ----
//
// 上面钉的是判定本体，这里钉**渲染出来的那一条**。两者缺一不可：
// 判定对了但接线没换，玩家看到的还是原来那句「请选择撤退」。

/**
 * 把某几位打成大破（比例 ≤ 0.25），其余保持满血。
 *
 * 编队超过 7 位才算联合：battle.ts 按**段的 base** 定 fleet（主力段 base=0），
 * 所以单队 7 舰的遊撃部隊连第七位也是 main，不是 escort——
 * fixtures 里通用的 shipOf 一律按 index≥6 给 escort，这里得按真构造覆写。
 */
const battleWithTaiha = (indexes, count = 12) => {
  const combined = count > 7
  const fShips = Array.from({ length: count }, (_, i) => ({
    ...shipOf(i, `我舰${i + 1}`),
    fleet: combined && i >= 6 ? 'escort' : 'main',
    position: combined && i >= 6 ? i - 6 : i,
  }))
  for (const i of indexes) fShips[i] = { ...fShips[i], hpEnd: 5 } // 5/50 = 0.1
  return battleOf({ fShips })
}
const bannerFor = (indexes, count = 12, patch = {}) =>
  renderAlertBanner(sortieOf({ battle: battleWithTaiha(indexes, count), ...patch }))

test('单舰队旗舰大破：说强制返航，不再让人去点不存在的撤退', () => {
  const html = bannerFor([0], 6)
  assert.match(html, /旗舰我舰1大破 · 本战结束后强制返航/)
  assert.match(html, /无进击选项/)
  assert.match(html, /强制返航<\/span>/)
  // 游戏这时根本不给进击选项，红条那套劝退措辞在这儿是错的
  assert.doesNotMatch(html, /请选择撤退|建议撤退|继续前进可能被击沉/)
  assert.match(html, /verdict v-warn/)
})

test('旗舰大破且同场还有别人：其余大破舰照样列名', () => {
  const html = bannerFor([0, 3], 6)
  assert.match(html, /旗舰我舰1、我舰4 大破 · 本战结束后强制返航/)
})

test('只有联合二队旗舰大破：说她不会被击沉，不是红色警告', () => {
  const html = bannerFor([6])
  assert.match(html, /二队旗舰我舰7大破/)
  assert.match(html, /无击沉风险/)
  assert.match(html, /verdict v-warn/)
  assert.doesNotMatch(html, /请选择撤退|verdict v-red/)
})

test('联合二队旗舰 + 一队僚舰同时大破：红条只列僚舰', () => {
  const html = bannerFor([2, 6])
  assert.match(html, /verdict v-red/)
  assert.match(html, /我舰3 大破 · 击沉风险/)
  // 二队旗舰不会轰沉，把她写进「可能被击沉」就是错的决策信息
  assert.doesNotMatch(html, /我舰7/)
})

test('单舰队第七位大破照旧是红条：遊撃部隊没有第二队', () => {
  const html = bannerFor([6], 7)
  assert.match(html, /verdict v-red/)
  assert.match(html, /我舰7 大破 · 击沉风险/)
})

test('旗舰带女神时回到红条：这时真有得选', () => {
  const fShips = Array.from({ length: 6 }, (_, i) => shipOf(i, `我舰${i + 1}`))
  fShips[0] = { ...fShips[0], hpEnd: 5, equipment: [{ mstId: 43, slot: 'ex' }] }
  const html = renderAlertBanner(sortieOf({ battle: battleOf({ fShips }) }))
  assert.match(html, /verdict v-red/)
  assert.match(html, /我舰1 大破 · 击沉风险/)
  assert.doesNotMatch(html, /强制返航/)
})

test('Boss 战后一切降为战损陈述，分档不抢它的优先级', () => {
  const html = bannerFor([0], 6, { bossCell: 1, currentCell: 1 })
  assert.match(html, /Boss 战结束：我舰1 大破/)
  assert.match(html, /本节点无进击选项/)
  assert.doesNotMatch(html, /强制返航|请选择撤退/)
})

// ---- 红条上的第三个选项：报文自己提出的退避 ----

const offerOf = (escape, tow = []) => ({ rank: 'S', escapeOffer: { escape, tow, type: 1 } })
const dangerBannerWith = (result, count = 12) =>
  renderAlertBanner(sortieOf({ battle: { ...battleWithTaiha([2], count), result } }))

test('报文给了退避 offer：联合编成说护卫退避', () => {
  const html = dangerBannerWith(offerOf([2], [3]))
  assert.match(html, /继续前进可能被击沉 · 可下达护卫退避/)
  // 标题与角标不变，只有副行多说一句
  assert.match(html, /我舰3 大破 · 击沉风险/)
  assert.match(html, />撤退<\/span>/)
})

test('报文给了退避 offer：单舰队说单舰退避', () => {
  // 遊撃部隊没有第二队可派，只能単艦退避——种类按舰队形态判，不读语义未确认的 type
  assert.match(dangerBannerWith(offerOf([2]), 7), /继续前进可能被击沉 · 可下达单舰退避/)
})

test('offer 未就位或为空：副行维持原文案，不凭空多一句', () => {
  // battleresult 还没到（result 为 null）
  const pending = renderAlertBanner(sortieOf({ battle: battleWithTaiha([2]) }))
  assert.match(pending, /<span>继续前进可能被击沉<\/span>/)
  assert.doesNotMatch(pending, /可下达/)
  // 到了但没给 offer
  assert.doesNotMatch(dangerBannerWith({ rank: 'S' }), /可下达/)
  // 给了但名单是空的
  assert.doesNotMatch(dangerBannerWith(offerOf([])), /可下达/)
})

test('强制返航与二队旗舰两档不挂退避提示：那两档不是在问撤不撤', () => {
  const forced = renderAlertBanner(
    sortieOf({ battle: { ...battleWithTaiha([0], 7), result: offerOf([0]) } }),
  )
  assert.match(forced, /本战结束后强制返航/)
  assert.doesNotMatch(forced, /可下达/)
  const guarded = renderAlertBanner(
    sortieOf({ battle: { ...battleWithTaiha([6]), result: offerOf([6]) } }),
  )
  assert.match(guarded, /无击沉风险/)
  assert.doesNotMatch(guarded, /可下达/)
})

test('演习与基地防空不进警告条', () => {
  assert.equal(renderAlertBanner(sortieOf({ battle: battleWithTaiha([0], 6), practice: true })), '')
  const defense = battleWithTaiha([0], 6)
  assert.equal(renderAlertBanner(sortieOf({ battle: { ...defense, kind: 'baseDefense' } })), '')
})
