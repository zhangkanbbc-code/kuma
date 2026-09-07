// 慢操作哨兵。
//
// crash.log 只记「抛了异常」的事——卡顿这类慢操作无声无息，出了事翻遍日志
// 一个字都没有（2026-08-13 用户报 5-5 进战斗分三段卡死，日志毫无线索，实锤）。
// 所以这里并排开一条 perf.log：
//
//   1. 渲染层事件分发超过阈值 → 哪个监听器吃了多少毫秒，逐条归因；
//   2. 主进程网络事件处理（记账 + 归约）超过阈值 → 哪条 API 路径；
//   3. **看门狗**：渲染进程挂死（死循环/永久阻塞）时什么都不会再上报——
//      主进程每 10s ping 一次，超过 25s 无应答就记录最近执行位置。
//      面包屑没有完成标记，不能把最后执行过的回调认定为阻塞来源。
//
// 与 crash.log 同一纪律：只记事实（耗时、位置），不推断原因；滚动限流。

import { ipcMain } from 'electron'
import path from 'path'
import { monitorEventLoopDelay, PerformanceObserver } from 'perf_hooks'
import type { BrowserWindow } from 'electron'

import { createRollingLog } from './crash-log'
import { APPDATA_PATH } from './env'
import { readEnv } from '../shared/env-names'
import { reportMainTiming, setMainTimingSink } from './perf-time'

const log = createRollingLog(path.join(APPDATA_PATH, 'perf.log'), {
  verbatimTimes: 5,
  summaryEvery: 100,
})

export const appendPerf = (source: string, scope: string, message: string) =>
  log.append(source, scope, message)

// perf.log 会由玩家交给维护者；IPC detail 中的会话凭据必须在落盘前隐去。
export const redactPerfDetail = (detail: string): string =>
  detail.replace(/\b(?:api_token|token)=[^&\s]*/g, 'api_token=［已隐去］')

const PING_EVERY_MS = 10_000
const HANG_AFTER_MS = 25_000

export const installPerfLogging = (windowOf: () => BrowserWindow | null) => {
  setMainTimingSink(({ scope, ms, detail }) => {
    log.append('main', scope, `耗时 ${ms.toFixed(1)}ms${detail ? ` · ${detail}` : ''}`)
  })
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        reportMainTiming('gc', entry.duration, () => {
          const { kind, flags } = (entry as import('perf_hooks').PerformanceEntry & {
            detail: { kind: number; flags: number }
          }).detail
          return `kind ${kind} · flags ${flags}`
        })
      }
    }).observe({ entryTypes: ['gc'] })
  } catch (_unsupportedGcObserver) {
    // 此运行时不支持 GC 观测时跳过该探针，IPC、事件循环与看门狗继续工作。
  }

  // 渲染层慢分发上报
  ipcMain.on('kuma:perf', (_event, raw: unknown) => {
    const entry = (raw ?? {}) as { source?: unknown; scope?: unknown; ms?: unknown; detail?: unknown }
    if (typeof entry.scope !== 'string' || typeof entry.ms !== 'number') return
    log.append(
      entry.source === 'game' ? 'game' : 'renderer',
      entry.scope,
      `${entry.scope === 'longtask' ? '长任务' : '分发耗时'} ${Math.round(entry.ms)}ms${typeof entry.detail === 'string' && entry.detail ? ` · 大头：${redactPerfDetail(entry.detail)}` : ''}`,
    )
  })

  // 面包屑：每个监听器开跑前报到。只留在内存里，挂死时才落盘。
  let lastBreadcrumb = '(尚无分发记录)'
  let breadcrumbTs = 0
  ipcMain.on('kuma:perf-breadcrumb', (_event, site: unknown) => {
    if (typeof site === 'string' && site) {
      lastBreadcrumb = site
      breadcrumbTs = Date.now()
    }
  })

  // 看门狗：ping 由主进程发起，渲染层收到即回。不用渲染层自开定时器——
  // 页面隐藏时 Chromium 会重度节流定时器，自报心跳会误报挂死；IPC 不受节流。
  let lastAlive = Date.now()
  let hangLogged = false
  ipcMain.on('kuma:perf-alive', () => {
    lastAlive = Date.now()
    hangLogged = false
  })
  const configuredLongTaskMs = Number(readEnv('KUMA_PERF_LONGTASK_MS'))
  const longTaskMs =
    Number.isFinite(configuredLongTaskMs) && configuredLongTaskMs > 0
      ? configuredLongTaskMs
      : 50
  const loopDelay = monitorEventLoopDelay({ resolution: 10 })
  loopDelay.enable()
  const watchdog = setInterval(() => {
    // 纳秒转毫秒；即使没有窗口，也要按拍记录并清空本轮直方图。
    const max = loopDelay.max / 1e6
    const p99 = loopDelay.percentile(99) / 1e6
    const mean = loopDelay.mean / 1e6
    if (max >= longTaskMs) {
      log.append(
        'main',
        'loop-lag',
        `10s 内事件循环最大延迟 ${max.toFixed(1)}ms · p99 ${p99.toFixed(1)}ms · 均值 ${mean.toFixed(1)}ms（采样分辨率 10ms）`,
      )
    }
    loopDelay.reset()
    const win = windowOf()
    if (!win || win.isDestroyed()) return
    // 进程退出已有 crash.log 记录，不再把同一事故报成一次存活进程挂死。
    // 等待重载期间重置心跳基线，避免新渲染进程继承旧实例的无应答时长。
    if (win.webContents.isCrashed()) {
      lastAlive = Date.now()
      hangLogged = false
      lastBreadcrumb = '(尚无分发记录)'
      breadcrumbTs = 0
      return
    }
    try {
      win.webContents.send('kuma:perf-ping')
    } catch {
      return
    }
    const silent = Date.now() - lastAlive
    if (silent > HANG_AFTER_MS && !hangLogged) {
      hangLogged = true
      const crumbAge = breadcrumbTs ? `（${Math.round((Date.now() - breadcrumbTs) / 1000)}s 前记录）` : ''
      log.append(
        'watchdog',
        'renderer-hang',
        `渲染进程 ${Math.round(silent / 1000)}s 无应答；最近执行位置：${lastBreadcrumb}${crumbAge}（不代表该回调仍未完成）`,
      )
    }
  }, PING_EVERY_MS)
  watchdog.unref?.()
}
