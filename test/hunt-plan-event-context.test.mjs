// 捞船单子的「本期活动」组不许只信矿脉包的字面量（2026-08-25）。
//
// 病灶：`huntPlanHtml` 里 `sites.some((s) => s.event?.status === 'active')`。
// 那个 `status: 'active'` 是**落包那一刻**写死进 map-intel 包的字符串，活动结束了
// 它也不会自己变成 'ended'。玩家不更新包，单子就一直把那批船挂在「当前活动图可捞」
// 底下、还打上上期活动的名字——等于天天催他去打一张已经不存在的图。
//
// 主数据是一手的交叉证据（活动图从 api_mst_mapinfo 里撤掉了就是活动关了），
// 判据落在 shared/event-area.ts 的 eventContextStillOpen，所以三态可以**真跑**，
// 不是对着源码文本猜（共享记忆 source-pattern-guards-miss-logic-bugs）。
// 渲染那一层脱不开 Electron，退回最小结构断言，只钉活动已关时剔除对应掉点。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import eventArea from '../dist/shared/event-area.js'

const { eventContextStillOpen } = eventArea
const ji = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
const hasIn = (source, re, message) => assert.ok(re.test(source), message)

const NORMAL_AREAS = [1, 2, 3, 4, 5, 6, 7].map((id) => ({ api_id: id, api_name: `${id}区`, api_type: 0 }))
const NORMAL_MAPS = [
  { api_id: 11, api_maparea_id: 1, api_no: 1 },
  { api_id: 75, api_maparea_id: 7, api_no: 5 },
]
const EVENT_AREA = { api_id: 62, api_name: '期間限定海域', api_type: 1 }
const EVENT_MAPS = [
  { api_id: 621, api_maparea_id: 62, api_no: 1 },
  { api_id: 623, api_maparea_id: 62, api_no: 3 },
]

const masterDuringEvent = () => ({
  api_mst_maparea: [...NORMAL_AREAS, EVENT_AREA],
  api_mst_mapinfo: [...NORMAL_MAPS, ...EVENT_MAPS],
})
const masterAfterEvent = () => ({
  api_mst_maparea: [...NORMAL_AREAS],
  api_mst_mapinfo: [...NORMAL_MAPS],
})

// ---- 三态判据（真跑）----

test('包说 active + 主数据里有活动图 ⇒ 语境成立，照旧算本期活动', () => {
  assert.equal(eventContextStillOpen(masterDuringEvent()), true)
})

test('包说 active + 主数据确认没有活动图 ⇒ 语境不成立，该换语境了', () => {
  assert.equal(eventContextStillOpen(masterAfterEvent()), false)
})

test('主数据不可用 ⇒ 维持包的说法，不许把 null 当「无活动」', () => {
  // 这一条是整个判据的要害，也是最容易写错的一处：
  // hasEventMaps(null) 自己返回 false，图省事直接拿它当判据，
  // 就等于在「从没跑过游戏」的机器上凭空宣布活动已经结束。
  assert.equal(eventContextStillOpen(null), true)
  assert.equal(eventContextStillOpen(undefined), true)
  // 反向对照：确实拿到了主数据、里面确实没有活动图，那才是 false。
  // 两者都返回 false 的话这条判据就是废的，所以要一起断言。
  assert.equal(eventContextStillOpen(masterAfterEvent()), false)
})

// ---- 消费端接线（结构级）----

test('捞船单子拿主数据复核过才把船归进「本期活动」组', () => {
  hasIn(
    ji,
    /const packSaysEvent = catchable\.filter\(\(e\) => e\.sites\.some\(\(s\) => s\.event\?\.status === 'active'\)\)/,
    '包的说法没有单独取出来',
  )
  hasIn(ji, /const eventOpen = eventStillRunning\(\)/, '「本期活动」组没跟主数据对口供')
  hasIn(
    ji,
    /const inEvent = \(eventOpen \? packSaysEvent : \[\]\)/,
    '主数据说活动结束了，inEvent 还是照收——玩家会被催去打一张不存在的图',
  )
  // 判据来自共享出口，别在这儿再手搓第四份（event-area.ts 头注的老规矩）
  hasIn(ji, /eventContextStillOpen/, 'eventStillRunning 没有走 shared 的判据')
})

test('活动结束后从捞船单子剔除活动掉点', () => {
  // 用户 2026-09-15 新裁决：先收敛 sites；整舰若仍有常规图掉点，会随剩余 sites 继续归组。
  hasIn(
    ji,
    /const sites = confirmedDropSitesOf\(id\)\.filter\(\(site\) => eventOpen \|\| site\.event\?\.status !== 'active'\)/,
    '活动已关的掉点没有从 catchable 条目的 sites 中剔除',
  )
})

test('活动关闭时整舰只剩活动掉点就撤走，另有常规图掉点则保留且计数', () => {
  const renderer = fs.readFileSync(new URL('../dist/renderer/index.js', import.meta.url), 'utf8')
  const from = renderer.indexOf('var huntPlanHtml =')
  const to = renderer.indexOf('var shipCatalogRowHtml', from)
  assert.ok(from >= 0 && to > from, '编译产物里找不到 huntPlanHtml')
  const makePlan = new Function(
    'chainOf',
    'chainInstances',
    'fmtDate',
    'eventStillRunning',
    'confirmedDropSitesOf',
    'shipThumbHtml',
    'masterShipName',
    'elink',
    'isFavoriteShipRoot',
    'esc2',
    'shipState',
    'HUNT_SOON_DAYS',
    'HUNT_STANDING_CAP',
    `${renderer.slice(from, to)}\nreturn huntPlanHtml`,
  )
  const eventSite = {
    map: 'E-1', difficulty: '甲', nodes: ['A'], limited: false, limitedUntil: null,
    event: { status: 'active', name: '测试活动' },
  }
  const regularSite = {
    map: '1-1', difficulty: null, nodes: ['B'], limited: false, limitedUntil: null,
  }
  const sites = new Map([
    [101, [eventSite]],
    [102, [eventSite, regularSite]],
    [103, []],
  ])
  const huntPlanHtml = makePlan(
    new Map([[101, null], [102, null], [103, null]]),
    () => [],
    () => '2026-09-15',
    () => false,
    (id) => sites.get(id) ?? [],
    () => '',
    (id) => `测试舰${id}`,
    (_kind, _id, name) => name,
    () => false,
    String,
    { huntFilter: null },
    30,
    15,
  )
  const html = huntPlanHtml()
  assert.ok(!html.includes('测试舰101'), '只剩已关闭活动掉点的舰仍在单子里')
  assert.ok(html.includes('测试舰102'), '另有常规图掉点的舰被误撤了')
  assert.ok(!html.includes('测试舰103'), '没有当前掉点的舰仍在单子里')
  assert.ok(html.includes('1-1 B') && !html.includes('E-1'), '混合条目没有按过滤后的常规掉点渲染')
  assert.match(html, /data-hunt-filter="catchable"[^>]*>1<\/button> 艘/, 'catchable 计数没有跟着收敛')
})
