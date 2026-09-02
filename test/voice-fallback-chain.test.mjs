// 台词卷底层那条**沿改装链续填**的回退：谁出哪一行、同一格会不会出两行、场合名写什么。
//
// ---- 为什么会有这份护栏（2026-08-23 实测）----
// 底层原本是「沿链择一」：逐个形态试 kcwiki → wikiwiki → subtitle，**第一个有东西的
// 源命中就停**。命中的那份大不大不作数，于是 kcwiki 桶里只有 1 行的形态整页就只剩 1 行，
// 而它自己的字幕表里五十多格（含 24 条时报）一个字都出不来。
// 随包 lodes + 本机 start2 快照实测：862 个我方形态里 173 个受影响，合计 3735 行取不到。
//
// 这里钉的是**逻辑输出**（哪几行、哪个槽、场合名是什么），不是源码文本。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  buildShipFormCodeMap,
  planVoiceCorrections,
  planVoiceFallbackChain,
  voiceFallbackScene,
  voiceSlotOfKey,
} from '../src/shared/voice-scene-slots.ts'

const readLode = (id) => {
  const file = new URL(`../assets/lodes/${id}.json`, import.meta.url)
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/** 只给必要的那几样，其余按空的来——单测要能一眼看出「这一页的输入是什么」 */
const planOf = (overrides) => {
  const input = {
    mstId: 100,
    tryIds: [100],
    covered: new Set(),
    slotlessJa: [],
    correctedRowsOf: () => undefined,
    wikiwikiRowsOf: () => undefined,
    subtitleJaOf: () => undefined,
    subtitleZhOf: () => undefined,
    zhOfJa: () => '',
    ...overrides,
  }
  return { plan: planVoiceFallbackChain(input), covered: input.covered }
}

/** 一「组」= 一个形态的一个源。跨组不许抢同一格；组内是资料原样，不动。 */
const groupOf = (pick) => `${pick.id}|${pick.source}`
const assertOneRowPerSlot = (picks, label) => {
  const owner = new Map()
  for (const pick of picks) {
    if (pick.slot == null) continue
    const before = owner.get(pick.slot)
    if (before == null) owner.set(pick.slot, groupOf(pick))
    else {
      assert.equal(
        before,
        groupOf(pick),
        `${label}：槽位 ${pick.slot} 同时被 ${before} 和 ${groupOf(pick)} 填了`,
      )
    }
  }
}

// ============================ 骨架逻辑（合成样本） ============================

test('小桶不再挡整页：kcwiki 只有一行时，剩下的格由字幕表续上', () => {
  const { plan, covered } = planOf({
    correctedRowsOf: (id) =>
      id === 100 ? [{ key: '100-Sec1', scene: '秘书舰1', ja: 'あ', zh: '啊', fix: 'ok' }] : undefined,
    subtitleJaOf: (id) => (id === 100 ? { 1: 'い', 2: 'あ', 3: 'う' } : undefined),
    subtitleZhOf: (id) => (id === 100 ? { 1: '衣', 2: '啊', 3: '呜' } : undefined),
  })
  // 2 号槽被 kcwiki 那一行占了，1/3 由字幕表补上——老口径这里会 break 掉整份字幕
  assert.deepEqual(
    plan.picks.map((pick) => [pick.source, pick.slot]),
    [
      ['kcwiki', 2],
      ['subtitle', 1],
      ['subtitle', 3],
    ],
  )
  assert.deepEqual(plan.sources, ['kcwiki', 'subtitle'])
  // 骨架层拿的是同一个集合：填过的格必须记进去，否则那几格上还会再摆一行骨架
  assert.deepEqual([...covered].sort((a, b) => a - b), [1, 2, 3])
})

test('链序即优先序：越近的前置形态先占格，远的只补它没占到的', () => {
  const { plan } = planOf({
    mstId: 300,
    tryIds: [300, 200, 100],
    correctedRowsOf: (id) =>
      id === 200
        ? [{ key: '200-Sec1', scene: '秘书舰1', ja: '近', zh: '近', fix: 'ok' }]
        : id === 100
          ? [
              { key: '100-Sec1', scene: '秘书舰1', ja: '远', zh: '远', fix: 'ok' },
              { key: '100-Sec2', scene: '秘书舰2', ja: '远2', zh: '远2', fix: 'ok' },
            ]
          : undefined,
  })
  assert.deepEqual(
    plan.picks.map((pick) => [pick.id, pick.slot, pick.ja]),
    [
      [200, 2, '近'],
      [100, 3, '远2'],
    ],
  )
  assert.deepEqual(plan.borrowedFrom, [200, 100])
  assert.equal(plan.usedOwnForm, false)
  assertOneRowPerSlot(plan.picks, '沿链续填')
})

test('①② 占住的格不许被底层再填一次', () => {
  const { plan } = planOf({
    covered: new Set([2]),
    correctedRowsOf: (id) =>
      id === 100
        ? [
            { key: '100-Sec1', scene: '秘书舰1', ja: 'あ', zh: '啊', fix: 'ok' },
            { key: '100-Sec2', scene: '秘书舰2', ja: 'い', zh: '衣', fix: 'ok' },
          ]
        : undefined,
  })
  assert.deepEqual(plan.picks.map((pick) => pick.slot), [3])
})

test('归属校正挪走的行不当回退源——翔鶴改二甲 52→2 那一例不许回来', () => {
  // `reattributed` 是「这一行其实是别的形态的」。拿它当回退源有两种错法：
  // 把别人的话搬回来，以及让「本形态整份没有资料」不成立、于是整份回退被挡掉。
  const { plan } = planOf({
    correctedRowsOf: (id) =>
      id === 100
        ? [
            { key: '261-Sec1', scene: '秘书舰1', ja: '别人的', zh: '别人的', fix: 'reattributed' },
            { key: '261-Sec2', scene: '秘书舰2', ja: '也是别人的', zh: '', fix: 'reattributed' },
          ]
        : undefined,
    subtitleJaOf: (id) => (id === 100 ? { 1: 'い', 2: 'あ' } : undefined),
    subtitleZhOf: (id) => (id === 100 ? { 1: '衣', 2: '啊' } : undefined),
  })
  assert.deepEqual(plan.picks.map((pick) => pick.source), ['subtitle', 'subtitle'])
  assert.equal(
    plan.picks.some((pick) => pick.ja.includes('别人')),
    false,
  )
})

test('无名行补场合名（1–53 全段）：字幕表的空场合、wikiwiki 的裸小时都补，源自带的不动', () => {
  assert.equal(voiceFallbackScene(30, ''), '时报 00:00')
  assert.equal(voiceFallbackScene(53, ''), '时报 23:00')
  assert.equal(voiceFallbackScene(41, '11'), '时报 11:00')
  assert.equal(voiceFallbackScene(30, '〇〇〇〇时报'), '〇〇〇〇时报')
  // 08-23 用户实机点名要触发条件：1–29 与时报段同一对照表、同一置信度，一并补名
  //（第一版只补 30–53 的谨慎口径同日撤销）
  assert.equal(voiceFallbackScene(1, ''), '获得/登录时')
  assert.equal(voiceFallbackScene(2, ''), '秘书舰1')
  assert.equal(voiceFallbackScene(26, ''), '装备')
  // 对照表外（54+）与无槽位的行照旧留空——「编号不代表场景」的适用面缩到这里
  assert.equal(voiceFallbackScene(54, ''), '')
  assert.equal(voiceFallbackScene(null, ''), '')
})

test('字幕兜底：1–53 全段带场合名，只有表外槽位计入「编号不代表场景」的依据', () => {
  const { plan } = planOf({
    subtitleJaOf: () => ({ 2: 'あ', 30: 'ゼロ時', 41: '十一時', 54: '特殊' }),
    subtitleZhOf: () => ({ 2: '啊', 30: '零点', 41: '十一点', 54: '特殊' }),
  })
  assert.deepEqual(
    plan.picks.map((pick) => [pick.slot, pick.scene]),
    [
      [2, '秘书舰1'],
      [30, '时报 00:00'],
      [41, '时报 11:00'],
      [54, ''],
    ],
  )
  // 页脚那句只在**真有没场合名的行**时才成立——现在只剩表外槽位
  assert.equal(plan.unnamedSubtitleRows, 1)
})

test('跨组不许抢同一格；组内那几条同槽候选是资料原样，不替上游删', () => {
  // wikiwiki 同一个 voiceId 下本来就会列两三条（小破/旗艦大破共用一个音轨、
  // 改装前后两种说法，还有转写残留的占位词）。组内按先到先得砍会砍掉真台词、
  // 留下占位词——霧島改二 7 号槽实测第一条就是「セリフ」。
  const { plan } = planOf({
    mstId: 200,
    tryIds: [200, 100],
    wikiwikiRowsOf: (id) =>
      id === 200
        ? [
            { key: 'a', voiceId: 20, scene: '旗艦大破', ja: 'セリフ' },
            { key: 'b', voiceId: 20, scene: '小破', ja: '痛った' },
          ]
        : [{ key: 'c', voiceId: 20, scene: '小破', ja: '前置形态的' }],
    subtitleJaOf: (id) => (id === 100 ? { 20: '字幕表的' } : undefined),
  })
  assert.deepEqual(
    plan.picks.map((pick) => [pick.id, pick.source, pick.ja]),
    [
      [200, 'wikiwiki', 'セリフ'],
      [200, 'wikiwiki', '痛った'],
    ],
  )
  assertOneRowPerSlot(plan.picks, '同槽多候选')
})

test('无槽位的行跨组按日文去重，组内不去重（同一句挂在五个周年下是原样）', () => {
  const { plan } = planOf({
    mstId: 200,
    tryIds: [200, 100],
    // ①② 里那条没有槽位的行：底层再推一次就是同一页上出现两遍
    slotlessJa: ['本形态自己的'],
    wikiwikiRowsOf: (id) =>
      id === 200
        ? [
            { key: 'x', scene: '二周年記念', ja: '今日は特別な日ですね' },
            { key: 'y', scene: '五周年記念', ja: '今日は特別な日ですね' },
            { key: 'z', scene: '母港', ja: '本形态自己的' },
          ]
        : [{ key: 'w', scene: '二周年記念', ja: '今日は特別な日ですね！' }],
  })
  assert.deepEqual(
    plan.picks.map((pick) => [pick.id, pick.scene]),
    [
      [200, '二周年記念'],
      [200, '五周年記念'],
    ],
  )
  // 折叠归一比 normalizeVoiceLine 宽一档，前置形态那条只差一个感叹号也算同一句
  assert.equal(plan.borrowedFrom.length, 0)
})

test('链上一无所有时：不出行、不标源、不写「取自前置形态」', () => {
  const { plan } = planOf({ mstId: 300, tryIds: [300, 200] })
  assert.deepEqual(plan.picks, [])
  assert.deepEqual(plan.sources, [])
  assert.deepEqual(plan.borrowedFrom, [])
  assert.equal(plan.usedOwnForm, false)
})

// ============================ 随包资料上的实测判例 ============================

const packs = (() => {
  const voice = readLode('kcwiki-voice')
  const wikiwiki = readLode('wikiwiki-voice')
  const subtitleJa = readLode('subtitle-ja')
  const subtitleZh = readLode('subtitle-zh')
  const seasonal = readLode('kcwiki-seasonal-voice')
  const ships = readLode('kcwiki-ships')
  if (!voice || !wikiwiki || !subtitleJa || !subtitleZh || !ships) return null
  const { rowsByForm } = planVoiceCorrections({
    voice: voice.data,
    subtitleJa: subtitleJa.data,
    subtitleZh: subtitleZh.data,
    seasonalShips: seasonal?.data?.ships ?? null,
    codeMap: buildShipFormCodeMap(ships.data),
  })
  return { voice, wikiwiki, subtitleJa, subtitleZh, rowsByForm }
})()

/**
 * 照台词卷的口径把一个形态的整页算出来。
 * 改装链按本机 start2 快照实测的那一份写死——链本身另有 voice-lineage 的护栏盯着，
 * 这份护栏要钉的是「拿到链之后底层填成什么样」。
 */
const pageOf = (mstId, tryIds) => {
  const own = packs.rowsByForm.get(mstId) ?? []
  const covered = new Set()
  for (const row of own) {
    const slot = row.slot ?? voiceSlotOfKey(row.key)
    if (slot != null) covered.add(slot)
  }
  const plan = planVoiceFallbackChain({
    mstId,
    tryIds,
    covered,
    slotlessJa: own
      .filter((row) => (row.slot ?? voiceSlotOfKey(row.key)) == null)
      .map((row) => row.ja),
    correctedRowsOf: (id) => packs.rowsByForm.get(id),
    wikiwikiRowsOf: (id) => packs.wikiwiki.data?.[`${id}`],
    subtitleJaOf: (id) => packs.subtitleJa.data?.[`${id}`],
    subtitleZhOf: (id) => packs.subtitleZh.data?.[`${id}`],
    zhOfJa: () => '',
  })
  return { own, plan, covered, textRows: own.length + plan.picks.length }
}

const hourlySlots = Array.from({ length: 24 }, (_, index) => index + 30)

test('夕張改二特：kcwiki 桶只有 1 行，整页从 1 条恢复到自己字幕表的 53 条', (t) => {
  if (!packs) {
    t.skip('缺台词域矿脉，跳过')
    return
  }
  const { own, plan, textRows } = pageOf(623, [623, 622, 624])
  assert.equal(own.length, 1, '前提：上游那个桶确实只有 1 行')
  // 老口径这里 break 在 kcwiki 上，整页就这 1 行；现在字幕表的 52 格补齐
  assert.equal(textRows, 53)
  assert.deepEqual(plan.sources, ['subtitle'])
  // 补进来的都是它**自己**的字幕表，不是借前置形态的
  assert.deepEqual(plan.borrowedFrom, [])
  const slots = new Set(plan.picks.map((pick) => pick.slot))
  for (const slot of hourlySlots) assert.ok(slots.has(slot), `缺时报槽位 ${slot}`)
  assertOneRowPerSlot([...own.map((row) => ({ ...row, id: 623, source: 'own', slot: row.slot ?? voiceSlotOfKey(row.key) })), ...plan.picks], '夕張改二特')
})

test('Richelieu改：24 条时报行一条不少——08-23 起改由 kcwiki 自带，不再向 492 借', (t) => {
  if (!packs) {
    t.skip('缺台词域矿脉，跳过')
    return
  }
  // 08-23 台词页清单换成穷举式之后，kcwiki 侧第一次收全了黎塞留家：292a-0000…292a-2300
  // 这 24 条时报直接落进 392 自己的桶，续填层不必再补时报。这条护栏钉的是**结果**
  // （整页 24 个时报槽一格不缺），不是「时报从哪一层来」——上游追录本就该让底层退位。
  const { own, plan } = pageOf(392, [392, 492])
  const hourlySlotOf = (slot) => slot >= 30 && slot <= 53
  const covered = new Set([
    ...own.map((row) => row.slot ?? voiceSlotOfKey(row.key)).filter((slot) => hourlySlotOf(slot)),
    ...plan.picks.map((pick) => pick.slot).filter((slot) => hourlySlotOf(slot)),
  ])
  assert.equal(covered.size, 24, `整页只有 ${covered.size} 个时报槽`)
  // kcwiki 自带的那 24 条场合名照它原样（「〇〇〇〇时报」），改写规则不许伸手进 ①层
  const ownHourly = own.filter((row) => hourlySlotOf(row.slot ?? voiceSlotOfKey(row.key)))
  assert.equal(ownHourly.length, 24, '前提翻转：时报现在是 kcwiki 自己的行')
  assert.equal(ownHourly[0].scene, '〇〇〇〇时报')
  // 其余槽位仍向 492 借，页脚要并列标注两个源，不许只标第一个
  assert.deepEqual(plan.sources, ['wikiwiki', 'subtitle'])
  assert.deepEqual(plan.borrowedFrom, [492])
})

test('裸小时改名：wikiwiki 的时报列摆进「场合」得写成「时报 HH:00」——三隈改判例', (t) => {
  if (!packs) {
    t.skip('缺台词域矿脉，跳过')
    return
  }
  // 原判例是 Richelieu改，08-23 kcwiki 追录后它不再走这条路；改名规则本身还在用——
  // 实测全包 31 个形态仍从 wikiwiki 借时报，取行数最全的三隈改（121）当判例。
  const { plan } = pageOf(121, [121])
  const hourly = plan.picks.filter((pick) => pick.slot >= 30 && pick.slot <= 53)
  assert.equal(hourly.length, 24)
  for (const pick of hourly) {
    assert.equal(pick.source, 'wikiwiki')
    assert.match(pick.scene, /^时报 \d{2}:00$/, `${pick.slot} 的场合名还是 ${pick.scene}`)
  }
  // 上游那一列写的是裸两位数（页面時報表的小时列），单摆进「场合」列没人读得懂
  const raw = (packs.wikiwiki.data?.['121'] ?? []).filter((line) => line.voiceId === 30)
  assert.deepEqual(raw.map((line) => line.scene), ['00'], '前提：上游确实只给了裸小时')
})

test('翔鶴改二甲：52 行量级不许再跌回 2 行', (t) => {
  if (!packs) {
    t.skip('缺台词域矿脉，跳过')
    return
  }
  // 08-23 穷举重抓后自己桶里从 2 行变 3 行（kcwiki 补齐了 466 自己那一节）；
  // 这条盯的仍是「整页别塌回个位数」，不是那 3 行本身。
  const { own, textRows } = pageOf(466, [466, 461])
  assert.equal(own.length, 3, '前提：留在自己桶里的只有这几行，其余都靠回退层')
  assert.ok(textRows >= 50, `只剩 ${textRows} 行——回退又被挡掉了`)
})

test('秋津洲改：kcwiki 自带时报的那一族，原有的行与场合名一个字不改', (t) => {
  if (!packs) {
    t.skip('缺台词域矿脉，跳过')
    return
  }
  const { own, plan } = pageOf(450, [450])
  assert.equal(own.length, 31)
  const ownHourly = own.filter((row) => {
    const slot = row.slot ?? voiceSlotOfKey(row.key)
    return slot >= 30 && slot <= 53
  })
  assert.equal(ownHourly.length, 24)
  // 场合名照 kcwiki 原样（「〇〇〇〇时报」），不许被时报段那条改写规则动到
  assert.equal(ownHourly[0].scene, '〇〇〇〇时报')
  // 底层只补 kcwiki 没占到的格，一条都不许压在已有行上
  for (const pick of plan.picks) {
    assert.equal(pick.source, 'subtitle')
    assert.ok(
      !own.some((row) => (row.slot ?? voiceSlotOfKey(row.key)) === pick.slot),
      `槽位 ${pick.slot} 上已经有 kcwiki 的行了`,
    )
  }
})

test('全量：任一形态里同一个槽位不许被两组填', (t) => {
  if (!packs) {
    t.skip('缺台词域矿脉，跳过')
    return
  }
  // 链用不到主数据的那一部分：逐个形态单独算（tryIds = [自己]）已经足以覆盖
  // 「kcwiki / wikiwiki / subtitle 三个源互相抢格」这条，链上多级由上面几例钉住。
  const forms = new Set([
    ...Object.keys(packs.voice.data ?? {}),
    ...Object.keys(packs.wikiwiki.data ?? {}),
    ...Object.keys(packs.subtitleJa.data ?? {}),
  ])
  let checked = 0
  for (const raw of forms) {
    const mstId = Number(raw)
    if (!Number.isInteger(mstId) || mstId <= 0 || mstId >= 1500) continue
    const { own, plan } = pageOf(mstId, [mstId])
    assertOneRowPerSlot(plan.picks, `形态 ${mstId}`)
    for (const pick of plan.picks) {
      if (pick.slot == null) continue
      assert.ok(
        !own.some((row) => (row.slot ?? voiceSlotOfKey(row.key)) === pick.slot),
        `形态 ${mstId} 的槽位 ${pick.slot} 被 ①层 和底层各填了一行`,
      )
    }
    checked++
  }
  assert.ok(checked > 300, `只检了 ${checked} 个形态，样本不对`)
})

test('深海不进这条路：那两个只有深海的源根本不在续填链上，链上三个源也没有深海形态', (t) => {
  if (!packs) {
    t.skip('缺台词域矿脉，跳过')
    return
  }
  // 深海侧仍走 modules/ji 里那条择一（subtitle-enemies → kcwiki → wikiwiki-abyss）：
  // 只有 subtitle-enemies 的 key 是完整官方档名，别的源都不能拼播放地址，叠起来不安全。
  // 这条护栏钉的是「续填链够不着深海」这个事实——链上那两个补充源里深海形态数为 0，
  // 所以就算把深海喂进来，续填也只会退化成对 kcwiki 桶的择一，与老口径逐行等价。
  const abyssIn = (data) => Object.keys(data ?? {}).filter((key) => Number(key) >= 1500).length
  assert.equal(abyssIn(packs.wikiwiki.data), 0)
  assert.equal(abyssIn(packs.subtitleJa.data), 0)
  assert.equal(abyssIn(packs.subtitleZh.data), 0)
  // kcwiki 桶里确实有深海形态：对它们来说续填 ≡ 择一（单 id、单源、槽位互不重复）
  const abyssForms = Object.keys(packs.voice.data ?? {}).filter((key) => Number(key) >= 1500)
  assert.ok(abyssForms.length > 0)
  for (const raw of abyssForms) {
    const mstId = Number(raw)
    const kept = (packs.rowsByForm.get(mstId) ?? []).filter((row) => row.fix !== 'reattributed')
    const { plan } = planOf({
      mstId,
      tryIds: [mstId],
      correctedRowsOf: (id) => packs.rowsByForm.get(id),
    })
    assert.deepEqual(
      plan.picks.map((pick) => pick.key),
      kept.map((row) => row.key),
      `深海形态 ${mstId} 的行在续填下变了`,
    )
  }
})
