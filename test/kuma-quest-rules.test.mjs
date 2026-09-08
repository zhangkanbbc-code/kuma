import assert from 'node:assert/strict'
import nodeTest from 'node:test'
import fs from 'node:fs'

import kuma from '../dist/main/mg/kuma-quest-rules.js'
import kcwiki from '../dist/main/mg/kcwiki-quest-rules.js'

const { buildKumaQuestRules } = kuma
const { buildKcwikiRuleContext, evaluateFleetGoal } = kcwiki

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
const rules = buildKumaQuestRules(context, masterRaw, fcd)
const byId = new Map(rules.map((rule) => [rule.questId, rule]))

// 编成门的实弹检验共用：按舰名造一支舰队，字段与 evaluateFleetGoal 要的一致。
// 名字顺序就是队列顺序——旗舰门与 position 门都靠它。
const shipByName = new Map((masterRaw.api_mst_ship ?? []).map((s) => [s.api_name, s]))
const shipView = (name) => {
  const s = shipByName.get(name)
  assert.ok(s, `master 缺 ${name}`)
  return { mstId: s.api_id, stype: s.api_stype, ctype: s.api_ctype, soku: s.api_soku, lv: 99 }
}
const gatePasses = (questId, names, deckId = 1) =>
  evaluateFleetGoal(byId.get(questId).fleetGoal, names.map(shipView), deckId).ok

test('kuma补充规则全部解析成功——名字解析失败会整条丢弃，掉数就是有名字烂了', () => {
  // 草稿表共 63 条——63 条缺口每条都有规则。少一条就说明某个名字没解析出来
  // （构建时会打 warn），那是数据错误不是可接受的降级。
  // 2026-08-30 近代化改修族 714-717 补进草稿表（+4），718/719 早已在表内；
  // 同日演习族十条（Cm2/Cq4/Cy1/Cy3/Cy6/Cy7/Cy12/Cy13/Cy14/Cy16）补进（+10）。
  // 2026-09-08 补 382/2606Cm1 的更新后编成门（+1），现共 64 条。
  // 同日全库编成门体检补 C57/B194/B204/F138/By14（+5），现共 69 条。
  assert.equal(rules.length, 69, `解析出 ${rules.length} 条`)
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
    without = buildKumaQuestRules(context, masterRaw, null)
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

test('2606Cm1 与 2606Am1 同门，真实主数据下截图编队差四艘、更新后六艘通过', () => {
  const rule = byId.get(382)
  assert.deepEqual(rule.fleetGoal, byId.get(199).fleetGoal)
  assert.deepEqual(rule.tasks, [{ kind: 'exercise', rank: 5, count: 3 }])
  assert.equal(rule.approx, false)
  const diff = evaluateFleetGoal(rule.fleetGoal, [
    '涼月改', 'Johnston改', 'Samuel B.Roberts Mk.II', 'Верный', '霞改二', '時雨改三', '雪風改二',
  ].map(shipView), 3)
  assert.equal(diff.ok, false)
  assert.equal(diff.lines[0].current, 1)
  assert.equal(diff.lines[0].required, 5)
  assert.match(diff.lines[0].issue, /还差 4 艘/)
  assert.equal(gatePasses(382, ['花月改', '桐改', '竹改', '樫改', '榧改', '杉改'], 2), true)
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

test('只给舰种/舰级的组不许落在 ships:"any" 上——那是「任意舰都算」的短路分支', () => {
  // selectorMatches 把 `ships === 'any'` 写在最前面：一旦落上它，同一组的
  // stypes/ctypes 根本读不到。group() 的缺省一度就是 'any'，于是只写舰种的门
  // 全部形同虚设（B152「正规空母2艘」实测被两艘驱逐舰蒙混过关）。
  // 真要「任意舰」的那一条（B155 的全队规模上限）自己显式写，所以这里只查
  // 「写了 'any' 却还挂着舰种/舰级」这一种组合。
  for (const rule of rules) {
    for (const g of rule.fleetGoal?.groups ?? []) {
      if (g.ships !== 'any') continue
      assert.deepEqual(
        [g.stypes ?? [], g.ctypes ?? []],
        [[], []],
        `${rule.code} 的「${g.label}」用 ships:'any' 盖住了自己的舰种/舰级条件`,
      )
    }
    const secretary = rule.stateGoal?.secretary
    if (secretary?.ships === 'any') {
      assert.deepEqual(secretary.stypes ?? [], [], `${rule.code} 的秘书舰门被 'any' 盖住了`)
    }
  }
  assert.equal(gatePasses(924, ['赤城改', '加賀改']), true)
  assert.equal(gatePasses(924, ['雪風改', '時雨改']), false, 'B152 的正规空母门被两艘驱逐舰蒙过去了')
  // F117 的秘书舰门同理：潜水舰系才算
  const f117 = byId.get(1129).stateGoal.secretary
  assert.deepEqual(f117.stypes, [13, 14])
  assert.notEqual(f117.ships, 'any')
})

test('Cm2：演习「胜利」按 B 判定读，且只认第一舰队', () => {
  const rule = byId.get(318)
  assert.deepEqual(rule.tasks, [{ kind: 'exercise', rank: 4, count: 3 }])
  // 战斗粮食那一半仍是本地判不了的门，计数照给但不等于可交付
  assert.equal(rule.partial, true)
  assert.equal(rule.fleetGoal.fleetId, 1)
  assert.equal(gatePasses(318, ['球磨改', '多摩改', '雪風改'], 1), true)
  assert.equal(gatePasses(318, ['球磨改', '多摩改', '雪風改'], 2), false, '第二舰队打演习游戏不算')
  assert.equal(gatePasses(318, ['球磨改', '大井改', '雪風改'], 1), false, '雷巡不是「軽巡」')
})

test('Cq4：驱逐/海防 ≥3 且三者合计 ≥4——3 驱逐 + 1 轻巡级不许被拦下', () => {
  // 原文的「(軽巡級1隻導入可能)」被自研推导当「允许不是要求」丢掉了，剩下的
  // 「驱逐/海防4艘」比游戏严，是硬伤方向：游戏算的编成我们拦。
  assert.equal(gatePasses(342, ['雪風改', '時雨改', '曙改', '球磨改']), true)
  assert.equal(gatePasses(342, ['雪風改', '時雨改', '曙改', '漣改']), true, '四艘全驱逐照旧')
  assert.equal(gatePasses(342, ['雪風改', '時雨改', '球磨改', '多摩改']), false, '轻巡顶两艘不行')
  assert.equal(gatePasses(342, ['雪風改', '時雨改', '曙改']), false, '合计只有 3 艘')
  // 「軽巡級1隻」是给凑数那 4 艘定的上限，不是全队上限：
  // 4 驱逐 + 2 轻巡（后两艘是自由舰）游戏照算
  assert.equal(gatePasses(342, ['雪風改', '時雨改', '曙改', '漣改', '球磨改', '多摩改']), true)
})

test('Cy1：七艘里凑四艘，不是「必须四艘驱逐舰」', () => {
  assert.equal(gatePasses(345, ['Warspite', '金剛改二', 'Ark Royal', 'Nelson']), true)
  assert.equal(gatePasses(345, ['Warspite', '金剛改二', 'Jervis改', 'Javelin']), true)
  assert.equal(gatePasses(345, ['雪風改', '時雨改', '曙改', '漣改']), false, '随便四艘驱逐舰不算')
  assert.equal(gatePasses(345, ['Warspite', '金剛改二', 'Ark Royal']), false, '只有 3 艘')
  assert.equal(byId.get(345).approx, false, '门落地了就不该再标 ≈')
})

test('Cy3：雷巡当不了旗舰，但算在凑数的 3 艘轻巡级里', () => {
  // 日文原文的「雷巡を除く」只挂在旗舰那一维；memo2 与 poi 把凑数那一维也写成
  // 不含雷巡，比原文严一格——严的方向不跟。
  assert.equal(gatePasses(348, ['球磨改', '大井改', '多摩改', '雪風改', '時雨改']), true)
  assert.equal(gatePasses(348, ['大井改', '球磨改', '多摩改', '雪風改', '時雨改']), false, '雷巡旗舰')
  assert.equal(gatePasses(348, ['球磨改', '多摩改', '雪風改', '時雨改']), false, '轻巡级只有 2 艘')
  assert.equal(gatePasses(348, ['球磨改', '大井改', '多摩改', '雪風改']), false, '驱逐舰只有 1 艘')
})

test('Cy6：Gambier Bay Mk.II 旗舰 + Fletcher 級/John C.Butler 級 2 艘', () => {
  assert.equal(gatePasses(354, ['Gambier Bay Mk.II', 'Fletcher改', 'Samuel B.Roberts改']), true)
  // 按舰级判不按人名判：同为 Fletcher 級的 Richard P.Leary 也算（memo2 那句「四选二」没算她）
  assert.equal(gatePasses(354, ['Gambier Bay Mk.II', 'Richard P.Leary改', 'Johnston改']), true)
  assert.equal(gatePasses(354, ['Fletcher改', 'Gambier Bay Mk.II', 'Johnston改']), false, '旗舰不是她')
  assert.equal(gatePasses(354, ['Gambier Bay Mk.II', 'Fletcher改']), false, '僚舰只有 1 艘')
})

test('Cy7：另一艘必须在 2 号位', () => {
  assert.equal(byId.get(355).fleetGoal.groups[1].position, 2)
  assert.equal(gatePasses(355, ['黒潮改二', '親潮改二', '雪風改']), true)
  assert.equal(gatePasses(355, ['親潮改二', '黒潮改二', '雪風改']), true)
  assert.equal(gatePasses(355, ['黒潮改二', '雪風改', '親潮改二']), false, '亲潮在 3 号位')
  assert.equal(gatePasses(355, ['黒潮改二', '雪風改', '時雨改']), false, '只带了旗舰一艘')
})

test('Cy12：春雨必须旗舰，另外五艘里再凑三艘', () => {
  assert.equal(gatePasses(371, ['春雨改二', '村雨改二', '夕立改二', '時雨改二']), true)
  assert.equal(gatePasses(371, ['村雨改二', '春雨改二', '夕立改二', '時雨改二']), false, '春雨不是旗舰')
  assert.equal(gatePasses(371, ['春雨改二', '村雨改二', '夕立改二']), false, '春雨不许顶凑数名额')
})

test('Cy13：「他に」——那 2 艘驱逐舰在秋月型旗舰之外', () => {
  assert.equal(gatePasses(372, ['秋月改', '雪風改', '時雨改', '伊勢改二', '日向改二']), true)
  assert.equal(gatePasses(372, ['秋月改', '雪風改', '伊勢改二', '日向改二']), false, '僚驱只有 1 艘')
  assert.equal(gatePasses(372, ['雪風改', '秋月改', '時雨改', '伊勢改二', '日向改二']), false, '旗舰不是秋月型')
  assert.equal(gatePasses(372, ['秋月改', '雪風改', '時雨改', '伊勢改二']), false, '航空战舰只有 1 艘')
})

test('Cy14：法国舰 3 艘，且旗舰也得是法国舰', () => {
  assert.equal(gatePasses(373, ['Richelieu', 'Commandant Teste', 'Algérie', '雪風改']), true)
  assert.equal(gatePasses(373, ['雪風改', 'Richelieu', 'Commandant Teste', 'Algérie']), false)
  assert.equal(gatePasses(373, ['Richelieu', 'Commandant Teste', '雪風改']), false, '只有 2 艘法国舰')
})

test('Cy16：旗舰限早霜/秋霜/清霜，四艘里凑三艘（旗舰算在内）', () => {
  assert.equal(gatePasses(377, ['早霜改二', '秋霜改', '朝霜改二']), true)
  assert.equal(gatePasses(377, ['朝霜改二', '早霜改二', '秋霜改']), false, '朝霜当不了旗舰')
  assert.equal(gatePasses(377, ['早霜改二', '朝霜改二']), false, '只有 2 艘')
})

test('演习族十条：门落地之后一条 ≈ 都不剩', () => {
  // 这十条原先落在自研推导那一档，编成条件读不准的一律标 ≈（Cy1/Cy3/Cy12/Cy16 四条
  // 真标了）。既然门按日文原文逐条落地，就不该再有「计数可能偏多」这层怀疑；
  // 318/Cm2 的 partial 是另一回事（战斗粮食那一半本地判不了），留着。
  for (const questId of [318, 342, 345, 348, 354, 355, 371, 372, 373, 377]) {
    const rule = byId.get(questId)
    assert.ok(rule, `${questId} 没有规则`)
    assert.equal(rule.approx, false, `${rule.code} 还标着 ≈`)
    assert.equal(rule.tasks.length, 1)
    assert.equal(rule.tasks[0].kind, 'exercise')
    assert.ok(rule.fleetGoal?.groups.length, `${rule.code} 没有编成门`)
  }
})
