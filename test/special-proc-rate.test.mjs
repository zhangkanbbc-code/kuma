import assert from 'node:assert/strict'
import test from 'node:test'

import procModule from '../dist/shared/special-proc-rate.js'
import abilityModule from '../dist/shared/ship-special-attack.js'

const {
  AACI_RATE_EVIDENCE,
  PROC_RATE_GROUP_ORDER,
  PROC_RATE_UNKNOWN_NOTE,
  aaciEntriesOf,
  barrageEntryOf,
  dayEntriesOf,
  fleetHasSearchlight,
  nightEntriesOf,
  procRateGroupsOf,
  procRatesOf,
} = procModule
const { ROCKET_LAUNCHER_K2_MST_ID } = abilityModule

const equip = (over = {}) => ({
  mstId: 0, type2: 0, iconId: 0, name: '', antiAir: 0, asw: 0, los: 0, level: 0, planeCount: 0,
  houm: 0, saku: 0, largeSearchlight: false, surfaceRadar: false,
  ...over,
})

// 12cm30連装噴進砲改二：大分类 21（対空機銃）、图标 15、素対空 8
const rocket = (level = 0) =>
  equip({ mstId: ROCKET_LAUNCHER_K2_MST_ID, type2: 21, iconId: 15, name: '12cm30連装噴進砲改二', antiAir: 8, level })
const aaGun = (level = 0) => equip({ mstId: 37, type2: 21, iconId: 15, name: '25mm三連装機銃', antiAir: 6, level })
const aaRadar = (level = 0) => equip({ mstId: 27, type2: 12, iconId: 11, name: '13号対空電探', antiAir: 4, los: 3, level })
const highAngle = (antiAir = 5) => equip({ mstId: 122, iconId: 16, name: '10cm連装高角砲+高射装置', antiAir })
const aaFireDirector = () => equip({ mstId: 121, type2: 36, name: '94式高射装置' })
const mainGun = () => equip({ mstId: 9101, type2: 3, name: '41cm連装砲', los: 0 })
const secondary = () => equip({ mstId: 9103, type2: 4, name: '15.5cm三連装副砲' })
const torpedo = () => equip({ mstId: 9104, type2: 5, name: '61cm四連装(酸素)魚雷' })
const seaplane = (los = 9, planeCount = 3) =>
  equip({ mstId: 9110, type2: 10, name: '零式水上偵察機', los, planeCount })
const radar5 = () => equip({ mstId: 9106, type2: 12, name: 'SG レーダー(初期型)', los: 8 })
const lookout = () => equip({ mstId: 129, type2: 39, name: '熟練見張員', los: 2 })
const searchlight = () => equip({ mstId: 74, type2: 29, name: '96式150cm探照灯' })
const nightZuiun = () => equip({ mstId: 490, type2: 11, name: '試製 夜間瑞雲(攻撃装備)', los: 7 })

// 日向改：mstId 88、stype 10（航空戦艦）、ctype 2（伊勢型）——+25 那条唯一实测过的舰
const hyuugaKai = (over = {}) => ({
  mstId: 88, name: '日向改', stype: 10, ctype: 2, slotNum: 5, kai: true, asw: 0,
  level: 99, luck: 20, hp: 80, hpMax: 80,
  flagship: false, baseAntiAir: 84, equipment: [], ...over,
})
// 伊勢改二：mstId 553、同 ctype 2，但 +25 在它身上是外推
const iseKai2 = (over = {}) => hyuugaKai({ mstId: 553, ...over })
const destroyer = (over = {}) => ({
  mstId: 145, name: '时雨改二', stype: 2, ctype: 23, slotNum: 3, kai: true, asw: 0,
  level: 100, luck: 51, hp: 35, hpMax: 35,
  flagship: false, baseAntiAir: 20, equipment: [], ...over,
})
const noFleet = { losCorrection: 0, searchlight: false, role: 'normal', ships: [] }

const byId = (entries, id) => entries.find((entry) => entry.id === id)
const faceOf = (entry) => entry.rate === null ? '?' : `${entry.rate.toFixed(0)}%`

test('对空CI 证据表覆盖 1..53，分级与缺数保持原表口径', () => {
  assert.deepEqual(
    AACI_RATE_EVIDENCE.map((entry) => entry.id),
    Array.from({ length: 53 }, (_, index) => index + 1),
  )
  assert.deepEqual(
    Object.fromEntries(
      ['A', 'B', 'C'].map((confidence) => [
        confidence,
        AACI_RATE_EVIDENCE.filter((entry) => entry.confidence === confidence).length,
      ]),
    ),
    { A: 46, B: 2, C: 5 },
  )
  for (const id of [48, 49, 50, 51, 52]) {
    assert.equal(byId(AACI_RATE_EVIDENCE, id).rate, null, `${id} 号应为未知，不是 0`)
  }
  assert.deepEqual(
    (({ rate, success, total, source, date }) => ({ rate, success, total, source, date }))(
      byId(AACI_RATE_EVIDENCE, 1),
    ),
    {
      rate: 64.97,
      success: 18311,
      total: 28183,
      source: 'CC_jabberwock / POI DB',
      date: '2023-06',
    },
  )
  assert.deepEqual(
    (({ rate, confidence, total, sourceNote }) => ({ rate, confidence, total, sourceNote }))(
      byId(AACI_RATE_EVIDENCE, 47),
    ),
    { rate: 70, confidence: 'B', total: 140, sourceNote: '原表 70%?' },
  )
  assert.deepEqual(
    (({ rate, confidence, total, sourceNote }) => ({ rate, confidence, total, sourceNote }))(
      byId(AACI_RATE_EVIDENCE, 53),
    ),
    { rate: 60, confidence: 'B', total: 60, sourceNote: '原表 60％前後' },
  )
  assert.equal(byId(AACI_RATE_EVIDENCE, 42).rate, 72.73)
  assert.equal(byId(AACI_RATE_EVIDENCE, 44).rate, 80.00)
})

test('展示族顺序以 special 开头，同族全未知时取判定顺序第一条', () => {
  assert.deepEqual(PROC_RATE_GROUP_ORDER, ['special', 'barrage', 'aaci', 'day', 'night'])
  const entry = (id, group, label) => ({
    id,
    group,
    label,
    rate: null,
    detail: [PROC_RATE_UNKNOWN_NOTE],
    summary: `? · ${PROC_RATE_UNKNOWN_NOTE}`,
  })
  const groups = procRateGroupsOf([
    entry('special-demo', 'special', '演示攻击'),
    entry('night-first', 'night', '夜 第一候选'),
    entry('night-second', 'night', '夜 第二候选'),
  ])
  assert.deepEqual(groups.map((group) => group.group), ['special', 'night'])
  assert.equal(groups[1].primary.id, 'night-first')
  assert.deepEqual(groups[1].detail, [
    PROC_RATE_UNKNOWN_NOTE,
    '其他可发动项',
    '夜 第二候选 ?',
  ])
  assert.deepEqual(groups[1].foldLines, [
    `夜 第一候选 ? · ${PROC_RATE_UNKNOWN_NOTE}`,
    `　夜 第二候选 ? · ${PROC_RATE_UNKNOWN_NOTE}`,
  ])
  assert.deepEqual(groups[0].foldLines, [
    `特殊攻击 · 演示攻击 ? · ${PROC_RATE_UNKNOWN_NOTE}`,
  ])
})

test('对空CI:秋月两炮加电探列 1/2/3，率、样本、出处与非舰队口径逐行给出', () => {
  const entries = aaciEntriesOf(
    destroyer({
      mstId: 330,
      name: '秋月改',
      ctype: 54,
      equipment: [highAngle(10), highAngle(10), radar5(), lookout()],
    }),
  )
  assert.deepEqual(entries.map((entry) => entry.id), ['aaci-1', 'aaci-2', 'aaci-3'])
  assert.deepEqual(entries.map((entry) => entry.rate), [64.97, 55.34, 50.77])
  assert.deepEqual(entries.map((entry) => entry.summary), ['65%', '55%', '51%'])
  assert.ok(entries.every((entry) => entry.detail.every((line) => !line.includes('条件：'))))
  assert.deepEqual(entries[0].detail, [
    '固定击坠 +7 · 倍率 ×1.7',
    '单体发动率 64.97% · 18,311/28,183',
    '出处：CC_jabberwock / POI DB · 2023-06',
    '按优先度逐项判定 · 非本队最终发动率',
  ])
})

test('对空CI:B 级保留原表推定措辞，C 级保留已知效果与条件但不给数', () => {
  const type47 = byId(
    aaciEntriesOf(
      destroyer({
        equipment: [equip({ mstId: 529 }), equip({ mstId: 529 })],
      }),
    ),
    'aaci-47',
  )
  assert.equal(type47.rate, 70)
  assert.equal(type47.detail[1], '单体发动率 推定 70%（原表 70%?）')
  assert.equal(type47.detail[2], '出处：yukicacoon · 2024-04')

  const type53 = byId(
    aaciEntriesOf(
      hyuugaKai({
        mstId: 1031,
        name: '飞龙改三',
        stype: 11,
        ctype: 30,
        equipment: [highAngle(9), aaRadar()],
      }),
    ),
    'aaci-53',
  )
  assert.equal(type53.rate, 60)
  assert.equal(type53.detail[1], '单体发动率 推定 60%（原表 60％前後）')
  assert.equal(type53.detail[2], '出处：CC_jabberwock · 2026-02')

  const type48 = byId(
    aaciEntriesOf(
      destroyer({
        mstId: 330,
        name: '秋月改',
        ctype: 54,
        equipment: [
          equip({ mstId: 533, iconId: 16, antiAir: 11 }),
          equip({ mstId: 533, iconId: 16, antiAir: 11 }),
          aaRadar(),
        ],
      }),
    ),
    'aaci-48',
  )
  assert.equal(type48.rate, null)
  assert.equal(type48.summary, `? · ${PROC_RATE_UNKNOWN_NOTE}`)
  assert.deepEqual(type48.detail, [
    '固定击坠 +8 · 倍率 ×1.75',
    PROC_RATE_UNKNOWN_NOTE,
  ])
})

test('一条都发动不了的舰:空数组,界面据此什么都不多', () => {
  // 驱逐,只挂一门主砲:昼观测缺水侦、夜战主+副不够两件、也不是弹幕舰种
  assert.deepEqual(procRatesOf(destroyer({ equipment: [mainGun()] }), noFleet), [])
  // 空槽同理
  assert.deepEqual(procRatesOf(destroyer(), noFleet), [])
})

test('喷进弹幕:舰种不符或没带喷二就整条不存在,不是 0% 也不是「?」', () => {
  assert.equal(barrageEntryOf(destroyer({ equipment: [rocket()] })), null, '驱逐不是可发动舰种')
  assert.equal(barrageEntryOf(hyuugaKai({ equipment: [aaGun()] })), null, '舰种对了但没带喷二')
})

test('喷进弹幕:干净配装给数字,C 级修正项一沾就整条降「?」', () => {
  // 日向改 + 单根 ★0 喷二:C 级修正项（3積み/伊势非日向）一条都没踩 → 给数字
  const clean = barrageEntryOf(hyuugaKai({ equipment: [rocket()] }))
  assert.ok(clean && clean.rate !== null, '干净配装该有数字')
  assert.ok(clean.rate > 0 && clean.rate <= 100)
  assert.equal(clean.summary, `${clean.rate.toFixed(0)}%`)
  assert.ok(!clean.detail.includes(PROC_RATE_UNKNOWN_NOTE))
  assert.equal(clean.detail.at(-1), '出处：wikiwiki 12cm30連装噴進砲改二 · 推定')

  // ① 伊勢型 +25 只在**日向改**上实测过,同 ctype 的别的姉妹是外推 → 「?」
  const ise = barrageEntryOf(iseKai2({ equipment: [rocket()] }))
  assert.equal(ise.rate, null)
  assert.deepEqual(ise.detail, [
    '出处：wikiwiki 12cm30連装噴進砲改二 · 推定',
    '该修正项未验证',
    PROC_RATE_UNKNOWN_NOTE,
  ])
  assert.equal(ise.summary, `? · ${PROC_RATE_UNKNOWN_NOTE}`)
  // 非伊勢型舰级（+25 根本不适用）照样给数字
  assert.ok(barrageEntryOf(hyuugaKai({ mstId: 555, ctype: 6, equipment: [rocket()] })).rate !== null)

  // ② 3 積み以上:上游原文自带问号（「+30%程度？」）→ 「?」;两根仍是明数
  assert.ok(barrageEntryOf(hyuugaKai({ equipment: [rocket(), rocket()] })).rate !== null)
  assert.equal(barrageEntryOf(hyuugaKai({ equipment: [rocket(), rocket(), rocket()] })).rate, null)

  // ③ ★ 不降「?」（2026-09-02 用户复裁）:★→加重対空的改修係数是 A 级
  //（wikiwiki 対空砲火正式定义,与 poi 逐格同）,C 级的是「每颗★折合几个百分点」
  // 那句成品结论——系数走 A 级链,带★照给数字。
  assert.ok(barrageEntryOf(hyuugaKai({ equipment: [rocket(6)] })).rate !== null)
  assert.ok(barrageEntryOf(hyuugaKai({ equipment: [rocket(), aaGun(10)] })).rate !== null)
  assert.ok(barrageEntryOf(hyuugaKai({ equipment: [rocket(), aaRadar(10)] })).rate !== null)
})

test('喷进弹幕:发动率封顶 100,公式原值留在悬停里', () => {
  const stacked = barrageEntryOf(
    hyuugaKai({ luck: 100, baseAntiAir: 200, equipment: [rocket(), rocket()] }),
  )
  assert.equal(stacked.rate, 100)
  assert.ok(stacked.detail.some((line) => line.startsWith('公式值')))
})

test('昼观测:一眼位置给确保档,悬停并列两档纯数字,不写制空前提散文', () => {
  const bb = hyuugaKai({ equipment: [mainGun(), mainGun(), seaplane()] })
  const entries = dayEntriesOf(bb, noFleet)
  assert.deepEqual(entries.map((e) => e.id), ['day-mainMain', 'day-double'])
  assert.deepEqual(entries.map((e) => e.label), ['昼 主主 CI', '昼 连击'])
  const main = entries[0]
  assert.ok(main.rate > 0)
  // detail[0] 与 summary 同一句:「确保 X% · 优势 Y%」
  assert.match(main.detail[0], /^确保 \d+% · 优势 \d+%$/)
  assert.equal(main.summary, main.detail[0])
  assert.equal(main.detail.at(-1), '出处：wikiwiki 戦闘について · 弾着観測射撃')
  // pill 脸上那个数就是确保档,不是别的
  assert.equal(Number(main.detail[0].match(/确保 (\d+)%/)[1]), Number(main.rate.toFixed(0)))
  // 确保档 ≥ 优势档
  assert.ok(main.rate >= Number(main.detail[0].match(/优势 (\d+)%/)[1]))
  // 没有一句是在解释制空前提
  for (const entry of entries) {
    for (const line of entry.detail) assert.doesNotMatch(line, /制空|前提|需要/)
  }
  // 四条前提缺一不可:没水侦就一条都不给
  assert.deepEqual(dayEntriesOf(hyuugaKai({ equipment: [mainGun(), mainGun()] }), noFleet), [])
})

test('昼观测:艦隊索敵補正真的接进来了,方向不能反', () => {
  const bb = hyuugaKai({ equipment: [mainGun(), mainGun(), seaplane()] })
  const bare = dayEntriesOf(bb, noFleet)[0]
  const scouty = dayEntriesOf(bb, { losCorrection: 25 })[0]
  assert.ok(scouty.rate > bare.rate, '整队素索敌高,発動率该跟着上去')
})

test('夜战:只列真会进发动判定的种别,被更高倍率盖住的不列', () => {
  // 主砲2 + 魚雷1 → 汎用池里主魚 CI(1.3) 是最高的那一种,連撃不再判定
  const dd = destroyer({ equipment: [mainGun(), mainGun(), torpedo()] })
  const entries = nightEntriesOf(dd, noFleet)
  assert.deepEqual(entries.map((e) => e.id), ['night-mainTorp'])
  assert.ok(entries[0].label.startsWith('夜 '))
  assert.ok(entries[0].rate > 0)
  assert.match(entries[0].detail[0], /^CI项 \d+ · 系数 115$/)

  // 驱逐专用与汎用并行:主魚電 + 主魚 两条都列
  const withRadar = nightEntriesOf(destroyer({ equipment: [mainGun(), torpedo(), radar5()] }), noFleet)
  assert.deepEqual(withRadar.map((e) => e.id).sort(), ['night-ddMainTorpRadar', 'night-mainTorp'])
})

test('夜战:連撃与潜水艦専用係数一律「?」,悬停就是那一句', () => {
  // 主砲2 无别的 → 連撃。上游把夜戦連撃発動率列在「要検証事項」,不编数
  const double = nightEntriesOf(destroyer({ equipment: [mainGun(), mainGun()] }), noFleet)
  assert.deepEqual(double.map((e) => e.id), ['night-double'])
  assert.equal(double[0].label, '夜 连击')
  assert.equal(double[0].rate, null)
  assert.deepEqual(double[0].detail, [
    '出处：wikiwiki 夜戦 · 推定',
    PROC_RATE_UNKNOWN_NOTE,
  ])
  assert.equal(double[0].summary, `? · ${PROC_RATE_UNKNOWN_NOTE}`)

  // 潜水艦専用係数:wikiwiki 自己列在「要検証事項」
  const sub = nightEntriesOf(
    { ...destroyer(), stype: 13, equipment: [
      equip({ mstId: 213, type2: 32, name: '後期型艦首魚雷(6門)' }),
      equip({ mstId: 210, type2: 51, name: '潜水艦搭載電探&水防式望遠鏡', los: 4 }),
    ] },
    noFleet,
  )
  assert.deepEqual(sub.map((e) => e.id), ['night-ssRadarTorp'])
  assert.equal(sub[0].rate, null)
})

test('夜战:补正按静态编成的可知项算——旗舰与见张员算,中破与敌方一律不算', () => {
  const base = destroyer({ equipment: [mainGun(), torpedo()] })
  const plain = nightEntriesOf(base, noFleet)[0]
  const flag = nightEntriesOf({ ...base, flagship: true }, noFleet)[0]
  assert.ok(flag.rate > plain.rate || plain.rate === 100, '旗舰 +15 要进去')
  assert.match(flag.detail[1], /旗舰 \+15/)
  // 熟練見張員从这一艘的配装读得出来
  const withLookout = nightEntriesOf(
    destroyer({ luck: 20, equipment: [mainGun(), torpedo(), lookout()] }),
    noFleet,
  )[0]
  assert.match(withLookout.detail[1], /熟练见张员 \+5/)
  // 探照灯是舰队级判据,由调用方传进来
  const lit = nightEntriesOf(destroyer({ luck: 20, equipment: [mainGun(), torpedo()] }), {
    losCorrection: 0,
    searchlight: true,
  })[0]
  assert.match(lit.detail[1], /探照灯 \+7/)
  // 中破补正按无伤算:明细里不该出现它
  for (const entry of [plain, flag, withLookout, lit]) {
    for (const line of entry.detail) assert.doesNotMatch(line, /中破|敌方/)
  }
})

test('夜間瑞雲CI:中破不列,探照灯按 0 且悬停明示', () => {
  const equips = [mainGun(), mainGun(), nightZuiun()]
  const healthy = hyuugaKai({ equipment: equips })
  const plain = byId(nightEntriesOf(healthy, noFleet), 'night-nightZuiun')
  const lit = byId(
    nightEntriesOf(healthy, { losCorrection: 0, searchlight: true }),
    'night-nightZuiun',
  )
  assert.ok(plain)
  assert.equal(lit.rate, plain.rate)
  assert.ok(lit.detail.includes('探照灯不计'))
  assert.doesNotMatch(lit.detail.join('\n'), /探照灯 \+7/)

  const chuuha = hyuugaKai({ hp: 40, hpMax: 80, equipment: equips })
  assert.equal(byId(nightEntriesOf(chuuha, noFleet), 'night-nightZuiun'), undefined)
  assert.ok(
    byId(nightEntriesOf(chuuha, noFleet), 'night-double'),
    '中破仅排除夜間瑞雲CI，不改变通用连击的既有口径',
  )
})

test('大破的舰这一夜出不了手:夜战条目一条都不列', () => {
  const wrecked = destroyer({ hp: 8, hpMax: 35, equipment: [mainGun(), torpedo()] })
  assert.deepEqual(nightEntriesOf(wrecked, noFleet), [])
  // 边界:HP 恰好落在大破线上算大破,再高一点就不算
  assert.deepEqual(nightEntriesOf({ ...wrecked, hp: 8 }, noFleet), [])
  assert.equal(nightEntriesOf({ ...wrecked, hp: 9 }, noFleet).length, 1)
})

test('汇总顺序:弹幕 → 对空CI → 昼观测 → 夜战', () => {
  const bbv = hyuugaKai({
    equipment: [
      mainGun(),
      mainGun(),
      seaplane(),
      rocket(),
      secondary(),
      highAngle(),
      aaFireDirector(),
    ],
  })
  const entries = procRatesOf(bbv, {
    losCorrection: 20,
    searchlight: false,
    role: 'normal',
    ships: [],
  })
  assert.deepEqual(
    entries.map((e) => e.group),
    ['barrage', 'aaci', 'day', 'day', 'day', 'night'],
  )
  assert.equal(entries[0].id, 'barrage')
  assert.equal(entries[1].id, 'aaci-9')
  // 每一条都要有名字、有脸上那个值的出处,悬停不许是空的
  for (const entry of entries) {
    assert.ok(entry.label.length > 0)
    assert.ok(entry.detail.length > 0)
    assert.ok(entry.detail.some((line) => line.startsWith('出处：')))
    assert.ok(entry.summary.length > 0)
    assert.ok(entry.rate === null || (entry.rate >= 0 && entry.rate <= 100), '発動率要封顶在 100')
  }
})

test('同类合并:秋月样例只出对空CI与夜战两枚，主条取最高率并列出其他可发动项', () => {
  const raw = procRatesOf(
    destroyer({
      mstId: 330,
      name: '秋月改',
      ctype: 54,
      equipment: [
        equip({ mstId: 122, type2: 1, iconId: 16, name: '10cm連装高角砲+高射装置', antiAir: 10 }),
        equip({ mstId: 122, type2: 1, iconId: 16, name: '10cm連装高角砲+高射装置', antiAir: 10 }),
        radar5(),
        lookout(),
      ],
    }),
    noFleet,
  )
  const groups = procRateGroupsOf(raw)
  assert.deepEqual(
    groups.map(({ primary }) => `${primary.label} ${faceOf(primary)}`),
    ['对空CI 1 65%', '夜 连击 ?'],
  )
  assert.equal(groups.length, 2)
  const aaci = groups[0]
  assert.deepEqual(aaci.others.map((entry) => entry.label), ['对空CI 2', '对空CI 3'])
  assert.deepEqual(aaci.detail.slice(-3), [
    '其他可发动项',
    '对空CI 2 55% · 固定击坠 +6 · 倍率 ×1.7',
    '对空CI 3 51% · 固定击坠 +4 · 倍率 ×1.6',
  ])
  assert.deepEqual(aaci.foldLines, [
    '对空CI 1 65% · 固定击坠 +7 · 倍率 ×1.7',
    '　对空CI 2 55% · 固定击坠 +6 · 倍率 ×1.7',
    '　对空CI 3 51% · 固定击坠 +4 · 倍率 ×1.6',
  ])
})

test('同类合并:对空CI 8/5 的其他项与窄态每行都带效果事实，弹幕不带', () => {
  const aaciEntries = aaciEntriesOf(
    destroyer({
      equipment: [highAngle(10), highAngle(10), aaRadar()],
    }),
  )
  assert.deepEqual(aaciEntries.map((entry) => entry.id), ['aaci-5', 'aaci-8'])
  const aaci = procRateGroupsOf(aaciEntries)[0]
  assert.equal(aaci.primary.id, 'aaci-8')
  assert.match(aaci.detail.at(-1), /^对空CI 5 50% · 固定击坠 \+\d+ · 倍率 ×[\d.]+$/)
  for (const line of aaci.foldLines) {
    assert.match(line, /固定击坠 \+\d+ · 倍率 ×[\d.]+$/)
  }

  const barrage = procRateGroupsOf([
    barrageEntryOf(hyuugaKai({ equipment: [rocket()] })),
  ])[0]
  for (const line of [...barrage.detail, ...barrage.foldLines]) {
    assert.doesNotMatch(line, /固定击坠/)
  }
})

test('同类合并:水侦战舰的昼族取最高率，悬停按判定顺序列全其余昼观测', () => {
  const raw = procRatesOf(
    hyuugaKai({ equipment: [mainGun(), mainGun(), seaplane()] }),
    { ...noFleet, losCorrection: 20 },
  )
  const groups = procRateGroupsOf(raw)
  assert.deepEqual(groups.map((group) => group.group), ['day', 'night'])
  const day = groups[0]
  assert.equal(day.primary.id, 'day-double')
  assert.equal(day.primary.label, '昼 连击')
  assert.ok(day.primary.rate > day.others[0].rate)
  assert.deepEqual(day.others.map((entry) => entry.id), ['day-mainMain'])
  assert.deepEqual(day.detail.slice(-2), [
    '其他可发动项',
    `昼 主主 CI ${faceOf(day.others[0])}`,
  ])
})

test('探照灯是舰队级判据:同队任一舰带着就成立', () => {
  assert.equal(fleetHasSearchlight([[mainGun()], [torpedo()]]), false)
  assert.equal(fleetHasSearchlight([[mainGun()], [torpedo(), searchlight()]]), true)
  // 大型探照灯（type2 42）同档
  assert.equal(fleetHasSearchlight([[equip({ type2: 42 })]]), true)
  assert.equal(fleetHasSearchlight([]), false)
})

test('「暂无权威公式」是逐字定稿的那一句,别改写', () => {
  assert.equal(PROC_RATE_UNKNOWN_NOTE, '暂无权威公式')
})
