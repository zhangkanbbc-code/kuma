import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import {
  isAbyssAnnotation,
  splitAbyssalDisplayLabel,
} from '../src/shared/abyssal-label.ts'

// 译名查找（renderer/localization.ts 的 localizedLinkLabel）本来是全名等值比对，
// 敌舰标注只要拖着 `flagship`/`艦載機赤`/`(陸爆中)` 这类形态标注就整条落空——
// 实测两个矿脉包 21350 个敌舰位里 9440 位（44%）栽在这上面，而译名一条都不缺。
// 2026-08-25 改成「基名命中 + 标注原样保留」，判定逻辑落在 shared/abyssal-label，
// 这份护栏拿两个包的**真实标注**全量过一遍。

const lode = (name) =>
  JSON.parse(fs.readFileSync(new URL(`../assets/lodes/${name}`, import.meta.url), 'utf8'))

// localization.ts 的 comparable()：两边判定必须同一套，各写一份必然漂移
const comparable = (value) =>
  `${value ?? ''}`
    .trim()
    .normalize('NFKC')
    .replace(/[（）]/g, (char) => (char === '（' ? '(' : ')'))
    .replace(/\s+/g, '')
    .toLowerCase()

const ABYSS = lode('kcwiki-localization.json').data.entities.abyssShip

// ---------------------------------------------------------------- 词表本身

test('形态标注词表:两个包里实见的每一种组合都认得', () => {
  // 下面每一条都出自 map-enemy-comps / map-intel 的真实标注，不是编的
  for (const form of [
    'elite',
    'flagship',
    'elite 艦載機鳥白',
    'flagship 艦載機赤',
    'flagship 艦載機白赤',
    'flagship 艦載機鳥黒',
    'elite 艦載機黒',
    'flagship(艦載機白)',
    'flagship(B)(艦載機白)',
    'elite(B)(艦載機白)',
    'elite (A) 弱',
    'elite (C) 強',
    'elite (B) 中',
    '(陸爆弱)',
    '(陸爆中)',
    '(陸爆強)',
    '(空襲)(F)',
    '(偵察)(A)',
    '(前哨戦 強)',
    '(最終形態 弱)',
    '最終形態',
    '前哨戦',
    '(艦載機白)',
    'A',
    '(E)',
  ]) {
    assert.ok(isAbyssAnnotation(form), `实见标注「${form}」没被认出来`)
    assert.ok(isAbyssAnnotation(` ${form}`), `带前导空格的「${form}」没被认出来`)
  }
  assert.ok(isAbyssAnnotation(''), '空尾巴要算标注（整名命中的情形）')
})

test('形态标注词表:名字的一部分绝不许被当标注剥掉', () => {
  // 剥错一个字就是在战斗界面上对着玩家说错敌人是谁——「駆逐イ級後期型」不是「駆逐イ級」
  for (const notAnnotation of ['後期型', '改', 'バカンスmode', '級', '棲姫', '夏姫', '-壊']) {
    assert.ok(!isAbyssAnnotation(notAnnotation), `「${notAnnotation}」被误判成形态标注了`)
  }
})

// ---------------------------------------------------------------- 切分出口

test('切分:基名命中,标注原样留在后面', () => {
  const known = (text) => text === '軽母ヌ級改'
  assert.deepEqual(splitAbyssalDisplayLabel('軽母ヌ級改 flagship 艦載機赤', known), {
    head: '',
    base: '軽母ヌ級改',
    tail: ' flagship 艦載機赤',
  })
  // 基名与标注之间的空格归标注那半——切完要能原样拼回去，中文名不许跟 flagship 挤一坨
  const parts = splitAbyssalDisplayLabel('軽母ヌ級改 flagship 艦載機赤', known)
  assert.equal(parts.head + parts.base + parts.tail, '軽母ヌ級改 flagship 艦載機赤')
})

test('切分:开头的 (後衛) 是站位说明,也原样保留', () => {
  const known = (text) => text === '軽母ヌ級'
  const parts = splitAbyssalDisplayLabel('(後衛)軽母ヌ級elite(E)(艦載機白弱)', known)
  assert.deepEqual(parts, { head: '(後衛)', base: '軽母ヌ級', tail: 'elite(E)(艦載機白弱)' })
  assert.equal(parts.head + parts.base + parts.tail, '(後衛)軽母ヌ級elite(E)(艦載機白弱)')
})

test('切分:基名从长到短试,不许在短基名上提前收工', () => {
  // 「軽母ヌ級改」与「軽母ヌ級」是两艘不同的舰。要是从短往长试，`改` 会被当标注剥掉
  const known = (text) => text === '軽母ヌ級' || text === '軽母ヌ級改'
  assert.equal(splitAbyssalDisplayLabel('軽母ヌ級改elite', known).base, '軽母ヌ級改')
  assert.equal(splitAbyssalDisplayLabel('軽母ヌ級elite', known).base, '軽母ヌ級')
})

test('切分:基名不认识就整条不认,不硬切', () => {
  const known = (text) => text === '軽母ヌ級'
  assert.equal(splitAbyssalDisplayLabel('深海不存在姫elite', known), null)
  // 尾巴认不出来也整条不认：宁可继续露日文提醒补词表
  assert.equal(splitAbyssalDisplayLabel('軽母ヌ級 謎の形態', known), null)
  assert.equal(splitAbyssalDisplayLabel('', known), null)
})

// ---------------------------------------------------------------- 护栏：真实矿脉全量过一遍
//
// 收集器认两种形状：map-enemy-comps 是 { ships:[id], labels:[标注] }，
// map-intel 的 enemyComps 是 { ships:[标注], shipIds:[id] }。

const collect = (node, out) => {
  if (Array.isArray(node)) {
    for (const item of node) collect(item, out)
    return
  }
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node.ships) && Array.isArray(node.labels)) {
    for (let i = 0; i < node.labels.length; i++)
      if (typeof node.labels[i] === 'string' && node.labels[i]) out.push([node.ships[i], node.labels[i]])
  } else if (Array.isArray(node.ships) && Array.isArray(node.shipIds)) {
    for (let i = 0; i < node.ships.length; i++)
      if (typeof node.ships[i] === 'string' && node.ships[i]) out.push([node.shipIds[i], node.ships[i]])
  }
  for (const value of Object.values(node)) collect(value, out)
}

/** localizedLinkLabel 的判定：先全名等值，再「基名 + 标注」。 */
const resolves = (id, label) => {
  const entry = ABYSS[`${id}`]
  if (!entry) return { hit: false, exact: false }
  const target = [comparable(entry.ja), comparable(entry.zh)].filter(Boolean)
  if (target.includes(comparable(label))) return { hit: true, exact: true }
  const parts = splitAbyssalDisplayLabel(label, (base) => target.includes(comparable(base)))
  return { hit: parts != null, exact: false }
}

const positionsOf = (file) => {
  const out = []
  const data = lode(file)
  collect(data.data ?? data, out)
  return out
}

// `map-intel` 不随仓库分发（上游 NOASSERTION，见 .gitignore 的白名单块），
// 克隆下来的树里本来就没有它。缺包时**跳过**而不是红——判据落在包在不在，
// 维护者机器上包齐，这些护栏照跑全量，一格覆盖都不少。
const missingPacks = (...names) =>
  names.filter((name) => !fs.existsSync(new URL(`../assets/lodes/${name}`, import.meta.url)))
const skipMissing = (...names) => {
  const missing = missingPacks(...names)
  return missing.length ? `缺矿脉包：${missing.join(' / ')}（npm run lodes:fetch）` : false
}

// 2026-08-25 实测的命中率：改之前 = 只算 exact 那一列。
//   map-enemy-comps 6660 位：3485 → 6660（47.7% 落空 → 0）
//   map-intel      14690 位：8425 → 14600（42.6% 落空 → 0.6%）
// map-intel 仍落空的 90 位是同一族：词条名自带 `バカンスmode`（如 1805
// `潜水新棲姫 バカンスmode`），而包里的标注只写了基名——**是词条比标注长**，
// 不是标注带了标注。这一族属「基名真的对不上词条」，如实保原文，不硬凑。
const EXPECTED = {
  'map-enemy-comps.json': { positions: 6660, exactBefore: 3485, maxMiss: 0 },
  'map-intel.json': { positions: 14690, exactBefore: 8425, maxMiss: 90 },
}

for (const [file, expected] of Object.entries(EXPECTED)) {
  test(`后缀容忍护栏:${file} 的真实敌舰位命中率`, { skip: skipMissing(file) }, () => {
    const positions = positionsOf(file)
    assert.equal(positions.length, expected.positions, '敌舰位数变了——收集器或包结构动过了')
    let exact = 0
    let hit = 0
    const stillMissing = new Map()
    for (const [id, label] of positions) {
      const result = resolves(id, label)
      if (result.exact) exact++
      if (result.hit) hit++
      else stillMissing.set(`${id}|${label}`, (stillMissing.get(`${id}|${label}`) ?? 0) + 1)
    }
    assert.equal(exact, expected.exactBefore, '全名等值那条腿的命中数变了——译名包更新过？')
    const missed = positions.length - hit
    assert.ok(
      missed <= expected.maxMiss,
      `仍落空 ${missed} 位（上限 ${expected.maxMiss}）：${[...stillMissing.keys()].slice(0, 5).join(' / ')}`,
    )
    // 改善必须是**显著**的，不是聊胜于无
    assert.ok(hit - exact > positions.length * 0.3, `后缀容忍只多救回 ${hit - exact} 位，不该这么少`)
  })
}

test('后缀容忍护栏:仍落空的那一族是词条比标注长,不是漏词表', {
  skip: skipMissing(...Object.keys(EXPECTED)),
}, () => {
  const stillMissing = new Set()
  for (const file of Object.keys(EXPECTED)) {
    for (const [id, label] of positionsOf(file)) {
      if (!resolves(id, label).hit) stillMissing.add(`${id}|${label}`)
    }
  }
  assert.equal(stillMissing.size, 13, '仍落空的条目数变了')
  for (const key of stillMissing) {
    const [id, label] = key.split('|')
    const entry = ABYSS[id]
    assert.ok(entry, `${key} 连词条都没有——那是另一种毛病`)
    // 判据：词条名以标注开头（词条多出 ` バカンスmode` 这一截），反过来才是漏词表
    assert.ok(
      comparable(entry.ja).startsWith(comparable(label)),
      `${key} 落空的原因不是「词条比标注长」（ja=${entry.ja}），去查是不是漏了形态标注`,
    )
  }
})

// ---------------------------------------------------------------- 渲染层：跑真的 localizedLinkLabel
//
// 上面测的是切分出口，这一段测**渲染层真正调用的那个函数**：把真的
// renderer/localization.ts 连同真的译名包一起编出来跑。两者都要——
// 切分对了但渲染层没接上，界面照样是日文，而只测切分的护栏会一路绿着。

const require_ = createRequire(import.meta.url)
const { buildSync } = require_('esbuild')
const ROOT = path.join(fileURLToPath(import.meta.url), '..', '..')
const srcFile = (rel) => path.join(ROOT, 'src', rel)
const readSrc = (rel) => fs.readFileSync(srcFile(rel), 'utf8')
const read = (file) => fs.readFileSync(file, 'utf8')

const localization = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-l10n-'))
  const files = {
    'renderer/localization.ts': readSrc('renderer/localization.ts'),
    'shared/abyssal-label.ts': readSrc('shared/abyssal-label.ts'),
    // kernel 只给 localization 用到的两样：转义，以及矿脉包读取（指向仓库里的真包）
    'renderer/kernel.ts': [
      'export const esc = (value: unknown): string =>',
      "  `${value ?? ''}`.replaceAll('&', '&amp;').replaceAll('<', '&lt;')",
      '    .replaceAll(\'>\', \'&gt;\').replaceAll(\'"\', \'&quot;\').replaceAll("\'", \'&#39;\')',
      'export const queryLode = async (id: string): Promise<any> =>',
      '  (globalThis as any).__lode(id)',
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
    entryPoints: [path.join(dir, 'renderer/localization.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  })
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', read(outfile))(require_, mod, mod.exports, outfile)
  return mod.exports
})()

// initLocalization 装了一个全局折叠钮监听；给它一个够用的 document
globalThis.document ??= { addEventListener: () => {} }
globalThis.__lode = (id) => {
  const file = { 'kcwiki-localization': 'kcwiki-localization.json', 'quests-scn': 'quests-scn.json',
    'kcwiki-expedition': 'kcwiki-expedition.json' }[id]
  return file ? lode(file) : null
}

test('渲染层护栏:localizedLinkLabel 跑真包,敌舰位命中率与切分出口一致', {
  skip: skipMissing(...Object.keys(EXPECTED)),
}, async () => {
  await localization.initLocalization()
  // 先确认包真的装进去了，否则下面全是「查不到→保原文」的假绿
  assert.equal(localization.localizedLinkLabel('abyssShip', 1501, '駆逐イ級'), '驱逐I级')

  let hit = 0
  let total = 0
  const stillJa = new Set()
  for (const file of Object.keys(EXPECTED)) {
    for (const [id, label] of positionsOf(file)) {
      total++
      const out = localization.localizedLinkLabel('abyssShip', id, label)
      if (out == null) {
        stillJa.add(`${id}|${label}`)
        continue
      }
      hit++
      // 形态标注必须**原样**还在：丢了就分不清 elite 和 flagship 是两拨敌人
      const parts = splitAbyssalDisplayLabel(label, (base) => {
        const entry = ABYSS[`${id}`]
        return [comparable(entry.ja), comparable(entry.zh)].includes(comparable(base))
      })
      if (parts?.tail.trim()) {
        assert.ok(out.endsWith(parts.tail), `「${label}」的形态标注被吃掉了：${out}`)
      }
    }
  }
  assert.equal(total, 21_350, '敌舰位数变了')
  assert.equal(stillJa.size, 13, '仍落空的条目数与切分出口那边对不上')
  assert.ok(hit / total > 0.99, `渲染层命中率只有 ${((hit / total) * 100).toFixed(1)}%`)
})

test('渲染层护栏:动作文字与别的域不许被形态词表误伤', async () => {
  await localization.initLocalization()
  // 后缀容忍**只对 abyssShip 域开**：别的域照旧全名等值，一个字都不许多认
  assert.equal(localization.localizedLinkLabel('map', 11, '1-1'), null)
  assert.equal(localization.localizedLinkLabel('abyssShip', 1501, '图鉴 →'), null)
  // 「駆逐イ級後期型」是另一艘舰，`後期型` 绝不是标注
  assert.equal(localization.localizedLinkLabel('abyssShip', 1501, '駆逐イ級後期型'), null)
  // 认得的标注要接住，且中文名在前、标注原样在后
  assert.equal(localization.localizedLinkLabel('abyssShip', 1501, '駆逐イ級elite'), '驱逐I级elite')
})

// ---------------------------------------------------------------- 等级不许说两遍
//
// kcwiki 的深海舰中文名把等级写进名字里（1528 的 zh 是 `空母WO级flagship`），日文名
// 取自主数据、只有基名——译名包里 74 条是这个形状。目录行喂进来的标注本来就自带
// `flagship` 这一截，基名命中的是日文那半，于是中文名与标注一拼就成了
// 「空母WO级flagshipflagship」（2026-08-26 用户截图报出，同卡上方「你的实测」正常）。
//
// 这一族护栏两头都钉死：连拼一处都不许有，而**该带的那次也一个字都不许省**。
// 只钉前半条的话，「把等级从译名包里删掉」这种改法能骗过护栏，代价是「你的实测」
// 那条腿再也分不出 elite 和 flagship 是两拨敌人。

/** 上屏文本：窄格默认单语，但仍按标签剥一层，免得日后加了包装就漏检。 */
const shown = (html) => `${html ?? ''}`.replace(/<[^>]*>/g, '')

const RANK_SAID_TWICE = /(flagship|elite)\s*\1/i

test('等级不许说两遍:用户报出的那两格', async () => {
  await localization.initLocalization()
  // 截图里的原样：空母WO级flagshipflagship / 重巡RI级flagshipflagship
  assert.equal(localization.localizedLinkLabel('abyssShip', 1528, '空母ヲ級flagship'), '空母WO级flagship')
  assert.equal(localization.localizedLinkLabel('abyssShip', 1527, '重巡リ級flagship'), '重巡RI级flagship')
  // 纯文本版（title / 读屏）与链接版同一判据，不许一处修好一处照旧
  assert.equal(localization.localizedLabelText('abyssShip', 1528, '空母ヲ級flagship'), '空母WO级flagship')
})

test('等级不许说两遍:真包 21350 个敌舰位全量零连拼', {
  skip: skipMissing(...Object.keys(EXPECTED)),
}, async () => {
  await localization.initLocalization()
  const offenders = new Map()
  let positions = 0
  for (const file of Object.keys(EXPECTED)) {
    for (const [id, label] of positionsOf(file)) {
      positions++
      const out = shown(localization.localizedLinkLabel('abyssShip', id, label))
      if (!out) continue
      if (RANK_SAID_TWICE.test(out)) offenders.set(`${id}|${label}|${out}`, true)
      // 纯文本那条腿同样过一遍
      const plain = localization.localizedLabelText('abyssShip', id, label)
      if (RANK_SAID_TWICE.test(plain)) offenders.set(`纯文本 ${id}|${label}|${plain}`, true)
    }
  }
  assert.equal(positions, 21_350, '敌舰位数变了')
  assert.equal(
    offenders.size,
    0,
    `等级说了两遍的条目 ${offenders.size} 种：${[...offenders.keys()].slice(0, 5).join(' / ')}`,
  )
})

test('等级不许说两遍:标注没写等级时,名字这半照旧带着', async () => {
  await localization.initLocalization()
  // 「你的实测」那条腿喂的是主数据裸名（enemyName 取 mg.master.ships[id].name），
  // 标注一个字都没有——这时中文名里的等级是玩家能看到的唯一形态信息。
  // 去重要是做成「无脑砍掉译名里的等级」，下面三条会当场变红。
  assert.equal(localization.localizedLinkLabel('abyssShip', 1528, '空母ヲ級'), '空母WO级flagship')
  assert.equal(localization.localizedLinkLabel('abyssShip', 1527, '重巡リ級'), '重巡RI级flagship')
  assert.equal(localization.localizedLinkLabel('abyssShip', 1525, '空母ヲ級'), '空母WO级elite')
  // 同一个基名的 elite 与 flagship 是两拨敌人，去重之后仍要分得开
  assert.notEqual(
    localization.localizedLinkLabel('abyssShip', 1525, '空母ヲ級'),
    localization.localizedLinkLabel('abyssShip', 1528, '空母ヲ級'),
  )
})

test('等级不许说两遍:只吃等级那一截,别的标注原样不动', async () => {
  await localization.initLocalization()
  // 「艦載機白」这类标注保留不动（本次修缮的明文边界）
  assert.equal(
    localization.localizedLinkLabel('abyssShip', 1579, '空母ヲ級flagship 艦載機白'),
    '空母WO级flagship 艦載機白',
  )
  assert.equal(
    localization.localizedLinkLabel('abyssShip', 1523, '軽母ヌ級elite(艦載機白)'),
    '轻母NU级elite(艦載機白)',
  )
  // 基名带「改」的那一族：等级去掉一次，改字纹丝不动
  assert.equal(
    localization.localizedLinkLabel('abyssShip', 1565, '空母ヲ級改flagship'),
    '空母WO级改flagship',
  )
  // 词条本身不带等级时（1501 的 zh 是「驱逐I级」），标注照旧原样接上
  assert.equal(localization.localizedLinkLabel('abyssShip', 1501, '駆逐イ級elite'), '驱逐I级elite')
})

test('等级不许说两遍:等级对不上时不硬凑,矛盾照原样露出来', {
  skip: skipMissing(...Object.keys(EXPECTED)),
}, async () => {
  await localization.initLocalization()
  // 1528 的词条是 flagship，标注却写 elite——这是定号定错了。
  // 去重只认「同一个等级」，对不上就两截都留着，让矛盾看得见而不是被抹平。
  assert.equal(
    localization.localizedLinkLabel('abyssShip', 1528, '空母ヲ級elite'),
    '空母WO级flagshipelite',
  )
  // 真包里这种位一个都没有；有了就是定号出了事，该在这里绊一跤
  const crossed = new Set()
  for (const file of Object.keys(EXPECTED)) {
    for (const [id, label] of positionsOf(file)) {
      const entry = ABYSS[`${id}`]
      if (!entry) continue
      const inLabel = label.match(/(flagship|elite)/i)?.[1]?.toLowerCase()
      const inEntry = (entry.zh ?? '').match(/(flagship|elite)$/i)?.[1]?.toLowerCase()
      if (inLabel && inEntry && inLabel !== inEntry) crossed.add(`${id}|${label}|zh=${entry.zh}`)
    }
  }
  assert.equal(crossed.size, 0, `标注等级与词条等级对不上：${[...crossed].slice(0, 5).join(' / ')}`)
})
