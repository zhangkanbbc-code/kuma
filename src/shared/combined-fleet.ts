const combinedType = (value: unknown): number | null => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 3 ? parsed : null
}

/**
 * api_req_hensei/combined 的响应 api_combined 只是启停标志：
 * 编成空母机动、水上打击、运输护卫时都实测返回 1。
 * 具体种类来自同一请求的 api_combined_type。
 */
export const combinedFleetTypeFromMutation = (
  current: number,
  responseActive: unknown,
  requestedType: unknown,
): number => {
  const active = combinedType(responseActive)
  const requested = combinedType(requestedType)

  if (active === 0 || requested === 0) return 0
  if (requested != null && requested > 0) return requested

  // 旧账本或残缺报文没有请求参数时，响应 1 只能证明“已联合”。
  // 保留先前已知类型，避免把运输护卫静默降级成空母机动。
  if (active === 1 && current >= 1 && current <= 3) return current
  return active ?? current
}
