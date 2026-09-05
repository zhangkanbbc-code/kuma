// 铭的状态形状——主进程与渲染层共用的类型（仅类型，无运行时代码）。

import type { LocalDropCell } from './local-drop-cells'

export interface MasterShip {
  name: string
  yomi: string
  stype: number
  ctype: number // 舰级（api_ctype）：秋月型、Fletcher 级这类「按级生效」的机制要用
  // api_sort_id：EO 按它的编号段判国籍（活动倍卡有整段按国籍给的）。
  // 游戏不直接下发国籍字段，判据只有这一个。
  sortId: number
  slotNum: number // api_slot_num：常规装备格数，不含补强增设
  // 是否为改造后形态。游戏没给这个标志，api_getmes 只在改造形态上是空的 `<br>`，
  // 这是上游（poi/KC3Kai）一直在用的判据；秋月型改／Fletcher 级改的机制条件靠它区分。
  kai: boolean
  soku: number // 5 低速 / 10 高速
  fuelMax: number
  bullMax: number
  maxEq: number[] // 各常规槽的标准最大搭载；敌舰战斗装备详情也按此口径冻结
  afterShipId: number // 下一改装形态的 master id；0 = 最终改
  afterLv: number // 改装所需等级
  // 改装消耗的弹药/钢材。字段名是 kcsapi 的著名陷阱：api_afterbull 才是弹药、
  // api_afterfuel 才是钢材——用两张游戏改装画面实拍交叉核定（2026-08-11：
  // 赤城改二戊 弹2000/钢2800 ⇔ afterbull 2000/afterfuel 2800；榛名改二乙
  // 弹1300/钢1700 ⇔ afterbull 1300/afterfuel 1700），wikiwiki 改造总表同向。
  afterAmmo: number // ← api_afterbull
  afterSteel: number // ← api_afterfuel
  buildTime: number // 建造时间（分钟）
  powup: [number, number, number, number] // 作为近代化改修素材时提供 [火,雷,空,甲]
  // 裸值（api_mst_ship 的 [初始, 最大] 取初始）。装备加成面板反推要用：
  // 加成 = 面板 − 裸值 − 近代化改修 − Σ装备原始值。
  // 只收这四项——它们不随等级变；回避/对潜/索敌的基础值随等级插值，反推会失真。
  baseHoug: number // 火力
  baseRaig: number // 雷装
  baseTyku: number // 对空
  baseSouk: number // 装甲
  baseTaik: number // 耐久（敌舰预测兜底）
  baseKaihi: number // 回避初始值（敌舰预测兜底；深海优先使用 abyssal-stats）
  baseTais: number // 对潜初始值
  baseLuck: number // 运初始值
  // api_mst_ship 成长数组的上限。演习对手详情不会公开最终面板，
  // 只能以同形态的原生初始～上限做诚实区间，不能拿深海数值或玩家实例代替。
  maxHoug: number
  maxRaig: number
  maxTyku: number
  maxSouk: number
  maxTaik: number
  maxKaihi: number
  maxTais: number
  maxLuck: number
}

export interface MasterSlotitem {
  name: string
  iconId: number // api_type[3]
  // 以下为制空 / 索敌33 计算所需（api_start2 原生字段，见 fleet-calc.ts）
  // api_type[0] 大分類：游戏一手的「舰上/水上/陆上」口径（21/22/25/26=陆上机系）。
  // 分组 chip 的逐件陆航例外要用——Ho229 与橘花改同类别但大分類不同。
  type0: number
  type2: number // api_type[2]：装备大分类，制空与索敌系数的判定主键
  /**
   * api_distance 航続距離。**只有航空装备才有这一格**，非航空装备整个字段不存在（→ 0）。
   *
   * 它是「这件是不是舰载机」的一手判据：熟练度列原先靠一份静态类别白名单，
   * 新的航空系类别 id 不在名单里就把「有熟练度」显示成 `—`（静默错值）。
   * 2026-08-23 拿全量装备表对拍过：带 api_distance 的类别恰是
   * {6,7,8,9,10,11,25,26,41,45,47,48,49,53,56,57}，与 api_cost 的覆盖逐件相同，
   * 且逐件与旧白名单零分歧（详见 renderer/equip-category.ts）。
   */
  distance: number
  tyku: number // 对空
  saku: number // 索敌
  baku: number // 爆装（制空改修系数：有爆装 0.25 / 无 0.2）
  tais: number // 对潜（出击前机制预测）
  houk: number // 回避（基地航空防空补正用）
  houm: number // 命中（同上）
  // 装备原始加成值，用于面板反推（见 MasterShip 的 base* 注释）
  houg: number // 火力
  raig: number // 雷装
  souk: number // 装甲
}

export interface MasterMission {
  name: string
  time: number // 分钟
  dispNo: string // 显示编号（A1/B2/…，kcwiki 远征包按此对齐）
  resetType: number // api_reset_type：0 常规 / 1 月次
  useFuel: number // 消耗率（0.3 = 30%）
  useBull: number
  deckNum: number // 需求舰数（主数据口径）
  mapArea: number
  difficulty: number // api_difficulty：游戏原生难度，不用社区表反推
  winItem1: [number, number] // 官方奖励物品 [useitem id, 数量]；概率仍由资料包补充
  winItem2: [number, number]
  sampleFleet: number[] // 官方示例舰种；不是成功条件，也不替代自动规划
  details: string // api_details 官方说明原文——支援远征(S1/S2)的「要:駆逐2隻」只有这里有
}

export interface MasterShipUpgrade {
  targetShipId: number // api_id：改装后的目标形态
  currentShipId: number // api_current_ship_id：直接前置形态
  originalShipId: number // api_original_ship_id：该链原型
  stage: number // api_upgrade_level：链阶段，不是玩家等级
  drawingCount: number
  catapultCount: number
  reportCount: number
  aviationMatCount: number
  armsMatCount: number
  techCount: number
  boilerCount: number // api_boiler_count：装备 87 新型高温高压锅炉
}

export interface MgMaster {
  ready: boolean
  ships: Record<number, MasterShip>
  stypes: Record<number, string>
  slotitems: Record<number, MasterSlotitem>
  missions: Record<number, MasterMission>
  // 同一目标可以有**多行**（可逆改装的每条来路各一行）：赤城改二←赤城改要
  // 图纸2+弹射1+详报1+航空资材2，赤城改二←戊全零——收成单行必然把素材挂错
  // 前置（实弹撞过：弹射器被记到戊→改二的回转上）。按 currentShipId 区分。
  upgrades: Record<number, MasterShipUpgrade[]>
  bgms: Record<number, string> // 游戏 api_mst_bgm：官方曲名；旧曲缺项时保持缺失
}

export interface PlayerShip {
  id: number
  shipId: number // master id
  lv: number
  expTotal: number // api_exp[0]：累计经验；人生履历按同步前后差分记获取量
  expNext: number
  nowhp: number
  maxhp: number
  soku: number // 当前速度（含装备提速）：5 低速 / 10 高速 / 15 高速+ / 20 最速
  cond: number
  fuel: number
  bull: number
  ndockTime: number
  ndockItem: [number, number] // 入渠花费 [燃, 钢]
  locked: boolean
  slot: number[] // 装备实例 id，-1 空
  slotEx: number // 补强增设：0 未开 / -1 空 / 实例 id
  onslot: number[]
  /**
   * 各常规槽的**当前**搭载上限，来自实例侧的 `api_onslot_max`。
   *
   * 这是个**稀疏字段**：只有被格納庫増設（useitem 105）扩过的舰才带它。实测一份
   * 母港快照里 433 艘在籍舰只有 1 艘有这一项，其余舰上这个键**根本不存在**
   * （不是 null、不是空数组）。所以它是可选的——缺项时上限读主数据 maxEq，
   * 不要写成 `[]`，那等于谎称「每格都装不了飞机」。
   */
  onslotMax?: number[]
  // 现属性（含装备加成的当前值）
  karyoku: number // 火力
  raisou: number // 雷装
  taiku: number // 对空
  soukou: number // 装甲
  kaihi: number // 回避
  taisen: number // 对潜
  sakuteki: number // 索敌
  // 这三项的 [1]＝该形态的 Lv99 上限——游戏对持有形态其实下发了它（一手），
  // 婚后 [0] 会超过 [1] 而 [1] 不动。主数据不含这三维，社区资料只是兜底。
  kaihiMax: number // api_kaihi[1]
  taisenMax: number // api_taisen[1]
  sakutekiMax: number // api_sakuteki[1]
  lucky: number // 运
  kyouka: number[] // 近代化改修 [火,雷,空,甲,运,(耐,潜)]
  sallyArea: number // 活动札（0 = 无）
}

export type PowerupStatKey =
  | 'firepower'
  | 'torpedo'
  | 'antiAir'
  | 'armor'
  | 'luck'
  | 'hp'
  | 'asw'

export interface PowerupStatDelta {
  key: PowerupStatKey
  before: number
  after: number
  /**
   * 该项**还能再靠近代化改修提升多少**。0 才是真满；null = 判不了（对潜的改修上限不在主数据里）。
   *
   * 不报「上限值」：api_karyoku[1] 是不含装备的裸上限，而 api_karyoku[0] 是含装备的面板值，
   * 拿后者比前者几乎项项都会被判成满——见 mg/powerup-result.ts 的实测记录。
   */
  room: number | null
  delta: number
}

// 近代化改修成功后的瞬时提示。它不是可回灌领域状态，也不进入通知历史；
// 主进程在操作前后做一次精确差分，渲染层只负责侧边结果卡。
export interface PowerupResultCue {
  ts: number
  rosterId: number
  mstId: number
  stats: PowerupStatDelta[]
}

/**
 * ケッコンカッコカリ（婚舰）的瞬时提示。与 PowerupResultCue 同族：不进领域状态、
 * 不可回灌，主进程在报文到达那一刻做一次，渲染层只负责当场的庆祝视觉。
 *
 * **一手信号是 path 到达本身**，不是响应体里的某个字段：本机账本里这条 path
 * 零样本（这台机器的婚舰都在艦素诞生前），响应形状未经本地实证，所以这里只带
 * 三样能从**请求侧**与**结婚前的状态快照**取到的东西。
 *
 * rosterId 为 null = 没认出是哪一艘（post/body 都没给出可用的 api_id）。
 * 那时渲染层仍然庆祝，只是不指名——降级成不点名的全局特效，绝不猜一艘。
 */
export interface MarriageCue {
  ts: number
  rosterId: number | null
  /** 结婚**前**那一刻的形态与等级（快照取自 store.handle 之前，通常是 Lv99） */
  mstId: number | null
  level: number | null
}

// 基地航空队（打开出击海域选择页时随 mapinfo 自然下发；api_port 不带，故为快照式）
export interface AirBaseSquad {
  areaId: number // 所属海域（活动图为该活动区号）
  rid: number // 中队编号 1-3
  ts?: number // 该海域最近一次自然同步时点；旧快照没有时留空
  name: string
  actionKind: number // 0 待機 / 1 出撃 / 2 防空 / 3 退避 / 4 休息
  distance: number // 合计作战半径（base + bonus）
  planes: {
    slotId: number // 装备实例 id（0 = 空格）
    count: number // 当前搭载
    maxCount: number
    state: number // 0 未配备 / 1 配备中 / 2 转换中
    cond: number // 0/1 正常 / 2 橙疲劳 / 3 红疲劳
  }[]
}

export interface Quest {
  no: number
  category: number // api_category：任务分类色
  type: number // 1日 2周 3月 4单发 5他
  state: number // 1未受领 2遂行中 3达成
  title: string
  detail?: string // 游戏任务说明（日文原文）
  getMaterial?: number[] // 基础奖励：燃料 / 弹药 / 钢材 / 铝土
  bonusFlag?: number
  progressFlag: number // 0 / 1(50%) / 2(80%)
}

export interface SlotitemInstance {
  mstId: number
  level: number
  alv: number
  locked: boolean // 锁定装备不能作为改修素材；目标装备本身可以锁定
}

export interface Deck {
  id: number
  name: string
  mission: number[] // [state, missionId, returnTimeMs, ?]
  ships: number[] // 在籍舰 id，-1 = 空
}

export interface Ndock {
  id: number
  shipId: number // 0 = 空
  completeTime: number
  // api_state：-1 未租借 / 0 空 / 1 修理中。旧快照没有这个字段（回灌时 undefined），
  // 消费方对 undefined 沿用旧口径（当可用），首个 port 报文就会把真值补上。
  state?: number
}

export interface Kdock {
  id: number
  state: number // -1 锁 0 空 2 建造中 3 完成
  createdShipId: number
  completeTime: number
  recipeFuel: number // api_item1；高速建造时用于区分通常建造(1)与大型建造(10)
}

// ---- 出击/战斗（镝的数据源）。伤害均为 API 实测值回放，非预测 ----

export interface BattleEquipmentView {
  mstId: number
  instanceId: number | null // 我方装备实例；敌方/演习对手没有实例 id
  slot: number | 'ex' // 常规槽 0 基；补强增设为 ex
  planeCount: number | null // 我方出击快照 / 敌方 master 标准搭载；非飞机槽为 null
  planeCapacity: number | null
  planeSource: 'sortie' | 'master' | null
  level: number // 改修 ★0..10；敌方固定 0
  alv: number // 熟练度 0..7；敌方固定 0
}

export interface BattleShipView {
  index: number // 本方位置 0-5（联合第二舰队 6-11）
  fleet: 'main' | 'escort' | 'friend'
  position: number // 所属舰队内 0-5；不受 API 前导占位影响
  mstId: number // master id（敌方为深海 id）
  rosterId: number | null // 我方实例 id（敌方 null）
  name: string
  lv: number
  hpStart: number
  hpEnd: number
  hpMax: number
  damageDealt: number // 输出合计（含夜战）
  sunk: boolean
  defeated: boolean // 战斗内失去战力；演习的击破停在 HP1，但必须与“真实剩 1 HP”区分
  escaped: boolean // 退避/当前战斗不在场
  /**
   * 打不到的舰位：对潜空袭战里退在后方的那条空母，游戏对它「攻撃対象にならない(HP非表示)」。
   * 报文对应位上是字符串 "N/A"，解析处（battle.ts pushEnemyFleet）就地置位。
   * hpStart 0 / hpMax 1 是那里兜出来的假数，UI 不许拿它当血条画——游戏里这条舰没有血条。
   * 旧快照没有此字段（那时整场还落在 'day' 上），保持 undefined。
   */
  unattackable?: true
  repairItemUsed: number | null // 42 要员 / 43 女神
  params?: [number, number, number, number] // 战斗开始时最终 [火力,雷装,对空,装甲]
  expGained?: number // 结算逐舰获得经验；旧快照/战斗中未结算时为空
  expTotalAfter?: number // 结算后累计经验
  expNextTotal?: number // 下一等级的累计经验门槛；满级/未下发时为空
  // 旧战斗快照没有此字段时保持 undefined，UI 必须显示“未保存”，不能拿当前母港编成回填旧战斗。
  equipment?: BattleEquipmentView[]
}

export type BattleSide = 0 | 1 | 2 // 0 我方 / 1 敌方 / 2 NPC 友军

// 一次攻击（炮击/雷击一舰一记录；航空/支援为阶段伤害，attacker = -1）
export interface BattleAttack {
  phase:
    | 'lbas' // 基地航空
    | 'injection' // 喷气强袭
    | 'air' // 第一航空战
    | 'air2' // 第二航空战
    | 'friendlyAir' // 友军航空
    | 'support' // 支援
    | 'openingAsw' // 开幕对潜
    | 'openingTorp' // 开幕雷击
    | 'gun1'
    | 'gun2'
    | 'gun3'
    | 'torp' // 闭幕雷击
    | 'night'
    | 'friendly' // NPC 友军夜战
    | 'radar' // 长距离雷达射击
  side: BattleSide
  attacker: number // 攻方位置；-1 = 无逐舰归属（航空/支援）
  ciType: number | null // 昼 at_type / 夜 sp_list，原始值（显示层翻译）
  ciKind: 'day' | 'night' | null
  stage: number // 真实阶段序；UI 必须按它显示，不再自行猜测顺序
  action: number // 同阶段行动序
  stageLabel: string
  source: string // 原始字段名，便于回放与回归测试
  simultaneous: boolean // 雷击等同时结算阶段
  equipmentMstIds?: number[] // api_si_list：本次攻击实际使用的装备 mstId（-1 已剔除）
  /**
   * api_hougeki.api_n_mother_list 的这一击为 1：**空母夜间攻击**（这一击是舰载机打的）。
   * 判 `== 1`，别照 EO 抄 `== -1`——那是 2017 年去掉 `.Skip(1)` 时忘了改的老 bug，
   * 与它自己仓里的 kcmemo「== 1 なら true」自相矛盾（详见取值处头注）。
   * 发动方是敌是我看同一条记录的 `side`，别在文案里替它定边。
   */
  carrierNightAttack?: true
  hits: {
    target: number // 受击方位置
    damage: number
    critical: boolean
    // 炮击/雷击可由 api_cl_list 确认命中；航空 stage3 没有等价字段，
    // 因此零伤只能保留 unknown，不能冒充 miss。可选用于兼容旧复盘快照。
    hitState?: 'miss' | 'hit' | 'unknown'
    miss: boolean
    protect: boolean // 护卫替身（API 伤害带 .1）
    sunk: boolean // 该击后目标 HP 落 0
    repairItem: number | null // 该击触发的应急修理装备
  }[]
}

/**
 * 航空 stage3 里「这一格挨了哪种特殊攻击」（api_f_sp_list / api_e_sp_list，
 * api_stage3 与 api_stage3_combined 各有一对）。
 *
 * **记的是承受方，不是发动方**：亮的那一格是被打的舰，与同格的 api_*bak_flag 同时立。
 * 种类号照抄客户端 `AirWarStage3Model.SP_ATTACK_TYPE`，目前只有一个成员：
 * 1 = BOUNCE_BOM，反跳爆撃（skip bombing，B-25 / 深海襲撃機一族的投弹方式）。
 * **它与対空噴進弾幕无关**——弹幕在报文里没有字段，证据链见 main/mg/battle.ts 取值处。
 *
 * 原始形态是**按舰位的数组**，每格 null 或形如 `[1]` 的种类数组——不是扁平 0/1，
 * 照扁平读一次都读不出来。这里只留亮着的格。
 *
 * 与 BattleAttack.ciType 注释里那个「夜战 sp_list」不是同一个字段，别混。
 */
export interface AirSpecialAttackView {
  pos: number // 0-11 视图舰位，与 stage3 承伤数组同一套映射
  kinds: number[] // 种类号；账本里只见过 1（反跳爆撃），数组形态预留多种
}

export interface AirCombatView {
  seiku: number | null // api_disp_seiku：0 均衡 1 确保 2 优势 3 劣势 4 丧失
  fCount: number
  fLost: number
  eCount: number
  eLost: number
  fLost2: number // stage2 我方追加损耗
  eLost2: number
  touchF: number // 我方触接机 mstId，-1 无
  touchE: number // 敌方触接机 mstId，-1 无
  aaCutinIdx: number | null // 对空 CI 发动舰位置
  aaCutinKind: number | null
  /**
   * api_air_fire.api_use_items：这次对空 CI **实际用掉的装备** mstId 表。
   * 种别号（aaCutinKind）只说是第几种，这一列才说是哪几件打出来的。
   * 空/缺席时整个不写这个键——旧快照本来就没有。
   */
  aaCutinItems?: number[]
  /**
   * stage2（对空炮火阶段）的参战机数，与同段 fLost2 / eLost2 是同一批飞机的分母。
   * **不是 stage1 的 fCount / eCount**：那是航空互击的接敌机数，
   * 活到对空炮火那一刻的通常更少（实测 stage1 e_count 108 → stage2 34）。
   * 0 或字段缺席时不写这个键，显示端缺分母就只报击坠数。
   */
  fCount2?: number
  eCount2?: number
  // 挨了特殊攻击的舰位。旧快照没有这两个字段，全链路把缺省当「没有」。
  spAttackF?: AirSpecialAttackView[]
  spAttackE?: AirSpecialAttackView[]
}

export interface BattleStageView {
  order: number
  phase: BattleAttack['phase']
  label: string
  source: string
  simultaneous: boolean
  air: AirCombatView | null
  squadronPlanes?: { mstId: number; count: number }[] // 基地航空本波实际出击机种
  /**
   * api_air_base_attack[].api_base_id：这一波是**第几基地**出的（账本实测恒 1–3）。
   * 报文没给（旧快照 / 非陆航段）就不写，显示端退回按全局波次编号。
   */
  airBaseId?: number
  /**
   * api_support_info.api_support_hourai 的 api_deck_id / api_ship_id：
   * 打支援炮击的是**第几舰队**、由**哪几条舰**组成。
   * 支援航空（api_support_airatack）没有这一对，缺省即没有。
   *
   * **报文里的 api_ship_id 是在籍 ID，这里存的是回查之后的 mstId**——解析层按
   * api_deck_id 那支队的编成把在籍 ID 换算过（判据见 mg/battle.ts 的 applySupport）。
   * 那支队当时不在账上就留空，只报队号，不上屏一个查错的名字。
   */
  support?: { deckId: number; shipMstIds: number[] }
}

// 胜败预测（wikiwiki 胜利条件口径；演习另以 defeated 代替真实沉没；
// 复盘定论始终以 battleresult 的 api_win_rank 为准）
export interface RankPrediction {
  rank: string // S/A/B/C/D/E；游戏不存在独立 SS 评级
  perfect: boolean // S 中的「完全胜利」：敌全灭且我方零承伤；判据是 fTaken，不是 fGauge
  sure: boolean // S/A/多数 B 可确定；C/D/E 为推定
  fGauge: number // 敌对我战果比例（我方受创 %）；已经 Math.floor 取整，S/A/B… 的损害率分档看它
  // 我方承伤合计（未取整的 HP 点数），perfect 的判定依据。
  // 与 fGauge 的区别只在取整：联合舰队血池大到个位数承伤也不足 1%，
  // 在 fGauge 里会被 floor 抹成 0%，唯有这里还看得见。
  fTaken: number
  eGauge: number // 我方对敌战果比例
  fSunk: number
  fCount: number
  eSunk: number
  eCount: number
}

export interface BattleDiscrepancy {
  kind: 'sunk' | 'mvp' | 'rank' | 'hp'
  ours: number | string
  game: number | string
  /** 'hp' 档专用：这一条说的是哪一艘。其余档是整场口径，不写这个键。 */
  who?: string
}

export interface BattleResultView {
  rank: string // api_win_rank 实际判定
  mvp: number // 主力舰队 MVP：0 基位置，-1 无
  mvpCombined: number // 护卫舰队 MVP：0 基位置，-1 无
  baseExp: number
  dropShipMstId: number | null
  dropShipName: string | null
  /**
   * api_get_ship.api_ship_getmes：掉落舰的**入手台词**，游戏在掉落弹窗里念的那句。
   * **日文原文照录**（台词属作品表达，走「台词原文列保原文」那一条），
   * 只把 `<br>` 换成换行；缺席时不写这个键。
   */
  dropShipMessage?: string
  firstClear: boolean
  /**
   * api_get_exmap_rate：本次 EO 海域击破**游戏亲发的战果值**。
   * 报文里是字符串（`"75"`），这里已严格转数；非 EO 击破的场次报 0，此时不写这个键。
   */
  exmapSenka?: number
  /**
   * api_next_map_ids：本次通关**解锁的新海域 id**（区×10+图号口径）。
   * 混型：常规海域是数字、活动海域是字符串，取值时一并转数，转不出的丢掉。
   */
  nextMapIds?: number[]
  /**
   * api_escape_flag / api_escape：战斗结束时游戏**提供**的护卫退避选项。
   * 与战斗包里那个同名的 `api_escape_idx` 不是一回事——那个是「已经退避掉的舰」，
   * 这个是「现在问你要不要让这几条退」。两组舰位都已由 1 基换成 0 基。
   *
   * `escape` = `api_escape_idx`（要退的舰）、`tow` = `api_tow_idx`（陪她一起走的护卫舰）。
   * 単艦退避没有护卫，`tow` 就是空的。舰位是**跨两队连号**的：0–5 主力、6–11 护卫队，
   * 与战斗包里 `api_escape_idx` / `api_escape_idx_combined` 那两段拼起来同一套坐标。
   *
   * ⚠️ 本机账本里唯一那次样本 `api_escape_idx` 有**两个**舰位、且**没有** `api_tow_idx`
   * （见 test/fixtures/battle-result-coverage.json 的 result-escape-offer）。
   * 两个字段各读各的、都不解释，就是为了这种对不上的时候不至于把话说死。
   *
   * `type` 语义未确认（账本仅 1 次、取值 1），只保留原值不解释。
   */
  escapeOffer?: { escape: number[]; tow: number[]; type: number }
  snapshotId?: number // 本地有界战斗快照；用于人生记录与节点复盘互链
}

export interface BattleFlavorVoice {
  mstId: number
  voiceId: string
  shipName: string
  /**
   * api_class_name：boss 的**舰型名**（「深海新鋭駆逐艦」这种）。
   * 主数据里没有这个信息，只有开场台词框给——想显示
   * 「深海新鋭駆逐艦 駆逐ラ級ζ-壊」这种完整称呼只能从这儿取。
   * 与同族其它字段一样是**字符串型**；缺席时不写这个键。
   */
  className?: string
  message: string
}

export interface BattleView {
  kind:
    | 'day' // 通常昼战；hasNight=true 时为昼战后追击夜战
    | 'airbattle' // 双方航空战节点（通常有两轮航空战）
    | 'airraid' // 敌空袭节点：评级只看我方损害率
    | 'baseDefense' // 进点报文内嵌的基地防空结算；随后会被节点战斗替换
    | 'radar' // 长距离雷达射击节点：评级只看我方损害率
    | 'nightonly' // 开幕夜战
    | 'nightday' // 拂晓战（开幕即夜战，天亮后转昼战）
    /**
     * 对潜空袭：敌潜艇 + 一条退在后方、不可攻击的空母系。走通常战端点、
     * api_event_kind 也是 1，判据在报文里（敌方 HP 有一位是 "N/A"），见
     * battle.ts 的 isSubAirRaid。评级仍按击沉算——那条空母 hpStart 为 0，
     * 本来就不进 predictRank 的敌舰表，与 poi 跳过 hpUnknown 舰同一个结果。
     * ⚠️ 2026-08-31 之前打的这类场次，快照里记的是 'day'（旧快照不重算）。
     */
    | 'subAirRaid'
  practice: boolean // 演习：HP 底线 1、无真轰沉（sunk 保持 false）
  hasNight: boolean // 已合并夜战包
  fFormation: number
  eFormation: number
  engagement: number // 1 同航 2 反航 3 T 有利 4 T 不利
  fShips: BattleShipView[]
  eShips: BattleShipView[]
  friendShips: BattleShipView[]
  /**
   * `api_friendly_info.api_production_type` 的原值。**语义未定，UI 一律不标**。
   *
   * 本机账本全量只有两条带 api_friendly_info 的报文（2026-08-26 穷举）：
   * · 21:09:09 `ec_midnight_battle` → 2，编成 伊勢改二 · 日向改二 · 梅改 · 桃改（4 舰）
   * · 21:25:07 `ec_midnight_battle` → 3，编成 伊勢改二 · 日向改二 · 酒匂改 · 梅改 · 桃改（5 舰）
   *
   * 用户亲证 21:09 那场是強友軍要請；21:25 同一晚同一图、友军参战有目击。
   * 两场值不同而后一场编成**更大**，所以「2 = 強力」讲不通——这个字段看着是在
   * 标**编成变体**（同一支伊勢型友军的不同抽取结果），不是強/通常的档位。
   * 一度打算按 `=== 2` 挂「强友军」标，被这第二条样本证伪：那样会把小的那次标成强、
   * 大的那次不标。**要标之前先拿到「确证是通常友军」的对照样本**（本机零样本），
   * 在此之前原值只留在数据层备查。缺省（没开友军要請、旧快照）为 null。
   */
  friendlyProductionType: number | null
  stages: BattleStageView[]
  attacks: BattleAttack[]
  air: AirCombatView | null
  air2: AirCombatView | null
  // 噴式強襲（api_injection_kouku）自带 stage1/stage2：制空状态、双方撃墜、触接。
  // 不单列的话，敌方喷气强袭只要没造成伤害就整段不可见（stage3 无 hits → 不入流水）。
  airInjection: AirCombatView | null
  // 夜战照明弹发动舰位置（api_flare_pos：[我方, 敌方]，-1 = 无）
  flarePos: [number, number] | null
  detection: [number, number] | null // api_search
  nightContact: [number, number] | null // api_touch_plane（转为 number）
  smokeType: number
  /**
   * api_air_base_rescue_type：基地航空队的「カタリナ救助活動」发生了，值 = 弹出几个救助气泡（1–3）。
   * **不发生时字段整个不存在**，所以缺省就是「没发生」，零痕迹。
   * 触发条件里 PBY-5A Catalina 是**必要不充分**：账本 32/32 场都带着它，
   * 但只带 1 格就触发过（别写成「要带 ≥3 架」，那个说法已被账本证伪），
   * 而带了 Catalina 却没触发的对照场次有 8 次——还有别的门槛。
   */
  airBaseRescue?: number
  /**
   * api_balloon_cell：这一格有阻塞气球（防空气球）。
   * **推断级**：判据只有字段名 + 账本实证（887 行 12 次为 1，全部集中在同一次活动出击、
   * 昼夜包成对出现），没找到文档佐证。缺省即没有。
   */
  balloonCell?: boolean
  activeDeck: [number, number] | null // 夜战实际参战舰队：1 主力 / 2 护卫
  hasSupport: boolean
  baseDefenseLostKind?: number // api_destruction_battle.api_lost_kind；语义未确认，只保留原值
  enemyDeckName?: string // battleresult api_enemy_info.api_deck_name
  enemyFlagshipSunk?: boolean // battleresult api_destsf；只作敌旗舰权威判据
  flavorVoices: BattleFlavorVoice[] // API 自带的深海开幕语音键与原文；精确匹配，不靠资料源猜
  prediction: RankPrediction
  result: BattleResultView | null
  discrepancies?: BattleDiscrepancy[] // 结算后与游戏自报 sunk/MVP/rank 的静默自检
  ts: number
}

export interface SortieNode {
  cell: number // api_no（字母名需海图点位包，暂以编号显示）
  eventId: number // 2 资源 3 涡潮 4 战斗 5 Boss 6 无事 7 航空战 8 护卫成功 9 扬陆 10 空袭
  eventKind: number
  rank: string | null // 战斗节点：battleresult 实际评级
  note: string | null // 非战斗点实况：获得/涡潮损失（api_itemget / api_happening）
  enemyPreview?: { kind: number; shipIds: number[] }[] // 开战前游戏揭示的最多三艘敌舰
  flavor?: { type: number; message: string } // 进点台词；保留游戏原文
}

export interface SortieMapCell {
  id: number
  no: number
  color: number
  passed: boolean
  distance: number | null
}

export interface PracticeOpponentPreview {
  id: number
  name: string
  level: number // 对手提督等级，不是旗舰等级
  rank: string
  deckName: string
  ships: {
    mstId: number
    level: number
    star: number // 游戏原始 api_star；语义未确认，不据此推算面板
  }[]
  ts: number
}

/**
 * 本次出击里已确认沉没的我方舰。
 *
 * 之所以要单独一份而不是现查 `sortie.battle`：`battle` 只留**当前节点**，
 * 进击到下一格就被换掉，而「这次出击沉了人」这件事要一直挂到返港。
 * 与 `drops` 同一种累积口径——出击级事实攒在出击上，节点级事实留在节点。
 * 有了它，界面的哀悼态（失色 / 碎裂卡）就是**从状态推导**出来的：
 * 重开界面重新读一次 state 仍得到同一个答案，不靠一次性事件标记。
 */
export interface SortieSunkShip {
  rosterId: number
  mstId: number
  name: string
  lv: number
  cell: number // 沉在哪一格；-1 = 报文没给
  battleNo: number // 本次出击第几战
  ts: number
}

/**
 * 本次出击里做过的一次緊急泊地修理（明石改 / 朝日改 / 秋津洲改 在泊地格上开工）。
 *
 * 与 `sunkShips` 同一种累积口径：出击级事实攒在出击上，返港时随 `active` 落下自然失效。
 * 修理量是**算出来的**——报文只给修完之后的整支舰队（`api_ship_data`），
 * 所以 `before` 取覆盖前账上那一刻的耐久，`after` 取报文里的新值，两者之差就是这一次回了多少。
 * 现状里查不到那艘舰（中途启动艦素、账上还没有她）时整条不落：宁可少记，不猜一个数。
 */
export interface SortieAnchorageRepair {
  cell: number // 在哪一格修的
  ts: number
  repairerMst: number // 修理舰的**主数据 id**（报文给的就是 mst id，不是在籍 id）
  ships: { rosterId: number; mstId: number; name: string; before: number; after: number }[]
  steel: number // 这一次扣掉的钢材（= 回复耐久合计 ×3）；算不出回复量时为 0
}

/**
 * 本次出击里退避掉的我方舰（旗舰装了艦隊司令部施設，玩家在战果后点了「退避」）。
 *
 * 与 `sunkShips` / `anchorageRepairs` 同一种累积口径：出击级事实攒在出击上，
 * 返港时随 `active` 落下自然失效。落账的时机是 **goback_port 报文到达那一刻**——
 * 游戏问过「要不要退」（battleresult 的 escapeOffer）不算数，玩家真点了才算。
 *
 * 她之后的节点都不参战：制空 / 索敌 / 输送量 / 大破名单一律把她排除在外，
 * 判据统一走 shared/sortie-escape。
 */
export interface SortieEscapedShip {
  rosterId: number
  mstId: number
  name: string
  role: 'escaped' | 'tow' // 退避的那一艘 / 陪她走的护卫舰
  cell: number // 在哪一格退的；-1 = 报文没给
  ts: number
}

export interface SortieView {
  active: boolean
  practice: boolean // 演习（无航迹/罗盘）
  mapArea: number
  mapNo: number
  deckId: number
  bossCell: number
  nodes: SortieNode[]
  currentCell: number
  cellData: SortieMapCell[] // 本次出击下发的整张图点位状态
  selectRoute: number[] // 当前可手动选择的下一点 api_no
  practiceOpponent?: PracticeOpponentPreview | null // 选择演习对手后、开战前的编成详情
  battle: BattleView | null // 当前节点战斗（昼夜合并推演）
  battleCount: number
  drops: { cell: number; mstId: number; name: string }[] // 本轮捞到的舰（保持到下次出击）
  // 本轮沉掉的舰（跨节点累积，返港时随 active 落下自然失效）。演习不入此表。
  sunkShips: SortieSunkShip[]
  // 本轮做过的緊急泊地修理（同上，出击级累积）。演习不入此表。
  anchorageRepairs: SortieAnchorageRepair[]
  // 本轮退避掉的舰（同上，出击级累积）。演习没有退避这回事。
  escaped: SortieEscapedShip[]
  // 本次出击给各基地航空队指定的攻击点位。出击时 start_air_base 会明确下发
  // 「第 N 队打哪个点」，每队两波（例：{2:[40,40], 3:[40,40]} = 第2、3队各两波打 40 点）。
  // 有了它，预测才知道该把陆航的输出算进哪一个点——否则要么全图不算（低估
  // 有陆航的点），要么处处都算（高估道中点）。常规海域没有陆航，留空。
  airBaseStrikes: Record<number, number[]>
  /**
   * api_bosscomp：游戏自报「这张图的 Boss 本期是否已击破」。null = 报文没给。
   *
   * **假说，不是定论。** 各家源都查不到这个字段的说明；判据是账本方向自洽：
   * 常规图恒 1、没打的 EO 图恒 0，而 1-5 / 3-5 各翻过一次 0→1，
   * 两次都紧跟在该图 EO 击破之后（3-5 於 08-09 17:41 拿到 150 后翻，1-5 同理）。
   * 只有 2 张图 4 次翻转的样本，**月初重置那一刻是它的验收点**——
   * 若重置后没跟着翻回 0，这条判读作废，连同显示一起撤掉。
   * 也因此展示端只在它说「还没击破」时出声（那句永远不会冤枉常规图），
   * 说「已击破」时一律沉默，不去跟自己的 EO 记账抢话。
   */
  bossCleared: boolean | null
  /**
   * 权威 HP 对账把「解析说没大破」纠正成「权威说大破」的次数（出击级，回港随 sortie 失效）。
   *
   * 铃拿它当补发大破通知的信号：数字一跳就绕过去重再喊一次，措辞前缀「修正：」。
   * 对账本体与时序实测见 shared/sortie-hp-audit。
   * 可选：本功能之前存下的战斗快照没有这个键，读的地方一律 `?? 0`。
   */
  taihaCorrections?: number
  startTs: number
  updatedTs: number
}

export interface BattleSnapshotSummary {
  id: number
  ts: number
  sortieId: number
  battleNo: number
  map: number
  cell: number
  rank: string | null
  isBoss: boolean
  practice: boolean
}

export interface BattleSnapshot extends BattleSnapshotSummary {
  sortie: SortieView
  discrepancies: BattleDiscrepancy[]
}

export interface BattleReconciliationRecord {
  ts: number
  map: number // 通常海域 area*10+no；演习为 0
  cell: number
  practice: boolean
  discrepancies: BattleDiscrepancy[]
}

export interface BattleReconciliationSession {
  checked: number
  mismatched: number
  records: BattleReconciliationRecord[] // 只保留不一致场次，当前会话内有界
}

// 海域攻略进度（mapinfo 为权威基线；出击/战斗结算在同一会话内实时回写）
export interface MapGauge {
  cleared: boolean
  defeated: number | null
  required: number | null
  hpNow: number | null // 活动血条
  hpMax: number | null
  selectedRank: number | null // 活动难度 0 未选 / 1 丁 / 2 丙 / 3 乙 / 4 甲
  // 出撃制限（札）在这张图上作不作数。api_eventmap.api_limit_flag 原样保留。
  // null = 还没读到 mapinfo（未知，不等于 0）。判据见 ru.ts 的 sallyFlagHtml。
  limitFlag: number | null
  gaugeType: number | null // 游戏原生类型：1 击破计数 / 2 HP / 3 运输 TP
  gaugeNum: number | null // 第几条血条
}

export interface PlayerRecord {
  ts: number
  sortieWin: number
  sortieLose: number
  sortieRate: number | null
  practiceWin: number
  practiceLose: number
  practiceRate: number | null
  missionCount: number
  missionSuccess: number
  missionRate: number | null
  materialMax: number | null
  shipCount: number | null
  shipCapacity: number | null
  slotitemCount: number | null
  slotitemCapacity: number | null
  airBaseMaintenance: { areaId: number; level: number }[]
}

export interface MgPlayer {
  basic: {
    nickname: string
    level: number
    rank: number
    maxShips: number
    maxSlotitems: number
    furnitureCoins?: number // api_fcoin；旧快照没有时保持 undefined
    // 当前布置中的 6 件家具（port api_basic.api_furniture，家具 mst id）
    furnitureLayout?: number[]
    // 任务同时进行数上限（port 顶层 api_parallel_quest_count；不在 api_basic 里）
    parallelQuestCount?: number
    // 甲章数。port 实测只有 >0 才可信（0 可能是「不下发」），0 时保持 undefined
    medals?: number
    // 提督经验。战果要靠它换算（通常戦果 = 该月经验 × 7/10000），
    // 旧快照没有时保持 undefined —— 缺了就是缺了，不补 0
    experience?: number
  } | null
  materials: number[] | null // [燃,弹,钢,铝,高速建造,高速修复,开发,改修]
  ships: Record<number, PlayerShip>
  decks: Deck[]
  ndocks: Ndock[]
  kdocks: Kdock[]
  slotitems: Record<number, SlotitemInstance>
  quests: Record<number, Quest>
  questsTs: number | null // 最近一次打开游戏任务页、同步 questlist 的时刻
  // 最近一次拿到**全量**任务表（tab 0「全部」）的时刻。
  // 有它才敢说「不在表里 = 已交付或未解锁」——分类页只给那一类，
  // 拿分类页当全集会把没翻到的任务全判成「不能接」。
  questsFullTs: number | null
  questActiveIds: number[] | null // tab 0/9 确认的当前受领集合；旧快照没有时为 null
  questActiveTs: number | null // 当前受领集合最近一次被 tab 0/9 或受领/取消动作确认的时刻
  questExecCount: number | null // 游戏 api_exec_count，自报的同时遂行数
  missionStates: Record<number, number> // 远征 id → 游戏自报 api_state；已观测但缺号 = 尚未解锁
  missionStatesTs: number | null // 最近一次打开游戏远征页、同步 mission 的时刻
  missionLimitTs: number | null // 本期月次远征重置时刻；游戏没给时为 null
  useitems: Record<number, number> // useitem id → 所持数
  useitemsTs: number | null // 最近一次完整同步 api_useitem 的时刻；缺席条目只有在此后才能判定为 0
  // 持有家具（api_get_member/require_info 与 /furniture 的 api_furniture_id，升序去重）。
  // null = 这份账本还没同步过家具（旧版快照）——消费方当「未知」处理，绝不能当「没有」
  // 去标灰（2026-08-17 用户点名的坑：识别不到就会出现「有但是是灰色」）。
  furnitures: number[] | null
  // 母港滚动消息（port api_log，游戏自报的「最近发生」，6 条日文原文）
  portLogs: { type: number; message: string }[]
  // 演习对手（打开演习页时自然产生；state 0 = 未挑战）
  practice: {
    list: {
      id: number
      name: string
      state: number
      level?: number // api_enemy_level：对手提督等级，不是旗舰等级
      rank?: string // api_enemy_rank：军衔原文
      flagShipId?: number // api_enemy_flag_ship：mstShip id
    }[]
    ts: number
  } | null
  record: PlayerRecord | null // 打开战绩页时自然同步的游戏官方生涯累计值
  // 课金道具持有清单（api_get_member/payitem，开商店/付款后自然同步）。
  // 它既是「已购未用」展示，也是氪金记录 diff 的基线；null = 从没同步过。
  payitems: { items: import('./pay-log').PayitemStocks; ts: number } | null
  // 联合舰队编成：0 未编成 / 1 空母機動 / 2 水上打撃 / 3 輸送護衛
  combinedFlag: number
  /**
   * 友军舰队要請（活动海域限定的机制，报文 `/kcsapi/api_req_member/set_friendly_request`）。
   *
   * · `flag` = 1 要請开
   * · `type` = 0 通常 / 1 強力
   *
   * 出处：本机账本 events 里 2026-08-26 的两条实测（18:39 `flag=1 type=1`、
   * 18:47 `flag=1 type=0`），是用户当场两次切换留下的双样本，`type` 的两个取值靠它钉死。
   * `flag` 两条都是 1（那两次切的是种类），0 值本机未观测到，按端点语义记作「关」。
   *
   * **字段缺失 = 未知，不等于「关」**：游戏只在玩家动这个开关时才下发这条报文，
   * 冷启动、或这台机器从没切过，就一条也不会有。消费端必须按未知处理——
   * 少说不错说，不许把未知当成「没开」去下结论。
   */
  friendlyRequest?: { flag: number; type: number }
  // 基地航空队 + 快照时点（打开出击海域选择页才有，重启回灌）
  airBases: AirBaseSquad[]
  airBasesTs: number | null
  lastPortTs: number | null
  /**
   * 母港泊地修理的计时锚点：deckId → 该队计时**最近一次归零**的时刻。
   *
   * 游戏对母港泊地修理零报文，这个数没有任何一手来源，只能由本机观测拼出来
   * （判据与出处见 shared/berth-repair.ts 的 `BERTH_RESET_REASONS`）。
   * 必须跨重启保留：舰队在港里停了三小时，重启一次就报「刚停下」是纯粹的错值，
   * 所以它进 `domainSnapshot`。缺号 = 没观测到过这支队的归零点，那就什么都不报。
   */
  berthSince: Record<number, number>
}

// 活动期观测：活动海域只在活动期间存在于主数据里，它进出 api_start2 的时刻
// 就是我们能被动观测到的「活动窗口」。firstSeenTs 是**你首次看到这张图**的时刻
// （不是官方开幕时刻）——用于「本活动已消耗」这类自身口径的统计，正合适：
// 晚几天入场，那几天本来也没打。
export interface EventArea {
  firstSeenTs: number
  lastSeenTs: number // 进行中=最近一次确认存在；已关闭=首次确认消失（归档上界）
  closed: boolean // 曾出现、现已从主数据消失 = 活动已结束
}

export interface MgState {
  master: MgMaster
  player: MgPlayer
  sortie: SortieView | null
  mapGauges: Record<number, MapGauge> // mapId(area*10+no) → 进度
  eventAreas: Record<number, EventArea> // 活动区 id → 观测窗口
  battleReconciliation: BattleReconciliationSession
}

export type Section =
  | 'master'
  | 'basic'
  | 'materials'
  | 'ships'
  | 'decks'
  | 'ndocks'
  | 'kdocks'
  | 'slotitems'
  | 'quests'
  | 'missionStates'
  | 'useitems'
  | 'furnitures'
  | 'portLogs'
  | 'sortie'
  | 'mapGauges'
  | 'practice'
  | 'record'
  | 'payitems'
  | 'airBases'
  | 'eventAreas'
  | 'friendlyRequest'
  | 'battleReconciliation'

// mg:patch 的载荷：player 各切片拍平 + master
export interface MgPatch {
  master?: MgMaster
  basic?: MgPlayer['basic']
  materials?: number[] | null
  ships?: Record<number, PlayerShip>
  decks?: Deck[]
  ndocks?: Ndock[]
  kdocks?: Kdock[]
  slotitems?: Record<number, SlotitemInstance>
  quests?: Record<number, Quest>
  questsTs?: number | null
  questsFullTs?: number | null
  questActiveIds?: number[] | null
  questActiveTs?: number | null
  questExecCount?: number | null
  missionStates?: Record<number, number>
  missionStatesTs?: number | null
  missionLimitTs?: number | null
  useitems?: Record<number, number>
  useitemsTs?: number | null
  furnitures?: number[] | null
  portLogs?: { type: number; message: string }[]
  sortie?: SortieView | null
  mapGauges?: Record<number, MapGauge>
  eventAreas?: Record<number, EventArea>
  practice?: MgPlayer['practice']
  record?: PlayerRecord | null
  combinedFlag?: number
  friendlyRequest?: MgPlayer['friendlyRequest']
  airBases?: AirBaseSquad[]
  airBasesTs?: number | null
  lastPortTs?: number | null
  berthSince?: Record<number, number> // 随 decks 一起推，见 main/mg/index.ts
  battleReconciliation?: BattleReconciliationSession
}

export interface MaterialRow {
  ts: number
  values: number[] // 8 项，与 materials 同序
}

export interface UseitemHistoryChange {
  itemId: number
  ts: number
  delta: number
  total: number
  // v12 起主进程落账时写入 kcsapi path；属性缺席仅用于兼容旧 IPC 行。
  cause?: string | null
}

// 分类记账：某来源在时间段内的净收支（8 项，与 materials 同序）
export interface CategorySummary {
  category: string
  values: number[]
}

export interface FactoryRecipeOutcome {
  mstId: number // 开发失败 = -1
  count: number
}

export interface FactoryRecipeStats {
  recipe: number[] // 建造 [燃,弹,钢,铝,开发资材,大型标记]；开发 [燃,弹,钢,铝]
  attempts: number // 建造按已领取舰计；开发按 api_get_items 每个结果计
  firstTs: number
  lastTs: number
  outcomes: FactoryRecipeOutcome[]
  // 开发独有：当刻秘书舰所属的开发表（砲戦/水雷/空母/潜水系）。同配方按它分行，
  // 因为滚的本来就是不同的表。null = secretary_mst 列上线前的老记录，无从回补。
  secretary?: string | null
}

export interface FactoryStatsReport {
  sinceTs: number
  earliestTs: number | null
  ship: FactoryRecipeStats[]
  item: FactoryRecipeStats[]
  pendingShips: number // 已开始但尚未在账本中匹配到领取结果
  unmatchedShipResults: number // 有领取结果，但对应的建造事件不在账本里（清理过，或早于开始记账那天）
}

export interface EventSortieCostReport {
  areaId: number
  sinceTs: number
  sorties: number // 有完整出发/返港燃弹快照的出击数
  skipped: number // 老记录或中途启动导致缺起点快照
  fuel: number
  ammo: number
  maps: { map: number; sorties: number; fuel: number; ammo: number }[]
}

export interface NodeForecastSample {
  total: number // 该点战斗结算样本
  wins: number // B 胜以上
  saWins: number // S/A 胜
  sWins: number // S 胜
  passTotal: number // 已观测到进击/返港选择的样本
  passed: number // 实际选择继续进击
  taiha: number // 结算后至少一舰大破
  bosses: number // 其中被游戏标记为 Boss 的样本
}

export interface SortieForecastReport {
  sortie: {
    total: number // 已完整观测到返港的出击
    wins: number // Boss B 胜以上
    saWins: number // Boss S/A
    sWins: number // Boss S
    reached: number // 到达 Boss
  }
  current: NodeForecastSample
  nodes: Record<number, NodeForecastSample> // cell(api_no) → 同范围历史
  preview: NodeForecastSample | null // 当前 api_e_deck_info 三舰前缀命中的阵容样本
}

/** 本机确认掉落层的一条：你自己捞到过这条船几次、第一次与最近一次是什么时候 */
export interface LocalDropShip {
  mstId: number
  count: number
  firstTs: number
  lastTs: number
  /**
   * 这 `count` 次分别落在哪几个点（罗盘 `api_no`，不是点位字母）。
   * 次数降序、同次数按点号；逐条之和恒等于 `count`。
   * 在**装配期**算好随报告一起过来，展示侧只拼一次字符串——
   * 文案与字母反查见 shared/local-drop-cells。
   */
  cells: LocalDropCell[]
}

/**
 * 「本机确认掉落」——第一方一手的掉落证据（2026-08-22 起）。
 *
 * 与离线目录**并列显示，不合并**：目录说的是「社区确认这里掉这条船」，
 * 这一层说的是「我自己在这儿捞到过」。合并会让第一方观测冒充社区确认。
 * 聚合逻辑在 src/main/mg/local-drops.ts（纯函数，单测覆盖）。
 */
export interface LocalDropScope {
  battles: number
  sWins: number
  /** S 胜却一条船都没掉的次数——「空掉落」的第一方证据（只在 S 胜里数） */
  sWinsWithoutDrop: number
  ships: LocalDropShip[]
}

export interface MapChronicleReport {
  cells: { cell: number; count: number; lastTs: number }[]
  drops: { cell: number; mstId: number; count: number }[]
  sortieCount: number
  edges: { cell: number; count: number }[] // cell = 罗盘 api_no
  bossCells: number[] // 仅按本机实际遭遇到的 Boss 点认定
  /**
   * 同一批 Boss 点，各带最近一次遭遇的时间。多血条活动图有好几个 Boss 点，
   * 「默认目标点」要挑最近打过的那个——只有点号排不出先后。
   */
  bossSeen: { cell: number; lastTs: number }[]
  /** 整图的本机确认掉落层（与「实际掉落」那份按点分的不同：这一份带 S 胜口径与首末次） */
  localDrops: LocalDropScope
}

/** 通关阵容（2026-08-17 用户提议）：这张图上打赢过 Boss 的编成，按舰组聚合 */
export interface MapClearFleetRow {
  /** 每支舰队一组（联合舰队两组）；[舰型 mstId, 出击时等级]，取最近一次赢的那场 */
  decks: { mstId: number; lv: number }[][]
  sorties: number // 这套编成在本图的总出击数
  reached: number // 其中到达 Boss 的次数——个人实测的带路参考
  wins: number // Boss 战 B 胜以上
  sWins: number // 其中 S 胜
  lastWinTs: number // 最近一次打赢 Boss
  /** 最近一次赢的那场的航迹（罗盘 api_no 顺序）；时间窗切不出来为空 */
  path: number[]
  /** 多次通关走过不同路线——判「是不是绕路」的直接信号 */
  pathVaried: boolean
  /** 最近一次赢的那场的装备搭配（[队][舰][装备]）；2026-08-17 前的老样本为 null */
  equips: { mstId: number; level: number }[][][] | null
  /** 出击那一刻的 33 式索敌（分岐点係数 ×1）；老样本为 null */
  los33: number | null
}

/**
 * 一个点位的实得经验样本。
 *
 * 两层不确定性，处理方式不同：
 *   · 旗舰 ×1.5、MVP ×2 —— **结构性的**，实测 240/360/480 与公式吻合。
 *     统计时直接排除这两类舰次，只留基准位置，口径才干净。
 *   · 敌编成 —— 二期起「同じマスでも敵編成が強力なほど経験値が多くなる」，
 *     这是真随机。拆掉加成后 624-25 仍有 156~468 的三倍差，就是它。
 * 所以第二层不可能消掉，只能如实给区间：p25/中位/p75 一起报，
 * 由界面换算成「大约几到几场」，不塌缩成一个假装精确的数。
 */
export interface ExpSample {
  key: string
  map: number
  cell: number
  practice: boolean
  /** 基准位置（非旗舰、非 MVP）的舰次数 */
  samples: number
  min: number
  max: number
  /** 四分位。给区间而不是单值——同点位的经验本来就随敌编成变 */
  p25: number
  median: number
  p75: number
  /** 旗舰位样本数，用来说明「放旗舰会更快」这句有没有实测支撑 */
  flagshipSamples: number
  /**
   * 演习桶专用：有多少基准舰次是从「当场带着练巡」的战斗里除掉加成后归一来的。
   * 归一后桶里存的是**无练巡基线**，显示层按当前编成把系数乘回去——
   * 不归一的话，历史样本里隐含的旧练巡加成会和当前系数重复计算。
   */
  tcNormalized: number
}

export type ExpSampleReport = ExpSample[]

export interface NodeHistoryIndexEntry {
  map: number
  cell: number
  count: number
  bosses: number
  lastTs: number
}

export interface NodeHistoryEntry {
  ts: number
  isBoss: boolean
  formation: number
  comp: number[]
  rank: string | null
  dropMst: number | null
  sunkMask: number | null
}

export interface NodeHistoryReport {
  map: number
  cell: number
  entries: NodeHistoryEntry[]
}

export interface NodeDropIndexEntry {
  map: number
  cell: number
  drops: number
  kinds: number
  lastTs: number
}

export interface NodeDropIndex {
  kinds: number
  entries: NodeDropIndexEntry[]
}

export interface NodeDropEntry {
  ts: number
  isBoss: boolean
  rank: string | null
  mstId: number
}

export interface NodeDropReport {
  map: number
  cell: number
  battles: number
  sWins: number
  drops: number
  kinds: number
  entries: NodeDropEntry[]
}

/**
 * 「这张图的每个分歧点，我自己实际被带去过哪几次」。
 *
 * 键都是**边号**（api_no，与 nodes[].cell 同口径），`-1` 是出发点。
 * 翻成 A/B/C 要靠 fcd 的 route 表，那一步在渲染层做。
 */
export interface RouteStatsReport {
  map: number
  branches: Record<number, Record<number, number>> // from → to → 次数
  total: number // 全图记下的分歧步数
  lastTs: number | null // 最近一次记录的时刻；null = 这张图还没走过
}

// 首见志：某舰在本地遭遇志里最早的一条掉落 / 击沉记录。
// 「首次」的边界严格是**本地账本内**——账本开始记录之前的获得与击沉无从得知，
// 所以 index 一并给出账本起点，UI 必须把这个边界说出来，不冒充「你游戏生涯的第一次」。
export interface FirstEncounterRecord {
  mstId: number
  ts: number
  map: number // mapArea * 10 + mapNo
  cell: number
  isBoss: boolean
}

export interface FirstEncounterIndex {
  drops: Record<number, FirstEncounterRecord> // 我方首次获得（掉落）
  kills: Record<number, FirstEncounterRecord> // 敌方首次击沉
  dropsFrom: number | null // 账本里最早一条遭遇记录的时间戳
  killsFrom: number | null // 最早一条**带击沉掩码**的记录；sunk_mask 是后加列，更老的记录不可知
  // 「账本内最早的一条」不等于「你的第一次」——记账之前的击沉无从得知。
  // 掉落侧的旁证是铃维护的持有基线（渲染层 ship-first-owned），不在这里；
  // 击沉侧只能靠遭遇痕迹：
  metSince: Record<number, number> // 深海 mstId → 本地最早遭遇到它的时刻
}

export type ExpeditionResultKind = 'success' | 'great' | 'failed'

export interface ExpeditionHistoryEntry {
  ts: number
  missionId: number
  deckId: number
  result: ExpeditionResultKind
  materials: number[] // 燃弹钢铝
  items: { id: number; count: number }[]
}

export interface ExpeditionHistoryReport {
  missionId: number
  total: number
  success: number
  great: number
  failed: number
  lastTs: number | null
  averageMaterials: {
    successful: [number, number, number, number] | null
    success: [number, number, number, number] | null
    great: [number, number, number, number] | null
  }
  entries: ExpeditionHistoryEntry[]
}

export interface ShipLifeEquipment {
  slot: number | 'ex'
  instanceId: number
  mstId: number
  level: number
  alv: number
}

export type ShipLifeEventKind =
  | 'join'
  | 'exp'
  | 'equipment'
  | 'remodel'
  // ケッコンカッコカリ。与 remodel 同族：都是这一艘**实例**身上一次性的、
  // 由玩家操作确认的永久变化，靠 path 到达落账而不是靠状态差分推断。
  | 'marriage'
  // 格納庫増設。同样与 remodel 同族：把某一格的舰载机搭载上限永久抬高一次。
  | 'hangar_expand'
  | 'sortie'
  | 'battle'
  | 'scrap'
  | 'material'
  | 'sunk'

export interface ShipLifeEvent {
  id: number
  ts: number
  kind: ShipLifeEventKind
  expDelta: number
  map: number | null
  cell: number | null
  rank: string | null
  isBoss: boolean
  practice: boolean
  mvp: boolean
  detail: Record<string, any>
}

export interface ShipLifeReport {
  rosterId: number
  trackingSince: number | null
  lastSeen: number | null
  expGained: number
  sorties: number
  battles: number
  wins: number // 出击战斗 B 以上
  winRate: number | null // 出击战斗 B 以上占比
  practiceBattles: number
  practiceWins: number // 演习整队结算 B 以上
  practiceWinRate: number | null
  bossBattles: number
  mvps: number
  remodels: number
  // 累计承受伤害（掉的 HP）、被打进大破的场次、累计造成伤害，出击与演习合计。
  // 造成伤害只含**有明确施加方**的：航空战/基地航空/支援是阶段伤害，
  // 游戏不给逐舰归属，不摊给任何人。
  // 这几列是后加的：更早的战斗记录里没有，只能报出**不可知的场次数**，
  // 绝不把缺数据补成 0 混进总数——那等于替旧记录断言「那些仗一滴血没掉、也没打出去」。
  damageTaken: number
  taihaCount: number
  damageDealt: number
  damageTrackedFrom: number | null // 从哪一战起这几个数才是全的
  damageUnknownBattles: number // 这之前有多少场说不出
  events: ShipLifeEvent[]
}

/**
 * 这一艘终结过的一场 boss（敌旗舰的最后一击是她打的）。
 *
 * 数据来自 battle 事件的 `detail.bossKill`——不是新事件种类，也不是新表：
 * 「谁终结了这场 boss」本来就是那一场战斗记录的一个属性。
 * 判据见 shared/boss-kill；航空/支援终结的场次没有单舰归属，不会出现在任何一艘的表里。
 */
export interface ShipBossKillEntry {
  /** 对应的 battle 生命事件 id */
  eventId: number
  ts: number
  map: number | null
  cell: number | null
  rank: string | null
  /** 敌旗舰的深海 mstId */
  bossMstId: number
  /** 战斗快照 id；快照被清掉后为 null（这一条仍然成立，只是点不开复盘） */
  snapshotId: number | null
}

export type ShipDepartureReason = 'scrap' | 'material' | 'sunk'

export interface ShipMemorialEntry {
  rosterId: number
  mstId: number
  reason: ShipDepartureReason
  departedTs: number
  level: number
  life: ShipLifeReport
}

export interface ShipMemorialReport {
  scrapped: number
  materials: number
  sunk: number
  entries: ShipMemorialEntry[]
}
