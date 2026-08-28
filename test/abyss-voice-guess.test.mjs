// 深海往期 boss 语音的考古推测（2026-08-25）。
//
// 档名 = 前缀 + 形态号 + 行号（605229710 = 605|2297|10）。形态号与行号已经是实证
// 过的结构，**前缀是这次要考证的那一段**。结论写在 shared/abyss-voice-guess 头注：
// 它是随版本递增的序号，最近邻只猜得中六成——**钉不死**，所以 UI 给默认值 + 手输口，
// 一次一条人肉点。下面这批把「结构可逆」与「六成」这两件事都钉住。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { userDataPathIfAny } from '../scripts/lib/data-dir.mjs'
import guess from '../dist/shared/abyss-voice-guess.js'
import fileParse from '../dist/shared/abyss-voice-file.js'

const {
  ABYSS_VOICE_WRITING_RANK,
  abyssVoiceFileCandidates,
  abyssVoiceFileOf,
  abyssVoiceFormSegment,
  abyssVoiceFormSegments,
  abyssVoiceFormWritingOf,
  abyssVoiceGuessCandidates,
  abyssVoicePrefixCandidates,
  buildAbyssPrefixIndex,
  guessAbyssVoicePrefixes,
} = guess
const { parseAbyssVoiceFile } = fileParse

const master = () => {
  const file = new URL('../../s2.json', import.meta.url)
  if (!fs.existsSync(file)) return null
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  return (raw.api_data ?? raw).api_mst_ship ?? null
}
const packFiles = () => {
  const file = new URL('../assets/lodes/subtitle-enemies.json', import.meta.url)
  if (!fs.existsSync(file)) return null
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  return Object.keys(raw.data ?? raw).filter((key) => /^\d+$/.test(key))
}
/** 本机未匹配台账里玩家实际听到过的 kc9998 请求（只读）。 */
const localFiles = () => {
  const file = userDataPathIfAny('voice-unmatched.json')
  if (!file || !fs.existsSync(file)) return null
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  return (raw.records ?? [])
    .map((row) => (`${row?.pathname ?? ''}`.match(/kc9998\/(\d+)\.mp3/) ?? [])[1])
    .filter(Boolean)
}

test('拼档名：结构可逆，三段任一不合法就不拼', () => {
  // battle.ts 头注里那条真样本
  assert.equal(abyssVoiceFileOf(605, 2297, 10), '605229710')
  // 1500–1999 用三位形态号（332|653|30，集積地棲姫）
  assert.equal(abyssVoiceFormSegment(1653), '653')
  assert.equal(abyssVoiceFileOf(332, 1653, 30), '33265330')
  assert.equal(abyssVoiceFormSegment(2297), '2297')
  // 1500–1999 三种写法都在真包里出现过，缺一种就会掉一大片
  assert.deepEqual(abyssVoiceFormSegments(1722), ['722', '0722', '1722'])
  assert.deepEqual(abyssVoiceFormSegments(2297), ['2297'])
  assert.ok(abyssVoiceFileCandidates(383, 1722, 10).includes('383172210'))
  // 不合法的一律不拼——半成品地址比没有更糟
  assert.equal(abyssVoiceFileOf(605, 2297, 99), null, '行号 99 不是合法場合')
  assert.equal(abyssVoiceFileOf(6, 2297, 10), null, '前缀只有一位')
  assert.equal(abyssVoiceFileOf(605, 131, 10), null, '不是深海形态')
  assert.equal(abyssVoiceFileOf('', 2297, 10), null)
})

test('随包 309 条官方档名全部能由「前缀+形态+行号」原样拼回来', (t) => {
  const ships = master()
  const files = packFiles()
  if (!ships || !files) {
    t.skip('缺主数据快照或 subtitle-enemies 包')
    return
  }
  const names = new Map(ships.map((one) => [one.api_id, one.api_name]))
  const isAbyss = (id) => id >= 1500 && names.has(id)
  const index = buildAbyssPrefixIndex(files, isAbyss)
  assert.ok(index.size > 60, `只建出 ${index.size} 个形态的前缀，样本不对`)

  // 每一条都要能由某个合法读法原样拼回来。309/309——形态号三种写法一个都不能少，
  // 少一种就会掉一大片（少「四位 mstId 本身」那种时实测掉到 172/309）。
  const broken = []
  for (const file of files) {
    const parsed = parseAbyssVoiceFile(file, isAbyss)
    if (!parsed?.mstId || !parsed.lineNo) continue
    const readings = abyssVoicePrefixCandidates(file, parsed.mstId)
    const round = readings.some((prefix) =>
      abyssVoiceFileCandidates(prefix, parsed.mstId, parsed.lineNo).includes(file),
    )
    if (!round) broken.push(file)
  }
  assert.deepEqual(broken.slice(0, 5), [], `${broken.length} 条拼不回来——档名结构的判据有漏`)
})

test('本机 25 条实际请求同样拼得回来（独立样本）', (t) => {
  const ships = master()
  const files = localFiles()
  if (!ships || !files?.length) {
    t.skip('本机没有未匹配台账')
    return
  }
  const names = new Map(ships.map((one) => [one.api_id, one.api_name]))
  const isAbyss = (id) => id >= 1500 && names.has(id)
  let checked = 0
  for (const file of files) {
    const parsed = parseAbyssVoiceFile(file, isAbyss)
    assert.ok(parsed?.mstId, `${file} 解不出归属`)
    const readings = abyssVoicePrefixCandidates(file, parsed.mstId)
    assert.ok(readings.length > 0, `${file} 切不出前缀`)
    assert.ok(
      readings.some((prefix) =>
        abyssVoiceFileCandidates(prefix, parsed.mstId, parsed.lineNo).includes(file),
      ),
      `${file} 拼不回来`,
    )
    checked += 1
  }
  assert.equal(checked, files.length, '有条目没被核到')
})

test('前缀只能猜、猜不准——钉住「六成」这个事实，别再当它能算', (t) => {
  const ships = master()
  const files = packFiles()
  if (!ships || !files) {
    t.skip('缺样本')
    return
  }
  const names = new Map(ships.map((one) => [one.api_id, one.api_name]))
  const isAbyss = (id) => id >= 1500 && names.has(id)
  const index = buildAbyssPrefixIndex(files, isAbyss)

  let hit = 0
  let total = 0
  for (const [mstId, prefix] of index) {
    const others = new Map([...index].filter(([id]) => id !== mstId))
    const candidates = guessAbyssVoicePrefixes(mstId, others)
    if (!candidates.length) continue
    total += 1
    if (candidates[0] === prefix) hit += 1
  }
  assert.ok(total > 40, `留一样本只有 ${total} 个`)
  // 命中率实测约六成。低于 0.4 说明规律变了（或索引建坏了），该重新考证；
  // 高到 1.0 说明有人把它当成了确定算法——那更危险，会诱导自动扫号。
  const rate = hit / total
  assert.ok(rate > 0.4, `最近邻命中率掉到 ${rate.toFixed(2)}，前缀规律该重新考证`)
  assert.ok(rate < 0.95, `命中率 ${rate.toFixed(2)} 高得不像话，检查是不是把答案漏给了推测函数`)
})

test('已知形态直接给它自己的前缀（那不是猜）', () => {
  const index = new Map([[2297, 605], [2317, 611]])
  assert.deepEqual(guessAbyssVoicePrefixes(2297, index), [605])
  // 未知形态：最近邻打头，再 ±1、±2
  // 2300 离 2297（差 3）比离 2317（差 17）近 → 最近邻是 605
  const candidates = guessAbyssVoicePrefixes(2300, index)
  assert.equal(candidates[0], 605, '最近邻取错了')
  assert.ok(candidates.length > 1 && candidates.includes(606) && candidates.includes(604))
})

test('没有样本就不猜', () => {
  assert.deepEqual(guessAbyssVoicePrefixes(2204, new Map()), [])
  assert.deepEqual(abyssVoiceGuessCandidates(2204, 10, new Map()), [])
})

// ---- 候选排序（2026-08-25 加：调试门试听 UI 逐个点的就是这一串）----

test('认得出一条已知档名用的是哪种写法，两读的一律不认', () => {
  // 605|2297|10 —— ≥2000 只有一种写法
  assert.equal(abyssVoiceFormWritingOf('605229710', 2297), 0)
  // 332|653|30 —— 三位写法（下标 0）
  assert.equal(abyssVoiceFormWritingOf('33265330', 1653), 0)
  // 276|0557|1 —— 补零四位（下标 1）
  assert.equal(abyssVoiceFormWritingOf('27605571', 1557), 1)
  // 383|1722|10 —— 四位 mstId 本身（下标 2）
  assert.equal(abyssVoiceFormWritingOf('383172210', 1722), 2)
  // 头注「两读歧义」那一条：3505871 = 35|0587|1 也 = 350|587|1
  assert.equal(abyssVoiceFormWritingOf('3505871', 1587), null, '两读都成立却认了一种写法')
  assert.equal(abyssVoiceFormWritingOf('605229710', 1653), null, '形态号根本不在这串里')
})

test('候选**条条自证归属**——收录那一步全靠这个前提', (t) => {
  // 试听 UI 会把候选交给用户耳测，点「收录」时归属由档名结构自证。
  // 万一有候选反解不回本形态，那就是「让用户拿耳朵去认一条我们记不下来的档名」。
  const ships = master()
  const files = packFiles()
  if (!ships || !files) {
    t.skip('缺样本')
    return
  }
  const names = new Map(ships.map((one) => [one.api_id, one.api_name]))
  const isAbyss = (id) => id >= 1500 && names.has(id)
  const index = buildAbyssPrefixIndex(files, isAbyss)

  const strays = []
  let emitted = 0
  for (const mstId of [...names.keys()].filter(isAbyss)) {
    for (const lineNo of [10, 20, 30, 40]) {
      for (const file of abyssVoiceGuessCandidates(mstId, lineNo, index)) {
        emitted += 1
        if (parseAbyssVoiceFile(file, isAbyss)?.mstId !== mstId) strays.push(`${mstId} → ${file}`)
      }
    }
  }
  assert.ok(emitted > 5_000, `只生成了 ${emitted} 条候选，样本不对`)
  assert.deepEqual(strays.slice(0, 5), [], `${strays.length} 条候选反解不回本形态`)
})

test('排序真的把真档名往前排（留一交叉验证，别把它退化回原序）', (t) => {
  const ships = master()
  const files = packFiles()
  if (!ships || !files) {
    t.skip('缺样本')
    return
  }
  const names = new Map(ships.map((one) => [one.api_id, one.api_name]))
  const isAbyss = (id) => id >= 1500 && names.has(id)
  const index = buildAbyssPrefixIndex(files, isAbyss)

  let ranked = 0
  let naive = 0
  let total = 0
  for (const file of files) {
    const parsed = parseAbyssVoiceFile(file, isAbyss)
    if (!parsed?.mstId || !parsed.lineNo || !index.has(parsed.mstId)) continue
    // 把这个形态整个从索引里拿掉：候选只许从**别的**形态推出来
    const others = new Map([...index].filter(([id]) => id !== parsed.mstId))
    if (!others.size) continue
    total += 1
    if (abyssVoiceGuessCandidates(parsed.mstId, parsed.lineNo, others)[0] === file) ranked += 1
    const flat = guessAbyssVoicePrefixes(parsed.mstId, others).flatMap((prefix) =>
      abyssVoiceFileCandidates(prefix, parsed.mstId, parsed.lineNo),
    )
    if (flat[0] === file) naive += 1
  }
  assert.ok(total > 200, `留一样本只有 ${total} 条`)
  // 实测 165/328 对 86/328。写法名次被人调回原序时这一条当场红。
  assert.ok(ranked > naive, `排序没比原序强（${ranked} vs ${naive}）——写法名次被改回去了？`)
  assert.ok(ranked / total > 0.35, `首选命中率掉到 ${(ranked / total).toFixed(2)}`)
  // 高到离谱同样是病：那说明答案漏给了推测函数，会诱导「反正算得准」去自动扫号
  assert.ok(ranked / total < 0.9, `首选命中率 ${(ranked / total).toFixed(2)} 高得不像话`)
})

test('同形态已确认过一条，其余各行基本一点就中', (t) => {
  const ships = master()
  const files = packFiles()
  if (!ships || !files) {
    t.skip('缺样本')
    return
  }
  const names = new Map(ships.map((one) => [one.api_id, one.api_name]))
  const isAbyss = (id) => id >= 1500 && names.has(id)
  const byForm = new Map()
  for (const file of files) {
    const parsed = parseAbyssVoiceFile(file, isAbyss)
    if (!parsed?.mstId || !parsed.lineNo) continue
    byForm.set(parsed.mstId, [...(byForm.get(parsed.mstId) ?? []), file])
  }

  let hit = 0
  let total = 0
  for (const [mstId, group] of byForm) {
    if (group.length < 2) continue
    for (const target of group) {
      const seed = group.find((one) => one !== target)
      const seedIndex = buildAbyssPrefixIndex([seed], isAbyss)
      if (!seedIndex.has(mstId)) continue
      const lineNo = parseAbyssVoiceFile(target, isAbyss).lineNo
      total += 1
      if (abyssVoiceGuessCandidates(mstId, lineNo, seedIndex, [seed])[0] === target) hit += 1
    }
  }
  assert.ok(total > 100, `成对样本只有 ${total} 条`)
  // 实测 301/317。掉下来说明「已知形态直接给它自己的前缀」或写法提前那一步断了。
  assert.ok(hit / total > 0.85, `已知形态的首选命中率只有 ${(hit / total).toFixed(2)}`)
})

test('写法名次是三种写法的一个排列，不多不少', () => {
  assert.deepEqual([...ABYSS_VOICE_WRITING_RANK].sort(), [0, 1, 2])
  // ≥2000 只有一种写法，名次表不该让它多生出候选
  assert.deepEqual(abyssVoiceGuessCandidates(2297, 10, new Map([[2297, 605]])), ['605229710'])
  // 1500–1999 给三种写法，四位 mstId 那种打头（实测最常见）
  assert.deepEqual(abyssVoiceGuessCandidates(1722, 10, new Map([[1722, 383]])), [
    '383172210',
    '383072210',
    '38372210',
  ])
})
