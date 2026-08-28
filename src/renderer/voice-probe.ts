// 「音频先行骨架」的渲染层这一半：哪几格已知官方没有、以及点一下去探一格。
//
// 判据与全部理由在 shared/voice-probe-plan 的文件头。这里只做两件事：
// 把「官方没有」的名单在启动时取一次（逐行判定不能临时发同步 IPC——
// 一屏骨架五十几行，那会把界面钉住），以及把玩家那一次点击转成一次探测。
//
// ⚠️ **这个模块没有批量探测入口，也不许加。** 打开一页扫 53 个槽就是把一次浏览
// 变成对游戏服务器的 53 连发；整个域的前提是玩家逐个点，护栏钉着这件事。
import { voicePathname } from './kcs-voice'

import { voiceAbsentDayOf, type VoiceAbsentEntry } from '../shared/voice-probe-plan'
import type { VoiceProbeVerdict } from '../shared/voice-probe-plan'

const { ipcRenderer } = require('electron')

/**
 * 已知官方没有的音轨路径 → **问的是哪一天**（毫秒）。启动时取一次，
 * 之后由每次探测的结果增量更新。
 *
 * 从 Set 换成 Map 是因为日期现在是要显示的内容（2026-08-23 自动过期退役之后，
 * 那一格的悬停写的就是这一天）。装配期这一份索引照旧只拉一次——
 * 逐行判定不能临时发同步 IPC，一屏骨架五十几行。
 */
let absent = new Map<string, number>()
let loading: Promise<void> | null = null
let ready = false

const readAbsentList = (list: unknown): Map<string, number> => {
  const out = new Map<string, number>()
  for (const item of Array.isArray(list) ? (list as VoiceAbsentEntry[]) : []) {
    const pathname = `${item?.pathname ?? ''}`
    if (pathname) out.set(pathname, Number(item?.at) || 0)
  }
  return out
}

export const loadVoiceAbsent = (): Promise<void> => {
  loading ??= (ipcRenderer.invoke('mg:voice-absent') as Promise<unknown>)
    .then((list) => {
      absent = readAbsentList(list)
      ready = true
    })
    .catch((error: unknown) => {
      loading = null
      console.warn('[kanso] 语音探测台账读取失败', error)
    })
  return loading
}

/**
 * 玩家在钥里清过台账之后**重取一次**，并让正开着的台词卷重画。
 *
 * 只由那一次点击调用（钥里的清理钮）——这里没有轮询，也不许加：
 * 台账只会因为玩家自己的动作变化（点探测、点清理），没有第三条路。
 */
export const reloadVoiceAbsent = async (): Promise<void> => {
  try {
    absent = readAbsentList(await ipcRenderer.invoke('mg:voice-absent'))
    ready = true
  } catch (error) {
    console.warn('[kanso] 语音探测台账重读失败', error)
    return
  }
  // 装配层那条既有路子：广播一个 DOM 事件，由模块自己判断要不要重画
  //（这里不该知道哪个模块正开着哪一页，同 kcs-image 的 kanso:art-source-change）
  document.dispatchEvent(new CustomEvent('kanso:voice-absent-change'))
}

/** 索引到位没有。没到位时**不摆无配音态**——那会把「还不知道」显示成「官方没有」。 */
export const voiceAbsentReady = (): boolean => ready

/** 这一格是不是已知官方没有语音。 */
export const isVoiceAbsent = (mstId: number, slot: number): boolean => {
  const pathname = voicePathname(mstId, slot)
  return pathname ? absent.has(pathname) : false
}

/**
 * 这一格**是哪一天问的**（本地日历 `YYYY-MM-DD`）；没记过、或时间戳读不出来给空串。
 *
 * 悬停文案要写具体日期：「问过了，没有」离开日期就只是一句没有出处的断言，
 * 而这条台账从 2026-08-23 起是永久的——不写日期，玩家无从判断这个结论有多旧。
 */
export const voiceAbsentDay = (mstId: number, slot: number): string => {
  const pathname = voicePathname(mstId, slot)
  if (!pathname) return ''
  const at = absent.get(pathname)
  return at ? voiceAbsentDayOf(at) : ''
}

/**
 * 探一格。**只由玩家点击调用**——这是这个域唯一的请求发起点。
 *
 * @param recheck 玩家点的是那个**已知无配音**的格子：主进程那道「已知没有」的短路
 *   为这一次让路，真发一次请求（判据在 shared/voice-probe-plan）。其余闸门一道没绕。
 * @returns 结论；`kept` 时那一条已经进了档案，调用方直接去档案里取地址播放。
 */
export const probeVoiceSlot = async (
  mstId: number,
  slot: number,
  url: string,
  recheck = false,
): Promise<VoiceProbeVerdict> =>
  (await probeVoiceSlotDetailed(mstId, slot, url, recheck)).verdict

/**
 * 同上，但把**这一次取回来的字节指纹**一并交出来。
 *
 * 舰娘页季节台词行上的「取现值」要靠它如实回答「刚取回的这一份跟档案里已有的是不是同一份」——
 * 相同就是「本季这一格没换季节版」，那是数据不是失败（判据在
 * shared/seasonal-collect 的 `collectOutcomeOf`）。
 *
 * ⚠️ 这仍旧是**同一条请求路径**：一次点击一次请求，闸门（钥里的开关、
 * 已知官方没有的短路）一道没绕。这个模块**没有批量入口，也不许加**。
 */
export const probeVoiceSlotDetailed = async (
  mstId: number,
  slot: number,
  url: string,
  recheck = false,
): Promise<{ verdict: VoiceProbeVerdict; sha1: string }> => {
  const pathname = voicePathname(mstId, slot)
  if (!pathname || !url) return { verdict: 'error', sha1: '' }
  try {
    const result = (await ipcRenderer.invoke('mg:voice-probe', { pathname, url, recheck })) as {
      verdict?: VoiceProbeVerdict
      sha1?: string
      absentAt?: number
    }
    const verdict = result?.verdict ?? 'error'
    // 「官方没有」当场并进本地名单：这一格随即摆成无配音态。
    // 日期用**台账那一份**（主进程回的 absentAt），不在这边 Date.now() 另猜一个——
    // 台账满了拒绝新增时，猜出来的日期会和盘上那份对不上。
    if (verdict === 'absent') absent.set(pathname, Number(result?.absentAt) || 0)
    // 取到了：官方后来实装了这一句，本地名单里那条当场作废（主进程的台账同步撤掉）
    if (verdict === 'kept') absent.delete(pathname)
    return { verdict, sha1: `${result?.sha1 ?? ''}` }
  } catch (error) {
    console.warn('[kanso] 语音探测失败', pathname, error)
    return { verdict: 'error', sha1: '' }
  }
}
