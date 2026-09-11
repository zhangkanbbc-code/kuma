import assert from 'node:assert/strict'
import test from 'node:test'
import { renderer } from './fixtures/render-return-clock.mjs'

const now = new Date(2026, 8, 11, 12, 0).getTime()
const setup = (t, returnTs = now + 60000, missions = { 105: { dispNo: '05', name: '海上護衛任務' } }) => {
  t.mock.method(Date, 'now', () => now)
  renderer.names.expedition = {}
  renderer.mg.master.missions = missions
  renderer.mg.decks = [{ id: 2, ships: [{ cond: 50 }], mission: [1, 105, returnTs, 0] }]
  renderer.notices.length = 0
  renderer.navigations.length = 0
  renderer.extras.expeditionEarly = false
}
const decode = (raw) => raw.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
const chipTitle = () => decode(/title="([^"]*)"/.exec(renderer.expeditionsHtml())[1])

test('远征标签：主数据编号保留前导零，缺主数据保留内部编号兜底', (t) => {
  setup(t)
  assert.equal(renderer.expeditionLabel(105, renderer.mg.master.missions), '05 海上護衛任務')
  assert.equal(renderer.expeditionLabel(999, renderer.mg.master.missions), '远征 999')
})

test('远征标签：显示 05、查包键 5，包键中文优先于 api id；A1 保留字母', (t) => {
  setup(t)
  renderer.names.expedition = {
    '5': { ja: '海上護衛任務', zh: '海上护卫任务' },
    '105': { ja: '错误原名', zh: '错误译名' },
    A1: { ja: '兵站強化任務', zh: '兵站强化任务' },
  }
  assert.equal(renderer.expeditionLabel(105, renderer.mg.master.missions), '05 海上护卫任务')
  assert.equal(renderer.expeditionLabel(201, { 201: { dispNo: 'A1', name: '兵站強化任務' } }), 'A1 兵站强化任务')
})

test('远征标签：包键无译名时按 api id 取中文，两键均无译名才用原名', (t) => {
  setup(t)
  renderer.names.expedition = { '105': { ja: '海上護衛任務', zh: '海上护卫任务' } }
  assert.equal(renderer.expeditionLabel(105, renderer.mg.master.missions), '05 海上护卫任务')
  renderer.names.expedition = {}
  assert.equal(renderer.expeditionLabel(105, renderer.mg.master.missions), '05 海上護衛任務')
})

for (const [key, dispNo, raw, zh] of [
  ['5', '05', '海上護衛任務', '海上护卫任务'],
  ['A1', 'A1', '兵站強化任務', '兵站强化任务'],
  ['105', '05', '海上護衛任務', '海上护卫任务'],
]) {
  test(`qn expeditionDisplayName：译名键 ${key} 输出中文并保留编号 ${dispNo}`, (t) => {
    setup(t, now + 60000, { 105: { dispNo, name: raw } })
    renderer.names.expedition = { [key]: { ja: raw, zh } }
    assert.equal(renderer.expeditionDisplayName(105), `${dispNo} ${zh}`)
  })

  test(`qn expeditionTogetherHtml：译名键 ${key} 的实际关联任务行显示中文`, (t) => {
    setup(t, now + 60000, { 105: { dispNo, name: raw } })
    renderer.names.expedition = { [key]: { ja: raw, zh } }
    renderer.lib.clear()
    renderer.lib.set(1, { id: 1, code: 'D1', name: '当前任务' })
    renderer.lib.set(2, { id: 2, code: 'D2', name: '关联任务' })
    renderer.setQuest({ trackers: {
      1: { tasks: [{ kind: 'expedition', missionId: 105, count: 1 }] },
      2: { tasks: [{ kind: 'expedition', missionId: 105, count: 3 }] },
    } })
    const html = renderer.expeditionTogetherHtml({ id: 1 })
    const row = /<div class="d-ent">(.*?)<\/div>/.exec(html)
    assert.ok(row, html)
    assert.equal(row[1], `<a data-kind="quest" data-id="2">关联任务</a> · <a data-kind="expedition" data-id="105">${dispNo} ${zh}</a> ×3`)
    assert.ok(!html.includes(raw), '译名已命中，不应回退日文')
  })
}

test('顶栏远征芯片：实际 title 同时带显示编号、名字与原返港时刻', (t) => {
  setup(t)
  renderer.names.expedition = { '5': { ja: '海上護衛任務', zh: '海上护卫任务' } }
  assert.equal(chipTitle(), '第2舰队 · 05 海上护卫任务 · 预计返港 12:01 · 点击查看舰队')
  renderer.mg.master.missions = {}
  assert.equal(chipTitle(), '第2舰队 · 远征 105 · 预计返港 12:01 · 点击查看舰队')
})

test('编队舰队卡：实际摘要与跳转菜单统一标签，跳转仍使用内部 id', (t) => {
  setup(t)
  renderer.names.expedition = { '5': { ja: '海上護衛任務', zh: '海上护卫任务' } }
  const route = renderer.routes.fleet
  assert.deepEqual(route.peek({ num: 2 }).lines, ['05 海上护卫任务 执行中 · 1分 后返港', '闪光 1/1'])
  const target = route.targets({ num: 2 })[1]
  assert.equal(target.label, '远征规划 · 05 海上护卫任务 执行中')
  target.run()
  assert.deepEqual(renderer.navigations, [{ type: 'expedition', id: 105 }])
  renderer.mg.master.missions = {}
  assert.equal(route.peek({ num: 2 }).lines[0], '远征 105 执行中 · 1分 后返港')
})

test('编队舰队卡：到点与超过返港时刻均保留即将返港文案', (t) => {
  setup(t, now)
  assert.equal(renderer.routes.fleet.peek({ num: 2 }).lines[0], '05 海上護衛任務 即将返港')
  renderer.mg.decks[0].mission[2] = now - 1
  assert.equal(renderer.routes.fleet.peek({ num: 2 }).lines[0], '05 海上護衛任務 即将返港')
})

test('远征页状态：甘特与紧凑悬停卡均输出编号和名字并转义', (t) => {
  setup(t, now + 60000, { 105: { dispNo: 'A1', name: '护卫 "甲" & <乙>' } })
  for (const html of [renderer.deckStatusHtml(renderer.mg.decks[0]), renderer.fleetStatusHtml(), renderer.renderCard(2)]) {
    assert.match(html, /<b class="g-exp-no">A1 护卫 &#34;甲&#34; &#38; &#60;乙&#62;<\/b>/)
  }
})

test('远征通知：返港及提前一分钟通知标题统一标签，保留舰队与时间提示', (t) => {
  setup(t, now)
  renderer.notifyExpeditions()
  assert.deepEqual(renderer.notices, [['expedition', '05 海上護衛任務 返港', '第2舰队 · 可再次派遣', { type: 'fleet', id: 2 }]])
  renderer.notices.length = 0
  renderer.extras.expeditionEarly = true
  renderer.mg.decks[0].mission[2] = now + 60000
  renderer.notifyExpeditions()
  assert.deepEqual(renderer.notices, [['expedition', '05 海上護衛任務 即将返港', '第2舰队 · 1 分钟内返回', { type: 'fleet', id: 2 }]])
})
