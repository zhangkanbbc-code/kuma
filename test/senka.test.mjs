// 战果换算与月界的真测试（2026-08-17 体检补：核心纯算模块原先零测试覆盖）。
// EO 分值表对 wikiwiki「称号・戦果」特別戦果一覧逐行核对后钉死。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { buildSync } from 'esbuild'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-senka-'))
const output = path.join(tempDir, 'senka.cjs')
buildSync({
  entryPoints: [fileURLToPath(new URL('../src/shared/senka.ts', import.meta.url))],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'silent',
})
const require = createRequire(import.meta.url)
const {
  CARRY_EXP_DIVISOR,
  CARRY_SPECIAL_DIVISOR,
  EO_SENKA,
  capSenkaEntries,
  eoMonthResetTs,
  firstEoClearObservations,
  questFixedSenka,
  senkaCarryWindows,
  senkaFromExp,
  senkaMonthEnd,
  senkaMonthStart,
} = require(output)

const JST = 9 * 3600 * 1000
const jstUtc = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) - JST

test('EO 分值与 wikiwiki 特別戦果一覧逐行一致（2026-08-17 核对）', () => {
  assert.deepEqual(EO_SENKA, {
    15: 75,
    16: 75,
    25: 100,
    35: 150,
    45: 180,
    55: 200,
    56: 225,
    65: 250,
    75: 170, // 曾误写 300；两段血条但表上整图一笔
  })
})

test('战果月边界：前月末 22:00 JST 起算，月末最后两小时归下月', () => {
  // 8 月中旬 → 7 月 31 日 22:00 JST
  assert.equal(senkaMonthStart(jstUtc(2026, 8, 17, 12)), jstUtc(2026, 7, 31, 22))
  // 8 月 31 日 21:59 仍是 8 月战果月
  assert.equal(senkaMonthStart(jstUtc(2026, 8, 31, 21, 59)), jstUtc(2026, 7, 31, 22))
  // 8 月 31 日 22:00 整，进 9 月战果月
  assert.equal(senkaMonthStart(jstUtc(2026, 8, 31, 22, 0)), jstUtc(2026, 8, 31, 22))
  // 跨年：1 月中旬 → 去年 12 月 31 日 22:00
  assert.equal(senkaMonthStart(jstUtc(2027, 1, 10, 8)), jstUtc(2026, 12, 31, 22))
  // 2 月（短月）中旬 → 1 月 31 日 22:00；2 月末 22:00 后进 3 月
  assert.equal(senkaMonthStart(jstUtc(2026, 2, 14, 0)), jstUtc(2026, 1, 31, 22))
  assert.equal(senkaMonthStart(jstUtc(2026, 2, 28, 22, 30)), jstUtc(2026, 2, 28, 22))
})

test('战果月终点 = 下一个月界（查历史月的上界）', () => {
  assert.equal(senkaMonthEnd(jstUtc(2026, 8, 17, 12)), jstUtc(2026, 8, 31, 22))
  // 边界自反：终点时刻本身已属于下一个月
  const end = senkaMonthEnd(jstUtc(2026, 8, 17, 12))
  assert.equal(senkaMonthStart(end), end)
})

test('通常战果换算：×7/10000，非正增量为 0', () => {
  assert.equal(senkaFromExp(10000), 7)
  assert.equal(senkaFromExp(0), 0)
  assert.equal(senkaFromExp(-500), 0)
})

test('继承窗口：经验按前月所在年的 1/1 起算，1 月作战窗口是去年整年', () => {
  assert.equal(CARRY_EXP_DIVISOR, 50000)
  assert.equal(CARRY_SPECIAL_DIVISOR, 35)
  // 8 月作战：经验窗口 [2026-01-01 00:00 JST, 7/31 22:00)，前月窗口 [6/30 22:00, 7/31 22:00)
  const aug = senkaCarryWindows(jstUtc(2026, 8, 17, 12))
  assert.equal(aug.yearStart, jstUtc(2026, 1, 1, 0))
  assert.equal(aug.prevMonthStart, jstUtc(2026, 6, 30, 22))
  assert.equal(aug.monthStart, jstUtc(2026, 7, 31, 22))
  // 1 月作战（1 月 10 日）：前月 = 去年 12 月 → 经验窗口从**去年** 1/1 起
  const jan = senkaCarryWindows(jstUtc(2027, 1, 10, 8))
  assert.equal(jan.yearStart, jstUtc(2026, 1, 1, 0))
  assert.equal(jan.prevMonthStart, jstUtc(2026, 11, 30, 22))
  assert.equal(jan.monthStart, jstUtc(2026, 12, 31, 22))
  // 12 月末 22:00 后（已进 1 月作战）同样落到去年窗口
  const janEdge = senkaCarryWindows(jstUtc(2026, 12, 31, 22, 30))
  assert.equal(janEdge.yearStart, jstUtc(2026, 1, 1, 0))
})

test('任务固定战果解析：三种写法都收，选择奖励不替玩家做主', () => {
  assert.equal(questFixedSenka('奖励:80战果 高速修复材×2'), 80)
  assert.equal(questFixedSenka('奖励:战果×350'), 350)
  assert.equal(questFixedSenka('奖励:战果+200'), 200)
  // 「以下奖励」之后的战果是选择项，不自动记
  assert.equal(questFixedSenka('奖励:高速修复材×2 以下奖励二选一： 战果800 FR-1'), null)
  // 「奖励:」之前的杂谈不算
  assert.equal(questFixedSenka('完成后战果排名上升。奖励:高速建造材×3'), null)
  assert.equal(questFixedSenka(''), null)
  assert.equal(questFixedSenka(null), null)
})

test('明细截断只砍经验行：EO/任务行是「记没记过」的判据，一条不丢', () => {
  // 2026-08-17 实锤：317 行月账把 8/9 的 EO 顶出 slice(0,300)，
  // 自检拿截断表误报漏记，点补记又被账本去重驳回——按钮看起来「没用」
  const entry = (ts, kind, note = '') => ({ ts, kind, expDelta: 0, senka: 1, note })
  const eo = entry(1000, 'eo', '15')
  const quest = entry(2000, 'quest', '893')
  const exps = Array.from({ length: 400 }, (_, i) => entry(10_000 + i, 'exp'))
  const capped = capSenkaEntries([eo, quest, ...exps], 300)
  assert.equal(capped.length, 300)
  assert.ok(capped.some((e) => e.kind === 'eo' && e.note === '15'), 'EO 行必须保留')
  assert.ok(capped.some((e) => e.kind === 'quest'), '任务行必须保留')
  assert.equal(capped.filter((e) => e.kind === 'exp').length, 298, '砍的全是经验行')
  // 时间倒序，且保留的是最新的经验行
  assert.equal(capped[0].ts, 10_399)
  for (let i = 1; i < capped.length; i++) assert.ok(capped[i].ts <= capped[i - 1].ts)
  // 不超限时原样返回
  const small = [eo, quest]
  assert.equal(capSenkaEntries(small, 300), small)
})

test('EO 月重置点：战果月起点 +7h = 当月 1 日 05:00 JST', () => {
  const augStart = senkaMonthStart(jstUtc(2026, 8, 17, 12))
  assert.equal(eoMonthResetTs(augStart), jstUtc(2026, 8, 1, 5))
})

test('EO 击破观测：窗口内取首见，窗口外与非 EO 图不作数', () => {
  const reset = jstUtc(2026, 8, 1, 5)
  const end = senkaMonthEnd(jstUtc(2026, 8, 17, 12))
  const first = firstEoClearObservations(
    [
      { ts: reset - 1000, cleared: [15] }, // 重置点前的旧状态：不作数
      { ts: reset + 1000, cleared: [25, 11] }, // 11 不是 EO 图
      { ts: reset + 2000, cleared: [25, 35] },
      { ts: end + 1000, cleared: [45] }, // 月界之后：下月的事
    ],
    reset,
    end,
  )
  assert.equal(first.get(25), reset + 1000, '取首见观测')
  assert.equal(first.get(35), reset + 2000)
  assert.equal(first.has(15), false)
  assert.equal(first.has(11), false)
  assert.equal(first.has(45), false)
})
