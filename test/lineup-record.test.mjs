import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import lineup from '../dist/shared/lineup-record.js'
import { renderLineup } from './fixtures/render-qn-lineup.mjs'

const { captureLineup, LINEUP_UI_KEY, lineupApplies, readLineups } = lineup

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

test('readLineups 逐条校验，坏记录、坏舰与坏装备不拖垮其余任务', () => {
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
    78: { ...valid, ships: [] },
    79: { ...valid, ships: [{ ...valid.ships[0], slots: [{ mstId: 0, level: 0, alv: 0 }] }] },
    80: { ...valid, note: 3 },
    81: null,
  }), {
    77: {
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
    },
  })
  for (const raw of [null, [], 'bad', 3]) assert.deepEqual(readLineups(raw), {})
  assert.equal(LINEUP_UI_KEY, 'qn.lineup')
})

const mg = {
  decks: [
    { id: 1, ships: [101] },
    { id: 2, ships: [102] },
    { id: 3, ships: [-1] },
    { id: 5, ships: [101] },
  ],
  ships: { 101: {}, 102: {} },
  master: {
    ships: { 1: { name: '测试舰甲' }, 2: { name: '测试舰乙' } },
    slotitems: {
      11: { name: '测试主炮' },
      12: { name: '测试舰战' },
      13: { name: '测试增设装备' },
    },
  },
}
const row = { id: 77, periodLabel: '季' }

test('lineupSectionHtml 无记录时列出非空的一至四队，命中高亮只落在满足条件的队', () => {
  const html = renderLineup({ mg, fleetCheck: { 77: { decks: [2] } } }, row)
  assert.match(html, /<h4>阵容记录<\/h4>/)
  assert.match(html, /data-lineup-record="1">第 1 舰队<\/button>/)
  assert.match(html, /class="hit" title="满足编成条件" data-lineup-record="2">第 2 舰队<\/button>/)
  assert.doesNotMatch(html, /data-lineup-record="3"|data-lineup-record="5"/)
  assert.match(html, /<div class="d-note">暂无记录<\/div>/)
  assert.doesNotMatch(html, /qn-lineup-note/)
  assert.equal((html.match(/class="hit"/g) ?? []).length, 1)
})

test('lineupSectionHtml 有记录时直观列出舰、等级、装备、改修、熟练度、增设与备注', () => {
  const html = renderLineup({
    mg,
    fleetCheck: { 77: { decks: [2] } },
    lineups: {
      77: {
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
        note: '<照此配置>',
      },
    },
  }, row)
  for (const text of [
    '记于 2026-09-18 14:20 · 第 1 舰队',
    '测试舰甲',
    'Lv 99',
    '测试主炮 ★9',
    '测试舰战 ★MAX',
    '熟练7',
    '<em>增设</em>测试增设装备',
    '无装备',
    '&lt;照此配置&gt;',
  ]) assert.ok(html.includes(text), text)
  assert.match(html, /id="qn-lineup-note" maxlength="400" placeholder="输入备注……"/)
  assert.match(html, /data-lineup-delete>删除<\/button>/)
})

test('lineupSectionHtml 对单发任务完全不生成阵容记录节', () => {
  assert.equal(renderLineup({ mg }, { ...row, periodLabel: '单' }), '')
})

test('qn 阵容记录接入持久化、覆盖保留备注、删除与输入法安全的备注提交', () => {
  const qn = fs.readFileSync(new URL('../src/renderer/modules/qn.ts', import.meta.url), 'utf8')
  assert.match(qn, /readLineups\(uiGet<unknown>\(LINEUP_UI_KEY, \{\}\)\)/)
  assert.match(qn, /lineups\[String\(questId\)\]\?\.note \?\? ''/)
  assert.match(qn, /uiSet\(LINEUP_UI_KEY, lineups\)/)
  assert.match(qn, /delete next\[String\(questId\)\]/)
  assert.match(qn, /#qn-lineup-note[\s\S]{0,900}event\.isComposing[\s\S]{0,200}event\.metaKey/)
})
