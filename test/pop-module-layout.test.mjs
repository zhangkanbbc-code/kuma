import assert from 'node:assert/strict'
import test from 'node:test'
import { makeMu } from './fixtures/mu-dom.mjs'
import pop from '../dist/shared/pop-module.js'

const { POP_OPEN_CHANNEL, POP_CLOSE_CHANNEL, POP_FOCUS_CHANNEL, POP_CLOSED_CHANNEL, POP_RELAY_CHANNEL, POP_RELAY_EVENT } = pop
const placed = (m, id) => Object.values(m.layout.docks).some((groups) => groups.some((g) => g.mods.includes(id)))
const tile = (m, id) => m.document.querySelector(`.element-tile[data-mod="${id}"]`)

test('弹出从三坞摘除、记原格与持久化、打开 IPC；默认收回原格并激活', () => {
  const m = makeMu()
  m.moveModule('ru', 'left', 0)
  const original = m.locate('ji')
  const group = m.layout.docks.left[0]
  m.popModule('ji')
  assert.deepEqual(m.layout.popped, ['ji'])
  assert.equal(placed(m, 'ji'), false)
  assert.deepEqual(m.layout.poppedFrom.ji, original)
  assert.deepEqual(m.store['layout.v3'].popped, ['ji'])
  assert.deepEqual(m.calls.at(-1), [POP_OPEN_CHANNEL, 'ji'])
  assert.equal(m.document.querySelector('.ws-pane.mod-ji'), null)
  assert.equal(m.isModuleShowing('ji'), false)
  m.returnModule('ji')
  assert.deepEqual(m.locate('ji'), original)
  assert.equal(m.layout.docks.left[0], group)
  assert.equal(group.active, 'ji')
  assert.deepEqual(m.layout.popped, [])
  assert.equal(m.layout.poppedFrom.ji, undefined)
  assert.deepEqual(m.calls.at(-1), [POP_CLOSE_CHANNEL, 'ji'])
})

test('原格被 splice 后即使旧序号已有别的格，收回仍在该坞新建一格', () => {
  const m = makeMu()
  m.moveModule('ru', 'left', 0)
  m.moveModule('zi', 'left', -1)
  m.popModule('ji')
  m.moveModule('ru', 'bottom', -1)
  assert.deepEqual(m.layout.docks.left.map((g) => g.mods), [['zi']])
  m.returnModule('ji')
  assert.deepEqual(m.layout.docks.left.map((g) => g.mods), [['zi'], ['ji']])
  assert.equal(m.layout.docks.left[1].active, 'ji')
})

test('未弹出的收回与重复关闭通知均幂等：零变化零调用零写盘', () => {
  const m = makeMu()
  for (const id of ['ji', 'unknown']) {
    const before = structuredClone(m.layout), calls = m.calls.length, writes = m.writes.length
    m.returnModule(id)
    assert.deepEqual(m.layout, before)
    assert.equal(m.calls.length, calls)
    assert.equal(m.writes.length, writes)
  }
  m.popModule('ji')
  m.emit(POP_CLOSED_CHANNEL, 'ji')
  const before = structuredClone(m.layout), count = m.calls.length
  m.emit(POP_CLOSED_CHANNEL, 'ji')
  assert.deepEqual(m.layout, before)
  assert.equal(m.calls.length, count)
})

test('读盘去重和过滤名单、剔除重复坞位，初始化重开且主窗 pane 无父节点', () => {
  const mounts = []
  const m = makeMu({ 'layout.v3': {
    popped: ['ji', 'ji', 'yu', 'unknown', 'du'], poppedFrom: { ji: { dock: 'left', gi: 0 } },
    docks: { left: [{ mods: ['ji', 'ru'], active: 'ji' }], right: [{ mods: ['ji', 'di'] }] },
  } }, { ids: ['ji', 'ru', 'di'], mounts })
  assert.deepEqual(m.layout.popped, ['ji'])
  assert.equal(placed(m, 'ji'), false)
  assert.equal(mounts.find(([id]) => id === 'ji')[1].parentNode, null)
  assert.deepEqual(m.calls, [[POP_OPEN_CHANNEL, 'ji']])
})

test('分心禁止弹出战斗；进入分心先收回已弹出的战斗', () => {
  const m = makeMu()
  m.popModule('di')
  m.enterDistract()
  assert.deepEqual(m.calls.slice(-2), [[POP_CLOSE_CHANNEL, 'di'], ['window:distract-enter', { alwaysOnTop: true }]])
  const before = structuredClone(m.layout), count = m.calls.length
  m.popModule('di')
  assert.deepEqual(m.layout, before)
  assert.equal(m.calls.length, count)
  assert.equal(m.isModuleShowing('di'), true)
})

test('已弹出模块的手动激活只聚焦；自动激活不发 IPC 且布局不动', () => {
  const m = makeMu()
  m.popModule('ji')
  const before = structuredClone(m.layout), writes = m.writes.length
  m.activateModule('ji')
  assert.deepEqual(m.calls.at(-1), [POP_FOCUS_CHANNEL, 'ji'])
  const count = m.calls.length
  m.activateModule('ji', { auto: true })
  assert.equal(m.calls.length, count)
  assert.deepEqual(m.layout, before)
  assert.equal(m.writes.length, writes)
})

test('隐藏已弹出模块先收回；无效、浮层、不可见模块不能弹出', () => {
  const m = makeMu()
  m.popModule('ji')
  m.setModuleVisible('ji', false)
  assert.deepEqual(m.layout.popped, [])
  assert.deepEqual(m.calls.at(-1), [POP_CLOSE_CHANNEL, 'ji'])
  assert.equal(tile(m, 'ji').hidden, true)
  const before = structuredClone(m.layout), count = m.calls.length
  for (const id of ['ji', 'yu', 'unknown']) m.popModule(id)
  assert.deepEqual(m.layout, before)
  assert.equal(m.calls.length, count)
})

test('导航条亮态、tooltip、单击聚焦、右键菜单收回和布局锁接线', () => {
  const m = makeMu()
  m.setLayoutLocked(true)
  const ji = tile(m, 'ji')
  ji.dispatch('contextmenu', { clientX: 200, clientY: 200 })
  let menu = m.document.querySelector('.cmenu')
  assert.ok(menu.innerHTML.includes('移动到'))
  menu.querySelector('[data-pop]').dispatch('click')
  assert.equal(ji.classList.contains('popped'), true)
  assert.equal(ji.title, '图鉴\n已弹出为窗口 · 单击切到那扇窗 · 右键收回')
  ji.dispatch('click')
  assert.deepEqual(m.calls.at(-1), [POP_FOCUS_CHANNEL, 'ji'])
  ji.dispatch('contextmenu', { clientX: 200, clientY: 200 })
  assert.ok(menu.innerHTML.includes('ji · 收回到'))
  assert.equal(menu.innerHTML.includes('当前'), false)
  assert.equal(menu.querySelector('[data-pop]'), null)
  menu.querySelector('[data-pop-focus]').dispatch('click')
  assert.deepEqual(m.calls.at(-1), [POP_FOCUS_CHANNEL, 'ji'])
  ji.dispatch('contextmenu', { clientX: 200, clientY: 200 })
  menu.querySelector('[data-dock="bottom"][data-gi="0"]').dispatch('click')
  assert.deepEqual(m.locate('ji'), { dock: 'bottom', gi: 0 })
  assert.equal(ji.classList.contains('popped'), false)
  assert.equal(ji.title, '图鉴\n单击切换显示 · 右键调整位置')
})

test('pop 装配全部可见模块、仅目标入文档；无坞导航浮层与游戏跟随，不写布局', () => {
  const mounts = [], shows = []
  const m = makeMu({ 'layout.v3': { docks: { left: [{ mods: ['ji'] }] } } }, {
    search: '?pop=ji', ids: ['ji', 'ru', 'di', 'qn', 'bi', 'yu', 'lg', 'shi', 'anchor'], mounts, shows,
  })
  assert.equal(m.getPopModule(), 'ji')
  assert.equal(m.getModuleTitle('ji'), 'ji')
  assert.equal(mounts.length, 8)
  for (const [id, pane] of mounts) {
    assert.equal(pane.parentNode?.id ?? null, id === 'ji' ? 'pop-host' : null)
    assert.equal(pane.classList.contains('active'), id === 'ji')
    assert.equal(m.isModuleShowing(id), id === 'ji')
  }
  assert.deepEqual(shows, ['ji'])
  assert.equal(m.document.querySelector('.element-tile'), null)
  assert.equal(m.document.querySelector('.dock-group'), null)
  assert.equal(m.document.querySelector('#overlay-host'), null)
  assert.deepEqual(m.scenes, [])
  const before = structuredClone(m.layout)
  m.saveLayout()
  m.enterDistract()
  m.exitDistract()
  m.toggleFocus()
  m.toggleLayoutLock()
  m.openOverlay('yu')
  m.closeOverlay()
  m.shelveModule('ji')
  m.moveModule('ji', 'right', 0)
  m.setModuleVisible('ji', false)
  m.followGameMissionScene()
  m.restoreGameMissionScene()
  m.popModule('ru')
  m.returnModule('ji')
  assert.equal(m.locate('ji'), null)
  assert.deepEqual(m.layout, before)
  assert.deepEqual(m.writes, [])
  assert.deepEqual(m.calls, [])
})

test('pop 的激活转给主窗含三个浮层；所有窗口只接 activate 字符串 id', () => {
  const m = makeMu({}, { search: '?pop=ji' })
  m.activateModule('ji')
  assert.deepEqual(m.calls, [])
  for (const id of ['ru', 'yu', 'lg', 'shi']) {
    m.activateModule(id)
    assert.deepEqual(m.calls.at(-1), [POP_RELAY_CHANNEL, { to: 'main', kind: 'activate', payload: { id } }])
  }
  const count = m.calls.length
  m.emit(POP_RELAY_EVENT, { kind: 'activate', payload: { id: 'ji' } })
  m.emit(POP_RELAY_EVENT, { kind: 'link', payload: { id: 'ru' } })
  m.emit(POP_RELAY_EVENT, { kind: 'activate', payload: { id: 1 } })
  assert.equal(m.calls.length, count)
  const main = makeMu()
  main.emit(POP_RELAY_EVENT, { kind: 'activate', payload: { id: 'bi' } })
  assert.equal(main.isModuleShowing('bi'), true)
})
