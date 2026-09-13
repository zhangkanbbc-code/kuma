import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = name => fs.readFileSync(new URL(`../src/renderer/${name}.html`, import.meta.url), 'utf8')
const html = read('index')
const dark = html.match(/:root\s*\{([^}]+)\}/)
const light = html.match(/:root\[data-theme="light"\]\s*\{([^}]+)\}/)
const declarations = block => [...block.matchAll(/--([\w-]+):\s*([^;]+);/g)]
const varOf = (name, block = light[1]) => {
  const hit = block.match(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})'))
  assert.ok(hit, `找不到 --${name}`)
  return hit[1]
}
const excluded = name => /^(?:voice-dmg-|voice-special$|motion-|serif$|mono$|sans$)/.test(name)
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
const lin = c => c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4
const lum = hex => {
  const [r, g, b] = rgb(hex).map(lin)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)
const lab = hex => {
  const [r, g, b] = rgb(hex).map(lin)
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883
  const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]
}
const deltaE = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]))

test('深色默认块在前，浅色覆盖全部应覆盖 token 且不覆盖豁免项', () => {
  assert.ok(dark && light)
  assert.ok(dark.index < light.index)
  assert.match(dark[1], /color-scheme:\s*dark;/)
  assert.match(light[1], /color-scheme:\s*light;/)
  const expected = declarations(dark[1]).map(m => m[1]).filter(n => !excluded(n)).sort()
  const actual = declarations(light[1]).map(m => m[1]).sort()
  assert.deepEqual(expected.filter(n => !actual.includes(n)), [])
  assert.deepEqual(actual.filter(n => !expected.includes(n)), [])
  assert.equal(new Set(actual).size, actual.length)
})

const groups = {
  '文字与状态': 'text sub dim accent accent-dim accent-ink gold ok warn bad dock air night',
  '资源': 'r-fuel r-ammo r-steel r-baux r-build r-repair r-dev r-screw',
  '实体': 'entity-ship entity-abyss entity-equip entity-map entity-item entity-quest entity-expedition entity-fleet entity-material entity-practice entity-timer entity-nationality entity-shipclass entity-histfleet abyss-ink abyss-soft',
  '属性条与其他': 'stat-grow stat-over99 stat-marriage stat-mod stat-equip damecon-crew damecon-goddess wedding wedding-lit',
}
for (const [group, names] of Object.entries(groups)) {
  test(`浅色${group}在 bg1 达到 4.5、bg0 达到 4.0`, () => {
    for (const name of names.split(' ')) {
      for (const [bg, threshold] of [['bg1', 4.5], ['bg0', 4]]) {
        const c = contrast(varOf(name), varOf(bg))
        assert.ok(c >= threshold, `${name} / ${bg}: ${c}`)
      }
    }
  })
}

test('浅色实体色两两 ΔE 至少 15', () => {
  const names = declarations(light[1]).map(m => m[1]).filter(n => n.startsWith('entity-'))
  assert.equal(names.length, 14)
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const d = deltaE(varOf(names[i]), varOf(names[j]))
      assert.ok(d >= 15, `${names[i]} × ${names[j]}: ${d}`)
    }
  }
})

test('浅色跨族同屏对 ΔE 至少 15，沿用深色色板的全部配对', () => {
  const pairs = [
    ['warn', 'r-baux'], ['gold', 'r-baux'], ['entity-item', 'r-baux'], ['entity-expedition', 'r-baux'],
    ['gold', 'r-ammo'], ['entity-item', 'r-ammo'], ['entity-material', 'r-ammo'],
    ['entity-quest', 'r-dev'], ['entity-fleet', 'r-dev'], ['voice-dmg-sunk', 'r-dev'],
    ['entity-quest', 'night'], ['entity-fleet', 'night'],
    ['entity-ship', 'r-build'], ['r-steel', 'r-build'], ['entity-fleet', 'r-build'],
    ['entity-equip', 'dock'], ['accent', 'dock'], ['entity-ship', 'dock'],
    ['r-baux', 'r-ammo'],
    ['gold', 'warn'], ['gold', 'dock'], ['warn', 'dock'],
  ]
  const core = fs.readFileSync(new URL('./core-regressions.test.mjs', import.meta.url), 'utf8')
  const originalPairs = [...core.match(/const crossPairs = \[([\s\S]*?)\n  \]/)[1]
    .matchAll(/\['([^']+)', '([^']+)'\]/g)].map(m => [m[1], m[2]])
  assert.deepEqual(pairs, originalPairs)
  const color = n => varOf(n, excluded(n) ? dark[1] : light[1])
  for (const [a, b] of pairs) {
    const d = deltaE(color(a), color(b))
    assert.ok(d >= 15, `${a} × ${b}: ${d}`)
  }
})

test('浅色边框与面层对比至少 1.3，婚礼 RGB 与颜色一致', () => {
  assert.ok(contrast(varOf('bg1'), varOf('line')) >= 1.3)
  const value = declarations(light[1]).find(m => m[1] === 'wedding-rgb')[2]
  assert.deepEqual(value.split(',').map(Number), rgb(varOf('wedding')))
})

for (const name of ['battle-replay', 'browse', 'quest-tree', 'resource-trend', 'ship-life']) {
  test(`${name} 独立窗同名 token 与主窗浅色值一致且完整覆盖`, () => {
    const source = read(name)
    const original = source.match(/:root\s*\{([^}]+)\}/)
    const override = source.match(/:root\[data-theme="light"\]\s*\{([^}]+)\}/)
    assert.ok(original && override && original.index < override.index)
    const expected = declarations(original[1]).filter(m => !excluded(m[1])).map(m => m[1]).sort()
    assert.deepEqual(declarations(override[1]).map(m => m[1]).sort(), expected)
    for (const n of expected) {
      const value = (block) => declarations(block).find(m => m[1] === n)?.[2].trim()
      assert.equal(value(override[1]), value(light[1]), n)
    }
  })
}

// 2026-09-13 裁定采用实算达标色：固定次级文字至少 9，弱文字至少 6。
test('浅色正文与弱文字达到 6、次级达到 9、软正文达到 7，强调达到 5', () => {
  assert.equal(varOf('sub'), '#3b4a59')
  assert.equal(varOf('dim'), '#526577')
  for (const [name, threshold] of [['text', 6], ['sub', 9], ['dim', 6], ['text-soft', 7], ...declarations(light[1]).map(m => m[1])
    .filter(n => /^(entity-|r-)/.test(n) || ['ok', 'warn', 'bad', 'dock', 'air', 'night'].includes(n)).map(n => [n, 5])]) {
    assert.ok(contrast(varOf(name), varOf('bg1')) >= threshold, name)
  }
})
