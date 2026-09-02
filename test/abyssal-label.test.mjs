import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  createAbyssalNameIndex,
  parseAbyssalLabel,
  stripAbyssalWikiMarkup,
} from '../src/shared/abyssal-label.ts'
import { createAbyssalIdPinner } from '../scripts/lib/abyssal-id-pin.mjs'

// 与 abyssal-id-pin.test.mjs 同一批真实形状：同名多形态、等级在 yomi、正式名自带括号。
const ENTRIES = [
  { id: 1705, name: '重巡夏姫', yomi: '' },
  { id: 1706, name: '重巡夏姫', yomi: '' },
  { id: 1707, name: '重巡夏姫', yomi: '' },
  { id: 1523, name: '軽母ヌ級', yomi: 'elite' },
  { id: 1762, name: '軽母ヌ級', yomi: 'elite' },
  { id: 1776, name: '軽母ヌ級', yomi: 'elite' },
  { id: 1510, name: '軽母ヌ級', yomi: '-' },
  { id: 1560, name: '軽母ヌ級', yomi: 'flagship' },
  { id: 2091, name: '飛行場姫(哨戒機配備)', yomi: 'flagship' },
  { id: 2092, name: '飛行場姫(哨戒機配備)', yomi: 'flagship' },
  { id: 1591, name: '軽巡ツ級', yomi: '' },
]
const index = createAbyssalNameIndex(ENTRIES)

test('候选池：同名同级取全部形态，mstId 升序', () => {
  // 「艦載機白」这类标注定不了号，但池是确定的——模糊命中只需要池
  assert.deepEqual(index.poolOf('軽母ヌ級elite(艦載機白)'), [1523, 1762, 1776])
  assert.deepEqual(index.poolOf('重巡夏姫(壊)'), [1705, 1706, 1707])
})

test('候选池：等级没写时取该基名全部等级的并集（姫级 yomi 常是 flagship）', () => {
  assert.deepEqual(index.poolOf('軽母ヌ級'), [1510, 1523, 1560, 1762, 1776])
})

test('候选池：数字原样包一层，基名不在主数据 → 空池（整条不认）', () => {
  assert.deepEqual(index.poolOf(1501), [1501])
  assert.deepEqual(index.poolOf('深海不存在姫(A)'), [])
})

test('正式名自带的括号不当标注剥：飛行場姫(哨戒機配備) 的池不混入素姫', () => {
  assert.deepEqual(index.poolOf('飛行場姫(哨戒機配備)(艦載機赤)'), [2091, 2092])
})

test('两侧口径必须一致：pinner 报的 candidates 就是 poolOf 的池', () => {
  const pin = createAbyssalIdPinner({
    masterShips: ENTRIES.map((entry) => ({
      api_id: entry.id,
      api_name: entry.name,
      api_yomi: entry.yomi,
    })),
  })
  for (const label of ['軽母ヌ級elite(艦載機白)', '重巡夏姫(A)(HP400)']) {
    assert.deepEqual(pin(label).candidates, index.poolOf(label))
  }
})

test('解析与 wiki 标记清洗对模糊命中同样生效', () => {
  assert.deepEqual(index.poolOf('[[軽母ヌ級elite(艦載機白)'), [1523, 1762, 1776])
  const parsed = parseAbyssalLabel('(随伴)重巡夏姫(壊)', (t) => t === '重巡夏姫')
  assert.equal(parsed.position, '随伴')
  assert.equal(parsed.base, '重巡夏姫')
  assert.equal(stripAbyssalWikiMarkup('重巡リ級flagship]'), '重巡リ級flagship')
})

// ---- 运行时那一侧：只许池，不许定号 ----

test('镝的模糊命中按候选池匹配，绝不在运行时指认具体形态', () => {
  const di = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  // 池口径来自共享模块，与维护期定号脚本同源
  assert.match(di, /createAbyssalNameIndex/)
  assert.match(di, /const abyssalPoolOf = /)
  // 匹配 = 揭示的前三舰逐位落在池内；缺池整条不认
  assert.match(di, /pools\[index\]\?\.includes\(mstId\)/)
  assert.match(di, /pools\.some\(\(pool\) => !pool\.length\)/)
  // 界面明说形态未定，不指认具体形态。2026-08-19 文案体检把同卡三处
  // 「形态未定」并成脚注一处——口径（必须明说）不变，锚点挪到脚注
  assert.match(di, /模糊命中 \$\{fuzzy\.length\} 套/)
  // 2026-08-26 文案清扫：方法自述（「按同名同级候选池匹配，不指认具体形态」）删掉，
  // 「形态未定」这个必须明说的口径本体照钉不误
  assert.match(di, /带 \? 的位置形态未定/)
  // 机制估算只吃精确档——模糊形态的耐久/装备不同，不拿猜的形态出数字
  assert.match(di, /const \{ exact: matched, fuzzy: fuzzyMatched \} = previewEncounterCandidates/)
  // 同上：措辞缩成「各形态耐久与装备不同」，「不出数」这件事仍要当场说清
  assert.match(di, /前三舰仅模糊匹配 · 各形态耐久与装备不同/)
})

test('模糊 token 有独立视觉记号，与精确命中一眼分开', () => {
  const html =
    fs.readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8') +
    fs.readFileSync(new URL('../src/renderer/assets/battle-replay.css', import.meta.url), 'utf8')
  assert.match(html, /\.mod-di \.enemy-token\.fuzzy \{/)
  assert.match(html, /\.mod-di \.enemy-token\.fuzzy \.fz \{/)
})
