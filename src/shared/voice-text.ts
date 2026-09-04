// 台词**中文译文**的标点体例归一。
//
// ---- 两条，都是 2026-08-22 用户抽检自译包时当场裁的 ----
//
//  ① **行尾句号一律不写**。原话：「删所有尾部的句号——如果是我翻译习惯的话我就不会写
//     尾部句号」。这是中文字幕/游戏台词的通行体例：一行就是一句话，行末不需要再点一个句号。
//     `？！～` 这些**保留**——它们带语气，不是单纯的终止符。**行内分句的句号也保留**，
//     只删最末那一个：「他走了。我留下」里那个句号是分句用的，删了就粘成一句。
//
//  ② **`……。` 是病句，任何位置都修**。原话：「省略号后面接句号是具体的错——中文语境
//     省略号跟句号是同级关系」。省略号自己就终止句子，后面再点一个句号是重复终止。
//     这一条不分行内行尾，见一个改一个。
//
// ---- 为什么连转写层也要过这一道 ----
// 图鉴的台词卷是**多层混排**的：同一页上可能一半行来自舰娘百科、一半来自艦素自译，
// 还有几行来自 poi-plugin-subtitle。自译行没有行尾句号、隔壁行拖着一个，读起来就是
// 两拨人写的。标点归一属**转写规范化**，不改一个字的语义，所以显示面统一过一道。
// 日文那一列不动——它是原文转写，不是我们的翻译，日语的句读习惯也不是这条规矩管的。
//
// ---- 幂等 ----
// 这个函数要能反复施加而结果不变：它同时长在**包构建期**（自译包与季节台词包落盘前）
// 与**显示期**（图鉴逐行渲染时），一行文本被过两遍是常态。

/**
 * 收尾装饰符。句号跟在它们**前面**时，那个句号仍然算「行尾句号」——
 * 「来，请。♪」「（晚安。）」里的句号都在行尾，只是后面还挂着一个符号。
 * 这张表**只收收尾用的成对括号与装饰**，不收 `～`/`—` 那类延音符
 *（那些本身可能就是句子的一部分，跟句号连用的语感不一样，不替用户拿主意）。
 */
const TRAILING_DECOR = '」』】》〕］｝）\\)\\]♪♥☆★'

const ELLIPSIS_THEN_PERIOD = /([…‥]+)[ \t]*。+/g
const TRAILING_PERIOD = new RegExp(`。+([${TRAILING_DECOR}\\s]*)$`)
const CJK_CHARACTER = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u
const LATIN_LETTER = /\p{Script=Latin}/u

/**
 * 中文译文栏是否仍是缺译：空白，或只有拉丁字母而没有中日韩文字。
 * 「……」「♪」这类没有字母的合法译文不算缺译。
 */
export const isUntranslatedVoiceText = (value: unknown): boolean => {
  const compact = `${value ?? ''}`.replace(/\s+/gu, '')
  return !compact || (!CJK_CHARACTER.test(compact) && LATIN_LETTER.test(compact))
}

/** 这一行是不是已经合体例（`normalizeVoiceText` 的不动点）。护栏与对账用。 */
export const isVoiceTextNormalized = (value: unknown): boolean =>
  normalizeVoiceText(value) === `${value ?? ''}`

export const normalizeVoiceText = (value: unknown): string => {
  const text = `${value ?? ''}`
  if (!text) return ''
  return (
    text
      // ① 省略号与句号同级，接在一起是病句 —— 任何位置都修
      .replace(ELLIPSIS_THEN_PERIOD, '$1')
      // ② 行尾句号删掉（先修①，因为①可能把新的句号露到行尾）。
      //    收尾装饰符原样接回去，**但那一段里的空白一并收掉**——句号删掉之后
      //    留在行末的空格是它的残影，不是原文的一部分。只动这一段：
      //    没有行尾句号的行连一个空格都不碰（那是另一件事，不在这条体例里）。
      .replace(TRAILING_PERIOD, (_matched, tail: string) => tail.replace(/\s+/g, ''))
  )
}
