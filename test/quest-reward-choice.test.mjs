// 任务奖励区的「选一」解析（2026-08-28 用户截图：B95 的固定奖励区碎成了
// 「从下列奖励中选择:「」「」「强风改×1」「」…」一串残渣）。
//
// 病灶有两层：
//   ① 任务库写「选一」有三种写法，解析只认「以下奖励N选一」一种。另两种
//      （「从下列奖励中选择：」在前、「以上二者选择其一」在**后**）整段落进
//      固定奖励，提示语和落单的引号被完备性兜底当成认不出的奖励补成了芯片；
//   ② 兜底出来的原文没人收拾：只剩引号的残渣照样成芯片（那个空芯片），
//      名字两头的引号也照样带着。
//
// 这份护栏钉的是**面板上摆出来的东西**：几组、每组几项、每项是哪件东西、
// 数量多少、有没有空芯片。解析住在 shared/quest-reward（纯文本 + 注入的名字表），
// 渲染仍在钦——这里连真任务库与真译名表一起跑，避免拿自己编的串自证。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { buildSync } from 'esbuild'

import reward from '../dist/shared/quest-reward.js'
import upgrade from '../dist/shared/kcwiki-upgrade.js'
import useitemStock from '../dist/shared/useitem-stock.js'

const {
  parseQuestRewardItems,
  questFixedRewardText,
  questRewardChoiceGroups,
  splitQuestReward,
} = reward

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const readLode = (id) => {
  const file = path.join(root, 'assets', 'lodes', `${id}.json`)
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).data : null
}
const quests = readLode('quests-scn')
const l10n = readLode('kcwiki-localization')

// 归一化住在渲染层（索引也在那儿），单独编一份出来喂给解析
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-quest-reward-'))
const bundled = path.join(tempDir, 'task-entity-match.cjs')
buildSync({
  entryPoints: [fileURLToPath(new URL('../src/renderer/task-entity-match.ts', import.meta.url))],
  outfile: bundled,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'silent',
})
const { normalizeTaskEntityText: normalize } = createRequire(import.meta.url)(bundled)
test.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

const memoOf = (code) => {
  const hit = Object.values(quests).find((quest) => quest.code === code)
  assert.ok(hit, `任务库里没有 ${code}`)
  return hit.memo
}

// 运行时的实体索引来自 master（api_mst_slotitem/useitem）+ 译名表；离线用译名表
// 顶替：日文名与运行时的 api_name 同源，简中名就是 entityNamePlain 给出的那个。
const aliasById = (table) => {
  const map = new Map()
  for (const [cn, id] of Object.entries(table)) {
    const list = map.get(id)
    if (list) list.push(cn)
    else map.set(id, [cn])
  }
  return map
}
const aliases = (entry, extra) =>
  [...new Set([entry.ja, entry.zh || entry.ja, ...extra].map(normalize).filter(Boolean))]
    .sort((left, right) => right.length - left.length)

const context = () => {
  const equipExtra = aliasById(upgrade.KCWIKI_EQUIP_ALIAS)
  const itemExtra = aliasById(upgrade.KCWIKI_ITEM_ALIAS)
  return {
    equips: Object.entries(l10n.entities.equip).map(([id, entry]) => ({
      id: Number(id),
      name: entry.ja,
      aliases: aliases(entry, equipExtra.get(Number(id)) ?? []),
      stock: 0,
    })),
    useitems: Object.entries(l10n.entities.item)
      .filter(([id]) => !useitemStock.isResourceMirrorUseitem(Number(id)))
      .map(([id, entry]) => ({
        id: Number(id),
        name: entry.ja,
        aliases: aliases(entry, itemExtra.get(Number(id)) ?? []),
        stock: 0,
      })),
    materialStock: () => 0,
    normalize,
  }
}

/** 芯片的可读形态，与 rewardCandidateHtml 一一对应（种类:id:名称★+星×数量） */
const chip = (item) =>
  item.kind === 'raw'
    ? `raw「${item.name}」`
    : `${item.kind}:${item.id}:${item.name}${item.star ? `★+${item.star}` : ''}×${item.amount}`

const skip = { skip: quests && l10n ? false : '缺 quests-scn / kcwiki-localization，跳过' }

/** 开引号 → 闭引号 / 闭引号 → 开引号，判「这个引号有没有对手」用 */
const OPENERS = { '「': '」', '『': '』', '（': '）', '(': ')', '【': '】', '[': ']', '“': '”' }
const CLOSERS = Object.fromEntries(Object.entries(OPENERS).map(([open, close]) => [close, open]))

// ---- 切段：三种写法，选项在标记的哪一侧不一样 ----

test('「以下奖励N选一」：选项在标记之后，项数自报', skip, () => {
  const split = splitQuestReward(memoOf('B216'))
  assert.deepEqual(split.fixedParts, [])
  assert.equal(split.groups.length, 2)
  assert.deepEqual(split.groups.map((group) => group.declared), [3, 3])
  assert.ok(split.groups[0].text.startsWith('補強增設×1'))
})

test('「从下列奖励中选择」：选项在标记之后，项数没自报', skip, () => {
  const split = splitQuestReward(memoOf('B95'))
  // 提示语本身不许留在任何一段里——它进了固定段就会被当成一项奖励摆出来
  assert.deepEqual(split.fixedParts, ['改修资材×4'])
  assert.equal(split.groups.length, 1)
  assert.equal(split.groups[0].declared, 0)
  assert.equal(split.groups[0].text, '「强风改」  「舰本新设计 增设装甲板(中型舰)」')
})

test('「以上二者选择其一」：选项在标记之**前**，后面那截才是固定奖励', skip, () => {
  const split = splitQuestReward(memoOf('B101'))
  assert.deepEqual(split.fixedParts, ['改修资材×4'])
  assert.equal(split.groups.length, 1)
  assert.equal(split.groups[0].declared, 3)
  assert.equal(split.groups[0].text, '勋章×1 新型火炮兵装资材×1 「零式舰战63型(爆战)」×1')
})

test('没有选一的任务：整串还是固定奖励，一个字不动', skip, () => {
  for (const code of ['A1', 'B96', 'B31']) {
    const memo = memoOf(code)
    const split = splitQuestReward(memo)
    assert.deepEqual(split.groups, [], code)
    assert.equal(split.fixedParts.join(' / '), memo.replace(/^奖励[:：]?\s*/, '').trim(), code)
    assert.equal(questFixedRewardText(memo), memo.replace(/^奖励[:：]?\s*/, '').trim(), code)
  }
})

// ---- 面板上摆出来的东西 ----

const sections = (code, ctx) => {
  const memo = memoOf(code)
  return {
    fixed: parseQuestRewardItems(questFixedRewardText(memo), 0, ctx)
      .filter((item) => item.kind !== 'material')
      .map(chip),
    groups: questRewardChoiceGroups(memo, ctx).map((group) => group.map(chip)),
  }
}

test('B95 用户报的那条：固定一项 + 两个选项各成完整芯片，没有碎片', skip, () => {
  const ctx = context()
  assert.deepEqual(sections('B95', ctx), {
    fixed: ['useitem:4:改修資材×4'],
    groups: [['equip:217:強風改×1', 'equip:203:艦本新設計 増設バルジ(中型艦)×1']],
  })
})

test('另两种写法的选一，同样各成完整芯片', skip, () => {
  const ctx = context()
  // 「从下列奖励中选择」三项版
  assert.deepEqual(sections('B109', ctx), {
    fixed: ['useitem:4:改修資材×4'],
    groups: [[
      'equip:266:12.7cm連装砲C型改二×1',
      'equip:68:大発動艇×1',
      'equip:28:22号対水上電探×2',
    ]],
  })
  // 「以上二者选择其一」：选项在前、固定奖励在后
  assert.deepEqual(sections('F54', ctx), {
    fixed: ['useitem:3:開発資材×2'],
    groups: [['useitem:57:勲章×1', 'useitem:75:新型砲熕兵装資材×1']],
  })
})

test('星级数字不许把邻项名字的开头吞掉', skip, () => {
  // B161 第二组：「…Mk.30改★+4」后面紧跟「22号对水上电探改四」，
  // ★ 曾读成 +422，跨度盖住那个 22，把整条 22 号电探挤出了面板
  const [, second] = sections('B161', context()).groups
  assert.deepEqual(second, [
    'equip:313:5inch単装砲 Mk.30改★+4×1',
    'equip:240:22号対水上電探改四(後期調整型)★+4×1',
    'equip:286:61cm四連装(酸素)魚雷後期型★+4×1',
  ])
})

test('数量只算自家的：不抢邻项的，也不吞邻项名字开头的数字', skip, () => {
  const ctx = context()
  // Bq8「熟练瞭望员 熟练搭乘员 洋上补给×4」：前两项各 ×1，×4 只属于洋上补给
  //（2026-08-12 之前在名字后 24 字符窗口里乱捞，前两项都被标成 ×4）
  assert.deepEqual(sections('Bq8', ctx).groups, [[
    'equip:129:熟練見張員×1',
    'useitem:70:熟練搭乗員×1',
    'equip:146:洋上補給×4',
  ]])
  // B143「高速修复材×6 25mm三连装机枪×2」：归一化抹掉空白后是「×625mm…」，
  // ×6 曾把邻项口径的 25 吞成 ×625，还剩一块「mm三连装机铳」残渣
  assert.deepEqual(sections('B143', ctx).groups[0], [
    'equip:146:洋上補給×2',
    'useitem:1:高速修復材×6',
    'equip:40:25mm三連装機銃×2',
  ])
  // F142「「二式爆雷」★+4×1」：星级夹在名字与 ×N 之间，两个数都要读对
  assert.deepEqual(sections('F142', ctx).groups[0][1], 'equip:227:二式爆雷★+4×1')
})

test('固定奖励两项连写：不许在中间挤出一个空芯片', skip, () => {
  assert.deepEqual(sections('B96', context()).fixed, [
    'equip:219:零式艦戦63型(爆戦)×1',
    'equip:220:8cm高角砲改+増設機銃×1',
  ])
})

test('照原文兜底的项：不留空芯片、不留裸引号、提示语不算奖励', skip, () => {
  const ctx = context()
  const bad = []
  for (const quest of Object.values(quests)) {
    const memo = quest.memo ?? ''
    const items = [
      ...parseQuestRewardItems(questFixedRewardText(memo), 0, ctx),
      ...questRewardChoiceGroups(memo, ctx).flat(),
    ]
    for (const item of items) {
      if (item.kind !== 'raw') continue
      const naked = item.name.replace(/[「」『』（）()【】[\]"“”'’:：、，,;；。．・…\-—+*×x\s]/gi, '')
      if (naked.length < 2) bad.push(`${quest.code} 空芯片 ${JSON.stringify(item.name)}`)
      // 落单的引号才算裸引号：名字**里面**成对的引号（「明石的改修工厂」开启）是正文
      const first = item.name[0]
      const last = item.name[item.name.length - 1]
      const dangling =
        CLOSERS[first] || OPENERS[last] ||
        (OPENERS[first] && !item.name.slice(1).includes(OPENERS[first])) ||
        (CLOSERS[last] && !item.name.slice(0, -1).includes(CLOSERS[last]))
      if (dangling) bad.push(`${quest.code} 裸引号 ${JSON.stringify(item.name)}`)
      if (/选一|选择其一|从下列奖励中选择/.test(item.name)) {
        bad.push(`${quest.code} 提示语当成了奖励 ${JSON.stringify(item.name)}`)
      }
    }
  }
  assert.deepEqual(bad, [])
})

test('同一件东西写两遍，仍然只算一项（数量取写着的那处）', skip, () => {
  const ctx = context()
  // A83「战斗粮食（特别饭团）「战斗粮食(特制饭团)」×2」是一项，不是两项；
  // 落点若挪到后一处，前一处会被短名「战斗粮食」再抠出一项来，二选一列出三项
  assert.deepEqual(sections('A83', ctx).groups, [[
    'useitem:52:特注家具職人×1',
    'equip:241:戦闘糧食(特別なおにぎり)×2',
  ]])
  // Bq5 同病：「12.7cm连装炮C型改二「12.7cm连装炮C型改二」★3×1」曾额外冒出 12.7cm连装炮
  assert.deepEqual(sections('Bq5', ctx).groups, [[
    'equip:266:12.7cm連装砲C型改二★+3×1',
    'useitem:52:特注家具職人×1',
    'useitem:57:勲章×1',
  ]])
})

test('自报几项就该摆出几项：全库没有哪一组比自报的少', skip, () => {
  const ctx = context()
  const short = []
  for (const quest of Object.values(quests)) {
    const split = splitQuestReward(quest.memo ?? '')
    split.groups.forEach((group, index) => {
      if (!group.declared) return
      const items = parseQuestRewardItems(group.text, group.declared, ctx)
      if (items.length < group.declared) {
        short.push(`${quest.code} 第${index + 1}组 自报${group.declared} 实得${items.length}`)
      }
    })
  }
  assert.deepEqual(short, [])
})

test('没有选一的普通任务，奖励区还是老样子（对照）', skip, () => {
  const ctx = context()
  assert.deepEqual(sections('B32', ctx), {
    fixed: ['useitem:3:開発資材×2', 'equip:116:一式徹甲弾×1'],
    groups: [],
  })
  assert.deepEqual(sections('C77', ctx), {
    fixed: [],
    groups: [
      ['equip:328:35.6cm連装砲改×1', 'useitem:75:新型砲熕兵装資材×2', 'useitem:3:開発資材×30'],
      // 同一件装备的两个不同改修档，第二项对不上就照原文摆着——不许无声吞掉
      ['equip:328:35.6cm連装砲改×2', 'raw「35.6cm连装炮改★+6×1」', 'useitem:58:改装設計図×1'],
    ],
  })
})
