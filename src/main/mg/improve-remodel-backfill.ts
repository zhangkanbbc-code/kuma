// 改修素材实测的回填（shared/improve-remodel）：从账本里已经存着的旧报文补出改修记录。只读账本，不发请求。
//
// 吞掉的装备在响应里只有实例号，得对成装备号：取这次改修之前最近一份装备整表（slot_item），
// 再把整表之后、改修之前新得的实例补上（开发、建造、改修后的实例），实测 77 件全对得上；
// 实在对不上再退到 slotitem_seen（只记首次出现）。资源差额取同一刻的 material_delta「改修」那一行。
// 二号舰取响应的 api_voice_ship_id（0＝没说，记成说不出）。

import type { DatabaseSync } from 'node:sqlite'
import { remodelOfResponse, type ImproveRemodel, type ImproveRemodelCost } from '../../shared/improve-remodel'

const REMODEL = '/kcsapi/api_req_kousyou/remodel_slot'
const SLOT_ITEM = '/kcsapi/api_get_member/slot_item'

const parse = (text: unknown): any => {
  try {
    return typeof text === 'string' ? JSON.parse(text) : null
  } catch {
    return null
  }
}

export const improveRemodelsFromEvents = (db: DatabaseSync): ImproveRemodel[] => {
  const remodels = db
    .prepare(`SELECT id, ts, body, post_body FROM events WHERE path = ? AND body IS NOT NULL ORDER BY ts, id`)
    .all(REMODEL) as { id: number; ts: number; body: string; post_body: string | null }[]
  if (!remodels.length) return []
  const snapshotBefore = db.prepare(
    `SELECT id, ts, body FROM events WHERE path = ? AND ts < ? AND body IS NOT NULL ORDER BY ts DESC, id DESC LIMIT 1`,
  )
  const gainsBetween = db.prepare(
    `SELECT path, body FROM events
     WHERE path IN ('/kcsapi/api_req_kousyou/createitem', '/kcsapi/api_req_kousyou/getship', '${REMODEL}')
       AND ts > ? AND (ts < ? OR (ts = ? AND id < ?)) AND body IS NOT NULL
     ORDER BY ts, id`,
  )
  const seen = db.prepare('SELECT mst_id FROM slotitem_seen WHERE id = ?')
  const delta = db.prepare(
    `SELECT fuel, ammo, steel, bauxite, devmat, screw FROM material_delta WHERE ts = ? AND category = '改修' LIMIT 1`,
  )
  const snapshots = new Map<number, Map<number, { mstId: number; level: number }>>()
  const out: ImproveRemodel[] = []
  for (const row of remodels) {
    const body = parse(row.body)?.api_data
    if (!body) continue
    const post = (parse(row.post_body) ?? {}) as Record<string, string>
    const inventory = new Map<number, { mstId: number; level: number }>()
    const snap = snapshotBefore.get(SLOT_ITEM, row.ts) as { id: number; ts: number; body: string } | undefined
    if (snap) {
      if (!snapshots.has(snap.id)) {
        const data = parse(snap.body)?.api_data
        const list: any[] = Array.isArray(data) ? data : Array.isArray(data?.api_slot_item) ? data.api_slot_item : []
        snapshots.set(
          snap.id,
          new Map(list.map((item) => [Number(item?.api_id), { mstId: Number(item?.api_slotitem_id), level: Number(item?.api_level) || 0 }])),
        )
      }
      for (const [id, item] of snapshots.get(snap.id)!) inventory.set(id, item)
      for (const gain of gainsBetween.all(snap.ts, row.ts, row.ts, row.id) as { path: string; body: string }[]) {
        const data = parse(gain.body)?.api_data ?? {}
        for (const item of [...(Array.isArray(data.api_get_items) ? data.api_get_items : []), ...(Array.isArray(data.api_slotitem) ? data.api_slotitem : [])]) {
          if (Number(item?.api_id) > 0) inventory.set(Number(item.api_id), { mstId: Number(item.api_slotitem_id), level: Number(item.api_level) || 0 })
        }
        const after = data.api_after_slot
        if (Number(after?.api_id) > 0) inventory.set(Number(after.api_id), { mstId: Number(after.api_slotitem_id), level: Number(after.api_level) || 0 })
      }
    }
    const mstOf = (instance: number) => inventory.get(instance)?.mstId ?? (seen.get(instance) as { mst_id?: number } | undefined)?.mst_id ?? null
    const d = delta.get(row.ts) as Record<string, number | null> | undefined
    const cost: ImproveRemodelCost | null = d
      ? {
          fuel: -Number(d.fuel ?? 0),
          bull: -Number(d.ammo ?? 0),
          steel: -Number(d.steel ?? 0),
          baux: -Number(d.bauxite ?? 0),
          devmats: -Number(d.devmat ?? 0),
          screws: -Number(d.screw ?? 0),
        }
      : null
    const target = inventory.get(Number(post.api_slot_id)) ?? null
    const remodel = remodelOfResponse({
      ts: row.ts,
      body,
      post,
      // 整表里的装备号要跟响应说的改修前装备号对得上才信它的星级
      target: target && Number(body.api_remodel_id?.[0]) === target.mstId ? target : null,
      mstOf,
      helper: Number(body.api_voice_ship_id) || null,
      cost,
      source: 'backfill',
    })
    if (remodel) out.push(remodel)
  }
  return out
}
