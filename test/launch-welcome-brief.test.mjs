// 开幕「上次退出」快照简报（维护者定稿 2026-11-26，交接包「拓展风格开幕」方案一、三）。
// 科技控制台与机甲舱门在游戏还没加载完时，就把上次退出前的资源、远征、入渠、任务摆出来。
// 摘要只取这几样白名单字段，存在配置里；不含提督昵称与提督编号，没有数据就给 null 不编数字。
import assert from 'node:assert/strict'
import test from 'node:test'

import brief from '../dist/shared/launch-welcome-brief.js'

const { welcomeBriefOf, WELCOME_BRIEF_CONFIG_KEY } = brief
const now = Date.parse('2026-11-26T01:00:00+09:00')
const NICK = '测试提督昵称'
const MEMBER = '87654321'
const player = () => ({
  basic: { memberId: MEMBER, nickname: NICK, level: 120, rank: 3, maxShips: 320, maxSlotitems: 1600 },
  materials: [123456, 234567, 98765, 45678, 3000, 1234, 2500, 800],
  ships: Object.fromEntries(Array.from({ length: 300 }, (_, i) => [i + 1, { id: i + 1, shipId: i === 0 ? 80 : 1 }])),
  decks: [
    { id: 1, mission: [0, 0, 0, 0], ships: [] },
    { id: 2, mission: [1, 5, now + 600000, 0], ships: [] },
    { id: 3, mission: [0, 0, 0, 0], ships: [] },
    { id: 4, mission: [2, 21, now - 60000, 0], ships: [] },
  ],
  ndocks: [{ id: 1, shipId: 1, completeTime: now + 3600000, state: 1 }, { id: 2, shipId: 0, completeTime: 0, state: 0 }],
  quests: { 1: { no: 201, state: 2 }, 2: { no: 202, state: 3 }, 3: { no: 203, state: 1 } },
})
const nameOf = (mstId) => ({ 80: '长门' })[mstId] ?? `#${mstId}`

test('配置键固定；缺提督信息或资源时给 null，不编数字', () => {
  assert.equal(WELCOME_BRIEF_CONFIG_KEY, 'kuma.launchWelcomeBrief.v1')
  assert.equal(welcomeBriefOf({ ...player(), basic: null }, now, nameOf), null)
  assert.equal(welcomeBriefOf({ ...player(), materials: null }, now, nameOf), null)
})

test('摘要取上次退出前的资源、水桶、船位、远征、入渠与现役任务', () => {
  const b = welcomeBriefOf(player(), now, nameOf)
  assert.equal(b.savedAt, now)
  assert.equal(b.admiralLevel, 120)
  assert.equal(b.admiralRank, 3)
  assert.deepEqual(b.materials, [123456, 234567, 98765, 45678])
  assert.equal(b.buckets, 1234)
  assert.deepEqual(b.ships, [300, 320])
  assert.deepEqual(b.expeditions, [{ fleet: 2, missionId: 5, returnAt: now + 600000 }, { fleet: 4, missionId: 21, returnAt: now - 60000 }])
  assert.deepEqual(b.ndocks, [{ dock: 1, shipName: '长门', completeAt: now + 3600000 }])
  assert.equal(b.activeQuests, 2)
})

test('只存白名单字段，不含提督昵称与提督编号', () => {
  const b = welcomeBriefOf(player(), now, nameOf)
  const allowed = ['savedAt', 'admiralLevel', 'admiralRank', 'materials', 'buckets', 'ships', 'expeditions', 'ndocks', 'activeQuests', 'senka']
  for (const key of Object.keys(b)) assert.ok(allowed.includes(key), `多出字段 ${key}`)
  const text = JSON.stringify(b)
  assert.ok(!text.includes(NICK), '不该存昵称')
  assert.ok(!text.includes(MEMBER), '不该存提督编号')
})
