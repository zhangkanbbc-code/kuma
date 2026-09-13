import {
  normalizeThemeMode, normalizeThemeBase, resolveThemeGround, deriveNeutrals,
  DEFAULT_THEME_BASE, NEUTRAL_TOKENS, THEME_CHANNEL, THEME_CONFIG_KEY, THEME_BASE_CONFIG_KEY,
  type ThemeState,
} from '../shared/theme'

declare global {
  interface Window {
    kumaTheme?: {
      get: () => Promise<unknown>
      onChange: (listener: (state: unknown) => void) => void
    }
  }
}

let currentState: ThemeState = { mode: 'dark', base: '' }
let media: MediaQueryList | undefined
const refresh = () => {
  const ground = resolveThemeGround({ ...currentState, systemPrefersDark: media!.matches })
  document.documentElement.dataset.theme = ground
  const neutrals = currentState.base && currentState.base !== DEFAULT_THEME_BASE[ground]
    ? deriveNeutrals(currentState.base) : undefined
  for (const key of NEUTRAL_TOKENS) {
    if (neutrals) document.documentElement.style.setProperty('--' + key, neutrals[key])
    else document.documentElement.style.removeProperty('--' + key)
  }
}

export const applyTheme = (raw: unknown): void => {
  const state = raw as ThemeState | undefined
  const mode = normalizeThemeMode(state?.mode)
  const base = normalizeThemeBase(state?.base)
  media ??= matchMedia('(prefers-color-scheme: dark)')
  if (currentState.mode === 'system' && mode !== 'system') media.removeEventListener('change', refresh)
  if (currentState.mode !== 'system' && mode === 'system') media.addEventListener('change', refresh)
  currentState = { mode, base }
  refresh()
}

export const applyThemeMode = (mode: unknown): void => {
  applyTheme({ ...currentState, mode })
}

export const installThemeBoot = (): void => {
  if (window.kumaTheme) {
    // 浏览窗没有 Node；首次异步取值期间隐藏内容，避免先画出深色控件。
    document.documentElement.style.visibility = 'hidden'
    let changed = false
    window.kumaTheme.onChange((state) => {
      changed = true
      applyTheme(state)
    })
    void window.kumaTheme.get().then((state) => {
      // 初值返回之前若已有推送，以较新的推送为准。
      if (!changed) applyTheme(state)
      document.documentElement.style.removeProperty('visibility')
    })
    return
  }
  const remote = require('@electron/remote')
  const config = remote.require('./config')
  const { ipcRenderer } = require('electron')
  applyTheme({ mode: config.get(THEME_CONFIG_KEY, 'dark'), base: config.get(THEME_BASE_CONFIG_KEY, '') })
  ipcRenderer.on(THEME_CHANNEL, (_event: unknown, state: unknown) => applyTheme(state))
}

export const setThemeMode = (mode: unknown): void => {
  const config = require('@electron/remote').require('./config')
  const normalized = normalizeThemeMode(mode)
  config.set(THEME_CONFIG_KEY, normalized)
  applyThemeMode(normalized)
}

export const setThemeBase = (hex: unknown): void => {
  const config = require('@electron/remote').require('./config')
  const base = normalizeThemeBase(hex)
  config.set(THEME_BASE_CONFIG_KEY, base)
  applyTheme({ ...currentState, base })
}

export const clearThemeBase = (): void => setThemeBase('')
