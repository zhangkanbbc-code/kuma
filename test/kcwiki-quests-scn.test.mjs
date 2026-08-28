import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

import { parseKcwikiQuestPages } from '../scripts/lib/kcwiki-quests-scn.mjs'

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
{{任务表| type =出击| 编号 =B1改| <!--201-->| 前置 =A1
| 中文任务名字 =后一张页覆盖前一张| 中文任务说明 =同号后者胜
| 奖励 ={{装备奖励|编号=351}}| 备注 =}}
`

test('kcwiki 任务页:api_id 取模板内首个注释,未定号的整条跳过', () => {
  const { quests, stats } = parseKcwikiQuestPages([PAGE], equipNames)
  assert.deepEqual(Object.keys(quests).sort(), ['101', '201'])
  assert.equal(stats.withoutId, 1)
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

test('kcwiki 任务页:同号条目后一张页胜出', () => {
  const { quests, stats } = parseKcwikiQuestPages([PAGE, LATER_PAGE], equipNames)
  assert.equal(quests['201'].code, 'B1改')
  assert.equal(quests['201'].memo, '奖励:试制 秋水')
  assert.equal(stats.duplicates, 1)
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
