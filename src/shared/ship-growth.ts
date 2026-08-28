/**
 * 舰娘随等级成长的三维（回避 / 对潜 / 索敌）与结婚耐久的换算。
 *
 * 公式与档位全部拿用户账本实弹验证过（2026-08-11）：
 * - 成长公式 `base + floor((max - base) × Lv ÷ 99)`：183 艘全空槽在港舰
 *   逐项对照 546 项（排除 kcwiki 用 -1 标缺的 4 项），544 项完全吻合；
 *   唯一真差异是第三〇号海防舰回避初始（kcwiki 39 vs 实测 38）。
 * - 99 级以上继续按同一斜率线性成长（不封顶在 Lv99 值）：6 艘婚舰验证，
 *   例：信赖@120 回避实测 97 = 公式 97，已超其 Lv99 上限 89。
 * - 游戏对**持有的**形态其实下发上限：api_kaihi/api_taisen/api_sakuteki 的
 *   [1] 就是 Lv99 上限（婚后 [0] 会超过 [1]，[1] 不动）——一手权威，
 *   优先于社区资料。主数据（未持有形态）才是真不下发。
 *
 * 2026-08-22 面板反推扩到七项前又复验了一遍（账本 423 舰快照，观测日 2026-08-06）：
 * - 186 艘**空槽**在港舰 × 三项 = 558 格，489 格零残差、1 格残差、68 格该项本就为 0
 *   （api_*[1] = 0，如战列舰的対潜）。唯一残差仍是同一条：第三〇号海防艦 回避初始
 *   kcwiki 39 vs 实测 38 —— 一年多没变，是 kcwiki 那一格错，不是公式错。
 * - **対潜要额外减 `api_kyouka[6]`**：近代化改修对対潜是加在面板上的。
 *   实证三例（睦月改二 Lv68 改修+1、天津風改二 Lv128 改修+1、時雨改三 Lv139 改修+5），
 *   逐例 `插值 + 改修 + Σ装备対潜` 与面板对得上。回避/索敌**没有**近代化改修项
 *   （api_kyouka 只有 [火,雷,空,甲,运,耐,潜] 七位）。
 * - 带装备的 73 艘逐项算残差，七项**一个负残差都没有**——负残差才是「端点偏高」
 *   的病征，全零说明端点这一侧没有系统性偏差。
 *
 * 顺带一条对设计很重要的性质：**Lv99 处插值结果恒等于 max，与 init 无关**
 * （`init + floor((max-init)×99/99) = max`）。所以 init 端的误差 δ 对面板的影响是
 * `δ×(1 − Lv/99)`——等级越高越小，Lv99 整整为 0。低等级舰才是标定闸门最敏感的地方。
 */

/** 等级成长值。base/max 任一缺失（负数）时返回 null，不硬造。 */
export const levelGrowth = (base: number, max: number, lv: number): number | null => {
  if (!(base >= 0) || !(max >= 0) || !(lv >= 1)) return null
  if (max <= base) return base
  return base + Math.floor(((max - base) * lv) / 99)
}

/**
 * 当前的舰娘等级上限（ケッコン后）。依据：KC3Kai 经验表（ship-exp 矿脉，
 * 上游 2026-05-30）到 Lv188 封顶——Lv188 的「到下一级」为 0，175 之后
 * 还有整段。成长公式账本实测验证到 Lv139，139→188 区间是社区公式外推。
 */
export const MARRIED_LEVEL_CAP = 188

/**
 * 结婚耐久加成档位（按未婚初始耐久分档）。
 * 账本 12 艘婚舰逐一验证：+5（初始34/35/37）、+6（40）、+7（53/59/61）、
 * +8（81/85）、+9（98）五档全中，未婚 420 艘 maxhp 恒等于 api_taik[0]。
 * ≤29:+4 档账本无样本，取社区通说（wikiwiki ケッコンカッコカリ），未实测。
 */
const MARRIAGE_HP_BANDS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 29, 4],
  [30, 39, 5],
  [40, 49, 6],
  [50, 69, 7],
  [70, 89, 8],
  [90, Number.POSITIVE_INFINITY, 9],
]

export const marriageHpBonus = (baseHp: number): number | null => {
  if (!(baseHp >= 1)) return null
  const band = MARRIAGE_HP_BANDS.find(([lo, hi]) => baseHp >= lo && baseHp <= hi)
  return band ? band[2] : null
}

/** 婚后耐久 = min(初始 + 档位加成, api_taik[1] 上限)。 */
export const marriedMaxHp = (baseHp: number, capHp: number): number | null => {
  const bonus = marriageHpBonus(baseHp)
  if (bonus == null) return null
  return capHp >= 1 ? Math.min(baseHp + bonus, capHp) : baseHp + bonus
}

// ---- 三维端点表（第一方 `ship-stats` 汇编包）与标定闸门 ----
//
// 包的来路与逐格裁决写在 `ship-stats-patches.ts` 的文件头（kcwiki 基座 + wikiwiki 事实
// 转写补丁 + 账本一手裁定，印证四档）。这里只负责**怎么用**，不重复抄裁决口径。
//
// 为什么闸门必须存在：回避/对潜/索敌的成长端点游戏不在主数据里下发，社区表**会无声腐坏**
//（C2 历年单独抬高过不少舰的成长上限，公告只说「谁的哪一项 up」，不说加多少）。
// 拿一张过期的端点表去反推，会把「成长值涨了」误报成「这件装备有加成」——那种错既看不见
// 又说不清。所以上线开关不是「资料齐了」，是「拿你自己的舰当场验过」。

import type { ShipGrowthKey, ShipStatEnd } from './ship-stats-patches'

export type { ShipGrowthKey, ShipStatEnd }

/** 顺序固定：界面与包的字段顺序都按它。 */
export const SHIP_GROWTH_KEYS: readonly ShipGrowthKey[] = ['evasion', 'asw', 'los']

export const SHIP_GROWTH_LABEL: Readonly<Record<ShipGrowthKey, string>> = {
  evasion: '回避',
  asw: '对潜',
  los: '索敌',
}

/**
 * 一格端点的印证档（四档，范式同 map-drops）。
 * · `ledger` 账本一手（游戏下发的 Lv99 上限）——最硬，无条件压过两 wiki
 * · `multi`  两 wiki 独立一致
 * · `patched` 两 wiki 分歧，按裁决取一侧（待印证）
 * · `single` 只有一票（待印证）
 */
export type ShipStatState = 'ledger' | 'multi' | 'patched' | 'single'

export interface ShipStatPair {
  init: number | null
  initState: ShipStatState | null
  max: number | null
  maxState: ShipStatState | null
}

export interface ShipStatsForm {
  name: string
  evasion?: ShipStatPair
  asw?: ShipStatPair
  los?: ShipStatPair
}

export interface ShipStatsPack {
  schemaVersion: number
  compiledAt: string
  voters: Record<string, string>
  forms: Record<string, ShipStatsForm>
}

export interface GrowthEndpoints {
  init: number | null
  initState: ShipStatState | null
  max: number | null
  maxState: ShipStatState | null
}

/**
 * 这个形态这一项的端点。
 *
 * `liveMax` 是账本一手（`api_kaihi[1]` 等）：**持有形态一律以它为准**，
 * 它是游戏自己下发的，不可能腐坏。传 null（未持有 / 报文里没有）时才退到包里那一格。
 */
export const growthEndpoints = (
  pack: ShipStatsPack | null | undefined,
  formId: number,
  key: ShipGrowthKey,
  liveMax?: number | null,
): GrowthEndpoints => {
  const pair = pack?.forms?.[`${formId}`]?.[key]
  const init = Number.isInteger(pair?.init) ? (pair!.init as number) : null
  const live = Number.isInteger(liveMax) ? (liveMax as number) : null
  if (live != null) {
    return { init, initState: pair?.initState ?? null, max: live, maxState: 'ledger' }
  }
  return {
    init,
    initState: pair?.initState ?? null,
    max: Number.isInteger(pair?.max) ? (pair!.max as number) : null,
    maxState: pair?.maxState ?? null,
  }
}

/** 端点齐了就按等级插值，缺一头就 null——不拿主数据的别的项凑，也不摆 0。 */
export const growthValueAt = (endpoints: GrowthEndpoints, lv: number): number | null =>
  endpoints.init == null || endpoints.max == null
    ? null
    : levelGrowth(endpoints.init, endpoints.max, lv)

// ---- 标定闸门 ----

/**
 * 闸门判定。
 * · `pass`        有干净样本，零残差 → 该形态该项的面板反推启用
 * · `fail`        有干净样本但残差非零 → **禁用**（宁缺毋滥，不把成长上修误报成装备加成）
 * · `unverified`  没有干净样本可验（这个形态你手上每一艘都装着东西，或者干脆没有）
 * · `noEndpoint`  端点缺一头，压根算不了
 */
export type GrowthGate = 'pass' | 'fail' | 'unverified' | 'noEndpoint'

/**
 * 干净样本 = **一件装备都没有**的在港舰。
 *
 * 为什么只认这一种：闸门要验的是「面板 − 插值 − Σ装备原始值 是不是 0」，而右边那个 0
 * 必须是**事实**，不能是「预期层说这套配装没有加成」——后者是我们自己那张表的说法，
 * 拿它当判据就成了自证。空槽舰的加成必然为 0，是唯一无需资料背书的干净样本。
 */
export interface GrowthGateSample {
  rosterId: number
  formId: number
  name: string
  lv: number
  /** 面板值（api_kaihi[0] 等，已含装备与加成） */
  panel: Readonly<Partial<Record<ShipGrowthKey, number>>>
  /** 账本一手 Lv99 上限（api_kaihi[1] 等）；缺项传 null */
  liveMax: Readonly<Partial<Record<ShipGrowthKey, number | null>>>
  /** api_kyouka[6]：只有对潜有近代化改修，回避/索敌没有 */
  aswKyouka: number
  /** 一件装备都没有 */
  clean: boolean
}

export interface GrowthVerdict {
  formId: number
  key: ShipGrowthKey
  state: GrowthGate
  init: number | null
  max: number | null
  initState: ShipStatState | null
  maxState: ShipStatState | null
  /** 干净样本存在时一并带上（`fail` 时就是台账要写的那几栏） */
  rosterId?: number
  name?: string
  lv?: number
  expected?: number
  observed?: number
  /** 实测 − 期望。0 才准过闸 */
  residual?: number
}

export const growthGateKey = (formId: number, key: ShipGrowthKey): string => `${formId}|${key}`

/**
 * 全舰队逐 (形态, 项) 扫一遍。
 *
 * 同一形态有好几艘时：**只要有一艘干净样本残差非零就判 fail**（宁缺毋滥）。
 * 没有干净样本的形态判 `unverified` —— 见 `growthReverseEnabled` 那条口径。
 */
export const calibrateGrowth = (
  pack: ShipStatsPack | null | undefined,
  samples: readonly GrowthGateSample[],
): Map<string, GrowthVerdict> => {
  const out = new Map<string, GrowthVerdict>()
  for (const sample of samples) {
    for (const key of SHIP_GROWTH_KEYS) {
      const gateKey = growthGateKey(sample.formId, key)
      const endpoints = growthEndpoints(pack, sample.formId, key, sample.liveMax[key] ?? null)
      const prev = out.get(gateKey)
      // 已经判定 fail 的不再被后来的样本翻案
      if (prev?.state === 'fail') continue
      const base: GrowthVerdict = {
        formId: sample.formId,
        key,
        state: 'unverified',
        init: endpoints.init,
        max: endpoints.max,
        initState: endpoints.initState,
        maxState: endpoints.maxState,
      }
      const expected = growthValueAt(endpoints, sample.lv)
      if (expected == null) {
        if (!prev || prev.state === 'unverified') out.set(gateKey, { ...base, state: 'noEndpoint' })
        continue
      }
      if (!sample.clean) {
        if (!prev) out.set(gateKey, base)
        continue
      }
      const panel = sample.panel[key] ?? 0
      const observed = panel - (key === 'asw' ? sample.aswKyouka || 0 : 0)
      const residual = observed - expected
      const verdict: GrowthVerdict = {
        ...base,
        state: residual === 0 ? 'pass' : 'fail',
        rosterId: sample.rosterId,
        name: sample.name,
        lv: sample.lv,
        expected,
        observed,
        residual,
      }
      // pass 不覆盖已有的 pass（第一艘就够），但任何 fail 都要盖上去
      if (verdict.state === 'fail' || !prev || prev.state !== 'pass') out.set(gateKey, verdict)
    }
  }
  return out
}

/**
 * 这一档准不准做面板反推。
 *
 * `pass` 当然准，`fail` / `noEndpoint` 当然不准。**`unverified` 准**——这是一个
 * 有意的判断，理由是三条实测而不是省事：
 *
 * ① 端点的两头里，**max 端对持有形态是游戏一手**（`api_kaihi[1]` 等），不存在腐坏问题；
 *    真正只靠社区资料的只有 init 一头。
 * ② init 端的误差 δ 对面板的影响是 `δ×(1 − Lv/99)`，**Lv99 处恰好为 0**；
 *    而账本 186 艘空槽舰 × 三项 490 格里，init 端只错了 1 格（第三〇号海防艦 回避）。
 * ③ 把「没验过」一律当成「必然错」，会把绝大多数带装备的舰整片关掉——而带装备的舰
 *    正是这个功能唯一有意义的对象。那不是保守，是把功能关掉。
 *
 * 所以 `unverified` 照常出数，但**界面必须标出来**「这一项的成长端点还没在你的舰上验过」，
 * 由读的人自己决定信到什么程度。少说一句可以，说得像验过了不行。
 */
export const growthReverseEnabled = (state: GrowthGate): boolean =>
  state === 'pass' || state === 'unverified'
