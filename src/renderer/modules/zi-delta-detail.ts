import type { MaterialDeltaRow, MaterialDeltaRowsResult } from '../../shared/mg-types'
import { describeDeltaDetail, groupDeltaRows, type DeltaDetailResolvers } from '../../shared/material-delta-text'
import { mapCodeOf } from '../../shared/map-id'
import { esc, fmtDateTime, mg, queryDeltaRows, queryLode, queryMasterRaw, uiGet, uiSet } from '../kernel'
import { MATERIAL_ICON_BY_INDEX, materialIconHtml } from '../entity-art'
import { entityNamePlain, registerLocalizedName } from '../localization'
import { buildTaskExpeditionNameIndex, normalizeExpeditionDispNo } from '../expedition-name-index'
import { simplifyKcwikiExpeditionData } from '../kcwiki-zh'
import { ensureMapCellLetters, mapCellLetter } from '../map-cell-letter'

const MATERIAL_NAMES = ['燃料', '弹药', '钢材', '铝土', '高速建造材', '桶', '开发资材', '改修资材']
const CATEGORY_TITLES: Record<string, string> = {
  母港校准: '两次返港之间账上没有单独记到的变化，含自然回复',
  基地航空队出击: '含出击期间的自然回复',
}
const RANGE_KEY = 'zi.deltaDetail.range'
let closeCurrent: (() => void) | null = null

const netHtml = (values: MaterialDeltaRow['values']) => `<span class="zd-net">${values.map((value, idx) => value === 0 ? '' :
  `<span class="${value > 0 ? 'up' : 'dn'}">${materialIconHtml(MATERIAL_ICON_BY_INDEX[idx], { className: 'sm', title: MATERIAL_NAMES[idx] })}<i>${value > 0 ? '+' : ''}${value}</i></span>`).join('')}</span>`

/** 主动查询视图：会话内只在打开、切范围、刷新时读逐笔记录。任务名复用锱的同一份缓存。 */
export const openDeltaDetail = (questName: DeltaDetailResolvers['questName']) => {
  closeCurrent?.()
  const saved = uiGet<string>(RANGE_KEY, '7')
  let range = ['today', '7', '30'].includes(saved) ? saved : '7'
  let resourceIdx: number | null = null
  let result: MaterialDeltaRowsResult = { rows: [], truncated: false }
  let generation = 0
  let loading = false
  const expanded = new Set<string>()
  const showAll = new Set<string>()
  let missionNames = new Map<number, { no: string; name: string }>()
  let itemNames = new Map<number, string>()
  let paidItemNames = new Map<number, string>()
  const host = document.createElement('div')
  host.className = 'zi-detail-host'
  host.innerHTML = `<div class="zd-back" data-act="close"></div>
    <div class="zd-panel" role="dialog" aria-modal="true" aria-label="收支明细">
      <div class="zd-head"><b>收支明细</b><span class="zd-status" role="status"></span><button class="zd-x" data-act="close" title="关闭（Esc）" aria-label="关闭">✕</button>
        <div class="zd-controls">
          <div class="zd-ranges">${[['today', '今天'], ['7', '7 日'], ['30', '30 日']].map(([key, label]) => `<button class="zd-chip" data-act="range" data-range="${key}">${label}</button>`).join('')}</div>
          <div class="zd-resources">${['全部', ...MATERIAL_NAMES.slice(0, 4)].map((label, idx) => `<button class="zd-chip" data-act="resource" data-resource="${idx - 1}">${label}</button>`).join('')}</div>
          <button class="zi-detail-btn" data-act="refresh">刷新</button>
        </div>
      </div>
      <div class="zd-body"></div>
    </div>`
  document.body.appendChild(host)
  const previousFocus = document.activeElement as HTMLElement | null
  const close = () => {
    host.remove()
    document.removeEventListener('keydown', onKey)
    closeCurrent = null
    previousFocus?.focus()
  }
  const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
  closeCurrent = close
  document.addEventListener('keydown', onKey)
  host.querySelector<HTMLButtonElement>('.zd-x')!.focus()

  const shipByMst = (id: number) => entityNamePlain('ship', id, mg.master.ships[id]?.name ?? '') || null
  const resolvers: DeltaDetailResolvers = {
    shipByRoster: id => {
      const ship = mg.ships[id]
      return ship ? shipByMst(ship.shipId) : null
    },
    shipByMst,
    slotitemByMst: id => entityNamePlain('equip', id, mg.master.slotitems[id]?.name ?? '') || null,
    questName,
    missionName: id => missionNames.get(id) ?? null,
    mapName: id => id > 0 ? mapCodeOf(id) : null,
    cellLetter: (map, cell) => {
      const letter = mapCellLetter(map, cell)
      return letter.startsWith('#') ? null : letter
    },
    itemName: id => entityNamePlain('item', id, itemNames.get(id) ?? '') || null,
  }
  const rowHtml = (row: MaterialDeltaRow) => {
    // 付费商品与使用道具的 id 属于两张主数据表，不能用普通道具的同号名称。
    const names = row.detail?.kind === 'itemUse' && row.detail.paid
      ? { ...resolvers, itemName: (id: number) => paidItemNames.get(id) ?? null }
      : resolvers
    return `<div class="zd-row"><time>${esc(fmtDateTime(row.ts).slice(5, 16))}</time>${netHtml(row.values)}<span class="zd-description">${esc(describeDeltaDetail(row.detail, names))}</span></div>`
  }
  const syncControls = () => {
    host.querySelectorAll<HTMLButtonElement>('[data-range]').forEach(button => {
      const active = button.dataset.range === range
      button.classList.toggle('active', active)
      button.setAttribute('aria-pressed', `${active}`)
    })
    host.querySelectorAll<HTMLButtonElement>('[data-resource]').forEach(button => {
      const active = Number(button.dataset.resource) === (resourceIdx ?? -1)
      button.classList.toggle('active', active)
      button.setAttribute('aria-pressed', `${active}`)
    })
    host.querySelector('.zd-status')!.textContent = loading ? '读取中……' : ''
  }
  const renderBody = () => {
    if (!host.isConnected) return
    const groups = groupDeltaRows(result.rows, resourceIdx)
    host.querySelector('.zd-body')!.innerHTML = `${result.truncated ? '<div class="zd-note">只显示最近 6000 笔，缩小时间范围可看更早的</div>' : ''}${groups.length ? groups.map(group => {
      const open = expanded.has(group.category)
      const all = showAll.has(group.category)
      return `<section class="zd-group"><button class="zd-group-head" data-act="group" data-category="${esc(group.category)}" aria-expanded="${open}"${CATEGORY_TITLES[group.category] ? ` title="${esc(CATEGORY_TITLES[group.category])}"` : ''}><span>${open ? '▾' : '▸'} ${esc(group.category)} · ${group.count} 笔</span>${netHtml(group.values)}</button>${open ? `<div class="zd-rows">${(all ? group.rows : group.rows.slice(0, 300)).map(rowHtml).join('')}${!all && group.count > 300 ? `<button class="zd-more" data-act="more" data-category="${esc(group.category)}">展开全部 ${group.count} 笔</button>` : ''}</div>` : ''}</section>`
    }).join('') : '<div class="zd-empty">暂无记录</div>'}`
  }
  const readRows = async () => {
    const request = ++generation
    const now = Date.now()
    const today = new Date(now)
    today.setHours(0, 0, 0, 0)
    const sinceTs = range === 'today' ? today.getTime() : now - Number(range) * 86400000
    loading = true
    syncControls() // 读取期间保留原有正文，迟到的旧范围结果不能覆盖新范围。
    try {
      const next = await queryDeltaRows(sinceTs)
      if (!host.isConnected || request !== generation) return
      result = next
      loading = false
      syncControls()
      renderBody()
    } catch (error) {
      if (!host.isConnected || request !== generation) return
      loading = false
      syncControls()
      host.querySelector('.zd-status')!.textContent = '读取失败，请刷新重试'
      console.warn('[kuma] 收支明细读取失败', error)
    }
  }
  host.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-act]')
    if (!button) return
    switch (button.dataset.act) {
      case 'close': close(); break
      case 'refresh': void readRows(); break
      case 'range':
        if (range === button.dataset.range) break
        range = button.dataset.range!
        uiSet(RANGE_KEY, range)
        expanded.clear()
        showAll.clear()
        void readRows()
        break
      case 'resource':
        resourceIdx = Number(button.dataset.resource) < 0 ? null : Number(button.dataset.resource)
        syncControls()
        renderBody()
        break
      case 'group': {
        const category = button.dataset.category!
        if (expanded.has(category)) expanded.delete(category)
        else expanded.add(category)
        renderBody()
        break
      }
      case 'more': showAll.add(button.dataset.category!); renderBody(); break
    }
  })
  void readRows()
  ensureMapCellLetters(renderBody)
  // 名称资料与逐笔查询独立：资料缺席只回落编号，不阻塞正文或增加逐笔读取。
  void Promise.allSettled([queryMasterRaw(), queryLode('kcwiki-expedition')]).then(([master, expedition]) => {
    if (!host.isConnected) return
    for (const loaded of [master, expedition]) {
      if (loaded.status === 'rejected') console.warn('[kuma] 收支明细名称读取失败', loaded.reason)
    }
    const raw = master.status === 'fulfilled' ? master.value?.data : null
    const lode = expedition.status === 'fulfilled' ? expedition.value?.data : null
    const missions = raw?.api_mst_mission ?? Object.entries(mg.master.missions).map(([id, m]) => ({ api_id: Number(id), api_disp_no: m.dispNo, api_name: m.name }))
    const index = buildTaskExpeditionNameIndex(missions, lode ? simplifyKcwikiExpeditionData(lode) : null,
      m => entityNamePlain('expedition', m.api_id, m.api_name),
      (m, name) => registerLocalizedName('expedition', m.api_id, m.api_name, name, 'kcwiki-expedition'),
      text => text)
    const numbers = new Map<number, string>(missions.map((m: { api_id: number; api_disp_no: string }) => [m.api_id, normalizeExpeditionDispNo(m.api_disp_no)]))
    missionNames = new Map(index.map(m => [m.id, { no: numbers.get(m.id) || `#${m.id}`, name: m.name }]))
    itemNames = new Map((raw?.api_mst_useitem ?? []).map((item: { api_id: number; api_name: string }) => [item.api_id, item.api_name]))
    paidItemNames = new Map((raw?.api_mst_payitem ?? []).map((item: { api_id: number; api_name: string }) => [item.api_id, item.api_name]))
    renderBody()
  })
}
