import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { createRequire } from 'node:module'

import { buildSync } from 'esbuild'

const read = (...rel) => fs.readFileSync(new URL(rel.join('/'), `${new URL('../', import.meta.url)}`), 'utf8').replace(/\r\n/g, '\n')

const compile = (contents) => {
  const js = buildSync({
    stdin: { contents, loader: 'ts' },
    write: false,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  }).outputFiles[0].text
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', js)(mod, mod.exports, createRequire(import.meta.url))
  return mod.exports
}

const cutFrom = (source, from, to, label) => {
  const start = source.indexOf(from)
  assert.ok(start >= 0, `切不到「${label}」的起点`)
  const end = source.indexOf(to, start + from.length)
  assert.ok(end > start, `切不到「${label}」的终点`)
  return source.slice(start, end)
}

const loadMaterialDeltas = ({ animationFrame = false } = {}) => {
  const source = read('src', 'renderer', 'material-deltas.ts')
  const body = source.replace(/^import \{ mg, onMgChange, trackMountCleanup \} from '\.\/kernel'\n/, '')
  assert.notEqual(body, source, '共用差值点的内核 import 形态变了，夹具要跟着更新')
  return compile(`
const mg: { materials: number[] | null } = { materials: [100, 200, 300, 400, 50, 60, 70, 80] }
let patchListener: ((keys: string[]) => void) | null = null
let patchSubscriptions = 0
let frameCallback: ((time: number) => void) | null = null
const requestAnimationFrame = ${animationFrame ? '(cb: (time: number) => void) => { frameCallback = cb; return 1 }' : 'undefined'}
const onMgChange = (cb: (keys: string[]) => void) => {
  patchListener = cb
  patchSubscriptions++
}
const trackMountCleanup = (_cb: () => void) => {}
${body}
export const setMaterials = (materials: number[] | null) => { mg.materials = materials }
export const dispatch = (keys: string[]) => patchListener?.(keys)
export const subscriptionCount = () => patchSubscriptions
export const framePending = () => frameCallback != null
export const flushFrame = () => {
  const callback = frameCallback
  frameCallback = null
  callback?.(0)
}
`)
}

const glowNode = (resource, initial = [], initialStyle = {}) => {
  const classes = new Set(initial)
  const mutations = []
  const styles = new Map(Object.entries(initialStyle))
  const styleMutations = []
  return {
    dataset: { resource: `${resource}` },
    classList: {
      contains: (className) => classes.has(className),
      remove: (...classNames) => {
        mutations.push(['remove', ...classNames])
        for (const className of classNames) classes.delete(className)
      },
      add: (...classNames) => {
        mutations.push(['add', ...classNames])
        for (const className of classNames) classes.add(className)
      },
    },
    style: {
      setProperty: (name, value) => {
        styleMutations.push(['setProperty', name, value])
        styles.set(name, value)
      },
      removeProperty: (name) => {
        styleMutations.push(['removeProperty', name])
        styles.delete(name)
      },
    },
    classes,
    mutations,
    styles,
    styleMutations,
  }
}

const loadGlowSync = (source, start, end, rootName, functionName) => {
  const body = cutFrom(source, start, end, `${functionName} 真函数`)
  return compile(`
let ${rootName}: any
let now = 0
const Date = { now: () => now }
const cues = new Map<number, any>()
const materialCues = () => new Map(cues)
${body}
export const setRoot = (value: any) => { ${rootName} = value }
export const setNow = (value: number) => { now = value }
export const setCue = (idx: number, cue: any) => cues.set(idx, cue)
export const clearCue = (idx: number) => cues.delete(idx)
export { ${functionName} }
`)
}

test('共用资源提示只在基线建立后产生，并在短数组后重新建基线', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10_000 })
  try {
    const loaded = loadMaterialDeltas()
    let changes = 0
    loaded.onMaterialCueChange(() => { changes++ })
    assert.equal(loaded.subscriptionCount(), 1)
    assert.deepEqual([...loaded.materialCues()], [], '模块载入时只能拿当前快照建基线')

    loaded.setMaterials([103, 200, 300, 400, 50, 58, 70, 80])
    loaded.dispatch(['ships'])
    assert.deepEqual([...loaded.materialCues()], [], '非 materials 补丁不能触发差值')
    loaded.dispatch(['materials'])
    assert.deepEqual([...loaded.materialCues()], [
      [0, { delta: 3, phase: 'active', phaseAt: 10_000 }],
      [5, { delta: -2, phase: 'active', phaseAt: 10_000 }],
    ])
    await Promise.resolve()
    assert.equal(changes, 1, '同一份补丁里的多格变化只通知一次')

    loaded.setMaterials([103, 200, 300, 400, 50, 58, 70])
    loaded.dispatch(['materials'])
    assert.equal(changes, 1, '长度不足 8 只清基线')
    loaded.setMaterials([999, 200, 300, 400, 50, 58, 70, 80])
    loaded.dispatch(['materials'])
    assert.equal(changes, 1, '短数组后的第一份完整回灌只重建基线')
    loaded.setMaterials([999, 200, 300, 400, 50, 58, 70, 81])
    loaded.dispatch(['materials'])
    assert.deepEqual(loaded.materialCues().get(7), { delta: 1, phase: 'active', phaseAt: 10_000 }, '任何非零变化都要产生提示')
    await Promise.resolve()
    assert.equal(changes, 2)
  } finally {
    t.mock.timers.reset()
  }
})

test('共用资源提示累加差值，重新计时后按 hold、leaving、移除三段推进', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10_000 })
  try {
    const loaded = loadMaterialDeltas()
    const phases = []
    loaded.onMaterialCueChange(() => {
      const cue = loaded.materialCues().get(0)
      phases.push(cue ? `${cue.phase}:${cue.delta}` : 'none')
    })

    loaded.setMaterials([103, 200, 300, 400, 50, 60, 70, 80])
    loaded.dispatch(['materials'])
    const firstSnapshot = loaded.materialCues()
    assert.deepEqual(firstSnapshot.get(0), { delta: 3, phase: 'active', phaseAt: 10_000 })
    await Promise.resolve()

    t.mock.timers.tick(1000)
    loaded.setMaterials([105, 200, 300, 400, 50, 60, 70, 80])
    loaded.dispatch(['materials'])
    assert.deepEqual(loaded.materialCues().get(0), { delta: 5, phase: 'active', phaseAt: 11_000 }, '同一格连续变化要累加并刷新 active 起始时刻')
    assert.deepEqual(firstSnapshot.get(0), { delta: 3, phase: 'active', phaseAt: 10_000 }, '已取出的 Map 必须是当时的快照')
    await Promise.resolve()

    t.mock.timers.tick(2399)
    assert.equal(loaded.materialCues().get(0).phase, 'active', '连续变化后 hold 要从头计 2400ms')
    t.mock.timers.tick(1)
    assert.deepEqual(loaded.materialCues().get(0), { delta: 5, phase: 'leaving', phaseAt: 13_400 }, '切入 leaving 要记录独立起始时刻')
    await Promise.resolve()
    t.mock.timers.tick(419)
    assert.equal(loaded.materialCues().get(0).phase, 'leaving', '淡出满 420ms 前不能移除')
    t.mock.timers.tick(1)
    assert.equal(loaded.materialCues().has(0), false)
    await Promise.resolve()
    assert.deepEqual(phases, ['active:3', 'active:5', 'leaving:5', 'none'])
  } finally {
    t.mock.timers.reset()
  }
})

test('同一帧多格变化只通知一次，回调读取合并后的最终态', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10_000 })
  try {
    const loaded = loadMaterialDeltas({ animationFrame: true })
    const snapshots = []
    loaded.onMaterialCueChange(() => snapshots.push([...loaded.materialCues()]))

    loaded.setMaterials([101, 201, 301, 401, 51, 61, 71, 81])
    loaded.dispatch(['materials'])
    loaded.setMaterials([102, 202, 302, 402, 52, 62, 72, 82])
    loaded.dispatch(['materials'])
    assert.equal(loaded.framePending(), true)
    assert.equal(snapshots.length, 0, '帧回调前不能提前通知')
    loaded.flushFrame()
    assert.equal(snapshots.length, 1)
    assert.deepEqual(snapshots[0], Array.from({ length: 8 }, (_, idx) => [
      idx,
      { delta: 2, phase: 'active', phaseAt: 10_000 },
    ]))

    t.mock.timers.tick(2400)
    assert.equal(snapshots.length, 1, '同拍八格进入 leaving 仍只排一个帧回调')
    loaded.flushFrame()
    assert.deepEqual(snapshots[1], Array.from({ length: 8 }, (_, idx) => [
      idx,
      { delta: 2, phase: 'leaving', phaseAt: 12_400 },
    ]))

    t.mock.timers.tick(420)
    assert.equal(snapshots.length, 2, '同拍八格移除仍只排一个帧回调')
    loaded.flushFrame()
    assert.deepEqual(snapshots[2], [])
  } finally {
    t.mock.timers.reset()
  }
})

test('顶栏与锱的渲染串不带光 class，同步函数按 cue 相位幂等贴 class', () => {
  const header = read('src', 'renderer', 'header-status.ts')
  const zi = read('src', 'renderer', 'modules', 'zi.ts')
  const resourceOrder = cutFrom(
    header,
    'const RESOURCE_ORDER',
    '\n\nlet host',
    '顶栏资源顺序',
  )
  const resources = cutFrom(
    header,
    'const resourcesHtml = ',
    '\nconst capacityHtml = ',
    '顶栏资源渲染',
  )
  const loaded = compile(`
const mg: any = { materials: [100, 200, 300, 400, 50, 60, 70, 80] }
const MATERIAL_ICON_BY_INDEX = Array.from({ length: 8 }, (_, idx) => idx)
const materialIconHtml = (idx: number) => \`<i>\${idx}</i>\`
const fmtShort = (value: number) => \`\${value}\`
${resourceOrder}
${resources}
export { resourcesHtml }
`)
  assert.doesNotMatch(loaded.resourcesHtml(), /\bglow-/)
  const tile = cutFrom(zi, 'const tileHtml = ', '\n\n// 收支分解卡', '锱资源磁贴渲染')
  assert.doesNotMatch(tile, /\bglow-/)
  assert.match(tile, /class="tile\$\{highlightTile === idx \? ' hl' : ''\}" data-resource=/)

  const fixtures = [
    loadGlowSync(header, 'const RESOURCE_GLOW_CLASSES', '\n\nconst resourcesHtml', 'host', 'syncResourceGlow'),
    loadGlowSync(zi, 'const TILE_GLOW_CLASSES', '\n\nconst materialDeltaCueHtml', 'pane', 'syncTileGlow'),
  ]
  for (const fixture of fixtures) {
    const up = glowNode(0, ['other'])
    const down = glowNode(5, ['glow-up'])
    const idle = glowNode(7)
    const steady = glowNode(1, ['glow-up'], { '--glow-elapsed': 'kept' })
    const nodes = [up, down, idle, steady]
    fixture.setRoot({ querySelectorAll: () => nodes })
    fixture.setNow(10_000)
    fixture.setCue(0, { delta: 3, phase: 'active', phaseAt: 9_000 })
    fixture.setCue(5, { delta: -2, phase: 'leaving', phaseAt: 9_500 })
    fixture.setCue(1, { delta: 1, phase: 'active', phaseAt: 0 })

    fixture.syncResourceGlow?.()
    fixture.syncTileGlow?.()
    assert.deepEqual([...up.classes].sort(), ['glow-up', 'other'])
    assert.equal(up.styles.get('--glow-elapsed'), '1000ms', '相位开始 1000ms 后换入的新元素要从当前进度接播')
    assert.deepEqual([...down.classes].sort(), ['glow-down', 'leaving'])
    assert.equal(idle.mutations.length, 0, '没有 cue 且没有旧 class 时不能触碰 classList')
    assert.deepEqual(steady.mutations, [], 'class 已一致时不能触碰 classList')
    assert.deepEqual(steady.styleMutations, [], 'class 已一致时不能触碰相位变量')
    assert.equal(steady.styles.get('--glow-elapsed'), 'kept')
    const mutationCounts = nodes.map((node) => node.mutations.length)
    const styleMutationCounts = nodes.map((node) => node.styleMutations.length)

    fixture.syncResourceGlow?.()
    fixture.syncTileGlow?.()
    assert.deepEqual(nodes.map((node) => node.mutations.length), mutationCounts, '目标集合相同必须幂等返回')
    assert.deepEqual(nodes.map((node) => node.styleMutations.length), styleMutationCounts, '目标集合相同不能重写相位变量')

    fixture.clearCue(0)
    fixture.setCue(5, { delta: -2, phase: 'active', phaseAt: 10_000 })
    fixture.syncResourceGlow?.()
    fixture.syncTileGlow?.()
    assert.deepEqual([...up.classes], ['other'])
    assert.equal(up.styles.has('--glow-elapsed'), false, 'cue 消失时要移除相位变量')
    assert.deepEqual([...down.classes], ['glow-down'])
  }
})

test('顶栏与锱从共用 cue 渲染同款常亮，并在 reduced-motion 下关闭光效', () => {
  const deltas = read('src', 'renderer', 'material-deltas.ts')
  const header = read('src', 'renderer', 'header-status.ts')
  const zi = read('src', 'renderer', 'modules', 'zi.ts')
  const html = read('src', 'renderer', 'index.html')

  assert.match(deltas, /差值判定与提示生命周期只有这一份/)
  assert.match(header, /onMaterialCueChange\(syncResourceGlow\)/)
  assert.match(header, /if \(changed\) fitHeader\(\)\s+syncResourceGlow\(\)/)
  assert.match(zi, /onMaterialCueChange\(\(\) => \{\s+renderPassiveChange\(\)\s+syncTileGlow\(\)/)
  assert.match(zi, /const renderPassiveChange = \(\) => \{[\s\S]*?deferPassive\(pane, 'zi', render\)/)
  assert.match(zi, /if \(!commitPaneHtml\(pane, 'zi', html\)\) \{\s+syncTileGlow\(\)\s+return/)
  assert.doesNotMatch(zi, /const observeMaterialChanges|materialBaseline/)
  assert.doesNotMatch(`${deltas}\n${header}\n${zi}\n${html}`, /flash-up|flash-down|flashHeaderResource|materialFlashDirections/)

  assert.match(html, /#header-status \.hs-res::after, \.mod-zi \.tile::after \{[\s\S]*?opacity: 0; will-change: opacity;/)
  assert.match(html, /\.hs-res\.glow-up::after, \.mod-zi \.tile\.glow-up::after \{ background: color-mix\(in srgb, var\(--ok\) 26%, transparent\); box-shadow: inset 0 0 0 1px var\(--ok\); \}/)
  assert.match(html, /\.tile\.glow-up::after, \.mod-zi \.tile\.glow-down::after \{ animation: kanso-res-glow-in 240ms ease-out both; animation-delay: calc\(-1 \* var\(--glow-elapsed, 0ms\)\); \}/)
  assert.match(html, /\.tile\.glow-down\.leaving::after \{ animation: kanso-res-glow-out 420ms ease-in forwards; animation-delay: calc\(-1 \* var\(--glow-elapsed, 0ms\)\); \}/)
  assert.match(html, /@keyframes kanso-res-glow-in \{ from \{ opacity: 0; \} to \{ opacity: 1; \} \}/)
  assert.match(html, /@keyframes kanso-res-glow-out \{ from \{ opacity: 1; \} to \{ opacity: 0; \} \}/)
  const reduced = html.slice(html.indexOf('@media (prefers-reduced-motion: reduce)'))
  assert.match(reduced, /#header-status \.hs-res::after,\s+\.mod-zi \.tile::after \{ animation: none !important; opacity: 0 !important; \}/)
})
