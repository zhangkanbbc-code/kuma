// 回放航迹的「这次出击已知最全的路径」——编译真代码跑真逻辑
//（护栏别只断言源码文本：判断写反、墓碑漏立、乱序回包落错格，正则一个也拦不住）。
//
// 镝整个模块顶层就要 electron / 内核 / DOM，没法直接 import。这里只把 di.ts 里
// 这一段切出来：缓存本体，加上 renderBattlePane 里那句「嵌入宿主补齐口」——
// 后者是原样搬进来跑的，写成 `!embedded` 或整句删掉都会在这里变红。
// 它们引用到的外部名字（mg / battleHistory / queryBattleSnapshot / 嵌入渲染入口）
// 在下面补桩，源码本身一个字不改。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { buildSync } from 'esbuild'

const source = fs.readFileSync(
  fileURLToPath(new URL('../src/renderer/modules/di.ts', import.meta.url)),
  'utf8',
)

const sliceBetween = (from, to, label) => {
  const start = source.indexOf(from)
  const end = source.indexOf(to)
  assert.ok(start >= 0 && end > start, `di.ts 里找不到「${label}」，这条守卫的锚点要跟着改`)
  return source.slice(start, end)
}

// 缓存本体：从三态类型一路到 openBattleSnapshot 之前
const CACHE = sliceBetween('type RunTrailEntry =', 'const openBattleSnapshot', '完整航迹缓存')
// 嵌入宿主的补齐口：renderBattlePane 里那个 if 块，原样搬
const wiring = source.match(/if \(embedded && snapshot\) \{[\s\S]*?\n {4}\}/)
assert.ok(wiring, 'renderBattlePane 里的嵌入宿主航迹补齐口不见了')

const HARNESS = `
type SortieView = any
type BattleSnapshot = any
type BattleSnapshotSummary = any

export const rig = {
  live: null as any,
  ledger: new Map<number, any>(),
  failIds: new Set<number>(),
  reads: [] as number[],
  rerenders: [] as any[],
  hold: false,
  pending: [] as (() => void)[],
}
const mg: any = {
  get sortie() {
    return rig.live
  },
}
let battleHistory: any[] = []
const queryBattleSnapshot = (id: number): Promise<any> => {
  rig.reads.push(id)
  if (rig.failIds.has(id)) return Promise.reject(new Error('账本读失败'))
  const answer = () => rig.ledger.get(id) ?? null
  if (!rig.hold) return Promise.resolve(answer())
  return new Promise((resolve) => rig.pending.push(() => resolve(answer())))
}
const renderBattleReplayDetail = (pane: any, snapshot: any) => {
  rig.rerenders.push([pane, snapshot])
}

${CACHE}

// ---- 测试用的取用口 ----
export const setHistory = (rows: any[]) => {
  battleHistory = rows
}
export const trailOf = (snapshot: any) => replayTrailSortie(snapshot)
export const cacheSize = () => runTrailBySnapshot.size
export const clearCache = () => runTrailBySnapshot.clear()
/** 这一格现在是什么态。不走 runTrailFor,免得看一眼就把淘汰序搅了 */
export const stateOf = (snapshotId: number) => runTrailBySnapshot.get(snapshotId)?.state ?? null
/** renderBattlePane 里那一句，连同它的宿主判断一起跑 */
export const renderBattlePaneTrailStep = (pane: any, snapshot: any, embedded: boolean) => {
  const trailIndex = battleHistory
${wiring[0]}
}
`

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-run-trail-'))
const entry = path.join(tempDir, 'run-trail.ts')
fs.writeFileSync(entry, HARNESS)
const output = path.join(tempDir, 'run-trail.cjs')
buildSync({
  entryPoints: [entry],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'silent',
})
const {
  rig,
  setHistory,
  trailOf,
  cacheSize,
  clearCache,
  stateOf,
  renderBattlePaneTrailStep,
} = createRequire(import.meta.url)(output)

// ---- 造数据 ----
const snapshotOf = (id, sortieId, battleNo, cells) => ({
  id,
  ts: sortieId + battleNo * 60_000,
  sortieId,
  battleNo,
  map: 12,
  cell: cells[cells.length - 1],
  rank: 'S',
  isBoss: false,
  practice: false,
  sortie: {
    practice: false,
    mapArea: 1,
    mapNo: 2,
    startTs: sortieId,
    updatedTs: sortieId + battleNo * 60_000,
    nodes: cells.map((cell) => ({ cell })),
  },
})
const summaryOf = (snapshot) => ({
  id: snapshot.id,
  ts: snapshot.ts,
  sortieId: snapshot.sortieId,
  battleNo: snapshot.battleNo,
  map: snapshot.map,
  cell: snapshot.cell,
  rank: snapshot.rank,
  isBoss: snapshot.isBoss,
  practice: snapshot.practice,
})
const cellsOf = (sortie) => sortie.nodes.map((node) => node.cell)
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

// 一次出击打了三场：A → B → C。抽屉里点开的是第一场。
const first = snapshotOf(1, 900, 1, [1])
const mid = snapshotOf(2, 900, 2, [1, 2])
const last = snapshotOf(3, 900, 3, [1, 2, 3])

const reset = () => {
  clearCache()
  rig.live = null
  rig.ledger.clear()
  rig.failIds.clear()
  rig.reads.length = 0
  rig.rerenders.length = 0
  rig.hold = false
  rig.pending.length = 0
  for (const snapshot of [first, mid, last]) rig.ledger.set(snapshot.id, snapshot)
  setHistory([last, mid, first].map(summaryOf))
}

test('嵌入宿主也拿得到完整航迹:抽屉里选早节点,晚于这一战的点仍在条上', async () => {
  reset()
  // 换片前手上只有快照自带的那截路径——这正是用户判过的「单行道」
  assert.deepEqual(cellsOf(trailOf(first)), [1])

  const pane = { host: '史的复盘抽屉' }
  renderBattlePaneTrailStep(pane, first, true)
  await settle()

  assert.deepEqual(
    cellsOf(trailOf(first)),
    [1, 2, 3],
    '嵌入宿主没补上完整航迹:选了早节点就再也走不到 B/C,只能往回走',
  )
  assert.deepEqual(rig.reads, [3], '要取的是同 run 编号最大的那场')
  assert.deepEqual(rig.rerenders, [[pane, first]], '航迹到手要重画嵌入宿主自己那格')
})

test('镝自己不在渲染里拉航迹:live 那条路仍归 openBattleSnapshot 管', async () => {
  reset()
  renderBattlePaneTrailStep({ host: '镝面板' }, first, false)
  await settle()
  assert.deepEqual(rig.reads, [], 'live 宿主的触发时机不该被这次改动挪进渲染')
  assert.equal(cacheSize(), 0)
})

test('拉到了就不再问第二遍,重画多少次都只发一次 IPC', async () => {
  reset()
  const pane = {}
  for (let i = 0; i < 6; i += 1) {
    renderBattlePaneTrailStep(pane, first, true)
    await settle()
  }
  assert.deepEqual(rig.reads, [3], 'loading / ready 都是落地态,不许每次重画都重发')
  assert.equal(rig.rerenders.length, 1)
})

test('拉失败立墓碑:不许变成「失败→重画→再拉」的自激循环', async () => {
  reset()
  rig.failIds.add(3)
  const warn = console.warn
  console.warn = () => {}
  try {
    const pane = {}
    for (let i = 0; i < 6; i += 1) {
      renderBattlePaneTrailStep(pane, first, true)
      await settle()
    }
  } finally {
    console.warn = warn
  }
  assert.deepEqual(rig.reads, [3], '失败没落地:每次重画都在重发同一个失败请求')
  assert.deepEqual(rig.rerenders, [], '失败不该触发重画——那正是循环的另一半')
  assert.deepEqual(cellsOf(trailOf(first)), [1], '取不到就退回快照自己的路径,不是报错')
  // 「不重发」光靠一格永远卡在 loading 也能做到,但那是把地雷埋进状态里:
  // 谁往后给 loading 加一句「显示正在读取」或「陈旧的 loading 重试一下」,
  // 循环立刻长回来。失败必须是终态。
  assert.equal(stateOf(first.id), 'failed', '失败要留成墓碑,不是永远卡在 loading')
})

test('末场快照已被滚动清理:查得到「没有」,同样落地不重试', async () => {
  reset()
  rig.ledger.delete(3)
  const pane = {}
  for (let i = 0; i < 4; i += 1) {
    renderBattlePaneTrailStep(pane, first, true)
    await settle()
  }
  assert.deepEqual(rig.reads, [3])
  assert.deepEqual(cellsOf(trailOf(first)), [1])
  assert.equal(stateOf(first.id), 'failed', '「问出来是没有」同样是终态,不是永远卡在 loading')
})

test('自己就是这次出击的末场:不发 IPC,索引长出新的一战后自然会再看一眼', async () => {
  reset()
  setHistory([first].map(summaryOf)) // 索引里这次出击只有第一场
  const pane = {}
  renderBattlePaneTrailStep(pane, first, true)
  await settle()
  assert.deepEqual(rig.reads, [], '手上这份已经是最全的,没什么可问的')
  assert.equal(cacheSize(), 0, '不许把「暂时问不出来」记成结论,否则索引补齐后再也不补航迹')

  setHistory([last, mid, first].map(summaryOf))
  renderBattlePaneTrailStep(pane, first, true)
  await settle()
  assert.deepEqual(cellsOf(trailOf(first)), [1, 2, 3])
})

test('缓存有上限,被挤掉的那一格回包不许再落回来', async () => {
  reset()
  rig.hold = true
  const pane = {}
  renderBattlePaneTrailStep(pane, first, true) // 发出去了,先挂着
  assert.equal(rig.pending.length, 1)

  // 另外十次出击各拉一次,把最早那一格挤出 LRU
  rig.hold = false
  for (let run = 1; run <= 10; run += 1) {
    const sortieId = 5000 + run * 1000
    const head = snapshotOf(1000 + run * 10, sortieId, 1, [1])
    const tail = snapshotOf(1001 + run * 10, sortieId, 2, [1, 2])
    rig.ledger.set(tail.id, tail)
    setHistory([tail, head, last, mid, first].map(summaryOf))
    renderBattlePaneTrailStep(pane, head, true)
    await settle()
  }
  assert.ok(cacheSize() <= 8, `LRU 上限失效,缓存涨到 ${cacheSize()} 条`)

  // 现在放行最早那个回包:它那一格早已不是当初那份
  rig.pending.shift()()
  await settle()
  assert.deepEqual(
    cellsOf(trailOf(first)),
    [1],
    '乱序回包按键比对丢弃:淘汰掉的格子不许被旧回包复活',
  )
  assert.ok(
    !rig.rerenders.some(([, snapshot]) => snapshot === first),
    '这一格早没人看了,旧回包不该再拽一次重画',
  )
})

test('拿错 run 的路径比路径短更糟:缓存条目仍绑着 sortieId', async () => {
  reset()
  const pane = {}
  renderBattlePaneTrailStep(pane, first, true)
  await settle()
  assert.deepEqual(cellsOf(trailOf(first)), [1, 2, 3])
  // 同一个 id 落到另一次出击(账本滚动后 id 复用)时,那条路径不认
  const impostor = { ...first, sortieId: 12345 }
  assert.deepEqual(cellsOf(trailOf(impostor)), [1])
})

test('同一次出击还在实时状态时,航迹直接用最全的 mg.sortie', async () => {
  reset()
  rig.live = {
    practice: false,
    mapArea: 1,
    mapNo: 2,
    startTs: 900,
    updatedTs: 900 + 4 * 60_000,
    nodes: [1, 2, 3, 4].map((cell) => ({ cell })),
  }
  assert.deepEqual(cellsOf(trailOf(first)), [1, 2, 3, 4])
  // 换一张图的出击不算同一次:上界卡 updatedTs 之外的也不算
  rig.live = { ...rig.live, mapNo: 5 }
  assert.deepEqual(cellsOf(trailOf(first)), [1])
})
