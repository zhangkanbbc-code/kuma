import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import crashRecord from '../dist/shared/crash-record.js'

const { benignReason, createCrashJournal, describeError } = crashRecord

// 时钟可注入：记账的去重与「挤掉最旧」都按时间判，不能让测试去猜真实时钟。
const fakeClock = (start = 1000) => {
  let t = start
  return { now: () => (t += 1000), set: (v) => (t = v) }
}

test('同一处反复出错只累加计数，不占新格', () => {
  const clock = fakeClock()
  const j = createCrashJournal({ now: clock.now })
  j.record('kernel:tick', new Error('boom'))
  j.record('kernel:tick', new Error('boom'))
  j.record('kernel:tick', new Error('boom'))
  const list = j.list()
  assert.equal(list.length, 1)
  assert.equal(list[0].count, 3)
  // 首次与最近一次都要留：只有首次能对上「什么时候开始坏的」
  assert.notEqual(list[0].firstTs, list[0].lastTs)
})

test('同一环节的不同错误分开记', () => {
  const j = createCrashJournal({ now: fakeClock().now })
  j.record('mount:ji', new Error('a'))
  j.record('mount:ji', new Error('b'))
  assert.equal(j.list().length, 2)
})

test('记满了挤掉最旧的——新错误比陈年旧账更有诊断价值', () => {
  const clock = fakeClock()
  const j = createCrashJournal({ maxDistinct: 3, now: clock.now })
  j.record('s', new Error('第一条'))
  j.record('s', new Error('第二条'))
  j.record('s', new Error('第三条'))
  j.record('s', new Error('第四条'))
  const messages = j.list().map((r) => r.message)
  assert.equal(messages.length, 3)
  assert.ok(!messages.includes('第一条'))
  assert.deepEqual(messages, ['第四条', '第三条', '第二条']) // 最近的在前
})

test('挤人看的是最近一次出错的时间，不是首次', () => {
  const clock = fakeClock()
  const j = createCrashJournal({ maxDistinct: 2, now: clock.now })
  j.record('s', new Error('老但仍在犯'))
  j.record('s', new Error('后来的'))
  j.record('s', new Error('老但仍在犯')) // 刷新 lastTs
  j.record('s', new Error('最新的')) // 该挤掉「后来的」
  const messages = j.list().map((r) => r.message)
  assert.ok(messages.includes('老但仍在犯'))
  assert.ok(!messages.includes('后来的'))
})

test('订阅者自己抛异常不能拖垮记账', () => {
  const j = createCrashJournal({ now: fakeClock().now })
  j.subscribe(() => {
    throw new Error('角标渲染炸了')
  })
  let sawSecond = false
  j.subscribe(() => {
    sawSecond = true
  })
  assert.doesNotThrow(() => j.record('s', new Error('原始错误')))
  assert.equal(sawSecond, true) // 前一个订阅者炸了，后一个照样收到
  assert.equal(j.list().length, 1)
})

test('落盘回调抛异常也不能反过来制造新的崩溃', () => {
  const j = createCrashJournal({
    now: fakeClock().now,
    onRecord: () => {
      throw new Error('磁盘满了')
    },
  })
  assert.doesNotThrow(() => j.record('s', new Error('原始错误')))
  assert.equal(j.list()[0].message, '原始错误') // 记录本身没丢
})

test('什么都能接住：字符串、null、循环引用', () => {
  assert.equal(describeError('直接抛的字符串').message, '直接抛的字符串')
  assert.equal(describeError(null).message, 'null')
  assert.equal(describeError(undefined).message, 'undefined')
  const circular = { name: 'x' }
  circular.self = circular
  assert.doesNotThrow(() => describeError(circular))
  // 没有 message 的 Error 退回类名，不能记成空字符串
  assert.equal(describeError(new TypeError()).message, 'TypeError')
  assert.ok(describeError(new Error('有栈')).stack?.includes('有栈'))
})

test('清空要通知订阅者，否则角标会一直挂着', () => {
  const j = createCrashJournal({ now: fakeClock().now })
  let last = null
  j.subscribe((records) => {
    last = records
  })
  j.record('s', new Error('x'))
  assert.equal(last.length, 1)
  j.clear()
  assert.equal(last.length, 0)
  assert.equal(j.list().length, 0)
})

test('已知噪音要记但不当错误——否则角标常亮，人就对它脱敏了', () => {
  const j = createCrashJournal({ now: fakeClock().now })
  const noise = j.record(
    'window:error',
    'ResizeObserver loop completed with undelivered notifications.',
  )
  assert.equal(noise.benign, true)
  // 旧版 Chrome 的文案也要认
  assert.equal(j.record('window:error', 'ResizeObserver loop limit exceeded').benign, true)
  // 真错误不能被误判成噪音
  assert.equal(j.record('mount:ji', new Error('Cannot read properties of null')).benign, false)
  // 记账本身照记：高频出现是有意义的信号，不能直接丢
  assert.equal(j.list().length, 3)
})

test('噪音表要能说清「为什么它不是错误」，且不许滥杀', () => {
  assert.match(benignReason('ResizeObserver loop limit exceeded'), /非异常/)
  assert.equal(benignReason('TypeError: x is not a function'), null)
  // 名字里带 ResizeObserver 的真错误不能被这条规则连坐
  assert.equal(benignReason('ResizeObserver is not defined'), null)
  assert.equal(benignReason('Failed to construct ResizeObserver'), null)
})

test('噪音不落盘、不进角标计数', () => {
  const guard = read('../src/renderer/crash-guard.ts')
  // 落盘前就要拦掉：它会周期性复现，落盘只会把真记录冲走
  assert.match(guard, /if \(entry\.benign\) return/)
  // 角标与面板标题都只数真错误（renderPanel 一处、sync 一处）
  assert.equal((guard.match(/filter\(\(r\) => !r\.benign\)/g) ?? []).length, 2)
  // 角标绝不能直接数全部记录——那就等于噪音也让 ⚠ 亮起来
  assert.doesNotMatch(guard, /badge\.textContent = `⚠ \$\{list\.length\}`/)
  // 钥的运行诊断卡片同理，否则它会常年报红
  assert.match(read('../src/renderer/modules/yu.ts'), /crashLog\(\)\.filter\(\(r\) => !r\.benign\)/)
})

// ---- 源码级守卫：隔离一旦被谁改回裸调用，这里立刻红 ----

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')

test('内核派发必须逐个隔离——裸 forEach 会让一个模块拖垮后面所有模块', () => {
  const kernel = read('../src/renderer/kernel.ts')
  for (const listeners of [
    'patchListeners',
    'tickListeners',
    'sortieScreenListeners',
    'gameSceneListeners',
    'powerupResultListeners',
    'marriageListeners',
    'qpListeners',
    'zoomListeners',
    'mourningListeners',
  ]) {
    assert.doesNotMatch(
      kernel,
      new RegExp(`${listeners}\\.forEach`),
      `${listeners} 又变回裸 forEach 了：一个订阅者抛异常，排在后面的模块就再也收不到更新`,
    )
  }
  // 九类监听器都得走隔离分发（safeEach 或计时版 timedEach）——
  // patch 初始快照+增量两处；tick 一处；qp 补丁+state 两处；
  // zoom / 出击画面 / 游戏场景 / 近代化 / 婚舰 / 哀悼态各一处
  // （婚舰那一处包在 dispatchMarriage 里：报文到达与调试模拟共用同一次派发）
  // 第 9 处是 settleView：换完 DOM、还原滚动之前那一拍的收尾登记（registerViewSettler）
  // ——它跑在重渲染的关键路径上，一个收尾抛异常不该让后面的收尾和滚动还原一起没掉
  assert.equal((kernel.match(/safeEach\(/g) ?? []).length, 9)
  assert.equal((kernel.match(/timedEach\(/g) ?? []).length, 3)
  // 首见志的派发在单独的文件里，同样不许裸跑
  const firstEncounter = read('../src/renderer/first-encounter.ts')
  assert.doesNotMatch(firstEncounter, /listeners\.forEach/)
  assert.match(firstEncounter, /safeEach\('first-encounter'/)
})

test('模块装配必须逐个隔离——一个 mount 抛异常曾经等于黑屏', () => {
  // 注释里会引用旧写法来解释为什么改，不能算进来
  const mu = read('../src/renderer/mu.ts')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
  // mod.mount 只该出现一次：mountModule 里那个包在 try 中的调用。
  // 装配循环（普通模块 + 弹窗模块两处）必须经由它，不能自己直接调。
  assert.equal(
    (mu.match(/mod\.mount\(/g) ?? []).length,
    1,
    '有人绕过 mountModule 直接调 mod.mount 了：那一处抛异常会让后面的模块全部装不上',
  )
  assert.match(mu, /const mountModule = /)
  // 两个装配点 + 重试都得经由它。重试传的不是原 pane 而是新建的一张
  // （行为护栏在 mount-retry.test.mjs），所以这里只认调用点、不认实参。
  assert.equal((mu.match(/mountModule\(mod, /g) ?? []).length, 3)
  // onShow 同理：切标签时抛异常会把激活流程停在半路
  assert.doesNotMatch(mu, /onShow\?\.\(\)/, 'onShow 又变回裸调用了')
  assert.match(mu, /const showModule = /)
})

test('错误处理里不许出现裸 console——它自己就是会抛的那一个', () => {
  // 2026-08-07 实测：打包版是 GUI 子系统，stdout 断开后 console.error 抛 EPIPE，
  // 而 uncaughtException handler 里又调 console.error → 再抛 → 自激循环，
  // 把 crash.log 刷到 606MB、170 万条同样的记录，进程空转不退。
  for (const rel of ['../src/main/crash-log.ts', '../src/main/quit-guard.ts']) {
    const code = read(rel)
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n')
      // safeConsole 的定义体内部当然要调真的 console
      .replace(/export const safeConsole[\s\S]*?\n}/, '')
    assert.doesNotMatch(code, /(?<!safe)console\.(error|warn|log)/, `${rel} 里有裸 console`)
  }
  // 主进程的两个兜底 handler 必须走 reportFatal，不能自己打日志
  const main = read('../src/main/index.ts')
  assert.match(main, /uncaughtException', \(e\) => reportFatal\(/)
  assert.match(main, /unhandledRejection', \(reason\) => reportFatal\(/)
})

test('同一条错误反复出现要限流，否则日志几分钟就没法看了', () => {
  const src = read('../src/main/crash-log.ts')
  assert.match(src, /const seen = new Map<string, number>\(\)/)
  // 限流骨架抽成了 createRollingLog（crash.log 与 perf.log 共用同一份纪律）
  assert.match(src, /count > options\.verbatimTimes && count % options\.summaryEvery !== 0/)
  assert.match(src, /createRollingLog\(LOG_PATH, \{ verbatimTimes: 3, summaryEvery: 500 \}\)/)
  // 体积检查必须在运行中也生效——只在启动时裁一次的话，被刷爆时毫无办法
  assert.doesNotMatch(src, /let trimmed = false/, '体积检查又变回「每次启动只裁一次」了')
  assert.match(src, /sinceTrimCheck/)
})

test('装配账要写到 DOM 上——隔离之后冒烟只能靠它发现「少装了一格」', () => {
  const mu = read('../src/renderer/mu.ts')
  assert.match(mu, /dataset\.kansoMounted = `\$\{mountedModules\.size\}\/\$\{expectedModules\}`/)
  assert.match(mu, /dataset\.kansoCrashed = /)
  // 冒烟必须真的去读它，否则模块崩了照样一片绿
  const main = read('../src/main/index.ts')
  assert.match(main, /kansoMounted/)
  assert.match(main, /kansoCrashed/)
  assert.match(main, /smoke: 模块装配失败/)
  // 成功标记只能在模块自查通过之后打
  assert.ok(
    main.indexOf('smoke: modules') < main.indexOf('smoke: window ok'),
    '成功标记跑到了模块自查前面，装配失败也会被判绿',
  )
})

test('渲染层启动不许再是裸 void async——静默 reject 就是黑屏', () => {
  const index = read('../src/renderer/index.ts')
  assert.match(index, /installCrashNet\(\)/)
  assert.match(index, /startupFailed\(/)
  // 内核起不来必须把错误摆到屏幕上，而不是 return 了事
  assert.match(index, /startupFailed\('数据内核', error\)/)
})

test('主进程要感知渲染进程没了，并在退出时带走子进程', () => {
  const crashLogSrc = read('../src/main/crash-log.ts')
  assert.match(crashLogSrc, /app\.on\('render-process-gone'/)
  assert.match(crashLogSrc, /app\.on\('child-process-gone'/)
  assert.match(read('../src/main/quit-guard.ts'), /export const installQuitGuard/)
  const main = read('../src/main/index.ts')
  assert.match(main, /installCrashLogging\(\)/)
  assert.match(main, /installQuitGuard\(\)/)
  // 退出兜底必须排在铭之后注册：账本存盘要先落地
  assert.ok(
    main.indexOf("require('./mg')") < main.indexOf('installQuitGuard()'),
    'installQuitGuard 跑到了铭前面，before-quit 会先关子进程再存账本',
  )
})
