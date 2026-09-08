export const AIR_BASE_MUTE_KEY = 'ru.airBase.muted'

export const isAirBaseAreaMuted = (muted: readonly number[], areaId: number): boolean =>
  muted.includes(areaId)

export const toggleAirBaseAreaMute = (muted: readonly number[], areaId: number): number[] =>
  [...new Set(isAirBaseAreaMuted(muted, areaId)
    ? muted.filter((id) => id !== areaId)
    : [...muted, areaId])].sort((a, b) => a - b)

export const unmutedAirBaseSquads = <T extends { areaId: number }>(
  squads: readonly T[],
  muted: readonly number[],
): T[] => squads.filter((squad) => !isAirBaseAreaMuted(muted, squad.areaId))
