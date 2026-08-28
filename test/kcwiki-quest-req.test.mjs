import assert from 'node:assert/strict'
import test from 'node:test'

import { parseKcwikiQuestRequirements } from '../scripts/lib/kcwiki-quest-req.mjs'

test('kcwiki quest records collapse to one requirements object per game id', () => {
  assert.deepEqual(
    parseKcwikiQuestRequirements([
      {
        game_id: 410,
        name: '南方への輸送作戦を成功させよ！',
        requirements: {
          category: 'expedition',
          objects: [{ times: 1, id: [37, 38] }],
        },
      },
      {
        game_id: 211,
        requirements: { category: 'sink', ship: '敵空母', amount: 3 },
      },
    ]),
    {
      211: { category: 'sink', ship: '敵空母', amount: 3 },
      410: {
        category: 'expedition',
        objects: [{ times: 1, id: [37, 38] }],
      },
    },
  )
})

test('kcwiki quest collapse refuses missing requirements and duplicate ids', () => {
  assert.throws(
    () => parseKcwikiQuestRequirements([{ game_id: 410 }]),
    /requirements/,
  )
  assert.throws(
    () => parseKcwikiQuestRequirements([
      { game_id: 410, requirements: { category: 'expedition' } },
      { game_id: 410, requirements: { category: 'sortie' } },
    ]),
    /duplicate quest id 410/,
  )
})
