// 试听期间压住游戏声音的那一枚系数。
//
// 链路：渲染层任一试听真的在响 → 主进程 → 这里（游戏 webview 的隔离世界）。
// 收到之后 `getGameAudioSettings()` 返回的总音量就乘上它，game-audio 的 250ms
// 轮询会把新增益铺到所有活着的声源上——所以最慢 250ms 内游戏就哑了，
// 这点延迟是已知代价，换来的是 game-audio 本体一个字节都不用动。
//
// 单独成文件是为了能被测试直接 require：webview-preload 顶上就要
// @electron/remote，在普通 node 里 require 不动。
const PREVIEW_DUCK_CHANNEL = 'kanso:preview-audio-duck'

/**
 * 装上收货口，返回「现在的系数」。
 *
 * 只认 `true` 为「正在试听」：主进程发来别的什么（旧版本、被改过的调用方）
 * 一律当作不压——**卡住不恢复**比慢半拍恢复难受得多。
 */
const installPreviewDuck = (ipc) => {
  let factor = 1
  ipc.on(PREVIEW_DUCK_CHANNEL, (_event, active) => {
    factor = active === true ? 0 : 1
  })
  return () => factor
}

/** 总音量乘上系数，仍旧钳在 [0, 1]（乘完不该越界，钳一道是防呆） */
const duckedVolume = (volume, factor) => {
  const base = Number.isFinite(volume) ? volume : 1
  const scale = Number.isFinite(factor) ? factor : 1
  return Math.max(0, Math.min(1, base * scale))
}

module.exports = {
  PREVIEW_DUCK_CHANNEL,
  duckedVolume,
  installPreviewDuck,
}
