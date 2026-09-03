// 渲染层慢分发计时（perf-log 的渲染侧半边）。
//
// 症状是「界面/游戏画面一顿一顿」时，crash.log 帮不上忙——没有异常，
// 只有某个监听器把主线程占了几百毫秒。这里给内核的事件分发计时：
// 超过阈值就把逐监听器的耗时归因上报主进程落盘（perf.log）。
//
// 归因用**注册点**（onMgChange 调用处的栈行）：监听器都是匿名箭头函数，
// cb.name 一律为空；注册栈行直指模块文件与行号，够定位。
//
// 面包屑：每个监听器开跑前先报到主进程。正常时只是内存变量的覆盖写；
// 一旦渲染进程挂死（死循环），最后一条面包屑就是看门狗要写进日志的凶手。
//
// 长任务：同步分发返回后的样式重算、排版、绘制与合成不在分发计时里，
// 由浏览器的 longtask 观测补上整段主线程占用。

import { recordCrash } from './crash-guard'

const { ipcRenderer } = require('electron')

// 看门狗的 ping 由主进程发起（页面隐藏时渲染层定时器被节流，自报会误报），
// 收到即回，证明事件循环还活着。
ipcRenderer.on('kanso:perf-ping', () => {
  try {
    ipcRenderer.send('kanso:perf-alive')
  } catch {
    /* 窗口正在关闭时放弃应答 */
  }
})

const configuredSlowDispatchMs = Number(process.env.KANSO_PERF_SLOW_MS)
const configuredPartMs = Number(process.env.KANSO_PERF_PART_MS)
const configuredLongTaskMs = Number(process.env.KANSO_PERF_LONGTASK_MS)

// 诊断会话可调低阈值；未设置或值无效时保持默认阈值不变。
/** 分发总耗时超过这个数才上报——单帧预算 16ms，偶发 2-3 帧的尖刺不值得记 */
const SLOW_DISPATCH_MS =
  Number.isFinite(configuredSlowDispatchMs) && configuredSlowDispatchMs > 0
    ? configuredSlowDispatchMs
    : 80
/** 单个监听器至少吃掉这么多毫秒才进「大头」清单 */
const PART_MS =
  Number.isFinite(configuredPartMs) && configuredPartMs > 0 ? configuredPartMs : 8
/** 50ms 是长任务的通行门槛：一帧 16ms，超过三帧就是肉眼可见的卡顿；默认值高于诊断会话的 20ms / 4ms */
const LONGTASK_MS =
  Number.isFinite(configuredLongTaskMs) && configuredLongTaskMs > 0
    ? configuredLongTaskMs
    : 50

type KansoTaskAttribution = {
  readonly name: string
  readonly containerType: string
  readonly containerSrc: string
  readonly containerId: string
  readonly containerName: string
}

type KansoLongTaskEntry = PerformanceEntry & {
  readonly attribution: readonly KansoTaskAttribution[]
}

try {
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.duration < LONGTASK_MS) continue
      const detail = (entry as KansoLongTaskEntry).attribution
        .map((item) => {
          const container = `${item.containerType}${item.containerId ? `#${item.containerId}` : ''}`
          return [container, item.containerName, item.containerSrc, item.name]
            .filter(Boolean)
            .join(' · ')
        })
        .filter(Boolean)
        .join(' / ')
      ipcRenderer.send('kanso:perf', { scope: 'longtask', ms: entry.duration, detail })
    }
  }).observe({ entryTypes: ['longtask'] })
} catch {
  // entryType 不受支持时 observe 会抛；抓住是为了不让 perf-guard 模块求值整个失败——它同时还管着看门狗应答。
}

/**
 * 给异步回程、rAF 与被动补渲这类单次工作计时；阈值与同步分发共用，
 * 诊断会话调低 KANSO_PERF_SLOW_MS 时两层会一起现形。
 */
export const timedRun = (scope: string, run: () => void): void => {
  try {
    ipcRenderer.send('kanso:perf-breadcrumb', scope)
  } catch {
    /* IPC 不可用时面包屑作罢，计时照常 */
  }
  const startedAt = performance.now()
  try {
    run()
  } catch (error) {
    recordCrash(scope, error)
  }
  const ms = performance.now() - startedAt
  if (ms >= SLOW_DISPATCH_MS) {
    try {
      ipcRenderer.send('kanso:perf', { scope, ms, detail: '' })
    } catch {
      /* 同上 */
    }
  }
}

/**
 * 与 safeEach 同语义（逐个跑、互不牵连、错误记账），外加计时与归因。
 * @param siteOf 监听器 → 注册点描述（kernel 在注册时捕获）
 */
export const timedEach = <T>(
  scope: string,
  items: readonly T[],
  siteOf: (item: T) => string,
  fn: (item: T) => void,
): number => {
  const startedAt = performance.now()
  const parts: { site: string; ms: number }[] = []
  let failed = 0
  for (const item of items) {
    const site = siteOf(item)
    try {
      ipcRenderer.send('kanso:perf-breadcrumb', `${scope} → ${site}`)
    } catch {
      /* IPC 不可用时面包屑作罢，计时照常 */
    }
    const itemStart = performance.now()
    try {
      fn(item)
    } catch (error) {
      failed += 1
      recordCrash(scope, error)
    }
    const ms = performance.now() - itemStart
    if (ms >= PART_MS) parts.push({ site, ms })
  }
  const total = performance.now() - startedAt
  if (total >= SLOW_DISPATCH_MS) {
    const detail = parts
      .sort((left, right) => right.ms - left.ms)
      .slice(0, 6)
      .map((part) => `${part.site} ${part.ms.toFixed(0)}ms`)
      .join(' · ')
    try {
      ipcRenderer.send('kanso:perf', { scope, ms: total, detail })
    } catch {
      /* 同上 */
    }
  }
  return failed
}

/** 注册点捕获：调用方（注册 API）的上一层栈行。 */
export const captureListenerSite = (): string => {
  const stack = new Error().stack ?? ''
  // 0: Error / 1: captureListenerSite / 2: 注册 API（onMgChange 等）/ 3: 真正的调用方
  const line = stack.split('\n')[3]?.trim() ?? ''
  return line.replace(/^at\s+/, '').replace(/^.*[\\/](?=[^\\/]+:\d)/, '') || '未知注册点'
}
