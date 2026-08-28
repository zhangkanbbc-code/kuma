import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { buildSync } from 'esbuild'

import { syntheticKcwikiRequirements } from './fixtures/quest-lodes.mjs'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-kcwiki-quest-rules-'))
const output = path.join(tempDir, 'kcwiki-quest-rules.cjs')
buildSync({
  entryPoints: [fileURLToPath(new URL('../src/main/mg/kcwiki-quest-rules.ts', import.meta.url))],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'silent',
})
const require = createRequire(import.meta.url)
const rules = require(output)
const requirementsUrl = new URL('../assets/lodes/kcwiki-quest-req.json', import.meta.url)
const requirements = process.env.KANSO_TEST_FORCE_SYNTHETIC !== '1' && fs.existsSync(requirementsUrl)
  ? JSON.parse(fs.readFileSync(requirementsUrl, 'utf8')).data
  : syntheticKcwikiRequirements

test.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

const master = {
  api_mst_ship: [
    { api_id: 1, api_name: '時雨', api_stype: 2, api_soku: 10, api_sortno: 1 },
    { api_id: 2, api_name: '大和', api_stype: 9, api_ctype: 37, api_soku: 5, api_sortno: 2 },
    { api_id: 3, api_name: '大和改', api_stype: 9, api_ctype: 37, api_soku: 5, api_sortno: 3 },
    { api_id: 4, api_name: '長門', api_stype: 9, api_ctype: 19, api_soku: 5, api_sortno: 4 },
    { api_id: 5, api_name: '伊勢', api_stype: 9, api_ctype: 2, api_soku: 5, api_sortno: 5 },
    { api_id: 6, api_name: '扶桑', api_stype: 9, api_ctype: 26, api_soku: 5, api_sortno: 6 },
    { api_id: 7, api_name: '鳥海改二', api_stype: 5, api_ctype: 7, api_soku: 10, api_sortno: 7 },
    { api_id: 8, api_name: '天龍', api_stype: 3, api_ctype: 21, api_soku: 10, api_sortno: 8 },
    { api_id: 9, api_name: '古鷹', api_stype: 5, api_ctype: 11, api_soku: 10, api_sortno: 9 },
    { api_id: 11, api_name: '加古', api_stype: 5, api_ctype: 11, api_soku: 10, api_sortno: 10 },
    { api_id: 12, api_name: '青葉', api_stype: 5, api_ctype: 13, api_soku: 10, api_sortno: 11 },
    { api_id: 13, api_name: '夕張', api_stype: 3, api_ctype: 34, api_soku: 10, api_sortno: 12 },
    { api_id: 14, api_name: '衣笠', api_stype: 5, api_ctype: 13, api_soku: 10, api_sortno: 13 },
    { api_id: 15, api_name: '長門改二', api_stype: 9, api_ctype: 19, api_soku: 5, api_sortno: 14 },
    { api_id: 16, api_name: '陸奥改二', api_stype: 9, api_ctype: 19, api_soku: 5, api_sortno: 15 },
  ],
  api_mst_slotitem_equiptype: [
    { api_id: 1, api_name: '小口径主砲' },
    { api_id: 12, api_name: '小型電探' },
    { api_id: 13, api_name: '大型電探' },
  ],
  api_mst_slotitem: [
    { api_id: 10, api_name: '零式艦戦21型', api_type: [0, 0, 6, 0] },
    { api_id: 11, api_name: '九六式艦戦', api_type: [0, 0, 6, 0] },
  ],
  api_mst_useitem: [
    { api_id: 7, api_name: '開発資材' },
    { api_id: 70, api_name: '熟練搭乗員' },
    { api_id: 78, api_name: '新型航空兵装資材' },
    { api_id: 4, api_name: '勲章' },
  ],
  api_mst_mission: [
    { api_id: 37, api_disp_no: '37', api_name: '東京急行' },
    { api_id: 38, api_disp_no: '38', api_name: '東京急行(弐)' },
    { api_id: 100, api_disp_no: 'A1', api_name: '兵站強化任務' },
  ],
}

test('master-backed token maps resolve only audited ship, enemy, equipment, and mission values', () => {
  const context = rules.buildKcwikiRuleContext(master)
  assert.deepEqual(rules.resolveFriendlyShipToken(context, '駆逐'), { kind: 'stypes', ids: [2] })
  assert.deepEqual(rules.resolveFriendlyShipToken(context, '時雨'), { kind: 'ships', ids: [1] })
  assert.deepEqual(rules.resolveFriendlyShipToken(context, '高速艦'), { kind: 'speed', min: 10 })
  assert.equal(rules.resolveFriendlyShipToken(context, '不存在艦種'), null)
  assert.deepEqual(rules.resolveEnemyStypes('敵空母'), [7, 11])
  assert.equal(rules.resolveEnemyStypes('敵戦艦'), null)
  assert.deepEqual(rules.resolveEquipmentTarget(context, '小口径主砲'), { kind: 'category', ids: [1] })
  assert.deepEqual(rules.resolveEquipmentTarget(context, '電探'), { kind: 'category', ids: [12, 13] })
  assert.deepEqual(rules.resolveEquipmentTarget(context, '零式艦戦21型'), { kind: 'equip', id: 10 })
  assert.deepEqual(rules.resolveEquipmentTarget(context, '開発資材'), { kind: 'useitem', id: 7 })
  assert.equal(rules.resolveEquipmentTarget(context, '不存在装備'), null)
  assert.equal(rules.resolveMissionId(context, 'A1'), 100)
  assert.equal(rules.resolveMissionId(context, 37), 37)
  assert.equal(rules.resolveMissionId(context, 'Z9'), null)
})

test('expedition alternatives share one slot while separate objects keep separate slots', () => {
  const context = rules.buildKcwikiRuleContext(master)
  assert.deepEqual(rules.decodeKcwikiRequirement(requirements[410], context), {
    tasks: [
      { kind: 'expedition', missionId: 37, count: 1, slot: 0 },
      { kind: 'expedition', missionId: 38, count: 1, slot: 0 },
    ],
    partial: false,
  })
  assert.deepEqual(
    rules.decodeKcwikiRequirement(
      {
        category: 'expedition',
        objects: [
          { times: 1, id: 37 },
          { times: 1, id: 38 },
        ],
      },
      context,
    ),
    {
      tasks: [
        { kind: 'expedition', missionId: 37, count: 1, slot: 0 },
        { kind: 'expedition', missionId: 38, count: 1, slot: 1 },
      ],
      partial: false,
    },
  )
})

test('expedition decoder rejects an unknown mission instead of inventing an id', () => {
  const context = rules.buildKcwikiRuleContext(master)
  assert.equal(
    rules.decodeKcwikiRequirement(
      { category: 'expedition', objects: [{ times: 1, id: 'Z9' }] },
      context,
    ),
    null,
  )
})

test('sink requirements resolve only the four audited enemy type tokens', () => {
  const context = rules.buildKcwikiRuleContext(master)
  assert.deepEqual(rules.decodeKcwikiRequirement(requirements[211], context), {
    tasks: [{ kind: 'sinkEnemy', stypes: [7, 11], count: 3 }],
    partial: false,
  })
  assert.equal(
    rules.decodeKcwikiRequirement(
      { category: 'sink', ship: '敵戦艦', amount: 2 },
      context,
    ),
    null,
  )
})

test('fleet requirements decode ship classes, candidate counts, arrays, and fixed positions', () => {
  const context = rules.buildKcwikiRuleContext(master)
  assert.deepEqual(rules.decodeKcwikiRequirement(requirements[103], context), {
    tasks: [],
    partial: false,
    fleetGoal: {
      groups: [
        {
          label: '軽巡',
          ships: [],
          stypes: [3],
          amount: 1,
          flagship: true,
        },
        {
          label: '駆逐',
          ships: [],
          stypes: [2],
          amount: 3,
        },
      ],
    },
  })
  assert.deepEqual(rules.decodeKcwikiRequirement(requirements[145], context), {
    tasks: [],
    partial: false,
    fleetGoal: {
      groups: [
        {
          label: '大和级 / 長門级 / 伊勢级 / 扶桑级',
          ships: [],
          stypes: [],
          ctypes: [37, 19, 2, 26],
          amount: 3,
        },
        {
          label: '軽巡',
          ships: [],
          stypes: [3],
          amount: 1,
        },
      ],
    },
  })
  assert.deepEqual(rules.decodeKcwikiRequirement(requirements[152], context), {
    tasks: [],
    partial: false,
    fleetGoal: {
      fleetId: 1,
      groups: [
        {
          label: '鳥海改二',
          ships: [7],
          stypes: [],
          amount: 1,
          flagship: true,
        },
        {
          label: '天龍 / 古鷹 / 加古 / 青葉 / 夕張 / 衣笠',
          ships: [8, 9, 11, 12, 13, 14],
          stypes: [],
          amount: 5,
        },
      ],
    },
  })
  assert.deepEqual(rules.decodeKcwikiRequirement(requirements[158], context), {
    tasks: [],
    partial: false,
    fleetGoal: {
      groups: [
        {
          label: '長門改二',
          ships: [15],
          stypes: [],
          amount: 1,
          flagship: true,
        },
        {
          label: '陸奥改二',
          ships: [16],
          stypes: [],
          amount: 1,
          position: 2,
        },
      ],
    },
  })
  assert.deepEqual(
    rules.decodeKcwikiRequirement(
      {
        category: 'fleet',
        groups: [
          { ship: '時雨' },
          { ship: '駆逐', amount: [0, 1] },
        ],
      },
      context,
    ),
    {
      tasks: [],
      partial: false,
      fleetGoal: {
        groups: [
          {
            label: '時雨',
            ships: [1],
            stypes: [],
            amount: 1,
          },
          {
            label: '駆逐',
            ships: [],
            stypes: [2],
            amount: 0,
            maxAmount: 1,
          },
        ],
      },
    },
  )
})

test('fleet goal evaluation returns per-group differences instead of a bare boolean', () => {
  const context = rules.buildKcwikiRuleContext(master)
  const decoded = rules.decodeKcwikiRequirement(requirements[103], context)
  const wrongFlagship = rules.evaluateFleetGoal(decoded.fleetGoal, [
    { mstId: 10, stype: 5, soku: 10, lv: 80 },
    { mstId: 11, stype: 2, soku: 10, lv: 50 },
    { mstId: 12, stype: 2, soku: 10, lv: 50 },
    { mstId: 13, stype: 2, soku: 10, lv: 50 },
  ], 1)
  assert.deepEqual(wrongFlagship, {
    deckId: 1,
    ok: false,
    lines: [
      {
        label: '軽巡',
        current: 0,
        required: 1,
        ok: false,
        issue: '旗舰不符合「軽巡」',
      },
      {
        label: '駆逐',
        current: 3,
        required: 3,
        ok: true,
        issue: null,
      },
    ],
  })

  const satisfied = rules.evaluateFleetGoal(decoded.fleetGoal, [
    { mstId: 20, stype: 3, soku: 10, lv: 80 },
    { mstId: 11, stype: 2, soku: 10, lv: 50 },
    { mstId: 12, stype: 2, soku: 10, lv: 50 },
    { mstId: 13, stype: 2, soku: 10, lv: 50 },
  ], 1)
  assert.equal(satisfied.ok, true)
  assert.equal(satisfied.lines.every((line) => line.ok), true)
})

test('「合計N隻以下」编码(任意组+他の艦禁止):以下是上限,4 隻合规编成要通过', () => {
  // By2「海防艦3隻を含む5隻以下」— kcwiki 编码为 海防艦×3 + 艦×2 + 他の艦禁止。
  // 2026-08-12 用户实锤:任意组被当成下限,3 海防 + 1 任意舰(共 4 隻)的合规
  // 编成被「其它舰 0」误杀;而真正的「总数≤5」反而没人管,6 海防也能过。
  const context = rules.buildKcwikiRuleContext(master)
  const decoded = rules.decodeKcwikiRequirement(
    {
      category: 'sortie',
      map: '1-5',
      times: 1,
      boss: true,
      result: 'S',
      groups: [
        { ship: '海防艦', amount: 3 },
        { ship: '艦', amount: 2 },
      ],
      disallowed: '他の艦',
    },
    context,
  )
  const goal = decoded.fleetGoal
  assert.equal(goal.maxShips, 5)
  assert.deepEqual(goal.groups.map((group) => [group.label, group.amount]), [['海防艦', 3]])
  assert.equal(goal.allowOnlyGoalShips, undefined)
  const kaibo = () => ({ mstId: 901, stype: 1, soku: 5, lv: 50 })
  const other = () => ({ mstId: 902, stype: 2, soku: 10, lv: 50 })
  assert.equal(rules.evaluateFleetGoal(goal, [kaibo(), kaibo(), kaibo(), other()], 1).ok, true,
    '3 海防 + 1 任意舰 = 4 隻,在 5 隻以下,应通过')
  assert.equal(rules.evaluateFleetGoal(goal, [kaibo(), kaibo(), kaibo()], 1).ok, true,
    '只带 3 海防也是 5 隻以下')
  assert.equal(rules.evaluateFleetGoal(goal, [kaibo(), kaibo(), kaibo(), other(), other()], 1).ok, true)
  assert.equal(
    rules.evaluateFleetGoal(goal, [kaibo(), kaibo(), kaibo(), other(), other(), other()], 1).ok,
    false,
    '6 隻超过「5 隻以下」',
  )
  assert.equal(
    rules.evaluateFleetGoal(goal, Array.from({ length: 6 }, kaibo), 1).ok,
    false,
    '全海防但 6 隻同样超上限',
  )
  assert.equal(rules.evaluateFleetGoal(goal, [kaibo(), kaibo(), other()], 1).ok, false, '海防不足 3')
})

test('a flagship group still counts every matching ship toward its amount', () => {
  const goal = {
    groups: [{
      label: '駆逐',
      ships: [],
      stypes: [2],
      amount: 4,
      flagship: true,
    }],
  }
  const fleet = Array.from({ length: 4 }, (_, index) => ({
    mstId: 100 + index,
    stype: 2,
    soku: 10,
    lv: 50,
  }))
  const result = rules.evaluateFleetGoal(goal, fleet, 1)
  assert.equal(result.ok, true)
  assert.deepEqual(result.lines[0], {
    label: '駆逐',
    current: 4,
    required: 4,
    ok: true,
    issue: null,
  })
})

test('sortie requirements: range pools into one slot, array keeps per-map slots, boss rank preserved', () => {
  const context = rules.buildKcwikiRuleContext(master)
  // 范围写法 = 任意图凑数(池计数,或):共享一槽
  assert.deepEqual(rules.decodeKcwikiRequirement(requirements[226], context), {
    tasks: [
      { kind: 'bossKill', map: [2, 1], rank: 4, count: 5, slot: 0 },
      { kind: 'bossKill', map: [2, 2], rank: 4, count: 5, slot: 0 },
      { kind: 'bossKill', map: [2, 3], rank: 4, count: 5, slot: 0 },
      { kind: 'bossKill', map: [2, 4], rank: 4, count: 5, slot: 0 },
      { kind: 'bossKill', map: [2, 5], rank: 4, count: 5, slot: 0 },
    ],
    partial: false,
  })
  // 数组写法 = 逐图各 times 次(且):每图一槽。2026-08-12 前一律 slot:0,
  // 905 这类「四图各一次」被并成「打任意一图就算满」,是会误导的错。
  assert.deepEqual(
    rules.decodeKcwikiRequirement(
      { category: 'sortie', map: ['1-1', '1-2'], boss: true, result: 'S', times: 2 },
      context,
    ),
    {
      tasks: [
        { kind: 'bossKill', map: [1, 1], rank: 6, count: 2, slot: 0 },
        { kind: 'bossKill', map: [1, 2], rank: 6, count: 2, slot: 1 },
      ],
      partial: false,
    },
  )
})

test('sortie decoder refuses event maps and maps clear to the existing first-clear task', () => {
  const context = rules.buildKcwikiRuleContext(master)
  assert.equal(
    rules.decodeKcwikiRequirement(
      { category: 'sortie', map: '44-1', boss: true, result: 'S', times: 1 },
      context,
    ),
    null,
  )
  // 1-6 是护航图:「クリア」= 到达终点(罗盘事件 8),每次都算——写成海域首通
  // 的话已通关提督永远计不了数(2026-08-12 用户实锤:By2 到 N 没 +1)
  assert.deepEqual(
    rules.decodeKcwikiRequirement(
      { category: 'sortie', map: '1-6', result: 'クリア', times: 1 },
      context,
    ),
    {
      tasks: [{ kind: 'mapGoal', map: [1, 6], count: 1, slot: 0 }],
      partial: false,
    },
  )
  // 有 Boss 的图「クリア」仍是海域首通,口径不动
  assert.deepEqual(
    rules.decodeKcwikiRequirement(
      { category: 'sortie', map: '1-5', result: 'クリア', times: 1 },
      context,
    ),
    {
      tasks: [{ kind: 'mapFirstClear', map: [1, 5], count: 1, slot: 0 }],
      partial: false,
    },
  )
})

test('factory requirements keep scrap counters and concrete stock thresholds together', () => {
  const context = rules.buildKcwikiRuleContext(master)
  assert.deepEqual(
    rules.decodeKcwikiRequirement(
      {
        category: 'equipexchange',
        scraps: [{ name: '小口径主砲', amount: 3 }],
        equipments: [{ name: '零式艦戦21型', amount: 2 }],
        resources: [0, 0, 300, 0],
        consumptions: [{ name: '開発資材', amount: 1 }],
      },
      context,
    ),
    {
      tasks: [{ kind: 'scrapCategory', category: 1, count: 3, slot: 0 }],
      stockGoals: [
        { kind: 'equip', id: 10, label: '零式艦戦21型', count: 2 },
        { kind: 'material', id: 2, label: '钢材', count: 300 },
        { kind: 'useitem', id: 7, label: '開発資材', count: 1 },
      ],
      partial: false,
    },
  )
  assert.deepEqual(
    rules.decodeKcwikiRequirement(requirements[673], context),
    {
      tasks: [{ kind: 'scrapCategory', category: 1, count: 4, slot: 0 }],
      partial: false,
    },
  )
})

test('factory decoder refuses unknown equipment instead of leaving a partial tracker', () => {
  const context = rules.buildKcwikiRuleContext(master)
  assert.equal(
    rules.decodeKcwikiRequirement(
      {
        category: 'equipexchange',
        scraps: [{ name: '不存在装備', amount: 1 }],
        resources: [0, 0, 300, 0],
      },
      context,
    ),
    null,
  )
})

test('equipment exchanges keep useitems as stock gates wherever the old schema placed them', () => {
  const context = rules.buildKcwikiRuleContext(master)
  assert.deepEqual(
    rules.decodeKcwikiRequirement(
      {
        category: 'equipexchange',
        scraps: [
          { name: '零式艦戦21型', amount: 1 },
          { name: '開発資材', amount: 3 },
        ],
        equipments: [
          { name: '熟練搭乗員', amount: 1 },
          { name: '新型航空兵装資材', amount: 2 },
        ],
      },
      context,
    ),
    {
      tasks: [{ kind: 'scrapEquip', equipId: 10, count: 1, slot: 0 }],
      stockGoals: [
        { kind: 'useitem', id: 7, label: '開発資材', count: 3 },
        { kind: 'useitem', id: 70, label: '熟練搭乗員', count: 1 },
        { kind: 'useitem', id: 78, label: '新型航空兵装資材', count: 2 },
      ],
      partial: false,
    },
  )
})

test('a-gou decodes into four independently observable stages', () => {
  const context = rules.buildKcwikiRuleContext(master)
  assert.deepEqual(rules.decodeKcwikiRequirement(requirements[214], context), {
    tasks: [
      { kind: 'action', action: 'sortie', label: '出击', count: 36, slot: 0 },
      { kind: 'bossReach', count: 24, slot: 1 },
      { kind: 'bossWin', rank: 4, count: 12, slot: 2 },
      { kind: 'battleWin', rank: 6, count: 6, slot: 3 },
    ],
    partial: false,
    // 没有活动海图的平时：四轴都精确，不打 ≈
    approx: false,
  })
  assert.equal(
    rules.decodeKcwikiRequirement({ category: 'then', list: [] }, context),
    null,
  )
  assert.equal(
    rules.decodeKcwikiRequirement({ category: 'modelconversion' }, context),
    null,
  )
})

test('a-gou is marked approximate while an event map exists', () => {
  // 多血条活动海域里只有**最终血条**的 boss 格算进あ号，中间血条的 boss 格在报文里
  // 同样是 api_event_id==5，从 API 分不出来（「イベあ号問題」，KancolleSniffer /
  // ElectronicObserver 的 FAQ 都写明修不了）。分不出来就别装精确：活动期一律标 ≈。
  const eventMaster = {
    ...master,
    api_mst_maparea: [
      ...(master.api_mst_maparea ?? []),
      { api_id: 62, api_name: '期間限定海域', api_type: 1 },
    ],
    api_mst_mapinfo: [
      ...(master.api_mst_mapinfo ?? []),
      { api_id: 624, api_maparea_id: 62, api_no: 4, api_name: '' },
    ],
  }
  const eventContext = rules.buildKcwikiRuleContext(eventMaster)
  assert.equal(eventContext.eventRunning, true, '主数据里有活动海图就该判活动进行中')
  assert.equal(
    rules.decodeKcwikiRequirement(requirements[214], eventContext).approx,
    true,
    '活动期的あ号必须标 ≈',
  )
  // 平时不打这个标：本地计数在常规图上是精确的（2026-08-12 的交付实测正好计满）
  assert.equal(
    rules.buildKcwikiRuleContext(master).eventRunning,
    false,
  )
})

test('simple requirements map only the four audited subcategories onto existing counters', () => {
  const context = rules.buildKcwikiRuleContext(master)
  assert.deepEqual(
    rules.decodeKcwikiRequirement(
      { category: 'simple', subcategory: 'battle', times: 10 },
      context,
    ),
    {
      tasks: [{ kind: 'battleWin', rank: 0, count: 10 }],
      partial: false,
    },
  )
  assert.deepEqual(
    rules.decodeKcwikiRequirement(
      { category: 'simple', subcategory: 'resupply', times: 1 },
      context,
    ),
    {
      tasks: [{ kind: 'action', action: 'charge', label: '补给', count: 1 }],
      partial: false,
    },
  )
  assert.deepEqual(
    rules.decodeKcwikiRequirement(
      { category: 'simple', subcategory: 'repair', times: 2 },
      context,
    ),
    {
      tasks: [{ kind: 'action', action: 'nyukyo', label: '入渠', count: 2 }],
      partial: false,
    },
  )
  assert.deepEqual(
    rules.decodeKcwikiRequirement(
      {
        category: 'simple',
        subcategory: 'scrapequipment',
        times: 24,
        batch: false,
      },
      context,
    ),
    {
      tasks: [{ kind: 'action', action: 'destroyitem', label: '废弃装备', count: 24 }],
      partial: false,
    },
  )
  // batch:true（624/625/634/635 那一族，正文写「N 个 / N 件」）＝一括廃棄可＝按件计。
  // 上游 kcwiki-quest-data 的 types/index.ts 把 batch 注为「scrapping together is ok」。
  assert.deepEqual(
    rules.decodeKcwikiRequirement(
      {
        category: 'simple',
        subcategory: 'scrapequipment',
        times: 7,
        batch: true,
      },
      context,
    ),
    {
      tasks: [{ kind: 'action', action: 'destroyitem', label: '废弃装备', count: 7, perItem: true }],
      partial: false,
    },
  )
  // 解体走 kcwiki 结构化层，不再穿透到中文散文兜底（603/609 上游本来就给了 scrapship）。
  assert.deepEqual(
    rules.decodeKcwikiRequirement(
      { category: 'simple', subcategory: 'scrapship', times: 2 },
      context,
    ),
    {
      tasks: [{ kind: 'action', action: 'destroyship', label: '解体舰船', count: 2 }],
      partial: false,
    },
  )
  assert.equal(
    rules.decodeKcwikiRequirement(
      { category: 'simple', subcategory: 'unknown', times: 1 },
      context,
    ),
    null,
  )
})

test('and requirements keep every child in an independent progress slot', () => {
  const context = rules.buildKcwikiRuleContext(master)
  assert.deepEqual(
    rules.decodeKcwikiRequirement(
      {
        category: 'and',
        list: [
          { category: 'sortie', map: '2-2', boss: true, result: 'S', times: 1 },
          { category: 'sortie', map: '2-3', boss: true, result: 'S', times: 1 },
        ],
      },
      context,
    ),
    {
      tasks: [
        { kind: 'bossKill', map: [2, 2], rank: 6, count: 1, slot: 0 },
        { kind: 'bossKill', map: [2, 3], rank: 6, count: 1, slot: 1 },
      ],
      partial: false,
    },
  )
})

test('or requirements share one slot while retaining each alternative fleet gate', () => {
  const context = rules.buildKcwikiRuleContext(master)
  assert.deepEqual(
    rules.decodeKcwikiRequirement(
      {
        category: 'or',
        list: [
          {
            category: 'sortie',
            map: '1-1',
            boss: true,
            result: 'S',
            times: 1,
            groups: [{ ship: '時雨', flagship: true }],
          },
          {
            category: 'sortie',
            map: '1-2',
            boss: true,
            result: 'S',
            times: 1,
            groups: [{ ship: '大和', flagship: true }],
          },
        ],
      },
      context,
    ),
    {
      tasks: [
        {
          kind: 'bossKill',
          map: [1, 1],
          rank: 6,
          count: 1,
          slot: 0,
          fleetGoal: {
            groups: [{
              label: '時雨',
              ships: [1],
              stypes: [],
              amount: 1,
              flagship: true,
            }],
          },
        },
        {
          kind: 'bossKill',
          map: [1, 2],
          rank: 6,
          count: 1,
          slot: 0,
          fleetGoal: {
            groups: [{
              label: '大和',
              ships: [2],
              stypes: [],
              amount: 1,
              flagship: true,
            }],
          },
        },
      ],
      partial: false,
    },
  )
})

test('then requirements count both observable stages but remain partial and bounded', () => {
  const context = rules.buildKcwikiRuleContext(master)
  assert.deepEqual(
    rules.decodeKcwikiRequirement(
      {
        category: 'then',
        list: [
          {
            category: 'excercise',
            times: 3,
            victory: true,
            groups: [{ ship: '時雨' }],
          },
          {
            category: 'sortie',
            map: '2-2',
            boss: true,
            result: 'A',
            times: 1,
            groups: [{ ship: '時雨' }],
          },
        ],
      },
      context,
    ),
    {
      tasks: [
        { kind: 'exercise', rank: 4, count: 3, slot: 0 },
        { kind: 'bossKill', map: [2, 2], rank: 5, count: 1, slot: 1 },
      ],
      fleetGoal: {
        groups: [{
          label: '時雨',
          ships: [1],
          stypes: [],
          amount: 1,
        }],
      },
      partial: true,
    },
  )
  assert.equal(
    rules.decodeKcwikiRequirement(
      {
        category: 'and',
        list: [
          {
            category: 'and',
            list: [
              { category: 'simple', subcategory: 'battle', times: 1 },
              { category: 'simple', subcategory: 'battle', times: 1 },
            ],
          },
        ],
      },
      context,
    ),
    null,
  )
  assert.equal(
    rules.decodeKcwikiRequirement(
      {
        category: 'and',
        list: [
          { category: 'simple', subcategory: 'battle', times: 1 },
          { category: 'unknown' },
        ],
      },
      context,
    ),
    null,
  )
})

test('model conversions separate the secretary equipment gate from scrap counters and stock', () => {
  const context = rules.buildKcwikiRuleContext(master)
  assert.deepEqual(
    rules.decodeKcwikiRequirement(
      {
        category: 'modelconversion',
        secretary: '時雨',
        equipment: '零式艦戦21型',
        fullyskilled: true,
        maxmodified: true,
        scraps: [
          { name: '零式艦戦21型', amount: 2 },
          { name: '九六式艦戦', amount: 1 },
        ],
        consumptions: [{ name: '勲章', amount: 2 }],
        resources: [0, 0, 900, 0],
      },
      context,
    ),
    {
      tasks: [
        { kind: 'scrapEquip', equipId: 10, count: 2, slot: 0 },
        { kind: 'scrapEquip', equipId: 11, count: 1, slot: 1 },
      ],
      stateGoal: {
        secretary: {
          label: '時雨',
          ships: [1],
          stypes: [],
        },
        equipment: [{
          label: '零式艦戦21型',
          mstIds: [10],
          fullySkilled: true,
          maxModified: true,
        }],
      },
      stockGoals: [
        { kind: 'material', id: 2, label: '钢材', count: 900 },
        { kind: 'useitem', id: 4, label: '勲章', count: 2 },
      ],
      partial: false,
    },
  )
})

test('model conversion slots stay one-based and any secretary never becomes a fake ship token', () => {
  const context = rules.buildKcwikiRuleContext(master)
  assert.deepEqual(
    rules.decodeKcwikiRequirement(
      {
        category: 'modelconversion',
        secretary: '艦',
        slots: [{
          slot: 1,
          equipment: '零式艦戦21型',
          fullyskilled: true,
        }],
        use_skilled_crew: true,
      },
      context,
    ),
    {
      tasks: [],
      stateGoal: {
        secretary: {
          label: '任意舰',
          ships: 'any',
          stypes: [],
        },
        equipment: [{
          label: '零式艦戦21型',
          mstIds: [10],
          slot: 1,
          fullySkilled: true,
        }],
      },
      partial: true,
    },
  )
})

// map 的两种写法语义不同(2026-08-12 用户报出 905 的四图 Boss 胜被并成「或」):
// 数组 = 逐图各 times 次(且,每图一槽);范围字符串 = 任意图凑 times 次(或,共享一槽)。
// 236 的 EO 独立编码逐图分槽,与数组语义交叉印证;范围写法实存仅 226/229/241 全是周常池计数。
test('多图出击:数组逐图分槽(且),范围字符串共享一槽(或)', () => {
  const context = rules.buildKcwikiRuleContext(master)
  // 905「海防艦」、海を護る!:1-6 首通 + 1-1/1-2/1-3/1-5 各 Boss S 一次
  const dock = rules.decodeKcwikiRequirement(requirements[905], context)
  assert.ok(dock, '905 必须能解码')
  const bossTasks = dock.tasks.filter((task) => task.kind === 'bossKill')
  assert.equal(bossTasks.length, 4)
  assert.equal(new Set(bossTasks.map((task) => task.slot)).size, 4, '四图 Boss 胜各占一槽,不是「或」')
  const clearTask = dock.tasks.find((task) => task.kind === 'mapGoal')
  assert.ok(clearTask, '1-6 到达终点任务在（护航图不按首通计）')
  assert.ok(!bossTasks.some((task) => task.slot === clearTask.slot), '终点到达与 Boss 胜不共槽')
  // 226 Bd7:2-1 ~ 2-5 任意图 Boss B 胜凑 5 次——池计数,共享一槽
  const pooled = rules.decodeKcwikiRequirement(requirements[226], context)
  assert.ok(pooled, '226 必须能解码')
  const pooledBoss = pooled.tasks.filter((task) => task.kind === 'bossKill')
  assert.equal(pooledBoss.length, 5)
  assert.equal(new Set(pooledBoss.map((task) => task.slot)).size, 1, '范围写法共享一槽')
  assert.ok(pooledBoss.every((task) => task.count === 5))
})


// 具名舰形态口径(2026-08-18 用户两轮实锤定谳):
// ① 素名(链根,「時雨」)=任意形态——B61 队里的時雨改二必须算数;
// ② 写明形态(「白露改」)=只认写明的。「写改则改二也算」的结构规则被用户
//   否掉,全量对账坐实:103 条结构展开只有 11 条有 wiki 文本背书。
//   wiki 显式列举的追加形态(「白露改二」/「摩耶改二可」)按任务文本补入,
//   最长匹配扫描保证「黑潮改二」不给「潮改」组背书「潮改二」。
test('具名舰:素名整链、写明形态按字面,文本列举才补形态', () => {
  const chainMaster = {
    api_mst_ship: [
      { api_id: 101, api_name: '白露', api_stype: 2, api_soku: 10, api_sortno: 1, api_aftershipid: '102' },
      { api_id: 102, api_name: '白露改', api_stype: 2, api_soku: 10, api_sortno: 2, api_aftershipid: '103' },
      { api_id: 103, api_name: '白露改二', api_stype: 2, api_soku: 10, api_sortno: 3, api_aftershipid: '0' },
      { api_id: 111, api_name: '時雨', api_stype: 2, api_soku: 10, api_sortno: 4, api_aftershipid: '112' },
      { api_id: 112, api_name: '時雨改', api_stype: 2, api_soku: 10, api_sortno: 5, api_aftershipid: '113' },
      { api_id: 113, api_name: '時雨改二', api_stype: 2, api_soku: 10, api_sortno: 6, api_aftershipid: '114' },
      { api_id: 114, api_name: '時雨改三', api_stype: 2, api_soku: 10, api_sortno: 7, api_aftershipid: '0' },
      // 可逆环(与真实主数据同构):改二⇄改二丁
      { api_id: 200, api_name: '朝潮', api_stype: 2, api_soku: 10, api_sortno: 8, api_aftershipid: '201' },
      { api_id: 201, api_name: '朝潮改二', api_stype: 2, api_soku: 10, api_sortno: 9, api_aftershipid: '202' },
      { api_id: 202, api_name: '朝潮改二丁', api_stype: 2, api_soku: 10, api_sortno: 10, api_aftershipid: '201' },
      // 名字互为子串的两条链:潮 与 黑潮(最长匹配扫描的守卫对象)
      { api_id: 401, api_name: '潮改', api_stype: 2, api_soku: 10, api_sortno: 11, api_aftershipid: '402' },
      { api_id: 402, api_name: '潮改二', api_stype: 2, api_soku: 10, api_sortno: 12, api_aftershipid: '0' },
      { api_id: 411, api_name: '黒潮改', api_stype: 2, api_soku: 10, api_sortno: 13, api_aftershipid: '412' },
      { api_id: 412, api_name: '黒潮改二', api_stype: 2, api_soku: 10, api_sortno: 14, api_aftershipid: '0' },
    ],
    api_mst_shipupgrade: [],
  }
  const context = rules.buildKcwikiRuleContext(chainMaster)
  // 素名(链根):整链任意形态,可逆环成员也在链里
  assert.deepEqual(
    rules.resolveFriendlyShipToken(context, '時雨'),
    { kind: 'ships', ids: [111, 112, 113, 114] },
  )
  assert.deepEqual(
    rules.resolveFriendlyShipToken(context, '朝潮'),
    { kind: 'ships', ids: [200, 201, 202] },
  )
  // 写明形态:只认写明的——不做「及之后」的结构推断
  assert.deepEqual(rules.resolveFriendlyShipToken(context, '白露改'), { kind: 'ships', ids: [102] })
  assert.deepEqual(rules.resolveFriendlyShipToken(context, '朝潮改二'), { kind: 'ships', ids: [201] })
  assert.deepEqual(rules.resolveFriendlyShipToken(context, '朝潮改二丁'), { kind: 'ships', ids: [202] })

  // 文本列举补形态:B61 式「「白露改」/「白露改二」为旗舰、「时雨」…」
  const draft = {
    fleetGoal: {
      groups: [
        { label: '白露改', ships: [102], stypes: [], amount: 1, flagship: true },
        { label: '時雨', ships: [111, 112, 113, 114], stypes: [], amount: 1 },
        { label: '潮改', ships: [401], stypes: [], amount: 1 },
      ],
    },
    stateGoal: { secretary: { label: '白露改', ships: [102], stypes: [] } },
  }
  rules.augmentShipGroupsFromQuestText(
    draft,
    context,
    '「白露改」/「白露改二」为旗舰、「时雨」与黑潮改二一起出击',
    new Map([[103, '白露改二'], [402, '潮改二'], [412, '黑潮改二']]),
  )
  assert.deepEqual(draft.fleetGoal.groups[0].ships, [102, 103], '文本列举的白露改二补进旗舰组')
  assert.deepEqual(draft.fleetGoal.groups[1].ships, [111, 112, 113, 114], '素名组不受影响')
  assert.deepEqual(
    draft.fleetGoal.groups[2].ships,
    [401],
    '「黑潮改二」是另一条链的名字,最长匹配下不给「潮改」组背书「潮改二」',
  )
  assert.deepEqual(draft.stateGoal.secretary.ships, [102, 103], '秘书舰组同样按文本补')

  // 端到端:补完后 白露改二旗舰+時雨改三 全部通过
  const diff = rules.evaluateFleetGoal(
    { groups: draft.fleetGoal.groups.slice(0, 2) },
    [
      { mstId: 103, stype: 2, ctype: 1, soku: 10, lv: 90 },
      { mstId: 114, stype: 2, ctype: 1, soku: 10, lv: 90 },
    ],
    1,
  )
  assert.ok(diff.lines.every((line) => line.ok), '白露改二旗舰+時雨改三应当全部通过')

  // 没有文本就不补:写明形态保持字面
  const bare = {
    fleetGoal: { groups: [{ label: '白露改', ships: [102], stypes: [], amount: 1 }] },
  }
  rules.augmentShipGroupsFromQuestText(bare, context, '', new Map())
  assert.deepEqual(bare.fleetGoal.groups[0].ships, [102])
})
