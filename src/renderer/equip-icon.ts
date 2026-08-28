// 装备类别图标（api_type[3]）。
//
// SVG 素材取自 poi assets/svg/slotitem（MIT License,
// Copyright (c) 2015-2021 poi contributors），随应用本地分发；
// 列表和编成因此不需要为了小图标访问游戏资源服务器。
//
// 例外三张（2026-08-11 用户指出夜間瑞雲与夜偵同图后核对全目录）：poi 上游对
// 48(襲撃機)/49(大型陸上機)/51(夜間水上爆撃機) 发的就是 37/44/50 的逐字节复制，
// 本仓改成同剪影换色的自制衍生图（48 红褐、49 橄榄绿、51 夜航蓝灰），
// 沿用 poi 的单色剪影语言；配色是区分用的自定色，不是游戏原色。

export const EQUIP_TYPE_MARKS: Record<number, [string, string]> = {
  1: ['炮', 'gun'], 2: ['炮', 'gun'], 3: ['炮', 'gun'], 4: ['副', 'gun'],
  5: ['雷', 'tpb'], 6: ['战', 'ftr'], 7: ['爆', 'bmb'], 8: ['攻', 'tpb'],
  9: ['侦', 'rec'], 10: ['水', 'rec'], 11: ['电', 'rdr'], 12: ['声', 'rdr'],
  13: ['声', 'rdr'], 14: ['潜', 'rdr'], 15: ['枪', 'gun'], 16: ['高', 'gun'],
  17: ['爆雷', 'rdr'], 18: ['声', 'rdr'], 21: ['机', 'ftr'], 22: ['艇', 'tpb'],
  24: ['陆', 'gun'], 26: ['修', 'rec'], 33: ['飞', 'rec'], 43: ['水战', 'ftr'],
  45: ['夜战', 'ftr'], 48: ['袭', 'bmb'], 49: ['大陆', 'bmb'],
  50: ['夜侦', 'rec'], 51: ['夜水', 'rec'],
}

// 当前随包分发的 poi SVG 集合。缺失类型直接显示文字降级，不发网络请求。
const SVG_ICON_IDS = new Set([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
  20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37,
  38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 54, 55, 56,
  57, 58, 59, 60,
])

const htmlEsc = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

export interface EquipTypeIconOptions {
  className?: string
  title?: string
  overlay?: string
}

// 游戏图集切片样式的提供方（kcs-image 在主渲染进程里接线）。
// poi 的 SVG 剪影与游戏原版形状对不上（水上机应带浮筒、48/49/51 上游是复制品，
// 2026-08-11 用户逐一指出），所以有游戏一手图形时优先用它；
// 没接provider（独立小窗）或图集拿不到（离线且缓存里没有）时退回 SVG，再退文字。
let spriteStyleOf: ((iconId: number) => string | null) | null = null
export const setEquipIconSpriteProvider = (provider: (iconId: number) => string | null): void => {
  spriteStyleOf = provider
}

/**
 * 统一的装备类别图标。
 * `overlay` 只接受调用端生成的可信 HTML，用于 ★、熟练度与搭载数角标。
 */
export const equipTypeIconHtml = (
  iconId: number,
  { className = '', title = '', overlay = '' }: EquipTypeIconOptions = {},
): string => {
  const [mark, tone] = EQUIP_TYPE_MARKS[iconId] ?? ['装', '']
  const safeClasses = className.replace(/[^\w -]/g, '').trim()
  const sprite = spriteStyleOf?.(iconId) ?? null
  const hasSvg = SVG_ICON_IDS.has(iconId)
  const classes = ['equip-icon', tone, safeClasses, sprite || hasSvg ? '' : 'fallback']
    .filter(Boolean)
    .join(' ')
  return `<span class="${classes}"${title ? ` title="${htmlEsc(title)}"` : ''} role="img" aria-label="${htmlEsc(title || mark)}">
    ${
      sprite
        ? `<i class="equip-icon-game" style="${htmlEsc(sprite)}" aria-hidden="true"></i>`
        : hasSvg
          ? `<img src="./assets/slotitem/${iconId}.svg" alt="" aria-hidden="true" data-equip-type-icon>`
          : ''
    }
    <span class="equip-icon-fallback${mark.length > 1 ? ' w2' : ''}">${htmlEsc(mark)}</span>${overlay}
  </span>`
}

let fallbackInstalled = false

/** 图标素材意外缺失或损坏时隐藏破图，切到同类别的文字标记。 */
export const installEquipIconFallback = (): void => {
  if (fallbackInstalled) return
  fallbackInstalled = true
  document.addEventListener(
    'error',
    (event) => {
      const img = event.target
      if (!(img instanceof HTMLImageElement) || !img.matches('[data-equip-type-icon]')) return
      img.closest<HTMLElement>('.equip-icon')?.classList.add('fallback')
      img.hidden = true
      // 装备卡面（[data-equip-art]）的 404 回退不在这里——ji.ts 渲染后会逐个绑，
      // 那边能重建成类别图标，比这里只是藏掉更完整。别在这里重复接一遍。
    },
    true,
  )
}
