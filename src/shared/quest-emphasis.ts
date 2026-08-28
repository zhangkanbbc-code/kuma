// 任务正文的「文中提醒」：在原句里点出最容易读漏的硬条件
// ——几艘、几次、什么判定、哪张图、不许带什么。
//
// 与详情下方的「相关内容」是两件事，别混：那里是实体清单（可点、带缩略图、
// 未持有会灰掉），这里只在句子里做记号，不改阅读顺序，也不承担跳转。
//
// 另一半职责是清洗 wiki 残留。简中任务库抓自 kcwiki，正文里留着 [[目标|显示]]
// 的竖线（644 条 desc 里 125 条带竖线，「1-1|镇守府正面海域(1-1)」这样直接显示
// 给玩家看了），以及 {{gray|…}} 这类模板名。清洗顺带交出「这段是海域」的现成
// 情报——竖线左边就是 wiki 作者标注的目标，比任何猜词都准。

export type QuestMarkKind =
  | 'num'
  | 'rank'
  | 'limit'
  | 'map'
  | 'ship'
  | 'type'
  | 'equip'
  | 'nationality'

export interface QuestMark {
  start: number
  length: number
  kind: QuestMarkKind
  /** 实体标记的目标 id（海域/舰娘/国籍…），纯文本标记没有 */
  ref?: number
}

/** 清洗后仍然知道来历的一段：wiki 竖线左边的目标名 */
export interface QuestTextLink {
  start: number
  length: number
  target: string
}

export interface CleanQuestText {
  text: string
  links: QuestTextLink[]
}

const QUOTE_PAIRS: Record<string, string> = {
  '「': '」',
  '『': '』',
  '“': '”',
  '"': '"',
}

// 「目标|显示」：两侧引号必须配对，中间不再套引号，长度设上限——
// 竖线在中文里也可能是别的东西，宁可漏清洗也不要把整句吞掉。
// 左值放到 40 是被「任务/小剧场语音汇总#2017年10月25日新任务语音|任务语音」逼的，
// wiki 的锚点链接就是这么长。
const QUOTED_PIPE = /(["「『“])([^"「」『』“”|\n]{1,40})\|([^"「」『』“”|\n]{1,60})(["」』”])/g

// {{gray|…}} / {{lang|ja|…}} / {{装备奖励|编号 = 037}} 的花括号在抓取时就掉了，
// 只剩模板名和竖线粘在句首。
const TEMPLATE_PIPE = /(^|[\s　"「『“])(?:gray|grey|color)\|/gi
const LANG_PIPE = /(^|[\s　"「『“])lang\|[a-z]{2,3}\|/gi
// 这个模板名紧贴在正文里（「首格装备装备奖励|编号 = 037」），不能要求前面有空白。
const REWARD_TEMPLATE_PIPE = /()装备奖励\|/g
// 整行以「短词|」开头的是没带引号的 wiki 内链（memo2 里的「美国舰|美国舰娘2只…」）。
// 只认行首、只认六字以内、只认不带标点的左值——再宽就有咬掉正文的风险。
const LEAD_PIPE = /^([^\s|「」『』“”，。！？、：；]{1,6})\|/gm

interface Rewrite {
  start: number
  end: number
  text: string
  /** 结果串里代表原目标的那一段（相对 text 的偏移与长度） */
  keep?: { offset: number; length: number; target: string }
}

/**
 * 把 wiki 竖线折叠成给人看的文本。
 *
 * 返回清洗后的文本，以及每段折叠文本在**新坐标**下的位置与原目标——
 * 调用方据此可以直接标记，不必再猜「镇守府正面海域(1-1)」是海域。
 */
export const cleanQuestText = (raw: string): CleanQuestText => {
  const source = `${raw ?? ''}`
  if (!source.includes('|')) return { text: source, links: [] }

  const rewrites: Rewrite[] = []
  for (const match of source.matchAll(QUOTED_PIPE)) {
    const [whole, open, target, display, close] = match
    if (QUOTE_PAIRS[open] !== close) continue
    rewrites.push({
      start: match.index ?? 0,
      end: (match.index ?? 0) + whole.length,
      text: `${open}${display}${close}`,
      keep: { offset: open.length, length: display.length, target },
    })
  }
  for (const pattern of [TEMPLATE_PIPE, LANG_PIPE, REWARD_TEMPLATE_PIPE]) {
    for (const match of source.matchAll(pattern)) {
      rewrites.push({
        start: match.index ?? 0,
        end: (match.index ?? 0) + match[0].length,
        text: match[1] ?? '',
      })
    }
  }
  for (const match of source.matchAll(LEAD_PIPE)) {
    rewrites.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length, text: '' })
  }

  rewrites.sort((left, right) => left.start - right.start || right.end - left.end)
  const parts: string[] = []
  const links: QuestTextLink[] = []
  let cursor = 0
  let produced = 0
  for (const rewrite of rewrites) {
    if (rewrite.start < cursor) continue
    const lead = source.slice(cursor, rewrite.start)
    parts.push(lead)
    produced += lead.length
    parts.push(rewrite.text)
    if (rewrite.keep) {
      links.push({
        start: produced + rewrite.keep.offset,
        length: rewrite.keep.length,
        target: rewrite.keep.target,
      })
    }
    produced += rewrite.text.length
    cursor = rewrite.end
  }
  parts.push(source.slice(cursor))
  return { text: parts.join(''), links }
}

// 数量条件。量词表刻意排掉「月/日/川/号/水」这些——任务里满是「五月雨」「三川舰队」
// 「第二舰队」「一号舰」，把它们标成数量等于把提醒稀释成噪音。
// 「第」开头的一律不算：「（第二次）」「第一次改装」是同系列任务的序号，不是要打几次。
const COUNT =
  /(?<!第)(?:[0-9]+|[一二三四五六七八九十两]+)\s*(?:艘|只|隻|次|回|人|种|個|个|架|台|名|门|发|枚)(?:\s*(?:及)?\s*(?:以上|以下|以内|未满))?/g

// 练度门槛：Lv.90～99 / Lv50以上 / lv.96以上
const LEVEL = /lv\.?\s*[0-9]+(?:\s*[~～〜]\s*[0-9]+)?(?:\s*(?:及)?\s*(?:以上|以下|以内|未满))?/gi

// 战果判定。写法五花八门：【S胜利】『S胜』「A胜利」【A判定】完全胜利。
// 字母前后要求不是别的字母，免得把英文缩写腰斩。
const RANK = /完全胜利|(?<![A-Za-z])[SABＳＡＢ]\s*(?:判定|胜利|胜)(?![A-Za-z])(?:\s*(?:及)?\s*以上)?/g

// 限制与例外：全库只有个位数，正因为稀少才值得标——漏读一条就是白打一轮。
const LIMIT = /除外|不含|不包括|不得|不能|不可|禁止|无需|以外/g

// 海域码。7-2-2（塔威塔威深部）要整段吃下，不能只标前半。
const MAP_CODE = /(?<![0-9])([0-9]{1,2})\s*[-‐‑‒–—－]\s*([0-9]{1,2})(?:\s*[-‐‑‒–—－]\s*[0-9])?(?![0-9])/g

export interface EmphasisOptions {
  /** 有主数据时用它把「3-5」这种巧合挡掉；不传就只按形态认 */
  isMapId?: (id: number) => boolean
}

const pushMatches = (
  out: QuestMark[],
  text: string,
  pattern: RegExp,
  kind: QuestMarkKind,
) => {
  for (const match of text.matchAll(pattern)) {
    if (!match[0]) continue
    out.push({ start: match.index ?? 0, length: match[0].length, kind })
  }
}

/**
 * 纯文本层的提醒：数量、练度、判定、限制、海域码，外加清洗时认出的海域链接。
 *
 * 不碰词典，所以列表里几百行也能每行跑一遍。
 */
export const emphasisMarks = (
  text: string,
  links: QuestTextLink[] = [],
  options: EmphasisOptions = {},
): QuestMark[] => {
  const marks: QuestMark[] = []
  pushMatches(marks, text, COUNT, 'num')
  pushMatches(marks, text, LEVEL, 'num')
  pushMatches(marks, text, RANK, 'rank')
  pushMatches(marks, text, LIMIT, 'limit')

  for (const match of text.matchAll(MAP_CODE)) {
    const id = parseInt(match[1], 10) * 10 + parseInt(match[2], 10)
    if (options.isMapId && !options.isMapId(id)) continue
    marks.push({ start: match.index ?? 0, length: match[0].length, kind: 'map', ref: id })
  }

  // 竖线左边写着 1-1 的，右边整段就是那张图的名字——比在「镇守府正面海域(1-1)」
  // 里再匹配一次海域名可靠，也省得名字和括号里的码被拆成两块。
  for (const link of links) {
    const code = link.target.match(/^([0-9]{1,2})[-‐‑‒–—－]([0-9]{1,2})/)
    if (!code) continue
    const id = parseInt(code[1], 10) * 10 + parseInt(code[2], 10)
    if (options.isMapId && !options.isMapId(id)) continue
    marks.push({ start: link.start, length: link.length, kind: 'map', ref: id })
  }
  return marks
}

/**
 * 记号铺满整对引号。
 *
 * 索引里的别名常常只是名字的前半截——「Fletcher MK.II」只认得「Fletcher」，
 * 「妙高改二」只认得「妙高」。任务文本里的引号本来就是实体边界，与其让马克笔
 * 涂半个名字，不如顺着引号铺到底。只在命中紧贴开引号时才铺，中途插进去的不算。
 */
export const spreadMarksToQuotes = (text: string, marks: QuestMark[]): QuestMark[] =>
  marks.map((mark) => {
    const closer = QUOTE_PAIRS[text[mark.start - 1] ?? '']
    if (!closer) return mark
    const end = text.indexOf(closer, mark.start)
    return end > mark.start ? { ...mark, length: end - mark.start } : mark
  })

// 谁盖谁：长的赢，同长先到先得。海域名整段盖住里面的「(1-1)」就是靠这条。
export const mergeQuestMarks = (...groups: QuestMark[][]): QuestMark[] => {
  const all = groups.flat().sort(
    (left, right) => right.length - left.length || left.start - right.start,
  )
  const accepted: QuestMark[] = []
  for (const mark of all) {
    if (mark.length <= 0) continue
    const clash = accepted.some(
      (item) =>
        mark.start < item.start + item.length && item.start < mark.start + mark.length,
    )
    if (!clash) accepted.push(mark)
  }
  return accepted.sort((left, right) => left.start - right.start)
}

/**
 * 按标记切文本。转义与包裹都由调用方给——渲染层的转义函数只有它自己知道。
 */
export const renderQuestMarks = (
  text: string,
  marks: QuestMark[],
  escape: (raw: string) => string,
  wrap: (mark: QuestMark, escapedInner: string, plainInner: string) => string,
): string => {
  if (!marks.length) return escape(text)
  const parts: string[] = []
  let cursor = 0
  for (const mark of marks) {
    if (mark.start < cursor) continue
    parts.push(escape(text.slice(cursor, mark.start)))
    const inner = text.slice(mark.start, mark.start + mark.length)
    parts.push(wrap(mark, escape(inner), inner))
    cursor = mark.start + mark.length
  }
  parts.push(escape(text.slice(cursor)))
  return parts.join('')
}
