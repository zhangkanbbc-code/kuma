// 慢操作哨兵。
//
// crash.log 只记「抛了异常」的事——卡顿这类慢操作无声无息，出了事翻遍日志
// 一个字都没有（2026-08-13 用户报 5-5 进战斗分三段卡死，日志毫无线索，实锤）。
// 所以这里并排开一条 perf.log：
//
//   1. 渲染层事件分发超过阈值 → 哪个监听器吃了多少毫秒，逐条归因；
//   2. 主进程网络事件处理（记账 + 归约）超过阈值 → 哪条 API 路径；
//   3. **看门狗**：渲染进程挂死（死循环/永久阻塞）时什么都不会再上报——
//      主进程每 10s ping 一次，两个周期无应答就把「最后开跑未完成的监听器」
//      写进日志。挂死前最后一条面包屑就是凶手所在。
//
// 与 crash.log 同一纪律：只记事实（耗时、位置），不推断原因；滚动限流。

import { ipcMain } from 'electron'
import path from 'path'
import type { BrowserWindow } from 'electron'

import { createRollingLog } from './crash-log'
import { APPDATA_PATH } from './env'

const log = createRollingLog(path.join(APPDATA_PATH, 'perf.log'), {
  verbatimTimes: 5,
  summaryEvery: 100,
})

export const appendPerf = (source: string, scope: string, message: string) =>
  log.append(source, scope, message)

const PING_EVERY_MS = 10_000
const HANG_AFTER_MS = 25_000

export const installPerfLogging = (windowOf: () => BrowserWindow | null) => {
  // 渲染层慢分发上报
  ipcMain.on('kanso:perf', (_event, raw: unknown) => {
    const entry = (raw ?? {}) as { scope?: unknown; ms?: unknown; detail?: unknown }
    if (typeof entry.scope !== 'string' || typeof entry.ms !== 'number') return
    log.append(
      'renderer',
      entry.scope,
      `分发耗时 ${Math.round(entry.ms)}ms${typeof entry.detail === 'string' && entry.detail ? ` · 大头：${entry.detail}` : ''}`,
    )
  })

  // 面包屑：每个监听器开跑前报到。只留在内存里，挂死时才落盘。
  let lastBreadcrumb = '(尚无分发记录)'
  let breadcrumbTs = 0
  ipcMain.on('kanso:perf-breadcrumb', (_event, site: unknown) => {
    if (typeof site === 'string' && site) {
      lastBreadcrumb = site
      breadcrumbTs = Date.now()
    }
  })

  // 看门狗：ping 由主进程发起，渲染层收到即回。不用渲染层自开定时器——
  // 页面隐藏时 Chromium 会重度节流定时器，自报心跳会误报挂死；IPC 不受节流。
  let lastAlive = Date.now()
  let hangLogged = false
  ipcMain.on('kanso:perf-alive', () => {
    lastAlive = Date.now()
    hangLogged = false
  })
  const watchdog = setInterval(() => {
    const win = windowOf()
    if (!win || win.isDestroyed()) return
    try {
      win.webContents.send('kanso:perf-ping')
    } catch {
      return
    }
    const silent = Date.now() - lastAlive
    if (silent > HANG_AFTER_MS && !hangLogged) {
      hangLogged = true
      const crumbAge = breadcrumbTs ? `（${Math.round((Date.now() - breadcrumbTs) / 1000)}s 前开跑）` : ''
      log.append(
        'watchdog',
        'renderer-hang',
        `渲染进程 ${Math.round(silent / 1000)}s 无应答；最后开跑未完成的监听器：${lastBreadcrumb}${crumbAge}`,
      )
    }
  }, PING_EVERY_MS)
  watchdog.unref?.()
}
