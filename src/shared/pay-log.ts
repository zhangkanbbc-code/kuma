// 本机氪金记录（2026-08-19 用户定名）的报文解析纯函数。
// 数据源实测（当日用户购入母港拡張×3 的账本原文）：
// - api_get_member/payitem：持有未用的课金道具清单，开商店/付款后都会刷新；
//   条目形如 { api_payitem_id: "16"(字符串!), api_name, api_price, api_count }，
//   一件都没有时 api_data 为 null（mg/index 的 ?? 会把整个包装对象传进来）。
// - api_req_member/payitemuse：每用掉一个发一次，回包带效果字段
//   （母港拡張实测 api_max_chara/api_max_slotitem 直接给新上限）。
// 购买本身（DMM 付款）不在 /kcsapi 里，只能靠前后两份持有清单相减。

export interface PayitemStock {
  count: number
  name: string
  price: number | null // 单价（DMM 点数 ≈ 日元）；报文没给时为 null
}

export type PayitemStocks = Record<number, PayitemStock>

export interface PayLogRow {
  id: number
  ts: number
  kind: 'buy' | 'use' | 'manual' // 自动观测的购买 / 消耗 / 玩家手动补记
  itemId: number
  name: string
  count: number
  price: number | null
  detail: string | null // use: 效果 JSON；manual: 备注
}

// 返回 null = 报文形状不认识：**不要**动基线。把认不出的包当成「空持有」
// 会在下一份真清单到来时凭空造出假购买记录。
export const parsePayitemList = (body: unknown): PayitemStocks | null => {
  const raw: any = body
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.api_data) ? raw.api_data : null
  if (list === null) {
    // 明确的「一件都没有」：api_data 显式为 null（或整包就是 null）才算数
    if (raw === null || (raw && typeof raw === 'object' && 'api_result' in raw && raw.api_data == null)) {
      return {}
    }
    return null
  }
  const stocks: PayitemStocks = {}
  for (const entry of list) {
    const itemId = Number(entry?.api_payitem_id)
    const count = Number(entry?.api_count)
    if (!Number.isInteger(itemId) || itemId <= 0 || !Number.isInteger(count) || count <= 0) continue
    const price = Number(entry?.api_price)
    stocks[itemId] = {
      count,
      name: `${entry?.api_name ?? ''}`.trim() || `课金道具 #${itemId}`,
      price: Number.isFinite(price) && price > 0 ? price : null,
    }
  }
  return stocks
}

// 前后两份持有清单相减，只有**增加**算购买（减少走 payitemuse，另有记录）。
// prev 为 null（本机从未观测过）时不造记录：现存的持有不知道是何时买的，
// 交给玩家手动补记，不拿观测时刻冒充购买时刻。
export const diffPayitemStocks = (
  prev: PayitemStocks | null,
  next: PayitemStocks,
): { itemId: number; name: string; count: number; price: number | null }[] => {
  if (!prev) return []
  const purchases: { itemId: number; name: string; count: number; price: number | null }[] = []
  for (const [key, stock] of Object.entries(next)) {
    const itemId = Number(key)
    const delta = stock.count - (prev[itemId]?.count ?? 0)
    if (delta > 0) purchases.push({ itemId, name: stock.name, count: delta, price: stock.price })
  }
  return purchases
}

// 消耗回包 → 效果 JSON（只留业务字段，标志位不进账）。没有可记的返回 null。
export const payitemUseEffect = (body: unknown): string | null => {
  if (!body || typeof body !== 'object') return null
  const effect: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (key === 'api_caution_flag' || key === 'api_flag' || key === 'api_result' || key === 'api_result_msg') continue
    effect[key] = value
  }
  return Object.keys(effect).length ? JSON.stringify(effect) : null
}
