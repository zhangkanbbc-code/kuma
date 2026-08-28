import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { buildSync } from 'esbuild'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-ship-nationality-'))
const output = path.join(tempDir, 'ship-nationality.cjs')
buildSync({
  entryPoints: [fileURLToPath(new URL('../src/shared/ship-nationality.ts', import.meta.url))],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'silent',
})
const require = createRequire(import.meta.url)
const nationality = require(output)

test.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

test('ship nationality follows the audited EO api_sort_id boundaries', () => {
  const boundaries = [
    [999, 0],
    [1000, 1],
    [29999, 1],
    [30000, 2],
    [31000, 3],
    [32000, 4],
    [33000, 5],
    [34000, 6],
    [35000, 7],
    // 36000/36060 两条界是**画出来的**（不是整千的官方块界），所以窄段还要过号位这一关：
    // 36000 与 36060 都是没人占过的号位，落未归类；已见号位才归国（见下一条测试）
    [36000, 0],
    [36051, 8],
    [36060, 0],
    [36071, 9],
    [36100, 10],
    [37000, 11],
    [38000, 12],
    [39000, 0],
  ]
  for (const [sortId, expected] of boundaries) {
    assert.equal(nationality.shipNationalityIdFromSortId(sortId), expected)
  }
})

test('ship nationality labels cover every EO enum value used by task and fit rules', () => {
  assert.deepEqual(
    nationality.SHIP_NATIONALITIES.map(({ id, label }) => [id, label]),
    [
      [1, '日本'],
      [2, '德国'],
      [3, '意大利'],
      [4, '美国'],
      [5, '英国'],
      [6, '法国'],
      [7, '俄罗斯'],
      [8, '泰国'],
      [9, '挪威'],
      [10, '瑞典'],
      [11, '荷兰'],
      [12, '澳大利亚'],
    ],
  )
})

test('号段判不出国籍的舰进「未归类」桶，而不是从国籍这一维上消失', () => {
  // 自扩展两层公约（2026-08-23）：实体一出现就得有格子站着，名分可以滞后但必须显形。
  // 号段表是有边界的——第十三国的新号段一落地，那些舰的 id 就是 0；而界面上 0 已经
  // 被「没在筛国籍」占着，于是它们既不在任何一国下，也没有一格可点，等于凭空消失。
  const { SHIP_NATIONALITY_UNCLASSIFIED: NONE, shipNationalityBucketOf: bucketOf } = nationality
  assert.equal(NONE, -1)
  // 0 不能当桶号：它是「没在筛」的意思，两个语义占同一个值就分不开了
  assert.notEqual(NONE, 0)
  // 判得出来的照常进自己那一国
  assert.equal(bucketOf(1000), 1)
  assert.equal(bucketOf(36071), 9)
  assert.equal(bucketOf(38412), 12)
  // 判不出来的（带外号段、非数、缺字段）一律进未归类——不是 0，也不是错归到邻段
  for (const sortId of [39000, 39500, 999, 0, null, undefined, 'x', NaN]) {
    assert.equal(bucketOf(sortId), NONE, `${sortId} 该进未归类`)
  }
  // 名分到位（号段被认领）之后这一格自然空掉：同一个号在表里有了归属就不再是未归类
  assert.equal(nationality.shipNationalityIdFromSortId(38999), 12)
  assert.equal(bucketOf(38999), 12)
})

test('窄段的新号位落未归类，不静默归成邻国', () => {
  // 体检待裁 2（2026-08-23，用户拍板「溢出改落未归类桶」）：
  // 36060 与 36100 这两条界不是整千的官方块界，是 EO 在两簇观测值中间画出来的。
  // 泰段现存最大 36052、界在 36060——只剩 7 个号位；而 api_sort_id 的低三位是
  // 「号位(两位)+形态(一位)」，泰国若再添一舰多半拿号位 3606，正好越界，
  // 旧表会把它**静默说成挪威籍**（不报错、不落 unknown，界面上就是错的那一国）。
  const { shipNationalityIdFromSortId: idOf, shipNationalityBucketOf: bucketOf,
    SHIP_NATIONALITY_UNCLASSIFIED: NONE, shipNationalitySlotAttested: attested } = nationality

  // ① 已见号位内的**新形态**照旧判得准：Thonburi 3605x 这一号位撑着整段
  //   （36051 Thonburi / 36052 Thonburi改 是本机主数据快照里的实值）
  for (const sortId of [36050, 36051, 36052, 36053, 36059]) {
    assert.equal(idOf(sortId), 8, `${sortId} 与 Thonburi 同号位，是泰国籍`)
  }
  // 挪威两个号位（Norge 3607 / Eidsvold 3608）同理
  for (const sortId of [36070, 36071, 36072, 36080, 36082, 36089]) {
    assert.equal(idOf(sortId), 9, `${sortId} 与 Norge/Eidsvold 同号位，是挪威籍`)
  }

  // ② 窄段里**没人占过的号位**——正是泰国溢出会落到的那一片——不归任何一国
  for (const sortId of [36060, 36061, 36069, 36090, 36099]) {
    assert.equal(idOf(sortId), 0, `${sortId} 是窄段里的新号位，判不出国籍`)
    assert.equal(bucketOf(sortId), NONE, `${sortId} 该进未归类，而不是挪威`)
  }
  // 泰段自己没占过的号位同样不硬认
  assert.equal(idOf(36000), 0)
  assert.equal(idOf(36049), 0)

  // ③ 整千界的宽段**不受**这条约束：那些界是官方的，不是猜的
  for (const [sortId, expected] of [[1000, 1], [30000, 2], [35000, 7], [36100, 10], [37000, 11], [38000, 12]]) {
    assert.equal(idOf(sortId), expected, `${sortId} 在宽段里，不该被号位判据挡住`)
    assert.equal(attested(expected, sortId), true)
  }

  // ④ 判据本身：只有 8/9 两段是窄段，其余一律放行
  assert.equal(attested(8, 36060), false)
  assert.equal(attested(9, 36060), false)
  assert.equal(attested(9, 36071), true)
  assert.equal(attested(1, 36060), true, '非窄段不看号位')
})
