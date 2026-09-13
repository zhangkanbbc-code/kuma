import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

// 本护栏检查作用域声明与 token 集合；不把文本判据当作浏览器计算样式的证明。
const html = fs.readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8')
const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
  .map(m => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '')
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(m => ({ selector: m[1].trim(), body: m[2] }))
const declarations = body => new Map([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)]
  .map(m => [m[1], m[2].trim()]))
const dark = declarations(rules.find(r => r.selector === ':root').body)
const light = declarations(rules.find(r => r.selector === ':root[data-theme="light"]').body)
const overlays = rules.filter(r => /#voice-subtitle|#voice-danmaku|#voice-cutin|\.voice-cutin-line|\.voice-danmaku-item|\.fairy-/.test(r.selector))
const tokens = new Set(overlays.flatMap(r => [...r.body.matchAll(/var\(\s*(--[\w-]+)/g)].map(m => m[1])))
// 配套 RGB 也保留同一深色基准，避免颜色与透明度用色分离。
const rgbTokens = new Set([...tokens].map(name => name + '-rgb').filter(name => dark.has(name)))
const themed = tokens.union(rgbTokens).intersection(new Set(light.keys()))
const scope = rules.find(r => r.selector === '#game-wrapper' && /color-scheme\s*:/.test(r.body))

test('游戏叠加层及配套 RGB 的浅色覆盖 token 集合包含于局部重声明集合', () => {
  assert.ok(overlays.length > 0 && tokens.size > 0 && themed.size > 0, '必须实际收集到叠加层 token')
  assert.ok(scope, '游戏画面需要独立主题作用域')
  const redeclared = new Set(declarations(scope.body).keys())
  assert.deepEqual([...themed.difference(redeclared)].sort(), [], '浅色覆盖 token 不得漏锁')
})

test('游戏作用域只引用叠加层专用 token，深浅同值且等于原 token 深色根值', () => {
  assert.ok(scope)
  const local = declarations(scope.body)
  assert.ok(local.size > 0)
  for (const [name, value] of local) {
    assert.ok(dark.has(name), name + ' 必须来自深色根块')
    const alias = value.match(/^var\((--overlay-[\w-]+)\)$/)
    assert.ok(alias, name + ' 必须引用叠加层专用 token')
    assert.ok(dark.has(alias[1]) && light.has(alias[1]), alias[1] + ' 深浅根块必须均有声明')
    assert.equal(dark.get(alias[1]), dark.get(name), name + ' 保留原深色值')
    assert.equal(light.get(alias[1]), dark.get(alias[1]), alias[1] + ' 深浅同值')
  }
})

test('游戏作用域固定 dark，让 light-dark 配色沿用深色分支', () => {
  assert.ok(scope)
  assert.match(scope.body, /(?:^|;)\s*color-scheme\s*:\s*dark\s*;/)
})
