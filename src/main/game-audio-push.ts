import type { WebContents } from 'electron'
import type { EventEmitter } from 'events'

// 主进程逐文件编译到 dist/main，和源码到 assets 的相对路径相同。
const { GAME_AUDIO_SETTINGS_CHANNEL } = require('../../assets/preload/game-audio-settings-bridge')

type ReadSetting = (key: string, fallback: unknown) => unknown

export const gameAudioSettingsPayload = (read: ReadSetting) => ({
  volume: read('kuma.gameAudio.volume', 1),
  voiceVolume: read('kuma.gameAudio.voiceVolume', 1),
  bgmVolume: read('kuma.gameAudio.bgmVolume', 1),
  mode: read('kuma.gameAudio.mode', 'all'),
})

export const installGameAudioPush = ({ config, gameWebContents }: {
  config: Pick<EventEmitter, 'on'> & { get: ReadSetting }
  gameWebContents: () => WebContents | null | undefined
}) => {
  const push = () => {
    const game = gameWebContents()
    if (!game || game.isDestroyed()) return
    const payload = gameAudioSettingsPayload((key, fallback) => config.get(key, fallback))
    // webContents.send 只到主帧；子帧也装了 preload，必须逐帧送到各自的缓存。
    for (const frame of game.mainFrame.framesInSubtree) {
      try {
        frame.send(GAME_AUDIO_SETTINGS_CHANNEL, payload)
      } catch {
        // 这一帧刚导航走/已销毁，继续通知其余帧。
      }
    }
  }
  config.on('config.set', (path: string) => {
    if (path.startsWith('kuma.gameAudio.')) push()
  })
  config.on('config.restore', push)
}
