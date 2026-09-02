// 全局速查（Ctrl+K）：输入名字直达任意实体。
//
// 每卷各有自己的搜索框（舰娘/装备/任务/远征……），但没有一个总入口——
// 想查一件装备得先切到装备卷。EntityLink 已经把各类实体统一成
// 「type + id → navigate」，所以这里只做一件事：把名字搜出来，交给 navigate。
//
// 不自己实现任何跳转逻辑：命中什么就 navigate 什么，落点与页面上的链接完全一致。
import { esc, mg, onFilterInput } from './kernel'
import { navigate, type EntityRef } from './link'
import { entityNamePlain } from './localization'
import { compareDisplayNames } from '../shared/name-order'

interface Candidate {
  ref: EntityRef
  /** 展示用的主名（中文优先） */
  label: string
  /** 次要说明：类别、等级、编号 */
  hint: string
  /** 排序权重，越小越靠前 */
  rank: number
}

const KIND_LABEL: Record<string, string> = {
  mstShip: '舰娘',
  mstEquip: '装备',
  map: '海域',
  quest: '任务',
  useitem: '道具',
  expedition: '远征',
}

let host: HTMLElement | null = null
let input: HTMLInputElement | null = null
let listEl: HTMLElement | null = null
let items: Candidate[] = []
let active = 0

const norm = (text: string) => text.toLowerCase().replace(/\s+/g, '')

/**
 * 收集候选。
 *
 * 只搜「名字」，不搜说明文本——命令面板要的是直达，不是全文检索；
 * 把任务描述也搜进来会让一个常见词淹掉所有精确匹配。
 */
const collect = (raw: string): Candidate[] => {
  const query = norm(raw)
  if (query.length < 1) return []
  const out: Candidate[] = []
  const push = (ref: EntityRef, label: string, hint: string, source: string) => {
    const hay = norm(`${label}${source}`)
    const at = hay.indexOf(query)
    if (at < 0) return
    // 从头匹配的排前面：搜「雪风」时「雪风」该压过「雪风改二」之外的模糊命中
    out.push({ ref, label, hint, rank: at * 100 + label.length })
  }

  // 这几张表都是 Record<id, {...}>——id 在**键**上，不在元素里。
  // 从元素取会拿到 NaN，于是每一条都被静默跳过（搜什么都是零结果）。
  for (const [key, ship] of Object.entries(mg.master.ships ?? {})) {
    const id = Number(key)
    if (!(id > 0) || id >= 1500) continue // 深海舰走自己的卷，别混进来
    const ja = `${(ship as any)?.name ?? ''}`
    push({ type: 'mstShip', id }, entityNamePlain('ship', id, ja), `舰娘 · No.${id}`, ja)
  }
  for (const [key, equip] of Object.entries(mg.master.slotitems ?? {})) {
    const id = Number(key)
    if (!(id > 0) || id >= 1500) continue
    const ja = `${(equip as any)?.name ?? ''}`
    push({ type: 'mstEquip', id }, entityNamePlain('equip', id, ja), `装备 · No.${id}`, ja)
  }
  for (const [key, quest] of Object.entries(mg.quests ?? {})) {
    const id = Number(key)
    if (!(id > 0)) continue
    const name = `${(quest as any)?.title ?? ''}`
    push({ type: 'quest', id }, entityNamePlain('quest', id, name) || `任务 ${id}`, `任务 · ${id}`, name)
  }
  for (const [id, mission] of Object.entries(mg.master.missions ?? {})) {
    const n = Number(id)
    if (!(n > 0)) continue
    const ja = `${(mission as any).name ?? ''}`
    push({ type: 'expedition', id: n }, entityNamePlain('expedition', n, ja), `远征 · ${n}`, ja)
  }

  // 同权重的按显示名拼音序收尾。裸 localeCompare 会跟着运行环境的 locale 走，
  // 而应用是带 --lang=en-GB 起的——中文标签当场落回码位序，看着就是乱的。
  out.sort((a, b) => a.rank - b.rank || compareDisplayNames(a.label, b.label))
  return out.slice(0, 40)
}

const renderList = () => {
  if (!listEl) return
  if (!items.length) {
    listEl.innerHTML = input?.value.trim()
      ? '<div class="cp-empty">暂无匹配的舰娘 / 装备 / 任务 / 远征</div>'
      : '<div class="cp-empty">输入名称后按回车打开 · 支持中文名及日文原名</div>'
    return
  }
  listEl.innerHTML = items
    .map(
      (item, index) => `<div class="cp-row${index === active ? ' on' : ''}" data-cp="${index}">
      <span class="cp-kind">${esc(KIND_LABEL[item.ref.type] ?? item.ref.type)}</span>
      <b>${esc(item.label)}</b>
      <i>${esc(item.hint)}</i>
    </div>`,
    )
    .join('')
  listEl.querySelector('.cp-row.on')?.scrollIntoView({ block: 'nearest' })
}

const close = () => {
  host?.classList.remove('open')
  if (input) input.value = ''
  items = []
  active = 0
}

const openRef = (index: number) => {
  const item = items[index]
  if (!item) return
  close()
  navigate(item.ref)
}

const ensureHost = () => {
  if (host) return host
  host = document.createElement('div')
  host.id = 'kanso-command-palette'
  host.innerHTML = `<div class="cp-box" role="dialog" aria-label="全局速查">
    <div class="cp-input"><span>⌕</span><input id="cp-input" placeholder="搜舰娘 / 装备 / 任务 / 远征…" autocomplete="off"></div>
    <div class="cp-list" id="cp-list"></div>
    <div class="cp-foot">↑↓ 选择 · Enter 打开 · Esc 关闭</div>
  </div>`
  document.body.appendChild(host)
  input = host.querySelector<HTMLInputElement>('#cp-input')
  listEl = host.querySelector<HTMLElement>('#cp-list')

  // 点空白处关掉；点到卡片里不关
  host.addEventListener('mousedown', (event) => {
    if (!(event.target as HTMLElement).closest('.cp-box')) close()
  })
  listEl?.addEventListener('click', (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-cp]')
    if (row) openRef(Number(row.dataset.cp))
  })
  // 组合期间不去过滤：那时框里是半截拼音，照它搜只会把候选清空。
  // 这里的输入框不随 renderList 重建（只换 .cp-list），所以组合本身不会被打断。
  const box = input
  if (box) {
    onFilterInput(box, () => {
      items = collect(box.value)
      active = 0
      renderList()
    })
  }
  input?.addEventListener('keydown', (event) => {
    // ↑↓ 选候选字、回车敲定、Esc 取消这一段——组合中的这几下都是给输入法的。
    // 不让开的话，用中文搜舰娘时第一次按回车打开的是上一次的搜索结果。
    if (event.isComposing) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!items.length) return
      active = (active + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length
      renderList()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      openRef(active)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  })
  return host
}

export const openCommandPalette = () => {
  ensureHost().classList.add('open')
  items = []
  active = 0
  renderList()
  input?.focus()
  input?.select()
}

export const initCommandPalette = () => {
  document.addEventListener(
    'keydown',
    (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return
      // 游戏画面在 webview 里，键盘事件不会冒到这里来，所以不用担心抢走游戏的按键
      event.preventDefault()
      if (host?.classList.contains('open')) close()
      else openCommandPalette()
    },
    true,
  )
}
