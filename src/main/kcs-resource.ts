// Adapted from poi (https://github.com/poooi/poi) lib/kcs-resource.ts
// MIT License, Copyright (c) poi contributors — 移植与改造：艦素 kanso 项目。
// 锚：用特权 scheme（kanso-cache://）向游戏页面提供本地缓存/魔改资源。
// secure + bypassCSP 使其可载入 https 游戏页；corsEnabled + ACAO 头保证游戏 canvas
// 不被污染（截图可用）。script 只接受显式 .hack.* 覆盖——游戏脚本带版本号，
// gadget 登录还有 script RPC，供上陈旧缓存会直接炸登录（原版血泪注释保留）。
import { net, protocol, session } from 'electron'
import { constants, promises as fsp } from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'

import config from './config'
import { DEFAULT_CACHE_PATH, ROOT } from './env'
import broadcaster = require('./game-api-broadcaster')
import { parseKcsBgmPath } from '../shared/kcs-bgm'
import { rememberBgmHeard } from './bgm-archive'
import { parseShipArtPath } from '../shared/ship-art-path'
import { rememberShipArtPath } from './ship-art-store'
import { rememberVoiceHeard } from './voice-archive'
import { artArchivePrimeTargets, rememberArtSeen } from './art-archive'
import { shouldArchiveArtType } from '../shared/art-archive-plan'
import { createVoiceRequestGate, resourceVersionOf } from '../shared/voice-request-gate'

// 与 preload 隔离世界共享的纯 JS 路径逻辑（主进程按绝对路径 require）
const kcsResourcePath: {
  isStaticResource: (pathname?: string) => boolean
  getCacheCandidatePaths: (cacheDir: string, pathname?: string) => [string, string]
} = require(path.join(ROOT, 'assets', 'preload', 'kcs-resource-path'))

const { isStaticResource, getCacheCandidatePaths } = kcsResourcePath

const SCHEME = 'kanso-cache'
let gameWebContentsId: number | null = null

export const setKcsResourceGameWebContentsId = (id: number | null) => {
  gameWebContentsId = id
  if (id == null) broadcaster.setCurrentBgm(null)
}

/** 这个 webContents 是不是游戏那一个。IPC 收货口拿它挡别处来的消息。 */
export const isGameWebContents = (id: number): boolean =>
  gameWebContentsId != null && id === gameWebContentsId

// 游戏资源覆盖面很小且类型固定，用一张小表替代 mime 依赖（poi 用 mime v4，ESM-only 麻烦）
const MIME_MAP: Record<string, string> = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.html': 'text/html',
  '.txt': 'text/plain',
}

// 允许换出的资源类型。图片不在此列：在页面侧（resource-hack.js）处理，
// 那边能设置 crossOrigin，保 WebGL canvas 不被污染。xhr/document 也排除——
// gadget 登录流程会 eval XHR 响应体，供上缓存文件会炸登录。
const HACKABLE_RESOURCE_TYPES = new Set(['stylesheet', 'media', 'font', 'script'])
// script 只接受显式 .hack.* 覆盖，绝不供纯缓存原文件（版本钉死 + 登录 RPC）
const OVERRIDE_ONLY_RESOURCE_TYPES = new Set(['script'])

const getCacheDir = (): string => config.get('kanso.cache.path', DEFAULT_CACHE_PATH)

const findHackFilePathAsync = async (
  cacheDir: string,
  pathname: string,
  overrideOnly = false,
): Promise<string | undefined> => {
  const [hackedFilePath, originFilePath] = getCacheCandidatePaths(cacheDir, pathname)
  const candidates = overrideOnly ? [hackedFilePath] : [hackedFilePath, originFilePath]
  for (const candidate of candidates) {
    try {
      await fsp.access(candidate, constants.R_OK)
      return candidate
    } catch (_e) {
      // try next candidate
    }
  }
  return undefined
}

/**
 * 该向哪几帧要这段字节。
 *
 * 首选**发起这次请求的那一帧**——同源是 `only-if-cached` 的硬前提，
 * 而发起方与资源天然同源。但游戏页里 preload 不是每一帧都装得上
 *（冒烟里就能看到 `about:srcdoc` 帧装不上，改由父帧补装 xhr hack），
 * 所以主帧也一并问一声：它要么同源（srcdoc 继承父源）能读到，
 * 要么跨源直接抛错、什么也不做。多问一帧的代价是一条字符串 IPC，
 * 而 `only-if-cached` 保证了它绝不会退化成一次网络请求。
 */
const askableFrames = (details: {
  frame?: Electron.WebFrameMain | null
  webContents?: Electron.WebContents
}): Electron.WebFrameMain[] => {
  const frames: Electron.WebFrameMain[] = []
  const requesting = details.frame
  if (requesting) frames.push(requesting)
  const main = details.webContents?.mainFrame
  if (main && main !== requesting) frames.push(main)
  return frames
}

/**
 * 语音请求闸门。**没有它这条路会自激**：页面替我们读缓存发的那一次 fetch，
 * 同样会被下面的 onBeforeRequest 拦到，于是「再 emit 一次字幕、再问一次字节」，
 * 而 askableFrames 一次问两帧，每轮还翻倍。
 * 2026-08-22 用户实机撞出来，判据与代价写在 shared/voice-request-gate.ts。
 */
const voiceGate = createVoiceRequestGate()

/**
 * 立绘请求闸门。与语音那道**各自一份**（同一个 URL 不会既是语音又是立绘，
 * 分开只是让两边的冷却与次数上限互不干扰）。
 * 没有它这条路同样会自激——理由与 voiceGate 完全相同，见 shared/voice-request-gate。
 */
const artGate = createVoiceRequestGate()

/**
 * BGM 请求闸门。同样**各自一份**，理由与上面两道相同（自激循环）。
 * BGM 与语音、立绘天然不会撞同一个 URL，分开只是让三边的冷却互不干扰。
 */
const bgmGate = createVoiceRequestGate()

/**
 * 立绘闸门的键：`pathname + search`，**不是完整 URL**。
 *
 * 语音那边两侧都拿得到 `details.url`（绝对地址），自洽即可；立绘多了一条
 * 「首次运行吸收」的入口——那条路手里只有路径与版本号，拼不出游戏当前的 origin。
 * 两边的键必须是同一个，否则自己发的那次请求认领不上，就又回到自激循环。
 * 页面侧收到相对地址会用 `new URL(raw, location.href)` 还原，同源判定照旧。
 */
const artKeyOf = (url: string): string => {
  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}`
  } catch (_e) {
    return url
  }
}

/** 该向哪个 webContents 问「吸收」用的那些图。游戏页没就位时什么都不做。 */
const gameWebContents = (): Electron.WebContents | null => {
  if (gameWebContentsId == null) return null
  const found = require('electron').webContents.fromId(gameWebContentsId)
  return found && !found.isDestroyed() ? found : null
}

/**
 * 首次运行的「吸收」：把 Chromium 缓存里**已经有**的立绘搬进档案。
 *
 * 一次运行只跑一遍，且**慢慢滴**（每 200ms 一条）——它是补历史，不是急事，
 * 抢在游戏加载资源前面挤带宽/占主线程都是负收益。
 * 零网络仍然成立：候选全来自游戏自己请求过的真实路径，取字节走 only-if-cached，
 * 缓存里没有就是抛错。
 */
let artPrimeStarted = false
export const primeArtArchiveFromCache = (
  learned: Record<string, string>,
  versionOf: (mstId: number) => string | null,
) => {
  if (artPrimeStarted) return
  artPrimeStarted = true
  const targets = artArchivePrimeTargets(learned, versionOf)
  if (!targets.length) return
  console.log(`[kanso] 立绘档案：从浏览器缓存吸收 ${targets.length} 张候选（零网络，慢速）`)
  let index = 0
  const tick = () => {
    const contents = gameWebContents()
    if (!contents) return // 游戏页走了就停；下次启动再来
    const now = Date.now()
    for (let sent = 0; sent < 1 && index < targets.length; index++) {
      const target = targets[index]
      if (!artGate.shouldAsk(target, now)) continue
      for (const frame of [contents.mainFrame]) {
        try {
          frame.send('kanso:art-archive-ask', target)
          sent++
        } catch (_e) {
          // 帧刚导航走/已销毁——这一张不吸收，不是错误
        }
      }
    }
    if (index < targets.length) setTimeout(tick, 200).unref?.()
  }
  setTimeout(tick, 20_000).unref?.() // 让登录与首屏加载先过去
}

// 必须在 app ready 之前调用（特权 scheme 的注册要求）
export const registerKcsResourceScheme = () => {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        bypassCSP: true,
        stream: true,
      },
    },
  ])
}

// 必须在 app ready 之后调用
export const registerKcsResourceProtocol = () => {
  const ses = session.defaultSession

  // (曾在这里给海图 _info.json 强制 no-store 以护开图嗅探——后来实测
  // 游戏对海图美术有**应用层**缓存,HTTP 层怎么改都探不到重开;陆航提示
  // 已改成全局常驻、不再依赖开图信号,这段就撤了,别留无用拦截。)

  // 本地存在魔改/缓存文件时，把游戏静态资源请求重定向到 kanso-cache://
  ses.webRequest.onBeforeRequest(
    { urls: ['*://*/kcs/*', '*://*/kcs2/*', '*://*/gadget_html5/*'] },
    async (details, callback) => {
      try {
        const parsed = new URL(details.url)
        const { pathname } = parsed
        // 语音与立绘两段闸门共用同一个时刻：同一次请求里取两遍 Date.now()
        // 会让「认领窗口」的两侧算在不同基准上
        const now = Date.now()
        if (
          details.webContentsId === gameWebContentsId &&
          parsed.protocol !== `${SCHEME}:` &&
          /^\/kcs\/sound\/(?:kc[^/]+|titlecall)\/[^/]+\.mp3$/i.test(pathname)
        ) {
          const voicePath = decodeURIComponent(pathname)
          // ① 先问：这一次请求是不是**我们自己**刚让页面发的那一次读缓存请求？
          //    是的话整段跳过——它既不是一次新的播放（不该出字幕、不该记「听过」），
          //    也绝不能再触发一次「问页面要字节」（那正是自激循环的那条边）。
          if (!voiceGate.claimSelfFetch(details.url, now)) {
            broadcaster.emit('kancolle.voice', { pathname: voicePath, ts: now })
            // 「听过」这件事先记下来——它是收集三态里的半亮那一档，
            // 就算后面一个字节都拿不到，玩家确实听过也是真的。
            // 只有还没留下实物、且闸门放行时，才值得再问页面要一次字节。
            const wantBytes = rememberVoiceHeard({
              pathname: voicePath,
              // 版本参数是季节差分的身份：官方换季换一次 version，
              // 同一槽位的当季版与平时版因此是两份不同的实物。
              version: resourceVersionOf(details.url),
              ts: now,
            })
            if (wantBytes && voiceGate.shouldAsk(details.url, now)) {
              // 向**发起这次请求的那一帧**要。同源是 only-if-cached 的硬前提，
              // 而发起方与资源天然同源；换成 webContents.send 只到主帧，
              // 游戏真正跑在子帧里时就永远读不到（子帧 preload 靠宿主的
              // nodeIntegrationInSubFrames 才在，见 index.ts 的 webPreferences）。
              //
              // 传的是**完整 URL（含 ?version=）**，不是 pathname：Chromium 的
              // 缓存键是完整 URL，丢了 query 就永远打不中（0 条实物的根因）。
              for (const frame of askableFrames(details)) {
                try {
                  frame.send('kanso:voice-archive-ask', details.url)
                } catch (_e) {
                  // 帧刚导航走/已销毁——这一条不存，不是错误
                }
              }
            }
          }
        }
        if (
          details.webContentsId === gameWebContentsId &&
          parsed.protocol !== `${SCHEME}:`
        ) {
          const bgmPath = decodeURIComponent(pathname)
          const bgm = parseKcsBgmPath(bgmPath)
          // ① 先认领自己那次读缓存请求：它不是一次新的播放（顶栏不该改「正在播放」，
          //    也不该记一次「响过」），更不能再触发一次要字节（那就是自激循环）。
          if (bgm && !bgmGate.claimSelfFetch(details.url, now)) {
            broadcaster.setCurrentBgm(bgm.id > 0 ? bgm : null)
            // 「响过」先记下来——就算后面一个字节都拿不到，它在这台机器上确实响过。
            // 只有这个版本还没留下实物、且闸门放行时，才值得再问页面要一次字节。
            const wantBgmBytes = rememberBgmHeard({
              pathname: bgmPath,
              version: resourceVersionOf(details.url),
              ts: now,
            })
            if (wantBgmBytes && bgmGate.shouldAsk(details.url, now)) {
              // 传完整 URL（含 ?version=）：Chromium 的缓存键是完整 URL
              for (const frame of askableFrames(details)) {
                try {
                  frame.send('kanso:bgm-archive-ask', details.url)
                } catch (_e) {
                  // 帧刚导航走/已销毁——这一首不存，不是错误
                }
              }
            }
          }
          // 「玩家打开了哪张海域」——kcsapi 里没有这个信息（选区、切区都不发请求，
          // 真正带图号的 api_req_map/start 时札已经打上了）。但打开海域必然要取
          // 那张图的美术，路径里就带着区号与图号。
          // 只认游戏自己的请求：艦素的海域卷也会取同一批 JSON，那不算玩家打开了图。
          const opened = /^\/kcs2\/resources\/map\/(\d{3})\/(\d{2})[^/]*$/.exec(
            decodeURIComponent(pathname),
          )
          if (opened) {
            broadcaster.emit('kancolle.map.open', {
              areaId: Number(opened[1]),
              mapNo: Number(opened[2]),
              ts: Date.now(),
            })
          }
          // 「这张图的真实路径长什么样」——新深海舰的立绘带一段推不出来的
          // 随机串（见 shared/ship-art-path.ts），只能这样记下来给图鉴用。
          // 只认游戏自己的请求：艦素按老格式拼的那些 404 不该被记成事实。
          const artPath = decodeURIComponent(pathname)
          if (rememberShipArtPath(artPath)) {
            const learned = parseShipArtPath(artPath)
            if (learned) broadcaster.emit('kancolle.shipart.learn', learned)
          }
          // 「见过即存」的立绘那一半。与语音同一条路、同样的闸门：
          // ① 先认领自己那次读缓存请求（不认领就是自激循环，见 voice-request-gate）；
          // ② 只收**立绘级**图种（横幅/卡面是界面零件，不是收集品；深海舰除外——
          //    官方极少给它们做全身立绘，横幅就是它们唯一的图）。
          const artEntry = parseShipArtPath(artPath)
          if (
            artEntry &&
            shouldArchiveArtType(artEntry.mstId, artEntry.type) &&
            !artGate.claimSelfFetch(artKeyOf(details.url), now)
          ) {
            const wantArt = rememberArtSeen({
              pathname: artPath,
              version: resourceVersionOf(details.url),
              ts: now,
            })
            if (wantArt && artGate.shouldAsk(artKeyOf(details.url), now)) {
              for (const frame of askableFrames(details)) {
                try {
                  frame.send('kanso:art-archive-ask', artKeyOf(details.url))
                } catch (_e) {
                  // 帧刚导航走/已销毁——这一张不存，不是错误
                }
              }
            }
          }
        }
        if (!HACKABLE_RESOURCE_TYPES.has(details.resourceType)) {
          callback({})
          return
        }
        if (!isStaticResource(pathname)) {
          callback({})
          return
        }
        const overrideOnly = OVERRIDE_ONLY_RESOURCE_TYPES.has(details.resourceType)
        const filePath = await findHackFilePathAsync(
          getCacheDir(),
          decodeURIComponent(pathname),
          overrideOnly,
        )
        if (filePath) {
          callback({ redirectURL: `${SCHEME}://resource${pathname}` })
        } else {
          callback({})
        }
      } catch (_e) {
        callback({})
      }
    },
  )

  // 供出解析后的本地文件。路径永远从请求 pathname 重新解析（绝不用页面提供的
  // 文件路径），并钳制在缓存目录内，防止页面借这个 scheme 读任意文件。
  ses.protocol.handle(SCHEME, async (request) => {
    try {
      const { pathname } = new URL(request.url)
      const decodedPathname = decodeURIComponent(pathname)
      if (!isStaticResource(decodedPathname)) {
        return new Response(null, { status: 404 })
      }
      const cacheDir = getCacheDir()
      const filePath = await findHackFilePathAsync(cacheDir, decodedPathname)
      if (!filePath) {
        return new Response(null, { status: 404 })
      }
      const resolved = path.resolve(filePath)
      if (!resolved.startsWith(path.resolve(cacheDir) + path.sep)) {
        console.warn('[kanso] kcs-resource: refusing to serve path outside cache dir', resolved)
        return new Response(null, { status: 403 })
      }
      const fileResponse = await net.fetch(pathToFileURL(resolved).href)
      const headers = new Headers(fileResponse.headers)
      headers.set('Access-Control-Allow-Origin', '*')
      const contentType = MIME_MAP[path.extname(resolved).toLowerCase()]
      if (contentType) {
        headers.set('Content-Type', contentType)
      }
      return new Response(fileResponse.body, {
        status: fileResponse.status,
        statusText: fileResponse.statusText,
        headers,
      })
    } catch (e) {
      console.warn('[kanso] kcs-resource: failed to serve', request.url, e)
      return new Response(null, { status: 500 })
    }
  })
}
