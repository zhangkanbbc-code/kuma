// 季节收集企划检测——海图活动之外的「攒道具换东西」型企划（万圣节南瓜、
// 秋刀魚祭、节分の豆……）的公共地基。铎在活动图撤场后据此切换到企划视图。
//
// 口径（数据诚实）：
// - 收集道具**常驻** api_mst_useitem（南瓜一年四季都在主数据里），所以
//   「主数据里有」不构成企划开闭信号。进行中的证据是实测的两条：现役任务
//   列表里有任务点名该道具（游戏原文 title/detail 为准，中文目录文本为辅），
//   或持有数>0。后者也算数，因为道具不跨企划保留——活动结束服务器全量清零
//   （用户实测口径，2026-08-10）；持有>0 只可能是企划仍在进行（例如当期任务
//   已全部做完领完），或本地镜像尚未同步到清零，同步到的那一刻自然退场。
// - 注册表按**精确日文名**对主数据解析 id，绝不硬编码 id；解析不到就整条
//   跳过（比照 kanso-quest-rules 的实体解析纪律）。
// - 企划的截止日期与兑换目录只在游戏内公告，这里不猜——展示层如实标注。
import { questAnnualMonth, questPeriodFromCode } from './quest-period'

import type { QuestPeriodKind } from './quest-period'

export interface SeasonalItemSpec {
  key: string
  jpName: string // api_mst_useitem 精确名，用于解析 id
  zhLabel: string
  seasonNote: string // 历届出现的时节，仅作提示；不写死日期
  textAliases: string[] // 任务文本（日文原文/中文目录）里可能出现的写法
  excludeAliases?: string[] // 匹配前先从文本剔除的复合词（如秋刀魚の缶詰是另一个道具）
}

// 历届收集企划的道具（api_mst_useitem usetype=4 里人工圈定；勲章/司令部要員
// 这类同 usetype 的非企划道具不收）。新企划上线若用了新道具，在这里加一行。
export const SEASONAL_ITEMS: SeasonalItemSpec[] = [
  { key: 'pumpkin', jpName: '南瓜', zhLabel: '南瓜', seasonNote: '万圣节前后', textAliases: [] },
  { key: 'sanma', jpName: '秋刀魚', zhLabel: '秋刀鱼', seasonNote: '秋季渔期', textAliases: ['秋刀鱼'],
    excludeAliases: ['秋刀魚の缶詰', '秋刀魚缶詰', '秋刀鱼罐头', '秋刀魚「蒲焼」缶詰'] },
  { key: 'iwashi', jpName: '鰯', zhLabel: '沙丁鱼', seasonNote: '秋季渔期', textAliases: ['沙丁鱼'] },
  { key: 'setsubun', jpName: '節分の豆', zhLabel: '节分豆', seasonNote: '节分（2 月初）', textAliases: ['节分の豆', '节分豆'] },
  { key: 'choco', jpName: '艦娘からのチョコ', zhLabel: '舰娘巧克力', seasonNote: '情人节', textAliases: ['チョコ', '巧克力'] },
  { key: 'hishimochi', jpName: '菱餅', zhLabel: '菱饼', seasonNote: '雏祭（3 月初）', textAliases: ['菱饼'] },
  { key: 'umeboshi', jpName: '梅干', zhLabel: '梅干', seasonNote: '初夏', textAliases: [] },
  { key: 'rice', jpName: 'お米', zhLabel: '米', seasonNote: '初夏', textAliases: [] },
  { key: 'nori', jpName: '海苔', zhLabel: '海苔', seasonNote: '初夏', textAliases: [] },
  { key: 'tea', jpName: 'お茶', zhLabel: '茶', seasonNote: '初夏', textAliases: [] },
  { key: 'teruteru', jpName: 'てるてる坊主', zhLabel: '晴天娃娃', seasonNote: '梅雨', textAliases: ['晴天娃娃'] },
  { key: 'kazari', jpName: 'お飾り材料', zhLabel: '门松装饰材料', seasonNote: '正月', textAliases: ['飾り材料'] },
  { key: 'ribbon', jpName: '海色リボン', zhLabel: '海色缎带', seasonNote: '周年庆', textAliases: ['海色缎带'] },
  { key: 'tasuki', jpName: '白たすき', zhLabel: '白襷', seasonNote: '周年庆', textAliases: ['白襷'] },
]

// 任务周期：常设周期沿用 quest-period 的编码口径；kcwiki 给期间限定任务的
// 编码带年月数字前缀（如 2605B2）或 S 前缀；没有目录条目就如实说不知道。
export type CampaignQuestPeriod = QuestPeriodKind | 'limited' | 'once' | 'unknown'

export const campaignQuestPeriod = (
  code: string | null | undefined,
  resetNote = '',
): CampaignQuestPeriod => {
  const text = `${code ?? ''}`
  if (!text) return 'unknown'
  if (/^\d/.test(text) || text.startsWith('S')) return 'limited'
  return questPeriodFromCode(text, resetNote) ?? (questAnnualMonth(resetNote) ? 'annual' : 'once')
}

export interface SeasonalUseitemMst {
  id: number
  name: string
}

export interface SeasonalQuestSource {
  no: number
  title?: string
  detail?: string
}

export interface SeasonalCatalogEntry {
  code?: string
  text?: string // 目录里的中文正文/奖励段拼串，作为原文之外的补充匹配面
  resetNote?: string // memo2（年常月份线索）
}

export interface CampaignQuest {
  no: number
  period: CampaignQuestPeriod
}

export interface SeasonalCampaign {
  key: string
  itemId: number
  jpName: string
  zhLabel: string
  seasonNote: string
  stock: number // 道具随企划结束清零，持有>0 本身即进行中的证据
  quests: CampaignQuest[]
}

// 返回的每一条都是进行中的企划：任一信号（任务点名 / 持有>0）成立才会发出。
export const detectSeasonalCampaigns = (input: {
  useitemMst: SeasonalUseitemMst[]
  useitems: Record<number, number>
  quests: SeasonalQuestSource[]
  catalogOf?: (no: number) => SeasonalCatalogEntry | null
}): SeasonalCampaign[] => {
  const idByName = new Map(input.useitemMst.map((u) => [u.name, u.id]))
  const out: SeasonalCampaign[] = []
  for (const spec of SEASONAL_ITEMS) {
    const itemId = idByName.get(spec.jpName)
    if (itemId == null) continue
    const stock = Number(input.useitems[itemId]) || 0
    const needles = [spec.jpName, ...spec.textAliases]
    const quests: CampaignQuest[] = []
    for (const quest of input.quests) {
      if (!(quest.no > 0)) continue
      const catalog = input.catalogOf?.(quest.no) ?? null
      let hay = `${quest.title ?? ''}\n${quest.detail ?? ''}\n${catalog?.text ?? ''}`
      for (const excluded of spec.excludeAliases ?? []) hay = hay.split(excluded).join('')
      if (!needles.some((needle) => hay.includes(needle))) continue
      quests.push({ no: quest.no, period: campaignQuestPeriod(catalog?.code, catalog?.resetNote) })
    }
    if (stock <= 0 && quests.length === 0) continue
    out.push({
      key: spec.key,
      itemId,
      jpName: spec.jpName,
      zhLabel: spec.zhLabel,
      seasonNote: spec.seasonNote,
      stock,
      quests,
    })
  }
  return out
}

// 「限时」与钦的时效标签同词；不用日语借形「期间限定」（渲染层护栏禁用）
export const CAMPAIGN_PERIOD_LABEL: Record<CampaignQuestPeriod, string> = {
  daily: '日常',
  weekly: '周常',
  monthly: '月常',
  quarterly: '季常',
  annual: '年常',
  limited: '限时',
  once: '单发',
  unknown: '目录未收录',
}
