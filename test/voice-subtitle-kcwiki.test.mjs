// kcwiki-voice 接进实时字幕的查表序列（2026-08-25）。
//
// ---- 病灶 ----
// 发行版里 `wikiwiki-voice` 不随包（lode-sources 里 bundle:false，无许可声明），
// 于是字幕层那条 wikiwiki 分支在玩家机上是**死代码**——实际只剩 subtitle-zh/ja
// 一个源。而主来源 `kcwiki-voice` 早就随包（CC BY-NC-SA、NOTICE 在册）、
// loadData 里也早就在查它（为算季节闸），只是没接进查表。
//
// ---- 家法：补空不覆盖，且 kcwiki 不参与选形态 ----
// 跨形态那道老闸不动（「整份资料都不存在才沿链往前走」，防的是新旧台词混拼）；
// 源间补缺不违反它。但 kcwiki **不许**算进「本形态有源」——否则重演 2026-08-23
// 拆掉的「小桶挡整页」：早霜改二自己只有 7 行 kcwiki、没有 subtitle 表，
// 而 早霜改 有整整 52 格，让它在自己这一层停下就从 52 格掉回 7 格。
//
// 这份护栏全部**真跑** shipCaption（切片编译，见 fixtures/render-ship-caption.mjs），
// 不断言源码文本——查表顺序写反、补空写成覆盖，正则一条也拦不住。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { captionOf, textOf } from './fixtures/render-ship-caption.mjs'

const chain = (...ids) => new Map([[ids[0], ids]])
const simplifierPack = JSON.parse(
  fs.readFileSync(new URL('../assets/lodes/opencc-t2s.json', import.meta.url), 'utf8'),
)

// ---- ① 补空不覆盖 ----

test('同一格 subtitle 有值时，kcwiki 一个字都不许顶上去', () => {
  const text = textOf(
    {
      voiceFallbackOf: chain(100),
      subtitleZh: { 100: { 2: '音轨转写的那一句' } },
      kcwikiBySlot: new Map([[100, new Map([[2, { zh: 'kcwiki 的那一句', ja: '' }]])]]),
    },
    100,
    2,
  )
  assert.equal(text, '音轨转写的那一句', 'kcwiki 覆盖了音轨转写——文本权威反了')
})

test('subtitle 中文栏照抄英文时按日文原文取 overlay，已有中文仍然优先', () => {
  const voiceOverlayZhByJa = new Map([['Openfire!', '开火！']])
  const setup = {
    voiceFallbackOf: chain(100),
    subtitleJa: { 100: { 2: ' Open fire! ', 3: 'Open fire!' } },
    subtitleZh: { 100: { 2: 'Open fire!', 3: '已有中文' } },
    voiceOverlayZhByJa,
  }
  assert.equal(textOf(setup, 100, 2), '开火！')
  assert.equal(textOf(setup, 100, 3), '已有中文')
})

test('subtitle 缺这一格时 kcwiki 补上', () => {
  const setup = {
    voiceFallbackOf: chain(100),
    subtitleZh: { 100: { 2: '有的那一格' } },
    subtitleJa: { 100: { 2: 'あるほう' } },
    kcwikiBySlot: new Map([[100, new Map([[3, { zh: 'kcwiki 补的那一句', ja: '' }]])]]),
  }
  assert.equal(textOf(setup, 100, 2), '有的那一格')
  assert.equal(textOf(setup, 100, 3), 'kcwiki 补的那一句', 'subtitle 空着的格没被 kcwiki 补上')
})

test('subtitle 那一格写的是占位句时，也算空，kcwiki 顶上', () => {
  // 真包实测 259 格中文占位句，其中 125 格 kcwiki 有真台词可顶
  const text = textOf(
    {
      voiceFallbackOf: chain(100),
      subtitleZh: { 100: { 2: '本字幕暂时没有翻译 请到舰娘百科(https://zh.kcwiki.moe/)协助我们翻译' } },
      kcwikiBySlot: new Map([[100, new Map([[2, { zh: '真的那一句', ja: '' }]])]]),
    },
    100,
    2,
  )
  assert.equal(text, '真的那一句', '占位句挡住了 kcwiki 的真台词')
})

test('kcwiki 也是中文优先、日文兜底，且过标点体例归一', () => {
  const setup = {
    voiceFallbackOf: chain(100),
    kcwikiBySlot: new Map([
      [
        100,
        new Map([
          [2, { zh: '中文那句。', ja: '日本語のほう' }],
          [3, { zh: '', ja: '日本語だけ' }],
        ]),
      ],
    ]),
  }
  // 行尾句号按体例删掉（与图鉴台词卷同一份 normalizeVoiceText）
  assert.equal(textOf(setup, 100, 2), '中文那句', 'kcwiki 的中文没过标点体例归一')
  // 只有日文时照出日文，且**不过**归一（原文转写不是我们的翻译）
  assert.equal(textOf(setup, 100, 3), '日本語だけ')
})

test('繁体中文显示为简体，日文原文含艦隊与戦闘也一字不动', () => {
  const setup = {
    simplifierPack,
    voiceFallbackOf: chain(100),
    kcwikiBySlot: new Map([
      [
        100,
        new Map([
          [2, { zh: '艦隊已經準備好了。', ja: '艦隊は戦闘準備ができた。' }],
          [3, { zh: '', ja: '艦隊は戦闘準備ができた。' }],
        ]),
      ],
    ]),
  }
  assert.equal(textOf(setup, 100, 2), '舰队已经准备好了')
  assert.equal(textOf(setup, 100, 3), '艦隊は戦闘準備ができた。')
})

test('只有 wikiwiki 表的形态也优先显示 kcwiki 中文', () => {
  const text = textOf(
    {
      simplifierPack,
      voiceFallbackOf: chain(991),
      wikiwikiVoice: { 991: [{ voiceId: 5, ja: 'また賑やかになるね!' }] },
      kcwikiBySlot: new Map([
        [991, new Map([[5, { zh: '新船造好了！正好熱熱鬧鬧的。', ja: '' }]])],
      ]),
    },
    991,
    5,
  )
  assert.equal(text, '新船造好了！正好热热闹闹的')
})

test('只有 wikiwiki 表时 kcwiki 的日文不许顶掉 wikiwiki 转写', () => {
  const text = textOf(
    {
      voiceFallbackOf: chain(991),
      wikiwikiVoice: { 991: [{ voiceId: 5, ja: 'wikiwiki の原文' }] },
      kcwikiBySlot: new Map([
        [991, new Map([[5, { zh: '', ja: 'kcwiki の原文' }]])],
      ]),
    },
    991,
    5,
  )
  assert.equal(text, 'wikiwiki の原文')
})

// ---- ② 小桶不许挡整页（这条是整批最容易写错的地方）----

test('kcwiki 小桶不许挤掉前置形态那张整表', () => {
  // 早霜改二（956）自己只有 7 行 kcwiki、没有 subtitle 表；早霜改（324）有整表。
  // 把 kcwiki 算进「本形态有源」就会在 956 停下，52 格掉回 7 格。
  const setup = {
    voiceFallbackOf: chain(956, 324),
    subtitleZh: { 324: { 2: '早霜改的秘书舰1', 5: '早霜改的建造完成' } },
    kcwikiBySlot: new Map([[956, new Map([[2, { zh: '早霜改二的秘书舰1', ja: '' }]])]]),
  }
  // 前置形态有整表 → 选它；kcwiki 小桶不参与选形态
  assert.equal(textOf(setup, 956, 2), '早霜改的秘书舰1', '小桶挡整页回潮了')
  assert.equal(
    textOf(setup, 956, 5),
    '早霜改的建造完成',
    '选形态被小桶带偏，前置整表里的其余格全丢了',
  )
})

test('全链一份 subtitle/wikiwiki 表都没有时，kcwiki 单独扛起这个形态', () => {
  // 新实装那批舰就落在这里——从前她们一个字都没有
  const text = textOf(
    {
      voiceFallbackOf: chain(1025),
      kcwikiBySlot: new Map([[1025, new Map([[2, { zh: '新舰的秘书舰1', ja: '' }]])]]),
    },
    1025,
    2,
  )
  assert.equal(text, '新舰的秘书舰1', '新实装的舰还是一个字都没有')
})

test('沿链找 kcwiki 时也是就近优先', () => {
  const text = textOf(
    {
      voiceFallbackOf: chain(200, 100),
      kcwikiBySlot: new Map([
        [200, new Map([[2, { zh: '改二的那句', ja: '' }]])],
        [100, new Map([[2, { zh: '基础形态的那句', ja: '' }]])],
      ]),
    },
    200,
    2,
  )
  assert.equal(text, '改二的那句')
})

test('跨形态混拼那道老闸没被拆掉', () => {
  // 本形态有 subtitle 表但这一格空、kcwiki 也没有 → 就是没有，
  // **不许**再往前置形态借这一格（借了就是新旧台词混拼）
  const text = textOf(
    {
      voiceFallbackOf: chain(200, 100),
      subtitleZh: { 200: { 5: '改二有的那格' }, 100: { 2: '基础形态的秘书舰1' } },
    },
    200,
    2,
  )
  assert.equal(text, '', '跨形态借了单个缺行——老闸被拆了')
})

// ---- ③ 季节闸对新源同样生效 ----

test('季节占槽的格子即使 kcwiki 有词也不出字幕', () => {
  const caption = captionOf(
    {
      voiceFallbackOf: chain(100),
      seasonOccupied: new Map([[100, new Set([2])]]),
      kcwikiBySlot: new Map([[100, new Map([[2, { zh: 'kcwiki 的平时那句', ja: '' }]])]]),
    },
    100,
    2,
  )
  assert.deepEqual(caption, [], '新源绕过了季节闸——当季会打出平时那句')
})

test('耳测台账那道闸对新源同样生效', () => {
  const caption = captionOf(
    {
      voiceFallbackOf: chain(100),
      observations: new Map([['100:2', { verdict: 'season-slot' }]]),
      kcwikiBySlot: new Map([[100, new Map([[2, { zh: 'kcwiki 的平时那句', ja: '' }]])]]),
    },
    100,
    2,
  )
  assert.deepEqual(caption, [], '新源绕过了耳测台账那道闸')
})

test('台账里判 slot-offset 的格不在季节闸内，字幕照出', () => {
  const caption = captionOf(
    {
      voiceFallbackOf: chain(100),
      observations: new Map([['100:2', { verdict: 'slot-offset' }]]),
      kcwikiBySlot: new Map([[100, new Map([[2, { zh: '照出的那句', ja: '' }]])]]),
    },
    100,
    2,
  )
  assert.equal(caption[0]?.text, '照出的那句', '整份耳测台账被一刀切静音了')
})

// ---- ⑤ 病态表不算「有表」（2026-08-27 杰维斯改中破无字幕）----
//
// 杰维斯改（394）与未改（519）的 subtitle 表**各只有一个键「2」**，还是同一句
// 夏季限定台词——全库 762 个有表的形态里只有这两个是这样。一句常规台词都没有，
// 却足以让「本形态有表就停在本形态」的闸把整条改装链挡掉。

test('subtitle 表只剩一条季节孤条时不算「有表」，链接着往前走', () => {
  // ⚠️ 季节证据挂在**未改**名下（kcwiki 的季节包按基础形态的形态码 `319-*` 归档），
  // 改形态那边一条都查不到——判据必须沿链看，只查当前形态就会漏掉 394 这一条。
  const summer = '这个国家的夏天，好热啊'
  const setup = {
    voiceFallbackOf: chain(394, 519),
    subtitleZh: { 394: { 2: summer }, 519: { 5: '未改的建造完成' } },
    seasonalShips: { 519: [{ key: '319-Sec1Seika2018', zh: summer }] },
  }
  assert.equal(textOf(setup, 394, 5), '未改的建造完成', '一条季节孤条挡住了整条改装链')
})

test('季节闸已判占用的那一格同样不给整张表背书', () => {
  const setup = {
    voiceFallbackOf: chain(394, 519),
    subtitleZh: { 394: { 2: '被季节占着的那一格' }, 519: { 5: '未改的建造完成' } },
    seasonOccupied: new Map([[394, new Set([2])]]),
  }
  assert.equal(textOf(setup, 394, 5), '未改的建造完成', '季节占用的孤条挡住了整条改装链')
})

test('表里只要还剩一格常规台词，老闸照旧把链停在本形态', () => {
  // 收紧判据不等于把「防新旧台词混拼」那道闸一起拆了
  const summer = '这个国家的夏天，好热啊'
  const setup = {
    voiceFallbackOf: chain(394, 519),
    subtitleZh: { 394: { 2: summer, 6: '改自己的修复完成' }, 519: { 5: '未改的建造完成' } },
    seasonalShips: { 519: [{ key: '319-Sec1Seika2018', zh: summer }] },
  }
  assert.equal(textOf(setup, 394, 6), '改自己的修复完成')
  assert.equal(textOf(setup, 394, 5), '', '本形态还有常规台词，却跨形态借了单个缺行')
})

test('kcwiki 兜底分支：本形态缺这一格时沿链往前置形态借', () => {
  // kcwiki 对改形态**只收与未改有差分的台词**，缺的那些格本来就等于「沿用未改」。
  // 394 的桶有 32 格却没有 21，而 519 的 21 格里躺着那句中破台词。
  const midDamage = '这种程度……还可以坚持！幸运舰杰维斯……是不会沉的！'
  const text = textOf(
    {
      voiceFallbackOf: chain(394, 519),
      kcwikiBySlot: new Map([
        [394, new Map([[1, { zh: '改的入手台词', ja: '' }]])],
        [519, new Map([[21, { zh: midDamage, ja: '' }]])],
      ]),
    },
    394,
    21,
  )
  assert.equal(text, midDamage, '中破那一格还是空的——玩家听见了声音、看不见字')
})

// ---- ④ 没有资料时仍旧不出字幕 ----

test('三个源都没有这一形态：一个字都不出', () => {
  assert.deepEqual(captionOf({ voiceFallbackOf: chain(999) }, 999, 2), [])
})

test('有表但这一格是空的：不出空字幕条', () => {
  assert.deepEqual(
    captionOf({ voiceFallbackOf: chain(100), subtitleZh: { 100: { 5: '别的格' } } }, 100, 2),
    [],
  )
})
