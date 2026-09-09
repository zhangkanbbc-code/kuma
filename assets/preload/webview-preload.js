// Adapted from poi (https://github.com/poooi/poi) assets/js/webview-preload.js
// MIT License, Copyright (c) poi contributors — 移植与改造：kuma 项目。
// 游戏 webview 的 preload。contextIsolation: true——本文件跑在隔离世界
// （保有 Node / @electron/remote 权限），页面侧 hack 经
// contextBridge.executeInMainWorld 推进页面主世界。两个世界之间靠下面
// 暴露的 kumaPreloadBridge 通信。
const remote = require('@electron/remote')
const { contextBridge, ipcRenderer } = require('electron')

const config = remote.require('./config')

// 判据直接从共享层拿（就在本进程里 require，不走 remote）：游戏页面网址是玩家可配的，
// 「哪一条真会被加载」只能有一份说法，渲染层装 webview 用的也是这一个函数。
const { GAME_URL_CONFIG_KEY, normalizeGameUrl } = require('../../dist/shared/game-url')
const { readEnv } = require('../../dist/shared/env-names')

const { installCapturePage } = require('./capture-page')
// require cookie-hack 的同时也装上了隔离世界侧的 cookie/UA/重定向处理
const { installPageHooks } = require('./cookie-hack')
const { installDisableTab } = require('./disable-tab')
const { installPageAlign } = require('./page-align')
const { GAME_AUDIO_POLICY, installGameAudioControl } = require('./game-audio')
const { GAME_AUDIO_SETTINGS_CHANNEL, createGameAudioSettingsBridge } = require('./game-audio-settings-bridge')
const { duckedVolume, installPreviewDuck } = require('./preview-duck')
const { createResourceResolver, installResourceHack } = require('./resource-hack')
const { installVoiceArchive } = require('./voice-archive')
const { installArtArchive } = require('./art-archive')
const { installAssetArchive } = require('./asset-archive')
const { installBgmArchive } = require('./bgm-archive')
const { installXhrHack } = require('./xhr-hack')

// 这个 bridge 对（不可信的）游戏页面上任何脚本都可达，交给广播器前必须校验输入。
// 这把攻击面收敛到「游戏形状的流量」；无法完全阻止页面内恶意脚本伪造像样的 API
// 事件（正版游戏发的就是同样的调用）。下游消费者还会再过滤 /kcsapi 并要求合法 JSON。
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'PATCH', 'OPTIONS'])
const isAllowedMethod = (method) =>
  typeof method === 'string' && ALLOWED_METHODS.has(method.toUpperCase())
// 同时覆盖 /kcsapi/* 与游戏启动标记 /kcs2/js/main.js
const isGamePath = (pathname) => typeof pathname === 'string' && pathname.startsWith('/kcs')

// kuma这边在试听（BGM ♪ 或语音）时把游戏声音压到 0，试听一停就恢复。
// 纯内存态：主进程也不落盘，重启天然就是「不压」。
const previewDuckFactor = installPreviewDuck(ipcRenderer)

// 装载时只取一份原始值，此后的设置变化由主进程逐帧推送；轮询不再走同步 IPC。
const gameAudioSettingsBridge = createGameAudioSettingsBridge({
  initial: {
    volume: config.get('kuma.gameAudio.volume', 1),
    voiceVolume: config.get('kuma.gameAudio.voiceVolume', 1),
    bgmVolume: config.get('kuma.gameAudio.bgmVolume', 1),
    mode: config.get('kuma.gameAudio.mode', 'all'),
  },
  ipc: ipcRenderer,
  channel: GAME_AUDIO_SETTINGS_CHANNEL,
})

// 隔离世界与游戏主世界共用主线程，longtask 补上游戏页的整段占用。
// 2026-09-07 实测各帧上报的时长与时刻完全相同，属于同一主线程；
// 顶层归因已能指出 iframe#htmlWrap，因此只由顶层上报一次。
// 若将来游戏 iframe 被隔离到别的进程，顶层观测不到它，届时再改。
let isTopFrame = false
try {
  isTopFrame = window.top === window
} catch {
  // 无法访问 top 时按非顶层处理，不安装观测器。
  isTopFrame = false
}
const configuredLongTaskMs = Number(readEnv('KUMA_PERF_LONGTASK_MS'))
const LONGTASK_MS =
  Number.isFinite(configuredLongTaskMs) && configuredLongTaskMs > 0
    ? configuredLongTaskMs
    : 50
if (isTopFrame) {
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration < LONGTASK_MS) continue
        const attribution = entry.attribution
          .map((item) => {
            const container = `${item.containerType}${item.containerId ? `#${item.containerId}` : ''}`
            let containerPath = ''
            if (item.containerSrc) {
              try {
                containerPath = new URL(item.containerSrc).pathname
              } catch {
                // 空或无法解析的地址不写入归因，避免原始地址中的凭据落盘。
                containerPath = ''
              }
            }
            return [container, item.containerName, containerPath, item.name]
              .filter(Boolean)
              .join(' · ')
          })
          .filter(Boolean)
          .join(' / ')
        const detail = `${attribution} @ ${location.pathname}`
        ipcRenderer.send('kuma:perf', { source: 'game', scope: 'longtask', ms: entry.duration, detail })
      }
    }).observe({ entryTypes: ['longtask'] })
  } catch {
    // entryType 不受支持时 observe 会抛；不能让 preload 求值失败、打断后续钩子安装。
  }
}

// 桥进页面主世界的特权 API。所有 Node / @electron/remote 权限留在隔离世界，
// 主世界的 hack 只能经由它回调。
// 抓包三连改走异步 IPC（同一 channel 保序）。以前经 @electron/remote 同步调主进程：
// 游戏的 XHR loadend 要等整条记账链跑完，回港大包一到游戏就卡一下。
// 主进程侧（game-api-broadcaster 的 ipcMain 接线）还有第二道同样的校验。
contextBridge.exposeInMainWorld('kumaPreloadBridge', {
  sendRequest: (method, pathname, responseURL, request) => {
    if (!isAllowedMethod(method) || !isGamePath(pathname) || typeof responseURL !== 'string') {
      return
    }
    ipcRenderer.send('kuma:game-api', 'request', { method, pathname, responseURL, request })
  },
  sendResponse: (method, pathname, responseURL, request, response, responseType, status) => {
    if (!isAllowedMethod(method) || !isGamePath(pathname) || typeof responseURL !== 'string') {
      return
    }
    ipcRenderer.send('kuma:game-api', 'response', {
      method,
      pathname,
      responseURL,
      request,
      response,
      responseType,
      status,
    })
  },
  sendError: (pathname, responseURL, status) => {
    if (typeof responseURL !== 'string') {
      return
    }
    ipcRenderer.send('kuma:game-api', 'error', { pathname, responseURL, status })
  },
  resolveHackedResource: createResourceResolver(remote),
  isNetworkAlertDisabled: () => config.get('kuma.disablenetworkalert', false),
  getHomepageHost: () => {
    // normalizeGameUrl 已经把「配置里那条认不出」归到默认上，所以这里拿到的
    // 一定是渲染层真正加载的那一条——玩家把网址写坏时，主世界那道
    // document.write 拦截不会跟着一起失效。
    try {
      return new URL(normalizeGameUrl(config.get(GAME_URL_CONFIG_KEY))).host
    } catch (_e) {
      return ''
    }
  },
  getGameAudioSettings: () => {
    const { volume, voiceVolume, bgmVolume, mode } = gameAudioSettingsBridge.get()
    const rawVolume = Number(volume)
    const rawVoiceVolume = Number(voiceVolume)
    const rawBgmVolume = Number(bgmVolume)
    return {
      // 总音量额外乘一枚试听系数：试听在响时是 0，其余时候是 1。
      // 乘在这里而不是改钥里的值——它一秒后就要恢复，绝不该落盘。
      volume: duckedVolume(
        Number.isFinite(rawVolume) ? Math.max(0, Math.min(1, rawVolume)) : 1,
        previewDuckFactor(),
      ),
      voiceVolume: Number.isFinite(rawVoiceVolume)
        ? Math.max(0, Math.min(2, rawVoiceVolume))
        : 1,
      bgmVolume: Number.isFinite(rawBgmVolume)
        ? Math.max(0, Math.min(2, rawBgmVolume))
        : 1,
      mode: mode === 'voice' || mode === 'bgm' ? mode : 'all',
    }
  },
})

// 「听过即存」的取字节侧留在**隔离世界**：它拿着 ipcRenderer，不该进主世界；
// 而 only-if-cached 要的 same-origin 两个世界共用同一个安全源，隔离世界够用。
installVoiceArchive()
installArtArchive()
installAssetArchive()
installBgmArchive()

// 往页面主世界装 hack。executeInMainWorld 是实验特性，失败只记日志，
// 不允许中断 preload 其余部分。
const installInMainWorld = (name, func, args = []) => {
  try {
    contextBridge.executeInMainWorld({ func, args })
  } catch (e) {
    console.error(`[kuma] failed to install ${name} in the game page's main world`, e)
  }
}

// XHR hack 最先装，保证游戏自身请求从 document-start 就被截获
installInMainWorld('xhr-hack', installXhrHack)
installInMainWorld('resource-hack', installResourceHack)
installInMainWorld('page-align', installPageAlign)
installInMainWorld('capture-page', installCapturePage)
installInMainWorld('disable-tab', installDisableTab)
installInMainWorld('page-hooks', installPageHooks)
installInMainWorld('game-audio', installGameAudioControl, [GAME_AUDIO_POLICY])
