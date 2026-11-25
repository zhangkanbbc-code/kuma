// 维护者裁决 2026-11-25：按首字母给战果评级上色，未知评级沿用正文色。
export const rankToneClass = (rank: string | null | undefined): string => {
  const initial = rank?.charAt(0).toUpperCase() ?? ''
  return /^[SABCDE]$/.test(initial) ? `rank-${initial.toLowerCase()}` : ''
}
