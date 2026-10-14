import type { WebContents } from 'electron'
import type { EventEmitter } from 'events'

const { MOD_NIGHT_SETTINGS_CHANNEL, modNightSettingsPayload } =
  require('../../assets/preload/mod-night-settings-bridge')

type ReadSetting = (key: string, fallback: unknown) => unknown

export const installModNightPush = ({ config, gameWebContents }: {
  config: Pick<EventEmitter, 'on'> & { get: ReadSetting }
  gameWebContents: () => WebContents | null | undefined
}) => {
  const push = () => {
    const game = gameWebContents()
    if (!game || game.isDestroyed()) return
    const payload = modNightSettingsPayload((key: string, fallback: unknown) => config.get(key, fallback))
    // 与音量推送相同：子帧各有自己的 preload 缓存，逐帧通知。
    for (const frame of game.mainFrame.framesInSubtree) {
      try {
        frame.send(MOD_NIGHT_SETTINGS_CHANNEL, payload)
      } catch {
        // 这一帧刚导航走/已销毁，继续通知其余帧。
      }
    }
  }
  config.on('config.set', (path: string) => {
    if (path.startsWith('kuma.mod.night.')) push()
  })
  config.on('config.restore', push)
}
