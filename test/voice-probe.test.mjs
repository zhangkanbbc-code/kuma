// 「音频先行骨架」的护栏。
//
// 用户 2026-08-23 拍板的新设计：没有台词的新船也该把播放放出来——理论上能知道
// 这句话什么时候会说，先把播放占位放上，等文字到了再填。
//
// 这里盯的每一条都是「写反了不报错、只是某天默默变成另一种东西」那一类：
//  · 骨架把 53 个槽全铺开 → 打开一页就是对游戏服务器的 53 连发（口径整个反掉）；
//  · 把 5xx/超时也当成「官方没有」→ 一次网络抖动永久把一格好好的语音判死；
//  · 骨架与正常行并存 → 同一格两行，文本背书那套判据被绕过去。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import plan from '../dist/shared/voice-probe-plan.js'
import specialSlots from '../dist/shared/voice-scene-slots.js'

const {
  VOICE_ABSENT_MAX_ENTRIES,
  VOICE_SLOT_MAX,
  bareArchiveVoiceRows,
  groupVoiceAbsentByMonth,
  planVoiceAbsentUpdate,
  sanitizeVoiceAbsentEntry,
  voiceAbsentAfterClear,
  voiceAbsentDayOf,
  voiceAbsentMonthOf,
  voiceAbsentStillValid,
  voiceProbeShortCircuits,
  voiceProbeVerdictOf,
  voiceSkeletonSlots,
} = plan
const yu = fs.readFileSync(new URL('../src/renderer/modules/yu.ts', import.meta.url), 'utf8')
const {
  SPECIAL_VOICE_SLOTS,
  SPECIAL_VOICE_SLOT_IDS,
  bareVoiceSceneName,
  isSpecialVoiceSlot,
  specialVoiceScene,
  specialVoiceSlotIdsFor,
} = specialSlots

/** Graf Zeppelin 系的形态号（本机主数据快照实测：432 本体、353 改）。 */
const GRAF = [432, 353]
/** 随便一艘不是 Graf 的舰（時雨改二），用来验「限定槽位一格都不铺」。 */
const NOT_GRAF = 145
/** 全局裸编号槽位 = 表里不带 `onlyMst` 的那些 */
const GLOBAL_SPECIAL_IDS = specialVoiceSlotIdsFor(null)
/** 骨架空间（不限定形态）= 混淆段 1..53 + 全局裸编号槽位 */
const SKELETON_SPACE = VOICE_SLOT_MAX + GLOBAL_SPECIAL_IDS.length

const ji = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
const probeMain = fs.readFileSync(new URL('../src/main/voice-probe.ts', import.meta.url), 'utf8')
const probeRenderer = fs.readFileSync(
  new URL('../src/renderer/voice-probe.ts', import.meta.url),
  'utf8',
)

// ---- ① 骨架生成 ----

test('文本全空的形态：摆完整骨架（整页空白比多摆几行糟得多）', () => {
  const slots = voiceSkeletonSlots({ covered: new Set() })
  assert.equal(slots.length, SKELETON_SPACE)
  assert.equal(slots[0], 1)
  // 混淆段之后接裸编号段，顺序不许乱：排序键就是这个数组的次序
  assert.equal(slots[VOICE_SLOT_MAX - 1], VOICE_SLOT_MAX)
  assert.deepEqual(slots.slice(VOICE_SLOT_MAX), GLOBAL_SPECIAL_IDS)
})

test('骨架空间含裸编号槽位，且一律排在 53 之后', () => {
  // 2026-08-23：编号 ≤53 才混淆，54 起裸编号直出。玩家发动特殊攻击时游戏播的
  // 就是 900.mp3（本机台账里 Richelieu改 的这一条被记成「认不出」16 次），
  // 而三道闸（isPlayableVoiceId / encodeVoiceFile / 骨架空间）把它挡在界面之外。
  const slots = voiceSkeletonSlots({ covered: new Set() })
  for (const slot of GLOBAL_SPECIAL_IDS) {
    assert.ok(slots.includes(slot), `裸编号槽位 ${slot} 不在骨架空间里`)
    assert.ok(slots.indexOf(slot) >= VOICE_SLOT_MAX, `裸编号槽位 ${slot} 排到了混淆段里`)
    assert.ok(slot > VOICE_SLOT_MAX, '裸编号必须大于混淆段上界')
  }
  assert.ok(slots.includes(900), '特殊攻击（900）必须摆出来')
  // 判据是**表**不是值域：54..899 那一大片根本不存在的编号一个都不许进来
  assert.equal(slots.includes(54), false)
  assert.equal(slots.includes(500), false)
  assert.equal(slots.includes(899), false)
})

test('129 放置②在全局骨架里——性质与时报一样，一行成本，无此格的舰一次 404 自剪', () => {
  // 2026-08-23 用户拍板全局收：好感/士气 ≥50 时官方改播的那句放置台词，
  // 常规 29 号槽是平时那句，两者是两个文件、两句话。
  assert.equal(isSpecialVoiceSlot(129), true)
  assert.ok(GLOBAL_SPECIAL_IDS.includes(129), '129 没进全局骨架')
  assert.equal(specialVoiceScene(129), '放置②')
  for (const mstId of [NOT_GRAF, ...GRAF, 1, 999]) {
    assert.ok(
      voiceSkeletonSlots({ covered: new Set(), mstId }).includes(129),
      `形态 ${mstId} 的骨架里没有 129`,
    )
  }
  // 已有文本行的形态照旧让位
  assert.equal(voiceSkeletonSlots({ covered: new Set([129]), mstId: 1 }).includes(129), false)
})

test('917/918 只在 Graf 家摆——别的形态一行死格都不许铺', () => {
  // Graf 家的形态号是本机主数据快照实测的（api_mst_ship 按舰名匹配 Graf Zeppelin）：
  // 432 = Graf Zeppelin、353 = Graf Zeppelin改，无第三个形态。
  for (const mstId of GRAF) {
    const slots = voiceSkeletonSlots({ covered: new Set(), mstId })
    assert.ok(slots.includes(917), `Graf 形态 ${mstId} 的骨架里没有 917`)
    assert.ok(slots.includes(918), `Graf 形态 ${mstId} 的骨架里没有 918`)
    assert.equal(slots.length, SKELETON_SPACE + 2)
    // 仍旧排在混淆段之后，且不打乱升序
    const tail = slots.slice(VOICE_SLOT_MAX)
    assert.deepEqual([...tail].sort((left, right) => left - right), tail)
  }
  // 别的舰：一格都不铺。全局摆就是在 800+ 形态页上各铺两行必 404 的死格
  for (const mstId of [NOT_GRAF, 1, 576, 911]) {
    const slots = voiceSkeletonSlots({ covered: new Set(), mstId })
    assert.equal(slots.includes(917), false, `形态 ${mstId} 铺了 917 死格`)
    assert.equal(slots.includes(918), false, `形态 ${mstId} 铺了 918 死格`)
    assert.equal(slots.length, SKELETON_SPACE)
  }
})

test('限定字段缺省 = 全局行为一字不变（不传 mstId 也不铺限定槽位）', () => {
  const withoutId = voiceSkeletonSlots({ covered: new Set() })
  assert.deepEqual(withoutId, voiceSkeletonSlots({ covered: new Set(), mstId: NOT_GRAF }))
  assert.deepEqual(withoutId, voiceSkeletonSlots({ covered: new Set(), mstId: null }))
  // 表里不带 onlyMst 的那些，任何形态都摆——「缺省 = 全局」这半边也要成立
  const limited = new Set(
    SPECIAL_VOICE_SLOTS.filter((entry) => entry.onlyMst).map((entry) => entry.slot),
  )
  for (const entry of SPECIAL_VOICE_SLOTS) {
    if (limited.has(entry.slot)) continue
    assert.ok(withoutId.includes(entry.slot), `全局槽位 ${entry.slot} 缺省时没摆`)
  }
  // 而限定的那几个确实被挡住了（不然上面这条就是空转）
  assert.ok(limited.size > 0, '一个限定槽位都没有，这条护栏在空转')
  for (const slot of limited) assert.equal(withoutId.includes(slot), false)
})

test('裸编号表：编号有名字，未列编号一律不认', () => {
  assert.equal(isSpecialVoiceSlot(900), true)
  assert.equal(isSpecialVoiceSlot(141), true)
  assert.equal(isSpecialVoiceSlot(54), false, '值域判据混进展示侧了')
  assert.equal(isSpecialVoiceSlot(53), false, '混淆段不归这张表管')
  assert.equal(isSpecialVoiceSlot('900'), false)
  assert.equal(isSpecialVoiceSlot(null), false)
  for (const entry of SPECIAL_VOICE_SLOTS) {
    assert.ok(entry.scene.length > 0, `槽位 ${entry.slot} 没有场合名`)
    assert.equal(specialVoiceScene(entry.slot), entry.scene)
  }
  assert.equal(specialVoiceScene(54), '', '表外编号不许凭空得到名字')
  // 表按编号升序：骨架直接照这个顺序接在 53 之后
  const sorted = [...SPECIAL_VOICE_SLOT_IDS].sort((left, right) => left - right)
  assert.deepEqual([...SPECIAL_VOICE_SLOT_IDS], sorted)
})

test('有词形态同样铺满：没被文本占住的格全摆（08-23 裁定「不展示代表没有」）', () => {
  // 第一版这里断言的是「只摆有旁证的那几格」——用户以国後的报时为判例推翻：
  // 她的报时音频在游戏里存在、三个文本源都没收，留白等于谎称她没有。
  // 噪音的答案是探测钮自身（404 自剪枝、转成无配音态），不是留白。
  const slots = voiceSkeletonSlots({ covered: new Set([1, 2, 3]) })
  assert.equal(slots.length, SKELETON_SPACE - 3)
  assert.ok(slots.includes(30) && slots.includes(53), '报时段（30–53）必须在骨架里')
  assert.ok(!slots.includes(2), '已有文本行的格骨架不碰')
})

test('骨架**只填空**：有文本行的格一律不摆，两套判据不许并存', () => {
  const covered = new Set([1, 2, 3, 4, 5, 141])
  const slots = voiceSkeletonSlots({ covered })
  for (const slot of covered) {
    assert.equal(slots.includes(slot), false, `槽位 ${slot} 已有文本行，骨架不该再摆一行`)
  }
  assert.equal(slots.length, SKELETON_SPACE - covered.size)
})

test('槽位空间不越界：混淆段只在 1..53，其余只能是表里的裸编号', () => {
  const slots = voiceSkeletonSlots({ covered: new Set([0, -3, 54, 999]) })
  for (const slot of slots) {
    assert.ok(
      (slot >= 1 && slot <= VOICE_SLOT_MAX) || isSpecialVoiceSlot(slot),
      `槽位 ${slot} 越界`,
    )
  }
  assert.equal(slots.length, SKELETON_SPACE, '表外的 covered 值不该吃掉任何合法槽位')
})

// ---- ①-b 亲历显形：档案里的表外裸编号自动长行 ----
//
// 展示侧那张表只认写死的名单——对，但必然滞后：官方新发明一个编号，从玩家在游戏里
// 听到、到艦素把它收进表，那一句在图鉴里不存在。而实物早就躺在档案里。
// 这一段把判据倒过来：**存在性由实物本身背书**。这里盯的是「倒过来之后别把别的东西
// 也放进来」——重复摆行、把混淆编号当裸编号、以及凭空给一个不知道的编号安场合名。

test('友军场合名按 KC3 语义推：末两位是活动海域号，段序是第几句', () => {
  assert.equal(bareVoiceSceneName(141), '友军舰队（海域41）一')
  assert.equal(bareVoiceSceneName(143), '友军舰队（海域43）一')
  assert.equal(bareVoiceSceneName(161), '友军舰队（海域61）一')
  assert.equal(bareVoiceSceneName(241), '友军舰队（海域41）二')
  assert.equal(bareVoiceSceneName(261), '友军舰队（海域61）二')
  assert.equal(bareVoiceSceneName(342), '友军舰队（海域42）三')
  assert.equal(bareVoiceSceneName(350), '友军舰队（海域50）三')
  // 边界外：不知道是什么场合就**不编一个**，编号本身是唯一诚实的说法
  for (const slot of [140, 240, 341, 900, 999]) {
    assert.equal(bareVoiceSceneName(slot), `音轨 #${slot}`, `${slot} 被误认成友军舰队`)
  }
  assert.equal(bareVoiceSceneName(0), '')
  assert.equal(bareVoiceSceneName(-1), '')
  assert.equal(bareVoiceSceneName('141'), '', '字符串不许混进来')
  assert.equal(bareVoiceSceneName(null), '')
})

test('海域号涨过 61 也认得出来：三段外推到语义上界，不卡在当年那份快照上', () => {
  // 实证只到 161/261/350（KC3 名单的快照），可活动海域号还在涨。上界卡死的后果是
  // 新一期友军在图鉴里显示成「音轨 #162」——而「末两位 = 活动海域号」这条语义
  // 本身连续，没有理由到 62 就断。
  assert.equal(bareVoiceSceneName(162), '友军舰队（海域62）一')
  assert.equal(bareVoiceSceneName(199), '友军舰队（海域99）一')
  assert.equal(bareVoiceSceneName(262), '友军舰队（海域62）二')
  assert.equal(bareVoiceSceneName(299), '友军舰队（海域99）二')
  assert.equal(bareVoiceSceneName(351), '友军舰队（海域51）三')
  assert.equal(bareVoiceSceneName(399), '友军舰队（海域99）三')
  // 外推只在段内：段与段之间的空档、以及第三段之前的 341 照旧如实给编号。
  // 341 不是笔误——海域 41 那一期没有第三句，所以第三段从 342 起。
  assert.equal(bareVoiceSceneName(341), '音轨 #341')
  assert.equal(bareVoiceSceneName(130), '音轨 #130')
  assert.equal(bareVoiceSceneName(200), '音轨 #200')
  assert.equal(bareVoiceSceneName(240), '音轨 #240')
  assert.equal(bareVoiceSceneName(300), '音轨 #300')
  assert.equal(bareVoiceSceneName(400), '音轨 #400')
})

test('外推只改名字，没顺手把编号收进主动摆行的表', () => {
  // ⚠️ 两侧分界（voice-scene-slots 文件头）：`SPECIAL_VOICE_SLOTS` 是**主动**摆行/探测
  // 的名单，判宽了就是拿几百个不存在的编号去骚扰服务器；`bareVoiceSceneName`
  // 只管**已经发生过的事**该叫什么名字。放宽段界只许动后者。
  for (const slot of [162, 199, 262, 299, 351, 399]) {
    assert.equal(isSpecialVoiceSlot(slot), false, `${slot} 混进了主动摆行的表`)
    assert.equal(specialVoiceSlotIdsFor(null).includes(slot), false)
    assert.equal(voiceSkeletonSlots({ covered: new Set() }).includes(slot), false)
  }
})

test('表里 141/241 的名字与推导出的一字不差——同一编号不许有两种叫法', () => {
  // 一边写「友军舰队（海域41）一」、另一边写「音轨 #141」，玩家读到的是「这是两件事」
  for (const entry of SPECIAL_VOICE_SLOTS) {
    const derived = bareVoiceSceneName(entry.slot)
    if (!derived.startsWith('友军舰队')) continue
    assert.equal(entry.scene, derived, `槽位 ${entry.slot} 两边的名字对不上`)
  }
})

test('档案里的表外裸编号长成行：场合名、路径、升序', () => {
  const rows = bareArchiveVoiceRows({
    filename: 'abcdefg',
    slotsOfDir: (dir) => (dir === 'abcdefg' ? [350, 143, 777] : []),
    covered: new Set(),
  })
  assert.deepEqual(
    rows.map((row) => row.slot),
    [143, 350, 777],
    '没按槽位升序——与既有行合流时会插错位置',
  )
  assert.deepEqual(rows.map((row) => row.scene), [
    '友军舰队（海域43）一',
    '友军舰队（海域50）三',
    '音轨 #777',
  ])
  // 播放地址就是**这艘舰自己的音声目录 + 裸编号**（目录即身份）
  assert.deepEqual(rows.map((row) => row.pathname), [
    '/kcs/sound/kcabcdefg/143.mp3',
    '/kcs/sound/kcabcdefg/350.mp3',
    '/kcs/sound/kcabcdefg/777.mp3',
  ])
  // 这一层不产出任何探测/取网的东西：表外空间无法枚举，探测无从谈起
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), ['pathname', 'scene', 'slot'])
    assert.match(row.pathname, /^\/kcs\/sound\/kc[A-Za-z0-9_-]+\/\d+\.mp3$/)
  }
})

test('目录即身份：一个目录名映射多个形态时，每个形态都长这行', () => {
  // shipgraph 里同一个 api_filename 可以挂着好几个形态（改装前后共用音声目录）。
  // 共用目录 = 语音真共用，如实显示——不去猜「其实只属于其中一个」。
  const graph = new Map([
    [100, 'sharedir'],
    [200, 'sharedir'],
    [300, 'lonedir'],
  ])
  const slotsOfDir = (dir) => (dir === 'sharedir' ? [143] : [])
  const rowsOf = (mstId) =>
    bareArchiveVoiceRows({ filename: graph.get(mstId) ?? null, slotsOfDir, covered: new Set() })
  assert.deepEqual(rowsOf(100), rowsOf(200))
  assert.equal(rowsOf(100).length, 1)
  assert.equal(rowsOf(100)[0].pathname, '/kcs/sound/kcsharedir/143.mp3')
  // 别的目录不受影响
  assert.deepEqual(rowsOf(300), [])
  // 主数据没到位（拿不到目录名）时一行都不长：没有目录就没有身份
  assert.deepEqual(
    bareArchiveVoiceRows({ filename: null, slotsOfDir: () => [143], covered: new Set() }),
    [],
  )
  assert.deepEqual(
    bareArchiveVoiceRows({ filename: '', slotsOfDir: () => [143], covered: new Set() }),
    [],
  )
})

test('去重：文本行与骨架行已经占住的格，这一段不再摆第二行', () => {
  const slotsOfDir = () => [129, 143, 241, 900]
  // 骨架/正常行摆过的（表内槽位一律由它们管）：只剩表还没收的 143
  assert.deepEqual(
    bareArchiveVoiceRows({
      filename: 'abcdefg',
      slotsOfDir,
      covered: new Set([129, 241, 900]),
    }).map((row) => row.slot),
    [143],
  )
  // 一格都没被占住时，表内槽位的名字用表里那一份（不退回「音轨 #N」）
  const all = bareArchiveVoiceRows({ filename: 'abcdefg', slotsOfDir, covered: new Set() })
  assert.deepEqual(all.map((row) => row.slot), [129, 143, 241, 900])
  assert.equal(all[0].scene, specialVoiceScene(129))
  assert.equal(all[3].scene, specialVoiceScene(900))
  // 全占住了 → 一行都不追加
  assert.deepEqual(
    bareArchiveVoiceRows({
      filename: 'abcdefg',
      slotsOfDir,
      covered: new Set([129, 143, 241, 900]),
    }),
    [],
  )
})

test('混淆段与混淆值域都不归这一段管——否则常规槽位会被摆成两行', () => {
  const rows = bareArchiveVoiceRows({
    filename: 'abcdefg',
    // 1..53 是常规槽位（骨架/正常行管）；≥100000 根本不是裸编号（那是混淆值域）
    slotsOfDir: () => [1, 24, 53, 54, 100_234, 199_172, 143],
    covered: new Set(),
  })
  assert.deepEqual(rows.map((row) => row.slot), [54, 143])
  // 同一个编号来两遍也只长一行
  assert.deepEqual(
    bareArchiveVoiceRows({
      filename: 'abcdefg',
      slotsOfDir: () => [143, 143, 143],
      covered: new Set(),
    }).length,
    1,
  )
  // 非整数不许混进来（档案索引理论上只喂整数，但这一层是护栏不是假设）
  assert.deepEqual(
    bareArchiveVoiceRows({
      filename: 'abcdefg',
      slotsOfDir: () => [1.5, Number.NaN, '143'],
      covered: new Set(),
    }),
    [],
  )
})

test('这一段播的是档案实物，不回退 CDN、也不摆探测钮', () => {
  // 逻辑面：产出里只有 pathname，没有任何 http(s) 地址（地址由 archivedVoiceUrlOf 从
  // 档案目录拼成 file://，取不到实物那一行就不摆——渲染层那半在下面这条盯着）。
  const rows = bareArchiveVoiceRows({
    filename: 'abcdefg',
    slotsOfDir: () => [143, 900],
    covered: new Set(),
  })
  for (const row of rows) assert.equal(/https?:/.test(JSON.stringify(row)), false)
  // 渲染面：这一段只走 archivedVoiceUrlOf，且一个探测钮都不产出
  const at = ji.indexOf('const bareArchiveRows = (')
  assert.ok(at > 0, '找不到亲历显形那一段')
  const body = ji.slice(at, ji.indexOf('\n\n', at))
  assert.match(body, /archivedVoiceUrlOf\(row\.pathname\)/)
  assert.equal(body.includes('data-voice-probe'), false, '表外空间摆了探测钮')
  assert.equal(/voiceUrl\(|extraVoiceUrl\(/.test(body), false, '回退到网络取了')
  // 与骨架/深海档案段同族：不主张文本
  assert.match(body, /vo-zh vo-untranslated">—</)
})

// ---- ② 点击探测的两个分支 ----

test('只有 404/410 才算「官方没有」——网络抖动不许被固化成事实', () => {
  assert.equal(voiceProbeVerdictOf(200), 'kept')
  assert.equal(voiceProbeVerdictOf(404), 'absent')
  assert.equal(voiceProbeVerdictOf(410), 'absent')
  for (const status of [0, 403, 429, 500, 502, 503, 504]) {
    assert.equal(voiceProbeVerdictOf(status), 'error', `${status} 被当成了「官方没有」`)
  }
})

test('台账落盘的形状收得住：路径要对、状态只收 404/410', () => {
  const ok = sanitizeVoiceAbsentEntry({
    pathname: '/kcs/sound/kc123/100234.mp3',
    at: 1_700_000_000_000,
    status: 404,
  })
  assert.ok(ok)
  assert.equal(ok.status, 404)
  // 路径形状不对：它会被拿去拼本地判定，不能裸信
  assert.equal(sanitizeVoiceAbsentEntry({ pathname: '/etc/passwd', at: 1, status: 404 }), null)
  // 状态不是 404/410：那不是「官方没有」，一条都不许进这张表
  assert.equal(
    sanitizeVoiceAbsentEntry({ pathname: '/kcs/sound/kc123/100234.mp3', at: 1, status: 500 }),
    null,
  )
  assert.equal(sanitizeVoiceAbsentEntry(null), null)
})

// ---- ②-a 「官方没有」永久作数（2026-08-23 用户拍板，口径反转）----
//
// ⚠️ 这一节整个反过来了。原本这里断言的是「满 90 天就当没记过」
//（`VOICE_ABSENT_RECHECK_DAYS`），用户当天把它退役，出处与理由写在
// shared/voice-probe-plan 的「90 天自动过期退役」那一段：
// 「2026-08-23 问过，那天官方没有」是**带日期的事实**，自动忘掉它不等于事实过期，
// 只等于把「问过了，没有」伪装回「还没问过」。自愈的两条活路（无配音格可点重探、
// 游戏里听到自动入档）已经够了，清理权归玩家（钥里按月清）。

test('「官方没有」不会自己过期：多久以前问的都还作数', () => {
  const now = 1_800_000_000_000
  const day = 86_400_000
  const entry = (at) => ({ pathname: '/kcs/sound/kc1/1.mp3', at, status: 404 })
  assert.equal(voiceAbsentStillValid(entry(now - day)), true)
  // 曾经的那条 90 天线：现在两边都作数（写反了不报错，只是台账又开始悄悄遗忘）
  assert.equal(
    voiceAbsentStillValid(entry(now - 89 * day)),
    true,
    '89 天前问的不作数了？自动过期被谁加回来了',
  )
  assert.equal(
    voiceAbsentStillValid(entry(now - 91 * day)),
    true,
    '91 天前问的被当成没问过——90 天自动过期被加回来了（2026-08-23 已退役）',
  )
  assert.equal(voiceAbsentStillValid(entry(now - 3650 * day)), true, '十年前问的也仍旧是事实')
  // 没有这条记录才是「不作数」
  assert.equal(voiceAbsentStillValid(null), false)
  assert.equal(voiceAbsentStillValid(undefined), false)
})

test('自动过期的那个常量真的没了——留着就会有人照旧引用', () => {
  assert.equal(
    'VOICE_ABSENT_RECHECK_DAYS' in plan,
    false,
    '常量还在导出：口径反转只做了一半，下一个人会照着它把过期加回来',
  )
  const planSrc = fs.readFileSync(
    new URL('../src/shared/voice-probe-plan.ts', import.meta.url),
    'utf8',
  )
  // 演进注释必须留痕：这个仓库的家法是口径反转要留得下出处
  assert.match(planSrc, /2026-08-23/)
  assert.match(planSrc, /自动过期退役/)
  // 判据本身不许再看时间
  assert.equal(
    /voiceAbsentStillValid[\s\S]{0,200}?86_400_000/.test(planSrc),
    false,
    'voiceAbsentStillValid 里又出现了天数换算',
  )
})

// ---- ②-b 无配音格可点重探（2026-08-23 用户拍板）----
//
// 立这条时台账还有 90 天的自动复探期，它太钝：官方今天补了配音，玩家得等到第 90 天。
// 用户要的是**随时手点再问一次**。（同一天稍后自动复探期本身退役，手点这条路
// 反过来成了它退役的前提之一。）这里盯的是那条分界：显式点击开旁路，
// 系统自己的重复探测照旧被短路挡住。

test('显式重探绕过「已知没有」的短路——点击是意图，不是批量骚扰', () => {
  const known = { pathname: '/kcs/sound/kc123/100234.mp3', at: 1_799_913_600_000, status: 404 }
  // 骨架探测钮那条路（不传 recheck）：记着的结论照旧短路，一次请求都不发
  assert.equal(voiceProbeShortCircuits({ known }), true)
  assert.equal(voiceProbeShortCircuits({ known, recheck: false }), true)
  // 玩家点了那个无配音格：短路让路，真发那一次请求
  assert.equal(
    voiceProbeShortCircuits({ known, recheck: true }),
    false,
    '手点重探被短路挡住了——那这一格永远问不动',
  )
})

test('短路只认「记没记过」：没记过就发请求，记过多久都短路', () => {
  // ⚠️ 反转过的一条：原本这里断言「过了 90 天照旧发请求」。自动过期退役之后，
  // 系统自己那条路对**任何日期**的记录都短路——要再问一次只有玩家手点这一条路。
  const day = 86_400_000
  const old = { pathname: '/kcs/sound/kc123/100234.mp3', at: 1_800_000_000_000 - 400 * day, status: 404 }
  assert.equal(voiceProbeShortCircuits({ known: null }), false)
  assert.equal(voiceProbeShortCircuits({ known: undefined }), false)
  assert.equal(
    voiceProbeShortCircuits({ known: old }),
    true,
    '很旧的记录又自己发起请求了——自动过期被加回来了',
  )
  assert.equal(voiceProbeShortCircuits({ known: old, recheck: true }), false)
})

test('再 404：台账那条「问的是哪一天」换成今天', () => {
  const pathname = '/kcs/sound/kc123/100234.mp3'
  const at = 1_900_000_000_000
  const action = planVoiceAbsentUpdate({
    pathname,
    verdict: 'absent',
    status: 404,
    at,
    known: true,
    size: 3,
  })
  assert.equal(action.kind, 'record')
  assert.deepEqual(action.entry, { pathname, at, status: 404 }, '刷新的语义变了：at 必须是这一次的')
  // 刷新的意义从「重新计 90 天」变成「悬停上那个日期换成今天」——条目本身照旧一直作数
  assert.equal(voiceAbsentStillValid(action.entry), true)
  assert.equal(voiceAbsentDayOf(action.entry.at), voiceAbsentDayOf(at))
  // 410 同理（官方两种「没有」的回法）
  assert.equal(
    planVoiceAbsentUpdate({ pathname, verdict: 'absent', status: 410, at, known: false, size: 0 })
      .kind,
    'record',
  )
})

test('重探取到了：那条「官方没有」当场撤掉，格子转回正常', () => {
  const pathname = '/kcs/sound/kc123/100234.mp3'
  assert.deepEqual(
    planVoiceAbsentUpdate({
      pathname,
      verdict: 'kept',
      status: 200,
      at: 1,
      known: true,
      size: 1,
    }),
    { kind: 'drop' },
    '官方后来实装了，台账那条还留着——那一格会一直显示成没有',
  )
  // 本来就没记过：不必动台账（也不许凭空 drop 一条不存在的）
  assert.deepEqual(
    planVoiceAbsentUpdate({ pathname, verdict: 'kept', status: 200, at: 1, known: false, size: 1 }),
    { kind: 'keep' },
  )
})

test('抖动不进台账，也不许把已有那条撤掉', () => {
  const pathname = '/kcs/sound/kc123/100234.mp3'
  for (const verdict of ['error', 'blocked']) {
    for (const known of [true, false]) {
      assert.deepEqual(
        planVoiceAbsentUpdate({ pathname, verdict, status: 503, at: 1, known, size: 1 }),
        { kind: 'keep' },
        `${verdict} 动了台账`,
      )
    }
  }
})

test('条数上限只挡新增，不挡刷新——满了之后重探的结果不许悄悄丢', () => {
  const pathname = '/kcs/sound/kc123/100234.mp3'
  const full = VOICE_ABSENT_MAX_ENTRIES
  assert.equal(
    planVoiceAbsentUpdate({ pathname, verdict: 'absent', status: 404, at: 5, known: true, size: full })
      .kind,
    'record',
    '已经在台账里的那条被上限挡住了——重探的结果丢了，而界面上看不出区别',
  )
  assert.equal(
    planVoiceAbsentUpdate({
      pathname,
      verdict: 'absent',
      status: 404,
      at: 5,
      known: false,
      size: full,
    }).kind,
    'keep',
  )
})

test('台账写入端仍旧过 sanitize：形状不对的一条都进不去', () => {
  // 语义别被绕过去：路径判据、状态判据都还在同一个入口上
  assert.deepEqual(
    planVoiceAbsentUpdate({
      pathname: '/etc/passwd',
      verdict: 'absent',
      status: 404,
      at: 5,
      known: false,
      size: 0,
    }),
    { kind: 'keep' },
  )
  const ok = planVoiceAbsentUpdate({
    pathname: '/kcs/sound/kc123/900.mp3',
    verdict: 'absent',
    status: 404,
    at: 5.7,
    known: false,
    size: 0,
  })
  assert.equal(ok.kind, 'record')
  assert.deepEqual(ok.entry, sanitizeVoiceAbsentEntry(ok.entry), '写进台账的形状与读回来的不一致')
  assert.equal(ok.entry.at, 5, 'sanitize 那一层的取整被绕过去了')
})

test('无配音格摆成可点的：挂 data-voice-probe、走同一个 handler、多带一个 recheck', () => {
  const skeletonAt = ji.indexOf('const skeletonRows = (')
  const body = ji.slice(skeletonAt, ji.indexOf('\n}\n', skeletonAt))
  // 观感照旧是灰暗的无配音态（`.none`），但它现在挂着探测标记
  assert.match(body, /vo-play none" data-voice-probe="\$\{slot\}"/)
  assert.match(body, /title="\$\{esc\(absentTitle\(mstId, slot\)\)\}"/)
  // 点击侧：`.none` 这一支带 recheck，探测钮那一支不带（行为一字不变）
  assert.match(ji, /const recheck = probeButton\.classList\.contains\('none'\)/)
  assert.match(ji, /void probeVoiceSlot\(mstId, slot, url, recheck\)/)
  // 主进程仍旧只在 recheck 时让路，其余闸门一道没绕
  assert.match(probeMain, /voiceProbeShortCircuits\(\{ known, recheck \}\)/)
  assert.match(probeMain, /if \(!config\.get\('kanso\.remoteArt', true\)\) return \{ verdict: 'blocked' \}/)
})

// ---- ②-c 日期是内容：悬停写哪一天、钥里按月清（2026-08-23）----
//
// 自动过期退役之后，「问的是哪一天」从内部字段变成**要显示的内容**：
// 那一格的悬停写它，钥里按它分组清理。这一节盯的是分组/清理这两条判据本身
//（写反了不报错：多清一个月、或者点了清理什么都没发生，界面上都看不出来）。

/** 本地 0 点整的时间戳——分组按本地年月，用固定 UTC 值会在时区边界上飘。 */
const localAt = (year, month, day) => new Date(year, month - 1, day, 12, 0, 0).getTime()
const absentAt = (at) => ({ pathname: `/kcs/sound/kc1/${at % 100000}.mp3`, at, status: 404 })

test('日期按本地日历读：YYYY-MM-DD / YYYY-MM，读不出就不编一个', () => {
  const at = localAt(2026, 8, 24)
  assert.equal(voiceAbsentDayOf(at), '2026-08-24')
  assert.equal(voiceAbsentMonthOf(at), '2026-08')
  // 补零两处都要有（写成 `2026-8-4` 会让排序与分组都乱）
  assert.equal(voiceAbsentDayOf(localAt(2026, 1, 4)), '2026-01-04')
  assert.equal(voiceAbsentMonthOf(localAt(2026, 1, 4)), '2026-01')
  // 时间戳不成形：空串，不许编一个 1970-01-01 出来
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, undefined, null]) {
    assert.equal(voiceAbsentDayOf(bad), '', `${bad} 被编出了一个日期`)
    assert.equal(voiceAbsentMonthOf(bad), '')
  }
})

test('按月分组：新月在前，条数对得上', () => {
  const entries = [
    absentAt(localAt(2026, 7, 30)),
    absentAt(localAt(2026, 8, 1)),
    absentAt(localAt(2026, 8, 24)),
    absentAt(localAt(2025, 12, 31)),
    absentAt(localAt(2026, 8, 24) + 1),
  ]
  assert.deepEqual(groupVoiceAbsentByMonth(entries), [
    { month: '2026-08', count: 3 },
    { month: '2026-07', count: 1 },
    { month: '2025-12', count: 1 },
  ])
  // 总数不许丢：分组是**重新数一遍**，不是抽样
  assert.equal(
    groupVoiceAbsentByMonth(entries).reduce((sum, g) => sum + g.count, 0),
    entries.length,
  )
  assert.deepEqual(groupVoiceAbsentByMonth([]), [])
  assert.deepEqual(groupVoiceAbsentByMonth(null), [])
  assert.deepEqual(groupVoiceAbsentByMonth(undefined), [])
})

test('日期读不出来的条目不进任何一组——无从归属，硬塞进某个月就是编', () => {
  const entries = [absentAt(localAt(2026, 8, 24)), { pathname: '/kcs/sound/kc1/2.mp3', at: 0, status: 404 }]
  assert.deepEqual(groupVoiceAbsentByMonth(entries), [{ month: '2026-08', count: 1 }])
})

test('按月清理只落在那一月，其余一条不动', () => {
  const july = absentAt(localAt(2026, 7, 30))
  const augA = absentAt(localAt(2026, 8, 1))
  const augB = absentAt(localAt(2026, 8, 24))
  const entries = [july, augA, augB]
  assert.deepEqual(voiceAbsentAfterClear(entries, '2026-08'), [july])
  assert.deepEqual(voiceAbsentAfterClear(entries, '2026-07'), [augA, augB])
  // 月份对不上任何一条：一条都不删（宁可什么都没发生，也不要清掉别的月）
  assert.deepEqual(voiceAbsentAfterClear(entries, '2026-09'), entries)
  assert.deepEqual(voiceAbsentAfterClear(entries, '乱填'), entries)
  // 原数组不被就地改掉（调用方还拿着它去算「清了几条」）
  assert.equal(entries.length, 3)
})

test('全部清理 = 一条不剩，含日期读不出来的那些', () => {
  const entries = [
    absentAt(localAt(2026, 8, 24)),
    { pathname: '/kcs/sound/kc1/2.mp3', at: 0, status: 404 },
  ]
  assert.deepEqual(voiceAbsentAfterClear(entries, null), [])
  assert.deepEqual(voiceAbsentAfterClear([], null), [])
  assert.deepEqual(voiceAbsentAfterClear(null, null), [])
  // 日期坏掉的那条按月清不掉（它不属于任何一个月），只有全部清理带得走——
  // 不然它会永远赖在台账里，而界面上一个入口都没有
  assert.equal(voiceAbsentAfterClear(entries, '2026-08').length, 1)
})

test('悬停带日期：日期由装配期的索引给，渲染路径上不现算', () => {
  // 悬停文案本身：日期 + 「问过没有」+ 可点的暗示。
  // 2026-08-26 文案清扫按裁决书把它缩成「${day} 问过没有 · 点一下再问」（族 9 断句、
  // 去掉「官方那会儿」的免责腔）。护栏语义不变，仍钉三件：日期在、结论在、可点的暗示在。
  assert.match(ji, /\$\{day\} 问过没有 · 点一下再问/)
  // 日期从渲染层那份索引里直接取（Map，不是 Set），不在这里扫台账
  assert.match(probeRenderer, /let absent = new Map<string, number>\(\)/)
  assert.match(probeRenderer, /export const voiceAbsentDay = \(mstId: number, slot: number\): string/)
  assert.equal(
    /voiceAbsentDay[\s\S]{0,300}?ipcRenderer\.invoke/.test(probeRenderer),
    false,
    '逐格判定里发 IPC 了——一屏骨架五十几行',
  )
  // 主进程把「问的是哪一天」一并回给渲染层（渲染层不自己 Date.now() 猜一个）
  assert.match(probeMain, /absentAt/)
  assert.equal(
    /if \(verdict === 'absent'\) absent\.set\(pathname, Date\.now\(\)\)/.test(probeRenderer),
    false,
    '渲染层自己猜了一个日期——台账满了拒绝新增时它会和盘上那份对不上',
  )
})

test('重探再 404：日期变了就重画那一格，同一天里再点才只给反馈', () => {
  // 上一批那条「重探不重画」的判定现在有条件了：悬停里的日期是内容的一部分，
  // 换了一天还不重画，界面上就一直挂着旧日期。
  assert.match(ji, /const shownDay = recheck \? voiceAbsentDay\(mstId, slot\) : ''/)
  assert.match(ji, /if \(voiceAbsentDay\(mstId, slot\) !== shownDay\) scheduleRender\(\)/)
  assert.match(ji, /else probeButton\.title = '刚问过，官方还是没有'/)
})

test('钥里那个清理口：按月列、按月清、另有全部清理，且不开新的持久化格式', () => {
  // 渲染层只消费 shared 那两个纯函数，不自备一套分组
  assert.match(yu, /groupVoiceAbsentByMonth/)
  assert.equal(/getMonth\(\)/.test(yu), false, '钥里自己算了一遍年月')
  assert.match(yu, /语音「官方没有」记录/)
  // 月份行与账本那一块共用同一条排版（`monthLineHtml`），钮上带的是月份本身
  assert.match(yu, /monthLineHtml\(group\.month, group\.count, 'data-absent-clear'\)/)
  assert.match(yu, /<span class="ybtn" \$\{attr\}="\$\{esc\(month\)\}">清理<\/span>/)
  assert.match(yu, /data-absent-clear="all"/)
  // 走既有 IPC，清完重取索引并广播（台词卷那些格子当场回到可探测态）
  assert.match(yu, /ipcRenderer\.invoke\('mg:voice-absent-clear', \{ month \}\)/)
  assert.match(yu, /void reloadVoiceAbsent\(\)/)
  assert.match(probeRenderer, /kanso:voice-absent-change/)
  assert.match(ji, /document\.addEventListener\('kanso:voice-absent-change', onVoiceAbsentChange\)/)
  // 存储结构不变：清理只是把条目挑出去，没有第二份文件、也没有「已删除」标记
  assert.equal(/deleted|tombstone|voice-absent-cleared/.test(probeMain), false)
})

// ---- ③ 严禁自动批量探测 ----

test('一次点击一次请求：整条链上没有批量入口', () => {
  // 主进程侧只导出「探一格」与「读台账」，没有 probeAll / probeForm 之类
  assert.match(probeMain, /export const probeVoiceSlot = async \(/)
  assert.equal(/export const probe(All|Form|Ship|Batch)/.test(probeMain), false, '出现了批量探测入口')
  // 渲染层同理，且它的探测函数**只能由点击调用**
  assert.equal(/export const probe(All|Form|Ship|Batch)/.test(probeRenderer), false)
  // 骨架渲染那一段绝不许自己发探测：渲染期调用 probeVoiceSlot 就是打开页面扫全槽
  const skeletonAt = ji.indexOf('const skeletonRows = (')
  const skeletonEnd = ji.indexOf('\n}', skeletonAt)
  assert.ok(skeletonAt > 0, '找不到骨架生成函数')
  assert.equal(
    ji.slice(skeletonAt, skeletonEnd).includes('probeVoiceSlot('),
    false,
    '骨架在渲染期就发探测了——那是打开一页 53 连发',
  )
  // 探测只挂在点击处理里
  assert.match(ji, /const probeButton = target\.closest<HTMLElement>\('\.vo-play\[data-voice-probe\]'\)/)
  assert.match(ji, /void probeVoiceSlot\(mstId, slot, url, recheck\)/)
})

test('探测受钥里那个开关管，且档案优先照旧', () => {
  // 关掉「未缓存的立绘/语音从游戏资源服务器取」就一次都不发
  assert.match(probeMain, /if \(!config\.get\('kanso\.remoteArt', true\)\) return \{ verdict: 'blocked' \}/)
  // 已知官方没有的不再打扰服务器（判据整条挪进 shared，行为按数据在上面验过）
  assert.match(probeMain, /voiceProbeShortCircuits\(\{ known, recheck \}\)/)
  // 骨架行：档案里有实物就直接给档案那一份（零网络），根本不摆探测钮
  assert.match(ji, /const kept = archivedVoiceUrl\(mstId, slot\)/)
  assert.match(ji, /kept\s*\n?\s*\? `<span class="vo-play" data-voice="\$\{esc\(kept\)\}"/)
})

// ---- ④ 骨架的措辞与三态 ----

test('骨架行不主张任何文本：文字位是中性短横，不写抱怨文案', () => {
  const skeletonAt = ji.indexOf('const skeletonRows = (')
  const body = ji.slice(skeletonAt, ji.indexOf('\n}\n', skeletonAt))
  assert.match(body, /vo-zh vo-untranslated">—</)
  for (const bad of ['暂无台词', '缺少台词', '还没有台词的', '资料缺失']) {
    assert.equal(body.includes(bad), false, `骨架行写了抱怨文案：${bad}`)
  }
  // 三态各有各的样子
  assert.match(body, /vo-play probe/)
  assert.match(body, /vo-play none/)
  // 无日期那一支同样缩过（见上一测的说明），结论「问过没有」照旧在
  assert.match(ji, /之前问过没有 · 点一下再问/)
})

test('名单没到位时一格都不摆——别把「还不知道」显示成「官方没有」', () => {
  assert.match(ji, /if \(!voiceAbsentReady\(\)\) return \[\]/)
  assert.match(probeRenderer, /export const voiceAbsentReady = \(\): boolean => ready/)
})

test('文本一到，骨架让位：同一格不会既有正常行又有骨架行', () => {
  // 渲染层把已占槽位整个传进去，`voiceSkeletonSlots` 逐格剔掉（上面已按数据验过）
  //（08-23 摆行范围扩到全槽位后，textless 参数随旁证机制一并退役——调用只剩两个实参）
  assert.match(ji, /const skeleton = abyss \? \[\] : skeletonRows\(mstId, covered\)/)
  // `covered` 收的是三层文本行占住的槽位——这一点由既有的合流逻辑保证
  assert.match(ji, /for \(const row of filled\) if \(row\.slot != null\) covered\.add\(row\.slot\)/)
})

test('与「键必须有文本背书」的关系写清楚了，别让下一个人当成漏洞补掉', () => {
  const planSrc = fs.readFileSync(
    new URL('../src/shared/voice-probe-plan.ts', import.meta.url),
    'utf8',
  )
  // 那条家法防的是**错配**（显示 A 播 B），前提是这一行主张了一句台词；
  // 骨架不主张文本，所以不适用。这段推理必须写在源码里，不能只活在提交信息里。
  assert.match(planSrc, /错配/)
  assert.match(planSrc, /不主张任何文本/)
  assert.match(planSrc, /即刻接管|骨架让位/)
})

// ---- ⑤ 台账是玩家点出来的，别被缓存急救顺手抹掉 ----

test('探测台账在缓存急救的保住名单里', () => {
  const yu = fs.readFileSync(new URL('../src/main/yu.ts', import.meta.url), 'utf8')
  const at = yu.indexOf('export const PRESERVED_ENTRIES')
  const list = yu.slice(at, yu.indexOf(']', at))
  assert.match(list, /'voice-absent\.json'/)
  // 它也不在被删的那几个目录里
  const dirsAt = yu.indexOf('export const CACHE_DIRS')
  assert.equal(yu.slice(dirsAt, yu.indexOf('\n', dirsAt)).includes('voice-absent'), false)
})

test('页脚把文本行与骨架行分开数——混成一个「共 N 条」会写出自相矛盾的话', () => {
  // 2026-08-23 复验当场照出来的：整页都是骨架时页脚写成
  // 「共 53 条（另 53 条只有场合…）」，还挂着「这一页每一条都连得到音轨」。
  assert.match(ji, /const textRows = rows\.length - skeleton\.length/)
  // 亲历显形那一段也不算文本行——它同样不主张任何文字
  assert.match(ji, /- abyssArchive\.length - bareArchive\.length/)
  // 并进「只有音轨」那一句：我方与深海共用一句措辞，两段互斥
  assert.match(ji, /const archiveOnly = abyssArchive\.length \+ bareArchive\.length/)
  assert.match(ji, /\$\{archiveOnly\} 条只有音轨/)
  assert.match(ji, /`这一页 \$\{skeletonNote\}`/)
  // 「还没有文字」只该说一遍——skeletonNote 自带，别再前缀一次
  assert.equal(ji.includes('这一页还没有文字：${skeletonNote}'), false, '同一句话说了两遍')
  // 一条文本行都没有时不许再挂那句「可播放」概述
  assert.match(ji, /abyss \|\| !textRows \? '' : voiceFootNote\(offCount, textRows\)/)
  // 「共 N 条」只在真有文本行时出现
  assert.match(ji, /const head = textRows/)
})
