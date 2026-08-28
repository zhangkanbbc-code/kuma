import assert from 'node:assert/strict'
import test from 'node:test'

import { parseItemExchangePage } from '../scripts/lib/wikiwiki-item-exchange.mjs'

const USEITEMS = [
  { api_id: 68, api_name: '秋刀魚' },
  { api_id: 62, api_name: '菱餅' },
  { api_id: 90, api_name: '節分の豆' },
]

const PAGE = `
<h2>通常アイテム</h2>
<table>
  <tr><th>位置</th><th>アイテム</th><th>アイテム</th><th>アイテム</th></tr>
  <tr><th>1段目</th><th>アイテム名</th><th>画像</th><th>詳細</th></tr>
  <tr><td>1</td><td>秋刀魚</td><td></td><td>期間限定イベントで収集するアイテム。各種アイテムと交換できる。</td></tr>
  <tr><td>2</td><td>期間限定アイテム</td><td></td><td>※占位行，名字对不上主数据</td></tr>
</table>
<h2>アイテム説明</h2>
<h3>秋刀魚<a href="#edit">?</a></h3>
<h4>秋刀魚とのアイテム交換</h4>
<table>
  <tr><th>年次</th><th>交換品</th><th>秋刀魚必要数</th><th>内容</th><th>備考</th></tr>
  <tr><td rowspan="2">2015</td><td>刺身</td><td>3尾</td><td>弾薬x300 + 鋼材x150</td><td></td></tr>
  <tr><td>蒲焼</td><td>7尾</td><td>秋刀魚の缶詰x1 + 高速修復材x3</td><td></td></tr>
  <tr><td>2025</td><td>秋刀魚カレー改三甲</td><td>41尾</td><td>四式重爆 飛龍＋イ号一型甲 誘導弾★+4</td><td>「最大1回」調理可能</td></tr>
</table>
<h3>菱餅</h3>
<h4>用途</h4>
<div><a class="note_super" href="#x">*1</a>[編集]</div>
<p>期間限定任務の達成に使用する。</p>
<ul><li>任務 (単発)<ul><li>「菱餅」を集めよう！ (3)</li></ul></li></ul>
<table><tr><td>这张表不该进用途行</td></tr></table>
<h4>菱餅と交換可能なアイテム</h4>
<table>
  <tr><th>交換品</th><th>中身</th></tr>
  <tr><td>資源</td><td>燃料×600,ボーキサイト×200</td></tr>
  <tr><td>甘味</td><td>伊良湖×1</td></tr>
</table>
<h3>節分の豆</h3>
<table>
  <tr><th>画像</th><th>年次</th><th>開始日</th><th>終了日</th><th>消滅日</th><th>詳細</th></tr>
  <tr><td></td><td>2019</td><td>01/22</td><td>02/08</td><td>02/27</td><td>「明石豆」節分の豆 x2→(改修資材 x1)</td></tr>
  <tr><td></td><td>2026年</td><td>01/28</td><td>02/28</td><td>02/28</td><td>最大獲得数53個 「恵方震電」節分の豆x34→(試製 震電★2,1回のみ)</td></tr>
</table>
<h3>ここにない道具</h3>
<table>
  <tr><th>年次</th><th>交換品</th><th>必要数</th><th>内容</th></tr>
  <tr><td>2020</td><td>x</td><td>1</td><td>y</td></tr>
</table>
<h2>コメント</h2>
`

test('道具兑换解析:年次表摊平 rowspan、菱饼式两列固定表、活动史表按年收原文', () => {
  const { entries, warnings } = parseItemExchangePage(PAGE, USEITEMS)
  assert.deepEqual(Object.keys(entries).map(Number).sort((a, b) => a - b), [62, 68, 90])

  const sanma = entries[68]
  assert.equal(sanma.name, '秋刀魚')
  assert.equal(sanma.yearly.length, 3)
  // rowspan 的年份摊到第二行
  assert.deepEqual(sanma.yearly[1], {
    year: '2015',
    offer: '蒲焼',
    cost: '7尾',
    gets: '秋刀魚の缶詰x1 + 高速修復材x3',
    note: '',
  })
  assert.equal(sanma.yearly[2].year, '2025')
  assert.equal(sanma.yearly[2].note, '「最大1回」調理可能')
  assert.equal(sanma.fixed, undefined)

  const hishi = entries[62]
  assert.equal(hishi.yearly, undefined)
  assert.deepEqual(hishi.fixed, [
    { offer: '資源', gets: '燃料×600,ボーキサイト×200' },
    { offer: '甘味', gets: '伊良湖×1' },
  ])
  // 用途块:p/li 逐行收,嵌套列表不重复,内嵌表格整块剔除,[編集]/脚注角标不进行
  assert.deepEqual(hishi.usage, [
    '期間限定任務の達成に使用する。',
    '任務 (単発)',
    '「菱餅」を集めよう！ (3)',
  ])
  // 总表詳細 → overview(具体作用一句话);占位行名字对不上主数据,天然跳过
  assert.equal(entries[68].overview, '期間限定イベントで収集するアイテム。各種アイテムと交換できる。')
  assert.equal(hishi.overview, undefined)

  // 活动史表（節分の豆式）：詳細格式五花八门不硬拆,按年份+原文速览收录;
  // 「2026年」的年缀去掉,与秋刀魚年次表口径一致
  assert.deepEqual(entries[90].history, [
    { year: '2019', detail: '「明石豆」節分の豆 x2→(改修資材 x1)' },
    { year: '2026', detail: '最大獲得数53個 「恵方震電」節分の豆x34→(試製 震電★2,1回のみ)' },
  ])
  assert.equal(entries[90].yearly, undefined)
  assert.deepEqual(warnings, [])
})

test('道具兑换解析:小节标题必须与主数据名精确相等,不做模糊匹配', () => {
  const { entries } = parseItemExchangePage(
    `<h3>秋刀魚(2015)</h3><table><tr><th>年次</th><th>交換品</th><th>必要数</th><th>内容</th></tr>
     <tr><td>2015</td><td>刺身</td><td>3尾</td><td>弾薬x300</td></tr></table>`,
    USEITEMS,
  )
  assert.deepEqual(entries, {})
})
