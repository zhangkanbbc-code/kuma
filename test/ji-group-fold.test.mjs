// 图鉴各卷目录的「分类分组」接可折叠组头（2026-08-27 他裁的规格）。
//
// 规格三句话：组头可折叠、**默认全展开**、折叠状态不持久化。口径对齐战斗流水
// 阶段折叠那次拍板——折叠只是玩家当场的收纳动作，不改变默认阅读
// （见 test/battle-log-fold.test.mjs）。
//
// 这份护栏钉四头：
// ① 开合判据：空账本 = 全展开，折一下才折起来（`sectionIsOpen` 脱 DOM 测）；
// ② 分组结构确实在场，且组头带**分类名 + 计数**；
// ③ 组内的行确实被组根裹住——不裹住，`[data-foldable]:not([data-open]) > *`
//    那条 CSS 藏不掉它们，"折叠"会变成只翻个三角；
// ④ 筛空的分类不留空组头；今日改修原有的行内折叠详情（原生 <details>）没被动。
//
// 断言全部对着真编译出来的产物 HTML 下，不断言源码文本——把默认态改成折叠、
// 把组根去掉、把计数换成编号数，正则一条也拦不住。
import assert from 'node:assert/strict'
import test from 'node:test'

import { abyssGroupsHtml, abyssShip, groupsOf } from './fixtures/render-abyss-groups.mjs'
import { sectionIsOpen, toggleSectionFold } from './fixtures/section-fold-logic.mjs'
import { todayGroupsHtml } from './fixtures/render-today-improve.mjs'

// ---- ① 开合判据 ----

const 分组段 = { openAllByDefault: true }
const 抽屉段 = {}

test('分类分组默认全展开：两本账都空的时候，问谁都是开着的', () => {
  const opened = new Set()
  const closed = new Set()
  for (const name of ['駆逐艦', '小口径主炮', '鎮守府海域']) {
    assert.equal(
      sectionIsOpen(分组段, name, opened, closed),
      true,
      `${name} 该是展开的——分组列表折起来就什么都不剩了`,
    )
  }
  // 抽屉里的段是**相反**的默认：先给一份目录，点开才看内容
  assert.equal(sectionIsOpen(抽屉段, '有关任务', opened, closed), false)
})

test('折一下才折起来，再折一下回到展开——记的是「折起来的那几个」', () => {
  const opened = new Set()
  const closed = new Set()
  toggleSectionFold(分组段, '駆逐艦', opened, closed)
  assert.equal(sectionIsOpen(分组段, '駆逐艦', opened, closed), false, '亲手折过就该是收起来的')
  assert.equal(
    sectionIsOpen(分组段, '軽巡洋艦', opened, closed),
    true,
    '折甲组不该连累乙组——账本记的是名字，不是「折过没有」这一个开关',
  )
  toggleSectionFold(分组段, '駆逐艦', opened, closed)
  assert.equal(sectionIsOpen(分组段, '駆逐艦', opened, closed), true, '再点一下要回到展开')
  assert.equal(closed.size, 0, '回到展开就该把名字从账上撤掉，不是留着一条 false')
})

test('两支记的是相反的账：常规段记「开着的」，分组段记「折起来的」', () => {
  const opened = new Set()
  const closed = new Set()
  toggleSectionFold(抽屉段, '有关任务', opened, closed)
  assert.deepEqual([...opened], ['有关任务'], '常规段翻开要记进 opened')
  assert.equal(closed.size, 0, '常规段不该碰 closed 那本')
  toggleSectionFold(分组段, '駆逐艦', opened, closed)
  assert.deepEqual([...closed], ['駆逐艦'], '分组段折起来要记进 closed')
  assert.deepEqual([...opened], ['有关任务'], '分组段不该碰 opened 那本')
})

// ---- ②③④ 深海卷：按舰种分组 ----

const 舰种表 = { 2: '駆逐艦', 3: '軽巡洋艦', 8: '戦艦', 9: '戦艦' }

const 深海一批 = () => [
  abyssShip(501, '駆逐イ級', 2),
  abyssShip(502, '駆逐ロ級', 2),
  abyssShip(503, '軽巡ホ級', 3),
  abyssShip(504, '戦艦ル級', 8),
  abyssShip(505, '戦艦ル級', 9), // 与 504 同名同 yomi = 同一形态的另一档
]

test('深海卷按舰种分组：组头带分类名与计数，组内的行被组根裹住', () => {
  const groups = groupsOf(abyssGroupsHtml(深海一批(), { stypes: 舰种表 }))
  assert.deepEqual(
    groups.map((g) => g.key),
    ['abyssShip:駆逐艦', 'abyssShip:軽巡洋艦', 'abyssShip:戦艦'],
    '三个舰种各一组，按最小舰种 id 排序；8 与 9 同名要并成一组',
  )

  const 驱逐 = groups[0]
  assert.match(驱逐.head, /駆逐艦/, '组头要写分类名')
  assert.match(驱逐.head, /<span class="cnt"[^>]*>2<\/span>/, '组头要带计数')
  // 组内容确实在组根里面：不裹住的话折叠 CSS 藏不掉它们
  assert.match(驱逐.body, /data-abyss="501"/)
  assert.match(驱逐.body, /data-abyss="502"/)
  assert.doesNotMatch(驱逐.body, /data-abyss="503"/, '别把隔壁舰种的行卷进来')

  // 计数报的是**形态数**不是编号数：戦艦组两个编号只有一个形态
  assert.match(groups[2].head, /<span class="cnt"[^>]*>1<\/span>/, '同形态的不同难度档只算一行')
  assert.match(groups[2].head, /共 2 个编号/, '编号数进悬停，别丢')
})

test('深海卷：筛空的舰种不留空组头——组是从筛过的那批建的', () => {
  // 只剩軽巡一条（模拟 chip / 搜索筛过之后）
  const groups = groupsOf(abyssGroupsHtml([abyssShip(503, '軽巡ホ級', 3)], { stypes: 舰种表 }))
  assert.deepEqual(groups.map((g) => g.key), ['abyssShip:軽巡洋艦'], '只该剩命中的那一组')
  assert.equal(groupsOf(abyssGroupsHtml([], { stypes: 舰种表 })).length, 0, '一条不剩就一个组头都不该有')
})

test('深海卷组根不吞高亮：从别处跳进某个编号，那一行照旧是选中的', () => {
  const groups = groupsOf(abyssGroupsHtml(深海一批(), { stypes: 舰种表, selected: 505, open: true }))
  const 戦艦 = groups.find((g) => g.key === 'abyssShip:戦艦')
  assert.match(戦艦.body, /class="row on" data-abyss="505"/, '选中的那一档要顶上来并高亮')
})

// ---- ②③④ 装备卷：今日改修 ----

const 装备表 = {
  1: { api_id: 1, api_name: '12.7cm連装砲', api_type: [1, 1, 1, 1] },
  2: { api_id: 2, api_name: '12.7cm連装砲B型改二', api_type: [1, 1, 1, 1] },
  3: { api_id: 3, api_name: '13号対空電探', api_type: [1, 1, 11, 11] },
}
const 舰表 = { 182: { api_id: 182, api_name: '明石' }, 91: { api_id: 91, api_name: '白露改二' } }
const 类别表 = { 1: '小口径主砲', 11: '電探' }

const 一档 = (eqId) => ({
  eq_id: eqId,
  improvement: [
    {
      helpers: [{ ship_ids: [91], days: [2] }],
      costs: {
        p1: { devmats: 4, devmats_sli: 6, screws: 3, screws_sli: 4 },
        p2: { devmats: 8, devmats_sli: 12, screws: 5, screws_sli: 7 },
        fuel: 10,
        ammo: 10,
        steel: 10,
        baux: 0,
      },
    },
  ],
})

/** 明石当旗舰、白露改二在二号位；两件不同类别的装备各持有一件，今天都能改。 */
const 账本 = (eqIds) => ({
  equips: 装备表,
  shipMst: 舰表,
  equipTypes: 类别表,
  day: 2,
  eo: eqIds.map(一档),
  mg: {
    ships: {
      1: { id: 1, shipId: 182, lv: 60, slot: [-1, -1, -1, -1], slotEx: 0 },
      2: { id: 2, shipId: 91, lv: 80, slot: [-1, -1, -1, -1], slotEx: 0 },
    },
    slotitems: {
      101: { mstId: 2, level: 0, alv: 0, locked: false },
      102: { mstId: 3, level: 0, alv: 0, locked: false },
    },
    decks: [{ id: 1, name: '第1', mission: [0], ships: [1, 2, -1, -1, -1, -1] }],
    ndocks: [],
    sortie: null,
    materials: { 0: 9999, 1: 9999, 2: 9999, 3: 9999, 6: 9999, 7: 9999 },
    useitems: {},
    airBases: [],
  },
})

test('今日改修按装备类别分组：组头带类别名与计数，方案行被组根裹住', () => {
  const groups = groupsOf(todayGroupsHtml(账本([2, 3])))
  assert.equal(groups.length, 2, '两个类别各一组')
  assert.deepEqual(
    groups.map((g) => g.key).sort(),
    ['equipToday:小口径主砲', 'equipToday:電探'],
    '组名用的是装备卷 chip 栏那套类别，不新造分类',
  )
  for (const group of groups) {
    assert.match(group.head, /<span class="cnt">/, '每个组头都要带计数')
    assert.match(group.body, /<details class="improve-item"/, '方案行要在组根里面')
  }
})

test('今日改修：原有的行内折叠详情没被动——组折叠是外面一层，不抢 <details>', () => {
  const [group] = groupsOf(todayGroupsHtml(账本([2])))
  // 折叠态那三问与展开层都还在原处
  assert.match(group.body, /<summary>/, '行内折叠靠原生 <details>/<summary>，别被改掉')
  assert.match(group.body, /<div class="ti-more">/, '展开层还要在')
  assert.match(group.body, /<span class="ti-stage">/, '折叠态那三问不能少')
  assert.match(group.body, /data-improve-open="2"/, '「装备详情 ›」还要能进抽屉')
  // 组头是组头、行是行：组根的 data-grp-key 不该跑到行上去
  assert.doesNotMatch(group.body, /data-grp-key/, '组内容里不该再有第二个组头')
})

test('今日改修：一条方案都没有时，一个空组头都不该留下', () => {
  assert.equal(todayGroupsHtml(账本([])), '', '没方案就该是空串，不是一排空组头')
})

test('今日改修组头的计数体例：能做几条 + 共几条，两个数都要在', () => {
  const [group] = groupsOf(todayGroupsHtml(账本([2])))
  assert.match(group.head, /<i class="grp-ready">可做 1<\/i>/, '今天能动手的条数要单独标出来')
  assert.match(group.head, /1<\/span>/, '总条数也要在')
})
