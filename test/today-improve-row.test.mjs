// 「今日改修」的行改成折叠/展开式（2026-08-25 他裁的规格）。
//
// 折叠态**只答三个问题**——改什么、谁当助手、多少消耗；展开态回答「这几件同款
// 现在都在哪」。断言全部对着真编译出来的行 HTML 下：把「远征中」数成「出击中」、
// 把缺口又截成两条、把素材塞回折叠态，源码看上去都很正常。
import assert from 'node:assert/strict'
import test from 'node:test'

import { expandedOf, foldedOf, todayRows } from './fixtures/render-today-improve.mjs'

const 装备表 = {
  1: { api_id: 1, api_name: '12.7cm連装砲', api_type: [1, 1, 1, 1] },
  2: { api_id: 2, api_name: '12.7cm連装砲B型改二', api_type: [1, 1, 1, 1] },
  3: { api_id: 3, api_name: '13号対空電探', api_type: [1, 1, 11, 11] },
}
const 舰表 = {
  182: { api_id: 182, api_name: '明石' },
  91: { api_id: 91, api_name: '白露改二' },
  92: { api_id: 92, api_name: '満潮改二' },
  93: { api_id: 93, api_name: '時雨改二' },
  500: { api_id: 500, api_name: '出门舰' },
}
const 道具表 = { 70: { api_id: 70, api_name: '新型砲熕兵装資材' } }

/**
 * 一份完整的账本：明石当旗舰、白露改二在二号位、五件同款分散在库与三种「不在手边」。
 * ★0 ×3（101 在库 / 103 远征 / 104 出击）· ★4 ×1（102 在库）· ★max ×1（105 入渠）
 */
const 账本 = (over = {}) => ({
  equips: 装备表,
  shipMst: 舰表,
  items: 道具表,
  day: 2,
  eo: [
    {
      eq_id: 2,
      improvement: [
        {
          helpers: [{ ship_ids: [91], days: [2] }],
          costs: {
            p1: { devmats: 4, devmats_sli: 6, screws: 3, screws_sli: 4, equips: [{ id: 1, eq_count: 1 }] },
            p2: { devmats: 8, devmats_sli: 12, screws: 5, screws_sli: 7 },
            fuel: 10,
            ammo: 10,
            steel: 10,
            baux: 0,
          },
        },
      ],
    },
  ],
  mg: {
    ships: {
      1: { id: 1, shipId: 182, lv: 60, slot: [-1, -1, -1, -1], slotEx: 0 },
      2: { id: 2, shipId: 91, lv: 80, slot: [-1, -1, -1, -1], slotEx: 0 },
      10: { id: 10, shipId: 500, lv: 50, slot: [103, -1, -1, -1], slotEx: 0 },
      11: { id: 11, shipId: 500, lv: 50, slot: [104, -1, -1, -1], slotEx: 0 },
      12: { id: 12, shipId: 500, lv: 50, slot: [105, -1, -1, -1], slotEx: 0 },
    },
    slotitems: {
      101: { mstId: 2, level: 0, alv: 0, locked: false },
      102: { mstId: 2, level: 4, alv: 0, locked: false },
      103: { mstId: 2, level: 0, alv: 0, locked: false },
      104: { mstId: 2, level: 0, alv: 0, locked: false },
      105: { mstId: 2, level: 10, alv: 0, locked: false },
      201: { mstId: 1, level: 0, alv: 0, locked: false },
      202: { mstId: 1, level: 0, alv: 0, locked: false },
    },
    decks: [
      { id: 1, name: '第1', mission: [0], ships: [1, 2, -1, -1, -1, -1] },
      { id: 2, name: '第2', mission: [1, 5, 0], ships: [10, -1, -1, -1, -1, -1] },
      { id: 3, name: '第3', mission: [0], ships: [11, -1, -1, -1, -1, -1] },
      { id: 4, name: '第4', mission: [0], ships: [12, -1, -1, -1, -1, -1] },
    ],
    ndocks: [{ id: 1, shipId: 12, completeTime: 0, state: 1 }],
    sortie: { active: true, practice: false, deckId: 3 },
    materials: { 0: 9999, 1: 9999, 2: 9999, 3: 9999, 6: 9999, 7: 9999 },
    useitems: { 70: 5 },
    airBases: [],
    ...(over.mg ?? {}),
  },
  ...over,
})

const 一行 = (over) => {
  const rows = todayRows(账本(over))
  assert.equal(rows.length, 1, '这份账本该正好出一条方案')
  return rows[0]
}

test('折叠态只答三个问题：改什么、谁当助手、多少消耗——素材与道具不进这一层', () => {
  const folded = foldedOf(一行().html)
  // 改什么：装备名 + 本次档位
  assert.match(folded, /12\.7cm連装砲B型改二/)
  assert.match(folded, /<span class="ti-stage">★0 → ★1<\/span>/)
  // 谁当助手：二号舰命中就点名打钩
  assert.match(folded, /<span class="ti-helper">[\s\S]*白露改二[\s\S]*✓<\/span>/)
  // 多少消耗：只有开发/改修两笔，确保值走括号
  assert.match(folded, /<span class="ti-cost">[\s\S]*开发<\/a> 4 <i>\(6\)<\/i>[\s\S]*改修<\/a> 3 <i>\(4\)<\/i><\/span>/)
  // 素材装备与道具不在折叠态——它们是第四问，归展开层
  assert.doesNotMatch(folded, /12\.7cm連装砲<\/a>/, '素材装备被塞回折叠态了')
  assert.doesNotMatch(folded, /素材/)
  // 状态标签还在，四态文案没动
  assert.match(folded, /<span class="today-status ok">现在可做<\/span>/)
  // 字号分档靠类名，三档各有各的钩子
  for (const cls of ['ti-stage', 'ti-helper', 'ti-cost']) {
    assert.ok(folded.includes(`class="${cls}"`), `缺 .${cls}`)
  }
})

test('点行是就地展开，不是推抽屉——抽屉只由「装备详情 ›」那一枚开', () => {
  const html = 一行().html
  assert.match(html, /^<details class="improve-item" data-equip="2">/, '行不是折叠式的')
  assert.match(html, /<a class="ti-open" data-improve-open="2">装备详情 ›<\/a>/, '没有进抽屉的口子')
  // 整行不再挂 data-equip 当抽屉钥匙（那是老的「点行开抽屉」）
  assert.doesNotMatch(html, /<div class="row improve-row[^"]*" data-equip=/)
})

test('展开层回答「这几件同款现在都在哪」：分布、装备/空闲、不在手边三项', () => {
  const more = expandedOf(一行().html)
  assert.match(more, /持有 5 · ★0 ×3 · ★4 ×1 · ★max ×1/, '各星级持有分布不对')
  assert.match(more, /装备中 3 · 空闲 2/, '装备/未装备数不对')
  assert.match(more, /不在手边 远征中 1 · 出击中 1 · <span[^>]*>入渠中 1</, '「不在手边」三项没数对')
})

test('三种「不在手边」各数各的，不许把远征的算进出击', () => {
  // 第 2 队收了远征、第 3 队没在出击 → 三项全归零，但三项照旧写出来
  const 都回来了 = 一行({
    mg: {
      ...账本().mg,
      decks: [
        { id: 1, name: '第1', mission: [0], ships: [1, 2, -1, -1, -1, -1] },
        { id: 2, name: '第2', mission: [0], ships: [10, -1, -1, -1, -1, -1] },
        { id: 3, name: '第3', mission: [0], ships: [11, -1, -1, -1, -1, -1] },
        { id: 4, name: '第4', mission: [0], ships: [12, -1, -1, -1, -1, -1] },
      ],
      ndocks: [],
      sortie: null,
    },
  })
  assert.match(expandedOf(都回来了.html), /不在手边 远征中 0 · 出击中 0 · <span[^>]*>入渠中 0</)
  // 演习不算出击：sortie.practice 的队伍上的舰照旧在手边
  const 演习中 = 一行({
    mg: { ...账本().mg, sortie: { active: true, practice: true, deckId: 3 }, ndocks: [] },
  })
  assert.match(演习中.html, /出击中 0/, '演习被算成了出击')
  assert.match(演习中.html, /远征中 1/, '远征那一项被演习带偏了')
})

test('入渠那一格单挂一枚记号，说清现在按哪边算', () => {
  const more = expandedOf(一行().html)
  const untested = /<span class="ti-untested" title="([^"]*)">/.exec(more)
  assert.ok(untested, '入渠中那一格没有可悬停的说明')
  // 2026-08-26 文案清扫按拟稿缩成「入渠中的舰按不在手边计」：
  // 「入渠中的舰不能换装」是游戏规则复述（族 3），「还没实测」是防守性自述（族 2），
  // 两句都删。要守的那件事没变，而且它比措辞更硬——这一格必须单独挂 ti-untested
  // 这枚记号（与远征/出击那两格不同待遇），且当场说清现在按哪边算。
  assert.match(untested[1], /按不在手边计/, '没交代现在按哪边算')
  assert.match(more, /class="ti-untested"/, '入渠那一格没被单独标出来')
})

test('缺口全部列出，不再只显两条', () => {
  const 缺 = 一行({
    mg: {
      ...账本().mg,
      slotitems: { 101: { mstId: 2, level: 0, alv: 0, locked: false } },
      materials: { 0: 0, 1: 0, 2: 0, 3: 9999, 6: 0, 7: 0 },
      useitems: {},
    },
    eo: [
      {
        eq_id: 2,
        improvement: [
          {
            helpers: [{ ship_ids: [91], days: [2] }],
            costs: {
              p1: {
                devmats: 4,
                screws: 3,
                equips: [{ id: 1, eq_count: 3 }, { id: 3, eq_count: 2 }],
                consumable: [{ id: 70, eq_count: 1 }],
              },
              fuel: 10,
              ammo: 10,
              steel: 10,
              baux: 0,
            },
          },
        ],
      },
    ],
  })
  assert.ok(缺.missing.length > 2, '这份账本该攒出三条以上缺口')
  const more = expandedOf(缺.html)
  for (const gap of 缺.missing) {
    assert.ok(more.includes(gap), `展开层漏了缺口「${gap}」`)
  }
  // 折叠态的状态标签仍是短的（它是标签不是清单），但悬停给得出全部
  const folded = foldedOf(缺.html)
  assert.equal(folded.split(' · ').length - 1 >= 1, true)
  assert.match(folded, /<span class="today-status wait" title="[^"]*"/, '截断了却不给悬停看全')
})

test('候选二号舰多时折叠态只报头一个 + 还有几艘，全部候选留给展开层', () => {
  const 多候选 = 一行({
    mg: {
      ...账本().mg,
      decks: [
        { id: 1, name: '第1', mission: [0], ships: [1, -1, -1, -1, -1, -1] },
        { id: 2, name: '第2', mission: [1, 5, 0], ships: [10, -1, -1, -1, -1, -1] },
        { id: 3, name: '第3', mission: [0], ships: [11, -1, -1, -1, -1, -1] },
        { id: 4, name: '第4', mission: [0], ships: [12, -1, -1, -1, -1, -1] },
      ],
    },
    eo: [
      {
        eq_id: 2,
        improvement: [
          {
            helpers: [{ ship_ids: [91, 92, 93], days: [2] }],
            costs: { p1: { devmats: 4, screws: 3 }, fuel: 10, ammo: 10, steel: 10, baux: 0 },
          },
        ],
      },
    ],
  })
  const folded = foldedOf(多候选.html)
  assert.match(folded, /<span class="ti-helper">[\s\S]*白露改二[\s\S]*等 3 艘<\/span>/)
  assert.doesNotMatch(folded, /満潮改二/, '折叠态把全部候选都摊开了')
  const more = expandedOf(多候选.html)
  assert.match(more, /二号舰[\s\S]*白露改二[\s\S]*満潮改二[\s\S]*時雨改二/, '展开层没给全部候选')
  assert.match(多候选.html, /需换二号舰/, '二号位没人时状态标签该点出来')
})

test('二号舰不限时照实说一句，不留白也不硬编一个名字', () => {
  const 不限 = 一行({
    eo: [
      {
        eq_id: 2,
        improvement: [
          {
            // wikiwiki 改修表里「二番舰不要」写成 ship_ids:[-1]
            helpers: [{ ship_ids: [-1], days: [2] }],
            costs: { p1: { devmats: 4, screws: 3 }, fuel: 10, ammo: 10, steel: 10, baux: 0 },
          },
        ],
      },
    ],
  })
  assert.match(foldedOf(不限.html), /<span class="ti-helper">无需指定二号舰<\/span>/)
})

test('窄档要移进展开层的那份消耗一直渲染着，不靠 JS 补——藏与显交给容器查询', () => {
  const html = 一行().html
  assert.match(expandedOf(html), /<div class="ti-row ti-cost-fold">每次消耗 /, '窄档那份消耗没渲染')
  // 两处是同一笔账，别一处括号一处「·确保」
  assert.doesNotMatch(html, /· 确保 /)
})
