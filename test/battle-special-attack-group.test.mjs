// 战斗流水里，同一次特殊攻击的几段收成一个组。
//
// 2026-08-27 用户按截图定的口径——「特殊攻击的步骤可不可以做个『打包』，
// 现在是分开显示的，好像不太明显」。截图里大和改二重那一次两舰齐射摊成两行，
// 两行各挂一枚同名的「大和两舰齐射」。
//
// 改法：组头亮一次名字，成员行不再重复那枚标，靠缩进与一条竖线归拢。
// 分组认的是**解析层的真结构**：一次特攻在报文里本是一个攻击单元携带多段伤害
//（api_damage[i] 是数组），解析层照 shared 的分段表把它摊成逐段记录——摊出来的段
// 除了「谁打谁、打掉多少」之外完全同源（同阶段同侧同 ciType、action 连号、各带一击、
// si_list 同一份）。**不看行文字**：同一轮里两条舰各自弹着连击，文字判据会当场错认。
//
// 断言对着产物 HTML（fixtures/render-di-battle.mjs 把 logHtml 原样切出来编译），
// 不断言源码文本——「上限写反」「判据缺一条」正则一条也拦不住。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { battleOf, renderLog, shipOf, stageOf } from './fixtures/render-di-battle.mjs'

const html =
  fs.readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8') +
  fs.readFileSync(new URL('../src/renderer/assets/battle-replay.css', import.meta.url), 'utf8')

// 账本里那一场：62-5，大和改二重两舰齐射，620 打沉駆逐ロ級、1089 落在泊地水鬼身上。
const OURS = ['大和改二重', '武蔵改二', '俾斯麦drei']
const THEIRS = ['駆逐ロ級', '泊地水鬼']

const fleets = {
  fShips: Array.from({ length: 12 }, (_, i) => shipOf(i, OURS[i] ?? `我舰${i + 1}`)),
  eShips: Array.from({ length: 6 }, (_, i) => shipOf(i, THEIRS[i] ?? `敌舰${i + 1}`)),
}

const hitOf = (target, damage, patch = {}) => ({
  target,
  damage,
  critical: false,
  hitState: 'hit',
  miss: false,
  protect: false,
  sunk: false,
  repairItem: null,
  ...patch,
})

/** 主力炮击第一轮的一条记录。逐段特攻就是「一条记录一击」的那种形状。 */
const shotOf = (action, patch = {}) => ({
  phase: 'gun1',
  side: 0,
  attacker: 0,
  ciType: null,
  ciKind: 'day',
  stage: 0,
  action,
  stageLabel: '主力炮击第一轮',
  source: 'api_hougeki1',
  simultaneous: false,
  equipmentMstIds: [330, 330],
  hits: [hitOf(0, 100)],
  ...patch,
})

const gunLog = (attacks) =>
  renderLog(
    battleOf({
      ...fleets,
      stages: [stageOf(0, '主力炮击第一轮', null, { phase: 'gun1', source: 'api_hougeki1' })],
      attacks,
    }),
    true,
  )

/** 截图那一次：两段摊成两条记录，action 连号，各带一击。 */
const yamatoTouch = () => [
  shotOf(0, { ciType: 401, hits: [hitOf(0, 620, { sunk: true })] }),
  shotOf(1, { ciType: 401, attacker: 1, hits: [hitOf(1, 1089, { critical: true })] }),
]

/**
 * 取出每一个 `<div class="lgrp">` 的整块。
 * 按 `<div>`/`</div>` 配平数走——惰性正则找不到真边界：组尾那三个连着的 `</div>`
 * 里，头一个是最后一条成员行自己的，`[\s\S]*?</div></div>` 会当场停错地方。
 */
const groupBlocks = (out) => {
  const blocks = []
  const open = /<div class="lgrp">/g
  let start
  while ((start = open.exec(out))) {
    const tag = /<div\b|<\/div>/g
    tag.lastIndex = start.index
    let depth = 0
    let t
    while ((t = tag.exec(out))) {
      depth += t[0] === '</div>' ? -1 : 1
      if (depth === 0) {
        blocks.push(out.slice(start.index, t.index + t[0].length))
        break
      }
    }
  }
  return blocks
}

const countOf = (text, needle) => text.split(needle).length - 1

// ---- ① 组内徽章只出现一次 ----

test('两舰齐射：两段收成一组，特攻名只在组头亮一次', () => {
  const out = gunLog(yamatoTouch())
  const blocks = groupBlocks(out)
  assert.equal(blocks.length, 1, '两段特攻没有收成一组')
  // 整份流水里这枚标只此一枚：成员行不再各挂一份
  assert.equal(countOf(out, '大和两舰齐射'), 1, '特攻名还在逐行重复')
  // 组头就是亮标的那一行：段名 + 那枚标，走的还是既有的 tag9.ci
  assert.match(
    blocks[0],
    /^<div class="lgrp"><div [^>]*class="lrow lgrp-h"><span class="ph gun1"[^>]*>主力炮击第一轮<\/span><span class="tag9 ci">大和两舰齐射<\/span><\/div><div class="lgrp-b">/,
    '组头的形状不对：段名与特攻名该在同一枚组头上',
  )
  // 名字照旧出自 shared 那张表，一个字都没新造
  assert.ok(!out.includes('特殊攻击'), '组头写了玩家没见过的新措辞')
})

// ---- ② 成员行的伤害与击沉标记齐全 ----

test('两舰齐射：两段各自的攻击者→目标、伤害、暴击与击沉一样不少', () => {
  const block = groupBlocks(gunLog(yamatoTouch()))[0]
  assert.equal(countOf(block, 'class="lrow'), 3, '组里该是一枚组头 + 两条成员行')
  for (const piece of ['大和改二重', '駆逐ロ級', '620', '武蔵改二', '泊地水鬼', '1089'])
    assert.ok(block.includes(piece), `成员行少了「${piece}」`)
  assert.match(block, /<span class="tag9 sink">沉<\/span>/)
  assert.match(block, /<span class="tag9 crit">✦暴击<\/span>/)
  // 伤害与其余标记照旧同在一枚 .ltail 里（72c7072 的折行方案，成组之后不许打散）
  assert.match(block, /<span class="ltail"><span class="dv">620<\/span><span class="tag9 sink">/)
})

test('成员行仍是时间轴锚点，组头点起来与组里任何一行同效', () => {
  const block = groupBlocks(gunLog(yamatoTouch()))[0]
  // 组头 + 两条成员行，三个锚点都指向同一阶段
  assert.equal(countOf(block, 'data-log-stage="0"'), 3, '组里有行丢了回放锚点')
  assert.equal(countOf(block, 'data-act="log-stage"'), 3)
})

test('成员行不再逐行重复段名：段名只留在组头上', () => {
  const out = gunLog(yamatoTouch())
  // 「主力炮击第一轮」该只出现两次：阶段折叠头一次、组头一次。
  // 成员行各留一枚段名的话这里就是四次。
  assert.equal(countOf(out, '主力炮击第一轮'), 2, '成员行还带着自己的段名')
})

// ---- ③ 普通炮击完全不受影响 ----

test('普通炮击不分组：没有特攻标记的行照旧各自成行、各带段名', () => {
  const out = gunLog([shotOf(0, { hits: [hitOf(0, 163)] }), shotOf(1, { hits: [hitOf(1, 315)] })])
  assert.equal(groupBlocks(out).length, 0, '普通炮击被打包了')
  assert.equal(countOf(out, '<span class="ph gun1"'), 2, '普通行的段名不该被动')
})

test('同一阶段里特攻成组、普通行照旧：组在普通行之前收口，互不牵连', () => {
  const out = gunLog([
    ...yamatoTouch(),
    shotOf(2, { attacker: 2, hits: [hitOf(1, 163)] }), // 俾斯麦drei 的普通炮击
  ])
  const blocks = groupBlocks(out)
  assert.equal(blocks.length, 1)
  assert.ok(!blocks[0].includes('俾斯麦drei'), '普通炮击被卷进了特攻组')
  assert.ok(out.indexOf('俾斯麦drei') > out.indexOf(blocks[0]) + blocks[0].length - 1)
  // 组外那一行照旧带段名：整份流水里段名两次（阶段折叠头、组头）之外还有它这一枚
  assert.equal(countOf(out, '主力炮击第一轮'), 3)
})

// ---- ④ 单段特攻不做组 ----

test('单段特攻维持现状：一行带标，不平白多一枚组头', () => {
  const out = gunLog([shotOf(0, { ciType: 401, hits: [hitOf(0, 620, { sunk: true })] })])
  assert.equal(groupBlocks(out).length, 0, '只有一段也被打包了')
  // 标还在行尾那一块里，段名也还在行上
  assert.match(out, /<span class="ltail"><span class="dv">620<\/span><span class="tag9 ci">大和两舰齐射<\/span>/)
  assert.equal(countOf(out, '<span class="ph gun1"'), 1)
})

test('一条记录多击但同目标：照旧合成一行 620+1089，仍不成组', () => {
  const out = gunLog([shotOf(0, { ciType: 401, hits: [hitOf(0, 620), hitOf(0, 1089)] })])
  assert.equal(groupBlocks(out).length, 0)
  assert.match(out, /<span class="dv">620\+1089<\/span>/)
  assert.equal(countOf(out, '大和两舰齐射'), 1)
})

// ---- 判据的边界：靠结构，不靠文字 ----

test('分段表里没登记的特攻（201 海空立体攻击）：一条记录打两个目标，照样成组', () => {
  // 这一族解析层根本不摊，多段留在同一条记录里，由 byTarget 拆出多行——
  // 判「是不是特攻」认的是名字表，不是分段表，所以它也该收成一组。
  const out = gunLog([shotOf(0, { ciType: 201, hits: [hitOf(0, 214), hitOf(1, 178)] })])
  const blocks = groupBlocks(out)
  assert.equal(blocks.length, 1, '未摊开的特攻多目标时没有收成一组')
  assert.equal(countOf(out, '海空立体攻击'), 1, '这一族的标还在逐行重复')
  assert.equal(countOf(blocks[0], 'class="lrow'), 3)
})

test('同一族特攻发动两次：按分段表的段数封顶，不并成一个大组', () => {
  // 401 的分段表是 [0,0,1]，一次最多三段。连着来六段就是两次，各成各的组。
  const out = gunLog(
    Array.from({ length: 6 }, (_, i) =>
      shotOf(i, { ciType: 401, attacker: i % 3, hits: [hitOf(i % 2, 100 + i)] }),
    ),
  )
  const blocks = groupBlocks(out)
  assert.equal(blocks.length, 2, '六段该是两次特攻，不是一个大组')
  for (const block of blocks) assert.equal(countOf(block, 'class="lrow'), 4, '每组三段 + 一枚组头')
  assert.equal(countOf(out, '大和两舰齐射'), 2, '两次特攻该各亮一次名字')
})

test('action 不连号就不是同一次：中间隔了一击的两段各自单行', () => {
  const out = gunLog([
    shotOf(0, { ciType: 401, hits: [hitOf(0, 620)] }),
    shotOf(2, { ciType: 401, hits: [hitOf(1, 1089)] }),
  ])
  assert.equal(groupBlocks(out).length, 0, 'action 断了还当成同一次特攻')
  assert.equal(countOf(out, '大和两舰齐射'), 2)
})

test('敌我两侧各自的特攻不并组：结构判据把侧别也算进去', () => {
  const out = gunLog([
    shotOf(0, { ciType: 401, hits: [hitOf(0, 620)] }),
    shotOf(1, { ciType: 401, side: 1, hits: [hitOf(0, 88)] }),
  ])
  assert.equal(groupBlocks(out).length, 0, '两侧的特攻被并成了一组')
})

test('装备不同就不是同一个攻击单元：si_list 是分组判据的一条腿', () => {
  const out = gunLog([
    shotOf(0, { ciType: 401, hits: [hitOf(0, 620)] }),
    shotOf(1, { ciType: 401, equipmentMstIds: [331], hits: [hitOf(1, 1089)] }),
  ])
  assert.equal(groupBlocks(out).length, 0, '同一次特攻的几段本该共用同一份 si_list')
})

// ---- 版式 ----

/**
 * 取一条规则的**声明块本身**（写法出处见 battle-log-note-fold.test.mjs：
 * `选择器 \{[\s\S]*?某声明` 会一路越过右花括号，在别家规则里撞见也算数）。
 */
const ruleBody = (selector) => {
  const at = html.indexOf(`${selector} {`)
  assert.ok(at >= 0, `样式表里找不到 ${selector}，这条守卫的锚点要跟着改`)
  const open = html.indexOf('{', at)
  const close = html.indexOf('}', open)
  assert.ok(close > open, `${selector} 的声明块没有收尾`)
  return html.slice(open + 1, close)
}

test('版式：成员行靠既有的那枚线色归拢，一个新颜色都不加', () => {
  const body = ruleBody('.mod-di .lgrp-b')
  assert.match(body, /border-left: 1px solid var\(--line-soft\)/)
  assert.doesNotMatch(body, /#[0-9a-fA-F]{3}/, '分组用上了新颜色')
  assert.match(body, /padding-left/, '成员行没有缩进，组就看不出来了')
  // 组头与它下面的成员之间不再横一道分隔线，一组才像一块
  assert.match(ruleBody('.mod-di .lrow.lgrp-h'), /border-bottom: 0/)
})

test('版式：组头仍是一条 .lrow，特攻名照旧走折行不截字那一枚样式', () => {
  // 组头挂 .lrow，所以 72c7072 定下的 .lrow .tag9.ci（折行、不 ellipsis）原样管着它
  const block = groupBlocks(gunLog(yamatoTouch()))[0]
  assert.match(block, /class="lrow lgrp-h"/)
  const ci = ruleBody('.mod-di .lrow .tag9.ci')
  assert.match(ci, /white-space: normal/)
  assert.doesNotMatch(ci, /text-overflow/)
})
