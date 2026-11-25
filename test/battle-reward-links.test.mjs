// 战后奖励里的道具要能点开道具图鉴（维护者裁决 2026-11-25：「捞到」行里的秋刀鱼点不动）。
// 舰娘、装备奖励本来就是图鉴链接；道具只拼了图标和文字。三处都走 battleRewardHtml：
// 「捞到」行、本轮掉落卡、结果条的击破 / 攻略 / 自选奖励。
// 夹具里 elink / elinkHtml 都桩成 <i data-id="…">…</i>，这里断言道具名落在 data-id 为道具编号的链接里。
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  battleOf,
  renderDropCard,
  renderDropChip,
  renderResultStrip,
  sortieOf,
} from './fixtures/render-di-battle.mjs'

const NONE = { drops: [], exmap: [], event: [], choices: [] }
const resultOf = (patch = {}) => ({
  rank: 'S', mvp: -1, mvpCombined: -1, baseExp: 100,
  dropShipMstId: null, dropShipName: null, firstClear: false, ...patch,
})
const flat = (html) => html.replace(/\s+/g, ' ')
// 图标本身也是空的 <i …></i>（夹具桩），先摘掉再看名字落在哪个链接里
const linked = (html, id, name) =>
  new RegExp(`<i data-id="${id}">(?:(?!</i>)[\\s\\S])*${name}(?:(?!</i>)[\\s\\S])*</i>`).test(html.replace(/<i [^>]*><\/i>/g, ''))

test('「捞到」行：秋刀鱼名字在道具链接里', () => {
  const b = battleOf({ result: resultOf({ rewards: { ...NONE, drops: [{ kind: 'useitem', id: 68, count: 1 }] } }) })
  const html = flat(renderDropChip(sortieOf({ battle: b }), b))
  assert.ok(linked(html, 68, '秋刀魚'), html)
})

test('本轮掉落卡：道具行的名字在道具链接里', () => {
  const html = flat(renderDropCard(sortieOf({ drops: [], itemDrops: [{ cell: 5, id: 68, count: 2 }] })))
  assert.ok(linked(html, 68, '秋刀魚'), html)
})

test('结果条：击破奖励与自选里的道具名都在道具链接里', () => {
  const html = flat(renderResultStrip(battleOf({
    result: resultOf({
      rewards: {
        ...NONE,
        exmap: [{ kind: 'useitem', id: 57, count: 1 }],
        choices: [[[{ kind: 'useitem', id: 105, count: 1 }], [{ kind: 'useitem', id: 57, count: 1 }]]],
      },
    }),
  })))
  assert.ok(linked(html, 57, '勲章'), html)
  assert.ok(linked(html, 105, '格納庫増設'), html)
})
