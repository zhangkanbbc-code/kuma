// 图鉴返回/前进历史的双栈账本——编译真模块跑真逻辑（护栏别只断言源码文本）。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { buildSync } from 'esbuild'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-nav-history-'))
const output = path.join(tempDir, 'nav-history.cjs')
buildSync({
  entryPoints: [fileURLToPath(new URL('../src/renderer/nav-history.ts', import.meta.url))],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'silent',
})
const require = createRequire(import.meta.url)
const { createNavHistory } = require(output)

test('返回再前进：目标层原样弹回，当前层进对面栈', () => {
  const nav = createNavHistory(5)
  nav.record('甲')
  nav.record('乙')
  assert.equal(nav.backCount(), 2)
  assert.equal(nav.peekBack(), '乙')

  const back = nav.goBack('丙') // 正看着丙，返回
  assert.equal(back, '乙')
  assert.equal(nav.backCount(), 1)
  assert.equal(nav.forwardCount(), 1)
  assert.equal(nav.peekForward(), '丙')

  const forward = nav.goForward('乙') // 又想回去
  assert.equal(forward, '丙')
  assert.equal(nav.backCount(), 2, '前进时当前层要回到返回栈')
  assert.equal(nav.forwardCount(), 0)
})

test('回头走了新路，前进栈作废', () => {
  const nav = createNavHistory(5)
  nav.record('甲')
  nav.record('乙')
  nav.goBack('丙')
  assert.equal(nav.forwardCount(), 1)
  nav.record('乙') // 从乙出发去了别处（新导航）
  assert.equal(nav.forwardCount(), 0, '有了新去向，原来的「前方」就不存在了')
  assert.equal(nav.backCount(), 2)
})

test('超过 5 层挤掉最老的，两个方向各自限层', () => {
  const nav = createNavHistory(5)
  for (const n of [1, 2, 3, 4, 5, 6, 7]) nav.record(n)
  assert.equal(nav.backCount(), 5)
  // 连续返回 5 次，弹出顺序 7→3；第 6 次空手而归
  const popped = []
  for (let i = 0; i < 6; i++) popped.push(nav.goBack(`当前${i}`))
  assert.deepEqual(popped, [7, 6, 5, 4, 3, null], '1、2 已被挤掉，空栈返回 null')
  // 前进栈也只留 5 层：刚才压进去 5 个「当前n」
  assert.equal(nav.forwardCount(), 5)
})

test('空栈返回/前进不动账，也不吞当前层', () => {
  const nav = createNavHistory(5)
  assert.equal(nav.goBack('现在'), null)
  assert.equal(nav.goForward('现在'), null)
  assert.equal(nav.backCount(), 0)
  assert.equal(nav.forwardCount(), 0)
  assert.equal(nav.peekBack(), null)
  assert.equal(nav.peekForward(), null)
})
