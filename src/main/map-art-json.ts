// 海域背景美术的元数据读取（/kcs2/resources/map/<区>/<图>_{info,image}.json）。
//
// 为什么放在主进程：原实现在渲染层用 node 的 https.get 直接发，那条路**不走
// Chromium 网络栈**——没有 UA、没有 Referer、不吃 HTTP 缓存，服务器侧看跟浏览器
// 请求完全是两种东西。poi 全仓库没有一处 https.get/http.get，它的网络请求一律走
// fetch / net.fetch；照它来，别独创请求方式。
//
// 换成 net.fetch 还白捡一个好处：这条路会命中 Chromium 的磁盘缓存，
// 玩家在游戏里打开过那张图之后，我们这边根本不会再产生网络请求。
import { ipcMain, net } from 'electron'

import config from './config'

const CHANNEL = 'kanso:map-art-json'

/**
 * 只放行游戏自己的两类静态元数据：海域美术 JSON，以及装备类别图标图集
 * （common_icon_weapon.json，字面量钉死）。这个通道对渲染层是敞开的，
 * 而矿脉数据会进入同一个页面的 innerHTML——不钉死形状就等于给页面开了
 * 一个任意 URL 的代理。
 */
const allowed = (raw: string): URL | null => {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  if (url.search || url.hash || url.username || url.password) return null
  if (!/^[\w.-]+$/.test(url.hostname)) return null
  if (
    !/^\/kcs2\/resources\/map\/\d{3}\/\d{2}_(?:info|image)\.json$/.test(url.pathname) &&
    url.pathname !== '/kcs2/img/common/common_icon_weapon.json'
  ) return null
  return url
}

export const registerMapArtJson = () => {
  ipcMain.handle(CHANNEL, async (_event, raw: unknown) => {
    if (typeof raw !== 'string') return null
    // 钥里那个开关（`kanso.remoteArt`）在主进程这一侧也要认一次。
    // 渲染层本来就有一道（`readStaticJson` 关着时 `remoteUrl()` 返回 null，
    // 压根不会调这个通道），但**闸门不能只有渲染层那一份**：这个通道对页面敞开，
    // 而三条会真出网的路里另外两条（archive-capture / voice-probe）都在主进程
    // 自己判了一次。少这一份的后果不是「现在会漏」，是「以后谁在渲染层新开一条
    // 调用就绕过了开关」——2026-08-23 全出口审计逐条对齐时补上。
    if (!config.get('kanso.remoteArt', true)) return null
    const url = allowed(raw)
    if (!url) {
      console.warn('[kanso] 拒绝读取非海域美术元数据的地址')
      return null
    }
    try {
      // 原来的 https.get 有 12 秒 timeout；换到 Chromium 网络栈后不能把这层
      // 可靠性一起丢掉。游戏服半开连接时，无超时的 invoke 会永久悬着。
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 12000)
      let response: Response
      try {
        response = await net.fetch(url.href, { signal: controller.signal })
      } finally {
        clearTimeout(timer)
      }
      if (!response.ok) return null
      // 这两个 JSON 正常在几十 KB 量级；给个上限，别让异常响应把渲染层撑爆
      const text = await response.text()
      if (text.length > 3 * 1024 * 1024) {
        console.warn('[kanso] 海域美术元数据过大，丢弃', url.pathname)
        return null
      }
      return JSON.parse(text)
    } catch (error) {
      console.warn('[kanso] 海域美术元数据读取失败', url.pathname, error)
      return null
    }
  })
}
