// 舰娘语音资料经常只收录改装链中的某个形态。
// 这里把 api_aftershipid 的正向改装链整理成「当前形态 → 最近前置形态 → … → 原型」，
// 供图鉴与游戏内实时字幕共用。循环改装只沿从链根实际走到当前形态的前缀回退，
// 不会把当前形态之后的可逆形态误当成前置。

interface RemodelShipLike {
  api_id?: unknown
  api_aftershipid?: unknown
  api_sortno?: unknown
}

interface ShipUpgradeLike {
  api_id?: unknown
  api_current_ship_id?: unknown
}

type SubtitleTables = Record<string, Record<string, string> | undefined>

export const normalizeVoiceLine = (value: unknown): string =>
  `${value ?? ''}`
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .trim()

// wikiwiki 只有日文原文。只有当既有日中字幕包对同一句日文给出唯一译文时才复用，
// 同一句出现多个中文版本则视为有歧义并留空，绝不任选一个。
export const buildVoiceTranslationIndex = (
  jaTables: SubtitleTables | null | undefined,
  zhTables: SubtitleTables | null | undefined,
): Map<string, string> => {
  const candidates = new Map<string, Set<string>>()
  for (const [shipId, jaTable] of Object.entries(jaTables ?? {})) {
    if (shipId === 'version' || !jaTable || typeof jaTable !== 'object') continue
    const zhTable = zhTables?.[shipId]
    if (!zhTable || typeof zhTable !== 'object') continue
    for (const [voiceId, ja] of Object.entries(jaTable)) {
      const zh = `${zhTable[voiceId] ?? ''}`.trim()
      const key = normalizeVoiceLine(ja)
      if (!key || !zh) continue
      const values = candidates.get(key) ?? new Set<string>()
      values.add(zh)
      candidates.set(key, values)
    }
  }
  return new Map(
    [...candidates]
      .filter(([, values]) => values.size === 1)
      .map(([key, values]) => [key, [...values][0]]),
  )
}

const positiveInt = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : Number.parseInt(`${value ?? ''}`, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

export const buildVoiceFallbackIds = (
  mstShips: readonly RemodelShipLike[] | null | undefined,
  mstUpgrades?: readonly ShipUpgradeLike[] | null,
): Map<number, number[]> => {
  const nextOf = new Map<number, number | null>()
  const incoming = new Set<number>()

  for (const ship of mstShips ?? []) {
    const id = positiveInt(ship?.api_id)
    // api_sortno > 0 是我方舰娘；深海语音走独立音轨，不能套用改装链回退。
    if (id == null || !(Number(ship?.api_sortno) > 0)) continue
    const after = positiveInt(ship?.api_aftershipid)
    nextOf.set(id, after)
  }

  // 新版 start2 的原生改造表直接给出「目标形态 → 直接前置形态」。
  // 它能表达分支与可逆改装；存在时不再拿 aftershipid 单链猜前置方向。
  if (Array.isArray(mstUpgrades) && mstUpgrades.length) {
    const parentOf = new Map<number, number>()
    for (const upgrade of mstUpgrades) {
      const target = positiveInt(upgrade?.api_id)
      const current = positiveInt(upgrade?.api_current_ship_id)
      if (target != null && current != null && nextOf.has(target) && nextOf.has(current)) {
        parentOf.set(target, current)
      }
    }
    // ---- shipupgrade 没说话的那些边，用 aftershipid 补上（**只填空，不覆盖**）----
    //
    // 2026-08-27 实测本机 start2 快照：`api_mst_shipupgrade` 359 行里只有 259 行
    // 建得出前置边（其余是 `api_current_ship_id: 0` 的链首行），而 `api_aftershipid`
    // 给得出 555 条。差出来的那些形态**整条链只剩它自己**，于是「沿改装链借文本」
    // 对它们从来没生效过——杰维斯（519 → 394）正是其中一个：她在 shipupgrade 里
    // 一行都没有，改形态的中破字幕因此无处可借（用户实测无字幕的直接成因）。
    //
    // 冲突时仍以 shipupgrade 为准（`parentOf.has` 就跳过）：它能表达分支与可逆改装，
    // 而 aftershipid 是单向单链、遇到可逆改装会把方向猜反。这里只在它**沉默**的地方
    // 补一条边，补完照旧走下面那个带 `seen` 的爬升循环，环与超长链都拦得住。
    for (const [id, after] of nextOf) {
      if (after == null || !nextOf.has(after) || parentOf.has(after)) continue
      parentOf.set(after, id)
    }
    const fallbackOf = new Map<number, number[]>()
    for (const id of nextOf.keys()) {
      const path = [id]
      const seen = new Set(path)
      let current = id
      while (parentOf.has(current) && path.length < 16) {
        const parent = parentOf.get(current)!
        if (seen.has(parent)) break
        seen.add(parent)
        path.push(parent)
        current = parent
      }
      fallbackOf.set(id, path)
    }
    return fallbackOf
  }

  for (const after of nextOf.values()) {
    if (after != null && nextOf.has(after)) incoming.add(after)
  }

  const fallbackOf = new Map<number, number[]>()
  const roots = [...nextOf.keys()].filter((id) => !incoming.has(id)).sort((a, b) => a - b)

  for (const root of roots) {
    const chain: number[] = []
    const visited = new Set<number>()
    let current: number | null = root
    while (current != null && nextOf.has(current) && !visited.has(current)) {
      visited.add(current)
      chain.push(current)
      const after = nextOf.get(current)
      current = after != null && nextOf.has(after) ? after : null
    }

    for (let index = 0; index < chain.length; index++) {
      const id = chain[index]
      // 多条根链若汇入同一形态，保留先遇到的确定路径，不把另一条谱系混进来。
      if (fallbackOf.has(id)) continue
      fallbackOf.set(id, [id, ...chain.slice(0, index).reverse()])
    }
  }

  // 没有链根的孤立环无法判断谁是前置；宁可只查自身，也不猜回退方向。
  for (const id of nextOf.keys()) {
    if (!fallbackOf.has(id)) fallbackOf.set(id, [id])
  }

  return fallbackOf
}
