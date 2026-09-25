export const EXPEDITION_SORT_DEFAULT = 'game'

export const compareGameOrder = (
  a: { mapArea: number; apiId: number },
  b: { mapArea: number; apiId: number },
): number => a.mapArea - b.mapArea || a.apiId - b.apiId

export const restoreSortKey = (saved: unknown, keys: readonly string[]): string =>
  typeof saved === 'string' && keys.includes(saved) ? saved : EXPEDITION_SORT_DEFAULT
