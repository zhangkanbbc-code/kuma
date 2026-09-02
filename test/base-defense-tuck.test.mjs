// 基地防空打完、人还在前往下一点的路上时，镝的主区收成一行摘要。
//
// 用户 2026-08-26 第二轮实报：A 点 → 罗盘 → 途中触发基地防空 → 防空结算 → 选阵型 → B 点开战。
// 防空结算到 B 点开战之间那个窗口（**含选阵型那一刻**），主区被防空全套占着
// （结算卡 + 基地航空队/空袭敌编队两栏 + 防空的战斗流水），而玩家这时要看的是
// **去向点的敌编成**——凭它选阵型。上一改只保住了「前往 X 点」那一条横幅，
// 于是横幅在说去向、底下整屏在说防空。这一改把整个面板都还给去向语境。
//
// 判据整段引真的那一份（`baseDefenseSettled` / `baseDefenseEnRoute` / `baseDefenseTucked`
// / `bodyBattleOf` 都在战果槽那一段切片里）。三条腿——是防空、已结算完、还在航行中——
// 任何一条写反，源码文本护栏都逮不到，只有真跑一遍判据与产物才看得见。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  airOf,
  baseDefenseEnRoute,
  baseDefenseFoldKey,
  baseDefenseSettled,
  baseDefenseTucked,
  battleOf,
  bodyBattleOf,
  expandedBaseDefense,
  renderOutcomeBanner,
  shipOf,
  sortieOf,
} from './fixtures/render-di-battle.mjs'

const nodeOf = (cell, eventId = 4) => ({ cell, eventId, eventKind: 0, note: '' })

// 基地防空的「我方」是三列基地耐久（无在籍 id 的临时单位），不是舰队。
// `damaged` 里的下标就是挨炸掉耐久的那几列。
const bases = (damaged = []) =>
  Array.from({ length: 3 }, (_, i) => ({
    ...shipOf(i, `第${i + 1}基地航空队`),
    fleet: 'main',
    position: i,
    hpStart: 200,
    hpEnd: damaged.includes(i) ? 150 : 200,
    hpMax: 200,
  }))

const defenseBattle = (patch = {}) =>
  battleOf({
    kind: 'baseDefense',
    ts: 4242,
    air: airOf({ seiku: 1, fLost: 3, eLost: 40 }),
    fShips: bases(),
    eShips: Array.from({ length: 4 }, (_, i) => shipOf(i, `来袭机${i + 1}`)),
    ...patch,
  })

/** 出击途中：罗盘已经把 B（7 点）推进 nodes，防空是路上顺带捎来的那一场。 */
const enRouteSortie = (patch = {}, battlePatch = {}) =>
  sortieOf({
    active: true,
    nodes: [nodeOf(7)],
    currentCell: 7,
    battle: defenseBattle(battlePatch),
    ...patch,
  })

/** 展开集合是整份夹具共用的一份引用，用例之间必须自己擦干净。 */
const withExpanded = (battle, run) => {
  const key = baseDefenseFoldKey(battle)
  expandedBaseDefense.add(key)
  try {
    return run()
  } finally {
    expandedBaseDefense.delete(key)
  }
}

// ---- ① 收纳态：摘要行在场，全套不在 ----

test('防空完成 + 航行中：主区只留一行摘要，防空全套默认不进 DOM', () => {
  const sortie = enRouteSortie()
  assert.equal(baseDefenseSettled(sortie.battle), true)
  assert.equal(baseDefenseEnRoute(sortie), true)
  assert.equal(baseDefenseTucked(sortie), true)
  // 主体那四段（战斗抬头 / 编队两栏 / 结果条 / 战斗流水）走的是 `bodyBattle ? … : …`，
  // 这里给 null 就等于整套让位——排布跟着退回无空袭的航行态。
  assert.equal(bodyBattleOf(sortie), null, '收纳时主体该按「没有战斗」画')

  const html = renderOutcomeBanner(sortie)
  assert.ok(html.includes('基地防空结算 · 制空权确保 · 基地未受损'), '摘要行不在')
  assert.ok(html.includes('前往 7 点'), '去向那一条还得在')
  // 结算卡的副行与「基地受损 N」那一段是被收进去的部分，收纳态一个字都不该露
  assert.ok(!html.includes('我方飞机损失'), '副行没被收进去')
  assert.ok(!html.includes('基地受损 0'), '头部第三段没被换成摘要那半句')
  assert.equal((html.match(/class="verdict/g) ?? []).length, 2, '只该有摘要行 + 去向条两条')
  assert.ok(html.includes('data-act="bd-tuck"'), '摘要行要能点开')
  assert.ok(html.includes('aria-expanded="false"'))
  assert.ok(html.includes('▸'), '行尾要有展开指示')
  assert.ok(!html.includes('▾'))
})

test('摘要行零新增文案：三段都能在展开态那张卡里逐字找到', () => {
  const sortie = enRouteSortie()
  const tucked = renderOutcomeBanner(sortie)
  const opened = withExpanded(sortie.battle, () => renderOutcomeBanner(sortie))
  const bold = /<b>([^<]*)<\/b>/.exec(tucked)
  assert.ok(bold, '摘要行没有加粗那一段')
  for (const piece of bold[1].split(' · ')) {
    assert.ok(opened.includes(piece), `摘要行的「${piece}」在展开态那张卡里找不到——这是新造的词`)
  }
})

test('基地真挨炸时，摘要那半句照实说受损，与展开态对得上', () => {
  const sortie = enRouteSortie({}, { fShips: bases([0, 2]) })
  const tucked = renderOutcomeBanner(sortie)
  assert.ok(tucked.includes('基地防空结算 · 制空权确保 · 2 个基地受损'))
  assert.ok(!tucked.includes('基地未受损'))
  const opened = withExpanded(sortie.battle, () => renderOutcomeBanner(sortie))
  assert.ok(opened.includes('2 个基地受损'), '展开态副行该说同一件事')
  assert.ok(opened.includes('基地受损 100'), '展开态头部照旧给耐久合计')
})

// ---- ② 展开态：全套回来，且不自动收回 ----

test('点开之后全套在场，摘要行让位给原来那张结算卡', () => {
  const sortie = enRouteSortie()
  withExpanded(sortie.battle, () => {
    assert.equal(baseDefenseTucked(sortie), false)
    assert.equal(bodyBattleOf(sortie), sortie.battle, '展开时主体要拿回这一场防空')
    const html = renderOutcomeBanner(sortie)
    assert.ok(html.includes('基地防空结算 · 制空权确保 · 基地受损 0'), '原样那张卡的头部')
    assert.ok(html.includes('我方飞机损失 3 · 敌机损失 40 · 基地未受损'), '原样那张卡的副行')
    assert.ok(html.includes('前往 7 点'), '展开也不该把去向条顶掉')
    assert.ok(html.includes('aria-expanded="true"'))
    assert.ok(html.includes('▾'), '展开态要能再收回去')
  })
  // 出了作用域（等于玩家再点一次）才回到收纳——展开态不会自己收回
  assert.equal(baseDefenseTucked(sortie), true)
})

test('展开状态按这一场防空记，同一次出击里的另一场不跟着展开', () => {
  const first = enRouteSortie()
  const second = enRouteSortie({}, { ts: 9001 })
  assert.notEqual(baseDefenseFoldKey(first.battle), baseDefenseFoldKey(second.battle))
  withExpanded(first.battle, () => {
    assert.equal(baseDefenseTucked(first), false)
    assert.equal(baseDefenseTucked(second), true, '另一场防空不该被连带展开')
  })
})

// ---- ③ 不收纳的三种局面 ----

test('防空还没结算完（航空阶段解不出来）→ 全量显示，一个折叠钩子都不挂', () => {
  const sortie = enRouteSortie({}, { air: null })
  assert.equal(baseDefenseSettled(sortie.battle), false)
  assert.equal(baseDefenseEnRoute(sortie), false)
  assert.equal(baseDefenseTucked(sortie), false)
  assert.equal(bodyBattleOf(sortie), sortie.battle)
  const html = renderOutcomeBanner(sortie)
  assert.ok(html.includes('基地防空结算 · 制空无判定'), '判不出制空时照旧说无判定')
  assert.ok(html.includes('我方飞机损失'))
  assert.ok(!html.includes('bd-tuck'), '没结算完就不该挂收纳钩子')
  assert.ok(!html.includes('▸') && !html.includes('▾'))
})

test('已归港（防空就是这次出击的最后一件事）→ 不收纳，全套留给复盘', () => {
  const sortie = enRouteSortie({ active: false })
  assert.equal(baseDefenseSettled(sortie.battle), true, '结算本身是完成的')
  assert.equal(baseDefenseEnRoute(sortie), false, '但已经没有下一站了')
  assert.equal(bodyBattleOf(sortie), sortie.battle)
  const html = renderOutcomeBanner(sortie)
  assert.ok(html.includes('我方飞机损失'))
  assert.ok(!html.includes('bd-tuck'))
})

test('连一个点都还没进（画不出「前往 X 点」）→ 不收纳', () => {
  const sortie = enRouteSortie({ nodes: [] })
  assert.equal(baseDefenseEnRoute(sortie), false)
  assert.equal(bodyBattleOf(sortie), sortie.battle)
  assert.ok(renderOutcomeBanner(sortie).includes('我方飞机损失'))
})

test('B 点真战斗一到就自然切回去：普通战斗从来不进收纳这条路', () => {
  // 现状确认（用户点名要核的那一条）：battle 被替换成本点的真战斗后，
  // kind 不再是 baseDefense，判据第一条腿就断了，不需要任何特判。
  const sortie = enRouteSortie({}, {})
  sortie.battle = battleOf({ kind: 'day', hasNight: false })
  assert.equal(baseDefenseEnRoute(sortie), false)
  assert.equal(baseDefenseTucked(sortie), false)
  assert.equal(bodyBattleOf(sortie), sortie.battle)
  const html = renderOutcomeBanner(sortie)
  assert.ok(!html.includes('基地防空'), '防空那张卡该整个不见了')
  assert.ok(!html.includes('前往 7 点'), '开战之后就不再是「航行中」')
})

// ---- ④ 接线：形状护栏 ----
//
// 下面两条钉的是**接线**（判断本身已由上面逐条真跑过）：主体四段有没有真的换成
// `bodyBattle`、右栏那张敌情卡有没有真的改判。这两处一个在 DOM 装配里、一个在
// 依赖极重的 preBattleIntelHtml 里，都不在现有切段夹具的覆盖范围内，
// 所以只能按源码形状钉——**它拦得住「忘了接」，拦不住「判断写反」**，
// 后者由上面那几条真跑的用例负责。

const di = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')

test('主体四段都走 bodyBattle，没有一段还直接吃着 b', () => {
  assert.match(di, /const bodyBattle = bodyBattleOf\(s\)/, '主体那一层没有取收纳后的战斗')
  for (const seg of [
    'airlineHtml(bodyBattle, s)',
    'arenaHtml(bodyBattle, s)',
    'resultStripHtml(bodyBattle)',
    'logHtml(bodyBattle, logExpanded)',
  ]) {
    assert.ok(di.includes(`bodyBattle ? ${seg}`), `${seg} 没接上收纳判据`)
  }
  // 流水那一格的 else 支就是航行态那句占位——「收纳后与无空袭一致」靠的正是它
  assert.match(di, /bodyBattle \? logHtml\(bodyBattle, logExpanded\) : '<div class="log">.*尚未发生战斗/)
  for (const stale of ['b ? airlineHtml(b, s)', 'b ? arenaHtml(b, s)', 'b ? resultStripHtml(b)']) {
    assert.ok(!di.includes(stale), `${stale} 还在，这一段没跟着让位`)
  }
})

test('右栏「交战前敌情」在防空航行态照常出，不再被 s.battle 一刀切掉', () => {
  const gate = /const preBattleIntelHtml = \(s: SortieView\): string => \{[\s\S]{0,600}?return ''/.exec(di)
  assert.ok(gate, '找不到交战前敌情那道门，护栏锚点要跟着改')
  assert.match(gate[0], /baseDefenseEnRoute\(s\)/, '这张卡没跟着防空语境改判')
  assert.ok(
    !/if \(s\.practice \|\| s\.battle\) return ''/.test(gate[0]),
    '又退回「有战斗就一刀切」了——防空窗口里这张卡正是要看的那一份',
  )
})
