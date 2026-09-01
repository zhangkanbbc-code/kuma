// 编成门标签里的国籍词组统一写法。
//
// 判据一律**不取自被验证的那张表自己**：
//   · 「哪些标签算国籍组」由**产地**说了算——`quest-fleet-rules` 的 `NATION_TOKENS`
//     （国籍词典）与 `NATION_HEAD_NOUNS`（中心词表）正是这些 label 被切出来的依据。
//     我这里不抄一份「国籍词清单」当标准答案：抄漏一个，就永远发现不了它没被统一；
//   · 覆盖面拿两个规则源的**真产物**逐条过（与 ship-type-name / ship-proper-name
//     同一个收集器），不拿正则去匹配源码文本。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import nodeTest from 'node:test'

import shipNationName from '../dist/shared/ship-nation-name.js'
import shipProperName from '../dist/shared/ship-proper-name.js'
import shipTypeName from '../dist/shared/ship-type-name.js'
import kcwiki from '../dist/main/mg/kcwiki-quest-rules.js'
import kanso from '../dist/main/mg/kanso-quest-rules.js'
import fleetRules from '../dist/main/mg/quest-fleet-rules.js'

const { NATION_LABEL_ZH, localizeShipNationWords } = shipNationName
const { buildShipProperNameIndex, localizeShipProperWords } = shipProperName
const { localizeShipTypeWords, shipTypeLabelTokens } = shipTypeName
const { buildKcwikiRuleContext, decodeKcwikiRequirement, augmentShipGroupsFromQuestText } = kcwiki
const { buildKansoQuestRules } = kanso
const {
  NATION_HEAD_NOUNS,
  NATION_TOKENS,
  buildFleetRuleContext,
  deriveFleetRule,
} = fleetRules

// ---------------------------------------------------------------- 出口本身（不吃真包）

nodeTest('国籍词组出口:自研推导侧从正文切下来的五种写法都并到规范写法', () => {
  assert.equal(localizeShipNationWords('美英澳荷出身的舰娘'), '美/英/澳/荷舰娘')
  assert.equal(localizeShipNationWords('美英澳荷出身舰娘'), '美/英/澳/荷舰娘')
  assert.equal(localizeShipNationWords('美英舰艇'), '美/英舰娘')
  assert.equal(localizeShipNationWords('法国舰艇'), '法国舰娘')
  assert.equal(localizeShipNationWords('法国船'), '法国舰娘')
  assert.equal(localizeShipNationWords(''), '')
})

nodeTest('国籍词组出口:已经规范的原样不动——括注与舰种中心词都不许被顺手改掉', () => {
  // 「(USS)」是中文正文自己带的括注（B147），删掉就是替正文改口
  assert.equal(localizeShipNationWords('美军(USS)舰娘'), '美军(USS)舰娘')
  // 手写侧本来就是规范写法（B149/B150、Cy14）
  assert.equal(localizeShipNationWords('美/英/澳/荷舰娘'), '美/英/澳/荷舰娘')
  assert.equal(localizeShipNationWords('法国舰娘'), '法国舰娘')
  // 中心词是**舰种词**「航空母舰」不是国籍后缀：换成「舰娘」会把「只要美英航母」
  // 说成「只要美英舰」——门变松，硬伤方向（B151）
  assert.equal(localizeShipNationWords('美/英航空母舰'), '美/英航空母舰')
})

nodeTest('国籍词组出口:整词匹配,不做子串替换', () => {
  // 表里有「法国船」「美英舰艇」，但它们只在**整词**时才算数；
  // 子串替换会把下面这些词从中间掏空
  for (const raw of ['法国船坞', '美英舰艇群', '舰艇', '德国舰娘出身', '驱逐舰', '第八驱逐队']) {
    assert.equal(localizeShipNationWords(raw), raw, `「${raw}」被子串替换误伤了`)
  }
})

nodeTest('国籍词组出口:分隔符与前后空白一个字节都不碰', () => {
  // kcwiki 写 ' / '、自研侧写 '/'，中文化不许顺手把谁的排版改成另一个人的
  assert.equal(localizeShipNationWords('法国舰艇 / 驱逐舰'), '法国舰娘 / 驱逐舰')
  assert.equal(localizeShipNationWords('法国舰艇/驱逐舰'), '法国舰娘/驱逐舰')
  assert.equal(localizeShipNationWords('另一艘（法国船 / 驱逐舰）'), '另一艘（法国船 / 驱逐舰）')
})

nodeTest('国籍词组出口:幂等——重建多少次追踪器结果都一样', () => {
  for (const [raw, zh] of Object.entries(NATION_LABEL_ZH)) {
    assert.equal(localizeShipNationWords(zh), zh, `「${raw}」→「${zh}」再跑一遍又变了`)
  }
  assert.ok(Object.keys(NATION_LABEL_ZH).length > 0)
})

// ---------------------------------------------------------------- 护栏：真规则包全量

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

let cached = null
const world = () => {
  if (cached) return cached
  const s2 = readJson(s2Url)
  const masterRaw = s2.api_data ?? s2
  const scn = readJson(scnUrl).data ?? {}
  const localizationData = readJson(l10nUrl).data
  const fcd = readJson(fcdUrl).data
  const context = buildKcwikiRuleContext(masterRaw)
  const zhShipNames = new Map(
    Object.entries(localizationData?.entities?.ship ?? {})
      .map(([id, entry]) => [Number(id), `${entry?.zh ?? ''}`])
      .filter(([id, zh]) => id > 0 && !!zh),
  )
  const labels = []
  const take = (goal, where) => {
    for (const group of goal?.groups ?? []) labels.push({ label: group.label, where })
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
  const fleetContext = buildFleetRuleContext(masterRaw, localizationData)
  for (const [idText, raw] of Object.entries(scn)) {
    const questId = parseInt(idText, 10)
    if (!questId) continue
    const code = `${raw?.code ?? ''}`
    take(
      deriveFleetRule(
        questId,
        code,
        `${raw?.desc ?? ''}`,
        `${raw?.memo2 ?? ''}`,
        fleetContext,
      )?.fleetGoal,
      `艦素推导/${code || questId}`,
    )
  }
  assert.ok(labels.length > 500, `只扫到 ${labels.length} 条编成门,收集器多半坏了`)
  const index = buildShipProperNameIndex({ masterRaw, localizationData })
  cached = {
    labels,
    // 与 quest-counter 的 localizeFleetGoalLabels 同一条链、同一个先后
    localize: (label) =>
      localizeShipNationWords(localizeShipProperWords(localizeShipTypeWords(label), index)),
  }
  return cached
}

/**
 * 真包里的国籍组标签。判据取产地那两张表：**以国籍词开头、以国籍中心词收尾**。
 * 故意取超集（「美/英航空母舰」这种中心词是舰种词的也收进来），
 * 宁可多钉几条，也别让某一族悄悄漏出统一的网。
 */
const nationLabels = () => {
  const keys = Object.keys(NATION_TOKENS)
  const out = new Map()
  for (const { label, where } of world().labels) {
    if (!keys.some((key) => label.startsWith(key))) continue
    if (!NATION_HEAD_NOUNS.some((noun) => label.endsWith(noun))) continue
    if (!out.has(label)) out.set(label, new Set())
    out.get(label).add(where)
  }
  assert.ok(out.size > 0, '一条国籍组标签都没扫到,收集器或判据多半坏了')
  return out
}

test('护栏:真包跑完,「舰艇/舰船/军舰/船」结尾的国籍组零残留', () => {
  const { localize } = world()
  // 规范中心词只有「舰娘」；「舰」「艦」不算残留——它俩收的是「美/英**航空母舰**」
  // 这类中心词本身就是舰种词的标签（换掉会把门说松）。其余全是这一单要消灭的写法。
  const stale = NATION_HEAD_NOUNS.filter((noun) => !['舰娘', '舰', '艦'].includes(noun))
  const residue = []
  for (const [label, wheres] of nationLabels()) {
    const after = localize(label)
    if (stale.some((noun) => after.endsWith(noun))) {
      residue.push(`${label} → ${after}（${[...wheres].sort().join('、')}）`)
    }
  }
  assert.deepEqual(residue, [], '这些国籍组还在用「舰艇/船」上屏,去 shared/ship-nation-name 补格')
})

test('护栏:真包跑完的国籍组前后对照——清单钉在这里当账', () => {
  const { localize } = world()
  const ledger = [...nationLabels().keys()].map((label) => `${label} → ${localize(label)}`).sort()
  // 这份清单变长/变短时，改动者要一条一条看：新出现的那条中心词统一了没有，
  // 消失的那条是上游把正文改了还是我们把门读丢了。
  assert.deepEqual(ledger, [
    // 同一条任务两侧原本各说各的：推导侧「法国船」、手写侧「法国舰娘」
    '法国舰娘 → 法国舰娘', // 艦素手写/Cy14
    '法国舰艇 → 法国舰娘', // 艦素推导/2606Cw1
    '法国船 → 法国舰娘', // 艦素推导/Cy14
    '美/英/澳/荷舰娘 → 美/英/澳/荷舰娘', // 艦素手写/B149、B150
    // 中心词是舰种词「航空母舰」，不是国籍后缀 → 保留（换掉会把门说松）
    '美/英航空母舰 → 美/英航空母舰', // 艦素手写/B151
    // 「(USS)」是中文正文自己带的括注 → 保留
    '美军(USS)舰娘 → 美军(USS)舰娘', // 艦素推导/B147
    '美英澳荷出身舰娘 → 美/英/澳/荷舰娘', // 艦素推导/B150
    '美英澳荷出身的舰娘 → 美/英/澳/荷舰娘', // 艦素推导/B148、B149
    '美英舰艇 → 美/英舰娘', // 艦素推导/By11
  ].sort())
})

test('护栏:整条链幂等——全部标签跑两遍结果一样', () => {
  const { labels, localize } = world()
  for (const { label, where } of labels) {
    const first = localize(label)
    assert.equal(localize(first), first, `「${label}」（${where}）跑第二遍又变了`)
  }
})

test('护栏:词组表一个词都没命中的标签,逐字节原样——国籍这一遍不做子串替换', () => {
  const { labels } = world()
  for (const { label, where } of labels) {
    if (shipTypeLabelTokens(label).some((token) => token in NATION_LABEL_ZH)) continue
    assert.equal(
      localizeShipNationWords(label),
      label,
      `「${label}」（${where}）没命中词组表却被改了`,
    )
  }
})
