import assert from 'node:assert/strict'
import test from 'node:test'

const { isSearchlight, isStarShell, nightCutinRate, nightCutinScoreOf, nightCutinsOf } =
  await import('../src/shared/night-cutin.ts')

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

// ---- 発動率（CI項 ÷ 種別係数）----

const kindOf = (stype, equips, id) => {
  const found = nightCutinsOf(stype, equips).find((kind) => kind.id === id)
  assert.ok(found, `没找到种别 ${id}`)
  return found
}

test('CI項:wikiwiki 的两个算例都收敛到 115,正好卡在主魚CI 係数的临界', () => {
  // 例一 時雨改三 Lv128 運58 旗艦 探照灯 照明弾 熟練見張員 水雷戦隊見張員
  //   int(65 + √(58-50) + 0.8×√128) + 15 + 7 + 4 + 5 + 8 = 76 + 39 = 115
  const shigure = nightCutinScoreOf({
    level: 128, luck: 58, stype: 2, flagship: true,
    friendlySearchlight: true, friendlyStarShell: true, lookout: true, squadronLookout: true,
  })
  assert.equal(shigure.base, 76)
  assert.equal(shigure.score, 115)
  // 例二 Ташкент改：素CI項 74 + 旗艦15 + 中破18 + 水雷戦隊見張員8 = 115
  //   運51 Lv100 → 65 + ⌊√1⌋ + ⌊0.8×√100⌋ = 65 + 1 + 8 = 74
  const tashkent = nightCutinScoreOf({
    level: 100, luck: 51, stype: 2, flagship: true, chuuha: true, squadronLookout: true,
  })
  assert.equal(tashkent.base, 74)
  assert.equal(tashkent.score, 115)

  // 这个 115 落在主魚CI 係数 115 上 = 発動率正好 100%。2024 年那轮検証的核心观测点,
  // 也是「係数是 115 不是 116」那场反复的落点
  const mainTorp = kindOf(2, [main(), torp()], 'mainTorp')
  assert.equal(mainTorp.divisor, 115)
  assert.equal(nightCutinRate(115, mainTorp), 100)
})

test('CI項:運50 是分界,実用上 51 才开始有贡献', () => {
  const at = (luck) => nightCutinScoreOf({ level: 100, luck, stype: 2, flagship: false }).base
  // 運<50 那条式子:15 + 運 + ⌊0.75×√Lv⌋。運49 Lv100 → 15+49+7 = 71
  assert.equal(at(49), 15 + 49 + Math.floor(0.75 * 10))
  // 運50 → 65 + ⌊√0⌋ + ⌊0.8×√100⌋ = 73;運51 才多那个 √1
  assert.equal(at(50), 73)
  assert.equal(at(51), 74)
  // 運49→50 这一跳是式子换挡,不是渐变
  assert.ok(at(50) > at(49))
})

test('各種補正照抄原表:两种見張員叠加,水雷戦隊版只对駆逐/軽巡/雷巡有效', () => {
  const base = { level: 100, luck: 20, flagship: false }
  const of = (over) => nightCutinScoreOf({ ...base, stype: 2, ...over }).score
  const plain = of({})
  assert.equal(of({ flagship: true }) - plain, 15, '旗艦 +15')
  assert.equal(of({ chuuha: true }) - plain, 18, '中破 +18')
  assert.equal(of({ friendlySearchlight: true }) - plain, 7, '味方探照灯 +7')
  assert.equal(of({ friendlyStarShell: true }) - plain, 4, '味方照明弾 +4')
  assert.equal(of({ enemySearchlight: true }) - plain, -5, '相手探照灯 -5')
  assert.equal(of({ enemyStarShell: true }) - plain, -10, '相手照明弾 -10')
  assert.equal(of({ lookout: true }) - plain, 5, '熟練見張員 +5')
  assert.equal(of({ squadronLookout: true }) - plain, 8, '水雷戦隊 熟練見張員 +8')
  // 两个都装就两个都加（2024-01 才定的结论,早前一度以为不叠加）
  assert.equal(of({ lookout: true, squadronLookout: true }) - plain, 13)
  // 水雷戦隊版在駆逐(2)/軽巡(3)/雷巡(4)之外一律 +0;熟練見張員版不挑舰种
  for (const stype of [5, 6, 9, 11]) {
    assert.equal(
      nightCutinScoreOf({ ...base, stype, squadronLookout: true }).score,
      nightCutinScoreOf({ ...base, stype }).score,
      `舰种 ${stype} 不该吃水雷戦隊見張員的 +8`,
    )
    assert.equal(
      nightCutinScoreOf({ ...base, stype, lookout: true }).score -
        nightCutinScoreOf({ ...base, stype }).score,
      5,
    )
  }
  // 值为 0 的项不进明细（界面照这张表逐条列,列一堆 +0 是噪音）
  assert.deepEqual(nightCutinScoreOf({ ...base, stype: 2 }).corrections, [])
  assert.deepEqual(
    nightCutinScoreOf({ ...base, stype: 2, flagship: true, enemyStarShell: true }).corrections,
    [{ label: '旗舰', value: 15 }, { label: '敌方照明弹', value: -10 }],
  )
})

test('夜間瑞雲CI 不套通用探照灯正补正', () => {
  const base = { level: 99, luck: 20, stype: 3, flagship: false }
  const plain = nightCutinScoreOf(base)
  assert.equal(
    nightCutinScoreOf({ ...base, friendlySearchlight: true, nightZuiun: true }).score,
    plain.score,
  )
  assert.equal(
    nightCutinScoreOf({ ...base, friendlySearchlight: true }).score - plain.score,
    7,
    '其它夜战 CI 仍保留通用 +7',
  )
})

test('種別係数照抄原表,置信度分两档;連撃没有係数', () => {
  const table = [
    [9, [main(), main(), main()], 'mainMainMain', 140],
    [9, [main(), main(), secondary()], 'mainMainSecondary', 130],
    [3, [torp(), torp()], 'torpTorp', 122],
    [3, [main(), torp()], 'mainTorp', 115],
    [2, [main(), torp(), radar5()], 'ddMainTorpRadar', 115],
    [2, [torp(), lookout(), radar5()], 'ddTorpLookoutRadar', 140],
    [2, [torp(), torp(), squadronLookout()], 'ddTorpTorpLookout', 126],
    [2, [torp(), drum(), squadronLookout()], 'ddTorpDrumLookout', 122],
    [3, [main(), mediumMain(), nightZuiun()], 'nightZuiun', 135],
  ]
  for (const [stype, equips, id, divisor] of table) {
    const kind = kindOf(stype, equips, id)
    assert.equal(kind.divisor, divisor, `${id} 的種別係数`)
    assert.equal(kind.divisorConfidence, 'sourced', `${id} 该是 wikiwiki 現行表明数`)
  }
  // 潜水艦専用係数:wikiwiki 自己列在「要検証事項」,标 unverified
  const ss = kindOf(13, [subLateTorp(), subRadar()], 'ssRadarTorp')
  assert.equal(ss.divisor, 105)
  assert.equal(ss.divisorConfidence, 'unverified')
  assert.equal(kindOf(13, [subLateTorp(), subLateTorp()], 'ssLateTorp').divisor, 110)
  // 夜战連撃**没有係数**:上游把它列在「要検証事項」,唯一来源是 2015 年的 BBS 帖,
  // 且原文注明「カットインとは大幅に傾向が異なる」——不适用这套 CI項/係数
  const double = kindOf(9, [main(), main()], 'double')
  assert.equal(double.divisor, null)
  assert.equal(nightCutinRate(200, double), null, '没有係数就不许编一个数出来')
})

test('発動率不封顶,封顶是展示层的事', () => {
  // Lv175 Grecale改(運120) 旗艦 + 中破 + 探照灯 ⇒ CI項 > 魚雷CI 係数 122
  const scored = nightCutinScoreOf({
    level: 175, luck: 120, stype: 2, flagship: true, chuuha: true, friendlySearchlight: true,
  })
  const torpCi = kindOf(3, [torp(), torp()], 'torpTorp')
  assert.ok(scored.score > torpCi.divisor)
  assert.ok(nightCutinRate(scored.score, torpCi) > 100)
})

test('探照灯与照明弾的装备类别判据', () => {
  assert.ok(isSearchlight(29), '探照灯')
  assert.ok(isSearchlight(42), '大型探照灯同档')
  assert.ok(!isSearchlight(33))
  assert.ok(isStarShell(33), '照明弾')
  assert.ok(!isStarShell(29))
})
