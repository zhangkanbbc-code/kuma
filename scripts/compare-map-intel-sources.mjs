// 维护者侧的**只读对账报告**：zh.kcwiki 海域页 × 现行 map-intel 包，逐图逐点比。
//
// 只打印、不写包。换源之前先把「能不能对上」变成可复跑的东西——
// 91.7% 这个数字如果只在某次调研的聊天记录里，下次没人能复现它。
//
//   node scripts/compare-map-intel-sources.mjs             # 抓 kcwiki（900ms 间隔）
//   node scripts/compare-map-intel-sources.mjs --cache=DIR # 用已有的页面缓存，不发请求
//   node scripts/compare-map-intel-sources.mjs --air       # 加做制空值反校（见下）
//
// 三份报告：
//   ① 敌编成：按 mstId 多重集比。两票一致 / 仅 kcwiki / 仅现包，逐图列。
//   ② 掉落：中文名经 kcwiki-ships 的「中文名」列解号后，与现包按 (点, mstId) 比。
//   ③ 制空值反校（`--air`）：kcwiki 逐编成给的「制空值」是**另一份独立整理**，
//      拿它 diff 我们自己按 abyssal-stats + 主数据算出来的深海制空。
//      对不上通常意味着装备表滞后或某个形态的 kc3_slots 过期——
//      这是印证票，**不进随包展示层**（用户 2026-08-22 裁定 #7）。

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { KCWIKI_MAP_CODES, fetchKcwikiMapPages, parseKcwikiMapPage } from './lib/kcwiki-map.mjs'
import { buildDropNameResolver } from './lib/map-drops.mjs'
import { loadStart2MasterArray } from './lib/start2.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const arg = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.split('=')[1]
const cacheDir = arg('cache')
const wantAir = process.argv.includes('--air')

// 换源基线：实测 91.7% / 81.1%（2026-08-22），各留几个点余量。
// 掉到线下就是上游改版或解析器坏了，不是「社区又编辑了几条」。
export const ENEMY_MATCH_FLOOR = 0.88
export const DROP_COVER_FLOOR = 0.75

const readPack = (id) => JSON.parse(readFileSync(path.join(root, 'assets', 'lodes', `${id}.json`), 'utf8'))

/** 缓存文件形状与调研期的探针一致：`{ parse: { text } }`，删掉才会重抓。 */
const loadCached = (code) => {
  if (!cacheDir) return null
  const file = path.join(cacheDir, `cov-${code}.json`)
  if (!existsSync(file)) return null
  return JSON.parse(readFileSync(file, 'utf8'))?.parse?.text ?? null
}

const compKey = (ids) => [...ids].sort((left, right) => left - right).join(',')

/**
 * 中文舰名 → mstId。与出包那一层**共用同一个解析器**（scripts/lib/map-drops.mjs）——
 * 各写一份的话，对账报告会说「27 条解不出」而出包那边其实解得出来，
 * 两个数对不上就没人知道该信哪个。
 */
const buildZhIndex = () => buildDropNameResolver(readPack('kcwiki-ships').data)

// ---- 制空值反校：我们自己算的深海制空 ----
//
// 口径与运行时一致（src/renderer/combat-forecast.ts 的 enemyEquipment + airPower）：
// 深海舰没有熟练度与改修，所以只剩 floor(sqrt(搭载) × 对空)，逐槽求和。
const AIR_TYPES = new Set([6, 7, 8, 11, 26, 45, 47, 48, 56, 57, 58])

const buildAirCalculator = () => {
  const slotitems = new Map()
  for (const item of loadStart2MasterArray('api_mst_slotitem', root)) {
    slotitems.set(Number(item.api_id), {
      type2: Number(item.api_type?.[2] ?? 0),
      antiAir: Number(item.api_tyku ?? 0),
    })
  }
  if (!slotitems.size) return null
  const stats = readPack('abyssal-stats').data
  return (mstIds) => {
    let total = 0
    let unknown = 0
    for (const mstId of mstIds) {
      const entry = stats?.[`${mstId}`]
      const slots = Array.isArray(entry?.kc3_slots) ? entry.kc3_slots : null
      const counts = Array.isArray(entry?.api_maxeq) ? entry.api_maxeq : []
      if (!slots) {
        unknown += 1
        continue
      }
      for (const [index, equipId] of slots.entries()) {
        const master = slotitems.get(Number(equipId))
        if (!master || !AIR_TYPES.has(master.type2) || master.antiAir <= 0) continue
        const planes = Number(counts[index] ?? 0)
        if (planes <= 0) continue
        total += Math.floor(Math.sqrt(planes) * master.antiAir)
      }
    }
    return { total, unknown }
  }
}

const main = async () => {
  const pack = readPack('map-intel')
  const maps = pack.data.maps
  const resolveName = buildZhIndex()

  const pages = new Map()
  const missing = []
  for (const code of KCWIKI_MAP_CODES) {
    const cached = loadCached(code)
    if (cached) pages.set(code, cached)
  }
  const toFetch = KCWIKI_MAP_CODES.filter((code) => !pages.has(code))
  if (toFetch.length) {
    console.log(`[compare] 需要抓取 ${toFetch.length} 图（900ms 间隔）…`)
    const { pages: fetched, failed } = await fetchKcwikiMapPages({
      codes: toFetch,
      onProgress: (code, done, total) => process.stdout.write(`\r[compare] ${done}/${total} ${code}   `),
    })
    process.stdout.write('\n')
    for (const [code, page] of fetched) pages.set(code, page.html)
    for (const fail of failed) missing.push(`${fail.code}: ${fail.message}`)
  }
  if (missing.length) {
    console.error('[compare] 取页失败：', missing.join(' / '))
  }

  const airOf = wantAir ? buildAirCalculator() : null
  if (wantAir && !airOf) {
    console.error('[compare] 没有 api_start2 主数据快照，制空反校跳过（跑过一次 kuma 并登录游戏后会有）')
  }

  const totals = {
    kNodes: 0, kComps: 0, kExp: 0, kAir: 0,
    pNodes: 0, pComps: 0, pPinned: 0,
    same: 0, onlyK: 0, onlyP: 0,
    kDropNodes: 0, kDrops: 0, pDrops: 0, dropSame: 0, dropOnlyK: 0, dropOnlyP: 0,
    unresolvedNames: new Set(),
  }
  const airDiffs = []
  const warnings = []

  console.log('\n===== ① 敌编成（按 mstId 多重集）=====')
  console.log('| 图 | kc点 | kc编成 | 带exp | 带制空 | 包点 | 包编成 | 包已定号 | 两票一致 | 仅kcwiki | 仅现包 |')
  console.log('|---|---|---|---|---|---|---|---|---|---|---|')
  const dropRows = []
  for (const code of KCWIKI_MAP_CODES) {
    const html = pages.get(code)
    if (!html) continue
    const parsed = parseKcwikiMapPage(html)
    for (const warning of parsed.warnings) warnings.push(`${code}: ${warning}`)
    const packNodes = maps[code]?.nodes ?? {}

    const kEnemyNodes = Object.entries(parsed.nodes).filter(([, value]) => value.enemyComps.length)
    const kComps = kEnemyNodes.reduce((sum, [, value]) => sum + value.enemyComps.length, 0)
    const kExp = kEnemyNodes.reduce((sum, [, v]) => sum + v.enemyComps.filter((c) => c.exp).length, 0)
    const kAir = kEnemyNodes.reduce((sum, [, v]) => sum + v.enemyComps.filter((c) => c.air).length, 0)
    const pEnemyNodes = Object.keys(packNodes).filter((node) => packNodes[node].enemyComps.length)
    const pComps = pEnemyNodes.reduce((sum, node) => sum + packNodes[node].enemyComps.length, 0)
    const pPinned = pEnemyNodes.reduce(
      (sum, node) => sum + packNodes[node].enemyComps.filter((comp) => comp.shipIds?.length).length,
      0,
    )
    let same = 0
    let onlyK = 0
    let onlyP = 0
    for (const node of new Set([...kEnemyNodes.map(([n]) => n), ...pEnemyNodes])) {
      const kSet = new Set((parsed.nodes[node]?.enemyComps ?? []).map((comp) => compKey(comp.ships)))
      const pSet = new Set(
        (packNodes[node]?.enemyComps ?? [])
          .filter((comp) => comp.shipIds?.length)
          .map((comp) => compKey(comp.shipIds)),
      )
      for (const key of kSet) (pSet.has(key) ? same++ : onlyK++)
      for (const key of pSet) if (!kSet.has(key)) onlyP++
    }
    totals.kNodes += kEnemyNodes.length
    totals.kComps += kComps
    totals.kExp += kExp
    totals.kAir += kAir
    totals.pNodes += pEnemyNodes.length
    totals.pComps += pComps
    totals.pPinned += pPinned
    totals.same += same
    totals.onlyK += onlyK
    totals.onlyP += onlyP
    console.log(
      `| ${code} | ${kEnemyNodes.length} | ${kComps} | ${kExp} | ${kAir} | ${pEnemyNodes.length} | ` +
        `${pComps} | ${pPinned} | ${same} | ${onlyK} | ${onlyP} |`,
    )

    if (airOf) {
      for (const [node, value] of kEnemyNodes) {
        for (const comp of value.enemyComps) {
          if (!Number.isInteger(comp.air)) continue
          const mine = airOf(comp.ships)
          if (mine.unknown) continue
          if (mine.total !== comp.air) {
            airDiffs.push({ code, node, wiki: comp.air, mine: mine.total, ships: comp.ships })
          }
        }
      }
    }

    // ---- 掉落 ----
    let kDropNodes = 0
    let kDrops = 0
    let dropSame = 0
    let dropOnlyK = 0
    let dropOnlyP = 0
    const kDropIds = new Map()
    for (const [node, value] of Object.entries(parsed.nodes)) {
      if (!value.drops.length) continue
      kDropNodes += 1
      const ids = new Set()
      for (const drop of value.drops) {
        const { id, via } = resolveName(drop.name)
        if (!id) {
          totals.unresolvedNames.add(`${code}/${node}/${drop.name}（${via}）`)
          continue
        }
        ids.add(id)
      }
      kDrops += ids.size
      kDropIds.set(node, ids)
    }
    let pDrops = 0
    for (const [node, value] of Object.entries(packNodes)) {
      const pIds = new Set(value.ships.map((ship) => ship.id))
      pDrops += pIds.size
      const kIds = kDropIds.get(node) ?? new Set()
      for (const id of pIds) if (!kIds.has(id)) dropOnlyP++
    }
    for (const [node, ids] of kDropIds) {
      const pIds = new Set((packNodes[node]?.ships ?? []).map((ship) => ship.id))
      for (const id of ids) (pIds.has(id) ? dropSame++ : dropOnlyK++)
    }
    totals.kDropNodes += kDropNodes
    totals.kDrops += kDrops
    totals.pDrops += pDrops
    totals.dropSame += dropSame
    totals.dropOnlyK += dropOnlyK
    totals.dropOnlyP += dropOnlyP
    dropRows.push(
      `| ${code} | ${kDropNodes} | ${kDrops} | ${pDrops} | ${dropSame} | ${dropOnlyK} | ${dropOnlyP} |`,
    )
  }
  console.log(
    `| **合计** | ${totals.kNodes} | ${totals.kComps} | ${totals.kExp} | ${totals.kAir} | ` +
      `${totals.pNodes} | ${totals.pComps} | ${totals.pPinned} | ${totals.same} | ${totals.onlyK} | ${totals.onlyP} |`,
  )
  const matchRate = totals.pPinned ? totals.same / totals.pPinned : 0
  console.log(
    `\nkcwiki 编成命中现包已定号编成：${(matchRate * 100).toFixed(1)}%` +
      `（基线 ≥ ${(ENEMY_MATCH_FLOOR * 100).toFixed(0)}%）` +
      `${matchRate >= ENEMY_MATCH_FLOOR ? '' : '  ⛔ 跌破基线'}`,
  )

  console.log('\n===== ② 掉落（中文名解号后按 (点, mstId) 比）=====')
  console.log('| 图 | kc掉落点 | kc舰次 | 包舰次 | 两票一致 | 仅kcwiki | 仅现包 |')
  console.log('|---|---|---|---|---|---|---|')
  for (const row of dropRows) console.log(row)
  console.log(
    `| **合计** | ${totals.kDropNodes} | ${totals.kDrops} | ${totals.pDrops} | ` +
      `${totals.dropSame} | ${totals.dropOnlyK} | ${totals.dropOnlyP} |`,
  )
  const dropRate = totals.pDrops ? totals.dropSame / totals.pDrops : 0
  console.log(
    `\nkcwiki 掉落覆盖现包：${(dropRate * 100).toFixed(1)}%（基线 ≥ ${(DROP_COVER_FLOOR * 100).toFixed(0)}%）` +
      `${dropRate >= DROP_COVER_FLOOR ? '' : '  ⛔ 跌破基线'}`,
  )
  if (totals.unresolvedNames.size) {
    console.log(`\n⚠ 中文名解不出 mstId 的 ${totals.unresolvedNames.size} 条：`)
    for (const name of [...totals.unresolvedNames].slice(0, 40)) console.log(`   ${name}`)
  }

  if (airOf) {
    console.log('\n===== ③ 制空值反校（kcwiki 的数 × 我们自己算的）=====')
    console.log(`对上 ${totals.kAir - airDiffs.length} / ${totals.kAir} 条`)
    for (const diff of airDiffs.slice(0, 60)) {
      console.log(
        `  ${diff.code} ${diff.node}: wiki ${diff.wiki} vs 本地 ${diff.mine}  [${diff.ships.join(',')}]`,
      )
    }
    if (airDiffs.length > 60) console.log(`  …另有 ${airDiffs.length - 60} 条`)
  }

  if (warnings.length) {
    console.log(`\n===== 解析器挂牌 ${warnings.length} 条 =====`)
    for (const warning of warnings) console.log(`  ⚠ ${warning}`)
  }
}

await main()
