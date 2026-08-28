// 任务计数 · 自研侧 vs 线上链路的全目录逐条对账（离线，只读）。
//
// EO（quest-trackers）2026-08-21 整层退场之后，这份脚本换了对照基准：
// 原来比的是「自研 vs EO 的 164 条」，现在比的是
// **「只有 kuma 自研」 vs 「线上真实链路（kcwiki → poi → kuma → 文本）」**，
// 范围是中文任务目录的全部条目，不再是某个包给的那一小撮。
//
// 它回答的是拆除后唯一还需要盯的问题：**上游那两个 MIT 源在哪些条上与自研判得不一样。**
// 今天（2026-08-21 拆除当天）正是靠这一类比对逮到六条上游错值
// （333/334 演习评价、878 的评价、677/1103/1138 的废弃口径），
// 逐条拿游戏日文原文裁完之后写进 quest-source-conflicts 的修正台账。
//
// 边界（写死在这里，别放宽）：
// - **「与上游一致」不是验收标准**，只是回归信号。上游自己就会错（见修正台账的三处缺口）；
//   分歧一律拿**游戏自己的日文原文**裁，裁完写进台账，不在这里下结论。
// - 脚本不写任何文件到 src/ 或 assets/，也不改账本。
//
// 用法：
//   node scripts/quest-selfderive-diff.mjs                自研侧 vs 线上链路，全目录
//   node scripts/quest-selfderive-diff.mjs --kind=scrap   只看废弃装备类
//   node scripts/quest-selfderive-diff.mjs --ledger       只看修正台账点过名的那几条
//   ... --json=<file>                                     另存机读结果
import fs from 'node:fs'

import {
  QUEST_LODE_IDS,
  loadLodes,
  loadMasterSnapshot,
  loadQuestEngine,
  masterRawOf,
  offlineHost,
  quiet,
} from './lib/quest-engine.mjs'

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')

const KIND = opt('kind') ?? 'all'
const LEDGER_ONLY = flag('ledger')
const JSON_OUT = opt('json')

// 自研侧要抽掉的上游包。两个都抽 = 剩下的链路（kuma 规则 + 中文正文推导）全是自己的。
const UPSTREAM_LODES = ['kcwiki-quest-req', 'poi-quest-goal']

const SCRAP_KINDS = new Set(['scrapEquip', 'scrapCategory', 'scrapCardType', 'scrapIconType'])
const KIND_TESTS = {
  all: () => true,
  scrap: (tasks) => tasks.some((t) => SCRAP_KINDS.has(t.kind)),
  sortie: (tasks) => tasks.some((t) => ['bossKill', 'battleNode', 'nodeReach', 'mapFirstClear', 'mapGoal'].includes(t.kind)),
  exercise: (tasks) => tasks.some((t) => t.kind === 'exercise'),
  expedition: (tasks) => tasks.some((t) => t.kind === 'expedition'),
}
if (!KIND_TESTS[KIND]) {
  console.error(`未知 --kind=${KIND}；可选 ${Object.keys(KIND_TESTS).join(' / ')}`)
  process.exit(2)
}

const lodes = loadLodes(QUEST_LODE_IDS)
const snapshot = loadMasterSnapshot()
if (!lodes['quests-scn']) {
  console.error('缺 assets/lodes/quests-scn.json——中文任务目录是两侧共同的输入，没它跑不了')
  process.exit(2)
}
if (!snapshot) {
  console.error('缺 %APPDATA%/kanso/snapshots/kcsapi_api_start2_getData.json——主数据未就绪')
  process.exit(2)
}

const { createQuestEngine } = await loadQuestEngine()
const emptyState = () => ({
  player: { quests: {}, decks: [], ships: {}, slotitems: {}, materials: [], useitems: {} },
  sortie: null,
})

const runEngine = (lodeOverrides = {}) => {
  const packs = { ...lodes, ...lodeOverrides }
  const state = emptyState()
  const engine = createQuestEngine(
    offlineHost({ lodes: packs, snapshot, state: () => state }),
  )
  quiet(() => engine.init(masterRawOf(snapshot)))
  return engine.state().trackers
}

// ---- 规范化：只留判定相关的字段 ----
//
// name（"N"/"O"/"-2"）是展示串，对判定无影响，比它等于制造假分歧。
// 数组一律排序：两侧的 nodes 顺序没有可比性。
// 槽号同理只比**分组结构**（哪些子任务共享一个槽 = 任一命中即算），不比编号本身。
//
// 废弃类特别处理：category / cardType / iconType 是**同一件事的三种写法**，
// 比编码等于把「写法不同」当成「判定不同」。这里一律折算成
// 「玩家真能持有的装备里，哪些件会被这条子任务算进去」——集合相同就是同一回事。
// 实测因此消掉三组假分歧：category 15≡iconType 17（爆雷）、21≡15（机枪）、17≡19（机关部强化）。
//
// 1-6 终点的两种写法（mapGoal 与 nodeReach[14,17]）同理折算成一个 kind：
// 罗盘事件 8 与走到 N 格是同一刻的同一件事。
const PLAYER_EQUIP_MAX = 1500 // 主数据实测断层：自军装备到 588，深海装备从 1501 起
const playerItems = (masterRawOf(snapshot)?.api_mst_slotitem ?? [])
  .filter((item) => Number(item?.api_id) < PLAYER_EQUIP_MAX)
const membersOf = (task) => {
  const pick = (index, value) =>
    playerItems.filter((item) => Number(item?.api_type?.[index]) === value).map((item) => item.api_id)
  if (task.kind === 'scrapEquip') return [task.equipId]
  if (task.kind === 'scrapCategory') return pick(2, task.category)
  if (task.kind === 'scrapCardType') return pick(1, task.cardType)
  if (task.kind === 'scrapIconType') return pick(3, task.iconType)
  return null
}
const canonTask = (task, { dropRank = false } = {}) => {
  const members = membersOf(task)
  if (members) {
    return JSON.stringify({
      kind: 'scrap',
      count: task.count ?? 1,
      members: [...members].sort((a, b) => a - b).join(','),
    })
  }
  if (
    task.kind === 'mapGoal' ||
    (task.kind === 'nodeReach' && task.map?.[0] === 1 && task.map?.[1] === 6)
  ) {
    return JSON.stringify({
      kind: 'escortGoal',
      map: `${task.map[0]}-${task.map[1]}`,
      count: task.count ?? 1,
    })
  }
  const out = { kind: task.kind }
  const put = (key, value) => { if (value !== undefined) out[key] = value }
  put('count', task.count ?? 1)
  if ('map' in task) put('map', `${task.map[0]}-${task.map[1]}`)
  if ('rank' in task) put('rank', dropRank ? '*' : task.rank)
  if ('nodes' in task) put('nodes', [...(task.nodes ?? [])].sort((a, b) => a - b).join(','))
  if ('missionId' in task) put('missionId', task.missionId)
  if ('stypes' in task) put('stypes', [...(task.stypes ?? [])].sort((a, b) => a - b).join(','))
  if ('action' in task) put('action', task.action)
  return JSON.stringify(out)
}

const slotOf = (task, index) =>
  Number.isInteger(task.slot) && task.slot >= 0 ? task.slot : index
const canonTasks = (tasks, options) => {
  const groups = new Map()
  ;(tasks ?? []).forEach((task, index) => {
    const slot = slotOf(task, index)
    const list = groups.get(slot) ?? []
    list.push(canonTask(task, options))
    groups.set(slot, list)
  })
  return [...groups.values()].map((list) => list.sort().join('||')).sort().join('\n')
}

// ---- 两侧 ----

const production = runEngine() // 线上链路：kcwiki → poi → kuma → 文本
const selfOnly = runEngine(Object.fromEntries(UPSTREAM_LODES.map((id) => [id, null])))

const scn = lodes['quests-scn'].data ?? {}
const codeOf = (id) => `${scn?.[id]?.code ?? '—'}`
// 修正台账点过名的那几条：分歧本来就该有，报表里单列，别混进「待查」
const LEDGER_IDS = new Set([331, 332, 333, 334, 335, 336, 337, 339, 434, 677, 878, 1103, 1138])

const rows = []
for (const idText of Object.keys(scn).sort((a, b) => a - b)) {
  const questId = Number(idText)
  if (!(questId > 0)) continue
  const mine = selfOnly[questId] ?? null
  const live = production[questId] ?? null
  const myTasks = mine?.tasks ?? []
  const liveTasks = live?.tasks ?? []
  if (!mine && !live) continue
  if (!KIND_TESTS[KIND](liveTasks.length ? liveTasks : myTasks)) continue
  if (LEDGER_ONLY && !LEDGER_IDS.has(questId)) continue
  let verdict
  if (!live) verdict = '只有自研有'
  else if (!mine) verdict = '只有上游有'
  else if (canonTasks(liveTasks) === canonTasks(myTasks)) verdict = '一致'
  else if (
    canonTasks(liveTasks, { dropRank: true }) === canonTasks(myTasks, { dropRank: true })
  ) verdict = '仅评价不同'
  else verdict = '结构不同'
  rows.push({
    questId,
    code: codeOf(questId),
    name: `${scn?.[questId]?.name ?? ''}`,
    verdict,
    inLedger: LEDGER_IDS.has(questId),
    liveSource: live?.source ?? null,
    approx: mine?.approx ?? null,
    live: liveTasks,
    mine: myTasks,
  })
}

// ---- 反向控制：故意改坏一条，确认比较器真的会报出来 ----
//
// 「两侧多半一致」这句话本身证明不了比较器在干活——判断写反了它照样绿。
// 拿真数据造一次分歧，比较器必须逐类都能认出来。
const control = (() => {
  const sample = rows.find((row) => row.live.some((t) => 'rank' in t))
  if (!sample) return null
  const withRank = sample.live.map((t) => ('rank' in t ? { ...t, rank: (t.rank ?? 0) + 1 } : t))
  const withCount = sample.live.map((t, i) => (i === 0 ? { ...t, count: (t.count ?? 1) + 7 } : t))
  return {
    questId: sample.questId,
    sameIsEqual: canonTasks(sample.live) === canonTasks(sample.live),
    rankOnly:
      canonTasks(sample.live) !== canonTasks(withRank) &&
      canonTasks(sample.live, { dropRank: true }) === canonTasks(withRank, { dropRank: true }),
    structural:
      canonTasks(sample.live, { dropRank: true }) !== canonTasks(withCount, { dropRank: true }),
    missing: canonTasks(sample.live) !== canonTasks([]),
  }
})()

// ---- 报表 ----

const tally = {}
for (const row of rows) tally[row.verdict] = (tally[row.verdict] ?? 0) + 1

console.log(`对照：自研侧（抽掉 ${UPSTREAM_LODES.join(' / ')}） vs 线上链路 · 类别筛选：${KIND}${LEDGER_ONLY ? ' · 只看台账条目' : ''}`)
console.log(`中文任务目录 ${Object.keys(scn).length} 条，纳入比较 ${rows.length} 条`)
console.log('落点：' + Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(' · '))
if (control) {
  const ok = control.sameIsEqual && control.rankOnly && control.structural && control.missing
  console.log(
    `反向控制（拿 ${control.questId} 造分歧）：同源相等 ${control.sameIsEqual ? '✓' : '✗'}` +
    ` · 只改评价被认成「仅评价不同」 ${control.rankOnly ? '✓' : '✗'}` +
    ` · 改次数被认成「结构不同」 ${control.structural ? '✓' : '✗'}` +
    ` · 空侧不等于有侧 ${control.missing ? '✓' : '✗'}` +
    ` → 比较器${ok ? '可信' : '不可信'}`,
  )
  if (!ok) process.exitCode = 1
}

const fmt = (tasks) => tasks.map((t) => canonTask(t)).sort().join(' ')
for (const verdict of ['结构不同', '仅评价不同', '只有上游有', '只有自研有']) {
  const group = rows.filter((row) => row.verdict === verdict)
  if (!group.length) continue
  const untriaged = group.filter((row) => !row.inLedger).length
  console.log(`\n── ${verdict}（${group.length}${untriaged !== group.length ? ` · 其中修正台账已裁 ${group.length - untriaged}` : ''}）`)
  for (const row of group) {
    console.log(`  ${row.questId} ${row.code} ${row.name}${row.inLedger ? '  [台账已裁]' : ''}`)
    if (verdict !== '只有自研有') console.log(`    线上: ${fmt(row.live)}  [${row.liveSource}]`)
    if (verdict !== '只有上游有') console.log(`    自研: ${fmt(row.mine)}${row.approx ? ' ≈' : ''}`)
  }
}

if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, JSON.stringify({ kind: KIND, tally, control, rows }, null, 2))
  console.log(`\n机读结果 → ${JSON_OUT}`)
}
