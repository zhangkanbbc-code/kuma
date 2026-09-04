import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import passiveRefreshModule from '../dist/shared/passive-refresh.js'

const {
  missingReviewQueries,
  reviewQueriesFor,
  sortieJustEnded,
} = passiveRefreshModule

const read = (rel) => fs.readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8')

test('返港判据只认出击状态从有到无', () => {
  const underway = { map: 461, cell: 2 }
  assert.equal(sortieJustEnded(underway, { map: 461, cell: 3 }), false)
  assert.equal(sortieJustEnded(underway, null), true)
  assert.equal(sortieJustEnded(null, underway), false)
  assert.equal(sortieJustEnded(null, null), false)
})

test('史的每个视图只声明渲染实际读到的账本表', () => {
  assert.deepEqual(reviewQueriesFor('overview'), [
    'materials',
    'battles',
    'nodes',
    'events',
    'factory',
    'useitems',
    'master',
  ])
  assert.deepEqual(reviewQueriesFor('resources'), ['materials'])
  assert.deepEqual(reviewQueriesFor('factory'), ['factory'])
  assert.deepEqual(reviewQueriesFor('practice'), ['battles'])
  assert.deepEqual(reviewQueriesFor('nodes'), ['battles', 'nodes', 'nodeDrops', 'master', 'map'])
  assert.deepEqual(reviewQueriesFor('events'), ['events', 'master'])
  assert.deepEqual(reviewQueriesFor('items'), [
    'useitems',
    'itemChanges',
    'actions',
    'master',
    'payLog',
  ])
})

test('切到新视图会补查缺表，已经取到的表不重复取', () => {
  assert.deepEqual(
    missingReviewQueries('nodes', ['battles', 'master']),
    ['nodes', 'nodeDrops', 'map'],
  )
  assert.deepEqual(
    missingReviewQueries('items', ['useitems', 'itemChanges', 'actions', 'master', 'payLog']),
    [],
  )
})

test('史的同步时刻不进入整页渲染串，只由专用更新器就地填写', () => {
  const source = read('renderer/modules/shi.ts')
  const renderStart = source.indexOf('const render = () => {')
  const refreshStart = source.indexOf('const refresh = async', renderStart)
  assert.ok(renderStart >= 0 && refreshStart > renderStart, '找不到史的 render 边界')
  const render = source.slice(renderStart, refreshStart)

  assert.doesNotMatch(render, /fmtTime\(lastRefresh\)/)
  assert.equal(
    (render.match(/<footer class="shi-foot"><span data-shi-sync><\/span><\/footer>/g) ?? []).length,
    1,
    '有无读取记录都必须共用逐字节相同的空壳',
  )

  const paintStart = source.indexOf('const paintSyncStamp')
  assert.ok(paintStart >= 0 && paintStart < renderStart, '同步时刻更新器必须独立于整页渲染串')
  const paint = source.slice(paintStart, renderStart)
  assert.match(paint, /querySelector<HTMLElement>\('\[data-shi-sync\]'\)/)
  assert.match(paint, /\.textContent = lastRefresh \? `同步于 \$\{fmtTime\(lastRefresh\)\}` : '尚未读取'/)
  assert.match(render, /paintSyncStamp\(\)[\s\S]*?if \(!committed\)/)
  assert.match(source, /lastRefresh = Date\.now\(\)\s+paintSyncStamp\(\)/)
})

test('锱的每条被动查账路径都先过可见性闸门', () => {
  const source = read('renderer/modules/zi.ts')
  const guardStart = source.indexOf('const runPassiveRefresh')
  const rolloverStart = source.indexOf('const scheduleDayRollover', guardStart)
  assert.ok(guardStart >= 0 && rolloverStart > guardStart, '找不到锱的被动查账守卫')
  const guard = source.slice(guardStart, rolloverStart)
  assert.match(guard, /classList\.contains\('active'\)/)
  assert.ok(
    guard.indexOf("classList.contains('active')") < guard.indexOf('void refresh()'),
    'active 判断必须发生在真正发查询之前',
  )
  assert.match(guard, /refreshPending = true[\s\S]*?return/)

  const rolloverEnd = source.indexOf('const refresh = async', rolloverStart)
  assert.match(source.slice(rolloverStart, rolloverEnd), /setTimeout\(runPassiveRefresh,/)

  const patchStart = source.indexOf('    onMgChange((keys) => {')
  const patchEnd = source.indexOf('    render(true)', patchStart)
  const patches = source.slice(patchStart, patchEnd)
  assert.match(patches, /sortieJustEnded\(previousSortie, mg\.sortie\)/)
  assert.doesNotMatch(
    patches,
    /\['materials', 'useitems', 'sortie', 'kdocks'\]/,
    '出击途中每个节点都有 sortie 键，不能再把它当查账理由',
  )
  assert.match(patches, /setTimeout\(runPassiveRefresh, sortieEnded \? 500 : 3000\)/)

  const onShow = source.slice(source.indexOf('  onShow:'), source.lastIndexOf('})'))
  assert.match(onShow, /refreshPending \|\| Date\.now\(\) - lastRefresh > 30000/)
  assert.match(onShow, /refreshPending = false[\s\S]*?void refresh\(\)/)
})

test('锱隐藏时的组合补丁仍会重取主数据', () => {
  const source = read('renderer/modules/zi.ts')
  const patchStart = source.indexOf('    onMgChange((keys) => {')
  const patchEnd = source.indexOf('\n    })', patchStart)
  assert.ok(patchStart >= 0 && patchEnd > patchStart, '找不到锱的 onMgChange 回调边界')
  const patches = source.slice(patchStart, patchEnd)
  const masterStart = patches.indexOf("if (keys.includes('master'))")
  assert.ok(masterStart >= 0, '找不到锱的 master 补丁分支')
  assert.doesNotMatch(
    patches.slice(0, masterStart),
    /\breturn\b/,
    '面板隐藏时收到同时带 sortie/ships 与 master 的一份补丁，主数据永远不会被重取，zi 会一直用旧的一份，且不报错',
  )
  assert.match(
    patches.slice(masterStart),
    /queryMasterRaw\(\)\.then\(\(raw\) => \{\s+applyMaster\(raw\)/,
    '锱的 master 补丁分支必须重取并应用主数据',
  )
})

test('史按当前视图发查询，切页只把缺表交给 450ms 补查', () => {
  const source = read('renderer/modules/shi.ts')
  const refreshStart = source.indexOf('const refresh = async')
  const scheduleStart = source.indexOf('const scheduleRefresh', refreshStart)
  assert.ok(refreshStart >= 0 && scheduleStart > refreshStart, '找不到史的 refresh 边界')
  const refresh = source.slice(refreshStart, scheduleStart)
  assert.match(refresh, /new Set\(requestedQueries \?\? reviewQueriesFor\(activeView\)\)/)
  assert.equal(
    (refresh.match(/wanted\.has\('/g) ?? []).length,
    12,
    '12 个查询入口必须逐一受当前视图计划约束',
  )
  assert.match(refresh, /for \(const query of wanted\) loadedReviewQueries\.add\(query\)/)

  const viewStart = source.indexOf("const view = target.closest<HTMLElement>('[data-shi-view]')")
  const rangeStart = source.indexOf("const range = target.closest<HTMLElement>('[data-shi-range]')", viewStart)
  assert.ok(viewStart >= 0 && rangeStart > viewStart, '找不到史的切视图分支')
  const switchView = source.slice(viewStart, rangeStart)
  assert.match(switchView, /missingReviewQueries\(activeView, loadedReviewQueries\)/)
  assert.match(switchView, /if \(missing\.length\) scheduleRefresh\(missing\)/)

  const scheduleEnd = source.indexOf('registerModule({', scheduleStart)
  const schedule = source.slice(scheduleStart, scheduleEnd)
  assert.match(schedule, /450/)
})

test('锱与史都把查询回程派生段记入 perf.log 单次计时', () => {
  const zi = read('renderer/modules/zi.ts')
  const shi = read('renderer/modules/shi.ts')
  assert.match(zi, /timedRun\('async:zi', \(\) => \{/)
  assert.match(shi, /timedRun\('async:shi', \(\) => \{/)
})
