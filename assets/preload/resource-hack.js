// Adapted from poi (https://github.com/poooi/poi) assets/js/resource-hack.js
// MIT License, Copyright (c) poi contributors — 移植与改造：艦素 kanso 项目。
// ISOLATED WORLD
// 构建页面侧图片/登录脚本 hack 用的特权解析器：本地存在魔改或缓存文件时返回
// kanso-cache:// URL（由主进程 kcs-resource.ts 供出），否则 undefined 走原网络请求。
const createResourceResolver = (remote) => {
  const { createResourceLookup } = require('./kcs-resource-path')
  const config = remote.require('./config')
  // 路径只在 preload 初始化时读一次。放进每张图的 src setter 会变成
  // 同步 IPC（@electron/remote）——进战斗一次性加载卡面/罗盘/战斗图时，
  // 卡的是游戏 webview 自己的线程，艦素 UI 还在动。
  const cacheDir = config.get('kanso.cache.path', remote.getGlobal('DEFAULT_CACHE_PATH'))
  return createResourceLookup(cacheDir)
}

// MAIN WORLD
// 经 contextBridge.executeInMainWorld 序列化进页面主世界。
// 必须自包含：只引用全局量与 window.kansoPreloadBridge。
function installResourceHack() {
  const bridge = window.kansoPreloadBridge

  // 保留 hack 函数：子 iframe preload 失效时由父窗口补装
  window.hackResource = (win = window) => {
    if (win.resourceHacked) {
      return false
    }

    // 图片 hack。魔改立绘会画上游戏的 WebGL canvas，必须以 CORS 干净的方式加载，
    // 否则纹理被污染（texImage2D 直接抛错）。kanso-cache:// 响应带
    // Access-Control-Allow-Origin: *，配合这里的 crossOrigin = 'anonymous'，
    // 跨源图片对 WebGL 就是安全的。只动魔改图，同源网络图原样加载。
    const OriginalImage = win.Image
    win.Image = class HackedImage extends OriginalImage {
      constructor(...props) {
        super(...props)
      }

      get src() {
        return super.src
      }

      set src(imgSrc) {
        if (imgSrc) {
          const absoluteUrl = new URL(imgSrc, win.location.href).href
          const hackedUrl = bridge.resolveHackedResource(absoluteUrl)
          if (hackedUrl) {
            super.crossOrigin = 'anonymous'
            super.src = hackedUrl
            return
          }
        }
        super.src = imgSrc
      }
    }

    // 脚本加载失败兜底。主进程侧对 script 只主动供 .hack.* 覆盖
    // （陈旧的普通缓存脚本会炸版本钉死的 gadget 登录），普通缓存只在
    // /kcs* 脚本网络加载真失败时用作恢复。资源 error 事件不冒泡，
    // 必须在捕获阶段监听。resolveHackedResource 只在本地文件存在时
    // 返回 kanso-cache:// URL（魔改或普通缓存皆可）。
    win.addEventListener(
      'error',
      (e) => {
        const el = e.target
        if (el && el.tagName === 'SCRIPT' && el.src && !el.dataset.kansoResourceRetried) {
          const hackedUrl = bridge.resolveHackedResource(el.src, true)
          if (hackedUrl) {
            const script = win.document.createElement('script')
            script.src = hackedUrl
            script.dataset.kansoResourceRetried = '1'
            if (el.parentNode) {
              el.parentNode.insertBefore(script, el.nextSibling)
            } else {
              win.document.body.appendChild(script)
            }
          }
        }
      },
      true,
    )

    // 登录脚本 hack
    const onError = (e) => {
      if (e.message.includes('kcsLogin_StartLogin')) {
        win.removeEventListener('error', onError)
        let scriptReloaded = false
        win.document.querySelectorAll('script').forEach((element) => {
          const absoluteUrl = new URL(element.src, win.location.href).href
          const hackedUrl = bridge.resolveHackedResource(absoluteUrl, true)
          if (hackedUrl) {
            const script = win.document.createElement('script')
            script.type = 'text/javascript'
            script.src = hackedUrl
            win.document.body.appendChild(script)
            scriptReloaded = true
          }
        })
        if (scriptReloaded) {
          let attempts = 0
          const interval = setInterval(() => {
            if (win.gadgets && win.kcsLogin_StartLogin) {
              win.gadgets.util.registerOnLoadHandler(win.kcsLogin_StartLogin)
              win.gadgets.util.runOnLoadHandlers()
              clearInterval(interval)
            } else if (++attempts >= 20) {
              clearInterval(interval)
            }
          }, 500)
        }
      }
    }
    win.addEventListener('error', onError)

    win.resourceHacked = true

    return true
  }

  window.hackResource()
}

module.exports = { createResourceResolver, installResourceHack }
