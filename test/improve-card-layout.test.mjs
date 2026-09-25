// 装备抽屉「改修工厂」卡的排布护栏（2026-08-25 他裁的骨架，回归《图鉴设计稿》
// 02-装备图鉴 的 :432-493）。
//
// 全部断言都对着**真编译出来的 HTML**下——这一族的病（同一个数出现三次、更新目标
// 摆两处、角标离对象最远、布局写在 inline style 里）在源码里都长得挺正常，
// 只有把卡渲染出来数一遍才看得见。
import assert from 'node:assert/strict'
import test from 'node:test'

import { OPEN_BY_DEFAULT, improveCardHtml, sectionTitleOf } from './fixtures/render-improve-card.mjs'

const 装备 = {
  1: { api_id: 1, api_name: '12.7cm連装砲', api_type: [1, 1, 1, 1] },
  2: { api_id: 2, api_name: '12.7cm連装砲B型改二', api_type: [1, 1, 1, 1] },
  3: { api_id: 3, api_name: '12.7cm連装砲C型改三', api_type: [1, 1, 1, 1] },
  4: { api_id: 4, api_name: '12.7cm連装砲D型改二', api_type: [1, 1, 1, 1] },
}
const 舰 = {
  91: { api_id: 91, api_name: '白露改二' },
  92: { api_id: 92, api_name: '満潮改二' },
  93: { api_id: 93, api_name: '時雨改二' },
}
const p1 = { devmats: 3, devmats_sli: 4, screws: 1, screws_sli: 2, equips: [{ id: 1, eq_count: 1 }] }
const p2 = { devmats: 4, devmats_sli: 6, screws: 3, screws_sli: 4, equips: [{ id: 2, eq_count: 1 }] }
const conv = { devmats: 10, devmats_sli: 12, screws: 8, screws_sli: 10, equips: [{ id: 2, eq_count: 2 }] }

/** 一件常规装备：一套方案、一组二号舰、有更新目标。 */
const 常规 = () => ({
  equip: 装备[2],
  equips: 装备,
  ships: 舰,
  materials: { 6: 400, 7: 300 },
  unlocked: { 1: 9, 2: 8 },
  instances: [['101', { level: 4 }]],
  eo: {
    eq_id: 2,
    improvement: [
      {
        basis: '游戏内实测',
        helpers: [{ ship_ids: [91], days: [1, 2, 3, 4] }],
        convert: { id_after: 3, lvl_after: 0 },
        costs: { p1, p2, conv, fuel: 20, ammo: 20, steel: 30, baux: 10 },
      },
    ],
  },
})

const countOf = (html, needle) => html.split(needle).length - 1

// 按 div 嵌套深度取完整元素，卡内有周历等 div，不能遇到第一个闭合就截断。
const divsOf = (html, className) => [...html.matchAll(new RegExp(`<div class="${className}">`, 'g'))].map((match) => {
  let depth = 0
  for (const tag of html.slice(match.index).matchAll(/<div\b[^>]*>|<\/div>/g)) {
    depth += tag[0] === '</div>' ? -1 : 1
    if (depth === 0) return html.slice(match.index, match.index + tag.index + tag[0].length)
  }
  assert.fail(`${className} 没有闭合`)
})

test('骨架：一张卡里 mats 表一张、更新目标一处、角标贴着它描述的那张表', () => {
  const html = improveCardHtml(常规())
  assert.equal(countOf(html, '<table class="mats"'), 1, '消耗表不止一张')
  assert.equal(divsOf(html, 'ak-imp').length, 1, '一条更新路线没独占一张卡')
  // 更新目标（C型改三）只在 ak-to 卡尾出现一次——表底那行「更新：X」已退场
  assert.equal(countOf(html, '12.7cm連装砲C型改三'), 1, '更新目标出现了不止一次')
  // 角标挂在表抬头行里，不在卡尾
  const caption = /<caption>([\s\S]*?)<\/caption>/.exec(html)
  assert.ok(caption, '消耗表没有抬头行')
  assert.match(caption[1], /credit-mark/, 'basis 角标没挂在消耗表抬头上')
  assert.match(caption[1], /实测/, '实测这一档的角标没渲染出来')
  // 三档消耗都在这张表里；确保值走括号内联，不再写「·确保」
  assert.match(html, /★0-5/)
  assert.match(html, /★6-9/)
  assert.match(html, /★max 更新/)
  assert.match(html, /3 <i>\(4\)<\/i>/, '开发资材的确保值没内联进括号')
  assert.doesNotMatch(html, /· 确保 /, '「·确保」的老写法还在，「·」又背上了两种意思')
  // 基础消耗（燃弹钢铝）进了表脚，不再单占一行
  assert.match(html, /<tfoot>[\s\S]*燃 20[\s\S]*<\/tfoot>/)
})

test('一套方案里几组二号舰共走一条更新路线 → 同一张卡，目标在卡尾只出现一次', () => {
  const setup = 常规()
  setup.eo.improvement[0].helpers = [
    { ship_ids: [91], days: [1, 2] },
    { ship_ids: [92], days: [4, 5] },
    { ship_ids: [93], days: [0] },
  ]
  const html = improveCardHtml(setup)
  const cards = divsOf(html, 'ak-imp')
  assert.equal(cards.length, 1, '同一更新目标的二号舰被拆成了多张卡')
  assert.equal(countOf(html, '<div class="ak-row">'), 3, '三组二号舰没各占一行')
  const rows = divsOf(cards[0], 'ak-row')
  assert.equal(rows.length, 3, '三组二号舰没有全部归入同一张卡')
  assert.equal(countOf(html, 'class="to"'), 1, '更新目标没有只出现一次')
  assert.equal(countOf(html, '★max 后更新 →'), 1, '更新目标在每一行都重复了一遍')
  assert.ok(cards[0].indexOf('class="to"') > cards[0].indexOf(rows[2]) + rows[2].length, '目标没在第三行闭合之后')
  assert.match(cards[0], /<div class="ak-to"><span class="to">[\s\S]*<\/span><\/div><\/div>$/, '目标没在这张卡闭合之前的卡尾')
})

test('大発動艇形状：三条更新路线各成一张卡，各组二号舰之后只写自己的目标', () => {
  const setup = 常规()
  const targets = ['大発動艇(八九式中戦車&陸戦隊)', '特大発動艇', '武装大発']
  const helpers = [
    ['阿武隈改二', '皐月改二', 'あきつ丸'],
    ['龍田改二', '鬼怒改二'],
    ['浦波改二', '神州丸', '清霜改二丁'],
  ]
  setup.equip = { api_id: 68, api_name: '大発動艇', api_type: [1, 1, 1, 1] }
  setup.eo.eq_id = 68
  setup.equips = { ...装备 }
  setup.ships = {}
  setup.eo.improvement = helpers.map((names, route) => {
    const target = 300 + route
    setup.equips[target] = { api_id: target, api_name: targets[route] }
    return {
      basis: '整理参照',
      helpers: names.map((name, group) => {
        const id = 200 + route * 10 + group
        setup.ships[id] = { api_id: id, api_name: name }
        return { ship_ids: [id], days: [group + 1] }
      }),
      convert: { id_after: target, lvl_after: 0 },
      costs: { p1, p2, conv, fuel: 20, ammo: 20, steel: 30, baux: 10 },
    }
  })
  const html = improveCardHtml(setup)
  const cards = divsOf(html, 'ak-imp')
  assert.equal(cards.length, 3, '三条路线没各成一张卡')
  assert.equal(countOf(html, '<table class="mats"'), 1, '相同消耗没共用一张表')
  assert.equal(countOf(html, '★max 后更新'), 3, '三条路线的更新目标有缺失或重复')
  cards.forEach((card, route) => {
    const rows = divsOf(card, 'ak-row')
    assert.equal(rows.length, helpers[route].length, '卡内二号舰组数不符')
    assert.equal(countOf(card, 'class="to"'), 1, '卡内更新目标没有恰好一处')
    const targetName = targets[route].replace('&', '&#38;')
    const targetAt = card.indexOf(targetName)
    assert.ok(targetAt > card.indexOf(rows.at(-1)) + rows.at(-1).length, '目标没在最后一组二号舰之后')
    helpers[route].forEach((name, group) => assert.ok(rows[group].includes(name), '二号舰串到了别的卡或顺序变了'))
    assert.match(card, /<div class="ak-to"><span class="to">[\s\S]*<\/span><\/div><\/div>$/, '目标没在自己的卡尾')
  })
  assert.ok(cards[1].indexOf('龍田改二') < cards[1].indexOf('鬼怒改二'))
  assert.ok(cards[1].indexOf('鬼怒改二') < cards[1].indexOf('特大発動艇'))
})

test('布局全在样式表里：改修段一个 inline style 都不许有', () => {
  const html = improveCardHtml(常规())
  assert.equal(countOf(html, 'style="'), 0, '改修卡里还留着 inline style')
})

test('周历圆点点亮的正是资料里的那几天，别的六天原样暗着', () => {
  const html = improveCardHtml(常规()) // days: 一二三四
  const week = /<div class="week">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? ''
  const dots = [...week.matchAll(/<span class="day( on)?" title="([^"]+)">/g)].map(
    ([, on, title]) => [title, !!on],
  )
  assert.deepEqual(dots, [
    ['星期一', true],
    ['星期二', true],
    ['星期三', true],
    ['星期四', true],
    ['星期五', false],
    ['星期六', false],
    ['星期日', false],
  ])
  // 反向：换一组日程，点亮的那几枚要跟着走
  const 周末 = 常规()
  周末.eo.improvement[0].helpers = [{ ship_ids: [91], days: [0, 6] }]
  const week2 = /<div class="week">([\s\S]*?)<\/div>/.exec(improveCardHtml(周末))?.[1] ?? ''
  assert.deepEqual(
    [...week2.matchAll(/<span class="day on" title="([^"]+)">/g)].map(([, t]) => t),
    ['星期六', '星期日'],
  )
})

test('抬头只回答「今天能不能改」，不再报「N 套方案 · 每周安排 · 二号舰 · 消耗」', () => {
  const 周二 = improveCardHtml({ ...常规(), day: 2 })
  assert.match(周二, /星期二 · 今日可改修 ✓/)
  const 周五 = improveCardHtml({ ...常规(), day: 5 })
  assert.match(周五, /星期五 · 今日不可改修 ✗/)
})

// 2026-09-25 维护者裁决：装备详情的「改修工厂」节头也能收藏，与今日改修展开层同一份名单；
// 哪天都能点（今天不能改的款也能先收藏）。
const 节头 = (html) => /<div class="sec-h">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? ''

test('改修工厂节头带收藏开关：未收藏「☆ 收藏」、已收藏「★ 已收藏」，今天不能改也照样有', () => {
  for (const day of [2, 5]) {
    assert.match(节头(improveCardHtml({ ...常规(), day })), /data-improve-favorite="2"[^>]*>\s*☆ 收藏/, `星期${day}`)
    assert.match(节头(improveCardHtml({ ...常规(), day, favorites: [2] })), /data-improve-favorite="2"[^>]*>\s*★ 已收藏/, `星期${day}`)
  }
  // 段名不变，折叠记忆照旧认得
  assert.equal(sectionTitleOf(improveCardHtml({ ...常规(), favorites: [2] })), '改修工厂')
})

test('不可改修与未收录的装备不给收藏开关', () => {
  for (const uncovered of [true, false]) {
    const html = improveCardHtml({ equip: 装备[1], equips: 装备, eo: null, uncovered, coverageMax: 500 })
    assert.ok(!html.includes('data-improve-favorite'), uncovered ? '未收录' : '不可改修')
  }
})

test('段名与折叠默认集对得上——改了名就得同步改，否则卡会静默变回折起', () => {
  const html = improveCardHtml(常规())
  const title = sectionTitleOf(html)
  assert.equal(title, '改修工厂')
  assert.ok(OPEN_BY_DEFAULT.has(title), `「${title}」不在默认展开集里，抽屉一打开它是折着的`)
})

test('推满账收成两行：一行推满、一行连更新，储备对比跟在数字后面', () => {
  const html = improveCardHtml(常规())
  const sums = [...html.matchAll(/<div class="ak-sum"[^>]*>([\s\S]*?)<\/div>/g)].map(([, body]) => body)
  assert.equal(sums.length, 2, '推满账没收成两行')
  // ★4 起手：p1 还剩 2 次、p2 四次，共 6 次
  assert.match(sums[0], /升至 <b>★4→★max<\/b> · 还需 <b>6<\/b> 次/)
  // 开发 3×2 + 4×4 = 22（确保 4×2 + 6×4 = 32）；储备 400 够，给 ✓
  assert.match(sums[0], /22 <i>\(32\)<\/i>/)
  assert.match(sums[0], /<i class="ok"[^>]*>✓<\/i>/)
  assert.match(sums[1], /含更新消耗/)
  // 连更新那一行是整条路线：开发 22+10=32（确保 32+12=44）
  assert.match(sums[1], /32 <i>\(44\)<\/i>/)
})

test('储备不够时说得出还差多少，通常与确保分开说', () => {
  const 紧 = { ...常规(), materials: { 6: 25, 7: 5 } }
  const html = improveCardHtml(紧)
  assert.match(html, /<i class="warn">储备 25 · 确保消耗缺 7<\/i>/)
  assert.match(html, /<i class="bad">储备 5 · 普通消耗缺 \d+<\/i>/)
})

test('多套方案消耗相同 → 共用一张表、各成一张卡，不给更新的那张卡写「更新不可」', () => {
  const setup = 常规()
  setup.eo.improvement = [
    {
      basis: '整理参照',
      helpers: [{ ship_ids: [91], days: [1, 2] }],
      convert: { id_after: 3, lvl_after: 0 },
      costs: { p1, p2, conv, fuel: 20, ammo: 20, steel: 30, baux: 10 },
    },
    {
      basis: '整理参照',
      helpers: [{ ship_ids: [92], days: [4, 5] }],
      costs: { p1, p2, fuel: 20, ammo: 20, steel: 30, baux: 10 },
    },
  ]
  const html = improveCardHtml(setup)
  assert.equal(countOf(html, '<table class="mats"'), 1, '消耗一样却拆成了两张表')
  assert.equal(countOf(html, '<div class="ak-row">'), 2, '两组二号舰没各占一行')
  const cards = divsOf(html, 'ak-imp')
  assert.equal(cards.length, 2, '两套方案没各成一张卡')
  assert.match(html, /白露改二/)
  assert.match(html, /満潮改二/)
  assert.equal(countOf(html, "更新不可 · 只能强化到 ★max"), 1, "「这个二号舰不给更新」没说清")
  assert.equal(countOf(cards[0], '更新不可 · 只能强化到 ★max'), 0, '可更新的卡被标成更新不可')
  assert.equal(countOf(cards[1], '更新不可 · 只能强化到 ★max'), 1, '更新不可没归入第二张卡')
  // 消耗一样的时候只有一档更新，档位名里不必再挂目标
  assert.match(html, /<td class="rng">★max 更新<\/td>/)
  // 方案号只在真有两套消耗时才出现
  assert.equal(countOf(html, 'ak-plan-h'), 0, '消耗一致却还在给方案编号')
})

test('多套方案消耗不同 → 一组一张表，不许挑一个数冒充全体', () => {
  const setup = 常规()
  setup.eo.improvement = [
    {
      basis: '整理参照',
      helpers: [{ ship_ids: [91], days: [1, 2] }],
      costs: { p1, p2, fuel: 20, ammo: 20, steel: 30, baux: 10 },
    },
    {
      basis: '整理参照',
      helpers: [{ ship_ids: [92], days: [4, 5] }],
      // 同一件装备的另一组二号舰，★0-5 的改修资材是 2 不是 1
      costs: { p1: { ...p1, screws: 2 }, p2, fuel: 20, ammo: 20, steel: 30, baux: 10 },
    },
  ]
  const html = improveCardHtml(setup)
  assert.equal(countOf(html, '<table class="mats"'), 2, '两套不同的消耗被合成了一张表')
  assert.equal(countOf(html, 'ak-plan-h'), 2, '两张表没标清各自是哪一套方案')
})

test('同一组里几个更新目标各有各的价钱 → 一个目标一行，行里点名', () => {
  const setup = 常规()
  setup.eo.improvement = [
    {
      basis: '整理参照',
      helpers: [{ ship_ids: [91], days: [1, 2] }],
      convert: { id_after: 3, lvl_after: 0 },
      costs: { p1, p2, conv, fuel: 20, ammo: 20, steel: 30, baux: 10 },
    },
    {
      basis: '整理参照',
      helpers: [{ ship_ids: [92], days: [4, 5] }],
      convert: { id_after: 4, lvl_after: 0 },
      costs: { p1, p2, conv: { ...conv, devmats: 11 }, fuel: 20, ammo: 20, steel: 30, baux: 10 },
    },
  ]
  const html = improveCardHtml(setup)
  assert.equal(countOf(html, '<table class="mats"'), 1)
  assert.match(html, /★max 更新 → 12\.7cm連装砲C型改三/)
  assert.match(html, /★max 更新 → 12\.7cm連装砲D型改二/)
  // 「含更新消耗」也跟着分目标，别把两笔账混成一笔
  assert.equal(countOf(html, '含更新消耗'), 2)
})

test('没给日程的方案保留告警句，位置就在它该在的那一行', () => {
  const setup = 常规()
  setup.eo.improvement = [{ basis: '整理参照', helpers: [], costs: { p1, p2 } }]
  const html = improveCardHtml(setup)
  // 09-02 文案审计改成「资料未收录改修日程与二号舰」。
  // 告警仍在 ak-row 中，09-13 起这一行也归入对应方案的 ak-imp 卡。
  assert.equal(divsOf(html, 'ak-imp').length, 1)
  assert.match(html, /<div class="ak-imp"><div class="ak-row"><span class="ak-warn">资料未收录改修日程与二号舰<\/span><\/div><\/div>/)
  assert.equal(countOf(html, 'class="ak-to"'), 0, '没有目标却画了空目标行')
  setup.eo.improvement[0].convert = { id_after: 3, lvl_after: 0 }
  const withTarget = improveCardHtml(setup)
  assert.match(withTarget, /<div class="ak-imp"><div class="ak-row"><span class="ak-warn">资料未收录改修日程与二号舰<\/span><\/div><div class="ak-to"><span class="to">[\s\S]*?<\/span><\/div><\/div>/)
})

test('整件都没有更新路线时说一句，不在每一行重复', () => {
  const setup = 常规()
  delete setup.eo.improvement[0].convert
  delete setup.eo.improvement[0].costs.conv
  const html = improveCardHtml(setup)
  assert.equal(countOf(html, '更新不可'), 0, '没有更新路线的件被说成了「更新不可」')
  assert.equal(divsOf(html, 'ak-imp').length, 1)
  assert.equal(countOf(html, 'class="ak-to"'), 0, '没有更新路线却画了空目标行')
  assert.match(html, /当前装备无更新路线 · ★max 为终点/)
})

test('逐星加成默认折起，来源角标挂在它自己的抬头旁', () => {
  const setup = 常规()
  setup.akashi = {
    items: { 2: { item_remodel: { 火力: Array.from({ length: 10 }, (_, i) => `+${i + 1}`) } } },
  }
  const html = improveCardHtml(setup)
  const grow = /<details class="ak-grow">([\s\S]*?)<\/details>/.exec(html)
  assert.ok(grow, '逐星加成没有做成可折叠段')
  assert.doesNotMatch(grow[0], /<details class="ak-grow" open/, '逐星加成默认是展开的')
  assert.match(grow[1], /<summary>逐星加成[\s\S]*credit-mark[\s\S]*<\/summary>/, '来源角标没挂在逐星加成抬头')
  assert.match(grow[1], /改修加成|火力/)
})

test('二号舰超过六艘折起来，折叠控件在舰名那一段里', () => {
  const setup = 常规()
  setup.ships = Object.fromEntries(
    Array.from({ length: 8 }, (_, i) => [200 + i, { api_id: 200 + i, api_name: `试舰${i}` }]),
  )
  setup.eo.improvement[0].helpers = [
    { ship_ids: Array.from({ length: 8 }, (_, i) => 200 + i), days: [1] },
  ]
  const html = improveCardHtml(setup)
  assert.match(
    html,
    /<div class="ak-imp"><div class="ak-row"><span class="who"><details class="improve-helper-more">[\s\S]*等 8 艘/,
    '折叠控件没落在 who 段里',
  )
  // 前缀传空时不许在舰名前留出那一格缩进
  assert.doesNotMatch(html, /<summary> /)
})

test('没收录与不可改修分得开，形制随新骨架', () => {
  const 未收录 = improveCardHtml({ equip: 装备[1], equips: 装备, eo: null, uncovered: true, coverageMax: 500 })
  assert.match(未收录, /改修工厂<span class="aux">暂无收录/)
  // 2026-08-26 文案清扫按裁决书缩成「（只到第 N 号）」；覆盖上限这个数照旧要说出来
  assert.match(未收录, /只到第 500 号/)
  assert.equal(countOf(未收录, 'style="'), 0)
  const 不可改 = improveCardHtml({ equip: 装备[1], equips: 装备, eo: null, uncovered: false })
  assert.match(不可改, /改修工厂<span class="aux">不可改修/)
  assert.match(不可改, /改修表暂无当前装备 · 不可改修/)
})

test('素材那一行报的是手上真能吞进去的件数（闲置且没上锁）', () => {
  const html = improveCardHtml({ ...常规(), unlocked: { 1: 9, 2: 0 } })
  const note = /<div class="ak-note"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? ''
  assert.match(note, /12\.7cm連装砲<\/a><\/span> <b>可用 9<\/b>/)
  assert.match(note, /<b class="bad">可用 0<\/b>/, '一件都没有的素材没标出来')
})
