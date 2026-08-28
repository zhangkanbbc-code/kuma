import assert from 'node:assert/strict'
import nodeTest from 'node:test'
import fs from 'node:fs'

import kanso from '../dist/main/mg/kanso-quest-rules.js'
import kcwiki from '../dist/main/mg/kcwiki-quest-rules.js'

const { buildKansoQuestRules } = kanso
const { buildKcwikiRuleContext } = kcwiki

const s2Url = new URL('../../s2.json', import.meta.url)
const fcdUrl = new URL('../assets/lodes/poi-fcd-map.json', import.meta.url)
const hasRuleFixtures = [s2Url, fcdUrl].every((url) => fs.existsSync(url))
const test = (name, fn) =>
  nodeTest(name, {
    skip: hasRuleFixtures ? false : '缺 s2.json / poi-fcd-map 对账资料',
  }, fn)

const s2 = hasRuleFixtures
  ? JSON.parse(fs.readFileSync(s2Url, 'utf8'))
  : {}
const masterRaw = s2.api_data ?? s2
const fcdPack = hasRuleFixtures ? JSON.parse(fs.readFileSync(fcdUrl, 'utf8')) : null
const fcd = fcdPack?.data ?? fcdPack

const context = buildKcwikiRuleContext(masterRaw)
const rules = buildKansoQuestRules(context, masterRaw, fcd)
const byId = new Map(rules.map((rule) => [rule.questId, rule]))

test('艦素补充规则全部解析成功——名字解析失败会整条丢弃，掉数就是有名字烂了', () => {
  // 草稿表共 49 条——49 条缺口每条都有规则。少一条就说明某个名字没解析出来
  // （构建时会打 warn），那是数据错误不是可接受的降级。
  assert.equal(rules.length, 49, `解析出 ${rules.length} 条`)
  for (const rule of rules) {
    assert.ok(
      rule.tasks.length || rule.fleetGoal || rule.stateGoal || rule.stockGoals?.length,
      `${rule.code} 是空规则`,
    )
  }
})

test('缺 poi-fcd 时带点位的规则整条弃用，绝不退化成空 nodes', () => {
  // 空 nodes 的 battleNode 在消费端是「整图任意战斗都算」（`!task.nodes.length` 那条分支），
  // 多血条图上会一路误涨——比不计数错得多。所以点位算不出来时按 MissingEntity 处置：
  // 整条规则丢弃并告警，与舰名解析失败同一条路。
  const warnings = []
  const originalWarn = console.warn
  console.warn = (...args) => warnings.push(args.join(' '))
  let without
  try {
    without = buildKansoQuestRules(context, masterRaw, null)
  } finally {
    console.warn = originalWarn
  }
  const nodeCodes = rules
    .filter((rule) => rule.tasks.some((task) => 'nodes' in task))
    .map((rule) => rule.code)
  assert.ok(nodeCodes.length >= 10, `带点位的规则只有 ${nodeCodes.length} 条，锚太少`)
  const survivors = new Set(without.map((rule) => rule.code))
  for (const code of nodeCodes) {
    assert.ok(!survivors.has(code), `${code} 在缺 poi-fcd 时仍然产出了规则`)
  }
  // 任何幸存规则都不许带空 nodes（含没点位那一批，防止别处偷偷补 0）
  for (const rule of without) {
    for (const task of rule.tasks) {
      assert.ok(!('nodes' in task) || task.nodes.length > 0, `${rule.code} 产出了空 nodes`)
    }
  }
  assert.ok(
    warnings.some((line) => /点位/.test(line)),
    '整条弃用必须留下告警，别静默降级',
  )
})

test('B149：四图 Boss S 胜各 2 + Fletcher Mk.II 旗舰 + 美英澳荷 ≥3', () => {
  const rule = byId.get(921)
  assert.ok(rule)
  assert.deepEqual(
    rule.tasks.map((task) => [task.kind, task.map.join('-'), task.rank, task.count]),
    [
      ['bossKill', '1-5', 6, 2],
      ['bossKill', '7-1', 6, 2],
      ['bossKill', '6-2', 6, 2],
      ['bossKill', '6-5', 6, 2],
    ],
  )
  const [flag, nat] = rule.fleetGoal.groups
  assert.deepEqual(flag.ships, [629]) // Fletcher Mk.II
  assert.equal(flag.flagship, true)
  assert.equal(nat.amount, 3)
  assert.ok(nat.ships.includes(596), '美籍 Fletcher 应在名单里')
  assert.ok(nat.ships.includes(515), '英籍 Ark Royal 应在名单里')
  assert.ok(!nat.ships.includes(20), '日籍雪風不该在美英澳荷名单里')
})

test('D42：五条远征各 1 次，A1/A2 解析为 100/101', () => {
  const rule = byId.get(446)
  assert.deepEqual(
    rule.tasks.map((task) => [task.missionId, task.count]),
    [[3, 1], [4, 1], [5, 1], [100, 1], [101, 1]],
  )
  const missions = new Set((masterRaw.api_mst_mission ?? []).map((m) => m.api_id))
  assert.ok(missions.has(100) && missions.has(101), '主数据里应有 100/101 号远征')
})

test('多血条图的血条号 → Boss 格换算：7-2 P1=G/P2=M、7-3 P1=E/P2=P、1-6 goal=N', () => {
  // 边号本身已经零硬编码（规则里写的是血条号，边由 quest-map-nodes 走 poi-fcd 现算），
  // 所以这里钉的是**人写的那一半**：九行校准表把血条号换成哪个格子字母。
  // 换错了（比如 7-2 的 P1 写成 M）这里立刻红，而边号算式对错它管不着。
  const routes = fcd
  const edgesTo = (code, letter) =>
    Object.entries(routes[code].route)
      .filter(([, pair]) => pair && pair[1] === letter)
      .map(([edge]) => Number(edge))
      .sort((a, b) => a - b)
  const bq8 = byId.get(893)
  const nodeTasks = bq8.tasks.filter((task) => task.kind === 'battleNode')
  assert.deepEqual(nodeTasks[0].nodes, edgesTo('7-2', 'G'))
  assert.deepEqual(nodeTasks[1].nodes, edgesTo('7-2', 'M'))
  const b155 = byId.get(927)
  assert.deepEqual(b155.tasks[0].nodes, edgesTo('7-3', 'E'))
  const by5 = byId.get(928)
  assert.deepEqual(by5.tasks[0].nodes, edgesTo('7-3', 'P'))
  const b163 = byId.get(847)
  assert.deepEqual(b163.tasks[0].nodes, edgesTo('1-6', 'N'))
  assert.equal(b163.approx, true, 'S 胜存疑要标 ≈')
})

test('编成任务只有编成门：A93 全员改二 + 旗舰 + 只许这四艘', () => {
  const rule = byId.get(197)
  assert.equal(rule.tasks.length, 0)
  assert.equal(rule.fleetGoal.fleetId, 1)
  assert.equal(rule.fleetGoal.allowOnlyGoalShips, true)
  assert.equal(rule.fleetGoal.groups.length, 4)
  assert.equal(rule.fleetGoal.groups[0].flagship, true)
})

test('工厂任务：F128 的 ★+8 门槛、废弃计数与备料', () => {
  const rule = byId.get(1143)
  assert.deepEqual(rule.tasks, [{ kind: 'scrapEquip', equipId: 7, count: 8 }])
  const requirement = rule.stateGoal.equipment[0]
  assert.equal(requirement.minLevel, 8)
  assert.equal(requirement.slot, 1)
  assert.ok(rule.stockGoals.some((goal) => goal.kind === 'material' && goal.count === 7800))
})

test('2605F3：按装备类别废弃 + 熟练度条款不可判则标 ≈', () => {
  const rule = byId.get(1150)
  assert.deepEqual(
    rule.tasks.filter((task) => task.kind === 'scrapCategory').map((task) => [task.category, task.count]),
    [[2, 20], [3, 20], [4, 10]],
  )
  assert.equal(rule.approx, true)
})

test('B149 含旗舰口径：Fletcher 本人算在美英澳荷 3 艘里，3美1日编成要过检', () => {
  // 用户 2026-08-11 实弹抓出的计数闸：Fletcher Mk.II + Johnston改 +
  // Samuel B.Roberts Mk.II + 鵜来改 打 1-5 Boss S 两次不计数——组间去重把
  // 「含旗舰的 ≥3」判成「旗舰之外另要 3 艘」。伞组标 overlapOk 后跳过去重，
  // 组内数量线仍独立校验。
  const { evaluateFleetGoal } = kcwiki
  const rule = byId.get(921)
  const shipByName = new Map((masterRaw.api_mst_ship ?? []).map((s) => [s.api_name, s]))
  const view = (name) => {
    const s = shipByName.get(name)
    assert.ok(s, `master 缺 ${name}`)
    return { mstId: s.api_id, stype: s.api_stype, ctype: s.api_ctype, soku: s.api_soku, lv: 99 }
  }
  const fleet = [
    view('Fletcher Mk.II'),
    view('Johnston改'),
    view('Samuel B.Roberts Mk.II'),
    view('鵜来改'),
  ]
  assert.equal(evaluateFleetGoal(rule.fleetGoal, fleet, 1).ok, true, '标准编成必须过检')
  assert.equal(rule.fleetGoal.groups[1].overlapOk, true)
  // 钉住方向：不带 overlapOk 的同编成会被组间去重误杀（这就是修掉的那个闸）
  const strict = {
    ...rule.fleetGoal,
    groups: [rule.fleetGoal.groups[0], { ...rule.fleetGoal.groups[1], overlapOk: undefined }],
  }
  assert.equal(evaluateFleetGoal(strict, fleet, 1).ok, false)
  // B150（含 Fletcher 的 4 艘）与 B172（山风旗舰含在驱逐/海防 3 艘里）同口径
  assert.equal(byId.get(922).fleetGoal.groups[1].overlapOk, true)
  assert.equal(byId.get(957).fleetGoal.groups[1].overlapOk, true)
  // B172 实弹形：山风改二丁旗舰 + 2 驱逐 + 1 海防（共 3 艘驱逐/海防含旗舰）
  const b172 = byId.get(957)
  const yamakaze = [view('山風改二丁'), view('Johnston改'), view('時雨改三'), view('鵜来改')]
  assert.equal(evaluateFleetGoal(b172.fleetGoal, yamakaze, 1).ok, true)
})
