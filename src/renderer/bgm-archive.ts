// BGM 档案的渲染层这一半：把「这个号有没有留下实物」变成一个能同步问的表，
// 并给出实物的本地播放地址。与 renderer/voice-archive、renderer/art-archive 同族。
//
// 判据只认持久档案层，**不认 Chromium 的磁盘缓存**：浏览器缓存会驱逐、
// 超限还整盘丢弃（共享记忆 electron-disk-cache-size）。对 BGM 这一点尤其要紧——
// **活动曲随活动撤场**，缓存被清一次，那几首就再也取不回来了。
import {
  bgmArchiveBlobPath,
  bgmArchiveIdentity,
  type BgmArchiveEntry,
} from '../shared/bgm-archive-plan'
import type { KcsBgmKind } from '../shared/kcs-bgm'

const path = require('path')
const { pathToFileURL } = require('url')
const { ipcRenderer } = require('electron')
const remote = require('@electron/remote')

// 档案根目录只在模块初始化时读一次。放进逐项的判断里就是同步 IPC——
// 海域卷一屏十几个 ♪，那会把界面钉住（同一个坑见 assets/preload/resource-hack.js）。
const ARCHIVE_DIR: string = path.join(remote.getGlobal('APPDATA_PATH'), 'bgm-archive')

/** `kind:id` → 该号下的全部条目（同一个号可能留下多份：官方换过内容） */
let byId = new Map<string, BgmArchiveEntry[]>()
let loading: Promise<void> | null = null
let ready = false
/** 索引换过几回。消费端拿它当记忆的失效戳。 */
let generation = 0

const keyOf = (kind: KcsBgmKind, id: number) => `${kind}:${id}`

const indexEntries = (list: readonly BgmArchiveEntry[]) => {
  const next = new Map<string, BgmArchiveEntry[]>()
  for (const entry of list) {
    const identity = bgmArchiveIdentity(entry.pathname)
    if (!identity) continue
    const key = keyOf(identity.kind, identity.id)
    const bucket = next.get(key) ?? []
    bucket.push(entry)
    next.set(key, bucket)
  }
  byId = next
  generation += 1
}

/** 拉一次全表。之后靠主进程的 `kancolle.bgm.archived` 广播增量更新。 */
export const ensureBgmArchive = (onReady?: () => void): Promise<void> => {
  if (loading) return loading
  loading = (async () => {
    try {
      const list = (await ipcRenderer.invoke('mg:bgm-archive-entries')) as BgmArchiveEntry[]
      indexEntries(Array.isArray(list) ? list : [])
    } catch (_error) {
      // 拉不到就当空档案：♪ 退回现取，功能不塌
      indexEntries([])
    }
    ready = true
    onReady?.()
  })()
  return loading
}

/** 主进程刚留下一首：当场并进索引，不必等下次整表拉取。 */
export const noteBgmArchived = (entry: BgmArchiveEntry | null | undefined): boolean => {
  if (!entry?.pathname) return false
  const identity = bgmArchiveIdentity(entry.pathname)
  if (!identity) return false
  const key = keyOf(identity.kind, identity.id)
  const bucket = byId.get(key) ?? []
  if (bucket.some((known) => known.sha1 === entry.sha1)) return false
  byId.set(key, [...bucket, entry])
  generation += 1
  return true
}

/**
 * 这个号已留下实物的本地播放地址。**只给档案里的实物**，不回退网络——
 * 回退那一步归调用方（它才知道该不该现取、开关关没关）。
 *
 * 同一个号可能留下多份（官方换过内容），取**最近一次听到**的那一份。
 */
export const archivedBgmUrl = (kind: KcsBgmKind, id: number): string | null => {
  const best = (byId.get(keyOf(kind, id)) ?? [])
    .filter((entry) => entry.bytes > 0 && entry.sha1)
    .sort((left, right) => right.lastHeard - left.lastHeard)[0]
  const relative = best ? bgmArchiveBlobPath(best.pathname, best.sha1) : null
  if (!relative) return null
  return pathToFileURL(path.join(ARCHIVE_DIR, ...relative.split('/'))).href
}
