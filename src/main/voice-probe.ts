// 「音频先行骨架」的探测那一半：点一下才去取那一格，取不到就如实记下来。
//
// 判据与理由在 shared/voice-probe-plan 的文件头（含「与文本背书家法的关系」那一节）。
// 这里只管两件事：**发那一次请求**，以及**把 404 这个事实留在盘上**。
//
// ---- 三条边界，与档案层同一套（别在这里放松）----
//  ① **kcsapi 红线**：`/kcsapi/*` 永不主动请求，与开关无关。这里取的是
//     `/kcs/sound/**.mp3`——静态音频，与游戏自己播一句是同一件事。
//  ② **受钥里那个开关管**（`kanso.remoteArt`，立绘与语音同一个）：关掉就一次都不发。
//  ③ **一次点击一次请求**：这个模块**没有**批量入口，也不许有。
//     打开一页扫 53 个槽就是把一次浏览变成对游戏服务器的 53 连发——
//     整个域的前提就是玩家逐个点，护栏钉着这件事。
import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import { net } from 'electron'

import { atomicWriteJsonSync } from './atomic-json'
import config from './config'
import { APPDATA_PATH } from './env'
import { safeConsole } from './crash-log'
import { keepVoiceBlob } from './voice-archive'
import {
  VOICE_ABSENT_MAX_ENTRIES,
  planVoiceAbsentUpdate,
  sanitizeVoiceAbsentEntry,
  voiceAbsentAfterClear,
  voiceProbeShortCircuits,
  voiceProbeVerdictOf,
  type VoiceAbsentEntry,
  type VoiceProbeVerdict,
} from '../shared/voice-probe-plan'
import { VOICE_ARCHIVE_MAX_ENTRY_BYTES, VOICE_ARCHIVE_PATH } from '../shared/voice-archive-plan'
import { resourceVersionOf } from '../shared/voice-request-gate'

/**
 * 「官方没有这一格」的台账。**与语音档案分开一个文件**：
 * 档案存的是实物（玩家的资产，只有他自己能清），这里存的是探测结论（可以随时重探）。
 * 混在一起会让「清空语音档案」顺手把探测结果也抹掉，于是骨架每次都要重探一遍。
 */
const PROBE_FILE = path.join(APPDATA_PATH, 'voice-absent.json')
const SCHEMA_VERSION = 1

let absent = new Map<string, VoiceAbsentEntry>()
let loaded = false
let dirty = false

const load = () => {
  if (loaded) return
  loaded = true
  try {
    const raw = JSON.parse(fs.readFileSync(PROBE_FILE, 'utf8'))
    const list = Array.isArray(raw?.entries) ? raw.entries : []
    for (const item of list.slice(-VOICE_ABSENT_MAX_ENTRIES)) {
      const entry = sanitizeVoiceAbsentEntry(item)
      if (entry) absent.set(entry.pathname, entry)
    }
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      // 读不出来就当空台账继续：最坏结果是那几格重探一次，绝不拦住启动
      safeConsole('warn', '[kanso] 语音探测台账读取失败，按空台账继续', error)
    }
    absent = new Map()
  }
}

const flush = () => {
  if (!dirty) return
  dirty = false
  try {
    fs.mkdirSync(APPDATA_PATH, { recursive: true })
    atomicWriteJsonSync(PROBE_FILE, {
      schemaVersion: SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      entries: [...absent.values()],
    })
  } catch (error) {
    safeConsole('warn', '[kanso] 语音探测台账落盘失败', error)
  }
}

export const flushVoiceProbe = () => flush()

/**
 * 渲染层启动时取一次：哪几格已知官方没有、以及**分别是哪一天问的**。
 *
 * 整条给出去（不只是路径）是因为日期现在是要显示的内容——那一格的悬停写着它，
 * 钥里按月分组也按它。逐格现问一次同步 IPC 是不行的：一屏骨架五十几行。
 *
 * ⚠️ 这里**不再有时间过滤**（2026-08-23 自动过期退役，判据与理由在
 * shared/voice-probe-plan）。条目直到被重探推翻、或玩家自己清掉为止一直作数。
 */
export const voiceAbsentEntries = (): VoiceAbsentEntry[] => {
  load()
  return [...absent.values()]
}

/**
 * 清理台账。**只有玩家在钥里按下才走到这里**——没有任何自动调用方。
 *
 * @param month `YYYY-MM`（本地年月）= 只清那一月；`null` = 全部清掉。
 *   判据在 shared 的 `voiceAbsentAfterClear`（护栏能脱开 Electron 真跑一遍）。
 * @returns 清完之后还剩几条。
 */
export const clearVoiceAbsent = (month: string | null): number => {
  load()
  const before = absent.size
  const kept = voiceAbsentAfterClear([...absent.values()], month)
  if (kept.length === before) return before
  absent = new Map(kept.map((entry) => [entry.pathname, entry]))
  dirty = true
  flush()
  return absent.size
}

/**
 * 探一格。**只由玩家点击触发**，一次一格。
 *
 * @param recheck 玩家点的是那个**已知无配音**的格子：短路让路，真发这一次请求
 *   （判据与理由在 shared/voice-probe-plan 的 `voiceProbeShortCircuits`）。
 *   骨架探测钮那条路不传它，行为一字不变。
 * @returns 结论 + 取到时的那条档案记录（调用方拿它去当场点亮并播放）。
 *   `sha1` 是**这一次取回来的字节**的指纹，与「有没有新增一条档案」无关：
 *   舰娘页季节台词行上的「取现值」要靠它如实回答「刚取回的这一份跟档案里已有的是不是同一份字节」——
 *   拿 `entry` 是不是空来推那件事会把「写盘失败」误报成「本季没换季节版」。
 */
export const probeVoiceSlot = async (
  rawPathname: unknown,
  rawUrl: unknown,
  recheck = false,
): Promise<{ verdict: VoiceProbeVerdict; entry?: unknown; sha1?: string; absentAt?: number }> => {
  load()
  const pathname = `${rawPathname ?? ''}`
  const rawHref = `${rawUrl ?? ''}`
  if (!VOICE_ARCHIVE_PATH.test(pathname) || rawHref.length > 2_048) return { verdict: 'error' }
  // 已知官方没有：不再打扰服务器。
  // ⚠️ 玩家显式点了那个无配音格（recheck）时这道短路让路——点击就是意图，
  //    不属于批量骚扰。别把它顺手改回无条件短路（判据在 shared 那边，护栏能真跑一遍）。
  const known = absent.get(pathname)
  if (voiceProbeShortCircuits({ known, recheck })) {
    return { verdict: 'absent', absentAt: known?.at }
  }
  // 边界②：钥里关掉了就一次都不发
  if (!config.get('kanso.remoteArt', true)) return { verdict: 'blocked' }
  let url: URL
  try {
    url = new URL(rawHref)
  } catch {
    return { verdict: 'error' }
  }
  if (url.protocol !== 'https:' || !/^[\w.-]+$/.test(url.hostname)) return { verdict: 'blocked' }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12_000)
  let status = 0
  let bytes: Uint8Array | null = null
  try {
    const response = await net.fetch(url.href, { signal: controller.signal })
    status = response.status
    if (response.ok) {
      const buffer = await response.arrayBuffer()
      if (buffer.byteLength && buffer.byteLength <= VOICE_ARCHIVE_MAX_ENTRY_BYTES) {
        bytes = new Uint8Array(buffer)
      }
    }
  } catch {
    return { verdict: 'error' }
  } finally {
    clearTimeout(timer)
  }

  const verdict = voiceProbeVerdictOf(status)
  // 200 但字节没拿到（空 body / 超过单条上限）：那一格**没有真收下来**，
  // 台账这一侧当没取到处理——凭一次没落地的 200 去撤销「官方没有」，
  // 下次点它会重新 404，那条结论白丢一次。
  const settled: VoiceProbeVerdict = verdict === 'kept' && !bytes ? 'error' : verdict
  // **探测失败也是数据**：官方根本没有这一格，如实记下来，骨架据此自我修剪。
  // ⚠️ 只有 404/410 才进这张表——一次网络抖动被固化成「官方没有」，
  // 界面上它和真的没有长得一模一样。台账该记、该刷、还是该撤，判据在
  // shared/voice-probe-plan 的 `planVoiceAbsentUpdate`（护栏能脱开 Electron 真跑一遍）。
  const action = planVoiceAbsentUpdate({
    pathname,
    verdict: settled,
    status,
    at: Date.now(),
    known: absent.has(pathname),
    size: absent.size,
  })
  if (action.kind === 'record') {
    absent.set(pathname, action.entry)
    dirty = true
    flush()
  } else if (action.kind === 'drop') {
    // 官方后来实装了这一句：那条「没有」当场作废，格子转回正常
    absent.delete(pathname)
    dirty = true
    flush()
  }
  // 「官方没有」连日期一起回给渲染层：那一格的悬停写的就是这一天，
  // 重探再 404 时它换成今天，界面据此重画（渲染层不自己 Date.now() 猜一个——
  // 台账满了拒绝新增时，猜出来的日期会与盘上那份对不上）。
  if (verdict === 'absent') {
    return { verdict: 'absent', absentAt: absent.get(pathname)?.at }
  }
  if (verdict !== 'kept' || !bytes) return { verdict: verdict === 'kept' ? 'error' : verdict }
  // 取到了：字节进档案。这一格从此有**实物背书**，下次不必再探，
  // 也顺手采回一条「该舰该槽确实存在」的第一方槽位事实。
  const sha1 = createHash('sha1').update(bytes).digest('hex').slice(0, 16)
  const entry = keepVoiceBlob({ pathname, version: resourceVersionOf(rawHref), bytes })
  return { verdict: 'kept', entry: entry ?? undefined, sha1 }
}
