import assert from 'node:assert/strict'
import test from 'node:test'
import { auditQuestFleetGates, fleetGateBody } from '../scripts/lib/quest-fleet-gate-audit.mjs'
import { runFleetGateAudit } from '../scripts/quest-fleet-gate-audit.mjs'

const tracker = (groups) => ({ source: 'kuma', approx: false, fleetGoal: { groups } })

test('编成门体检三态：门低于正文可疑、相等或更高未报警、无舰数不能比较', () => {
  const quests = {
    1: { code: 'C1', desc: '编入4只以上精锐驱逐舰' },
    2: { code: 'B1', desc: '从中任选两艘', memo2: '包含三名舰娘' },
    3: { code: 'F1', desc: '废弃装备5个，S胜6次', memo: '奖励9艘' },
    4: { code: 'A1', desc: '编成２隻以上' },
  }
  const trackers = {
    1: tracker([{ label: '具名旗舰', amount: 1, ships: [1] }, { label: '驱逐', amount: 1, stypes: [2] }]),
    2: tracker([{ label: '具名组', amount: 1, ships: [1] }, { label: '任意', amount: 2, ships: 'any' }]),
    3: tracker([{ label: '秘书舰', amount: 1 }]),
    4: tracker([{ label: '其它舰', amount: 3, ships: 'other' }]),
    5: { source: 'poi', tasks: [] }, // 无编成门不纳入体检。
  }
  const before = structuredClone({ quests, trackers })
  const result = auditQuestFleetGates(quests, trackers)
  assert.deepEqual(result.summary, { total: 4, sources: { kuma: 4 }, clear: 2, noCount: 1, suspicious: 1 })
  assert.deepEqual(result.rows.map((row) => row.status), ['suspicious', 'clear', 'noCount', 'clear'])
  assert.deepEqual(result.rows.map((row) => row.maxTextShips), [4, 3, null, 2])
  assert.deepEqual(result.suspicious[0].groups, [{ label: '具名旗舰', amount: 1 }, { label: '驱逐', amount: 1 }])
  assert.deepEqual({ quests, trackers }, before, '纯函数不修改输入')
})

test('编成门体检排除嵌套括号，兼容中文数字和 desc/memo2 的最大舰数', () => {
  const quest = { code: 'B1', desc: '旗舰一艘（说明十艘(另有99隻)）', memo2: '同伴四只；总计五艘（奖励六艘）' }
  assert.equal(fleetGateBody(quest), '旗舰一艘 同伴四只;总计五艘')
  const result = auditQuestFleetGates({ 1: quest }, { 1: { ...tracker([{ label: '舰娘', amount: 4 }]), approx: true } })
  assert.equal(result.suspicious[0].maxTextShips, 5)
  assert.equal(result.suspicious[0].approx, true)
  assert.match(result.suspicious[0].excerpt, /总计五艘/)
  assert.doesNotMatch(result.suspicious[0].excerpt, /99|奖励/)
})

test('范围上限仍是机械可疑项，不用任务特判或上限冒充最低舰数来隐藏它', () => {
  const result = auditQuestFleetGates({ 1: { code: 'By14', desc: '旗舰，僚舰1～3艘海防舰' } }, {
    1: { ...tracker([{ label: '旗舰', amount: 1 }, { label: '海防舰', amount: 1 }]),
      fleetGoal: { groups: [{ label: '旗舰', amount: 1 }, { label: '海防舰', amount: 1 }], maxShips: 4, allowOnlyGoalShips: true } },
  })
  assert.equal(result.suspicious[0].requiredShips, 2)
  assert.equal(result.suspicious[0].maxTextShips, 3)
})

// 2026-09-08 体检已核清单：前十条沿用派单的逐条日文复核结论；只解释数字，不改门。
const REVIEWED = {
  A85: '4 是第二一驱逐队 3～4 艘范围的上限，具名舰下限为 3。',
  B9: '六艘指补充说明中的全队规模，不能把它当成指定舰组的数量。',
  B32: '3/4 只出现在禁止编成与航向偏离说明中，不是最低要求。',
  B117: '6 是含自由位的全队规模，具名旗舰与甲型驱逐僚舰共要求 3 艘。',
  By2: '5 是全队上限，最低要求为 3 艘海防舰。',
  B147: '4 只是自由舰数量，指定美军舰娘要求 2 艘。',
  B154: '4 只是自由位数量，指定赤城与加贺各 1 艘。',
  B155: '5 是全队上限，具名门只要求羽黑旗舰 1 艘。',
  B184: '四艘是任意舰数量，第十五驱逐队改二指定组只要求 2 艘。',
  B185: '四艘是任意舰数量，指定美驱组只要求 2 艘。',
  // By14 修后最低 2 艘仍小于正文范围上限 3；按原判据必须保留这条误报。
  By14: '3 是僚舰 1～3 艘范围的上限；鹈来型旗舰加至少 1 艘海防僚舰，全队最多 4 艘。',
}

test('真实全库编成门可疑清单必须精确等于已核清单，新增或消失均要求复核', async () => {
  const result = await runFleetGateAudit()
  // 2026-09-11 定号表补入 2609Cw1、By17、By18 的编成门，三条均由 kuma 提供。
  // 2026-09-15 B217/F143 新增两道编成门，均由逐项复核后的 kuma 规则提供。
  // 2026-09-17 B138 / Bq13 的同任务不同编成 or 由 kcwiki 层接住，不再整条丢门。
  assert.equal(result.summary.total, 401)
  assert.deepEqual(result.summary.sources, { kcwiki: 261, kuma: 140 })
  assert.deepEqual(result.suspicious.map((row) => row.code).sort(), Object.keys(REVIEWED).sort())
  for (const code of ['C57', 'B194', 'B204', 'F138']) {
    assert.equal(result.rows.find((row) => row.code === code)?.status, 'clear', code)
  }
  assert.equal(result.rows.find((row) => row.code === 'By14')?.requiredShips, 2)
})
