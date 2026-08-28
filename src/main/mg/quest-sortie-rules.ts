// 铭 · 出击类任务的自研推导 —— 纯海域与带点位两半。
//
// 出击类要判的东西比演习多一个轴：除了**评价下限**与**次数**，还有**打哪张图**。
// 前两个轴的读法与演习同源（同一份 readRank/readCount 口径，见 quest-practice-rules），
// 第三个轴才是这个模块自己的活：把中文正文里的「2-3、2-4、5-1」认成海域，
// 并且认对每一条的作用域——同一句里「5-2 5-5 6-5 各S胜两次，6-4 A胜两次」
// 是两套要求，读成一套就会把 6-4 的门槛抬到 S（By10 实例）。
//
// 三层作用域：
//
//   句（。！\n） → 分句（，；） → 空白块
//
//  · **评价与次数按分句取，取不到才向上继承整句**。B210「出击1-1、1-2、1-3、1-4击破Boss，
//    取得1次S?胜」里海域和评价分在两个分句，靠的就是这条继承。
//  · **说明句按空白块截断**，不是整句丢也不是整句留：
//    B125 的「…并取得S胜 2-2有海防舰带路」——整句丢会连 5 张图一起丢，
//    整句留会把「带路」注记里的 2-2 当成任务；按块切，前一块（5 张图 + S 胜）留、
//    后一块（带路注记）弃，正好。块内还带说明词的（B137「各取得一次S胜（需验证）」）
//    在词前截断，截完还带评价/次数/出击动词才算数——B130 的「（6-4建议携带秋津洲…」
//    截完只剩「（6-4」，什么信号都没有，于是整块作废。**建议句不得产生 task** 就是这么落的。
//
// 海域引用的两道验证：
//  · 「X-Y」必须是游戏主数据 `api_mst_mapinfo` 里真有的海域（一手），
//    这样「8-1」「1-9」这类数字对不会被当成海域号（两侧的数字/连字符否定环视
//    再挡掉「2026-08-21」这类日期）；
//  · 点位/血条引用**先试着解出来**，解不出才整条弃用。四种写法归一到同一个 ref：
//    「7-3P2」「7-5(P3)」（血条号缀在海域号后）、「7-2-2」（第三段是血条号，
//    连海域号正则的 `(?![\d-])` 都过不去，所以海域号正则自己带上了第三段）、
//    「7-2-M」（第三段直接是格子字母）、「7-4 O点」（格子字母另起一段写在后面）。
//    血条号 `P{n}` 走 quest-map-nodes 的九行校准表换成格子字母，格子字母再走
//    poi-fcd 的 route 算入边号——**边号零硬编码**，表里没有的行一律吐 null 交人裁。
//  · 到达式（「1-6到达终点」「7-4 O点到达」）出 `nodeReach`，战斗式出 `battleNode`；
//    判别线是这一格自己那段文字里有没有「胜/判定」。
//  · **多血条图的裸引用整条弃用**：不许默认取末血条。正文里出现了「血条」「X格」
//    这类我们没解析的点位词、或一格挂了两个血条号（893/Bq8 的「7-2（P1、P2）」）
//    同样整条待裁——缺子任务会让分母偏小、进度虚高。
//    解析器这道闸不松；单条能靠外部证据裁出血条号的，走下方 ARBITRATED 的 `gauges`
//    逐条放行（995/B189 的「7-3」是目前唯一一条），**边号仍由点位表现算**。
//
// 两道整条弃用闸门（缺子任务会让分母偏小、进度虚高，宁可整条不做）：
//  · **分类位闸门**：只处理编码首字母是 B（出击）的任务；
//  · **复合任务闸门**：正文除了出击还要求演习/远征/工厂动作的，整条不做。
//    只要求「准备资源/装备」的不算复合（2606Bm1：出击之外还要备好弹药铝土），
//    那是本地判不了的门，标 partial 交出去，计数照给。
//
// **日文原文是权威层**（2026-08-21 立）：中文正文是译文，会加戏也会丢字。
// EO 编成出击的那 86 条逐条对过游戏自己的日文原文——账本 questlist 的 api_detail
// 是一手，账本没见过的读任务元数据包的 desc_jp 作次级。
// 离线逐条对账（scripts/quest-selfderive-diff.mjs --self --kind=sortie）的落点是
// **结构不同 0 · 逐字吻合 75 · 仅评价不同 8 · 我方缺 3**。
// 我方缺的三条各有各的理由，都不是解析器欠债：
//   · 1019/B205、932（无 code）——quests-scn 根本没有条目，中文正文为空，无从推导；
//   · 995/B189——裸写「7-3」的多血条图，2026-08-22 按四票独立证据裁进 ARBITRATED
//     （见该表 995 条），现已解得出来。
// 评价分歧逐条走下方 ARBITRATED 台账，依据写在表里；日文原文自己也没写评价的，
// approx 就是终态，不替正文拿主意（表里同样留条目，写明「查过、确实没有」）。
//
// 对账不止 EO 那 164 条：把自研侧与线上侧（EO/kcwiki/poi 谁接住算谁）在全目录上
// 逐条比过一遍，**我方缺格 0 · 我方多格 0**，剩下的差异只有两类——
// 评价（各自在 ARBITRATED 台账里）与「1-6 终点」的两种等价写法
// （kcwiki 编 mapGoal、我们编 nodeReach[14,17]，同一刻触发的同一件事）。
import { questCodeFamily } from '../../shared/quest-period'
import { isEscortGoalMap } from '../../shared/qp-types'
import { questMapGaugeCount, questMapNodeIds, questMapSpotOf } from './quest-map-nodes'

import type { PoiFcdMapData } from './quest-map-nodes'
import type { QpMapRef, QpTask } from '../../shared/qp-types'

const RANK_VALUE: Record<string, number> = { S: 6, A: 5, B: 4, C: 3 }
/** 没写字母的「胜利」= B 判定以上：出击战斗 C 判定及以下是败北/引き分け，B 才是最低的那一档胜。 */
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

// 说明句从这里截断。比演习那份多了出击特有的几种注记：带路、走某某流、提速、
// 前置任务、任务进度档位。「虽然」是 B86 那种「虽然描述写着5艘，但6艘也行」的更正注。
const ADVICE = new RegExp([
  '建议', '建議', '推荐', '推薦', '带路', '帶路', '注意', '提速',
  '待验证', '待驗證', '需验证', '需驗證', '据说', '據說', '疑似', '虽然', '雖然',
  '参见', '參見', '奖励', '獎勵', '前置', '开放条件', '開放條件',
  '完成度变化', '完成度變化', '进度变化', '進度變化', '任务进度', '任務進度',
  '更新前', '更新后', '更新後', '不确定', '不確定', '可利用',
  String.raw`走.{0,4}流`,
].join('|'))

// 出击之外的**另一半要求**：只生成出击那一格会提前判完成，整条不做。
// 名词形态要挡住：「补给舰/补给船」是舰种，「输送作战」不是远征，「改二」不是改修。
// 全目录扫过，现役 B 族任务**一条都没触发这道闸**——留着不是为了今天，
// 是因为演习类那边真踩过（317/C15：演习胜 3 次之后还要出击），出击类迟早也会出现。
const OTHER_ACTION = new RegExp([
  '演习', '演習',
  String.raw`远征(?!舰)`, String.raw`遠征(?!艦)`,
  String.raw`开发(?!资材)`, String.raw`開發(?!資材)`,
  String.raw`(?<!大型舰|新型舰|大型|新型|高速)建造(?!材)`,
  '解体', '解體', '废弃', '廢棄', '入渠',
  '近代化改修', '改修工厂', '改修工廠',
  String.raw`补给(?!舰|船|线|路)`, String.raw`補給(?!艦|船|線|路)`,
].join('|'))

// 本地判不了的门（资源/装备准备）：计数照给，但整项不等于可交付 → partial。
const EXTRA_PREPARATION = /准备好|準備好|准备[^，。！!,]{0,10}(?:弹药|彈藥|铝土|鋁土|钢材|鋼材|燃料|资材|資材)/

// 「A/S胜」= 两个字母里较低的那个才是下限
const RANK_PAIR = new RegExp(String.raw`([SABC])\s*[/／]\s*([SABC])\s*(?:胜|勝)`)
// 字母之后允许夹「判定」「以上」「及」「的」和各种收尾括号，再接「胜」；或者字母之后直接就是「判定」。
// 「A胜以上」「S判定」「A？胜」「S?胜」都从这儿过。
const AFTER_LETTER = new RegExp(
  String.raw`^\s*([?？])?\s*(?:判定)?\s*[】\]」』）)”"’']*\s*(?:以上|及|或|的|之上|更高)*\s*[】\]」』）)”"’']*\s*(?:胜|勝)`,
)
const AFTER_LETTER_JUDGE = /^\s*([?？])?\s*判定/
// 「S胜利？」：字母在、问号落在词尾——同样是中文源对服务器口径存疑，评价照取、标 ≈
const TRAILING_QUESTION = /(?:胜|勝)利?\s*[?？]/
// 「各取得一次?胜」：问号前没有字母 = 无从取值
const UNLETTERED_QUESTION = /[?？]\s*(?:胜|勝)/
const ANY_WIN = /胜|勝|判定/
// 「并且要取得S」：字母在、「胜」字省了，而且句子到此为止。全目录扫过只有 969/B178
// 一条这么写（331/C31「取得A及以上的胜利」那类字母后面还有「胜」，走上面的常规路）。
// 收得这么紧是有意的：不加「到此为止」这道锚，「取得A级驱逐舰」之类会被当成评价。
const TAKE_LETTER_TAIL = /(?:取得|獲得|获得|達成|达成)\s*([SABC])\s*$/

interface RankRead {
  rank: number
  /** 正文把评价写明白了；false = 我们是在没有明说的情况下取的值，要标 ≈ */
  sure: boolean
}

const readRank = (text: string): RankRead | null => {
  const pair = text.match(RANK_PAIR)
  if (pair) return { rank: Math.min(RANK_VALUE[pair[1]], RANK_VALUE[pair[2]]), sure: true }
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const upper = char.toUpperCase()
    // 小写评价字母（966/B175 的「s胜各1次」是全目录唯一一处）只在**前面不粘着字母**
    // 时才认：「Boss」尾巴上的那个 s 靠这道环视挡住，不会变成 S 判定。
    const value = RANK_VALUE[char] ?? (
      char !== upper && !/[A-Za-z]/.test(text[index - 1] ?? '') ? RANK_VALUE[upper] : undefined
    )
    if (value === undefined) continue
    // 字母必须紧挨着「胜/判定」才算评价。「AO、LHA」「Samuel B.Roberts」「2DD」
    // 里的大写字母都卡在这一步，不会被当成 A 胜 / B 胜。
    const rest = text.slice(index + 1)
    const hit = rest.match(AFTER_LETTER) ?? rest.match(AFTER_LETTER_JUDGE)
    if (!hit) continue
    return { rank: value, sure: !hit[1] && !TRAILING_QUESTION.test(text) }
  }
  // 「取得S」收尾：字母写明白了，只是省了「胜」字
  const tail = text.trim().match(TAKE_LETTER_TAIL)
  if (tail) return { rank: RANK_VALUE[tail[1]], sure: true }
  // 「?胜」而问号前没有字母：无从取值，落「胜负不限」并标 ≈（偏松，会多计）
  if (UNLETTERED_QUESTION.test(text)) return { rank: 0, sure: false }
  // 只写了「胜利」没写字母：B 判定是它的可证下限，但真实要求可能更高 → 取下限并标 ≈
  if (ANY_WIN.test(text)) return { rank: WIN_WITHOUT_LETTER, sure: false }
  return null
}

/**
 * 几个候选读数里挑一个：**写明字母的优先，没有才退回没写明的**。
 *
 * 不这么挑的话，desc 里一句没写字母的「获得完全胜利」会把 memo2 里写死的「必须S胜」
 * 顶掉：B19、Bw9 两条的海域号只在 desc，评价却只有 memo2 写明白，
 * 按「先 desc 后 memo2」的顺序取就双双掉回 B（2026-08-21 实测）。
 * B78「取得1-5Boss战胜利，A胜可」是同一回事的分句版：前半句的「胜利」没字母、
 * 后半句的「A胜可」有，该听后半句的。
 */
const pickRank = (candidates: (RankRead | null)[]): RankRead | null =>
  candidates.find((read) => read?.sure) ?? candidates.find(Boolean) ?? null

// 次数取**第一个**「数字 + 次/回/场」。量词是判别线：正文里的「4艘」「3只」「2号舰」
// 「四选三」「(10月)」都不带这三个量词，所以不会被当成次数。
// 「第」要挡掉：B27 的 desc「第二次改装完成的『榛名改二』」里的「二次」是序数不是次数，
// 不挡的话这条会被读成「S 胜两次」（2026-08-21 实测）。
//
// **次数的作用域比评价窄一档**：写在「自己带海域号」的分句里的次数只归那几张图，
// 不往整句上摊。B132「出击1-6到达终点2次，分别出击4-5、5-5、6-5并取得Boss点S胜」
// 摊出去的话后三张图会跟着变成 2 次（kcwiki 独立编的是各 1 次，日文原文的「反復」
// 也只挂在 1-6 上）。评价不能照办——B178「…6-4并且要取得S」的字母就写在带海域号的
// 那一句里，靠的正是整句继承。
const COUNT = new RegExp(String.raw`(?<!第)${NUM}\s*(?:次|回|场|場)`)
const readCount = (text: string): number | null => {
  const hit = text.normalize('NFKC').match(COUNT)
  return hit ? parseCount(hit[1]) : null
}

// 「这块里有没有真要求」——说明词截断之后拿它判断残句还算不算数。
// 评价、次数、出击动词，三者有其一才留。
const REAL_DEMAND = new RegExp([
  String.raw`[SABC]\s*[?？]?\s*(?:判定|胜|勝)`, String.raw`${NUM}\s*(?:次|回|场|場)`,
  '出击', '出擊', '出撃', '展开', '展開', '进击', '進擊', '突入', '进出', '進出',
  '派赴', '派遣', '派出', '投入', '进军', '進軍', '开赴', '開赴',
  '歼灭', '殲滅', '消灭', '消滅', '击破', '擊破', '击灭', '擊滅', '击沉', '擊沉',
  '交战', '交戰', '哨戒', '巡逻', '巡邏', '警戒', '讨伐', '討伐', '迎击', '迎擊',
  '取得', '达成', '達成', '完成', '胜', '勝',
].join('|'))

// 海域号：两侧都不许再挨数字或连字符，挡住「2026-08-21」这类日期。
// 第三段是可选的血条号/格子字母（「7-2-2」「7-2-M」）——它必须写进这个正则里，
// 因为尾部的 `-2` 会卡住 `(?![\d-])`，分开扫的话 B167 会只剩 2-3、6-4 两格、
// B154 会丢掉 7-2-M 那一格，分母偏小、进度虚高（2026-08-21 实测两条都真的漏了）。
const MAP_REF = /(?<![\d-])([1-9])\s*-\s*([1-9])(?:\s*-\s*([A-Za-z]|[1-9]))?(?![\d-])/g
/** 同一条，只用来问「这个分句里有没有海域号」——`g` 标志的正则 `.test()` 有状态，别复用 */
const HAS_MAP_REF = /(?<![\d-])[1-9]\s*-\s*[1-9](?:\s*-\s*(?:[A-Za-z]|[1-9]))?(?![\d-])/
// 血条号缀在海域号后面：「7-3P2」「7-5(P3)」「5-6(P3)」
const GAUGE_SUFFIX = /^\s*[）)]?\s*[（(]?\s*[Pp]\s*([1-9])/
const GAUGE_ANY = /[Pp]\s*[1-9]/g
// 格子字母另起一段写：「7-4 O点」。(?<![A-Za-z]) 挡住「BOSS点」里的那个 S。
const SPOT_DOT = /(?<![A-Za-z])([A-Z])\s*点/g
// 正文里出现了我们没解析的点位词：整条待裁，不许当没看见
const SPOT_WORD = /血条|血條|(?<![A-Za-z])[A-Z]\s*格/
// 「到达终点」「到达资源点」「1-6完成」= 到达式，出 nodeReach 而不是 battleNode
const REACH_DEMAND = /到达|到達|抵达|抵達|完成/

export interface SortieRuleContext {
  /** 游戏主数据里真有这张图（`api_mst_mapinfo` 一手） */
  hasMap: (map: QpMapRef) => boolean
  /**
   * 正文写的点位引用 → 罗盘边号。
   * `ref` 是 `P{n}`（第几血条）/ `goal`（护航图终点）/ 单个格子字母。
   * 前两种先经九行校准表换成格子字母，字母再由 poi-fcd 的 route 算入边——
   * 表里没有那一行、或海图上算不出入边，都返回空数组（调用方据此整条待裁）。
   */
  nodesOfRef: (map: QpMapRef, ref: string) => { spot: string; nodes: number[] } | null
}

export const buildSortieRuleContext = (
  masterRaw: any,
  fcd?: PoiFcdMapData | null,
): SortieRuleContext | null => {
  const keys = new Set<string>()
  for (const info of masterRaw?.api_mst_mapinfo ?? []) {
    const area = Number(info?.api_maparea_id)
    const no = Number(info?.api_no)
    if (area > 0 && no > 0) keys.add(`${area}-${no}`)
  }
  if (!keys.size) return null
  return {
    hasMap: (map) => keys.has(`${map[0]}-${map[1]}`),
    nodesOfRef: (map, ref) => {
      // 单个字母是正文直写的格子；`P{n}`/`goal` 得先查表
      const spot = /^[A-Z]$/.test(ref) ? ref : questMapSpotOf(map, ref)
      if (!spot) return null
      const nodes = questMapNodeIds(fcd, map, spot)
      return nodes.length ? { spot, nodes } : null
    },
  }
}

/** 说明词截断：分句拆成空白块，见到说明词就在词前截断，截完没信号的整块作废，其后的块一律不要。 */
const trimAdvice = (clause: string): string => {
  const kept: string[] = []
  for (const chunk of clause.split(/\s+/)) {
    if (!chunk) continue
    const cut = chunk.search(ADVICE)
    if (cut < 0) {
      kept.push(chunk)
      continue
    }
    const prefix = chunk.slice(0, cut)
    if (REAL_DEMAND.test(prefix)) kept.push(prefix)
    break
  }
  return kept.join(' ')
}

// 「A 或 B 或 C 的 Boss 点…累积 N 次」= 三张图共用一个计数槽（任一命中即算），
// 不是各打 N 次。全目录扫下来只有 Bw7 一条这么写（海域号之间夹「或」），
// 但它是**真会算错**的那种：按各图 N 次落地，进度条会停在 1/3 永远不满。
// kcwiki 独立编成同一形状（三条 bossKill 共 slot 0，count 5），是第二票。
const SHARED_SLOT = /或|任一|任选|任選|择一|擇一|其中之一/

interface MapRef {
  map: QpMapRef
  /** 解出来的格子字母；null = 正文没指点位，落 bossKill */
  spot: string | null
  nodes: number[]
  /** 到达式（nodeReach）而不是战斗式（battleNode） */
  reach: boolean
  rank: RankRead | null
  count: number | null
  /** 同一个共享组的海域共用计数槽；null = 各占各的槽 */
  shared: number | null
}

interface TextRead {
  refs: MapRef[]
  rank: RankRead | null
  count: number | null
  /** 点位/血条引用解不出来：整条待裁，**不许默认取末血条** */
  unresolved: boolean
}

/**
 * @param gauges 逐条裁定的「这张多血条图取哪一条血条」（`"7-3" → "P2"`）。
 *   只有 ARBITRATED 里点名的那个 questId 拿得到，别的一律走原来的整条待裁。
 */
const readText = (
  raw: string,
  ctx: SortieRuleContext,
  gauges?: Record<string, string>,
): TextRead => {
  const text = `${raw ?? ''}`.normalize('NFKC')
  const refs: MapRef[] = []
  const bodies: string[] = []
  const countBodies: string[] = []
  let unresolved = false
  let sharedGroups = 0
  let spotDotsTaken = 0
  for (const sentence of text.split(/[。．！!\n｜]/)) {
    const clauses = sentence.split(/[，,；;]/).map(trimAdvice).filter((clause) => clause.trim())
    if (!clauses.length) continue
    const body = clauses.join(' ')
    bodies.push(body)
    const sentenceRank = readRank(body)
    // 整句层的次数只从「自己没写海域号」的分句里取（见 COUNT 上方的作用域说明）
    const countable = clauses.filter((clause) => !HAS_MAP_REF.test(clause))
    countBodies.push(...countable)
    const sentenceCount = readCount(countable.join(' '))
    for (const clause of clauses) {
      const clauseRank = pickRank([readRank(clause), sentenceRank])
      const clauseCount = readCount(clause) ?? sentenceCount
      const hits = [...clause.matchAll(MAP_REF)]
      // 共享槽只看**海域号之间**那一段：B117 的「三者任意一艘为旗舰」在海域号之前，
      // 判在整句上就会把「各两次」误读成「任一两次」。
      const between = hits.length >= 2
        ? clause.slice(hits[0].index ?? 0, hits[hits.length - 1].index ?? 0)
        : ''
      const shared = SHARED_SLOT.test(between) ? sharedGroups : null
      if (shared !== null) sharedGroups += 1
      for (let index = 0; index < hits.length; index += 1) {
        const hit = hits[index]
        const map: QpMapRef = [parseInt(hit[1], 10), parseInt(hit[2], 10)]
        if (!ctx.hasMap(map)) continue
        // 这一格自己的那段文字：从本海域号之后到下一个海域号之前。
        // 「各1次S胜」是谁的、「到达终点」是谁的，靠的就是这条边界——966/B175 的
        // 「…7-3P2 s胜各1次  7-4 O点到达1次」同一分句里两格两种口径。
        const start = (hit.index ?? 0) + hit[0].length
        const segment = clause.slice(start, hits[index + 1]?.index ?? clause.length)
        const third = hit[3]
        const suffix = segment.match(GAUGE_SUFFIX)
        const dots = [...new Set([...segment.matchAll(SPOT_DOT)].map((m) => m[1]))]
        let ref: string | null = null
        if (third) {
          // 「7-2-2」= 第二血条；「7-2-M」= 格子字母
          ref = /^\d$/.test(third) ? `P${third}` : third.toUpperCase()
        } else if (suffix) {
          // 一格挂两个血条号（893/Bq8 的「7-2（P1、P2）」）：解成一个会漏掉另一个，整条待裁
          if ((segment.match(GAUGE_ANY) ?? []).length > 1) unresolved = true
          else ref = `P${suffix[1]}`
        } else if (dots.length === 1) {
          ref = dots[0]
          spotDotsTaken += 1
        } else if (dots.length > 1) {
          unresolved = true
        } else if (isEscortGoalMap(map)) {
          // 护航图 1-6 没有 Boss：「到达终点/资源点」「1-6完成」说的都是终点那一格。
          // 没有到达信号就说不清要什么（还有 mapGoal / nodeReach 的分叉），交人裁。
          if (REACH_DEMAND.test(segment)) ref = 'goal'
          else unresolved = true
        } else if (questMapGaugeCount(map) > 0) {
          // 点位表里登记过血条 Boss 的图（7-2/7-3/7-5/5-6）裸引用即歧义。
          // 这一条被逐条裁定过的（ARBITRATED 的 gauges）才按裁定的血条号走，
          // 其余照旧整条待裁——**不许默认取末血条**。
          const arbitrated = gauges?.[`${map[0]}-${map[1]}`]
          if (arbitrated) ref = arbitrated
          else unresolved = true
        }
        if (ref === null) {
          refs.push({
            map, spot: null, nodes: [], reach: false, rank: clauseRank, count: clauseCount, shared,
          })
          continue
        }
        const resolved = ctx.nodesOfRef(map, ref)
        if (!resolved) {
          // 校准表里没有这一行，或者海图上算不出入边——不补一个 0 号边冒充
          unresolved = true
          continue
        }
        refs.push({
          map,
          spot: resolved.spot,
          nodes: resolved.nodes,
          // 「胜/判定」优先：写着要打赢就是战斗式，哪怕这段里还带个「完成」
          reach: REACH_DEMAND.test(segment) && !ANY_WIN.test(segment),
          rank: clauseRank,
          count: clauseCount,
          shared,
        })
      }
    }
  }
  const whole = bodies.join(' ')
  // 正文里还留着没被任何一格认领的点位词：整条待裁，不许当没看见
  if (SPOT_WORD.test(whole)) unresolved = true
  if ([...whole.matchAll(SPOT_DOT)].length > spotDotsTaken) unresolved = true
  return { refs, rank: readRank(whole), count: readCount(countBodies.join(' ')), unresolved }
}

export interface DerivedSortieRule {
  tasks: QpTask[]
  /** 评价或次数是我们在正文没明说的情况下取的 */
  approx: boolean
  /** 计数满 ≠ 整项可交付（还有本地判不了的资源/装备门） */
  partial: boolean
  notes: string[]
}

// ---- 待裁台账：人工确认过「这一条不许猜」的那些 ----
//
// 这不是「还没写的正则」，是**信息本身不在正文里**。表在解析之前就生效：
// 列在这里的一律整条不做。留条目是为了挡住两件事——下次有人拿上游的编码把它焊死，
// 以及下次有人把它当成解析器的漏去「修」。
//
// 为什么用逐条台账而不是再写一条正则：成因是「中文 memo2 自己用『其余』指代没点名的图」，
// 全目录只有这一例。从一例泛化出一族正则，误伤的是那些长得像、其实没问题的条目——
// 902/B141「+0-2只其他舰娘 出击1-5,1-6…」与 933/B159「+其他分别出击1-3、1-4…」
// 就都写着「其他…出击」，而它们的海域号一个不缺，本来解得好好的。
// 2026-08-22 起表空：唯一住户 880/B115（memo2 用「其余」指代 desc 才点名的三张图）
// 经用户拍板收进 ARBITRATED 人工手写四格（见该表 880 条）。泛化正则的禁令不变——
// 新出现同族「代词跨文指代」仍是先进这张表待裁，不是去改解析器。
export const SORTIE_UNRESOLVED: Record<number, string> = {}

// ---- 仲裁台账（依据一律是游戏自己的日文原文，不是第二个解码器的编码）----
//
// 定式：**日文原文 > 账本回放实测 > 三方两票 > approx**。
// 表里四类条目：
//  · `rank` 有值 = 评价裁出来了，按它落地（≈ 保留，因为裁到的是「较松者」而不是原文写死的）；
//  · `tasks` 有值 = **整条由人工裁定**，解析器不参与（正文根本区分不出任务类型的那种）；
//  · `gauges` 有值 = 多血条图的裸引用由外部证据裁出是哪一条血条，**只对这一个 questId 生效**：
//    解析器那道「裸引用即歧义」的闸一点没松（换个 id 跑同一段文字仍是 null），
//    而边号照旧由点位表 + poi-fcd 现算，这里一个数字都不写死；
//  · 只有 `why` = 查过日文原文，原文自己也没写评价，approx 就是终态。
const ARBITRATED: Record<
  number,
  { rank?: number; tasks?: QpTask[]; gauges?: Record<string, string>; why: string }
> = {
  1005: {
    rank: RANK_VALUE.A,
    why:
      '中文「取得A胜各1次」与 EO 的 S 反向冲突。日文原文「…北方海域キス島沖を哨戒、敵戦力を捕捉、' +
      'これを撃破せよ！」通篇没有评价字母，裁不动；KC3Kai 元数据只记「4 个槽各 1 次」不记评价，' +
      '第三票弃权。按「三方无两票即取较松者 + ≈」落中文的 A（偏松、会多计，比偏紧诚实）',
  },
  1006: {
    rank: RANK_VALUE.A,
    why:
      '同 1005 的反向冲突。日文原文「…南西諸島防衛線を哨戒、敵戦力を捕捉、これを撃破せよ！」' +
      '同样没有评价字母；KC3Kai 元数据无评价字段。取较松者 = 中文的 A，标 ≈',
  },
  911: {
    why:
      '正文「的Boss点各达成1次？胜利」问号前无字母。日文原文（账本 questlist 一手）' +
      '「…製油所地帯沿岸、南西諸島防衛線、鎮守府近海、バシー海峡、東部オリョール海に展開、' +
      '敵を撃破せよ！」同样没有评价字母 → ≈ 是终态，不按 EO 的 S 焊死',
  },
  925: {
    why:
      'memo2 是空的，desc 只说「歼灭各方向的敌方战力」，全无评价。日文原文' +
      '「…カレー洋リランカ島沖、北方海域全域、南方海域珊瑚諸島沖に展開！各方面の敵戦力を撃滅せよ！」' +
      '同样没有评价字母 → ≈ 是终态',
  },
  1044: {
    why:
      '正文「各取得1次?胜」问号前无字母。日文原文「…サーモン海域北方、グアノ環礁沖海域に展開！' +
      '出没する敵艦隊主力を捕捉、これを全力で撃滅せよ！」同样没有评价字母 → ≈ 是终态',
  },
  945: {
    rank: RANK_VALUE.A,
    why:
      '中文「1-5 2-1 S胜各两次」与 EO 的 A 冲突，方向与 1005 相反（这次是中文更严）。' +
      '日文原文（账本 questlist 一手）「…反復出撃！鎮守府近海、南西諸島近海、鎮守府近海航路の' +
      '安全確保と対潜掃蕩を図れ！」通篇没有评价字母，裁不动；KC3Kai 元数据只记' +
      '「3 个槽各 2 次」的结构（与本条三格 ×2 吻合）不记评价，第三票弃权。' +
      '按「三方无两票即取较松者 + ≈」落 A——别一刀切「信中文」，1005 那次较松的恰好是中文侧',
  },
  878: {
    why:
      '中文「可能需要1-4胜利3次」没写评价字母，按「胜利 = B 判定下限」落地并标 ≈。' +
      '日文原文「…防衛ラインの強化のため、南西諸島防衛線及び鎮守府近海航路における作戦を' +
      '継続的に成功させよ！」同样没有评价字母；KC3Kai 元数据只记前置解锁不记评价。' +
      '→ ≈ 是终态，不按 EO 的 A 焊死（B 比 A 松，与 ≈ 的「可能多计」同向）',
  },
  1023: {
    why:
      '正文「各取得一次?胜」问号前无字母。日文原文（账本 questlist 一手）' +
      '「…沖ノ島海域、沖ノ島沖、タウイタウイ泊地沖(深部)、サーモン海域北方に出撃！' +
      '「鳥海」を護衛しつつ、遊弋する敵を痛打せよ！」同样没有评价字母 → ≈ 是终态',
  },
  1041: {
    why:
      '正文「各取得1次?胜」问号前无字母，与 1023 同一族写法。日文原文（任务元数据 desc_jp）' +
      '「…ブルネイ泊地沖、タウイタウイ泊地沖(深部)に展開！出没する敵艦隊を捕捉、' +
      'これを痛打撃滅せよ！」同样没有评价字母 → ≈ 是终态',
  },
  967: {
    // 全库唯一一条 mapFirstClear。正文区分不出「打 Boss」和「破血条」，解析器让位人工。
    tasks: [{ kind: 'mapFirstClear', map: [7, 4], count: 1, slot: 0 }],
    why:
      'memo2 只有「7-4 血条击破」四个字。「血条击破」= 把该海域的攻略血条打空，' +
      '游戏在那一战的 battleresult 里自报 api_first_clear=1；而「Boss 战取胜」每次都算——' +
      '两者在中文正文里长得一样，落 bossKill 会把「每次打 Boss」当成「通关」，一路多计。' +
      '日文原文「ヒ船団海上護衛任務：…昭南本土航路における作戦を完遂し、…護り抜け！」' +
      '说的是「作戦を完遂」（把这一图的作战做完），不是「敵を撃破」，与血条口径一致；' +
      '本条又是单次任务（B176），一次通关即完。→ 人工裁定为 mapFirstClear x1，' +
      '这属于九行校准表同族的「少量人工」预算，不是解析器欠债',
  },
  880: {
    // 此前整条弃权、由 kcwiki-quest-req 那层接住；手写进这里是为了把出击域最后一个
    // 外部委托点收回——上游哪天改了编码，880 也不会悄悄失去精确计数。
    tasks: [
      { kind: 'mapGoal', map: [1, 6], count: 1, slot: 0 },
      { kind: 'bossKill', map: [2, 3], rank: RANK_VALUE.A, count: 1, slot: 1 },
      { kind: 'bossKill', map: [3, 2], rank: RANK_VALUE.A, count: 1, slot: 2 },
      { kind: 'bossKill', map: [4, 2], rank: RANK_VALUE.A, count: 1, slot: 3 },
    ],
    why:
      'memo2「4驱逐+2自由「1-6」到达资源点，其余在Boss点A胜以上即可」——「其余」指代 ' +
      'desc 才点名的 2-3、3-2、4-2 三张图，memo2 自认不完整；按「memo2 有海域就不读 desc」' +
      '的口径只会解出 1-6 一格，分母偏小、进度虚高。全目录仅此一例代词跨文指代，' +
      '为一例泛化正则会误伤 902/B141、933/B159 那类「其他…出击」而海域号齐全的条目，' +
      '故解析器闸门不松，整条人工手写。四格依据：图名与评价（A 胜以上）来自 desc+memo2 ' +
      '第一方正文；1-6 那格是到达终点不看评价，编码取 mapGoal（与 nodeReach[14,17] 等价，' +
      '见文件头对账注）；次数「各 1 次」正文没写，来自 kcwiki 独立编码（四格结构与其' +
      '逐格吻合，当印证票）——所以 ≈ 保留，不装成正文写明过。' +
      '编成门（4驱逐+2自由）由编成规则另出，这里不重复',
  },
  995: {
    // 2026-08-22 裁定。此前整条挂在 SORTIE_UNRESOLVED 里（全目录唯一一条未覆盖，
    // 精确计数 643/644）——当时手上只有日文原文一票，而它没写血条号，裁不动。
    // 四票独立证据凑齐后改判：裁的是「7-3 指的是哪一条血条」，不是「解析器该不该猜」。
    gauges: { '7-3': 'P2' },
    why:
      'memo2 裸写「3-2、5-3、6-4、7-3各取得一次S胜」，7-3 是两个血条的图，裸引用本身有歧义。' +
      '日文原文（账本 questlist 一手）「…南西海域ペナン島沖深部の敵戦力を撃滅せよ！」' +
      '只有图名没有血条号，单凭它裁不动。四票独立证据一致指向第二血条（P 点）：' +
      '① 攻略侧多站实测共识写的是「7-3-2」（zekamashi 等），即第二血条；' +
      '② 上游 EO 的独立编码把这一格记成入边 [18,23,24,25] 并自标「-2」，' +
      '而 [18,23,24,25] 恰好就是点位表 7-3 P2→P 格由 poi-fcd 算出的入边集合，' +
      '两边各自成路却落到同一格（EO 只当一票，注明参考；边号仍是我们自己算的）；' +
      '③ 中文 desc 把它译作「南西海域槟榔屿海域深处」——「深处/深部」在 7-3 上落在第二段作战；' +
      '④ 反证：攻略页给的第一血条编成里不含本任务必需的深雪改二 + 吹雪级，' +
      '一血那一段不是这条任务的作战面。' +
      '→ 裁定 7-3 取第二血条（P 点），S 胜 ×1；编成门（深雪改二 + 吹雪级 1 艘）由编成规则另出。' +
      '评价与次数正文都写明了（「各取得一次S胜」），这一条**不带 ≈**。' +
      '注意裁定只挂在本 questId 上：解析器的「多血条裸引用即歧义」一点没松',
  },
}

/**
 * 从中文任务正文推导出击计数（纯海域 + 带点位）。
 *
 * 海域引用**先读 memo2，memo2 一个都没有才读 desc**：memo2 是攻略体（「出击2-3、2-4各1次S胜」），
 * desc 是叙述体，海域多半只有中文名。评价与次数则是**各自**回退——B86 的海域只在 desc
 * （memo2 通篇没写海域号）、评价只在 memo2（「Boss战S胜」），两个轴绑在一起取会丢掉其中一个。
 *
 * **不建中文海域名索引**，这是有实测依据的取舍：原型 v4 拿主数据 + 本地化包合成过一份
 * 133 条的名字索引，结果 B208 的 desc 写「冲之岛海域」被认成 2-4、memo2 的数字写的却是 2-5，
 * B214 同样多出一条 2-4——名字索引正是「desc 过采」的来源。而 EO 覆盖的这 86 条里，
 * 海域号在 memo2 或 desc 里**逐条都有阿拉伯数字写法**（例外的 1019/932 连中文正文都没有，
 * 见 quests-scn 无条目），索引救不到任何一条。等到真出现「只有中文名」的任务再说。
 */
export const deriveSortieRule = (
  questId: number,
  code: string,
  desc: string,
  memo2: string,
  ctx: SortieRuleContext,
): DerivedSortieRule | null => {
  if (questCodeFamily(code) !== 'B') return null
  if (SORTIE_UNRESOLVED[questId]) return null
  const both = `${desc ?? ''} ${memo2 ?? ''}`
  if (OTHER_ACTION.test(both)) return null

  const manual = ARBITRATED[questId]
  if (manual?.tasks) {
    // 人工裁定的整条：解析器不参与，但仍标 ≈——正文区分不出来这件事本身就是不确定
    return { tasks: manual.tasks.map((task) => ({ ...task })), approx: true, partial: false, notes: [manual.why] }
  }

  const fromMemo = readText(memo2, ctx, manual?.gauges)
  const fromDesc = readText(desc, ctx, manual?.gauges)
  const picked = fromMemo.refs.length ? fromMemo : fromDesc
  const other = fromMemo.refs.length ? fromDesc : fromMemo
  if (!picked.refs.length) return null
  // 点位/血条引用解不出来就整条弃用：多血条图的裸引用是歧义，护航图还有 goal 分叉。
  // **不许默认取末血条**——猜一个等于悄悄编数据。逐条依据见 UNRESOLVED 台账。
  if (picked.unresolved) return null

  const notes: string[] = []
  let approx = false
  const tasks: QpTask[] = []
  const seen = new Set<string>()
  const slotOfGroup = new Map<number, number>()
  for (const ref of picked.refs) {
    // 去重按「图 + 点位」：同一张图的两个血条是两格要求，按图去重会吃掉一格
    const key = `${ref.map[0]}-${ref.map[1]}${ref.spot ? `:${ref.spot}` : ''}`
    if (seen.has(key)) continue
    seen.add(key)
    const rankRead = pickRank([ref.rank, picked.rank, other.rank])
    // 到达式不看评价：走到那一格就算，正文的「S胜」是给别的格子写的
    if (!ref.reach) {
      if (!rankRead) {
        approx = true
        notes.push(`${key} 正文没写评价，按「胜负不限」落地并标 ≈（偏松，会多计）`)
      } else if (!rankRead.sure) {
        approx = true
        notes.push(`${key} 正文对评价自标存疑或未写字母，原样传递不确定性`)
      }
    }
    const count = ref.count ?? picked.count ?? other.count
    if (count == null) notes.push(`${key} 正文没写次数，按最小读法取 1`)
    let slot = tasks.length
    if (ref.shared !== null) {
      const existing = slotOfGroup.get(ref.shared)
      if (existing === undefined) {
        slotOfGroup.set(ref.shared, slot)
        notes.push(`${key} 起的这一组海域用「或」并列，共用一个计数槽（任一命中即算）`)
      } else slot = existing
    }
    if (ref.spot && ref.reach) {
      notes.push(`${key} 是到达式：走到 ${ref.spot} 格（入边 ${ref.nodes.join('/')}）即算，不看评价`)
      tasks.push({ kind: 'nodeReach', map: ref.map, count: count ?? 1, nodes: ref.nodes, name: ref.spot, slot })
    } else if (ref.spot) {
      notes.push(`${key} 指定点位 ${ref.spot}，入边 ${ref.nodes.join('/')} 由 poi-fcd 算出`)
      tasks.push({
        kind: 'battleNode',
        map: ref.map,
        rank: rankRead?.rank ?? 0,
        count: count ?? 1,
        nodes: ref.nodes,
        name: ref.spot,
        slot,
      })
    } else {
      tasks.push({ kind: 'bossKill', map: ref.map, rank: rankRead?.rank ?? 0, count: count ?? 1, slot })
    }
  }
  if (!tasks.length) return null

  const ruling = ARBITRATED[questId]
  if (ruling) {
    if (ruling.rank !== undefined) {
      // 到达式没有评价这一轴，改不着它
      for (const task of tasks) {
        if (task.kind === 'bossKill' || task.kind === 'battleNode') task.rank = ruling.rank
      }
      approx = true // 裁出来的是「较松者」，不是原文写死的 → ≈ 保留
    }
    notes.push(ruling.why)
  }

  const partial = EXTRA_PREPARATION.test(`${desc ?? ''}`) || EXTRA_PREPARATION.test(`${memo2 ?? ''}`)
  if (partial) notes.push('正文还要求备好资源/装备，计数满不等于可交付')
  return { tasks, approx, partial, notes }
}
