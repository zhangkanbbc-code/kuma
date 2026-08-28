import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import fleetWipe from '../dist/shared/fleet-wipe.js'
import { battleOf as arenaBattleOf, renderArena } from './fixtures/render-di-arena.mjs'

const { fleetWipeStage } = fleetWipe

const ship = (index, over = {}) => ({
  index,
  fleet: index >= 6 ? 'escort' : 'main',
  position: index % 6,
  mstId: 1500 + index,
  rosterId: null,
  name: `敌 ${index}`,
  lv: 1,
  hpStart: 50,
  hpEnd: 0,
  hpMax: 50,
  damageDealt: 0,
  sunk: true,
  defeated: true,
  escaped: false,
  repairItemUsed: null,
  ...over,
})

const attack = (stage, stageLabel, targets, over = {}) => ({
  phase: 'gun1',
  side: 0, // 我方出手
  attacker: 0,
  ciType: null,
  ciKind: null,
  stage,
  action: 0,
  stageLabel,
  source: 'test',
  simultaneous: false,
  hits: targets.map((target) => ({
    target,
    damage: 99,
    critical: false,
    miss: false,
    protect: false,
    sunk: true,
    repairItem: null,
  })),
  ...over,
})

const wipeOf = (ships, attacks, over = {}) =>
  fleetWipeStage({ ships, attacks, attackerSide: 0, practice: false, ...over })

test('a wiped group reports the stage whose last hit emptied it', () => {
  const escort = [ship(6), ship(7), ship(8)]
  const attacks = [
    attack(2, '开幕雷击', [6, 7]),
    attack(5, '夜战', [8]), // 最后一艘倒在夜战
  ]
  assert.deepEqual(wipeOf(escort, attacks), { stage: 5, stageLabel: '夜战' })
})

test('a group with anyone still standing is not a wipe', () => {
  const escort = [ship(6), ship(7, { sunk: false, defeated: false, hpEnd: 12 })]
  assert.equal(wipeOf(escort, [attack(2, '开幕雷击', [6])]), null)
})

test('ships that never engaged do not block a wipe', () => {
  // 退避的、以及开局就 0 HP 的，都不算「还站着」——
  // 否则一支有人退避的舰队永远算不上被打光。
  const escort = [
    ship(6),
    ship(7, { escaped: true, sunk: false, defeated: false, hpEnd: 30 }),
    ship(8, { hpStart: 0, sunk: false, defeated: false }),
  ]
  assert.deepEqual(wipeOf(escort, [attack(3, '雷击战', [6])]), { stage: 3, stageLabel: '雷击战' })
})

test('an empty group is never a wipe', () => {
  assert.equal(wipeOf([], [attack(1, '航空战', [])]), null)
  assert.equal(wipeOf([ship(6, { hpStart: 0, sunk: false })], []), null)
})

test('hits from the same side as the group are ignored', () => {
  // 敌方内部不会互相击沉，但流水里两侧的攻击混在一起，
  // 只数打向这一队的那些，否则阶段会错。
  const escort = [ship(6)]
  const enemyOwnFire = attack(2, '开幕雷击', [6], { side: 1 })
  const ourFire = attack(4, '闭幕雷击', [6])
  assert.deepEqual(wipeOf(escort, [enemyOwnFire, ourFire]), { stage: 4, stageLabel: '闭幕雷击' })
})

test('practice uses defeated because there is no real sinking there', () => {
  const escort = [ship(6, { sunk: false, defeated: true, hpEnd: 1 })]
  assert.equal(wipeOf(escort, [attack(2, '炮击战', [6])]), null, '出击口径下 HP1 不算沉')
  assert.deepEqual(wipeOf(escort, [attack(2, '炮击战', [6])], { practice: true }), {
    stage: 2,
    stageLabel: '炮击战',
  })
})

test('out-of-order流水 still resolves to the真正最后那一击', () => {
  const escort = [ship(6), ship(7)]
  // 旧快照/合并夜战后顺序未必天然有序，判定前要自己排一次
  const attacks = [attack(6, '夜战', [7]), attack(1, '开幕雷击', [6])]
  assert.deepEqual(wipeOf(escort, attacks), { stage: 6, stageLabel: '夜战' })
})

test('友军（side 2）的补刀计入敌方全歼', () => {
  // 敌队最后一舰由 NPC 友军夜战击沉：pending 必须能被清空，
  // 否则 UI 划线却说不出「全歼 · 友军舰队」。
  const enemies = [ship(0), ship(1)]
  const attacks = [
    attack(3, '炮击战', [0]),
    attack(7, '友军舰队', [1], { side: 2, phase: 'friendly' }),
  ]
  assert.deepEqual(wipeOf(enemies, attacks), { stage: 7, stageLabel: '友军舰队' })
})

test('友军夜战段里敌方反击友军的那几击，不得混进我方全歼判定', () => {
  // 敌反击友军（side 1 → 友军侧）的 hits[].target 是友军舰序号，
  // 与我方舰序号同域——认错侧就会拿友军的账去消我方的
  const ours = [ship(0, { sunk: true })]
  const enemyHitsFriend = attack(6, '友军舰队', [0], { side: 1, phase: 'friendly' })
  const enemyHitsUs = attack(8, '夜战', [0], { side: 1 })
  assert.deepEqual(wipeOf(ours, [enemyHitsFriend, enemyHitsUs], { attackerSide: 1 }), {
    stage: 8,
    stageLabel: '夜战',
  })
})

test('a confirmed wipe with no matching hits still counts, just without a stage', () => {
  // 旧快照缺 hits，或沉没是结算侧补的。仍然是全歼，只是说不出阶段——
  // 「全歼」与「哪个阶段」必须分开表达，UI 据此划线但不标阶段。
  const escort = [ship(6), ship(7)]
  assert.deepEqual(wipeOf(escort, []), { stage: null, stageLabel: null })
})

/**
 * 取一条规则的**声明块本身**。
 * `选择器 \{[\s\S]*?某声明` 这种写法是假的：`{` 之后的惰性匹配会一路越过右花括号，
 * 在后面别家的规则里撞见那条声明也算数（battle-log-note-fold 那单当场翻过车）。
 */
const ruleBody = (html, selector) => {
  const at = html.indexOf(`${selector} {`)
  assert.ok(at >= 0, `样式表里找不到 ${selector}，这条守卫的锚点要跟着改`)
  const open = html.indexOf('{', at)
  const close = html.indexOf('}', open)
  assert.ok(close > open, `${selector} 的声明块没有收尾`)
  return html.slice(open + 1, close)
}

test('the wipe mark is a strikethrough on the fleet name, not an overlay', () => {
  const html = fs.readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8')
  // 横线画在名字上：名字长度变化不用重算宽度。
  // 但不能用 text-decoration: line-through——它按字体的 strikeout 度量画线，
  // 那个度量是给拉丁小写字母定的，落到汉字上会偏到上三分之一（实机复现过）。
  // 改成背景渐变画在盒子正中。
  const line = ruleBody(html, '.mod-di .fs-h b.wiped .wl, .mod-di .fs-sub span.wiped .wl')
  assert.match(line, /background-image: linear-gradient\(var\(--bad\), var\(--bad\)\)/)
  assert.match(line, /background-size: 100% 2px/)
  assert.match(line, /background-position: 0 calc\(50% \+ 1px\)/)
  assert.doesNotMatch(html, /text-decoration: line-through;\n\s*text-decoration-color/)
  // 折行的每一段各自成盒，`background-size` 的 100% 才是本段自己的宽度
  assert.match(line, /-webkit-box-decoration-break: clone/)
  // 外层那两枚只剩透明度。线一旦画回整块盒子，折行就又只剩一条、还悬在两行之间的缝上——
  // 2026-08 活动的「深海アシカ作戦部隊 ドーバー海峡前縁警戒群」就是这么撞出来的。
  const box = ruleBody(html, '.mod-di .fs-h b.wiped, .mod-di .fs-sub span.wiped')
  assert.doesNotMatch(box, /background/)
  assert.match(box, /opacity: \.8/)
  // 护卫队那一行的队名不参与挤压，否则窄坞里会被压成一列一个字，横线只落在其中一个字上
  assert.match(html, /\.mod-di \.fs-sub > span:first-child \{ flex: none; \}/)
  // 不再叠绝对定位的斜线与角标
  assert.doesNotMatch(html, /wipe-slash|wipe-tag|fs-group/)
  const combat = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(combat, /wipe-slash|wipe-tag|fs-group/)
})

// 队名的横线挂在哪一层：外面那枚 `b`/`span` 是 flex 项目、已被块化，折行只是块内换行，
// 整块背景只画得出一条；线得挂在内层的 inline `.wl` 上，折行才断成多段、每段各一条。
// 少包一层、或者把「全歼 · X」那枚小标也一起包进去，样式表一个字都不用改就变形了。
const wipedArena = (patch) =>
  renderArena(
    arenaBattleOf({
      fShips: [ship(0, { hpEnd: 40, sunk: false, defeated: false })],
      ...patch,
    }),
  )

test('the strikethrough rides an inner inline, so a wrapped name gets one line per row', () => {
  // 主力队与护卫队一起全歼：两处 .wiped 落点一次看全
  const arena = wipedArena({
    enemyDeckName: '深海アシカ作戦部隊 ドーバー海峡前縁警戒群',
    eShips: [ship(0), ship(1), ship(6), ship(7)],
    attacks: [attack(2, '炮击战', [0, 1]), attack(4, '夜战', [6, 7])],
  })
  // 标题栏的主力队名：整段包进内层 inline
  assert.match(
    arena,
    /<b class="wiped"><span class="wl">深海アシカ作戦部隊 ドーバー海峡前縁警戒群（联合）<\/span><\/b>/,
  )
  // 「敌护卫舰队」那一行同款
  assert.match(arena, /<span class="wiped"><span class="wl">敌护卫舰队<\/span><\/span>/)
  // 小标留在内层之外：它自己有底框，不该跟着挨一刀
  assert.match(arena, /<\/span><\/b><span class="wipe-note">全歼 · 炮击战<\/span>/)
  assert.match(arena, /<\/span><\/span><span class="wipe-note">全歼 · 夜战<\/span>/)
  // 没被全歼的那一侧不多这一层
  assert.match(arena, /<b>第1舰队<\/b>/)
})

test('our own wiped fleet carries the same inner inline', () => {
  // 我方被全灭是同一处位置：横线画在标题栏的我方队名上
  const arena = renderArena(
    arenaBattleOf({
      fShips: [ship(0), ship(1)],
      eShips: [ship(0, { hpEnd: 40, sunk: false, defeated: false })],
      attacks: [attack(8, '夜战', [0, 1], { side: 1 })],
    }),
  )
  assert.match(arena, /<b class="wiped"><span class="wl">第1舰队<\/span><\/b>/)
  assert.match(arena, /<\/span><\/b><span class="wipe-note">全歼 · 夜战<\/span>/)
})
