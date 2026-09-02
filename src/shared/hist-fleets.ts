// 史实编队库（第一方馆藏）。队名 → 成员 + 形态语义 + 期别 + 出处。
//
// ## 这张表是什么
//
// 舰C 的任务正文里塞满了「第六駆逐隊」「西村艦隊」「三一駆第一小隊」这类**队名**，
// 玩家在图鉴里也会直接搜这些词。队名背后是一份成员表，而这份成员表此前散落在
// 各处：任务引擎自己解一遍、图鉴不认得、别的模块想用只能再抄一份。
// 按「分类即基础设施」的口径，分类维度一律建成 shared 单一出处——
// 图鉴是展示面与公证处，各模块只拉取，不自造。
//
// ## 口径（这三条是这张表能不能当门用的前提）
//
// ### 一、成员的唯一裁决权在游戏任务文本
//
// **游戏任务文本的操作性定义为准，史实背景只当注记。** 门要判的是「游戏认不认
// 这一队」，不是「历史上这队有谁」。两者不一致时一律听游戏的，差异写进 `note`。
// 已抓到三处实例，全部**分期立条**而不是合并成一个大集合
//（合并会让门比游戏松，也会让图鉴的标注说谎）：
//
//   第十一驱逐队   游戏 A47/B35/B36 = 吹雪·白雪·初雪·叢雲；Cy10「特型初代」= …·深雪
//   第二十七驱逐队 游戏 A67/B61 = 白露·時雨·春雨·五月雨；B192 = 白露·有明·夕暮
//   第三一驱逐队   游戏 A83/Bq6 第一小队；B142「再编」= 沖波改二·長波·岸波·朝霜
//
// ### 二、具名舰的形态语义只认列举
//
// 素名（時雨、扶桑）＝任意形态，记链根 mstId，`form: 'root'`；
// 写明形态（白露改、朝潮改二丁）＝只认列举的，`form: 'exact'` + `forms[]` 逐个列。
// **不做任何「及之后」的结构推断**（kanso-disciplines 一之一）。
//
// ### 三、未实装的成员照实标缺，不硬造
//
// 第 15 驱逐队的 夏潮 主数据里查无此舰 → `{ form: 'absent', name: '夏潮' }`，
// **不给 id、不找近似替身**。图鉴渲染成灰字词条，不给链接；门里这一位直接跳过
//（不是「算 0 艘」，是「这一位不存在」）。
//
// ## note 的可信度
//
// `noteStatus: 'verified'` = 整理时查过文献并留了 `refs`；`'draft'` = 待核。
// **UI 只渲染 verified 的 note**——未核的史实注记不进产品面（拿不到就不显示，
// 绝不硬造）。draft 的那些留在数据里，等「活动海域正派历史」那条线逐条核实后升级。

/** 成员的形态语义，与 quest-fleet-rules / kcwiki-quest-rules 同一份口径 */
export type HistFleetMemberRef =
  /** 素名：链根 mstId，改造链上任意形态都算 */
  | { form: 'root'; id: number }
  /** 写明形态：只认 forms 列举的这些 mstId；id = 代表形态（必在 forms 里，用于显示） */
  | { form: 'exact'; id: number; forms: readonly number[] }
  /** 未实装：只有名字，没有 id */
  | { form: 'absent'; name: string }

export interface HistFleetMember {
  ref: HistFleetMemberRef
  /** 该期编成里的位置语义。'flagship' 只表达「1 号位」，不表达任意号位 */
  role?: 'flagship' | 'member'
  /** 该舰只在部分任务里被点名（「之中任选三艘」）→ 标 optional，门里落成并集组 */
  optional?: boolean
}

export type HistFleetKind =
  | 'destroyerDivision' // 駆逐隊
  | 'squadron' // 戦隊（巡洋舰/战舰）
  | 'carrierDivision' // 航空戦隊
  | 'torpedoSquadron' // 水雷戦隊
  | 'fleet' // 艦隊
  | 'namedForce' // 提督名/作战名部队（三川舰队、礼号作战部队）
  | 'airGroup' // 航空隊（六〇一空）
  | 'escortCommand' // 护卫总队/护卫舰队

export interface HistFleetQuestRef {
  /** 艦素码空间（与 quests-scn 同），如 'A67' */
  code: string
  /** defines = 这条任务的正文界定了成员表；mentions = 只是引用 */
  role: 'defines' | 'mentions'
  /** 出现在哪一段（desc = 游戏正文译文，memo2 = 社区攻略注） */
  field: 'name' | 'desc' | 'memo2'
}

export interface HistFleetEntry {
  id: string
  kind: HistFleetKind
  name: { zh: string; ja: string }
  /** 别称：正文里真出现过的写法 + 玩家口语。用于任务文本匹配与图鉴搜索 */
  aliases: readonly string[]
  /** 期别。同队多期分开立条，靠这个字段区分与排序 */
  period?: { label: string; order: number }
  members: readonly HistFleetMember[]
  /** 编成的额外约束（「共 4 艘」「只能配置任务要求的舰娘」「之中任选 N 艘」） */
  constraint?: { size?: number; exclusive?: boolean; pickFrom?: number }
  questRefs: readonly HistFleetQuestRef[]
  /** 一句话史实注记。**这是数据，不是解释**——写「什么时候、隶属谁、结局」 */
  note: string
  /** 'verified' = 整理时查过文献（必带 refs）；'draft' = 待核，UI 不渲染 */
  noteStatus: 'verified' | 'draft'
  refs?: readonly { title: string; url: string }[]
  /** quest = 游戏正文一手；memo = 社区攻略注补的；literature = 查文献补的 */
  source: 'quest' | 'memo' | 'literature'
}

// ---- 构造糖（只为让下面 75 条读起来还是表，不为省事）----
const root = (id: number, role?: HistFleetMember['role'], optional?: true): HistFleetMember => ({
  ref: { form: 'root', id },
  ...(role ? { role } : {}),
  ...(optional ? { optional } : {}),
})
const exact = (
  forms: readonly number[],
  role?: HistFleetMember['role'],
  optional?: true,
): HistFleetMember => ({
  ref: { form: 'exact', id: forms[0], forms },
  ...(role ? { role } : {}),
  ...(optional ? { optional } : {}),
})
const absent = (name: string): HistFleetMember => ({ ref: { form: 'absent', name } })
const q = (
  code: string,
  role: HistFleetQuestRef['role'] = 'mentions',
  field: HistFleetQuestRef['field'] = 'desc',
): HistFleetQuestRef => ({ code, role, field })

export const HIST_FLEETS: readonly HistFleetEntry[] = [
  // ══ 駆逐隊 ══
  {
    id: 'dd-02-1',
    kind: 'destroyerDivision',
    name: { zh: '第二驱逐队（前期编成）', ja: '第二駆逐隊' },
    aliases: ['二驱', '第2駆逐隊', '第二駆逐隊'],
    period: { label: '白露型期', order: 1 },
    members: [root(44), root(45), root(405), root(46)],
    questRefs: [q('B197', 'defines')],
    note: '白露型四姊妹編成的驱逐队，隶属第四水雷战队。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'dd-02-2',
    kind: 'destroyerDivision',
    name: { zh: '第二驱逐队（后期编成）', ja: '第二駆逐隊' },
    aliases: ['二驱', '第2駆逐隊', '第二駆逐隊'],
    period: { label: '夕云型期', order: 2 },
    members: [root(409), root(625), root(425), root(410)],
    questRefs: [q('Cy16', 'defines'), q('B204', 'defines'), q('B206')],
    note: '战争后期以夕云型（早霜型）四舰重编的第二驱逐队。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'dd-06',
    kind: 'destroyerDivision',
    name: { zh: '第六驱逐队', ja: '第六駆逐隊' },
    aliases: ['六驱', '第6駆逐隊', '第六駆逐隊'],
    members: [root(34, 'flagship'), root(35), root(36), root(37)],
    questRefs: [q('A10', 'defines'), q('A53', 'defines'), q('B12'), q('B42'), q('B45')],
    note: '暁型四舰编成的驱逐队；響 战后作为赔偿舰移交苏联，改名 Верный。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'dd-07',
    kind: 'destroyerDivision',
    name: { zh: '第七驱逐队', ja: '第七駆逐隊' },
    aliases: ['七驱', '第7駆逐隊', '第七駆逐隊'],
    members: [root(93), root(15), root(94), root(16)],
    questRefs: [q('A94', 'defines'), q('B124'), q('Cy4'), q('B165'), q('By13')],
    note: '特型（吹雪型III型）四舰编成，长期担任北方与船团护卫任务。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'dd-08',
    kind: 'destroyerDivision',
    name: { zh: '第八驱逐队', ja: '第八駆逐隊' },
    aliases: ['八驱', '第8駆逐隊', '第八駆逐隊'],
    members: [root(95), root(97), root(96), root(98)],
    questRefs: [
      q('A31', 'defines'),
      q('A70'),
      q('A81'),
      q('B20'),
      q('B73'),
      q('B90'),
      q('B108'),
      q('B109'),
    ],
    note: '朝潮型四舰编成的驱逐队，隶属第二水雷战队。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'dd-08-s1',
    kind: 'destroyerDivision',
    name: { zh: '第八驱逐队 第一小队', ja: '第八駆逐隊 第一小隊' },
    aliases: ['八驱第一小队', '第八駆逐隊第一小隊'],
    period: { label: '小队', order: 1 },
    members: [exact([468], 'flagship'), exact([199])],
    constraint: { size: 2 },
    questRefs: [q('A71', 'defines'), q('B74')],
    note: '驱逐队内两舰一组的小队编制；游戏侧要求朝潮改二丁旗舰 + 大潮改二。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'dd-10',
    kind: 'destroyerDivision',
    name: { zh: '第十驱逐队', ja: '第十駆逐隊' },
    aliases: ['十驱', '第10駆逐隊', '第十駆逐隊'],
    period: { label: '4 艘编成', order: 2 },
    members: [root(133), root(134), root(453), root(132)],
    questRefs: [q('A93', 'defines'), q('Cy2'), q('B157')],
    note: '夕云型四舰编成，隶属第十战队，参加马里亚纳与莱特湾海战。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'dd-10-s1',
    kind: 'destroyerDivision',
    name: { zh: '第十驱逐队（2 艘编成）', ja: '第十駆逐隊' },
    aliases: ['十驱', '第10駆逐隊', '第十駆逐隊'],
    period: { label: '2 艘期', order: 1 },
    members: [exact([542]), exact([563])],
    constraint: { size: 2 },
    questRefs: [q('A91', 'defines'), q('B126')],
    note: '游戏侧的两舰编成档：夕雲改二与巻雲改二。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'dd-11-1',
    kind: 'destroyerDivision',
    name: { zh: '第十一驱逐队（特型初代）', ja: '第十一駆逐隊' },
    aliases: ['十一驱', '第11駆逐隊', '第十一駆逐隊'],
    period: { label: '初代', order: 1 },
    members: [root(9), root(10), root(32), root(11)],
    questRefs: [q('Cy10', 'defines')],
    note: '特型驱逐舰初代编成；深雪 1934 年演习中与 電 相撞沉没，其位由 叢雲 递补。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'dd-11-2',
    kind: 'destroyerDivision',
    name: { zh: '第十一驱逐队', ja: '第十一駆逐隊' },
    aliases: ['十一驱', '第11駆逐隊', '第十一駆逐隊'],
    period: { label: '深雪战没后', order: 2 },
    members: [root(9), root(10), root(32), root(33)],
    questRefs: [q('A47', 'defines'), q('B35'), q('B36'), q('B208')],
    note: '深雪 沉没后由 叢雲 递补的编成，即游戏任务的主口径。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'dd-15',
    kind: 'destroyerDivision',
    name: { zh: '第十五驱逐队', ja: '第十五駆逐隊' },
    aliases: ['十五驱', '第15駆逐隊', '第十五駆逐隊'],
    members: [root(456), root(19), root(886), absent('夏潮')],
    questRefs: [q('B184', 'defines'), q('Cy7'), q('B174')],
    note: '陽炎型四舰编成；夏潮 在舰C 尚未实装，此处照实标缺。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'dd-16',
    kind: 'destroyerDivision',
    name: { zh: '第十六驱逐队', ja: '第十六駆逐隊' },
    aliases: ['十六驱', '第16駆逐隊', '第十六駆逐隊'],
    members: [root(181), root(20), root(186), root(190)],
    questRefs: [q('Cy11', 'defines')],
    note: '陽炎型四舰编成，隶属第二水雷战队；雪風 为唯一幸存者。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'dd-17',
    kind: 'destroyerDivision',
    name: { zh: '第十七驱逐队', ja: '第十七駆逐隊' },
    aliases: ['十七驱', '第17駆逐隊', '第十七駆逐隊'],
    members: [root(168), root(169), root(167), root(170)],
    questRefs: [q('A86', 'defines'), q('A90', 'defines'), q('C27'), q('B123')],
    note: '陽炎型四舰编成，长期担任机动部队直卫。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'dd-18',
    kind: 'destroyerDivision',
    name: { zh: '第十八驱逐队', ja: '第十八駆逐隊' },
    aliases: ['十八驱', '第18駆逐隊', '第十八駆逐隊'],
    members: [root(49), root(48), root(17), root(18)],
    questRefs: [q('A32', 'defines'), q('A87'), q('B21'), q('Cq2'), q('B116')],
    note: '陽炎型／朝潮型混编的驱逐队，参加北方与南方多次作战。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'dd-19',
    kind: 'destroyerDivision',
    name: { zh: '第十九驱逐队', ja: '第十九駆逐隊' },
    aliases: ['十九驱', '第19駆逐隊', '第十九駆逐隊'],
    members: [root(12), root(486), root(13), root(14)],
    questRefs: [
      q('A72', 'defines'),
      q('Cq3'),
      q('Cy8'),
      q('By12'),
      q('B78'),
      q('B79'),
      q('By1'),
    ],
    note: '特型（綾波型）四舰编成，第三次所罗门海战中 綾波 单舰突入。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'dd-21-1',
    kind: 'destroyerDivision',
    name: { zh: '第二一驱逐队', ja: '第二十一駆逐隊' },
    aliases: ['二一驱', '第21駆逐隊', '第二十一駆逐隊'],
    period: { label: '四舰编成', order: 1 },
    members: [root(38), root(39), root(40), root(41)],
    questRefs: [q('A48', 'defines'), q('B37')],
    note: '初春型四舰编成，主要在北方海域活动。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'dd-21-2',
    kind: 'destroyerDivision',
    name: { zh: '精锐第二一驱逐队', ja: '精鋭第二十一駆逐隊' },
    aliases: ['二一驱', '第21駆逐隊', '第二十一駆逐隊'],
    period: { label: '捷一号期', order: 2 },
    members: [exact([240]), exact([326]), exact([419])],
    constraint: { size: 3 },
    questRefs: [q('A85', 'defines'), q('C17')],
    note: '捷一号作战时期的三舰编成；子日 已于 1942 年战没。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'dd-22',
    kind: 'destroyerDivision',
    name: { zh: '第二二驱逐队', ja: '第二十二駆逐隊' },
    aliases: ['二二驱', '第22駆逐隊', '第二十二駆逐隊'],
    members: [root(28), root(29), root(6), root(481)],
    questRefs: [q('A49', 'defines'), q('A79', 'defines'), q('B39'), q('B104')],
    note: '睦月型四舰编成，长期担任船团护卫与输送任务。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'dd-24',
    kind: 'destroyerDivision',
    name: { zh: '第二十四驱逐队', ja: '第二十四駆逐隊' },
    aliases: ['二四驱', '第24駆逐隊', '第二十四駆逐隊'],
    members: [root(458, 'flagship'), root(457), root(459), root(47)],
    questRefs: [q('B136', 'defines')],
    note: '白露型后期四舰（海風・山風・江風・涼風）编成。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'dd-27-1',
    kind: 'destroyerDivision',
    name: { zh: '第二十七驱逐队', ja: '第二十七駆逐隊' },
    aliases: ['二七驱', '第27駆逐隊', '第二十七駆逐隊'],
    period: { label: '春雨·五月雨 期', order: 2 },
    members: [exact([242, 497], 'flagship'), root(43), root(405), root(46)],
    questRefs: [q('A67', 'defines'), q('B61'), q('B121'), q('B158')],
    note: '有明・夕暮 战没后由 春雨・五月雨 编入的编成，即游戏任务的主口径。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'dd-27-2',
    kind: 'destroyerDivision',
    name: { zh: '第二十七驱逐队（有明·夕暮 期）', ja: '第二十七駆逐隊' },
    aliases: ['二七驱', '第27駆逐隊', '第二十七駆逐隊'],
    period: { label: '有明·夕暮 期', order: 1 },
    members: [root(42), root(632), root(633), exact([961], undefined, true)],
    questRefs: [q('B192', 'defines')],
    note: '1937 年编成时的成员为 白露・時雨・有明・夕暮；两舰 1943 年战没。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'dd-30-1',
    kind: 'destroyerDivision',
    name: { zh: '第三十驱逐队（第一次）', ja: '第三十駆逐隊' },
    aliases: ['三十驱', '第30駆逐隊', '第三十駆逐隊'],
    period: { label: '第一次', order: 1 },
    members: [root(1), root(2), root(164), root(31)],
    questRefs: [q('A33', 'defines'), q('B22')],
    note: '睦月型四舰的第一次编成，参加基斯岛撤退作战。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'dd-30-2',
    kind: 'destroyerDivision',
    name: { zh: '第三十驱逐队（第二次）', ja: '第三十駆逐隊' },
    aliases: ['三十驱', '第30駆逐隊', '第三十駆逐隊'],
    period: { label: '第二次', order: 2 },
    members: [root(1), root(165), root(164), root(31)],
    questRefs: [q('A34', 'defines'), q('B24')],
    note: '如月 战没后由 卯月 递补的第二次编成。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'dd-31-1',
    kind: 'destroyerDivision',
    name: { zh: '第三一驱逐队 第一小队', ja: '第三十一駆逐隊 第一小隊' },
    aliases: ['三一驱', '第31駆逐隊', '第三十一駆逐隊'],
    period: { label: '第一小队', order: 1 },
    members: [
      exact([543], 'flagship'),
      exact([345], undefined, true),
      exact([359], undefined, true),
      exact([344, 578], undefined, true),
    ],
    constraint: { size: 2, pickFrom: 1 },
    questRefs: [q('A83', 'defines'), q('Bq6')],
    note: '两舰一组的小队编制：長波改二 旗舰，僚舰在 高波改／沖波改／朝霜改 中取一。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'dd-31-2',
    kind: 'destroyerDivision',
    name: { zh: '第三一驱逐队（再编）', ja: '第三十一駆逐隊' },
    aliases: ['三一驱', '第31駆逐隊', '第三十一駆逐隊'],
    period: { label: '再编成', order: 2 },
    members: [exact([569]), root(135), root(527), root(425)],
    questRefs: [q('B142', 'defines')],
    note: '編成时成员为 長波・高波・大波・清波，战没后逐次递补，游戏取再编后的名单。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'dd-32',
    kind: 'destroyerDivision',
    name: { zh: '第三十二驱逐队', ja: '第三十二駆逐隊' },
    aliases: ['三二驱', '第32駆逐隊', '第三十二駆逐隊'],
    members: [root(674), root(675), root(485), root(528), root(484)],
    questRefs: [
      q('F136', 'defines', 'memo2'),
      q('F138'),
      q('B207'),
      q('B209'),
      q('B213'),
      q('B214'),
    ],
    note: '玉波・早波・藤波・涼波 为编成时成员，浜波 于 1944 年 12 月编入',
    noteStatus: 'verified',
    refs: [
      {
        title: '第三二駆逐隊 - ピクシブ百科事典',
        url: 'https://dic.pixiv.net/a/%E7%AC%AC%E4%B8%89%E4%BA%8C%E9%A7%86%E9%80%90%E9%9A%8A',
      },
    ],
    source: 'memo',
  },

  // ══ 戦隊 ══
  {
    id: 'sq-01-1',
    kind: 'squadron',
    name: { zh: '第一战队（长门·陆奥）', ja: '第一戦隊' },
    aliases: ['一战队', '第1戦隊', '第一戦隊'],
    period: { label: '长陆期', order: 1 },
    members: [exact([541], 'flagship'), exact([276])],
    questRefs: [q('A75', 'defines'), q('B99')],
    note: '联合舰队主力战艦编成的第一战队，长门与陆奥为其核心。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'sq-01-2',
    kind: 'squadron',
    name: { zh: '精锐第一战队', ja: '精鋭第一戦隊' },
    aliases: ['一战队', '第1戦隊', '第一戦隊'],
    period: { label: '改二期', order: 2 },
    members: [exact([541], 'flagship'), exact([573])],
    questRefs: [q('A92', 'defines'), q('B129'), q('B130')],
    note: '游戏侧的改二档第一战队：長門改二 旗舰 + 陸奥改二。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'sq-01-3',
    kind: 'squadron',
    name: { zh: '大和型第一战队', ja: '第一戦隊' },
    aliases: ['一战队', '第1戦隊', '第一戦隊'],
    period: { label: '大和·武蔵期', order: 3 },
    members: [exact([911, 916]), exact([546])],
    questRefs: [q('B182', 'defines')],
    note: '大和型两舰编成的第一战队，1944 年捷一号作战时的主力。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'sq-02',
    kind: 'squadron',
    name: { zh: '第二战队', ja: '第二戦隊' },
    aliases: ['二战队', '第2戦隊', '第二戦隊'],
    members: [root(80), root(81), root(26), root(27)],
    questRefs: [q('A42', 'defines'), q('B31')],
    note: '长门型与扶桑型编成的战艦战队。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'sq-02-esc',
    kind: 'squadron',
    name: { zh: '第二战队 伴随部队（捷一号）', ja: '第二戦隊 随伴部隊' },
    aliases: ['二战队伴随', '第二戦隊随伴'],
    period: { label: '捷一号期', order: 4 },
    members: [root(70), root(43), root(97), root(413), root(414)],
    questRefs: [q('A82', 'defines')],
    note: '捷一号作战中随第二战队（扶桑・山城）行动的巡洋舰与驱逐舰。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'sq-03',
    kind: 'squadron',
    name: { zh: '第三战队', ja: '第三戦隊' },
    aliases: ['三战队', '第3戦隊', '第三戦隊'],
    members: [root(78), root(86), root(79), root(85)],
    questRefs: [q('A40', 'defines'), q('C73'), q('B144')],
    note: '金刚型四舰编成的高速战艦战队，长期担任机动部队直卫。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'sq-03-s2',
    kind: 'squadron',
    name: { zh: '第三战队 第二小队', ja: '第三戦隊 第二小隊' },
    aliases: ['三战队第二小队', '第三戦隊第二小隊'],
    period: { label: '第二小队', order: 2 },
    members: [root(86), root(85)],
    constraint: { size: 2 },
    questRefs: [q('Cy15', 'defines'), q('C77'), q('By15')],
    note: '比叡・霧島 两舰的小队；两舰均在第三次所罗门海战中战没。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'sq-04',
    kind: 'squadron',
    name: { zh: '第四战队', ja: '第四戦隊' },
    aliases: ['四战队', '第4戦隊', '第四戦隊'],
    members: [root(67), root(66), root(69), root(68)],
    questRefs: [q('A21', 'defines'), q('B13')],
    note: '高雄型四舰编成的重巡战队。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'sq-04-s2',
    kind: 'squadron',
    name: { zh: '第四战队 第二小队', ja: '第四戦隊 第二小隊' },
    aliases: ['四战队第二小队', '第四戦隊第二小隊'],
    period: { label: '第二小队', order: 2 },
    members: [exact([428]), exact([427])],
    constraint: { size: 2 },
    questRefs: [q('B122', 'defines')],
    note: '摩耶・鳥海 两舰的小队；游戏侧只认两舰的改二形态。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'sq-05',
    kind: 'squadron',
    name: { zh: '第五战队', ja: '第五戦隊' },
    aliases: ['五战队', '第5戦隊', '第五戦隊'],
    period: { label: '妙高型三舰期', order: 1 },
    members: [root(62), root(63), root(65)],
    questRefs: [q('A35', 'defines'), q('Bm1')],
    note: '妙高型三舰编成的重巡战队，参加泗水海战等。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'sq-05-hg',
    kind: 'squadron',
    name: { zh: '第五战队（羽黒·神风）', ja: '第五戦隊' },
    aliases: ['五战队', '第5戦隊', '第五戦隊'],
    period: { label: '1945 期', order: 2 },
    members: [root(65), root(471)],
    questRefs: [q('B138', 'defines')],
    note: '1945 年马六甲海峡海战中 羽黒 与 神風 同行，羽黒 战没、神風 生还。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'sq-06',
    kind: 'squadron',
    name: { zh: '第六战队', ja: '第六戦隊' },
    aliases: ['六战队', '第6戦隊', '第六戦隊'],
    members: [root(59), root(60), root(61), root(123)],
    questRefs: [q('A28', 'defines'), q('B19'), q('B34')],
    note: '古鷹型与青葉型编成的重巡战队，第一次所罗门海战的主力之一。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'sq-07',
    kind: 'squadron',
    name: { zh: '第七战队（新编）', ja: '第七戦隊' },
    aliases: ['七战队', '第7戦隊', '第七戦隊'],
    period: { label: '新编期', order: 2 },
    members: [exact([504, 509], 'flagship'), exact([503, 508]), exact([73]), exact([121])],
    questRefs: [q('A76', 'defines'), q('B101')],
    note: '最上型四舰编成的重巡战队；三隈 在中途岛海战中战没。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'sq-16-1',
    kind: 'squadron',
    name: { zh: '第十六战队（第一次）', ja: '第十六戦隊' },
    aliases: ['十六战队', '第16戦隊', '第十六戦隊'],
    period: { label: '第一次', order: 1 },
    members: [root(64, 'flagship'), root(99), root(21)],
    questRefs: [q('A58', 'defines'), q('B52')],
    note: '南西方面舰队所属的第一次编成。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'sq-16-2',
    kind: 'squadron',
    name: { zh: '第十六战队（第二次）', ja: '第十六戦隊' },
    aliases: ['十六战队', '第16戦隊', '第十六戦隊'],
    period: { label: '第二次', order: 2 },
    members: [root(53, 'flagship'), root(22), root(113)],
    questRefs: [q('A63', 'defines'), q('B55')],
    note: '以 名取 为旗舰的第二次编成。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'sq-16-3',
    kind: 'squadron',
    name: { zh: '第十六战队（第三次）', ja: '第十六戦隊' },
    aliases: ['十六战队', '第16戦隊', '第十六戦隊'],
    period: { label: '第三次', order: 3 },
    members: [root(113), root(61), root(25), root(24)],
    questRefs: [q('A73', 'defines'), q('B84')],
    note: '第三次编成，含重雷装巡洋舰 北上・大井。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'sq-16-4',
    kind: 'squadron',
    name: { zh: '精锐第十六战队（再编成）', ja: '精鋭第十六戦隊' },
    aliases: ['十六战队', '第16戦隊', '第十六戦隊'],
    period: { label: '再编成', order: 4 },
    members: [
      exact([487], 'flagship'),
      exact([119], undefined, true),
      exact([118], undefined, true),
      exact([215], undefined, true),
      exact([264], undefined, true),
      exact([368], undefined, true),
      exact([208], undefined, true),
    ],
    constraint: { size: 6, pickFrom: 5 },
    questRefs: [q('A74', 'defines'), q('B85'), q('B179')],
    note: '游戏侧的再编成档：鬼怒改二 旗舰，僚舰在六个指定形态中取五。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'sq-18',
    kind: 'squadron',
    name: { zh: '第十八战队', ja: '第十八戦隊' },
    aliases: ['十八战队', '第18戦隊', '第十八戦隊'],
    members: [root(51), root(52)],
    constraint: { size: 2 },
    questRefs: [q('A51', 'defines'), q('A89'), q('B43'), q('B120')],
    note: '天龍型两舰编成的轻巡战队，长期在南东方面活动。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'sq-21',
    kind: 'squadron',
    name: { zh: '第二十一战队', ja: '第二十一戦隊' },
    aliases: ['二一战队', '第21戦隊', '第二十一戦隊'],
    period: { label: '新编期', order: 1 },
    members: [exact([192]), exact([193]), root(100), root(101)],
    questRefs: [q('A57', 'defines'), q('B51')],
    note: '北方部队所属的战队，含 多摩・木曾 两舰。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'sq-31-1',
    kind: 'squadron',
    name: { zh: '第三十一战队（第一次）', ja: '第三十一戦隊' },
    aliases: ['三一战队', '第31戦隊', '第三十一戦隊'],
    period: { label: '第一次', order: 1 },
    members: [exact([141], 'flagship'), exact([418]), exact([309])],
    questRefs: [q('A66', 'defines'), q('B60'), q('B72')],
    note: '1944 年 8 月 20 日编成的对潜机动部队，旗舰 五十鈴；1945 年 4 月 20 日吸收解散的第二水雷战队所属各驱逐队',
    noteStatus: 'verified',
    refs: [
      {
        title: '第三十一戦隊 - Wikipedia',
        url: 'https://ja.wikipedia.org/wiki/%E7%AC%AC%E4%B8%89%E5%8D%81%E4%B8%80%E6%88%A6%E9%9A%8A',
      },
    ],
    source: 'quest',
  },
  {
    id: 'sq-31-e1',
    kind: 'squadron',
    name: { zh: '第三十一战队 特务编成（前期）', ja: '第三十一戦隊 特務編成' },
    aliases: ['三一战队', '第31戦隊', '第三十一戦隊'],
    period: { label: '62 区 前期', order: 2 },
    members: [
      root(994, undefined, true),
      root(992, undefined, true),
      root(993, undefined, true),
      root(642, undefined, true),
      root(16, undefined, true),
      root(35, undefined, true),
      root(41, undefined, true),
      root(20, undefined, true),
      root(533, undefined, true),
      root(532, undefined, true),
    ],
    constraint: { pickFrom: 5 },
    questRefs: [q('2606Am1', 'defines'), q('2606Cm1')],
    note: '1945 年 4 月吸收第七（潮・響）／第十七（雪風・初霜）／第四十一（冬月・涼月）驱逐队后的名单',
    noteStatus: 'verified',
    refs: [
      {
        title: '第三十一戦隊 - Wikipedia',
        url: 'https://ja.wikipedia.org/wiki/%E7%AC%AC%E4%B8%89%E5%8D%81%E4%B8%80%E6%88%A6%E9%9A%8A',
      },
    ],
    source: 'quest',
  },
  {
    id: 'sq-31-e2',
    kind: 'squadron',
    name: { zh: '第三十一战队 特务编成（后期）', ja: '後期第三十一戦隊 特務編成' },
    aliases: ['三一战队', '第31戦隊', '第三十一戦隊'],
    period: { label: '62 区 后期', order: 3 },
    members: [
      root(1041, undefined, true),
      root(1044, undefined, true),
      root(642, undefined, true),
      root(993, undefined, true),
      root(994, undefined, true),
      root(992, undefined, true),
      root(16, undefined, true),
      root(35, undefined, true),
    ],
    constraint: { pickFrom: 5 },
    questRefs: [q('2606Am1', 'defines'), q('2606Cm1')],
    note: '游戏期间限定任务「第三十一戦隊 特務編成！」的后段名单，以丁型驱逐舰为主。',
    noteStatus: 'draft',
    source: 'quest',
  },

  // ══ 航空戦隊 ══
  {
    id: 'cd-01',
    kind: 'carrierDivision',
    name: { zh: '第一航空战队', ja: '第一航空戦隊' },
    aliases: ['一航战', '第1航空戦隊', '第一航空戦隊'],
    members: [root(83), root(84)],
    constraint: { size: 2 },
    questRefs: [q('B69', 'defines'), q('B137'), q('B154'), q('F88')],
    note: '赤城・加賀 编成的航空战队，南云机动部队的核心；两舰均在中途岛海战中战没。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'cd-02',
    kind: 'carrierDivision',
    name: { zh: '第二航空战队', ja: '第二航空戦隊' },
    aliases: ['二航战', '第2航空戦隊', '第二航空戦隊'],
    members: [root(90), root(91)],
    constraint: { size: 2 },
    questRefs: [q('A36', 'defines'), q('A39', 'defines'), q('B25'), q('B26')],
    note: '蒼龍・飛龍 编成的航空战队；中途岛海战中 飛龍 最后反击并战没。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'cd-03',
    kind: 'carrierDivision',
    name: { zh: '第三航空战队', ja: '第三航空戦隊' },
    aliases: ['三航战', '第3航空戦隊', '第三航空戦隊'],
    members: [exact([112], 'flagship'), root(116), exact([108]), exact([109])],
    questRefs: [q('A59', 'defines'), q('B53')],
    note: '捷一号作战时小泽舰队的航空战队，以 瑞鶴 为旗舰。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'cd-04',
    kind: 'carrierDivision',
    name: { zh: '第四航空战队', ja: '第四航空戦隊' },
    aliases: ['四航战', '第4航空戦隊', '第四航空戦隊'],
    members: [exact([82]), exact([88])],
    constraint: { size: 2 },
    questRefs: [q('A60', 'defines'), q('A77'), q('B102'), q('B114'), q('B132')],
    note: '伊勢・日向 改装为航空战艦后编成的航空战队。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'cd-05-1',
    kind: 'carrierDivision',
    name: { zh: '第五航空战队', ja: '第五航空戦隊' },
    aliases: ['五航战', '第5航空戦隊', '第五航空戦隊'],
    period: { label: '初编', order: 1 },
    members: [root(110), root(111)],
    constraint: { size: 2 },
    questRefs: [q('A23', 'defines'), q('B15')],
    note: '翔鶴・瑞鶴 编成的航空战队，参加珊瑚海海战与南太平洋海战。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'cd-05-2',
    kind: 'carrierDivision',
    name: { zh: '第五航空战队（再编）', ja: '第五航空戦隊' },
    aliases: ['五航战', '第5航空戦隊', '第五航空戦隊'],
    period: { label: '再编成', order: 2 },
    members: [root(110), root(111), root(93), root(132)],
    questRefs: [q('A56', 'defines'), q('B50'), q('B143')],
    note: '含直卫驱逐舰的再编成档。',
    noteStatus: 'draft',
    source: 'quest',
  },

  // ══ 水雷戦隊 ══
  {
    id: 'td-01-1',
    kind: 'torpedoSquadron',
    name: { zh: '第一水雷战队（北方突入）', ja: '第一水雷戦隊' },
    aliases: ['一水战', '第1水雷戦隊', '第一水雷戦隊'],
    period: { label: 'KE 号 期', order: 1 },
    members: [root(114, 'flagship'), root(35), root(41), root(40), root(46), root(50)],
    questRefs: [q('A54', 'defines'), q('B46')],
    note: '基斯岛撤退作战（KE 号作战）中突入的水雷战队，旗舰 阿武隈。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'td-01-2',
    kind: 'torpedoSquadron',
    name: { zh: '第一水雷战队（北方再突入）', ja: '第一水雷戦隊' },
    aliases: ['一水战', '第1水雷戦隊', '第一水雷戦隊'],
    period: { label: '再突入期', order: 2 },
    members: [exact([200], 'flagship'), root(35), root(133), root(135), root(132), root(50)],
    questRefs: [q('A55', 'defines'), q('B47')],
    note: '游戏侧的再突入档：阿武隈改二 旗舰。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'td-02',
    kind: 'torpedoSquadron',
    name: { zh: '第二水雷战队', ja: '第二水雷戦隊' },
    aliases: ['二水战', '第2水雷戦隊', '第二水雷戦隊'],
    period: { label: '天一号期', order: 1 },
    members: [exact([663, 668], 'flagship')],
    constraint: { size: 3 },
    questRefs: [q('B168', 'defines')],
    note: '天一号作战中随 大和 出击的水雷战队，旗舰 矢矧；游戏正文只点名旗舰，僚舰只给舰种。',
    noteStatus: 'draft',
    source: 'literature',
  },
  {
    id: 'td-04-1',
    kind: 'torpedoSquadron',
    name: { zh: '第四水雷战队', ja: '第四水雷戦隊' },
    aliases: ['四水战', '第4水雷戦隊', '第四水雷戦隊'],
    period: { label: '新编期', order: 1 },
    members: [exact([488], 'flagship'), root(44), root(45), root(405), root(46)],
    questRefs: [q('A78', 'defines'), q('B103')],
    note: '以 由良 为旗舰、第二驱逐队为骨干的水雷战队。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'td-04-2',
    kind: 'torpedoSquadron',
    name: { zh: '精锐第四水雷战队', ja: '精鋭第四水雷戦隊' },
    aliases: ['四水战', '第4水雷戦隊', '第四水雷戦隊'],
    period: { label: '精锐期', order: 2 },
    members: [
      exact([498], 'flagship'),
      exact([488], undefined, true),
      exact([144], undefined, true),
      exact([323], undefined, true),
      exact([246], undefined, true),
      exact([330], undefined, true),
    ],
    constraint: { size: 4, pickFrom: 3 },
    questRefs: [q('A84', 'defines'), q('B112')],
    note: '游戏侧的精锐档：村雨改二 旗舰，僚舰在五个指定形态中取三。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'td-06',
    kind: 'torpedoSquadron',
    name: { zh: '第六水雷战队', ja: '第六水雷戦隊' },
    aliases: ['六水战', '第6水雷戦隊', '第六水雷戦隊'],
    members: [
      exact([622, 623, 624], 'flagship'),
      root(1),
      root(2),
      root(164),
      root(165),
      root(30),
      root(31),
    ],
    questRefs: [q('B141', 'defines', 'memo2'), q('Bq13')],
    note: '以 夕張 为旗舰、睦月型驱逐舰为骨干的水雷战队。',
    noteStatus: 'draft',
    source: 'memo',
  },

  // ══ 艦隊 / 提督名部队 / 其他 ══
  {
    id: 'fl-05',
    kind: 'fleet',
    name: { zh: '第五舰队', ja: '第五艦隊' },
    aliases: ['五舰队', '第5艦隊', '第五艦隊'],
    members: [root(63), root(64), root(100), root(101)],
    questRefs: [q('A29', 'defines')],
    note: '北方部队的主力舰队，参加阿留申方面作战与基斯岛撤退。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'fl-06',
    kind: 'fleet',
    name: { zh: '第六舰队（潜水舰队）', ja: '第六艦隊' },
    aliases: ['六舰队', '第6艦隊', '第六艦隊', '潜水艦隊'],
    members: [],
    constraint: { size: 5 },
    questRefs: [q('A37', 'defines')],
    note: '日本海军的潜水舰队司令部；游戏正文只给舰种（潜水母舰 1 + 潜水舰 4），不点名具体舰。',
    noteStatus: 'draft',
    source: 'literature',
  },
  {
    id: 'mikawa-1',
    kind: 'namedForce',
    name: { zh: '三川舰队', ja: '三川艦隊' },
    aliases: ['三川舰队', '三川艦隊'],
    period: { label: '初编', order: 1 },
    members: [root(69, 'flagship'), root(61), root(60), root(59), root(51)],
    questRefs: [q('A20', 'defines'), q('B11')],
    note: '三川军一中将指挥的第八舰队，第一次所罗门海战的突入部队。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'mikawa-2',
    kind: 'namedForce',
    name: { zh: '新三川舰队', ja: '新三川艦隊' },
    aliases: ['三川舰队', '三川艦隊'],
    period: { label: '全编', order: 2 },
    members: [root(69, 'flagship'), root(61), root(123), root(60), root(59), root(51)],
    questRefs: [q('A24', 'defines'), q('B16')],
    note: '含 衣笠 的完整编成档。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'mikawa-3',
    kind: 'namedForce',
    name: { zh: '三川舰队（突入编成）', ja: '三川艦隊' },
    aliases: ['三川舰队', '三川艦隊'],
    period: { label: '突入期', order: 3 },
    members: [
      exact([427], 'flagship'),
      root(59, undefined, true),
      root(60, undefined, true),
      root(61, undefined, true),
      root(123, undefined, true),
      root(115, undefined, true),
      root(51, undefined, true),
    ],
    constraint: { size: 6, pickFrom: 5 },
    questRefs: [q('A50', 'defines'), q('B41'), q('Bq7')],
    note: '游戏侧的突入档：鳥海改二 旗舰，僚舰在六舰中取五。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'nishimura-1',
    kind: 'namedForce',
    name: { zh: '西村舰队', ja: '西村艦隊' },
    aliases: ['西村舰队', '西村艦隊'],
    period: { label: '初编', order: 1 },
    members: [root(26), root(27), root(70), root(43)],
    questRefs: [q('A22', 'defines'), q('B14')],
    note: '西村祥治中将指挥的第一游击部队第三部队，苏里高海峡海战中几乎全灭。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'nishimura-2',
    kind: 'namedForce',
    name: { zh: '西村舰队（再编成）', ja: '西村艦隊' },
    aliases: ['西村舰队', '西村艦隊'],
    period: { label: '再编成', order: 2 },
    members: [root(26), root(27), root(70), root(43), root(97)],
    questRefs: [q('A44', 'defines'), q('B33')],
    note: '含 満潮 的完整编成档；時雨 是唯一生还者。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'nishimura-3',
    kind: 'namedForce',
    name: { zh: '西村舰队 先行扫讨部队', ja: '西村艦隊 先行掃討部隊' },
    aliases: ['西村舰队', '西村艦隊'],
    period: { label: '先行扫讨', order: 3 },
    members: [
      exact([501, 506], 'flagship'),
      root(43, undefined, true),
      root(97, undefined, true),
      root(413, undefined, true),
      root(414, undefined, true),
    ],
    constraint: { size: 3, pickFrom: 2 },
    questRefs: [q('B167', 'defines')],
    note: '游戏侧的先行档：最上改二 旗舰，僚舰在四舰中取二。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'ozawa',
    kind: 'namedForce',
    name: { zh: '小沢舰队', ja: '小沢艦隊' },
    aliases: ['小泽舰队', '小沢艦隊', '機動部隊本隊'],
    members: [
      exact([112], 'flagship'),
      exact([117]),
      exact([108]),
      exact([109]),
      exact([82]),
      exact([88]),
    ],
    questRefs: [q('A61', 'defines'), q('B54')],
    note: '小泽治三郎中将指挥的机动部队本队，捷一号作战中担任诱饵部队。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'nagumo',
    kind: 'namedForce',
    name: { zh: '南云机动部队', ja: '南雲機動部隊' },
    aliases: ['南云机动部队', '南雲機動部隊', '第一航空艦隊'],
    members: [root(83), root(84), root(91), root(90)],
    constraint: { exclusive: true },
    questRefs: [q('A19', 'defines')],
    note: '南云忠一中将指挥的第一航空舰队，珍珠港奇袭与中途岛海战的主力。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'rei-1',
    kind: 'namedForce',
    name: { zh: '水上反击部队', ja: '水上反撃部隊' },
    aliases: ['水上反击部队', '水上反撃部隊'],
    period: { label: '初编', order: 1 },
    members: [root(49, 'flagship'), root(64)],
    questRefs: [q('A46', 'defines'), q('Bm7')],
    note: '以 霞 为旗舰、足柄 为核心的水上突入部队。',
    noteStatus: 'draft',
    source: 'quest',
  },
  {
    id: 'rei-2',
    kind: 'namedForce',
    name: { zh: '礼号作战部队（精锐水上反击部队）', ja: '礼号作戦部隊' },
    aliases: ['礼号作战', '礼号作戦', '精鋭水上反撃部隊'],
    period: { label: '礼号期', order: 2 },
    members: [root(49, 'flagship'), root(64), root(183), root(425), root(410)],
    questRefs: [q('A65', 'defines'), q('B57', 'defines', 'name')],
    note: '1944 年 12 月 26 日民都洛岛冲的礼号作战部队；参战舰另含第三十一战队的 榧・杉・樫',
    noteStatus: 'verified',
    refs: [
      {
        title: '礼号作戦 - Wikipedia',
        url: 'https://ja.wikipedia.org/wiki/%E7%A4%BC%E5%8F%B7%E4%BD%9C%E6%88%A6',
      },
    ],
    source: 'quest',
  },
  {
    id: 'tf-night',
    kind: 'namedForce',
    name: { zh: '特遣舰队（夜战机动部队）', ja: '任務部隊' },
    aliases: ['特遣舰队', '任務部隊', 'Task Force'],
    members: [exact([545, 550], 'flagship')],
    constraint: { size: 4 },
    questRefs: [q('A80', 'defines'), q('B105'), q('B106')],
    note: '美军快速航母部队的夜战航母群；游戏正文只点名旗舰，僚舰只给舰种。',
    noteStatus: 'draft',
    source: 'literature',
  },
  {
    id: 'ka-601',
    kind: 'airGroup',
    name: { zh: '第六〇一航空队', ja: '第六〇一海軍航空隊' },
    aliases: ['六〇一空', '601空', '第六〇一海軍航空隊'],
    members: [exact([406])],
    questRefs: [q('B28', 'defines')],
    note: '舰上机部队编制的航空队；游戏正文只点名 雲龍改 一艘。',
    noteStatus: 'draft',
    source: 'literature',
  },
  {
    id: 'esc-1st',
    kind: 'escortCommand',
    name: { zh: '海上护卫总队 / 第一护卫舰队', ja: '海上護衛総隊' },
    aliases: ['海上护卫总队', '海上護衛総隊', '第一護衛艦隊'],
    period: { label: '加强编成', order: 1 },
    members: [],
    constraint: { size: 4 },
    questRefs: [q('B100', 'defines'), q('D23')],
    note: '负责船团护卫的专门组织；游戏正文只给舰种，不点名具体舰。',
    noteStatus: 'draft',
    source: 'literature',
  },
]

// ---- 索引（与 ship-nationality / ship-remodel-chain 同形：模块只拉取，不自造）----

export interface HistFleetIndex {
  /** 按改造链根形态查（图鉴目录/筛选口径） */
  ofRoot(rootId: number): readonly HistFleetEntry[]
  /** 按具体形态查（exact 成员只在被列举的那些形态上命中） */
  ofForm(mstId: number): readonly HistFleetEntry[]
  byId(id: string): HistFleetEntry | null
  /** 认 name.zh / name.ja / aliases */
  byName(text: string): HistFleetEntry | null
  /** 这条队在图鉴里能显示的成员数（absent 不算） */
  entries: readonly HistFleetEntry[]
}

const HIST_FLEET_BY_ID = new Map(HIST_FLEETS.map((entry) => [entry.id, entry]))

export const histFleetById = (id: string): HistFleetEntry | null =>
  HIST_FLEET_BY_ID.get(id) ?? null

/** 成员引用涉及的全部 mstId（absent 没有 id，返回空） */
export const memberFormIds = (ref: HistFleetMemberRef): readonly number[] => {
  if (ref.form === 'root') return [ref.id]
  if (ref.form === 'exact') return ref.forms
  return []
}

/**
 * 反向索引在装配期建一次，别在渲染里逐舰扫全表
 *（舰娘卷目录里「这个形态有几艘在籍」被问上百万次的那个教训）。
 *
 * `rootOf` 来自 shared/ship-remodel-chain 的产物：素名成员靠它把整条链都算进去，
 * 写明形态成员只把**被列举的那几个形态**所在的链根登记进 ofRoot——
 * 图鉴按根形态列，不登记的话「精锐第一战队」在 長門 那一格就查不到。
 */
export const buildHistFleetIndex = (
  rootOf: ReadonlyMap<number, number>,
): HistFleetIndex => {
  const byRoot = new Map<number, HistFleetEntry[]>()
  const byForm = new Map<number, HistFleetEntry[]>()
  const byName = new Map<string, HistFleetEntry>()
  const push = (map: Map<number, HistFleetEntry[]>, key: number, entry: HistFleetEntry) => {
    const list = map.get(key)
    if (list) {
      if (!list.includes(entry)) list.push(entry)
    } else map.set(key, [entry])
  }
  for (const entry of HIST_FLEETS) {
    for (const name of [entry.name.zh, entry.name.ja, ...entry.aliases]) {
      if (name && !byName.has(name)) byName.set(name, entry)
    }
    for (const member of entry.members) {
      const ids = memberFormIds(member.ref)
      for (const id of ids) {
        push(byForm, id, entry)
        push(byRoot, rootOf.get(id) ?? id, entry)
      }
      // 素名成员：整条链的每个形态都算这一队的成员
      if (member.ref.form === 'root') {
        const rootId = rootOf.get(member.ref.id) ?? member.ref.id
        push(byRoot, rootId, entry)
      }
    }
  }
  return {
    ofRoot: (rootId) => byRoot.get(rootId) ?? [],
    ofForm: (mstId) => byForm.get(mstId) ?? [],
    byId: histFleetById,
    byName: (text) => byName.get(text) ?? null,
    entries: HIST_FLEETS,
  }
}

/** 按种类分组显示时的排序与标题 */
export const HIST_FLEET_KIND_LABEL: Record<HistFleetKind, string> = {
  destroyerDivision: '駆逐隊',
  squadron: '戦隊',
  carrierDivision: '航空戦隊',
  torpedoSquadron: '水雷戦隊',
  fleet: '艦隊',
  namedForce: '提督名·作战名部队',
  airGroup: '航空隊',
  escortCommand: '护卫总队',
}

export const HIST_FLEET_KIND_ORDER: readonly HistFleetKind[] = [
  'destroyerDivision',
  'squadron',
  'carrierDivision',
  'torpedoSquadron',
  'fleet',
  'namedForce',
  'airGroup',
  'escortCommand',
]
