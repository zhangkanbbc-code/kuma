import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  FORMATION_UNKNOWN,
  KCWIKI_MAP_CODES,
  KCWIKI_NODE_COLORS,
  parseFormationCell,
  parseKcwikiMapDrops,
  parseKcwikiMapEnemies,
  parseKcwikiMapPage,
} from '../scripts/lib/kcwiki-map.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixture = readFileSync(path.join(here, 'fixtures', 'kcwiki-map-1-1.html'), 'utf8')

// ---- 真页夹具：1-1 的「深海配置」+「舰娘掉落表」原样切下来 ----

test('1-1 真页解析出且只出 A/B/C 三点，Boss 点是红色不是蓝色', () => {
  const { nodes, warnings } = parseKcwikiMapEnemies(fixture)
  // 这条钉的是本域最容易写错的一处：第一版只匹配 `#3baef5`（普通战蓝）时，
  // 1-1 的 C 点整个消失、它的三条编成被并进 B 点——**少一个点却一条报错都没有**。
  assert.deepEqual(Object.keys(nodes).sort(), ['A', 'B', 'C'])
  assert.equal(nodes.C.color, 'ff0000')
  assert.equal(KCWIKI_NODE_COLORS[nodes.C.color], 'Boss')
  assert.equal(nodes.A.color, '3baef5')
  assert.deepEqual(warnings, [])
})

test('1-1 三点各三条编成，mstId 与基础经验逐条对上', () => {
  const { nodes } = parseKcwikiMapEnemies(fixture)
  assert.deepEqual(
    nodes.A.enemyComps.map((comp) => [comp.ships, comp.exp]),
    [
      [[1501], 10],
      [[1502], 15],
      [[1503], 20],
    ],
  )
  assert.deepEqual(
    nodes.B.enemyComps.map((comp) => [comp.ships, comp.exp]),
    [
      [[1501, 1501], 20],
      [[1502, 1502], 30],
      [[1503, 1503], 40],
    ],
  )
  assert.deepEqual(
    nodes.C.enemyComps.map((comp) => [comp.ships, comp.exp]),
    [
      [[1505, 1501, 1501], 50],
      [[1505, 1502, 1502], 60],
      [[1505, 1503, 1502, 1502], 70],
    ],
  )
  for (const node of Object.values(nodes)) {
    for (const comp of node.enemyComps) assert.equal(comp.formation, 1)
  }
})

test('标注名与 mstId 等长并存：号是一手，wiki 标注是主数据没有的那部分信息', () => {
  const { nodes } = parseKcwikiMapEnemies(fixture)
  const comp = nodes.C.enemyComps[2]
  assert.deepEqual(comp.ships, [1505, 1503, 1502, 1502])
  assert.deepEqual(comp.labels, ['軽巡ホ級', '駆逐ハ級', '駆逐ロ級', '駆逐ロ級'])
  assert.equal(comp.labels.length, comp.ships.length)
})

test('enemy_mobile 格里混着的 <style> 不会漏进舰名', () => {
  // 格内确实带 `.mw-parser-output div.hfBox{…}` 这段 CSS，裸 strip 会把它当文字。
  assert.match(fixture, /<style>\.mw-parser-output div\.hfBox/)
  const { nodes } = parseKcwikiMapEnemies(fixture)
  for (const node of Object.values(nodes)) {
    for (const comp of node.enemyComps) {
      for (const label of comp.labels) assert.doesNotMatch(label, /mw-parser-output|display:|\{|\}/)
    }
  }
})

test('1-1 掉落表：三点齐、稀有掉落带红标、点位取自表格而不是编成表', () => {
  const { nodes, hasTable, warnings } = parseKcwikiMapDrops(fixture)
  assert.equal(hasTable, true)
  assert.deepEqual(warnings, [])
  assert.deepEqual(Object.keys(nodes).sort(), ['A', 'B', 'C'])
  assert.equal(nodes.A.length, 36)
  assert.equal(nodes.B.length, 39)
  assert.equal(nodes.C.length, 60)
  // 红色粗体 = 稀有掉落（1-1 的 C 点九条：薄云/亲潮/…/鹿岛/瑞穗）。
  // 它不是限定期标记——限定窗口 kcwiki 根本没有，两者混了就会在界面上编出时限。
  assert.deepEqual(
    nodes.C.filter((ship) => ship.rare).map((ship) => ship.name),
    ['薄云', '亲潮', '秋云', '风云', '藤波', '早波', '滨波', '鹿岛', '瑞穗'],
  )
  assert.equal(nodes.C.find((ship) => ship.name === '睦月')?.rare, false)
  assert.equal(nodes.A.every((ship) => !ship.rare), true)
})

test('parseKcwikiMapPage 把编成与掉落并到同一份节点表', () => {
  const page = parseKcwikiMapPage(fixture)
  assert.equal(page.hasDropTable, true)
  assert.deepEqual(Object.keys(page.nodes).sort(), ['A', 'B', 'C'])
  assert.equal(page.nodes.C.nodeColor, 'ff0000')
  assert.equal(page.nodes.C.enemyComps.length, 3)
  assert.equal(page.nodes.C.drops.length, 60)
})

// ---- 阵形：一格常写多个，而且连写不带分隔 ----

test('一格多阵形拆成阵形数组，不整串当一个 formation', () => {
  // kcwiki 实测写法：`単縦陣梯形陣`（连写）、`単縦陣 複縦陣 輪形陣`（空格）、
  // `梯形陣複縦陣単縦陣`（三个连写）。整串当一个名字＝两个阵形都丢了。
  assert.deepEqual(parseFormationCell('単縦陣梯形陣'), { formation: '単縦 梯形', unknownText: '' })
  assert.deepEqual(parseFormationCell('梯形陣複縦陣単縦陣'), {
    formation: '梯形 複縦 単縦',
    unknownText: '',
  })
  assert.deepEqual(parseFormationCell('単縦陣 複縦陣 輪形陣'), {
    formation: '単縦 複縦 輪形',
    unknownText: '',
  })
})

test('单阵形出数字，简体写法与假名写法归一到同一个号', () => {
  assert.equal(parseFormationCell('単縦陣').formation, 1)
  assert.equal(parseFormationCell('複縦陣').formation, 2)
  assert.equal(parseFormationCell('輪形陣').formation, 3)
  assert.equal(parseFormationCell('梯形阵').formation, 4)
  assert.equal(parseFormationCell('单横阵').formation, 5)
  assert.equal(parseFormationCell('轮型').formation, 3)
  assert.equal(parseFormationCell('轮型阵').formation, 3)
})

test('敌联合的「第三警戒航行序列」不能被读成警戒阵', () => {
  // 6-5 的 Boss 是 12 舰的敌联合舰队（第三警戒航行序列），长名必须先于「警戒陣」命中。
  assert.equal(parseFormationCell('第三警戒航行序列').formation, 13)
  assert.equal(parseFormationCell('第四警戒航行序列').formation, 14)
  assert.equal(parseFormationCell('警戒陣単縦陣').formation, '警戒 単縦')
})

test('阵形格里的正文注解不当阵形，但也不静默吞掉', () => {
  const parsed = parseFormationCell('単縦陣 提督等级107级以前（包含107级）')
  assert.equal(parsed.formation, 1)
  assert.equal(parsed.unknownText, '提督等级107级以前（包含107级）')
})

test('资料没写阵形时如实标「不明」，不猜一个单纵', () => {
  const parsed = parseFormationCell('{{{阵型}}}')
  assert.equal(parsed.formation, FORMATION_UNKNOWN)
  assert.equal(parsed.unknownText, '{{{阵型}}}')
})

// ---- 合成夹具：制空值、挂牌、点位括注 ----

const compTable = (formation, hfBoxes, tail = '') => `
<tr><td style="width: 100px; background-color: #3baef5; color: #ffffff;">
<p><b>N</b></p></td><td><p><span lang="ja">敵艦隊</span></p></td></tr>
<tr><td colspan="2"><table>
<tr><td class="formation_mobile">${formation}</td><td class="enemy_mobile">${hfBoxes}</td></tr>
<tr><td></td><td colspan="2">${tail}</td></tr>
</table></td></tr>`

const hfBox = (id, label) =>
  `<div class="hfBox"><a href="/wiki/x" title="x"><img alt="x" /></a><span class="hfText">(${id})<span lang="ja">${label}</span></span></div>`

test('制空/空优/空确取自编成子表的下一行，不是 enemy_mobile 那一格', () => {
  const html = compTable(
    '輪形陣',
    `${hfBox(1766, '軽母ヌ級改 flagship 艦載機鳥赤')}${hfBox(1576, '駆逐ロ級後期型')}`,
    '<span class="greenCell">&#160;制空值：238&#160;</span>' +
      '<span class="lightBlueCell">&#160;空优值：357&#160;</span>' +
      '<span class="blueCell">&#160;空确值：714&#160;</span>',
  )
  const { nodes } = parseKcwikiMapEnemies(html)
  const comp = nodes.N.enemyComps[0]
  assert.equal(comp.air, 238)
  assert.equal(comp.airSuperiority, 357)
  assert.equal(comp.airSupremacy, 714)
  // 「艦載機鳥赤」这类形态注解是主数据没有的信息，换源后必须还在
  assert.deepEqual(comp.labels, ['軽母ヌ級改 flagship 艦載機鳥赤', '駆逐ロ級後期型'])
})

test('空模板占位的编成挂牌，不静默当成「这一点没有敌人」', () => {
  const html = compTable('{{{阵型}}}', '{{{敌方}}}')
  const { nodes, warnings } = parseKcwikiMapEnemies(html)
  assert.deepEqual(Object.keys(nodes), [])
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /节点 N .*一个 mstId 都没有.*模板占位没展开/)
})

test('没见过的点色要挂牌——点少了却不报错是本域最坏的失败方式', () => {
  const html = compTable('単縦陣', hfBox(1501, '駆逐イ級')).replace('#3baef5', '#123456')
  const { nodes, warnings } = parseKcwikiMapEnemies(html)
  assert.equal(nodes.N.enemyComps.length, 1, '仍然收下这一点，挂牌不等于丢数据')
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /#123456/)
})

test('掉落表点位带阶段括注（7-5 的 K(P1BOSS)）仍归到裸字母，小写照样认', () => {
  const html = `<table><tr><th>海域点</th><th>掉落列表</th></tr>
    <tr><td>K(P1BOSS)</td><td><a title="明石">明石</a></td></tr>
    <tr><td>p</td><td><a title="伊168">伊168</a></td></tr>
    <tr><td>合计</td><td><a title="睦月">睦月</a></td></tr></table>`
  const { nodes, warnings } = parseKcwikiMapDrops(html)
  assert.deepEqual(Object.keys(nodes).sort(), ['K', 'P'])
  assert.deepEqual(nodes.K.map((ship) => ship.name), ['明石'])
  assert.deepEqual(nodes.P.map((ship) => ship.name), ['伊168'])
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /合计/)
})

test('没有掉落表的页面如实说「没有」，不返回空表当成「没掉落」', () => {
  const { nodes, hasTable, warnings } = parseKcwikiMapDrops('<p>攻略正文</p>')
  assert.deepEqual(nodes, {})
  assert.equal(hasTable, false)
  assert.deepEqual(warnings, ['页面里没有「掉落列表」表'])
})

test('常规图代号表是 37 张，7 个海域', () => {
  assert.equal(KCWIKI_MAP_CODES.length, 37)
  assert.equal(KCWIKI_MAP_CODES[0], '1-1')
  assert.equal(KCWIKI_MAP_CODES.at(-1), '7-5')
})
