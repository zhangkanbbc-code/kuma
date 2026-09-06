/** 随包的稀疏格优先；仅开发机有的 akashi-list 补缺，索引始终保持原位。 */
export function akashiImproveItem(id: number, bundled: any, local: any) {
  const first = bundled?.items?.[`${id}`]
  const fallback = local?.items?.[`${id}`]
  const item_intro = first?.item_intro ?? fallback?.item_intro ?? ''
  const item_remodel: Record<string, (string | null)[]> = {}
  const remodel_basis: Record<string, ({ basis: string; formula?: string; compared?: boolean } | null)[]> = {}
  // 新版包已经过公式比较闸门，不能用本机格在显示时绕过整列拒收。
  const localRemodel = bundled?.schemaVersion === 2 ? {} : fallback?.item_remodel ?? {}
  for (const stat of new Set([...Object.keys(first?.item_remodel ?? {}), ...Object.keys(localRemodel)])) {
    const a = first?.item_remodel?.[stat] ?? {}
    const b = localRemodel[stat] ?? {}
    const length = Math.max(10, ...[...Object.keys(a), ...Object.keys(b)].map(index => +index + 1))
    item_remodel[stat] = Array.from({ length }, (_, index) => a[index] ?? b[index] ?? null)
    remodel_basis[stat] = Array.from({ length }, (_, index) => a[index] == null ? null : first?.remodel_basis?.[stat]?.[index] ?? { basis: 'kcwiki' })
  }
  return { item_intro, item_remodel, remodel_basis }
}
