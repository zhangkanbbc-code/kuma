// 改修表的第一方校正台账（2026-08-25 用户游戏实测裁决）。
//
// ---- 病灶 ----
// wikiwiki「改修表」把**二号舰**与**档位**压在同一组排版行里（rowspan 视觉打包），
// 抓取器按位置对齐读，就把「哪一档」绑到了「哪个二号舰」上。瑞雲改二(六三四空)
// 在包里因此变成：日向改二只有 ★0-5、最上改二只有 ★6-9 + 更新。
//
// ---- 裁决 ----
// 用户进游戏实测：**最上改二特当二号舰能改 ★0 的那一件**，消耗显示
// 改修资材 10 / 开发资材 8，正是包里记在日向改二名下的 ★0-5。
// 所以二号舰是**并列候选、全档可用**，差别只在更新可否（日向改二不能更新）。
//
// 抓取器不改（「按档换二号舰」在别的装备上真实存在，一刀切会改错别人），
// 走台账覆盖：包文件一个字不动，装配时把裁过的整条换掉。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import corrections from '../dist/shared/equip-upgrade-corrections.js'
import budget from '../dist/shared/improve-budget.js'

const {
  EQUIP_UPGRADE_CORRECTIONS,
  EQUIP_UPGRADE_LADDER_FILLS,
  PENDING_EQUIP_UPGRADE_SUSPECTS,
  RESOLVED_LADDER_SUSPECTS,
  applyEquipUpgradeCorrections,
  equipUpgradeFingerprint,
} = corrections
const { improveBudgetTo, improveRouteTotal } = budget
const ji = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')

const ZUIUN = 322
const packRows = () => {
  const file = new URL('../assets/lodes/equip-upgrades.json', import.meta.url)
  if (!fs.existsSync(file)) return null
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  const data = raw.data ?? raw
  return Array.isArray(data) ? data : Object.values(data)
}

/** 合成一份「上游那样」的 322：与真包同形，供无包的机器上也能跑。 */
const upstreamZuiun = () => ({
  eq_id: ZUIUN,
  improvement: [
    {
      convert: { id_after: 490, lvl_after: 0 },
      helpers: [{ ship_ids: [501, 506], days: [2, 3, 4] }],
      costs: {
        fuel: 240,
        ammo: 280,
        steel: 0,
        baux: 630,
        p2: { devmats: 15, devmats_sli: 30, screws: 9, screws_sli: 12, equips: [{ id: 55, eq_count: 2 }], consumable: [] },
        conv: {
          devmats: 32,
          devmats_sli: 48,
          screws: 10,
          screws_sli: 17,
          equips: [{ id: 344, eq_count: 1 }],
          consumable: [{ id: 77, eq_count: 4 }, { id: 78, eq_count: 1 }],
        },
      },
    },
    {
      convert: null,
      helpers: [{ ship_ids: [554], days: [2, 3, 4] }],
      costs: {
        fuel: 240,
        ammo: 280,
        steel: 0,
        baux: 630,
        p1: { devmats: 10, devmats_sli: 12, screws: 8, screws_sli: 8, equips: [{ id: 26, eq_count: 2 }], consumable: [] },
      },
    },
  ],
})

/**
 * 只看这一件的处置。台账里不止一条，而这些用例喂的是**单件**上游——
 * 别的条目必然报 `no-equip`，那是正常的，不该让本用例跟着红。
 */
const skippedFor = (report, eqId) => report.skipped.filter((one) => one.eqId === eqId)

test('校正后 322 两行各自三段齐全，日向那行没有更新', () => {
  const { rows, report } = applyEquipUpgradeCorrections([upstreamZuiun()])
  assert.deepEqual(report.applied, [ZUIUN])
  assert.deepEqual(skippedFor(report, ZUIUN), [])
  const imps = rows[0].improvement
  assert.equal(imps.length, 2)

  const hyuuga = imps.find((row) => row.helpers[0].ship_ids.includes(554))
  const mogami = imps.find((row) => row.helpers[0].ship_ids.includes(501))
  assert.ok(hyuuga && mogami, '两行二号舰没对上')

  // 全档可用：两行都要有 p1 与 p2
  for (const [name, row] of [['日向改二', hyuuga], ['最上改二', mogami]]) {
    assert.ok(row.costs.p1, `${name} 缺 ★0-5 —— 实测证明这一档它能改`)
    assert.ok(row.costs.p2, `${name} 缺 ★6-9`)
  }
  // 差别只在更新
  assert.equal(hyuuga.convert, null, '日向改二那行不该有更新')
  assert.ok(!hyuuga.costs.conv, '日向改二那行不该有更新消耗')
  assert.equal(mogami.convert.id_after, 490, '最上那行的更新目标不是夜間瑞雲')
  assert.ok(mogami.costs.conv, '最上那行缺更新消耗')
  // 最上那行两个二号舰并列
  assert.deepEqual(mogami.helpers[0].ship_ids, [501, 506], '最上改二/改二特没有并列')
})

test('没有校正条目的装备一个字不动', () => {
  const other = { eq_id: 999, improvement: [{ convert: null, helpers: [], costs: { p1: { devmats: 1 } } }] }
  const { rows, report } = applyEquipUpgradeCorrections([other])
  assert.deepEqual(report.applied, [])
  assert.deepEqual(rows[0], other, '没裁过的装备被改动了')
})

test('上游变样就跳过并告警，不拿过期校正去改已经不同的东西', () => {
  const drifted = upstreamZuiun()
  drifted.improvement[0].costs.p2.devmats = 99 // 上游改了数字
  const { rows, report } = applyEquipUpgradeCorrections([drifted])
  assert.deepEqual(report.applied, [])
  assert.deepEqual(skippedFor(report, ZUIUN), [{ eqId: ZUIUN, reason: 'fingerprint' }])
  assert.equal(rows[0].improvement[0].costs.p2.devmats, 99, '指纹对不上却还是覆盖了')
})

test('装备根本不在包里也如实记一笔', () => {
  const { report } = applyEquipUpgradeCorrections([])
  // 两份名单里每一条都该记一笔，一条都不许沉默
  assert.deepEqual(report.skipped, [
    ...EQUIP_UPGRADE_CORRECTIONS.map((one) => ({ eqId: one.eqId, reason: 'no-equip' })),
    ...EQUIP_UPGRADE_LADDER_FILLS.map((one) => ({ eqId: one.eqId, reason: 'no-equip' })),
  ])
  assert.deepEqual(report.filled, [], '一件装备都没有却补出了东西')
  assert.deepEqual(report.fillUnchanged, [], '一件装备都没有却标了「审过没动」')
})

test('台账的指纹与本机真包对得上（对不上说明上游动了，该重裁）', (t) => {
  const rows = packRows()
  if (!rows) {
    t.skip('本机没有 equip-upgrades 包')
    return
  }
  for (const correction of EQUIP_UPGRADE_CORRECTIONS) {
    const row = rows.find((one) => Number(one.eq_id) === correction.eqId)
    assert.ok(row, `真包里找不到 eq_id=${correction.eqId}`)
    assert.equal(
      equipUpgradeFingerprint(row.improvement),
      correction.fingerprint,
      `eq_id=${correction.eqId} 的上游已经变样，这条校正该重裁而不是继续套用`,
    )
  }
})

test('夜間瑞雲那条路线的总账要与用户手算的一致', () => {
  // 用户 2026-08-25 手算：开发资材 152/240、改修资材 94/113、
  // 瑞雲×12、紫電改二×8、九七戊改×1、新型航空兵装資材×4、戦闘詳報×1
  const { rows } = applyEquipUpgradeCorrections([upstreamZuiun()])
  const mogami = rows[0].improvement.find((row) => row.convert?.id_after === 490)
  const route = improveRouteTotal(mogami.costs, 0)
  assert.equal(route.devmats.normal, 152, '开发资材（通常）对不上')
  assert.equal(route.devmats.certain, 240, '开发资材（确保）对不上')
  assert.equal(route.screws.normal, 94, '改修资材（通常）对不上')
  assert.equal(route.screws.certain, 113, '改修资材（确保）对不上')
  assert.equal(route.equips.get(26), 12, '瑞雲 素材数对不上')
  assert.equal(route.equips.get(55), 8, '紫電改二 素材数对不上')
  assert.equal(route.equips.get(344), 1, '九七戊改 素材数对不上')
  assert.equal(route.consumables.get(77), 4, '新型航空兵装資材 对不上')
  assert.equal(route.consumables.get(78), 1, '戦闘詳報 对不上')
})

test('推满那笔账仍然不含更新——两个决定分开算', () => {
  const { rows } = applyEquipUpgradeCorrections([upstreamZuiun()])
  const mogami = rows[0].improvement.find((row) => row.convert?.id_after === 490)
  const toMax = improveBudgetTo(mogami.costs, 0)
  assert.equal(toMax.devmats.normal, 120, '推满那笔被更新污染了')
  assert.equal(toMax.screws.normal, 84)
  assert.equal(toMax.equips.get(344), undefined, '更新的素材混进了推满那笔')
  // 没有更新目标时，两者一致
  const hyuuga = rows[0].improvement.find((row) => !row.convert)
  assert.deepEqual(improveRouteTotal(hyuuga.costs, 0).devmats, improveBudgetTo(hyuuga.costs, 0).devmats)
})

// ---- 294：12.7cm連装砲A型改二（与 322 同因，按 kcwiki 表补，未游戏实测）----

const A_GATA = 294
const ISONAMI_KAI_NI = 666

test('校正后 294 的磯波改二那行三段齐全（上游只缺 ★0-5 那一段）', (t) => {
  const rows = packRows()
  if (!rows) {
    t.skip('本机没有 equip-upgrades 包')
    return
  }
  const before = rows.find((one) => Number(one.eq_id) === A_GATA)
  assert.ok(before, '真包里找不到 eq_id=294')
  // 先钉住病灶本身：上游那一行**确实**缺 ★0-5，不然这条校正就是无的放矢
  const rawIsonami = before.improvement.find((row) =>
    row.helpers.some((one) => one.ship_ids.includes(ISONAMI_KAI_NI)),
  )
  assert.ok(rawIsonami, '上游 294 里没有磯波改二那一行，这条校正的前提变了')
  assert.ok(!rawIsonami.costs.p1, '上游那一行已经有 ★0-5 了——病灶没了，这条校正该撤')

  const { rows: fixed, report } = applyEquipUpgradeCorrections(rows)
  assert.ok(report.applied.includes(A_GATA), `294 没被校正：${JSON.stringify(report.skipped)}`)
  const after = fixed.find((one) => Number(one.eq_id) === A_GATA)
  assert.equal(after.improvement.length, 3, '三行少抄了——台账是整条替换，漏一行等于删一行')

  const isonami = after.improvement.find((row) =>
    row.helpers.some((one) => one.ship_ids.includes(ISONAMI_KAI_NI)),
  )
  assert.ok(isonami, '校正后磯波改二那行不见了')
  assert.ok(isonami.costs.p1, '磯波改二仍然缺 ★0-5')
  assert.ok(isonami.costs.p2, '磯波改二缺 ★6-9')
  assert.ok(isonami.costs.conv, '磯波改二缺更新档')
  // 补的那一档取自同装备他行的同一档，不是新编的数
  const sibling = after.improvement.find(
    (row) => !row.helpers.some((one) => one.ship_ids.includes(ISONAMI_KAI_NI)),
  )
  assert.deepEqual(isonami.costs.p1, sibling.costs.p1, '补的 ★0-5 与同装备他行的同档对不上')
  // 归属（更新目标）与日程一个字没动
  assert.equal(isonami.convert.id_after, 295, '更新目标被改了')
  assert.deepEqual(isonami.helpers[0].days, [4, 5, 6], '星期被改了——这次没裁日程')
})

test('294 另外两行原样抄回：更新归属没有被这次补档改动', (t) => {
  const rows = packRows()
  if (!rows) {
    t.skip('本机没有 equip-upgrades 包')
    return
  }
  const before = rows.find((one) => Number(one.eq_id) === A_GATA)
  const { rows: fixed } = applyEquipUpgradeCorrections(rows)
  const after = fixed.find((one) => Number(one.eq_id) === A_GATA)
  // conv 有无、目标是谁、二号舰是谁——三行逐一对上游核对
  const shape = (list) =>
    list.improvement
      .map((row) => [
        row.convert?.id_after ?? 0,
        row.helpers.flatMap((one) => one.ship_ids).sort((a, b) => a - b).join('.'),
        row.costs.conv ? 'conv' : '-',
      ].join('#'))
      .sort()
  assert.deepEqual(shape(after), shape(before), '更新归属/二号舰在补档时被动了')
})

test('294 的证据等级如实标着「未实测」——别让下一个人当成验过的事实', () => {
  const entry = EQUIP_UPGRADE_CORRECTIONS.find((one) => one.eqId === A_GATA)
  assert.ok(entry, '台账里没有 294')
  assert.match(entry.basis, /未游戏实测/, '没标出这条是推定而非实测')
  assert.match(entry.basis, /kcwiki/, '没写清对照的是哪张表')
  // 322 那条相反，它是真在游戏里点出来的
  const zuiun = EQUIP_UPGRADE_CORRECTIONS.find((one) => one.eqId === ZUIUN)
  assert.match(zuiun.basis, /实测/)
  assert.ok(!/未游戏实测/.test(zuiun.basis), '把实测那条也标成推定了')
})

test('待裁名单只是名单，一件都没被偷偷改掉', () => {
  const judged = new Set(EQUIP_UPGRADE_CORRECTIONS.map((one) => one.eqId))
  for (const eqId of PENDING_EQUIP_UPGRADE_SUSPECTS) {
    assert.ok(!judged.has(eqId), `eq_id=${eqId} 既在待裁名单又在台账里，说明有人替用户拍板了`)
  }
  // 2026-08-25 起名单是空的（21/66 都结案了）。**空不等于可以随便空**：
  // 清零只有一条合法路径——当初那几件都进了台账。名单被人一删了事也是「空」，
  // 长得一模一样，所以这里认的是「查得到结案」而不是「名单为空」。
  for (const eqId of RESOLVED_LADDER_SUSPECTS) {
    assert.ok(
      judged.has(eqId),
      `eq_id=${eqId} 从待裁名单里没了，台账里也查不到——它是被结案了还是被删掉了？`,
    )
    assert.ok(
      !PENDING_EQUIP_UPGRADE_SUSPECTS.includes(eqId),
      `eq_id=${eqId} 已经结案进台账，不该还挂在待裁名单里`,
    )
  }
})

// 2026-08-25 起这张台账**不再在装配时施加**：它的裁决已经吃进第一方事实表
//（assets/lodes/equip-improve.json，由 scripts/build-equip-improve.mjs 合成）。
// 台账留下来是**裁决的出处**——每一格为什么取现在这个值、还有什么没定，都记在这里；
// 合成器读它，护栏（上面那些）继续拿真包核对它。装配层那一侧的护栏搬去了
// test/equip-improve-table.test.mjs。
test('装配层不再叠校正层：事实表已经是底座，再叠一次就是施加两遍', () => {
  assert.ok(
    !ji.includes('applyEquipUpgradeCorrections'),
    '装配层还在叠校正层——四案与通则补档在合成事实表时已经吃进去了',
  )
  assert.ok(ji.includes("queryLode('equip-improve')"), '装配层没有读事实表')
  // 更新不可与「压根没有更新路线」不是一句话——这一条与换底座无关，继续钉着
  assert.ok(ji.includes('更新不可 · 只能强化到 ★max'), '缺「更新不可」的标注')
  // 「按同装备其它方案判」这条 2026-08-25 起由行为级护栏钉
  //（test/improve-card-layout.test.mjs：有别的方案能更新才写「更新不可」，
  //  整件都没有更新路线时改说一句「★max 就是终点」）。这里只保留标注本身。
  assert.ok(ji.includes('当前装备无更新路线 · ★max 为终点'), '缺「整件都没有更新路线」这一档')
})

test('台账仍是裁决的出处：合成器读它，没人能绕过它改事实表', () => {
  const builder = fs.readFileSync(
    new URL('../scripts/build-equip-improve.mjs', import.meta.url),
    'utf8',
  )
  assert.ok(
    builder.includes('EQUIP_UPGRADE_CORRECTIONS') && builder.includes('EQUIP_UPGRADE_LADDER_FILLS'),
    '合成器没读这张台账——那事实表里那几格的裁决就没了出处',
  )
  assert.ok(
    builder.includes('applyEquipUpgradeCorrections'),
    '合成器没施加校正，事实表会退回上游那份错拆',
  )
})

// ---- 21：零式艦戦52型（A 档第 1 件结案）----
// 上游缺两处、病灶各不相同：瑞鶴行整行零段位；翔鶴行 convert 摆着但更新消耗段是空的。
const REI52 = 21
const ZUIKAKU = [111, 112, 462, 467]
const RYUUHOU = [185, 318, 883, 888]
const SHOUKAKU = [110, 288, 461, 466]

const rowWith = (entry, shipId) =>
  entry.improvement.find((row) => row.helpers.some((one) => one.ship_ids.includes(shipId)))

test('21 的两处病灶都还在：瑞鶴行整行零段位、翔鶴行缺更新消耗段', (t) => {
  const rows = packRows()
  if (!rows) {
    t.skip('本机没有 equip-upgrades 包')
    return
  }
  const before = rows.find((one) => Number(one.eq_id) === REI52)
  assert.ok(before, '真包里找不到 eq_id=21')

  const zuikaku = rowWith(before, ZUIKAKU[0])
  assert.ok(zuikaku, '上游 21 里没有瑞鶴那一行，这条校正的前提变了')
  assert.ok(!zuikaku.costs.p1 && !zuikaku.costs.p2 && !zuikaku.costs.conv,
    '上游瑞鶴那行已经有档位了——病灶没了，这条校正该撤')
  assert.equal(zuikaku.convert, null, '上游瑞鶴那行本来就没有更新目标')

  const shoukaku = rowWith(before, SHOUKAKU[0])
  assert.ok(shoukaku.convert, '上游翔鶴那行没有更新目标了，前提变了')
  assert.ok(!shoukaku.costs.conv,
    '上游翔鶴那行已经有更新消耗段了——病灶没了，这条校正该撤')
})

test('21 校正后：瑞鶴行两档齐、更新仍然不给', (t) => {
  const rows = packRows()
  if (!rows) {
    t.skip('本机没有 equip-upgrades 包')
    return
  }
  const { rows: fixed, report } = applyEquipUpgradeCorrections(rows)
  assert.ok(report.applied.includes(REI52), `21 没被校正：${JSON.stringify(report.skipped)}`)
  const after = fixed.find((one) => Number(one.eq_id) === REI52)
  assert.equal(after.improvement.length, 2, '两行少抄了——台账是整条替换，漏一行等于删一行')

  const zuikaku = rowWith(after, ZUIKAKU[0])
  assert.ok(zuikaku.costs.p1, '瑞鶴行仍然缺 ★0-5')
  assert.ok(zuikaku.costs.p2, '瑞鶴行仍然缺 ★6-9')
  // 更新不可：kcwiki 那一行明写没有更新，别顺手把翔鶴的更新段抄过来
  assert.ok(!zuikaku.costs.conv, '瑞鶴行凭空多了更新消耗——那一行的更新是不可')
  assert.equal(zuikaku.convert, null, '瑞鶴行凭空多了更新目标')
  // 四形态与星期照包
  assert.deepEqual(zuikaku.helpers[0].ship_ids, ZUIKAKU, '瑞鶴四形态被动了')
  assert.deepEqual(zuikaku.helpers[0].days, [0, 1, 3], '瑞鶴行星期被改了——这次没裁日程')
})

test('21 校正后：翔鶴行补上更新消耗，龍鳳与它同行共享、四形态和更新目标没动', (t) => {
  const rows = packRows()
  if (!rows) {
    t.skip('本机没有 equip-upgrades 包')
    return
  }
  const { rows: fixed } = applyEquipUpgradeCorrections(rows)
  const after = fixed.find((one) => Number(one.eq_id) === REI52)

  const shoukaku = rowWith(after, SHOUKAKU[0])
  assert.ok(shoukaku.costs.conv, '翔鶴行仍然缺更新消耗段')
  assert.equal(shoukaku.costs.conv.equips[0].id, 23, '更新素材不是九九式艦爆')
  assert.equal(shoukaku.costs.conv.equips[0].eq_count, 2, '九九式艦爆的件数不对')
  assert.equal(shoukaku.convert.id_after, 60, '更新目标被改了')
  assert.equal(shoukaku.convert.lvl_after, 4, '更新后的星级被改了')

  // 龍鳳与翔鶴同在这一行：官方推文明示龍鳳可更新，所以不拆行、共享这段消耗
  const ryuuhou = rowWith(after, RYUUHOU[0])
  assert.equal(ryuuhou, shoukaku, '龍鳳被拆到了别的行——官方推文说它可更新，本该与翔鶴同行')
  const ryuuhouHelper = shoukaku.helpers.find((one) => one.ship_ids.includes(RYUUHOU[0]))
  assert.deepEqual(ryuuhouHelper.ship_ids, RYUUHOU, '龍鳳四形态被动了——形态范围还挂着待核，不许在这里悄悄裁')
  assert.deepEqual(ryuuhouHelper.days, [0, 5, 6], '龍鳳行星期被改了')
})

test('21 的两档与上游翔鶴行同值——「消耗与二号舰无关」在这件上又印证一次', (t) => {
  const rows = packRows()
  if (!rows) {
    t.skip('本机没有 equip-upgrades 包')
    return
  }
  const before = rows.find((one) => Number(one.eq_id) === REI52)
  const upstream = rowWith(before, SHOUKAKU[0])
  const { rows: fixed } = applyEquipUpgradeCorrections(rows)
  const after = fixed.find((one) => Number(one.eq_id) === REI52)
  const zuikaku = rowWith(after, ZUIKAKU[0])
  // kcwiki 给瑞鶴行的两档与包里翔鶴行已有的两档逐字相同（台账头注记了这条交叉印证）
  assert.deepEqual(zuikaku.costs.p1, upstream.costs.p1, '瑞鶴行的 ★0-5 与上游翔鶴行对不上')
  assert.deepEqual(zuikaku.costs.p2, upstream.costs.p2, '瑞鶴行的 ★6-9 与上游翔鶴行对不上')
})

test('21 的证据等级与待核项都读得到', () => {
  const entry = EQUIP_UPGRADE_CORRECTIONS.find((one) => one.eqId === REI52)
  assert.ok(entry, '台账里没有 21')
  assert.match(entry.basis, /kcwiki/, '没写清对照的是哪张表')
  assert.match(entry.basis, /未游戏实测/, '没标出这条是表对照而非实测')
  // 龍鳳那部分有官方一手，来路要留得下痕迹
  assert.match(entry.basis, /KanColle_STAFF/, '龍鳳的官方出处没记下来')
  // 形态范围只挂牌不裁
  assert.ok(entry.pending?.length, '21 的待核项不见了')
  assert.ok(
    entry.pending.some((one) => /龍鳳/.test(one) && /待核/.test(one)),
    '龍鳳形态范围那条待核项读不到',
  )
})

// ---- 66：8cm高角砲（A 档最后一件，嫌疑清单清零）----
// 与 21 同型：矢矧行缺更新消耗段，能代/阿賀野行整行零段位。
const HACHI = 66
const YAHAGI = [139, 307, 663, 668]
const NOSHIRO = [138, 306, 662]
const AGANO = [137, 305]
const SUZUYA_KOU_KAI_NI = 508

test('66 的两处病灶都还在：能代/阿賀野行零段位、矢矧行缺更新消耗段', (t) => {
  const rows = packRows()
  if (!rows) {
    t.skip('本机没有 equip-upgrades 包')
    return
  }
  const before = rows.find((one) => Number(one.eq_id) === HACHI)
  assert.ok(before, '真包里找不到 eq_id=66')

  const noshiro = rowWith(before, NOSHIRO[0])
  assert.ok(noshiro, '上游 66 里没有能代那一行，这条校正的前提变了')
  assert.ok(!noshiro.costs.p1 && !noshiro.costs.p2 && !noshiro.costs.conv,
    '上游能代/阿賀野那行已经有档位了——病灶没了，这条校正该撤')
  assert.equal(noshiro.convert, null, '上游那一行本来就没有更新目标')

  const yahagi = rowWith(before, YAHAGI[0])
  assert.ok(yahagi.convert, '上游矢矧那行没有更新目标了，前提变了')
  assert.ok(!yahagi.costs.conv, '上游矢矧那行已经有更新消耗段了——病灶没了，这条校正该撤')
})

test('66 校正后：矢矧行三段齐、能代/阿賀野行两档齐且更新仍不给', (t) => {
  const rows = packRows()
  if (!rows) {
    t.skip('本机没有 equip-upgrades 包')
    return
  }
  const { rows: fixed, report } = applyEquipUpgradeCorrections(rows)
  assert.ok(report.applied.includes(HACHI), `66 没被校正：${JSON.stringify(report.skipped)}`)
  const after = fixed.find((one) => Number(one.eq_id) === HACHI)
  assert.equal(after.improvement.length, 2, '两行少抄了——台账是整条替换，漏一行等于删一行')

  const yahagi = rowWith(after, YAHAGI[0])
  assert.ok(yahagi.costs.p1 && yahagi.costs.p2, '矢矧行的两档没了')
  assert.ok(yahagi.costs.conv, '矢矧行仍然缺更新消耗段')
  assert.equal(yahagi.costs.conv.equips[0].id, 49, '更新素材不是 25mm単装機銃')
  assert.equal(yahagi.costs.conv.equips[0].eq_count, 2, '25mm単装機銃 的件数不对')
  assert.equal(yahagi.convert.id_after, 220, '更新目标被改了')

  const noshiro = rowWith(after, NOSHIRO[0])
  assert.ok(noshiro.costs.p1, '能代/阿賀野行仍然缺 ★0-5')
  assert.ok(noshiro.costs.p2, '能代/阿賀野行仍然缺 ★6-9')
  // 两家表都写这一行更新不可，别顺手把矢矧的更新段抄过来
  assert.ok(!noshiro.costs.conv, '能代/阿賀野行凭空多了更新消耗——那一行的更新是不可')
  assert.equal(noshiro.convert, null, '能代/阿賀野行凭空多了更新目标')
  // 阿賀野与能代同在这一行，两组舰与星期照包
  assert.equal(rowWith(after, AGANO[0]), noshiro, '阿賀野被拆到了别的行')
  assert.deepEqual(noshiro.helpers.find((one) => one.ship_ids.includes(NOSHIRO[0])).days, [0, 1],
    '能代那组星期被改了')
  assert.deepEqual(noshiro.helpers.find((one) => one.ship_ids.includes(AGANO[0])).days, [0, 4, 5, 6],
    '阿賀野那组星期被改了')
})

test('66 补的两档取自上游矢矧行，用的是 wikiwiki 修订后的新值', (t) => {
  const rows = packRows()
  if (!rows) {
    t.skip('本机没有 equip-upgrades 包')
    return
  }
  const before = rows.find((one) => Number(one.eq_id) === HACHI)
  const upstream = rowWith(before, YAHAGI[0])
  const { rows: fixed } = applyEquipUpgradeCorrections(rows)
  const noshiro = rowWith(fixed.find((one) => Number(one.eq_id) === HACHI), NOSHIRO[0])
  assert.deepEqual(noshiro.costs.p1, upstream.costs.p1, '补的 ★0-5 与上游矢矧行对不上')
  assert.deepEqual(noshiro.costs.p2, upstream.costs.p2, '补的 ★6-9 与上游矢矧行对不上')
  // 划线旧值抓取器已正确弃掉，这一处上游是对的：钉住新值免得哪天被「修」回旧值
  assert.equal(upstream.costs.p1.devmats, 4, '★0-5 不是 wikiwiki 修订后的新值了')
  assert.equal(upstream.costs.p2.devmats, 5, '★6-9 不是 wikiwiki 修订后的新值了')
})

test('66 的两条分歧都只挂牌不裁', () => {
  const entry = EQUIP_UPGRADE_CORRECTIONS.find((one) => one.eqId === HACHI)
  assert.ok(entry, '台账里没有 66')
  assert.match(entry.basis, /wikiwiki/, '没写清数值出自哪张表')
  assert.match(entry.basis, /未游戏实测/, '没标出这条是表对照而非实测')
  // 前半素材有官方一手，来路要留得下痕迹
  assert.match(entry.basis, /官方推文 2026-03-13/, '前半素材的官方出处没记下来')
  assert.match(entry.basis, /10cm連装高角砲→8cm高角砲/, '推文说的那次素材变更没写清')
  // kcwiki 停在调整前，所以它只当结构票——这一点不许含糊
  assert.match(entry.basis, /调整前旧表/, '没说清 kcwiki 那张表是调整前的')
  assert.ok(entry.pending?.length >= 2, '66 的待核项不齐')
  assert.ok(
    entry.pending.some((one) => /鈴谷航改二/.test(one)),
    '鈴谷航改二那条待核项读不到',
  )
  // 推文的菜单名对不上主数据（最近的是 220「8cm高角砲改+増設機銃」），归属存疑
  assert.ok(
    entry.pending.some((one) => /菜单名归属待核/.test(one) && /220/.test(one)),
    '推文菜单名归属那条待核项读不到——两件的前半素材现在都是 8cm高角砲，分不出指哪个',
  )
  // 挂牌就是挂牌：名单里一个字都不许动
  const ships = entry.improvement.flatMap((row) =>
    row.helpers.flatMap((one) => one.ship_ids),
  )
  assert.ok(
    !ships.includes(SUZUYA_KOU_KAI_NI),
    '鈴谷航改二被加进了二号舰名单——两家表分歧、无实测，这一格只该挂 pending',
  )
})

test('A 档两件都结案了，清单清零——但清零必须是「查得到结案」', (t) => {
  assert.deepEqual([...PENDING_EQUIP_UPGRADE_SUSPECTS], [], 'A 档还有没结案的？')
  const judged = new Set(EQUIP_UPGRADE_CORRECTIONS.map((one) => one.eqId))
  for (const eqId of RESOLVED_LADDER_SUSPECTS) {
    assert.ok(judged.has(eqId), `清单清零了，但 eq_id=${eqId} 在台账里查不到`)
  }
  assert.deepEqual([...RESOLVED_LADDER_SUSPECTS].sort((a, b) => a - b), [21, 66],
    '结案记录与当初那两件对不上')
  const rows = packRows()
  if (!rows) {
    t.skip('本机没有 equip-upgrades 包')
    return
  }
  // 清零之后仍要有人管：这两件现在归台账管，逐件核过才算数
  const { report } = applyEquipUpgradeCorrections(rows)
  for (const eqId of RESOLVED_LADDER_SUSPECTS) {
    assert.ok(report.applied.includes(eqId), `eq_id=${eqId} 结案了却没真生效`)
  }
})
