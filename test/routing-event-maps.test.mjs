// 活动图带路：解析器与引擎的三值行为。
//
// 62 期活动（2026 夏）之前，kcwiki-routing 只收常规图 1-1～7-5，图鉴海域页切到活动图
// 只能显示「资料里没有 62-1 的带路条件」。这一组钉的是把活动图接进来之后的两件事：
//
// ① **解析器**：活动页与常规页同模板，可以共用；但活动图带来了常规图 37 张里
//    一次都没出现过的两个构造，两个都会真咬人（见下面两条「活动图特有」测试）。
// ② **引擎**：活动图的难度是写在规则文本里的条件短语，不是单独一张表。引擎必须认它，
//    否则不是「不确定」而是**装懂**——把甲专属的分歧规则套到乙玩家头上还报「必走」。
//
// 判据出处：zh.kcwiki「<活动页>/E-N/带路条件」子页（2026-08-26 逐页比对确认与常规图同构）。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { parseRoutingHtml } from '../scripts/lib/kcwiki-routing.mjs'
import routingEngineModule from '../dist/shared/routing-engine.js'

const { evaluateRoutingRules } = routingEngineModule
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ---- 舰队上下文：一支 CL1 + DD4 + CVB1 的高速队，带电探 ----
const fleet = (overrides = {}) => ({
  shipCount: 6,
  counts: {
    DD: 4, DE: 0, CL: 1, CLT: 0, CT: 0, CA: 0, CAV: 0, CV: 0, CVL: 0, CVB: 1,
    BB: 0, FBB: 0, BBV: 0, SS: 0, SSV: 0, AV: 0, AS: 0, AO: 0, LHA: 0, lowSpeedBB: 0,
    'BB系': 0, 'CV系': 1, 'CA系': 0, 'SS系': 0, 'CL系': 1,
    ...(overrides.counts ?? {}),
  },
  shipNames: ['球磨', '雷', '電', '暁', '響', '大鳳'],
  flagshipName: '球磨',
  flagshipTypes: ['CL'],
  speed: 10,
  los: { 1: 40, 2: 60, 3: 70, 4: 90 },
  equipmentShipCounts: { radar: 5, drum: 0, landingCraft: 0 },
  passed: [],
  phase: null,
  difficulty: null,
  ...overrides,
})

// ============================================================
// 解析器：活动图特有的两个构造
// ============================================================

// 活动图 E-4 的分歧点**本身就叫 T1 / T2**，规则里于是有「已经过T2点的舰队 去Y1」。
// 老解析器拿裸的 `T<数字>` 当子表占位符，这个 T2 会被当成 2 号子表，
// 取 tables[2] 得到 undefined，整个抓取直接崩——常规图 37 张没有 T+数字 的点位名，
// 所以这颗雷一直埋到活动图才炸。
test('带路解析：分歧点叫 T1/T2、规则里也写着 T2 时不炸，且文本原样留住', () => {
  const html = `<div><table class="wikitable">
<tr><td>分歧点</td><td>条件</td></tr>
<tr><td>T1</td><td><ul><li> 索敌不足 去P2</li></ul></td></tr>
<tr><td>T2</td><td><ul><li> 已经过T2点的舰队 去Y</li><li> 其余去U</li></ul></td></tr>
</table></div>`
  const parsed = parseRoutingHtml(html)
  assert.ok(parsed, '含 T1/T2 点位名的表应当解析得出来，不是 null')
  assert.deepEqual(parsed.nodes.map((node) => node.from), ['T1', 'T2'])
  assert.deepEqual(parsed.nodes[1].rules, ['已经过T2点的舰队 去Y', '其余去U'])
})

// 占位符换成控制字符之后，格内子表压平这条老路必须还通（1-1 的概率表就是这个形状）。
test('带路解析：条件格里嵌的子表仍旧压平成「表头 值」的规则行', () => {
  const html = `<div><table class="wikitable">
<tr><td>分歧点</td><td>条件</td></tr>
<tr><td>出发点</td><td><table><tr><td>舰队船数</td><td>去B概率</td></tr>
<tr><td>1</td><td>20%</td></tr></table></td></tr>
</table></div>`
  const parsed = parseRoutingHtml(html)
  assert.deepEqual(parsed.nodes[0].rules, ['舰队船数 1 · 去B概率 20%'])
})

// ============================================================
// 引擎：难度短语
// ============================================================

// 上游把难度写进规则文本：「甲难度 CV+CVB>=1 去A1」。不认它的话，sumExpression 会把
// 「甲难度 CV」整体当成一个舰名词条记 0 分，于是这条在乙难度下照样算成 true。
test('带路难度：甲专属规则只在甲难度生效，别的难度不适用', () => {
  const rules = ['甲难度 CV+CVB>=1 去A1', '其余去B']
  const onKou = evaluateRoutingRules(rules, fleet({ difficulty: '甲' }), ['A1', 'B'])
  assert.equal(onKou.status, 'certain')
  assert.deepEqual(onKou.routes.map((r) => r.to), ['A1'])

  // 乙难度：这条明写着是甲的，跳过它，兜底的「其余去B」接管
  const onOtsu = evaluateRoutingRules(rules, fleet({ difficulty: '乙' }), ['A1', 'B'])
  assert.deepEqual(onOtsu.routes.map((r) => r.to), ['B'], '乙难度不该被甲的规则带去 A1')
})

test('带路难度：「乙丙丁难度」是一组，按包含判断', () => {
  const rules = ['乙丙丁难度 DD>=3 去G', '其余去F']
  for (const difficulty of ['乙', '丙', '丁']) {
    const decision = evaluateRoutingRules(rules, fleet({ difficulty }), ['G', 'F'])
    assert.deepEqual(decision.routes.map((r) => r.to), ['G'], `${difficulty}难度应当命中这条`)
  }
  const onKou = evaluateRoutingRules(rules, fleet({ difficulty: '甲' }), ['G', 'F'])
  assert.deepEqual(onKou.routes.map((r) => r.to), ['F'], '甲难度不在这一组里')
})

// 取不到难度时宁可说不确定，也不按甲的规则糊弄——这正是引擎头注写的三值口径。
test('带路难度：难度未知时出「不确定」，不冒充确定路线', () => {
  const rules = ['甲难度 CV+CVB>=1 去A1', '其余去B']
  const decision = evaluateRoutingRules(rules, fleet({ difficulty: null }), ['A1', 'B'])
  assert.notEqual(decision.status, 'certain', '难度都不知道，不该报「必走」')
  assert.ok(
    decision.unknownRules.some((rule) => rule.includes('甲难度')),
    '应当把这条难度规则列进「拿不准」里',
  )
})

// 括号里的难度字样是附注不是条件：「(全难度可与…混编)」「(甲难度未斩杀不允许…)」，
// 以及「索敌不足 去P2(分歧点系数=2，甲难度…固定不去P2)」这种把甲的阈值写进注里的写法。
test('带路难度：括号内的难度说明只是附注，不当条件用', () => {
  const rules = ['DD+DE=6 从2出发 贴增强第三十一战队 (全难度可与第三十一战队混编)']
  const decision = evaluateRoutingRules(rules, fleet({ difficulty: '丁', counts: { DD: 6 } }), ['2'])
  assert.equal(decision.status, 'certain', '括号里的「全难度」不该把这条变成不确定')
  assert.deepEqual(decision.routes.map((r) => r.to), ['2'])
})

// 索敌类规则上游往往只写甲的阈值，别的难度根本没记载。跳过它本身没错，
// 但不能让后面的「索敌不足 去X」以确定口吻兜底——那等于替上游编了个阈值。
test('带路难度：只写了甲阈值的索敌规则，在别的难度上要降级成「可能」', () => {
  const rules = ['分歧点系数=4，甲难度索敌>=66 固定去C2', '索敌不足 去D']
  const onKou = evaluateRoutingRules(rules, fleet({ difficulty: '甲' }), ['C2', 'D'])
  assert.equal(onKou.status, 'certain')
  assert.deepEqual(onKou.routes.map((r) => r.to), ['C2'])

  const onHei = evaluateRoutingRules(rules, fleet({ difficulty: '丙' }), ['C2', 'D'])
  assert.notEqual(onHei.status, 'certain', '丙难度的阈值上游没写，不该报「必走」')
  assert.ok(
    onHei.unknownRules.some((rule) => rule.includes('甲难度索敌')),
    '要把「只有甲的阈值」这件事记进拿不准里',
  )
})

// ============================================================
// 引擎：机关闸门段
// ============================================================

// 活动图的规则表大量用「段落 + 段内规则」的写法：一条没有目的地的规则（「未开启P1boss(I)点」）
// 起头，后面几条都归它管。段落条件判不出来时，段内规则就**不能**报「必走」。
//
// 这里原先有个会吞掉不确定的坑：段落判定取的是 `section?.result.value ?? true`，
// 而 `??` 只在 null/undefined 时回落——段落判定为 null（资料没说机关开没开）恰好就是 null，
// 于是被吞成 true 当作闸门已开。2026-08-26 用户裁定这是 bug 不是语义：
// 引擎头注立的约法是「只有此前没有未知分支 + 当前规则确定命中才输出 certain」。
test('带路机关：闸门段判不出来时，段内规则只能报「可能」不能报「必走」', () => {
  const rules = [
    '未开启P1boss(I)点', // ← 闸门段：机关开没开，资料里没有、账本里也没有
    '舰队船数=6 去A2',
    '其余去B',
  ]
  const decision = evaluateRoutingRules(rules, fleet({ difficulty: '甲' }), ['A2', 'B'])
  assert.notEqual(decision.status, 'certain', '机关状态未知，不该报「必走 A2」')
  assert.ok(
    decision.unknownRules.some((rule) => rule.includes('未开启P1boss')),
    '要把「机关状态不知道」这件事记进拿不准里',
  )
  assert.ok(
    decision.routes.some((route) => route.to === 'A2'),
    'A2 仍旧是候选，只是不确定——不是把它整条丢掉',
  )
})

// 闸门段判得出来时照旧确定：修掉 `??` 不能把「段落条件为真」也一起变成不确定。
test('带路机关：闸门段判得出来时，段内规则照旧能报「必走」', () => {
  const rules = ['低速舰队', 'DD>=3 去C', '其余去D']
  const slow = evaluateRoutingRules(rules, fleet({ speed: 5, difficulty: null }), ['C', 'D'])
  assert.equal(slow.status, 'certain', '段落条件（低速）明确成立，段内规则该照常确定')
  assert.deepEqual(slow.routes.map((r) => r.to), ['C'])
})

// ============================================================
// 引擎：多出发点合流
// ============================================================

// 活动图多出发点合流的点位写「从2出发的舰队 去O」，这里的「从2出发」是**条件**。
// 老的 conditionPartOf 在第一个「从/去 + 字母数字」处切条件，于是切出**空条件**，
// 而空条件在 evaluateRoutingCondition 里是恒真——等于无条件必走 O。
test('带路出发点：「从N出发的舰队」是条件不是目的地，不许当成恒真', () => {
  const rules = ['从2出发的舰队 去O', '其余去D']
  const decision = evaluateRoutingRules(rules, fleet({ difficulty: '甲' }), ['O', 'D'])
  assert.notEqual(decision.status, 'certain', '不知道这支队从哪个出发点来，不该报「必走 O」')
  assert.ok(
    decision.unknownRules.some((rule) => rule.includes('从2出发的舰队')),
    '应当把出发点这件事列进「拿不准」',
  )
})

// 常规图 5-6 也有两个出发点，但写法是**赋值式**的「其余从2出发」——那个 2 是目的地。
// 两种写法只差「的舰队」三个字，改判定时不能把这一条也带走。
test('带路出发点：常规图赋值式的「其余从2出发」仍旧当目的地', () => {
  const rules = ['AV+LHA>=1 从1出发', '其余从2出发']
  const decision = evaluateRoutingRules(rules, fleet({ difficulty: null }), ['1', '2'])
  assert.equal(decision.status, 'certain')
  assert.deepEqual(decision.routes.map((r) => r.to), ['2'])
})

// ============================================================
// 抓取产物的形状
// ============================================================

// kcwiki-routing 是 bundle:true 的入仓包（git ls-files 有它），所以这条护栏一定会跑，
// 不会因为「文件不随包」而静默跳过。
test('带路资料包：活动图条目在仓库里，且键形与校验器一致', () => {
  const file = path.join(ROOT, 'assets', 'lodes', 'kcwiki-routing.json')
  assert.ok(fs.existsSync(file), 'kcwiki-routing.json 是入仓包，不该缺')
  const { data } = JSON.parse(fs.readFileSync(file, 'utf8'))
  const codes = Object.keys(data)

  // 校验器 src/main/lode-validation.ts 的 SAFE_MAP 是 /^\d+-\d+$/：活动图必须写成
  // 62-1 这种「海域 id-图号」，写 E-1 会被整包判非法。
  for (const code of codes) {
    assert.match(code, /^\d+-\d+$/, `${code} 不符合 SAFE_MAP，整包会被校验器拒掉`)
  }

  const eventCodes = codes.filter((code) => Number(code.split('-')[0]) >= 10)
  assert.ok(eventCodes.length > 0, '活动图带路已并进这个包，不该一张都没有')
  for (const code of eventCodes) {
    const entry = data[code]
    assert.ok(Array.isArray(entry.nodes) && entry.nodes.length > 0, `${code} 应当有分歧点`)
    assert.match(entry.page, /\/带路条件$/, `${code} 的出处要指到「带路条件」子页`)
    assert.match(entry.contentDate, /^\d{4}-\d{2}-\d{2}$/, `${code} 缺内容日期，校验器会拒`)
    for (const node of entry.nodes) {
      assert.ok(typeof node.from === 'string' && node.from.length > 0, `${code} 有空的分歧点名`)
      assert.ok(
        node.rules.every((rule) => typeof rule === 'string' && rule.trim().length > 0),
        `${code} [${node.from}] 有空规则`,
      )
    }
  }
})

// 规则文本是抓来的转录，不是手打的。若哪天有人手改了包，这条会先叫起来：
// 活动图规则里的难度短语必须还是引擎认得的那个形状。
test('带路资料包：活动图的难度短语是引擎认得的写法', () => {
  const file = path.join(ROOT, 'assets', 'lodes', 'kcwiki-routing.json')
  const { data } = JSON.parse(fs.readFileSync(file, 'utf8'))
  const withDifficulty = []
  for (const [code, entry] of Object.entries(data)) {
    if (Number(code.split('-')[0]) < 10) continue
    for (const node of entry.nodes) {
      for (const rule of node.rules) if (/难度/.test(rule)) withDifficulty.push(rule)
    }
  }
  assert.ok(withDifficulty.length > 0, '活动图规则里本来就有难度短语，一条都没有说明抓漏了')
  for (const rule of withDifficulty) {
    // 去掉括号里的附注之后，剩下的难度字样必须是「<甲乙丙丁的组合>难度」
    const outside = rule.replace(/[（(][^（）()]*[）)]/g, ' ')
    if (!/难度/.test(outside)) continue
    assert.match(
      outside,
      /[甲乙丙丁]+难度/,
      `难度短语写法变了，引擎的难度判断会失效：${rule}`,
    )
  }
})
