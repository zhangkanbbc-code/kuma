import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import theme from '../dist/shared/theme.js'

const { THEME_BASE_CONFIG_KEY, DEFAULT_THEME_BASE, GROUND_ACCENT, NEUTRAL_TOKENS,
  normalizeThemeBase, hexToRgb, rgbToHex, relativeLuminance, contrastRatio, mixHex,
  groundOf, deriveNeutrals, resolveThemeGround } = theme
const html = fs.readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8')
const blocks = {
  dark: html.match(/:root\s*\{([^}]+)\}/)[1],
  light: html.match(/:root\[data-theme="light"\]\s*\{([^}]+)\}/)[1],
}
const token = (ground, name) => blocks[ground].match(new RegExp('--' + name + ':\\s*(#[0-9a-f]{6})'))[1]

test('默认底色与地色 accent 常量钉住手调 token，派生墨色与默认正文相近', () => {
  assert.equal(THEME_BASE_CONFIG_KEY, 'kuma.themeBase')
  for (const ground of ['dark', 'light']) {
    assert.equal(DEFAULT_THEME_BASE[ground], token(ground, 'bg0'))
    assert.equal(GROUND_ACCENT[ground], token(ground, 'accent'))
    assert.ok(contrastRatio(deriveNeutrals(DEFAULT_THEME_BASE[ground]).text, token(ground, 'text')) <= 1.2)
  }
})

test('底色只收六位 hex，大小写统一，垃圾输入清空', () => {
  for (const raw of [undefined, null, true, false, 0, 0xffffff, {}, [], ['#123456'], '',
    '#abc', '#12345678', '123456', '#gg0000', ' #123456', '#123456 ', '#123456\n']) {
    assert.equal(normalizeThemeBase(raw), '')
  }
  for (const hex of ['#000000', '#ABCDEF', '#aB12Cd', '#ffffff']) {
    assert.equal(normalizeThemeBase(hex), hex.toLowerCase())
  }
})

test('颜色转换、WCAG 亮度和对比度、sRGB 插值四舍五入', () => {
  assert.deepEqual(hexToRgb('#1b2733'), [27, 39, 51])
  assert.equal(rgbToHex([27, 39, 51]), '#1b2733')
  assert.equal(relativeLuminance('#000000'), 0)
  assert.equal(relativeLuminance('#ffffff'), 1)
  assert.equal(contrastRatio('#000000', '#ffffff'), 21)
  assert.equal(contrastRatio('#ffffff', '#000000'), 21)
  assert.equal(contrastRatio('#123456', '#123456'), 1)
  assert.equal(mixHex('#000000', '#ffffff', 0.5), '#808080')
  assert.equal(mixHex('#123456', '#abcdef', 0), '#123456')
  assert.equal(mixHex('#123456', '#abcdef', 1), '#abcdef')
})

test('六个代表底色按更高对比度的墨色选深地或浅地', () => {
  for (const hex of ['#000000', '#0d1318', '#202020']) assert.equal(groundOf(hex), 'dark')
  for (const hex of ['#ffffff', '#f3f6f9', '#e0e0e0']) assert.equal(groundOf(hex), 'light')
})

test('自定义覆盖档位，空底色使用固定档或系统档', () => {
  for (const systemPrefersDark of [false, true]) {
    assert.equal(resolveThemeGround({ mode: 'light', base: '#000000', systemPrefersDark }), 'dark')
    assert.equal(resolveThemeGround({ mode: 'dark', base: '#ffffff', systemPrefersDark }), 'light')
    for (const mode of ['dark', 'light']) {
      assert.equal(resolveThemeGround({ mode, base: '', systemPrefersDark }), mode)
    }
    assert.equal(resolveThemeGround({ mode: 'system', base: '', systemPrefersDark }), systemPrefersDark ? 'dark' : 'light')
  }
})

let seed = 0x12345678
const bases = Array.from({ length: 400 }, () => {
  seed = (Math.imul(1664525, seed) + 1013904223) >>> 0
  return '#' + (seed & 0xffffff).toString(16).padStart(6, '0')
})

test('400 个固定种子底色：键集、混合比例、次级墨色最大达标档与表面层次', (t) => {
  const minima = { text: Infinity, sub: Infinity, dim: Infinity, subQualified: Infinity, dimQualified: Infinity }
  let subFallback = 0, dimFallback = 0
  for (const base of bases) {
    const n = deriveNeutrals(base)
    assert.deepEqual(Object.keys(n).sort(), [...NEUTRAL_TOKENS].sort())
    assert.equal(n.bg0, base)
    for (const hex of Object.values(n)) assert.match(hex, /^#[0-9a-f]{6}$/)
    const expectedInk = contrastRatio('#e8eef4', base) >= contrastRatio('#1b2733', base) ? '#e8eef4' : '#1b2733'
    assert.equal(n.text, expectedInk)
    for (const [key, ratio] of Object.entries({ bg1: 0.06, bg2: 0.10, bg3: 0.14, line: 0.20,
      'line-soft': 0.15, 'stat-track': 0.12, 'scrollbar-track': 0.04, 'scrollbar-thumb': 0.30,
      'scrollbar-thumb-hover': 0.40, 'scrollbar-thumb-active': 0.50 })) {
      assert.equal(n[key], mixHex(base, n.text, ratio))
    }
    assert.equal(n['accent-wash'], mixHex(GROUND_ACCENT[groundOf(base)], base, 0.75))
    let previous = 1
    for (const key of ['bg1', 'bg2', 'bg3', 'line']) {
      const ratio = contrastRatio(n[key], base)
      assert.ok(ratio >= previous, `${base} ${key}: ${ratio} < ${previous}`)
      previous = ratio
    }
    for (const [key, threshold] of [['sub', groundOf(base) === 'light' ? 8.0 : 6], ['dim', groundOf(base) === 'light' ? 6.0 : 4.5]]) {
      const ratio = contrastRatio(n[key], n.bg1)
      const best = Math.max(contrastRatio('#1b2733', n.bg1), contrastRatio('#e8eef4', n.bg1))
      minima[key] = Math.min(minima[key], ratio)
      if (best >= threshold) assert.ok(ratio >= threshold, `${base} ${key}: ${ratio} < ${threshold}`)
      else assert.ok(ratio >= threshold || n[key] === n.text)
      const passing = Array.from({ length: 101 }, (_, percent) => mixHex(n.text, base, percent / 100))
        .filter(hex => contrastRatio(hex, n.bg1) >= threshold)
      assert.equal(n[key], passing.at(-1) ?? n.text)
      if (passing.length) minima[key + 'Qualified'] = Math.min(minima[key + 'Qualified'], ratio)
      else if (key === 'sub') subFallback++
      else dimFallback++
    }
    for (const bg of ['bg0', 'bg1', 'bg2', 'bg3']) minima.text = Math.min(minima.text, contrastRatio(n.text, n[bg]))
  }
  t.diagnostic(JSON.stringify({ seed: '0x12345678', count: bases.length, minima, subFallback, dimFallback }))
})

test('400 个固定种子底色：正文逐面按两种墨色的最佳对比度判断可达性', (t) => {
  const failures = []
  const unreachableBases = new Set()
  const unreachableBySurface = { bg0: 0, bg1: 0, bg2: 0, bg3: 0 }
  let minimum = Infinity, reachableMinimum = Infinity
  for (const base of bases) {
    const n = deriveNeutrals(base)
    for (const bg of ['bg0', 'bg1', 'bg2', 'bg3']) {
      const ratio = contrastRatio(n.text, n[bg])
      const best = Math.max(contrastRatio('#1b2733', n[bg]), contrastRatio('#e8eef4', n[bg]))
      minimum = Math.min(minimum, ratio)
      if (best >= 4.5) {
        reachableMinimum = Math.min(reachableMinimum, ratio)
        if (ratio < 4.5) failures.push({ base, bg, surface: n[bg], text: n.text, ratio, best })
      } else {
        unreachableBases.add(base)
        unreachableBySurface[bg]++
        // 不可达面沿用按 bg0 选定的统一正文墨色，不要求逐面最优。
      }
    }
  }
  t.diagnostic(JSON.stringify({ minimum, reachableMinimum, unreachableBases: unreachableBases.size, unreachableBySurface,
    failedPairs: failures.length, failedBases: new Set(failures.map(f => f.base)).size, examples: failures.slice(0, 4) }))
  assert.equal(failures.length, 0, '正文在 best ≥ 4.5 的可达面应达到 4.5')
})
