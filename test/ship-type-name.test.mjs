import assert from 'node:assert/strict'
import fs from 'node:fs'
import nodeTest from 'node:test'

import shipTypeName from '../dist/shared/ship-type-name.js'
import kcwiki from '../dist/main/mg/kcwiki-quest-rules.js'
import kanso from '../dist/main/mg/kanso-quest-rules.js'
import fleetRules from '../dist/main/mg/quest-fleet-rules.js'

const {
  SHIP_TYPE_JA_ZH,
  localizeShipTypeWords,
  shipTypeLabelTokens,
  unmappedShipTypeTokens,
} = shipTypeName
const {
  FRIENDLY_STYPE_TOKENS,
  buildKcwikiRuleContext,
  decodeKcwikiRequirement,
  augmentShipGroupsFromQuestText,
  resolveFriendlyShipToken,
} = kcwiki
const { buildKansoQuestRules } = kanso
const { STYPE_ALIASES, buildFleetRuleContext, deriveFleetRule } = fleetRules

// ---------------------------------------------------------------- 出口本身
//
// 2026-09-01 之前编成门那一列是两条腿两种话：kcwiki 那一半照抄上游日文舰种词
//（「駆逐 ×3」），艦素自研那一半出中文（「驱逐舰 ×3」）。用户拍板统一中文后
// 并成 localizeShipTypeWords 一个出口，收在 quest-counter 装配完追踪器那一点上。

nodeTest('舰种词出口:整词换,分隔符与前后空白一个字节都不碰', () => {
  assert.equal(localizeShipTypeWords('駆逐'), '驱逐')
  assert.equal(localizeShipTypeWords('海防艦'), '海防舰')
  // kcwiki 写 ' / '、自研侧写 '/'，中文化不许顺手把谁的排版改成另一个人的
  assert.equal(localizeShipTypeWords('軽巡 / 駆逐'), '轻巡 / 驱逐')
  assert.equal(localizeShipTypeWords('軽巡/駆逐'), '轻巡/驱逐')
  // 「艦」是 kcwiki 的任意舰占位，照抄一个字上屏玩家读不出它是占位还是舰名
  assert.equal(localizeShipTypeWords('艦'), '任意舰')
  assert.equal(localizeShipTypeWords('他の艦'), '其它舰')
  assert.equal(localizeShipTypeWords(''), '')
})

nodeTest('舰种词出口:表里没有的词原样放行,不硬翻也不吞字', () => {
  // 舰名/舰级/队名都是专有名词——最坏退回混排，绝不改字
  for (const raw of [
    '長門改二',
    '暁',
    'Saratoga Mk.II',
    '伊勢改 / 日向改',
    '陽炎级',
    '第八驱逐队',
    '全队规模 ≤5',
    'Saratoga "Mk.II"',
    // 自研侧的标签会把斜杠包在括号里，切开再拼回必须一字不差
    '另一艘（黑潮改二 / 亲潮改二）',
    '最上改二(或改二特)',
  ]) {
    assert.equal(localizeShipTypeWords(raw), raw, `「${raw}」被改动了`)
  }
  // 混合串：认得的换、认不得的留，词数一个不少
  assert.equal(localizeShipTypeWords('駆逐 / 時雨 / 軽巡'), '驱逐 / 時雨 / 轻巡')
})

nodeTest('舰种词出口:幂等——重建多少次追踪器结果都一样', () => {
  const values = new Set(Object.values(SHIP_TYPE_JA_ZH))
  for (const [ja, zh] of Object.entries(SHIP_TYPE_JA_ZH)) {
    assert.equal(localizeShipTypeWords(zh), zh, `「${ja}」→「${zh}」再跑一遍又变了`)
  }
  assert.ok(values.size > 0)
})

// ---------------------------------------------------------------- 词表的判据不取自词表自己
//
// 「覆盖全了吗」若拿我自己抄的清单当判据，抄漏一个就永远发现不了。
// 判据一律取**规则源自己的词典**：kcwiki 解码器的 FRIENDLY_STYPE_TOKENS 是日文那一半的
// 全集，自研侧的 STYPE_ALIASES 是中文那一半的全集。上游给解码器加一个新舰种词，这里当场红。

nodeTest('词表覆盖:kcwiki 解码器认得的每个舰种词都有规范中文写法', () => {
  const missing = Object.keys(FRIENDLY_STYPE_TOKENS).filter((token) => !(token in SHIP_TYPE_JA_ZH))
  assert.deepEqual(missing, [], '这些日文舰种词会一路日文上屏，去 shared/ship-type-name 补格')
  // 舰种以外的四个选择器词同样由 resolveFriendlyShipToken 认，同样会进 label
  for (const token of ['艦', '他の艦', '高速艦', '低速戦艦']) {
    assert.ok(
      resolveFriendlyShipToken({ shipIdsByName: new Map(), expandShipForms: () => [] }, token),
      `「${token}」不再是解码器认得的选择器词了,这条守卫的锚点要跟着改`,
    )
    assert.ok(token in SHIP_TYPE_JA_ZH, `选择器词「${token}」没有规范中文写法`)
  }
})

nodeTest('词表不新立文案源:译出来的舰种词是自研侧已有的说法,且语义不比原词窄', () => {
  for (const [ja, zh] of Object.entries(SHIP_TYPE_JA_ZH)) {
    const jaTypes = FRIENDLY_STYPE_TOKENS[ja]
    if (!jaTypes) continue // 艦/他の艦/高速艦/低速戦艦 不是舰种词，出处逐条写在词表注释里
    const zhTypes = STYPE_ALIASES[zh]
    assert.ok(zhTypes, `「${ja}」译成了自研侧词典里没有的「${zh}」——那就是新立了一份文案`)
    // 窄了就是在替玩家把合规编成拦掉的方向上改写门的说法
    const narrowed = jaTypes.filter((stype) => !zhTypes.includes(stype))
    assert.deepEqual(narrowed, [], `「${ja}」→「${zh}」把舰种 ${narrowed} 说没了`)
  }
})

// ---------------------------------------------------------------- 护栏：真规则包零漏网
//
// 判据不是「源码里有没有那张表」，是**拿两个规则源的真实产物逐词过一遍**。
// 覆盖面故意取超集（连被上游顶掉的自研推导也跑）：宁可多守几条，也别让某条
// 今天不上线、明天上线的规则悄悄把日文词带上屏。

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

/** 两个规则源实际产出的全部编成门标签（原文，未中文化）。 */
const realLabels = () => {
  const s2 = readJson(s2Url)
  const masterRaw = s2.api_data ?? s2
  const scn = readJson(scnUrl).data ?? {}
  const localization = readJson(l10nUrl).data
  const fcd = readJson(fcdUrl).data
  const context = buildKcwikiRuleContext(masterRaw)
  const zhShipNames = new Map(
    Object.entries(localization?.entities?.ship ?? {})
      .map(([id, entry]) => [Number(id), `${entry?.zh ?? ''}`])
      .filter(([id, zh]) => id > 0 && !!zh),
  )
  const out = []
  const take = (goal, where) => {
    for (const group of goal?.groups ?? []) out.push({ label: group.label, where })
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
    take(decoded.fleetGoal, `kcwiki/${quest?.code ?? questId}`)
    for (const task of decoded.tasks ?? []) take(task.fleetGoal, `kcwiki/${quest?.code ?? questId}`)
  }

  for (const rule of buildKansoQuestRules(context, masterRaw, fcd)) {
    const where = `艦素手写/${scn[rule.questId]?.code ?? rule.questId}`
    take(rule.fleetGoal, where)
    for (const task of rule.tasks ?? []) take(task.fleetGoal, where)
  }

  const fleetContext = buildFleetRuleContext(masterRaw, localization)
  for (const [idText, raw] of Object.entries(scn)) {
    const questId = parseInt(idText, 10)
    if (!questId) continue
    const code = `${raw?.code ?? ''}`
    const derived = deriveFleetRule(questId, code, `${raw?.desc ?? ''}`, `${raw?.memo2 ?? ''}`, fleetContext)
    take(derived?.fleetGoal, `艦素推导/${code || questId}`)
  }

  assert.ok(out.length > 500, `只扫到 ${out.length} 条编成门,收集器多半坏了`)
  return out
}

test('护栏:两个规则源的真标签过一遍出口后,已知舰种词零日文残留', () => {
  const residue = new Map()
  const unknown = new Map()
  for (const { label, where } of realLabels()) {
    for (const token of shipTypeLabelTokens(localizeShipTypeWords(label))) {
      const zh = SHIP_TYPE_JA_ZH[token]
      if (zh !== undefined) {
        // 「重巡」「航巡」「水母」「空母」「装甲空母」「潜水空母」两种语言写法相同，
        // 出口跑完还是它自己 —— 那是**已经核过的规范写法**，不是没译干净
        if (zh !== token && !residue.has(token)) residue.set(token, where)
        continue
      }
      // 词表没有、而**解码器自己**认它是舰种/占位而不是舰名 → 上游冒出了新写法。
      // 判据取解码器的词典，不是我抄的清单：抄漏一个，这一条才发现得了。
      const selector = resolveFriendlyShipToken(
        { shipIdsByName: new Map(), expandShipForms: () => [] },
        token,
      )
      if (selector && !unknown.has(token)) unknown.set(token, where)
    }
  }
  assert.deepEqual(
    [...residue].map(([token, where]) => `${token}（${where}）`),
    [],
    '这些舰种词还在日文上屏——出口漏了它们',
  )
  assert.deepEqual(
    [...unknown].map(([token, where]) => `${token}（${where}）`),
    [],
    '上游冒出了规范表没有的舰种写法,去 shared/ship-type-name 补格',
  )
})

test('护栏:未知词原样放行——出口前后词数一致,每个词要么没动要么正是表里的值', () => {
  for (const { label, where } of realLabels()) {
    const before = shipTypeLabelTokens(label)
    const after = shipTypeLabelTokens(localizeShipTypeWords(label))
    assert.equal(after.length, before.length, `「${label}」（${where}）被吞掉了词`)
    for (const [index, token] of before.entries()) {
      const expected = SHIP_TYPE_JA_ZH[token] ?? token
      assert.equal(after[index], expected, `「${label}」（${where}）的第 ${index + 1} 个词被改坏了`)
    }
    // 表里一个词都没命中时，整条标签必须逐字节相同（分隔符/括号/空白全不许动）
    if (before.every((token) => !(token in SHIP_TYPE_JA_ZH))) {
      assert.equal(localizeShipTypeWords(label), label, `「${label}」（${where}）没命中却被改了`)
    }
  }
})

test('护栏:放行下来的词只剩专有名词——舰名/舰级/队名,没有落网的舰种词', () => {
  // 这一条不断言「列表为空」（放行本来就是常态），只把清单钉在这里当账：
  // 它日后变长时，改动者要能一眼看出多出来的是不是又一个该译没译的舰种词。
  const kept = new Set()
  for (const { label } of realLabels()) {
    for (const token of unmappedShipTypeTokens(localizeShipTypeWords(label))) kept.add(token)
  }
  assert.ok(kept.size > 0, '一个放行词都没有,收集器多半坏了')
  for (const token of kept) {
    assert.ok(
      !(token in FRIENDLY_STYPE_TOKENS),
      `「${token}」是 kcwiki 词典里的舰种词,不该出现在放行清单里`,
    )
  }
})
