import type { MapGauge } from './mg-types'

const finite = (value: unknown): number | null => {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const emptyGauge = (): MapGauge => ({
  cleared: false,
  defeated: null,
  required: null,
  hpNow: null,
  hpMax: null,
  selectedRank: null,
  limitFlag: null,
  gaugeType: null,
  gaugeNum: null,
})

const sameGauge = (left: MapGauge, right: MapGauge): boolean =>
  left.cleared === right.cleared &&
  left.defeated === right.defeated &&
  left.required === right.required &&
  left.hpNow === right.hpNow &&
  left.hpMax === right.hpMax &&
  left.selectedRank === right.selectedRank &&
  left.gaugeType === right.gaugeType &&
  left.gaugeNum === right.gaugeNum

// /map/start、/map/next 与难度选择会直接给当前活动血条。
// 字段缺失时保留既有值，避免局部响应把 mapinfo 的难度/阶段冲掉。
export const patchMapGaugeFromSortiePayload = (
  current: MapGauge | null | undefined,
  body: any,
  selectedRank?: number | null,
): MapGauge | null | undefined => {
  const raw =
    body?.api_eventmap ??
    body?.api_maphp ??
    (finite(body?.api_now_maphp) != null || finite(body?.api_max_maphp) != null ? body : null)
  if (!raw || typeof raw !== 'object') return current
  const base = current ?? emptyGauge()
  const next: MapGauge = {
    ...base,
    cleared:
      typeof body?.api_cleared === 'number'
        ? body.api_cleared === 1
        : base.cleared,
    hpNow: finite(raw.api_now_maphp) ?? base.hpNow,
    hpMax: finite(raw.api_max_maphp) ?? base.hpMax,
    selectedRank:
      finite(selectedRank) ??
      finite(raw.api_selected_rank) ??
      base.selectedRank,
    gaugeType:
      finite(body?.api_gauge_type) ??
      finite(raw.api_gauge_type) ??
      base.gaugeType ??
      null,
    gaugeNum:
      finite(raw.api_gauge_num) ??
      finite(body?.api_gauge_num) ??
      base.gaugeNum,
  }
  return current && sameGauge(current, next) ? current : next
}

export interface BattleGaugeResult {
  isBoss: boolean
  firstClear: boolean
  enemyFlagshipSunk: boolean | undefined
  flagshipHpStart: number | null
  flagshipHpEnd: number | null
  landingHp?: {
    api_now_hp?: unknown
    api_max_hp?: unknown
    api_sub_value?: unknown
  } | null
}

// 结算后游戏不再下发完整 mapinfo：
// - 运输条使用 api_landing_hp 的权威前值/扣除值；
// - HP 条使用本场已经由战斗解析器对齐的敌主力旗舰 HP 差；
// - 击破计数只认 Boss 旗舰 api_destsf。
export const patchMapGaugeFromBattleResult = (
  current: MapGauge | null | undefined,
  result: BattleGaugeResult,
): MapGauge | null | undefined => {
  const landingNow = finite(result.landingHp?.api_now_hp)
  const landingMax = finite(result.landingHp?.api_max_hp)
  const landingSub = finite(result.landingHp?.api_sub_value)
  if (!current && landingNow == null && !result.firstClear) return current

  const base = current ?? emptyGauge()
  const next: MapGauge = { ...base }
  let changed = false

  if (landingNow != null) {
    const deducted = Math.max(0, Math.min(landingNow, landingSub ?? 0))
    next.hpNow = Math.max(0, landingNow - deducted)
    if (landingMax != null) next.hpMax = Math.max(0, landingMax)
    next.gaugeType = 3
    changed =
      next.hpNow !== base.hpNow ||
      next.hpMax !== base.hpMax ||
      next.gaugeType !== base.gaugeType
  } else if (result.isBoss && base.gaugeType !== 3 && base.hpNow != null) {
    const start = result.flagshipHpStart
    const end = result.flagshipHpEnd
    if (start != null && end != null) {
      const damage = Math.max(0, Math.min(start, start - end))
      if (damage > 0) {
        const rawRemaining = base.hpNow - damage
        // 活动最终斩杀要求 Boss 旗舰真正被击沉；只把血条打空但未击沉时保留 1。
        next.hpNow =
          rawRemaining > 0
            ? rawRemaining
            : result.enemyFlagshipSunk === true
              ? 0
              : 1
        if (base.gaugeType == null) next.gaugeType = 2
        changed = next.hpNow !== base.hpNow || next.gaugeType !== base.gaugeType
      }
    }
  }

  if (
    result.isBoss &&
    result.enemyFlagshipSunk === true &&
    base.required != null &&
    base.required > 0
  ) {
    next.defeated = Math.min(base.required, Math.max(0, (base.defeated ?? 0) + 1))
    changed ||= next.defeated !== base.defeated
  }

  if (result.firstClear) {
    next.cleared = true
    if (next.hpNow != null) next.hpNow = 0
    changed = true
  }

  return changed ? next : current
}
