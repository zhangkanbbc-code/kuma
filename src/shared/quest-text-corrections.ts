// 任务正文的**第一方校正台账**（范式照 `shared/fit-bonus-corrections` / `shared/event-bonus-nationality`）。
//
// ---- 为什么必须有这一层，而不是直接改包 ----
//
// `quests-scn` 是自己解析 zh.kcwiki「任务」「任务/最新任务」两张页得到的包
//（`scripts/lib/kcwiki-quests-scn.mjs`），它**每次 `lodes:fetch` 都整包重出**——
// 手改包文件下一次抓取就被冲掉，等于没改。
//
// 而且这份内容本体受站点 CC BY-NC-SA 3.0 覆盖、随发行版原样分发。同 `fit-bonus-corrections`
// 与 `event-bonus-nationality` 那条许可纪律：**不往上游包文件里塞自己的裁决，
// 在加载时叠一层第一方台账**。抓来的那份始终是 kcwiki 说的话，我们的判词单独一层、
// 有名有姓、可被推翻。
//
// 所以校正走加载期覆盖：包文件一个字不改，两个装载口各叠一次
//（`src/main/lode.ts` 的 readPack 管整个运行期，`scripts/lib/quest-engine.mjs`
// 的 loadLode 管离线对账脚本——后者不叠的话，自推导对账会拿校正后的显示文本
// 去比未校正的解析输入，diff 全是假的）。
//
// ---- 自失效 ----
//
// 每条钉着它当初看到的上游原文（`from`）。kcwiki 哪天把那句话改了，对不上就
// **跳过并告警**，而不是拿一份过期的校正去改一个已经变了样的句子。
// 护栏 `test/quest-text-corrections.test.mjs` 拿现行包逐条复核 `from`：
// 上游改动会当场红，而不是安静地退化成空操作。
//
// ============================================================================
// 判据（2026-08-27 用户裁决）
// ============================================================================
//
// 这一族错的都是**量词**：日文原文分「回数」与「件数/艘数」两种计法，中文译文
// 一律写成了「N次」。写错的后果不是措辞难看，是**告诉玩家一件做不到的事**——
// 玩家照「废弃装备五次」会去点五轮废弃，而这条任务一次勾五件就达成了。
//
// 判据有三票，且三票逐条互相印证：
//
//   ① **日文原文的量词**（游戏一手）——「N回」＝按操作回数，「Nつ」＝按件数，
//      「N隻」＝按艘数。
//   ② **kcwiki `kcwiki-quest-req` 的 `batch` 字段**——`batch:true` ＝一括廃棄可（按件），
//      `batch:false` ＝按回。
//   ③ **用户游戏实测**（609）。
//
// 廃棄装備族六条按回、四条按件，日文量词与 `batch` 字段**逐条对得上**，
// 无一例外（回→false：604/610/611/612/613/617；つ→true：624/625/634/635）。
// 这不是巧合式的两票，是两个独立来源在十条上全等——`batch` 字段因此可信。
//
// 逐条穷举的结论（全包扫「废弃/解体/拆解 + 次/回」，命中 11 条）：
//
// | 号  | 上游写法              | 日文量词    | batch | 裁决              |
// |-----|----------------------|-----------|-------|-------------------|
// | 603 | 解体舰船1次           | （无量词）  | －     | **改**：按艘（见下）|
// | 604 | 废弃装备1次           | （无量词）  | false | 不动：按回         |
// | 609 | 解体舰船2次           | 2**隻**    | －     | **改**：按艘       |
// | 610 | 废弃装备4次 / desc 同 | 4**回**    | false | 不动：按回         |
// | 611 | 废弃装备2次 / desc 同 | 2**回**    | false | 不动：按回         |
// | 612 | 废弃装备3次 / desc 同 | 3**回**    | false | 不动：按回         |
// | 613 | 废弃装备24次          | なるべく多く | false | 不动：按回         |
// | 617 | 废弃装备10次          | いくつか    | false | 不动：按回         |
// | 635 | 废弃装备五次          | 5**つ**    | true  | **改**：按件       |
// | 661 | 必须一次性废弃10个副炮 | x10を廃棄  | －     | 不动：「一次性」是副词不是量词，且已按「个」计 |
//
// 624/625/634 同为 `batch:true`，但正文本来就写「7个装备」「废弃9件装备」，
// 量词没错，不进台账。635 是廃棄装備族里唯一一条被写成「次」的按件任务。
//
// ---- 每条都要写清证据等级 ----
//
// 609 是用户在游戏里点出来的，603 是**同机制推定**——两者不许混着写。
// 详见各条的 `basis`。

/** 一条正文校正。 */
export interface QuestTextCorrection {
  /** 任务 api_id */
  questId: number
  /** 只改这一个字段；其余字段一个字不碰 */
  field: 'memo2' | 'desc'
  /** 任务名，只为读台账的人方便；判定一律用 questId */
  label: string
  /** 记下这条校正时上游写的原文；对不上就跳过（自失效） */
  from: string
  /** 校正后的文本 */
  to: string
  /** 证据。实测与推定必须分清 */
  basis: string
}

export const QUEST_TEXT_CORRECTIONS: readonly QuestTextCorrection[] = Object.freeze([
  {
    questId: 635,
    field: 'memo2',
    label: '新装备的准备',
    from: '废弃装备五次',
    to: '废弃5件装备',
    basis:
      '日文原文「「工廠」で装備アイテムを5つ「廃棄」して、新装備配備の準備をします。」——' +
      '量词是「つ」（件数）不是「回」；kcwiki-quest-req 记 batch:true（一括廃棄可）；' +
      '同包 desc 本来就写对了「工厂中废弃5件装备」。译文把件数读成了操作回数。' +
      '· 用户裁决 2026-08-27',
  },
  {
    questId: 609,
    field: 'memo2',
    label: '对应裁军条约！',
    from: '解体舰船2次',
    to: '解体2艘舰船',
    basis:
      '**用户游戏实测**：一次批量解体 2 艘直接达成，不需要解体两轮。' +
      '日文原文「…「工廠」で不要な艦を2隻「解体」してください！」量词是「隻」（艘数）；' +
      'poi-quest-goal 记 destroy_ship.required=2 且**不带** times 数组' +
      '（对照 613 的 destory_item.times=[1] 才是按回的编码）；同包 desc 本来就写对了「解体」2艘。' +
      '· 用户裁决 2026-08-27',
  },
  {
    questId: 603,
    field: 'memo2',
    label: '初次的「解体」！',
    from: '解体舰船1次',
    to: '解体1艘舰船',
    basis:
      '**同机制推定，非本条实测**：日文原文「「工廠」で不要な艦を「解体」してみよう！」' +
      '本身不带量词，所以这一条没有自己的一手量词证据。判据是它与 609 走**同一个解体计数器**，' +
      '而那个计数器按艘计已由 609 实测坐实。' +
      '另：required=1 时两种读法同真（一次解体一艘，按艘按回都达成），' +
      '所以这条改动在任何读法下都不会把玩家引错——留着「1次」反而与 609 的量词自相矛盾。' +
      '· 用户裁决 2026-08-27',
  },
])

export type QuestTextSkipReason = 'no-quest' | 'text-changed'

export interface QuestTextCorrectionReport {
  applied: number[]
  skipped: { questId: number; field: string; reason: QuestTextSkipReason }[]
}

/** 上游那一格现在写的是什么。只回答「还是台账记下它时的样子吗」。 */
export const questTextFingerprint = (
  data: unknown,
  questId: number,
  field: string,
): string | null => {
  const entry = (data as Record<string, Record<string, unknown>> | null)?.[`${questId}`]
  if (!entry || typeof entry !== 'object') return null
  const value = entry[field]
  return typeof value === 'string' ? value : null
}

/**
 * 把台账叠到 `quests-scn` 的 data 上。**返回新对象，不就地改**——
 * 包对象由 `src/main/lode.ts` 的 packCache 缓存并跨消费端共享，就地改会污染缓存。
 *
 * 只替换台账点名的那一个字段；同一条任务的其余字段、以及没进台账的任务，一个字不动。
 * 上游把那句话改了（`from` 对不上）就**跳过并记一笔**：拿过期的校正去改一个已经
 * 不同的句子，错得看不见。
 */
export const applyQuestTextCorrections = (
  data: unknown,
): { data: unknown; report: QuestTextCorrectionReport } => {
  const report: QuestTextCorrectionReport = { applied: [], skipped: [] }
  if (!data || typeof data !== 'object') return { data, report }
  const source = data as Record<string, Record<string, unknown>>
  let next: Record<string, Record<string, unknown>> | null = null
  for (const fix of QUEST_TEXT_CORRECTIONS) {
    const current = questTextFingerprint(data, fix.questId, fix.field)
    if (current === null) {
      report.skipped.push({ questId: fix.questId, field: fix.field, reason: 'no-quest' })
      continue
    }
    if (current !== fix.from) {
      // 上游变样了：**不覆盖**
      report.skipped.push({ questId: fix.questId, field: fix.field, reason: 'text-changed' })
      continue
    }
    if (!next) next = { ...source }
    const key = `${fix.questId}`
    next[key] = { ...next[key], [fix.field]: fix.to }
    report.applied.push(fix.questId)
  }
  return { data: next ?? data, report }
}

/**
 * 整包版：`quests-scn` 之外的包原样返回。
 * 两个装载口（主进程 lode.ts、离线 quest-engine.mjs）共用这一个入口，
 * 免得哪天只有一边叠了校正、另一边没叠，显示与判定悄悄分叉。
 */
export const applyQuestTextCorrectionsToPack = <T extends { meta?: { id?: string }; data?: unknown }>(
  pack: T,
): T => {
  if (!pack || pack.meta?.id !== 'quests-scn') return pack
  const { data, report } = applyQuestTextCorrections(pack.data)
  for (const skip of report.skipped) {
    // 静默跳过等于台账悄悄失效；上游改了那句话必须有人看得见
    console.warn(
      `[kanso] 任务正文校正跳过：${skip.questId}.${skip.field}（${
        skip.reason === 'no-quest' ? '包里没有这条任务' : '上游原文已变，台账需复核'
      }）`,
    )
  }
  if (data === pack.data) return pack
  return { ...pack, data }
}
