import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = name => fs.readFileSync(new URL('../src/renderer/' + name, import.meta.url), 'utf8')
const stripComments = source => source.replace(/\/\*[^]*?\*\//g, '')
const css = stripComments(read('assets/battle-replay.css'))
const declarations = block => Object.fromEntries([...block.matchAll(/([\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]))
const palettes = name => [...stripComments(read(name + '.html')).matchAll(/:root(?:\[data-theme="light"\])?\s*\{([^}]+)\}/g)]
  .map(m => declarations(m[1]))
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
const luminance = hex => rgb(hex).map(c => c / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0)
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05)

test('战斗共享样式无十六进制颜色，RGBA 仅保留纯黑阴影和纯白高光', () => {
  // 只扫描声明，ID 选择器不是颜色。
  const values = [...css.matchAll(/[^{}]+\{([^{}]*)\}/g)]
    .flatMap(m => [...m[1].matchAll(/[\w-]+:\s*([^;]+);/g)].map(declaration => declaration[1]))
  for (const value of values) {
    assert.doesNotMatch(value, /#[0-9a-fA-F]{3,8}\b/)
    for (const match of value.matchAll(/rgba\(([^)]*)\)/g)) {
      const channels = match[1].split(',').map(value => value.trim())
      assert.equal(channels.length, 4)
      assert.ok(['0,0,0', '255,255,255'].includes(channels.slice(0, 3).join(',')), match[0])
    }
  }
})

test('战斗共享样式引用的 token 在主窗与独立复盘窗深色根块都有定义', () => {
  const runtime = new Set(['dmg-ch', 'hc', 'tag', 'enemy', 'enemy-dim', 'sea'])
  for (const name of ['index', 'battle-replay']) {
    const [dark] = palettes(name)
    for (const match of css.matchAll(/var\(--([\w-]+)(\s*,)?/g)) {
      const token = match[1]
      if (runtime.has(token)) continue
      if (['bar-fuel-to', 'bar-ammo-to'].includes(token) && match[2]) continue
      assert.ok(Object.hasOwn(dark, '--' + token), name + ' 缺少 --' + token)
    }
  }
})

// 名字与流水字色逐项列出起点值；包括默认/敌方/零伤害分支和阶段头继承的默认字色。
// 航空阶段起点已用 --air，仍按其原深色实值钉住；不使用整表或 token 集合哈希。
const textColors = [
  [".mod-di .lrow .who", "text-soft", "#c3d1dc"],
  [".mod-di .lrow .who.foe", "abyss-log-soft", "#e0a5ae"],
  [".mod-di .lrow .who.friend", "accent-log-soft", "#9fd8ff"],
  [".mod-di .lstage-h", "dim", "#75899a"],
  [".mod-di .lstage-h .lstage-nm.air", "phase-air-soft", "#8fd694"],
  [".mod-di .lstage-h .lstage-nm.lbas", "phase-air-soft", "#8fd694"],
  [".mod-di .lstage-h .lstage-nm.tor", "phase-torpedo-soft", "#8fb8e0"],
  [".mod-di .lstage-h .lstage-nm.gun", "phase-gun-soft", "#e0c27a"],
  [".mod-di .lstage-h .lstage-nm.night", "night", "#7e86f2"],
  [".mod-di .lstage-h .lstage-nm.sup", "phase-support-soft", "#b9c8e8"],
  [".mod-di .lstage-h .lstage-nm.friend", "accent-log-soft", "#9fd8ff"],
  [".mod-di .lstage-h .lstage-nm.radar", "phase-radar-soft", "#f0c890"],
  [".mod-di .lrow .ph", "dim", "#75899a"],
  [".mod-di .lrow .ph.air", "phase-air-soft", "#8fd694"],
  [".mod-di .lrow .ph.tor", "phase-torpedo-soft", "#8fb8e0"],
  [".mod-di .lrow .ph.gun", "phase-gun-soft", "#e0c27a"],
  [".mod-di .lrow .ph.night", "night", "#7e86f2"],
  [".mod-di .lrow .ph.sup", "phase-support-soft", "#b9c8e8"],
  [".mod-di .lrow .ph.lbas", "phase-air-soft", "#8fd694"],
  [".mod-di .lrow .ph.friend", "accent-log-soft", "#9fd8ff"],
  [".mod-di .lrow .ph.radar", "phase-radar-soft", "#f0c890"],
  [".mod-di .tn", "dim", "#75899a"],
  [".mod-di .tn.done", "ok-verdict-soft", "#a5e0bb"],
  [".mod-di .tn.air.done", "phase-radar-soft", "#f0c890"],
  [".mod-di .tn.night.done", "night-route-node-soft", "#bcc3f7"],
  [".mod-di .tn.gain.done", "gold-route-soft", "#eede9f"],
  [".mod-di .tn.whirl.done", "dock-route-soft", "#9fd8e8"],
  [".mod-di .tn.calm.done", "calm-route-soft", "#b7c6cf"],
  [".mod-di .tn.cur", "accent-ink", "#bfe6ff"],
  [".mod-di .tn.boss", "abyss-route-soft", "#c98a97"],
  [".mod-di .tn.cur.boss", "abyss-route-current-soft", "#ffb9c4"],
  [".mod-di .trail .map", "trail-map-soft", "#8fe0cc"],
  [".mod-di .night-route .nr-side", "night-side-soft", "#dbe9f3"],
  [".mod-di .night-route .nr-side.foe", "abyss-ink", "#ff9fae"],
  [".mod-di .night-route .nr-arrow", "night-arrow-soft", "#8f75ad"],
  [".mod-di .night-forecast b", "night-forecast-soft", "#a8b4e0"],
  [".mod-di .prebattle-model-head b", "night-model-soft", "#c7b3dc"],
  [".mod-di .practice-preview-model-meta b", "night-model-soft", "#c7b3dc"],
  [".mod-di .battle-drop-chip b", "gold-drop-soft", "#ffeab4"],
  [".mod-di .brow .dmg", "accent-log-soft", "#9fd8ff"],
  [".mod-di .fside.foe .brow .dmg", "abyss-ink", "#ff9fae"],
  [".mod-di .brow .dmg.zero", "dim", "#75899a"],
  [".mod-di .beq-plane b", "accent-log-soft", "#9fd8ff"],
  [".mod-di .fside.foe .beq-plane b", "abyss-ink", "#ff9fae"],
  [".mod-di .drop-r b", "accent-log-soft", "#9fd8ff"],
  [".mod-di .battle-replay-note", "warn-missing-soft", "#d8ad72"],
  [".mod-di .battle-replay-note.replay-error", "bad-replay-soft", "#ffb3bd"],
  [".mod-di .battle-replay-note button", "warn-dismiss-soft", "#e7c58d"],
  ["#di-used-equipment-popover b", "dock-equipment-active-soft", "#d5edf5"],
  [".first-mark.drop", "accent-first-soft", "#8fd0ff"],
  [".first-mark.kill", "abyss-ink", "#ff9fae"],
  [".first-line.drop", "accent-first-soft", "#8fd0ff"],
  [".first-line.kill", "abyss-ink", "#ff9fae"],
  [".first-line.none", "dim", "#75899a"],
  [".first-line b", "text", "#e8eef4"],
]

test('名字与流水字色逐项保留深色原值，浅色对 bg1 至少 6', () => {
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(m => ({ selectors: m[1].trim().split(/,\s*/), values: declarations(m[2]) }))
  for (const [selector, token, original] of textColors) {
    const matching = rules.filter(rule => rule.selectors.includes(selector) && rule.values.color)
    assert.equal(matching.length, 1, selector + ' 的字色声明必须唯一存在')
    assert.equal(matching[0].values.color, 'var(--' + token + ')', selector)
    for (const name of ['index', 'battle-replay']) {
      const [dark, light] = palettes(name)
      assert.equal(dark['--' + token], original, name + ' / ' + selector)
      assert.match(light['--' + token] ?? '', /^#[0-9a-fA-F]{6}$/, token)
      const ratio = contrast(light['--' + token], light['--bg1'])
      assert.ok(ratio >= 6, name + ' / ' + selector + ' / --' + token + ': ' + ratio)
    }
  }
})
