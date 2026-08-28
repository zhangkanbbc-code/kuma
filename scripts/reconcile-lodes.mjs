import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { writeLodeReconciliation } from './lib/lode-reconcile.mjs'

const root = path.join(fileURLToPath(import.meta.url), '..', '..')
const { output, report } = writeLodeReconciliation(root)

console.log(`[lodes] 交叉对账已写入 ${output}`)
if (report.remodel.available) {
  console.log(
    `[lodes]   改造：${report.remodel.wikiwikiTargets} 个目标形态 · ` +
      `API 不一致 ${report.remodel.nativeMismatches.length} · ` +
      `kcwiki 差异 ${report.remodel.fallbackMismatches.length}`,
  )
}
if (report.improveStarGap.available) {
  const { ledger, live, mismatches, mismatchRows } = report.improveStarGap
  console.log(
    `[lodes]   逐星加成夹缝（两源谁对未裁，不动数据）：台账 ${ledger} 件 · 实况 ${live} 件` +
      (mismatches
        ? ` · **对不上 ${mismatches} 处，要重核**：${mismatchRows
            .map((row) => `${row.equipId}/${row.kind}`)
            .join('、')}`
        : ' · 逐条对得上'),
  )
}
if (report.expedition.available) {
  console.log(
    `[lodes]   远征：API/wikiwiki/kcwiki ` +
      `${report.expedition.apiEntries}/${report.expedition.wikiwikiEntries}/${report.expedition.kcwikiEntries} 条 · ` +
      `API 差异 ${report.expedition.apiMismatches.length} · ` +
      `社区源差异 ${report.expedition.mismatches.length} · 缺项 ${report.expedition.missing.length}`,
  )
}
