// scrollWidth 与 clientWidth 的整数取整会有误差，状态区按内容定宽后又没有余量，因此判定需留容差。
export interface HeaderWidthMeasurement {
  scrollWidth: number
  clientWidth: number
}

export type HeaderFitStage = 'fit' | 'compact' | 'folded'

export const headerFitStage = (
  regular: HeaderWidthMeasurement,
  compact: HeaderWidthMeasurement,
  tolerancePx: number,
): HeaderFitStage =>
  regular.scrollWidth - regular.clientWidth < tolerancePx
    ? 'fit'
    : compact.scrollWidth - compact.clientWidth < tolerancePx
      ? 'compact'
      : 'folded'
