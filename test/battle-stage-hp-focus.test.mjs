// 点住战斗流水某一阶段时，血条以**那一阶段的开局血**为基准。
//
// 老口径的虚条画的是整个昼/夜段累计掉的，玩家要先心算「这阶段之前已经扣到哪」才能
// 倒推本阶段输出，越靠后的阶段越难。改后条子读起来是三段：更早掉的（空轨，暗）、
// 这一阶段掉的（斜杠，聚焦时换蓝）、还剩的（实血，按战损档着色）。
//
// 跟随最新（默认视图）**一个像素都不动**：那一档仍是段内累计，见下面最后一条。
//
// 真报文取自 test/fixtures/battle-field-coverage.json 的对潜空袭那一场（账本本身不入仓），
// 里面正好有一条被分两个阶段打掉的敌舰。渲染侧把 di.ts 的编队一行原样切出来跑，
// 断言产物 HTML 上的三截宽度——**不断言源码文本**，基准取反了正则一条也拦不住。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import battleModule from '../dist/main/mg/battle.js'
import {
  battleOf,
  renderBrow,
  setSelectedLogStage,
  shipOf,
} from './fixtures/render-di-battle.mjs'

const { parseBattle } = battleModule

const load = (file) =>
  JSON.parse(fs.readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8'))
const pick = (name) => {
  const found = load('battle-field-coverage.json').find((one) => one.name === name)
  assert.ok(found, `fixture 里没有 ${name}`)
  return structuredClone(found)
}

const ctx = () => ({
  fleetShips: (deckId) =>
    Array.from({ length: 7 }, (_unused, i) => ({
      rosterId: deckId * 100 + i,
      mstId: deckId * 100 + i,
      name: `D${deckId}-${i + 1}`,
      lv: 1,
      nowHp: 50,
      maxHp: 50,
      equipments: [],
    })),
  masterName: (mstId) => `E${mstId}`,
  combinedType: () => 0,
})

const subAirRaid = () => {
  const one = pick('sortie-battle-sub-air-raid')
  return parseBattle(one.path, one.battle, ctx(), 0)
}

/** 血条那一格的三截宽度与 .bar 自己的类。 */
const barOf = (html) => {
  const cls = /<span class="(bar[^"]*)">/.exec(html)
  // 宽度带科学计数法（100 - a - b 的浮点残差会写成 1.42e-14%），别只收十进制小数
  const width = (selector) => {
    const found = new RegExp(`<span class="${selector}" style="width:([0-9.e+-]+)%"`).exec(html)
    return found ? Number(found[1]) : null
  }
  return {
    cls: cls ? cls[1] : null,
    solid: width('rm [a-z]+'),
    ghost: width('dl'),
    empty: width('dd'),
  }
}

const near = (actual, expected, note) =>
  assert.ok(
    actual != null && Math.abs(actual - expected) < 0.01,
    `${note}：${actual} ≉ ${expected}`,
  )

/** 三截按 hp 值断言，读起来就是「剩多少 / 这一阶段掉多少 / 更早掉多少」。 */
const assertBar = (html, hpMax, { remain, thisStage, earlier }, note) => {
  const bar = barOf(html)
  near(bar.solid, (remain / hpMax) * 100, `${note} 剩余`)
  near(bar.ghost, (thisStage / hpMax) * 100, `${note} 本阶段掉的`)
  near(bar.empty, (earlier / hpMax) * 100, `${note} 更早掉的`)
  near(bar.solid + bar.ghost + bar.empty, 100, `${note} 三截加起来`)
  return bar
}

test.afterEach(() => setSelectedLogStage(null))

// 这条敌舰（19 血）在真报文里被分两阶段打掉：开幕对潜 12、炮击 12（第二下溢出击沉），
// 中间的开幕雷击对它是 miss。19→7→7→0。
test('真报文：聚焦哪个阶段，血条就以那一阶段的开局血为基准', () => {
  const view = subAirRaid()
  const foe = view.eShips[1]
  assert.deepEqual(
    [foe.hpStart, foe.hpMax, foe.hpEnd],
    [19, 19, 0],
    '夹具换了的话下面这些数要跟着重算',
  )

  // 开幕对潜（stage 1）：这一阶段之前没挨过打，暗段为 0
  setSelectedLogStage(1)
  assertBar(renderBrow(view, 1, foe), 19, { remain: 7, thisStage: 12, earlier: 0 }, '开幕对潜')

  // 开幕雷击（stage 2）miss：本阶段掉 0，之前掉的 12 全归暗段
  setSelectedLogStage(2)
  assertBar(renderBrow(view, 1, foe), 19, { remain: 7, thisStage: 0, earlier: 12 }, '开幕雷击')

  // 炮击（stage 3）：开局 7、本阶段打掉这 7（伤害 12 溢出，条子按扣血画）、剩 0。
  // 老口径这里会画成整条斜杠（基准 19），玩家读不出「这一下打掉的是 7」
  setSelectedLogStage(3)
  assertBar(renderBrow(view, 1, foe), 19, { remain: 0, thisStage: 7, earlier: 12 }, '炮击')

  // 第一个阶段（航空战）它还没挨打：满条
  setSelectedLogStage(0)
  assertBar(renderBrow(view, 1, foe), 19, { remain: 19, thisStage: 0, earlier: 0 }, '航空战')
})

test('聚焦时虚条换蓝斜杠；跟随最新时仍是红斜杠', () => {
  const view = subAirRaid()
  const foe = view.eShips[1]
  // 配色写在 index.html 的 .mod-di .hpx .bar.pinned .dl 上，这里钉的是钩子有没有挂上
  assert.equal(barOf(renderBrow(view, 1, foe)).cls, 'bar', '跟随最新时不带 pinned')
  setSelectedLogStage(3)
  assert.equal(barOf(renderBrow(view, 1, foe)).cls, 'bar pinned')
})

test('打不到的那一位照旧跳过：聚焦也不给它画条', () => {
  const view = subAirRaid()
  const hidden = view.eShips[3]
  assert.equal(hidden.unattackable, true, '夹具里第 4 位就是 HP 非表示的那条')
  const before = renderBrow(view, 1, hidden)
  setSelectedLogStage(3)
  const after = renderBrow(view, 1, hidden)
  assert.equal(after, before, '空轨 +「打不到」，聚焦前后一个字都不该变')
  assert.match(after, /打不到/)
  assert.equal(/class="rm /.test(after), false, '实血那一截仍然不画')
})

test('跟随最新的默认视图不变：仍是昼/夜段累计，回到跟随最新后逐字节复原', () => {
  // 100 血的敌旗：昼战航空 20、昼战炮击 25、夜战 10。段的划分是昼/夜，不是每个阶段。
  const foe = { ...shipOf(0, '敌旗'), hpStart: 100, hpMax: 100, hpEnd: 45 }
  const strike = (stage, phase, damage) => ({
    side: 0,
    stage,
    action: 0,
    phase,
    hits: [{ target: 0, damage, repairItem: null }],
  })
  const view = battleOf({
    kind: 'night',
    hasNight: true,
    eShips: [foe],
    attacks: [strike(1, 'air', 20), strike(3, 'gun1', 25), strike(6, 'night', 10)],
  })

  // 跟随最新：虚条 = **夜战段**累计的 10，昼战掉的 45 归于空
  const followed = renderBrow(view, 1, foe)
  assertBar(followed, 100, { remain: 45, thisStage: 10, earlier: 45 }, '跟随最新')

  // 点住昼战炮击：基准换成那一阶段的开局 80，虚条只剩这一阶段的 25。
  // 老口径的基准是昼战段首（100），虚条会是 45——把航空战掉的 20 一起画进去
  setSelectedLogStage(3)
  assertBar(renderBrow(view, 1, foe), 100, { remain: 55, thisStage: 25, earlier: 20 }, '聚焦炮击')

  // 点住夜战那一阶段：这个夜战段里只有它一个阶段，两种基准正好重合
  setSelectedLogStage(6)
  assertBar(renderBrow(view, 1, foe), 100, { remain: 45, thisStage: 10, earlier: 45 }, '聚焦夜战')

  // 再点一次回到跟随最新：产物要与第一次逐字节相同（没有残留的 pinned 或旧基准）
  setSelectedLogStage(null)
  assert.equal(renderBrow(view, 1, foe), followed)
})
