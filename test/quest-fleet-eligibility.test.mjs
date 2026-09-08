import assert from 'node:assert/strict'
import test from 'node:test'
import eligibility from '../dist/shared/quest-fleet-eligibility.js'

const { sortieEligibleDecks } = eligibility
const decks = () => [1, 2, 3, 4].map((id) => ({ id, ships: [1, 2, 3, 4, 5, 6, -1, 0] }))

test('常规六舰编成保留四队，空舰位不计入七舰', () => {
  const input = decks()
  const before = structuredClone(input)
  assert.deepEqual(sortieEligibleDecks(input, 0), [1, 2, 3, 4])
  assert.deepEqual(input, before)
})

test('任意正联合标记剔除第一、第二舰队，使用舰队 id 而非数组位置', () => {
  for (const flag of [1, 2, 3]) {
    assert.deepEqual(sortieEligibleDecks(decks().reverse(), flag), [4, 3])
  }
})

test('第三舰队七舰剔除第三队，判据也覆盖其它队与超过七舰', () => {
  const input = decks()
  input[2].ships.push(7)
  assert.deepEqual(sortieEligibleDecks(input, 0), [1, 2, 4])
  input[3].ships.push(7, 8)
  assert.deepEqual(sortieEligibleDecks(input, 0), [1, 2])
})

test('联合舰队与第三队七舰叠加，只保留第四舰队', () => {
  const input = decks()
  input[2].ships.push(7)
  assert.deepEqual(sortieEligibleDecks(input, 1), [4])
})
