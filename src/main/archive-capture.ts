// 「显示/播放即入档」：艦素**自己**摆出来的那张图、自己播出去的那一句，
// 也要进档案。
//
// ---- 为什么补这一条（2026-08-23 用户实机报的那一处脱节）----
// 他打开某艘舰的立绘页，屏幕上整张立绘好端端地显示着，页面上的收集格却写着
// 「0/6 图种」。两本账各说各的：**显示**走的是缓存命中 + 游戏资源服务器回退，
// **点亮**认的是档案层——而档案层此前只有一条进货渠道：游戏页面自己请求资源时，
// 锚在 onBeforeRequest 里挂钩、再让游戏页用 only-if-cached 把字节交回来。
// 艦素自己发起的显示与播放**根本不经过那条钩子**，于是「图在眼前却说没见到」。
//
// 补法不是把点亮判据放宽去认缓存（缓存会被整盘丢弃，那等于让收集进度随时蒸发），
// 而是把**显示这件事本身**变成一次入档：既然这一帧已经拿到字节了，就顺手留一份。
// 从此「看见了」与「点亮了」是同一件事的两面，不会再对不上。
//
// ---- 三类网络边界，写在这里给后来者当坐标 ----
//  ① **kcsapi 红线**：`/kcsapi/*` 是会改账号状态的游戏 API，艦素**永不主动请求**，
//     一次都不行。这条与开关无关，没有例外。
//  ② **kcs2/kcs 静态资源白区，受钥里的开关管**：立绘、语音这类静态文件，
//     取它跟游戏自己加载一张图是同一件事（不改状态、不消耗、不留玩家行为记录），
//     所以允许——但**只指向游戏自己的服务器**，且玩家可以在钥里
//     「不联网补取美术资源」一关了之（`kanso.remoteArt`，立绘与语音**同一个开关**）。
//  ③ **档案零网络**：档案里的实物一律只从「本机已经有的字节」来——
//     Chromium 缓存文件，或页面 only-if-cached 读出来的那一份。
//     本文件这条新路同样守住它：**先读本机缓存文件**，读到就用；读不到时才走
//     ②（`net.fetch` 命中磁盘缓存的概率极高，因为这张图刚刚才显示出来），
//     而开关关掉时**连②都不走**，那一条就是没存下，如实。
import fs from 'fs'
import path from 'path'
import { net } from 'electron'

import config from './config'
import { ROOT, DEFAULT_CACHE_PATH } from './env'
import { safeConsole } from './crash-log'
import { keepArtBlob } from './art-archive'
import { keepVoiceBlob } from './voice-archive'
import {
  ART_ARCHIVE_MAX_ENTRY_BYTES,
  ART_ARCHIVE_PATH,
  shouldArchiveArtType,
  type ArtArchiveEntry,
} from '../shared/art-archive-plan'
import {
  VOICE_ARCHIVE_MAX_ENTRY_BYTES,
  VOICE_ARCHIVE_PATH,
  type VoiceArchiveEntry,
} from '../shared/voice-archive-plan'
import { resourceVersionOf } from '../shared/voice-request-gate'

const { getCacheCandidatePaths } = require(
  path.join(ROOT, 'assets', 'preload', 'kcs-resource-path'),
) as { getCacheCandidatePaths: (cacheDir: string, pathname: string) => string[] }

/**
 * 同一条正在取的不重复取。一屏立绘页能同时打好几次同一张图（重渲染、切形态），
 * 而每一次都会触发一遍 load 事件。
 */
const inFlight = new Set<string>()
/** 同时在跑的上限。这不是热路径，但也不该在切页那一下并发几十个读盘。 */
const MAX_IN_FLIGHT = 6

/** 缓存目录跟着钥里的设置走（键与 kcs-resource 的 getCacheDir 同一个，别各写各的）。 */
const cacheDir = (): string => `${config.get('kanso.cache.path', DEFAULT_CACHE_PATH)}`

/** 这条 pathname 在本机缓存里的文件；没有就 null。**读它不产生任何网络行为**。 */
const cachedBytes = (pathname: string): Uint8Array | null => {
  let candidates: string[]
  try {
    candidates = getCacheCandidatePaths(cacheDir(), pathname)
  } catch {
    return null
  }
  for (const file of candidates) {
    try {
      return new Uint8Array(fs.readFileSync(file))
    } catch {
      /* 试下一个 */
    }
  }
  return null
}

/**
 * 回退到游戏自己的资源服务器。**受钥里那个开关管**（边界②）。
 *
 * 这一步在实践中几乎总是命中 Chromium 的磁盘缓存——因为调用它的前提就是
 * 「这张图/这段音频刚刚已经显示/播放出来了」，字节必然刚进过缓存。
 * 走 `net.fetch` 而不是自造请求，是为了吃到那份缓存（同 main/map-art-json 的理由）。
 */
const remoteBytes = async (rawUrl: string, maxBytes: number): Promise<Uint8Array | null> => {
  if (!config.get('kanso.remoteArt', true)) return null
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || !/^[\w.-]+$/.test(url.hostname)) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12_000)
  try {
    const response = await net.fetch(url.href, { signal: controller.signal })
    if (!response.ok) return null
    const buffer = await response.arrayBuffer()
    if (!buffer.byteLength || buffer.byteLength > maxBytes) return null
    return new Uint8Array(buffer)
  } catch {
    // 取不到就是这一条没存下。不重试、不换别的取法——那会把「顺手留一份」
    // 变成一场对游戏 CDN 的补拉。
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** 页面交上来的地址：形状不对、越界的一律拒。这个通道对渲染层是敞开的。 */
const accept = (
  rawPathname: unknown,
  rawUrl: unknown,
  shape: RegExp,
): { pathname: string; url: string } | null => {
  const pathname = `${rawPathname ?? ''}`
  const url = `${rawUrl ?? ''}`
  if (!shape.test(pathname) || url.length > 2_048) return null
  return { pathname, url }
}

const capture = async <T>(
  pathname: string,
  url: string,
  maxBytes: number,
  keep: (bytes: Uint8Array) => T | null,
): Promise<T | null> => {
  if (inFlight.has(pathname) || inFlight.size >= MAX_IN_FLIGHT) return null
  inFlight.add(pathname)
  try {
    // 本机缓存文件优先：那是**零网络**的一条路（边界③）
    let bytes = cachedBytes(pathname)
    if (bytes && bytes.byteLength > maxBytes) bytes = null
    // 本机没有文件时才走游戏自己的服务器，且开关关掉就不走
    if (!bytes) bytes = await remoteBytes(url, maxBytes)
    if (!bytes?.byteLength) return null
    return keep(bytes)
  } catch (error) {
    safeConsole('warn', '[kanso] 显示即入档失败', pathname, error)
    return null
  } finally {
    inFlight.delete(pathname)
  }
}

/**
 * 艦素刚显示成功一张舰船美术。**不在热路径上**：调用方在 `<img>` 的 load 事件里
 * 发一条 IPC 就完事，显示不等转存；这里再异步去拿字节。
 *
 * 去重靠 `keepArtBlob` 自己那一道（路径 + 内容指纹 + 版本参数）——
 * 已经留过的同一份进来只会刷新一下 lastSeen，不会重复落盘。
 */
export const captureDisplayedArt = async (
  rawPathname: unknown,
  rawUrl: unknown,
  /**
   * 主数据里那个形态**现行**的图片版本号。给了就用它，没给才从 URL 上提。
   *
   * 为什么要这个口子：`?version=` 只挂在**回退到游戏服务器**的那条 URL 上，
   * 本机缓存命中时地址是 `file://…`，提不出版本。那时入档的条目版本是空的，
   * 而图鉴画廊尾接的档案卡恰恰要按「档案里有没有现行这一版」对账——空版本会让一张卡
   * 永远显示成「还没收到现行版」，玩家点多少次都不变（点了也确实没错，只是白点）。
   * 版本是主数据里的事实，由调用方直接给比从地址里猜更硬。
   */
  rawVersion?: unknown,
): Promise<ArtArchiveEntry | null> => {
  const accepted = accept(rawPathname, rawUrl, ART_ARCHIVE_PATH)
  if (!accepted) return null
  // 只收**立绘级**的图种，与游戏页那条路同一道闸门（kcs-resource 也在要字节之前判它）。
  // 横幅、卡面、补给小图是界面零件不是收集品——全收会让档案被几百 KB 的小图塞满，
  // 而立绘页一屏就摆着十几张这种零件（实测漏判时一次进来 13 张，收集进度当场变成 13/6）。
  const matched = /^\/kcs2\/resources\/ship\/([a-z0-9_]+)\/(\d{4})/i.exec(accepted.pathname)
  if (!matched || !shouldArchiveArtType(Number(matched[2]), matched[1].toLowerCase())) return null
  // 版本参数默认从 URL 里取，走与锚那条路同一个提取器：它既是缓存键的一部分，
  // 也是季节差分的身份（同一槽位的当季版与平时版因此是两条不同的档案）。
  // 调用方显式给了版本（主数据里的现行版号）就用那一份——形状仍旧不裸信。
  const given = `${rawVersion ?? ''}`
  const version = /^[\w.-]{1,32}$/.test(given) ? given : resourceVersionOf(accepted.url)
  return capture(accepted.pathname, accepted.url, ART_ARCHIVE_MAX_ENTRY_BYTES, (bytes) =>
    keepArtBlob({ pathname: accepted.pathname, version, bytes }),
  )
}

/**
 * 艦素刚播放成功一句语音（图鉴台词卷的播放钮）。
 *
 * 此前语音档案只有一条进货渠道：**游戏页面**播放时锚挂钩。
 * 玩家在图鉴里点播放同样是「这一句在这台机器上响过」，一样该入档——
 * 而且入档之后那一格下次就走档案实物，天然不会再受季节换文件影响。
 */
export const captureDisplayedVoice = async (
  rawPathname: unknown,
  rawUrl: unknown,
): Promise<VoiceArchiveEntry | null> => {
  const accepted = accept(rawPathname, rawUrl, VOICE_ARCHIVE_PATH)
  if (!accepted) return null
  const version = resourceVersionOf(accepted.url)
  return capture(accepted.pathname, accepted.url, VOICE_ARCHIVE_MAX_ENTRY_BYTES, (bytes) =>
    keepVoiceBlob({ pathname: accepted.pathname, version, bytes }),
  )
}
