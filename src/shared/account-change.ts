export const ACCOUNT_CHANGED_MESSAGE = '检测到账号变化：kuma 的记录不分账号，之前的记录会和现在的混在一起'

export const detectAccountChange = (
  stored: string | number | null | undefined,
  incoming: string | number,
): 'first' | 'same' | 'changed' => {
  if (stored == null || stored === '') return 'first'
  return String(stored) === String(incoming) ? 'same' : 'changed'
}
