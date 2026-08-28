import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { buildSync } from 'esbuild'

import emphasis from '../dist/shared/quest-emphasis.js'

const {
  cleanQuestText,
  emphasisMarks,
  mergeQuestMarks,
  renderQuestMarks,
} = emphasis

// 保长匹配住在渲染层（索引也在那儿），单独编一份出来测坐标
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-quest-emphasis-'))
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
const {
  alignedTaskEntityText,
  markTaskEntityHits,
  normalizeTaskEntityText,
  TASK_SHIP_TEXT_ALIASES,
} = require(output)
test.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

const questsUrl = new URL('../assets/lodes/quests-scn.json', import.meta.url)
const quests = fs.existsSync(questsUrl)
  ? Object.values(JSON.parse(fs.readFileSync(questsUrl, 'utf8')).data)
  : null

const marksOf = (raw, options = {}) => {
  const { text, links } = cleanQuestText(raw)
  return { text, marks: mergeQuestMarks(emphasisMarks(text, links, options)) }
}
const kindsAt = (raw, options) => {
  const { text, marks } = marksOf(raw, options)
  return marks.map((mark) => [mark.kind, text.slice(mark.start, mark.start + mark.length)])
}

test('wiki pipes collapse to the display half and report where it landed', () => {
  const { text, links } = cleanQuestText('在「1-1|镇守府正面海域(1-1)」派出舰队出击！')
  assert.equal(text, '在「镇守府正面海域(1-1)」派出舰队出击！')
  assert.equal(links.length, 1)
  const [link] = links
  // 坐标必须落在清洗**之后**的串上，否则标记会插进句子中间
  assert.equal(text.slice(link.start, link.start + link.length), '镇守府正面海域(1-1)')
  assert.equal(link.target, '1-1')
})

test('a pipe outside quotes, or with mismatched quotes, is left alone', () => {
  // 引号不配对：不知道边界在哪，宁可原样显示
  assert.equal(cleanQuestText('「甲|乙』').text, '「甲|乙』')
  // 句中的裸竖线不动（除了已知的模板名）
  assert.equal(cleanQuestText('废弃 甲之类|编号 = 049').text, '废弃 甲之类|编号 = 049')
})

test('template leftovers from the wiki dump are dropped, not shown to the player', () => {
  assert.equal(cleanQuestText('gray|【期间限定任务】从').text, '【期间限定任务】从')
  assert.equal(cleanQuestText('期间限定月常任务  gray|编成').text, '期间限定月常任务  编成')
  assert.equal(cleanQuestText('「lang|ja|手编みとフローリング」').text, '「手编みとフローリング」')
  assert.equal(cleanQuestText('首格装备装备奖励|编号 = 037').text, '首格装备编号 = 037')
  // 行首内链：短词才剥，长句不碰
  assert.equal(cleanQuestText('美国舰|美国舰娘2只').text, '美国舰娘2只')
  assert.equal(cleanQuestText('第一舰队轻巡级旗舰首格装备|甲').text, '第一舰队轻巡级旗舰首格装备|甲')
})

test('quantities are marked with their 以上/以下 tail attached', () => {
  assert.deepEqual(kindsAt('以3艘以上伊号「潜水艇」编成'), [['num', '3艘以上']])
  assert.deepEqual(kindsAt('内演习达成三次以上『S胜』！'), [
    ['num', '三次以上'],
    ['rank', 'S胜'],
  ])
})

test('serial numbers and ship names that merely contain digits stay plain', () => {
  // 「（第二次）」是同系列任务的第几作，不是要打几次
  assert.deepEqual(kindsAt('「望月」4艘编成第三十驱逐队（第二次）！'), [['num', '4艘']])
  // 「五月雨」「三川舰队」「第二舰队」「一号舰」都不是数量
  assert.deepEqual(kindsAt('「五月雨」与三川舰队在第二舰队，一号舰为旗舰'), [])
})

test('practice grades are caught in every spelling the library uses', () => {
  assert.deepEqual(kindsAt('取得【S判定】胜利').map(([kind]) => kind), ['rank'])
  assert.deepEqual(kindsAt('获得「完全胜利」！').map(([, word]) => word), ['完全胜利'])
  assert.deepEqual(kindsAt('达成4次以上【A胜】！'), [
    ['num', '4次以上'],
    ['rank', 'A胜'],
  ])
  // 英文词里的 A/S 不是判定
  assert.deepEqual(kindsAt('This is a 胜利'), [])
})

test('level gates count as quantities, and their range is not read as a map code', () => {
  assert.deepEqual(kindsAt('配备高练度(Lv.90～99)的舰娘'), [['num', 'Lv.90～99']])
  assert.deepEqual(kindsAt('旗舰和二号舰为Lv50以上'), [['num', 'Lv50以上']])
})

test('map codes swallow the third segment, and unknown ids can be filtered out', () => {
  assert.deepEqual(kindsAt('「塔威塔威泊地海岸」深部（7-2-2）进发'), [['map', '7-2-2']])
  // 主数据在手时用它挡掉巧合；不给 isMapId 就只按形态认
  assert.deepEqual(kindsAt('准备 3-9 的东西', { isMapId: (id) => id === 11 }), [])
})

test('the widest mark wins, so a map name is not chopped up by the code inside it', () => {
  const { text, marks } = marksOf('消灭「1-1|镇守府正面海域(1-1)」的敌人')
  assert.equal(marks.length, 1)
  assert.equal(text.slice(marks[0].start, marks[0].start + marks[0].length), '镇守府正面海域(1-1)')
  assert.equal(marks[0].ref, 11)
})

test('rendering escapes every slice, marked or not', () => {
  const { text, marks } = marksOf('<b>3艘</b> & 「1-1|A(1-1)」')
  const html = renderQuestMarks(
    text,
    marks,
    (raw) => raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    (mark, inner) => `<i data-k="${mark.kind}">${inner}</i>`,
  )
  assert.ok(!html.includes('<b>'), '正文里的尖括号必须被转义')
  assert.ok(html.includes('<i data-k="num">3艘</i>'))
  assert.ok(html.includes('&amp;'))
})

test('the aligned normaliser keeps offsets usable, or refuses the job', () => {
  const raw = '将「妙高 改二」ｄ配备'
  const aligned = alignedTaskEntityText(raw)
  assert.equal(aligned.length, raw.length, '归一不能改变长度，否则坐标全错')
  assert.equal(aligned[8], 'd') // 全角折叠成半角，仍是 1:1
  // 合字类字符 NFKC 之后会变长，这时宁可整段不标注
  assert.equal(alignedTaskEntityText('㍿の任务'), null)
})

test('entity marks report every occurrence at real offsets', () => {
  const entries = [{ id: 1, name: '雪风', simple: '雪风', aliases: ['雪风'] }]
  const text = '「雪风」出击，再让雪风回港'
  const hits = markTaskEntityHits(entries, text, 2)
  assert.equal(hits.length, 2)
  for (const hit of hits) assert.equal(text.slice(hit.start, hit.start + hit.length), '雪风')
})

test('a mark that starts right after an opening quote fills the whole quote', () => {
  const text = '使用「Fletcher MK.II」作为旗舰，让「妙高」出击'
  const marks = emphasis.spreadMarksToQuotes(text, [
    { start: text.indexOf('Fletcher'), length: 'Fletcher'.length, kind: 'ship', ref: 1 },
    { start: text.indexOf('妙高'), length: 2, kind: 'ship', ref: 2 },
  ])
  assert.equal(text.slice(marks[0].start, marks[0].start + marks[0].length), 'Fletcher MK.II')
  assert.equal(text.slice(marks[1].start, marks[1].start + marks[1].length), '妙高')
})

test('a mark in the middle of a quote is not spread outwards', () => {
  const text = '「第六驱逐队」编成'
  const marks = emphasis.spreadMarksToQuotes(text, [
    { start: text.indexOf('驱逐'), length: 2, kind: 'type', ref: 2 },
  ])
  assert.equal(marks[0].length, 2)
})

test('a name with a space inside is matched whole, space included', () => {
  // 索引里存的是去空白的「fletchermk.ii」，正文里写「Fletcher Mk.II」
  const entries = [{
    id: 1,
    name: 'Fletcher Mk.II',
    simple: 'fletchermk.ii',
    aliases: [normalizeTaskEntityText('Fletcher Mk.II')],
  }]
  const text = '使用「Fletcher Mk.II」作为旗舰'
  const [hit] = markTaskEntityHits(entries, text, 3)
  assert.ok(hit, '带空格的名字应当认得出来')
  assert.equal(text.slice(hit.start, hit.start + hit.length), 'Fletcher Mk.II')
})

test('single-character ship names only count inside quotes', () => {
  const entries = [{ id: 2, name: '响', simple: '响', aliases: ['响'] }]
  assert.equal(markTaskEntityHits(entries, '影响出击', 2, { allowQuotedSingle: true }).length, 0)
  assert.equal(markTaskEntityHits(entries, '带上「响」', 2, { allowQuotedSingle: true }).length, 1)
})

test('traditional-Chinese quest text lands on the simplified index names', () => {
  // 限时任务的正文常是 kcwiki 编者直接贴的繁中，而索引里是简体译名。
  // 归一表两边都跑，所以只要归到同一形就算认出来。
  for (const [traditional, simplified] of [
    ['塔斯卡盧薩', '塔斯卡卢萨'],
    ['甘比爾灣', '甘比尔湾'],
    ['濱波', '滨波'],
    ['夕張', '夕张'],
    ['莫雷海擊滅', '莫雷海击灭'],
  ]) {
    assert.equal(normalizeTaskEntityText(traditional), normalizeTaskEntityText(simplified))
  }
})

test('the three spellings of a twin mount all collapse to one', () => {
  // 「聯裝／联装／連装」指同一件炮。归并方向无所谓，但三者必须停在同一形——
  // 写成「聯→联、联→连」就会一个停在「联」、一个走到「连」，反而对不上。
  const forms = ['35.6cm聯裝炮', '35.6cm联装炮', '35.6cm連装炮']
  const normalized = new Set(forms.map(normalizeTaskEntityText))
  assert.equal(normalized.size, 1, [...normalized].join(' ≠ '))
})

test('ships the localisation pack never named in Chinese still answer to their common name', () => {
  // Thonburi 在 kcwiki-localization 里 zh 仍是拉丁原名，任务 2605B2 写的却是「吞武里」
  assert.deepEqual(TASK_SHIP_TEXT_ALIASES[973], ['吞武里'])
  const entries = [{
    id: 973,
    name: 'Thonburi',
    simple: 'thonburi',
    aliases: ['thonburi', ...TASK_SHIP_TEXT_ALIASES[973]].map(normalizeTaskEntityText),
  }]
  assert.equal(markTaskEntityHits(entries, '以包含「吞武里」的舰队出击', 2).length, 1)
})

test('every quest in the real library survives cleaning and marking', { skip: !quests }, () => {
  let piped = 0
  let marked = 0
  for (const quest of quests) {
    for (const field of ['desc', 'memo2']) {
      const raw = quest[field] ?? ''
      const { text, links } = cleanQuestText(raw)
      if (text.includes('|')) piped += 1
      for (const link of links) {
        assert.ok(link.start >= 0 && link.start + link.length <= text.length, `${quest.code} 链接越界`)
      }
      const marks = mergeQuestMarks(emphasisMarks(text, links))
      let previousEnd = 0
      for (const mark of marks) {
        assert.ok(mark.start >= previousEnd, `${quest.code} 标记重叠或未排序`)
        assert.ok(mark.start + mark.length <= text.length, `${quest.code} 标记越界`)
        previousEnd = mark.start + mark.length
      }
      if (field === 'desc' && marks.length) marked += 1
    }
  }
  assert.equal(piped, 0, 'wiki 竖线必须一条不剩地折掉')
  // 六成以上的任务正文有硬条件可点；低于这个数就是规则退化了
  assert.ok(marked > quests.length * 0.6, `只有 ${marked}/${quests.length} 条正文有标记`)
})
