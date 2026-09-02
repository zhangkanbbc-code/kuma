// 游戏页面网址可配置（2026-08-30，玩家原话「希望大佬有时间能适配 poi 那种修改网址的功能」）。
//
// 守的是一件事：**这一格填坏了，游戏页照样打得开**。
// 它错了不报错——白屏没有异常、没有日志，玩家也认不出白屏是自己刚粘错一行造成的，
// 只会觉得 kuma 坏了。所以判据（shared/game-url）逐条实算，设置那张卡连同
// 「填坏之后钥怎么说」一起从渲染产物上验。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import gameUrl from '../dist/shared/game-url.js'
import sections from '../dist/shared/settings-sections.js'
import { cardHtml, cardsIn, mountYu } from './fixtures/render-yu.mjs'

const { DEFAULT_GAME_URL, GAME_URL_CONFIG_KEY, isValidGameUrl, normalizeGameUrl } = gameUrl
const { SETTINGS_SECTION_UI_KEY, settingsSectionOf } = sections

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const NETWORK = { [SETTINGS_SECTION_UI_KEY]: 'network' }
const cardOf = (yu) => cardHtml(yu.pane.innerHTML, 'game-url')

// ---- ① 判据本身 ----

test('默认值就是原先写死的那条 DMM 游戏页', () => {
  assert.equal(DEFAULT_GAME_URL, 'https://play.games.dmm.com/game/kancolle')
  assert.equal(GAME_URL_CONFIG_KEY, 'kanso.homepage')
  assert.ok(isValidGameUrl(DEFAULT_GAME_URL), '默认值自己都过不了判据')
  assert.equal(normalizeGameUrl(DEFAULT_GAME_URL), DEFAULT_GAME_URL)
})

test('只收 http / https，别的协议一律不算网址', () => {
  for (const ok of [
    'http://203.104.209.7/kcs2/index.php',
    'https://play.games.dmm.com/game/kancolle',
    'HTTPS://play.games.dmm.com/game/kancolle',
    'http://localhost:8080/',
  ]) {
    assert.equal(isValidGameUrl(ok), true, `${ok} 该被认成合法网址`)
    assert.equal(normalizeGameUrl(ok), ok, `${ok} 不该被改写`)
  }
  // file: 与 javascript: 进的是一个开了 disablewebsecurity、挂着特权 preload 的容器
  for (const bad of [
    'file:///C:/Windows/System32/drivers/etc/hosts',
    'javascript:alert(1)',
    'data:text/html,<h1>hi</h1>',
    'chrome://settings',
    'kanso-cache://x/kcs/foo.png',
  ]) {
    assert.equal(isValidGameUrl(bad), false, `${bad} 不该被当成游戏页网址`)
    assert.equal(normalizeGameUrl(bad), DEFAULT_GAME_URL)
  }
})

test('空、写了半截、根本不是字符串——统统回落默认，不抛异常', () => {
  for (const bad of [
    '',
    '   ',
    'play.games.dmm.com/game/kancolle', // 少了协议：最容易发生的那种手滑
    '"https://play.games.dmm.com/game/kancolle"', // 连引号一起粘进来
    'http://',
    'ｈｔｔｐｓ://例子',
    null,
    undefined,
    0,
    123,
    {},
    [],
    ['https://play.games.dmm.com/game/kancolle'],
  ]) {
    assert.equal(isValidGameUrl(bad), false, `${JSON.stringify(bad)} 不该被认成网址`)
    assert.equal(normalizeGameUrl(bad), DEFAULT_GAME_URL)
  }
})

test('首尾空白只是手滑，不算写坏', () => {
  assert.equal(isValidGameUrl(`  ${DEFAULT_GAME_URL}\n`), true)
  assert.equal(normalizeGameUrl(`  ${DEFAULT_GAME_URL}\n`), DEFAULT_GAME_URL)
})

// ---- ② 装 webview 的那一侧真的走了判据 ----

test('游戏 webview 的 src 过判据，不是把配置原样递进去', () => {
  const source = read('src/renderer/index.ts')
  assert.match(
    source,
    /view\.src = normalizeGameUrl\(config\.get\(GAME_URL_CONFIG_KEY\)\)/,
    '装 webview 时没过 normalizeGameUrl——写坏的配置会直接变成白屏',
  )
  // 默认值不许在别处再写一遍：两份字面量迟早会各走各的
  for (const rel of ['src/renderer/index.ts', 'src/main/config.ts']) {
    assert.ok(
      !read(rel).includes('play.games.dmm.com'),
      `${rel} 里又写了一遍默认网址，默认值该只有 shared/game-url 一份`,
    )
  }
})

test('游戏页 preload 认宿主与被丢到 /foreign/ 时，用的是同一条网址', () => {
  const preload = read('assets/preload/webview-preload.js')
  const cookieHack = read('assets/preload/cookie-hack.js')
  assert.match(preload, /normalizeGameUrl\(config\.get\(GAME_URL_CONFIG_KEY\)\)/)
  // 曾经是 getDefault：玩家换了网址、被 DMM 甩到 /foreign/ 之后会被拉回官方页，
  // 表现正好是「改了没用」
  assert.match(cookieHack, /location\.href = normalizeGameUrl\(config\.get\(GAME_URL_CONFIG_KEY\)\)/)
  assert.ok(!cookieHack.includes("getDefault('kanso.homepage')"), '还在硬拉回默认页')
})

// ---- ③ 设置里那张卡 ----

test('这张卡在「网络」类里，紧跟代理', () => {
  const cards = cardsIn(mountYu({ ui: NETWORK }).pane.innerHTML)
  assert.equal(settingsSectionOf('game-url'), 'network')
  assert.ok(cards.includes('game-url'), '发行版的网络类里没有「游戏页面网址」')
  assert.ok(
    cards.indexOf('proxy') < cards.indexOf('game-url'),
    '游戏页面网址跑到代理前面去了',
  )
  assert.ok(cards.indexOf('game-url') < cards.indexOf('login'), '它该排在登录会话之前')
})

test('输入框里就是将要加载的那条，占位符是默认值', () => {
  const card = cardOf(mountYu({ ui: NETWORK }))
  assert.match(card, /<b>游戏页面网址<\/b>/)
  assert.match(card, /placeholder="https:\/\/play\.games\.dmm\.com\/game\/kancolle"/)
  // 没配过时读到的就是默认值（config 桩没有这一格 → 走 fallback）
  assert.match(card, /data-game-url value="https:\/\/play\.games\.dmm\.com\/game\/kancolle"/)
  assert.match(card, /恢复默认/)
  assert.match(card, /重新载入游戏页面/)
})

test('填进去的值存下来，原样回显——不替他悄悄纠正', () => {
  const yu = mountYu({ ui: NETWORK })
  yu.change('game-url', '  http://203.104.209.7/kcs2/index.php  ')
  assert.equal(yu.configOf(GAME_URL_CONFIG_KEY), 'http://203.104.209.7/kcs2/index.php')
  assert.match(cardOf(yu), /data-game-url value="http:\/\/203\.104\.209\.7\/kcs2\/index\.php"/)
  // 合法的那条不该冒出红字
  assert.ok(!cardOf(yu).includes('ystatus bad'), '合法网址却被报成用不上')
})

test('填坏了：如实说一声用不上，但装 webview 那侧仍拿得到能开的网址', () => {
  const yu = mountYu({ ui: NETWORK })
  yu.change('game-url', 'play.games.dmm.com/game/kancolle')
  const card = cardOf(yu)
  // 他填的字还在框里——被悄悄改回默认的话，他会以为没保存上，然后再填一遍
  assert.match(card, /data-game-url value="play\.games\.dmm\.com\/game\/kancolle"/)
  assert.match(card, /<div class="ystatus bad">网址无效 · 游戏页使用默认地址<\/div>/)
  // 而真正要加载的那条仍然打得开
  assert.equal(normalizeGameUrl(yu.configOf(GAME_URL_CONFIG_KEY)), DEFAULT_GAME_URL)
})

test('清空即默认：框空着不报错，加载的仍是默认那条', () => {
  const yu = mountYu({ ui: NETWORK, config: { [GAME_URL_CONFIG_KEY]: 'https://example.test/' } })
  yu.change('game-url', '')
  assert.equal(yu.configOf(GAME_URL_CONFIG_KEY), '')
  const card = cardOf(yu)
  assert.match(card, /data-game-url value=""/)
  assert.ok(!card.includes('ystatus bad'), '留空是「用默认」，不是填错')
  assert.equal(normalizeGameUrl(yu.configOf(GAME_URL_CONFIG_KEY)), DEFAULT_GAME_URL)
})

test('「恢复默认」就是把这一格清空，不是往框里填一遍默认网址', () => {
  const yu = mountYu({ ui: NETWORK, config: { [GAME_URL_CONFIG_KEY]: 'https://example.test/' } })
  assert.match(cardOf(yu), /data-game-url value="https:\/\/example\.test\/"/)
  yu.click({ act: 'game-url-reset' })
  assert.equal(yu.configOf(GAME_URL_CONFIG_KEY), '')
  const card = cardOf(yu)
  assert.match(card, /data-game-url value=""/)
  // 框空着，默认那条由占位符顶上——「留空就用默认那条」那句说的就是这个样子
  assert.match(card, /placeholder="https:\/\/play\.games\.dmm\.com\/game\/kancolle"/)
  assert.ok(!card.includes('ystatus bad'), '清空是「用默认」，不是填错')
  assert.equal(normalizeGameUrl(yu.configOf(GAME_URL_CONFIG_KEY)), DEFAULT_GAME_URL)
})

test('按按钮和自己把框删空，落到的是同一个样子——不是两件事', () => {
  // 这是「恢复默认」写成清空而不是回填默认网址的**全部理由**：说明句只说了
  // 「留空就用默认那条」，两条路要是长得不一样，那句话就只解释得了其中一条。
  const byButton = mountYu({ ui: NETWORK, config: { [GAME_URL_CONFIG_KEY]: 'https://example.test/' } })
  byButton.click({ act: 'game-url-reset' })
  const byHand = mountYu({ ui: NETWORK, config: { [GAME_URL_CONFIG_KEY]: 'https://example.test/' } })
  byHand.change('game-url', '   ')
  assert.equal(byButton.configOf(GAME_URL_CONFIG_KEY), byHand.configOf(GAME_URL_CONFIG_KEY))
  assert.equal(cardOf(byButton), cardOf(byHand))
})

test('生效那条路是这张卡自己的按钮，不是顶栏那个刷新', () => {
  // 顶栏刷新是 webview.reload()：重取的是页面此刻停着的 URL，跟刚改的配置无关。
  // 指着它说「按一下就生效」是句会骗人的话，所以这张卡自带一个按配置重新导航的按钮。
  const yu = mountYu({ ui: NETWORK })
  yu.click({ act: 'game-url-reload' })
  assert.ok(yu.invoked.includes('yu:reload-game-url'), '点了重新载入却没往主进程发')
  const main = read('src/main/yu.ts')
  assert.match(main, /ipcMain\.handle\('yu:reload-game-url'/, '主进程没有接这条')
  assert.match(main, /normalizeGameUrl\(config\.get\(GAME_URL_CONFIG_KEY\)\)/, '重载时没过判据')
  // 顶栏那个按钮保持原样：它是「重新加载当前这一页」，不该被顺手改成「跳回首页」
  assert.match(read('src/renderer/index.ts'), /#btn-reload'\)\.addEventListener\('click', \(\) => \{\s*webview\?\.reload\(\)/)
})

// ---- ④ 抓包桥与魔改缓存不看页面网址 ----

test('抓包与魔改都按 /kcs 路径认，不按 DMM 主机名认', () => {
  // 换网址会不会把这两条打断，是这次改动唯一值得担心的事：
  // 它们要是按主机名匹配，改网址就等于把记账和魔改一起关掉，而且悄无声息。
  const broadcaster = read('src/main/game-api-broadcaster.ts')
  assert.match(broadcaster, /pathname\.startsWith\('\/kcs'\)/, '抓包桥改成按别的东西认了')
  assert.ok(!/dmm/i.test(broadcaster), '抓包桥里出现了 DMM 主机名')
  const preload = read('assets/preload/webview-preload.js')
  assert.match(preload, /pathname\.startsWith\('\/kcs'\)/)
  // 魔改/缓存重定向的过滤器：主机是通配的，只钉路径
  const resource = read('src/main/kcs-resource.ts')
  assert.match(resource, /urls: \['\*:\/\/\*\/kcs\/\*', '\*:\/\/\*\/kcs2\/\*', '\*:\/\/\*\/gadget_html5\/\*'\]/)
})
