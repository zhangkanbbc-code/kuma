// 「这件东西，我自己造/开出来过几次，用的什么配方」——把按配方组织的工厂实测
// 反查成按结果的答案。
//
// 账本里的工厂统计是**配方 → 结果**（史的工厂实测就是这么摆的），而站在
// 图鉴的某件装备或某艘舰面前，想问的是反过来那一句。两边是同一份数据，
// 差的只是一次反查。
//
// 与 wiki 的开发配方表**不合并**：那张表按「秘书舰类型 × 最大资材表」组织，
// 是社区大样本的推定值；这里是你自己的确认结果。口径不同、样本量差几个数量级，
// 摆在一起会让人以为百分比可比。所以并列，不相乘、不校正。

// ---- 秘书舰类型（开发方向）----
//
// 同一配方在不同秘书舰下滚的是**不同的开发表**，回顾里不分开就没法和配方表对上。
// 分类口径：wikiwiki「開発」页（实证 2026-08-10）——
//   砲戦系 = 戦艦・高速戦艦・重巡・工作艦
//   水雷系 = 軽巡・雷巡・練巡・駆逐・海防・補給
//   空母系 = 航空戦艦・正規空母・装甲空母・軽空母・航空巡洋艦・水上機母艦・揚陸艦
//   潜水系 = 潜水艦・潜水空母・潜水母艦
// 三个反直觉的归属别「修正」：航戦・航巡在空母系，工作艦在砲戦系，補給艦在水雷系。
// 字符串与 dev-recipes 矿脉包的 secretary 字段同一套（lode-validation 的白名单）。
export type DevSecretaryType = '砲戦系' | '水雷系' | '空母系' | '潜水系'

const DEV_SECRETARY_BY_STYPE: Record<number, DevSecretaryType> = {
  5: '砲戦系', 8: '砲戦系', 9: '砲戦系', 19: '砲戦系',
  1: '水雷系', 2: '水雷系', 3: '水雷系', 4: '水雷系', 21: '水雷系', 22: '水雷系',
  6: '空母系', 7: '空母系', 10: '空母系', 11: '空母系', 16: '空母系', 17: '空母系', 18: '空母系',
  13: '潜水系', 14: '潜水系', 20: '潜水系',
}

/** 舰种 → 开发表。未覆盖的舰种返回 null，宁缺毋滥。 */
export const devSecretaryTypeOf = (stype: number): DevSecretaryType | null =>
  DEV_SECRETARY_BY_STYPE[stype] ?? null

/**
 * 某张资材表下这件装备的**理论最省参考配方**。
 *
 * 两条都是 wikiwiki「開発」页的明文规则，不是社区玄学：
 * - 投入必须满足开发理論値 = 该装备廃棄返还資材 ×10（每项下限 10）；
 * - 四项投入中**最大**的一项决定滚哪张表（「钢/燃」两种最高走同一张，这里按钢给例）。
 * 于是把目标表的资材抬到严格最高、其余压在理論値上就是最省投入。
 * 推导验证（2026-08-11）：46cm三連装砲 廃棄 [0,24,25,0] → 弹药表 10/251/250/10，
 * 与社区流传的经典配方完全一致。
 *
 * @param broken api_broken（廃棄返还 [燃,弹,钢,铝]）
 * @param table dev-recipes 矿脉的表名：'钢/燃' | '弹药' | '铝'
 * @returns [燃,弹,钢,铝]；数据缺失时 null——宁可不显示，不硬造
 */
export const devReferenceRecipe = (
  broken: number[] | null | undefined,
  table: string,
): number[] | null => {
  if (!Array.isArray(broken) || broken.length < 4) return null
  const recipe = broken.slice(0, 4).map((v) => Math.max(10, (Number(v) || 0) * 10))
  const index = table === '弹药' ? 1 : table === '铝' ? 3 : table === '钢/燃' ? 2 : -1
  if (index < 0) return null
  const maxOther = Math.max(...recipe.filter((_, i) => i !== index))
  if (recipe[index] <= maxOther) recipe[index] = maxOther + 1
  return recipe
}

export interface FactoryRecipeLike {
  recipe: number[]
  attempts: number
  firstTs: number
  lastTs: number
  outcomes: { mstId: number; count: number }[]
  secretary?: string | null // 开发：当刻秘书舰的开发表；null=该维度上线前的老记录
}

export interface FactoryHitRecipe {
  recipe: number[]
  hits: number // 这个配方出过它几件
  attempts: number // 这个配方一共跑了多少次
  firstTs: number
  lastTs: number
  secretary?: string | null
}

export interface FactoryLookup {
  hits: number // 一共出过几件
  attempts: number // 出过它的那些配方合计跑了多少次
  totalAttempts: number // 该类（建造/开发）在账本里的全部尝试数
  recipes: FactoryHitRecipe[] // 出过它的配方，按命中数降序
}

/**
 * 反查某个结果。
 *
 * `attempts` 只累计**出过它的那些配方**——「我这个配方跑了 40 次出 3 件」
 * 是有用的分母，而把从没出过它的配方也算进去只会得到一个更小的、
 * 谁也解释不了的百分比。全量分母另给 `totalAttempts`，两个都摆出来。
 */
export const factoryLookup = (
  rows: FactoryRecipeLike[] | null | undefined,
  mstId: number,
): FactoryLookup => {
  const out: FactoryLookup = { hits: 0, attempts: 0, totalAttempts: 0, recipes: [] }
  if (!rows?.length || !(mstId > 0)) return out
  for (const row of rows) {
    out.totalAttempts += row.attempts
    let hits = 0
    for (const outcome of row.outcomes ?? []) {
      if (outcome.mstId === mstId) hits += outcome.count
    }
    if (!hits) continue
    out.hits += hits
    out.attempts += row.attempts
    out.recipes.push({
      recipe: row.recipe,
      hits,
      attempts: row.attempts,
      firstTs: row.firstTs,
      lastTs: row.lastTs,
      secretary: row.secretary ?? null,
    })
  }
  out.recipes.sort((a, b) => b.hits - a.hits || b.attempts - a.attempts)
  return out
}

/** 「30/30/20/10」。建造还带开发资材与大型标记，多出来的那几位一并写上。 */
export const recipeText = (recipe: number[] | null | undefined): string => {
  if (!recipe?.length) return '配方不详'
  const core = recipe.slice(0, 4).join('/')
  const devMat = recipe[4]
  const large = recipe[5]
  return `${core}${devMat ? ` · 开发资材 ${devMat}` : ''}${large ? ' · 大型' : ''}`
}
