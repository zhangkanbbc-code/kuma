#!/usr/bin/env node
// 维护者只读对照资料两份资料包、改造主数据和既有节流通道取得的 CC 页面缓存。
// --check 不写；--update-fixture 仅在逐项复核后更新输入指纹与旧消费基线。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { remodelDifferences, resolveMaterial } from './lib/remodel-fact-audit.mjs'
import { MAINTAINER_REMODEL_CORRECTIONS, reconcileStagedRemodel } from './lib/remodel-stages.mjs'
import { remodelRuntime } from './lib/remodel-fact-runtime.mjs'


const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const arg = (key, fallback) => process.argv.find(x => x.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'))
const hash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex')
const dataDir = arg('data-dir', path.join(process.env.APPDATA, 'kuma'))
const cacheDir = arg('source-cache', path.join(process.env.TEMP, 'kuma-medium-20260906'))
const files = { kcwiki: path.join(ROOT, 'assets/lodes/kcwiki-ships.json'), wikiwiki: path.join(ROOT, 'assets/lodes/wikiwiki-remodel.json'), master: path.join(dataDir, 'snapshots/kcsapi_api_start2_getData.json') }
const snapshot = read(files.master), raw = snapshot.body?.api_data ?? snapshot.data ?? snapshot.api_data
const kc = read(files.kcwiki).data, wiki = read(files.wikiwiki).data
const sourceHashes = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, hash(file)]))
const pages = {}
for (const title of ['改造', '模块:舰娘数据', '球磨', '春雨', '三隈', '贝尔格拉诺将军', '翔鹤', '瑞鹤', '霞', '朝潮', '最上', '铃谷', '熊野', 'Saratoga', '瑞凤', '山风', '榛名', '赤城', 'Fletcher', '矢矧', '龙凤', '凤翔', '天雾', '大和', '清霜', '加贺', '夕张', '宗谷']) {
  const file = path.join(cacheDir, `${encodeURIComponent(title)}.json`)
  const page = Object.values(read(file).query.pages)[0]
  pages[title] = { title: page.title, revision: page.revisions[0].revid, text: page.revisions[0]['*'] }
  sourceHashes[title] = hash(file)
}
if (!pages['贝尔格拉诺将军'].text.includes('凤凰城改(Lv45)→贝尔格拉诺将军(Lv75+新型兵装资材x1+开发资材x30)') ||
  !pages['春雨'].text.includes('改修资材×5') || !pages['三隈'].text.includes('高速建造材x60+开发资材x45')) throw new Error('已复核的 CC 原文漂移')
if (Number(raw.api_mst_ship.find(s => s.api_id === 734)?.api_aftershipid) !== 957) throw new Error('Phoenix 主数据链漂移')
const supplements = [{ from: 734, to: 957, name: '新型兵装资材', count: 1 }, { from: 734, to: 957, name: '开发资材', count: 30 }]
// 对照资料舰页可逐边解读的段落。只取所指形态的需求子句，句首“互相转换”不跨句传作档名。
const pageRows = []
function pageNeed(title, edge, pattern) {
  const text = pages[title].text.match(pattern)?.[0]
  if (!text) throw new Error('已复核舰页需求段漂移：' + title + ' ' + edge)
  const materials = {}
  for (const m of text.matchAll(/([^\s+＋、，。x×]+)[x×]\s*(\d+)/g)) {
    const material = resolveMaterial(m[1], raw)
    if (!material) throw new Error('舰页素材未解号：' + m[1])
    materials[material.kind + ':' + material.id] = Number(m[2])
  }
  pageRows.push({ site: 'kcwikiPage', title, revision: pages[title].revision, edge, stage: 'unknown', materials, raw: text,
    evidence: 'https://zh.kcwiki.cn/wiki/' + encodeURIComponent(title) })
}
for (const [title, entry, next] of [['三隈', '121→502', '502→507'], ['最上', '73→501', '501→506']]) {
  pageNeed(title, entry, /改装设计图x1\+开发资材x60\+战斗详报x1\+新型航空兵装资材x2/)
  pageNeed(title, next, /高速建造材x60\+开发资材x45/)
}
pageNeed('春雨', '323→975', /改修资材×5/)
pageNeed('矢矧', '307→663', /改装设计图×1\+战斗详报×1\+高速建造材×88\+开发资材×88/)
pageNeed('贝尔格拉诺将军', '734→957', /新型兵装资材x1\+开发资材x30/)
const result = reconcileStagedRemodel(kc, wiki, raw, pages['改造'].text, supplements, [], pageRows)
const pageReview = Object.entries(pages).filter(([title]) => !['改造', '模块:舰娘数据'].includes(title)).map(([title, page]) => ({
  title, revision: page.revision, extractedEdges: pageRows.filter(r => r.title === title).map(r => r.edge),
  text: page.text.split('\n').filter(line => /(?:开发资材|高速建造材|改修资材)[x×]/.test(line)).join('\n'),
}))
const pack = { meta: { id: 'remodel-facts', name: '改造素材', version: '2026.09.07.2', source: 'kuma 第一方登记表', license: '第一方产物', fetchedAt: '2026-09-07T00:00:00.000Z', note: '改造的特殊素材与回程成本', maintainerNote: [
  'wikiwiki主条目为first，footnote附加边为convert；百科按列/段落及同边同档整列对齐。API显式值（含零）优先。',
  '三隈502→507初次按公开游戏改装画面（2026-09 核）裁定高建40／开发35；wikiwiki开发45、舰页高建60／开发45为来源错误。往复仍为40/35；507→502往复仍为40/15。',
  '本次全部来源仅作只读核对；来源结构、API核对、分档冲突、缺项及旧解析修正见docs/remodel-facts-report.md。',
  '2026-09-07：first空对象由wikiwiki目标主条目同来路needs=[]、同边API全部*_count显式零、百科出发形态指向目标的改造行无图纸共同确认；直接互逆回程允许主条目来自常规前置形态，但须needs=[]且同向无脚注、转换段无带成本行。convert空对象须直接互逆两向first确认无、两向无脚注且转换段无该对，或转换段同向显式空成本、同向无脚注、API同边全部*_count显式零；缺边或缺档仍未知；无特殊素材标签仅可逆改造显示；命中：' + result.confirmedNone.map(r => r.edge + '/' + r.stage).join('、') + '。',
], corrections: MAINTAINER_REMODEL_CORRECTIONS, evidence: result.evidence }, data: result.data }
const fixturePath = path.join(ROOT, 'test/fixtures/remodel-facts.json')
const oldFixture = read(fixturePath)
const baseline = process.argv.includes('--update-fixture') && !oldFixture.stageBaseline
  ? read(arg('baseline', path.join(process.env.TEMP, 'kuma-remodel-stage-baseline.json')))
  : { output: oldFixture.stageBaseline, head: oldFixture.baselineHead }
if (!baseline.output) throw new Error('缺 HEAD 176de57 的真实旧输出')
const runtime = remodelRuntime(raw, kc, { facts: pack })
const stagedOutput = Object.fromEntries(Object.keys(baseline.output).map(edge => {
  const [from, to] = edge.split('→').map(Number)
  const groups = runtime.needChipsHtml(Object.values(kc).find(s => s.ID === from)?.改造?.图纸, to, from).stages
  return [edge, Object.fromEntries(groups.map(g => [g.stage, { missing: g.missing, needs: Object.fromEntries(g.needs.map(n => [`${n.kind}:${n.id ?? n.name}`, n.count])) }]))]
}))
const differences = ['first', 'convert'].flatMap(stage => remodelDifferences(baseline.output,
  Object.fromEntries(Object.entries(stagedOutput).filter(([, groups]) => groups[stage]).map(([edge, groups]) => [edge, groups[stage].needs])),
).filter(row => stagedOutput[row.edge]?.[stage]).map(row => ({ ...row, stage })))
const fixture = { sourceHashes, raw: oldFixture.raw, baselineHead: baseline.head, stageBaseline: baseline.output,
  output: stagedOutput, differences, conflicts: result.conflicts, missing: result.missing, corrections: result.corrections,
  unknown: result.unknown, unresolved: result.unresolved, observations: result.observations, sourceErrors: result.sourceErrors, confirmedNone: result.confirmedNone, pageReview, groups: result.groups, direct: result.direct }
const table = (columns, rows) => [`| ${columns.join(' | ')} |`, `| ${columns.map(() => '---').join(' | ')} |`, ...rows.map(r => `| ${r.map(v => String(v).replaceAll('|', '／').replaceAll('\n', ' ')).join(' | ')} |`)].join('\n')
const name = id => raw.api_mst_ship.find(s => s.api_id === id)?.api_name ?? id
const status = edge => ['first', 'convert'].map(stage => `${stage === 'first' ? '初次' : '往复'}：${pack.data[edge]?.stages?.[stage] ? JSON.stringify(pack.data[edge].stages[stage]) : '缺'}`).join('；')
const cyclic = edge => { const ids = edge.split('→').map(Number); return result.groups.some(g => ids.every(id => g.includes(id))) }
const firstCycles = Object.entries(pack.data).filter(([edge, row]) => cyclic(edge) && row.stages.first).length
const reviewEdges = ['506→501', '629→628', '911→916']
const report = `# 改造素材结构分档核对（2026-09-07）

本单起点 f6a39b7，工作树干净；测试基线3877、skipped 0。跨版本旧消费仍冻结在 ${baseline.head} 的555条边，未覆盖旧基线。当前事实 ${Object.keys(pack.data).length} 条边，初次 ${Object.values(pack.data).filter(r => r.stages.first).length} 条（此前101），往复 ${Object.values(pack.data).filter(r => r.stages.convert).length} 条。循环内初次从0填到 **${firstCycles}** 条。这里只计API表外素材；“缺”不是零，有值也不表示所有素材齐全。

2026-09-06 画面裁定补单起点 b70d12b，工作树干净；测试基线3911、skipped 0。仅补502→507初次高建40／开发35，往复不变；原始来源冲突保留并标为已裁。

## 确认无特殊素材

2026-09-07，首单起点ca53fbe、测试基线3967；续单起点2b216f9、工作树干净、测试基线3998，skipped均为0。某档{}表示确认无特殊素材；缺边或缺档仍未知，stages本身不允许为空。正向first规则保持：wikiwiki目标主条目fromShipId同出发且needs=[]，同边api_mst_shipupgrade全部*_count显式零，以及百科出发形态的改造行“改造后”对齐目标且无图纸或图纸为空。回程first与convert按下面两条补充判据。以下共${result.confirmedNone.length}边/档，first ${result.confirmedNone.filter(r => r.stage === 'first').length}、convert ${result.confirmedNone.filter(r => r.stage === 'convert').length}；数据不限定循环边，显示层仅convertible为真时显示“无特殊素材”，普通单向空档不显示文字。

### 回程与转换段空成本行

主数据api_mst_shipupgrade直接互逆A⇄B的B→A回程first：API同边全部*_count显式零；百科ID=B的改造行指向A且图纸栏缺失或为空；wikiwiki无B→A脚注附加边；百科转换段无B→A带成本行（显式空成本行不算带成本）；目标A主条目needs=[]。该主条目可来自常规前置形态，来路不同仅作目标形态无需特殊道具的佐证，写入basis，不再否决。

convert确认无有两条独立规则：①主数据直接互逆、两向first均确认无、两向无wikiwiki脚注、百科转换段无该对；②百科转换段该方向有显式空成本格（空白或“-”，缺成本格不算）、wikiwiki同向无脚注、API同边全部*_count显式零。两规则均逐条保留三源evidence；无行／无脚注的核对结果记[]，空成本保留原格文字与边方向。

本地实测新增8边/档：468→463、470→464的first；463→468、468→463、464→470、470→464、911→916及646→698的convert。朝潮／霞转换段四方向实际均有“-”成本格，命中规则②，不能报告成“转换段无该对”。额外646→698（加贺改二护→加贺改二）属于既有三形态循环，转换段该方向空成本、wikiwiki同向无脚注、API同边全零，同样按规则②收录；该规则未限定直接互逆对，循环口径不变。

公开来源原文（核对日期2026-09-07；wikiwiki注明页面日期，百科随包模块来源日期${read(files.kcwiki).meta.upstreamUpdatedAt}；API为游戏api_mst_shipupgrade对应行）：

${table(['边', '档', 'wikiwiki原文／结构', 'API原文', '百科原文／结构', '结论'], result.confirmedNone.map(r => [r.edge, r.stage,
  r.sources.filter(s => s.site === 'wikiwiki').map(s => s.evidence + '（' + s.date + '）' + (typeof s.raw === 'string' ? s.raw : JSON.stringify(s.raw)) + '；' + s.basis).join('；'),
  r.sources.filter(s => s.site === 'api').map(s => JSON.stringify(s.raw)).join('；'),
  r.sources.filter(s => s.site.startsWith('kcwiki')).map(s => s.evidence + ' ' + JSON.stringify(s.raw) + '；' + s.basis).join('；'), '无特殊素材' + (r.basis ? '；' + r.basis : '')]))}

朝潮与霞逐边核对（2026-09-07）：

${table(['边', 'wikiwiki目标主条目来路／原文', '结果'], ['463→468', '468→463', '464→470', '470→464'].map(edge => {
  const [from, to] = edge.split('→').map(Number), entry = wiki[to]
  return [edge, entry.fromShipId + '→' + to + '／' + entry.raw,
    status(edge) + (entry.fromShipId !== from ? '；按直接互逆回程判据确认first，常规路径主条目仅作目标佐证' : '；同来路三源确认first') + '；同向转换段成本“-”、无脚注、API全零，convert确认无']
}))}

## 三条数字边重对与Glorious

2026-09-07保持既有判档与冲突规则。最上506→501：脚注40/15与百科模块“高速建造材x40 开发资材x15”整列同值，可归convert；百科转换段按←归此边却为30/45，两素材均冲突，仍不收。Fletcher 629→628：脚注20/20与模块“高速建造材x20 开发资材x20”同值归convert；百科转换段按←为65/45，两素材均冲突，仍不收。两条的first均缺同来路wikiwiki主条目，不能借convert补first。

大和911→916：wikiwiki目标916主条目来自911，原文“Lv93”、needs=[]；API同边计数全零；百科ID=911的改造行无图纸，故first按三源规则确认无。百科“高速建造材x50 开发资材x50”实际在ID=916的改造行，改造后=511对应911，即916→911；不能挪到911→916。百科转换段911→916存在显式空成本行、wikiwiki同向无脚注、API同边全零，convert确认无；反向916→911的convert仍为50/50。

重对原文与分档依据（均为既有公开来源，核对日期2026-09-07）：

${table(['边', '档', '来源', '原文', '判据'], [...result.observations, ...result.unknown].filter(r => [...reviewEdges, '916→911'].includes(r.edge)).map(r => [r.edge, r.stage, r.evidence, r.raw ?? '', r.basis ?? '']))}

${table(['边', '当前事实', '未收数值及冲突来源'], reviewEdges.map(edge => [edge, status(edge), result.conflicts.filter(r => r.edge === edge).map(r => r.stage + '/' + r.identity + ' ' + JSON.stringify(r.values)).join('；') || '无数值冲突；缺档按上文结构判据保留未知']))}

Glorious：解析器现在只按页面明确的Glorious改(正規空母)／Glorious改(巡洋戦艦)注记分别解为741／740，无注记不猜。随包wikiwiki的740与741主记录只保留目标编号、等级65／50、空needs及总表日期2026-08-18，未保留sourceName或fromShipId，不能由这些记录恢复原页面注记；本单不取原页面、不改上游包。当前API升级表也没有740→741或741→740行，百科随包数据没有两形态改造行；因此两向不生成确认无事实。api_mst_ship虽有同名互指，但不等于api_mst_shipupgrade直接互逆对，现行运行时也不会为它们生成可逆“素材待补”档。本单只报告证据缺口，不更改循环识别口径。

## 判档规则前后

旧：先合并各来源同边素材，再找初回／2回目以降／コンバート字样；无文字标注的循环边成为档不明。

新：wikiwiki每个目标的主条目直接归first，edges[source=footnote]直接归convert，各保留raw和结构evidence。返回／再度等文字只作佐证，不是门槛。附加index/chart不是主条目；与百科同边明确往复列逐项相等才归convert，未对齐的不猜档。

2026-09-06 单向进入边纠错（起点292255b）：运行时原先只判目标属于循环，现要求出发与目标同属 api_mst_shipupgrade 穷举出的循环。23条单向进入边固定first，无游戏报文也不生成往复档、不标uncertain，需求合计正常纳入62个真实素材数量格。伪往复档的19格缺料及43个重复原生chip归零。生成器同样不收非循环边的convert；本次检查已有事实表，此类档为0，清理0档，事实素材数据不变。

以下逐边列出无游戏报文输出；均仅first、missing=false，反查uncertain=false。素材键为种类与主数据ID，数量为实际初次消耗。

${table(['单向进入边', '初次素材'], Object.entries(stagedOutput).filter(([edge]) => !cyclic(edge) && result.groups.some(g => g.includes(Number(edge.split('→')[1])))).map(([edge, stages]) => [edge, JSON.stringify(stages.first.needs)]))}

百科“可以进行转换改装的舰船”段落按箭头及各列归convert；其他单串（模块、舰页）整列与wikiwiki同边已定档值比较，共有素材全部相等才佐证该档，单侧缺少的素材记来源缺项；唯一候选档不等记录冲突，多档均不等保留unknown。同值可佐证两档，不以方向代替档位。舰页的“互相转换”介绍句不传作后面形态需求子句的档名。初次原生道具逐边核对api_mst_shipupgrade的drawing/report/catapult/aviation_mat/arms_mat/boiler/tech字段，显式零也核对；冲突留审计，原生字段仍由API提供。

## 往复对与当前收录

主数据直接互逆${result.direct.length}对，另有${result.groups.filter(g => g.length > 2).length}组三形态循环。表中useitem:2为高速建造材，useitem:3为开发资材；原生道具不重复入事实表。

${table(['往复对（mstId/日文主数据名）', '左→右', '右→左'], result.direct.map(([a,b]) => [`${a} ${name(a)} ⇄ ${b} ${name(b)}`, status(`${a}→${b}`), status(`${b}→${a}`)]))}

${table(['循环', '边', '两档'], result.groups.filter(g => g.length > 2).flatMap(g => raw.api_mst_shipupgrade.filter(r => g.includes(r.api_current_ship_id) && g.includes(r.api_id)).map(r => [g.map(id => `${id} ${name(id)}`).join('／'), `${r.api_current_ship_id}→${r.api_id}`, status(`${r.api_current_ship_id}→${r.api_id}`)])))}

## 按档对账

${['first', 'convert'].map(stage => `### ${stage === 'first' ? '初次' : '往复'}

数值冲突（API也是核对来源；未裁素材不收，已裁项保留原值）：

${table(['边', '素材', '各来源值', '处理'], result.conflicts.filter(r => r.stage === stage).map(r => [r.edge, r.identity, JSON.stringify(r.values), r.resolution ? r.resolution.status + '；收录' + r.resolution.count : '不收；API字段仍按主数据显示']))}

来源缺项（逐素材；API字段只核对、不入事实表）：

${table(['边', '素材', '已提供该档数值的来源', '收录'], result.missing.filter(r => r.stage === stage).map(r => [r.edge, r.identity, JSON.stringify(r.values), pack.data[r.edge]?.stages?.[stage]?.[r.identity] ?? '未入表（API／冲突）']))}

旧解析修正：

${table(['边', '来源', '旧身份', '新身份', '数量', '依据'], result.corrections.filter(r => r.stage === stage).map(r => [r.edge, r.site, r.oldIdentity, r.newIdentity, r.count, r.basis]))}`).join('\n\n')}

## 来源行错误与档不明

${table(['边', '原档', '来源', '原值', '原因'], result.sourceErrors.map(r => [r.edge, r.stage, r.site, JSON.stringify(r.materials), r.reason]))}

${table(['边', '来源', '值', '原文'], result.unknown.map(r => [r.edge, r.site, JSON.stringify(r.materials), r.raw]))}

${table(['舰页', '修订', '已提取边', '数值原文（空表示本次数值扫描未找到）'], pageReview.map(r => [r.title, r.revision, r.extractedEdges.join('、'), r.text]))}

## 三隈两边两档

502→507初次：公开游戏改装画面（2026-09 核）显示 新型兵装資材1／高速建造材40／開発資材35，与舰娘百科模块、zekamashi 同值。初次收高建40／开发35；wikiwiki开发45、舰页高建60／开发45归来源错误，两项原始冲突标为“已裁（画面证据）”。

维护者订正（仅指定边、档及两种API表外素材）：

${table(['边', '档', '素材', 'basis', 'evidence', 'date'], MAINTAINER_REMODEL_CORRECTIONS.map(r => [r.edge, r.stage, JSON.stringify(r.materials), r.basis, r.evidence, r.date]))}

对照资料主数据核对：api_mst_ship[api_id=502].api_afterbull=${raw.api_mst_ship.find(s => s.api_id === 502)?.api_afterbull}（画面弾薬1800），api_afterfuel=${raw.api_mst_ship.find(s => s.api_id === 502)?.api_afterfuel}（画面鋼材3800）；502→507的api_mst_shipupgrade.api_arms_mat_count=${raw.api_mst_shipupgrade.find(s => s.api_current_ship_id === 502 && s.api_id === 507)?.api_arms_mat_count}（画面新型兵装資材1）。三项均一致，主数据未改；新型兵装資材由API提供，不重复入事实表。

502→507往复：维持高建40／开发35；preserved证据单列，不伪称wikiwiki初次45是往复冲突。zekamashi仅保留统筹方给定URL，没有抓取或新判档。

507→502初次：缺；wikiwiki目标502主条目来路是121，不能挪到507。507→502往复：wikiwiki脚注高建40／开发15，模块同边同值佐证；事实表收40/15。

百科总表缓存正向行确为40/15、回程行确为30/45，解析器按箭头读取无误；按本单回程裁定，把这两行记作总表来源行错误而排除合并，保留原边原档原值，不能静默互换。其15落在正向格，却与wikiwiki回程15对应。

${table(['边', '来源', '档', '值', '判档依据'], [...result.observations, ...result.unknown].filter(r => ['502→507', '507→502'].includes(r.edge)).map(r => [r.edge, r.site, r.stage, JSON.stringify(r.materials), r.basis ?? '']))}

## 运行时、口径与输入

此前结构分档返工未改运行时；本次仅收紧分档边界。API显式值（含零）优先，循环内边未知历史两档并列、不相加；单向进入边只计初次。生产口径审计及白名单复核见[player-view-audit.md](player-view-audit.md)，不得用白名单掩盖来源冲突。

反查等级以主数据 api_afterlv 为准（2026-09-06 跨版本对账确认为纠错）：取出发形态的 api_mst_ship[from].api_afterlv，替代旧 wiki 明细／目标等级回退值。74e0b67 → 292255b 对账的16条边、27个等级格均符合API，例如330→963由88改85，507→502由82改89。本次只补记裁决，不改等级逻辑。

三份资料、主数据及百科缓存均只读核对；sourceHashes在夹具，逐素材结构/raw/API核对在meta.evidence，冲突的原文证据在夹具conflicts。本次不出网、不写资料目录、不改上游包。百科页面修订如下：

${table(['百科页面', '修订'], Object.values(pages).map(p => [p.title, p.revision]))}

## 冻结旧消费逐档差异

${table(['边', '档', '素材', 'HEAD旧值', '本次'], differences.map(r => [r.edge, r.stage, r.identity, r.oldValue ?? '缺', r.newValue ?? '缺']))}

## 任务书订正

1. “初次从0”指循环内边；旧全表实际有101条初次，不能报成全表0。
2. 对照资料附加边还有index与chart，除footnote外不应一律猜成初次或往复；本次按明确同边往复列核对，剩余列unknown。
3. 三隈总表40/15在正向、30/45在回程是缓存原文如此，并非本地箭头提取颠倒；属于来源行错误，按本单指定回程40/15执行。
4. 新型兵装资材等不都是初次专属：三隈舰页明确每次转为改二特均耗1个，API也为1；本次核对但不改运行时原生素材逻辑。
5. 首单严格要求主条目同来路，朝潮和霞只命中正向first，回程主条目各来自248与253。续单已修正为直接互逆回程判据，四边两档均确认无，不把常规路径主条目写成回程原文。
6. 22对包含了api_mst_ship中Glorious的同名互指；对照api_mst_shipupgrade实为21直接对，不含Glorious。原始wikiwiki页面并未包含在允许的随包JSON中，不能声称已验证原页面有或无注记。
7. 百科改造行挂在出发形态；911→916没有50/50，50/50属于916→911。最上与Fletcher并非分档失败，而是已定convert后的数值冲突。
8. 数据规则未限制普通单向边，首单实际77条first均保留；续单按裁定把“无特殊素材”的显示限定在可逆改造，单向空档继续不显示文字。
9. 续单实测朝潮／霞转换段并非无该对，而是四方向均有“-”空成本；convert由新增规则②确认。规则②还命中三形态循环的646→698，故新增convert为6档而非预期5档。
`

for (const [file, value] of [[path.join(ROOT, 'assets/lodes/remodel-facts.json'), pack], [fixturePath, fixture]]) {
  const text = JSON.stringify(value, null, 2) + '\n'
  if (process.argv.includes('--check')) { if (fs.readFileSync(file, 'utf8') !== text) throw new Error(`${file} 漂移`) }
  else if (file !== fixturePath || process.argv.includes('--update-fixture')) fs.writeFileSync(file, text)
}
const reportPath = path.join(ROOT, 'docs/remodel-facts-report.md')
if (process.argv.includes('--check')) { if (fs.readFileSync(reportPath, 'utf8') !== report) throw new Error('报告漂移') }
else fs.writeFileSync(reportPath, report)
console.log(JSON.stringify({ edges: Object.keys(pack.data).length, directPairs: result.direct.length, conflicts: result.conflicts.length, missing: result.missing.length, corrections: result.corrections.length, unknown: result.unknown.length, differences: differences.length }))
