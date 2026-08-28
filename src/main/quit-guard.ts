// 退出兜底：确保子进程跟着主进程一起走。
//
// 实测过四次：艦素退出后 %APPDATA% 与 release 目录仍被占用（打包报 EPERM）。
// 残留的永远是同一种东西——`--type=renderer` 的 webview guest：无窗口、父 PID 已死。
// CloseMainWindow 对它无效（没有窗口句柄）。
//
// 三道防线，各堵一种形态：
//   ① 主进程自己卡住 → before-quit 起 4 秒定时器，超时 taskkill /T 收整棵树；
//   ② 上次崩溃留下的孤儿 → 拿到单实例锁之后按映像名清一遍；
//   ③ 主进程正常退出、渲染进程卡死 → 在主进程活着的最后一刻（'quit'）逐个
//      TerminateProcess。这一条的关键不在杀，而在**名单从哪来**：
//      渲染进程的 PID 必须在它出生时就记下。等到退出时再问，谁都不认得它了
//      （2026-08-20 实测：关窗那条路上 getAllWebContents() 是空的，
//      getAppMetrics() 里也已经没有那个 guest，可进程还活着——见下面 installQuitGuard）。
//
// 端到端验收：`npm run quit:e2e`（打包产物 + 真关窗 + 数进程）。
// 这类东西单元测试盯不住，源码形状的护栏只拦「代码被改回去」。

import { execFileSync, spawn } from 'child_process'
import path from 'path'

import { app, webContents } from 'electron'

import { appendCrash, safeConsole } from './crash-log'
import { DATA_DIR_OVERRIDDEN } from './env'
import { parseTasklistPids } from '../shared/process-reap'

// 「开火才写日志」是个盲区：防线跑了但认为无人存活，日志同样是空的，
// 于是「没运行」和「运行了没杀」分不开——2026-08-20 排查第四种形态时就卡在这里
// （crash.log 自防线上线起一条没有）。正式运行仍然只记异常（见下面几处 appendCrash），
// 详细流水挂在环境开关上，端到端脚本打开它，用户日常跑不会看到一个字。
const QUIT_TRACE = Boolean(process.env.KANSO_QUIT_TRACE)
const trace = (message: string) => {
  if (!QUIT_TRACE) return
  appendCrash({ source: 'main', scope: 'quit-guard-trace', message, ts: Date.now() })
}

/** 追踪用：Chromium 自己那本子进程账（含没有 webContents 的渲染进程）。 */
const describeAppMetrics = () => {
  try {
    return app
      .getAppMetrics()
      .map((m) => `${m.pid}:${m.type}${m.name ? `(${m.name})` : ''}`)
      .join(' ')
  } catch (error) {
    return `getAppMetrics 抛错：${String(error)}`
  }
}

/** 追踪用：Electron 认得的 webContents 与它们各自落在哪个进程。 */
const describeWebContents = () => {
  try {
    return webContents
      .getAllWebContents()
      .map((contents) => {
        const at = (fn: () => unknown) => {
          try {
            return String(fn())
          } catch {
            return '?'
          }
        }
        const state = contents.isDestroyed() ? 'destroyed' : 'alive'
        return `${at(() => contents.getOSProcessId())}:${at(() => contents.getType())}:${state}:${at(() => contents.getURL()).slice(0, 70)}`
      })
      .join(' | ')
  } catch (error) {
    return `getAllWebContents 抛错：${String(error)}`
  }
}

// 「必须执行」的退出收尾（备份恢复、缓存急救）本来只挂在 will-quit 上，
// 而硬退如果走 app.exit 则不触发 will-quit——兜底一旦发生，用户已被告知「恢复成功」，
// 实际根本没执行。挂到这里的动作要求幂等，硬退前会被补跑一遍。
const criticalQuitWork: (() => void)[] = []
export const registerCriticalQuitWork = (work: () => void) => {
  criticalQuitWork.push(work)
}
const runCriticalQuitWork = () => {
  for (const work of criticalQuitWork) {
    try {
      work()
    } catch (error) {
      safeConsole('warn', '[kanso] 退出收尾动作失败', error)
    }
  }
}

/** 同映像进程 PID 快照（不含自己）。tasklist 同步枚举，实测 ~50ms。 */
const sameImagePids = (): number[] => {
  const image = path.basename(process.execPath)
  const csv = execFileSync('tasklist', ['/FI', `IMAGENAME eq ${image}`, '/FO', 'CSV', '/NH'], {
    encoding: 'latin1',
    windowsHide: true,
    timeout: 5000,
  })
  return parseTasklistPids(csv, process.pid)
}

/** 同步小睡。'quit' 是主进程最后一刻，没有事件循环可用，只能这么等。 */
const sleepSync = (ms: number) => {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  } catch (error) {
    trace(`sleepSync 不可用：${String(error)}`)
  }
}

/**
 * 杀过之后复核还剩谁。TerminateProcess 不是同步生效的，刚 kill 完立刻查
 * 多半还在列——所以等两轮再下结论，第一轮就干净了直接返回，正常退出不会多花时间。
 */
const stillAlive = (pids: number[]): number[] => {
  let remaining = pids
  for (const wait of [250, 500]) {
    sleepSync(wait)
    try {
      const alive = new Set(sameImagePids())
      remaining = remaining.filter((pid) => alive.has(pid))
    } catch (error) {
      // 枚举不出来就没有判据，宁可不报，也不要报一条自己都不确定的警
      trace(`复核枚举失败：${String(error)}`)
      return []
    }
    if (!remaining.length) return []
  }
  return remaining
}

// Windows 上 app.exit 只杀主进程，已经 close 卡住的 renderer 会变成
// 无窗口孤儿（父 PID 已死、仍占着 %APPDATA% 与 release）。taskkill /T 按进程树收。
const killOwnProcessTree = () => {
  if (process.platform === 'win32') {
    spawn('taskkill', ['/F', '/T', '/PID', String(process.pid)], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref()
    return
  }
  app.exit(0)
}

/**
 * 清掉上次留下的残留 艦素.exe（只动打包产物，不碰开发态的 electron.exe）。
 *
 * **必须在拿到单实例锁之后调用**：拿到锁就说明没有别的正常实例在跑，
 * 于是同名进程一律是上次没退干净的僵尸——包括它的 renderer 子进程，
 * 它们与主进程同名同 exe。反过来，在拿锁之前清就有误杀活实例的风险。
 *
 * 早先这里 spawn 一个 detached 的 PowerShell 去枚举 Win32_Process，实测**从没生效**：
 * 那条命令手工执行能杀，但由主进程 spawn 时进程根本没出现过，而且 PowerShell 冷启动
 * 加全进程枚举要 1.2–1.4 秒，第二个实例往往 1 秒就因单实例锁退出了。
 * 换成同步的 tasklist + Node 原生 kill：不依赖外部进程活过父进程，也不用等冷启动。
 */
export const reapOrphanKansoProcesses = () => {
  if (process.platform !== 'win32' || !app.isPackaged) return
  // 数据目录被覆盖 = 这是一个验收副本实例，同映像的进程**不一定是它的**
  // （用户的正式实例同名同 exe）。这条防线按映像名开杀，副本实例绝不能碰。
  if (DATA_DIR_OVERRIDDEN) {
    trace('数据目录被覆盖，跳过启动清残留（同映像进程可能属于正式实例）')
    return
  }
  try {
    const stale = sameImagePids()
    for (const pid of stale) {
      try {
        process.kill(pid)
      } catch {
        /* 它自己先退了，正是我们想要的结果 */
      }
    }
    if (stale.length) {
      safeConsole('warn', `[kanso] 清掉上次残留的 ${stale.length} 个进程`)
      // 落盘留证：能走到这里就说明**上一次退出漏了孤儿**——这正是要排查的事实本身，
      // 而且按定义罕见（正常退出这里是空的），不会刷日志。
      appendCrash({
        source: 'main',
        scope: 'quit-guard',
        message: `启动时清掉上次残留的 ${stale.length} 个同映像进程（PID ${stale.join(',')}）`,
        ts: Date.now(),
      })
    } else {
      trace('启动清残留：没有同映像残留进程')
    }
  } catch (error) {
    safeConsole('warn', '[kanso] 清理孤儿进程失败', error)
    appendCrash({
      source: 'main',
      scope: 'quit-guard',
      message: `启动清残留失败：${error instanceof Error ? error.message : String(error)}`,
      ts: Date.now(),
    })
  }
}

/**
 * 必须在铭（数据核心）**之后**注册：before-quit 按注册顺序回调，
 * 账本存盘要先落地，再谈关子进程与强制退出。
 *
 * 2026-08-19 实锤的第三种残留形态：**主进程痛快退了，卡死的游戏渲染进程成孤儿**
 * （--type=renderer、父 PID 已死、407MB 占着 release）。此前两条防线都罩不住它：
 * 4 秒兜底只在主进程卡住时触发（正常退出时定时器随主进程一起死），启动清扫要等
 * 下一次启动。所以退出前先收割全部渲染进程的 OS PID，在主进程活着的最后一刻
 * （'quit' 事件）逐个 TerminateProcess——同步执行，不依赖定时器，也不依赖能否
 * 活过父进程的外部命令。防 PID 复用误杀：只杀「收割过 ∩ 此刻仍是同映像」的。
 *
 * ⚠ 2026-08-20：上面这套写出来之后**一次都没开过火**（crash.log 自它上线起零条）。
 * 在打包产物上开 KANSO_QUIT_TRACE 实测，根因是收割源选错了：
 * 用户关窗退出这条路上，`window-all-closed` → `app.quit()`，等 before-quit 触发时
 * **主窗口与游戏 webview 的 webContents 早已销毁**，`getAllWebContents()` 返回空数组，
 * 收割集是空的，'quit' 里第一行 `if (!size) return` 直接走人。
 * 而同一时刻 `app.getAppMetrics()` 照样列着活着的 Tab 进程——Chromium 自己那本
 * 子进程账不跟着 webContents 销毁。所以收割改成**两个源都取**，以 appMetrics 为主。
 * 另外每分钟采样一次：万一 Chromium 中途就把某个渲染进程从账上划掉了
 * （进程还在、只是没人管了——这正是孤儿的成因），退出时的两次收割也看不见它。
 */
export const installQuitGuard = (graceMs = 4000) => {
  let quitting = false
  const rendererPids = new Set<number>()
  const harvestRendererPids = () => {
    // 源一：Electron 认得的 webContents。托盘「退出艦素」这类窗口还在的路径上有货。
    for (const contents of webContents.getAllWebContents()) {
      try {
        const pid = contents.getOSProcessId()
        if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) rendererPids.add(pid)
      } catch {
        /* 已销毁的 webContents 拿不到 PID——它的进程多半也走了 */
      }
    }
    // 源二：Chromium 的子进程账。关窗退出时**只有它拿得到东西**（见上面的 ⚠）。
    // 只收 Tab（渲染进程）：四次残留清一色是 --type=renderer；而 Utility 里有
    // Network Service，它正管着 Cookies 落盘，退出最后一刻去杀它是在拿登录态冒险。
    // GPU / Utility 从来都是自己走干净的，交给系统。
    try {
      for (const metric of app.getAppMetrics()) {
        if (metric.type !== 'Tab') continue
        if (Number.isInteger(metric.pid) && metric.pid > 0 && metric.pid !== process.pid) {
          rendererPids.add(metric.pid)
        }
      }
    } catch (error) {
      safeConsole('warn', '[kanso] 收割渲染进程 PID 失败', error)
    }
  }
  // 源三、也是唯一靠得住的一个：**渲染进程一出生就记下来**。
  //
  // 前两个源都是「退出时现问」，而退出时正是问不到的时候——2026-08-20 在打包产物上
  // 实测：关窗退出时游戏 webview 的 guest 既不在 getAllWebContents()（webContents
  // 已随窗口销毁），也不在 getAppMetrics()（Chromium 已把它从子进程账上划掉），
  // 可那个进程还活着（死循环里的那个当时 CPU 4.42s）。**「Chromium 不再管它」和
  // 「进程还在」是两回事，孤儿就长在这条缝里。** 出生时记下，退出时只管按 PID 收，
  // 就不依赖任何人当时还认不认得它。
  //
  // PID 复用不构成误杀风险：开枪名单是「本进程亲自收割过的 PID」，退出时再与
  // 「此刻仍是同映像」取交集——交集只会缩小名单，而缩小之前那一侧本来就只有自己的
  // 子进程。（单实例锁按数据目录发放，KANSO_DATA_DIR 覆盖时同映像的另一个实例可以
  // 并存，所以「同映像」并不等于「就是自己的」，靠得住的是收割集那一侧。）
  const rememberPidOf = (contents: Electron.WebContents) => {
    try {
      const pid = contents.getOSProcessId()
      if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) rendererPids.add(pid)
    } catch {
      /* 还没分配进程或已销毁——后面几个时机还会再记 */
    }
  }
  app.on('web-contents-created', (_event, contents) => {
    rememberPidOf(contents)
    // 创建那一刻多半还没有进程；这几个时机之后一定有了。跨站导航会换进程，所以
    // 导航完成也要再记一次（旧进程留在集合里正合适——它可能就是卡住不走的那个）。
    const again = () => rememberPidOf(contents)
    contents.on('dom-ready', again)
    contents.on('did-navigate', again)
    contents.on('did-frame-navigate', again)
  })
  // 再加一道运行期低频采样，兜住「没有 webContents 的渲染进程」（跨站 iframe 的
  // 独立进程一类）。getAppMetrics 很便宜，一分钟一次可以忽略不计。
  const sampler = setInterval(harvestRendererPids, 60_000)
  sampler.unref?.()

  /**
   * 把收割集里此刻**仍然活着**的逐个 TerminateProcess，返回真开了枪的那些。
   * 与「此刻仍是同映像」取交集是防 PID 复用误杀：正常退干净的 PID 已不在列，
   * 被系统发给别人的也对不上映像名。同步执行——这是主进程的最后一刻。
   */
  const terminateSurvivors = (stage: string): number[] => {
    harvestRendererPids()
    trace(`${stage}：收割集 = ${[...rendererPids].join(',') || '（空）'}`)
    if (!rendererPids.size) return []
    let survivors: number[] = []
    try {
      const alive = new Set(sameImagePids()) // tasklist 同步枚举，实测 ~50ms
      trace(`${stage}：tasklist 同映像存活 = ${[...alive].join(',') || '（空）'}`)
      survivors = [...rendererPids].filter((pid) => alive.has(pid))
    } catch (error) {
      // 枚举失败（非 Windows / tasklist 不可用）：退回逐个 kill，已退出的抛错吞掉。
      // 收割集只含自己的渲染进程，误杀面有限。
      trace(`${stage}：同映像枚举失败，退回全量 kill：${String(error)}`)
      survivors = [...rendererPids]
    }
    trace(`${stage}：判定仍存活 = ${survivors.join(',') || '（空）'}`)
    const killed: number[] = []
    for (const pid of survivors) {
      try {
        process.kill(pid)
        killed.push(pid)
      } catch {
        /* 它自己先退了，正是我们想要的结果 */
      }
    }
    trace(`${stage}：强杀 ${killed.length} 个（PID ${killed.join(',') || '无'}）`)
    return killed
  }

  app.on('before-quit', () => {
    if (quitting) return
    quitting = true
    trace(`before-quit：webContents = ${describeWebContents()}`)
    trace(`before-quit：appMetrics = ${describeAppMetrics()}`)
    harvestRendererPids()
    trace(`before-quit：收割到 PID ${[...rendererPids].join(',') || '（空）'}`)
    for (const contents of webContents.getAllWebContents()) {
      try {
        if (!contents.isDestroyed()) contents.close()
      } catch (error) {
        safeConsole('warn', '[kanso] 退出时关闭 webContents 失败', error)
      }
    }
    // 宽限期必须长于账本存盘。铭的 before-quit 存盘是同步的，先于这个定时器完成。
    const bail = setTimeout(() => {
      safeConsole('warn', '[kanso] 退出超时，强制结束进程树（避免残留孤儿渲染进程）')
      // 这条从前只进 console——而打包版是 GUI 子系统，stdout 没有接收方，
      // 于是「兜底开火了」在 crash.log 里完全看不见，排查时只能靠猜。
      // 兜底触发本身就是异常（退出卡了 4 秒），罕见，值得落盘。
      appendCrash({
        source: 'main',
        scope: 'quit-guard',
        message: `退出超时 ${graceMs}ms，强制结束进程树（appMetrics = ${describeAppMetrics()}）`,
        ts: Date.now(),
      })
      runCriticalQuitWork() // 幂等；正常路径已由 will-quit 跑过、这里是空转
      // 先自己点掉渲染进程，再交给 taskkill 收整棵树：这条路上 'quit' 不会触发
      // （taskkill 把主进程也带走了），不在这里开枪就等于兜底路径没有第三道防线。
      terminateSurvivors('兜底')
      killOwnProcessTree()
    }, graceMs)
    bail.unref?.()
  })
  app.on('will-quit', () => trace('will-quit 触发'))
  app.on('quit', () => {
    trace(`quit 触发：webContents = ${describeWebContents()}`)
    trace(`quit：appMetrics = ${describeAppMetrics()}`)
    const killed = terminateSurvivors('quit') // 收割里也兜了一遍 before-quit 之后的变化
    if (!killed.length) return
    // **杀了不等于杀掉**。这才是值得报警的那一格：防线开了火却没打死，
    // 用户下次就会看到「关了艦素但进程还在」。正常退出复核一定是空的，不落盘。
    const stubborn = stillAlive(killed)
    if (stubborn.length) {
      appendCrash({
        source: 'main',
        scope: 'quit-guard',
        message: `退出时强杀 ${killed.length} 个子进程，仍有 ${stubborn.length} 个没死（PID ${stubborn.join(',')}）`,
        ts: Date.now(),
      })
    } else {
      trace('quit：复核通过，被杀的进程都已消失')
    }
  })
}
