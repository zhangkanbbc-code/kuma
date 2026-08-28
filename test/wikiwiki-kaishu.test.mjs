import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { KaishuParseError, parseKaishuHtml } from '../scripts/lib/wikiwiki-kaishu.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ---- fixture 主数据:只放测试用到的名字 ----
const MASTERS = {
  items: [
    { api_id: 1, api_name: '12cm単装砲' },
    { api_id: 44, api_name: '九四式爆雷投射機' },
    { api_id: 45, api_name: '三式爆雷投射機' },
    { api_id: 63, api_name: '12.7cm連装砲B型改二' },
    { api_id: 66, api_name: '8cm高角砲' },
    { api_id: 88, api_name: '22号対水上電探改四' },
    { api_id: 315, api_name: 'SG レーダー(初期型)' },
  ],
  ships: [
    { api_id: 1, api_name: '睦月', api_aftershipid: '254' },
    { api_id: 254, api_name: '睦月改', api_aftershipid: '434' },
    { api_id: 434, api_name: '睦月改二', api_aftershipid: '0' },
    { api_id: 2, api_name: '如月', api_aftershipid: '255' },
    { api_id: 255, api_name: '如月改', api_aftershipid: '435' },
    { api_id: 435, api_name: '如月改二', api_aftershipid: '0' },
    { api_id: 596, api_name: 'Fletcher', api_aftershipid: '692' },
    { api_id: 692, api_name: 'Fletcher改', api_aftershipid: '628' },
    { api_id: 628, api_name: 'Fletcher改 Mod.2', api_aftershipid: '629' },
    { api_id: 629, api_name: 'Fletcher Mk.II', api_aftershipid: '0' },
    { api_id: 124, api_name: '熊野', api_aftershipid: '125' },
    { api_id: 125, api_name: '熊野改', api_aftershipid: '0' },
    { api_id: 943, api_name: '熊野丸', api_aftershipid: '983' },
    { api_id: 983, api_name: '熊野丸改', api_aftershipid: '0' },
  ],
  useitems: [{ api_id: 104, api_name: '工廠資源' }],
}

const HEADER = `
<tr><th rowspan="2">改修する装備</th><th colspan="6">必要資材(通常/確実)</th><th colspan="7">曜日</th><th rowspan="2">二番艦</th><th rowspan="2">更新先の装備</th></tr>
<tr><th>改修値</th><th>資源</th><th>開発<br class="spacer">資材</th><th>改修<br class="spacer">資材</th><th colspan="2">消費装備/アイテム</th><th>日</th><th>月</th><th>火</th><th>水</th><th>木</th><th>金</th><th>土</th></tr>`

const day7 = (marks) => marks.split('').map((m) => `<td>${m === '1' ? '◯' : '×'}</td>`).join('')

const FIXTURE = `
<h3>小口径主砲 <a href="#">†</a></h3>
<table>${HEADER}
<tr><td rowspan="3">12cm単装砲</td><td>初期</td><td rowspan="3">燃:10<br class="spacer">弾:20<br class="spacer">鋼:40<br class="spacer">ボ:0</td><td>2/2</td><td><del>2/2</del>1/2</td><td>同装備x1</td><td></td>${day7('1111111')}<td rowspan="3">睦月<br class="spacer">如月</td><td rowspan="3">⇒<a href="/kancolle/x" title="12.7cm連装砲B型改二">12.7cm連装砲B型改二</a></td></tr>
<tr><td>★6</td><td>2/3</td><td>1/2</td><td>同装備x2</td><td></td>${day7('1111111')}</tr>
<tr><td>★max</td><td>2/4</td><td>2/6</td><td><a href="/kancolle/y" title="22号対水上電探改四">22号対水上電探改四</a>x1</td><td></td>${day7('1111111')}</tr>
<tr><td rowspan="2">8cm高角砲</td><td>初期</td><td rowspan="2">燃:0<br class="spacer">弾:0<br class="spacer">鋼:30<br class="spacer">ボ:30</td><td>3/4</td><td>2/3</td><td>同装備x1</td><td></td>${day7('0110000')}<td rowspan="2">熊野</td><td rowspan="2">更新不可</td></tr>
<tr><td>★6</td><td>4/6</td><td>3/5</td><td>同装備x2</td><td></td>${day7('0110000')}</tr>
</table>
<h3>爆雷投射機</h3>
<table>${HEADER}
<tr><td rowspan="3">九四式爆雷投射機</td><td>初期</td><td rowspan="3">燃:10<br class="spacer">弾:60<br class="spacer">鋼:20<br class="spacer">ボ:20</td><td>1/2</td><td>1/2</td><td>-</td><td></td>${day7('0001100')}<td rowspan="3">―</td><td rowspan="3">⇒<a href="/kancolle/z" title="三式爆雷投射機">三式爆雷投射機</a>★+3</td></tr>
<tr><td>★6</td><td>2/3</td><td>1/3</td><td>同装備x1</td><td></td>${day7('0001100')}</tr>
<tr><td>★max</td><td>3/6</td><td>3/8</td><td><a href="/kancolle/y" title="22号対水上電探改四">22号対水上電探改四</a>x1<br class="spacer"><span class="wikicolor" style="color:Green">工廠資源</span>×13</td><td></td>${day7('0001100')}</tr>
</table>
<h3>電探</h3>
<table>${HEADER}
<tr><td>SG レーダー(初期型)</td><td>初期</td><td>燃:20<br class="spacer">弾:0<br class="spacer">鋼:60<br class="spacer">ボ:70</td><td>5/7</td><td>4/6</td><td>同装備x1</td><td></td>${day7('0011000')}<td>Fletcher<br class="spacer"><span class="wikicolor" style="color:Red">改 Mod.2</span></td><td>更新不可</td></tr>
</table>
<div>Last-modified: 2026-08-02 (日) 03:42:19</div>`

const parseFixture = () => parseKaishuHtml(FIXTURE, MASTERS, { minRows: 1 })

test('改修表:rowspan 展开 + 多行表头定位 + del 剥离', () => {
  const { rows } = parseFixture()
  const gun = rows.find((r) => r.eq_id === 1)
  assert.ok(gun, '12cm単装砲 应在名单里')
  assert.equal(gun.improvement.length, 1)
  const imp = gun.improvement[0]
  assert.deepEqual(imp.convert, { id_after: 63, lvl_after: 0 })
  // del 里的旧值(2/2)必须被剥掉,p1 改修資材是 1/2
  assert.equal(imp.costs.p1.screws, 1)
  assert.equal(imp.costs.p1.screws_sli, 2)
  assert.equal(imp.costs.fuel, 10)
  assert.equal(imp.costs.baux, 0)
  // ★max 段挂到 conv,消耗装备按名字对齐
  assert.deepEqual(imp.costs.conv.equips, [{ id: 88, eq_count: 1 }])
})

test('改修表:二番舰写基础形态名 = 前缀展开整个改造家族', () => {
  const { rows } = parseFixture()
  const imp = rows.find((r) => r.eq_id === 1).improvement[0]
  assert.equal(imp.helpers.length, 1)
  assert.deepEqual(imp.helpers[0].ship_ids, [1, 2, 254, 255, 434, 435])
  assert.deepEqual(imp.helpers[0].days, [0, 1, 2, 3, 4, 5, 6])
})

test('改修表:前缀展开尊重家族边界——熊野不吞熊野丸', () => {
  const { rows } = parseFixture()
  const imp = rows.find((r) => r.eq_id === 66).improvement[0]
  assert.deepEqual(imp.helpers[0].ship_ids, [124, 125])
  assert.equal(imp.convert, null)
})

test('改修表:二番舰不要行写成 ship_ids [-1],★+N 落进 lvl_after', () => {
  const { rows } = parseFixture()
  const imp = rows.find((r) => r.eq_id === 44).improvement[0]
  assert.deepEqual(imp.helpers[0].ship_ids, [-1])
  assert.deepEqual(imp.helpers[0].days, [3, 4])
  assert.deepEqual(imp.convert, { id_after: 45, lvl_after: 3 })
  // 消耗列同格混排 装备 与 道具,按主数据分流
  assert.deepEqual(imp.costs.conv.equips, [{ id: 88, eq_count: 1 }])
  assert.deepEqual(imp.costs.conv.consumable, [{ id: 104, eq_count: 13 }])
})

test('改修表:窄列折行的舰名(Fletcher/改 Mod.2)拼回一个形态,不拆成两艘', () => {
  const { rows } = parseFixture()
  const imp = rows.find((r) => r.eq_id === 315).improvement[0]
  assert.deepEqual(imp.helpers[0].ship_ids, [628])
})

test('改修表:页脚 Last-modified 变成上游更新时间(JST)', () => {
  const { upstreamUpdatedAt } = parseFixture()
  assert.equal(upstreamUpdatedAt, '2026-08-02T03:42:19+09:00')
})

test('改修表:对不上主数据的名字抛错,不静默丢', () => {
  const bad = FIXTURE.replace('>睦月<br class="spacer">如月<', '>存在しない艦<')
  assert.throws(() => parseKaishuHtml(bad, MASTERS, { minRows: 1 }), KaishuParseError)
})

test('改修表:行数低于熔断线时整包报废,不拿残缺结果顶替', () => {
  assert.throws(() => parseKaishuHtml(FIXTURE, MASTERS, { minRows: 500 }), /页面结构/)
})

// ---- 真包锚定(缺包时优雅跳过;test:lodes 有大声兜底) ----
const packFile = path.join(root, 'assets', 'lodes', 'equip-upgrades.json')
test('equip-upgrades 真包:换源后的锚定事实', { skip: !existsSync(packFile) }, () => {
  const pack = JSON.parse(readFileSync(packFile, 'utf8'))
  assert.match(`${pack.meta.source}`, /wikiwiki/, '改修域单基准已换成 wikiwiki 改修表')
  assert.ok(pack.data.length >= 370, `改修名单至少 370 件,实际 ${pack.data.length}`)
  const by = new Map(pack.data.map((r) => [r.eq_id, r]))
  // EO 缺失、wikiwiki 现行的 2026 更新链:試製 23号電探改三 → SCレーダー改(後期調整型)
  assert.ok(by.get(573)?.improvement.some((i) => i.convert?.id_after === 574))
  // 二番舰不要:12.7cm連装砲 全周可改,-1 表示不限二号舰
  const t2 = by.get(2).improvement.flatMap((i) => i.helpers)
  assert.ok(t2.some((h) => h.ship_ids.includes(-1) && h.days.length === 7))
  // 三方仲裁钉死:プリエーゼ式水中防御隔壁 基础铝 30(EO 誊错为 300,WCTF 站 wikiwiki)
  assert.equal(by.get(136).improvement[0].costs.baux, 30)
  // ★+3:九四式爆雷投射機 → 三式爆雷投射機 ★3 起步
  assert.equal(by.get(44).improvement[0].convert.lvl_after, 3)
  // 全包形状:days 都在 0..6,ship_ids 是整数(含 -1 哨兵)
  for (const row of pack.data) {
    for (const imp of row.improvement) {
      for (const helper of imp.helpers ?? []) {
        assert.ok(helper.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6))
        assert.ok(helper.ship_ids.every((s) => Number.isInteger(s) && (s > 0 || s === -1)))
      }
    }
  }
})
