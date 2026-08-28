import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { buildSync } from 'esbuild'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-poi-quest-rules-'))
const output = path.join(tempDir, 'poi-quest-rules.cjs')
buildSync({
  entryPoints: [fileURLToPath(new URL('../src/main/mg/poi-quest-rules.ts', import.meta.url))],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'silent',
})
const require = createRequire(import.meta.url)
const rules = require(output)

test.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

const context = rules.buildPoiQuestContext(
  {
    api_mst_mission: [
      { api_id: 37, api_disp_no: '37', api_name: '東京急行' },
      { api_id: 100, api_disp_no: 'A1', api_name: '兵站強化任務' },
    ],
  },
  {
    37: { id: '37', nameJp: '東京急行', nameZh: '东京急行' },
    A1: { id: 'A1', nameJp: '兵站強化任務', nameZh: '兵站强化任务' },
  },
)

test('poi flat goals map battle, sinking, mission, factory, and practice counters', () => {
  assert.deepEqual(
    rules.decodePoiQuestGoal(
      {
        type: 1,
        battle_boss_win_rank_a: { maparea: [21, 22], required: 5, init: 0 },
      },
      context,
    ),
    {
      tasks: [
        { kind: 'bossKill', map: [2, 1], rank: 5, count: 5, slot: 0 },
        { kind: 'bossKill', map: [2, 2], rank: 5, count: 5, slot: 0 },
      ],
      partial: false,
    },
  )
  assert.deepEqual(
    rules.decodePoiQuestGoal(
      {
        type: 1,
        sinking: { shipType: [7, 11], required: 3, init: 0 },
      },
      context,
    ),
    {
      tasks: [{ kind: 'sinkEnemy', stypes: [7, 11], count: 3, slot: 0 }],
      partial: false,
    },
  )
  assert.deepEqual(
    rules.decodePoiQuestGoal(
      {
        type: 1,
        mission_success: {
          mission: ['東京急行', '兵站強化任務'],
          required: 2,
          init: 0,
        },
      },
      context,
    ),
    {
      tasks: [
        { kind: 'expedition', missionId: 37, count: 2, slot: 0 },
        { kind: 'expedition', missionId: 100, count: 2, slot: 0 },
      ],
      partial: false,
    },
  )
  assert.deepEqual(
    rules.decodePoiQuestGoal(
      {
        type: 1,
        destory_item: { slotitemType2: [1, 2], required: 4, init: 0 },
      },
      context,
    ),
    {
      tasks: [
        { kind: 'scrapCategory', category: 1, count: 4, slot: 0 },
        { kind: 'scrapCategory', category: 2, count: 4, slot: 0 },
      ],
      partial: false,
    },
  )
  assert.deepEqual(
    rules.decodePoiQuestGoal(
      {
        type: 1,
        practice_win_s: { required: 4, init: 1 },
      },
      context,
    ),
    {
      tasks: [{ kind: 'exercise', rank: 6, count: 3, slot: 0 }],
      partial: false,
    },
  )
})

test('poi rules admit only cross-checked mission and scrap @ compounds', () => {
  assert.deepEqual(
    rules.decodePoiQuestGoal(
      {
        type: 108,
        fuzzy: true,
        'mission_success@A1': {
          mission: ['A1'],
          required: 1,
          init: 0,
        },
      },
      context,
    ),
    null,
  )
  assert.deepEqual(
    rules.decodePoiQuestGoal(
      {
        type: 108,
        fuzzy: true,
        'mission_success@兵站強化任務': {
          mission: ['兵站強化任務'],
          required: 1,
          init: 0,
        },
        'mission_success@東京急行': {
          mission: ['東京急行'],
          required: 1,
          init: 0,
        },
      },
      context,
    ),
    {
      tasks: [
        { kind: 'expedition', missionId: 100, count: 1, slot: 0 },
        { kind: 'expedition', missionId: 37, count: 1, slot: 1 },
      ],
      partial: false,
    },
  )
})

test('poi rules still skip unknown missions, fuzzy map syntax, and hidden fleet constraints', () => {
  assert.equal(
    rules.decodePoiQuestGoal(
      {
        type: 1,
        mission_success: {
          mission: ['不存在遠征'],
          required: 1,
          init: 0,
        },
      },
      context,
    ),
    null,
  )
  assert.equal(
    rules.decodePoiQuestGoal(
      {
        type: 1,
        practice_win_s: {
          flagship: ['時雨'],
          required: 4,
          init: 0,
        },
      },
      context,
    ),
    null,
  )
  assert.equal(
    rules.decodePoiQuestGoal(
      {
        type: 1,
        fuzzy: true,
        'battle_boss_win_rank_s@722': {
          maparea: [72],
          mapcell: [15],
          required: 1,
          init: 0,
        },
      },
      context,
    ),
    null,
  )
})
