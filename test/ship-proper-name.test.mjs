// 编成门标签里的专有名词（舰名 / 舰级 / 队名残段）统一中文写法。
//
// 判据一律**不取自被验证的那张表自己**：
//   · 舰名那一路的判据是主数据 `api_mst_ship` × 译名包 `entities.ship`——
//     索引里每一条中文名都能在译名包里逐字查到，我这里不抄一份清单当标准答案；
//   · 舰级那一路除了走出口，还与**另一条独立的路**对账：随包 `kcwiki-ships` 的
//     「级别」字段经 `buildShipClassNameIndex` 得到的舰级真名。两条路同一个答案才算数；
//   · 覆盖面拿两个规则源的**真产物**逐词过（与 ship-type-name.test.mjs 同一个收集器）。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import nodeTest from 'node:test'

import shipProperName from '../dist/shared/ship-proper-name.js'
import shipTypeName from '../dist/shared/ship-type-name.js'
import shipClassName from '../dist/shared/ship-class-name.js'
import kcwiki from '../dist/main/mg/kcwiki-quest-rules.js'
import kanso from '../dist/main/mg/kanso-quest-rules.js'
import fleetRules from '../dist/main/mg/quest-fleet-rules.js'

const { buildShipProperNameIndex, classifyShipProperToken, localizeShipProperWords } =
  shipProperName
const { localizeShipTypeWords, shipTypeLabelTokens } = shipTypeName
const { buildShipClassNameIndex } = shipClassName
const { buildKcwikiRuleContext, decodeKcwikiRequirement, augmentShipGroupsFromQuestText } = kcwiki
const { buildKansoQuestRules } = kanso
const { buildFleetRuleContext, deriveFleetRule } = fleetRules

const s2Url = new URL('../../s2.json', import.meta.url)
const reqUrl = new URL('../assets/lodes/kcwiki-quest-req.json', import.meta.url)
const scnUrl = new URL('../assets/lodes/quests-scn.json', import.meta.url)
const l10nUrl = new URL('../assets/lodes/kcwiki-localization.json', import.meta.url)
const shipsUrl = new URL('../assets/lodes/kcwiki-ships.json', import.meta.url)
const fcdUrl = new URL('../assets/lodes/poi-fcd-map.json', import.meta.url)
const fixtures = [s2Url, reqUrl, scnUrl, l10nUrl, shipsUrl, fcdUrl]
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
    const derived = deriveFleetRule(
      questId,
      code,
      `${raw?.desc ?? ''}`,
      `${raw?.memo2 ?? ''}`,
      fleetContext,
    )
    take(derived?.fleetGoal, `艦素推导/${code || questId}`)
  }
  assert.ok(labels.length > 500, `只扫到 ${labels.length} 条编成门,收集器多半坏了`)
  cached = {
    masterRaw,
    localizationData,
    labels,
    index: buildShipProperNameIndex({ masterRaw, localizationData }),
  }
  return cached
}

/** 出口跑完之后，每个词与它的判决。 */
const verdicts = () => {
  const { labels, index } = world()
  const out = new Map()
  for (const { label, where } of labels) {
    for (const token of shipTypeLabelTokens(localizeShipTypeWords(label))) {
      if (out.has(token)) continue
      out.set(token, { ...classifyShipProperToken(token, index), where })
    }
  }
  return out
}

// ---------------------------------------------------------------- 出口本身（不吃真包）

nodeTest('专有名词出口:空索引时舰名与舰级两路全不命中,只剩字形折叠兜底', () => {
  const empty = buildShipProperNameIndex({})
  // 回查那两路没有索引就一个字都换不出来——缺包时退回原文，不硬翻
  for (const raw of ['Saratoga Mk.II', '第八驱逐队', '']) {
    assert.equal(localizeShipProperWords(raw, empty), raw)
  }
  // ③ 那条兜底路不吃索引（换的是字不是词），所以字形照折
  assert.equal(localizeShipProperWords('時雨', empty), '时雨')
})

nodeTest('专有名词出口:分隔符与前后空白原样,只换词', () => {
  const index = buildShipProperNameIndex({
    masterRaw: { api_mst_ship: [{ api_id: 43, api_name: '時雨' }, { api_id: 17, api_name: '陽炎' }] },
    localizationData: {
      entities: { ship: { 43: { ja: '時雨', zh: '时雨' }, 17: { ja: '陽炎', zh: '阳炎' } } },
    },
  })
  // kcwiki 写 ' / '、自研侧写 '/'，中文化不许顺手把谁的排版改成另一个人的
  assert.equal(localizeShipProperWords('時雨 / 陽炎', index), '时雨 / 阳炎')
  assert.equal(localizeShipProperWords('時雨/陽炎', index), '时雨/阳炎')
  // 舰级：基名回查 + 末字归一
  assert.equal(localizeShipProperWords('陽炎型', index), '阳炎级')
  assert.equal(localizeShipProperWords('陽炎级', index), '阳炎级')
  // 认不出的原样放行，一个字都不硬翻
  assert.equal(localizeShipProperWords('第 X 驱逐队', index), '第 X 驱逐队')
  // 括号里的东西不许被吃掉：钥匙只去空白、不去标点
  assert.equal(localizeShipProperWords('陽炎改二(丁)', index), '陽炎改二(丁)')
})

nodeTest('专有名词出口:一把钥匙查出两个中文名就放行,不替玩家挑一个', () => {
  const index = buildShipProperNameIndex({
    masterRaw: {
      api_mst_ship: [
        { api_id: 645, api_name: '宗谷' },
        { api_id: 699, api_name: '宗谷' },
      ],
    },
    localizationData: {
      entities: {
        ship: { 645: { ja: '宗谷', zh: '宗谷灯塔补给' }, 699: { ja: '宗谷', zh: '宗谷特务舰' } },
      },
    },
  })
  assert.equal(localizeShipProperWords('宗谷', index), '宗谷')
})

// ---------------------------------------------------------------- 护栏：真规则包全量

test('护栏:真包跑完,改写的每个中文名都能在译名包里逐字查到——没有一个是我现造的', () => {
  const { localizationData, index } = world()
  const zhNames = new Set(
    Object.values(localizationData?.entities?.ship ?? {})
      .map((entry) => `${entry?.zh ?? ''}`)
      .filter(Boolean),
  )
  for (const [token, verdict] of verdicts()) {
    if (verdict.via === 'ship') {
      assert.ok(
        zhNames.has(verdict.text),
        `「${token}」→「${verdict.text}」不是译名包里的中文舰名（${verdict.where}）`,
      )
    }
    if (verdict.via === 'class') {
      assert.ok(
        verdict.text.endsWith('级'),
        `舰级「${token}」→「${verdict.text}」没归到「级」（${verdict.where}）`,
      )
      assert.ok(
        zhNames.has(verdict.text.slice(0, -1)),
        `舰级「${token}」的基名「${verdict.text.slice(0, -1)}」不是译名包里的中文舰名`,
      )
    }
  }
  assert.ok(index.size > 800, `索引只有 ${index.size} 把钥匙,多半没装上译名包`)
})

test('护栏:舰级那一路与「舰级真名」另一条独立的路对账', () => {
  const { masterRaw, localizationData } = world()
  const ctypeById = new Map()
  for (const ship of masterRaw?.api_mst_ship ?? []) {
    ctypeById.set(Number(ship.api_id), Number(ship.api_ctype) || 0)
  }
  const trueClass = buildShipClassNameIndex(
    Object.values(readJson(shipsUrl).data ?? {}),
    (mstId) => ctypeById.get(mstId) ?? 0,
  )
  const idsByZh = new Map()
  for (const [id, entry] of Object.entries(localizationData?.entities?.ship ?? {})) {
    const zh = `${entry?.zh ?? ''}`
    if (!zh) continue
    idsByZh.set(zh, [...(idsByZh.get(zh) ?? []), Number(id)])
  }
  // 出口只做「字形 + 后缀」归一，**不把级名换成舰级真名**：正文写「铃谷型」就出「铃谷级」，
  // 不替玩家改口说「最上级」——那是在改门的说法。这一条钉的是「除了这类，两条路必须同答案」。
  const KNOWN_DIVERGENCE = { 铃谷级: '最上级' }
  const seen = new Set()
  for (const [token, verdict] of verdicts()) {
    if (verdict.via !== 'class') continue
    const base = verdict.text.slice(0, -1)
    const names = [
      ...new Set(
        (idsByZh.get(base) ?? []).map((id) => trueClass.get(ctypeById.get(id) ?? 0)).filter(Boolean),
      ),
    ]
    assert.equal(names.length, 1, `「${token}」的基名「${base}」对不上唯一的舰级真名：${names}`)
    if (KNOWN_DIVERGENCE[verdict.text] === names[0]) {
      seen.add(verdict.text)
      continue
    }
    assert.equal(
      names[0],
      verdict.text,
      `「${token}」→「${verdict.text}」与舰级真名「${names[0]}」两条路不一样了`,
    )
  }
  assert.deepEqual(
    [...seen].sort(),
    Object.keys(KNOWN_DIVERGENCE).sort(),
    '已知的级名分歧变了,去 shared/ship-proper-name 文件头对一遍口径再改这份清单',
  )
})

test('护栏:出口幂等且不吞词——跑两遍结果一样,词数一个不少', () => {
  const { labels, index } = world()
  const once = (label) => localizeShipProperWords(localizeShipTypeWords(label), index)
  for (const { label, where } of labels) {
    const first = once(label)
    assert.equal(once(first), first, `「${label}」（${where}）跑第二遍又变了`)
    assert.equal(
      shipTypeLabelTokens(first).length,
      shipTypeLabelTokens(localizeShipTypeWords(label)).length,
      `「${label}」（${where}）被吞掉了词`,
    )
  }
})

test('护栏:真包跑完,认得的舰名与舰级零日文字形残留', () => {
  const { index } = world()
  const residue = []
  for (const [token, verdict] of verdicts()) {
    if (verdict.via === null) continue
    // 换过的词再送回出口必须原地不动；动了就说明还有一层没译干净
    const again = classifyShipProperToken(verdict.text, index)
    if (again.via !== null && again.text !== verdict.text) {
      residue.push(`${token} → ${verdict.text} → ${again.text}（${verdict.where}）`)
    }
  }
  assert.deepEqual(residue, [], '这些词换了一半')
  // 假名一个都不该活到上屏：认不出的词里若混进假名，那是舰名索引漏了
  const kana = []
  for (const [token, verdict] of verdicts()) {
    if (verdict.via === null && /[぀-ヿ]/.test(token)) {
      kana.push(`${token}（${verdict.where}）`)
    }
  }
  assert.deepEqual(kana, [], '这些词带着假名原样上屏了')
})

test('护栏:兜底的简繁折叠只碰这几个词——清单钉在这里当账', () => {
  const folded = [...verdicts()]
    .filter(([, verdict]) => verdict.via === 'fold')
    .map(([token, verdict]) => `${token}→${verdict.text}`)
    .sort()
  // ③ 那条路换的是**字**不是**词**（cjk-fold 的对位表），覆盖面小、也不认名字。
  // 它今天只兜住两个：上游中文正文里没译的队名，与正文自己的一个碎片。
  // 这份清单变长时，改动者要一个字一个字看新增的那条折对没折对。
  assert.deepEqual(folded, ['第四水雷戦隊→第四水雷战队', '補→补'])
})

test('护栏:放行清单——剩下的没有一个是该译没译的舰名/舰级', () => {
  const { index } = world()
  const kept = [...verdicts()].filter(([, verdict]) => verdict.via === null).map(([token]) => token)
  assert.ok(kept.length > 0, '一个放行词都没有,收集器多半坏了')
  for (const token of kept) {
    // 放行的词里不许有「其实索引查得到」的：查得到还放行，就是出口漏了它
    assert.equal(
      classifyShipProperToken(token, index).via,
      null,
      `「${token}」索引里查得到却被放行了`,
    )
  }
  // 拉丁字母的放行词逐条点名：英文名要么已经有译名（那就该换掉），
  // 要么游戏里压根没实装这艘舰、随包资料给不出中文（那才是放行的正当理由）。
  const latin = kept.filter((token) => /[A-Za-z]/.test(token)).sort()
  assert.deepEqual(latin, [
    // （原有第三个「John C.Butler级」已在源头改写中文——kanso-quest-rules Cy6
    //   手写标签 2026-09-01 定稿为「约翰·C·巴特勒级」，不再经放行通道。）
    // 「J级」是这一级在中文里通行的写法本身，不是没译的英文（kanso-quest-rules Cy1）。
    'J级驱逐舰',
    // 中文真名自带缩写字母「C」（Cy6 手写标签 2026-09-01 定稿），不是未译英文。
    '约翰·C·巴特勒级',
    // 国籍词，不是舰名——「USS」是中文正文自己带的括注（B147）。这一遍放行它是对的：
    // 国籍词组归第三遍（`shared/ship-nation-name.ts`）管，那张表里它是**已核过、原样保留**
    // 的一条（中心词已经是「舰娘」，括注属于正文），前后对照钉在 ship-nation-name.test.mjs。
    '美军(USS)舰娘',
  ])
})
