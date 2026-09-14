import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import pop from '../dist/shared/pop-module.js'

test('弹窗查询串只接受坞内模块的完整 id', () => {
  assert.equal(pop.popModuleOf('?pop=ji'), 'ji')
  for (const search of ['?pop=yu', '?pop=ji2', '', '?pop=']) {
    assert.equal(pop.popModuleOf(search), null)
  }
  for (const id of pop.POP_MODULE_IDS) assert.equal(pop.isPopModuleId(id), true)
  for (const raw of [null, undefined, 3, {}, 'yu', 'ji2']) assert.equal(pop.isPopModuleId(raw), false)
})

test('弹出名单过滤去重并保留原序，非数组为空', () => {
  assert.deepEqual(pop.normalizePopped(['ji', 'ji', 'yu', 3, 'di']), ['ji', 'di'])
  for (const raw of [null, undefined, 'ji', {}, 3]) assert.deepEqual(pop.normalizePopped(raw), [])
})

test('模块的宿主随弹出名单变化', () => {
  assert.equal(pop.hostOfModule('ji', ['ji']), 'ji')
  assert.equal(pop.hostOfModule('ji', []), 'main')
})

test('弹窗标题、边界键和默认尺寸保持约定', () => {
  assert.equal(pop.popWindowTitle('图鉴'), 'kuma · 图鉴')
  assert.equal(pop.POP_WINDOW_BOUNDS_KEY('ji'), 'kuma.popWindow.ji')
  assert.deepEqual(pop.POP_WINDOW_DEFAULT_SIZE, { width: 960, height: 720 })
  assert.deepEqual(pop.POP_WINDOW_MIN_SIZE, { width: 420, height: 320 })
})

test('弹窗名单等于导航名单扣除浮层、系统和诊断模块', () => {
  const source = fs.readFileSync(new URL('../src/renderer/mu.ts', import.meta.url), 'utf8')
  const nav = source.match(/const NAV_MODULES[^=]*=\s*\[([\s\S]*?)\r?\n\]/)
  assert.ok(nav, '找不到导航名单')
  const ids = [...nav[1].matchAll(/\['([^']+)',/g)].map((match) => match[1])
  const excluded = new Set()
  for (const name of ['OVERLAY_MODULES', 'SYSTEM_ACTIVE', 'DIAGNOSTIC_MODULES']) {
    const block = source.match(new RegExp(`const ${name} = (?:new Set\\()?\\[([^\\]]*)\\]`))
    assert.ok(block, `找不到 ${name}`)
    for (const match of block[1].matchAll(/'([^']+)'/g)) excluded.add(match[1])
  }
  assert.deepEqual(new Set(pop.POP_MODULE_IDS), new Set(ids.filter((id) => !excluded.has(id))))
})

test('查询键和 IPC 名称可供后续施工单按名引用', () => {
  assert.equal(pop.POP_QUERY_KEY, 'pop')
  for (const [name, value] of Object.entries({
    POP_OPEN_CHANNEL: 'window:pop-open', POP_CLOSE_CHANNEL: 'window:pop-close',
    POP_FOCUS_CHANNEL: 'window:pop-focus', POP_LIST_CHANNEL: 'window:pop-list',
    POP_CLOSED_CHANNEL: 'window:pop-closed', POP_RELAY_CHANNEL: 'window:pop-relay',
    POP_RELAY_EVENT: 'kuma:pop-relay',
  })) assert.equal(pop[name], value)
})
