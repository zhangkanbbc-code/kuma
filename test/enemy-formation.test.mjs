import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import formationModule from '../dist/shared/enemy-formation.js'

const { ENEMY_FORMATION, FORMATION_JA_ZH, FORMATION_FULL_ALIASES, formationText, unmappedFormationTokens } =
  formationModule

// ---------------------------------------------------------------- 出口本身
//
// 2026-08-25 之前敌编成格是两条腿两种话：数字分支中文、字符串分支照抄日文简写。
// 用户拍板统一中文（并立总则：玩家可见文案统一中文）后并成 formationText 一个出口。

test('阵形出口:数字与字符串两条腿说同一种话', () => {
  assert.equal(formationText(1), '单纵阵')
  assert.equal(formationText(6), '警戒阵')
  assert.equal(formationText(14), '第四警戒')
  // 查不到的号如实报号，不编
  assert.equal(formationText(9), '阵形9')
  // 字符串分支出的必须是与数字分支**同一套**中文名
  assert.equal(formationText('単縦'), ENEMY_FORMATION[1])
  assert.equal(formationText('単縦 複縦'), '单纵阵/复纵阵')
  assert.equal(formationText('梯形 複縦 単縦'), '梯形阵/复纵阵/单纵阵')
  assert.equal(formationText('警戒 単縦'), '警戒阵/单纵阵')
  // 认不出的词保留原文，不硬翻——宁可露出来提醒补表
  assert.equal(formationText('単縦 謎の陣'), '单纵阵/謎の陣')
  assert.equal(formationText(''), '')
  // 联合警戒三种上游写法（map-intel 实见）：断空格整句、两种缩写
  assert.equal(formationText('第三警戒 航行序列'), '第三警戒')
  assert.equal(formationText('第三'), '第三警戒')
  assert.equal(formationText('第四'), '第四警戒')
})

test('阵形出口:映射表的每个值都在数字规范表里,不许第二套写法', () => {
  const canonical = new Set(Object.values(ENEMY_FORMATION))
  for (const [ja, zh] of Object.entries(FORMATION_JA_ZH)) {
    assert.ok(canonical.has(zh), `「${ja}」映射到了规范表之外的写法「${zh}」`)
  }
  for (const [full, zh] of Object.entries(FORMATION_FULL_ALIASES)) {
    assert.ok(canonical.has(zh), `整串别名「${full}」映射到了规范表之外的写法「${zh}」`)
  }
})

// ---------------------------------------------------------------- 护栏：矿脉真实数据零漏网
//
// 汇编包里的字符串保持上游的日文简写不动（转写忠实），中文化只在渲染层做。
// 这条护栏拿两个包的**真实数据**逐词过：上游哪天冒出映射表没有的新写法，
// 这里当场红——修法是补 FORMATION_JA_ZH 一格，而不是让混排悄悄回来。

const collectFormations = (value, out) => {
  if (Array.isArray(value)) {
    for (const item of value) collectFormations(item, out)
    return
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === 'formation' && typeof item === 'string' && item) out.add(item)
      else collectFormations(item, out)
    }
  }
}

// `map-intel` 不随仓库分发（上游 NOASSERTION，见 .gitignore 的白名单块）：
// 克隆下来的树里没有它，缺包时跳过而不是红。维护者机器上包齐，照跑全量。
const skipMissingLode = (name) =>
  fs.existsSync(new URL(`../assets/lodes/${name}`, import.meta.url))
    ? false
    : `缺矿脉包：${name}（npm run lodes:fetch）`

for (const lode of ['map-enemy-comps.json', 'map-intel.json']) {
  test(`阵形护栏:${lode} 里的每个阵形词都映射得到中文`, { skip: skipMissingLode(lode) }, () => {
    const data = JSON.parse(fs.readFileSync(new URL(`../assets/lodes/${lode}`, import.meta.url), 'utf8'))
    const forms = new Set()
    collectFormations(data, forms)
    assert.ok(forms.size >= 1, `${lode} 里一个字符串阵形都没扫到——收集器多半坏了`)
    // 判定必须走 unmappedFormationTokens（与 formationText 同一套逻辑）：
    // 测试自己另写一份切词的话，别名那条路就会被剁碎误报
    const unmapped = new Set()
    for (const raw of forms) {
      for (const token of unmappedFormationTokens(raw)) unmapped.add(token)
    }
    assert.deepEqual([...unmapped], [], `上游冒出了映射表没有的阵形写法，去 shared/enemy-formation 补格`)
  })
}
