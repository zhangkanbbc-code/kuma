// ISOLATED WORLD
// 「见过即存」的取字节那一半：把 Chromium **已经缓存下来**的立绘读出来交给主进程。
// 与 voice-archive.js 同族同路，护栏钉法也相同——三个文件都被同一条判据盯着。
//
// 为什么这段非得跑在游戏页里，而不是主进程：
// `cache: 'only-if-cached'` 只能配 `mode: 'same-origin'`，
// 而 same-origin 要求发起方与资源同源——主进程的 `net.fetch` 没有 origin，
// 2026-08-22 本机实测（Electron 43）一律 `net::ERR_INVALID_ARGUMENT`。
// 游戏页面自己发就名正言顺：`/kcs2/resources/ship/*.png` 与它同源。
//
// **这条路结构上发不出网络请求**：`only-if-cached` 在缓存没命中时是抛错，
// 不会退化成一次真请求。所以最坏结果只是「这一张没存下」，永远不会变成对
// 游戏 CDN 的主动拉取。**也绝不从任何 wiki 取图**——档案里的每一张，
// 只能是这台机器上的游戏客户端自己合法收到过的那一份。
//
// 收到的是**完整 URL**（含 `?version=`），不是 pathname：Chromium 的缓存键
// 是完整 URL，丢了 query 就永远打不中（语音侧 2026-08-22 那次 0 条实物的根因）。
const { ipcRenderer } = require('electron')

// 舰船美术的形状。主进程那边还有第二道同样的校验：
// 这个桥对页面上任何脚本都可达，路径不能裸信。
const ART_PATH = /^\/kcs2\/resources\/ship\/[a-z0-9_]+\/\d{4}[A-Za-z0-9_.-]*\.png$/i

// 单条上限，与 shared/art-archive-plan 的 ART_ARCHIVE_MAX_ENTRY_BYTES 一致。
// 这里也拦一道：超大响应先在页面这侧挡掉，别经 IPC 搬一趟再被主进程丢弃。
const MAX_BYTES = 8 * 1024 * 1024

// 同一张正在取的不重复取。一屏编成能同时打好几次同一张图。
const inFlight = new Set()

/**
 * 收下来的 URL → { url, pathname }。同源之外、形状不对的一律拒。
 *
 * 同源是硬前提（`only-if-cached` 只能配 `mode: 'same-origin'`），
 * 这里先自己判一次：不同源的连试都不该试，免得把「拒绝」误当成「缓存里没有」。
 */
const acceptUrl = (raw) => {
  if (typeof raw !== 'string' || raw.length > 2048) return null
  let parsed
  try {
    parsed = new URL(raw, window.location.href)
  } catch (_error) {
    return null
  }
  if (parsed.origin !== window.location.origin) return null
  let pathname
  try {
    pathname = decodeURIComponent(parsed.pathname)
  } catch (_error) {
    return null
  }
  if (!ART_PATH.test(pathname)) return null
  return { url: parsed.href, pathname }
}

const readFromCache = async (rawUrl) => {
  const accepted = acceptUrl(rawUrl)
  if (!accepted) return
  const { url, pathname } = accepted
  if (inFlight.has(url)) return
  inFlight.add(url)
  try {
    const response = await fetch(url, { cache: 'only-if-cached', mode: 'same-origin' })
    if (!response.ok) return
    const buffer = await response.arrayBuffer()
    if (!buffer.byteLength || buffer.byteLength > MAX_BYTES) return
    ipcRenderer.send('kanso:art-archive-blob', {
      // 路径是档案里的身份（与图鉴逐格点亮的判据同一个键）；
      // 完整 URL 一并交回，主进程从里面取版本参数当季节差分的身份。
      pathname,
      url,
      bytes: new Uint8Array(buffer),
    })
  } catch (_error) {
    // 缓存里没有（已被驱逐、或这一张从来没经过 HTTP 缓存）——
    // 这是**正常结果**，不是错误：格子留在「见过但没留下实物」那一档。
    // 这里不重试、不改用别的取法，那会变成一次真的网络请求。
  } finally {
    inFlight.delete(url)
  }
}

const installArtArchive = () => {
  ipcRenderer.on('kanso:art-archive-ask', (_event, url) => {
    // 游戏发起请求与响应落进缓存之间有一小段；等一拍再读，命中率高得多。
    // 主进程那边的「自己发的那次请求」认领窗口按这个 1.2 秒定的（4 秒，三倍余量），
    // 改这个数字要同步看 shared/voice-request-gate 的 SELF_FETCH_WINDOW_MS。
    setTimeout(() => {
      void readFromCache(url)
    }, 1_200)
  })
}

module.exports = { installArtArchive, readFromCache, ART_PATH }
