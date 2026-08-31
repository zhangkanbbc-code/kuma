// 组合实验室的自绘联想下拉（2026-08-30 玩家两条反馈的合并修复）。
//
// 原来舰娘框与装备格挂的是原生 `<datalist>`，两条毛病都出在「那层弹窗不是页面的」：
//   ① 弹层没有对应的 DOM，鼠标滚轮滚不动（Chromium 的老毛病，挂不上任何监听）；
//   ② 弹层由系统绘制、不吃页面 CSS，深色主题下是一片白底，与界面脱线。
// 换成自己画的浮层，两条一起解决：它就是个普通的 overflow:auto 容器，滚轮天然能滚，
// 配色走 index.html 里的主题变量。
//
// **浮层挂 body，不挂面板**：模块面板既裁 overflow 又有 transform 包含块，
// 挂在里面的 absolute 会被裁掉、fixed 会按面板而不是视口定位。
//
// 舰娘框与装备格共用这一份：数据源各给各的（SuggestField.entries），
// 交互、配色、键位只此一处。回填一律走「写值 + 派发 change」——
// 解析 mstId、loadShip 带装备与 ★ 都还是 ji-lab 那个 change handler 干的，
// 这里一个字段都不自己解析，免得两处口径分家。
import { esc } from '../kernel'
import {
  filterSuggestions,
  moveSuggestActive,
  type SuggestEntry,
} from '../../shared/suggest-list'

export type { SuggestEntry }

export interface SuggestField {
  /** 候选全集。开合与每次输入各取一次，按数据源身份做记忆是调用方的事 */
  entries: () => SuggestEntry[]
  /** 还没输字时列在最上面那行小字 */
  previewNote: string
  /** 输了字但一条都没匹配上时的空态 */
  emptyText: string
}

/** 过滤后最多列几条。与全局速查（command-palette）同一档 */
const LIMIT = 40
/** 还没输字时先列几条。导出给调用方拼那行小字，免得文案里的数字与这里分家 */
export const SUGGEST_PREVIEW = 12
/** 浮层最窄多少：装备格的输入框能收到 110px，照那个宽度列装备名读不出来 */
const MIN_WIDTH = 232

let host: HTMLElement | null = null
let listEl: HTMLElement | null = null
let anchor: HTMLInputElement | null = null
let field: SuggestField | null = null
let items: SuggestEntry[] = []
let active = -1
/** 开合那一刻算好的裁剪祖先：滚动时拿它判「锚点被卷出去了没有」 */
let clips: HTMLElement[] = []
let closeTimer: ReturnType<typeof setTimeout> | null = null
let placeQueued = false

const isOpen = () => !!host?.classList.contains('open')

/** 锚点被自己的滚动容器卷出去了，或整个滚出视口 */
const anchorGone = (): boolean => {
  if (!anchor?.isConnected) return true
  const rect = anchor.getBoundingClientRect()
  if (rect.bottom <= 0 || rect.top >= window.innerHeight) return true
  return clips.some((clip) => {
    const box = clip.getBoundingClientRect()
    return rect.bottom <= box.top || rect.top >= box.bottom
  })
}

// 开合时走一遍祖先链，把会裁内容的那几层记下来。放在开合期做而不是每次滚动做：
// getComputedStyle 不便宜，而滚动事件是连发的。
const collectClips = (el: HTMLElement): HTMLElement[] => {
  const out: HTMLElement[] = []
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node)
    if (style.overflowY !== 'visible' || style.overflowX !== 'visible') out.push(node)
  }
  return out
}

const place = () => {
  if (!host || !anchor) return
  const rect = anchor.getBoundingClientRect()
  const width = Math.min(Math.max(rect.width, MIN_WIDTH), Math.max(120, window.innerWidth - 8))
  host.style.width = `${width}px`
  // 量高度之前先摆成不可见：offsetHeight 要求元素已经在布局里，
  // 直接显示出来量会先在错位置闪一帧。
  host.style.visibility = 'hidden'
  host.classList.add('open')
  const height = host.offsetHeight
  const flip = rect.bottom + height > window.innerHeight - 6 && rect.top >= height
  const top = flip ? rect.top - height - 2 : rect.bottom + 2
  const left = Math.min(Math.max(4, rect.left), Math.max(4, window.innerWidth - width - 4))
  host.style.left = `${left}px`
  host.style.top = `${Math.max(4, top)}px`
  host.style.visibility = ''
}

const render = () => {
  if (!host || !listEl || !field) return
  const all = field.entries()
  const typed = anchor?.value ?? ''
  // 框里原样躺着的就是已经选中的那一条时，按「还没输字」处理。
  // 照着过滤只会列出它自己——而点进一个已经填好的格子，玩家要的是换一件。
  const query = all.some((entry) => entry.value === typed) ? '' : typed
  const page = filterSuggestions(all, query, { limit: LIMIT, preview: SUGGEST_PREVIEW })
  items = page.items
  if (active >= items.length) active = items.length ? items.length - 1 : -1
  // 只在真被切掉过的时候才写那行小字：列全了还说「前 12 件」是假话，
  // 而玩家看得见列表已经到底了
  const note = !page.truncated
    ? ''
    : page.preview
      ? field.previewNote
      : `只列前 ${LIMIT} 条，接着输入可缩小范围`
  const rows = items.length
    ? items
        .map(
          (item, index) => `<div class="ls-row${index === active ? ' on' : ''}" data-ls="${index}">
      <b>${esc(item.label ?? item.value)}</b>${item.hint ? `<i>${esc(item.hint)}</i>` : ''}
    </div>`,
        )
        .join('')
    : `<div class="ls-empty">${esc(field.emptyText)}</div>`
  listEl.innerHTML = `${note ? `<div class="ls-note">${esc(note)}</div>` : ''}${rows}`
  place()
  listEl.querySelector('.ls-row.on')?.scrollIntoView({ block: 'nearest' })
}

/** 选中一条：写值 + 派发 change，剩下的交给 ji-lab 原来那个 change handler */
const commit = (index: number) => {
  const item = items[index]
  const input = anchor
  if (!item || !input) return
  closeSuggest()
  input.value = item.value
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

const ensureHost = (): HTMLElement => {
  if (host) return host
  host = document.createElement('div')
  host.id = 'ji-lab-suggest'
  host.setAttribute('role', 'listbox')
  host.innerHTML = `<div class="ls-list"></div>
    <div class="ls-foot">↑↓ 选择 · Enter 填入 · Esc 收起</div>`
  document.body.appendChild(host)
  listEl = host.querySelector<HTMLElement>('.ls-list')

  // 按在候选上不能把输入框的焦点抢走：焦点一走 focusout 就把浮层收了，click 永远不到
  host.addEventListener('mousedown', (event) => event.preventDefault())
  host.addEventListener('click', (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-ls]')
    if (row) commit(Number(row.dataset.ls))
  })
  // 面板滚动/窗口改尺寸：跟着重定位，锚点被卷出去就收起。
  // 滚动是连发的，合到下一帧只算一次。
  const follow = () => {
    if (!isOpen() || placeQueued) return
    placeQueued = true
    requestAnimationFrame(() => {
      placeQueued = false
      if (!isOpen()) return
      if (anchorGone()) closeSuggest()
      else place()
    })
  }
  document.addEventListener('scroll', follow, true)
  window.addEventListener('resize', follow)
  return host
}

/** 开合浮层（已经开着就只是按当前输入重列一遍） */
export const openSuggest = (input: HTMLInputElement, next: SuggestField) => {
  ensureHost()
  if (closeTimer) {
    clearTimeout(closeTimer)
    closeTimer = null
  }
  if (anchor !== input) {
    anchor = input
    clips = collectClips(input)
  }
  // 重开与「又敲了一个字」都算换了一批候选，高亮一律落回未选中：
  // 留着上一批的下标，回车会填到一条玩家根本没看过的候选上
  active = -1
  field = next
  render()
}

export const closeSuggest = () => {
  if (closeTimer) {
    clearTimeout(closeTimer)
    closeTimer = null
  }
  host?.classList.remove('open')
  anchor = null
  field = null
  items = []
  active = -1
  clips = []
}

/**
 * 焦点离开输入框：晚一拍再收。
 *
 * 被动重渲会把整块实验室的 innerHTML 换掉，输入框跟着被摘下再放回去——
 * 那一瞬间焦点掉到 body 上，随后又被 withViewStateKept 还原回新的输入框。
 * 当场就收的话，玩家什么都没干，浮层自己闪一下没了。
 */
export const scheduleSuggestClose = () => {
  if (!isOpen() || closeTimer) return
  closeTimer = setTimeout(() => {
    closeTimer = null
    const focused = document.activeElement
    if (focused === anchor || (focused && host?.contains(focused))) return
    closeSuggest()
  }, 0)
}

/** 输入框上的按键。返回 true = 这一下已经被浮层吃掉，调用方别再往下走 */
export const suggestKeydown = (
  event: KeyboardEvent,
  input: HTMLInputElement,
  next: SuggestField,
): boolean => {
  // 输入法组合中的 ↑↓ / 回车 / Esc 是给候选字窗口的，不是给这层浮层的
  // （实测：敲定候选那一下的 keydown 照样带 isComposing）。抢过来的话，
  // 用中文敲装备名时第一次回车填进去的是浮层里高亮的那条，不是玩家选的字。
  if (event.isComposing) return false
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    // 收着的时候按 ↓ 就是「把候选叫出来」，与原生 datalist 的手感一致
    if (!isOpen() || anchor !== input) openSuggest(input, next)
    active = moveSuggestActive(active, items.length, event.key === 'ArrowDown' ? 1 : -1)
    render()
    return true
  }
  if (event.key === 'Enter') {
    if (!isOpen() || anchor !== input || active < 0) return false
    event.preventDefault()
    commit(active)
    return true
  }
  if (event.key === 'Escape') {
    if (!isOpen()) return false
    // 不让它冒上去：全局速查也认 Esc，收个联想不该顺手关掉别的东西
    event.preventDefault()
    event.stopPropagation()
    closeSuggest()
    return true
  }
  return false
}
