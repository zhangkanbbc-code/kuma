import type { SlotitemInstance } from './mg-types'

export const destroyedSlotitemIds = (post: Record<string, string>): number[] =>
  `${post.api_slotitem_ids ?? ''}`
    .split(',')
    .map((value) => Number.parseInt(value, 10))
    .filter((id) => id > 0)

const toInstance = (raw: any): SlotitemInstance => ({
  mstId: Number(raw?.api_slotitem_id) || 0,
  level: Number(raw?.api_level) || 0,
  alv: Number(raw?.api_alv) || 0,
  locked: raw?.api_locked === 1,
})

const addItems = (
  slotitems: Record<number, SlotitemInstance>,
  rawItems: unknown,
): boolean => {
  if (!Array.isArray(rawItems)) return false
  let changed = false
  for (const raw of rawItems) {
    const id = Number(raw?.api_id)
    if (!(id > 0) || !(Number(raw?.api_slotitem_id) > 0)) continue
    slotitems[id] = toInstance(raw)
    changed = true
  }
  return changed
}

const upsertItem = (
  slotitems: Record<number, SlotitemInstance>,
  raw: any,
): boolean => {
  const id = Number(raw?.api_id)
  if (!(id > 0) || !(Number(raw?.api_slotitem_id) > 0)) return false
  const next = toInstance(raw)
  const prev = slotitems[id]
  if (
    prev &&
    prev.mstId === next.mstId &&
    prev.level === next.level &&
    prev.alv === next.alv &&
    prev.locked === next.locked
  ) {
    return false
  }
  slotitems[id] = next
  return true
}

const removeItems = (
  slotitems: Record<number, SlotitemInstance>,
  rawIds: unknown,
): boolean => {
  const ids = Array.isArray(rawIds) ? rawIds : []
  let changed = false
  for (const rawId of ids) {
    const id = Number(rawId)
    if (id > 0 && slotitems[id]) {
      delete slotitems[id]
      changed = true
    }
  }
  return changed
}

/**
 * 只归约装备实例增删，不触碰同一响应里的资源、舰娘或建造槽。
 * 启动回放可安全复用它，而不会把资源收益/消耗重复计算一遍。
 */
export const applySlotitemInventoryMutation = (
  slotitems: Record<number, SlotitemInstance>,
  apiPath: string,
  body: any,
  post: Record<string, string>,
): boolean => {
  if (apiPath === '/kcsapi/api_req_kousyou/destroyitem2') {
    let changed = false
    for (const id of destroyedSlotitemIds(post)) {
      if (slotitems[id]) {
        delete slotitems[id]
        changed = true
      }
    }
    return changed
  }
  if (apiPath === '/kcsapi/api_req_kousyou/getship') {
    return addItems(slotitems, body?.api_slotitem)
  }
  if (apiPath === '/kcsapi/api_req_kousyou/createitem') {
    const created = Array.isArray(body?.api_get_items)
      ? body.api_get_items
      : body?.api_get_item
        ? [body.api_get_item]
        : []
    return addItems(slotitems, created)
  }
  if (apiPath === '/kcsapi/api_req_kousyou/remodel_slot') {
    const removed = removeItems(slotitems, body?.api_use_slot_id)
    const updated =
      body?.api_remodel_flag === 1
        ? upsertItem(slotitems, body?.api_after_slot)
        : false
    return removed || updated
  }
  if (apiPath === '/kcsapi/api_req_kousyou/remodel_slot_recover') {
    return upsertItem(slotitems, body?.api_after_slot)
  }
  if (apiPath === '/kcsapi/api_req_member/itemuse') {
    return addItems(
      slotitems,
      Array.isArray(body?.api_getitem)
        ? body.api_getitem.map((entry: any) => entry?.api_slotitem).filter(Boolean)
        : [],
    )
  }
  if (
    apiPath === '/kcsapi/api_req_kaisou/lock' &&
    Number(post.api_slotitem_id) > 0
  ) {
    const id = Number(post.api_slotitem_id)
    const item = slotitems[id]
    if (!item || typeof body?.api_locked !== 'number') return false
    const locked = body.api_locked === 1
    if (item.locked === locked) return false
    item.locked = locked
    return true
  }
  return false
}
