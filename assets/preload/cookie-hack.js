// Adapted from poi (https://github.com/poooi/poi) assets/js/cookie-hack.js
// MIT License, Copyright (c) poi contributors — 移植与改造：艦素 kanso 项目。
// ISOLATED WORLD
// Cookie/UA/重定向处理需要 @electron/remote + config，跑在 preload 隔离世界。
// document.cookie、location 与 cookie 本身跨世界共享，在这里改照样影响页面。
const remote = require('@electron/remote')

const config = remote.require('./config')

document.addEventListener('DOMContentLoaded', () => {
  if (config.get('kanso.dmmcookie', true) && location.hostname.includes('dmm')) {
    const now = new Date()
    now.setFullYear(now.getFullYear() + 1)
    const expires = now.toUTCString()
    document.cookie = `cklg=welcome;expires=${expires};domain=.dmm.com;path=/`
    document.cookie = `cklg=welcome;expires=${expires};domain=.dmm.com;path=/netgame/`
    document.cookie = `cklg=welcome;expires=${expires};domain=.dmm.com;path=/netgame_s/`
    document.cookie = `ckcy=1;expires=${expires};domain=osapi.dmm.com;path=/`
    document.cookie = `ckcy=1;expires=${expires};domain=203.104.209.7;path=/`
    document.cookie = `ckcy=1;expires=${expires};domain=www.dmm.com;path=/netgame/`
    document.cookie = `ckcy=1;expires=${expires};domain=log-netgame.dmm.com;path=/`
    document.cookie = `ckcy=1;expires=${expires};domain=.dmm.com;path=/`
    document.cookie = `ckcy=1;expires=${expires};domain=.dmm.com;path=/netgame/`
    document.cookie = `ckcy=1;expires=${expires};domain=.dmm.com;path=/netgame_s/`
    document.cookie = `ckcy_remedied_check=ec_mrnhbtk;expires=${expires};domain=osapi.dmm.com;path=/`
    document.cookie = `ckcy_remedied_check=ec_mrnhbtk;expires=${expires};domain=203.104.209.7;path=/`
    document.cookie = `ckcy_remedied_check=ec_mrnhbtk;expires=${expires};domain=www.dmm.com;path=/netgame/`
    document.cookie = `ckcy_remedied_check=ec_mrnhbtk;expires=${expires};domain=log-netgame.dmm.com;path=/`
    document.cookie = `ckcy_remedied_check=ec_mrnhbtk;expires=${expires};domain=.dmm.com;path=/`
    document.cookie = `ckcy_remedied_check=ec_mrnhbtk;expires=${expires};domain=.dmm.com;path=/netgame/`
    document.cookie = `ckcy_remedied_check=ec_mrnhbtk;expires=${expires};domain=.dmm.com;path=/netgame_s/`

    const ua = remote.getCurrentWebContents().session.getUserAgent()
    remote.getCurrentWebContents().session.setUserAgent(ua, 'ja-JP')

    // 首次访问被丢到 /foreign/ 页面时拉回游戏首页
    if (location.href.includes('/foreign/')) {
      location.href = config.getDefault('kanso.homepage')
    }
  }
})

// MAIN WORLD
// 覆写页面的 confirm/document.write/DMM 全局量必须在页面主世界做。
// 经 contextBridge.executeInMainWorld 序列化；保持自包含，
// 只引用全局量与 window.kansoPreloadBridge。
function installPageHooks() {
  const bridge = window.kansoPreloadBridge

  document.addEventListener('DOMContentLoaded', () => {
    if (bridge.isNetworkAlertDisabled()) {
      window.confirmBackup = window.confirm
      window.confirm = () => {}
      if (window.DMM?.netgame?.reloadDialog) {
        window.DMM.netgame.reloadDialog = () => {}
      }
    }
  })

  // 只在配置的游戏主机（由 homepage 推导）上拦 document.write，
  // 避免硬编码 URL 在 DMM 改地址时悄悄失效
  const homepageHost = bridge.getHomepageHost()
  if (homepageHost && location.host === homepageHost) {
    const _documentWrite = document.write
    document.write = function () {
      if (document.readyState === 'interactive' || document.readyState === 'complete') {
        console.warn(
          `Block document.write since document is at state "${document.readyState}". Blocked call:`,
          arguments,
        )
      } else {
        _documentWrite.apply(this, arguments)
      }
    }
  }
}

module.exports = { installPageHooks }
