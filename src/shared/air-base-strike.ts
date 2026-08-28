// 基地航空队的出击派遣目标。
//
// 出击时游戏会单独发一次 api_req_map/start_air_base，告诉服务器「第 N 队打哪个点」：
//   {"api_strike_point_2":"40,40","api_strike_point_3":"40,40"}
// 每队两波，所以是逗号分隔的两个点位（也可以两波打不同点）。
//
// 关键细节：**队号在参数名的后缀里，不是数组下标**。玩家常常只派第 2、3 队出击，
// 第 1 队留着防空——那样参数里就没有 _1，按下标读会把第 2 队当成第 1 队。
//
// 只在请求参数里出现，响应体不回。

/** 从 start_air_base 的请求参数解析出 {队号: [各波目标点]}。 */
export const parseAirBaseStrikes = (post: unknown): Record<number, number[]> => {
  const strikes: Record<number, number[]> = {}
  if (!post || typeof post !== 'object') return strikes
  for (const [key, raw] of Object.entries(post as Record<string, unknown>)) {
    const matched = /^api_strike_point_(\d+)$/.exec(key)
    if (!matched) continue
    const cells = `${raw}`
      .split(',')
      .map((part) => parseInt(part, 10))
      .filter((cell) => Number.isInteger(cell) && cell > 0)
    if (cells.length) strikes[parseInt(matched[1], 10)] = cells
  }
  return strikes
}

/** 本次出击中，有多少波基地航空打向该点。没派或派往别处都是 0。 */
export const airBaseWavesAt = (
  strikes: Record<number, number[]> | null | undefined,
  cell: number,
): number => {
  if (!strikes || !(cell > 0)) return 0
  return Object.values(strikes).reduce(
    (waves, cells) => waves + cells.filter((target) => target === cell).length,
    0,
  )
}
