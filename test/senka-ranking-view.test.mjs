// 战果详情弹窗的「排行」一节（2026-09-25 维护者裁决）：最近一次排行刷新里翻到过的各页，
// 名次 / 提督名 / 战果，本人那一行高亮；下面一张按日曲线，四条线是第 5/20/100/500 名
// （维护者叫法：联合 / 一群 / 二群 / 三群）。视图文件只依赖 kernel 的 esc，这里桩成同一实现后整份编译。
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-senka-rank-'))
  const outfile = path.join(dir, 'view.cjs')
  await build({
    entryPoints: [path.join(ROOT, 'src', 'renderer', 'senka-ranking-view.ts')],
    outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
    plugins: [{
      name: 'stub-kernel',
      setup(build) {
        build.onResolve({ filter: /(^|\/)kernel$/ }, () => ({ path: 'kernel', namespace: 'stub' }))
        build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents: "export const esc = (s) => `${s ?? ''}`.replace(/[&<>\"']/g, (c) => `&#${c.charCodeAt(0)};`)",
          loader: 'js',
        }))
      },
    }],
  })
  return createRequire(import.meta.url)(outfile)
})()

const jst = (s) => Date.parse(`${s}+09:00`)
const sample = (over = {}) => ({
  refreshAt: jst('2026-09-25T03:00'),
  rows: [
    { rank: 229, nickname: '提督甲', senka: 1390, own: false },
    { rank: 230, nickname: '本人', senka: 1385, own: true },
    { rank: 231, nickname: '<b>坏名字</b>', senka: 1380, own: false },
  ],
  lines: {
    5: [{ day: '2026-09-10', senka: 3100 }, { day: '2026-09-11', senka: 3300 }],
    20: [{ day: '2026-09-10', senka: 2500 }, { day: '2026-09-12', senka: 2700 }],
    100: [{ day: '2026-09-12', senka: 1810 }],
    500: [],
  },
  undecoded: 0,
  ...over,
})

test('名次表：每行名次、提督名、战果，本人那一行高亮，名字转义', () => {
  const html = view.senkaRankingHtml(sample())
  assert.match(html, /排行/)
  assert.match(html, /9月25日 3:00 刷新/)
  const rows = html.match(/<div class="sd-rank-row[^"]*"[\s\S]*?<\/div>/g) ?? []
  assert.equal(rows.length, 3)
  assert.match(rows[1], /class="sd-rank-row me"/)
  assert.match(rows[1], /第230名[\s\S]*本人[\s\S]*1,?385/)
  assert.doesNotMatch(rows[0], /\bme\b/)
  assert.ok(!html.includes('<b>坏名字</b>') && html.includes('&#60;b&#62;坏名字'))
})

test('按日曲线：四条线的图例都在，两点以上的线画折线，一点的画点，没有点的图例标暂无', () => {
  const html = view.senkaRankingHtml(sample())
  for (const label of ['联合·5位', '一群·20位', '二群·100位', '三群·500位']) assert.ok(html.includes(label), label)
  assert.equal((html.match(/<polyline\b/g) ?? []).length, 2)
  assert.ok(/<circle\b[^>]*class="[^"]*ln-100/.test(html), '只有一点的线要画点')
  assert.match(html, /三群·500位[^<]*<[^>]*>?[^<]*暂无|三群·500位[\s\S]{0,40}暂无/)
})

test('本月没打开过排行页：只留一句指路，不画空表空图', () => {
  const html = view.senkaRankingHtml(sample({ refreshAt: null, rows: [], lines: { 5: [], 20: [], 100: [], 500: [] } }))
  assert.match(html, /本月还没打开过游戏排行页/)
  assert.ok(!html.includes('sd-rank-row') && !html.includes('<svg'))
})

test('有解不出的页：补一句提示页数', () => {
  assert.match(view.senkaRankingHtml(sample({ undecoded: 2 })), /2页排行未能解读/)
  assert.doesNotMatch(view.senkaRankingHtml(sample()), /未能解读/)
})

test('缺日补点：折线穿过估算点，估算点画成灰点（est 类），真实点不带 est', () => {
  const html = view.senkaRankingHtml(sample({
    lines: {
      5: [{ day: '2026-09-10', senka: 3000 }, { day: '2026-09-13', senka: 3300 }],
      20: [], 100: [], 500: [],
    },
  }))
  const poly = /<polyline\b[^>]*class="ln-5"[^>]*points="([^"]*)"/.exec(html) ?? /<polyline\b[^>]*points="([^"]*)"[^>]*class="ln-5"/.exec(html)
  assert.ok(poly, '第 5 名要画折线')
  assert.equal(poly[1].trim().split(/\s+/).length, 4, '折线要穿过两个估算点')
  const est = html.match(/<circle\b[^>]*class="[^"]*\best\b[^"]*"/g) ?? []
  assert.equal(est.length, 2)
  assert.ok(est.every((c) => /ln-5/.test(c)))
})

// 2026-09-25 维护者追加（beta.26 正文已对玩家预告）：曲线悬停显示具体数值。
// 做法：每一天一条透明竖条挂 kuma 的多行富提示（data-tip），一次列出当天四条线的值；
// 估算点注「（估算）」，当天该线没有值写「—」。
test('曲线悬停：每天一条竖条，提示列出当天四条线的值，估算注明、缺值写横线', () => {
  const html = view.senkaRankingHtml(sample())
  const hits = [...html.matchAll(/<rect\b[^>]*class="sd-rank-hit"[^>]*>/g)].map((m) => m[0])
  assert.equal(hits.length, 3, '9/10、9/11、9/12 各一条')
  const tipOf = (tag) => ({
    title: /data-tip-title="([^"]*)"/.exec(tag)?.[1],
    lines: (/data-tip="([^"]*)"/.exec(tag)?.[1] ?? '').split('\n'),
  })
  const d11 = hits.map(tipOf).find((t) => t.title === '9月11日')
  assert.ok(d11, '缺 9月11日 那一条')
  assert.deepEqual(d11.lines, ['联合·5位 3,300', '一群·20位 2,600（估算）', '二群·100位 —', '三群·500位 —'])
  const d10 = hits.map(tipOf).find((t) => t.title === '9月10日')
  assert.deepEqual(d10.lines, ['联合·5位 3,100', '一群·20位 2,500', '二群·100位 —', '三群·500位 —'])
})

test('曲线悬停：本月一个点都没有时不出竖条', () => {
  const html = view.senkaRankingHtml(sample({ lines: { 5: [], 20: [], 100: [], 500: [] } }))
  assert.ok(!html.includes('sd-rank-hit'))
})

// 往月记录与疑似排行奖励（2026-09-29）：排行一节末尾「往月」小节，每月一行。
test('往月：每月一行，本人名次与战果、四档最后看到的值，疑似奖励单列并标疑似', () => {
  const AUG = Date.parse('2026-07-31T22:00+09:00')
  const html = view.senkaRankingHtml(sample({
    history: [{
      monthStart: AUG,
      own: { rank: 1327, senka: 884, refreshAt: jst('2026-08-31T15:00') },
      lines: { 5: { senka: 9230, refreshAt: jst('2026-08-31T15:00') }, 20: { senka: 6532, refreshAt: jst('2026-08-31T15:00') }, 100: null, 500: { senka: 3203, refreshAt: jst('2026-08-31T15:00') } },
      undecoded: 0,
      rewards: [{ itemId: 57, name: '勋章', count: 2, ts: jst('2026-09-01T03:12') }],
    }],
  }))
  const block = /<div class="sd-rank-history"[\s\S]*$/.exec(html)?.[0] ?? ''
  assert.ok(block, '缺往月小节')
  assert.match(block, /往月/)
  assert.match(block, /2026年8月[\s\S]*第1327名[\s\S]*884/)
  assert.match(block, /联合 9,230 · 一群 6,532 · 二群 — · 三群 3,203/)
  assert.match(block, /疑似排行奖励：勋章×2/)
})

test('往月：本人没解出来写「未看到本人」；没有疑似奖励不出那一行；没有往月不出小节', () => {
  const AUG = Date.parse('2026-07-31T22:00+09:00')
  const html = view.senkaRankingHtml(sample({
    history: [{ monthStart: AUG, own: null, lines: { 5: null, 20: null, 100: null, 500: null }, undecoded: 1, rewards: [] }],
  }))
  assert.match(html, /2026年8月[\s\S]*未看到本人/)
  assert.doesNotMatch(html, /疑似排行奖励/)
  assert.ok(!view.senkaRankingHtml(sample({ history: [] })).includes('sd-rank-history'))
  assert.ok(!view.senkaRankingHtml(sample()).includes('sd-rank-history'))
})

// 2026-09-30：疑似奖励也收装备——装备写名字、改修星（有才写）与件数，道具照旧名字×件数。
test('往月：疑似排行奖励里的装备写改修星，道具照旧', () => {
  const AUG = Date.parse('2026-07-31T22:00+09:00')
  const html = view.senkaRankingHtml(sample({
    history: [{
      monthStart: AUG, own: null, lines: { 5: null, 20: null, 100: null, 500: null }, undecoded: 0,
      rewards: [
        { kind: 'equip', itemId: 22, name: '零式艦戦22型(251空)', level: 5, count: 1, ts: jst('2026-09-29T20:00') },
        { kind: 'equip', itemId: 110, name: '一式陸攻(野中隊)', level: 0, count: 2, ts: jst('2026-09-29T20:01') },
        { kind: 'item', itemId: 57, name: '勋章', count: 1, ts: jst('2026-09-29T20:02') },
      ],
    }],
  }))
  assert.match(html, /疑似排行奖励：零式艦戦22型\(251空\)★\+5×1、一式陸攻\(野中隊\)×2、勋章×1/)
})
