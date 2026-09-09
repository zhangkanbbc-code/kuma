// 资源索引启动时异步取一次，逐图只查内存并计算本地文件地址。
import { assetArchiveBlobPath, type AssetArchiveEntry } from '../shared/asset-archive-plan'
const path = require('path')
const { pathToFileURL } = require('url')
const { ipcRenderer } = require('electron')
const remote = require('@electron/remote')
const ARCHIVE_DIR: string = path.join(remote.getGlobal('APPDATA_PATH'), 'asset-archive')
let byPathname = new Map<string, AssetArchiveEntry>()
let loading: Promise<void> | null = null
let ready = false
let listening = false
const changed = () => document.dispatchEvent(new CustomEvent('kuma:asset-archive-change'))
export const noteAssetArchived = (entry: AssetArchiveEntry): boolean => {
  if (!entry?.pathname || !entry.sha1 || !(entry.bytes > 0)) return false
  const known = byPathname.get(entry.pathname)
  if (known && known.lastSeen > entry.lastSeen) return false
  byPathname.set(entry.pathname, entry)
  return !known || known.sha1 !== entry.sha1
}
export const loadAssetArchive = (): Promise<void> => {
  if (!listening) {
    listening = true
    const broadcaster = remote.require('./game-api-broadcaster')
    broadcaster.addListener('kancolle.asset.archived', (entry: AssetArchiveEntry) => {
      if (noteAssetArchived(entry)) changed()
    })
    broadcaster.addListener('kancolle.asset.cleared', () => {
      byPathname = new Map()
      changed()
    })
  }
  loading ??= (ipcRenderer.invoke('mg:asset-archive-entries') as Promise<AssetArchiveEntry[]>)
    .then((entries) => {
      // 拉表期间可能已收到增量；按 lastSeen 合并，不能拿旧快照覆盖新到的实物。
      for (const entry of Array.isArray(entries) ? entries : []) noteAssetArchived(entry)
      ready = true
      changed()
    })
    .catch((error: unknown) => {
      loading = null
      console.warn('[kuma] 资源档案索引读取失败', error)
    })
  return loading
}
export const assetArchiveReady = (): boolean => ready
export const archivedAssetUrlForPath = (pathname: string): string | null => {
  const entry = byPathname.get(pathname)
  if (!entry) return null
  const relative = assetArchiveBlobPath(pathname, entry.sha1)
  return relative ? pathToFileURL(path.join(ARCHIVE_DIR, ...relative.split('/'))).href : null
}
