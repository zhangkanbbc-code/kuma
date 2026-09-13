import { contextBridge, ipcRenderer } from 'electron'
import { THEME_CHANNEL, THEME_GET_CHANNEL } from '../shared/theme'

// 只给浏览窗外壳读主题与收推送，不开放任意 IPC 或配置写入。
contextBridge.exposeInMainWorld('kumaTheme', {
  get: () => ipcRenderer.invoke(THEME_GET_CHANNEL),
  onChange: (listener: (state: unknown) => void) => {
    ipcRenderer.on(THEME_CHANNEL, (_event, state: unknown) => listener(state))
  },
})
