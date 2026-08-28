// 倍卡国籍的**例外层**护栏。
//
// 结构缺陷本身：国籍靠 api_sort_id 的号段判，而号段是 C2 的图鉴排序编码，
// 跨国改造形态不跟着走。这一组测试钉的是**机制**（先例外、再号段、换期即失效），
// 单期事实由台账逐条带依据自证。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import apply from '../dist/shared/event-bonus-apply.js'
import ledger from '../dist/shared/event-bonus-nationality.js'
import nationality from '../dist/shared/ship-nationality.js'

const { eventBonusFor, eventBonusNationOf } = apply
const {
  EVENT_NATIONALITY_RULINGS,
  eventBonusPackPageOf,
  eventNationalityRulingCount,
  eventNationalityRulingFor,
} = ledger
const { shipNationalityOf } = nationality

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PAGE = '2026年夏季活动'

// 本期真实条目的一个子集（kcwiki 2026.08.07 包，逐条照抄）。
// 只留国籍与舰种两类，够把「哪个国籍键被命中」看清楚。
const ENTRIES = [
  { scope: '全图', by: 'nation', key: '意', value: 1.19, certain: true },
  { scope: '全图', by: 'nation', key: '英', value: 1.15, certain: true },
  { scope: '全图', by: 'nation', key: '德', value: 1.08, certain: true },
  { scope: '全图', by: 'nation', key: '苏', value: 1.06, certain: true },
  { scope: '全图', by: 'nation', key: '瑞', value: 1.06, certain: true },
  { scope: 'P4 Boss（ZZ点）', by: 'nation', key: '苏', value: 1.9285, certain: true },
  { scope: 'P4 Boss（ZZ点）', by: 'nation', key: '德', value: 1.475, certain: true },
]

// stype 9（戦艦）不在本期舰种列里，用它当载体就只会乘到国籍那一项。
const ship = (over) => ({ mstId: 0, name: '某舰', stype: 9, nationality: null, ...over })
const at = (s, letter = null, page = PAGE) => eventBonusFor(s, [], ENTRIES, letter, {}, page)
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `期望 ${b}，实得 ${a}`)
const nationKeys = (r) => r.applied.filter((e) => e.by === 'nation').map((e) => e.key)

// 号段给出的键，转成倍卡表列名口径（俄→苏）。用产品自己的换算，不在测试里再抄一份。
const bySortId = (sortId) =>
  eventBonusNationOf(
    { mstId: -1, nationality: shipNationalityOf({ api_sort_id: sortId })?.short ?? null },
    null,
  ).nation

test('Верный 落在日本号段，但本期特效组把她算苏联舰——例外必须先于号段', () => {
  // 号段口径：sort_id 14226 紧挨 響改，判「日」；本期没有「日」列 ⇒ 一格倍卡都吃不到
  assert.equal(bySortId(14226), '日')
  const raw = at(ship({ mstId: 147, name: 'Верный', stype: 2, nationality: '日' }), 'ZZ', null)
  near(raw.multiplier, 1)
  assert.deepEqual(nationKeys(raw), [])

  // 台账生效后：全图苏 × ZZ 点苏
  const fixed = at(ship({ mstId: 147, name: 'Верный', stype: 2, nationality: '日' }), 'ZZ')
  assert.deepEqual(nationKeys(fixed), ['苏', '苏'])
  near(fixed.multiplier, 1.06 * 1.9285)
  assert.equal(fixed.nation, '苏')
  assert.equal(fixed.nationRuling?.mstId, 147)
})

test('例外也会把号段判错的那种改回去：UIT-25 吃「意」不吃「德」', () => {
  // sort_id 30731 在德国段——不修的话她会去乘德国那一列
  assert.equal(bySortId(30731), '德')
  const raw = at(ship({ mstId: 539, name: 'UIT-25', stype: 13, nationality: '德' }), 'ZZ', null)
  assert.deepEqual(nationKeys(raw), ['德', '德'])

  const fixed = at(ship({ mstId: 539, name: 'UIT-25', stype: 13, nationality: '德' }), 'ZZ')
  assert.deepEqual(nationKeys(fixed), ['意'])
  near(fixed.multiplier, 1.19)
})

test('丹陽不在台账上，照号段落日本——本期没有「日」列，所以哪个国籍键都不吃', () => {
  assert.equal(eventNationalityRulingFor(651, PAGE), null, '丹陽不该出现在例外台账里')
  const tanyang = at(ship({ mstId: 651, name: '丹陽', stype: 2, nationality: '日' }), 'ZZ')
  assert.deepEqual(nationKeys(tanyang), [])
  near(tanyang.multiplier, 1)
  assert.equal(tanyang.nationRuling, null, '走的应当是号段缺省路径')
})

test('号段缺省路径回归不变：真外国舰一条例外都不用写', () => {
  const byNation = (nation) => at(ship({ mstId: 999_001, nationality: nation })).multiplier
  near(byNation('英'), 1.15)
  near(byNation('德'), 1.08)
  near(byNation('意'), 1.19)
  near(byNation('俄'), 1.06) // 本仓库记「俄」，倍卡表列名是「苏」
  near(byNation('瑞'), 1.06)
  near(byNation('日'), 1)
  near(byNation(null), 1)
})

test('台账逐期：期号对不上就整段不生效，退回号段而不是套上一期的名单', () => {
  const verniy = ship({ mstId: 147, name: 'Верный', stype: 2, nationality: '日' })
  // 换了活动页（下一期）
  near(at(verniy, 'ZZ', '2027年冬季活动').multiplier, 1)
  // 资料包 URL 取不出页名
  near(at(verniy, 'ZZ', null).multiplier, 1)
  assert.equal(eventNationalityRulingCount('2027年冬季活动'), 0)
  assert.ok(eventNationalityRulingCount(PAGE) > 0)
})

test('期号从资料包 sourceUrl 的 page= 参数取，取不出就是 null（不猜）', () => {
  assert.equal(
    eventBonusPackPageOf(
      'https://zh.kcwiki.cn/api.php?action=parse&page=2026%E5%B9%B4%E5%A4%8F%E5%AD%A3%E6%B4%BB%E5%8A%A8&prop=wikitext',
    ),
    PAGE,
  )
  assert.equal(eventBonusPackPageOf('https://zh.kcwiki.cn/api.php?action=parse'), null)
  assert.equal(eventBonusPackPageOf(null), null)
  assert.equal(eventBonusPackPageOf(undefined), null)
  // 坏转义不抛、也不猜
  assert.equal(eventBonusPackPageOf('https://x/?page=%E4%B8'), null)
})

test('台账的期号必须与 lode-sources.json 现行的活动页一致（换期忘了更新就红）', () => {
  const sources = JSON.parse(
    fs.readFileSync(path.join(root, 'scripts', 'lode-sources.json'), 'utf8'),
  )
  const entry = sources.find((one) => one.id === 'event-bonus')
  assert.ok(entry, 'lode-sources.json 里没有 event-bonus 项了？')
  const page = eventBonusPackPageOf(entry.url)
  assert.ok(page, `event-bonus 的 url 里取不出页名：${entry.url}`)
  const pages = [...new Set(EVENT_NATIONALITY_RULINGS.map((one) => one.packPage))]
  assert.ok(
    pages.includes(page),
    `资料包现在指着「${page}」，而国籍例外台账只覆盖 ${pages.join('、')}——换期了就得重查一遍特效组的名单`,
  )
})

test('台账自洽：mstId 不重复，kind 与「是否真的改判」对得上', () => {
  const seen = new Set()
  for (const ruling of EVENT_NATIONALITY_RULINGS) {
    const key = `${ruling.packPage}|${ruling.mstId}`
    assert.ok(!seen.has(key), `台账里 ${ruling.name}(${ruling.mstId}) 记了两遍`)
    seen.add(key)
    assert.equal(
      ruling.bySortId,
      bySortId(ruling.sortId),
      `${ruling.name}(${ruling.mstId}) 的 bySortId 与 sortId 对不上`,
    )
    const changed = ruling.nation !== ruling.bySortId
    assert.equal(
      ruling.kind,
      changed ? 'override' : 'confirm',
      `${ruling.name}(${ruling.mstId}) 的 kind 标错了`,
    )
    assert.ok(ruling.jp && ruling.source && ruling.why && ruling.decidedAt, `${ruling.name} 缺依据`)
  }
  // 白记的确认条目允许存在，但改判条目必须真的有——否则这一层是死代码
  assert.ok(EVENT_NATIONALITY_RULINGS.some((one) => one.kind === 'override'))
})

test('台账钉的 api_sort_id 与真实主数据逐条对得上（C2 重编号就当场红）', (t) => {
  const sample = path.join(root, '..', 's2.json')
  if (!fs.existsSync(sample)) {
    t.skip('缺 api_start2 样本（../s2.json），跳过逐条复核；test:lodes 会强制要求它')
    return
  }
  const raw = JSON.parse(fs.readFileSync(sample, 'utf8'))
  const master = raw.api_data?.api_mst_ship ?? raw.api_mst_ship
  const byId = new Map(master.map((one) => [one.api_id, one]))
  for (const ruling of EVENT_NATIONALITY_RULINGS) {
    const ship = byId.get(ruling.mstId)
    assert.ok(ship, `主数据里没有 ${ruling.name}(${ruling.mstId})`)
    assert.equal(ship.api_name, ruling.name, `${ruling.mstId} 的名字变了`)
    assert.equal(
      ship.api_sort_id,
      ruling.sortId,
      `${ruling.name}(${ruling.mstId}) 的 api_sort_id 变了——这条例外的前提要重查`,
    )
  }
})
