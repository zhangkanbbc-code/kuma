import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import lineup from '../dist/shared/lineup-record.js'
import { renderLineup, renderLineupCard } from './fixtures/render-qn-lineup.mjs'

const {
  captureLineup,
  LINEUP_GENERAL_KEY,
  LINEUP_UI_KEY,
  lineupApplies,
  lineupMapKey,
  readLineups,
} = lineup

const playerShip = (shipId, lv, slot = [], slotEx = 0) => ({ shipId, lv, slot, slotEx })
const item = (mstId, level = 0, alv = 0) => ({ mstId, level, alv, locked: false })

test('captureLineup 按舰队位次抓舰与装备，跳过空位、失效实例并区分增设三态', () => {
  const captured = captureLineup(
    { id: 2, ships: [-1, 10, 999, 11, 12] },
    {
      10: playerShip(100, 80, [201, -1, 999, 202], 0),
      11: playerShip(101, 35, [], -1),
      12: playerShip(102, 99, [203], 204),
    },
    {
      201: item(501, 9, 7),
      202: item(502, 10, 0),
      203: item(503),
      204: item(504, 4, 3),
    },
    123456,
    '季常配置',
  )
  assert.deepEqual(captured, {
    deckId: 2,
    recordedAt: 123456,
    ships: [
      {
        rosterId: 10,
        mstId: 100,
        lv: 80,
        slots: [
          { mstId: 501, level: 9, alv: 7 },
          { mstId: 502, level: 10, alv: 0 },
        ],
        ex: null,
      },
      { rosterId: 11, mstId: 101, lv: 35, slots: [], ex: null },
      {
        rosterId: 12,
        mstId: 102,
        lv: 99,
        slots: [{ mstId: 503, level: 0, alv: 0 }],
        ex: { mstId: 504, level: 4, alv: 3 },
      },
    ],
    note: '季常配置',
  })
})

test('captureLineup 一艘有效舰也没有时返回 null，再次记录可把原备注传入保留', () => {
  assert.equal(captureLineup({ id: 1, ships: [-1, 77] }, {}, {}, 1), null)
  const ships = { 10: playerShip(100, 20) }
  const first = captureLineup({ id: 1, ships: [10] }, ships, {}, 2, '保留这句')
  const overwritten = captureLineup({ id: 3, ships: [10] }, ships, {}, 3, first.note)
  assert.equal(overwritten.deckId, 3)
  assert.equal(overwritten.recordedAt, 3)
  assert.equal(overwritten.note, '保留这句')
})

test('lineupApplies 只接受真实周期标签，单发与空标签不显示', () => {
  for (const label of ['日', '周', '月', '季', '年']) assert.equal(lineupApplies(label), true, label)
  for (const label of ['单', '', '季度', '?']) assert.equal(lineupApplies(label), false, label)
})

test('readLineups 把旧形态迁到通用页，并逐海图键校验新形态', () => {
  const valid = {
    deckId: 1,
    recordedAt: 100,
    ships: [{
      rosterId: 10,
      mstId: 100,
      lv: 50,
      slots: [{ mstId: 501, level: 9, alv: 7 }],
      ex: null,
      ignored: true,
    }],
    note: '备注',
    ignored: true,
  }
  assert.deepEqual(readLineups({
    77: valid,
    78: {
      22: valid,
      23: { ...valid, ships: [] },
      bad: valid,
      '-1': valid,
      '1.5': valid,
    },
    79: { 22: { ...valid, ships: [] }, nope: null },
    80: null,
    81: { deckId: 0, ships: [], 22: valid },
  }), {
    77: { 0: {
        deckId: 1,
        recordedAt: 100,
        ships: [{
          rosterId: 10,
          mstId: 100,
          lv: 50,
          slots: [{ mstId: 501, level: 9, alv: 7 }],
          ex: null,
        }],
        note: '备注',
      } },
    78: { 22: {
        deckId: 1,
        recordedAt: 100,
        ships: [{
          rosterId: 10,
          mstId: 100,
          lv: 50,
          slots: [{ mstId: 501, level: 9, alv: 7 }],
          ex: null,
        }],
        note: '备注',
      } },
  })
  for (const raw of [null, [], 'bad', 3]) assert.deepEqual(readLineups(raw), {})
  assert.equal(LINEUP_GENERAL_KEY, '0')
  assert.equal(lineupMapKey(22), '22')
  assert.equal(LINEUP_UI_KEY, 'qn.lineup')
})

const mg = {
  decks: [
    { id: 1, ships: [101, 102] },
    { id: 2, ships: [102] },
    { id: 3, ships: [-1] },
    { id: 5, ships: [101] },
  ],
  ships: {
    101: playerShip(1, 99, [201, 202], 203),
    102: playerShip(2, 45),
    103: playerShip(3, 30, [204]),
  },
  slotitems: {
    201: item(11, 9, 0),
    202: item(12, 10, 7),
    203: item(13),
    204: item(14),
  },
  master: {
    ships: {
      1: { name: '测试舰甲' },
      2: { name: '测试舰乙' },
      3: { name: '测试舰丙' },
    },
    slotitems: {
      11: { name: '测试主炮' },
      12: { name: '测试舰战' },
      13: { name: '测试增设装备' },
      14: { name: '替换装备' },
    },
  },
}
const row = { id: 77, name: '季度测试任务', periodLabel: '季' }
const record = {
  deckId: 1,
  recordedAt: 100,
  ships: [
    {
      rosterId: 101,
      mstId: 1,
      lv: 99,
      slots: [
        { mstId: 11, level: 9, alv: 0 },
        { mstId: 12, level: 10, alv: 7 },
      ],
      ex: { mstId: 13, level: 0, alv: 0 },
    },
    { rosterId: 102, mstId: 2, lv: 45, slots: [], ex: null },
  ],
  note: '<照此配置>\n第二行',
}

test('lineupSectionHtml 多海图按序显示页签、默认首条记录并汇总已记图数', () => {
  const html = renderLineup({
    mg,
    maps: { 77: [22, 23] },
    fleetCheck: { 77: { decks: [2] } },
    lineups: { 77: { 23: record } },
  }, row)
  assert.match(html, /<summary>阵容记录 · 已记 1\/2 图<button[^>]+>弹出对照<\/button><\/summary>/)
  assert.ok(html.indexOf('data-lineup-map="22"') < html.indexOf('data-lineup-map="23"'))
  assert.match(html, /class="on has" data-lineup-map="23">2-3<\/button>/)
  assert.match(html, /class="" data-lineup-map="22">2-2<\/button>/)
  assert.match(html, /data-lineup-record="1">第 1 舰队<\/button>/)
  assert.match(html, /class="hit" title="满足编成条件" data-lineup-record="2">第 2 舰队<\/button>/)
  assert.doesNotMatch(html, /data-lineup-record="3"|data-lineup-record="5"/)
  assert.doesNotMatch(html, /class="q-section q-lineup"[^>]+ open/)
  assert.equal((html.match(/class="hit"/g) ?? []).length, 1)
})

test('lineupSectionHtml 摘要覆盖暂无、无海图已记一条，折叠开合跟随会话状态', () => {
  const empty = renderLineup({ mg, maps: { 77: [22, 23] } }, row)
  assert.match(empty, /<summary>阵容记录 · 暂无记录/)
  const general = renderLineup({ mg, lineups: { 77: { 0: record } }, lineupOpen: true }, row)
  assert.match(general, /class="q-section q-lineup"[^>]+ open/)
  assert.match(general, /<summary>阵容记录 · 已记 1 条/)
  assert.doesNotMatch(general, /class="lineup-tabs"/)
  assert.match(general, /data-lineup-record="1"/)
})

test('lineupSectionHtml 旧通用记录只在有海图时追加通用页且不提供记录按钮', () => {
  const withLegacy = renderLineup({
    mg,
    maps: { 77: [22, 23] },
    lineupMap: { 77: '0' },
    lineups: { 77: { 0: record } },
  }, row)
  assert.ok(withLegacy.indexOf('>2-3<') < withLegacy.indexOf('>通用<'))
  assert.match(withLegacy, /class="on has" data-lineup-map="0">通用<\/button>/)
  assert.doesNotMatch(withLegacy, /data-lineup-record=/)
  assert.match(withLegacy, /data-lineup-delete>删除<\/button>/)

  const deleted = renderLineup({ mg, maps: { 77: [22, 23] } }, row)
  assert.doesNotMatch(deleted, />通用<\/button>/)
})

test('lineupSectionHtml 当前页记录完整渲染装备、增设和可编辑备注', () => {
  const html = renderLineup({
    mg,
    maps: { 77: [22] },
    lineups: { 77: { 22: record } },
  }, row)
  for (const text of [
    '记于 2026-09-18 14:20 · 第 1 舰队',
    '测试舰甲',
    'Lv 99',
    '测试主炮 ★9',
    '测试舰战 ★MAX',
    '熟练7',
    '<em>增设</em><span class="slot">测试增设装备</span>',
    '无装备',
    '&lt;照此配置&gt;\n第二行',
  ]) assert.ok(html.includes(text), text)
  assert.match(html, /id="qn-lineup-note" maxlength="400" placeholder="输入备注……"/)
  assert.match(html, /data-lineup-delete>删除<\/button>/)
})

test('lineupCardBodyHtml 高亮换舰、装备与增设差异，全同时写一致且备注只读', () => {
  const common = {
    maps: { 77: [22, 23] },
    rows: [row],
    lineups: { 77: { 22: record } },
  }
  const same = renderLineupCard({ ...common, mg }, 77, '22')
  assert.match(same, /class="on has" data-lineup-card-map="22">2-2<\/button>/)
  assert.match(same, /class="lineup-diff-note">与现在的第 1 舰队一致<\/div>/)
  assert.doesNotMatch(same, /class="(?:who|slot) diff"|textarea/)
  assert.doesNotMatch(same, /class="lineup-ship diff"|class="lineup-diff-note diff"/)
  assert.match(same, /<div class="lineup-note">&lt;照此配置&gt;\n第二行<\/div>/)

  const changedShip = renderLineupCard({
    ...common,
    mg: { ...mg, decks: [{ id: 1, ships: [103, 102] }] },
  }, 77, '22')
  assert.match(changedShip, /<div class="lineup-ship diff">[\s\S]*?<span class="who diff"><span class="entity-term e-ship">测试舰甲<\/span>/)
  assert.match(changedShip, /class="lineup-diff-note diff">高亮 · 与现在的第 1 舰队不同<\/div>/)
  assert.doesNotMatch(changedShip, /class="slot diff"/)

  const changedEquip = renderLineupCard({
    ...common,
    mg: { ...mg, slotitems: { ...mg.slotitems, 201: item(14, 9, 0) } },
  }, 77, '22')
  assert.equal((changedEquip.match(/class="slot diff"/g) ?? []).length, 1)
  assert.doesNotMatch(changedEquip, /class="who diff"/)

  const changedEx = renderLineupCard({
    ...common,
    mg: { ...mg, ships: { ...mg.ships, 101: playerShip(1, 99, [201, 202], 204) } },
  }, 77, '22')
  assert.match(changedEx, /<em>增设<\/em><span class="slot diff">测试增设装备<\/span>/)
})

test('阵容对照卡差异样式钉住最内层舰名、换舰行与装备的 warn 色', () => {
  // 这是源码文本护栏；颜色是否真落到舰名由统筹方用隐藏窗 getComputedStyle 量。
  const stylesheet = fs.readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8')
  const ruleBody = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = stylesheet.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
    assert.ok(match, `缺少样式规则：${selector}`)
    return match[1]
  }

  assert.match(ruleBody('.peek.lineup .lineup-ship .who.diff .entity-term'), /--entity-color:\s*var\(--warn\)/)
  const changedShipRule = ruleBody('.peek.lineup .lineup-ship.diff')
  assert.match(changedShipRule, /box-shadow:/)
  assert.match(changedShipRule, /var\(--warn\)/)
  assert.match(ruleBody('.peek.lineup .lineup-ship .slot.diff'), /var\(--warn\)/)
  assert.doesNotMatch(stylesheet, /\.who\.diff b\s*\{[^}]*color:\s*var\(--accent\)/)
})

test('lineupCardBodyHtml 未记录页显示暂无记录', () => {
  const html = renderLineupCard({ mg, maps: { 77: [22, 23] }, rows: [row] }, 77, '23')
  assert.match(html, /data-lineup-card-map="23">2-3<\/button>/)
  assert.match(html, /<div class="d-note">暂无记录<\/div>/)
})

test('lineupSectionHtml 对单发任务完全不生成阵容记录节', () => {
  assert.equal(renderLineup({ mg }, { ...row, periodLabel: '单' }), '')
})

test('qn 阵容记录接入持久化、覆盖保留备注、删除与输入法安全的备注提交', () => {
  const qn = fs.readFileSync(new URL('../src/renderer/modules/qn.ts', import.meta.url), 'utf8')
  assert.match(qn, /readLineups\(uiGet<unknown>\(LINEUP_UI_KEY, \{\}\)\)/)
  assert.match(qn, /lineups\[String\(questId\)\]\?\.\[mapKey\]\?\.note \?\? ''/)
  assert.match(qn, /uiSet\(LINEUP_UI_KEY, lineups\)/)
  assert.match(qn, /delete nextRecords\[mapKey\][\s\S]{0,220}else delete next\[String\(questId\)\]/)
  assert.match(qn, /#qn-lineup-note[\s\S]{0,900}event\.isComposing[\s\S]{0,200}event\.metaKey/)
  assert.match(qn, /lineupCards\.size > 0[\s\S]{0,160}\['decks', 'ships', 'slotitems'\]/)
})
