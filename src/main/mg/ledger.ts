// 铭 · 事件账本。node:sqlite（Electron 43 内置 Node 24 自带，零依赖）。
// 记账纪律：
// - 全量 /kcsapi 事件入账（默认永久保留，清理由玩家在钥里决定），供掉落/出击/收支等统计回放；
// - 大体积快照路径（start2/port/require_info 等）不把 body 写进账本，
//   只在 snapshots/ 目录保留最新一份（否则账本轻松上 GB）；
// - post_body 里的 api_token（DMM 登录会话凭据）入账前替换成占位——
//   账本里绝不落凭据明文，统计回放只需要业务参数；
// - 资源变动单独记 material_log，锱（资源统计）的曲线直接查它。
import fs from 'fs'
import path from 'path'

import { atomicWriteJsonSync } from '../atomic-json'
import config from '../config'
import { APPDATA_PATH } from '../env'
import { getLode } from '../lode'
import { upgradeBattleView } from './battle'
import { aggregateFactoryStats } from './factory-stats'
import { redactPostBody } from './post-body-redact'
import {
  overwriteQuestProgress,
  planQuestProgressChanges,
  recomputeSinkQuestProgress,
  type QuestProgressChange,
} from './quest-sink-replay'
import {
  calculateSortieSupplyCost,
  mergeSortieSupplyCosts,
  type SortieSupplyBaseline,
  type SortieSupplyCost,
} from '../../shared/sortie-supply-cost'
import {
  emptyFirstEncounterIndex,
  foldFirstEncounter,
} from '../../shared/first-encounter'
import {
  abyssSeenEntriesOf,
  foldAbyssSeen,
  type AbyssSeenCache,
  type AbyssSeenEntry,
} from '../../shared/abyss-seen'
import { fitObservationStars } from '../../shared/fit-observation'
import {
  groupFriendlySightings,
  replayFriendlySightings,
  type FriendlyFleetRecord,
  type FriendlyFleetShip,
  type FriendlyFleetSighting,
} from '../../shared/friendly-fleet'
import { localDayOffsetMs, localDayStart } from '../../shared/local-calendar'
import {
  clampLedgerRetentionDays,
  foldLedgerMonthCounts,
  LEDGER_ROLLING_TABLES,
  ledgerMonthsCovered,
  planLedgerMonthClear,
  planLedgerPrune,
  type LedgerMonthCount,
} from '../../shared/ledger-retention'
import type { FitObservationRecord } from '../../shared/fit-observation'
import {
  ITEM_USE_PATH,
  MATERIAL_REFRESH_PATH,
  PAY_ITEM_USE_PATH,
  replayItemUseMaterialCategories,
} from '../../shared/item-use-materials'
import {
  isUseitemFullSyncPath,
  resolveUseitemCause,
  type UseitemCauseAction,
} from '../../shared/useitem-cause'
import { mapIdOf } from '../../shared/map-id'
import type { PayLogRow } from '../../shared/pay-log'
import { bossKillAnomalyText, resolveBossKill } from '../../shared/boss-kill'
import { trainingCruiserSetup } from '../../shared/practice-exp'
import {
  matchShipJoinOrigins,
  type ShipBuildReceipt,
  type ShipDropSighting,
  type ShipJoinRecord,
} from '../../shared/ship-join-origin'

import type {
  BattleSnapshot,
  BattleSnapshotSummary,
  EventSortieCostReport,
  ExpeditionHistoryEntry,
  ExpeditionHistoryReport,
  ExpeditionResultKind,
  FactoryStatsReport,
  FirstEncounterIndex,
  MapChronicleReport,
  MapClearFleetRow,
  NodeHistoryIndexEntry,
  NodeHistoryReport,
  RouteStatsReport,
  SortieView,
  ShipLifeEquipment,
  ShipLifeEvent,
  ShipLifeEventKind,
  ShipLifeReport,
  ShipBossKillEntry,
  ShipMemorialEntry,
  ShipMemorialReport,
  SortieForecastReport,
  ExpSampleReport,
  LocalDropScope,
} from '../../shared/mg-types'
import {
  EMPTY_LOCAL_DROPS,
  aggregateLocalDrops,
  type LocalDropSample,
} from './local-drops'
import {
  EO_SENKA,
  SENKA_PER_EXP,
  CARRY_EXP_DIVISOR,
  CARRY_SPECIAL_DIVISOR,
  capSenkaEntries,
  eoMonthResetTs,
  firstEoClearObservations,
  senkaCarryWindows,
  senkaMonthEnd,
  senkaMonthStart,
  type SenkaEntry,
  type SenkaSummary,
} from '../../shared/senka'
import {
  planManualQuestSenkaBooking,
  planQuestSenkaBooking,
  questIdFromClearItemGet,
  questSenkaBookingWindow,
} from '../../shared/senka-quest-book'
import type { QuestSenkaBookingReason } from '../../shared/senka-quest-book'

import type { QuestPeriodKind } from '../../shared/quest-period'

// @types/node 对 node:sqlite 的覆盖尚不稳定，用 require 保持运行时兼容
const { DatabaseSync } = require('node:sqlite')

const DB_PATH = path.join(APPDATA_PATH, 'mg.sqlite')
const SNAPSHOT_DIR = path.join(APPDATA_PATH, 'snapshots')

// ---- 日期自动清理退役（2026-08-23 用户拍板）----
//
// 这里原先是 `RETENTION_DAYS = 90` 与 `NOTIFY_RETENTION_DAYS = 14`：每天定时把
// 超期的行 DELETE 掉。用户当天把这条口径整个反掉——「带日期的事实永久记着，
// 清理权归玩家」，理由与出处写在 shared/ledger-retention 的文件头
//（同一天先在语音「官方没有」台账上立的，见 shared/voice-probe-plan）。
//
// 现在的保留期是**玩家自己设的天数**（`kanso.ledger.retentionDays`，空/0 = 不限，
// 默认就是不限）。定时器照旧每天跑一次，但没设保留期时 `planLedgerPrune`
// 返回空数组，`prune()` 一行都不删。

/** 保留天数存在这里（空/0 = 不限）。与档案上限那两项同一层。 */
const RETENTION_CONFIG_PATH = 'kanso.ledger.retentionDays'

export interface ShipLifeStateRow {
  rosterId: number
  mstId: number
  level: number
  expTotal: number
  equipment: ShipLifeEquipment[]
  firstSeen: number
  lastSeen: number
}

export interface ShipLifeEventInput {
  ts: number
  rosterId: number
  mstId: number
  kind: ShipLifeEventKind
  expDelta?: number
  map?: number | null
  cell?: number | null
  rank?: string | null
  isBoss?: boolean
  practice?: boolean
  mvp?: boolean
  // 这一战掉了多少 HP、有没有被打进大破。null = 说不出（这两列上线前的老 battle 记录），
  // 与「0 伤害」是两回事——统计端必须分开处理，不能把不可知当成没挨打。
  damageTaken?: number | null
  taiha?: boolean | null
  // 打出去多少：只含有明确施加方的伤害。航空战/基地航空/支援是阶段伤害，
  // 游戏不给逐舰归属，battle.ts 那边 attacker<0 就不累加，这里照样不算。
  damageDealt?: number | null
  detail?: Record<string, any>
}

// body 不入账、改存最新快照文件的重量级路径
const SNAPSHOT_ONLY_PATHS = new Set([
  '/kcsapi/api_start2/getData',
  '/kcsapi/api_port/port',
  '/kcsapi/api_get_member/require_info',
  '/kcsapi/api_get_member/ship2',
  '/kcsapi/api_get_member/ship3',
])

class Ledger {
  private db: any
  private closed = false
  private lastRecordedEventId: number | null = null
  private pruneTimer: ReturnType<typeof setInterval>

  constructor() {
    fs.mkdirSync(APPDATA_PATH, { recursive: true })
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true })
    this.db = new DatabaseSync(DB_PATH)
    this.db.exec('PRAGMA journal_mode = WAL')
    const previousVersion = Number(
      (this.db.prepare('PRAGMA user_version').get() as { user_version?: number })?.user_version ?? 0,
    )
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        method TEXT,
        path TEXT NOT NULL,
        body TEXT,
        post_body TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
      CREATE INDEX IF NOT EXISTS idx_events_path ON events(path);
      CREATE TABLE IF NOT EXISTS material_log (
        ts INTEGER NOT NULL,
        fuel INTEGER, ammo INTEGER, steel INTEGER, bauxite INTEGER,
        fastbuild INTEGER, bucket INTEGER, devmat INTEGER, screw INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_material_ts ON material_log(ts);
      -- 战果账：游戏不下发战果数值，但公式的输入（提督经验）它给。
      -- 每笔单独记，才能回答「这一笔是怎么来的」而不是只给一个月度总数。
      CREATE TABLE IF NOT EXISTS senka_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        kind TEXT NOT NULL,          -- exp | eo | quest
        exp_delta INTEGER NOT NULL,  -- 提督经验增量（kind=exp 时有意义）
        senka REAL NOT NULL,
        note TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_senka_ts ON senka_log(ts);
      -- 上一次看到的提督经验总值，用来算增量
      CREATE TABLE IF NOT EXISTS senka_state (id INTEGER PRIMARY KEY, exp_total INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS material_delta (
        ts INTEGER NOT NULL,
        category TEXT NOT NULL,
        fuel INTEGER, ammo INTEGER, steel INTEGER, bauxite INTEGER,
        fastbuild INTEGER, bucket INTEGER, devmat INTEGER, screw INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_delta_ts ON material_delta(ts);
      -- 道具履历：useitem 持有数的变化。持有数本来就每次 require_info 全量下发，
      -- 记它的差分即可，不需要额外数据源。一行几十字节，与遭遇志同列为永久表。
      CREATE TABLE IF NOT EXISTS useitem_log (
        ts INTEGER NOT NULL,
        item_id INTEGER NOT NULL,
        delta INTEGER NOT NULL,
        total INTEGER NOT NULL,
        cause TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_useitem_ts ON useitem_log(ts);
      CREATE INDEX IF NOT EXISTS idx_useitem_id ON useitem_log(item_id);
      CREATE TABLE IF NOT EXISTS quest_progress (
        quest_id INTEGER PRIMARY KEY,
        counts TEXT NOT NULL,
        updated INTEGER NOT NULL
      );
      -- 遭遇志（本地反哺）：压缩后的个人遭遇/带路史，永久保留（任何清理路径都不碰）
      CREATE TABLE IF NOT EXISTS encounters (
        ts INTEGER NOT NULL,
        map INTEGER NOT NULL,          -- area*10+no
        cell INTEGER NOT NULL,         -- 罗盘 api_no
        is_boss INTEGER NOT NULL,
        formation INTEGER,             -- 敌阵形
        comp TEXT NOT NULL,            -- 敌编成 mstId 数组 JSON（联合 12 舰）
        rank TEXT,                     -- 实际评级
        drop_mst INTEGER,               -- 掉落舰 mstId（无 = NULL）
        sunk_mask INTEGER          -- comp 第 i 位是否被击沉的位掩码；NULL = 该列上线前的老记录
      );
      CREATE INDEX IF NOT EXISTS idx_enc_map ON encounters(map, cell);
      CREATE TABLE IF NOT EXISTS routes (
        ts INTEGER NOT NULL,
        map INTEGER NOT NULL,
        from_cell INTEGER NOT NULL,    -- -1 = 出击起点
        to_cell INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_route_map ON routes(map, from_cell);
      -- 友军遭遇志：战斗报文带 api_friendly_info 时记一行。口径与判重键见
      -- shared/friendly-fleet 的文件头（production_type 只存原值；指纹不含血量）。
      -- 主键（指纹, 时刻）让从 events 回放补录可以任意重跑，第二次是空操作。
      CREATE TABLE IF NOT EXISTS friendly_fleets (
        fleet_key TEXT NOT NULL,       -- 编成指纹：舰 mstId+Lv+装备
        ts INTEGER NOT NULL,           -- 遇到的时刻
        map INTEGER NOT NULL,          -- area*10+no
        cell INTEGER NOT NULL,         -- 罗盘 api_no
        difficulty INTEGER NOT NULL,   -- api_selected_rank：1丁 2丙 3乙 4甲；0 = 常规海域/不可知
        request_type INTEGER,          -- set_friendly_request 的 api_request_type；NULL = 关联不上
        production_type INTEGER,       -- api_production_type 原值，**不解读**
        comp TEXT NOT NULL,            -- FriendlyFleetShip[] JSON
        PRIMARY KEY (fleet_key, ts)
      );
      CREATE INDEX IF NOT EXISTS idx_friendly_scope ON friendly_fleets(map, difficulty);
      -- 出击预测样本：从本版本开始按一次出击串联节点结果。
      -- 不从旧 encounters/routes 反推，因为旧表无法可靠区分进击、主动返港和会话边界。
      CREATE TABLE IF NOT EXISTS sortie_samples (
        sortie_id INTEGER PRIMARY KEY, -- map/start 的毫秒时间戳
        start_ts INTEGER NOT NULL,
        end_ts INTEGER,
        map INTEGER NOT NULL,
        difficulty INTEGER NOT NULL DEFAULT 0,
        event_key INTEGER NOT NULL DEFAULT 0,
        combined_type INTEGER NOT NULL DEFAULT 0,
        deck_id INTEGER NOT NULL DEFAULT 1,
        boss_cell INTEGER NOT NULL DEFAULT -1,
        fleet_signature TEXT NOT NULL,
        supply_baseline TEXT NOT NULL DEFAULT '[]',
        fuel_cost INTEGER,
        ammo_cost INTEGER,
        completed INTEGER NOT NULL DEFAULT 0,
        reached_boss INTEGER NOT NULL DEFAULT 0,
        boss_rank TEXT,
        boss_win INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_sortie_sample_scope
        ON sortie_samples(map, difficulty, event_key, combined_type, completed);
      CREATE TABLE IF NOT EXISTS node_samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sortie_id INTEGER NOT NULL,
        battle_no INTEGER NOT NULL,
        ts INTEGER NOT NULL,
        map INTEGER NOT NULL,
        cell INTEGER NOT NULL,
        difficulty INTEGER NOT NULL DEFAULT 0,
        event_key INTEGER NOT NULL DEFAULT 0,
        combined_type INTEGER NOT NULL DEFAULT 0,
        is_boss INTEGER NOT NULL DEFAULT 0,
        formation INTEGER,
        comp TEXT NOT NULL,
        rank TEXT,
        ship_count INTEGER NOT NULL,
        taiha_count INTEGER NOT NULL,
        advanced INTEGER,
        UNIQUE(sortie_id, battle_no)
      );
      CREATE INDEX IF NOT EXISTS idx_node_sample_scope
        ON node_samples(map, cell, difficulty, event_key, combined_type);
      -- 完整战斗快照：用于节点复盘与舰娘人生记录反向打开。
      -- 大对象，不进入永久遭遇志。2026-08-23 起「只留最近 500 场 + 最多 90 日」
      -- 那两条自动淘汰一并退役：要控体积就在钥里设保留天数或按月清。
      CREATE TABLE IF NOT EXISTS battle_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        sortie_id INTEGER NOT NULL,
        battle_no INTEGER NOT NULL,
        map INTEGER NOT NULL,
        cell INTEGER NOT NULL,
        rank TEXT,
        is_boss INTEGER NOT NULL DEFAULT 0,
        practice INTEGER NOT NULL DEFAULT 0,
        snapshot TEXT NOT NULL,
        UNIQUE(sortie_id, battle_no, practice)
      );
      CREATE INDEX IF NOT EXISTS idx_battle_snapshots_ts ON battle_snapshots(ts DESC);
      -- 远征履历：每次结算一行，体积很小且玩家长期规划有用，永久保留。
      CREATE TABLE IF NOT EXISTS expedition_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        mission_id INTEGER NOT NULL,
        deck_id INTEGER NOT NULL,
        result TEXT NOT NULL,
        materials TEXT NOT NULL,
        items TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_expedition_history_mission
        ON expedition_history(mission_id, ts DESC);
      -- 本机氪金记录（2026-08-19 用户定名）：购买/消耗/手动补记各一行，永久保留。
      -- buy 由 payitem 清单前后相减得出，use 来自 payitemuse，manual 是玩家补记
      -- 在别处完成的氪金。price 是单价（DMM 点数 ≈ 日元），报文没给时为 NULL。
      CREATE TABLE IF NOT EXISTS pay_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        kind TEXT NOT NULL,
        item_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        count INTEGER NOT NULL,
        price INTEGER,
        detail TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_pay_log_ts ON pay_log(ts DESC);
      -- 在籍舰「人生记录」：状态表保存差分基线，事件表永久保留确认过的变化。
      -- roster_id 是玩家持有实例 id；同图鉴舰的多艘副舰不会串档。
      CREATE TABLE IF NOT EXISTS ship_life_state (
        roster_id INTEGER PRIMARY KEY,
        mst_id INTEGER NOT NULL,
        level INTEGER NOT NULL,
        exp_total INTEGER NOT NULL,
        equipment TEXT NOT NULL,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ship_life_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        roster_id INTEGER NOT NULL,
        mst_id INTEGER NOT NULL,
        kind TEXT NOT NULL,
        exp_delta INTEGER NOT NULL DEFAULT 0,
        map INTEGER,
        cell INTEGER,
        rank TEXT,
        is_boss INTEGER NOT NULL DEFAULT 0,
        practice INTEGER NOT NULL DEFAULT 0,
        mvp INTEGER NOT NULL DEFAULT 0,
        detail TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_ship_life_roster
        ON ship_life_events(roster_id, ts DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ship_life_terminal
        ON ship_life_events(roster_id)
        WHERE kind IN ('scrap', 'material', 'sunk');
      -- 活动海域主数据会在活动结束后的 start2 中消失；先把区名与各图名称/编号固化，
      -- 图鉴才能在活动结束后继续常驻展示，而不依赖过期主数据或联网回抓。
      CREATE TABLE IF NOT EXISTS event_map_catalog (
        area_id INTEGER PRIMARY KEY,
        area_name TEXT NOT NULL,
        opened INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        closed_ts INTEGER,
        maps TEXT NOT NULL
      );
      -- 活动归档：活动一关就结账（events/material_log 是可清理的滚动表，
      -- 那段一旦被清掉就永远算不回来）。一活动一行，永久保留。
      CREATE TABLE IF NOT EXISTS event_archive (
        area_id INTEGER PRIMARY KEY,   -- api_mst_maparea.api_id
        opened INTEGER NOT NULL,       -- 首次在主数据里观测到
        closed INTEGER NOT NULL,       -- 从主数据里消失
        stats TEXT NOT NULL            -- 聚合结果 JSON
      );
      -- 通知历史（铃）：只为「昨晚那条远征是几点回的」这类回看。原先是 14 日滚动，
      -- 2026-08-23 起跟随钥里那个保留天数（不设就不清），铃里另有手动「清空历史」。
      -- 会话边界记在 session 列：重开艦素后旧会话的条目只读不重放，
      -- 既不再冒出陈旧 Toast，也不会把它们算进未读徽章。
      CREATE TABLE IF NOT EXISTS notify_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        session INTEGER NOT NULL,
        event TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT NOT NULL,
        ref TEXT,
        read INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_notify_ts ON notify_log(ts DESC);
      -- 装备加成的「你的实测」（永久表，任何清理路径都不碰）。
      -- 面板反推出来的观察只在「这艘舰此刻正装着它」时算得出来；一旦卸下、升星、
      -- 改造，那个读数就再也拿不回来了——所以观察到就落盘。
      --
      -- 主键含 stars：**升星是新增一条，不覆盖旧星级那一条**。「★2 时曾测得 火力+3」
      -- 与「★6 时测得 火力+4」是两条各自为真的观察，把前者盖掉等于把已经做过的
      -- 实验删了。stars 存排好序的★多重集（'0.2' = 混★ 各一件），与
      -- shared/fit-observation 的 fitObservationKey 同一口径。
      CREATE TABLE IF NOT EXISTS fit_observations (
        equip_mst INTEGER NOT NULL,
        form_id INTEGER NOT NULL,
        stars TEXT NOT NULL,
        count INTEGER NOT NULL,
        stats TEXT NOT NULL,          -- FitStats JSON（七项里非零的那几项）
        sole INTEGER NOT NULL,        -- 1 = 那一刻这艘舰上只有这一件有加成记录，可直读
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        PRIMARY KEY (equip_mst, form_id, stars, count)
      );
      CREATE INDEX IF NOT EXISTS idx_fit_obs_equip ON fit_observations(equip_mst);
    `)
    // 后加的列：老库建表时没有，CREATE TABLE IF NOT EXISTS 不会补，得显式 ALTER。
    // 已存在时 sqlite 会报错，吞掉即可（没有 IF NOT EXISTS 语法）。
    for (const [table, col, type] of [
      ['encounters', 'sunk_mask', 'INTEGER'],
      ['sortie_samples', 'supply_baseline', "TEXT NOT NULL DEFAULT '[]'"],
      ['sortie_samples', 'fuel_cost', 'INTEGER'],
      ['sortie_samples', 'ammo_cost', 'INTEGER'],
      // 通关阵容（2026-08-17）：装备搭配与 33 式没法从签名回溯，出击当场记
      ['sortie_samples', 'fleet_equips', 'TEXT'],
      ['sortie_samples', 'los33', 'REAL'],
      // 承受伤害与大破次数。老 battle 记录里这两列是 NULL，代表「说不出」而不是 0；
      // 统计端据此报出「更早的 N 场不可知」，不把缺数据算成没挨打。
      ['ship_life_events', 'damage_taken', 'INTEGER'],
      ['ship_life_events', 'taiha', 'INTEGER'],
      ['ship_life_events', 'damage_dealt', 'INTEGER'],
      // 活动难度（api_selected_rank：1丁 2丙 3乙 4甲）。NULL = 该列上线前的老记录，
      // 或常规海域（本来就没有难度）。少了它，一条丙难度的遭遇会被拿去和乙难度的
      // 编成比对——甲乙丙丁的同名敌舰是不同的 mstId，比错了结论全是噪声。
      ['encounters', 'difficulty', 'INTEGER'],
      // 开发那一刻的秘书舰（第一舰队旗舰 mstId）。响应体里没有这一项，只能记账时补；
      // 秘书舰类型决定开发表，回顾里同配方必须按它分行。NULL = 上线前老记录或非开发行。
      ['events', 'secretary_mst', 'INTEGER'],
      // 手动补记标记（2026-09-01）：1 = 玩家自己补的一笔，NULL/0 = kuma 观测记的。
      // 只有手动行可删、且「重算任务战果」不碰它——口径与 pay_log 的 kind='manual' 同源。
      ['senka_log', 'manual', 'INTEGER'],
      // 道具变化的归因端点。NULL = 按符号与可消耗性仍解释不了，不拿最近操作硬填。
      ['useitem_log', 'cause', 'TEXT'],
    ]) {
      try {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`)
        console.log(`[kanso] mg: ledger 迁移 — ${table}.${col} 已补列`)
      } catch (_e) {
        /* 已有该列 */
      }
    }
    if (previousVersion < 5) this.repairShipLifeV5()
    if (previousVersion < 6) this.redactStoredTokensV6()
    if (previousVersion < 7) this.backfillFriendlyFleetsV7()
    if (previousVersion < 8) this.reclassifyItemUseDeltasV8()
    if (previousVersion < 9) this.backfillShipJoinOriginsV9()
    if (previousVersion < 10) this.backfillBossKillsV10()
    if (previousVersion < 11) this.revokeUnevidencedQuestSenkaV11()
    if (previousVersion < 12) this.backfillUseitemCausesV12()
    const questProgressV13 =
      previousVersion >= 13 ? true : this.recomputeCarrierSinkProgressV13() != null
    this.db.exec(`PRAGMA user_version = ${questProgressV13 ? 13 : 12}`)
    this.prune()
    // 每天顺手清一次陈账
    this.pruneTimer = setInterval(() => this.prune(), 24 * 3600 * 1000)
  }

  // 批量写包进一个事务：WAL 下每条自动提交各付一次同步开销，
  // 一次 port 后 ship-life 可能几十条 upsert，逐条提交把写盘次数放大一个量级。
  // 单条批不值一次 BEGIN/COMMIT，直接跑。
  private runBatch = (count: number, fn: () => void) => {
    if (count <= 1) {
      fn()
      return
    }
    this.db.exec('BEGIN IMMEDIATE')
    try {
      fn()
      this.db.exec('COMMIT')
    } catch (error) {
      try {
        this.db.exec('ROLLBACK')
      } catch (_rollbackError) {
        /* 原始错误更重要 */
      }
      throw error
    }
  }

  record = (
    method: string,
    apiPath: string,
    body: string,
    postBody: string,
    ts: number,
    secretaryMst: number | null = null,
  ) => {
    this.lastRecordedEventId = null
    try {
      const snapshotOnly = SNAPSHOT_ONLY_PATHS.has(apiPath)
      if (snapshotOnly) {
        // 快照写盘挪出记账 tick：start2/port 是最重的包，
        // parse + fsync 落盘没必要挤在同一轮事件处理里（setImmediate 保序，后写覆盖先写）
        const file = path.join(SNAPSHOT_DIR, `${apiPath.replace(/\//g, '_').slice(1)}.json`)
        setImmediate(() => {
          try {
            atomicWriteJsonSync(file, { ts, body: JSON.parse(body) })
          } catch (e) {
            // 快照失败不应连带丢掉本次事件元数据。
            console.warn('[kanso] mg: snapshot save failed', apiPath, e)
          }
        })
      }
      const result = this.db
        .prepare(
          'INSERT INTO events (ts, method, path, body, post_body, secretary_mst) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(ts, method, apiPath, snapshotOnly ? null : body, redactPostBody(postBody), secretaryMst)
      this.lastRecordedEventId = Number(result.lastInsertRowid) || null
    } catch (e) {
      console.warn('[kanso] mg: ledger record failed', e)
    }
  }

  private actionsSinceLastUseitemSync = (): UseitemCauseAction[] => {
    const endId = this.lastRecordedEventId
    if (!(endId && endId > 0)) return []
    const previousSync = this.db
      .prepare(
        `SELECT id FROM events
         WHERE id < ? AND path IN (
           '/kcsapi/api_get_member/useitem',
           '/kcsapi/api_get_member/require_info'
         )
         ORDER BY id DESC LIMIT 1`,
      )
      .get(endId) as { id: number } | undefined
    if (!previousSync) return []
    return this.db
      .prepare(
        `SELECT ts, path, post_body AS postBody FROM events
         WHERE id > ? AND id <= ? ORDER BY id ASC`,
      )
      .all(previousSync.id, endId) as UseitemCauseAction[]
  }

  // 道具变化：只写真正变了的项（调用方负责 diff）
  logUseitems = (ts: number, changes: { id: number; delta: number; total: number }[]) => {
    if (!changes.length) return
    try {
      const actions = this.actionsSinceLastUseitemSync()
      const stmt = this.db.prepare(
        'INSERT INTO useitem_log (ts, item_id, delta, total, cause) VALUES (?, ?, ?, ?, ?)',
      )
      this.runBatch(changes.length, () => {
        for (const c of changes) {
          stmt.run(ts, c.id, c.delta, c.total, resolveUseitemCause(c, actions))
        }
      })
    } catch (e) {
      console.warn('[kanso] mg: useitem log failed', e)
    }
  }

  // ---- 通知历史（铃）----
  // 写入由渲染端触发（通知本身是渲染端按规则合成的），这里只负责落盘与滚动。

  appendNotice = (notice: {
    ts: number
    session: number
    event: string
    title: string
    detail: string
    ref: string | null
    read: boolean
  }): number | null => {
    try {
      const info = this.db
        .prepare(
          `INSERT INTO notify_log (ts, session, event, title, detail, ref, read)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          notice.ts,
          notice.session,
          notice.event,
          notice.title,
          notice.detail,
          notice.ref,
          notice.read ? 1 : 0,
        )
      return Number(info.lastInsertRowid)
    } catch (e) {
      console.warn('[kanso] mg: notify append failed', e)
      return null
    }
  }

  // 最近的通知，新的在前。limit 是硬上限，避免一次把 14 天全塞进渲染端。
  recentNotices = (limit = 400) => {
    try {
      return this.db
        .prepare(
          `SELECT id, ts, session, event, title, detail, ref, read
           FROM notify_log ORDER BY ts DESC, id DESC LIMIT ?`,
        )
        .all(Math.max(1, Math.min(2000, Math.floor(limit)))) as {
        id: number
        ts: number
        session: number
        event: string
        title: string
        detail: string
        ref: string | null
        read: number
      }[]
    } catch (e) {
      console.warn('[kanso] mg: notify query failed', e)
      return []
    }
  }

  markNoticesRead = (ids: number[] | 'all') => {
    try {
      if (ids === 'all') {
        this.db.prepare('UPDATE notify_log SET read = 1 WHERE read = 0').run()
        return
      }
      if (!ids.length) return
      const stmt = this.db.prepare('UPDATE notify_log SET read = 1 WHERE id = ?')
      this.runBatch(ids.length, () => {
        for (const id of ids) stmt.run(id)
      })
    } catch (e) {
      console.warn('[kanso] mg: notify mark-read failed', e)
    }
  }

  // 用户在钥里「清空通知历史」时调用；不参与自动清理。
  clearNotices = () => {
    try {
      this.db.prepare('DELETE FROM notify_log').run()
    } catch (e) {
      console.warn('[kanso] mg: notify clear failed', e)
    }
  }

  /**
   * 账本里存着的图鉴报文（`api_get_member/picture_book`），供衣装归属回灌。
   *
   * 这个端点**不在** `SNAPSHOT_ONLY_PATHS` 里，body 是逐条入账的，所以玩家过去
   * 每次翻图鉴的那一份都还在。只按 id 往后取：调用方存着游标，扫过的不再扫
   *（一份报文四到六万字，全量重解析是每次启动白花几百毫秒）。
   *
   * `limit` 兜住「玩家翻过几千页」的极端情况——一次扫不完就下次接着扫，
   * 游标保证不会倒退，也不会漏。
   */
  queryPictureBookBodies = (afterId: number, limit = 400) => {
    try {
      return this.db
        .prepare(
          `SELECT id, body FROM events
           WHERE path = '/kcsapi/api_get_member/picture_book' AND body IS NOT NULL AND id > ?
           ORDER BY id ASC LIMIT ?`,
        )
        .all(
          Math.max(0, Math.floor(afterId) || 0),
          Math.max(1, Math.min(5000, Math.floor(limit))),
        ) as { id: number; body: string }[]
    } catch (e) {
      console.warn('[kanso] mg: picture_book query failed', e)
      return []
    }
  }

  // 时间窗内的操作事件与 useitem 全量边界，供旧道具行按「两次全量之间」归因。
  // 其余纯观测路径仍排掉；两条全量路径必须保留，否则渲染层会退回固定毫秒窗。
  // 注意 events 是可清理的滚动表，被清掉那段的变动查不到原因——调用方要如实说明，不能当「无原因」。
  // api_token（游戏会话凭据）入账时已替换成占位（v6 起，含存量抹除）；
  // 这里再兜一道——渲染层按自家威胁模型不该见到凭据，即使来源是异常写入的旧行。
  queryActionEvents = (fromTs: number, toTs: number) => {
    try {
      const rows = this.db
        .prepare(
          `SELECT ts, path, post_body AS postBody FROM events
           WHERE ts >= ? AND ts <= ?
             AND (
               path NOT LIKE '/kcsapi/api_get_member/%'
               OR path IN (
                 '/kcsapi/api_get_member/useitem',
                 '/kcsapi/api_get_member/require_info'
               )
             )
             AND path NOT LIKE '/kcsapi/api_port/%'
             AND path NOT LIKE '/kcsapi/api_start2/%'
           ORDER BY ts ASC`,
        )
        .all(fromTs, toTs) as { ts: number; path: string; postBody: string | null }[]
      for (const row of rows) {
        row.postBody = redactPostBody(row.postBody)
      }
      return rows
    } catch (e) {
      console.warn('[kanso] mg: action events query failed', e)
      throw e
    }
  }

  // v5：旧版会把启动回灌的形态抖动记成改造，并把同次改造卸装另记成换装。
  // 只在一次性迁移中用账本里还留着的真实 /remodeling 请求核验；
  // 以后不重复运行，避免原始事件过期后误删永久履历。
  private repairShipLifeV5 = () => {
    try {
      const remodels = this.db
        .prepare(
          `SELECT id, ts, roster_id AS rosterId
           FROM ship_life_events WHERE kind = 'remodel'`,
        )
        .all() as { id: number; ts: number; rosterId: number }[]
      if (!remodels.length) return
      const raw = this.db
        .prepare(
          `SELECT ts, post_body AS postBody FROM events
           WHERE path = '/kcsapi/api_req_kaisou/remodeling'`,
        )
        .all() as { ts: number; postBody: string | null }[]
      const actions = raw.flatMap((row) => {
        try {
          const post = JSON.parse(row.postBody ?? '{}')
          const rosterId = parseInt(`${post.api_id ?? 0}`, 10)
          return rosterId > 0 ? [{ ts: row.ts, rosterId }] : []
        } catch (_e) {
          return []
        }
      })
      const trusted = new Set(
        remodels
          .filter((event) =>
            actions.some(
              (action) =>
                action.rosterId === event.rosterId &&
                event.ts >= action.ts &&
                event.ts - action.ts <= 30000,
            ),
          )
          .map((event) => event.id),
      )
      this.db.exec('BEGIN IMMEDIATE')
      try {
        const removeEquipment = this.db.prepare(
          `DELETE FROM ship_life_events
           WHERE kind = 'equipment' AND roster_id = ? AND ts = ?`,
        )
        for (const event of remodels) removeEquipment.run(event.rosterId, event.ts)
        const removeRemodel = this.db.prepare(
          `DELETE FROM ship_life_events WHERE id = ?`,
        )
        for (const event of remodels) {
          if (!trusted.has(event.id)) removeRemodel.run(event.id)
        }
        this.db.exec('COMMIT')
      } catch (error) {
        this.db.exec('ROLLBACK')
        throw error
      }
      const removed = remodels.length - trusted.size
      console.log(
        `[kanso] mg: ledger v5 — 清理 ${removed} 条未获 API 证实的改造与同操作重复换装`,
      )
    } catch (error) {
      console.warn('[kanso] mg: ledger v5 ship-life repair failed', error)
    }
  }

  // v6：record 曾把 post_body 连同 api_token 原文入账，存量凭据本要在盘上
  // 再活到玩家哪天想起来清账本为止——一次性抹掉，泄露面不该靠时间慢慢收口
  //（保留期退役之后更是如此：不清就是永远）。
  // 按 id 键集分批：抹完的行仍含 api_token 字样（占位键还在），OFFSET 分页会原地打转。
  private redactStoredTokensV6 = () => {
    try {
      const select = this.db.prepare(
        `SELECT id, post_body AS postBody FROM events
         WHERE id > ? AND post_body LIKE '%api_token%'
         ORDER BY id LIMIT 2000`,
      )
      const update = this.db.prepare('UPDATE events SET post_body = ? WHERE id = ?')
      let lastId = 0
      let changed = 0
      for (;;) {
        const rows = select.all(lastId) as { id: number; postBody: string | null }[]
        if (!rows.length) break
        this.runBatch(rows.length, () => {
          for (const row of rows) {
            const clean = redactPostBody(row.postBody)
            if (clean !== row.postBody) {
              update.run(clean, row.id)
              changed++
            }
          }
        })
        lastId = rows[rows.length - 1].id
      }
      if (changed) {
        console.log(`[kanso] mg: ledger v6 — 已把 ${changed} 条存量 post_body 的 api_token 抹为占位`)
      }
    } catch (error) {
      console.warn('[kanso] mg: ledger v6 token redaction failed', error)
    }
  }

  // v7：友军遭遇志建表之前的历史报文回填。
  // 官方友军舰队 2026-08-26 上线，这张表比它晚——那几场的报文还在 events 里躺着，
  // 报文在、结论不在。回放判据全在 shared/friendly-fleet 的 replayFriendlySightings，
  // 与实时收录读同一批字段，补出来的行与当场记下的行没有口径差。
  //
  // **重跑安全**：写入走 logFriendlyFleet 的 INSERT OR IGNORE，主键是（指纹, 时刻），
  // 同一份报文补第二遍是空操作。所以这条既能当一次性迁移，也能拿去手工重放。
  private backfillFriendlyFleetsV7 = () => {
    try {
      // 战斗包按路径前缀先收窄（有 idx_events_path），再看正文——
      // 对整张 events 做 LIKE 全扫会把启动卡住。
      const rows = this.db
        .prepare(
          `SELECT ts, path, body, post_body AS postBody FROM events
           WHERE path IN (
                   '/kcsapi/api_get_member/mapinfo',
                   '/kcsapi/api_req_map/select_eventmap_rank',
                   '/kcsapi/api_req_map/start',
                   '/kcsapi/api_req_map/next',
                   '/kcsapi/api_req_member/set_friendly_request'
                 )
              OR (
                   (path LIKE '/kcsapi/api_req_battle_midnight/%'
                    OR path LIKE '/kcsapi/api_req_combined_battle/%')
                   AND body LIKE '%api_friendly_info%'
                 )
           ORDER BY ts ASC, id ASC`,
        )
        .all() as { ts: number; path: string; body: string | null; postBody: string | null }[]
      const events = rows.flatMap((row) => {
        try {
          return [
            {
              ts: row.ts,
              path: row.path,
              body: row.body ? JSON.parse(row.body) : null,
              post: row.postBody ? JSON.parse(row.postBody) : null,
            },
          ]
        } catch (_e) {
          // 单条报文解不开不该带垮整次回填
          return []
        }
      })
      const sightings = replayFriendlySightings(events)
      if (!sightings.length) return
      this.runBatch(sightings.length, () => {
        for (const sighting of sightings) this.logFriendlyFleet(sighting)
      })
      const fleets = new Set(sightings.map((one) => one.fleetKey)).size
      console.log(
        `[kanso] mg: ledger v7 — 友军遭遇志补录 ${sightings.length} 次遭遇（${fleets} 支友军）`,
      )
    } catch (error) {
      console.warn('[kanso] mg: ledger v7 friendly fleet backfill failed', error)
    }
  }

  // v8：用道具带来的资源到账改判。
  //
  // 这一族本来就在账本里，只是归错了类——载体 path 是 api_get_member/material，
  // 它不在 DELTA_CATEGORY 里，于是全进了「其他」。判据与实时归因共用
  // shared/item-use-materials 的**同一台状态机**，回放跑不出第二套口径。
  //
  // **只动 material_delta.category 一列**，events 与其余表零触碰；WHERE 里钉着
  // category='其他'，所以重跑是空操作，也绝不会去改已经归好类的行。
  private reclassifyItemUseDeltasV8 = () => {
    try {
      // 三条 path 一条都不能漏：少喂 payitemuse 会漏判，少喂 material 会让消耗错位。
      const rows = this.db
        .prepare(
          `SELECT ts, path FROM events WHERE path IN (?, ?, ?) ORDER BY ts ASC, id ASC`,
        )
        .all(PAY_ITEM_USE_PATH, ITEM_USE_PATH, MATERIAL_REFRESH_PATH) as {
        ts: number
        path: string
      }[]
      const found = replayItemUseMaterialCategories(rows)
      if (!found.size) return
      const update = this.db.prepare(
        `UPDATE material_delta SET category = ? WHERE ts = ? AND category = '其他'`,
      )
      let changed = 0
      this.runBatch(found.size, () => {
        for (const [ts, category] of found) changed += Number(update.run(category, ts).changes ?? 0)
      })
      if (changed) {
        console.log(`[kanso] mg: ledger v8 — ${changed} 笔用道具到账已从「其他」改判`)
      }
    } catch (error) {
      console.warn('[kanso] mg: ledger v8 item-use delta reclassify failed', error)
    }
  }

  // v9：老「加入镇守府」的出处回算。
  //
  // 这一列本来就答得上来，只是当初没人去问：掉落的地点在遭遇志里（永久表，
  // drop_mst 一直在记），建造的在籍 id 在 events 的 getship 报文里。判据与实时归因
  // 共用 shared/ship-join-origin 的**同一个匹配器**，回放跑不出第二套口径。
  //
  // **重跑安全**：已经有 origin 的 join 照样喂进匹配器（让它把对应的那条掉落/建造
  // 认领掉），但只对没有 origin 的写回。所以第二次跑是空操作。
  //
  // 认不到就留空。**确认不了就不标**——玩家看到的那一行照旧只写 Lv，
  // 不写「未知海域」这种既没信息又像是答案的东西。
  private backfillShipJoinOriginsV9 = () => {
    try {
      const joins = this.db
        .prepare(
          `SELECT id, ts, roster_id AS rosterId, mst_id AS mstId, detail
           FROM ship_life_events WHERE kind = 'join' ORDER BY ts ASC, id ASC`,
        )
        .all() as { id: number; ts: number; rosterId: number; mstId: number; detail: string }[]
      if (!joins.length) return
      const drops = (
        this.db
          .prepare(
            `SELECT ts, map, cell, is_boss AS isBoss, drop_mst AS mstId
             FROM encounters WHERE drop_mst IS NOT NULL AND cell > 0 ORDER BY ts ASC`,
          )
          .all() as any[]
      ).map(
        (row): ShipDropSighting => ({
          ts: Number(row.ts),
          mstId: Number(row.mstId),
          map: Number(row.map),
          cell: Number(row.cell),
          isBoss: Number(row.isBoss) === 1,
        }),
      )
      // 建造：只认 getship 的在籍 id。events 是可清理的滚动表，被清掉的那段就是
      // 答不上来的那段——不去拿别的路径旁敲侧击。
      const builds = (
        this.db
          .prepare(
            `SELECT ts, body FROM events
             WHERE path = '/kcsapi/api_req_kousyou/getship' AND body IS NOT NULL
             ORDER BY ts ASC, id ASC`,
          )
          .all() as { ts: number; body: string }[]
      ).flatMap((row): ShipBuildReceipt[] => {
        try {
          const response = JSON.parse(row.body)
          const body = response?.api_data ?? response
          const rosterId = Number(body?.api_ship?.api_id ?? body?.api_id)
          if (!(rosterId > 0)) return []
          const mstId = Number(body?.api_ship?.api_ship_id ?? body?.api_ship_id)
          return [{ ts: Number(row.ts), rosterId, mstId: mstId > 0 ? mstId : 0 }]
        } catch (_error) {
          // 单条报文解不开不该带垮整次回算
          return []
        }
      })
      const details = joins.map((row) => {
        try {
          const parsed = JSON.parse(row.detail ?? '{}')
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
        } catch (_error) {
          return {}
        }
      })
      const records: ShipJoinRecord[] = joins.map((row) => ({
        ts: Number(row.ts),
        rosterId: Number(row.rosterId),
        mstId: Number(row.mstId),
      }))
      const origins = matchShipJoinOrigins(records, { drops, builds })
      const updateDrop = this.db.prepare(
        `UPDATE ship_life_events SET map = ?, cell = ?, is_boss = ?, detail = ? WHERE id = ?`,
      )
      const updateBuild = this.db.prepare(
        `UPDATE ship_life_events SET detail = ? WHERE id = ?`,
      )
      const pending = joins.filter((_row, at) => typeof details[at]?.origin !== 'string').length
      let dropped = 0
      let built = 0
      this.runBatch(joins.length, () => {
        origins.forEach((origin, at) => {
          if (!origin) return
          if (typeof details[at]?.origin === 'string') return // 已有出处，不重写
          const detail = JSON.stringify({ ...details[at], origin: origin.origin })
          if (origin.origin === 'build') {
            updateBuild.run(detail, joins[at].id)
            built++
            return
          }
          updateDrop.run(origin.map, origin.cell, origin.isBoss ? 1 : 0, detail, joins[at].id)
          dropped++
        })
      })
      if (dropped || built) {
        console.log(
          `[kanso] mg: ledger v9 — 加入镇守府补出处 ${dropped + built} 条` +
            `（掉落 ${dropped} / 建造 ${built}），${pending - dropped - built} 条仍留空`,
        )
      }
    } catch (error) {
      console.warn('[kanso] mg: ledger v9 ship join origin backfill failed', error)
    }
  }

  // v10：老 boss 战的「最后一击归谁」回算。
  //
  // 这一列同样本来就答得上来：终结那一击的 side/attacker 一直躺在战斗快照里
  //（`hits[].sunk` 是解析层逐击模拟 HP 时立的），只是当初没人去问。
  // 判据与实时落账共用 shared/boss-kill 的**同一个函数**，回放跑不出第二套口径。
  //
  // **能补到哪算哪**：快照是可清理的（保留期由玩家定），被清掉的那一段就是
  // 答不上来的那一段——不去拿别的路径旁敲侧击，更不写「未知」。
  //
  // **重跑安全**：已经有 bossKill 的行不重写，第二次跑是空操作。
  private backfillBossKillsV10 = () => {
    try {
      const snapshots = this.db
        .prepare(
          `SELECT id, snapshot FROM battle_snapshots
           WHERE is_boss = 1 AND practice = 0 ORDER BY ts ASC`,
        )
        .all() as { id: number; snapshot: string }[]
      if (!snapshots.length) return
      // 这一批 boss 战事件按「快照 + 在籍舰」建索引，逐场再查表就是 N 次全表扫。
      const events = this.db
        .prepare(
          `SELECT id, roster_id AS rosterId, detail FROM ship_life_events
           WHERE kind = 'battle' AND is_boss = 1 AND practice = 0`,
        )
        .all() as { id: number; rosterId: number; detail: string }[]
      const parseDetail = (raw: string): Record<string, any> => {
        try {
          const parsed = JSON.parse(raw ?? '{}')
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
        } catch (_error) {
          return {}
        }
      }
      const byKey = new Map<string, { id: number; detail: Record<string, any> }>()
      for (const row of events) {
        const detail = parseDetail(row.detail)
        const snapshotId = Number(detail.snapshotId)
        if (!(snapshotId > 0)) continue
        byKey.set(`${snapshotId}:${row.rosterId}`, { id: row.id, detail })
      }
      const update = this.db.prepare(`UPDATE ship_life_events SET detail = ? WHERE id = ?`)
      let written = 0
      let kept = 0 // 已经有归属：重跑时全部落在这里，这一列不为 0 就说明是第二次跑
      let stageDamage = 0 // 航空/支援终结：没有单舰归属，这一迭代不落账
      let noKill = 0 // boss 没沉
      let unmatched = 0 // 算出归属了，但那艘舰的这场 battle 事件已经不在
      let anomalies = 0
      this.runBatch(snapshots.length, () => {
        for (const row of snapshots) {
          let battle: any = null
          try {
            battle = upgradeBattleView(JSON.parse(row.snapshot)?.battle)
          } catch (_error) {
            // 单份快照解不开不该带垮整次回算
            continue
          }
          if (!battle) continue
          const verdict = resolveBossKill(battle.eShips ?? [], battle.attacks ?? [])
          if (!verdict) continue
          for (const anomaly of verdict.anomalies) {
            anomalies++
            console.warn(
              `[kanso] mg: ledger v10 boss 击杀归属异常（快照 ${row.id}）—`,
              bossKillAnomalyText(anomaly),
            )
          }
          if (!verdict.agent) {
            if (!verdict.flagshipSunk) noKill++
            continue
          }
          if (verdict.agent.kind !== 'ship') {
            stageDamage++
            continue
          }
          const index = verdict.agent.index
          const ship = (battle.fShips ?? []).find((item: any) => item?.index === index)
          const rosterId = Number(ship?.rosterId)
          if (!(rosterId > 0)) {
            unmatched++
            continue
          }
          const target = byKey.get(`${row.id}:${rosterId}`)
          if (!target) {
            unmatched++
            continue
          }
          if (target.detail.bossKill != null) {
            kept++ // 已有归属，不重写
            continue
          }
          update.run(
            JSON.stringify({ ...target.detail, bossKill: verdict.flagshipMstId }),
            target.id,
          )
          written++
        }
      })
      console.log(
        `[kanso] mg: ledger v10 — boss 击杀归属回算：快照 ${snapshots.length} 场，` +
          `补写 ${written} 条（已有归属 ${kept} 条不重写，航空/支援终结 ${stageDamage} 场` +
          `没有单舰归属，boss 未沉 ${noKill} 场，对不回事件 ${unmatched} 场，异常 ${anomalies} 条）`,
      )
    } catch (error) {
      console.warn('[kanso] mg: ledger v10 boss kill backfill failed', error)
    }
  }

  /**
   * v11：撤回**本战果月**里那些没有领奖报文撑腰的任务战果合成行。
   *
   * 2026-09-01 用户账本实锤：9 月账凭空多出五笔（quest 284/845/854/872/893，
   * 共 +1460，官方真值 35），其中 854/872 他**从没做过**——events 里一条
   * clearitemget 都没有。它们是旧口径按「已完成」这个**推断**写进来的
   * （出处与新口径见 shared/senka-quest-book）。新口径下这些行根本写不进来，
   * 已经写进来的那几行不会自己消失，所以这里补一刀。
   *
   * **刀口收得很紧**，三条同时成立才删：
   * - `kind='quest'` 且 `ts` **恰等于本战果月起点整值** —— 自动补记的合成行指纹
   *   （实时领奖记的是真实毫秒时刻，压在月界整点上的概率可忽略）；
   * - 只看**本战果月**，历史月份一行不碰（口径与「重算任务战果」按钮一致：
   *   老账里合法的历史行不受影响）；
   * - 本战果月内**查不到该任务的 clearitemget** —— 有证据的那几笔留着，
   *   它们只是入账时刻取了月初，本身是真账。
   *
   * 玩家**手动补记**的行（manual=1）指纹与合成行一样是月初整值，但它是玩家自己
   * 说的账，不归这一刀管——所以刀口第四条：只切 manual 不为 1 的行。
   */
  private revokeUnevidencedQuestSenkaV11 = () => {
    try {
      const now = Date.now()
      const monthStart = senkaMonthStart(now)
      const monthEnd = senkaMonthEnd(now)
      const rows = this.db
        .prepare(
          `SELECT rowid AS id, note, senka FROM senka_log
            WHERE kind = 'quest' AND ts = ? AND (manual IS NULL OR manual != 1)`,
        )
        .all(monthStart) as { id: number; note: string | null; senka: number }[]
      if (!rows.length) return
      const remove = this.db.prepare(`DELETE FROM senka_log WHERE rowid = ?`)
      const revoked: string[] = []
      let kept = 0
      this.runBatch(rows.length, () => {
        for (const row of rows) {
          const questId = Number(row.note) || 0
          if (questId > 0 && this.questClearEvidenceTs(questId, monthStart, monthEnd) != null) {
            kept++
            continue
          }
          remove.run(row.id)
          revoked.push(`${row.note}(+${Number(row.senka) || 0})`)
        }
      })
      if (revoked.length) {
        console.log(
          `[kanso] mg: ledger v11 — 撤回无领奖报文的任务战果 ${revoked.length} 笔：` +
            `${revoked.join('、')}（有报文的 ${kept} 笔留着）`,
        )
      }
    } catch (error) {
      console.warn('[kanso] mg: ledger v11 unevidenced quest senka revoke failed', error)
    }
  }

  /**
   * v12：给既有道具变化回填归因端点。
   *
   * 真窗口由两次 useitem 全量之间的 events 划定：遇到下一次全量时，先用此前累积的
   * 动作解释同一时刻落下的差值，再清空窗口。这样返港全量紧跟 battleresult 时，
   * 负数会跳过只产出奖励的战果，继续认到窗口内真正能消费该道具的动作。
   *
   * 只更新算出 path 的 NULL 行；解释不了的继续留 NULL。已经有 cause 的行不重写，
   * 因此迁移重跑是空操作。
   */
  private backfillUseitemCausesV12 = (): {
    total: number
    resolved: number
    unresolved: number
  } => {
    try {
      const changes = this.db
        .prepare(
          `SELECT rowid AS id, ts, item_id AS itemId, delta
           FROM useitem_log WHERE cause IS NULL ORDER BY ts ASC, rowid ASC`,
        )
        .all() as { id: number; ts: number; itemId: number; delta: number }[]
      if (!changes.length) return { total: 0, resolved: 0, unresolved: 0 }
      const events = this.db
        .prepare(
          `SELECT id, ts, path, post_body AS postBody
           FROM events ORDER BY ts ASC, id ASC`,
        )
        .all() as (UseitemCauseAction & { id: number })[]
      const resolved: { id: number; cause: string }[] = []
      let actions: UseitemCauseAction[] = []
      let hasSyncBoundary = false
      let eventAt = 0
      let changeAt = 0
      while (changeAt < changes.length) {
        const ts = changes[changeAt].ts
        while (eventAt < events.length && events[eventAt].ts < ts) {
          const event = events[eventAt++]
          if (isUseitemFullSyncPath(event.path)) {
            actions = []
            hasSyncBoundary = true
          } else if (hasSyncBoundary) actions.push(event)
        }
        let syncAtThisTs = false
        while (eventAt < events.length && events[eventAt].ts === ts) {
          const event = events[eventAt++]
          if (isUseitemFullSyncPath(event.path)) syncAtThisTs = true
          else actions.push(event)
        }
        while (changeAt < changes.length && changes[changeAt].ts === ts) {
          const change = changes[changeAt++]
          const cause = hasSyncBoundary ? resolveUseitemCause(change, actions) : null
          if (cause) resolved.push({ id: change.id, cause })
        }
        if (syncAtThisTs) {
          actions = []
          hasSyncBoundary = true
        }
      }
      const update = this.db.prepare(
        `UPDATE useitem_log SET cause = ? WHERE rowid = ? AND cause IS NULL`,
      )
      this.runBatch(resolved.length, () => {
        for (const row of resolved) update.run(row.cause, row.id)
      })
      const stats = {
        total: changes.length,
        resolved: resolved.length,
        unresolved: changes.length - resolved.length,
      }
      console.log(
        `[kanso] mg: ledger v12 — 道具归因回算 ${stats.total} 行，` +
          `写回 ${stats.resolved}，暂无对应操作 ${stats.unresolved}`,
      )
      return stats
    } catch (error) {
      console.warn('[kanso] mg: ledger v12 useitem cause backfill failed', error)
      return { total: 0, resolved: 0, unresolved: 0 }
    }
  }

  /**
   * v13：用本期 events 与生产任务引擎重算敌空母击沉任务。
   *
   * 旧 sinkEnemy 只看 hpEnd<=0，会把对潜空袭里 `"N/A"` 落成的后方空母算作击沉。
   * 这里从各任务当前周期起点重放受领/放弃/交付与战斗结算，最终值直接覆盖
   * quest_progress；不拿现值做减法，所以迁移重复执行仍得到同一份账。
   */
  private recomputeCarrierSinkProgressV13 = (): QuestProgressChange[] | null => {
    try {
      const snapshot = this.loadSnapshot('/kcsapi/api_start2/getData')
      const masterRaw = snapshot ? (snapshot.body as any)?.api_data ?? snapshot.body : null
      if (!masterRaw) throw new Error('缺 api_start2 快照')
      const events = this.db
        .prepare(
          `SELECT id, ts, path, body, post_body AS postBody
           FROM events ORDER BY ts ASC, id ASC`,
        )
        .all()
      const battles = this.db
        .prepare(
          `SELECT id, ts, map, cell, snapshot
           FROM battle_snapshots WHERE practice = 0 ORDER BY ts ASC, id ASC`,
        )
        .all()
      const replay = recomputeSinkQuestProgress({
        targetQuestIds: [211, 217, 220],
        events,
        battles,
        now: Date.now(),
        masterRaw,
        getLode,
      })
      if (replay.eligibleQuestIds.join(',') !== '211,217,220') {
        throw new Error(`目标任务规则不符：${replay.eligibleQuestIds.join(',') || '无'}`)
      }
      if (replay.failedQuestIds.length) {
        console.warn(
          `[kanso] mg: ledger v13 — 保留回算失败任务的原进度 quests=${replay.failedQuestIds.join(',')}`,
        )
      }
      const changes = planQuestProgressChanges(this.db, replay)
      overwriteQuestProgress(this.db, changes)
      console.log(
        '[kanso] mg: ledger v13 — 敌空母击沉任务回算：' +
          changes
            .map((change) =>
              `${change.questId} ${change.oldValue}→${change.newValue}` +
              `（${change.diff >= 0 ? '+' : ''}${change.diff}）`,
            )
            .join('，'),
      )
      return changes
    } catch (error) {
      console.warn('[kanso] mg: ledger v13 carrier sink quest replay failed', error)
      return null
    }
  }

  // 任务领域快照曾经只 merge 页面，可能残留幽灵 state=2。
  // 启动时从原始账本中找最近一次“全部/进行中”权威响应重建，不依赖旧 domain.json。
  loadLatestAuthoritativeQuestList = (): {
    ts: number
    body: any
    post: Record<string, string>
  } | null => {
    try {
      const rows = this.db
        .prepare(
          `SELECT ts, body, post_body AS postBody
           FROM events
           WHERE path = '/kcsapi/api_get_member/questlist' AND body IS NOT NULL
           ORDER BY id DESC LIMIT 80`,
        )
        .all() as { ts: number; body: string; postBody: string | null }[]
      for (const row of rows) {
        const post = JSON.parse(row.postBody ?? '{}') as Record<string, string>
        const tab = parseInt(`${post.api_tab_id ?? -1}`, 10)
        if (tab !== 0 && tab !== 9) continue
        const response = JSON.parse(row.body)
        const body = response?.api_data ?? response
        if (Array.isArray(body?.api_list)) return { ts: row.ts, body, post }
      }
    } catch (error) {
      console.warn('[kanso] mg: latest questlist recovery failed', error)
    }
    return null
  }

  // 装备库存恢复：完整列表是基线，之后的领取/开发/废弃是可安全重放的实例增删。
  // post_body 只在内存中解析给归约器，绝不写日志或交给渲染层
  //（凭据入账时已抹为占位，这条纪律仍保留——业务参数也没必要外流）。
  loadLatestSlotitemList = (): { ts: number; body: any } | null => {
    try {
      const row = this.db
        .prepare(
          `SELECT ts, body FROM events
           WHERE path = '/kcsapi/api_get_member/slot_item' AND body IS NOT NULL
           ORDER BY id DESC LIMIT 1`,
        )
        .get() as { ts: number; body: string } | undefined
      if (!row) return null
      const response = JSON.parse(row.body)
      const body = response?.api_data ?? response
      return Array.isArray(body) ? { ts: row.ts, body } : null
    } catch (error) {
      console.warn('[kanso] mg: latest slotitem list recovery failed', error)
      return null
    }
  }

  loadSlotitemMutationsSince = (
    sinceTs: number,
  ): { ts: number; path: string; body: any; post: Record<string, string> }[] => {
    if (!(sinceTs > 0)) return []
    try {
      const rows = this.db
        .prepare(
          `SELECT ts, path, body, post_body AS postBody
           FROM events
           WHERE ts > ? AND body IS NOT NULL
             AND path IN (
               '/kcsapi/api_req_kousyou/getship',
               '/kcsapi/api_req_kousyou/createitem',
               '/kcsapi/api_req_kousyou/destroyitem2',
               '/kcsapi/api_req_kousyou/remodel_slot',
               '/kcsapi/api_req_kousyou/remodel_slot_recover',
               '/kcsapi/api_req_kaisou/lock',
               '/kcsapi/api_req_member/itemuse'
             )
           ORDER BY ts ASC, id ASC`,
        )
        .all(sinceTs) as {
        ts: number
        path: string
        body: string
        postBody: string | null
      }[]
      return rows.flatMap((row) => {
        try {
          const response = JSON.parse(row.body)
          return [{
            ts: row.ts,
            path: row.path,
            body: response?.api_data ?? response,
            post: JSON.parse(row.postBody ?? '{}') as Record<string, string>,
          }]
        } catch (_error) {
          return []
        }
      })
    } catch (error) {
      console.warn('[kanso] mg: slotitem mutation recovery failed', error)
      return []
    }
  }

  /**
   * 各点位的**实得经验**样本，用来把「还差多少经验」换算成「大约几场」。
   *
   * 取的是 fShips[].expGained ——玩家真正拿到手的数，不是 baseExp。
   * 这一步绕开了两件算不准的事：Phase 2 之后基础经验按敌编成走
   * （同一个点不同编成不一样，实测 621-48 四场就是 40~70），
   * 而实得还要再乘评价系数与旗舰/MVP 加成（同场实测 240 / 360 / 480）。
   * 既然快照里躺着结果，就不去重推过程。
   *
   * 只回样本，不回单一均值——加成让同场差两倍，塌缩成一个数会骗人。
   */
  // 一次要解析最近 500 份完整战斗快照（每份数十 KB）——结果缓存住，
  // 只在 logBattleSnapshot 写入新快照时失效
  private expSamplesCache: ExpSampleReport | null = null

  queryExpSamples = (stypeOf?: (mstId: number) => number | null): ExpSampleReport => {
    if (this.expSamplesCache) return this.expSamplesCache
    const rows = this.db
      .prepare(
        `SELECT map, cell, practice, snapshot FROM battle_snapshots ORDER BY ts DESC LIMIT 500`,
      )
      .all() as any[]
    const buckets = new Map<
      string,
      { map: number; cell: number; practice: boolean; base: number[]; flagship: number; tc: number }
    >()
    for (const row of rows) {
      let view: any
      try {
        view = JSON.parse(row.snapshot)
      } catch {
        continue // 坏快照跳过，不让一条脏数据毁掉整份统计
      }
      const battle = view?.battle
      const ships = battle?.fShips
      if (!Array.isArray(ships)) continue
      // mvp / mvpCombined 都是 0 基位置，与 fShips[].index 同一套编号（-1 表示无）
      const mvp = new Set(
        [battle?.result?.mvp, battle?.result?.mvpCombined].filter(
          (value) => typeof value === 'number' && value >= 0,
        ),
      )
      const practice = !!row.practice
      // 演习样本先把**当场**的练巡加成除掉（练巡只影响演习）：桶里存无练巡基线，
      // 系数由显示层按当前编成乘回去——历史样本隐含的旧加成不剔会重复计算。
      // 配置从快照 fShips 自己还原（含逃跑/零经验舰，位序即舰队位序）；
      // 拿不到舰种表（stypeOf 缺席）就不动样本，宁可维持旧口径也不瞎除。
      let tcDivisor = 1
      if (practice && stypeOf) {
        const own = ships
          .filter((ship: any) => ship?.fleet === 'main')
          .sort((a: any, b: any) => a.index - b.index)
          .map((ship: any) => ({ stype: stypeOf(Number(ship?.mstId) || 0), lv: Number(ship?.lv) || 0 }))
        tcDivisor = 1 + trainingCruiserSetup(own).bonusPct / 100
      }
      const key = practice ? 'practice' : `${row.map}-${row.cell}`
      const bucket =
        buckets.get(key) ??
        { map: row.map | 0, cell: row.cell | 0, practice, base: [] as number[], flagship: 0, tc: 0 }
      for (const ship of ships) {
        const gained = ship?.expGained
        // 逃跑/未参战的舰记 0，混进来会把统计拉低
        if (typeof gained !== 'number' || gained <= 0) continue
        const isMvp = mvp.has(ship.index)
        const isFlagship = ship.index === 0
        // 旗舰 ×1.5、MVP ×2 是结构性加成，留在样本里会凭空拉宽区间。
        // 只统计基准位置，换算出来的场次才是「保底要打几场」。
        if (isMvp || isFlagship) {
          if (isFlagship) bucket.flagship += 1
          continue
        }
        bucket.base.push(tcDivisor > 1 ? Math.round(gained / tcDivisor) : gained)
        if (tcDivisor > 1) bucket.tc += 1
      }
      buckets.set(key, bucket)
    }
    const report: ExpSampleReport = []
    for (const [key, bucket] of buckets) {
      if (!bucket.base.length) continue
      const sorted = [...bucket.base].sort((a, b) => a - b)
      const at = (ratio: number) =>
        sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * ratio)))]
      report.push({
        key,
        map: bucket.map,
        cell: bucket.cell,
        practice: bucket.practice,
        samples: sorted.length,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        p25: at(0.25),
        median: at(0.5),
        p75: at(0.75),
        flagshipSamples: bucket.flagship,
        tcNormalized: bucket.tc,
      })
    }
    this.expSamplesCache = report
    return report
  }

  // 建造/开发实测：只把配方与结果聚合后交给渲染层，不泄露 post_body 里的 api_token。
  // 开发一次请求可能批量返回多个 api_get_items，样本数按每个结果计；
  // 建造的配方在 createship、结果在之后的 getship，按同一建造槽依时间顺序配对。
  queryFactoryStats = (
    sinceTs: number,
    secretaryTypeOf?: (mstId: number) => string | null,
  ): FactoryStatsReport => {
    try {
      const raw = this.db
        .prepare(
          `SELECT ts, path, body, post_body AS postBody, secretary_mst AS secretaryMst
           FROM events
           WHERE path IN (
             '/kcsapi/api_req_kousyou/createship',
             '/kcsapi/api_req_kousyou/getship',
             '/kcsapi/api_req_kousyou/createitem'
           )
           ORDER BY ts ASC`,
        )
        .all() as {
        ts: number
        path: string
        body: string | null
        postBody: string | null
        secretaryMst: number | null
      }[]

      return aggregateFactoryStats(raw, sinceTs, secretaryTypeOf)
    } catch (error) {
      console.warn('[kanso] mg: factory stats query failed', error)
      throw error
    }
  }

  // 账本里最早一条事件的时刻——早于它的变动无原因可考（那段已被清理，或早于开始记账那天）
  earliestEventTs = (): number | null => {
    try {
      const r = this.db.prepare('SELECT MIN(ts) AS t FROM events').get() as { t: number | null }
      return r?.t ?? null
    } catch (e) {
      console.warn('[kanso] mg: earliest event query failed', e)
      return null
    }
  }

  // 批量口径：一次取回多件道具的收支合计（锱的战略道具卡用，避免逐件 IPC）
  queryUseitemSummary = (sinceTs: number) => {
    try {
      return this.db
        .prepare(
          `SELECT item_id AS id,
                  SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END) AS gained,
                  SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END) AS spent,
                  COUNT(*) AS changes,
                  MAX(ts) AS lastTs
           FROM useitem_log WHERE ts >= ? GROUP BY item_id`,
        )
        .all(sinceTs) as {
        id: number
        gained: number
        spent: number
        changes: number
        lastTs: number
      }[]
    } catch (e) {
      console.warn('[kanso] mg: useitem summary query failed', e)
      throw e
    }
  }

  queryUseitemHistory = (itemId: number, limit = 60) => {
    try {
      return this.db
        .prepare(
          'SELECT ts, delta, total, cause FROM useitem_log WHERE item_id = ? ORDER BY ts DESC LIMIT ?',
        )
        .all(itemId | 0, limit | 0) as {
        ts: number
        delta: number
        total: number
        cause: string | null
      }[]
    } catch (e) {
      console.warn('[kanso] mg: useitem history query failed', e)
      throw e
    }
  }

  queryRecentUseitemChanges = (limit = 200) => {
    try {
      return this.db
        .prepare(
          `SELECT item_id AS itemId, ts, delta, total, cause
           FROM useitem_log
           ORDER BY ts DESC
           LIMIT ?`,
        )
        .all(Math.max(1, Math.min(1000, limit | 0))) as {
        itemId: number
        ts: number
        delta: number
        total: number
        cause: string | null
      }[]
    } catch (error) {
      console.warn('[kanso] mg: recent useitem changes query failed', error)
      throw error
    }
  }

  /**
   * 提督经验变动 → 一笔通常战果。
   *
   * 只在**确实增加**时记：port 报文每次都带当前值，不去重会把「没变」也记成一笔。
   * 减少不可能发生，真出现就跳过而不是记负数——那多半是换号或读到了脏值。
   */
  logHqExp = (ts: number, experience: number): boolean => {
    try {
      const previous = this.db
        .prepare(`SELECT exp_total FROM senka_state WHERE id = 1`)
        .get() as { exp_total: number } | undefined
      if (previous?.exp_total === experience) return false
      this.db
        .prepare(
          `INSERT INTO senka_state (id, exp_total) VALUES (1, ?)
           ON CONFLICT(id) DO UPDATE SET exp_total = excluded.exp_total`,
        )
        .run(experience)
      if (previous == null) return false // 头一次只记基线，没有「增量」可言
      const delta = experience - previous.exp_total
      if (delta <= 0) return false
      this.db
        .prepare(
          `INSERT INTO senka_log (ts, kind, exp_delta, senka, note) VALUES (?, 'exp', ?, ?, ?)`,
        )
        .run(ts, delta, delta * SENKA_PER_EXP, null)
      return true
    } catch (e) {
      console.warn('[kanso] mg: senka exp log failed', e)
      return false
    }
  }

  /**
   * EO 海域击破 → 一笔特别战果。同一战果月同一海域只记一次。
   *
   * **分值以游戏亲发的为准。** 击破那一刻的 `battleresult` 会带 `api_get_exmap_rate`
   * （本次发放的战果值，账本 3/3 与下面那张表逐个相同），有它就直接用；
   * `shared/senka.ts` 里手维护的 `EO_SENKA` 表退居**兜底**——两种场合还要靠它：
   * 老数据回灌（那时报文字段还没接），以及击破被 mapinfo 观测补记（不在战斗报文上）。
   * 官方哪天调数值，走字段的那条路自己就对了，表不必跟着改。
   *
   * **表的退役条件**：等到「靠表兜底」的两种场合都不再发生——历史回灌跑完、
   * 且补记路径也能拿到游戏值——这张表就可以整个删掉。
   * 在那之前它不能删：`zi.ts` 还拿它当「哪几张图算 EO」的名单（那是另一件事，
   * 与分值无关），删了 EO 缺口那一排就空了。
   *
   * 游戏给了值、而表里根本没有这张图时**照记不误**：那正是新 EO 图刚上线、
   * 表还没人肉跟上的情形，此时游戏比表可信。
   */
  logEoClear = (ts: number, mapId: number, reportedSenka?: number | null): boolean => {
    const senka =
      reportedSenka != null && Number.isInteger(reportedSenka) && reportedSenka > 0
        ? reportedSenka
        : EO_SENKA[mapId]
    if (!senka) return false
    try {
      const monthStart = senkaMonthStart(ts)
      const already = this.db
        .prepare(
          `SELECT 1 FROM senka_log WHERE kind = 'eo' AND note = ? AND ts >= ? LIMIT 1`,
        )
        .get(`${mapId}`, monthStart)
      if (already) return false
      this.db
        .prepare(
          `INSERT INTO senka_log (ts, kind, exp_delta, senka, note) VALUES (?, 'eo', 0, ?, ?)`,
        )
        .run(ts, senka, `${mapId}`)
      return true
    } catch (e) {
      console.warn('[kanso] mg: senka eo log failed', e)
      return false
    }
  }

  /**
   * 任务领取 → 一笔特别战果。**入账时刻就是证据时刻**（观测到 clearitemget 那一刻），
   * 去重按「同任务同周期 ∪ 同战果月」——判据与出处见 shared/senka-quest-book。
   *
   * 调用方必须先拿到证据：实时路径的证据就是手上这一条报文，补记路径的证据要从
   * events 里查（questClearEvidenceTs）。这里不接受「推断出来的已完成」——
   * 2026-09-01 的二次翻车正是推断进了账（884…893 五笔 +1460，两个任务从没做过）。
   */
  logQuestSenka = (
    evidenceTs: number,
    questId: number,
    senka: number,
    period: { kind: QuestPeriodKind | null; annualMonth: number | null },
  ): boolean => {
    if (!(questId > 0) || !(senka > 0)) return false
    try {
      // 一个任务在账里至多几行，全捞出来交给纯判定，SQL 这边不做窗口算术
      const bookedTs = (
        this.db
          .prepare(`SELECT ts FROM senka_log WHERE kind = 'quest' AND note = ?`)
          .all(`${questId}`) as { ts: number }[]
      ).map((row) => Number(row.ts))
      const plan = planQuestSenkaBooking({
        senka,
        kind: period.kind,
        annualMonth: period.annualMonth,
        evidenceTs,
        bookedTs,
      })
      if (!plan.book || plan.ts == null) return false
      this.db
        .prepare(
          `INSERT INTO senka_log (ts, kind, exp_delta, senka, note) VALUES (?, 'quest', 0, ?, ?)`,
        )
        .run(plan.ts, senka, `${questId}`)
      return true
    } catch (e) {
      console.warn('[kanso] mg: senka quest log failed', e)
      return false
    }
  }

  /**
   * 该任务在 `[from, to)` 里**最早**的一次领奖观测（clearitemget 报文的时刻）。
   * 查不到就是 null——「查不到证据」与「没发生」在这里是同一件事：不入账。
   *
   * 只按 path + ts 走索引筛，任务号在 JS 侧解（post_body 是 JSON 串，
   * 拿 SQL 的 LIKE '%api_quest_id=893%' 去凑会连 8931 一起命中）。
   */
  questClearEvidenceTs = (questId: number, from: number, to: number): number | null => {
    if (!(questId > 0)) return null
    try {
      const rows = this.db
        .prepare(
          `SELECT ts, post_body FROM events
           WHERE path LIKE '%/api_req_quest/clearitemget' AND ts >= ? AND ts < ?
           ORDER BY ts ASC`,
        )
        .all(from, to) as { ts: number; post_body: string | null }[]
      for (const row of rows) {
        if (questIdFromClearItemGet(row.post_body) === questId) return Number(row.ts)
      }
      return null
    } catch (e) {
      console.warn('[kanso] mg: senka quest evidence query failed', e)
      return null
    }
  }

  /**
   * 删掉本战果月**自动补记**的任务战果行（玩家按「重算任务战果」时走这里）。
   *
   * **为什么允许删。** 账本的其余部分是报文账——游戏说了什么就记什么，涂改
   * 等于伪造。但自动补记这一族不是报文账：领奖报文里根本没有战果字段
   * （见 logQuestSenka 上游），这些行是 kuma 自己按「本期已完成 + 账里没有」
   * **推断**出来的合成行。推断错了就该收回重算，那不算涂账。
   *
   * **指纹只认合成行**：kind='quest' 且 ts **恰等于**本战果月起点整值。
   * 自动补记入账时间一律取月初（本期最早可能时刻，见 mg:senka-log-quest），
   * 而实时领奖路径记的是真实领奖时刻（毫秒级，压在月界整点上的概率可忽略）。
   * exp / eo / 带真实时间戳的任务行一概不碰，别的月份也不碰。
   *
   * **手动补记行（manual=1）也不碰。** 它的 ts 同样是月初整值，指纹与合成行撞在
   * 一起，但性质相反：合成行是 kuma 推断出来的、玩家没同意过，手动行是玩家自己
   * 加的。这颗按钮的名字是「重算」，重算不该把玩家亲手加的账一起算没了——
   * 要删它走行尾那个删除钮（removeManualQuestSenka）。
   */
  clearAutoBookedQuestSenka = (monthStart: number): number => {
    try {
      const result = this.db
        .prepare(
          `DELETE FROM senka_log
            WHERE kind = 'quest' AND ts = ? AND (manual IS NULL OR manual != 1)`,
        )
        .run(monthStart)
      // 增量扫描的游标要一起作废：不作废的话「有报文证据、本该回来的那几笔」
      // 会被游标挡在已扫过的区段里，撤回之后再也补不回来。
      this.questScanState = null
      return Number(result.changes) || 0
    } catch (e) {
      console.warn('[kanso] mg: senka quest clear failed', e)
      return 0
    }
  }

  /** 该任务在账本里的全部行（数量很小，窗口算术交给纯判定，SQL 这边不做）。 */
  private questSenkaRows = (questId: number): { ts: number; manual: boolean }[] => {
    const rows = this.db
      .prepare(`SELECT ts, manual FROM senka_log WHERE kind = 'quest' AND note = ?`)
      .all(`${questId}`) as { ts: number; manual: number | null }[]
    return rows.map((row) => ({ ts: Number(row.ts), manual: Number(row.manual) === 1 }))
  }

  /**
   * 玩家手动补一笔任务战果（2026-09-01 用户要的权利，出处见 shared/senka-quest-book）。
   * 分值由调用方从主进程自己的 quests-scn 现解，这里不接受渲染层递来的数字。
   */
  addManualQuestSenka = (
    at: number,
    questId: number,
    senka: number,
    period: { kind: QuestPeriodKind | null; annualMonth: number | null },
  ): QuestSenkaBookingReason | 'failed' => {
    if (!(questId > 0)) return 'no-senka'
    try {
      const plan = planManualQuestSenkaBooking({
        senka,
        kind: period.kind,
        annualMonth: period.annualMonth,
        at,
        bookedTs: this.questSenkaRows(questId).map((row) => row.ts),
      })
      if (!plan.book || plan.ts == null) return plan.reason
      this.db
        .prepare(
          `INSERT INTO senka_log (ts, kind, exp_delta, senka, note, manual)
           VALUES (?, 'quest', 0, ?, ?, 1)`,
        )
        .run(plan.ts, senka, `${questId}`)
      return 'booked'
    } catch (e) {
      console.warn('[kanso] mg: senka quest manual add failed', e)
      return 'failed'
    }
  }

  /**
   * 删一条手动补记行。**只允许删手动补记的行**——观测记下的是账，账不许涂改
   *（与 removeManualPayLog 同一条纪律）。
   *
   * 删完要作废补记扫描的游标（与 clearAutoBookedQuestSenka 同一个理由）：手动那一笔
   * 占着周期的坑时，同期到达的真报文被去重挡下、游标却照常走过了它。不作废的话
   * 手动行一删，那条真报文就永远补不回来了。
   */
  removeManualQuestSenka = (id: number): boolean => {
    if (!Number.isInteger(id) || id <= 0) return false
    try {
      const result = this.db
        .prepare(`DELETE FROM senka_log WHERE id = ? AND kind = 'quest' AND manual = 1`)
        .run(id)
      if (Number(result.changes) > 0) this.questScanState = null
      return Number(result.changes) > 0
    } catch (e) {
      console.warn('[kanso] mg: senka quest manual remove failed', e)
      return false
    }
  }

  /**
   * 补记选单要用的「这条任务本期已经有账了吗」。判据与 addManualQuestSenka 共用
   * 同一个去重窗口——选单里标成已记的，按下去也必然被挡；反过来也一样。
   * 返回值区分是哪一种账：`evidence` = 报文观测行，`manual` = 玩家自己补的。
   */
  questSenkaTaken = (
    at: number,
    quests: readonly { id: number; kind: QuestPeriodKind | null; annualMonth: number | null }[],
  ): Record<number, 'evidence' | 'manual'> => {
    const out: Record<number, 'evidence' | 'manual'> = {}
    try {
      for (const quest of quests) {
        const window = questSenkaBookingWindow(quest.kind, at, quest.annualMonth)
        const hit = this.questSenkaRows(quest.id).filter(
          (row) => row.ts >= window.from && row.ts < window.to,
        )
        if (!hit.length) continue
        // 同一窗口里既有观测行又有手动行时报观测行：那才是「账本自己看见的」
        out[quest.id] = hit.some((row) => !row.manual) ? 'evidence' : 'manual'
      }
    } catch (e) {
      console.warn('[kanso] mg: senka quest taken query failed', e)
    }
    return out
  }

  /** 本战果月的逐笔账。记账开始之前的部分这里没有，调用方必须说清楚。 */
  querySenka = (at = Date.now()): SenkaSummary => {
    const monthStart = senkaMonthStart(at)
    // 上界：查当下时它形同虚设，但带 at 查历史月时没有它会把之后所有月都混进来
    const monthEnd = senkaMonthEnd(at)
    const rows = this.db
      .prepare(
        `SELECT id, ts, kind, exp_delta, senka, note, manual FROM senka_log
          WHERE ts >= ? AND ts < ? ORDER BY ts DESC`,
      )
      .all(monthStart, monthEnd) as any[]
    const first = this.db.prepare(`SELECT MIN(ts) t FROM senka_log`).get() as { t: number | null }
    const entries: SenkaEntry[] = rows.map((row) => ({
      id: Number(row.id) || 0,
      ts: row.ts,
      kind: row.kind,
      expDelta: row.exp_delta | 0,
      senka: Number(row.senka) || 0,
      note: `${row.note ?? ''}`,
      manual: Number(row.manual) === 1,
    }))
    const normal = entries.filter((e) => e.kind === 'exp').reduce((sum, e) => sum + e.senka, 0)
    const special = entries.filter((e) => e.kind !== 'exp').reduce((sum, e) => sum + e.senka, 0)
    // 继承（引き継ぎ）：当年经验 ÷50000 + 前月特别 ÷35（公式出处见 shared/senka）。
    // 两个窗口都按账本已记部分算；窗口内一笔都没有就给 null（无从谈继承），
    // 记了但没覆盖整个经验窗口时 complete=false，展示端要说「按记到的部分算，偏低」。
    const carry = (() => {
      try {
        const windows = senkaCarryWindows(at)
        const expRow = this.db
          .prepare(
            `SELECT SUM(exp_delta) s, COUNT(*) n FROM senka_log
             WHERE kind = 'exp' AND ts >= ? AND ts < ?`,
          )
          .get(windows.yearStart, windows.monthStart) as { s: number | null; n: number }
        // 前月特别里**含手动补记行**（2026-09-01 用户点名）：手动行是玩家自己
        // 认下的账，与观测行同等参与下个月的继承。所以这里按 kind 取数，不按
        // manual 过滤——manual 只决定「谁可以删」，不决定「算不算数」。
        const specialRow = this.db
          .prepare(
            `SELECT SUM(senka) s, COUNT(*) n FROM senka_log
             WHERE kind != 'exp' AND ts >= ? AND ts < ?`,
          )
          .get(windows.prevMonthStart, windows.monthStart) as { s: number | null; n: number }
        if (!expRow.n && !specialRow.n) return null
        const fromExp = (expRow.s ?? 0) / CARRY_EXP_DIVISOR
        const fromSpecial = (specialRow.s ?? 0) / CARRY_SPECIAL_DIVISOR
        return {
          total: fromExp + fromSpecial,
          fromExp,
          fromSpecial,
          expWindowFrom: windows.yearStart,
          complete: first?.t != null && first.t <= windows.yearStart,
        }
      } catch (e) {
        console.warn('[kanso] mg: senka carry calc failed', e)
        return null
      }
    })()
    return {
      monthStart,
      recordedFrom: first?.t ?? null,
      normal,
      special,
      carry,
      total: normal + special + (carry?.total ?? 0),
      calibration: null, // 校准值存在 config，由 mg:senka handler 组装
      // 只砍经验行：EO/任务行是「记没记过」的判据，被挤出列表会引发假漏记
      // （2026-08-17 实锤：317 行月账把 8/9 的 EO 顶出 slice(0,300)，自检误报）
      entries: capSenkaEntries(entries),
    }
  }

  // EO 自动对账的增量扫描位置（进程内缓存；跨月自动作废）
  private eoScanState: { monthStart: number; lastEventTs: number } | null = null

  /**
   * EO 击破自动入账（2026-08-17 用户提议「改为自动识别」）：
   * 不再让玩家肉眼确认「是不是本月打的」——账本 events 里存着海域页（mapinfo）
   * 的原始观测，游戏在每月 1 日 05:00 JST 重置 EO 的 cleared 位，所以
   * **重置点之后观测到 cleared=1 就必属本战果月**，可以放心补一笔。
   * 防重复计算：
   * - 与实时战斗路径共用同一道「同月同图只记一次」账本去重；
   * - 入账时间取重置点（本期最早可能时刻）——若玩家之后填过官方校准值，
   *   这笔永远落在校准点之前，不会混进「校准后新增」被二次计入。
   * 本月没有海域页观测的击破（别的设备打的、且本机没开过海域页）自然补不了，
   * 玩家开一次游戏的出击海域页就会产生观测，下次查询自动完成对账。
   */
  autoBookEoFromMapinfo = (at = Date.now()): number[] => {
    try {
      const monthStart = senkaMonthStart(at)
      const monthEnd = senkaMonthEnd(at)
      const resetTs = eoMonthResetTs(monthStart)
      if (this.eoScanState?.monthStart !== monthStart) {
        this.eoScanState = { monthStart, lastEventTs: resetTs - 1 }
      }
      const rows = this.db
        .prepare(
          `SELECT ts, body FROM events
           WHERE path LIKE '%/api_get_member/mapinfo' AND ts > ? AND ts < ?
           ORDER BY ts ASC`,
        )
        .all(this.eoScanState.lastEventTs, monthEnd) as { ts: number; body: string | null }[]
      if (!rows.length) return []
      this.eoScanState.lastEventTs = rows[rows.length - 1].ts
      const observations = rows.flatMap((row) => {
        try {
          const body = JSON.parse(`${row.body}`)
          const list = body?.api_data?.api_map_info ?? body?.api_map_info
          if (!Array.isArray(list)) return []
          return [
            {
              ts: row.ts,
              cleared: list
                .filter((map: any) => Number(map?.api_cleared) === 1)
                .map((map: any) => Number(map?.api_id) || 0),
            },
          ]
        } catch {
          return []
        }
      })
      const booked: number[] = []
      for (const [mapId] of firstEoClearObservations(observations, resetTs, monthEnd)) {
        if (this.logEoClear(resetTs, mapId)) booked.push(mapId)
      }
      return booked
    } catch (e) {
      console.warn('[kanso] mg: senka eo auto-book failed', e)
      return []
    }
  }

  // 任务战果补记的增量扫描位置（进程内缓存；跨月自动作废，撤回时显式作废）
  private questScanState: { monthStart: number; lastEventTs: number } | null = null

  /**
   * 任务战果补记（2026-09-01 重立）：把本战果月里**观测到的每一条 clearitemget**
   * 过一遍，有固定战果分值的就记一笔，入账时刻取报文观测时刻。
   *
   * 这是 EO 侧 `autoBookEoFromMapinfo` 的同款形态——都只认账本里存着的原始观测，
   * 都拿观测时刻当归属依据。与 EO 的差别只在证据长什么样：EO 是海域页的
   * cleared 位，任务是领奖报文。
   *
   * **它补的是什么。** 实时路径（mg/index 收到 clearitemget 当场记）已经覆盖了
   * kuma 开着的绝大多数情形；这里补的是那时没记成的（任务资料包当时没装、
   * 战果记账上线之前的旧报文）。玩家在别的设备交的任务这里补不了——
   * 本机没有那条报文，就是没有证据，宁可不记，由玩家用「实际校准」兜底。
   *
   * `resolve` 给不出分值（不是战果任务 / 资料库没收录）就跳过；同月同期的重复
   * 由 logQuestSenka 的去重挡掉，这里不自己判。
   */
  autoBookQuestSenkaFromEvents = (
    at: number,
    resolve: (
      questId: number,
    ) => { senka: number; kind: QuestPeriodKind | null; annualMonth: number | null } | null,
  ): number[] => {
    try {
      const monthStart = senkaMonthStart(at)
      const monthEnd = senkaMonthEnd(at)
      if (this.questScanState?.monthStart !== monthStart) {
        this.questScanState = { monthStart, lastEventTs: monthStart - 1 }
      }
      const rows = this.db
        .prepare(
          `SELECT ts, post_body FROM events
           WHERE path LIKE '%/api_req_quest/clearitemget' AND ts > ? AND ts < ?
           ORDER BY ts ASC`,
        )
        .all(this.questScanState.lastEventTs, monthEnd) as {
        ts: number
        post_body: string | null
      }[]
      if (!rows.length) return []
      this.questScanState.lastEventTs = Number(rows[rows.length - 1].ts)
      const booked: number[] = []
      for (const row of rows) {
        const questId = questIdFromClearItemGet(row.post_body)
        if (!questId) continue
        const info = resolve(questId)
        if (!info?.senka) continue
        if (this.logQuestSenka(Number(row.ts), questId, info.senka, info)) booked.push(questId)
      }
      return booked
    } catch (e) {
      console.warn('[kanso] mg: senka quest auto-book failed', e)
      return []
    }
  }

  /** 校准之后的账内新增（entries 有 300 条截断，求和必须走 SQL 全量） */
  sumSenkaBetween = (fromTs: number, toTs: number): number => {
    try {
      const row = this.db
        .prepare(`SELECT SUM(senka) s FROM senka_log WHERE ts > ? AND ts < ?`)
        .get(fromTs, toTs) as { s: number | null }
      return Number(row?.s) || 0
    } catch (e) {
      console.warn('[kanso] mg: senka sum failed', e)
      return 0
    }
  }

  logMaterials = (ts: number, m: number[]) => {
    try {
      this.db
        .prepare(
          `INSERT INTO material_log (ts, fuel, ammo, steel, bauxite, fastbuild, bucket, devmat, screw)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(ts, m[0] ?? 0, m[1] ?? 0, m[2] ?? 0, m[3] ?? 0, m[4] ?? 0, m[5] ?? 0, m[6] ?? 0, m[7] ?? 0)
    } catch (e) {
      console.warn('[kanso] mg: material log failed', e)
    }
  }

  // 分类记账：一次资源变动的净增减（8 项），按来源归类
  logDelta = (ts: number, category: string, delta: number[]) => {
    try {
      this.db
        .prepare(
          `INSERT INTO material_delta (ts, category, fuel, ammo, steel, bauxite, fastbuild, bucket, devmat, screw)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(ts, category, delta[0] ?? 0, delta[1] ?? 0, delta[2] ?? 0, delta[3] ?? 0, delta[4] ?? 0, delta[5] ?? 0, delta[6] ?? 0, delta[7] ?? 0)
    } catch (e) {
      console.warn('[kanso] mg: delta log failed', e)
    }
  }

  queryDeltaSummary = (sinceTs: number): { category: string; values: number[] }[] => {
    try {
      const rows = this.db
        .prepare(
          `SELECT category, SUM(fuel) f, SUM(ammo) a, SUM(steel) s, SUM(bauxite) b,
                  SUM(fastbuild) fb, SUM(bucket) bk, SUM(devmat) d, SUM(screw) sc
           FROM material_delta WHERE ts >= ? GROUP BY category`,
        )
        .all(sinceTs)
      return rows.map((r: any) => ({
        category: r.category,
        values: [r.f, r.a, r.s, r.b, r.fb, r.bk, r.d, r.sc].map((v) => v ?? 0),
      }))
    } catch (e) {
      console.warn('[kanso] mg: delta query failed', e)
      throw e
    }
  }

  queryMaterials = (sinceTs: number): { ts: number; values: number[] }[] => {
    try {
      const rows = this.db
        .prepare(
          `SELECT ts, fuel, ammo, steel, bauxite, fastbuild, bucket, devmat, screw
           FROM material_log
           WHERE ts = (SELECT MAX(ts) FROM material_log WHERE ts < ?)
              OR ts >= ?
           ORDER BY ts ASC`,
        )
        .all(sinceTs, sinceTs)
      return rows.map((r: any) => ({
        ts: r.ts,
        values: [r.fuel, r.ammo, r.steel, r.bauxite, r.fastbuild, r.bucket, r.devmat, r.screw],
      }))
    } catch (e) {
      console.warn('[kanso] mg: material query failed', e)
      throw e
    }
  }

  /**
   * 逐日资源快照（史的「每日资源」曲线）。护栏 test/material-daily.test.mjs
   * **原样取出这段 SQL 在临时库上跑**，所以这个常量名与收尾的反引号别乱动。
   *
   * 形状：窗口起点之前（含起点当刻）的最后一条 = 日初基线，此后每个本地自然日
   * 只回**当天最后一条**。史那边按自然日聚合，一年只画 366 个点，
   * 把整年 21 万行搬进渲染层是纯白搬（DatabaseSync 是同步调用，跑在 ipcMain.handle
   * 里就是堵主进程：实测全量 365 天 ≈ 177ms，这一条 ≈ 30ms）。
   *
   * ⚠️ 三个坑，都是写错了不报错的那类：
   * ① `CAST(? AS INTEGER)` 不能去。node:sqlite 把 JS number 绑成 REAL，
   *    `(ts + 参数) / 86400000` 于是变成浮点除，GROUP BY 每行自成一组——
   *    实测 21 万行原样回来 21 万行，一声不吭。
   * ② 日号的换算前提是**时区偏移在整段区间里恒定**（中国/日本无夏令时）。
   *    渲染层的日界是 localDayStart（setHours(0,0,0,0)），有夏令时的时区里
   *    切换那一天两把尺会差一小时——见 shared/local-calendar 的 localDayOffsetMs。
   * ③ `AND ts <= ?`（untilTs）不能去，虽然「账本里有比现在还新的行」听着不可能：
   *    渲染层是先取 `now` 再发 IPC，这中间进一条资源变动，它就成了「今天最后一条」，
   *    而渲染层的最后一格只截到 `now`——那条行谁也算不进去，今天这一格于是塌成 0。
   *    系统时钟往回跳时更是长期如此。全量行那条老路没有这个问题（它把今天的行
   *    一条条喂进去，超出 now 的自然落在格子外）。
   */
  private static readonly DAILY_MATERIALS_SQL = `SELECT ts, fuel, ammo, steel, bauxite, fastbuild, bucket, devmat, screw
           FROM material_log
           WHERE ts = (SELECT MAX(ts) FROM material_log WHERE ts <= ?)
              OR ts IN (SELECT MAX(ts) FROM material_log
                         WHERE ts >= ? AND ts <= ?
                         GROUP BY (ts + CAST(? AS INTEGER)) / 86400000)
           ORDER BY ts ASC`

  /**
   * @param sinceTs 区间第一天的本地 00:00；传 0 = 从账本最早一条起（史的「全部」档）
   * @param untilTs 渲染层取数那一刻（曲线最后一格截在这儿），比它新的行一律不算
   * @returns rows 逐日行（含日初基线那条）；since 这段曲线的第一天 00:00，
   *          渲染层拿它当起点——一条记录都没有时是 null
   */
  queryDailyMaterials = (
    sinceTs: number,
    untilTs: number,
  ): { rows: { ts: number; values: number[] }[]; since: number | null } => {
    try {
      // 「全部」档的起点在这里定，不让渲染层先问一次最早时刻再查一次：
      // 两趟 IPC 之间账本还会动，而起点必须与下面那两个绑定参数是同一个数——
      // 日初基线那一支查的就是「起点当刻及之前的最后一条」，差一点就漏基线。
      let since = sinceTs
      if (!(since > 0)) {
        const earliest = (
          this.db.prepare('SELECT MIN(ts) t FROM material_log WHERE ts <= ?').get(untilTs) as any
        )?.t
        since = typeof earliest === 'number' ? localDayStart(earliest) : 0
      }
      const rows = this.db
        .prepare(Ledger.DAILY_MATERIALS_SQL)
        .all(since, since, untilTs, localDayOffsetMs())
      return {
        rows: rows.map((r: any) => ({
          ts: r.ts,
          values: [r.fuel, r.ammo, r.steel, r.bauxite, r.fastbuild, r.bucket, r.devmat, r.screw],
        })),
        since: since > 0 ? since : null,
      }
    } catch (e) {
      console.warn('[kanso] mg: daily material query failed', e)
      throw e
    }
  }

  // 只要窗口首尾两行的净变化（铎的活动期 Hero 行）。整段 material_log 拉回渲染层
  // 再取两头，活动期动辄几万行全是白搬；照 archiveEvent 的 LIMIT 1 写法各取一头。
  // 窗口口径与 queryMaterials 完全一致：起算点之前的最后一条快照算「期初」，
  // 没有它才用窗口内的第一条——所以两条 SQL 的 WHERE 与那边逐字相同。
  queryMaterialWindow = (
    sinceTs: number,
  ): { first: { ts: number; values: number[] } | null; last: { ts: number; values: number[] } | null } => {
    try {
      const pick = (order: 'ASC' | 'DESC') => {
        const r = this.db
          .prepare(
            `SELECT ts, fuel, ammo, steel, bauxite, fastbuild, bucket, devmat, screw
             FROM material_log
             WHERE ts = (SELECT MAX(ts) FROM material_log WHERE ts < ?)
                OR ts >= ?
             ORDER BY ts ${order} LIMIT 1`,
          )
          .get(sinceTs, sinceTs) as any
        return r
          ? {
              ts: r.ts,
              values: [r.fuel, r.ammo, r.steel, r.bauxite, r.fastbuild, r.bucket, r.devmat, r.screw],
            }
          : null
      }
      return { first: pick('ASC'), last: pick('DESC') }
    } catch (e) {
      console.warn('[kanso] mg: material window query failed', e)
      throw e
    }
  }

  logExpeditionResult = (
    ts: number,
    missionId: number,
    deckId: number,
    body: any,
  ) => {
    if (!(missionId > 0) || !(deckId > 0)) return
    try {
      const clearResult = Number(body?.api_clear_result ?? 0)
      const result: ExpeditionResultKind =
        clearResult === 2 ? 'great' : clearResult === 1 ? 'success' : 'failed'
      const materials = Array.isArray(body?.api_get_material)
        ? body.api_get_material.slice(0, 4).map((value: unknown) => Math.max(0, Number(value) || 0))
        : [0, 0, 0, 0]
      const items = [body?.api_get_item1, body?.api_get_item2]
        .flatMap((item: any) => {
          const id = Number(item?.api_useitem_id ?? item?.api_id ?? 0)
          const count = Number(item?.api_useitem_count ?? item?.api_count ?? 0)
          return id > 0 && count > 0 ? [{ id, count }] : []
        })
      this.db
        .prepare(
          `INSERT INTO expedition_history
             (ts, mission_id, deck_id, result, materials, items)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(ts, missionId, deckId, result, JSON.stringify(materials), JSON.stringify(items))
    } catch (error) {
      console.warn('[kanso] mg: expedition history save failed', error)
    }
  }

  // ---- 本机氪金记录（永久表）----

  recordPayLog = (row: {
    ts: number
    kind: 'buy' | 'use' | 'manual'
    itemId: number
    name: string
    count: number
    price: number | null
    detail: string | null
  }): number | null => {
    try {
      const result = this.db
        .prepare(
          `INSERT INTO pay_log (ts, kind, item_id, name, count, price, detail)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(row.ts, row.kind, row.itemId, row.name, row.count, row.price, row.detail)
      return Number(result.lastInsertRowid)
    } catch (error) {
      console.warn('[kanso] mg: pay log save failed', error)
      return null
    }
  }

  queryPayLog = (limit = 1000): PayLogRow[] => {
    try {
      return this.db
        .prepare(
          `SELECT id, ts, kind, item_id itemId, name, count, price, detail
           FROM pay_log ORDER BY ts DESC, id DESC LIMIT ?`,
        )
        .all(Math.max(1, Math.min(5000, limit))) as unknown as PayLogRow[]
    } catch (error) {
      console.warn('[kanso] mg: pay log query failed', error)
      return []
    }
  }

  // ---- 装备加成的「你的实测」（永久表）----
  //
  // 观察只在「这艘舰此刻正装着它」时算得出来。卸下、升星、改造之后那个读数
  // 就再也拿不回来了，所以看到一次就落一次盘。
  //
  // **升星不覆盖**：★在主键里，★2 那条与★6 那条各占一行。同一 (装备,形态,★,件数)
  // 再观察到时才更新读数与 last_seen（面板会因为改造/近代化改修变，最新的那次为准）。

  recordFitObservations = (rows: readonly FitObservationRecord[]): number => {
    const clean = rows.filter((row) => this.validFitObservation(row))
    if (!clean.length) return 0
    let saved = 0
    try {
      this.runBatch(clean.length, () => {
        const stmt = this.db.prepare(
          `INSERT INTO fit_observations
             (equip_mst, form_id, stars, count, stats, sole, first_seen, last_seen)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(equip_mst, form_id, stars, count) DO UPDATE SET
             stats = excluded.stats,
             sole = excluded.sole,
             last_seen = excluded.last_seen`,
        )
        for (const row of clean) {
          const stars = fitObservationStars(row.stars)
          stmt.run(
            row.equipMstId,
            row.formId,
            stars.join('.'),
            stars.length,
            JSON.stringify(row.stats ?? {}),
            row.sole ? 1 : 0,
            row.seenAt,
            row.seenAt,
          )
          saved += 1
        }
      })
      return saved
    } catch (error) {
      console.warn('[kanso] mg: fit observation save failed', error)
      return 0
    }
  }

  // 落盘前把明显不成立的行挡在外面：观察是账，账里不许出现说不出来源的数。
  private validFitObservation = (row: FitObservationRecord | null | undefined): boolean => {
    if (!row || typeof row !== 'object') return false
    if (!Number.isInteger(row.equipMstId) || row.equipMstId <= 0) return false
    if (!Number.isInteger(row.formId) || row.formId <= 0) return false
    if (!Array.isArray(row.stars) || !row.stars.length || row.stars.length > 5) return false
    if (row.stars.some((star) => !Number.isInteger(star) || star < 0 || star > 10)) return false
    if (!row.stats || typeof row.stats !== 'object') return false
    if (Object.values(row.stats).some((value) => !Number.isFinite(Number(value)))) return false
    // 时刻是毫秒（~1.7e12）；不接受未来的时刻，也不接受游戏上线前的
    if (!Number.isFinite(row.seenAt)) return false
    return row.seenAt >= Date.UTC(2013, 0, 1) && row.seenAt <= Date.now() + 86400_000
  }

  // 读失败**必须抛**（query-failure 那条纪律）：返回空列表会被渲染成
  // 「你从没测过这件」，那是把故障说成事实。
  queryFitObservations = (equipMstId: number): FitObservationRecord[] => {
    if (!Number.isInteger(equipMstId) || equipMstId <= 0) return []
    try {
      const rows = this.db
        .prepare(
          `SELECT form_id formId, stars, count, stats, sole, first_seen firstSeen, last_seen lastSeen
             FROM fit_observations WHERE equip_mst = ?
            ORDER BY last_seen DESC`,
        )
        .all(equipMstId) as unknown as {
        formId: number
        stars: string
        count: number
        stats: string
        sole: number
        firstSeen: number
        lastSeen: number
      }[]
      return rows.map((row) => {
        const stars = `${row.stars}`
          .split('.')
          .filter((one) => one !== '')
          .map((one) => Number(one) || 0)
        // 坏行不兜底成「各项皆 0」——那会被读成一条真实的观察。
        // 解析失败就让它抛到外面去，整段如实报读取失败。
        const stats: Record<string, number> = JSON.parse(row.stats) ?? {}
        return {
          key: `${equipMstId}|${row.formId}|★${stars.join('.')}|x${row.count}`,
          equipMstId,
          formId: row.formId,
          stars,
          count: row.count,
          stats,
          sole: !!row.sole,
          seenAt: row.lastSeen,
          firstSeenAt: row.firstSeen,
        }
      })
    } catch (error) {
      console.warn('[kanso] mg: fit observation query failed', error)
      throw error
    }
  }

  // 只允许删手动补记的行：自动观测的购买/消耗是账，账不许涂改
  removeManualPayLog = (id: number): boolean => {
    try {
      const result = this.db.prepare(`DELETE FROM pay_log WHERE id = ? AND kind = 'manual'`).run(id)
      return Number(result.changes) > 0
    } catch (error) {
      console.warn('[kanso] mg: pay log remove failed', error)
      return false
    }
  }

  queryExpeditionHistory = (missionId: number, limit = 30): ExpeditionHistoryReport => {
    try {
      const summary = this.db
        .prepare(
          `SELECT COUNT(*) total,
                  SUM(CASE WHEN result='success' THEN 1 ELSE 0 END) success,
                  SUM(CASE WHEN result='great' THEN 1 ELSE 0 END) great,
                  SUM(CASE WHEN result='failed' THEN 1 ELSE 0 END) failed,
                  MAX(ts) lastTs
           FROM expedition_history WHERE mission_id=?`,
        )
        .get(missionId) as any
      const rows = this.db
        .prepare(
          `SELECT ts, mission_id missionId, deck_id deckId, result, materials, items
           FROM expedition_history WHERE mission_id=? ORDER BY ts DESC LIMIT ?`,
        )
        .all(missionId, Math.max(1, Math.min(100, limit))) as any[]
      const rewardRows = this.db
        .prepare(
          `SELECT result, materials
           FROM expedition_history
           WHERE mission_id=? AND result IN ('success', 'great')`,
        )
        .all(missionId) as { result: ExpeditionResultKind; materials: string }[]
      const averageMaterials = (
        accepts: (result: ExpeditionResultKind) => boolean,
      ): [number, number, number, number] | null => {
        const sums = [0, 0, 0, 0]
        let count = 0
        for (const row of rewardRows) {
          if (!accepts(row.result)) continue
          try {
            const values = JSON.parse(row.materials)
            if (!Array.isArray(values) || values.length < 4) continue
            for (let index = 0; index < 4; index++) {
              sums[index] += Math.max(0, Number(values[index]) || 0)
            }
            count++
          } catch (_error) {
            /* 单条旧坏记录不影响其余统计 */
          }
        }
        return count
          ? sums.map((value) => Math.round((value / count) * 10) / 10) as [
              number,
              number,
              number,
              number,
            ]
          : null
      }
      // 逐行解析要各自兜住：一条坏 JSON（旧版本写坏的行）不该让整条远征的
      // 履历查询整体失败——上面的 averageMaterials 早就是这个口径，这里补齐。
      const entries: ExpeditionHistoryEntry[] = []
      for (const row of rows) {
        try {
          const materials = JSON.parse(row.materials)
          const items = JSON.parse(row.items)
          if (!Array.isArray(materials) || !Array.isArray(items)) {
            throw new Error('materials/items 不是数组')
          }
          entries.push({
            ts: Number(row.ts),
            missionId: Number(row.missionId),
            deckId: Number(row.deckId),
            result: row.result as ExpeditionResultKind,
            materials,
            items,
          })
        } catch (error) {
          console.warn('[kanso] mg: expedition history row skipped', missionId, row.ts, error)
        }
      }
      return {
        missionId,
        total: Number(summary?.total ?? 0),
        success: Number(summary?.success ?? 0),
        great: Number(summary?.great ?? 0),
        failed: Number(summary?.failed ?? 0),
        lastTs: summary?.lastTs == null ? null : Number(summary.lastTs),
        averageMaterials: {
          successful: averageMaterials(() => true),
          success: averageMaterials((result) => result === 'success'),
          great: averageMaterials((result) => result === 'great'),
        },
        entries,
      }
    } catch (error) {
      console.warn('[kanso] mg: expedition history query failed', error)
      throw error
    }
  }

  logBattleSnapshot = (ts: number, sortie: SortieView): number | null => {
    const battle = sortie.battle
    if (!battle?.result) return null
    try {
      const map = sortie.practice ? 0 : mapIdOf(sortie.mapArea, sortie.mapNo)
      const node = sortie.nodes.find((item) => item.cell === sortie.currentCell)
      const snapshot: SortieView = JSON.parse(JSON.stringify({ ...sortie, active: false }))
      this.db
        .prepare(
          `INSERT INTO battle_snapshots
             (ts, sortie_id, battle_no, map, cell, rank, is_boss, practice, snapshot)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(sortie_id, battle_no, practice) DO UPDATE SET
             ts=excluded.ts, map=excluded.map, cell=excluded.cell, rank=excluded.rank,
             is_boss=excluded.is_boss, snapshot=excluded.snapshot`,
        )
        .run(
          ts,
          sortie.startTs,
          Math.max(1, sortie.battleCount),
          map,
          sortie.currentCell,
          battle.result.rank,
          !sortie.practice && node?.eventId === 5 ? 1 : 0,
          sortie.practice ? 1 : 0,
          JSON.stringify(snapshot),
        )
      const row = this.db
        .prepare(
          `SELECT id FROM battle_snapshots
           WHERE sortie_id=? AND battle_no=? AND practice=?`,
        )
        .get(sortie.startTs, Math.max(1, sortie.battleCount), sortie.practice ? 1 : 0) as
        | { id: number }
        | undefined
      // ⚠️ 这里原先跟着一句「只留最近 500 场」的 DELETE，每存一场就顺手把第 501 场
      // 挤掉。2026-08-23 与日期保留期一并退役：它同样是**系统替玩家决定哪些该忘**，
      // 只是判据从日期换成了条数，而玩家在界面上完全看不到那一场是什么时候没的。
      // 要控体积走两条明路：钥里设保留天数，或按月清（判据在 shared/ledger-retention）。
      this.expSamplesCache = null // 快照集合变了，实得经验统计下次要用时重算
      return row?.id ?? null
    } catch (error) {
      console.warn('[kanso] mg: battle snapshot save failed', error)
      return null
    }
  }

  queryBattleSnapshots = (limit = 40): BattleSnapshotSummary[] => {
    try {
      return (
        this.db
          .prepare(
            `SELECT id, ts, sortie_id AS sortieId, battle_no AS battleNo,
                    map, cell, rank, is_boss AS isBoss, practice
             FROM battle_snapshots ORDER BY ts DESC LIMIT ?`,
          )
          .all(Math.max(1, Math.min(500, limit | 0))) as any[]
      ).map((row) => ({
        id: Number(row.id),
        ts: Number(row.ts),
        sortieId: Number(row.sortieId),
        battleNo: Number(row.battleNo),
        map: Number(row.map),
        cell: Number(row.cell),
        rank: row.rank == null ? null : `${row.rank}`,
        isBoss: row.isBoss === 1,
        practice: row.practice === 1,
      }))
    } catch (error) {
      console.warn('[kanso] mg: battle snapshot list failed', error)
      throw error
    }
  }

  queryBattleRun = (sortieId: number): BattleSnapshotSummary[] => {
    try {
      return (
        this.db
          .prepare(
            `SELECT id, ts, sortie_id AS sortieId, battle_no AS battleNo,
                    map, cell, rank, is_boss AS isBoss, practice
             FROM battle_snapshots
             WHERE sortie_id=?
             ORDER BY ts ASC, battle_no ASC, id ASC`,
          )
          .all(sortieId) as any[]
      ).map((row) => ({
        id: Number(row.id),
        ts: Number(row.ts),
        sortieId: Number(row.sortieId),
        battleNo: Number(row.battleNo),
        map: Number(row.map),
        cell: Number(row.cell),
        rank: row.rank == null ? null : `${row.rank}`,
        isBoss: row.isBoss === 1,
        practice: row.practice === 1,
      }))
    } catch (error) {
      console.warn('[kanso] mg: battle run snapshot list failed', error)
      throw error
    }
  }

  queryBattleSnapshot = (id: number): BattleSnapshot | null => {
    try {
      const row = this.db
        .prepare(
          `SELECT id, ts, sortie_id AS sortieId, battle_no AS battleNo,
                  map, cell, rank, is_boss AS isBoss, practice, snapshot
           FROM battle_snapshots WHERE id=?`,
        )
        .get(id) as any
      if (!row) return null
      const sortie = JSON.parse(row.snapshot) as SortieView
      // 快照是整场 BattleView 的原样落盘，字段随版本变过（有序阶段/友军/双 MVP…）。
      // 落盘 domain 的回灌路径在 store.ts 已经过升级器，这条读取路径此前没有，
      // 于是旧格式快照一点开就在渲染层抛。升级器是幂等的，新快照原样返回。
      // ⚠️ 这条升级器链**永远删不掉**：保留期退役之后（2026-08-23），
      // 账本里的快照不再随时间自己消失，任何一个历史格式都可能在明年被点开。
      // 「等旧格式过了保留期就没人有了」这个前提已经不成立。
      if (sortie.battle) sortie.battle = upgradeBattleView(sortie.battle)
      return {
        id: Number(row.id),
        ts: Number(row.ts),
        sortieId: Number(row.sortieId),
        battleNo: Number(row.battleNo),
        map: Number(row.map),
        cell: Number(row.cell),
        rank: row.rank == null ? null : `${row.rank}`,
        isBoss: row.isBoss === 1,
        practice: row.practice === 1,
        sortie,
        discrepancies: sortie.battle?.discrepancies ?? [],
      }
    } catch (error) {
      console.warn('[kanso] mg: battle snapshot read failed', error)
      throw error
    }
  }

  // ---- 在籍舰人生记录（永久表）----

  loadShipLifeState = (): Map<number, ShipLifeStateRow> => {
    const result = new Map<number, ShipLifeStateRow>()
    try {
      const rows = this.db
        .prepare(
          `SELECT roster_id AS rosterId, mst_id AS mstId, level, exp_total AS expTotal,
                  equipment, first_seen AS firstSeen, last_seen AS lastSeen
           FROM ship_life_state`,
        )
        .all()
      for (const row of rows as any[]) {
        let equipment: ShipLifeEquipment[] = []
        try {
          const parsed = JSON.parse(row.equipment)
          if (Array.isArray(parsed)) equipment = parsed
        } catch (_e) {
          /* 坏基线按空装备处理，下一次同步会纠正 */
        }
        result.set(Number(row.rosterId), {
          rosterId: Number(row.rosterId),
          mstId: Number(row.mstId),
          level: Number(row.level),
          expTotal: Number(row.expTotal),
          equipment,
          firstSeen: Number(row.firstSeen),
          lastSeen: Number(row.lastSeen),
        })
      }
    } catch (e) {
      console.warn('[kanso] mg: ship life state load failed', e)
    }
    return result
  }

  saveShipLifeStates = (states: ShipLifeStateRow[]) => {
    if (!states.length) return
    try {
      const stmt = this.db.prepare(
        `INSERT INTO ship_life_state
           (roster_id, mst_id, level, exp_total, equipment, first_seen, last_seen)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(roster_id) DO UPDATE SET
           mst_id = excluded.mst_id,
           level = excluded.level,
           exp_total = excluded.exp_total,
           equipment = excluded.equipment,
           last_seen = excluded.last_seen`,
      )
      this.runBatch(states.length, () => {
        for (const state of states) {
          stmt.run(
            state.rosterId,
            state.mstId,
            state.level,
            state.expTotal,
            JSON.stringify(state.equipment),
            state.firstSeen,
            state.lastSeen,
          )
        }
      })
    } catch (e) {
      console.warn('[kanso] mg: ship life state save failed', e)
    }
  }

  logShipLifeEvents = (events: ShipLifeEventInput[]) => {
    if (!events.length) return
    try {
      const stmt = this.db.prepare(
        `INSERT OR IGNORE INTO ship_life_events
           (ts, roster_id, mst_id, kind, exp_delta, map, cell, rank,
            is_boss, practice, mvp, damage_taken, taiha, damage_dealt, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      this.runBatch(events.length, () => {
        for (const event of events) {
          stmt.run(
            event.ts,
            event.rosterId,
            event.mstId,
            event.kind,
            event.expDelta ?? 0,
            event.map ?? null,
            event.cell ?? null,
            event.rank ?? null,
            event.isBoss ? 1 : 0,
            event.practice ? 1 : 0,
            event.mvp ? 1 : 0,
            // 只有 battle 事件带这两项；其余事件保持 NULL，聚合时也只数 battle
            event.damageTaken ?? null,
            event.taiha == null ? null : event.taiha ? 1 : 0,
            event.damageDealt ?? null,
            JSON.stringify(event.detail ?? {}),
          )
        }
      })
    } catch (e) {
      console.warn('[kanso] mg: ship life event log failed', e)
    }
  }

  queryShipLife = (rosterId: number, limit = 80): ShipLifeReport => {
    try {
      const state = this.db
        .prepare(
          `SELECT first_seen AS firstSeen, last_seen AS lastSeen
           FROM ship_life_state WHERE roster_id = ?`,
        )
        .get(rosterId) as { firstSeen: number; lastSeen: number } | undefined
      const stats = this.db
        .prepare(
          `SELECT
             COALESCE(SUM(exp_delta), 0) AS expGained,
             SUM(CASE WHEN kind = 'sortie' THEN 1 ELSE 0 END) AS sorties,
             SUM(CASE WHEN kind = 'battle' AND practice = 0 THEN 1 ELSE 0 END) AS battles,
             SUM(CASE WHEN kind = 'battle' AND practice = 0
                       AND rank IN ('S', 'A', 'B') THEN 1 ELSE 0 END) AS wins,
             SUM(CASE WHEN kind = 'battle' AND practice = 1 THEN 1 ELSE 0 END) AS practiceBattles,
             SUM(CASE WHEN kind = 'battle' AND practice = 1
                       AND rank IN ('S', 'A', 'B') THEN 1 ELSE 0 END) AS practiceWins,
             SUM(CASE WHEN kind = 'battle' AND is_boss = 1 THEN 1 ELSE 0 END) AS bossBattles,
             SUM(CASE WHEN kind = 'battle' AND mvp = 1 THEN 1 ELSE 0 END) AS mvps,
             SUM(CASE WHEN kind = 'remodel' THEN 1 ELSE 0 END) AS remodels,
             -- 伤害三项只统计确实记了这几列的场次。老记录是 NULL——
             -- 它们说不出这一战打出/挨了多少，补 0 就等于替它们断言「没挨打、没输出」。
             -- 三列同一句写入，所以缺任一列都当整场不可知。
             COALESCE(SUM(damage_taken), 0) AS damageTaken,
             COALESCE(SUM(taiha), 0) AS taihaCount,
             COALESCE(SUM(damage_dealt), 0) AS damageDealt,
             MIN(CASE WHEN kind = 'battle' AND damage_taken IS NOT NULL
                       AND damage_dealt IS NOT NULL THEN ts END)
               AS damageTrackedFrom,
             SUM(CASE WHEN kind = 'battle'
                       AND (damage_taken IS NULL OR damage_dealt IS NULL)
                      THEN 1 ELSE 0 END)
               AS damageUnknownBattles
           FROM ship_life_events WHERE roster_id = ?`,
        )
        .get(rosterId) as any
      const rows = this.db
        .prepare(
          `SELECT id, ts, kind, exp_delta AS expDelta, map, cell, rank,
                  is_boss AS isBoss, practice, mvp, detail
           FROM ship_life_events
           WHERE roster_id = ? ORDER BY ts DESC, id DESC LIMIT ?`,
        )
        .all(rosterId, Math.max(1, Math.min(200, limit | 0))) as any[]
      const battles = Number(stats?.battles ?? 0)
      const wins = Number(stats?.wins ?? 0)
      const practiceBattles = Number(stats?.practiceBattles ?? 0)
      const practiceWins = Number(stats?.practiceWins ?? 0)
      const events: ShipLifeEvent[] = rows.map((row) => {
        let detail: Record<string, any> = {}
        try {
          const parsed = JSON.parse(row.detail)
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) detail = parsed
        } catch (_e) {
          /* 坏事件仍保留主字段 */
        }
        return {
          id: Number(row.id),
          ts: Number(row.ts),
          kind: row.kind as ShipLifeEventKind,
          expDelta: Number(row.expDelta ?? 0),
          map: row.map == null ? null : Number(row.map),
          cell: row.cell == null ? null : Number(row.cell),
          rank: row.rank == null ? null : `${row.rank}`,
          isBoss: row.isBoss === 1,
          practice: row.practice === 1,
          mvp: row.mvp === 1,
          detail,
        }
      })
      return {
        rosterId,
        trackingSince: state ? Number(state.firstSeen) : null,
        lastSeen: state ? Number(state.lastSeen) : null,
        expGained: Number(stats?.expGained ?? 0),
        sorties: Number(stats?.sorties ?? 0),
        battles,
        wins,
        winRate: battles > 0 ? wins / battles : null,
        practiceBattles,
        practiceWins,
        practiceWinRate: practiceBattles > 0 ? practiceWins / practiceBattles : null,
        bossBattles: Number(stats?.bossBattles ?? 0),
        mvps: Number(stats?.mvps ?? 0),
        remodels: Number(stats?.remodels ?? 0),
        damageTaken: Number(stats?.damageTaken ?? 0),
        damageDealt: Number(stats?.damageDealt ?? 0),
        taihaCount: Number(stats?.taihaCount ?? 0),
        damageTrackedFrom:
          stats?.damageTrackedFrom == null ? null : Number(stats.damageTrackedFrom),
        damageUnknownBattles: Number(stats?.damageUnknownBattles ?? 0),
        events,
      }
    } catch (e) {
      console.warn('[kanso] mg: ship life query failed', e)
      throw e
    }
  }

  /**
   * 这一艘给谁送过终。
   *
   * 归属写在 battle 事件的 `detail.bossKill` 里（值 = 敌旗舰 mstId），没有单独的
   * 事件种类，也没有新表——「谁终结了这场 boss」本来就是那一场战斗记录的一个属性。
   * 航空/支援终结的那几场没有单舰归属，任何一艘都查不到，这是如实缺席。
   *
   * 按时间倒序（最近的在前）。detail 的解析失败当作没有这一列，不让一条坏 JSON
   * 带垮整次查询。
   */
  queryBossKills = (rosterId: number, limit = 200): ShipBossKillEntry[] => {
    try {
      const rows = this.db
        .prepare(
          `SELECT id, ts, map, cell, rank, detail FROM ship_life_events
           WHERE roster_id = ? AND kind = 'battle' AND is_boss = 1 AND practice = 0
           ORDER BY ts DESC, id DESC`,
        )
        .all(rosterId) as any[]
      const out: ShipBossKillEntry[] = []
      for (const row of rows) {
        let detail: Record<string, any> = {}
        try {
          const parsed = JSON.parse(row.detail)
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) detail = parsed
        } catch (_e) {
          continue
        }
        const bossMstId = Number(detail.bossKill)
        if (!(bossMstId > 0)) continue
        const snapshotId = Number(detail.snapshotId)
        out.push({
          eventId: Number(row.id),
          ts: Number(row.ts),
          map: row.map == null ? null : Number(row.map),
          cell: row.cell == null ? null : Number(row.cell),
          rank: row.rank == null ? null : `${row.rank}`,
          bossMstId,
          snapshotId: snapshotId > 0 ? snapshotId : null,
        })
        if (out.length >= Math.max(1, Math.min(500, limit | 0))) break
      }
      return out
    } catch (e) {
      console.warn('[kanso] mg: boss kill query failed', e)
      throw e
    }
  }

  private departedLifeCache = new Map<number, ShipLifeReport>()

  queryShipMemorial = (rawMstIds: number[]): ShipMemorialReport => {
    const mstIds = [...new Set(rawMstIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))]
      .slice(0, 64)
    const empty = (): ShipMemorialReport => ({ scrapped: 0, materials: 0, sunk: 0, entries: [] })
    if (!mstIds.length) return empty()
    try {
      const placeholders = mstIds.map(() => '?').join(',')
      const rows = this.db
        .prepare(
          `SELECT e.roster_id AS rosterId, e.mst_id AS mstId, e.kind AS reason,
                  e.ts AS departedTs, s.level
           FROM ship_life_events e
           LEFT JOIN ship_life_state s ON s.roster_id = e.roster_id
           WHERE e.kind IN ('scrap', 'material', 'sunk')
             AND e.mst_id IN (${placeholders})
           ORDER BY e.ts DESC`,
        )
        .all(...mstIds) as any[]
      // 离籍舰的人生记录不会再变（终结事件之后没有新事件）：按 rosterId 缓存，
      // 免得图鉴每次代号推进都对每艘离籍舰重跑 3 条查询（N+1）
      const lifeOf = (rosterId: number) => {
        const cached = this.departedLifeCache.get(rosterId)
        if (cached) return cached
        const life = this.queryShipLife(rosterId, 120)
        this.departedLifeCache.set(rosterId, life)
        return life
      }
      const entries: ShipMemorialEntry[] = rows.map((row) => ({
        rosterId: Number(row.rosterId),
        mstId: Number(row.mstId),
        reason: row.reason,
        departedTs: Number(row.departedTs),
        level: Number(row.level ?? 0),
        life: lifeOf(Number(row.rosterId)),
      }))
      return {
        scrapped: entries.filter((entry) => entry.reason === 'scrap').length,
        materials: entries.filter((entry) => entry.reason === 'material').length,
        sunk: entries.filter((entry) => entry.reason === 'sunk').length,
        entries,
      }
    } catch (e) {
      console.warn('[kanso] mg: ship memorial query failed', e)
      throw e
    }
  }

  // ---- 任务精确计数（钦）----

  loadQuestProgress = (): Record<number, { counts: number[]; updated: number }> => {
    try {
      const rows = this.db.prepare('SELECT quest_id, counts, updated FROM quest_progress').all()
      const map: Record<number, { counts: number[]; updated: number }> = {}
      for (const r of rows) {
        try {
          const counts = JSON.parse(r.counts)
          if (Array.isArray(counts) && counts.every((n) => typeof n === 'number' && Number.isFinite(n))) {
            map[r.quest_id] = { counts, updated: Number(r.updated) || 0 }
          }
        } catch (_e) {
          /* 坏行忽略 */
        }
      }
      return map
    } catch (e) {
      console.warn('[kanso] mg: quest progress load failed', e)
      return {}
    }
  }

  saveQuestProgress = (questId: number, counts: number[]) => {
    try {
      this.db
        .prepare(
          'INSERT INTO quest_progress (quest_id, counts, updated) VALUES (?, ?, ?) ON CONFLICT(quest_id) DO UPDATE SET counts = excluded.counts, updated = excluded.updated',
        )
        .run(questId, JSON.stringify(counts), Date.now())
    } catch (e) {
      console.warn('[kanso] mg: quest progress save failed', e)
    }
  }

  deleteQuestProgress = (questId: number) => {
    try {
      this.db.prepare('DELETE FROM quest_progress WHERE quest_id = ?').run(questId)
    } catch (e) {
      console.warn('[kanso] mg: quest progress delete failed', e)
    }
  }

  // ---- 遭遇志（本地反哺）----

  logEncounter = (
    ts: number,
    map: number,
    cell: number,
    isBoss: boolean,
    formation: number,
    comp: number[],
    rank: string | null,
    dropMst: number | null,
    sunkMask: number | null, // comp 第 i 位是否被击沉的位掩码；null = 老记录未记
    difficulty: number | null = null, // 活动难度；常规海域与老记录为 null
  ) => {
    try {
      this.db
        .prepare(
          'INSERT INTO encounters (ts, map, cell, is_boss, formation, comp, rank, drop_mst, sunk_mask, difficulty) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          ts, map, cell, isBoss ? 1 : 0, formation, JSON.stringify(comp), rank, dropMst,
          sunkMask, difficulty,
        )
    } catch (e) {
      console.warn('[kanso] mg: encounter log failed', e)
    }
    // 索引已建好时就地并入这一条，省得每次结算都重扫全表。
    if (this.firstEncounters) {
      foldFirstEncounter(this.firstEncounters, { ts, map, cell, isBoss, comp, dropMst, sunkMask })
    }
    this.foldAbyssCaches(comp, map, cell, sunkMask)
  }

  // 深海遭遇/击沉两份聚合的增量维护（与 firstEncounters 同一套路：懒建 + 逐条并入）。
  // encounters 是只增不改的永久表，几年后是数万行——没有缓存时每次 IPC 都全表
  // 扫描 + 逐行 JSON.parse。缓存只在本进程内部消费，调用方不得就地改它。
  // 三层：舰 → 图 → 点位 → 次数。点位那一层 2026-08-25 加的（在此之前只到图级）。
  // 归并口径在 shared/abyss-seen（全量重扫与增量并入共用一份，护栏对着它跑）。
  private abyssSeenCache: AbyssSeenCache | null = null
  private abyssKillCache: Map<number, { met: number; killed: number; withMask: number }> | null =
    null

  private foldAbyssCaches = (
    comp: number[],
    map: number,
    cell: number,
    sunkMask: number | null,
  ) => {
    if (this.abyssSeenCache) foldAbyssSeen(this.abyssSeenCache, comp, map, cell)
    if (this.abyssKillCache) {
      for (const [i, id] of comp.entries()) {
        if (!(id > 0)) continue
        const entry = this.abyssKillCache.get(id) ?? { met: 0, killed: 0, withMask: 0 }
        entry.met++
        if (sunkMask != null) {
          entry.withMask++
          if (sunkMask & (1 << i)) entry.killed++
        }
        this.abyssKillCache.set(id, entry)
      }
    }
  }

  // ---- 首见志（本地账本内的「第一次」）----
  //
  // encounters 不在任何清理范围内（永久表），所以这里算出的「最早一条」不会因为清账本而漂移。
  // 掉落侧一条 SQL 就能分组，但击沉侧是 comp 数组 + sunk_mask 位掩码，必须逐行展开——
  // 于是整份索引懒加载一次后常驻内存，由 logEncounter 增量维护。
  // 折叠口径本身在 shared/first-encounter，与渲染层共用一份。
  private firstEncounters: FirstEncounterIndex | null = null

  private buildFirstEncounters = (): FirstEncounterIndex => {
    const index = emptyFirstEncounterIndex()
    try {
      const rows = this.db
        .prepare(
          `SELECT ts, map, cell, is_boss isBoss, comp, drop_mst dropMst, sunk_mask sunkMask
           FROM encounters ORDER BY ts ASC`,
        )
        .all() as any[]
      for (const row of rows) {
        let comp: unknown = []
        try {
          comp = JSON.parse(row.comp)
        } catch (_error) {
          comp = []
        }
        foldFirstEncounter(index, {
          ts: Number(row.ts),
          map: Number(row.map) || 0,
          cell: Number(row.cell) || 0,
          isBoss: row.isBoss === 1,
          comp: Array.isArray(comp) ? comp.map(Number) : [],
          dropMst: row.dropMst == null ? null : Number(row.dropMst),
          sunkMask: row.sunkMask == null ? null : Number(row.sunkMask),
        })
      }
    } catch (error) {
      console.warn('[kanso] mg: first encounter index build failed', error)
    }
    return index
  }

  queryFirstEncounters = (): FirstEncounterIndex => {
    if (!this.firstEncounters) this.firstEncounters = this.buildFirstEncounters()
    const index = this.firstEncounters
    return {
      drops: { ...index.drops },
      kills: { ...index.kills },
      dropsFrom: index.dropsFrom,
      killsFrom: index.killsFrom,
      metSince: { ...index.metSince },
    }
  }

  // ---- 活动海域主数据与统计归档 ----

  observeEventMapCatalog = (
    areaId: number,
    areaName: string,
    opened: number,
    observedAt: number,
    rawMaps: any[],
  ) => {
    try {
      const maps = rawMaps
        .filter((map) => Number(map?.api_maparea_id) === areaId)
        .slice(0, 20)
        .map((map) => ({
          api_id: Number(map.api_id) || areaId * 10 + (Number(map.api_no) || 0),
          api_maparea_id: areaId,
          api_no: Number(map.api_no) || 0,
          api_name: `${map.api_name ?? `${areaId}-${map.api_no ?? '?'}`}`.slice(0, 200),
          api_level: Number(map.api_level) || 0,
          api_required_defeat_count: Number(map.api_required_defeat_count) || 0,
          api_max_maphp: Number(map.api_max_maphp) || 0,
        }))
        .filter((map) => map.api_id > 0 && map.api_no > 0)
      if (!maps.length) return
      this.db
        .prepare(
          `INSERT INTO event_map_catalog
             (area_id, area_name, opened, last_seen, closed_ts, maps)
           VALUES (?, ?, ?, ?, NULL, ?)
           ON CONFLICT(area_id) DO UPDATE SET
             area_name=excluded.area_name,
             last_seen=excluded.last_seen,
             closed_ts=NULL,
             maps=excluded.maps`,
        )
        .run(
          areaId,
          `${areaName || `活动海域 ${areaId}`}`.slice(0, 200),
          opened,
          observedAt,
          JSON.stringify(maps),
        )
    } catch (error) {
      console.warn('[kanso] mg: event map catalog save failed', error)
    }
  }

  closeEventMapCatalog = (areaId: number, closedAt: number) => {
    try {
      this.db
        .prepare(
          `UPDATE event_map_catalog
           SET last_seen=?, closed_ts=?
           WHERE area_id=?`,
        )
        .run(closedAt, closedAt, areaId)
    } catch (error) {
      console.warn('[kanso] mg: event map catalog close failed', error)
    }
  }

  // ---- 活动归档 ----
  //
  // 为什么必须在活动关闭那一刻结账：events 与 material_log 是可清理的滚动表，
  // 活动持续约一个月，关闭时数据还齐；等三个月后再想算就永远算不回来了。
  // 归档表本身是永久表（同遭遇志），一个活动一行。
  //
  // 口径边界写进结果里：资源/收支来自滚动表，那段若已被清理会缺头；
  // 击沉数只覆盖 sunk_mask 上线之后的记录。UI 照实展示，不补零当真值。
  archiveEvent = (areaId: number, opened: number, closed: number) => {
    try {
      const lo = areaId * 10
      const hi = areaId * 10 + 9
      const inWin = 'ts >= ? AND ts <= ?'
      const q = (sql: string, ...args: any[]) => this.db.prepare(sql).get(...args) as any
      const all = (sql: string, ...args: any[]) => this.db.prepare(sql).all(...args) as any[]

      const sorties = q(
        `SELECT COUNT(*) n FROM routes WHERE map BETWEEN ? AND ? AND from_cell = -1 AND ${inWin}`,
        lo, hi, opened, closed,
      )?.n ?? 0
      const sortiesByMap = all(
        `SELECT map, COUNT(*) n FROM routes
         WHERE map BETWEEN ? AND ? AND from_cell = -1 AND ${inWin}
         GROUP BY map ORDER BY map`,
        lo, hi, opened, closed,
      )
      const battles = all(
        `SELECT COUNT(*) n, SUM(is_boss) bosses,
                SUM(CASE WHEN sunk_mask IS NOT NULL THEN 1 ELSE 0 END) withMask
         FROM encounters WHERE map BETWEEN ? AND ? AND ${inWin}`,
        lo, hi, opened, closed,
      )[0] ?? {}
      const drops = all(
        `SELECT drop_mst id, COUNT(*) n FROM encounters
         WHERE map BETWEEN ? AND ? AND ${inWin} AND drop_mst IS NOT NULL
         GROUP BY drop_mst ORDER BY n DESC`,
        lo, hi, opened, closed,
      )
      const perMap = all(
        `SELECT map, COUNT(*) n, SUM(is_boss) bosses FROM encounters
         WHERE map BETWEEN ? AND ? AND ${inWin} GROUP BY map ORDER BY map`,
        lo, hi, opened, closed,
      )
      const dropsByMap = all(
        `SELECT map, drop_mst id, COUNT(*) n FROM encounters
         WHERE map BETWEEN ? AND ? AND ${inWin} AND drop_mst IS NOT NULL
         GROUP BY map, drop_mst ORDER BY map, n DESC`,
        lo, hi, opened, closed,
      )
      const sortieCostRows = all(
        `SELECT map,
                SUM(CASE WHEN fuel_cost IS NOT NULL AND ammo_cost IS NOT NULL THEN 1 ELSE 0 END) sorties,
                SUM(CASE WHEN fuel_cost IS NULL OR ammo_cost IS NULL THEN 1 ELSE 0 END) skipped,
                COALESCE(SUM(fuel_cost), 0) fuel,
                COALESCE(SUM(ammo_cost), 0) ammo
         FROM sortie_samples
         WHERE map BETWEEN ? AND ? AND start_ts >= ? AND start_ts <= ? AND completed = 1
         GROUP BY map ORDER BY map`,
        lo, hi, opened, closed,
      )
      const sortieCostMaps = sortieCostRows
        .filter((row) => Number(row.sorties) > 0)
        .map((row) => ({
          map: Number(row.map),
          sorties: Number(row.sorties),
          fuel: Number(row.fuel),
          ammo: Number(row.ammo),
        }))
      const sortieCosts = {
        sorties: sortieCostMaps.reduce((sum, row) => sum + row.sorties, 0),
        skipped: sortieCostRows.reduce((sum, row) => sum + Number(row.skipped), 0),
        fuel: sortieCostMaps.reduce((sum, row) => sum + row.fuel, 0),
        ammo: sortieCostMaps.reduce((sum, row) => sum + row.ammo, 0),
        maps: sortieCostMaps,
      }
      // 击沉艘数：逐条按位数，SQL 里数位不方便，取回来在 JS 里数
      let killed = 0
      for (const r of all(
        `SELECT sunk_mask m FROM encounters WHERE map BETWEEN ? AND ? AND ${inWin} AND sunk_mask IS NOT NULL`,
        lo, hi, opened, closed,
      )) {
        for (let b = r.m; b; b >>= 1) killed += b & 1
      }
      // 资源：窗口内首尾快照之差（material_log 可被清理，缺头会如实标出）
      const first = q(`SELECT * FROM material_log WHERE ${inWin} ORDER BY ts ASC LIMIT 1`, opened, closed)
      const last = q(`SELECT * FROM material_log WHERE ${inWin} ORDER BY ts DESC LIMIT 1`, opened, closed)
      const RES = ['fuel', 'ammo', 'steel', 'bauxite', 'fastbuild', 'bucket', 'devmat', 'screw']
      const resNet = first && last ? RES.map((k) => (last[k] ?? 0) - (first[k] ?? 0)) : null
      const deltas = all(
        `SELECT category, SUM(fuel) fuel, SUM(ammo) ammo, SUM(steel) steel, SUM(bauxite) bauxite,
                SUM(fastbuild) fastbuild, SUM(bucket) bucket, SUM(devmat) devmat, SUM(screw) screw
         FROM material_delta WHERE ${inWin} GROUP BY category`,
        opened, closed,
      )
      const useitems = all(
        `SELECT item_id id, SUM(CASE WHEN delta>0 THEN delta ELSE 0 END) gained,
                SUM(CASE WHEN delta<0 THEN -delta ELSE 0 END) spent
         FROM useitem_log WHERE ${inWin} GROUP BY item_id`,
        opened, closed,
      )
      // 资源账本是否覆盖了整个活动期（滚动清理可能已吃掉开头）
      const oldestMat = q('SELECT MIN(ts) t FROM material_log')?.t ?? null
      const stats = {
        sorties,
        battles: battles.n ?? 0,
        bosses: battles.bosses ?? 0,
        battlesWithSunk: battles.withMask ?? 0,
        killed,
        drops,
        dropsByMap,
        perMap,
        sortiesByMap,
        sortieCosts,
        resNet,
        deltas,
        useitems: useitems.filter((u: any) => u.gained || u.spent),
        resCoversFullWindow: oldestMat != null && oldestMat <= opened,
        archivedAt: Date.now(),
      }
      this.db
        .prepare(
          `INSERT INTO event_archive (area_id, opened, closed, stats) VALUES (?, ?, ?, ?)
           ON CONFLICT(area_id) DO UPDATE SET opened=excluded.opened, closed=excluded.closed, stats=excluded.stats`,
        )
        .run(areaId, opened, closed, JSON.stringify(stats))
      console.log(
        `[kanso] mg: 活动 ${areaId} 已归档 — 出击 ${sorties} / 战斗 ${stats.battles} / 掉落 ${drops.length} 种`,
      )
      return stats
    } catch (e) {
      console.warn('[kanso] mg: event archive failed', e)
      return null
    }
  }

  queryEventArchives = () => {
    try {
      return (
        this.db
          .prepare(
            `SELECT a.area_id, a.opened, a.closed, a.stats,
                    c.area_name, c.maps, c.closed_ts
             FROM event_archive a
             LEFT JOIN event_map_catalog c ON c.area_id = a.area_id
             ORDER BY a.opened DESC`,
          )
          .all() as any[]
      ).map((r) => {
        let maps: any[] = []
        try {
          const parsed = JSON.parse(r.maps ?? '[]')
          if (Array.isArray(parsed)) maps = parsed
        } catch (_error) {
          /* 老归档没有海域主数据，仍保留统计总览 */
        }
        return {
          areaId: Number(r.area_id),
          areaName: r.area_name == null ? null : `${r.area_name}`,
          opened: Number(r.opened),
          closed: Number(r.closed),
          closedTs: r.closed_ts == null ? Number(r.closed) : Number(r.closed_ts),
          maps,
          stats: JSON.parse(r.stats),
        }
      })
    } catch (e) {
      console.warn('[kanso] mg: event archive query failed', e)
      throw e
    }
  }

  // 深海舰 → 你在哪些图、哪些点位遇到过它（遭遇志的敌编成反查，供鉴的深海卷/Peek）。
  // comp 是 JSON 数组，SQL 里不好拆，取回后在 JS 里归并；表不大（一行几十字节）。
  //
  // 2026-08-25 从图级细化到 (图, 点位)：cell 从第一天起就在表里，只是从前没 SELECT。
  // 图级合计 `n` 原样保留——Peek 卡与「出现海域 · N 张」都还在用它，
  // 而且 `cells` 里**不含**读不出点位的那些条，两者本来就不该相等。
  abyssSeenMaps = (): AbyssSeenEntry[] => {
    try {
      if (!this.abyssSeenCache) {
        const rows = this.db.prepare('SELECT map, cell, comp FROM encounters').all() as {
          map: number
          cell: number
          comp: string
        }[]
        const byShip: AbyssSeenCache = new Map()
        for (const r of rows) {
          let comp: number[]
          try {
            comp = JSON.parse(r.comp)
          } catch (_e) {
            continue
          }
          foldAbyssSeen(byShip, comp, r.map, r.cell)
        }
        this.abyssSeenCache = byShip
      }
      return abyssSeenEntriesOf(this.abyssSeenCache)
    } catch (e) {
      console.warn('[kanso] mg: abyss seen maps query failed', e)
      throw e
    }
  }

  /**
   * 本机确认掉落层（2026-08-22 批次 2）：整图或某一点，你自己捞到过什么。
   *
   * 与离线目录并列显示，**不合并**——口径与聚合写在 `local-drops.ts`（纯函数）。
   * 这里只负责取数：一次把该图的样本全取出来，在 JS 里聚合。整图样本量与
   * `queryMapChronicle` 已经在扫的那批同一个量级，不额外加压。
   */
  queryLocalDrops = (map: number, cell?: number): LocalDropScope => {
    try {
      const rows = (
        cell === undefined
          ? this.db
              .prepare('SELECT ts, cell, rank, drop_mst dropMst FROM encounters WHERE map = ?')
              .all(map | 0)
          : this.db
              .prepare(
                'SELECT ts, cell, rank, drop_mst dropMst FROM encounters WHERE map = ? AND cell = ?',
              )
              .all(map | 0, cell | 0)
      ) as LocalDropSample[]
      return aggregateLocalDrops(rows)
    } catch (e) {
      console.warn('[kanso] mg: local drops query failed', e)
      return EMPTY_LOCAL_DROPS
    }
  }

  // 某舰在哪些图/点掉过（鉴的「掉落海域」反查）。
  // 只答你自己捞到过的——这是实测，不是掉率表；没捞过就是空，不去猜「理论上哪里出」。
  queryShipDropSites = (mstId: number) => {
    try {
      return this.db
        .prepare(
          `SELECT map, cell, COUNT(*) n, MAX(ts) last, SUM(is_boss) bosses
           FROM encounters WHERE drop_mst = ? GROUP BY map, cell ORDER BY n DESC`,
        )
        .all(mstId | 0) as { map: number; cell: number; n: number; last: number; bosses: number }[]
    } catch (e) {
      console.warn('[kanso] mg: ship drop sites query failed', e)
      throw e
    }
  }

  // 深海舰的遭遇/击破统计（鉴的深海卷）。
  // 遭遇数覆盖全部历史；击破数只能从带 sunk_mask 的记录里数——
  // 该列是后加的，之前的记录没有，不能拿评级去倒推「大概沉了几艘」。
  // 两个数分开返回，UI 各说各的口径。
  abyssKillStats = (): Map<number, { met: number; killed: number; withMask: number }> => {
    try {
      if (!this.abyssKillCache) {
        const out = new Map<number, { met: number; killed: number; withMask: number }>()
        const rows = this.db.prepare('SELECT comp, sunk_mask FROM encounters').all() as {
          comp: string
          sunk_mask: number | null
        }[]
        for (const r of rows) {
          let comp: number[]
          try {
            comp = JSON.parse(r.comp)
          } catch (_e) {
            continue
          }
          // 三个数都按「舰位」计，不按「场次」——同一编成里 2 艘同款舰算 2 次遭遇、
          // 各自记各自的沉没，这样 killed/withMask 才是一致口径的击沉率
          for (const [i, id] of comp.entries()) {
            if (!(id > 0)) continue
            const e = out.get(id) ?? { met: 0, killed: 0, withMask: 0 }
            e.met++
            if (r.sunk_mask != null) {
              e.withMask++
              if (r.sunk_mask & (1 << i)) e.killed++
            }
            out.set(id, e)
          }
        }
        this.abyssKillCache = out
      }
    } catch (e) {
      console.warn('[kanso] mg: abyss kill stats failed', e)
      throw e
    }
    return this.abyssKillCache
  }

  logRoute = (ts: number, map: number, fromCell: number, toCell: number) => {
    try {
      this.db.prepare('INSERT INTO routes (ts, map, from_cell, to_cell) VALUES (?, ?, ?, ?)').run(ts, map, fromCell, toCell)
    } catch (e) {
      console.warn('[kanso] mg: route log failed', e)
    }
  }

  // ---- 友军遭遇志 ----

  /**
   * 一次友军遭遇。`INSERT OR IGNORE` 是这条的关键：主键是（指纹, 时刻），
   * 从 events 回放补录可以任意重跑，同一份报文第二次进来就是空操作。
   */
  logFriendlyFleet = (sighting: FriendlyFleetSighting) => {
    try {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO friendly_fleets
             (fleet_key, ts, map, cell, difficulty, request_type, production_type, comp)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          sighting.fleetKey,
          sighting.ts,
          sighting.map,
          sighting.cell,
          sighting.difficulty,
          sighting.requestType,
          sighting.productionType,
          JSON.stringify(sighting.ships),
        )
    } catch (e) {
      console.warn('[kanso] mg: friendly fleet log failed', e)
    }
  }

  /** 这张图这个难度上，你遇到过的友军（按最近一次降序）。 */
  queryFriendlyFleets = (map: number, difficulty: number): FriendlyFleetRecord[] => {
    try {
      const rows = this.db
        .prepare(
          `SELECT fleet_key AS fleetKey, ts, map, cell, difficulty,
                  request_type AS requestType, production_type AS productionType, comp
           FROM friendly_fleets WHERE map = ? AND difficulty = ? ORDER BY ts DESC LIMIT 500`,
        )
        .all(map, difficulty) as (Omit<FriendlyFleetSighting, 'ships'> & { comp: string })[]
      return groupFriendlySightings(
        rows.map(({ comp, ...row }) => ({
          ...row,
          requestType: row.requestType ?? null,
          productionType: row.productionType ?? null,
          ships: JSON.parse(comp) as FriendlyFleetShip[],
        })),
      )
    } catch (e) {
      console.warn('[kanso] mg: friendly fleet query failed', e)
      return []
    }
  }

  // 某点的遭遇聚合：按编成签名归并（次数/最近时间/阵形/评级分布/掉落）
  queryEncountersAt = (map: number, cell: number) => {
    try {
      const rows = this.db
        .prepare('SELECT ts, formation, comp, rank, drop_mst FROM encounters WHERE map = ? AND cell = ? ORDER BY ts DESC LIMIT 500')
        .all(map, cell)
      const byComp = new Map<string, { comp: number[]; formation: number; count: number; lastTs: number; ranks: Record<string, number>; drops: number[] }>()
      for (const r of rows) {
        const key = `${r.comp}|${r.formation}`
        let agg = byComp.get(key)
        if (!agg) {
          agg = { comp: JSON.parse(r.comp), formation: r.formation ?? 0, count: 0, lastTs: 0, ranks: {}, drops: [] }
          byComp.set(key, agg)
        }
        agg.count += 1
        agg.lastTs = Math.max(agg.lastTs, r.ts)
        if (r.rank) agg.ranks[r.rank] = (agg.ranks[r.rank] ?? 0) + 1
        if (r.drop_mst) agg.drops.push(r.drop_mst)
      }
      return [...byComp.values()].sort((a, b) => b.count - a.count)
    } catch (e) {
      console.warn('[kanso] mg: encounter query failed', e)
      throw e
    }
  }

  queryNodeHistoryIndex = (limit = 300): NodeHistoryIndexEntry[] => {
    try {
      return (
        this.db
          .prepare(
            `SELECT map, cell, COUNT(*) count, COALESCE(SUM(is_boss), 0) bosses, MAX(ts) lastTs
             FROM encounters
             GROUP BY map, cell
             ORDER BY lastTs DESC
             LIMIT ?`,
          )
          .all(Math.max(1, Math.min(600, limit | 0))) as any[]
      ).map((row) => ({
        map: Number(row.map),
        cell: Number(row.cell),
        count: Number(row.count),
        bosses: Number(row.bosses),
        lastTs: Number(row.lastTs),
      }))
    } catch (error) {
      console.warn('[kanso] mg: node history index query failed', error)
      throw error
    }
  }

  queryNodeHistory = (map: number, cell: number, limit = 60): NodeHistoryReport => {
    try {
      const rows = this.db
        .prepare(
          `SELECT ts, is_boss isBoss, formation, comp, rank,
                  drop_mst dropMst, sunk_mask sunkMask
           FROM encounters
           WHERE map=? AND cell=?
           ORDER BY ts DESC
           LIMIT ?`,
        )
        .all(map, cell, Math.max(1, Math.min(200, limit | 0))) as any[]
      return {
        map,
        cell,
        entries: rows.flatMap((row) => {
          try {
            const comp = JSON.parse(row.comp)
            if (!Array.isArray(comp)) return []
            return [{
              ts: Number(row.ts),
              isBoss: row.isBoss === 1,
              formation: Number(row.formation ?? 0),
              comp: comp.map(Number).filter((id: number) => Number.isFinite(id) && id > 0),
              rank: row.rank == null ? null : `${row.rank}`,
              dropMst: row.dropMst == null ? null : Number(row.dropMst),
              sunkMask: row.sunkMask == null ? null : Number(row.sunkMask),
            }]
          } catch (_error) {
            return []
          }
        }),
      }
    } catch (error) {
      console.warn('[kanso] mg: node history query failed', error)
      throw error
    }
  }

  // 某点出发的带路分布：to_cell → 次数
  /**
   * 这张图上**你自己**每个分歧点的实际去向次数。
   *
   * 罗盘把你带去哪，是任何攻略表都替不了的私人事实：带路条件说的是
   * 「满足什么会去哪」，而固定分歧（比如 50/50）满足与否都一样——
   * 只有自己走过的次数能回答「这条路我到底吃到过几回」。
   *
   * 键是**边号**（api_no），与 nodes[].cell 同一口径，-1 表示出发点；
   * 翻成字母要靠 fcd 的 route 表，那是渲染层的事，这里不掺进来。
   *
   * 一次给整张图：分歧点是逐个看的，但一屏上会同时出现好几个，
   * 逐点往返 IPC 会把一次渲染拆成十几趟。
   */
  queryRouteStats = (map: number): RouteStatsReport => {
    try {
      const rows = this.db
        .prepare(
          `SELECT from_cell AS f, to_cell AS t, COUNT(*) AS n, MAX(ts) AS last
           FROM routes WHERE map = ? GROUP BY from_cell, to_cell`,
        )
        .all(map) as { f: number; t: number; n: number; last: number }[]
      const branches: Record<number, Record<number, number>> = {}
      let total = 0
      let lastTs: number | null = null
      for (const row of rows) {
        ;(branches[row.f] ??= {})[row.t] = row.n
        total += row.n
        if (lastTs == null || row.last > lastTs) lastTs = row.last
      }
      return { map, branches, total, lastTs }
    } catch (e) {
      console.warn('[kanso] mg: route query failed', e)
      throw e
    }
  }

  // ---- 出击预测样本（永久表）----

  startSortieSample = (sample: {
    sortieId: number
    ts: number
    map: number
    difficulty: number
    eventKey: number
    combinedType: number
    deckId: number
    bossCell: number
    fleetSignature: string
    supplyBaseline: { rosterId: number; fuel: number; ammo: number }[]
    /** 出击那一刻的装备搭配（[队][舰][装备]）——签名回溯不了，必须当场记 */
    fleetEquips?: { mstId: number; level: number }[][][]
    /** 出击那一刻的 33 式索敌（係数×1）；算不出（无提督等级等）为 null */
    los33?: number | null
  }) => {
    try {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO sortie_samples
           (sortie_id, start_ts, map, difficulty, event_key, combined_type, deck_id, boss_cell,
            fleet_signature, supply_baseline, fleet_equips, los33)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          sample.sortieId,
          sample.ts,
          sample.map,
          sample.difficulty,
          sample.eventKey,
          sample.combinedType,
          sample.deckId,
          sample.bossCell,
          sample.fleetSignature,
          JSON.stringify(sample.supplyBaseline),
          sample.fleetEquips ? JSON.stringify(sample.fleetEquips) : null,
          sample.los33 ?? null,
        )
    } catch (e) {
      console.warn('[kanso] mg: sortie sample start failed', e)
    }
  }

  logNodeSample = (sample: {
    sortieId: number
    battleNo: number
    ts: number
    map: number
    cell: number
    difficulty: number
    eventKey: number
    combinedType: number
    isBoss: boolean
    formation: number
    comp: number[]
    rank: string | null
    shipCount: number
    taihaCount: number
  }) => {
    try {
      this.db
        .prepare(
          `INSERT INTO node_samples
           (sortie_id, battle_no, ts, map, cell, difficulty, event_key, combined_type,
            is_boss, formation, comp, rank, ship_count, taiha_count)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(sortie_id, battle_no) DO UPDATE SET
             ts=excluded.ts, map=excluded.map, cell=excluded.cell,
             difficulty=excluded.difficulty, event_key=excluded.event_key,
             combined_type=excluded.combined_type, is_boss=excluded.is_boss,
             formation=excluded.formation, comp=excluded.comp, rank=excluded.rank,
             ship_count=excluded.ship_count, taiha_count=excluded.taiha_count`,
        )
        .run(
          sample.sortieId,
          sample.battleNo,
          sample.ts,
          sample.map,
          sample.cell,
          sample.difficulty,
          sample.eventKey,
          sample.combinedType,
          sample.isBoss ? 1 : 0,
          sample.formation,
          JSON.stringify(sample.comp),
          sample.rank,
          sample.shipCount,
          sample.taihaCount,
        )
    } catch (e) {
      console.warn('[kanso] mg: node sample save failed', e)
    }
  }

  markLatestNodeAdvanced = (sortieId: number) => {
    try {
      this.db
        .prepare(
          `UPDATE node_samples SET advanced = 1
           WHERE id = (
             SELECT id FROM node_samples
             WHERE sortie_id = ? AND advanced IS NULL
             ORDER BY battle_no DESC LIMIT 1
           )`,
        )
        .run(sortieId)
    } catch (e) {
      console.warn('[kanso] mg: node sample advance failed', e)
    }
  }

  markBossSample = (sortieId: number, rank: string | null) => {
    try {
      const win = rank != null && ['S', 'A', 'B'].includes(rank) ? 1 : 0
      this.db
        .prepare(
          `UPDATE sortie_samples
           SET reached_boss = 1, boss_rank = ?, boss_win = ?
           WHERE sortie_id = ?`,
        )
        .run(rank, win, sortieId)
    } catch (e) {
      console.warn('[kanso] mg: boss sample save failed', e)
    }
  }

  finishSortieSample = (
    sortieId: number,
    ts: number,
    ships: Record<number, { fuel: number; bull: number }>,
  ) => {
    try {
      const row = this.db
        .prepare(
          'SELECT supply_baseline AS baseline, completed FROM sortie_samples WHERE sortie_id = ?',
        )
        .get(sortieId) as { baseline?: string; completed?: number } | undefined
      // 同一个已结束会话会在补给、换装、重新进入母港时继续收到 port。
      // 第一次返港才是航行消耗终点；后续满补给快照绝不能把它覆盖成 0。
      if (!row || Number(row.completed) === 1) return
      this.db
        .prepare(
          `UPDATE node_samples SET advanced = 0
           WHERE id = (
             SELECT id FROM node_samples
             WHERE sortie_id = ? AND advanced IS NULL
             ORDER BY battle_no DESC LIMIT 1
           )`,
        )
        .run(sortieId)
      let fuelCost: number | null = null
      let ammoCost: number | null = null
      if (row?.baseline) {
        try {
          const baseline = JSON.parse(row.baseline) as SortieSupplyBaseline[]
          const cost = calculateSortieSupplyCost(
            baseline,
            Object.entries(ships).map(([rosterId, ship]) => ({
              rosterId: Number(rosterId),
              fuel: ship.fuel,
              ammo: ship.bull,
            })),
          )
          fuelCost = cost?.fuel ?? null
          ammoCost = cost?.ammo ?? null
        } catch (error) {
          console.warn('[kanso] mg: sortie supply baseline invalid', error)
        }
      }
      this.db
        .prepare(
          `UPDATE sortie_samples SET end_ts = ?, completed = 1, fuel_cost = ?, ammo_cost = ?
           WHERE sortie_id = ? AND completed = 0`,
        )
        .run(ts, fuelCost, ammoCost, sortieId)
    } catch (e) {
      console.warn('[kanso] mg: sortie sample finish failed', e)
    }
  }

  private recoverOverwrittenSortieCosts = (areaId: number, sinceTs: number): number => {
    const low = areaId * 10
    const high = low + 9
    let repaired = 0
    try {
      const rows = this.db
        .prepare(
          `SELECT sortie_id sortieId, start_ts startTs, supply_baseline baseline
           FROM sortie_samples
           WHERE map BETWEEN ? AND ? AND start_ts >= ? AND completed = 1
             AND COALESCE(fuel_cost, 0) = 0 AND COALESCE(ammo_cost, 0) = 0`,
        )
        .all(low, high, sinceTs) as { sortieId: number; startTs: number; baseline: string }[]
      const nextStartStmt = this.db.prepare(
        'SELECT MIN(start_ts) nextTs FROM sortie_samples WHERE start_ts > ?',
      )
      const firstPortStmt = this.db.prepare(
        `SELECT MIN(ts) portTs FROM events
         WHERE ts > ? AND ts < ? AND path = '/kcsapi/api_port/port'`,
      )
      const shipDeckStmt = this.db.prepare(
        `SELECT body FROM events
         WHERE ts BETWEEN ? AND ? AND path = '/kcsapi/api_get_member/ship_deck'
           AND body IS NOT NULL
         ORDER BY ts DESC LIMIT 1`,
      )
      const chargeStmt = this.db.prepare(
        `SELECT e.ts, e.post_body postBody, d.fuel, d.ammo
         FROM events e
         LEFT JOIN material_delta d ON d.ts = e.ts AND d.category = '补给'
         WHERE e.ts >= ? AND e.ts < ? AND e.path = '/kcsapi/api_req_hokyu/charge'
         ORDER BY e.ts`,
      )
      const updateStmt = this.db.prepare(
        `UPDATE sortie_samples
         SET end_ts = ?, fuel_cost = ?, ammo_cost = ?
         WHERE sortie_id = ? AND completed = 1
           AND COALESCE(fuel_cost, 0) = 0 AND COALESCE(ammo_cost, 0) = 0`,
      )

      for (const row of rows) {
        let baseline: SortieSupplyBaseline[]
        try {
          baseline = JSON.parse(row.baseline)
        } catch (error) {
          console.warn(
            `[kanso] mg: 无法解析活动出击 ${row.sortieId} 的旧补给基线，已跳过恢复`,
            error,
          )
          continue
        }
        if (!Array.isArray(baseline) || !baseline.length) continue
        const nextTs = Number(
          (nextStartStmt.get(row.startTs) as { nextTs?: number } | undefined)?.nextTs ??
            Number.MAX_SAFE_INTEGER,
        )
        const portTs = Number(
          (firstPortStmt.get(row.startTs, nextTs) as { portTs?: number } | undefined)?.portTs ?? 0,
        )
        if (!(portTs > row.startTs)) continue

        let snapshotCost: SortieSupplyCost | null = null
        const shipDeck = shipDeckStmt.get(row.startTs, portTs) as { body?: string } | undefined
        if (shipDeck?.body) {
          try {
            const parsed = JSON.parse(shipDeck.body)
            const data = parsed?.api_data ?? parsed
            const rawShips = data?.api_ship_data ?? data?.api_ship
            if (Array.isArray(rawShips)) {
              snapshotCost = calculateSortieSupplyCost(
                baseline,
                rawShips.map((ship: any) => ({
                  rosterId: Number(ship?.api_id),
                  fuel: Number(ship?.api_fuel),
                  ammo: Number(ship?.api_bull),
                })),
              )
            }
          } catch (error) {
            console.warn(
              `[kanso] mg: 无法解析活动出击 ${row.sortieId} 的返港前舰队快照，改用补给差额`,
              error,
            )
          }
        }

        const rosterIds = new Set(baseline.map((ship) => Number(ship.rosterId)))
        let resupplyFuel = 0
        let resupplyAmmo = 0
        let resupplyMatched = false
        for (const charge of chargeStmt.all(portTs, nextTs) as any[]) {
          let post: Record<string, string>
          try {
            post = JSON.parse(charge.postBody || '{}')
          } catch (error) {
            console.warn(
              `[kanso] mg: 无法解析活动出击 ${row.sortieId} 的补给请求，已跳过该条`,
              error,
            )
            continue
          }
          const ids = `${post.api_id_items ?? ''}`
            .split(',')
            .map(Number)
            .filter((id) => id > 0)
          // 只接纳完全属于本次出击舰队的补给批次，避免把其他舰队消费混入。
          if (!ids.length || ids.some((id) => !rosterIds.has(id))) continue
          resupplyMatched = true
          resupplyFuel += Math.max(0, -Number(charge.fuel || 0))
          resupplyAmmo += Math.max(0, -Number(charge.ammo || 0))
        }
        const cost = mergeSortieSupplyCosts(
          snapshotCost,
          resupplyMatched ? { fuel: resupplyFuel, ammo: resupplyAmmo } : null,
        )
        if (!cost || (cost.fuel === 0 && cost.ammo === 0)) continue
        const result = updateStmt.run(portTs, cost.fuel, cost.ammo, row.sortieId)
        if (Number(result?.changes ?? 0) > 0) repaired++
      }
      if (repaired) {
        console.log(`[kanso] mg: 已从返港前快照/补给差额恢复 ${repaired} 次活动出击燃弹消耗`)
      }
    } catch (error) {
      console.warn('[kanso] mg: historical sortie cost recovery failed', error)
    }
    return repaired
  }

  queryEventSortieCosts = (areaId: number, sinceTs: number): EventSortieCostReport => {
    const low = areaId * 10
    const high = low + 9
    try {
      this.recoverOverwrittenSortieCosts(areaId, sinceTs)
      const rows = this.db
        .prepare(
          `SELECT map,
                  SUM(CASE WHEN fuel_cost IS NOT NULL AND ammo_cost IS NOT NULL THEN 1 ELSE 0 END) sorties,
                  SUM(CASE WHEN fuel_cost IS NULL OR ammo_cost IS NULL THEN 1 ELSE 0 END) skipped,
                  COALESCE(SUM(fuel_cost), 0) fuel,
                  COALESCE(SUM(ammo_cost), 0) ammo
           FROM sortie_samples
           WHERE map BETWEEN ? AND ? AND start_ts >= ? AND completed = 1
           GROUP BY map ORDER BY map`,
        )
        .all(low, high, sinceTs) as any[]
      const maps = rows
        .filter((row) => Number(row.sorties) > 0)
        .map((row) => ({
          map: Number(row.map),
          sorties: Number(row.sorties),
          fuel: Number(row.fuel),
          ammo: Number(row.ammo),
        }))
      return {
        areaId,
        sinceTs,
        sorties: maps.reduce((sum, row) => sum + row.sorties, 0),
        skipped: rows.reduce((sum, row) => sum + Number(row.skipped), 0),
        fuel: maps.reduce((sum, row) => sum + row.fuel, 0),
        ammo: maps.reduce((sum, row) => sum + row.ammo, 0),
        maps,
      }
    } catch (error) {
      console.warn('[kanso] mg: event sortie cost query failed', error)
      throw error
    }
  }

  querySortieForecast = (scope: {
    map: number
    cell: number
    difficulty: number
    eventKey: number
    combinedType: number
    excludeSortieId: number
    previewShipIds?: number[]
  }): SortieForecastReport => {
    const params = [
      scope.map,
      scope.difficulty,
      scope.eventKey,
      scope.combinedType,
      scope.excludeSortieId,
    ]
    const emptyNode = () => ({
      total: 0,
      wins: 0,
      saWins: 0,
      sWins: 0,
      passTotal: 0,
      passed: 0,
      taiha: 0,
      bosses: 0,
    })
    try {
      const sortie = this.db
        .prepare(
          `SELECT COUNT(*) AS total,
                  COALESCE(SUM(CASE WHEN boss_win = 1 THEN 1 ELSE 0 END), 0) AS wins,
                  COALESCE(SUM(CASE WHEN boss_rank IN ('S', 'A') THEN 1 ELSE 0 END), 0) AS sa_wins,
                  COALESCE(SUM(CASE WHEN boss_rank = 'S' THEN 1 ELSE 0 END), 0) AS s_wins,
                  COALESCE(SUM(CASE WHEN reached_boss = 1 THEN 1 ELSE 0 END), 0) AS reached
           FROM sortie_samples
           WHERE map = ? AND difficulty = ? AND event_key = ? AND combined_type = ?
             AND completed = 1 AND sortie_id <> ?`,
        )
        .get(...params)
      // 一次聚合整张图，renderer 可直接把每个候选出边与其下一点风险对齐；
      // 不按候选点逐个 IPC/SQL 请求，罗盘多分支时也只读一遍账本。
      const nodeRows = this.db
        .prepare(
          `SELECT cell,
                  COUNT(*) AS total,
                  COALESCE(SUM(CASE WHEN rank IN ('S', 'A', 'B') THEN 1 ELSE 0 END), 0) AS wins,
                  COALESCE(SUM(CASE WHEN rank IN ('S', 'A') THEN 1 ELSE 0 END), 0) AS sa_wins,
                  COALESCE(SUM(CASE WHEN rank = 'S' THEN 1 ELSE 0 END), 0) AS s_wins,
                  COALESCE(SUM(CASE WHEN advanced IS NOT NULL THEN 1 ELSE 0 END), 0) AS pass_total,
                  COALESCE(SUM(CASE WHEN advanced = 1 THEN 1 ELSE 0 END), 0) AS passed,
                  COALESCE(SUM(CASE WHEN taiha_count > 0 THEN 1 ELSE 0 END), 0) AS taiha,
                  COALESCE(SUM(CASE WHEN is_boss = 1 THEN 1 ELSE 0 END), 0) AS bosses
           FROM node_samples
           WHERE map = ? AND difficulty = ? AND event_key = ? AND combined_type = ?
             AND sortie_id <> ?
           GROUP BY cell`,
        )
        .all(...params) as any[]
      const nodes: SortieForecastReport['nodes'] = {}
      for (const row of nodeRows) {
        nodes[Number(row.cell)] = {
          total: Number(row.total ?? 0),
          wins: Number(row.wins ?? 0),
          saWins: Number(row.sa_wins ?? 0),
          sWins: Number(row.s_wins ?? 0),
          passTotal: Number(row.pass_total ?? 0),
          passed: Number(row.passed ?? 0),
          taiha: Number(row.taiha ?? 0),
          bosses: Number(row.bosses ?? 0),
        }
      }
      const previewIds = (scope.previewShipIds ?? [])
        .map(Number)
        .filter((id) => Number.isInteger(id) && id > 0)
        .slice(0, 3)
      let preview: SortieForecastReport['preview'] = null
      if (previewIds.length) {
        const prefixSql = previewIds
          .map((_, index) => `CAST(json_extract(comp, '$[${index}]') AS INTEGER) = ?`)
          .join(' AND ')
        const row = this.db
          .prepare(
            `SELECT COUNT(*) AS total,
                    COALESCE(SUM(CASE WHEN rank IN ('S', 'A', 'B') THEN 1 ELSE 0 END), 0) AS wins,
                    COALESCE(SUM(CASE WHEN rank IN ('S', 'A') THEN 1 ELSE 0 END), 0) AS sa_wins,
                    COALESCE(SUM(CASE WHEN rank = 'S' THEN 1 ELSE 0 END), 0) AS s_wins,
                    COALESCE(SUM(CASE WHEN advanced IS NOT NULL THEN 1 ELSE 0 END), 0) AS pass_total,
                    COALESCE(SUM(CASE WHEN advanced = 1 THEN 1 ELSE 0 END), 0) AS passed,
                    COALESCE(SUM(CASE WHEN taiha_count > 0 THEN 1 ELSE 0 END), 0) AS taiha,
                    COALESCE(SUM(CASE WHEN is_boss = 1 THEN 1 ELSE 0 END), 0) AS bosses
             FROM node_samples
             WHERE map = ? AND cell = ? AND difficulty = ? AND event_key = ?
               AND combined_type = ? AND sortie_id <> ? AND ${prefixSql}`,
          )
          .get(
            scope.map,
            scope.cell,
            scope.difficulty,
            scope.eventKey,
            scope.combinedType,
            scope.excludeSortieId,
            ...previewIds,
          ) as any
        preview = {
          total: Number(row?.total ?? 0),
          wins: Number(row?.wins ?? 0),
          saWins: Number(row?.sa_wins ?? 0),
          sWins: Number(row?.s_wins ?? 0),
          passTotal: Number(row?.pass_total ?? 0),
          passed: Number(row?.passed ?? 0),
          taiha: Number(row?.taiha ?? 0),
          bosses: Number(row?.bosses ?? 0),
        }
      }
      return {
        sortie: {
          total: Number(sortie?.total ?? 0),
          wins: Number(sortie?.wins ?? 0),
          saWins: Number(sortie?.sa_wins ?? 0),
          sWins: Number(sortie?.s_wins ?? 0),
          reached: Number(sortie?.reached ?? 0),
        },
        current: nodes[scope.cell] ?? emptyNode(),
        nodes,
        preview,
      }
    } catch (e) {
      console.warn('[kanso] mg: sortie forecast query failed', e)
      throw e
    }
  }

  // 整图汇总（海域图鉴用）：各点遭遇次数 + 掉落史
  queryMapChronicle = (map: number): MapChronicleReport => {
    try {
      const cells = this.db
        .prepare('SELECT cell, COUNT(*) n, MAX(ts) last FROM encounters WHERE map = ? GROUP BY cell')
        .all(map)
      const drops = this.db
        .prepare('SELECT cell, drop_mst, COUNT(*) n FROM encounters WHERE map = ? AND drop_mst IS NOT NULL GROUP BY cell, drop_mst ORDER BY n DESC')
        .all(map)
      const sorties = this.db.prepare('SELECT COUNT(*) n FROM routes WHERE map = ? AND from_cell = -1').get(map)
      // 走过的边：to_cell 就是罗盘 api_no，fcd 的 route[api_no] = [起点字母, 终点字母]，
      // 一个 to_cell 已经唯一确定一条边，不必再带 from_cell。
      const edges = this.db
        .prepare('SELECT to_cell, COUNT(*) n FROM routes WHERE map = ? AND to_cell > 0 GROUP BY to_cell')
        .all(map)
      // Boss 点由你自己打过的记录认定（fcd 不标 Boss），拿不到就不标，不猜。
      // 带上各点最近一次遭遇：多血条图有好几个 Boss 点，展示侧要按「最近打的那个」
      // 挑默认目标点，光有点号分不出先后。
      const bosses = this.db
        .prepare('SELECT cell, MAX(ts) last FROM encounters WHERE map = ? AND is_boss = 1 GROUP BY cell')
        .all(map)
      return {
        cells: cells.map((c: any) => ({ cell: c.cell, count: c.n, lastTs: c.last })),
        drops: drops.map((d: any) => ({ cell: d.cell, mstId: d.drop_mst, count: d.n })),
        sortieCount: sorties?.n ?? 0,
        edges: edges.map((e: any) => ({ cell: e.to_cell, count: e.n })),
        bossCells: bosses.map((b: any) => b.cell as number),
        bossSeen: bosses.map((b: any) => ({ cell: b.cell as number, lastTs: Number(b.last) })),
        localDrops: this.queryLocalDrops(map),
      }
    } catch (e) {
      console.warn('[kanso] mg: map chronicle query failed', e)
      throw e
    }
  }

  /**
   * 通关阵容（2026-08-17 用户提议）：这张图上打赢过 Boss 的编成。
   * 逐场取样后在 JS 里聚合——展示层按**舰组合**并组（签名带等级，练级会把
   * 同一套船拆成一行一级，实测滨波 Lv39→40 就裂成两行）；等级/装备/33式/航迹
   * 都取「最近一次赢的那场」。只列赢过的：这是通关阵容，不是出击流水。
   * 到 Boss 率就是个人实测的带路参考；航迹按时间窗从 routes 还原
   * （routes 不带场次 id，但每条边带 ts——本场起点到下一场起点之间的边就是
   * 本场走的路）。装备与 33 式是 2026-08-17 起落表的，老样本如实缺省。
   */
  queryMapClearFleets = (map: number, difficulty: number, eventKey: number): MapClearFleetRow[] => {
    try {
      const sorties = this.db
        .prepare(
          `SELECT start_ts, fleet_signature sig, reached_boss reached, boss_win win,
                  boss_rank rank, fleet_equips equips, los33
           FROM sortie_samples
           WHERE map = ? AND difficulty = ? AND event_key = ?
           ORDER BY start_ts ASC`,
        )
        .all(map, difficulty, eventKey) as any[]
      if (!sorties.length) return []
      // 航迹时间窗的切点要用**该图全部**样本的起点（routes 不分难度）
      const starts = (
        this.db
          .prepare(`SELECT start_ts FROM sortie_samples WHERE map = ? ORDER BY start_ts ASC`)
          .all(map) as any[]
      ).map((row) => Number(row.start_ts))
      const routeRows = (
        this.db
          .prepare(`SELECT ts, to_cell FROM routes WHERE map = ? AND to_cell > 0 ORDER BY ts ASC`)
          .all(map) as any[]
      ).map((row) => ({ ts: Number(row.ts), cell: Number(row.to_cell) }))
      const pathOf = (startTs: number): number[] => {
        const nextStart = starts.find((value) => value > startTs) ?? startTs + 12 * 3600 * 1000
        return routeRows
          .filter((row) => row.ts >= startTs && row.ts < nextStart)
          .map((row) => row.cell)
      }
      const parseJson = (text: unknown): unknown => {
        try {
          return JSON.parse(`${text}`)
        } catch {
          return null
        }
      }
      interface Agg extends MapClearFleetRow {
        winStarts: number[]
      }
      const byShips = new Map<string, Agg>()
      for (const row of sorties) {
        const sig = parseJson(row.sig)
        if (!Array.isArray(sig)) continue
        const decks = sig.map((deck: unknown) =>
          (Array.isArray(deck) ? deck : []).map((pair: unknown) => ({
            mstId: Number((pair as number[])?.[0]) || 0,
            lv: Number((pair as number[])?.[1]) || 0,
          })),
        )
        const key = JSON.stringify(decks.map((deck) => deck.map((ship) => ship.mstId)))
        const agg =
          byShips.get(key) ??
          ({
            decks,
            sorties: 0,
            reached: 0,
            wins: 0,
            sWins: 0,
            lastWinTs: 0,
            path: [],
            pathVaried: false,
            equips: null,
            los33: null,
            winStarts: [],
          } satisfies Agg)
        agg.sorties += 1
        if (Number(row.reached) === 1) agg.reached += 1
        if (Number(row.win) === 1) {
          agg.wins += 1
          if (`${row.rank}` === 'S') agg.sWins += 1
          const startTs = Number(row.start_ts)
          agg.winStarts.push(startTs)
          // 等级/装备/33式一律取最近一次赢的那场
          if (startTs >= agg.lastWinTs) {
            agg.lastWinTs = startTs
            agg.decks = decks
            const equips = row.equips != null ? parseJson(row.equips) : null
            agg.equips = Array.isArray(equips) ? (equips as Agg['equips']) : null
            agg.los33 = row.los33 != null ? Number(row.los33) : null
          }
        }
        byShips.set(key, agg)
      }
      const winners = [...byShips.values()].filter((agg) => agg.wins > 0)
      for (const agg of winners) {
        agg.path = pathOf(agg.lastWinTs)
        // 多次通关走过不同路线 = 判「是不是绕路」的直接信号
        const winPaths = agg.winStarts
          .map((startTs) => pathOf(startTs).join(','))
          .filter(Boolean)
        agg.pathVaried = new Set(winPaths).size > 1
      }
      // 排序（用户口径）：出击次数优先、次按 Boss 胜率，都同再看谁最近赢过——
      // 打得多又赢得稳的编成才配当第一参考
      const winRate = (row: MapClearFleetRow) => (row.sorties ? row.wins / row.sorties : 0)
      return winners
        .sort(
          (left, right) =>
            right.sorties - left.sorties ||
            winRate(right) - winRate(left) ||
            right.lastWinTs - left.lastWinTs,
        )
        .slice(0, 8)
        .map(({ winStarts: _winStarts, ...row }) => row)
    } catch (e) {
      console.warn('[kanso] mg: map clear fleets query failed', e)
      return []
    }
  }

  loadSnapshot = (apiPath: string): { ts: number; body: unknown } | undefined => {
    try {
      const file = path.join(SNAPSHOT_DIR, `${apiPath.replace(/\//g, '_').slice(1)}.json`)
      return JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch (_e) {
      return undefined
    }
  }

  // 领域状态快照（任务/道具/海域进度/演习/出击）：重启后仍能显示「最后一次抓到的内容」，
  // 不必再去游戏里各点一遍才有数据
  saveDomainState = (name: string, data: unknown) => {
    try {
      atomicWriteJsonSync(path.join(SNAPSHOT_DIR, `${name}.json`), {
        ts: Date.now(),
        data,
      })
    } catch (e) {
      console.warn('[kanso] mg: domain state save failed', name, e)
    }
  }

  loadDomainState = (name: string): { ts: number; data: any } | null => {
    try {
      return JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, `${name}.json`), 'utf8'))
    } catch (_e) {
      return null
    }
  }

  backupDatabase = (destination: string) => {
    if (this.closed) throw new Error('履历数据库已经关闭')
    if (path.resolve(destination).toLowerCase() === path.resolve(DB_PATH).toLowerCase()) {
      throw new Error('备份文件不能覆盖正在使用的数据库')
    }
    const temp = `${destination}.kanso-${process.pid}-${Date.now()}.tmp`
    try {
      this.db.exec('PRAGMA wal_checkpoint(FULL)')
      const escaped = temp.replace(/'/g, "''")
      this.db.exec(`VACUUM INTO '${escaped}'`)
      fs.copyFileSync(temp, destination)
    } finally {
      try {
        fs.rmSync(temp, { force: true })
      } catch (error) {
        console.warn('[kanso] mg: backup temp cleanup failed', error)
      }
    }
  }

  validateDatabase = (source: string) => {
    const candidate = new DatabaseSync(source, { readOnly: true })
    try {
      const integrity = candidate.prepare('PRAGMA integrity_check(1)').get()
      if (integrity?.integrity_check !== 'ok') throw new Error('历史记录文件校验未通过（可能已损坏）')
      const events = candidate
        .prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name='events'")
        .get()
      if (!events?.ok) throw new Error('不是 kuma 履历数据库：缺少 events 表')
    } finally {
      candidate.close()
    }
  }

  closeDatabase = () => {
    if (this.closed) return
    clearInterval(this.pruneTimer)
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    this.db.close()
    this.closed = true
  }

  /**
   * 每天一次的自动清理。**没设保留期时一行都不删**（2026-08-23 起的默认）。
   *
   * 该删哪张表、删到哪个时刻，整条判据在 shared/ledger-retention 的
   * `planLedgerPrune`（护栏脱开 sqlite 真跑一遍）。这里只负责按计划执行。
   * ⚠️ 计划是**白名单**：永久表（遭遇志、精矿、活动履历…）不可能出现在里面。
   *
   * 战斗快照那条「只留最近 500 场」的条数上限一并退役：它同样是「系统替玩家
   * 决定哪些该忘」，只是判据从日期换成了条数。要控体积就设保留期，
   * 或者在钥里按月清——两条都是他自己按的。
   */
  private prune = () => {
    const plan = planLedgerPrune({
      retentionDays: config.get(RETENTION_CONFIG_PATH, 0),
      now: Date.now(),
    })
    if (!plan.length) return
    try {
      for (const step of plan) {
        this.db.prepare(`DELETE FROM ${step.table} WHERE ts >= ? AND ts < ?`).run(step.from, step.to)
      }
      // 快照集合可能变了：实得经验统计缓存的是「最近 500 份快照」的解析结果，
      // 不失效就会拿着已经删掉的那几场继续算
      this.expSamplesCache = null
    } catch (e) {
      console.warn('[kanso] mg: prune failed', e)
    }
  }

  /**
   * 钥里「记录保留与清理」那张卡要的三样：现在的保留期设置、账本文件占多大、
   * 以及那四张滚动表按本地年月的行数（新月在前）。
   *
   * 逐月逐表 COUNT 而不是把 ts 全捞出来在 JS 里分组：满账本几万行，
   * 捞出来光序列化就是一次可见的卡顿；ts 上有索引，区间计数走的是索引。
   * 月份枚举与合并在 shared（同一份换算，与语音台账那边不分叉）。
   */
  ledgerRetentionReport = (): {
    retentionDays: number
    bytes: number
    months: LedgerMonthCount[]
  } => {
    const retentionDays = clampLedgerRetentionDays(config.get(RETENTION_CONFIG_PATH, 0))
    let bytes = 0
    // WAL 一并算进去：刚写过一大批时它能有几十 MB，只报主文件会让玩家
    // 觉得「清理前后都一样大」——那两个文件都是这份账本占的盘。
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        bytes += fs.statSync(`${DB_PATH}${suffix}`).size
      } catch {
        // 没有 WAL/SHM 是常态（干净关闭后就没了），不是错
      }
    }
    const rows: LedgerMonthCount[] = []
    try {
      let earliest = 0
      let latest = 0
      for (const table of LEDGER_ROLLING_TABLES) {
        const span = this.db.prepare(`SELECT MIN(ts) lo, MAX(ts) hi FROM ${table}`).get() as {
          lo?: number | null
          hi?: number | null
        }
        const lo = Number(span?.lo) || 0
        const hi = Number(span?.hi) || 0
        if (lo > 0 && (!earliest || lo < earliest)) earliest = lo
        if (hi > latest) latest = hi
      }
      for (const month of ledgerMonthsCovered(earliest, latest)) {
        const range = planLedgerMonthClear(month)
        let count = 0
        for (const step of range) {
          const hit = this.db
            .prepare(`SELECT COUNT(*) n FROM ${step.table} WHERE ts >= ? AND ts < ?`)
            .get(step.from, step.to) as { n?: number }
          count += Number(hit?.n) || 0
        }
        rows.push({ month, count })
      }
    } catch (e) {
      console.warn('[kanso] mg: retention report failed', e)
    }
    return { retentionDays, bytes, months: foldLedgerMonthCounts(rows) }
  }

  /**
   * 清掉某一个月。**只碰那四张滚动表**（计划由 shared 的 `planLedgerMonthClear` 给，
   * 永久表不可能出现在里面）；月份形状不对就一行都不删。
   *
   * 删完跑一次 VACUUM：sqlite 删行只是把页标成可复用，文件一个字节都不小。
   * 玩家按这个钮多半就是冲着腾地方来的，卡片上那行占用却纹丝不动，
   * 看起来就像「点了没反应」。这一步只在他显式按下时跑，自动清理那条路不跑。
   *
   * @returns 删了几行。
   */
  clearLedgerMonth = (month: string): number => {
    const plan = planLedgerMonthClear(month)
    if (!plan.length) return 0
    let removed = 0
    try {
      for (const step of plan) {
        const result = this.db
          .prepare(`DELETE FROM ${step.table} WHERE ts >= ? AND ts < ?`)
          .run(step.from, step.to)
        removed += Number(result?.changes) || 0
      }
    } catch (e) {
      console.warn('[kanso] mg: month clear failed', e)
      this.expSamplesCache = null
      return removed
    }
    // 同 prune：快照集合变了，实得经验统计下次要用时重算
    this.expSamplesCache = null
    if (removed) {
      try {
        this.db.exec('VACUUM')
      } catch (e) {
        // 腾不出空间不算清理失败：行已经删掉了，只是文件没缩
        console.warn('[kanso] mg: vacuum after month clear failed', e)
      }
    }
    return removed
  }
}

export default new Ledger()
