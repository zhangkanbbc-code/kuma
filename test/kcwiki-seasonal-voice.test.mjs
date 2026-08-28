// 季节限定台词解析的纯函数回归。
//
// 护栏盯的是四件在真数据上真咬过人的事：
//  ① 形态码不是图鉴号（时雨改 080a vs 图鉴 1343），归属靠改造链推；
//  ② 同一条台词会在往年每张同季节页上重复列出（25152 行 → 5420 条），
//     去重规则错了就会让一条 2015 年的圣诞台词在此后每个圣诞分组各出现一次；
//  ③ 场景 token → 语音槽位是实测表，不是直觉，越界的槽位不许流出；
//  ④ 随包**日中两列都落**——`ja` 这一列必须在场（2026-08-22 起；此前钉的是相反的
//     「一个日文字都不许进包」，同日用户重算法理后撤销，理由见 NOTICE.md 与
//     scripts/lib/kcwiki-seasonal-voice.mjs 文件头。台词卷是对照功能，缺一列就是半张表）。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  SEASONAL_SCENE_SLOTS,
  buildSeasonalVoicePack,
  buildShipFormCodeMap,
  parseSeasonPageTitle,
  parseSeasonalVoiceKey,
  parseSeasonalVoicePage,
  seasonalKeyYear,
} from '../scripts/lib/kcwiki-seasonal-voice.mjs'

test('档名拆出形态码、场景与官方语音槽位', () => {
  assert.deepEqual(parseSeasonalVoiceKey('005-Sec1Christmas2015'), {
    code: '005',
    slot: 2,
    scene: '秘书舰1',
    tail: 'Sec1Christmas2015',
  })
  // 改装形态：码带字母后缀
  assert.equal(parseSeasonalVoiceKey('183a-Sec2Valentine2016').code, '183a')
  assert.equal(parseSeasonalVoiceKey('183a-Sec2Valentine2016').slot, 3)
  // Sec1 是 Sec13 的前缀：长的必须先匹配，否则 Sec13 会被切成 Sec1
  assert.equal(parseSeasonalVoiceKey('080-Sec13rdAnniv').scene, '秘书舰1')
  assert.equal(parseSeasonalVoiceKey('080-Sec3Christmas2016').slot, 4)
  // 时报：HH → 30+小时
  assert.equal(parseSeasonalVoiceKey('080-0100Setubunn2019').slot, 31)
  assert.equal(parseSeasonalVoiceKey('080-2200Shinnen2020').slot, 52)
  // 认不出场景就留空，不硬套一个场景名
  assert.deepEqual(parseSeasonalVoiceKey('109-2ndAnniv'), {
    code: '109',
    slot: null,
    scene: '',
    tail: '2ndAnniv',
  })
  // 不是「码-尾巴」形状的（任务/NPC 语音档名）整条判无归属
  assert.equal(parseSeasonalVoiceKey('QuestA82Finish').code, '')
  assert.equal(parseSeasonalVoiceKey('1188').code, '')
})

test('槽位表落在官方语音编号空间 1..29 内，且没有两个 token 抢同一槽', () => {
  const slots = Object.values(SEASONAL_SCENE_SLOTS).map((entry) => entry.slot)
  assert.equal(new Set(slots).size, slots.length, '同一槽位被两个场景 token 占用')
  for (const slot of slots) assert.ok(slot >= 1 && slot <= 29, `槽位 ${slot} 越界`)
})

test('页名给出季节标识，年份认不出就不写', () => {
  assert.deepEqual(parseSeasonPageTitle('季节性/2015年圣诞节'), {
    id: '2015-圣诞节',
    title: '2015年圣诞节',
    year: 2015,
    name: '圣诞节',
  })
  const comptiq = parseSeasonPageTitle('季节性/Comptiq2018年6月号特典语音')
  assert.equal(comptiq.id, 'Comptiq2018年6月号特典语音')
  assert.equal(comptiq.year, 2018)
  assert.equal(parseSeasonPageTitle('时雨'), null)
})

test('档名尾部的年份读得出，读不出就是 null（不拿形态码当年份）', () => {
  assert.equal(seasonalKeyYear('005-Sec1Christmas2015'), 2015)
  assert.equal(seasonalKeyYear('080-Sec1ThirteenthAnniversary'), null)
  // 形态码本身是三位数，不能被当成年份
  assert.equal(seasonalKeyYear('573-Sec1Valentine'), null)
})

// 改造链的两处上游毛病，都在真包里出现过
const SHIPS = [
  { ID: 43, 图鉴号: 80, 中文名: '时雨', 改造: { 改造前: -1, 改造后: '080a', 系列: '080' } },
  { ID: 243, 图鉴号: 1343, 中文名: '时雨改', 改造: { 改造前: '080', 改造后: '145', 系列: '080' } },
  { ID: 145, 图鉴号: 145, 中文名: '时雨改二', 改造: { 改造前: '080a', 改造后: '561', 系列: '080' } },
  { ID: 961, 图鉴号: 561, 中文名: '时雨改三', 改造: { 改造前: '145', 改造后: -1, 系列: '080' } },
  // 伊势：第一级改装 ships 模块给的码是 102，而季节页写 003a
  { ID: 77, 图鉴号: 3, 中文名: '伊势', 改造: { 改造前: -1, 改造后: '102', 系列: '003' } },
  { ID: 82, 图鉴号: 102, 中文名: '伊势改', 改造: { 改造前: '003', 改造后: '353', 系列: '003' } },
  // 英勇：链首的「改造前」被上游写成了自己的下一级，按 -1 找不到链首
  { ID: 927, 图鉴号: 527, 中文名: '英勇', 改造: { 改造前: '527a', 改造后: '527a', 系列: '527' } },
]

test('形态码按改造链推，不按图鉴号猜', () => {
  const map = buildShipFormCodeMap(SHIPS)
  assert.equal(map.get('080'), 43)
  // 时雨改的图鉴号是 1343，形态码却是 080a——按图鉴号猜必错
  assert.equal(map.get('080a'), 243)
  assert.equal(map.get('145'), 145)
  assert.equal(map.get('561'), 961)
  // 上游把「改造前」写成自己下一级的链首，仍要认出来
  assert.equal(map.get('527'), 927)
  // 别名层：ships 模块叫 102 的那一级，季节页写 003a 也认
  assert.equal(map.get('003'), 77)
  assert.equal(map.get('003a'), 82)
  assert.equal(map.get('102'), 82)
  // 零填充与不填充两种写法都收
  assert.equal(map.get('3'), 77)
})

const PAGE = `==新语音==
===海防艦===
{{台词翻译表/页头|type=seasonal}}
{{台词翻译表|type=seasonal
 | 档名 = 080-Sec1Valentine2026
 | 编号 = 080
 | 舰娘名字 = 时雨
 | 日文台词 = チョコレート、どうぞ。
 | 中文译文 = 巧克力，请收下。
}}
{{台词翻译表|type=seasonal
 | 档名 = 080a-Sec2Valentine2026
 | 编号 = 080a
 | 舰娘名字 = 时雨改
 | 日文台词 = はい、これ。
 | 中文译文 =
}}
{{页尾}}`

test('一张季节页解析出带归属与场景的行；日文只当中间量带出来', () => {
  const rows = parseSeasonalVoicePage(PAGE, '季节性/2026年情人节')
  assert.equal(rows.length, 2)
  assert.deepEqual(
    rows.map((row) => [row.code, row.slot, row.scene, row.zh, row.season]),
    [
      ['080', 2, '秘书舰1', '巧克力，请收下。', '2026-情人节'],
      ['080a', 3, '秘书舰2', '', '2026-情人节'],
    ],
  )
  // 日文在解析结果里在（回连槽位/维护者对账要用），落包时才丢
  assert.equal(rows[0].ja, 'チョコレート、どうぞ。')
})

test('重定向页不产出台词', () => {
  assert.deepEqual(parseSeasonalVoicePage('#重定向 [[季节性/2017年秋季活动决战前夜]]', '季节性/决战前夜'), [])
})

test('往年重复列出的同一条台词只落一次，且落回自己那一年', () => {
  const seasons = {
    '2015-圣诞节': { title: '2015年圣诞节', year: 2015, name: '圣诞节', page: '季节性/2015年圣诞节' },
    '2016-圣诞节': { title: '2016年圣诞节', year: 2016, name: '圣诞节', page: '季节性/2016年圣诞节' },
    '2015-二周年纪念': { title: '2015年二周年纪念', year: 2015, name: '二周年纪念', page: 'x' },
    '2016-三周年纪念': { title: '2016年三周年纪念', year: 2016, name: '三周年纪念', page: 'y' },
  }
  const line = (season, key, zh) => ({ code: '080', key, scene: '秘书舰1', slot: 2, zh, ja: 'ja', season, name: '时雨' })
  const rows = [
    // 2016 那页把 2015 年的圣诞台词一并列了出来
    line('2016-圣诞节', '080-Sec1Christmas2015', '圣诞快乐'),
    line('2015-圣诞节', '080-Sec1Christmas2015', '圣诞快乐'),
    line('2016-圣诞节', '080-Sec1Christmas2016', '今年也是'),
    // 档名没有年份：退到最早列出它的那一季
    line('2016-三周年纪念', '080-2ndAnniv', '两周年了'),
    line('2015-二周年纪念', '080-2ndAnniv', '两周年了'),
  ]
  const { data, stats } = buildSeasonalVoicePack(rows, new Map([['080', 43]]), new Map(), seasons)
  assert.equal(stats.kept, 3)
  assert.equal(stats.duplicateListings, 2)
  const byKey = new Map(data.ships[43].map((row) => [row.key, row.season]))
  assert.equal(byKey.get('080-Sec1Christmas2015'), '2015-圣诞节')
  assert.equal(byKey.get('080-Sec1Christmas2016'), '2016-圣诞节')
  assert.equal(byKey.get('080-2ndAnniv'), '2015-二周年纪念')
})

test('无舰娘归属的行整条弃用，不硬塞给某艘舰', () => {
  const rows = [
    { code: '', key: 'QuestA82Finish', scene: '', slot: null, zh: '文', ja: 'ja', season: 's', name: '' },
  ]
  const { data, stats } = buildSeasonalVoicePack(rows, new Map(), new Map(), {})
  assert.equal(stats.dropped, 1)
  assert.deepEqual(data.ships, {})
})

// ⚠️ 这一条 2026-08-22 **刻意反转**：原来叫「落包结果一个日文字段都没有」。
// 撤销的依据见 NOTICE.md 与 lib/kcwiki-seasonal-voice.mjs 文件头——逐字转写与随包早就有的
// kcwiki-voice.ja / subtitle-ja 同级同灰度，挡住它只会让台词卷变成半张对照表。
test('落包结果日中两列都在，任一侧缺失都如实留空、不拿另一侧顶上', () => {
  const seasons = { s: { title: 't', year: 2026, name: 'n', page: 'p' } }
  const rows = [
    { code: '080', key: 'k1', scene: '秘书舰1', slot: 2, zh: '', ja: '日文原文', season: 's', name: '' },
    // 上游只填了中文、没转日文的那一类（2024 十一周年那几张页就是这样）
    { code: '080', key: 'k2', scene: '秘书舰2', slot: 3, zh: '只有中文', ja: '', season: 's', name: '' },
  ]
  const { data } = buildSeasonalVoicePack(rows, new Map([['080', 43]]), new Map(), seasons)
  const byKey = new Map(data.ships[43].map((row) => [row.key, row]))
  assert.equal(byKey.get('k1').ja, '日文原文')
  assert.equal(byKey.get('k1').zh, '', '没有译文就留空，不许拿日文顶上')
  assert.equal(byKey.get('k2').zh, '只有中文')
  assert.equal(byKey.get('k2').ja, '', '上游没转日文就留空，不许据中文回译')
})

test('日文那一列不过标点体例归一——那条体例管的是我们的中文译文', () => {
  const seasons = { s: { title: 't', year: 2026, name: 'n', page: 'p' } }
  const rows = [
    { code: '080', key: 'k1', scene: '秘书舰1', slot: 2, zh: '中文译文。', ja: '日本語の原文。', season: 's', name: '' },
  ]
  const { data } = buildSeasonalVoicePack(rows, new Map([['080', 43]]), new Map(), seasons)
  assert.equal(data.ships[43][0].zh, '中文译文', '中文该去掉行尾句号')
  assert.equal(data.ships[43][0].ja, '日本語の原文。', '日文原样落盘，一个字都不许动')
})

// ---- 真包抽查（缺包时跳过；test:lodes 那条路上包一定在） ----
const realPack = new URL('../assets/lodes/kcwiki-seasonal-voice.json', import.meta.url)

test('真包：结构完整、槽位合法、且日中两列都在', { skip: !fs.existsSync(realPack) }, () => {
  const { data } = JSON.parse(fs.readFileSync(realPack, 'utf8'))
  assert.equal(data.schemaVersion, 1)
  assert.ok(Object.keys(data.seasons).length >= 100, '季节数塌方')
  assert.ok(Object.keys(data.ships).length >= 400, '形态数塌方')
  let lines = 0
  let blankJa = 0
  for (const [shipId, rows] of Object.entries(data.ships)) {
    assert.ok(Number(shipId) > 0 && Number(shipId) < 1_500, `${shipId} 不是舰娘 id（深海无季节台词）`)
    for (const row of rows) {
      lines++
      assert.ok(data.seasons[row.season], `${row.key} 指向不存在的季节 ${row.season}`)
      // ⚠️ 判据 2026-08-22 反转：原来钉「不许有 ja」，现在钉「必须有 ja」。
      // 值允许是空串——上游确实没转日文的行照实空着（2024 十一周年那几张页只填了中文）。
      assert.equal(typeof row.ja, 'string', `${row.key} 缺日文原文这一列`)
      if (!row.ja.trim()) blankJa++
      if (row.slot !== undefined) {
        assert.ok(Number.isInteger(row.slot) && row.slot >= 1 && row.slot <= 53, `${row.key} 槽位越界`)
      }
    }
  }
  assert.ok(lines >= 4_000, `台词条数塌方：${lines}`)
  // 留空是允许的，但**不许成片**：空得多了通常意味着配对错位或底本没跟上，
  // 而那和「上游本来就没写」长得一模一样，只有拿比例才看得出来。
  assert.ok(blankJa <= lines * 0.05, `日文留空 ${blankJa}/${lines} 行，超过 5%——多半是配对出了问题`)
})
