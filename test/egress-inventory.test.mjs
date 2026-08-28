// 全出口台账的护栏（2026-08-23 发布前全出口合规审计立）。
//
// 用户定的三层契约（见 kanso-disciplines「合规是发布门」）：
//   ① **kcsapi 红线**：永不主动请求 `/kcsapi/*`，唯一合法形态是被动拦截观察；
//   ② **kcs2/kcs 静态资源白区**：可以现取，但行为必须像人——点击驱动、无批量入口、
//      404 不重试、有冷却闸门、受钥里的开关管，且**只指向游戏自己的服务器**；
//   ③ **零第三方**：随包产物不向游戏服务器与本机之外的任何主机发请求。
//
// ---- 为什么这一份不得不用源码文本断言（家法要求注明理由）----
// 本仓的家法是「测逻辑不测源码正则」（见 shared/source-pattern-guards-miss-logic-bugs）。
// 这里**故意**破例，理由是这几条护栏要钉的东西本身就是「源码里存不存在某一类调用点」：
//   · 「除这 N 处以外没有别的地方能发请求」——这是对**整棵源码树的全称命题**，
//     没有任何可 import 的函数能表达它；真要动态验，只能起进程走一遍 UI
//     （那一遍已经在审计文书里做过了，但它进不了 npm test）。
//   · 一旦有人新写一处 `fetch(`，逻辑测试不会红（新代码没人调用它），
//     只有文本断言会红。**漏网的正是「新增的那一处」**，所以判据必须钉在存在性上。
// 能用逻辑测的部分（闸门冷却、上限、404 台账、探测判据）已经在
// voice-request-gate / voice-probe / art-archive 那几份里真调用函数跑过，这里不重复。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const SRC = new URL('../src/', import.meta.url)
const PRELOAD = new URL('../assets/preload/', import.meta.url)

/** 递归收集某目录下指定后缀的文件，返回 [相对路径, 文本] */
const collect = (dir, base, exts, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      collect(new URL(`${entry.name}/`, dir), base, exts, out)
      continue
    }
    if (!exts.some((e) => entry.name.endsWith(e))) continue
    const file = new URL(entry.name, dir)
    const rel = decodeURIComponent(file.pathname).slice(decodeURIComponent(base.pathname).length)
    out.push([rel, fs.readFileSync(file, 'utf8')])
  }
  return out
}

const runtimeFiles = () => [
  ...collect(SRC, SRC, ['.ts']).map(([rel, text]) => [`src/${rel}`, text]),
  ...collect(PRELOAD, PRELOAD, ['.js']).map(([rel, text]) => [`assets/preload/${rel}`, text]),
]

/** 注释与注释掉的代码不算调用点：判据只看真的会跑的那几行 */
const stripComments = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join('\n')

// ---------------------------------------------------------------- 出口清单

/**
 * 台账：**能真的发出网络请求**的调用点，逐个登记在册。
 * 新增一处而不更新这张表 = 红。删掉一处而不更新 = 也红（表不许留幻影）。
 */
const NETWORK_CALL_SITES = {
  // 主进程 · Chromium 网络栈（吃磁盘缓存、走代理、受 webRequest 观察）
  'src/main/archive-capture.ts': ['net.fetch'], // 显示/播放即入档的补字节，钥开关管
  'src/main/voice-probe.ts': ['net.fetch'], // 点一格探一条，钥开关管
  'src/main/map-art-json.ts': ['net.fetch'], // 海域美术元数据，钥开关管
  // 主进程 · 本机文件（file:// —— 不出网，登记以示已核）
  'src/main/kcs-resource.ts': ['net.fetch'],
  // 主进程 · 手机推送：唯一非游戏服务器的目的地，且地址由玩家亲手填、默认全关。
  // 2026-08-23 从 Node 的全局 `fetch` 改成 `net.fetch`（审计待裁④）：全局 fetch 走
  // Node 自己那套栈，会绕开玩家配的代理——全仓其余出口都在 Chromium 网络栈上，
  // 只剩这一条裸奔说不过去。
  'src/main/push.ts': ['net.fetch'],
  // 页面侧 · only-if-cached 读本机缓存，结构上发不出网络请求
  'assets/preload/art-archive.js': ['fetch'],
  'assets/preload/voice-archive.js': ['fetch'],
  'assets/preload/bgm-archive.js': ['fetch'],
}

test('出口清单：能发网络请求的调用点就是台账上那几处，不多不少', () => {
  // 判据钉在「构造/发起」这一类词上；`window.fetch = ` 这种包装不算新增出口
  // （game-audio.js 包了页面自己的 fetch/XHR 只为观察，转发的是原函数）。
  const pattern = /(?<![.\w])(?:net\.fetch|fetch)\s*\(|new\s+XMLHttpRequest|new\s+WebSocket|new\s+EventSource|sendBeacon\s*\(|https?\.(?:get|request)\s*\(/g
  const found = new Map()
  for (const [rel, text] of runtimeFiles()) {
    const code = stripComments(text)
    const hits = [...code.matchAll(pattern)].map((m) => m[0])
    if (hits.length) found.set(rel, hits)
  }

  // 观察型包装单独豁免并说明：它们只是把页面**自己**的请求转发出来看一眼
  const OBSERVERS = new Set(['assets/preload/game-audio.js', 'assets/preload/xhr-hack.js'])
  for (const rel of OBSERVERS) found.delete(rel)

  assert.deepEqual(
    [...found.keys()].sort(),
    Object.keys(NETWORK_CALL_SITES).sort(),
    '能发请求的文件与台账对不上——新增出口必须先进 NETWORK_CALL_SITES 并在' +
      '「审计-全出口合规.md」里登记目的地/触发条件/闸门/频控',
  )

  // 第二列（走的是哪套栈）也是判据，不是注解：`net.fetch` 走 Chromium 网络栈
  // （代理/证书/webRequest 与其余出口同一套），Node 的全局 `fetch` 绕开玩家配的代理。
  // 谁把哪一条悄悄换回全局 fetch，这里当场红。
  const shapes = Object.fromEntries(
    [...found].map(([rel, hits]) => [rel, [...new Set(hits.map((h) => h.replace(/\s*\($/, '')))].sort()]),
  )
  assert.deepEqual(
    shapes,
    Object.fromEntries(Object.entries(NETWORK_CALL_SITES).map(([rel, v]) => [rel, [...v].sort()])),
    '出口用的网络栈与台账记的对不上（改了栈就要同步台账与「审计-全出口合规.md」）',
  )
})

test('kcsapi 红线：没有任何一处把 /kcsapi/ 拼进会被请求的地址', () => {
  // 合法形态只有一种：**被动**拦截观察（xhr-hack 包住页面自己的 XHR、
  // game-api-broadcaster 按 pathname 分派）。那些地方 `/kcsapi/` 只出现在
  // **判断**里（startsWith / test / === / 对象键），绝不出现在 URL 拼装里。
  const offenders = []
  for (const [rel, text] of runtimeFiles()) {
    const code = stripComments(text)
    for (const m of code.matchAll(/[^\n]*kcsapi[^\n]*/gi)) {
      const line = m[0]
      // 只揪「看起来是在造一个可请求地址」的那种写法
      if (/(?:https?:)?\/\/[^\s'"`]*kcsapi/i.test(line) || /`[^`]*\$\{[^}]*\}[^`]*\/kcsapi/i.test(line)) {
        offenders.push(`${rel} → ${line.trim().slice(0, 120)}`)
      }
    }
  }
  assert.deepEqual(offenders, [], `出现了疑似主动构造的 kcsapi 地址：\n${offenders.join('\n')}`)
})

test('第三方零请求：会被拿去 fetch 的绝对地址，主机只能是游戏服务器或玩家自填的推送地址', () => {
  // 判据：源码里**硬编码的绝对 http(s) 地址**，其主机必须在这张白名单里。
  // 白名单之外的新主机一律红——这条就是 tsunkit 那次的泛化版
  //（那一条按站名钉，这一条按「有没有出现新主机」钉，能拦住下一个还没起名的）。
  //
  // 名单里每一条的性质都注明。ntfy.sh 2026-08-23 起**不再是预置目标**：
  // 源码里剩下的那几处只是输入框示例与报错示例文本，玩家不亲手填就没有目标。
  const ALLOWED_HOSTS = new Map([
    ['play.games.dmm.com', '游戏本体主页（webview src 默认值）'],
    ['games.dmm.com', '只做 location.href 比较，不导航过去'],
    ['ntfy.sh', '手机推送的输入框示例与报错示例文本 · 不是预置目标 · 玩家不亲手填就一条请求都不发'],
    ['api.day.app', 'Bark 地址的输入占位与报错示例文本，不是请求目标'],
    ['zh.kcwiki.cn', '资料出处外链 · shell.openExternal 交系统浏览器'],
    ['kancolle.fandom.com', '资料出处外链 · openExternal'],
    ['kanlog.info', '资料出处外链 · openExternal'],
    ['kancolle-calc.net', '编成导出链接 · 只写进剪贴板，产物从不请求它'],
    ['github.com', '致谢/许可外链 · openExternal'],
    ['ja.wikipedia.org', '史实出处外链 · openExternal'],
    ['dic.pixiv.net', '史实出处外链 · openExternal'],
    ['wikiwiki.jp', '事实层出处标注（sourceUrl 字段），不请求'],
    ['creativecommons.org', '许可条款外链'],
    ['www.w3.org', 'SVG/XML 命名空间，不是地址'],
    ['example.invalid', '纯逻辑函数的默认 base，永远不会被请求'],
  ])

  const offenders = []
  for (const [rel, text] of runtimeFiles()) {
    for (const m of stripComments(text).matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)) {
      const host = m[1].toLowerCase()
      if (!ALLOWED_HOSTS.has(host)) offenders.push(`${rel} → ${m[0]}`)
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `运行时源码里出现了白名单之外的主机（每新增一个都要先过一遍三层契约）：\n${offenders.join('\n')}`,
  )
})

// ---------------------------------------------------------------- 行为要像人

test('钥开关是主进程的不变量：三条会真出网的路都自己判一次 kanso.remoteArt', () => {
  // 渲染层本来也有一道闸（remoteUrl() 关着时返回 null），但那一道挡不住
  // 「以后谁在渲染层新开一条调用」。所以每一条会出网的路都要在主进程自己判。
  // 2026-08-23 审计时 map-art-json 缺这一份，当场补上。
  for (const file of ['archive-capture', 'voice-probe', 'map-art-json']) {
    const text = fs.readFileSync(new URL(`main/${file}.ts`, SRC), 'utf8')
    assert.match(
      stripComments(text),
      /config\.get\(\s*'kanso\.remoteArt'/,
      `${file}.ts 少了钥开关那道闸——现取路径必须能被玩家一关了之`,
    )
  }
})

test('语音探测没有批量入口：一次点击一格，源码里不许出现对它的循环/并发调用', () => {
  // 整个域的前提就是玩家逐个点。打开一页扫 53 个槽 = 把一次浏览变成
  // 对游戏服务器的 53 连发，那正是「行为不像人」的样子。
  const files = runtimeFiles().filter(([rel]) => !rel.endsWith('main/voice-probe.ts'))
  const offenders = []
  for (const [rel, text] of files) {
    const code = stripComments(text)
    if (!/probeVoiceSlot|voice-probe/i.test(code)) continue
    for (const m of code.matchAll(/[^\n]*probeVoiceSlot[^\n]*/g)) {
      const line = m[0]
      if (/\b(?:for|while|\.map\(|\.forEach\(|Promise\.all)\b/.test(line)) {
        offenders.push(`${rel} → ${line.trim().slice(0, 120)}`)
      }
    }
  }
  assert.deepEqual(offenders, [], `探测被批量调用了：\n${offenders.join('\n')}`)
})

test('档案取字节永远是 only-if-cached：页面侧那三条路不许退化成真请求', () => {
  // `only-if-cached` 在缓存没命中时是**抛错**，不会退化成一次网络请求。
  // 所以这两个文件里的 fetch 必须带着它——少了就等于把「顺手留一份」
  // 变成一场对游戏 CDN 的补拉。
  for (const file of ['art-archive.js', 'voice-archive.js', 'bgm-archive.js']) {
    const code = stripComments(fs.readFileSync(new URL(file, PRELOAD), 'utf8'))
    const calls = [...code.matchAll(/fetch\([^)]*\)/g)].map((m) => m[0])
    assert.ok(calls.length > 0, `${file} 里没找到 fetch 调用，判据要跟着改`)
    for (const call of calls) {
      assert.match(call, /only-if-cached/, `${file} 的 fetch 少了 only-if-cached：${call}`)
      assert.match(call, /same-origin/, `${file} 的 fetch 少了 same-origin：${call}`)
    }
    // 失败分支不许重试、不许换别的取法
    assert.equal(
      /\.retry|setInterval|for\s*\(|while\s*\(/.test(code),
      false,
      `${file} 里出现了重试/轮询的形状`,
    )
  }
})

test('没有遥测、没有崩溃上报、没有自动更新：这几类根本不该存在', () => {
  // 玩家问「安全吗」时，「产物里连一行上报代码都没有」是能直接给出的答案。
  // 词边界不能省：`Sentry` 不带边界会命中 `EventBonusEntry` / `ShipClassEntry`
  // 这类完全无关的类型名（第一版就是这么误报的）。
  const banned =
    /\b(?:crashReporter|setUploadToURL|autoUpdater|Sentry|analytics|telemetry|gtag|googletagmanager)\b/i
  const offenders = []
  for (const [rel, text] of runtimeFiles()) {
    if (banned.test(stripComments(text))) offenders.push(rel)
  }
  assert.deepEqual(offenders, [], `出现了上报/自动更新类代码：\n${offenders.join('\n')}`)
})

test('随包矿脉包不含维护者侧的抓取脚本产物入口：fetch 脚本只许待在 scripts/', () => {
  // 抓取脚本会去 kcwiki / wikiwiki / kanlog 等站点取数据——那是**维护者侧**的事，
  // 绝不能进产物。判据：src/ 与 assets/preload/ 里不许 import scripts/ 下的东西。
  const offenders = []
  for (const [rel, text] of runtimeFiles()) {
    for (const m of stripComments(text).matchAll(/(?:from|require\()\s*['"]([^'"]*scripts\/[^'"]*)['"]/g)) {
      offenders.push(`${rel} → ${m[1]}`)
    }
  }
  assert.deepEqual(offenders, [], `运行时源码引用了 scripts/ 下的维护者侧代码：\n${offenders.join('\n')}`)
})
