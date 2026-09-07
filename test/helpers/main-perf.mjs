import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import envNames from '../../dist/shared/env-names.js'

export const compiledMain = (name) => readFileSync(new URL(`../../dist/main/${name}.js`, import.meta.url), 'utf8')

export const mountTiming = (threshold, globals = {}) => {
  const ipc = new EventEmitter()
  const handlers = new Map()
  ipc.handle = function (channel, listener) {
    if (handlers.has(channel)) throw new Error('duplicate handler')
    handlers.set(channel, listener)
  }
  const entries = []
  const env = { KUMA_PERF_LONGTASK_MS: threshold }
  let now = 0
  const performance = { now: () => now }
  const module = { exports: {} }
  vm.runInNewContext(compiledMain('perf-time'), {
    module, exports: module.exports, performance, Uint8Array, Buffer, Promise,
    require: (id) => {
      if (id === 'electron') return { ipcMain: ipc }
      if (id === '../shared/env-names') return { readEnv: (key) => envNames.readEnv(key, env) }
      throw new Error(`unexpected require: ${id}`)
    },
    ...globals,
  })
  return {
    api: module.exports, ipc, handlers, entries, performance, env,
    advance: (ms) => { now += ms },
    installSink: () => module.exports.setMainTimingSink((entry) => entries.push({ ...entry })),
  }
}
