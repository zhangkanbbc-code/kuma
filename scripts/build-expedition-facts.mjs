#!/usr/bin/env node
// 本地双包校对；维护者包只读。--check 不写文件，--update-fixture 才更新维护者基线。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { parseCompositionBranches } from '../src/shared/expedition-composition.ts'
import { mergeExpeditionFacts } from '../src/shared/expedition-facts.ts'
import { branchMeaning, diffCells, equal, greatMeaning, oldDevelopmentEntry, semanticExpedition } from './lib/expedition-fact-audit.mjs'
import { MAINTAINER_EXPEDITION_CORRECTIONS, auditExpeditionExperience } from './lib/expedition-experience.mjs'
import { openLedgerDb } from './lib/quest-engine.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const kcPath = path.join(ROOT, 'assets/lodes/kcwiki-expedition.json')
const wikiPath = path.join(process.env.APPDATA, 'kuma/lodes/wikiwiki-expedition.json')
const kc = read(kcPath).data, wiki = read(wikiPath).data
const ids = Object.keys(kc)
if (ids.length !== 63 || !equal(ids.slice().sort(), Object.keys(wiki).sort())) throw new Error('双包远征集合漂移，请复核')
const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const hashes = { kcwiki: hash(kcPath), wikiwiki: hash(wikiPath) }
const data = {}, accepted = [], rawDifferences = [], conflicts = [], corrected = [], textExit = []
const add = (id, field, value, basis, provenance = {}) => {
  const keys = field.split('.')
  let patch = data[id] ??= {}
  for (const key of keys.slice(0, -1)) patch = patch[key] ??= {}
  patch[keys.at(-1)] = value
  accepted.push({ id, field, value, basis, ...provenance })
}

// 2026-09-06 裁定：站内字段与说明冲突按说明，跨站机制冲突不取 wikiwiki 覆盖。
for (const [id, fields] of Object.entries({ A4: { 火力: 300 }, A5: { 火力: 280, 对空: 220, 对潜: 240, 索敌: 150 }, A6: { 火力: 330 }, B4: { 火力: 500 }, D2: { 索敌: 70 } })) {
  for (const [stat, value] of Object.entries(fields)) {
    if (wiki[id].stats?.[stat] !== value) throw new Error(`${id} ${stat} 对照值漂移`)
    const fromKcText = new RegExp(`${stat}(?:值)?[≥\\s]*${value}(?!\\d)`).test(kc[id].escortText)
    if (kc[id].stats?.[stat] != null && kc[id].stats[stat] !== value) throw new Error(`${id} ${stat} 出现跨站冲突`)
    const kcTextValue = kc[id].escortText?.match(new RegExp(`${stat}(?:值)?[≥\\s]*(\\d+)`))
    if (kcTextValue && Number(kcTextValue[1]) !== value) throw new Error(`${id} ${stat} 说明出现跨站冲突`)
    add(id, `stats.${stat}`, value, fromKcText ? 'kcwiki 说明与 wikiwiki 数值一致，补 kcwiki 提取缺项' : 'wikiwiki 单站数值事实')
  }
}
for (const [id, value] of [['21', 3], ['44', 6]]) {
  if (wiki[id].drumTotal !== value || !kc[id].escortText.includes(id === '21' ? '至少3个舰娘\n各携带1个桶' : '合计6个以上')) throw new Error(`${id} 桶数依据漂移`)
  add(id, 'drumTotal', value, 'kcwiki 字段值与其说明文字不一致，按说明文字（与 wikiwiki 一致）收')
}

// 原文携带的可行分支转成已有 CompBranch 结构；5/42/A4/44 按维护者裁决登记。
// B5/B6 的非编成属性备注被旧解析器当成未知舰种；移入结构后只保留两站一致的舰种条件。
const branchIds = ['4', '9', '20', '43', 'A3', 'A5', 'A6', 'B5', 'B6']
for (const id of branchIds) {
  const old = oldDevelopmentEntry(kc[id], wiki[id])
  // 顺序只在确认两站机制等价时归一；实际输出与对账都保留原顺序。
  const primary = (text) => branchMeaning(parseCompositionBranches(text.split('\n舰载机')[0]))
    .map((reqs) => reqs.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))))
  if (!equal(primary(kc[id].composition), primary(old.composition))) throw new Error(`${id} 主编成出现跨站冲突`)
  const branches = parseCompositionBranches(old.composition, old.escortText)
  add(id, 'compositionBranches', branches, id === '20' ? '两站舰种数量一致，结构化顺序沿用旧规划器槽位'
    : ['B5', 'B6'].includes(id)
    ? '两站编成条件一致；kcwiki 编成字段夹带属性说明，不把说明当成舰种'
    : '基础编成沿用；附加可行分支为 wikiwiki 单站结构化重述')
}
for (const id of ['40', 'D1', 'D2', 'D3']) {
  const value = greatMeaning(wiki[id].greatNote)
  if (id === '40' && !equal(value, greatMeaning(kc[id].greatNote))) throw new Error('40 大成功条件跨站不一致')
  add(id, 'greatSuccess', value, id === '40' ? '两站一致：4 桶及 4 闪，仅作大成功说明' : 'wikiwiki 单站说明结构化重述；D3 保留待验证标记')
}
// 缺失的每时数值，按单站纯数值规则补；两站已有但不同的每时值不覆盖。
for (const resource of ['ammo', 'steel', 'baux']) {
  const a = kc.D3.rewards[resource], b = wiki.D3.rewards[resource]
  if (a[0] !== b[0] || a[1] !== null || !Number.isInteger(b[1])) throw new Error(`D3 ${resource} 来源漂移`)
  add('D3', `rewards.${resource}`, b, 'wikiwiki 单站每时数值；基础数值两站一致')
}

const compositionCorrections = [
  {
    id: '5', composition: '轻巡*1、驱逐/海防*2、其他*1',
    evidence: '维护者裁决 2026-09-23：kcwiki 2025-06-29 改为驱逐/海防×3；wikiwiki「遠征」与 ElectronicObserver（andanteyk 2019-09-30、ElectronicObserverEN 2025-11-26 仍沿用）均为轻巡1＋（驱逐+海防）2＋其他1，取多数；变体编成取 wikiwiki 原文，ElectronicObserver 同认；en.kancollewiki.net「Expedition」（2021-04 起）同为轻巡或护卫空母1＋（驱逐/海防）2＋其他1，并列海防模式',
  },
  {
    id: '42', composition: '轻巡*1、驱逐*2、其他*1',
    evidence: '维护者裁决 2026-09-23：wikiwiki「遠征」基础驱逐2 并列五种海防模式、明写轻巡1驱逐1海防1 失败，kamigame（2023-01）与 zekamashi（2023-01）亦写驱逐2；kcwiki 要求驱逐至少1只（2021-09-30）放行轻巡1驱逐1海防1、不认零驱逐模式；ElectronicObserver 与 4/5/9 共用判定、未单列 42。取 wikiwiki 原文；en.kancollewiki.net「Expedition」42 行（2022-12 起写 1CVE/CL 1DD 3DD/DE）要求驱逐/海防不少于 3，与轻巡2驱逐2护卫空母1 的成功记录（2026-09-12）不符，不计票',
  },
  {
    id: 'A4', composition: '轻巡*1、驱逐*2、其他*2',
    evidence: '维护者裁决 2026-09-23：kcwiki 要求轻巡或护卫空母旗舰（2021-09-30），wikiwiki 与 ElectronicObserver 均不限旗舰，取多数；基础驱逐2 不计海防（kcwiki、wikiwiki 两票，ElectronicObserver 计海防）；变体编成取 wikiwiki 原文；en.kancollewiki.net「Expedition」（2021-04 起）同样不限旗舰、并列海防模式',
  },
].map(({ id, composition, evidence }) => {
  if (wiki[id].composition !== composition
    || (id === '42' && !kc[id].composition.includes('驱逐至少1只'))
    || !wiki[id].rawComposition.includes('の編成でも成功')) throw new Error(`${id} 编成裁决依据漂移`)
  return { id, field: 'compositionBranches', value: parseCompositionBranches(wiki[id].composition, wiki[id].rawComposition),
    basis: 'maintainer', evidence, date: '2026-09-23' }
})
if (!wiki['44'].composition.includes('空母(水母,护卫空母可)')
  || !wiki['44'].rawComposition.includes('水母×2')) throw new Error('44 编成裁决依据漂移')
compositionCorrections.push({
  id: '44', field: 'compositionBranches',
  // 坑位按整队计数，舰种重叠会让同一艘水母被数两次，因此按 ElectronicObserver 的或条件拆成两支。
  // 显式列出轻空母/空母，避免括号替代条件被丢弃；普通轻空母也收，解析得到 [7, 11, 18] 且 cve=false。
  value: parseCompositionBranches('水母*2、轻巡*1、驱逐/海防*2、其他*1 或轻空母/空母*1、水母*1、轻巡*1、驱逐/海防*2、其他*1')
    .map((branch, index) => ({ ...branch, label: ['水母2', '空母系＋水母'][index] })),
  basis: 'maintainer', date: '2026-09-25',
  evidence: '维护者裁决 2026-09-25：wikiwiki「遠征」44 写空母(水母,護母可)1隻、水母1隻、軽1隻、(駆+海防)2隻、他1隻必要(要検証)，另列水母×2,軽×1,駆×3；kcwiki 同文，空母数量写作 *1-2 并标待验证；ElectronicObserver（andanteyk 原版与 ElectronicObserverEN 分支现行代码相同）要求水母≥2 或水母≥1 且空母系(水母除く)≥1，另需轻巡≥1、（驱逐+海防）≥2、6 艘。三方一致：空母一格收正规空母、装甲空母、轻空母（含护卫空母）或第二艘水母，另需水母1、轻巡1、驱逐/海防2、其他1',
})
const corrections = [...MAINTAINER_EXPEDITION_CORRECTIONS, ...compositionCorrections]
for (const { id, field, value, basis, ...provenance } of corrections) {
  add(id, field, value, basis, provenance)
}

const oldSemantics = {}, baseSemantics = {}
const retired = new Set(['nameJp', 'nameZh', 'escortText', 'rawComposition', 'descriptionJp', 'greatNote', 'difficulty', 'useFuelText', 'useBullText', 'time', 'tags'])
for (const id of ids) {
  for (const cell of diffCells(kc[id], wiki[id])) {
    const category = cell.kcwiki === null ? 'wikiwiki 有 kcwiki 无' : cell.wikiwiki === null ? 'kcwiki 有 wikiwiki 无' : '两者值不同'
    const row = { id, ...cell, category }
    rawDifferences.push(row)
    if (retired.has(cell.field)) textExit.push(row)
  }
  baseSemantics[id] = semanticExpedition(kc[id])
  oldSemantics[id] = semanticExpedition(oldDevelopmentEntry(kc[id], wiki[id]))
  const merged = semanticExpedition(mergeExpeditionFacts(kc[id], data[id]))
  for (const cell of diffCells(merged, oldSemantics[id])) {
    const row = { id, ...cell }
    if (['24', '40'].includes(id) && cell.field === 'drumTotal') {
      corrected.push({ ...row, reason: '2026-09-06 裁定：大成功桶数被误提取为普通门槛，不恢复' })
    } else {
      const correction = corrections.find(r => r.id === id && r.field === cell.field)
      conflicts.push({ ...row, reason: correction ? `已裁：${correction.evidence}` : id === '24' && cell.field.startsWith('greatSuccess')
        ? '4 个以上／2 个以上混杂；大成功条件整个不收，底层原说明保留'
        : cell.field === 'compositionBranches' ? '两站编成机制不同，不覆盖 kcwiki'
          : cell.field.startsWith('rewards.') ? '两站奖励数值或普通／大成功分组不同，不覆盖 kcwiki'
            : '两站机制不同，不覆盖 kcwiki' })
    }
  }
}
const counts = Object.fromEntries(['wikiwiki 有 kcwiki 无', '两者值不同', 'kcwiki 有 wikiwiki 无'].map((key) => [key, rawDifferences.filter((row) => row.category === key).length]))
const pack = { meta: {
  id: 'expedition-facts', name: '远征条件（第一方登记）', version: '2026.09.23.1',
  source: 'kuma 第一方登记表', license: '第一方产物', fetchedAt: '2026-09-06T00:00:00.000Z',
  note: '远征的舰队条件与大成功条件',
  maintainerNote: [
    '由 scripts/build-expedition-facts.mjs 读取对照资料 kcwiki 与 wikiwiki 包校对；wikiwiki 仅维护者侧使用，不随包、不进入运行时',
    '21/44：kcwiki 字段值与其说明文字不一致，按说明文字（与 wikiwiki 一致）收',
    '同一站内字段与说明冲突按说明定，单列汇报；跨站机制冲突仅经维护者带出处订正才覆盖 kcwiki，见 docs/expedition-facts-report.md',
    '24/40 不收普通成功桶门槛；40 的桶数只在 greatSuccess；24 大成功说明歧义不收',
    ...accepted.map(({ id, field, basis, evidence, date }) => `${id}.${field}：${basis}${evidence ? `；${evidence}；${date}${field === 'rewards.shipExp' ? '；待游戏结算报文核对（维护者核 2026-09-06）' : ''}` : ''}`),
  ],
  corrections,
}, data }
const sourceConflicts = [{ id: '44', field: 'composition', kcwiki: kc['44'].composition, wikiwiki: wiki['44'].composition,
  reason: '1-2 与 1 不同且含待验证标记；维护者裁决 2026-09-25 已按三方一致登记 compositionBranches，空母一格认空母系或第二艘水母，原文差异留底' }]
const fixture = { sourceHashes: hashes, ids, baseSemantics, oldSemantics, conflicts, corrected }
const pendingConflicts = conflicts.filter(({ id, field }) => !corrections.some(r => r.id === id && r.field === field))
const table = (rows) => ['| 远征 | 字段 | kcwiki／新值 | wikiwiki／旧值 | 分类或说明 |', '|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.id} | ${r.field} | ${JSON.stringify(r.kcwiki).replaceAll('|', '\\|')} | ${JSON.stringify(r.wikiwiki).replaceAll('|', '\\|')} | ${r.category ?? r.reason ?? ''} |`)].join('\n')
const report = `# 远征第一方事实层对照（2026-09-25）

基线 beea4bb。63 项逐一对照；对象递归到叶字段，数组为一格，null 与无字段同为缺项。
原始差异 ${rawDifferences.length} 格：${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join('；')}。
数组顺序、标点和未消费的 min 等差异仍在原始表保留；运行时对账只比较结构化消费语义。
输入 SHA-256：kcwiki ${hashes.kcwiki}；wikiwiki ${hashes.wikiwiki}。

## 收录清单

${accepted.length} 个字段登记，${Object.keys(data).length} 项远征。增补 kcwiki 缺失或提取不同的格；维护者带出处订正覆盖指定字段。
${accepted.map((r) => `- ${r.id}.${r.field} = ${JSON.stringify(r.value)}；${r.basis}${r.evidence ? `；${r.evidence}；${r.date}` : ''}`).join('\n')}

## 两站冲突清单

${pendingConflicts.length} 格未收。下表为运行时消费语义的逐格值；空数组与分组有意义，奖励原始文本在全差异表。
44 编成已按维护者裁决登记；未裁的奖励时薪、奖励分组、舰经验和交战档位冲突仍留底层。
${table(corrections.filter(r => r.field === 'rewards.shipExp').map(r => ({ id: r.id, field: r.field, kcwiki: kc[r.id].rewards.shipExp, wikiwiki: wiki[r.id].rewards.shipExp,
  reason: `已裁（第三票）·待实测；运行时 ${r.value}；${r.date}；${r.evidence}` })))}

${table(pendingConflicts)}

来源本身另有 ${sourceConflicts.length} 格编成原文差异，裁决与留底说明如下：
${table(sourceConflicts)}

## 维护者编成订正

5/42/A4 按维护者裁决逐格登记；主编成与 wikiwiki 原文变体一并转成 compositionBranches。
42 基础编成为轻巡1、驱逐2、其他1，另认五种海防模式；轻巡1驱逐1海防1 判失败，与 wikiwiki 原文消费语义一致。
44 按 ElectronicObserver 的或条件登记两个分支：「水母2」为水母2、轻巡1、驱逐/海防2、其他1；「空母系＋水母」为空母系1、水母1、轻巡1、驱逐/海防2、其他1。每支共6艘，坑位舰种互不重叠；普通轻空母与护卫空母均可，桶数、属性与等级条件不变。

| 远征 | 字段 | 依据 |
|---|---|---|
${compositionCorrections.map(({ id, field, evidence }) => `| ${id} | ${field} | ${evidence} |`).join('\n')}

## 提取纠错与续单裁定

21/44 字段 1/2 与 kcwiki 说明 3/6 打架，按说明收 3/6，与 wikiwiki 一致。
${table(corrected)}
24 的大成功事实不收；kcwiki 原有中文说明仍在底层，不视为新增认定。
B5/B6 只去除编成字段中的属性散文所产生的伪舰种；属性判定与机制注释保留。
33/34/D3 的零资源 [0,null] 与 null 消费相同，归格式差异；底层不改。

## 文字退出清单

${textExit.length} 格；这些日文原文、名称、格式和未消费的来源元数据退出 wikiwiki 运行时合并。
composition 的文字差异在全表；分支语义单独对账，不能凭「文字」名义跳过。greatNote 的条件也另投影为 greatSuccess。
stats 键顺序不影响消费；道具名称按玩家本地化归一、min 未被消费，不计机制冲突。
${table(textExit)}

## 63 项字段差异三分类全表

${table(rawDifferences)}

## 运行时与护栏

bi 只查询 kcwiki-expedition 与 expedition-facts，中文名固定 kcwiki；属性与奖励按子字段覆盖。
编成检查与推荐均使用 compositionBranches；原文不再承担已登记分支的解析。
大成功条件转换为既有中文句式，再走原有大成功行（wait，不计 fails）。
夹具保存旧开发机合并的结构化语义与独立例外表，测试直接逐格对照运行时合并；无需 wikiwiki 包。
生成器 --check 校对事实包与维护者基线；--update-fixture 是显式更新对账基线，普通生成不改夹具。
生成与 --check 均通过既有 openLedgerDb 只读游戏报文 events，按 api_quest_name 对应远征 id。
仅取 api_clear_result=1 的 api_get_ship_exp.slice(1) 最小值；旗舰 ×1.5 向下取整与大成功 ×2 均排除，不反推基础经验。
控制台逐项报告全部已跑远征的结算数、普通成功样本数、实测值、当前值和 wikiwiki 值；无普通成功样本明确记为 null。
游戏报文差异只报、不自动写事实包或夹具；后续确认后仍走维护者订正，evidence 写「游戏结算报文核对（维护者核 2026-09-06） 日期」。D1 当前待游戏结算报文核对（维护者核 2026-09-06）。

## 玩家文案逐字登记

条件检查的行模板原样保留。D1/D2 新补出的说明为「大成功：大成功要5闪或旗舰128级以上+4闪」。
D3 为「大成功：大成功要5闪或旗舰128级以上+4闪（待验证）」。两者沿用 kcwiki 其它远征已有中文句式。
40 为「大成功：大成功要4桶以上+4闪」，原有中文不变。
新增包名「远征条件（第一方登记）」；来源「kuma 第一方登记表」；悬停说明「远征的舰队条件与大成功条件」。
维护者健康度影响文案「远征卷缺少部分舰队属性门槛、运输桶总量、可行编成与大成功条件」。
使用说明仅从不随包限制中去除已经退役的远征日文对照，未新增措辞。

## 任务书修正

原单要求 24/40 总量普通检查回来有误，以续单裁定为准。日文文字退出不算对账失败。
示例 fleet/transport 与实际 bi 字段不一致，实际使用 stats/drumTotal。
63 项并非只有所点名的门槛差异；奖励与编成等冲突不能照抄 wikiwiki。
`

const check = process.argv.includes('--check')
const outputs = [
  [path.join(ROOT, 'assets/lodes/expedition-facts.json'), `${JSON.stringify(pack, null, 2)}\n`],
  [path.join(ROOT, 'docs/expedition-facts-report.md'), report],
]
const fixturePath = path.join(ROOT, 'test/fixtures/expedition-facts.json')
if (process.argv.includes('--update-fixture') || check) outputs.push([fixturePath, `${JSON.stringify(fixture, null, 2)}\n`])
for (const [file, contents] of outputs) {
  if (check) {
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== contents) throw new Error(`校对不一致：${file}`)
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, contents, 'utf8')
  }
}
console.log(JSON.stringify({ expeditions: ids.length, rawDifferences: rawDifferences.length, counts, accepted: accepted.length, conflicts: conflicts.length, corrected: corrected.length, textExit: textExit.length, check }))
const db = openLedgerDb()
if (!db) throw new Error('账本不存在，无法完成舰娘经验实测校对')
try {
  const events = db.prepare('SELECT ts, path, body FROM events WHERE path = ? ORDER BY ts, id').iterate('/kcsapi/api_req_mission/result')
  const current = Object.fromEntries(ids.map(id => [id, mergeExpeditionFacts(kc[id], data[id])]))
  console.log(JSON.stringify({ ledgerExperience: auditExpeditionExperience(events, current, wiki) }))
} finally {
  db.close()
}
