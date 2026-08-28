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
// 渲染那一层脱不开 Electron，退回结构断言，钉的是「换语境，不是删条目」。
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

test('活动结束只换语境、不删条目', () => {
  hasIn(
    ji,
    /const eventClosed = \(eventOpen \? \[\] : packSaysEvent\)/,
    '活动结束后那批船不见了——口径是「永不删除，只换语境」',
  )
  // rest 按「包说过 active 没有」分，两组加起来必须是 catchable 全集：
  // 写成 !inEvent.includes(e) 的话，活动结束时那批船会同时落进 rest，
  // 于是既进「已结束」组又混进「常驻确认可捞」，一船两列。
  hasIn(
    ji,
    /const rest = catchable\.filter\(\(e\) => !packSaysEvent\.includes\(e\)\)/,
    'rest 的补集取错了组，活动结束的船会同时出现在两个分组里',
  )
  // 已结束那组要真的渲出来，否则「不删除」只是嘴上说说
  hasIn(ji, /eventClosed\.length[\s\S]{0,240}eventClosed\.map\(rowOf\)/, '已结束那组没有渲染')
})

test('已结束那组的措辞如实说捞不到，且不再打「当前活动图」的旗号', () => {
  const header = ji.match(/eventClosed\.length\s*\?\s*`<div class="hunt-h">([^<]*)</)
  assert.ok(header, '取不到已结束那组的组名')
  assert.ok(
    !header[1].includes('当前活动'),
    '已结束的组还叫「当前活动」——那正是这次要修掉的谎',
  )
  hasIn(header[1], /捞不到|结束/, '组名没说清这批现在捞不到')
  // 「当前活动图可捞」这句只许挂在 inEvent 上
  hasIn(
    ji,
    /inEvent\.length\s*\?\s*`<div class="hunt-h urgent">当前活动图可捞/,
    '「当前活动图可捞」的抬头挂到别的组上了',
  )
})
