// 编队血条的档色跟着宽度过渡（2026-11-28 他报血条「颜色抽动」，要「自然流畅一点」）：
// 类名一换整条颜色先跳过去、宽度后到——改成颜色与宽度在同一条缓动上，跨档线那一刻正好换到新档。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const { barToneAt, barToneStops } = require(path.join(ROOT, 'dist/shared/bar-tone.js'))

test('档线与编队血条的类名同一套：≤25 红、≤50 橙、≤75 黄、其余绿，在渠水青', () => {
  const ru = fs.readFileSync(path.join(ROOT, 'src/renderer/modules/ru.ts'), 'utf8')
  assert.match(ru, /return r <= 0\.25 \? 'hp-r' : r <= 0\.5 \? 'hp-o' : r <= 0\.75 \? 'hp-y' : 'hp-g'/, 'hpClassOf 的档线变了，这里要跟着改')
  assert.deepEqual([0, 25, 25.1, 50, 50.1, 75, 75.1, 100].map((p) => barToneAt(p, false)), ['r', 'r', 'o', 'o', 'y', 'y', 'g', 'g'])
  assert.equal(barToneAt(10, true), 'd')
})

test('扣血跨档：每跨一条档线，在宽度正好压线那一刻换到线下那一档；不跨档不加颜色动画', () => {
  assert.deepEqual(barToneStops(80, 20, false, false), [
    { offset: 0, tone: 'g' },
    { offset: (75 - 80) / (20 - 80), tone: 'y' },
    { offset: (50 - 80) / (20 - 80), tone: 'o' },
    { offset: (25 - 80) / (20 - 80), tone: 'r' },
    { offset: 1, tone: 'r' },
  ])
  assert.deepEqual(barToneStops(70, 55, false, false), [], '同在黄档')
  assert.deepEqual(barToneStops(30, 25, false, false), [
    { offset: 0, tone: 'o' },
    { offset: 1, tone: 'r' },
    { offset: 1, tone: 'r' },
  ], '正好落在 25% 就是红档')
})

test('回血跨档：往上走时过线就换成线上那一档，位置按宽度算', () => {
  const stops = barToneStops(20, 60, false, false)
  assert.deepEqual(stops.map((s) => s.tone), ['r', 'o', 'y', 'y'])
  assert.deepEqual(stops.map((s) => s.offset), [0, (25 - 20) / 40, (50 - 20) / 40, 1])
  for (let i = 1; i < stops.length; i++) assert.ok(stops[i].offset >= stops[i - 1].offset, '关键帧位置不倒退')
})

test('入渠 ↔ 出渠：不按档线切，水青与档色在整段里渐变', () => {
  assert.deepEqual(barToneStops(40, 100, true, false), [{ offset: 0, tone: 'd' }, { offset: 1, tone: 'g' }])
  assert.deepEqual(barToneStops(20, 20, false, true), [{ offset: 0, tone: 'r' }, { offset: 1, tone: 'd' }])
  assert.deepEqual(barToneStops(30, 60, true, true), [], '在渠中只是宽度在走，颜色一直水青')
})

test('样式表：血条两端颜色注册成可过渡的颜色属性，各档取值收在 --hpbar-*，浅色是纯色', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8')
  for (const name of ['--bar-c0', '--bar-c1']) {
    assert.match(css, new RegExp(`@property ${name} \\{ syntax: '<color>'; inherits: false; initial-value: transparent; \\}`))
  }
  for (const [cls, tone] of [['hp-g', 'g'], ['hp-y', 'y'], ['hp-o', 'o'], ['hp-r', 'r'], ['hp-d', 'd']]) {
    assert.match(css, new RegExp(`\\.fleet-skin \\.${cls} i \\{ --bar-c0: var\\(--hpbar-${tone}-0\\); --bar-c1: var\\(--hpbar-${tone}-1\\); background: linear-gradient\\(90deg, var\\(--bar-c0\\), var\\(--bar-c1\\)\\); \\}`))
  }
  // 深色照旧是同色系深一档 → 主色；浅色两端同色
  assert.match(css, /--hpbar-r-0: var\(--meter-bad-start\); --hpbar-r-1: var\(--bad\);/)
  assert.match(css, /:root\[data-theme="light"\] \.fleet-skin \{[^}]*--hpbar-r-0: var\(--bad\); --hpbar-r-1: var\(--bad\);[^}]*--hpbar-d-0: var\(--dock\); --hpbar-d-1: var\(--dock\);/)
})

test('血条动画都走同一套关键帧：平滑过渡、修理演出、被弹换档；在渠就地补宽度时记录跟着更新', () => {
  const ru = fs.readFileSync(path.join(ROOT, 'src/renderer/modules/ru.ts'), 'utf8')
  const runBarEase = ru.slice(ru.indexOf('const runBarEase = '), ru.indexOf('\n}\n', ru.indexOf('const runBarEase = ')))
  assert.match(runBarEase, /hpBarFrames\(el, span\[0\], span\[1\]/)
  const rowBars = ru.slice(ru.indexOf('const animateRowBars = '), ru.indexOf('\n}\n', ru.indexOf('const animateRowBars = ')))
  assert.match(rowBars, /hpBarFrames\(bar, from, to, hpDocked\[0\], hpDocked\[1\]\)/)
  assert.match(ru, /\{ hp: \[prevBarPct, 100\] \},[^)]*hpDocked: \[true, false\]/, '出渠：水青渐变到档色')
  assert.match(ru, /hpBarFrames\(bar, item\.hpFrom, item\.hpTo, false, false, false\)/, '被弹换档：颜色在冲击那一拍渐变')
  const refresh = ru.slice(ru.indexOf('const refreshDockProgress = '), ru.indexOf('\n}\n', ru.indexOf('const refreshDockProgress = ')))
  assert.match(refresh, /const recorded = barWidths\.get\(id\)\s*\n\s*if \(recorded\) recorded\.hp = barPct/, '就地补的宽度记进平滑过渡的记录，下次重画不往回跳')
})
