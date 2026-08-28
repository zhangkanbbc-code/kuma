// 任务计数 · 历史回放对账（离线，只读账本）。
//
// 把账本 events 按时间顺序重放给**线上那台引擎**（src/main/mg/quest-counter.ts）
// 与**线上那套归约器**（src/main/mg/store.ts），每遇到一条 questlist / clearitemget
// 就拿本地计数和游戏自报的 api_state / api_progress_flag 对照。
//
// 三类违例（强度递减，见实施方案 §5.2）：
//   1. 未满已满   本地已宣称计满，游戏那一刻还说遂行中且粗档 < 80% —— **误涨**，硬门槛
//   2. 超出粗档   本地完成率越过粗档给出的上限（0档<50% / 1档<80% / 2档<100%）—— 误涨，硬门槛
//   3. 该满未满   游戏粗档已经上去了，本地还没跟上 —— 漏计，**软信号不设门槛**
//
// 为什么第 3 类不设门槛：本地计数只覆盖「kuma 在线的那段时间」。提督不开 kuma 打的那些
// 战斗、废弃、远征，账本里根本没有事件，漏计是必然而不是 bug。误涨则相反——
// 账本里没有的动作绝不可能让计数器自己涨起来，所以 1/2 类才是真能咬人的。
//
// 纪律：
// - 账本用 readOnly 打开，一个字节都不写（WAL 模式下应用开着也能读）。
// - 只对「本窗口内看到过受领（quest/start）」的任务判定：受领之前两边的起点都对不齐，
//   拿它算违例等于凭空造错。
// - 引擎里到处是 Date.now()（周期重置线、受领新鲜度）。回放期间把时钟钉在事件时间戳上，
//   否则 19 天前的日任全被判成「受领状态停在上一周期」，一条也不会计。
//
// 用法：
//   node scripts/quest-replay.mjs                    全量回放
//   node scripts/quest-replay.mjs --quest=677,402     只报这几条
//   node scripts/quest-replay.mjs --kind=scrap        只报废弃装备类
//   node scripts/quest-replay.mjs --json=<file>       另存机读结果
import fs from 'node:fs'

import {
  QUEST_LODE_IDS,
  loadLodes,
  loadMasterSnapshot,
  loadQuestEngine,
  loadStore,
  masterRawOf,
  offlineHost,
  openLedgerDb,
  quiet,
} from './lib/quest-engine.mjs'

const args = process.argv.slice(2)
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
const flag = (name) => process.argv.slice(2).includes(`--${name}`)
const ONLY_QUESTS = new Set((opt('quest') ?? '').split(',').filter(Boolean).map(Number))
// --self：抽掉 kcwiki/poi 两个上游包，让**自研规则**接管，回放验的就是自研这一侧。
// 不加这个开关跑的是线上链路（上游谁接住算谁），验的是玩家实际会拿到的判定。
// 两档都要跑：线上档是验收口径，--self 档才看得见自研规则自己有没有毛病。
const SELF = flag('self')
const UPSTREAM_LODES = ['kcwiki-quest-req', 'poi-quest-goal']
const KIND = opt('kind') ?? 'all'
const JSON_OUT = opt('json')

const SCRAP_KINDS = new Set(['scrapEquip', 'scrapCategory', 'scrapCardType', 'scrapIconType'])
const kindMatches = (tasks) => {
  if (KIND === 'all') return true
  if (KIND === 'scrap') return tasks.some((t) => SCRAP_KINDS.has(t.kind))
  if (KIND === 'exercise') return tasks.some((t) => t.kind === 'exercise')
  if (KIND === 'expedition') return tasks.some((t) => t.kind === 'expedition')
  if (KIND === 'sortie') {
    return tasks.some((t) =>
      ['bossKill', 'battleNode', 'nodeReach', 'mapFirstClear', 'mapGoal', 'battleWin', 'bossWin', 'bossReach', 'sinkEnemy'].includes(t.kind))
  }
  throw new Error(`未知 --kind=${KIND}`)
}

const db = openLedgerDb()
if (!db) {
  console.error('账本不存在（%APPDATA%/kanso/mg.sqlite）——没有流水可回放')
  process.exit(2)
}
const snapshot = loadMasterSnapshot()
if (!snapshot) {
  console.error('缺 api_start2 快照——主数据未就绪')
  process.exit(2)
}
const masterRaw = masterRawOf(snapshot)
const lodes = loadLodes(QUEST_LODE_IDS)
if (SELF) for (const id of UPSTREAM_LODES) lodes[id] = null

const store = await loadStore()
const { createQuestEngine } = await loadQuestEngine()

// 从零开始重放：不读用户账本里那份进度快照，也不写回去。
const engine = createQuestEngine(
  offlineHost({
    lodes,
    snapshot,
    state: () => store.getState(),
    progress: {},
  }),
)

quiet(() => {
  engine.init(masterRaw)
  store.handle('/kcsapi/api_start2/getData', masterRaw, {}, Date.now())
})

const trackers = engine.state().trackers
const taskCap = (tracker) => {
  // 一条任务的「满」= 每个计数槽都到自己的 count；槽由 qpTaskSlot 决定，不是下标。
  const slots = new Map()
  tracker.tasks.forEach((task, index) => {
    const slot = Number.isInteger(task.slot) && task.slot >= 0 ? task.slot : index
    if (!slots.has(slot)) slots.set(slot, task.count || 1)
  })
  return [...slots.entries()].sort(([a], [b]) => a - b).map(([, cap]) => cap)
}
const ratioOf = (tracker, counts) => {
  const caps = taskCap(tracker)
  if (!caps.length) return 0
  const total = caps.reduce((sum, cap) => sum + cap, 0)
  const done = caps.reduce((sum, cap, i) => sum + Math.min(cap, counts?.[i] ?? 0), 0)
  return total ? done / total : 0
}
const isComplete = (tracker, counts) =>
  taskCap(tracker).every((cap, i) => (counts?.[i] ?? 0) >= cap)

// ---- 回放 ----

const rows = db
  .prepare('SELECT ts, path, body, post_body FROM events ORDER BY ts ASC, id ASC')
  .all()

const realNow = Date.now
const armedAt = new Map() // questId → 受领时刻（本窗口内看到 quest/start 才算）
const violations = []
const seenQuests = new Set()
const activity = new Map() // questId → 本窗口内它遂行中时看到的可计数动作条数
const COUNTABLE = new Set([
  '/kcsapi/api_req_kousyou/createitem', '/kcsapi/api_req_kousyou/createship',
  '/kcsapi/api_req_kousyou/destroyship', '/kcsapi/api_req_kousyou/destroyitem2',
  '/kcsapi/api_req_hokyu/charge', '/kcsapi/api_req_nyukyo/start',
  '/kcsapi/api_req_kousyou/remodel_slot', '/kcsapi/api_req_kaisou/powerup',
  '/kcsapi/api_req_map/start', '/kcsapi/api_req_map/next',
  '/kcsapi/api_req_mission/start', '/kcsapi/api_req_mission/result',
  '/kcsapi/api_req_sortie/battleresult', '/kcsapi/api_req_combined_battle/battleresult',
  '/kcsapi/api_req_practice/battle_result',
])

// 「误涨」这顶帽子只扣在**声称精确**的追踪器上。
// approx（计数可能偏多）、partial（计数满≠可交付）、以及带库存/状态门的条目，
// 它们的语义本来就是「本地数字会跑在游戏进度前面」——游戏的粗档算的是含那道门的整条任务。
// 实弹样本：1150/2605F3 四项废弃全满、还差「准备 10 个 12.7cm 连装高角炮」，
// 游戏因此停在粗档 2；把它记成误涨等于把已经诚实标注的不确定再算一次账。
// 但也绝不能不报——单独一栏列出来，看得见才谈得上以后收窄。
const claimsPrecise = (tracker) =>
  !tracker.approx &&
  !tracker.partial &&
  !tracker.stateGoal &&
  !(tracker.stockGoals?.length)

// 正面证据：交付那一刻本地正好计满。没有违例只是「没抓到错」，
// 这一栏才是「真按流水走了一遍并对上了」。
const verified = []

const record = (questId, ts, kind, detail) => {
  violations.push({ questId, ts, kind, detail, precise: claimsPrecise(trackers[questId]) })
}

let replayed = 0
let countableSeen = 0
try {
  for (const row of rows) {
    if (row.body == null) continue // 快照路径：body 不入账本（start2 / port / require_info / ship2 / ship3）
    let parsed
    let post
    try {
      parsed = JSON.parse(row.body)
      post = JSON.parse(row.post_body || '{}')
    } catch (_e) {
      continue
    }
    if (parsed?.api_result !== undefined && parsed.api_result !== 1) continue
    const body = parsed?.api_data ?? parsed
    const apiPath = row.path
    const ts = Number(row.ts)
    Date.now = () => ts

    // 与 mg/index.ts 同序：废弃前先抓被删实例（归约会立刻把它们从库存删掉）
    const destroyedSlotitems =
      apiPath === '/kcsapi/api_req_kousyou/destroyitem2'
        ? `${post.api_slotitem_ids ?? ''}`.split(',')
          .map((x) => parseInt(x, 10))
          .filter((x) => x > 0)
          .reduce((result, id) => {
            const item = store.getState().player.slotitems[id]
            if (item) result[id] = { ...item }
            return result
          }, {})
        : undefined
    const expeditionDeckId =
      apiPath === '/kcsapi/api_req_mission/result'
        ? Number(post.api_deck_id ?? body?.api_deck_id ?? 0)
        : 0
    const expeditionMissionId =
      expeditionDeckId > 0
        ? store.getState().player.decks.find((deck) => deck.id === expeditionDeckId)?.mission?.[1] ?? 0
        : 0

    // 交付那一刻是最强证据：进度会被清掉，所以要在派发之前先看一眼
    if (apiPath === '/kcsapi/api_req_quest/clearitemget') {
      const questId = parseInt(post.api_quest_id, 10)
      const tracker = trackers[questId]
      if (questId > 0 && tracker && armedAt.has(questId)) {
        const counts = engine.state().progress[questId]
        if (isComplete(tracker, counts)) {
          verified.push({ questId, ts, counts: [...(counts ?? [])], caps: taskCap(tracker) })
        } else {
          record(questId, ts, '该满未满', `交付时本地 ${JSON.stringify(counts ?? [])} / ${JSON.stringify(taskCap(tracker))}`)
        }
      }
      armedAt.delete(questId) // 交付后重新受领才再次进入可判定窗口
    }

    quiet(() => store.handle(apiPath, body, post, ts))
    quiet(() => engine.onApi(apiPath, body, post, { destroyedSlotitems, expeditionMissionId }))
    replayed += 1
    if (COUNTABLE.has(apiPath)) {
      countableSeen += 1
      for (const questId of armedAt.keys()) {
        activity.set(questId, (activity.get(questId) ?? 0) + 1)
      }
    }

    if (apiPath === '/kcsapi/api_req_quest/start') {
      const questId = parseInt(post.api_quest_id, 10)
      if (questId > 0) armedAt.set(questId, ts)
    }

    if (apiPath === '/kcsapi/api_get_member/questlist') {
      const progress = engine.state().progress
      for (const observed of body?.api_list ?? []) {
        if (!observed || typeof observed !== 'object') continue
        const questId = Number(observed.api_no)
        const tracker = trackers[questId]
        if (!(questId > 0) || !tracker) continue
        seenQuests.add(questId)
        if (!armedAt.has(questId)) continue
        if (Number(observed.api_state) !== 2) continue
        const flag = Number(observed.api_progress_flag ?? 0)
        const counts = progress[questId]
        const ratio = ratioOf(tracker, counts)
        const complete = isComplete(tracker, counts)
        const ceiling = flag === 2 ? 1 : flag === 1 ? 0.8 : 0.5
        if (complete) {
          record(questId, ts, '未满已满', `本地已计满，游戏仍是遂行中(粗档 ${flag})`)
        } else if (ratio >= ceiling) {
          record(questId, ts, '超出粗档', `本地完成率 ${(ratio * 100).toFixed(0)}% ≥ 粗档 ${flag} 的上限 ${(ceiling * 100).toFixed(0)}%`)
        } else if (flag >= 1 && ratio < 0.5) {
          record(questId, ts, '该满未满', `游戏粗档 ${flag}（≥${flag === 2 ? 80 : 50}%），本地只有 ${(ratio * 100).toFixed(0)}%`)
        }
      }
    }
  }
} finally {
  Date.now = realNow
  db.close()
}

// ---- 报表 ----

const inScope = (questId) => {
  if (ONLY_QUESTS.size && !ONLY_QUESTS.has(questId)) return false
  const tracker = trackers[questId]
  return !!tracker && kindMatches(tracker.tasks)
}
const scoped = violations.filter((v) => inScope(v.questId))
const over = (v) => v.kind === '未满已满' || v.kind === '超出粗档'
const hard = scoped.filter((v) => over(v) && v.precise)
const approxOver = scoped.filter((v) => over(v) && !v.precise)
const soft = scoped.filter((v) => v.kind === '该满未满')
const scn = lodes['quests-scn']?.data ?? {}
const label = (questId) => `${questId} ${scn?.[questId]?.code ?? '—'} ${scn?.[questId]?.name ?? ''}`

const armedIds = [...new Set([...activity.keys()])].filter(inScope)
console.log(`规则源：${SELF ? '自研（已抽掉 ' + UPSTREAM_LODES.join(' / ') + '）' : '线上默认链路'}`)
console.log(`回放 ${replayed} 条事件（账本 ${rows.length} 行，${new Date(Number(rows[0]?.ts)).toISOString().slice(0, 10)} → ${new Date(Number(rows.at(-1)?.ts)).toISOString().slice(0, 10)}），其中可计数动作 ${countableSeen} 条`)
console.log(`有追踪器且被观测到的任务 ${[...seenQuests].filter(inScope).length} 条；本窗口内看到受领、进入可判定窗口的 ${armedIds.length} 条`)
console.log(`违例：精确侧误涨 ${hard.length}（硬门槛，须为 0） · 推定侧偏多 ${approxOver.length}（已标 ≈/partial/库存门，不设门槛） · 漏计 ${soft.length}（软信号，本地只覆盖 kuma 在线时段）`)

const scopedVerified = verified.filter((entry) => inScope(entry.questId))
if (scopedVerified.length) {
  console.log(`
── 交付时本地正好计满（正面证据 ${scopedVerified.length} 次）`)
  for (const entry of scopedVerified) {
    console.log(`  ${label(entry.questId)} @ ${new Date(entry.ts).toISOString().replace('T', ' ').slice(0, 19)}  ${JSON.stringify(entry.counts)} / ${JSON.stringify(entry.caps)}`)
  }
}

const group = (list) => {
  const byQuest = new Map()
  for (const v of list) {
    const bucket = byQuest.get(v.questId) ?? []
    bucket.push(v)
    byQuest.set(v.questId, bucket)
  }
  return [...byQuest.entries()].sort(([a], [b]) => a - b)
}
for (const [title, list] of [
  ['精确侧误涨（硬门槛）', hard],
  ['推定侧偏多（已标 ≈ / partial / 库存门）', approxOver],
  ['漏计（软信号）', soft],
]) {
  if (!list.length) continue
  console.log(`\n── ${title}`)
  for (const [questId, items] of group(list)) {
    console.log(`  ${label(questId)} · ${items.length} 次`)
    for (const item of items.slice(0, 3)) {
      console.log(`    ${new Date(item.ts).toISOString().replace('T', ' ').slice(0, 19)} ${item.kind}：${item.detail}`)
    }
    if (items.length > 3) console.log(`    …另 ${items.length - 3} 次`)
  }
}

if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, JSON.stringify({
    replayed,
    countableSeen,
    armed: armedIds,
    verified: scopedVerified,
    hard,
    approxOver,
    soft,
  }, null, 2))
  console.log(`\n机读结果 → ${JSON_OUT}`)
}

if (hard.length) process.exitCode = 1
