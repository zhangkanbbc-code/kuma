// 启动点亮动画的**顺序**、**节拍**与**点火变体**（钥里默认关）。
//
// 这些东西错了不报错：整套四秒多就过去了，肉眼很难当场认出「洗牌把某一格漏掉了」
// 「抖动把两拍抖到同一刻」「所有格闪得一模一样」。所以全做成纯函数放在这里，
// 随机数从外面注入（运行时喂 Math.random，护栏喂定种子伪随机），护栏能不带 DOM
// 直接跑一遍、且结果可断言。
//
// 输入是布局模型的一份快照（各坞此刻真正摆出来几格、坞折没折、是不是专注模式），
// 输出是「谁第几个亮、什么时候亮、亮多久、用哪套点火节奏」。
// 渲染层只负责把这份清单逐个写进行内样式。

/** 坞位 id。与 mu.ts 的 DockId 同集合，这里不 import 是为了让本文件保持零依赖。 */
export type LaunchGlowDockId = 'left' | 'right' | 'bottom'

/**
 * 洗牌**之前**那份候选清单的排法：左坞 → 底坞 → 右坞，坞内按格序号
 * （左右坞纵切成行、底坞横切成列，见 mu.ts 布局总纲与 layoutDock 的铺设顺序，
 * 于是格序号本身就是「左坞从上到下 / 底坞从左到右 / 右坞从上到下」）。
 *
 * 点亮的先后**不**由它决定——那是洗牌的事。它决定的是「同一个随机数流下算出来的
 * 结果永远一样」，护栏靠这个才钉得住。
 */
export const LAUNCH_GLOW_DOCK_ORDER: readonly LaunchGlowDockId[] = ['left', 'bottom', 'right']

/**
 * 各段时长（毫秒）。**实机手调**：2026-08-23 用户实机看过第一版后整体放慢 1.5 倍，
 * 现在这套是放慢后的数。要再调只动这一处，别散到 CSS 里。
 *
 *   leadIn   整屏罩暗之后、第一格亮起之前的停顿（没有它就看不出是「从暗到亮」）
 *   step     相邻两拍的名义间隔（实际还要叠一层抖动，见 LAUNCH_GLOW_JITTER）
 *   fade     每一格自己点火到稳定用多久
 *   gameGap  最后一格**完全亮透**之后，到游戏区开始亮之间的停顿
 *   gameFade 游戏区那层黑罩淡出用多久
 *
 * 默认布局（导航条 + 左1 + 底3 + 右1 = 6 拍）下的名义总长
 *   = leadIn + 5×step + fade + gameGap + gameFade = 390 + 1350 + 840 + 300 + 1500 = 4380ms；
 * 抖动只动各拍的起点，总长因此在 4299~4461ms 之间浮动。
 */
export interface LaunchGlowTiming {
  leadIn: number
  step: number
  fade: number
  gameGap: number
  gameFade: number
}

export const LAUNCH_GLOW_TIMING: LaunchGlowTiming = {
  leadIn: 390,
  step: 270,
  fade: 840,
  gameGap: 300,
  gameFade: 1500,
}

// ---- 第零幕：欢迎返港 ----
//
// 开机的第一屏，排在整屏罩暗**同一刻**出现，盖住整个窗口。它不是装饰：那一刻
// 舰C自己还在黑屏加载（第一次登录、或者被风控要求重新登录时更久），艦素这边的
// 面板也正在装配、缓存正在回填。这一屏把那段空白兑成一句招呼，
// 等到差不多有东西可看了再让位给点亮仪式。
//
// **屏幕上只有一块铭牌**：「欢迎返港，」加提督名，此外一样东西都没有。
// 2026-08-25 用户裁决「大道至简，直接显示一个这个，然后淡出主界面」——上一版还摆了
// 一条进度条，而那条进度条的前 95% 是**演**的（那几件事根本没有百分比可报，硬凑
// 一个只会是假数）。让玩家盯着一条假数看两秒半，不如干脆不给。
//
// 于是「还要等多久」不再被画出来，落幕只由两个条件说了算：
//
//   ① 三件「真就绪」到齐
//        snapshot  快照回放到了渲染层（主进程从账本回放的那份状态；提督名也是这一刻才知道）
//        lode      矿脉装配完成（本地化那几份资料包读完并表）
//        panes     面板首帧（模块都挂上去、浏览器真把第一帧画出来了）
//      到齐＝界面已经有东西可看了。
//   ② 铭牌已经摆满 minShow——本地起得飞快时这一屏会「唰」地闪一下就没了，
//      开机第一屏一闪而过比多等一秒难受。
//
// 两条都满足才落幕，谁后到听谁的。三件里任何一件**失败**也算到齐——这一屏是缓冲
// 不是守卫，为了一件永远不会来的事把玩家钉在欢迎屏上，比少等一步糟得多（另见 cap）。

/**
 * 第零幕各段时长（ms）。**实机手调**，与其余各幕同一处。
 *
 *   minShow  铭牌至少摆多久（从这一层挂上去算起）。三件真事早到也得等满它。
 *            **减少动态效果时照等**——它是功能性缓冲，不是动画。
 *   fade     铭牌淡入、整层淡出各用多久（一进一出对称）
 *   cap      整幕封顶：到点强制落幕，绝不把玩家困在欢迎屏上
 *
 * 正常路径的总长 = max(门开时刻, minShow) + fade ≈ 2.82s，接上第一幕的 4.38s
 * ——并行各幕从第一幕的 litUntil（2.58s 处）起跑，与游戏区那 1.8 秒的淡入叠着走，
 * 所以整场就是 2.82 + 4.38 ≈ 7.2s（除非哪一幕比 1.8 秒还长），舰C进母港的量级。
 *
 * **cap 必须明显早于 renderer/launch-glow.ts 的 ARM_CAP_MS（12s）**：第一幕在
 * 第零幕落幕之后才点火，两只看门狗要是同刻到点，就会变成「仪式先被自己的看门狗
 * 收掉，接着才轮到点火」——表现是整场动画一次都不放。这条先后有行为护栏钉着
 * （test/launch-glow「两只看门狗的先后」）。
 */
export interface LaunchWelcomeTiming {
  minShow: number
  fade: number
  cap: number
}

export const LAUNCH_WELCOME_TIMING: LaunchWelcomeTiming = {
  minShow: 2400,
  fade: 420,
  cap: 9000,
}

/**
 * 兜底宽限与封顶（ms）。**渲染层骨架里的毫秒数全在这一张表上**——
 * 那个文件自称「时长口径的单一出处是 shared」，可它自己散着四个字面量，
 * 说的和做的对不上（护栏钉着：骨架里不许再出现毫秒常量声明）。
 *
 *   watchdogSlack     动画本该收尾了、animationend 却没来时再等多久。
 *                     坞在动画期间被重铺、元素被别的规则盖掉动画名、面板被真重渲
 *                     整片换掉——这几条路上它是唯一的收尾人。
 *   armCap            「罩暗了却始终没人来 run」的封顶。正常路径上 index.ts 必定
 *                     调 run 或 cancel，但那条路上排着内核初始化、本地化、各模块装配，
 *                     任一步以没被 try 住的方式抛出来，仪式态就会一直挂着。
 *                     **必须明显晚于第零幕的 cap**（判据见 LaunchWelcomeTiming）。
 *   overlaySlack      顶栏浮层入场的兜底：浮层被关掉、内容被重渲换走时 animationend
 *                     不会来。它比仪式那几只小一个量级——浮层总长本来就 ≤300ms。
 *   welcomeFadeSlack  第零幕淡出的兜底（窗口被最小化、动画名被别的规则盖掉）。
 */
export interface LaunchGuardTiming {
  watchdogSlack: number
  armCap: number
  overlaySlack: number
  welcomeFadeSlack: number
}

export const LAUNCH_GUARD_TIMING: LaunchGuardTiming = {
  watchdogSlack: 1500,
  armCap: 12000,
  overlaySlack: 400,
  welcomeFadeSlack: 300,
}

/** 三件「真就绪」。缺一不开门；顺序无所谓，谁先到都行。 */
export const LAUNCH_WELCOME_SIGNALS = ['snapshot', 'lode', 'panes'] as const
export type LaunchWelcomeSignal = (typeof LAUNCH_WELCOME_SIGNALS)[number]

/** 门开了没有：三件齐了才算。不认识的信号一律不影响判定。 */
export const launchWelcomeGateOpen = (done: Iterable<string>): boolean => {
  const seen = new Set(done)
  return LAUNCH_WELCOME_SIGNALS.every((signal) => seen.has(signal))
}

/**
 * 门在 openedAt（ms，从这一层挂上去算起）开的话，铭牌几时开始淡出。
 *
 * 取 `max(openedAt, minShow)`——「三件到齐」与「摆满 minShow」两个条件里，
 * **谁后到听谁的**。门开得早（本地起得飞快）也得摆满最短展示，门开得晚就一直等门，
 * 等到为止（封顶另有看门狗）。落幕之后还要再加一个 fade 才算这一幕演完。
 */
export const launchWelcomeLeaveAt = (
  openedAt: number,
  timing: LaunchWelcomeTiming = LAUNCH_WELCOME_TIMING,
): number => Math.max(openedAt, timing.minShow)

/** 提督名取不到时的称呼。玩家可见文案，改这里就是改屏幕上那一块。 */
export const LAUNCH_WELCOME_FALLBACK = '提督'

/**
 * 铭牌上那个称呼：拿得到提督名就用它，拿不到（没登录过、快照里那一格是空的、
 * 或者干脆不是个字符串）退回「提督」。
 *
 * 全角空格也算空——快照里存的是玩家在游戏里起的名字，中间可能只有空白。
 */
export const launchWelcomeName = (nickname: unknown): string => {
  if (typeof nickname !== 'string') return LAUNCH_WELCOME_FALLBACK
  const trimmed = nickname.replace(/[\s　]+/gu, ' ').trim()
  return trimmed || LAUNCH_WELCOME_FALLBACK
}

/**
 * 玩家可见文案（铭牌左半）。右半是提督名——两段分字号分色，各写各的 textContent，
 * 拼起来仍是一整句话，见 launchWelcomeGreeting。
 */
export const LAUNCH_WELCOME_LEAD = '欢迎返港，'

/**
 * 铭牌上那一整句（左半 + 提督名）。屏幕上它是**分成两段**写进 DOM 的，
 * 这个函数给的是「连起来读是什么」——护栏拿它对账，也是这一族文案的单一出处。
 * 两段都走 textContent，不经任何 HTML 拼接。
 */
export const launchWelcomeGreeting = (nickname: unknown): string =>
  `${LAUNCH_WELCOME_LEAD}${launchWelcomeName(nickname)}`

/** 玩家可见文案（最底一行小字）。 */
export const LAUNCH_WELCOME_SKIP_HINT = '点击跳过动画（也可在设置关闭）'

/**
 * 每一拍起点的随机抖动幅度，按 step 的比例算（±30%）。
 *
 * 要的是「机台此起彼伏」而不是节拍器。**上限卡在 50% 以下是硬要求**：
 * 相邻两拍最坏情况（前一拍 +30%、后一拍 −30%）仍隔着 step×0.4，
 * 于是先后次序永远不会被抖乱——「顺次点亮」这件事本身不能被抖没。
 */
export const LAUNCH_GLOW_JITTER = 0.3

/** 开关的配置键与默认值。config.ts / 钥 / 镇壳都引这一份，别各写各的字面量。 */
export const LAUNCH_GLOW_CONFIG_KEY = 'kanso.launchGlow'
export const LAUNCH_GLOW_DEFAULT = true

/**
 * 点火节奏的三个变体。渲染层拼成 `kanso-glow-<代号>` 当 keyframes 名字用，
 * 关键帧本体在 index.html（三套不同的明暗节奏，都只动 opacity）。
 *
 * 幅度纪律写在关键帧里、由护栏逐条实算（test/launch-glow「点火关键帧」那几条）：
 * 明暗切换只在相邻 3~5% 的微斜坡里发生、首燃后不跌破 .35、每个暗谷比前一个浅。
 * 2026-08-23 用户实机定的——上一版零毫秒硬跳「闪的有点闪眼睛」。
 */
export type LaunchGlowVariant = 'a' | 'b' | 'c'
export const LAUNCH_GLOW_VARIANTS: readonly LaunchGlowVariant[] = ['a', 'b', 'c']

/** 游戏区那层罩单独一档：整块画面硬闪太刺眼，它只做两段很轻的脉冲再放亮。 */
export type LaunchGlowKeyframe = LaunchGlowVariant | 'game'

/** 一个坞此刻的样子。cells = 真正摆出来的格数（搁置/隐藏的模块已经不算在内）。 */
export interface LaunchGlowDockState {
  dock: LaunchGlowDockId
  cells: number
  collapsed: boolean
}

export interface LaunchGlowLayout {
  docks: LaunchGlowDockState[]
  /** 专注模式：三坞全收，只剩导航条与游戏 */
  focus: boolean
}

export type LaunchGlowTarget =
  | { kind: 'rail' }
  | { kind: 'cell'; dock: LaunchGlowDockId; index: number }
  | { kind: 'game' }

export interface LaunchGlowStep {
  target: LaunchGlowTarget
  /** 第几个亮，0 起 */
  order: number
  /** 从动画开始算起的延时（ms），已经叠过抖动 */
  delay: number
  /** 这一步自己的时长（ms） */
  duration: number
  /** 用哪套关键帧 */
  variant: LaunchGlowKeyframe
}

/** 注入进来的随机数源：约定同 Math.random，[0, 1)。 */
export type LaunchGlowRng = () => number

// rng 返回 1（有些实现会）时 Math.floor 会越界，一律夹住——
// 越界的表现是某一格被漏掉或者重复点两次，而那正是最难被看出来的一类。
const pickIndex = (rng: LaunchGlowRng, length: number): number =>
  Math.min(length - 1, Math.max(0, Math.floor(rng() * length)))

/** Fisher–Yates。原地打乱一份拷贝，输入不动。 */
const shuffled = <T>(items: readonly T[], rng: LaunchGlowRng): T[] => {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = pickIndex(rng, i + 1)
    const swap = out[i]
    out[i] = out[j]
    out[j] = swap
  }
  return out
}

/**
 * 挑一套点火节奏，**不许与上一格相同**。
 *
 * 纯随机也能出花样，但六格里全撞成同一套的概率有百分之一点几，而那一次看上去
 * 就是「所有格闪得一模一样」——用户要的正是别这样。排掉上一格就把这条堵死了，
 * 代价只是每一步的候选从 3 个变成 2 个。
 */
const pickVariant = (rng: LaunchGlowRng, previous: LaunchGlowVariant | null): LaunchGlowVariant => {
  const pool = previous
    ? LAUNCH_GLOW_VARIANTS.filter((variant) => variant !== previous)
    : LAUNCH_GLOW_VARIANTS
  return pool[pickIndex(rng, pool.length)]
}

/**
 * 点亮序列：导航条与各格**一起进洗牌池**，随机排序；游戏永远最后。
 *
 * 三条判据：
 *   · **看不见的不占拍**——折叠的坞、空坞、专注模式下的三坞一律不进池子。
 *     用户原话是「顺次点亮各个**已经展开**的模块」；给看不见的东西留一拍，
 *     表现是中途莫名停顿一下。
 *   · **每个能看见的东西恰好亮一次**——洗牌只换次序，不增不减。
 *   · **游戏永远最后**，且要等最后一格**亮透**（delay + duration 的最大值）
 *     再等 gameGap 才开始亮，这样「面板都就位了，最后才轮到主屏」才成立。
 *     取最大值而不是取最后一拍：抖动虽然保证不了乱序（见 LAUNCH_GLOW_JITTER），
 *     但判据写成「最后一个结束的」才是这句话本来的意思。
 *
 * @param rng 随机数源。运行时喂 Math.random，护栏喂定种子伪随机。
 *   消耗次序是**判据的一部分**（每一拍先抖动、后变体），改了它定种子的护栏会当场红。
 */
export const launchGlowSequence = (
  layout: LaunchGlowLayout,
  rng: LaunchGlowRng = Math.random,
  timing: LaunchGlowTiming = LAUNCH_GLOW_TIMING,
): LaunchGlowStep[] => {
  const pool: LaunchGlowTarget[] = [{ kind: 'rail' }]
  for (const dock of LAUNCH_GLOW_DOCK_ORDER) {
    const state = layout.docks.find((entry) => entry.dock === dock)
    if (!state || layout.focus || state.collapsed) continue
    const cells = Math.max(0, Math.floor(state.cells))
    for (let index = 0; index < cells; index++) pool.push({ kind: 'cell', dock, index })
  }

  let previous: LaunchGlowVariant | null = null
  const steps: LaunchGlowStep[] = shuffled(pool, rng).map((target, order) => {
    const jitter = (rng() * 2 - 1) * timing.step * LAUNCH_GLOW_JITTER
    const variant = pickVariant(rng, previous)
    previous = variant
    return {
      target,
      order,
      delay: Math.round(timing.leadIn + order * timing.step + jitter),
      duration: timing.fade,
      variant,
    }
  })

  const litUntil = launchGlowLitUntilMs(steps)
  steps.push({
    target: { kind: 'game' },
    order: steps.length,
    delay: litUntil + timing.gameGap,
    duration: timing.gameFade,
    variant: 'game',
  })
  return steps
}

/**
 * 最后一格**完全亮透**的那一刻（ms）。游戏区从这儿再等 gameGap 才开始淡入。
 *
 * 它同时是**并行各幕接手的信号**：各幕从这一刻起与游戏区的淡入**并行**跑，
 * 游戏区照旧最后一个完成。等游戏区那层黑罩淡完再开演的话，格子都亮透了、
 * 面板里还要空一秒八（gameGap 300 + gameFade 1500 = 1.8 秒）。
 *
 * 取 delay + duration 的最大值而不是最后一拍：抖动保证不了乱序（见 LAUNCH_GLOW_JITTER），
 * 「最后一个结束的」才是这句话本来的意思。**游戏那一步自己不算**——它排在这之后。
 */
export const launchGlowLitUntilMs = (steps: readonly LaunchGlowStep[]): number =>
  steps.reduce(
    (max, step) => (step.target.kind === 'game' ? max : Math.max(max, step.delay + step.duration)),
    0,
  )

/** 整套动画从头到尾多久（ms）。看门狗的封顶时间按它算。 */
export const launchGlowTotalMs = (steps: readonly LaunchGlowStep[]): number =>
  steps.reduce((max, step) => Math.max(max, step.delay + step.duration), 0)

// ---- 错峰入场：一套排程，三幕共用 ----
//
// 第一幕的最后一格**亮透**之后（不是等游戏区淡完，见 launchGlowLitUntilMs），
// 几个面板各演各的入场，与游戏区那 1.8 秒的淡入并行跑。三幕形态不同、
// 排程却是同一套：可选先盖一层扫过的罩，然后**一批元素按视觉顺序逐个进场**。
//   · 锐（编队）  = 加载光带 + 舰娘行一排排落位
//   · 镝（战斗）  = 扫描线 + 左右两栏相向合拢
//   · 铎（活动）  = 无罩，各块自上而下垂幕展开
// 所以只有一份 plan 函数、三份参数；加第四幕只要再加一份参数。
//
// 时序做成纯函数放这儿，是因为它有一条**看不出来**的规矩：元素数不定
// （单舰队 6 行、联合 12 行；镝的分区随战斗阶段多寡不同），等间隔错峰在数量多时
// 会把一幕拖成好几秒。压缩规则错了不报错，只是某些局面下拖得莫名其妙长。

/**
 * 一幕错峰入场的各段时长（ms）。**实机手调**，与其余各幕同一处。
 *
 *   loading    开演前那层罩（光带/扫描线）扫完用多久；**0 = 这一幕不带罩**
 *   handoff    罩退场到第一个元素进场之间的停顿
 *   row        单个元素的进场动画时长
 *   step       相邻两个元素的错峰间隔（元素少时就用它）
 *   stepBudget **错峰总预算**：元素多时按它压缩 step，别让 24 行拖成四秒
 *   minStep    压缩下限，再多也不至于挤成同时出现
 */
export interface LaunchStaggerTiming {
  loading: number
  handoff: number
  row: number
  step: number
  stepBudget: number
  minStep: number
}

/**
 * 锐 · 编队入场：加载光带 + 舰娘行一排排落位。
 * 典型总长：6 行（单舰队）1530ms、12 行（联合）≈1800ms、24 行 ≈1810ms、
 * 0 行（还没数据 / 停在基地航空队页）就只有 loading 的 520ms。
 */
export const LAUNCH_ROSTER_TIMING: LaunchStaggerTiming = {
  loading: 520,
  handoff: 90,
  row: 320,
  step: 120,
  stepBudget: 900,
  minStep: 34,
}

/**
 * 镝 · 战术屏开机：扫描线横扫，随后左右两栏相向合拢。
 * 分区数随战斗阶段多寡浮动（常见 6~12 块）：6 块 1425ms、11 块 1600ms。
 * 待机/空态只有一条扫描线的 480ms——不硬造分区。
 */
export const LAUNCH_BATTLE_TIMING: LaunchStaggerTiming = {
  loading: 480,
  handoff: 80,
  row: 340,
  step: 105,
  stepBudget: 700,
  minStep: 40,
}

/**
 * 铎 · 作战公告揭幕：自上而下逐块垂下。**不带罩**（loading = 0）——
 * 公告的气质是「一段段展开」，先蒙一层反而多此一举。
 * 典型 9 块 1250ms、5 块 970ms。
 */
export const LAUNCH_BRIEF_TIMING: LaunchStaggerTiming = {
  loading: 0,
  handoff: 90,
  row: 360,
  step: 130,
  stepBudget: 800,
  minStep: 45,
}

/**
 * 鉴 · 开卷：书架按对角线波纹一格格点起来。不带罩（点灯本身就是那一下）。
 * 元素数封顶 LAUNCH_STAGE_ITEM_CAP，所以最长就是满 24 格的 1257ms。
 */
export const LAUNCH_TOME_TIMING: LaunchStaggerTiming = {
  loading: 0,
  handoff: 60,
  row: 300,
  step: 55,
  stepBudget: 900,
  minStep: 26,
}

/**
 * 钦 · 军令下达：任务行从左侧一条条推进来。与锐的纵向错峰形成横纵对照，
 * 所以节拍比锐更紧（命令是「一条接一条」，不是「一层层落位」）。
 * 24 行 1152ms、12 行 865ms。
 */
export const LAUNCH_ORDER_TIMING: LaunchStaggerTiming = {
  loading: 0,
  handoff: 70,
  row: 300,
  step: 45,
  stepBudget: 800,
  minStep: 22,
}

/**
 * 镖 · 出航调度：总表行自上而下**快速**逐行点亮（调度板刷新的利落劲，
 * 比锐更快更密），右栏详情作为最后一个元素随后整块现身。
 * 24 行 1010ms。
 */
export const LAUNCH_DISPATCH_TIMING: LaunchStaggerTiming = {
  loading: 0,
  handoff: 60,
  row: 260,
  step: 38,
  stepBudget: 700,
  minStep: 20,
}

/**
 * 锱 · 资源盘通电：磁贴一块块亮起，右栏各卡跟着推上来。
 *
 * 它和顶栏角标一样**不按自己的节奏收尾**，而是对齐资源数字那一幕的共同终点：
 * 数字就住在磁贴里，磁贴自己先落定、数字还在滚，或者反过来，都读不成
 * 「一台仪表同时完成自检」。所以 row/step 只决定「每块亮多久、块间隔多远」，
 * 起跑时刻从终点倒推（见 launchStaggerPlan 的 endAt）。
 *
 * 真机上的元素数是 8 块磁贴 + 右栏五到七张卡，倒推塞得下（六位数时终点 1110ms）。
 */
export const LAUNCH_ZI_TIMING: LaunchStaggerTiming = {
  loading: 0,
  handoff: 70,
  row: 290,
  step: 60,
  stepBudget: 760,
  minStep: 26,
}

/**
 * 顶栏非资源角标（远/渠/建/演/库）· 逐组点亮。
 *
 * 它**不按自己的节奏收尾**，而是对齐资源数字那一幕的共同终点（见 launchStaggerPlan
 * 的 endAt）——整条顶栏要读成「同一台仪表同刻完成自检」，一半先停一半还在动就散了。
 * 所以这里的 row/step 只决定「每组亮多久、组间隔多远」，起跑时刻是从终点倒推的。
 */
export const LAUNCH_BADGE_TIMING: LaunchStaggerTiming = {
  loading: 0,
  handoff: 0,
  row: 300,
  step: 120,
  stepBudget: 700,
  minStep: 40,
}

/**
 * 一幕里最多让多少个元素各自动画。
 *
 * 图鉴的落地页可能是几百格的大网格，逐格铺动画＝几百个合成层，那不是仪式是卡顿。
 * 超出上限的部分**不打标记**，于是随所在容器一起现身——「其余跟着所在区块整体现身」。
 * 这个退化本身有护栏钉着（与选择器失配那条同一族：仪式照走、内容照现，只是少了动画）。
 */
export const LAUNCH_STAGE_ITEM_CAP = 24

// ---- 顶栏浮层（铃/史/钥）· 打开时的入场 ----
//
// 与仪式各幕**不是一回事**，但归同一个 `kanso.launchGlow` 开关管（一个实验开关管
// 整个动画家族）。差别全在约束上：浮层是玩游戏时高频开合的东西，
//   · 总长必须 ≤300ms——慢一点就成了「每次点开都要等一下」，那是负体验；
//   · 关闭保持瞬时，不做退场（要关的时候人已经不看它了）；
//   · 三家共用同一段，不给每家做专属性格（那是过度设计）。
// 面板本体的淡入 + 位移是**样式表里早就有的过渡**（.ov-panel，150ms + 7px），
// 与这个开关无关、开关关掉也照常有；这里加的只是内容区那一层很快的微错峰。

export interface LaunchOverlayTiming {
  /** 第一块比面板晚多久开始 */
  blockStart: number
  /** 块之间的错峰 */
  blockStep: number
  /** 单块时长 */
  blockRow: number
  /** 最多让几块各自动画——再多就超预算了，其余随面板一起现身 */
  blockCap: number
  /** 整段封顶：超过这个数就不叫「轻快」了（护栏实算） */
  cap: number
}

export const LAUNCH_OVERLAY_TIMING: LaunchOverlayTiming = {
  blockStart: 40,
  blockStep: 36,
  blockRow: 140,
  blockCap: 4,
  cap: 300,
}

export interface LaunchOverlayPlan {
  blocks: { index: number; delay: number; duration: number }[]
  /** 整段多久放完。0 = 没块可演（调用方据此什么都不做） */
  total: number
}

/** 浮层内容块的入场时序。块数超过 blockCap 的部分不参与——它们随面板一起现身。 */
export const launchOverlayPlan = (
  blockCount: number,
  timing: LaunchOverlayTiming = LAUNCH_OVERLAY_TIMING,
): LaunchOverlayPlan => {
  const count = Math.min(Math.max(0, Math.floor(blockCount)), timing.blockCap)
  const blocks = Array.from({ length: count }, (_unused, index) => ({
    index,
    delay: timing.blockStart + index * timing.blockStep,
    duration: timing.blockRow,
  }))
  const last = blocks[count - 1]
  return { blocks, total: last ? last.delay + last.duration : 0 }
}

/** 一个元素在宿主里的位置（只取排序要用的那几个数，好脱开 DOM 测）。 */
export interface LaunchRect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * 对角线波纹的名次：元素中心在宿主里的归一化 x + y。
 *
 * 归一化是必须的——面板往往宽远大于高，拿原始像素相加的话，纵向的先后几乎不起作用，
 * 波纹就退化成「从左到右」，跟锐的纵列、铎的垂落又撞了。
 */
export const rippleRank = (rect: LaunchRect, host: LaunchRect): number =>
  (rect.left + rect.width / 2 - host.left) / Math.max(1, host.width) +
  (rect.top + rect.height / 2 - host.top) / Math.max(1, host.height)

/**
 * 按对角线波纹（左上 → 右下）排序。同一条反对角线上的格子名次相同，
 * **保持原来的文档顺序**（稳定排序）——同一拍里谁先谁后无所谓，但结果必须可复现。
 */
export const rippleOrder = <T>(
  items: readonly T[],
  rectOf: (item: T) => LaunchRect,
  host: LaunchRect,
): T[] =>
  items
    .map((item, index) => ({ item, index, rank: rippleRank(rectOf(item), host) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.item)

export interface LaunchStaggerRow {
  index: number
  delay: number
  duration: number
}

export interface LaunchStaggerPlan {
  /** 罩扫完用多久（0 = 这一幕不带罩），从这一幕开演算起 */
  loading: number
  /** 这一次实际用的错峰间隔——元素多时它比 timing.step 小 */
  step: number
  rows: LaunchStaggerRow[]
  /** 这一幕从头到尾多久。**0 = 没得演**（既没有罩、也没有元素），调用方据此跳过 */
  total: number
}

/**
 * 这一次的错峰间隔：名义 `step`，但整段错峰不许超过 `stepBudget`。
 *
 * **`minStep` 赢过预算**：压到下限还装不下时，宁可让整段多花几百毫秒，
 * 也不要把行挤成「同时冒出来」——那就不是一排排进场了。这条只在 27 行以上才碰得到，
 * 而实际能出现的最多是 12 行（联合舰队 6+6；沙盘 SANDBOX_CAP 也是 6），
 * 也就是说真机上永远是预算说了算。
 *
 * 行数 ≤ 1 时没有错峰可言，返回名义值（调用方也用不上）。
 */
export const launchStaggerStep = (
  rowCount: number,
  timing: LaunchStaggerTiming = LAUNCH_ROSTER_TIMING,
): number => {
  if (rowCount <= 1) return timing.step
  const fitted = Math.floor(timing.stepBudget / (rowCount - 1))
  return Math.max(timing.minStep, Math.min(timing.step, fitted))
}

/**
 * 错峰入场的时序：罩扫完之后，各元素按**调用方给的顺序**依次进场。
 *
 * `rowCount` 是此刻真的摆在面板上的元素数——顺序由接线层排好（编队按 DOM 顺序
 * 就是从上到下；镝要把左右两栏交错成相向合拢；铎要把两列并成自上而下），
 * 这里只管「第几个什么时候动」。
 *
 * 一个元素都没有时不硬造：带罩的幕（锐/镝）只演那一下罩——面板可能还在等数据；
 * 不带罩的幕（铎）就返回 total = 0，调用方据此整幕跳过。
 */
export const launchStaggerPlan = (
  rowCount: number,
  timing: LaunchStaggerTiming = LAUNCH_ROSTER_TIMING,
  endAt = 0,
): LaunchStaggerPlan => {
  const count = Math.max(0, Math.floor(rowCount))
  const step = launchStaggerStep(count, timing)
  // 对齐模式：最后一个元素**恰好在 endAt 落定**，其余从那儿往回倒排。
  // 用在顶栏角标上——它要和资源数字在同一刻完成自检（口径见 LAUNCH_BADGE_TIMING）。
  // 倒推可能算出负的起跑时刻（元素太多、终点太近），夹到 0：宁可开头几个挤在一起，
  // 也不能让整幕比约定的终点晚收。
  if (endAt > 0 && count > 0) {
    const rows: LaunchStaggerRow[] = Array.from({ length: count }, (_unused, index) => ({
      index,
      delay: Math.max(0, Math.round(endAt - timing.row - (count - 1 - index) * step)),
      duration: timing.row,
    }))
    return { loading: 0, step, rows, total: rows[count - 1].delay + timing.row }
  }
  const rows: LaunchStaggerRow[] = Array.from({ length: count }, (_unused, index) => ({
    index,
    delay: timing.loading + timing.handoff + index * step,
    duration: timing.row,
  }))
  const last = rows[rows.length - 1]
  return { loading: timing.loading, step, rows, total: last ? last.delay + last.duration : timing.loading }
}

// ---- 第三幕：资源数字的仪表自检 ----
//
// 与第二幕**并行**上演（各演各的，仪式总长不被拉长）：锱面板里的各项资源持有数、
// 以及顶栏那一排资源数字，先每一位独立乱滚，再**从个位向高位逐位锁定**成真实值。
//
// 排程的要害在「同时结束」：位数各不相同（燃料六位、改修资材两位、顶栏还带 k 后缀），
// 若各自从个位起跑，短的先收工、长的还在滚，看着就是一盘散沙。所以时刻表从**共同终点
// T_end 倒排**——每个数字的最高位都落在 T_end，个位落在 T_end −(位数−1)×步长，
// 位数长的更早开始锁。视觉上仍是「从个位向高位逐位停」，但所有数字齐收。
//
// 做成纯函数放这儿的理由和前两幕一样：位序反了、或者某一位提前锁定，实机上一闪而过
// 根本认不出来；而字符串层面它完全可测（连随机数都是注入的）。

/**
 * 第三幕各段时长（ms）。**实机手调**，与前两幕同一处。
 *
 *   scramble  全体乱滚、**任何一位都还没锁**的时长（也就是最长那个数字的个位何时开始锁）
 *   lockStep  相邻两位的锁定间隔（从个位往高位）
 *   settle    共同终点之后再留一拍，收个尾
 *   tick      共享 interval 的节拍——**一个 interval 驱动全部数字**，不做每个数字一只表
 *
 * 六位数（燃料/弹药这种）时 T_end = 560 + 5×110 = 1110ms、整幕 1290ms。
 */
export interface LaunchDigitsTiming {
  scramble: number
  lockStep: number
  settle: number
  tick: number
}

export const LAUNCH_DIGITS_TIMING: LaunchDigitsTiming = {
  scramble: 560,
  lockStep: 110,
  settle: 180,
  tick: 50,
}

export interface LaunchDigitsPlan {
  /** 共同终点：所有数字的**最高位**都在这一刻锁定，不论它有几位 */
  end: number
  /** 整幕总长（终点之后还留一拍 settle） */
  total: number
  /** 逐个数字的时刻表：`locks[k][i]` = 第 k 个数字第 i 位（**0 = 个位**）的锁定时刻 */
  locks: number[][]
}

/** 一串已经格式化好的数字里有几位数字字符（千分位逗号、k 后缀都不算）。 */
export const digitCountOf = (text: string): number => {
  let count = 0
  for (const char of text) if (char >= '0' && char <= '9') count += 1
  return count
}

/**
 * 按位数集合排出时刻表。传进来的是**每个数字各有几位**，顺序与调用方手上的元素一一对应。
 *
 * 一个数字都没有（锱没展开、顶栏还没同步出数字）时给出零长的一幕，调用方据此直接收场。
 */
export const launchDigitsPlan = (
  digitCounts: readonly number[],
  timing: LaunchDigitsTiming = LAUNCH_DIGITS_TIMING,
): LaunchDigitsPlan => {
  const counts = digitCounts.map((count) => Math.max(0, Math.floor(count)))
  const widest = counts.reduce((max, count) => Math.max(max, count), 0)
  if (!widest) return { end: 0, total: 0, locks: counts.map(() => []) }
  const end = timing.scramble + (widest - 1) * timing.lockStep
  return {
    end,
    total: end + timing.settle,
    // 第 i 位（0=个位）离最高位还有 (count-1-i) 步，于是从 end 往回倒排
    locks: counts.map((count) =>
      Array.from({ length: count }, (_unused, i) => end - (count - 1 - i) * timing.lockStep),
    ),
  }
}

/**
 * 某一刻这串数字该显示成什么样：已经锁定的位显示真值，还没锁的位显示随机字形。
 *
 * **非数字字符原样不动**——千分位逗号、`k` 后缀、`—` 空态都在原位，所以字符串长度
 * 与分隔符位置全程不变，配上等宽/tabular-nums 就不会有抖动或重排。
 *
 * `end` 必须是同一幕里所有数字共用的那一个（launchDigitsPlan 给的），
 * 各自算各自的就又散了。
 *
 * 乱滚期间随机字形**可能撞上真值**，不去规避：多花的复杂度换不来任何可感知的收益。
 */
export const scrambleDigits = (
  text: string,
  elapsed: number,
  end: number,
  timing: LaunchDigitsTiming = LAUNCH_DIGITS_TIMING,
  rng: LaunchGlowRng = Math.random,
): string => {
  const count = digitCountOf(text)
  if (!count) return text
  const chars = [...text]
  let place = 0 // 从右往左数到第几位数字（0 = 个位）
  for (let at = chars.length - 1; at >= 0; at--) {
    const char = chars[at]
    if (char < '0' || char > '9') continue
    const lockAt = end - (count - 1 - place) * timing.lockStep
    if (elapsed < lockAt) chars[at] = `${pickIndex(rng, 10)}`
    place += 1
  }
  return chars.join('')
}
