// 钦（qn）的任务实体反查里有两套坐标系，混用过一次：
//
//   matchTaskEntityHits / markTaskEntityHits 的 acceptAlias 拿到的是**去掉空白的
//   紧凑串**坐标；matchTaskNationalityHits 是在**保留空白的对齐串**上找的。
//
// 句子里每有一个空格，两边的 start 就差一位，rangesOverlap 比的根本不是同一段
// 文字——「这处舰名其实是国籍」的排重于是随机失灵。这个文件钉两件事：
//   1. 真任务（B147 / B148 / Cy14）上两套坐标确实不同，所以必须归一到同一套；
//   2. 归一之后排重才真的成立（Italia 的中文名就是「意大利」，与国籍同形）。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { buildSync } from 'esbuild'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-quest-nationality-'))
const output = path.join(tempDir, 'task-entity-match.cjs')
buildSync({
  entryPoints: [fileURLToPath(new URL('../src/renderer/task-entity-match.ts', import.meta.url))],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'silent',
})
const require = createRequire(import.meta.url)
const matcher = require(output)

test.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

const {
  allowTaskShipAlias,
  markTaskEntityHits,
  matchTaskEntityHits,
  matchTaskNationalityHits,
  normalizeTaskEntityText,
  rangesOverlap,
  taskEntityMemoText,
} = matcher

const questsByCode = (() => {
  const pack = JSON.parse(
    fs.readFileSync(new URL('../assets/lodes/quests-scn.json', import.meta.url), 'utf8'),
  )
  const data = pack.data ?? pack
  const out = new Map()
  for (const quest of Object.values(data)) out.set(quest.code, quest)
  return out
})()

// 钦的详情面板就是这么拼这段文本的（entityChipsHtml）
const questText = (quest) =>
  `${quest.name} ${quest.desc} ${taskEntityMemoText(quest.memo2 ?? '')}`

test('国籍命中与实体命中必须落在同一坐标系（B147 / B148 / Cy14 真任务）', () => {
  const codes = ['B147', 'B148', 'Cy14']
  let framesDiffered = 0
  for (const code of codes) {
    const quest = questsByCode.get(code)
    assert.ok(quest, `任务库里没有 ${code}，这条护栏失去了锚`)
    const text = questText(quest)
    const packed = normalizeTaskEntityText(text)

    // 归一到紧凑串之后取的国籍命中，坐标必须能原样切回自己那几个字——
    // 这正是 acceptAlias 里 rangesOverlap 所在的坐标系。
    const packedHits = matchTaskNationalityHits(packed)
    assert.ok(packedHits.length > 0, `${code} 应当认出国籍`)
    for (const hit of packedHits) {
      assert.equal(
        packed.slice(hit.start, hit.start + hit.length),
        hit.alias,
        `${code}：紧凑坐标下的国籍段对不上自己的别名`,
      )
    }

    // 直接拿原文命中去和紧凑坐标比就是错位。这三条真任务全都错位（空格多则差 4 位），
    // 所以这不是理论问题——谁把归一去掉，这里就会绿转红。
    const rawHits = matchTaskNationalityHits(text)
    if (rawHits.some((hit) => packed.slice(hit.start, hit.start + hit.length) !== hit.alias)) {
      framesDiffered += 1
    }
  }
  assert.equal(
    framesDiffered,
    codes.length,
    '这三条真任务本来每条都错位；若不再错位，说明上游改了坐标口径，这条护栏要重写',
  )
})

test('同坐标系下，与国籍同形的舰名（Italia = 意大利）才排得掉', () => {
  // 索引条目按钦的真形状造：Italia（api_id 446）的中文译名就是「意大利」，
  // 与国籍词完全同形——这正是「涉及舰娘」需要排重的那一类。
  const ships = [{ id: 446, name: 'Italia', simple: '意大利', aliases: ['意大利', 'italia'] }]
  // 文本按 Cy14 的形状拼（name + 空格 + desc + 空格 + memo，memo 内部还有空格），
  // 舰名/国籍那处出现在 memo 段，前面攒够的空白足以让两套坐标真正岔开。
  const text = [
    '【欧洲舰队】演习！',
    '编成以欧洲出生的舰艇为旗舰、包含旗舰在内欧洲舰艇3艘以上的演习舰队。',
    '年常任务(7月) 演习舰队需要 【包括旗舰在内共3艘「海外舰|意大利出生的舰艇」】 演习4回A胜',
  ].join(' ')

  const packedHits = matchTaskNationalityHits(normalizeTaskEntityText(text))
  const rawHits = matchTaskNationalityHits(text)
  assert.ok(packedHits.length > 0 && rawHits.length > 0)

  const shipsWith = (nationalityRanges) =>
    matchTaskEntityHits(ships, text, 2, {
      skipClassSuffix: true,
      allowQuotedSingle: true,
      acceptAlias: (candidate) =>
        allowTaskShipAlias(candidate) &&
        !nationalityRanges.some((hit) => rangesOverlap(candidate, hit)),
    }).map((hit) => hit.entry.id)
  const marksWith = (nationalityRanges) =>
    markTaskEntityHits(ships, text, 2, {
      skipClassSuffix: true,
      allowQuotedSingle: true,
      acceptAlias: (candidate) =>
        allowTaskShipAlias(candidate) &&
        !nationalityRanges.some((hit) => rangesOverlap(candidate, hit)),
    }).map((hit) => hit.entry.id)

  // 同坐标系：这处「意大利」是国籍，不该再算成舰娘 Italia
  assert.deepEqual(shipsWith(packedHits), [], '涉及舰娘把国籍词当成了舰名')
  assert.deepEqual(marksWith(packedHits), [], '正文把国籍词又涂了一遍舰娘色')
  // 跨坐标系：错位之后排重整个失效——这两条说明上面那两条不是空跑
  assert.deepEqual(shipsWith(rawHits), [446])
  assert.deepEqual(marksWith(rawHits), [446])
})

test('钦两处排重都用紧凑坐标下的国籍命中', () => {
  const qn = fs.readFileSync(new URL('../src/renderer/modules/qn.ts', import.meta.url), 'utf8')
  // 唯一的换算口径：对归一化之后的文本再取一次国籍命中
  assert.match(
    qn,
    /const nationalityRangesInPackedText = \(rawText: string\) =>\s*\n\s*matchTaskNationalityHits\(normalizeEntityText\(rawText\)\)/,
  )
  // 正文标注（questEntityMarks）与「涉及舰娘」（entityChipsHtml）两处都走它
  assert.match(qn, /questEntityMarks\(text, code, nationalityRangesInPackedText\(text\)\)/)
  assert.match(qn, /const nationalityRanges = nationalityRangesInPackedText\(text\)/)
  assert.match(qn, /!nationalityRanges\.some\(\(nationalityHit\) => rangesOverlap\(candidate, nationalityHit\)\)/)
  // 原文坐标那份只许喂给标注（它要切原文），不许再进 acceptAlias
  assert.doesNotMatch(
    qn,
    /acceptAlias[\s\S]{0,200}nationalityHits\.some/,
    '又把原文坐标的国籍命中拿去和紧凑坐标比了',
  )
})
