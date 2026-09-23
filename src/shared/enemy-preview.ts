// 游戏最多揭示 3 艘；不足 3 艘即整队（维护者裁决 2026-09-22）

export const previewRevealsWholeFleet = (previewCount: number): boolean =>
  previewCount > 0 && previewCount < 3

export const compFitsPreview = (previewIds: readonly number[], compLength: number): boolean =>
  !previewRevealsWholeFleet(previewIds.length) || compLength === previewIds.length

export const previewSampleClause = (
  previewIds: readonly number[],
): { sql: string; params: number[] } => {
  const clauses = previewIds.map(
    (_, index) => `CAST(json_extract(comp, '$[${index}]') AS INTEGER) = ?`,
  )
  const params = [...previewIds]
  if (previewRevealsWholeFleet(previewIds.length)) {
    clauses.push('json_array_length(comp) = ?')
    params.push(previewIds.length)
  }
  return { sql: clauses.join(' AND '), params }
}
