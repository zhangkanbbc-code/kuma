// 台词行的**归属与文本校正**：015f68e 判出的 1013 行 divergent 该怎么分拣、怎么修。
//
// 判据家法只有一条：**以游戏音轨为最高文本权威**（它是一手，kcwiki/wikiwiki 都是转写层），
// 且宁可空挂不播错句、不显错文。这里逐档钉住代表用例——每一档都是实测出来的一类病因，
// 而不是「大概会有这么一类」。真包上的四档分布另有一条全量对账（缺包时跳过）。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  buildShipFormCodeMap,
  isSubtitlePlaceholder,
  planVoiceCorrections,
  voiceSceneOfSlot,
  voiceSlotOfKey,
} from '../src/shared/voice-scene-slots.ts'

const lodeFile = (id) => new URL(`../assets/lodes/${id}.json`, import.meta.url)
const readLode = (id) => {
  const file = lodeFile(id)
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

// 形态码表的最小样本：链首 100 → 一级改装 100a → 二级 561。
// 键是**形态码**不是图鉴号——两套号（时雨改的图鉴号 1343、形态码 080a）。
const ships = {
  base: { ID: 10, 图鉴号: 100, 改造: { 系列: '100', 改造前: -1, 改造后: '100a' } },
  kai: { ID: 20, 图鉴号: 200, 改造: { 系列: '100', 改造前: '100', 改造后: '561' } },
  kai2: { ID: 30, 图鉴号: 300, 改造: { 系列: '100', 改造前: '100a', 改造后: -1 } },
  // 零填充/去零填充两种写法都出现过（季节页写 005，ships 的系列写 5）
  short: { ID: 40, 图鉴号: 5, 改造: { 系列: '5', 改造前: -1, 改造后: -1 } },
}
const codeMap = buildShipFormCodeMap(ships)

test('形态码表：链首取「系列」，其后每一级取上一级的「改造后」', () => {
  assert.equal(codeMap.get('100'), 10)
  assert.equal(codeMap.get('100a'), 20)
  assert.equal(codeMap.get('561'), 30)
  // 三位零填充与去零填充两种写法都收
  assert.equal(codeMap.get('5'), 40)
  assert.equal(codeMap.get('005'), 40)
})

test('槽位 → 中文场合名：时报走 30+小时，其余查实证对照表，认不出留空', () => {
  assert.equal(voiceSceneOfSlot(1), '获得/登录时')
  assert.equal(voiceSceneOfSlot(2), '秘书舰1')
  assert.equal(voiceSceneOfSlot(30), '时报 00:00')
  assert.equal(voiceSceneOfSlot(53), '时报 23:00')
  assert.equal(voiceSceneOfSlot(99), '')
})

test('字幕包的占位句不是台词——按文本特征认，不按形态名单认', () => {
  assert.equal(isSubtitlePlaceholder('このサブタイトルに対応するサブタイトルがありません！'), true)
  assert.equal(isSubtitlePlaceholder('艦これ中国語ウィキへ'), true)
  assert.equal(isSubtitlePlaceholder('提督、おはようございます。'), false)
  assert.equal(isSubtitlePlaceholder(''), false)
  assert.equal(isSubtitlePlaceholder(undefined), false)
})

// ---- 四档分拣：每一档一个代表用例 ----

const planOf = (overrides) =>
  planVoiceCorrections({
    voice: {},
    subtitleJa: {},
    subtitleZh: {},
    seasonalShips: {},
    codeMap,
    ...overrides,
  })

test('对得上就照旧：不动、不改档', () => {
  const { rowsByForm, stats } = planOf({
    voice: { 10: [{ key: '100-Sec1', scene: '秘书舰1', ja: '提督？', zh: '提督？' }] },
    subtitleJa: { 10: { 2: '提督？' } },
  })
  assert.equal(stats.divergent, 0)
  assert.deepEqual(
    rowsByForm.get(10).map((row) => row.fix),
    ['ok'],
  )
})

test('① 重归属：档名的形态码指向别的形态，且那边对得上 → 整行挪过去', () => {
  const { rowsByForm, stats } = planOf({
    // kcwiki 把改二的档名（561-*）塞进了基础形态（10）那个桶
    voice: { 10: [{ key: '561-Sec1', scene: '秘书舰1', ja: '改二那句', zh: '改二那句' }] },
    subtitleJa: { 10: { 2: '基础形态那句' }, 30: { 2: '改二那句' } },
  })
  assert.equal(stats.divergent, 1)
  assert.equal(stats.reattributed, 1)
  assert.equal(stats.reattributedConfirmed, 1)
  // 原来那个桶不再显示这一行——它本来就不是她说的话
  assert.equal(rowsByForm.get(10), undefined)
  const moved = rowsByForm.get(30)
  assert.equal(moved.length, 1)
  assert.equal(moved[0].fix, 'reattributed')
  assert.equal(moved[0].from, 10)
})

test('① 重归属：新宿主整份字幕缺席时照样挪，但只算 key-only 不算 confirmed', () => {
  const { rowsByForm, stats } = planOf({
    voice: { 10: [{ key: '561-Sec1', scene: '秘书舰1', ja: '改二那句', zh: '改二那句' }] },
    // 30 号形态压根没有字幕表（新形态常态）
    subtitleJa: { 10: { 2: '基础形态那句' } },
  })
  assert.equal(stats.reattributed, 1)
  assert.equal(stats.reattributedConfirmed, 0)
  assert.equal(rowsByForm.get(30)[0].fix, 'reattributed')
})

test('① 重归属只挪「在原处判分歧」的行——在原处对得上的行不许动', () => {
  const { rowsByForm, stats } = planOf({
    // 同一句话基础形态也说，音轨对得上：挪走等于拆掉一个播得对的按钮
    voice: { 10: [{ key: '561-Sec1', scene: '秘书舰1', ja: '两边都说的那句', zh: '译文' }] },
    subtitleJa: { 10: { 2: '两边都说的那句' }, 30: { 2: '两边都说的那句' } },
  })
  assert.equal(stats.divergent, 0)
  assert.equal(stats.reattributed, 0)
  assert.equal(rowsByForm.get(10)[0].fix, 'ok')
  assert.equal(rowsByForm.get(30), undefined)
})

test('② 重锚定：文本在同一艘舰的别的槽位找得到 → 换槽位，场合标签跟着改', () => {
  const { rowsByForm, stats } = planOf({
    voice: { 10: [{ key: '100-Sec1', scene: '秘书舰1', ja: '其实是秘书舰2那句', zh: '译文' }] },
    subtitleJa: { 10: { 2: '别的话', 3: '其实是秘书舰2那句' } },
  })
  assert.equal(stats.reanchored, 1)
  const row = rowsByForm.get(10)[0]
  assert.equal(row.fix, 'reanchored')
  assert.equal(row.slot, 3)
  assert.equal(row.scene, '秘书舰2')
})

test('② 重锚定不认占位句——把占位句当锚点等于锚到一句不存在的台词上', () => {
  const { stats } = planOf({
    voice: { 10: [{ key: '100-Sec1', scene: '秘书舰1', ja: 'このサブタイトルに対応するサブタイトルがありません！', zh: '译文' }] },
    subtitleJa: { 10: { 2: '别的话', 3: 'このサブタイトルに対応するサブタイトルがありません！' } },
  })
  // 别的槽位躺着同一句占位句，但那不是锚点——不许拿它换槽
  assert.equal(stats.reanchored, 0)
  // 本槽的真文本没有中文，也没有别的去处 → 老老实实落到「真无解」
  assert.equal(stats.noSubtitle, 1)
  assert.equal(stats.audioText, 0)
  assert.equal(stats.seasonSlot, 0)
})

test('③ 以音轨为准：kcwiki 那句哪儿都找不到 → 显示音轨真文本 + 社区译文，错文本不显示', () => {
  const { rowsByForm, stats } = planOf({
    voice: { 10: [{ key: '100-Sec1', scene: '秘书舰1', ja: '这艘舰根本不说的那句', zh: '错译文' }] },
    subtitleJa: { 10: { 2: '音轨里真正的那句' } },
    subtitleZh: { 10: { 2: '音轨那句的中文' } },
  })
  assert.equal(stats.audioText, 1)
  const row = rowsByForm.get(10)[0]
  assert.equal(row.fix, 'audio-text')
  assert.equal(row.ja, '音轨里真正的那句')
  assert.equal(row.zh, '音轨那句的中文')
  assert.equal(row.textSource, 'subtitle')
  assert.equal(row.slot, 2)
})

test('④-a 季节占槽：双源取证（字幕那句的中文 == 该舰某条季节台词）→ 文本不动、不给键', () => {
  const { rowsByForm, stats } = planOf({
    voice: { 10: [{ key: '100-Sec1', scene: '秘书舰1', ja: '她平时那句', zh: '她平时那句的中文' }] },
    subtitleJa: { 10: { 2: '当季那句' } },
    subtitleZh: { 10: { 2: '当季那句的中文' } },
    seasonalShips: { 10: [{ zh: '当季那句的中文' }] },
  })
  assert.equal(stats.seasonSlot, 1)
  assert.equal(stats.audioText, 0)
  const row = rowsByForm.get(10)[0]
  assert.equal(row.fix, 'season-slot')
  // 这一档**不改文本**：kcwiki 记的才是她平时那句
  assert.equal(row.zh, '她平时那句的中文')
})

test('④-b 字幕占位：该槽写的是占位句，不是台词 → 不给键，也不拿它当真文本', () => {
  const { rowsByForm, stats } = planOf({
    voice: { 10: [{ key: '100-Sec1', scene: '秘书舰1', ja: 'kcwiki 那句', zh: 'kcwiki 译文' }] },
    subtitleJa: { 10: { 2: 'このサブタイトルに対応するサブタイトルがありません！艦これ中国語ウィキ' } },
  })
  assert.equal(stats.noSubtitle, 1)
  assert.equal(stats.audioText, 0)
  const row = rowsByForm.get(10)[0]
  assert.equal(row.fix, 'no-subtitle')
  assert.equal(row.zh, 'kcwiki 译文')
})

test('四档互斥且穷尽：每一行只落一档，四档之和 == divergent', () => {
  const { rowsByForm, stats } = planOf({
    voice: {
      10: [
        { key: '100-Sec1', scene: '秘书舰1', ja: '对得上那句', zh: 'a' },
        { key: '561-Sec2', scene: '秘书舰2', ja: '改二那句', zh: 'b' },
        { key: '100-Sec3', scene: '秘书舰3', ja: '错位到别槽那句', zh: 'c' },
        { key: '100-Equip1', scene: '装备/改修/改造1', ja: '哪儿都没有那句', zh: 'd' },
        { key: '100-Equip2', scene: '装备/改修/改造2', ja: '平时那句', zh: 'e' },
        { key: '100-Battle', scene: '战斗开始', ja: '占位那格', zh: 'f' },
      ],
    },
    subtitleJa: {
      10: {
        2: '对得上那句',
        3: '改二在这一格是别的话',
        4: '秘书舰3的真话',
        5: '错位到别槽那句',
        9: '音轨真话',
        10: '当季那句',
        15: 'このサブタイトルに対応するサブタイトルがありません！',
      },
      30: { 3: '改二那句' },
    },
    subtitleZh: { 10: { 9: '音轨真话的中文', 10: '当季那句的中文' } },
    seasonalShips: { 10: [{ zh: '当季那句的中文' }] },
  })
  assert.equal(stats.total, 6)
  assert.equal(stats.divergent, 5)
  assert.equal(
    stats.reattributed + stats.reanchored + stats.audioText + stats.seasonSlot + stats.noSubtitle,
    stats.divergent,
  )
  assert.deepEqual(
    [...rowsByForm.keys()].sort((left, right) => left - right),
    [10, 30],
  )
})

test('重排按槽位：重归属挪进来的行不许堆在末尾', () => {
  const { rowsByForm } = planOf({
    voice: {
      10: [{ key: '100-Idle', scene: '放置', ja: '放置那句', zh: '放置' }],
      // 20 号形态自己有一条 Sec1，另有一条 100a-Intro 从 10 号挪进来（槽位 1，该排前面）
      30: [{ key: '561-Sec1', scene: '秘书舰1', ja: '改二秘书舰1', zh: 'sec1' }],
    },
    subtitleJa: {
      10: { 29: '放置那句', 1: '入手那句' },
      30: { 2: '改二秘书舰1' },
    },
  })
  const rows = rowsByForm.get(30)
  assert.deepEqual(
    rows.map((row) => row.key),
    ['561-Sec1'],
  )
  assert.deepEqual(rowsByForm.get(10).map((row) => row.fix), ['ok'])
})

// ---- 真包全量对账（缺包时跳过；test:lodes 会把它列成必备） ----

test('真包上的四档分布：935 行一格不丢', (t) => {
  const voice = readLode('kcwiki-voice')
  const subtitleJa = readLode('subtitle-ja')
  const subtitleZh = readLode('subtitle-zh')
  const seasonal = readLode('kcwiki-seasonal-voice')
  const shipsPack = readLode('kcwiki-ships')
  if (!voice || !subtitleJa || !subtitleZh || !seasonal || !shipsPack) {
    t.skip('缺台词域矿脉，跳过全量对账')
    return
  }
  const { rowsByForm, stats } = planVoiceCorrections({
    voice: voice.data,
    subtitleJa: subtitleJa.data,
    subtitleZh: subtitleZh.data,
    seasonalShips: seasonal.data?.ships,
    codeMap: buildShipFormCodeMap(shipsPack.data),
  })
  // 015f68e 撤键时量的是 1013 行；08-23 上午重抓（236 页→372 形态）收敛到 935；
  // 同日下午台词页清单改成**穷举式**（368 页→765 形态，见 fetch-lodes 的 parseKcwikiVoice）
  // 后再次重钉：重归属那一族基本在源头治掉了——旧清单只认 {{舰娘资料改}}，
  // 混用模板的页整页归到唯一认得出的那个形态头上，正是「档名与桶对不上」的最大来源。
  // 641 → 58。守恒式与分类闭合不随基线变。
  assert.equal(stats.divergent, 496)
  assert.equal(
    stats.reattributed + stats.reanchored + stats.audioText + stats.seasonSlot + stats.noSubtitle,
    stats.divergent,
  )
  assert.equal(stats.reattributed, 58)
  assert.equal(stats.reattributedConfirmed, 50)
  assert.equal(stats.reanchored, 1)
  assert.equal(stats.audioText, 151)
  assert.equal(stats.seasonSlot, 205)
  assert.equal(stats.noSubtitle, 81)
  // 重归属让 7 个原本 kcwiki 全空的形态第一次有了带场合的台词（旧清单下是 105 个：
  // 那时大批形态整卷空着，全靠重归属救；现在它们在抓取阶段就各归各位了）
  const gained = [...rowsByForm.keys()].filter(
    (formId) => rowsByForm.get(formId).length && !(voice.data?.[`${formId}`]?.length),
  )
  assert.equal(gained.length, 7)
  // 一行都不许凭空多出来或凭空消失
  const before = Object.values(voice.data).reduce((sum, rows) => sum + rows.length, 0)
  const after = [...rowsByForm.values()].reduce((sum, rows) => sum + rows.length, 0)
  assert.equal(after, before)
})

test('翔鹤改二的行不再挂在翔鹤名下——015f68e 记的那一例，08-23 起在源头就没了', (t) => {
  const voice = readLode('kcwiki-voice')
  const subtitleJa = readLode('subtitle-ja')
  const shipsPack = readLode('kcwiki-ships')
  if (!voice || !subtitleJa || !shipsPack) {
    t.skip('缺台词域矿脉，跳过')
    return
  }
  const { rowsByForm } = planVoiceCorrections({
    voice: voice.data,
    subtitleJa: subtitleJa.data,
    subtitleZh: readLode('subtitle-zh')?.data,
    seasonalShips: readLode('kcwiki-seasonal-voice')?.data?.ships,
    codeMap: buildShipFormCodeMap(shipsPack.data),
  })
  // ⚠️ 前提翻转：翔鶴（110）桶里原本躺着 261-*（翔鶴改二）的行，那是旧抓取器
  // 只认 {{舰娘资料改}}、认不出页面里另一半 {{舰娘资料}} 形态时整页归一造成的。
  // 08-23 清单换穷举 + 两种模板都收之后，261-* 在抓取阶段就落进 461 自己的桶。
  // 断言改钉**终局**：两边都不许再有错位。
  assert.equal((voice.data['110'] ?? []).filter((row) => row.key.startsWith('261-')).length, 0)
  assert.equal((rowsByForm.get(110) ?? []).filter((row) => row.key.startsWith('261-')).length, 0)
  const own461 = rowsByForm.get(461) ?? []
  assert.ok(own461.length > 0, '翔鶴改二自己的桶不许是空的')
  assert.equal(own461.every((row) => row.key.startsWith('261-')), true)
})

test('重归属机制仍有真包活判例——丸优改（402）的 163a-* 从丸优桶里挪回来', (t) => {
  const voice = readLode('kcwiki-voice')
  const subtitleJa = readLode('subtitle-ja')
  const shipsPack = readLode('kcwiki-ships')
  if (!voice || !subtitleJa || !shipsPack) {
    t.skip('缺台词域矿脉，跳过')
    return
  }
  const { rowsByForm } = planVoiceCorrections({
    voice: voice.data,
    subtitleJa: subtitleJa.data,
    subtitleZh: readLode('subtitle-zh')?.data,
    seasonalShips: readLode('kcwiki-seasonal-voice')?.data?.ships,
    codeMap: buildShipFormCodeMap(shipsPack.data),
  })
  // 上游把 163a（丸优改）的整节写在丸优（163）页里、且这页没给 163a 独立的 tabber 编号，
  // 抓取阶段无从分辨，只能靠档名在这一层挪。全包实测还剩 7 个形态吃这条路（08-23）。
  const beforeAlien = (voice.data['163'] ?? []).filter((row) => row.key.startsWith('163a-'))
  assert.ok(beforeAlien.length > 0, '样本前提：包里确实有这一族错位')
  const afterAlien = (rowsByForm.get(163) ?? []).filter(
    (row) => row.key.startsWith('163a-') && row.fix !== 'ok',
  )
  assert.equal(afterAlien.length, 0)
  // 挪过去的那几行落在丸优改名下，且标着从哪来
  const moved = (rowsByForm.get(402) ?? []).filter((row) => row.fix === 'reattributed')
  assert.equal(moved.length, beforeAlien.length)
  assert.equal(moved.every((row) => row.from === 163), true)
})

test('「留在自己桶里的那一份」== 原桶减去挪走的行——图鉴的回退层就吃这一份', (t) => {
  const voice = readLode('kcwiki-voice')
  const subtitleJa = readLode('subtitle-ja')
  const shipsPack = readLode('kcwiki-ships')
  if (!voice || !subtitleJa || !shipsPack) {
    t.skip('缺台词域矿脉，跳过')
    return
  }
  const { rowsByForm } = planVoiceCorrections({
    voice: voice.data,
    subtitleJa: subtitleJa.data,
    subtitleZh: readLode('subtitle-zh')?.data,
    seasonalShips: readLode('kcwiki-seasonal-voice')?.data?.ships,
    codeMap: buildShipFormCodeMap(shipsPack.data),
  })
  // 回退层（图鉴的第③层）只认这一份：挪进来的行是**这个形态自己的**，
  // 拿它当别人的回退源等于把别人的话又搬回来。
  for (const [formId, rows] of rowsByForm) {
    const kept = rows.filter((row) => row.fix !== 'reattributed')
    const before = voice.data?.[`${formId}`] ?? []
    // 留下的行必须都是原桶里就有的（按档名认），且一条都不许凭空多出来
    const beforeKeys = new Set(before.map((row) => row.key))
    for (const row of kept) assert.ok(beforeKeys.has(row.key), `${formId} 的 ${row.key} 不在原桶里`)
    assert.ok(kept.length <= before.length, `${formId} 的留存行比原桶还多`)
  }
})

test('归属校正只搬家不复制：全包行数守恒，且挪走的行不在原处重复出现', (t) => {
  const voice = readLode('kcwiki-voice')
  const subtitleJa = readLode('subtitle-ja')
  const shipsPack = readLode('kcwiki-ships')
  if (!voice || !subtitleJa || !shipsPack) {
    t.skip('缺台词域矿脉，跳过')
    return
  }
  const { rowsByForm } = planVoiceCorrections({
    voice: voice.data,
    subtitleJa: subtitleJa.data,
    subtitleZh: readLode('subtitle-zh')?.data,
    seasonalShips: readLode('kcwiki-seasonal-voice')?.data?.ships,
    codeMap: buildShipFormCodeMap(shipsPack.data),
  })
  for (const rows of rowsByForm.values()) {
    for (const row of rows) {
      if (row.fix !== 'reattributed') continue
      const stillThere = (rowsByForm.get(row.from) ?? []).some((other) => other.key === row.key)
      assert.equal(stillThere, false, `${row.key} 挪走了却还留在 ${row.from} 名下`)
    }
  }
})

// ---- 自补层（第一方译文）----

// ⚠️ 这一条 2026-08-22 **刻意反转过**。
// 原来钉的是「随包只收中文，一行日文都没有」——那是把任务域 2026-08-21 的
//「日文原文不进分发物」类推到台词域。同日用户重算法理后撤销：台词的逐字转写权利归 C2，
// 这一列与随包早就有的 `kcwiki-voice.ja`、整份 `subtitle-ja` **同级同灰度，不加深**。
// 台词卷是**对照**功能，缺了日文就只剩半张表，所以判据反过来钉：这一列必须在。
test('自补层的包：ja 列必须在且逐行非空（对照功能，缺了就是半张表）', (t) => {
  const pack = readLode('kanso-voice')
  if (!pack) {
    t.skip('缺 kanso-voice，跳过')
    return
  }
  const missing = []
  const blank = []
  for (const [formId, rows] of Object.entries(pack.data.ships)) {
    for (const row of rows) {
      if (!('ja' in row)) missing.push(`${formId} ${row.key}`)
      else if (!`${row.ja}`.trim()) blank.push(`${formId} ${row.key}`)
    }
  }
  assert.deepEqual(missing.slice(0, 5), [], `${missing.length} 行缺 ja 键`)
  // 这一层的底本（本机 wikiwiki-voice）每一行都有日文，所以这里**一行空的都不该有**。
  // 真出现空行说明配对错位或底本变了——那比缺一列更该当场红，因为它看起来是对的。
  assert.deepEqual(blank.slice(0, 5), [], `${blank.length} 行的 ja 是空的`)
  // 行只允许这几个键——判据仍旧钉在白名单上，改名绕不过去
  const allowed = new Set(['key', 'scene', 'slot', 'basis', 'ja', 'zh', 'draft'])
  for (const rows of Object.values(pack.data.ships)) {
    for (const row of rows) {
      for (const field of Object.keys(row)) assert.ok(allowed.has(field), `多余字段 ${field}`)
    }
  }
})

test('自补层的 ja 与 zh 逐行配得上——错一行比缺一行糟', (t) => {
  const pack = readLode('kanso-voice')
  const wikiwiki = readLode('wikiwiki-voice')
  if (!pack || !wikiwiki) {
    t.skip('缺 kanso-voice 或它的日文底本 wikiwiki-voice，跳过')
    return
  }
  // 与 scripts/voice-backfill-ja.mjs 同一套配对判据：(形态, 槽位, 同槽第几条)。
  // 这里再独立跑一遍，是因为「配错」的样子和「配对」一模一样——只有比对底本才看得出来。
  const bad = []
  for (const [mstId, rows] of Object.entries(pack.data.ships)) {
    const seen = new Set()
    const bySlot = new Map()
    for (const line of wikiwiki.data?.[mstId] ?? []) {
      if (line?.voiceId == null) continue
      const dedup = `${line.voiceId}␟${line.ja}`
      if (seen.has(dedup)) continue
      seen.add(dedup)
      bySlot.set(line.voiceId, [...(bySlot.get(line.voiceId) ?? []), line])
    }
    const used = new Map()
    for (const row of rows) {
      const index = used.get(row.slot) ?? 0
      used.set(row.slot, index + 1)
      const expected = `${(bySlot.get(row.slot) ?? [])[index]?.ja ?? ''}`
      if (row.ja !== expected) bad.push(`${mstId} ${row.key}`)
    }
  }
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length} 行的 ja 与底本对不上`)
})

test('自补层只补空：上游已覆盖的槽位一格不收', (t) => {
  // 建层时（2026-08-22）上游对这些形态整卷空白，判据是形态级；次日 kcwiki 重抓两轮
  //（先追录 50 个形态，再把台词页清单换成穷举式、追到 765 形态），自补层按「只补空」
  // 的本意各做了一轮**槽位级退位**：上游有的槽退出（那些行在运行时本就被 kcwiki
  // 优先层压住不显示），上游仍缺的槽留任。
  // 判据与运行时 kansoVoiceFillFor 的「只填未占格」同一口径。
  const pack = readLode('kanso-voice')
  const voice = readLode('kcwiki-voice')
  const subtitleJa = readLode('subtitle-ja')
  const subtitleZh = readLode('subtitle-zh')
  const seasonal = readLode('kcwiki-seasonal-voice')
  const shipsPack = readLode('kcwiki-ships')
  if (!pack || !voice || !subtitleJa || !subtitleZh || !seasonal || !shipsPack) {
    t.skip('缺台词域矿脉，跳过')
    return
  }
  const { rowsByForm } = planVoiceCorrections({
    voice: voice.data,
    subtitleJa: subtitleJa.data,
    subtitleZh: subtitleZh.data,
    seasonalShips: seasonal.data?.ships,
    codeMap: buildShipFormCodeMap(shipsPack.data),
  })
  for (const [formId, rows] of Object.entries(pack.data.ships)) {
    const upSlots = new Set(
      (rowsByForm.get(Number(formId)) ?? [])
        .map((row) => row.slot ?? voiceSlotOfKey(row.key))
        .filter((slot) => slot != null),
    )
    for (const key of Object.keys(subtitleZh.data?.[formId] ?? {})) upSlots.add(parseInt(key, 10))
    for (const row of rows) {
      assert.ok(
        !upSlots.has(row.slot),
        `${formId} 槽位 ${row.slot} 上游已覆盖，自补行该退位——重跑一次槽位级退位`,
      )
    }
  }
})

test('自补层的播放键判据：basis 逐行可重算，ambiguous 一律不给键', (t) => {
  const pack = readLode('kanso-voice')
  const subtitleJa = readLode('subtitle-ja')
  if (!pack || !subtitleJa) {
    t.skip('缺台词域矿脉，跳过')
    return
  }
  // 同一槽位有两种以上候选文本 → 至多只有一句是真的，给键就是二选一地赌
  const bySlot = new Map()
  for (const [formId, rows] of Object.entries(pack.data.ships)) {
    for (const row of rows) {
      const key = `${formId} ${row.slot}`
      bySlot.set(key, (bySlot.get(key) ?? 0) + 1)
    }
  }
  for (const [formId, rows] of Object.entries(pack.data.ships)) {
    for (const row of rows) {
      const many = (bySlot.get(`${formId} ${row.slot}`) ?? 0) > 1
      assert.equal(row.basis === 'ambiguous', many, `${row.key} 的 basis 与同槽候选数对不上`)
      // ⚠️ 2026-08-23 改名：`key-only` → `wikiwiki-mapped`。
      // 判据从「有没有第二份东西可以对」改成「槽位是**谁**给的」——
      // 这一层的槽位只有一个来源（wikiwiki 舰娘页的场合列），标出处比标「没校验」更有用：
      // 前者能与 key-confirmed 在数据上分档（两者实测错位率差一百倍），后者只说明我们手上缺料。
      // 名字本身也是护栏：`key-only` 在 08-22 那一版的语义是「不给键」，
      // 留着这个名字迟早有人照旧语义再撤一遍。
      if (row.basis === 'wikiwiki-mapped') {
        assert.equal(
          Object.keys(subtitleJa.data?.[formId] ?? {}).length,
          0,
          `${formId} 已经有字幕表了，这一行不该还记 wikiwiki-mapped——重编一次包`,
        )
      }
    }
  }
  // 编译期判过的四档只能是这四个值
  const allowed = new Set(['key-confirmed', 'wikiwiki-mapped', 'divergent', 'ambiguous'])
  for (const rows of Object.values(pack.data.ships)) {
    for (const row of rows) assert.ok(allowed.has(row.basis), `未知的 basis：${row.basis}`)
  }
})

test('吞武里的那一页词还在——自补先行，上游追录后交棒', (t) => {
  // 这条原本断言「上游没有、自补整卷扛」（用户报出来的那一页从 0 变成有）。
  // 2026-08-23 kcwiki 重抓追录了 973/978，自补层按槽位级退位交棒——
  // 但对用户的承诺不变：那一页的入手/秘书舰/出击必须一直有词。断言改盯承诺本身。
  const pack = readLode('kanso-voice')
  const voice = readLode('kcwiki-voice')
  if (!pack || !voice) {
    t.skip('缺台词域矿脉，跳过')
    return
  }
  for (const formId of ['973', '978']) {
    assert.ok(
      (voice.data?.[formId] ?? []).length >= 20,
      `前提翻转后的新地基：kcwiki 已收 ${formId}，行数该在 20 以上`,
    )
    // 上游行 + 自补留任行合起来，玩家一眼会看的几格必须有
    const slots = new Set()
    for (const row of voice.data[formId]) {
      const slot = voiceSlotOfKey(row.key)
      if (slot != null) slots.add(slot)
    }
    for (const row of pack.data.ships[formId] ?? []) slots.add(row.slot)
    for (const slot of [1, 2, 13, 14]) assert.ok(slots.has(slot), `${formId} 缺槽位 ${slot}`)
    // 自补留任行的译文照旧不许留空
    for (const row of pack.data.ships[formId] ?? []) {
      assert.ok(row.zh.trim().length > 0, '译文不许留空')
    }
  }
})
