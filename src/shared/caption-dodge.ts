export const CAPTION_DODGE_CONFIG_KEY = 'kuma.voiceCaptionDodge'
export const CAPTION_DODGE_DEFAULT = true
export const CAPTION_ZONE_CHANNEL = 'kuma:caption-zone'
export const CAPTION_HOVER_CHANNEL = 'kuma:caption-hover'
export const CAPTION_HOVER_EVENT = 'kancolle.caption.hover'

export interface CaptionZone {
  x0: number
  y0: number
  x1: number
  y1: number
}

type Rect = { left: number; top: number; width: number; height: number }

export const sanitizeCaptionZone = (raw: unknown): CaptionZone | null => {
  if (!raw || typeof raw !== 'object') return null
  const { x0, y0, x1, y1 } = raw as CaptionZone
  if (![x0, y0, x1, y1].every(Number.isFinite)) return null
  if (!(0 <= x0 && x0 < x1 && x1 <= 1 && 0 <= y0 && y0 < y1 && y1 <= 1)) return null
  return { x0, y0, x1, y1 }
}

export const captionZoneOf = (hostRect: Rect, wrapperRect: Rect): CaptionZone | null => {
  if (hostRect.width <= 0 || hostRect.height <= 0 || wrapperRect.width <= 0 || wrapperRect.height <= 0) return null
  const clamp = (value: number) => Math.max(0, Math.min(1, value))
  return sanitizeCaptionZone({
    x0: clamp((hostRect.left - wrapperRect.left) / wrapperRect.width),
    y0: clamp((hostRect.top - wrapperRect.top) / wrapperRect.height),
    x1: clamp((hostRect.left + hostRect.width - wrapperRect.left) / wrapperRect.width),
    y1: clamp((hostRect.top + hostRect.height - wrapperRect.top) / wrapperRect.height),
  })
}

export const pointerInZone = (zone: CaptionZone, fx: number, fy: number): boolean =>
  fx >= zone.x0 && fx <= zone.x1 && fy >= zone.y0 && fy <= zone.y1
