const KANA = /[\u3041-\u3096\u30A1-\u30FA\u30FD-\u30FF]/

export type RoutingRuleShipNameIndex = ReadonlyArray<readonly [string, string]>

export const buildRoutingRuleShipNameIndex = (
  localizationData: unknown,
): RoutingRuleShipNameIndex =>
  Object.values<any>((localizationData as any)?.entities?.ship ?? {})
    .map((entry) => [`${entry?.ja ?? ''}`, `${entry?.zh ?? ''}`] as const)
    .filter(([ja, zh]) => ja && zh && KANA.test(ja))
    .sort(([left], [right]) => right.length - left.length)

export const normalizeRoutingRuleShipNames = (
  rule: string,
  index: RoutingRuleShipNameIndex,
): string => {
  let normalized = rule
  for (const [ja, zh] of index) normalized = normalized.replaceAll(ja, zh)
  return normalized
}
