// Adapted from poi (https://github.com/poooi/poi) assets/js/webview-preload.js
// MIT License, Copyright (c) poi contributors — 移植与改造：艦素 kanso 项目。
// 游戏 webview 的 preload。contextIsolation: true——本文件跑在隔离世界
// （保有 Node / @electron/remote 权限），页面侧 hack 经
// contextBridge.executeInMainWorld 推进页面主世界。两个世界之间靠下面
// 暴露的 kansoPreloadBridge 通信。
const remote = require('@electron/remote')
const { contextBridge, ipcRenderer } = require('electron')

const config = remote.require('./config')

const { installCapturePage } = require('./capture-page')
// require cookie-hack 的同时也装上了隔离世界侧的 cookie/UA/重定向处理
const { installPageHooks } = require('./cookie-hack')
const { installDisableTab } = require('./disable-tab')
const { installPageAlign } = require('./page-align')
const { GAME_AUDIO_POLICY, installGameAudioControl } = require('./game-audio')
const { duckedVolume, installPreviewDuck } = require('./preview-duck')
const { createResourceResolver, installResourceHack } = require('./resource-hack')
const { installVoiceArchive } = require('./voice-archive')
const { installArtArchive } = require('./art-archive')
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

// 艦素这边在试听（BGM ♪ 或语音）时把游戏声音压到 0，试听一停就恢复。
// 纯内存态：主进程也不落盘，重启天然就是「不压」。
const previewDuckFactor = installPreviewDuck(ipcRenderer)

// 桥进页面主世界的特权 API。所有 Node / @electron/remote 权限留在隔离世界，
// 主世界的 hack 只能经由它回调。
// 抓包三连改走异步 IPC（同一 channel 保序）。以前经 @electron/remote 同步调主进程：
// 游戏的 XHR loadend 要等整条记账链跑完，回港大包一到游戏就卡一下。
// 主进程侧（game-api-broadcaster 的 ipcMain 接线）还有第二道同样的校验。
contextBridge.exposeInMainWorld('kansoPreloadBridge', {
  sendRequest: (method, pathname, responseURL, request) => {
    if (!isAllowedMethod(method) || !isGamePath(pathname) || typeof responseURL !== 'string') {
      return
    }
    ipcRenderer.send('kanso:game-api', 'request', { method, pathname, responseURL, request })
  },
  sendResponse: (method, pathname, responseURL, request, response, responseType, status) => {
    if (!isAllowedMethod(method) || !isGamePath(pathname) || typeof responseURL !== 'string') {
      return
    }
    ipcRenderer.send('kanso:game-api', 'response', {
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
    ipcRenderer.send('kanso:game-api', 'error', { pathname, responseURL, status })
  },
  resolveHackedResource: createResourceResolver(remote),
  isNetworkAlertDisabled: () => config.get('kanso.disablenetworkalert', false),
  getHomepageHost: () => {
    try {
      return new URL(config.get('kanso.homepage', config.getDefault('kanso.homepage'))).host
    } catch (_e) {
      return ''
    }
  },
  getGameAudioSettings: () => {
    const rawVolume = Number(config.get('kanso.gameAudio.volume', 1))
    const rawVoiceVolume = Number(config.get('kanso.gameAudio.voiceVolume', 1))
    const rawBgmVolume = Number(config.get('kanso.gameAudio.bgmVolume', 1))
    const mode = config.get('kanso.gameAudio.mode', 'all')
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
installBgmArchive()

// 往页面主世界装 hack。executeInMainWorld 是实验特性，失败只记日志，
// 不允许中断 preload 其余部分。
const installInMainWorld = (name, func, args = []) => {
  try {
    contextBridge.executeInMainWorld({ func, args })
  } catch (e) {
    console.error(`[kanso] failed to install ${name} in the game page's main world`, e)
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
