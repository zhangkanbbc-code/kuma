// 战后奖励：结算包里「捞到舰娘」之外的三类奖励（维护者裁决 2026-11-25）。
//   · 节点道具掉落（api_get_useitem，秋刀鱼这类）——并进「捞到」那一行，
//     「本轮掉落」卡按点位列出，卡头计数写成「N 舰 · 道具名 ×M」；
//   · EO 海域击破奖励（api_get_exmap_useitem_id）——结果条一枚「击破奖励」芯片；
//   · 活动海域攻略奖励（api_get_eventitem / api_select_reward_dict）——结果条「攻略奖励」芯片，
//     自选奖励每组一枚「自选」芯片，候选用「 / 」隔开。
// 只做显示，不改道具持有数的记账（那一层另有口径）。
//
// 真报文取自 test/fixtures/battle-result-coverage.json（账本本身不入仓）：
//   result-useitem-drop        2026-11-25 秋刀鱼祭 1-4，api_useitem_name 是空串、没有数量字段
//   result-exmap-useitem       2026-11-03 EO 击破，api_get_exmap_useitem_id 是字符串 "57"
//   result-event-reward-choice 2026-08-26 夏活最终攻略：道具 / 舰娘 / 两组自选（道具、装备）
//   result-event-reward-ship   2026-08-27 夏活最终攻略：只有一位舰娘
// api_type 的含义按真报文 id 对主数据核过：1＝道具、2＝舰娘、3＝装备、7＝自选（api_id 是字典键）。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { battleRewardsReader as battleRewardsOf } from './fixtures/store-battle-rewards.mjs'
import { beginSortie, feedBattleResult, reset, sortie } from './fixtures/store-battle-result.mjs'
import {
  battleOf,
  renderDropCard,
  renderDropChip,
  renderResultStrip,
  sortieOf,
} from './fixtures/render-di-battle.mjs'
import restore from '../dist/shared/sortie-restore.js'

const { restoreSortieAcrossRestart } = restore

const resultFixtures = JSON.parse(
  fs.readFileSync(new URL('./fixtures/battle-result-coverage.json', import.meta.url), 'utf8'),
)
const pick = (name) => {
  const found = resultFixtures.find((one) => one.name === name)
  assert.ok(found, `fixture 里没有 ${name}`)
  return structuredClone(found.body)
}
const plain = (value) => JSON.parse(JSON.stringify(value))
const flat = (html) => html.replace(/\s+/g, ' ')
// 道具名在图鉴链接里（维护者裁决 2026-11-25 道具可点），「名字 ×数量」按去掉标签后的可见文字比
const text = (html) => html.replace(/<[^>]+>/g, '')
const NONE = { drops: [], exmap: [], event: [], choices: [] }

// ---- 读取器 ----

test('读取器存在：store.ts 战果包字段读取器那一段里有 battleRewardsOf', () => {
  assert.equal(typeof battleRewardsOf, 'function')
})

test('真报文：秋刀鱼掉落记成一件道具，名字不靠报文（报文里是空串）', () => {
  assert.deepEqual(plain(battleRewardsOf(pick('result-useitem-drop'))), {
    ...NONE,
    drops: [{ kind: 'useitem', id: 68, count: 1 }],
  })
})

test('道具掉落带了数量字段就照数，没有才按一件', () => {
  assert.deepEqual(
    plain(battleRewardsOf({ api_get_useitem: { api_useitem_id: 68, api_useitem_count: 2 } })).drops,
    [{ kind: 'useitem', id: 68, count: 2 }],
  )
})

test('真报文：EO 击破奖励是字符串编号，转数后记一件', () => {
  assert.deepEqual(plain(battleRewardsOf(pick('result-exmap-useitem'))), {
    ...NONE,
    exmap: [{ kind: 'useitem', id: 57, count: 1 }],
  })
})

test('真报文：活动攻略奖励按类型分道具 / 舰娘，自选按字典分组、按 api_item_no 分选项', () => {
  assert.deepEqual(plain(battleRewardsOf(pick('result-event-reward-choice'))), {
    ...NONE,
    event: [
      { kind: 'useitem', id: 105, count: 4 },
      { kind: 'useitem', id: 78, count: 1 },
      { kind: 'ship', id: 1051, count: 1 },
    ],
    // 组的顺序跟 api_get_eventitem 里类型 7 出现的顺序（421 在前、422 在后）；
    // api_slot_level 语义未确认，原值保留在装备上，不解释。
    choices: [
      [[{ kind: 'useitem', id: 105, count: 1 }], [{ kind: 'useitem', id: 57, count: 1 }]],
      [[{ kind: 'slotitem', id: 582, count: 1, level: 1 }], [{ kind: 'slotitem', id: 497, count: 1, level: 1 }]],
    ],
  })
})

test('真报文：只赠一位舰娘的攻略奖励', () => {
  assert.deepEqual(plain(battleRewardsOf(pick('result-event-reward-ship'))), {
    ...NONE,
    event: [{ kind: 'ship', id: 1055, count: 1 }],
  })
})

test('认不出的类型原样留着（kind unknown + 原 type），字典里查不到的自选也一样', () => {
  assert.deepEqual(
    plain(battleRewardsOf({
      api_get_eventitem: [
        { api_type: 9, api_id: 5, api_value: 2 },
        { api_type: 7, api_id: 999, api_value: 1 },
      ],
      api_select_reward_dict: {},
    })).event,
    [
      { kind: 'unknown', type: 9, id: 5, count: 2 },
      { kind: 'unknown', type: 7, id: 999, count: 1 },
    ],
  )
})

test('什么奖励都没有就给 null：0、"0"、空对象、null 都算没有', () => {
  assert.equal(battleRewardsOf({}), null)
  assert.equal(
    battleRewardsOf({
      api_get_useitem: null,
      api_get_exmap_useitem_id: 0,
      api_get_eventitem: null,
    }),
    null,
  )
  assert.equal(battleRewardsOf({ api_get_exmap_useitem_id: '0' }), null)
  assert.equal(battleRewardsOf({ api_get_useitem: { api_useitem_id: 0, api_useitem_name: '' } }), null)
  assert.equal(battleRewardsOf({ api_get_useitem: { api_useitem_id: -1 } }), null)
  assert.equal(battleRewardsOf({ api_get_eventitem: [] }), null)
})

// ---- 归约：战果与本轮掉落 ----

const resetSortie = () =>
  reset({ ships: [], battleShips: [] })

test('结算挂上 rewards；道具掉落按当前点位进本轮道具掉落，舰娘掉落照旧', () => {
  resetSortie()
  feedBattleResult(pick('result-useitem-drop'), 1_000)
  assert.deepEqual(plain(sortie().battle.result.rewards), {
    ...NONE,
    drops: [{ kind: 'useitem', id: 68, count: 1 }],
  })
  assert.deepEqual(plain(sortie().itemDrops), [{ cell: 1, id: 68, count: 1 }])
  assert.deepEqual(plain(sortie().drops), [{ cell: 1, mstId: 33, name: '叢雲' }])

  sortie().currentCell = 12
  feedBattleResult({ api_win_rank: 'A', api_get_useitem: { api_useitem_id: 68, api_useitem_count: 2 } }, 2_000)
  assert.deepEqual(plain(sortie().itemDrops), [
    { cell: 1, id: 68, count: 1 },
    { cell: 12, id: 68, count: 2 },
  ])
})

test('没有奖励的场次不写 rewards 键，本轮道具掉落不动', () => {
  resetSortie()
  feedBattleResult({ api_win_rank: 'B' }, 1_000)
  assert.equal('rewards' in sortie().battle.result, false)
  assert.deepEqual(plain(sortie().itemDrops), [])
})

test('击破奖励与攻略奖励只挂在这一战的结算上，不进本轮掉落', () => {
  resetSortie()
  feedBattleResult(pick('result-exmap-useitem'), 1_000)
  assert.deepEqual(plain(sortie().battle.result.rewards.exmap), [{ kind: 'useitem', id: 57, count: 1 }])
  feedBattleResult(pick('result-event-reward-choice'), 2_000)
  assert.equal(sortie().battle.result.rewards.event.length, 3)
  assert.deepEqual(plain(sortie().itemDrops), [])
})

test('新一轮出击从空的道具掉落开始；旧快照缺这一格时按空数组回灌', () => {
  assert.deepEqual(plain(beginSortie({ currentCell: 1 }).itemDrops), [])
  assert.deepEqual(plain(restoreSortieAcrossRestart({ active: true, drops: [] }).itemDrops), [])
  const kept = [{ cell: 3, id: 68, count: 1 }]
  assert.deepEqual(plain(restoreSortieAcrossRestart({ active: true, drops: [], itemDrops: kept }).itemDrops), kept)
})

// ---- 显示 ----

const resultOf = (patch = {}) => ({
  rank: 'S',
  mvp: -1,
  mvpCombined: -1,
  baseExp: 140,
  dropShipMstId: null,
  dropShipName: null,
  firstClear: false,
  ...patch,
})
const sanmaDrop = { ...NONE, drops: [{ kind: 'useitem', id: 68, count: 1 }] }

test('「捞到」一行：舰娘在前、道具在后，用「·」隔开；一件不写 ×1', () => {
  const b = battleOf({ result: resultOf({ dropShipMstId: 33, dropShipName: '叢雲', rewards: sanmaDrop }) })
  const html = flat(renderDropChip(sortieOf({ battle: b }), b))
  assert.match(html, /捞到/)
  const ship = html.indexOf('叢雲')
  const item = html.indexOf('秋刀魚')
  assert.ok(ship >= 0 && item > ship, `舰娘在前、道具在后：${html}`)
  assert.match(html.slice(ship, item), /·/)
  assert.doesNotMatch(html, /×1\b/)
})

test('「捞到」一行：没捞到舰娘时只出道具；两件写 ×2；什么都没有就不出', () => {
  const itemOnly = battleOf({
    result: resultOf({ rewards: { ...NONE, drops: [{ kind: 'useitem', id: 68, count: 2 }] } }),
  })
  const html = flat(renderDropChip(sortieOf({ battle: itemOnly }), itemOnly))
  assert.match(html, /捞到/)
  assert.match(html, /秋刀魚/)
  assert.match(html, /×2/)
  assert.doesNotMatch(html, /ship-thumb/)

  const none = battleOf({ result: resultOf() })
  assert.equal(renderDropChip(sortieOf({ battle: none }), none), '')
})

test('结果条：EO 击破奖励一枚「击破奖励」芯片', () => {
  const html = flat(renderResultStrip(battleOf({
    result: resultOf({ firstClear: true, rewards: { ...NONE, exmap: [{ kind: 'useitem', id: 57, count: 1 }] } }),
  })))
  assert.match(html, /击破奖励[\s\S]*勲章/)
  assert.doesNotMatch(html, /攻略奖励|自选/)
})

test('结果条：攻略奖励列道具 / 舰娘，自选每组一枚、候选用「 / 」隔开', () => {
  const html = flat(renderResultStrip(battleOf({
    result: resultOf({
      firstClear: true,
      rewards: {
        ...NONE,
        event: [
          { kind: 'useitem', id: 105, count: 4 },
          { kind: 'useitem', id: 78, count: 1 },
          { kind: 'ship', id: 1051, count: 1 },
        ],
        choices: [
          [[{ kind: 'useitem', id: 105, count: 1 }], [{ kind: 'useitem', id: 57, count: 1 }]],
          [[{ kind: 'slotitem', id: 582, count: 1, level: 1 }], [{ kind: 'slotitem', id: 497, count: 1, level: 1 }]],
        ],
      },
    }),
  })))
  assert.match(html, /攻略奖励/)
  assert.match(text(html), /格納庫増設 ×4/)
  assert.match(html, /戦闘詳報/)
  assert.doesNotMatch(html, /戦闘詳報 ×1/)
  assert.match(html, /Algérie/)
  assert.equal(html.split('自选').length - 1, 2, `自选应为两组：${html}`)
  assert.match(html, /自选[\s\S]*格納庫増設[\s\S]* \/ [\s\S]*勲章/)
  assert.match(html, /自选[\s\S]*20\.3cm\/50 連装砲 Modèle 1931[\s\S]* \/ /)
  // 装备上的 api_slot_level 语义未确认，不显示成改修星
  assert.doesNotMatch(html, /★/)
  assert.doesNotMatch(html, /击破奖励/)
})

test('结果条：认不出的奖励写编号，不丢', () => {
  const html = flat(renderResultStrip(battleOf({
    result: resultOf({ rewards: { ...NONE, event: [{ kind: 'unknown', type: 9, id: 5, count: 2 }] } }),
  })))
  assert.match(html, /攻略奖励[\s\S]*#5/)
})

test('结果条：没有奖励时三种芯片都不出', () => {
  const html = renderResultStrip(battleOf({ result: resultOf() }))
  assert.doesNotMatch(html, /击破奖励|攻略奖励|自选/)
})

test('本轮掉落卡：道具按点位合并成行，卡头写「N 舰 · 道具名 ×合计」，点位筛选含道具点', () => {
  const html = flat(renderDropCard(sortieOf({
    drops: [{ cell: 3, mstId: 33, name: '叢雲' }],
    itemDrops: [
      { cell: 3, id: 68, count: 1 },
      { cell: 10, id: 68, count: 1 },
      { cell: 10, id: 68, count: 1 },
    ],
  })))
  assert.match(text(html), /1\/1 舰 · 秋刀魚 ×3/)
  assert.match(html, /3 点：[\s\S]*叢雲/)
  assert.match(text(html), /3 点：(?:(?!点：)[\s\S])*秋刀魚(?!\s*×)/)
  assert.match(text(html), /10 点：(?:(?!点：)[\s\S])*秋刀魚 ×2/)
  assert.match(html, /data-drop-cell="10"/)
})

test('本轮掉落卡：只有道具掉落时也出卡，不再写「暂无舰娘掉落」', () => {
  const html = flat(renderDropCard(sortieOf({ drops: [], itemDrops: [{ cell: 5, id: 68, count: 1 }] })))
  assert.match(html, /本轮掉落/)
  assert.match(html, /5 点：[\s\S]*秋刀魚/)
  assert.doesNotMatch(html, /暂无舰娘掉落/)
})

test('本轮掉落卡：舰娘与道具都没有、也还没结算时不出卡', () => {
  assert.equal(renderDropCard(sortieOf({ drops: [], itemDrops: [] })), '')
})
