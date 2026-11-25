// 色觉模式（维护者裁决 2026-11-25）：钥「外观」卡加一行「色觉」——标准 / 红绿色盲 / 全色盲，
// 与深浅主题、自定义底色叠加；范围是全应用带含义的颜色（图片不动）。
//
// 机制：
//   · 颜色变量几乎都是写死在各窗口页面样式里的十六进制。两种模式的配色由生成器
//     `scripts/build-cvd-palette.mjs` 按各页面现有变量算出，写进页面样式的
//     `:root[data-cvd="…"]` 与 `:root[data-theme="light"][data-cvd="…"]` 两块；
//     运行时只切 `<html data-cvd>`，不在开窗时临场算色。
//   · 主题状态多一键 cvd，随既有主题广播同步到各窗口。
//
// 验收门槛用色觉模拟量（Machado 2009，严重度 1.0，线性 sRGB；距离用 OKLab）：
//   · 红绿色盲：关键颜色对在红色盲、绿色盲两种模拟下的 OKLab 距离都 ≥ 0.08；
//   · 全色盲：所有改写的颜色都是灰（OKLab 色度 ≤ 0.01），关键颜色对的明度差 ≥ 0.06；
//   · 两种模式下，前景主色对页面底色的对比度不低于 min(4.5, 原对比度)。
// 关键颜色对：好/坏/警告（ok · bad · warn），破损档与评级（S gold · A bad · B warn · C accent · D dim）。
// 改造前实测（index.html）：浅色主题 gold-warn 绿色盲模拟仅 0.023、ok-bad 0.068；
// 全灰时深色 ok-warn 明度差 0.001、浅色 accent-bad 0.006。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'

import theme from '../dist/shared/theme.js'
import { runtimeHost } from '../scripts/lib/player-view-runtime.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8').replace(/\r\n/g, '\n')
const { NEUTRAL_TOKENS, THEME_CONFIG_KEY, THEME_BASE_CONFIG_KEY, DEFAULT_THEME_BASE } = theme

// ---- 色彩工具（只在测试里，作为独立的尺子） ----
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
const rgb = (hex) => [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16)))
const MACHADO = {
  protan: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deutan: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.011820, 0.042940, 0.968881],
}
const simulate = (c, m) => [0, 1, 2].map((r) => Math.min(1, Math.max(0, m[r * 3] * c[0] + m[r * 3 + 1] * c[1] + m[r * 3 + 2] * c[2])))
const oklab = ([r, g, b]) => {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ]
}
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const luminance = (hex) => { const [r, g, b] = rgb(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

// ---- 页面样式解析 ----
const blockOf = (html, selector) => {
  const start = html.indexOf(`${selector} {`)
  if (start < 0) return null
  const end = html.indexOf('}', start)
  return Object.fromEntries([...html.slice(start, end).matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
}
const resolveVar = (tokens, value, depth = 0) => {
  const m = /^var\((--[a-z0-9-]+)\)$/.exec(value ?? '')
  return m && depth < 8 ? resolveVar(tokens, tokens[m[1]], depth + 1) : value
}
const palettesOf = (relative) => {
  const html = read(relative)
  const dark = blockOf(html, ':root')
  const light = { ...dark, ...blockOf(html, ':root[data-theme="light"]') }
  const out = { html, base: { dark, light }, cvd: {} }
  for (const mode of ['redgreen', 'mono']) {
    out.cvd[mode] = {
      dark: blockOf(html, `:root[data-cvd="${mode}"]`),
      light: blockOf(html, `:root[data-theme="light"][data-cvd="${mode}"]`),
    }
  }
  return out
}
const THEMED_PAGES = [
  'src/renderer/index.html',
  'src/renderer/battle-replay.html',
  'src/renderer/ship-life.html',
  'src/renderer/quest-tree.html',
  'src/renderer/resource-trend.html',
]
const NEUTRAL = new Set(NEUTRAL_TOKENS.map((key) => `--${key}`))
const RANK_TONES = ['--gold', '--bad', '--warn', '--accent', '--dim'] // S A B C D（E 同 D）
const KEY_PAIRS = [
  ['--ok', '--bad'], ['--ok', '--warn'],
  ...RANK_TONES.flatMap((a, i) => RANK_TONES.slice(i + 1).map((b) => [a, b])),
]
const FOREGROUND = ['--ok', '--bad', '--warn', '--gold', '--accent']

// ---- 设置项 ----

test('色觉三档与标签；未知值回「标准」', () => {
  assert.equal(theme.CVD_CONFIG_KEY, 'kuma.themeCvd')
  assert.deepEqual([...theme.CVD_MODES], ['none', 'redgreen', 'mono'])
  assert.deepEqual({ ...theme.CVD_MODE_LABEL }, { none: '标准', redgreen: '红绿色盲', mono: '全色盲' })
  assert.equal(theme.normalizeCvdMode('mono'), 'mono')
  assert.equal(theme.normalizeCvdMode('redgreen'), 'redgreen')
  for (const raw of [undefined, null, '', 'MONO', 'deutan', 3]) assert.equal(theme.normalizeCvdMode(raw), 'none')
})

// ---- 生成的配色 ----

test('生成器自检：各页面里的色觉配色与生成器结果一致', () => {
  const run = spawnSync(process.execPath, ['scripts/build-cvd-palette.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' })
  assert.equal(run.status, 0, `build-cvd-palette --check 未通过：\n${run.stdout}\n${run.stderr}`)
})

test('每个带主题变量的窗口页面都有两种模式、深浅两块，键集相同、只改非中性的十六进制颜色', () => {
  for (const page of THEMED_PAGES) {
    const { base, cvd } = palettesOf(page)
    assert.ok(base.dark?.['--gold'], `${page} 没有主题变量`)
    for (const mode of ['redgreen', 'mono']) {
      const { dark, light } = cvd[mode]
      assert.ok(dark && light, `${page} 缺 ${mode} 的深色或浅色块`)
      assert.deepEqual(Object.keys(light).sort(), Object.keys(dark).sort(), `${page} ${mode} 深浅两块键集不同（深色值会漏进浅色）`)
      for (const [key, value] of Object.entries(dark)) {
        assert.ok(!NEUTRAL.has(key), `${page} ${mode} 改写了中性变量 ${key}`)
        assert.ok(base.dark[key] != null, `${page} ${mode} 多出页面里没有的变量 ${key}`)
        assert.match(value, /^#[0-9a-f]{6}$/, `${page} ${mode} ${key}=${value} 不是六位小写十六进制`)
        assert.match(light[key], /^#[0-9a-f]{6}$/)
      }
      for (const key of FOREGROUND) assert.ok(dark[key], `${page} ${mode} 没改写 ${key}`)
      // 全应用：页面上每个带颜色（OKLab 色度 > 0.02）的非中性十六进制变量都要进这一块，深浅各按各的底值
      for (const [ground, block] of [['dark', dark], ['light', light]]) {
        for (const [key, value] of Object.entries(base[ground])) {
          if (NEUTRAL.has(key) || !/^#[0-9a-fA-F]{6}$/.test(value)) continue
          const [, a, b] = oklab(rgb(value.toLowerCase()))
          if (Math.hypot(a, b) > 0.02) assert.ok(block[key], `${page} ${mode} ${ground} 漏了带色变量 ${key}=${value}`)
        }
      }
    }
  }
})

const effective = (palettes, ground, mode) => ({ ...palettes.base[ground], ...palettes.cvd[mode][ground] })

test('红绿色盲：关键颜色对在红色盲、绿色盲两种模拟下都分得开（OKLab ≥ 0.08）', () => {
  const palettes = palettesOf('src/renderer/index.html')
  for (const ground of ['dark', 'light']) {
    const tokens = effective(palettes, ground, 'redgreen')
    for (const [a, b] of KEY_PAIRS) {
      const ca = rgb(resolveVar(tokens, tokens[a])), cb = rgb(resolveVar(tokens, tokens[b]))
      for (const kind of ['protan', 'deutan']) {
        const d = distance(oklab(simulate(ca, MACHADO[kind])), oklab(simulate(cb, MACHADO[kind])))
        assert.ok(d >= 0.08, `${ground} ${kind} ${a}/${b} 只差 ${d.toFixed(3)}`)
      }
    }
  }
})

test('全色盲：改写的颜色全是灰，关键颜色对靠明度拉开（ΔL ≥ 0.06）', () => {
  const palettes = palettesOf('src/renderer/index.html')
  for (const ground of ['dark', 'light']) {
    for (const [key, value] of Object.entries(palettes.cvd.mono[ground])) {
      const [, a, b] = oklab(rgb(value))
      assert.ok(Math.hypot(a, b) <= 0.01, `${ground} ${key}=${value} 不是灰（色度 ${Math.hypot(a, b).toFixed(3)}）`)
    }
    const tokens = effective(palettes, ground, 'mono')
    for (const [a, b] of KEY_PAIRS) {
      const la = oklab(rgb(resolveVar(tokens, tokens[a])))[0], lb = oklab(rgb(resolveVar(tokens, tokens[b])))[0]
      assert.ok(Math.abs(la - lb) >= 0.06, `${ground} ${a}/${b} 明度只差 ${Math.abs(la - lb).toFixed(3)}`)
    }
  }
})

test('两种模式下前景主色对页面底色的对比度不低于 min(4.5, 原对比度)', () => {
  const palettes = palettesOf('src/renderer/index.html')
  for (const ground of ['dark', 'light']) {
    const bg = DEFAULT_THEME_BASE[ground]
    for (const mode of ['redgreen', 'mono']) {
      const tokens = effective(palettes, ground, mode)
      for (const key of FOREGROUND) {
        const before = contrast(resolveVar(palettes.base[ground], palettes.base[ground][key]), bg)
        const after = contrast(resolveVar(tokens, tokens[key]), bg)
        assert.ok(after + 1e-9 >= Math.min(4.5, before), `${ground} ${mode} ${key} 对比度 ${after.toFixed(2)} < ${Math.min(4.5, before).toFixed(2)}`)
      }
    }
  }
})

// ---- 运行时：主题引导 ----

const bootCode = buildSync({
  entryPoints: [path.join(ROOT, 'src/renderer/theme-boot.ts')],
  bundle: true, platform: 'node', format: 'cjs', write: false,
  external: ['electron', '@electron/remote'],
}).outputFiles[0].text

const bootRenderer = ({ cvd = 'none' } = {}) => {
  const writes = []
  const values = { [THEME_CONFIG_KEY]: 'dark', [THEME_BASE_CONFIG_KEY]: '', [theme.CVD_CONFIG_KEY]: cvd }
  const config = { get: (key, fallback) => (key in values ? values[key] : fallback), set: (...args) => writes.push(args) }
  const document = { documentElement: { dataset: {}, style: { setProperty(n, v) { this[n] = v }, removeProperty(n) { delete this[n] } } } }
  const module = { exports: {} }
  vm.runInNewContext(bootCode, {
    module, exports: module.exports, document, window: {},
    matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
    require: (id) => {
      if (id === '@electron/remote') return { require: () => config }
      if (id === 'electron') return { ipcRenderer: { on() {} } }
      throw Error(`unexpected require ${id}`)
    },
  })
  return { ...module.exports, dataset: document.documentElement.dataset, writes }
}

test('主题引导：启动按配置挂 data-cvd；推送切换、「标准」与无效值摘掉；setter 落盘并立即生效', () => {
  const r = bootRenderer({ cvd: 'mono' })
  r.installThemeBoot()
  assert.equal(r.dataset.cvd, 'mono')
  r.applyTheme({ mode: 'dark', base: '', cvd: 'redgreen' })
  assert.equal(r.dataset.cvd, 'redgreen')
  r.applyTheme({ mode: 'dark', base: '', cvd: 'none' })
  assert.equal(r.dataset.cvd, undefined)
  r.applyTheme({ mode: 'light', base: '', cvd: 'MONO' })
  assert.equal(r.dataset.cvd, undefined)
  r.setThemeCvd('mono')
  assert.deepEqual(r.writes.at(-1), [theme.CVD_CONFIG_KEY, 'mono'])
  assert.equal(r.dataset.cvd, 'mono')
  // 切底色、切深浅不丢色觉
  r.setThemeBase('#123456')
  assert.equal(r.dataset.cvd, 'mono')
  r.applyThemeMode('light')
  assert.equal(r.dataset.cvd, 'mono')
})

// ---- 钥「外观」卡 ----

test('外观卡多一行「色觉」：三枚芯片，当前档点亮', () => {
  const host = runtimeHost()
  const card = (cvd) => host.extract('src/renderer/modules/yu.ts', ['themeCardHtml'], {
    config: { get: (key, fallback) => (key === theme.CVD_CONFIG_KEY ? cvd : key === THEME_CONFIG_KEY ? 'dark' : fallback) },
    matchMedia: () => ({ matches: true }),
  }).api.themeCardHtml()
  const html = card('redgreen').replace(/\s+/g, ' ')
  assert.match(html, /<div class="yline"><span>色觉<\/span>/)
  assert.match(html, /<span class="ychip" data-theme-cvd="none">标准<\/span>/)
  assert.match(html, /<span class="ychip on" data-theme-cvd="redgreen">红绿色盲<\/span>/)
  assert.match(html, /<span class="ychip" data-theme-cvd="mono">全色盲<\/span>/)
  assert.match(card('none').replace(/\s+/g, ' '), /<span class="ychip on" data-theme-cvd="none">标准<\/span>/)
})
