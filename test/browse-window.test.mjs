// 浏览窗（2026-08-30，产品人原话「能像 poi 一样单开多个 DMM 为主页的浏览器页面」）。
//
// 守两件事：
//   ① 地址栏那一格的判据——它认错一条，玩家就会以为自己打开了某一页、其实去了别处；
//   ② **浏览窗不是游戏页**：不挂游戏 preload、不被记成游戏 webContents、不共用
//      抓包桥。这一条错了不报错——它的表现是「安静地多出一个能伪造游戏流量的页面」。
//
// ② 那一族不得不用源码文本断言（家法要求注明理由，见 shared/source-pattern-guards-…）：
// 判据本身是「某几行参数在不在」与「某个调用点只出现在哪一处」，是对源码树的存在性
// 命题，没有可 import 的函数能表达；真要动态验只能起 Electron 开窗，那进不了 npm test。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import browseUrl from '../dist/shared/browse-url.js'
import userAgent from '../dist/shared/user-agent.js'

const { BROWSE_HOME_URL, normalizeBrowseInput } = browseUrl
const { cleanUserAgent } = userAgent

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
/** 「某个写法一处都不许有」这类判据只能看真会跑的行——注释里正解释着它为什么不许有。 */
const code = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join('\n')

// ---- ① 主页与地址栏的判据 ----

test('主页是 DMM 本站那一条，且它自己过得了地址栏的判据', () => {
  assert.equal(BROWSE_HOME_URL, 'https://www.dmm.com/')
  assert.equal(normalizeBrowseInput(BROWSE_HOME_URL), BROWSE_HOME_URL)
})

test('主页不是舰C 详情页：那一页会把主窗正在玩的那一局挤下线', () => {
  // 玩家实测（2026-08-30 换掉的就是它）：详情页会触发 DMM 的会话动作，
  // 而同一个账号只留一处会话——按一下顶栏「新窗」，主窗那局当场掉线。
  assert.ok(!BROWSE_HOME_URL.includes('detail/kancolle'), '主页改回了会踢掉游戏会话的详情页')
})

test('主页不是游戏本体那一条：本体在主窗跑着，浏览窗默认再开一份等于双开', () => {
  const gameUrl = fs.readFileSync(new URL('../dist/shared/game-url.js', import.meta.url), 'utf8')
  assert.ok(gameUrl.includes('play.games.dmm.com/game/kancolle'))
  assert.ok(!BROWSE_HOME_URL.includes('play.games.dmm.com'), '浏览窗主页跑去开游戏本体了')
})

test('http / https 原样收，别的协议一律不认', () => {
  for (const ok of [
    'https://games.dmm.com/detail/kancolle',
    'http://example.test/a?b=c#d',
    'HTTPS://games.dmm.com/',
  ]) {
    assert.equal(normalizeBrowseInput(ok), ok, `${ok} 该被原样收下`)
  }
  // 这一层网页与游戏共用 defaultSession（kanso-cache:// 就注册在这个会话上）
  for (const bad of [
    'file:///C:/Windows/System32/drivers/etc/hosts',
    'javascript:alert(1)',
    'data:text/html,<h1>hi</h1>',
    'chrome://settings',
    'kanso-cache://resource/kcs/foo.png',
    'about:blank',
  ]) {
    assert.equal(normalizeBrowseInput(bad), null, `${bad} 不该能从地址栏进得来`)
  }
})

test('少了协议是最常犯的手滑，补 https 再判一次', () => {
  assert.equal(normalizeBrowseInput('games.dmm.com/detail/kancolle'), 'https://games.dmm.com/detail/kancolle')
  assert.equal(normalizeBrowseInput('  example.test  '), 'https://example.test')
})

test('补协议只补给「看着像主机名」的，别把别的东西也补成网址', () => {
  // 补了会把 javascript:alert(1) 变成 https://javascript:alert(1)——看着像网址，
  // 其实哪也去不了，而玩家只会觉得地址栏坏了
  assert.equal(normalizeBrowseInput('javascript:alert(1)'), null)
  // 没有点的不像主机名：这是想搜索，不是想导航。浏览窗不带搜索引擎（那是新的第三方出口）
  assert.equal(normalizeBrowseInput('舰これ 攻略'), null)
  assert.equal(normalizeBrowseInput('kancolle'), null)
})

test('空、不是字符串——一律 null，不抛异常', () => {
  for (const bad of ['', '   ', null, undefined, 0, 123, {}, [], ['https://example.test']]) {
    assert.equal(normalizeBrowseInput(bad), null, `${JSON.stringify(bad)} 不该被认成网址`)
  }
})

// ---- ①bis 发出去的 UA 里不许留下我们自己的标记 ----

test('UA 清洗：Electron 与应用名两段都去掉', () => {
  // 这一条就是 2026-08-30 实测到的那份原样（开发态取的 navigator.userAgent）
  const raw =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'kuma/1.0.0-beta.1 Chrome/150.0.7871.129 Electron/43.2.0 Safari/537.36'
  const cleaned = cleanUserAgent(raw)
  for (const mark of ['kuma', 'kanso', 'Electron']) {
    assert.ok(!cleaned.includes(mark), `清洗后仍带着 ${mark}：${cleaned}`)
  }
  assert.equal(
    cleaned,
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)' +
      ' Chrome/150.0.7871.129 Safari/537.36',
  )
  // 改名前的旧标记也还认（用过老版本、UA 里还写着 kanso 的情形）
  assert.ok(!cleanUserAgent(raw.replace('kuma/', 'kanso/')).includes('kanso'))
})

test('UA 清洗只有一份判据：游戏页与浏览窗都引它，谁也别再自己写正则', () => {
  // 各写各的正是这条曾经空转的原因：游戏页那份找的是 kanso/，改名之后一个字都没匹配上，
  // 而这种失效不报错——UA 照发，只是多带了应用名和版本号出去
  for (const rel of ['src/renderer/index.ts', 'src/renderer/browse-window.ts']) {
    assert.match(code(rel), /cleanUserAgent\(navigator\.userAgent\)/, `${rel} 没走共用判据`)
    assert.ok(
      !/navigator\.userAgent\s*\.?\s*\n?\s*\.replace/.test(code(rel)),
      `${rel} 又在本地写了一份 UA 清洗`,
    )
  }
})

// ---- ② 浏览窗不是游戏页 ----

test('浏览窗那层网页的参数由主进程按死，preload 明确清掉', () => {
  const main = read('src/main/browse-window.ts')
  assert.match(main, /will-attach-webview/, '浏览窗没有拦 webview 附着，标签上写什么就是什么')
  assert.match(main, /delete webPreferences\.preload/, '没清 preload：游戏 preload 是抓包桥的入口')
  assert.match(main, /webPreferences\.nodeIntegration = false/)
  assert.match(main, /webPreferences\.contextIsolation = true/)
  assert.match(main, /webPreferences\.webSecurity = true/)
  assert.match(main, /webPreferences\.webviewTag = false/)
})

test('渲染层那侧不给 webview 挂 preload，也不关同源策略', () => {
  const shell = code('src/renderer/browse-window.ts')
  assert.ok(!/setAttribute\('preload'/.test(shell), '浏览窗给自己挂了 preload')
  assert.ok(!/disablewebsecurity/.test(shell), '浏览窗关掉了同源策略——那是游戏页才要的')
  assert.ok(!/nodeintegration/i.test(shell), '浏览窗给页面开了 Node')
})

test('游戏 webContents 的认定只有一处，浏览窗进不去那本册子', () => {
  // 认定 = 主窗 did-attach-webview 里记 id；kcs-resource 的记账与入档全按这个 id 过闸。
  // 多一处写入点就意味着「谁是游戏页」可以被别的窗口改写。
  const mainDir = new URL('../src/main/', import.meta.url)
  const callers = fs
    .readdirSync(mainDir, { recursive: true })
    .filter((name) => String(name).endsWith('.ts'))
    .map((name) => String(name).split('\\').join('/'))
    .filter((name) => /setKcsResourceGameWebContentsId\(/.test(read(`src/main/${name}`)))
  assert.deepEqual(
    callers.sort(),
    ['index.ts'],
    'setKcsResourceGameWebContentsId 多了调用点——「谁是游戏页」就能被别的窗口改写了',
  )
})

test('会话不许换：换了 partition 就要玩家再登录一次 DMM，代理也得再配一遍', () => {
  assert.ok(!/partition/i.test(code('src/main/browse-window.ts')), '浏览窗给自己开了独立会话')
  assert.ok(!/partition/i.test(code('src/renderer/browse-window.ts')), '浏览窗给自己开了独立会话')
  // 代理设在 defaultSession 上，两边同一个会话才叫「自动互通」
  assert.match(read('src/main/proxy.ts'), /session\.defaultSession\.setProxy/)
})

// ---- ③ 退出治理 ----

test('主窗关掉，开着的浏览窗跟着走', () => {
  const index = read('src/main/index.ts')
  assert.match(
    index,
    /win\.on\('closed'[\s\S]{0,600}closeAllBrowseWindows\(\)/,
    '主窗 closed 里没关浏览窗——留一扇在那儿就等不到 window-all-closed，应用关不掉',
  )
  assert.match(read('src/main/browse-window.ts'), /export const closeAllBrowseWindows/)
})

test('第三道退出防线按「出生就记 PID」收，浏览窗天然在名单里', () => {
  // 这条是历史事故换来的：退出时再问，getAllWebContents 与 getAppMetrics 都已经
  // 不认得那个还活着的渲染进程了。所以判据只能钉在收割源上。
  const guard = read('src/main/quit-guard.ts')
  assert.match(
    guard,
    /app\.on\('web-contents-created'[\s\S]{0,200}rememberPidOf\(contents\)/,
    '收割源改了：不再是「出生就记」的话，新开的窗口就掉在防线外面',
  )
})

// ---- ④ 顶栏入口与装配 ----

test('顶栏有「新窗」，一路接到主进程', () => {
  assert.match(
    read('src/renderer/index.html'),
    /<button id="btn-browse" title="新开浏览窗 · 可多开 · 与游戏共用登录与代理">新窗<\/button>/,
  )
  assert.match(read('src/renderer/index.ts'), /#btn-browse'\)\.addEventListener\('click'/)
  assert.match(read('src/renderer/kernel.ts'), /ipcRenderer\.invoke\('window:browse'\)/)
  assert.match(read('src/main/index.ts'), /ipcMain\.handle\('window:browse'/)
})

test('按一次开新的一扇，不是把已经开着的那扇拿来聚焦', () => {
  // 「多开」是这个功能的全部——复用已有窗口的写法（两扇副窗那种）在这里是错的
  const main = read('src/main/browse-window.ts')
  assert.ok(!/isMinimized\(\)/.test(main), '浏览窗照抄了副窗的「已开就聚焦」')
  assert.match(main, /openWindows = new Set<BrowserWindow>\(\)/)
})

test('新的渲染入口进了构建：html 要拷、bundle 要打', () => {
  const build = read('scripts/build.mjs')
  assert.match(build, /browse: path\.join\(root, 'src', 'renderer', 'browse-window\.ts'\)/)
  assert.match(build, /'browse\.html'/)
  // 产物真的在（npm test 先跑 build）
  assert.ok(fs.existsSync(new URL('../dist/renderer/browse.html', import.meta.url)))
  assert.ok(fs.existsSync(new URL('../dist/renderer/browse.js', import.meta.url)))
  assert.match(read('src/main/browse-window.ts'), /'dist', 'renderer', 'browse\.html'/)
})
