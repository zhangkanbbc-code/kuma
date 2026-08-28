import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import eventArea from '../dist/shared/event-area.js'

const { detectEventAreas, hasEventMaps } = eventArea

const root = path.join(fileURLToPath(import.meta.url), '..', '..')
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

// ---- 主数据样本（与真实 api_start2 同形，只留判定用得到的字段）----

/** 常设海域：1-7 区，api_type 全 0 */
const NORMAL_AREAS = [1, 2, 3, 4, 5, 6, 7].map((id) => ({ api_id: id, api_name: `${id}区`, api_type: 0 }))
const NORMAL_MAPS = [
  { api_id: 11, api_maparea_id: 1, api_no: 1 },
  { api_id: 25, api_maparea_id: 2, api_no: 5 },
  { api_id: 75, api_maparea_id: 7, api_no: 5 },
]
/** 活动开幕：多出一个 api_type=1 的区，外加它的几张海图 */
const EVENT_AREA = { api_id: 56, api_name: '期間限定海域', api_type: 1 }
const EVENT_MAPS = [
  { api_id: 561, api_maparea_id: 56, api_no: 1 },
  { api_id: 562, api_maparea_id: 56, api_no: 2 },
]

const masterWithEvent = () => ({
  api_mst_maparea: [...NORMAL_AREAS, EVENT_AREA],
  api_mst_mapinfo: [...NORMAL_MAPS, ...EVENT_MAPS],
})
const masterWithoutEvent = () => ({
  api_mst_maparea: [...NORMAL_AREAS],
  api_mst_mapinfo: [...NORMAL_MAPS],
})

// ---- 判定本体 ----

test('活动海域按游戏自己的 api_type 标记认，常设区一个都不算', () => {
  const view = detectEventAreas(masterWithEvent().api_mst_maparea, masterWithEvent().api_mst_mapinfo)
  assert.equal(view.hasEventTypeFlag, true)
  assert.deepEqual([...view.eventAreaIds], [56])
  assert.deepEqual(view.eventMaps.map((m) => m.api_id), [561, 562])

  const quiet = detectEventAreas(masterWithoutEvent().api_mst_maparea, masterWithoutEvent().api_mst_mapinfo)
  assert.equal(quiet.hasEventTypeFlag, true)
  assert.deepEqual([...quiet.eventAreaIds], [])
  assert.deepEqual(quiet.eventMaps, [])
})

test('老格式（整张表都没有 api_type）回退到 id > 10 阈值', () => {
  // 这条兜底是抽取前三份代码里都写着的，抽出来不许丢
  const areas = [{ api_id: 1 }, { api_id: 7 }, { api_id: 11 }, { api_id: 30 }]
  const maps = [
    { api_id: 11, api_maparea_id: 1 },
    { api_id: 111, api_maparea_id: 11 },
    { api_id: 301, api_maparea_id: 30 },
  ]
  const view = detectEventAreas(areas, maps)
  assert.equal(view.hasEventTypeFlag, false)
  assert.deepEqual([...view.eventAreaIds], [11, 30])
  assert.deepEqual(view.eventMaps.map((m) => m.api_id), [111, 301])
})

test('只要有一行带 api_type 就走标记判定，不再看 id 阈值', () => {
  // 活动区 id 天然大于 10，靠 id 判会得出同样的答案；真正区分两条分支的是
  // 「常设区被标成 type 0 但 id 也大于 10」这种未来格式——标记优先，别被阈值带偏
  const areas = [{ api_id: 1, api_type: 0 }, { api_id: 42, api_type: 0 }, { api_id: 56, api_type: 1 }]
  const view = detectEventAreas(areas, [
    { api_id: 421, api_maparea_id: 42 },
    { api_id: 561, api_maparea_id: 56 },
  ])
  assert.equal(view.hasEventTypeFlag, true)
  assert.deepEqual([...view.eventAreaIds], [56])
  assert.deepEqual(view.eventMaps.map((m) => m.api_id), [561])
})

test('空表 / 缺字段不抛，答案是「没有活动」而不是崩', () => {
  for (const empty of [undefined, null, []]) {
    const view = detectEventAreas(empty, empty)
    assert.equal(view.hasEventTypeFlag, false)
    assert.equal(view.eventAreaIds.size, 0)
    assert.deepEqual(view.eventMaps, [])
  }
  assert.equal(hasEventMaps(undefined), false)
  assert.equal(hasEventMaps({}), false)
  // 活动区已经在主数据里、但海图还没下发：没有海图就不算「大活动进行中」
  assert.equal(hasEventMaps({ api_mst_maparea: [...NORMAL_AREAS, EVENT_AREA], api_mst_mapinfo: [] }), false)
})

test('hasEventMaps 只认有额外海图的大活动', () => {
  assert.equal(hasEventMaps(masterWithEvent()), true)
  assert.equal(hasEventMaps(masterWithoutEvent()), false)
})

// ---- 锱的「活动准备度」卡：两态各渲一次 ----
//
// 从打包产物里把外壳函数整段切出来真跑，不是比对源码文本——
// 判断写反（`if (!eventMaps) return ''`）时源码级守卫照样绿，这一组不会。
const loadFromBundle = (name) => {
  const bundle = read('dist/renderer/index.js')
  const head = new RegExp(`\\b${name}\\w* = \\(([^)]*)\\) => \\{`).exec(bundle)
  assert.ok(head, `编译产物里找不到 ${name} —— 被改名或被内联了`)
  const open = bundle.indexOf('{', head.index + head[0].length - 1)
  let depth = 0
  let close = -1
  for (let i = open; i < bundle.length; i += 1) {
    if (bundle[i] === '{') depth += 1
    else if (bundle[i] === '}') {
      depth -= 1
      if (depth === 0) {
        close = i
        break
      }
    }
  }
  assert.ok(close > open, `${name} 的函数体没能完整切出来`)
  return new Function(head[1], bundle.slice(open + 1, close))
}

test('大活动进行中：锱的「活动准备度」整张卡不产出', () => {
  const card = loadFromBundle('readinessCardHtml')
  const body = () => '<div class="rd-head">78%</div>'

  // 有活动海图 → 一个字都不出（卡头、卡壳、正文全没有）
  const hidden = card(hasEventMaps(masterWithEvent()), body)
  assert.equal(hidden, '')

  // 没有活动海图 → 原样，卡头与正文都在
  const shown = card(hasEventMaps(masterWithoutEvent()), body)
  assert.match(shown, /<div class="scard">/)
  assert.match(shown, /活动准备度/)
  assert.match(shown, /rd-head/)
})

test('隐藏时正文函数根本不被调用（不是画完再丢）', () => {
  const card = loadFromBundle('readinessCardHtml')
  let calls = 0
  const body = () => {
    calls += 1
    return 'x'
  }
  card(hasEventMaps(masterWithEvent()), body)
  assert.equal(calls, 0)
  card(hasEventMaps(masterWithoutEvent()), body)
  assert.equal(calls, 1)
})

test('反向验证：把条件写反，上面那组必须变红', () => {
  // 守的是「守卫本身有没有咬合」。同一段外壳，条件取反之后两态答案互换——
  // 若断言是照着源码文本写的，这里不会有任何区别。
  const inverted = (eventMaps, bodyHtml) => (eventMaps ? `<div class="scard">活动准备度${bodyHtml()}</div>` : '')
  assert.notEqual(inverted(hasEventMaps(masterWithEvent()), () => ''), '')
  assert.equal(inverted(hasEventMaps(masterWithoutEvent()), () => ''), '')
})

test('「储备目标」卡不受活动影响，两态都在', () => {
  // 用户拍板时点名的边界：隐藏的只有「活动准备度」这一张
  const zi = read('src/renderer/modules/zi.ts')
  const render = zi.slice(zi.indexOf('const render = (force = false)'))
  const aside = render.slice(render.indexOf('<aside class="side">'), render.indexOf('<div class="foot">'))
  assert.match(aside, /储备目标/)
  // 储备目标那张卡没有任何开关包着它
  assert.match(aside, /<div class="scard"><div class="h">储备目标/)
  // 活动准备度那张则一律走外壳函数
  assert.match(aside, /\$\{readinessCardHtml\(eventMapsPresent, readinessHtml\)\}/)
  assert.doesNotMatch(aside, /<div class="scard"><div class="h">活动准备度/)
})

// ---- 单一出处 ----

test('活动海域判定只有一份实现', () => {
  // 抽取之前铎/鉴/账本各写一遍同样的表达式，锱要用时本该出现第四份。
  const files = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.ts')) files.push(full.split(path.sep).join('/'))
    }
  }
  walk(path.join(root, 'src'))
  const offenders = files.filter(
    (f) => !f.endsWith('shared/event-area.ts') && /api_type === 1|api_maparea_id > 10/.test(read(path.relative(root, f))),
  )
  assert.deepEqual(offenders, [], '这些文件还在手写活动海域判定，请改引 shared/event-area.ts')
})
