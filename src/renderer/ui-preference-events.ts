// UI 偏好的跨窗失效总线：通知只带键，订阅者回读主进程当前值。
import { UI_PREFERENCE_CHANNEL } from '../shared/ui-preference'
import { safeEach } from './crash-guard'
const { ipcRenderer } = require('electron')

const listeners = new Map<string, (() => void)[]>()
export const subscribeUiPreference = (key: string, cb: () => void): (() => void) => {
  const list = listeners.get(key) ?? []
  list.push(cb)
  listeners.set(key, list)
  return () => { list.splice(list.indexOf(cb), 1) }
}
ipcRenderer.on(UI_PREFERENCE_CHANNEL, (_event: unknown, key: string) => {
  // 排队中的旧通知也回读当前值，不会把缓存倒回旧版本。
  safeEach('kernel:ui-preference', listeners.get(key) ?? [], (cb) => cb())
})
