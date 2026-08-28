// 铭 · 演习类任务的自研推导。
//
// 演习类的判定只有两个字段——**评价下限**与**次数**——所以这个模块要做对的也只有两件事：
// 从中文任务正文里把这两个数读出来，以及在读不准的时候闭嘴。
//
// 三条口径（都能在语料里自证，不是从谁的编码里抄的）：
//
//  1. **「胜利」没写字母时 = B 判定以上**。这不是猜，中文语料自己给了对照：
//     311/Cm1 的 desc 写「拿下七次演习的胜利」，memo2 写「演习B胜利七次即可」；
//     338/C39 的 desc 写「取得演习4次以上胜利」，memo2 补「（S/A/B胜均可）」；
//     320/C18、325/C23 同样是 desc 裸写「胜利」、memo2 补「B胜以上」。
//     游戏侧也自洽：演习结算 C 判定及以下是败北，B 才是最低的那一档胜。
//  2. **「无论胜负」= 不看评价**（301/C1、303/Cd1 的 memo2 原文），落 rank 0。
//     日文原文同样只说「「演習」を挑もう」，没有胜负字样。
//  3. **「?胜」的判别线是「问号前有没有字母」**：有字母（「取得1次S?胜」）说明中文源
//     只是对服务器口径存疑，评价照取、标 ≈；没有字母（「各取得一次?胜」）就是**无从取值**，
//     落 rank 0 + ≈，不替正文拿主意。这条线现役演习任务里一条都没触发（全都写明了），
//     留着是因为出击类正文里有七条这么写，判别逻辑要同一份。
//
// 两道闸门：
//  · **分类位闸门**：只处理编码首字母是 C（演习）的任务。没有这道闸的话，
//    远征任务名里的「航空战舰运用演习」「防空射击演习」会被当成演习计数。
//  · **复合任务闸门**：正文除了演习还要求出击/海域/BOSS 的（317/C15：演习胜3次之后
//    还要把同一舰队投入西南诸岛海域），整条不做——只生成演习那一格会提前判完成。
//    只要求「装备/准备某物」的不算复合（318/Cm2：演习3次 + 旗舰装备两个战斗粮食），
//    那是本地判不了的门，标 partial 交出去，计数照给。
//
// **日文原文是权威层**（2026-08-21 立）：中文正文是译文，会加戏也会丢字。
// 36 条演习任务逐条对过游戏自己的日文原文（账本 questlist 的 api_detail 是一手，
// 账本没见过的用离线对账脚本核任务元数据里的日文字段），只有一条对不上，
// 走下方 ARBITRATED 表逐条落地，依据写在表里。
import { questCodeFamily } from '../../shared/quest-period'
import type { QpTask } from '../../shared/qp-types'

const RANK_VALUE: Record<string, number> = { S: 6, A: 5, B: 4, C: 3 }
/** 没写字母的「胜利」= B 判定以上（见文件头口径 1） */
const WIN_WITHOUT_LETTER = RANK_VALUE.B

const CN_DIGITS: Record<string, number> = {
  一: 1, 二: 2, 两: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
}
const NUM = String.raw`(\d+|[一二两兩三四五六七八九十]+)`
const parseCount = (raw: string): number => {
  const token = `${raw}`.normalize('NFKC').replace(/,/g, '')
  if (/^\d+$/.test(token)) return parseInt(token, 10)
  if (token.length === 1) return CN_DIGITS[token] ?? 1
  if (token.startsWith('十')) return 10 + (CN_DIGITS[token[1]] ?? 0)
  if (token.endsWith('十')) return (CN_DIGITS[token[0]] ?? 1) * 10
  const [tens, ones] = token.split('十')
  return (CN_DIGITS[tens] ?? 1) * 10 + (CN_DIGITS[ones] ?? 0)
}

// 说明句从这里截断（保留前半句）：整句丢掉会把 339/Cq3 那种「条件和进度说明挤在
// 同一句、中间只有一个空格」的 memo2 一起丢掉，而条件就在前半句里。
const ADVICE = /建议|建議|推荐|推薦|注意|待验证|待驗證|需验证|需驗證|据说|據說|疑似|参见|參見|奖励|獎勵|前置|完成度变化|完成度變化|进度变化|進度變化|根据提督|根據提督|可利用|不确定|不確定/

// 出击/海域这类**另一半要求**：只生成演习那一格会提前判完成，整条不做。
// 「补给舰」「海防舰」「改装」这些词长得像但不是要求，所以列的是动词与图号，不是名词碎片。
// 图号那一项要挡住年份区间：「2018-2024秋季大演习」里的「8-2」不是海域号。
const OTHER_ACTION = /出击|出擊|出撃|BOSS|ボス|海域|远征|遠征|开发|開發|建造|解体|解體|废弃|廢棄|入渠|改修|(?<!\d)[1-9]\s*-\s*[1-9](?!\d)/

// 本地判不了的门（库存/装备）：计数照给，但整项不等于可交付 → partial。
// 要求「动词 + 数量 + 量词」同现，「装备充实」「北方再突入而准备」这类叙述不算。
const EXTRA_PREPARATION = new RegExp(
  String.raw`(?:装备|裝備|准备|準備|持有|保有)[^，。！!,]{0,12}?${NUM}\s*(?:个|個|件|艘|只|架|门|門)`,
)

const NO_RANK = /无论胜负|無論勝負|不论胜负|不論勝負|胜负不限|勝負不限|不问胜负|不問勝負/
// 「A/S胜」= 两个字母里较低的那个才是下限
const RANK_PAIR = new RegExp(String.raw`([SABC])\s*[/／]\s*([SABC])\s*(?:胜|勝)`)
// 字母之后允许夹「判定」「以上」「及」「的」和各种收尾括号，再接「胜」；
// 或者字母之后直接就是「判定」。336/C37 的「A及以上胜利四次」、364/C73 的「“S判定”胜利」
// 都卡在这个夹层上——只认「字母紧挨着胜」的话这两条会掉回没写字母的 B。
const AFTER_LETTER = new RegExp(
  String.raw`^\s*([?？])?\s*(?:判定)?\s*[】\]」』）)”"’']*\s*(?:以上|及|或|的|之上|更高)*\s*[】\]」』）)”"’']*\s*(?:胜|勝)`,
)
const AFTER_LETTER_JUDGE = /^\s*([?？])?\s*判定/
const UNLETTERED_QUESTION = /[?？]\s*(?:胜|勝)/
const ANY_WIN = /胜|勝|判定/

interface RankRead {
  rank: number
  /** 正文把评价写明白了；false = 我们是在没有明说的情况下取的值，要标 ≈ */
  sure: boolean
}

const readRank = (text: string): RankRead | null => {
  if (NO_RANK.test(text)) return { rank: 0, sure: true }
  const pair = text.match(RANK_PAIR)
  if (pair) return { rank: Math.min(RANK_VALUE[pair[1]], RANK_VALUE[pair[2]]), sure: true }
  for (let index = 0; index < text.length; index += 1) {
    const value = RANK_VALUE[text[index]]
    if (value === undefined) continue
    const rest = text.slice(index + 1)
    const hit = rest.match(AFTER_LETTER) ?? rest.match(AFTER_LETTER_JUDGE)
    if (hit) return { rank: value, sure: !hit[1] }
  }
  // 「?胜」而问号前没有字母：无从取值，落「胜负不限」并标 ≈（偏松，会多计）
  if (UNLETTERED_QUESTION.test(text)) return { rank: 0, sure: false }
  if (ANY_WIN.test(text)) return { rank: WIN_WITHOUT_LETTER, sure: true }
  return null
}

// 次数取**第一个**「数字 + 次/回/场」。量词是判别线：正文里的「4艘」「3只」「2号舰」
// 「五选三」「(10月)」都不带这三个量词，所以不会被当成次数。
const COUNT = new RegExp(String.raw`${NUM}\s*(?:次|回|场|場)`)
const readCount = (text: string): number | null => {
  const hit = text.normalize('NFKC').match(COUNT)
  return hit ? parseCount(hit[1]) : null
}

/** 逐句截断说明句之后剩下的正文。 */
const bodyOf = (text: string): string => {
  const out: string[] = []
  // 句号/叹号/换行断句，**问号不断**：「取得1次S?胜」里的问号是评价存疑的标记，
  // 拿它断句会把字母和「胜」劈到两半，判别线当场失效（原型踩过）。
  for (const sentence of `${text ?? ''}`.normalize('NFKC').split(/[。．！!\n]/)) {
    const cut = sentence.search(ADVICE)
    const body = cut < 0 ? sentence : sentence.slice(0, cut)
    if (body.trim()) out.push(body)
  }
  return out.join(' ')
}

export interface DerivedPracticeRule {
  tasks: QpTask[]
  /** 评价或次数是我们在正文没明说的情况下取的 */
  approx: boolean
  /** 计数满 ≠ 整项可交付（还有本地判不了的装备/库存门） */
  partial: boolean
  notes: string[]
}

// ---- 仲裁台账（依据一律是游戏自己的日文原文，不是第二个解码器的编码）----
//
// 36 条逐条核过日文原文，只有这一条中文译文与原文对不上：
//
//   343/C46「航空母舰演习」——日文原文「同艦隊で、本日中に4回以上演習で勝利せよ！」
//   通篇没有评价字母，就是「勝利」（B 判定以上）。中文 desc 与 memo2 却双双写成
//   「达成4次以上【A胜】」/「一日内A胜以上4次」——译文加戏。
//   账本从没见过这条任务（本机零样本），kcwiki-quest-req / poi-quest-goal 都无条目，
//   KC3Kai 的元数据只记次数不记评价——三方全弃权，靠的就是日文原文这一票。
//   次数 4 三方无分歧，不必改。
const ARBITRATED: Record<number, { rank?: number; count?: number; why: string }> = {
  343: {
    rank: WIN_WITHOUT_LETTER,
    why: '日文原文「本日中に4回以上演習で勝利せよ」没有评价字母，中文译文多写了一个【A胜】',
  },
}

/**
 * 从中文任务正文推导演习计数。
 * 评价与次数**各自**取「memo2 有就用 memo2，没有才读 desc」：两边互有残缺——
 * 303/Cd1 的评价只在 memo2（「无论胜负」）、次数只在 desc（「发起3次「演习」」）；
 * 377/Cy16 的 memo2 只有「年常任务(10月)」，两个数都得读 desc；
 * 365/C75 的 desc 是空的，两个数都只在 memo2 里。
 */
export const derivePracticeRule = (
  questId: number,
  code: string,
  name: string,
  desc: string,
  memo2: string,
): DerivedPracticeRule | null => {
  if (questCodeFamily(code) !== 'C') return null
  const whole = `${name ?? ''} ${desc ?? ''} ${memo2 ?? ''}`
  // 演习二字可能只出现在任务名里：355/Cy7 的 desc 与 memo2 通篇不提「演习」，
  // 只说「在一日中取得S胜利4次」，名字才是「…第一小队演习！」
  if (!/演习|演習/.test(whole)) return null

  const fromMemo = bodyOf(memo2)
  const fromDesc = bodyOf(desc)
  if (OTHER_ACTION.test(fromMemo) || OTHER_ACTION.test(fromDesc)) return null

  const notes: string[] = []
  // 两个数各自记不确定性：仲裁只清掉它真正裁到的那一个，
  // 一刀清空会把「次数是我们猜的」这件事顺手抹掉。
  let rankApprox = false
  let countApprox = false
  const rankRead = readRank(fromMemo) ?? readRank(fromDesc)
  let rank = rankRead?.rank ?? 0
  if (!rankRead) {
    rankApprox = true
    notes.push('正文没写评价，按「胜负不限」落地并标 ≈（偏松，会多计）')
  } else if (!rankRead.sure) {
    rankApprox = true
    notes.push('正文对评价自标存疑（「?胜」），原样传递不确定性')
  }

  let count = readCount(fromMemo) ?? readCount(fromDesc)
  if (count == null) {
    // 301/C1「与其他提督进行「演习」！」这类没写次数的，最小读法是一次。
    // 偏紧（真要多次的话我们会漏计，是软信号），比凭空猜一个数诚实。
    count = 1
    countApprox = true
    notes.push('正文没写次数，按最小读法取 1 并标 ≈')
  }

  const ruling = ARBITRATED[questId]
  if (ruling) {
    if (ruling.rank !== undefined) {
      rank = ruling.rank
      rankApprox = false
    }
    if (ruling.count !== undefined) {
      count = ruling.count
      countApprox = false
    }
    notes.push(ruling.why)
  }

  const partial = EXTRA_PREPARATION.test(`${desc ?? ''}`) || EXTRA_PREPARATION.test(`${memo2 ?? ''}`)
  if (partial) notes.push('正文还要求装备/准备某物，计数满不等于可交付')
  return {
    tasks: [{ kind: 'exercise', rank, count, slot: 0 }],
    approx: rankApprox || countApprox,
    partial,
    notes,
  }
}
