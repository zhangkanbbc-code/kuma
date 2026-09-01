// 装配失败后的「重试装配」——编译真模块跑真逻辑（护栏别只断言源码文本）。
//
// 铆是渲染层模块，顶层就要 document、内核与崩溃记账，没法直接 import。
// 这里把 mu.ts 连同两个桩一起复制进临时目录再编译：它的两个相对 import 就地
// 解析到桩上，源码本身一个字不改；末尾补一行 export 把装配入口露出来
// （谁把 mountModule / createPane 改了名，这里会编译失败——正是要的信号）。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { buildSync } from 'esbuild'

// ---- 迷你 DOM：只实现装配这条路上真正用到的那几样 ----
class FakeElement {
  constructor(tag) {
    this.tagName = tag
    this.children = []
    this.parentNode = null
    this.dataset = {}
    this.textContent = ''
    this.classes = new Set()
    this.handlers = new Map()
    this.html = ''
  }
  get className() {
    return [...this.classes].join(' ')
  }
  set className(value) {
    this.classes = new Set(String(value).split(' ').filter(Boolean))
  }
  get classList() {
    return {
      add: (name) => this.classes.add(name),
      remove: (name) => this.classes.delete(name),
      contains: (name) => this.classes.has(name),
      toggle: (name, on) => {
        const want = on ?? !this.classes.has(name)
        if (want) this.classes.add(name)
        else this.classes.delete(name)
        return want
      },
    }
  }
  get innerHTML() {
    return this.html
  }
  set innerHTML(value) {
    // 真 DOM 的语义：子树整个换掉，但**元素自己**（连同挂在它身上的监听）留着
    for (const child of this.children) child.parentNode = null
    this.children = []
    this.html = value
  }
  appendChild(node) {
    node.parentNode?.removeChild(node)
    node.parentNode = this
    this.children.push(node)
    return node
  }
  removeChild(node) {
    this.children = this.children.filter((child) => child !== node)
    node.parentNode = null
  }
  replaceWith(node) {
    const parent = this.parentNode
    if (!parent) return // 无父节点时是空转，与浏览器一致
    node.parentNode = parent
    parent.children = parent.children.map((child) => (child === this ? node : child))
    this.parentNode = null
  }
  addEventListener(type, handler) {
    const list = this.handlers.get(type) ?? []
    list.push(handler)
    this.handlers.set(type, list)
  }
  click() {
    for (const handler of [...(this.handlers.get('click') ?? [])]) handler({ target: this })
  }
}

globalThis.document = {
  body: new FakeElement('body'),
  createElement: (tag) => new FakeElement(tag),
  addEventListener: () => {},
  querySelector: () => null,
}

// ---- 把真的 mu.ts 编出来 ----
const KERNEL_STUB = [
  "const trace = (globalThis.__mountTrace ??= [])",
  "export const beginMountScope = (id) => trace.push('begin:' + id)",
  "export const endMountScope = () => trace.push('end')",
  "export const runMountCleanup = (id) => trace.push('cleanup:' + id)",
  'export const onGameScene = () => {}',
  'export const uiGet = (_key, fallback) => fallback',
  'export const uiSet = () => {}',
].join('\n')
const CRASH_STUB = [
  "export const recordCrash = (tag, error) => { (globalThis.__crashes ??= []).push(tag) }",
].join('\n')

// 临时目录要**照着源码树的形状**摆（renderer/ 与 shared/ 并列）：
// mu.ts 除了同目录那两个相对 import，还引 `../shared/dock-layout`——
// 那一个不桩、直接把真文件拷进来跟着一起编（它是纯逻辑，正该跑真的）。
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-mount-retry-'))
const tempDir = path.join(tempRoot, 'renderer')
const sharedDir = path.join(tempRoot, 'shared')
fs.mkdirSync(tempDir, { recursive: true })
fs.mkdirSync(sharedDir, { recursive: true })
fs.writeFileSync(path.join(tempDir, 'kernel.ts'), KERNEL_STUB)
fs.writeFileSync(path.join(tempDir, 'crash-guard.ts'), CRASH_STUB)
fs.copyFileSync(
  fileURLToPath(new URL('../src/shared/dock-layout.ts', import.meta.url)),
  path.join(sharedDir, 'dock-layout.ts'),
)
// 紧凑模式的偏好账同理：纯逻辑，拷真文件跟着一起编
fs.copyFileSync(
  fileURLToPath(new URL('../src/shared/compact-mode.ts', import.meta.url)),
  path.join(sharedDir, 'compact-mode.ts'),
)
// 铆的 openOverlay 会调启动动画的浮层入场。同样不打桩、拷真文件跟着一起编：
// 开关默认关，playOverlayEntrance 是彻底的空转，装配这条路上它一个字都不做。
fs.copyFileSync(
  fileURLToPath(new URL('../src/renderer/launch-glow.ts', import.meta.url)),
  path.join(tempDir, 'launch-glow.ts'),
)
fs.copyFileSync(
  fileURLToPath(new URL('../src/shared/launch-glow.ts', import.meta.url)),
  path.join(sharedDir, 'launch-glow.ts'),
)
fs.writeFileSync(
  path.join(tempDir, 'mu.ts'),
  `${fs.readFileSync(fileURLToPath(new URL('../src/renderer/mu.ts', import.meta.url)), 'utf8')}
export { createPane, mountModule }
`,
)
const output = path.join(tempDir, 'mu.cjs')
buildSync({
  entryPoints: [path.join(tempDir, 'mu.ts')],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'silent',
})
const { createPane, mountModule } = createRequire(import.meta.url)(output)

const retryButtonIn = (node) => {
  if (node.textContent === '重试装配') return node
  for (const child of node.children) {
    const hit = retryButtonIn(child)
    if (hit) return hit
  }
  return null
}
// 九个模块的 mount 清一色是 `pane = el` 再往 pane 上挂委托 + ResizeObserver，
// 这里照抄那副骨架：委托只在 mount 里挂一次。
const drillModule = (id, failTimes, log) => ({
  id,
  title: `演练${id}`,
  mount(pane) {
    log.mounted.push(pane)
    pane.addEventListener('click', () => {
      log.clicks += 1
    })
    if (log.mounted.length <= failTimes) throw new Error(`第 ${log.mounted.length} 次装配故意失败`)
  },
})

test('重试装配换一张新面板，模块挂在面板上的监听不会叠加', () => {
  const log = { mounted: [], clicks: 0 }
  const mod = drillModule('ta', 1, log)
  const host = document.createElement('div') // 相当于坞里的 .dock-panes
  const pane = createPane('ta')
  pane.classList.add('active') // 这一格正显示着
  pane.classList.add('narrow') // 模块自己的 ResizeObserver 加的
  host.appendChild(pane)

  assert.equal(mountModule(mod, pane), false)
  const retry = retryButtonIn(pane)
  assert.ok(retry, '崩溃盒里要有「重试装配」按钮')

  retry.click()
  assert.equal(log.mounted.length, 2, '重试要真的再跑一次 mount')
  const fresh = log.mounted[1]
  assert.notEqual(fresh, pane, '重试必须换一个全新的面板元素，不能清空后重挂同一个')

  // 换元素≠丢位置：新面板原地顶替旧的，模块 CSS 与显示态跟着走
  assert.deepEqual(host.children, [fresh])
  assert.equal(fresh.dataset.mod, 'ta')
  for (const cls of ['ws-pane', 'mod-ta', 'active']) {
    assert.ok(fresh.classList.contains(cls), `新面板缺 ${cls}，模块的渲染要靠它`)
  }
  // 模块自己加的类不继承——重挂时它会按新元素的尺寸重新算
  assert.ok(!fresh.classList.contains('narrow'))

  // 真正要守的那条：装配成功后一次点击只跑一遍委托。
  // 复用旧元素时第一次 mount 的监听还活着，这里会数到 2——
  // 展开/收起、勾选这类翻转交互跑两遍＝净效果为零＝用户眼里的死按钮。
  fresh.click()
  assert.equal(log.clicks, 1, '委托叠加了：一次点击跑了两遍')
  // 旧元素上的监听确实还在，只是随元素一起被丢出了文档
  pane.click()
  assert.equal(log.clicks, 2)
  assert.equal(pane.parentNode, null)
})

test('重试再失败：面板不会越堆越多，重试按钮照旧可用', () => {
  const log = { mounted: [], clicks: 0 }
  const mod = drillModule('tb', 2, log) // 前两次失败，第三次成功
  const host = document.createElement('div')
  host.appendChild(createPane('tb'))
  const traceFrom = globalThis.__mountTrace.length

  assert.equal(mountModule(mod, host.children[0]), false)
  retryButtonIn(host.children[0]).click() // 第二次仍失败
  assert.equal(host.children.length, 1, '坞格里自始至终只有一张面板')
  retryButtonIn(host.children[0]).click() // 第三次装上了

  assert.equal(log.mounted.length, 3)
  assert.equal(new Set(log.mounted).size, 3, '每次重试都该是全新元素')
  assert.equal(host.children.length, 1)
  assert.equal(retryButtonIn(host.children[0]), null, '装配成功后崩溃盒该消失')
  // 每次装配前都要先退掉上次挂了一半的内核订阅（内核侧的另一半防线）
  assert.deepEqual(
    globalThis.__mountTrace.slice(traceFrom).filter((entry) => entry !== 'end'),
    ['cleanup:tb', 'begin:tb', 'cleanup:tb', 'begin:tb', 'cleanup:tb', 'begin:tb'],
  )
})
