// 编成行里的舰载机搭载角标按余量分绿/黄/红三档（2026-08-28 用户点的）。
//
// 用户原话：「编队模块里面，搭载的字体随着搭载格数内的飞机数量下降而变化为绿黄红」。
//
// 断点不是这里拍的：镜像同一行右边那根血条（ru 的 hpClassOf，与 shared/battle-damage
// 的 damageTierOf 同一套 0.75 / 0.5 / 0.25），三色用得下的两个断点就是 0.75 与 0.5。
// 要改口径先去改 ru.ts 那段头注，别只改这里的期望值。
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  GUN_ICON_ID,
  PLANE_ICON_ID,
  badgesOf,
  planeLoadBand,
  renderEquipChips,
  reset,
} from './fixtures/render-plane-load.mjs'

// ---- 分档纯函数：断点落在哪一侧 ----

test('三档的断点：>75% 绿、>50% 黄、其余红', () => {
  // 满格与接近满都是绿：血条 hp-g 那一档
  assert.equal(planeLoadBand(24, 24), 'g')
  assert.equal(planeLoadBand(19, 24), 'g', '19/24 ≈ 79% 还在绿档')

  // 0.75 是**闭在黄这边**的，与 hpClassOf 的 `r <= 0.75 ? 'hp-y'` 同向
  assert.equal(planeLoadBand(18, 24), 'y', '18/24 = 恰好 75%，归黄不归绿')
  assert.equal(planeLoadBand(13, 24), 'y')

  // 0.5 同理闭在红这边
  assert.equal(planeLoadBand(12, 24), 'r', '12/24 = 恰好 50%，归红不归黄')
  assert.equal(planeLoadBand(1, 24), 'r')
})

test('比例不是反的：小分子配大分母才是红', () => {
  // 算反了（capacity / onslot）会让 1/24 变成 24 → 绿。方向钉死。
  assert.equal(planeLoadBand(1, 24), 'r')
  assert.equal(planeLoadBand(24, 1), 'g')
})

test('分母取不到就不上色，不硬报一档', () => {
  assert.equal(planeLoadBand(6, 0), null, '上限 0：报哪一档都是编的')
  assert.equal(planeLoadBand(6, -1), null)
  assert.equal(planeLoadBand(6, Number.NaN), null)
  // 搭载 0 的格本来就不出角标，走到这里也不上色
  assert.equal(planeLoadBand(0, 24), null)
})

// ---- 渲染路径：档位真的落到角标上 ----

const ZUIHO_MAX_EQ = [18, 15, 15, 2] // 瑞鳳改二乙（mst 560）主数据标准搭载

test('一行里三档同时在场，各自挂各自的类', () => {
  // 18/18 满=绿、10/15 ≈ 67%=黄、7/15 ≈ 47%=红、2/2 满=绿
  reset(ZUIHO_MAX_EQ, [18, 10, 7, 2])
  assert.deepEqual(badgesOf(renderEquipChips()), [
    ['g', 18],
    ['y', 10],
    ['r', 7],
    ['g', 2],
  ])
})

test('搭载数本身一个字没变：只是多了个颜色类', () => {
  reset(ZUIHO_MAX_EQ, [18, 10, 7, 2])
  assert.deepEqual(
    badgesOf(renderEquipChips()).map(([, count]) => count),
    [18, 10, 7, 2],
    '角标写的还是实载数，不许被上限或百分比顶替',
  )
})

test('搭载 0 的格照旧不出角标（这一族与加这个功能之前逐字一致）', () => {
  reset(ZUIHO_MAX_EQ, [18, 0, 0, 0])
  assert.deepEqual(badgesOf(renderEquipChips()), [['g', 18]], '被打光的三格不该冒出「0」')
})

test('非舰载机格不出角标，也就无所谓上色', () => {
  // 第 2 格换成小口径主砲：onslot 有值也不出角标
  reset(ZUIHO_MAX_EQ, [18, 15, 15, 2], {
    iconIds: [PLANE_ICON_ID, GUN_ICON_ID, PLANE_ICON_ID, PLANE_ICON_ID],
  })
  assert.deepEqual(badgesOf(renderEquipChips()), [
    ['g', 18],
    ['g', 15],
    ['g', 2],
  ])
})

// ---- 分母口径：扩过的舰读实例一手上限 ----
//
// 这一组是「拿主数据 maxEq 当分母」那种错法唯一照得出来的地方。

test('格納庫増設扩过的格：分母是实例一手上限，不是主数据原量', () => {
  // 第 4 格 2 → 5（扩了 3），现在装了 3 机。
  // 按一手上限 3/5 = 60% → 黄；按主数据原量 3/2 = 150% → 会错报成绿。
  reset(ZUIHO_MAX_EQ, [18, 15, 15, 3], { onslotMax: [18, 15, 15, 5] })
  assert.deepEqual(badgesOf(renderEquipChips())[3], ['y', 3])
})

test('扩过的格补满了就是绿（分母跟着抬高，不会永远差一截）', () => {
  reset(ZUIHO_MAX_EQ, [18, 15, 15, 5], { onslotMax: [18, 15, 15, 5] })
  assert.deepEqual(badgesOf(renderEquipChips())[3], ['g', 5])
})

test('没扩过的舰回落主数据 maxEq：连 onslotMax 这个键都没有', () => {
  // onslotMax 是稀疏字段，绝大多数舰根本没有它——这一路必须照样分得出档
  reset(ZUIHO_MAX_EQ, [18, 15, 15, 1])
  assert.deepEqual(badgesOf(renderEquipChips()), [
    ['g', 18],
    ['g', 15],
    ['g', 15],
    ['r', 1],
  ])
})

test('onslotMax 比槽位短时那几格回落，不当成上限 0', () => {
  // 越界项是 undefined 不是 0：当成 0 会让后面几格全变成「分母取不到」而失色
  reset(ZUIHO_MAX_EQ, [18, 15, 15, 2], { onslotMax: [18, 15] })
  assert.deepEqual(badgesOf(renderEquipChips()), [
    ['g', 18],
    ['g', 15],
    ['g', 15],
    ['g', 2],
  ])
})
