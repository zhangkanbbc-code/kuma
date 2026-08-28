import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { parseBuildRecipes } from '../scripts/build-recipes.mjs'

// 按真实页面骨架缩微：节标题（h3）→ 配方表；建造時間一覧表带 rowspan 与 <br>。
// 这些正是真页上会咬人的三个点：rowspan 展开、<br> 连名、括号注记剥离。
const FIXTURE = `
<h3>駆逐艦</h3>
<table>
  <tr><th>燃料</th><th>弾薬</th><th>鋼材</th><th>ボーキ</th><th>備考</th></tr>
  <tr><td>30</td><td>30</td><td>30</td><td>30</td><td>最低値レシピ。主に駆逐・軽巡が出る。</td></tr>
  <tr><td>250</td><td>30</td><td>200</td><td>30</td><td>主に軽巡・重巡が出る。</td></tr>
</table>
<h3>戦艦</h3>
<table>
  <tr><th>燃料</th><th>弾薬</th><th>鋼材</th><th>ボーキ</th><th>備考</th></tr>
  <tr><td>400</td><td>30</td><td>600</td><td>30</td><td>基本的な戦艦レシピ。</td></tr>
</table>
<h3>建造時間</h3>
<h4>建造時間一覧表</h4>
<table>
  <tr><th>時間</th><th>艦種</th><th>出現艦娘</th><th>出現艦娘（大型艦建造のみ）</th></tr>
  <tr><td>00:18:00</td><td rowspan="2">駆逐艦</td><td>睦月・如月<br>弥生</td><td></td></tr>
  <tr><td>00:24:00</td><td>陽炎・Z3（秘書艦にZ1）</td><td></td></tr>
  <tr><td>08:00:00</td><td>戦艦</td><td></td><td>大和・武蔵</td></tr>
</table>
<h3>掲示板</h3>
<table>
  <tr><th>燃料</th><th>弾薬</th><th>鋼材</th><th>ボーキ</th><th>備考</th></tr>
  <tr><td>100</td><td>100</td><td>100</td><td>100</td><td>不在目标节里的表不许被读进来</td></tr>
</table>
`

test('recipes attach to their target section and stray tables are ignored', () => {
  const out = parseBuildRecipes(FIXTURE)
  assert.deepEqual(
    out.recipes.map((r) => [r.target, r.recipe.join('/')]),
    [
      ['駆逐艦', '30/30/30/30'],
      ['駆逐艦', '250/30/200/30'],
      ['戦艦', '400/30/600/30'],
    ],
  )
  assert.match(out.recipes[0].note, /最低値レシピ/)
  // 掲示板节下那张形状相同的表没有目标舰种，一条都不能进来
  assert.ok(!out.recipes.some((r) => r.recipe[0] === 100))
})

test('build times survive rowspan, <br>-joined names, and secretary annotations', () => {
  const out = parseBuildRecipes(FIXTURE)
  assert.equal(out.times.length, 3)
  // <br> 不能把 如月/弥生 黏成一个名字
  assert.deepEqual(out.times[0], {
    time: '00:18:00', stype: '駆逐艦', ships: ['睦月', '如月', '弥生'], largeOnly: [],
  })
  // rowspan：第二行的舰种承接上一行；括号注记从名字上剥掉
  assert.deepEqual(out.times[1], {
    time: '00:24:00', stype: '駆逐艦', ships: ['陽炎', 'Z3'], largeOnly: [],
  })
  // 大型限定列单独保留
  assert.deepEqual(out.times[2], {
    time: '08:00:00', stype: '戦艦', ships: [], largeOnly: ['大和', '武蔵'],
  })
})

test('the fetched pack keeps the shape the validator and the catalog expect', () => {
  // 对真实抓下来的包做形状抽查（包不在时跳过——test:lodes 会兜底）。
  // 断言选真页上已知稳定的锚点：30/30/30/30 在駆逐节、島風的 00:30:00、
  // 大和在大型限定名单。锚点消失说明页面结构变了，解析器要重看。
  let pack
  try {
    pack = JSON.parse(
      fs.readFileSync(new URL('../assets/lodes/build-recipes.json', import.meta.url), 'utf8'),
    )
  } catch (_e) {
    return
  }
  const { recipes, times } = pack.data
  assert.ok(recipes.some((r) => r.target === '駆逐艦' && r.recipe.join('/') === '30/30/30/30'))
  assert.ok(times.some((t) => t.time === '00:30:00' && t.ships.includes('島風')))
  assert.ok(times.some((t) => t.largeOnly.includes('大和')))
})
