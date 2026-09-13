import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import test from 'node:test'

const read = name => fs.readFileSync(new URL('../src/renderer/' + name, import.meta.url), 'utf8')
const tokens = block => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]))
const palettes = name => {
  const source = read(name + '.html')
  return [tokens(source.match(/:root\s*\{([^}]+)\}/)[1]), tokens(source.match(/:root\[data-theme="light"\]\s*\{([^}]+)\}/)[1])]
}
const luminance = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0)
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05)
const isFill = name => /^(?:meter-|bar-(?:fuel|ammo)-|stat-(?:grow|over99|marriage|mod|equip)$|r-|trend-)/.test(name)
  || ['accent', 'accent-dim', 'ok', 'warn', 'bad', 'gold', 'dock', 'dim'].includes(name)
const baseline = {
  "bg1": "#151c23",
  "stat-track": "#1b2733",
  "scrollbar-track": "#10171d",
  "dim": "#75899a",
  "accent": "#4db8ff",
  "accent-dim": "#2a6f9e",
  "gold": "#e8c66a",
  "ok": "#67c98a",
  "warn": "#e8a04c",
  "bad": "#e06c75",
  "dock": "#48a6c9",
  "r-fuel": "#8fb87a",
  "r-ammo": "#b99a4e",
  "r-steel": "#8fa8c0",
  "r-baux": "#efab30",
  "r-build": "#5f96d3",
  "r-repair": "#7ac9b8",
  "r-dev": "#9d78e5",
  "r-screw": "#e08a97",
  "stat-grow": "#3f9bd8",
  "stat-over99": "#9b7fd4",
  "stat-marriage": "#d98cae",
  "stat-mod": "#c98d4f",
  "stat-equip": "#5cb17e",
  "bar-fuel-from": "#5a8a4a",
  "bar-fuel-to": "#8fb87a",
  "bar-ammo-from": "#8a7a3a",
  "bar-ammo-to": "#c9a86a",
  "meter-quest-unlocked": "#3f806b",
  "trend-bucket": "#7ac9b8",
  "meter-ok-start": "#3f9e63",
  "meter-gold-start": "#b8973a",
  "meter-bad-start": "#a33448",
  "meter-gold-count": "#92702d",
  "meter-warn-start": "#b8703a",
  "meter-teal-start": "#2a7a9e",
  "meter-abyss": "#8e3848",
  "meter-ok-done": "#2f7950",
  "meter-abyss-start": "#773444",
  "meter-abyss-end": "#d66579",
  "meter-ok-muted": "#2b4a37"
}
const windows = ['index', 'battle-replay', 'browse', 'quest-tree', 'resource-trend', 'ship-life']

for (const name of windows) {
  if (name !== 'browse') test(name + ' 浅色全部轨道对面板至少 1.35，填充实色对轨道至少 3', t => {
    const [dark, light] = palettes(name)
    const tracks = Object.keys(dark).filter(n => n.endsWith('-track'))
    const fills = Object.keys(dark).filter(isFill)
    assert.ok(tracks.length)
    const minima = { track: Infinity, fill: Infinity }
    for (const track of tracks) {
      assert.match(light[track], /^#[0-9a-f]{6}$/)
      const ratio = contrast(light[track], light.bg1)
      assert.ok(ratio >= 1.35, track + ': ' + ratio)
      minima.track = Math.min(minima.track, ratio)
      for (const fill of fills) {
        assert.match(light[fill], /^#[0-9a-f]{6}$/, fill + ' 必须是不含透明度的实色')
        const c = contrast(light[fill], light[track])
        assert.ok(c >= 3, fill + ' / ' + track + ': ' + c)
        minima.fill = Math.min(minima.fill, c)
      }
    }
    // 共享战斗样式用已有 line-soft 作空槽，连同独立回放的燃弹回退一起验。
    if (name === 'index' || name === 'battle-replay') {
      assert.ok(contrast(light['line-soft'], light.bg1) >= 1.35)
      for (const fill of ['ok', 'gold', 'warn', 'bad', 'accent', 'accent-dim', 'r-fuel']) {
        assert.ok(contrast(light[fill], light['line-soft']) >= 3, fill)
      }
    }
    t.diagnostic(JSON.stringify({ tracks, fills: fills.length, minima }))
  })

  test(name + ' 字重 token 深色等于旧档位，浅色只覆盖自身档位', () => {
    const [dark, light] = palettes(name)
    for (const [key, before, after] of [['body', '400', '500'], ['strong', '600', '650'], ['mono', '400', '500']]) {
      assert.equal(dark['weight-' + key], before)
      assert.equal(light['weight-' + key], after)
    }
    const css = read(name + '.html').replace(/\/\*[^]*?\*\//g, '')
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/font-weight:\s*var\(--weight-/.test(rule[2])) continue
      for (const selector of rule[1].trim().split(',')) assert.ok(selector.trim().startsWith(':root[data-theme="light"]'))
      assert.doesNotMatch(rule[1], /voice|caption|danmaku/)
    }
  })
}

test('深色轨道和填充锁定起点实值，最低对比度容差 0.005', t => {
  // 起点并未全数达到 3 / 1.2，保留原值，避免修改深色观感。
  // 2026-09-13 裁定：轨道最低 1.052、填充最低 1.544，各自容差 0.005。
  const [dark] = palettes('index')
  for (const [key, value] of Object.entries(baseline)) assert.equal(dark[key], value, key)
  const tracks = Object.keys(dark).filter(n => n.endsWith('-track'))
  const fills = Object.keys(dark).filter(isFill)
  const trackMinimum = Math.min(...tracks.map(n => contrast(dark[n], dark.bg1)))
  const fillMinimum = Math.min(...fills.flatMap(f => tracks.map(tr => contrast(dark[f], dark[tr]))))
  for (const [name, actual, expected] of [['track', trackMinimum, 1.052], ['fill', fillMinimum, 1.544]]) {
    assert.ok(Math.abs(actual - expected) <= 0.005, name + ' 起点最低对比度: ' + actual)
  }
  t.diagnostic(JSON.stringify({ trackMinimum, fillMinimum }))
})

test('战斗共享 CSS 除浅色专属覆盖外，整表保持起点等值', () => {
  const css = read('assets/battle-replay.css').replace(/\/\*[^]*?\*\//g, '')
    .replace(/:root\[data-theme="light"\][^{}]*\{[^{}]*\}/g, '').replace(/\s+/g, '')
  assert.equal(createHash('sha256').update(css).digest('hex'), 'e0162c6f7b956d5eb4957a2c5b5c9206d63de23ec8d573de93abf19dd6fa6e77')
})

test('浅色属性分段取消透明度，模板内联进度覆盖保留完成与解锁语义', () => {
  const css = read('index.html')
  const rules = [...css.matchAll(/(:root\[data-theme="light"\][^{}]*)\{([^{}]*)\}/g)]
  for (const name of ['grow', 'over99', 'marriage', 'mod', 'equip']) {
    assert.ok(rules.some(m => m[1].includes('.track .sg-' + name) && /opacity: 1;/.test(m[2])))
  }
  for (const [name, token] of [['meter-quest-unlocked', 'ok'], ['meter-gold-start', 'gold']]) {
    assert.ok(rules.some(m => m[1].includes('[style*="--' + name + '"]') && m[2].includes('background: var(--' + token + ') !important')))
  }
  for (const rule of rules) if (/\.(?:bar|pb|track|xb|map-thumb-gauge)\b/.test(rule[1])) {
    assert.doesNotMatch(rule[2], /background:[^;]*(?:transparent|color-mix)/)
  }
})

