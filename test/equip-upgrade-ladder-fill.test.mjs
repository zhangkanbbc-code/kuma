// 机制通则补档的护栏（台账头注「机制通则」那一段是判据本身）。
//
// 用户裁的两条：
//   一、舰C 不存在「某二号舰只能从 ★x≠0 开始改修」——支持即全档 ★0→★max，
//       只有更新才有专属二号舰要求；
//   二、能做更新的二号舰，100% 支持该装备的全档改修。
// 论证走明石改修界面：那界面按装备列行，一件装备在某二号舰名下要么在要么不在，
// 没有「只限某星级段」的表达位。
//
// 这批不逐件抄数值（数值就在同装备他行摆着，抄一遍只多一个抄错的机会），
// 所以护栏也不是「比对我抄得对不对」，而是**逐件真跑装配层**核四件事：
// 该全的全了、更新归属一个字没动、补进去的数确实来自同装备他行、A 档没被顺手改掉。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import corrections from '../dist/shared/equip-upgrade-corrections.js'

const {
  EQUIP_UPGRADE_CORRECTIONS,
  EQUIP_UPGRADE_LADDER_FILLS,
  PENDING_EQUIP_UPGRADE_SUSPECTS,
  RESOLVED_LADDER_SUSPECTS,
  applyEquipUpgradeCorrections,
  fillEquipUpgradeLadders,
} = corrections
const ji = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')

const packRows = () => {
  const file = new URL('../assets/lodes/equip-upgrades.json', import.meta.url)
  if (!fs.existsSync(file)) return null
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  const data = raw.data ?? raw
  return Array.isArray(data) ? data : Object.values(data)
}

/** 一行里露面的全部二号舰 */
const rowShips = (row) => (row.helpers ?? []).flatMap((one) => (one.ship_ids ?? []).map(Number))

/** 一个二号舰能改哪些档 ＝ 它露面的所有行的档位并集（通则的论证就是这个） */
const ladderByShip = (improvement) => {
  const seen = new Map()
  for (const row of improvement ?? []) {
    for (const id of rowShips(row)) {
      const has = seen.get(id) ?? { p1: false, p2: false }
      if (row.costs?.p1) has.p1 = true
      if (row.costs?.p2) has.p2 = true
      seen.set(id, has)
    }
  }
  return seen
}

/** 更新归属 + 二号舰名单 + 日程 + conv 有无：补档不许碰这几样 */
const convShape = (entry) =>
  (entry.improvement ?? [])
    .map((row) =>
      [
        row.convert?.id_after ?? 0,
        row.convert?.lvl_after ?? 0,
        rowShips(row)
          .sort((a, b) => a - b)
          .join('.'),
        (row.helpers ?? []).flatMap((one) => one.days ?? []).join(''),
        row.costs?.conv ? 'conv' : '-',
      ].join('#'),
    )
    .sort()

test('补档名单逐件真跑：该全档的全档了，本来就不缺的如实标「没动」', (t) => {
  const rows = packRows()
  if (!rows) {
    t.skip('本机没有 equip-upgrades 包')
    return
  }
  assert.ok(EQUIP_UPGRADE_LADDER_FILLS.length > 0, '补档名单空了')
  const { rows: fixed, report } = applyEquipUpgradeCorrections(rows)

  const touched = []
  for (const fill of EQUIP_UPGRADE_LADDER_FILLS) {
    const skipped = report.skipped.find((one) => one.eqId === fill.eqId)
    assert.ok(
      !skipped,
      `eq_id=${fill.eqId}（${fill.label}）被跳过了：${skipped?.reason}` +
        '——上游变样或同档消耗打架，这一条该重审而不是继续挂着',
    )
    const after = fixed.find((one) => Number(one.eq_id) === fill.eqId)
    assert.ok(after, `校正后找不到 eq_id=${fill.eqId}`)

    // 核心断言：**每一个**露过面的二号舰都得两档齐全
    for (const [shipId, has] of ladderByShip(after.improvement)) {
      assert.ok(
        has.p1 && has.p2,
        `eq_id=${fill.eqId}（${fill.label}）的二号舰 ${shipId} 仍然缺档` +
          `（★0-5=${has.p1} ★6-9=${has.p2}）——通则说支持即全档`,
      )
    }

    if (report.filled.includes(fill.eqId)) touched.push(fill.eqId)
    else
      assert.ok(
        report.fillUnchanged.includes(fill.eqId),
        `eq_id=${fill.eqId} 既没补也没标「没动」，报告漏了它`,
      )
  }
  // 名单不是摆设：真有一批被补上了
  assert.ok(touched.length >= 10, `只补了 ${touched.length} 件，名单像是失效了`)
  // 审过、本来就不缺的那几件留在名单里当记录，免得下一轮又重审一遍
  assert.ok(report.fillUnchanged.length > 0, '「审过没动」那一档不见了')
})

test('病灶还在：名单里被补的那几件，上游确实有二号舰缺档', (t) => {
  const rows = packRows()
  if (!rows) {
    t.skip('本机没有 equip-upgrades 包')
    return
  }
  const { report } = applyEquipUpgradeCorrections(rows)
  for (const eqId of report.filled) {
    const before = rows.find((one) => Number(one.eq_id) === eqId)
    const short = [...ladderByShip(before.improvement)].filter(
      ([, has]) => !has.p1 || !has.p2,
    )
    assert.ok(
      short.length > 0,
      `eq_id=${eqId} 上游已经不缺档了——病灶没了，这条补档该撤而不是继续套`,
    )
  }
})

test('补档只加档位：更新归属、二号舰、日程一个字没动', (t) => {
  const rows = packRows()
  if (!rows) {
    t.skip('本机没有 equip-upgrades 包')
    return
  }
  const { rows: fixed } = applyEquipUpgradeCorrections(rows)
  for (const fill of EQUIP_UPGRADE_LADDER_FILLS) {
    const before = rows.find((one) => Number(one.eq_id) === fill.eqId)
    const after = fixed.find((one) => Number(one.eq_id) === fill.eqId)
    assert.equal(
      after.improvement.length,
      before.improvement.length,
      `eq_id=${fill.eqId} 的方案行数变了`,
    )
    assert.deepEqual(
      convShape(after),
      convShape(before),
      `eq_id=${fill.eqId}（${fill.label}）的更新归属/二号舰/日程被补档动了——补档只该加档位`,
    )
  }
})

test('补进去的档取自同装备他行，不是新编的数', (t) => {
  const rows = packRows()
  if (!rows) {
    t.skip('本机没有 equip-upgrades 包')
    return
  }
  const { rows: fixed, report } = applyEquipUpgradeCorrections(rows)
  assert.ok(report.filled.length > 0, '一件都没补，这条护栏没在验东西')
  for (const eqId of report.filled) {
    const before = rows.find((one) => Number(one.eq_id) === eqId)
    const after = fixed.find((one) => Number(one.eq_id) === eqId)
    for (const stage of ['p1', 'p2']) {
      const upstream = (before.improvement ?? []).map((row) => row.costs?.[stage]).filter(Boolean)
      if (!upstream.length) continue
      for (const row of after.improvement) {
        if (!row.costs?.[stage]) continue
        assert.ok(
          upstream.some((one) => JSON.stringify(one) === JSON.stringify(row.costs[stage])),
          `eq_id=${eqId} 的 ${stage} 出现了上游没有的数——补档只许抄同装备他行的同一档`,
        )
      }
    }
  }
})

test('同装备各行的同一档消耗确实一致——「消耗与二号舰无关」不是空口说的', (t) => {
  const rows = packRows()
  if (!rows) {
    t.skip('本机没有 equip-upgrades 包')
    return
  }
  // 这是通则补档的前提。名单这批要是打架，fillEquipUpgradeLadders 会 conflict 弃权；
  // 这里把前提本身钉住，免得哪天前提塌了却没人发现
  for (const fill of EQUIP_UPGRADE_LADDER_FILLS) {
    const entry = rows.find((one) => Number(one.eq_id) === fill.eqId)
    for (const stage of ['p1', 'p2']) {
      const seen = new Set(
        (entry.improvement ?? [])
          .map((row) => row.costs?.[stage])
          .filter(Boolean)
          .map((one) => JSON.stringify(one)),
      )
      assert.ok(
        seen.size <= 1,
        `eq_id=${fill.eqId}（${fill.label}）的 ${stage} 在不同行里是不同的数` +
          '——「改修消耗只由装备+星级决定」在这件上不成立，这一条该退回重审',
      )
    }
  }
})

test('整件没有的那一档不算缺：通篇只有 ★6-9 就不该凭空造出 ★0-5', () => {
  const onlyP2 = [
    {
      convert: null,
      helpers: [{ ship_ids: [100], days: [0] }],
      costs: { p2: { devmats: 3, screws: 3, equips: [], consumable: [] } },
    },
    {
      convert: { id_after: 999, lvl_after: 0 },
      helpers: [{ ship_ids: [200], days: [0] }],
      costs: { conv: { devmats: 9, screws: 9, equips: [], consumable: [] } },
    },
  ]
  const out = fillEquipUpgradeLadders(onlyP2)
  assert.equal(out.conflict, false)
  // 200 缺 p2 → 补得上；p1 整件都没有 → 谁也不补
  assert.ok(out.improvement, '200 缺 ★6-9 却没补')
  for (const row of out.improvement) {
    assert.ok(!row.costs.p1, '整件都没有 ★0-5，却凭空造了一档出来')
  }
})

test('同档消耗打架就整件弃权，不猜哪个对', () => {
  const clash = [
    {
      convert: null,
      helpers: [{ ship_ids: [100], days: [0] }],
      costs: { p1: { devmats: 2, screws: 2, equips: [], consumable: [] } },
    },
    {
      convert: null,
      helpers: [{ ship_ids: [200], days: [0] }],
      costs: {
        p1: { devmats: 7, screws: 7, equips: [], consumable: [] },
        p2: { devmats: 9, screws: 9, equips: [], consumable: [] },
      },
    },
  ]
  const out = fillEquipUpgradeLadders(clash)
  assert.equal(out.conflict, true, '两行的 ★0-5 是不同的数，本该弃权')
  assert.equal(out.improvement, null, '弃权了还回了改过的数据')
})

test('上游变样就跳过：指纹对不上不许拿旧判据硬补', (t) => {
  const rows = packRows()
  if (!rows) {
    t.skip('本机没有 equip-upgrades 包')
    return
  }
  const target = EQUIP_UPGRADE_LADDER_FILLS[0]
  const drifted = rows.map((row) =>
    Number(row.eq_id) === target.eqId
      ? { ...row, improvement: [...row.improvement, { convert: null, helpers: [], costs: {} }] }
      : row,
  )
  const { report } = applyEquipUpgradeCorrections(drifted)
  assert.ok(
    report.skipped.some((one) => one.eqId === target.eqId && one.reason === 'fingerprint'),
    `eq_id=${target.eqId} 上游都变样了还在补`,
  )
  assert.ok(!report.filled.includes(target.eqId), '变样的那件仍被补了')
})

test('整行零段位那批通则层一个都不碰——不管它是待裁还是已结案', (t) => {
  const rows = packRows()
  if (!rows) {
    t.skip('本机没有 equip-upgrades 包')
    return
  }
  // 21/66 2026-08-25 已逐件结案进台账，待裁名单因此是空的。但**通则层的边界没变**：
  // 整行零段位不许套通则补，凭空造一整行改修与补一段是两种风险。
  // 所以这里不看名单空不空，只看这几件有没有被补档层碰过。
  const zeroLadder = [...PENDING_EQUIP_UPGRADE_SUSPECTS, ...RESOLVED_LADDER_SUSPECTS]
  assert.ok(zeroLadder.length > 0, '零段位那批凭空消失了')
  const filling = new Set(EQUIP_UPGRADE_LADDER_FILLS.map((one) => one.eqId))
  const { report } = applyEquipUpgradeCorrections(rows)
  for (const eqId of zeroLadder) {
    const before = rows.find((one) => Number(one.eq_id) === eqId)
    assert.ok(before, `真包里找不到 eq_id=${eqId}`)
    assert.ok(
      !filling.has(eqId),
      `eq_id=${eqId} 被放进了补档名单——它是整行零段位，套通则等于凭空造一整行改修`,
    )
    assert.ok(
      !report.filled.includes(eqId) && !report.fillUnchanged.includes(eqId),
      `eq_id=${eqId} 走了通则补档那条路，该走的是逐件裁的台账`,
    )
    // 病灶还在：那一行确实一个档都没有（结案的那几件由台账整条替换，看的是上游）
    const bare = before.improvement.some(
      (row) => !row.costs?.p1 && !row.costs?.p2 && !row.costs?.conv && rowShips(row).length > 0,
    )
    assert.ok(bare, `eq_id=${eqId} 上游已经没有「整行零段位」那一行了——判据变了，该重审`)
  }
  // 待裁名单空了只有一种合法解释：那几件都进了台账
  for (const eqId of RESOLVED_LADDER_SUSPECTS) {
    assert.ok(report.applied.includes(eqId), `eq_id=${eqId} 说是结案了，却没在装配时生效`)
  }
})

test('待裁名单与补档名单不重叠：一件装备只能有一种处置', () => {
  const filling = new Set(EQUIP_UPGRADE_LADDER_FILLS.map((one) => one.eqId))
  const judged = new Set(EQUIP_UPGRADE_CORRECTIONS.map((one) => one.eqId))
  assert.equal(filling.size, EQUIP_UPGRADE_LADDER_FILLS.length, '补档名单里有重复的 eqId')
  for (const eqId of PENDING_EQUIP_UPGRADE_SUSPECTS) {
    assert.ok(!filling.has(eqId), `eq_id=${eqId} 既待裁又在补档名单里`)
  }
  for (const eqId of filling) {
    assert.ok(!judged.has(eqId), `eq_id=${eqId} 既整条替换又补档，两层会打架`)
  }
})

test('补档那批的证据来路写清了是通则，不是实测', () => {
  for (const fill of EQUIP_UPGRADE_LADDER_FILLS) {
    assert.match(fill.basis, /机制通则/, `eq_id=${fill.eqId} 的 basis 没说清依据是通则`)
    assert.ok(
      !/(?<!未)游戏实测/.test(fill.basis),
      `eq_id=${fill.eqId} 把通则推的说成实测了`,
    )
    assert.match(fill.basis, /2026-08-25/, `eq_id=${fill.eqId} 的 basis 没写日期`)
  }
  // 两条通则都得写在台账里当长期判据
  const src = fs.readFileSync(
    new URL('../src/shared/equip-upgrade-corrections.ts', import.meta.url),
    'utf8',
  )
  assert.match(src, /通则一/, '通则一没写进台账头注')
  assert.match(src, /通则二/, '通则二没写进台账头注')
})

test('装备名与主数据对得上——label 是给人读的，写错了比没有更坏', async (t) => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  let loadStart2MasterArray
  try {
    ;({ loadStart2MasterArray } = await import(
      pathToFileURL(root + 'scripts/lib/start2.mjs').href
    ))
  } catch {
    t.skip('本机取不到 start2 加载器')
    return
  }
  let table
  try {
    table = new Map(
      loadStart2MasterArray('api_mst_slotitem', root).map((one) => [
        Number(one.api_id),
        String(one.api_name ?? ''),
      ]),
    )
  } catch {
    t.skip('本机没有 start2 主数据')
    return
  }
  if (!table.size) {
    t.skip('本机 start2 里没有装备表')
    return
  }
  for (const fill of EQUIP_UPGRADE_LADDER_FILLS) {
    const real = table.get(fill.eqId)
    if (!real) continue
    assert.equal(fill.label, real, `eq_id=${fill.eqId} 的 label 与主数据对不上`)
  }
})

// 2026-08-25 换底座后，角标不再看这张台账的报告，改看事实表每一行的 `basis`
//（判据搬进 shared/equip-sources 的 improveEntryTier，护栏在 equip-improve-table）。
// 这里只钉住通则补档那批**在事实表里仍然认得出来**——它们是「推出来的」，
// 不该和实测、和照资料整理的混成一句话。
test('补档那批在事实表里仍标着「推出来的」，没被混进别的档', (t) => {
  const file = new URL('../assets/lodes/equip-improve.json', import.meta.url)
  if (!fs.existsSync(file)) {
    t.skip('本机没有事实表')
    return
  }
  const rows = new Map(
    JSON.parse(fs.readFileSync(file, 'utf8')).data.map((one) => [Number(one.eq_id), one]),
  )
  let marked = 0
  for (const fill of EQUIP_UPGRADE_LADDER_FILLS) {
    const entry = rows.get(fill.eqId)
    assert.ok(entry, `事实表里找不到 eq_id=${fill.eqId}`)
    const tiers = entry.improvement.map((row) => row.basis)
    // 审过、本来就不缺的那四件不会有推定行，其余的必须认得出
    if (tiers.some((one) => /^机制通则推定/.test(one))) marked += 1
  }
  assert.ok(
    marked >= 10,
    `只有 ${marked} 件在事实表里标着推定——通则补档那批像是在合成时被抹平了`,
  )
  // 角标那一侧：说明各说各的，不共用一句话
  // 2026-08-26 文案清扫按裁决书缩成短句；「这一档是推出来的」这层语义原样保留
  assert.ok(ji.includes('推定依据：可改修即支持 ★0→★max 全程'), '「补档」角标没写清它是推定值')
  assert.ok(ji.includes('当前装备含本地实测改修方案'), '「实测」角标的说明不见了')
})
