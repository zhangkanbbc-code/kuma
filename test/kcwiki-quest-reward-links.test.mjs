import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { parseKcwikiQuestPages } from '../scripts/lib/kcwiki-quests-scn.mjs'

// 舰娘百科「任务」及「任务/最新任务」，2026-11-24 快照各摘一条。
const page = readFileSync(new URL('./fixtures/kcwiki-quest-reward-links-20261124.txt', import.meta.url), 'utf8')

test('A1 的横幅和文字链接只给出一个白雪', () => {
  const { quests } = parseKcwikiQuestPages([page], new Map())
  assert.equal(quests[101].memo, '奖励:「白雪」')
})

test('2611B1 的两个三选一奖励各保留一个舰名', () => {
  const { quests } = parseKcwikiQuestPages([page], new Map())
  assert.deepEqual(quests[866].memo.match(/「昭南」|「明石」/g), ['「昭南」', '「明石」'])
})

const banner = '[[文件:Banner.png|link=X]]'
for (const [reward, expected] of [
  [banner, '「X」'],
  ['[[X]][[X|显示名]]', '「X」「X|显示名」'],
  [banner + '[[X|显示名]]', '「X」'],
  [banner + ' [[X]]', '「X」 「X」'],
  [banner + '[[Y|X]]', '「X」「Y|X」'],
]) {
  test(`奖励链接 ${reward} 解析为 ${expected}`, () => {
    const { quests } = parseKcwikiQuestPages([`{{任务表|编号=A1|<!--101-->|奖励=${reward}}}`], new Map())
    assert.equal(quests[101].memo, `奖励:${expected}`)
  })
}
