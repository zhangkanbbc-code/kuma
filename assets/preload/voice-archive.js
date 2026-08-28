// ISOLATED WORLD
// 「听过即存」的取字节那一半：把 Chromium **已经缓存下来**的语音读出来交给主进程。
//
// 为什么这段非得跑在游戏页里，而不是主进程：
// `cache: 'only-if-cached'` 只能配 `mode: 'same-origin'`，
// 而 same-origin 要求发起方与资源同源——主进程的 `net.fetch` 没有 origin，
// 2026-08-22 本机实测（Electron 43）一律 `net::ERR_INVALID_ARGUMENT`。
// 游戏页面自己发就名正言顺：`/kcs/sound/*.mp3` 与它同源。
//
// **这条路结构上发不出网络请求**：`only-if-cached` 在缓存没命中时是抛错
// （实测冷读 `Failed to fetch`），不会退化成一次真请求。所以最坏结果只是
// 「这一条没存下」，永远不会变成对游戏 CDN 的主动拉取。
//
// 隔离世界与主世界共用同一个安全源，所以这里的 fetch 同样满足 same-origin；
// 不需要（也不应该）把这段推进主世界——它拿着 ipcRenderer。
//
// ---- 收到的是**完整 URL**，不是 pathname（2026-08-22 修）----
// 游戏真实请求带版本参数：`/kcs/sound/kcxgkywfhkphjf/193212.mp3?version=112`
//（用户缓存实测，舰船美术同样 3343/3672 条带）。而 Chromium 的缓存键**是完整 URL**。
// 此前这里用 `new URL(pathname, location.href)` 重拼，把 query 丢了，
// 于是 `only-if-cached` 永远打不中——玩家档案里一条实物都没有就是这么来的。
// 所以主进程直接把它拦到的那个 URL 原样传过来，这里只做同源与形状校验，不重拼。
const { ipcRenderer } = require('electron')

// 游戏音轨的形状。主进程那边还有第二道同样的校验：
// 这个桥对页面上任何脚本都可达，路径不能裸信。
const VOICE_PATH = /^\/kcs\/sound\/(?:kc[A-Za-z0-9_-]+|titlecall)\/[A-Za-z0-9_-]+\.mp3$/

// 单条上限，与 shared/voice-archive-plan 的 VOICE_ARCHIVE_MAX_ENTRY_BYTES 一致。
// 这里也拦一道：超大响应先在页面这侧挡掉，别经 IPC 搬一趟再被主进程丢弃。
const MAX_BYTES = 4 * 1024 * 1024

// 同一条正在取的不重复取。进战斗时同一句台词会被连打好几次。
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
  if (!VOICE_PATH.test(pathname)) return null
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
    ipcRenderer.send('kanso:voice-archive-blob', {
      // 路径是档案里的身份（与图鉴逐行点亮的判据同一个键）；
      // 完整 URL 一并交回，主进程从里面取版本参数当季节差分的身份。
      pathname,
      url,
      bytes: new Uint8Array(buffer),
    })
  } catch (_error) {
    // 缓存里没有（已被驱逐、或这一条从来没经过 HTTP 缓存）——
    // 这是**正常结果**，不是错误：格子留在「听过但没留下实物」那一档。
    // 这里不重试、不改用别的取法，那会变成一次真的网络请求。
  } finally {
    inFlight.delete(url)
  }
}

const installVoiceArchive = () => {
  ipcRenderer.on('kanso:voice-archive-ask', (_event, url) => {
    // 游戏发起请求与响应落进缓存之间有一小段；等一拍再读，命中率高得多。
    // 主进程那边的「自己发的那次请求」认领窗口按这个 1.2 秒定的（4 秒，三倍余量），
    // 改这个数字要同步看 shared/voice-request-gate 的 SELF_FETCH_WINDOW_MS。
    setTimeout(() => {
      void readFromCache(url)
    }, 1_200)
  })
}

module.exports = { installVoiceArchive, readFromCache, VOICE_PATH }
