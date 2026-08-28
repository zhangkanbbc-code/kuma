import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.join(fileURLToPath(import.meta.url), '..', '..')
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const ru = () => read('src/renderer/modules/ru.ts')
const skin = () => read('src/renderer/index.html')

// 锐的抬头封顶两行：身份行（第N舰队 + 自定义名 + 同步时刻 + 出击裁决）永远完整，
// 度量行只占一行——放不下的按固定优先级收进行尾的「⋯N」，悬停展开完整卡。
// 抬头每多占一行，编队区就少一艘舰的高度；这一组守的是「第六舰还在不在视野里」。

// ---- 收纳判定本身（在编译产物上真跑一遍，不是比对源码文本）----
//
// planMetricsFold 是纯算术、无依赖，所以能从 bundle 里整段切出来执行。
// 只断言源码长什么样的话，把 `total <= avail` 写反照样绿——那正是这条要防的。
const loadPlanner = () => {
  const bundle = read('dist/renderer/index.js')
  const head = /\bplanMetricsFold\w* = \((\w+)\) => \{/.exec(bundle)
  assert.ok(head, '编译产物里找不到 planMetricsFold —— 收纳判定被改名或被内联了')
  const param = head[1]
  const open = bundle.indexOf('{', head.index + head[0].length - 1)
  let depth = 0
  let close = -1
  for (let i = open; i < bundle.length; i += 1) {
    if (bundle[i] === '{') depth += 1
    else if (bundle[i] === '}') {
      depth -= 1
      if (depth === 0) {
        close = i
        break
      }
    }
  }
  assert.ok(close > open, 'planMetricsFold 的函数体没能完整切出来')
  return new Function(param, bundle.slice(open + 1, close))
}

/** 六枚一样宽的芯片：宽 40、间距 4、「⋯N」宽 30。 */
const scene = (avail, keys = ['air', 'los', 'comp', 'soku', 'lv', 'tp'], width = 40) => ({
  widths: new Map(keys.map((key) => [key, width])),
  order: ['tp', 'comp', 'lv', 'soku', 'cmb', 'los', 'air'],
  moreWidth: 30,
  gap: 4,
  avail,
})

test('度量收纳按固定优先级逐个收：TP → 构成 → 平均Lv → 航速，制空与索敌33 最后', () => {
  const plan = loadPlanner()
  // 6 枚 × 40 + 5 × 4 = 260：正好放得下就一枚都不收
  assert.deepEqual(plan(scene(260)), [])
  assert.deepEqual(plan(scene(1000)), [])
  // 差 1px 就要收：收掉 TP 之后是 5 枚 + 「⋯1」= 5×40+30+5×4 = 250
  assert.deepEqual(plan(scene(259)), ['tp'])
  assert.deepEqual(plan(scene(250)), ['tp'])
  // 再窄一档收「构成」：4×40+30+4×4 = 206
  assert.deepEqual(plan(scene(249)), ['tp', 'comp'])
  assert.deepEqual(plan(scene(206)), ['tp', 'comp'])
  // 平均Lv、航速依次让路
  assert.deepEqual(plan(scene(205)), ['tp', 'comp', 'lv'])
  assert.deepEqual(plan(scene(161)), ['tp', 'comp', 'lv', 'soku'])
  // 临战数字最后：索敌33 要等前四项全收完才动，制空垫底
  assert.deepEqual(plan(scene(117)), ['tp', 'comp', 'lv', 'soku', 'los'])
  assert.deepEqual(plan(scene(40)), ['tp', 'comp', 'lv', 'soku', 'los', 'air'])
})

test('收纳顺序里没有的芯片不占名额，联合合并排在临战两项之前', () => {
  const plan = loadPlanner()
  // 非联合时 cmb 根本不在行里：跳过它，直接轮到索敌33
  assert.deepEqual(plan(scene(117)).includes('cmb'), false)
  const combined = scene(161, ['air', 'los', 'comp', 'soku', 'lv', 'tp', 'cmb'])
  // 7 枚 × 40 + 6 × 4 = 304。收掉 tp/comp/lv/soku 后是 3 枚 + 「⋯4」= 162，
  // 差 1px 还是放不下，于是轮到 cmb（2 枚 + 「⋯5」= 118）——它排在 los/air 之前
  assert.deepEqual(plan(combined), ['tp', 'comp', 'lv', 'soku', 'cmb'])
  // 再宽 1px 就轮不到它：联合合并只在真放不下时才让路
  assert.deepEqual(plan(scene(162, ['air', 'los', 'comp', 'soku', 'lv', 'tp', 'cmb'])), [
    'tp',
    'comp',
    'lv',
    'soku',
  ])
})

test('收纳把「⋯N」自己的宽度也算进去，间距按可见枚数算', () => {
  const plan = loadPlanner()
  // 两枚 40 + 一道 4 = 84 放得下 84
  assert.deepEqual(plan(scene(84, ['los', 'air'])), [])
  // 83 放不下 → 收 los（order 里 los 在 air 前）；剩 air 40 + ⋯30 + 4 = 74
  assert.deepEqual(plan(scene(83, ['los', 'air'])), ['los'])
  // 「⋯N」本身很宽时，收一枚反而不够，得继续收
  const fat = { ...scene(83, ['los', 'air']), moreWidth: 60 }
  assert.deepEqual(plan(fat), ['los', 'air'])
})

// ---- 「有空位不许收」（2026-08-21 用户报的那一档）----
//
// 按优先级逐个收时，最后收的那一枚往往把前面几枚的位置也一起让了出来：
// 只收 TP 还差一点，于是构成也让了路，行尾当场空出一大段——而 TP 本来放得回去。
// 下面这组宽度全部取自真机实测（面板 963px → 行宽 461.97px，第4舰队注入用户截图的字样）。
const REAL = {
  widths: new Map([
    ['air', 43.61],
    ['los', 74.55],
    ['comp', 168.72],
    ['soku', 76.32],
    ['lv', 63.13],
    ['tp', 75.38],
  ]),
  order: ['tp', 'comp', 'lv', 'soku', 'cmb', 'los', 'air'],
  moreWidth: 33.82,
  gap: 3,
  avail: 461.97,
}

/** 这套方案摆出来要占多宽（可见芯片 + 「⋯N」+ 间距），与实现分开算一遍 */
const spread = (scene, folded) => {
  const shown = [...scene.widths].filter(([key]) => !folded.includes(key))
  let total = shown.reduce((sum, [, width]) => sum + width, 0)
  let count = shown.length
  if (folded.length) {
    total += scene.moreWidth
    count += 1
  }
  return count > 1 ? total + scene.gap * (count - 1) : total
}

test('后面有位置就不许收：按次序收够之后，放得回去的要放回来', () => {
  const plan = loadPlanner()
  // 用户截图那一档：只收 TP 是 475.15 > 461.97，构成只好也让路（剩 303.43），
  // 行尾于是空出 158px——TP 只要 75.38 + 3 的间距，必须放回来
  assert.deepEqual(plan(REAL), ['comp'])
  assert.ok(spread(REAL, ['comp']) <= REAL.avail + 0.5, '放回 TP 之后仍然只占一行')
  // 反向：空位真放不下就不许放回（330px 那档，TP 放回去要 381.81）
  assert.deepEqual(plan({ ...REAL, avail: 330 }), ['tp', 'comp'])
  // 临界：381.81 正好放得下 TP，差 1px 就放不下
  assert.deepEqual(plan({ ...REAL, avail: 381.81 }), ['comp'])
  assert.deepEqual(plan({ ...REAL, avail: 381 }), ['tp', 'comp'])
  // 只需要收一枚时，收的仍然是 TP——放回来这一步不许动收纳次序
  assert.deepEqual(plan({ ...REAL, avail: 480 }), ['tp'])
  assert.deepEqual(plan({ ...REAL, avail: 520 }), [])
})

test('逐档扫一遍宽度：凡是被收起来的，单独放回去都必须真的放不下', () => {
  const plan = loadPlanner()
  for (let avail = 60; avail <= 620; avail += 1) {
    const scene = { ...REAL, avail }
    const folded = plan(scene)
    for (const key of folded) {
      const withIt = folded.filter((other) => other !== key)
      assert.ok(
        spread(scene, withIt) > avail + 0.5,
        `行宽 ${avail} 收了 ${key}，可空位放得下它（放回来只占 ${spread(scene, withIt).toFixed(2)}）`,
      )
    }
    // 收了的必须真有必要：一枚都不收就放得下时，不许收
    if (spread(scene, []) <= avail + 0.5) assert.deepEqual(folded, [])
  }
})

test('临界宽度上带滞回：放出来要多一点余量，收起来一到线就收', () => {
  const plan = loadPlanner()
  const s = scene(260)
  // 260 正好放得下六枚，但上一拍 TP 收着——要多出 6px 才放它出来，不然一抖就翻
  assert.deepEqual(plan({ ...s, previous: ['tp'], hysteresis: 6 }), ['tp'])
  assert.deepEqual(plan({ ...scene(265), previous: ['tp'], hysteresis: 6 }), ['tp'])
  assert.deepEqual(plan({ ...scene(266), previous: ['tp'], hysteresis: 6 }), [])
  // 反向不吃死区：本来摊开着的，一放不下立刻收
  assert.deepEqual(plan({ ...scene(259), previous: [], hysteresis: 6 }), ['tp'])
  assert.deepEqual(plan({ ...scene(259), previous: ['tp'], hysteresis: 6 }), ['tp'])
  // 不给 previous 就没有滞回：判定和以前完全一样
  assert.deepEqual(plan({ ...s, hysteresis: 6 }), [])
})

test('收纳优先级写死在源码里，改动要连注释里的理由一起改', () => {
  const source = ru()
  assert.match(
    source,
    /const FLEET_METRIC_FOLD_ORDER = \['tp', 'comp', 'lv', 'soku', 'cmb', 'los', 'air'\] as const/,
    '收纳优先级是用户逐项定的：TP → 构成 → 平均Lv → 航速 → 联合合并 → 索敌33 → 制空',
  )
  // 理由留在注释里，别让下一个人以为这串顺序是随手排的
  assert.match(source, /运输量除活动和月一次的 5-6 之外基本用不到/)
  assert.match(source, /制空与索敌33 是临战数字，\*\*最后才收\*\*/)
  // 陆航抬头同构，同样封顶一行；能动手的两项（缺补给/疲劳）留到最后
  assert.match(
    source,
    /const AIR_BASE_METRIC_FOLD_ORDER = \['areas', 'squads', 'short', 'tired'\] as const/,
  )
})

test('两条度量行都走同一个收纳出口，芯片各自带 key', () => {
  const source = ru()
  // 舰队与陆航的抬头都必须经 metricsRowHtml——各写一份 <div class="metrics"> 就会漏收
  assert.equal((source.match(/<div class="metrics"/g) ?? []).length, 1)
  assert.match(source, /metricsRowHtml\('fleet', FLEET_METRIC_FOLD_ORDER/)
  assert.match(source, /metricsRowHtml\('airbase', AIR_BASE_METRIC_FOLD_ORDER/)
  for (const key of ['air', 'los', 'comp', 'soku', 'lv', 'tp', 'cmb']) {
    assert.match(source, new RegExp(`data-mkey="${key}"`), `舰队度量缺 ${key} 的 key`)
  }
  for (const key of ['areas', 'squads', 'short', 'tired']) {
    assert.match(source, new RegExp(`data-mkey="${key}"`), `陆航度量缺 ${key} 的 key`)
  }
})

test('收纳在渲染那一帧就定下来，宽度变了会重量、同宽不重算', () => {
  const source = ru()
  const render = source.slice(source.indexOf('const render = (force = false)'))
  // 同步收：丢进 rAF 会先看见换行、下一帧才收起，那一下就是闪跳
  assert.match(render, /wireFleetPanel\(pane[\s\S]{0,400}?\n\s*foldMetrics\(pane\)/)
  assert.doesNotMatch(
    render.slice(render.indexOf('wireFleetPanel(pane')),
    /requestAnimationFrame\([^)]*\) =>[\s\S]{0,120}foldMetrics/,
  )
  // 坞宽变化（含面板从隐藏到显示）也要重量一次
  const observer = source.slice(source.indexOf('const paneResize = new ResizeObserver'))
  assert.match(observer.slice(0, 400), /foldMetrics\(pane\)/)
  assert.match(source, /trackMountCleanup\(\(\) => paneResize\.disconnect\(\)\)/)
  // 行宽为 0（面板还没显示）时什么都别收，否则显示出来要整条翻回去
  assert.match(source, /const probe = row\.clientWidth\s*\n\s*if \(probe <= 0\) return/)
  // 同宽同内容套上次结果：decks/ships 是全场最高频的补丁，不能每次都重量
  assert.match(
    source,
    /if \(cached && cached\.sig === sig && cached\.probe === probe\) \{\s*\n\s*applyMetricsFold\(chips, more, cached\.folded\)/,
  )
  // 判定用的可用宽必须是小数（clientWidth 取整会把「刚好放得下」变成换行），
  // 且要在**摊开之后**读——与各芯片宽度出自同一份布局
  const measure = source.slice(
    source.indexOf("more.classList.remove('m-folded')", source.indexOf('const foldMetricsRow')),
    source.indexOf('metricsFoldCache.set(rowId'),
  )
  assert.match(measure, /avail: contentWidthOf\(row\)/)
  assert.doesNotMatch(measure, /avail: probe/)
  // 渲染后复核一拍：真画出来还是两行就按次序再收一枚
  assert.match(measure, /row\.getBoundingClientRect\(\)\.height <= lineHeight \+ 1/)
})

test('悬停卡摆出全部被收项，且挂在 body 上', () => {
  const source = ru()
  const show = source.slice(
    source.indexOf('const showMetricsFoldCard'),
    source.indexOf('const refreshMetricsFoldCard'),
  )
  // 全部被收项，不截断——「⋯3」点开只看到两项就是骗人
  assert.match(show, /querySelectorAll<HTMLElement>\('\.mchip\.m-folded\[data-mkey\]'\)/)
  assert.doesNotMatch(show, /\.slice\(0,/, '被收项不许截断')
  // 与摊开时一模一样的字样：克隆行里的原件，不另写一份措辞
  assert.match(show, /chip\.cloneNode\(true\)/)
  assert.match(show, /clone\.classList\.remove\('m-folded'\)/)
  // 面板既裁 overflow 又带 transform 包含块，浮层一律挂 body（2026-08-09 那三次）
  const init = source.slice(source.indexOf('const initMetricsFoldCard'))
  assert.match(init, /document\.body\.appendChild\(metricsFoldCard\)/)
  assert.doesNotMatch(init, /pane\.appendChild\(metricsFoldCard\)/)
  // 卡靠这个类才吃得到 .fleet-skin 下的芯片样式
  assert.match(init, /metricsFoldCard\.className = 'fleet-skin'/)
  // 重复 mount 不叠监听：一次性闸门
  assert.match(init, /if \(metricsFoldCardReady\) return\s*\n\s*metricsFoldCardReady = true/)
  // 被动重渲染换掉锚点后要重新贴，别钉在原地显示过期快照
  assert.match(source, /const render = \(force = false\)[\s\S]*?refreshMetricsFoldCard\(\)/)
})

test('度量芯片不伸缩不折行——量到的宽度才是它真要占的', () => {
  const css = skin()
  const chip = css.slice(css.indexOf('.fleet-skin .mchip {'), css.indexOf('.fleet-skin .mchip.m-folded'))
  assert.match(chip, /flex: none/)
  assert.match(chip, /white-space: nowrap/)
  assert.match(css, /\.fleet-skin \.mchip\.m-folded \{ display: none; \}/)
  assert.match(css, /#ru-metrics-fold \{[^}]*position: fixed/)
  // .fleet-skin 自带 overflow:hidden，卡要显式解开，否则内容被自己裁掉
  assert.match(css, /#ru-metrics-fold \{[^}]*overflow: visible/)
})

// ---- 沙盘移出按钮：别再被后面的规则压掉定位 ----

/** 去掉注释后，扫出所有作用在该选择器（元素本身，非伪元素）上的 position 声明。 */
const positionDeclarationsFor = (css, selector) => {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const found = []
  const needle = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!::|:)`, 'g')
  for (const hit of clean.matchAll(needle)) {
    const open = clean.indexOf('{', hit.index)
    const close = clean.indexOf('}', open)
    if (open < 0 || close < 0) continue
    for (const decl of clean.slice(open + 1, close).matchAll(/(?:^|;)\s*position\s*:\s*([\w-]+)/g)) {
      found.push(decl[1])
    }
  }
  return found
}

test('沙盘舰行的移出 × 保持浮在行角，没有第二条规则把它压回文档流', () => {
  const css = skin()
  const positions = positionDeclarationsFor(css, '.fleet-skin .sand-out')
  // 它是行角上的浮标：行是固定 6 列 grid，掉回流里会占掉第 1 列——
  // 头像被挤进 1fr 列、装备格掉到第二行、行高 63px → 89px（实测）。
  assert.deepEqual(
    positions,
    ['absolute'],
    '.fleet-skin .sand-out 的 position 只能由一条规则说了算，且必须是 absolute',
  )
  // 修法不许把热区一起弄丢：::after 那条仍要覆盖它（absolute 同样是「已定位」）
  assert.match(css, /\.fleet-skin \.sand-out::after/)
  assert.match(css, /\.fleet-skin \.ship\.in-sandbox \{ position: relative; \}/)
})
