export const DISTRACT_SIDES = ['top', 'bottom', 'left', 'right'] as const
export type DistractSide = (typeof DISTRACT_SIDES)[number]

export const DISTRACT_SIDE_LABEL = { top: '上', bottom: '下', left: '左', right: '右' } as const
export const DISTRACT_PATHS = {
  side: 'kuma.distract.side',
  alwaysOnTop: 'kuma.distract.alwaysOnTop',
  showFleet: 'kuma.distract.showFleet',
  bounds: 'kuma.distract.bounds',
} as const
export const DISTRACT_DEFAULTS = { side: 'bottom', alwaysOnTop: true, showFleet: true } as const
export const DISTRACT_DEFAULT_SIZE = { width: 600, height: 780 } as const

export const normalizeDistractSide = (raw: unknown): DistractSide =>
  DISTRACT_SIDES.includes(raw as DistractSide) ? raw as DistractSide : DISTRACT_DEFAULTS.side

export const cycleDistractSide = (side: DistractSide): DistractSide =>
  DISTRACT_SIDES[(DISTRACT_SIDES.indexOf(normalizeDistractSide(side)) + 1) % DISTRACT_SIDES.length]

interface Bounds { x: number; y: number; width: number; height: number }

/** 小窗尺寸不超过当前屏幕工作区，四条边都夹在可见范围内。 */
export const fitBoundsToWorkArea = (
  bounds: Partial<Bounds>, workArea: Bounds, fallback: Bounds,
): Bounds => {
  const width = Math.min(workArea.width, Math.max(1, bounds.width ?? fallback.width))
  const height = Math.min(workArea.height, Math.max(1, bounds.height ?? fallback.height))
  const x = Math.max(workArea.x, Math.min(bounds.x ?? fallback.x, workArea.x + workArea.width - width))
  const y = Math.max(workArea.y, Math.min(bounds.y ?? fallback.y, workArea.y + workArea.height - height))
  return { x, y, width, height }
}
