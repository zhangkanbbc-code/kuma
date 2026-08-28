import assert from 'node:assert/strict'
import test from 'node:test'

import { parsePoiQuestGoalCson } from '../scripts/lib/poi-quest-goal.mjs'

test('poi quest CSON becomes bounded inert JSON without executing CoffeeScript', () => {
  const parsed = parsePoiQuestGoalCson(`
###
this: is ignored block-comment text
###
218: # sinking example
  type: 1
  "sinking":
    description: "敵補給艦 # not a comment"
    shipType: [15]
    required: 3
    init: 0
437:
  type: 105
  fuzzy: true
  "mission_success@対潜警戒任務":
    description: "4"
    mission: [
      '対潜警戒任務'
      '小笠原沖哨戒線'
    ]
    required: 1
    init: 0
657:
  type: 109
  "destory_item@小口径主砲":
    slotitemType2: [
      1,
      2
    ]
    required: 6
    init: 0
`)

  assert.deepEqual(parsed, {
    218: {
      type: 1,
      sinking: {
        description: '敵補給艦 # not a comment',
        shipType: [15],
        required: 3,
        init: 0,
      },
    },
    437: {
      type: 105,
      fuzzy: true,
      'mission_success@対潜警戒任務': {
        description: '4',
        mission: ['対潜警戒任務', '小笠原沖哨戒線'],
        required: 1,
        init: 0,
      },
    },
    657: {
      type: 109,
      'destory_item@小口径主砲': {
        slotitemType2: [1, 2],
        required: 6,
        init: 0,
      },
    },
  })
})

test('poi quest CSON refuses duplicate ids and unsupported executable values', () => {
  assert.throws(
    () => parsePoiQuestGoalCson(`201:
  type: 1
201:
  type: 2
`),
    /duplicate key 201/,
  )
  assert.throws(
    () => parsePoiQuestGoalCson(`201:
  type: require("fs")
`),
    /unsupported value/,
  )
})
