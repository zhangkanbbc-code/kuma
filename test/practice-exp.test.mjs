import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import practiceExp from '../dist/shared/practice-exp.js'

const {
  practiceBaseExp,
  practiceExpForRank,
  trainingCruiserBonusPct,
  trainingCruiserSetup,
  PRACTICE_RANK_BONUS,
} = practiceExp

// ship-exp 矿脉包是 gitignore 的，没装就跳过那几条依赖真实累计经验的用例
const lodePath = new URL('../assets/lodes/ship-exp.json', import.meta.url)
const lode = fs.existsSync(lodePath) ? JSON.parse(fs.readFileSync(lodePath, 'utf8')).data : null
const cumOf = (level) => lode?.[level]?.[1] ?? null

test('the formula reproduces wikiwiki’s own base-exp table', { skip: !lode }, () => {
  // wikiwiki「演習」的「基本経験値表」第一行：旗舰 Lv1 × 2 号舰 Lv1…150。
  // 这张表是评价补正**前**的值，正好用来钉公式本身。
  const seconds = [1, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 99, 110, 120, 130, 140, 150]
  const expected = [0, 3, 15, 35, 63, 100, 145, 260, 408, 510, 519, 527, 536, 553, 554, 560, 573, 593, 618]
  for (let i = 0; i < seconds.length; i += 1) {
    const got = Math.floor(practiceBaseExp(1, seconds[i], cumOf))
    assert.equal(got, expected[i], `旗舰 Lv1 × 2 号舰 Lv${seconds[i]}`)
  }
})

test('past 500 the curve flattens instead of continuing linearly', () => {
  // 补正前 500 以内是线性，超过之后只按 √ 增长——高练度对手的收益迅速见顶
  const cum = (lv) => ({ 1: 0, 50: 150000, 99: 300000 })[lv] ?? null
  // 150000/100 = 1500 > 500 → 500 + √1000
  const at50 = practiceBaseExp(50, 1, cum)
  assert.ok(Math.abs(at50 - (500 + Math.sqrt(1000))) < 1e-9)
  // 线性段照旧
  const cumLow = (lv) => ({ 1: 0, 20: 19000 }[lv] ?? null)
  assert.ok(Math.abs(practiceBaseExp(20, 1, cumLow) - 190) < 1e-9)
})

test('a single-ship opponent counts as if the second slot were Lv1', () => {
  const cum = (lv) => ({ 1: 0, 30: 43500 }[lv] ?? null)
  assert.equal(practiceBaseExp(30, null, cum), practiceBaseExp(30, 1, cum))
})

test('an unknown level yields nothing rather than a guess', () => {
  const cum = (lv) => (lv === 1 ? 0 : null)
  assert.equal(practiceBaseExp(999, 1, cum), null)
  assert.equal(practiceBaseExp(1, 999, cum), null)
  assert.equal(practiceExpForRank(null, 'S'), null)
  assert.equal(practiceExpForRank(100, 'X'), null) // 没收录的评价不瞎给
})

test('S is worth 1.2x and A/B are flat, and the shown figure is floored', () => {
  assert.equal(PRACTICE_RANK_BONUS.S, 1.2)
  assert.equal(PRACTICE_RANK_BONUS.A, 1)
  assert.equal(PRACTICE_RANK_BONUS.B, 1)
  assert.equal(practiceExpForRank(553.7, 'S'), 664) // floor(664.44)
  assert.equal(practiceExpForRank(553.7, 'A'), 553)
})

test('training cruiser bonus follows placement and level, flagship-only level when both', () => {
  assert.equal(trainingCruiserBonusPct('none', 99), 0)
  assert.equal(trainingCruiserBonusPct('flagship', 1), 5)
  assert.equal(trainingCruiserBonusPct('flagship', 9), 5)
  assert.equal(trainingCruiserBonusPct('flagship', 10), 8)
  assert.equal(trainingCruiserBonusPct('flagship', 60), 15)
  assert.equal(trainingCruiserBonusPct('flagship', 100), 20)
  assert.equal(trainingCruiserBonusPct('escort', 60), 10)
  assert.equal(trainingCruiserBonusPct('escort', 150), 15)
  // 旗舰+随伴时表更高，且只看旗舰练度
  assert.equal(trainingCruiserBonusPct('both', 30), 16)
  assert.equal(trainingCruiserBonusPct('both', 120), 25)
})

test('training cruiser setup reads fleet order: flag level wins, escorts take the highest', () => {
  // di 演习卡 / ru 场次换算 / 账本样本归一共用；输入按舰队位序（0 位 = 旗舰）
  const tc = (lv) => ({ stype: 21, lv })
  const dd = (lv) => ({ stype: 2, lv })
  assert.deepEqual(trainingCruiserSetup([dd(50), dd(60)]), { placement: 'none', level: 0, bonusPct: 0 })
  assert.deepEqual(trainingCruiserSetup([tc(99), dd(60)]), { placement: 'flagship', level: 99, bonusPct: 15 })
  // 只有随伴：取练度最高的那只
  assert.deepEqual(trainingCruiserSetup([dd(60), tc(30), tc(85)]), { placement: 'escort', level: 85, bonusPct: 10 })
  // 旗舰+随伴：只看旗舰练度（随伴 Lv150 不参与）
  assert.deepEqual(trainingCruiserSetup([tc(100), tc(150)]), { placement: 'both', level: 100, bonusPct: 25 })
  // 舰种未知（stype null）不当练巡
  assert.deepEqual(trainingCruiserSetup([{ stype: null, lv: 99 }]), { placement: 'none', level: 0, bonusPct: 0 })
  assert.deepEqual(trainingCruiserSetup([]), { placement: 'none', level: 0, bonusPct: 0 })
})
