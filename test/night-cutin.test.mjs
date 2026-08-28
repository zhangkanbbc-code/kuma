import assert from 'node:assert/strict'
import test from 'node:test'

const { nightCutinsOf } = await import('../src/shared/night-cutin.ts')

// 造装备的小工具：只填判定用得到的字段
const main = () => ({ mstId: 9101, type2: 3, name: '主砲', los: 0 })
const mediumMain = () => ({ mstId: 9102, type2: 2, name: '中口径主砲', los: 0 })
const secondary = () => ({ mstId: 9103, type2: 4, name: '副砲', los: 0 })
const torp = () => ({ mstId: 9104, type2: 5, name: '魚雷', los: 0 })
const subLateTorp = () => ({ mstId: 213, type2: 32, name: '後期型艦首魚雷(6門)', los: 0 })
const subPlainTorp = () => ({ mstId: 9105, type2: 32, name: '61cm潜水艦魚雷', los: 0 })
const subRadar = () => ({ mstId: 210, type2: 51, name: '潜水艦搭載電探&水防式望遠鏡', los: 4 })
const radar5 = () => ({ mstId: 9106, type2: 12, name: 'SG レーダー', los: 8 })
const radarWeak = () => ({ mstId: 27, type2: 12, name: '13号対空電探', los: 3 })
const midget = () => ({ mstId: 41, type2: 22, name: '甲標的 甲型', los: 0 })
const lookout = () => ({ mstId: 129, type2: 39, name: '熟練見張員', los: 2 })
const squadronLookout = () => ({ mstId: 412, type2: 39, name: '水雷戦隊 熟練見張員', los: 2 })
const drum = () => ({ mstId: 75, type2: 30, name: 'ドラム缶(輸送用)', los: 0 })
const d2 = () => ({ mstId: 267, type2: 1, name: '12.7cm連装砲D型改二', los: 0 })
const d3 = () => ({ mstId: 366, type2: 1, name: '12.7cm連装砲D型改三', los: 0 })
const nightZuiun = () => ({ mstId: 490, type2: 11, name: '試製 夜間瑞雲(攻撃装備)', los: 7 })

const rolled = (kinds) => kinds.filter((kind) => kind.rolled).map((kind) => kind.id)

test('汎用夜战种别:同满足只判倍率最高,連撃最下位', () => {
  // 例1(wikiwiki 原文):主3副1 满足 主主主/主主副/連撃,只判 主主主
  const heavy = nightCutinsOf(9, [main(), main(), main(), secondary()])
  assert.deepEqual(rolled(heavy), ['mainMainMain'])
  assert.ok(!heavy.some((kind) => kind.id === 'double'), '満足 CI 时連撃不再列出')
  // 主2副1 → 主主副 1.75
  assert.deepEqual(rolled(nightCutinsOf(9, [main(), mediumMain(), secondary()])), ['mainMainSecondary'])
  // 判定实例表:主2魚2 → 魚雷CI(1.5 高于主魚 1.3)
  assert.deepEqual(rolled(nightCutinsOf(5, [main(), main(), torp(), torp()])), ['torpTorp'])
  // 判定实例表:主2魚1 → 主魚CI(非連撃)
  assert.deepEqual(rolled(nightCutinsOf(5, [main(), main(), torp()])), ['mainTorp'])
  // 主2 无其它 → 連撃
  assert.deepEqual(rolled(nightCutinsOf(9, [main(), main()])), ['double'])
  // 甲標的不算魚雷:魚1+甲標的 凑不出魚雷CI,主0 也没有主魚 → 无特殊攻击
  assert.deepEqual(nightCutinsOf(3, [torp(), midget()]), [])
})

test('驱逐专用 CI 与汎用并行判定,D 型砲補正照抄原表', () => {
  // 主1魚1電(索敵≥5):主魚電 + 汎用主魚 都参与判定(wiki 例3)
  const dd = nightCutinsOf(2, [main(), torp(), radar5()])
  assert.deepEqual(rolled(dd).sort(), ['ddMainTorpRadar', 'mainTorp'])
  // 素索敵不足 5 的電探不触发主魚電
  assert.deepEqual(rolled(nightCutinsOf(2, [main(), torp(), radarWeak()])), ['mainTorp'])
  // D型改二×1:1.3 → 1.625;D型改三×2:→ 2.002(照抄原表)
  const withD2 = nightCutinsOf(2, [d2(), torp(), radar5()])
  assert.equal(withD2.find((kind) => kind.id === 'ddMainTorpRadar').multiplier, 1.625)
  const withD3x2 = nightCutinsOf(2, [d3(), d3(), torp(), radar5()])
  assert.equal(withD3x2.find((kind) => kind.id === 'ddMainTorpRadar').multiplier, 2.002)
  // 魚見電:普通熟練見張員即可;魚魚水/魚ド水要求水雷戦隊版
  const lookoutCi = nightCutinsOf(2, [torp(), lookout(), radar5()])
  assert.ok(rolled(lookoutCi).includes('ddTorpLookoutRadar'))
  assert.ok(!rolled(nightCutinsOf(2, [torp(), torp(), lookout()])).includes('ddTorpTorpLookout'))
  assert.ok(rolled(nightCutinsOf(2, [torp(), torp(), squadronLookout()])).includes('ddTorpTorpLookout'))
  assert.ok(rolled(nightCutinsOf(2, [torp(), drum(), squadronLookout()])).includes('ddTorpDrumLookout'))
  // 非驱逐舰种不给驱逐专用
  assert.ok(!rolled(nightCutinsOf(3, [main(), torp(), radar5()])).includes('ddMainTorpRadar'))
})

test('潜艇专用进同一倍率池:後期+電探只判 1.75(wiki 例2)', () => {
  const ss = nightCutinsOf(13, [subLateTorp(), subLateTorp(), subRadar()])
  assert.deepEqual(rolled(ss), ['ssRadarTorp'])
  assert.deepEqual(
    ss.map((kind) => kind.id).sort(),
    ['ssLateTorp', 'ssRadarTorp', 'torpTorp'],
    '满足的三种都列出,只有 1.75 参与判定',
  )
  // 非後期潜水艦魚雷×2 → 普通魚雷CI
  assert.deepEqual(rolled(nightCutinsOf(14, [subPlainTorp(), subPlainTorp()])), ['torpTorp'])
  // 水面舰不吃潜艇条目
  assert.ok(!nightCutinsOf(2, [subLateTorp(), subRadar()]).some((kind) => kind.scope === 'ss'))
})

test('夜間瑞雲CI:限定舰种,×2+電探提到 1.36,与汎用并行', () => {
  const cl = nightCutinsOf(3, [main(), mediumMain(), nightZuiun(), nightZuiun(), radar5()])
  const zuiun = cl.find((kind) => kind.id === 'nightZuiun')
  assert.equal(zuiun?.multiplier, 1.36)
  assert.ok(zuiun?.rolled)
  assert.ok(rolled(cl).includes('double'), '汎用連撃仍参与判定')
  assert.equal(nightCutinsOf(3, [main(), mediumMain(), nightZuiun()]).find((kind) => kind.id === 'nightZuiun')?.multiplier, 1.24)
  // 驱逐不在夜間瑞雲的舰种表里
  assert.ok(!nightCutinsOf(2, [main(), mediumMain(), nightZuiun()]).some((kind) => kind.id === 'nightZuiun'))
})
