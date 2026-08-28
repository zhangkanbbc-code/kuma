// 任务奖励文本 → 结构化奖励项。
//
// 住在 shared 而不是钦（qn.ts）里，是因为这一段全是纯文本解析：任务库的奖励串
// 写法五花八门，判断对不对只能靠拿真串去跑，而钦是 renderer 模块（顶上 require
// 了 electron），测试根本 import 不进来。名字归一化（normalizeTaskEntityText）
// 住在渲染层，按依赖方向由调用方注入，别把 shared 反过来指向 renderer。
import { matchMaterialRewardName } from './useitem-stock'

export interface RewardStockCandidate {
  // raw：声明数量对不齐时按原文兜底的一项——名称没对上任何实体，
  // 照原样显示、不参与库存比较，绝不静默吞掉（用户 2026-08-11 抓到
  // 2605B3 第 1 组游戏里三选一、面板只列出两项）。
  kind: 'equip' | 'useitem' | 'material' | 'raw'
  id: number
  name: string
  stock: number
  amount: number
  /** 奖励自带的改修星级（「二式爆雷」★+4×1 的 4）；没写就没有 */
  star?: number
  start: number
  length: number
}

/** 参与匹配的一件东西：别名**已归一化**，stock 是调用方按各自存储域算好的持有数 */
export interface RewardParseEntity {
  id: number
  name: string
  aliases: string[]
  stock: number
}

export interface RewardParseContext {
  equips: RewardParseEntity[]
  useitems: RewardParseEntity[]
  /** 四资源持有量，index 0..3 = 燃料/弹药/钢材/铝土 */
  materialStock: (index: number) => number
  /** 名字归一化：与实体索引建别名时用的必须是同一个函数 */
  normalize: (text: string) => string
}

const HAN_CHOICE_COUNT: Record<string, number> = {
  二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
}
const hanCount = (han: string | undefined) => HAN_CHOICE_COUNT[han ?? ''] ?? 0

/** 一段奖励原文：固定段，或一个「选一」组 */
export interface QuestRewardSegment {
  text: string
  /** 文本自报的项数；0 = 没自报 */
  declared: number
}

export interface QuestRewardSplit {
  /** 固定奖励原文（选一组可能夹在中间，所以是多段） */
  fixedParts: string[]
  groups: QuestRewardSegment[]
}

// 任务库里「选一」有三种写法，且**选项在标记的哪一侧不一样**：
//   以下奖励三选一：A B C      → 选项在后，项数自报
//   从下列奖励中选择：A B      → 选项在后，项数没自报（B95/B88/B89/B109/A82）
//   A B 以上二者选择其一 C     → 选项在**前**，C 才是固定奖励（F54 一族九条）
// 只认第一种时，后两种整段落进「固定奖励」，提示语和引号被当成认不出的原文
// 补进面板——B95 的「从下列奖励中选择:「」「」」碎片就是这么来的
// （用户 2026-08-28 截图）。
const CHOICE_MARKERS: { re: RegExp; before?: true }[] = [
  { re: /以下奖励([二三四五六七八九])选一[:：]?/g },
  { re: /从下列奖励中(?:选择|选一)[:：]?/g },
  { re: /以上([二三四五六七八九])者(?:选择其一|选一)[:：]?/g, before: true },
]

/** 把奖励串切成固定段与选一组。纯文本，不碰实体名。 */
export const splitQuestReward = (memo: string): QuestRewardSplit => {
  const reward = memo.replace(/^奖励[:：]?\s*/, '')
  const markers = CHOICE_MARKERS.flatMap(({ re, before }) =>
    [...reward.matchAll(re)].map((hit) => ({
      start: hit.index ?? 0,
      end: (hit.index ?? 0) + hit[0].length,
      declared: hanCount(hit[1]),
      before: before === true,
    })),
  ).sort((a, b) => a.start - b.start)

  const fixedParts: string[] = []
  const groups: QuestRewardSegment[] = []
  const take = (raw: string, declared: number | null) => {
    const text = raw.trim()
    if (!text) return
    if (declared == null) fixedParts.push(text)
    else groups.push({ text, declared })
  }
  // open = 已经开着的「选项在后」组自报的项数；null = 当前这段是固定奖励
  let open: number | null = null
  let cursor = 0
  for (const marker of markers) {
    // 「选项在前」的标记：它前面那段就是组本身——除非已经有组开着，
    // 那段已经名花有主，这个标记只当分隔符用
    take(reward.slice(cursor, marker.start), marker.before && open == null ? marker.declared : open)
    open = marker.before ? null : marker.declared
    cursor = marker.end
  }
  take(reward.slice(cursor), open)
  return { fixedParts, groups }
}

// 兜底原文项的收拾。识别不出名字**不等于**那段文本能照单全收地当一项奖励摆出来：
//   ① 只剩引号括号的残渣要丢掉——面板上那个什么都没有的空芯片就是它；
//   ② 项本身的包裹引号要脱掉，芯片里不该出现裸的「」；
//   ③ 「择捉」「松轮」这种紧挨着的整组引号，是两项，不是一项。
const RAW_PAIRS: Record<string, string> = {
  '「': '」', '『': '』', '（': '）', '(': ')', '【': '】', '[': ']', '“': '”', '"': '"',
}
const CLOSE_TO_OPEN: Record<string, string> = Object.fromEntries(
  Object.entries(RAW_PAIRS).map(([open, close]) => [close, open]),
)
/** 去掉引号/括号/连接符后还剩几个字：不足两个就是残渣，不成其为一项奖励 */
const rawContentLength = (text: string) =>
  text.replace(/[「」『』（）()【】[\]"“”'’:：、，,;；。．・…\-—+*×x\s]/gi, '').length

const rawRewardPieces = (
  text: string,
  offset: number,
): { name: string; start: number; length: number }[] => {
  // 紧挨着的多组引号 = 多项
  const quoted = [...text.matchAll(/[「『]([^「」『』]*)[」』]/g)]
  if (quoted.length > 1 && quoted.reduce((sum, hit) => sum + hit[0].length, 0) === text.length) {
    return quoted
      .filter((hit) => rawContentLength(hit[1]) >= 2)
      .map((hit) => ({
        name: hit[1],
        start: offset + (hit.index ?? 0) + 1,
        length: hit[1].length,
      }))
  }
  // 收拾两头的引号括号，只动**不属于名字**的那些：
  //   · 落单的（对手被掩码抹掉了）：F46「喷气式歼击轰炸机「」、C73「三(炫光迷彩规格)」」
  //   · 成对包住整项的那层：「白雪」→ 白雪
  // 配得上对的一律留着——B87「秘密家具“…”」的收尾 ” 配的是里面那个 “，
  // B122「摩耶之盾挂轴(家具)」的括号是名字自带的
  let start = 0
  let end = text.length
  for (;;) {
    const inner = text.slice(start, end)
    if (!inner) break
    const first = inner[0]
    const last = inner[inner.length - 1]
    // 成对包住整项的那层，脱掉
    if (inner.length > 1 && RAW_PAIRS[first] === last && !inner.slice(1, -1).includes(last)) {
      start += 1
      end -= 1
      continue
    }
    // 尾巴上的开引号一定落单；尾巴上的闭引号要看前面有没有它的对手
    if (RAW_PAIRS[last] || (CLOSE_TO_OPEN[last] && !inner.slice(0, -1).includes(CLOSE_TO_OPEN[last]))) {
      end -= 1
      continue
    }
    // 开头的闭引号一定落单；开头的开引号要看后面有没有它的对手
    if (CLOSE_TO_OPEN[first] || (RAW_PAIRS[first] && !inner.slice(1).includes(RAW_PAIRS[first]))) {
      start += 1
      continue
    }
    break
  }
  const name = text.slice(start, end)
  return rawContentLength(name) >= 2
    ? [{ name, start: offset + start, length: name.length }]
    : []
}

/**
 * 一段奖励原文里的逐项奖励。
 *
 * `declared` 是文本自报的项数（「以下奖励三选一」的三）：识别出的比它少，
 * 就把没对上的原文按 token 补进来当 raw 项。0 = 文本没自报，此时同样跑补漏
 * （宁可多列一条原文，也不让一个选项从面板上消失）。
 */
export const parseQuestRewardItems = (
  source: string,
  declared: number,
  ctx: RewardParseContext,
): RewardStockCandidate[] => {
  const normalized = ctx.normalize(source)
  const candidates: RewardStockCandidate[] = []
  // 两阶段：先把**所有**实体名的出现位置收齐，再回头解析数量。
  // 归一化会抹掉空白，「高速修复材×6 25mm三连装机铳×2」黏成
  // 「高速修复材×625mm三连装机铳×2」——数量把邻项开头的口径数字整个吞掉，
  // 面板上冒出「×625」和乱码残渣「mm三连装机铳」（B143，2026-08-13 用户实锤）。
  // 数量截断的边界就是别的实体名起点：任何名字的开头都不许被圈进数量里。
  interface PendingEntity {
    kind: 'equip' | 'useitem'
    id: number
    rawName: string
    stock: number
    spots: { alias: string; start: number }[]
  }
  const pending: PendingEntity[] = []
  const nameStarts: number[] = []
  const addEntity = (
    kind: 'equip' | 'useitem',
    id: number,
    rawName: string,
    aliases: string[],
    stock: number,
  ) => {
    // 组内只列奖励项本身，两字机名（彗星/天山/彩云/瑞云…）是合法选项，
    // 门槛统一 2——正文全局匹配仍是装备 3 字起，别混为一谈
    const spots: { alias: string; start: number }[] = []
    for (const alias of aliases.filter((entry) => entry.length >= 2)) {
      for (let at = normalized.indexOf(alias); at >= 0; at = normalized.indexOf(alias, at + 1)) {
        spots.push({ alias, start: at })
        nameStarts.push(at)
      }
    }
    if (spots.length) pending.push({ kind, id, rawName, stock, spots })
  }
  for (const equip of ctx.equips) {
    addEntity('equip', equip.id, equip.name, equip.aliases, equip.stock)
  }
  for (const item of ctx.useitems) {
    addEntity('useitem', item.id, item.name, item.aliases, item.stock)
  }
  // 数量里若圈进了某个实体名的起点，截断到那里：那串数字属于人家的名字
  const trimDigits = (digits: string, digitStart: number): string => {
    const boundary = nameStarts
      .filter((at) => at >= digitStart && at < digitStart + digits.length)
      .sort((a, b) => a - b)[0]
    return boundary == null ? digits : digits.slice(0, boundary - digitStart)
  }
  for (const entity of pending) {
    const matches = entity.spots
      .map(({ alias, start }) => {
        // ×N 必须**紧跟**自家名字（只允许夹收尾引号/括号与空白）。原先在
        // 名字后 24 字符窗口里乱捞，会把相邻选项的数量抢过来——2026-08-12
        // 用户抓的实锤：Bq8「熟练见张员 熟练搭乘员 洋上补给×4」前两项被
        // 标成 ×4，实为各 ×1；全库扫描同病灶的选一组过百。
        //
        // 名字和 ×N 之间还可能夹**改修星级**（F142「二式爆雷」★+4×1）——
        // 星级是奖励的一部分：不认它，×2 会错读成 ×1，剩下的「」★+4×1」
        // 还会被完备性兜底当成认不出的原文补进面板（2026-08-13 用户抓的实锤）。
        // 匹配跨度（end）要盖住整段后缀，掩码后才不留残渣。
        const from = start + alias.length
        const tail = normalized.slice(from, from + 16)
        const direct = tail.match(
          /^(?<lead>[」』】)）\s]*)(?:[★☆](?<starGap>\s*\+?\s*)(?<star>\d+))?(?<mid>[」』】)）\s]*)(?:×|x|\*)(?<gap>\s*)(?<amount>\d+)/i,
        )
        const starOnly = direct
          ? null
          : tail.match(/^(?<lead>[」』】)）\s]*)[★☆](?<starGap>\s*\+?\s*)(?<star>\d+)/)
        // 星级数字同样会把邻项名字开头的数字吞进来：B161「…Mk.30改★+4」后面紧跟着
        // 「22号对水上电探改四」，★ 读成了 +422，跨度顺带盖住那个「22」，
        // 22 号电探整条被重叠判据判出局，只剩「号对水上电探改四(后期调整型)★+4」
        // 一块残渣（用户 2026-08-28 全库扫描）。数量怎么截，星级就怎么截。
        const starHit = direct ?? starOnly
        const starRaw = starHit?.groups?.star ?? ''
        const starStart = starHit
          ? from + (starHit.groups?.lead?.length ?? 0) + 1 + (starHit.groups?.starGap?.length ?? 0)
          : 0
        const starDigits = starRaw ? trimDigits(starRaw, starStart) : ''
        const star = starDigits ? Number(starDigits) : null
        // 星级一个数字都没剩，这个「★+」就不是本项的后缀，跨度退回名字末尾
        const starEnd = starDigits ? starStart + starDigits.length : from
        if (!direct) {
          return { alias, start, end: starHit ? starEnd : from, amount: null as number | null, star }
        }
        // 星级被截断说明后面那串数字是别人的名字，×N 也就不是这一项的了
        if (starRaw.length !== starDigits.length) {
          return { alias, start, end: starEnd, amount: null as number | null, star }
        }
        const raw = direct.groups?.amount ?? ''
        const digitEnd = from + direct[0].length
        const digits = trimDigits(raw, digitEnd - raw.length)
        return {
          alias,
          start,
          end: digitEnd - (raw.length - digits.length),
          amount: digits ? Number(digits) : null,
          star,
        }
      })
      .sort((a, b) => a.start - b.start || b.alias.length - a.alias.length)
    // 同一件东西可能两个名字连写（A83「战斗粮食（特别饭团）「战斗粮食(特制饭团)」×2」），
    // 数量挂在其中一处：取带数量的那处；处处都不带才是 ×1。
    // 但**占位**要按第一处算：把落点挪到后面那处，前面那半就成了没人认领的字，
    // 短名字会从里面再抠出一项来——A83 的二选一会列出三项（战斗粮食 + 特别饭团版），
    // Bq5 的三选一会列出四项（12.7cm连装炮 + C型改二），都是这么来的。
    const hit = matches.find((match) => match.amount != null) ?? matches[0]
    candidates.push({
      kind: entity.kind,
      id: entity.id,
      name: entity.rawName,
      stock: entity.stock,
      amount: Math.max(1, hit.amount ?? 1),
      star: hit.star ?? undefined,
      start: matches[0].start,
      length: matches[0].end - matches[0].start,
    })
  }
  const materialDefs: [number, string][] = [
    [0, '燃料'],
    [1, '弹药'],
    [2, '钢材'],
    [3, '铝土'],
  ]
  for (const [id, name] of materialDefs) {
    const hit = matchMaterialRewardName(normalized, name)
    if (!hit) continue
    // 资源数量同样会跟邻项的口径数字黏连（×300 + 25mm…），同一把尺截断
    const rawDigits = hit.rawDigits
    const digits = rawDigits
      ? trimDigits(rawDigits, hit.index + hit.full.length - rawDigits.length)
      : ''
    candidates.push({
      kind: 'material',
      id,
      name,
      stock: ctx.materialStock(id),
      amount: Math.max(1, Number(digits || 1)),
      start: hit.index,
      length: hit.full.length - (rawDigits.length - digits.length),
    })
  }
  // 长名称覆盖短名称：例如“新型航空兵装资材”不能同时误命中“新型兵装资材”。
  const accepted: RewardStockCandidate[] = []
  {
    // 挑一组互不重叠、**盖住最多字**的名字。从左往右贪心（长的优先）在一处会栽：
    // D43「三式水中探信仪 改修资材×3」里「三式水中探信仪改」也是一件真装备，
    // 贪心咬掉那个「改」，后面就只剩「修资材×3」一块残渣——两项拼起来盖得更多，
    // 才是原文的读法。区间调度按结束点排，取最大覆盖。
    const items = [...candidates].sort(
      (a, b) => a.start + a.length - (b.start + b.length) || a.start - b.start,
    )
    const best = [0]
    const from = [-1]
    for (let i = 0; i < items.length; i += 1) {
      let prev = i
      while (prev > 0 && items[prev - 1].start + items[prev - 1].length > items[i].start) prev -= 1
      const take = items[i].length + best[prev]
      best.push(Math.max(best[i], take))
      from.push(take > best[i] ? prev : -1)
    }
    for (let i = items.length; i > 0; ) {
      if (from[i] < 0) { i -= 1; continue }
      accepted.push(items[i - 1])
      i = from[i]
    }
    accepted.reverse()
  }
  // declared 0 = 文本没自报项数，一样要补漏：宁可多列一条原文，
  // 也不让一个选项从面板上无声消失
  if (declared === 0 || declared > accepted.length) {
    // 把已识别的「名称×数量」段抹成空白（等长替换保住索引），剩下的就是没对上的原文。
    // 只抹代表位置：同一件东西写两遍**可能是两项**（C77 的「35.6cm连装炮改×2」与
    // 「35.6cm连装炮改★+6×1」是两个不同选项），第二处照原文列出来才不算吞了人家
    const masked = accepted.reduce((text, item) => {
      const tail = text
        .slice(item.start + item.length)
        .match(/^\s*(?:×|x|\*)\s*\d+/i)
      const end = item.start + item.length + (tail ? tail[0].length : 0)
      return `${text.slice(0, item.start)}${' '.repeat(end - item.start)}${text.slice(end)}`
    }, normalized)
    for (const match of masked.matchAll(/[^\s、，,;；/]{2,}/g)) {
      // 洗掉 quests-scn 里偶发的 wiki 色标残留（「装备保有位orange|+1」）
      const text = match[0].replace(/(?:orange|red|blue|green|yellow)\|/gi, '')
      for (const piece of rawRewardPieces(text, match.index ?? 0)) {
        accepted.push({ kind: 'raw', id: 0, stock: 0, amount: 1, ...piece })
      }
    }
  }
  return accepted.sort((a, b) => a.start - b.start)
}

export const questRewardChoiceGroups = (
  memo: string,
  ctx: RewardParseContext,
): RewardStockCandidate[][] =>
  splitQuestReward(memo).groups.flatMap((group) => {
    const items = parseQuestRewardItems(group.text, group.declared, ctx)
    return items.length ? [items] : []
  })

/** 固定奖励原文。选一组可能夹在中间，剩下的几段拼起来——分隔符别用空白，
 *  归一化会把空白抹掉，前后两段的名字会黏成一个（B143 那类误读的来路）。 */
export const questFixedRewardText = (memo: string): string =>
  splitQuestReward(memo).fixedParts.join(' / ')
