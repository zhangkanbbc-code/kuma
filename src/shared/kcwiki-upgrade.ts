// kcwiki-ships 的「改造」需求串解析。
//
// `改造.图纸` 这个字段名有误导性：它装的不是图纸数量，而是**整串改造消耗**，
// 形如「高速建造材x30 开发资材x180」，也可能真的是「改装设计图x2」。
// 直接 parseInt 会得到 NaN——所有拿它当数字用的地方都会算错。

/** kcwiki 简中道具名 → api_mst_useitem id。
 *  改造需求串与任务奖励文本共用（两处都是 kcwiki 简中意译口径）。
 *  同一 id 的多个写法：排在前面的是展示用的规范名，后面是文本变体。 */
export const KCWIKI_ITEM_ALIAS: Record<string, number> = {
  改装设计图: 58,
  战斗详报: 78,
  试制甲板用弹射器: 65,
  新型兵装资材: 94,
  新型火炮兵装资材: 75,
  新型航空兵装资材: 77,
  海外舰最新技术: 100,
  工厂资源: 104,
  开发资材: 3, // 持有数住在 materials
  高速建造材: 2,
  熟练搭乘员: 70,
  勋章: 57,
  补强增设: 64,
  司令部要员: 63,
  新型航空机设计图: 74,
  新型喷进装备开发资材: 92,
  // 任务奖励文本的变体（2026-08-11 全库扫描）：给粮舰按舰名简称、
  // ネ式エンジン按半意译、航空「机/器」两写
  间宫: 54, // 給糧艦「間宮」
  伊良湖: 59, // 給糧艦「伊良湖」
  Ne式引擎: 71, // ネ式エンジン
  新型航空器设计图: 74,
}

// kcwiki 的改造需求字符串偶尔会混入“装备”而非道具。
// 必须按 slotitem 对齐，否则会以 unknown 身份绕过 API/wikiwiki 的覆盖键而重复显示。
export const KCWIKI_EQUIP_ALIAS: Record<string, number> = {
  新型高温高压锅炉: 87,
  '桶(运输用)': 75, // ドラム缶(輸送用)：kcwiki 任务文本的简称（本地化层叫「鼓筒」）
  // 増設バルジ：kcwiki 任务文本叫「增设装甲」，本地化层叫「增设防雷鼓包」
  '增设装甲(中型舰)': 72,
  '增设装甲(大型舰)': 73,
  '舰本新设计增设装甲板(大型舰)': 204, // 艦本新設計 増設バルジ(大型艦)
  '舰本新设计增设装甲板(中型舰)': 203, // 同上的中型版：B92/B95 的奖励文本这么写
  // 任务奖励文本的意译/笔误变体（2026-08-11 全库扫描核对 master 定的）
  '潜水艇搭载电探&防水式望远镜': 210, // 潜水艦搭載電探&水防式望遠鏡：艇/舰、水防/防水两处意译
  '零式舰战64型(制空战斗机机型)': 486, // 零式艦戦64型(制空戦闘機仕様)：仕様→机型
  // B165 文本写「(55战队)」并自注「请务必选择65队」——master 只有 65戦隊（id 224），
  // 55 是源文笔误，按译者自己的注对齐
  '爆装一式战隼III型改(55战队)': 224,
  // 奖励文本与译名表用了不同的译法/写错了字，名字对不上就只能按原文摆一块残渣。
  // 2026-08-28 全库奖励区扫描逐条核对 master 定的（括号是任务原文里的写法）：
  '一式彻甲弹': 116, // 一式徹甲弾（译名表作「一式穿甲弹」）B31/B32
  '改良型舰本式叶轮机': 33, // 改良型艦本式タービン（译名表作「改良型舰船涡轮机」）B89
  '九四式暴雷投射机': 44, // 九四式爆雷投射機——「暴」是源文错字 D43
  '潜水舰53cm舰首鱼雷(8门)': 95, // 潜水艦53cm艦首魚雷(8門)（译名表作「潜艇…」）D13/D14
  '战斗粮食(特制饭团)': 241, // 戦闘糧食(特別なおにぎり)（译名表作「特别饭团」）A83/A91/F60
  // 译名表作「炫光迷彩制式」。对不上时前缀「35.6cm连装炮改」照样命中，
  // 于是 B190 把改三无声换成了改（数量还对得上，三选一里一点破绽都没有）
  '35.6cm连装炮改三(炫光迷彩规格)': 502,
}

export const kcwikiUpgradeNeedAlias = (
  name: string,
): { kind: 'useitem' | 'slotitem'; id: number } | null => {
  const equipId = KCWIKI_EQUIP_ALIAS[name]
  if (equipId != null) return { kind: 'slotitem', id: equipId }
  const itemId = KCWIKI_ITEM_ALIAS[name]
  return itemId == null ? null : { kind: 'useitem', id: itemId }
}

export interface KcwikiNeed {
  name: string
  count: number
  kind: 'useitem' | 'slotitem' | 'unknown'
  id?: number
}

/**
 * 把「名称xN 名称xN」串解析成逐项需求。
 *
 * 对不上别名表的项 kind 为 'unknown'、没有 id——**调用方必须把它当"不知道"**，
 * 照原样显示并标注，绝不能拿别的库存去替它下「够 / 不足」的断言。
 */
export const parseKcwikiNeeds = (raw: unknown): KcwikiNeed[] => {
  const out: KcwikiNeed[] = []
  for (const match of String(raw ?? '').matchAll(/([^\sx×]+)\s*[x×]\s*(\d+)/g)) {
    const name = match[1]
    const count = parseInt(match[2], 10) || 1
    const alias = kcwikiUpgradeNeedAlias(name)
    out.push({ name, count, kind: alias?.kind ?? 'unknown', ...(alias ? { id: alias.id } : {}) })
  }
  return out
}
