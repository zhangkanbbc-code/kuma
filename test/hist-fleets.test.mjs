import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import histFleets from '../dist/shared/hist-fleets.js'
import remodel from '../dist/shared/ship-remodel-chain.js'

const {
  HIST_FLEETS,
  HIST_FLEET_KIND_LABEL,
  HIST_FLEET_KIND_ORDER,
  buildHistFleetIndex,
  histFleetById,
  memberFormIds,
} = histFleets
const { buildShipRemodelChains } = remodel

// 主数据快照（仓库上一级的 s2.json）。缺了就跳过对主数据的那几条——
// 这份快照不在仓库里，但本机开发一定有，CI 侧只跑纯结构断言。
const masterPath = new URL('../../s2.json', import.meta.url)
const master = fs.existsSync(masterPath) ? JSON.parse(fs.readFileSync(masterPath, 'utf8')) : null
const masterShips = master ? (master.api_data ?? master).api_mst_ship : null
const shipById = masterShips ? new Map(masterShips.map((s) => [s.api_id, s])) : null

test('注册表 v1 的规模与分节与草稿一致', () => {
  assert.equal(HIST_FLEETS.length, 75)
  const byKind = new Map()
  for (const entry of HIST_FLEETS) byKind.set(entry.kind, (byKind.get(entry.kind) ?? 0) + 1)
  // 草稿 §4 的分节统计：駆逐隊 26 / 戦隊 22 / 航空戦隊 6 / 水雷戦隊 6 / 其余 15
  assert.equal(byKind.get('destroyerDivision'), 26)
  assert.equal(byKind.get('squadron'), 22)
  assert.equal(byKind.get('carrierDivision'), 6)
  assert.equal(byKind.get('torpedoSquadron'), 6)
  const rest =
    (byKind.get('fleet') ?? 0) +
    (byKind.get('namedForce') ?? 0) +
    (byKind.get('airGroup') ?? 0) +
    (byKind.get('escortCommand') ?? 0)
  assert.equal(rest, 15)
  // 每个 kind 都要有中文标题与排序位，不然图鉴分组会掉一整段
  for (const kind of byKind.keys()) {
    assert.ok(HIST_FLEET_KIND_LABEL[kind], `${kind} 缺中文标题`)
    assert.ok(HIST_FLEET_KIND_ORDER.includes(kind), `${kind} 不在排序表里`)
  }
})

test('条目 id 唯一，byId 认得每一条', () => {
  const ids = new Set()
  for (const entry of HIST_FLEETS) {
    assert.ok(!ids.has(entry.id), `id 撞车：${entry.id}`)
    ids.add(entry.id)
    assert.equal(histFleetById(entry.id), entry)
  }
  assert.equal(histFleetById('查无此队'), null)
})

test('形态语义只有三种，写明形态的代表 id 必在 forms 里', () => {
  for (const entry of HIST_FLEETS) {
    for (const member of entry.members) {
      const ref = member.ref
      assert.ok(['root', 'exact', 'absent'].includes(ref.form), `${entry.id} 形态语义非法`)
      if (ref.form === 'exact') {
        assert.ok(ref.forms.length > 0, `${entry.id} exact 成员没有列举形态`)
        assert.ok(ref.forms.includes(ref.id), `${entry.id} exact 代表 id 不在 forms 里`)
      }
      if (ref.form === 'absent') {
        assert.equal(memberFormIds(ref).length, 0, '未实装成员不该占 id')
        assert.ok(ref.name, `${entry.id} 未实装成员没有名字`)
      }
    }
  }
})

test('同队多期一律带 period，靠它区分与排序', () => {
  // 同一支队拆成多条时，光有队名分不出是哪一期——那正是「合并成大集合」要避免的坑
  const byName = new Map()
  for (const entry of HIST_FLEETS) {
    const list = byName.get(entry.name.ja) ?? []
    list.push(entry)
    byName.set(entry.name.ja, list)
  }
  for (const [name, list] of byName) {
    if (list.length < 2) continue
    for (const entry of list) {
      assert.ok(entry.period, `${name} 有 ${list.length} 期，但 ${entry.id} 没有 period`)
    }
    const orders = list.map((entry) => entry.period.order)
    assert.equal(new Set(orders).size, orders.length, `${name} 的 period.order 撞车`)
  }
})

test('note 未核时不给 refs；核过的必须留出处', () => {
  for (const entry of HIST_FLEETS) {
    assert.ok(['verified', 'draft'].includes(entry.noteStatus), `${entry.id} noteStatus 非法`)
    if (entry.noteStatus === 'verified') {
      assert.ok(entry.note, `${entry.id} 标了 verified 却没有注记`)
      assert.ok(entry.refs?.length, `${entry.id} 标了 verified 却没有文献出处`)
      for (const ref of entry.refs) {
        assert.ok(ref.title && /^https?:\/\//.test(ref.url), `${entry.id} 出处不完整`)
      }
    }
  }
  // 草稿 §4.2 逐条查证过的三条必须在册
  const verified = HIST_FLEETS.filter((entry) => entry.noteStatus === 'verified').map((e) => e.id)
  for (const id of ['dd-32', 'sq-31-1', 'sq-31-e1', 'rei-2']) {
    assert.ok(verified.includes(id), `${id} 应为已核`)
  }
})

test('questRefs 的码全在任务库里（艦素码空间）', () => {
  const lode = JSON.parse(
    fs.readFileSync(new URL('../assets/lodes/quests-scn.json', import.meta.url), 'utf8'),
  )
  const codes = new Set(Object.values(lode.data ?? lode).map((quest) => quest.code))
  assert.ok(codes.size > 500, `任务库只读到 ${codes.size} 条码`)
  for (const entry of HIST_FLEETS) {
    assert.ok(entry.questRefs.length > 0, `${entry.id} 没有任何任务出处`)
    assert.ok(
      entry.questRefs.some((ref) => ref.role === 'defines'),
      `${entry.id} 没有 defines 出处——成员表就没有法源`,
    )
    for (const ref of entry.questRefs) {
      assert.ok(codes.has(ref.code), `${entry.id} 引了不存在的任务码 ${ref.code}`)
      assert.ok(['defines', 'mentions'].includes(ref.role))
      assert.ok(['name', 'desc', 'memo2'].includes(ref.field))
    }
  }
})

test('成员 mstId 对主数据校验：查不到就是错，不静默跳过', {
  skip: shipById ? false : '本机没有 s2.json 主数据快照',
}, () => {
  for (const entry of HIST_FLEETS) {
    for (const member of entry.members) {
      for (const id of memberFormIds(member.ref)) {
        assert.ok(shipById.has(id), `${entry.id} 的成员 mstId ${id} 在主数据里查无此舰`)
      }
    }
  }
})

test('v1 里唯一那位查无此舰的成员照实标缺，不给近似替身', () => {
  // 草稿 §4 的统计：v1 主表只有第 15 驱逐队的 夏潮 一位查无此舰。
  // 这条钉的是「不硬造」——把她换成任何一个已实装的近似舰都会红。
  const missing = HIST_FLEETS.flatMap((entry) =>
    entry.members.filter((m) => m.ref.form === 'absent').map((m) => [entry.id, m.ref.name]),
  )
  assert.deepEqual(missing, [['dd-15', '夏潮']])
  const dd15 = histFleetById('dd-15')
  assert.equal(dd15.members.length, 4, '第 15 驱逐队是四舰编成，缺的那位也占一个位置')
})

test('未实装的成员，主数据里确实查不到同名舰', {
  skip: masterShips ? false : '本机没有 s2.json 主数据快照',
}, () => {
  const names = new Set(masterShips.map((ship) => ship.api_name))
  for (const entry of HIST_FLEETS) {
    for (const member of entry.members) {
      if (member.ref.form !== 'absent') continue
      assert.ok(
        !names.has(member.ref.name),
        `${entry.id} 把已实装的「${member.ref.name}」标成了未实装`,
      )
    }
  }
})

// ---- 索引 ----

const buildRealIndex = () => {
  if (!masterShips) return null
  const chains = buildShipRemodelChains(
    masterShips
      .filter((ship) => Number(ship.api_sortno) > 0)
      .map((ship) => ({
        id: Number(ship.api_id),
        sortNo: Number(ship.api_sortno) || Number(ship.api_id),
        afterId: Number.parseInt(`${ship.api_aftershipid ?? 0}`, 10) || 0,
      })),
    ((master.api_data ?? master).api_mst_shipupgrade ?? []).map((upgrade) => ({
      targetId: Number(upgrade.api_id) || 0,
      currentShipId: Number(upgrade.api_current_ship_id) || 0,
      originalShipId: Number(upgrade.api_original_ship_id) || 0,
      stage: Number(upgrade.api_upgrade_level) || 0,
    })),
  )
  return { index: buildHistFleetIndex(chains.rootOf), rootOf: chains.rootOf }
}

test('素名成员认整条改造链，写明形态只认列举的那几个', {
  skip: masterShips ? false : '本机没有 s2.json 主数据快照',
}, () => {
  const built = buildRealIndex()
  const { index, rootOf } = built

  // 第六驱逐队记的是素名 暁(34)：整条链上任意形态都该算进这一队
  const akatsuki = HIST_FLEETS.find((entry) => entry.id === 'dd-06')
  const akatsukiRoot = rootOf.get(34) ?? 34
  assert.ok(index.ofRoot(akatsukiRoot).includes(akatsuki))
  assert.ok(index.ofForm(34).includes(akatsuki))

  // 精锐第一战队记的是写明形态 長門改二(541) + 陸奥改二(573)。
  // ofForm 只在这两个形态上命中——素名口径下的 長門(80) 不该被算成这一队；
  // 但 ofRoot 要认得（图鉴按根形态列，不登记就在 長門 那一格查不到）。
  const eliteFirst = HIST_FLEETS.find((entry) => entry.id === 'sq-01-2')
  assert.ok(index.ofForm(541).includes(eliteFirst))
  assert.ok(!index.ofForm(80).includes(eliteFirst), '写明形态被当成素名展开了')
  assert.ok(index.ofRoot(rootOf.get(541) ?? 541).includes(eliteFirst))

  // 反向：素名的 第二战队 记 長門(80)，改二形态(541) 也该命中
  const second = HIST_FLEETS.find((entry) => entry.id === 'sq-02')
  assert.ok(index.ofForm(80).includes(second))
  assert.ok(index.ofRoot(rootOf.get(541) ?? 541).includes(second), '素名没有覆盖整条链')
})

test('byName 认队名与别称，认不出就返回 null', () => {
  const index = buildHistFleetIndex(new Map())
  assert.equal(index.byName('第六駆逐隊')?.id, 'dd-06')
  assert.equal(index.byName('六驱')?.id, 'dd-06')
  assert.equal(index.byName('西村艦隊')?.id, 'nishimura-1')
  assert.equal(index.byName('不存在的队'), null)
})

test('索引查不到时返回空数组，不是 undefined', () => {
  const index = buildHistFleetIndex(new Map())
  assert.deepEqual(index.ofRoot(999999), [])
  assert.deepEqual(index.ofForm(999999), [])
})
