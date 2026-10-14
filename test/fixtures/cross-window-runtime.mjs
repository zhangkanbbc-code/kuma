// 真主进程 config + 每窗独立的真 kernel；只替换 Electron、磁盘与时钟边界。
// 通知经 webContents.send 排队，再走 ipcRenderer.on，故可演练通知尚未送达的写入。
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'

const root = fileURLToPath(new URL('../..', import.meta.url))
const require = createRequire(import.meta.url)
const compiled = new Map()
const codeOf = (relative) => {
  if (!compiled.has(relative)) compiled.set(relative, transformSync(
    fs.readFileSync(path.join(root, 'src', relative + '.ts'), 'utf8'),
    { loader: 'ts', format: 'cjs', target: 'node20' },
  ).code)
  return compiled.get(relative)
}
const evaluate = (relative, resolve, globals = {}) => {
  const module = { exports: {} }
  new Function('require', 'module', 'exports', ...Object.keys(globals), codeOf(relative))(
    resolve, module, module.exports, ...Object.values(globals),
  )
  return module.exports
}
const shared = (id) => require(path.join(root, 'dist', 'shared', path.basename(id) + '.js'))

export const crossWindowRuntime = () => {
  const windows = [], messages = [], diskWrites = []
  const config = evaluate('main/config', (id) => {
    if (id === 'electron') return { BrowserWindow: { getAllWindows: () => windows } }
    if (id === 'fs') return { readFileSync: () => '{}' }
    if (id === './env') return { APPDATA_PATH: '/isolated-test', DEFAULT_CACHE_PATH: '/isolated-test/cache' }
    if (id === './atomic-json') return { atomicWriteJsonSync: (_path, value) => diskWrites.push(structuredClone(value)) }
    if (id.startsWith('../shared/')) return shared(id)
    return require(id)
  })
  const renderer = () => {
    const handlers = new Map(), timers = [], documentHandlers = new Map()
    const document = {
      body: { classList: { toggle() {} } }, activeElement: null,
      addEventListener: (type, cb) => documentHandlers.set(type, cb),
    }
    const emit = (channel, data) => {
      for (const cb of handlers.get(channel) ?? []) cb({}, data)
    }
    windows.push({ webContents: { send: (channel, data) => messages.push(() => emit(channel, data)) } })
    const ipcRenderer = {
      on: (channel, cb) => handlers.set(channel, [...(handlers.get(channel) ?? []), cb]),
      removeListener: (channel, cb) => handlers.set(channel, handlers.get(channel).filter((fn) => fn !== cb)),
      invoke: async (channel) => {
        if (channel === 'mg:get-state') return { master: kernel.mg.master, player: kernel.mg }
        return null
      },
    }
    const kernel = evaluate('renderer/kernel', (id) => {
      if (id === './ui-preference-events') return evaluate('renderer/ui-preference-events', (dep) => {
        if (dep === 'electron') return { ipcRenderer }
        if (dep === './crash-guard') return { safeEach: (_tag, list, run) => list.forEach(run) }
        return shared(dep)
      })
      if (id === 'electron') return { ipcRenderer, webFrame: { setZoomFactor() {} } }
      if (id === '@electron/remote') return { require: () => config }
      if (id === './crash-guard') return { safeEach: (_tag, list, run) => list.forEach(run) }
      if (id === './perf-guard') return {
        captureListenerSite: () => '', timedEach: (_tag, list, _site, run) => list.forEach(run),
        timedRun: (_tag, run) => run(),
      }
      if (id.startsWith('../shared/')) return shared(id)
      return require(id)
    }, {
      document, window: {},
      setTimeout: (cb) => { timers.push(cb); return timers.length }, clearTimeout() {},
      setInterval: (cb) => { timers.push(cb); return timers.length },
    })
    const load = (name) => evaluate('renderer/' + name, (id) => {
      if (id === './kernel') return kernel
      if (id.startsWith('../shared/')) return shared(id)
      return require(id)
    })
    return { kernel, load, emit, documentHandlers, fireTimers: () => timers.splice(0).forEach((cb) => cb()) }
  }
  return {
    config, renderer, diskWrites,
    flush: () => { while (messages.length) messages.shift()() },
    queued: () => messages.length,
  }
}
