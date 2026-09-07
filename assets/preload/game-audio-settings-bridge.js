// 缓存留在 preload 隔离世界；游戏的每拍轮询只读内存，不再同步问主进程。
const GAME_AUDIO_SETTINGS_CHANNEL = 'kuma:game-audio-settings'

const createGameAudioSettingsBridge = ({ initial, ipc, channel }) => {
  let cached = initial
  ipc.on(channel, (_event, payload) => {
    if (payload === null || typeof payload !== 'object') return
    cached = payload
  })
  return { get: () => cached }
}

module.exports = { GAME_AUDIO_SETTINGS_CHANNEL, createGameAudioSettingsBridge }
