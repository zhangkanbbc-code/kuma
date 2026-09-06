import { createHash } from 'node:crypto'

// 指纹包含格键、缺/差/多类别及两侧最终值。数量相同也不能换格或改文案。
export const differenceFingerprint = differences => createHash('sha256')
  .update(JSON.stringify([...differences].sort((a, b) => a.key.localeCompare(b.key, 'en'))))
  .digest('hex')

export function parityErrors(report, whitelist) {
  const errors = [], seen = new Set()
  for (const entry of whitelist) {
    if (!entry.domain || !entry.reason || !/^\d{4}-\d{2}-\d{2}$/.test(entry.decidedAt) || !Number.isInteger(entry.cells) || entry.cells <= 0 || !/^[a-f0-9]{64}$/.test(entry.fingerprint)) errors.push(`白名单结构无效：${entry.domain}`)
    if (seen.has(entry.domain)) errors.push(`白名单域重复：${entry.domain}`)
    seen.add(entry.domain)
  }
  // 无开发机层是正常通过，不注册 skip；仍检查白名单结构，但没有对照输入便不判退役。
  if (report.noDeveloperLayer) return errors
  const domains = new Map(report.domains.map(row => [row.domain, row]))
  for (const entry of whitelist) {
    const actual = domains.get(entry.domain)?.differences ?? []
    if (!actual.length) errors.push(`白名单命中 0，必须退役：${entry.domain}`)
    else if (actual.length !== entry.cells || differenceFingerprint(actual) !== entry.fingerprint) errors.push(`白名单外差异或旧豁免已变：${entry.domain}（基线 ${entry.cells}，当前 ${actual.length}）`)
  }
  for (const row of report.domains) if (row.differences.length && !seen.has(row.domain)) errors.push(`白名单外差异：${row.domain} ${row.differences.length} 格`)
  return errors
}
