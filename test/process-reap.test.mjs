import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import processReap from '../dist/shared/process-reap.js'

const { parseTasklistPids } = processReap

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
  const junk = ['"kanso.exe"', '"kanso.exe","","Console","1","0 K"', '"kanso.exe","-1","x","1","0 K"'].join('\n')
  assert.deepEqual(parseTasklistPids(junk, 1), [])
})

test('清残留只在拿到单实例锁之后跑——在那之前跑会误杀正在用的实例', () => {
  const guard = fs.readFileSync(new URL('../src/main/quit-guard.ts', import.meta.url), 'utf8')
  const main = fs.readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')

  // installQuitGuard 在 line 75 就执行，远早于单实例检查；清残留不能挂在它里面
  const install = guard.slice(guard.indexOf('export const installQuitGuard'))
  assert.doesNotMatch(install, /reapOrphanKansoProcesses\(\)/, '清残留又挪回拿锁之前了')
  // 必须落在 requestSingleInstanceLock 的 else（拿到锁）分支里
  const lockAt = main.indexOf('requestSingleInstanceLock')
  const reapAt = main.indexOf('reapOrphanKansoProcesses()')
  assert.ok(reapAt > lockAt, '清残留跑在拿锁之前')
  assert.match(main.slice(lockAt, reapAt), /\} else \{/, '清残留没落在拿到锁的那一支')

  // 早先那版 spawn 一个 detached 的 PowerShell 去枚举 Win32_Process，实测从没生效
  assert.doesNotMatch(guard, /spawn\(\s*'powershell/i, 'reap 又去依赖外部 PowerShell 了')
  assert.match(guard, /execFileSync\('tasklist'/, '改用同步 tasklist 才不依赖子进程活过父进程')
  assert.match(guard, /process\.kill\(pid\)/, '要用 Node 原生 kill')
})
