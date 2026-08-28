import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { buildItemNameIndex, parseShipProfilePage } from '../scripts/lib/wikiwiki-ship-profile.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const itemByNorm = buildItemNameIndex([
  { api_id: 229, api_name: '12.7cm単装高角砲(後期型)' },
  { api_id: 15, api_name: '61cm四連装(酸素)魚雷' },
  { api_id: 106, api_name: '13号対空電探改' },
  { api_id: 4, api_name: '14cm単装砲' },
])

const PAGE = `
<table>
<tr><td>No.597</td></tr>
<tr><td></td><td>杉 改(すぎ)</td><td>松型 7番艦<br class="spacer">駆逐艦</td></tr>
<tr><td colspan="4">艦船ステータス(初期値/最大値)</td></tr>
<tr><td>耐久</td><td>27</td><td>火力</td><td>7 / 43</td></tr>
<tr><td colspan="4">最大消費量</td></tr>
<tr><td>燃料</td><td>15</td><td>弾薬</td><td>15</td></tr>
<tr><td colspan="4">装備</td></tr>
<tr><td colspan="4">12.7cm単装高角砲(後期型)★+3</td></tr>
<tr><td colspan="4">61cm四連装(酸素)魚雷</td></tr>
<tr><td colspan="4">未装備</td></tr>
<tr><td colspan="4">装備不可</td></tr>
<tr><td colspan="4">改造チャート</td></tr>
</table>
<div class="fold-content"><p>CV：倉西希奈、イラストレーター：海原さかな</p></div>`

test('舰页档案:CV/画师/舰级+舰种字样/初期装备(★剥离·未装備=-1·装備不可跳过)', () => {
  const { profile, warnings } = parseShipProfilePage(PAGE, { itemByNorm })
  assert.deepEqual(warnings, [])
  assert.equal(profile.cv, '倉西希奈')
  assert.equal(profile.artist, '海原さかな')
  assert.deepEqual(profile.shipClass, ['松型', 7])
  assert.equal(profile.stypeText, '駆逐艦')
  assert.deepEqual(profile.initialEquips, [229, 15, -1])
})

test('舰页档案:双列「搭載|装備」表头同样命中', () => {
  const page = PAGE.replace('<tr><td colspan="4">装備</td></tr>', '<tr><td>搭載</td><td colspan="3">装備</td></tr>')
    .replace('<tr><td colspan="4">12.7cm単装高角砲(後期型)★+3</td></tr>', '<tr><td>0</td><td colspan="3">12.7cm単装高角砲(後期型)★+3</td></tr>')
  const { profile } = parseShipProfilePage(page, { itemByNorm })
  assert.deepEqual(profile.initialEquips, [229, 15, -1])
})

test('舰页档案:装备名对不上主数据时整形态不发初期装备,不发残缺列表', () => {
  const page = PAGE.replace('61cm四連装(酸素)魚雷', '存在しない装備')
  const { profile, warnings } = parseShipProfilePage(page, { itemByNorm })
  assert.equal(profile.initialEquips, undefined)
  assert.equal(warnings.length, 1)
  // 其余档案字段照常保留——初期装备失败不连坐
  assert.equal(profile.cv, '倉西希奈')
})

// ---- 真包锚定(缺包时优雅跳过;test:lodes 有大声兜底) ----
const packFile = path.join(root, 'assets', 'lodes', 'wikiwiki-ship-profile.json')
test('wikiwiki-ship-profile 真包:补缺范围与同名形态消歧', { skip: !existsSync(packFile) }, () => {
  const pack = JSON.parse(readFileSync(packFile, 'utf8'))
  const data = pack.data
  // 2026-08-21 kcwiki-ships 换源(GitHub 镜像 → zh.kcwiki「模块:舰娘数据」)之后,
  // 2023 霧島改二丙起停收的 89 个形态里有 84 个被上游补齐,本包**自动退役到剩 5 个**
  // ——「上游赶上后自补退役」正是补缺层的设计终局,别把它当成抓少了。
  // 这里只锚定「非空 + 不与 kcwiki 重叠」,不再钉具体条数:上游继续补,它还会更小。
  assert.ok(Object.keys(data).length > 0, '补缺包不该为空——真空了说明抓取整个失败')
  // Glorious 同名两形态各归各页:Courageous級2番艦(巡洋戦艦) vs Glorious級1番艦(正規空母)。
  // 两条 nameJp 完全相同,靠页面舰种注记消歧——这条性质与上游补到哪儿无关。
  assert.equal(data['740']?.nameJp, data['741']?.nameJp)
  assert.deepEqual(data['740']?.shipClass, ['Courageous級', 2])
  assert.deepEqual(data['741']?.shipClass, ['Glorious級', 1])
  // 只补 kcwiki 没有的实体:kcwiki 已收录的形态绝不该在本包出现
  const kcFile = path.join(root, 'assets', 'lodes', 'kcwiki-ships.json')
  if (existsSync(kcFile)) {
    const kcIds = new Set(
      Object.values(JSON.parse(readFileSync(kcFile, 'utf8')).data).map((row) => Number(row.ID)),
    )
    const overlap = Object.keys(data).filter((id) => kcIds.has(Number(id)))
    assert.deepEqual(overlap, [], 'kcwiki 已收录的形态不该进补缺包(实体级回退,不混拼)')
  }
})
