// 时报的跨形态指路：什么时候摆那一行路标、指向谁、什么时候绝不摆。
//
// ---- 这份护栏钉的是「写歪了不报错，只是某天变成另一句话」的那几处 ----
//  · 门槛写松（比如降到 1 条）→ 半截资料也指路，玩家点过去只看到三五行；
//  · 忘了排除本形态 → 一页指向自己，路标变成死循环；
//  · 「本形态自己有时报」那一支漏判 → 页面上明明读得到，还叫人去别处；
//  · 深海那一支漏判 → 深海没有 1..53 的槽位空间，这一行在那边毫无意义。
//
// ⚠️ 这一行**只指路，不下结论**。判据里没有、也不许有任何一支去拆探测钮或
// 改无配音态——「随包资料里别的形态才有」推不出「本形态没有」（判例：国後）。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import plan from '../dist/shared/voice-probe-plan.js'
import sceneSlots from '../dist/shared/voice-scene-slots.js'

const {
  HOURLY_POINTER_MIN_ROWS,
  HOURLY_VOICE_SLOT_FIRST,
  HOURLY_VOICE_SLOT_LAST,
  countHourlyVoiceSlots,
  hourlyVoicePointerTarget,
  isHourlyVoiceSlot,
} = plan
const { voiceSlotOfKey } = sceneSlots

const readLode = (id) => {
  const file = new URL(`../assets/lodes/${id}.json`, import.meta.url)
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/** 与 modules/ji 的 `hourlyTextSlotsOf` 同一份判据：三个源、按槽位去重。 */
const bundledHourlyRows = (lodes, id) => {
  const slots = new Set()
  for (const row of lodes.kcwiki?.data?.[`${id}`] ?? []) {
    const slot = row.slot ?? voiceSlotOfKey(row.key)
    if (isHourlyVoiceSlot(slot)) slots.add(slot)
  }
  for (const line of lodes.wikiwiki?.data?.[`${id}`] ?? []) {
    if (isHourlyVoiceSlot(line.voiceId)) slots.add(line.voiceId)
  }
  for (const key of Object.keys(lodes.subtitleJa?.data?.[`${id}`] ?? {})) {
    const slot = parseInt(key, 10)
    if (isHourlyVoiceSlot(slot)) slots.add(slot)
  }
  return slots.size
}

test('时报段就是 30..53，别处一格都不算', () => {
  assert.equal(HOURLY_VOICE_SLOT_FIRST, 30)
  assert.equal(HOURLY_VOICE_SLOT_LAST, 53)
  assert.equal(isHourlyVoiceSlot(29), false)
  assert.equal(isHourlyVoiceSlot(30), true)
  assert.equal(isHourlyVoiceSlot(53), true)
  assert.equal(isHourlyVoiceSlot(54), false)
  assert.equal(isHourlyVoiceSlot(30.5), false)
  assert.equal(isHourlyVoiceSlot(null), false)
  assert.equal(countHourlyVoiceSlots(new Set([1, 2, 30, 41, 53, 900])), 3)
  assert.equal(countHourlyVoiceSlots(new Set([1, 2, 900])), 0)
})

test('判例 · 大泊：基础形态一格时报文本都没有，改有整套', () => {
  const lodes = {
    kcwiki: readLode('kcwiki-voice'),
    wikiwiki: readLode('wikiwiki-voice'),
    subtitleJa: readLode('subtitle-ja'),
  }
  if (!lodes.kcwiki && !lodes.wikiwiki && !lodes.subtitleJa) return // 随包资料不在，这条跳过

  const base = bundledHourlyRows(lodes, 995) // 大泊
  const remodel = bundledHourlyRows(lodes, 1000) // 大泊改
  assert.equal(base, 0, `随包资料里大泊(995)不该有时报文本，实测 ${base} 条`)
  assert.ok(
    remodel >= HOURLY_POINTER_MIN_ROWS,
    `随包资料里大泊改(1000)该有成规模时报，实测 ${remodel} 条`,
  )

  // 改造链按链序进来（离原型近的在前），本形态是链首那一级
  const chain = [
    { mstId: 995, hourlyRows: base },
    { mstId: 1000, hourlyRows: remodel },
  ]
  assert.equal(hourlyVoicePointerTarget({ mstId: 995, ownHourlyTextRows: 0, chain }), 1000)
  // 反向：站在大泊改自己的页面上，她自己就有——不指路
  assert.equal(
    hourlyVoicePointerTarget({ mstId: 1000, ownHourlyTextRows: remodel, chain }),
    null,
  )
})

test('本形态自己有时报文本行时不指路，哪怕只有一条', () => {
  const chain = [
    { mstId: 995, hourlyRows: 1 },
    { mstId: 1000, hourlyRows: 24 },
  ]
  assert.equal(hourlyVoicePointerTarget({ mstId: 995, ownHourlyTextRows: 1, chain }), null)
})

test('链上没人有成规模时报时不指路', () => {
  assert.equal(
    hourlyVoicePointerTarget({
      mstId: 995,
      ownHourlyTextRows: 0,
      chain: [
        { mstId: 995, hourlyRows: 0 },
        { mstId: 1000, hourlyRows: 0 },
      ],
    }),
    null,
  )
  // 半截资料（差一条到门槛）也不指：指过去只看到十九行，路标反而误导
  assert.equal(
    hourlyVoicePointerTarget({
      mstId: 995,
      ownHourlyTextRows: 0,
      chain: [
        { mstId: 995, hourlyRows: 0 },
        { mstId: 1000, hourlyRows: HOURLY_POINTER_MIN_ROWS - 1 },
      ],
    }),
    null,
  )
})

test('本形态自己够格也不算数：链上等于自己的那一级永远不是指路目标', () => {
  assert.equal(
    hourlyVoicePointerTarget({
      mstId: 1000,
      // 本形态时报行没进 covered（比如全被别的层占了槽位）也不许指向自己
      ownHourlyTextRows: 0,
      chain: [{ mstId: 1000, hourlyRows: 24 }],
    }),
    null,
  )
})

test('多个形态够格时取链序里第一个', () => {
  const chain = [
    { mstId: 100, hourlyRows: 0 },
    { mstId: 200, hourlyRows: 24 },
    { mstId: 300, hourlyRows: 24 },
  ]
  assert.equal(hourlyVoicePointerTarget({ mstId: 100, ownHourlyTextRows: 0, chain }), 200)
})

test('深海页不出这一行', () => {
  assert.equal(
    hourlyVoicePointerTarget({
      mstId: 1501,
      ownHourlyTextRows: 0,
      abyss: true,
      chain: [
        { mstId: 1501, hourlyRows: 0 },
        { mstId: 1502, hourlyRows: 24 },
      ],
    }),
    null,
  )
})

test('指路只加信息不减功能：判据里没有任何一支去动骨架槽位', () => {
  // 摆哪些骨架行只看 `covered`，与指路结论无关——同一份 covered 进去，
  // 有没有指路目标都该摆出同样的 24 格时报骨架。
  const covered = new Set([1, 2, 3])
  const slots = plan.voiceSkeletonSlots({ covered, mstId: 995 })
  const hourly = slots.filter((slot) => isHourlyVoiceSlot(slot))
  assert.equal(hourly.length, 24, '时报段该整段摆出探测钮')
  assert.equal(
    hourlyVoicePointerTarget({
      mstId: 995,
      ownHourlyTextRows: countHourlyVoiceSlots(covered),
      chain: [
        { mstId: 995, hourlyRows: 0 },
        { mstId: 1000, hourlyRows: 24 },
      ],
    }),
    1000,
  )
  assert.deepEqual(plan.voiceSkeletonSlots({ covered, mstId: 995 }), slots)
})

test('措辞纪律：指路那一行不许出现断言式说法', () => {
  const source = fs.readFileSync(
    new URL('../src/renderer/modules/ji.ts', import.meta.url),
    'utf8',
  )
  const row = /const hourlyPointerHtml[\s\S]*?\n\n/.exec(source)?.[0] ?? ''
  assert.ok(row.includes('时报台词收录在'), '指路文案不见了')
  for (const banned of ['没有时报', '随改造追加', '改造后才有', '本形态无']) {
    assert.ok(!row.includes(banned), `指路行不许写「${banned}」这类断言`)
  }
})
