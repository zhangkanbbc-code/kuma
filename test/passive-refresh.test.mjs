import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import viewStateModule from '../dist/shared/view-state.js'

const { scrollUntouchedSince } = viewStateModule

const read = (rel) => fs.readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8')

// 出击中每进一个点，游戏都会推一次 sortie 变化。这一组守的是那一刻的观感：
// 面板可以更新，但不该先塌成空态再填回来——玩家看到的就是「画面闪一下像在刷新」。

test('map chronicle keeps the copy on screen while a fresher one is fetched', () => {
  const catalog = read('renderer/modules/ji.ts')
  const invalidate = catalog.slice(
    catalog.indexOf('const invalidateMapChronicle'),
    catalog.indexOf('const ensureMapChronicle'),
  )
  // 失效只推进代号，不丢手上这份——delete 会让整块「我的海域记录」塌成「正在读取…」
  assert.doesNotMatch(invalidate, /mapChronicle\.delete/)
  assert.match(invalidate, /mapChronicleGeneration\.set/)
  // 于是 ensure 不能再拿「有没有数据」当去重条件，得比代号
  const ensure = catalog.slice(
    catalog.indexOf('const ensureMapChronicle'),
    catalog.indexOf('let eoLode'),
  )
  assert.match(ensure, /mapChronicleLoaded\.get\(mapId\) === generation/)
  assert.doesNotMatch(ensure, /mapChronicle\.has\(mapId\)/)
})

test('whole-map forecast is not blanked out before its replacement arrives', () => {
  const catalog = read('renderer/modules/ji.ts')
  const ensure = catalog.slice(catalog.indexOf('const key = `${mapId}:${mapDifficultyRank'))
  const head = ensure.slice(0, ensure.indexOf('jiIpc.invoke'))
  assert.match(head, /mapForecastState\.loading = true/)
  assert.doesNotMatch(head, /mapForecastState\.report = emptyMapForecast\(\)/)
  // 加载中也照常显示手上这份，只在末尾挂一个不打眼的注脚
  assert.match(catalog, /esc\(history\)\}\$\{mapForecastState\.loading \? ' <i class="stale">· 正在更新<\/i>' : ''\}/)
})

test('node samples are dropped only when the fleet actually moved to another node', () => {
  const combat = read('renderer/modules/di.ts')
  const ensure = combat.slice(
    combat.indexOf('const ensureChron'),
    combat.indexOf('ipcRenderer.invoke('),
  )
  // 原先「换点必须清」是靠单例 chron 加一句 `if (chron.scope !== scope) 清空` 表达的，
  // 旧钉钉的就是那句。但单例有两个宿主（镝面板与史的战斗抽屉），同时显示不同节点时
  // 它俩会互相清空、互相挡请求。归属改成结构性表达：**按 scope 各存一条记录**，
  // 读取按当前渲染的 scope 取——新点天然拿不到别的点那条，比清空更强。
  // 两条原意照钉：
  // (1) 换点不许拿上一个点的敌情冒充新点
  assert.match(combat, /const chronScopeOf = \(s: SortieView\)[\s\S]*?`\$\{mapIdOf\(s\.mapArea, s\.mapNo\)\}:\$\{s\.currentCell\}`/)
  assert.match(combat, /const chronFor = \(s: SortieView\): ChronState/)
  assert.doesNotMatch(combat, /^const chron: ChronState = \{/m, '不许再退回单例')
  // 每个读取面都按当前 scope 取，没有一处还在读模块级的「上一份」
  for (const site of [
    /for \(const encounter of chronFor\(s\)\.encounters\)/,
    /const chron = chronFor\(s\)\s*\n\s*if \(chron\.loading/,
    /const chron = chronFor\(s\)\s*\n\s*const exact = chron\.forecast\.preview/,
    // 2026-08-26 起多收一个 tally 参数（「目录 ✓」与目录去重共用同一份对照），
    // 要盯的仍是那一条：本地遭遇按当前 scope 取，不许退回模块级的「上一份」
    /const myCompsHtml = \(s: SortieView, tally: CatalogEncounterTally\): string => \{\s*\n\s*const chron = chronFor\(s\)/,
  ]) assert.match(combat, site)
  // (2) 同一个点内（打完一场、结算落账）旧样本仍然说的是这个点，留着——
  //     ensure 里除了推进 loading 不许再有任何清空动作
  assert.doesNotMatch(ensure, /chron\.encounters = \[\]/, '同点重取不许把手上这份丢掉')
  assert.doesNotMatch(ensure, /chron\.forecast = emptyForecast\(\)/)
  // 跨 scope 互不清除：ensure 只碰自己那一条
  assert.doesNotMatch(ensure, /chronByScope\.clear\(\)|chronByScope\.delete\(/)
  // 加载态也只在真的没有这个点的样本时才顶上来
  assert.match(combat, /if \(chron\.loading && !chron\.encounters\.length\)/)
})

test('the embedded roster is reattached inside the mutation, not after the restore', () => {
  // 锚点不带换行：仓库 checkout 后源码是 CRLF，写死 \n 会让断言在别人机器上失配。
  // 要盯的是代码结构，不是行尾格式。
  const catalog = read('renderer/modules/ji.ts')
  const render = catalog.slice(catalog.indexOf('const render = () => {'))
  const body = render.slice(0, render.indexOf('function updateShipDetailPanel'))
  const openAt = body.indexOf('commitPaneHtml(')
  const appendAt = body.indexOf('appendChild(rosterHost)')
  // 提交口的收尾：闸门返回之后才轮到重绑（回调在此之前已经跑完）
  const closeAt = body.search(/if \(!committed\)/)
  assert.ok(openAt > 0 && appendAt > 0 && closeAt > 0, 'render shape changed — re-check this guard')
  // 列表是嵌在鉴里的持久节点：离开文档流 scrollTop 就归零，
  // 若在 withViewStateKept 的还原之后才接回，还原时根本找不到它，
  // 表现就是「正看着某艘舰的详情，游戏一加载就被拽回列表顶部」。
  // 接回必须落在闸门的回调**内部**（commitPaneHtml 的开括号之后、它返回之前）。
  assert.ok(openAt < appendAt, 'rosterHost 的接回必须在 commitPaneHtml 的回调内部')
  assert.ok(appendAt < closeAt, 'rosterHost must be reattached before the restore runs')
})

test('no cache throws away the copy on screen just to mark it stale', () => {
  // 这一类的通病：invalidate 直接 delete/clear/= null，于是面板先塌成加载态再填回来。
  // 根子是 ensure 拿「有没有数据」当去重条件，想重取就只剩「删掉数据」一条路——
  // 改成比对代号后，数据与新鲜度就解耦了，旧的可以一直挂着直到新的到达。
  const cases = [
    ['renderer/modules/ji.ts', /mapChronicle\.delete\(/, 'ji: 整图遭遇志'],
    ['renderer/modules/ji.ts', /shipMemorial = null/, 'ji: 收容库'],
    ['renderer/modules/ji.ts', /mapForecastState\.report = emptyMapForecast\(\)\n/, 'ji: 整图预测'],
    ['renderer/modules/ji.ts', /at: Date\.now\(\), data: new Map\(\) \}\n\s*void jiIpc/, 'ji: 深海出现海域'],
    ['renderer/modules/bi.ts', /expeditionHistory\.delete\(/, 'bi: 远征记录'],
    ['renderer/modules/qa.ts', /lifeReports\.clear\(\)/, 'qa: 人生记录'],
  ]
  for (const [file, pattern, label] of cases) {
    assert.doesNotMatch(read(file), pattern, `${label} 不该在失效时丢掉手上这份`)
  }
  // 对应地，各处都要有一个「代号」把数据和新鲜度分开
  assert.match(read('renderer/modules/ji.ts'), /mapChronicleLoaded\.get\(mapId\) === generation/)
  assert.match(read('renderer/modules/ji.ts'), /shipMemorial\.generation === shipMemorialGeneration/)
  assert.match(read('renderer/modules/bi.ts'), /expeditionHistoryLoaded\.get\(missionId\) === generation/)
  assert.match(read('renderer/modules/qa.ts'), /lifeLoaded\.get\(rosterId\) === generation/)
})

test('loading placeholders only appear when there is nothing to show yet', () => {
  // 有一份就照常显示，后台换新完成后静默替换——加载态不该顶掉已有内容
  const di = read('renderer/modules/di.ts')
  assert.match(di, /if \(chron\.loading && !chron\.encounters\.length\)/)
  // 「手上这份」是**当前渲染的这个点**的那份。原先 chron 是单例，靠「换点就清」
  // 维持归属；但这份状态有两个宿主（镝面板与史的战斗抽屉），同时显示不同节点时
  // 会互相清空、互相挡住对方发请求，加载态与样本都稳不下来。
  // 原意「加载态只在真没有数据时出现」不变，补钉归属的新表达：按 scope 各存一份。
  assert.match(di, /const chron = chronFor\(s\)\s*\n\s*if \(chron\.loading/, '加载态判断要取当前 scope 那一份')
  assert.match(di, /const chronByScope = new Map<string, ChronState>\(\)/)
  assert.match(di, /if \(chronByScope\.get\(scope\) !== chron\) return/, '回包落地前要确认条目还是自己那份')
  assert.doesNotMatch(di, /chron\.scope !== scope/, '换点不该再靠清空单例来表达归属')
  assert.match(read('renderer/modules/bi.ts'), /if \(!report\) \{\s*\n\s*if \(expeditionHistoryLoading\.has/)
  assert.match(read('renderer/modules/ji.ts'), /esc\(history\)\}\$\{mapForecastState\.loading \?/)
})

test('scroll containers are discovered at runtime instead of being declared', () => {
  // 申报制的问题不是麻烦，是清单天然腐坏：补齐一轮后仍漏 5 处，
  // 且为了守清单又得再养一条扫 CSS 的对账测试。判据既然运行时可测就别让人申报。
  const kernel = read('renderer/kernel.ts')
  assert.match(kernel, /export const withViewStateKept = \(root: HTMLElement, mutate: \(\) => void\)/)
  assert.match(kernel, /root\.querySelectorAll<HTMLElement>\('\*'\)/)
  // 键必须对每个元素推进计数器，只给滚动着的编号会让两次遍历错位
  assert.match(kernel, /必须对\*\*每个\*\*元素都推进计数器/)
  // 各模块不该再留任何选择器清单
  for (const mod of ['ji', 'di', 'shi', 'qa', 'bi', 'qn', 'ru', 'zi', 'du', 'lg', 'yu']) {
    assert.doesNotMatch(
      read(`renderer/modules/${mod}.ts`),
      /withViewStateKept\(\w+, \[/,
      `${mod} 不该再申报滚动容器`,
    )
  }
})

test('background refreshes coalesce into one repaint per frame', () => {
  const catalog = read('renderer/modules/ji.ts')
  assert.match(catalog, /const scheduleRender = \(\) => \{[\s\S]*?requestAnimationFrame/)
  // 整图遭遇志与整图预测会被同一次进点同时惊动，两个回调都得走合并
  const callbacks = [...catalog.matchAll(/activeBook === 'map' && mapState\.open[^\n]*\n?/g)]
    .map((m) => m[0])
    .filter((line) => line.includes('Render()') || line.includes('render()'))
  assert.ok(callbacks.length >= 3, 'expected the chronicle and forecast callbacks to be guarded')
  for (const line of callbacks) {
    assert.match(line, /scheduleRender\(\)/, `background refresh must coalesce: ${line.trim()}`)
  }
})

// ---- 2026-08-21：收远征时图鉴的滚动/点击被卡住（用户实机报出）----
//
// 实测（真账本副本 + CDP）：连收三次远征 = 九条报文，从前是图鉴 9 次、钦 18 次、
// 锐 15 次整块 innerHTML 重建，主线程被占住合计 906ms——而这段时间里这些面板
// **产出的 HTML 逐字节没变**（图鉴 24 次重渲只有 2 次真变了）。玩家看到的就是
// 滚轮在那几百毫秒里不走、按下与抬起之间赶上一次重建 click 就不发生。

test('尾随的那次滚动还原不许覆盖用户在这一帧里的新滚动', () => {
  // 判据是纯逻辑，直接跑（源码断言钉不住「判反了」——反过来写照样匹配）
  // 位置还是我们上一拍写进去的那个 → 允许再还原一次（浏览器的滚动锚定要靠它兜底）
  assert.equal(scrollUntouchedSince({ top: 9913, left: 0 }, { top: 9913, left: 0 }), true)
  // 亚像素舍入（界面缩放 1.15 下 scrollTop 常带小数）不算用户动作
  assert.equal(scrollUntouchedSince({ top: 9913.4, left: 0 }, { top: 9913, left: 0 }), true)
  // 用户又滚了 → 不许覆盖（实测就是这条缺席造成的「短距离回退」：滚 500 两帧后回原位）
  assert.equal(scrollUntouchedSince({ top: 10413, left: 0 }, { top: 9913, left: 0 }), false)
  assert.equal(scrollUntouchedSince({ top: 9913, left: 120 }, { top: 9913, left: 0 }), false)
  // 这一轮压根没写过（快照里没有这个容器）→ 也不许写
  assert.equal(scrollUntouchedSince({ top: 500, left: 0 }, undefined), false)
})

test('输出没变就不换 DOM，且没换 DOM 就不重绑', () => {
  const kernel = read('renderer/kernel.ts')
  // 闸门本体：逐字节比较（比输入签名更硬——签名漏一个输入就是「该更新的不更新」）
  assert.match(kernel, /export const commitPaneHtml = \(/)
  assert.match(kernel, /export const applyPaneHtml = \(/)
  assert.match(kernel, /export const forgetCommittedHtml = \(/)
  // 各模块：跳过时必须连重绑一起跳，否则逐元素监听会绑在老元素上叠加
  for (const [mod, needle] of [
    ['ji', /if \(!committed\) \{/],
    ['qn', /if \(!commitPaneHtml\(pane, 'qn', html\)\) return/],
    ['ru', /if \(!commitPaneHtml\(pane, 'ru', html\)\) return/],
    ['zi', /if \(!commitPaneHtml\(pane, 'zi', html\)\) return/],
    ['qa', /if \(!commitPaneHtml\(pane, 'qa', html\)\) return/],
    ['bi', /if \(!commitPaneHtml\(pane, 'bi', html\)\) return/],
    ['equip-stock', /if \(!commitPaneHtml\(pane!?, 'es', html\)\) return/],
    ['di', /if \(!committed\) return/],
    ['shi', /if \(!committed\) \{/],
  ]) {
    assert.match(read(`renderer/modules/${mod}.ts`), needle, `${mod}：跳过重建时必须一并跳过重绑`)
  }
})

test('指针按下期间的被动重渲让到抬起之后（否则那一次 click 不会发生）', () => {
  const kernel = read('renderer/kernel.ts')
  assert.match(kernel, /export const deferWhilePressed = \(/)
  // 只推迟落在**这块面板上**的按下，别的面板照常更新
  assert.match(kernel, /if \(!pressedTarget \|\| !root\.contains\(pressedTarget\)\) return false/)
  // 必须封顶：按住不放不能把界面永久冻在旧状态；pointerup 收不到时也要补跑
  assert.match(kernel, /PRESS_DEFER_CAP/)
  assert.match(kernel, /document\.addEventListener\('pointerup', releasePointer, true\)/)
  assert.match(kernel, /document\.addEventListener\('pointercancel', releasePointer, true\)/)
  // 补渲要再排一个任务：click 在 pointerup → mouseup **之后**才派发，
  // 在 pointerup 里就换 DOM 那一次点击照样被吞（实测过，加这一拍才送达）
  assert.match(kernel, /if \(deferredRenders\.size\) setTimeout\(flushDeferredRenders, 0\)/)
  // 用上它的模块（镝与铃是未卜先知/通知，要实时，刻意不进这张表）
  for (const mod of ['ji', 'qn', 'ru', 'zi', 'qa', 'bi', 'shi']) {
    assert.match(read(`renderer/modules/${mod}.ts`), /deferWhilePressed\(/, `${mod} 应当让出按下期间的被动重渲`)
  }
  for (const mod of ['di', 'lg']) {
    assert.doesNotMatch(
      read(`renderer/modules/${mod}.ts`),
      /deferWhilePressed\(/,
      `${mod} 是未卜先知/通知模块，实时优先，不进推迟名单`,
    )
  }
})
