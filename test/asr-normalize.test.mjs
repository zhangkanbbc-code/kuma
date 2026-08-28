// ASR 归一 / 相似度 / 专名纠偏的护栏。
//
// 这一层的错**不报错**：判断写反了只会让对账报告的相似度整体偏移，
// 于是可疑条目排不到前面，人去耳测时先听到的全是好条目——症状不像 bug。
// 所以这里的用例大半是拿 2026-08-23 那次单条实测的**真实字串**钉的。
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  AUDIT_GRADES,
  correctProperNouns,
  foldForCompare,
  gradeOf,
  levenshtein,
  similarityOf,
} from '../scripts/lib/asr-normalize.mjs'

// 实测那一条：秋津洲 1 号槽
const CLAIMED = '水上機母艦、秋津洲よ！ この大艇ちゃんと一緒に覚えてよね！'
const ASR_BIASED = '水上機母艦秋津洲よ。この大艇ちゃんと一緒に覚えてよね。'
const ASR_UNBIASED_QWEN = '水上規模感、秋篠よ。この大抵ちゃんと一緒に覚えてよね。'
const ASR_UNBIASED_FUN = '水上規模感。明津島よこの大帝ちゃんと一緒に覚えてよね。'

test('foldForCompare 删标点空白、片假名折平假名、全角折半角', () => {
  assert.equal(foldForCompare('ア！　イ'), 'あい')
  assert.equal(foldForCompare('ＡＢＣ'), 'abc')
  assert.equal(foldForCompare('よ！ こ'), 'よこ')
  // 長音符是标点表里的，删掉；否则长音写法差异（「スーパー」/「スパー」）会算进分歧。
  // 浊点**不动**：パ→ぱ 是同一个音，は 是另一个音，折掉它等于抹掉真实分歧
  assert.equal(foldForCompare('スーパー'), 'すぱ')
})

test('foldForCompare 幂等：折过的再折一遍不变', () => {
  for (const sample of [CLAIMED, ASR_BIASED, ASR_UNBIASED_QWEN, 'ＡＢ　カナ…']) {
    const once = foldForCompare(sample)
    assert.equal(foldForCompare(once), once, `不是不动点: ${sample}`)
  }
})

test('foldForCompare 对空值不炸', () => {
  assert.equal(foldForCompare(null), '')
  assert.equal(foldForCompare(undefined), '')
  assert.equal(foldForCompare(''), '')
})

test('levenshtein 基本性质', () => {
  assert.equal(levenshtein('', ''), 0)
  assert.equal(levenshtein('abc', 'abc'), 0)
  assert.equal(levenshtein('abc', ''), 3)
  assert.equal(levenshtein('', 'abc'), 3)
  assert.equal(levenshtein('kitten', 'sitting'), 3)
  // 对称
  assert.equal(levenshtein('秋津洲', '秋篠'), levenshtein('秋篠', '秋津洲'))
})

test('相似度：只差标点的两句算高度一致', () => {
  // 这是**体例差异**不是转写错误。标点若算进分歧，这一条会被误判成可疑
  const score = similarityOf(ASR_BIASED, CLAIMED)
  assert.ok(score >= 0.99, `偏置后应几乎满分，实得 ${score}`)
  assert.equal(gradeOf(score), 'match')
})

test('相似度：同音异字的专名错误必须被压到可疑档', () => {
  // 秋津洲→秋篠 / 大艇→大抵：读音全中、字全错。这正是最该让人去听的一类，
  // 分数**必须**低到能排到前面去
  const score = similarityOf(ASR_UNBIASED_QWEN, CLAIMED)
  assert.ok(score < 0.9, `同音异字不该判成一致，实得 ${score}`)
  assert.ok(['minor', 'suspect', 'conflict'].includes(gradeOf(score)))
  // 偏置后一定比不偏置好
  assert.ok(similarityOf(ASR_BIASED, CLAIMED) > score)
})

test('相似度：两边都空算一致，一边空算零', () => {
  assert.equal(similarityOf('', ''), 1)
  assert.equal(similarityOf(null, undefined), 1)
  assert.equal(similarityOf('あ', ''), 0)
  assert.equal(similarityOf('', 'あ'), 0)
})

test('相似度落在 0..1 且自反', () => {
  for (const s of [CLAIMED, ASR_UNBIASED_FUN, 'Feu！Feu！']) {
    const self = similarityOf(s, s)
    assert.equal(self, 1, `自反应为 1: ${s}`)
    const cross = similarityOf(s, CLAIMED)
    assert.ok(cross >= 0 && cross <= 1, `越界: ${cross}`)
  }
})

test('gradeOf 阈值分档，且只产出表里的级别', () => {
  assert.equal(gradeOf(1), 'match')
  assert.equal(gradeOf(0.9), 'match')
  assert.equal(gradeOf(0.899), 'minor')
  assert.equal(gradeOf(0.75), 'minor')
  assert.equal(gradeOf(0.749), 'suspect')
  assert.equal(gradeOf(0.5), 'suspect')
  assert.equal(gradeOf(0.499), 'conflict')
  assert.equal(gradeOf(0), 'conflict')
  // 坏输入不能悄悄变成好级别
  assert.equal(gradeOf(NaN), 'conflict')
  assert.equal(gradeOf(null), 'conflict')
  assert.equal(gradeOf('0.95'), 'conflict')
  for (const v of [1, 0.8, 0.6, 0.1]) assert.ok(AUDIT_GRADES.includes(gradeOf(v)))
})

test('纠偏：已经正确的专名不动', () => {
  const out = correctProperNouns(ASR_BIASED, ['秋津洲', '水上機母艦'])
  assert.equal(out.text, ASR_BIASED)
  assert.deepEqual(out.fixes, [])
  assert.deepEqual(out.unfixed, [])
})

test('纠偏：差一个字的近失捞得回来', () => {
  const out = correctProperNouns('水上機母艦、秋津州よ', ['秋津洲'])
  assert.equal(out.text, '水上機母艦、秋津洲よ')
  assert.equal(out.fixes.length, 1)
  assert.equal(out.fixes[0].term, '秋津洲')
  assert.equal(out.fixes[0].was, '秋津州')
})

test('纠偏：差太远的纠不动，如实标 unfixed 而不是硬改', () => {
  // 「秋篠」与「秋津洲」相似度 0.33，低于阈值——宁可不改，交给人耳
  const out = correctProperNouns(ASR_UNBIASED_QWEN, ['秋津洲'])
  assert.ok(out.unfixed.includes('秋津洲'), '纠不动就该进 unfixed')
  assert.deepEqual(out.fixes, [])
  assert.equal(out.text, ASR_UNBIASED_QWEN, '纠不动时原样留着')
})

test('纠偏：短词不纠（两字词改一个字等于换一个词）', () => {
  const out = correctProperNouns('大抵ちゃん', ['大艇'])
  assert.equal(out.text, '大抵ちゃん', '两字专名不该被硬改')
  assert.deepEqual(out.fixes, [])
})

test('纠偏：长词优先，短词不把长词切碎', () => {
  // 「那珂」是「那珂改二」的前缀。先纠短词会在长词中间插一段
  const out = correctProperNouns('那珂海二だよ', ['那珂', '那珂改二'])
  assert.ok(out.text.includes('那珂改二'), `长词该被整体纠回，实得 ${out.text}`)
})

test('纠偏：空词表/空文本不炸', () => {
  assert.equal(correctProperNouns('あいうえお', []).text, 'あいうえお')
  assert.equal(correctProperNouns('', ['秋津洲']).text, '')
  assert.equal(correctProperNouns(null, null).text, '')
})

test('纠偏词表去重且不因顺序改变结果', () => {
  const a = correctProperNouns('秋津州よ', ['秋津洲', '秋津洲', '提督'])
  const b = correctProperNouns('秋津州よ', ['提督', '秋津洲'])
  assert.equal(a.text, b.text)
})
