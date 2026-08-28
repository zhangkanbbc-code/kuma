// 「非活动语境」推荐的固定用例矩阵——**护栏与金样本共用同一份输入**。
//
// 三期给陆航推荐接活动特効时，用户定的硬性要求是：目标点不是活动图就走纯二期逻辑，
// 零特効因子、零组合择优，**输出与二期逐字节一致**。要钉住这件事，就得有一份
// 二期代码亲手产出的金样本（`lbas-plain-golden.json`，2026-08-28 在 0c844c5 上采集，
// 那时特効还一行都没接进来），以及一份**两边都用**的输入矩阵——就是这个文件。
//
// 输入写在这里而不是抄进 JSON，是因为金样本要能被复核：
// 谁都可以把这份矩阵拿去跑一遍二期的 dist，得到的应当是同一份 JSON。

/** 主数据实测值（api_mst_slotitem）。t2 = api_type[2] */
export const PLANES = {
  ichishiki: { mstId: 169, name: '一式陸攻', type2: 47, torpedo: 10, bomb: 12, distance: 9, cost: 12, level: 0 },
  nonaka: { mstId: 170, name: '一式陸攻(野中隊)', type2: 47, torpedo: 12, bomb: 13, distance: 9, cost: 12, level: 0 },
  ginga: { mstId: 187, name: '銀河', type2: 47, torpedo: 14, bomb: 14, distance: 9, cost: 13, level: 0 },
  egusa: { mstId: 388, name: '銀河(江草隊)', type2: 47, torpedo: 15, bomb: 15, distance: 8, cost: 13, level: 0 },
  mosquito: { mstId: 479, name: 'Mosquito FB Mk.VI', type2: 47, torpedo: 5, bomb: 18, distance: 7, cost: 14, level: 0 },
  ki102: { mstId: 453, name: 'キ102乙', type2: 47, torpedo: 11, bomb: 19, distance: 4, cost: 9, level: 0 },
  hayabusa65: { mstId: 224, name: '爆装一式戦 隼III型改(65戦隊)', type2: 47, torpedo: 0, bomb: 9, distance: 5, cost: 4, level: 0 },
  daitei: { mstId: 138, name: '二式大艇', type2: 41, torpedo: 0, bomb: 0, distance: 20, cost: 25, level: 0 },
  catalina: { mstId: 178, name: 'PBY-5A Catalina', type2: 41, torpedo: 0, bomb: 0, distance: 10, cost: 13, level: 0 },
  rikutei: { mstId: 311, name: '二式陸上偵察機', type2: 49, torpedo: 0, bomb: 0, distance: 8, cost: 7, level: 0 },
  rikuteiSkilled: { mstId: 312, name: '二式陸上偵察機(熟練)', type2: 49, torpedo: 0, bomb: 0, distance: 8, cost: 7, level: 0 },
  miyama: { mstId: 396, name: '深山改', type2: 53, torpedo: 17, bomb: 19, distance: 11, cost: 21, level: 0 },
  smSkilled: { mstId: 1000, name: 'SM.79 bis(熟練)', type2: 47, torpedo: 13, bomb: 16, distance: 8, cost: 13, level: 0 },
  b25: { mstId: 1001, name: 'B-25', type2: 47, torpedo: 0, bomb: 16, distance: 7, cost: 12, level: 0 },
}

const stock = (entries) => entries.map(([key, count, level]) => ({
  ...PLANES[key],
  count,
  ...(level === undefined ? {} : { level }),
}))

const STOCKS = {
  mixed: stock([['nonaka', 4], ['egusa', 2], ['mosquito', 3], ['daitei', 1], ['rikutei', 1]]),
  shortLegged: stock([['ki102', 4], ['daitei', 1], ['catalina', 1]]),
  onlyGinga: stock([['ginga', 4]]),
  improved: stock([['egusa', 2, 6], ['nonaka', 4, 3], ['mosquito', 2, 10]]),
  scarce: stock([['egusa', 2], ['hayabusa65', 4]]),
  withRecon: stock([['nonaka', 3], ['rikuteiSkilled', 1], ['miyama', 1]]),
  cGroupLookalikes: stock([['smSkilled', 2], ['b25', 2], ['egusa', 4], ['mosquito', 2]]),
}

const TARGETS = ['surface', 'land', 'pillbox', 'isolated', 'supply']
const RADII = [null, 4, 7, 8, 9, 12]

/** 矩阵：库存 × 目标类型 × 目标半径 × 有没有回避档表 */
export const PLAIN_CASES = []
for (const [stockName, planes] of Object.entries(STOCKS)) {
  for (const target of TARGETS) {
    for (const targetRadius of RADII) {
      for (const withEvasion of [true, false]) {
        PLAIN_CASES.push({
          id: `${stockName}|${target}|${targetRadius ?? 'any'}|${withEvasion ? 'tiers' : 'notiers'}`,
          stock: planes,
          target,
          targetRadius,
          withEvasion,
        })
      }
    }
  }
}

/**
 * 一套方案的指纹。**数字一律原样落字符串，不做四舍五入**——
 * 这条护栏要钉的是「非活动语境一个字节都没动」，把 158.39999999999998
 * 归一成 158.4 就等于给漂移开了道缝。
 *
 * 存指纹而不是整份方案，只为让金样本看得懂：每格照 `mstId:角色:定数:威力:档位:耗铝`
 * 排一行，红的时候一眼看得出是哪一格、哪一项动了。
 */
export const planSignature = (plan) => {
  if (!plan) return 'null'
  const head = [
    `radius=${plan.radius}`,
    `power=${plan.power}`,
    `bauxite=${plan.bauxite}`,
    `reaches=${plan.reaches}`,
    `extender=${plan.usedExtender}`,
  ].join(' ')
  const slots = plan.slots.map((slot) =>
    [
      slot.plane.mstId,
      slot.role,
      slot.capacity,
      slot.power,
      slot.tier ?? '-',
      slot.tierRank,
      slot.bauxite,
      slot.weightedAa ?? '-',
      slot.fleetAa ?? '-',
      `d(${slot.detail.base},${slot.detail.afterAirBonus},${slot.detail.afterBombBonus},${slot.detail.capped},${slot.detail.gotBombBonus},${slot.detail.power})`,
    ].join(':'),
  )
  return `${head} | ${slots.join(' | ')}`
}
