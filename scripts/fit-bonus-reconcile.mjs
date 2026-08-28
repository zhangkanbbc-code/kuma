// 装备加成对账：拿 ElectronicObserver 的 FitBonuses.json 当**印证票**核我们自己的包。
//
//   node scripts/fit-bonus-reconcile.mjs
//
// 定位要先说死：EO 那份是 NOASSERTION，**不能随包、不入仓**。这里只在维护者显式
// 跑这条命令时下到系统临时目录，用完就留在那儿；产出物只有一份差异报告
//（assets/review/，已 gitignore）。发布侧的数据基座是 zh.kcwiki 那张 CC 表，
// EO 只用来回答一个问题：「我们解出来的数，跟另一份独立整理的对不对得上」。
//
// ---- 两边不同构，所以只在**共同分母**上比 ----
//
// EO 是「类/舰两行相加」的模型（`shipClass` 给全级一个底值，`shipX` 再给具体形态加一笔），
// 分档靠 `level`/`num` 逐条追加；kcwiki 是「分区 + 分档总值」的模型（`其他◯◯型` 与
// 逐舰行互斥，`改修`/`数量` 的每一档写的是**该档的总值**）。直接逐行比必然满屏假冲突。
// 共同分母取两边语义都确定的那一格：
//
//   ★0 · 装 1 件 · 不带协同装备 · 不看所载电探 · 不限出击区域
//
// 在这一格上两边都是「把所有命中的行加起来」，可以逐 (装备 × 形态) 对数。
// 差异分三类：一致 / 覆盖差（一边有一边整件没有）/ 真矛盾（同格不同数）。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadStart2MasterArray } from './lib/start2.mjs'
import {
  KNOWN_FIT_BONUS_CONFLICTS,
  PENDING_FIT_BONUS_CONFLICTS,
  fitBonusConflictDigest,
  fitBonusConflictFingerprint,
} from './lib/fit-bonus-conflicts.mjs'
import { shipNationalityIdFromSortId } from '../src/shared/ship-nationality.ts'

const root = path.join(fileURLToPath(import.meta.url), '..', '..')
const EO_URL = 'https://cdn.jsdelivr.net/gh/ElectronicObserverEN/Data@master/Data/FitBonuses.json'

/** EO 的数值字段用的是 api_mst_slotitem 的缩写；换算成我们自己的字段名再比。 */
const EO_STAT_TO_OURS = {
  houg: 'fire',
  raig: 'torpedo',
  baku: 'bomb',
  tyku: 'aa',
  souk: 'armor',
  kaih: 'evasion',
  tais: 'asw',
  saku: 'los',
  houm: 'accuracy',
  leng: 'range',
}

const fetchEo = async () => {
  const cacheDir = path.join(os.tmpdir(), 'kanso-fit-bonus-reconcile')
  mkdirSync(cacheDir, { recursive: true })
  const cache = path.join(cacheDir, 'eo-fit-bonuses.json')
  if (existsSync(cache)) {
    const age = Date.now() - Date.parse(JSON.parse(readFileSync(cache, 'utf8')).__fetchedAt ?? 0)
    if (Number.isFinite(age) && age < 24 * 3_600_000) {
      return JSON.parse(readFileSync(cache, 'utf8')).rows
    }
  }
  const response = await fetch(EO_URL, { headers: { 'User-Agent': 'kanso-lodes' } })
  if (!response.ok) throw new Error(`EO FitBonuses: HTTP ${response.status}`)
  const rows = await response.json()
  writeFileSync(cache, JSON.stringify({ __fetchedAt: new Date().toISOString(), rows }))
  return rows
}

const addStats = (into, stats) => {
  for (const [key, value] of Object.entries(stats ?? {})) {
    if (!Number.isFinite(value) || value === 0) continue
    into[key] = (into[key] ?? 0) + value
  }
  return into
}

const sameStats = (left, right) => {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const key of keys) if ((left[key] ?? 0) !== (right[key] ?? 0)) return false
  return true
}

const isEmpty = (stats) => Object.keys(stats).length === 0

/**
 * kcwiki 侧：共同分母那一格的合计。
 *
 * `specific` 打开时按「最具体的一层胜出」结算：命中同一艘舰的无条件行里，
 * 只留精确形态那一层；没有形态行才退到舰级行、再退到舰种行。
 * 这不是拍脑袋——是拿 EO 当第二把尺子量出来的（两种读法的一致格数见报告的 `model`）：
 * 例如 50 号（20.3cm(3号)連装砲）对最上改二，上游形态行给 火力3/回避1，
 * 舰级行给 火力2/回避1，而 EO 那边是「舰级 2+1 → 形态再 +1」＝火力3/回避1。
 * 形态行写的就是**总值**，与舰级行相加会凭空多出一份。
 */
const ourBaseline = (entry, ship, ctype, stype, specific) => {
  const matched = []
  for (const rule of entry.rules) {
    if (rule.need?.with || (rule.need?.star ?? 0) > 0) continue
    if (rule.gain.kind === 'byArea') continue
    const hits = (set) =>
      set?.forms?.includes(ship)
        ? 3
        : set?.classes?.includes(ctype)
          ? 2
          : set?.types?.includes(stype)
            ? 1
            : set?.all
              ? 0
              : -1
    const level = hits(rule.who)
    if (level < 0 || hits(rule.not) >= 0) continue
    matched.push({ rule, level })
  }
  const floor = specific && matched.length ? Math.max(...matched.map((row) => row.level)) : -1
  const total = {}
  for (const { rule, level } of matched) {
    if (level < floor) continue
    if (rule.gain.kind === 'flat') addStats(total, rule.gain.flat)
    else if (rule.gain.kind === 'byStar') {
      const step = rule.gain.steps.find((s) => s.from === 0)
      if (step) addStats(total, step.stats)
    } else if (rule.gain.kind === 'byCount') {
      const step = rule.gain.counts.find((s) => s.count === 1)
      if (step) addStats(total, step.stats)
    }
  }
  return total
}

/** EO 侧：同一格的合计。 */
const eoBaseline = (bonuses, ship, root, ctype, stype, nationality) => {
  const total = {}
  for (const bonus of bonuses) {
    if (bonus.requires || bonus.requiresType) continue
    if ((bonus.level ?? 0) > 0) continue
    if ((bonus.num ?? 1) > 1) continue
    if (!bonus.bonus) continue // bonusSR/AR/AccR 是按所载电探分档，本源没有这一维
    // 同一条 bonus 里出现的几个选择器是**与**关系，不是或——
    // `{shipType:[8,9,10], shipNationality:[4]}` 说的是「美系战舰」，
    // 按或读会把扶桑也算进去（实测这一条错法独自制造了上百格假冲突）。
    const match = [
      bonus.shipX && bonus.shipX.includes(ship),
      bonus.shipS && bonus.shipS.includes(root),
      bonus.shipClass && bonus.shipClass.includes(ctype),
      bonus.shipType && bonus.shipType.includes(stype),
      bonus.shipNationality && bonus.shipNationality.includes(nationality),
    ].filter((value) => value !== undefined && value !== null)
    if (!match.length || match.some((value) => value === false)) continue
    const stats = {}
    for (const [key, value] of Object.entries(bonus.bonus)) {
      const ours = EO_STAT_TO_OURS[key]
      if (ours) stats[ours] = value
    }
    addStats(total, stats)
  }
  return total
}

const main = async () => {
  const packFile = path.join(root, 'assets', 'lodes', 'kcwiki-fit-bonus.json')
  if (!existsSync(packFile)) {
    throw new Error('先跑 npm run lodes:fetch -- --only=kcwiki-fit-bonus 生成本方包，再来对账')
  }
  const ours = JSON.parse(readFileSync(packFile, 'utf8')).data
  const ships = loadStart2MasterArray('api_mst_ship', root).filter(
    (ship) => Number(ship.api_id) > 0 && Number(ship.api_id) < 1_500 && Number(ship.api_sortno) > 0,
  )
  if (!ships.length) throw new Error('对账需要 api_start2 主数据快照（本机跑过一次 kuma 并登录游戏后就会有）')
  const slots = loadStart2MasterArray('api_mst_slotitem', root)

  // 链首（EO 的 shipS 认这个）。先认 api_mst_shipupgrade 的 api_original_ship_id：
  // 可逆改造（鳳翔改二 ⇄ 鳳翔改二戦 互指 api_aftershipid）会让「按 after 反向走」
  // 卡在环里走不回链首，实测把 894 的链首算成 894 而不是 89。
  const originalOf = new Map()
  for (const upgrade of loadStart2MasterArray('api_mst_shipupgrade', root)) {
    const id = Number(upgrade?.api_id)
    const original = Number(upgrade?.api_original_ship_id)
    if (id > 0 && original > 0) originalOf.set(id, original)
  }
  const beforeOf = new Map()
  for (const ship of ships) {
    const after = Number.parseInt(`${ship.api_aftershipid ?? 0}`, 10)
    if (after > 0 && !beforeOf.has(after)) beforeOf.set(after, Number(ship.api_id))
  }
  const rootOf = (id) => {
    if (originalOf.has(id)) return originalOf.get(id)
    const seen = new Set()
    let current = id
    while (beforeOf.has(current) && !seen.has(current)) {
      seen.add(current)
      current = beforeOf.get(current)
      if (originalOf.has(current)) return originalOf.get(current)
    }
    return current
  }

  const eo = await fetchEo()
  const eoByEquip = new Map()
  for (const record of eo) {
    const bonuses = record.bonuses ?? []
    for (const id of record.ids ?? []) {
      eoByEquip.set(id, [...(eoByEquip.get(id) ?? []), ...bonuses])
    }
    for (const type of record.types ?? []) {
      for (const slot of slots) {
        if (Number(slot.api_type?.[2]) !== Number(type)) continue
        const id = Number(slot.api_id)
        eoByEquip.set(id, [...(eoByEquip.get(id) ?? []), ...bonuses])
      }
    }
  }

  const ourIds = new Set(Object.keys(ours.equips).map(Number))
  const eoIds = new Set(eoByEquip.keys())
  const shared = [...ourIds].filter((id) => eoIds.has(id)).sort((a, b) => a - b)

  // 「最具体的一层胜出」vs「所有命中行相加」——两种读法各跑一遍，把一致格数摆出来。
  // 结论要靠数说话，不靠语感（见 ourBaseline 的注释）。
  const model = { specific: 0, additive: 0 }
  for (const equipId of shared) {
    const entry = ours.equips[`${equipId}`]
    const bonuses = eoByEquip.get(equipId)
    for (const ship of ships) {
      const id = Number(ship.api_id)
      const ctype = Number(ship.api_ctype)
      const stype = Number(ship.api_stype)
      const theirs = eoBaseline(
        bonuses,
        id,
        rootOf(id),
        ctype,
        stype,
        shipNationalityIdFromSortId(ship.api_sort_id),
      )
      if (isEmpty(theirs)) continue
      if (sameStats(ourBaseline(entry, id, ctype, stype, true), theirs)) model.specific++
      if (sameStats(ourBaseline(entry, id, ctype, stype, false), theirs)) model.additive++
    }
  }

  let agree = 0
  let onlyOurs = 0
  let onlyEo = 0
  const conflicts = []
  for (const equipId of shared) {
    const entry = ours.equips[`${equipId}`]
    const bonuses = eoByEquip.get(equipId)
    for (const ship of ships) {
      const id = Number(ship.api_id)
      const mine = ourBaseline(entry, id, Number(ship.api_ctype), Number(ship.api_stype), true)
      const theirs = eoBaseline(
        bonuses,
        id,
        rootOf(id),
        Number(ship.api_ctype),
        Number(ship.api_stype),
        shipNationalityIdFromSortId(ship.api_sort_id),
      )
      if (isEmpty(mine) && isEmpty(theirs)) continue
      if (sameStats(mine, theirs)) {
        agree++
        continue
      }
      if (isEmpty(theirs)) {
        onlyOurs++
        continue
      }
      if (isEmpty(mine)) {
        onlyEo++
        continue
      }
      conflicts.push({
        equipId,
        equipName: entry.nameJa,
        shipId: id,
        shipName: `${ship.api_name}`,
        ours: mine,
        eo: theirs,
      })
    }
  }

  // 台账自失效：两边现在给的数与台账记的对不上就作废，不许拿过期的裁决继续说话
  const byEquip = new Map()
  for (const row of conflicts) byEquip.set(row.equipId, [...(byEquip.get(row.equipId) ?? []), row])
  const ledger = { matched: [], stale: [], missing: [] }
  for (const known of KNOWN_FIT_BONUS_CONFLICTS) {
    const rows = byEquip.get(known.equipId)
    if (!rows?.length) {
      ledger.missing.push(known.equipId)
      continue
    }
    const now = fitBonusConflictFingerprint(rows)
    if (now !== known.fingerprint) ledger.stale.push({ equipId: known.equipId, was: known.fingerprint, now })
    else ledger.matched.push(known.equipId)
  }
  // 待裁清单同样自失效：数变了就说明这件装备要重新看，不能再挂着一条旧摘要装作还在等
  const pendingLedger = { matched: [], stale: [], missing: [], unlisted: [] }
  for (const known of PENDING_FIT_BONUS_CONFLICTS) {
    const rows = byEquip.get(known.equipId)
    if (!rows?.length) {
      pendingLedger.missing.push(known.equipId)
      continue
    }
    const now = fitBonusConflictDigest(rows)
    if (now !== known.digest) pendingLedger.stale.push({ equipId: known.equipId, was: known.digest, now })
    else pendingLedger.matched.push(known.equipId)
  }
  const listed = new Set(KNOWN_FIT_BONUS_CONFLICTS.map((known) => known.equipId))
  const unlisted = conflicts.filter((row) => !listed.has(row.equipId))
  const knownPending = new Set(PENDING_FIT_BONUS_CONFLICTS.map((known) => known.equipId))
  for (const equipId of byEquip.keys()) {
    if (!listed.has(equipId) && !knownPending.has(equipId)) pendingLedger.unlisted.push(equipId)
  }
  // 未入台账的按装备聚成一份待裁清单——315 格逐格手写没法看，按件读才读得动
  const pending = [...byEquip]
    .filter(([equipId]) => !listed.has(equipId))
    .map(([equipId, rows]) => ({
      equipId,
      equipName: rows[0].equipName,
      cells: rows.length,
      fingerprint: fitBonusConflictFingerprint(rows),
      sample: rows.slice(0, 3).map((row) => ({ ship: row.shipName, ours: row.ours, eo: row.eo })),
    }))
    .sort((left, right) => right.cells - left.cells)

  const report = {
    generatedAt: new Date().toISOString(),
    baseline: '★0 · 1 件 · 无协同装备 · 不看所载电探 · 不限区域',
    coverage: {
      ourEquips: ourIds.size,
      eoEquips: eoIds.size,
      shared: shared.length,
      ourOnlyEquips: [...ourIds].filter((id) => !eoIds.has(id)).sort((a, b) => a - b),
      eoOnlyEquips: [...eoIds].filter((id) => !ourIds.has(id)).sort((a, b) => a - b),
    },
    cells: { agree, onlyOurs, onlyEo, conflicts: conflicts.length },
    model,
    ledger,
    pendingLedger,
    pending,
    conflicts,
  }
  const reviewDir = path.join(root, 'assets', 'review')
  mkdirSync(reviewDir, { recursive: true })
  const output = path.join(reviewDir, 'fit-bonus-reconcile.json')
  writeFileSync(output, JSON.stringify(report, null, 1))

  console.log(
    `[fit-bonus] 覆盖：本方 ${ourIds.size} 件 / EO ${eoIds.size} 件 / 两边都有 ${shared.length} 件` +
      `（本方独有 ${report.coverage.ourOnlyEquips.length}、EO 独有 ${report.coverage.eoOnlyEquips.length}）`,
  )
  console.log(
    `[fit-bonus] 共同分母逐格：一致 ${agree} · 仅本方 ${onlyOurs} · 仅 EO ${onlyEo} · 真矛盾 ${conflicts.length}`,
  )
  console.log(
    `[fit-bonus] 台账：对上 ${ledger.matched.length} · 指纹已变 ${ledger.stale.length} · ` +
      `台账有而现实没有 ${ledger.missing.length} · 现实有而台账没有 ${unlisted.length} 格 / ${pending.length} 件`,
  )
  console.log(
    `[fit-bonus] 待裁清单：对上 ${pendingLedger.matched.length} · 数已变 ${pendingLedger.stale.length} · ` +
      `清单有而现实没有 ${pendingLedger.missing.length} · 现实有而清单没有 ${pendingLedger.unlisted.length}`,
  )
  console.log(`[fit-bonus] 差异报告 → ${output}`)
}

await main()
