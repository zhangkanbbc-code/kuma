// 译名接线：那些「主数据原文直通屏幕」的渲染点改成先查表之后，表本身撑不撑得住。
//
// ---- 为什么会有这份护栏（2026-08-25 汉化清点）----
// `entityTermHtml` 住在 localization.ts、名字带 entity，**却一个字都不翻译**（只套颜色
// class）。全仓九处把主数据的日文原文直接喂给它，上屏就是日文——而译名明明就在包里。
// 同族的还有一批直取 `api_name` / `masterShipName()` 的调用点。这些都已改成先过
// `entityNamePlain(域, id, 原文)`。
//
// 这份护栏钉两件事：
//  ① 那几个域的译名覆盖率真的撑得住「查一下就是中文」这句话（premise 检查）；
//  ② 窄格默认单语——`bilingualNameHtml` 不显式开 showOriginal 就只出中文，
//     不许某天默认值一改，十几个窄格突然并排出日文（他的红线：窄格绝不双语）。
// 跑的是真包 + 真的 renderer/localization.ts，不断言源码文本。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require_ = createRequire(import.meta.url)
const { buildSync } = require_('esbuild')
const ROOT = path.join(fileURLToPath(import.meta.url), '..', '..')
const readSrc = (rel) => fs.readFileSync(path.join(ROOT, 'src', rel), 'utf8')
const lodeFile = (name) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'lodes', name), 'utf8'))

const ENTITIES = lodeFile('kcwiki-localization.json').data.entities

// ---- 把真的 localization.ts 编出来跑；kernel 只给它用到的两样 ----
const localization = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-l10n-wire-'))
  const files = {
    'entry.ts': [
      "export * from './renderer/localization'",
      "export * from './renderer/kcwiki-zh'",
      "export { normalizeTaskEntityText } from './renderer/task-entity-match'",
      '',
    ].join('\n'),
    'renderer/localization.ts': readSrc('renderer/localization.ts'),
    'renderer/kcwiki-zh.ts': readSrc('renderer/kcwiki-zh.ts'),
    'renderer/task-entity-match.ts': readSrc('renderer/task-entity-match.ts'),
    'renderer/zh-simplify.ts': readSrc('renderer/zh-simplify.ts'),
    'shared/abyssal-label.ts': readSrc('shared/abyssal-label.ts'),
    'shared/ship-nationality.ts': readSrc('shared/ship-nationality.ts'),
    'shared/zh-simplify.ts': readSrc('shared/zh-simplify.ts'),
    'renderer/kernel.ts': [
      'export const esc = (value: unknown): string =>',
      "  `${value ?? ''}`.replaceAll('&', '&amp;').replaceAll('<', '&lt;')",
      `    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')`,
      'export const queryLode = async (id: string): Promise<any> => (globalThis as any).__lode(id)',
      '',
    ].join('\n'),
  }
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  const outfile = path.join(dir, 'l10n.cjs')
  buildSync({
    entryPoints: [path.join(dir, 'entry.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  })
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', fs.readFileSync(outfile, 'utf8'))(
    require_,
    mod,
    mod.exports,
    outfile,
  )
  return mod.exports
})()

globalThis.document ??= { addEventListener: () => {} }
globalThis.__lode = (id) =>
  ({
    'kcwiki-localization': lodeFile('kcwiki-localization.json'),
    'quests-scn': lodeFile('quests-scn.json'),
    'kcwiki-expedition': lodeFile('kcwiki-expedition.json'),
    'opencc-t2s': lodeFile('opencc-t2s.json'),
  })[id] ?? null

const hasKana = (text) => /[ぁ-ゖァ-ヺ]/.test(`${text ?? ''}`)

// ---------------------------------------------------------------- ① 覆盖率前提
//
// 下面每一行都对应一批**已经接上线的渲染点**。数字是 2026-08-25 实测；哪天包更新
// 把覆盖率打下去，这里当场红——因为那时候「查一下就是中文」这句话已经不成立了。

const WIRED = [
  // 域, 最少条目, 允许 zh 仍带假名的上限, 接线的渲染点（出问题时照这个去找）
  ['shipType', 22, 0, 'bi.ts 官方示例编成 / bi.ts 推荐编成行 / qn.ts 击沉计数 / ru.ts 构成芯片'],
  ['item', 69, 0, 'bi.ts 收益格 / shi.ts 道具履历 / ji.ts 海域官方奖励 / bi.ts 远征奖励'],
  ['mapArea', 18, 3, 'shi.ts 陆航整备 chip / shi.ts 海图分组标题'],
  ['ship', 862, 0, 'lg.ts 入渠通知 / di.ts 友军舰名 / qa.ts 下一改造 / equip-stock CSV 所在列'],
  ['equip', 584, 0, 'ru.ts 陆航机体回退 / ji.ts 装备图标悬停族'],
]

for (const [domain, minEntries, kanaCap, where] of WIRED) {
  test(`译名覆盖率前提:${domain} 域撑得住「查一下就是中文」（${where}）`, () => {
    const table = ENTITIES[domain] ?? {}
    const ids = Object.keys(table)
    assert.ok(
      ids.length >= minEntries,
      `${domain} 只剩 ${ids.length} 条（实测 ${minEntries}）——接线点会大面积回落日文`,
    )
    const kana = ids.filter((id) => hasKana(table[id]?.zh))
    assert.ok(
      kana.length <= kanaCap,
      `${domain} 的 zh 里带假名的涨到 ${kana.length} 条（上限 ${kanaCap}）：${kana.slice(0, 5).join(',')}`,
    )
  })
}

test('译名接线:entityNamePlain 查得到出中文,查不到如实保原文', async () => {
  await localization.initLocalization()
  assert.equal(localization.normalizeTaskEntityText('南西諸島近海'), '南西诸岛近海')
  // 舰种（bi/qn/ru 三处接线喂的就是 mg.master.stypes 的日文原名）
  assert.equal(localization.entityNamePlain('shipType', 2, '駆逐艦'), '驱逐舰')
  // 道具（bi/shi/ji 三处）
  assert.equal(localization.entityNamePlain('item', 1, '高速修復材'), '高速修复材')
  // 包外的新 id：如实回落原文，绝不硬翻
  assert.equal(localization.entityNamePlain('item', 99_999, '謎の道具'), '謎の道具')
  assert.equal(localization.entityNamePlain('ship', 99_999, ''), '')
})

test('译名接线:深海装备的链接类型认得出域——同一格的悬停与链接不许一中一日', () => {
  // 链接类型叫 abyssEquip（di.ts 按 mstId 判的），此前 domainOfLink 只认 mstEquip，
  // 于是同一个函数上一行算出的中文只喂给了图标 title，链接文字还是日文原名。
  const raw = ENTITIES.abyssEquip
  const id = Object.keys(raw).find((key) => raw[key].zh && raw[key].zh !== raw[key].ja)
  assert.ok(id, 'abyssEquip 域里一条有译名的都没有——前提变了')
  assert.equal(localization.localizedLinkLabel('abyssEquip', Number(id), raw[id].ja), raw[id].zh)
})

// ---------------------------------------------------------------- ② 窄格单语红线

test('窄格红线:不显式开 showOriginal 就只出中文,一个日文字都不带', () => {
  const out = localization.bilingualNameHtml('长门', '長門')
  assert.equal(out, '长门')
  assert.ok(!/長門/.test(out), '窄格出双语了——十几个格子会当场撑破')
  assert.ok(!/l10n-toggle/.test(out), '窄格冒出了「原」折叠钮')
  // compact 只是排版档，不改语言
  assert.equal(localization.bilingualNameHtml('长门', '長門', { compact: true }), '长门')
})

test('窄格红线:elink 一族默认走的就是单语那条路', async () => {
  await localization.initLocalization()
  // 敌舰 token（di.ts:3111 一个点位并排 6 枚）是全仓最挤的格子之一
  const label = localization.localizedLinkLabel('abyssShip', 1501, '駆逐イ級elite')
  assert.ok(!/l10n-toggle/.test(label), '最挤的敌舰 token 上冒出了「原」折叠钮')
  assert.ok(!/駆逐/.test(label), '敌舰 token 出双语了')
  assert.match(label, /elite$/, '形态标注被吃掉了——那是形态信息，丢了就分不清是两拨敌人')
})

test('窄格红线:「原」折叠钮只在显式开启时出现（图鉴那一处）', () => {
  const opened = localization.bilingualNameHtml('长门', '長門', { showOriginal: true })
  assert.match(opened, /l10n-toggle/)
  assert.match(opened, /長門/)
})

test('繁→简在译名与任务正文装配时只处理中文列，运行期补登同口径', async () => {
  const opencc = lodeFile('opencc-t2s.json')
  globalThis.__lode = (id) =>
    ({
      'kcwiki-localization': {
        data: {
          entities: {
            ship: {
              1: { ja: '艦隊の長門', zh: '長門', source: 'fixture' },
            },
          },
        },
      },
      'quests-scn': {
        data: {
          2: {
            code: 'A2',
            name: '艦隊任務',
            desc: '獲得裝備與圖紙',
            memo: '報酬：開發資材',
            memo2: '編成聯合艦隊',
            pre: [],
          },
        },
      },
      'kcwiki-expedition': { data: {} },
      'opencc-t2s': opencc,
    })[id] ?? null

  await localization.initLocalization()
  assert.equal(localization.entityNamePlain('ship', 1), '长门')
  assert.equal(localization.localizedEntry('ship', 1).ja, '艦隊の長門')
  assert.equal(localization.localizedEntry('ship', 1).source, 'fixture')
  assert.equal(localization.entityNamePlain('quest', 2), '舰队任务')

  const body = localization.simplifyQuestScnData(globalThis.__lode('quests-scn').data)[2]
  assert.equal(body.desc, '获得装备与图纸')
  assert.equal(body.memo, '报酬：开发资材')
  assert.equal(body.memo2, '编成联合舰队')

  localization.registerLocalizedName('ship', 3, '時津風', '時津風', 'runtime-fixture')
  assert.equal(localization.entityNamePlain('ship', 3), '时津风')
  assert.equal(localization.localizedEntry('ship', 3).ja, '時津風')

  const ships = localization.simplifyKcwikiShipsData({
    4: {
      日文名: '艦隊の長門',
      中文名: '長門',
      级别: ['陽炎型', 1],
      改造: { 图纸: '設計圖x1' },
    },
  })
  assert.equal(ships[4].日文名, '艦隊の長門')
  assert.equal(ships[4].中文名, '长门')
  assert.equal(ships[4].级别[0], '阳炎型')
  assert.equal(ships[4].改造.图纸, '设计图x1')

  const expedition = localization.simplifyKcwikiExpeditionData({
    5: {
      nameJp: '艦隊遠征',
      nameZh: '艦隊遠征',
      composition: '聯合艦隊',
      rewards: { items: [{ name: '開發資材' }] },
    },
  })
  assert.equal(expedition[5].nameJp, '艦隊遠征')
  assert.equal(expedition[5].nameZh, '舰队远征')
  assert.equal(expedition[5].composition, '联合舰队')
  assert.equal(expedition[5].rewards.items[0].name, '开发资材')

  const fit = localization.simplifyFitBonusData({
    schemaVersion: 1,
    equipGroups: { radar: { zh: '對空電探', tokens: [] } },
    equips: { 6: { id: 6, nameJa: '對空電探', nameZh: '對空電探', rules: [] } },
    unresolved: [],
  })
  assert.equal(fit.equipGroups.radar.zh, '对空电探')
  assert.equal(fit.equips[6].nameJa, '對空電探')
  assert.equal(fit.equips[6].nameZh, '对空电探')
})

test('opencc-t2s 缺席时译名装配恒等', async () => {
  globalThis.__lode = (id) =>
    ({
      'kcwiki-localization': {
        data: { entities: { ship: { 1: { ja: '長門', zh: '長門' } } } },
      },
      'quests-scn': { data: {} },
      'kcwiki-expedition': { data: {} },
    })[id] ?? null

  await localization.initLocalization()
  assert.equal(localization.entityNamePlain('ship', 1), '長門')
  assert.equal(localization.localizedEntry('ship', 1).ja, '長門')
})

test('独立 renderer 与直读资料包的装配边界都安装或复用简化器', () => {
  const localizationSource = readSrc('renderer/localization.ts')
  const questTree = readSrc('renderer/quest-tree-window.ts')
  const battleReplay = readSrc('renderer/battle-replay-window.ts')
  const questModule = readSrc('renderer/modules/qn.ts')
  const eventModule = readSrc('renderer/modules/du.ts')
  const resourceModule = readSrc('renderer/modules/zi.ts')
  const expeditionModule = readSrc('renderer/modules/bi.ts')
  const rosterModule = readSrc('renderer/modules/qa.ts')
  const fleetModule = readSrc('renderer/modules/ru.ts')
  const catalogModule = readSrc('renderer/modules/ji.ts')

  assert.match(localizationSource, /queryLode\('opencc-t2s'\)/)
  assert.match(localizationSource, /installZhSimplifier\(opencc\)/)
  assert.match(localizationSource, /installTaskEntityFold\(opencc\?\.data\?\.chars \?\? null\)/)
  assert.match(questTree, /queryLode\('opencc-t2s'\)/)
  assert.match(questTree, /installZhSimplifier\(opencc\)/)
  assert.match(questTree, /simplifyQuestScnData\(pack\?\.data\)/)
  assert.match(battleReplay, /queryLode\('opencc-t2s'\)/)
  assert.match(battleReplay, /installZhSimplifier\(opencc\)/)
  assert.match(battleReplay, /await Promise\.all\(\[[\s\S]*initLocalization\(\)/)
  assert.match(questModule, /data:\s*simplifyQuestScnData\(scnLode\.data\)/)
  assert.match(eventModule, /simplifyQuestScnData\(\(catalog as any\)\.data\)/)
  assert.match(resourceModule, /simplifyQuestScnData\(questLode\.data\)/)
  assert.match(expeditionModule, /simplifyKcwikiExpeditionData\(localizationPack\.data\)/)
  assert.match(questModule, /simplifyKcwikiShipsData\(kcwikiShipLode\?\.data\)/)
  assert.match(rosterModule, /simplifyKcwikiShipsData\(kcwiki\.data\)/)
  assert.match(fleetModule, /simplifyKcwikiShipsData\(lode\.data\)/)
  assert.match(catalogModule, /simplifyKcwikiShipsData\(kcwikiLode\.data\)/)
  assert.match(catalogModule, /simplifyFitBonusData\(f\.data as FitBonusData\)/)
})
