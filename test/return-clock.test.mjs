import assert from 'node:assert/strict'
import test from 'node:test'
import returnClock from '../dist/shared/return-clock.js'
import { renderer } from './fixtures/render-return-clock.mjs'

const { fmtReturnClock, repairClockText } = returnClock
const local = (day, hour, minute, month = 9, year = 2026) =>
  new Date(year, month - 1, day, hour, minute).getTime()

test('repairClockText：同日预计修好时刻', () => {
  assert.equal(repairClockText(local(15, 14, 20), local(15, 13, 0)), '预计 14:20 修好')
})

test('repairClockText：跨日预计修好时刻', () => {
  assert.equal(repairClockText(local(16, 2, 10), local(15, 13, 0)), '预计 09-16 02:10 修好')
})

test('repairClockText：到点同拍显示已修好', () => {
  const at = local(15, 14, 20)
  assert.equal(repairClockText(at, at - 1), '预计 14:20 修好')
  assert.equal(repairClockText(at, at), '已修好')
  assert.equal(repairClockText(at, at + 1), '已修好')
})

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

const setupRepair = (t, now, at) => {
  t.mock.method(Date, 'now', () => now)
  renderer.mg.ndocks = [{ id: 1, shipId: 101, completeTime: at }]
  renderer.mg.ships = { 101: { id: 101, shipId: 1, lv: 50, nowhp: 10, maxhp: 30, cond: 49 } }
  renderer.mg.master.ships = { 1: { name: '测试 "甲" & <乙>' } }
  renderer.mg.sortie = null
}

test('入渠抬头与展开浮层 tick 同拍更新 title，跨午夜重算日期且保留转义舰名', (t) => {
  const at = local(16, 0, 1)
  setupRepair(t, local(15, 23, 59), at)
  const html = renderer.docksHtml()
  assert.match(html, /测试 &#34;甲&#34; &#38; &#60;乙&#62;/)
  const initialTitle = decode(/title="([^"]*)"/.exec(html.slice(html.indexOf('data-timer=')))[1])
  assert.equal(initialTitle, '第1渠 · 测试 "甲" & <乙> · 预计 09-16 00:01 修好 · 点击查看舰娘')
  const makeRoot = () => {
    const countdown = { dataset: { cds: String(at) }, textContent: '' }
    const chip = { title: initialTitle, querySelector: () => countdown }
    return { chip, countdown, querySelectorAll: (selector) =>
      selector === '[data-cds]' ? [countdown] : selector === '.hs-chip.dock.on:has([data-cds])' ? [chip] : [] }
  }
  const main = makeRoot()
  const popover = makeRoot()
  for (const [now, expected, cd] of [
    [local(15, 23, 59), '预计 09-16 00:01 修好', '2分'],
    [at - 1, '预计 00:01 修好', '1分'],
    [at, '已修好', '完成'],
    [at + 1, '已修好', '完成'],
  ]) {
    Date.now.mock.mockImplementation(() => now)
    renderer.runHeaderTick(main, popover)
    for (const root of [main, popover]) {
      assert.equal(root.chip.title, `第1渠 · 测试 "甲" & <乙> · ${expected} · 点击查看舰娘`)
      assert.equal(root.countdown.textContent, cd)
    }
  }
})

test('入渠列表与舰娘预览显示同日、跨日、到点文案，不在渠里不加预览行', (t) => {
  const at = local(16, 2, 10)
  setupRepair(t, local(15, 23, 0), at)
  for (const [now, expected, cd] of [
    [local(15, 23, 0), '预计 09-16 02:10 修好', '3:10:00'],
    [local(16, 1, 0), '预计 02:10 修好', '1:10:00'],
    [at, '已修好', '完成'],
  ]) {
    Date.now.mock.mockImplementation(() => now)
    const sub = renderer.renderRepairSub(renderer.mg.ndocks[0]).replace(/<[^>]*>/g, '')
    assert.equal(sub, `入渠中 · 渠1 · ${cd} · ${expected}`)
    assert.equal(renderer.routes.ship.peek({ num: 101 }).lines.at(-1), `入渠中 · 渠1 · 剩余 ${cd} · ${expected}`)
  }
  renderer.mg.ndocks = []
  assert.equal(renderer.routes.ship.peek({ num: 101 }).lines.length, 3)
  assert.equal(renderer.renderRepairSub(null), '')
})

test('列表 tick 在到点和午夜原地更新修好时刻与筛选芯片悬停', (t) => {
  const at = local(16, 0, 1)
  setupRepair(t, local(15, 23, 59), at)
  const clock = { dataset: { repairClock: String(at) }, textContent: '' }
  const chip = { dataset: { repairTitle: String(at) }, title: '' }
  const pane = { isConnected: true, offsetWidth: 100, querySelectorAll: (selector) =>
    selector === '[data-repair-clock]' ? [clock] : selector === '[data-repair-title]' ? [chip] : [] }
  for (const [now, expected] of [[local(15, 23, 59), '预计 09-16 00:01 修好'], [at - 1, '预计 00:01 修好'], [at, '已修好']]) {
    Date.now.mock.mockImplementation(() => now)
    renderer.runQaTick(pane, now - 1000)
    assert.equal(clock.textContent, expected)
    assert.equal(chip.title, expected)
  }
})

test('编队最晚修好只取入渠舰，疲劳更晚仍保留全员就绪倒计时', (t) => {
  const at = local(16, 2, 10)
  setupRepair(t, local(15, 23, 0), at)
  renderer.mg.ndocks.push({ id: 2, shipId: 102, completeTime: at - 60000 })
  const html = renderer.renderRepairVerdict([{ id: 101 }, { id: 102 }, { id: 103, ready: at + 3600000 }])
  assert.match(html, /入渠中 2 · <span[^>]*>最晚 09-16 02:10 修好<\/span>/)
  assert.ok(html.includes(`data-ready-ts="${at + 3600000}"`))
  const label = { dataset: { repairLatest: String(at) }, textContent: '' }
  const chip = { dataset: { repairTitle: String(at) }, title: '' }
  const pane = { querySelectorAll: (selector) =>
    selector === '[data-repair-latest]' ? [label] : selector === '[data-repair-title]' ? [chip] : [] }
  for (const [now, expected, expectedTitle] of [
    [local(15, 23, 0), '最晚 09-16 02:10 修好', '预计 09-16 02:10 修好'],
    [at - 1, '最晚 02:10 修好', '预计 02:10 修好'],
    [at, '已修好', '已修好'],
  ]) {
    Date.now.mock.mockImplementation(() => now)
    renderer.runRuRepairTick(pane)
    assert.equal(label.textContent, expected)
    assert.equal(chip.title, expectedTitle)
  }
})
