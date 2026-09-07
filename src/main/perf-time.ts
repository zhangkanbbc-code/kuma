// 计时底座不依赖 env/crash-log/atomic-json 等主进程业务模块，避免落盘链成环。
// sink 安装前只计时、不落日志；detail 也只在真正需要记录时求值。
import { ipcMain } from 'electron'
import { readEnv } from '../shared/env-names'

export interface MainTiming {
  scope: string
  ms: number
  detail: string
}

let sink: ((entry: MainTiming) => void) | undefined

export const setMainTimingSink = (next: typeof sink) => { sink = next }

export const mainLongTaskMs = (): number => {
  const configured = Number(readEnv('KUMA_PERF_LONGTASK_MS'))
  return Number.isFinite(configured) && configured > 0 ? configured : 50
}

export const reportMainTiming = (scope: string, ms: number, detail?: () => string): void => {
  if (!sink || ms < mainLongTaskMs()) return
  try {
    sink({ scope, ms, detail: detail?.() ?? '' })
  } catch (_diagnosticError) {
    // 诊断失败只丢弃这一条，不能覆盖业务返回值或原始异常，也不能递归写日志。
  }
}

export const timeMain = <T>(scope: string, fn: () => T, detail?: () => string): T => {
  const started = performance.now()
  try {
    return fn()
  } finally {
    reportMainTiming(scope, performance.now() - started, detail)
  }
}

// IPC 允许同步返回，也允许普通函数返回 Promise，不能只靠 async 声明识别。
// Promise 的同步段与落定总时长各自过阈值；同步返回/抛错仍沿用原 scope。
export const timeMainAsync = <T>(scope: string, fn: () => T, detail?: () => string): T => {
  const started = performance.now()
  let result: T
  try {
    result = fn()
  } catch (error) {
    reportMainTiming(scope, performance.now() - started, detail)
    throw error
  }
  const syncMs = performance.now() - started
  const pending = result as unknown as PromiseLike<unknown> | null | undefined
  if (pending && typeof pending.then === 'function') {
    reportMainTiming(`${scope}:sync`, syncMs, detail)
    return pending.then(
      (value) => {
        reportMainTiming(`${scope}:total`, performance.now() - started, detail)
        return value
      },
      (error) => {
        reportMainTiming(`${scope}:total`, performance.now() - started, detail)
        throw error
      },
    ) as T
  }
  reportMainTiming(scope, syncMs, detail)
  return result
}

const argumentSize = (args: unknown[]): string => {
  let bytes = 0
  let objects = false
  for (const arg of args) {
    if (arg instanceof Uint8Array) bytes += arg.byteLength
    else if (typeof arg === 'string') bytes += arg.length
    else objects = true
  }
  return `入参约 ${bytes} 字节${objects ? ' · 对象' : ''}`
}

type IpcListener = (event: any, ...args: any[]) => any
const wrapIpc = (channel: string, listener: IpcListener): IpcListener => {
  const wrapped = function (this: unknown, event: unknown, ...args: unknown[]) {
    return timeMainAsync(`ipc:${channel}`, () => listener.call(this, event, ...args), () => argumentSize(args))
  }
  // EventEmitter 用 listener 字段识别原监听器，保留 removeListener/off/once 的语义。
  wrapped.listener = listener
  return wrapped
}

// 普通 Node 中 electron 导出可执行文件路径，没有 ipcMain；纯落盘单测仍可加载底座。
if (ipcMain) {
  const handle = ipcMain.handle
  const on = ipcMain.on
  ipcMain.handle = function (channel, listener) {
    return handle.call(this, channel, wrapIpc(channel, listener))
  }
  ipcMain.on = function (channel, listener) {
    return on.call(this, channel, wrapIpc(channel, listener))
  }
}
