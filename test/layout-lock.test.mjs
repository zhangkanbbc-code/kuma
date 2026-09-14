import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { makeMu } from './fixtures/mu-dom.mjs'

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

test('默认不锁；初始化读取独立持久化键，开关返回新状态并同步类、按钮与标题', () => {
  const m = makeMu()
  assert.equal(m.isLayoutLocked(), false)
  assert.ok(m.reads.some(([key, fallback]) => key === 'layout.locked' && fallback === false))
  assert.equal(m.app.classList.contains('layout-locked'), false)
  assert.equal(m.writes.some(([key]) => key === 'layout.locked'), false)
  const before = structuredClone(m.layout)
  for (const on of [true, false]) {
    assert.equal(m.toggleLayoutLock(), on)
    assert.equal(m.isLayoutLocked(), on)
    assert.equal(m.app.classList.contains('layout-locked'), on)
    assert.equal(m.document.querySelector('#btn-layout-lock').classList.contains('on'), on)
    assert.deepEqual(m.writes.at(-1), ['layout.locked', on])
    for (const [dock, label] of [['left', '左坞'], ['right', '右坞'], ['bottom', '底坞']]) {
      assert.equal(m.split(dock).title, on ? '布局已锁定' : `拖动调整${label} · 双击折叠`)
    }
    assert.equal(m.groupSplit().title, on ? '布局已锁定' : '拖动调整两格比例')
    assert.deepEqual(m.layout, before)
  }
})

test('重启恢复锁定；锁定期间重铺格间分隔条仍显示锁定提示', () => {
  const m = makeMu({ 'layout.locked': true })
  assert.equal(m.isLayoutLocked(), true)
  assert.equal(m.app.classList.contains('layout-locked'), true)
  const previous = m.groupSplit()
  m.layoutDock('bottom')
  assert.notEqual(m.groupSplit(), previous)
  assert.equal(m.groupSplit().title, '布局已锁定')
  m.setLayoutLocked(false)
  assert.equal(makeMu(m.store).isLayoutLocked(), false)
})

for (const dock of ['left', 'right', 'bottom']) {
  test(`${dock} 坞：锁定后按下、移动、松手均不拖动，解锁后恢复改尺寸与遮罩`, () => {
    const m = makeMu()
    m.setLayoutLocked(true)
    const before = structuredClone(m.layout), count = m.writes.length
    m.split(dock).dispatch('mousedown')
    m.move()
    assert.equal(m.document.querySelector('#drag-overlay'), null)
    m.up()
    assert.deepEqual(m.layout, before)
    assert.deepEqual(m.drags, [])
    assert.equal(m.writes.length, count)
    m.setLayoutLocked(false)
    m.split(dock).dispatch('mousedown')
    assert.equal(m.document.querySelector('#drag-overlay'), null)
    m.move()
    assert.ok(m.document.querySelector('#drag-overlay'))
    assert.notEqual(m.layout.dockSize[dock], before.dockSize[dock])
    m.up()
    assert.equal(m.document.querySelector('#drag-overlay'), null)
    assert.deepEqual(m.drags, ['start', 'end'])
  })

  test(`${dock} 坞：锁定挡住双击折叠与展开，解锁后三者入口恢复`, () => {
    const m = makeMu()
    m.setLayoutLocked(true)
    m.split(dock).dispatch('dblclick')
    assert.equal(m.layout.collapsed[dock], false)
    m.setLayoutLocked(false)
    m.split(dock).dispatch('dblclick')
    assert.equal(m.layout.collapsed[dock], true)
    m.setLayoutLocked(true)
    m.split(dock).dispatch('dblclick')
    m.split(dock).dispatch('mousedown')
    m.move()
    m.up()
    assert.equal(m.layout.collapsed[dock], true)
    assert.deepEqual(m.drags, [])
    m.setLayoutLocked(false)
    m.split(dock).dispatch('dblclick')
    assert.equal(m.layout.collapsed[dock], false)
  })
}

test('锁定时点击三坞的 × 不折叠、不改布局与持久化', () => {
  const m = makeMu({ 'layout.locked': true })
  const before = structuredClone(m.layout), count = m.writes.length
  for (const dock of ['left', 'right', 'bottom']) {
    m.fold(dock).dispatch('click')
    assert.equal(m.layout.collapsed[dock], false)
    assert.equal(m.stub(dock).closest('.dock').classList.contains('collapsed'), false)
  }
  assert.deepEqual(m.layout, before)
  assert.equal(m.writes.length, count)
})

test('锁定时点击三坞的折叠把手不展开、不改布局与持久化', () => {
  const m = makeMu()
  for (const dock of ['left', 'right', 'bottom']) m.fold(dock).dispatch('click')
  m.setLayoutLocked(true)
  const before = structuredClone(m.layout), count = m.writes.length
  for (const dock of ['left', 'right', 'bottom']) {
    assert.equal(m.layout.collapsed[dock], true)
    m.stub(dock).dispatch('click')
    assert.equal(m.layout.collapsed[dock], true)
    assert.equal(m.stub(dock).closest('.dock').classList.contains('collapsed'), true)
  }
  assert.deepEqual(m.layout, before)
  assert.equal(m.writes.length, count)
})

test('解锁后 × 折叠与把手展开均恢复，布局尺寸与格比例保持', () => {
  const m = makeMu({ 'layout.locked': true })
  const before = structuredClone(m.layout)
  m.setLayoutLocked(false)
  for (const dock of ['left', 'right', 'bottom']) {
    m.fold(dock).dispatch('click')
    assert.equal(m.layout.collapsed[dock], true)
    assert.equal(m.stub(dock).closest('.dock').classList.contains('collapsed'), true)
    assert.equal(m.store['layout.v3'].collapsed[dock], true)
    m.stub(dock).dispatch('click')
    assert.equal(m.layout.collapsed[dock], false)
    assert.equal(m.stub(dock).closest('.dock').classList.contains('collapsed'), false)
    assert.equal(m.store['layout.v3'].collapsed[dock], false)
  }
  assert.deepEqual(m.layout, before)
})

test('折叠钮与把手 title 随锁定同步，初始化与锁定期间重铺也保留正确提示', () => {
  const m = makeMu({ 'layout.locked': true })
  const checkTitles = (locked) => {
    for (const [dock, label] of [['left', '左坞·查阅'], ['right', '右坞·临战'], ['bottom', '底坞·常驻']]) {
      assert.equal(m.fold(dock).title, locked ? '布局已锁定' : '折叠此坞（导航条点元素可再展开）')
      assert.equal(m.stub(dock).title, locked ? '布局已锁定' : `展开${label}`)
    }
  }
  checkTitles(true)
  for (const dock of ['left', 'right', 'bottom']) {
    const previous = m.fold(dock)
    m.layoutDock(dock)
    assert.notEqual(m.fold(dock), previous)
  }
  checkTitles(true)
  for (const locked of [false, true, false]) {
    m.setLayoutLocked(locked)
    checkTitles(locked)
  }
})

test('格间按下：锁定不创建遮罩、不改 size；解锁后恢复两格比例拖动', () => {
  const m = makeMu()
  const before = structuredClone(m.layout.docks.bottom)
  m.setLayoutLocked(true)
  m.groupSplit().dispatch('mousedown')
  m.move()
  assert.equal(m.document.querySelector('#drag-overlay'), null)
  m.up()
  assert.deepEqual(m.layout.docks.bottom, before)
  assert.deepEqual(m.drags, [])
  m.setLayoutLocked(false)
  m.groupSplit().dispatch('mousedown')
  m.move()
  assert.ok(m.document.querySelector('#drag-overlay'))
  m.up()
  assert.equal(m.layout.docks.bottom[0].size, 650)
  assert.deepEqual(m.drags, ['start', 'end'])
})

test('样式与快捷键接线：锁定光标和常态色、按钮高亮、改键标题同步', () => {
  const html = read('src/renderer/index.html'), index = read('src/renderer/index.ts')
  assert.match(html, /#app\.layout-locked \.splitter, #app\.layout-locked \.splitter\.g \{ cursor: default; \}/)
  assert.match(html, /#app\.layout-locked \.splitter:hover \{ background: var\(--line-soft\); \}/)
  assert.match(html, /#app\.layout-locked \.splitter\.g:hover \{ background: var\(--line\); \}/)
  assert.match(html, /#app\.layout-locked \.dock-fold-btn, #app\.layout-locked \.dock-stub \{ cursor: default; \}/)
  assert.match(html, /#app\.layout-locked \.dock-fold-btn:hover \{ color: var\(--dim\); \}/)
  assert.match(html, /#app\.layout-locked \.dock-stub:hover \{ background: var\(--bg1\); color: var\(--dim\); \}/)
  assert.match(html, /#btn-layout-lock\.on, \.ov-btn\.on \{[^}]*background: var\(--accent-dim\)/)
  assert.match(index, /\$\('#btn-layout-lock'\)\.addEventListener\('click', toggleLayoutLock\)/)
  assert.match(index, /id === 'layoutLock'\) toggleLayoutLock\(\)/)
  assert.match(index, /const syncHotkeyTitles = \(\) => \{[\s\S]*?hotkeyTitle\('layoutLock'\)/)
  assert.match(index, /addEventListener\('kuma-hotkeys-changed', syncHotkeyTitles\)/)
  assert.match(read('src/main/hotkeys.ts'), /layoutLock: readAccelerator\('layoutLock'\)/)
})
