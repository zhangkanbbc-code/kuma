// 崩溃日志落盘。
//
// 正式包里 DevTools 是关的，console 输出没人看得到——出了事只能看着界面不动干瞪眼。
// 所以渲染层的每一条崩溃记录、主进程的未捕获异常、以及 Chromium 报上来的
// 「渲染/GPU/工具进程没了」，全都追加到 %APPDATA%/kanso/crash.log。
//
// 只记事实：时间、来源、错误原文与调用栈。不做「大概是 XX 引起的」这类推断，
// 也不上报任何地方——这是本机的一份排查线索，不是遥测。

import { app, ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'

import { APPDATA_PATH, DATA_DIR_MIGRATION_ERROR, KANSO_VERSION } from './env'

const LOG_PATH = path.join(APPDATA_PATH, 'crash.log')
/** 超过这个大小就只保留后半段：日志是给人翻的，涨到几十兆就没人翻了。 */
const MAX_BYTES = 512 * 1024

export interface CrashEntry {
  source: string // 'renderer' | 'main' | 'render-process-gone' | ...
  scope: string
  message: string
  stack?: string | null
  ts?: number
}

const stamp = (ts: number) => {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// 打印本身是会抛的。打包版是 GUI 子系统，stdout 常常根本没有接收方；
// 父进程一退，console.error 就抛 EPIPE。**错误处理里裸调 console 是自激循环的引信**：
// EPIPE → uncaughtException → handler 里 console.error → 又 EPIPE → …
// 2026-08-07 实测把 crash.log 刷到 606MB、170 万条同样的记录、进程空转不退。
// 一旦发现 stdout 断了就永久闭嘴——它不会自己好起来。
let stdoutDead = false
export const safeConsole = (level: 'error' | 'warn', ...args: unknown[]) => {
  if (stdoutDead) return
  try {
    console[level](...args)
  } catch {
    stdoutDead = true
  }
}

// key 里的可变部分（URL、数字、十六进制地址）要归一：message 带时间戳/URL 的错误
// （render-process-gone 的 message 就是 URL）每条 key 都不同，限流一次都拦不住，
// seen 还会无界膨胀。
const normalizeKey = (text: string) =>
  text
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/0x[0-9a-fA-F]+/g, '<hex>')
    .replace(/\d[\d,.]*/g, '<n>')
    .slice(0, 300)
const SEEN_CAP = 500 // 归一化后仍超限说明记录种类本身失控，一半一半地腾

/**
 * 滚动日志的通用骨架：体积超限截半、同类条目限流。crash.log 与 perf.log
 * 共用这一份纪律——两边都是「坏掉/变慢的东西会**继续被调用**」，
 * 不限流的日志几分钟就没法看了（crash.log 实测被刷到过 606MB）。
 */
export const createRollingLog = (
  filePath: string,
  options: { verbatimTimes: number; summaryEvery: number },
) => {
  let sinceTrimCheck = 0
  const seen = new Map<string, number>()
  const trimIfHuge = () => {
    // 每 200 次写入查一次大小。从前只在启动时查一次，于是运行中被刷爆时毫无办法。
    if (sinceTrimCheck-- > 0) return
    sinceTrimCheck = 200
    try {
      const { size } = fs.statSync(filePath)
      if (size <= MAX_BYTES) return
      const tail = fs.readFileSync(filePath).subarray(size - MAX_BYTES / 2)
      fs.writeFileSync(filePath, `（早于此处的记录因体积超限已截断）\n${tail.toString('utf8')}`)
    } catch {
      /* 文件不存在或读不动：下面的 appendFileSync 会重建 */
    }
  }
  return {
    append(source: string, scope: string, message: string, stack?: string | null, ts?: number) {
      const at = ts ?? Date.now()
      const key = `${source} ${scope} ${normalizeKey(message)}`
      if (!seen.has(key) && seen.size >= SEEN_CAP) {
        let toDrop = SEEN_CAP >> 1
        for (const staleKey of seen.keys()) {
          if (toDrop-- <= 0) break
          seen.delete(staleKey)
        }
      }
      const count = (seen.get(key) ?? 0) + 1
      seen.set(key, count)
      if (count > options.verbatimTimes && count % options.summaryEvery !== 0) return

      const head = `[${stamp(at)}] ${source} · ${scope} · v${KANSO_VERSION}`
      const block =
        count <= options.verbatimTimes
          ? `${head}\n${message}\n${stack ? `${stack}\n` : ''}\n`
          : `${head}\n${message}（同一条已累计 ${count} 次）\n\n`
      try {
        fs.mkdirSync(APPDATA_PATH, { recursive: true })
        trimIfHuge()
        fs.appendFileSync(filePath, block)
      } catch (error) {
        // 日志写不下去只能认了——但绝不能因此再抛一次，那会把「有个模块出错」
        // 升级成「错误处理本身把进程带走了」。
        safeConsole('error', `[kanso] ${path.basename(filePath)} 写入失败`, error)
      }
    },
  }
}

// 同一条错误反复出现只写有限几次（前 3 次原样，之后每 500 次汇总一条）。
const crashLog = createRollingLog(LOG_PATH, { verbatimTimes: 3, summaryEvery: 500 })

export const appendCrash = (entry: CrashEntry) =>
  crashLog.append(entry.source, entry.scope, entry.message, entry.stack, entry.ts)

/**
 * 主进程未捕获异常/未处理拒绝的统一入口。
 * 不退出——被动只读的工具进程活着比干净地死掉有用，但必须留下痕迹。
 * 注意这里**先落盘再打印**：打印是会抛的那一个，落盘不能被它连累。
 */
export const reportFatal = (scope: string, reason: unknown) => {
  const error = reason instanceof Error ? reason : new Error(String(reason))
  const broken = error.message.includes('EPIPE') || error.message.includes('EBADF')
  appendCrash({
    source: 'main',
    scope,
    message: broken ? `${error.message}（标准输出已断开，后续不再向控制台打印）` : error.message,
    stack: error.stack,
  })
  if (broken) stdoutDead = true // 再往 console 写只会引来下一次同样的异常
  safeConsole('error', `[kanso] ${scope}`, error.stack)
}

export const installCrashLogging = () => {
  // 改名首启的数据目录搬迁没搬动。数据一个字节都没丢（这一次仍旧读写旧目录），
  // 但目录名与产品名对不上，下次启动还会再试一次——原因留在这里可查。
  if (DATA_DIR_MIGRATION_ERROR) {
    appendCrash({
      source: 'main',
      scope: 'data-dir-migrate',
      message: DATA_DIR_MIGRATION_ERROR,
      stack: null,
    })
  }

  // 渲染层送上来的：来自 crash-guard 的记账
  ipcMain.on('kanso:crash', (_event, raw: unknown) => {
    const e = (raw ?? {}) as Partial<CrashEntry>
    if (typeof e.message !== 'string') return
    appendCrash({
      source: 'renderer',
      scope: typeof e.scope === 'string' ? e.scope : '(未标注)',
      message: e.message,
      stack: typeof e.stack === 'string' ? e.stack : null,
      ts: typeof e.ts === 'number' ? e.ts : undefined,
    })
  })

  ipcMain.handle('kanso:crash-log-path', () => LOG_PATH)

  // 承载整个工作台的那个渲染进程真的没了。以前主进程完全不知道这件事：
  // 界面一片空白，日志里一个字都没有。
  app.on('render-process-gone', (_event, contents, details) => {
    const url = (() => {
      try {
        return contents.getURL()
      } catch {
        return '(已销毁)'
      }
    })()
    appendCrash({
      source: 'render-process-gone',
      scope: `${details.reason}${details.exitCode != null ? ` exit=${details.exitCode}` : ''}`,
      message: url,
      stack: null,
    })
    safeConsole('error', `[kanso] 渲染进程结束：${details.reason} ${url}`)
  })

  // GPU / 工具进程。这类多半能自愈，但它是花屏、音频失灵一类怪象的根，值得留痕。
  app.on('child-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return
    appendCrash({
      source: 'child-process-gone',
      scope: `${details.type}/${details.reason}`,
      message: details.name ?? details.type,
      stack: null,
    })
  })
}
