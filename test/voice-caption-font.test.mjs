import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { createPackage, extractFile, uncache } from '@electron/asar'
import { isPackageIgnored } from '../scripts/lib/package-ignore.mjs'
import { captionRuntime } from './fixtures/render-ship-caption.mjs'
import dodge from '../dist/shared/caption-dodge.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const html = fs.readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8')
const fontPath = 'assets/branding/fonts/NotoSansCJKsc-Black.subset.woff2'
const licensePath = 'assets/branding/fonts/LICENSE-NotoSansCJK.txt'
const face = html.match(/@font-face\s*\{([^}]+)\}/g) ?? []

test('思源黑体只声明一枚 Black 字重，仅突入字幕使用且禁止合成粗体', () => {
  assert.equal(face.length, 1)
  for (const property of ["font-family: 'Noto Sans CJK SC Black'", 'font-display: swap', 'font-style: normal', 'font-weight: 900']) {
    assert.ok(face[0].includes(property))
  }
  assert.match(face[0], /format\('woff2'\)/)
  const rules = [...html.replace(face[0], '').replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]+)\}/g)]
    .filter(([, , body]) => body.includes('Noto Sans CJK SC Black'))
  assert.equal(rules.length, 1)
  assert.equal(rules[0][1].trim(), '.voice-cutin-line')
  assert.match(rules[0][2], /font-family: 'Noto Sans CJK SC Black', 'Microsoft YaHei', sans-serif;/)
  assert.match(rules[0][2], /font-weight: 900;/)
  assert.match(rules[0][2], /font-synthesis: none;/)
})

test('源码页、构建页与临时 asar 均能解析同一随包字体和许可', async () => {
  const src = face[0].match(/url\('([^']+)'\)/)[1]
  for (const page of ['src/renderer/index.html', 'dist/renderer/index.html']) {
    assert.equal(fileURLToPath(new URL(src, pathToFileURL(path.join(root, page)))), path.join(root, fontPath))
  }
  const files = ['dist/renderer/index.html', fontPath, licensePath]
  for (const entry of ['assets', 'assets/branding', 'assets/branding/fonts', ...files]) {
    assert.equal(isPackageIgnored(`/${entry}`), false, entry)
  }
  const font = fs.readFileSync(path.join(root, fontPath))
  const license = fs.readFileSync(path.join(root, licensePath))
  for (const retired of ['SmileySans-Oblique.ttf.woff2', 'LICENSE-SmileySans.txt']) {
    assert.equal(fs.existsSync(path.join(root, 'assets/branding/fonts', retired)), false)
  }
  assert.equal(font.length, 4570616)
  assert.equal(font.subarray(0, 4).toString(), 'wOF2')
  assert.equal(license.length, 4301)
  assert.match(license.toString(), /SIL OPEN FONT LICENSE Version 1\.1/)
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-caption-font-'))
  const archive = path.join(temp, 'app.asar')
  try {
    const input = path.join(temp, 'input')
    for (const entry of files) {
      const target = path.join(input, entry)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(path.join(root, entry), target)
    }
    await createPackage(input, archive)
    const packagedHtml = extractFile(archive, path.join('dist', 'renderer', 'index.html')).toString()
    assert.equal(packagedHtml, html)
    const packagedSrc = packagedHtml.match(/@font-face\s*\{[^}]*url\('([^']+)'\)/)[1]
    const resolved = fileURLToPath(new URL(packagedSrc, pathToFileURL(path.join(archive, 'dist/renderer/index.html'))))
    assert.deepEqual(extractFile(archive, path.relative(archive, resolved)), font)
    assert.deepEqual(extractFile(archive, path.normalize(licensePath)), license)
  } finally {
    uncache(archive)
    fs.rmSync(temp, { recursive: true, force: true })
  }
})

for (const scenario of ['enabled', 'disabled', 'distract', 'rejected']) {
  test(`字幕初始化字体预载：${scenario}`, async t => {
    const previous = globalThis.document
    const previousWindow = globalThis.window
    globalThis.window = { addEventListener: () => {} }
    const loads = []
    globalThis.document = {
      querySelector: selector => selector === '#app' ? { classList: { contains: name => name === 'distract' && scenario === 'distract' } } : null,
      fonts: { load: font => {
        loads.push(font)
        return scenario === 'rejected' ? Promise.reject(new Error('font unavailable')) : Promise.resolve([])
      } },
    }
    t.after(() => { globalThis.document = previous; globalThis.window = previousWindow })
    captionRuntime.setVoiceCaptionsEnabled(scenario !== 'disabled')
    const events = []
    captionRuntime.initVoiceSubtitles({ addListener: event => events.push(event) })
    // 真跑生产初始化；多过一个事件循环，让未吞掉的拒绝被测试运行器捕获。
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(loads, ['disabled', 'distract'].includes(scenario) ? [] : ["900 32px 'Noto Sans CJK SC Black'"])
    assert.deepEqual(events, [dodge.CAPTION_HOVER_EVENT, 'kancolle.voice'])
  })
}
