// 战斗流水一行的版式优先级：双方舰名与伤害数字在前，行尾注记在后。
//
// 2026-08-26 用户拿截图定的口径——对空炮火那一行的
// 「对空CI 类型1 · 高角炮×2 · 电探 · 10cm連装高角砲改…」把整行挤到截断，
// 被挤掉的却是舰名和击坠数。改法两层：渲染这层把过长的注记收成短头、全文原样进悬停；
// 样式那层让舰名与伤害不收缩，挤起来只挤注记。
//
// 渲染断言对着产物 HTML（test/fixtures/render-di-battle.mjs 把 logHtml 原样切出来编译）。
// 「谁收缩」这一条只能对着样式表下断言——布局在这里跑不起来，而它写反了产物一个字都不变。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { airOf, battleOf, renderLog, shipOf, stageOf } from './fixtures/render-di-battle.mjs'

const html =
  fs.readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8') +
  fs.readFileSync(new URL('../src/renderer/assets/battle-replay.css', import.meta.url), 'utf8')

const LONG_NAME = '摩耶改二·特设防空舰'
const shipsNamed = (name) =>
  Array.from({ length: 12 }, (_, i) => shipOf(i, i === 0 ? name : `我舰${i + 1}`))

const aaLog = (air, patch = {}) =>
  renderLog(battleOf({ air, stages: [stageOf(0, '第一航空战', air)], ...patch }), true)

// 装备四件、种别 1 还带着装备条件：截图里那一行的形状
const LONG_CUTIN = {
  eLost2: 116,
  eCount2: 152,
  aaCutinIdx: 0,
  aaCutinKind: 1,
  aaCutinItems: [122, 122, 315, 316],
}

const attackOf = (patch = {}) => ({
  phase: 'night',
  side: 1,
  attacker: 0,
  ciType: null,
  ciKind: 'night',
  stage: 0,
  action: 0,
  stageLabel: '夜战',
  source: 'api_hougeki',
  simultaneous: false,
  hits: [
    {
      target: 0,
      damage: 42,
      critical: false,
      hitState: 'hit',
      miss: false,
      protect: false,
      sunk: false,
      repairItem: null,
    },
  ],
  ...patch,
})
const nightLog = (attack) =>
  renderLog(
    battleOf({
      stages: [stageOf(0, '夜战', null, { phase: 'night', source: 'api_hougeki' })],
      attacks: [attack],
    }),
    true,
  )

// ---- 过长的注记收成短头 ----

test('长注记：行内只留头一段，全文原样进悬停', () => {
  const out = aaLog(airOf(LONG_CUTIN))
  assert.match(out, /<span class="tag9 ci" title="[^"]*">对空CI 类型1…<\/span>/)
  // 收起来的那几段一段都不许还留在行内
  assert.ok(!out.includes('data-equip='), '装备列收起来了却还留在行内')
  assert.ok(!out.includes('对空CI 类型1 · 高角炮'), '装备条件收起来了却还留在行内')
  // 悬停给的就是数据本体：种别号 + 装备列，「·」分隔、逐字照原文
  assert.match(out, /title="对空CI 类型1 · 装备 #122 · 装备 #122 · 装备 #315 · 装备 #316\n/)
})

test('短注记不缩：撑得下就照旧全给，也不平白挂一个省略号', () => {
  const out = aaLog(
    airOf({ eLost2: 6, eCount2: 20, aaCutinIdx: 0, aaCutinKind: 5, aaCutinItems: [12] }),
  )
  assert.match(out, /对空CI 类型5 · <i data-equip="12"/)
  assert.ok(!out.includes('对空CI 类型5…'), '撑得下的注记不该被收')
})

test('注记再长，同一行的舰名与伤害仍逐字输出', () => {
  const out = aaLog(airOf(LONG_CUTIN), { fShips: shipsNamed(LONG_NAME) })
  assert.ok(out.includes(`<span class="who">${LONG_NAME}</span>`), '发动舰的名字被削了')
  assert.ok(out.includes('<span class="who foe">敌舰载机</span>'))
  assert.match(out, /<span class="dv">击坠 116 \/ 152<\/span>/)
})

// ---- 同一道闸门管住整族注记 ----

test('特殊攻击名：短的照旧全给，不挂悬停', () => {
  const out = nightLog(attackOf({ ciType: '弹着连击' }))
  assert.match(out, /<span class="tag9 ci">弹着连击<\/span>/)
})

test('特殊攻击名：长的按字收，全名进悬停', () => {
  const long = '鱼雷·桶·水雷见张CI（二击）·本地未收录的加长名'
  const out = nightLog(attackOf({ ciType: long }))
  assert.match(out, new RegExp(`<span class="tag9 ci" title="${long}">[^<]+…</span>`))
  assert.ok(!out.includes(`>${long}<`), '过长的特殊攻击名不该整条留在行内')
})

test('触接机型与机队编成：行内照旧，纯文字全名一并进悬停', () => {
  const air = airOf({ touchF: 102, touchE: 1501 })
  const out = renderLog(
    battleOf({
      air,
      stages: [
        stageOf(0, '第一航空战', air, {
          squadronPlanes: [
            { mstId: 22, count: 18 },
            { mstId: 23, count: 12 },
          ],
        }),
      ],
    }),
    true,
  )
  assert.match(out, /<span class="tag9" title="我触接 装备 #102 · 敌触接 装备 #1501">/)
  assert.match(out, /<span class="tag9 squadron" title="装备 #22×18 · 装备 #23×12">/)
  // 这一层本来就换行不截断，全名照旧摆在行内
  assert.match(out, /data-equip="102"/)
  assert.match(out, /data-equip="22"/)
})

test('成串的那几格（支援编成、夜间触接）留着收缩权，全文在悬停里', () => {
  const support = renderLog(
    battleOf({
      stages: [
        stageOf(0, '支援舰队', null, {
          phase: 'support',
          source: 'api_support_info',
          support: { deckId: 3, shipMstIds: [711, 3224, 4460, 2460] },
        }),
      ],
    }),
    true,
  )
  assert.match(support, /<span class="who list" title="[^"]*711[^"]*2460[^"]*">/)
  const night = renderLog(
    battleOf({
      nightContact: [102, 1501],
      stages: [stageOf(0, '夜战', null, { phase: 'night', source: 'api_hougeki' })],
    }),
    true,
  )
  assert.match(night, /<span class="who list" title="我方 #102 · 敌方 #1501">/)
})

// ---- 语义标记一枚都不许被截（2026-08-27） ----
//
// 用户截图的那一行：主力炮击第一轮 · 俾斯麦drei → 駆逐ラ級（初期型） · 163+315，
// 行尾本该挂着「弹着连击 ✦暴击 沉 装备详情」，窄面板下蓝色那一枚被挤成一个字宽。
// 账本里的原件（snapshot 857，ciType 2 / ciKind day）反推出被吃掉的是 DAY_CI[2]「弹着连击」。
// 改法：伤害数字与全部标记装进同一枚 .ltail，撑不下时整块折行、续行右对齐，一枚都不切。

const bismarckRow = () =>
  nightLog(
    attackOf({
      phase: 'gun1',
      side: 0,
      attacker: 3,
      ciType: '弹着连击',
      ciKind: 'day',
      stageLabel: '主力炮击第一轮',
      source: 'api_hougeki1',
      equipmentMstIds: [330, 330],
      hits: [
        {
          target: 0,
          damage: 163,
          critical: false,
          hitState: 'hit',
          miss: false,
          protect: false,
          sunk: false,
          repairItem: null,
        },
        {
          target: 0,
          damage: 315,
          critical: true,
          hitState: 'hit',
          miss: false,
          protect: false,
          sunk: true,
          repairItem: null,
        },
      ],
    }),
  )

test('截图那一行：四枚标记逐字都在，一枚都没被省略号吃掉', () => {
  const out = bismarckRow()
  assert.match(out, /<span class="dv">163\+315<\/span>/)
  assert.match(out, /<span class="tag9 ci">弹着连击<\/span>/)
  assert.match(out, /<span class="tag9 crit">✦暴击<\/span>/)
  assert.match(out, /<span class="tag9 sink">沉<\/span>/)
  assert.ok(out.includes('>装备详情</span>'), '装备详情那一枚不见了')
})

test('截图那一行：伤害数字与四枚标记装在同一枚 .ltail 里，折行时整块一起动', () => {
  const out = bismarckRow()
  const tail = /<span class="ltail">([\s\S]*?)<\/span><\/div>/.exec(out)
  assert.ok(tail, '逐击行没有 .ltail：折行的整块没了，标记会各自被挤')
  for (const piece of ['163+315', '弹着连击', '✦暴击', '沉', '装备详情'])
    assert.ok(tail[1].includes(piece), `${piece} 掉在 .ltail 外面`)
})

test('对空炮火那一行同一处理：击坠数与对空CI 同在一枚 .ltail 里', () => {
  const out = aaLog(airOf(LONG_CUTIN))
  assert.match(out, /<span class="ltail"><span class="dv">击坠 116 \/ 152<\/span><span class="tag9 ci"/)
})

/**
 * 取一条规则的**声明块本身**。
 * `选择器 \{[\s\S]*?某声明` 这种写法是假的：`{` 之后的惰性匹配会一路越过右花括号，
 * 在后面别家的规则里撞见那条声明也算数（第一版就这么写，doesNotMatch 当场翻车）。
 */
const ruleBody = (selector) => {
  const at = html.indexOf(`${selector} {`)
  assert.ok(at >= 0, `样式表里找不到 ${selector}，这条守卫的锚点要跟着改`)
  const open = html.indexOf('{', at)
  const close = html.indexOf('}', open)
  assert.ok(close > open, `${selector} 的声明块没有收尾`)
  return html.slice(open + 1, close)
}

test('版式：行尾整块肯让路，让的方式是折行不是截字', () => {
  // 行本身肯折行：撑不下时行尾整块下沉一行，而不是把标记挤出面板
  assert.match(ruleBody('.mod-di .lrow'), /flex-wrap: wrap/)
  // 整块靠右、可折行、续行右对齐
  const tail = ruleBody('.mod-di .lrow .ltail')
  assert.match(tail, /flex-wrap: wrap/)
  assert.match(tail, /justify-content: flex-end/)
  assert.match(tail, /margin-left: auto/)
  // 不给 min-width:0：缩到底也是自身 min-content，每一枚标记各自完整
  assert.doesNotMatch(tail, /min-width: 0/)
  // 收无可收的短标记（弹着连击）再不许被 ellipsis 吃到一个字宽
  const ci = ruleBody('.mod-di .lrow .tag9.ci')
  assert.doesNotMatch(ci, /text-overflow/)
  assert.doesNotMatch(ci, /white-space: nowrap/)
  assert.match(ci, /white-space: normal/)
  // 装备名壳子那层自带的 ellipsis 在这枚标记里也要让位，否则截字只是挪进了内层
  assert.match(ruleBody('.mod-di .lrow .tag9.ci .used-equip-link'), /text-overflow: clip/)
})

// ---- 版式：谁不收缩 ----

test('版式：舰名与伤害不收缩，肯让路的只有行尾注记', () => {
  assert.match(html, /\.mod-di \.lrow \.who \{[^}]*flex: none/)
  assert.match(html, /\.mod-di \.lrow \.dv \{[^}]*flex: none/)
  // 单词一枚的小标（暴击、沉、护卫）也不收——收了就是缺字
  assert.match(html, /\.mod-di \.lrow \.tag9 \{[^}]*flex: none/)
  // 长注记那一枚是整行唯一收缩的一段
  assert.match(html, /\.mod-di \.lrow \.tag9\.ci \{[\s\S]*?flex: 0 1 auto/)
  assert.match(html, /\.mod-di \.lrow \.who\.list \{[^}]*flex: 0 1 auto/)
  // 舰名那一格不再自己截断：收缩权整个交给了注记
  assert.doesNotMatch(html, /\.mod-di \.lrow \.who \{[^}]*text-overflow/)
})
