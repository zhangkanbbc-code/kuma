// Adapted from poi (https://github.com/poooi/poi) lib/webcontent-utils.ts
// MIT License, Copyright (c) poi contributors — 移植与改造：艦素 kanso 项目
// （M0 略去插件窗口部分，铆模块实装时再补）。
import { shell, webContents, webFrameMain } from 'electron'

export function stopFileNavigate(id: number) {
  webContents.fromId(id)?.addListener('will-navigate', (e, url) => {
    if (url.startsWith('file')) {
      e.preventDefault()
    }
  })
}

// 嵌套 iframe（尤其是深层的）偶发不执行 preload 脚本，是 Electron 老坑：
// 发现漏网 iframe 时从父窗口把 XHR/资源钩子补装进去。
export function handleWebviewPreloadHack(id: number) {
  const webContent = webContents.fromId(id)

  if (!webContent) {
    return
  }

  webContent.addListener('did-attach-webview', (event, wc) => {
    wc.addListener(
      'did-frame-navigate',
      async (
        event,
        url,
        httpResponseCode,
        httpStatusText,
        isMainFrame,
        frameProcessId,
        frameRoutingId,
      ) => {
        const frame = webFrameMain.fromId(frameProcessId, frameRoutingId)
        if (frame && url !== 'about:blank') {
          if (!(await frame.executeJavaScript('window.xhrHacked || false'))) {
            console.warn('[kanso] iframe failed to load preload script, loading xhr hack from parent', url)
            await frame.executeJavaScript(`
            (() => {
              let cur = window.parent
              while (true) {
                if (cur.hackXhr) {
                  cur.hackXhr(window)
                  break
                } else if (cur.parent !== cur) {
                  cur = cur.parent
                } else {
                  break
                }
              }
            })()
          `)
          }
          if (!(await frame.executeJavaScript('window.resourceHacked || false'))) {
            console.warn('[kanso] iframe failed to load preload script, loading image hack from parent', url)
            await frame.executeJavaScript(`
            (() => {
              let cur = window.parent
              while (true) {
                if (cur.hackResource) {
                  cur.hackResource(window)
                  break
                } else if (cur.parent !== cur) {
                  cur = cur.parent
                } else {
                  break
                }
              }
            })()
          `)
          }
          if (!(await frame.executeJavaScript('window.kansoAudioControlInstalled || false'))) {
            console.warn('[kanso] iframe failed to load audio control, loading it from parent', url)
            await frame.executeJavaScript(`
            (() => {
              let cur = window.parent
              while (true) {
                if (cur.installKansoAudioControl) {
                  cur.installKansoAudioControl(window)
                  break
                } else if (cur.parent !== cur) {
                  cur = cur.parent
                } else {
                  break
                }
              }
            })()
          `)
          }
        }
      },
    )
  })
}

// 游戏 webview 的弹窗一律丢给系统浏览器（M0 尚无插件窗口需求）
export function handleNewWindow(id: number) {
  const webContent = webContents.fromId(id)

  if (!webContent) {
    return
  }

  webContent.setWindowOpenHandler(({ url }) => {
    try {
      const protocol = new URL(url).protocol
      if (protocol === 'http:' || protocol === 'https:') {
        void shell.openExternal(url).catch((e) => {
          console.warn('[kanso] failed to open external URL', e)
        })
      }
    } catch (_e) {
      // 非法 URL 与自定义系统协议一律拒绝。
    }
    return { action: 'deny' }
  })
}
