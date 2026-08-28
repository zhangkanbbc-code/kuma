// 高角炮不再混进「小口径主炮」（2026-08-25 用户实机报）。
//
// ---- 机理 ----
// 游戏的装备筛选把**小口径主炮**与**高角炮**分开列，而主数据里这两族的
// `api_type[2]` 同为 1（小口径主砲），差别只在 `api_type[3]` 图标号：
//     12.7cm連装砲   [1,1,1, 1,0]
//     10cm連装高角砲 [1,1,1,16,0]
// 艦素原先所有「按类别精确筛选」都只看 api_type[2]，于是点「小口径主炮」
// 翻出一堆高角炮。
//
// ---- 判据不是新发明的 ----
// 图标 16 这条判据 `shared/ship-special-attack` 早就在用（`isHighAngleMount = iconIs(16)`，
// 判对空カットイン）。中文名取仓里既有译名台账（scripts/localization.mjs 的
// 「高角砲 → 高角炮」），不新造词。
//
// ---- 四族全拆（2026-08-25 用户裁决）----
// 头一版只拆了种别 1，其余三族「没实测过就不动」。用户当天拍板：
// **「这个 icon 的图标意思就是高角炮，毋庸置疑是高角炮类」**——于是不分种别。
// 主数据全量实测，图标 16 散在四个种别里：1 小口径 29 件 / 2 中口径 3 件 /
// 3 大口径 1 件（深海15inch連装砲後期型）/ 4 副砲 16 件，合计 49 件。
// 深海那一件按图标一致性同样归高角炮（玩家在游戏里看不到深海装备的分类，
// 另立标准只会多一个永远没实测能校准的分支）。
// 下面那条全量断言把「四族一件不落」钉住，也钉住反向的「非 16 的一件都别动」。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import highAngle from '../dist/shared/equip-high-angle.js'

const {
  HIGH_ANGLE_CATEGORY,
  HIGH_ANGLE_CATEGORY_NAME,
  HIGH_ANGLE_ICON,
  effectiveEquipCategory,
  equipCategoryFallbackName,
} = highAngle

const masterItems = () => {
  const file = new URL('../../s2.json', import.meta.url)
  if (!fs.existsSync(file)) return null
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  return (raw.api_data ?? raw).api_mst_slotitem ?? null
}

test('用户点名的那两件各落对类', () => {
  // 10cm連装高角砲 [1,1,1,16,0] / 12.7cm連装砲 [1,1,1,1,0]
  assert.equal(effectiveEquipCategory(1, 16), HIGH_ANGLE_CATEGORY, '10cm連装高角砲 还在小口径主炮里')
  assert.equal(effectiveEquipCategory(1, 1), 1, '12.7cm連装砲 被踢出小口径主炮了')
})

test('合成类别号撞不上任何真类别，名字取既有译名', () => {
  assert.ok(HIGH_ANGLE_CATEGORY < 0, '合成类别号必须是负数，否则会跟主数据的 equiptype id 撞车')
  assert.equal(HIGH_ANGLE_CATEGORY_NAME, '高角炮')
  assert.equal(equipCategoryFallbackName(HIGH_ANGLE_CATEGORY), '高角炮')
  assert.equal(equipCategoryFallbackName(1, '小口径主砲'), '小口径主砲', '真类别的名字被改掉了')
  assert.equal(equipCategoryFallbackName(999), '分类999')
})

test('主数据全量：小口径主炮组里一件高角炮都不剩', (t) => {
  const items = masterItems()
  if (!items) {
    t.skip('找不到 s2.json 主数据快照')
    return
  }
  const smallGuns = items.filter((one) => Array.isArray(one.api_type) && one.api_type[2] === 1)
  assert.ok(smallGuns.length > 40, `种别 1 只有 ${smallGuns.length} 件？样本不对`)

  const stillMixed = smallGuns.filter(
    (one) => one.api_type[3] === HIGH_ANGLE_ICON && effectiveEquipCategory(one.api_type[2], one.api_type[3]) === 1,
  )
  assert.deepEqual(stillMixed.map((one) => one.api_name), [], '还有高角炮留在小口径主炮组里')

  // 反向：真·小口径主炮一件都不许被误踢出去
  const wronglyMoved = smallGuns.filter(
    (one) => one.api_type[3] !== HIGH_ANGLE_ICON && effectiveEquipCategory(one.api_type[2], one.api_type[3]) !== 1,
  )
  assert.deepEqual(wronglyMoved.map((one) => one.api_name), [], '真·小口径主炮被误分出去了')

  // 两族都得有人，否则说明判据把整类扫光了
  const highAngle = smallGuns.filter((one) => effectiveEquipCategory(one.api_type[2], one.api_type[3]) === HIGH_ANGLE_CATEGORY)
  const plain = smallGuns.filter((one) => effectiveEquipCategory(one.api_type[2], one.api_type[3]) === 1)
  assert.ok(highAngle.length > 0 && plain.length > 0, `拆完之后 高角炮${highAngle.length} / 小口径${plain.length}`)
})

test('主数据全量：凡图标 16 一律落高角炮类，四个种别一件不落', (t) => {
  const items = masterItems()
  if (!items) {
    t.skip('找不到 s2.json 主数据快照')
    return
  }
  const typed = items.filter((one) => Array.isArray(one.api_type))
  const icon16 = typed.filter((one) => one.api_type[3] === HIGH_ANGLE_ICON)
  // 判据的样本面：四个种别都得在场，少一族就说明主数据变了、这条断言该重新对
  const spread = [...new Set(icon16.map((one) => one.api_type[2]))].sort((a, b) => a - b)
  assert.deepEqual(spread, [1, 2, 3, 4], `图标 16 现在散在 ${spread} 这几个种别里，与实测的四族对不上`)
  // 下界不是等号：官方每次加装备这个数都会涨，钉死等号等于让下一次主数据更新变红。
  // 掉到 49 以下才是真出事（判据被改窄、或主数据快照残缺）。
  assert.ok(icon16.length >= 49, `图标 16 只有 ${icon16.length} 件，实测那次是 49 件`)

  const missed = icon16.filter(
    (one) => effectiveEquipCategory(one.api_type[2], one.api_type[3]) !== HIGH_ANGLE_CATEGORY,
  )
  assert.deepEqual(
    missed.map((one) => `${one.api_name}（种别 ${one.api_type[2]}）`),
    [],
    '图标是高角，却没落进高角炮类',
  )
})

test('主炮组与副砲组里都不再剩高角炮，而非 16 的一件都没被动', (t) => {
  const items = masterItems()
  if (!items) {
    t.skip('找不到 s2.json 主数据快照')
    return
  }
  const typed = items.filter((one) => Array.isArray(one.api_type))
  // 用户报的病症：按某一类筛，翻出一堆高角炮。四个种别逐个复查。
  for (const type2 of [1, 2, 3, 4]) {
    const group = typed.filter(
      (one) => effectiveEquipCategory(one.api_type[2], one.api_type[3]) === type2,
    )
    const dirty = group.filter((one) => one.api_type[3] === HIGH_ANGLE_ICON)
    assert.deepEqual(dirty.map((one) => one.api_name), [], `种别 ${type2} 里还留着高角炮`)
    assert.ok(group.length > 0, `种别 ${type2} 被判据扫空了`)
  }
  // 反向：图标不是 16 的，一件都不许被挪走
  const wronglyMoved = typed.filter(
    (one) =>
      one.api_type[3] !== HIGH_ANGLE_ICON &&
      effectiveEquipCategory(one.api_type[2], one.api_type[3]) !== one.api_type[2],
  )
  assert.deepEqual(wronglyMoved.map((one) => one.api_name), [], '图标不是高角的装备被挪走了')
})

test('chip 那一层不动：高角炮在分组意义上照旧算主炮', () => {
  // 拆的是「精确类别」这一层。制空、弹着观测那些照旧按 api_type[2] 走，
  // 高角炮本来就是主炮，chip 跟着改会把一堆东西改坏。
  // equipChipMatches 住在渲染层（打包产物里没有单独模块），这里钉它的口径没被改动。
  const src = fs.readFileSync(new URL('../src/renderer/equip-category.ts', import.meta.url), 'utf8')
  assert.ok(src.includes('主炮: [1, 2, 3, 38, 95]'), 'chip 的主炮名单被动过了——高角炮会掉出主炮组')
  assert.ok(
    src.includes('export const equipChipMatches = (chip: string, type2: number, type0 = -1): boolean =>'),
    'equipChipMatches 的签名变了，chip 层可能已经被卷进这次拆分',
  )
})

test('三处筛选面都改用有效类别（图鉴 / 仓库 / 实体路由）', () => {
  const ji = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const stock = fs.readFileSync(new URL('../src/renderer/modules/equip-stock.ts', import.meta.url), 'utf8')
  // 图鉴：精确筛选谓词、更多分类计数、目录分组抬头、实体路由速览
  assert.ok(ji.includes('const equipCategoryOf = (e: any): number =>'), '图鉴缺有效类别取值器')
  assert.ok(
    ji.includes('if (equipState.typeFilter && equipCategoryOf(e) !== equipState.typeFilter) return false'),
    '图鉴的精确筛选还在按种别判',
  )
  assert.ok(ji.includes('const cat = equipCategoryOf(item)'), '更多分类的计数还在按种别')
  assert.ok(ji.includes('(equip) => equipCategoryOf(equip) === typeId'), '实体路由速览还在按种别数')
  // 仓库
  assert.ok(
    stock.includes('effectiveEquipCategory(r.type2, r.iconId) === state.typeFilter'),
    '仓库的精确筛选还在按种别判',
  )
  assert.ok(
    stock.includes('const category = effectiveEquipCategory(row.type2, row.iconId)'),
    '仓库的更多分类计数还在按种别',
  )
})
