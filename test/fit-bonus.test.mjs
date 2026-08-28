// 装备加成重建（第一批·数据工程）的护栏。
//
// 分两层：
//   ① 纯单元层——拿手写的小 Lua 片段跑解析与词表，任何机器上都能跑；
//   ② 真包层——有 assets/lodes/kcwiki-fit-bonus.json 与 api_start2 快照时才跑，
//      逐条核「包里每个 id 都在主数据里找得到」。这一层不能用假数据代替：
//      词表的价值全在「504 个名字有没有着落」，抽样等于没测。
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import lodeValidation from '../dist/main/lode-validation.js'
import { parseLuaTable } from '../scripts/lib/kcwiki-lua.mjs'
import { loadStart2MasterArray } from '../scripts/lib/start2.mjs'
import { buildFitBonusPack } from '../scripts/lib/kcwiki-fit-bonus.mjs'
import {
  FIT_BONUS_NAME_VOCAB,
  createFitBonusNameResolver,
  normalizeFitBonusName,
} from '../scripts/lib/fit-bonus-vocab.mjs'
import {
  KNOWN_FIT_BONUS_CONFLICTS,
  PENDING_FIT_BONUS_CONFLICTS,
  fitBonusConflictDigest,
  fitBonusConflictFingerprint,
} from '../scripts/lib/fit-bonus-conflicts.mjs'
import { foldCjkVariants } from '../src/shared/cjk-fold.ts'

const { validateLodePack } = lodeValidation
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packFile = path.join(root, 'assets', 'lodes', 'kcwiki-fit-bonus.json')

// ---- ① 纯单元层 ----

const fakeMasterShips = [
  { api_id: 20, api_name: '雪風', api_sortno: 1, api_ctype: 30, api_stype: 2, api_aftershipid: '228' },
  { api_id: 228, api_name: '雪風改', api_sortno: 1, api_ctype: 30, api_stype: 2, api_aftershipid: '656' },
  { api_id: 656, api_name: '雪風改二', api_sortno: 1, api_ctype: 30, api_stype: 2 },
  { api_id: 998, api_name: 'Norge', api_sortno: 2, api_ctype: 130, api_stype: 9 },
  { api_id: 501, api_name: '最上改二', api_sortno: 3, api_ctype: 9, api_stype: 6 },
]
const fakeMasterStypes = [
  { api_id: 2, api_name: '駆逐艦' },
  { api_id: 6, api_name: '航空巡洋艦' },
  { api_id: 9, api_name: '戦艦' },
]
const fakeKcwikiShips = [
  { ID: 20, 中文名: '雪风', 级别: ['阳炎型', 8], 舰种: 2 },
  { ID: 228, 中文名: '雪风改', 级别: ['阳炎型', 8], 舰种: 2 },
  { ID: 656, 中文名: '雪风改二', 级别: ['阳炎型', 8], 舰种: 2 },
  { ID: 998, 中文名: '挪威', 级别: ['挪威型', 1], 舰种: 9 },
  { ID: 501, 中文名: '最上改二', 级别: ['最上型', 1], 舰种: 24 },
]
const resolver = createFitBonusNameResolver({
  masterShips: fakeMasterShips,
  masterStypes: fakeMasterStypes,
  kcwikiShips: fakeKcwikiShips,
  fold: foldCjkVariants,
})

test('名字解析分四层：形态名 → 舰级名 → 舰种名 → 人工词表', () => {
  // 形态名：中文名与日文名两侧都收（后者救 Norge 这类只有拉丁名的形态）
  assert.deepEqual(resolver.resolve('雪风改二'), { kind: 'forms', forms: [656], via: 'ship-name' })
  assert.deepEqual(resolver.resolve('Norge'), { kind: 'forms', forms: [998], via: 'ship-name' })
  // 舰级名：上游写「◯◯级」，kcwiki 的 级别[0] 写「◯◯型」，两种写法都认
  assert.deepEqual(resolver.resolve('阳炎型'), { kind: 'classes', classes: [30], via: 'class-name' })
  assert.deepEqual(resolver.resolve('阳炎级'), { kind: 'classes', classes: [30], via: 'class-name' })
  // 舰种名：日文原名
  assert.deepEqual(resolver.resolve('駆逐艦'), { kind: 'types', types: [2], via: 'stype-name' })
  // 人工词表：舰种别名
  assert.equal(resolver.resolve('战列舰')?.types?.[0], 9)
  // 落不了地的一律 null，绝不模糊命中
  assert.equal(resolver.resolve('没有这个东西'), null)
})

test('「雪风」是精确形态，不是整条改造链', () => {
  // 这一条搞反会让加成套错舰（EO 的 shipX / shipS 之别）。上游逐形态列举，
  // 所以链首名字只认链首那一个 id。
  assert.deepEqual(resolver.resolve('雪风'), { kind: 'forms', forms: [20], via: 'ship-name' })
  assert.ok(!resolver.resolve('雪风').forms.includes(228))
  assert.ok(!resolver.resolve('雪风').forms.includes(656))
})

test('词表里带 sibling 的词，单独出现时不许静默按旧解释算', () => {
  const lua = `local d = {}
d.equipDataTb = {
\t["001"] = {
\t\t["ID"] = 1,
\t\t["日文名"] = "試験装備",
\t\t["中文名"] = "试验装备",
\t\t["额外收益"] = {
\t\t\t["适用舰娘"] = { "改装航空巡洋舰" },
\t\t\t["收益类型"] = "通用",
\t\t\t["收益属性"] = { ["火力"] = 1 }
\t\t}
\t}
}`
  const { data } = buildFitBonusPack(parseLuaTable(lua, 'd.equipDataTb'), resolver)
  assert.equal(data.equips['1'], undefined)
  const reasons = data.unresolved.map((row) => row.reason)
  // 一条说「这个名字按词表要求得与父类目同行」，一条说「整行没了、不摊成全舰船」——
  // 后者是必须的：把一条解析失败摊成全舰船生效，比丢掉这行危险得多。
  assert.match(reasons.join(' / '), /改装航空巡洋舰.*航空巡洋舰/)
  assert.match(reasons.join(' / '), /不摊成全舰船/)
})

test('分档与叠加规则如实落成 schema 的形状', () => {
  const lua = `local d = {}
d.equipDataTb = {
\t["001"] = {
\t\t["ID"] = 1,
\t\t["日文名"] = "試験装備",
\t\t["中文名"] = "试验装备",
\t\t["额外收益"] = {
\t\t\t["适用舰娘"] = { "雪风改二" },
\t\t\t["收益类型"] = "改修",
\t\t\t["收益属性"] = {
\t\t\t\t["5~7"] = { ["命中"] = 1 },
\t\t\t\t["max"] = { ["火力"] = 1, ["命中"] = 2 }
\t\t\t},
\t\t\t["最大数量"] = 1
\t\t},
\t\t["额外收益2"] = {
\t\t\t["适用舰娘"] = { "阳炎型" },
\t\t\t["收益类型"] = "数量",
\t\t\t["收益属性"] = { ["1"] = { ["火力"] = 2 }, ["2"] = { ["火力"] = 5 } }
\t\t},
\t\t["额外收益3"] = {
\t\t\t["改修等级"] = 4,
\t\t\t["装备组合"] = { "试验装备" },
\t\t\t["适用舰娘"] = { "駆逐艦" },
\t\t\t["非适用舰娘"] = { "雪风改二" },
\t\t\t["收益类型"] = "通用",
\t\t\t["收益属性"] = { ["回避"] = 3 },
\t\t\t["累计套装加成"] = { ["火力"] = 3 }
\t\t}
\t}
}`
  const { data, report } = buildFitBonusPack(parseLuaTable(lua, 'd.equipDataTb'), resolver)
  assert.equal(report.unresolved, 0)
  const [byStar, byCount, flat] = data.equips['1'].rules
  // max 读成 ★10；「5~7」是闭区间；最大数量 1 = 只加一次
  assert.deepEqual(byStar.gain.steps, [
    { from: 5, to: 7, stats: { accuracy: 1 } },
    { from: 10, to: 10, stats: { fire: 1, accuracy: 2 } },
  ])
  assert.equal(byStar.stack, 'once')
  // 数量档：表本身就是叠加规则
  assert.deepEqual(byCount.gain.counts, [
    { count: 1, stats: { fire: 2 } },
    { count: 2, stats: { fire: 5 } },
  ])
  assert.equal(byCount.stack, 'table')
  // 协同装备按名字落成 id 槽位；带协同的行只加一次
  assert.deepEqual(flat.need, { star: 4, with: [{ any: [1] }] })
  assert.deepEqual(flat.not, { forms: [656] })
  assert.deepEqual(flat.setTotal, { fire: 3 })
  assert.equal(flat.stack, 'once')
})

test('没见过的字段与分档键一律挂牌，不静默丢', () => {
  const lua = `local d = {}
d.equipDataTb = {
\t["001"] = {
\t\t["ID"] = 1,
\t\t["日文名"] = "試験装備",
\t\t["中文名"] = "试验装备",
\t\t["额外收益"] = {
\t\t\t["适用舰娘"] = { "雪风改二" },
\t\t\t["收益类型"] = "通用",
\t\t\t["收益属性"] = { ["火力"] = 1, ["神秘属性"] = 2 },
\t\t\t["新字段"] = 1
\t\t},
\t\t["额外收益2"] = {
\t\t\t["适用舰娘"] = { "雪风改二" },
\t\t\t["收益类型"] = "全新类型",
\t\t\t["收益属性"] = { ["火力"] = 1 }
\t\t}
\t}
}`
  const { data } = buildFitBonusPack(parseLuaTable(lua, 'd.equipDataTb'), resolver)
  const reasons = data.unresolved.map((row) => row.reason).join(' / ')
  assert.match(reasons, /未识别字段「新字段」/)
  assert.match(reasons, /未识别的收益属性「神秘属性」/)
  assert.match(reasons, /未识别的收益类型「全新类型」/)
  // 认得的那部分照样出包，不因为一处怪字段就整件丢掉
  assert.deepEqual(data.equips['1'].rules[0].gain.flat, { fire: 1 })
})

// ---- 台账 ----

test('冲突台账每条都给得出依据，指纹与它自己算的一致', () => {
  // jp-third = 日文一手在某一格给出了两边都没有的**第三个值**（2026-08-22 加的第四值）
  const verdicts = new Set(['ours', 'eo', 'jp-third', 'UNRESOLVED'])
  for (const conflict of KNOWN_FIT_BONUS_CONFLICTS) {
    const at = `#${conflict.equipId} ${conflict.equipName}`
    assert.ok(Number.isInteger(conflict.equipId) && conflict.equipId > 0, `${at} equipId 非法`)
    assert.ok(conflict.shipIds.length > 0, `${at} 没有涉及的形态`)
    assert.deepEqual(conflict.shipIds, [...conflict.shipIds].sort((a, b) => a - b), `${at} shipIds 未排序`)
    assert.ok(verdicts.has(conflict.verdict), `${at} verdict 非法`)
    assert.ok(conflict.why.trim(), `${at} 没写分歧在哪`)
    // 裁出结论的必须给得出日文一手；给不出就只能挂 UNRESOLVED
    if (conflict.verdict !== 'UNRESOLVED') {
      assert.ok(conflict.jp.trim(), `${at} 裁了却没有日文出处`)
      assert.ok(conflict.source.trim(), `${at} 裁了却没写出处是哪一页`)
    }
    // 指纹里点到的形态必须与 shipIds 一致——两处漂移就等于自失效核对失灵
    const cited = [...conflict.fingerprint.matchAll(/(?:^|;)(\d+)\[/g)].map((m) => Number(m[1]))
    assert.deepEqual(cited.sort((a, b) => a - b), conflict.shipIds, `${at} 指纹与 shipIds 对不上`)
  }
})

test('待裁清单与已裁台账不重叠，每条都记着日文票的新鲜度', () => {
  const arbitrated = new Set(KNOWN_FIT_BONUS_CONFLICTS.map((known) => known.equipId))
  const seen = new Set()
  for (const pending of PENDING_FIT_BONUS_CONFLICTS) {
    const at = `#${pending.equipId} ${pending.equipName}`
    assert.ok(!arbitrated.has(pending.equipId), `${at} 既在已裁台账又在待裁清单`)
    assert.ok(!seen.has(pending.equipId), `${at} 在待裁清单里重复`)
    seen.add(pending.equipId)
    assert.ok(Number.isInteger(pending.cells) && pending.cells > 0, `${at} cells 非法`)
    assert.match(pending.digest, /^[0-9a-f]{8}$/, `${at} digest 不是短哈希`)
    // jpVote 是「日文那一票有多新」；空串是**票不够**的诚实记录，不是忘了填
    assert.equal(typeof pending.jpVote, 'string', `${at} jpVote 非法`)
    if (pending.jpVote) assert.match(pending.jpVote, /^\d{4}-\d{2}-\d{2}$|^akashi$/, `${at} jpVote 写法非法`)
  }
})

test('短摘要与全指纹同源：数变了它就变', () => {
  const rows = [{ shipId: 1, ours: { fire: 1 }, eo: { fire: 2 } }]
  const changed = [{ shipId: 1, ours: { fire: 1 }, eo: { fire: 3 } }]
  assert.match(fitBonusConflictDigest(rows), /^[0-9a-f]{8}$/)
  assert.notEqual(fitBonusConflictDigest(rows), fitBonusConflictDigest(changed))
  assert.equal(fitBonusConflictDigest(rows), fitBonusConflictDigest([...rows]))
})

test('指纹对数值敏感、对字段顺序与行序不敏感', () => {
  const rows = [
    { shipId: 2, ours: { fire: 1, aa: 2 }, eo: { aa: 2, fire: 3 } },
    { shipId: 1, ours: { evasion: 1 }, eo: { evasion: 2 } },
  ]
  const shuffled = [
    { shipId: 1, ours: { evasion: 1 }, eo: { evasion: 2 } },
    { shipId: 2, ours: { aa: 2, fire: 1 }, eo: { fire: 3, aa: 2 } },
  ]
  assert.equal(fitBonusConflictFingerprint(rows), fitBonusConflictFingerprint(shuffled))
  const changed = structuredClone(rows)
  changed[0].eo.fire = 4
  assert.notEqual(fitBonusConflictFingerprint(rows), fitBonusConflictFingerprint(changed))
})

// ---- ② 真包层 ----

const pack = existsSync(packFile) ? JSON.parse(readFileSync(packFile, 'utf8')) : null
const masterShips = loadStart2MasterArray('api_mst_ship', root)
const masterSlots = loadStart2MasterArray('api_mst_slotitem', root)
const masterStypes = loadStart2MasterArray('api_mst_stype', root)
const realReady = Boolean(pack && masterShips.length && masterSlots.length && masterStypes.length)
const realSkip = realReady ? false : '缺 kcwiki-fit-bonus 包或 api_start2 主数据快照'

test('真包：校验器认它，且解析零挂牌', { skip: realSkip }, () => {
  const result = validateLodePack(pack)
  assert.equal(result.ok, true, result.ok ? '' : result.error)
  assert.deepEqual(pack.data.unresolved, [])
  assert.ok(Object.keys(pack.data.equips).length >= 250)
})

test('真包：每个 id 都在主数据里找得到（逐条，不抽样）', { skip: realSkip }, () => {
  const shipIds = new Set(masterShips.map((ship) => Number(ship.api_id)))
  const slotIds = new Set(masterSlots.map((slot) => Number(slot.api_id)))
  const ctypeIds = new Set(masterShips.map((ship) => Number(ship.api_ctype)).filter((id) => id > 0))
  const stypeIds = new Set(masterStypes.map((type) => Number(type.api_id)))
  let forms = 0
  let classes = 0
  let types = 0
  for (const entry of Object.values(pack.data.equips)) {
    assert.ok(slotIds.has(entry.id), `装备 ${entry.id} 不在主数据的装备表里`)
    for (const rule of entry.rules) {
      for (const bucket of [rule.who, rule.not ?? {}]) {
        for (const id of bucket.forms ?? []) {
          forms++
          assert.ok(shipIds.has(id), `#${entry.id} 行${rule.row} 的形态 ${id} 不在主数据舰表里`)
        }
        for (const id of bucket.classes ?? []) {
          classes++
          assert.ok(ctypeIds.has(id), `#${entry.id} 行${rule.row} 的舰级 ${id} 不是 api_ctype`)
        }
        for (const id of bucket.types ?? []) {
          types++
          assert.ok(stypeIds.has(id), `#${entry.id} 行${rule.row} 的舰种 ${id} 不是 api_stype`)
        }
      }
      for (const slot of rule.need?.with ?? []) {
        for (const id of slot.any ?? []) {
          assert.ok(slotIds.has(id), `#${entry.id} 行${rule.row} 的协同装备 ${id} 不在装备表里`)
        }
        if (slot.group) {
          assert.ok(pack.data.equipGroups[slot.group], `#${entry.id} 引用了未声明的类目 ${slot.group}`)
        }
      }
    }
  }
  assert.ok(forms > 2_000 && classes > 900 && types > 50, `引用规模异常：${forms}/${classes}/${types}`)
})

test('真包：分档单调、精确形态不与自己的排除项打架', { skip: realSkip }, () => {
  for (const entry of Object.values(pack.data.equips)) {
    for (const rule of entry.rules) {
      if (rule.gain.kind === 'byStar') {
        const froms = rule.gain.steps.map((step) => step.from)
        assert.deepEqual(froms, [...froms].sort((a, b) => a - b), `#${entry.id} 行${rule.row} 改修档乱序`)
        for (const step of rule.gain.steps) {
          if (step.to !== null) assert.ok(step.to >= step.from, `#${entry.id} 行${rule.row} 改修区间反了`)
        }
      }
      if (rule.gain.kind === 'byCount') {
        const counts = rule.gain.counts.map((step) => step.count)
        assert.deepEqual(counts, [...counts].sort((a, b) => a - b), `#${entry.id} 行${rule.row} 数量档乱序`)
        assert.equal(new Set(counts).size, counts.length, `#${entry.id} 行${rule.row} 数量档重复`)
      }
      // 适用与排除的形态集合全等 = 这一行谁也命不中，多半是解析写反了
      const who = new Set(rule.who.forms ?? [])
      const not = rule.not?.forms ?? []
      if (who.size && not.length && who.size === not.length) {
        assert.ok(
          not.some((id) => !who.has(id)),
          `#${entry.id} 行${rule.row} 的适用集合被自己的排除集合整个吃掉了`,
        )
      }
    }
  }
})

test('真包：上游那 504 个名字逐个有着落', { skip: realSkip }, () => {
  const moduleCache = path.join(root, 'assets', 'review', 'fit-bonus-source.raw.txt')
  if (!existsSync(moduleCache)) return // 原始快照不入仓，抓取器跑过一次才有
  const table = parseLuaTable(readFileSync(moduleCache, 'utf8'), 'd.equipDataTb')
  const kcwikiShips = Object.values(
    JSON.parse(readFileSync(path.join(root, 'assets', 'lodes', 'kcwiki-ships.json'), 'utf8')).data,
  )
  const live = createFitBonusNameResolver({
    masterShips: masterShips.filter(
      (ship) => Number(ship.api_id) < 1_500 && Number(ship.api_sortno) > 0,
    ),
    masterStypes,
    kcwikiShips,
    fold: foldCjkVariants,
  })
  const names = new Set()
  for (const row of Object.values(table)) {
    for (const [field, value] of Object.entries(row)) {
      if (!/^额外收益\d*$/.test(field)) continue
      for (const name of [...(value['适用舰娘'] ?? []), ...(value['非适用舰娘'] ?? [])]) names.add(name)
    }
  }
  const missing = [...names].filter((name) => !live.resolve(name))
  assert.deepEqual(missing, [], `这些名字映射不了：${missing.join(' / ')}`)
})

test('人工词表只收机器规则落不了地的名字', { skip: realSkip }, () => {
  // 机器规则能解的名字如果也写进词表，就多了一处会悄悄漂移的重复来源。
  const kcwikiShips = Object.values(
    JSON.parse(readFileSync(path.join(root, 'assets', 'lodes', 'kcwiki-ships.json'), 'utf8')).data,
  )
  const live = createFitBonusNameResolver({
    masterShips: masterShips.filter(
      (ship) => Number(ship.api_id) < 1_500 && Number(ship.api_sortno) > 0,
    ),
    masterStypes,
    kcwikiShips,
    fold: foldCjkVariants,
  })
  for (const [name, entry] of Object.entries(FIT_BONUS_NAME_VOCAB)) {
    assert.equal(normalizeFitBonusName(name), name, `词表键「${name}」不是归一化写法`)
    assert.ok(entry.why?.trim(), `词表「${name}」没写依据`)
    assert.equal(live.resolve(name)?.via, 'vocab', `词表「${name}」其实机器规则就能解，该删`)
  }
})
