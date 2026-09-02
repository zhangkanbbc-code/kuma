import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { parseKcwikiSourceNote } from '../scripts/lib/kcwiki-map.mjs'
import {
  KCWIKI_DROP_ALIAS_EVIDENCE,
  KCWIKI_DROP_NAME_ALIASES,
  LEGACY_DROP_FORM_CORRECTIONS,
  RESOLVED_MAP_DROP_CONFLICTS,
  buildDropNameResolver,
  correctLegacyDropForm,
  buildMapDrops,
  dropCorroborationOf,
  mapDropConflictFingerprint,
  staleMapDropVerdicts,
} from '../scripts/lib/map-drops.mjs'

// 舰娘表的最小样本：够把解析器的四条路（中文名 / 日文名 / 折叠 / 别名）各走一遍，
// 外加一对**同写法不同号**的（Gloire 965 / Glorious 1022 中文名都叫「光荣」）。
const SHIP_TABLE = {
  a: { ID: 1, 中文名: '睦月', 日文名: '睦月' },
  b: { ID: 2, 中文名: '如月', 日文名: '如月' },
  c: { ID: 637, 中文名: '第四号海防舰', 日文名: '第四号海防艦' },
  d: { ID: 86, 中文名: '比睿', 日文名: '比叡' },
  e: { ID: 965, 中文名: '光荣', 日文名: 'Gloire' },
  f: { ID: 1022, 中文名: '光荣', 日文名: 'Glorious' },
  g: { ID: 163, 中文名: '丸优', 日文名: 'まるゆ' },
  h: { ID: 101, 中文名: '木曾', 日文名: '木曾' },
  i: { ID: 645, 中文名: '宗谷灯塔补给', 日文名: '宗谷灯台補給' },
  j: { ID: 699, 中文名: '宗谷特务舰', 日文名: '宗谷特務艦' },
  // 2026-08-23 那一轮裁决里的一条（1-3/J），下面用它跑真指纹
  k: { ID: 953, 中文名: '朝日', 日文名: '朝日' },
}

const dropPage = (rows) =>
  `<div class="mw-parser-output"><table class="wikitable">
    <tr><th>海域点</th><th>掉落列表</th></tr>
    ${rows
      .map(
        ([node, names]) =>
          `<tr><td><p>${node}</p></td><td>${names
            .map((name) => `<a href="/wiki/x" title="${name}">${name}</a>`)
            .join('')}</td></tr>`,
      )
      .join('')}
  </table></div>`

const legacyMap = (nodes) => ({
  '1-1': {
    source: 'wikiwiki',
    sourceUrl: 'u',
    checkedAt: '2026-08-12',
    revision: '1',
    nodes,
  },
})

const legacyNode = (ships, emptyDrop = 'unknown') => ({
  ships,
  emptyDrop,
  enemyComps: [],
})

test('kcwiki 页脚的来源自述抓得到，且只取到「为准」为止', () => {
  const html = `<div class="mw-references-wrap"><ol class="references">
    <li id="cite_note-1"><span class="mw-cite-backlink"><a href="#x">↑</a></span>
    <span class="reference-text">主要数据来源为<a class="external text" href="https://wikiwiki.jp/kancolle/">日wiki</a><br />补充数据来自<a class="external text" href="http://kancolle.wikia.com/">英文wikia</a><br />如果有冲突 默认以日wiki为准<br />英文wikia的补充资料会使用<font color="grey"><b>灰色</b></font>进行标注</span></li>
  </ol></div>`
  const note = parseKcwikiSourceNote(html)
  // 这一行是掉落域算票独立性的**唯一硬证据**：kcwiki 自己说主要转录自日站，
  // 所以「两 wiki 都这么说」不是两张独立票。原文照录，不许改写成我们的结论。
  assert.equal(note, '主要数据来源为 日wiki 补充数据来自 英文wikia 如果有冲突 默认以日wiki为准')
  assert.ok(!note.includes('灰色'), '后半段讲颜色标注约定，与掉落无关，不该带进来')
  assert.equal(parseKcwikiSourceNote('<div>没有引用块</div>'), null)
})

test('中文舰名解号：中文名 / 日文名 / 异体折叠 / 别名四条路，撞车的一律不猜', () => {
  const resolve = buildDropNameResolver(SHIP_TABLE)
  assert.deepEqual(resolve('睦月'), { id: 1, via: 'name' })
  // kcwiki 掉落表里混着日文写法（暁 / 千歳 / 金剛 / 鈴谷 / 羽黒 …）
  assert.deepEqual(resolve('比叡'), { id: 86, via: 'name' })
  // 繁体：號 → 号、艦 → 舰（cjk-fold 已有这两对）
  assert.deepEqual(resolve('第四號海防艦'), { id: 637, via: 'name' })
  // 别名：写法与舰娘表对不上的那几个
  assert.deepEqual(resolve('丸输'), { id: 163, via: 'alias' })
  assert.deepEqual(resolve('木曽'), { id: 101, via: 'alias' })
  // 三个形态同名，别名钉链首 699（645/650 都是改造而来，掉不出来）
  assert.deepEqual(resolve('宗谷'), { id: 699, via: 'alias' })
  // 一个写法两个号 = 半截的号比没有更危险，返回 null 让调用方硬错
  assert.deepEqual(resolve('光荣'), { id: null, via: 'ambiguous' })
  assert.deepEqual(resolve('查无此舰'), { id: null, via: 'missing' })
})

test('掉落汇编：单源照收不丢，两 wiki 一致只算同源转录，账本票才升多源一致', () => {
  const pages = new Map([
    ['1-1', { html: dropPage([['A', ['睦月', '如月']]]), title: '1-1' }],
  ])
  const legacy = legacyMap({
    // 睦月两边都有；第四号海防舰只有现包有（单源，照收不丢）
    A: legacyNode([{ id: 1 }, { id: 637 }]),
  })
  const ledger = new Map([['1-1', { ids: new Set([1]), sWins: 0, sWinsWithoutDrop: 0 }]])
  const { data, stats, unresolved, warnings } = buildMapDrops({
    pages,
    legacy,
    ledger,
    shipTable: SHIP_TABLE,
    checkedAt: '2026-08-22',
    codes: ['1-1'],
  })
  assert.deepEqual(unresolved, [])
  assert.deepEqual(warnings, [])
  const ships = data.maps['1-1'].nodes.A.ships
  assert.deepEqual(
    ships.map((ship) => [ship.id, ship.votes]),
    [
      [1, ['kcwiki', 'wikiwiki', 'ledger']],
      [2, ['kcwiki']],
      [637, ['wikiwiki']],
    ],
  )
  // 四档口径：账本票在场才算真的两条独立路径；两 wiki 一致只是同一张票抄了两遍
  assert.equal(dropCorroborationOf(ships[0]), '多源一致')
  assert.equal(dropCorroborationOf(ships[1]), '单源待印证')
  assert.equal(dropCorroborationOf(ships[2]), '单源待印证')
  assert.equal(dropCorroborationOf({ votes: ['kcwiki', 'wikiwiki'] }), '同源转录')
  assert.equal(stats.legacyOnly, 1, '现包独有的必须照收（5-6 不归零就靠这一条）')
  assert.equal(stats.kcwikiOnly, 1)
  assert.equal(stats.multi + stats.transcribed + stats.single, stats.ships)
})

test('掉落汇编：解不出的中文名逐条报回去，绝不静默丢', () => {
  const pages = new Map([
    ['1-1', { html: dropPage([['A', ['睦月', '光荣', '查无此舰']]]), title: '1-1' }],
  ])
  const { data, unresolved } = buildMapDrops({
    pages,
    legacy: legacyMap({ A: legacyNode([{ id: 1 }]) }),
    shipTable: SHIP_TABLE,
    checkedAt: '2026-08-22',
    codes: ['1-1'],
  })
  // 2026-08-11「杉@1-5 被静默丢掉」的教训：解不出就是少一条线索，界面上看不出异常。
  // 这一层如实报回去，出包那一步据此硬错（scripts/fetch-lodes.mjs 的 parseMapDrops）。
  assert.deepEqual(
    unresolved.map((entry) => [entry.name, entry.via, entry.at]).sort(),
    [
      ['光荣', 'ambiguous', ['1-1/A']],
      ['查无此舰', 'missing', ['1-1/A']],
    ].sort(),
  )
  // 解不出的那两条不会混进包里冒充一个号
  assert.deepEqual(data.maps['1-1'].nodes.A.ships.map((ship) => ship.id), [1])
})

test('空掉落标记只从现包票取（不硬编），限定期那三格一格都不进这个包', () => {
  const pages = new Map([['1-1', { html: dropPage([['C', ['睦月']]]), title: '1-1' }]])
  const { data } = buildMapDrops({
    pages,
    legacy: legacyMap({
      C: legacyNode(
        [{ id: 1, limited: { from: '2025-10-29', until: null, lastConfirmedAt: '2026-08-22' } }],
        'confirmed',
      ),
      D: legacyNode([{ id: 2 }]),
    }),
    shipTable: SHIP_TABLE,
    checkedAt: '2026-08-22',
    codes: ['1-1'],
  })
  assert.equal(data.maps['1-1'].nodes.C.emptyDrop, 'confirmed')
  assert.deepEqual(data.maps['1-1'].nodes.C.emptyDropVotes, ['wikiwiki'])
  assert.equal(data.maps['1-1'].nodes.D.emptyDrop, 'unknown')
  // 限定期仍归底座 map-intel 管（批次 4 才换），装配时从底座带过去。
  // 混进这个包 = 两处各说各的窗口，而且形状对得上、一条报错都不会有。
  for (const node of Object.values(data.maps['1-1'].nodes)) {
    for (const ship of node.ships) {
      assert.deepEqual(Object.keys(ship).sort(), ['id', 'votes'])
    }
  }
})

test('掉落域的待裁项：只收会互相否定的那几类，「一方沉默」不算冲突', () => {
  const pages = new Map([
    ['1-1', { html: dropPage([['A', ['睦月']], ['Z', ['如月']]]), title: '1-1' }],
  ])
  const { conflicts } = buildMapDrops({
    pages,
    legacy: legacyMap({
      // 现包说「只在限定期掉」，kcwiki 把它列进常规掉落表 → 玩家会当场吃亏的一格
      A: legacyNode([
        {
          id: 1,
          limitedOnly: true,
          limited: { from: '2024-01-01', until: null, lastConfirmedAt: '2026-08-22' },
        },
      ]),
      // B 只有现包收 → 覆盖差，不该进台账
      B: legacyNode([{ id: 2 }]),
    }),
    shipTable: SHIP_TABLE,
    checkedAt: '2026-08-22',
    codes: ['1-1'],
  })
  const kinds = conflicts.map((conflict) => `${conflict.kind}@${conflict.map}/${conflict.node}`)
  assert.deepEqual(kinds.sort(), ['limited-vs-plain@1-1/A', 'node-missing@1-1/Z'])
  assert.ok(!kinds.some((kind) => kind.includes('/B')), '一方收录另一方沉默不是冲突')
  // 指纹自失效：上游改了那一格，旧裁决作废
  const first = mapDropConflictFingerprint(conflicts[0])
  assert.notEqual(
    first,
    mapDropConflictFingerprint({ ...conflicts[0], detail: { ...conflicts[0].detail, x: 1 } }),
  )
})

test('每条裁决都写得出裁给谁、哪天裁的、凭什么，且指纹不重复', () => {
  const seen = new Set()
  for (const one of RESOLVED_MAP_DROP_CONFLICTS) {
    assert.ok(one.verdict?.length, `${one.fingerprint} 没写裁给谁`)
    assert.match(one.decidedAt ?? '', /^\d{4}-\d{2}-\d{2}$/, `${one.fingerprint} 没写裁定日期`)
    assert.ok(one.why?.length > 30, `${one.fingerprint} 的裁语是空话`)
    // 指纹必须是这一域真算得出来的形状，不然它永远认领不上，而这一点不会有任何报错表现
    assert.match(one.fingerprint, /^[a-z-]+@\d+-\d+\/[A-Z-]+\[\d*\]\{/, `${one.fingerprint} 不是这一域的指纹形状`)
    assert.ok(!seen.has(one.fingerprint), `指纹重复：${one.fingerprint}`)
    seen.add(one.fingerprint)
  }
  // 一条都认领不上时全表都是无主裁决——「有裁决作废了」必须报得出来，
  // 不然上游改一格只表现成「又多了几条待裁」，谁也看不出是裁决失效了
  assert.deepEqual(staleMapDropVerdicts([]), [...RESOLVED_MAP_DROP_CONFLICTS])
})

test('裁过的待裁项照旧进台账、只多带裁语；上游改了那一格就重新变回未裁项', () => {
  const decided = RESOLVED_MAP_DROP_CONFLICTS.find((one) =>
    one.fingerprint.startsWith('limited-vs-plain@1-3/J[953]'),
  )
  assert.ok(decided, '1-3/J 朝日那一条裁决不在表里')

  const pages = new Map([['1-3', { html: dropPage([['J', ['朝日']]]), title: '1-3' }]])
  const legacyAt = (from) => ({
    '1-3': {
      source: 'wikiwiki',
      sourceUrl: 'u',
      checkedAt: '2026-08-12',
      revision: '1',
      nodes: {
        J: legacyNode([
          { id: 953, limitedOnly: true, limited: { from, until: null, lastConfirmedAt: '2026-06-26' } },
        ]),
      },
    },
  })
  const run = (from) =>
    buildMapDrops({
      pages,
      legacy: legacyAt(from),
      shipTable: SHIP_TABLE,
      checkedAt: '2026-08-23',
      codes: ['1-3'],
    }).conflicts.find((conflict) => conflict.kind === 'limited-vs-plain')

  const closed = run('2025-12-18')
  // 结案 ≠ 删条目：冲突每轮重算，删掉只会下一轮又冒出来当新的待裁项，而痕迹没了
  assert.equal(mapDropConflictFingerprint(closed), decided.fingerprint)
  assert.equal(closed.verdict, 'limited')
  assert.equal(closed.decidedAt, '2026-08-23')
  assert.ok(closed.why.includes('艦ログ'), '裁语里没写第二票是谁给的')
  // 裁决不改数：台账那一条照旧是「只在限定期掉」，不因为 kcwiki 列了它就摘掉标记
  assert.equal(staleMapDropVerdicts([closed]).length, RESOLVED_MAP_DROP_CONFLICTS.length - 1)

  // 上游把起始日改了 → 指纹变了 → 旧裁决认领不上，条目重新以**未裁**形态出现
  const moved = run('2025-12-19')
  assert.equal(moved.verdict, undefined, '指纹都变了，旧裁决还在给这一格背书')
  assert.equal(staleMapDropVerdicts([moved]).length, RESOLVED_MAP_DROP_CONFLICTS.length)
})

const conflictLedger = new URL('../assets/review/map-drops-conflicts.json', import.meta.url)
test('待裁台账：2026-08-23 裁的那 7 条已结案，不再以未裁形态挂着', {
  skip: fs.existsSync(conflictLedger) ? false : '缺待裁台账',
}, () => {
  const conflicts = JSON.parse(fs.readFileSync(conflictLedger, 'utf8')).conflicts
  const limited = conflicts.filter((one) => one.kind === 'limited-vs-plain')
  assert.equal(limited.length, 7, `limited-vs-plain 从 7 条变成了 ${limited.length} 条`)
  for (const one of limited) {
    assert.equal(one.verdict, 'limited', `${one.map}/${one.node}#${one.mstId} 还挂着未裁`)
    assert.equal(one.decidedAt, '2026-08-23')
    // 台账里那一格的裁语要与源码那张表逐字一致——各写各的就会两边说不同的话
    const source = RESOLVED_MAP_DROP_CONFLICTS.find((row) => row.fingerprint === one.fingerprint)
    assert.ok(source, `${one.fingerprint} 在源码裁决表里找不到`)
    assert.equal(one.why, source.why)
  }
  assert.deepEqual(
    limited.map((one) => `${one.map}/${one.node}#${one.mstId}`),
    ['1-3/J#953', '1-4/L#527', '1-4/L#636', '1-4/L#699', '1-4/L#900', '4-4/K#120', '5-5/S#633'],
  )
  // 空掉落那 3 条这一改没裁，照旧挂着——别把「都结案了」当成这一域的常态
  assert.ok(
    conflicts.some((one) => one.kind.startsWith('empty-drop') && !one.verdict),
    '未裁项一条都不剩了？那多半是有人把条目删了而不是裁了',
  )
})

test('账本的空掉落旁证只钉到图，不替某个点做判断', () => {
  const pages = new Map([['1-1', { html: dropPage([['A', ['睦月']]]), title: '1-1' }]])
  const { conflicts, data } = buildMapDrops({
    pages,
    legacy: legacyMap({ A: legacyNode([{ id: 1 }]) }),
    // S 胜够样本且见过空手，而现包一个点都没标 → 待核，但**不改包里的标记**
    ledger: new Map([['1-1', { ids: new Set(), sWins: 40, sWinsWithoutDrop: 6 }]]),
    shipTable: SHIP_TABLE,
    checkedAt: '2026-08-22',
    codes: ['1-1'],
  })
  const candidate = conflicts.find((conflict) => conflict.kind === 'empty-drop-candidate')
  assert.ok(candidate, '账本见过空掉落却一个点都没标，要进台账')
  assert.equal(candidate.node, null, '账本票钉不到点，node 必须留空')
  assert.equal(data.maps['1-1'].nodes.A.emptyDrop, 'unknown', '待核项不许自动改包里的标记')
})

// ---- 本机确认掉落层（第一方一手，与离线目录并列不合并）----

test('本机确认掉落：按次数聚合，S 胜空手单独数', async () => {
  const m = await import('../dist/main/mg/local-drops.js')
  const { aggregateLocalDrops, EMPTY_LOCAL_DROPS } = m.default ?? m
  const samples = [
    { ts: 300, cell: 5, rank: 'S', dropMst: 1 },
    { ts: 100, cell: 5, rank: 'S', dropMst: 1 },
    { ts: 200, cell: 5, rank: 'S', dropMst: null },
    { ts: 250, cell: 5, rank: 'A', dropMst: null },
    { ts: 400, cell: 9, rank: 'S', dropMst: 2 },
  ]
  const all = aggregateLocalDrops(samples)
  assert.equal(all.battles, 5)
  assert.equal(all.sWins, 4)
  // 只在 S 胜里数空手：评级低本来就可能不掉，拿全部战斗当分母会把「运气不好」
  // 说成「这一点存在空掉落」
  assert.equal(all.sWinsWithoutDrop, 1)
  assert.deepEqual(all.ships, [
    { mstId: 1, count: 2, firstTs: 100, lastTs: 300, cells: [{ cell: 5, count: 2 }] },
    { mstId: 2, count: 1, firstTs: 400, lastTs: 400, cells: [{ cell: 9, count: 1 }] },
  ])

  const one = aggregateLocalDrops(samples, 5)
  assert.equal(one.battles, 4)
  assert.deepEqual(one.ships.map((ship) => ship.mstId), [1])

  assert.deepEqual(aggregateLocalDrops([]), EMPTY_LOCAL_DROPS)
  // 没打过的点是空，不是「这一点不掉」——调用方据此说「还没有你的记录」
  assert.deepEqual(aggregateLocalDrops(samples, 99).ships, [])
})

test('本机确认掉落：逐点计数在装配期算好，且逐条之和恒等于那一行的次数', async () => {
  const m = await import('../dist/main/mg/local-drops.js')
  const { aggregateLocalDrops } = m.default ?? m
  const cellsModule = await import('../dist/shared/local-drop-cells.js')
  const { localDropCellsText } = cellsModule.default ?? cellsModule
  const samples = [
    { ts: 10, cell: 3, rank: 'S', dropMst: 7 },
    { ts: 20, cell: 8, rank: 'A', dropMst: 7 },
    { ts: 30, cell: 3, rank: 'S', dropMst: 7 },
    { ts: 40, cell: 3, rank: 'S', dropMst: 7 },
    { ts: 50, cell: 8, rank: 'S', dropMst: 7 },
  ]
  const ship = aggregateLocalDrops(samples).ships[0]
  // 捞得多的点在前，同次数按点号——悬停第一眼就是「最该再去的那个点」
  assert.deepEqual(ship.cells, [
    { cell: 3, count: 3 },
    { cell: 8, count: 2 },
  ])
  // 对账：逐点之和不许与行里的「捞到 N 次」分家
  assert.equal(
    ship.cells.reduce((sum, one) => sum + one.count, 0),
    ship.count,
    '逐点计数与总次数对不上',
  )

  // 字母反查是展示侧的事：认不出的点照实写 #编号，不猜一个字母出来
  const letters = { 3: 'B', 8: 'F' }
  assert.equal(
    localDropCellsText(ship.cells, (cell) => letters[cell] ?? `#${cell}`),
    'B 点 ×3 · F 点 ×2',
  )
  assert.equal(localDropCellsText(ship.cells, (cell) => `#${cell}`), '#3 点 ×3 · #8 点 ×2')
  // 一条都没有 → 空串。调用方据此不挂 title，而不是挂个空悬停框
  assert.equal(localDropCellsText([], () => 'B'), '')
  assert.equal(localDropCellsText(undefined, () => 'B'), '')
  assert.equal(localDropCellsText(null, () => 'B'), '')
  assert.equal(localDropCellsText([{ cell: 3, count: 0 }], () => 'B'), '')

  // 单点的图不该被写成「捞到 3 次」却只列出一次
  const single = aggregateLocalDrops(samples, 3).ships[0]
  assert.deepEqual(single.cells, [{ cell: 3, count: 3 }])
  assert.equal(single.count, 3)
})

test('点位悬停只加悬停，不改「本机确认」那一行的结构', () => {
  const ji = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const pool = ji.slice(ji.indexOf('const localDropPoolHtml'), ji.indexOf('const confirmedDropPoolHtml'))
  assert.ok(pool.length > 0, '找不到「本机确认」那一段')
  // 三列还是三列：名字 / 次数 / 最近一次
  assert.match(pool, /class="dp-n"/)
  assert.match(pool, /class="dp-w"/)
  assert.match(pool, /class="dp-got"/)
  // 点位挂在次数那一格的 title 上，不另起一列、不塞进行里
  assert.match(pool, /localDropCellsText\(drop\.cells, letterOf\)/)
  assert.match(pool, /cells \? ` title="\$\{esc\(cells\)\}"` : ''/)
  // 装配期算好、渲染期零扫描：这一段不许自己再去翻样本
  assert.doesNotMatch(pool, /aggregateLocalDrops|queryLocalDrops/)
})

test('本机确认掉落与离线目录并列显示，不合并成一份名单', () => {
  const di = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  const ji = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  // 出击卡：与旁边的敌方编队卡同一个排法（本地实测 → 确认目录）
  const card = di.slice(di.indexOf('const dropPoolCardHtml'))
  assert.ok(
    card.indexOf('本地实测') < card.indexOf('确认目录'),
    '出击卡的掉落两段顺序该与敌方编队卡一致',
  )
  // 批次 4 起还要把 (图, 点) 传进去——本机确认层要按限定期窗口判「这条还算不算当下的线索」
  assert.match(card, /myDropsHtml\(s, cataloged, mapKey, letter\)/)
  // 海域详情：与舰娘「获取」页同族——离线目录在前、本地遭遇志在后
  const pool = ji.slice(ji.indexOf('const confirmedDropPoolHtml'), ji.indexOf('const dropPoolHtml'))
  assert.ok(
    pool.indexOf('mi-drop-list') < pool.indexOf('localDropPoolHtml'),
    '海域详情该是离线目录在前、本机确认在后',
  )
  // 目录没收这张图时不显示空列表，本机遭遇志照列。
  //「；下面是你自己的遭遇志」这半句是 UI 自我解说，按 2026-08-26 文案清扫裁定删；
  // 它描述的那条行为由下面这一行钉死（遭遇志段照旧接在后面），语义不放松。
  const fallback = ji.slice(ji.indexOf('const dropPoolHtml'), ji.indexOf('let voiceAudio'))
  assert.match(fallback, /当前海域资料尚未收录/)
  assert.match(fallback, /localDropPoolHtml\(code, mapId, new Set\(\)\)/)
  // 「两者证据强度不同，不合并」这句口径按 2026-08-26 文案清扫裁定（族 4）删了。
  // 「不合并」这条行为不靠那句话守——它就是本测开头钉的那件事：离线目录与本机
  // 遭遇志各走各的渲染函数、各有各的抬头，先后并列而不是并进同一份名单。
  // 下面再加一道，防有人把两份数据在数据层就揉成一个数组：
  assert.match(ji, /const localDropPoolHtml = /)
  assert.doesNotMatch(ji, /\[\.\.\.allShips, \.\.\.local/, '离线目录与本机遭遇志被揉成一份名单了')
})

test('每条别名都要有锚定证据：号必须在现包里真的出现过', {
  skip: fs.existsSync(new URL('../assets/lodes/map-intel.json', import.meta.url))
    ? false
    : '缺 map-intel 矿脉包',
}, () => {
  const maps = JSON.parse(
    fs.readFileSync(new URL('../assets/lodes/map-intel.json', import.meta.url), 'utf8'),
  ).data.maps
  const known = new Set()
  for (const entry of Object.values(maps)) {
    for (const node of Object.values(entry.nodes ?? {})) {
      for (const ship of node.ships ?? []) known.add(ship.id)
    }
  }
  for (const [name, id] of Object.entries(KCWIKI_DROP_NAME_ALIASES)) {
    const evidence = KCWIKI_DROP_ALIAS_EVIDENCE[name]
    assert.ok(evidence, `别名「${name}」没写判据`)
    assert.ok(evidence.why?.length > 10, `别名「${name}」的判据是空话`)
    if (evidence.kind === 'legacy-anchor') {
      // 别名是「这个写法指哪个号」的人工判断，判据是现包在同一格也指着这个号。
      // 号在现包里根本没出现过 = 凭印象填的，那正是这条护栏要拦的。
      assert.ok(known.has(id), `别名「${name}」→ ${id} 在现包里找不到锚点`)
      continue
    }
    // user-verdict：现包那一票本身就是错的，**不能**要求它锚得上——
    // 要求锚得上正好会把错值锁死。改钉的是「现包原来指着哪个号」，那个号必须在现包里，
    // 否则这条裁决说的就不是现包里真实存在的那一格。
    assert.equal(evidence.kind, 'user-verdict', `别名「${name}」的判据种类不认得`)
    assert.match(evidence.decidedAt ?? '', /^\d{4}-\d{2}-\d{2}$/, `别名「${name}」没写裁定日期`)
    assert.ok(
      known.has(evidence.supersedes),
      `别名「${name}」说要改钉 ${evidence.supersedes}，但现包里根本没有那个号`,
    )
    assert.notEqual(evidence.supersedes, id, `别名「${name}」改钉了个寂寞`)
  }
})

test('现包记错形态的号逐条改钉，别名与现包票两边同时改', () => {
  // 只改别名不改现包票的话，同一个点会同时冒出新旧两个号，界面上看着像掉两条船。
  assert.ok(LEGACY_DROP_FORM_CORRECTIONS.length > 0)
  for (const one of LEGACY_DROP_FORM_CORRECTIONS) {
    assert.ok(Number.isInteger(one.from) && Number.isInteger(one.to) && one.from !== one.to)
    assert.ok(one.why?.length > 10, `改钉 ${one.from}→${one.to} 没写判据`)
    assert.match(one.decidedAt ?? '', /^\d{4}-\d{2}-\d{2}$/)
    assert.equal(correctLegacyDropForm(one.from), one.to)
  }
  assert.equal(correctLegacyDropForm(163), 163, '不在表里的号原样返回')
  // 宗谷这一条：别名与现包改钉必须指向同一个号，否则两条路各走各的
  assert.equal(KCWIKI_DROP_NAME_ALIASES.宗谷, correctLegacyDropForm(KCWIKI_DROP_ALIAS_EVIDENCE.宗谷.supersedes))
})
