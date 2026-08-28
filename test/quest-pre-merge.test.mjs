import assert from 'node:assert/strict'
import test from 'node:test'

import { mergeQuestPre } from '../src/shared/quest-pre-merge.ts'
import { QUEST_PRE_ARBITRATION } from '../src/shared/quest-pre-arbitration.ts'

const KNOWN = new Set(['A1', 'A2', 'B1', 'F4', 'F44', 'F76'])
const ww = (over) => ({ code: 'X1', nameJp: 'x', pre: [], ...over })

test('双方一致或只有 kcwiki 时：按 kcwiki，不标冲突', () => {
  const same = mergeQuestPre(['A1', 'A2'], ww({ pre: ['A2', 'A1'] }), KNOWN)
  assert.deepEqual(same.pre, ['A1', 'A2'])
  assert.equal(same.source, 'kcwiki')
  assert.equal(same.conflict, false)
  const solo = mergeQuestPre(['A1'], undefined, KNOWN)
  assert.deepEqual(solo.pre, ['A1'])
  assert.equal(solo.wwPre, null)
})

test('补缺：kcwiki 没写前置而 wikiwiki 有明确前置的才补', () => {
  const filled = mergeQuestPre([], ww({ pre: ['B1'] }), KNOWN)
  assert.deepEqual(filled.pre, ['B1'])
  assert.equal(filled.source, 'wikiwiki')
  // wiki 自标「検証中」的不作判据——wiki 都没把握的不能当前置
  const uncertain = mergeQuestPre([], ww({ pre: ['B1'], uncertain: true }), KNOWN)
  assert.deepEqual(uncertain.pre, [])
  assert.equal(uncertain.source, 'kcwiki')
  // 公证失败（code 空间错位）的整条不用
  const misaligned = mergeQuestPre([], ww({ pre: ['B1'], aligned: false }), KNOWN)
  assert.deepEqual(misaligned.pre, [])
  assert.equal(misaligned.wwPre, null)
})

test('修悬空：kcwiki 指向库外码时，wikiwiki 给得出现行链就换用', () => {
  // F48 实锤形状：scn 写 C2+F44（C2 是改号前的旧码），ww 给 F4+F44
  const fixed = mergeQuestPre(['C2', 'F44'], ww({ pre: ['F4', 'F44'] }), KNOWN)
  assert.deepEqual(fixed.pre, ['F4', 'F44'])
  assert.equal(fixed.source, 'merged')
  assert.deepEqual(fixed.dangling, ['C2'])
  assert.equal(fixed.conflict, false, '悬空修补不算口径冲突')
  // ww 给不出（没收/空）：原样保留悬空码，判定端会退「未同步」
  const stuck = mergeQuestPre(['2409B1', 'F76'], ww({ pre: [] }), KNOWN)
  assert.deepEqual(stuck.pre, ['2409B1', 'F76'])
  assert.deepEqual(stuck.dangling, ['2409B1'])
})

test('冲突：双方都有前置但集合不等 → 判定按 kcwiki，冲突原样带出', () => {
  const conflicted = mergeQuestPre(['A1'], ww({ pre: ['A2'], uncertain: true }), KNOWN)
  assert.deepEqual(conflicted.pre, ['A1'])
  assert.equal(conflicted.conflict, true)
  assert.equal(conflicted.wwUncertain, true)
  assert.deepEqual(conflicted.wwPre, ['A2'])
})

test('wikiwiki 前置里的库外码不带进判定，但口径展示保留原样', () => {
  const filled = mergeQuestPre([], ww({ pre: ['B1', 'C99'] }), KNOWN)
  assert.deepEqual(filled.pre, ['B1'], '库外码 C99 不进判定链')
  assert.deepEqual(filled.wwPre, ['B1', 'C99'], '展示口径保持 wikiwiki 原样')
})

test('三源仲裁优先于一切合并规则，限时码保留给判定端退未同步', () => {
  // F91 形状：scn 漏 C46，ww 有，KC3Kai 肯定 → 裁 ww 口径
  const won = mergeQuestPre(['A1'], ww({ pre: ['A1', 'A2'] }), KNOWN, {
    pre: ['A1', 'A2'],
    basis: 'wikiwiki 与 KC3Kai 一致',
  })
  assert.deepEqual(won.pre, ['A1', 'A2'])
  assert.equal(won.source, 'arbitrated')
  assert.equal(won.basis, 'wikiwiki 与 KC3Kai 一致')
  assert.equal(won.conflict, true, '两 wiki 的分歧事实仍如实带出')
  // B204 形状：裁决保留已下线的限时码（不在库内）——判定端会给「未同步」，
  // 不能拿 wikiwiki 的替代链冒充可判
  const seasonal = mergeQuestPre(['2409B1'], ww({ pre: ['B1'], uncertain: true }), KNOWN, {
    pre: ['2409B1'],
    basis: 'kcwiki 与 KC3Kai 一致：前置是限时任务',
  })
  assert.deepEqual(seasonal.pre, ['2409B1'], '限时码保留，不被 wikiwiki 替换')
  assert.deepEqual(seasonal.dangling, ['2409B1'])
  assert.equal(seasonal.source, 'arbitrated')
  // 不传仲裁时行为不变（悬空修补继续走 wikiwiki）
  const plain = mergeQuestPre(['2409B1'], ww({ pre: ['B1'] }), KNOWN)
  assert.deepEqual(plain.pre, ['B1'])
  assert.equal(plain.source, 'merged')
})

test('仲裁表自身健康：码型合法、裁决都带依据、与已知冲突清单对得上号', () => {
  assert.equal(QUEST_PRE_ARBITRATION.size, 8, '2026-08-17 裁了 8 条；增删要有新证据')
  for (const [code, entry] of QUEST_PRE_ARBITRATION) {
    assert.match(code, /^[A-Z]{1,2}[a-z]?\d+$/, `${code} 码型`)
    assert.ok(entry.pre.length >= 1, `${code} 裁决不能是空前置`)
    for (const pre of entry.pre) assert.match(pre, /^(?:[A-Z]{1,2}[a-z]?|\d{4}[A-Z][a-z]?)\d+$/, `${code} 前置 ${pre} 码型`)
    assert.ok(entry.basis.length >= 10, `${code} 依据要说人话`)
    assert.ok(!entry.pre.includes(code), `${code} 不能自己当自己的前置`)
  }
  // 三条限时裁决保留的是限时码本体
  assert.deepEqual(QUEST_PRE_ARBITRATION.get('B204')?.pre, ['2409B1'])
  assert.ok(QUEST_PRE_ARBITRATION.get('F128')?.pre.includes('2409B1'))
  assert.ok(QUEST_PRE_ARBITRATION.get('F135')?.pre.includes('2508B1'))
})
