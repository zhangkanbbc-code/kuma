// 维护者裁决 2026-10-30。
export const incentiveTs = Date.parse('2026-10-30T20:47:00+09:00')
export const incentiveData = { api_count: 2, api_item: [
  { api_mode: 3, api_type: 2, api_mst_id: 466, api_getmes: '九月作戦 主力艦隊第三群(101～500位)<br>流星改(熟練) を獲得しました！' },
  { api_mode: 3, api_type: 2, api_mst_id: 589, api_getmes: '九月作戦 主力艦隊第三群(101～500位)<br>XF6F-6 ★+1 を獲得しました！', api_slotitem_level: 1 },
] }
export const equipNameOf = id => ({ 466: '流星改(熟練)', 589: 'XF6F-6' })[id] ?? `装备${id}`
