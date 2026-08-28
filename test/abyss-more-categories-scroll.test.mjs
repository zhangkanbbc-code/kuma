// 深海卷（装备页 / 舰页）的「更多分类」面板展开后会把列表挤没。
//
// 与捞船单子（cd5e089）同形，病灶同样在**位置**：面板从前是 `.ship-list`
// （#ji-abyss-list，那根竖列里唯一的滚动容器）的**兄弟**，站在滚动容器外面。
// `.cat-more` 是普通块级 flex 项，min-height 默认 auto = 内容高，一步不肯让；
// 而 `.mod-ji .ship-list` 是 `flex: 1; min-height: 0`（flex-basis 0），
// 收缩额度全在它这边——于是面板占满，列表归零。
//
// 真 Chromium 实测（同构复现：真 index.html 整份样式 + 真主数据的类别数，
// 坞宽 × 坞高两根轴各扫一遍。坞高下限 300px 是真的——`#wb-mid` 写着
// min-height:300px，底坞分隔条拖到头就是这个数）：
//
//   深海装备页，25 枚 cat-cell（主数据里深海方有装备的类别数）：
//     坞宽 280px → 排 10 行、整块 294px；坞高拖到下限时 .index 只有 261px
//     → .ship-list clientHeight = 0，面板底部顶穿 204px
//     坞宽 520px → 仍 165px / 5 行，列表照样 0 高，顶穿 48px
//     一直到坞宽 620px 才勉强不顶穿（-4px），但列表还是 0 高
//   深海舰页，13 枚 cat-cell：坞宽 280px → 5 行 165px，顶穿 75px，列表 0 高
//
// 顶穿的那截被 `.mod-ji { overflow: hidden }`（index.html:2809）裁掉，
// 而且**玩家够不着**：从 cat-cell 往上整条祖先链没有一个 overflow-y:auto，
// 只有 .mod-ji 自己能被脚本滚（overflow:hidden 的盒子有 scrollTop 但没滚动条，
// 滚轮推不动）。实测 scrollIntoView 确实只动了 .mod-ji（Δ195px），别的一动不动。
//
// 修法取**舰娘目录那条先例**（ji.ts:2044，同一个 `.cat-more` 部件已经这么办过），
// 不取 cd5e089 的自带滚动：
//   1. 面板与列表共用 .ship-list 这一个滚动条，合「一个面板只留一个滚动条」的纪律；
//   2. 实测更好——挪进去之后列表在**所有**档位都不再归零（最窄档仍有 81px），
//      而自带滚动那条在坞高下限时列表照样是 0（面板会把剩余空间吃光）。
// 代价是宽坞下 .ship-list 变 grid（@container jilist min-width:620px），
// 面板不跨满列就会缩成一格（实测坞宽 700px 时面板只有 320px），
// 所以 `grid-column: 1/-1` 那条要把 `.cat-more` 一并带上。
//
// 这一层脱不开 Electron（要真排版才量得出溢出），所以钉的是**结构与声明本身**：
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

/** 某个函数的源码段（从 `const 名字 =` 到下一个锚点）。 */
const sourceOf = (name, until) => {
  const from = ji.indexOf(`const ${name} =`)
  assert.ok(from >= 0, `ji.ts 里找不到 ${name}，守卫的锚点要跟着改`)
  const to = ji.indexOf(until, from)
  assert.ok(to > from, `${name} 之后的锚点 ${until} 没了，切不出函数段`)
  return ji.slice(from, to)
}

const abyssEquipCatalog = sourceOf('abyssEquipCatalogHtml', 'const ABYSS_EQUIP_FIELDS')
// 深海舰页没有独立函数：宿主 abyssCatalogHtml 先分流到装备页，剩下的就是舰页
const abyssShipCatalog = sourceOf('abyssCatalogHtml', 'const abyssAirHtml')

// ---- 面板住在滚动容器里面 ----

/**
 * 面板在不在 `.ship-list` 里面，看的是模板里两者的**先后**：
 * 写成 `${面板}\n<div class="ship-list">` 就是兄弟（在外面），
 * 写成 `<div class="ship-list">${面板}` 才是子元素（在里面）。
 */
const panelIsInsideList = (source, builder) => {
  const list = source.indexOf('<div class="ship-list"')
  const panel = source.indexOf(builder)
  assert.ok(list >= 0, '这段模板里找不到 .ship-list，守卫的锚点要跟着改')
  assert.ok(panel >= 0, `这段模板里找不到 ${builder}，守卫的锚点要跟着改`)
  return panel > list
}

test('深海装备页：「更多分类」面板长在 .ship-list 里面，不当竖列的兄弟', () => {
  assert.ok(
    panelIsInsideList(abyssEquipCatalog, 'abyssEquipMoreCategoriesHtml()'),
    '面板又挂到 .ship-list 外面了：窄坞里它会把列表压成 0 高，' +
      '自己顶穿 204px 被 .mod-ji 裁掉，而那截玩家滚不到（祖先链上没有 overflow-y:auto）',
  )
})

test('深海舰页：「更多分类」面板同样长在 .ship-list 里面', () => {
  assert.ok(
    panelIsInsideList(abyssShipCatalog, 'abyssShipMoreCategoriesHtml()'),
    '深海舰页的面板挂到 .ship-list 外面了：13 枚 cat-cell 在窄坞里也有 165px，照样把列表压没',
  )
})

test('舰娘目录那条先例还在：面板也在 .ship-list 里面（深海两页照的就是它）', () => {
  const shipCatalog = sourceOf('shipCatalogHtml', 'const STAT_LEGEND_HTML')
  assert.ok(
    panelIsInsideList(shipCatalog, 'shipCategoryPanelHtml()'),
    '舰娘目录的面板被挪到 .ship-list 外面了——深海两页的处置就是照着它写的',
  )
})

// ---- 列表本身仍是那根竖列里唯一的滚动容器 ----

test('.ship-list 仍自带滚动并让出收缩额度：面板要靠它才滚得动', () => {
  const body = ruleBody('.mod-ji .ship-list')
  assert.match(body, /overflow-y: auto/, '.ship-list 不再是滚动容器，面板进去了也滚不动')
  assert.match(body, /min-height: 0/, '.ship-list 不肯让出收缩额度，竖列会被顶穿')
})

test('面板自己不再开滚动条：一个面板只留一个滚动条', () => {
  const body = ruleBody('.mod-ji .cat-more')
  assert.doesNotMatch(
    body,
    /overflow(-y)?: (auto|scroll)/,
    '.cat-more 自带了滚动条：它已经住在 .ship-list 里面，再套一层就是面板里两个滚动条',
  )
  assert.doesNotMatch(body, /max-height/, '.cat-more 写了高度上限：住在滚动容器里面的块不需要，只会平白截断')
})

// ---- 宽坞：.ship-list 变 grid 时面板要跨满列 ----

test('宽坞下面板跨满整行：grid-column 那条带上了 .cat-more', () => {
  const at = html.indexOf('@container jilist (min-width: 620px)')
  assert.ok(at >= 0, '找不到 jilist 的宽坞 container query，守卫的锚点要跟着改')
  const block = html.slice(at, html.indexOf('\n    }', at))
  const rule = block.slice(block.indexOf('grid-column'))
  assert.ok(rule.startsWith('grid-column: 1/-1'), 'grid-column 那条不见了')
  // 选择器写在声明之前，所以往回切
  const selectors = block.slice(0, block.indexOf('grid-column'))
  assert.match(
    selectors,
    /\.mod-ji \.ship-list > \.cat-more/,
    '「更多分类」没跨满列：它是整条横幅式的筛选面板，缩成一格右边会空掉一大半（实测坞宽 700px 时只有 320px）',
  )
})

// ---- 面板的规模：类别数是从主数据数出来的，不是写死的 ----

test('类别格子按主数据里「深海方真有东西」的类别生成，数量不写死', () => {
  const source = sourceOf('abyssEquipMoreCategoriesHtml', 'const abyssTabsHtml')
  // 数量从 counts 来：主数据涨了类别，面板跟着长——所以高度上限不能靠「反正就那么几类」
  assert.match(source, /abyssEquipTypeCounts\(\)/, '类别计数不再从主数据来了，面板规模的前提变了')
  assert.match(source, /if \(!n\) return \[\]/, '空类别不再被滤掉，面板会凭空多出一堆 0 格')
  assert.doesNotMatch(source, /slice\(0,\s*\d+/, '面板被截断了：漏掉的类别玩家就再也筛不到')
})
