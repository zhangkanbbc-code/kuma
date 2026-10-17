// 季节收集企划的永久事实；中文名在显示时走现有实体词典。
export interface CampaignReward {
  kind: 'material' | 'useitem' | 'slotitem' | 'unknown'
  id: number
  count: number
  name?: string
}

export interface CampaignReceipt {
  ts: number
  recipe: string
  exchangeType: number | null
  cost: number | null
  rewards: CampaignReward[]
  target?: { rosterId: number; mstId?: number }
}

export interface CampaignTaskUse {
  ts: number
  no: number
  code: string
  title: string
  count: number
}

export interface ObservedQuest {
  no: number
  title: string
  firstSeen: number | null
  lastSeen: number | null
  claims: { ts: number; selectNo: string | null; selectNo2: string | null; rewards: CampaignReward[] }[]
}

export interface CampaignHistory {
  key: string
  itemId: number
  name: string
  opened: number
  closed: number | null
  expiresAt: number | null
  gained: number
  spent: number
  stock: number | null
  sources: { no: number | null; title: string; count: number; times: number }[]
  uses: { recipe: string; count: number; times: number; no?: number; code?: string; title?: string }[]
  taskUses?: CampaignTaskUse[]
  receipts: CampaignReceipt[]
  otherUses: { ts: number; count: number; cause: string | null }[]
  rewards: CampaignReward[]
  party: CampaignReceipt[]
  quests: ObservedQuest[]
}

export const CAMPAIGN_MATERIAL_NAMES = [
  '燃料', '弹药', '钢材', '铝土', '高速建造材', '高速修复材', '开发资材', '改修资材',
]

export const sumCampaignRewards = (rows: CampaignReward[]): CampaignReward[] => {
  const grouped = new Map<string, CampaignReward>()
  for (const row of rows) {
    const key = `${row.kind}:${row.id}:${row.kind === 'unknown' ? row.name ?? '' : ''}`
    const prev = grouped.get(key)
    if (prev) prev.count += row.count
    else grouped.set(key, { ...row })
  }
  return [...grouped.values()]
}
