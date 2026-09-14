import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

// 起点 129 次匹配，扣除 5 次注释编号（4 个不同编号）后去重；包含保留的妖精特效原色。
const originalHex = ["#17351f","#1a2733","#1d3d54","#2a4a5e","#2c2617","#2c5c50","#2f5f45","#3a4a58","#3a4c5c","#3d2c5c","#3f806b","#3fcab4","#40351f","#421823","#4a1e29","#4a3a22","#4a3f22","#4db8ff","#4fc47c","#5a8a4a","#5ab8d8","#5c2c38","#5c7284","#5f8aa8","#67c98a","#6ee7ff","#79c0ea","#7ac9b8","#7db4d8","#8095a8","#8a6d2f","#8a7a3a","#8fa8c0","#8fb87a","#8fb8e0","#8fe0cc","#9ad0e0","#9fd6a8","#a33448","#a3dc6f","#a5e0bb","#a8bac8","#ad805e","#b489ff","#b8895a","#b8973a","#bdebc9","#c3d1dc","#c69a70","#c9a86a","#d4b048","#d6efff","#d8b8ff","#e06c75","#e08a97","#e0a94a","#e0c455","#e8a04c","#e8a33d","#e8b86a","#e8b8c0","#e8c66a","#e8ce9a","#efab30","#ff5a6e","#ff8b9a","#ff91a3","#ff9fae","#ffc4cd","#ffe0a3","#ffe8ec","#fff","#fff4b0"]
// 名称 → 深色原值、浅色值、角色类型、使用窗口；0 档稀有度仍为空串。
const addedTokens = {
  "rarity-1": ["#8095a8","#5a6f83","ink",["index"]],
  "rarity-2": ["#7db4d8","#30729e","ink",["index"]],
  "rarity-3": ["#79c0ea","#1a72a7","ink",["index"]],
  "rarity-4": ["#9ad0e0","#2b758b","ink",["index"]],
  "rarity-5": ["#c9a86a","#866831","ink",["index"]],
  "rarity-6": ["#b489ff","#833bff","ink",["index"]],
  "rarity-7": ["#6ee7ff","#00778f","ink",["index"]],
  "rarity-8": ["#e8c66a","#876815","ink",["index"]],
  "sally-1": ["#67c98a","#2c7b48","ink",["index"]],
  "sally-2": ["#e8a04c","#9c5d14","ink",["index"]],
  "sally-3": ["#5ab8d8","#227592","ink",["index"]],
  "sally-4": ["#b489ff","#833bff","ink",["index"]],
  "sally-5": ["#e06c75","#ce2b38","ink",["index"]],
  "sally-6": ["#8fb87a","#52763f","ink",["index"]],
  "sally-7": ["#c9a86a","#866831","ink",["index"]],
  "sally-8": ["#8fa8c0","#506f8e","ink",["index"]],
  "sally-9": ["#e0a94a","#906419","ink",["index"]],
  "sally-10": ["#7db4d8","#30729e","ink",["index"]],
  "sally-11": ["#d8b8ff","#8e31ff","ink",["index"]],
  "sally-12": ["#ff9fae","#db0022","ink",["index"]],
  "sally-13": ["#8fe0cc","#227a64","ink",["index"]],
  "sally-14": ["#e8c66a","#876815","ink",["index"]],
  "qcat-A": ["#67c98a","#2c7b48","ink",["index","quest-tree"]],
  "qcat-B": ["#e06c75","#ce2b38","ink",["index","quest-tree"]],
  "qcat-C": ["#a3dc6f","#49791e","ink",["index","quest-tree"]],
  "qcat-D": ["#3fcab4","#21796b","ink",["index","quest-tree"]],
  "qcat-E": ["#e0c455","#806b17","ink",["index","quest-tree"]],
  "qcat-F": ["#b8895a","#8c643c","ink",["index","quest-tree"]],
  "qcat-G": ["#b489ff","#833bff","ink",["index","quest-tree"]],
  "qcat-E-repair": ["#d4b048","#83691f","ink",["index"]],
  "qcat-F-develop": ["#c69a70","#906339","ink",["index"]],
  "qcat-F-scrap": ["#ad805e","#8b6447","ink",["index"]],
  "alv-bar": ["#7db4d8","#30729e","ink",["index"]],
  "alv-slash": ["#e8a33d","#976112","ink",["index"]],
  "alv-chevron": ["#e8c66a","#876815","ink",["index"]],
  "trend-bucket": ["#7ac9b8","#317869","ink",["index","resource-trend"]],
  "node-cur-stroke": ["#4db8ff","#99c6e3","stroke",["index"]],
  "node-cur-fill": ["#1d3d54","#d1e5f2","fill",["index"]],
  "node-cur-ink": ["#d6efff","#0070b8","ink",["index"]],
  "node-select-stroke": ["#e8b86a","#d4c099","stroke",["index"]],
  "node-select-fill": ["#40351f","#ece3d1","fill",["index"]],
  "node-select-ink": ["#ffe0a3","#946200","ink",["index"]],
  "node-boss-stroke": ["#ff5a6e","#f199a6","stroke",["index"]],
  "node-boss-fill": ["#421823","#f9d1d7","fill",["index"]],
  "node-boss-ink": ["#ffc4cd","#db0021","ink",["index"]],
  "node-passed-stroke": ["#4fc47c","#a8cbb1","stroke",["index"]],
  "node-passed-fill": ["#17351f","#d8e7dc","fill",["index"]],
  "node-passed-ink": ["#bdebc9","#267c3c","ink",["index"]],
  "node-idle-stroke": ["#5c7284","#bbc6ce","stroke",["index"]],
  "node-idle-fill": ["#1a2733","#e0e5e9","fill",["index"]],
  "node-idle-ink": ["#a8bac8","#547085","ink",["index"]],
  "node-link": ["#3a4c5c","#bbc6ce","stroke",["index"]],
  "node-link-passed": ["#4fc47c","#a8cbb1","stroke",["index"]],
  "bar-fuel-from": ["#5a8a4a","#4e7740","ink",["index"]],
  "bar-fuel-to": ["#8fb87a","#52763f","ink",["index"]],
  "bar-ammo-from": ["#8a7a3a","#7b6c34","ink",["index"]],
  "bar-ammo-to": ["#c9a86a","#866831","ink",["index"]],
  "art-placeholder-bg": ["#2c2617","#e9e4d5","fill",["index"]],
  "art-placeholder-ink": ["#e8c66a","#876815","ink",["index"]],
  "art-furniture-ink": ["#9fd6a8","#347a40","ink",["index"]],
  "map-thumb-stroke": ["#ff91a3","#f099a8","stroke",["index"]],
  "map-thumb-fill": ["#4a1e29","#f8d1d8","fill",["index"]],
  "map-thumb-ink": ["#ffe8ec","#da0026","ink",["index"]],
  "card-battle": ["#e08a97","#c6354b","ink",["index"]],
  "card-expedition": ["#8fb8e0","#306fad","ink",["index"]],
  "remodel-ready-ink": ["#a5e0bb","#2a7b49","ink",["index"]],
  "tint-item-owned-line": ["#8a6d2f","#cfbea8","stroke",["index"]],
  "meter-quest-unlocked": ["#3f806b","#3b7764","ink",["index"]],
  "map-area-ink": ["#8fe0cc","#227a64","ink",["index"]],
}
// 收编那一笔的整文件等值核对是一次性验收，已在 6761c81 完成；常驻的只有「不许新写死颜色」的棘轮与 token 覆盖判据。
const read = name => fs.readFileSync(new URL('../src/renderer/' + name, import.meta.url), 'utf8')
const stripCssComments = source => source.replace(/\/\*[\s\S]*?\*\//g, '')
const blocks = source => [...source.matchAll(/:root(?:\[data-theme="light"\])?\s*\{([^}]+)\}/g)].map(m => m[1])
const declarations = block => Object.fromEntries([...stripCssComments(block).matchAll(/--([\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]))
const palettes = name => blocks(read(name + '.html')).map(declarations)
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
const luminance = hex => rgb(hex).map(c => c / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0)
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05)
const hsl = hex => {
  const [r, g, b] = rgb(hex).map(c => c / 255), max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2
  return [d === 0 ? 0 : ((max === r ? (g - b) / d : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + 360) % 360,
    d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1)), l]
}

const hexMatches = text => [...text.matchAll(/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g)]
  .filter(m => !(/^#\d+$/.test(m[0]) && /(?:编号|ID|BGM)\s*$/.test(text.slice(0, m.index))))
// 遍历语法树中的字符串与每段模板；模板插值内继续递归，注释、正则与私有字段不会混入。
function scanTs(source) {
  const file = ts.createSourceFile('scan.ts', source, ts.ScriptTarget.Latest, true)
  const found = []
  function visit(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ||
      [ts.SyntaxKind.TemplateHead, ts.SyntaxKind.TemplateMiddle, ts.SyntaxKind.TemplateTail].includes(node.kind)) {
      for (const hit of hexMatches(node.text)) {
        // 改修数据的 fingerprint 以 # 分隔装备/舰船编号；纯数字段不是 CSS 颜色。
        const numericId = /^#\d+$/.test(hit[0]) && ts.isPropertyAssignment(node.parent) && node.parent.name.getText(file) === 'fingerprint'
        if (!numericId) {
          let statement = node
          while (statement.parent && !ts.isVariableStatement(statement)) statement = statement.parent
          found.push({ color: hit[0], text: node.text, context: statement.getText(file).replace(/\s+/g, ' '),
            line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1 })
        }
      }
    }
    node.forEachChild(visit)
  }
  visit(file)
  return found
}
function scanHtml(source) {
  const mask = value => value.replace(/[^\n]/g, ' ')
  const clean = source.replace(/<!--[\s\S]*?-->|\/\*[^]*?\*\//g, mask)
    .replace(/:root(?:\[data-theme="light"\])?\s*\{[^}]*\}/g, mask)
  const rules = [...clean.matchAll(/<style[^>]*>([^]*?)<\/style>/g)].flatMap(style =>
    [...style[1].matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(rule => ({
      context: rule[0].trim().replace(/\s+/g, ' '), length: rule[0].length,
      index: style.index + style[0].indexOf('>') + 1 + rule.index,
    })))
  return hexMatches(clean).map(m => {
    const rule = rules.find(rule => m.index >= rule.index && m.index < rule.index + rule.length)
    return { color: m[0], context: rule?.context, line: clean.slice(0, m.index).split('\n').length }
  })
}
const walk = url => fs.readdirSync(url, { withFileTypes: true }).flatMap(entry => {
  const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), url)
  return entry.isDirectory() ? walk(child) : [child]
})

test('扫描器识别 3/4/6/8 位颜色，跳过注释与编号，嵌套模板及注释样文本不漏扫', () => {
  const fixture = [
    '// "#abc"', '/* \x60#abcd\x60 */', 'const id = "编号 #1556"',
    'const a = "#abc #abcd #abcdef #abcdef12 #abcde #abcdef1 #abcdef123"',
    'const b = "url // #fed /* #fedc */"',
    'const c = \x60color:#123; \x24{"#aabbcc"} border:#1234; \x24{\x60fill:#87654321\x60} #123456\x60',
    'const d = "color:#1556"', 'const regex = /#abc/',
    'const data = { fingerprint: "490#-#15/30:9/12#501.506;0#554", color: "#123456" }',
  ].join('\n')
  assert.deepEqual(scanTs(fixture).map(x => x.color), ['#abc', '#abcd', '#abcdef', '#abcdef12', '#fed', '#fedc', '#123', '#aabbcc', '#1234', '#87654321', '#123456', '#1556', '#123456'])
  assert.deepEqual(scanHtml('<!-- #abc --><style>:root { --a: #abc; }:root[data-theme="light"] { --a: #def; }/* #fab */.x { color:#123; }</style><b style="color:#aabbcc">编号 #1556</b>').map(x => x.color), ['#123', '#aabbcc'])
})

// 三条完整阴影规则是既有固定黑色效果定义；只认原文件、选择器和声明上下文，不放行新增用色。
// 三组共享常量本身就是跨主进程与渲染层的调色定义，不是绕过 token 的消费端写死颜色。
const colorDefinitions = [
  {"id":"shadow-1","file":"renderer/index.html","context":".mod-di .distract-fleet-row .df-hp > span { position: absolute; inset: 0; text-align: center; font: 9px/12px var(--mono); color: var(--text); text-shadow: 0 1px 2px #000; }","colors":["#000"]},
  {"id":"shadow-2","file":"renderer/index.html","context":".mod-ji .map-thumb-code { position: absolute; left: 3px; top: 2px; z-index: 1; padding: 0 3px; border-radius: 2px; color: var(--map-code-soft); background: color-mix(in srgb, var(--shade-map-code) 78%, transparent); font: 700 8px/1.4 var(--mono); text-shadow: 0 1px 2px #000; }","colors":["#000"]},
  {"id":"shadow-3","file":"renderer/index.html","context":".mod-ji .map-thumb-gauge b { position: absolute; right: 0; bottom: 3px; color: var(--abyss-gauge-soft); font: 700 8px/1 var(--mono); text-shadow: 0 1px 2px #000; }","colors":["#000"]},
  {"id":"DEFAULT_THEME_BASE","file":"shared/theme.ts","context":"export const DEFAULT_THEME_BASE = { dark: '#0d1318', light: '#f3f6f9' } as const","colors":["#0d1318","#f3f6f9"]},
  {"id":"GROUND_ACCENT","file":"shared/theme.ts","context":"export const GROUND_ACCENT = { dark: '#4db8ff', light: '#1773b2' } as const","colors":["#4db8ff","#1773b2"]},
  {"id":"GROUND_INK","file":"shared/theme.ts","context":"const GROUND_INK = { dark: '#e8eef4', light: '#1b2733' } as const","colors":["#e8eef4","#1b2733"]},
]
// 妖精开火渐变是原单明确保留的固定特效定义，精确限定原文件、完整字符串及两枚色标。
const fairyDefinition = { id: 'fairy-salvo', file: 'renderer/fairy-salvo.ts',
  text: 'radial-gradient(circle,#fff 0%,#fff4b0 35%,transparent 70%)', colors: ['#fff', '#fff4b0'] }
const allowedDefinitions = [...colorDefinitions, fairyDefinition]
const expectedAllowed = allowedDefinitions.flatMap(entry => entry.colors.map(color => entry.file + '/' + entry.id + ': ' + color)).sort()
function classifyColors(name, source) {
  const remaining = [], allowed = []
  for (const hit of name.endsWith('.html') ? scanHtml(source) : scanTs(source)) {
    const definition = allowedDefinitions.find(entry => entry.file === name && entry.colors.includes(hit.color) &&
      (entry.text != null ? entry.text === hit.text : entry.context === hit.context))
    if (definition) allowed.push(name + '/' + definition.id + ': ' + hit.color)
    else remaining.push(name + ':' + hit.line + ' ' + hit.color)
  }
  return { remaining, allowed }
}

test('渲染层和共享层不许新增写死颜色，根块外剩余精确等于获准定义', () => {
  const renderer = new URL('../src/renderer/', import.meta.url), shared = new URL('../src/shared/', import.meta.url)
  const sourceRoot = new URL('../src/', import.meta.url)
  const files = [...walk(renderer).filter(url => url.pathname.endsWith('.ts')), ...walk(shared).filter(url => url.pathname.endsWith('.ts')),
    ...fs.readdirSync(renderer).filter(name => name.endsWith('.html')).map(name => new URL(name, renderer))]
  const remaining = [], allowed = []
  for (const url of files) {
    const name = url.pathname.slice(sourceRoot.pathname.length)
    const found = classifyColors(name, fs.readFileSync(url, 'utf8'))
    remaining.push(...found.remaining)
    allowed.push(...found.allowed)
  }
  assert.equal(expectedAllowed.length, 11, '三处阴影、六枚共享基准色、两枚妖精色标')
  assert.deepEqual(allowed.sort(), expectedAllowed, '精确限定颜色与数量，复制获准定义也失败')
  assert.deepEqual(remaining, [], '根块外剩余颜色必须恰好等于允许名单')
})

test('允许名单不放行同文件新增、改上下文、改色或其他文件中的同名定义', () => {
  for (const entry of colorDefinitions) {
    const original = entry.file.endsWith('.html') ? '<style>' + entry.context + '</style>' : entry.context
    const found = classifyColors(entry.file, original)
    assert.equal(found.remaining.length, 0)
    assert.equal(found.allowed.length, entry.colors.length)
    const extra = entry.file.endsWith('.html') ? '<b style="color:#000">字</b>' : '\nconst extra = "#0d1318"'
    assert.equal(classifyColors(entry.file, original + extra).remaining.length, 1)
    const changed = original.replace(entry.colors[0], '#abcdef')
    assert.ok(classifyColors(entry.file, changed).remaining.length > 0)
    const renamed = entry.file.endsWith('.html') ? original.replace('.mod-', '.other-') : original.replace(entry.id, 'OTHER_BASE')
    assert.equal(classifyColors(entry.file, renamed).allowed.length, 0)
    assert.equal(classifyColors('other/' + entry.file, original).allowed.length, 0)
    assert.equal(classifyColors(entry.file, original + '\n' + original).allowed.length, entry.colors.length * 2)
  }
})

test('趋势轴文字沿用已有轴文字 token，深色保留原 CSS 级联结果', () => {
  const source = read('resource-trend-window.ts')
  const text = source.split('\n').find(line => line.includes('自然回复线'))
  assert.ok(text.includes('class="axis"'))
  assert.ok(text.includes('style="fill:var(--chart-axis-soft)"'))
  assert.match(read('resource-trend.html'), /\.axis\s*\{[^}]*fill: var\(--chart-axis-soft\);/)
  const [dark, light] = palettes('resource-trend')
  assert.equal(dark['chart-axis-soft'], '#6c8291')
  assert.equal(light['chart-axis-soft'], '#1b2733')
  assert.ok(!Object.hasOwn(dark, 'trend-cap'))
})

test('本单 token 深色逐枚等于起点颜色、浅色完整覆盖且角色说明齐全', () => {
  assert.equal(originalHex.length, 73)
  assert.equal(new Set(originalHex).size, originalHex.length)
  for (const window of ['index', 'quest-tree', 'resource-trend']) {
    const source = read(window + '.html'), [dark, light] = palettes(window)
    const expected = Object.entries(addedTokens).filter(([, value]) => value[3].includes(window)).map(([name]) => name).sort()
    for (const [mode, block] of blocks(source).entries()) {
      const section = block.split('/* 模板与调色数组颜色：保留深色原值，浅色按角色覆盖。 */')[1]?.split('/* 模板与调色数组颜色结束。 */')[0]
      assert.ok(section, window)
      assert.deepEqual(Object.keys(declarations(section)).sort(), expected)
      assert.equal([...section.matchAll(/\/\*[^]*?\*\/\s*--[\w-]+:/g)].length, expected.length, window + '/' + mode + ' 每枚说明')
    }
    for (const name of expected) {
      const [original, expectedLight, kind] = addedTokens[name]
      assert.equal(dark[name], original, name)
      assert.ok(originalHex.includes(original), name + ' 不在起点清单')
      assert.equal(light[name], expectedLight, name)
      if (kind === 'ink') assert.ok(contrast(light[name], light.bg1) >= 4.5, name)
    }
  }
})

test('本单节点与占位面层按角色基色混白，淡底 18%、边框 40%', () => {
  const light = palettes('index')[1]
  const bases = {
    'node-link': 'node-idle-ink', 'node-link-passed': 'node-passed-ink',
    'art-placeholder-bg': 'art-placeholder-ink', 'tint-item-owned-line': 'entity-item',
    'map-thumb-fill': 'map-thumb-ink', 'map-thumb-stroke': 'map-thumb-ink',
  }
  for (const [name, [, , kind]] of Object.entries(addedTokens)) {
    if (kind !== 'fill' && kind !== 'stroke') continue
    const base = bases[name] ?? name.replace(/-(fill|stroke)$/, '-ink'), weight = kind === 'fill' ? 0.18 : 0.4
    const expected = '#' + rgb(light[base]).map(c => Math.round(c * weight + 255 * (1 - weight)).toString(16).padStart(2, '0')).join('')
    assert.equal(light[name], expected, name)
  }
})

test('任务七色与札十四色的浅色只压明度，色相偏差 ≤ 15°', () => {
  const [dark, light] = palettes('index')
  for (const name of Object.keys(addedTokens).filter(n => /^(qcat-|sally-)/.test(n))) {
    const [dh, ds, dl] = hsl(dark[name]), [lh, ls, ll] = hsl(light[name]), delta = Math.abs(dh - lh)
    assert.ok(Math.min(delta, 360 - delta) <= 15, name + ' 色相')
    assert.ok(Math.abs(ds - ls) <= 0.02, name + ' 仅舍入引入饱和度误差')
    assert.ok(ll < dl, name + ' 明度下降')
  }
})

test('熟练度与札的实际返回值覆盖全部档位，稀有度 0 档不占 token', () => {
  const execute = source => new Function(ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }))()
  const alv = execute(read('alv-icon.ts').replace(/^export /gm, '') + '\nreturn alvIconHtml')
  for (let level = 1; level <= 7; level++) {
    const markup = alv(level), kind = level <= 3 ? 'bar' : level <= 6 ? 'slash' : 'chevron'
    assert.ok(markup.includes('var(--alv-' + kind + ')'))
    assert.doesNotMatch(markup, /(?:fill|stroke)="var\(/)
  }
  assert.equal(alv(0), '')
  const sally = execute(read('sally-tag.ts').replace(/^import .*$/gm, '').replace(/^export /gm, '') + '\nreturn sallyTagColor')
  for (let tag = 1; tag <= 28; tag++) assert.equal(sally(tag), 'var(--sally-' + ((tag - 1) % 14 + 1) + ')')
  const rarity = execute(read('modules/ji.ts').match(/const RARITY_COLOR = [^\n]+/)[0] + '\nreturn RARITY_COLOR')
  assert.deepEqual(rarity, ['', ...Array.from({ length: 8 }, (_, i) => 'var(--rarity-' + (i + 1) + ')')])
  assert.ok(!Object.hasOwn(palettes('index')[0], 'rarity-0'))
})
