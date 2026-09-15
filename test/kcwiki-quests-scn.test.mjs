import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

import { MAINTAINER_QUEST_NO_CORRECTIONS, parseKcwikiQuestPages } from '../scripts/lib/kcwiki-quests-scn.mjs'

const equipNames = new Map([
  [75, '鼓筒（运输用）'],
  [351, '试制 秋水'],
])

const PAGE = `
{{任务表/页首}}
{{任务表| type =编制| 编号 =A1|<!--101-->|前置 =
| 日文任务名字 =はじめての「編成」！| 日文任务说明 =2隻以上の艦で編成される「艦隊」を編成せよ！
| 中文任务名字 =初次的「编成」！| 中文任务说明 =以两艘以上的阵容编成「舰队」！
| 燃料 =20| 弹药 =20| 钢铁 =0| 铝 =0| 奖励 =[[文件:KanMusu012Banner.jpg|link=白雪]]
| 备注 =}}
{{任务表| type =出击| 编号 =B1| <!--201-->| 前置 =A1| 前置2 =A3| 前置3 =
| 中文任务名字 =击破敌舰队！| 中文任务说明 =在[[6-1|中部海域哨戒战(6-1)]]出击！
| 奖励 ={{高速建造材}}*1 {{装备奖励|编号 = 075}}×2 <b style="color:#F00">第2舰队开启</b>
| 备注 ='''出击胜利一次'''}}
{{任务表| type =出击| 编号 =B2|<!---->| 前置 =
| 中文任务名字 =还没定号的任务| 中文任务说明 =不该进包
| 奖励 =| 备注 =}}
{{任务尾}}
`

const LATER_PAGE = `
{{任务表| type =出击| 编号 =B1| <!--201-->| 前置 =A1
| 中文任务名字 =后一张页覆盖前一张| 中文任务说明 =同号后者胜
| 奖励 ={{装备奖励|编号=351}}| 备注 =}}
`

test('kcwiki 任务页:api_id 取模板内首个注释,未定号的整条跳过', () => {
  const { quests, stats } = parseKcwikiQuestPages([PAGE], equipNames)
  assert.deepEqual(Object.keys(quests).sort(), ['101', '201'])
  assert.equal(stats.withoutId, 1)
  assert.deepEqual(stats.withoutIdRows, [{ code: 'B2', name: '还没定号的任务' }])
  assert.equal(quests['101'].code, 'A1')
})

test('kcwiki 任务页:前置只收纯字母数字的码,空值与多值不误收', () => {
  const { quests } = parseKcwikiQuestPages([PAGE], equipNames)
  assert.deepEqual(quests['101'].pre, [])
  assert.deepEqual(quests['201'].pre, ['A1', 'A3'])
})

test('kcwiki 任务页:奖励里的图片链取 link= 目标,装备奖励换成装备中文名', () => {
  const { quests } = parseKcwikiQuestPages([PAGE], equipNames)
  // [[文件:…|link=白雪]] → 「白雪」;memo 一律带「奖励:」前缀
  assert.equal(quests['101'].memo, '奖励:「白雪」')
  // {{高速建造材}}*1 → 高速建造材×1;{{装备奖励|编号=075}} → 装备中文名;
  // HTML 标签整条换成一个空格(所以 <b> 里的字留下、标签本身不留)
  assert.equal(quests['201'].memo, '奖励:高速建造材×1 鼓筒（运输用）×2  第2舰队开启')
})

test('kcwiki 任务页:wiki 版式怪癖照旧保留(带竖线的内链文本、去掉的三引号)', () => {
  const { quests } = parseKcwikiQuestPages([PAGE], equipNames)
  // [[6-1|中部海域哨戒战(6-1)]] → 「6-1|中部海域哨戒战(6-1)」——竖线留着。
  // 这不是好格式,但它是换源前既有的产物形态,消费端按它写的,别顺手"修好"。
  assert.equal(quests['201'].desc, '在「6-1|中部海域哨戒战(6-1)」出击！')
  assert.equal(quests['201'].memo2, '出击胜利一次')
})

test('kcwiki 任务页:同号同码条目后一张页胜出', () => {
  const { quests, stats } = parseKcwikiQuestPages([PAGE, LATER_PAGE], equipNames)
  assert.equal(quests['201'].code, 'B1')
  assert.equal(quests['201'].name, '后一张页覆盖前一张')
  assert.equal(quests['201'].memo, '奖励:试制 秋水')
  assert.equal(stats.duplicates, 1)
  assert.equal(stats.conflicts, 0)
})

test('kcwiki 任务页:仅定号表已写入的 id 跳过异码注释并记录冲突', () => {
  const { quests, stats } = parseKcwikiQuestPages([
    '{{任务表|编号=Cs8|<!---->|中文任务名字=秋季大演习|奖励=工厂资源×1}}',
    '{{任务表|编号=未知新码|<!--313-->|中文任务名字=错号新任务}}',
  ], equipNames)
  assert.deepEqual(Object.keys(quests), ['313'])
  assert.equal(quests['313'].code, 'Cs1')
  assert.equal(quests['313'].name, '秋季大演习')
  assert.equal(quests['313'].memo, '奖励:工厂资源×1')
  assert.equal(stats.duplicates, 0)
  assert.equal(stats.conflicts, 1)
  assert.deepEqual(stats.conflictRows, [{ id: 313, kept: 'Cs1', skipped: '未知新码', name: '错号新任务' }])
  assert.deepEqual(stats.crossPageCodeChanges, [])
})

test('kcwiki 任务页:普通注释同号异码在同页与跨页均后者胜,不记定号表冲突', () => {
  const later = LATER_PAGE.replace('编号 =B1|', '编号 =B1改|')
  for (const pages of [[PAGE + later], [PAGE, later]]) {
    const { quests, stats } = parseKcwikiQuestPages(pages, equipNames)
    assert.equal(quests['201'].code, 'B1改')
    assert.equal(quests['201'].name, '后一张页覆盖前一张')
    assert.equal(quests['201'].memo, '奖励:试制 秋水')
    assert.equal(stats.duplicates, 1)
    assert.equal(stats.conflicts, 0)
    assert.deepEqual(stats.conflictRows, [])
    assert.deepEqual(stats.crossPageCodeChanges, pages.length === 1 ? [] : [{ id: 201, from: 'B1', to: 'B1改' }])
  }
})

test('kcwiki 任务页:跨页改码只记信息,同页改码和跨页同码不列', () => {
  const { quests, stats } = parseKcwikiQuestPages([
    '{{任务表|编号=C10|<!--313-->}}{{任务表|编号=Cs1|<!--313-->}}' +
      '{{任务表|编号=B1|<!--201-->}}',
    '{{任务表|编号=Cs8|<!---->}}{{任务表|编号=B1|<!--201-->}}' +
      '{{任务表|编号=B1改|<!--201-->}}{{任务表|编号=C11|<!--314-->}}{{任务表|编号=Cs2|<!--314-->}}',
    '{{任务表|编号=B1新|<!--201-->}}',
  ], equipNames)
  assert.deepEqual(stats.crossPageCodeChanges, [
    { id: 201, from: 'B1改', to: 'B1新' },
  ])
  assert.equal(stats.conflicts, 0)
  assert.equal(stats.duplicates, 6)
  assert.equal(quests['313'].code, 'Cs1')
  assert.equal(quests['201'].code, 'B1新')
  assert.equal(quests['314'].code, 'Cs2')
})

test('kcwiki 任务页:维护者七条定号只记录公开游戏编号与核对日期', () => {
  assert.deepEqual(MAINTAINER_QUEST_NO_CORRECTIONS, [
    { code: '2609Cw1', id: 384, basis: '游戏任务列表编号（2026-09-11 核）' },
    { code: '2609Cw2', id: 385, basis: '游戏任务列表编号（2026-09-11 核）' },
    { code: 'By17', id: 1050, basis: '游戏任务列表编号（2026-09-11 核）' },
    { code: 'By18', id: 1051, basis: '游戏任务列表编号（2026-09-11 核）' },
    { code: 'Cs8', id: 313, asCode: 'Cs1', basis: '游戏任务列表编号（2026-09-11 核）；「任务」页 313 编号为 Cs1、F40 前置亦引用 Cs1，「最新任务」页写作 Cs8 与之不一致，码按「任务」页保留，内容取「最新任务」页新行' },
    { code: 'B217', id: 1052, basis: '游戏任务列表编号（2026-09-15 核）' },
    { code: 'F143', id: 1170, basis: '游戏任务列表编号（2026-09-15 核）' },
  ])
})

test('kcwiki 任务页:定号表优先于错号或空注释,归一码并替换同号旧码', () => {
  const { quests, stats } = parseKcwikiQuestPages([`
{{任务表|编号=Cs1|<!--313-->|中文任务名字=秋季大演习|奖励=礼物箱×1}}
{{任务表|编号=旧码|<!--384-->|中文任务名字=旧条目}}
{{任务表|编号=2609 Cw1|<!--313-->|中文任务名字=与提督的秋祭演习}}
{{任务表|编号=2609\tCw2|<!--313-->|中文任务名字=秋祭扩张演习}}
{{任务表|编号=By17|<!---->|中文任务名字=第九战队出击}}
{{任务表|编号=By18|<!--待确认-->|中文任务名字=突破敌阵}}
{{任务表|编号=Cs8|<!---->|中文任务名字=秋季大演习|奖励=工厂资源×1}}
{{任务表|编号=B217|<!---->|中文任务名字=改装多用途搭载母舰「北上改三」，出击！}}
{{任务表|编号=F143|<!---->|中文任务名字=利用现有装备开发防空兵装}}
`], equipNames)
  assert.deepEqual(Object.keys(quests), ['313', '384', '385', '1050', '1051', '1052', '1170'])
  assert.deepEqual(Object.values(quests).map(({ code }) => code), ['Cs1', '2609Cw1', '2609Cw2', 'By17', 'By18', 'B217', 'F143'])
  assert.equal(quests['313'].memo, '奖励:工厂资源×1')
  assert.equal(quests['384'].name, '与提督的秋祭演习')
  assert.equal(stats.withoutId, 0)
  assert.deepEqual(stats.withoutIdRows, [])
  assert.equal(stats.duplicates, 2)
  assert.equal(stats.conflicts, 0)
  assert.deepEqual(stats.maintainerHits, MAINTAINER_QUEST_NO_CORRECTIONS.map(({ code, id }) => ({ code, id })))
  for (const quest of Object.values(quests)) {
    assert.deepEqual(Object.keys(quest).sort(), ['code', 'desc', 'memo', 'memo2', 'name', 'pre'])
  }
})

test('kcwiki 任务页:定号后的条目挡住后续同号异码注释行,同码仍可更新', () => {
  const { quests, stats } = parseKcwikiQuestPages([`
{{任务表|编号=Cs8|<!---->|中文任务名字=秋季大演习|奖励=工厂资源×1}}
{{任务表|编号=C10|<!--313-->|中文任务名字=旧秋季大演习|奖励=礼物箱×1}}
{{任务表|编号=Cs8|<!--999-->|中文任务名字=秋季大演习更新|奖励=工厂资源×1}}
`], equipNames)
  assert.deepEqual(Object.keys(quests), ['313'])
  assert.equal(quests['313'].name, '秋季大演习更新')
  assert.equal(quests['313'].memo, '奖励:工厂资源×1')
  assert.equal(stats.duplicates, 1)
  assert.equal(stats.maintainerHits.length, 2)
  assert.equal(stats.conflicts, 1)
  assert.deepEqual(stats.conflictRows, [{ id: 313, kept: 'Cs1', skipped: 'C10', name: '旧秋季大演习' }])
})

test('kcwiki 任务页:asCode 保留 Cs1 引用并取新行内容,后来的旧码行不能覆盖终态', () => {
  const old = '{{任务表|编号=Cs1|<!--313-->|中文任务名字=秋季大演习|中文任务说明=旧说明|奖励=礼物箱×1|备注=旧备注}}'
  const latest = '{{任务表|编号=Cs8|<!---->|中文任务名字=秋季大演习|中文任务说明=新说明|奖励=工厂资源×1|备注=取消了礼物箱}}'
  for (const pages of [[old, latest], [latest, old], [latest + old]]) {
    const { quests, stats } = parseKcwikiQuestPages(pages, equipNames)
    assert.deepEqual(quests['313'], {
      code: 'Cs1', desc: '新说明', memo: '奖励:工厂资源×1', memo2: '取消了礼物箱', name: '秋季大演习', pre: [],
    })
    assert.equal(stats.duplicates, 1)
    assert.equal(stats.conflicts, 0)
    assert.deepEqual(stats.conflictRows, [])
    assert.deepEqual(stats.crossPageCodeChanges, [])
    assert.deepEqual(stats.maintainerHits, [{ code: 'Cs8', id: 313 }])
  }
})

test('kcwiki 任务页:未定号明细容许空码,首个非数字注释不向后找编号', () => {
  const { quests, stats } = parseKcwikiQuestPages([`
{{任务表|编号=SF1|<!---->|<!--1052-->|中文任务名字=初夏的整理整顿}}
{{任务表|编号=|中文任务名字=利用既存装备开发对空兵装}}
{{任务表|编号=待定|<!--未定-->|<!--1053-->|中文任务名字=待定任务}}
`], equipNames)
  assert.deepEqual(quests, {})
  assert.equal(stats.withoutId, 3)
  assert.deepEqual(stats.withoutIdRows, [
    { code: 'SF1', name: '初夏的整理整顿' },
    { code: '', name: '利用既存装备开发对空兵装' },
    { code: '待定', name: '待定任务' },
  ])
})

test('kcwiki 任务页:装备奖励的编号查不到名字就抛错,不把模板原文塞进奖励文本', () => {
  assert.throws(
    () => parseKcwikiQuestPages(['{{任务表| 编号 =X| <!--999-->| 奖励 ={{装备奖励|编号=9999}}}}'], equipNames),
    /9999/,
  )
})

// ---- 真包锚定(缺包时优雅跳过;test:lodes 有大声兜底) ----
const packFile = new URL('../assets/lodes/quests-scn.json', import.meta.url)
test('quests-scn 真包:换源后的锚定事实', { skip: !existsSync(packFile) }, () => {
  const pack = JSON.parse(readFileSync(packFile, 'utf8'))
  assert.equal(pack.meta.source, 'zh.kcwiki 任务 / 任务·最新任务')
  assert.match(pack.meta.license, /CC BY-NC-SA/)
  const data = pack.data
  // 换源前后 id 空间逐条对过,一条不多一条不少
  assert.ok(Object.keys(data).length >= 640, `任务条数至少 640,实际 ${Object.keys(data).length}`)
  assert.equal(data['101']?.memo, '奖励:「白雪」')
  assert.deepEqual(data['628']?.pre, ['F24', 'Bm5'])
  // 装备名改从 kcwiki 装备模块取:旧的 kcdata 名在这几条上留着日文原文
  assert.match(`${data['158']?.memo}`, /三式弹改/)
  assert.match(`${data['197']?.memo}`, /12\.7cm连装炮D型改二/)
})
