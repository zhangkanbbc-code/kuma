// 出击识别札（出撃制限）的判定。
//
// ## 机制
//
// 每张活动图（按阶段）对应**一个**札号。规则是：
// - 无札的船初次出击某图 → 被打上该图的札，不可逆；
// - 有札的船**只能进札号相同的图**：A 打了 a 图带上 1 札，b 图要 2 札，A 就进不去 b；
// - **b 图通关之后不再查札**，此时 A 也能去打 b（通常是回头捞船）。
//
// 所以「查不查」是逐图的，而且会变。除了通关解锁，低难度（丙/丁）本来就不锁。
// 这两种都不必自己建模：游戏在 mapinfo 里**逐图**下发
// `api_eventmap.api_limit_flag`（1 = 查札，0 = 不查），一个字段把两者都包了。
//
// ## 艦素判不了「能不能进」，所以不判
//
// 一开始我按「一图一札、混札必被拒」写了个判定，**是错的**。看攻略表就知道：
// - 札绑的是**阶段**不是图：同一张 E-2 里，P1 解谜要第三十一战队札、
//   P1 绿条要多号作战部队札、P2 血条要联合舰队札……
// - 还要再按**编成类型**分（通常 / 游击 / 机动 / 水打 / 输送）；
// - 而且**有些图明确允许几种札混用**——E-1/E-2/E-3 的备注就是
//   「全难度下，以上两种贴条可以混合使用」。所以混札根本不等于进不去。
//
// 而游戏只下发一个布尔：mapinfo 的 `api_limit_flag`。哪个阶段收哪几种札，
// 它一个字都不说（api_req_map/start 的 api_limit_state 实测恒为 0，
// 2026-08-08 查过全库报文）。
//
// 更根本的一条：**没有血条的阶段根本不下发 API**，所以「现在打到哪个阶段」
// 这件事从被动观测层面就拿不全——按阶段判船因此不是「难做」而是做不到。
//
// 结论：**「这支队能不能进那张图」不是艦素能算的**，硬判就是编。
// 这里只报三件能确定的事：
// ① 现在各图查不查札（limit_flag，通关与低难度都反映在它上面）；
// ② 队里有没有无札的船——出击会被打札，不可逆；
// ③ 队里都有哪些札，供你自己对着攻略表看。
//
// 对照表看这里（每期活动一页，含逐阶段的锁船表）：
// https://zh.kcwiki.cn/wiki/2026年夏季活动
//
// 那份对照表的**图级**部分已于 2026-08-26 录进 shared/sally-rules
//（哪张图贴哪几枚、哪几枚禁入、按难度分），铎的血条卡直接摆出来。
// 逐阶段那一层仍旧没录，所以上面这条结论一个字都不改：**照旧不判「能不能进」**。
//
// ## 打札与查札无关
//
// 用户账本实测（2026-08-07，62 区丙难度、limit_flag=0）：混着札 1/2/4/7/8 的
// 联合舰队出击 62-4 十余次全部成功，而同期一艘无札的舰照样被打上了札 8。
// 所以「不查札」时仍要提醒「无札的会被打札」。

export interface SallyGauge {
  /** api_eventmap.api_limit_flag；null = 还没读到 mapinfo（未知，不等于 0） */
  limitFlag: number | null
  selectedRank: number | null
  cleared: boolean
}

export type SallyVerdict =
  /** 没有活动、或没什么好说的 */
  | { kind: 'none' }
  /**
   * 有图在查札。**不下「进不进得去」的判断**——那要按阶段与编成类型对照
   * 攻略表，游戏不下发这份对照，艦素算不出来。只把队里有哪些札摆出来。
   */
  | { kind: 'checking'; tags: number[]; enforcing: number[]; untagged: number }
  /** 还不知道查不查（没读到 mapinfo）→ 别乱下结论 */
  | { kind: 'unknown'; tags: number[]; untagged: number }
  /** 确认各图都不查 → 札这件事现在不用管 */
  | { kind: 'free'; tags: number[]; untagged: number }
  /** 有无札的舰 → 出击会被打札，不可逆 */
  | { kind: 'willTag'; tags: number[]; untagged: number; all: boolean }

/**
 * 仍在进行中的活动区 id。
 *
 * 「是不是事件图」不能只看区号：`mg.mapGauges` 会把历次活动的图一直留着，
 * 只按区号判的话，上一次活动某张图的 limit_flag 会在**新活动**期间冒出来
 * 报「有图在查札」——串味的判据比没有判据更糟。
 *
 * 放在 shared 而不是渲染层，是为了这一段能被直接调用验证：
 * 只断言源码里有 `.filter(([, period]) => !period.closed)` 这种文本，
 * 把 period 改个名就红，判断写反了反而照样绿。
 */
export const activeEventAreaIds = (
  eventAreas: Record<number, { closed: boolean }> | null | undefined,
): Set<number> =>
  new Set(
    Object.entries(eventAreas ?? {})
      .filter(([, period]) => !period?.closed)
      .map(([areaId]) => Number(areaId))
      .filter((areaId) => Number.isFinite(areaId)),
  )

const eventGaugesOf = (gauges: Record<number, SallyGauge>, isEventMap: (mapId: number) => boolean) =>
  Object.entries(gauges ?? {})
    .map(([id, gauge]) => [Number(id), gauge] as const)
    .filter(([id]) => isEventMap(id))

export const sallyRestriction = (
  gauges: Record<number, SallyGauge>,
  isEventMap: (mapId: number) => boolean,
): { enforcing: number[]; known: boolean } => {
  const entries = eventGaugesOf(gauges, isEventMap)
  return {
    enforcing: entries.filter(([, gauge]) => gauge.limitFlag === 1).map(([id]) => id),
    // 一张图都没读到，或有任何一张的 flag 还是 null/undefined，就算「不知道」。
    // `!= null` 对 undefined 也成立——旧存档里没有这个字段。
    known: entries.length > 0 && entries.every(([, gauge]) => gauge.limitFlag != null),
  }
}

export const sallyVerdict = (
  sallyAreas: readonly number[],
  gauges: Record<number, SallyGauge>,
  isEventMap: (mapId: number) => boolean,
  eventRunning: boolean,
): SallyVerdict => {
  if (!eventRunning || !sallyAreas.length) return { kind: 'none' }
  const tags = [...new Set(sallyAreas.filter((area) => area > 0))].sort((a, b) => a - b)
  const untagged = sallyAreas.filter((area) => area === 0).length
  const { enforcing, known } = sallyRestriction(gauges, isEventMap)

  // 有图在查札：把「哪几张在查」和「这队带着哪些札」摆出来，判断留给用户。
  // 队里有几种札都一样——混札本来就可能是允许的（E-1/E-2/E-3 就明说可以混用）。
  if (enforcing.length) return { kind: 'checking', tags, enforcing, untagged }
  if (!known) {
    // 还没读到 mapinfo。只有在有话可说时才提（有札要对照、或有船会被打札）
    return tags.length || untagged ? { kind: 'unknown', tags, untagged } : { kind: 'none' }
  }
  // 确认都不查札。此时唯一还要说的是「无札的会被打札」——那与查不查无关。
  if (untagged) return { kind: 'willTag', tags, untagged, all: untagged === sallyAreas.length }
  return tags.length ? { kind: 'free', tags, untagged } : { kind: 'none' }
}
