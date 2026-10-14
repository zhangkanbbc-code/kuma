const { MOD_NIGHT_DEFAULT } = require('./kcs-resource-path')
const MOD_NIGHT_SETTINGS_CHANNEL = 'kuma:mod-night-settings'

const modNightSettingsPayload = (read) => ({
  enabled: read('kuma.mod.night.enabled', MOD_NIGHT_DEFAULT.enabled),
  start: read('kuma.mod.night.start', MOD_NIGHT_DEFAULT.start),
  end: read('kuma.mod.night.end', MOD_NIGHT_DEFAULT.end),
})

// 装载时读一次，之后逐帧推送；图片查找只读隔离世界内存。
const createModNightSettingsBridge = ({ initial, ipc }) => {
  let cached = initial
  ipc.on(MOD_NIGHT_SETTINGS_CHANNEL, (_event, payload) => {
    cached = payload
  })
  return { get: () => cached }
}

module.exports = { MOD_NIGHT_SETTINGS_CHANNEL, modNightSettingsPayload, createModNightSettingsBridge }
