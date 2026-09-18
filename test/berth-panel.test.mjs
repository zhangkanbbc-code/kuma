// 锐 · 泊地修理页的产物 HTML。
//
// 上一份（berth-repair.test.mjs）钉的是判据本身，这一份钉的是「判据有没有被接对」：
// 覆盖位次算错、估算的三个前提少判一个、停摆态被漏掉、空态说错话——
// 那些都不会让上一份变红，只会让界面悄悄错。
//
// 页签顺序也在这里验：对着**真产物**看「泊地修理」落在「沙盘」后面，
// 而不是去数源码里两个函数谁写在前面。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  AKASHI,
  DD,
  NOZAKI,
  NOZAKI_KAI,
  renderBerth,
  renderBerthHead,
  renderFleetFatigue,
  renderTabs,
  reset,
} from './fixtures/render-ru-berth.mjs'

const MIN = 60_000
const ago = (minutes) => Date.now() - minutes * MIN

/** 一支明石改当旗舰的队。`facilities` 给旗舰塞几个艦艇修理施設。 */
const akashiFleet = ({ id = 1, facilities = 0, since, mission, followers = [] } = {}) => ({
  id,
  since,
  mission,
  ships: [
    { id: 100 + id, spec: AKASHI, nowhp: 45, maxhp: 45, facilities },
    ...followers.map((f, i) => ({ id: 200 + id * 10 + i, spec: DD, ...f })),
  ],
})

/** 一艘缺 2 点、入渠 22 分的随伴（每点 11 分，算例见 berth-repair.test.mjs）。 */
const HURT_A_BIT = { nowhp: 38, maxhp: 40, ndockTime: 22 * MIN }

// ---- ① 空态 ----

test('一支工作舰旗舰都没有时，只说状态，不解释机制', () => {
  reset({ fleets: [{ id: 1, ships: [{ id: 101, spec: DD, nowhp: 40, maxhp: 40 }] }] })
  const html = renderBerth()
  assert.match(html, /暂无工作舰或给粮舰编队/)
  // 空态只说状态：不许顺手把「泊地修理是什么」在这儿讲一遍
  assert.ok(!html.includes('20 分'), '空态在解释机制')
  assert.ok(!html.includes('入渠'), '空态在解释机制')
  assert.ok(!html.includes('预估'))
  assert.ok(!/。/.test(html), '空态里出现了句号')
})

test('旗舰不是工作舰的队根本不进这一页', () => {
  reset({
    fleets: [
      { id: 1, ships: [{ id: 101, spec: DD, nowhp: 20, maxhp: 40 }] },
      // 明石在 2 号位不算——机制要的是**旗舰**
      { id: 2, ships: [
        { id: 201, spec: DD, nowhp: 40, maxhp: 40 },
        { id: 202, spec: AKASHI, nowhp: 45, maxhp: 45 },
      ] },
    ],
  })
  assert.match(renderBerth(), /暂无工作舰或给粮舰编队/)
})

// ---- ② 覆盖范围点亮到几号位 ----

test('不带施設只覆盖到 2 号舰，3 号往后标「范围外」', () => {
  reset({
    fleets: [akashiFleet({
      facilities: 0,
      since: ago(30),
      followers: [HURT_A_BIT, HURT_A_BIT, HURT_A_BIT],
    })],
  })
  const html = renderBerth()
  const rows = [...html.matchAll(/data-berth-pos="(\d+)"[^]*?class="bt-tag ([^"]+)"/g)]
  assert.equal(rows.length, 4)
  assert.equal(rows[0][2], 's-full') // 1 号位是满血的明石改
  assert.equal(rows[1][2], 's-repairing') // 2 号位在覆盖内
  assert.equal(rows[2][2], 'out') // 3 号位出界
  assert.equal(rows[3][2], 'out')
  assert.match(html, /覆盖 2 艘/)
})

test('每多一个艦艇修理施設就多点亮一位', () => {
  reset({
    fleets: [akashiFleet({
      facilities: 2,
      since: ago(30),
      followers: [HURT_A_BIT, HURT_A_BIT, HURT_A_BIT, HURT_A_BIT],
    })],
  })
  const html = renderBerth()
  const rows = [...html.matchAll(/data-berth-pos="(\d+)"[^]*?class="bt-tag ([^"]+)"/g)]
  // 2 个施設 → 覆盖 4 艘：1..4 在内，5 出界
  assert.equal(rows[3][2], 's-repairing')
  assert.equal(rows[4][2], 'out')
  assert.match(html, /覆盖 4 艘/)
})

test('覆盖数不会报得比队里的人还多', () => {
  reset({ fleets: [akashiFleet({ facilities: 4, since: ago(30), followers: [HURT_A_BIT] })] })
  assert.match(renderBerth(), /覆盖 2 艘/, '队里只有 2 个人，就不该说覆盖 6 艘')
})

// ---- ③ 逐舰短标 ----

test('四种处境各挂各的短标，没有长句', () => {
  reset({
    fleets: [akashiFleet({
      facilities: 4,
      since: ago(30),
      followers: [
        HURT_A_BIT, // 在修
        { nowhp: 40, maxhp: 40 }, // 满血
        { nowhp: 20, maxhp: 40, ndockTime: 60 * MIN }, // 正好 50%：中破
        { nowhp: 30, maxhp: 40, ndockTime: 30 * MIN }, // 入渠中
      ],
    })],
    docked: [213], // 第 4 位随伴（id 见 akashiFleet 的编号规则）
  })
  const html = renderBerth()
  const tags = [...html.matchAll(/class="bt-tag [^"]*">([^<]*)</g)].map((m) => m[1])
  assert.deepEqual(tags, ['耐久已满', '修理中', '耐久已满', '中破', '入渠'])
  for (const tag of tags) assert.ok(tag.length <= 4, `短标「${tag}」太长了`)
})

// ---- ④ 20 分钟前后 ----

test('不满 20 分钟：报还差几分 + 一根预热条，一个预估都不出现', () => {
  reset({ fleets: [akashiFleet({ facilities: 1, since: ago(8), followers: [HURT_A_BIT] })] })
  const html = renderBerth()
  assert.match(html, /缺 12 分/)
  assert.match(html, /class="bt-bar"/)
  assert.ok(!html.includes('停泊'))
  assert.ok(!html.includes('预估'), '预热期不许报预估')
  assert.ok(!/\+\d/.test(html), '预热期不许报回复量')
})

test('过了 20 分钟：报停泊多少分，预估带「预估」二字', () => {
  reset({ fleets: [akashiFleet({ facilities: 1, since: ago(22), followers: [HURT_A_BIT] })] })
  const html = renderBerth()
  assert.match(html, /停泊 22 分/)
  // 缺 2 点、入渠 22 分 → 每点 11 分 → 22 分回 2 点
  assert.match(html, /<b>\+2<\/b><em>预估<\/em>/)
  assert.ok(!html.includes('还差'))
})

test('预估只给真在修的那几艘：满血、中破、入渠、范围外都不给', () => {
  reset({
    fleets: [akashiFleet({
      facilities: 0, // 只覆盖到 2 号位
      since: ago(60),
      followers: [
        { nowhp: 40, maxhp: 40, ndockTime: 0 }, // 2 号位满血
        HURT_A_BIT, // 3 号位在范围外
      ],
    })],
  })
  const html = renderBerth()
  assert.ok(!html.includes('预估'), '没有一艘该拿到预估')
})

test('没有锚点就什么都不报，不拿开机时刻顶替', () => {
  // since 缺席 = 本机没观测到过这支队的归零点
  reset({ fleets: [akashiFleet({ facilities: 1, followers: [HURT_A_BIT] })] })
  const html = renderBerth()
  assert.match(html, /计时未知/)
  assert.ok(!html.includes('停泊'))
  assert.ok(!html.includes('还差'))
  assert.ok(!html.includes('预估'))
})

// ---- ⑤ 整队停摆 ----

test('远征中只说远征中，不报计时也不报预估', () => {
  reset({
    fleets: [akashiFleet({
      facilities: 1,
      since: ago(90),
      mission: [1, 5, Date.now() + MIN, 0],
      followers: [HURT_A_BIT],
    })],
  })
  const html = renderBerth()
  assert.match(html, /远征中/)
  assert.ok(!html.includes('停泊'))
  assert.ok(!html.includes('预估'))
})

test('旗舰中破 / 旗舰在渠：停摆态各说各的，队照样列出来', () => {
  reset({
    fleets: [{
      id: 1,
      since: ago(90),
      ships: [
        { id: 101, spec: AKASHI, nowhp: 20, maxhp: 45, ndockTime: 60 * MIN, facilities: 1 },
        { id: 201, spec: DD, ...HURT_A_BIT },
      ],
    }],
  })
  let html = renderBerth()
  assert.match(html, /旗舰中破/)
  assert.ok(!html.includes('预估'), '旗舰中破时整队不执行修理')
  // 队还在，不能因为停摆就把整块藏起来
  assert.match(html, /明石改/)

  reset({
    fleets: [akashiFleet({ facilities: 1, since: ago(90), followers: [HURT_A_BIT] })],
    docked: [101],
  })
  html = renderBerth()
  assert.match(html, /旗舰在渠/)
  assert.ok(!html.includes('预估'))
})

// ---- ⑥ 页签落位 ----

test('「泊地修理与恢复」页签排在「沙盘」之后', () => {
  reset({ fleets: [akashiFleet({ facilities: 1, since: ago(30), followers: [HURT_A_BIT] })] })
  const tabs = renderTabs(1)
  const sandbox = tabs.indexOf('沙盘')
  const berth = tabs.indexOf('泊地修理与恢复')
  const air = tabs.indexOf('基地航空队')
  assert.ok(air >= 0 && sandbox > air, '基地航空队 → 沙盘 的既有顺序被动了')
  assert.ok(berth > sandbox, '泊地修理与恢复必须排在沙盘之后')
})

test('页签自己报有几支队在修；一支都没有时不挂数字', () => {
  reset({ fleets: [akashiFleet({ facilities: 1, since: ago(30), followers: [HURT_A_BIT] })] })
  assert.match(renderTabs(1), /泊地修理与恢复<span class="t">1队<\/span>/)
  reset({ fleets: [{ id: 1, ships: [{ id: 101, spec: DD, nowhp: 40, maxhp: 40 }] }] })
  const tabs = renderTabs(1)
  assert.match(tabs, /泊地修理与恢复<\/div>/)
  assert.ok(!/泊地修理与恢复<span/.test(tabs))
})

test('点开这一页时页签挂 on', () => {
  reset({ fleets: [akashiFleet({ facilities: 0, since: ago(30) })] })
  assert.match(renderTabs(-2), /class="ftab berth on"/)
  assert.ok(!/class="ftab berth on"/.test(renderTabs(1)))
})

// ---- ⑦ 文案纪律 ----

test('机制解说一个字不进 UI，悬停也不进（口径角标已判同病拔除）', () => {
  const head = renderBerthHead()
  // 抬头只有名字：没有角标、没有任何 title 悬停
  assert.match(head, /<b>泊地修理与恢复<\/b>/)
  assert.ok(!head.includes('credit-mark'), '口径角标回潮了')
  assert.ok(!head.includes('title='), '抬头不许挂悬停')
  reset({
    fleets: [akashiFleet({ facilities: 1, since: ago(30), followers: [HURT_A_BIT] })],
  })
  const body = renderBerth()
  assert.ok(!body.includes('落账'), '机制解说漏进了正文')
  assert.ok(!body.includes('入渠速度'))
  assert.ok(!body.includes('推算'))
})

test('页上没有句号，也没有免责与常识复述', () => {
  reset({
    fleets: [akashiFleet({ facilities: 2, since: ago(45), followers: [HURT_A_BIT, HURT_A_BIT] })],
  })
  const text = renderBerth().replace(/<[^>]*>/g, ' ')
  assert.ok(!/。/.test(text), `出现了句号：${text}`)
  for (const banned of ['仅供参考', '不代表', '请以', '为准', '可能', '注意']) {
    assert.ok(!text.includes(banned), `出现了防守性文案「${banned}」`)
  }
})

// ---- ⑧ 样式真在样式表里 ----

test('这一页的样式真在样式表里', () => {
  // 上面那些断言看的是「类挂对了没有」，一个都答不上「这些类有没有样式」。
  // 整段 CSS 漏了或被误删，产物 HTML 一模一样。
  const html = fs.readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8')
  for (const sel of [
    '.fleet-skin .bt-fleet {',
    '.fleet-skin .bt-ship {',
    '.fleet-skin .bt-ship.out {',
    '.fleet-skin .bt-tag.s-repairing {',
    '.fleet-skin .bt-gain {',
    '.fleet-skin .bt-cond {',
    '.fleet-skin .bt-bar {',
    '.fleet-skin .bt-empty {',
    '.fleet-skin .ftab.berth .d.berth-on {',
  ]) {
    assert.ok(html.includes(sel), `样式没了：${sel}`)
  }
})

// ---- ⑧ 明石队自己出海（2026-08-26 用户指出的缺口）----

test('出击中的明石队：计时格改报出击中、预估暂停；计时本身不清零，演习与别队出击不受影响', () => {
  const fleet = () => akashiFleet({ facilities: 1, since: ago(30), followers: [HURT_A_BIT] })
  reset({
    fleets: [fleet()],
    sortie: { active: true, practice: false, deckId: 1, mapArea: 3, mapNo: 5 },
  })
  const body = renderBerth()
  assert.match(body, /出击中/)
  assert.ok(!body.includes('停泊'), '出海时不许摆停泊分钟数')
  assert.ok(!body.includes('预估'), '出海时账面 HP 是旧值，预估必须暂停')

  // 演习没出海：照常计时
  reset({
    fleets: [fleet()],
    sortie: { active: true, practice: true, deckId: 1, mapArea: 0, mapNo: 0 },
  })
  assert.match(renderBerth(), /停泊 30 分/)

  // 出击的是别的队：明石队照常
  reset({
    fleets: [fleet()],
    sortie: { active: true, practice: false, deckId: 2, mapArea: 3, mapNo: 5 },
  })
  assert.match(renderBerth(), /停泊 30 分/)
})

// ---- ⑨ 给粮舰卡 ----

const provisionFleet = ({
  id = 1,
  spec = NOZAKI,
  since,
  mission,
  flag = {},
  followers = [],
} = {}) => ({
  id,
  since,
  mission,
  ships: [
    { id: 100 + id, spec, nowhp: 40, maxhp: 40, cond: 30, ...flag },
    ...followers.map((f, i) => ({ id: 200 + id * 10 + i, spec: DD, nowhp: 40, maxhp: 40, ...f })),
  ],
})

test('给粮舰计时格：缺 N 分／可结算两态', () => {
  const fleet = provisionFleet({ followers: [{ cond: 49 }] })
  reset({ fleets: [fleet], provisionSince: ago(8) })
  let html = renderBerth()
  assert.match(html, /缺 7 分/)
  assert.match(html, /class="bt-bar"/)
  assert.ok(!html.includes('→ 51'))

  reset({ fleets: [fleet], provisionSince: ago(18) })
  html = renderBerth()
  assert.match(html, /可结算 · 已等 18 分/)
  assert.match(html, /→ 51/)
})

test('给粮舰实测撤退路：全局锚点为 null 时不退回该队编成时刻', () => {
  reset({
    fleets: [provisionFleet({ since: ago(20), followers: [{ cond: 49 }] })],
    provisionSince: null,
  })
  const html = renderBerth()
  assert.match(html, /计时未知/)
  assert.ok(!html.includes('→ 51'))
  assert.ok(!renderFleetFatigue().includes('回母港可'))
})

test('给粮舰实测撤退路：两枚锚点都缺失时照旧报计时未知', () => {
  reset({ fleets: [provisionFleet({ followers: [{ cond: 49 }] })], provisionSince: null })
  const html = renderBerth()
  assert.match(html, /计时未知/)
  assert.ok(!html.includes('→ 51'))
})

test('给粮舰实测撤退路：全局锚点有值时照旧按它计时', () => {
  reset({
    fleets: [provisionFleet({ since: ago(5), followers: [{ cond: 49 }] })],
    provisionSince: ago(30),
  })
  const html = renderBerth()
  assert.match(html, /可结算 · 已等 30 分/)
  assert.match(html, /→ 51/)
  assert.ok(!html.includes('缺 10 分'))
})

for (const [label, options, expected] of [
  ['远征中', { mission: [1, 5, Date.now() + MIN, 0] }, '远征中'],
  ['给粮舰在渠', {}, '给粮舰在渠'],
  ['给粮舰未补给', { flag: { fuel: 19 } }, '给粮舰未补给'],
  ['给粮舰小破', { flag: { nowhp: 30, maxhp: 40 } }, '给粮舰小破'],
  ['给粮舰士气不足', { flag: { cond: 29 } }, '给粮舰士气不足'],
]) {
  test(`给粮舰停摆：${label}`, () => {
    const fleet = provisionFleet({ ...options, followers: [{ cond: 49 }] })
    reset({
      fleets: [fleet],
      provisionSince: ago(30),
      docked: label === '给粮舰在渠' ? [101] : [],
    })
    const html = renderBerth()
    assert.match(html, new RegExp(expected))
    assert.ok(!html.includes('→ 51'), '停摆时不许出现估算')
    assert.ok(!html.includes('燃料 −'), '停摆时不许报本次燃料')
  })
}

test('野埼改按 +3 估算 49→52、53→54；入渠舰与她自己不估，燃料只数会涨的两艘', () => {
  const fleet = provisionFleet({
    spec: NOZAKI_KAI,
    followers: [
      { cond: 40, estimatedCond: 49 },
      { cond: 53 },
      { cond: 49 },
    ],
  })
  reset({ fleets: [fleet], provisionSince: ago(20), docked: [212] })
  const html = renderBerth()
  assert.match(html, /→ 52/)
  assert.match(html, /士气 49/)
  assert.match(html, /→ 54/)
  assert.equal((html.match(/<em>估算<\/em>/g) ?? []).length, 2)
  assert.match(html, /燃料 −2/)
  assert.match(html, /data-provision-pos="1"[^]*?给粮舰[^]*?<span class="bt-gain"><\/span>/)
  assert.match(html, /data-provision-pos="4"[^]*?入渠[^]*?<span class="bt-gain"><\/span>/)
})

test('页签把只有给粮舰的队算进去，圆点点亮', () => {
  reset({ fleets: [provisionFleet({ followers: [{ cond: 49 }] })] })
  const tabs = renderTabs(1)
  assert.match(tabs, /class="d berth-on"/)
  assert.match(tabs, /泊地修理与恢复<span class="t">1队<\/span>/)
})

test('出击中的给粮舰队只报出击中，暂停估算与燃料', () => {
  reset({
    fleets: [provisionFleet({ followers: [{ cond: 49 }] })],
    provisionSince: ago(30),
    sortie: { active: true, practice: false, deckId: 1, mapArea: 3, mapNo: 5 },
  })
  const html = renderBerth()
  assert.match(html, /出击中/)
  assert.ok(!html.includes('→ 51'))
  assert.ok(!html.includes('燃料 −'))
})

test('同一队明石旗舰 + 野埼 2 号位时，工作舰卡与给粮舰卡各出一张', () => {
  reset({
    fleets: [{
      id: 1,
      ships: [
        { id: 101, spec: AKASHI, nowhp: 45, maxhp: 45, cond: 49 },
        { id: 102, spec: NOZAKI, nowhp: 40, maxhp: 40, cond: 30 },
        { id: 103, spec: DD, nowhp: 40, maxhp: 40, cond: 49 },
      ],
      since: ago(30),
    }],
    provisionSince: ago(30),
  })
  const html = renderBerth()
  assert.equal((html.match(/class="bt-fleet/g) ?? []).length, 2)
  assert.match(html, /覆盖 2 艘/)
  assert.match(html, /2 号位/)
})

test('编队抬头：未满 15 分挂 data-ready-ts 与到点文案', () => {
  const since = Date.now() - 5 * MIN
  reset({ fleets: [provisionFleet({ followers: [{ cond: 49 }] })], provisionSince: since })
  const html = renderFleetFatigue()
  assert.match(html, new RegExp(`data-ready-ts="${since + 15 * MIN}"`))
  assert.match(html, /data-ready-done="野埼 · 回母港可 \+2"/)
  assert.match(html, /野埼 · T\d+ 起回母港可 \+2/)
})

test('编队抬头：给粮舰条件不满足时不追加回港可加', () => {
  reset({
    fleets: [provisionFleet({ flag: { fuel: 19 }, followers: [{ cond: 49 }] })],
    provisionSince: ago(5),
  })
  assert.ok(!renderFleetFatigue().includes('回母港可'))
})
