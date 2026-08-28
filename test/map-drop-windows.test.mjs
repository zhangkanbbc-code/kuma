// 限定期台账（map-drop-windows，2026-08-22 批次 4）的护栏。
//
// 这一域的错法有一个共同点：**都不报错**。窗口带丢了只是「限时」标安静消失，
// 三态判反了只是措辞说错，收窗折叠写反了只是把还能捞的线索藏起来。
// 所以这里的断言尽量跑真函数、真包，不去匹配源码文本。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  CLOSED_WINDOW_SAMPLE_FLOOR,
  PENDING_LIMITED_WINDOW_CLAIMS,
  confirmLedgerWindowEnd,
  diffLimitedLedger,
  ledgerEntries,
  ledgerPhaseTally,
  limitedDiffFingerprint,
  suspectedClosedWindows,
} from '../scripts/lib/map-drop-windows.mjs'
import limitedWindow from '../dist/shared/limited-window.js'
import mapIntel from '../dist/shared/map-intel.js'

const {
  isActiveLimitedWindow,
  isClosedLimitedWindow,
  limitedWindowCovers,
  limitedWindowPhase,
  limitedWindowText,
  localDropEraOf,
} = limitedWindow
const {
  applyMapDropWindows,
  applyMapDrops,
  applyMapEnemyComps,
  applyMapIntelCatalog,
  limitedLedgerInfo,
  limitedWindowsOf,
  mapIntelNode,
} = mapIntel

const TODAY = '2026-08-22'
const win = (over = {}) => ({
  from: '2025-01-01',
  until: null,
  lastConfirmedAt: '2026-06-26',
  ...over,
})

test('限定期三态：没有截止日 / 有截止日还没到 / 已收窗，外加「说不出日子」那一档', () => {
  // ① 没有截止日是**常规图限定的常态**，是如实记录不是资料缺失。
  //    判成「即将结束」就是凭空造紧迫感（用户 2026-08-09 当面纠正过的那条）。
  assert.equal(limitedWindowPhase(win(), TODAY), 'open_undated')
  assert.equal(isActiveLimitedWindow(win(), TODAY), true)
  assert.equal(isClosedLimitedWindow(win(), TODAY), false)

  // ② 有截止日且还没到：真的有个日子要赶
  assert.equal(limitedWindowPhase(win({ until: '2026-12-31' }), TODAY), 'open_dated')
  assert.equal(isActiveLimitedWindow(win({ until: '2026-12-31' }), TODAY), true)
  // 边界那天算在窗口内——差一天就把玩家赶走是最没必要的一种错
  assert.equal(limitedWindowPhase(win({ until: TODAY }), TODAY), 'open_dated')

  // ③ 截止日已过 = 已收窗
  const closed = win({ until: '2026-01-31', status: 'ended_confirmed', statusChangedAt: '2026-02-01' })
  assert.equal(limitedWindowPhase(closed, TODAY), 'closed')
  assert.equal(isActiveLimitedWindow(closed, TODAY), false)
  assert.equal(isClosedLimitedWindow(closed, TODAY), true)

  // ④ 上游不再列出、但没人说得出哪天关的：单独一档，**不算已收窗**。
  //    说不出日子就没法断言某次观测落在窗口内，硬折进往期是把猜测当事实。
  const pending = win({ status: 'end_pending', statusChangedAt: '2026-06-26' })
  assert.equal(limitedWindowPhase(pending, TODAY), 'end_pending')
  assert.equal(isActiveLimitedWindow(pending, TODAY), false)
  assert.equal(isClosedLimitedWindow(pending, TODAY), false)

  // ⑤ 判据只看日期不看 status 字面：已确认会关、但那天还没到，此刻它还在掉
  assert.equal(
    limitedWindowPhase(win({ until: '2026-12-31', status: 'ended_confirmed' }), TODAY),
    'open_dated',
  )

  // 窗口覆盖：闭区间，无截止日的窗口对 from 之后的任何一天都成立
  assert.equal(limitedWindowCovers(win(), '2025-01-01'), true)
  assert.equal(limitedWindowCovers(win(), '2024-12-31'), false)
  assert.equal(limitedWindowCovers(win({ until: '2026-01-31' }), '2026-01-31'), true)
  assert.equal(limitedWindowCovers(win({ until: '2026-01-31' }), '2026-02-01'), false)
})

test('措辞：没有截止日说「暂无截止日期」，不许说成快关门', () => {
  assert.equal(limitedWindowText(win({ label: '節分' })), '【節分】2025/01/01–暂无截止日期')
  assert.equal(limitedWindowText(win({ until: '2026-01-31' })), '2025/01/01–2026/01/31')
  // 「没有日期」与「快到期」含义相反，措辞里一个字都不许沾
  for (const bad of ['即将', '快关门', '快到期', '倒计时', '抓紧']) {
    assert.ok(!limitedWindowText(win()).includes(bad), `没有截止日的窗口措辞里出现了「${bad}」`)
  }
})

test('⑤-裁-2：捞到过的记录永不删除，只在窗口收了之后换语境', () => {
  const closed = win({ from: '2025-01-01', until: '2026-01-31', status: 'ended_confirmed' })
  const open = win({ from: '2025-01-01' })

  // 观测落在已收窗的窗口里 → 往期
  const past = localDropEraOf([closed], '2025-06-01', TODAY)
  assert.equal(past.era, 'past')
  assert.equal(past.window, closed, '要说得出是哪一段窗口，光说「过期了」等于没给线索')

  // 开着/无截止的窗口（常规图常态）→ 原样显示，什么都不用做
  assert.equal(localDropEraOf([open], '2025-06-01', TODAY).era, 'current')
  assert.equal(localDropEraOf([open], '2025-06-01', TODAY).window, null)

  // 根本没有限定期的条目 → 原样显示
  assert.equal(localDropEraOf([], '2025-06-01', TODAY).era, 'current')

  // **窗口关了之后又捞到过 → 还是 current**。这不是漏判：那正说明它其实还在掉，
  // 台账那一条该被重核。数据要诚实，不能因为台账说关了就把实测按到往期去。
  assert.equal(localDropEraOf([closed], '2026-08-01', TODAY).era, 'current')

  // 同一条船在同一点开过两次：撞上哪一段就按哪一段算
  const older = win({ from: '2023-01-01', until: '2023-03-01', status: 'ended_confirmed' })
  assert.equal(localDropEraOf([closed, older], '2023-02-01', TODAY).window, older)
  assert.equal(localDropEraOf([closed, older], '2024-06-01', TODAY).era, 'current')
})

test('until 全是 null 时，一条都不会被判成「窗口已结束」', () => {
  // 方案 §3.3 那条口径钉成行为护栏：常规图限定的常态就是没有截止日，
  // 「没写日期」永远不能被读成「关了」或「快关了」。
  const windows = [win({ from: '2020-01-01' }), win({ from: '2026-08-01' })]
  for (const one of windows) {
    assert.notEqual(limitedWindowPhase(one, TODAY), 'closed')
    assert.equal(isClosedLimitedWindow(one, TODAY), false)
  }
  for (const seen of ['2020-06-01', '2026-08-20']) {
    assert.equal(localDropEraOf(windows, seen, TODAY).era, 'current')
  }
})

// ---- 装配 ----

const baseMap = (nodes) => ({
  source: 's',
  sourceUrl: 'u',
  checkedAt: '2026-01-01',
  revision: 'r',
  nodes,
})
const node = (ships) => ({ ships, emptyDrop: 'unknown', enemyComps: [] })
const evidence = { kind: 'community', note: '社区资料整理，只作参考', recordedAt: '2026-08-22' }

test('台账是限定期的唯一出处：覆盖到的图先清空再写，没覆盖的图一格不碰', () => {
  assert.ok(
    applyMapIntelCatalog({
      schemaVersion: 1,
      maps: {
        // 底座里带着上一代的窗口——台账覆盖这张图，它一律不许被继承
        '9-1': baseMap({
          A: node([{ id: 100, limited: win({ from: '2001-01-01' }) }, { id: 200 }]),
        }),
        // 台账不覆盖的图：底座那份原样留着（活动图与还没录进台账的常规图都走这条）
        '9-2': baseMap({ A: node([{ id: 300, limited: win({ from: '2002-02-02' }) }]) }),
      },
    }),
  )
  assert.ok(
    applyMapDropWindows({
      schemaVersion: 1,
      compiledAt: '2026-08-22',
      checkedAt: '2026-06-26',
      source: 'kuma 限定期台账（第一方维护）',
      revision: '2026.08.22',
      maps: {
        '9-1': {
          A: [
            { id: 200, window: win({ from: '2025-05-05', label: '梅雨' }), evidence },
            // 掉落层没列它（limitedOnly 的本来就「平时不掉」）——必须补一条，不然线索整条消失
            { id: 999, limitedOnly: true, window: win({ from: '2025-06-06' }), evidence },
          ],
        },
      },
    }),
  )

  const a = mapIntelNode('9-1', 'A', TODAY)
  const byId = new Map(a.ships.map((ship) => [ship.id, ship]))
  assert.equal(byId.get(100)?.limited, undefined, '底座残留的窗口被继承了——那一域该只有台账一个出处')
  assert.equal(byId.get(200)?.limited.from, '2025-05-05')
  assert.equal(byId.get(200)?.limited.label, '梅雨')
  assert.equal(byId.get(999)?.limitedOnly, true, '台账里有、掉落层没列的那一条没补进来')
  assert.equal(mapIntelNode('9-2', 'A', TODAY).ships[0].limited.from, '2002-02-02', '台账没覆盖的图被清了')

  // 「源」角标要说这一格自己的核对日，不拿别的包的日期背书
  assert.deepEqual(limitedLedgerInfo(), {
    source: 'kuma 限定期台账（第一方维护）',
    checkedAt: '2026-06-26',
    revision: '2026.08.22',
  })
})

test('已收窗的窗口：当前目录里隐去，本机确认层却必须查得到', () => {
  const closed = win({ from: '2025-01-01', until: '2026-01-31', status: 'ended_confirmed' })
  assert.ok(
    applyMapIntelCatalog({
      schemaVersion: 1,
      maps: { '9-3': baseMap({ A: node([{ id: 100 }, { id: 200 }]) }) },
    }),
  )
  assert.ok(
    applyMapDropWindows({
      schemaVersion: 1,
      compiledAt: '2026-08-22',
      checkedAt: '2026-06-26',
      source: 's',
      revision: 'r',
      maps: {
        '9-3': {
          A: [
            { id: 100, limitedOnly: true, window: closed, evidence },
            { id: 200, window: closed, evidence },
          ],
        },
      },
    }),
  )
  const a = mapIntelNode('9-3', 'A', TODAY)
  // 「现在去哪捞」这一路：限定专属的整条隐去，常驻舰保留但摘掉失效的标签
  assert.deepEqual(a.ships.map((ship) => ship.id), [200])
  assert.equal(a.ships[0].limited, undefined)
  // 本机确认层这一路：**必须读得到已收窗的那一段**，否则永远判不出「限定期捞到 · 窗口已结束」
  assert.equal(limitedWindowsOf('9-3', 100).length, 1)
  assert.equal(limitedWindowsOf('9-3', 100)[0].window.until, '2026-01-31')
  assert.deepEqual(limitedWindowsOf('9-3', 100, 'B'), [], '按点过滤要认得点位')
  assert.deepEqual(limitedWindowsOf('9-3', 777), [])
  assert.equal(
    localDropEraOf(limitedWindowsOf('9-3', 100).map((one) => one.window), '2025-06-01', TODAY).era,
    'past',
  )
})

test('掉落域没人供数据时，台账不许把 limitedOnly 补成一份「确认掉落表」', () => {
  // 2026-08-22 验收侧点名的那一档（用户包目录里塞一个覆盖面更小的同 id map-drops）实测出来的洞：
  // 台账的「补一条」是为了救 limitedOnly 那批（社区掉落表本来就不列它们），
  // 但掉落域整张图都没人供的时候，补出来的几条会让界面显示成「已确认 N 舰」——
  // 而它们恰恰最不该被当成完整掉落表（玩家会以为这张图就只掉这几条）。
  // 这是「不建半张图」那条纪律在**点位**一级的落实。
  const ledger = {
    schemaVersion: 1,
    compiledAt: '2026-08-22',
    checkedAt: '2026-06-26',
    source: 's',
    revision: 'r',
    maps: {
      '9-5': { P: [{ id: 441, limitedOnly: true, window: win({ from: '2026-02-13' }), evidence }] },
      '9-6': { P: [{ id: 441, limitedOnly: true, window: win({ from: '2026-02-13' }), evidence }] },
    },
  }
  // 9-5 的掉落域有人供（底座带着 ships），9-6 没有（图是编成层建出来的空壳）
  assert.ok(
    applyMapIntelCatalog({
      schemaVersion: 1,
      maps: { '9-5': baseMap({ P: node([{ id: 1 }]) }) },
    }),
  )
  assert.ok(
    applyMapEnemyComps({
      schemaVersion: 1,
      compiledAt: '2026-08-22',
      maps: {
        '9-6': {
          source: 'c', sourceUrl: 'u', checkedAt: '2026-08-22', revision: 'r',
          nodes: { P: [{ formation: 1, ships: [1501], votes: ['kcwiki'] }] },
        },
      },
    }),
  )
  assert.ok(applyMapDropWindows(ledger))

  // 有人供 → 照常补，limitedOnly 那条线索不许消失
  const supplied = mapIntelNode('9-5', 'P', TODAY)
  assert.deepEqual(supplied.ships.map((ship) => ship.id).sort((a, b) => a - b), [1, 441])
  assert.equal(supplied.ships.find((ship) => ship.id === 441).limitedOnly, true)

  // 没人供 → 一条都不补。界面据此说「待更新」，而不是「已确认 1 舰」
  const bare = mapIntelNode('9-6', 'P', TODAY)
  assert.deepEqual(bare.ships, [], '掉落域没人供，台账却补出了一份看着像掉落表的东西')
  assert.equal(bare.enemyComps.length, 1, '编成那一格不该被牵连')
  // 窗口本身仍旧查得到（本机确认层要用它判「限定期捞到」）
  assert.equal(limitedWindowsOf('9-6', 441).length, 1)
})

test('掉落层与台账的叠加顺序固定：掉落层整格重写 ships，台账必须最后叠', () => {
  assert.ok(
    applyMapIntelCatalog({
      schemaVersion: 1,
      maps: { '9-4': baseMap({ A: node([{ id: 1 }]) }) },
    }),
  )
  assert.ok(
    applyMapDropWindows({
      schemaVersion: 1,
      compiledAt: '2026-08-22',
      checkedAt: '2026-06-26',
      source: 's',
      revision: 'r',
      maps: { '9-4': { A: [{ id: 2, window: win({ from: '2025-05-05' }), evidence }] } },
    }),
  )
  // 台账先到、掉落层后到：装配顺序由 rebuildCatalog 定死，两边到达顺序不影响结果
  assert.ok(
    applyMapDrops({
      schemaVersion: 1,
      compiledAt: '2026-08-22',
      maps: {
        '9-4': {
          source: 'c',
          sourceUrl: 'u',
          checkedAt: '2026-08-22',
          revision: 'r',
          nodes: { A: { emptyDrop: 'confirmed', ships: [{ id: 1, votes: ['kcwiki'] }, { id: 2, votes: ['kcwiki'] }] } },
        },
      },
    }),
  )
  const a = mapIntelNode('9-4', 'A', TODAY)
  assert.equal(a.emptyDrop, 'confirmed', '掉落层那一格没生效')
  assert.equal(a.ships.find((ship) => ship.id === 2)?.limited.from, '2025-05-05', '台账被掉落层抹掉了')
})

// ---- 维护者侧工具 ----

const ledgerPack = {
  schemaVersion: 1,
  compiledAt: '2026-08-22',
  checkedAt: '2026-06-26',
  source: 's',
  revision: 'r',
  maps: {
    '1-4': {
      L: [{ id: 699, window: win({ from: '2025-12-18', label: 'Xmas' }), evidence }],
    },
    '2-2': {
      K: [
        {
          id: 479,
          window: win({ from: '2024-01-01', status: 'end_pending', statusChangedAt: '2026-01-01' }),
          evidence,
        },
      ],
    },
    '3-3': {
      A: [{ id: 500, window: win({ from: '2024-05-05', label: '春' }), evidence }],
    },
  },
}
const upstreamOf = (rows, checkedAt = '2026-08-22') => ({
  checkedAt,
  maps: new Map(
    rows.map(([code, entries]) => [
      code,
      new Map(entries.map(([id, window, nodes]) => [id, { window, nodes: new Set(nodes ?? []) }])),
    ]),
  ),
})

test('对照工具：上游那一票里指错形态的号先改钉，否则真差异被 6 条噪声埋掉', () => {
  // 上游仍写 645（宗谷 灯台補給），台账按裁定存 699（特務艦）。不改钉的话这一条会
  // **同时**报成「上游有台账无」和「台账有上游不再列出」——两边都是噪声。
  const { rows, summary } = diffLimitedLedger({
    ledger: ledgerPack,
    upstream: upstreamOf(
      [
        ['1-4', [[645, win({ from: '2025-12-18', label: 'Xmas' }), ['L']]]],
        ['2-2', [[479, win({ from: '2024-01-01' })]]],
        ['3-3', [[500, win({ from: '2024-05-05', label: '春' })]]],
      ],
      '2026-06-26',
    ),
  })
  assert.equal(summary.upstreamOnly, 0)
  assert.equal(summary.ledgerOnly, 0)
  assert.equal(summary.fromChanged, 0)
  assert.equal(summary.labelChanged, 0)
  assert.equal(summary.stale, 0)
  // 台账判了「不再持续」、上游却还列着：当初判早了还是又开了一次？由人裁，脚本只报
  assert.equal(summary.revived, 1)
  assert.equal(rows.filter((row) => row.kind === 'revived')[0].id, 479)
})

test('对照工具逐类报差异，且一条都不代拍', () => {
  const { rows, summary } = diffLimitedLedger({
    ledger: ledgerPack,
    upstream: upstreamOf([
      // 起始日与批次标签都被上游改过
      ['1-4', [[699, win({ from: '2025-12-19', label: 'クリスマス' }), ['L']]]],
      // 上游新增一条台账里没有的
      ['5-5', [[888, win({ from: '2026-08-01', label: '夏' }), ['S']]]],
      // 3-3 的那条上游不再列出 → 疑似收窗
    ]),
  })
  const kinds = rows.map((row) => row.kind).sort()
  assert.deepEqual(
    [...new Set(kinds)].sort(),
    ['from-changed', 'label-changed', 'ledger-only', 'stale', 'upstream-only'],
  )
  assert.equal(summary.upstreamOnly, 1)
  assert.equal(summary.ledgerOnly, 2, '2-2 与 3-3 都不在上游名单里了')
  assert.equal(summary.fromChanged, 1)
  assert.equal(summary.labelChanged, 1)
  assert.equal(summary.stale, 1, '上游核对日比台账新，可以把 lastConfirmedAt 推进')

  // 「疑似收窗」这一条最要紧：报出来，但**不许**替人改 status 或写 until
  const suspect = rows.find((row) => row.kind === 'ledger-only' && row.id === 500)
  assert.ok(suspect.detail.note.includes('不代拍'))

  // 指纹：上游改了那一格指纹就变，旧裁决自动失效要重核
  const [one] = rows
  assert.ok(limitedDiffFingerprint(one).includes(one.map))
  assert.notEqual(
    limitedDiffFingerprint(one),
    limitedDiffFingerprint({ ...one, detail: { ...one.detail, upstream: 'x' } }),
  )
})

test('三态清点与摊平顺序：报告开头先说清「有多少条其实已经关了」', () => {
  const tally = ledgerPhaseTally(ledgerPack, TODAY)
  assert.deepEqual(tally, { open_undated: 2, open_dated: 0, end_pending: 1, closed: 0 })
  // 摊平顺序稳定：图数值序 → 点字母序 → mstId。手工维护的文件每次 diff 都要看得懂
  assert.deepEqual(
    ledgerEntries(ledgerPack).map((row) => `${row.map}/${row.node}#${row.id}`),
    ['1-4/L#699', '2-2/K#479', '3-3/A#500'],
  )
})

test('「疑似已收窗」是信号不是判据：只对本机捞到过的条目成立，样本不够不出声', () => {
  const day = 86_400_000
  const at = (date) => Date.parse(`${date}T00:00:00Z`)
  const samples = new Map([
    [
      '1-4',
      {
        // 上次捞到之后又 S 胜了一大堆都没再出——这才是信号
        sWinTs: Array.from({ length: 60 }, (_, i) => at('2026-03-01') + i * day),
        lastDropTs: new Map([[699, at('2026-02-01')]]),
      },
    ],
    [
      '3-3',
      {
        // 样本没到门槛：什么都说明不了，不许出声
        sWinTs: Array.from({ length: 5 }, (_, i) => at('2026-03-01') + i * day),
        lastDropTs: new Map([[500, at('2026-02-01')]]),
      },
    ],
    // 2-2：本机从没捞到过它 → 分不清是「窗口关了」还是「我运气差」，一律不报
    ['2-2', { sWinTs: Array.from({ length: 90 }, (_, i) => at('2026-03-01') + i * day), lastDropTs: new Map() }],
  ])
  const rows = suspectedClosedWindows({ ledger: ledgerPack, samples, today: TODAY })
  assert.deepEqual(rows.map((row) => `${row.map}#${row.id}`), ['1-4#699'])
  assert.equal(rows[0].sWinsSince, 60)
  assert.equal(rows[0].lastDropAt, '2026-02-01')
  assert.ok(CLOSED_WINDOW_SAMPLE_FLOOR >= 20, '门槛太低会把随机波动当成收窗')

  // 已经写了截止日、且那天已经过去的不必再报——那一条已经收完窗了
  const closedLedger = {
    ...ledgerPack,
    maps: {
      '1-4': {
        L: [
          {
            id: 699,
            window: win({ from: '2025-12-18', until: '2026-01-31', status: 'ended_confirmed' }),
            evidence,
          },
        ],
      },
    },
  }
  assert.deepEqual(suspectedClosedWindows({ ledger: closedLedger, samples, today: TODAY }), [])
})

test('收窗只能由人写，而且必须换上新的凭据', () => {
  const pack = structuredClone(ledgerPack)
  const changed = confirmLedgerWindowEnd(pack, {
    map: '1-4',
    shipId: 699,
    until: '2026-02-01',
    confirmedAt: '2026-08-22',
    evidence: { kind: 'official', note: '游戏内公告 2026-02-01 结束' },
  })
  assert.equal(changed, 1)
  const one = pack.maps['1-4'].L[0]
  assert.equal(one.window.until, '2026-02-01')
  assert.equal(one.window.status, 'ended_confirmed')
  assert.equal(one.window.statusChangedAt, '2026-08-22')
  assert.equal(limitedWindowPhase(one.window, TODAY), 'closed')
  // 条目的内容变了，凭据还留着旧的那一句，等于用「当初凭什么说它开着」背书「凭什么说它关了」
  assert.equal(one.evidence.kind, 'official')
  assert.equal(one.evidence.recordedAt, '2026-08-22')
  // 起讫日期不许自相矛盾，也不许写一条谁都对不上的记录
  assert.throws(
    () =>
      confirmLedgerWindowEnd(structuredClone(ledgerPack), {
        map: '1-4',
        shipId: 699,
        until: '2020-01-01',
        confirmedAt: '2026-08-22',
        evidence: { kind: 'official', note: 'x' },
      }),
    /早于开始日期/,
  )
  assert.throws(
    () =>
      confirmLedgerWindowEnd(structuredClone(ledgerPack), {
        map: '1-4',
        shipId: 111,
        until: '2026-02-01',
        confirmedAt: '2026-08-22',
        evidence: { kind: 'official', note: 'x' },
      }),
    /没有舰娘 111/,
  )
  // 没有凭据一律不许写——「已收窗」这一格没有凭据就与凭空捏造无法区分
  assert.throws(
    () =>
      confirmLedgerWindowEnd(structuredClone(ledgerPack), {
        map: '1-4',
        shipId: 699,
        until: '2026-02-01',
        confirmedAt: '2026-08-22',
      }),
    /凭据/,
  )
})

test('降级后的对照工具一个字都不写进随包数据', () => {
  const src = fs.readFileSync(
    new URL('../scripts/refresh-map-intel-limited.mjs', import.meta.url),
    'utf8',
  )
  // 它以前会把窗口写进 map-intel.json 的候选包；降级之后这条路必须整条不在了
  assert.doesNotMatch(src, /stageMapIntelCandidate|applyCurrentLimited/)
  const targets = [...src.matchAll(/writeFileSync\(\s*([A-Za-z][\w.]*)/g)].map((m) => m[1])
  assert.deepEqual([...new Set(targets)], ['reportFile'], '它往随包数据里写东西了')
  assert.match(src, /const reportFile = path\.join\(reviewDir,/)
})

test('本机确认层的收窗折叠接在两处，且只在这一层挂「窗口已结束」', () => {
  const di = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  const ji = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')

  // 判据必须走共用纯函数：两处各写一份「算不算过期」，早晚会各说各的
  const mine = di.slice(di.indexOf('const myDropsHtml'), di.indexOf('const confirmedDropPoolCardHtml'))
  const local = ji.slice(ji.indexOf('const localDropPoolHtml'), ji.indexOf('const confirmedDropPoolHtml'))
  for (const [name, fn] of [['di', mine], ['ji', local]]) {
    assert.match(fn, /localDropEraOf\(/, `${name} 没走共用的收窗判据`)
    assert.match(fn, /limitedWindowsOf\(/, `${name} 没从台账取窗口`)
    assert.match(fn, /往期/, `${name} 没有往期这一段`)
    // 永不删除：折叠之后条目还在，不许出现「过滤掉」那种做法
    assert.ok(fn.includes('rowHtml'), `${name} 的往期与当下两段该共用同一个行渲染件`)
  }
  assert.match(local, /限定期捞到 · 窗口已结束/)
  assert.match(mine, /限定期捞到/)

  // 反向：确认目录那一侧不许挂这句话——它答的是「现在去哪捞」，
  // 已收窗的条目在那一路本来就被隐去了，再挂一句只会两边对不上。
  const pool = ji.slice(ji.indexOf('const confirmedDropPoolHtml'), ji.indexOf('const dropPoolHtml'))
  assert.ok(!pool.includes('窗口已结束'), '离线目录那一侧也挂了收窗提示')
})

// ---- 真包 ----

const realPack = new URL('../assets/lodes/map-drop-windows.json', import.meta.url)
test('随包台账：每条有凭据，没写截止日的一条都不会被判成已收窗', {
  skip: fs.existsSync(realPack) ? false : '缺 map-drop-windows 台账',
}, () => {
  const data = JSON.parse(fs.readFileSync(realPack, 'utf8')).data
  const rows = ledgerEntries(data)
  assert.ok(rows.length >= 144, `台账只剩 ${rows.length} 条（迁移基线 144）`)
  for (const row of rows) {
    assert.ok(
      ['official', 'ledger', 'community'].includes(row.entry.evidence?.kind),
      `${row.map}/${row.node}#${row.id} 的凭据种类不认得`,
    )
    assert.ok(row.entry.evidence.note.length > 10, `${row.map}#${row.id} 的凭据是空话`)
    assert.ok(Array.isArray(row.entry.votes) && row.entry.votes.length, `${row.map}#${row.id} 没有印证票`)
    // 舰号必须是改钉后的形态号——与 map-drops 不同键的表现是窗口静默对不上
    assert.notEqual(row.entry.window, undefined)
    if (row.entry.window.until == null) {
      assert.notEqual(
        limitedWindowPhase(row.entry.window, TODAY),
        'closed',
        `${row.map}#${row.id}：没写截止日却被判成已收窗`,
      )
    }
  }
  // 批次 2 那 7 条 limited-vs-plain 已由用户 2026-08-23 裁「限定」收案，待裁标撤下。
  // 2026-08-28 又挂上 5 条 ended-vs-still-listed：同一家（wikiwiki）两个视图自相矛盾——
  // 逐批次小节把这一格划了删除线（已终了），同页「現在継続中」的海域別名单又还列着它。
  // 脚本不代拍，status 一个字不动，挂标等人裁。这里钉死**具体是哪几条**：
  // 数量对不上说明要么有人偷偷裁了、要么又冒出新的，两种都得有人看一眼。
  assert.deepEqual(
    rows.filter((row) => row.entry.conflict).map((row) => `${row.map}/${row.node}#${row.id}`).sort(),
    ['2-2/K#133', '2-2/K#134', '2-2/K#168', '2-3/N#135', '2-3/N#414'],
    '台账里挂着的 conflict 标与预期对不上',
  )
  for (const row of rows.filter((one) => one.entry.conflict)) {
    assert.equal(row.entry.conflict, 'ended-vs-still-listed')
    assert.equal(
      row.entry.window.status ?? 'active_confirmed',
      'active_confirmed',
      `${row.map}/${row.node}#${row.id}：挂着待裁标却已经改了 status——那就是代拍了`,
    )
  }
})

// ---- 2026-08-23 的裁决（艦ログ 作第二票）----

const DECIDED_LIMITED = [
  ['1-3', 'J', 953],
  ['1-4', 'L', 527],
  ['1-4', 'L', 636],
  ['1-4', 'L', 699],
  ['1-4', 'L', 900],
  ['4-4', 'K', 120],
  ['5-5', 'S', 633],
]
const END_PENDING = [
  ['2-2', 'B', 133], ['2-2', 'B', 480],
  ['2-2', 'D', 133], ['2-2', 'D', 480],
  ['2-2', 'E', 133], ['2-2', 'E', 480],
  ['2-2', 'G', 133], ['2-2', 'G', 480],
  ['2-2', 'K', 479],
  ['7-3', 'E', 535],
]

test('随包台账：7 条 limited-vs-plain 按「限定」收案，裁语与两票出处逐条写在 evidence 里', {
  skip: fs.existsSync(realPack) ? false : '缺 map-drop-windows 台账',
}, () => {
  const data = JSON.parse(fs.readFileSync(realPack, 'utf8')).data
  const byKey = new Map(ledgerEntries(data).map((row) => [`${row.map}/${row.node}#${row.id}`, row.entry]))
  for (const [map, node, id] of DECIDED_LIMITED) {
    const entry = byKey.get(`${map}/${node}#${id}`)
    assert.ok(entry, `${map}/${node}#${id} 不在台账里了`)
    assert.equal(entry.conflict, undefined, `${map}/${node}#${id} 还挂着待裁标`)
    // 裁「限定」= 台账那一条照旧成立，不是把 limitedOnly 摘掉
    assert.equal(entry.limitedOnly, true, `${map}/${node}#${id} 的 limitedOnly 被裁没了`)
    // 凭据要说得出裁决日期与第二票是谁给的——只撤标不写凭据，等于裁决没留下任何痕迹
    assert.equal(entry.evidence.recordedAt, '2026-08-23')
    assert.ok(entry.evidence.note.includes('艦ログ'), `${map}/${node}#${id} 的凭据没写第二票是谁`)
    assert.ok(entry.evidence.note.includes('2026-08-23'), `${map}/${node}#${id} 的凭据没写裁决日期`)
    assert.ok(entry.votes.includes('kanlog'), `${map}/${node}#${id} 少了第二票`)
  }
  // 第二票的出处要在 voters 里登记，不能只在 votes 里冒出一个没人解释的名字
  assert.ok(data.voters?.kanlog?.length > 10, 'voters 里没登记 kanlog 是什么')
})

test('随包台账：10 条 end_pending 状态一字不动，只加第二票旁证', {
  skip: fs.existsSync(realPack) ? false : '缺 map-drop-windows 台账',
}, () => {
  const data = JSON.parse(fs.readFileSync(realPack, 'utf8')).data
  const rows = ledgerEntries(data)
  assert.deepEqual(
    rows
      .filter((row) => row.entry.window.status === 'end_pending')
      .map((row) => [row.map, row.node, row.id]),
    END_PENDING,
    'end_pending 的那一批变了——「说不出结束日就不许说已结束」这条口径不许靠改状态绕过去',
  )
  for (const [map, node, id] of END_PENDING) {
    const entry = rows.find((row) => row.map === map && row.node === node && row.id === id).entry
    // 窗口一字不动：没有结束日，就还是「说不出哪天关的」那一档，不是已收窗
    assert.equal(entry.window.until, null, `${map}/${node}#${id} 被写上了结束日`)
    assert.equal(entry.window.statusChangedAt, '2026-08-11', `${map}/${node}#${id} 的换态日被动过`)
    assert.equal(limitedWindowPhase(entry.window, TODAY), 'end_pending')
    assert.equal(isClosedLimitedWindow(entry.window, TODAY), false, `${map}/${node}#${id} 被判成已收窗了`)
    // 加固的是**证据**不是状态：第二票只说「上游也不再列出」，说不出日子就不许升级成已结束
    assert.ok(entry.evidence.note.includes('艦ログ'), `${map}/${node}#${id} 没补第二票旁证`)
    assert.ok(entry.evidence.note.includes('end_pending'), `${map}/${node}#${id} 的凭据没说清状态没变`)
    assert.ok(entry.votes.includes('kanlog'))
  }
})

test('单票待裁的一条都没偷偷补进台账', {
  skip: fs.existsSync(realPack) ? false : '缺 map-drop-windows 台账',
}, () => {
  const data = JSON.parse(fs.readFileSync(realPack, 'utf8')).data
  const byKey = new Map(ledgerEntries(data).map((row) => [`${row.map}/${row.node}#${row.id}`, row.entry]))
  assert.ok(PENDING_LIMITED_WINDOW_CLAIMS.length, '单票待裁表空了？那要么真清空了，要么有人拿单票拍了板')
  for (const claim of PENDING_LIMITED_WINDOW_CLAIMS) {
    assert.ok(claim.sources.length === 1, `${claim.map}/${claim.node}#${claim.id} 已经有两票了，该裁不该等`)
    assert.match(claim.claimedAt, /^\d{4}-\d{2}-\d{2}$/)
    assert.ok(claim.why?.length > 30, `${claim.map}/${claim.node}#${claim.id} 没写第二票为什么对不上`)
    // 表里记的「台账此刻怎么写」必须与真台账一致：对不上就是有人拿着单票动了包
    const entry = byKey.get(`${claim.map}/${claim.node}#${claim.id}`)
    if (claim.ledger === null) {
      assert.equal(entry, undefined, `${claim.map}/${claim.node}#${claim.id} 只有一票却被补进台账了`)
      continue
    }
    assert.ok(entry, `${claim.map}/${claim.node}#${claim.id} 表里说台账有这一条，实际没有`)
    assert.equal(
      entry.window.status ?? 'active_confirmed',
      claim.ledger,
      `${claim.map}/${claim.node}#${claim.id} 的状态被单票改过了`,
    )
  }
})
