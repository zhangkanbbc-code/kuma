import type { QpAction, QpTask } from '../../shared/qp-types'
import { destroyedSlotitemIds } from '../../shared/slotitem-mutation'

// EO 的追踪包主要覆盖带指定编成/海域的任务，基础日常、周常动作反而有不少空白。
// 这些回退规则只从本地 quests-scn 的任务正文提取「能由单个 API 事件可靠确认」的计数；
// 遇到复合阶段或指名目标时宁可不生成，避免把局部完成误报成整项完成。

const ACTION_RULES: {
  action: QpAction
  label: string
  kw: RegExp
  word: string
  require?: RegExp
  needObj?: boolean
}[] = [
  { action: 'powerup', label: '近代化改修', kw: /近代化改修/, word: '近代化改修' },
  { action: 'createitem', label: '开发装备', kw: /开发(?!资材)/, word: '开发', needObj: true },
  // 「大型舰建造/新型舰建造」是名词、「高速建造材」是道具，都不是「建造 N 艘」的动作。
  { action: 'createship', label: '建造舰娘', kw: /(?<!大型舰|新型舰|大型|新型|高速)建造(?!材)/, word: '建造', needObj: true },
  { action: 'destroyship', label: '解体舰娘', kw: /解体/, word: '解体', needObj: true },
  { action: 'destroyitem', label: '废弃装备', kw: /废弃/, word: '废弃', needObj: true },
  // 「补给线/补给舰/补给船」是战斗任务里的名词。
  { action: 'charge', label: '补给', kw: /补给(?!线|舰|船)/, word: '补给' },
  { action: 'nyukyo', label: '入渠', kw: /入渠/, word: '入渠' },
  // 装备改修必须发生在改修工厂（明石），否则「装备改修」只是句中语境。
  { action: 'remodel_slot', label: '装备改修', kw: /改修(?!资材)/, word: '改修', require: /改修工厂|明石/ },
]

// 分句里出现的引号词若超出这张结构词表，说明任务针对具体装备/舰娘，不做泛化计数。
const STRUCTURAL_QUOTED = new Set([
  '工厂',
  '开发',
  '建造',
  '解体',
  '废弃',
  '改修',
  '改修工厂',
  '装备',
  '装备改修',
  '新装备',
  '新舰娘',
  '大型舰建造',
  '出击',
  '补给',
  '入渠',
  '近代化改修',
  '装备道具',
])

// 分句里出现这些词 = 指定装备类别或远征域，交给 EO 规则；没有规则就明确降级。
const SPECIFIC_TARGET =
  /主炮|副炮|鱼雷|电探|机枪|机铳|爆雷|声呐|高角炮|舰战|舰爆|舰攻|水侦|水上侦察|陆攻|彻甲弹|三式弹|探照灯|司令部|设施|引擎|弹射器|发动艇|大发|资材|家具币|远征/
const GENERIC_OBJECT = /装备|装备道具|舰艇|舰娘|新舰/

const CN_DIGITS: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
}

const parseCount = (raw: string): number => {
  const token = raw.normalize('NFKC')
  if (/^\d+$/.test(token)) return parseInt(token, 10)
  if (token.length === 1) return CN_DIGITS[token] ?? 1
  if (token.startsWith('十')) return 10 + (CN_DIGITS[token[1]] ?? 0)
  if (token.endsWith('十')) return (CN_DIGITS[token[0]] ?? 1) * 10
  const [tens, ones] = token.split('十')
  return (CN_DIGITS[tens] ?? 1) * 10 + (CN_DIGITS[ones] ?? 0)
}

const COUNT_TOKEN = String.raw`(\d+|[一二两三四五六七八九十]+)`

const UNSAFE_SORTIE =
  /海域|BOSS|S胜|A胜|B胜|旗舰|编成|阵容|前置|空母|补给舰|潜(水艇|艇|水舰)|输送|运输|各一次|分别/i

export const deriveSortieTasks = (code: string, memo2: string): QpTask[] => {
  if (!code.startsWith('B') || !memo2) return []
  const text = memo2.normalize('NFKC').replace(/\s+/g, '')
  if (UNSAFE_SORTIE.test(text)) return []

  const win = text.match(new RegExp(`^出击胜利(?:${COUNT_TOKEN})?次?$`))
  if (win) {
    return [{ kind: 'battleWin', rank: 4, count: win[1] ? parseCount(win[1]) : 1 }]
  }

  const battles = text.match(new RegExp(`^${COUNT_TOKEN}场战斗`))
  if (battles) {
    return [{ kind: 'battleWin', rank: 0, count: parseCount(battles[1]) }]
  }

  const sortie = text.match(new RegExp(`^出击(?:${COUNT_TOKEN})?次?[（(]失败可完成[）)]`))
  if (sortie) {
    return [{ kind: 'battleWin', rank: 0, count: sortie[1] ? parseCount(sortie[1]) : 1 }]
  }

  return []
}

export const deriveActionTasks = (desc: string): QpTask[] => {
  if (!desc) return []
  // 不按括号切分：「桶(运输用)」这类带括号的装备名会被切碎，导致引号闸门失效。
  const normalized = desc.normalize('NFKC')
  const clauses = normalized.split(/[。！!，,、；;：:\n]/)
  const tasks: QpTask[] = []
  for (const rule of ACTION_RULES) {
    if (rule.require && !rule.require.test(normalized)) continue
    // 近代化改修已计则不再计装备改修（前者含「改修」二字）。
    if (rule.action === 'remodel_slot' && tasks.some((task) => task.kind === 'action' && task.action === 'powerup')) continue
    let best: { count: number; explicit: boolean; unit: string } | null = null
    for (const clause of clauses) {
      if (!rule.kw.test(clause)) continue
      const quoted = [...clause.matchAll(/[「『“"]([^」』”"]+)[」』”"]/g)].map((match) => match[1].trim())
      if (quoted.some((value) => !STRUCTURAL_QUOTED.has(value))) continue
      if (SPECIFIC_TARGET.test(clause)) continue
      const at = clause.search(rule.kw)
      const near = clause.slice(Math.max(0, at - 8), at + 10)
      const countMatch = near.match(new RegExp(`${COUNT_TOKEN}\\s*(次|回|艘|只|个|架|件)`))
      const quotedAction = new RegExp(`[「『“"]${rule.word}[」』”"]|[「『“"]改修工厂[」』”"]`).test(clause)
      const imperative = new RegExp(`(?:进行|实施|尝试|成功)[^\\s]{0,4}${rule.word}`).test(clause)
      if (!quotedAction && !countMatch && !imperative) continue
      if (rule.needObj && !quotedAction && !GENERIC_OBJECT.test(clause)) continue
      if (!countMatch && /若干|尽可能|多余/.test(clause)) continue
      const count = countMatch ? parseCount(countMatch[1]) : 1
      if (!best || (countMatch && !best.explicit)) {
        best = { count, explicit: !!countMatch, unit: countMatch?.[2] ?? '' }
      }
    }
    if (!best) continue
    // 废弃装备按量词分流，与 kcwiki 的 batch 字段同一套口径（依据见 kcwiki-quest-rules
    // 的 decodeSimple）：正文写「N 个 / N 件」= 按件（一括廃棄 n 件 = +n），
    // 写「N 次 / N 回」或没写量词 = 按操作回数。本地 quests-scn 里两侧 8/8 与 batch 吻合。
    // 现状这一支够不着：命中的 8 条（604/610/611/612/624/625/634/635）都已有 kcwiki 结构化
    // 条目，装配时先到先得、散文层被整族遮住。留着是防 lodes 不同步——quests-scn 先收到新的
    // 废弃任务而 kcwiki-quest-req 还没有时，回退不至于把按件的任务算成按次而少计。
    const perItem = rule.action === 'destroyitem' && /[个件]/.test(best.unit)
    tasks.push({
      kind: 'action',
      action: rule.action,
      label: rule.label,
      count: best.count,
      ...(perItem ? { perItem: true as const } : {}),
    })
  }
  return tasks
}

const practiceRank = (text: string): number => {
  if (/S(?:判定|胜利|胜)|完全胜利/.test(text)) return 6
  if (/A(?:判定|胜利|胜)/.test(text)) return 5
  if (/B(?:判定|胜利|胜)|胜利|获胜|战胜/.test(text)) return 4
  return 0
}

const practiceCount = (text: string): number => {
  const match = text.match(new RegExp(`${COUNT_TOKEN}\\s*(?:次|回|场)(?:以上)?[^。！!\\n]{0,20}(?:演习|胜利)`))
    ?? text.match(new RegExp(`(?:演习|胜利)[^。！!\\n]{0,24}?${COUNT_TOKEN}\\s*(?:次|回|场)(?:以上)?`))
  return match ? parseCount(match[1]) : 1
}

export const derivePracticeTasks = (code: string, desc: string, memo = ''): QpTask[] => {
  if (!code.startsWith('C')) return []
  const text = `${desc} ${memo}`.normalize('NFKC')
  if (!/演习/.test(text)) return []
  // 演习之后还要求出击、废弃、搭载等动作的是复合任务。只记录演习阶段会让整项任务
  // 被提前判定完成，因此没有 EO 完整规则时明确不生成局部追踪器。
  if (/出击|废弃|解体|搭载|装备于|配置于|之后/.test(text)) return []
  return [{ kind: 'exercise', rank: practiceRank(text), count: practiceCount(text) }]
}

const GENERIC_EXPEDITION_CODES = new Set(['D1', 'Dd1', 'Dd2', 'Dw1'])

export const deriveExpeditionTasks = (code: string, desc: string, memo = ''): QpTask[] => {
  if (!GENERIC_EXPEDITION_CODES.has(code)) return []
  const text = `${desc} ${memo}`.normalize('NFKC')
  const countMatch = text.match(new RegExp(`${COUNT_TOKEN}\\s*(?:次|回)`))
  const count = countMatch ? parseCount(countMatch[1]) : 1
  if (code === 'D1') {
    return [{ kind: 'action', action: 'expedition_start', label: '派出远征', count }]
  }
  return [{ kind: 'expedition', missionId: 0, count }]
}

export interface DerivedFallbackTracker {
  tasks: QpTask[]
  partial: boolean
}

// 任务文本（任务库中文）与我们的类别展示名各有译法——展示名 2026-08-16 起
// 统一 kcwiki 直译系（舰上/爆击机），而任务文本沿用旧译。匹配索引因此同时收
// 展示中文、日文原名与历史别名：改展示口径不打断任务解析。
export const EQUIPTYPE_TEXT_ALIASES: ReadonlyArray<readonly [string, number]> = [
  ['舰载战斗机', 6],
  ['舰载轰炸机', 7],
  ['舰载攻击机', 8],
]

export const buildEquipTypeNameIndex = (
  entities: Record<string, { zh?: unknown; ja?: unknown }> | null | undefined,
): Map<string, number> => {
  const index = new Map<string, number>()
  if (entities && typeof entities === 'object') {
    for (const [idText, entry] of Object.entries(entities)) {
      const id = parseInt(idText, 10)
      if (!(id > 0)) continue
      for (const raw of [entry?.zh, entry?.ja]) {
        const name = typeof raw === 'string' ? raw.trim() : ''
        if (name && !index.has(name)) index.set(name, id)
      }
    }
    for (const [alias, id] of EQUIPTYPE_TEXT_ALIASES) {
      if (!index.has(alias)) index.set(alias, id)
    }
  }
  return index
}

export const deriveScrapCategoryTasks = (
  desc: string,
  equipTypeIds: ReadonlyMap<string, number>,
): QpTask[] => {
  if (!desc || !/废弃/.test(desc) || !equipTypeIds.size) return []
  const text = desc.normalize('NFKC')
  const tasks: QpTask[] = []
  for (const match of text.matchAll(/[「『“"]([^」』”"]+)[」』”"]/g)) {
    const name = match[1].trim()
    const category = equipTypeIds.get(name)
    if (!category || match.index == null) continue
    const sentenceBefore = text.slice(0, match.index)
    const sentenceStart = Math.max(
      sentenceBefore.lastIndexOf('。'),
      sentenceBefore.lastIndexOf('!'),
      sentenceBefore.lastIndexOf('；'),
      sentenceBefore.lastIndexOf(';'),
      sentenceBefore.lastIndexOf('\n'),
    ) + 1
    const sentenceTail = text.slice(match.index)
    const sentenceEndOffset = sentenceTail.search(/[。!；;\n]/)
    const sentenceEnd = sentenceEndOffset < 0 ? text.length : match.index + sentenceEndOffset
    if (!/废弃/.test(text.slice(sentenceStart, sentenceEnd))) continue
    const before = text.slice(Math.max(sentenceStart, match.index - 16), match.index)
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 20)
    const beforeCount = before.match(new RegExp(`${COUNT_TOKEN}\\s*(?:个|架|门|件)?\\s*$`))
    const afterCount = after.match(
      new RegExp(`^(?:系(?:的)?装备|系装备|装备)?\\s*[×xX*]\\s*${COUNT_TOKEN}`),
    )
    const rawCount = afterCount?.[1] ?? beforeCount?.[1]
    if (!rawCount) continue
    tasks.push({ kind: 'scrapCategory', category, count: parseCount(rawCount) })
  }
  return tasks
}

export const deriveFallbackTracker = (
  code: string,
  desc: string,
  memo = '',
  equipTypeIds: ReadonlyMap<string, number> = new Map(),
): DerivedFallbackTracker => {
  const categoryTasks = deriveScrapCategoryTasks(desc, equipTypeIds)
  return {
    tasks: [
      ...derivePracticeTasks(code, desc, memo),
      ...deriveSortieTasks(code, memo),
      ...deriveExpeditionTasks(code, desc, memo),
      ...categoryTasks,
      ...deriveActionTasks(desc),
    ],
    partial: categoryTasks.length > 0 && /准备|準備/.test(desc),
  }
}

export const actionIncrement = (
  action: QpAction,
  body: any,
  post: Record<string, string>,
  options: { perItem?: boolean } = {},
): number => {
  if (action === 'destroyship') {
    // 解体按**艘**计，不按操作回数：一次批量解体 n 艘 = +n，取请求里的 id 数正好。
    // 2026-08-27 用户实测 609「军缩条约对应！」（Fd5，memo2 写「解体舰船2次」）：
    // 一次批量解体 2 艘直接达成（账本 11:51:15 解体 2 艘 → 11:52:13 领奖），
    // 按操作回数只会 +1、永远差一格。顺带证伪 memo2 那栏的「次」不可当量词读。
    // （上游那句误译已于 2026-08-27 走 shared/quest-text-corrections 在加载期校正成
    //  「解体2艘舰船」；这里引的是**上游原文**，判定本来就不读那一栏。）
    return Math.max(1, `${post.api_ship_id ?? ''}`.split(',').filter(Boolean).length)
  }
  if (action === 'destroyitem') {
    if (options.perItem) {
      // batch:true 的那一族（624/625/634/635，正文写「N 个 / N 件」）按**件**计：
      // 一括廃棄 n 件 = +n。依据见 kcwiki-quest-rules 的 decodeSimple 注释。
      return Math.max(1, destroyedSlotitemIds(post).length)
    }
    // 「废弃装备 N 回」按**操作回数**计，不是件数：一括廃棄十件也只算 1 回。
    // 2026-08-27 用户实测 613「资源的再利用」（Fw1，memo2 写 24 次）：受领后先批量弃
    // 10+10+2 件，游戏进度连 50% 都没到（按件早该满），改逐件弃后在第 24 次操作达成。
    // 两家日文攻略同口径：「装備を24回廃棄する任務です。装備を24個廃棄する任務ではないので、
    // 複数装備を一括廃棄しても1回分としかカウントされません」
    // （gameranbu.jp/kancolle/201bfc6170b563d27a5c；irasuto-voice.com/archives/16193）。
    // 注意：这里只管「任意装备废弃 N 回」这一族。「××を2つ廃棄」那种指定装备件数任务
    // 走的是另一条路（quest-counter.ts 的 destroyitem2 分支按 scrapEquip/scrapCategory 逐件 +1），
    // 与本增量无关。
    return 1
  }
  if (action === 'createitem' && Array.isArray(body?.api_get_items)) {
    // 连续开发即使失败也占一个结果槽，任务明确写着失败同样计数。
    return Math.max(1, body.api_get_items.length)
  }
  return 1
}
