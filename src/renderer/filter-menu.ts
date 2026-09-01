// 紧凑抬头的「点开选」下拉，钦与镖共用一份。
//
// **浮层一律挂 document.body**：模块面板既裁 overflow（`.ws-pane` 及其内层滚动区）
// 又带 transform（空变换也算），放在面板里 absolute 会被裁掉、fixed 会把面板当包含块
// 飞出屏幕——三种做法都栽过。位置在摆出来之后用锚点的视口矩形现算。
// 也不用原生 select/datalist：那两样的弹层滚轮与配色都不可控。
import { esc } from './kernel'

export interface FilterMenuItem {
  key: string | null
  label: string
  /** 数得出条目数的筛选才给（排序这类没有「多少条」可言，不给就不摆） */
  count?: number
  /** 有色点的分类才给；不给就只摆字 */
  color?: string
  on: boolean
}

export interface FilterMenuSpec {
  title: string
  items: FilterMenuItem[]
  pick: (value: string | null) => void
}

let menuEl: HTMLElement | null = null
let openKey: string | null = null

export const hideFilterMenu = () => {
  menuEl?.classList.remove('show')
  openKey = null
}

// 元素与它的监听都只装一次：菜单住在 body、不随 pane 生灭，
// 模块重复装配（重试）不会把监听叠上去。
const ensureMenu = (): HTMLElement => {
  if (menuEl) return menuEl
  const menu = document.createElement('div')
  menu.className = 'cmenu filter-menu'
  document.body.appendChild(menu)
  menuEl = menu
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement
    // 开菜单的那一下也会冒到这里；点在锚点上交给锚点自己的处理器去翻转
    if (target.closest('.filter-menu') || target.closest('[data-filter-menu]')) return
    hideFilterMenu()
  })
  document.addEventListener('keydown', (event) => {
    // 组合中的 Esc 是给输入法候选窗的，别顺手收了菜单
    if (event.key === 'Escape' && !event.isComposing) hideFilterMenu()
  })
  window.addEventListener('resize', hideFilterMenu)
  // 容器一滚锚点就移位，留在原地的菜单会指着别的东西（同链的 Peek）。
  // 菜单自己内部的滚动不算——条目多时它自带滚动条。
  document.addEventListener(
    'scroll',
    (event) => {
      if (event.target instanceof Node && menu.contains(event.target)) return
      hideFilterMenu()
    },
    true,
  )
  return menu
}

export const showFilterMenu = (anchor: HTMLElement, key: string, spec: FilterMenuSpec) => {
  // 再点一次同一枚钮 = 收起
  if (openKey === key && menuEl?.classList.contains('show')) {
    hideFilterMenu()
    return
  }
  const menu = ensureMenu()
  openKey = key
  menu.innerHTML =
    `<div class="m-t">${esc(spec.title)}</div>` +
    spec.items
      .map(
        (item, index) =>
          `<div class="mi${item.on ? ' pri' : ''}" data-pick="${index}">${
            item.color ? `<s class="dot" style="background:${esc(item.color)}"></s>` : ''
          }${esc(item.label)}${item.count == null ? '' : `<span class="k">${item.count}</span>`}</div>`,
      )
      .join('')
  menu.onclick = (event) => {
    const hit = (event.target as HTMLElement).closest<HTMLElement>('[data-pick]')
    if (!hit) return
    const chosen = spec.items[Number(hit.dataset.pick)]
    hideFilterMenu()
    if (chosen) spec.pick(chosen.key)
  }
  // 先隐形摆出来量真实尺寸，再定位现形——不量就判不出该往上还是往下开
  menu.style.visibility = 'hidden'
  menu.classList.add('show')
  const rect = anchor.getBoundingClientRect()
  const width = menu.offsetWidth
  const height = menu.offsetHeight
  const above = rect.bottom + height > window.innerHeight - 6 && rect.top >= height
  menu.style.left = `${Math.min(Math.max(4, rect.left), Math.max(4, window.innerWidth - width - 4))}px`
  menu.style.top = `${Math.max(4, above ? rect.top - height - 2 : rect.bottom + 2)}px`
  menu.style.visibility = ''
}
