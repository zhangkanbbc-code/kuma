// 任务前置链的双源合并（2026-08-17 用户要求接入 wikiwiki 并对账后定的口径）。
//
// 基准仍是 quests-scn（zh.kcwiki 任务页直取）——任务域的数据单基准不动摇；
// wikiwiki（任務页 開放条件，抓取时已经 EO 日文名公证对齐）只做三件事：
//   1. 补缺：scn 没写前置而 wikiwiki 有明确前置的（对账实测 5 条），拿来用；
//      wikiwiki 自己标「検証中/達成後？」的不拿——wiki 都没把握的不能当判据。
//   2. 修悬空：scn 的 pre 指向库里不存在的码（旧码 C2、下线的限时码 2409B1 等，
//      实测 9 条，其中 6 条因此被判成永远「未解锁」）。wikiwiki 给得出现行前置的，
//      用它替换悬空部分；给不出的原样保留，交给判定端如实说「判不了」。
//   3. 标冲突：双方都有前置但集合不等（实测 69 条）。判定仍按 scn，
//      冲突原样带出去给 UI 展示——分歧要让人看见，不能静默吞掉。
export interface WwQuestPre {
  code: string
  nameJp: string
  pre: string[]
  condRaw?: string
  page?: string
  uncertain?: boolean
  /** 抓取时 EO 公证失败（同码不同名=code 空间错位）。false 之外不会出现 */
  aligned?: boolean
}

export interface MergedQuestPre {
  /** 判定与展示用的现行前置 */
  pre: string[]
  source: 'kcwiki' | 'wikiwiki' | 'merged' | 'arbitrated'
  scnPre: string[]
  /** 公证通过的 wikiwiki 口径原样（含不确定的）；没有或没公证过为 null */
  wwPre: string[] | null
  wwUncertain: boolean
  /** 双方都给了且集合不等（悬空修补的场合不算冲突） */
  conflict: boolean
  /** scn 指向库外的码（旧码/限时残留）。被 wikiwiki 替换后这里仍保留原始名单 */
  dangling: string[]
  /** source='arbitrated' 时的裁决依据（quest-pre-arbitration 原文） */
  basis?: string
}

const sortedUnique = (list: readonly string[]): string[] => [...new Set(list)].sort()

const sameSet = (left: readonly string[], right: readonly string[]): boolean => {
  if (left.length !== right.length) return false
  const set = new Set(left)
  return right.every((item) => set.has(item))
}

export const mergeQuestPre = (
  scnPre: readonly string[],
  ww: WwQuestPre | undefined,
  knownCodes: ReadonlySet<string>,
  arbitration?: { pre: string[]; basis: string } | null,
): MergedQuestPre => {
  const scn = sortedUnique(scnPre ?? [])
  const wwUsable = ww && ww.aligned !== false ? ww : undefined
  const wwPre = wwUsable ? sortedUnique(wwUsable.pre ?? []) : null
  const wwUncertain = !!wwUsable?.uncertain
  // 三源仲裁（quest-pre-arbitration）优先于一切合并规则：硬裁决就按裁决来。
  // 库外码（限时任务）保留不滤——判定端对无法验证的前置如实给「未同步」
  if (arbitration) {
    const pre = sortedUnique(arbitration.pre)
    return {
      pre,
      source: 'arbitrated',
      scnPre: scn,
      wwPre,
      wwUncertain,
      conflict: wwPre != null && !sameSet(scn, wwPre),
      dangling: pre.filter((code) => !knownCodes.has(code)),
      basis: arbitration.basis,
    }
  }
  const dangling = scn.filter((code) => !knownCodes.has(code))
  const kept = scn.filter((code) => knownCodes.has(code))
  const wwKnown = wwPre ? wwPre.filter((code) => knownCodes.has(code)) : []

  if (!scn.length) {
    // 补缺：只收 wikiwiki 有把握的
    if (wwPre?.length && !wwUncertain && wwKnown.length) {
      return { pre: wwKnown, source: 'wikiwiki', scnPre: scn, wwPre, wwUncertain, conflict: false, dangling }
    }
    return { pre: [], source: 'kcwiki', scnPre: scn, wwPre, wwUncertain, conflict: false, dangling }
  }
  if (dangling.length) {
    // 修悬空：wikiwiki 给得出现行前置就用（合并仍认可的部分）；给不出则原样保留，
    // 悬空码由判定端识别成「判不了」而不是永远未解锁
    if (wwPre?.length && wwKnown.length) {
      return {
        pre: sortedUnique([...kept, ...wwKnown]),
        source: 'merged',
        scnPre: scn,
        wwPre,
        wwUncertain,
        conflict: false,
        dangling,
      }
    }
    return { pre: scn, source: 'kcwiki', scnPre: scn, wwPre, wwUncertain, conflict: false, dangling }
  }
  return {
    pre: scn,
    source: 'kcwiki',
    scnPre: scn,
    wwPre,
    wwUncertain,
    conflict: wwPre != null && !sameSet(scn, wwPre),
    dangling,
  }
}
