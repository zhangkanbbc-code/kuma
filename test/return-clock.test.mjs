import assert from 'node:assert/strict'
import test from 'node:test'
import returnClock from '../dist/shared/return-clock.js'
import { renderer } from './fixtures/render-return-clock.mjs'

const { fmtReturnClock } = returnClock
const local = (day, hour, minute, month = 9, year = 2026) =>
  new Date(year, month - 1, day, hour, minute).getTime()

for (const [label, returnTs, now, expected] of [
  ['同日只显示时分', local(7, 14, 20), local(7, 13, 0), '14:20'],
  ['跨日带月日', local(8, 2, 10), local(7, 13, 0), '09-08 02:10'],
  ['23:59 到 00:01 跨午夜', local(8, 0, 1), local(7, 23, 59), '09-08 00:01'],
  ['个位时分补零且不带秒', local(7, 3, 4) + 59000, local(7, 1, 0), '03:04'],
  ['过去的异日也带月日', local(7, 14, 20), local(8, 0, 1), '09-07 14:20'],
  ['跨年同月日仍是异日', local(7, 14, 20, 9, 2027), local(7, 13, 0), '09-07 14:20'],
]) {
  test(`fmtReturnClock：${label}`, () => assert.equal(fmtReturnClock(returnTs, now), expected))
}

const decode = (raw) => raw.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
const title = (html) => {
  const match = /title="([^"]*)"/.exec(html)
  assert.ok(match, html)
  return decode(match[1])
}
const setup = (t, now, returnTs, name = '海上护卫任务') => {
  t.mock.method(Date, 'now', () => now)
  renderer.mg.decks = [{ id: 2, mission: [1, 5, returnTs, 0], ships: [] }]
  renderer.mg.master.missions = { 5: { dispNo: '05', name } }
  renderer.setQuest({
    trackers: { 1: { tasks: [{ kind: 'expedition', missionId: 5, count: 3 }] } },
    progress: {}, serverFloors: {},
  })
}

for (const [state, now, returnTs, expected] of [
  ['away', local(7, 13, 0), local(7, 14, 20), '预计返港 14:20'],
  ['back', local(7, 14, 20), local(7, 14, 20), '已返港 14:20'],
  ['跨日 away', local(7, 13, 0), local(8, 2, 10), '预计返港 09-08 02:10'],
  ['跨日 back', local(8, 0, 1), local(7, 14, 20), '已返港 09-07 14:20'],
]) {
  test(`顶栏芯片 title 全文：${state}`, (t) => {
    setup(t, now, returnTs)
    const collect = now >= returnTs ? ' · 前往港口领取' : ''
    assert.equal(title(renderer.expeditionsHtml()), `第2舰队 · 05 海上护卫任务 · ${expected}${collect} · 点击查看舰队`)
  })

  test(`远征状态格、甘特条及紧凑悬停卡 title：${state}`, (t) => {
    setup(t, now, returnTs)
    for (const html of [renderer.deckStatusHtml(renderer.mg.decks[0]), renderer.fleetStatusHtml(), renderer.renderCard(2)]) {
      assert.match(html, /class="g-countdown"[^>]*data-cds=/)
      assert.equal(title(html), expected)
    }
  })

  test(`任务计数器远征行取最早返港时刻：${state}`, (t) => {
    setup(t, now, returnTs)
    // 较晚返港的队排在数组前面，排除直接拿第一队或最后一队的错误。
    renderer.mg.decks.unshift({ id: 3, mission: [1, 5, returnTs + 3600000, 0] })
    renderer.mg.decks.push({ id: 4, mission: [1, 5, returnTs + 7200000, 0] })
    const html = renderer.qpDetailHtml({ id: 1 })
    assert.match(html, new RegExp(`返港 <span data-cds="${returnTs}"`))
    assert.equal(title(html), expected)
  })
}

test('顶栏 tick 在到点同拍翻 title 与 class，保留转义名称并随午夜更新日期', (t) => {
  const returnTs = local(8, 0, 1)
  setup(t, local(7, 23, 59), returnTs, '护卫 "甲" & <乙>')
  const html = renderer.expeditionsHtml()
  assert.match(html, /护卫 &#34;甲&#34; &#38; &#60;乙&#62;/)
  const classes = new Set(['hs-chip', 'exp', 'on'])
  const chip = {
    title: title(html),
    classList: { toggle: (name, on) => on ? classes.add(name) : classes.delete(name) },
    querySelector: (selector) => {
      assert.equal(selector, '[data-cds]')
      return { dataset: { cds: String(returnTs) } }
    },
  }
  const root = { querySelectorAll: (selector) => {
    assert.equal(selector, '.hs-chip.exp.on:has([data-cds])')
    return [chip]
  } }
  for (const [now, expected, back] of [
    [local(7, 23, 59), '预计返港 09-08 00:01', false],
    [returnTs - 1, '预计返港 00:01', false],
    [returnTs, '已返港 00:01 · 前往港口领取', true],
    [returnTs + 1, '已返港 00:01 · 前往港口领取', true],
    [local(9, 0, 0), '已返港 09-08 00:01 · 前往港口领取', true],
  ]) {
    Date.now.mock.mockImplementation(() => now)
    renderer.syncExpeditionChipStates(root)
    assert.equal(classes.has('back'), back)
    assert.equal(chip.title, `第2舰队 · 05 护卫 "甲" & <乙> · ${expected} · 点击查看舰队`)
  }
})
