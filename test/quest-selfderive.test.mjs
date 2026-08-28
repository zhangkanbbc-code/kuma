// 任务计数自研的行为护栏。
//
// 纪律（shared/source-pattern-guards-miss-logic-bugs）：这里的断言全部跑真解析器对真数据，
// 不拿正则去匹配源码文本——判断写反了源码文本照样匹配得上。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { userDataPath, userDataPathIfAny } from '../scripts/lib/data-dir.mjs'

import { build } from 'esbuild'

import { fleetLocalization, fleetMaster } from './fixtures/quest-fleet-master.mjs'
import { histFleetLocalization, histFleetMaster } from './fixtures/quest-hist-fleet-master.mjs'
import { expeditionPack, missionMaster } from './fixtures/quest-mission-master.mjs'
import { scrapLocalization, scrapMaster } from './fixtures/quest-scrap-master.mjs'
import { sortieMaster } from './fixtures/quest-sortie-master.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-quest-selfderive-'))

const bundleModule = async (relative, name) => {
  const outfile = path.join(tempDir, `${name}.cjs`)
  await build({
    entryPoints: [path.join(root, relative)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  })
  return { module: require(outfile), code: fs.readFileSync(outfile, 'utf8') }
}

const readLode = (id) => {
  const file = path.join(root, 'assets', 'lodes', `${id}.json`)
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
}

// 全部打包在注册任何用例**之前**做完：test.after 会在最后一个已注册用例跑完时触发，
// 顶层 await 一让出控制权它就把临时目录删了，后面的 require 找不到文件。
const engineBundle = await bundleModule('src/main/mg/quest-counter.ts', 'quest-counter')
const nodes = (await bundleModule('src/main/mg/quest-map-nodes.ts', 'quest-map-nodes')).module
const scrap = (await bundleModule('src/main/mg/quest-scrap-rules.ts', 'quest-scrap-rules')).module
const scrapCtx = scrap.buildScrapRuleContext(scrapMaster, scrapLocalization)
const conflicts = (await bundleModule('src/main/mg/quest-source-conflicts.ts', 'quest-source-conflicts')).module
const histFleets = (await bundleModule('src/shared/hist-fleets.ts', 'hist-fleets')).module
const practice = (await bundleModule('src/main/mg/quest-practice-rules.ts', 'quest-practice-rules')).module
const mission = (await bundleModule('src/main/mg/quest-mission-rules.ts', 'quest-mission-rules')).module
const missionCtx = mission.buildMissionRuleContext(missionMaster, expeditionPack)
const sortie = (await bundleModule('src/main/mg/quest-sortie-rules.ts', 'quest-sortie-rules')).module
const fleet = (await bundleModule('src/main/mg/quest-fleet-rules.ts', 'quest-fleet-rules')).module
const fleetCtx = fleet.buildFleetRuleContext(fleetMaster, fleetLocalization)
// 队名那一族**另起一份上下文**：注册表记的是游戏真实 mstId，与 quest-fleet-master
// 那套自造 id 对不上（见 quest-hist-fleet-master 文件头）
const histCtx = fleet.buildFleetRuleContext(histFleetMaster, histFleetLocalization)
const kcwiki = (await bundleModule('src/main/mg/kcwiki-quest-rules.ts', 'kcwiki-quest-rules')).module
const questPack = readLode('quests-scn')
const fcdPack = readLode('poi-fcd-map')
const fcd = fcdPack?.data ?? null
// 带点位的那一半要靠 poi-fcd 算边号；没有包时只有纯海域那一半解得出来
const sortieCtx = sortie.buildSortieRuleContext(sortieMaster, fcd)

test.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

// 引擎装载会打一串规则源就绪/跳过的日志；用例只看行为，压掉噪音。
const quiet = (fn) => {
  const log = console.log
  const warn = console.warn
  console.log = () => {}
  console.warn = () => {}
  try {
    return fn()
  } finally {
    console.log = log
    console.warn = warn
  }
}

// ---- 引擎脱 Electron ----

test('计数引擎不带 Electron 就能装配跑起来（离线回放/对账的前提）', () => {
  // 打包这一步本身就是第一道断言：引擎若还 import electron，bundle 会把它拽进来。
  assert.doesNotMatch(engineBundle.code, /require\(["']electron["']\)/)
  const master = {
    api_mst_ship: [{ api_id: 1, api_name: '駆逐A', api_stype: 2, api_sortno: 1 }],
    api_mst_slotitem: [{ api_id: 10, api_name: '砲', api_type: [0, 1, 2, 3] }],
    api_mst_stype: [{ api_id: 2, api_name: '駆逐艦' }],
  }
  const sent = []
  const state = {
    player: {
      quests: { 4242: { no: 4242, state: 2, type: 1, progressFlag: 0 } },
      questActiveTs: Date.now(),
      questActiveIds: [4242],
      questsTs: Date.now(),
      decks: [{ id: 1, name: '第一', ships: [900], mission: [0, 0, 0, 0] }],
      ships: { 900: { id: 900, shipId: 1, lv: 9 } },
      slotitems: { 500: { mstId: 10, level: 0, alv: 0 } },
      materials: [],
      useitems: {},
    },
    sortie: null,
  }
  const engine = engineBundle.module.createQuestEngine({
    // 规则从**线上第一源**（kcwiki-quest-req）灌进去：这条用例验的是「引擎能脱开
    // Electron 装配起来并真派发」，不是某个包的解码，所以拿最上面那一层就够了。
    getLode: (id) => (id === 'kcwiki-quest-req'
      ? { meta: {}, data: { 4242: { category: 'scrapequipment', list: [{ name: '砲', amount: 2 }] } } }
      : null),
    ledger: {
      loadSnapshot: () => ({ ts: 0, body: master }),
      loadQuestProgress: () => ({}),
      saveQuestProgress: () => {},
      deleteQuestProgress: () => {},
    },
    store: { getState: () => state },
    send: (channel, payload) => sent.push([channel, payload]),
  })
  quiet(() => engine.init())
  const before = engine.state()
  assert.equal(before.trackers[4242].source, 'kcwiki')
  assert.deepEqual(before.trackers[4242].tasks, [{ kind: 'scrapEquip', equipId: 10, count: 2, slot: 0 }])
  // 真派发一次废弃：计数必须落下来，并且广播走的是注入的 send，不是 BrowserWindow
  quiet(() => engine.onApi(
    '/kcsapi/api_req_kousyou/destroyitem2',
    {},
    { api_slotitem_ids: '500' },
    { destroyedSlotitems: { 500: { mstId: 10 } } },
  ))
  assert.deepEqual(engine.state().progress[4242], [1])
  assert.ok(sent.some(([channel]) => channel === 'qp:patch'), '进度变化必须经宿主 send 播出去')
})

test('Electron 只出现在装配层，引擎与装配的分工不许回潮', async () => {
  // 装配层反过来必须真的把 ipcMain 两个口接上——否则渲染层拿不到状态，
  // 而这件事在引擎那侧是看不出来的。
  const hostSource = fs.readFileSync(
    path.join(root, 'src', 'main', 'mg', 'quest-counter-host.ts'),
    'utf8',
  )
  assert.match(hostSource, /ipcMain\.handle\('qp:get'/)
  assert.match(hostSource, /ipcMain\.handle\('qp:check-fleet'/)
  const engineSource = fs.readFileSync(
    path.join(root, 'src', 'main', 'mg', 'quest-counter.ts'),
    'utf8',
  )
  assert.doesNotMatch(engineSource, /^import .*from 'electron'/m)
})

// ---- 点位校准表 ----

test('九行点位表每一行都能从 poi-fcd 算出入边，没有一行是孤证', {
  skip: !fcd && 'poi-fcd-map 包缺失',
}, () => {
  const derived = {}
  for (const row of nodes.QUEST_MAP_NODE_TABLE) {
    const ids = nodes.questMapNodeIds(fcd, row.map, row.spot)
    assert.ok(
      ids.length > 0,
      `${nodes.mapKeyOf(row.map)} ${row.ref}=${row.spot} 在 poi-fcd 里算不出入边——海图改版了就别猜，改表`,
    )
    derived[`${nodes.mapKeyOf(row.map)} ${row.ref}`] = ids.join(',')
  }
  // 边号零硬编码，但「算出来的是什么」要钉住：海图改版时这条先红。
  assert.deepEqual(derived, {
    '1-6 goal': '14,17',
    '5-6 P3': '43',
    '7-2 P1': '7',
    '7-2 P2': '15',
    '7-3 P1': '5,8',
    '7-3 P2': '18,23,24,25',
    '7-4 O': '15',
    '7-5 P2': '19',
    '7-5 P3': '24,25',
  })
})

// 这张表原来还有第二票：EO 编的那七组点位边号逐组对得上（「第二个人独立做了一遍」）。
// EO 2026-08-21 整层退场，那一票随之作废——**替它的不是把 EO 的数字冻成 fixture**
// （那就成了照抄一份别人的成表），而是下面这条：账本 encounters 里实测到的 Boss 格
// 必须都能被这张表解释。那是玩家自己打出来的一手观测，比第三方编码更硬。
test('点位表与账本观测到的 Boss 格不矛盾', {
  skip: (() => {
    const db = userDataPathIfAny('mg.sqlite')
    return (!fcd || !db || !fs.existsSync(db)) && '本机没有账本或 poi-fcd 包'
  })(),
}, () => {
  const { DatabaseSync } = require('node:sqlite')
  const db = new DatabaseSync(userDataPath('mg.sqlite'), { readOnly: true })
  try {
    const observed = new Map()
    for (const row of db.prepare('SELECT map, cell FROM encounters WHERE is_boss=1').all()) {
      const list = observed.get(Number(row.map)) ?? new Set()
      list.add(Number(row.cell))
      observed.set(Number(row.map), list)
    }
    // 真正可证伪的那句话：**表覆盖的图上，观测到的每一个 Boss 格都必须能由表解释**。
    // 反过来「某一行没被观测到」不构成矛盾——那只说明这条血条没打过。
    const covered = new Set(nodes.QUEST_MAP_NODE_TABLE.map((row) => row.map[0] * 10 + row.map[1]))
    const unexplained = []
    for (const [mapId, cells] of observed) {
      if (!covered.has(mapId)) continue
      const explainable = new Set(
        nodes.QUEST_MAP_NODE_TABLE
          .filter((row) => row.map[0] * 10 + row.map[1] === mapId)
          .flatMap((row) => nodes.questMapNodeIds(fcd, row.map, row.spot)),
      )
      for (const cell of cells) {
        if (!explainable.has(cell)) unexplained.push(`${mapId}:${cell}`)
      }
    }
    assert.deepEqual(
      unexplained,
      [],
      '账本观测到表解释不了的 Boss 格：海图多了血条，9 行表该补行了',
    )
    // 7-2 是本机唯一两个血条都有实测的图：G/M 两格都必须在观测集合里
    const seen72 = observed.get(72)
    if (seen72?.size >= 2) {
      for (const ref of ['P1', 'P2']) {
        const ids = nodes.questMapRefNodeIds(fcd, [7, 2], ref)
        assert.ok(
          ids.some((id) => seen72.has(id)),
          `7-2 ${ref} 的入边 ${ids} 与账本观测到的 Boss 格 ${[...seen72]} 对不上`,
        )
      }
    }
  } finally {
    db.close()
  }
})

test('表里没有的写法一律吐 null，绝不默认取末血条', () => {
  assert.equal(nodes.questMapSpotOf([7, 3], 'P3'), null) // 7-3 只有两个血条
  assert.equal(nodes.questMapSpotOf([2, 5], 'P1'), null) // 整张图没登记
  assert.deepEqual(nodes.questMapRefNodeIds(fcd, [7, 3], 'P9'), [])
  // 多血条图的裸引用是歧义，必须待裁；单血条/护航图不该被误判成歧义
  assert.equal(nodes.questMapNeedsGauge([7, 3]), true)
  assert.equal(nodes.questMapNeedsGauge([7, 5]), true)
  assert.equal(nodes.questMapNeedsGauge([1, 6]), false)
  assert.equal(nodes.questMapNeedsGauge([7, 4]), false)
})

test('海图里查不到的点位算出空数组，不补一个 0 号边冒充', {
  skip: !fcd && 'poi-fcd-map 包缺失',
}, () => {
  assert.deepEqual(nodes.questMapNodeIds(fcd, [7, 3], 'ZZ'), [])
  assert.deepEqual(nodes.questMapNodeIds(fcd, [99, 9], 'A'), [])
  assert.deepEqual(nodes.questMapNodeIds(null, [7, 3], 'E'), [])
})

// ---- 废弃装备类：从中文正文推导 ----
//
// 全部用例都跑真解析器对**真任务正文**（quests-scn 的 desc/memo2 原样），
// 不是对着构造出来的句子测——正文的怪写法才是这套解析器要扛的东西。

const questText = (questId) => {
  const row = questPack?.data?.[questId]
  return { desc: `${row?.desc ?? ''}`, memo2: `${row?.memo2 ?? ''}` }
}
const derive = (questId) => {
  const { desc, memo2 } = questText(questId)
  return scrap.deriveScrapRule(desc, memo2, scrapCtx, questId)
}
/**
 * 任务 → 「这一条会算进哪些装备 mstId」；比编码等于把写法不同当成判定不同。
 * 深海装备（api_sortno=0）不算：提督拿不到也废弃不了，它们只会制造假分歧。
 */
const ownableItems = scrapMaster.api_mst_slotitem.filter((item) => item.api_sortno !== 0)
const memberIds = (task) => {
  const pick = (index, value) => ownableItems
    .filter((item) => item.api_type[index] === value)
    .map((item) => item.api_id)
    .sort((left, right) => left - right)
  if (task.kind === 'scrapEquip') return [task.equipId]
  if (task.kind === 'scrapCategory') return pick(2, task.category)
  if (task.kind === 'scrapCardType') return pick(1, task.cardType)
  if (task.kind === 'scrapIconType') return pick(3, task.iconType)
  return []
}
const slotsOf = (rule) => {
  const bySlot = new Map()
  for (const task of rule.tasks) {
    const list = bySlot.get(task.slot) ?? []
    list.push(task)
    bySlot.set(task.slot, list)
  }
  return [...bySlot.entries()].sort(([a], [b]) => a - b).map(([slot, tasks]) => ({
    slot,
    count: tasks[0].count,
    members: [...new Set(tasks.flatMap(memberIds))].sort((a, b) => a - b),
  }))
}

const HAS_QUESTS = !!questPack?.data

test('名称归一：正文的简/繁/日三套写法都落到同一件装备', {
  skip: !scrapCtx && '主数据 fixture 缺失',
}, () => {
  const id = (name) => scrapCtx.equipByName.get(scrap.normalizeEquipName(name))
  // 正文写「联装」，数据写「連装」/「连装」——这一组实测会把解析打挂（方案 §六·第1批）
  assert.equal(id('12.7cm联装高角炮'), 10)
  assert.equal(id('12.7cm连装高角炮'), 10)
  assert.equal(id('12.7cm連装高角砲'), 10)
  // 名字自带的括号要留（是名字的一部分），限定括号要剥
  assert.equal(id('61cm三联装（酸素）鱼雷'), 125)
  assert.equal(id('九七式舰攻（九三一空）'), 82)
  assert.equal(id('三式战 飞燕（无印）'), 176)
  assert.equal(id('三式水中探信儀☆MAX'), 47)
  // 认不出来就是认不出来，不许模糊命中
  assert.equal(id('九四式炸弹投射机'), undefined)
  assert.equal(id('不存在的装备'), undefined)
})

test('分配式数量：「各 N 个」只结算到此为止还没拿到数量的那些', {
  skip: (!scrapCtx || !HAS_QUESTS) && '缺主数据 fixture 或 quests-scn',
}, () => {
  // 1112「废弃小口径主炮，中口径主炮，大口径主炮各4门」→ 三个独立计数槽，各 4
  const f106 = slotsOf(derive(1112))
  assert.equal(f106.length, 3)
  assert.deepEqual(f106.map((entry) => entry.count), [4, 4, 4])
  // 1161 一句里有**两组**「各 N」：舰战/舰爆/舰攻各 9，爆雷/机枪各 8，随后两项各自带数
  const f139 = slotsOf(derive(1161))
  assert.deepEqual(f139.map((entry) => entry.count), [9, 9, 9, 8, 8, 9, 7])
  // 1120「『舰上战斗机』『舰上爆击机』『舰上攻击机』各×4」= 三个槽，不是挤在一格
  assert.deepEqual(slotsOf(derive(1120)).map((entry) => entry.count), [4, 4, 4])
  // 数量写在名字**前面**（1123「废弃2个九七式舰攻（九三一空）」）
  assert.deepEqual(derive(1123).tasks, [{ kind: 'scrapEquip', equipId: 82, count: 2, slot: 0 }])
})

test('动词归属：准备项、装备项、建议句都不许变成废弃计数', {
  skip: (!scrapCtx || !HAS_QUESTS) && '缺主数据 fixture 或 quests-scn',
}, () => {
  // 1140：旗舰第一/二格「装备」38cm四连装炮改、「准备」开发资材，只有 41cm连装炮 是废弃项
  assert.deepEqual(derive(1140).tasks, [{ kind: 'scrapEquip', equipId: 8, count: 4, slot: 0 }])
  // 1161 的 memo2 末尾「其中的爆雷兵装推荐选择『九四式爆雷投射机』或『九五式爆雷』」是建议句，
  // 不得产生具体装备的子项（原型在出击类踩过同族的坑：「6-4建议携带秋津洲」多出一条 6-4）
  assert.equal(derive(1161).tasks.some((task) => task.kind === 'scrapEquip'), false)
  // 1141 的废弃项后面直接串着要准备的道具/资源：跳过，但只跳道具，不跳装备
  assert.deepEqual(derive(1141).tasks, [{ kind: 'scrapEquip', equipId: 25, count: 15, slot: 0 }])
  // 反过来，1139 的「战斗粮食」既是道具名也是**真装备**（mstId 145），必须当废弃项收
  assert.equal(derive(1139).tasks.some((task) => task.equipId === 145), true)
})

test('读不懂就整条不做，绝不交半截清单', {
  skip: (!scrapCtx || !HAS_QUESTS) && '缺主数据 fixture 或 quests-scn',
}, () => {
  // 687 的 desc 把量词写成「一座」且装备名有错字（「94式高高射装置」）：
  // 单看 desc 必须整条弃用，而不是只留下 10cm连装高角炮 那一项
  assert.equal(scrap.deriveScrapRule(questText(687).desc, '', scrapCtx), null)
  // 同一条的 memo2 是干净的，合流之后能解出完整两项——这才是 desc/memo2 各解一遍的意义
  assert.equal(derive(687).tasks.length, 2)
  // 1153 反过来：desc 把「九四式爆雷投射机」写成「炸弹投射机」，memo2 才是对的
  assert.deepEqual(derive(1153).tasks, [{ kind: 'scrapEquip', equipId: 44, count: 4, slot: 0 }])
  // 完全无关的任务不许凭空长出废弃子项
  assert.equal(derive(201), null)
  assert.equal(scrap.deriveScrapRule('演习中取得3次S胜利！', '', scrapCtx), null)
})

test('类别名先落 category，只有一族跨多个 category 时才用 icon 表达', {
  skip: (!scrapCtx || !HAS_QUESTS) && '缺主数据 fixture 或 quests-scn',
}, () => {
  const armour = ownableItems
    .filter((item) => item.api_type[2] === 27 || item.api_type[2] === 28)
    .map((item) => item.api_id)
    .sort((left, right) => left - right)
  assert.ok(armour.length > 0, '主数据里的增设装甲成员不该为空')
  // 「追加装甲」那个 category 在主数据里是空的——写它这条任务永远计不了数
  assert.equal(
    ownableItems.filter((item) => item.api_type[2] === 16).length,
    0,
  )
  const f118 = slotsOf(derive(1130))
  assert.equal(f118.length, 3)
  assert.deepEqual(f118.map((entry) => entry.count), [3, 3, 3])
  // 断言的是**算进哪些装备**，不是「必须编成 iconType 23」——
  // 把仲裁结论焊成具体编号的话，主数据换代后测试还绿、判定已经错了
  assert.deepEqual(f118[2].members, armour)
  // 机枪 / 机关部强化：category 与 icon 的成员逐件相同，取 category 即可
  assert.deepEqual(
    f118[0].members,
    ownableItems.filter((item) => item.api_type[3] === 15)
      .map((item) => item.api_id).sort((a, b) => a - b),
  )
})

test('「X」系装备按族级读，族跨了几个类别由主数据说了算', {
  skip: (!scrapCtx || !HAS_QUESTS) && '缺主数据 fixture 或 quests-scn',
}, () => {
  // 677「大口径主炮系4个 / 水侦系2个 / 鱼雷系3个」——日文原文三项同式「「X」系装備」，
  // 一贯是族级宽集合（2026-08-21 裁决，依据见 quest-scrap-rules 的仲裁台账）。
  const fw4 = derive(677)
  assert.equal(fw4.approx, false, '族级读法已由日文原文裁定，不该再标 ≈')
  const slots = slotsOf(fw4)
  assert.equal(slots.length, 3)
  const cat = (id) => ownableItems
    .filter((item) => item.api_type[2] === id).map((item) => item.api_id).sort((a, b) => a - b)
  // 「鱼雷」系 = 鱼雷 ∪ 潜水舰鱼雷。断言的是**算进哪些装备**，不是编成 cardType 几号。
  const torpedo = slots.find((entry) => entry.count === 3)
  assert.deepEqual(torpedo.members, [...cat(5), ...cat(32)].sort((a, b) => a - b))
  // 反过来必须**不含**特殊潜航艇：甲標的和鱼雷同一个图标，但在游戏类别表里是另一类装备，
  // 升到 iconType 就会把它们一并算进来。这一条是「宽到哪里为止」的判别线。
  for (const midget of cat(22)) {
    assert.equal(torpedo.members.includes(midget), false, `甲標的 ${midget} 不该算进「鱼雷」系`)
  }
  assert.ok(cat(22).length > 0, 'fixture 里得真有特殊潜航艇，否则这条断言是空的')
  // 大口径主炮系：类别与图标的成员逐件相同，宽窄同一批
  assert.deepEqual(slots.find((entry) => entry.count === 4).members, cat(3))
})

test('中文译文丢了字的那条走仲裁表，依据是游戏自己的日文原文', {
  skip: (!scrapCtx || !HAS_QUESTS) && '缺主数据 fixture 或 quests-scn',
}, () => {
  // 1105 的中文正文写「废弃九六式陆攻或一式陆攻×3」，看着像穷举两件；
  // 日文原文是「九六式や一式陸攻**等の**陸上攻撃機x3廃棄」——类别口径。
  const fy7 = derive(1105)
  assert.equal(fy7.approx, false)
  const slots = slotsOf(fy7)
  assert.equal(slots.length, 1)
  assert.equal(slots[0].count, 3)
  const landAttackers = ownableItems
    .filter((item) => item.api_type[2] === 47).map((item) => item.api_id).sort((a, b) => a - b)
  assert.deepEqual(slots[0].members, landAttackers)
  // 判别线：整个类别，不是正文点名的那两件
  assert.ok(landAttackers.length > 2, 'fixture 里的陆攻要多于正文举例的两件，否则断言不成立')
  // 不传 questId 就没有仲裁，解析器仍按正文的窄读法走——表和解析器各管各的，没有偷偷耦合
  const withoutRuling = scrap.deriveScrapRule(questText(1105).desc, questText(1105).memo2, scrapCtx)
  assert.notDeepEqual(slotsOf(withoutRuling)[0].members, landAttackers)
})

test('没有「系/类/兵装」后缀的不该被顺手标成推定', {
  skip: (!scrapCtx || !HAS_QUESTS) && '缺主数据 fixture 或 quests-scn',
}, () => {
  assert.equal(derive(1112).approx, false)
  assert.equal(derive(1120).approx, false)
})

test('全库跑一遍：结构不变式处处成立，覆盖面不塌方', {
  skip: (!scrapCtx || !HAS_QUESTS) && '缺主数据 fixture 或 quests-scn',
}, () => {
  let derived = 0
  for (const [idText, row] of Object.entries(questPack.data)) {
    const rule = scrap.deriveScrapRule(`${row?.desc ?? ''}`, `${row?.memo2 ?? ''}`, scrapCtx)
    if (!rule) continue
    derived += 1
    const where = `${idText} ${row?.code ?? ''}`
    assert.ok(rule.tasks.length > 0, `${where} 有规则却没有子项`)
    const slots = [...new Set(rule.tasks.map((task) => task.slot))].sort((a, b) => a - b)
    // 槽号必须显式、从 0 起、连续：留空让下标兜底会在备选组那里错开一格，进度数组从此串位
    assert.deepEqual(slots, slots.map((_, index) => index), `${where} 槽号不连续`)
    for (const task of rule.tasks) {
      assert.ok(Number.isInteger(task.count) && task.count > 0, `${where} 子项数量不是正整数`)
      assert.ok(memberIds(task).length > 0, `${where} 子项指向的集合是空的，永远计不了数`)
    }
    // 同一个槽里的多条只能是「任一命中」的备选，数量必须一致
    for (const slot of slots) {
      const inSlot = rule.tasks.filter((task) => task.slot === slot)
      assert.equal(new Set(inSlot.map((task) => task.count)).size, 1, `${where} 同槽数量不一致`)
    }
  }
  // 这份 fixture 只截了用例要用的那些装备行，解得开的自然比真主数据少；
  // 门槛钉在「别整体塌方」，具体条数由 scripts/quest-selfderive-diff.mjs 逐条把关。
  assert.ok(derived >= 45, `全库只解出 ${derived} 条废弃规则，解析器可能整体退化了`)
})

// ---- 演习类：从中文正文推导 ----

const questRow = (questId) => questPack?.data?.[questId] ?? {}
const drill = (questId) => {
  const row = questRow(questId)
  return practice.derivePracticeRule(
    questId,
    `${row.code ?? ''}`,
    `${row.name ?? ''}`,
    `${row.desc ?? ''}`,
    `${row.memo2 ?? ''}`,
  )
}
const drillTask = (questId) => drill(questId)?.tasks?.[0] ?? null

test('演习：没写字母的「胜利」= B 判定，中文语料自己给了对照', {
  skip: !HAS_QUESTS && '缺 quests-scn',
}, () => {
  // 311/Cm1 的 desc 写「拿下七次演习的胜利」，memo2 补「演习B胜利七次即可」——同一条任务、
  // 两个字段，这就是「胜利 = B」的语料内自证。338/C39 的 memo2 更直接：「S/A/B胜均可」。
  assert.deepEqual(drillTask(311), { kind: 'exercise', rank: 4, count: 7, slot: 0 })
  assert.deepEqual(drillTask(338), { kind: 'exercise', rank: 4, count: 4, slot: 0 })
  assert.deepEqual(drillTask(302), { kind: 'exercise', rank: 4, count: 20, slot: 0 })
  // 写了字母的照取；「A/S胜」取较低的那个才是下限
  assert.equal(drillTask(345).rank, 5)
  assert.equal(drillTask(360).rank, 6)
  // 「无论胜负」= 不看评价，落 0；次数在 desc 里、评价在 memo2 里，两个字段各取各的
  assert.deepEqual(drillTask(303), { kind: 'exercise', rank: 0, count: 3, slot: 0 })
})

test('演习：夹在字母与「胜」之间的「判定」「及以上」不能把评价读丢', {
  skip: !HAS_QUESTS && '缺 quests-scn',
}, () => {
  // 336/C37 memo2 写「A及以上胜利四次」，364/C73 desc 写「“S判定”胜利4次以上」——
  // 只认「字母紧挨着胜」的话这两条会掉回没写字母的 B，静悄悄地把门槛放松一档。
  assert.equal(drillTask(336).rank, 5)
  assert.equal(drillTask(364).rank, 6)
  // 舰名里的大写字母不算评价：354 的 memo2 里有 Fletcher/Johnston/Samuel B. Roberts
  assert.equal(drillTask(354).rank, 6)
  assert.equal(drillTask(358).rank, 6)
  // 「1CL+2DD」这种编成缩写里的 C 也不算
  assert.equal(drillTask(375).rank, 6)
})

test('演习：次数认「次/回/场」，不认「艘/只/名/月/号」', {
  skip: !HAS_QUESTS && '缺 quests-scn',
}, () => {
  assert.equal(drillTask(345).count, 4) // 「J级驱逐舰4艘以上」在前，「4次」在后
  assert.equal(drillTask(368).count, 3) // 「4选2」不是次数
  assert.equal(drillTask(382).count, 3) // 「5名舰娘」不是次数
  assert.equal(drillTask(355).count, 4) // 「2号舰」不是次数
  assert.equal(drillTask(313).count, 8) // memo2 只有年份串，次数只在 desc 里
  assert.equal(drillTask(377).count, 4) // memo2 只有「年常任务(10月)」
  assert.equal(drillTask(365).count, 5) // desc 是空的，两个数都在 memo2 里
})

test('演习：另一半要求是出击就整条不做，是装备/准备就标 partial', {
  skip: !HAS_QUESTS && '缺 quests-scn',
}, () => {
  // 317/C15：演习胜3次**之后**还要把同一舰队投入西南诸岛海域打四张图的 Boss。
  // 只生成演习那一格会在演习打完时就判完成——宁可整条不做。
  assert.equal(drill(317), null)
  // 318/Cm2：演习胜3次 + 旗舰装备两个战斗粮食。计数照给，但整项不等于可交付。
  const cm2 = drill(318)
  assert.deepEqual(cm2.tasks, [{ kind: 'exercise', rank: 4, count: 3, slot: 0 }])
  assert.equal(cm2.partial, true)
  // 反面：「装备充实」「北方再突入而准备」这类叙述不该被当成库存门
  assert.equal(drill(331).partial, false)
  assert.equal(drill(309).partial, false)
})

test('演习：分类位闸门挡住名字里带「演习」的远征任务', {
  skip: !HAS_QUESTS && '缺 quests-scn',
}, () => {
  // 412/D10「实施「航空战舰运用演习」，完成1次」——那是远征名，不是演习计数
  assert.equal(drill(412), null)
  assert.equal(drill(416), null) // 416/D15「防空射击演习」同理
  assert.equal(drill(201), null) // 出击类不该长出演习格
  // 编码首字母不是 C 的一律不做，哪怕正文通篇在说演习
  assert.equal(
    practice.derivePracticeRule(9999, 'B99', '出击任务', '演习中取得3次S胜利！', ''),
    null,
  )
})

test('演习：「?胜」的判别线是问号前有没有字母', () => {
  // 有字母 = 中文源只是自标存疑，评价照取并原样传递不确定性
  const withLetter = practice.derivePracticeRule(9001, 'C99', '演习', '取得1次S?胜！', '')
  assert.equal(withLetter.tasks[0].rank, 6)
  assert.equal(withLetter.approx, true)
  // 没字母 = 无从取值，落「胜负不限」（偏松、会多计）并标 ≈，不替正文拿主意
  const without = practice.derivePracticeRule(9002, 'C99', '演习', '各取得一次?胜！', '')
  assert.equal(without.tasks[0].rank, 0)
  assert.equal(without.approx, true)
  // 写明白了的既不推定也不标 ≈
  const plain = practice.derivePracticeRule(9003, 'C99', '演习', '取得4次【S判定】胜利！', '')
  assert.equal(plain.tasks[0].rank, 6)
  assert.equal(plain.approx, false)
})

test('演习：仲裁表只改它裁到的那个字段，依据是日文原文', {
  skip: !HAS_QUESTS && '缺 quests-scn',
}, () => {
  // 343/C46 的中文 desc 与 memo2 都写「4次以上【A胜】」，日文原文却是
  // 「本日中に4回以上演習で勝利せよ」——没有评价字母。次数 4 三方无分歧。
  assert.deepEqual(drillTask(343), { kind: 'exercise', rank: 4, count: 4, slot: 0 })
  assert.equal(drill(343).approx, false)
  // 同一句式、没有仲裁条目的那条仍按正文读 A —— 表没有悄悄改写解析器
  assert.equal(drillTask(342).rank, 5)
})

// ---- 远征类：从中文正文推导 ----

const expedition = (questId) => {
  const row = questRow(questId)
  return mission.deriveMissionRule(
    `${row.code ?? ''}`,
    `${row.desc ?? ''}`,
    `${row.memo2 ?? ''}`,
    missionCtx,
  )
}
const missionSlots = (rule) => {
  const bySlot = new Map()
  for (const task of rule.tasks) {
    const list = bySlot.get(task.slot) ?? []
    list.push(task.missionId)
    bySlot.set(task.slot, list)
  }
  return [...bySlot.entries()].sort(([a], [b]) => a - b)
    .map(([, ids]) => ids.sort((a, b) => a - b))
}

test('远征：编号从主数据的 disp_no 查，字母号也不例外', {
  skip: !missionCtx && '缺远征 fixture',
}, () => {
  const id = (disp) => missionCtx.missionByDisp.get(disp)
  // 纯数字号 disp 与 api_id 相等；带字母的要靠 disp_no 表才对得上
  assert.equal(id('4'), 4)
  assert.equal(id('A1'), 100)
  assert.equal(id('A5'), 104)
  assert.equal(id('B1'), 110)
  assert.equal(id('E2'), 142)
  // 表里没有的写法就是没有，不许模糊命中
  assert.equal(id('A9'), undefined)
  assert.equal(id('Z1'), undefined)
})

test('远征：四条 EO 覆盖的年常任务逐条解出编号与次数', {
  skip: (!missionCtx || !HAS_QUESTS) && '缺远征 fixture 或 quests-scn',
}, () => {
  // 437/Dy3 的 memo2 把「远征」二字甩到列表**末尾**（「4、A5（月常远征）、A6（月常远征）、B1远征」），
  // 逐个看前缀一个都收不到；同时 desc 的中文译名与远征包对不上（「小笠原近海警戒线」
  // vs「小笠原群岛哨戒线」），所以这条只能靠编号串。
  assert.deepEqual(missionSlots(expedition(437)), [[4], [104], [105], [110]])
  assert.deepEqual(missionSlots(expedition(440)), [[5], [40], [41], [46], [142]])
  assert.deepEqual(missionSlots(expedition(445)), [[5], [100], [9], [18], [36], [40], [45]])
  assert.deepEqual(missionSlots(expedition(447)), [[4], [5], [100], [9], [110]])
  for (const questId of [437, 440, 445, 447]) {
    const rule = expedition(questId)
    assert.ok(rule.tasks.every((task) => task.count === 1), `${questId} 应当是各一次`)
    assert.equal(rule.approx, false)
  }
})

test('远征：「远征N次」是次数不是远征号', {
  skip: (!missionCtx || !HAS_QUESTS) && '缺远征 fixture 或 quests-scn',
}, () => {
  // 402/Dd1「远征3次成功」= 任意远征 3 次，不是 3 号远征一次。
  // 判别线是数字后面跟不跟量词——这一条有 17 次交付流水背书。
  assert.deepEqual(expedition(402).tasks, [{ kind: 'expedition', missionId: 0, count: 3, slot: 0 }])
  assert.deepEqual(expedition(403).tasks, [{ kind: 'expedition', missionId: 0, count: 10, slot: 0 }])
  assert.deepEqual(expedition(404).tasks, [{ kind: 'expedition', missionId: 0, count: 30, slot: 0 }])
  // 反过来 443/D39「远征30成功2次」是 30 号远征两次
  assert.deepEqual(expedition(443).tasks, [{ kind: 'expedition', missionId: 30, count: 2, slot: 0 }])
})

test('远征：派出不等于成功，编成里的数字也不是远征号', {
  skip: (!missionCtx || !HAS_QUESTS) && '缺远征 fixture 或 quests-scn',
}, () => {
  // 401/D1「舰队出发「远征」！」「任意远征1次」——派出就算，不是成功才算。
  // 当成「成功1次」的话，玩家派出去了进度却不动。
  assert.equal(expedition(401), null)
  // 429/D27 的 memo2 第二句「远征B1可使用1轻巡洋舰1水上机母舰4驱逐舰完成」里的
  // 1/1/4 是编成，不是远征 1 号、4 号
  assert.deepEqual(missionSlots(expedition(429)), [[3], [100], [110]])
  // 分类位闸门：编码首字母不是 D 的一律不做
  assert.equal(mission.deriveMissionRule('B99', '完成远征5各一次！', '', missionCtx), null)
})

test('远征：「或」列举的共用一格，半解的引号名整条弃用', {
  skip: (!missionCtx || !HAS_QUESTS) && '缺远征 fixture 或 quests-scn',
}, () => {
  // 410/411 Dw2/Dw3「远征「东京急行」或「东京急行(二)」成功 1/7 次」——两件里凑够，一个槽。
  // 拆成两个槽就变成「两个都要做」，这两条有 3 次交付流水背书。
  assert.deepEqual(missionSlots(expedition(410)), [[37, 38]])
  assert.deepEqual(missionSlots(expedition(411)), [[37, 38]])
  assert.ok(expedition(411).tasks.every((task) => task.count === 7))
  // 436/Dy2 的 desc 把「强行侦察任务」写成「强行侦查任务」：五个引号名解出四个。
  // 交这份清单出去分母就少一格、进度虚高——整条弃用才对。
  const half = mission.deriveMissionRule(
    'Dy2',
    '实施完成「练习航海」「长距离练习航海」「警备任务」「对潜警戒任务」「强行侦查任务」各项远征任务！',
    '',
    missionCtx,
  )
  assert.equal(half, null)
  // 但引号里根本不是远征名（舰名/装备名）时不该误杀
  const shipNames = mission.deriveMissionRule(
    'D99',
    '远征「海上护卫任务」完成1次，「Z1」作为秘书舰才可以建造「Z3」。',
    '',
    missionCtx,
  )
  assert.deepEqual(shipNames && missionSlots(shipNames), [[5]])
})

test('远征：名称式与编号式解出同一批远征', {
  skip: (!missionCtx || !HAS_QUESTS) && '缺远征 fixture 或 quests-scn',
}, () => {
  // 447/D43 的 desc 是五个中文远征名、memo2 是五个编号，两条路必须落到同一批 id
  const byName = mission.deriveMissionRule('D43', questRow(447).desc, '', missionCtx)
  const byNumber = mission.deriveMissionRule('D43', '', questRow(447).memo2, missionCtx)
  assert.deepEqual(
    missionSlots(byName).flat().sort((a, b) => a - b),
    missionSlots(byNumber).flat().sort((a, b) => a - b),
  )
  // 日文名同样认得（正文里直接贴日文的写法：420/D19「「ＭＯ作戦」及「敵母港空襲作戦」」）
  assert.deepEqual(missionSlots(expedition(420)), [[35], [26]])
  // 但 445/D41 的 desc 把四个远征名都译歪了（「油田护卫任务」vs 远征包的「油轮护卫任务」…），
  // 半解就该整条弃用——这条任务只能靠 memo2 的编号串，而不是把解出来的三个交出去
  assert.equal(mission.deriveMissionRule('D41', questRow(445).desc, '', missionCtx), null)
})

// ---- 出击类 · 纯海域：从中文正文推导 ----

const sortieOf = (questId) => {
  const row = questRow(questId)
  return sortie.deriveSortieRule(
    questId,
    `${row.code ?? ''}`,
    `${row.desc ?? ''}`,
    `${row.memo2 ?? ''}`,
    sortieCtx,
  )
}
/** 「2-3r6x1 …」形式的紧凑摘要，按海域号排序，方便逐条对 EO 那份编码 */
const sortieShape = (rule) =>
  (rule?.tasks ?? [])
    .map((task) => `${task.map[0]}-${task.map[1]}r${task.rank}x${task.count}s${task.slot}`)
    .sort()
    .join(' ')
/**
 * 带点位的摘要：把「哪一格、哪些入边、战斗还是到达」都写出来。
 *   `7-3P[18/23/24/25]r6x1` 指定点位战斗 · `7-4→O[15]x1` 到达 · `7-4首通x1` 海域首通
 */
const sortieSpots = (rule) =>
  (rule?.tasks ?? [])
    .map((task) => {
      const map = `${task.map[0]}-${task.map[1]}`
      if (task.kind === 'battleNode') return `${map}${task.name}[${task.nodes.join('/')}]r${task.rank}x${task.count}`
      if (task.kind === 'nodeReach') return `${map}→${task.name}[${task.nodes.join('/')}]x${task.count}`
      if (task.kind === 'mapFirstClear') return `${map}首通x${task.count}`
      if (task.kind === 'bossKill') return `${map}r${task.rank}x${task.count}`
      return `${map}?${task.kind}`
    })
    .sort()
    .join(' ')
const madeUp = (desc, memo2 = '') =>
  sortie.deriveSortieRule(99999, 'B99', desc, memo2, sortieCtx)

test('出击：海域号只认主数据里真有的图', {
  skip: !sortieCtx && '缺出击 fixture',
}, () => {
  // 主数据里没有 8 区，也没有 1-9：这两个数字对不是海域
  assert.equal(madeUp('', '出击8-1取得1次S胜'), null)
  assert.equal(madeUp('', '出击1-9取得1次S胜'), null)
  // 日期不是海域：两侧的 (?<![\d-]) / (?![\d-]) 各挡一头
  assert.equal(madeUp('', '2026-08-21 更新后开放'), null)
  // 真图照解
  assert.equal(sortieShape(madeUp('', '出击1-4取得1次S胜')), '1-4r6x1s0')
})

test('出击：同一句里的两套要求各归各的作用域', {
  skip: (!sortieCtx || !HAS_QUESTS) && '缺出击 fixture 或 quests-scn',
}, () => {
  // 948/By10「5-2 5-5 6-5 各S胜两次，6-4 A胜两次」——分句是作用域线，
  // 读成一套的话 6-4 的门槛会被抬到 S，那一格就永远不涨
  assert.equal(sortieShape(sortieOf(948)), '5-2r6x2s0 5-5r6x2s1 6-4r5x2s3 6-5r6x2s2')
  // 1012/By14「出击1-1完成3次S胜，出击1-2、1-5各完成2次A胜」——评价与次数一起换
  assert.equal(sortieShape(sortieOf(1012)), '1-1r6x3s0 1-2r5x2s1 1-5r5x2s2')
  // 283/B137「4-5、5-2各取得一次S胜（需验证），6-5取得2次S胜（需验证）」
  // ——说明词在分句里侧，截断不能把后半句一起丢
  assert.equal(sortieShape(sortieOf(283)), '4-5r6x1s0 5-2r6x1s1 6-5r6x2s2')
  // 1033/B210 海域与评价分在两个分句：分句取不到就继承整句
  assert.equal(sortieShape(sortieOf(1033)), '1-1r6x1s0 1-2r6x1s1 1-3r6x1s2 1-4r6x1s3')
})

test('出击：建议句不得产生 task，但同一分句里的真要求要留住', {
  skip: (!sortieCtx || !HAS_QUESTS) && '缺出击 fixture 或 quests-scn',
}, () => {
  // 说明块截断之后什么信号都不剩的整块作废：「（6-4建议携带秋津洲…」→「（6-4」→ 弃
  assert.equal(sortieShape(madeUp('', '出击1-2并取得S胜。（6-4建议携带秋津洲走低速胸热流）')), '1-2r6x1s0')
  // 299/B125 的注记「2-2有海防舰带路」跟在真要求后面，中间只隔一个空格——
  // 整句丢会连 5 张图一起丢，整句留会把注记当任务
  assert.equal(
    sortieShape(sortieOf(299)),
    '1-2r6x1s0 1-3r6x1s1 1-4r6x1s2 2-1r6x1s3 2-2r6x1s4',
  )
  // 282/B130 的建议句里那个 6-4 本来就是任务海域，靠去重收掉，条数不许变成 4
  assert.equal(sortieOf(282).tasks.length, 3)
})

test('出击：memo2 出海域、desc 兜底，评价与次数各自回退', {
  skip: (!sortieCtx || !HAS_QUESTS) && '缺出击 fixture 或 quests-scn',
}, () => {
  // 837/B86：memo2 通篇没写海域号（海域在 desc 的「2-2|巴士岛近海（2-2）」里），
  // 评价却只有 memo2 有（「Boss战S胜」）。两个轴绑一起取就会丢掉其中一个。
  assert.equal(sortieShape(sortieOf(837)), '2-2r6x1s0')
  // 269/B37 同样：memo2 只写编成与「击破BOSS（S胜利）」，海域号在 desc
  assert.equal(sortieShape(sortieOf(269)), '3-1r6x1s0')
  // memo2 有海域时不许再去读 desc：desc 里多出来的海域一律不进
  assert.equal(sortieShape(madeUp('前往1-2、3-4、5-1歼灭敌人！', '出击1-2取得1次S胜')), '1-2r6x1s0')
})

test('出击：写明字母的评价压过没写字母的「胜利」', {
  skip: (!sortieCtx || !HAS_QUESTS) && '缺出击 fixture 或 quests-scn',
}, () => {
  // 233/B19、243/Bw9 的海域号只在 desc，而 desc 那句是没写字母的「获得「完全胜利」」；
  // 评价写死在 memo2（「必须S胜」/「（S胜）两次」）。按「先 picked 后 other」的顺序取，
  // 这两条会双双掉回 B —— 门槛静悄悄放松一档。日文原文两条都写着「完全勝利」，
  // kcwiki 独立编的也是 S。
  assert.equal(sortieShape(sortieOf(233)), '2-3r6x1s0')
  assert.equal(sortieShape(sortieOf(243)), '5-2r6x2s0')
  assert.equal(sortieOf(233).approx, false)
  // 826/B78「取得1-5Boss战胜利，A胜可」是分句版的同一回事：前半句没字母、后半句有
  assert.equal(sortieShape(sortieOf(826)), '1-5r5x1s0')
  assert.equal(sortieShape(sortieOf(827)), '2-5r5x1s0')
  // 挑「写明字母的那个」要**先在自己那一句里挑**，挑不到才往整段退：
  // 下面这段第一句写 S、第二句写 A，而 1-2 所在的分句只写了没字母的「取得胜利」。
  // 直接退到整段的话会取到第一句的 S，把第二句的 A 顶掉——跨句串味。
  assert.equal(
    sortieShape(madeUp('', '出击1-3取得1次S胜。出击1-2取得胜利，各1次A胜')),
    '1-2r5x1s1 1-3r6x1s0',
  )
  // 反面：两边都没写字母时才轮到「胜利 = B 判定」这条下限读法，而且必须标 ≈
  const floor = madeUp('', '出击1-4取得胜利1次')
  assert.equal(floor.tasks[0].rank, 4)
  assert.equal(floor.approx, true)
  // 连「胜」都没有的（「击破BOSS」）落「胜负不限」+ ≈，不替正文拿主意
  const anyResult = madeUp('', '出击1-4击破BOSS')
  assert.equal(anyResult.tasks[0].rank, 0)
  assert.equal(anyResult.approx, true)
})

test('出击：四种点位写法归一到同一个 ref，边号一律由 poi-fcd 算', {
  skip: (!sortieCtx || !HAS_QUESTS || !fcd) && '缺出击 fixture / quests-scn / poi-fcd-map',
}, () => {
  // ① 血条号缀在海域号后面
  assert.equal(
    sortieSpots(sortieOf(930)),
    '1-4r6x1 2-2r6x1 3-2r6x1 4-1r6x1 7-3P[18/23/24/25]r6x1',
  )
  // ② 第三段是血条号：「7-2-2、7-3-2」连海域号正则的 (?![\d-]) 都过不去，
  //    所以海域号正则自己带上了第三段——分开扫的话这条会只剩 2-3、6-4 两格
  assert.equal(
    sortieSpots(sortieOf(939)),
    '2-3r6x1 6-4r6x1 7-2M[15]r6x1 7-3P[18/23/24/25]r6x1',
  )
  // ③ 第三段直接是格子字母（926/B154「(7-2-M)」）
  assert.equal(sortieSpots(sortieOf(926)), '5-5r6x1 6-2r6x1 6-5r6x1 7-2M[15]r6x1')
  // ④ 括号里的血条号
  assert.equal(
    sortieSpots(sortieOf(1045)),
    '5-1r6x1 5-3r6x1 5-4r6x1 5-5r6x1 7-5T[24/25]r6x1',
  )
  assert.equal(sortieSpots(sortieOf(1047)), '5-4r6x2 5-5r6x2 5-6Z[43]r6x2')
  assert.equal(sortieSpots(sortieOf(1049)), '2-3r5x1 7-5Q[19]r5x1')
  // 边号是算出来的不是写死的：抽掉 poi-fcd 就一格也解不出，绝不退化成「补个 0 号边」
  const blind = sortie.buildSortieRuleContext(sortieMaster, null)
  assert.equal(sortie.deriveSortieRule(930, 'B157', '', questRow(930).memo2, blind), null)
})

test('出击：格子字母另起一段写也认得，到达式与战斗式分得开', {
  skip: (!sortieCtx || !HAS_QUESTS || !fcd) && '缺出击 fixture / quests-scn / poi-fcd-map',
}, () => {
  // 966/B175「…7-3P2 s胜各1次  7-4 O点到达1次」：同一分句里两格两种口径。
  // 「O点」归 7-4 而不是归前一格，靠的是「本海域号到下一个海域号之间」这条边界。
  assert.equal(
    sortieSpots(sortieOf(966)),
    '2-1r6x1 2-2r6x1 2-3r6x1 7-3P[18/23/24/25]r6x1 7-4→O[15]x1',
  )
  // 到达式没有评价这一轴：正文的「S胜」是给别的格子写的，不许糊到这一格上
  const reach = sortieOf(966).tasks.find((task) => task.kind === 'nodeReach')
  assert.equal('rank' in reach, false)
  // 「BOSS点」里的那个 s 是单词尾巴不是格子字母，7-4 也不是多血条图 —— 不许被误伤
  assert.equal(sortieShape(madeUp('', '出击7-4的BOSS点取得1次S胜')), '7-4r6x1s0')
  assert.equal(sortieShape(sortieOf(1013)), '1-3r6x1s0 1-4r6x1s1 2-2r6x1s2 2-3r6x1s3 7-4r6x1s4')
})

test('出击：护航图 1-6 走到达式，没有到达信号就交人裁', {
  skip: (!sortieCtx || !HAS_QUESTS || !fcd) && '缺出击 fixture / quests-scn / poi-fcd-map',
}, () => {
  // 1-6 没有 Boss：「到达终点」「到达资源点」「1-6完成」说的都是终点 N 那一格
  assert.equal(
    sortieSpots(sortieOf(997)),
    '1-3r6x2 1-5r6x2 1-6→N[14/17]x2 2-2r6x2',
  )
  assert.equal(sortieSpots(sortieOf(982)), '1-5r6x1 1-6→N[14/17]x1 2-2r6x1 3-5r6x1')
  assert.equal(sortieSpots(sortieOf(878)), '1-4r4x3 1-6→N[14/17]x3')
  assert.equal(sortieSpots(sortieOf(1029)), '1-6→N[14/17]x1 2-2r6x1 2-3r6x1 2-4r6x1')
  // 反面：没有到达信号的 1-6 说不清要什么（还有 mapGoal / nodeReach 的分叉），整条待裁
  assert.equal(madeUp('', '出击1-6取得1次S胜'), null)
})

test('出击：解不出的点位一律整条弃用，不许默认取末血条', {
  skip: (!sortieCtx || !HAS_QUESTS || !fcd) && '缺出击 fixture / quests-scn / poi-fcd-map',
}, () => {
  // 多血条图的裸引用本身就是歧义。995/B189 的正文已被逐条裁定（ARBITRATED 的 gauges），
  // 但换个陌生 id 跑同一段文字仍必须是 null——裁定只挂在那一个 questId 上，
  // 解析器这道闸一点没松。
  assert.equal(madeUp(questRow(995).desc, questRow(995).memo2), null)
  assert.equal(madeUp('', '出击7-2取得1次S胜'), null)
  assert.equal(madeUp('', '出击5-6取得1次S胜'), null)
  // 一格挂两个血条号（893/Bq8「7-2（P1、P2）各3次」）：解成一个会漏掉另一个
  assert.equal(madeUp('', '分别出击1-5、7-2（P1、P2）各3次，且全部取得S胜'), null)
  // 表里没有的血条号（7-3 只有两个血条）
  assert.equal(madeUp('', '出击7-3P3取得1次S胜'), null)
  // 正文里出现了我们没解析的点位词：不许当没看见
  assert.equal(madeUp('', '出击6-4击破第二血条'), null)
  assert.equal(madeUp('', '出击6-4的K格取得1次S胜'), null)
  // 格子字母离得太远、没被任何一格认领（跨了分句）：同样是「我看见了但接不上」
  assert.equal(madeUp('', '出击6-4，在K点取得1次S胜'), null)
  // 对照：单血条图的裸引用不是歧义，不许被误伤
  assert.equal(sortieShape(madeUp('', '出击7-4取得1次S胜')), '7-4r6x1s0')
})

test('出击：同一张图的两个血条是两格要求，去重不许按图吃掉一格', {
  skip: (!sortieCtx || !fcd) && '缺出击 fixture 或 poi-fcd-map',
}, () => {
  // 7-2 的 P1=G、P2=M 是两条不同的血条，入边也不同（G←7 / M←15）
  assert.equal(
    sortieSpots(madeUp('', '出击7-2P1、7-2P2各取得1次S胜')),
    '7-2G[7]r6x1 7-2M[15]r6x1',
  )
  assert.equal(madeUp('', '出击7-2P1、7-2P2各取得1次S胜').tasks.length, 2)
})

test('出击：待裁台账在解析之前生效，每条都写得出「为什么不猜」', {
  skip: (!sortieCtx || !HAS_QUESTS) && '缺出击 fixture 或 quests-scn',
}, () => {
  for (const [idText, why] of Object.entries(sortie.SORTIE_UNRESOLVED)) {
    const questId = Number(idText)
    assert.ok(why.length > 40, `${questId} 的待裁理由太短，等于没写`)
    assert.ok(questPack.data[questId], `${questId} 不在中文任务目录里，台账指错了人`)
    assert.equal(sortieOf(questId), null, `${questId} 在台账里却还是出了规则`)
  }
  // 880/B115 的 memo2 用「其余」指代 desc 才点名的那三张图，解析器自己看不出来。
  // 2026-08-22 用户拍板收进 ARBITRATED 人工手写四格，从待裁台账退场——
  // 若回到「只解出 1-6 一格」就是回退（分母偏小、进度虚高）
  assert.equal(sortie.SORTIE_UNRESOLVED[880], undefined)
  const b115 = sortieOf(880)
  assert.equal(b115.tasks.length, 4, 'B115 应为四格：1-6 到达 + 三图 Boss')
  const b115Boss = b115.tasks.filter((t) => t.kind === 'bossKill')
  assert.deepEqual(
    b115Boss.map((t) => `${t.map[0]}-${t.map[1]}`).sort(),
    ['2-3', '3-2', '4-2'],
  )
  assert.ok(b115Boss.every((t) => t.rank === 5 && t.count === 1), 'Boss 三格应为 A 胜各 1 次')
  const b115Goal = b115.tasks.find((t) => t.kind === 'mapGoal')
  assert.deepEqual(b115Goal?.map, [1, 6], '1-6 那格是到达终点，不看评价')
  assert.ok(b115.approx, '次数「各1次」不在第一方正文里，≈ 必须保留')
  // 台账只挡它列的那几条：长得像的 902/B141「+0-2只其他舰娘 出击1-5,1-6…」与
  // 933/B159「+其他分别出击1-3、1-4…」海域号一个不缺，仍旧照解
  assert.equal(sortie.SORTIE_UNRESOLVED[933], undefined)
  assert.ok(sortieOf(933).tasks.length >= 3)
  // 995/B189 于 2026-08-22 按四票独立证据裁进 ARBITRATED，已从待裁台账退场
  assert.equal(sortie.SORTIE_UNRESOLVED[995], undefined)
})

test('出击：995/B189 的多血条裸引用按裁定取第二血条，边号仍是算出来的', {
  skip: (!sortieCtx || !HAS_QUESTS || !fcd) && '缺出击 fixture / quests-scn / poi-fcd-map',
}, () => {
  // memo2 裸写「3-2、5-3、6-4、7-3各取得一次S胜」。7-3 是两血条图，解析器读不出该取哪条；
  // 四票独立证据（攻略侧「7-3-2」共识 · EO 独立编码的入边 [18,23,24,25] 自标「-2」 ·
  // 中文 desc「槟榔屿海域深处」 · 一血编成不含必需舰的反证）一致指向第二血条 P 点。
  const rule = sortieOf(995)
  assert.equal(
    sortieSpots(rule),
    '3-2r6x1 5-3r6x1 6-4r6x1 7-3P[18/23/24/25]r6x1',
  )
  // 评价与次数正文都写明了（「各取得一次S胜」），裁的只是「哪一条血条」→ 不带 ≈
  assert.equal(rule.approx, false)
  assert.equal(rule.partial, false)
  // 裁定依据必须留在产物里（notes 是 UI 的悬停出处）
  assert.match(rule.notes.join(' '), /四票独立证据/)
  // 边号一个都没写死：抽掉 poi-fcd 就解不出那一格，整条弃用而不是补个 0 号边
  const blind = sortie.buildSortieRuleContext(sortieMaster, null)
  assert.equal(sortie.deriveSortieRule(995, 'B189', questRow(995).desc, questRow(995).memo2, blind), null)
  // 裁定**不是**给解析器开的口子：别的多血条裸引用照旧整条待裁
  assert.equal(madeUp('', '出击7-3取得1次S胜'), null)
  assert.equal(madeUp('', '出击7-2取得1次S胜'), null)
  assert.equal(madeUp('', '出击5-6取得1次S胜'), null)
  // 也不是给 7-3 开的口子：换个 questId 写同一张图仍是 null（上一条用例已从正文侧证过）
  assert.equal(sortie.deriveSortieRule(996, 'B189', '', questRow(995).memo2, sortieCtx), null)
  // 另一半（编成门）由编成规则自己从正文解出来，裁定不碰它：深雪改二 1 艘 + 吹雪级 1 艘
  const gate = fleet.deriveFleetRule(995, 'B189', questRow(995).desc, questRow(995).memo2, fleetCtx)
  assert.deepEqual(
    gate.fleetGoal.groups.map((group) => [group.label, group.ships, group.ctypes, group.amount]),
    [['深雪改二', [959], undefined, 1], ['吹雪级', [], [12], 1]],
  )
  assert.equal(gate.approx, false, '编成门也读全了 → 整条任务不该标 ≈')
})

test('出击：967/B176 是全库唯一一条人工裁定的任务类型', {
  skip: (!sortieCtx || !HAS_QUESTS) && '缺出击 fixture 或 quests-scn',
}, () => {
  // 「7-4 血条击破」在中文正文里与「打 Boss」长得一样，落 bossKill 会把每次打 Boss
  // 都当成通关，一路多计。日文原文说的是「作戦を完遂」，与血条口径一致。
  const rule = sortieOf(967)
  assert.deepEqual(rule.tasks, [{ kind: 'mapFirstClear', map: [7, 4], count: 1, slot: 0 }])
  assert.equal(rule.approx, true, '正文区分不出来这件事本身就是不确定，≈ 必须在')
  assert.match(rule.notes.join(' '), /作戦を完遂/)
  // 全库只此一条：别的任务不许冒出 mapFirstClear
  let firstClears = 0
  for (const idText of Object.keys(questPack.data)) {
    for (const task of sortieOf(Number(idText))?.tasks ?? []) {
      if (task.kind === 'mapFirstClear') firstClears += 1
    }
  }
  assert.equal(firstClears, 1)
})

test('出击：次数的作用域比评价窄一档', {
  skip: (!sortieCtx || !HAS_QUESTS || !fcd) && '缺出击 fixture / quests-scn / poi-fcd-map',
}, () => {
  // 897/B132「出击1-6到达终点2次，分别出击4-5、5-5、6-5并取得Boss点S胜」——
  // 「2次」写在自己带海域号的那一句里，摊到整句上会让后三张图也变成 2 次
  // （kcwiki 独立编的是各 1 次，日文原文的「反復」也只挂在 1-6 上）
  assert.equal(sortieSpots(sortieOf(897)), '1-6→N[14/17]x2 4-5r6x1 5-5r6x1 6-5r6x1')
  // 反面：次数写在「自己没有海域号」的分句里时，照旧摊给整句
  // （1033/B210「出击1-1、1-2、1-3、1-4击破Boss，取得1次S?胜」）
  assert.ok(sortieOf(1033).tasks.every((task) => task.count === 1))
  assert.equal(sortieOf(1033).tasks.length, 4)
})

test('出击：评价字母的两种边角写法', {
  skip: (!sortieCtx || !HAS_QUESTS || !fcd) && '缺出击 fixture / quests-scn / poi-fcd-map',
}, () => {
  // ① 小写：966/B175 的「s胜各1次」是全目录唯一一处，不认它这条会整体掉回 B
  assert.ok(sortieOf(966).tasks.filter((t) => 'rank' in t).every((t) => t.rank === 6))
  // 但小写字母必须**前面不粘着别的字母**才算：「Boss」的尾巴那个 s 紧挨着「胜」也不算，
  // 这一条落回没写字母的「胜利 = B 判定」，而不是被读成 S 胜
  assert.equal(sortieShape(madeUp('', '出击1-4的Boss胜利1次')), '1-4r4x1s0')
  assert.equal(sortieShape(madeUp('', '出击1-4的boss点取得胜利1次')), '1-4r4x1s0')
  // ② 「取得S」收尾：969/B178「…6-4并且要取得S」字母写明白了，只是省了「胜」字
  assert.ok(sortieOf(969).tasks.every((task) => task.rank === 6))
  assert.equal(sortieOf(969).approx, false)
  // 收得紧：字母后面还有话时不算评价，别把「取得A级驱逐舰」读成 A 胜——
  // 这条落「胜负不限 + ≈」，而不是悄悄按 A 抬高门槛
  const notARank = madeUp('', '出击1-4，取得A级驱逐舰1艘')
  assert.equal(notARank.tasks[0].rank, 0)
  assert.equal(notARank.approx, true)
})

test('出击：「?胜」的判别线与演习那边是同一条', {
  skip: (!sortieCtx || !HAS_QUESTS) && '缺出击 fixture 或 quests-scn',
}, () => {
  // 有字母（933/B159「2次S?胜」）= 中文源自标存疑，评价照取并原样传递不确定性
  assert.equal(sortieOf(933).tasks[0].rank, 6)
  assert.equal(sortieOf(933).approx, true)
  // 没字母（1044/B215「各取得1次?胜」）= 无从取值，落「胜负不限」并标 ≈
  assert.ok(sortieOf(1044).tasks.every((task) => task.rank === 0))
  assert.equal(sortieOf(1044).approx, true)
  // 911/B142「各达成1次？胜利」同理
  assert.ok(sortieOf(911).tasks.every((task) => task.rank === 0))
  // 写明白了的既不推定也不标 ≈
  assert.equal(sortieOf(944).approx, false)
  assert.equal(sortieOf(944).tasks[0].rank, 5)
  // 舰名里的大写字母不算评价：920 的 memo2 有「Fletcher改 Mod.2」，
  // 1048 有「AO、LHA」，983 的 desc 有「塞缪尔·B·罗伯茨」
  assert.equal(sortieOf(920).tasks[0].rank, 6)
  assert.equal(sortieOf(1048).tasks[0].rank, 5)
  assert.equal(sortieOf(983).tasks[0].rank, 6)
})

test('出击：次数认「次/回/场」，「第二次改装」是序数不是次数', {
  skip: (!sortieCtx || !HAS_QUESTS) && '缺出击 fixture 或 quests-scn',
}, () => {
  // 252/B27 的 desc 写「第二次改装完成的『榛名改二』」——不挡「第」就会读成 S 胜两次
  assert.equal(sortieOf(252).tasks[0].count, 1)
  // 「四选三」「2艘」「(6月)」都不是次数
  assert.equal(sortieOf(1006).tasks[0].count, 1)
  assert.equal(sortieOf(947).tasks[0].count, 1)
  // 「两次」「2次」两种写法同解
  assert.equal(sortieOf(1017).tasks[0].count, 2)
  assert.equal(sortieOf(1007).tasks[0].count, 2)
})

test('出击：「或」并列的海域共用一个计数槽', {
  skip: (!sortieCtx || !HAS_QUESTS) && '缺出击 fixture 或 quests-scn',
}, () => {
  // 241/Bw7「击破 3-3 或 3-4 或 3-5 的 BOSS 点…累积5次」：三张图任一命中即算，
  // 按各图 5 次落地的话进度条会停在 1/3 永远不满。账本 2026-08-09 交付时本地 [5]/[5]。
  const bw7 = sortieOf(241)
  assert.equal(bw7.tasks.length, 3)
  assert.equal(new Set(bw7.tasks.map((task) => task.slot)).size, 1)
  assert.ok(bw7.tasks.every((task) => task.count === 5 && task.rank === 4))
  // 对照组：884/B117 的「三者任意一艘为旗舰」在海域号**之前**，不是海域的并列，
  // 「各两次」必须还是各占各的槽——别从一个共享槽的例子泛化到整族
  const b117 = sortieOf(884)
  assert.equal(new Set(b117.tasks.map((task) => task.slot)).size, b117.tasks.length)
})

test('出击：两道整条弃用闸门', {
  skip: !sortieCtx && '缺出击 fixture',
}, () => {
  // 分类位闸门：编码首字母不是 B 的一律不做，哪怕正文通篇在说出击
  assert.equal(
    sortie.deriveSortieRule(9999, 'C99', '', '出击1-4取得1次S胜', sortieCtx),
    null,
  )
  assert.equal(sortie.deriveSortieRule(9999, 'F99', '', '出击1-4取得1次S胜', sortieCtx), null)
  // 复合任务闸门：出击之外还要求演习/远征/工厂动作的，只生成出击那一格会提前判完成
  assert.equal(madeUp('', '出击1-4取得1次S胜，并在演习中取得3次胜利'), null)
  assert.equal(madeUp('', '出击1-4取得1次S胜，并完成远征「东京急行」1次'), null)
  assert.equal(madeUp('', '出击1-4取得1次S胜，并废弃3个装备'), null)
  // 「补给舰」是舰种、「输送作战」不是远征：这两个不许被闸门误伤
  assert.equal(sortieShape(madeUp('', '以补给舰为旗舰的舰队出击1-4取得1次S胜')), '1-4r6x1s0')
  assert.equal(sortieShape(madeUp('', '实施输送作战，出击1-4取得1次S胜')), '1-4r6x1s0')
})

test('出击：备好资源那类本地判不了的门标 partial，计数照给', {
  skip: (!sortieCtx || !HAS_QUESTS) && '缺出击 fixture 或 quests-scn',
}, () => {
  // 1048/2606Bm1：出击之外还要备好 2200 弹药与 1800 铝土
  const bm1 = sortieOf(1048)
  assert.equal(sortieShape(bm1), '1-3r5x1s0 1-4r5x1s1')
  assert.equal(bm1.partial, true)
  // 反面：单纯的出击任务不许被标 partial
  assert.equal(sortieOf(944).partial, false)
})

test('出击：仲裁表只裁它写明的那几条，依据是日文原文', {
  skip: (!sortieCtx || !HAS_QUESTS) && '缺出击 fixture 或 quests-scn',
}, () => {
  // 1005/By13、1006/B197：中文写 A、EO 写 S，日文原文两条都只说「敵戦力を捕捉、これを撃破せよ」
  // ——裁不动，按「取较松者 + ≈」落中文的 A。**不是把 EO 的 S 抄过来**。
  for (const questId of [1005, 1006]) {
    const rule = sortieOf(questId)
    assert.ok(rule.tasks.every((task) => task.rank === 5), `${questId} 没落在 A`)
    assert.equal(rule.approx, true, `${questId} 裁出来的是较松者，≈ 必须保留`)
  }
  // 945/By7 是反方向的同一件事：中文写 S、EO 写 A，日文原文（账本一手）没有字母，
  // KC3Kai 只记「3 个槽各 2 次」的结构不记评价 —— 取较松者落 A。
  // 别一刀切「信中文」：1005 那次较松的恰好是中文侧
  const by7 = sortieOf(945)
  assert.ok(by7.tasks.filter((task) => 'rank' in task).every((task) => task.rank === 5))
  assert.equal(by7.approx, true)
  // 只写 why、不给 rank 的条目不许悄悄改数值：911/925/1044/1023/1041 仍然是 0 + ≈
  for (const questId of [911, 925, 1044, 1023, 1041]) {
    const rule = sortieOf(questId)
    assert.ok(
      rule.tasks.filter((task) => 'rank' in task).every((task) => task.rank === 0),
      `${questId} 被表改动了数值`,
    )
    assert.equal(rule.approx, true)
  }
  // 878/B113 的「胜利」没写字母，落 B 判定下限 + ≈ —— 台账写明日文原文也没有，
  // 不许拿 EO 的 A 把它焊死（B 比 A 松，与 ≈ 的「可能多计」同向）
  assert.ok(sortieOf(878).tasks.filter((task) => 'rank' in task).every((task) => task.rank === 4))
  assert.equal(sortieOf(878).approx, true)
  // 同一句式、没有仲裁条目的那条仍按正文读 —— 表没有悄悄改写解析器
  assert.equal(sortieOf(1018).tasks[0].rank, 5)
  assert.equal(sortieOf(1018).approx, false)
})

// ---- 编成条件 · 第一档：纯舰种数量 ----

const fleetOf = (desc, memo2 = '', questId = 0, code = '') =>
  fleet.deriveFleetRule(questId, code, desc, memo2, fleetCtx)
/** 判定走线上那道门本身，不比编码形状 */
const passes = (goal, ships) =>
  kcwiki.evaluateFleetGoal(goal, ships.map(([stype, lv = 99]) => ({
    mstId: 0, stype, ctype: 0, soku: 10, lv,
  })), 1).ok

test('编成：舰种词、数量、旗舰三样各归各位', () => {
  const rule = fleetOf('编成以轻巡为旗舰、包含驱逐舰或海防舰2只的舰队，前往南西诸岛冲警戒！')
  assert.deepEqual(rule.fleetGoal.groups.map((group) => [group.stypes, group.amount, !!group.flagship]), [
    [[3], 1, true],
    [[2, 1], 2, false],
  ])
  // 旗舰轻巡 + 2 驱逐 → 过；旗舰驱逐 → 不过（旗舰那一维真的在判）
  assert.equal(passes(rule.fleetGoal, [[3], [2], [2]]), true)
  assert.equal(passes(rule.fleetGoal, [[2], [3], [2]]), false)
  // 驱逐/海防混搭也算 2 只——「或」在词之间是并集
  assert.equal(passes(rule.fleetGoal, [[3], [2], [1]]), true)
  assert.equal(passes(rule.fleetGoal, [[3], [2]]), false)
})

test('编成：舰种词一律取最宽的合理解释', () => {
  // 「战舰」含航空战舰：2605B3 账本里 63 次真出击的旗舰是大和改二重（航空战舰），
  // 按 api_mst_stype 的字面（8/9）落地会把它们全拦下
  const bb = fleetOf('編成包含88級以上的戰艦2隻及驅逐艦2隻的精銳水上打擊部隊').fleetGoal
  assert.deepEqual(bb.groups[0].stypes, [8, 9, 10])
  assert.equal(bb.groups[0].lv, 88)
  assert.equal(passes(bb, [[10, 129], [9, 98], [2, 139], [2, 95]]), true)
  assert.equal(passes(bb, [[10, 87], [9, 87], [2, 139], [2, 95]]), false, 'Lv 下限没在判')
  // 「空母」不写「正规」时含轻空母/装甲空母；「潜水艇」含潜水空母
  assert.deepEqual(fleetOf('编成航空母舰3只及以上驱逐舰2只及以上的舰队').fleetGoal.groups[0].stypes, [7, 11, 18])
  assert.deepEqual(fleetOf('派出由伊号「潜水艇」2艘组成的潜水舰队').fleetGoal.groups[0].stypes, [13, 14])
  // 「重巡」含航巡（B87 的 memo2 自注「航巡可代替重巡」）
  assert.deepEqual(fleetOf('派出以4只重巡为基干战力并以重巡为旗舰的舰队').fleetGoal.groups[0].stypes, [5, 6])
})

test('编成：反向验证——这些写法一个都不许变成要求', () => {
  // 部队番号里的数字不是数量
  assert.equal(fleetOf('驱逐队演习：编成包含第十六驱逐队之中2艘以上的演习舰队')?.fleetGoal, undefined)
  // 队名里的舰种词不再算一遍（Cy3 的「轻巡演习舰队」）
  const cy3 = fleetOf('以包含旗舰总计3只以上轻巡级以及伴随驱逐舰2只组成的轻巡演习舰队').fleetGoal
  assert.deepEqual(cy3.groups.map((group) => group.amount), [3, 2])
  assert.equal(passes(cy3, [[21], [3], [3], [2], [2]]), true)
  // 「可以加入」是允许不是要求（Cq4）
  const cq4 = fleetOf('编成包含4艘驱逐舰或海防舰（可以加入1艘轻巡级）的演习舰队').fleetGoal
  assert.deepEqual(cq4.groups.map((group) => group.stypes), [[2, 1]])
  // 「…等」是举例不是穷举（Dy3 / D29）
  assert.equal(fleetOf('使用轻巡、驱逐等成功完成各项远征任务！')?.fleetGoal, undefined)
  // 排除词整句弃用（By14「僚舰仅包含1～3艘海防舰」）
  assert.equal(fleetOf('编成以鹈来型海防舰为旗舰的舰队').fleetGoal.groups.length, 1)
  assert.equal(fleetOf('僚舰仅包含1～3艘海防舰的舰队')?.fleetGoal, undefined)
  // 具名舰在场时整句不认：只落「驱逐舰4艘」会把 Cy1 的「七艘里凑四艘」读成「必须四驱逐」
  assert.equal(
    fleetOf('编成含有「Warspite」「金刚」「Ark Royal」「Nelson」以及J级驱逐舰4艘以上的舰队！')?.fleetGoal,
    undefined,
  )
  // 敌方舰种不是自军编成要求
  assert.equal(fleetOf('编成舰队，捕捉敌驱逐舰2艘并击沉！')?.fleetGoal, undefined)
})

test('编成：旗舰只认极短连接，「+」是硬分隔', () => {
  // Cy13 memo2「秋月型旗舰+2航空战舰+2驱逐舰」：旗舰属于秋月型（本档读不出），
  // 认宽了就会把旗舰门错安到航空战舰上——那是门变严的方向
  const rule = fleetOf('', '需要秋月型旗舰+2航空战舰+2驱逐舰+自由舰 演习4回A胜')
  assert.equal(rule.fleetGoal.groups.find((group) => group.stypes.includes(10))?.flagship, undefined)
  assert.equal(rule.fleetGoal.groups.find((group) => group.ctypes?.length)?.flagship, true)
  // 「包含旗舰共计四艘「重巡洋舰」」这种隔着数量的写法仍要认出来（Cy5）
  const cy5 = fleetOf('以包含旗舰共计四艘「重巡洋舰」或「航空巡洋舰」的巡洋舰战队为骨干，并且编入两艘驱逐舰为僚舰').fleetGoal
  assert.equal(cy5.groups[0].flagship, true)
  assert.deepEqual(cy5.groups[0].stypes, [5, 6])
  assert.equal(passes(cy5, [[5], [5], [6], [6], [2], [2]]), true)
  assert.equal(passes(cy5, [[2], [5], [5], [6], [6], [2]]), false, '旗舰不是重巡也放行了')
})

test('编成：组间「或」引擎表达不了，整条门弃用并标 ≈', () => {
  // B201「3艘以上海防舰或者海防舰和驱逐舰合计4艘以上」：并成一组会得到「海防/驱逐≥4」，
  // 把只带 3 海防的合规编成拦下
  const b201 = fleetOf('派出包含3艘以上海防舰或者海防舰和驱逐舰合计4艘以上的小规模哨戒部队')
  assert.equal(b201.fleetGoal, undefined)
  assert.equal(b201.approx, true)
  // 另一套编成方案另起一句的写法（B138「…，或者驱逐舰4艘的舰队」）同样整条弃用
  const b138 = fleetOf('其他重巡级1艘驱逐舰2艘的舰队，或者驱逐舰4艘的舰队')
  assert.equal(b138.fleetGoal, undefined)
  assert.equal(b138.approx, true)
  // 但纯词并列（没有各自的数量）仍是并集，不许连它一起丢
  assert.deepEqual(
    fleetOf('编成含三艘驱逐舰或者海防舰在内的护卫舰队').fleetGoal.groups.map((group) => group.stypes),
    [[2, 1]],
  )
})

test('编成：同一批舰被重述不算两个名额，写明「其他」的才算', () => {
  // Bm7「以「驱逐舰」为旗舰，「重巡」1艘「轻巡」1艘「驱逐舰」4艘」= 四驱逐里含旗舰，不是五艘
  const bm7 = fleetOf('派出以「驱逐舰」为旗舰，「重巡」1艘「轻巡」1艘「驱逐舰」4艘组成的水上挺身部队').fleetGoal
  assert.equal(bm7.groups.filter((group) => group.stypes.includes(2)).length, 1)
  assert.equal(passes(bm7, [[2], [5], [3], [2], [2], [2]]), true)
  // C46「以正规空母为旗舰，且包含1艘其他正规空母」= 真的两艘
  const c46 = fleetOf('编成以「正规空母」为旗舰，且包含1艘其他「正规空母」以及2艘「驱逐舰」的演习舰队').fleetGoal
  assert.equal(c46.groups.filter((group) => group.stypes.includes(11)).length, 2)
  assert.equal(passes(c46, [[11], [11], [2], [2]]), true)
  assert.equal(passes(c46, [[11], [2], [2]]), false, '一艘正规空母就放行了')
})

// ---- 编成条件 · 第二档：具名舰与旗舰 ----

/** 具名舰判定同样走线上那道门；ctype 用 fixture 里的舰级号 */
const passesShips = (goal, ships) =>
  kcwiki.evaluateFleetGoal(goal, ships.map(([mstId, stype, ctype = 0, lv = 99]) => ({
    mstId, stype, ctype, soku: 10, lv,
  })), 1).ok

test('编成：具名舰的形态只认列举——素名是整链，写明形态只认写明的', () => {
  // 素名（链根）= 任意形态：B33 的「时雨」拿时雨改三跑也算
  const plain = fleetOf('编成包含「时雨」的舰队出击').fleetGoal
  assert.deepEqual(plain.groups[0].ships.sort((a, b) => a - b), [44, 145, 243, 961])
  // 写明形态 = 只认写明的：不做「写改则改二也算」这种结构推断
  const written = fleetOf('编成包含「时雨改二」的舰队出击').fleetGoal
  assert.deepEqual(written.groups[0].ships, [145])
  // 正文**列举**了追加形态才补入（B121 的「时雨改三可」）——这是文本背书，不是推断
  const listed = fleetOf('编成包含「时雨改二」的舰队出击', '时雨改三可').fleetGoal
  assert.deepEqual(listed.groups[0].ships.sort((a, b) => a - b), [145, 961])
})

test('编成：三种「正文自己写的放宽」都要跟上，否则门比游戏严', () => {
  // ①「改二也可」：By13 的「【胧改、曙改、涟改、潮改】（改二也可）」按字面只认「改」，
  //    会把改二的合规编成全拦下
  const later = fleetOf('编成包含「白雪改」的舰队（改二也可）').fleetGoal
  assert.deepEqual(later.groups[0].ships.sort((a, b) => a - b), [622, 623])
  // ② 斜杠后那截是省写的形态（B188 的「凤翔改二/战」），索引里查不到 → 放宽到后继形态
  const slash = fleetOf('以旗舰为「凤翔改二/战」的舰队出击').fleetGoal
  assert.ok(slash.groups[0].ships.includes(899), '凤翔改二战 被拦下了')
  // ②' 括号式的省写形态（B166 的「最上改二（或改二特）」、B169 的「龙凤改二（含改二戊）」）
  const paren = fleetOf('以旗舰为「白雪改（或改二）」的舰队出击').fleetGoal
  assert.deepEqual(paren.groups[0].ships.sort((a, b) => a - b), [622, 623])
  // ③ 括号里那艘是别名，而且可能是**前身**（B177 的「「云鹰」（八幡丸也可）」）
  const alias = fleetOf('编成空母「云鹰」（八幡丸也可）为旗舰的舰队').fleetGoal
  const carrier = alias.groups.find((group) => group.ships.length)
  assert.ok(carrier.ships.includes(522) && carrier.ships.includes(884))
  assert.equal(passesShips(alias, [[522, 7]]), true, '八幡丸 一艘就该过')
})

test('编成：具名舰组不占去重名额，「含具名舰」才不会凭空多要一艘', () => {
  // C51「雪风旗舰 + 驱逐舰4艘」：EO 的意思是四艘驱逐里可以有雪风。
  // 照 QpFleetGoal 默认的「各组不同舰」办就成了雪风 + 另外四艘，比游戏严一艘。
  const rule = fleetOf('编成包含旗舰「雪风」总计驱逐舰4艘以上的精强演习部队').fleetGoal
  assert.ok(rule.groups.find((group) => group.ships.length).overlapOk)
  assert.equal(passesShips(rule, [[656, 2], [201, 2], [202, 2], [132, 2]]), true)
  assert.equal(passesShips(rule, [[656, 2], [201, 2], [202, 2]]), false, '只有三艘驱逐也放行了')
  // 旗舰那一维仍然在判
  assert.equal(passesShips(rule, [[201, 2], [656, 2], [202, 2], [132, 2]]), false)
})

test('编成：并列的具名舰是「都要」，「或」才是「二选一」', () => {
  // B13 第四战队：四艘都要，引号紧挨着不代表二选一
  const all = fleetOf('派出由「爱宕」「高雄」「鸟海」「摩耶」为基干的第四战队').fleetGoal
  assert.equal(all.groups.length, 4)
  assert.equal(passesShips(all, [[67, 5], [66, 5], [69, 5], [68, 5]]), true)
  assert.equal(passesShips(all, [[67, 5], [66, 5], [69, 5]]), false)
  // Cy7：「旗舰「黑潮改二」或「亲潮改二」」= 一个组两艘候选
  const either = fleetOf('旗舰「黑潮改二」或「親潮改二」，另一只置于2号舰').fleetGoal
  assert.equal(either.groups.length, 1)
  assert.equal(passesShips(either, [[670, 2], [568, 2]]), true)
  assert.equal(passesShips(either, [[568, 2], [670, 2]]), true)
  // 同一艘舰的两个形态（B61 的「「白露改」/「白露改二」为旗舰」）也是一个组
  const forms = fleetOf('以「白露改」/「白露改二」为旗舰的舰队').fleetGoal
  assert.equal(forms.groups.length, 1)
  assert.equal(passesShips(forms, [[242, 2]]), true)
  assert.equal(passesShips(forms, [[497, 2]]), true)
})

test('编成：具名舰的反向验证——队号、舰级、常用词都不许变成具名舰门', () => {
  // 「四航战」是第四航空戦隊的简称，不是「航空战舰4艘」（B132 实测凭空多要三艘）。
  // 正文自己把成员列出来了（日向改二/伊势改二 都是四航战的人），队名就不再另立一组
  const squadron = fleetOf('包含「日向改二」「伊势改二」的最新锐「四航战」的第一舰队').fleetGoal
  assert.equal(squadron.groups.length, 2)
  assert.ok(squadron.groups.every((group) => !group.stypes.length))
  assert.deepEqual(squadron.groups.map((group) => group.ships), [[554], [553]])
  // 「秋月型」是舰级引用，不是秋月本人：判定走 ctypes，不是把秋月一个人焊死
  const klass = fleetOf('编成以“秋月型”驱逐舰为旗舰、包含2艘以上航空战舰的舰队').fleetGoal
  const akizuki = klass.groups.find((group) => group.ctypes?.length)
  assert.deepEqual(akizuki.ctypes, [54])
  assert.deepEqual(akizuki.ships, [], '「秋月型」被当成秋月本人了')
  // 紧跟在舰级后面的「驱逐舰」是在称呼它，不是另加一艘驱逐
  assert.ok(klass.groups.every((group) => !group.stypes.includes(2)))
  // 中文译名撞常用词：「演习胜利三次」不许长出一道「必须带 Victorious」的门
  assert.equal(fleetOf('用配备了两艘以上轻巡的第一舰队在今天内演习胜利三次').fleetGoal.groups.length, 1)
  // 舰种词紧挨着具名舰是在**称呼**这艘舰，不是另一条要求
  // （B196 的三隈改二特是水上机母舰，「航空巡洋舰≥1」那道门把它一个人的编成拦下过）
  const before = fleetOf('以旗舰配备改装重巡洋舰「爱宕」的舰队出击').fleetGoal
  assert.deepEqual(before.groups.map((group) => group.ships), [[67]])
  const after = fleetOf('编成以「爱宕」型重巡作为旗舰的舰队出击').fleetGoal
  assert.deepEqual(after.groups.map((group) => group.ships), [[67]])
  // 一个字的舰名只在两边都不是字时才认
  const single = fleetOf('编成含有「爱宕」「高雄」、随伴护卫驱逐舰「胧」「秋云」的机动部队').fleetGoal
  assert.ok(single.groups.some((group) => group.ships.includes(93)), '「胧」没认出来')
  assert.equal(fleetOf('编成舰队，退潮时出击并取得胜利')?.fleetGoal, undefined)
})

// ---- 编成条件 · 第三档：凑数、舰级、国籍 ----

test('编成：「A、B、C 里凑 N 艘」并成一个组，不是「N 艘都要」', () => {
  const choose = fleetOf('编成包含「爱宕」「高雄」「鸟海」「摩耶」之中2艘以上的演习舰队').fleetGoal
  assert.equal(choose.groups.length, 1)
  assert.equal(choose.groups[0].amount, 2)
  assert.equal(passesShips(choose, [[67, 5], [66, 5]]), true)
  assert.equal(passesShips(choose, [[67, 5]]), false, '一艘也放行了')
  // Bq6 的凑数句被逗号切成独立一句、一个编成词都没有：候选名单要跨句并起来，
  // 只认最后一句会把前面那艘读成「必须带」（实测拦下 36 队）
  const apart = fleetOf('', '配以「爱宕」，「高雄」或「鸟海」中的一艘，加上其他舰编成舰队').fleetGoal
  assert.equal(apart.groups.length, 1)
  assert.equal(apart.groups[0].amount, 1)
  assert.equal(passesShips(apart, [[69, 5]]), true, '只带鸟海就该过')
  assert.equal(passesShips(apart, [[67, 5]]), true, '只带爱宕也该过')
  // 名单里有一艘认不出，凑数集就是残缺的（同样的 N 配更小的集合＝门更严）→ 整条弃用
  const missing = fleetOf('编成包含「吞武里」、「爱宕」、「高雄」之中2艘以上的舰队')
  assert.equal(missing?.fleetGoal, undefined)
  assert.equal(missing.approx, true)
})

test('编成：舰级引用走 ctypes，国籍走 api_sort_id 编号段', () => {
  // 舰级：「吹雪型1艘以上」= 同型任意一艘，不是吹雪本人
  const klass = fleetOf('编成包含吹雪型1艘以上的精锐舰队').fleetGoal
  assert.deepEqual(klass.groups[0].ctypes, [12])
  assert.equal(passesShips(klass, [[202, 2, 12]]), true, '同型的白雪该算')
  assert.equal(passesShips(klass, [[421, 2, 54]]), false, '别的级也算了')
  // 国籍：数量是这一组自己的（「2只以上」），不是舰名串的总数
  const nation = fleetOf('编成包含美军（USS）舰娘2只以上的舰队').fleetGoal
  assert.equal(nation.groups[0].amount, 2)
  assert.deepEqual(nation.groups[0].ships.sort((a, b) => a - b), [562, 563, 564])
  assert.equal(passesShips(nation, [[562, 2], [563, 2]]), true)
  assert.equal(passesShips(nation, [[562, 2], [201, 2]]), false, '一艘美舰也放行了')
  assert.ok(nation.groups[0].overlapOk, '国籍组占了去重名额（B149 那条纪律）')
  // 名字自带空格/点号的外文舰名照样要认出来——认不出会让凑数集偏小、门变严
  const latin = fleetOf('编成包含「Samuel B.Roberts」「Gambier Bay」之中1艘以上的舰队').fleetGoal
  assert.deepEqual(latin.groups[0].ships.sort((a, b) => a - b), [563, 564])
  // 单个「美」「英」不算国籍门——必须写成「…舰娘/舰艇」那种整体
  assert.equal(fleetOf('编成舰队出击，与美军交战并取得胜利')?.fleetGoal, undefined)
})

test('编成：具名舰组的数量恒为 1——跟在舰名串后面的数字是总数', () => {
  // C27「矶风乙改、浜风乙改、浦风丁改、谷风丁改四艘编成」按字面读 = 四艘谷风丁改
  const rule = fleetOf('编成包含「爱宕」、「高雄」、「鸟海」、「摩耶」四艘的舰队').fleetGoal
  assert.ok(rule.groups.every((group) => group.amount === 1))
  assert.equal(passesShips(rule, [[67, 5], [66, 5], [69, 5], [68, 5]]), true)
})

test('编成：仲裁台账只裁它写明的那一条，依据写在表里', () => {
  const ledger = fleet.FLEET_ARBITRATED
  assert.ok(ledger[1025]?.noFlagship, '1025 的仲裁条目没了')
  for (const [questId, entry] of Object.entries(ledger)) {
    assert.ok(entry.why.length > 60, `${questId} 的仲裁没写依据`)
    assert.ok(entry.drop || entry.noFlagship || entry.keep, `${questId} 三种裁法一个都没写，等于没裁`)
  }
  // 裁定的是「旗舰那一维拆掉」，不是整条不做：队里得有白雪改二这件事仍然在判
  const ruled = fleet.deriveFleetRule(1025, 'B208', '以“白雪改二”旗舰的精锐舰队出击', '', fleetCtx)
  assert.ok(ruled.fleetGoal.groups.every((group) => !group.flagship))
  assert.equal(ruled.approx, true)
  assert.equal(passesShips(ruled.fleetGoal, [[201, 2], [623, 2]]), true, '不作旗舰也该过')
  assert.equal(passesShips(ruled.fleetGoal, [[201, 2], [202, 2]]), false, '队里没有白雪改二也放行了')
  // 同一句式、没有仲裁条目的那条仍按正文读——表没有悄悄改写解析器
  const plain = fleet.deriveFleetRule(999999, 'ZZ99', '以“白雪改二”旗舰的精锐舰队出击', '', fleetCtx)
  assert.equal(plain.fleetGoal.groups[0].flagship, true)
})

test('编成：数量的作用域只到相邻舰种词为止', () => {
  // C31「…以及驱逐舰2只以上的空母机动部队」：那个「2只」是驱逐舰的，
  // 越过它读给空母就凭空多要一艘空母
  const c31 = fleetOf('编成包含正规航母旗舰加另外1只总计2只以上，以及驱逐舰2只以上的空母机动部队').fleetGoal
  const carrier = c31.groups.find((group) => group.stypes.length === 3)
  assert.equal(carrier.amount, 1)
  assert.equal(c31.groups.find((group) => group.stypes[0] === 2).amount, 2)
  // 「1～3艘」取下界：上界引擎表达不了，取上界会把门装严
  assert.equal(fleetOf('编成包含1～3艘海防舰的护卫舰队').fleetGoal.groups[0].amount, 1)
})

test('出击：全库跑一遍，结构不变式处处成立，覆盖面不塌方', {
  skip: (!sortieCtx || !HAS_QUESTS) && '缺出击 fixture 或 quests-scn',
}, () => {
  let derived = 0
  for (const [idText, row] of Object.entries(questPack.data)) {
    const rule = sortieOf(Number(idText))
    if (!rule) continue
    derived += 1
    const where = `${idText} ${row?.code ?? ''}`
    assert.ok(rule.tasks.length > 0, `${where} 有规则却没有子项`)
    const slots = [...new Set(rule.tasks.map((task) => task.slot))].sort((a, b) => a - b)
    // 槽号必须显式、从 0 起、连续：留空让下标兜底会在共享槽那里错开一格，进度数组从此串位
    assert.deepEqual(slots, slots.map((_, index) => index), `${where} 槽号不连续`)
    const spots = new Set()
    for (const task of rule.tasks) {
      assert.ok(
        ['bossKill', 'battleNode', 'nodeReach', 'mapFirstClear', 'mapGoal'].includes(task.kind),
        `${where} 出了出击类之外的子项 ${task.kind}`,
      )
      if (task.kind === 'mapGoal') {
        // mapGoal 只许出现在护航终点图（isEscortGoalMap 的口径）：它是 880/B115 人工
        // 台账用的无点位号等价编码，解析器自己对 1-6 仍然产 nodeReach，别混
        assert.ok(task.map[0] === 1 && task.map[1] === 6, `${where} mapGoal 落在了非护航终点图`)
      }
      assert.ok(Number.isInteger(task.count) && task.count > 0, `${where} 次数不是正整数`)
      assert.ok(sortieCtx.hasMap(task.map), `${where} 指向主数据里没有的海域 ${task.map}`)
      if ('rank' in task) assert.ok(task.rank >= 0 && task.rank <= 6, `${where} 评价越界`)
      if (task.kind === 'bossKill') {
        // 多血条图 / 护航图的裸引用必须已经在闸门那儿被拦掉
        assert.equal(nodes.questMapGaugeCount(task.map), 0, `${where} 多血条图落成了裸 bossKill`)
        assert.equal(task.map[0] * 10 + task.map[1] !== 16, true, `${where} 1-6 没有 Boss`)
      }
      if (task.kind === 'battleNode' || task.kind === 'nodeReach') {
        // 边号零硬编码：产出的每一组都必须能由 poi-fcd 对该格子重新算出来
        assert.ok(task.nodes.length > 0, `${where} 点位任务没有入边——空 nodes 会退化成整图通配`)
        assert.ok(task.name, `${where} 点位任务没写是哪一格`)
        if (fcd) {
          assert.deepEqual(
            task.nodes,
            nodes.questMapNodeIds(fcd, task.map, task.name),
            `${where} 的入边不是从 poi-fcd 算出来的`,
          )
        }
      }
      // 去重按「图 + 点位」：同一张图的两个血条是两格要求，按图去重会吃掉一格
      const key = `${task.map[0]}-${task.map[1]}${task.name ? `:${task.name}` : ''}`
      assert.ok(!spots.has(key), `${where} 同一格出现了两次`)
      spots.add(key)
    }
    // 同一个槽里的多条只能是「任一命中」的备选，数量与评价必须一致
    for (const slot of slots) {
      const inSlot = rule.tasks.filter((task) => task.slot === slot)
      assert.equal(new Set(inSlot.map((task) => task.count)).size, 1, `${where} 同槽次数不一致`)
      assert.equal(new Set(inSlot.map((task) => task.rank)).size, 1, `${where} 同槽评价不一致`)
    }
  }
  // 门槛钉在「别整体塌方」，具体条数由 scripts/quest-selfderive-diff.mjs 逐条把关
  assert.ok(derived >= 160, `全库只解出 ${derived} 条出击规则，解析器可能整体退化了`)
})

// ---- 已知源错误的修正台账 ----

const LEDGER = conflicts.KNOWN_QUEST_SOURCE_CONFLICTS
const RANK_LETTER = { 6: 'S', 5: 'A', 4: 'B' }

test('台账每一条都拿得出日文原文，而且原文真的支持那个修正值', () => {
  assert.ok(LEDGER.length > 0, '台账空了？那 applyQuestSourceConflicts 就是死代码')
  const ids = LEDGER.map((entry) => entry.questId)
  assert.equal(new Set(ids).size, ids.length, '同一条任务不该在台账里出现两次')
  for (const entry of LEDGER) {
    assert.ok(entry.jp.length > 20, `${entry.code} 没留日文原文，这条裁决就没有依据`)
    assert.ok(entry.why.length > 0, `${entry.code} 没写错在哪`)
    // 改前改后必须真的不同——相同就说明上游修好了，台账该退休而不是继续挂着
    assert.equal(
      conflicts.sameQuestTasks(entry.upstream, entry.tasks),
      false,
      `${entry.code} 的修正值与上游相同，台账该清理`,
    )
    for (const task of entry.tasks) {
      if (task.kind !== 'exercise') continue
      // 评价：日文原文里必须真有那个判定字母；次数：必须真有那个「N回」
      assert.match(entry.jp, new RegExp(`【${RANK_LETTER[task.rank]}判定】`), `${entry.code} 的评价与日文原文对不上`)
      assert.match(entry.jp, new RegExp(`${task.count}回`), `${entry.code} 的次数与日文原文对不上`)
    }
  }
  // 434 是唯一一条「共享槽 → 各自一槽」的：日文写明「各任務」，上游却挤在一个槽里
  const dy1 = LEDGER.find((entry) => entry.questId === 434)
  assert.match(dy1.jp, /各任務/)
  assert.equal(new Set(dy1.upstream.map((task) => task.slot)).size, 1)
  assert.equal(new Set(dy1.tasks.map((task) => task.slot)).size, dy1.tasks.length)
})

test('台账只改指纹对得上的那几条，源一变就撒手', () => {
  const make = () => new Map(LEDGER.map((entry) => [
    entry.questId,
    { source: entry.source, tasks: entry.upstream.map((task) => ({ ...task })) },
  ]))
  // 正常情形：逐条打补丁
  const normal = make()
  assert.equal(conflicts.applyQuestSourceConflicts(normal), LEDGER.length)
  for (const entry of LEDGER) {
    assert.ok(conflicts.sameQuestTasks(normal.get(entry.questId).tasks, entry.tasks), `${entry.code} 没打上`)
  }
  // 上游改了（比如 kcwiki 自己把评价补上了）：指纹对不上，**不许**再照台账改写
  const moved = make()
  const sample = LEDGER[0]
  moved.get(sample.questId).tasks = [{ kind: 'exercise', rank: 6, count: 99 }]
  const skipped = []
  assert.equal(
    conflicts.applyQuestSourceConflicts(moved, (entry, reason) => skipped.push([entry.questId, reason])),
    LEDGER.length - 1,
  )
  assert.deepEqual(moved.get(sample.questId).tasks, [{ kind: 'exercise', rank: 6, count: 99 }])
  assert.equal(skipped.length, 1)
  assert.equal(skipped[0][0], sample.questId)
  // 这条任务改由别的源供给了：同样撒手
  const reSourced = make()
  reSourced.get(sample.questId).source = 'text'
  assert.equal(conflicts.applyQuestSourceConflicts(reSourced), LEDGER.length - 1)
  assert.ok(conflicts.sameQuestTasks(reSourced.get(sample.questId).tasks, sample.upstream))
  // 台账外的追踪器一根汗毛都不许动
  const others = new Map([[999999, { source: 'kcwiki', tasks: [{ kind: 'exercise', rank: 4, count: 1 }] }]])
  assert.equal(conflicts.applyQuestSourceConflicts(others), 0)
  assert.deepEqual(others.get(999999).tasks, [{ kind: 'exercise', rank: 4, count: 1 }])
})

test('装上真矿脉与真主数据之后，台账那几条真的改过来了', {
  skip: (() => {
    const snap = userDataPathIfAny('snapshots', 'kcsapi_api_start2_getData.json')
    return (!snap || !fs.existsSync(snap) || !questPack) && '本机没有 api_start2 快照或 quests-scn'
  })(),
}, () => {
  const snapshot = JSON.parse(
    fs.readFileSync(userDataPath('snapshots', 'kcsapi_api_start2_getData.json'), 'utf8'),
  )
  const lodes = {}
  for (const id of [
    'quests-scn', 'kcwiki-localization', 'kcwiki-quest-req',
    'poi-quest-goal', 'kcwiki-expedition', 'poi-fcd-map',
  ]) lodes[id] = readLode(id)
  const state = {
    player: { quests: {}, decks: [], ships: {}, slotitems: {}, materials: [], useitems: {} },
    sortie: null,
  }
  const engine = engineBundle.module.createQuestEngine({
    getLode: (id) => lodes[id] ?? null,
    ledger: {
      loadSnapshot: () => snapshot,
      loadQuestProgress: () => ({}),
      saveQuestProgress: () => {},
      deleteQuestProgress: () => {},
    },
    store: { getState: () => state },
    send: () => {},
  })
  quiet(() => engine.init())
  const trackers = engine.state().trackers
  for (const entry of LEDGER) {
    const tracker = trackers[entry.questId]
    assert.ok(tracker, `${entry.code} 没有追踪器，台账落不下去`)
    assert.ok(
      conflicts.sameQuestTasks(tracker.tasks, entry.tasks),
      `${entry.code} 线上仍是 ${JSON.stringify(tracker.tasks)}，台账没生效`,
    )
    // 源不变：台账只改判定内容，不改「这条是谁供给的」
    assert.equal(tracker.source, entry.source)
  }
  // 对照组：410/Dw2 的共享槽是**对的**（日文「「東京急行」系遠征」，账本三次交付实证），
  // 别顺着 434 把整族翻案
  assert.equal(new Set(trackers[410].tasks.map((task) => task.slot ?? 0)).size, 1)
  assert.equal(trackers[410].tasks.length, 2)
  // 301/C1、303/Cd1 的「胜负不限」也是对的：日文连「勝利」都没写
  assert.equal(trackers[301].tasks[0].rank, 0)
  assert.equal(trackers[303].tasks[0].rank, 0)
})

// ---- 编成条件 · 第四档：正文里的队名接史实编队注册表 ----

/** 队名那一族走 histCtx（真 mstId）；code 是期别裁定的钥匙 */
const histOf = (desc, memo2 = '', code = '') =>
  fleet.deriveFleetRule(0, code, desc, memo2, histCtx)
const passesHist = (goal, mstIds) =>
  kcwiki.evaluateFleetGoal(goal, mstIds.map((mstId) => ({
    mstId,
    stype: histFleetMaster.api_mst_ship.find((ship) => ship.api_id === mstId)?.api_stype ?? 0,
    ctype: histFleetMaster.api_mst_ship.find((ship) => ship.api_id === mstId)?.api_ctype ?? 0,
    soku: 10,
    lv: 99,
  })), 1).ok

test('队名：正文只写队名时，成员来自注册表，数量仍从正文读', () => {
  // F136「为他配备3艘以上第三十二驱逐队」——desc 一个成员名都没有
  const rule = histOf('为他配备3艘以上第三十二驱逐队', '', 'F136')
  const squad = rule.fleetGoal.groups.find((group) => group.amount === 3)
  assert.ok(squad, '队名没落成组，或者数量被归一成了 1')
  // 玉波/凉波/藤波/早波/浜波 五个人的**整条改造链**都算这支队
  for (const mstId of [674, 718, 1033, 675, 710, 485, 373, 528, 688, 484, 680, 983]) {
    assert.ok(squad.ships.includes(mstId), `${mstId} 不在第三十二驱逐队的门里`)
  }
  // 三艘队员过、两艘不过——数量真的在判
  assert.equal(passesHist(rule.fleetGoal, [674, 675, 485]), true)
  assert.equal(passesHist(rule.fleetGoal, [674, 675]), false)
  // 不是这支队的人凑不出数（朝霜属第二驱逐队后期编成，不属三十二驱）
  assert.equal(passesHist(rule.fleetGoal, [674, 675, 425]), false)
})

test('队名：正文自己列了成员就以正文为准，队名不再另立一组', () => {
  // 同位语写法（队名 + 紧跟着的成员）：Cy4「第七驱逐队「胧」「曙」…」那一族
  const listed = histOf('编成含有第三十二驱逐队「玉波」「凉波」「藤波」「早波」4只的舰队', '', 'F136')
  assert.deepEqual(
    listed.fleetGoal.groups.map((group) => group.ships.length),
    [3, 4, 3, 3],
    '队名多长出了一组，或者把四艘并成了一个池子',
  )
  // 不挨着也算：判据不只看位置，还看「这一句点名的舰是不是这支队的人」
  // （Cy15 的标题【第三战队演习】离「比睿」隔着半句，位置判据够不着）
  const far = histOf('编成第三十二驱逐队精锐部队并以「玉波」为旗舰', '', 'F136')
  assert.equal(far.fleetGoal.groups.length, 1, '队名多长出了一组')
  assert.deepEqual(far.fleetGoal.groups[0].ships, [674, 718, 1033])
  assert.equal(far.fleetGoal.groups[0].flagship, true)
})

test('队名：期别按注册表自己的 questRefs 裁，裁不出来落最宽的并集并标 ≈', () => {
  // 三川舰队在注册表里有三期；B11 只写在 mikawa-1 的 questRefs 里 → 只取那一期
  const one = histOf('派出新编成的「三川舰队」出击', '', 'B11')
  const picked = one.fleetGoal.groups[0]
  assert.equal(one.approx, false, '裁得出期别就不该标 ≈')
  assert.ok(picked.ships.includes(51), '天龙（初编成员）不在门里')
  assert.ok(!picked.ships.includes(123), '衣笠只在全编那一期，不该混进初编')
  // 没有任何一期点名这条任务 → 三期并集 + ≈（永不默认选最新的一期）
  const widened = histOf('派出「三川舰队」出击', '', 'ZZ99')
  assert.equal(widened.approx, true, '期别裁不出来却没标 ≈')
  const union = widened.fleetGoal.groups[0]
  assert.ok(union.ships.includes(123), '并集里少了衣笠（全编期）')
  assert.ok(union.ships.includes(115), '并集里少了夕张（突入期）')
  // 并集只会更松：初编那队在两种解法下都过得去
  assert.equal(passesHist(one.fleetGoal, [69, 61, 60, 59, 51]), true)
  assert.equal(passesHist(widened.fleetGoal, [69, 61, 60, 59, 51]), true)
})

test('队名：反向验证——这些写法一个都不许因为接了注册表而变样', () => {
  // ① 队名与具名舰之间的「或」是组间二选一，不许被并成一个池子（Bq13）
  const either = histOf('包含随伴第三十二驱逐队驱逐舰2艘以上或「朝霜」的舰队', '', 'F136')
  assert.equal(either.fleetGoal, undefined, '组间「或」被并成并集组了')
  assert.equal(either.approx, true)
  // ② 成员表为空的条目（第六舰队＝潜母1+潜水4、海上护卫总队）不进门
  assert.equal(histOf('派出「第六舰队」出击', '', 'A37')?.fleetGoal, undefined)
  assert.equal(histOf('编成「海上护卫总队」', '', 'B100')?.fleetGoal, undefined)
  // ③ 两字缩写不收：「二驱」「七驱」单独出现时歧义太大
  assert.equal(histCtx.histFleetsOf('二驱'), null)
  assert.ok(histCtx.histFleetsOf('第三十二驱逐队'), '三字以上的队名应当收')
  // ④ 注册表里没有的番号照旧当队号盖掉，不许变成舰种门
  assert.equal(histOf('派出「第九驱逐队」出击的舰队', '', 'ZZ99')?.fleetGoal, undefined)
})

test('编成：旗舰不并进「凑几艘」的名单——那是两个位置', () => {
  // B167「以「最上改二（或改二特）」作为旗舰，配备时雨・满潮・朝云・山云其中2艘」
  const b167 = histOf(
    '以「最上改二（或改二特）」作为旗舰，配备时雨・满潮・朝云・山云其中2艘的舰队，出击并消灭敌舰',
    '',
    'B167',
  ).fleetGoal
  const flag = b167.groups.find((group) => group.flagship)
  const pool = b167.groups.find((group) => !group.flagship)
  assert.deepEqual([...flag.ships].sort((a, b) => a - b), [501, 506], '旗舰组不是最上改二/改二特')
  assert.equal(flag.amount, 1)
  assert.equal(pool.amount, 2)
  assert.ok(!pool.ships.includes(501), '最上改二混进了僚舰池')
  // 正向：最上改二特当旗舰 + 池子里两艘 → 过
  assert.equal(passesHist(b167, [506, 43, 97]), true)
  assert.equal(passesHist(b167, [501, 413, 414]), true)
  // 反向：時雨当旗舰 + 満潮（并成一个组时会误放行，游戏不认）
  assert.equal(passesHist(b167, [43, 97, 413]), false, '旗舰又被并进池子了')
  // 反向：旗舰对了但僚舰只有一艘
  assert.equal(passesHist(b167, [501, 43]), false)
})

test('编成：等级下限吃掉的数字不再当数量', () => {
  // F134「以Lv.96以上的驱逐舰为旗舰」——96 是等级，落成「96 艘驱逐舰」就没有编成过得去
  const lv = fleetOf('以Lv.96以上的驱逐舰为旗舰，第一槽装备三式爆雷投射机').fleetGoal
  assert.equal(lv.groups[0].amount, 1)
  assert.equal(lv.groups[0].lv, 96)
  assert.deepEqual(lv.groups[0].stypes, [2])
  // 等级线仍然在判
  assert.equal(passesShips(lv, [[43, 2, 20, 96]]), true)
  assert.equal(passesShips(lv, [[43, 2, 20, 95]]), false)
})

test('编成：斜杠省写形态不许把「或」后面那一半吞掉', () => {
  // F103「山風改二/丁或時雨改二」——按最长四字量出来的是「丁或時雨」，
  // 吞掉之后门只剩前一半，时雨改二当秘书舰会被拦下
  const rule = fleetOf('以「凤翔改二/战」或「时雨改二」为旗舰的舰队').fleetGoal
  for (const mstId of [894, 899, 145]) {
    assert.ok(rule.groups[0].ships.includes(mstId), `${mstId} 被省写段吞掉了`)
  }
  assert.equal(passesShips(rule, [[145, 2]]), true, '「或」后面那一半当旗舰被拦下了')
})

/**
 * 注册表 × 线上编成门 的对账台账（2026-08-22 逐条核过）。
 *
 * 判据：注册表某条队的成员，在**引用了这支队**的那条任务的门里认不认得出来。
 * 全 184 条 (条目 × questRef) 里 166 条全覆盖；下面这 18 条不覆盖，逐条查明原因。
 *
 * 覆盖的尺子与门用的同一把：**按整条改造链量**。cd-04 第四航空战队记的是 A60 那一期
 * 要的 伊勢改／日向改，而 B132 要的是改二——按链量就对得上，按写明形态量会判成分歧，
 * 而且拿写明形态去装门会把 B132 带改二的合规编成拦下（见 quest-fleet-rules 的队名索引）。
 * **一条都不是注册表写错了**——差异都出在「这条任务只要这支队的一部分」
 * 或「引擎表达不了这条任务的形状」。
 *
 * `role: 'mentions'` 的天然可以不覆盖：那条任务只是引用队名，要的是队里的某几个人。
 * 只有 `defines`（正文界定了成员表）才该覆盖，下面四条 defines 的例外各有依据。
 */
const HIST_FLEET_RECONCILE = [
  { entry: 'dd-02-2', code: 'Cy16', why: '两级嵌套的 n 选 m + 旗舰子集，groups 的合取装不下 → 整条无门（分析 §2 已判「救不了」）' },
  { entry: 'sq-05-hg', code: 'B138', why: '「其他重巡级1艘驱逐舰2艘 或 驱逐舰4艘」是组间「或」，引擎表达不了 → 整条弃用' },
  { entry: 'dd-22', code: 'A49', why: 'A49 的正文只点名 皐月/文月/長月 + 「其他一艘驱逐舰」，游戏这一条不要求 水無月；成员表由同为 defines 的 A79 背书（那条四个人全列了）。注册表没错，是 A49 这一条本来就松' },
  { entry: 'sq-31-e1', code: '2606Am1', why: '一条正文两套名单；2606Am1 在 kanso-quest-rules 里按「更新后」口径手工解码，落的是 sq-31-e2 那一期。前期名单因此不在门里——这是那条手工解码自己的期别选择，不是注册表与门打架' },
  { entry: 'dd-02-2', code: 'B206', why: 'mentions：B206 只要 早霜改二 旗舰 + 清霜/秋霜，朝霜 不在这条的要求里' },
  { entry: 'dd-07', code: 'B165', why: 'mentions：B165 只点名了队里的曙与潮，胧与涟不在这条的要求里' },
  { entry: 'dd-11-2', code: 'B208', why: 'mentions：B208 要的是 白雪改二 + 吹雪级凑数，不是整支第十一驱逐队' },
  { entry: 'dd-15', code: 'Cy7', why: 'mentions：Cy7 只要 亲潮改二/黑潮改二 两艘，早潮 不在这条的要求里' },
  { entry: 'dd-15', code: 'B174', why: 'mentions：同 Cy7，早潮 不在这条的要求里' },
  { entry: 'dd-19', code: 'By1', why: 'mentions：By1 只点名了绫波与敷波，矶波/浦波不在这条的要求里' },
  { entry: 'dd-22', code: 'B39', why: 'mentions：B39 只点名了三艘，水無月 不在这条的要求里（同 A49）' },
  { entry: 'dd-27-1', code: 'B121', why: 'mentions：B121 要的是 白露改二/时雨改二，春雨与五月雨不在这条里' },
  { entry: 'dd-27-1', code: 'B158', why: 'mentions：同 B121，春雨与五月雨不在这条的要求里' },
  { entry: 'sq-03', code: 'C73', why: 'mentions：C73 只要 金刚改二丙（仲裁台账 364 那一条）' },
  { entry: 'sq-16-4', code: 'B179', why: 'mentions：B179 只要这一期里的一部分，其余五位不在这条的要求里' },
  { entry: 'cd-01', code: 'F88', why: 'mentions：F88 真正的门在装备轴（熟练度 max 的流星改），「一航战」在那条里只是称谓' },
  { entry: 'td-06', code: 'Bq13', why: 'mentions：Bq13 卡在组间「或」（六水战驱逐2艘 或 由良改二），整条无门' },
  { entry: 'rei-1', code: 'Bm7', why: 'mentions：Bm7 的门是纯舰种（驱逐舰旗舰 + 4 艘），队名在那条里只是称谓' },
]

test('注册表 × 编成门：不覆盖的每一条都在台账里，且台账没有多余条目', {
  skip: (() => {
    const snap = userDataPathIfAny('snapshots', 'kcsapi_api_start2_getData.json')
    return (!snap || !fs.existsSync(snap) || !questPack) && '本机没有 api_start2 快照或 quests-scn'
  })(),
}, () => {
  const snapshot = JSON.parse(
    fs.readFileSync(userDataPath('snapshots', 'kcsapi_api_start2_getData.json'), 'utf8'),
  )
  const lodes = {}
  for (const id of [
    'quests-scn', 'kcwiki-localization', 'kcwiki-quest-req',
    'poi-quest-goal', 'kcwiki-expedition', 'poi-fcd-map',
  ]) lodes[id] = readLode(id)
  const state = {
    player: { quests: {}, decks: [], ships: {}, slotitems: {}, materials: [], useitems: {} },
    sortie: null,
  }
  const engine = engineBundle.module.createQuestEngine({
    getLode: (id) => lodes[id] ?? null,
    ledger: {
      loadSnapshot: () => snapshot,
      loadQuestProgress: () => ({}),
      saveQuestProgress: () => {},
      deleteQuestProgress: () => {},
    },
    store: { getState: () => state },
    send: () => {},
  })
  quiet(() => engine.init())
  const trackers = engine.state().trackers
  const gateOf = new Map()
  for (const [idText, row] of Object.entries(questPack.data)) {
    const goal = trackers[Number(idText)]?.fleetGoal
    const ships = new Set()
    for (const group of goal?.groups ?? []) {
      if (Array.isArray(group.ships)) for (const mstId of group.ships) ships.add(mstId)
    }
    gateOf.set(`${row?.code ?? ''}`, ships)
  }
  // 队名在门里按整条改造链展开：对账也按同一把尺子量
  const realCtx = fleet.buildFleetRuleContext(
    snapshot.body?.api_data ?? snapshot.body,
    lodes['kcwiki-localization']?.data,
  )
  const found = []
  for (const entry of histFleets.HIST_FLEETS) {
    if (!realCtx.histFleetShips([entry]).length) continue
    for (const ref of entry.questRefs) {
      const gate = gateOf.get(ref.code)
      if (!gate) continue
      const covered = entry.members.every((member) => {
        // 未实装的成员（夏潮）没有 id，本来就不该出现在门里
        if (!histFleets.memberFormIds(member.ref).length) return true
        // 这一位的整条改造链里，只要有一个形态在门里认得出来就算覆盖
        const chain = realCtx.histFleetShips([{ ...entry, id: `${entry.id}#probe`, members: [member] }])
        return chain.some((mstId) => gate.has(mstId))
      })
      if (!covered) found.push(`${entry.id}/${ref.code}`)
    }
  }
  const recorded = HIST_FLEET_RECONCILE.map((row) => `${row.entry}/${row.code}`)
  assert.deepEqual(
    [...found].sort(),
    [...recorded].sort(),
    '注册表与编成门的分歧集合变了——新增的要逐条查明原因再进台账，消失的要把台账那条删掉',
  )
  for (const row of HIST_FLEET_RECONCILE) {
    assert.ok(row.why.length > 20, `${row.entry}/${row.code} 的台账没写依据`)
  }
})
