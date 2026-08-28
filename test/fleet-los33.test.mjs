import assert from 'node:assert/strict'
import test from 'node:test'

import { los33Of, los33ImprovementBonus } from '../src/shared/fleet-los33.ts'

// 33 式数学核（从 renderer/fleet-calc 抽出，主进程出击样本共用）。
// 手算样例钉死：total = Σ√裸装 + Σ(装备×系数)×係数 - ceil(提督Lv×0.4) + 2×空格

test('单舰水侦样例：裸装开根、改修加成、提督扣减、空格补偿全对', () => {
  // 面板 21 - 水侦5 = 裸装16 → √16 = 4
  // 水侦★4：加成 1.2×√4=2.4 → (5+2.4)×1.2 = 8.88
  // 提督 Lv120 → ceil(48)=48；6 格空 5 → +10
  const out = los33Of(
    [{ panelLos: 21, items: [{ saku: 5, type2: 10, level: 4 }] }],
    120,
  )
  assert.equal(out.ship, 4)
  assert.equal(out.item, 8.88)
  assert.equal(out.teitoku, 48)
  assert.equal(out.total, -25.12) // 4 + 8.88 - 48 + 10（出口统一保留两位）
})

test('系数分档与係数/游击格数：电探 0.6+1.25√★、艦攻 0.8、默认 0.6', () => {
  // 小型电探 saku8★9：(8+1.25×3)×0.6=7.05；艦攻 saku3：2.4；其他 saku2：1.2
  // 係数×2 只乘装备项；游击 7 格 3 舰 → 空 4 → +8
  const out = los33Of(
    [
      { panelLos: 8, items: [{ saku: 8, type2: 12, level: 9 }] }, // 裸装 0
      { panelLos: 3, items: [{ saku: 3, type2: 8, level: 10 }] }, // 艦攻无改修加成
      { panelLos: 6, items: [{ saku: 2, type2: 1, level: 5 }] }, // 默认档同样无加成
    ],
    1, // 提督 Lv1 → ceil(0.4)=1
    2,
    7,
  )
  assert.equal(out.item, 21.3) // (7.05 + 2.4 + 1.2) × 2，出口保留两位
  assert.equal(out.ship, 2) // √0 + √0 + √4
  assert.equal(out.total, 30.3) // 2 + 21.3 - 1 + 8
})

test('改修系数表：只有水侦/水爆/电探有加成', () => {
  assert.equal(los33ImprovementBonus(10, 4), 1.2 * 2)
  assert.equal(los33ImprovementBonus(13, 4), 1.4 * 2)
  assert.equal(los33ImprovementBonus(8, 9), 0, '艦攻没有改修索敌加成')
  assert.equal(los33ImprovementBonus(10, -3), 0, '负改修按 0')
})
