// kc9998（深海战斗音轨）的**档名 → 深海形态 mstId** 反解。
//
// ---- 为什么需要它 ----
// 深海音轨不走舰娘那套混淆算法，官方下发的是一串裸数字（`/kcs/sound/kc9998/3505871.mp3`）。
// 玩家在战斗里听过的那些，实物已经躺在语音档案里；可台词卷的深海支只显示
// **文本源认领过的**那几条，于是「档案里有、界面上没有」——按用户定的口径
//（不展示代表没有），那等于谎称这个形态不说话。要把档案里的音轨摆出来，
// 就得先回答「这一条是谁的」。
//
// 既有的那条路（modules/ji 装配 `abyssSubtitleByMst` 时用的）是**先认名字再对锚点**：
// 拿 subtitle-enemies 那一行写的深海舰名去查 mstId，再用「档名里是否嵌着这个号」确认。
// 它只对**已经有文本的**档名成立——而这里要处理的恰恰是文本源没收的那些。
//
// ---- 档名的结构（2026-08-23 拿随包 subtitle-enemies 309 条逐条对出来的）----
//   档名 = 前缀(2~3 位) + 形态号(3~4 位) + 行号(1~2 位)
//     · 形态号 3 位 → mstId = 1000 + 它（`665` → 1665 砲台小鬼）；
//     · 形态号 4 位、首位是 0 → 同上（`0587` → 1587 北方棲姫）；
//     · 形态号 4 位、首位非 0 → 它本身就是 mstId（`1722` → 1722 護衛棲姫；`2059` → 2059）。
//     · 行号是场合：1~5，或 10/11/20/21/…/50/51（老档名用一位，新档名用两位）。
//       **首位是場合号**（1 開幕前 / 2 砲撃 / 3 被弾 / 4 撃沈 / 5 未知），个位分不出名堂——
//       两者的实测依据、以及「为什么随包那两个 slot/suffix 字段不算证据」，
//       见下半篇「行号 → 场合名」那一段。
//       上界 5 是**本机实测顶出来的**：随包那 309 条只到 4，而本机未匹配台账里
//       軽巡ム級（2317）的三条是 `611231720 / …730 / …750`——同一前缀、同一形态号，
//       行号 50 确实存在。把上界卡在 4 会让那一条永远解不出归属。
//
// ---- 这不是猜的：怎么验的 ----
// 随包 subtitle-enemies 有 309 条档名，其中 234 条能由「行里写的深海舰名 + 档名里嵌着
// 它的号」独立锚定归属。拿上面的结构规则去解这 309 条：
//   · 309 条**全部**只解出唯一一个合法深海 mstId（0 条多解、0 条无解）；
//   · 与那 234 条独立锚点逐条对照，**0 条冲突**；
//   · 剩下 75 条是名字这条路认不出来的（译名对不上、同名多形态），结构规则照样解得出。
// 另拿本机未匹配台账里的 25 条 kc9998 复核过一遍（那些是玩家真在战斗里听到、
// 而文本源一条都没认领的），25 条全部解出归属，且同一形态的几条互相印证。
// 行号那两条约束是要害：放宽成「任意 1~2 位数字」会让 14 条出现两解
//（`28205971` 既能读成 2059 也能读成 1597）。别照直觉放宽，先重跑这次对账。
//
// ---- 多解就是不解 ----
// 解出两个以上合法候选时返回 null——**不取第一个**。这一族的错法是「把 A 的声音
// 摆到 B 名下」，而界面上它和对的长得一模一样。宁缺毋滥。

/** 档名的三段：前缀、形态号、行号。行号的取值被收窄成实测过的那几种。 */
const HEAD_LENGTHS = [2, 3] as const
const TAIL_PATTERNS: Record<number, RegExp> = {
  1: /^[1-5]$/, // 老档名：場合号本身
  2: /^[1-5][01]$/, // 新档名：場合号 ×10 + 个位（个位分不出名堂，见下半篇「只认族，不认个位」）
}

export interface AbyssVoiceFileParse {
  mstId: number
  /**
   * 行号（档名末 1~2 位）。**同一个 mstId 由两种读法解出、而两种读法的行号不一致时为 null**
   * ——归属那一层判得出（两条路指向同一个形态），场合这一层判不出，那就只沉默这一层。
   */
  lineNo: string | null
}

/**
 * 档名 → { 形态号, 行号 }。解不出、或解出不止一个形态就返回 null。
 *
 * @param encoded      档名主体（不含 `.mp3`）。
 * @param isAbyssMstId 这个号在**当前主数据**里是不是一个深海形态。判据由调用方给：
 *                     反解要靠「候选必须真的存在」来消歧，而主数据不住在 shared 层。
 */
export const parseAbyssVoiceFile = (
  encoded: unknown,
  isAbyssMstId: (mstId: number) => boolean,
): AbyssVoiceFileParse | null => {
  const key = `${encoded ?? ''}`
  // 长度下界 = 2+3+1，上界 = 3+4+2。越界的不猜。
  if (!/^\d{6,9}$/.test(key)) return null
  const found = new Map<number, Set<string>>()
  for (const headLength of HEAD_LENGTHS) {
    for (const tailLength of [1, 2]) {
      const body = key.slice(headLength, key.length - tailLength)
      if (body.length !== 3 && body.length !== 4) continue
      const tail = key.slice(key.length - tailLength)
      if (!TAIL_PATTERNS[tailLength].test(tail)) continue
      const value = Number(body)
      const mstId = body.length === 3 || body[0] === '0' ? 1000 + value : value
      if (!isAbyssMstId(mstId)) continue
      found.set(mstId, (found.get(mstId) ?? new Set<string>()).add(tail))
    }
  }
  if (found.size !== 1) return null
  const [mstId, tails] = [...found][0]
  return { mstId, lineNo: tails.size === 1 ? [...tails][0] : null }
}

/**
 * kc9998 的档名 → 深海形态 mstId。解不出、或解出不止一个就返回 null。
 *
 * @param encoded      档名主体（不含 `.mp3`）。
 * @param isAbyssMstId 见 `parseAbyssVoiceFile`。
 */
export const abyssVoiceMstIdFromFile = (
  encoded: unknown,
  isAbyssMstId: (mstId: number) => boolean,
): number | null => parseAbyssVoiceFile(encoded, isAbyssMstId)?.mstId ?? null

// ============================================================================
// 行号 → 场合名
// ============================================================================
//
// ---- 先说这张表**不是**由什么支持的 ----
// 随包 wikiwiki-abyss-voice 每行都带着 `slot` 与 `suffix` 两个字段，看上去像是
// 「2975 行零例外的交叉证据」。**它是循环的**：两个字段都由我们自己的抓取器
//（`scripts/lib/wikiwiki-voice.mjs` 的 `abyssVoiceSuffix`）从同一个 `scene` 字符串算出来，
// 后者第一行就调用前者。拿它对账只能证明抓取器是个函数，证明不了官方档名怎么编号。
// 别把那张交叉表当依据——2026-08-23 建表时差点就当了。
//
// ---- 真正的依据：两个**互不相干**的包对撞 ----
// · subtitle-enemies 的键是**官方档名**（玩家客户端真去取的那个 URL 的文件名）；
// · wikiwiki-abyss-voice 的 `scene` 是**wiki 页面上人写的场合列**（開幕前/砲撃/被弾/…）。
// 两者唯一的公共字段是**日文原文**。于是：档名 →（本文件的反解）→ 形态 + 行号，
// 再在**同一个形态内**按日文原文折叠比对，把行号与页面场合连起来。这条路上
// 没有任何一步用到我们自己算的 `slot`/`suffix`。
//
// 2026-08-23 实测（随包 309 条档名，0 条解不出归属）：
//   · 行号取值只有 12 种：1/2/3/4 与 10/11/20/21/30/31/40/41——**全部落在四族之内**；
//   · 同形态内文本对得上的 139 条里，**136 条**的行号首位与页面场合同族：
//       首位 1 → 開幕前（含「（壊）」「（装甲破砕）」「（最終）」「（道中）」各变体）
//       首位 2 → 砲撃      首位 3 → 被弾      首位 4 → 撃沈／海域突破時
//   · 剩下 3 条是 subtitle-enemies **自己那一行坏了**，不是反例：
//       `383172231` 的 `jp` 与 `383172221` 一模一样，而它的 `zh`（「黑暗的大海……不要啊」）
//         正是 wikiwiki 该形态「被弾（装甲破砕）」那句的译文——行号 31 判被弹，反而是对的；
//       `445171130` 的 `jp`/`zh` 整条是 `445171111`（開幕前）的重复件，
//       `445171140` 摆的是該形態「被弾」那句，而它的 40 位该是撃沈（该形态的撃沈句
//         在 subtitle-enemies 里整条缺席）。这两条同属深海海月姫一家，成对损坏。
//   要复算这次对账：`test/abyss-voice-archive.test.mjs` 里那条「行号与场合同族」会当场重跑。
//
// ---- 只认族，不认个位 ----
// 「x0 / x1 要不要分成『其一 / 其二』」也量过了，结论是**不分**：
//   11 → 開幕前（装甲破砕）×2、開幕前（最終）×1      21 → 砲撃（装甲破砕）×3
//   31 → 被弾（装甲破砕）×2                          41 → 海域突破時×2、撃沈×1
// 每格只有两三例，41 那格自己就打架，而 x0 一侧同样带着「（壊）」变体
//（10 → 開幕前（壊）×3、20 → 砲撃（壊）×2）。也就是说 x1 既不等于「装甲破砕」
// 也不等于「第二句」。证据撑不起的区分就不做，两个尾数**同名**。
//
// ---- 第 5 族不给名 ----
// 反解允许行号 5/50/51（軽巡ム級 2317 的 `611231750` 是实物），但 wikiwiki 那边
// 一条第 5 族的场合都没有——随包 309 条档名里也一条都没有。**没实测过就不命名**，
// 它照旧显示「音轨 #档名」。别按十位数外推：官方在四族之外还有什么，这里答不上来。

/** 行号首位（場合号）→ 中文场合名。措辞对齐战斗域既有词汇（`mg/battle` 与 `modules/di`）。 */
export const ABYSS_VOICE_SCENES: Readonly<Record<string, string>> = {
  '1': '开幕',
  '2': '炮击',
  '3': '被弹',
  '4': '击沉',
}

/** 行号 → 场合名。表外（第 5 族、或压根没有行号）返回空串——**不猜**。 */
export const abyssVoiceSceneOfLineNo = (lineNo: string | null | undefined): string =>
  ABYSS_VOICE_SCENES[`${lineNo ?? ''}`.slice(0, 1)] ?? ''

/**
 * wikiwiki 深海页那一支的「场合」列。
 *
 * 那份包的 `scene` 只有日文（`開幕前`/`砲撃`/`被弾`），而同一页上另一支
 * （subtitle-enemies）走 `abyssVoiceRowLabel` 早就是中文了——两支不一致。
 * 中文同样不新编：包里每行都带 `suffix`（10/20/30/40），首位正是上面那张
 * 行号→场合表的族号，查一下就是同一套词。查不到就**保留原文**。
 */
export const abyssWikiVoiceScene = (suffix: unknown, rawScene: string): string =>
  abyssVoiceSceneOfLineNo(suffix == null ? '' : `${suffix}`) || `${rawScene ?? ''}`.trim()

/** 档名 → 场合名。解不出归属、行号有歧义、或行号在表外时返回空串。 */
export const abyssVoiceSceneOfFile = (
  encoded: unknown,
  isAbyssMstId: (mstId: number) => boolean,
): string => abyssVoiceSceneOfLineNo(parseAbyssVoiceFile(encoded, isAbyssMstId)?.lineNo)

/**
 * 深海台词行「场合」那一列该写什么。**两处显示共用这一个**
 *（台词卷的 subtitle-enemies 支 + 深海档案段），各写一份必然漂移，
 * 而漂移的表现是「同一条音轨在两段里叫两个名字」，不报错。
 *
 * 档名号**始终保留**：档案段那些行没有文字，同一形态的 10 与 11 都叫「开幕」，
 * 去掉号就没法指着说「我听到的是这一条」。
 */
export const abyssVoiceRowLabel = (
  encoded: unknown,
  isAbyssMstId: (mstId: number) => boolean,
): string => {
  const key = `${encoded ?? ''}`
  return `${abyssVoiceSceneOfFile(key, isAbyssMstId) || '音轨'} #${key}`
}

/**
 * 一批 kc9998 档名 → 形态 → 该形态的档名（按档名升序）。
 *
 * **解不出归属、或解出不止一个的档名整条丢掉**，不进任何形态的名下。
 */
export const groupAbyssVoiceFiles = (
  files: readonly string[],
  isAbyssMstId: (mstId: number) => boolean,
): Map<number, string[]> => {
  const out = new Map<number, string[]>()
  for (const file of files) {
    const mstId = abyssVoiceMstIdFromFile(file, isAbyssMstId)
    if (mstId == null) continue
    out.set(mstId, [...(out.get(mstId) ?? []), file])
  }
  for (const list of out.values()) list.sort((left, right) => left.localeCompare(right))
  return out
}

/**
 * 这个形态该追加哪几条档案行：归属到它、**且文本源还没摆过**的那些。
 *
 * 去重是要害：subtitle-enemies 那一组的 key 就是完整官方档名，同一条既有译文
 * 又有实物时它已经摆出来了；档案段再来一行只有编号的，就是把同一件事说两遍。
 */
export const abyssArchiveKeysFor = (
  grouped: ReadonlyMap<number, string[]>,
  mstId: number,
  shown: ReadonlySet<string>,
): string[] => (grouped.get(mstId) ?? []).filter((file) => !shown.has(file))
