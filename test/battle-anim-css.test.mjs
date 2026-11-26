// 动画复盘样式（assets/battle-anim.css）只引用复盘窗根块里定义过的变量：
// 深色根块是全集（浅色与色觉模式只覆盖各自不同的那些），缺了就退回浏览器默认色。
// 与 theme-battle-css 那条「战斗共享样式」护栏同一口径。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (name) => fs.readFileSync(new URL('../src/renderer/' + name, import.meta.url), 'utf8')
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '')
const css = stripComments(read('assets/battle-anim.css'))
const palettes = [...stripComments(read('battle-replay.html')).matchAll(/:root(?:\[data-theme="light"\])?\s*\{([^}]+)\}/g)]
  .map((match) => new Set([...match[1].matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1])))

test('动画复盘样式引用的变量在复盘窗深色根块里都有定义', () => {
  const [dark] = palettes
  assert.ok(dark, '复盘窗应有深色根块')
  const used = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))
  assert.ok(used.size > 10)
  for (const token of used) assert.ok(dark.has(token), `深色根块缺 ${token}`)
})

test('复盘窗引入了动画复盘样式，并留好「详情 / 动画」切换与动画宿主', () => {
  const html = read('battle-replay.html')
  assert.match(html, /<link rel="stylesheet" href="assets\/battle-anim\.css">/)
  assert.match(html, /id="battle-replay-views"[^>]*>.*data-view="detail".*data-view="animate"/)
  assert.match(html, /id="battle-replay-anim"/)
})

test('动画复盘还在试做：复盘窗「动画」页签与两处入口按钮都挂 BETA 小标，样式在主窗与复盘窗共用的那份里', () => {
  assert.match(read('battle-replay.html'), /data-view="animate">动画<span class="anim-beta">BETA<\/span><\/button>/)
  assert.match(read('modules/di.ts'), /data-battle-anim="\$\{snapshot\.id\}"[^>]*>动画复盘<span class="anim-beta">BETA<\/span>/)
  assert.match(read('modules/shi.ts'), /data-shi-battle-anim[^>]*>动画复盘<span class="anim-beta">BETA<\/span>/)
  assert.match(stripComments(read('assets/battle-replay.css')), /\.anim-beta\s*\{/)
})
