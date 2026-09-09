// 资源档案的纯策略：与立绘互斥，按路径留版本，旧版实物不参与自动淘汰。
import { archiveLimitBytes } from './voice-archive-plan'
import { shouldArchiveArtType } from './art-archive-plan'
export { archiveLimitBytes }

export const ASSET_ARCHIVE_FAMILIES = {
  slot: /^\/kcs2\/resources\/slot\/[a-z0-9_]+\/\d{4}[A-Za-z0-9_.-]*\.png$/,
  useitem: /^\/kcs2\/resources\/useitem\/card\/\d{3}\.png$/,
  furniture: /^\/kcs2\/resources\/furniture\/[a-z0-9_]+\/\d{3}[A-Za-z0-9_.-]*\.png$/,
  map: /^\/kcs2\/resources\/map\/\d{3}\/\d{2}[A-Za-z0-9_.-]*\.(?:png|json)$/,
  common: /^\/kcs2\/img\/common\/common_icon_weapon\.(?:json|png)$/,
  'ship-misc': /^\/kcs2\/resources\/ship\/[a-z0-9_]+\/\d{4}[A-Za-z0-9_.-]*\.png$/,
} as const
export type AssetArchiveFamily = keyof typeof ASSET_ARCHIVE_FAMILIES
export const assetFamilyOf = (pathname: string): AssetArchiveFamily | null => {
  for (const family of Object.keys(ASSET_ARCHIVE_FAMILIES) as AssetArchiveFamily[]) {
    if (!ASSET_ARCHIVE_FAMILIES[family].test(pathname)) continue
    if (family === 'map' && pathname.endsWith('.json') && !/_(?:info|image)\.json$/.test(pathname)) return null
    if (family === 'ship-misc') {
      const matched = /\/ship\/([a-z0-9_]+)\/(\d{4})/.exec(pathname)!
      if (shouldArchiveArtType(Number(matched[2]), matched[1])) return null
    }
    return family
  }
  return null
}

export interface AssetArchiveEntry {
  pathname: string
  family: AssetArchiveFamily
  version: string
  sha1: string
  bytes: number
  firstSeen: number
  lastSeen: number
  seen: number
}
export const ASSET_ARCHIVE_MAX_ENTRY_BYTES = 8 * 1024 * 1024
export const ASSET_ARCHIVE_MAX_BYTES = 0
export const ASSET_ARCHIVE_REQUIRED_FIELDS = ['pathname', 'family', 'version', 'sha1', 'bytes', 'firstSeen', 'lastSeen', 'seen'] as const
export const assetArchiveKey = (pathname: string, sha1: string): string => `${pathname}|${sha1}`
// 主进程与渲染层共用指纹文件名，逐图读取无需同步 IPC。
export const assetArchiveBlobPath = (pathname: string, sha1: string): string | null => {
  const family = assetFamilyOf(pathname)
  if (!family || !/^[0-9a-f]{16}$/.test(sha1)) return null
  const filename = pathname.slice(pathname.lastIndexOf('/') + 1)
  const dot = filename.lastIndexOf('.')
  return `asset/${family}/${filename.slice(0, dot)}.${sha1}.${filename.slice(dot + 1)}`
}
export const sanitizeAssetArchiveEntry = (raw: unknown): AssetArchiveEntry | null => {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const pathname = `${value.pathname ?? ''}`
  const family = assetFamilyOf(pathname)
  const sha1 = `${value.sha1 ?? ''}`
  if (!family || (sha1 && !/^[0-9a-f]{16}$/.test(sha1))) return null
  const rawVersion = `${value.version ?? ''}`
  const num = (input: unknown, max: number) => {
    const parsed = Number(input)
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= max ? Math.floor(parsed) : 0
  }
  return {
    pathname, family, sha1,
    version: /^[\w.-]{1,32}$/.test(rawVersion) ? rawVersion : '',
    bytes: num(value.bytes, ASSET_ARCHIVE_MAX_ENTRY_BYTES),
    firstSeen: num(value.firstSeen, Number.MAX_SAFE_INTEGER),
    lastSeen: num(value.lastSeen, Number.MAX_SAFE_INTEGER),
    seen: Math.max(1, num(value.seen, 1_000_000_000)),
  }
}
export const assetArchiveHasBlobFor = (entries: readonly AssetArchiveEntry[], pathname: string, version: string): boolean =>
  entries.some((entry) => entry.pathname === pathname && entry.bytes > 0 && entry.version === version)

export const assetArchiveUnobtainable = (entries: readonly AssetArchiveEntry[]): Set<string> => {
  const byPath = new Map<string, AssetArchiveEntry[]>()
  for (const entry of entries) {
    const list = byPath.get(entry.pathname) ?? []
    list.push(entry)
    byPath.set(entry.pathname, list)
  }
  const locked = new Set<string>()
  for (const list of byPath.values()) {
    for (const entry of list) {
      if (entry.bytes > 0 && list.some((other) => other.lastSeen > entry.lastSeen &&
        (other.sha1 !== entry.sha1 || other.version !== entry.version))) {
        locked.add(assetArchiveKey(entry.pathname, entry.sha1))
      }
    }
  }
  return locked
}
export const planAssetArchiveEviction = (entries: readonly AssetArchiveEntry[], maxBytes: number | null = ASSET_ARCHIVE_MAX_BYTES): AssetArchiveEntry[] => {
  const limit = archiveLimitBytes(maxBytes)
  if (limit == null) return []
  let remaining = entries.reduce((sum, entry) => sum + Math.max(0, entry.bytes), 0)
  const locked = assetArchiveUnobtainable(entries)
  const candidates = entries.filter((entry) => entry.bytes > 0 && !locked.has(assetArchiveKey(entry.pathname, entry.sha1)))
    .sort((a, b) => a.lastSeen - b.lastSeen || a.seen - b.seen || b.bytes - a.bytes || a.pathname.localeCompare(b.pathname))
  const evicted: AssetArchiveEntry[] = []
  for (const entry of candidates) {
    if (remaining <= limit) break
    evicted.push(entry)
    remaining -= entry.bytes
  }
  return evicted
}
export interface AssetArchiveUsage {
  bytes: number
  kept: number
  seen: number
  families: Record<AssetArchiveFamily, number>
  maxBytes: number | null
  lockedKept: number
  lockedBytes: number
  full: boolean
}
export const assetArchiveUsage = (entries: readonly AssetArchiveEntry[], maxBytes: number | null = ASSET_ARCHIVE_MAX_BYTES): AssetArchiveUsage => {
  const limit = archiveLimitBytes(maxBytes)
  const locked = assetArchiveUnobtainable(entries)
  const usage: AssetArchiveUsage = {
    bytes: 0, kept: 0, seen: 0,
    families: { slot: 0, useitem: 0, furniture: 0, map: 0, common: 0, 'ship-misc': 0 },
    maxBytes: limit, lockedKept: 0, lockedBytes: 0, full: false,
  }
  for (const entry of entries) {
    if (!(entry.bytes > 0)) { usage.seen++; continue }
    usage.bytes += entry.bytes
    usage.kept++
    usage.families[entry.family]++
    if (locked.has(assetArchiveKey(entry.pathname, entry.sha1))) {
      usage.lockedKept++
      usage.lockedBytes += entry.bytes
    }
  }
  const freed = planAssetArchiveEviction(entries, limit).reduce((sum, entry) => sum + entry.bytes, 0)
  usage.full = limit != null && usage.bytes - freed > limit
  return usage
}
