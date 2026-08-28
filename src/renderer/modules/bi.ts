// 镖 (Bi) · 远征规划——12 稿。左=远征总表（搜索/海域筛选/时薪排序/三队甘特），
// 右=推挤详情（条件检查[对所选舰队实时判定]/收益/大成功/原文备注）。
// 数据分层：官方骨架/奖励物品/示例编成/难度 = api_mst_mission；
// 条件+基础报酬+大成功 = wikiwiki-expedition；中文名称 = kcwiki-expedition。
// 只读纪律：编成/装备请在游戏内操作，这里只做判定与提示。
// 判定诚实度：舰种解析不出的条件显示 ◌「无法自动判定」绝不假装 ✓/✗；
// 属性合计含舰载机数值（与 wiki 判定口径略有出入），页脚有注。
import {
  combinedEscortState,
  esc,
  exitWithMotion,
  fmtCountdownShort,
  fmtTime,
  lodeCredit,
  masterShipName,
  mg,
  commitPaneHtml,
  deferWhilePressed,
  forgetCommittedHtml,
  onMgChange,
  onQpChange,
  onTick,
  queryExpeditionHistory,
  queryLode,
  queryMasterRaw,
  queryQp,
  uiGet,
  uiSet,
  updateCountdowns,
} from '../kernel'
import { elink, elinkHtml, registerEntityRoute } from '../link'
import {
  entityNameHtml,
  entityNamePlain,
  entityTermHtml,
  localizedEntityId,
} from '../localization'
import { materialIconHtml, shipThumbHtml, useItemIconHtml } from '../entity-art'
import { activateModule, registerModule } from '../mu'
import { matchSlots } from '../../shared/slot-matching'
import {
  compReqStatus,
  parseCompositionBranches,
} from '../../shared/expedition-composition'
import type { CompShipView } from '../../shared/expedition-composition'
import { questName } from './qn'

import type { LodeMeta } from '../kernel'
import type { Deck, ExpeditionHistoryReport, PlayerShip } from '../../shared/mg-types'
import { qpTaskSlot } from '../../shared/qp-types'
import type { QpState } from '../../shared/qp-types'

let pane: HTMLElement
let expedLode: { meta: LodeMeta; data: any } | null = null // wikiwiki 事实层（缺失时 kcwiki 降级）
let expedLocalizationLode: { meta: LodeMeta; data: any } | null = null
let areaNames: Map<number, string> = new Map()
let useitemNames: Map<number, string> = new Map()
let qp: QpState | null = null
const expeditionHistory = new Map<number, ExpeditionHistoryReport>()
const expeditionHistoryLoading = new Set<number>()
const expeditionHistoryLoaded = new Map<number, number>() // missionId → 手上这份对应的代
const expeditionHistoryFailed = new Set<number>() // 最近一次读取失败、且还没成功过的
const expeditionHistoryGeneration = new Map<number, number>()
const lastDeckMissions = new Map<number, number>() // deckId → 上一次看到的 missionId（返港检测用）

interface PlannerPrefs {
  protectedDeckIds: number[]
  excludedRosterIds: number[]
}
const PLANNER_PREFS_KEY = 'bi.planner-prefs.v1'
const savedPlannerPrefs = uiGet<Partial<PlannerPrefs>>(PLANNER_PREFS_KEY, {})
let plannerPrefs: PlannerPrefs = {
  protectedDeckIds: Array.isArray(savedPlannerPrefs.protectedDeckIds)
    ? savedPlannerPrefs.protectedDeckIds
    : [1],
  excludedRosterIds: Array.isArray(savedPlannerPrefs.excludedRosterIds)
    ? savedPlannerPrefs.excludedRosterIds
    : [],
}

// 落盘一次 = 一次同步 IPC + 整份 config.json stringify + fsync + rename。
// 这函数挂在 ships/decks 每个报文上（要剔除已解体舰），等于把原子写盘放进了
// 游戏事件链——所以清洗归清洗，**只在名单真的变了时才写**，且 150ms 尾随去抖
// （同 yu 的音量滑条：连续报文收敛成一次写）。
let plannerPrefsCommitted = JSON.stringify(plannerPrefs)
let plannerPrefsTimer: ReturnType<typeof setTimeout> | null = null

const savePlannerPrefs = () => {
  plannerPrefs.protectedDeckIds = [...new Set(plannerPrefs.protectedDeckIds)]
    .filter((id) => id >= 1 && id <= 4)
    .sort((a, b) => a - b)
  const excluded = [...new Set(plannerPrefs.excludedRosterIds)].filter((id) => id > 0)
  // 「已解体的从排除名单里剔除」只在在籍表确实到手时做：游戏数据还没同步的那一刻
  // 整表都查不到，那不是全员解体，照旧剔除会把名单清空并落盘（且不可逆）。
  const rosterReady = Object.keys(mg.ships).length > 0
  plannerPrefs.excludedRosterIds = (
    rosterReady ? excluded.filter((id) => Boolean(mg.ships[id])) : excluded
  ).slice(-300)
  const next = JSON.stringify(plannerPrefs)
  if (next === plannerPrefsCommitted) return
  plannerPrefsCommitted = next
  if (plannerPrefsTimer) clearTimeout(plannerPrefsTimer)
  plannerPrefsTimer = setTimeout(() => {
    plannerPrefsTimer = null
    uiSet(PLANNER_PREFS_KEY, plannerPrefs)
  }, 150)
}

const state = {
  search: '',
  area: null as string | null, // 'a1'..'a7' | 'monthly' | 'support' | null
  sort: 'total' as 'total' | 'fuel' | 'ammo' | 'steel' | 'baux' | 'time',
  selected: null as number | null, // api mission id
  deckId: null as number | null, // 条件检查所选舰队
  resourceFocus: null as number | null,
  joint: {} as Record<number, number>, // 多队联立：舰队 id → 打算跑的远征 apiId
}

const RESOURCE_FOCUS: Record<
  number,
  { label: string; sort?: typeof state.sort; rewardName?: string }
> = {
  0: { label: '燃料', sort: 'fuel' },
  1: { label: '弹药', sort: 'ammo' },
  2: { label: '钢材', sort: 'steel' },
  3: { label: '铝土', sort: 'baux' },
  4: { label: '高速建造材', sort: 'time', rewardName: '高速建造材' },
  5: { label: '高速修复材', sort: 'time', rewardName: '高速修复材' },
  6: { label: '开发资材', sort: 'time', rewardName: '开发资材' },
  7: { label: '改修资材', sort: 'time', rewardName: '改修资材' },
}

// 四种基础资源的名字：本文件里凡是「按下标取材料名」的地方都只认这一份
// （曾经抄了三遍，其中一处把钢材写成了「钢铁」）。下标 = materialIconHtml 的 id - 1。
const MATERIAL_NAMES = ['燃料', '弹药', '钢材', '铝土'] as const

// ---- 索引 ----

interface Exped {
  apiId: number
  dispNo: string
  name: string // 主数据日文名
  timeMin: number
  useFuel: number
  useBull: number
  deckNum: number
  mapArea: number
  difficulty: number
  winItem1: [number, number]
  winItem2: [number, number]
  sampleFleet: number[]
  details: string // api_details 官方说明原文(一手;支援远征的唯一条件文本)
  wiki: any | null // wikiwiki 事实 + kcwiki 中文名/复杂条件降级
}

const normalizedDispNo = (value: string) => value.replace(/^0+(?=\d)/, '')

const allExpeds = (): Exped[] => {
  const out: Exped[] = []
  for (const [idStr, m] of Object.entries(mg.master.missions)) {
    const apiId = parseInt(idStr, 10)
    const dispNo = normalizedDispNo(m.dispNo)
    const facts = expedLode?.data?.[dispNo] ?? null
    const localized = expedLocalizationLode?.data?.[dispNo] ?? null
    const wiki = facts
      ? {
          ...localized,
          ...facts,
          nameZh: localized?.nameZh ?? '',
          composition: facts.composition ?? localized?.composition ?? null,
          escortText: facts.rawComposition ?? localized?.escortText ?? null,
        }
      : localized
    out.push({
      apiId,
      dispNo,
      name: m.name,
      timeMin: m.time,
      useFuel: m.useFuel,
      useBull: m.useBull,
      deckNum: m.deckNum,
      mapArea: m.mapArea,
      difficulty: m.difficulty,
      winItem1: m.winItem1,
      winItem2: m.winItem2,
      sampleFleet: m.sampleFleet,
      details: m.details ?? '',
      wiki,
    })
  }
  return out
}

const hourly = (e: Exped): { fuel: number; ammo: number; steel: number; baux: number } => {
  const r = e.wiki?.rewards
  const per = (pair: any) => (Array.isArray(pair) ? (pair[1] ?? (e.timeMin ? Math.round((pair[0] * 60) / e.timeMin) : 0)) : 0)
  return { fuel: per(r?.fuel), ammo: per(r?.ammo), steel: per(r?.steel), baux: per(r?.baux) }
}

const baseRewards = (e: Exped): [number, number, number, number] => {
  const rewards = e.wiki?.rewards
  const amount = (pair: any) => Array.isArray(pair) ? Math.max(0, Number(pair[0]) || 0) : 0
  return [
    amount(rewards?.fuel),
    amount(rewards?.ammo),
    amount(rewards?.steel),
    amount(rewards?.baux),
  ]
}

const expeditionSupplyCost = (
  e: Exped,
  ships: PlayerShip[],
): [number, number, number, number] => [
  ships.reduce(
    (sum, ship) => sum + Math.floor((mg.master.ships[ship.shipId]?.fuelMax ?? 0) * e.useFuel),
    0,
  ),
  ships.reduce(
    (sum, ship) => sum + Math.floor((mg.master.ships[ship.shipId]?.bullMax ?? 0) * e.useBull),
    0,
  ),
  0,
  0,
]

const estimatedNet = (
  e: Exped,
  ships: PlayerShip[],
): {
  gross: [number, number, number, number]
  cost: [number, number, number, number]
  net: [number, number, number, number]
  hourly: { fuel: number; ammo: number; steel: number; baux: number }
} => {
  const gross = baseRewards(e)
  const cost = expeditionSupplyCost(e, ships)
  const net = gross.map((value, index) => value - cost[index]) as [number, number, number, number]
  const scale = e.timeMin > 0 ? 60 / e.timeMin : 0
  return {
    gross,
    cost,
    net,
    hourly: {
      fuel: Math.round(net[0] * scale),
      ammo: Math.round(net[1] * scale),
      steel: Math.round(net[2] * scale),
      baux: Math.round(net[3] * scale),
    },
  }
}

const isSupport = (e: Exped) => /支援/.test(e.wiki?.nameZh ?? e.name) || e.mapArea > 10

// ---- 条件检查引擎 ----

// 解析器抽在 shared/expedition-composition:测试拿真函数打真矿脉,
// 断言解析覆盖率 100%——新舰种写法进包时测试先红,不让玩家撞 ◌。

interface CheckRow {
  mark: 'ok' | 'no' | 'wait'
  text: string
  cur: string
}

const DRUM_MST = 75 // ドラム缶(輸送用)

const fleetShipsOf = (deck: Deck): PlayerShip[] =>
  deck.ships.filter((id) => id > 0).map((id) => mg.ships[id]).filter(Boolean)

const stypeOf = (ship: PlayerShip) => mg.master.ships[ship.shipId]?.stype ?? 0

// 护卫空母判别：主数据 api_tais 恰好只长在护卫空母身上（大鷹 35/鳳翔改二戦 34，
// 龍驤等普通轻母根本没有这个字段）——不是启发式，是官方数据自带的分界。
const isCveShip = (ship: PlayerShip) =>
  stypeOf(ship) === 7 && (mg.master.ships[ship.shipId]?.baseTais ?? 0) > 0

const compViewOf = (ships: PlayerShip[]): CompShipView[] =>
  ships.map((ship) => ({ stype: stypeOf(ship), cve: isCveShip(ship) }))

const drumCount = (ship: PlayerShip) =>
  [...ship.slot, ship.slotEx].filter((inst) => inst > 0 && mg.slotitems[inst]?.mstId === DRUM_MST).length

// 鼓桶库存是**全表扫描**，而 checkShips 会被 liftToPass 的内层循环喊上千次
// （每格 × 每候选 × 每轮）——按装备表本体缓存，一次报文只扫一遍。
// mg.slotitems 每次经 IPC 补丁到达都是新对象，所以对象本体就是天然的失效标记。
let drumStockCache: { source: unknown; count: number } | null = null
const drumStock = (): number => {
  if (drumStockCache?.source !== mg.slotitems) {
    let count = 0
    for (const item of Object.values(mg.slotitems)) if (item.mstId === DRUM_MST) count++
    drumStockCache = { source: mg.slotitems, count }
  }
  return drumStockCache.count
}

// 编成条件解析：一次渲染里同一条 composition 会被解析很多遍
// （列表每行一次 fitChip + 规划器每次试凑一次），而它是纯文本→结构的纯函数。
// 按原文 memo，条目数量级只有几十条，不设上限也不会涨。
const compositionBranchCache = new Map<string, ReturnType<typeof parseCompositionBranches>>()
const compositionBranches = (w: any) => {
  const key = `${w.composition}\u0000${w.escortText ?? ''}`
  const cached = compositionBranchCache.get(key)
  if (cached) return cached
  const branches = parseCompositionBranches(w.composition, w.escortText ?? null)
  compositionBranchCache.set(key, branches)
  return branches
}

// 条件检查：返回行列表 + 汇总（fails 不含 wait）
// 按「舰只列表」判定而非按舰队——这样自动生成的编成方案能走同一套口径，
// 不会出现「方案说满足、条件检查说不满足」的两套标准。
const checkExpedition = (e: Exped, deck: Deck) => checkShips(e, fleetShipsOf(deck))

const checkShips = (e: Exped, ships: PlayerShip[]): { rows: CheckRow[]; fails: number; unknowns: number } => {
  const rows: CheckRow[] = []
  const w = e.wiki
  const need = (v: number | null | undefined) => typeof v === 'number' && v > 0

  const minShips = Math.max(w?.minShips ?? 0, e.deckNum)
  if (need(minShips)) {
    rows.push({
      mark: ships.length >= minShips ? 'ok' : 'no',
      text: `舰娘数 ≥ <em>${minShips}</em>`,
      cur: `当前 <b>${ships.length}</b>`,
    })
  }
  if (need(w?.flagLv)) {
    const flag = ships[0]
    rows.push({
      mark: flag && flag.lv >= w.flagLv ? 'ok' : 'no',
      text: `旗舰 Lv ≥ <em>${w.flagLv}</em>`,
      cur: flag ? `旗舰 <b>${entityNameHtml('ship', flag.shipId, masterShipName(flag.shipId), { compact: true })} Lv${flag.lv}</b>` : '空舰队',
    })
  }
  if (need(w?.fleetLv)) {
    const total = ships.reduce((acc, s) => acc + s.lv, 0)
    rows.push({
      mark: total >= w.fleetLv ? 'ok' : 'no',
      text: `舰队合计 Lv ≥ <em>${w.fleetLv}</em>`,
      cur: `当前 <b>${total}</b>`,
    })
  }
  // 编成（舰种）。一条远征可能有多套可行编成（「或」分支 + wiki 变体），
  // 任一分支满足即可——逐支判定后取失败项最少的那支展示，绝不摊平成
  // 「同时要求」（43 的护卫空母船团曾因此被误判 ✗，2026-08-13 用户点名复查）。
  if (w?.composition && !/^任意$/.test(w.composition.trim())) {
    const branches = compositionBranches(w)
    const view = compViewOf(ships)
    const evaluated = branches.map((branch) => {
      const branchRows: CheckRow[] = []
      for (const req of branch.reqs) {
        if (req.wildcard) continue
        if (!req.types) {
          branchRows.push({ mark: 'wait', text: `${esc(req.label)}（无法自动判定，见原文）`, cur: '' })
          continue
        }
        const { matched, ok, flagOk } = compReqStatus(req, view)
        let cur = `当前 <b>${matched}</b>`
        if (req.homogeneous) cur += '（须同一舰种凑满，1+1 混搭不可）'
        if (req.flagship) cur += flagOk ? ' · 旗舰✓' : ' · 旗舰舰种不符'
        branchRows.push({
          mark: ok ? 'ok' : 'no',
          text: `${esc(req.label)} ≥ <em>${req.count}</em>`,
          cur,
        })
      }
      return {
        branch,
        rows: branchRows,
        fails: branchRows.filter((row) => row.mark === 'no').length,
        unknowns: branchRows.filter((row) => row.mark === 'wait').length,
      }
    })
    const best = evaluated.reduce((left, right) =>
      right.fails < left.fails ||
      (right.fails === left.fails && right.unknowns < left.unknowns)
        ? right
        : left,
    )
    if (evaluated.length > 1) {
      const tag = best.branch.label ? `「${best.branch.label}」` : ''
      rows.push(
        best.fails === 0
          ? {
              mark: 'ok',
              text: `编成有 ${evaluated.length} 套可行口径，任一满足即可`,
              cur: `当前满足${tag}`,
            }
          : {
              mark: 'wait',
              text: `编成有 ${evaluated.length} 套可行口径，都未满足`,
              cur: '',
            },
      )
    }
    rows.push(...best.rows)
  }
  // 属性合计（含舰载机数值，口径注在页脚）
  if (w?.stats) {
    const SUM: Record<string, (s: PlayerShip) => number> = {
      火力: (s) => s.karyoku,
      对空: (s) => s.taiku,
      对潜: (s) => s.taisen,
      索敌: (s) => s.sakuteki,
    }
    for (const [key, req2] of Object.entries(w.stats as Record<string, number>)) {
      const total = SUM[key] ? ships.reduce((acc, s) => acc + SUM[key](s), 0) : null
      if (total == null) {
        rows.push({ mark: 'wait', text: `${esc(key)} ≥ <em>${req2}</em>（未知属性）`, cur: '' })
      } else {
        rows.push({
          mark: total >= req2 ? 'ok' : 'no',
          text: `舰队${esc(key)} ≥ <em>${req2}</em>`,
          cur: `当前 <b>${total}</b>`,
        })
      }
    }
  }
  // 鼓桶
  if (w?.drumTotal || w?.drumShips) {
    const perShip = ships.map(drumCount)
    const total = perShip.reduce((a, b) => a + b, 0)
    const carriers = perShip.filter((n) => n > 0).length
    const okTotal = !w.drumTotal || total >= w.drumTotal
    const okShips = !w.drumShips || carriers >= w.drumShips
    const stock = drumStock()
    rows.push({
      mark: okTotal && okShips ? 'ok' : 'no',
      text: `运输桶${w.drumShips ? ` 携带舰 ≥ <em>${w.drumShips}</em>` : ''}${w.drumTotal ? ` 合计 ≥ <em>${w.drumTotal}</em>` : ''}`,
      cur: `已装载 <b>${total}</b>（${carriers} 艘舰娘）· 库存 ${stock} ${elink('mstEquip', DRUM_MST, '装备图鉴 →')}`,
    })
  }
  // 大成功（口径复杂，只提示 + 闪光实况）
  if (w?.greatNote) {
    const kira = ships.filter((s) => s.cond >= 50).length
    rows.push({
      mark: 'wait',
      text: `大成功：${esc(w.greatNote)}`,
      cur: `当前闪光 <b>${kira}/${ships.length}</b>`,
    })
  }
  const fails = rows.filter((r) => r.mark === 'no').length
  const unknowns = rows.filter((r) => r.mark === 'wait').length
  return { rows, fails, unknowns }
}

// ---- 可行编成方案（12 稿）----
//
// 从「非远征在籍舰」里自动凑一支满足条件的队。取舍原则（设计稿口径）：
// 优先闲置、优先低练——把主力留给出击，远征用够用就行的舰。
// 生成后用 checkShips 同一套判定复核，不自说自话。
// 只读建议：编成与装备一律在游戏内操作。

interface PlanShip {
  ship: PlayerShip
  role: string // 旗舰 / 满足的那条舰种要求 / 自由枠
  where: string // 闲置 / 第N舰队
  kira: boolean
}

const shipWhere = (ship: PlayerShip): string => {
  const deck = mg.decks.find((d) => d.ships.includes(ship.id))
  return deck ? `第${deck.id}舰队` : '闲置'
}

// 可用池：排除远征在途、入渠中、大破、联合编成的第 2 舰队
const availableShips = (): PlayerShip[] => {
  const busy = new Set<number>()
  const protectedShips = new Set<number>()
  const excluded = new Set(plannerPrefs.excludedRosterIds)
  for (const deck of mg.decks) {
    // 联合第 2 舰队的舰与远征在途的舰同档：她的 mission 恒为 0，不摘出去，
    // 凑出来的方案就是「把随伴舰队拆开去跑远征」——那支队游戏里根本派不出去，
    // 而 freeDecks 那头已经不给她列队号了，这头再把她的舰凑进来是自相矛盾。
    // 出击与否都摘（与 freeDecks 同一裁定）。
    if (deck.mission?.[0] > 0 || combinedEscortState(deck.id)) {
      deck.ships.filter((id) => id > 0).forEach((id) => busy.add(id))
    }
    if (plannerPrefs.protectedDeckIds.includes(deck.id)) {
      deck.ships.filter((id) => id > 0).forEach((id) => protectedShips.add(id))
    }
  }
  for (const dock of mg.ndocks) {
    if (dock.shipId > 0) busy.add(dock.shipId)
  }
  return Object.values(mg.ships).filter(
    (s) =>
      !busy.has(s.id) &&
      !protectedShips.has(s.id) &&
      !excluded.has(s.id) &&
      !(s.maxhp > 0 && s.nowhp / s.maxhp <= 0.25),
  )
}

// 取舍顺序：闲置优先 → 低练优先 → キラ 优先（大成功加分）
const planPriority = (a: PlayerShip, b: PlayerShip): number => {
  const idle = (s: PlayerShip) => (mg.decks.some((d) => d.ships.includes(s.id)) ? 1 : 0)
  return idle(a) - idle(b) || a.lv - b.lv || (b.cond >= 50 ? 1 : 0) - (a.cond >= 50 ? 1 : 0)
}

// 一个坑位：这条远征要求里的某一格。把「要求」摊成逐格的坑，
// 是为了能对「舰 ↔ 坑」跑真正的匹配，而不是逐条要求先到先得。
interface PlanSlot {
  exped: Exped
  role: string
  flagship: boolean // 必须落在该队首位
  accepts: (ship: PlayerShip) => boolean
}

const slotsOf = (e: Exped): PlanSlot[] => {
  const w = e.wiki
  const minShips = Math.max(w?.minShips ?? 0, e.deckNum, 1)
  const flagLv = w?.flagLv ?? 0
  // 规划器按**首选编成**（第一分支）搭骨架；复核走 checkShips，
  // 那边认所有分支——首选凑不齐时 liftToPass 仍可能靠其他分支过关。
  const reqs =
    w?.composition && !/^任意$/.test(w.composition.trim())
      ? compositionBranches(w)[0].reqs
      : []
  const flagReq = reqs.find((r) => r.flagship && r.types)
  const slots: PlanSlot[] = []
  let flagshipTaken = false
  for (const req of reqs) {
    if (!req.types || req.wildcard) continue
    const types = req.types
    const needCve = req.cve
    const role = req.label.replace(/\(旗舰\)/, '')
    for (let i = 0; i < req.count; i++) {
      // 「軽巡(旗舰)*1」这类要求里，旗舰就是它自己的第一格，不额外再占一格
      const isFlag = !flagshipTaken && req === flagReq && i === 0
      if (isFlag) flagshipTaken = true
      slots.push({
        exped: e,
        role: isFlag ? '旗舰' : role,
        flagship: isFlag,
        accepts: (s) =>
          types.includes(stypeOf(s)) &&
          (!needCve || isCveShip(s)) &&
          (!isFlag || s.lv >= flagLv),
      })
    }
  }
  if (!flagshipTaken) {
    slots.unshift({ exped: e, role: '旗舰', flagship: true, accepts: (s) => s.lv >= flagLv })
  }
  while (slots.length < minShips) {
    slots.push({ exped: e, role: '自由枠', flagship: false, accepts: () => true })
  }
  return slots
}

// 舰 ↔ 坑位的匹配走 shared/slot-matching：那是纯逻辑，有独立的红绿样本盯着。
// 舰按取舍顺序（闲置→低练→キラ）传进去，拿回的就是最省的一组最大匹配。
const matchPlanSlots = (slots: PlanSlot[], pool: PlayerShip[]): (PlayerShip | null)[] =>
  matchSlots(slots, pool, (slot, ship) => slot.accepts(ship))

/**
 * 舰队合计 Lv 不够时，把最低练的那格换成更高练的一艘。
 * 只在**该坑位仍然收得下**的候选里换，不会为了凑 Lv 破坏舰种条件。
 *
 * `from`/`to` 划出要抬的那一段（联立时就是某一支队）。
 * 关键：**「谁已经被占了」要看整个 holder，不是只看这一段**——
 * 只看本段的话，三支队会各自把同一艘低练舰抓走，界面还照报「互不抢人」。
 */
const liftFleetLevel = (
  slots: PlanSlot[],
  holder: (PlayerShip | null)[],
  pool: PlayerShip[],
  target: number,
  from = 0,
  to = slots.length,
) => {
  const sumLv = () => {
    let total = 0
    for (let i = from; i < to; i++) total += holder[i]?.lv ?? 0
    return total
  }
  let guard = 0
  while (sumLv() < target && guard++ < 30) {
    // 整张 holder 的占用情况，含别的队
    const busy = new Set(holder.filter(Boolean).map((s) => s!.id))
    let best: { index: number; gain: number; ship: PlayerShip } | null = null
    for (let i = from; i < to; i++) {
      const current = holder[i]
      if (!current) continue
      // 换进来的取「刚好比现役高」的那一艘：够用就行，别把主力搭进去
      const candidate = pool
        .filter((s) => !busy.has(s.id) && s.lv > current.lv && slots[i].accepts(s))
        .sort((a, b) => a.lv - b.lv)[0]
      if (!candidate) continue
      const gain = candidate.lv - current.lv
      if (!best || gain < best.gain) best = { index: i, gain, ship: candidate }
    }
    if (!best) break
    holder[best.index] = best.ship
  }
}

/**
 * 换人直到条件检查过关（或换不动了）。
 *
 * 匹配只保证「舰种 + 旗舰 Lv」，但远征还有合计 Lv、火力/对空/对潜/索敌合计
 * 这类**总量**门槛——按最省原则挑出来的低练舰凑不够，方案就会自带一个 ✗。
 * 各项分开修没用：换一艘会同时动好几项，所以直接拿 checkShips 的失败项数
 * 当目标函数，换完变少就留下。
 *
 * 仍然「够用就行」：同样能减少失败项时，选练度最低的那艘，主力留给出击。
 *
 * **有界**：每格只看 CANDIDATE_SCAN 个候选（按练度从高到低），最多 LIFT_ROUNDS 轮。
 * 抬不到 0 失败就停，剩下的由判定行如实报「仍差 N 项」——不假装凑齐了。
 */
const CANDIDATE_SCAN = 8
const LIFT_ROUNDS = 24

const liftToPass = (
  e: Exped,
  slots: PlanSlot[],
  holder: (PlayerShip | null)[],
  pool: PlayerShip[],
  from = 0,
  to = slots.length,
) => {
  const segment = () => {
    const picks: PlayerShip[] = []
    for (let i = from; i < to; i++) if (holder[i]) picks.push(holder[i]!)
    // 判定按 ships[0] 认旗舰，评估时也得让旗舰在首位
    const flagIdx = slots.slice(from, to).findIndex((s) => s.flagship)
    if (flagIdx > 0 && holder[from + flagIdx]) {
      const flag = holder[from + flagIdx]!
      return [flag, ...picks.filter((s) => s !== flag)]
    }
    return picks
  }
  let rounds = 0
  while (rounds++ < LIFT_ROUNDS) {
    const before = checkShips(e, segment()).fails
    if (before === 0) break
    // 整张 holder 的占用情况，含别的队——联立时不能把已派出的人再抓一次
    const busy = new Set(holder.filter(Boolean).map((s) => s!.id))
    let best: { index: number; ship: PlayerShip; fails: number } | null = null
    for (let i = from; i < to; i++) {
      const occupant = holder[i]
      if (!occupant) continue
      const candidates = pool
        .filter((s) => !busy.has(s.id) && slots[i].accepts(s))
        .sort((a, b) => b.lv - a.lv)
        .slice(0, CANDIDATE_SCAN)
      for (const candidate of candidates) {
        holder[i] = candidate
        const fails = checkShips(e, segment()).fails
        holder[i] = occupant
        if (fails >= before) continue
        // 同样能减少失败项时挑练度低的：够用就行
        if (!best || fails < best.fails || (fails === best.fails && candidate.lv < best.ship.lv)) {
          best = { index: i, ship: candidate, fails }
        }
      }
    }
    if (!best) break
    holder[best.index] = best.ship
  }
}

const toPicks = (slots: PlanSlot[], holder: (PlayerShip | null)[]): PlanShip[] =>
  slots.flatMap((slot, i) =>
    holder[i]
      ? [{ ship: holder[i]!, role: slot.role, where: shipWhere(holder[i]!), kira: holder[i]!.cond >= 50 }]
      : [],
  )

// 方案构建（最大匹配 + liftToPass 逐候选试凑）按输入缓存：pane 激活期间每次
// mg 变化都会整面板重渲染，可用池与目标没变时不必重跑一遍匹配
const planPoolSignature = (): string => {
  const deckOf = new Map<number, number>()
  for (const deck of mg.decks) {
    for (const rosterId of deck.ships) if (rosterId > 0) deckOf.set(rosterId, deck.id)
  }
  // 条件资料（矿脉包）与主数据也是方案的输入：装配时先同步 render 一次，
  // 那一刻包还没到，凑出来的是「无条件」的缩水方案。签名带上就绪标识，
  // 包到达后缓存自然失效，方案自愈——否则要等下一次舰队变动才会重算。
  const inputs = `${expedLode ? 1 : 0}${expedLocalizationLode ? 1 : 0}:${
    Object.keys(mg.master.missions).length
  }|`
  return inputs + availableShips()
    .map((ship) =>
      [
        ship.id,
        ship.shipId, // 改造会换舰种，rosterId 不变
        ship.lv,
        ship.cond,
        ship.karyoku,
        ship.taiku,
        ship.taisen,
        ship.sakuteki,
        deckOf.get(ship.id) ?? 0, // 闲置优先级与「所在」文案
        ...ship.slot, // 鼓桶与装备加成会改变条件判定
        ship.slotEx,
      ].join(':'),
    )
    .join(',')
}
type PlanResult = { picks: PlanShip[]; verdict: ReturnType<typeof checkShips> }

// 签名对整张表只存一份：逐项各存一份的话，池子有多大这份字符串就有多大（实测每项 25KB
// 量级 × 上百条远征），而它们本来就永远是同一个值——签名一变整表作废即可。
const singlePlanCache: { key: string; plans: Map<number, PlanResult | null> } = {
  key: '',
  plans: new Map(),
}
let jointPlanCache: { key: string; plans: ReturnType<typeof buildJointPlanUncached> } | null = null

const buildPlan = (e: Exped): PlanResult | null => {
  const key = planPoolSignature()
  if (singlePlanCache.key !== key) {
    singlePlanCache.key = key
    singlePlanCache.plans.clear()
  }
  if (singlePlanCache.plans.has(e.apiId)) return singlePlanCache.plans.get(e.apiId)!
  const plan = buildPlanUncached(e)
  singlePlanCache.plans.set(e.apiId, plan)
  return plan
}

const buildPlanUncached = (e: Exped): PlanResult | null => {
  const pool = availableShips().sort(planPriority)
  if (!pool.length) return null
  const slots = slotsOf(e)
  const holder = matchPlanSlots(slots, pool)
  if (e.wiki?.fleetLv) liftFleetLevel(slots, holder, pool, e.wiki.fleetLv)
  liftToPass(e, slots, holder, pool)
  const picked = toPicks(slots, holder)
  if (!picked.length) return null
  // 旗舰必须确定在首位（判定按 ships[0] 认旗舰）。直接搬移，不用比较函数排序——
  // 「旗舰优先」这种谓词写成 comparator 不满足传递性，排序结果不保证。
  const flagIdx = picked.findIndex((p) => p.role === '旗舰')
  if (flagIdx > 0) picked.unshift(picked.splice(flagIdx, 1)[0])
  return { picks: picked, verdict: checkShips(e, picked.map((p) => p.ship)) }
}

// ---- 多队联立 ----
//
// 一队一队地凑是错的：先凑好的那队会把稀缺舰种吃光，轮到第二队就报凑不出，
// 而实际上换个分法三队都派得出。所以把几支队的坑位拼成一张图跑**同一次**匹配。
// 按 Hall 定理，只要存在「全部派得出」的分配，最大匹配就一定会填满所有坑；
// 填不满就是真的凑不出，不是分法不好。

// 显示名与远征列表同口径：有中文资料用中文，没有就用游戏原名
const expedName = (e: Exped): string => e.wiki?.nameZh ?? e.name

const jointDecks = (): Deck[] => freeDecks()

const buildJointPlan = (
  targets: { deck: Deck; exped: Exped }[],
): { deck: Deck; exped: Exped; picks: PlanShip[]; verdict: ReturnType<typeof checkShips> }[] => {
  const key = JSON.stringify([
    targets.map((t) => [t.deck.id, t.exped.apiId]),
    planPoolSignature(),
  ])
  if (jointPlanCache?.key === key) return jointPlanCache.plans
  const plans = buildJointPlanUncached(targets)
  jointPlanCache = { key, plans }
  return plans
}

const buildJointPlanUncached = (
  targets: { deck: Deck; exped: Exped }[],
): { deck: Deck; exped: Exped; picks: PlanShip[]; verdict: ReturnType<typeof checkShips> }[] => {
  const pool = availableShips().sort(planPriority)
  const groups = targets.map((t) => ({ ...t, slots: slotsOf(t.exped) }))
  const allSlots = groups.flatMap((g) => g.slots)
  const holder = matchPlanSlots(allSlots, pool)
  // 合计 Lv 的门槛是各队各算的，但**换人时必须看整张表**：
  // 传 holder 本体而不是切片，否则三支队会各自把同一艘低练舰抓走。
  let offset = 0
  for (const group of groups) {
    const span = group.slots.length
    if (group.exped.wiki?.fleetLv) {
      liftFleetLevel(allSlots, holder, pool, group.exped.wiki.fleetLv, offset, offset + span)
    }
    liftToPass(group.exped, allSlots, holder, pool, offset, offset + span)
    offset += span
  }
  offset = 0
  return groups.map((group) => {
    const span = group.slots.length
    const picks = toPicks(group.slots, holder.slice(offset, offset + span))
    offset += span
    const flagIdx = picks.findIndex((p) => p.role === '旗舰')
    if (flagIdx > 0) picks.unshift(picks.splice(flagIdx, 1)[0])
    return {
      deck: group.deck,
      exped: group.exped,
      picks,
      verdict: checkShips(group.exped, picks.map((p) => p.ship)),
    }
  })
}

const jointPlanHtml = (current: Exped): string => {
  const free = jointDecks()
  if (free.length < 2) return ''
  // allExpeds() 会把整张远征表重建一遍（含逐条的矿脉合并），这张卡里要按 apiId 找好几次——
  // 建一次索引，别每支舰队各重建一张表。
  const byApiId = new Map(allExpeds().map((e) => [e.apiId, e]))
  const jointExpedOf = (deckId: number): Exped | undefined => {
    const apiId = state.joint[deckId]
    return apiId != null ? byApiId.get(apiId) : undefined
  }
  const assigned = free.flatMap((deck) => {
    const exped = jointExpedOf(deck.id)
    return exped ? [{ deck, exped }] : []
  })
  const slotRows = free
    .map((deck) => {
      const exped = jointExpedOf(deck.id)
      const isCurrent = state.joint[deck.id] === current.apiId
      return `<div class="jt-row">
        <span class="jt-deck">第${deck.id}舰队</span>
        ${
          exped
            ? `<span class="jt-exp">${esc(`${exped.dispNo} ${expedName(exped)}`)}</span>
               <button class="jt-x" data-joint-clear="${deck.id}" title="从联立里移除">×</button>`
            : '<span class="jt-none">未指定</span>'
        }
        <button class="jt-set${isCurrent ? ' on' : ''}" data-joint-set="${deck.id}"
          title="把当前打开的这条远征派给第${deck.id}舰队">派本条</button>
      </div>`
    })
    .join('')

  let result = `<div class="jt-note">给两支以上空闲舰队各指定一条远征，这里一起凑</div>`
  if (assigned.length >= 2) {
    const plans = buildJointPlan(assigned)
    // 「这条要几个人」两处都要用，slotsOf 会重跑一遍条件解析——按舰队算一次收起来
    const needOf = new Map(plans.map((p) => [p.deck.id, slotsOf(p.exped).length]))
    const shortfall = plans.filter((p) => p.picks.length < (needOf.get(p.deck.id) ?? 0))
    result = plans
      .map((plan) => {
        const need = needOf.get(plan.deck.id) ?? 0
        const rows = plan.picks
          .map(
            (p) => `<span class="jt-pick">${elinkHtml(
              'ship',
              p.ship.id,
              entityNameHtml('ship', p.ship.shipId, masterShipName(p.ship.shipId), { compact: true }),
            )}<i>${esc(p.role)} · Lv${p.ship.lv}${p.kira ? ' ✦' : ''}</i></span>`,
          )
          .join('')
        const verdict =
          plan.picks.length < need
            ? `<span class="pl-no">✗ 只凑到 ${plan.picks.length}/${need}</span>`
            : plan.verdict.fails === 0
              ? '<span class="pl-ok">✓ 全条件满足</span>'
              : `<span class="pl-no">✗ 仍差 ${plan.verdict.fails} 项</span>`
        return `<div class="jt-plan">
          <div class="jt-plan-h"><b>第${plan.deck.id}舰队</b>
            <span>${esc(`${plan.exped.dispNo} ${expedName(plan.exped)}`)}</span>${verdict}</div>
          <div class="jt-picks">${rows || '<span class="sub9">没有可用舰娘</span>'}</div>
        </div>`
      })
      .join('')
    // 「互不抢人」是这块面板给出的承诺，所以真验一次而不是信算法。
    // 实测踩过：抬合计 Lv 那步只看本队那一段，三支队各自抓走同一艘低练舰，
    // 界面照样报「互不抢人」——假绿比不显示更糟。
    const picked = plans.flatMap((p) => p.picks.map((x) => x.ship.id))
    const clash = picked.length !== new Set(picked).size
    // 「人凑得出」和「条件过得了」是两回事。只查前者就会出现
    //「这 3 支可以同时派出」和它上面三行「✗ 仍差 5 项」同框。
    const failing = plans.filter((p) => p.verdict.fails > 0)
    result += clash
      ? '<div class="jt-note bad">方案里同一艘舰被派进了两支队，别照这份名单编成</div>'
      : shortfall.length
        ? '<div class="jt-note bad">可用舰里凑不齐全部坑位。少派一队、或先解锁保护舰队</div>'
        : failing.length
          ? `<div class="jt-note bad">人是凑得出的，但${failing
              .map((p) => `第${p.deck.id}舰队还差 ${p.verdict.fails} 项`)
              .join('、')}。换成低门槛的远征、或少派一队再看</div>`
          : `<div class="jt-note ok">这 ${plans.length} 支可以同时派出，条件全过、互不抢人。</div>`
  }
  return `<div class="sec"><div class="sec-h">多队联立<span class="aux">${free.length} 支舰队空闲</span></div>
    <div class="jt-slots">${slotRows}</div>
    ${result}</div>`
}

const plannerPrefsHtml = (): string => {
  const protectedChips = mg.decks
    .filter((deck) => deck.id >= 1 && deck.id <= 4)
    .map((deck) => `<button class="pl-pref${plannerPrefs.protectedDeckIds.includes(deck.id) ? ' on' : ''}" data-protect-deck="${deck.id}">
      ${plannerPrefs.protectedDeckIds.includes(deck.id) ? '🔒' : '○'} 第${deck.id}舰队
    </button>`)
    .join('')
  const excluded = plannerPrefs.excludedRosterIds.flatMap((rosterId) => {
    const ship = mg.ships[rosterId]
    if (!ship) return []
    return [`<span class="pl-excluded">
      ${elink('ship', rosterId, entityNamePlain('ship', ship.shipId, masterShipName(ship.shipId)))}
      <button data-include-ship="${rosterId}" title="取消排除">×</button>
    </span>`]
  })
  return `<div class="pl-prefs">
    <div><b>保护舰队</b>${protectedChips}<span>被保护舰队的舰娘不会进入自动方案</span></div>
    ${
      excluded.length
        ? `<details><summary>已排除 ${excluded.length} 艘舰娘</summary><div class="pl-excluded-list">${excluded.join('')}</div></details>`
        : '<span>还没有手动排除舰娘；可在下方方案中点击“排除”。</span>'
    }
  </div>`
}

const planCardHtml = (e: Exped): string => {
  if (isSupport(e)) return ''
  const plan = buildPlan(e)
  if (!plan) {
    return `<div class="sec"><div class="sec-h">推荐编队方案</div>
      ${plannerPrefsHtml()}
      <div class="sub9">没有可用舰娘：可能在远征、入渠、大破，或被保护/排除了</div></div>`
  }
  const { picks, verdict } = plan
  const drumNeed = e.wiki?.drumTotal ?? 0
  const drums = drumStock()
  const kira = picks.filter((p) => p.kira).length
  const rows = picks
    .map((p) => {
      const name = masterShipName(p.ship.shipId)
      // 同一行里舰名与舰种都要过译名表，别让一格中文一格日文混排
      const stype = stypeOf(p.ship)
      const type = mg.master.stypes[stype] ? entityNamePlain('shipType', stype, mg.master.stypes[stype]) : '?'
      return `<div class="pl-row">
        <span class="pl-av">${shipThumbHtml(p.ship.shipId, name, { className: 'plan' })}</span>
        <span class="pl-nm">${elinkHtml('ship', p.ship.id, entityNameHtml('ship', p.ship.shipId, name, { compact: true }))}</span>
        <span class="pl-meta">${esc(type)} · Lv ${p.ship.lv} · ${esc(p.where)}</span>
        <span class="pl-role">${esc(p.role)}</span>
        <span class="pl-kira ${p.kira ? 'on' : ''}">${p.kira ? '✦闪光' : `士气 ${p.ship.cond}`}</span>
        <button class="pl-exclude" data-exclude-ship="${p.ship.id}" title="以后自动方案不再使用这艘舰娘">排除</button>
      </div>`
    })
    .join('')
  const fails = verdict.fails
  const verdictLine =
    fails === 0
      ? `<span class="pl-ok">✓ 全条件满足</span>${
          verdict.unknowns ? ` · <span class="sub9">另有 ${verdict.unknowns} 项无法自动判定，见条件原文</span>` : ''
        }`
      : `<span class="pl-no">✗ 仍差 ${fails} 项</span> <span class="sub9">可用舰里凑不出</span>`
  const drumLine = drumNeed
    ? `<div class="pl-note">运输桶需合计 ${drumNeed} · 库存 <b>${drums}</b>${
        drums >= drumNeed ? ' 够用 ✓' : ' <span class="pl-no">不足</span>'
      }</div>`
    : ''
  return `<div class="sec"><div class="sec-h">推荐编成方案<span class="aux" title="为出击保留主力">从未在远征的现有舰娘中生成 · 优先闲置与低等级舰娘</span></div>
    ${plannerPrefsHtml()}
    <div class="pl-list">${rows}</div>
    <div class="pl-verdict">${verdictLine} · 闪光 <b>${kira}/${picks.length}</b>${
      kira < picks.length ? '（大成功需全员闪光，可用演习/单场 MVP 补）' : ' 全员闪光 ✓'
    }</div>
    ${drumLine}
  </div>`
}

// ---- 在途/舰队状态 ----

const runningDeckOf = (apiId: number): Deck | undefined =>
  mg.decks.find((d) => d.mission?.[0] > 0 && d.mission[1] === apiId)

const expeditionDecks = (): Deck[] => mg.decks.filter((d) => d.id >= 2)

// 「空闲舰队」＝没在远征、**且不是联合编成的第 2 舰队**。
// 后半条不加的话，联合编成时二队会被推荐去派远征——游戏里根本不许，
// 而「多队联立」还会拿她凑进「这 N 支可以同时派出」，等于给出一份派不出去的名单。
// 出击与否都剔：编队中的她一样不可派（2026-08-27 用户裁）。
const freeDecks = (): Deck[] =>
  expeditionDecks().filter((d) => !(d.mission?.[0] > 0) && !combinedEscortState(d.id))

const pickDeck = (): Deck | null => {
  const decks = expeditionDecks()
  if (state.deckId) {
    const chosen = decks.find((d) => d.id === state.deckId)
    if (chosen) return chosen
  }
  return freeDecks()[0] ?? decks[0] ?? null
}

const costReferenceShips = (): PlayerShip[] => {
  const deck = pickDeck()
  return deck ? fleetShipsOf(deck) : []
}

interface DeckSupplyState {
  kind: 'ok' | 'low' | 'wait'
  label: string
  title: string
}

const deckSupplyState = (deck: Deck): DeckSupplyState => {
  const ships = fleetShipsOf(deck)
  if (!ships.length) return { kind: 'wait', label: '?', title: '无法判定补给：空舰队' }

  const fuelLow = new Set<number>()
  const ammoLow = new Set<number>()
  let unknown = 0
  for (const ship of ships) {
    const master = mg.master.ships[ship.shipId]
    if (!master) {
      unknown++
      continue
    }
    if (ship.fuel < master.fuelMax) fuelLow.add(ship.id)
    if (ship.bull < master.bullMax) ammoLow.add(ship.id)
  }

  const needing = new Set([...fuelLow, ...ammoLow]).size
  if (needing) {
    const when = deck.mission?.[0] > 0 ? '返港后需补给' : '缺补给'
    return {
      kind: 'low',
      label: '补',
      title: `${when}：${needing}/${ships.length} 舰（燃料 ${fuelLow.size} · 弹药 ${ammoLow.size}）`,
    }
  }
  if (unknown) {
    return {
      kind: 'wait',
      label: '?',
      title: `无法完整检查补给：${unknown}/${ships.length} 艘舰娘缺少游戏数据`,
    }
  }
  return { kind: 'ok', label: '✓', title: `补给充足：${ships.length} 舰` }
}

const supplyIconHtml = (deck: Deck): string => {
  const state2 = deckSupplyState(deck)
  return `<span class="g-supply ${state2.kind}" title="${esc(state2.title)}" role="img" aria-label="${esc(state2.title)}">${state2.label}</span>`
}

// ---- 渲染 ----

const fmtDur = (min: number) => `${Math.floor(min / 60)}:${`${min % 60}`.padStart(2, '0')}`
const EXPEDITION_DIFFICULTY = ['', 'E', 'D', 'C', 'B', 'A', 'S', 'S+']

const fleetStatusHtml = (): string => {
  const items = expeditionDecks()
    .map((deck) => {
      const busy = deck.mission?.[0] > 0
      // 联合第 2 舰队优先于远征位判定：她的 mission 恒为 0，不先摘出去就是一行「待命」，
      // 而这条甘特条正是用来一眼看「谁还能派」的——那一行会直接把人骗过去。
      const escort = combinedEscortState(deck.id)
      let status: string
      if (escort) {
        status = `<span class="g-idle">${escort === 'sortie' ? '出击中' : '编队中'}</span>`
      } else if (busy) {
        const returnTs = deck.mission[2]
        const dispNo = mg.master.missions[deck.mission[1]]?.dispNo ?? deck.mission[1]
        status = `<b class="g-exp-no">${esc(`${dispNo}`)}</b><span class="g-countdown" data-cds="${returnTs}" data-cds-done="返港">${fmtCountdownShort(returnTs, '返港')}</span>`
      } else {
        status = '<span class="g-idle">待命</span>'
      }
      return `<div class="g-item"><span class="k">${deck.id}舰</span>${status}${supplyIconHtml(deck)}</div>`
    })
    .join('')
  return `<div class="gantt" aria-label="远征舰队状态">
    ${items || '<span class="g-empty">等待舰队数据（返港后刷新）</span>'}
  </div>`
}

const nativeRewardItems = (e: Exped) =>
  [
    { pair: e.winItem1, label: '随机奖励' },
    { pair: e.winItem2, label: '大成功限定' },
  ].filter(
    (entry): entry is { pair: [number, number]; label: string } =>
      entry.pair[0] > 0 && entry.pair[1] > 0,
  )

// wiki 事实包的奖励项只有名字没有 id，而两份包一中一日：kcwiki 的 rewards 是中文、
// wikiwiki 的是日文，`{...localized, ...facts}` 里 facts 在后，把中文整段盖掉了。
// 与其去动合并顺序（会连带丢掉 wikiwiki 才有的 min），不如在渲染这一层按名字回查
// 道具域——实测 7 个奖励道具名全部命中。查不到的照旧保原文，不硬翻。
const rewardItemName = (name: unknown): string => {
  const raw = `${name ?? ''}`
  const id = localizedEntityId('item', raw)
  return id ? entityNamePlain('item', id, raw) : raw
}

const nativeRewardItemsHtml = (e: Exped, compact = false) =>
  nativeRewardItems(e)
    .map(({ pair: [id, count], label }) => {
      const item = elink('useitem', id, entityNamePlain('item', id, useitemNames.get(id) ?? `道具 #${id}`))
      return compact ? `${item}×${count}` : `${label} ${item}×${count}`
    })
    .join(compact ? '、' : ' · ')

const gainCellHtml = (e: Exped): string => {
  if (isSupport(e)) return `<span class="gain"><span class="sub9">无资源 · 出击支援</span></span>`
  if (!e.wiki?.rewards) {
    const native = nativeRewardItemsHtml(e, true)
    return `<span class="gain"><span class="sub9">${native || '资源收益明细待更新'}</span></span>`
  }
  const reference = costReferenceShips()
  const h = reference.length ? estimatedNet(e, reference).hourly : hourly(e)
  const pin = state.sort
  const ranked = (
    [
      ['燃', h.fuel, 'f', 1, 'fuel'],
      ['弹', h.ammo, 'a', 2, 'ammo'],
      ['钢', h.steel, 's', 3, 'steel'],
      ['铝', h.baux, 'b', 4, 'baux'],
    ] as [string, number, string, number, 'fuel' | 'ammo' | 'steel' | 'baux'][]
  )
    .filter(([, v]) => v > 0)
    .sort((a, b) => {
      // 列表按某资源/时排时，大字必须是那个资源。否则海上护卫这种「弹药比燃料还高」
      // 的条目会把弹药顶到第一行，看起来像燃/时排序中间插进了别的资源。
      if (pin === 'fuel' || pin === 'ammo' || pin === 'steel' || pin === 'baux') {
        if (a[4] === pin && b[4] !== pin) return -1
        if (b[4] === pin && a[4] !== pin) return 1
      }
      return b[1] - a[1]
    })
  if (!ranked.length) {
    const native = nativeRewardItemsHtml(e, true)
    const item = e.wiki.rewards.items?.[0]
    return `<span class="gain"><span class="sub9">${native || (item ? `${entityTermHtml('useitem', undefined, rewardItemName(item.name))}×${item.count}` : '—')}</span></span>`
  }
  const [top, second] = ranked
  return `<span class="gain" title="${reference.length ? `按第${pickDeck()?.id ?? '?'}舰队满载补给估算净收益` : '基础总收益'}"><span class="ph ${top[2]}">${materialIconHtml(top[3], { className: 'sm', title: top[0] })}${top[1]}/时</span>${
    second ? `<span class="sub9">${entityTermHtml('material', second[3] - 1, second[0])}${second[1]}/时</span>` : nativeRewardItems(e).length ? `<span class="sub9">+${nativeRewardItemsHtml(e, true)}</span>` : e.wiki.rewards.items?.length ? `<span class="sub9">+${entityTermHtml('useitem', undefined, rewardItemName(e.wiki.rewards.items[0].name))}</span>` : ''
  }</span>`
}

const fitChipHtml = (e: Exped): string => {
  if (runningDeckOf(e.apiId)) return `<span class="fit busy">远征中</span>`
  if (isSupport(e)) return `<span class="fit ok">支援</span>`
  if (!e.wiki) return `<span class="fit" style="color:var(--dim);border-color:var(--line)">?</span>`
  const deck = pickDeck()
  if (!deck) return ''
  const { fails, unknowns } = checkExpedition(e, deck)
  if (fails > 0) return `<span class="fit no">✗ 差${fails}</span>`
  if (unknowns > 0) return `<span class="fit ok" title="含无法自动判定项">✓?</span>`
  return `<span class="fit ok">✓ 可</span>`
}

const listRowHtml = (e: Exped): string => {
  const w = e.wiki
  const brief = [
    fmtDur(e.timeMin),
    w?.flagLv ? `旗Lv${w.flagLv}` : '',
    w?.minShips ? `舰${w.minShips}` : '',
    w?.monthly ? '月常' : '',
    w?.combat ? esc(w.combat) : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const sp2 = w?.monthly || /[A-Z]/.test(e.dispNo)
  return `<div class="erow${state.selected === e.apiId ? ' on' : ''}" data-exp="${e.apiId}">
    <span class="eid${sp2 ? ' sp2' : ''}">${esc(e.dispNo)}</span>
    <span class="nm"><b title="${esc(entityNamePlain('expedition', e.dispNo, w?.nameJp ?? e.name))}">${entityNameHtml('expedition', e.dispNo, w?.nameJp ?? e.name, { compact: true })}</b><span>${brief}</span></span>
    ${gainCellHtml(e)}
    ${fitChipHtml(e)}
  </div>`
}

const expeditionHistoryHtml = (e: Exped): string => {
  const report = expeditionHistory.get(e.apiId)
  // 加载态只在手上确实没有这项记录时才顶上来；已经有一份就照常显示，
  // 后台换新完成后静默替换，不让面板塌一下。
  if (!report) {
    if (expeditionHistoryLoading.has(e.apiId)) {
      return `<div class="sec"><div class="sec-h">远征记录</div><div class="sub9">正在读取本地结算记录……</div></div>`
    }
    // 读不出来 ≠ 没跑过。把故障说成「尚无记录」既是撒谎，也让人以为要再跑一次远征。
    if (expeditionHistoryFailed.has(e.apiId)) {
      return `<div class="sec"><div class="sec-h">远征记录</div>
        <div class="sub9">结算记录读取失败，下次返港会再读一次</div></div>`
    }
  }
  if (!report?.total) {
    return `<div class="sec"><div class="sec-h">远征记录</div>
      <div class="sub9">还没有这项远征的结算记录，完成一次就有了</div></div>`
  }
  const completed = report.success + report.great
  const successRate = report.total ? Math.round((completed / report.total) * 100) : 0
  const greatRate = report.total ? Math.round((report.great / report.total) * 100) : 0
  const resultLabel = {
    success: ['成功', 'ok'],
    great: ['大成功', 'great'],
    failed: ['失败', 'bad'],
  } as const
  const selectedDeck = pickDeck()
  const selectedShips = selectedDeck ? fleetShipsOf(selectedDeck) : []
  const supplyCost = selectedShips.length ? expeditionSupplyCost(e, selectedShips) : null
  const observedAverage = report.averageMaterials?.successful
  const formatAverage = (values: number[]) =>
    values
      .map((value, index) =>
        `${materialIconHtml(index + 1, { className: 'sm', title: MATERIAL_NAMES[index] })}${Number.isInteger(value) ? value : value.toFixed(1)}`,
      )
      .join('')
  const historicalNet = observedAverage && supplyCost
    ? observedAverage.map((value, index) => Math.round((value - supplyCost[index]) * 10) / 10)
    : null
  const averageNetHtml = observedAverage
    ? `<div class="exp-h-net">
        <div class="exp-h-net-head"><b>历史平均净收益</b><span>${supplyCost ? `按当前第${selectedDeck!.id}舰队补给成本估算` : '未选择舰队，仅显示实际总收益'}</span></div>
        <div class="exp-h-net-main">
          <span><small>成功时平均实际收益</small>${formatAverage(observedAverage)}</span>
          ${historicalNet ? `<span class="result"><small>扣除本队补给后</small>${formatAverage(historicalNet)}</span>` : ''}
        </div>
        <div class="exp-h-net-kinds">
          ${report.averageMaterials.success ? `<span>普通成功 ${formatAverage(report.averageMaterials.success)}</span>` : ''}
          ${report.averageMaterials.great ? `<span>大成功 ${formatAverage(report.averageMaterials.great)}</span>` : ''}
        </div>
        <div class="exp-h-net-note">已包含大成功、大发等当次加成</div>
      </div>`
    : ''
  // 标题写的条数就是下面真列出来的条数：查询取 40 条是给统计用的，
  // 列表只列前 20——两个数字不一致的话「最近 40 条」下面只有 20 行。
  const listed = report.entries.slice(0, 20)
  const rows = listed.map((entry) => {
    const [label, cls] = resultLabel[entry.result]
    const resources = entry.materials
      .map((value, index) => value > 0
        ? `${materialIconHtml(index + 1, { className: 'sm', title: MATERIAL_NAMES[index] })}${value}`
        : '')
      .filter(Boolean)
      .join('')
    const items = entry.items.map((item) => {
      const name = useitemNames.get(item.id) ?? `道具 #${item.id}`
      return `${useItemIconHtml(item.id, entityNamePlain('item', item.id, name), { className: 'sm' })}${elink('useitem', item.id, entityNamePlain('item', item.id, name))}×${item.count}`
    }).join('')
    return `<div class="exp-h-row">
      <time>${fmtTime(entry.ts)}</time><span>第${entry.deckId}舰队</span>
      <b class="${cls}">${label}</b><span class="exp-h-reward">${resources || '无基础资源'}${items}</span>
    </div>`
  }).join('')
  return `<div class="sec">
    <div class="sec-h">远征记录<span class="aux">最近 ${listed.length} 条</span></div>
    <div class="exp-h-metrics">
      <span><small>累计</small><b>${report.total}</b></span>
      <span><small>成功率</small><b>${successRate}%</b></span>
      <span><small>大成功率</small><b>${greatRate}%</b></span>
      <span><small>失败</small><b>${report.failed}</b></span>
    </div>
    ${averageNetHtml}
    <div class="exp-h-list">${rows}</div>
  </div>`
}

// 舰队一动就要重取，但**不丢手上这份**：直接 delete 会让整块「远征记录」
// 先塌成「尚无记录」再塌成「读取中」再填回来，正开着详情看的时候闪得很明显。
// 失效只推进代号，新数据到了静默换上。（同一口径见 ji 的 mapChronicle / qa 的人生记录）
const invalidateExpeditionHistory = (missionId: number) => {
  if (!(missionId > 0)) return
  expeditionHistoryGeneration.set(missionId, (expeditionHistoryGeneration.get(missionId) ?? 0) + 1)
}

const ensureExpeditionHistory = (missionId: number) => {
  const generation = expeditionHistoryGeneration.get(missionId) ?? 0
  if (
    expeditionHistoryLoaded.get(missionId) === generation ||
    expeditionHistoryLoading.has(missionId)
  ) return
  expeditionHistoryLoading.add(missionId)
  void queryExpeditionHistory(missionId, 40)
    .then((report) => {
      if ((expeditionHistoryGeneration.get(missionId) ?? 0) !== generation) return
      expeditionHistory.set(missionId, report)
      expeditionHistoryFailed.delete(missionId)
      expeditionHistoryLoaded.set(missionId, generation)
    })
    .catch((error) => {
      console.warn('[kanso] 远征履历加载失败', missionId, error)
      if ((expeditionHistoryGeneration.get(missionId) ?? 0) !== generation) return
      expeditionHistoryFailed.add(missionId)
      // 失败也要落地成「这一代已经处理过」：不落地的话下面 finally 的 render
      // 会再走一遍 ensure，于是 失败→重渲染→再查 无限重试同一个必败的查询。
      expeditionHistoryLoaded.set(missionId, generation)
    })
    .finally(() => {
      expeditionHistoryLoading.delete(missionId)
      if (pane?.classList.contains('active') && state.selected === missionId) render()
    })
}

const detailHtml = (e: Exped): string => {
  const w = e.wiki
  const areaName = areaNames.get(e.mapArea) ?? (e.mapArea > 10 ? '活动海域' : `海域${e.mapArea}`)
  const returnTs = Date.now() + e.timeMin * 60000
  const rc = new Date(returnTs)
  const pad = (n: number) => `${n}`.padStart(2, '0')
  const deck = pickDeck()
  const questSec = expeditionQuestHtml(e)
  const officialSample = e.sampleFleet.filter((stype) => stype > 0)
  const officialSampleSec = officialSample.length
    ? `<div class="sec official-sample">
        <div class="sec-h">游戏官方示例编成<span class="aux"><span class="credit-mark"
          title="示例编成不代表成功条件或最优方案">口径</span></span></div>
        <div class="sample-fleet">${officialSample
          .map((stype, index) => `<span>${index === 0 ? '旗舰 ' : ''}${entityTermHtml('shipType', stype, entityNamePlain('shipType', stype, mg.master.stypes[stype] ?? `舰种 #${stype}`))}</span>`)
          .join('')}</div>
      </div>`
    : ''

  // 条件检查
  let checkSec = ''
  if (w && deck) {
    const { rows, fails, unknowns } = checkExpedition(e, deck)
    const fsel = expeditionDecks()
      .map((d) => {
        const busy = d.mission?.[0] > 0
        const runNo = busy ? (mg.master.missions[d.mission[1]]?.dispNo ?? d.mission[1]) : null
        // 联合第 2 舰队跟「远征中」一样挂 busy：她同样不是可以拿来对条件的那支队。
        // 不挂的话这枚芯片会显示「待命」还亮着可选，点下去就在给一支派不出的队做条件检查。
        const escort = combinedEscortState(d.id)
        const note = escort
          ? escort === 'sortie'
            ? '随联合舰队出击中'
            : '已编入联合舰队'
          : busy
            ? `远征 ${runNo} 执行中`
            : '待命'
        return `<span class="fs${d.id === deck.id ? ' on' : ''}${busy || escort ? ' busy' : ''}" data-deck="${d.id}">第${d.id}舰队<i>${note}</i></span>`
      })
      .join('')
    const ck = rows
      .map(
        (r) => `<div class="ck-row${r.mark === 'no' ? ' no2' : ''}"><span class="mk ${r.mark}">${
          r.mark === 'ok' ? '✓' : r.mark === 'no' ? '✗' : '◌'
        }</span><span class="w">${r.text}</span><span class="r">${r.cur}</span></div>`,
      )
      .join('')
    const verdict =
      fails > 0
        ? `<b class="bad2">✗ 不可出发 — 差 ${fails} 项</b>`
        : unknowns > 0
          ? `<b style="color:var(--warn)">✓ 可判定项全过 · ${unknowns} 项需对照原文</b>`
          : `<b style="color:var(--ok)">✓ 全条件满足</b>`
    checkSec = `<div class="sec">
      <div class="sec-h">条件检查<span class="sp"></span></div>
      <div class="fsel">${fsel}</div>
      <div class="ck">${ck || '<div class="ck-row"><span class="mk ok">✓</span><span class="w">无特殊条件</span><span class="r"></span></div>'}</div>
      <div class="ck-sum">检查结果：${verdict}${deck.mission?.[0] > 0 ? ' · <span style="color:var(--warn)">该舰队正在远征，返港后可用</span>' : ''}</div>
    </div>`
  } else if (!w) {
    // 事实包没有这条(常设支援远征 S1/S2、活动临时远征都在此列)——
    // 绝不拿空条件冒充「达标」;把游戏自述原文(含「要:駆逐2隻」)如实摆出来
    const officialText = e.details
      ? `<div class="ck-row"><span class="mk wait">◌</span><span class="w">${esc(
          e.details.replace(/<br\s*\/?>/gi, ' '),
        )}</span><span class="r">游戏自述原文</span></div>`
      : ''
    checkSec = `<div class="sec"><div class="sec-h">条件检查</div>
      ${officialText}
      <div style="font-size:11.5px;color:var(--dim)">编成要求以上方游戏自述与游戏内提示为准</div></div>`
  }

  // 收益
  let gainSec = ''
  if (w?.rewards) {
    const r = w.rewards
    const deckShips = deck ? fleetShipsOf(deck) : []
    const net = deckShips.length ? estimatedNet(e, deckShips) : null
    const card = (label: string, pair: [number, number | null] | null, cls: string, materialIndex: number) =>
      pair?.[0]
        ? `<div class="gcard ${cls}"><div class="k">${entityTermHtml('material', materialIndex, label)}</div><div class="v">${pair[0]}<small>${pair[1] ? `${pair[1]}/时` : '基础'}</small></div></div>`
        : ''
    const nativeItems = nativeRewardItemsHtml(e)
    const items = nativeItems || [...(r.items ?? []).map((it: any) => `${entityTermHtml('useitem', undefined, rewardItemName(it.name))}×${it.count}`)].join('、')
    const greatItems = nativeItems
      ? ''
      : [...(r.greatItems ?? []).map((it: any) => `${entityTermHtml('useitem', undefined, rewardItemName(it.name))}×${it.count}`)].join('、')
    const netLine = net
      ? `<div class="net-gain">
          <b>第${deck!.id}舰队估算净收益</b>
        <span>基础收益 燃${net.gross[0]} / 弹${net.gross[1]} / 钢${net.gross[2]} / 铝${net.gross[3]}</span>
          <span class="cost">补给成本 −燃${net.cost[0]} / −弹${net.cost[1]}</span>
          <span class="result">单次净值 燃${net.net[0]} / 弹${net.net[1]} / 钢${net.net[2]} / 铝${net.net[3]}</span>
          <span>折算每时 燃${net.hourly.fuel} / 弹${net.hourly.ammo} / 钢${net.hourly.steel} / 铝${net.hourly.baux}</span>
        </div>`
      : '<div class="net-gain muted">所选舰队为空，暂时只能显示基础总收益。</div>'
    gainSec = `<div class="sec">
      <div class="sec-h">收益 <span class="aux">基础值 · 大成功 ×1.5（资源）</span></div>
      <div class="gains">
        ${card(MATERIAL_NAMES[0], r.fuel, 'f', 0)}${card(MATERIAL_NAMES[1], r.ammo, 'a', 1)}${card(MATERIAL_NAMES[2], r.steel, 's', 2)}${card(MATERIAL_NAMES[3], r.baux, 'b', 3)}
        <div class="gcard"><div class="k">经验</div><div class="v" style="color:#9ad0e0">${r.shipExp}<small>舰/${r.hqExp}提督</small></div></div>
      </div>
      ${netLine}
      <div class="gnote">
        ${items ? `奖励 <b>${items}</b> · ` : ''}${greatItems ? `大成功追加 <b class="up">${greatItems}</b> · ` : ''}
        大発動艇 +5%/个（上限 20%）· 消费 燃料${Math.round(e.useFuel * 100)}% 弹药${Math.round(e.useBull * 100)}%。
        净收益不计大发、内火艇与大成功加成。
      </div>
    </div>`
  } else if (nativeRewardItems(e).length) {
    const nativeItems = nativeRewardItemsHtml(e)
    gainSec = `<div class="sec">
      <div class="sec-h">官方奖励栏<span class="aux">游戏内建奖励栏 · 概率与资源明细待资料补充</span></div>
      <div class="gnote">奖励物品 <b>${nativeItems}</b></div>
    </div>`
  }

  // 原文备注（条件复杂处以原文为准）
  const noteSec = w
    ? `<div class="sec"><div class="sec-h">条件原文 <span class="aux">复杂条件以原文为准</span></div>
      <div style="font-size:11px;color:var(--sub);line-height:1.8;white-space:pre-line">${[
        w.composition ? `编成：${esc(w.composition)}` : '',
        w.escortText ? `要求：${esc(w.escortText)}` : '',
        w.greatNote ? `大成功：${esc(w.greatNote)}` : '',
      ]
        .filter(Boolean)
        .join('\n')}</div></div>`
    : ''

  return `<div class="backbar" data-act="close">✕ 关闭详情（Esc）</div>
    <div class="detail-scroll">
    <div class="hero">
      <div class="meta">
        <span class="badge w">${entityNameHtml('mapArea', e.mapArea, areaName, { compact: true })}</span>
        <span style="font-family:var(--mono);color:var(--dim)">远征 ${esc(e.dispNo)}</span>
        ${e.difficulty > 0 ? `<span class="badge">难度 ${EXPEDITION_DIFFICULTY[e.difficulty] ?? e.difficulty}</span>` : ''}
        ${w?.monthly ? '<span class="badge" style="color:#d8b8ff;border-color:#3d2c5c">月常</span>' : ''}
        ${w?.combat ? `<span class="badge" style="color:var(--warn);border-color:#4a3a22">${esc(w.combat)}</span>` : ''}
      </div>
      <h1><i>${esc(e.dispNo)}</i>${entityNameHtml('expedition', e.dispNo, w?.nameJp ?? e.name)}</h1>
      <div class="tline">
        <span class="pill">时间 <b>${fmtDur(e.timeMin)}</b></span>
        <span class="pill">现在出发 → <b class="hl">${pad(rc.getHours())}:${pad(rc.getMinutes())} 返港</b></span>
      </div>
    </div>
    ${questSec}
    ${checkSec}
    ${officialSampleSec}
    ${planCardHtml(e)}
    ${jointPlanHtml(e)}
    ${gainSec}
    ${expeditionHistoryHtml(e)}
    ${noteSec}
    <div class="dfoot">
      <span class="credit-mark" title="${esc(
        [
          expedLode ? lodeCredit(expedLode.meta) : '条件与奖励资料尚未就绪',
          expedLocalizationLode ? `中文名称 ${lodeCredit(expedLocalizationLode.meta)}` : '中文名称沿用游戏原文',
          '官方难度/奖励物品/示例编成/消耗 游戏主数据 · 闪光与远征状态实时同步',
        ].join(' ｜ '),
      )}">源</span>
      <span class="credit-mark" style="margin-left:auto"
        title="属性合计包含舰载机数值，可能与判定值略有差异">口径</span>
    </div>
    </div>`
}

const expeditionQuestHtml = (e: Exped): string => {
  if (!qp) return ''
  const rows: string[] = []
  for (const [rawId, tracker] of Object.entries(qp.trackers)) {
    const questId = Number(rawId)
    const observed = mg.quests[questId]
    if (observed?.state !== 2 && observed?.state !== 3) continue
    // 计数按**槽位**存（「远征 A 或 B」的多条备选共享一个槽），不能拿任务下标去读：
    // 备选让下标与槽位错位后，读出来的进度整体串位（比如已满却显示 0/3）。
    const counts = qp.progress[questId] ?? []
    const bySlot = new Map<number, { count: number; goal: number }>()
    tracker.tasks.forEach((task, index) => {
      if (task.kind !== 'expedition' || task.missionId !== e.apiId) return
      const slot = qpTaskSlot(task, index)
      if (bySlot.has(slot)) return // 同槽备选只算一次目标
      bySlot.set(slot, { count: Math.min(task.count, counts[slot] ?? 0), goal: task.count })
    })
    if (!bySlot.size) continue
    const current = [...bySlot.values()].reduce((sum, entry) => sum + entry.count, 0)
    const target = [...bySlot.values()].reduce((sum, entry) => sum + entry.goal, 0)
    const done = observed.state === 3 || current >= target
    const label = questName(questId) ?? observed.title ?? `任务 ${questId}`
    rows.push(`<div class="exp-quest${done ? ' done' : ''}">
      <span>${done ? '✓' : '◌'}</span>${elink('quest', questId, label)}
      <b>${observed.state === 3 ? '待领取' : `${current}/${target}`}</b>
    </div>`)
  }
  return `<div class="sec exp-quests">
    <div class="sec-h">进行中的任务</div>
    ${
      rows.join('') ||
      '<div class="exp-quest-empty">当前没有已领取且明确要求这项远征的任务。</div>'
    }
  </div>`
}

const AREA_CHIP_ORDER = [1, 2, 3, 4, 5, 7]

const render = () => {
  if (!pane) return
  const expeds = allExpeds()
  if (!expeds.length) {
    forgetCommittedHtml(pane, 'bi') // 这一支绕开 commitPaneHtml，记忆不能留着
    pane.innerHTML = '<div class="pane-waiting">等待游戏同步基础数据，进入母港后自动出现</div>'
    return
  }
  let list = expeds
  if (state.area === 'monthly') list = list.filter((e) => e.wiki?.monthly)
  else if (state.area === 'support') list = list.filter(isSupport)
  else if (state.area) list = list.filter((e) => `a${e.mapArea}` === state.area && !isSupport(e))
  if (state.search) {
    const q = state.search.toLowerCase()
    list = list.filter((e) =>
      [
        e.dispNo,
        e.name,
        e.wiki?.nameZh,
        e.wiki?.nameJp,
        e.wiki?.composition,
        e.wiki?.greatNote,
        e.wiki?.escortText,
        ...(e.wiki?.rewards?.items ?? []).map((item: any) => item.name),
        ...(e.wiki?.rewards?.greatItems ?? []).map((item: any) => item.name),
        ...nativeRewardItems(e).map(({ pair }) => useitemNames.get(pair[0]) ?? ''),
      ]
        .filter(Boolean)
        .some((s) => `${s}`.toLowerCase().includes(q)),
    )
  }
  const sortKey = state.sort
  const referenceShips = costReferenceShips()
  // 装饰-排序-去装饰：比较器里现算 estimatedNet 会在 O(n log n) 次比较中
  // 对同一条远征反复算（150 条一帧上千次，内部还要遍历参照舰队）
  if (sortKey === 'time') {
    list = [...list].sort((a, b) => a.timeMin - b.timeMin)
  } else {
    const val = (h: ReturnType<typeof hourly>) =>
      sortKey === 'total' ? h.fuel + h.ammo + h.steel + h.baux : h[sortKey]
    list = list
      .map((e) => ({
        e,
        v: val(referenceShips.length ? estimatedNet(e, referenceShips).hourly : hourly(e)),
      }))
      .sort((a, b) => b.v - a.v || a.e.timeMin - b.e.timeMin)
      .map((entry) => entry.e)
  }

  const chips = [
    `<span class="chip${state.area === null ? ' on' : ''}" data-area="">全部</span>`,
    ...AREA_CHIP_ORDER.filter((a) => expeds.some((e) => e.mapArea === a)).map(
      (a) => `<span class="chip${state.area === `a${a}` ? ' on' : ''}" data-area="a${a}">${entityNameHtml('mapArea', a, areaNames.get(a) ?? `海域${a}`, { compact: true })}</span>`,
    ),
    `<span class="chip${state.area === 'monthly' ? ' on' : ''}" data-area="monthly">月常</span>`,
    `<span class="chip${state.area === 'support' ? ' on' : ''}" data-area="support">支援</span>`,
  ].join('')

  const sorts = (
    [
      ['total', '综合/时'],
      ['fuel', '燃/时'],
      ['ammo', '弹/时'],
      ['steel', '钢/时'],
      ['baux', '铝/时'],
      ['time', '时间短'],
    ] as [string, string][]
  )
    .map(([key, label]) => `<span class="schip${state.sort === key ? ' on' : ''}" data-sort="${key}">${label}</span>`)
    .join('')

  const selected = state.selected != null ? expeds.find((e) => e.apiId === state.selected) : null
  if (selected) ensureExpeditionHistory(selected.apiId)
  const detailWasOpen = !!selected && !!pane.querySelector('.bi-app.open')

  // 输出没变就整段不动 DOM（口径见 kernel commitPaneHtml）
  const html = `<div class="bi-app${selected ? ' open' : ''}${pane.clientWidth < 700 ? ' narrow' : ''}">
      <aside class="index">
        <div class="search-row"><div class="search">⌕<input id="bi-search" placeholder="远征名 / 编号 / 「鼓桶」" value="${esc(state.search)}"></div></div>
        ${
          state.resourceFocus != null && RESOURCE_FOCUS[state.resourceFocus]
            ? `<div class="resource-focus">正在找：补充 <b>${entityTermHtml('material', state.resourceFocus, RESOURCE_FOCUS[state.resourceFocus].label)}</b> 的远征
              <span data-act="clear-resource-focus">清除</span></div>`
            : ''
        }
        <div class="filter-strip">
          <div class="type-chips">${chips}</div>
          <div class="sort-row"><span class="sort-label">排序</span>${sorts}</div>
        </div>
        ${fleetStatusHtml()}
        <div class="elist">${list.map(listRowHtml).join('') || '<div style="padding:20px;color:var(--dim)">无匹配远征</div>'}</div>
        <div class="index-foot">${referenceShips.length ? `按第${pickDeck()!.id}舰队满载补给估算 · 条件同队` : `显示每小时基础总收益 · 条件按${pickDeck() ? `第${pickDeck()!.id}舰队` : '—'}检查`}</div>
      </aside>
      <main class="detail${detailWasOpen ? ' stable' : ''}">${selected ? detailHtml(selected) : ''}</main>
    </div>`
  // 没换 DOM 就不能重绑：搜索框还是老元素，再绑一遍就是监听叠加
  if (!commitPaneHtml(pane, 'bi', html)) return

  const input = pane.querySelector<HTMLInputElement>('#bi-search')
  input?.addEventListener('input', () => {
    state.search = input.value
    state.resourceFocus = null
    render()
    // withViewStateKept 已恢复焦点与精确选区；只兜底焦点，不强拉光标到末尾
    pane.querySelector<HTMLInputElement>('#bi-search')?.focus()
  })
}

/** 从资源目标直达对应时薪/奖励视图。只做只读筛选，不触碰游戏编成。 */
export const focusExpeditionsForResource = (resourceIndex: number) => {
  const focus = RESOURCE_FOCUS[resourceIndex]
  if (!focus) return
  state.resourceFocus = resourceIndex
  state.area = null
  state.selected = null
  state.search = focus.rewardName ?? ''
  if (focus.sort) state.sort = focus.sort
  activateModule('bi')
  render()
}

// ---- 模块 ----

registerEntityRoute('expedition', {
  colorClass: 'e-exp',
  open(ref) {
    state.area = null
    state.search = ''
    state.resourceFocus = null
    state.selected = ref.num
    activateModule('bi')
    render()
    pane?.querySelector(`.erow[data-exp="${state.selected}"]`)?.scrollIntoView({ block: 'center' })
  },
  peek(ref) {
    const apiId = ref.num
    const m = mg.master.missions[apiId]
    if (!m) return null
    const expedition = allExpeds().find((entry) => entry.apiId === apiId)
    const w = expedition?.wiki
    const rewardMedia = w?.rewards
      ? [
          [w.rewards.fuel, 1, '燃料'],
          [w.rewards.ammo, 2, '弹药'],
          [w.rewards.steel, 3, '钢材'],
          [w.rewards.baux, 4, '铝土'],
        ]
          .filter(([value]) => Array.isArray(value) && value[0])
          .map(([, iconId, label]) => materialIconHtml(iconId as number, { className: 'lg', title: label as string }))
          .join('')
      : ''
    const lines = [
      `耗时 ${fmtDur(m.time)} · 消费 燃${Math.round(m.useFuel * 100)}% 弹${Math.round(m.useBull * 100)}%`,
      w?.rewards
        ? `收益 ${[
            ['燃', w.rewards.fuel],
            ['弹', w.rewards.ammo],
            ['钢', w.rewards.steel],
            ['铝', w.rewards.baux],
          ]
            .filter(([, p]: any) => p?.[0])
            .map(([label, p]: any) => `${label}${p[0]}`)
            .join(' ') || '—'}`
        : '收益资料待更新',
      w?.composition ? `编成 ${w.composition.split('\n')[0]}` : '',
      w?.greatNote ?? '',
    ].filter(Boolean)
    return {
      title: `${m.dispNo} ${w?.nameZh ?? m.name}`,
      typeLabel: '远征',
      media: rewardMedia || undefined,
      lines: lines.map((l) => esc(l)),
      primary: '远征规划',
    }
  },
})

registerModule({
  id: 'bi',
  title: '远征',
  order: 8,
  mount(el) {
    pane = el
    new ResizeObserver(() => {
      const app = pane.querySelector('.bi-app')
      if (app) app.classList.toggle('narrow', pane.clientWidth < 700)
    }).observe(pane)
    pane.addEventListener('click', (e) => {
      const t = e.target as HTMLElement
      if (t.closest('.el, input')) return
      const act = t.closest<HTMLElement>('[data-act]')?.dataset.act
      if (act === 'close') {
        state.selected = null
        exitWithMotion(pane.querySelector<HTMLElement>('.bi-app.open'), 'open', render)
        return
      }
      if (act === 'clear-resource-focus') {
        state.resourceFocus = null
        state.search = ''
        render()
        return
      }
      const jointSet = t.closest<HTMLElement>('[data-joint-set]')
      if (jointSet) {
        const deckId = Number(jointSet.dataset.jointSet)
        if (state.selected != null) state.joint = { ...state.joint, [deckId]: state.selected }
        render()
        return
      }
      const jointClear = t.closest<HTMLElement>('[data-joint-clear]')
      if (jointClear) {
        const next = { ...state.joint }
        delete next[Number(jointClear.dataset.jointClear)]
        state.joint = next
        render()
        return
      }
      const protectDeck = t.closest<HTMLElement>('[data-protect-deck]')
      if (protectDeck) {
        const deckId = Number(protectDeck.dataset.protectDeck)
        plannerPrefs.protectedDeckIds = plannerPrefs.protectedDeckIds.includes(deckId)
          ? plannerPrefs.protectedDeckIds.filter((id) => id !== deckId)
          : [...plannerPrefs.protectedDeckIds, deckId]
        savePlannerPrefs()
        render()
        return
      }
      const excludeShip = t.closest<HTMLElement>('[data-exclude-ship]')
      if (excludeShip) {
        plannerPrefs.excludedRosterIds = [
          ...plannerPrefs.excludedRosterIds,
          Number(excludeShip.dataset.excludeShip),
        ]
        savePlannerPrefs()
        render()
        return
      }
      const includeShip = t.closest<HTMLElement>('[data-include-ship]')
      if (includeShip) {
        const rosterId = Number(includeShip.dataset.includeShip)
        plannerPrefs.excludedRosterIds = plannerPrefs.excludedRosterIds.filter((id) => id !== rosterId)
        savePlannerPrefs()
        render()
        return
      }
      const deckEl = t.closest<HTMLElement>('[data-deck]')
      if (deckEl) {
        state.deckId = parseInt(deckEl.dataset.deck!, 10)
        render()
        return
      }
      const areaEl = t.closest<HTMLElement>('[data-area]')
      if (areaEl) {
        state.resourceFocus = null
        state.area = areaEl.dataset.area || null
        render()
        return
      }
      const sortEl = t.closest<HTMLElement>('[data-sort]')
      if (sortEl) {
        state.resourceFocus = null
        state.sort = sortEl.dataset.sort as typeof state.sort
        render()
        return
      }
      const row = t.closest<HTMLElement>('[data-exp]')
      if (row) {
        const id = parseInt(row.dataset.exp!, 10)
        // 再次点击同一行 = 返回列表，与 close / Esc 同一套退场动画
        if (state.selected === id) {
          state.selected = null
          exitWithMotion(pane.querySelector<HTMLElement>('.bi-app.open'), 'open', render)
          return
        }
        state.selected = id
        render()
      }
    })
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && pane.classList.contains('active') && state.selected != null) {
        state.selected = null
        exitWithMotion(pane.querySelector<HTMLElement>('.bi-app.open'), 'open', render)
      }
    })
    void (async () => {
      const [wikiwikiPack, localizationPack, raw, qpState] = await Promise.all([
        queryLode('wikiwiki-expedition'),
        queryLode('kcwiki-expedition'),
        queryMasterRaw(),
        queryQp().catch((error) => {
          console.warn('[kanso] 远征任务反查加载失败', error)
          return null
        }),
      ])
      expedLocalizationLode = localizationPack
      expedLode = wikiwikiPack ?? localizationPack
      qp = qpState
      areaNames = new Map((raw?.data?.api_mst_maparea ?? []).map((a: any) => [a.api_id, a.api_name]))
      useitemNames = new Map(
        (raw?.data?.api_mst_useitem ?? []).map((item: any) => [item.api_id, item.api_name]),
      )
      savePlannerPrefs()
      render()
    })()
    onQpChange(() => {
      if (pane.classList.contains('active')) render()
    })
    onMgChange((keys) => {
      if (keys.includes('decks')) {
        // 失效只认**返港检测**：远征跑完了它的记录才多一条。
        // 「详情开着就顺手失效 selected」是多余的——编队增删也发 decks 报文，
        // 而那不会改变结算记录，白推一代就是白发一次 DB 查询。
        for (const deck of mg.decks) {
          const prev = lastDeckMissions.get(deck.id) ?? 0
          const cur = deck.mission?.[1] ?? 0
          if (prev > 0 && prev !== cur) invalidateExpeditionHistory(prev)
          lastDeckMissions.set(deck.id, cur)
        }
      }
      if (keys.some((k) => ['master', 'decks', 'ships', 'slotitems', 'ndocks', 'quests'].includes(k)) && pane.classList.contains('active')) {
        if (keys.includes('decks') || keys.includes('ships')) savePlannerPrefs()
        // 用户正按在这块面板上就让到抬起之后（按下与抬起之间换掉 DOM，click 不会发生）
        if (!deferWhilePressed(pane, 'bi', render)) render()
      }
    })
    onTick(() => {
      if (pane.classList.contains('active')) updateCountdowns(pane)
    })
    render()
  },
  onShow: () => render(),
})
