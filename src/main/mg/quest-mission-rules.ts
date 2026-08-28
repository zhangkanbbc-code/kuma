// 铭 · 远征类任务的自研推导。
//
// 这一类是全库最干净的一类：判定只有「哪几个远征、各成功几次」，而**远征编号就在
// 游戏一手主数据里**——`api_mst_mission.api_disp_no` 就是正文里写的那个号
// （实测：纯数字号 disp 与 api_id 相等；带字母的 A1→100、A5→104、A6→105、
// B1→110、E2→142，全表 65 条一一对上）。所以这里零硬编码：正文写「远征A1」，
// 查 disp_no 表就得到 mission id，不必也不该去抄谁编好的数组。
//
// 正文有两种写法，两种都要认：
//   · **编号式**（memo2 常见）：「完成远征5/A1/9/18/36/40/45各一次」
//     「进行远征5、远征40、远征41、远征46、远征E2，各成功1次」
//     「4、A5（月常远征）、A6（月常远征）、B1远征，各成功1次」——最后这种把「远征」
//     二字甩到列表末尾，所以编号是按**连续的分隔号串**收的，不是逐个看前缀。
//   · **名称式**（desc 常见）：「实施远征「海上护卫任务」「兵站强化任务」…」
//     名字经主数据日文名 + kcwiki 远征包中文名两套索引解析。
//
// 三道闸门：
//  · **分类位闸门**：只处理编码首字母是 D（远征）的任务。
//  · **成功闸门**：正文必须说「成功/完成/实施/实行/进行/达成」。401/D1 的
//    「舰队出发「远征」！」「任意远征1次」是**派出**就算，不是成功才算——
//    没有这道闸会把它当成「任意远征成功 1 次」，玩家派出去了却不涨。
//  · **半解闸门**：一句里的引号名有的解得出、有的解不出（436/Dy2 把「强行侦察任务」
//    写成「强行侦查任务」），说明这句我们没读全 → 整条弃用。缺子项的清单分母偏小、
//    进度虚高，比没有追踪器更坏。全都解不出则是「这些引号根本不是远征名」，忽略即可。
//
// **日文原文是权威层**（2026-08-21 立）：437/440/445/447 四条逐条对过游戏自己的
// 日文原文，编号与次数全部对上，无需仲裁条目。
import { foldCjkVariants } from '../../shared/cjk-fold'
import { questCodeFamily } from '../../shared/quest-period'
import type { QpTask } from '../../shared/qp-types'

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

const normalizeName = (raw: string): string =>
  foldCjkVariants(`${raw ?? ''}`.normalize('NFKC').replace(/[\s「」『』【】（）()\[\]“”"'’·、]/g, ''))
    .toLowerCase()

/** disp_no 的归一：大小写与前导零都不算差异（正文写「远征4」，主数据写「04」）。 */
const normalizeDisp = (raw: string): string => {
  const token = `${raw ?? ''}`.normalize('NFKC').trim().toUpperCase()
  return /^\d+$/.test(token) ? `${parseInt(token, 10)}` : token
}

export interface MissionRuleContext {
  /** 归一 disp_no → mission id */
  missionByDisp: ReadonlyMap<string, number>
  /** 归一远征名 → mission id（主数据日文名 + kcwiki 中文名） */
  missionByName: ReadonlyMap<string, number>
}

export const buildMissionRuleContext = (
  masterRaw: any,
  expeditionData: any,
): MissionRuleContext | null => {
  const missions: any[] = masterRaw?.api_mst_mission ?? []
  if (!missions.length) return null
  const missionByDisp = new Map<string, number>()
  const missionByName = new Map<string, number>()
  for (const mission of missions) {
    const id = Number(mission?.api_id)
    if (!(id > 0)) continue
    const disp = normalizeDisp(`${mission?.api_disp_no ?? ''}`)
    if (disp) missionByDisp.set(disp, id)
    const name = normalizeName(`${mission?.api_name ?? ''}`)
    if (name) missionByName.set(name, id)
  }
  // kcwiki 远征包按 disp_no 索引；中文名经 disp 落到 mission id，同样不硬编码
  if (expeditionData && typeof expeditionData === 'object' && !Array.isArray(expeditionData)) {
    for (const [dispText, raw] of Object.entries<any>(expeditionData)) {
      const id = missionByDisp.get(normalizeDisp(dispText))
      if (!id) continue
      for (const key of ['nameZh', 'nameJp']) {
        const name = normalizeName(`${raw?.[key] ?? ''}`)
        if (name && !missionByName.has(name)) missionByName.set(name, id)
      }
    }
  }
  return { missionByDisp, missionByName }
}

// ---- 正文解析 ----

const ADVICE = /建议|建議|推荐|推薦|注意|待验证|待驗證|需验证|需驗證|据说|據說|疑似|参见|參見|奖励|獎勵|前置|完成度变化|完成度變化|进度变化|進度變化|情况下|情況下|可利用|不确定|不確定|无需|無需|只需|即可完成|显示BUG|顯示BUG/
const SUCCESS_VERB = /成功|完成|实施|實施|实行|實行|进行|進行|达成|達成|实践|敢行/
// 远征之外的另一半要求：只生成远征那几格会提前判完成，整条不做。
// **不能把「海域」列进来**：远征名本身就叫「西方海域侦察作战」「南西海域战斗警戒」，
// 正文也常写「向南方海域…」——那是远征去的地方，不是要出击。
const OTHER_ACTION = /出击|出擊|出撃|BOSS|ボス|演习胜|演習勝|废弃|廢棄|解体|解體|入渠|改修|近代化|(?<!\d)[1-9]\s*-\s*[1-9](?!\d)/
// 本地判不了的门（资材/道具库存）：计数照给，但整项不等于可交付 → partial
const EXTRA_PREPARATION = /(?:准备|準備|备好|備好|需要)[^，。！!,]{0,10}?\d{3,}/
// 引号里那串**像不像远征名**：半解闸门只在「像」的时候才咬人，
// 否则 409/D8 的「「Z1」作为秘书舰」这种舰名引号会把整条好规则误杀。
const MISSION_LIKE = /任务|任務|作战|作戦|作戰|护卫|護衛|哨戒|警戒|警备|警備|输送|輸送|运输|運輸|侦察|偵察|侦查|演习|演習|航海|接触|接觸|建设|建設|支援|急行|破坏|破壞/

const MISSION_WORD = String.raw`(?:远征|遠征)`
const DISP = String.raw`(?:\d{1,3}|[A-Za-z]\d{1,2})`
// 一串用「、，/」连起来的编号，每个编号后面可以跟一段说明括号，串里也可以重复写「远征」。
// 整串一起收是因为 437/Dy3 的写法把「远征」二字甩到了列表**末尾**
// （「4、A5（月常远征）、A6（月常远征）、B1远征」），逐个看前缀的话一个都收不到。
const RUN = new RegExp(
  String.raw`(?:${MISSION_WORD}\s*)?${DISP}(?![0-9A-Za-z])(?:\s*[、,，/／]\s*(?:${MISSION_WORD}\s*)?${DISP}(?![0-9A-Za-z])(?:\s*[（(][^）)]*[）)])?)*`,
  'g',
)
const TOKEN = new RegExp(String.raw`(?:${MISSION_WORD}\s*)?(${DISP})(?![0-9A-Za-z])`, 'g')
const QUOTED = /[「『【“"]([^」』】”"]{2,20})[」』】”"]/g

interface Ref {
  /** 同一格里的候选 mission id（「东京急行」或「东京急行(二)」共用一格） */
  ids: number[]
}

/**
 * 一串编号是不是在说远征：串里/串前/串后出现「远征」二字才算。
 * 没有这条判据的话，429/D27 的「远征B1可使用1轻巡洋舰1水上机母舰4驱逐舰完成」
 * 会把编成里的 1、1、4 当成远征 1 号、4 号。
 */
const runIsMissions = (text: string, start: number, run: string): boolean => {
  if (new RegExp(MISSION_WORD).test(run)) return true
  const before = text.slice(Math.max(0, start - 4), start)
  const after = text.slice(start + run.length, start + run.length + 4)
  return new RegExp(`${MISSION_WORD}\\s*$`).test(before) ||
    new RegExp(`^\\s*(?:号|號)?\\s*${MISSION_WORD}`).test(after)
}

const COUNT_EACH = new RegExp(String.raw`各\s*(?:成功|完成|实施|實施|进行|進行|达成|達成|取得)?\s*${NUM}\s*(?:次|回)`)
const COUNT_PLAIN = new RegExp(String.raw`(?:成功|完成|实施|實施|进行|進行|达成|達成)\s*${NUM}\s*(?:次|回)|${NUM}\s*(?:次|回)\s*(?:成功|完成)`)
// 「远征」紧跟次数、且不带「各」：这才是「任意远征 N 次」
const ANY_MISSION = new RegExp(
  String.raw`(?:任意|任一)?\s*${MISSION_WORD}[」』】”"]?\s*(?:成功|完成)?\s*${NUM}\s*(?:次|回)`,
)

// 兜底：句里只有一个孤零零的「N次」（424/Dm1「成功完成第5号远征「海上护卫任务」四次」）。
// 放在最后是因为它最容易误伤，前两条能命中就轮不到它。
const COUNT_BARE = new RegExp(String.raw`${NUM}\s*(?:次|回)`)

const readCount = (text: string): number | null => {
  const each = text.match(COUNT_EACH)
  if (each) return parseCount(each[1])
  const plain = text.match(COUNT_PLAIN)
  if (plain) return parseCount(plain[1] ?? plain[2])
  const bare = text.match(COUNT_BARE)
  return bare ? parseCount(bare[1]) : null
}

export interface DerivedMissionRule {
  tasks: QpTask[]
  approx: boolean
  partial: boolean
  notes: string[]
}

const parseOne = (
  text: string,
  ctx: MissionRuleContext,
): { refs: Ref[]; count: number | null; any: number | null } | null => {
  const refs: Ref[] = []
  const seen = new Set<number>()
  let count: number | null = null
  let any: number | null = null
  let bailed = false
  for (const rawSentence of `${text ?? ''}`.normalize('NFKC').split(/[。．！!\n]/)) {
    const cut = rawSentence.search(ADVICE)
    const sentence = cut < 0 ? rawSentence : rawSentence.slice(0, cut)
    if (!sentence.trim()) continue
    // 成功闸门：派出（401/D1「舰队出发「远征」！」）不是成功，别给它计数
    if (!SUCCESS_VERB.test(sentence)) continue

    const before = refs.length
    // 编号式
    RUN.lastIndex = 0
    for (const match of sentence.matchAll(RUN)) {
      const run = match[0]
      const runStart = match.index ?? 0
      if (!runIsMissions(sentence, runStart, run)) continue
      TOKEN.lastIndex = 0
      for (const token of run.matchAll(TOKEN)) {
        // 「远征3次成功」「(5月)」里的数字不是远征号：跟着量词/单位的一律不收。
        // 后文要从**整句**里取，不能只看这一串——「远征3」自己就是一整串，
        // 串内看不到后面那个「次」，402/Dd1 会被当成「远征 3 号」。
        const tail = sentence.slice(runStart + (token.index ?? 0) + token[0].length)
        if (/^\s*(?:次|回|月|日|点|點|艘|只|隻|个|個|名|人|级|級|h|小时|小時)/.test(tail)) continue
        const id = ctx.missionByDisp.get(normalizeDisp(token[1]))
        if (id && !seen.has(id)) {
          seen.add(id)
          refs.push({ ids: [id] })
        }
      }
    }
    // 名称式：一句里**长得像远征名**的引号要么全解得出，要么整条弃用。
    // 436/Dy2 把「强行侦察任务」写成「强行侦查任务」，解出 4 个漏 1 个——
    // 交这份清单出去，分母就少一格、进度虚高。
    QUOTED.lastIndex = 0
    const quoted = [...sentence.matchAll(QUOTED)].map((m) => m[1])
    const resolved = quoted.map((name) => ctx.missionByName.get(normalizeName(name)) ?? null)
    const hit = resolved.filter((id): id is number => !!id)
    const missed = quoted.filter((name, index) => !resolved[index] && MISSION_LIKE.test(name))
    if (hit.length && missed.length) {
      bailed = true
      break
    }
    // 「「东京急行」或「东京急行(二)」成功7次」= 两件里凑够 7 次，共用一个计数槽
    const alternative = /或|または/.test(sentence) && hit.length > 1
    if (alternative) {
      const ids = hit.filter((id) => !seen.has(id))
      for (const id of ids) seen.add(id)
      if (ids.length) refs.push({ ids })
    } else {
      for (const id of hit) {
        if (seen.has(id)) continue
        seen.add(id)
        refs.push({ ids: [id] })
      }
    }

    const sentenceCount = readCount(sentence)
    if (sentenceCount != null && count == null) count = sentenceCount
    // 「任意远征 N 次」：只有这一句没收到任何具体远征、也没写「各」时才算
    if (refs.length === before && !/各/.test(sentence)) {
      const anyHit = sentence.match(ANY_MISSION)
      if (anyHit) any = parseCount(anyHit[1])
    }
  }
  if (bailed) return null
  if (!refs.length && any == null) return null
  return { refs, count, any }
}

/**
 * 从中文任务正文推导远征清单。
 * desc 与 memo2 各解一遍取更完整的那份：两者互有残缺——437/Dy3 的 desc 把
 * 「小笠原沖哨戒線」译成「小笠原近海警戒线远征」，与远征包的「小笠原群岛哨戒线」
 * 对不上（半解 → desc 弃用），而 memo2 的「4、A5、A6、B1」编号式是干净的；
 * 反过来 426/Dq1 的 memo2 只写「前述远征各完成一次」，清单全在 desc 的括号里。
 */
export const deriveMissionRule = (
  code: string,
  desc: string,
  memo2: string,
  ctx: MissionRuleContext | null,
): DerivedMissionRule | null => {
  if (!ctx) return null
  if (questCodeFamily(code) !== 'D') return null
  const bodyDesc = `${desc ?? ''}`
  const bodyMemo = `${memo2 ?? ''}`
  if (OTHER_ACTION.test(bodyDesc) || OTHER_ACTION.test(bodyMemo)) return null

  const candidates = [parseOne(bodyMemo, ctx), parseOne(bodyDesc, ctx)]
    .filter((entry): entry is NonNullable<typeof entry> => !!entry)
  if (!candidates.length) return null
  const best = candidates.reduce((left, right) => (right.refs.length > left.refs.length ? right : left))

  const notes: string[] = []
  if (!best.refs.length) {
    // 「「远征」3次成功」——不指定远征，任意一次成功都算（missionId 0 是引擎的既定口径）
    return {
      tasks: [{ kind: 'expedition', missionId: 0, count: best.any as number, slot: 0 }],
      approx: false,
      partial: EXTRA_PREPARATION.test(bodyDesc) || EXTRA_PREPARATION.test(bodyMemo),
      notes: ['正文说的是任意远征，不指定编号'],
    }
  }
  let count = best.count
  if (count == null) {
    // 「实施远征 A、B、C」不写次数时，最小读法是各一次——445/D41 的日文原文
    // 同样只说「…を実施せよ！」而不写数字，游戏要的就是各 1 次。
    count = 1
    notes.push('正文没写次数，按「各一次」落地')
  }
  const tasks: QpTask[] = []
  best.refs.forEach((ref, slot) => {
    for (const missionId of ref.ids) tasks.push({ kind: 'expedition', missionId, count, slot })
  })
  const partial = EXTRA_PREPARATION.test(bodyDesc) || EXTRA_PREPARATION.test(bodyMemo)
  if (partial) notes.push('正文还要求准备资材，计数满不等于可交付')
  if (best.refs.some((ref) => ref.ids.length > 1)) {
    notes.push('正文用「或」列举的几个远征共用一个计数槽')
  }
  // 编号与远征名都是从游戏主数据查出来的，查不到就不会走到这里——没有需要标 ≈ 的推定
  return { tasks, approx: false, partial, notes }
}
