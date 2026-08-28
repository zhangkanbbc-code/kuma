import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

// map-intel.ts 自己 import 了别的 shared 模块（无扩展名），脱 dist 直接跑不起来；
// 与 abyssal-id-pin / map-drop-windows 两处一样走构建产物（npm test 先 build）。
import mapIntelModule from '../dist/shared/map-intel.js'

const { catalogCompUnseen, catalogEncounterTally, catalogTallyText, compSignature } =
  mapIntelModule

// 镝「敌方编队」卡上，同一套编成过去会在「你的实测」与「确认目录」两段各显一遍。
// 2026-08-26 用户拍板 A 案：**数据分层不动**（并列不合并是 08-22 拍的板：目录=资料、
// 实测=亲历，证据强度不同），只改展示——实测行挂「目录 ✓」，目录段只列还没遇过的。
//
// 判据复用现成那一套（战前匹配 previewEncounterCandidates，2026-08-12 定）：
// 按舰列 mst 序列配对，**不看阵形**。目录一格常写多个阵形（単縦 複縦 梯形），
// 与本地的数字阵形永远对不上；把阵形并进签名，同一套编成会被拆成好几份。

const comp = (ships, formation = '単縦', extra = {}) => ({ ships, formation, ...extra })
const local = (...comps) => comps

// ---------------------------------------------------------------- 判据本体

test('对照判据:按舰列配对,阵形不算在内', () => {
  // 同一套舰列，本地记的是数字阵形 1，目录写的是「単縦 複縦 梯形」——照样算遇到过
  const tally = catalogEncounterTally(
    local([1501, 1502, 1503]),
    [comp([1501, 1502, 1503], '単縦 複縦 梯形')],
  )
  assert.equal(tally.total, 1)
  assert.equal(tally.seen, 1)
  assert.ok(tally.catalog.has(compSignature([1501, 1502, 1503])))
  // 阵形要是并进了签名，这里就会变成 0——「匹配判据反向要红」钉的就是这一格
  assert.equal(catalogCompUnseen(comp([1501, 1502, 1503], '梯形'), tally), false)
})

test('对照判据:舰列不同就是两套,顺序也算数', () => {
  const tally = catalogEncounterTally(local([1501, 1502]), [
    comp([1501, 1502]),
    comp([1502, 1501]), // 同样两艘、次序不同：另一套编成
    comp([1501, 1502, 1503]),
  ])
  assert.equal(tally.total, 3)
  assert.equal(tally.seen, 1)
  assert.equal(catalogCompUnseen(comp([1502, 1501]), tally), true)
  assert.equal(catalogCompUnseen(comp([1501, 1502, 1503]), tally), true)
})

test('对照判据:本地那侧的空位先剔掉再比', () => {
  // 遭遇志里的 comp 带 0/-1 补位（六人格没站满），签名前要按 id > 0 滤掉
  const tally = catalogEncounterTally(local([1501, 1502, 0, -1]), [comp([1501, 1502])])
  assert.equal(tally.seen, 1)
  assert.equal(catalogCompUnseen(comp([1501, 1502]), tally), false)
})

test('对照判据:定不到号的目录编成一律算没遇过,照常列出', () => {
  // ships 是 wiki 标注、又没有 shipIds —— enemyCompIds 给不出号。
  // 拿标注在运行时反解会指错形态（同名多形态），宁可多列一行也不敢挂勾。
  const fuzzy = comp(['空母ヲ級flagship', '重巡リ級elite'])
  const tally = catalogEncounterTally(local([1501, 1502]), [fuzzy])
  assert.equal(tally.total, 1)
  assert.equal(tally.seen, 0, '定不到号的不许算成「已遇」')
  assert.equal(tally.catalog.size, 0, '定不到号的不许进 catalog 集合——实测行不该挂勾')
  assert.equal(catalogCompUnseen(fuzzy, tally), true)
  // 本地有一条空遭遇记录时也照样列出来：定不到号 ≠ 空舰列，
  // 拿「没有号」当成一个可比的签名，会让空记录把整条模糊编成吞掉
  const withEmptyLocal = catalogEncounterTally(local([], [0, -1]), [fuzzy])
  assert.equal(withEmptyLocal.seen, 0)
  assert.equal(catalogCompUnseen(fuzzy, withEmptyLocal), true)
})

test('对照判据:维护期定好的 shipIds 认得出来', () => {
  const pinned = comp(['空母ヲ級flagship', '重巡リ級elite'], '単縦', { shipIds: [1528, 1522] })
  const tally = catalogEncounterTally(local([1528, 1522]), [pinned])
  assert.equal(tally.seen, 1)
  assert.equal(catalogCompUnseen(pinned, tally), false)
})

// ---------------------------------------------------------------- 三种状态的计数

test('三种状态:一套都没遇过——计数不出场,目录全列（现状回归）', () => {
  const comps = [comp([1501]), comp([1502]), comp([1503])]
  const tally = catalogEncounterTally(local([1599]), comps)
  assert.equal(tally.total, 3)
  assert.equal(tally.seen, 0)
  assert.deepEqual(comps.map((one) => catalogCompUnseen(one, tally)), [true, true, true])
  // 这一行不出场：卡头「已确认 3 种」已经说了总量，再来一句「已遇 0」是纯噪音
  assert.equal(catalogTallyText(tally), null)
})

test('三种状态:部分遇过——计数写实,正文只剩没遇过的那几套', () => {
  const comps = [comp([1501]), comp([1502]), comp([1503])]
  const tally = catalogEncounterTally(local([1501], [1502]), comps)
  assert.equal(tally.total, 3)
  assert.equal(tally.seen, 2)
  assert.deepEqual(comps.map((one) => catalogCompUnseen(one, tally)), [false, false, true])
  assert.equal(catalogTallyText(tally), '确认编成 3 种 · 已遇 2')
})

test('三种状态:全都遇过——整段缩成一行,一行编成都不剩', () => {
  const comps = [comp([1501]), comp([1502])]
  const tally = catalogEncounterTally(local([1501], [1502]), comps)
  assert.equal(tally.seen, tally.total)
  assert.deepEqual(comps.map((one) => catalogCompUnseen(one, tally)), [false, false])
  assert.equal(catalogTallyText(tally), '确认编成 2 种 · 都遇到过')
})

test('三种状态:计数行只有三款措辞,行尾无句号、零解释', () => {
  const shapes = [
    catalogTallyText(catalogEncounterTally(local([1501]), [comp([1501]), comp([1502])])),
    catalogTallyText(catalogEncounterTally(local([1501]), [comp([1501])])),
  ]
  for (const line of shapes) {
    assert.match(line, /^确认编成 \d+ 种 · (已遇 \d+|都遇到过)$/, `多出来的措辞：${line}`)
    assert.ok(!/[。，；]/.test(line), `计数行带了句读：${line}`)
  }
  // 「已遇 N」的 N 永远小于总量——等于总量时该说「都遇到过」
  const full = catalogEncounterTally(local([1501], [1502]), [comp([1501]), comp([1502])])
  assert.ok(!catalogTallyText(full).includes('已遇'), '全遇过了还在说「已遇 N」')
})

test('三种状态:目录里同一套舰列写了两遍时,计数与卡头总量对得上', () => {
  // 卡头「已确认 N 种」数的是 enemyComps.length，这里的 total 必须是同一个数
  const comps = [comp([1501], '単縦'), comp([1501], '輪形'), comp([1502])]
  const tally = catalogEncounterTally(local([1501]), comps)
  assert.equal(tally.total, 3)
  assert.equal(tally.seen, 2, '同舰列的两条都算遇过——与 total 的口径一致')
})

test('实测有、目录没有的编成:不受影响,也不会挂勾', () => {
  const tally = catalogEncounterTally(local([1501, 1502], [1777, 1778]), [comp([1501, 1502])])
  assert.ok(tally.catalog.has(compSignature([1501, 1502])), '目录收了的那套挂勾')
  assert.ok(!tally.catalog.has(compSignature([1777, 1778])), '目录没收的那套不许挂勾')
})

// ---------------------------------------------------------------- 接线与文案

const di = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')

test('接线:两段共用同一份对照,不许各算一次', () => {
  // 各算一次早晚漂移成「实测挂了勾、目录里那套却还列着」
  assert.match(di, /const tally = catalogTallyFor\(s, mapKey, letter, difficulty\)/)
  assert.match(di, /myCompsHtml\(s, tally\)/)
  assert.match(di, /confirmedEnemyCompsHtml\(mapKey, letter, difficulty, tally\)/)
  // 判据只有一处出处：di 不许再自建一套签名
  assert.doesNotMatch(
    di,
    /const compSignature = /,
    'di 里又长出了一份签名实现——判据必须只在 shared/map-intel 一处',
  )
})

test('接线:实测行按对照挂标,目录行按对照过滤', () => {
  assert.match(di, /const inCatalog = tally\.catalog\.has\(compSignature\(ships\)\)/)
  assert.match(di, /if \(!catalogCompUnseen\(comp, tally\)\) return ''/)
  // 序号仍按目录里的原位置走：过滤掉的是行，不是它在目录里的身份
  assert.match(di, /确认编成 \$\{index \+ 1\}\/\$\{node\.enemyComps\.length\}/)
})

test('文案:「目录 ✓」两三个字,无悬停无解释', () => {
  assert.match(di, /<i class="nav-comp-tag">目录 ✓<\/i>/)
  // 不许挂悬停——七之七：悬停不是机制解说的豁免区
  assert.doesNotMatch(di, /nav-comp-tag[^>]*title=/)
  // 计数行的措辞在 shared 一处出，di 不许再写一份
  // （逐行那句「确认编成 i/N」是原有文案，照旧留在 di 里，不在此列）
  assert.match(di, /const catalogTally = catalogTallyText\(tally\)/)
  assert.ok(!/确认编成 \$\{tally\./.test(di), 'di 里又写了一份计数行措辞')
  assert.ok(!/都遇到过|已遇 /.test(di), '计数行的措辞漏在了 di 里')
  // 锚点用完整那句：di 里另有两处无关的 tallyText（分歧点的带路计数）
  const start = di.indexOf('const catalogTally = catalogTallyText(tally)')
  const tallyLine = di.slice(start, di.indexOf('return `${tallyLine}', start))
  assert.ok(start > 0 && tallyLine.length > 0 && tallyLine.length < 400, '计数行锚点没对上')
  assert.doesNotMatch(tallyLine, /title=/, '计数行挂了悬停')
})

test('掉落卡的 ◆ 行不受这次改动影响', () => {
  // 「目录没收、自己却捞到过」是另一张卡（myDropsHtml）上的标记，与敌编成对照无关
  assert.match(di, /const beyond = !cataloged\.has\(ship\.mstId\)/)
  assert.match(di, /<span class="dp-star" title="只有你自己的记录">◆<\/span>/)
})

test('样式:两个新元素都有落地的 CSS', () => {
  const html = fs.readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8')
  assert.match(html, /\.mod-di \.nav-comp-tag \{/)
  assert.match(html, /\.mod-di \.nav-catalog-tally \{/)
  // 新样式引用 token，不写裸 hex
  const tag = html.slice(html.indexOf('.mod-di .nav-comp-tag {'))
  assert.doesNotMatch(tag.slice(0, tag.indexOf('}')), /#[0-9a-f]{3,6}/i)
})
