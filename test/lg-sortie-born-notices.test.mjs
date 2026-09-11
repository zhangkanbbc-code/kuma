// 真装配铃：内核补丁 → 探测 → notify → 假 DOM，验证送达时机与呈现档位。
import assert from 'node:assert/strict'
import test from 'node:test'

import { fShipsWithTaiha, sortieOf } from './fixtures/detect-taiha-notice.mjs'
import { mountLgToast } from './fixtures/render-lg-toast.mjs'

const insuredFleet = () => {
  const ships = fShipsWithTaiha([0], 6)
  ships[0].equipment = [{ mstId: 43, slot: 2 }]
  return ships
}

const startSortie = (lg, fShips, patch = {}) => {
  lg.mg.sortie = sortieOf({
    mapArea: 1,
    mapNo: 6,
    battleCount: 2,
    currentCell: 2,
    battle: { fShips },
    ...patch,
  })
  lg.mgChange(['sortie'])
}

const returnToPort = (lg) => {
  lg.mg.sortie.active = false
  lg.mgChange(['sortie'])
}

const assertNormalTaiha = (lg) => {
  assert.equal(lg.toasts().length, 1)
  assert.equal(lg.toast().dataset.event, 'taiha')
  assert.equal(lg.toast().dataset.locked, undefined, '说明档不应变成锁定级')
  assert.ok(lg.toast().classList.contains('warn'))
  assert.ok(!lg.toast().classList.contains('crit'), '说明档不应变成红警')
  assert.ok(lg.toast().querySelector('.ttl'), '说明档应保留自动关闭')
  assert.equal(lg.banners().length, 0, '说明档不应上横幅')
}

test('出击自身通知：带损管大破立即弹普通卡，归港不重复补发', () => {
  const lg = mountLgToast()
  lg.mount()
  startSortie(lg, insuredFleet())

  assertNormalTaiha(lg)
  assert.match(lg.toast().textContent, /带损管/)
  assert.match(lg.toast().textContent, /1-6 第 2 战/)
  lg.click(lg.toast())
  returnToPort(lg)
  assert.equal(lg.toasts().length, 0, '已当场送达的通知不应又进暂留')
})

test('出击自身通知：Boss 大破立即弹普通卡，呈现档位不变', () => {
  const lg = mountLgToast()
  lg.mount()
  startSortie(lg, fShipsWithTaiha([0], 6), { bossCell: 2 })

  assertNormalTaiha(lg)
})

test('出击自身通知：应急修理报文到达即弹卡，不等归港', () => {
  // 关闭横幅，用真实设置让应急修理走弹卡，直接检验 notify 的暂留分支。
  const lg = mountLgToast({ config: { 'kuma.eventBannerEffects': false } })
  lg.mount()
  const ships = fShipsWithTaiha([], 6)
  ships[0].repairItemUsed = 43
  startSortie(lg, ships)

  assert.equal(lg.toasts().length, 1)
  assert.equal(lg.toast().dataset.event, 'damecon')
  assert.match(lg.toast().textContent, /女神已消耗/)
  assert.equal(lg.banners().length, 0)
  lg.mgChange(['sortie'])
  assert.equal(lg.toast().dataset.stack, '1', '同一舰同一战不应重复通知')
})

test('出击勿扰对照：任务完成仍暂留，归港才送达', () => {
  const lg = mountLgToast()
  lg.mg.quests = { 101: { state: 2, title: '测试任务' } }
  lg.mount()
  startSortie(lg, fShipsWithTaiha([], 6))
  lg.mg.quests[101].state = 3
  lg.mgChange(['quests'])

  assert.deepEqual(lg.appendNoticeCalls().map((row) => row.event), ['quest'], '任务探测必须真发出通知')
  assert.equal(lg.toasts().length, 0, '非出击自身事件仍应暂留')
  assert.equal(lg.banners().length, 0)
  returnToPort(lg)
  assert.equal(lg.toasts().length, 1, '归港必须补发先前暂留的任务通知')
  assert.equal(lg.toast().dataset.event, 'quest')
  assert.match(lg.toast().textContent, /测试任务/)
})

for (const [mstId, hpStart, tier] of [[43, 39, '完好'], [42, 19, '中破']]) {
  test(`旗舰开战消耗 ${mstId}：当场仅一条通知，正文按 hpStart，无击沉保护宣告`, () => {
    const lg = mountLgToast({ config: { 'kuma.eventBannerEffects': false } })
    lg.mount()
    const ships = fShipsWithTaiha([], 6)
    Object.assign(ships[0], { hpMax: 39, hpStart, hpEnd: 20,
      repairItemUsedAtStart: mstId, repairItemInstanceAtStart: 9001 })
    startSortie(lg, ships)
    assert.equal(lg.toasts().length, 1)
    assert.equal(lg.toast().dataset.event, 'damecon')
    assert.ok(lg.toast().textContent.includes(`1-6 第 2 战开战时 · 旗舰大破进击消耗 · 耐久 ${hpStart}/39（${tier}）`))
    assert.doesNotMatch(lg.toast().textContent, /击沉保护已生效/)
    lg.mgChange(['sortie'])
    assert.equal(lg.toast().dataset.stack, '1')
    assert.equal(lg.appendNoticeCalls().filter(row => row.event === 'damecon').length, 1)
  })
}

test('开战与战斗中同类损管分别通知，下一战可再次报开战消耗', () => {
  const lg = mountLgToast({ config: { 'kuma.eventBannerEffects': false } })
  lg.mount()
  const ships = fShipsWithTaiha([], 6)
  Object.assign(ships[0], { repairItemUsedAtStart: 43, repairItemUsed: 43 })
  startSortie(lg, ships)
  assert.equal(lg.appendNoticeCalls().filter(row => row.event === 'damecon').length, 2)
  lg.mgChange(['sortie'])
  assert.equal(lg.appendNoticeCalls().filter(row => row.event === 'damecon').length, 2)
  ships[0].repairItemUsed = null
  startSortie(lg, ships, { battleCount: 3 })
  assert.equal(lg.appendNoticeCalls().filter(row => row.event === 'damecon').length, 3)
})

test('手动勿扰：带损管大破仍暂留，归港且关闭手动勿扰后送达', () => {
  const lg = mountLgToast()
  lg.mount()
  lg.trayToggleDnd()
  startSortie(lg, insuredFleet())

  assert.deepEqual(lg.appendNoticeCalls().map((row) => row.event), ['taiha'], '大破探测必须真发出通知')
  assert.equal(lg.toasts().length, 0, '出击自身事件不能绕过手动勿扰')
  assert.equal(lg.banners().length, 0)
  returnToPort(lg)
  assert.equal(lg.toasts().length, 0, '归港不能擅自解除手动勿扰')
  lg.trayToggleDnd()
  assertNormalTaiha(lg)
  assert.match(lg.toast().textContent, /带损管/)
})
