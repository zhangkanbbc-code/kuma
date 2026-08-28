import assert from 'node:assert/strict'
import test from 'node:test'

import { mourningShipsOf, newSunkEntries } from '../dist/shared/sortie-mourning.js'

const at = { cell: 12, battleNo: 3, ts: 1_700_000_000_000 }

const ship = (over = {}) => ({
  rosterId: 501,
  mstId: 200,
  name: '睦月',
  lv: 42,
  sunk: false,
  ...over,
})

test('沉没名单只收真沉了的我方在籍舰', () => {
  const fresh = newSunkEntries(
    {
      practice: false,
      fShips: [
        ship({ rosterId: 501, sunk: true }),
        ship({ rosterId: 502, name: '如月', sunk: false }),
        // 敌方/NPC 没有在籍 id：收不进在籍名单，也就落不到编队卡上
        ship({ rosterId: null, name: '友军', sunk: true }),
      ],
    },
    [],
    at,
  )
  assert.deepEqual(fresh, [
    { rosterId: 501, mstId: 200, name: '睦月', lv: 42, cell: 12, battleNo: 3, ts: at.ts },
  ])
})

test('演习整场不入名单——那里的「击沉」只是 HP 打到 1 的胜负判定', () => {
  assert.deepEqual(
    newSunkEntries({ practice: true, fShips: [ship({ sunk: true })] }, [], at),
    [],
  )
})

test('已经在名单里的不重复收，同一份报文里出现两次也只收一条', () => {
  // 同一场昼夜战会解析两遍、夜战合并后还要再走一次——重复收就会连发多条击沉通知
  assert.deepEqual(
    newSunkEntries({ practice: false, fShips: [ship({ sunk: true })] }, [{ rosterId: 501 }], at),
    [],
  )
  const twice = newSunkEntries(
    { practice: false, fShips: [ship({ sunk: true }), ship({ sunk: true })] },
    [],
    at,
  )
  assert.equal(twice.length, 1)
})

test('没有战斗就没有名单增量', () => {
  assert.deepEqual(newSunkEntries(null, [], at), [])
  assert.deepEqual(newSunkEntries(undefined, [], at), [])
})

const sunkEntry = { rosterId: 501, mstId: 200, name: '睦月', lv: 42, cell: 12, battleNo: 3, ts: at.ts }

test('哀悼态可从状态推导：同一份出击算多少次都是同一个答案', () => {
  const sortie = { active: true, practice: false, sunkShips: [sunkEntry] }
  assert.deepEqual(mourningShipsOf(sortie), [sunkEntry])
  assert.deepEqual(mourningShipsOf(sortie), mourningShipsOf(sortie))
  // 没沉人就不哀悼
  assert.deepEqual(mourningShipsOf({ active: true, practice: false, sunkShips: [] }), [])
})

test('返港即解除：active 落下的那一刻名单就不再生效', () => {
  // store 在 api_port/port 把 active 置 false。哀悼态没有单独的「解除」动作，
  // 也就没有「忘了解除」这条路——名单还留着（供复盘），但推导结果是空。
  const returned = { active: false, practice: false, sunkShips: [sunkEntry] }
  assert.deepEqual(mourningShipsOf(returned), [])
})

test('演习与缺失出击都不哀悼', () => {
  assert.deepEqual(mourningShipsOf({ active: true, practice: true, sunkShips: [sunkEntry] }), [])
  assert.deepEqual(mourningShipsOf(null), [])
  assert.deepEqual(mourningShipsOf(undefined), [])
  // 老快照没有这个字段：当成空，不是崩
  assert.deepEqual(mourningShipsOf({ active: true, practice: false, sunkShips: undefined }), [])
})
