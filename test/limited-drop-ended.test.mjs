// 「已终了的常规图限定邂逅」这一档（2026-08-28）。
//
// 触发案例：缺舰清单给鲑鱼（Salmon，891）标 1-2 E 可捞，实际那是 2024/12/26【年の瀬】
// 的期间限定邂逅，上游早把它划了删除线＝已终了。艦素为什么会指这条死路：
//   · kcwiki 的常规掉落表不区分限定/常驻，鲑鱼混编在 1-2 的普通条目里；
//   · 上游对照只读页面顶上那张「海域別リスト」，而那张表**只有还开着的**——
//     一条限定终了之后就从表里消失，于是只看得见「不再列出」（缺席），
//     永远看不见「它说自己终了了」（断言）。
//
// 这一域的错法照例都不报错：删除线判丢了只是把死路当活路继续指，
// 判过头了只是把还能捞的藏起来。所以判据尽量**真跑**，不去匹配源码文本
//（共享记忆 source-pattern-guards-miss-logic-bugs）；渲染层脱不开 Electron，
// 那一段退回结构断言，钉的是接线与文案，不是逻辑。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { htmlText, parseLimitedBatches } from '../scripts/map-intel.mjs'
import limitedWindow from '../dist/shared/limited-window.js'
import mapIntel from '../dist/shared/map-intel.js'

const {
  isActiveLimitedWindow,
  isEndedLimitedWindow,
  limitedWindowPhase,
  limitedWindowText,
} = limitedWindow
const {
  applyMapDropWindows,
  applyMapIntelCatalog,
  confirmedDropSitesOf,
  endedDropSitesOf,
  mapIntelNode,
} = mapIntel

const TODAY = '2026-08-28'

// ---------------------------------------------------------------------------
// ① 删除线解析：判据必须落在原始字节上
// ---------------------------------------------------------------------------

const AREA = '<td><a href="/kancolle/%E9%8E%AE%E5%AE%88%E5%BA%9C%E6%B5%B7%E5%9F%9F" title="鎮守府海域" class="rel-wiki-page">鎮守府海域</a></td>'
const shipCell = (name, struck) => {
  const link = `<a href="/kancolle/${name}" title="${name}" class="rel-wiki-page">${name}</a>`
  return `<td><strong>${struck ? `<del>${link}</del>` : link}</strong></td>`
}
const page = (heading, rows) =>
  `<h2 id="h2_content_1_1">${heading}  <a class="anchor_super" name="z1"></a></h2>\n` +
  `<div class="h-scrollable"><table><tbody>` +
  `<tr><th>海域</th><th>エリア</th><th>ドロップ対象</th></tr>${rows}</tbody></table></div>`
const row = (point, cells) => `<tr>${AREA}<td>${point}</td>${cells}</tr>`

const HEADING = '【年の瀬】期間限定邂逅 (2024/12/26～一部継続中)'
const find = (result, ship) => result.entries.find((one) => one.ship === ship)

test('删除线是终了的判据，而它只活在原始字节里', () => {
  const struck = parseLimitedBatches(page(HEADING, row('1-2-E(ボス)', shipCell('Salmon', true))))
  const plain = parseLimitedBatches(page(HEADING, row('1-2-E(ボス)', shipCell('Salmon', false))))

  // 正钉：划掉了 = 已终了，且说得出是哪一批、哪天开的
  const ended = find(struck, 'Salmon')
  assert.equal(ended.ended, true, '带删除线的条目没被判成已终了')
  assert.deepEqual([ended.map, ended.node], ['1-2', 'E'])
  assert.equal(ended.from, '2024-12-26')
  assert.equal(ended.label, '年の瀬')
  assert.ok(ended.reasons.includes('del'), '没有记下「凭删除线」这个理由')

  // 反钉：同一格没有删除线就是还在掉。少了这一条，「一律判终了」也能让上一条过
  assert.equal(find(plain, 'Salmon').ended, false, '没有删除线的条目被误判成终了')

  // 要害：两者**取完文本后一模一样**。任何经过取文本/转述的层都分不出它们，
  // 判据一旦挪到 htmlText 之后，上面那两条会同时变成「还在掉」而且不报错。
  const cellOf = (html) => html.slice(html.indexOf('<strong>'), html.indexOf('</strong>'))
  assert.equal(
    htmlText(cellOf(shipCell('Salmon', true))),
    htmlText(cellOf(shipCell('Salmon', false))),
    '这两格取文本后本该无法区分——前提变了，这条测试的意义要重估',
  )
})

test('小节标题的两种终了写法：舰名后「（終了）」、以及「～某舰のみ継続中」', () => {
  const both = row('2-2-K(ボス)', `${shipCell('Zara', false)}`)
  const done = parseLimitedBatches(
    page('Samuel B.Roberts（終了）、Zara（終了）、迅鯨 (2022/8/04～一部継続中)', both),
  )
  assert.equal(find(done, 'Zara').ended, true, '标题里写了「（終了）」却没判终了')
  assert.ok(find(done, 'Zara').reasons.includes('heading-終了'))

  // 反钉：同一批里没被点名的那条照旧在掉
  const alive = parseLimitedBatches(
    page('Samuel B.Roberts（終了）、迅鯨 (2022/8/04～一部継続中)', row('2-2-K(ボス)', shipCell('迅鯨', false))),
  )
  assert.equal(find(alive, '迅鯨').ended, false, '没被点名的条目被连坐判成终了')

  // 「～山風のみ継続中」= 这一批只剩山風，其余全终了
  const only = parseLimitedBatches(
    page('山風、対馬 (2019/09/30～山風のみ継続中)', row('1-4-L(ボス)', shipCell('対馬', false)) + row('1-3-J(ボス)', shipCell('山風', false))),
  )
  assert.equal(find(only, '対馬').ended, true, '「のみ継続中」没把其余条目判成终了')
  assert.ok(find(only, '対馬').reasons.includes('heading-のみ継続中'))
  assert.equal(find(only, '山風').ended, false, '被点名「のみ継続中」的那条反被判成终了')
})

test('一格里多条舰各划各的，不许连坐也不许漏掉', () => {
  // 「天津風、<del>浦風</del>、<del>巻雲</del>のドロップが確認されたポイント」这种排法：
  // 舰名在表**前面**的 <li> 里，一格三条、状态各不相同。
  // 只取最后一条（曾经的写法）会把天津風与浦風整条丢掉，症状是单子上安静少两行。
  const li =
    `<ul class="list1"><li>` +
    `<a href="/kancolle/%E5%A4%A9%E6%B4%A5%E9%A2%A8" title="天津風" class="rel-wiki-page">天津風</a>、` +
    `<del><a href="/kancolle/%E6%B5%A6%E9%A2%A8" title="浦風" class="rel-wiki-page">浦風</a></del>、` +
    `<del><a href="/kancolle/%E5%B7%BB%E9%9B%B2" title="巻雲" class="rel-wiki-page">巻雲</a></del>` +
    `のドロップが確認されたポイント\n` +
    `<div class="h-scrollable"><table><tbody><tr><th>海域</th><th>ドロップエリア</th></tr>` +
    `<tr>${AREA}<td>2-2-K(ボス)</td></tr></tbody></table></div></li></ul>`
  const got = parseLimitedBatches(
    `<h2 id="h2_content_1_1">批次 (2022/8/04～一部継続中)  <a class="anchor_super" name="z1"></a></h2>\n${li}`,
  )
  assert.deepEqual(
    got.entries.map((one) => [one.ship, one.ended]).sort(),
    [['天津風', false], ['巻雲', true], ['浦風', true]].sort(),
    '同一个 <li> 里的多条舰没有各判各的',
  )
})

test('<li> 上写明的终了日要收下——有日子的比只说「终了了」结实', () => {
  const li =
    `<ul class="list1"><li><del><a href="/kancolle/Zara" title="Zara" class="rel-wiki-page">Zara</a></del>` +
    `のドロップが確認されたポイント（2024/5/29終了）\n` +
    `<div class="h-scrollable"><table><tbody><tr><th>海域</th><th>ドロップエリア</th></tr>` +
    `<tr>${AREA}<td>7-3-P(第2ボス)</td></tr></tbody></table></div></li></ul>`
  const got = parseLimitedBatches(
    `<h2 id="h2_content_1_1">批次 (2022/8/04～一部継続中)  <a class="anchor_super" name="z1"></a></h2>\n${li}`,
  )
  assert.equal(find(got, 'Zara').ended, true)
  assert.equal(find(got, 'Zara').endedAt, '2024-05-29', '上游写明的终了日没收下')
})

// ---------------------------------------------------------------------------
// ② 窗口三态：「说它终了」与「不再列出」是两回事
// ---------------------------------------------------------------------------

const win = (over = {}) => ({
  from: '2024-12-26',
  until: null,
  lastConfirmedAt: '2024-12-26',
  ...over,
})

test('ended_undated 是断言、end_pending 是缺席，只有前者敢说「已终了」', () => {
  const ended = win({ status: 'ended_undated', statusChangedAt: TODAY })
  assert.equal(limitedWindowPhase(ended, TODAY), 'ended')
  assert.equal(isActiveLimitedWindow(ended, TODAY), false)
  assert.equal(isEndedLimitedWindow(ended, TODAY), true)

  // 「上游不再列出」只是疑似，没有任何一方说过它结束——不许对玩家说已终了
  const pending = win({ status: 'end_pending', statusChangedAt: TODAY })
  assert.equal(isEndedLimitedWindow(pending, TODAY), false, 'end_pending 被当成了「已终了」')
  assert.equal(isActiveLimitedWindow(pending, TODAY), false)

  // 还开着的照旧
  assert.equal(isEndedLimitedWindow(win(), TODAY), false)
  assert.equal(isActiveLimitedWindow(win(), TODAY), true)
})

test('措辞：已终了的窗口不许再说「暂无截止日期」', () => {
  const ended = win({ status: 'ended_undated', label: '年の瀬' })
  assert.equal(limitedWindowText(ended), '【年の瀬】2024/12/26 起 · 已结束')
  assert.ok(!limitedWindowText(ended).includes('暂无截止日期'), '已终了却说成「还没定截止日」')
  // 没有截止日的**在掉**窗口，措辞一个字都不许变（老口径）
  assert.equal(limitedWindowText(win({ label: '年の瀬' })), '【年の瀬】2024/12/26–暂无截止日期')
  for (const bad of ['即将', '快关门', '快到期', '倒计时', '抓紧']) {
    assert.ok(!limitedWindowText(ended).includes(bad), `已终了的措辞里出现了「${bad}」`)
  }
})

// ---------------------------------------------------------------------------
// ③ 目录接线：已终了的退出可捞，但要说得出为什么
// ---------------------------------------------------------------------------

const baseMap = (nodes) => ({ nodes })
const node = (ships) => ({ emptyDrop: 'unknown', ships })
const evidence = { kind: 'community', note: '测试用凭据，说清是哪一份', recordedAt: TODAY }

const setup = () => {
  applyMapIntelCatalog({
    schemaVersion: 1,
    maps: {
      '9-1': baseMap({
        E: node([{ id: 891 }, { id: 167 }, { id: 700 }]),
      }),
    },
  })
  applyMapDropWindows({
    schemaVersion: 1,
    compiledAt: TODAY,
    checkedAt: TODAY,
    source: '测试台账',
    revision: 'test',
    maps: {
      '9-1': {
        E: [
          // 已终了：上游指名说它终了了
          {
            id: 891,
            limitedOnly: true,
            window: win({ status: 'ended_undated', statusChangedAt: TODAY, label: '年の瀬' }),
            evidence,
          },
          // 还在掉的限定
          { id: 167, limitedOnly: true, window: win({ from: '2025-10-29', label: '山風、磯風など' }), evidence },
        ],
      },
    },
  })
}

test('已终了的限定掉点退出「可捞」，但另有一路说得出它去哪了', () => {
  setup()
  // 可捞那一路：已终了的一条都不许在里面
  const live = confirmedDropSitesOf(891, TODAY)
  assert.deepEqual(live, [], '已终了的掉点还留在「确认掉落海域」里——那是在指一条死路')

  // 解释那一路：说得出图、点、批次名与起始日
  const ended = endedDropSitesOf(891, TODAY)
  assert.equal(ended.length, 1)
  assert.equal(ended[0].map, '9-1')
  assert.deepEqual(ended[0].nodes, ['E'])
  assert.equal(ended[0].window.label, '年の瀬')
  assert.equal(ended[0].window.from, '2024-12-26')

  // 还在掉的限定：照旧算可捞，且带着「有限定期」的标
  const alive = confirmedDropSitesOf(167, TODAY)
  assert.equal(alive.length, 1)
  assert.equal(alive[0].limited, true, '还在掉的限定丢了限定标，「（限定中）」就无从显示')
  assert.deepEqual(endedDropSitesOf(167, TODAY), [], '还在掉的条目被算进了已终了')

  // 没有任何限定标注的常规条目：一个字节都不许变
  const plain = confirmedDropSitesOf(700, TODAY)
  assert.equal(plain.length, 1)
  assert.equal(plain[0].limited, false)
  assert.equal(plain[0].limitedOnly, false)
  assert.deepEqual(endedDropSitesOf(700, TODAY), [])
  const ships = mapIntelNode('9-1', 'E', TODAY).ships
  assert.deepEqual(
    ships.find((one) => one.id === 700),
    { id: 700 },
    '常规条目被加了字段——这一层只该动限定那一档',
  )
  assert.equal(ships.find((one) => one.id === 891), undefined, '已终了的条目还摆在掉落池里')
})

test('end_pending 照旧隐去、也不解释——没人说过它结束，不许替上游下断言', () => {
  applyMapIntelCatalog({ schemaVersion: 1, maps: { '9-2': baseMap({ A: node([{ id: 480 }]) }) } })
  applyMapDropWindows({
    schemaVersion: 1,
    compiledAt: TODAY,
    checkedAt: TODAY,
    source: '测试台账',
    revision: 'test',
    maps: {
      '9-2': { A: [{ id: 480, limitedOnly: true, window: win({ status: 'end_pending' }), evidence }] },
    },
  })
  assert.deepEqual(confirmedDropSitesOf(480, TODAY), [])
  assert.deepEqual(
    endedDropSitesOf(480, TODAY),
    [],
    'end_pending 被当成「已终了」摆出去了——那一档只是上游不再列出，属疑似',
  )
})

// ---------------------------------------------------------------------------
// ④ 真包：鲑鱼这一条，以及「常规条目没被殃及」
// ---------------------------------------------------------------------------

const ledgerFile = new URL('../assets/lodes/map-drop-windows.json', import.meta.url)
const dropsFile = new URL('../assets/lodes/map-drops.json', import.meta.url)

test('随包台账：鲑鱼 1-2 E 记成已终了，且说得出是哪一批', {
  skip: fs.existsSync(ledgerFile) ? false : '缺 map-drop-windows 台账',
}, () => {
  const data = JSON.parse(fs.readFileSync(ledgerFile, 'utf8')).data
  const salmon = (data.maps['1-2']?.E ?? []).find((one) => one.id === 891)
  assert.ok(salmon, '鲑鱼 1-2 E 没进台账——缺舰清单会继续把它当常驻掉落指出去')
  assert.equal(salmon.window.status, 'ended_undated')
  assert.equal(salmon.window.until, null, '上游从没公布过结束日，写了日子就是编的')
  assert.equal(salmon.window.from, '2024-12-26')
  assert.equal(salmon.window.label, '年の瀬')
  assert.equal(salmon.limitedOnly, true, 'limitedOnly 少了，它就不会从可捞里退出去')
  assert.ok(salmon.evidence.note.includes('删除线'), '凭据没写清是凭什么判的终了')
  assert.deepEqual(salmon.votes, ['wikiwiki'])
})

test('随包台账：已终了那一档都带 limitedOnly 与凭据，且没顺手改动别的条目', {
  skip: fs.existsSync(ledgerFile) ? false : '缺 map-drop-windows 台账',
}, () => {
  const data = JSON.parse(fs.readFileSync(ledgerFile, 'utf8')).data
  const rows = []
  for (const map of Object.keys(data.maps)) {
    for (const nd of Object.keys(data.maps[map])) {
      for (const one of data.maps[map][nd]) rows.push({ map, node: nd, one })
    }
  }
  const tally = {}
  for (const { one } of rows) {
    const status = one.window.status ?? 'active_confirmed'
    tally[status] = (tally[status] ?? 0) + 1
  }
  // 这一改只**新增**已终了，不许把原有的 active_confirmed 改写成别的
  assert.equal(tally.active_confirmed, 134, '原有的「还在掉」条目数变了——这一改本该只新增')
  assert.equal(tally.end_pending, 10, '原有的 end_pending 条目数变了')
  assert.ok(tally.ended_undated >= 34, `已终了只有 ${tally.ended_undated} 条`)

  for (const { map, node: nd, one } of rows) {
    const status = one.window.status ?? 'active_confirmed'
    if (status !== 'ended_undated' && status !== 'ended_confirmed') continue
    assert.equal(one.limitedOnly, true, `${map}/${nd}#${one.id} 的已终了条目没写 limitedOnly`)
    assert.ok(one.evidence?.note?.length > 10, `${map}/${nd}#${one.id} 的凭据是空话`)
    assert.ok(one.window.statusChangedAt, `${map}/${nd}#${one.id} 没写改判日期`)
    if (status === 'ended_undated') {
      assert.equal(one.window.until, null, `${map}/${nd}#${one.id}：ended_undated 不该有截止日`)
    }
  }
})

test('CC 上游包 map-drops 一个字节都没动——校正只走台账这一层', {
  skip: fs.existsSync(dropsFile) ? false : '缺 map-drops 包',
}, () => {
  const raw = fs.readFileSync(dropsFile, 'utf8')
  // 限定/终了这套语义整条不许出现在上游汇编包里：它是第一方台账那一层的事
  for (const word of ['ended_undated', 'ended_confirmed', 'end_pending', 'limitedOnly']) {
    assert.ok(!raw.includes(word), `map-drops 里出现了「${word}」——限定语义漏进了上游包`)
  }
  const data = JSON.parse(raw).data
  const salmon = data.maps['1-2'].nodes.E.ships.find((one) => one.id === 891)
  assert.ok(salmon, '鲑鱼从 map-drops 里被删了——上游包该原样保留，校正只在台账那一层')
  assert.deepEqual(salmon.votes, ['kcwiki'], '上游包里那一格的票被改了')
})

// ---------------------------------------------------------------------------
// ⑤ 展示层接线（渲染脱不开 Electron，这一段钉接线与文案）
// ---------------------------------------------------------------------------

const ji = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')

test('捞船单子：已终了的不进可捞计数，另起一组换语境', () => {
  const plan = ji.slice(ji.indexOf('const huntPlanHtml'), ji.indexOf('const shipCatalogRowHtml'))
  // 先问「还有没有活路」，有活路的就不该出现在已终了那一组
  assert.ok(
    /const endedOnly = missing\.flatMap\(\(id\) => \{\s*if \(confirmedDropSitesOf\(id\)\.length\) return \[\]/.test(plan),
    '已终了那一组没有先排除「还有活路」的船',
  )
  // 可捞计数只认 catchable；已终了那一组不许并进去
  assert.ok(
    plan.includes('data-hunt-filter="catchable"') && plan.includes('${catchable.length}'),
    '可捞计数的取数变了',
  )
  assert.ok(
    !/catchable\.length \+ endedOnly\.length/.test(plan),
    '已终了的被并进了可捞计数——她们实际无路可捞',
  )
  // 换语境不是删条目：得有独立的一组把她们摆出来
  assert.ok(plan.includes('限定期已结束 · 对应掉落当前不可获取'), '已结束那一组的标题没了')
  assert.ok(plan.includes('（限定·已结束）'), '掉点后缀「（限定·已结束）」没了')
  assert.ok(plan.includes('（限定中）'), '还在掉的限定没标「（限定中）」')
  // 悬停要给批次名与起始日，出处落在窗口本身
  assert.ok(
    /limitedWindowText\(site\.window\)/.test(plan),
    '已终了那一行的悬停没给批次名与起始日',
  )
})

test('图鉴掉点：已终了的另起灰显行，不混进「确认掉落海域」的计数', () => {
  const block = ji.slice(ji.indexOf('const confirmedDropHtml'), ji.indexOf('const shipDropHtml'))
  assert.ok(block.includes('endedDropSitesOf'), '图鉴那一路没取已终了的掉点')
  assert.ok(block.includes('（限定·已结束）'), '图鉴的掉点后缀没了')
  assert.ok(block.includes('cd-row ended'), '已终了的行没挂灰显的类')
  // 「N 处」说的是还能去的那些，已终了的不许并进这个数
  assert.ok(block.includes('${ordered.length} 处'), '确认掉落海域的计数取数变了')
  assert.ok(
    !/\$\{ordered\.length \+ ended\.length\} 处/.test(block),
    '已终了的被并进了「确认掉落海域」的计数',
  )
})
