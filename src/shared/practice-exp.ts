// 演习能拿多少经验。
//
// 出击的基础经验是**逐点固定值**（游戏不下发，只能靠资料包逐点收），
// 而演习不一样——它有公开的闭式公式，输入只有**对手旗舰与 2 号舰的等级**，
// 这两样在开战前就摆在对手详情里。所以这是少数能在打之前算准的数。
//
// 口径抄自 wikiwiki「演習」（2026-08-09 核对）：
//
//   补正前经验 = (旗舰Lv 的累计经验)/100 + (2 号舰Lv 的累计经验)/300
//   补正前 ≤ 500 → 基本经验 = 补正前 × 评价补正
//   补正前 > 500 → 基本经验 = {500 + √(补正前 − 500)} × 评价补正
//
// 司令部等级、我方等级、对手第 3 舰以后都（几乎）不影响。
// 页面另注「实际值还会加上 0～3 左右」——那一截来源不明，不去凑。
//
// 用该页自带的「基本経験値表」逐格验过：旗舰 Lv1 那一行 19 个采样点全中，
// 含走 √ 分支的 Lv110~150 段。

/** 战斗评价对经验的倍率（wikiwiki「経験値」別表）。演习**败北**侧倍率另有说法，不收。 */
export const PRACTICE_RANK_BONUS: Record<string, number> = {
  S: 1.2,
  A: 1.0,
  B: 1.0,
}

/**
 * 基本经验（评价补正**前**）。
 *
 * @param cumulativeExpOf 等级 → 达到该级的累计经验（ship-exp 矿脉包的第二个值）。
 *                        查不到就返回 null——宁可不显示，也不拿别的等级凑。
 */
export const practiceBaseExp = (
  flagshipLevel: number,
  secondLevel: number | null,
  cumulativeExpOf: (level: number) => number | null | undefined,
): number | null => {
  const flagCum = cumulativeExpOf(flagshipLevel)
  if (flagCum == null || !Number.isFinite(flagCum)) return null
  // 单舰对手按「2 号舰 Lv1」算（wikiwiki 明写：単艦の場合は 2 隻目 Lv1 と同様）
  const secondCum = secondLevel == null ? 0 : cumulativeExpOf(secondLevel)
  if (secondCum == null || !Number.isFinite(secondCum)) return null
  const raw = flagCum / 100 + secondCum / 300
  return raw <= 500 ? raw : 500 + Math.sqrt(raw - 500)
}

/** 某个评价下**结果画面显示的**基础经验（= 基本经验 × 评价补正，向下取整）。 */
export const practiceExpForRank = (baseExp: number | null, rank: string): number | null => {
  const bonus = PRACTICE_RANK_BONUS[rank]
  if (baseExp == null || bonus == null) return null
  return Math.floor(baseExp * bonus)
}

export type TrainingCruiserPlacement = 'none' | 'flagship' | 'escort' | 'both'

/**
 * 练习巡洋舰（香取 / 鹿島 / 朝日，舰种 CT）带来的经验加成，单位是百分比。
 *
 * 表抄自 wikiwiki「香取」的演习一节。两处**照抄它的保留**：
 *   · 旗舰+随伴时只看**旗舰**的练度（随伴练度不参与）；
 *   · 随伴 2 只那一档页面明写「未検証」，所以按「随伴 1 只」给下界，
 *     不去用那组带问号的数字冒充确定值。
 */
export const trainingCruiserBonusPct = (
  placement: TrainingCruiserPlacement,
  level: number,
): number => {
  if (placement === 'none') return 0
  const tier = level <= 9 ? 0 : level <= 29 ? 1 : level <= 59 ? 2 : level <= 99 ? 3 : 4
  const table: Record<Exclude<TrainingCruiserPlacement, 'none'>, number[]> = {
    flagship: [5, 8, 12, 15, 20],
    escort: [3, 5, 7, 10, 15],
    both: [10, 13, 16, 20, 25],
  }
  return table[placement][tier]
}

/** 练习巡洋舰的舰种（api_stype）。朝日改改了舰种，因此自动不算——与 wiki 的说明一致。 */
export const TRAINING_CRUISER_STYPE = 21

export interface TrainingCruiserSetup {
  placement: TrainingCruiserPlacement
  level: number
  bonusPct: number
}

/**
 * 从一列**按舰队位序**排好的舰（0 位 = 旗舰）判定练巡配置。
 * 「旗舰+随伴」只看旗舰练度；只有随伴时取练度最高的那只——
 * 与 trainingCruiserBonusPct 抄的 wikiwiki 香取页同一口径。
 * di 的演习预测卡与 ru 的场次换算、账本的样本归一共用这一份，别各写各的。
 */
export const trainingCruiserSetup = (
  ships: { stype: number | null | undefined; lv: number }[],
): TrainingCruiserSetup => {
  const isTc = (index: number) => ships[index]?.stype === TRAINING_CRUISER_STYPE
  const flagIsTc = ships.length > 0 && isTc(0)
  const escortTcs = ships.map((_, index) => index).filter((index) => index > 0 && isTc(index))
  const placement: TrainingCruiserPlacement = flagIsTc
    ? escortTcs.length
      ? 'both'
      : 'flagship'
    : escortTcs.length
      ? 'escort'
      : 'none'
  const level =
    placement === 'none'
      ? 0
      : placement === 'escort'
        ? Math.max(...escortTcs.map((index) => ships[index]!.lv))
        : ships[0]!.lv
  return { placement, level, bonusPct: trainingCruiserBonusPct(placement, level) }
}
