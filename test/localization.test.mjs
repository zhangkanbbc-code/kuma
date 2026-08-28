import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  EQUIPTYPE_ZH_FIXES,
  FIRST_PARTY_SHIP_ZH,
  SHIPTYPE_ZH_FIXES,
  parseLuaNameTable,
  simplifyJapanese,
} from '../scripts/localization.mjs'

test('KCWiki Lua equipment rows stay aligned by id and original name', () => {
  const text = `local d = {}
d.equipDataTb = {
\t["526"] = {
\t\t["ID"] = 526,
\t\t["日文名"] = "特四式内火艇改",
\t\t["中文名"] = "特四式内火艇改",
\t\t["属性"] = { ["1"] = 3 }
\t},
\t["566"] = {
\t\t["ID"] = 566,
\t\t["日文名"] = "10.2cm三連装副砲",
\t\t["中文名"] = ""
\t}
}`
  assert.deepEqual(parseLuaNameTable(text), [
    { id: 526, ja: '特四式内火艇改', zh: '特四式内火艇改' },
    { id: 566, ja: '10.2cm三連装副砲', zh: '' },
  ])
})

test('local fallback translates game terminology without hiding the original', () => {
  assert.equal(simplifyJapanese('重巡ネ級-壊'), '重巡NE级-坏')
  assert.equal(simplifyJapanese('10.2cm三連装副砲'), '10.2cm三连装副炮')
  assert.equal(simplifyJapanese('強風改二(熟練)'), '强风改二（熟练）')
})

test('装备类别校正台账：钉住的中文里不许再混日文', () => {
  // 2026-08-16 用户实锤：图鉴分类里 ソナー/対空機銃/上陸用舟艇 等日文混杂——
  // kcdata 的类别 chinese_name 要么留原文要么半吊子简化。台账按 id 钉死。
  const kana = /[ぁ-んァ-ヶー]/
  const kyujitai = /[銃陸簡飛糧撃戦対]/
  for (const [id, zh] of Object.entries(EQUIPTYPE_ZH_FIXES)) {
    assert.ok(zh.trim(), `台账 ${id} 是空的`)
    assert.doesNotMatch(zh, kana, `台账 ${id}「${zh}」还带假名`)
    assert.doesNotMatch(zh, kyujitai, `台账 ${id}「${zh}」还带日制汉字`)
  }
  // 已知最刺眼的三条必须在台账里（片假名类别名）
  for (const id of [14, 25, 40]) assert.ok(EQUIPTYPE_ZH_FIXES[id], `片假名类别 ${id} 不在台账`)
  // 2026-08-16 用户拍板：舰载机三类统一 kcwiki 直译系「舰上/爆击机」，不是错字别改回
  assert.equal(EQUIPTYPE_ZH_FIXES[6], '舰上战斗机')
  assert.equal(EQUIPTYPE_ZH_FIXES[7], '舰上爆击机')
  assert.equal(EQUIPTYPE_ZH_FIXES[8], '舰上攻击机')
  // 台账要真的接进抓取流程，不是摆设
  const source = fs.readFileSync(new URL('../scripts/localization.mjs', import.meta.url), 'utf8')
  assert.match(source, /EQUIPTYPE_ZH_FIXES\[type\.api_id\]/)
})

test('localization refresh never consumes the known-shifted kcdata equipment translation field', () => {
  const source = fs.readFileSync(new URL('../scripts/localization.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /slot\.chinese_name\s*[,)]/)
  assert.match(source, /parseLuaNameTable\(friendlyEquipText\)/)
  assert.match(source, /const id = equip\.id < 1000 \? equip\.id \+ 1000 : equip\.id/)
})

test('译名装配已经不碰 kcdata：那个仓无 LICENSE，一个成分就够挡住随包分发', () => {
  // 2026-08-21 换源。这条是**许可护栏**：kcdata 一旦回潮，整包又不能随发行版走了。
  const source = fs.readFileSync(new URL('../scripts/localization.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /kcwikizh\.github\.io\/kcdata/)
  assert.doesNotMatch(source, /\.chinese_name/) // 注释里可以提它，代码里不许再读

  // 日文原名与 id 空间改自产（游戏主数据），中文名走有许可的同域源
  assert.match(source, /loadStart2MasterArray/)
  assert.match(source, /模块:舰娘数据/)
  assert.match(source, /模块:深海栖舰数据改二/)
  assert.match(source, /kc3-translations/)
})

test('舰种台账只钉住换源前的既有用词，不趁机改界面文案', () => {
  // 术语降级本来就能把 22 条舰种译对 21 条；13 号降级出「潜水舰」，
  // 而界面上一直写「潜水艇」——换源不顺手改用词，按 id 钉住。
  assert.equal(SHIPTYPE_ZH_FIXES[13], '潜水艇')
  assert.equal(simplifyJapanese('潜水艦'), '潜水舰')
  for (const [id, zh] of Object.entries(SHIPTYPE_ZH_FIXES)) {
    assert.doesNotMatch(zh, /[ぁ-んァ-ヶー]/, `舰种台账 ${id}「${zh}」还带假名`)
  }
})

test('舰娘译名的第一方增补只覆盖 kcwiki 尚未收录的形态', () => {
  // 补缺层老规矩：只补缺、不覆盖、上游赶上就退役。现存 5 条是 Phoenix / Glorious 两条链。
  assert.deepEqual(Object.keys(FIRST_PARTY_SHIP_ZH).map(Number).sort((a, b) => a - b), [734, 740, 741, 952, 1027])
  const packUrl = new URL('../assets/lodes/kcwiki-localization.json', import.meta.url)
  if (!fs.existsSync(packUrl)) return
  const ships = JSON.parse(fs.readFileSync(packUrl, 'utf8')).data.entities.ship
  for (const id of Object.keys(FIRST_PARTY_SHIP_ZH)) {
    assert.equal(ships[id]?.source, 'kanso-supplement', `${id} 已被上游收录就该从增补表里删掉`)
  }
})

test('the bilingual UI keeps Chinese primary and folds Japanese below it', () => {
  const source = fs.readFileSync(new URL('../src/renderer/localization.ts', import.meta.url), 'utf8')
  const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const moduleDir = new URL('../src/renderer/modules/', import.meta.url)
  const nonCatalogModules = fs.readdirSync(moduleDir)
    .filter((name) => name.endsWith('.ts') && name !== 'ji.ts')
    .map((name) => fs.readFileSync(new URL(name, moduleDir), 'utf8'))
    .join('\n')
  const html = fs.readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8')
  assert.match(source, /class="l10n-primary" lang="zh-CN"/)
  assert.match(source, /class="l10n-original" lang="ja"/)
  assert.match(source, /data-l10n-toggle/)
  assert.match(source, /if \(!options\.showOriginal\) return esc\(primary\)/)
  assert.match(catalog, /showOriginal:\s*true/)
  assert.doesNotMatch(nonCatalogModules, /showOriginal:\s*true/)
  assert.match(html, /\.l10n-name\s*\{\s*display:\s*inline-flex\s*!important/)
  assert.match(html, /\.l10n-name > \.l10n-primary\s*\{\s*display:\s*inline\s*!important/)
  assert.match(html, /\.l10n-name > \.l10n-original\s*\{\s*display:\s*none\s*!important/)
  assert.match(html, /\.l10n-name\.open > \.l10n-original\s*\{\s*display:\s*block\s*!important/)
  for (const selector of [
    '.mod-ji .row .nm',
    '.mod-bi .erow .nm',
    '.mod-du .mrow .nm',
  ]) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    assert.match(html, new RegExp(`${escaped} > span\\s*\\{[^}]*color:\\s*var\\(--dim\\)`))
    assert.doesNotMatch(html, new RegExp(`${escaped} span\\s*\\{`))
  }
})
