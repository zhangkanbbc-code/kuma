import { app, crashReporter } from 'electron'
import fs from 'fs'
import path from 'path'
import { APPDATA_PATH, KUMA_VERSION } from './env'
import { safeConsole } from './crash-log'
import { readEnv } from '../shared/env-names'
import type { CrashDumpSummary } from '../shared/crash-context'

// 2026-09-07：三次原生崩溃 exit=-36861 / -2147483645 / -1073741819，
// reason 都是 crashed，却没有一份 dump，单凭退出码无法定位原生栈。
// uploadToServer:false 且没有上报地址：Crashpad 只落本地文件，不发上传请求。
// 本机 Electron 类型文档确认关闭上传时无需地址，且必须早于子进程创建。
// 会多一个 --type=crashpad-handler 子进程；kuma-processes.mjs 按 --type= 分类，
// 退出守卫的 taskkill /T 按进程树收尾。其正常退出行为留待正常启动/退出核验。
export const installCrashDumps = () => {
  if (readEnv('KUMA_CRASH_DUMPS') === '0') return
  // setPath 的本机类型文档要求目录已存在；只在应用启动时创建，跟随数据目录覆盖。
  fs.mkdirSync(path.join(APPDATA_PATH, 'crash-dumps'), { recursive: true })
  app.setPath('crashDumps', path.join(APPDATA_PATH, 'crash-dumps'))
  crashReporter.start({
    productName: 'kuma',
    uploadToServer: false,
    rateLimit: false,
    compress: false,
    extra: { kumaVersion: KUMA_VERSION },
  })
  safeConsole('warn', '[kuma] 崩溃转储：本地目录，不上传')
}

export const summarizeCrashDumps = (sinceTs: number): CrashDumpSummary => {
  const summary: CrashDumpSummary = { count: 0 }
  if (readEnv('KUMA_CRASH_DUMPS') === '0') return summary
  // 本机 Electron 文档约定 crashDumps 根目录，但未承诺内部布局；当前 kuma
  // 尚无转储目录，本次不启动应用，因此不把 reports/、pending/ 写成实测结论。
  // Windows Crashpad 的 reports/ 及其它平台/版本的 pending/ 等子目录均递归扫描，
  // 不把 pending 当作“将会上报”的证据：本应用已关闭上传。
  const visit = (dir: string) => {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name)
        if (entry.isDirectory()) visit(file)
        else if (entry.isFile() && entry.name.toLowerCase().endsWith('.dmp')) {
          const stat = fs.statSync(file)
          if (stat.mtimeMs < sinceTs - 1000) continue
          summary.count++
          if (!summary.latest || stat.mtimeMs > summary.latest.mtime) {
            summary.latest = { name: entry.name, size: stat.size, mtime: stat.mtimeMs }
          }
        }
      }
    } catch (error) {
      // 未落盘时目录可不存在；其它读取失败走安全打印，不能让诊断回调再抛异常。
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        safeConsole('warn', '[kuma] 崩溃转储清单读取失败', error)
      }
    }
  }
  visit(app.getPath('crashDumps'))
  return summary
}
