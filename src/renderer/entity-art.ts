// 跨模块复用的实体缩略图：舰娘/深海舰使用游戏官方 banner，
// 资源与常用消耗品使用随包分发的 poi 默认 material PNG。
import { shipImageUrl, useItemImageUrl } from './kcs-image'
import { localizedLabelText } from './localization'

const htmlEsc = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

const safeClass = (value: string): string => value.replace(/[^\w -]/g, '').trim()

export interface ShipThumbOptions {
  className?: string
  placeholder?: string
  abyss?: boolean
  /**
   * 用沉没后的灰色横幅（banner_g，游戏在击沉/击破时显示的那张）。
   * 不是每艘舰都有这张图，取不到时自动退回普通横幅——**别掉到文字占位**，
   * 那比显示一张正常横幅差得多。
   */
  sunk?: boolean
  /**
   * 中破/大破时换游戏的受损横幅（banner_dmg）。阈值见 shared 的 shipArtDamaged。
   * 与 sunk 并列时沉没优先：已经沉了就该是那张灰的，而不是中破的。
   * 深海舰没有 `_dmg` 变体（shipImageUrl 会把它抹回常态路径），传了也只会得到常态图。
   */
  damaged?: boolean
}

/** 缩略图分三档：沉没 > 受损 > 常态。每一档都备好常态横幅当后路。 */
type ThumbTier = { sunk: boolean; damaged: boolean }

const thumbUrls = (
  mstId: number,
  { sunk, damaged }: ThumbTier,
): { url: string | null; fallback: string | null } => {
  if (!(mstId > 0)) return { url: null, fallback: null }
  const normal = shipImageUrl(mstId, 'banner')
  // 变体与常态同址（深海舰、或那张图根本推不出来）时就当没有这一档：
  // 留着 fallback 只会让错误处理多绕一圈，最终还是这张。
  const variant = sunk
    ? shipImageUrl(mstId, 'banner_g')
    : damaged
      ? shipImageUrl(mstId, 'banner', true)
      : null
  if (!variant || variant === normal) return { url: normal, fallback: null }
  return { url: variant, fallback: normal }
}

/** 渲染与就地换档共用一份档位判定：沉没吃掉受损，免得两处各写一遍优先级。 */
const thumbTier = (sunk: boolean, damaged: boolean): ThumbTier => ({
  sunk,
  damaged: damaged && !sunk,
})

export const shipThumbHtml = (
  mstId: number,
  name: string,
  {
    className = '',
    placeholder,
    abyss = mstId >= 1500,
    sunk = false,
    damaged = false,
  }: ShipThumbOptions = {},
): string => {
  const tier = thumbTier(sunk, damaged)
  const { url, fallback } = thumbUrls(mstId, tier)
  // 11 处调用里过去只有一处记得先查译名，其余把主数据的日文原名直接塞进
  // title/aria；缺图时格子里显示的更是日文首字——同一行的可见文字早就是中文了。
  // 这一层自己查表，调用方照旧传原名即可（认不出就原样返回，不硬翻）。
  const shown = localizedLabelText(mstId >= 1500 ? 'abyssShip' : 'ship', mstId, name)
  const initial = placeholder ?? (shown.charAt(0) || '?')
  const classes = ['ship-thumb', abyss ? 'abyss' : '', safeClass(className), url ? '' : 'fallback']
    .filter(Boolean)
    .join(' ')
  return `<span class="${classes}" title="${htmlEsc(shown)}" role="img" aria-label="${htmlEsc(shown)}" data-ship-id="${mstId}"${tier.sunk ? ' data-ship-sunk' : ''}${tier.damaged ? ' data-ship-damaged' : ''}>
    ${url ? `<img src="${htmlEsc(url)}" alt="" loading="lazy" decoding="async" fetchpriority="low" aria-hidden="true" data-ship-thumb${fallback ? ` data-thumb-fallback="${htmlEsc(fallback)}"` : ''}>` : ''}
    <span class="ship-thumb-fallback">${htmlEsc(initial)}</span>
  </span>`
}

/** 元素当前挂着的是哪一档（属性即状态，重渲染与就地换档共用同一个真值来源） */
const tierOfThumb = (thumb: HTMLElement): ThumbTier => ({
  sunk: thumb.hasAttribute('data-ship-sunk'),
  damaged: thumb.hasAttribute('data-ship-damaged'),
})

/**
 * 就地把一张已经渲染好的缩略图换到另一档。
 *
 * 给的是**不重渲染整块**的场合（镝按阶段拨血条那条路）：那里换 innerHTML 会把
 * 血条过渡整个废掉，所以图也只能就地改。
 *
 * 档位没变时一个属性都不动——`src` 一旦重设，浏览器要重走一遍取图与解码，
 * 每来一条补丁闪一次图。判据是「档」不是 URL，正是为了这个。
 */
export const setShipThumbTier = (
  thumb: HTMLElement | null | undefined,
  { sunk = false, damaged = false }: { sunk?: boolean; damaged?: boolean },
): void => {
  if (!thumb) return
  const next = thumbTier(sunk, damaged)
  const now = tierOfThumb(thumb)
  if (now.sunk === next.sunk && now.damaged === next.damaged) return
  thumb.toggleAttribute('data-ship-sunk', next.sunk)
  thumb.toggleAttribute('data-ship-damaged', next.damaged)
  const img = thumb.querySelector<HTMLImageElement>('[data-ship-thumb]')
  if (!img) return // 还没补图（远端关着/主数据没到），等 hydrate 时按新属性取
  const { url, fallback } = thumbUrls(Number(thumb.dataset.shipId), next)
  if (!url) return
  if (fallback) img.setAttribute('data-thumb-fallback', fallback)
  else img.removeAttribute('data-thumb-fallback')
  if (img.getAttribute('src') !== url) img.setAttribute('src', url)
  // 上一档可能 404 过、被错误处理藏了；换了一张就该重新给它露面的机会
  img.hidden = false
  thumb.classList.remove('fallback')
}

// api_material 下标 → poi material 图标 ID。
export const MATERIAL_ICON_BY_INDEX = [1, 2, 3, 4, 5, 6, 7, 8] as const

// api_mst_useitem ID → 同视觉含义的 poi material 图标 ID。
export const MATERIAL_ICON_BY_USEITEM: Record<number, number> = {
  1: 6, // 高速修复材
  2: 5, // 高速建造材
  3: 7, // 开发资材
  4: 8, // 改修资材
  10: 10,
  11: 11,
  12: 12,
}

export interface MaterialIconOptions {
  className?: string
  title?: string
}

export const materialIconHtml = (
  materialIconId: number,
  { className = '', title = '' }: MaterialIconOptions = {},
): string =>
  `<span class="${['material-icon', safeClass(className)].filter(Boolean).join(' ')}"${
    title ? ` title="${htmlEsc(title)}"` : ''
  } role="img" aria-label="${htmlEsc(title || '资材')}">
    <img src="./assets/material/0${materialIconId}.png" alt="" aria-hidden="true" data-material-icon>
  </span>`

export interface UseItemIconOptions {
  className?: string
  placeholder?: string
}

const USEITEM_FALLBACK_MARKS: Record<number, string> = {
  53: '港',
  103: '鍵',
}

// 家具币（useitem 44）没有任何现成图源：官方 card_ 树实测 404（见 kcs-image 的
// 排除名单），poi 素材集也只有家具箱。自绘一枚——金描边圆币 + 屋形剪影，
// 色取 --gold 的实值（SVG 里用 CSS 变量会随 fallback 容器变灰，这里要它恒金）。
const FURNITURE_COIN_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <circle cx="12" cy="12" r="10" fill="#2c2617" stroke="#e8c66a" stroke-width="1.6"/>
  <path d="M6.8 12.2 12 7.6l5.2 4.6" fill="none" stroke="#e8c66a" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M8.6 12.4v4h6.8v-4" fill="none" stroke="#e8c66a" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`

// 家具（装饰品）通用小图标：屋形线条，与家具币的屋剪影同构；
// 色沿任务奖励区原「家」字块的绿。具体家具没有独立美术，这枚是类别标识。
const FURNITURE_HOUSE_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M4.6 12 12 5.4 19.4 12" fill="none" stroke="#9fd6a8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M6.9 11.7V18h10.2v-6.3" fill="none" stroke="#9fd6a8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M10.3 18v-3.4h3.4V18" fill="none" stroke="#9fd6a8" stroke-width="1.5" stroke-linejoin="round"/>
</svg>`

export const furnitureIconHtml = (title = '家具', className = ''): string =>
  `<span class="${['useitem-icon', 'fallback', safeClass(className)].filter(Boolean).join(' ')}" title="${htmlEsc(title)}" role="img" aria-label="${htmlEsc(title)}">
    <span class="useitem-icon-fallback">${FURNITURE_HOUSE_SVG}</span>
  </span>`

/** api_mst_useitem 的官方卡面；缓存优先，未缓存时沿用美术资源开关。 */
export const useItemIconHtml = (
  mstId: number,
  name: string,
  { className = '', placeholder }: UseItemIconOptions = {},
): string => {
  const url = mstId > 0 ? useItemImageUrl(mstId) : null
  const materialFallbackId = MATERIAL_ICON_BY_USEITEM[mstId]
  // 与 shipThumbHtml 同一条口径：title/aria/占位首字在这一层查译名。14 处调用里
  // 6 处记得先过 entityNamePlain、8 处直接摆主数据日文名——查表放在这里，两种写法
  // 就都出中文（已经是中文的原样命中词条，不会被改二次；查不到照旧保原文）。
  const shown = localizedLabelText('item', mstId, name)
  const fallback =
    mstId === 44
      ? FURNITURE_COIN_SVG
      : materialFallbackId
        ? `<img src="./assets/material/0${materialFallbackId}.png" alt="" aria-hidden="true">`
        : htmlEsc(placeholder ?? USEITEM_FALLBACK_MARKS[mstId] ?? shown.charAt(0) ?? '?')
  const classes = ['useitem-icon', safeClass(className), url ? '' : 'fallback'].filter(Boolean).join(' ')
  return `<span class="${classes}" title="${htmlEsc(shown)}" role="img" aria-label="${htmlEsc(shown)}" data-useitem-id="${mstId}">
    ${url ? `<img src="${htmlEsc(url)}" alt="" loading="lazy" decoding="async" fetchpriority="low" aria-hidden="true" data-useitem-icon>` : ''}
    <span class="useitem-icon-fallback">${fallback}</span>
  </span>`
}

let fallbackInstalled = false

const hydrateShipThumbs = () => {
  document.querySelectorAll<HTMLElement>('.ship-thumb[data-ship-id]').forEach((thumb) => {
    if (thumb.querySelector('[data-ship-thumb]')) return
    const mstId = Number(thumb.dataset.shipId)
    // 档位要跟首次渲染时一致，否则补图会把灰色/受损横幅换成普通的
    const { url, fallback } = thumbUrls(mstId, tierOfThumb(thumb))
    if (!url) return
    const img = document.createElement('img')
    img.src = url
    if (fallback) img.setAttribute('data-thumb-fallback', fallback)
    img.alt = ''
    img.loading = 'lazy'
    img.decoding = 'async'
    img.setAttribute('fetchpriority', 'low')
    img.setAttribute('aria-hidden', 'true')
    img.setAttribute('data-ship-thumb', '')
    img.addEventListener(
      'load',
      () => {
        img.hidden = false
        thumb.classList.remove('fallback')
      },
      { once: true },
    )
    thumb.insertBefore(img, thumb.querySelector('.ship-thumb-fallback'))
  })
}

const hydrateUseItemIcons = () => {
  document.querySelectorAll<HTMLElement>('.useitem-icon[data-useitem-id]').forEach((icon) => {
    if (icon.querySelector('[data-useitem-icon]')) return
    const mstId = Number(icon.dataset.useitemId)
    const url = mstId > 0 ? useItemImageUrl(mstId) : null
    if (!url) return
    const img = document.createElement('img')
    img.src = url
    img.alt = ''
    img.loading = 'lazy'
    img.decoding = 'async'
    img.setAttribute('fetchpriority', 'low')
    img.setAttribute('aria-hidden', 'true')
    img.setAttribute('data-useitem-icon', '')
    img.addEventListener(
      'load',
      () => {
        img.hidden = false
        icon.classList.remove('fallback')
      },
      { once: true },
    )
    icon.insertBefore(img, icon.querySelector('.useitem-icon-fallback'))
  })
}

/** 所有实体缩略图统一在捕获阶段消除破图，保留可辨识的文字占位。 */
export const installEntityArtFallback = (): void => {
  if (fallbackInstalled) return
  fallbackInstalled = true
  document.addEventListener('kanso:art-source-change', () => {
    hydrateShipThumbs()
    hydrateUseItemIcons()
  })
  document.addEventListener(
    'error',
    (event) => {
      const img = event.target
      if (!(img instanceof HTMLImageElement)) return
      if (img.matches('[data-ship-thumb]')) {
        // 沉没/受损横幅不是每艘都有；先退回普通横幅，实在没有才掉到文字占位
        const alt = img.getAttribute('data-thumb-fallback')
        if (alt && alt !== img.getAttribute('src')) {
          img.removeAttribute('data-thumb-fallback')
          img.setAttribute('src', alt)
          return
        }
        img.closest<HTMLElement>('.ship-thumb')?.classList.add('fallback')
        img.hidden = true
      } else if (img.matches('[data-material-icon]')) {
        img.closest<HTMLElement>('.material-icon')?.classList.add('fallback')
        img.hidden = true
      } else if (img.matches('[data-useitem-icon]')) {
        img.closest<HTMLElement>('.useitem-icon')?.classList.add('fallback')
        img.hidden = true
      }
    },
    true,
  )
}
