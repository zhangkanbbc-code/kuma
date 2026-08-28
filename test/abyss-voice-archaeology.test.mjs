// 深海往期 boss 语音的**耳测考古**：调试门里按推测档名试听 → 听响了收录 → 正式界面点亮（2026-08-25）。
//
// ---- 补的是哪个洞 ----
// 亲历台账只覆盖得到「玩家自己打过」的 boss。往期活动的 boss 没有亲历机会，而随包
// subtitle-enemies（2023 弃更）漏掉一大片：wiki 收了台词的 646 个深海形态里，580 个
// 在随包里一条官方档名都没有（米駆逐棲姫 2204 就是用户实机报的那一格）。
//
// ---- 这一份钉的是整条链，逐环真调用 ----
//   候选生成（结构自证）→ 收录判据 → 折账（带 basis）→ 查表点亮
// 中间任何一环断了，界面上的表现都是「点了收录，那一行还是没有钮」——不报错。
// 渲染那一层进不了 node --test（ji 是带 electron 依赖的渲染模块），
// 于是判据全部落在它调用的**纯函数**上，外加对调试门门控的存在性断言。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { userDataPathIfAny } from '../scripts/lib/data-dir.mjs'
import guess from '../dist/shared/abyss-voice-guess.js'
import fileParse from '../dist/shared/abyss-voice-file.js'
import sighting from '../dist/shared/abyss-voice-sighting.js'

const {
  abyssVoiceFileCandidates,
  abyssVoiceGuessCandidates,
  abyssVoicePrefixCandidates,
  buildAbyssPrefixIndex,
} = guess
const { parseAbyssVoiceFile } = fileParse
const {
  abyssVoiceArchaeologyRow,
  abyssVoiceEarBasis,
  abyssVoiceSceneFamily,
  abyssVoiceSightingFor,
  foldAbyssVoiceSightings,
  isAbyssVoiceEarBasis,
} = sighting

const ji = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
const mgIndex = fs.readFileSync(new URL('../src/main/mg/index.ts', import.meta.url), 'utf8')

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
const wikiAbyss = () => {
  const file = new URL('../assets/lodes/wikiwiki-abyss-voice.json', import.meta.url)
  if (!fs.existsSync(file)) return null
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  return raw.data ?? raw
}

// ---- 整条链 ----

test('未收录不出钮、收录之后出钮——这条链每一环都真跑一遍', () => {
  const isAbyss = (id) => id >= 1500 && id < 2600
  // 米駆逐棲姫 2204「開幕前」那一行：wiki 有台词，随包一条档名都没有
  const mstId = 2204
  const suffix = 10

  // ① 没收录之前：查不到，那一行就没有播放钮（家法——不显示无法验证的钮）
  let list = []
  assert.equal(
    abyssVoiceSightingFor(list, mstId, abyssVoiceSceneFamily(suffix)),
    null,
    '一条都没记过，却给出了地址',
  )

  // ② 调试门给出候选：按可能性排好，条条自证归属
  const index = new Map([[2297, 605], [2317, 611]])
  const candidates = abyssVoiceGuessCandidates(mstId, suffix, index)
  assert.ok(candidates.length > 0, '推不出候选')
  for (const file of candidates) {
    assert.equal(
      parseAbyssVoiceFile(file, isAbyss)?.mstId,
      mstId,
      `候选 ${file} 反解不回本形态——那是让提督拿耳朵去认一条记不下来的档名`,
    )
  }

  // ③ 提督点了其中一条、听响了、点收录
  const picked = candidates[0]
  const row = abyssVoiceArchaeologyRow({ mstId, voiceId: picked }, isAbyss)
  assert.ok(row, '收录判据把一条自证得了归属的候选拒了')
  const folded = foldAbyssVoiceSightings([], [row], 1_700_000_000_000, abyssVoiceEarBasis('2026-08-25'))
  assert.equal(folded.changed, true)
  list = folded.list

  // ④ 正式界面（非调试门）那一行随即点亮，且认的是刚收的那一条
  const lit = abyssVoiceSightingFor(list, mstId, abyssVoiceSceneFamily(suffix))
  assert.ok(lit, '收录之后那一行还是没有钮——链断在查表这一环')
  assert.equal(lit.voiceId, picked)
  assert.equal(lit.lineNo, '10', '行号没解出来，场合对不上就点不亮')
  // ⑤ 判据来路要留得住：界面上这一族与官方自证那一族不该说同一句话
  assert.equal(isAbyssVoiceEarBasis(lit.basis), true, 'basis 回读认不出是耳测那一族')
  assert.equal(lit.basis, '用户耳测考古 2026-08-25')

  // 别的场合不受牵连：收了「開幕前」不等于「砲撃」也有了
  assert.equal(
    abyssVoiceSightingFor(list, mstId, abyssVoiceSceneFamily(20)),
    null,
    '收了一条就把整个形态都点亮了',
  )
})

test('收录一条之后，同形态其余各行的首选候选立刻变准', () => {
  const isAbyss = (id) => id >= 1500 && id < 2600
  const mstId = 2204
  const truth = { 10: '577220410', 20: '577220420', 30: '577220430' }

  // 一条都没收时：前缀只能从邻居猜，首选未必中
  const cold = new Map([[2297, 605], [2317, 611]])
  assert.notEqual(abyssVoiceGuessCandidates(mstId, 20, cold)[0], truth[20])

  // 收了「開幕前」那一条之后，这个形态的前缀与写法都定了
  const list = foldAbyssVoiceSightings(
    [],
    [abyssVoiceArchaeologyRow({ mstId, voiceId: truth[10] }, isAbyss)],
    1,
    abyssVoiceEarBasis('2026-08-25'),
  ).list
  const warm = buildAbyssPrefixIndex(
    list.map((entry) => entry.voiceId),
    isAbyss,
  )
  for (const [suffix, file] of Object.entries(truth)) {
    assert.equal(
      abyssVoiceGuessCandidates(mstId, Number(suffix), warm, [truth[10]])[0],
      file,
      `${suffix} 那一行的首选没跟上——「同形态不混用写法」那一步断了`,
    )
  }
})

test('拿真样本走一遍：wiki 有台词、随包没档名的那些形态都推得出候选', (t) => {
  const ships = master()
  const files = packFiles()
  const wiki = wikiAbyss()
  if (!ships || !files || !wiki) {
    t.skip('缺主数据快照或随包资料')
    return
  }
  const names = new Map(ships.map((one) => [one.api_id, one.api_name]))
  const isAbyss = (id) => id >= 1500 && names.has(id)
  const index = buildAbyssPrefixIndex(files, isAbyss)

  const covered = new Set()
  for (const file of files) {
    const parsed = parseAbyssVoiceFile(file, isAbyss)
    if (parsed?.mstId) covered.add(parsed.mstId)
  }
  const holes = Object.keys(wiki)
    .map(Number)
    .filter((id) => isAbyss(id) && !covered.has(id))
  assert.ok(holes.length > 300, `随包没覆盖到的形态只有 ${holes.length} 个，样本对不上`)

  // 渲染层摆出候选前会**先滤一道归属自证**（ji 的 `abyssSelfAttests`）——
  // shared 那一层没有主数据，判不了「这个号真的存在吗」，所以滤不掉，判据由调用方给。
  // 这一道不是装饰：低段形态的档名偶尔**两读都指向真实存在的形态**
  //（`6467621` 既能读成 1676 也能读成 1762），反解见两解就弃权，那种候选记不下来。
  const selfAttests = (file, mstId) => parseAbyssVoiceFile(file, isAbyss)?.mstId === mstId

  let rows = 0
  let blank = 0
  let raw = 0
  let twoReadable = 0
  const strays = []
  for (const mstId of holes) {
    for (const line of wiki[`${mstId}`] ?? []) {
      if (line.suffix == null) continue
      rows += 1
      const candidates = abyssVoiceGuessCandidates(mstId, line.suffix, index)
      raw += candidates.length
      const shown = candidates.filter((file) => selfAttests(file, mstId))
      twoReadable += candidates.length - shown.length
      if (!shown.length) {
        blank += 1
        continue
      }
      for (const file of shown) {
        if (!selfAttests(file, mstId)) strays.push(`${mstId} → ${file}`)
      }
    }
  }
  assert.ok(rows > 2_000, `只走到 ${rows} 行`)
  assert.ok(raw > 20_000, `只生成了 ${raw} 条候选`)
  // 滤过之后一条不剩：收录那一步的前提就是这个
  assert.deepEqual(strays.slice(0, 5), [], `${strays.length} 条候选反解不回本形态`)
  // 那一道滤子是**真在干活**的。降到 0 说明它被人当成冗余删了（或者判据被放宽了），
  // 涨上去说明反解的消歧变差了——两头都该当场知道。
  assert.ok(twoReadable > 0, '一条两读候选都没滤掉？归属自证那道滤子怕是失效了')
  assert.ok(twoReadable / raw < 0.01, `两读候选占到 ${twoReadable}/${raw}，反解的消歧变差了`)
  // 推不出候选的是「附近一条已知档名都没有」那种，UI 会请提督手输前缀。
  // 这个数一旦变大就说明索引建坏了。
  assert.ok(blank / rows < 0.02, `${blank}/${rows} 行推不出候选，索引可能建坏了`)
})

/**
 * 小样本：本机未匹配台账里玩家**实际请求过**的 kc9998 档名（只读用户文件）。
 * 与随包那 309 条互相独立——那批是文本源收录的，这批是玩家在战斗里真听到、
 * 而一个文本源都没认领的。
 */
const localFiles = () => {
  const file = userDataPathIfAny('voice-unmatched.json')
  if (!file || !fs.existsSync(file)) return null
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  return [
    ...new Set(
      (raw.records ?? [])
        .map((row) => (`${row?.pathname ?? ''}`.match(/kc9998\/(\d+)\.mp3/) ?? [])[1])
        .filter(Boolean),
    ),
  ]
}

test('第二批真样本（本机实际请求过的那些）同样走得通这条链', (t) => {
  const ships = master()
  const pack = packFiles()
  const local = localFiles()
  if (!ships || !pack || !local?.length) {
    t.skip('缺主数据快照或本机未匹配台账')
    return
  }
  const names = new Map(ships.map((one) => [one.api_id, one.api_name]))
  const isAbyss = (id) => id >= 1500 && names.has(id)
  // 索引**只用随包那批建**：本机这批要当独立样本，喂进去就成了自问自答
  const index = buildAbyssPrefixIndex(pack, isAbyss)

  let checked = 0
  let guessed = 0
  for (const file of local) {
    const parsed = parseAbyssVoiceFile(file, isAbyss)
    assert.ok(parsed?.mstId, `${file} 解不出归属`)
    if (!parsed.lineNo) continue
    checked += 1
    // ① 手输前缀那条路（「都不响」时的兜底）：前缀填对就一定能把真档名拼出来。
    //    前缀由反解自己切，别在测试里手算。
    const prefixes = abyssVoicePrefixCandidates(file, parsed.mstId)
    assert.ok(prefixes.length > 0, `${file} 切不出前缀`)
    assert.ok(
      prefixes.some((prefix) =>
        abyssVoiceFileCandidates(prefix, parsed.mstId, parsed.lineNo).includes(file),
      ),
      `${file} 手输前缀也拼不回来`,
    )
    // ② 纯推测那条路：中不中都记下来，下面按比例断言
    if (abyssVoiceGuessCandidates(parsed.mstId, parsed.lineNo, index).includes(file)) guessed += 1
  }
  assert.ok(checked >= 20, `本机样本只核到 ${checked} 条`)
  // 这批形态大多不在随包里，纯靠邻居推的命中率本来就不高——这里只钉「不是零」，
  // 零就说明索引或推测整条断了。**别把这个数当成能算准的证据**（头注量过：钉不死）。
  assert.ok(guessed > 0, '第二批样本里一条都没被推中，推测链路怕是断了')
})

// ---- 调试门与三条纪律 ----

test('试听 UI 整块受 KANSO_DEBUG_UI 管，发布形态里一个字都不生成', () => {
  assert.match(ji, /const DEBUG_UI = process\.env\.KANSO_DEBUG_UI === '1'/)
  // 生成 DOM 的那一个函数**头一行就退出**，不是在外面包一层 if
  const at = ji.indexOf('const abyssGuessBlock =')
  assert.ok(at > 0, '找不到试听 UI 的渲染函数')
  const head = ji.slice(at, at + 200)
  assert.match(head, /if \(!DEBUG_UI\) return ''/, '发布形态里这段 DOM 还会生成')
})

test('试听只走既有出口，且没有任何批量调用', () => {
  // 地址一律 extraVoiceUrl（档案实物优先，其次受钥开关管的现取）
  assert.ok(ji.includes("extraVoiceUrl('enemy', file)"), '试听没走既有的深海音轨出口')
  // 这一段里不许自己拼对外地址
  const at = ji.indexOf("const tryButton = target.closest<HTMLElement>('[data-abyss-try]')")
  assert.ok(at > 0, '找不到试听的点击入口')
  const body = ji.slice(at, at + 1_600)
  assert.ok(!/https?:\/\//.test(body), '试听那一段自己拼了一个对外地址')
  // **一次点击一条**：播放调用不许出现在循环/并发里（同语音探测那条家法）
  const offenders = [...ji.matchAll(/[^\n]*playVoiceUrl\([^\n]*/g)]
    .map((m) => m[0])
    .filter((line) => /\b(?:for|while|\.map\(|\.forEach\(|Promise\.all)\b/.test(line))
  assert.deepEqual(offenders, [], `播放被批量调用了：\n${offenders.join('\n')}`)
  // 没取到就只标一句，不重试
  assert.ok(
    /verdict === 'played' \? 'played' : 'missing'/.test(ji),
    '没有把「没取到」和「响了」分开记',
  )
  assert.ok(!/setTimeout[^\n]*abyssGuess|abyssGuess[^\n]*retry/i.test(ji), '出现了重试的形状')
})

test('收录口在主进程按真主数据复核归属，不裸信渲染层报上来的号', () => {
  assert.ok(mgIndex.includes("ipcMain.handle('mg:abyss-voice-record'"), '没有收录 IPC')
  const at = mgIndex.indexOf("ipcMain.handle('mg:abyss-voice-record'")
  const body = mgIndex.slice(at, at + 400)
  assert.ok(body.includes('recordAbyssVoiceArchaeology'), '收录口没走落盘层那条判据')
  assert.ok(body.includes('isAbyssFormMstId'), '没拿真主数据复核归属')
  // 深海号集合必须由主数据建，只按值域判会让反解见两解就弃权
  assert.match(
    mgIndex,
    /abyssFormIds = new Set\(/,
    '深海形态集合不是从主数据建的',
  )
  // 收录这条路上一个请求都不该有
  assert.ok(!/fetch\(|https?:\/\//.test(body), '收录口上出现了请求')
})
