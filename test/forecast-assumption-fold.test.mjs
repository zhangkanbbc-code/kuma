// 机制估算的模型边界声明收进「预测口径」折叠段（2026-08-28 他拿截图定的口径）。
//
// 起因：那七条长句整段平铺在「交战前敌情」卡的一眼位置，扫过去看到的全是解释，
// 胜率与大破率反而被挤下去。口径见 kanso-disciplines 七之四②「严谨性说明折叠即合规」、
// 七之五「解释语句不进一眼位置」。
//
// **声明文本一字不动**——那是审定过的诚实边界，改的只是层级。所以这份护栏钉三头：
// ① 全文仍完整在展开层，逐句对着模型给的原话钉，一个字都不许被改写或截断；
// ② 一眼位置（收起态）不再有长句正文——段头只有「预测口径」四个字，
//    正文全是段根的直接子元素，正好落在那条 `display:none` 的 CSS 底下；
// ③ 折叠交互真的能用：默认收起、点一下展开、再点回去，且登记的选择器与产物对得上。
//
// 断言对着**真编出来的产物 HTML** 与**真编出来的开合判据**下，不断言源码文本——
// 折叠默认写反、段根忘了裹、登记改了名，这三样正则一条也拦不住
// （见共享层 source-pattern-guards-miss-logic-bugs，以及 test/ji-group-fold.test.mjs）。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import forecastModule from '../dist/shared/combat-forecast.js'
import {
  foldSpecOpensByDefault,
  foldSpecSelectors,
  renderAssumptionsNote,
} from './fixtures/render-forecast-note.mjs'
import { sectionIsOpen, toggleSectionFold } from './fixtures/section-fold-logic.mjs'

const { forecastAssumptions } = forecastModule
const html = fs.readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8')

const 段名 = '预测口径'

const factorsOf = (patch = {}) => ({
  bonusShips: 0,
  landTargets: 0,
  landBaseWaves: 0,
  combinedType: 0,
  mainCount: 0,
  escortCount: 0,
  shipCount: 6,
  spottingShips: 0,
  openingAswShips: 0,
  nightAttackers: 0,
  nightBlocked: {},
  ...patch,
})

// 层数拉满的一场：联合、对地、倍卡、陆航、弾着観測、先制对潜、夜战有人出手也有人出不了。
// 声明条目在这一场里是最长的一份，正是截图那一屏。
const 满载 = () =>
  forecastAssumptions(
    factorsOf({
      combinedType: 1,
      mainCount: 6,
      escortCount: 6,
      shipCount: 12,
      landTargets: 3,
      bonusShips: 4,
      landBaseWaves: 2,
      spottingShips: 5,
      openingAswShips: 2,
      nightAttackers: 5,
      nightBlocked: { carrier: 2, taiha: 1 },
    }),
    [14],
    false,
  )

/**
 * 段根**真正裹住**的那一块，只到它自己那个 `</div>` 为止。
 *
 * 必须数嵌套：第一版写的是 `out.slice(at)`（一路切到结尾），正文行整体挪到段根
 * 外面去它照样绿——而那正是「折叠退化成只翻个三角」的形状。改成配对扫描后
 * 这个改法当场变红。
 */
const noteBlock = (out) => {
  const at = out.indexOf('<div class="prebattle-model-note">')
  assert.ok(at >= 0, '段根不见了：没有段根，section-fold 无处施加，折叠会退化成什么都不做')
  let depth = 0
  for (const tag of out.slice(at).matchAll(/<div\b|<\/div>/g)) {
    depth += tag[0] === '</div>' ? -1 : 1
    if (depth === 0) return out.slice(at, at + tag.index + '</div>'.length)
  }
  assert.fail('段根那个 <div> 没有配对的收尾')
}

/** 段头那一行（段根的第一个直接子元素）。 */
const headRow = (out) => {
  const m = /<div class="[^"]*prebattle-model-note-h[^"]*">([\s\S]*?)<\/div>/.exec(out)
  assert.ok(m, '段头不见了')
  return m[1]
}

/** 除段头外的正文行——收起态被 CSS 藏掉的就是这些。 */
const bodyRows = (out) =>
  [...out.matchAll(/<div class="prebattle-model-rule">([\s\S]*?)<\/div>/g)].map((m) => m[1])

// ---- ① 全文仍完整在展开层 ----

test('展开层逐句钉：模型给的每一条原话都在，一个字不改', () => {
  const lines = 满载()
  const out = renderAssumptionsNote(lines)
  const body = bodyRows(out)
  // 抬头已经写过阵形，「我方按…估算」那一条照旧不重复渲染（改动前就是这样）
  const 该渲染的 = lines.filter((line) => !line.startsWith('我方按'))
  assert.equal(该渲染的.length, lines.length - 1, '「我方按…」应当正好只有一条')
  assert.deepEqual(body, 该渲染的, '正文行必须与模型给的原话逐条逐字相同')
})

test('展开层逐句钉：七条里那几句要害逐字都在', () => {
  const out = renderAssumptionsNote(满载())
  for (const 片段 of [
    '航向按同航45% / 反航30% / T有利15% / T不利10%加权',
    '联合舰队按主力6舰 + 护卫6舰分段计算',
    '雷击只计护卫队，对普通敌舰队的航空战只计主力队',
    '已计入：',
    '对地特攻（敌方 3 个陆上型目标，含 cap 前/后两段）',
    '活动特效倍卡（4 舰吃到，cap 后施加）',
    '派向本点的基地航空队 2 波',
    '弾着観測射撃 / 连击（5 舰按発動率取期望值；艦隊索敵補正未计，発動率偏低）',
    '先制对潜 2 舰（额外一轮）',
    '夜战另算一套：5 舰能出手，不参加的 空母 2 / 大破 1',
    '上限 360，不吃阵形与交战形态补正（警戒阵主力减半除外）',
    '未计入：夜战CI、夜间触接、旗舰特殊攻击（一斉射等）、烟幕、支援舰队、友军舰队',
    '大破风险逐舰按被选中概率、当前HP和装甲承伤聚合',
  ]) {
    assert.ok(out.includes(片段), `展开层缺了这一句：${片段}`)
  }
})

test('彩云那一场的航向句同样原样进展开层——文案随模型走，不在镝这边重写', () => {
  const out = renderAssumptionsNote(forecastAssumptions(factorsOf(), [14], true))
  assert.ok(out.includes('航向按同航45% / 反航40% / T有利15%加权（彩云消除T不利）'))
})

// ---- ② 一眼位置不再有长句正文 ----

test('收起态一眼扫过只剩「预测口径」四个字，长句正文一句都不在段头里', () => {
  const 头 = headRow(renderAssumptionsNote(满载()))
  assert.equal(头.trim(), 段名, '段头只许有段名，多一个字都是又把解释摆回一眼位置')
  for (const 词 of ['已计入', '未计入', '夜战另算一套', '航向按', '大破风险', '分段计算']) {
    assert.ok(!头.includes(词), `段头里混进了正文：${词}`)
  }
})

test('正文全是段根的直接子元素——不裹住，那条 display:none 藏不掉它们', () => {
  const out = renderAssumptionsNote(满载())
  const 块 = noteBlock(out)
  // 段内一条正文都不许漏在段根外面
  assert.equal(
    bodyRows(块).length,
    bodyRows(out).length,
    '有正文行落在段根外面，收起来它照样摆在一眼位置',
  )
  // 段头是第一个直接子元素：section-fold 硬要求「标题是段根的直接子元素」
  const 子元素 = [...块.matchAll(/<div class="([^"]*)"/g)].map((m) => m[1])
  assert.ok(
    子元素[1]?.includes('prebattle-model-note-h'),
    '段头不是段根的头一个直接子元素，section-fold 认不到它',
  )
  assert.equal(
    子元素.filter((c) => c.includes('prebattle-model-note-h')).length,
    1,
    '段头只许有一枚——两枚会让 section-fold 认错段名',
  )
})

test('收起态靠的那条 CSS 还在：段头以外的直接子元素一律藏起来', () => {
  assert.match(html, /\[data-foldable\]:not\(\[data-open\]\) > \*:not\(\[data-fold-head\]\) \{[^}]*display: none/)
  // 段头得是弹性行，否则通用三角规则那枚 ::before 没宽高，玩家看不出这里能点
  assert.match(html, /\.mod-di \.prebattle-model-note-h \{[^}]*display: flex/)
  assert.match(html, /\[data-foldable\] > \[data-fold-head\] \{[^}]*cursor: pointer/)
  // 零新增颜色：这一行不许自己定色，颜色跟着 .prebattle-model-rule 走
  assert.doesNotMatch(html, /\.mod-di \.prebattle-model-note-h \{[^}]*color:/)
})

test('一条声明都没有时不留一个空的「预测口径」钩子', () => {
  assert.equal(renderAssumptionsNote([]), '')
  assert.equal(renderAssumptionsNote(['我方按单纵阵估算']), '', '只剩抬头那一条也不该留空段')
})

// ---- ③ 折叠交互可用 ----

const 常规段 = {} // 「预测口径」走的是常规支：记「开着的那几个」，空账本 = 收起

test('默认收起：账本空着的时候「预测口径」是折起来的', () => {
  assert.equal(
    sectionIsOpen(常规段, 段名, new Set(), new Set()),
    false,
    '默认展开就等于没折——长句又回到一眼位置了',
  )
})

test('点一下展开、再点一下收回去', () => {
  const opened = new Set()
  const closed = new Set()
  toggleSectionFold(常规段, 段名, opened, closed)
  assert.equal(sectionIsOpen(常规段, 段名, opened, closed), true, '点开要能看见全文')
  assert.deepEqual([...opened], [段名], '常规段翻开记进 opened 那本')
  assert.equal(closed.size, 0, '常规段不该碰 closed 那本')
  toggleSectionFold(常规段, 段名, opened, closed)
  assert.equal(sectionIsOpen(常规段, 段名, opened, closed), false, '再点一下要收回去')
  assert.equal(opened.size, 0, '收回去就该把名字从账上撤掉')
})

test('登记的选择器与产物对得上，且没被写进任何「默认展开」名单', () => {
  const out = renderAssumptionsNote(满载())
  assert.ok(
    out.includes(`<div class="${foldSpecSelectors.section.slice(1)}">`),
    '登记的段根类名与产物对不上，折叠会静静地不生效',
  )
  assert.ok(
    out.includes(foldSpecSelectors.head.slice(1)),
    '登记的段头类名与产物对不上，section-fold 找不到标题就整段跳过',
  )
  // 段名靠 firstTextTitle 从段头的头一个文本节点取——段头里必须真有那段纯文本
  assert.equal(foldSpecSelectors.title, 'firstTextTitle')
  assert.equal(headRow(out).trim(), 段名)
  assert.equal(
    foldSpecOpensByDefault,
    false,
    '「预测口径」被写进了默认展开名单，默认收起这条规格就废了',
  )
})
