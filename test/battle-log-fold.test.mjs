// 战斗流水的阶段折叠：**默认全展开**，折叠只是玩家当场的收纳动作。
//
// 敌我联合 + 友军 + 多波陆航的一场，流水能有几十行；用户 2026-08-26 拍板给它加收纳，
// 但明说「默认全展开、不改变现状阅读」。所以这份护栏钉两头：
// ① 默认渲染时每个阶段的内容都在场（防止哪天默认被改成折叠）；
// ② 折起来的那个阶段确实只剩段头，别的阶段一行不少。
//
// 断言对着产物 HTML（fixtures/render-di-battle.mjs 把 logHtml 原样切出来编译），
// 不断言源码文本——「折叠判断写反」正则一条也拦不住。
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  battleOf,
  collapsedLogStages,
  renderLog,
  stageOf,
} from './fixtures/render-di-battle.mjs'

const attackOf = (stage, stageLabel, phase, target, damage, action) => ({
  phase,
  side: 0,
  attacker: 0,
  ciType: null,
  ciKind: phase === 'night' ? 'night' : 'day',
  stage,
  action,
  stageLabel,
  source: 'api_hougeki',
  simultaneous: false,
  hits: [
    {
      target,
      damage,
      critical: false,
      hitState: 'hit',
      miss: false,
      protect: false,
      sunk: false,
      repairItem: null,
    },
  ],
})

// 三段：陆航一波、夜战、友军。每段各带两击，好看出「折起来的那段少了两行」。
const threeStageBattle = () =>
  battleOf({
    hasNight: true,
    stages: [
      stageOf(0, '第2基地第1波', null, { phase: 'lbas' }),
      stageOf(1, '夜战', null, { phase: 'night' }),
      stageOf(2, '友军舰队', null, { phase: 'friendly' }),
    ],
    attacks: [
      attackOf(0, '第2基地第1波', 'lbas', 0, 11, 0),
      attackOf(0, '第2基地第1波', 'lbas', 1, 12, 1),
      attackOf(1, '夜战', 'night', 2, 13, 2),
      attackOf(1, '夜战', 'night', 3, 14, 3),
      attackOf(2, '友军舰队', 'friendly', 4, 15, 4),
      attackOf(2, '友军舰队', 'friendly', 5, 16, 5),
    ],
  })

const rowCount = (html) => (html.match(/class="lrow/g) ?? []).length
const foldHeads = (html) => [...html.matchAll(/data-log-fold="(\d+)"/g)].map((m) => m[1])

test.afterEach(() => collapsedLogStages.clear())

test('默认全展开：三个阶段的段头都在，六条流水一条不少', () => {
  const html = renderLog(threeStageBattle(), true)
  assert.deepEqual(foldHeads(html), ['0', '1', '2'], '每个阶段都该有一枚折叠头')
  assert.equal(rowCount(html), 6, '默认不该折起任何一段')
  // 箭头朝下 = 展开；一个 ▸ 都不该有
  assert.equal((html.match(/▾/g) ?? []).length, 3)
  assert.ok(!html.includes('▸'))
  assert.ok(html.includes('aria-expanded="true"'))
  assert.ok(!html.includes('aria-expanded="false"'))
  // 段名照搬阶段自己的 label，零新增文案
  for (const label of ['第2基地第1波', '夜战', '友军舰队']) assert.ok(html.includes(label))
})

test('折起一段只影响那一段：它只剩段头，别的阶段一行不少', () => {
  collapsedLogStages.add(1)
  const html = renderLog(threeStageBattle(), true)
  assert.deepEqual(foldHeads(html), ['0', '1', '2'], '折起来的段头本身必须还在')
  assert.equal(rowCount(html), 4, '夜战那两行该收起来，其余四行留着')
  assert.equal((html.match(/▸/g) ?? []).length, 1)
  assert.equal((html.match(/▾/g) ?? []).length, 2)
  assert.ok(html.includes('aria-expanded="false"'))
  // 收起的是夜战段：它那两击的伤害数不该再出现，别段的还在
  assert.ok(!html.includes('>13<') && !html.includes('>14<'))
  assert.ok(html.includes('>11<') && html.includes('>15<'))
})

test('折叠是按阶段记的，两段各折各的', () => {
  collapsedLogStages.add(0)
  collapsedLogStages.add(2)
  const html = renderLog(threeStageBattle(), true)
  assert.equal(rowCount(html), 2, '只剩夜战那两行')
  assert.equal((html.match(/▸/g) ?? []).length, 2)
  assert.ok(html.includes('>13<') && html.includes('>14<'))
})

test('清空折叠集合就回到全展开——换一场战斗走的就是这一步', () => {
  collapsedLogStages.add(0)
  collapsedLogStages.add(1)
  collapsedLogStages.add(2)
  assert.equal(rowCount(renderLog(threeStageBattle(), true)), 0)
  collapsedLogStages.clear()
  assert.equal(rowCount(renderLog(threeStageBattle(), true)), 6)
})

test('每一行仍然是时间轴锚点：折叠头没把 data-log-stage 挤掉', () => {
  const html = renderLog(threeStageBattle(), true)
  assert.equal((html.match(/data-log-stage="/g) ?? []).length, 6)
})

test('友军段里敌方反击那一行，挨打的写友军舰不写我方舰', () => {
  // 友军夜战段我方全程旁观：友军(2)打敌(1)、敌(1)反击友军(2)。
  // 照通则「敌攻必打我方」写，这一行会点名我方同舰位的舰娘——伤害数字对着，名字是错的。
  const html = renderLog(
    battleOf({
      hasNight: true,
      friendShips: [{ index: 0, name: '友军旗舰', mstId: 553, hpMax: 78 }],
      fShips: [{ index: 0, name: '我方旗舰', mstId: 100, hpMax: 50 }],
      stages: [stageOf(0, '友军舰队', null, { phase: 'friendly' })],
      attacks: [{ ...attackOf(0, '友军舰队', 'friendly', 0, 42, 0), side: 1 }],
    }),
    true,
  )
  assert.ok(html.includes('友军旗舰'), '挨打的是友军舰')
  assert.ok(!html.includes('我方旗舰'), '我方舰队在友军段里一下都没挨打')
})
