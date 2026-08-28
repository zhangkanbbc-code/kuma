import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(fileURLToPath(import.meta.url), '..', '..')
const require = createRequire(import.meta.url)
const electronPath = require('electron')
const marker = '[kanso] smoke: window ok'
const configuredTimeout = Number.parseInt(process.env.KANSO_SMOKE_TIMEOUT_MS ?? '30000', 10)
const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
  ? configuredTimeout
  : 30000

const child = spawn(electronPath, ['.'], {
  cwd: root,
  env: {
    ...process.env,
    KANSO_SMOKE: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
})

let stdout = ''
let markerSeen = false
let settled = false
let exitGraceTimer

const outcome = await new Promise((resolve) => {
  const finish = (result) => {
    if (settled) return
    settled = true
    clearTimeout(startupTimer)
    clearTimeout(exitGraceTimer)
    resolve(result)
  }

  const startupTimer = setTimeout(() => {
    finish({
      ok: false,
      message: `启动 ${timeoutMs}ms 后仍未看到 ${marker}`,
    })
  }, timeoutMs)

  child.stdout.on('data', (chunk) => {
    const text = chunk.toString()
    process.stdout.write(text)
    stdout = `${stdout}${text}`.slice(-8192)
    if (!markerSeen && stdout.includes(marker)) {
      markerSeen = true
      clearTimeout(startupTimer)
      exitGraceTimer = setTimeout(() => {
        finish({ ok: true, message: '已看到窗口成功标记；退出超时，已清理进程' })
      }, 5000)
    }
  })

  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk)
  })

  child.on('error', (error) => {
    finish({ ok: false, message: `无法启动 Electron：${error.message}` })
  })

  child.on('close', (code, signal) => {
    if (markerSeen) {
      finish({ ok: true })
      return
    }
    finish({
      ok: false,
      message: `Electron 在成功标记前退出（code=${code ?? 'null'}, signal=${signal ?? 'null'}）`,
    })
  })
})

if (child.exitCode === null && child.signalCode === null && child.pid) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    })
  } else {
    child.kill('SIGKILL')
  }
}

if (!outcome.ok) {
  console.error(`[kanso] smoke failed: ${outcome.message}`)
  process.exitCode = 1
} else if (outcome.message) {
  console.warn(`[kanso] smoke: ${outcome.message}`)
}
