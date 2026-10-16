import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { buildSync } from 'esbuild'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)

// 真 Chromium 解析 CSS（包括伪元素和外部 SVG），不靠源码里的动画串猜级联结果。
test('九季与作战灯：HTML replace、每目标每属性单动画、季节关键帧端点全部显式', { timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-welcome-compositor-'))
  try {
    buildSync({ stdin: { contents: "export { armLaunchWelcome } from './launch-glow'", loader: 'ts', resolveDir: path.join(root, 'src/renderer') },
      outfile: path.join(dir, 'welcome.js'), bundle: true, platform: 'browser', format: 'iife', globalName: 'welcomeTest', logLevel: 'silent' })
    const source = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8')
    const styles = [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((hit) => hit[0]).join('\n')
    fs.writeFileSync(path.join(dir, 'index.html'), `<html data-theme="dark"><head>
      <base href="${pathToFileURL(path.join(root, 'dist/renderer/')).href}">${styles}
      <style>#kuma-welcome .kw-box { width: 560px; }</style></head><body>
      <script src="${pathToFileURL(path.join(dir, 'welcome.js')).href}"></script></body></html>`)
    fs.writeFileSync(path.join(dir, 'main.cjs'), `
      const { app, BrowserWindow } = require('electron')
      const fs = require('node:fs'), path = require('node:path')
      app.setPath('userData', path.join(__dirname, 'profile'))
      app.commandLine.appendSwitch('disable-background-networking')
      app.whenReady().then(async () => {
        const win = new BrowserWindow({ show: false, width: 1600, height: 900,
          webPreferences: { backgroundThrottling: false } })
        win.webContents.session.webRequest.onBeforeRequest((details, done) => done({ cancel: !details.url.startsWith('file:') }))
        await win.loadFile(path.join(__dirname, 'index.html'))
        const results = await win.webContents.executeJavaScript(\`(async () => {
          const rows = [], check = (condition, message) => { if (!condition) throw new Error(message) }
          const seasonRules = [...document.styleSheets].flatMap(sheet => [...sheet.cssRules])
            .filter(rule => rule instanceof CSSKeyframesRule && rule.name.startsWith('kuma-season-'))
          check(seasonRules.length >= 40, '未枚举到季节关键帧')
          for (const rule of seasonRules) {
            const frames = [...rule.cssRules], properties = new Set(frames.flatMap(frame => [...frame.style]))
            for (const endpoint of [0, 100]) {
              const at = frames.filter(frame => frame.keyText.split(',').some(key => Number.parseFloat(key) === endpoint))
              check(at.length > 0, rule.name + ': 缺少显式端点 ' + endpoint + '%')
              for (const property of properties) {
                check(at.some(frame => frame.style.getPropertyValue(property) !== ''), rule.name + ': 缺少显式端点 ' + endpoint + '% ' + property)
              }
            }
          }
          const keys = ['newyear', 'setsubun', 'valentine', 'spring', 'tsuyu', 'summer', 'sanma', 'halloween', 'xmas', 'event']
          for (const theme of ['dark', 'light']) for (const key of keys) for (const complete of key === 'event' ? [false, true] : [false]) {
            document.documentElement.dataset.theme = theme
            const selection = key === 'event' ? { key, mapAreaId: 63, complete,
              lamps: Array.from({ length: 5 }, (_, i) => ({ mapId: 631 + i, state: complete || i < 2 ? 'done' : i === 2 ? 'current' : 'empty', breakBefore: i === 3 })) } : { key }
            const hello = welcomeTest.armLaunchWelcome(true, selection)
            const layer = document.getElementById('kuma-welcome')
            const elements = [layer, ...layer.querySelectorAll('*')]
            let tracks = 0, pseudos = 0
            for (const el of elements) for (const pseudo of [null, '::before', '::after']) {
              const css = getComputedStyle(el, pseudo)
              if (css.animationName === 'none' || (pseudo && ['none', 'normal'].includes(css.content))) continue
              const label = theme + '/' + key + '/' + el.tagName + '.' + el.getAttribute('class') + (pseudo ?? '')
              check(el.namespaceURI === 'http://www.w3.org/1999/xhtml', label + ': SVG 动画宿主')
              check(css.animationComposition.split(',').every(value => value.trim() === 'replace'), label + ': ' + css.animationComposition)
              tracks += css.animationName.split(',').length
              if (pseudo) pseudos++
            }
            const animations = layer.getAnimations({ subtree: true })
            check(animations.length > 0 && tracks > 0, theme + '/' + key + ': 未枚举到动画')
            const targets = new Map()
            for (const animation of animations) {
              check(animation.effect.target instanceof HTMLElement, key + ': 非 HTML 动画对象')
              check(animation.effect.composite === 'replace', key + ': ' + animation.effect.composite)
              const target = animation.effect.target, pseudo = animation.effect.pseudoElement ?? ''
              if (!targets.has(target)) targets.set(target, new Map())
              const pseudos = targets.get(target)
              if (!pseudos.has(pseudo)) pseudos.set(pseudo, new Map())
              const owners = pseudos.get(pseudo), properties = new Set()
              for (const frame of animation.effect.getKeyframes()) for (const property of Object.keys(frame)) {
                check(['offset', 'computedOffset', 'easing', 'composite', 'transform', 'opacity'].includes(property), key + ': 动画属性 ' + property)
                if (['transform', 'opacity'].includes(property)) properties.add(property)
              }
              for (const property of properties) {
                const label = theme + '/' + key + '/.' + target.className + pseudo + '/' + property
                check(!owners.has(property), label + ': 同属性多条动画 ' + owners.get(property) + ' + ' + animation.animationName)
                owners.set(property, animation.animationName)
              }
            }
            rows.push({ theme, key, complete, nodes: elements.length, tracks, pseudos })
            hello.cancel()
            check(!document.getElementById('kuma-welcome'), key + ': 未收摊')
          }
          return rows
        })()\`)
        fs.writeFileSync(path.join(__dirname, 'result.json'), JSON.stringify(results))
        win.destroy()
        app.exit(0)
      }).catch(error => { console.error(error); app.exit(1) })
      setTimeout(() => app.exit(2), 45000).unref()
    `)
    const output = await new Promise((resolve, reject) => {
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
      const child = spawn(require('electron'), [path.join(dir, 'main.cjs')], { cwd: root, env, windowsHide: true })
      let text = ''
      child.stdout.on('data', (chunk) => { text += chunk })
      child.stderr.on('data', (chunk) => { text += chunk })
      child.once('error', reject)
      child.once('exit', (code) => resolve({ code, text }))
    })
    assert.equal(output.code, 0, output.text)
    const rows = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8'))
    assert.equal(rows.length, 22)
    assert.ok(rows.some((row) => row.key === 'tsuyu' && row.pseudos >= 40), '雨滴伪元素漏检')
    assert.ok(rows.some((row) => row.key === 'summer' && row.pseudos >= 114), '花火伪元素漏检')
    assert.ok(rows.some((row) => row.key === 'event' && row.pseudos >= 3), '作战灯伪元素漏检')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
