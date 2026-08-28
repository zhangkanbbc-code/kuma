// 常规海域敌编成的**第一方汇编**（用户 2026-08-22 拍板的多源汇编口径）。
//
// ---- 为什么是「汇编」而不是「换一个上游」----
//
// 编成是客观事实（「X 点会出现 mstId=[1501,1502] 这套阵容」），事实不受著作权保护，
// 我们只做统计与整理。但官方从不公布这份表，**不能盲信任何单源**——所以这一层收各方
// 资料交叉印证，整理成自家 schema，每条带**内部印证状态**：
//
//   · 多源一致   ≥2 张独立票说过同一条
//   · 单源待印证  只有一张票；**照收不丢**（5-6 不能因为只有一方收录就归零）
//   · 冲突待裁    两票在同一条上互斥；进冲突台账等人裁，脚本不替用户拍板
//
// **票的独立性要逐域判，不能一刀切。** 本域的三张票是：
//   ① kcwiki「深海配置」表——编辑者直接填 mstId（`(1501)` 就是号）
//   ② 现行 map-intel（wikiwiki 敌編成表的**标注名**，经 kuma 两条定号流水线定成号）
//   ③ 本机遭遇志 `encounters.comp`——第一方一手，最硬的一张
// ①②在**这个域**确实是两条独立路径：一条是中文 wiki 编辑填的数字，一条是日文 wiki 的
// 人读标注 + 我们自己的定号判据，撞出同一个答案才算互印。
// ⚠ 换到**掉落**域时这条独立性判断要重做——kcwiki 大量条目转录自日站，
// 那里的「两 wiki 一致」很可能只是同一张票抄了两遍。
//
// ---- 印证状态只在数据内部 ----
//
// `votes` / `conflict` 两个字段运行时一行都不读，UI 不逐条挂标（贞操锁禁令）。
// 它们是给维护者侧工具看的：哪条还只有一张票、哪条该去核。
//
// ---- 许可 ----
//
// 汇编本身是第一方产物；kcwiki 作为参考来源在 NOTICE / 钥集中署名，逐条不署名。
// 写进包的只有事实三元组（mstId 数组、阵形、基础经验）与 wiki 的**形态标注**
//（「艦載機白赤」这类主数据没有的信息），不含任何一方的表格版式或攻略正文。

import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'

import { userDataPathIfAny } from './data-dir.mjs'
import { KCWIKI_MAP_CODES, parseKcwikiMapPage } from './kcwiki-map.mjs'

const require = createRequire(import.meta.url)

/** 一套编成的稳定键：mstId 升序拼接（同一套阵容，顺序不同也是同一条事实）。 */
export const compKey = (ids) => [...ids].sort((left, right) => left - right).join(',')

/**
 * 阵形值 → 编号数组。口径与运行时的 `formationTokensOf`
 *（src/renderer/combat-forecast.ts）一致：一格多阵形要逐个拆，
 * 只取第一个会把「単縦 複縦」当成単縦，跨源比对时就会编出假冲突。
 */
const FORMATION_BY_NAME = [
  ['第一警戒', 11],
  ['第二警戒', 12],
  ['第三警戒', 13],
  ['第四警戒', 14],
  ['第一', 11],
  ['第二', 12],
  ['第三', 13],
  ['第四', 14],
  ['複縦', 2],
  ['复纵', 2],
  ['輪形', 3],
  ['轮形', 3],
  ['轮型', 3],
  ['梯形', 4],
  ['単横', 5],
  ['单横', 5],
  ['警戒', 6],
  ['単縦', 1],
  ['单纵', 1],
]

export const formationIdsOf = (value) => {
  if (typeof value === 'number') return [value]
  const tokens = `${value}`
    .replace(/航行序列/g, ' ')
    .split(/[\s、,，/／·・]+/)
    .filter(Boolean)
  const out = []
  for (const token of tokens) {
    const id = FORMATION_BY_NAME.find(([key]) => token.includes(key))?.[1] ?? token
    if (!out.includes(id)) out.push(id)
  }
  return out.length ? out : [value]
}

/**
 * 一条冲突的稳定指纹。台账靠它**自失效**：两边中任意一边改了那一格，
 * 指纹就变，对账脚本报「指纹已变，要重新核」，而不是继续照一份过期的分歧说话。
 */
export const mapEnemyCompConflictFingerprint = (conflict) =>
  `${conflict.map}/${conflict.node}[${conflict.ships.join('.')}]` +
  `f:${JSON.stringify(conflict.kcwikiFormation)}|${JSON.stringify(conflict.legacyFormation)}` +
  `e:${conflict.kcwikiExp ?? ''}|${conflict.legacyExp ?? ''}`

/** 印证状态（只给维护者侧工具与报告用；不进 UI）。 */
export const corroborationOf = (comp) => {
  if (comp.conflict) return '冲突待裁'
  return (comp.votes?.length ?? 0) >= 2 ? '多源一致' : '单源待印证'
}

/**
 * 第三张票：本机遭遇志。**有 IO**，与上面的纯逻辑分开。
 *
 * `encounters` 是永久表（不进 90 日清理），`comp` 是这一战敌方的 mstId 数组。
 * 拿不到账本就返回空表——这张票缺席只是少一层印证，不该让整包抓不出来。
 *
 * ⚠ 只按**图**归票，不按点。`encounters.cell` 是罗盘的 `api_no`（边号），
 * 要变成 wiki 的点位字母得再过一层推导；那一层的错法是「把编成挂到错的点上」，
 * 比少一张票坏得多。所以这里如实降一档：只印证「这张图确实出过这套阵容」。
 */
export const loadLedgerCompVotes = ({ dbPath = null } = {}) => {
  const file = dbPath ?? userDataPathIfAny('mg.sqlite')
  const votes = new Map()
  if (!file || !existsSync(file)) return votes
  try {
    const { DatabaseSync } = require('node:sqlite')
    const db = new DatabaseSync(file, { readOnly: true })
    try {
      for (const row of db.prepare('SELECT map, formation, comp FROM encounters').all()) {
        let ids
        try {
          ids = JSON.parse(row.comp).filter((id) => Number.isInteger(id) && id > 0)
        } catch (_error) {
          continue
        }
        if (!ids.length) continue
        const code = `${Math.floor(row.map / 10)}-${row.map % 10}`
        const key = `${code}|${compKey(ids)}`
        const entry = votes.get(key) ?? { samples: 0, formations: new Map() }
        entry.samples += 1
        if (row.formation != null) {
          entry.formations.set(row.formation, (entry.formations.get(row.formation) ?? 0) + 1)
        }
        votes.set(key, entry)
      }
    } finally {
      db.close()
    }
  } catch (error) {
    console.warn(`[lodes]   本机遭遇志读不到（第三张票缺席）：${error.message}`)
  }
  return votes
}

/**
 * 汇编。
 *
 * @param pages     Map<code, { html, title }>，由 fetchKcwikiMapPages 取得
 * @param legacy    现行 map-intel.json 的 `data.maps`（第二张票；只认已定号的编成）
 * @param ledger    Map<`${code}|${compKey}`, { samples, formations: Map<号, 次数> }>（第三张票，可缺）
 * @param checkedAt YYYY-MM-DD
 */
export const buildMapEnemyComps = ({
  pages,
  legacy = {},
  ledger = new Map(),
  checkedAt,
  contentDates = new Map(),
  codes = KCWIKI_MAP_CODES,
}) => {
  const maps = {}
  const conflicts = []
  const warnings = []
  const stats = {
    maps: 0,
    nodes: 0,
    comps: 0,
    multi: 0,
    single: 0,
    conflict: 0,
    kcwikiOnly: 0,
    legacyOnly: 0,
    ledgerBacked: 0,
    withExp: 0,
    withLabels: 0,
  }

  for (const code of codes) {
    const page = pages.get(code)
    if (!page) {
      warnings.push(`${code} 没有页面，整图跳过（宁可缺一图，也不拿旧数冒充新抓）`)
      continue
    }
    const parsed = parseKcwikiMapPage(page.html)
    for (const warning of parsed.warnings) warnings.push(`${code}: ${warning}`)
    const legacyNodes = legacy[code]?.nodes ?? {}
    const nodes = {}

    const nodeLetters = new Set([
      ...Object.keys(parsed.nodes).filter((node) => parsed.nodes[node].enemyComps.length),
      ...Object.keys(legacyNodes).filter((node) => legacyNodes[node].enemyComps?.length),
    ])
    for (const node of [...nodeLetters].sort()) {
      // 第二张票：只认已定号的那些（`shipIds` 齐整才算数——半截的号比没有更危险）。
      //
      // ⚠ 同一个点常有**同一套阵容的多条记录**（1-6 的 C 点，`1532,1530,1530,1530`
      // 既出现在梯形陣/EXP20 那行，也出现在単横陣/EXP30 那行）。按舰列当键、
      // 「第一条先到先得」去配，第二条就会被拿去和第一条比，编出一堆**根本不存在的冲突**
      //（实测多编 5 条）。所以这里按池择优配对：先配阵形与经验都对上的，再配阵形对上的。
      const legacyPool = new Map()
      for (const comp of legacyNodes[node]?.enemyComps ?? []) {
        if (!comp.shipIds?.length) continue
        const key = compKey(comp.shipIds)
        if (!legacyPool.has(key)) legacyPool.set(key, [])
        legacyPool.get(key).push(comp)
      }
      const takeTwin = (key, comp) => {
        const pool = legacyPool.get(key)
        if (!pool?.length) return null
        const mine = new Set(formationIdsOf(comp.formation))
        let bestAt = 0
        let bestScore = -1
        for (const [index, candidate] of pool.entries()) {
          const sameFormation = formationIdsOf(candidate.formation).some((id) => mine.has(id))
          const sameExp =
            Number.isInteger(comp.exp) && Number.isInteger(candidate.exp)
              ? comp.exp === candidate.exp
              : false
          const score = (sameFormation ? 2 : 0) + (sameExp ? 1 : 0)
          if (score > bestScore) {
            bestScore = score
            bestAt = index
          }
          if (score === 3) break
        }
        return pool.splice(bestAt, 1)[0]
      }
      const out = []

      for (const comp of parsed.nodes[node]?.enemyComps ?? []) {
        const key = compKey(comp.ships)
        const twin = takeTwin(key, comp)
        const votes = ['kcwiki']
        let conflict = null
        if (twin) {
          votes.push('wikiwiki')
          const mine = new Set(formationIdsOf(comp.formation))
          const theirs = formationIdsOf(twin.formation)
          // 只有**互斥**才算冲突：一方写「単縦 梯形」另一方写「単縦」是覆盖差，
          // 两方没有一个共同阵形才是真的互相否定。
          const formationClash = !theirs.some((id) => mine.has(id))
          const expClash =
            Number.isInteger(comp.exp) && Number.isInteger(twin.exp) && comp.exp !== twin.exp
          if (formationClash || expClash) {
            conflict = [formationClash ? 'formation' : '', expClash ? 'exp' : '']
              .filter(Boolean)
              .join('+')
            conflicts.push({
              map: code,
              node,
              ships: comp.ships,
              kind: conflict,
              kcwikiFormation: comp.formation,
              legacyFormation: twin.formation,
              kcwikiExp: comp.exp ?? null,
              legacyExp: twin.exp ?? null,
              ledgerFormations: [...(ledger.get(`${code}|${key}`)?.formations ?? new Map())],
            })
          }
        }
        const seen = ledger.get(`${code}|${key}`)
        if (seen) votes.push('ledger')
        out.push({
          formation: comp.formation,
          ships: comp.ships,
          labels: comp.labels,
          ...(Number.isInteger(comp.exp) ? { exp: comp.exp } : {}),
          ...(comp.phase ? { phase: comp.phase } : {}),
          votes,
          ...(conflict ? { conflict } : {}),
        })
        if (!twin) stats.kcwikiOnly += 1
      }

      // 现包独有的那些**照收不丢**（用户裁定：单源条目也是事实，5-6 不归零）。
      // 它们写进包的只有 mstId 数组 + 阵形 + 经验——纯事实三元组，
      // 不含 wikiwiki 的标注文本（那些名字定号后就没进过这里）。
      for (const [key, pool] of legacyPool) {
        for (const comp of pool) {
          const votes = ['wikiwiki']
          if (ledger.get(`${code}|${key}`)) votes.push('ledger')
          out.push({
            formation: comp.formation,
            ships: comp.shipIds,
            ...(Number.isInteger(comp.exp) ? { exp: comp.exp } : {}),
            ...(comp.phase ? { phase: comp.phase } : {}),
            votes,
          })
          stats.legacyOnly += 1
        }
      }

      if (!out.length) continue
      nodes[node] = out
      stats.nodes += 1
      for (const comp of out) {
        stats.comps += 1
        if (comp.conflict) stats.conflict += 1
        else if (comp.votes.length >= 2) stats.multi += 1
        else stats.single += 1
        if (comp.votes.includes('ledger')) stats.ledgerBacked += 1
        if (comp.exp != null) stats.withExp += 1
        if (comp.labels?.length) stats.withLabels += 1
      }
    }

    if (!Object.keys(nodes).length) {
      warnings.push(`${code} 一条敌编成都没解析出来`)
      continue
    }
    maps[code] = {
      source: 'kuma 汇编（舰娘百科「深海配置」× kuma 定号流水线 × 本机遭遇志）',
      sourceUrl: `https://zh.kcwiki.cn/wiki/${encodeURI(page.title ?? code)}`,
      checkedAt,
      revision: checkedAt.replaceAll('-', '.'),
      ...(contentDates.get(code) ? { contentDate: contentDates.get(code) } : {}),
      nodes,
    }
    stats.maps += 1
  }

  return {
    data: {
      schemaVersion: 1,
      compiledAt: checkedAt,
      voters: {
        kcwiki: '舰娘百科各海域页「深海配置」表——编辑者直接填 mstId',
        wikiwiki: '艦これ攻略 Wiki 敵編成表的标注名，经 kuma 定号流水线定成 mstId',
        ledger: '本机遭遇志 encounters.comp——第一方一手实测',
      },
      maps,
    },
    stats,
    conflicts,
    warnings,
  }
}
