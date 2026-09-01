/**
 * 备注正文里的 `#标签`。
 *
 * 2026-09-01 用户拍板：标签**不另起一套数据结构**，就写在「这一艘的备注」里——
 * 活动期按札名给舰娘写 `#水打`、`#机动`，舰娘列表的筛选区就冒出对应的片，
 * 点一下只剩这一组。所以这里只做一件事：从一段自由文本里认出哪几段是标签。
 *
 * 三条口径：
 * - **全角 ＃ 照认**。中文输入法在中文标点模式下敲出来的就是 ＃，玩家在框里
 *   看不出它与半角的分别；不认的话就是「写了没反应」，像功能坏了。认下来之后
 *   与半角归一成同一个标签（`＃高速` 和 `#高速` 是一个，不是两个）。
 * - **井号左边不要求分隔**。中文本来就不打空格，`活动用#水打#机动` 是常态写法；
 *   要求井号前必须是空白或行首，这行字一个标签都认不出来。
 * - **标签体到空白/标点为止**。字母、数字、组合记号、下划线算标签体，其余
 *   （空格、逗号、句号、井号本身……）都是边界，`#高速,#夜战` 认出两个。
 *   下划线是唯一被放行的标点：`#E1_甲` 这种写法在标签里太常见。
 *
 * 第二条与第三条合起来有个躲不掉的后果：中文这边**右边也没有边界**，
 * `#水打主力` 整串都是标签名（要断开就补个空格，或者直接接下一个井号）。
 * 兜底不放在解析层——擅自猜哪几个字才是标签只会更难预测；放在界面：详情里
 * 那排「认出来的标签」是逐字回执，片上写着 `#水打主力` 就知道该补个空格。
 *
 * **大小写不归一**：`#E1` 与 `#e1` 是两个标签。归一就得挑一个当显示名，玩家
 * 看到的于是与自己写的不一样；不归一的话两枚片明晃晃并排摆着，一眼看得出
 * 自己打岔了，改回去就是。
 *
 * 长度不设上限：备注本身有 120 字上限，最长的标签也就那么长，
 * 摆不下是筛选区的排版问题（CSS 截断），不该在解析这一层擅自把玩家的字切掉。
 */
import { compareDisplayNames } from './name-order'

/**
 * 标签体：`\p{L}` 字母（含全部汉字与假名）、`\p{N}` 数字、`\p{M}` 组合记号
 * （越南语、泰语那类把声调写成独立码位的文字），外加下划线。
 *
 * 反过来写成「不是空白和标点」会顺手把 emoji、货币符号、箭头都收进标签里，
 * `#高速→夜战` 会变成一个标签。正着列允许集才收得住边界。
 */
const TAG_PATTERN = /[#＃]([\p{L}\p{N}\p{M}_]+)/gu

export interface NoteSegment {
  kind: 'text' | 'tag'
  /** 原文的这一段。tag 段含引导的井号，且是**原样**的（可能是全角 ＃） */
  text: string
  /** tag 段的标签名：不含井号，全角引导号已归一。text 段恒为空串 */
  tag: string
}

/**
 * 把一段备注切成「普通文本 / 标签」交替的段。给要在正文里把标签描出来的地方用——
 * 拼回 `segments.map((s) => s.text).join('')` 与原文逐字节相同，一个字都不丢。
 */
export const splitNoteTags = (note: string | null | undefined): NoteSegment[] => {
  const source = `${note ?? ''}`
  const out: NoteSegment[] = []
  let cursor = 0
  // matchAll 不会动 TAG_PATTERN 自己的 lastIndex（内部按 species 复制一份），
  // 所以这枚模块级正则可以反复用，不必每次新建。
  for (const match of source.matchAll(TAG_PATTERN)) {
    const at = match.index ?? 0
    if (at > cursor) out.push({ kind: 'text', text: source.slice(cursor, at), tag: '' })
    out.push({ kind: 'tag', text: match[0], tag: match[1] })
    cursor = at + match[0].length
  }
  if (cursor < source.length) out.push({ kind: 'text', text: source.slice(cursor), tag: '' })
  return out
}

/** 一段备注里出现过的标签，按**首次出现次序**去重。同一个写两遍只算一个。 */
export const parseNoteTags = (note: string | null | undefined): string[] => {
  const seen: string[] = []
  for (const segment of splitNoteTags(note)) {
    if (segment.kind === 'tag' && !seen.includes(segment.tag)) seen.push(segment.tag)
  }
  return seen
}

export interface NoteTagTally {
  tag: string
  /** 带这个标签的**备注条数**（一条备注里写两遍只算一条） */
  count: number
}

/**
 * 一批备注里的标签清单，直接就是筛选区那排片的次序：**用得多的排前面**，
 * 一样多的按拼音序（compareDisplayNames，与列表按名排序同一台 Collator）。
 *
 * 次序必须是纯函数式的，不能是「谁先被扫到谁在前」——舰娘列表每次数据补丁都重渲，
 * 片跟着换位置的话，玩家的手会点空。
 */
export const tallyNoteTags = (notes: Iterable<string | null | undefined>): NoteTagTally[] => {
  const counts = new Map<string, number>()
  for (const note of notes) {
    for (const tag of parseNoteTags(note)) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || compareDisplayNames(a.tag, b.tag))
}
