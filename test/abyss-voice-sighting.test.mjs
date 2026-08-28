// 深海开幕语音的「亲历台账」（2026-08-25）。
//
// ---- 缺口 ----
// 深海台词卷只对 subtitle-enemies 那一支给播放钮，因为只有它的 key 是完整官方档名。
// 米駆逐棲姫（2204）只被 wikiwiki-abyss-voice 收录（key 是 `米駆逐棲姫#abyss-0-2`
// 这种 wiki 资源键），于是开幕台词摆得出来、钮没有——用户实机报的就是这一格。
//
// ---- 官方自己会把档名说出来 ----
// Boss 开幕时 `api_flavor_info` 同时给 `api_boss_ship_id` 与 `api_voice_id`，
// 而 api_voice_id 就是 kc9998 的档名。本机账本实测：
//     api_voice_id="605229710" / api_boss_ship_id="2297"
//     → 605 | 2297 | 10（前缀|形态号|行号，行号首位 1 = 開幕前）
// 记下玩家亲历过的这些，图鉴就有了**可验证**的地址——家法（不显示无法验证的钮）
// 一个字没改，是证据补上了。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import sighting from '../dist/shared/abyss-voice-sighting.js'

const {
  ABYSS_VOICE_BASIS_FLAVOR,
  ABYSS_VOICE_SIGHTING_MAX,
  abyssVoiceArchaeologyRow,
  abyssVoiceEarBasis,
  abyssVoiceLineNo,
  abyssVoiceSceneFamily,
  abyssVoiceSightingFor,
  foldAbyssVoiceSightings,
  isAbyssVoiceEarBasis,
  normalizeAbyssVoiceSightings,
} = sighting
const ledger = fs.readFileSync(
  new URL('../src/main/abyss-voice-sightings.ts', import.meta.url),
  'utf8',
)
const ji = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
const store = fs.readFileSync(new URL('../src/main/mg/store.ts', import.meta.url), 'utf8')
const battle = fs.readFileSync(new URL('../src/main/mg/battle.ts', import.meta.url), 'utf8')

// ---- 行号定位（拿已知 mstId 去档名里找形态号）----

test('账本里那条实测样本解得出行号', () => {
  // 605 | 2297 | 10 —— battle.ts 头注里记的那条真样本
  assert.equal(abyssVoiceLineNo('605229710', 2297), '10')
  assert.equal(abyssVoiceSceneFamily('10'), '1', '行号首位 1 = 開幕前')
})

test('三位形态号（mstId = 1000 + 它）同样解得出', () => {
  // 本机未匹配台账里的真档名：33265330 → 332|653|30，mstId 1653 集積地棲姫
  assert.equal(abyssVoiceLineNo('33265330', 1653), '30')
  assert.equal(abyssVoiceLineNo('35369920', 1699), '20')
})

test('四位形态号与两位行号的组合（本机真样本逐条）', () => {
  for (const [file, mstId, line] of [
    ['575217820', 2178, '20'],
    ['576219230', 2192, '30'],
    ['611231750', 2317, '50'],
    ['605229721', 2297, '21'],
  ]) {
    assert.equal(abyssVoiceLineNo(file, mstId), line, `${file} 解错了`)
  }
})

test('对不上就返回空串——不认场合，但也绝不猜', () => {
  assert.equal(abyssVoiceLineNo('605229710', 1653), '', '形态号根本不在这串里却认了场合')
  assert.equal(abyssVoiceLineNo('abc', 2297), '')
  assert.equal(abyssVoiceLineNo('', 2297), '')
  assert.equal(abyssVoiceLineNo('605229799', 2297), '', '行号 99 不是合法場合，不许认')
  assert.equal(abyssVoiceSceneFamily(''), '')
  assert.equal(abyssVoiceSceneFamily('90'), '')
})

// ---- 折账 ----

const flavor = (mstId, voiceId) => ({ mstId, voiceId, shipName: '', message: '～' })

test('第一次听到就建条目，再听到只累加不新建', () => {
  const first = foldAbyssVoiceSightings([], [flavor(2297, '605229710')], 1000)
  assert.equal(first.changed, true)
  assert.deepEqual(first.list, [
    {
      mstId: 2297,
      voiceId: '605229710',
      lineNo: '10',
      firstHeard: 1000,
      lastHeard: 1000,
      count: 1,
      basis: ABYSS_VOICE_BASIS_FLAVOR,
    },
  ])
  const again = foldAbyssVoiceSightings(first.list, [flavor(2297, '605229710')], 5000)
  assert.equal(again.list.length, 1, '同一条又建了一条')
  assert.equal(again.list[0].count, 2)
  assert.equal(again.list[0].firstHeard, 1000, '首次听到的时刻被改写了')
  assert.equal(again.list[0].lastHeard, 5000)
})

test('不就地改入参', () => {
  const before = foldAbyssVoiceSightings([], [flavor(2297, '605229710')], 1000).list
  const snapshot = JSON.stringify(before)
  foldAbyssVoiceSightings(before, [flavor(2297, '605229710')], 9000)
  assert.equal(JSON.stringify(before), snapshot, '就地改了调用方手上那份')
})

test('不是深海、或档名不像话的一律不收', () => {
  const out = foldAbyssVoiceSightings(
    [],
    [flavor(131, '605229710'), flavor(2297, 'zzz'), flavor(2297, '')],
    1,
  )
  assert.deepEqual(out.list, [], '把非深海或坏档名收进台账了')
  assert.equal(out.changed, false, '什么都没收却报告有变化——会白落一次盘')
})

test('上限满了从最早的开始丢', () => {
  let list = []
  for (let i = 0; i < ABYSS_VOICE_SIGHTING_MAX + 5; i += 1) {
    list = foldAbyssVoiceSightings(list, [flavor(2297, `${600000000 + i}`)], i).list
  }
  assert.equal(list.length, ABYSS_VOICE_SIGHTING_MAX)
  assert.equal(list[0].voiceId, `${600000005}`, '丢的不是最早的那几条')
})

// ---- 查表 ----

test('按場合族取，取最近听到的那一条', () => {
  const list = [
    { mstId: 2204, voiceId: '111220410', lineNo: '10', firstHeard: 1, lastHeard: 1, count: 1 },
    { mstId: 2204, voiceId: '111220411', lineNo: '11', firstHeard: 2, lastHeard: 9, count: 1 },
    { mstId: 2204, voiceId: '111220420', lineNo: '20', firstHeard: 3, lastHeard: 3, count: 1 },
    { mstId: 2297, voiceId: '605229710', lineNo: '10', firstHeard: 4, lastHeard: 4, count: 1 },
  ]
  // 開幕族（1）里最近听到的是 lineNo 11 那一条
  assert.equal(abyssVoiceSightingFor(list, 2204, '1')?.voiceId, '111220411')
  assert.equal(abyssVoiceSightingFor(list, 2204, '2')?.voiceId, '111220420')
  assert.equal(abyssVoiceSightingFor(list, 2204, '3'), null, '没亲历过的场合凭空给了地址')
  assert.equal(abyssVoiceSightingFor(list, 9999, '1'), null)
  assert.equal(abyssVoiceSightingFor(list, 2204, ''), null, '空场合族也匹配上了')
})

// ---- 判据来路（basis，2026-08-25 加）----

const isAbyss = (id) => id >= 1500 && id < 2600

test('两族记录各标各的来路，落盘再读回来还认得出是哪一族', () => {
  const flavored = foldAbyssVoiceSightings([], [flavor(2297, '605229710')], 1000).list
  assert.equal(flavored[0].basis, ABYSS_VOICE_BASIS_FLAVOR)
  assert.equal(isAbyssVoiceEarBasis(flavored[0].basis), false)

  const dug = foldAbyssVoiceSightings(
    [],
    [flavor(2204, '577220410')],
    2000,
    abyssVoiceEarBasis('2026-08-25'),
  ).list
  assert.equal(dug[0].basis, '用户耳测考古 2026-08-25')
  assert.equal(isAbyssVoiceEarBasis(dug[0].basis), true)

  // 台账是一个 JSON 文件，字段得挺过一次序列化往返（回读那一步就靠它）
  const roundTrip = JSON.parse(JSON.stringify({ sightings: [...flavored, ...dug] })).sightings
  assert.deepEqual(
    roundTrip.map((entry) => entry.basis),
    [ABYSS_VOICE_BASIS_FLAVOR, '用户耳测考古 2026-08-25'],
  )
})

test('耳测考古记过的那一条后来真听到了 → 升级成报文；反过来不许降级', () => {
  const dug = foldAbyssVoiceSightings(
    [],
    [flavor(2204, '577220410')],
    1,
    abyssVoiceEarBasis('2026-08-25'),
  ).list
  const heard = foldAbyssVoiceSightings(dug, [flavor(2204, '577220410')], 9).list
  assert.equal(heard.length, 1, '升级不该新建条目')
  assert.equal(heard[0].basis, ABYSS_VOICE_BASIS_FLAVOR, '一手证据到了却没升级')
  assert.equal(heard[0].count, 2)

  const again = foldAbyssVoiceSightings(heard, [flavor(2204, '577220410')], 20, abyssVoiceEarBasis('2026-09-01')).list
  assert.equal(again[0].basis, ABYSS_VOICE_BASIS_FLAVOR, '一手的报文被后来的耳测冲淡了')
})

test('老台账没有 basis 字段——读回来补成报文（那时只有这一条路）', () => {
  const legacy = [
    { mstId: 2297, voiceId: '605229710', lineNo: '10', firstHeard: 1, lastHeard: 1, count: 3 },
    { mstId: 2204, voiceId: '577220410', lineNo: '10', firstHeard: 2, lastHeard: 2, count: 1, basis: '用户耳测考古 2026-08-25' },
    { mstId: 2317, voiceId: '611231750', lineNo: '50', firstHeard: 3, lastHeard: 3, count: 1, basis: '   ' },
  ]
  const out = normalizeAbyssVoiceSightings(legacy)
  assert.deepEqual(
    out.map((entry) => entry.basis),
    [ABYSS_VOICE_BASIS_FLAVOR, '用户耳测考古 2026-08-25', ABYSS_VOICE_BASIS_FLAVOR],
  )
  // 补字段之外一个字节都不许动
  assert.equal(out[0].count, 3)
  assert.equal(out[2].lineNo, '50')
})

// ---- 耳测考古的收录判据 ----

test('归属由档名结构自证：反解回本形态才收', () => {
  assert.deepEqual(abyssVoiceArchaeologyRow({ mstId: 2204, voiceId: '577220410' }, isAbyss), {
    mstId: 2204,
    voiceId: '577220410',
    shipName: '',
    message: '',
  })
  // 中段根本不是这个形态号 —— 这是「把 A 的声音记到 B 名下」那一族的错法
  assert.equal(
    abyssVoiceArchaeologyRow({ mstId: 2297, voiceId: '577220410' }, isAbyss),
    null,
    '档名反解回的不是入参那个形态，却收下了',
  )
  // 解出两个合法形态 → 反解弃权 → 不收
  assert.equal(abyssVoiceArchaeologyRow({ mstId: 2059, voiceId: '28205971' }, isAbyss), null)
})

test('不像话的入参一律不收（这个口是 IPC 直达的）', () => {
  for (const bad of [
    { mstId: 131, voiceId: '605229710' }, // 不是深海
    { mstId: 2297, voiceId: '' },
    { mstId: 2297, voiceId: '60522971x' },
    { mstId: 2297, voiceId: '12345' }, // 短于 2+3+1
    { mstId: 2297, voiceId: '1234567890' }, // 长于 3+4+2
    { mstId: 2297.5, voiceId: '605229710' },
    { mstId: undefined, voiceId: undefined },
    {},
  ]) {
    assert.equal(abyssVoiceArchaeologyRow(bad, isAbyss), null, `收下了 ${JSON.stringify(bad)}`)
  }
})

test('归属唯一但场合判不出来时照收——两层是两层，别因场合不明拒收', () => {
  // 这里要的是「归属唯一、行号两读打架」那一格。**头注里那条两读歧义不是它**：
  // 3505871 = 35|0587|1 也 = 350|587|1，两读的**行号一样**（都从下标 6 起），
  // 打架的是前缀。行号真打架要形态号能在相邻两个位置各嵌一次，也就是叠字号：
  // 1555 的 `555` 在 `1055551` 里 head=2 读出尾巴 `51`、head=3 读出 `1`。
  //
  // 实测这一支**现实里基本走不到**：拿随包 + 本机样本建索引，给 wiki 收了词却没档名的
  // 580 个形态生成 25485 条候选，行号解不出来的是 0 条。留着是因为它是一条纪律，
  // 不是因为它常见——归属能自证就该记下，场合不明只让那一行还点不亮。
  const row = abyssVoiceArchaeologyRow({ mstId: 1555, voiceId: '1055551' }, isAbyss)
  assert.ok(row, '归属明明唯一，却被整条拒了')
  const list = foldAbyssVoiceSightings([], [row], 1, abyssVoiceEarBasis('2026-08-25')).list
  assert.equal(list[0].mstId, 1555, '归属没记下来')
  assert.equal(list[0].lineNo, '', '场合本该判不出来，却认了一个')
  assert.equal(list[0].basis, '用户耳测考古 2026-08-25')
  // 场合未定 = 正式界面上这一行还点不亮，但台账上这一条是实打实的
  assert.equal(abyssVoiceSightingFor(list, 1555, '1'), null)
})

// ---- 接线 ----

test('收录口落在落盘层，且当场落盘不等防抖', () => {
  // 提督点完就可能去关窗口，攒着等于把刚认下来的那一条丢掉
  assert.ok(ledger.includes('export const recordAbyssVoiceArchaeology'), '没有收录入口')
  const at = ledger.indexOf('export const recordAbyssVoiceArchaeology')
  const body = ledger.slice(at)
  assert.ok(body.includes('abyssVoiceArchaeologyRow'), '没走那条自证归属的判据')
  assert.ok(body.includes('flushAbyssVoiceSightings()'), '收录之后没当场落盘')
  // 这条路上不许有任何请求：试听在渲染层走既有出口，这里只落账
  assert.ok(!/fetch\(|net\.|https?:\/\//.test(body), '收录的路上出现了请求')
})

test('战斗结算那一路把亲历记下来，昼战夜战都记，且是被动的', () => {
  assert.ok(
    store.includes('recordAbyssVoiceSightings(battle.flavorVoices, ts)'),
    '昼战没把亲历记进台账',
  )
  assert.ok(
    store.includes('recordAbyssVoiceSightings(state.sortie.battle?.flavorVoices ?? [], ts)'),
    '夜战没把亲历记进台账',
  )
  // ⚠️ 记在 store 而不是 battle.ts：battle.js 被好几份测试**直接 import**，
  // 让它牵进依赖 electron 的落盘层会把那几份整份打挂（2026-08-25 实测踩过，8 份）。
  assert.ok(
    !battle.includes('abyss-voice-sightings'),
    'battle.ts 又引了落盘层——那会让直接 import 它的测试整份失败',
  )
  // 这条路上不许有任何请求：它读的是拦下来的报文
  const at = battle.indexOf('const parseFlavorVoices =')
  const body = battle.slice(at, battle.indexOf('\n}', at))
  assert.ok(!/fetch\(|net\.|https?:\/\//.test(body), '解析报文的路上出现了请求')
})

test('图鉴只对亲历过的行给钮，没亲历的照旧走老路（家法不变）', () => {
  assert.ok(ji.includes('const heard = abyssHeardVoiceId(id, line.suffix)'), '没有查亲历台账')
  // 有亲历 → 走带地址那一支；没有 → 原样 voiceRow（没有播放钮）
  assert.ok(
    /heard\s*\?\s*voiceRowWithUrl\(/.test(ji),
    '亲历过也没给钮',
  )
  assert.ok(
    /:\s*\/\/[\s\S]{0,200}voiceRow\(id, mstId, line\.key, scene, line\.ja, zh\)/.test(ji),
    '没亲历过的那一支被改了——家法是不显示无法验证的钮',
  )
  // 地址只经既有的出口（extraVoiceUrl：档案优先、其次受钥开关管的现取）
  assert.ok(ji.includes("extraVoiceUrl('enemy', heard)"), '没走既有的深海音轨出口')
  // 不许在这儿自己拼 https 地址
  const at = ji.indexOf('const heard = abyssHeardVoiceId')
  assert.ok(!/https?:\/\//.test(ji.slice(at, at + 900)), '自己拼了一个对外地址')
})
