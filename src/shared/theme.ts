export const THEME_CONFIG_KEY = 'kuma.theme'
export const THEME_MODES = ['dark', 'light', 'system'] as const
export type ThemeMode = typeof THEME_MODES[number]
export const THEME_MODE_LABEL = { dark: '深色', light: '浅色', system: '跟随系统' }
export const THEME_CHANNEL = 'kuma:theme'
export const THEME_GET_CHANNEL = 'kuma:theme-get'

export const normalizeThemeMode = (raw: unknown): ThemeMode =>
  raw === 'light' || raw === 'system' ? raw : 'dark'

export const resolveTheme = (mode: ThemeMode, systemPrefersDark: boolean): 'dark' | 'light' =>
  mode === 'system' ? (systemPrefersDark ? 'dark' : 'light') : mode

export const THEME_BASE_CONFIG_KEY = 'kuma.themeBase'
export const normalizeThemeBase = (raw: unknown): string =>
  typeof raw === 'string' && raw.length === 7 && /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : ''

export const DEFAULT_THEME_BASE = { dark: '#0d1318', light: '#f3f6f9' } as const
export const GROUND_ACCENT = { dark: '#4db8ff', light: '#1773b2' } as const
export type ThemeState = { mode: ThemeMode; base: string }
type Rgb = [number, number, number]

export const hexToRgb = (hex: string): Rgb =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb
export const rgbToHex = (rgb: Rgb): string =>
  '#' + rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')
export const relativeLuminance = (hex: string): number => {
  const [r, g, b] = hexToRgb(hex).map((c) =>
    c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4,
  )
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export const contrastRatio = (a: string, b: string): number => {
  const [x, y] = [relativeLuminance(a), relativeLuminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
export const mixHex = (a: string, b: string, t: number): string => {
  const end = hexToRgb(b)
  return rgbToHex(hexToRgb(a).map((c, i) => c + (end[i] - c) * t) as Rgb)
}

const GROUND_INK = { dark: '#e8eef4', light: '#1b2733' } as const
export const groundOf = (baseHex: string): 'dark' | 'light' =>
  contrastRatio(GROUND_INK.dark, baseHex) >= contrastRatio(GROUND_INK.light, baseHex) ? 'dark' : 'light'

export const NEUTRAL_TOKENS = [
  'bg0', 'bg1', 'bg2', 'bg3', 'line', 'line-soft', 'text', 'sub', 'dim', 'stat-track',
  'scrollbar-track', 'scrollbar-thumb', 'scrollbar-thumb-hover', 'scrollbar-thumb-active', 'accent-wash',
] as const

export const deriveNeutrals = (baseHex: string): Record<typeof NEUTRAL_TOKENS[number], string> => {
  const ground = groundOf(baseHex)
  const text = GROUND_INK[ground]
  const surface = (t: number) => mixHex(baseHex, text, t)
  const bg1 = surface(0.06)
  const fadedInk = (threshold: number): string => {
    // 从最大混合比倒着找，包含取整后仍达标的最后一档；无解时保留正文墨色。
    for (let percent = 100; percent >= 0; percent--) {
      const ink = mixHex(text, baseHex, percent / 100)
      if (contrastRatio(ink, bg1) >= threshold) return ink
    }
    return text
  }
  return {
    bg0: baseHex, bg1, bg2: surface(0.10), bg3: surface(0.14),
    line: surface(0.20), 'line-soft': surface(0.15), text,
    // 加深只作用于浅地；深地保留原阈值，避免自定义深底的文字跟着变化。
    sub: fadedInk(ground === 'light' ? 8.0 : 6), dim: fadedInk(ground === 'light' ? 6.0 : 4.5), 'stat-track': surface(0.12),
    'scrollbar-track': surface(0.04), 'scrollbar-thumb': surface(0.30),
    'scrollbar-thumb-hover': surface(0.40), 'scrollbar-thumb-active': surface(0.50),
    'accent-wash': mixHex(GROUND_ACCENT[ground], baseHex, 0.75),
  }
}

export const resolveThemeGround = ({ mode, base, systemPrefersDark }: ThemeState & {
  systemPrefersDark: boolean
}): 'dark' | 'light' => base ? groundOf(base) : resolveTheme(mode, systemPrefersDark)
