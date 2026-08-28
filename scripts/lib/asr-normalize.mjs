// ASR 转写文本的归一、相似度与专名纠偏。**纯函数层，不碰网络也不碰盘。**
//
// 拆出来的理由跟 shared/voice-sound-path 一样：护栏要能真跑一遍。
// 这一层的判断写反了不会报错——它只会让对账报告里的「相似度」整体偏高或偏低，
// 于是可疑条目排不到前面，人去耳测时先听到的全是好条目。
//
// ---- 三件事，边界分清 ----
//  ① **归一**（foldForCompare）：把「同一句话的两种写法」折到同一把钥匙上。
//     只折**表记差异**（标点/空白/全半角/片假名/日文汉字异体），
//     **不折读音**——我们没有汉字→读み的引擎，硬猜等于伪造证据。
//  ② **相似度**（similarityOf）：折叠后的字符级编辑距离。低分不等于「转写错了」，
//     只等于「这一条值得人去听一耳朵」。判级表就是按这个口径写的。
//  ③ **专名纠偏**（correctProperNouns）：保守替换，纠不动就原样留着并标记。
//
// ---- 为什么纠偏是「保守」的（实测定的口径，别调松）----
// 2026-08-23 单条实测：秋津洲 1 号槽，无偏置时 fun-asr 出「明津島」、
// qwen3-asr 出「秋篠」——两者与「秋津洲」的字符级相似度都只有 0.33。
// 想靠后处理把 0.33 的窗口拉回正确专名，阈值必须放到 0.33 以下，
// 而那个阈值会把「大抵」改成「大艇」的同时，把句子里任何两字词都改成专名。
// 所以**主力手段是调用时的 context 偏置**（asr-client 的 biasTermsOf），
// 实测同一条加上专名 context 后三个专名全中；后处理只当第二道网，
// 只捞那些「差一个字」的近失，捞不动的如实标 `unfixed` 交给人。
const KATAKANA_START = 0x30a1
const KATAKANA_END = 0x30f6

/** 片假名 → 平假名（只动这一段，長音符 ー 与半角片假名不动）。 */
const katakanaToHiragana = (text) => {
  let out = ''
  for (const ch of text) {
    const code = ch.codePointAt(0)
    out += code >= KATAKANA_START && code <= KATAKANA_END ? String.fromCodePoint(code - 0x60) : ch
  }
  return out
}

/**
 * 比较用的标点/空白/装饰，一律删掉。
 *
 * ASR 与所称文本的标点几乎必然打架（实测那一条：所称「水上機母艦、秋津洲よ！」，
 * 转写「水上機母艦秋津洲よ。」——读音一字不差，标点三处不同）。
 * 标点差异算进相似度就是拿体例差异冒充转写错误，可疑度排序会被它整体污染。
 */
const PUNCT_AND_SPACE = /[\s　-〿！-／：-＠［-｀｛-･!-/:-@[-`{-~♪♥☆★…‥ー～〜]/gu

/** 全角英数 → 半角。 */
const toHalfWidth = (text) =>
  text.replace(/[！-～]/gu, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))

/**
 * 比较用归一。**幂等**：折过的字符串再折一遍结果不变（护栏钉着这条）。
 *
 * 顺序有讲究：先全半角（否则全角标点漏网），再片→平，最后删标点空白。
 */
export const foldForCompare = (value) => {
  const text = `${value ?? ''}`
  if (!text) return ''
  return katakanaToHiragana(toHalfWidth(text)).replace(PUNCT_AND_SPACE, '').toLowerCase()
}

/**
 * 编辑距离（Levenshtein）。滚动一行，O(min(a,b)) 空间。
 *
 * 台词最长也就百来字，用不着更快的算法；写成滚动行只是为了别在
 * 全库对账时给每条都开一个二维数组。
 */
export const levenshtein = (a, b) => {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  // 短的那个当列，行向量就短
  if (a.length < b.length) [a, b] = [b, a]
  const prev = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const temp = prev[j]
      prev[j] = Math.min(
        prev[j] + 1, // 删
        prev[j - 1] + 1, // 插
        diag + (a[i - 1] === b[j - 1] ? 0 : 1), // 替
      )
      diag = temp
    }
  }
  return prev[b.length]
}

/**
 * 归一后的字符级相似度，0..1。两边都空算 1（没有内容就没有分歧）。
 *
 * ⚠️ 这个分数**不是「转写正确率」**。它是「这一条要不要人去听」的排序键：
 * 同音异字（秋津洲→秋篠）读音全中却只有 0.33 分，而它恰恰是最该被人看到的那种。
 */
export const similarityOf = (a, b) => {
  const left = foldForCompare(a)
  const right = foldForCompare(b)
  if (!left && !right) return 1
  if (!left || !right) return 0
  const distance = levenshtein(left, right)
  return 1 - distance / Math.max(left.length, right.length)
}

/**
 * 判级。阈值是拿实测那一条与它的同族变体标定的：
 * 加偏置后的转写与所称文本相似度 0.94（只差标点体例），无偏置时 0.72。
 *
 *  · match    ≥0.90 音文一致，所称文本站得住
 *  · minor    ≥0.75 小分歧（助词/送假名/短词），多半是誊写体例差异
 *  · suspect  ≥0.50 可疑，进耳测候选
 *  · conflict <0.50 打架，优先耳测（同音异字、张冠李戴都落在这一档）
 */
export const AUDIT_GRADES = ['match', 'minor', 'suspect', 'conflict']

export const gradeOf = (score) => {
  if (!(typeof score === 'number') || Number.isNaN(score)) return 'conflict'
  if (score >= 0.9) return 'match'
  if (score >= 0.75) return 'minor'
  if (score >= 0.5) return 'suspect'
  return 'conflict'
}

/** 纠偏窗口的下限相似度。见文件头「为什么是保守的」。 */
const FIX_THRESHOLD = 0.5

/**
 * 窗口里含标点/空白吗。
 *
 * 含标点的窗口**一律不当候选**：相似度是折叠后算的，标点在折叠里被删掉，
 * 于是「、秋津」与「秋津州」对同一个专名得分完全相同，而前者起点更靠前会先被选中——
 * 替换后把顿号一起吃掉、还把「州」剩在外面，得到「水上機母艦秋津洲州よ」。
 * 一个纠偏动作同时制造了两个新错（2026-08-23 被护栏抓到，两次）。
 * 真正的近失是**词内部**写错，不会把外面的标点卷进来，所以直接排除。
 */
const hasPunctOrSpace = (window) => [...window].length !== foldForCompare(window).length
/** 短于这个长度的专名不纠——两字词里改一个字等于换一个词，风险大于收益。 */
const MIN_TERM_LENGTH = 3

/**
 * 专名纠偏（第二道网）。
 *
 * @param text  ASR 原始输出
 * @param terms 该形态**自己的**专名表（舰名/舰种/装备/术语）。别传全库词表——
 *              全库词表会把任何一个近似窗口都替换成某个不相干的舰名。
 * @returns { text, fixes, unfixed }
 *          fixes   已替换：{ term, was, score }
 *          unfixed 该出现却没出现、也没找到可替换窗口的专名（如实标记，交给人）
 *
 * 只替换**第一处**最佳窗口：台词里同一个专名出现两次的情况有，但
 * 「两处都是近失且近失得一模一样」的情况没有实证，宁可少改。
 */
export const correctProperNouns = (text, terms) => {
  let out = `${text ?? ''}`
  const fixes = []
  const unfixed = []
  // 长的先纠：短词是长词的子串时，先纠短词会把长词切碎
  const ordered = [...new Set((terms ?? []).map((t) => `${t ?? ''}`).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  )
  for (const term of ordered) {
    if (term.length < MIN_TERM_LENGTH) continue
    if (out.includes(term)) continue // 已经对了，不动
    let best = null
    // 窗口长度容许 ±1：漏字/多字的近失都收得到
    for (let width = Math.max(1, term.length - 1); width <= term.length + 1; width++) {
      for (let start = 0; start + width <= out.length; start++) {
        const window = out.slice(start, start + width)
        if (hasPunctOrSpace(window)) continue
        const score = similarityOf(window, term)
        if (score < FIX_THRESHOLD) continue
        // **同分时取长度最接近的窗口**。少了这一条，「秋津州」会被 width=len-1 的
        // 「秋津」先抢到（两者同为 0.667），替换后剩一个「州」挂在后面变成
        // 「秋津洲州」——纠偏反而制造了一个新错字（2026-08-23 被护栏抓到）。
        const gap = Math.abs(width - term.length)
        if (!best || score > best.score || (score === best.score && gap < best.gap)) {
          best = { start, width, window, score, gap }
        }
      }
    }
    if (best) {
      out = out.slice(0, best.start) + term + out.slice(best.start + best.width)
      fixes.push({ term, was: best.window, score: Number(best.score.toFixed(3)) })
    } else {
      unfixed.push(term)
    }
  }
  return { text: out, fixes, unfixed }
}
