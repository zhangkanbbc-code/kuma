import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import viewState from '../dist/shared/view-state.js'
import { renderFriendlySection } from './fixtures/render-du-friendly.mjs'

const { VIEW_RESTORE_ORDER, detailsKey, focusSelector, runViewRestore, settlersToRun } = viewState

test('explicit data-keep wins over positional keys and survives list reordering', () => {
  const before = new Map()
  const after = new Map()
  // 归档列表新插了一条：靠序号认会整体错位一格，data-keep 不受影响
  const oldOrder = [{ keep: 'event-drops:100', className: 'shi-event-drops' }]
  const newOrder = [
    { keep: 'event-drops:200', className: 'shi-event-drops' },
    { keep: 'event-drops:100', className: 'shi-event-drops' },
  ]
  const opened = new Set(oldOrder.map((el) => detailsKey(el, before)))
  assert.ok(opened.has(detailsKey(newOrder[1], after)))
  assert.ok(!opened.has(detailsKey(newOrder[0], new Map())))
})

test('positional keys count per class so unrelated details never collide', () => {
  const seen = new Map()
  assert.equal(detailsKey({ className: 'op-more' }, seen), 'c:op-more#0')
  assert.equal(detailsKey({ className: 'rank-card' }, seen), 'c:rank-card#0')
  assert.equal(detailsKey({ className: 'op-more' }, seen), 'c:op-more#1')
  // 无 class 时也要有个落点，不能算出 undefined
  assert.equal(detailsKey({}, seen), 'c:details#0')
})

test('focus selectors quote their values so ids and data attributes cannot break the query', () => {
  assert.equal(focusSelector({ id: 'qa-search' }), '[id="qa-search"]')
  // 纯数字 data 值：CSS.escape 会把它转成 \31 23 这类标识符转义，放进引号里是错的
  assert.equal(
    focusSelector({ attributes: [{ name: 'data-roster-note', value: '123' }] }),
    '[data-roster-note="123"]',
  )
  assert.equal(
    focusSelector({ attributes: [{ name: 'data-proxy-field', value: 'pacAddr' }] }),
    '[data-proxy-field="pacAddr"]',
  )
  // 值里带引号/反斜杠也不能拼出坏选择器
  assert.equal(
    focusSelector({ attributes: [{ name: 'data-x', value: 'a"b\\c' }] }),
    '[data-x="a\\"b\\\\c"]',
  )
})

test('focus selectors refuse to guess when there is nothing stable to match on', () => {
  // 没有 id、没有 data-*，宁可不恢复也不猜——猜错会把焦点丢到另一个输入框
  assert.equal(focusSelector({ attributes: [{ name: 'class', value: 'yin' }] }), null)
  assert.equal(focusSelector({ attributes: [{ name: 'data-empty', value: '' }] }), null)
  assert.equal(focusSelector({}), null)
  assert.equal(focusSelector({ id: '' }), null)
})

test('会撑高/压矮内容的两步排在滚动还原前面——次序本身就是判据', () => {
  // 2026-08-23 用户实机报的「点一下播放，被往上拉了好几屏」就死在这条次序上。
  // 分段折叠不是渲染出口写进 HTML 的，是渲染之后由 JS 施加的（section-fold 的
  // MutationObserver），而那是微任务，排在同步还原滚动之后：先按「全展开」的
  // 虚高把滚动放回去，微任务一到几段折回去、页面矮下来，浏览器把 scrollTop 夹上来。
  // 真浏览器量过：装了折叠丢 328px，不装折叠丢 0px；修完丢 0px。
  const order = [...VIEW_RESTORE_ORDER]
  assert.deepEqual(order, ['settle', 'details', 'focus', 'scroll'])
  assert.ok(order.indexOf('settle') < order.indexOf('scroll'), 'settle 会改高度，必须排在 scroll 前')
  assert.ok(order.indexOf('details') < order.indexOf('scroll'), 'details 展开会撑高，必须排在 scroll 前')

  // 跑的次序也得是这一个——常量对了而实现另按自己的顺序调，同样不报错
  const ran = []
  runViewRestore({
    settle: () => ran.push('settle'),
    details: () => ran.push('details'),
    focus: () => ran.push('focus'),
    scroll: () => ran.push('scroll'),
  })
  assert.deepEqual(ran, order)
})

test('换完 DOM 该跑哪些收尾：本树/祖先/后代都算，面板重挂后的旧登记要丢掉', () => {
  // 折叠是按「装在哪棵子树上」登记的（图鉴与镝各装在自己的面板上），
  // 而重渲染可能发生在那棵子树本身、它的祖先或它的某个后代上——三种都得跑。
  const contains = (ancestor, node) => `${node}`.startsWith(`${ancestor}/`)
  const entries = [
    { root: 'app/ji', connected: true, tag: 'ji' },
    { root: 'app/di', connected: true, tag: 'di' },
    { root: 'app/ji/drawer', connected: true, tag: 'ji-drawer' },
    { root: 'app', connected: true, tag: 'app' },
  ]
  const tagsOf = (target) => settlersToRun(entries, target, contains).map((entry) => entry.tag).sort()
  // 本树 + 祖先（app 包着它）+ 后代（抽屉在它里面）
  assert.deepEqual(tagsOf('app/ji'), ['app', 'ji', 'ji-drawer'])
  // 换的是抽屉这一小块：抽屉自己 + 两层祖先都要跑，隔壁的镝不跑
  assert.deepEqual(tagsOf('app/ji/drawer'), ['app', 'ji', 'ji-drawer'])
  assert.deepEqual(tagsOf('app/di'), ['app', 'di'])
  // 面板重试装配换了元素：旧登记指着一棵离开文档的树，再跑就是白跑
  const stale = [{ root: 'app/ji', connected: false, tag: 'old' }, { root: 'app/ji', connected: true, tag: 'new' }]
  assert.deepEqual(
    settlersToRun(stale, 'app/ji', contains).map((entry) => entry.tag),
    ['new'],
  )
  assert.deepEqual(settlersToRun([], 'app/ji', contains), [])
})

test('a passive re-render restores scroll, open details, and the field being typed in', () => {
  // 曾经的行为：innerHTML 重建只补回 scrollTop，展开的 <details> 一律收起、
  // 输入焦点丢失。备注框最伤——它用 change 提交，没 blur 就重建 = 敲进去的字直接没了。
  const kernel = fs.readFileSync(new URL('../src/renderer/kernel.ts', import.meta.url), 'utf8')
  assert.match(kernel, /export const withViewStateKept/)
  // 展开态要赶在还原滚动之前恢复，否则内容还没撑开，scrollTop 会被截断
  const body = kernel.slice(kernel.indexOf('export const withViewStateKept'))
  assert.ok(
    body.indexOf('el.open = true') < body.indexOf('el.scrollTop = hit.top'),
    'details must be reopened before scrollTop is restored',
  )
  // 未提交的输入值要跟着焦点一起回来
  assert.match(body, /el\.value = focus\.value/)
  assert.match(body, /setSelectionRange\(focus\.selection\[0\], focus\.selection\[1\]\)/)
  // focus 自带的滚动会跟滚动还原打架
  assert.match(body, /focus\(\{ preventScroll: true \}\)/)
  // 只在焦点确实落在本面板内时才接管
  assert.match(body, /active !== document\.body && root\.contains\(active\)/)
})

test('details inside dynamic lists carry explicit keys instead of relying on position', () => {
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const review = fs.readFileSync(new URL('../src/renderer/modules/shi.ts', import.meta.url), 'utf8')
  const event = fs.readFileSync(new URL('../src/renderer/modules/du.ts', import.meta.url), 'utf8')
  assert.match(catalog, /class="equipable-group" data-keep="equipable:/)
  assert.match(review, /data-keep="event-drops:/)
  // du 的 op-more 是条件渲染，少一个就整体错位，必须各有各的键
  for (const key of ['op-reserve', 'op-specials']) {
    assert.ok(event.includes(`data-keep="${key}"`), `du must key its ${key} details`)
  }
  // 友军那两层的键是**传进去的参数**，源码里搜不到字面量——改对着产物验。
  // 这比原来的字面量检查更硬：两层各自的键必须真的落到产物上，且两层不许撞键
  // （撞了的话展开一层、另一层会跟着展开，正是这条护栏要防的错位）。
  const many = (n, make) => Array.from({ length: n }, (_, i) => make(i))
  const html = renderFriendlySection(
    many(13, (i) => ({
      fleetKey: `k${i}`,
      map: 624,
      difficulty: 2,
      ships: [{ mstId: 553 + i, lv: 1, slot: [], slotEx: 0, maxHp: 1, param: [], voiceId: 0, voiceP: 0 }],
      count: 1,
      firstTs: i,
      lastTs: i,
      cells: [{ cell: 47, count: 1 }],
      requestTypes: [],
      unknownRequest: 1,
      productionTypes: [],
    })),
    many(13, (i) => ({ ships: [{ id: 700 + i, name: `资料${i}` }] })),
  )
  const keys = [...html.matchAll(/data-keep="([^"]+)"/g)].map((hit) => hit[1])
  assert.equal(keys.length, 2, '两层各摆一个可展开的 details')
  assert.equal(new Set(keys).size, 2, `友军两层的 details 键撞了：${keys.join(' / ')}`)
})
