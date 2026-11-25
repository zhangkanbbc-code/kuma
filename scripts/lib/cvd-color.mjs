import { hexToRgb, rgbToHex, contrastRatio } from '../../src/shared/theme.ts'

const clamp = (x) => Math.max(0, Math.min(1, x))
const linear = (byte) => {
  const x = byte / 255
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
}
const srgb = (x) => 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)

export function toLab(hex) {
  const [r, g, b] = hexToRgb(hex).map(linear)
  const l = Math.cbrt(0.4122214708*r + 0.5363325363*g + 0.0514459929*b)
  const m = Math.cbrt(0.2119034982*r + 0.6806995451*g + 0.1073969566*b)
  const s = Math.cbrt(0.0883024619*r + 0.2817188376*g + 0.6299787005*b)
  return [
    0.2104542553*l + 0.793617785*m - 0.0040720468*s,
    1.9779984951*l - 2.4285922050*m + 0.4505937099*s,
    0.0259040371*l + 0.7827717662*m - 0.8086757660*s,
  ]
}

function toLinearRgb(L, a, b) {
  const l = (L + 0.3963377774*a + 0.2158037573*b) ** 3
  const m = (L - 0.1055613458*a - 0.0638541728*b) ** 3
  const s = (L - 0.0894841775*a - 1.291485548*b) ** 3
  return [
    4.0767416621*l - 3.3077115913*m + 0.2309699292*s,
    -1.2684380046*l + 2.6097574011*m - 0.3413193965*s,
    -0.0041960863*l - 0.7034186147*m + 1.707614701*s,
  ]
}

// 固定明度与色相，只收缩超出 sRGB 的色度。
function inGamut(L, a, b) {
  let scale = 1, low = 0, high = 1
  for (let step = 0; step < 14; step++) {
    const channels = toLinearRgb(L, a * scale, b * scale)
    if (channels.every(x => x >= 0 && x <= 1)) {
      if (scale === 1) return rgbToHex(channels.map(srgb))
      low = scale
    } else high = scale
    scale = (low + high) / 2
  }
  return rgbToHex(toLinearRgb(L, a * low, b * low).map(x => srgb(clamp(x))))
}

export function fitContrast([lightness, a, b], source, background, ground) {
  const L = clamp(lightness)
  const minimum = Math.min(4.5, contrastRatio(source, background))
  const initial = inGamut(L, a, b)
  if (contrastRatio(initial, background) >= minimum) return initial

  // 用最终量化后的颜色检查。向本地色的高对比端找最近的合格明度。
  let fail = L, pass = ground === 'dark' ? 1 : 0
  for (let step = 0; step < 16; step++) {
    const mid = (fail + pass) / 2
    if (contrastRatio(inGamut(mid, a, b), background) >= minimum) pass = mid
    else fail = mid
  }
  return inGamut(pass, a, b)
}
