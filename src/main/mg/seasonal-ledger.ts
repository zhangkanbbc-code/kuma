// 独立于 Electron 的永久账本投影。与实时报文共用同一套回填/统计实现。
import { detectSeasonalCampaigns, SEASONAL_EXCHANGES, SEASONAL_ITEMS } from '../../shared/seasonal-campaign'
import { sumCampaignRewards } from '../../shared/seasonal-history'
import type { CampaignHistory, CampaignReceipt, CampaignReward, CampaignTaskUse, ObservedQuest } from '../../shared/seasonal-history'
import { resolveQuestClaims } from '../../shared/quest-claims'
import { buildScrapRuleContext, deriveScrapPreparation } from './quest-scrap-rules'
import { powerupUseitemCost } from '../../shared/powerup-useitem'

type Db = { exec(sql: string): void; prepare(sql: string): any }
type RawMaster = { api_mst_useitem?: any[]; api_mst_slotitem?: any[] }
type QuestClaimRow = { quest_no: number; first_seen: number; rewards: string }
const QUEST_LIST = '/kcsapi/api_get_member/questlist'
const CLAIM = '/kcsapi/api_req_quest/clearitemget'
const EXCHANGE = '/kcsapi/api_req_member/itemuse'
const POWERUP = '/kcsapi/api_req_kaisou/powerup'
const DAY = 86_400_000

export class SeasonalLedger {
  private master: RawMaster = {}
  private cursor = 0
  private powerupCursor = 0
  private powerupBackfillDone = false
  private stopped = false
  private preparationWarnings = new Set<string>()
  backfillDone = false
  ready: Promise<void> = Promise.resolve()

  constructor(private db: Db, private questTitle: (no: number) => string = () => '', private getLode: (id: string) => any = () => null) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS seasonal_exchange_log (
        event_key TEXT PRIMARY KEY, ts INTEGER NOT NULL, campaign TEXT NOT NULL,
        item_id INTEGER NOT NULL, recipe TEXT NOT NULL, exchange_type INTEGER,
        cost INTEGER, rewards TEXT NOT NULL, target TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_seasonal_exchange_window ON seasonal_exchange_log(campaign, ts);
      -- 每任务每日一条出现时段；领奖每次一条，不存整份 questlist。
      CREATE TABLE IF NOT EXISTS quest_observations (
        observation_key TEXT PRIMARY KEY, quest_no INTEGER NOT NULL, kind TEXT NOT NULL,
        first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
        title TEXT NOT NULL, detail TEXT NOT NULL,
        select_no TEXT, select_no2 TEXT, rewards TEXT NOT NULL, seen_times TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_quest_observation_window ON quest_observations(first_seen, last_seen);
      CREATE INDEX IF NOT EXISTS idx_quest_observation_title ON quest_observations(quest_no, kind, last_seen);
      -- 未结账行也是已观测到的企划窗口；结账后保留完整回顾 JSON。
      CREATE TABLE IF NOT EXISTS seasonal_archive (
        campaign TEXT NOT NULL, opened INTEGER NOT NULL, expires_at INTEGER,
        item_id INTEGER NOT NULL, name TEXT NOT NULL, closed INTEGER, stats TEXT,
        PRIMARY KEY(campaign, opened)
      );
      CREATE TABLE IF NOT EXISTS seasonal_backfill_state (id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS seasonal_powerup_backfill_state (
        id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL, completed INTEGER NOT NULL
      );
    `)
    this.cursor = db.prepare('SELECT event_id FROM seasonal_backfill_state WHERE id = 1').get()?.event_id ?? 0
    const powerupState = db.prepare('SELECT * FROM seasonal_powerup_backfill_state WHERE id = 1').get()
    this.powerupCursor = powerupState?.event_id ?? 0
    this.powerupBackfillDone = powerupState?.completed === 1
  }

  setMaster(raw: RawMaster) { this.master = raw }

  private items = () => (this.master.api_mst_useitem ?? []).map(u => ({ id: Number(u.api_id), name: `${u.api_name}` }))
  private equips = () => (this.master.api_mst_slotitem ?? []).map(u => ({ id: Number(u.api_id), name: `${u.api_name}` }))

  // api_material 是本次奖励，不从随后资源快照再记一遍。空 api_getitem 不造未知项。
  parseRewards(data: any, quest = false): CampaignReward[] {
    const rewards: CampaignReward[] = []
    for (const [i, count] of (data.api_material ?? []).entries()) {
      if (Number(count) > 0) rewards.push({ kind: 'material', id: i + 1, count: Number(count) })
    }
    const entries = quest ? data.api_bounus ?? data.api_bonus ?? [] : data.api_getitem ?? []
    for (const entry of Array.isArray(entries) ? entries : [entries]) {
      if (entry == null) continue
      const item = entry.api_item ?? entry.api_slotitem ?? entry.api_useitem ?? entry
      const id = Number(item.api_useitem_id ?? item.api_slotitem_id ?? item.api_slotitem?.api_slotitem_id ?? item.api_id ?? entry.api_id) || 0
      const rawCount = entry.api_count ?? item.api_count ?? item.api_useitem_count ?? item.api_slotitem_count
      const rewardType = entry.api_type
      let kind: CampaignReward['kind'] = 'unknown'
      if (entry.api_slotitem != null) kind = 'slotitem'
      else if (entry.api_useitem != null) kind = 'useitem'
      else if (rewardType === 1 && quest) kind = 'material'
      else if (item.api_useitem_id != null || rewardType === 13) kind = 'useitem'
      else if (item.api_slotitem_id != null || rewardType === 12) kind = 'slotitem'
      else if (!quest && rewardType == null) {
        const use = this.items().some(u => u.id === id)
        const equip = this.equips().some(u => u.id === id)
        if (use !== equip) kind = use ? 'useitem' : 'slotitem'
      }
      // 报文明示类型的 id 即使当前主数据缺项也保留类型；显示层负责「未识别」。
      // api_slotitem 是一件装备实例；其余缺数量的形状不猜成一件。
      const count = rawCount == null ? entry.api_slotitem != null ? 1 : 0 : Number(rawCount)
      if (count === 0) kind = 'unknown'
      rewards.push({ kind, id, count, ...(item.api_name ? { name: `${item.api_name}` } : {}) })
    }
    return sumCampaignRewards(rewards)
  }

  private window(key: string, itemId: number, ts: number) {
    const spec = SEASONAL_ITEMS.find(s => s.key === key)!
    const catalog = SEASONAL_EXCHANGES.find(c => c.campaignKey === key && ts >= c.startsAt && ts < c.expiresAt)
    const old = this.db.prepare('SELECT * FROM seasonal_archive WHERE campaign = ? AND opened <= ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY opened DESC LIMIT 1').get(key, ts, ts)
    const opened = catalog?.startsAt ?? old?.opened ?? ts
    this.db.prepare(`INSERT INTO seasonal_archive(campaign, opened, expires_at, item_id, name)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(campaign, opened) DO NOTHING`)
      .run(key, opened, catalog?.expiresAt ?? null, itemId, `${catalog?.season ?? new Date(ts + 9 * 3600_000).getUTCFullYear()} ${spec.zhLabel}`)
  }

  observe(event: { ts: number; path: string; body: any; post: any }) {
    const { ts, path, post } = event
    if (event.body?.api_result != null && event.body.api_result !== 1) return
    const data = event.body?.api_data ?? event.body
    if (!data) return
    if (path === '/kcsapi/api_start2/getData') { this.setMaster(data); return }
    if (path === QUEST_LIST) {
      for (const q of data.api_list ?? []) {
        const no = Number(q?.api_no)
        if (!(no > 0)) continue
        const day = Math.floor((ts + 9 * 3600_000) / DAY)
        const observationKey = `seen:${no}:${day}:${q.api_title ?? ''}`
        const old = this.db.prepare('SELECT seen_times FROM quest_observations WHERE observation_key = ?').get(observationKey)
        const times: number[] = old ? JSON.parse(old.seen_times) : []
        if (!times.includes(ts)) times.push(ts)
        this.db.prepare(`INSERT INTO quest_observations VALUES (?, ?, 'seen', ?, ?, ?, ?, NULL, NULL, '[]', ?)
          ON CONFLICT(observation_key) DO UPDATE SET first_seen=MIN(first_seen,excluded.first_seen),
            last_seen=MAX(last_seen,excluded.last_seen),
            title=CASE WHEN excluded.last_seen >= last_seen THEN excluded.title ELSE title END,
            detail=CASE WHEN excluded.last_seen >= last_seen THEN excluded.detail ELSE detail END,
            seen_times=excluded.seen_times`)
          .run(observationKey, no, ts, ts, `${q.api_title ?? ''}`, `${q.api_detail ?? ''}`, JSON.stringify(times))
      }
      const campaigns = detectSeasonalCampaigns({ useitemMst: this.items(), useitems: {},
        quests: (data.api_list ?? []).filter((q: any) => q?.api_no > 0).map((q: any) => ({ no: q.api_no, title: q.api_title, detail: q.api_detail })) })
      for (const c of campaigns) this.window(c.key, c.itemId, ts)
    }
    if (path === CLAIM) {
      const no = Number(post.api_quest_id)
      if (!(no > 0)) return
      const rewards = this.parseRewards(data, true)
      this.db.prepare(`INSERT INTO quest_observations VALUES (?, ?, 'claim', ?, ?, '', '', ?, ?, ?, '[]')
        ON CONFLICT(observation_key) DO NOTHING`)
        .run(`claim:${ts}:${no}`, no, ts, ts, post.api_select_no ?? null, post.api_select_no2 ?? null, JSON.stringify(rewards))
      for (const reward of rewards.filter(r => r.kind === 'useitem')) {
        const spec = SEASONAL_ITEMS.find(s => this.items().find(u => u.id === reward.id)?.name === s.jpName)
        if (spec) this.window(spec.key, reward.id, ts)
      }
    }
    if (path === EXCHANGE && Number(data.api_caution_flag ?? 0) === 0) {
      const itemId = Number(post.api_useitem_id)
      const spec = SEASONAL_ITEMS.find(s => this.items().find(u => u.id === itemId)?.name === s.jpName)
      if (!spec) return
      this.window(spec.key, itemId, ts)
      const exchangeType = post.api_exchange_type == null ? null : Number(post.api_exchange_type)
      const catalog = SEASONAL_EXCHANGES.find(c => c.campaignKey === spec.key && ts >= c.startsAt && ts < c.expiresAt)
      const recipe = catalog?.recipes.find(r => r.exchangeType != null && r.exchangeType === exchangeType)
      this.db.prepare(`INSERT INTO seasonal_exchange_log VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(event_key) DO NOTHING`)
        .run(`${path}:${ts}:${itemId}`, ts, spec.key, itemId, recipe?.key ?? 'unknown', exchangeType,
          recipe?.cost ?? null, JSON.stringify(this.parseRewards(data)))
    }
    // 维护者账本 2026-10-19 已取得限定给餌实样；消耗依据与百科合证，见共用表。
    if (path === POWERUP) this.observePowerup(event)
  }

  private observePowerup(event: { ts: number; body: any; post: any }) {
    if (event.body?.api_result !== 1) return
    const { ts, post } = event
    const data = event.body.api_data
    const cost = powerupUseitemCost(post.api_limited_feed_type)
    if (!cost) return
    const itemId = cost.itemId
    const spec = SEASONAL_ITEMS.find(s => this.items().find(u => u.id === itemId)?.name === s.jpName)
    if (!spec) return
    this.window(spec.key, itemId, ts)
    this.db.prepare(`INSERT INTO seasonal_exchange_log VALUES (?, ?, ?, ?, 'powerup', NULL, ?, '[]', ?)
      ON CONFLICT(event_key) DO NOTHING`).run(`${POWERUP}:${ts}:${itemId}`, ts, spec.key, itemId, cost.cost,
        JSON.stringify({ rosterId: Number(post.api_id), ...(data.api_ship?.api_ship_id ? { mstId: Number(data.api_ship.api_ship_id) } : {}) }))
  }

  // 一次性补回旧游标已越过的改修；仅扫该路径，不重放其他历史，也不改库存。
  // 独立进度与收据同批提交，保留原 seasonal_backfill_state 的续填下界。
  private backfillPowerupsBatch(limit: number): number {
    const rows = this.db.prepare(`SELECT id, ts, body, post_body FROM events
      WHERE path = ? AND id > ? AND id <= ? AND body IS NOT NULL ORDER BY id LIMIT ?`)
      .all(POWERUP, this.powerupCursor, this.cursor, limit)
    const cursor = rows.length ? rows[rows.length - 1].id : this.powerupCursor
    const done = rows.length < limit
    this.db.exec('BEGIN')
    try {
      for (const row of rows) this.observePowerup({ ts: row.ts, body: JSON.parse(row.body), post: JSON.parse(row.post_body || '{}') })
      this.db.prepare(`INSERT INTO seasonal_powerup_backfill_state VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET event_id = excluded.event_id, completed = excluded.completed`).run(cursor, done ? 1 : 0)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
    this.powerupCursor = cursor
    this.powerupBackfillDone = done
    return rows.length
  }

  // 按 id 分页，单批上限 10 条；事务只包本批，下一批 setImmediate 让出主线程。
  backfillBatch(limit = 10): boolean {
    if (!this.powerupBackfillDone && this.backfillPowerupsBatch(limit) > 0) return false
    const rows = this.db.prepare(`SELECT id, ts, path, body, post_body FROM events
      WHERE id > ? AND path IN (?, ?, ?, ?) AND body IS NOT NULL ORDER BY id LIMIT ?`)
      .all(this.cursor, QUEST_LIST, CLAIM, EXCHANGE, POWERUP, limit)
    this.db.exec('BEGIN')
    try {
      for (const row of rows) {
        this.observe({ ts: row.ts, path: row.path, body: JSON.parse(row.body), post: JSON.parse(row.post_body || '{}') })
      }
      // 仅回填推进下界；实时 observe 仍靠业务键幂等，不能越过尚未处理的历史。
      // 与本批投影一起提交；events 行删除或正文置空后也不依赖游标所在行仍存在。
      if (rows.length) this.db.prepare(`INSERT INTO seasonal_backfill_state (id, event_id) VALUES (1, ?)
        ON CONFLICT(id) DO UPDATE SET event_id = excluded.event_id`).run(rows[rows.length - 1].id)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
    if (rows.length) this.cursor = rows[rows.length - 1].id
    this.backfillDone = rows.length < limit
    return this.backfillDone
  }

  startBackfill() {
    this.ready = new Promise<void>((resolve, reject) => {
      const step = () => {
        try {
          if (this.stopped) { resolve(); return }
          if (this.backfillBatch()) { this.enrichEventArchives(); resolve() }
          else setImmediate(step)
        } catch (error) { reject(error) }
      }
      setImmediate(step)
    })
    return this.ready
  }

  stop() { this.stopped = true }

  private resolveQuestTitle(no: number): string {
    return this.questTitle(no) || this.db.prepare(`SELECT title FROM quest_observations
      WHERE quest_no = ? AND kind = 'seen' AND title != '' ORDER BY last_seen DESC, first_seen DESC LIMIT 1`)
      .get(no)?.title || `任务 ${no}`
  }

  tasks(opened: number, closed: number, campaignKey?: string): ObservedQuest[] {
    const rows = this.db.prepare(`SELECT * FROM quest_observations WHERE first_seen < ? AND last_seen >= ? ORDER BY first_seen`)
      .all(closed, opened)
    const byNo = new Map<number, ObservedQuest>()
    const spec = SEASONAL_ITEMS.find(s => s.key === campaignKey)
    for (const row of rows.filter((r: any) => r.kind === 'seen')) {
      let text = `${row.title}\n${row.detail}`
      for (const excluded of spec?.excludeAliases ?? []) text = text.split(excluded).join('')
      const limited = [row.title, this.questTitle(row.quest_no)].some(title => /^【(?:期間限定|期间限定)/.test(title))
      const named = spec && [spec.jpName, ...spec.textAliases].some(n => text.includes(n))
      if (!limited && !named) continue
      const prev = byNo.get(row.quest_no)
      const times = (JSON.parse(row.seen_times) as number[]).filter(ts => ts >= opened && ts < closed)
      if (!times.length) continue
      const firstSeen = Math.min(...times)
      const lastSeen = Math.max(...times)
      if (prev) { prev.firstSeen = Math.min(prev.firstSeen!, firstSeen); prev.lastSeen = Math.max(prev.lastSeen!, lastSeen) }
      else byNo.set(row.quest_no, { no: row.quest_no, title: this.resolveQuestTitle(row.quest_no),
        firstSeen, lastSeen, claims: [] })
    }
    for (const row of rows.filter((r: any) => r.kind === 'claim' && r.first_seen >= opened)) {
      const rewards: CampaignReward[] = JSON.parse(row.rewards)
      // 领奖报文也能证明它属于本企划（含季节道具），不要求先观察到任务页。
      const seasonalReward = spec && rewards.some(r => r.kind === 'useitem' && this.items().find(u => u.id === r.id)?.name === spec.jpName)
      if (!byNo.has(row.quest_no) && seasonalReward) byNo.set(row.quest_no, {
        no: row.quest_no, title: this.resolveQuestTitle(row.quest_no), firstSeen: null, lastSeen: null, claims: [],
      })
      byNo.get(row.quest_no)?.claims.push({ ts: row.first_seen, selectNo: row.select_no, selectNo2: row.select_no2, rewards })
    }
    return [...byNo.values()]
  }

  enrichEventArchives() {
    for (const row of this.db.prepare('SELECT area_id, opened, closed, stats FROM event_archive').all()) {
      const stats = JSON.parse(row.stats)
      stats.quests = this.tasks(row.opened, row.closed + 1)
      this.db.prepare('UPDATE event_archive SET stats = ? WHERE area_id = ?').run(JSON.stringify(stats), row.area_id)
    }
  }

  private taskUses(claims: QuestClaimRow[], itemId: number): CampaignTaskUse[] {
    const pack = this.getLode('quests-scn')
    const context = buildScrapRuleContext(this.master, this.getLode('kcwiki-localization')?.data)
    const uses: CampaignTaskUse[] = []
    for (const claim of claims) {
      const seen = this.db.prepare(`SELECT title FROM quest_observations WHERE quest_no = ? AND kind = 'seen'
        AND first_seen <= ? ORDER BY last_seen DESC, first_seen DESC LIMIT 1`).get(claim.quest_no, claim.first_seen)
      const entry = resolveQuestClaims(pack, seen ? [{ no: claim.quest_no, title: seen.title }] : []).data[claim.quest_no]
      if (!entry) continue
      // 准备条件不等于消耗；只接正文明确说明准备物会消耗/消失的任务。
      if (!/(?:准备|準備)的[^。！!\n）)不]*(?:将被消耗|將被消耗|会被消耗|會被消耗|会消失|會消失)/.test(`${entry.desc}\n${entry.memo2}`)) continue
      const prepared = context && deriveScrapPreparation(entry.desc, entry.memo2, context)
      if (!prepared || prepared.partial) {
        if (!this.preparationWarnings.has(entry.code)) {
          console.warn(`[kuma] mg: 季节任务消耗未解析 ${claim.quest_no} ${entry.code}`)
          this.preparationWarnings.add(entry.code)
        }
        continue
      }
      const count = prepared.stockGoals.filter(g => g.kind === 'useitem' && g.id === itemId).reduce((n, g) => n + g.count, 0)
      if (count > 0) uses.push({ ts: claim.first_seen, no: claim.quest_no, code: entry.code, title: entry.name, count })
    }
    return uses
  }

  history(key: string, opened: number, stock: number | null = null): CampaignHistory {
    const win = this.db.prepare('SELECT * FROM seasonal_archive WHERE campaign = ? AND opened = ?').get(key, opened)
    const to = win.expires_at ?? win.closed ?? Infinity
    const quests = this.tasks(opened, to, key)
    const claims: QuestClaimRow[] = this.db.prepare(`SELECT * FROM quest_observations WHERE kind = 'claim' AND first_seen >= ? AND first_seen < ? ORDER BY first_seen`).all(opened, to)
    // 已结账的旧回顾保持原口径；开放企划每次由永久领奖事实重推，不依赖回填进度。
    const taskUses: CampaignTaskUse[] = win.closed == null ? this.taskUses(claims, win.item_id) : JSON.parse(win.stats).taskUses ?? []
    const sources: CampaignHistory['sources'] = []
    for (const row of claims) {
      const count = (JSON.parse(row.rewards) as CampaignReward[]).filter(r => r.kind === 'useitem' && r.id === win.item_id).reduce((n, r) => n + r.count, 0)
      if (!count) continue
      const source = sources.find(s => s.no === row.quest_no)
      if (source) { source.count += count; source.times++ }
      else sources.push({ no: row.quest_no, title: this.resolveQuestTitle(row.quest_no), count, times: 1 })
    }
    const logs: { ts: number; delta: number; cause: string | null }[] = this.db.prepare('SELECT ts, delta, cause FROM useitem_log WHERE item_id = ? AND ts >= ? AND ts < ? ORDER BY ts, rowid').all(win.item_id, opened, to)
    const receipts: CampaignReceipt[] = this.db.prepare('SELECT * FROM seasonal_exchange_log WHERE campaign = ? AND ts >= ? AND ts < ? ORDER BY ts').all(key, opened, to)
      .map((r: any) => ({ ts: r.ts, recipe: r.recipe, exchangeType: r.exchange_type, cost: r.cost, rewards: JSON.parse(r.rewards), ...(r.target ? { target: JSON.parse(r.target) } : {}) }))
    const otherUses: CampaignHistory['otherUses'] = []
    // 对道具账实际扣款逐笔配对。多次兑换后一次同步时只分配已知成本；未知档不均摊猜。
    const allocated = new Set<CampaignReceipt>()
    let otherGained = 0
    let otherGainTimes = 0
    let previousSync = opened - 1
    for (const log of logs) {
      const taskCost = taskUses.filter(u => u.ts > previousSync && u.ts <= log.ts).reduce((n, u) => n + u.count, 0)
      const reward = claims.filter(c => c.first_seen > previousSync && c.first_seen <= log.ts)
        .flatMap(c => JSON.parse(c.rewards) as CampaignReward[])
        .filter(r => r.kind === 'useitem' && r.id === win.item_id).reduce((n, r) => n + r.count, 0)
      const candidates = receipts.filter(r => !allocated.has(r) && r.ts > previousSync && r.ts <= log.ts &&
        (r.cost != null || log.cause === (r.recipe === 'powerup' ? POWERUP : EXCHANGE)))
      // 领奖不同步库存：同一窗口先还原奖励与任务成本，再按兑换成本拆分净差额。
      let remaining = reward - log.delta - taskCost
      for (const r of candidates.filter(r => r.cost != null)) {
        remaining -= r.cost!
        allocated.add(r)
      }
      const unknown = candidates.filter(r => r.cost == null)
      if (unknown.length === 1 && remaining > 0) { unknown[0].cost = remaining; allocated.add(unknown[0]); remaining = 0 }
      if (remaining > 0) otherUses.push({ ts: log.ts, count: remaining, cause: log.cause })
      if (remaining < 0) { otherGained -= remaining; otherGainTimes++ }
      previousSync = log.ts
    }
    // Party 的 exchange_type 101 已知；其它未知类型仍须有实际兑换、实际扣款且奖励完整命中目录。
    const catalog = SEASONAL_EXCHANGES.find(c => c.campaignKey === key && c.startsAt === opened)
    const exchange = detectSeasonalCampaigns({ useitemMst: this.items(), slotitemMst: this.equips(), now: opened,
      useitems: { [win.item_id]: 1 }, quests: [] }).find(c => c.key === key)?.exchange
    for (const r of receipts.filter(r => r.recipe === 'unknown' && allocated.has(r))) {
      for (const recipe of exchange?.recipes ?? []) {
        if (recipe.cost !== r.cost) continue
        const signature = (rewards: CampaignReward[]) => rewards.map(v => `${v.kind}:${v.id}:${v.count}`).sort().join('|')
        if (recipe.choices.some(choice => signature(choice) === signature(r.rewards))) r.recipe = recipe.key
      }
    }
    const uses: CampaignHistory['uses'] = []
    for (const r of receipts.filter(r => allocated.has(r))) {
      this.db.prepare('UPDATE seasonal_exchange_log SET cost = ?, recipe = ? WHERE campaign = ? AND ts = ? AND item_id = ? AND (cost IS NOT ? OR recipe != ?)')
        .run(r.cost, r.recipe, key, r.ts, win.item_id, r.cost, r.recipe)
    }
    for (const r of receipts) {
      if (r.cost == null) continue
      const use = uses.find(u => u.recipe === r.recipe)
      if (use) { use.count += r.cost; use.times++ }
      else uses.push({ recipe: r.recipe, count: r.cost, times: 1 })
    }
    for (const row of taskUses) {
      const use = uses.find(u => u.recipe === 'quest' && u.no === row.no)
      if (use) { use.count += row.count; use.times++ }
      else uses.push({ recipe: 'quest', no: row.no, code: row.code, title: row.title, count: row.count, times: 1 })
    }
    if (otherUses.length) uses.push({ recipe: 'other', count: otherUses.reduce((n, r) => n + r.count, 0), times: otherUses.length })
    const taskGained = sources.reduce((n, s) => n + s.count, 0)
    if (otherGained > 0) sources.push({ no: null, title: '其他', count: otherGained,
      times: otherGainTimes })
    return { key, itemId: win.item_id, name: win.name, opened, closed: win.closed, expiresAt: catalog?.expiresAt ?? win.expires_at,
      gained: taskGained + otherGained, spent: uses.reduce((n, u) => n + u.count, 0), stock,
      sources, uses, ...(taskUses.length ? { taskUses } : {}), receipts, otherUses, rewards: sumCampaignRewards(receipts.filter(r => r.recipe !== 'powerup').flatMap(r => r.rewards)),
      party: receipts.filter(r => r.recipe === 'party'), quests }
  }

  settle(input: { now: number; stock: Record<number, number>; stockTs: number | null; quests: { no: number; title?: string; detail?: string }[]; questsTs: number | null }) {
    if (!this.backfillDone) return
    for (const c of detectSeasonalCampaigns({ useitemMst: this.items(), useitems: input.stock, quests: input.quests })) {
      if (c.stock > 0) this.window(c.key, c.itemId, input.stockTs ?? input.now)
    }
    const active = new Set(detectSeasonalCampaigns({ useitemMst: this.items(), useitems: {}, quests: input.quests }).map(c => c.key))
    for (const win of this.db.prepare('SELECT * FROM seasonal_archive').all()) {
      // 未有可信截止目录的企划只积累事实，等目录给出结束下界再结账。
      if (win.expires_at == null || input.now < win.expires_at || input.stockTs == null || input.questsTs == null ||
        input.stockTs < win.expires_at || input.questsTs < win.expires_at || (input.stock[win.item_id] ?? 0) > 0 || active.has(win.campaign)) continue
      const report = this.history(win.campaign, win.opened, 0)
      report.closed = win.expires_at
      if (win.stats === JSON.stringify(report)) continue
      this.db.prepare(`UPDATE seasonal_archive SET closed = ?, stats = ? WHERE campaign = ? AND opened = ?`)
        .run(win.expires_at, JSON.stringify(report), win.campaign, win.opened)
    }
  }

  reconcileUseitems(itemIds: number[]) {
    for (const win of this.db.prepare('SELECT * FROM seasonal_archive').all()) {
      if (itemIds.includes(win.item_id)) this.history(win.campaign, win.opened)
    }
  }

  current(stock: Record<number, number>, now: number): CampaignHistory[] {
    return this.db.prepare('SELECT * FROM seasonal_archive WHERE closed IS NULL AND opened <= ? ORDER BY opened DESC').all(now)
      .map((w: any) => this.history(w.campaign, w.opened, stock[w.item_id] ?? 0))
  }

  archives(): CampaignHistory[] {
    return this.db.prepare('SELECT stats FROM seasonal_archive WHERE closed IS NOT NULL ORDER BY opened DESC').all().map((r: any) => JSON.parse(r.stats))
  }
}
