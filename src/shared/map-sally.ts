export interface MapFleetAllowance {
  normal: boolean
  carrierTaskForce: boolean
  surfaceTaskForce: boolean
  transportEscort: boolean
  strikingForce: boolean
}

// api_sally_flag:
// [通常舰队, 联合舰队位标(1机动/2水打/4输送), 七舰游击]
export const decodeMapFleetAllowance = (raw: unknown): MapFleetAllowance => {
  const values = Array.isArray(raw) ? raw.map(Number) : []
  const combined = Number(values[1]) || 0
  return {
    normal: values[0] === 1,
    carrierTaskForce: (combined & 1) !== 0,
    surfaceTaskForce: (combined & 2) !== 0,
    transportEscort: (combined & 4) !== 0,
    strikingForce: values[2] === 1,
  }
}

export const mapFleetAllowanceLabels = (raw: unknown): string[] => {
  const value = decodeMapFleetAllowance(raw)
  return [
    value.normal ? '通常舰队' : '',
    value.carrierTaskForce ? '空母机动部队' : '',
    value.surfaceTaskForce ? '水上打击部队' : '',
    value.transportEscort ? '输送护卫部队' : '',
    value.strikingForce ? '七舰游击部队' : '',
  ].filter(Boolean)
}
