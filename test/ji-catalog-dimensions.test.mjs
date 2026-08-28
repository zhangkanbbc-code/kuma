import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

// ---- 图鉴侧接线（源码级护栏；行为已在实机 CDP 上逐条跑过） ----

const jiSource = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')

test('舰娘卷的四个分类维度各自成段、各自一色', () => {
  // 四段都在同一个「更多分类」面板里（用户拍板：不开新卷、不动顶栏）
  assert.match(jiSource, /const shipCategoryPanelHtml = \(\): string =>/)
  for (const fn of [
    'shipMoreCategoriesHtml',
    'shipNationCategoriesHtml',
    'shipClassCategoriesHtml',
    'shipFleetCategoriesHtml',
  ]) {
    assert.ok(jiSource.includes(`${fn}()`), `分类面板缺 ${fn}`)
  }
  // 每段一枚 --dim-c（现在由 catSectionHtml 统一套壳），且四枚各不相同
  const dims = [...jiSource.matchAll(/color: '(--entity-[a-z]+)',/g)].map((m) => m[1])
  assert.deepEqual(dims, ['--entity-ship', '--entity-nationality', '--entity-shipclass', '--entity-histfleet'])
  assert.equal(new Set(dims).size, 4)
  assert.match(jiSource, /style="--dim-c:var\(\$\{opts\.color\}\)"/)
})

test('分类面板长在滚动容器里面——否则列表被压成 0 高、翻不了页', () => {
  // 这是 2026-08-22 用户实机报的那条 bug 的根因：面板挂在 .ship-list **外面**，
  // 展开后 2502px 把 flex:1 的列表挤成 0，进度条被推到可视区外 1900px 处。
  // 守的是结构不变式：panelHtml 必须出现在 ship-list 那个 div 的**内容里**。
  const list = jiSource.match(/<div class="ship-list" id="ji-ship-list">[\s\S]*?<\/div>/)
  assert.ok(list, '找不到 .ship-list 模板')
  assert.ok(
    list[0].includes('shipCategoryPanelHtml()'),
    '分类面板又被挂到滚动容器外面了——展开后列表会被压成 0 高',
  )
  // 反向：面板不许自己再开一个滚动条（纪律「一个面板只留一个滚动条」）
  const css = fs.readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8')
  const panelCss = css.match(/\.mod-ji \.ship-list > \.cat-more \{[^}]*\}/)
  assert.ok(panelCss, '缺 .ship-list > .cat-more 的样式')
  assert.ok(!/overflow/.test(panelCss[0]), '分类面板自己开了滚动条')
})

test('四段是手风琴：同时只开一段，默认全收起，选中项常驻在抬头上', () => {
  // 默认全收起
  assert.match(jiSource, /let moreCategorySection: ShipCatSection = ''/)
  // 同时只开一段：开哪一段由单一变量说了算，点同一段再收起
  assert.match(jiSource, /const open = moreCategorySection === opts\.key/)
  assert.match(
    jiSource,
    /moreCategorySection = moreCategorySection === key \? '' : key/,
    '手风琴的开合没有「再点一次收起」',
  )
  // 抬头行常驻显示选中项，且点它能取消（状态不许跟着内容一起藏）
  assert.match(jiSource, /const catPickedHtml = /)
  for (const key of ['stype', 'nation', 'class', 'fleet']) {
    assert.ok(jiSource.includes(`catPickedHtml('${key}'`), `${key} 段的抬头没挂选中 chip`)
  }
  assert.match(jiSource, /\[data-clear-dim\][\s\S]{0,200}clearShipDimensions\(\)/)
})

test('型与编队两段带就地过滤，且过滤只缩小格子不改分组', () => {
  // 只有这两段给过滤框：19 种舰种 / 12 国一眼看得完，加输入框是噪声
  const finds = [...jiSource.matchAll(/find: \{ value: catFind\.(class|fleet)/g)].map((m) => m[1])
  assert.deepEqual(finds, ['class', 'fleet'])
  // 空串放行 = 清空恢复全量
  assert.match(jiSource, /if \(!key\) return true/)
  // 编队认队名的三种写法，与搜索域同一口径
  assert.match(jiSource, /catFindHit\(catFind\.fleet, entry\.name\.zh, entry\.name\.ja, \.\.\.entry\.aliases\)/)
  // 一格都不剩的小组连标题一起收掉，不留空段
  assert.match(jiSource, /cells \? `<div class="cat-sub">/)
  // 敲一下重渲一次，光标要放回去（不然打第二个字就丢焦点）
  assert.match(jiSource, /next\.setSelectionRange\(caret, caret\)/)
})

test('维度互斥只有一个收口，加维度不必满文件找赋值点', () => {
  assert.match(jiSource, /const clearShipDimensions = \(\) => \{[\s\S]*?shipState\.fleetFilter = ''/)
  // 旧的「三行连着清」不许回潮：漏一行就是「换维度时上一个还留着」。
  // 唯一允许的一处就是收口函数自己（它第四行清 fleetFilter）。
  const triples = [
    ...jiSource.matchAll(
      /shipState\.classFilter = 0\n\s*shipState\.typeFilter = 0\n\s*shipState\.nationalityFilter = 0\n(\s*shipState\.fleetFilter = '')?/g,
    ),
  ]
  assert.equal(triples.length, 1, '「三行连着清」在收口函数之外又出现了')
  assert.ok(triples[0][1], '收口函数漏了 fleetFilter')
})

test('排序两档：分组是默认，编号平铺存本机', () => {
  assert.match(jiSource, /sort: uiGet<string>\('ji\.shipSort', 'group'\) === 'no' \? 'no' : 'group'/)
  assert.match(jiSource, /uiSet\('ji\.shipSort', next\)/)
  // 平铺用图鉴号排；分组维持舰种→舰级→图鉴号的游戏口径
  assert.match(jiSource, /roots\.sort\(\(a, b\) => a\.api_sortno - b\.api_sortno \|\| a\.api_id - b\.api_id\)/)
  assert.match(jiSource, /a\.api_stype - b\.api_stype \|\| a\.api_ctype - b\.api_ctype \|\| a\.api_sortno - b\.api_sortno/)
})

test('详情页：没队的舰整节不渲染，未实装成员不给链接', () => {
  assert.match(jiSource, /const entries = histFleets\.ofRoot\(rootId\)\n\s*if \(!entries\.length\) return ''/)
  assert.match(jiSource, /member\.ref\.form === 'absent'[\s\S]{0,180}class="miss"/)
  // note 只在核过文献时才摆出来
  assert.match(jiSource, /entry\.noteStatus === 'verified' && entry\.note/)
})

test('反向索引在装配期建一次，不在渲染里逐舰扫全表', () => {
  assert.match(jiSource, /histFleets = buildHistFleetIndex\(rootOf\)/)
  // 三个维度的计数共用一趟扫描，按 chainOf 的引用失效
  assert.match(jiSource, /if \(dimCountSource !== chainOf\)/)
})
