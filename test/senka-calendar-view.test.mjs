// 战果日历卡的内容（2026-09-29 裁决）：抬头月份 + 左右翻月；周一在前的 7 列；
// 格子写日期、当天战果增加（取整，带 +）、当天名次与升降（↑绿 ↓红）；底色按当天战果相对当月单日最多的比例；
// 底部一行月汇总。视图文件只依赖 kernel 的 esc，这里桩成同一实现后整份编译。
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const view = await (async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-senka-cal-'))
  const outfile = path.join(dir, 'view.cjs')
  await build({
    entryPoints: [path.join(ROOT, 'src', 'renderer', 'senka-calendar-view.ts')],
    outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
    plugins: [{
      name: 'stub-kernel',
      setup(b) {
        b.onResolve({ filter: /(^|\/)kernel$/ }, () => ({ path: 'kernel', namespace: 'stub' }))
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents: "export const esc = (s) => `${s ?? ''}`.replace(/[&<>\"']/g, (c) => `&#${c.charCodeAt(0)};`)",
          loader: 'js',
        }))
      },
    }],
  })
  return createRequire(import.meta.url)(outfile)
})()

const cell = (over) => ({ gain: 0, rank: null, rankDelta: null, future: false, today: false, ...over })
const model = (over = {}) => ({
  month: '2026-09',
  label: '2026年9月',
  weeks: [
    [null, cell({ day: '2026-09-01', date: 1, gain: 12.4 }), cell({ day: '2026-09-02', date: 2 }), null, null, null, null],
    [cell({ day: '2026-09-28', date: 28, gain: 90, rank: 141, rankDelta: 606 }),
      cell({ day: '2026-09-29', date: 29, gain: 131.6, rank: 165, rankDelta: -24, today: true }),
      cell({ day: '2026-09-30', date: 30, future: true }), null, null, null, null],
  ],
  total: 234,
  latestRank: 165,
  maxGain: 131.6,
  canPrev: true,
  canNext: false,
  ...over,
})
const cellHtml = (html, day) => new RegExp(`<div class="sc-cell[^"]*"[^>]*data-day="${day}"[\\s\\S]*?</div>\\s*</div>`).exec(html)?.[0] ?? ''

test('抬头：月份与翻月按钮，能翻的方向才可点', () => {
  const html = view.senkaCalendarHtml(model())
  assert.match(html, /2026年9月/)
  assert.match(html, /<button[^>]*data-cal-nav="-1"(?![^>]*disabled)[^>]*>/)
  assert.match(html, /<button[^>]*data-cal-nav="1"[^>]*disabled/)
})

test('星期表头周一在前', () => {
  const html = view.senkaCalendarHtml(model())
  const heads = [...html.matchAll(/<span class="sc-wd">([^<]*)<\/span>/g)].map((m) => m[1])
  assert.deepEqual(heads, ['一', '二', '三', '四', '五', '六', '日'])
})

test('格子：战果取整带加号；名次与升降，升绿（up）降红（down）；今天标出', () => {
  const html = view.senkaCalendarHtml(model())
  const d29 = cellHtml(html, '2026-09-29')
  assert.match(d29, /class="sc-cell[^"]*\btoday\b/)
  assert.match(d29, />29</)
  assert.match(d29, /\+132/)
  assert.match(d29, /第165名/)
  assert.match(d29, /<[^>]*class="[^"]*\bdown\b[^"]*"[^>]*>↓24</)
  const d28 = cellHtml(html, '2026-09-28')
  assert.match(d28, /<[^>]*class="[^"]*\bup\b[^"]*"[^>]*>↑606</)
})

test('格子：没战果的日子不写加号，没看排行的日子不写名次；未来的格子只有日期', () => {
  const html = view.senkaCalendarHtml(model())
  const d2 = cellHtml(html, '2026-09-02')
  assert.doesNotMatch(d2, /\+|第\d+名/)
  const d1 = cellHtml(html, '2026-09-01')
  assert.match(d1, /\+12/)
  assert.doesNotMatch(d1, /第\d+名/)
  const d30 = cellHtml(html, '2026-09-30')
  assert.match(d30, /class="sc-cell[^"]*\bfuture\b/)
  assert.doesNotMatch(d30, /\+|第\d+名/)
})

test('底色深浅：按当天战果相对当月单日最多的比例，写成 --heat 变量', () => {
  const html = view.senkaCalendarHtml(model())
  const heat = (day) => Number(/--heat:\s*([\d.]+)/.exec(cellHtml(html, day))?.[1] ?? NaN)
  assert.equal(heat('2026-09-29'), 1)
  assert.ok(Math.abs(heat('2026-09-28') - 90 / 131.6) < 0.01)
  assert.ok(Number.isNaN(heat('2026-09-02')) || heat('2026-09-02') === 0)
})

test('月汇总：本月合计与最后看到的名次；本月没看过排行就不写名次', () => {
  assert.match(view.senkaCalendarHtml(model()), /本月 \+234 · 第165名/)
  const none = view.senkaCalendarHtml(model({ latestRank: null }))
  assert.match(none, /本月 \+234/)
  assert.doesNotMatch(none, /本月 \+234 · 第/)
})
