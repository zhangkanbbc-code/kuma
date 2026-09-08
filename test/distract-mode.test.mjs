import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
import mode from '../dist/shared/distract-mode.js'
import hotkeys from '../dist/shared/hotkeys.js'

const { DISTRACT_SIDES, DISTRACT_SIDE_LABEL, DISTRACT_PATHS, DISTRACT_DEFAULTS,
  DISTRACT_DEFAULT_SIZE, normalizeDistractSide, cycleDistractSide, fitBoundsToWorkArea } = mode
const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

test('分心默认值、配置路径与玩家侧名固定', () => {
  assert.deepEqual(DISTRACT_DEFAULTS, { side: 'bottom', alwaysOnTop: true })
  assert.deepEqual(DISTRACT_DEFAULT_SIZE, { width: 600, height: 780 })
  assert.deepEqual(DISTRACT_SIDE_LABEL, { top: '上', bottom: '下', left: '左', right: '右' })
  assert.deepEqual(DISTRACT_PATHS, {
    side: 'kuma.distract.side', alwaysOnTop: 'kuma.distract.alwaysOnTop', bounds: 'kuma.distract.bounds',
  })
})

test('侧位只接受四个约定值，未知值回到下', () => {
  for (const side of DISTRACT_SIDES) assert.equal(normalizeDistractSide(side), side)
  for (const raw of [null, undefined, '', 'TOP', '上', {}, 7]) assert.equal(normalizeDistractSide(raw), 'bottom')
})

test('侧位按上、下、左、右轮转并回到上', () => {
  assert.deepEqual(DISTRACT_SIDES.map(cycleDistractSide), ['bottom', 'left', 'right', 'top'])
})

const workArea = { x: -1000, y: 100, width: 1000, height: 900 }
const fallback = { x: -900, y: 180, ...DISTRACT_DEFAULT_SIZE }
for (const [side, bounds, expected] of [
  ['左', { x: -1200 }, { x: -1000 }], ['右', { x: -50 }, { x: -600 }],
  ['上', { y: -200 }, { y: 100 }], ['下', { y: 950 }, { y: 220 }],
]) {
  test(`窗口${side}越界夹回当前工作区`, () => {
    assert.deepEqual(fitBoundsToWorkArea(bounds, workArea, fallback), { ...fallback, ...expected })
  })
}
test('窗口缺省沿用当前位置和默认尺寸，超大尺寸缩到工作区', () => {
  assert.deepEqual(fitBoundsToWorkArea({}, workArea, fallback), fallback)
  assert.deepEqual(fitBoundsToWorkArea({ width: 3000, height: 2000 }, workArea, fallback), workArea)
  const inside = { x: -800, y: 200, width: 300, height: 400 }
  assert.deepEqual(fitBoundsToWorkArea(inside, workArea, fallback), inside)
})

test('F10 是可绑定且可匹配的应用快捷键', () => {
  const accelerator = hotkeys.parseAccelerator('F10')
  assert.equal(hotkeys.isAcceptableAccelerator(accelerator), true)
  assert.equal(hotkeys.matchesInput({ key: 'F10', control: false, alt: false, shift: false,
    meta: false, type: 'keyDown', isAutoRepeat: false }, accelerator), true)
})

// 沿 activate-module 夹具的 seam：从 mu 原样切函数编译，真实执行判据与进退，
// 只替换 Electron/DOM 外壳，避免复制一份看起来相同却与产品无关的逻辑。
const mu = read('src/renderer/mu.ts')
const slice = (start, end) => {
  const a = mu.indexOf(start), b = mu.indexOf(end, a)
  assert.ok(a >= 0 && b > a, `铆的测试锚点失效：${start}`)
  return mu.slice(a, b)
}
const showing = slice('const isShowing =', '// 搁置单个模块')
const lifecycle = slice('// ---- 分心模式：', '// ---- 激活 ----').replaceAll('export ', '')
const activating = slice('// 切到指定模块（链的跳转路由用）', '// 游戏打开远征页时').replaceAll('export ', '')
const saving = slice('const saveLayout =', '// 启动只在默认补齐')
const persistence = createRequire(import.meta.url)('../dist/shared/dock-layout.js')
const makeMu = (dock = 'right', shelved = false, hidden = false) => {
  const layout = { docks: { left: [], right: [], bottom: [] }, collapsed: { left: true, right: true, bottom: true },
    focus: true, shelved: shelved ? ['di'] : [], dockSize: { left: 400, right: 500, bottom: 300 } }
  layout.docks[dock] = [{ mods: ['di', 'du'], active: 'du', size: 230 }]
  const calls = [], writes = [], events = [], classes = new Set(), bodyClasses = new Set()
  const app = { dataset: {}, classList: { toggle: (key, on) => on ? classes.add(key) : classes.delete(key) } }
  const docks = Object.fromEntries(['left', 'right', 'bottom'].map((id) => [id, { dataset: {} }]))
  const env = {
    layout, distract: { on: false, side: 'bottom' }, distractRestore: null,
    scheduleDistractCardFit: (side) => calls.push(['fit', side]), stopDistractCardFit: () => calls.push(['fit-stop']),
    hiddenModules: new Set(hidden ? ['di'] : []), DISTRACT_PATHS, DISTRACT_DEFAULTS, normalizeDistractSide,
    distractConfig: { get: (_key, fallback) => fallback, set: (...args) => writes.push(args) },
    document: { querySelector: () => app, body: { classList: { toggle: (key, on) => on ? bodyClasses.add(key) : bodyClasses.delete(key) } } },
    window: { dispatchEvent: (event) => events.push(event.type) },
    locate: (id) => ['di', 'du'].includes(id) ? { dock, gi: 0 } : null,
    isOverlay: (id) => id === 'yu', overlayOpen: 'yu',
    dockEl: (id) => docks[id], layoutDock: () => {}, layoutAll: () => {}, refreshRail: () => {},
    showModule: (id) => calls.push(['show', id]), modules: [{ id: 'di' }, { id: 'du' }, { id: 'yu' }],
    ipcRenderer: { invoke: (...args) => { calls.push(args); return Promise.resolve() } },
    LAYOUT_KEY: 'layout.v3', missionTabRestore: null, layoutForPersist: persistence.layoutForPersist,
    uiSet: (...args) => writes.push(args),
  }
  const code = `const { ${Object.keys(env).filter((key) => key !== 'distractRestore').join(', ')} } = env;
    let distractRestore = null;
    const isShelved = (id) => layout.shelved.includes(id);
    const displayed = (id) => !hiddenModules.has(id) && !isShelved(id);
    ${showing}\n${lifecycle}\n${saving}\n${activating}
    return { isShowing, enterDistract, exitDistract, toggleDistract, setDistractSide, saveLayout, activateModule };`
  const compiled = transformSync(code, { loader: 'ts', target: 'node20' }).code
  return { ...new Function('env', compiled)(env), env, layout, calls, writes, classes, bodyClasses, docks, app, events }
}

test('分心可见性优先于专注、折叠和页签，其余模块含浮层一律不可见', () => {
  const m = makeMu()
  assert.equal(m.isShowing('di'), false)
  m.env.distract.on = true
  assert.equal(m.isShowing('di'), true)
  for (const id of ['du', 'yu', 'unknown']) assert.equal(m.isShowing(id), false)
  m.layout.shelved.push('di')
  assert.equal(m.isShowing('di'), false)
  m.layout.shelved = []
  m.env.hiddenModules.add('di')
  assert.equal(m.isShowing('di'), false)
})

test('普通布局仍由专注、折叠、激活页和浮层决定可见性', () => {
  const m = makeMu()
  assert.equal(m.isShowing('du'), false)
  m.layout.focus = false
  assert.equal(m.isShowing('du'), false)
  m.layout.collapsed.right = false
  assert.equal(m.isShowing('du'), true)
  assert.equal(m.isShowing('di'), false)
  assert.equal(m.isShowing('yu'), true)
})

for (const dock of ['left', 'right', 'bottom']) {
  test(`镝在${dock}坞：进入恢复、退出原位还原，临时状态不污染存档`, () => {
    const m = makeMu(dock, true, true)
    const before = structuredClone(m.layout)
    assert.equal(m.toggleDistract(), true)
    m.enterDistract() // 重复进入不能覆盖快照
    assert.equal(m.layout.docks[dock][0].active, 'di')
    assert.equal(m.isShowing('di'), true)
    assert.ok(m.classes.has('distract'))
    assert.ok(m.bodyClasses.has('kuma-distract'))
    assert.ok('distractCard' in m.docks[dock].dataset)
    assert.equal(m.layout.focus, true)
    m.activateModule('du', { auto: true })
    m.activateModule('yu')
    assert.equal(m.layout.docks[dock][0].active, 'di')
    m.saveLayout()
    assert.deepEqual(m.writes.at(-1), ['layout.v3', before])
    m.setDistractSide('left')
    assert.equal(m.app.dataset.distractSide, 'left')
    assert.deepEqual(m.writes.at(-1), [DISTRACT_PATHS.side, 'left'])
    assert.equal(m.toggleDistract(), false)
    assert.deepEqual(m.layout, before)
    assert.equal(m.env.hiddenModules.has('di'), true)
    assert.equal(m.classes.has('distract'), false)
    assert.equal(m.bodyClasses.has('kuma-distract'), false)
    assert.equal('distractCard' in m.docks[dock].dataset, false)
    assert.deepEqual(m.calls.filter(([id]) => id.startsWith('window:')), [
      ['window:distract-enter', { alwaysOnTop: true }], ['window:distract-exit'],
    ])
    assert.deepEqual(m.calls.filter(([id]) => id.startsWith('fit')), [
      ['fit', 'bottom'], ['fit', 'left'], ['fit-stop'],
    ])
  })
}

const makeWindow = (maximized = false, saved = {}) => {
  const handlers = new Map(), operations = [], store = { [DISTRACT_PATHS.bounds]: saved }
  let bounds = { x: -950, y: 150, width: 900, height: 800 }, top = false
  const normal = { ...bounds }
  const win = {
    getNormalBounds: () => ({ ...bounds }), getBounds: () => ({ ...bounds }), isMaximized: () => maximized,
    unmaximize: () => { maximized = false; operations.push('unmaximize') },
    maximize: () => { maximized = true; operations.push('maximize') },
    setBounds: (next) => { bounds = { ...next }; operations.push(['bounds', next]) },
    setAlwaysOnTop: (on) => { top = on; operations.push(['top', on]) },
  }
  const fakeRequire = (id) => id === 'electron' ? {
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    screen: { getDisplayMatching: () => ({ workArea }) },
  } : id === './config' ? { get: (key, fallback) => store[key] ?? fallback,
    set: (key, value) => { store[key] = value; operations.push(['save', key, value]) } } : mode
  const module = { exports: {} }
  new Function('require', 'module', 'exports', read('dist/main/distract-window.js'))(fakeRequire, module, module.exports)
  module.exports.installDistractWindow(() => win)
  return { win, normal, operations, store, exit: () => module.exports.exitDistractWindow(win),
    invoke: (id, arg) => handlers.get(`window:distract-${id}`)({}, arg),
    state: () => ({ bounds, maximized, top }) }
}

test('主进程进入小窗、置顶开关、退出存小窗再恢复最大化，重复进入不覆盖', () => {
  const w = makeWindow(true, { x: -800, y: 150, width: 550, height: 700 })
  w.invoke('enter', { alwaysOnTop: true })
  assert.deepEqual(w.state(), { bounds: { x: -800, y: 150, width: 550, height: 700 }, maximized: false, top: true })
  w.invoke('enter', { alwaysOnTop: false })
  w.invoke('always-on-top', false)
  assert.equal(w.state().top, false)
  assert.equal(w.store[DISTRACT_PATHS.alwaysOnTop], false)
  const small = { x: -750, y: 200, width: 500, height: 650 }
  w.win.setBounds(small)
  w.operations.length = 0
  w.invoke('exit')
  assert.deepEqual(w.operations[0], ['save', DISTRACT_PATHS.bounds, small])
  assert.deepEqual(w.state(), { bounds: w.normal, maximized: true, top: false })
  assert.equal(w.exit(), false)
})

test('主进程首次进入用600×780，关闭复用退出后两份边界各归各位', () => {
  const w = makeWindow()
  w.invoke('enter', { alwaysOnTop: false })
  assert.deepEqual(w.state().bounds, { x: -950, y: 150, width: 600, height: 780 })
  assert.equal(w.exit(), true)
  w.store['kuma.window'] = { ...w.win.getNormalBounds(), isMaximized: w.win.isMaximized() }
  assert.deepEqual(w.store[DISTRACT_PATHS.bounds], { x: -950, y: 150, width: 600, height: 780 })
  assert.deepEqual(w.store['kuma.window'], { ...w.normal, isMaximized: false })
})

// 本单禁止启动窗口；网格声明和 close 的接线无法在 Node 外壳里验证布局/原生事件，
// 所以这里只做最小源码守卫。进退行为与持久化顺序已由上面的真实函数执行覆盖。
test('源码接线：四侧网格与 display: contents 都在，关闭先退出再存常规窗口', () => {
  const html = read('src/renderer/index.html')
  for (const [side, areas] of [['top', "'card' 'game'"], ['bottom', "'game' 'card'"],
    ['left', "'card game'"], ['right', "'game card'"]]) {
    const rule = html.match(new RegExp(`#app\\.distract\\[data-distract-side='${side}'\\] #workbench \\{([^}]+)`))
    assert.ok(rule)
    assert.ok(rule[1].includes(`grid-template-areas: ${areas};`))
  }
  assert.match(html, /#app\.distract #wb-mid \{ display: contents; \}/)
  assert.match(read('src/main/index.ts'), /win\.on\('close', \(e\) => \{\s*if \(exitDistractWindow\(win\)\)[^\n]*\n\s*saveBounds\(\)/)
  const main = read('src/main/distract-window.ts')
  assert.match(main, /window:distract-exit'[\s\S]*?exitDistractWindow\(win\)/)
  assert.ok(main.indexOf('config.set(DISTRACT_PATHS.bounds') < main.indexOf('win.setBounds(prev.bounds)'))
})
