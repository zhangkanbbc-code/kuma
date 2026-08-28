import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  parseWikiwikiRemodelIndex,
  parseWikiwikiRemodelPage,
  parseWikiwikiReturnEdges,
} from '../scripts/lib/wikiwiki-remodel.mjs'
import { parseWikiwikiShipMaxTable } from '../scripts/lib/wikiwiki-ship-max.mjs'
import {
  parseWikiwikiExpeditionPage,
} from '../scripts/lib/wikiwiki-expedition.mjs'
import { parseWikiwikiRoutingSection } from '../scripts/lib/wikiwiki-routing.mjs'
import { normalizeWikiwikiShipName } from '../scripts/lib/wikiwiki-voice.mjs'
import kcnavRouting from '../dist/shared/kcnav-routing.js'

const { estimateKcnavBranch, kcnavFleetComposition } = kcnavRouting

test('wikiwiki ship names align omitted Latin accents without stripping Japanese voicing marks', () => {
  assert.equal(
    normalizeWikiwikiShipName('Bearn Amelioration'),
    normalizeWikiwikiShipName('Béarn amélioration'),
  )
  assert.equal(normalizeWikiwikiShipName('Bearn改'), normalizeWikiwikiShipName('Béarn改'))
  assert.notEqual(
    normalizeWikiwikiShipName('ベールヌイ'),
    normalizeWikiwikiShipName('ヘールヌイ'),
  )
})

test('wikiwiki remodel chart keeps API-external materials and slotitem boiler distinct', () => {
  const html = `<table><tbody>
    <tr><th>改造チャート</th></tr>
    <tr><td><strong>大和</strong> →
      <a href="/kancolle/大和改二" title="大和改二">大和改二</a>
      (Lv88+<a href="/item">改装設計図</a>x3+<a href="/item">新型砲熕兵装資材</a>x3+
      <a href="/slotitem">新型高温高圧缶</a>x2)
    </td></tr>
    <tr><th>図鑑説明</th></tr>
  </tbody></table>`
  const [entry] = parseWikiwikiRemodelPage(html, '大和')
  assert.equal(entry.targetName, '大和改二')
  assert.equal(entry.level, 88)
  assert.deepEqual(
    entry.needs.map((need) => [need.kind, need.id, need.count]),
    [
      ['useitem', 58, 3],
      ['useitem', 75, 3],
      ['slotitem', 87, 2],
    ],
  )
})

test('wikiwiki remodel chart keeps every edge with its come-from form distinct', () => {
  // 加賀式循环：改二在链上出现两次（改→改二 首次解锁、護→改二 回环），
  // 每次出现是不同的边；括号内的素材链接与脚注角标都不是链上节点。
  const html = `<table><tbody>
    <tr><th>改造チャート</th></tr>
    <tr><td><strong>加賀</strong> →
      <a href="/kancolle/加賀改" title="加賀改">加賀改</a>(Lv30) →
      <a href="/kancolle/加賀改二" title="加賀改二">加賀改二</a>
      (Lv82+<a href="/item">改装設計図</a>x2+開発資材x120)⇒
      <a href="/kancolle/加賀改二戊" title="加賀改二戊">加賀改二戊</a>(Lv82+高速建造材x30+開発資材x88)
      <a class="note_super" href="#notefoot_1">*1</a>⇒
      <a href="/kancolle/加賀改二" title="加賀改二">加賀改二</a>(Lv84+高速建造材x30+開発資材x60)
    </td></tr>
    <tr><th>図鑑説明</th></tr>
  </tbody></table>`
  const entries = parseWikiwikiRemodelPage(html, '加賀')
  assert.deepEqual(
    entries.map((entry) => [entry.targetName, entry.sourceName, entry.level]),
    [
      ['加賀改', undefined, 30],
      ['加賀改二', '加賀改', 82],
      ['加賀改二戊', '加賀改二', 82],
      // 脚注角标 *1 不能被当成前一形态——回环边的来路必须还是戊
      ['加賀改二', '加賀改二戊', 84],
    ],
  )
  assert.deepEqual(
    entries[1].needs.map((need) => [need.id, need.count]),
    [[58, 2], [3, 120]],
  )
  assert.deepEqual(
    entries[3].needs.map((need) => [need.id, need.count]),
    [[2, 30], [3, 60]],
  )
})

test('wikiwiki return-cost footnotes parse all three syntaxes and never guess', () => {
  const page = (notes) => `<div><a id="notefoot_1" href="#notetext_1" class="note_super">${notes}</div>`
  // 三隈式：品名xN 逐个列
  assert.deepEqual(
    parseWikiwikiReturnEdges(
      page('*1 改二特を改二に戻す場合、高速建造材x40と開発資材x15と資材を消費する *2 その他'),
      '三隈',
    ),
    [{
      fromName: '改二特',
      toName: '改二',
      needs: [
        { kind: 'useitem', id: 2, nameJp: '高速建造材', count: 40 },
        { kind: 'useitem', id: 3, nameJp: '開発資材', count: 15 },
      ],
      raw: '改二特を改二に戻す場合、高速建造材x40と開発資材x15と資材を消費する',
      page: '三隈',
    }],
  )
  // Fletcher式：「AとBをN個ずつ」
  const fletcher = parseWikiwikiReturnEdges(
    page('*1 Mk.IIを改Mod.2に戻す場合、高速建造材と開発資材を20個ずつと資材を消費する'),
    'Fletcher',
  )
  assert.deepEqual(
    fletcher[0].needs.map((need) => [need.id, need.count]),
    [[2, 20], [3, 20]],
  )
  // 大鯨式：「AをN個」单品
  const taigei = parseWikiwikiReturnEdges(
    page('*1 改二を改二戊に戻す場合、高速建造材を20個と資源を消費する'),
    '大鯨',
  )
  assert.deepEqual(taigei[0].needs, [
    { kind: 'useitem', id: 2, nameJp: '高速建造材', count: 20 },
  ])
  assert.equal(taigei[0].fromName, '改二')
  assert.equal(taigei[0].toName, '改二戊')
  // 「資材の消費だけで変更可能」不给数字，「設計図不要」也不是回程成本——
  // 都不能产出边（榛名丙→乙就该诚实地没有明细）
  assert.deepEqual(
    parseWikiwikiReturnEdges(
      page('*1 資材の消費だけで、改二乙と改二丙をいつでも変更可能 *2 航改二→改二への改装では設計図不要'),
      '榛名',
    ),
    [],
  )
})

test('wikiwiki remodel index expands shorthand and tooltip-only materials in one batch', () => {
  const filler = Array.from({ length: 301 }, (_, index) =>
    `<tr><td>${index}</td><td>前${index}</td><td>駆逐艦</td><td>20</td><td>⇒</td><td>${index}</td><td>後${index}</td><td>駆逐艦</td><td>100</td><td>100</td><td>編集</td></tr>`,
  ).join('')
  const html = `<table><tbody>
    <tr><th>No</th><th>艦名</th><th>艦種</th><th>Lv</th><th>⇒</th><th>No</th><th>艦名</th><th>艦種</th><th>弾薬</th><th>鋼材</th><th>追加</th></tr>
    <tr><th>改造前</th><th>改造前</th><th>改造前</th><th>改造前</th><th>⇒</th><th>改造後</th><th>改造後</th><th>改造後</th><th>必要資材</th><th>必要資材</th><th>追加</th></tr>
    ${filler}
    <tr><td>136</td><td>大和改</td><td>戦艦</td>
      <td>88+図3+報+砲3+<a class="note_super tooltip"
        data-tooltip-content="&lt;p&gt;新型高温高圧缶x2&lt;/p&gt;&lt;div&gt;脚注 *28 へ&lt;/div&gt;">*28</a></td>
      <td>⇒</td><td>511</td><td>大和改二</td><td>戦艦</td><td>9900</td><td>9800</td><td>編集</td></tr>
    <tr><td>554</td><td>榛名改二丙</td><td>高速戦艦</td>
      <td>-+<a class="note_super tooltip"
        data-tooltip-content="&lt;p&gt;高速建造材×35+開発資材×15&lt;/p&gt;&lt;div&gt;脚注 *129 へ&lt;/div&gt;">*129</a></td>
      <td>⇒</td><td>393</td><td>榛名改二乙</td><td>高速戦艦</td><td>1300</td><td>1700</td><td>編集</td></tr>
  </tbody></table>`
  const rows = parseWikiwikiRemodelIndex(html)
  const entry = rows.find((row) => row.targetName === '大和改二')
  assert.deepEqual(
    entry.needs.map((need) => [need.kind, need.id, need.count]),
    [
      ['useitem', 58, 3],
      ['useitem', 78, 1],
      ['useitem', 75, 3],
      ['slotitem', 87, 2],
    ],
  )
  // 回程行（条件「-」）没有等级门槛，消耗全在脚注 tooltip 里——
  // 标 conversionOnly 交给装配层挂成边，不能再当废行丢掉
  const back = rows.find((row) => row.sourceName === '榛名改二丙')
  assert.equal(back.conversionOnly, true)
  assert.equal(back.level, undefined)
  assert.deepEqual(
    back.needs.map((need) => [need.id, need.count]),
    [[2, 35], [3, 15]],
  )
})

test('wikiwiki ship-max table keeps only fully-numeric stat rows', () => {
  const filler = Array.from({ length: 320 }, (_, index) =>
    `<tr><td>${index + 20}</td><td>填充舰${index}</td><td>駆逐艦</td><td>30</td><td>50</td><td>80</td><td>60</td><td>70</td><td>60</td><td>60</td><td>40</td><td>50</td></tr>`,
  ).join('')
  const html = `<table><tbody>
    <tr><th>No. ▼</th><th>艦名</th><th>艦種</th><th>耐久</th><th>装甲</th><th>回避</th><th>火力</th><th>雷装</th><th>対空</th><th>対潜</th><th>索敵</th><th>運</th></tr>
    <tr><td>001a</td><td>長門</td><td>戦艦</td><td>80</td><td>89</td><td>49</td><td>99</td><td>0</td><td>89</td><td>0</td><td>39</td><td>20</td></tr>
    <tr><td>---</td><td>イオナ</td><td>潜水艦</td><td>?</td><td>?</td><td>?</td><td>?</td><td>?</td><td>?</td><td>?</td><td>?</td><td>?</td></tr>
    ${filler}
  </tbody></table>`
  const rows = parseWikiwikiShipMaxTable(html)
  const nagato = rows.find((row) => row.name === '長門')
  assert.deepEqual(nagato, { name: '長門', no: '001a', kaihi: 49, taisen: 0, sakuteki: 39 })
  // 值不是数字的行（联动舰的 ? 行）整行丢弃，不产出半截数据
  assert.equal(rows.some((row) => row.name === 'イオナ'), false)
})

test('the fetched ship-max pack keeps arbitrated anchors straight', () => {
  // 真包锚定（包不在时跳过——test:lodes 会兜底）。基准选定依据：2026-08-11
  // 账本一手（api_kaihi 等 [1]）对 340 持有形态仲裁，wikiwiki 覆盖 834 形态
  // vs kcwiki 缺 41 项，错误率相当。持有形态在 UI 里一律一手压顶。
  let pack
  try {
    pack = JSON.parse(
      readFileSync(new URL('../assets/lodes/wikiwiki-ship-max.json', import.meta.url), 'utf8'),
    )
  } catch (_e) {
    return
  }
  const data = pack.data
  assert.ok(Object.keys(data).length >= 800)
  assert.deepEqual(
    [data[80].kaihi, data[80].taisen, data[80].sakuteki],
    [49, 0, 39], // 長門素体
  )
  assert.deepEqual(
    [data[944].kaihi, data[944].taisen, data[944].sakuteki],
    [27, 0, 30], // 平安丸——kcwiki 标 -1 缺数据、本包有值的代表
  )
  assert.deepEqual(
    [data[593].kaihi, data[593].sakuteki],
    [75, 53], // 榛名改二乙——与账本一手一致
  )
  // 名字对齐的三块硬骨头：后缀行、注记即本名、注记消歧重名
  assert.equal(data[275].nameJp, '長門改')
  assert.equal(data[1040].nameJp, '吹雪改三護(六式)')
  assert.equal(data[740].nameJp, 'Glorious改(巡洋戦艦)')
  assert.equal(data[741].nameJp, 'Glorious改(正規空母)')
})

test('every friendly form has the three hidden stats somewhere — no per-ship eyeballing', () => {
  // 用户拿日枝丸抓到批量表整批不收新实装（2026-08-11）。这里机器兜底：
  // s2 样本里的每个友方形态，三维必须能从 wikiwiki-ship-max ∪ kcwiki-ships
  // 取到——缺口清单必须为空，谁也不用逐舰肉眼查。（资料不在时跳过，
  // test:lodes 会兜底强制在场。）
  let shipMax, kcwiki, s2
  try {
    shipMax = JSON.parse(
      readFileSync(new URL('../assets/lodes/wikiwiki-ship-max.json', import.meta.url), 'utf8'),
    ).data
    kcwiki = JSON.parse(
      readFileSync(new URL('../assets/lodes/kcwiki-ships.json', import.meta.url), 'utf8'),
    ).data
    s2 = JSON.parse(readFileSync(new URL('../../s2.json', import.meta.url), 'utf8'))
  } catch (_e) {
    return
  }
  const findArr = (obj, key) => {
    if (!obj || typeof obj !== 'object') return null
    if (Array.isArray(obj[key])) return obj[key]
    for (const value of Object.values(obj)) {
      const hit = findArr(value, key)
      if (hit) return hit
    }
    return null
  }
  const kcById = new Map(
    Object.values(kcwiki)
      .filter((entry) => Number(entry?.ID) > 0)
      .map((entry) => [Number(entry.ID), entry]),
  )
  const goodPair = (pair) => Array.isArray(pair) && Number(pair[0]) >= 0 && Number(pair[1]) >= 0
  const kcCovers = (id) => {
    const stats = kcById.get(id)?.数据
    return Boolean(stats && goodPair(stats.回避) && goodPair(stats.对潜) && goodPair(stats.索敌))
  }
  const gaps = findArr(s2, 'api_mst_ship')
    .filter((ship) => Number(ship?.api_sortno) > 0)
    .filter((ship) => !shipMax[ship.api_id] && !kcCovers(Number(ship.api_id)))
    .map((ship) => `${ship.api_name}#${ship.api_id}`)
  // 已核实的真空白（2026-08-11）：这三个形态无独立舰页（链挂在母页上、
  // 母页只有素体的表）、kcwiki 也无条目——除此之外出现任何缺口都算回归
  const KNOWN_GAPS = ['Algérie改#1056', 'Béarn改#1060', 'Béarn amélioration#1061']
  assert.deepEqual(gaps.filter((gap) => !KNOWN_GAPS.includes(gap)), [])
})

test('the fetched remodel pack keeps per-edge truths straight', () => {
  // 对真实抓下来的包锚定按边真值（包不在时跳过——test:lodes 会兜底）。
  // 锚点全部来自用户游戏实拍与 wikiwiki 舰页チャート/脚注的三方核定
  // （2026-08-11）：这些数字变了要么是页面改版，要么是解析又坏了。
  let pack
  try {
    pack = JSON.parse(
      readFileSync(new URL('../assets/lodes/wikiwiki-remodel.json', import.meta.url), 'utf8'),
    )
  } catch (_e) {
    return
  }
  const data = pack.data
  const needsOf = (detail) => (detail?.needs ?? []).map((need) => [need.id, need.count])
  // 榛名改二丙＝乙→丙 这条边自己的成本，绝不许再顶着首解锁的 図2報兵2開発390
  assert.equal(data[954].fromShipId, 593)
  assert.equal(data[954].level, 90)
  assert.deepEqual(needsOf(data[954]).toSorted((a, b) => a[0] - b[0]), [[2, 35], [3, 55]])
  // 開発資材×390 属于 改二→乙 首解锁；丙→乙 回程的数字只有总表回程行
  // tooltip 写全了（高建35+開発15），舰页脚注只说「資材だけ」
  assert.equal(data[593].fromShipId, 151)
  assert.ok(needsOf(data[593]).some(([id, count]) => id === 3 && count === 390))
  const harunaBack = (data[593].edges ?? []).find((edge) => edge.fromShipId === 954)
  assert.equal(harunaBack.source, 'index')
  assert.deepEqual(needsOf(harunaBack).toSorted((a, b) => a[0] - b[0]), [[2, 35], [3, 15]])
  // 赤城改二←戊 的回程同样只有总表行有数字
  const akagiBack = (data[594].edges ?? []).find((edge) => edge.fromShipId === 599)
  assert.deepEqual(needsOf(akagiBack).toSorted((a, b) => a[0] - b[0]), [[2, 30], [3, 80]])
  // 加賀改二：首解锁明细是主条目（曾被回环边 護→改二 覆盖丢失）
  assert.equal(data[698].fromShipId, 278)
  assert.ok(needsOf(data[698]).some(([id, count]) => id === 58 && count === 2))
  assert.ok(needsOf(data[698]).some(([id, count]) => id === 3 && count === 120))
  const kagaBack = (data[698].edges ?? []).find((edge) => edge.fromShipId === 646)
  assert.deepEqual(needsOf(kagaBack).toSorted((a, b) => a[0] - b[0]), [[2, 30], [3, 60]])
  // 三隈改二：特→改二 的回程成本只在脚注里，且与去程（開発45）不同
  const mikumaBack = (data[502].edges ?? []).find((edge) => edge.fromShipId === 507)
  assert.equal(mikumaBack.source, 'footnote')
  assert.deepEqual(needsOf(mikumaBack).toSorted((a, b) => a[0] - b[0]), [[2, 40], [3, 15]])
})

test('wikiwiki expedition parser reads three-row facts and correct drum requirements', () => {
  const filler = Array.from({ length: 63 }, (_, index) => index + 2)
    .filter((value) => value !== 21)
    .map((value) => {
    const id = `${value}`
    return `<tr><td>${id}</td><td>遠征${id}</td><td>D</td><td>説明</td><td>01:00:00</td><td>30%</td><td>20%</td></tr>
      <tr><td>${id}</td><td>遠征${id}</td><td>Lv1</td><td>10EXP、燃料×10</td></tr>
      <tr><td>${id}</td><td>遠征${id}</td><td>Lv1</td><td>最低2隻。艦種自由／「駆×2」</td></tr>
      <tr><td></td></tr>`
  }).join('')
  const html = `<table><tbody>
    <tr><th>ID</th><th>遠征名</th><th>難度</th><th>内容</th><th>遠征時間</th><th>消費燃料</th><th>消費弾薬</th></tr>
    <tr><th>ID</th><th>遠征名</th><th>必要旗艦Lv 艦隊合計Lv</th><th>獲得ボーナス（経験値は提督の獲得EXP）</th></tr>
    <tr><th>ID</th><th>遠征名</th><th>必要旗艦Lv 艦隊合計Lv</th><th>必要編成隻数。必要艦種、その他必要条件／「編成例」</th></tr>
    <tr><td>21</td><td>北方鼠輸送作戦</td><td>S</td><td>説明</td><td>02:20:00</td><td>80%</td><td>70%</td></tr>
    <tr><td>21</td><td>北方鼠輸送作戦</td><td>Lv15 Lv30</td><td>45EXP、燃料×320、弾薬×270</td></tr>
    <tr><td>21</td><td>北方鼠輸送作戦</td><td>Lv15 Lv30</td><td>最低5隻。軽1隻、駆4隻必要。3隻以上にドラム缶(輸送用)が合計3個以上必要。</td></tr>
    <tr><td></td></tr>
    ${filler}
  </tbody></table>
  <table><tbody>
    <tr><th>ID</th><th>遠征名</th><th>時間</th><th>Lv(計)</th><th>最低数</th><th>必須艦</th><th>特殊</th><th>提督</th><th>艦娘</th></tr>
    <tr><td>21</td><td>北方鼠輸送作戦</td><td>2:20</td><td>15(30)</td><td>5</td><td>軽1駆4</td><td></td><td>45</td><td>55</td></tr>
  </tbody></table>`
  const entry = parseWikiwikiExpeditionPage(html)['21']
  assert.equal(entry.flagLv, 15)
  assert.equal(entry.fleetLv, 30)
  assert.equal(entry.minShips, 5)
  assert.equal(entry.drumShips, 3)
  assert.equal(entry.drumTotal, 3)
  assert.deepEqual(entry.rewards.fuel, [320, 137])
})

test('KCNav branch estimates only use exact fleet composition samples', () => {
  const fleet = kcnavFleetComposition([2, 2, 3], [], 0)
  const branch = {
    edges: [
      {
        edgeId: 2,
        to: 'B',
        comps: [
          { fleetTypes: [0], fleet1Comp: ['DD', 'CL', 'DD'], fleet2Comp: [], count: 30 },
          { fleetTypes: [0], fleet1Comp: ['DD'], fleet2Comp: [], count: 900 },
        ],
      },
      {
        edgeId: 3,
        to: 'C',
        comps: [
          { fleetTypes: [0], fleet1Comp: ['CL', 'DD', 'DD'], fleet2Comp: [], count: 70 },
        ],
      },
    ],
  }
  const estimate = estimateKcnavBranch(branch, fleet, ['B', 'C'])
  assert.equal(estimate.sample, 100)
  assert.deepEqual(
    estimate.routes.map((route) => [route.to, route.probability]),
    [['B', 0.3], ['C', 0.7]],
  )
})

test('KCNav lode intake never automates the upstream routing API', () => {
  const source = readFileSync(
    new URL('../scripts/lib/kcnav-routing.mjs', import.meta.url),
    'utf8',
  )
  assert.doesNotMatch(source, /\/api\/routing\//)
  assert.match(source, /KANSO_KCNAV_EXPORT/)
  assert.match(source, /拒绝未授权 API 自动化/)
})

test('wikiwiki route tables stay human-readable and preserve every destination', () => {
  const html = `<table><tbody>
    <tr><th>分岐点</th><th>ルート</th><th>移動条件</th></tr>
    <tr><td rowspan="2">A</td><td>B</td><td>駆逐艦を含むとB寄り<br>索敵不足はC</td></tr>
    <tr><td>C</td><td>それ以外はランダム</td></tr>
  </tbody></table>`
  assert.deepEqual(parseWikiwikiRoutingSection(html), [
    {
      from: 'A',
      routes: [
        { to: 'B', conditionJp: '駆逐艦を含むとB寄り；索敵不足はC' },
        { to: 'C', conditionJp: 'それ以外はランダム' },
      ],
    },
  ])
})
