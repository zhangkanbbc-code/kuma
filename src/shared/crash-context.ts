// 崩溃现场的内存备忘与显示口径；不依赖 Electron，也不访问文件或网络。
export interface MemorySample {
  ts: number
  // performance.memory 使用字节；Electron getProcessMemoryInfo 使用 KB。
  jsHeapUsed?: number
  jsHeapTotal?: number
  residentSet?: number
  private?: number
}

export const createMemoryTrail = (cap: number) => {
  const samples: MemorySample[] = []
  return {
    push(sample: MemorySample) {
      // 同一次 ping 的同步堆数据与异步进程数据合占一格；迟到补报不挤掉新样本。
      const index = samples.findIndex((entry) => entry.ts === sample.ts)
      if (index >= 0) samples[index] = { ...samples[index], ...sample }
      else samples.push({ ...sample })
      samples.sort((a, b) => a.ts - b.ts)
      if (samples.length > cap) samples.splice(0, samples.length - cap)
    },
    list: (): MemorySample[] => samples.map((sample) => ({ ...sample })),
  }
}

const ageSeconds = (ts: number, now: number) => Math.max(0, Math.round((now - ts) / 1000))
const heapMB = (bytes: number) => Math.round(bytes / 1024 / 1024)
const processMB = (kb: number) => Math.round(kb / 1024)

export const formatMemoryTrail = (samples: readonly MemorySample[], now: number): string =>
  samples.length
    ? samples.map((sample) => {
        const parts: string[] = []
        if (sample.private !== undefined) parts.push(`私有 ${processMB(sample.private)} MB`)
        if (sample.residentSet !== undefined) parts.push(`常驻 ${processMB(sample.residentSet)} MB`)
        if (sample.jsHeapUsed !== undefined || sample.jsHeapTotal !== undefined) {
          const used = sample.jsHeapUsed === undefined ? '?' : heapMB(sample.jsHeapUsed)
          const total = sample.jsHeapTotal === undefined ? '?' : heapMB(sample.jsHeapTotal)
          parts.push(`JS 堆 ${used}/${total} MB`)
        }
        return `-${ageSeconds(sample.ts, now)}s ${parts.join(' · ') || '（内存指标不可用）'}`
      }).join('\n')
    : '（尚无内存样本）'

export interface LastApiEntry { path: string; ts: number }

export const createLastApiMemo = () => {
  const entries: LastApiEntry[] = []
  return {
    push({ path, ts }: LastApiEntry) {
      // 只记 pathname；查询串可能含会话凭据，不能进入崩溃日志。
      entries.push({ path: path.split('?')[0], ts })
      if (entries.length > 3) entries.shift()
    },
    list: (): LastApiEntry[] => entries.map((entry) => ({ ...entry })),
  }
}

export const formatLastApis = (entries: readonly LastApiEntry[], crashTs: number): string =>
  entries.length
    ? entries.map((entry) => `${entry.path} ${ageSeconds(entry.ts, crashTs)}s 前`).join('\n')
    : '（尚无报文记录）'

export const formatLastBreadcrumb = (info: { lastBreadcrumb: string; breadcrumbTs: number }, crashTs: number): string =>
  `${info.lastBreadcrumb}${info.breadcrumbTs ? `（${ageSeconds(info.breadcrumbTs, crashTs)}s 前记录）` : ''}（不代表该回调仍未完成）`

export interface CrashDumpSummary {
  count: number
  latest?: { name: string; size: number; mtime: number }
}

export const formatCrashDumps = (summary: CrashDumpSummary): string =>
  summary.count && summary.latest
    ? `崩溃转储 ${summary.count} 个：${summary.latest.name} ${(summary.latest.size / 1024 / 1024).toFixed(1)} MB`
    : '崩溃前后没有新转储'
