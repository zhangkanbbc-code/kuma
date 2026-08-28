import { SHIP_NATIONALITIES } from '../shared/ship-nationality'

export interface TaskEntityIndex {
  id: number
  name: string
  simple: string
  aliases: string[]
}

export interface TaskEntityHit<T extends TaskEntityIndex = TaskEntityIndex> {
  entry: T
  alias: string
  start: number
  length: number
}

export interface TaskEntityAliasCandidate<T extends TaskEntityIndex = TaskEntityIndex>
  extends TaskEntityHit<T> {
  text: string
}

export interface TaskEntityMatchOptions<T extends TaskEntityIndex = TaskEntityIndex> {
  skipClassSuffix?: boolean
  allowQuotedSingle?: boolean
  limit?: number
  acceptAlias?: (candidate: TaskEntityAliasCandidate<T>) => boolean
}

// 日文汉字／繁体 → 简体近似（实体名是日文，任务库主要是简中；模糊匹配用）。
//
// 这张表两边都会跑一遍，所以它做的是**归并**而不是翻译：只要同一个词在两边
// 归到同一形，匹配就成立，误把「联合舰队」归成「连合舰队」也无所谓——索引那边
// 一样会归。也因此宁可多归一个字，也别漏。
//
// 繁体那一批是被实测逼出来的：kcwiki 的限时任务正文常直接贴繁中，
// 「塔斯卡盧薩」「甘比爾灣」「濱波」在库里都写成繁体，而索引里是简体译名，
// 逐字对不上就整艘认不出来。装备名那批相反——文本写简体「机铳」「技术」，
// 索引里是日文原名「機銃」「技術」。
export const JP2CN: Record<string, string> = {
  時: '时', 雲: '云', 風: '风', 龍: '龙', 鳳: '凤', 島: '岛', 對: '对', 護: '护',
  戰: '战', 戦: '战', 潛: '潜', 艦: '舰', 機: '机', 砲: '炮', 雷: '雷', 詳: '详',
  報: '报', 復: '复', 設: '设', 図: '图', 圖: '图', 資: '资', 發: '发', 済: '济',
  縦: '纵', 練: '练', 連: '连', 裝: '装', 補: '补', 給: '给', 遠: '远', 徵: '征',
  國: '国', 鶴: '鹤', 摩: '摩', 藏: '藏', 澤: '泽', 濃: '浓', 賀: '贺', 陽: '阳',
  長: '长', 榛: '榛', 霧: '雾', 綾: '绫', 敷: '敷', 電: '电', 響: '响', 曉: '晓',
  雪: '雪', 谷: '谷', 満: '满', 潮: '潮', 華: '华', 鳥: '鸟', 沖: '冲', 縄: '绳',
  計: '计', 闘: '斗', 乗: '乘', 勲: '勋', 強: '强', 増: '增',
  員: '员', 噴: '喷', 進: '进', 備: '备', 製: '制', 試: '试', 開: '开', 発: '发',
  // 繁中任务正文里的舰名与海域名用字
  盧: '卢', 薩: '萨', 爾: '尔', 灣: '湾', 濱: '滨', 張: '张', 隻: '只', 內: '内',
  隊: '队', 擊: '击', 將: '将', 軍: '军', 鎮: '镇', 飛: '飞', 陣: '阵', 號: '号',
  級: '级', 輕: '轻', 驅: '驱', 覆: '复', 滅: '灭', 敵: '敌', 揚: '扬', 嚴: '严',
  齊: '齐', 廣: '广', 寧: '宁', 灘: '滩', 峽: '峡', 嶼: '屿', 環: '环', 陸: '陆',
  // 装备名：文本用简体，索引是日文原名
  // 「聯裝/联装/連装」三种写法指同一件炮，一律归到「连」；归并的方向无所谓，
  // 只要两边一致——写成「聯→联、联→连」就会一个停在「联」、一个走到「连」。
  銃: '铳', 術: '术', 間: '间', 聯: '连', 联: '连', 銀: '银', 鐵: '铁', 鋼: '钢',
  // 2026-08-11 任务奖励自选组全库扫描（102 组对不齐）暴露的缺字：
  // 間宮/給糧艦、25mm単装機銃、熟練見張員、緊急修理資材、新型高温高圧缶、
  // ドラム缶(輸送用)、択捉、25mm対空機銃増備、防水式望遠鏡、特注家具職人、
  // 繁中正文的「戰鬥」——都是文本简体/繁体、索引日文，差一个字整项认不出。
  単: '单', 見: '见', 宮: '宫', 糧: '粮', 輸: '输', 緊: '紧', 圧: '压', 択: '择',
  対: '对', 鏡: '镜', 鬥: '斗', 職: '职', 徹: '彻',
  // 2026-08-17 家具奖励识别（quests-scn 的家具名是简化转写：「掛け軸」写成
  // 「挂け轴」、「煎餅布団」写成「煎饼布团」），缺字整名对不上：
  掛: '挂', 軸: '轴', 団: '团', 記: '记', 餅: '饼', 鯨: '鲸',
}

/**
 * 任务正文里在用、而主数据与本地化包都给不出的中文通称。
 *
 * 键是 api_id。只喂给匹配索引，不进显示层——图鉴里那艘船仍叫官方名，
 * 只是任务文本写「吞武里」时也认得出来。
 *
 * 现在只有一条：Thonburi（泰国海防战舰）在 kcwiki-localization 里 zh 仍是拉丁原名，
 * 而任务 2605B2 的正文写的是中文通称。包里其余 8 条无中文名的（Z1/Z3/U-511/
 * UIT-24/UIT-25）本来就以型号名通行，不需要补。
 */
export const TASK_SHIP_TEXT_ALIASES: Record<number, string[]> = {
  973: ['吞武里'],
  978: ['吞武里改'],
}

export const simplifyTaskEntityText = (text: string) =>
  text.replace(/./g, (character) => JP2CN[character] ?? character)

export const normalizeTaskEntityText = (text: string) =>
  simplifyTaskEntityText(`${text ?? ''}`.normalize('NFKC')).toLowerCase().replace(/\s+/g, '')

const aliasLocation = (text: string, alias: string, skipClassSuffix = false): number => {
  let from = 0
  while (from <= text.length - alias.length) {
    const at = text.indexOf(alias, from)
    if (at < 0) return -1
    if (!skipClassSuffix || !/[型级]/.test(text[at + alias.length] ?? '')) return at
    from = at + alias.length
  }
  return -1
}

export const rangesOverlap = (
  left: Pick<TaskEntityHit, 'start' | 'length'>,
  right: Pick<TaskEntityHit, 'start' | 'length'>,
) =>
  left.start < right.start + right.length &&
  right.start < left.start + left.length

export const isQuotedTaskAlias = (text: string, alias: string, start: number) => {
  const before = text[start - 1] ?? ''
  const after = text[start + alias.length] ?? ''
  return (
    (before === '「' && after === '」') ||
    (before === '『' && after === '』') ||
    (before === '"' && after === '"') ||
    (before === '“' && after === '”')
  )
}

export const matchTaskEntityHits = <T extends TaskEntityIndex>(
  entries: T[],
  rawText: string,
  minLength: number,
  options: TaskEntityMatchOptions<T> = {},
): TaskEntityHit<T>[] => {
  const text = normalizeTaskEntityText(rawText)
  const hits = entries.flatMap((entry) => {
    const match = entry.aliases
      .map((alias) => {
        const allowed =
          alias.length >= minLength ||
          (
            options.allowQuotedSingle &&
            alias.length === 1 &&
            [`「${alias}」`, `『${alias}』`, `"${alias}"`, `“${alias}”`].some((quoted) => text.includes(quoted))
          )
        const start = allowed ? aliasLocation(text, alias, options.skipClassSuffix) : -1
        const candidate = { entry, alias, start, length: alias.length, text }
        return start >= 0 && (!options.acceptAlias || options.acceptAlias(candidate))
          ? candidate
          : null
      })
      .filter((candidate): candidate is TaskEntityAliasCandidate<T> => !!candidate)
      .sort((left, right) => right.alias.length - left.alias.length || left.start - right.start)[0]
    return match ? [match] : []
  })

  const accepted: TaskEntityHit<T>[] = []
  for (const hit of hits.sort(
    (left, right) =>
      right.length - left.length ||
      left.start - right.start ||
      left.entry.id - right.entry.id,
  )) {
    // 同一段文字不能同时代表两个实体。旧逻辑刻意放过“完全同位同长”，
    // 会把两个「战舰」、两个「补给舰」和大小型「电探」一起列出来。
    if (!accepted.some((item) => rangesOverlap(hit, item))) accepted.push(hit)
  }
  return accepted.slice(0, options.limit ?? Number.POSITIVE_INFINITY)
}

export const matchedTaskEntities = <T extends TaskEntityIndex>(
  entries: T[],
  rawText: string,
  minLength: number,
  options: TaskEntityMatchOptions<T> = {},
): T[] => matchTaskEntityHits(entries, rawText, minLength, options).map((hit) => hit.entry)

/**
 * 与原文逐字对齐的归一文本：只做 1:1 的字符替换，不删空白，所以坐标可以直接
 * 拿回原文切片。NFKC 极少数字符会变长（合字、带圈序号），那时返回 null，
 * 调用方降级成不标注——宁可不高亮，也不能把标记错位插进句子中间。
 */
export const alignedTaskEntityText = (rawText: string): string | null => {
  const source = `${rawText ?? ''}`
  const text = simplifyTaskEntityText(source.normalize('NFKC')).toLowerCase()
  return text.length === source.length ? text : null
}

/**
 * 抽掉空白，同时记住每个字来自原文的哪一位。
 *
 * 别名索引是去空白存的（「Fletcher Mk.II」→「fletchermk.ii」），而正文里空格
 * 照写不误。在紧凑串上找，用这张表把结果还原成原文坐标——落回来的区间连中间
 * 那个空格一起框住，正好是完整的名字。
 */
const packTaskEntityText = (aligned: string) => {
  const chars: string[] = []
  const offsets: number[] = []
  for (let index = 0; index < aligned.length; index += 1) {
    if (/\s/.test(aligned[index])) continue
    chars.push(aligned[index])
    offsets.push(index)
  }
  return { packed: chars.join(''), offsets }
}

/**
 * 正文标注用的实体匹配：返回**原文坐标**下的每一处出现（同一实体出现两次就两条）。
 *
 * 与 matchTaskEntityHits 的分工：那个是「这条任务牵涉哪些实体」，每个实体只留一处、
 * 坐标是压缩过的；这个是「句子里哪几段该点亮」，位置必须精确到原文。
 * 两边看的都是同一份紧凑文本，所以认出来的东西不会打架。
 */
export const markTaskEntityHits = <T extends TaskEntityIndex>(
  entries: T[],
  rawText: string,
  minLength: number,
  options: TaskEntityMatchOptions<T> = {},
): TaskEntityHit<T>[] => {
  const aligned = alignedTaskEntityText(rawText)
  if (aligned == null) return []
  const { packed, offsets } = packTaskEntityText(aligned)
  const hits: TaskEntityHit<T>[] = []
  for (const entry of entries) {
    for (const alias of entry.aliases) {
      if (!alias) continue
      const quotedOnly = alias.length < minLength
      if (quotedOnly && !options.allowQuotedSingle) continue
      let from = 0
      while (from <= packed.length - alias.length) {
        const at = packed.indexOf(alias, from)
        if (at < 0) break
        from = at + alias.length
        if (options.skipClassSuffix && /[型级]/.test(packed[at + alias.length] ?? '')) continue
        if (quotedOnly && !isQuotedTaskAlias(packed, alias, at)) continue
        // 上下文规则（allowTaskShipAlias 等）本来就是照着紧凑文本写的，原样喂给它们
        if (options.acceptAlias && !options.acceptAlias({ entry, alias, start: at, length: alias.length, text: packed })) {
          continue
        }
        const start = offsets[at]
        hits.push({
          entry,
          alias,
          start,
          length: offsets[at + alias.length - 1] + 1 - start,
        })
      }
    }
  }
  return hits
}

export const taskEntityAliasRanges = <T extends TaskEntityIndex>(
  entries: T[],
  rawText: string,
  minLength: number,
): TaskEntityHit<T>[] => {
  const text = normalizeTaskEntityText(rawText)
  const ranges: TaskEntityHit<T>[] = []
  for (const entry of entries) {
    for (const alias of entry.aliases) {
      if (alias.length < minLength) continue
      let from = 0
      while (from <= text.length - alias.length) {
        const start = text.indexOf(alias, from)
        if (start < 0) break
        ranges.push({ entry, alias, start, length: alias.length })
        from = start + alias.length
      }
    }
  }
  return ranges
}

export const excludeTaskHitsCoveredByAliases = <
  T extends TaskEntityIndex,
  U extends TaskEntityIndex,
>(
  hits: TaskEntityHit<T>[],
  blockers: TaskEntityHit<U>[],
) =>
  hits.filter((hit) =>
    !blockers.some(
      (blocker) =>
        rangesOverlap(hit, blocker) &&
        (blocker.alias.includes(hit.alias) || hit.alias.includes(blocker.alias)),
    ),
  )

const PLACE_NAME_SHIPS = new Set(['昭南', '意大利', '阿尔及利亚'])

export const allowTaskShipAlias = (candidate: TaskEntityAliasCandidate) => {
  const { alias, start, text } = candidate
  // “胜利”绝大多数时候是战果动词，演习文本甚至会给它加引号。
  // 必须同时具备实体引号和舰船/编成上下文，才把它视为 Victorious。
  if (alias === '胜利') {
    if (!isQuotedTaskAlias(text, alias, start)) return false
    const before = text.slice(Math.max(0, start - 18), Math.max(0, start - 1))
    const after = text.slice(start + alias.length + 1, start + alias.length + 12)
    return (
      /(?:旗舰|僚舰|舰娘|舰艇|航空母舰|空母|航母|包含|编入|配备|选择|选用|以|从)$/.test(before) ||
      /^(?:改|作为|为旗舰|编成|出击)/.test(after)
    )
  }

  // 这些舰名同时是海域地名的一部分；地名后缀出现时交给海域词条。
  if (PLACE_NAME_SHIPS.has(alias)) {
    const after = text.slice(start + alias.length, start + alias.length + 12)
    if (/^(?:本土)?(?:航路|航线|海路)|^(?:半岛|近海)/.test(after)) return false
  }
  return true
}

export const allowTaskShipTypeAlias = (candidate: TaskEntityAliasCandidate) => {
  const { entry, alias, start, text } = candidate
  if (alias === '航战') {
    const before = text.slice(Math.max(0, start - 8), start)
    // “一航战/二航战/四航战”是航空战队简称，不是航空战舰舰种。
    if (/[一二三四五六七八九十]$/.test(before)) return false
    return /(?:可用|改造为|改装为|作为|包含|配备|用|为)$/.test(before)
  }
  if (entry.id === 22 && alias === '补给舰') {
    const around = text.slice(Math.max(0, start - 10), start + alias.length + 10)
    // 击沉类任务说的是敌方补给舰，不应跳到我方补给舰图鉴。
    if (/(?:击沉|敌方|敌军|敌舰).{0,8}补给舰|补给舰.{0,8}(?:击沉|敌方|敌军)/.test(around)) {
      return false
    }
  }
  return true
}

export const allowTaskEquipTypeAlias = (candidate: TaskEntityAliasCandidate) => {
  const { alias, start, text } = candidate
  const before = text.slice(Math.max(0, start - 4), start)
  const after = text.slice(start + alias.length, start + alias.length + 4)
  if (alias === '舰战' && /^[队力]/.test(after)) return false
  if (alias === '水战' && /[一二三四五六七八九十]$/.test(before) && !isQuotedTaskAlias(text, alias, start)) {
    return false
  }
  if (alias === '陆战' && (/[登]$/.test(before) || /^[用队]/.test(after))) return false
  return true
}

const MEMO_NOISE_MARKER =
  /奖励建议|任务完成后|语音|路线推荐|阵容推荐|推荐(?:阵容|配置|选择|使用|两种方案)?|前置(?:任务)?|待验证|需要验证|提督报告|情报收集|注意区分|同名任务/

// memo2 混有硬条件、攻略建议、前置备注与社区考据。只保留每行噪声标记之前的部分；
// “需要做完 Dw2”一类前置说明整行排除，任务链本身已有专门展示。
export const taskEntityMemoText = (memo: string) =>
  `${memo ?? ''}`
    .split(/\r?\n/)
    .map((line) => {
      if (/需要在.{0,32}做完[\w#]+/i.test(line)) return ''
      const marker = line.search(MEMO_NOISE_MARKER)
      return marker >= 0 ? line.slice(0, marker) : line
    })
    .join(' ')
    .trim()

export const taskEntityTextDomainAllowed = (
  domain: 'map' | 'expedition',
  questCode: string,
) => {
  const category = `${questCode ?? ''}`.match(/[A-Z]/g)?.find((letter) => 'ABCDEFGS'.includes(letter)) ?? ''
  return domain === 'map'
    ? category === 'B' || category === 'C'
    : category === 'D'
}

export const hasUncoveredTaskPhrase = (
  rawText: string,
  phrase: string,
  covered: Array<Pick<TaskEntityHit, 'start' | 'length'>> = [],
  blockedPrefixes: string[] = [],
) => {
  const text = normalizeTaskEntityText(rawText)
  const needle = normalizeTaskEntityText(phrase)
  let from = 0
  while (from <= text.length - needle.length) {
    const start = text.indexOf(needle, from)
    if (start < 0) return false
    const hit = { start, length: needle.length }
    const prefixBlocked = blockedPrefixes.some((prefix) =>
      text.slice(Math.max(0, start - normalizeTaskEntityText(prefix).length), start) === normalizeTaskEntityText(prefix),
    )
    if (!prefixBlocked && !covered.some((range) => rangesOverlap(hit, range))) return true
    from = start + needle.length
  }
  return false
}

interface TaskNationalityEntry extends TaskEntityIndex {
  short: string
}

const TASK_NATIONALITY_ENTRIES: TaskNationalityEntry[] = SHIP_NATIONALITIES.map(
  (nationality) => ({
    id: nationality.id,
    name: nationality.label,
    simple: nationality.label,
    aliases: [...nationality.aliases]
      .map((alias) => simplifyTaskEntityText(alias.normalize('NFKC')).toLowerCase())
      .sort((left, right) => right.length - left.length),
    short: nationality.short,
  }),
)

const NATIONALITY_CONTEXT =
  /舰|船|航母|空母|水上部队|水上舰队|联合|同盟|国籍|籍舰|出身|出生|建造于|来自/
const AMBIGUOUS_NATIONALITY_CONTEXT =
  /舰艇|舰娘|舰船|国籍|国籍舰|籍舰|出身|出生|建造于|来自/
const AMBIGUOUS_LONG_NATIONALITY = new Set(['日本', '意大利'])
const SHORT_NATIONALITY_BY_CHARACTER = new Map(
  TASK_NATIONALITY_ENTRIES.flatMap((entry) => {
    const pairs: [string, TaskNationalityEntry][] = [[entry.short, entry]]
    if (entry.id === 7) pairs.push(['苏', entry])
    return pairs
  }),
)
const SHORT_NATIONALITY_CLUSTER =
  /[日德意美英法俄苏泰挪瑞荷澳](?:\s*[、/／・·,，和与及或+\-]?\s*[日德意美英法俄苏泰挪瑞荷澳])+/g

const taskNationalityContextAt = (
  text: string,
  start: number,
  length: number,
): boolean =>
  NATIONALITY_CONTEXT.test(
    text.slice(Math.max(0, start - 12), Math.min(text.length, start + length + 12)),
  )

const ambiguousTaskNationalityContextAt = (
  text: string,
  start: number,
  length: number,
): boolean =>
  AMBIGUOUS_NATIONALITY_CONTEXT.test(
    text.slice(Math.max(0, start - 8), Math.min(text.length, start + length + 8)),
  )

// 任务里的国籍有两种写法：
// - 完整名称（美国/法国/苏联/USS 等）；
// - “美英澳荷”“美・英”这种紧凑并列简称。
//
// 单字简称必须至少并列两个，且附近有舰队/出身语境，避免把“美味”“无法达成”
// 之类普通中文误标成国籍。返回的是原文坐标，可直接安全地逐段转义并插入链接。
export const matchTaskNationalityHits = (
  rawText: string,
): TaskEntityHit<TaskNationalityEntry>[] => {
  const text = simplifyTaskEntityText(`${rawText ?? ''}`.normalize('NFKC')).toLowerCase()
  const candidates: TaskEntityHit<TaskNationalityEntry>[] = []

  for (const entry of TASK_NATIONALITY_ENTRIES) {
    for (const alias of entry.aliases) {
      let from = 0
      while (from <= text.length - alias.length) {
        const start = text.indexOf(alias, from)
        if (start < 0) break
        const ambiguous = AMBIGUOUS_LONG_NATIONALITY.has(alias)
        if (!ambiguous || ambiguousTaskNationalityContextAt(text, start, alias.length)) {
          candidates.push({ entry, alias, start, length: alias.length })
        }
        from = start + alias.length
      }
    }
  }

  for (const cluster of text.matchAll(SHORT_NATIONALITY_CLUSTER)) {
    const clusterText = cluster[0]
    const clusterStart = cluster.index ?? -1
    if (
      clusterStart < 0 ||
      !taskNationalityContextAt(text, clusterStart, clusterText.length)
    ) continue
    for (let offset = 0; offset < clusterText.length; offset += 1) {
      const character = clusterText[offset]
      const absoluteStart = clusterStart + offset
      // “任意英国/任意美国”中的“意”是普通词尾，不是意大利简称；
      // 其后的英/美仍可由完整国名或并列简称正常命中。
      if (character === '意' && text[absoluteStart - 1] === '任') continue
      const entry = SHORT_NATIONALITY_BY_CHARACTER.get(character)
      if (!entry) continue
      candidates.push({
        entry,
        alias: character,
        start: absoluteStart,
        length: 1,
      })
    }
  }

  const accepted: TaskEntityHit<TaskNationalityEntry>[] = []
  for (const hit of candidates.sort(
    (left, right) =>
      right.length - left.length ||
      left.start - right.start ||
      left.entry.id - right.entry.id,
  )) {
    if (!accepted.some((item) => rangesOverlap(hit, item))) accepted.push(hit)
  }
  return accepted.sort((left, right) => left.start - right.start)
}
