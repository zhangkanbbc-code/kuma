// 任务正文校正台账的护栏（2026-08-27 用户裁决）。
//
// 病灶：`quests-scn` 的 memo2 把日文的**件数/艘数**量词一律译成了「N次」。
// 玩家照「废弃装备五次」会去点五轮废弃，而 635 一次勾五件就达成——这是在
// 告诉玩家一件做不到的事，不是措辞难看。
//
// 包不能手改（每次 lodes:fetch 整包重出，且内容是 CC BY-NC-SA 的 kcwiki 原文，
// 按仓里那条许可纪律不往上游包里塞自己的裁决），所以走加载期台账覆盖。
//
// 这份护栏钉四件事：
//   ① 三条校正的**最终呈现**（635 必须是「废弃5件装备」）；
//   ② 按回的那一族**一个字没被顺手改**（写「次」本来就是对的）；
//   ③ 台账的 `from` 与现行包**逐条对得上**——上游改了那句话要当场红，
//      而不是安静退化成空操作（自失效机制最容易烂在这里）；
//   ④ 分类判据仍然成立：改过的按件条目在 kcwiki 记 batch:true，
//      没改的按回条目记 batch:false。上游哪天重新分类，这条会先叫起来。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import corrections from '../dist/shared/quest-text-corrections.js'

const {
  QUEST_TEXT_CORRECTIONS,
  applyQuestTextCorrections,
  applyQuestTextCorrectionsToPack,
} = corrections

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const readLode = (id) => {
  const file = path.join(root, 'assets', 'lodes', `${id}.json`)
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
}

/** 用户拍板的定稿，照抄。改这三行等于改玩家看到的字，别顺手动。 */
const FINAL = {
  635: '废弃5件装备',
  609: '解体2艘舰船',
  603: '解体1艘舰船',
}

/** 按操作回数计的那一族：正文写「次」本来就是对的，一个都不许被改。 */
const BY_ROUND = ['604', '610', '611', '612', '613', '617']

test('三条校正的最终呈现就是用户定稿的那几个字', () => {
  const pack = readLode('quests-scn')
  if (!pack) return // 裸环境无包：跳过，全量对账由 test:lodes 兜底
  const fixed = applyQuestTextCorrectionsToPack(pack)
  for (const [id, want] of Object.entries(FINAL)) {
    assert.equal(fixed.data[id].memo2, want, `${id} 的 memo2 应呈现为「${want}」`)
  }
  // 主判据单独再钉一次：这一条是本单的由头
  assert.equal(fixed.data['635'].memo2, '废弃5件装备')
})

test('按回的那一族一个字没动——写「次」本来就是对的', () => {
  const pack = readLode('quests-scn')
  if (!pack) return
  const fixed = applyQuestTextCorrectionsToPack(pack)
  for (const id of BY_ROUND) {
    assert.equal(
      fixed.data[id].memo2,
      pack.data[id].memo2,
      `${id} 按操作回数计，memo2 不该被校正`,
    )
    assert.match(fixed.data[id].memo2, /次/, `${id} 的「次」是对的，不该消失`)
  }
})

test('校正只碰点名的那一个字段，别的字段与别的任务原样', () => {
  const pack = readLode('quests-scn')
  if (!pack) return
  const fixed = applyQuestTextCorrectionsToPack(pack)
  const touched = new Set(QUEST_TEXT_CORRECTIONS.map((fix) => `${fix.questId}`))
  assert.equal(Object.keys(fixed.data).length, Object.keys(pack.data).length, '条目数不该变')
  for (const [id, entry] of Object.entries(pack.data)) {
    if (!touched.has(id)) {
      assert.deepEqual(fixed.data[id], entry, `${id} 没进台账，应逐字段原样`)
      continue
    }
    for (const field of ['code', 'name', 'desc', 'memo', 'pre']) {
      assert.deepEqual(fixed.data[id][field], entry[field], `${id}.${field} 不该被顺手改`)
    }
  }
  // 包对象是 packCache 跨消费端共享的，就地改会污染缓存
  assert.notEqual(fixed.data, pack.data, '应返回新对象')
  for (const fix of QUEST_TEXT_CORRECTIONS) {
    assert.equal(pack.data[`${fix.questId}`].memo2, fix.from, '原包不该被就地改')
  }
})

test('台账的 from 与现行包逐条对得上（上游改了要当场红，不许静默失效）', () => {
  const pack = readLode('quests-scn')
  if (!pack) return
  for (const fix of QUEST_TEXT_CORRECTIONS) {
    const entry = pack.data[`${fix.questId}`]
    assert.ok(entry, `台账点名的 ${fix.questId} 在包里查不到`)
    assert.equal(
      entry[fix.field],
      fix.from,
      `${fix.questId}.${fix.field} 上游原文已变 → 这条校正现在是空操作，必须重新核对量词`,
    )
  }
  const { report } = applyQuestTextCorrections(pack.data)
  assert.deepEqual(report.skipped, [], '现行包上不该有任何一条被跳过')
  assert.equal(report.applied.length, QUEST_TEXT_CORRECTIONS.length, '三条应全部生效')
})

test('自失效：上游把那句话改了就跳过，不拿过期校正去改已经变样的句子', () => {
  const before = { 635: { memo2: '废弃装备五次' }, 609: { memo2: '上游后来改写过的句子' } }
  const { data, report } = applyQuestTextCorrections(before)
  assert.equal(data['635'].memo2, '废弃5件装备', '对得上的照改')
  assert.equal(data['609'].memo2, '上游后来改写过的句子', '对不上的原样留着')
  assert.ok(
    report.skipped.some((s) => s.questId === 609 && s.reason === 'text-changed'),
    '对不上要记一笔 text-changed',
  )
  assert.ok(
    report.skipped.some((s) => s.questId === 603 && s.reason === 'no-quest'),
    '包里没有的要记一笔 no-quest',
  )
})

test('别的包一个字不碰', () => {
  const other = { meta: { id: 'kcwiki-quest-req' }, data: { 635: { memo2: '废弃装备五次' } } }
  assert.equal(applyQuestTextCorrectionsToPack(other), other, '非 quests-scn 应原样返回')
})

test('分类判据仍然成立：改过的按件、没改的按回，与 kcwiki 的 batch 逐条对得上', () => {
  const req = readLode('kcwiki-quest-req')
  if (!req) return
  // 廃棄装備族才有 batch 字段；解体族（603/609）按艘的依据是日文量词「隻」+ 用户实测，
  // 不在这条判据里，所以只查 635。
  assert.equal(
    req.data['635'].batch,
    true,
    '635 若被上游改成 batch:false，「按件」这个前提就没了，校正要重核',
  )
  for (const id of BY_ROUND) {
    assert.equal(
      req.data[id].batch,
      false,
      `${id} 若被上游改成 batch:true，它的「次」就成了误译，要进台账`,
    )
  }
  // 同族里 batch:true 的另外三条正文本来就写对了量词，不该有人把它们也塞进台账
  for (const id of ['624', '625', '634']) {
    assert.equal(req.data[id].batch, true)
    assert.ok(
      !QUEST_TEXT_CORRECTIONS.some((fix) => `${fix.questId}` === id),
      `${id} 正文量词本来就对（「N个」/「N件」），不该进台账`,
    )
  }
})

test('两个装载口都叠了校正——只叠一边会让显示与判定悄悄分叉', async () => {
  // 源码断言只回答「调用写在那儿了吗」，所以另配一条真跑一遍的（见下）
  const lode = fs.readFileSync(path.join(root, 'src', 'main', 'lode.ts'), 'utf8')
  assert.match(lode, /applyQuestTextCorrectionsToPack/, 'src/main/lode.ts 的 readPack 应叠校正')
  const engine = fs.readFileSync(path.join(root, 'scripts', 'lib', 'quest-engine.mjs'), 'utf8')
  assert.match(engine, /applyQuestTextCorrectionsToPack/, 'quest-engine.mjs 的 loadLode 应叠校正')

  // 离线装载口真跑一遍：这一口不叠的话，自推导对账会拿校正后的文本比未校正的输入
  const { loadLode } = await import('../scripts/lib/quest-engine.mjs')
  const pack = loadLode('quests-scn')
  if (!pack) return
  assert.equal(pack.data['635'].memo2, '废弃5件装备', '离线装载口也应看到校正后的文本')
  assert.equal(pack.data['609'].memo2, '解体2艘舰船')
})

test('每条校正都写了证据，且实测与推定分得清', () => {
  assert.ok(QUEST_TEXT_CORRECTIONS.length >= 3)
  for (const fix of QUEST_TEXT_CORRECTIONS) {
    assert.ok(fix.basis && fix.basis.length > 30, `${fix.questId} 的 basis 太短，证据要写清`)
    assert.match(fix.basis, /2026-08-27/, `${fix.questId} 的 basis 应带裁定日期`)
    assert.notEqual(fix.from, fix.to, `${fix.questId} 的校正前后不该相同`)
  }
  // 609 是实测、603 是同机制推定——两者的证据等级不许被抹平成一句话
  const by = (id) => QUEST_TEXT_CORRECTIONS.find((fix) => fix.questId === id)
  assert.match(by(609).basis, /实测/, '609 是用户在游戏里点出来的')
  assert.match(by(603).basis, /推定/, '603 没有自己的一手量词证据，必须标明是推定')
})
