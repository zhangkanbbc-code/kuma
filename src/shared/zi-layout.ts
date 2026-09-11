// 沿用资源面板原有的窄态分界：不足 700px 时堆叠。
const ZI_NARROW_WIDTH = 700
// 宽态下八格排一行：1200px ≈ 每格 150px 的宽度下限。
const ZI_WIDE_WIDTH = 1200

export function ziLayoutClass(width: number): 'narrow' | 'wide' | '' {
  if (width < ZI_NARROW_WIDTH) return 'narrow'
  if (width >= ZI_WIDE_WIDTH) return 'wide'
  return ''
}
