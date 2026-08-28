// 出击那一层的三条小字段：
// - `api_flavor_info[].api_class_name`  boss 开场字幕的前半截（舰型名）——主数据里没有
// - `api_itemget_eo_comment`            终点 / EO 报酬（**同一行的 api_itemget 是 undefined**）
// - `api_bosscomp`                      游戏自报「本图 Boss 本期已击破」（**假说**）
//
// 真报文取自 test/fixtures 下两份 coverage fixture（账本本身不入仓）；
// 渲染侧把 di.ts 的海图卡与 voice-subtitle.ts 的 flavorSpeaker 原样切出来跑。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'

import { buildSync } from 'esbuild'

import battleModule from '../dist/main/mg/battle.js'
import { renderSeaCard, sortieOf } from './fixtures/render-di-battle.mjs'
import { bossClearedOf, mapGains, nodeNote } from './fixtures/store-map-readers.mjs'

const { parseBattle } = battleModule

const load = (file) =>
  JSON.parse(fs.readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8'))
const battleFixtures = load('battle-field-coverage.json')
const mapFixtures = load('map-node-coverage.json')
const pick = (list, name) => {
  const found = list.find((one) => one.name === name)
  assert.ok(found, `fixture 里没有 ${name}`)
  return structuredClone(found)
}

const ctx = (combinedType = 1) => ({
  fleetShips: (deckId) =>
    Array.from({ length: 6 }, (_, i) => ({
      rosterId: deckId * 100 + i,
      mstId: deckId * 100 + i,
      name: `D${deckId}-${i + 1}`,
      lv: 1,
      nowHp: 50,
      maxHp: 50,
      equipments: [],
    })),
  masterName: (mstId) => `E${mstId}`,
  combinedType: () => combinedType,
})
const parseBattleFixture = (name, mutate) => {
  const one = pick(battleFixtures, name)
  if (mutate) mutate(one.battle)
  return parseBattle(one.path, one.battle, ctx(), 0)
}

// ---- boss 舰型名 ----

test('真报文：舰型名收进 flavorVoices，与舰名各归各位', () => {
  const view = parseBattleFixture('sortie-battle-rescue')
  assert.equal(view.flavorVoices.length, 1)
  assert.equal(view.flavorVoices[0].className, '深海新鋭駆逐艦')
  assert.equal(view.flavorVoices[0].shipName, '駆逐ラ級ζ-壊')
})

test('舰型名缺席：不写这个键，同条台词的其余部分照旧', () => {
  const view = parseBattleFixture('sortie-battle-rescue', (battle) => {
    delete battle.api_flavor_info[0].api_class_name
  })
  assert.equal(view.flavorVoices[0].className, undefined)
  assert.ok(view.flavorVoices[0].message.length > 0)
  assert.ok(!JSON.stringify(view).includes('className'))
})

test('舰型名里的 <br> 与首尾空白照台词同一条规则洗掉', () => {
  const view = parseBattleFixture('sortie-battle-rescue', (battle) => {
    battle.api_flavor_info[0].api_class_name = '  深海<br>新鋭駆逐艦  '
  })
  assert.equal(view.flavorVoices[0].className, '深海\n新鋭駆逐艦')
})

// 字幕里那半截：把 voice-subtitle.ts 的 flavorSpeaker 原样切出来跑，断言它拼出来的说话人。
// 「深海新鋭駆逐艦」这几个词现在一个都不在译名表里，所以眼下走的正是「查不到保原文」那条腿。
const flavorSpeaker = (() => {
  const source = fs
    .readFileSync(new URL('../src/renderer/voice-subtitle.ts', import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n')
  const from = 'const flavorSpeaker = (className: string | undefined, name: string): string => {'
  const to = '/**\n * 短剧/群像语音（kc9997）'
  const start = source.indexOf(from)
  const end = source.indexOf(to, start)
  assert.ok(start >= 0 && end > start, 'voice-subtitle.ts 里找不到 flavorSpeaker，锚点要跟着改')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-flavor-speaker-'))
  const entry = path.join(dir, 'speaker.ts')
  fs.writeFileSync(
    entry,
    `
const TABLE: Record<string, string> = { '駆逐艦': '驱逐舰' }
const localizedEntityId = (_domain: string, label: unknown) =>
  TABLE[\`\${label}\`] ? \`\${label}\` : null
const entityNamePlain = (_domain: string, id: string, fallback: string) => TABLE[id] ?? fallback

${source.slice(start, end)}

export { flavorSpeaker }
`,
  )
  const outfile = path.join(dir, 'speaker.cjs')
  buildSync({ entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' })
  return createRequire(import.meta.url)(outfile).flavorSpeaker
})()

test('字幕：舰型名摆在舰名前面，补上此前只有后半截的那句', () => {
  assert.equal(
    flavorSpeaker('深海新鋭駆逐艦', '駆逐ラ級ζ-壊'),
    '深海新鋭駆逐艦 駆逐ラ級ζ-壊',
  )
})

test('字幕：查得到译名就用中文，查不到保原文', () => {
  assert.equal(flavorSpeaker('駆逐艦', 'ラ級'), '驱逐舰 ラ級')
  assert.equal(flavorSpeaker('深海新鋭駆逐艦', 'ラ級'), '深海新鋭駆逐艦 ラ級')
})

test('字幕：没有舰型名时说话人一个字不变（旧快照走这条）', () => {
  assert.equal(flavorSpeaker(undefined, '駆逐ラ級ζ-壊'), '駆逐ラ級ζ-壊')
  assert.equal(flavorSpeaker('', '駆逐ラ級ζ-壊'), '駆逐ラ級ζ-壊')
  assert.equal(flavorSpeaker('   ', '駆逐ラ級ζ-壊'), '駆逐ラ級ζ-壊')
})

// ---- 终点 / EO 报酬 ----

test('真报文：api_itemget 是 undefined 那一行，只读 api_itemget 就整个漏掉', () => {
  const { body } = pick(mapFixtures, 'map-next-eo-reward')
  assert.equal(body.api_itemget, undefined, '这一行本来就没有 api_itemget')
  assert.deepEqual(mapGains(body), [{ api_usemst: 4, api_id: 1, api_getcount: 700 }])
  assert.equal(nodeNote(body), '获得 燃料×700')
})

test('两个来源同时有就都收，一笔不漏也不并成一笔', () => {
  const body = {
    api_itemget: { api_usemst: 4, api_id: 3, api_getcount: 50 },
    api_itemget_eo_comment: { api_usemst: 4, api_id: 1, api_getcount: 1000 },
  }
  assert.equal(mapGains(body).length, 2)
  assert.equal(nodeNote(body), '获得 钢材×50 · 获得 燃料×1000')
})

test('两个来源都没有：note 是 null，不是空串', () => {
  assert.deepEqual(mapGains({}), [])
  assert.equal(nodeNote({}), null)
})

// ---- api_bosscomp ----

test('真报文：常规图报 1、没打的 EO 图报 0', () => {
  assert.equal(bossClearedOf(pick(mapFixtures, 'map-start-boss-cleared').body, null), true)
  assert.equal(bossClearedOf(pick(mapFixtures, 'map-start-boss-pending').body, null), false)
})

test('字段缺席时保持原样：不知道就是不知道，不退成 false', () => {
  assert.equal(bossClearedOf({}, null), null)
  assert.equal(bossClearedOf({}, true), true)
  assert.equal(bossClearedOf({ api_bosscomp: '1' }, null), null, '字符串不当数用')
})

test('渲染：只在它说「还没击破」时出声，说「已击破」时一律沉默', () => {
  assert.match(renderSeaCard(sortieOf({ bossCleared: false })), /本期尚未击破/)
  assert.ok(
    !renderSeaCard(sortieOf({ bossCleared: true })).includes('击破'),
    '常规图恒为已击破，逐图写一句全是噪音，还会跟自己的 EO 记账抢话',
  )
  assert.ok(!renderSeaCard(sortieOf({ bossCleared: null })).includes('击破'))
})
