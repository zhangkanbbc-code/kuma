// 播放键的**授予判据**、耳测判例台账（正反两侧）、以及「有语音没有台词」的补词队列。
//
// ---- 这份护栏是刻意反向的（2026-08-23）----
// 2026-08-22 玩家实测两例点出别的句子，于是「整份字幕缺席就不给键」整档执行，撤下 2947 个键。
// 次日复核证据轴后判定**那一刀砍偏了**并恢复：两条判例一条属 kcwiki 表缺陷族
//（国後有 subtitle-ja，自译层那 76 个形态一格都没有，两族不相交）、一条是季节占槽
//（島根丸的槽位号推得没错，档名 `603-Sec1Seika2025` 是游戏方自己的命名）。
// 而**季节占槽是时间性的、对全站所有地址键一视同仁**——按族撤键既没治住它，
// 又把一整层做对了的东西关掉了。
//
// 所以昨天那批断言（「只有 key-confirmed 才给键」「整份缺席不给键」）在这里**整体反转**，
// 反转的理由写在断言原位——口径掉过一次头这件事要留得下痕迹，
// 否则下一个会话只看得到一条没有出处的规矩，然后照着砍第二遍。
//
// 反转之后**不许回退**的三件，逐条钉在下面：
//   ① 耳测负例那两格照旧无键（国後 518/2 分歧、島根丸 1003/2 指路）；
//   ② 季节风险改由「档案实物优先」全域治理，不是按族歧视；
//   ③ 「有语音没有台词」用补词消灭，不用撤键遮蔽（用户当面纠正过一次的口径）。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  VOICE_PLAYBACK_MATCHES,
  VOICE_PLAYBACK_OBSERVATIONS,
  VOICE_TEXT_GAPS,
  voicePlaybackMatchOf,
  voicePlaybackObservationAt,
  voiceTextGapCount,
} from '../src/shared/voice-playback-observations.ts'
import { voiceSlotOfKey } from '../src/shared/voice-scene-slots.ts'

const readLode = (id) => {
  const file = new URL(`../assets/lodes/${id}.json`, import.meta.url)
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
}
const readJi = () =>
  fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')

test('耳测台账（负例）：每条都说得出日期、听到了什么、凭什么这么判', () => {
  assert.ok(VOICE_PLAYBACK_OBSERVATIONS.length >= 2, '开张两条：国後与島根丸')
  const seen = new Set()
  for (const entry of VOICE_PLAYBACK_OBSERVATIONS) {
    const at = `${entry.mstId}-${entry.slot}`
    assert.equal(seen.has(at), false, `${at} 记了两遍`)
    seen.add(at)
    assert.ok(Number.isInteger(entry.mstId) && entry.mstId > 0, `${at} 形态非法`)
    // 槽位是官方语音编号空间；它**通常是推对的**，错的是那一格当时装着什么
    assert.ok(Number.isInteger(entry.slot) && entry.slot >= 1 && entry.slot <= 53, `${at} 槽位越界`)
    assert.match(entry.observedAt, /^\d{4}-\d{2}-\d{2}$/, `${at} 没有实测日期`)
    assert.ok(entry.expected.trim(), `${at} 没写界面上当时显示的是哪一句`)
    assert.ok(entry.heard.trim(), `${at} 没写玩家实际听到的是哪一句`)
    assert.ok(['season-slot', 'slot-offset', 'unknown'].includes(entry.verdict), `${at} 判定非法`)
    // 没有凭据的台账条目与凭空捏造无法区分，而它看起来一模一样
    assert.ok(entry.evidence.trim().length >= 20, `${at} 的凭据太单薄`)
  }
})

// ---- 正例也入账（2026-08-23 开张）----
// 只收翻车案的台账会把人引向一个错觉：**没被记下来的格子都可疑**。
// 而把键逐格放回去的正路是「一格一证」，证据有正有负——只收一半就做全局判断，
// 正是 08-22 那一刀砍偏的方式。

test('耳测台账（正例）：条目干净，且不与负例在同一格上打架', () => {
  assert.ok(VOICE_PLAYBACK_MATCHES.length >= 1, '至少要有島根丸那一条——恢复自译族键的直接依据')
  const seen = new Set()
  for (const entry of VOICE_PLAYBACK_MATCHES) {
    assert.ok(Number.isInteger(entry.mstId) && entry.mstId > 0, '形态非法')
    assert.equal(seen.has(entry.mstId), false, `${entry.mstId} 记了两遍`)
    seen.add(entry.mstId)
    assert.match(entry.observedAt, /^\d{4}-\d{2}-\d{2}$/, `${entry.mstId} 没有实测日期`)
    assert.ok(entry.scope.trim().length >= 6, `${entry.mstId} 没写实测覆盖到哪儿`)
    assert.ok(entry.evidence.trim().length >= 20, `${entry.mstId} 的凭据太单薄`)
    for (const slot of entry.slots ?? []) {
      // 同一格既记「相符」又记「听到别的句子」＝台账自相矛盾，而两条看起来都成立
      assert.equal(
        voicePlaybackObservationAt(entry.mstId, slot),
        null,
        `${entry.mstId} 槽${slot} 同时进了正例与负例`,
      )
    }
    for (const slot of entry.except ?? []) {
      // 反过来：正例里写明「这一格除外」的，负例台账里必须真的有那一条
      assert.ok(
        voicePlaybackObservationAt(entry.mstId, slot),
        `${entry.mstId} 槽${slot} 记成了例外，负例台账里却查不到`,
      )
    }
  }
})

test('島根丸那一条正例：它是恢复自译族播放键的实证依据，不许悄悄消失', () => {
  const match = voicePlaybackMatchOf(1_003)
  assert.ok(match, '島根丸的正例不见了——那恢复播放键这一改就没有实证依据了')
  assert.deepEqual([...(match.except ?? [])], [2], '除外的应当只有秘书舰1 那一格')
  assert.equal(match.slots, undefined, '玩家没有逐格点名，就不许替他写成逐格证据')
})

test('查台账按 (形态, 槽位)；槽位为空一律查不到，不许模糊匹配', () => {
  assert.equal(voicePlaybackObservationAt(1_003, 2)?.verdict, 'season-slot')
  assert.equal(voicePlaybackObservationAt(518, 2)?.verdict, 'slot-offset')
  assert.equal(voicePlaybackObservationAt(1_003, 3), null)
  assert.equal(voicePlaybackObservationAt(1_003, null), null)
  assert.equal(voicePlaybackObservationAt(999_999, 2), null)
})

test('島根丸那一例的取证：槽位推对了，错的是那一格当季装着季节语音', (t) => {
  const seasonal = readLode('kcwiki-seasonal-voice')
  const kanso = readLode('kanso-voice')
  const subtitleJa = readLode('subtitle-ja')
  if (!seasonal || !kanso || !subtitleJa) {
    t.skip('缺台词域矿脉，跳过')
    return
  }
  // ① 她整份字幕缺席——交叉校验那道闸门根本没得用，这是这一例能发生的前提
  assert.equal(Object.keys(subtitleJa.data['1003'] ?? {}).length, 0)
  // ② 常规层在 2 号槽写的是那句短的「秘书舰1」。
  //    取证时（08-23 晨）这句在自译层；当日 kcwiki 重抓追录了 1003、自译层槽位级
  //    退位交棒，证物换成 kcwiki 行——两句同文（自译写「御用」，kcwiki 写「ご用」）。
  const voice = readLode('kcwiki-voice')
  const row = (voice?.data?.['1003'] ?? [])
    .map((entry) => ({ ...entry, slot: voiceSlotOfKey(entry.key) }))
    .find((entry) => entry.slot === 2)
  assert.ok(row, '常规层没有島根丸的 2 号槽')
  assert.match(row.ja, /ご用ですか|御用ですか/)
  // ③ 玩家听到的那句在季节包里，档名自己写着 Sec1（→ 2 号槽）与 Seika（盛夏）
  const summer = (seasonal.data.ships['1003'] ?? []).find((entry) => /Sec1Seika/.test(entry.key))
  assert.ok(summer, '季节包里找不到那句盛夏台词')
  assert.equal(summer.slot, 2, '档名的场景 token 推出来就是 2 号槽')
  assert.match(summer.ja, /Victorious/)
  // ④ 于是两句**共用同一个槽位**：她平时那一句的语音当季被盛夏版顶替，过季回来。
  //    ⚠️ 这一例证明的是「季节占槽」，**不是**「自译层的槽位映射不可信」——
  //    档名 Sec1 是游戏方自己的命名，等于官方替我们确认了这艘舰的 2 号槽就是秘书舰1。
  assert.equal(row.slot, summer.slot)
})

test('两族不相交：自译层覆盖的形态一个都没有 subtitle-ja，国後却有', (t) => {
  const kanso = readLode('kanso-voice')
  const subtitleJa = readLode('subtitle-ja')
  if (!kanso || !subtitleJa) {
    t.skip('缺台词域矿脉，跳过')
    return
  }
  // 这一条就是 2026-08-23 判定「那一刀砍偏了」的关键：国後那一例的病根在
  // kcwiki 台词表（她有字幕表、能校验、当场判分歧），而自译层是另一族。
  assert.ok(Object.keys(subtitleJa.data['518'] ?? {}).length > 0, '国後应当有字幕表')
  for (const formId of Object.keys(kanso.data.ships)) {
    assert.equal(
      Object.keys(subtitleJa.data[formId] ?? {}).length,
      0,
      `${formId} 有字幕表了——那这一层的 basis 该重编一次包`,
    )
  }
})

// ---- 授键判据：这里的每一条都是 08-22 那批断言的**反面** ----

test('自译层：wikiwiki-mapped 给键——1439 行整层恢复', (t) => {
  const kanso = readLode('kanso-voice')
  if (!kanso) {
    t.skip('缺 kanso-voice，跳过')
    return
  }
  // ⚠️ 反转说明：08-22 这里断言的是「一个键都不给」（`assert.notEqual(row.basis, 'key-confirmed')`
  // 再数 key-only > 2000）。那条判据来自「无从校验＝可能会错」，被证据轴复核推翻——
  // 无从校验只说明我们手上没有第二份东西可以对，不说明它已经错了。
  let mapped = 0
  for (const [formId, rows] of Object.entries(kanso.data.ships)) {
    for (const row of rows) {
      assert.notEqual(
        row.basis,
        'key-only',
        `${formId} ${row.key} 还写着 key-only——这一层的槽位来源只有 wikiwiki 场合列，` +
          '该记 wikiwiki-mapped（标出处，不标「没校验」）',
      )
      if (row.basis === 'wikiwiki-mapped') mapped += 1
    }
  }
  // 08-22 恢复键时整层 2642 行；08-23 kcwiki 两轮重抓后自补层做了两轮槽位级退位
  //（第一轮留任 1509 行，第二轮台词页清单换穷举后再退 56 行），
  // 现留任 1453 行（wikiwiki-mapped 1439 + ambiguous 14）。判据的两半都不变：
  // key-only 一行不许有、mapped 是这一层的绝对主体。
  assert.ok(mapped > 1_400, `wikiwiki-mapped 只有 ${mapped} 行，与预期（1439）差太多`)
})

test('渲染层：授键判据已按新政策反转，且没有留下旧的整族闸门', () => {
  const ji = readJi()
  // 自译层：key-confirmed 与 wikiwiki-mapped 都给键
  assert.match(ji, /line\.basis !== 'key-confirmed' && line\.basis !== 'wikiwiki-mapped'/)
  // ⚠️ 08-22 的 `if (line.basis !== 'key-confirmed') return null` 不许回潮
  assert.doesNotMatch(
    ji,
    /if \(line\.basis !== 'key-confirmed'\) return null/,
    '自译层又被收回到「只有 key-confirmed 给键」了——那会把 2642 个键再撤一遍',
  )
  // kcwiki/兜底那一路：`unverified` 那道整族闸门整个拆掉了
  assert.doesNotMatch(
    ji,
    /const unverified = resolved\.basis === 'key-only'/,
    '「整份字幕缺席就不给键」那道闸门回潮了——它治的是错误的轴',
  )
  // 整页无钮时不许再挂「▶ 可播放」（这一条不反转，它管的是另一件事）
  assert.match(ji, /均无对应音轨/)
  // 台账要真的被消费——不然它就是一份没人看的死数据
  assert.match(ji, /voicePlaybackObservationAt\(playbackMstId, slot\)/)
})

test('播放优先级：档案实听实物 > 地址现取，且这条对所有键一视同仁', () => {
  const ji = readJi()
  // 单一收口：三条渲染路径都从这里拿地址，各写一份必然漂
  assert.match(ji, /const voicePlaybackFor = \(/)
  // ① 耳测负例 → 一个键都不给
  assert.match(ji, /if \(voicePlaybackObservationAt\(playbackMstId, slot\)\) return null/)
  // ② 档案实物优先——**顺序**是判据本身，倒过来就等于把季节治理拆了
  assert.match(
    ji,
    /const kept = archivedVoiceUrl\(playbackMstId, slot\)\s*\n[^\n]*\n\s*if \(kept\) return \{ url: kept, fromArchive: true, pathname: null \}/,
  )
  // ③ 兜底才是地址现取
  assert.match(ji, /const live = voiceUrl\(playbackMstId, slot\)/)
  // 不许再出现「按 basis 决定要不要走档案」那种按族区别对待
  assert.doesNotMatch(
    ji,
    /archivedVoiceUrl\([^)]*\)[^\n]*basis/,
    '档案优先被写成了按 basis 分支——季节占槽对所有地址键一视同仁，不分族',
  )
})

// ---- 播放即入档 + 远端回退开关同管语音（2026-08-23）----

test('图鉴里播成功的那一句会入档，且只在「地址现取」时入', () => {
  const ji = readJi()
  const voice = fs.readFileSync(new URL('../src/renderer/kcs-voice.ts', import.meta.url), 'utf8')
  // 档案里那一份本来就在档案里，不带 path，不该再入一次
  assert.match(ji, /if \(kept\) return \{ url: kept, fromArchive: true, pathname: null \}/)
  // 地址现取的那一档才带身份
  assert.match(ji, /pathname: voicePathname\(playbackMstId, slot\)/)
  // 入档发生在 play\(\) **兑现之后**：没播成的不该入档
  assert.match(ji, /\.play\(\)\s*\n\s*\.then\(\(\) => \{/)
  // 续播（2026-08-25 起点同一条能接着放）不再入一次：冷启动那一次已经记过，
  // 同一条重复入档是白做功
  assert.match(ji, /if \(pathname && action === 'restart'\) noteVoicePlayed\(pathname, url\)/)
  // 季节行那一条尤其该入档：过季就换回去了，此刻不收就再也收不到
  assert.match(ji, /data-voice-path="\$\{esc\(\s*\n?\s*voicePathname\(mstId, line\.slot!\) \?\? ''/)
  // 单向 IPC：播放不等转存
  assert.match(voice, /ipcRenderer\.send\('kanso:archive-capture-voice'/)
})

test('钥里的远端回退开关同样管语音：关掉就只走档案/缓存', () => {
  const voice = fs.readFileSync(new URL('../src/renderer/kcs-voice.ts', import.meta.url), 'utf8')
  const yu = fs.readFileSync(new URL('../src/renderer/modules/yu.ts', import.meta.url), 'utf8')
  const capture = fs.readFileSync(
    new URL('../src/main/archive-capture.ts', import.meta.url),
    'utf8',
  )
  // 取音轨那一步：没缓存又不许回退 → 没有地址（于是没有钮）
  assert.match(voice, /return allowRemote && gameHost \? `https:\/\/\$\{gameHost\}\$\{pathname\}` : null/)
  // 立绘与语音**同一个开关**，两处都得接上——只接一处就是承诺不一致
  assert.match(yu, /setAllowRemoteArt\(next\)\s*\n\s*setAllowRemoteVoice\(next\)/)
  assert.match(yu, /setAllowRemoteArt\(config\.get\('kanso\.remoteArt', true\)\)/)
  assert.match(yu, /setAllowRemoteVoice\(config\.get\('kanso\.remoteArt', true\)\)/)
  // 入档那条新路同样受它管（关掉就不走游戏服务器那一步）
  assert.match(capture, /if \(!config\.get\('kanso\.remoteArt', true\)\) return null/)
  // 三类网络边界要写明白，给下一个会话当坐标
  for (const boundary of ['kcsapi 红线', '静态资源白区', '档案零网络']) {
    assert.ok(capture.includes(boundary), `边界说明里缺「${boundary}」`)
  }
})

test('关掉远端回退时那一格如实说原因，不留一个没说法的灰钮', () => {
  const ji = readJi()
  assert.match(ji, /const voiceRemoteOffNote = /)
  assert.match(ji, /if \(slot == null \|\| voiceState\(\)\.enabled\) return ''/)
  assert.match(ji, /「未缓存的立绘\/语音从游戏资源服务器取」/)
  // 档案里有实物的格照旧能播——档案零网络，与这个开关无关
  assert.match(ji, /const kept = archivedVoiceUrl\(playbackMstId, slot\)/)
})

test('两条负例的格照旧无键：国後判分歧、島根丸指路', (t) => {
  const voice = readLode('kcwiki-voice')
  const subtitleJa = readLode('subtitle-ja')
  if (!voice || !subtitleJa) {
    t.skip('缺台词域矿脉，跳过')
    return
  }
  // 国後 518/2：kcwiki 的 318-Sec1 在她音轨里根本找不到 → 交叉校验判分歧，没有槽位可给
  const sec1 = (voice.data['518'] ?? []).find((row) => row.key === '318-Sec1')
  assert.ok(sec1, '真包里必须有国後那一行')
  const table = subtitleJa.data['518'] ?? {}
  const fold = (v) => `${v ?? ''}`.replace(/\s+/g, '')
  assert.notEqual(fold(table['2']), fold(sec1.ja), '前提：她 2 号槽写的确实是别的话')
  // 島根丸 1003/2：台账挡着，且悬停是**指路**而不是「按钮坏了」
  assert.ok(voicePlaybackObservationAt(1_003, 2), '島根丸那一格的负例条目不见了')
  const ji = readJi()
  assert.match(ji, /if \(voicePlaybackObservationAt\(playbackMstId, slot\)\) return null/)
  // 08-24 与 08-26 两次文案清洗都改过措辞，钉的是**语义**：
  // 说清是季节版顶替，并指路到季节段（08-26 按拟稿断句成「 · 」、去掉尾巴）
  assert.match(ji, /当前槽位为季节版/)
  assert.match(ji, /对应台词见下方「季节限定台词」/)
})

test('实测判例排在推断之前，且判分歧的格照样查得到自己的判例', () => {
  const ji = readJi()
  // ① 次序：台账（实测）在 voiceFixNote（包与包之间推出来的病因）之前。
  //    倒过来写不会报错，只会让最该说清楚的那几格（判过分歧、又有耳测判例）
  //    显示一句推断出来的说明——国後 518/2 正是这样一格。
  assert.match(
    ji,
    /voiceObservedOffNote\(playbackMstId, noteSlot\) \|\|\s*\n\s*voiceFixNote\(fix\)/,
    '耳测判例被排到推断之后了',
  )
  // ② 查台账用的槽位不能是授键用的那个：判分歧时它已经是 null，
  //    照那个查等于让有判例的格一个字都说不出来。
  assert.match(ji, /const noteSlot = vid \?\? \(\/\^\\d\+\$\/\.test\(k\) \? parseInt\(k, 10\) : voiceSlotOfKey\(k\)\)/)
})

// ---- 季节台词的「证据点亮」：查得出此刻挂的是哪一条，那一条就能播 ----

test('台账指名的季节档名必须在季节包里真的存在，且槽位对得上', (t) => {
  const seasonal = readLode('kcwiki-seasonal-voice')
  if (!seasonal) {
    t.skip('缺 kcwiki-seasonal-voice，跳过')
    return
  }
  for (const entry of VOICE_PLAYBACK_OBSERVATIONS) {
    if (!entry.mountedSeasonalKey) continue
    // 指向不存在的档名 = 界面上那一格既不指路也点不亮，而它看起来和配好了一模一样
    const rows = seasonal.data.ships[`${entry.mstId}`] ?? []
    const line = rows.find((row) => row.key === entry.mountedSeasonalKey)
    assert.ok(line, `${entry.mstId} 的 ${entry.mountedSeasonalKey} 在季节包里找不到`)
    assert.equal(line.slot, entry.slot, `${entry.mountedSeasonalKey} 的槽位与台账记的对不上`)
    assert.ok(`${line.ja}`.trim() || `${line.zh}`.trim(), '指名的那一条既没日文也没中文')
    assert.ok(seasonal.data.seasons[line.season], `${line.season} 不是一个已知季节`)
  }
})

test('只有 season-slot 那一档才配 mountedSeasonalKey——槽位错位那种没有「此刻挂着谁」可言', () => {
  for (const entry of VOICE_PLAYBACK_OBSERVATIONS) {
    if (entry.mountedSeasonalKey) assert.equal(entry.verdict, 'season-slot', `${entry.mstId} 判定与字段不符`)
  }
})

test('渲染层：证据点亮一格一证，不许退化成按日期猜当季', () => {
  const ji = readJi()
  // 季节行按台账逐格给键；档案实物优先于它
  assert.match(ji, /const mountedHere =\s*\n?\s*!url && line\.slot != null/)
  assert.match(ji, /const liveUrl = mountedHere \? voiceUrl\(mstId, line\.slot!\) : null/)
  // 不许出现「按当前日期算当季」那类全局推断
  assert.doesNotMatch(ji, /当季.*new Date\(|new Date\(\).*当季/, '出现了按日期猜当季的推断')
})

// ---- 「有语音没有台词」是补词队列，不是撤键理由 ----

test('补词队列：每条都说得出形态、槽位、能从哪补', () => {
  assert.ok(VOICE_TEXT_GAPS.length > 0)
  const seen = new Set()
  for (const gap of VOICE_TEXT_GAPS) {
    assert.ok(Number.isInteger(gap.mstId) && gap.mstId > 0, '形态非法')
    assert.equal(seen.has(gap.mstId), false, `${gap.mstId} 记了两遍`)
    seen.add(gap.mstId)
    assert.ok(gap.slots.length > 0, `${gap.mstId} 没写是哪几格`)
    for (const slot of gap.slots) {
      assert.ok(Number.isInteger(slot) && slot >= 1 && slot <= 53, `${gap.mstId} 槽位 ${slot} 越界`)
    }
    assert.deepEqual([...gap.slots].sort((a, b) => a - b), [...gap.slots], `${gap.mstId} 槽位没排序`)
    assert.ok(gap.note.trim().length >= 8, `${gap.mstId} 没写能从哪补`)
  }
  assert.equal(voiceTextGapCount(), VOICE_TEXT_GAPS.reduce((sum, g) => sum + g.slots.length, 0))
})

test('补词队列里的格子确实还没有词——补上了就该从名单里划掉', (t) => {
  const kanso = readLode('kanso-voice')
  const voice = readLode('kcwiki-voice')
  const subtitleZh = readLode('subtitle-zh')
  if (!kanso || !voice || !subtitleZh) {
    t.skip('缺台词域矿脉，跳过')
    return
  }
  const stale = []
  for (const gap of VOICE_TEXT_GAPS) {
    const id = `${gap.mstId}`
    for (const slot of gap.slots) {
      const inKanso = (kanso.data.ships[id] ?? []).some((row) => row.slot === slot)
      const inSubtitle = Boolean(`${subtitleZh.data[id]?.[`${slot}`] ?? ''}`.trim())
      if (inKanso || inSubtitle) stale.push(`${id} 槽${slot}`)
    }
  }
  assert.deepEqual(stale, [], `这些格已经有词了，该从补词队列里划掉：${stale.join('、')}`)
})

test('实时字幕：拿不到词就一条都不出，绝不显示对不上的词', () => {
  const subtitle = fs.readFileSync(new URL('../src/renderer/voice-subtitle.ts', import.meta.url), 'utf8')
  // 三条出词路径（母港/战斗、短剧、深海/NPC）都得有这道闸门
  assert.ok(
    (subtitle.match(/if \(!text\) return \[\]/g) ?? []).length >= 3,
    '有出词路径缺了「没词就不出字幕」那道闸门',
  )
})

test('「有字幕表、只是该槽无文本」那一族照旧给键——撤键治的是播错句，不是没声音', () => {
  const ji = readJi()
  // 这一族（1283 个键）从头到尾没被动过。08-22 用一条带 `!playbackTable` 限定的判据
  // 把它与「整份缺席」那族分开；08-23 整族撤键撤销后，那条判据连同限定一起没了，
  // 于是这里改成钉**结果**：`key-only` 不再是任何一处的拒键理由。
  assert.doesNotMatch(
    ji,
    /basis === 'key-only'[^\n]*return null|=== 'key-only'\)\s*return null/,
    'key-only 又变成拒键理由了——它治不了播错句，只会把没声音的格也一起关掉',
  )
})

test('三条渲染路径都把入档身份传下去——漏一处就是「播了却不点亮」', () => {
  const ji = readJi()
  // 2026-08-26 文案清扫删了「播放档案里留存的那一份」这句悬停（族 7），
  // 随之退掉了只为它存在的 fromArchive 形参——入档身份（pathname）这条真链路
  // 一处都没动，钉子跟着去掉那一个参数即可，语义不放松。
  // ① kcwiki / 兜底那一路
  assert.match(ji, /play\?\.url \?\? null,\s*\n\s*offNote,\s*\n\s*correction\?\.textSource,\s*\n\s*play\?\.pathname,/)
  // ② 自译层那一路
  assert.match(ji, /kansoVoiceOffNote\(mstId, row\),\s*\n\s*'kanso',\s*\n\s*play\?\.pathname,/)
  // ③ 季节行（证据点亮的那一条）
  assert.match(ji, /data-voice-path="\$\{esc\(\s*\n?\s*voicePathname\(mstId, line\.slot!\)/)
})
