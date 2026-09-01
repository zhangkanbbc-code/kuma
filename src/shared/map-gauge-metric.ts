// 海域计量条「计的是什么」的手工资料表。
//
// 起因：游戏主数据 `api_mst_mapinfo.api_required_defeat_count` 是个**没有单位的数**，
// 语义按图而异——1-5 的 4 是击破次数、1-6 的 7 是到达终点次数、5-6 的 280 是
// 输送条的 TP 总量、7-5 的 2 只是**第一段**的击破次数（整图三段共八次）。
// 拿任何一句固定的「需击破 N 次」去套，必然在某些图上说谎，所以 2026-09-01
// 把这个数从海域卡整个撤下（dff30b3），并写明「要放回来得先接按图区分计量类型的资料」。
// 这张表就是那份资料。
//
// 出处：wikiwiki.jp/kancolle 各海域页顶部「海域情報」表里的
// 「戦力(HP)ゲージ」/「ゲージ」/「第一〜第三ゲージ」行，**2026-09-01 逐图取原文核对**。
// 每一段的 `sourceJp` 就是那一格的原文逐字（格内换行折成「／」，脚注记号 *1 照留），
// 多段图按表上的段序排列。判据留在数据里，改数值的人一眼能看见自己在改什么。
//
// 收录范围：主数据里 `api_required_defeat_count` 非空的 20 张常规海域。
// 其余 17 张常规图（1-1~1-4 / 2-1~2-4 / 3-1~3-4 / 4-1~4-3 / 5-1 / 6-1）同日
// 也逐页看过，「海域情報」表里根本没有ゲージ行——不是主数据推断出来的「没有」。
// 活动海域不进这张表：活动图的血条随难度与期数变，只能看游戏当场下发的
// `api_eventmap`（见 shared/map-gauge.ts），手工表追不上也不该追。
//
// 交叉校验（两份互不相干的资料互证，见 test/map-gauge-metric.test.mjs）：
// **主数据的 `api_required_defeat_count` 恒等于本表第一段的量**——
// 单段图就是整图的量；5-6 是第一段输送条的 280、7-5/7-2/7-3 是第一段的击破次数。
// 表里抄错一位数，这条断言就会顶出来。

import { mapCodeOf } from './map-id'

/** 计量条计的是什么 */
export type MapGaugeMetric =
  /** 击破 Boss 舰队旗舰的次数 */
  | 'defeat'
  /** 到达终点的次数（1-6 没有 Boss 战，回到母港就算一次） */
  | 'arrival'
  /** 运输作战的输送量（TP 总量），不是次数 */
  | 'transport'

export interface MapGaugeSegment {
  metric: MapGaugeMetric
  /** 计次类是次数，输送类是 TP 总量 */
  amount: number
  /** wikiwiki「海域情報」表该段那一格的原文（日文逐字，换行折成「／」） */
  sourceJp: string
}

/**
 * 键是海域 id（区 × 10 + 图号），与 mapIdOf 一致。
 * 数组顺序即攻略顺序：多段图必须先破前一段才出现下一段。
 */
export const MAP_GAUGE_SEGMENTS: Record<number, readonly MapGaugeSegment[]> = {
  // 1-5
  15: [
    {
      metric: 'defeat',
      amount: 4,
      sourceJp: 'ボス艦隊旗艦の撃沈で25%減少（与ダメージでは減少しない）／4回撃沈で海域クリア',
    },
  ],
  // 1-6：全游戏唯一没有 Boss 战的图，计的是「回到母港」的次数
  16: [
    {
      metric: 'arrival',
      amount: 7,
      sourceJp: 'Nマスに到達するたびに1/7減少／7回目の到達でゲージが消滅し、海域クリア',
    },
  ],
  // 2-5
  25: [
    {
      metric: 'defeat',
      amount: 4,
      sourceJp: 'ボス艦隊旗艦の撃沈で25%減少（与ダメージでは減少しない）／4回撃沈で海域クリア',
    },
  ],
  // 3-5
  35: [
    {
      metric: 'defeat',
      amount: 4,
      sourceJp: 'ボス艦隊旗艦の撃沈で25%減少（与ダメージでは減少しない）／4回撃沈で海域クリア',
    },
  ],
  // 4-4
  44: [
    {
      metric: 'defeat',
      amount: 4,
      sourceJp: 'ボス艦隊旗艦の撃沈で25%減少（与ダメージでは減少しない）／4回撃沈で海域クリア',
    },
  ],
  // 4-5
  45: [
    {
      metric: 'defeat',
      amount: 5,
      sourceJp: 'ボス艦隊旗艦の撃沈で20%減少（与ダメージでは減少しない）／5回撃沈で海域クリア',
    },
  ],
  // 5-2
  52: [
    {
      metric: 'defeat',
      amount: 4,
      sourceJp: 'ボス艦隊旗艦の撃沈で25%減少（与ダメージでは減少しない）／4回撃沈で海域クリア',
    },
  ],
  // 5-3
  53: [
    {
      metric: 'defeat',
      amount: 5,
      sourceJp: 'ボス艦隊旗艦の撃沈で20%減少（与ダメージでは減少しない）／5回撃沈で海域クリア',
    },
  ],
  // 5-4
  54: [
    {
      metric: 'defeat',
      amount: 5,
      sourceJp: 'ボス艦隊旗艦の撃沈で20%減少（与ダメージでは減少しない）／5回撃沈で海域クリア',
    },
  ],
  // 5-5
  55: [
    {
      metric: 'defeat',
      amount: 5,
      sourceJp: 'ボス艦隊旗艦の撃沈で20%減少（与ダメージでは減少しない）／5回撃沈で海域クリア',
    },
  ],
  // 5-6：常规海域里唯一的输送条，页内原文称「輸送 -戦力 -戦力のトリプルゲージ構成」。
  // 第一段原文写作「TP~280」（约），主数据给的是整数 280——两边对得上，取 280。
  56: [
    {
      metric: 'transport',
      amount: 280,
      sourceJp: '輸送ゲージ(Gマス)／輸送ゲージTP最大値：／TP~280',
    },
    {
      metric: 'defeat',
      amount: 2,
      sourceJp:
        '第二ゲージ出現ギミックあり。／・Rマス到達1回／ギミッククリア後、I~Q2マスが出現／戦力ゲージ(Nマス)／ボス艦隊旗艦の撃沈で1/2減少*1／2回撃沈でゲージ破壊',
    },
    {
      metric: 'defeat',
      amount: 3,
      sourceJp: '戦力ゲージ(Zマス)／ボス艦隊旗艦の撃沈で1/3減少*2／3回撃沈で海域クリア',
    },
  ],
  // 6-2
  62: [
    {
      metric: 'defeat',
      amount: 3,
      sourceJp:
        'ボス艦隊旗艦の撃沈で3分の1減少（与ダメージでは減少しない）／3回撃沈で海域クリア／ゲージ破壊前の特殊編成はなし',
    },
  ],
  // 6-3
  63: [
    {
      metric: 'defeat',
      amount: 4,
      sourceJp: 'ボス艦隊旗艦の撃沈で4分の1減少／4回撃沈で海域クリア',
    },
  ],
  // 6-4：Boss 是陆上型，原文用「破壊」，计的仍是击破次数
  64: [
    {
      metric: 'defeat',
      amount: 5,
      sourceJp: 'ボス艦隊旗艦の破壊で5分の1減少／5回破壊でクリア',
    },
  ],
  // 6-5
  65: [
    {
      metric: 'defeat',
      amount: 6,
      sourceJp:
        'ボス艦隊は連合艦隊編成(主力艦隊と護衛部隊の計12隻)／・夜戦相手は彼我の損害状況により敵の護衛部隊(第二艦隊)または主力艦隊となる。／・ゲージは空母棲姫を倒す以外では減少しないため、夜戦で倒す場合は護衛部隊を砲撃戦までにほぼ全滅させる必要がある。／ボス艦隊旗艦の撃沈で6分の1減少（与ダメージでは減少しない）／6回撃沈で海域クリア',
    },
  ],
  // 7-1
  71: [
    {
      metric: 'defeat',
      amount: 3,
      sourceJp: 'ボス艦隊旗艦の撃沈で1/3減少（与ダメージでは減少しない）／3回撃沈で海域クリア',
    },
  ],
  // 7-2：双段
  72: [
    {
      metric: 'defeat',
      amount: 3,
      sourceJp:
        '戦力ゲージ(Gマス)／ボス艦隊旗艦の撃沈で1/3減少（与ダメージでは減少しない)／3回撃沈でゲージ破壊、H～Mマスが出現',
    },
    {
      metric: 'defeat',
      amount: 4,
      sourceJp:
        '戦力ゲージ(Mマス)／ボス艦隊旗艦の撃沈で1/4減少（与ダメージでは減少しない)／4回撃沈で海域クリア',
    },
  ],
  // 7-3：双段
  73: [
    {
      metric: 'defeat',
      amount: 3,
      sourceJp:
        '戦力ゲージ(Eマス)／ボス艦隊旗艦の撃沈で1/3減少（与ダメージでは減少しない)／3回撃沈でゲージ破壊、G～Pマスが出現',
    },
    {
      metric: 'defeat',
      amount: 4,
      sourceJp:
        '戦力ゲージ(Pマス)／ボス艦隊旗艦の撃沈で1/4減少（与ダメージでは減少しない)／4回撃沈で海域クリア',
    },
  ],
  // 7-4
  74: [
    {
      metric: 'defeat',
      amount: 5,
      sourceJp: 'ボス艦隊旗艦の撃沈で5分の1減少／5回撃沈でクリア',
    },
  ],
  // 7-5：三段共八次击破，主数据那个 2 只是第一段。页内原文「戦力ゲージ3本のトリプルゲージ」。
  // （第二段那一格的表头在原站写作「第ニゲージ」，二是片假名ニ，是原站的错字，与内容无关。）
  75: [
    {
      metric: 'defeat',
      amount: 2,
      sourceJp: '戦力ゲージ(Kマス)／ボス艦隊旗艦の撃沈で1/2減少*1／2回撃沈でゲージ破壊、L～Qマスが出現',
    },
    {
      metric: 'defeat',
      amount: 3,
      sourceJp:
        '第三ゲージ出現ギミックあり。／・MマスS勝利1回／ギミッククリア後、R~Tマスが出現／戦力ゲージ(Qマス)／ボス艦隊旗艦(陸上型)の破壊で1/3減少*2／3回撃沈でゲージ破壊',
    },
    {
      metric: 'defeat',
      amount: 3,
      sourceJp: '戦力ゲージ(Tマス)／ボス艦隊旗艦の撃沈で1/3減少*3／3回撃沈で海域クリア',
    },
  ],
}

/** 表里有这张图就给它的分段，没有就给空数组——**没有就什么都不显示**，不猜。 */
export const mapGaugeSegments = (mapId: number): readonly MapGaugeSegment[] =>
  MAP_GAUGE_SEGMENTS[mapId] ?? []

/**
 * 一段计量条的标签零件。拆成四块是为了让展示端能只把数值加粗，
 * 而不必在渲染处再拼一遍文案——文案只有这一份。
 */
export interface MapGaugeSegmentLabel {
  /** 多段图的段序，如「第一段」；单段图为空串 */
  lead: string
  /** 数值前的部分，如「需击破」 */
  head: string
  amount: number
  /** 数值后的部分，如「次」；输送类为空串 */
  tail: string
}

const HEAD: Record<MapGaugeMetric, string> = {
  defeat: '需击破',
  arrival: '需到达终点',
  transport: '需输送 TP',
}

const TAIL: Record<MapGaugeMetric, string> = {
  defeat: '次',
  arrival: '次',
  transport: '',
}

const SEGMENT_ORDINAL = ['第一段', '第二段', '第三段', '第四段', '第五段']
const SEGMENT_COUNT_CN = ['', '', '两段', '三段', '四段', '五段']

export const mapGaugeSegmentLabels = (mapId: number): MapGaugeSegmentLabel[] => {
  const segments = mapGaugeSegments(mapId)
  const multi = segments.length > 1
  return segments.map((segment, index) => ({
    lead: multi ? (SEGMENT_ORDINAL[index] ?? `第${index + 1}段`) : '',
    head: HEAD[segment.metric],
    amount: segment.amount,
    tail: TAIL[segment.metric],
  }))
}

/** 一段的纯文本，如「第二段 · 需击破 2 次」。 */
export const mapGaugeLabelText = (label: MapGaugeSegmentLabel): string =>
  `${label.lead ? `${label.lead} · ` : ''}${label.head} ${label.amount}${label.tail ? ` ${label.tail}` : ''}`

/**
 * 摘要行（悬停卡那种一行说清的地方）。
 * 单段就是那一段；多段先报段数再按攻略顺序串起来，段序改用箭头表示，不重复「第几段」。
 * 表里没有的图给空串。
 */
export const mapGaugeSummaryText = (mapId: number): string => {
  const segments = mapGaugeSegments(mapId)
  if (!segments.length) return ''
  const labels = mapGaugeSegmentLabels(mapId)
  const bare = labels.map((label) => mapGaugeLabelText({ ...label, lead: '' }))
  if (bare.length === 1) return bare[0]
  const count = SEGMENT_COUNT_CN[bare.length] ?? `${bare.length} 段`
  return `${count} · ${bare.join(' → ')}`
}

/** 表里收了哪些图（诊断/护栏用，按海域编号排好序）。 */
export const mapGaugeMetricCodes = (): string[] =>
  Object.keys(MAP_GAUGE_SEGMENTS)
    .map(Number)
    .sort((left, right) => left - right)
    .map(mapCodeOf)
