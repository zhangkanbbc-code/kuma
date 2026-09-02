// kcwiki 台词档名的「场景 token → 官方语音槽位」对照表。
//
// ---- 这张表不是猜的 ----
// 2026-08-22 建表时拿随包的 kcwiki-voice（每条自带中文「场合」）与 subtitle-ja
// 按**日文原文**逐条回连，得到 token → 槽位的实测频次，每个 token 的槽位取值
// 都只有一个：Intro→1 共 284 例、Sec1→2 共 108 例、Sec2→3 共 226 例、
// Sec3→4 共 220 例……无一例外；时报 HH00→30+小时同样每个整点 112~115 例。
// 改这张表之前请先重跑那次对账，别照着直觉改。
//
// ---- 为什么它得住在 shared ----
// 三个地方要用同一份：① 抓取器解析季节台词档名（scripts/lib/kcwiki-seasonal-voice.mjs
// 按相对路径 import 这个 .ts，走 Node 的类型剥离，和 cjk-fold 同一条路）；
// ② 图鉴常规台词区反算播放地址；③ 护栏。
// 各写一份必然漂移——而漂移的表现是「有些行莫名其妙没有播放钮」，不报错。
//
// ---- ②那条路是 2026-08-22 用户实机报出来的 ----
// 国後的「秘书舰1」行没有播放钮，同一页的「入手/登入时」行却有。
// 根因：常规台词区此前**只**靠「日文原文 ↔ subtitle-ja 文本匹配」反算槽位，
// 短句/通用句/标点变体（「なに? 呼んだ? ふ〜」）必然连不上，于是没钮。
// 而 kcwiki 的台词 key 本身就是档名（`106-Sec1`），token 就写在里面——
// 有现成的实证对照表却去猜文本，是把可靠信息扔了。
// 所以口径改成：**先查这张表，文本匹配降为兜底**。

// ⚠️ **这个文件一个值导入都不许加**：抓取器（scripts/lib/kcwiki-seasonal-voice.mjs）
// 与几条护栏直接 import 这个 `.ts`，走 Node 的类型剥离——那条路上无扩展名的相对
// **值**导入解析不了，而带 `.ts` 扩展名的写法过不了 esbuild 逐文件转译那一关
//（产物里会留下 `require('./x.ts')`）。所以 54 起的裸编号槽位表也住在本文件里，
// 而不是另立一个模块让这边去引（那张表见下面 SPECIAL_VOICE_SLOTS）。

export interface VoiceSceneSlot {
  slot: number
  scene: string
  /**
   * **适用范围**：这一格只在这几个形态身上存在（不写＝全局，所有形态都摆）。
   *
   * 2026-08-23 用户拍板加的字段，判例是 917/918（Graf Zeppelin 系专用夜战）：
   * 全局收进表就等于在别的 800+ 形态页上各铺两行**死格**——点下去必 404、
   * 顺手把台账撑大一圈。而不收又回到「她确实说了，图鉴里一行都没有」。
   * 有了这个字段，两难消失：**存在面窄的槽位按舰限定摆**。
   *
   * ⚠️ 它只管**摆行**（骨架/探测），不管取址：`encodeVoiceFile` / `isPlayableVoiceId`
   * 照旧认整张表——那两条是「这个编号算不算得出地址」，与「该不该主动摆一行」
   * 是两件事（同一条分界见 voice-sound-path 头注的「拦截侧 vs 展示侧」）。
   * 于是别的舰若真在这一格留下过实物，档案照样点得亮、播得出。
   */
  onlyMst?: readonly number[]
}

export const VOICE_SCENE_SLOTS: Record<string, VoiceSceneSlot> = {
  Intro: { slot: 1, scene: '获得/登录时' },
  Sec1: { slot: 2, scene: '秘书舰1' },
  Sec2: { slot: 3, scene: '秘书舰2' },
  Sec3: { slot: 4, scene: '秘书舰3' },
  ConstComplete: { slot: 5, scene: '建造完成' },
  DockComplete: { slot: 6, scene: '修复完成' },
  Return: { slot: 7, scene: '归来' },
  Achievement: { slot: 8, scene: '战绩' },
  Equip1: { slot: 9, scene: '装备/改修/改造1' },
  Equip2: { slot: 10, scene: '装备/改修/改造2' },
  DockLightDmg: { slot: 11, scene: '小破入渠' },
  DockMedDmg: { slot: 12, scene: '中破入渠' },
  FleetOrg: { slot: 13, scene: '编成' },
  Sortie: { slot: 14, scene: '出征' },
  Battle: { slot: 15, scene: '战斗开始' },
  Atk1: { slot: 16, scene: '攻击1' },
  Atk2: { slot: 17, scene: '攻击2' },
  NightBattle: { slot: 18, scene: '夜战' },
  LightDmg1: { slot: 19, scene: '小破1' },
  LightDmg2: { slot: 20, scene: '小破2' },
  MedDmg: { slot: 21, scene: '中破' },
  Sunk: { slot: 22, scene: '击沉' },
  MVP: { slot: 23, scene: 'MVP' },
  Proposal: { slot: 24, scene: '结婚' },
  LibIntro: { slot: 25, scene: '图鉴介绍' },
  Equip3: { slot: 26, scene: '装备' },
  Resupply: { slot: 27, scene: '补给' },
  SecWed: { slot: 28, scene: '秘书舰（婚后）' },
  Idle: { slot: 29, scene: '放置' },
}

// 长的先试：Sec1 是 Sec13 的前缀，先匹配 Sec1 会把 Sec13 切错。
const SCENE_TOKENS = Object.keys(VOICE_SCENE_SLOTS).sort((a, b) => b.length - a.length)

/** 时报：HHMM → 30+小时。同样是实测（每个整点 112~115 例，取值唯一）。 */
export const hourlyVoiceSlot = (token: string): VoiceSceneSlot | null => {
  const matched = /^([01]\d|2[0-3])00$/.exec(`${token ?? ''}`)
  if (!matched) return null
  const hour = Number(matched[1])
  return { slot: 30 + hour, scene: `时报 ${matched[1]}:00` }
}

// ---- 裸编号槽位（编号 ≥54）----
//
// 官方语音**编号 ≤53 才过混淆算法，54 起裸编号直出**：文件名就是编号本身。
// 一手依据是 KC3Kai `src/library/modules/Meta.js` 的 `getFilenameByVoiceLine`：
//   `lineNum <= 53 ? 100000 + 17*(ship_id+7)*diffs[lineNum-1] % 99173 : lineNum`
//
// ---- 为什么是名单，不是值域 ----
// `shared/voice-sound-path` 里那条 `directVoiceIdOf`（「小于 100000 就是裸编号」）
// 是**拦截侧**的判据：游戏自己请求了一条 URL，我们只需认出它的来路，判得宽一点
// 只会多认出几条，不会伤人。
// 下面这张表是**展示侧**：主动摆一行、主动去探一格。判宽了就是拿着 54..899 里
// 几百个根本不存在的编号去骚扰游戏服务器，还会在界面上摆出几百行「未知槽位」。
// 所以展示侧只认这张写死的表——**未知裸编号不瞎探**。
//
// ---- 出处（双源一致）----
// KC3Kai `src/library/modules/Translation.js` 的 `_descToId` 表，
// 与 GotoBrowser 的 `quotes_label.json`。同一份出处里记着的那几族，
// 2026-08-23 用户逐族拍板，收法各不相同——**取舍的量纲是「存在面 × 每形态成本」**：
//   · **129 = 放置②**（好感/士气 ≥50 时的另一句放置台词）→ **全局收**。
//     性质与时报一样：存在面广、一行成本，没有这一格的舰点一次 404 自剪。
//   · **917 / 918 = Graf Zeppelin 系专用夜战** → **按舰限定收**（`onlyMst`）。
//     存在面只有一家，全局摆就是在 800+ 形态页上各铺两行死格。
//     Graf 家的形态号是**从本机主数据快照实测的**（`api_mst_ship` 按舰名匹配
//     「Graf Zeppelin」全形态）：432 = Graf Zeppelin，353 = Graf Zeppelin改，共两个。
//   · **141~161 / 241~261 / 342~350 = 友军舰队**（末两位是活动海域号）→ **只收 141/241**。
//     只有这一对在随包字幕里有文本实证（4 艘：43/145/243/961，原文都是
//     「西村艦隊、これより主力部隊を援護するよ！」）。其余那二十几个编号**不进表**：
//     哪一期活动有友军、编号排到几，表这边永远滞后。它们由「亲历显形」那条路兜住——
//     玩家真听到过一次，实物就躺进档案，档案里的表外裸编号自动长行
//     （见下面 `bareVoiceSceneName` 与 voice-probe-plan 的 `bareArchiveVoiceRows`）。

/**
 * Graf Zeppelin 系的全部形态。
 *
 * **实测得来，不是拍脑袋写死的数字**：2026-08-23 读本机主数据快照
 * `%APPDATA%\kanso\snapshots\kcsapi_api_start2_getData.json`（`{ts, body}` 两层，
 * 主数据在 `body.api_data`），按 `api_name` 匹配 “Graf Zeppelin” 得两条，
 * 与 `api_yomi`「グラーフ・ツェッペリン」一致，无第三个形态：
 *   · 432 = Graf Zeppelin（音轨目录 tepoqqczfonx）
 *   · 353 = Graf Zeppelin改（音轨目录 uljlkucfqqcc）
 * 官方哪天给她再来一级改装，这里会**少摆两格**而不是摆错——按舰名重跑一次上面那步补上。
 */
const GRAF_ZEPPELIN_FORMS: readonly number[] = [353, 432]

/**
 * 已知裸编号族。**按编号升序**——骨架摆行直接按这个顺序接在 1..53 之后。
 *
 * 带 `onlyMst` 的那几项**只在名单里的形态摆行**，其余形态一格都不铺（见接口注释）。
 */
export const SPECIAL_VOICE_SLOTS: readonly VoiceSceneSlot[] = [
  // 放置②：好感/士气 ≥50 时官方会改播的另一句放置台词（KC3Kai `Translation.js`
  // 的 `_descToId` 记作 Idle 的第二条，GotoBrowser `quotes_label.json` 同）。
  // 常规 29 号槽是平时那句放置，两者是两个文件、两句话，不是同一格的季节替换。
  { slot: 129, scene: '放置②' },
  // 西村舰队的联合作战台词。它们**不是**结婚语音（婚礼是常规 24 号槽）——
  // 这条订正的实证在 renderer/kcs-voice 的文件头里。
  // 命名按 KC3 语义（末两位=活动海域编号）：41 = 2018 冬「捷号决战」后篇，
  // 時雨这两句正是那一期的西村舰队增援台词。2026-08-23 用户拍板从「特殊（西村舰队）」改。
  { slot: 141, scene: '友军舰队（海域41）一' },
  { slot: 241, scene: '友军舰队（海域41）二' },
  // 特殊攻击（SpCutin）。本机台账里 Richelieu改 与 大和改二重 的 `900.mp3`
  // 被记成「认不出」16+7 次，正是这一族——玩家早就在游戏里听到过。
  { slot: 900, scene: '特殊攻击' },
  { slot: 901, scene: '特殊攻击（二番舰分支1）' },
  { slot: 902, scene: '特殊攻击（二番舰分支2）' },
  { slot: 903, scene: '特殊攻击（二番舰分支3）' },
  // Graf Zeppelin 系专用夜战。**只在她家的形态页摆**——出处（KC3 `_descToId` /
  // GotoBrowser `quotes_label.json`）只写到「Graf Zeppelin 系专用夜战」这一层，
  // 没有再细分的语义，所以场合名照编号顺序给「一 / 二」，不硬安一个具体触发条件。
  { slot: 917, scene: '夜战特殊（Graf）一', onlyMst: GRAF_ZEPPELIN_FORMS },
  { slot: 918, scene: '夜战特殊（Graf）二', onlyMst: GRAF_ZEPPELIN_FORMS },
  // 金刚型夜战特殊攻击的僚舰分支
  { slot: 990, scene: '夜战特殊（僚舰分支1）' },
  { slot: 991, scene: '夜战特殊（僚舰分支2）' },
  { slot: 992, scene: '夜战特殊（僚舰分支3）' },
  { slot: 993, scene: '夜战特殊（僚舰分支4）' },
]

const SPECIAL_BY_SLOT = new Map(SPECIAL_VOICE_SLOTS.map((entry) => [entry.slot, entry]))

/**
 * 表里的**全部**编号，升序。**含限定形态的那几个**（917/918）。
 *
 * ⚠️ 摆行别用它——那是 `specialVoiceSlotIdsFor` 的活。这一份是「取址侧认得哪些编号」，
 * 拿它去铺骨架就等于把 917/918 铺到每一艘舰身上（正是 `onlyMst` 要挡的那件事）。
 */
export const SPECIAL_VOICE_SLOT_IDS: readonly number[] = SPECIAL_VOICE_SLOTS.map(
  (entry) => entry.slot,
)

/**
 * **这个形态**该摆哪些裸编号槽位，升序：没有 `onlyMst` 的全摆，有的只摆给名单里的形态。
 *
 * 传 null / undefined（不知道是哪个形态）时**只给全局那些**——限定槽位宁可少摆，
 * 也不在一个还没认出来的形态上铺死格。
 */
export const specialVoiceSlotIdsFor = (mstId: number | null | undefined): number[] =>
  SPECIAL_VOICE_SLOTS.filter(
    (entry) => !entry.onlyMst || (mstId != null && entry.onlyMst.includes(mstId)),
  ).map((entry) => entry.slot)

/** 这个编号是不是**表里**的裸编号槽位。表外的一律 false（未知裸编号不瞎探）。 */
export const isSpecialVoiceSlot = (slot: unknown): boolean =>
  Number.isInteger(slot) && SPECIAL_BY_SLOT.has(slot as number)

/** 裸编号槽位的场合名。不在表里返回空串。 */
export const specialVoiceScene = (slot: number): string => SPECIAL_BY_SLOT.get(slot)?.scene ?? ''

// ---- 表外裸编号的场合名（「亲历显形」用）----
//
// ---- 为什么这条与「未知裸编号不瞎探」不矛盾 ----
// 上面那条管的是**主动**：主动摆一行、主动去探一格——判宽了就是拿着几百个根本
// 不存在的编号去骚扰游戏服务器，所以只认写死的表。
// 这一条管的是**已经发生过的事**：档案里躺着的那一格，是玩家在游戏里真听到过、
// 字节都留下来了的。它的存在性判据是**实物本身**，不需要表来背书，也不发一次请求。
// 于是官方将来发明任何新裸编号，玩家听过一次就自动显形，**不必等表更新**——
// 「表外新编号的收编时差」由此闭环（2026-08-23 用户拍板）。
//
// 名字怎么给：友军舰队那三段有 KC3 语义（末两位 = 活动海域号），照它推；
// 其余给中性的「音轨 #N」——不知道是什么场合就**不编一个**，编号本身是唯一诚实的说法。
// 出处与表里 141/241 同一份（KC3Kai `Translation.js` 的 `_descToId`、
// GotoBrowser 的 `quotes_label.json`）。

/**
 * 友军舰队三段：段内编号的末两位 = 活动海域号，段序 = 第几句。
 *
 * ---- 上界是外推的，`from` 不是 ----
 * 实证只到 161 / 261 / 350（KC3 那份名单当年的快照）。可活动海域号还在涨，
 * 上界卡在实证边界的后果是新一期的友军显示成「音轨 #162」而不是场合名——
 * 而「末两位 = 活动海域号」这条语义本身是既有的、连续的，没有理由到 62 就断掉。
 * 所以三段的 `to` 一律放宽到该段的语义上界（99 号海域），**名字按既有语义外推**。
 * 将来若有实物证明别的族占了这几段里的某些编号，**按实物收窄**，不是反过来。
 *
 * `from` 一律不动，都有实证理由：141/241 是随包字幕里唯一有文本实证的那一对；
 * 342 起是因为海域 41 根本没有第三句（341 不存在，如实显示成「音轨 #341」）。
 */
const FRIEND_FLEET_BANDS: readonly { from: number; to: number; ordinal: string }[] = [
  { from: 141, to: 199, ordinal: '一' },
  { from: 241, to: 299, ordinal: '二' },
  { from: 342, to: 399, ordinal: '三' },
]

/**
 * 裸编号 → 场合名，**表外也管**。友军段按 KC3 语义推，其余「音轨 #N」。
 *
 * 与表里 141/241 的写法必须一字不差（护栏逐条对着表验）——同一个编号在两条路上
 * 显示成两种名字，玩家读到的就是「这是两件事」。
 */
export const bareVoiceSceneName = (slot: unknown): string => {
  if (!Number.isInteger(slot)) return ''
  const value = slot as number
  if (value <= 0) return ''
  for (const band of FRIEND_FLEET_BANDS) {
    if (value >= band.from && value <= band.to) {
      return `友军舰队（海域${`${value % 100}`.padStart(2, '0')}）${band.ordinal}`
    }
  }
  return `音轨 #${value}`
}

export interface ParsedVoiceKey {
  /** kcwiki 的**形态码**（图鉴号 + 可选改装字母）。不是 mstId，也不是 ships 包的「图鉴号」 */
  code: string
  slot: number | null
  scene: string
  tail: string
}

/**
 * 档名 → { code, slot, scene, tail }。
 *
 * 形如 `106-Sec1` / `005-Sec1Christmas2015` / `080-0100Setubunn2019`。
 * 认不出场景就把 slot/scene 留空：季节页里有 245 行是 `109-2ndAnniv` 这种
 * 「整条尾巴都是季节词、根本没有场景 token」的，硬套一个场景名等于编。
 */
export const parseVoiceKey = (rawKey: string): ParsedVoiceKey => {
  const key = `${rawKey ?? ''}`.trim()
  const dash = key.indexOf('-')
  if (dash <= 0) return { code: '', slot: null, scene: '', tail: key }
  const code = key.slice(0, dash)
  if (!/^\d{1,4}[a-z]?$/.test(code)) return { code: '', slot: null, scene: '', tail: key }
  const tail = key.slice(dash + 1)
  const token = SCENE_TOKENS.find((candidate) => tail.startsWith(candidate))
  if (token) {
    const { slot, scene } = VOICE_SCENE_SLOTS[token]
    return { code, slot, scene, tail }
  }
  const hourly = hourlyVoiceSlot(tail.slice(0, 4))
  if (hourly) return { code, slot: hourly.slot, scene: hourly.scene, tail }
  return { code, slot: null, scene: '', tail }
}

/** 只要槽位这一个数。认不出返回 null——**不猜**，认不出的行如实不给播放钮。 */
export const voiceSlotOfKey = (rawKey: string): number | null => parseVoiceKey(rawKey).slot

// ---- 补键前的逐行交叉校验（2026-08-22 用户实测播错句后加的）----
//
// ---- 为什么光有场合表还不够 ----
// 场合表回答的是「这个 token 一般对应哪个槽位」，**不保证某一艘舰身上成立**。
// 用户实测撞到的那一例：国後（mstId 518）
//   游戏真实音轨 subtitle-ja[518]：2 号槽 =「ええ？あたしはそういうのはいいかな？…」（长句）
//   kcwiki 档名 318-Sec1              =「なに？呼んだ？ふ～」
// 表推给了 2 号槽，点下去播的却是那段长台词——**一个音节都对不上**。
// 已查明这类错位至少两种成因，都不是解析器能修的：
//  ① **季节语音占用了常规槽位**：官方当季把 2 号槽的文件换成季节版，
//     subtitle-ja 抓到的是当季那一份，kcwiki 记的是平时那一句；
//  ② **kcwiki 把改形态的档名塞进了基础形态**：`data[110]`（翔鶴）下同时躺着
//     `106-*`（翔鶴）与 `261-*`（翔鶴改）两组行，按翔鶴的音轨去播改的台词必错。
//
// ---- 家法：宁可无键，不播错句 ----
// **当初文本匹配失败本身就是警报**（那句台词在这艘舰的音轨里根本找不到），
// 无条件补键等于把警报当噪音。所以补键前先交叉校验一次：
// 真要播的那艘舰在这个槽位上写着别的话 → 判分歧、不给键。
//
// ⚠️ 校验必须拿**将要播放的那艘舰**（playbackMstId）的字幕表，不是文本来源那艘。
// 文本可以沿改装链从前置形态借，音轨却永远按当前形态拼——两者槽位排布不一致时，
// 拿来源舰去校验会把「其实播得对」的行误判成分歧，也会放过真正会播错的行。

/**
 * 这一行该不该给播放钮、给哪个槽位。
 *
 * · `key-confirmed` 表推的槽位与该舰字幕表对得上——最可信，给键；
 * · `key-only`      该舰整份字幕缺席、或那个槽位没有文本，无从校验——允许纯表推；
 * · `divergent`     该槽位写着**明显不同**的另一句话——判分歧，**不给键**；
 * · `unknown`       档名里没有场景 token，表推不出来——交给文本匹配兜底。
 *
 * ⚠️ `key-only` **给键**，别再把它整档关掉。2026-08-22 曾按「无从校验＝可能会错」
 * 把它整族撤键（2947 个），次日复核证据轴判定砍偏了并恢复：两条耳测判例一条属
 * kcwiki 表缺陷族、一条是季节占槽（槽位号推得没错），都指不到这一档；而季节占槽是
 * **时间性的、对全站所有地址键一视同仁**，拿它惩罚某一族既没治住风险又关掉了做对的东西。
 * 真会错的那几格由耳测台账逐格挡（`shared/voice-playback-observations`），
 * 季节风险由「档案实物优先」全域治理（`modules/ji` 的 `voicePlaybackFor`）。原委见那两处文件头。
 */
export type VoiceSlotBasis = 'key-confirmed' | 'key-only' | 'divergent' | 'unknown'

export interface VoiceSlotResolution {
  /** 判定出的槽位；`divergent` 与 `unknown` 一律 null */
  slot: number | null
  basis: VoiceSlotBasis
}

/**
 * 比对用的归一。比 `normalizeVoiceLine` 再宽一档：连标点、长音符、括号一起抹掉。
 *
 * 宽度是量出来的，不是拍的：真包 11034 行里，只去空白就能确认 8502 行，
 * 再抹标点只多确认 **5 行**——说明两边的标点差异几乎不构成误杀风险，
 * 那就取更宽的这一档，把「因为一个逗号而被判成分歧」的可能压到最低。
 */
export const foldVoiceLineForCompare = (value: unknown): string =>
  `${value ?? ''}`
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/[、。，．！？!?…‥・「」『』（）()~〜～ー－—\-,.'"”“’‘]/g, '')

export const resolveVoiceSlot = (
  rawKey: string,
  lineJa: string,
  /** 将要播放的那艘舰的字幕表（`subtitle-ja[playbackMstId]`）。整舰缺席传 null */
  slotTable: Record<string, string> | null | undefined,
): VoiceSlotResolution => {
  const slot = voiceSlotOfKey(rawKey)
  if (slot == null) return { slot: null, basis: 'unknown' }
  // 整舰缺席：无从校验，允许纯表推（这一档本来就是场合表要补的空白）
  if (!slotTable) return { slot, basis: 'key-only' }
  const at = slotTable[`${slot}`]
  if (!at) return { slot, basis: 'key-only' }
  // 本行没有日文原文时无从比对，按整舰缺席同样处理——不因为缺一半资料就拒掉
  if (!`${lineJa ?? ''}`.trim()) return { slot, basis: 'key-only' }
  if (foldVoiceLineForCompare(at) === foldVoiceLineForCompare(lineJa)) {
    return { slot, basis: 'key-confirmed' }
  }
  return { slot: null, basis: 'divergent' }
}

// ============================================================================
// 归属与文本校正：一行到底该挂在哪个形态、哪个槽位、显示哪一份文本
// ============================================================================
//
// ---- 为什么和上面同住一个文件 ----
// 这一段要用上面那三样（parseVoiceKey / resolveVoiceSlot / foldVoiceLineForCompare），
// 而抓取器与 node --test 都直接跑这个 .ts（Node 的类型剥离）——剥离模式下
// **跨 shared .ts 的值导入必须带扩展名**，带了 tsc 又不收（没开 allowImportingTsExtensions）。
// 仓库现行口径是「Node 会直接跑的 shared .ts 只用 import type」，所以这一段就住在这里，
// 不另开文件靠值导入去接。同一个域（档名 → 槽位 → 归属），住一起也不算跑题。

// ---- 为什么要有这一层 ----
// 015f68e 立了「补键前逐行交叉校验」的四档判据，把 1013 行判成 `divergent`（kcwiki 记的
// 那句话与该舰音轨对不上）后**撤键空挂**。撤键本身是对的——宁可无键，不播错句——
// 但空挂着不是终点：那 1013 行各有各的病因，混在一起看不出该修哪儿。
//
// 2026-08-22 逐行分拣（判据与计数见 test/voice-attribution.test.mjs），四类：
//
//  **① 重归属（712 行 / 最大的一类）**：kcwiki 把**改形态的档名塞进了基础形态**。
//     `data[110]`（翔鶴）下同时躺着 `106-*`（翔鶴）与 `261-*`（翔鶴改二）两组行。
//     可 kcwiki 的档名自己就写着形态码——`261` 指的是翔鶴改二，不是翔鶴。
//     把行按**档名的形态码**挪回它自己那个形态，音轨立刻对上（635 行当场转 confirmed）。
//     剩下 77 行挪过去后那个形态整份字幕缺席，无从校验，按既有的 key-only 档处理。
//     ⚠️ 只挪「在原处判分歧、在新宿主不判分歧」的行。在原处本来就对得上的行不动——
//     那说明基础形态确实也说这句话，挪走等于把一个播得对的按钮拆掉。
//
//  **② 重锚定（1 行）**：文本在**同一艘舰的别的槽位**找得到（表推的槽位错开一位）。
//     把行重锚到真正的槽位，场合标签跟着改。
//     只有 1 行——015f68e 之前猜的「这类应该不少」被实测证伪了。
//
//  **③ 按音轨真文本补正（90 行）**：kcwiki 那句在这艘舰的音轨里哪儿都找不到，
//     而该槽位的真文本是知道的（subtitle-ja 有、subtitle-zh 也有中文）。
//     **以游戏音轨为最高文本权威**——它是一手，kcwiki/wikiwiki 都是转写层。
//     所以这一格改显示音轨的真文本 + 社区译文，并标明这一行来自 poi-plugin-subtitle。
//     kcwiki 那句错文本**不显示**（显示它就是显示一句这艘舰不会说的话）。
//
//  **④ 真无解（210 行）**：音轨该槽位没有可考的文本，两种成因分开记：
//     · `season-slot`（142 行）：该槽位**被季节语音占着**。取证是双源的——
//       subtitle-ja 抓到的那句，其中文正好等于 kcwiki 季节台词包里这艘舰的某一条。
//       这一档**不改文本**（kcwiki 记的才是她平时那句），只是不给键：
//       过季点下去播的是平时那句、当季播的是季节那句，两边都不保证，那就不给。
//     · `no-subtitle`（68 行）：字幕包在该槽位写的是占位句（「このサブタイトルに対応する
//       サブタイトルがありません」），不是台词。实测只出现在内华达改 / 罗德尼 / 罗德尼改。
//
// 「d 档」在原始口径里还有一种「subtitle-ja 该槽整个没有文本」——**它不可能出现**：
// 判 divergent 的前提就是该槽有文本且与 kcwiki 不同。所以那一支计数恒为 0，不设分档。

/**
 * 槽位 → 中文场合名。时报走 30+小时那一段，其余查实证对照表；
 * 54 起的**裸编号槽位**（900 特殊攻击、141/241 西村舰队…）查上面那张显式表。
 * 认不出返回空串。
 */
export const voiceSceneOfSlot = (slot: number): string => {
  if (Number.isInteger(slot) && slot >= 30 && slot <= 53) {
    return `时报 ${String(slot - 30).padStart(2, '0')}:00`
  }
  const hit = Object.values(VOICE_SCENE_SLOTS).find((entry) => entry.slot === slot)
  return hit?.scene ?? specialVoiceScene(slot)
}

/**
 * kcwiki-ships 的改造链 → 形态码（080 / 080a / 145 / 561）→ mstId。
 *
 * 链首的码是 `改造.系列`，其后每一级的码是**上一级的 `改造.改造后`**。
 * 不能拿「图鉴号」直接当码：时雨改的图鉴号 1343、形态码 080a，两套号。
 *
 * 两处实测过的上游毛病，这里各留一条兜底：
 * ① 英勇（ID 927）的 `改造前` 与 `改造后` 都写成 `527a`，链首认不出来——
 *    于是额外用「图鉴号 == 系列」再播一次种。
 * ② 伊势的第一级改装，ships 模块给的码是 `102`，而季节页的档名写 `003a`。
 *    所以链首的码 C 若没人占用 `Ca`，就把 `Ca` 也指向它的第一级改装。
 *
 * 抓取器（scripts/lib/kcwiki-seasonal-voice.mjs）与运行时共用这一份——
 * 各写一份必然漂移，而漂移的表现是「有些台词莫名其妙归错了舰」，不报错。
 */
export const buildShipFormCodeMap = (ships: unknown): Map<string, number> => {
  const list: any[] = Array.isArray(ships) ? ships : Object.values((ships as any) ?? {})
  const codeOf = new Map<number, string>()
  const byCode = new Map<string, number>()
  const claim = (id: unknown, code: string) => {
    const shipId = Number(id)
    if (!code || code === '-1' || !Number.isInteger(shipId) || codeOf.has(shipId)) return
    codeOf.set(shipId, code)
    if (!byCode.has(code)) byCode.set(code, shipId)
  }
  for (const ship of list) {
    const series = `${ship?.改造?.系列 ?? ''}`.trim()
    if (!series) continue
    const isHead = ship?.改造?.改造前 === -1 || ship?.改造?.改造前 == null
    if (isHead || `${ship?.图鉴号 ?? ''}` === `${Number(series)}`) claim(ship?.ID, series)
  }
  for (let pass = 0; pass < 16; pass++) {
    let changed = 0
    for (const ship of list) {
      if (codeOf.has(Number(ship?.ID))) continue
      const prev = `${ship?.改造?.改造前 ?? ''}`.trim()
      if (!prev || prev === '-1') continue
      const parentId = byCode.get(prev)
      if (parentId == null) continue
      const parent = list.find((candidate) => Number(candidate?.ID) === parentId)
      const next = `${parent?.改造?.改造后 ?? ''}`.trim()
      if (!next || next === '-1') continue
      claim(ship?.ID, next)
      changed++
    }
    if (!changed) break
  }
  for (const ship of list) {
    const code = codeOf.get(Number(ship?.ID))
    if (!code) continue
    const next = `${ship?.改造?.改造后 ?? ''}`.trim()
    if (!next || next === '-1') continue
    const alias = `${code}a`
    if (!byCode.has(alias) && byCode.has(next)) byCode.set(alias, byCode.get(next)!)
  }
  for (const [code, id] of [...byCode]) {
    const stripped = code.replace(/^0+(?=\d)/, '')
    if (!byCode.has(stripped)) byCode.set(stripped, id)
    const padded = code.replace(/^(\d+)/, (digits) => digits.padStart(3, '0'))
    if (!byCode.has(padded)) byCode.set(padded, id)
  }
  return byCode
}

/**
 * poi-plugin-subtitle 在「这一条没有转写」时会写一句**占位文本**而不是留空。
 * 它长得和一句正常台词一模一样（同样有标点、同样一整句），拿去当「音轨真文本」显示
 * 就会在图鉴里出现一整页「このサブタイトルに…」。判据按**文本特征**写，
 * 不按形态名单——名单会随包更新过期。
 *
 * **中日各有一句，两句都要认**（2026-08-25 补的中文那半）：
 *   · 日文：「このサブタイトルに対応するサブタイトルがありません！艦これ中国語ウィキ
 *     （https://zh.kcwiki.moe/）に参加して、この内容を一緒に完成しましょう！」——229 格；
 *   · 中文：「本字幕暂时没有翻译 请到舰娘百科(https://zh.kcwiki.moe/)协助我们翻译」——259 格。
 * 真包实测两边各只有这一种写法。中文那句从前一个字都没拦过，于是实时字幕会把
 * 「请到舰娘百科协助我们翻译」**连网址一起**打在玩家屏幕上。
 */
export const isSubtitlePlaceholder = (value: unknown): boolean =>
  /対応するサブタイトルがありません|艦これ中国語ウィキ|本字幕暂时没有翻译|协助我们翻译/.test(
    `${value ?? ''}`,
  )

/**
 * 季节台词的**文本指纹**按形态分组：形态 mstId → 折叠后的中日两列文本。
 *
 * 给 `regularSubtitleSlots` 的 `isSeasonalText` 当料。**只此一份**——
 * 实时字幕与护栏各自现搭一个必然漂移，而漂移的表现是「护栏绿着、玩家那儿还是没字幕」。
 */
export const seasonalTextIndex = (
  ships: Record<string, { zh?: string; ja?: string }[] | undefined> | null | undefined,
): Map<number, Set<string>> => {
  const index = new Map<number, Set<string>>()
  for (const [rawFormId, lines] of Object.entries(ships ?? {})) {
    const formId = Number(rawFormId)
    if (!Number.isInteger(formId)) continue
    const folded = new Set<string>()
    for (const line of lines ?? []) {
      for (const text of [line?.zh, line?.ja]) {
        const value = foldVoiceLineForCompare(text)
        if (value) folded.add(value)
      }
    }
    if (folded.size) index.set(formId, folded)
  }
  return index
}

/**
 * 剔掉季节占用、季节污染、占位句之后，这张 subtitle 表还剩下的**常规**槽位（升序）。
 *
 * ---- 为什么「有没有表」不能只看表存不存在 ----
 * 2026-08-27 用户实测：杰维斯改（394）中破语音响了，字幕一个字都没有。
 * 根因是 subtitle-ja/zh 里 394 与 519 **各只有一个键「2」**，内容是同一句夏季限定台词
 *（「この国の夏は、暑いのね…」）——上游 poi-plugin-subtitle 对这一族的常规台词整体缺失，
 * 只剩这一条季节污染的孤条。全库 762 个有表的形态里只有这两个是这样，其余都是 27 格满配。
 * 而实时字幕那道「本形态有表就停在本形态」的闸只问表在不在，于是链停在 394，
 * 中破那一格既没有 subtitle 也没有 kcwiki（kcwiki 对改形态只收与未改有差分的台词），
 * 玩家听见了声音、看不见字。
 *
 * 「一条季节孤条」算不算有表？**不算**——它连一句常规台词都没有，
 * 挡住整条改装链却一格都填不上，正是 2026-08-23 拆过的「小桶挡整页」换了个壳。
 *
 * ---- 季节证据为什么要沿改装链看 ----
 * 519 那一条被 `seasonOccupied` 判中了（双源取证：字幕包那句的中文 == 该舰某条季节台词），
 * 394 那一条**没有**——kcwiki 的季节包把整族台词都记在基础形态的形态码下（`319-*` → 519），
 * `seasonalShips['394']` 是空的。可两条的文本一个字都不差：同一句话，同一次季节替换，
 * 只因为上游归档在哪一级不同就一条判中一条漏掉，那是记账口径的缝，不是事实的差别。
 * 所以这里把季节证据的查表面**沿改装链放宽**（`isSeasonalText` 由调用方按链构造），
 * 判据本身（折叠后逐字比对）一个字没动。
 *
 * ⚠️ **不碰 `seasonOccupiedSlots`**。那一份是图鉴侧给不给播放钮的裁决，
 * 改它等于顺手改掉另一个消费面的行为。这里另起一个只服务「选形态」的判据。
 */
export const regularSubtitleSlots = (input: {
  /** subtitle-ja 里这个形态的那张表 */
  ja?: Readonly<Record<string, string>> | null
  /** subtitle-zh 里这个形态的那张表 */
  zh?: Readonly<Record<string, string>> | null
  /** 这个形态被季节语音占着的槽位（`seasonOccupiedFrom` 的产物） */
  seasonOccupied?: ReadonlySet<number> | null
  /** 这句文本是不是该舰**改装链上任一形态**的季节台词。不给＝不做这一档剔除 */
  isSeasonalText?: ((text: string) => boolean) | null
}): number[] => {
  const { ja, zh, seasonOccupied, isSeasonalText } = input
  if (!ja && !zh) return []
  const slots: number[] = []
  for (const key of new Set([...Object.keys(zh ?? {}), ...Object.keys(ja ?? {})])) {
    const slot = Number(key)
    if (!Number.isInteger(slot)) continue
    if (seasonOccupied?.has(slot)) continue
    const jaText = `${ja?.[key] ?? ''}`.trim()
    const zhText = `${zh?.[key] ?? ''}`.trim()
    // 占位句当空：这一格本来就没有台词，不该拿它给整张表背书
    const jaReal = isSubtitlePlaceholder(jaText) ? '' : jaText
    const zhReal = isSubtitlePlaceholder(zhText) ? '' : zhText
    if (!jaReal && !zhReal) continue
    // 季节污染：**以中文列比对**——④-a 那道双源取证就是这么判的（`trueZh` vs 季节行的 `zh`），
    // 判据一个字没动，动的只是查表面（沿改装链，见函数头）。中文缺席时才退到日文列。
    if (isSeasonalText?.(zhReal || jaReal)) continue
    slots.push(slot)
  }
  return slots.sort((left, right) => left - right)
}

export type VoiceRowFix =
  /** 原处就对得上（或无从校验）：照旧 */
  | 'ok'
  /** 按档名的形态码挪到了真正的那个形态 */
  | 'reattributed'
  /** 同一艘舰，重锚到别的槽位 */
  | 'reanchored'
  /** kcwiki 那句在这艘舰的音轨里找不到，改显示音轨的真文本 + 社区译文 */
  | 'audio-text'
  /** 该槽位被季节语音占着：文本不动，不给键 */
  | 'season-slot'
  /** 音轨该槽位没有可考文本（字幕包写的是占位句）：不给键 */
  | 'no-subtitle'

export interface VoiceSourceRow {
  key: string
  scene: string
  ja: string
  zh: string
}

export interface CorrectedVoiceRow extends VoiceSourceRow {
  fix: VoiceRowFix
  /** 重归属时：这一行原本挂在哪个形态下 */
  from?: number
  /** 重锚定 / 按音轨补正时用的槽位（其余档为空，仍由档名推） */
  slot?: number
  /** 文本来自哪一层。`subtitle` 只出现在 audio-text 档 */
  textSource?: 'kcwiki' | 'subtitle'
}

export interface VoiceCorrectionStats {
  total: number
  divergent: number
  reattributed: number
  reattributedConfirmed: number
  reanchored: number
  audioText: number
  seasonSlot: number
  noSubtitle: number
}

export interface VoiceCorrectionInput {
  /** kcwiki-voice 的 data：mstId → 行 */
  voice: Record<string, VoiceSourceRow[] | undefined> | null | undefined
  /** subtitle-ja 的 data：mstId → 槽位 → 日文 */
  subtitleJa: Record<string, Record<string, string> | undefined> | null | undefined
  /** subtitle-zh 的 data：mstId → 槽位 → 中文 */
  subtitleZh: Record<string, Record<string, string> | undefined> | null | undefined
  /** kcwiki-seasonal-voice 的 `data.ships`：mstId → 季节台词行（只用其中的 zh） */
  seasonalShips: Record<string, { zh?: string }[] | undefined> | null | undefined
  /** 形态码 → mstId（`buildShipFormCodeMap` 的产物） */
  codeMap: Map<string, number> | null | undefined
}

const slotWithSameText = (
  table: Record<string, string> | undefined,
  ja: string,
  exclude: number | null,
): number | null => {
  if (!table) return null
  const want = foldVoiceLineForCompare(ja)
  if (!want) return null
  for (const [slot, text] of Object.entries(table)) {
    const parsed = Number(slot)
    if (!Number.isInteger(parsed) || parsed === exclude) continue
    if (isSubtitlePlaceholder(text)) continue
    if (foldVoiceLineForCompare(text) === want) return parsed
  }
  return null
}

/**
 * 全包一次性分拣。返回**按形态重排后**的行表，消费端直接照着渲染。
 *
 * 排序键是「槽位」而不是「包里的原顺序」：重归属会把别的桶里的行挪进来，
 * 不重排就会挂在末尾、和同一场合的行离得老远。kcwiki 的行本来就大致按槽位排，
 * 所以对没被动过的形态来说这一步近乎恒等（同槽位保持原相对次序）。
 */
export const planVoiceCorrections = (
  input: VoiceCorrectionInput,
): { rowsByForm: Map<number, CorrectedVoiceRow[]>; stats: VoiceCorrectionStats } => {
  const stats: VoiceCorrectionStats = {
    total: 0,
    divergent: 0,
    reattributed: 0,
    reattributedConfirmed: 0,
    reanchored: 0,
    audioText: 0,
    seasonSlot: 0,
    noSubtitle: 0,
  }
  const out = new Map<number, { row: CorrectedVoiceRow; order: number }[]>()
  const push = (formId: number, row: CorrectedVoiceRow, order: number) => {
    const list = out.get(formId) ?? []
    list.push({ row, order })
    out.set(formId, list)
  }
  const seasonalZh = new Map<string, Set<string>>()
  for (const [shipId, lines] of Object.entries(input.seasonalShips ?? {})) {
    const folded = new Set<string>()
    for (const line of lines ?? []) {
      const value = foldVoiceLineForCompare(line?.zh)
      if (value) folded.add(value)
    }
    seasonalZh.set(shipId, folded)
  }

  for (const [rawFormId, rows] of Object.entries(input.voice ?? {})) {
    const formId = Number(rawFormId)
    if (!Number.isInteger(formId) || !Array.isArray(rows)) continue
    const hostTable = input.subtitleJa?.[rawFormId]
    for (const [index, row] of rows.entries()) {
      stats.total += 1
      const resolved = resolveVoiceSlot(row.key, row.ja, hostTable ?? null)
      if (resolved.basis !== 'divergent') {
        push(formId, { ...row, fix: 'ok', textSource: 'kcwiki' }, index)
        continue
      }
      stats.divergent += 1
      const slot = parseVoiceKey(row.key).slot
      // ① 重归属：档名的形态码指向别的形态，且那边不判分歧
      const owner = input.codeMap?.get(parseVoiceKey(row.key).code) ?? null
      if (owner != null && owner !== formId) {
        const moved = resolveVoiceSlot(row.key, row.ja, input.subtitleJa?.[`${owner}`] ?? null)
        if (moved.basis !== 'divergent') {
          stats.reattributed += 1
          if (moved.basis === 'key-confirmed') stats.reattributedConfirmed += 1
          push(owner, { ...row, fix: 'reattributed', from: formId, textSource: 'kcwiki' }, index)
          continue
        }
      }
      // ② 重锚定：同一艘舰的别的槽位写着这句话
      const anchored = slot == null ? null : slotWithSameText(hostTable, row.ja, slot)
      if (anchored != null) {
        stats.reanchored += 1
        push(
          formId,
          {
            ...row,
            scene: voiceSceneOfSlot(anchored) || row.scene,
            fix: 'reanchored',
            slot: anchored,
            textSource: 'kcwiki',
          },
          index,
        )
        continue
      }
      const trueJa = slot == null ? '' : `${hostTable?.[`${slot}`] ?? ''}`
      const trueZh = slot == null ? '' : `${input.subtitleZh?.[rawFormId]?.[`${slot}`] ?? ''}`
      // ④-b 字幕包在这一格写的是占位句，不是台词
      if (isSubtitlePlaceholder(trueJa) || isSubtitlePlaceholder(trueZh)) {
        stats.noSubtitle += 1
        push(formId, { ...row, fix: 'no-subtitle', textSource: 'kcwiki' }, index)
        continue
      }
      // ④-a 槽位被季节语音占着（双源取证：字幕包那句的中文 == 该舰某条季节台词）
      const folded = foldVoiceLineForCompare(trueZh)
      if (folded && seasonalZh.get(rawFormId)?.has(folded)) {
        stats.seasonSlot += 1
        push(formId, { ...row, fix: 'season-slot', textSource: 'kcwiki' }, index)
        continue
      }
      // ③ 以音轨为准：真文本 + 社区译文顶上，kcwiki 那句错文本不显示
      if (trueJa.trim() && trueZh.trim() && slot != null) {
        stats.audioText += 1
        push(
          formId,
          {
            key: row.key,
            scene: row.scene,
            ja: trueJa.trim(),
            zh: trueZh.trim(),
            fix: 'audio-text',
            slot,
            textSource: 'subtitle',
          },
          index,
        )
        continue
      }
      stats.noSubtitle += 1
      push(formId, { ...row, fix: 'no-subtitle', textSource: 'kcwiki' }, index)
    }
  }

  const rowsByForm = new Map<number, CorrectedVoiceRow[]>()
  for (const [formId, list] of out) {
    list.sort((left, right) => {
      const leftSlot = left.row.slot ?? parseVoiceKey(left.row.key).slot ?? 9_999
      const rightSlot = right.row.slot ?? parseVoiceKey(right.row.key).slot ?? 9_999
      return leftSlot - rightSlot || left.order - right.order
    })
    rowsByForm.set(
      formId,
      list.map((entry) => entry.row),
    )
  }
  return { rowsByForm, stats }
}

/**
 * 被季节语音占着的槽位：形态 mstId → 槽位集合。
 *
 * 就是上面 ④-a 那一档（`fix: 'season-slot'`）换个索引形状，**判据一个字都没改**
 * ——两个消费面必须是同一份裁决，各写一份必然漂移，而漂移的表现是
 * 「图鉴说这一格不保证、字幕却照打」。
 *
 * 图鉴侧 2026-08-23 的裁决原文：**过季点下去播平时那句、当季播季节那句，
 * 两边都不保证，那就不给**（那边的落法是不给播放钮）。实时字幕沿用同一条：
 * 这些格子不出字幕。字幕比播放钮更不能将就——播放钮点不点在玩家，
 * 字幕是直接打在屏幕上的一句话，错了就是当着人的面说错。
 *
 * ⚠️ 索引按**将要播放的那个形态**建（`push` 落在哪个 formId 就是哪个），
 * 与 `resolveVoiceSlot` 那条「校验必须拿 playbackMstId」的告诫同源：
 * 文本可以沿改装链借，音轨永远按当前形态拼。
 *
 * ⚠️ 这里**不判「现在是不是季节期」**，也不许有人补上去。本仓故意没有当季判定
 * （护栏禁止 `当季.*new Date`）：那要靠日期猜官方换没换文件，猜错就是打错字幕。
 * 判据只有一条——这一格**有没有被占过**的双源实证。
 */
export const seasonOccupiedSlots = (input: VoiceCorrectionInput): Map<number, Set<number>> =>
  seasonOccupiedFrom(planVoiceCorrections(input).rowsByForm)

/**
 * 同上，只是接**已经算好的** `rowsByForm`。
 *
 * 实时字幕要同时拿季节闸与 kcwiki 查表两张表，各调一次 `planVoiceCorrections`
 * 就是把 17434 行分拣跑两遍。拆成「算一次、导两张表」。
 */
export const seasonOccupiedFrom = (
  rowsByForm: Map<number, CorrectedVoiceRow[]>,
): Map<number, Set<number>> => {
  const occupied = new Map<number, Set<number>>()
  for (const [formId, rows] of rowsByForm) {
    for (const row of rows) {
      if (row.fix !== 'season-slot') continue
      const slot = row.slot ?? voiceSlotOfKey(row.key)
      if (slot == null) continue
      const set = occupied.get(formId) ?? new Set<number>()
      set.add(slot)
      occupied.set(formId, set)
    }
  }
  return occupied
}

/** kcwiki 台词按槽位查表的一行：中日两列，取用方自己决定谁优先。 */
export interface KcwikiSlotLine {
  ja: string
  zh: string
}

/**
 * 分拣结果 → 「形态 → 槽位 → kcwiki 台词」查表。
 *
 * 给**实时字幕**用：发行版里 `wikiwiki-voice` 不随包，字幕层实际只剩
 * subtitle-zh/ja 一个源，而主来源 `kcwiki-voice` 早就随包（CC BY-NC-SA，
 * NOTICE 在册）却没接进来。接上之后 subtitle 缺的格由它补。
 *
 * 两条取舍：
 *  · **跳过 `reattributed`**。那一档是「kcwiki 把行归错了形态，分拣把它挪到了
 *    真正的宿主」——能挪成功的前提就是宿主的音轨对得上，而对得上意味着宿主
 *    本来就有 subtitle 表，这一行填不进任何空格。保守起见不收。
 *  · **同槽先到先得**。`rowsByForm` 已按槽位排过序，同一槽位的重复行取第一条，
 *    不做二次挑选——挑选逻辑一旦长在这里，就成了第二份判据。
 *
 * 季节占槽那一档（`season-slot`）**照收不误**：它由调用方的季节闸拦，
 * 不在这里重复设闸（判据一处一份，两处各设一道迟早对不上）。
 */
export const kcwikiSlotIndex = (
  rowsByForm: Map<number, CorrectedVoiceRow[]>,
): Map<number, Map<number, KcwikiSlotLine>> => {
  const index = new Map<number, Map<number, KcwikiSlotLine>>()
  for (const [formId, rows] of rowsByForm) {
    const perSlot = new Map<number, KcwikiSlotLine>()
    for (const row of rows) {
      if (row.fix === 'reattributed') continue
      const slot = row.slot ?? voiceSlotOfKey(row.key)
      if (slot == null || perSlot.has(slot)) continue
      perSlot.set(slot, { ja: `${row.ja ?? ''}`, zh: `${row.zh ?? ''}` })
    }
    if (perSlot.size) index.set(formId, perSlot)
  }
  return index
}

// ============================================================================
// 沿改装链按槽位续填：底层那三个源该各出哪几行
// ============================================================================
//
// ---- 老口径错在哪（2026-08-23 量化）----
// 底层原本是**沿链择一**：对 `tryIds` 逐个形态试 kcwiki → wikiwiki → subtitle，
// **第一个有东西的源命中就 break，后面的一律不看**。命中的那一份大不大不作数——
// 于是两类病：
//  · **小桶挡整页**：kcwiki 桶里只有 1 行也算命中。夕張改二特(623) 的桶正好 1 行，
//    整页就只剩那 1 行，而 subtitle-ja[623] 的 52 格（含 24 条时报）一个字都出不来。
//    同族的还有夕張改二丁(624) 1 行、日進甲(586) 4 行、山風改二(588) 4 行、
//    神鷹改二(536) 5 行、大和改二(911) 5 行、龍鳳改(318) 8 行……
//  · **一源缺一段就整段没有**：wikiwiki 有的形态缺某几个场合，命中它之后
//    subtitle 里那几格也跟着看不见。
// 随包 lodes + 本机 start2 快照实测：862 个我方形态里 173 个受影响，合计 3735 行取不到。
// 反方向也量了：只有 4 个形态的行数会**变少**（大和 −1、平安丸 −2、有明 −1、桃 −1），
// 全是老口径把本形态①层那几条没有槽位的行又推了一遍、页面上本来就重着的。
//
// ---- 新口径：链序即优先序，同一槽位只出一行 ----
// 仍旧逐 id、每个 id 内仍旧 kcwiki → wikiwiki → subtitle，只是把「命中即停」
// 换成「把**还空着的槽位**填上，然后接着往下走」。先到先得，所以越近的前置形态越优先——
// 这正是台词卷函数头那句「三层按槽位叠，同一格只出一行，不做字段级混拼」本来的意思。
//
// ⚠️ 深海不进这条路。深海只有单 id，且它那三个源（subtitle-enemies / kcwiki /
// wikiwiki-abyss）各有各的播放契约（只有 subtitle-enemies 的 key 是完整官方档名，
// 别的都不能拼地址），叠起来没有意义也不安全，仍旧走 `modules/ji` 里那条择一。

export type VoiceFallbackSource = 'kcwiki' | 'wikiwiki' | 'subtitle'

/** wikiwiki 舰娘页转写行。只有日文原文，槽位由页面的「场合」列推出（`voiceId`）。 */
export interface WikiwikiVoiceLine {
  key: string
  voiceId?: number
  scene: string
  ja: string
}

export interface VoiceFallbackPick {
  /** 出这一行文本的形态。不等于当前形态时，就是沿链借来的 */
  id: number
  source: VoiceFallbackSource
  slot: number | null
  key: string
  scene: string
  ja: string
  zh: string
  /** kcwiki 档的原始校正行——渲染要照它的 `fix`/`slot`/`textSource` 判键与角标 */
  row?: CorrectedVoiceRow
}

export interface VoiceFallbackChainInput {
  /** 当前形态。链上等于它的那一级不算「借」 */
  mstId: number
  /** 当前形态 → 最近前置形态 → … → 原型 */
  tryIds: readonly number[]
  /**
   * ①②（本形态校正行 + 自补层）已经占住的槽位。
   * **会被就地补上 ③ 填进去的槽位**——骨架层拿的是同一个集合，
   * 不补进去就会在已经有文本的格上再摆一行骨架。
   */
  covered: Set<number>
  /** ①② 里**算不出槽位**的那些行的日文原文：跨源续填时拿它去重的种子 */
  slotlessJa?: readonly string[]
  /** 某个形态的 kcwiki 校正行（未过滤；`reattributed` 由这里剔） */
  correctedRowsOf: (id: number) => readonly CorrectedVoiceRow[] | undefined
  wikiwikiRowsOf: (id: number) => readonly WikiwikiVoiceLine[] | undefined
  subtitleJaOf: (id: number) => Readonly<Record<string, string>> | undefined
  subtitleZhOf: (id: number) => Readonly<Record<string, string>> | undefined
  /** wikiwiki 只有日文：日文原文 → 既有唯一译文。连不上给空串 */
  zhOfJa?: (ja: string) => string
}

export interface VoiceFallbackPlan {
  picks: VoiceFallbackPick[]
  /** 实际出过行的源，按**首次用到**的先后。页脚要照这一份并列标注，不许只标第一个 */
  sources: VoiceFallbackSource[]
  /** 实际借了文本的前置形态，按链序（不含当前形态） */
  borrowedFrom: number[]
  /** 当前形态自己也出了行（`tryIds` 的第一级） */
  usedOwnForm: boolean
  /**
   * subtitle 档里**没有场合名**的行数。
   * 页脚那句「编号不代表场景」只在它 > 0 时才成立——1–53 全段现在都按对照表补名，
   * 计到这里的只剩表外槽位（54+ 或键不可解析的行）。
   */
  unnamedSubtitleRows: number
}

/**
 * 底层那一句「场合」该写什么。
 *
 * 规矩：**源没给出可读场合名的行，按官方语音编号的实证对照表补上**（1–53 全段）。
 *  · subtitle 档整列场合都是空的（它只有编号）；
 *  · wikiwiki 的时报行场合写的是裸两位数「00」…「23」——那是页面時報表的小时列，
 *    单独摆进「场合」列没人读得懂。实测：裸数字场合**只**出现在 voiceId 30–53，
 *    别处一条都没有，所以这条改写不会碰到任何别的行。
 *  · kcwiki 的行自带「〇〇〇〇时报」这类中文场合名，照原样留着。
 *
 * 演进：08-23 第一版只补时报段（30–53），1–29 留空是当时的谨慎口径；同日用户
 * 实机看到黎塞留整页「#1 #2」点名要触发条件——1–29 的槽位→场合同样出自
 * VOICE_SCENE_SLOTS 实证对照表（每格 112~220 例取值唯一，见文件头），补名与
 * 时报段同一置信度。对照表覆盖不到的槽位（54+ 或键不可解析）仍旧留空、如实计数。
 */
export const voiceFallbackScene = (slot: number | null, rawScene: string): string => {
  const scene = `${rawScene ?? ''}`.trim()
  if (slot == null) return scene
  if (scene && !/^\d{1,2}$/.test(scene)) return scene
  return voiceSceneOfSlot(slot) || scene
}

/**
 * wikiwiki 舰娘页那一支的「场合」列。
 *
 * 那份包**只给日文**（`入手/ログイン`、`母港1 / 詳細`、`建造完了`），而同一张表里
 * kcwiki 的行早就是中文了——一页两种语言并排，且这是场合名不是台词，不在
 * 「台词原文列」的豁免内（2026-08-25 汉化清点）。
 *
 * 中文不新编：槽位查得到就用 `VOICE_SCENE_SLOTS` 那张实证对照表里的中文——
 * 它本来就是 kcwiki 那一列的措辞，两支就此说同一种话。槽位查不到（季节/周年/
 * 活动那些 54+ 或没有 voiceId 的行）**保留原文**，不硬翻。
 */
export const wikiwikiVoiceScene = (slot: number | null, rawScene: string): string =>
  (slot == null ? '' : voiceSceneOfSlot(slot)) || `${rawScene ?? ''}`.trim()

export const planVoiceFallbackChain = (input: VoiceFallbackChainInput): VoiceFallbackPlan => {
  const picks: VoiceFallbackPick[] = []
  const sources: VoiceFallbackSource[] = []
  const borrowedFrom: number[] = []
  let usedOwnForm = false
  let unnamedSubtitleRows = 0

  // ---- 占位：算得出槽位的按槽位占，算不出的按日文折叠占 ----
  //
  // ⚠️ 两道都**只跨组挡，不在组内挡**（一「组」= 一个形态的一个源）。
  // 这一层要解决的是「同一格被链上两级、或被两个源各填一行」，不是替上游删条目：
  //  · wikiwiki 的同一个 voiceId 下本来就可能列着两三条（小破/旗艦大破共用一个音轨、
  //    改装前后两种说法、还有几行转写残留的占位词「セリフ」）。**组内按先到先得砍**
  //    会砍掉真台词而留下占位词——霧島改二 7 号槽正是这样一格，实测第一条就是「セリフ」。
  //  · 无槽位那边同理：「同一句挂在五个周年下」（白雪 5 条、朝霜 4 条）是资料的原样。
  // 这两种在老口径下本来就整组显示，续填不该顺手把它们改掉。
  const seen = new Set<string>()
  for (const ja of input.slotlessJa ?? []) {
    const folded = foldVoiceLineForCompare(ja)
    if (folded) seen.add(folded)
  }
  let pendingSlots: number[] = []
  let pendingFolds: string[] = []
  const claim = (slot: number | null, ja: string): boolean => {
    if (slot != null) {
      if (input.covered.has(slot)) return false
      pendingSlots.push(slot)
      return true
    }
    const folded = foldVoiceLineForCompare(ja)
    if (!folded) return true
    if (seen.has(folded)) return false
    pendingFolds.push(folded)
    return true
  }
  const closeGroup = () => {
    for (const slot of pendingSlots) input.covered.add(slot)
    for (const folded of pendingFolds) seen.add(folded)
    pendingSlots = []
    pendingFolds = []
  }

  for (const id of input.tryIds) {
    const before = picks.length
    const note = (source: VoiceFallbackSource) => {
      if (!sources.includes(source)) sources.push(source)
    }

    // 首选：kcwiki（带场合）。**只认留在自己桶里的行**——归属校正挪进来的那几行
    // 是别的形态的，拿它当回退源等于把别人的话又搬回来（翔鶴改二甲 52→2 那一例）。
    for (const row of input.correctedRowsOf(id) ?? []) {
      if (row.fix === 'reattributed') continue
      const slot = row.slot ?? voiceSlotOfKey(row.key)
      if (!claim(slot, row.ja)) continue
      picks.push({
        id,
        source: 'kcwiki',
        slot,
        key: row.key,
        scene: voiceFallbackScene(slot, row.scene),
        ja: row.ja,
        zh: row.zh,
        row,
      })
      note('kcwiki')
    }
    closeGroup()

    // 次选：wikiwiki 舰娘页（改装阶段列能精确区分形态，但只给日文原文）
    for (const line of input.wikiwikiRowsOf(id) ?? []) {
      const slot = line.voiceId ?? null
      if (!claim(slot, line.ja)) continue
      picks.push({
        id,
        source: 'wikiwiki',
        slot,
        key: line.voiceId == null ? line.key : `${line.voiceId}`,
        scene: wikiwikiVoiceScene(slot, line.scene),
        ja: line.ja,
        zh: input.zhOfJa?.(line.ja) ?? '',
      })
      note('wikiwiki')
    }
    closeGroup()

    // 兜底：poi-plugin-subtitle。它只有编号，没有场合列——1–53 全段按实证对照表补名
    //（08-23 用户实机点名要触发条件，1–29 的谨慎留空同日撤销），表外槽位留空并如实计数。
    const ja = input.subtitleJaOf(id)
    const zh = input.subtitleZhOf(id)
    if (ja || zh) {
      const keys = [...new Set([...Object.keys(zh ?? {}), ...Object.keys(ja ?? {})])].sort(
        (left, right) => parseInt(left, 10) - parseInt(right, 10),
      )
      for (const key of keys) {
        const parsed = parseInt(key, 10)
        const slot = Number.isInteger(parsed) ? parsed : null
        const lineJa = `${ja?.[key] ?? ''}`
        if (!claim(slot, lineJa)) continue
        const scene = voiceFallbackScene(slot, '')
        if (!scene) unnamedSubtitleRows += 1
        picks.push({
          id,
          source: 'subtitle',
          slot,
          key,
          scene,
          ja: lineJa,
          zh: `${zh?.[key] ?? ''}`,
        })
        note('subtitle')
      }
    }
    closeGroup()

    if (picks.length === before) continue
    if (id === input.mstId) usedOwnForm = true
    else borrowedFrom.push(id)
  }

  return { picks, sources, borrowedFrom, usedOwnForm, unnamedSubtitleRows }
}
