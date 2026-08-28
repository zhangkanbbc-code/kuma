// 艦素实际会去读的矿脉包。
//
// 这张表是**健康度面板的判据**：不在表里的包就算装了也没人用，
// 在表里却缺失的包会让对应功能静默降级——那正是要报出来的东西。
//
// 与源码里的 queryLode/getLode 调用保持一致，由 core-regressions 里的
// 「矿脉清单与实际读取一致」逐条核对，改了一边忘了另一边会红。
//
// ---- 2026-08-23：每条加了 `impact` 与 `selfFetch` ----
// 用户看健康度卡时抓到它整体过时：缺包那一行对着 13 个包只说一句
// 「用到它们的面板会显示『待补』」——**哪个面板、哪一格，一个字都没有**，
// 而且那句话对 `map-intel` 根本不成立（常规海域三层早就随包，缺它只少 5 张活动图）。
// 一句覆盖一切的话既吓人又没用，所以判据挪到这里逐包写清楚：
//  · `impact`   缺了之后**哪个面板的哪一格**会降级。健康度卡逐条照它说话，不再自己编。
//  · `selfFetch` 这个包**不随发行版**（上游没有允许再分发的许可），玩家那份里就是没有。
//    它与 `scripts/lib/bundled-lodes.mjs` 交叉核对（数据 × 数据，护栏在
//    test/lode-health.test.mjs），两边不一致会当场红——那正是这次过时的成因。

export interface ConsumedLode {
  id: string
  /**
   * 缺了之后**哪个面板的哪一格**会降级。写具体的格，别写「相关功能」。
   *
   * 判据：这句话要能让维护者判断「这包值不值得补／换源排在多前面」。
   *（它落在钥的矿脉健康度卡上，而那张卡 2026-08-24 起只在 `KANSO_DEBUG_UI=1` 下装配。）
   * 写不出具体的格，多半说明这个包其实没人读——那它就不该在这张表里。
   */
  impact: string
  /**
   * 这个包**不随发行版**：上游没有允许再分发的许可。
   * 维护者侧跑 `npm run lodes:fetch` 补进开发树；**玩家那份产物里永远没有它**
   *（2026-08-21 起「玩家显式拉取」那条中间路已废弃，发行版没有拉包通道，
   * 钥里也从来没有过「更新数据包」那个按钮）。
   *
   * ⚠️ 判据的**唯一出处**是 `scripts/lode-sources.json` 的 `bundle`；
   * 这里的标记只是给运行时用的副本，护栏逐条交叉核对，不许两边打架。
   */
  selfFetch?: true
  /**
   * 不能自动拉取的原因。有这一项就**不该**建议用户去跑 lodes:fetch——
   * 那条命令对它无效，让人白折腾正是这张面板要避免的事。
   */
  manualOnly?: string
  /**
   * 上游已经不再更新时，**这件事对玩家的真实含义**。
   *
   * 通用那句「那之后加入游戏的内容不会出现在这几份资料里」对多数包成立，
   * 但对已经被后续层接住的包就是虚惊一场——那种情况在这里写清楚。
   */
  upstreamNote?: string
}

export const CONSUMED_LODES: readonly ConsumedLode[] = [
  { id: 'abyssal-stats', impact: '战斗的敌舰卡与图鉴深海卷少了深海舰的数值（火力/装甲/雷装等）' },
  {
    id: 'dev-recipes',
    selfFetch: true,
    impact: '装备详情里的「开发配方」那一节不出',
  },
  {
    id: 'build-recipes',
    selfFetch: true,
    impact: '舰娘详情里的「建造配方」那一节不出',
  },
  { id: 'ship-exp', impact: '舰娘卷的「还差多少经验」与练级换算只能给到粗略档位' },
  {
    id: 'akashi-list',
    selfFetch: true,
    impact: '改修工厂的「逐星加成」列空着（周历与消耗另有来源，不受影响）',
  },
  {
    // 2026-08-25 起是**第一方事实表且随包**：改修的消耗、二号舰、开放星期、更新链
    // 是游戏机制的客观事实，不属于任何转录者。它顶掉的 `equip-upgrades` 是个自取包
    //（上游无许可 → 不随发行版），于是首发玩家的改修卡整块是「待补」——
    // 一件明明是客观事实的东西，因为转录者的许可对玩家消失了。
    // 随包之后这一格不该再出现「待补」，除非产物被人删过文件。
    id: 'equip-improve',
    impact: '改修工厂的周历、二番舰、消耗与更新链整块显示待补',
  },
  {
    // 2026-08-27 起的第一方事实表且随包：哪件机体挨敌方对空射击时更不容易被打下来。
    // 铎的基地航空卡拿它给「推荐搭配」排序（回避档是第一顺位）；缺包不影响其余各格，
    // 只是推荐退化成「按攻击力与耗铝排」，且每条的回避档显示成未收录。
    id: 'equip-aa-evasion',
    impact: '基地航空「推荐搭配」的回避档一列显示未收录，排序退成只看攻击力与耗铝',
  },
  { id: 'event-bonus', impact: '活动海域的特效倍率（倍卡）不出，编成推演里那一项按 1.0 算' },
  {
    // 2026-08-28 起的第一方事实表且随包：本期活动里哪架飞机属于哪个陆航特効组。
    // 它是 event-bonus 的另一半——倍率在那个包里，分组名单在这里（上游放在另一个页面）。
    // 缺了它，铎的陆航推荐认不出特効机，于是活动图也按纯威力排：不会算错，只是选不出
    // 「塞一架 C2 机把整队抬 20%」那种搭配。
    id: 'event-plane-groups',
    impact: '基地航空「推荐搭配」在活动图上认不出特効机，退成按纯威力排（不会算错，只是选不出为整队 buff 而入队的搭配）',
  },
  // 装备加成：2026-08-22 起吃第一方 schema 的 kcwiki 底表（CC，随包）。
  // EO 的 `fit-bonus` 同日降为维护者侧对账印证票，运行时零读取，故不在这张表里。
  { id: 'kcwiki-fit-bonus', impact: '装备详情的「装备加成」预期值表空着，只剩面板反推的实测那一轨' },
  {
    id: 'kcnav-routing',
    selfFetch: true,
    // 2026-08-06 实测：非浏览器 UA 打它的 API 会让整个出口 IP 被封到
    // 连人工访问都弹 401。抓取器已改成只读手动导出包，不要加回在线抓取。
    manualOnly: 'KCNav 拒绝未授权自动化，只能从 tsunkit.net 手动导出后放进用户包目录',
    impact: '海域卷的路线页少一栏「实测编成频率」；带路的文字条件不受影响',
  },
  { id: 'kcwiki-expedition', impact: '远征卷的收益、时长与成功条件整块显示待补' },
  {
    id: 'kcwiki-localization',
    impact: '全应用的中文名会退回日文原名（舰娘、装备、深海舰、道具、舰种、海域）',
  },
  {
    id: 'kcwiki-quest-req',
    impact: '任务计数的第一规则源没了，那 424 条任务退到后面三层去判（多数仍数得出来）',
    // 上游 2022-04 就停了，健康度卡会点名它。但这件事**不该按通用话说**：
    // 停更的含义是「2022 之后新加入的任务不在它里面」，而那些任务由后面三层
    // （poi-quest-goal / 艦素自研 / 中文正文兜底）接住——本机实测 644 条追踪器全部就绪。
    upstreamNote:
      '它只是任务计数的第一规则源；2022 之后的新任务由后面三层（poi 目标表、kuma 自研规则、中文正文）接住，本机 644 条任务追踪器全部就绪',
  },
  // 战斗曲曲名（2026-08-24 新开）：战斗树资源号 → 官方曲名。
  // 游戏主数据 `api_mst_bgm` 只给**母港树**的号，与战斗树是两套编号
  // （详见 shared/kcs-bgm.ts 的 bgmMasterCandidates），所以战斗曲的名字非它不可。
  {
    id: 'kcwiki-bgm',
    impact: '顶栏「正在播放」与海域卷的 ♪ 试听词条里，战斗曲一律退回只显示编号（母港曲不受影响，那一层是游戏主数据给的）',
  },
  { id: 'kcwiki-routing', impact: '海域卷路线页的「中文带路条件」不出' },
  {
    id: 'kcwiki-ships',
    impact: '图鉴舰娘卷的 CV／画师／舰级／初期装备与改造链退回主数据能给的那几项',
  },
  { id: 'kcwiki-voice', impact: '台词卷的中文台词主层没了，只剩字幕包那一层兜底' },
  // 台词自补层（2026-08-22 新开）：**第一方译文**。上游两家（舰娘百科 / poi-plugin-subtitle）
  // 都没收录的形态，中文层整片是空的——玩家点开吞武里的台词卷只看得到一片空白。
  // 唯一有那些台词的机读源只给日文、且无许可声明不随包，所以中文由艦素自己译；
  // 日文原文那一列 2026-08-22 起也随包（与 kcwiki-voice.ja / subtitle-ja 同级）。
  // 与 `map-drop-windows` 同属 `FIRST_PARTY_LODE_IDS`：抓不回来，随源码走。
  // 2026-08-23 kcwiki 两轮重抓（末轮页清单换穷举、372→765 形态）追录了本层原先独扛的
  // 一大批形态，本层按「只补空」逐槽退位，现留任 49 个形态 / 1453 行——其中 22 个形态
  // 上游两家仍是整卷零行（三隈改二特、清霜改二、雾岛改二丙、吹雪改三……）。
  {
    id: 'kanso-voice',
    impact: '上游两家仍没收的那 22 个形态（三隈改二特、清霜改二等）台词卷整页空白，另 27 个形态缺一大片',
  },
  // 季节限定台词（中文译文）。2026-08-22 起是一个**新开的域**：
  // 舰娘页的「季节限定语音」小节是挂件调用，一行文本都没有，
  // 文本住在「季节性/*」独立页上，此前谁都没抓。
  { id: 'kcwiki-seasonal-voice', impact: '台词卷的「季节限定台词」整段不出' },
  // 海域情报是四层：map-intel 是底座（活动图各难度层与其掉落编成），
  // map-enemy-comps 是 2026-08-22 起接管常规图敌编成的第一方汇编层，
  // map-drops 是同日接管常规图确认掉落与空掉落标记的第一方汇编层，
  // map-drop-windows 是同日接管常规图限定期窗口的第一方**手工台账**
  //（`FIRST_PARTY_LODE_IDS` 的头一个住户：抓不回来，随源码走）。
  // 底座现在**只剩活动图那一域**在用——常规 37 图的节点、敌编成、掉落、限定期
  // 全部由上面三个随包层供数（2026-08-23 逐格比对：缺底座时常规侧一格不差）。
  {
    id: 'map-intel',
    selfFetch: true,
    impact: '只影响活动海域那几张图的详情（各难度层的节点、掉落、敌编成、解谜与陆航所需半径）；常规 37 图一格不差',
  },
  { id: 'map-enemy-comps', impact: '常规海域的敌编成整块显示待补（1312 套）' },
  { id: 'map-drops', impact: '常规海域的确认掉落目录整块显示待补' },
  { id: 'map-drop-windows', impact: '常规海域的限定掉落不再标起讫日期' },
  // 成长三维（回避/对潜/索敌）的 [Lv1, Lv99] 端点：2026-08-22 起从第一方汇编包吃，
  // 两处消费——面板反推七项扩展的端点表、图鉴舰娘卷的三维上限展示。
  // `wikiwiki-ship-max` 同日降为维护者侧选票（只在汇编时投票，运行时零读取）。
  { id: 'ship-stats', impact: '舰娘卷的回避／对潜／索敌上限与面板反推的那三项显示待补' },
  { id: 'poi-fcd-map', impact: '海域图上的节点字母与坐标画不出来' },
  { id: 'poi-quest-goal', impact: '任务计数少一层规则源，少数任务的进度只能靠中文正文推' },
  { id: 'quests-scn', impact: '任务卷的中文正文与前置链判定基准没了，任务列表几乎不可用' },
  { id: 'subtitle-enemies', impact: '深海舰台词卷少了能试听的那一组（按官方音轨号）' },
  { id: 'subtitle-ja', impact: '台词卷的日文原文对照少一半，播放键的逐行交叉校验也失去判据' },
  { id: 'subtitle-npc', impact: 'NPC 与短剧的字幕不出' },
  { id: 'subtitle-zh', impact: '台词卷的中文兜底层没了，舰娘百科没收的形态就只剩日文' },
  {
    id: 'wikiwiki-abyss-voice',
    selfFetch: true,
    impact: '深海舰台词卷只剩字幕包覆盖到的那些形态有词（这一层按官方 No. 精确补到形态）',
  },
  { id: 'wikiwiki-expedition', selfFetch: true, impact: '远征卷少一份日文一手对照（中文那层不受影响）' },
  { id: 'wikiwiki-item-exchange', selfFetch: true, impact: '道具图鉴的「兑换目录」那一节不出' },
  {
    id: 'wikiwiki-quests',
    selfFetch: true,
    impact: '任务前置链少一层补缺：舰娘百科没收的开放条件与失效前置码不再被补上／标出',
  },
  { id: 'wikiwiki-remodel', selfFetch: true, impact: '改造卷的素材与可逆改造的「回程成本」显示待补' },
  {
    id: 'wikiwiki-routing',
    selfFetch: true,
    // 2026-08-23 核过一轮「是不是该退役」：**不该**。它有两个 kcwiki 顶不上的角色，
    // 逐条量过：① 路线页的日文一手分歧表（并列三证据里的一证，README 写明是有意为之）；
    // ② 镝的「能动分歧（玩家手选去向）」判据——`能動分岐` 标记 20 条 / 6 张图
    //（4-5、5-3、5-5、6-3、7-4、7-5），而 kcwiki-routing 全包 0 处。
    // 撤了它，2026-08-12 用户报的「把能动分歧写成罗盘分歧」会原样复发。
    impact: '路线页少一栏日文一手分歧说明；战斗也认不出「能动分歧」（玩家手选去向）那几个点',
  },
  // wikiwiki-ship-max 2026-08-22 起**运行时零读取**，降为维护者侧选票（eo-quests 地位）：
  // 它只在 `lodes:fetch` 汇编 ship-stats 时逐格投票，供值的是 kcwiki 基座与第一方补丁台账。
  {
    id: 'wikiwiki-ship-profile',
    selfFetch: true,
    impact: '舰娘百科停收的那 89 个新形态没有 CV／画师／舰级／初期装备',
  },
  {
    id: 'wikiwiki-voice',
    selfFetch: true,
    impact: '两个形态（747、1036）的台词卷整页空白；其余形态另有三层顶上',
  },
]

export const CONSUMED_LODE_IDS: readonly string[] = CONSUMED_LODES.map((entry) => entry.id)

export const consumedLodeOf = (id: string): ConsumedLode | null =>
  CONSUMED_LODES.find((entry) => entry.id === id) ?? null

export const manualOnlyReason = (id: string): string | null => consumedLodeOf(id)?.manualOnly ?? null

/** 缺了影响哪一格。健康度卡逐条照它说话——查不到就别自己编一句通用的。 */
export const consumedLodeImpact = (id: string): string => consumedLodeOf(id)?.impact ?? ''

/** 这个包不随发行版，得玩家自己拉一次。 */
export const isSelfFetchLode = (id: string): boolean => consumedLodeOf(id)?.selfFetch === true
