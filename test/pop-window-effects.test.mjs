import assert from 'node:assert/strict'
import test from 'node:test'
import { makeMu } from './fixtures/mu-dom.mjs'
import { mountLgToast } from './fixtures/render-lg-toast.mjs'
import { crossWindowRuntime } from './fixtures/cross-window-runtime.mjs'
import { mountYu } from './fixtures/render-yu.mjs'
import { runtimeHost } from '../scripts/lib/player-view-runtime.mjs'

// 验收 1：真装配三份铃，广播同一份在途→返港状态，主窗只响/记/推一次。
test('主窗与两扇弹窗装配后，远征通知及托盘副作用只有一份', async () => {
  const scenes = [mountLgToast({ focus: false }), ...['qn', 'ru'].map((pop) => mountLgToast({ pop, focus: false }))]
  for (const scene of scenes) {
    scene.mg.master.ready = true
    scene.mg.master.missions = { 1: { name: '練習航海' } }
    scene.mg.kdocks = []
    scene.mount()
    scene.tick() // 真 onTick，先建立在途基线，不能绕过去直调 notify。
    scene.mg.decks = [{ id: 2, ships: [], mission: [1, 1, Date.now() - 1] }]
    scene.mgChange(['decks'])
    scene.tick()
    scene.tick()
  }
  await Promise.resolve()
  assert.deepEqual(scenes.map((scene) => scene.appendNoticeCalls().length), [1, 0, 0])
  assert.deepEqual(scenes.map((scene) => scene.invokeCalls().filter(([channel]) => channel === 'push:send').length), [1, 0, 0])
  assert.deepEqual(scenes.map((scene) => scene.sounds()), [1, 0, 0])
  assert.deepEqual(scenes.map((scene) => scene.systemNotices().length), [1, 0, 0])
  for (const pop of scenes.slice(1)) {
    assert.deepEqual(pop.trayUnreadCalls(), [], '弹窗装配不能以空记录清零托盘')
    assert.deepEqual(pop.trayDndCalls(), [], '弹窗不能覆盖托盘勿扰勾选')
  }
  scenes[0].trayToggleDnd()
  assert.equal(scenes[0].trayDndCalls().at(-1), true)
  scenes[0].accountChanged()
  for (const pop of scenes.slice(1)) pop.accountChanged()
  assert.deepEqual(scenes.map((scene) => scene.appendNoticeCalls().length), [2, 0, 0])
})

// 验收 4、5：真铆装配/弹出/收回/激活与重复闭窗事件。
test('弹出撤下主窗 active，收回激活并刷新一次；弹窗激活请求回主窗', () => {
  const mounts = [], shows = []
  const main = makeMu({}, { ids: ['ji', 'qn'], mounts, shows })
  main.activateModule('qn')
  const pane = mounts.find(([id]) => id === 'qn')[1]
  assert.equal(pane.classList.contains('active'), true)
  main.popModule('qn')
  assert.equal(pane.classList.contains('active'), false)
  assert.equal(pane.dataset.popped, 'true')
  const before = shows.length
  main.returnModule('qn')
  main.emit('window:pop-closed', 'qn')
  assert.equal(pane.classList.contains('active'), true)
  assert.equal(pane.dataset.popped, undefined)
  assert.equal(shows.length, before + 1)
  const popMounts = []
  const pop = makeMu({}, { search: '?pop=qn', ids: ['ji', 'qn'], mounts: popMounts })
  assert.equal(popMounts.find(([id]) => id === 'qn')[1].classList.contains('active'), true)
  pop.activateModule('ji')
  assert.deepEqual(pop.calls.at(-1), ['window:pop-relay', { to: 'main', kind: 'activate', payload: { id: 'ji' } }])
})

test('已弹出面板的被动任务与弹出前排队的任务不执行，收回后恢复', () => {
  const runtime = crossWindowRuntime(), renderer = runtime.renderer()
  const pane = { dataset: {}, contains: (target) => target === pane, isConnected: true, querySelectorAll: () => [] }
  let queries = 0
  renderer.documentHandlers.get('pointerdown')({ target: pane })
  renderer.kernel.deferPassive(pane, 'ledger', () => queries++)
  assert.equal(queries, 0)
  pane.dataset.popped = 'true'
  renderer.documentHandlers.get('pointerup')()
  renderer.fireTimers()
  renderer.kernel.deferPassive(pane, 'ledger', () => queries++)
  assert.equal(queries, 0)
  delete pane.dataset.popped
  renderer.kernel.deferPassive(pane, 'ledger', () => queries++)
  assert.equal(queries, 1)
})

test('钥真装配后，换号 IPC 只在主窗接线；弹窗不发换号提醒', () => {
  const main = mountYu()
  main.emit('yu:account-changed')
  assert.equal(globalThis.__accountNotices.length, 1)
  const pop = mountYu({ pop: 'qn' })
  pop.emit('yu:account-changed')
  pop.emit('yu:account-changed')
  assert.equal(globalThis.__accountNotices.length, 0)
  assert.equal(pop.pane.innerHTML, '')
})

test('真实资源被动刷新和编队反查在弹出期间不查询，收回后恢复', async () => {
  const pane = { dataset: { popped: 'true' }, classList: { contains: () => active } }
  let active = false, ledgerQueries = 0, fleetQueries = 0
  const { runPassiveRefresh } = runtimeHost().extract('src/renderer/modules/zi.ts', ['runPassiveRefresh'], {
    pane, refreshPending: false,
    refresh: () => ledgerQueries++, refreshSenkaCalendar: () => ledgerQueries++,
    refreshSenkaDetail: () => ledgerQueries++,
    scheduleDayRollover: () => {}, scheduleSenkaRollover: () => {},
  }).api
  const timers = []
  const { scheduleFleetQuestCheck } = runtimeHost().extract('src/renderer/modules/ru.ts', ['scheduleFleetQuestCheck'], {
    pane, fleetQuestTimer: null, fleetQuestGeneration: 0, fleetQuestCheck: null, fleetQuestFailed: false,
    queryFleetCheck: async () => { fleetQueries++; return {} }, render: () => {}, deferPassive: () => {},
    setTimeout: (cb) => { timers.push(cb); return timers.length }, clearTimeout: () => {},
  }).api
  runPassiveRefresh()
  scheduleFleetQuestCheck()
  timers.splice(0).forEach((cb) => cb())
  assert.deepEqual([ledgerQueries, fleetQueries], [0, 0])
  delete pane.dataset.popped
  active = true
  runPassiveRefresh()
  scheduleFleetQuestCheck()
  timers.splice(0).forEach((cb) => cb())
  await Promise.resolve()
  assert.deepEqual([ledgerQueries, fleetQueries], [1, 1])
})
