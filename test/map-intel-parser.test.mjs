import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// applyCurrentLimited / confirmLimitedDropEnd 已于 2026-08-22（批次 4）删除——
// 限定期窗口换成第一方台账 map-drop-windows 之后，「把上游名单写进包」与
// 「人工确认结束日」两条路都搬到了 scripts/lib/map-drop-windows.mjs，
// 对应的护栏在 test/map-drop-windows.test.mjs。
import {
  loadNormalMapLast,
  nodeNames,
  parseCurrentLimited,
  parseDropTable,
  parseEnemyTable,
  preserveEventMaps,
  preserveLimitedHistory,
  splitAreaMaps,
} from '../scripts/map-intel.mjs'
import {
  parseEventAllDifficultyDrops,
  parseEventBreakthroughBonus,
  parseEventDifficultyDrops,
  parseEventFriendlyFleets,
  parseEventMapPage,
} from '../scripts/map-intel-event.mjs'
import {
  assertNoPendingMapIntelCandidate,
  buildMapIntelDiff,
} from '../scripts/map-intel-review.mjs'

const shipsPack = {
  data: {
    a: { ID: 1, 日文名: '睦月' },
    b: { ID: 89, 日文名: '鳳翔' },
  },
}

test('area aggregate pages split into their individual map sections', () => {
  const html = `
    <h2 id="characteristics">本海域の特徴</h2><p>intro</p>
    <h2 id="one"><a href="/kancolle/x/1-1">1-1</a>.鎮守府正面海域</h2><p>first</p>
    <h3>敵編成</h3><p>inside first</p>
    <h2 id="two"><a href="/kancolle/x/1-2">1-2</a>.南西諸島沖</h2><p>second</p>`
  const sections = splitAreaMaps(html, 1, 2)
  assert.equal(sections.size, 2)
  assert.match(sections.get('1-1'), /inside first/)
  assert.doesNotMatch(sections.get('1-1'), /second/)
  assert.match(sections.get('1-2'), /second/)
})

test('map-intel parser expands rowspans and keeps enemy names without probabilities', () => {
  const html = `
    <div class="fold-summary hidden-on-open">敵編成</div>
    <table><tbody>
      <tr><th>出現場所</th><th>パターン</th><th>EXP</th><th>出現艦船</th><th>陣形</th></tr>
      <tr><td rowspan="2">A：敵艦隊</td><td>1</td><td>10</td><td>駆逐イ級、駆逐ロ級</td><td rowspan="2">単縦</td></tr>
      <tr><td>2</td><td>20</td><td>軽巡ホ級、駆逐イ級</td></tr>
      <tr><td>A：敵艦隊</td><td>3</td><td>20</td><td>パターン2と同じ</td><td>単縦</td></tr>
    </tbody></table>`
  // EXP 列一并收下：二期起基础经验按敌编成给，而这张表本来就按 pattern 存，
  // 粒度天然对齐。第三行「パターン2と同じ」连经验一起继承，所以不产生新条目。
  assert.deepEqual(parseEnemyTable(html), {
    A: [
      { formation: 1, ships: ['駆逐イ級', '駆逐ロ級'], exp: 10 },
      { formation: 1, ships: ['軽巡ホ級', '駆逐イ級'], exp: 20 },
    ],
  })
})

test('没有 EXP 列的敌编成表照旧能解析，不会凭空补一个经验', () => {
  const html = `
    <div class="fold-summary hidden-on-open">敵編成</div>
    <table><tbody>
      <tr><th>出現場所</th><th>パターン</th><th>出現艦船</th><th>陣形</th></tr>
      <tr><td>A：敵艦隊</td><td>1</td><td>駆逐イ級</td><td>単縦</td></tr>
    </tbody></table>`
  const parsed = parseEnemyTable(html)
  assert.deepEqual(parsed, { A: [{ formation: 1, ships: ['駆逐イ級'] }] })
  // 缺就是缺，不能填 0——0 会被读成「这一战没经验」
  assert.equal('exp' in parsed.A[0], false)
})

// 实测在正式资料包里捞出来的两种脏数据：wiki 偶尔拿「。」断开两艘舰，
// [[链接]] 断在单元格里会漏出方括号。两者都会让那个名字永远落不到 mstId，
// 于是整套编成被判定跳过——症状是「前三舰未命中已知完整编成」，很难反查到这里。
test('enemy table splits on the ideographic full stop and drops leaked wiki link markup', () => {
  const html = `
    <div class="fold-summary hidden-on-open">敵編成</div>
    <table><tbody>
      <tr><th>出現場所</th><th>パターン</th><th>出現艦船</th><th>陣形</th></tr>
      <tr><td>A：敵艦隊</td><td>1</td><td>軽母ヌ級elite(E)(艦載機白弱)。駆逐ロ級後期型</td><td>単縦</td></tr>
      <tr><td>B：敵艦隊</td><td>1</td><td>[[軽母ヌ級elite(B)(艦載機白)、重巡リ級flagship]]</td><td>単縦</td></tr>
    </tbody></table>`
  assert.deepEqual(parseEnemyTable(html), {
    A: [{ formation: 1, ships: ['軽母ヌ級elite(E)(艦載機白弱)', '駆逐ロ級後期型'] }],
    B: [{ formation: 1, ships: ['軽母ヌ級elite(B)(艦載機白)', '重巡リ級flagship'] }],
  })
})

test('current limited list supplies exact node and injects a ship missing from the base drop table', () => {
  const limitedHtml = `
    <h3>現在継続中の期間限定ドロップ艦（2026-06-26メンテ時点）</h3>
    <ul><li><a href="#event">限定邂逅 (2025/01/28～継続中)</a></li></ul>
    <div>海域別リスト</div>
    <table><tr><th>海域</th><th>エリア</th><th>ドロップ対象</th></tr>
      <tr><th>鎮守府</th><td>1-1</td><td><a href="#event">鳳翔</a></td></tr>
    </table>
    <h2>限定邂逅 (2025/01/28～継続中)<a name ="event"></a></h2>
    <table><tr><th>海域</th><th>エリア</th><th>ドロップ対象</th></tr>
      <tr><td>鎮守府</td><td>1-1-C(ボス)</td><td>鳳翔</td></tr>
    </table>
    <h2>次</h2>`
  const limited = parseCurrentLimited(limitedHtml, shipsPack)
  const entry = limited.maps.get('1-1').get(89)
  assert.deepEqual([...entry.nodes], ['C'])
  assert.deepEqual(entry.window, {
    from: '2025-01-28',
    until: null,
    lastConfirmedAt: '2026-06-26',
    status: 'active_confirmed',
    statusChangedAt: '2026-06-26',
    label: '限定邂逅',
  })

  const mapHtml = `
    <div class="fold-summary hidden-on-open">ドロップ</div>
    <table><tr><td></td><td>戦艦級</td><td>駆逐艦</td></tr>
      <tr><td>C ボス</td><td></td><td>睦月</td></tr>
    </table>`
  const drops = parseDropTable(mapHtml, shipsPack, limited.maps.get('1-1'))
  assert.deepEqual(drops.unmatchedLimited, [])
  assert.deepEqual(drops.nodes.C, [
    { id: 1 },
    {
      id: 89,
      limited: {
        from: '2025-01-28',
        until: null,
        lastConfirmedAt: '2026-06-26',
        status: 'active_confirmed',
        statusChangedAt: '2026-06-26',
        label: '限定邂逅',
      },
      limitedOnly: true,
    },
  ])
})

test('主数据名表补上 kcwiki 缺席舰，解析不出的舰名显式报出而非静默丢掉', () => {
  // 2026-08-11 实锤：kcwiki-ships 包缺杉（等一批新实装），限定页 1-5-J 的杉被
  // matchShips 对不上后 continue 掉——目录静默缺一条限定掉落，用户实际捞到才发现。
  const limitedHtml = `
    <h3>現在継続中の期間限定ドロップ艦（2026-06-26メンテ時点）</h3>
    <ul><li><a href="#anniv">【13周年記念】期間限定邂逅 (2026/4/24～継続中)</a></li></ul>
    <div>海域別リスト</div>
    <table><tr><th>海域</th><th>エリア</th><th>ドロップ対象</th></tr>
      <tr><th>鎮守府</th><td>1-5</td><td><a href="#anniv">杉</a>, <a href="#anniv">未知舰X</a></td></tr>
    </table>
    <h2>【13周年記念】期間限定邂逅 (2026/4/24～継続中)<a name ="anniv"></a></h2>
    <table><tr><th>海域</th><th>エリア</th><th>ドロップ対象</th></tr>
      <tr><td>鎮守府</td><td>1-5-J(ボス)</td><td>杉</td></tr>
    </table>
    <h2>次</h2>`
  // kcwiki 包没有杉；主数据名表（[名, id]）作为权威补上
  const masterNames = [['杉', 992]]
  const limited = parseCurrentLimited(limitedHtml, shipsPack, masterNames)
  const entry = limited.maps.get('1-5').get(992)
  assert.ok(entry, '主数据名表必须把 kcwiki 缺席的杉解析出来')
  assert.equal(entry.window.from, '2026-04-24')
  // 活动批次标签（用户 2026-08-11 要的）：玩家要知道是哪次活动带进来的，
  // 哪天退场也按批清点
  assert.equal(entry.window.label, '13周年記念')
  assert.deepEqual([...entry.nodes], ['J'])
  // 两边都不认识的名字不许静默消失——显式报出去
  assert.deepEqual(limited.unmatchedNames, ['1-5:未知舰X'])
  // 不带主数据时退回 kcwiki 单基准：杉解析不出，但要出现在 unmatchedNames 里
  const withoutMaster = parseCurrentLimited(limitedHtml, shipsPack)
  assert.equal(withoutMaster.maps.get('1-5').get(992), undefined)
  assert.ok(withoutMaster.unmatchedNames.includes('1-5:杉'))
  // 掉落表解析同样吃主数据名表
  const mapHtml = `
    <div class="fold-summary hidden-on-open">ドロップ</div>
    <table><tr><td></td><td>戦艦級</td><td>駆逐艦</td></tr>
      <tr><td>J ボス</td><td></td><td>杉</td></tr>
    </table>`
  const drops = parseDropTable(mapHtml, shipsPack, limited.maps.get('1-5'), masterNames)
  assert.deepEqual(drops.unmatchedLimited, [])
  assert.equal(drops.nodes.J[0].id, 992)
  assert.equal(drops.nodes.J[0].limited.from, '2026-04-24')
})

test('无书名号批次取标题当标签，全角括号日期不再被跨条偷成别家的', () => {
  // 实锤（2026-08-11）：「山風、親潮、浜波（2021/10/15～継続中）」的日期是
  // 全角括号，旧的跨条正则只认半角、往后偷到别的批次的日期——这些老批次
  // 的 from 一直是错的；标着（終了）的舰名要从标签里洗掉。
  const limitedHtml = `
    <h3>現在継続中の期間限定ドロップ艦（2026-06-26メンテ時点）</h3>
    <ul>
      <li><a href="#a1">山風、親潮、浜波（2021/10/15～継続中）</a></li>
      <li><a href="#a2">春風（終了）、天霧、狭霧 (2021/03/30～一部継続中)</a></li>
    </ul>
    <div>海域別リスト</div>
    <table><tr><th>海域</th><th>エリア</th><th>ドロップ対象</th></tr>
      <tr><th>鎮守府</th><td>2-4</td><td><a href="#a1">親潮</a>, <a href="#a2">天霧</a></td></tr>
    </table>
    <h2>山風、親潮、浜波（2021/10/15～継続中）<a name ="a1"></a></h2>
    <table><tr><th>海域</th><th>エリア</th><th>ドロップ対象</th></tr>
      <tr><td>鎮守府</td><td>2-4-P(ボス)</td><td>親潮</td></tr>
    </table>
    <h2>春風（終了）、天霧、狭霧 (2021/03/30～一部継続中)<a name ="a2"></a></h2>
    <table><tr><th>海域</th><th>エリア</th><th>ドロップ対象</th></tr>
      <tr><td>鎮守府</td><td>2-4-P(ボス)</td><td>天霧</td></tr>
    </table>
    <h2>次</h2>`
  const master = [['親潮', 532], ['天霧', 479]]
  const limited = parseCurrentLimited(limitedHtml, shipsPack, master)
  const oyashio = limited.maps.get('2-4').get(532)
  assert.equal(oyashio.window.from, '2021-10-15', '全角括号的日期必须按本条解析')
  assert.equal(oyashio.window.label, '山風、親潮、浜波')
  const amagiri = limited.maps.get('2-4').get(479)
  assert.equal(amagiri.window.from, '2021-03-30')
  assert.equal(amagiri.window.label, '春風、天霧、狭霧', '（終了）标记要从标签洗掉')
})

test('normal-map rebuild preserves existing event difficulty layers', () => {
  const data = { schemaVersion: 1, maps: { '1-1': { nodes: {} } } }
  const event = { difficulties: { 甲: { nodes: {} }, 丁: { nodes: {} } } }
  const existing = { data: { maps: { '62-1': event, '1-2': { nodes: {} } } } }
  assert.equal(preserveEventMaps(data, existing), 1)
  assert.equal(data.maps['62-1'], event)
  assert.equal(data.maps['1-2'], undefined)
})

test('normal-map rebuild carries pending and ended limited history forward', () => {
  const data = {
    schemaVersion: 1,
    maps: {
      '1-1': {
        checkedAt: '2026-08-04',
        nodes: {
          C: {
            ships: [{ id: 1 }],
            emptyDrop: 'unknown',
            enemyComps: [],
          },
        },
      },
    },
  }
  const existing = {
    data: {
      maps: {
        '1-1': {
          nodes: {
            C: {
              ships: [
                {
                  id: 89,
                  limitedOnly: true,
                  limited: {
                    from: '2025-01-01',
                    until: null,
                    lastConfirmedAt: '2026-07-01',
                    status: 'active_confirmed',
                  },
                },
              ],
            },
          },
        },
      },
    },
  }
  assert.equal(preserveLimitedHistory(data, existing), 1)
  assert.deepEqual(data.maps['1-1'].nodes.C.ships[1], {
    id: 89,
    limitedOnly: true,
    limited: {
      from: '2025-01-01',
      until: null,
      lastConfirmedAt: '2026-07-01',
      status: 'end_pending',
      statusChangedAt: '2026-08-04',
    },
  })
})

test('event page is split into four difficulty layers without cross-difficulty fallback', () => {
  const enemy = (difficulty, anchor) => `
    <h3>${difficulty}作戦 <a name ="${anchor}"></a></h3>
    <table><tr><th>難易度</th><th>出現場所</th><th>パターン</th><th>海域Exp</th><th>出現艦船</th><th>陣形</th><th>基地航空隊半径</th></tr>
      <tr><td>${difficulty}</td><td>A：敵艦隊</td><td>パターン1 最終形態</td><td>10</td><td>駆逐イ級、駆逐ロ級</td><td>単縦</td><td>5</td></tr>
    </table>`
  const html = `
    ${enemy('甲', 'fleetk')}
    ${enemy('乙', 'fleeto')}
    ${enemy('丙', 'fleeth')}
    ${enemy('丁', 'fleett')}
    <a name ="airraid"></a>
    <h3>難易度別レア艦ドロップ <a name ="Dropsbydifficultylevel"></a></h3>
    <div class="fold-summary hidden-on-open">Bマス(ボス)</div>
    <div>※確定ドロップではありません！</div>
    <table><tr><th>艦名\\難易度</th><th>甲</th><th>乙</th><th>丙</th><th>丁</th></tr>
      <tr><th>睦月</th><td>S</td><td>A</td><td>-</td><td>S</td></tr>
    </table>
    <a name ="commentdrop"></a>
    <h3>装甲破砕</h3>
    <table><tr><th>マス\\難易度</th><th>甲</th><th>乙</th><th>丙</th><th>丁</th></tr>
      <tr><td>Cマス</td><td>S勝利</td><td>A勝利</td><td>-</td><td>到達</td></tr>
    </table>
    <h3>特効艦<a name ="Seffects"></a></h3>
    <table><tr><th>艦種/国籍/艦名</th><th>E1</th></tr>
      <tr><td>睦月</td><td>1.2x</td></tr>
      <tr><td colspan="2">注意</td></tr>
      <tr><td>鳳翔</td><td>这只是注意事项里的舰名</td></tr>
    </table>
    <h3>友軍<a name ="friend"></a></h3>
    <table><tr><th>旗艦</th><th>随伴艦</th><th>備考</th></tr>
      <tr><td>睦月</td><td>鳳翔</td><td>強友軍</td></tr>
    </table>
    <h3>次</h3>`
  const parsed = parseEventMapPage(html, shipsPack)
  assert.deepEqual(Object.keys(parsed.difficulties), ['甲', '乙', '丙', '丁'])
  assert.deepEqual(parsed.difficulties.甲.nodes.B.ships, [{ id: 1 }])
  assert.deepEqual(parsed.difficulties.乙.nodes.B.ships, [{ id: 1 }])
  assert.deepEqual(parsed.difficulties.丙.nodes.B.ships, [])
  assert.deepEqual(parsed.difficulties.丁.nodes.B.ships, [{ id: 1 }])
  assert.equal(parsed.difficulties.甲.nodes.B.emptyDrop, 'confirmed')
  assert.equal(parsed.difficulties.甲.nodes.A.enemyComps[0].phase, '最终形态')
  assert.equal(parsed.difficulties.甲.operations.nodeDistances.A, 5)
  assert.deepEqual(parsed.difficulties.甲.operations.gimmicks[0].steps, ['C点：S胜'])
  assert.deepEqual(parsed.difficulties.甲.operations.specialShips[0], {
    id: 1,
    label: '睦月',
    effect: 'E1 1.2x',
  })
  assert.equal(parsed.difficulties.甲.operations.specialShips.length, 1)
  assert.deepEqual(
    parsed.difficulties.甲.operations.friendlyFleets[0].ships.map((ship) => ship.id),
    [1, 89],
  )
})

test('友军还没实装时那张空模板不入包——「尚无已确认」与「确认没有」是两回事', () => {
  // 2026-08-24 实测 E1–E5：本期友军官方定在 08/26 夜以降投入，投入之前
  // wiki 的友军表是一副空模板——行里写的是字面量「艦娘名」，末尾挂着一行
  // 「友軍来援なし／最低保証枠」当图例。旧判据把那行图例读成事实，
  // 铎的「友军舰队」格于是显示「无友军支援」，看上去像已经确认过没有友军。
  const html = `
    <h3>友軍<a name ="friend"></a></h3>
    <table><tr><th>？マス（第xボス）</th><th>旗艦</th><th>随伴艦</th><th>備考</th></tr>
      <tr><td>-</td><td>艦娘名</td><td>艦娘名</td><td>「強友軍」枠</td></tr>
      <tr><td>-</td><td>艦娘名</td><td>()</td><td>「通常友軍」枠</td></tr>
      <tr><td>-</td><td>友軍来援なし</td><td></td><td>最低保証枠</td></tr>
    </table>
    <h3>次</h3>`
  assert.deepEqual(parseEventFriendlyFleets(html, shipsPack), [])
})

test('友军实装之后同一张表照旧解析，「来援なし」那时才重新有断言意义', () => {
  const html = `
    <h3>友軍<a name ="friend"></a></h3>
    <table><tr><th>マス</th><th>旗艦</th><th>随伴艦</th><th>備考</th></tr>
      <tr><td>Bマス</td><td>睦月</td><td>鳳翔</td><td>強友軍</td></tr>
      <tr><td>Cマス</td><td>友軍来援なし</td><td></td><td>最低保証枠</td></tr>
    </table>
    <h3>次</h3>`
  const fleets = parseEventFriendlyFleets(html, shipsPack)
  assert.deepEqual(fleets[0].ships.map((ship) => ship.id), [1, 89])
  assert.deepEqual(fleets[1], { ships: [], note: '无友军来援' })
})

test('友军编成的括号注记不当舰名解——「電」是電探的简写，不是電', () => {
  // 2026-08-27 上游 E4 首批友军实装当天的真实行文。舰名格后面跟一段連撃/CI 型注记，
  // 里面的「電」指的是電探；shipMatcher 是纯子串匹配，注记一起喂进去就会凭空多出
  // 几位随伴舰電（mstId 37）。当天用户在 62-4 丙 Boss 点实遇的三支里一位電都没有——
  // 假舰是靠这一层对照才现形的，所以用例拿真实字串钉，别简化成造字。
  const pack = {
    data: {
      a: { ID: 553, 日文名: '伊勢改二' },
      b: { ID: 554, 日文名: '日向改二' },
      c: { ID: 314, 日文名: '酒匂改' },
      d: { ID: 716, 日文名: '梅改' },
      e: { ID: 708, 日文名: '桃改' },
      f: { ID: 37, 日文名: '電' },
    },
  }
  const html = `
    <h3>友軍<a name ="friend"></a></h3>
    <table><tr><th>Zマス( 第五ボス )</th><th>旗艦</th><th>随伴艦</th><th>備考</th></tr>
      <tr><td>伊勢改二 (連撃&主主瑞,探照灯)</td><td>日向改二 (連撃&主主瑞,照明弾)</td><td>酒匂改 (連撃)</td><td>梅改 (魚魚主&主魚電&魚水電)</td><td>桃改 (魚魚魚&魚水魚)</td><td>「強友軍」枠</td></tr>
    </table>
    <h3>次</h3>`
  const fleets = parseEventFriendlyFleets(html, pack)
  assert.equal(fleets.length, 1)
  assert.deepEqual(
    fleets[0].ships.map((ship) => ship.id),
    [553, 554, 314, 716, 708],
  )
  assert.ok(
    !fleets[0].ships.some((ship) => ship.id === 37),
    '注记里的電探简写不该变成一位随伴舰電',
  )
})

test('空模板里的括号注记也不算「已实装」——抹注记那一步两处都要走', () => {
  // 反方向那一半：判「整张表还是空模板」的那一步若拿原文匹配，
  // 注记里蹦出一个短舰名就会把模板判成已实装，铎那一格转而端出一副
  // 由装备缩写拼成的假编成——比空着更坏。
  const pack = { data: { f: { ID: 37, 日文名: '電' } } }
  const html = `
    <h3>友軍<a name ="friend"></a></h3>
    <table><tr><th>？マス（第xボス）</th><th>旗艦</th><th>随伴艦</th><th>備考</th></tr>
      <tr><td>-</td><td>艦娘名 (CI種類&CI種類+特効装備,主魚電)</td><td>艦娘名 ()</td><td>「強友軍」枠</td></tr>
      <tr><td>-</td><td>友軍来援なし</td><td></td><td>最低保証枠</td></tr>
    </table>
    <h3>次</h3>`
  assert.deepEqual(parseEventFriendlyFleets(html, pack), [])
})

test('map-intel diff exposes pending drops and per-difficulty enemy changes', () => {
  const before = {
    data: {
      maps: {
        '1-1': {
          nodes: {
            C: {
              ships: [
                {
                  id: 89,
                  limitedOnly: true,
                  limited: {
                    from: '2025-01-01',
                    until: null,
                    lastConfirmedAt: '2026-01-01',
                    status: 'active_confirmed',
                  },
                },
              ],
              enemyComps: [],
            },
          },
        },
      },
    },
  }
  const after = structuredClone(before)
  after.data.maps['1-1'].nodes.C.ships[0].limited.status = 'end_pending'
  after.data.maps['1-1'].nodes.C.ships[0].limited.statusChangedAt = '2026-08-04'
  const diff = buildMapIntelDiff(before, after)
  assert.equal(diff.summary.pendingDrops, 1)
  assert.equal(diff.summary.removedDrops, 0)
})

test('敌编成的标注文本改了，人工那道闸要看得见（labels 不进身份键，但它是玩家读到的字）', () => {
  const pack = (label) => ({
    data: {
      maps: {
        '62-5': {
          difficulties: {
            甲: {
              nodes: {
                X: {
                  ships: [],
                  enemyComps: [{ formation: 1, ships: [1778], labels: [label] }],
                },
              },
            },
          },
        },
      },
    },
  })
  const before = pack('軽母ヌ級改 elite 艦載機鳥白')
  const after = pack('軽母ヌ級改 elite 艦載機黒')
  const diff = buildMapIntelDiff(before, after)
  // 阵形与舰列都没动，所以既不算新增也不算删除——但那一行字变了，必须单独报出来
  assert.equal(diff.summary.addedEnemyComps, 0)
  assert.equal(diff.summary.removedEnemyComps, 0)
  assert.equal(diff.summary.changedEnemyCompLabels, 1)
  const one = diff.changes.changedEnemyCompLabels[0]
  assert.deepEqual(one.before, ['軽母ヌ級改 elite 艦載機鳥白'])
  assert.deepEqual(one.after, ['軽母ヌ級改 elite 艦載機黒'])
  assert.equal(one.map, '62-5')
  assert.equal(one.difficulty, '甲')
  assert.equal(one.node, 'X')
  // 没改标注的一批不许被顺手报进来
  assert.equal(buildMapIntelDiff(before, structuredClone(before)).summary.changedEnemyCompLabels, 0)
})

// operations 层的原型场景：2026-08-27 刷新 62 期活动包，友军编成从零涨到满
// （官方 08-26 夜投入，wiki 随即填表），16 个图×难度层一齐长出友军——
// 而当时的差异摘要打印的是整排 0，人工那道闸对这一整层全程失明。
// 与上面那条 changedEnemyCompLabels 同族：不进身份键 ≠ 玩家看不见。
const operationsPack = (build) => {
  const maps = {}
  for (const map of ['62-1', '62-2', '62-3', '62-4']) {
    const difficulties = {}
    for (const difficulty of ['甲', '乙', '丙', '丁']) {
      difficulties[difficulty] = {
        nodes: { A: { ships: [], enemyComps: [] } },
        operations: build(map, difficulty),
      }
    }
    maps[map] = { difficulties }
  }
  return { data: { maps } }
}

// 上游一张友军表是整页共用的（不分难度），所以一张图的十条友军会同时落到甲乙丙丁四层
const friendlyFleetsOf = (map) =>
  Array.from({ length: 10 }, (unused, index) => ({
    ships: [{ id: 500 + index, name: `${map} 友军 ${index}` }],
    note: '「强友军」枠',
  }))

test('友军/机关/特效舰/点位半径改了，人工那道闸要看得见（operations 整层不进 nodes，但它全是玩家读到的字）', () => {
  const before = operationsPack(() => ({
    gimmicks: [{ title: 'E1-1（战力）', steps: ['C2点：S胜 x2'] }],
    specialShips: [{ label: '海防舰', effect: '海域倍率 1.12' }],
    friendlyFleets: [],
    nodeDistances: { A: 2, B: 1 },
  }))
  const after = operationsPack((map) => ({
    gimmicks: [{ title: 'E1-1（战力）', steps: ['C2点：S胜 x2'] }],
    specialShips: [{ label: '海防舰', effect: '海域倍率 1.12' }],
    friendlyFleets: friendlyFleetsOf(map),
    nodeDistances: { A: 2, B: 1 },
  }))
  const diff = buildMapIntelDiff(before, after)
  // 点位与敌编成一个字没动，所以现有那几排照旧是 0——正因如此，摸不到 operations
  // 的旧版本对这次刷新只会打印整排 0
  assert.equal(diff.summary.addedDrops, 0)
  assert.equal(diff.summary.addedEnemyComps, 0)
  assert.equal(diff.summary.changedEnemyCompLabels, 0)
  // 摘要按 map+difficulty 计数：4 张图 × 4 难度 = 16 层一齐长出友军
  assert.equal(diff.summary.changedFriendlyFleets, 16)
  const fleets = diff.changes.changedFriendlyFleets
  assert.equal(
    fleets.reduce((sum, entry) => sum + entry.added.length, 0),
    160,
    '16 层各新增 10 条友军，细目要落到条目里给人核对',
  )
  // 挑一层出来看细目（排序沿用本文件既有的 zh-CN collation，别把顺序当断言）
  const jia = fleets.find((entry) => entry.map === '62-1' && entry.difficulty === '甲')
  assert.ok(jia, '62-1 甲 这一层必须在报告里')
  assert.equal(jia.added.length, 10)
  assert.equal(jia.removed.length, 0)
  assert.deepEqual(jia.added[0].ships, [{ id: 500, name: '62-1 友军 0' }])
  // 没动的三兄弟不许被顺手报进来
  assert.equal(diff.summary.changedGimmicks, 0)
  assert.equal(diff.summary.changedSpecialShips, 0)
  assert.equal(diff.summary.changedNodeDistances, 0)

  // 另外三样各自也要有闸：机关条件、特效倍率、点位半径都是铎里直接显示的数
  const gimmickChanged = buildMapIntelDiff(
    before,
    operationsPack(() => ({
      gimmicks: [{ title: 'E1-1（战力）', steps: ['C2点：S胜 x2', 'F点：航空优势 x2'] }],
      specialShips: [{ label: '海防舰', effect: '海域倍率 1.12' }],
      friendlyFleets: [],
      nodeDistances: { A: 2, B: 1 },
    })),
  )
  assert.equal(gimmickChanged.summary.changedGimmicks, 16)
  const specialChanged = buildMapIntelDiff(
    before,
    operationsPack(() => ({
      gimmicks: [{ title: 'E1-1（战力）', steps: ['C2点：S胜 x2'] }],
      specialShips: [{ label: '海防舰', effect: '海域倍率 1.25' }],
      friendlyFleets: [],
      nodeDistances: { A: 2, B: 1 },
    })),
  )
  assert.equal(specialChanged.summary.changedSpecialShips, 16)

  // 半径是同一个点位的事实变了,要报成「变更」而不是删了 2 又加了 5
  const distanceChanged = buildMapIntelDiff(
    before,
    operationsPack(() => ({
      gimmicks: [{ title: 'E1-1（战力）', steps: ['C2点：S胜 x2'] }],
      specialShips: [{ label: '海防舰', effect: '海域倍率 1.12' }],
      friendlyFleets: [],
      nodeDistances: { A: 5, C: 3 },
    })),
  )
  assert.equal(distanceChanged.summary.changedNodeDistances, 16)
  const distances = distanceChanged.changes.changedNodeDistances[0]
  assert.deepEqual(distances.changed, [{ node: 'A', before: 2, after: 5 }])
  // 半径的新增/删除必须自带点名，光报个数字等于没报
  assert.deepEqual(distances.added, [{ node: 'C', distance: 3 }])
  assert.deepEqual(distances.removed, [{ node: 'B', distance: 1 }])

  // 什么都没改的一版必须整排是 0——否则这道闸天天喊狼来了，人就不看了
  const quiet = buildMapIntelDiff(before, structuredClone(before)).summary
  assert.equal(quiet.changedFriendlyFleets, 0)
  assert.equal(quiet.changedGimmicks, 0)
  assert.equal(quiet.changedSpecialShips, 0)
  assert.equal(quiet.changedNodeDistances, 0)
})

test('an unapproved candidate blocks another refresh unless explicitly forced', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'kanso-map-intel-review-'))
  const output = path.join(directory, 'map-intel.json')
  try {
    const reviewDirectory = path.join(directory, 'review')
    mkdirSync(reviewDirectory)
    writeFileSync(path.join(reviewDirectory, 'map-intel.diff.json'), JSON.stringify({}))
    assert.throws(() => assertNoPendingMapIntelCandidate(output), /未批准/)
    assert.doesNotThrow(() => assertNoPendingMapIntelCandidate(output, true))
    writeFileSync(
      path.join(reviewDirectory, 'map-intel.diff.json'),
      JSON.stringify({ approvedAt: '2026-08-04T00:00:00.000Z' }),
    )
    assert.doesNotThrow(() => assertNoPendingMapIntelCandidate(output))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('常规图清单以主数据推导:5-6 实装后不再被写死表漏抓', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const mapLast = loadNormalMapLast(repoRoot)
  assert.deepEqual(Object.keys(mapLast).sort(), ['1', '2', '3', '4', '5', '6', '7'])
  assert.ok(mapLast[5] >= 6, `5 区至少 6 张图(5-6 已实装),实际 ${mapLast[5]}`)
  const total = Object.values(mapLast).reduce((sum, last) => sum + last, 0)
  assert.ok(total >= 37, `常规图总数至少 37,实际 ${total}`)
})

const packFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'lodes', 'map-intel.json')
test('map-intel 真包:5-6 整图收录(掉落点+敌编成,id 已钉)', { skip: !existsSync(packFile) }, () => {
  const pack = JSON.parse(readFileSync(packFile, 'utf8'))
  const map = pack.data.maps['5-6']
  assert.ok(map, '5-6 必须在目录里')
  const nodes = Object.values(map.nodes ?? {})
  assert.ok(nodes.length >= 10, `5-6 节点至少 10 个,实际 ${nodes.length}`)
  const drops = nodes.reduce((sum, node) => sum + (node.ships?.length ?? 0), 0)
  const comps = nodes.reduce((sum, node) => sum + (node.enemyComps?.length ?? 0), 0)
  assert.ok(drops >= 200, `5-6 掉落条目至少 200,实际 ${drops}`)
  assert.ok(comps >= 50, `5-6 敌编成至少 50,实际 ${comps}`)
  const pinned = nodes.flatMap((node) => node.enemyComps ?? []).filter((comp) => Array.isArray(comp.shipIds) && comp.shipIds.length)
  assert.ok(pinned.length >= 30, `5-6 已钉 id 的编成至少 30,实际 ${pinned.length}`)
})
// 敌联合舰队在敵編成表里是两行制:パターン格 rowspan=2,主力行 + 只有出現艦船
// 一格的随伴裸行。判据是格子恒等(tableGrid 的 rowspan 继承用同一对象)+ 陣形含
// 「第N警戒」;G 点空袭那种「同名パターン两行各带自己格子」绝不误并。
// 2026-08-12 实锤:6-5 M 与活动图的联合编成此前被拆成两条 6 舰半队,
// 机制估算整个活动期间拿主力半队硬算胜率,随伴 6 舰凭空消失。
test('敌联合编成两行并一条:主力+随伴入同一编成,同名パターン不误并', () => {
  const html = `
    <div class="fold-summary hidden-on-open">敵編成</div>
    <table><tbody>
      <tr><th>出現場所</th><th>パターン</th><th>EXP</th><th>出現艦船</th><th>陣形</th></tr>
      <tr><td rowspan="4">M：ボス</td><td rowspan="2">パターン1</td><td rowspan="2">600</td><td>空母棲姫(艦載機白)、重巡リ級flagship</td><td rowspan="4">第三警戒航行序列</td></tr>
      <tr><td>軽巡ヘ級flagship、駆逐イ級後期型</td></tr>
      <tr><td rowspan="2">パターン2</td><td rowspan="2">620</td><td>空母棲姫(艦載機白)、軽巡ツ級elite</td></tr>
      <tr><td>軽巡ヘ級flagship、駆逐ハ級後期型</td></tr>
      <tr><td rowspan="2">G：空襲戦</td><td>パターン3</td><td>250</td><td>空母棲姫(艦載機白)、駆逐ニ級後期型</td><td rowspan="2">輪形</td></tr>
      <tr><td>パターン3</td><td>200</td><td>空母棲姫(艦載機白)、駆逐ロ級後期型</td></tr>
    </tbody></table>`
  assert.deepEqual(parseEnemyTable(html), {
    M: [
      { formation: '第三警戒航行序列', ships: ['空母棲姫(艦載機白)', '重巡リ級flagship', '軽巡ヘ級flagship', '駆逐イ級後期型'], exp: 600 },
      { formation: '第三警戒航行序列', ships: ['空母棲姫(艦載機白)', '軽巡ツ級elite', '軽巡ヘ級flagship', '駆逐ハ級後期型'], exp: 620 },
    ],
    G: [
      { formation: 3, ships: ['空母棲姫(艦載機白)', '駆逐ニ級後期型'], exp: 250 },
      { formation: 3, ships: ['空母棲姫(艦載機白)', '駆逐ロ級後期型'], exp: 200 },
    ],
  })
})

// 海域撃破ボーナス:th rowspan 一列,首行共通、后续「+ N作戦」逐难度;
// 正文 wiki 原文照录(选择肢/★+N/「なし」都保留),认不出标签的行归共通不丢
test('活动页突破奖励:共通与各难度行解析,原文照录', () => {
  const html = `
    <table><tbody>
      <tr><th rowspan="3">海域撃破ボーナス</th><td colspan="2"><strong>共通</strong>:<a href="/x" title="Reno">Reno</a></td></tr>
      <tr><td colspan="2"><strong>+ 甲作戦</strong>:<a href="/y" title="勲章">勲章</a> x2、<a href="/z" title="SB2U-2">SB2U-2</a><span>★+9</span> x1</td></tr>
      <tr><td colspan="2"><strong>+ 丁作戦</strong>:なし</td></tr>
    </tbody></table>`
  assert.deepEqual(parseEventBreakthroughBonus(html), [
    { scope: '共通', text: 'Reno' },
    { scope: '甲', text: '勲章 x2、SB2U-2★+9 x1' },
    { scope: '丁', text: 'なし' },
  ])
})

// 2026-08-26 有一份报告说「活动图掉落抓取把带数字后缀的点位丢了，大概率是只认单字母的
// 正则或单字符切分」，举证是 62-1 掉落只有 I/T/X、62-4 只有 D/N/R/S/V/X/Y/Z，数字点零条。
// **这个归因是假的**，逐层查证如下（别再按「只认单字母」去改解析，会改出真 bug）：
//   · nodeNames 的 /\b([A-Z]{1,2}\d*)\b/g 本来就收数字后缀；
//   · 62-5 的 J2 点（上游原文「J2マス(第二ボス)」）一路进到了正式包的掉落里——
//     数字点走通过端到端，这一条就否掉了「数字被吃掉」；
//   · 真正的原因在上游：那张「難易度別レア艦ドロップ」只逐点收 boss 与个别点。
//     62-4 该区总共只有 8 张表（D/N/R/S/V/X/Y/Z），字符串 "P1" 在整个区里出现 0 次；
//     同样没有掉落的还有 A/AB/B/C/E/G/H/I/J/K/Q/U/W 十三个**纯字母**点。
//     缺的是「非 boss 点」，不是「数字点」——两个举证图恰好 boss 都不带数字而已。
// 于是这条护栏钉两件事：数字点名照原样进掉落表（不许被截成单字母），
// 以及上游没收的点不凭空补（空着是如实的「这一层没有该点的确认掉落」）。
test('活动难度别掉落:带数字后缀的点名照原样入表,上游没收的点不凭空补', () => {
  const html = `
    <h3>難易度別レア艦ドロップ <a name ="Dropsbydifficultylevel"></a></h3>
    <div class="fold-summary hidden-on-open">P1マス</div>
    <table><tr><th>艦名\\難易度</th><th>甲</th><th>乙</th><th>丙</th><th>丁</th></tr>
      <tr><th>睦月</th><td>S</td><td>A</td><td>S</td><td>-</td></tr>
    </table>
    <div class="fold-summary hidden-on-open">T1マス(第二ボス)</div>
    <table><tr><th>艦名\\難易度</th><th>甲</th><th>乙</th><th>丙</th><th>丁</th></tr>
      <tr><th>鳳翔</th><td>-</td><td>-</td><td>S</td><td>-</td></tr>
    </table>
    <a name ="commentdrop"></a>`
  const { drops } = parseEventDifficultyDrops(html, shipsPack)

  // 数字后缀原样保留:四难度各按自己那一列判,不跨难度回退
  assert.deepEqual(drops.甲.P1, [{ id: 1 }])
  assert.deepEqual(drops.乙.P1, [{ id: 1 }])
  assert.deepEqual(drops.丙.P1, [{ id: 1 }])
  assert.equal(drops.丁.P1, undefined)
  assert.deepEqual(drops.丙.T1, [{ id: 89 }])

  // 关键反向断言:数字不许被截掉。若哪天有人「修」成单字母切分,
  // P1/T1 会塌成 P/T 挂到别的点上——那是把掉落错挂,比缺条目更坏。
  assert.equal(drops.甲.P, undefined)
  assert.equal(drops.丙.T, undefined)
  assert.deepEqual(Object.keys(drops.丙).sort(), ['P1', 'T1'])

  // 上游那一区没收的点(这里连表都没有)照旧缺席,解析不代为补齐
  assert.equal(drops.甲.Q, undefined)

  // 正则那一层单独钉一遍:两位字母 + 数字后缀都要收全
  assert.deepEqual(nodeNames('P1マス'), ['P1'])
  assert.deepEqual(nodeNames('J2マス(第二ボス)'), ['J2'])
  assert.deepEqual(nodeNames('ZZマス(第四ボス)'), ['ZZ'])
  assert.deepEqual(nodeNames('Dマス(第一ボス)'), ['D'])
})

// 上游「ドロップ艦一覧」那张**不分难度**的总表(锚点 drop)。途中点的掉落只有它有——
// 分难度那张只逐点收 boss 与个别点。2026-08-26 用户拍板 B 案后开始收这一层,
// 但它必须单独存放:合算值写进丙层就是拿甲乙丙丁的合计冒充丙的事实。
test('活动全难度合算掉落:按点位收,数字后缀点在内,没有报告的点不写空条目', () => {
  const html = `
    <h3>ドロップ艦一覧 <a name ="drop"></a></h3>
    <div class="fold-summary hidden-on-open">ドロップ表</div>
    <table><tbody>
      <tr><th></th><th>戦艦級</th><th>駆逐艦</th></tr>
      <tr><td>D 第一 ボス</td><td>睦月</td><td>鳳翔</td></tr>
      <tr><td>P1</td><td></td><td>睦月</td></tr>
      <tr><td>P2</td><td></td><td></td></tr>
    </tbody></table>
    <h3>難易度別レア艦ドロップ <a name ="Dropsbydifficultylevel"></a></h3>`
  const nodes = parseEventAllDifficultyDrops(html, shipsPack)

  // 数字后缀点照收——这一层的意义就在于它有 P1 这类途中点
  assert.deepEqual(nodes.P1, [{ id: 1 }])
  // 行首带「第一 ボス」后缀也照样认出点名
  assert.deepEqual(nodes.D, [{ id: 1 }, { id: 89 }])
  // 上游涂灰(没有掉落报告)的点不写成空数组:那是「没有报告」,不是「确认不掉」,
  // 写成空条目会让展示层把它当成「已收录且确认空」
  assert.equal('P2' in nodes, false)
})
