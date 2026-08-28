// 常规海域**限定期窗口**台账的维护者侧工具（2026-08-22 批次 4）。
//
// ---- 这一层为什么与前两批不同 ----
//
// 敌编成（map-enemy-comps）与掉落（map-drops）是**抓来再汇编**的：跑一次 `lodes:fetch`
// 就能重建。限定期窗口不行——§2.4a 八条穷举确认，还给这一格的社区机读源只剩一家，
// 而那一家的许可不允许随包分发。所以发布侧的做法是：
//
//   · `assets/lodes/map-drop-windows.json` 是**第一方手工台账**，入仓、随包、抓不回来；
//   · 抓取脚本降为**维护者侧对照工具**（eo-quests 地位）：读上游、与台账逐条比、
//     出一份差异报告给人过目，**一个字都不写进随包数据**。
//
// 这个文件只放**纯逻辑**（diff 与信号判定），IO 在 refresh-map-intel-limited.mjs 与
// 下面标了「有 IO」的那一个函数里。判断写反了不会报错、只会安静地说错话，所以要能单测。
//
// ---- 「疑似已收窗」这个信号的边界（⑤-裁-2 的对称红利）----
//
// 窗口关没关，官方不公告；但账本能给一票**反向**证据：收窗之后，同一张图再怎么 S 胜，
// 那条船也不会再出。所以「自从上次捞到它，这张图又 S 胜了 N 次都没再出」是个可用信号。
// 三条边界必须如实说，否则它会被当成判据用：
//   ① 账本按**图**归不按点（`encounters.cell` 是罗盘边号，变字母要再过一层推导，
//      那一层的错法是「把掉落挂到错的点上」，比少一张票坏得多）；
//   ② S 胜没出这条船 ≠ 窗口关了——掉落池是随机的，样本少的时候什么都说明不了；
//   ③ 只对**本机捞到过**的条目成立。从没捞到过的，分不清是「窗口关了」还是「我运气差」。
// 所以它只进维护者侧报告，**不进玩家 UI**，也不自动改台账。

import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'

import { userDataPathIfAny } from './data-dir.mjs'
import { limitedWindowPhase } from '../../src/shared/limited-window.ts'
import { correctLegacyDropForm } from '../../src/shared/map-drop-corrections.ts'

const require = createRequire(import.meta.url)

/** 出「疑似已收窗」信号至少要这么多 S 胜样本。低于它一律不出声——样本少时什么都说明不了。 */
export const CLOSED_WINDOW_SAMPLE_FLOOR = 30

/** 把台账摊平成 `[{ map, node, id, entry }]`，顺序稳定（图数值序 → 点字母序 → mstId）。 */
export const ledgerEntries = (data) => {
  const out = []
  for (const code of Object.keys(data?.maps ?? {}).sort((a, b) =>
    a.localeCompare(b, 'en', { numeric: true }),
  )) {
    const layer = data.maps[code]
    for (const node of Object.keys(layer).sort()) {
      for (const entry of [...layer[node]].sort((a, b) => a.id - b.id)) {
        out.push({ map: code, node, id: entry.id, entry })
      }
    }
  }
  return out
}

/** 一条待裁项的稳定指纹。上游改了那一格指纹就变，旧裁决自动失效要重核。 */
export const limitedDiffFingerprint = (row) =>
  `${row.kind}@${row.map}/${row.node ?? '-'}[${row.id}]${JSON.stringify(row.detail ?? '')}`

/**
 * **单票待裁**：只有一方这么说，第二票对不上，凑不齐互斥两票制的两票。
 *
 * 形态照 `scripts/lib/fit-bonus-conflicts.mjs` 的 `PENDING_FIT_BONUS_CONFLICTS`：
 * 取不到第二票就老实挂在这里等，**不许替用户拍板**——单票补进台账与凭印象填没有区别，
 * 而它一旦进了包，界面上就是一句板上钉钉的「这里限定期掉这条船」。
 *
 * 这张表不参与任何判定，只被 `refresh-map-intel-limited.mjs` 的报告带出来给人看。
 * 哪天第二票到了（wikiwiki 总表补上了、或者本机遭遇志真在那一格捞到了），
 * 把条目写进台账、这里的那一行删掉。
 *
 * `ledger` 记的是**台账此刻在那一格是怎么写的**（`null` = 根本没有这一条）。
 * 它是给护栏用的锚：`test/map-drop-windows.test.mjs` 拿它与真台账逐条对，
 * 对不上就是有人拿着单票动了包——那正是这张表要拦的事，而它不会有任何报错表现。
 */
export const PENDING_LIMITED_WINDOW_CLAIMS = Object.freeze([
  Object.freeze({
    map: '2-4',
    node: 'P',
    id: 953,
    ship: '朝日',
    claim: '限定期窗口开催中',
    claimedAt: '2026-08-23',
    sources: ['kanlog'],
    ledger: null,
    why:
      '艦ログ 2026-08-23 13:00 页面人工核阅：朝日在 2-4/P 列在「開催中の期間限定ドロップ」（样本 0/865）。' +
      '第二票对不上——wikiwiki「期間限定ドロップイベント」的海域別リスト（页面自述 2026-06-26 メンテ时点）' +
      '只把朝日列在 1-3/J，2-4 那一行没有它；随包 map-drops 的 2-4/P 掉落名单里也没有 953。' +
      '单票不补：补进去等于把「艦ログ 一家说」写成台账事实。',
  }),
  Object.freeze({
    map: '3-1',
    node: 'G',
    id: 953,
    ship: '朝日',
    claim: '限定期窗口开催中',
    claimedAt: '2026-08-23',
    sources: ['kanlog'],
    ledger: null,
    why:
      '艦ログ 2026-08-23 13:00 页面人工核阅：朝日在 3-1/G 列在「開催中の期間限定ドロップ」（样本 0/420）。' +
      '第二票同样对不上——wikiwiki 总表的 3-1 那一行没有朝日，随包 map-drops 的 3-1/G 掉落名单里也没有 953。' +
      '单票不补，理由同 2-4/P。',
  }),
  Object.freeze({
    map: '2-2',
    node: 'K',
    id: 133,
    ship: '夕雲',
    claim: '这一点其实已经不掉了（台账现记 active_confirmed）',
    claimedAt: '2026-08-23',
    sources: ['kanlog'],
    ledger: 'active_confirmed',
    why:
      '艦ログ 2026-08-23 13:00 页面人工核阅：2-2 全图的開催中名单里都没有夕雲，K 点亦然。' +
      '但 wikiwiki 总表仍把夕雲列在 2-2（点位提示 B/D/E/G/K 全含），随包 map-drops 的 2-2/K 也两票都有它——' +
      '两边对着干，且这一侧只有 kanlog 一票。**不动状态**：改成 end_pending 等于凭单票把还能捞的线索藏起来。' +
      '同一次核阅里 2-2/K 的巻雲(134)、浦風(168) 台账也记着 active，而人工记录只抄下了该点的開催名单、' +
      '没有逐条穷举「谁不在名单里」，所以这两条连「一票」都算不上，下次核阅时一并看清楚。',
  }),
])

/**
 * 台账 × 上游总表逐条比。
 *
 * 粒度是 **(图, 舰)** 而不是 (图, 点, 舰)：上游的海域别列表经常只写海域不写点位，
 * 按点比会把「上游没写点」误报成「上游删了这条」。点位信息照旧带进 detail 供人看。
 *
 * @param ledger    台账的 `data`
 * @param upstream  `parseCurrentLimited` 的产物 `{ checkedAt, maps: Map<code, Map<id, {window, nodes}>> }`
 * @returns `{ checkedAt, rows, summary }`；rows 的 kind：
 *          `upstream-only` 上游有台账没有（要补一条）
 *          `ledger-only`   台账有上游不再列出（疑似收窗，要人裁 status，**不许脚本代拍**）
 *          `from-changed`  起始日不一致（多半是上游订正了旧批次的日期）
 *          `label-changed` 批次标签不一致
 *          `stale`         上游核对日比台账新，且这一条两边一致——可以把 lastConfirmedAt 推进
 */
export const diffLimitedLedger = ({ ledger, upstream }) => {
  const rows = []
  const summary = {
    ledger: 0,
    upstream: 0,
    matched: 0,
    upstreamOnly: 0,
    ledgerOnly: 0,
    fromChanged: 0,
    labelChanged: 0,
    stale: 0,
    revived: 0,
  }

  // 台账侧按 (图, 舰) 归并：同一条船在同一张图的多个点上是一条上游条目铺出来的
  const byKey = new Map()
  for (const row of ledgerEntries(ledger)) {
    const key = `${row.map}|${row.id}`
    const seen = byKey.get(key) ?? { map: row.map, id: row.id, nodes: [], entries: [] }
    seen.nodes.push(row.node)
    seen.entries.push(row.entry)
    byKey.set(key, seen)
    summary.ledger += 1
  }

  const upstreamKeys = new Set()
  for (const [code, entries] of upstream.maps) {
    for (const [rawId, entry] of entries) {
      // 上游那一票里指错形态的号在这里改钉（宗谷 645 → 699）。不改的话这 3 条会
      // **同时**报成「上游有台账无」和「台账有上游不再列出」，6 条全是噪声，
      // 真差异反而埋在里面看不见——而报告本身不会有任何异常表现。
      const id = correctLegacyDropForm(rawId)
      summary.upstream += 1
      const key = `${code}|${id}`
      upstreamKeys.add(key)
      const mine = byKey.get(key)
      if (!mine) {
        rows.push({
          kind: 'upstream-only',
          map: code,
          node: entry.nodes?.size ? [...entry.nodes].sort().join('、') : null,
          id,
          detail: {
            upstream: `${entry.window.from} 起${entry.window.label ? ` · ${entry.window.label}` : ''}`,
            note: '上游列了这一条，台账里没有——要么是新批次，要么是当初漏录',
          },
        })
        summary.upstreamOnly += 1
        continue
      }
      summary.matched += 1
      // 同一 (图, 舰) 的几个点位在台账里可能各写各的窗口；逐个比，任何一个不一致都报
      for (const [index, one] of mine.entries.entries()) {
        const node = mine.nodes[index]
        if (one.window.from !== entry.window.from) {
          rows.push({
            kind: 'from-changed',
            map: code,
            node,
            id,
            detail: { ledger: one.window.from, upstream: entry.window.from },
          })
          summary.fromChanged += 1
        }
        if ((one.window.label ?? '') !== (entry.window.label ?? '')) {
          rows.push({
            kind: 'label-changed',
            map: code,
            node,
            id,
            detail: { ledger: one.window.label ?? '（无）', upstream: entry.window.label ?? '（无）' },
          })
          summary.labelChanged += 1
        }
        // 台账已经把它判成「不再持续」，上游却又列出来了。两种可能都值得当场看一眼：
        // 当初判早了，或者这一批真的又开了一次。哪一种都不该由脚本替人改 status。
        const status = one.window.status ?? 'active_confirmed'
        if (status !== 'active_confirmed') {
          rows.push({
            kind: 'revived',
            map: code,
            node,
            id,
            detail: {
              ledger: `status=${status}`,
              upstream: `仍在「现在持续中」名单里（${upstream.checkedAt} 核对）`,
              note: '当初判早了，还是这一批又开了一次？由人裁，脚本只报。',
            },
          })
          summary.revived += 1
        }
        if (one.window.lastConfirmedAt < upstream.checkedAt) {
          rows.push({
            kind: 'stale',
            map: code,
            node,
            id,
            detail: {
              ledger: one.window.lastConfirmedAt,
              upstream: upstream.checkedAt,
              note: '两边一致，只是台账的核对日旧了——可以把 lastConfirmedAt 推到上游核对日',
            },
          })
          summary.stale += 1
        }
      }
    }
  }

  for (const [key, mine] of byKey) {
    if (upstreamKeys.has(key)) continue
    for (const [index, one] of mine.entries.entries()) {
      rows.push({
        kind: 'ledger-only',
        map: mine.map,
        node: mine.nodes[index],
        id: mine.id,
        detail: {
          ledger: `${one.window.from} 起 · status=${one.window.status ?? 'active_confirmed'}`,
          note:
            '上游的「现在持续中」名单里不再有它——疑似收窗。' +
            '**不代拍**：改 status / 写 until 由人裁，脚本只报。',
        },
      })
      summary.ledgerOnly += 1
    }
  }

  return { checkedAt: upstream.checkedAt, rows, summary }
}

/**
 * 台账里的三态分布（null / 未收窗 / 已收窗，外加「上游不再列出但说不出日子」那一档）。
 * 报告开头要先说清这个——「有多少条其实已经关了」是维护这份台账最先要看的数。
 */
export const ledgerPhaseTally = (ledger, today) => {
  const tally = { open_undated: 0, open_dated: 0, end_pending: 0, closed: 0 }
  for (const row of ledgerEntries(ledger)) {
    tally[limitedWindowPhase(row.entry.window, today)] += 1
  }
  return tally
}

/**
 * 「疑似已收窗」信号（纯函数）。边界见文件头，三条都不许省。
 *
 * @param ledger   台账的 `data`
 * @param samples  `loadLimitedLedgerSamples` 的产物
 * @param today    YYYY-MM-DD
 * @param floor    S 胜样本门槛
 */
export const suspectedClosedWindows = ({
  ledger,
  samples,
  today,
  floor = CLOSED_WINDOW_SAMPLE_FLOOR,
}) => {
  const out = []
  const seen = new Set()
  for (const row of ledgerEntries(ledger)) {
    // 已经写了截止日、且那一天已经过去的不必再报——那一条已经收完窗了
    if (limitedWindowPhase(row.entry.window, today) === 'closed') continue
    const key = `${row.map}|${row.id}`
    if (seen.has(key)) continue // 账本按图归，同图多点只报一次
    const sample = samples.get(row.map)
    const lastTs = sample?.lastDropTs.get(row.id)
    if (!sample || lastTs === undefined) continue // 本机没捞到过 → 分不清是关了还是运气差
    const sWinsSince = sample.sWinTs.filter((ts) => ts > lastTs).length
    if (sWinsSince < floor) continue
    seen.add(key)
    out.push({
      map: row.map,
      id: row.id,
      lastDropAt: new Date(lastTs).toISOString().slice(0, 10),
      sWinsSince,
      status: row.entry.window.status ?? 'active_confirmed',
      from: row.entry.window.from,
    })
  }
  return out.sort((a, b) => b.sWinsSince - a.sWinsSince)
}

/**
 * 人工核实结束日之后，把某张图内某条船的所有限定点转成**已收窗**（纯函数，就地改）。
 *
 * 这是三态里唯一一个**只能由人写**的状态：官方不公告结束日，上游总表也只会
 * 「不再列出」而不给日期。所以脚本永远不会自己写 `until`——写它必须有人拿到凭据。
 * 相应地，`evidence` 也要跟着换成这条新凭据：条目的内容变了，凭据还留着旧的那一句，
 * 等于用「当初凭什么说它开着」去背书「现在凭什么说它关了」。
 */
export const confirmLedgerWindowEnd = (
  data,
  { map, shipId, until, confirmedAt, evidence },
) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until ?? '')) throw new Error(`限定结束日期非法：${until}`)
  if (!evidence?.kind || !evidence?.note) throw new Error('收窗必须写清凭据（kind + note）')
  const layer = data?.maps?.[map]
  if (!layer) throw new Error(`台账里没有海域 ${map}`)
  let changed = 0
  for (const [node, list] of Object.entries(layer)) {
    for (const entry of list) {
      if (entry.id !== shipId) continue
      if (until < entry.window.from) {
        throw new Error(`${map}/${node}#${shipId} 的结束日期早于开始日期 ${entry.window.from}`)
      }
      entry.window = {
        ...entry.window,
        until,
        status: 'ended_confirmed',
        statusChangedAt: confirmedAt,
      }
      entry.evidence = { ...evidence, recordedAt: confirmedAt }
      changed += 1
    }
  }
  if (!changed) throw new Error(`${map} 的台账里没有舰娘 ${shipId} 的限定记录`)
  return changed
}

/**
 * 账本取数。**有 IO**，与上面的纯逻辑分开。
 *
 * 返回 `Map<图代号, { sWinTs: number[], lastDropTs: Map<mstId, ts> }>`。
 * 拿不到账本就返回空表——这张票缺席只是少一层信号，不该让整份报告跑不出来。
 */
export const loadLimitedLedgerSamples = ({ dbPath = null } = {}) => {
  const file = dbPath ?? userDataPathIfAny('mg.sqlite')
  const samples = new Map()
  if (!file || !existsSync(file)) return samples
  try {
    const { DatabaseSync } = require('node:sqlite')
    const db = new DatabaseSync(file, { readOnly: true })
    try {
      for (const row of db.prepare('SELECT map, ts, rank, drop_mst FROM encounters').all()) {
        const map = Number(row.map)
        const ts = Number(row.ts)
        if (!Number.isInteger(map) || map <= 0 || !Number.isFinite(ts)) continue
        const code = `${Math.floor(map / 10)}-${map % 10}`
        const entry = samples.get(code) ?? { sWinTs: [], lastDropTs: new Map() }
        if (row.rank === 'S') entry.sWinTs.push(ts)
        const drop = Number(row.drop_mst)
        if (Number.isInteger(drop) && drop > 0) {
          entry.lastDropTs.set(drop, Math.max(entry.lastDropTs.get(drop) ?? 0, ts))
        }
        samples.set(code, entry)
      }
    } finally {
      db.close()
    }
  } catch (error) {
    console.warn(`[lodes]   本机遭遇志读不到（「疑似已收窗」信号本轮缺席）：${error.message}`)
  }
  return samples
}
