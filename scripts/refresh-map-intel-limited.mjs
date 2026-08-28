// 限定期台账的**对照报告工具**（维护者侧，2026-08-22 批次 4 起降级）。
//
// 它以前是抓取器：读上游总表，直接把窗口写进随包的 map-intel.json。现在不是了——
// 限定期窗口的唯一出处是第一方手工台账 `assets/lodes/map-drop-windows.json`
//（入仓、随包、抓不回来；理由见 scripts/lib/map-drop-windows.mjs 的文件头）。
// 这个脚本降成 `eo-quests` 那个地位：**读上游，只出一份差异报告，一个字都不写进 assets/lodes/**。
//
// 跑法：
//   node scripts/refresh-map-intel-limited.mjs          读上游 + 报告
//   node scripts/refresh-map-intel-limited.mjs --offline  跳过联网，只出台账自检与账本信号
//
// 产物：控制台摘要 + assets/review/map-drop-windows-report.json（逐条，带指纹）。
// 报告里的每一条都是**待人过目**的，脚本一条都不代拍——尤其 `ledger-only`
//（上游不再列出它）：那是「疑似收窗」，写不写 until、写哪一天，是人的判断。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CLOSED_WINDOW_SAMPLE_FLOOR,
  PENDING_LIMITED_WINDOW_CLAIMS,
  diffLimitedLedger,
  ledgerEntries,
  ledgerPhaseTally,
  limitedDiffFingerprint,
  loadLimitedLedgerSamples,
  suspectedClosedWindows,
} from './lib/map-drop-windows.mjs'
import { fetchText, jstDate, loadMasterShipNames, parseCurrentLimited } from './map-intel.mjs'

const root = path.join(fileURLToPath(import.meta.url), '..', '..')
const lodeDir = path.join(root, 'assets', 'lodes')
const reviewDir = path.join(root, 'assets', 'review')
const offline = process.argv.includes('--offline')
const today = jstDate()

const ledgerFile = path.join(lodeDir, 'map-drop-windows.json')
if (!existsSync(ledgerFile)) {
  throw new Error(
    '找不到 assets/lodes/map-drop-windows.json——限定期台账是入仓文件，' +
      '不该缺；缺了说明工作区不完整，`lodes:fetch` 也拉不回来（它是手工维护的）。',
  )
}
const ledger = JSON.parse(readFileSync(ledgerFile, 'utf8')).data

// ---- ① 台账自检：三态分布 + 每条都有凭据 ----
const entries = ledgerEntries(ledger)
const phases = ledgerPhaseTally(ledger, today)
const noEvidence = entries.filter((row) => !row.entry.evidence?.kind)
console.log(
  `[lodes] 限定期台账：${entries.length} 条 / ${Object.keys(ledger.maps).length} 图` +
    `（最后核对 ${ledger.checkedAt}）`,
)
console.log(
  `[lodes]   三态：无截止日 ${phases.open_undated} · 未收窗 ${phases.open_dated} · ` +
    `已收窗 ${phases.closed} · 上游不再列出（日子不明）${phases.end_pending}`,
)
if (noEvidence.length) {
  // 校验器已经拦住了，这里是第二道：报告要能一眼看出台账有没有破口径
  throw new Error(`台账有 ${noEvidence.length} 条没有 evidence——每条必须写清凭什么与录入日期`)
}
const conflicted = entries.filter((row) => row.entry.conflict)
if (conflicted.length) {
  console.log(
    `[lodes]   挂着待裁标的 ${conflicted.length} 条：` +
      conflicted.map((row) => `${row.map}/${row.node}#${row.id}(${row.entry.conflict})`).join(' '),
  )
}

// ---- ② 上游对照 ----
let diff = { checkedAt: null, rows: [], summary: null }
if (!offline) {
  const shipsPack = JSON.parse(readFileSync(path.join(lodeDir, 'kcwiki-ships.json'), 'utf8'))
  // 舰名解析：主数据快照权威、kcwiki 兜底（kcwiki 对新实装滞后，杉 2026-08 实锤）
  const masterNames = loadMasterShipNames(root)
  if (!masterNames) {
    console.warn('[lodes] ⚠ 没找到仓库上一级的 s2.json——舰名解析退回 kcwiki 单基准，新实装舰可能对不上')
  }
  const url = `https://wikiwiki.jp/kancolle/${encodeURI('期間限定ドロップイベント')}`
  const upstream = parseCurrentLimited(await fetchText(url), shipsPack, masterNames ?? [])
  if (upstream.unmatchedNames.length) {
    // 解析不出来 = 报告会静默少一条差异，看不出任何异常（2026-08-11 杉@1-5 的教训）
    throw new Error(
      `上游总表有舰名解析不出（差异报告会静默缺条）：${upstream.unmatchedNames.join('、')}` +
        '——多半是 kcwiki 包与 s2 快照都缺该舰，先刷新仓库上一级的 s2.json',
    )
  }
  diff = diffLimitedLedger({ ledger, upstream })
  const s = diff.summary
  console.log(`[lodes]   上游核对日 ${diff.checkedAt}：上游 ${s.upstream} 条 · 两边对上 ${s.matched} 条`)
  console.log(
    `[lodes]   差异：上游有台账无 ${s.upstreamOnly} · 台账有上游不再列出 ${s.ledgerOnly} · ` +
      `起始日不一致 ${s.fromChanged} · 批次标签不一致 ${s.labelChanged} · ` +
      `台账判了不再持续但上游还列着 ${s.revived} · 核对日旧了 ${s.stale}`,
  )
} else {
  console.log('[lodes]   --offline：跳过上游对照')
}

// ---- ③ 账本信号：疑似已收窗 ----
const samples = loadLimitedLedgerSamples()
const suspected = suspectedClosedWindows({ ledger, samples, today })
console.log(
  `[lodes]   疑似已收窗（本机 S 胜 ≥ ${CLOSED_WINDOW_SAMPLE_FLOOR} 次没再出）：${suspected.length} 条` +
    (suspected.length
      ? `：${suspected
          .slice(0, 8)
          .map((one) => `${one.map}#${one.id} 自 ${one.lastDropAt} 起 S 胜 ${one.sWinsSince} 次`)
          .join(' · ')}`
      : ''),
)

// ---- ③b 单票待裁：只有一方这么说，第二票对不上，一条都不补进台账 ----
if (PENDING_LIMITED_WINDOW_CLAIMS.length) {
  console.log(
    `[lodes]   单票待裁（凑不齐两票，不补）：${PENDING_LIMITED_WINDOW_CLAIMS.length} 条：` +
      PENDING_LIMITED_WINDOW_CLAIMS.map(
        (one) => `${one.map}/${one.node}#${one.id} ${one.ship}（${one.sources.join('+')}）`,
      ).join(' · '),
  )
}

// ---- ④ 落报告 ----
mkdirSync(reviewDir, { recursive: true })
const reportFile = path.join(reviewDir, 'map-drop-windows-report.json')
writeFileSync(
  reportFile,
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      note:
        '限定期台账的对照报告（维护者侧）。**这个脚本不写随包数据**——' +
        'assets/lodes/map-drop-windows.json 是手工台账，改哪一条由人决定。' +
        'ledger-only = 上游不再列出，疑似收窗；要不要写 until、写哪一天，脚本不代拍。' +
        'suspectedClosed 是账本信号：只对本机捞到过的条目成立，按图归不按点，' +
        'S 胜没出这条船不等于窗口关了——它是线索不是判据。' +
        'fingerprint 变了说明上游改过那一格，旧裁决作废要重核。' +
        'pendingClaims 是**单票待裁**：只有一方这么说、第二票对不上，一条都没补进台账，等第二票。',
      today,
      ledger: {
        checkedAt: ledger.checkedAt,
        entries: entries.length,
        maps: Object.keys(ledger.maps).length,
        phases,
        conflicts: conflicted.map((row) => ({
          map: row.map,
          node: row.node,
          id: row.id,
          kind: row.entry.conflict,
        })),
      },
      upstream: diff.summary ? { checkedAt: diff.checkedAt, ...diff.summary } : null,
      rows: diff.rows.map((row) => ({ ...row, fingerprint: limitedDiffFingerprint(row) })),
      suspectedClosed: { floor: CLOSED_WINDOW_SAMPLE_FLOOR, rows: suspected },
      pendingClaims: PENDING_LIMITED_WINDOW_CLAIMS,
    },
    null,
    1,
  )}\n`,
  'utf8',
)
console.log(`[lodes]   对照报告 → assets/review/map-drop-windows-report.json`)
