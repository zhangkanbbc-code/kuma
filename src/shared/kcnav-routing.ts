// KCNav 编成实测频率的纯离线匹配层。
// 只做“舰种多重集 + 联合类型”精确命中；不把相似编成或全服边总量冒充当前舰队概率。

export const KCNAV_STYPE_CODE: Record<number, string> = {
  1: 'DE',
  2: 'DD',
  3: 'CL',
  4: 'CLT',
  5: 'CA',
  6: 'CAV',
  7: 'CVL',
  8: 'FBB',
  9: 'BB',
  10: 'BBV',
  11: 'CV',
  12: 'BB',
  13: 'SS',
  14: 'SSV',
  15: 'AO',
  16: 'AV',
  17: 'LHA',
  18: 'CVB',
  19: 'AR',
  20: 'AS',
  21: 'CT',
  22: 'AO',
}

export interface KcnavFleetComposition {
  fleetType: number
  fleet1Comp: string[]
  fleet2Comp: string[]
}

export interface KcnavCompSample {
  fleetTypes: number[]
  fleet1Comp: string[]
  fleet2Comp: string[]
  count: number
}

export interface KcnavBranch {
  edges: {
    edgeId: number
    to: string
    comps: KcnavCompSample[]
  }[]
}

export interface KcnavBranchEstimate {
  sample: number
  routes: {
    to: string
    edgeId: number
    count: number
    probability: number
  }[]
}

const compKey = (values: string[]) => [...values].sort().join(',')

export const kcnavFleetComposition = (
  mainStypes: number[],
  escortStypes: number[],
  combinedFlag: number,
): KcnavFleetComposition | null => {
  const convert = (values: number[]) =>
    values.map((stype) => KCNAV_STYPE_CODE[stype]).filter((value): value is string => Boolean(value))
  const fleet1Comp = convert(mainStypes)
  const fleet2Comp = convert(escortStypes)
  if (fleet1Comp.length !== mainStypes.length || fleet2Comp.length !== escortStypes.length) return null
  return {
    fleetType: combinedFlag > 0 ? combinedFlag : 0,
    fleet1Comp,
    fleet2Comp,
  }
}

export const estimateKcnavBranch = (
  branch: KcnavBranch | null | undefined,
  fleet: KcnavFleetComposition | null | undefined,
  candidates: string[],
  minSamples = 20,
): KcnavBranchEstimate | null => {
  if (!branch?.edges?.length || !fleet || candidates.length < 2) return null
  const mainKey = compKey(fleet.fleet1Comp)
  const escortKey = compKey(fleet.fleet2Comp)
  const counts = branch.edges
    .filter((edge) => candidates.includes(edge.to))
    .map((edge) => ({
      edgeId: edge.edgeId,
      to: edge.to,
      count: (edge.comps ?? [])
        .filter(
          (sample) =>
            sample.fleetTypes.includes(fleet.fleetType) &&
            compKey(sample.fleet1Comp) === mainKey &&
            compKey(sample.fleet2Comp) === escortKey,
        )
        .reduce((sum, sample) => sum + sample.count, 0),
    }))
  const sample = counts.reduce((sum, entry) => sum + entry.count, 0)
  if (sample < minSamples || !counts.some((entry) => entry.count > 0)) return null
  return {
    sample,
    routes: counts
      .filter((entry) => entry.count > 0)
      .map((entry) => ({
        ...entry,
        probability: entry.count / sample,
      })),
  }
}
