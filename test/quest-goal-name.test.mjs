// 任务详情四类标签统一中文化。
//
// A 组只用手搭的最小主数据与译名表，永远运行；B 组拿三个规则源的真实产物，
// 逐条过线上同一份 shared 出口。残留判据来自主数据 + kcwiki-localization，
// 不拿被测实现自己的表给自己判卷。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import nodeTest from 'node:test'

import questGoalName from '../dist/shared/quest-goal-name.js'
import shipTypeName from '../dist/shared/ship-type-name.js'
import kcwiki from '../dist/main/mg/kcwiki-quest-rules.js'
import kuma from '../dist/main/mg/kuma-quest-rules.js'
import fleetRules from '../dist/main/mg/quest-fleet-rules.js'

const { buildQuestGoalNameIndex, localizeQuestGoalLabels } = questGoalName
const { shipTypeLabelTokens } = shipTypeName
const { buildKcwikiRuleContext, decodeKcwikiRequirement, augmentShipGroupsFromQuestText } = kcwiki
const { buildKumaQuestRules } = kuma
const { buildFleetRuleContext, deriveFleetRule } = fleetRules

const minimalSources = () => ({
  masterRaw: {
    api_mst_ship: [
      { api_id: 83, api_name: '赤城' },
      { api_id: 110, api_name: '翔鶴' },
    ],
    api_mst_slotitem: [
      { api_id: 109, api_name: '零戦52型丙(六〇一空)' },
      { api_id: 145, api_name: '戦闘糧食' },
      { api_id: 242, api_name: 'Swordfish' },
      { api_id: 999, api_name: '空译名装备' },
    ],
    api_mst_useitem: [{ api_id: 66, api_name: '戦闘糧食' }],
    api_mst_slotitem_equiptype: [
      { api_id: 1, api_name: '小口径主砲' },
      { api_id: 2, api_name: '中口径主砲' },
    ],
  },
  localizationData: {
    entities: {
      ship: {
        83: { ja: '赤城', zh: '赤城' },
        110: { ja: '翔鶴', zh: '翔鹤' },
      },
      equip: {
        109: { ja: '零戦52型丙(六〇一空)', zh: '零式舰战52型丙（六〇一空）' },
        145: { ja: '戦闘糧食', zh: '战斗粮食' },
        242: { ja: 'Swordfish', zh: '剑鱼（Swordfish）' },
        999: { ja: '空译名装备', zh: '' },
      },
      item: {
        66: { ja: '戦闘糧食', zh: '战斗粮食' },
      },
      equipType: {
        1: { ja: '小口径主砲', zh: '小口径主炮' },
        2: { ja: '中口径主砲', zh: '中口径主炮' },
      },
    },
  },
})

nodeTest('出口:秘书舰与编成检查逐词中文化,分隔符和空白原样', () => {
  const holder = {
    fleetGoal: {
      groups: [{ label: '軽巡', ships: 'any', stypes: [3], amount: 1 }],
      anyOf: [{
        groups: [{ label: '翔鶴', ships: [110], stypes: [], amount: 1 }],
      }],
    },
    tasks: [{
      fleetGoal: {
        groups: [{ label: '赤城 / 翔鶴', ships: [83, 110], stypes: [], amount: 1 }],
      },
    }],
    stateGoal: {
      secretary: { label: '赤城 / 翔鶴', ships: [83, 110], stypes: [] },
    },
  }
  localizeQuestGoalLabels(holder, buildQuestGoalNameIndex(minimalSources()))
  assert.equal(holder.fleetGoal.groups[0].label, '轻巡')
  assert.equal(holder.fleetGoal.anyOf[0].groups[0].label, '翔鹤')
  assert.equal(holder.tasks[0].fleetGoal.groups[0].label, '赤城 / 翔鹤')
  assert.equal(holder.stateGoal.secretary.label, '赤城 / 翔鹤')
})

nodeTest('出口:按 id 回查只接管认得出的整名', () => {
  const holder = {
    stateGoal: {
      equipment: [
        { label: '零戦52型丙(六〇一空)', mstIds: [109] },
        { label: '战斗粮食', mstIds: [145] },
        { label: 'Swordfish（★max·第1格）', mstIds: [242] },
        { label: '译名表没有这个 id', mstIds: [404] },
        { label: '空译名装备', mstIds: [999] },
      ],
    },
    stockGoals: [
      { kind: 'useitem', id: 66, label: '戦闘糧食', count: 1 },
      { kind: 'equip', id: 109, label: '零戦52型丙(六〇一空)', count: 1 },
      { kind: 'equipCategory', ids: [1], label: '小口径主砲', count: 1 },
    ],
  }
  localizeQuestGoalLabels(holder, buildQuestGoalNameIndex(minimalSources()))
  assert.deepEqual(
    holder.stateGoal.equipment.map((goal) => goal.label),
    [
      '零式舰战52型丙（六〇一空）',
      '战斗粮食',
      'Swordfish（★max·第1格）',
      '译名表没有这个 id',
      '空译名装备',
    ],
  )
  assert.deepEqual(
    holder.stockGoals.map((goal) => goal.label),
    ['战斗粮食', '零式舰战52型丙（六〇一空）', '小口径主炮'],
  )
})

nodeTest('出口:同一个 holder 连过两遍逐字节相同', () => {
  const holder = {
    fleetGoal: {
      groups: [{ label: '軽巡 / 翔鶴', ships: [110], stypes: [3], amount: 2 }],
    },
    stateGoal: {
      secretary: { label: '赤城 / 翔鶴', ships: [83, 110], stypes: [] },
      equipment: [{ label: '零戦52型丙(六〇一空)', mstIds: [109] }],
    },
    stockGoals: [{ kind: 'useitem', id: 66, label: '戦闘糧食', count: 1 }],
  }
  const index = buildQuestGoalNameIndex(minimalSources())
  localizeQuestGoalLabels(holder, index)
  const first = JSON.stringify(holder)
  localizeQuestGoalLabels(holder, index)
  assert.equal(JSON.stringify(holder), first)
})

nodeTest('出口:material 与多 id 装备类别原样放行,不吞字', () => {
  const holder = {
    stockGoals: [
      { kind: 'material', id: 1, label: '弹药', count: 1500 },
      { kind: 'equipCategory', ids: [1, 2], label: '小口径主砲 / 中口径主砲', count: 2 },
    ],
  }
  const before = JSON.stringify(holder)
  localizeQuestGoalLabels(holder, buildQuestGoalNameIndex(minimalSources()))
  assert.equal(JSON.stringify(holder), before)
})

const s2Url = new URL('../../s2.json', import.meta.url)
const reqUrl = new URL('../assets/lodes/kcwiki-quest-req.json', import.meta.url)
const scnUrl = new URL('../assets/lodes/quests-scn.json', import.meta.url)
const l10nUrl = new URL('../assets/lodes/kcwiki-localization.json', import.meta.url)
const fcdUrl = new URL('../assets/lodes/poi-fcd-map.json', import.meta.url)
const fixtures = [s2Url, reqUrl, scnUrl, l10nUrl, fcdUrl]
const missingFixture = fixtures.find((url) => !fs.existsSync(url))
const test = (name, fn) =>
  nodeTest(name, { skip: missingFixture ? `缺对账资料：${missingFixture.pathname}` : false }, fn)

const readJson = (url) => JSON.parse(fs.readFileSync(url, 'utf8'))
const clean = (value) => `${value ?? ''}`.trim()
const comparable = (value) =>
  clean(value)
    .normalize('NFKC')
    .replace(/[（）]/g, (char) => (char === '（' ? '(' : ')'))
    .replace(/\s+/g, '')
    .toLowerCase()

const holderLabels = (holder, where) => {
  const labels = []
  const takeFleet = (goal) => {
    for (const group of goal?.groups ?? []) {
      labels.push({ where, section: '编成检查', label: group.label })
    }
  }
  takeFleet(holder.fleetGoal)
  for (const task of holder.tasks ?? []) takeFleet(task.fleetGoal)
  if (holder.stateGoal?.secretary) {
    labels.push({ where, section: '秘书舰', label: holder.stateGoal.secretary.label })
  }
  for (const goal of holder.stateGoal?.equipment ?? []) {
    labels.push({ where, section: '目标装备', label: goal.label })
  }
  for (const goal of holder.stockGoals ?? []) {
    labels.push({ where, section: '持有条件', label: goal.label })
  }
  return labels
}

let cached = null
const realLabels = () => {
  if (cached) return cached
  const s2 = readJson(s2Url)
  const masterRaw = s2.api_data ?? s2
  const scn = readJson(scnUrl).data ?? {}
  const localizationData = readJson(l10nUrl).data
  const fcd = readJson(fcdUrl).data
  const context = buildKcwikiRuleContext(masterRaw)
  const index = buildQuestGoalNameIndex({ masterRaw, localizationData })
  const zhShipNames = new Map(
    Object.entries(localizationData?.entities?.ship ?? {})
      .map(([id, entry]) => [Number(id), `${entry?.zh ?? ''}`])
      .filter(([id, zh]) => id > 0 && !!zh),
  )
  const out = []
  const take = (holder, where) => {
    const localized = structuredClone(holder)
    const before = holderLabels(localized, where)
    localizeQuestGoalLabels(localized, index)
    const after = holderLabels(localized, where)
    assert.equal(after.length, before.length, `${where} 中文化前后标签数变了`)
    for (const [position, item] of after.entries()) {
      assert.equal(item.section, before[position].section, `${where} 中文化前后标签次序变了`)
      out.push({ ...item, before: before[position].label })
    }
  }

  for (const [idText, requirement] of Object.entries(readJson(reqUrl).data ?? {})) {
    const questId = parseInt(idText, 10)
    if (!questId) continue
    const decoded = decodeKcwikiRequirement(requirement, context)
    if (!decoded) continue
    const quest = scn[questId]
    augmentShipGroupsFromQuestText(
      decoded,
      context,
      quest ? `${quest.desc ?? ''}｜${quest.memo2 ?? ''}` : '',
      zhShipNames,
    )
    take(decoded, `kcwiki/${quest?.code ?? questId}`)
  }

  for (const rule of buildKumaQuestRules(context, masterRaw, fcd)) {
    take(rule, `自研手写/${scn[rule.questId]?.code ?? rule.questId}`)
  }

  const fleetContext = buildFleetRuleContext(masterRaw, localizationData)
  for (const [idText, raw] of Object.entries(scn)) {
    const questId = parseInt(idText, 10)
    if (!questId) continue
    const code = `${raw?.code ?? ''}`
    const derived = deriveFleetRule(
      questId,
      code,
      `${raw?.desc ?? ''}`,
      `${raw?.memo2 ?? ''}`,
      fleetContext,
    )
    if (derived) take(derived, `自研推导/${code || questId}`)
  }

  assert.ok(out.length > 900, `只扫到 ${out.length} 条任务详情标签,收集器多半坏了`)
  cached = { masterRaw, localizationData, labels: out }
  return cached
}

const japaneseSourceNames = (masterRaw, localizationData) => {
  const domains = {
    ship: 'api_mst_ship',
    shipType: 'api_mst_stype',
    equip: 'api_mst_slotitem',
    item: 'api_mst_useitem',
    equipType: 'api_mst_slotitem_equiptype',
  }
  const names = new Set()
  for (const [domain, masterKey] of Object.entries(domains)) {
    const masterById = new Map(
      (masterRaw?.[masterKey] ?? []).map((entry) => [Number(entry?.api_id), entry?.api_name]),
    )
    for (const [idText, entry] of Object.entries(localizationData?.entities?.[domain] ?? {})) {
      const zh = clean(entry?.zh)
      if (!zh) continue
      for (const source of [masterById.get(Number(idText)), entry?.ja]) {
        const key = comparable(source)
        if (key && key !== comparable(zh)) names.add(key)
      }
    }
  }
  return names
}

test('护栏:三个规则源四类真标签过出口后只放行宗谷歧义项', () => {
  const { masterRaw, localizationData, labels } = realLabels()
  const sourceNames = japaneseSourceNames(masterRaw, localizationData)
  const kana = /[ぁ-ゖァ-ヺー]/u
  const residue = new Set()
  for (const { where, section, label } of labels) {
    const words = section === '编成检查' || section === '秘书舰'
      ? shipTypeLabelTokens(label)
      : [label]
    for (const word of words) {
      if (sourceNames.has(comparable(word)) || kana.test(word)) {
        residue.add(`${where} [${section}]「${word}」`)
      }
    }
  }
  assert.deepEqual(
    [...residue].sort(),
    ['自研推导/2605B2 [编成检查]「宗谷」'],
    '除 ship-proper-name 文件头钉明的「宗谷」歧义外，又有日文标签越过唯一出口',
  )
})
