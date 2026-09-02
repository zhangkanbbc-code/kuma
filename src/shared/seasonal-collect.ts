// 「季节语音取现值」与「插入式扩展行」的纯策略层。
//
// 拆出来的理由与两份档案策略层同一条：**护栏要能脱开 Electron 真跑一遍**。
// 这里的每条判据都属于「写反了不报错、只是某天默默少一格或多摆一格」那一类
//（见共享记忆 source-pattern-guards-miss-logic-bugs），所以摆行、对账、去重
// 全部做成纯函数，界面只把结果翻成 HTML。
//
// ---- 立绘那一半 2026-08-23 晚整层退役 ----
// 用户拍板拔掉立绘收藏格 UI（连带点收卷的立绘域、插入式扩展格、版本对账三档），
// 立绘从此只保留静默的自扩展缓存权利，展示面是图鉴画廊尾巴那几张档案卡——
// 判据搬去了 shared/art-archive-plan 的 `legacyArchivedArt`。
// 所以本文件现在只剩**语音**一域，别再往回加立绘的东西。
//
// ---- 独立的「点收卷」2026-08-23 整层退役，分族清单随之删掉 ----
// 用户原话：「点收那单独那么一大堆栏就不要了吧，要不然图鉴确实『这里也有，那里也有』的」。
// 收的动作回归舰娘自己页面的季节台词区（那里本来就逐季逐句列着她说过什么），
// 于是「把季节包按族分组、按实测证据排序」那一层没有调用方了，跟着一起删——
// 分族只为那一卷的目录页存在。留下的是**这一次取回来算什么**（`collectOutcomeOf`）
// 与扩展行那一套：它们服务的是舰娘页上还在的东西。
//
// ============================================================================
// 总纲：自扩展两层公约
// ============================================================================
// **存在层**（档案里真有的实物）机器自己长行；
// **名分层**（清单包誊写到哪一季了）允许滞后，但滞后必须**显形**——
// 长出来的行不主张自己是哪一件，只如实说「档案里还有这一份」。
// 名分到位（清单追录了对应条目）之后，正式行把那一份认领走，扩展行随即让位。
// 「清单先行、对不上就隐身」是反模式：那会让玩家自己收到的东西在界面上不存在。
//
// ============================================================================
// 一条必须说清的边界：主数据里**没有**「这是当季版」这个标记
// ============================================================================
// 2026-08-23 对本机 api_start2 快照逐字段穷举过一遍（3057 条 api_mst_shipgraph、
// api_mst_ship、api_port 的 api_ship、require_info 全查）：
//   · `api_version` 是三元组，实测 `[0]` 就是那个形态**现行**的图片版本号
//     （与立绘档案里记下的 `?version=` 逐条相符，42/42 命中）；
//     `[2]` 只有 `805`/`1` 两个值，等价于「是不是玩家可用舰」；`[1]` 与季节无关。
//   · `api_sp_flag` 全表只有 10 条，内容是新形态标记（天津風改二 + 本期新深海），
//     不是季节标记。
//   · 5001..6304 那 1285 条只有 id/档名/版本三个字段，**主数据里没有任何一处**
//     把它们与某艘舰关联起来（档名不重复、mst_ship 里没有指针、港口数据里也没有）。
// 所以「某一份实物属于哪一季」**推不出来**。这条结论现在管着两处措辞：
// 季节台词行上的「取现值」只说「取回的是此刻挂在这个槽位上的那一段」，
// 立绘的档案卡只说图种、留存月份与版本号。
// 官方哪天真给了季节标记，护栏那条字段穷举会当场红——那时才谈得上精确归属。

// ---- 取一次之后算什么 ----

/**
 * 取一次之后，取回的这一份与档案里已有的比是什么关系。
 * 三档都是**事实陈述**，`same` 不是失败——「本季这一格没换季节版」本身就是数据。
 */
export type CollectOutcome = 'new' | 'same' | 'absent' | 'blocked' | 'error'

export const collectOutcomeOf = (
  knownSha1: readonly string[],
  fetched: { verdict: string; sha1?: string | null },
): CollectOutcome => {
  const verdict = `${fetched?.verdict ?? ''}`
  if (verdict === 'absent') return 'absent'
  if (verdict === 'blocked') return 'blocked'
  if (verdict !== 'kept') return 'error'
  const sha1 = `${fetched?.sha1 ?? ''}`
  if (!sha1) return 'error'
  return knownSha1.includes(sha1) ? 'same' : 'new'
}

/**
 * 季节台词的这一行给不给「取现值」钮。**三档判据，写反了一档都不报错**——
 * 只是某天默默多摆一枚点不动的钮，或者把该给的那一行漏掉：
 *   · 槽位推不出来（`slot` 为空）→ 没有地址可点，**不硬造**；
 *   · 档案里已经有实物（`kept`）→ 那一份已经在手上，再取一次没有意义；
 *   · 其余两态（没听过 / 听过但没留下音频）才给。
 *
 * 三态的判据本身在 renderer/voice-archive（`voiceLitState`），这里只管「给不给钮」。
 */
export const seasonalTakeOffered = (
  line: { slot?: number | null } | null | undefined,
  state: string,
): boolean => line?.slot != null && state !== 'kept'

// ============================================================================
// 插入式扩展行（语音侧）
// ============================================================================

/**
 * **扩展行只从实物长出来，绝不投机预摆。**
 *
 * 给定同一槽位下档案里的全部实物，与正式行已经认领掉的那几份（按内容指纹），
 * 返回**没人认领的那些**——它们就是要自动长出来的扩展行。
 *
 * 「清单追上来 → 扩展让位」是这个函数的直接后果，不是另写的一段逻辑：
 * 清单誊写了对应条目之后，正式行会把那一份认领进 `claimedSha1`，
 * 于是这里再也不返回它。**两套并存在结构上就不可能**（护栏钉着这条）。
 */
export const unclaimedArchiveVariants = <T extends { sha1: string; bytes: number }>(
  entries: readonly T[],
  claimedSha1: Iterable<string>,
): T[] => {
  const claimed = new Set<string>()
  for (const sha1 of claimedSha1) if (sha1) claimed.add(sha1)
  const seen = new Set<string>()
  const out: T[] = []
  for (const entry of entries) {
    if (!(entry.bytes > 0) || !entry.sha1) continue
    if (claimed.has(entry.sha1) || seen.has(entry.sha1)) continue
    seen.add(entry.sha1)
    out.push(entry)
  }
  return out
}

/**
 * 护栏用的不变式：正式行认领的那几份与扩展行摆出来的那几份**不许有交集**。
 * 返回交集（正常永远是空数组）。
 */
export const coexistingVariants = (
  claimedSha1: readonly string[],
  expansion: readonly { sha1: string }[],
): string[] => expansion.map((entry) => entry.sha1).filter((sha1) => claimedSha1.includes(sha1))

/**
 * 扩展行的名字。**有证据才挂名，没有就中性**。
 *
 * 「证据」指耳测台账确证了那个槽位此刻挂着哪一季的哪一条（`mountedSeasonalKey`）——
 * 只有这一种情况我们真的知道那份字节属于哪一季，才写「盛夏（耳测）」这种名分。
 * 其余一律「另一份实物」：档案按内容指纹分份保存，但**不编一个「这是哪一季」的答案**
 *（与文件头那条边界同一条）。
 */
export const variantLabelOf = (evidence?: { seasonTitle?: string; observedAt?: string } | null): {
  name: string
  evidenced: boolean
  note: string
} => {
  const title = `${evidence?.seasonTitle ?? ''}`.trim()
  if (title) {
    return {
      name: `${title}（耳测）`,
      evidenced: true,
      note: `${evidence?.observedAt ?? ''} 耳测确认：当前槽位为本季语音`,
    }
  }
  return {
    name: '另一份实物',
    evidenced: false,
    note: '档案中保留同位置的另一份音频；所属季节不明，文本暂缺',
  }
}

/** 扩展行不主张文本，文本列摆一根短横。收口成一个常量，免得两处各写各的。 */
export const VARIANT_TEXT_DASH = '—'
