import { BrowserWindow, ipcMain, nativeTheme } from 'electron'
import config from './config'
import {
  normalizeThemeMode, normalizeThemeBase, resolveThemeGround, DEFAULT_THEME_BASE,
  THEME_CHANNEL, THEME_CONFIG_KEY, THEME_BASE_CONFIG_KEY, THEME_GET_CHANNEL,
} from '../shared/theme'

const readTheme = () => ({
  mode: normalizeThemeMode(config.get(THEME_CONFIG_KEY, 'dark')),
  base: normalizeThemeBase(config.get(THEME_BASE_CONFIG_KEY, '')),
})

export const themeBackgroundColor = (state = readTheme()): string =>
  state.base || DEFAULT_THEME_BASE[resolveThemeGround({
    ...state, systemPrefersDark: nativeTheme.shouldUseDarkColors,
  })]

export const installThemePush = (): void => {
  ipcMain.handle(THEME_GET_CHANNEL, readTheme)
  const push = () => {
    const state = readTheme()
    const bg0 = themeBackgroundColor(state)
    for (const win of BrowserWindow.getAllWindows()) {
      win.setBackgroundColor(bg0)
      win.webContents.send(THEME_CHANNEL, state)
    }
  }
  config.on('config.set', (path: string) => {
    if (path === THEME_CONFIG_KEY || path === THEME_BASE_CONFIG_KEY) push()
  })
  nativeTheme.on('updated', () => {
    if (readTheme().mode === 'system') push()
  })
}
