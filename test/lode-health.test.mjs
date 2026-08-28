// 「矿脉健康度」那张卡的护栏。
//
// 2026-08-23 用户抓到这张卡**整体过时**：缺包那一行对着 13 个包只说一句
// 「用到它们的面板会显示『待补』」——哪个面板、哪一格一个字都没有，
// 而且那句话对 `map-intel` 根本不成立（常规海域三层早就随包，缺它只少 5 张活动图）。
//
// 所以这里盯的不是措辞，是**卡上的话与消费现实对不对得上**：
//  · 卡上列的缺包必须真的是运行时会读的（清单从 CONSUMED_LODES 派生，不许另抄一份）；
//  · 每一条都要说得出「缺了影响哪一格」；
//  · 「不随发行版」这个标记要与 `scripts/lib/bundled-lodes.mjs` 逐条对得上
//    （数据 × 数据交叉核对——两边打架正是这次过时的成因）。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import ids from '../dist/shared/lode-ids.js'

const {
  CONSUMED_LODES,
  CONSUMED_LODE_IDS,
  consumedLodeImpact,
  consumedLodeOf,
  isSelfFetchLode,
  manualOnlyReason,
} = ids

const yu = fs.readFileSync(new URL('../src/renderer/modules/yu.ts', import.meta.url), 'utf8')

test('每个会被读的包都说得出「缺了影响哪个面板的哪一格」', () => {
  assert.ok(CONSUMED_LODES.length > 30, `消费清单只有 ${CONSUMED_LODES.length} 条，像是被截断了`)
  const vague = []
  for (const entry of CONSUMED_LODES) {
    assert.ok(entry.id, '有一条没有 id')
    assert.ok(
      typeof entry.impact === 'string' && entry.impact.trim().length >= 8,
      `${entry.id} 没写清楚缺了影响哪一格`,
    )
    // 「相关功能会受影响」这类话等于没说——正是这次被抓到的那种写法
    if (/相关功能|部分功能|会显示「?待补」?$|受到影响$/.test(entry.impact)) vague.push(entry.id)
  }
  assert.deepEqual(vague, [], `这些条目的影响描述是通用话，等于没说：${vague.join('、')}`)
})

test('id 不重复，且查询函数只认这一张表', () => {
  assert.equal(new Set(CONSUMED_LODE_IDS).size, CONSUMED_LODE_IDS.length, '消费清单里有重复 id')
  assert.equal(consumedLodeOf('map-intel')?.id, 'map-intel')
  assert.equal(consumedLodeOf('不存在的包'), null)
  assert.equal(consumedLodeImpact('不存在的包'), '')
  assert.equal(isSelfFetchLode('不存在的包'), false)
})

test('「不随发行版」的标记与随包名单逐条对得上——两边打架就是这次过时的成因', async () => {
  const { BUNDLED_LODE_IDS } = await import('../scripts/lib/bundled-lodes.mjs')
  const bundled = new Set(BUNDLED_LODE_IDS)
  const wrong = []
  for (const entry of CONSUMED_LODES) {
    const shouldSelfFetch = !bundled.has(entry.id)
    const marked = entry.selfFetch === true
    if (shouldSelfFetch !== marked) {
      wrong.push(`${entry.id}（随包名单说${shouldSelfFetch ? '不随包' : '随包'}，这张表标的是${marked ? '不随包' : '随包'}）`)
    }
  }
  assert.deepEqual(wrong, [], `标记与随包名单对不上：${wrong.join('；')}`)
  // 方向性：确实存在不随包的那一批（全都随包的话这条标记就没有意义了）
  const selfFetch = CONSUMED_LODES.filter((entry) => entry.selfFetch)
  assert.ok(selfFetch.length > 5, `不随包的只有 ${selfFetch.length} 个，与实况（13 个）差太多`)
})

test('拉不回来的包不许被算进「拉一次就有」那一档', () => {
  const manual = CONSUMED_LODES.filter((entry) => entry.manualOnly)
  assert.ok(manual.length >= 1, 'kcnav-routing 那一条不见了')
  for (const entry of manual) {
    // 它同样不随包，但**建议跑 lodes:fetch 是错的**——卡上必须先按 manualOnly 分流
    assert.equal(entry.selfFetch, true, `${entry.id} 拉不回来却没标不随包`)
    assert.ok(manualOnlyReason(entry.id), `${entry.id} 没写为什么拉不回来`)
  }
  // 渲染层的分流顺序：manualOnly 先摘出去，剩下的才按随不随包分两档
  assert.match(yu, /const manual = missing\.filter\(\(row\) => manualOnlyReason\(row\.id\)\)/)
  assert.match(
    yu,
    /const selfFetch = missing\.filter\(\(row\) => !manualOnlyReason\(row\.id\) && isSelfFetchLode\(row\.id\)\)/,
  )
})

test('卡上的清单从消费表派生，不许另抄一份硬编码', () => {
  // 清单来源必须是 CONSUMED_LODE_IDS——另抄一份就会像这次一样各自过时
  assert.match(yu, /lodePackHealth\(CONSUMED_LODE_IDS, lodes, Date\.now\(\)\)/)
  // 影响文案也只从 shared 取，不在渲染层现编
  assert.match(yu, /consumedLodeImpact\(row\.id\)/)
  // 那句覆盖一切的旧话不许回潮
  assert.equal(
    yu.includes('用到它们的面板会显示「待补」'),
    false,
    '「缺 N 包 → 用到它们的面板会显示待补」那句通用话回潮了',
  )
})

test('map-intel 的影响写的是活动图，不再拿常规海域吓人', () => {
  const impact = consumedLodeImpact('map-intel')
  assert.match(impact, /活动/, 'map-intel 缺了只影响活动海域，这一点必须写出来')
  assert.match(impact, /常规/, '要写明常规海域不受影响，否则玩家仍旧以为掉落目录没了')
  assert.equal(isSelfFetchLode('map-intel'), true)
})

test('上游停更的包要说清真实含义，不是一句通用话打包收尾', () => {
  // kcwiki-quest-req 2022-04 就停了，卡上会点名它。但任务计数早已是四层链，
  // 它停更**不代表新任务数不出来**——这种情况要单独说，否则就是虚惊一场。
  const entry = consumedLodeOf('kcwiki-quest-req')
  assert.ok(entry?.upstreamNote, 'kcwiki-quest-req 没写停更的真实含义')
  assert.match(entry.upstreamNote, /644|后面三层|接住/, '停更说明没说清楚谁接住了新任务')
  // 渲染层要真的消费它，并保留通用兜底
  assert.match(yu, /consumedLodeOf\(row\.id\)\?\.upstreamNote/)
  assert.match(yu, /那之后加入游戏的内容不会出现在这份资料里/)
})

test('wikiwiki-routing 没有被顺手退役：它有 kcwiki 顶不上的两个角色', () => {
  // 2026-08-23 核过一轮「该不该退役」：**不该**。逐条量过——
  // ① 路线页的日文一手分歧表（并列三证据里的一证）；
  // ② 镝的「能动分歧（玩家手选去向）」判据：`能動分岐` 标记 20 条 / 6 张图，
  //    而 kcwiki-routing 全包 0 处。撤了它，2026-08-12 用户报的那个误标会复发。
  assert.ok(CONSUMED_LODE_IDS.includes('wikiwiki-routing'), 'wikiwiki-routing 被移出消费清单了')
  const di = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  assert.match(di, /queryLode\('wikiwiki-routing'\)/)
  assert.match(di, /能動分岐/, '能动分歧的判据没了')
  // 真包里那个标记确实只有 wikiwiki 有
  const read = (id) => {
    const file = new URL(`../assets/lodes/${id}.json`, import.meta.url)
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).data : null
  }
  const wiki = read('wikiwiki-routing')
  const kcwiki = read('kcwiki-routing')
  if (!wiki || !kcwiki) return // 缺包时跳过数据级比对，上面的结构断言仍然生效
  let active = 0
  for (const map of Object.values(wiki.maps ?? {})) {
    for (const node of map?.nodes ?? []) {
      for (const route of node?.routes ?? []) {
        if (/能動分岐/.test(`${route?.conditionJp ?? ''}`)) active += 1
      }
    }
  }
  assert.ok(active > 10, `wikiwiki-routing 里的能動分岐标记只剩 ${active} 条`)
  assert.equal(
    (JSON.stringify(kcwiki).match(/能動分岐|能动分歧/g) ?? []).length,
    0,
    'kcwiki-routing 现在也有这个标记了——那可以重新讨论退役',
  )
})

test('台词域那两个 wikiwiki 包还在干活，别按「已降为维护者侧」移出清单', () => {
  const ji = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  for (const id of ['wikiwiki-voice', 'wikiwiki-abyss-voice']) {
    assert.ok(CONSUMED_LODE_IDS.includes(id), `${id} 被移出消费清单了`)
    assert.match(ji, new RegExp(`queryLode\\('${id}'\\)`), `${id} 的运行时读取不见了`)
  }
  // 合流层确实还在用它们兜底（第③层：本形态与自译层都没占到的格）
  assert.match(ji, /wikiwikiVoiceLode\?\.data\?\.\[`\$\{id\}`\]/)
  assert.match(ji, /wikiwikiAbyssVoiceLode\?\.data\?\.\[`\$\{id\}`\]/)
})
