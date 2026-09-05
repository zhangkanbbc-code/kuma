export interface AirBaseTabSquad {
  actionKind: number
  planes: ReadonlyArray<{
    slotId: number
    count: number
    maxCount: number
    cond: number
  }>
}

/**
 * 基地航空队页签的提醒级别。
 *
 * 2026-08-11 的「陆航挂牌常驻横幅」裁决已被 09-05 取代：陆航状态改在自己的
 * 页签上着色，舰队就绪横幅只说舰队与札，避免同一件事跨两个区域重复提示。
 *
 * 被打空会损失已经配置的飞机，不管中队此刻是出击、待机还是休息都必须报红；
 * 普通未就绪只影响真会投入战斗的出击/防空中队，待机等状态不报黄。
 */
export const airBaseTabGlow = (
  squads: ReadonlyArray<AirBaseTabSquad>,
): 'bad' | 'warn' | null => {
  const wiped = squads.some((squad) =>
    squad.planes.some((plane) => plane.slotId > 0 && plane.maxCount > 0 && plane.count === 0),
  )
  if (wiped) return 'bad'

  const unready = squads.some(
    (squad) =>
      (squad.actionKind === 1 || squad.actionKind === 2) &&
      squad.planes.some((plane) => plane.count < plane.maxCount || plane.cond >= 2),
  )
  return unready ? 'warn' : null
}
