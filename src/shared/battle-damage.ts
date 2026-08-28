// 一场战斗里某艘舰「挨了多少」的两个口径。
// 记账端（人生记录）要用，将来复盘侧要用也是同一份，不在两处各算一套。
//
// 两个坑都在于「结算后的 HP 不等于最惨时的 HP」：
// - 女神／要员是在 HP 归零那一刻发动的，发动后 hpEnd 被拉了回去；
// - 演习的「击破」停在 HP1，不是沉没，但确实是大破。

export interface BattleDamageShip {
  hpStart: number
  hpEnd: number
  hpMax: number
  repairItemUsed: number | null // 42 要员 / 43 女神
}

/**
 * 这一战掉了多少 HP。
 *
 * 女神／要员发动过就不能拿 hpStart-hpEnd 去减——那会算出「几乎没掉血」甚至负数。
 * 发动的前提是被打到 0，掉的就是开战时的全部 HP。
 */
export const damageTakenIn = (ship: BattleDamageShip): number =>
  ship.repairItemUsed != null ? Math.max(0, ship.hpStart) : Math.max(0, ship.hpStart - ship.hpEnd)

/**
 * 这一战有没有被打进大破。
 *
 * 收尾时 HP ≤ 25% 即算；女神／要员发动过的同样算——它们发动的前提就是先跌破了大破线，
 * 而它们恰好会把 hpEnd 拉回安全线以上，只看结算值就会漏掉这一次。
 */
export const taihaIn = (ship: BattleDamageShip): boolean =>
  ship.repairItemUsed != null || (ship.hpMax > 0 && ship.hpEnd / ship.hpMax <= 0.25)

// ---- 破损档用词 ----
//
// 陆上型敌人（主数据速力 0，与反陆上特效判定同一口径）不会「沉」，破损档
// 另有一套词。来源：EO andanteyk/ElectronicObserver `Data/Constants.cs`
// GetDamageState（实证 2026-08-10）——舰船 小破/中破/大破/撃沈 ⇔
// 陆上型 混乱/損害/損壊/破壊。中文界面取简体字形；「破壊」在状态签里
// 与「沉」同位，取单字「毁」。

export type DamageTier = 'light' | 'medium' | 'heavy'

/** 阈值与 damageState/taihaIn 同一套：≤25% heavy、≤50% medium、≤75% light。 */
export const damageTierOf = (hp: number, hpMax: number): DamageTier | null => {
  const r = hp / (hpMax || 1)
  if (r <= 0.25) return 'heavy'
  if (r <= 0.5) return 'medium'
  if (r <= 0.75) return 'light'
  return null
}

export const DAMAGE_TIER_WORDS: Record<
  'ship' | 'landBase',
  Record<DamageTier | 'lost', string>
> = {
  ship: { light: '小破', medium: '中破', heavy: '大破', lost: '沉' },
  landBase: { light: '混乱', medium: '损害', heavy: '损坏', lost: '毁' },
}
