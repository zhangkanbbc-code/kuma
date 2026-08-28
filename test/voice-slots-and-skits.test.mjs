// 语音域收尾四件的护栏（2026-08-22，用户实机连报三处）。
//
// 每一条都是「写反了不报错、只是某些行莫名其妙没有播放钮 / 某些语音永远认不出」
// 那一类，所以判据一律是真调用 + 真包比对。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import slots from '../dist/shared/voice-scene-slots.js'
import soundPath from '../dist/shared/voice-sound-path.js'
import dockLayout from '../dist/shared/dock-layout.js'

const { VOICE_SCENE_SLOTS, parseVoiceKey, resolveVoiceSlot, voiceSlotOfKey } = slots
const { EXTRA_VOICE_DIRS, OBFUSCATED_VOICE_FROM, directVoiceIdOf, parseVoiceSoundPath } = soundPath
const { layoutForPersist } = dockLayout

// ---- ① 场合表优先：档名里就写着槽位，别去猜日文文本 ----

test('档名里的场景 token 直接给出槽位', () => {
  assert.equal(voiceSlotOfKey('107-Sec1'), 2)
  assert.equal(voiceSlotOfKey('107-Intro'), 1)
  assert.equal(voiceSlotOfKey('107-Sec2'), 3)
  assert.equal(voiceSlotOfKey('107-MVP'), 23)
  // 时报：HH00 → 30+小时
  assert.equal(voiceSlotOfKey('080-0100Setubunn2019'), 31)
  assert.equal(voiceSlotOfKey('080-2200Shinnen2020'), 52)
})

test('长 token 先试：Sec1 是 Sec13 的前缀，切错就串台词', () => {
  // `Sec13rdAnniv` 的 token 是 Sec1（三周年），不是 Sec13
  assert.equal(parseVoiceKey('080-Sec13rdAnniv').scene, '秘书舰1')
  assert.equal(parseVoiceKey('080-Sec3Christmas2016').slot, 4)
})

test('认不出场景就留空——不硬套一个场景名', () => {
  assert.equal(voiceSlotOfKey('109-2ndAnniv'), null)
  assert.equal(voiceSlotOfKey('1188'), null) // 短剧的裸编号档名，没有形态码
  assert.equal(voiceSlotOfKey(''), null)
})

test('槽位表与实证口径一致：每个 token 只有一个槽位，且都在 1..53', () => {
  const seen = new Map()
  for (const [token, entry] of Object.entries(VOICE_SCENE_SLOTS)) {
    assert.ok(entry.slot >= 1 && entry.slot <= 53, `${token} 的槽位越界`)
    assert.ok(entry.scene, `${token} 缺中文场合名`)
    assert.equal(seen.has(entry.slot), false, `槽位 ${entry.slot} 被两个 token 占用`)
    seen.set(entry.slot, token)
  }
})

// ---- 补键前的逐行交叉校验：宁可无键，不播错句 ----

test('该舰那个槽位写着别的话 → 判分歧、不给键', () => {
  // 用户实测撞到的那一例（国後 mstId 518）：表推 Sec1→2 号槽，
  // 而游戏 2 号槽是另一段长台词，点下去一个音节都对不上。
  const table = { 1: '占守型海防艦、その二番艦「国後」…', 2: 'ええ？あたしはそういうのはいいかな？…姉さん、' }
  const verdict = resolveVoiceSlot('318-Sec1', 'なに？呼んだ？ふ～', table)
  assert.deepEqual(verdict, { slot: null, basis: 'divergent' })
})

test('对得上就给键，且标成已确认', () => {
  const table = { 3: ' え？占守と間違えた？はぁ？何それ！帰る！ ' }
  assert.deepEqual(resolveVoiceSlot('318-Sec2', 'え？占守と間違えた？はぁ？何それ！帰る！', table), {
    slot: 3,
    basis: 'key-confirmed',
  })
})

test('标点/空白/全半角差异不算分歧（比对归一比一般归一再宽一档）', () => {
  // 宽度是量出来的：真包里只去空白能确认 8502 行，再抹标点只多确认 5 行——
  // 说明标点差异几乎不构成误杀风险，那就取更宽的这一档
  const table = { 2: 'なに、呼んだ・ふー' }
  assert.equal(resolveVoiceSlot('318-Sec1', 'なに？呼んだ？ふ～', table).basis, 'key-confirmed')
})

test('整舰缺席 / 该槽没文本 → 无从校验，允许纯表推', () => {
  assert.deepEqual(resolveVoiceSlot('107-Sec1', 'なにか', null), { slot: 2, basis: 'key-only' })
  assert.deepEqual(resolveVoiceSlot('107-Sec1', 'なにか', { 5: 'x' }), { slot: 2, basis: 'key-only' })
  // 本行没有日文原文时同样无从比对——不因为缺一半资料就拒掉
  assert.deepEqual(resolveVoiceSlot('107-Sec1', '', { 2: 'x' }), { slot: 2, basis: 'key-only' })
})

test('档名认不出场景 → unknown，交给文本匹配兜底（不是分歧）', () => {
  assert.deepEqual(resolveVoiceSlot('109-2ndAnniv', 'なにか', { 2: 'x' }), {
    slot: null,
    basis: 'unknown',
  })
})

test('真包：交叉校验后的键数与分歧量', () => {
  const pack = JSON.parse(
    fs.readFileSync(new URL('../assets/lodes/kcwiki-voice.json', import.meta.url), 'utf8'),
  )
  const subs = JSON.parse(
    fs.readFileSync(new URL('../assets/lodes/subtitle-ja.json', import.meta.url), 'utf8'),
  ).data
  const tally = { 'key-confirmed': 0, 'key-only': 0, divergent: 0, unknown: 0 }
  let total = 0
  for (const [shipId, lines] of Object.entries(pack.data ?? {})) {
    for (const line of lines) {
      const key = `${line.key ?? ''}`
      if (!/^\d{1,4}[a-z]?-/.test(key)) continue // 深海那批 key 形状不同
      total++
      tally[resolveVoiceSlot(key, line.ja, subs[shipId] ?? null).basis]++
    }
  }
  assert.ok(total > 5_000, `真包里舰娘台词行太少（${total}），包可能没装好`)
  const keyed = tally['key-confirmed'] + tally['key-only']
  // 基线放宽只为不被上游改动卡红，别把它当成期望值。
  // 要守的是**方向**：确认的占大头，分歧确实存在且被挡住了。
  assert.ok(keyed / total > 0.85, `有键率只有 ${((keyed / total) * 100).toFixed(1)}%`)
  assert.ok(
    tally.divergent > 100,
    '一条分歧都没有反而可疑：上游确实存在错位与季节占槽（实测 1013 行）',
  )
  assert.ok(tally.divergent / total < 0.2, '分歧占比过高，说明比对归一写窄了，在误杀')
})

test('真包：国後那一格确实被挡住了，同舰其余行照常给键', () => {
  const pack = JSON.parse(
    fs.readFileSync(new URL('../assets/lodes/kcwiki-voice.json', import.meta.url), 'utf8'),
  )
  const subs = JSON.parse(
    fs.readFileSync(new URL('../assets/lodes/subtitle-ja.json', import.meta.url), 'utf8'),
  ).data
  const lines = pack.data['518'] ?? []
  const table = subs['518'] ?? null
  const sec1 = lines.find((line) => line.key === '318-Sec1')
  const sec2 = lines.find((line) => line.key === '318-Sec2')
  assert.ok(sec1 && sec2, '真包里必须有国後这两行')
  assert.equal(resolveVoiceSlot(sec1.key, sec1.ja, table).basis, 'divergent')
  assert.equal(resolveVoiceSlot(sec2.key, sec2.ja, table).slot, 3)
})

// ---- ② 编号 ≤53 才混淆，54 起裸编号直出 ----

test('裸编号按值域判，不按名单：900（特殊攻击）认得出', () => {
  assert.equal(directVoiceIdOf('900'), 900)
  assert.equal(directVoiceIdOf('0'), 0)
  assert.equal(directVoiceIdOf('141'), 141)
  assert.equal(directVoiceIdOf('241'), 241)
  assert.equal(directVoiceIdOf('129'), 129)
  assert.equal(directVoiceIdOf('993'), 993)
})

test('混淆编号绝不能被当成裸编号（那会给舰娘安上不属于她的台词）', () => {
  assert.equal(directVoiceIdOf(`${OBFUSCATED_VOICE_FROM}`), null)
  assert.equal(directVoiceIdOf('193212'), null)
  assert.equal(directVoiceIdOf('100234'), null)
  assert.equal(directVoiceIdOf('abc'), null)
  assert.equal(directVoiceIdOf(''), null)
})

test('音轨路径解析：带 ?version= 的真实 URL 也认得出', () => {
  assert.deepEqual(
    parseVoiceSoundPath(
      'https://w09s.kancolle-server.com/kcs/sound/kcbvtpgrfoqzhq/900.mp3?version=805',
    ),
    { dir: 'bvtpgrfoqzhq', encoded: '900' },
  )
  assert.deepEqual(parseVoiceSoundPath('/kcs/sound/kc9997/1188.mp3'), {
    dir: '9997',
    encoded: '1188',
  })
  assert.equal(parseVoiceSoundPath('/kcs/sound/kc9997/1188.ogg'), null)
})

// ---- ③ kc9997 短剧：那 7 行真的进了随包 ----

test('真包：短剧/群像语音已捞回季节包，且只有中文', () => {
  const pack = JSON.parse(
    fs.readFileSync(
      new URL('../assets/lodes/kcwiki-seasonal-voice.json', import.meta.url),
      'utf8',
    ),
  )
  const skits = pack.data?.skits ?? {}
  const keys = Object.keys(skits)
  assert.ok(keys.length >= 7, `短剧只收到 ${keys.length} 条（实测 7 条）`)
  // 1188 是唯一有实测锚点的一条：用户台账里游戏请求过 /kcs/sound/kc9997/1188.mp3
  const nishimura = skits['1188']
  assert.ok(nishimura, '西村舰队短剧（档名 1188）必须在包里——它是这一族的实测锚点')
  assert.match(nishimura.zh, /山城/)
  assert.equal(EXTRA_VOICE_DIRS.skit, '9997')
  // ⚠️ 2026-08-22 **刻意反转**：原来钉的是「一个日文字段都不能有」（沿任务域的类推口径），
  // 同日用户重算法理后撤销——逐字转写与随包早就有的 kcwiki-voice.ja / subtitle-ja 同级。
  // 短剧是多位舰娘同台的一段演出，日中对照读起来才知道谁在说哪一句。
  for (const [key, entry] of Object.entries(skits)) {
    assert.equal(typeof entry.ja, 'string', `${key} 缺日文原文这一列`)
    assert.ok(entry.ja.trim(), `${key} 的日文是空的`)
    assert.ok(entry.season, `${key} 没有季节归属`)
  }
})

// ---- ④ 跟随态不许固化成默认页 ----

const layoutOf = () => ({
  docks: {
    left: [{ mods: ['ji'], active: 'ji' }],
    right: [{ mods: ['qn', 'bi'], active: 'bi' }],
  },
  focus: false,
})

test('跟随游戏远征页时，落盘的 active 是进页前那一页而不是镖', () => {
  const layout = layoutOf()
  const persisted = layoutForPersist(layout, { dock: 'right', gi: 0, id: 'qn' })
  assert.equal(persisted.docks.right[0].active, 'qn', '固化下来的必须是玩家自己选的那页')
  // 不能就地改运行时那份：界面此刻**确实**停在镖上，改了会让 UI 和状态打架
  assert.equal(layout.docks.right[0].active, 'bi')
  // 没被碰的坞原样共享，不做无谓的深拷贝
  assert.equal(persisted.docks.left, layout.docks.left)
})

test('不在跟随态时原样落盘', () => {
  const layout = layoutOf()
  assert.equal(layoutForPersist(layout, null), layout)
  assert.equal(layoutForPersist(layout, undefined), layout)
})

test('那一页已经不在这一格里了就什么都不改（写个不存在的 active 更糟）', () => {
  const layout = layoutOf()
  assert.equal(layoutForPersist(layout, { dock: 'right', gi: 0, id: 'zi' }), layout)
  assert.equal(layoutForPersist(layout, { dock: 'right', gi: 9, id: 'qn' }), layout)
  assert.equal(layoutForPersist(layout, { dock: 'nope', gi: 0, id: 'qn' }), layout)
})

test('本来就停在镖上时，还原等于不动', () => {
  const layout = layoutOf()
  assert.equal(layoutForPersist(layout, { dock: 'right', gi: 0, id: 'bi' }), layout)
})
