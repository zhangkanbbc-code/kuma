import type {
  MasterShip,
  PlayerShip,
  PowerupResultCue,
  PowerupStatDelta,
  PowerupStatKey,
} from '../../shared/mg-types'

/**
 * 近代化改修的「还能不能再练」只能按**已投入的改修量**判，不能按面板值判。
 *
 * 实测（Fletcher改 Mod.2，rid 3813，Lv88）：
 *
 *   api_karyoku = [72, 60]      ← [0] 是含装备的面板值，[1] 是满改修后的**裸**上限
 *   api_taiku   = [100, 92]
 *   api_kyouka  = [44, 41, 37, 37, 0, 0, 0]   ← 已投入的改修量
 *   master api_houg = [16, 60]  → 火力容量 44，已投 44 → 真满
 *   master api_tyku = [45, 92]  → 对空容量 47，已投 37 → 还能 +10
 *
 * 原先拿 `api_karyoku[0] >= api_karyoku[1]` 判满，等于拿「含装备的面板」比「不含装备的裸上限」——
 * 装备一挂上去几乎项项都会被判成满。那个「满」是假的：上面这艘的对空明明还有 10 点空间。
 *
 * 现在改报**还能提升多少**：0 才是真满，判不了就不说（对潜的改修上限不在主数据里）。
 */
interface StatSource {
  key: PowerupStatKey
  before: (ship: PlayerShip) => number
  raw: string
  /** api_kyouka 的下标，顺序 [火力, 雷装, 对空, 装甲, 运, 耐久, 对潜] */
  kyouka: number
  /** 该项的改修容量 = 主数据上限 − 主数据初始；主数据没有该项时返回 null */
  capacity: (master: MasterShip | undefined) => number | null
}

const pairCurrent = (value: unknown): number | null =>
  Array.isArray(value) && Number.isFinite(Number(value[0])) ? Number(value[0]) : null

/**
 * 上限 − 初始。两者相等或缺席时返回 null——
 * 玩家舰的 api_mst_ship 里根本没有 api_tais/api_kaih，落库后是 0，
 * 那时候说「满」就是拿缺失当成 0 容量在骗人。
 */
const span = (base: number | undefined, max: number | undefined): number | null =>
  Number.isFinite(base) && Number.isFinite(max) && (max as number) > (base as number)
    ? (max as number) - (base as number)
    : null

const STAT_SOURCES: StatSource[] = [
  { key: 'firepower', before: (s) => s.karyoku, raw: 'api_karyoku', kyouka: 0, capacity: (m) => span(m?.baseHoug, m?.maxHoug) },
  { key: 'torpedo', before: (s) => s.raisou, raw: 'api_raisou', kyouka: 1, capacity: (m) => span(m?.baseRaig, m?.maxRaig) },
  { key: 'antiAir', before: (s) => s.taiku, raw: 'api_taiku', kyouka: 2, capacity: (m) => span(m?.baseTyku, m?.maxTyku) },
  { key: 'armor', before: (s) => s.soukou, raw: 'api_soukou', kyouka: 3, capacity: (m) => span(m?.baseSouk, m?.maxSouk) },
  { key: 'luck', before: (s) => s.lucky, raw: 'api_lucky', kyouka: 4, capacity: (m) => span(m?.baseLuck, m?.maxLuck) },
  { key: 'hp', before: (s) => s.maxhp, raw: 'api_maxhp', kyouka: 5, capacity: (m) => span(m?.baseTaik, m?.maxTaik) },
  // 对潜：玩家舰主数据没有 api_tais，容量恒为 null，只报增量不说满没满
  { key: 'asw', before: (s) => s.taisen, raw: 'api_taisen', kyouka: 6, capacity: (m) => span(m?.baseTais, m?.maxTais) },
]

const rawCurrent = (rawShip: any, key: string): number | null => {
  const raw = rawShip?.[key]
  if (key === 'api_maxhp') return Number.isFinite(Number(raw)) ? Number(raw) : null
  return pairCurrent(raw)
}

/**
 * 只在游戏明确回报成功、且操作前目标舰已在本地状态中时生成结果。
 * 没有 before 就无法诚实计算增幅，宁可不弹“+?”，等待下一次操作。
 */
export const buildPowerupResultCue = (
  before: PlayerShip | undefined,
  body: any,
  ts: number,
  master?: MasterShip,
): PowerupResultCue | null => {
  if (Number(body?.api_powerup_flag) !== 1 || !before || !body?.api_ship) return null
  const rawShip = body.api_ship
  if (Number(rawShip.api_id) !== before.id) return null
  const kyouka: unknown[] = Array.isArray(rawShip.api_kyouka) ? rawShip.api_kyouka : []

  const stats: PowerupStatDelta[] = []
  for (const source of STAT_SOURCES) {
    const previous = source.before(before)
    const current = rawCurrent(rawShip, source.raw)
    if (current == null || current <= previous) continue
    const capacity = source.capacity(master)
    const used = Number(kyouka[source.kyouka])
    // 两个都得有才算得出余量；缺一个就是不知道，不知道就不说
    const room =
      capacity != null && Number.isFinite(used) ? Math.max(0, capacity - used) : null
    stats.push({
      key: source.key,
      before: previous,
      after: current,
      room,
      delta: current - previous,
    })
  }

  return {
    ts,
    rosterId: before.id,
    mstId: Number(rawShip.api_ship_id) || before.shipId,
    stats,
  }
}
