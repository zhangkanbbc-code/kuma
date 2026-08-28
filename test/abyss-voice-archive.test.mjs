// 深海音轨档名 → 形态归属，以及「档案里听过的音轨」那一段追加行的护栏。
//
// ---- 这份护栏盯的是什么 ----
// 深海台词卷只显示文本源认领过的行；889 个深海形态里 234 个一个字都没有，整段隐藏。
// 而深海音轨（kc9998）本来就在语音档案的收录范围里，玩家战斗中听过的实物已经躺在
// 档案里——「不展示代表没有」这条口径下，隐藏等于谎称这个形态不说话。
//
// 把它们摆出来的前提是**先答对「这一条是谁的」**。这一族的错法是把 A 的声音摆到
// B 名下，而界面上它和对的长得一模一样——所以这里全部真调用，不做源码正则。
import assert from 'node:assert/strict'
import test from 'node:test'

import abyssFile from '../dist/shared/abyss-voice-file.js'

const {
  abyssVoiceMstIdFromFile,
  abyssArchiveKeysFor,
  groupAbyssVoiceFiles,
  parseAbyssVoiceFile,
  abyssVoiceRowLabel,
  abyssVoiceSceneOfFile,
  abyssVoiceSceneOfLineNo,
} = abyssFile

const stats = JSON.parse(
  await import('node:fs').then(({ readFileSync }) =>
    readFileSync(new URL('../assets/lodes/abyssal-stats.json', import.meta.url), 'utf8'),
  ),
)
const enemies = JSON.parse(
  await import('node:fs').then(({ readFileSync }) =>
    readFileSync(new URL('../assets/lodes/subtitle-enemies.json', import.meta.url), 'utf8'),
  ),
)
// wikiwiki-abyss-voice **不随仓库分发**（上游未声明许可，只在本机显式拉取后才有）。
// 缺了就优雅跳过那两条，裸测试套件在干净环境照样跑得完；而 `npm run test:lodes`
// 的契约是「全量对账」，所以它在 scripts/require-test-lodes.mjs 里被点名——那边缺了会直接红。
const wikiwikiAbyssUrl = new URL('../assets/lodes/wikiwiki-abyss-voice.json', import.meta.url)
const { existsSync, readFileSync } = await import('node:fs')
const hasWikiwikiAbyss = existsSync(wikiwikiAbyssUrl)
const wikiwikiAbyss = hasWikiwikiAbyss ? JSON.parse(readFileSync(wikiwikiAbyssUrl, 'utf8')) : null
const needWikiwikiAbyss = hasWikiwikiAbyss ? false : '缺 wikiwiki-abyss-voice 矿脉包'

/** 随包的深海形态号全集（abyssal-stats 收了 882 个，1501..2397）。 */
const ABYSS_IDS = new Set(
  Object.keys(stats.data ?? stats)
    .map(Number)
    .filter((id) => id >= 1500),
)
const isAbyss = (id) => ABYSS_IDS.has(id)

// ---- ① 档名反解 ----

test('档名反解：六种结构各一例，全部对上独立锚点', () => {
  // 每一条的归属都由**另一条证据**独立锚定过：subtitle-enemies 那一行写的深海舰名
  // 查主数据得到 mstId，再看档名里是否嵌着它。309 条里 234 条有这样的锚点，
  // 结构规则与它们**逐条一致、0 冲突**（对账见 shared/abyss-voice-file 文件头）。
  const cases = [
    ['6466520', 1665], // 前缀2 + 形态号3 + 行号2（砲台小鬼）
    ['3505871', 1587], // 前缀2 + 形态号4（首位 0）+ 行号1（北方棲姫）
    ['32263720', 1637], // 前缀3 + 形态号3 + 行号2（PT小鬼群）
    ['74205910', 2059], // 前缀2 + 形态号4 + 行号2（ヒ船団棲姫）
    ['27605571', 1557], // 前缀3 + 形态号4（首位 0）+ 行号1（戦艦棲姫）
    ['383172210', 1722], // 前缀3 + 形态号4 + 行号2（護衛棲姫）
    ['445171110', 1711], // 名字那条路认不出的 75 条之一，结构规则照样解得出
    // 本机未匹配台账里那三条同前缀同形态的（軽巡ム級 2317），行号 20/30/**50**。
    // 上界卡在 4 的那一版就是在这里漏掉最后一条的——行号 5 确实存在。
    ['611231720', 2317],
    ['611231730', 2317],
    ['611231750', 2317],
  ]
  for (const [key, expected] of cases) {
    assert.equal(abyssVoiceMstIdFromFile(key, isAbyss), expected, `${key} 归属解错了`)
  }
})

test('随包 309 条深海档名全部解出唯一归属（0 多解、0 无解）', () => {
  const keys = Object.keys(enemies.data ?? enemies)
  assert.ok(keys.length >= 300, '随包深海字幕包空了？')
  const unresolved = keys.filter((key) => abyssVoiceMstIdFromFile(key, isAbyss) == null)
  assert.deepEqual(unresolved, [], '这些档名解不出归属——规则被改窄了')
  for (const key of keys) {
    const mstId = abyssVoiceMstIdFromFile(key, isAbyss)
    assert.ok(isAbyss(mstId), `${key} 解出了一个不存在的形态号 ${mstId}`)
  }
})

test('多解就是不解——绝不取第一个', () => {
  // `74205910` 结构上有两种读法：前缀「74」+ 形态号「2059」+ 行号「10」，
  // 或前缀「742」+ 形态号「059」+ 行号「10」。**是主数据把它定死的**——
  // 1059 不是一个存在的深海形态，2059 是（ヒ船団棲姫）。
  assert.equal(abyssVoiceMstIdFromFile('74205910', isAbyss), 2059)
  // 而当消歧的依据不存在时（这里用「什么号都算数」的极端），必须返回 null
  // 而不是挑一个——挑错了就是把 A 的声音摆到 B 名下，界面上看不出来。
  assert.equal(abyssVoiceMstIdFromFile('74205910', () => true), null)
  // 行号那两条约束同样是消歧的一部分：放宽成「任意 1~2 位数字」会让
  // `28205971` 冒出第二解（2059）。别照直觉放宽。
  assert.equal(abyssVoiceMstIdFromFile('28205971', isAbyss), 1597)
})

test('认不出的档名一律不猜', () => {
  for (const bad of [
    '', // 空
    '12345', // 太短（下界 = 前缀2+形态号3+行号1）
    '1234567890', // 太长
    '34078a', // 不是纯数字
    'ShinkaiSeikan581-Intro', // 那是 kcwiki 的资源名，不是官方档名
    null,
    undefined,
    12_345,
  ]) {
    assert.equal(abyssVoiceMstIdFromFile(bad, isAbyss), null, `${bad} 被硬解出了归属`)
  }
  // 结构对得上、但形态号在主数据里不存在：不猜
  assert.equal(abyssVoiceMstIdFromFile('999999910', () => false), null)
})

test('主数据没到位（形态号全集为空）时一条都不认', () => {
  const grouped = groupAbyssVoiceFiles(['3505871', '383172210'], () => false)
  assert.equal(grouped.size, 0)
})

// ---- ② 归拢与去重 ----

test('按形态归拢：解不出的整条丢掉，同形态内按档名升序', () => {
  const grouped = groupAbyssVoiceFiles(
    ['3505872', '3505871', '3505873', '383172210', 'not-a-file'],
    isAbyss,
  )
  assert.deepEqual(grouped.get(1587), ['3505871', '3505872', '3505873'])
  assert.deepEqual(grouped.get(1722), ['383172210'])
  assert.equal(grouped.size, 2, '解不出的档名不该自成一档')
})

test('去重：文本源已经摆过的档名不再摆第二行', () => {
  const grouped = groupAbyssVoiceFiles(['3505871', '3505872', '3505873'], isAbyss)
  // subtitle-enemies 那一组的 key 就是完整官方档名，重叠必然发生
  const shown = new Set(['3505871', '3505873'])
  assert.deepEqual(abyssArchiveKeysFor(grouped, 1587, shown), ['3505872'])
  // 全都摆过了 → 一行都不追加
  assert.deepEqual(abyssArchiveKeysFor(grouped, 1587, new Set(['3505871', '3505872', '3505873'])), [])
  // 一条都没摆过 → 全追加
  assert.deepEqual(abyssArchiveKeysFor(grouped, 1587, new Set()), [
    '3505871',
    '3505872',
    '3505873',
  ])
  // 别的形态不受影响
  assert.deepEqual(abyssArchiveKeysFor(grouped, 1588, new Set()), [])
})

// ---- ③ 行号 → 场合名 ----
//
// 判据与「为什么随包那两个 slot/suffix 字段不算证据」写在
// shared/abyss-voice-file 的「行号 → 场合名」一段。这份护栏把那次对账**整个重跑**，
// 上游哪天串了档、或者谁把对照表按十位数外推了，都在这里当场红。

/** 比对用的归一：与 shared/voice-scene-slots 的 `foldVoiceLineForCompare` 同一档宽度。 */
const fold = (value) =>
  `${value ?? ''}`
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/[、。，．！？!?…‥・「」『』（）()~〜～ー－—\-,.'"”“’‘]/g, '')

/** 場合号 → 该族在 wikiwiki 页面上写作什么（用于同族判定，允许「（壊）」这类后缀变体）。 */
const FAMILY_JA = { 1: /開幕|戦闘開始|会敵/, 2: /砲撃|航空戦|雷撃|攻撃/, 3: /被弾|中破|大破/, 4: /撃沈|海域突破|ゲージ破壊/ }

/**
 * 已知的三条例外——**全部是 subtitle-enemies 自己那一行坏了，不是反例**。
 * 逐条的病因见 shared/abyss-voice-file 的对应段落。名单写死：
 * 新出现的例外会让下面那条断言红，那时该做的是复核对照表，不是往这张名单里加一行。
 */
const KNOWN_BROKEN = new Set(['383172231', '445171130', '445171140'])

test('行号首位就是場合号：官方档名 × wikiwiki 页面场合列，独立对撞', { skip: needWikiwikiAbyss }, () => {
  // 这条路上**没有一步**用到随包 wikiwiki-abyss 那两个 slot/suffix 字段：
  // 它们由我们自己的抓取器从同一个 scene 串算出来，拿来对账是循环论证。
  // 两个包唯一的公共字段是日文原文，于是只按日文原文连，且**只在同一个形态内**连
  //（跨形态连会被「不同深海舰共用同一句台词」串到别人的场合上）。
  const rowsByMst = wikiwikiAbyss.data ?? wikiwikiAbyss
  const offFamily = []
  let compared = 0
  for (const [file, entry] of Object.entries(enemies.data ?? enemies)) {
    const parsed = parseAbyssVoiceFile(file, isAbyss)
    if (!parsed?.lineNo) continue
    const rows = rowsByMst[`${parsed.mstId}`]
    if (!Array.isArray(rows)) continue
    const want = fold(entry?.jp)
    if (!want) continue
    const scenes = [...new Set(rows.filter((row) => fold(row.ja) === want).map((row) => row.scene))]
    if (!scenes.length) continue
    // 同一句在页面上挂着两种场合时跳过——那一条连不出唯一答案，不该算进分子也不算进分母
    const families = new Set(
      scenes.map((scene) => Object.keys(FAMILY_JA).find((digit) => FAMILY_JA[digit].test(scene))),
    )
    if (families.size !== 1) continue
    compared += 1
    const [family] = [...families]
    if (family !== parsed.lineNo[0]) offFamily.push(`${file}（行号 ${parsed.lineNo} / 页面 ${scenes.join('、')}）`)
  }
  // 分母塌了说明包变了，不是「通过」
  assert.ok(compared >= 120, `能对撞的行只剩 ${compared} 条，两个包对不上了？`)
  assert.deepEqual(
    offFamily.filter((note) => !KNOWN_BROKEN.has(note.slice(0, note.indexOf('（')))),
    [],
    '出现了新的串档：行号首位与 wikiwiki 页面场合不同族——对照表待复核，别直接加进 KNOWN_BROKEN',
  )
})

test('随包 309 条档名的行号全部落在四族之内（没有第五种十位数）', () => {
  const seen = new Set()
  for (const file of Object.keys(enemies.data ?? enemies)) {
    const parsed = parseAbyssVoiceFile(file, isAbyss)
    assert.ok(parsed?.lineNo, `${file} 解不出行号`)
    seen.add(parsed.lineNo)
  }
  assert.deepEqual(
    [...seen].sort(),
    ['1', '10', '11', '2', '20', '21', '3', '30', '31', '4', '40', '41'],
    '随包档名冒出了新的行号——先去对撞一次再决定要不要给它名字',
  )
})

test('表内行号得名，表外行号保持「音轨 #」', () => {
  // 四族：一位与两位是同一族，**两个尾数同名**（x0/x1 分不出「其一/其二」，理由见 shared 头注）
  for (const [lineNo, scene] of [
    ['1', '开幕'], ['10', '开幕'], ['11', '开幕'],
    ['2', '炮击'], ['20', '炮击'], ['21', '炮击'],
    ['3', '被弹'], ['30', '被弹'], ['31', '被弹'],
    ['4', '击沉'], ['40', '击沉'], ['41', '击沉'],
  ]) {
    assert.equal(abyssVoiceSceneOfLineNo(lineNo), scene, `行号 ${lineNo} 的场合名不对`)
  }
  // 第 5 族：反解认得它（实物存在），但 wikiwiki 一条都没实测过 → **一个字都不许编**
  for (const lineNo of ['5', '50', '51']) {
    assert.equal(abyssVoiceSceneOfLineNo(lineNo), '', `第 5 族被硬安了场合名`)
  }
  // 压根不在实测里的十位数：不许按「首位」外推
  for (const lineNo of ['6', '7', '60', '71', '90', '', null, undefined]) {
    assert.equal(abyssVoiceSceneOfLineNo(lineNo), '', `${lineNo} 被外推出了场合名`)
  }
})

test('判例：安齊奧沖棲姫-壊 一整族 + 北方棲姫的老式一位行号', () => {
  // 这五条在 wikiwiki 页面上逐条对得上（開幕前 / 砲撃 / 被弾 / 被弾（装甲破砕…）/ 撃沈）
  assert.equal(abyssVoiceSceneOfFile('453188610', isAbyss), '开幕')
  assert.equal(abyssVoiceSceneOfFile('453188620', isAbyss), '炮击')
  assert.equal(abyssVoiceSceneOfFile('453188630', isAbyss), '被弹')
  assert.equal(abyssVoiceSceneOfFile('453188631', isAbyss), '被弹')
  assert.equal(abyssVoiceSceneOfFile('453188641', isAbyss), '击沉')
  // ⚠️ `3505871` 的**行号是 1，不是 71**：它是「前缀 350 + 形态号 587 + 行号 1」
  //（北方棲姫 1587，见上面那批结构判例）。按「末两位」读会读成 71，那是错的——
  // 页面上这一句正是她的「開幕前」，subtitle-enemies 的 ...72/...73 依次是砲撃/被弾。
  assert.equal(abyssVoiceSceneOfFile('3505871', isAbyss), '开幕')
  assert.equal(abyssVoiceSceneOfFile('3505872', isAbyss), '炮击')
  assert.equal(abyssVoiceSceneOfFile('3505873', isAbyss), '被弹')
  // 軽巡ム級 2317 的第 5 族实物：解得出归属，但**不给场合名**
  assert.equal(abyssVoiceMstIdFromFile('611231750', isAbyss), 2317)
  assert.equal(abyssVoiceSceneOfFile('611231750', isAbyss), '')
})

test('两处显示共用同一个函数，且解不出归属时不硬安名字', () => {
  // 台词卷的 subtitle-enemies 支与深海档案段都调 `abyssVoiceRowLabel`：
  // 同一条音轨在两段里必须叫同一个名字（各写一份必然漂移，而漂移不报错）。
  assert.equal(abyssVoiceRowLabel('453188610', isAbyss), '开幕 #453188610')
  assert.equal(abyssVoiceRowLabel('611231750', isAbyss), '音轨 #611231750')
  // 档名号**始终保留**：档案段那些行没有文字，10 与 11 都叫「开幕」，
  // 去掉号玩家就没法指着说「我听到的是这一条」
  assert.equal(abyssVoiceRowLabel('445171110', isAbyss), '开幕 #445171110')
  assert.equal(abyssVoiceRowLabel('445171111', isAbyss), '开幕 #445171111')
  // 主数据没到位 / 归属解不出：退回中性说法，不猜
  assert.equal(abyssVoiceRowLabel('453188610', () => false), '音轨 #453188610')
  assert.equal(abyssVoiceRowLabel('74205910', () => true), '音轨 #74205910') // 多解就是不解
  assert.equal(abyssVoiceRowLabel('not-a-file', isAbyss), '音轨 #not-a-file')
})

test('随包 wikiwiki-abyss 的 slot/suffix 自洽（**这不是场合表的依据**）', { skip: needWikiwikiAbyss }, () => {
  // 留这一条只为盯抓取器：`abyssVoiceSuffix` 第一行就调 `abyssVoiceSlot`，
  // 两个字段同源，零例外是**恒真**的。哪天它不再恒真，说明抓取器被改坏了。
  // 场合对照表的真依据是上面那条「独立对撞」，不是这一条——别把两者搞混。
  const pairs = new Map()
  let rows = 0
  for (const list of Object.values(wikiwikiAbyss.data ?? wikiwikiAbyss)) {
    for (const row of list) {
      rows += 1
      if (row.slot == null && row.suffix == null) continue
      assert.ok(row.slot != null && row.suffix != null, `${row.key} 只有 slot/suffix 其中一个`)
      pairs.set(row.slot, (pairs.get(row.slot) ?? new Set()).add(row.suffix))
    }
  }
  assert.ok(rows > 2_000, `wikiwiki 深海包只剩 ${rows} 行？`)
  assert.deepEqual(
    Object.fromEntries([...pairs].map(([slot, set]) => [slot, [...set].sort((a, b) => a - b)])),
    { opening: [10], attack: [20, 21], damage: [30, 31], sunk: [40, 41] },
  )
})
