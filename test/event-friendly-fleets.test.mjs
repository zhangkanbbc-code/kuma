import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { FRIENDLY_FLEET_NOTES, parseEventFriendlyFleets, tagEventFriendlyFleets } from '../scripts/lib/event-friendly-fleets.mjs'
import { bundledLodeIds } from '../scripts/lib/bundled-lodes.mjs'
import validation from '../dist/main/lode-validation.js'
import { renderFriendlyMaterials, renderFriendlySection } from './fixtures/render-du-friendly.mjs'

const readJson = (file) => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), 'utf8'))
const html = fs.readFileSync(new URL('./fixtures/kcwiki-event-friendly-20260906.html', import.meta.url), 'utf8')
const ships = readJson('../assets/lodes/kcwiki-ships.json')
const counts = { '62-1': 15, '62-2': 15, '62-3': 15, '62-4': 17, '62-5': 10 }
const sample = { ships: [{ id: 746, name: '桐改', lv: 80 }, { id: 706, name: '竹改', lv: 80 }] }
// 2026-09-06 从既有 s2.json 读回的六条完整日文名。仅测试夹具；生成器不内置此表。
const masterNames = [
  ['Saratoga Mk.II', 545], ['Fletcher Mk.II', 629], ['L.d.S.D.d.Abruzzi改', 693],
  ['Z1 zwei', 179], ['Z3 zwei', 180], ['Phoenix改', 734],
]

test('友军缓存节逐图解析全部组，保留日文舰名与等级，不编造备注或难度', () => {
  const { data } = parseEventFriendlyFleets(html, ships, 62)
  assert.deepEqual(Object.fromEntries(Object.entries(data.maps).map(([key, entry]) =>
    [key, entry.friendlyFleets.length])), counts)
  assert.deepEqual(data.maps['62-1'].friendlyFleets[0], sample)
  assert.deepEqual(Object.values(data.maps).map((entry) => entry.point), [
    'X 点（P3 Boss）', 'Y 点（P3 Boss）', 'Z 点（P4 Boss）', 'Z 点（P5 Boss）', 'ZZ 点（P4 Boss）',
  ])
  for (const entry of Object.values(data.maps)) {
    assert.deepEqual(Object.keys(entry).sort(), ['friendlyFleets', 'point'])
    for (const fleet of entry.friendlyFleets) {
      assert.equal(fleet.note, undefined)
      for (const ship of fleet.ships) assert.ok(Object.keys(ship).every((key) => ['id', 'name', 'lv'].includes(key)))
    }
  }
})

test('既有 kcwiki 日文名匹配器支持拉丁字母；不把部分命中当改造形态', () => {
  const { data, unresolved } = parseEventFriendlyFleets(html, ships, 62)
  assert.deepEqual(data.maps['62-3'].friendlyFleets[0].ships[0], { id: 697, name: 'South Dakota改', lv: 87 })
  assert.deepEqual([...new Set(unresolved.map((one) => one.name))].sort(), [
    'Fletcher Mk.II', 'L.d.S.D.d.Abruzzi改', 'Phoenix改', 'Saratoga Mk.II', 'Z1 zwei', 'Z3 zwei',
  ].sort())
  const unknown = data.maps['62-3'].friendlyFleets.flatMap((one) => one.ships).find((one) => one.name === 'Saratoga Mk.II')
  assert.equal(unknown.id, undefined, '不能误配到未改 Saratoga 433')
})

test('友军表结构缺失、等级含以下、空组与重复海图均明确报错', () => {
  assert.throws(() => parseEventFriendlyFleets('<h2>其他节</h2>', ships, 62), /找不到友军舰队节/)
  assert.throws(() => parseEventFriendlyFleets(html.replace('LV80', 'LV80以下'), ships, 62), /等级无法解析/)
  assert.throws(() => parseEventFriendlyFleets(html.replace('E2-Y', 'E1-Y'), ships, 62), /重复的友军海图/)
  assert.throws(() => parseEventFriendlyFleets('<h2>友军舰队</h2><table><th>E1-X点(P3 Boss)友军配置</th><div class="yjBox"></div></table>', ships, 62), /友军舰数非法/)
})

test('沿用既有主数据日文名补全后，全部舰名等值命中，解析结果与随包数据一致', () => {
  const { data, unresolved } = parseEventFriendlyFleets(html, ships, 62, masterNames)
  assert.deepEqual(unresolved, [])
  const bundledData = readJson('../assets/lodes/event-friendly-fleets.json').data
  for (const entry of Object.values(bundledData.maps)) {
    for (const fleet of entry.friendlyFleets) delete fleet.note
  }
  assert.deepEqual(data.maps, bundledData.maps, '维护者标签不能改变编成、舰序、等级或点位；历史另存')
  assert.equal(data.schemaVersion, bundledData.schemaVersion)
  for (const [name, id] of masterNames) {
    const entries = Object.values(data.maps).flatMap((entry) => entry.friendlyFleets)
      .flatMap((fleet) => fleet.ships).filter((ship) => ship.name === name)
    assert.ok(entries.length > 0)
    assert.ok(entries.every((ship) => ship.id === id))
  }
})

const tagFleet = (ids, note) => ({ ships: ids.map((id) => ({ id, name: `舰${id}` })), ...(note === undefined ? {} : { note }) })
const tagData = () => ({ schemaVersion: 1, maps: { '62-1': { point: 'X 点', friendlyFleets: [
  tagFleet([1, 2, 2]), tagFleet([3, 4]), tagFleet([5, 6]),
] } } })
const tagIntel = (layers) => ({ data: { maps: { '62-1': { difficulties: Object.fromEntries(
  Object.entries(layers).map(([difficulty, friendlyFleets]) => [difficulty, { operations: { friendlyFleets } }]),
) } } } })

test('Fletcher 订正仅在指定活动 E3 的参考侧生效，其它图或活动的 692 保持原样', () => {
  for (const event of ['反撃！第三十一戦隊の戦い', '其它活动', undefined]) {
    for (const map of ['62-3', '62-1']) {
      const input = { maps: { [map]: { friendlyFleets: [tagFleet([697, 659, 628]), tagFleet([697, 659, 692])] } } }
      const intel = { data: { maps: { [map]: {
        ...(event ? { event: { name: event } } : {}),
        difficulties: { 甲: { operations: { friendlyFleets: [tagFleet([697, 659, 692], '先遣队 · 强友军')] } } },
      } } } }
      const before = structuredClone({ input, intel })
      const applies = event === '反撃！第三十一戦隊の戦い' && map === '62-3'
      const { data, report } = tagEventFriendlyFleets(input, intel)
      assert.deepEqual(data.maps[map].friendlyFleets.map((fleet) => fleet.note), applies
        ? ['先遣队 · 强友军', undefined] : [undefined, '先遣队 · 强友军'])
      assert.equal(report[map].matched, 1)
      assert.deepEqual(data.maps[map].friendlyFleets.map((fleet) => fleet.ships), input.maps[map].friendlyFleets.map((fleet) => fleet.ships))
      assert.deepEqual({ input, intel }, before, '订正不能改写输入或参考行')
    }
  }
})

test('维护者标签精确归一四种取值；任一难度命中即可，输入与上游均不变', () => {
  assert.deepEqual(FRIENDLY_FLEET_NOTES, ['本队 · 强友军', '本队 · 普通友军', '先遣队 · 强友军', '先遣队 · 普通友军'])
  for (const note of FRIENDLY_FLEET_NOTES) {
    const input = tagData()
    const intel = tagIntel({ 甲: [], 乙: [tagFleet([1, 2, 2], note.replace(' · ', ' · 「') + '」枠')] })
    const before = structuredClone({ input, intel })
    const { data, report } = tagEventFriendlyFleets(input, intel)
    assert.equal(data.maps['62-1'].friendlyFleets[0].note, note)
    assert.equal(report['62-1'].tagged, 1)
    assert.deepEqual({ input, intel }, before)
  }
})

test('四难度同指纹不同 note 冲突不标，相同标签不被重复层误判为冲突', () => {
  const intel = tagIntel(Object.fromEntries(['甲', '乙', '丙', '丁'].map((difficulty) => [difficulty, [
    tagFleet([1, 2, 2], difficulty === '丁' ? '先遣队 · 「强友军」枠' : '本队 · 「强友军」枠'),
    tagFleet([3, 4], '本队 · 「普通友军」枠'),
  ]])))
  const { data, report } = tagEventFriendlyFleets(tagData(), intel)
  assert.equal(data.maps['62-1'].friendlyFleets[0].note, undefined)
  assert.equal(data.maps['62-1'].friendlyFleets[1].note, '本队 · 普通友军')
  assert.equal(report['62-1'].matched, 2)
  assert.equal(report['62-1'].conflicts.length, 1)
  assert.deepEqual(report['62-1'].conflicts[0].notes, ['本队 · 强友军', '先遣队 · 强友军'])
})

test('同难度同指纹跨波次本队优先，不受上游行顺序影响', () => {
  const rows = [tagFleet([3, 4], '本队 · 「普通友军」枠'), tagFleet([4, 3], '先遣队 · 「普通友军」枠')]
  for (const friendlyFleets of [rows, [...rows].reverse()]) {
    const { data, report } = tagEventFriendlyFleets(tagData(), tagIntel({ 甲: friendlyFleets }))
    assert.equal(data.maps['62-1'].friendlyFleets[1].note, '本队 · 普通友军')
    assert.equal(report['62-1'].conflicts.length, 0)
    assert.equal(report['62-1'].strengthDifferences.length, 0)
    assert.equal(report['62-1'].tagged, 1)
  }
})

test('两表强弱不同时取本队并单列汇报；先遣队旧行之间的分歧不影响本队', () => {
  const rows = [tagFleet([3, 4], '先遣队 · 「强友军」枠'),
    tagFleet([4, 3], '本队 · 「普通友军」枠'), tagFleet([3, 4], '先遣队 · 普通友军')]
  for (const friendlyFleets of [rows, [...rows].reverse()]) {
    const { data, report } = tagEventFriendlyFleets(tagData(), tagIntel({ 甲: friendlyFleets, 乙: friendlyFleets }))
    assert.equal(data.maps['62-1'].friendlyFleets[1].note, '本队 · 普通友军')
    assert.equal(report['62-1'].conflicts.length, 0)
    assert.equal(report['62-1'].strengthDifferences.length, 1)
    assert.deepEqual(report['62-1'].strengthDifferences[0].difficulties, ['甲', '乙'])
    assert.deepEqual(new Set(report['62-1'].strengthDifferences[0].notes), new Set(rows.map((row) => row.note)))
  }
})

test('本队行之间强弱不一致仍为真冲突，不让先遣队或行顺序消除冲突', () => {
  const rows = [tagFleet([3, 4], '本队 · 「强友军」枠'),
    tagFleet([4, 3], '先遣队 · 「普通友军」枠'), tagFleet([3, 4], '本队 · 普通友军')]
  for (const friendlyFleets of [rows, [...rows].reverse()]) {
    const { data, report } = tagEventFriendlyFleets(tagData(), tagIntel({ 甲: friendlyFleets }))
    assert.equal(data.maps['62-1'].friendlyFleets[1].note, undefined)
    assert.equal(report['62-1'].tagged, 0)
    assert.equal(report['62-1'].conflicts.length, 1)
    assert.deepEqual(new Set(report['62-1'].conflicts[0].notes), new Set(['本队 · 强友军', '本队 · 普通友军']))
  }
})

test('各难度先取本队再对照；本队强弱跨难度不同仍冲突', () => {
  const { data, report } = tagEventFriendlyFleets(tagData(), tagIntel({
    甲: [tagFleet([3, 4], '本队 · 普通友军'), tagFleet([3, 4], '先遣队 · 强友军')],
    乙: [tagFleet([3, 4], '本队 · 强友军')],
  }))
  assert.equal(data.maps['62-1'].friendlyFleets[1].note, undefined)
  assert.equal(report['62-1'].conflicts.length, 1)
  assert.deepEqual(report['62-1'].conflicts[0].notes, ['本队 · 普通友军', '本队 · 强友军'])
})

test('未匹配与重复舰 id 数量不符都不标，参考独有编成只汇报且跨难度去重', () => {
  const rows = [tagFleet([1, 2], '本队 · 「强友军」枠'), tagFleet([3, 4], '本队 · 「普通友军」枠')]
  const { data, report } = tagEventFriendlyFleets(tagData(), tagIntel({ 甲: rows, 乙: rows }))
  const fleets = data.maps['62-1'].friendlyFleets
  assert.equal(fleets.length, 3)
  assert.ok(!Object.hasOwn(fleets[0], 'note') && !Object.hasOwn(fleets[2], 'note'))
  assert.deepEqual(report['62-1'].unmatched.map((one) => one.ships.map((ship) => ship.id)), [[1, 2, 2], [5, 6]])
  assert.equal(report['62-1'].extra.length, 1)
  assert.deepEqual(report['62-1'].extra[0].ships.map((ship) => ship.id), [1, 2])
  assert.equal(tagEventFriendlyFleets(tagData(), { data: { maps: {} } }).report['62-1'].unmatched.length, 3)
})

test('旗舰不同但多重集合相同仍匹配，并单列记录，不改变舰娘百科舰序', () => {
  const { data, report } = tagEventFriendlyFleets(tagData(), tagIntel({ 甲: [
    tagFleet([2, 1, 2], '先遣队 · 「强友军」枠'),
  ] }))
  assert.equal(data.maps['62-1'].friendlyFleets[0].note, '先遣队 · 强友军')
  assert.deepEqual(data.maps['62-1'].friendlyFleets[0].ships.map((ship) => ship.id), [1, 2, 2])
  assert.deepEqual(report['62-1'].flagshipDifferences, [{ ships: tagFleet([1, 2, 2]).ships, differentFlagships: [2] }])
})

test('非允许 note 汇报且不写，无友军来援和空编成忽略', () => {
  for (const note of ['本队 · 「強友軍」枠', '本队 · 强友军（推测）', '', undefined, 7]) {
    const { data, report } = tagEventFriendlyFleets(tagData(), tagIntel({ 甲: [
      tagFleet([1, 2, 2], note), tagFleet([], '本队 · 无友军来援'), tagFleet([3, 4], '本队 · 无友军来援'),
    ] }))
    assert.ok(data.maps['62-1'].friendlyFleets.every((fleet) => !Object.hasOwn(fleet, 'note')))
    assert.equal(report['62-1'].invalidNotes.length, 1)
    assert.equal(report['62-1'].extra.length, 0)
    assert.equal(report['62-1'].matched, 1)
  }
})

const bundled = {
  meta: { source: '随包来源' },
  data: { maps: { '62-1': { point: 'X 点（P3 Boss）', friendlyFleets: [sample, sample] } } },
}
const fallback = {
  meta: { source: '回退来源' },
  operations: { friendlyFleets: [{ ships: [{ id: 1, name: '回退舰名' }], note: '回退备注' }] },
}

test('du 随包优先于 map-intel，点位只显示一次，来源随包切换且保留 Lv', () => {
  const rendered = renderFriendlyMaterials('62-1', bundled, fallback)
  assert.match(rendered, /桐改/)
  assert.match(rendered, /Lv80/)
  assert.match(rendered, /title="随包来源"/)
  assert.equal(rendered.match(/出现点：X 点（P3 Boss）/g)?.length, 1)
  assert.doesNotMatch(rendered, /回退舰名|回退备注|回退来源|op-fnote|这个难度暂无/)
})

test('du 按图回退 map-intel；两份资料都缺才挂牌', () => {
  const rendered = renderFriendlyMaterials('62-2', bundled, fallback)
  assert.match(rendered, /回退舰名/)
  assert.match(rendered, /title="回退来源"/)
  assert.doesNotMatch(rendered, /出现点：|随包来源|桐改/)
  assert.match(renderFriendlyMaterials('62-2', bundled, null), /这个难度暂无友军编成资料/)
  assert.match(renderFriendlyMaterials('62-1', null, fallback), /回退舰名/)
})

test('du 缺省或空 note 均不显示备注段', () => {
  assert.doesNotMatch(renderFriendlySection([], [sample, { ...sample, note: '' }]), /op-fnote/)
})

test('du 随包标签在编成下方显示，本机遭遇明细与资料标签仍分层并列', () => {
  const seen = [{ ships: [{ mstId: 746, lv: 80, slot: [], slotEx: 0 }],
    requestTypes: [], cells: [{ cell: 24, count: 2 }], lastTs: 123 }]
  const rendered = renderFriendlySection(seen, [{ ...sample, note: '本队 · 强友军' }])
  const [local, material] = rendered.split('<div class="op-sub">友军编成资料</div>')
  assert.match(local, /本地遭遇友军/)
  assert.match(local, /点位 24 ×2 · 最近 TS123/)
  assert.doesNotMatch(local, /本队 · 强友军/)
  assert.match(material, /<\/div><span class="op-fnote">本队 · 强友军<\/span>/)
  assert.doesNotMatch(material, /点位 24|最近 TS123/)
})

test('随包友军 JSON 每图非空、全舰正整数 mstId、note 若存在必在四个取值内', () => {
  const pack = readJson('../assets/lodes/event-friendly-fleets.json')
  assert.equal(validation.validateLodePack(pack).ok, true)
  assert.ok(bundledLodeIds().includes(pack.meta.id))
  assert.deepEqual(Object.keys(pack.data.maps).sort(), Object.keys(counts))
  for (const [map, entry] of Object.entries(pack.data.maps)) {
    assert.equal(entry.friendlyFleets.length, counts[map])
    for (const fleet of entry.friendlyFleets) {
      assert.ok(!Object.hasOwn(fleet, 'note') || FRIENDLY_FLEET_NOTES.includes(fleet.note))
      assert.ok(fleet.ships.length > 0)
      for (const ship of fleet.ships) {
        assert.ok(Number.isInteger(ship.id) && ship.id > 0)
        assert.ok(ship.lv === undefined || (Number.isInteger(ship.lv) && ship.lv > 0))
      }
    }
  }
  // JSON 文案也过 core-regressions 中同一张禁词表；不把日文舰名当中文文案扫。
  const guards = fs.readFileSync(new URL('./core-regressions.test.mjs', import.meta.url), 'utf8')
  const calques = new RegExp(guards.match(/\/(所持\|在籍[^\n]+)\//)[1])
  for (const text of [pack.meta.note, ...Object.values(pack.data.maps).flatMap((entry) =>
    [`出现点：${entry.point}`, ...entry.friendlyFleets.map((fleet) => fleet.note ?? '')])]) {
    assert.doesNotMatch(text, calques)
  }
})

test('随包友军维护者标注覆盖率 100%', () => {
  const fleets = Object.values(readJson('../assets/lodes/event-friendly-fleets.json').data.maps)
    .flatMap((entry) => entry.friendlyFleets)
  // 2026-09-06 E3 Fletcher 参考侧订正后实测 72/72（100%）。
  assert.equal(fleets.filter((fleet) => fleet.note).length, fleets.length)
  assert.deepEqual(new Set(fleets.filter((fleet) => fleet.note).map((fleet) => fleet.note)), new Set(FRIENDLY_FLEET_NOTES))
})

test('随包 E3 两组 Fletcher Mod.2 的 note 非空并分别取三舰与四舰参考行标签', () => {
  const fleets = readJson('../assets/lodes/event-friendly-fleets.json').data.maps['62-3'].friendlyFleets
    .filter((fleet) => fleet.ships.some((ship) => ship.id === 628))
  assert.equal(fleets.length, 2)
  for (const [ids, note] of [
    [[697, 659, 628], '先遣队 · 强友军'],
    [[697, 659, 628, 726], '本队 · 强友军'],
  ]) {
    const fleet = fleets.find((one) => JSON.stringify(one.ships.map((ship) => ship.id)) === JSON.stringify(ids))
    assert.ok(fleet)
    assert.equal(fleet.note, note)
  }
})

test('随包友军校验拒绝坏形状、过量编组、空舰队、非法 mstId 或等级', () => {
  const pack = {
    meta: { id: 'event-friendly-fleets', name: '友军', version: '1', source: 'test', fetchedAt: new Date().toISOString() },
    data: structuredClone(bundled.data),
  }
  pack.data.schemaVersion = 1
  assert.equal(validation.validateLodePack(pack).ok, true)
  const changes = [
    (data) => { data.schemaVersion = 2 },
    (data) => { data.maps = [] },
    (data) => { data.maps = Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`62-${i}`, data.maps['62-1']])) },
    (data) => { data.maps['62-1'].point = '' },
    (data) => { data.maps['62-1'].friendlyFleets = [] },
    (data) => { data.maps['62-1'].friendlyFleets = Array(101).fill(sample) },
    (data) => { data.maps['62-1'].friendlyFleets[0].ships = [] },
    (data) => { data.maps['62-1'].friendlyFleets[0].ships = Array(13).fill(sample.ships[0]) },
    (data) => { data.maps['62-1'].friendlyFleets[0].ships[0].id = 0 },
    (data) => { delete data.maps['62-1'].friendlyFleets[0].ships[0].id },
    (data) => { data.maps['62-1'].friendlyFleets[0].ships[0].lv = '80' },
    (data) => { data.maps['62-1'].friendlyFleets[0].note = 1 },
  ]
  for (const change of changes) {
    const bad = structuredClone(pack)
    change(bad.data)
    assert.equal(validation.validateLodePack(bad).ok, false)
  }
})
