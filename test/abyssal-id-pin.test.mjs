import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  createAbyssalIdPinner,
  parseAbyssalLabel,
  stripWikiMarkup,
} from '../scripts/lib/abyssal-id-pin.mjs'

// 取真实数据的形状：同名多形态、等级在 api_yomi、正式名自带括号。
const MASTER = [
  { api_id: 1705, api_name: '重巡夏姫', api_yomi: '' },
  { api_id: 1706, api_name: '重巡夏姫', api_yomi: '' },
  { api_id: 1707, api_name: '重巡夏姫', api_yomi: '' },
  { api_id: 1523, api_name: '軽母ヌ級', api_yomi: 'elite' },
  { api_id: 1762, api_name: '軽母ヌ級', api_yomi: 'elite' },
  { api_id: 1776, api_name: '軽母ヌ級', api_yomi: 'elite' },
  { api_id: 1510, api_name: '軽母ヌ級', api_yomi: '-' },
  { api_id: 1560, api_name: '軽母ヌ級', api_yomi: 'flagship' },
  // 正式名自带括号，且另有一批同前缀的「飛行場姫」
  { api_id: 2091, api_name: '飛行場姫(哨戒機配備)', api_yomi: 'flagship' },
  { api_id: 2092, api_name: '飛行場姫(哨戒機配備)', api_yomi: 'flagship' },
  { api_id: 1556, api_name: '飛行場姫', api_yomi: 'flagship' },
  { api_id: 1631, api_name: '飛行場姫', api_yomi: 'flagship' },
  { api_id: 1591, api_name: '軽巡ツ級', api_yomi: '' },
]
const STATS = {
  1705: { api_taik: 400 }, 1706: { api_taik: 450 }, 1707: { api_taik: 550 },
  1523: { api_taik: 70 }, 1762: { api_taik: 70 }, 1776: { api_taik: 70 },
  2091: { api_taik: 300 }, 2092: { api_taik: 400 },
}
const pin = createAbyssalIdPinner({ masterShips: MASTER, abyssalStats: STATS })

test('名字与主数据完全一致时直接定号', () => {
  assert.equal(pin('軽巡ツ級').id, 1591)
  assert.equal(pin('軽母ヌ級elite').id, 1523) // 名字 + 等级
})

test('字母是同名同级按 mstId 升序的第几个', () => {
  assert.equal(pin('軽母ヌ級elite(B)(艦載機白)').id, 1762)
  assert.equal(pin('軽母ヌ級elite(C)(艦載機鳥白)').id, 1776)
  // 等级不同的形态不进同一个池
  assert.equal(pin('軽母ヌ級flagship').id, 1560)
})

test('字母与 HP 都在时必须一致，一致才定号', () => {
  const hit = pin('重巡夏姫(A)(HP400)')
  assert.equal(hit.id, 1705)
  assert.match(hit.reason, /两条判据一致/)
  assert.equal(pin('重巡夏姫(B)(HP450)').id, 1706)
  assert.equal(pin('重巡夏姫(C)(HP550)').id, 1707)
})

test('两条判据打架就拒绝定号——这是安全阀，不是失败', () => {
  const conflict = pin('重巡夏姫(A)(HP550)') // 字母指 1705，HP 指 1707
  assert.equal(conflict.id, null)
  assert.match(conflict.reason, /不一致/)
  // HP 查不到（abyssal-stats 还没收录的新舰）同样算打架，不能只信字母
  const missing = pin('重巡夏姫(A)(HP999)')
  assert.equal(missing.id, null)
  assert.match(missing.reason, /查不到/)
})

test('正式名自带的括号不能当标注剥掉', () => {
  // 「飛行場姫(哨戒機配備)」整个是主数据里的名字；剥掉会把池扩大到所有飛行場姫
  const hit = pin('飛行場姫(哨戒機配備)(A)(HP300)')
  assert.equal(hit.id, 2091)
  assert.deepEqual(hit.candidates, [2091, 2092])
  assert.equal(pin('飛行場姫(哨戒機配備)(B)(HP400)').id, 2092)
  // 不带那个括号的是另一族
  assert.equal(pin('飛行場姫flagship(A)').id, 1556)
})

test('没有可查证判据时留空，不猜', () => {
  // 「艦載機白」在主数据和 abyssal-stats 里都没有对应项
  const vague = pin('軽母ヌ級elite(艦載機白)')
  assert.equal(vague.id, null)
  assert.match(vague.reason, /没有可查证的对应项/)
  assert.deepEqual(vague.candidates, [1523, 1762, 1776])
  // 主数据里根本没有这个名字
  assert.equal(pin('深海不存在姫(A)').id, null)
})

test('wiki 链接标记残留不该把名字带歪', () => {
  assert.equal(stripWikiMarkup('[[軽母ヌ級elite(B)(艦載機白)'), '軽母ヌ級elite(B)(艦載機白)')
  assert.equal(stripWikiMarkup('重巡リ級flagship]'), '重巡リ級flagship')
  assert.equal(pin('[[軽母ヌ級elite(B)(艦載機白)').id, 1762)
})

test('开头的站位说明是说明，不是名字的一部分', () => {
  const parsed = parseAbyssalLabel('(後衛)軽母ヌ級elite(B)', (t) => t === '軽母ヌ級')
  assert.equal(parsed.position, '後衛')
  assert.equal(parsed.base, '軽母ヌ級')
  assert.equal(parsed.rank, 'elite')
  assert.equal(parsed.letter, 'B')
  assert.equal(pin('(後衛)軽母ヌ級elite(B)(艦載機白)').id, 1762)
})

// ---- 运行时那一侧：只认定好的号 ----

import { readFileSync } from 'node:fs'
import mapIntelModule from '../dist/shared/map-intel.js'

const { enemyCompIds } = mapIntelModule

test('取号只接受定好的 shipIds，或者资料本来就是数字', () => {
  assert.deepEqual(enemyCompIds({ formation: 1, ships: [1501, 1502] }), [1501, 1502])
  assert.deepEqual(
    enemyCompIds({ formation: 1, ships: ['駆逐イ級', '駆逐ロ級'], shipIds: [1501, 1502] }),
    [1501, 1502],
  )
  // 名字没定号 → 整套跳过，不在运行时补解析
  assert.equal(enemyCompIds({ formation: 1, ships: ['駆逐イ級', '駆逐ロ級'] }), null)
  // 半截的号比没有更危险：长度对不上就整条不认
  assert.equal(enemyCompIds({ formation: 1, ships: ['A', 'B'], shipIds: [1501] }), null)
  assert.equal(enemyCompIds({ formation: 1, ships: ['A', 'B'], shipIds: [1501, 0] }), null)
})

test('运行时不许按名字把敌编成定到单一 id——定号是维护期的事', () => {
  // 2026-08-12 修订：运行时允许把标注解析成**同名同级候选池**做模糊命中
  // （口径与本脚本共用 shared/abyssal-label，见 abyssal-label.test.mjs），
  // 但收敛到单一 id 仍只许维护期做——猜错形态就是对着玩家说错敌人是谁。
  const di = readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  const ji = readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  // 镝里那份挑最小 id 的深海名解析器不许回来；留着迟早有人拿它去「兜底」
  assert.doesNotMatch(di, /resolveAbyssalName/)
  // 鉴里还留着一处语音兜底，但敌编成相关的三处都必须走 shipIds
  assert.doesNotMatch(ji, /enemyComps[\s\S]{0,400}?resolveAbyssalName/)
})

test('两条定号流水线已退役，不许再回来', () => {
  // 2026-08-22：常规图敌编成改吃第一方汇编包（map-enemy-comps），上游逐条自带 mstId，
  // 「靠名字猜号」这件事的存在理由随之消失——pin-map-intel-ids（靠主数据判据）与
  // pin-map-intel-observed（靠实战观测）两条流水线一并退役。
  //
  // 这条护栏钉的是**不许悄悄加回来**：一旦有人为了给活动图补号又把它请回来，
  // 就会出现「同一份包里一半是上游给的号、一半是我们猜的号」的混合口径，
  // 而混合口径正是当初 99 条定不下来还留在包里的那个局面。
  //
  // 2026-08-24 批次 3 落地：活动图的号已改从舰娘百科活动海域页的「深海配置」原生取
  //（`scripts/lib/map-intel-event-comps.mjs`，页面按甲乙丙丁四个 tab 分好难度）。
  // 日站独有的那些编成**照旧没有号**，运行时按模糊命中降级显示——那是设计，不是缺口。
  for (const file of ['pin-map-intel-ids.mjs', 'pin-map-intel-observed.mjs']) {
    assert.equal(
      fs.existsSync(new URL(`../scripts/${file}`, import.meta.url)),
      false,
      `${file} 又回来了`,
    )
  }
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.ok(!pkg.scripts['lodes:map-intel-pin'])
  assert.ok(!pkg.scripts['lodes:map-intel-observe'])
  // 但解析与候选池那一层留着：运行时的模糊命中（di 的 abyssalPoolOf）与
  // map-intel 抓取器的 stripWikiMarkup 都还在用，删了它们才是真的掉功能。
  assert.equal(
    fs.existsSync(new URL('../scripts/lib/abyssal-id-pin.mjs', import.meta.url)),
    true,
    'abyssal-id-pin 还有两个在用的消费方，不能删',
  )
  assert.equal(
    fs.existsSync(new URL('../src/shared/abyssal-label.ts', import.meta.url)),
    true,
    'abyssal-label 是运行时模糊命中的判据，不能删',
  )
})
