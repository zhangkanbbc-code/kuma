import assert from 'node:assert/strict'
import test from 'node:test'

import availability from '../dist/shared/quest-availability.js'

const { buildQuestAvailability } = availability

// A → B → C 一条链，另有 D 依赖 A 与一条库里没有的前置
const ENTRIES = [
  { id: 1, code: 'A1', pre: [] },
  { id: 2, code: 'A2', pre: ['A1'] },
  { id: 3, code: 'A3', pre: ['A2'] },
  { id: 4, code: 'A4', pre: ['A1', 'Z9'] },
]

const run = (observed, opts = {}) =>
  buildQuestAvailability({
    entries: ENTRIES,
    observed: new Map(observed),
    activeIds: opts.activeIds ?? null,
    authoritative: opts.authoritative ?? true,
  })

test('the four states the game does report are read straight off the list', () => {
  const out = run([[1, 3], [2, 2], [3, 1]])
  assert.equal(out.get(1).status, 'claimable') // 达成待领
  assert.equal(out.get(2).status, 'active') // 遂行中
  assert.equal(out.get(3).status, 'open') // 在表里没接
})

test('missing from an authoritative list with every prerequisite done means it was turned in', () => {
  // 游戏不给任务履历。但前置都满足的任务它一定会摆出来——
  // 既然 A1 不在表里，只能是已经交付了。
  const out = run([[2, 1]])
  assert.equal(out.get(1).status, 'done')
  assert.equal(out.get(2).status, 'open')
})

test('missing with an unfinished prerequisite is locked, and says which one', () => {
  // A2 还摆在表里 = 没交付 ⇒ A3 是被它卡住，不是做完了
  const out = run([[2, 1]])
  assert.deepEqual(out.get(3), { status: 'locked', missingPre: ['A2'], cyclic: false })
})

test('a prerequisite absent from the library degrades to unknown, never to done', () => {
  // Z9 不在库里：无从判断。2026-08-17 对账实锤这类码多是旧编号/下线的限时任务
  // （F48 的 C2、B204 的 2409B1），永远报「未解锁」是在冤枉数据——退「未同步」，
  // 但绝不能说成做完了
  const out = run([])
  assert.equal(out.get(4).status, 'unknown')
  // 悬空码与真未满足并存时，先如实报真未满足的那条
  const mixed = buildQuestAvailability({
    entries: [
      { id: 1, code: 'A1', pre: [] },
      { id: 2, code: 'A2', pre: ['A1'] },
      { id: 5, code: 'A5', pre: ['A2', 'Z9'] },
    ],
    observed: new Map([[2, 1]]), // A2 还摆在表里 = 没交付
    activeIds: null,
    authoritative: true,
  })
  assert.deepEqual(mixed.get(5), { status: 'locked', missingPre: ['A2'], cyclic: false })
})

test('a whole finished chain resolves transitively', () => {
  const out = run([[4, 1]])
  assert.equal(out.get(1).status, 'done')
  assert.equal(out.get(2).status, 'done')
  assert.equal(out.get(3).status, 'done')
})

test('activeIds wins over the raw state when the game gave us the authoritative set', () => {
  const out = run([[2, 1]], { activeIds: [2] })
  assert.equal(out.get(2).status, 'active')
})

test('without a full quest list nothing is claimed at all', () => {
  // 分类页只给那一类。拿它当全集会把没翻到的任务统统判成「不能接」
  const out = run([[1, 1]], { authoritative: false })
  for (const id of [1, 2, 3, 4]) assert.equal(out.get(id).status, 'unknown')
})

test('a cyclic prerequisite never blocks, because one snapshot cannot answer "did you ever do it"', () => {
  // Bm6 是月常任务：做完当期就从表里消失，下期又回来。拿「当期不在表里」
  // 当「没做完」的证据是错的——实测因此把 31 条早就做完的任务报成「还不能接」。
  const out = buildQuestAvailability({
    entries: [
      { id: 20, code: 'Bm6', pre: [] },
      { id: 21, code: 'A56', pre: ['Bm6', 'A23'] },
      { id: 22, code: 'A23', pre: [] },
    ],
    observed: new Map(),
    activeIds: null,
    authoritative: true,
  })
  assert.equal(out.get(21).status, 'done')
  assert.deepEqual(out.get(21).missingPre, [])
  // 周期任务当期还摆在表里，也照样不算阻塞
  const listed = buildQuestAvailability({
    entries: [
      { id: 20, code: 'Bm6', pre: [] },
      { id: 21, code: 'A56', pre: ['Bm6'] },
    ],
    observed: new Map([[20, 1]]),
    activeIds: null,
    authoritative: true,
  })
  assert.equal(listed.get(20).status, 'open')
  assert.equal(listed.get(21).status, 'done')
})

test('cyclic quests are flagged so the UI can say "this period" instead of "for good"', () => {
  const out = buildQuestAvailability({
    entries: [{ id: 30, code: 'Bd5', pre: [] }, { id: 31, code: 'A1', pre: [] }],
    observed: new Map(),
    activeIds: null,
    authoritative: true,
  })
  assert.equal(out.get(30).cyclic, true) // 日常：done 只是本期
  assert.equal(out.get(31).cyclic, false)
})

test('a cycle in upstream data degrades to unfinished instead of blowing the stack', () => {
  const out = buildQuestAvailability({
    entries: [
      { id: 10, code: 'C1', pre: ['C2'] },
      { id: 11, code: 'C2', pre: ['C1'] },
    ],
    observed: new Map(),
    activeIds: null,
    authoritative: true,
  })
  assert.equal(out.get(10).status, 'locked')
  assert.equal(out.get(11).status, 'locked')
})

// ---- 周期任务的跨期对齐（2026-08-17 用户抓的实锤：拿历史快照说「本期已完成」）----

const JST = 9 * 3600 * 1000
const jstAt = (y, mo, d, h) => Date.UTC(y, mo - 1, d, h) - JST
const PERIOD_ENTRIES = [
  { id: 40, code: 'Bm1', pre: [] }, // 月任
  { id: 41, code: 'Bq1', pre: [] }, // 季任（3/6/9/12 月重置）
  { id: 42, code: 'B99', pre: [] }, // 单次
  { id: 43, code: 'By1', pre: [], memo2: '年常任务（8月）' }, // 年任 8 月重置
  { id: 44, code: 'By2', pre: [] }, // 年任但重置月不明
]
const runPeriod = (observedTs, now) =>
  buildQuestAvailability({
    entries: PERIOD_ENTRIES,
    observed: new Map(),
    activeIds: null,
    authoritative: true,
    observedTs,
    now,
  })

test('a cyclic "done" needs a snapshot from the current period, or it degrades to unknown', () => {
  // 快照 7 月、现在 8 月：月任已跨期 → unknown；季任 6-8 月同一季 → 仍 done；
  // 单次任务不受周期对齐影响
  const crossMonth = runPeriod(jstAt(2026, 7, 15, 12), jstAt(2026, 8, 17, 12))
  assert.equal(crossMonth.get(40).status, 'unknown', '月任拿上月快照判不了本期')
  assert.equal(crossMonth.get(41).status, 'done', '7 月与 8 月同属 6 月起的一季')
  assert.equal(crossMonth.get(42).status, 'done', '单次任务的交付是永久事实')
  // 季任跨季：5 月快照 vs 6 月（新一季）
  const crossQuarter = runPeriod(jstAt(2026, 5, 20, 12), jstAt(2026, 6, 10, 12))
  assert.equal(crossQuarter.get(41).status, 'unknown')
  // 年任跨年度：7 月快照（上年度）vs 8 月（8 月重置后的新年度）
  assert.equal(crossMonth.get(43).status, 'unknown')
  // 重置月不明的年任无从对齐，保持 done 而不是瞎猜
  assert.equal(crossMonth.get(44).status, 'done')
})

// ---- 期内的链上严格推理（2026-08-17 体检补上的洞：周期链整串误判「本期已完成」）----

const DAILY_CHAIN = [
  { id: 50, code: 'Bd1', pre: [] },
  { id: 51, code: 'Bd2', pre: ['Bd1'] },
  { id: 52, code: 'Bd3', pre: ['Bd2'] },
]
const TODAY = jstAt(2026, 8, 17, 12)
const runToday = (entries, observed) =>
  buildQuestAvailability({
    entries,
    observed: new Map(observed),
    activeIds: null,
    authoritative: true,
    observedTs: jstAt(2026, 8, 17, 9),
    now: TODAY,
  })

test('an untouched daily chain reads as locked, not as "done for today"', () => {
  // 今天一条日常都没做：Bd1 在表里，Bd2/Bd3 因未解锁而不在表里。
  // 旧判定把周期前置一律放行，于是 Bd2/Bd3 被说成「本期已完成」——恰好全反。
  const out = runToday(DAILY_CHAIN, [[50, 1]])
  assert.equal(out.get(50).status, 'open')
  assert.deepEqual(out.get(51), { status: 'locked', missingPre: ['Bd1'], cyclic: true })
  // Bd1 未交付会顺着链把 Bd3 也如实卡住（Bd2 本期从未解锁）
  assert.deepEqual(out.get(52), { status: 'locked', missingPre: ['Bd2'], cyclic: true })
})

test('a mid-chain snapshot blocks only what is really blocked', () => {
  // 做完 Bd1（出表），Bd2 现身表里没做：Bd3 仍被 Bd2 卡着
  const out = runToday(DAILY_CHAIN, [[51, 1]])
  assert.equal(out.get(50).status, 'done')
  assert.equal(out.get(51).status, 'open')
  assert.deepEqual(out.get(52), { status: 'locked', missingPre: ['Bd2'], cyclic: true })
  // 整条链都出表 = 全做完，照旧 done
  const finished = runToday(DAILY_CHAIN, [])
  for (const id of [50, 51, 52]) assert.equal(finished.get(id).status, 'done')
})

test('longer-period prerequisites still bind; shorter ones stay optimistic', () => {
  const entries = [
    { id: 60, code: 'Bw5', pre: [] }, // 周任
    { id: 61, code: 'Bd9', pre: ['Bw5'] }, // 日任挂周任前置：周任没交付则整周锁着
    { id: 62, code: 'Bm6', pre: [] }, // 月任
    { id: 63, code: 'Bq1', pre: ['Bm6'] }, // 季任挂月任前置：本季早些月份可能满足过
  ]
  const out = runToday(entries, [[60, 1], [62, 1]])
  assert.deepEqual(out.get(61), { status: 'locked', missingPre: ['Bw5'], cyclic: true })
  // 更短周期的前置答不了「本季是否满足过」，维持乐观 done——判不动的地方不装懂
  assert.equal(out.get(63).status, 'done')
})

test('a cyclic prerequisite outside the library keeps the verdict honest', () => {
  // Bw9 不在库里：严格推理给不出结论 → unknown，不冒充 done 也不冤枉成 locked
  const out = runToday([{ id: 70, code: 'Bw1', pre: ['Bw9'] }], [])
  assert.equal(out.get(70).status, 'unknown')
})

test('annual quests without a known reset month join strict reasoning on same-day snapshots', () => {
  // By9←By8：重置月不明（memo2 缺），跨期判不了；但快照与现在同一游戏日时
  // 「By8 还摆在表里」就是本期事实 → By9 是未解锁，不是已完成
  const entries = [
    { id: 80, code: 'By8', pre: [] },
    { id: 81, code: 'By9', pre: ['By8'] },
  ]
  const sameDay = runToday(entries, [[80, 1]])
  assert.deepEqual(sameDay.get(81), { status: 'locked', missingPre: ['By8'], cyclic: true })
  // 快照隔天：年任无从对齐周期，回到不猜的 done
  const staleDay = buildQuestAvailability({
    entries,
    observed: new Map([[80, 1]]),
    activeIds: null,
    authoritative: true,
    observedTs: jstAt(2026, 8, 16, 12),
    now: TODAY,
  })
  assert.equal(staleDay.get(81).status, 'done')
})

test('same-period snapshots and legacy callers keep the old behaviour', () => {
  // 同月快照：全部照旧 done
  const samePeriod = runPeriod(jstAt(2026, 8, 2, 12), jstAt(2026, 8, 17, 12))
  for (const id of [40, 41, 42, 43]) assert.equal(samePeriod.get(id).status, 'done')
  // 不传时点（旧调用方）：不做对齐，行为不变
  const legacy = buildQuestAvailability({
    entries: PERIOD_ENTRIES,
    observed: new Map(),
    activeIds: null,
    authoritative: true,
  })
  for (const id of [40, 41, 42, 43, 44]) assert.equal(legacy.get(id).status, 'done')
})
