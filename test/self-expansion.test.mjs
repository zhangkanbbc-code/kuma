// 自扩展两层公约的护栏（用户 2026-08-23 定的总纲）：
//   · **存在层**——实体在主数据/亲历里一出现，模块必须当场长格子，零人力；
//   · **名分层**——知识层允许滞后，但等待期间必须**显形**（短横/编号/挂牌/探测钮），
//     名分到位按地址对账自动升格。反模式是「清单先行、对不上就隐身」。
//
// 这份护栏钉的是 2026-08-23 那轮体检**实测**抓到的几处隐身与错判。判据尽量落在
// 能真跑的那一层（shared 里那几条各有自己的测试文件：
// ship-nationality 的「未归类」桶、equip-sources 的改修覆盖边界）；
// 只有住在渲染层、脱不开 Electron 的才退回结构级断言，并且**不做单点正则**，
// 而是断言「这一条早退分支里必须有什么」这种位置明确的结构性质
//（共享记忆 source-pattern-guards-miss-logic-bugs：正则挡不住判断写反，
//  所以下面每一条都注明了它当初是怎么被实测抓到的）。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const src = (relative) => fs.readFileSync(new URL(`../src/${relative}`, import.meta.url), 'utf8')

/** 取一个顶层箭头函数的函数体（到下一处顶层 `}` 为止）。 */
const bodyOf = (source, signature) => {
  const start = source.indexOf(signature)
  assert.notEqual(start, -1, `找不到 ${signature}`)
  const end = source.indexOf('\n}\n', start)
  assert.notEqual(end, -1, `${signature} 没有可识别的结尾`)
  return source.slice(start, end)
}

test('海图包没收这张图时，带路三段**不许跟着一起消失**', () => {
  // 实测（2026-08-23，合成一张只在 mapinfo 里的 7-6 跑真渲染函数）：
  // 早退分支的输出只有 355 字节、不含「带路条件」，而单独调 routingHtml('7-6')
  // 是有挂牌的（409 字节）——即带路段被这条早退顺手吞掉了。
  // 海图包（节点坐标）与带路资料是**两份**东西，前者没有这张图不代表后者也没有。
  const ji = src('renderer/modules/ji.ts')
  const body = bodyOf(ji, 'const mapGraphHtml = (info: any): string => {')
  // 两条出路（缺图的早退 + 正常画完）各带一次，一次不多一次不少：
  // 少一次就是又吞掉了，多一次就是同一段挂了两遍
  assert.equal(
    (body.match(/routingHtml\(code\)/g) ?? []).length,
    2,
    'mapGraphHtml 的两条 return 各要带一次 routingHtml(code)',
  )
  // 早退分支自己要带——这才是当初漏掉的那一条。
  // 2026-08-25 判据从 `!fcd?.spots || !fcd?.route` 换成 fcdTopologyUsable：
  // 上游给新图落的空壳 `{spots:{},route:{}}` 骗得过真值判断，于是新图既画不出图、
  // 挂牌也一条不出——那正是这条测试要防的病，只是换了个入口进来的
  //（判据与它的实测见 shared/fcd-topology.ts 与 test/fcd-topology.test.mjs）。
  const guard = body.indexOf('if (!fcdTopologyUsable(fcd)) {')
  assert.notEqual(guard, -1, '缺图的早退判断不见了')
  const earlyReturn = body.slice(guard, body.indexOf('\n  }', guard))
  assert.ok(
    earlyReturn.includes('routingHtml(code)'),
    '海图包缺这张图时带路三段又被吞掉了（整段消失，玩家分不出「没有分歧」还是「没数据」）',
  )
})

test('可装备规则取不到时挂牌，不许整段空掉', () => {
  // 实测：给一艘 stype 在 api_mst_stype 里缺席的合成新舰跑 equipMatrixHtml，
  // 原先返回空字符串（0 字节）——「这艘什么都装不了」与「我们没有它的规则」
  // 在界面上长一个样。判据同「不展示代表没有」那条通则。
  const ji = src('renderer/modules/ji.ts')
  const body = bodyOf(ji, 'const equipMatrixHtml = (shipMstId: number): string => {')
  const guard = body.slice(body.indexOf('if (!types.length)'), body.indexOf('const chips'))
  assert.ok(!/if \(!types\.length\) return ''/.test(body), '规则取不到时又变回整段消失了')
  assert.ok(guard.includes('可装备范围'), '挂牌要保留段头，否则那一格在页面上还是不存在')
  // 不许把「资料没到」说成「这艘舰装不了」
  assert.ok(/这一形态的可装备规则待同步/.test(guard), '挂牌要说清这是资料状态，不是事实')
})

test('任务分类有兜底格：任务库没收的新任务不会从每个分类页上消失', () => {
  // 实测：拿一条 code 落 `?` 的新任务逐个跑 CATEGORY_FILTERS 的 test，
  // 修复前**一个都不命中**（只有「全部」看得见它），修复后命中 unclassified，
  // 而正常的 B1 任务仍旧只命中 sortie（兜底格不抢别人的行）。
  const qn = src('renderer/modules/qn.ts')
  // 兜底格的判据必须是「命名分类一个都不命中」的否定，不能自己另写一套编号规则
  // ——另写一套就会与命名分类各判各的，出现两边都收或两边都不收
  assert.match(
    qn,
    /key: 'unclassified',[\s\S]{0,200}test: \(row\) => !NAMED_CATEGORY_FILTERS\.some\(/,
    '兜底格必须定义成「命名分类都不命中」',
  )
  // 命名分类那一份里不许含它自己，否则 test 自指、永远为假
  const namedStart = qn.indexOf('const NAMED_CATEGORY_FILTERS: QuestCategory[] = [')
  assert.notEqual(namedStart, -1, '找不到命名分类表')
  const named = qn.slice(namedStart, qn.indexOf('\n]\n', namedStart))
  assert.ok(!named.includes('unclassified'), '兜底格混进了命名分类，判据会自指')
  // 空的时候不摆：常驻一个 0 是噪音，不是显形
  assert.match(qn, /onlyWhenPresent \|\| categoryCountOf\(category\.key\) > 0/)
})

test('缺包的挂牌一律说资料状态，不替官方下结论', () => {
  // 「不可改修」曾经是硬判的（peek 卡片直接写死这四个字），刚实装的装备一律被
  // 说成不能改。现在两处都按覆盖边界分档（判据本身在 shared/equip-sources，
  // 那边有能真跑的测试）。这里只钉「渲染层确实接了那条判据」。
  const ji = src('renderer/modules/ji.ts')
  assert.equal(
    (ji.match(/improvePackUncovered\(/g) ?? []).length,
    2,
    '抽屉与 peek 两处都要按覆盖边界分档',
  )
  // 二义文案不许回潮
  assert.ok(
    !ji.includes('当前资料显示这件装备不可改修，或暂未收录相关数据'),
    '「不可改修，或暂未收录」这种两义合一的说法又回来了',
  )
  // 深海数值区那条既有的挂牌是同族的正面样板，别退化成空段。
  // 括号里的猜测「（多半是刚加入游戏）」按 2026-08-26 文案清扫裁定删；
  // 挂牌本身（「资料没收」这个如实状态）必须还在，这才是本条要守的东西。
  assert.ok(
    ji.includes('社区资料暂无这艘深海舰的估算数据'),
    '深海数值区的挂牌不见了',
  )
})
