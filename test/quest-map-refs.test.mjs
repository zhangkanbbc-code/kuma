import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { questMapRefs, questsInvolvingMap, setQuestMapState } from './fixtures/render-quest-map-refs.mjs'

const mapIds = [11, 14, 15, 23, 51]
const mapNameIndex = [{ id: 11, name: '镇守府正面海域', simple: '镇守府正面海域', aliases: ['镇守府正面海域'] }]
const quest = (id, code, desc, extra = {}) => ({ id, code, name: '', desc, memo: '', memo2: '', pre: [], ...extra })
const bossKill = (map) => ({ kind: 'bossKill', map, rank: 2, count: 1 })

beforeEach(() => setQuestMapState({ mapIds, mapNameIndex }))

test('出击任务正文中的多个海域码升序返回', () => {
  assert.deepEqual(questMapRefs(quest(1, 'B1', '突入（2-3）、5-1'), undefined), [23, 51])
})

test('远征任务正文提到海域码不算涉及海域', () => {
  assert.deepEqual(questMapRefs(quest(1, 'D1', '突入（2-3）、5-1'), undefined), [])
})

test('正文没有海域码时仍读取追踪器的结构化地图', () => {
  assert.deepEqual(questMapRefs(quest(1, 'B1', '击败敌方旗舰'), { tasks: [bossKill([1, 5])] }), [15])
})

test('正文、海域名与结构化地图都过滤主数据里不存在的编号', () => {
  setQuestMapState({ mapIds, mapNameIndex: [...mapNameIndex, { id: 99, name: '测试海域', simple: '测试海域', aliases: ['测试海域'] }] })
  assert.deepEqual(questMapRefs(quest(1, 'B1', '9-9 测试海域'), { tasks: [bossKill([9, 9])] }), [])
})

test('出击任务正文只写海域名也能命中', () => {
  assert.deepEqual(questMapRefs(quest(1, 'B1', '前往镇守府正面海域'), undefined), [11])
})

test('反查桩库只返回涉及目标海域的任务，追踪器尚未加载也能运行', () => {
  const quests = [quest(1, 'B1', '突入2-3'), quest(2, 'D1', '突入2-3'), quest(3, 'B2', '突入1-4')]
  setQuestMapState({ mapIds, mapNameIndex, quests, qp: null })
  assert.deepEqual(questsInvolvingMap(23), [quests[0]])
})

test('任务名、补充正文与编成条件标签共同参与反查，去重并升序', () => {
  const row = quest(1, 'C1', '5-1', { name: '出击2-3', memo2: '前往1-4' })
  const tracker = { fleetGoal: { groups: [{ label: '镇守府正面海域 2-3' }] }, tasks: [bossKill([1, 5]), bossKill([2, 3])] }
  assert.deepEqual(questMapRefs(row, tracker), [11, 14, 15, 23, 51])
})

test('工厂正文与奖励文本不参与海域反查，结构化地图不受正文类别限制', () => {
  assert.deepEqual(questMapRefs(quest(1, 'F1', '镇守府正面海域 2-3'), undefined), [])
  assert.deepEqual(questMapRefs(quest(2, 'B1', '', { memo: '奖励：2-3' }), undefined), [])
  assert.deepEqual(questMapRefs(quest(3, 'D1', '2-3'), { tasks: [bossKill([1, 5])] }), [15])
})

test('海域码沿用全角归一与六种破折号写法', () => {
  for (const dash of ['-', '‐', '‑', '‒', '–', '—']) {
    assert.deepEqual(questMapRefs(quest(1, 'B1', `２ ${dash} ３`), undefined), [23])
  }
})

test('反查逐条读取对应追踪器，并保留海域名匹配', () => {
  const quests = [quest(1, 'B1', ''), quest(2, 'B2', '镇守府正面海域'), quest(3, 'B3', '')]
  setQuestMapState({ mapIds, mapNameIndex, quests, qp: { trackers: { 1: { tasks: [bossKill([1, 5])] }, 3: { tasks: [bossKill([2, 3])] } } } })
  assert.deepEqual(questsInvolvingMap(15), [quests[0]])
  assert.deepEqual(questsInvolvingMap(11), [quests[1]])
  assert.deepEqual(questsInvolvingMap(23), [quests[2]])
  assert.deepEqual(questsInvolvingMap(99), [])
})

test('抽屉保留海域名命中范围与过滤前集合，反查仍只返回有效编号', () => {
  let hits
  let refs
  const row = quest(1, 'B1', '前往镇守府正面海域')
  const result = questMapRefs(row, { tasks: [bossKill([99, 1])] }, (mapHits, mapRefs) => {
    hits = mapHits
    refs = mapRefs
  })
  assert.deepEqual(result, [11])
  assert.deepEqual([...refs], [11, 991])
  assert.equal(hits.length, 1)
  assert.equal(hits[0].entry.id, 11)
  assert.equal(hits[0].alias, '镇守府正面海域')
  assert.equal(hits[0].start, 2)
  assert.equal(hits[0].length, 7)
  questMapRefs(quest(2, 'D1', row.desc), undefined, (mapHits, mapRefs) => {
    assert.deepEqual(mapHits, [])
    assert.deepEqual([...mapRefs], [])
  })
})
