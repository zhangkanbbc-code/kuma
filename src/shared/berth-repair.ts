/**
 * 母港泊地修理（明石タイマー）的判据与推算。
 *
 * **先分清两个同名机制**——本仓里「泊地修理」这四个字已经被占用过一次：
 *   · **緊急泊地修理**：出击途中在泊地格上开工，游戏有报文
 *     （`api_req_map/anchorage_repair`），已实现，见 store.ts 与 mg-types 的
 *     `SortieAnchorageRepair`。秋津洲改能做的是**这一个**。
 *   · **母港泊地修理**（本文件）：工作舰当旗舰，在母港干等，随伴舰按入渠速度悄悄回血。
 *     **游戏对它零报文**——回血只在下一次 `api_port/port` 的舰况里体现。
 *     所以这里全是客户端推算，凡是报出去的数都得挂「估算」。
 *
 * ════ 查证（2026-08-26。口径要改先回来对这一段，每条都记了出处与源数）════
 *
 * ① 谁能当修理旗舰：明石 / 明石改 / 朝日改。
 *    wikiwiki「艦艇修理施設」列可装备本装备的工作舰为「明石、明石改、朝日改」；
 *    note.com/hrsnsw/n/n98545c7f5684 独立说「明石（改）/朝日改」。两源一致。
 *    这三者恰好就是 **api_stype 19（工作艦）** 的全部：本仓已查证过「朝日改换了舰种」
 *    （见 renderer/modules/di.ts 练巡加成那段，未改的朝日是练巡 CT 21），
 *    所以按舰种判等价于按名字点名，且新工作舰进游戏时不必回来改名单。
 *    **秋津洲改自动落在门外**（水母 stype 16）——它只做緊急泊地修理。
 *
 * ② 覆盖范围：不带艦艇修理施設时旗舰 + 2 号舰共 2 艘，每多带一个多覆盖一位，
 *    带满 4 个覆盖全队 6 艘。**四源一致**，其中一源是可执行代码：
 *    KancolleSniffer `AkashiTimer.cs` 写作 `fs.Slot.Count(装备是修理施設) + 2`；
 *    wikiwiki「艦艇修理施設」「無装備でも…2隻…4スロット全てに装備すると自身を含め6隻」；
 *    wikiwiki「明石」的表 0個→2号艦、4個→6号艦；
 *    kamigame 的「0个修1舰、4个修5舰」是**不含旗舰**的数法，换算后同表。
 *
 * ③ 门槛：小破まで才修，中破以上不修。**四源一致**——
 *    wikiwiki「明石」「小破以下」、note.com「小破以下の随伴艦」、kamigame「中破以上」不可、
 *    ElectronicObserver kcmemo「中破未満」。
 *    换算成本仓既有的损伤档（见 ru.ts shipIssues：中破 = 0.25 < 比例 ≤ 0.5）
 *    即 **HP 比例 > 0.5**。这里不另立一套比例，与编队表同一把尺。
 *
 * ④ 入渠中的舰排除：wikiwiki「明石」「入渠中の艦艇は修理されない」、
 *    kcmemo 与 KancolleSniffer 源码同（后者 `_dockInfo.InNDock(...)` 直接排除）。三源一致。
 *
 * ⑤ **旗舰自己中破以上、或旗舰在渠 → 整队不执行修理**。三源一致：
 *    kcmemo 的执行条件「旗艦が中破していない」「旗艦が入渠中でない」；
 *    KancolleSniffer 源码 `fs.DamageLevel >= Damage.Half || _dockInfo.InNDock(fs.Id)` 直接跳过；
 *    kamigame 同。
 *    **注意这是「不执行修理」，不是「计时归零」**——fujieda 明说重启计时时
 *    「旗艦(工作艦)の状態、修理可能な艦がいるかは一切問わない」。两件事别混。
 *
 * ⑥ 20 分钟闸门 + 回复量公式。**两个独立开源实现给出同一个式子**：
 *    ElectronicObserver `kcmemo.md`（附实测日志）写作
 *        被ダメージ = 最大HP − 修理前HP
 *        回復HP = floor( floor(修理秒数 / 60) * 60 / (入渠秒数 / 被ダメージ) )
 *        ただし 1 <= 回復HP <= 被ダメージ
 *    且「20分経過していない場合はなにもしない」；
 *    KancolleSniffer `AkashiTimer.cs` 用逐点阈值累加写法，整分钟粒度上与之等价。
 *    拆成三件事：
 *      · **满 20 分钟前一点都不回**；
 *      · 经过时间先**截到整分钟**，秒的零头不参与计算（`floor(秒/60)*60`）。
 *        这一条**只有 kcmemo 一源**（KancolleSniffer 那边是把阈值向上取整到整分钟，
 *        方向不同、整分钟粒度上等价）；照做的代价是只会少算不会多算，
 *        与本文件「宁可少报」的口径同向，且正好让这个数只在分钟边界上变，
 *        与本面板的分钟级重渲对齐；
 *      · 每点 HP 耗时 = 入渠时间 ÷ 缺失 HP，向下取整，再夹进 [1, 缺失HP]。
 *    「入渠时间」kcmemo 明确就是游戏入渠画面上那个值 = 本仓的 `PlayerShip.ndockTime`
 *    （api_ndock_time，当前伤势修满所需毫秒），所以这里不自己推入渠时间公式。
 *    下限那个 1 才是「大型舰每 20 分钟回一次港比正常入渠快」的由来：
 *    每点 HP 要 40 分的舰，20 分时 floor 得 0，被夹到 1。
 *
 * ⑦ 落账时点：回母港刷新时，且**落账那一下计时重新起算**。
 *    fujieda「明石タイマーの仕様」的「リスタート」节与 note.com 两源一致。
 *    所以本文件只管「从锚点到现在能攒多少」，锚点谁来挪是调用方的事。
 *
 * ⑧ 计时重置/停止（fujieda 的「開始 / リスタート / 停止」三节 + kcmemo 的「編成」定义）：
 *      · **編成変更**（加 / 减 / 换 / 拖拽，且旗舰是工作舰）→ 重置。四源一致。
 *      · **プリセット展開**（编成记录展开）→ **不**重置。四源一致，
 *        「预设明石修理」这套玩法就是靠它。
 *      · **装備変更** → 不重置（除非把修理施設拆到没有可修之舰，那属于「停止」）。四源。
 *      · **出撃** → 不重置，计时继续。两源（wikiwiki 明文 + fujieda 三节里根本没有出撃）。
 *      · **遠征に出す** → 停止。三源（fujieda / wikiwiki / kcmemo）。
 *      · **旗舰自己入渠** → 停止。两源。
 *
 * ════ 查证不到、因此**没有**做的 ════
 *
 * · **遠征から帰投**单独怎么判：0 源。远征回来落在「回港」那条路上，不另设一条。
 * · **建造**：0 源。
 * · 朝日改与明石同队时修理时间变 5/6：**唯一在世的源** wikiwiki 朝日改页，且自标「模様」（推测）；
 *   EO 备忘与 KancolleSniffer 都在 2020 年停更、朝日改 2023 年后才实装——那两家的沉默是
 *   「够不着」，不算反对票，但也补不成第二票。**没做**（不做＝估算只会偏低，方向安全），
 *   挂实测：朝日改+明石同队掐一次表即可裁；wikiwiki 该页脚注 [*7] 指向官方推文，待人工核。
 *
 * ════ 后来补上第二票的 ════
 *
 * · **只做补给（不动编成）不重置计时**（2026-08-26 升双源）：KancolleSniffer
 *   `AkashiTimer.cs` 的重置只有 初始化 / 超20分滚动 / DeckChanged 或落账置 Reset 三路，
 *   **补给根本不经过计时器**——该实现活跃期（2018–2020）补给早已存在，代码的沉默是
 *   同期证据；加上当期个人博客共两票。kcmemo 对「編成」的枚举同期不含补给，旁证。
 *   本实现的行为与此一致（重置清单本来就没收补给），此条只是把标注从「未知」落成「不重置」。
 */

/** 满多久才开始回血。满这一刻至少回 1 点（查证 ⑥）。 */
export const BERTH_WARMUP_MS = 20 * 60 * 1000

/** 艦艇修理施設的装备 master id。取自本仓已有的真主数据样本（test/fixtures/quest-scrap-master.mjs）。 */
export const REPAIR_FACILITY_MST_ID = 31

/** 工作艦（api_stype）。明石 / 明石改 / 朝日改 就是它的全部，见查证 ①。 */
export const REPAIR_SHIP_STYPE = 19

/** 不带施設时能覆盖到的艘数（旗舰 + 2 号舰）。 */
export const BERTH_BASE_COVERAGE = 2

/** 一支舰队最多 6 艘，覆盖再多也没人可修。 */
export const BERTH_MAX_COVERAGE = 6

/**
 * 覆盖到第几艘（含旗舰自己，1 起数）。
 *
 * 装 0 个 → 2 艘，每多一个多一艘，封顶 6 艘（查证 ②）。
 */
export const berthCoverage = (facilities: number): number =>
  Math.min(BERTH_MAX_COVERAGE, BERTH_BASE_COVERAGE + Math.max(0, Math.floor(facilities)))

/** 一艘**范围内**的舰在泊地修理里的处境。范围外的舰由调用方按位次先分开。 */
export type BerthShipState =
  /** 在修：有伤、伤得不重、也没在渠里 */
  | 'repairing'
  /** 满血，没什么可修 */
  | 'full'
  /** 中破以上，泊地修理够不着 */
  | 'hurt'
  /** 已经在入渠，泊地修理不管她 */
  | 'docked'

/**
 * 判一艘**范围内**的舰能不能被泊地修理。
 *
 * 顺序是有讲究的：入渠中最先判（她正在别处修，说「满血 / 中破」都答非所问），
 * 其次满血，再看伤势。门槛按 HP 比例 > 0.5，与编队表的损伤档同一把尺（查证 ③④）。
 */
export const berthShipState = (
  ship: { nowhp: number; maxhp: number },
  docked: boolean,
): BerthShipState => {
  if (docked) return 'docked'
  if (ship.nowhp >= ship.maxhp) return 'full'
  const ratio = ship.maxhp > 0 ? ship.nowhp / ship.maxhp : 1
  return ratio > 0.5 ? 'repairing' : 'hurt'
}

/**
 * 整队停摆的原因；`null` = 没停，照常修。
 *
 * 这几条都**只挡「修不修」，不挡「计时走不走」**（查证 ⑤⑧）：
 * 旗舰中破爬起来之后不必重新等 20 分钟。
 */
export type BerthHalt =
  /** 舰队在远征——计时按查证 ⑧ 是停的 */
  | 'mission'
  /** 旗舰自己在渠 */
  | 'flagDocked'
  /** 旗舰中破以上 */
  | 'flagHurt'

/**
 * 整队还修不修得动。
 *
 * 远征排在最前：人都不在泊地，旗舰什么状态都不用问了。
 */
export const berthHalt = (
  flagship: { nowhp: number; maxhp: number },
  { onMission, flagDocked }: { onMission: boolean; flagDocked: boolean },
): BerthHalt | null => {
  if (onMission) return 'mission'
  if (flagDocked) return 'flagDocked'
  const ratio = flagship.maxhp > 0 ? flagship.nowhp / flagship.maxhp : 1
  return ratio <= 0.5 ? 'flagHurt' : null
}

/**
 * 从锚点起算到现在，这艘舰**估计**攒了多少点 HP。
 *
 * 照查证 ⑥ 的式子逐步做，一步都没省：
 *   1. 不满 20 分钟 → 0，一点都没有；
 *   2. 经过时间截到整分钟（秒的零头不算）；
 *   3. 每点 HP 耗时 = ndockTime ÷ 缺失 HP，除完向下取整；
 *   4. 夹进 [1, 缺失HP]——下限那个 1 是大型舰那条最低保证，上限是「不会修过头」。
 *
 * 拿不到 ndockTime（0 或负）就返回 0：不知道速率就不猜。
 */
export const berthEstimateHp = (
  ship: { nowhp: number; maxhp: number; ndockTime: number },
  elapsedMs: number,
): number => {
  const missing = ship.maxhp - ship.nowhp
  if (missing <= 0 || ship.ndockTime <= 0) return 0
  if (elapsedMs < BERTH_WARMUP_MS) return 0
  // 截到整分钟：与 kcmemo 的 floor(秒/60)*60 同义
  const wholeMinutesMs = Math.floor(elapsedMs / 60_000) * 60_000
  const perHpMs = ship.ndockTime / missing
  if (!Number.isFinite(perHpMs) || perHpMs <= 0) return 0
  return Math.min(missing, Math.max(1, Math.floor(wholeMinutesMs / perHpMs)))
}

/**
 * 预热进度（0..1）：不满 20 分钟时画那根进度条用。满了就是 1。
 */
export const berthWarmupRatio = (elapsedMs: number): number =>
  Math.max(0, Math.min(1, elapsedMs / BERTH_WARMUP_MS))

/**
 * 回港落账探测：比回港前后的耐久，认出哪几支队刚刚结过账。
 *
 * 游戏对母港泊地修理零报文，**「涨了血」就是唯一能观测到的落账证据**（查证 ⑦）。
 * 判据一律用**回港前**的那套编成与入渠状态：正在计时的是它，不是刚下发的新一份。
 *
 * 在渠的舰不算——她涨血是入渠的功劳，不是泊地修理的。
 * 漏判与误判的方向都是安全的：多认一次只会把估算说小，不会说大。
 */
export const berthBankedDecks = (
  decksBefore: readonly { id: number; ships: readonly number[] }[],
  hpBefore: ReadonlyMap<number, number>,
  dockedBefore: ReadonlySet<number>,
  hpAfter: ReadonlyMap<number, number>,
): number[] =>
  decksBefore
    .filter((deck) =>
      deck.ships.some((id) => {
        if (id <= 0 || dockedBefore.has(id)) return false
        const was = hpBefore.get(id)
        const now = hpAfter.get(id)
        return was !== undefined && now !== undefined && now > was
      }),
    )
    .map((deck) => deck.id)

/**
 * 会把计时拨回 0 的事件，以及**为什么只有这两条**。
 *
 * 照查证 ⑧ 收，一条不多：
 *   · `hensei`  —— 工作舰当旗舰时改随伴编成（加/减/换/拖拽）。四源一致。
 *                  **预设展开不算**（プリセット展開不重置，四源一致），
 *                  所以 `api_req_hensei/preset_select` 不挂这条。
 *   · `banked`  —— 回港时回血已经落账，落账那一下重新起算（两源一致）。
 *                  它同时就是「估算归零重算」这件事本身。
 *
 * 出撃不在表里是**有据的不重置**（两源），不是漏了。
 * 遠征不在表里是因为它属于「停止」而非「重置」，走 `BerthHalt.mission` 那条路。
 * 只做补给**不重置**（双源，见头注「后来补上第二票的」），所以不在表里。
 */
export const BERTH_RESET_REASONS = ['hensei', 'banked'] as const
export type BerthResetReason = (typeof BERTH_RESET_REASONS)[number]
