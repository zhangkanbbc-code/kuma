// 退出残留孤儿的端到端验收。
//
// 「关掉 kuma 之后进程还在」这件事修过四次、复发四次，每次都是新形态。
// 单元测试盯不住它：它依赖进程怎么被启动、渲染进程当时卡在哪、谁先死。
// 所以判据只有一个——**在打包产物上真的关一次窗口，然后数同映像进程有没有清零**。
//
// 剧本：
//   ① 先查实例：有主进程（命令行不带 --type=）就拒绝跑，只剩孤儿就先清掉；
//   ② 起一个只听 127.0.0.1 的小页面服务器，把 kanso.homepage 指过去
//      （绝不让验收实例连真游戏：没有 Network/Cookies，也不该去碰 DMM）；
//   ③ 用 KANSO_DATA_DIR 把数据目录指到临时副本 —— **不能靠 APPDATA 环境变量**，
//      2026-08-20 实测 Electron 43 在 Windows 上不认它（app.getPath('appData')
//      照样返回真实 Roaming）；
//   ④ CloseMainWindow()（等价于点标题栏的 ×）；
//   ⑤ 数秒内同映像进程必须清零，否则打印残留进程的完整命令行 + crash.log 里的
//      quit-guard 流水（KANSO_QUIT_TRACE=1 打开的），失败退出。
//
// 关键场景是 `hang`：游戏 webview 的渲染进程正卡在死循环里时关窗——
// 这正是历史上四次残留的共同现场（卡死的 guest 收不到 close，主进程先走一步）。
//
// 用法：node scripts/quit-e2e.mjs [--scenario=idle|hang|both] [--keep-data]

import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  KANSO_IMAGE,
  classifyKansoProcesses,
  describeProcess,
  killPids,
  listKansoPidsFast,
  listKansoProcesses,
} from './lib/kanso-processes.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argOf = (name, fallback) =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback

const exePath = path.resolve(argOf('exe', path.join(root, 'release', 'kuma-win32-x64', KANSO_IMAGE)))
const scenarioArg = argOf('scenario', 'both')
const keepData = args.includes('--keep-data')
const dataDir = path.join(os.tmpdir(), 'kanso-quit-e2e')

const QUIT_DEADLINE_MS = 20000
const STARTUP_DEADLINE_MS = 60000

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const log = (message) => console.log(`[quit-e2e] ${message}`)

if (process.platform !== 'win32') {
  console.error('[quit-e2e] 只在 Windows 上有意义（孤儿渲染进程是 Windows 的形态）')
  process.exit(1)
}
if (!fs.existsSync(exePath)) {
  console.error(`[quit-e2e] 找不到打包产物：${exePath}\n先跑 npm run package:win`)
  process.exit(1)
}

// —— ① 查实例。这一步的判据就是那条工序纪律，别再拿「有没有同名进程」当依据 ——
const preexisting = listKansoProcesses()
const { mains, children } = classifyKansoProcesses(preexisting)
if (mains.length) {
  console.error(
    `[quit-e2e] kuma 正在运行（${mains.map(describeProcess).join('；')}），拒绝验收——` +
      '验收会启动第二个实例并强杀同映像进程。请先关掉应用。',
  )
  process.exit(1)
}
if (children.length) {
  log(`开跑前发现 ${children.length} 个孤儿（无主进程），先清掉：${children.map(describeProcess).join('；')}`)
  killPids(children.map((row) => row.pid))
  await sleep(1000)
}

// —— ② 小页面服务器。/idle 静止不动，/hang 一秒后把渲染进程钉死在死循环里 ——
const PAGES = {
  '/idle': '<!doctype html><meta charset="utf-8"><title>idle</title><body>quit-e2e idle</body>',
  '/hang':
    '<!doctype html><meta charset="utf-8"><title>hang</title><body>quit-e2e hang</body>' +
    '<script>window.addEventListener("load",()=>{setTimeout(()=>{for(;;){}},1200)})</script>',
}
const server = http.createServer((req, res) => {
  log(`页面请求 ${req.method} ${req.url}`)
  const body = PAGES[(req.url ?? '').split('?')[0]] ?? PAGES['/idle']
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(body)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
log(`页面服务器 http://127.0.0.1:${port}`)

// 子进程的命令行里带 --user-data-dir=<数据目录>，据此认出「这一轮验收自己的」进程
const ours = (row) => row.commandLine.toLowerCase().includes(dataDir.toLowerCase())

/** 各进程累计 CPU 秒数。死循环的那个会明显高出一截。 */
const cpuOf = (pids) => {
  try {
    const out = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue` +
          ' | ForEach-Object { "$($_.Id)=$([math]::Round($_.CPU,2))s" }',
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 30000 },
    )
    return out.trim().split(/\r?\n/).join(' ')
  } catch (error) {
    return `取 CPU 失败：${error?.message ?? error}`
  }
}

const readTrace = () => {
  try {
    const text = fs.readFileSync(path.join(dataDir, 'crash.log'), 'utf8')
    return text
      .split(/\n(?=\[\d{4})/)
      .filter((block) => block.includes('quit-guard'))
      .join('\n')
  } catch {
    return '(没有 crash.log)'
  }
}

const runScenario = async (scenario) => {
  log(`—— 场景 ${scenario} ——`)
  fs.rmSync(dataDir, { recursive: true, force: true })
  fs.mkdirSync(dataDir, { recursive: true })
  // 首页指向本地页面：验收实例绝不去碰真游戏（也没有 Cookies 可用）。
  // 托盘关掉：托盘会让「关窗口」不等于「退出」，那是另一条路径。
  fs.writeFileSync(
    path.join(dataDir, 'config.json'),
    JSON.stringify(
      { kanso: { homepage: `http://127.0.0.1:${port}/${scenario}`, tray: { enabled: false } } },
      null,
      2,
    ),
  )

  const child = spawn(exePath, [], {
    cwd: path.dirname(exePath),
    env: { ...process.env, KANSO_DATA_DIR: dataDir, KANSO_QUIT_TRACE: '1' },
    stdio: 'ignore',
    windowsHide: false,
  })
  child.unref() // 应用要是退不掉，脚本不能跟着一起挂住
  const mainPid = child.pid
  log(`已启动主进程 PID ${mainPid}`)

  // 等到子进程齐了（主窗口 + 游戏 guest + GPU/utility 若干）
  const startedAt = Date.now()
  let ready = []
  while (Date.now() - startedAt < STARTUP_DEADLINE_MS) {
    await sleep(1500)
    const rows = listKansoProcesses().filter((row) => row.pid === mainPid || ours(row))
    const renderers = rows.filter((row) => row.type === 'renderer')
    if (renderers.length >= 2) {
      ready = rows
      break
    }
  }
  if (!ready.length) {
    killPids(listKansoPidsFast())
    throw new Error(`${STARTUP_DEADLINE_MS}ms 内没等到两个渲染进程（主窗口 + 游戏 webview）`)
  }
  log(`启动完成：${ready.length} 个进程 · ${ready.map(describeProcess).join('；')}`)
  // hang 场景：给页面的死循环留出真正跑起来的时间
  await sleep(4000)
  // 死循环到底有没有跑起来，看 CPU 时间说话——不核实就等于在测一个自己没做的事
  log(`关窗前各进程 CPU：${cpuOf(ready.map((row) => row.pid))}`)

  // —— ④ 点 × ——
  const closed = execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$p = Get-Process -Id ${mainPid} -ErrorAction Stop; $p.CloseMainWindow()`,
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 30000 },
  ).trim()
  log(`CloseMainWindow() → ${closed}`)
  const closedAt = Date.now()

  // —— ⑤ 数清零 ——
  let leftover = []
  while (Date.now() - closedAt < QUIT_DEADLINE_MS) {
    leftover = listKansoPidsFast()
    if (!leftover.length) break
    await sleep(500)
  }
  const elapsed = Date.now() - closedAt

  const trace = readTrace()
  if (!leftover.length) {
    log(`同映像进程在 ${Math.round(elapsed / 100) / 10}s 内清零`)
    log(`quit-guard 流水：\n${trace}`)
    // 光看「清零了」不够：Chromium 自己多数时候也会把子进程收走，第三道防线
    // 就算一枪不开也照样是绿的——2026-08-19 到 08-20 它整整一个月没开过火，
    // 就是这样瞒过去的。所以再钉一条白盒判据：退出时收割集**必须非空**。
    if (/quit：收割集 = （空）/.test(trace) || !/quit：收割集 = \d/.test(trace)) {
      console.error('[quit-e2e] 失败：quit 时收割集是空的——第三道防线没有任何可杀对象，等于没装')
      return false
    }
    // hang 场景更硬：guest 卡在死循环里，主进程最后一刻它**必然**还活着，
    // 所以防线必须真开枪。开枪数为 0 就说明收割集里没有它（历史上的第四种形态）。
    if (scenario === 'hang') {
      const shots = Number(/quit：强杀 (\d+) 个/.exec(trace)?.[1] ?? 0)
      if (shots < 1) {
        console.error('[quit-e2e] 失败：卡死的 guest 还活着，防线却一枪没开')
        return false
      }
      log(`卡死的 guest 由防线亲手收掉（强杀 ${shots} 个）`)
    }
    log('通过：进程清零 + 退出时收割集非空')
    return true
  }

  const stuck = listKansoProcesses()
  console.error(`[quit-e2e] 失败：关窗 ${QUIT_DEADLINE_MS}ms 后仍有 ${stuck.length} 个进程残留`)
  for (const row of stuck) console.error(`  ${describeProcess(row)}\n    ${row.commandLine}`)
  console.error(`[quit-e2e] quit-guard 流水：\n${trace}`)
  killPids(stuck.map((row) => row.pid))
  return false
}

let ok = true
try {
  for (const scenario of scenarioArg === 'both' ? ['idle', 'hang'] : [scenarioArg]) {
    if (!PAGES[`/${scenario}`]) throw new Error(`未知场景：${scenario}`)
    if (!(await runScenario(scenario))) ok = false
  }
} finally {
  server.close()
  if (!keepData) fs.rmSync(dataDir, { recursive: true, force: true })
}

if (!ok) {
  console.error('[quit-e2e] 退出残留验收未通过')
  process.exit(1)
}
log('全部场景通过')
