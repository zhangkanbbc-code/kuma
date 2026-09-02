// 捞船单子展开后滚不动（2026-08-28 用户截图报的）。
//
// 病灶不在清单自己，在它站的位置：`huntPlanHtml()` 输出的 `<details class="hunt-plan">`
// 是 `.index` 这根竖列的**兄弟**，不住在 `.ship-list`（那根列里唯一的滚动容器）里面。
// `<details>` 的 min-height 默认 auto，展开后一步不肯让——同构最小复现里
// 内容 963px、容器 .index 只有 580px，整块顶穿容器 438px，被 `.dock-group` 的
// overflow:hidden 一刀切平：上面的 .ship-list 当场被压成 0 高（scrollHeight 5200 /
// clientHeight 0），底部的收集进度条推出屏外，而超出的那一截既不滚也够不着。
// 玩家看见的就是「还缺 45 艘」底下的舰名列到一半就没了、怎么拖都不动。
//
// 修法是让它自己管住高度：min-height:0 把竖列的收缩额度让给它，overflow-y:auto
// 自己接住溢出，max-height 用视口相对值（体例同 `.mod-ru .dbio-panel` 的 42vh）。
// 复现实测同一套声明：42vh 档 .hunt-plan 高 256px 可滚、.ship-list 拿回 234px、
// 进度条回到容器底边；坞拖到 420/360/280/220px 各档都不再顶穿容器。
//
// 这一层脱不开 Electron（要真排版才量得出溢出），所以钉的是**声明本身**——
// 按 ruleBody 切出规则块再断言，不用 `选择器 \{[\s\S]*?某声明` 那种跨规则惰性正则
// （仓内教训在案：`{` 之后的惰性匹配会越过右花括号，在别家规则里撞见也算数）。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const html = fs.readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8')
const ji = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')

/** 取一条规则的**声明块本身**（写法与理由见文件抬头）。 */
const ruleBody = (selector) => {
  const at = html.indexOf(`${selector} {`)
  assert.ok(at >= 0, `样式表里找不到 ${selector}，这条守卫的锚点要跟着改`)
  const open = html.indexOf('{', at)
  const close = html.indexOf('}', open)
  assert.ok(close > open, `${selector} 的声明块没有收尾`)
  return html.slice(open + 1, close)
}

/** 捞船单子那个函数的源码段（计数与分组都在里面）。 */
const huntSource = (() => {
  const from = ji.indexOf('const huntPlanHtml =')
  assert.ok(from >= 0, 'ji.ts 里找不到 huntPlanHtml，守卫的锚点要跟着改')
  const to = ji.indexOf('const shipCatalogRowHtml', from)
  assert.ok(to > from, 'huntPlanHtml 之后的锚点没了，切不出函数段')
  return ji.slice(from, to)
})()

// ---- 容器自己管住高度 ----

test('捞船单子自带滚动：min-height 让位 + overflow-y 接住 + 视口相对的高度上限', () => {
  const body = ruleBody('.mod-ji .hunt-plan')
  // 缺一不可：只给 overflow 而不给 min-height:0，<details> 的 auto 最小尺寸
  // 会顶着不缩，滚动条根本不会出现；只给 min-height:0 而不给 overflow，
  // 缩完的内容直接被裁掉，比现在还糟。
  assert.match(body, /min-height: 0/, 'hunt-plan 不肯让出收缩额度，展开还是会顶穿 .index')
  assert.match(body, /overflow-y: auto/, 'hunt-plan 没自带滚动，溢出的那截又够不着了')
  // 上限必须是视口相对的：写死像素在别的分辨率/坞高上要么白留空、要么照旧顶穿
  assert.match(body, /max-height: \d+(\.\d+)?vh/, 'hunt-plan 的高度上限不是视口相对值')
  assert.doesNotMatch(body, /max-height: \d+(\.\d+)?px/, 'hunt-plan 的高度上限写死成像素了')
  // 裁掉而不滚是这个病的另一种活法，别再退回去
  assert.doesNotMatch(body, /overflow(-y)?: hidden/, 'hunt-plan 改成裁切了，内容又看不全')
})

test('抬头钉住：还缺多少与两枚筛选钮在滚动中一直够得着，且不透字', () => {
  const summary = ruleBody('.mod-ji .hunt-plan > summary')
  assert.match(summary, /position: sticky/, '抬头没钉住，滚两下「还缺 N 艘」和筛选钮就没了')
  assert.match(summary, /top: 0/, 'sticky 没给 top，钉不住')
  // 钉住的抬头必须有底色，否则下面的舰名会从它身下透出来叠字。
  // 取的得是 .index 自己的底色——同色才谈得上「观感一字不改」。
  const indexBg = /background: (var\(--[a-z0-9-]+\))/.exec(ruleBody('.mod-ji .index'))
  assert.ok(indexBg, '.mod-ji .index 的底色变量取不到，抬头的同色断言失去参照')
  assert.match(
    summary,
    new RegExp(`background: ${indexBg[1].replace(/[(){}$*+?.\\^|[\]]/g, '\\$&')}`),
    `抬头的底色与 .index 的 ${indexBg[1]} 不一致：滚动时要么透字，要么凭空多出一条色带`,
  )
})

test('单子内部不再套第二个滚动条：滚动只由 .hunt-plan 这一层出', () => {
  const inner = ruleBody('.mod-ji .hunt-body')
  assert.doesNotMatch(inner, /overflow/, 'hunt-body 又自带了一层滚动，同一块单子会出两条滚动条')
  assert.doesNotMatch(inner, /max-height/, 'hunt-body 自己也压高度，两层上限互相打架')
})

test('目录列表照旧是那根竖列自己的滚动容器，没被这次修改挪走', () => {
  const list = ruleBody('.mod-ji .ship-list')
  assert.match(list, /flex: 1/, '.ship-list 不再吃剩余高度')
  assert.match(list, /min-height: 0/, '.ship-list 缩不下去，翻页会回到老毛病')
  assert.match(list, /overflow-y: auto/, '.ship-list 的滚动没了')
})

// ---- 单子长在哪：上面那条 CSS 守卫成立的前提 ----

test('捞船单子仍挂在 .ship-list 外面 —— 所以高度必须自己管', () => {
  // 位置本身不是错（抬头一直可见才有意义），但它决定了「谁来兜溢出」：
  // 在滚动容器**外面**就得自带滚动。哪天真把它挪进 .ship-list 里，
  // 这条会先红，提醒把上面那组 CSS 守卫一并重估，而不是让它们空转。
  const listAt = ji.indexOf('<div class="ship-list" id="ji-ship-list">')
  const huntAt = ji.indexOf('${huntPlanHtml()}', listAt)
  assert.ok(listAt >= 0 && huntAt > listAt, '舰娘目录的列表与捞船单子锚点对不上了')
  // 只断言「中间有个 </div>」是假守卫：那一段里「无匹配」占位本身就自带一对 div，
  // 单子真挪进去了它照样绿。数标签才作数——从列表开标签数到单子，开合相抵为 0
  // 才说明 .ship-list 已经收尾；单子若在里面，这个差会是 +1。
  const between = ji.slice(listAt, huntAt)
  const opens = (between.match(/<div\b/g) ?? []).length
  const closes = (between.match(/<\/div>/g) ?? []).length
  assert.equal(
    opens - closes,
    0,
    '捞船单子跑进 .ship-list 里面了：溢出改由列表兜，上面那组 CSS 守卫要重估',
  )
})

// ---- 条目完整性：容器会滚了，清单就不许再靠截断来「装下」----

test('抬头的三个数各自照旧：还缺 / 能查到掉点 / 在当前活动图', () => {
  assert.match(huntSource, /还缺 <b>\$\{missing\.length\}<\/b> 艘/, '「还缺 N 艘」的数不是缺口总数了')
  assert.match(
    huntSource,
    /data-hunt-filter="catchable"[^>]*>\$\{catchable\.length\}<\/button>/,
    '「目录里能查到掉点的 N 艘」的数不是可捞总数了',
  )
  assert.match(huntSource, /\$\{inEvent\.length\} 艘在当前活动图/, '「N 艘在当前活动图」的数不是本期活动组的条数了')
})

test('各组逐条列全，只有常驻组按 HUNT_STANDING_CAP 截并明说还剩多少', () => {
  // 「当前活动图可捞」正是用户截图里滚不动的那一段：它必须整组列全，
  // 靠容器滚动装下，而不是偷偷截几条了事。
  for (const group of ['inEvent', 'soon', 'limitedStanding', 'eventClosed']) {
    assert.match(
      huntSource,
      new RegExp(`\\$\\{${group}\\.map\\(rowOf\\)\\.join\\(''\\)\\}`),
      `${group} 组不是逐条列全的了`,
    )
    assert.doesNotMatch(
      huntSource,
      new RegExp(`${group}\\.slice\\(`),
      `${group} 组被截断了：容器已经会滚，不该再靠少列几条来装下`,
    )
  }
  // 常驻组是唯一的例外，且截了要说清还剩多少（二十多张图那种，列全没信息量）
  assert.match(huntSource, /standing\.slice\(0, HUNT_STANDING_CAP\)/, '常驻组的上限没了')
  assert.match(huntSource, /另有 \$\{standing\.length - shownStanding\.length\} 艘未列出/, '常驻组截了却没说还剩多少')
})
