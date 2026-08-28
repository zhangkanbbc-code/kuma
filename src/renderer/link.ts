// 链 (Ln) · 全域实体互链内核。按设计稿 15 的完整交互契约：
// - 悬停 400ms → Peek 速览卡
// - 单击 → 跳转默认目标
// - 右键 → 全部目标菜单（未装配的目标显示置灰+原因，绝不渲染死链）
// - Ctrl+单击 → 钉住 Peek（可多张并存对比，可拖动）
// - 未知实体/无路由 → 降级纯文本
import { esc } from './kernel'
import { entityLinkColorClass, localizedLinkLabel } from './localization'

export interface EntityRef {
  type: string
  // 多数实体是数字 id，但也有天然的字符串 id：'current'（当前仓库容量/演习）、
  // 'ids.join(",")'（装备类别组）、舰种名。所以类型必须是联合。
  id: number | string
  ctx?: string
}

/**
 * 路由回调拿到的 ref。`num` 是 id 的数字形态，在分发前统一算好。
 *
 * 没有它的时候，每个 route 的 open/peek/targets 都得自己写一遍
 * `ref.num`——全仓重复了 35 次。
 * 根子在于从 DOM 读回来的 id 永远是字符串，而代码直接 navigate 时是数字，
 * 于是联合类型把转换责任推给了每一个消费点。
 * 字符串 id 的路由照常读 `ref.id`；`num` 对它们是 NaN。
 */
export interface ResolvedEntityRef extends EntityRef {
  num: number
}

const resolve = (ref: EntityRef): ResolvedEntityRef => ({
  ...ref,
  num: typeof ref.id === 'number' ? ref.id : parseInt(ref.id, 10),
})

export interface PeekData {
  title: string
  typeLabel: string
  media?: string // 可选的本地/官方缩略图（已转义的可信 HTML）
  lines: string[] // 核心状态行（已转义的 HTML 片段）
  primary: string // 默认目标名，如「舰娘图鉴」
}

export interface EntityTarget {
  label: string
  disabled?: boolean
  hint?: string // 置灰原因，如「待铨装配」
  run?: () => void
}

interface EntityRoute {
  colorClass: string // e-ship / e-equip / ...
  open(ref: ResolvedEntityRef): void
  peek?(ref: ResolvedEntityRef): PeekData | null
  targets?(ref: ResolvedEntityRef): EntityTarget[] // 右键菜单的额外目标（默认目标自动置顶）
}

const routes: Record<string, EntityRoute> = {}

export const registerEntityRoute = (type: string, route: EntityRoute) => {
  routes[type] = route
}

// 渲染一个 EntityLink。无路由（数据缺失/模块未装配）时降级为纯文本。
// attrs：附加属性，主要给倒计时用（data-cd 让 updateCountdowns 能每秒刷新文本）——
// 降级成纯文本时也要带上，否则链接没了连倒计时也跟着停摆。
const entityLinkHtml = (
  type: string,
  id: number | string,
  body: string,
  ctx?: string,
  attrs?: Record<string, string>,
): string => {
  const extra = attrs
    ? Object.entries(attrs)
        .map(([k, v]) => ` ${k}="${esc(v)}"`)
        .join('')
    : ''
  const route = routes[type]
  if (!route) {
    const colorClass = entityLinkColorClass(type, id)
    if (!colorClass && !extra) return body
    return `<span${colorClass ? ` class="entity-term ${colorClass}"` : ''}${extra}>${body}</span>`
  }
  const colorClass = entityLinkColorClass(type, id) || route.colorClass
  return `<span class="el ${colorClass}" data-etype="${esc(type)}" data-eid="${esc(id)}"${ctx ? ` data-ectx="${esc(ctx)}"` : ''}${extra}>${body}</span>`
}

export const elink = (
  type: string,
  id: number | string,
  text: string,
  ctx?: string,
  attrs?: Record<string, string>,
): string =>
  entityLinkHtml(type, id, localizedLinkLabel(type, id, text) ?? esc(text), ctx, attrs)

// 仅给已经逐字段转义过的内部组件（如 bilingualNameHtml）使用。
export const elinkHtml = (
  type: string,
  id: number | string,
  trustedHtml: string,
  ctx?: string,
  attrs?: Record<string, string>,
): string => entityLinkHtml(type, id, trustedHtml, ctx, attrs)

const refOf = (span: HTMLElement): EntityRef => ({
  type: span.dataset.etype!,
  id: span.dataset.eid!,
  ctx: span.dataset.ectx,
})

export const navigate = (ref: EntityRef) => {
  const route = routes[ref.type]
  if (!route) return
  route.open(resolve(ref))
}

// ---- Peek 速览卡 ----

let peekEl: HTMLElement | null = null
let peekTimer: ReturnType<typeof setTimeout> | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null

const placeAt = (el: HTMLElement, target: HTMLElement) => {
  const rect = target.getBoundingClientRect()
  el.style.visibility = 'hidden'
  el.classList.add('show')
  const w = el.offsetWidth
  const h = el.offsetHeight
  let x = rect.left
  let y = rect.bottom + 6
  if (x + w > window.innerWidth - 10) x = window.innerWidth - w - 10
  if (y + h > window.innerHeight - 10) y = rect.top - h - 6
  el.style.left = `${Math.max(4, x)}px`
  el.style.top = `${Math.max(4, y)}px`
  el.style.visibility = ''
}

const peekHtml = (data: PeekData, pinned: boolean) =>
  `<div class="p-t"><b>${esc(data.title)}</b><span class="ty">${esc(data.typeLabel)}</span>${pinned ? '<span class="pin-x" title="取消钉住">✕</span>' : ''}</div>
   ${data.media ? `<div class="p-media">${data.media}</div>` : ''}
   <div class="p-s">${data.lines.join('<br>')}</div>
   <div class="p-acts"><span class="pa pri">${esc(data.primary)} →</span></div>
   ${pinned ? '' : '<div class="p-hint">单击=跳转 · 右键=全部目标 · Ctrl+单击=钉住</div>'}`

const hidePeek = () => {
  peekEl?.classList.remove('show')
  document.querySelectorAll('.el.peeked').forEach((el) => el.classList.remove('peeked'))
}

const showPeek = (span: HTMLElement) => {
  const route = routes[span.dataset.etype!]
  const ref = refOf(span)
  const data = route?.peek?.(resolve(ref))
  if (!data || !peekEl) return
  document.querySelectorAll('.el.peeked').forEach((el) => el.classList.remove('peeked'))
  span.classList.add('peeked')
  peekEl.innerHTML = peekHtml(data, false)
  placeAt(peekEl, span)
  peekEl.querySelector('.pa')?.addEventListener('click', () => {
    hidePeek()
    navigate(ref)
  })
}

// ---- 钉住的 Peek（可多张，可拖动）----

let pinnedCount = 0

const removePeekCard = (card: HTMLElement) => {
  card.classList.remove('show')
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    card.remove()
    return
  }
  window.setTimeout(() => card.remove(), 220)
}

// 钉住卡的落点：与悬停版 placeAt 同一条规则——量实际尺寸，下方放不下就
// 翻到锚点上方（2026-08-19 用户点的调整：此前只把左上角钳进屏内，超高的
// 卡身子直接怼出屏幕下缘，钉完还得自己拖上来）。offset 是多张钉卡的错位量。
const placePinnedCard = (card: HTMLElement, rect: DOMRect, offset: number) => {
  card.style.visibility = 'hidden'
  const w = card.offsetWidth
  const h = card.offsetHeight
  let x = rect.left + offset
  let y = rect.bottom + 6 + offset
  if (x + w > window.innerWidth - 10) x = window.innerWidth - w - 10
  if (y + h > window.innerHeight - 10) y = rect.top - h - 6 - offset
  card.style.left = `${Math.max(4, x)}px`
  card.style.top = `${Math.max(4, y)}px`
  card.style.visibility = ''
}

// 通用钉卡入口：任何 UI（elink、目录行、表格行……）都可以为实体钉一张对比小窗
export const pinEntityPeek = (ref: EntityRef, anchor: HTMLElement) => {
  const route = routes[ref.type]
  const data = route?.peek?.(resolve(ref))
  if (!data) return
  const card = document.createElement('div')
  card.className = 'peek pinned show'
  card.innerHTML = peekHtml(data, true)
  document.body.appendChild(card)
  placePinnedCard(card, anchor.getBoundingClientRect(), (pinnedCount++ % 6) * 26)
  card.querySelector('.pin-x')?.addEventListener('click', () => removePeekCard(card))
  card.querySelector('.pa')?.addEventListener('click', () => navigate(ref))
  // 拖动
  card.addEventListener('mousedown', (down) => {
    if ((down.target as HTMLElement).closest('.pa, .pin-x')) return
    down.preventDefault()
    const startX = down.clientX - card.offsetLeft
    const startY = down.clientY - card.offsetTop
    const onMove = (move: MouseEvent) => {
      card.style.left = `${move.clientX - startX}px`
      card.style.top = `${move.clientY - startY}px`
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  })
}

// ---- 右键菜单（全部目标）----

let menuEl: HTMLElement | null = null

const hideMenu = () => menuEl?.classList.remove('show')

const showMenu = (span: HTMLElement, event: MouseEvent) => {
  const route = routes[span.dataset.etype!]
  if (!route || !menuEl) return
  const ref = refOf(span)
  const resolved = resolve(ref)
  const data = route.peek?.(resolved)
  const title = data?.title ?? span.textContent ?? ''
  const primary = data?.primary ?? '打开'
  const targets = route.targets?.(resolved) ?? []
  menuEl.innerHTML =
    `<div class="m-t">${esc(title)} · 全部目标</div>` +
    `<div class="mi pri" data-act="primary">${esc(primary)}<span class="k">默认</span></div>` +
    targets
      .map(
        (target, i) =>
          `<div class="mi${target.disabled ? ' dis' : ''}" data-act="${i}">${esc(target.label)}${
            target.hint ? `<span class="k">${esc(target.hint)}</span>` : ''
          }</div>`,
      )
      .join('')
  menuEl.classList.add('show')
  menuEl.style.visibility = 'hidden'
  const w = menuEl.offsetWidth
  const h = menuEl.offsetHeight
  menuEl.style.left = `${Math.min(event.clientX, window.innerWidth - w - 8)}px`
  menuEl.style.top = `${Math.min(event.clientY, window.innerHeight - h - 8)}px`
  menuEl.style.visibility = ''
  menuEl.querySelectorAll<HTMLElement>('.mi').forEach((item) => {
    item.addEventListener('click', () => {
      if (item.classList.contains('dis')) return
      hideMenu()
      if (item.dataset.act === 'primary') {
        navigate(ref)
      } else {
        targets[parseInt(item.dataset.act!, 10)]?.run?.()
      }
    })
  })
}

// ---- 富提示（承载多行数据的长提示）----
//
// 原生 title 装不下十来行数据：不能选中复制、排版不可控、鼠标一动就没。
// 这里复用 Peek 卡的外观与定位，只是不绑实体——挂 data-tip 的元素悬停即显示，
// 点击钉住（可拖、可关）。
//
// **只给「多行数据」用**，说明性的一句话仍旧走原生 title：
// 那是说明文字的详略问题，跟容器选型是两回事。
let tipEl: HTMLElement | null = null
let tipTimer: ReturnType<typeof setTimeout> | null = null

const tipHtml = (target: HTMLElement, pinned: boolean) => {
  const title = target.dataset.tipTitle ?? ''
  const lines = (target.dataset.tip ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  return `<div class="p-t"><b>${esc(title || '说明')}</b>${
    pinned ? '<span class="pin-x" title="取消钉住">✕</span>' : ''
  }</div>
   <div class="p-s">${lines.map((line) => esc(line)).join('<br>')}</div>
   ${pinned ? '' : '<div class="p-hint">单击=钉住（可拖动、可选中复制）</div>'}`
}

const hideTip = () => tipEl?.classList.remove('show')

const pinTip = (target: HTMLElement) => {
  const card = document.createElement('div')
  card.className = 'peek tip pinned show'
  card.innerHTML = tipHtml(target, true)
  document.body.appendChild(card)
  placePinnedCard(card, target.getBoundingClientRect(), (pinnedCount++ % 6) * 26)
  card.querySelector('.pin-x')?.addEventListener('click', () => removePeekCard(card))
  card.addEventListener('mousedown', (down) => {
    if ((down.target as HTMLElement).closest('.pin-x')) return
    // 卡片里的文字要能选中复制，所以只有按在标题栏上才开始拖
    if (!(down.target as HTMLElement).closest('.p-t')) return
    down.preventDefault()
    const startX = down.clientX - card.offsetLeft
    const startY = down.clientY - card.offsetTop
    const move = (m: MouseEvent) => {
      card.style.left = `${m.clientX - startX}px`
      card.style.top = `${m.clientY - startY}px`
    }
    const up = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  })
}

const initRichTips = () => {
  tipEl = document.createElement('div')
  tipEl.className = 'peek tip'
  document.body.appendChild(tipEl)
  document.addEventListener('mouseover', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-tip]')
    if (!target) return
    if (tipTimer) clearTimeout(tipTimer)
    tipTimer = setTimeout(() => {
      if (!tipEl) return
      tipEl.innerHTML = tipHtml(target, false)
      placeAt(tipEl, target)
    }, 260)
  })
  document.addEventListener('mouseout', (event) => {
    if (!(event.target as HTMLElement).closest('[data-tip]')) return
    if (tipTimer) clearTimeout(tipTimer)
    // 悬停卡片本身时不收起，否则里面的字没法选中
    tipTimer = setTimeout(() => {
      if (!tipEl?.matches(':hover')) hideTip()
    }, 180)
  })
  // 上面那条豁免只管「从触发字挪进卡片」，收起的责任跟着就交给了卡片自己——
  // 而卡片从前**没有**任何 mouseleave 出路：指针进卡停一会、再从卡片直接离开
  //（不回触发字），触发字不会再发 mouseout，卡就永远挂在那儿，
  // 只有绕回触发字再移开才收得掉（2026-08-25 用户实机报的，路径是锐的
  // 「≈ 演习 N 场」场次换算卡）。这两条监听是那条豁免缺的另一半。
  //
  // 钉住的卡（pinTip 另建的 .pinned 节点）不走这里：那是用户显式要的对照小窗，
  // 只由 ✕ 关闭。
  tipEl.addEventListener('mouseenter', () => {
    if (tipTimer) clearTimeout(tipTimer)
  })
  tipEl.addEventListener('mouseleave', () => {
    if (tipTimer) clearTimeout(tipTimer)
    tipTimer = setTimeout(hideTip, 180)
  })
  // 捕获相拦截：钉住就是点击 [data-tip] 的全部语义。曾在冒泡端监听——
  // 模块面板的开合处理在 document 之前收到同一次点击，藏在可展开卡里的
  // 提示一点钉住，外层卡也跟着收起（2026-08-19 用户报告）。
  // 两处挂点（ru 场次换算 / ji 改修需求汇总）都是纯信息 span，拦断无副作用；
  // 被跳过的「点外面关菜单」在这里补一手。
  document.addEventListener(
    'click',
    (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-tip]')
      if (!target) return
      event.stopPropagation()
      event.preventDefault()
      hideMenu()
      hideTip()
      pinTip(target)
    },
    true,
  )
}

// ---- 初始化 ----

export const initLink = () => {
  peekEl = document.createElement('div')
  peekEl.className = 'peek'
  document.body.appendChild(peekEl)
  menuEl = document.createElement('div')
  menuEl.className = 'cmenu'
  document.body.appendChild(menuEl)

  document.addEventListener('mouseover', (e) => {
    const span = (e.target as HTMLElement).closest<HTMLElement>('.el')
    if (!span) return
    if (hideTimer) clearTimeout(hideTimer)
    if (peekTimer) clearTimeout(peekTimer)
    peekTimer = setTimeout(() => showPeek(span), 400)
  })
  document.addEventListener('mouseout', (e) => {
    const span = (e.target as HTMLElement).closest<HTMLElement>('.el')
    if (!span) return
    if (peekTimer) clearTimeout(peekTimer)
    hideTimer = setTimeout(hidePeek, 300)
  })
  peekEl.addEventListener('mouseenter', () => {
    if (hideTimer) clearTimeout(hideTimer)
  })
  peekEl.addEventListener('mouseleave', () => {
    hideTimer = setTimeout(hidePeek, 200)
  })

  // 滚轮翻页不移动指针，mouseout 不会触发——内容滚走后速览卡钉在原地，
  // 直到指针挪到下一个实体上才消失（2026-08-12 用户抓的实锤）。
  // 任何容器一滚（scroll 不冒泡，用捕获接）就收卡收 tip、掐掉待弹的计时器；
  // 钉住的卡（pinned）是用户显式要的对照小窗，不动。
  document.addEventListener(
    'scroll',
    () => {
      if (peekTimer) clearTimeout(peekTimer)
      if (tipTimer) clearTimeout(tipTimer)
      hidePeek()
      hideTip()
      hideMenu()
    },
    { capture: true, passive: true },
  )

  document.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('.cmenu')) hideMenu()
    if ((e.target as HTMLElement).closest('[data-l10n-toggle]')) return
    const span = (e.target as HTMLElement).closest<HTMLElement>('.el')
    if (!span) return
    const route = routes[span.dataset.etype!]
    if (!route) return
    if (peekTimer) clearTimeout(peekTimer)
    hidePeek()
    if (e.ctrlKey || e.altKey) {
      pinEntityPeek(refOf(span), span)
    } else {
      navigate(refOf(span))
    }
  })

  document.addEventListener('contextmenu', (e) => {
    const span = (e.target as HTMLElement).closest<HTMLElement>('.el')
    if (!span) return
    e.preventDefault()
    hidePeek()
    showMenu(span, e)
  })

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hidePeek()
      hideMenu()
      hideTip()
    }
  })

  initRichTips()
}
