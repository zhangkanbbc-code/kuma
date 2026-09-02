// 人生记录的履历行：一条 ShipLifeEvent 怎么变成一行字。
//
// 从鉴·列表（qa）里原样搬出来的，因为「人生记录弹窗」要摆的是同一条时间轴。
// **文案源只许有一份**：两处各写一句，同一件事在两个窗口里就会有两种说法，
// 而这种漂移不报错——只有玩家来回对照时才看得出来。
//
// 唯一按窗口不同的是「战斗那一行点了去哪」：主窗口走实体链接（elink → 镝的复盘），
// 独立窗口那边没有路由，得跨窗通知主窗打开。所以那一段由调用方给一个函数，
// 其余的措辞、点色、日期格式全在这里定死。
import { esc, masterShipName, mg } from './kernel'
import { entityNamePlain } from './localization'
import { elink } from './link'
import { mapCellLetter, mapPlaceText } from './map-cell-letter'
import { mapCodeOf } from '../shared/map-id'

import type { ShipLifeEquipment, ShipLifeEvent } from '../shared/mg-types'

export const lifeDate = (ts: number) =>
  new Date(ts).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

const lifeMapName = (map: number | null) => (map && map > 0 ? mapCodeOf(map) : '')

// 履历里的点位一律写玩家认的字母（`A 点`），拿不到就退 `#号`。
// 原先直接写罗盘编号（`点位 12`），那是报文里的内部编号，海图上根本找不到。
const lifeCellName = (map: number | null, cell: number | null) =>
  map && map > 0 && cell != null ? ` · ${mapCellLetter(map, cell)} 点` : ''

const lifeEquipmentNames = (items: unknown): string => {
  if (!Array.isArray(items) || !items.length) return '无装备'
  return (items as ShipLifeEquipment[])
    .map((item) =>
      entityNamePlain(
        'equip',
        item.mstId,
        mg.master.slotitems[item.mstId]?.name ?? `装备#${item.mstId || '?'}`,
      ),
    )
    .join('、')
}

/**
 * 「加入镇守府」那一行的出处后缀（含前面的 ` · `），认不出来就是空串。
 *
 * 出处由**一手记录**认领而来（掉落 = 那一战的 api_get_ship，建造 = getship 的在籍 id）。
 * 履历行与弹窗头部要说的是同一件事，判据只留这一份：认不到就什么都不说
 * （任务奖励舰、记账之前就在的都属此列），别一处写「未知」另一处留白。
 */
export const lifeJoinOriginText = (event: ShipLifeEvent): string => {
  const origin = event.detail?.origin
  if (origin === 'drop' && event.map != null && event.cell != null) {
    return ` · 掉落于 ${mapPlaceText(event.map, event.cell, event.isBoss)}`
  }
  return origin === 'build' ? ' · 建造入港' : ''
}

/** 这一条 battle 事件挂着的战斗快照 id；没有快照（被清理过 / 老记录）时 null。 */
export const lifeEventSnapshotId = (event: ShipLifeEvent): number | null => {
  const id = event.detail?.snapshotId
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null
}

export interface LifeEventHtmlOptions {
  /**
   * 战斗那一行的标题怎么变成「点得开的复盘入口」。
   * 不传就走主窗口的实体链接；独立窗口传自己那一版（跨窗通知主窗打开）。
   * 返回的必须是**已转义**的 HTML。
   */
  battleLink?: (snapshotId: number, titleText: string) => string
}

export const lifeEventHtml = (
  event: ShipLifeEvent,
  options: LifeEventHtmlOptions = {},
): string => {
  const detail = event.detail ?? {}
  let title = ''
  let titleHtml: string | null = null
  let note = ''
  let tone: string = event.kind
  if (event.kind === 'join') {
    title = '加入镇守府'
    // 出处：掉落写图与点位，建造写建造（判据见 lifeJoinOriginText）。
    // 认不到的什么都不加，只写等级——确认不了就不标，不写「未知」。
    note = `Lv ${detail.level ?? '?'}${lifeJoinOriginText(event)}`
  } else if (event.kind === 'exp') {
    title = `获得经验 +${event.expDelta.toLocaleString()}`
    note = `Lv ${detail.levelBefore ?? '?'} → ${detail.levelAfter ?? '?'}`
  } else if (event.kind === 'equipment') {
    title = '装备变更'
    note = `${lifeEquipmentNames(detail.before)} → ${lifeEquipmentNames(detail.after)}`
  } else if (event.kind === 'remodel') {
    title = '完成改造'
    const before = entityNamePlain(
      'ship',
      detail.beforeMstId ?? 0,
      masterShipName(detail.beforeMstId ?? 0),
    )
    const after = entityNamePlain(
      'ship',
      detail.afterMstId ?? 0,
      masterShipName(detail.afterMstId ?? 0),
    )
    note = `${before} → ${after} · Lv ${detail.level ?? '?'}`
  } else if (event.kind === 'marriage') {
    // 与改造同族的一次性永久变化；等级取婚礼**当刻**那份（通常 Lv99），
    // 取不到就写「?」，不拿婚后的 100 冒充。
    title = '结为誓约'
    note = `ケッコンカッコカリ · 当时 Lv ${detail.level ?? '?'}`
  } else if (event.kind === 'hangar_expand') {
    // 同族的另一种一次性永久变化。点色借改造那一档金色，不新造样式。
    // 旧上限取不到就只写新上限，不写箭头——不拿主数据的原量冒充「原来是几」。
    tone = 'remodel'
    title = '格纳库扩容'
    const slot = detail.slot ?? '?'
    note =
      detail.before != null
        ? `第 ${slot} 格 · 搭载上限 ${detail.before} → ${detail.after ?? '?'}`
        : `第 ${slot} 格 · 搭载上限现为 ${detail.after ?? '?'}`
  } else if (event.kind === 'sortie') {
    title = `出击 ${lifeMapName(event.map)}`
    note = `${detail.deckId ? `第 ${detail.deckId} 舰队` : '出击舰队'}${detail.combined ? ' · 联合舰队' : ''}`
  } else if (event.kind === 'battle') {
    tone = event.mvp ? 'mvp' : 'battle'
    const rank = event.rank === 'S' && detail.perfect ? 'S（完全胜利）' : (event.rank ?? '?')
    title = event.practice
      ? `演习 ${rank}`
      : `${lifeMapName(event.map)}${lifeCellName(event.map, event.cell)} ${rank}`
    note = `${event.isBoss ? 'Boss 战 · ' : ''}${event.mvp ? 'MVP · ' : ''}${detail.fleet === 'escort' ? '护卫舰队' : '主力舰队'}`
    const snapshotId = lifeEventSnapshotId(event)
    if (snapshotId != null) {
      titleHtml = options.battleLink
        ? options.battleLink(snapshotId, title)
        : elink('battle', snapshotId, title)
    }
  } else {
    tone = event.kind
    title =
      event.kind === 'scrap'
        ? '拆解'
        : event.kind === 'material'
          ? '作为改修素材'
          : '击沉'
    note =
      event.kind === 'sunk'
        ? `${lifeMapName(event.map)}${lifeCellName(event.map, event.cell)}${event.isBoss ? ' · Boss 战' : ''}`
        : `Lv ${detail.level ?? '?'}`
  }
  return `<div class="life-event ${tone}">
    <span class="life-dot"></span>
    <span class="life-copy"><b>${titleHtml ?? esc(title)}</b><span>${esc(note)}</span></span>
    <time>${esc(lifeDate(event.ts))}</time>
  </div>`
}
