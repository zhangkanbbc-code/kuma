import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

import processReap from '../dist/shared/process-reap.js'

const { classifyReapCandidates, parseTasklistPids } = processReap

// tasklist /FO CSV /NH 的真实输出形状。映像名是 ASCII，latin1 读回来一字不差；
// 解析只取第二列，本来就不碰第一列
const CSV = [
  '"kuma.exe","47216","Console","1","225,680 K"',
  '"kuma.exe","60432","Console","1","98,304 K"',
  '"kuma.exe","56252","Console","1","64,512 K"',
].join('\r\n')

test('每一行取出 PID，自己那条排除掉', () => {
  assert.deepEqual(parseTasklistPids(CSV, 60432), [47216, 56252])
  assert.deepEqual(parseTasklistPids(CSV, 999), [47216, 60432, 56252])
})

test('renderer 子进程也要算进去——它们与主进程同名同 exe，正是占着文件锁的那批', () => {
  assert.equal(parseTasklistPids(CSV, 0).length, 3)
})

test('一个都没匹配到时 tasklist 那句提示不会被读成 PID', () => {
  const none = '信息: 没有运行的任务匹配指定标准。'
  assert.deepEqual(parseTasklistPids(none, 1), [])
  assert.deepEqual(parseTasklistPids('', 1), [])
  assert.deepEqual(parseTasklistPids(null, 1), [])
})

test('列数不够或 PID 不是数字的行一律跳过，不会 kill(NaN)', () => {
  const junk = ['"kuma.exe"', '"kuma.exe","","Console","1","0 K"', '"kuma.exe","-1","x","1","0 K"'].join('\n')
  assert.deepEqual(parseTasklistPids(junk, 1), [])
})

test('只直接收割仍存活且 metrics 仍确认的历史 PID，其余存活历史 PID 要核对映像', () => {
  assert.deepEqual(
    classifyReapCandidates([10, 20, 30, 40], new Set([10, 30, 50]), new Set([10, 20, 40, 50]), 1),
    { direct: [10], needsImageCheck: [20, 40] },
  )
})

test('收割分流不纳入自己、无效 PID、重复 PID，也不扩大到 metrics 中未收割的进程', () => {
  const pids = [0, -1, NaN, 1.5, 1, 10, 10, 20, 20]
  assert.deepEqual(
    classifyReapCandidates(pids, new Set([...pids, 99]), new Set([...pids, 99]), 1),
    { direct: [10, 20], needsImageCheck: [] },
  )
})

test('metrics 无证据时全部存活历史 PID 都须核对；全部已退时不需核对映像', () => {
  assert.deepEqual(classifyReapCandidates([10, 20], new Set(), new Set([10, 20]), 1), {
    direct: [], needsImageCheck: [10, 20],
  })
  assert.deepEqual(classifyReapCandidates([10, 20], new Set([10, 20]), new Set(), 1), {
    direct: [], needsImageCheck: [],
  })
})

// 跑真实 guard 的编译产物，只替换 Electron/OS 边界，验证分流确实接进退出与复核。
const quitHarness = ({ imagePids = [], imageError = false, metricError = false, probeError = false, stubborn = false } = {}) => {
  const listeners = new Map()
  const killed = []
  let metrics = [{ pid: 10, type: 'Tab' }, { pid: 20, type: 'Tab' }]
  const live = new Set([10, 20])
  let tasklists = 0
  const app = {
    on: (event, callback) => listeners.set(event, callback),
    getAppMetrics: () => {
      if (metricError && !metrics.length) throw new Error('metrics unavailable')
      return metrics
    },
  }
  const module = { exports: {} }
  const dependencies = {
    '../shared/env-names': { readEnv: () => '' },
    '../shared/process-reap': processReap,
    './crash-log': { appendCrash() {}, safeConsole() {} },
    './env': { DATA_DIR_OVERRIDDEN: true },
    electron: { app, webContents: { getAllWebContents: () => [] } },
    path: { basename: () => 'kuma.exe' },
    child_process: {
      execFileSync: () => {
        tasklists++
        if (imageError) throw new Error('tasklist failed')
        return imagePids.map((pid) => `"kuma.exe","${pid}","Console","1","0 K"`).join('\n')
      },
    },
  }
  vm.runInNewContext(fs.readFileSync(new URL('../dist/main/quit-guard.js', import.meta.url), 'utf8'), {
    module,
    require: (name) => {
      assert.ok(name in dependencies, `未替换的 OS 依赖：${name}`)
      return dependencies[name]
    },
    process: {
      pid: 1, execPath: 'kuma.exe', platform: 'win32',
      kill: (pid, signal) => {
        if (signal === 0 && probeError) throw Object.assign(new Error('denied'), { code: 'EPERM' })
        if (!live.has(pid)) throw Object.assign(new Error('gone'), { code: 'ESRCH' })
        if (signal === 0) return true
        killed.push(pid)
        if (!stubborn) live.delete(pid)
        return true
      },
    },
    setInterval: () => ({ unref() {} }),
    setTimeout: () => ({ unref() {} }),
    Atomics: { wait() {} },
  })
  module.exports.installQuitGuard()
  listeners.get('before-quit')()
  return {
    live,
    quit: (currentMetrics) => {
      metrics = currentMetrics
      listeners.get('quit')()
      return { killed, tasklists }
    },
  }
}

test('metrics 快路收掉仍存活的 renderer，杀后已消失则退出及复核均不跑 tasklist', () => {
  const harness = quitHarness({ imageError: true })
  harness.live.delete(20)
  assert.deepEqual(harness.quit([{ pid: 10, type: 'Tab' }, { pid: 99, type: 'GPU' }]), {
    killed: [10], tasklists: 0,
  })
})

test('历史孤儿核对同映像后才杀，被复用成别家映像的 PID 留下', () => {
  assert.deepEqual(quitHarness({ imagePids: [20, 99] }).quit([]), { killed: [20], tasklists: 1 })
})

test('tasklist 失败不退回全量 kill，metrics 确认的仍可收掉', () => {
  assert.deepEqual(quitHarness({ imageError: true }).quit([{ pid: 10, type: 'Tab' }]), {
    killed: [10], tasklists: 1,
  })
  assert.deepEqual(quitHarness({ imageError: true, metricError: true }).quit([]), {
    killed: [], tasklists: 1,
  })
})

test('收割集已全部消失或存活探测失败时不杀、不枚举', () => {
  const gone = quitHarness()
  gone.live.clear()
  assert.deepEqual(gone.quit([]), { killed: [], tasklists: 0 })
  assert.deepEqual(quitHarness({ probeError: true }).quit([{ pid: 10, type: 'Tab' }]), {
    killed: [], tasklists: 0,
  })
})

test('强杀后仍存活且 metrics 确认的进程复核两轮也无需 tasklist', () => {
  assert.deepEqual(quitHarness({ stubborn: true }).quit([{ pid: 10, type: 'Tab' }, { pid: 20, type: 'Tab' }]), {
    killed: [10, 20], tasklists: 0,
  })
})

test('清残留只在拿到单实例锁之后跑——在那之前跑会误杀正在用的实例', () => {
  const guard = fs.readFileSync(new URL('../src/main/quit-guard.ts', import.meta.url), 'utf8')
  const main = fs.readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')

  // installQuitGuard 在 line 75 就执行，远早于单实例检查；清残留不能挂在它里面
  const install = guard.slice(guard.indexOf('export const installQuitGuard'))
  assert.doesNotMatch(install, /reapOrphanKumaProcesses\(\)/, '清残留又挪回拿锁之前了')
  // 必须落在 requestSingleInstanceLock 的 else（拿到锁）分支里
  const lockAt = main.indexOf('requestSingleInstanceLock')
  const reapAt = main.indexOf('reapOrphanKumaProcesses()')
  assert.ok(reapAt > lockAt, '清残留跑在拿锁之前')
  assert.match(main.slice(lockAt, reapAt), /\} else \{/, '清残留没落在拿到锁的那一支')

  // 早先那版 spawn 一个 detached 的 PowerShell 去枚举 Win32_Process，实测从没生效
  assert.doesNotMatch(guard, /spawn\(\s*'powershell/i, 'reap 又去依赖外部 PowerShell 了')
  assert.match(guard, /execFileSync\('tasklist'/, '改用同步 tasklist 才不依赖子进程活过父进程')
  assert.match(guard, /process\.kill\(pid\)/, '要用 Node 原生 kill')
})
