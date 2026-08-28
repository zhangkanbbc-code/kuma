// 「kuma 到底在不在跑」的正确判据。
//
// 打包前查实例这件事 2026-08-20 栽过一次：`Get-CimInstance Win32_Process` 列出了
// 一条主映像，就据此判定「应用还开着，跳过打包」——而那一条其实是**上次退出
// 漏下的孤儿渲染进程**（`--type=renderer`、父进程已不存在），用户当时早就关了应用。
//
// 判据只有一条：**命令行不带 `--type=` 的才是主进程**。
//   - 有主进程            → 应用真的在跑，别打包、别做验收；
//   - 只剩带 `--type=` 的 → 全是孤儿，`Stop-Process -Force` 清掉就能继续
//     （主进程该落盘的早落完了，没有数据风险）。
//
// 映像名 `kuma.exe` 全是 ASCII，`tasklist /FI "IMAGENAME eq kuma.exe"` 与
// `tasklist | grep kuma` 都能直接用（改名前的汉字映像名在 Git Bash 下是乱码，
// grep 必然空手而归、假报「无残留」——那条坑随映像名改成 ASCII 一起消失了）。

import { execFileSync } from 'node:child_process'

export const KANSO_IMAGE = 'kuma.exe'

/**
 * 列出全部同映像进程。返回 `[{ pid, ppid, type, commandLine }]`，
 * `type` 是 `--type=` 开关的值（主进程为 null）。
 */
export const listKansoProcesses = (image = KANSO_IMAGE) => {
  const script = [
    '[Console]::OutputEncoding=[Text.Encoding]::UTF8',
    '$list = @(Get-CimInstance Win32_Process -Filter "Name=\'$env:KANSO_IMAGE\'" |' +
      ' Select-Object ProcessId,ParentProcessId,CommandLine)',
    'ConvertTo-Json -InputObject $list -Depth 3 -Compress',
  ].join('; ')
  let raw = ''
  try {
    raw = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30000,
      env: { ...process.env, KANSO_IMAGE: image },
    })
  } catch (error) {
    throw new Error(`枚举 ${image} 进程失败：${error?.message ?? error}`)
  }
  const text = raw.trim()
  if (!text || text === 'null') return []
  const rows = JSON.parse(text)
  return (Array.isArray(rows) ? rows : [rows]).map((row) => {
    const commandLine = row.CommandLine ?? ''
    const type = /--type=([\w-]+)/.exec(commandLine)?.[1] ?? null
    return { pid: row.ProcessId, ppid: row.ParentProcessId, type, commandLine }
  })
}

/**
 * 只要 PID 时走这条：tasklist 没有冷启动开销（~50ms，CIM 走 PowerShell 要 ~1s），
 * 轮询「清零了没有」用它。要命令行/父进程才走上面的 CIM。
 */
export const listKansoPidsFast = (image = KANSO_IMAGE) => {
  let csv = ''
  try {
    csv = execFileSync('tasklist', ['/FI', `IMAGENAME eq ${image}`, '/FO', 'CSV', '/NH'], {
      // latin1 = 原样字节。映像名与 PID 列都是 ASCII，不解码就不会被系统代码页干扰
      //（tasklist 那句「没有运行的任务」提示是本地化的，解析本来就不看它）
      encoding: 'latin1',
      windowsHide: true,
      timeout: 10000,
    })
  } catch (error) {
    throw new Error(`tasklist 枚举失败：${error?.message ?? error}`)
  }
  const pids = []
  for (const line of csv.split(/\r?\n/)) {
    const cells = line.split('","')
    if (cells.length < 2) continue
    const pid = Number(cells[1])
    if (Number.isInteger(pid) && pid > 0) pids.push(pid)
  }
  return pids
}

/** 主进程（不带 `--type=`）与子/孤儿进程（带 `--type=`）分开。 */
export const classifyKansoProcesses = (rows) => ({
  mains: rows.filter((row) => row.type == null),
  children: rows.filter((row) => row.type != null),
})

export const describeProcess = (row) =>
  `PID ${row.pid}（父 ${row.ppid}）${row.type ? `--type=${row.type}` : '主进程'}`

export const killPids = (pids) => {
  for (const pid of pids) {
    try {
      process.kill(pid)
    } catch {
      /* 已经自己退了，正是想要的结果 */
    }
  }
}
