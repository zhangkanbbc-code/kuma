// 出击识别札的出击限制表（shared/sally-rules）。
//
// 这一份的第一职责是**防录入抄错**：下面 EXPECT 是照 wikiwiki 活动页主表
//（出撃識別札の付与 / 出撃制限表，2026-08-26 逐格核对）重新敲的一份，
// 与 src 那份各写各的。两份对不上就是有人抄错了一格——这类错不报错、
// 界面上也看不出来，只有对着攻略表打的人会被送进禁入的图里。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import sallyRules from '../dist/shared/sally-rules.js'
import sallyNames from '../dist/shared/sally-names.js'

const {
  SALLY_MAP_RULES,
  SALLY_RULE_FOOTNOTE_B,
  SALLY_RULE_FOOTNOTE_CD,
  SALLY_RULE_GENERAL_NOTE,
  sallyMapRuleOf,
  sallyRuleView,
} = sallyRules
const { SALLY_TAG_NAMES, sallyTagNameOf } = sallyNames

const FOOT_CD = '丙丁不受限 · 支援舰队不贴札'
const FOOT_B = '乙以下不受限 · 支援舰队不贴札'

// 逐格重敲的一份对照表（62 区五图）
const EXPECT = {
  1: { grants: [1, 2], banned: [3, 4, 5, 6, 7, 8], restricted: ['甲', '乙'], label: '甲乙禁入', foot: FOOT_CD, unconfirmed: [] },
  2: { grants: [1, 3, 4], banned: [5, 6, 7, 8], restricted: ['甲', '乙'], label: '甲乙禁入', foot: FOOT_CD, unconfirmed: [] },
  3: { grants: [2, 5, 6], banned: [3, 4, 7, 8], restricted: ['甲', '乙'], label: '甲乙禁入', foot: FOOT_CD, unconfirmed: [] },
  4: { grants: [7, 8], banned: [1, 2, 3, 4, 5, 6], restricted: ['甲', '乙'], label: '甲乙禁入', foot: FOOT_CD, unconfirmed: ['??作戦'] },
  // E-5 特例：只有甲查札，乙也放开
  5: { grants: [9, 10, 11, 12, 13], banned: [1, 2, 3, 4, 5, 6, 7, 8], restricted: ['甲'], label: '甲禁入', foot: FOOT_B, unconfirmed: [] },
}

test('62 区五图的札名单与 wiki 主表逐格相等', () => {
  assert.equal(SALLY_MAP_RULES.length, 5)
  for (const [mapNo, want] of Object.entries(EXPECT)) {
    const rule = sallyMapRuleOf(62, Number(mapNo))
    assert.ok(rule, `62-${mapNo} 没录`)
    assert.deepEqual(rule.grants, want.grants, `62-${mapNo} 的出击贴名单对不上`)
    for (const difficulty of want.restricted) {
      assert.deepEqual(
        rule.bannedByDifficulty[difficulty],
        want.banned,
        `62-${mapNo} ${difficulty} 的禁入名单对不上`,
      )
    }
    assert.deepEqual(rule.unconfirmed ?? [], want.unconfirmed, `62-${mapNo} 的未确认项对不上`)
  }
})

test('丙丁一律不查札，62-5 连乙也放开', () => {
  for (const rule of SALLY_MAP_RULES) {
    // 通则：丙・丁難度では札の制限を無視して出撃出来ます
    assert.equal(rule.bannedByDifficulty.丙, undefined, `62-${rule.mapNo} 不该给丙难度列禁入`)
    assert.equal(rule.bannedByDifficulty.丁, undefined, `62-${rule.mapNo} 不该给丁难度列禁入`)
  }
  assert.equal(sallyMapRuleOf(62, 5).bannedByDifficulty.乙, undefined, 'E-5 的乙难度不查札')
  // 反向：其余四图的乙**必须**有名单，否则「62-5 是特例」这句话就空了
  for (const mapNo of [1, 2, 3, 4]) {
    assert.ok(sallyMapRuleOf(62, mapNo).bannedByDifficulty.乙?.length, `62-${mapNo} 的乙该查札`)
  }
})

test('查札的各档难度共用同一份名单——sallyRuleView 取第一档全靠这条', () => {
  for (const rule of SALLY_MAP_RULES) {
    const lists = Object.values(rule.bannedByDifficulty).map((list) => JSON.stringify(list))
    assert.equal(new Set(lists).size, 1, `62-${rule.mapNo} 各难度的禁入名单不一致，view 会只报第一档`)
  }
})

test('view 摊出来的小标与尾注逐字固定', () => {
  for (const [mapNo, want] of Object.entries(EXPECT)) {
    const view = sallyRuleView(sallyMapRuleOf(62, Number(mapNo)))
    assert.deepEqual(view.grants, want.grants)
    assert.deepEqual(view.banned, want.banned)
    assert.deepEqual(view.restricted, want.restricted)
    assert.equal(view.bannedLabel, want.label, `62-${mapNo} 的禁入小标`)
    assert.equal(view.footnote, want.foot, `62-${mapNo} 的尾注`)
    assert.deepEqual(view.unconfirmed, want.unconfirmed)
  }
  assert.equal(SALLY_RULE_FOOTNOTE_CD, FOOT_CD)
  assert.equal(SALLY_RULE_FOOTNOTE_B, FOOT_B)
  assert.equal(SALLY_RULE_GENERAL_NOTE, '首次出击时附加札；丙、丁同样附加，之后不可更换或移除')
})

test('未确认项只在 62-4，且绝不混进正常名单', () => {
  for (const rule of SALLY_MAP_RULES) {
    const want = rule.mapNo === 4 ? ['??作戦'] : []
    assert.deepEqual(rule.unconfirmed ?? [], want)
    // 上游没确认是哪一枚，就一个号都不许出现在名单里
    for (const list of Object.values(rule.bannedByDifficulty)) {
      for (const tag of list) assert.equal(typeof tag, 'number')
    }
  }
  const view = sallyRuleView(sallyMapRuleOf(62, 4))
  assert.ok(!view.banned.some((tag) => String(tag).includes('作戦')))
})

test('表里引到的每一枚札都在名册里查得到名字', () => {
  for (const rule of SALLY_MAP_RULES) {
    const tags = [...rule.grants, ...Object.values(rule.bannedByDifficulty).flat()]
    for (const tag of tags) {
      assert.ok(sallyTagNameOf(rule.area, tag), `札 ${rule.area}:${tag} 没名字，chip 会退成编号`)
    }
  }
})

test('13 枚札每一枚都在 62 区被提到过——录了名字却没有任何图用得上，多半是漏录了一张图', () => {
  const used = new Set()
  for (const rule of SALLY_MAP_RULES) {
    for (const tag of [...rule.grants, ...Object.values(rule.bannedByDifficulty).flat()]) {
      used.add(tag)
    }
  }
  const roster = SALLY_TAG_NAMES.filter((entry) => entry.area === 62).map((entry) => entry.tag)
  assert.deepEqual([...used].sort((a, b) => a - b), roster)
})

test('札 5 与札 6 在每一行里同进同出——这两号的序次将来被推翻也不影响显示', () => {
  // sally-names 里记着 wikiwiki 主表把 5/6 排成相反次序。之所以能先不裁，
  // 靠的就是这条不变量：两枚永远在同一个集合里，chip 集合与序次无关。
  for (const rule of SALLY_MAP_RULES) {
    const sets = [rule.grants, ...Object.values(rule.bannedByDifficulty)]
    for (const set of sets) {
      assert.equal(
        set.includes(5),
        set.includes(6),
        `62-${rule.mapNo} 把 5 与 6 拆开了，那就必须先把序次裁清楚`,
      )
    }
  }
})

test('查不到的图整段不渲染，不编规则', () => {
  assert.equal(sallyMapRuleOf(62, 9), null)
  assert.equal(sallyMapRuleOf(61, 1), null)
  assert.equal(sallyMapRuleOf(null, 1), null)
  assert.equal(sallyRuleView(null), null)
})

test('铎把札段挂进血条卡，两条渲染路径都挂——没同步血条时也该看得见资料', () => {
  const activity = fs.readFileSync(new URL('../src/renderer/modules/du.ts', import.meta.url), 'utf8')
  assert.match(activity, /const sallyRuleHtml = /)
  // 血条卡有「没同步」与正常两条 return，札是图级资料、与血条同步无关，两条都要挂
  assert.equal((activity.match(/\$\{sallyRuleHtml\(info\)\}/g) ?? []).length, 2)
  assert.match(activity, /class="sr-chip/)
  assert.match(activity, /class="sr-foot"/)
  assert.match(activity, /title="\$\{esc\(SALLY_RULE_GENERAL_NOTE\)\}"/)
  assert.match(activity, /wiki 未确认项 · 保留原文/)
  // 文案从 shared 现取，别在渲染层再抄一份——抄了就会和数据层各说各的
  assert.doesNotMatch(activity, /丙丁不受限/)
  assert.doesNotMatch(activity, /乙以下不受限/)
  assert.doesNotMatch(activity, /札随首次出击贴上/)
})

test('札段的样式落在战斗复盘共享样式里', () => {
  const html = fs.readFileSync(
    new URL('../src/renderer/assets/battle-replay.css', import.meta.url),
    'utf8',
  )
  for (const cls of ['.mod-du .sally-rule', '.mod-du .sr-chip', '.mod-du .sr-chip.ban', '.mod-du .sr-chip.unk', '.mod-du .sr-foot']) {
    assert.ok(html.includes(cls), `缺样式 ${cls}`)
  }
})
