// 启动点亮（钥里默认关）。整场由一个 `kanso.launchGlow` 开关管着。
//
//  **第零幕 · 欢迎返港**（armLaunchWelcome）：整屏罩暗的同一刻盖上一层全屏欢迎屏
//    （正中一块铭牌 + 最底一行跳过提示），把舰C黑屏加载、面板装配、缓存回填那段
//    空白等过去。它落幕之后第一幕才点火。**与第一幕分开成两个把手**是因为两者的
//    存废条件不同：系统要求减少动态效果时第一幕整场不放，而欢迎屏照挂——它是
//    功能性的缓冲，不是动画（淡入淡出改硬切，但那段等待照等）。
//  **第一幕 · 合闸**（本文件写死）：应用起来的那一刻整屏罩暗，随后像指挥台合闸一样
//    一格一格「点火」亮起——周期表导航条与各坞的格子一起进洗牌池，**每次启动顺序都不同**，
//    最后才轮到主游戏。
//  **其余各幕 · 并行**：第一幕的**最后一格亮透**那一刻，各面板各演各的入场——
//    与游戏区那层黑罩的淡入**并排跑**，游戏区照旧最后一个完成（2026-08-26 用户实机：
//    各幕原先要等黑罩淡完才开演，尾巴上那 1.8 秒「确实有点空」）。
//    它们**不写死在这里**，而是由镇壳注册进来（见下面的 LaunchStage）：
//      锐 编队一排排落位 · 镝 战术屏扫描线 + 左右相向合拢 ·
//      铎 作战公告自上而下垂下 · 锱与顶栏 资源数字仪表自检
//    加第五幕的成本＝**一条注册 + 一段关键帧 + 一条预隐规则**，本文件一个字不用改。
//
// 顺序、抖动、点火变体与各幕的时长口径全在 shared/launch-glow.ts（纯函数，护栏钉着它），
// 这边只负责把算出来的清单逐个写进行内样式。
//
// 四条自我约束，改这个文件前先读：
//
//  ① **关掉时零注入**：一个类、一个节点都不加。所以开关与 prefers-reduced-motion
//     的判断都排在最前面，读 DOM 都在它们之后。
//  ② **只动 opacity / transform**：坞位与游戏区走 opacity（关键帧成对撑出平台，
//     切换只在几十毫秒的微斜坡里发生，出灯管点火的味道又不闪眼睛），各幕的元素
//     走 opacity + translate。**不用 filter**——尤其不许给游戏 webview 上滤镜，
//     那是整块画面逐帧重新光栅化。错峰交给 CSS animation-delay，JS 从头到尾只跑
//     「打标记 → 逐元素写行内动画名/延时/时长 → 等结束 → 清干净」一趟，没有 rAF 循环。
//     唯一的例外是资源数字：文本乱滚没法纯 CSS，用**一只共享 interval**，锁完即停。
//  ③ **不留痕**：放完（或用户点了一下、或看门狗到点）就把类、data 标记、所有行内
//     动画属性和自建罩层全部撤掉，不留常驻合成层，也不留监听器。
//  ④ **不碰模块输出**：标记只加在挂载后的真实 DOM 上，一个字都不进模块的 HTML
//     输出管线——被动重渲的逐字节闸门要拿那份输出做比较。模块真重渲时我们这边必然
//     被推平，那就**体面收场**：不重挂、不装 MutationObserver、不跟渲染器抢，
//     新 DOM 本来就是终态。
import {
  LAUNCH_DIGITS_TIMING,
  LAUNCH_GLOW_TIMING,
  LAUNCH_GUARD_TIMING,
  LAUNCH_OVERLAY_TIMING,
  LAUNCH_WELCOME_LEAD,
  LAUNCH_WELCOME_SKIP_HINT,
  LAUNCH_WELCOME_TIMING,
  digitCountOf,
  launchDigitsPlan,
  launchGlowLitUntilMs,
  launchGlowSequence,
  launchGlowTotalMs,
  launchOverlayPlan,
  launchStaggerPlan,
  launchWelcomeGateOpen,
  launchWelcomeLeaveAt,
  launchWelcomeName,
  scrambleDigits,
  type LaunchGlowLayout,
  type LaunchGlowTarget,
  type LaunchStaggerTiming,
  type LaunchWelcomeSignal,
} from '../shared/launch-glow'

const ARMED_CLASS = 'kanso-glow'
const RUN_CLASS = 'kanso-glow-run'
const VEIL_ID = 'game-glow'
const WELCOME_ID = 'kanso-welcome'
const WELCOME_OUT_CLASS = 'kw-out'

/**
 * 逐元素的进场标记：`el.dataset.kansoIn = <幕的标记>`，CSS 靠 `[data-kanso-in="…"]` 上动画。
 *
 * **刻意用 data 属性而不是 class**：换 DOM 之前 withViewStateKept 会把整棵树扫一遍存
 * 滚动位置与 <details> 展开态，而它的键是**按 className 分桶**的（shared/view-state）。
 * 往元素的 class 上加东西会把那个元素挪进另一个桶；铎的卡片就住在 overflow-y:auto 的
 * 两列里，万一哪天有卡片自己成了滚动容器或 <details>，还原位置就会悄悄错开。
 * data 属性完全不碰 className，这条路彻底堵死。
 */
const MARK = 'kansoIn'

/**
 * 「这场仪式还没演到那一幕」。挂在 body 上，CSS 用**祖先选择器**把各幕的内容区
 * 压成 opacity 0（规则在 index.html，每一幕一条；护栏对着注册表逐条查有没有漏）。
 *
 * 为什么是祖先类而不是逐个加标记（2026-08-23 用户实机报出的时序 bug）：第一幕点亮
 * 那一格时，面板里的内容会**跟着一起露脸**，等自己那一幕开场才被藏起来重新进场
 * ——「先全看一遍再擦掉重演」。根子在于「藏」这个动作原先发生在那一幕开场，
 * 而模块的首渲/重渲在第一幕期间随时可能发生。
 * 祖先规则让**任何时刻新生的元素天生隐身**，不必追着 DOM 跑，也不碰模块输出。
 *
 * 生命周期：仪式开场（arm）→ 各幕都接手了自己的元素那一刻（同一帧内摘掉，
 * 而那一刻是**最后一格亮透**，不是第一幕整体落幕——游戏区那 1.8 秒的淡入还在跑）。
 * **每一条退出路径都必须摘掉它**——漏一条就是「那一块内容永远隐身」，是这套东西
 * 最大的风险面。所以摘除放在 endAll 里统一做，而 endAll 是点击跳过 / cancel /
 * 各只看门狗共用的收场口。
 */
const CEREMONY_CLASS = 'kanso-ceremony'

/**
 * 看门狗宽限：动画本该在总时长那一刻收尾，但 animationend 未必来得了
 * （坞在动画期间被重铺、元素被别的规则盖掉动画名）。宁可晚一点撤，
 * 也不能让整屏停在暗态——那不是「动画没播」，是界面坏了。
 *
 * 并行各幕更依赖它：面板在开机后**必然**被真重渲一次（游戏登录、数据到达），
 * 那一下 `root.innerHTML = html` 会把罩层和所有元素一起换掉，我们的 animationend
 * 于是永远不来——看门狗就是这条路上唯一的收尾人。
 *
 * 「装配完了却始终没人来 run」另有一只（armCap）：那条路上排着内核初始化、本地化、
 * 各模块装配，只要有一步以**没被 try 住的**方式抛出来，仪式态就会一直挂着
 * ——游戏区盖着黑罩、各面板的内容隐身，比「没有动画」严重得多。
 *
 * 具体的毫秒数与其余口径一样住在 shared（LAUNCH_GUARD_TIMING）：
 * 这个文件里**一个毫秒字面量都不留**，护栏钉着。
 */
const { watchdogSlack: WATCHDOG_SLACK_MS, armCap: ARM_CAP_MS } = LAUNCH_GUARD_TIMING

/** 错峰入场那一幕的取景结果。null = 这次没得演（页不在前台、模块没摆出来）。 */
export interface LaunchStagePick {
  /** 罩层挂在它下面（绝对定位、pointer-events:none，随它一起被裁） */
  host: HTMLElement
  /** 要逐个进场的元素，**按想要的先后**排好（视觉次序由接线层负责） */
  items: HTMLElement[]
}

/** 一幕「错峰入场」：可选先盖一层扫过的罩，然后一批元素逐个进场。 */
export interface LaunchStaggerStage {
  kind: 'stagger'
  /** 幕的代号，只用于自查与报错 */
  id: string
  /** 这一幕的预隐选择器。CSS 本体在 index.html，这里留一份供护栏对账 */
  hides: string
  pick(): LaunchStagePick | null
  /** 逐元素打的标记值：`[data-kanso-in="<mark>"]` */
  mark: string
  /**
   * 元素进场动画的 keyframes 名**前缀**。用前缀是因为一幕里可以有多个变体
   * （镝的左右两栏是相向的两条），而收场只认「是不是这一幕的动画结束了」。
   */
  animation: string
  /** 可选：开演时先在宿主上盖一层扫过的罩（光带 / 扫描线） */
  overlay?: { className: string; animation: string }
  /**
   * 可选：**这一幕的最后一个元素要在这一刻落定**（ms，从开演算起），其余从那儿倒排。
   *
   * 给「必须和别的幕同刻收官」的幕用——顶栏角标要和资源数字同时完成自检。
   * 两幕不通过共享状态商量，各自**用同一个纯函数在同一份 DOM 上算一遍**，
   * 于是天然一致；返回 0 就是不对齐，按自己的节奏走。
   */
  alignEnd?: () => number
  timing: LaunchStaggerTiming
}

/** 一幕「数字自检」：先乱滚，再从个位向高位逐位锁定成真值。 */
export interface LaunchDigitsStage {
  kind: 'digits'
  id: string
  hides: string
  /** 装着数字的元素（锱的资源格 + 顶栏那一排）。空数组 = 没得演 */
  pick(): HTMLElement[]
}

export type LaunchStage = LaunchStaggerStage | LaunchDigitsStage

export interface LaunchGlowHandle {
  /**
   * 布局铺好之后调一次，开始顺次点亮。
   *
   * @param stages 并行各幕的注册表。每一幕的 `pick()` 都在**最后一格亮透的那一刻**
   *   才被调用（不是第一幕整体落幕）——那时哪个模块还摆在屏幕上、面板里有几块内容，
   *   都要按当时的实况算，不能拿装配时的快照。
   */
  run(layout: LaunchGlowLayout, stages?: readonly LaunchStage[]): void
  /** 立刻收摊（启动失败、或调用方不想放了）。幂等，所有幕一起收。 */
  cancel(): void
}

/** 一幕跑起来之后的把手：多久放完、怎么收。 */
interface RunningStage {
  total: number
  end(): void
}

// ---- 顶栏浮层（铃/史/钥）· 打开时的入场 ----
//
// 触发是**每次打开浮层**，不是启动仪式，所以不走祖先预隐、不进注册表、不与 endAll
// 有任何牵连——那一整套是为「开机放一次」设计的，套到高频开合的东西上只会添乱。
// 归同一个开关是因为它属于同一个动画家族（一个实验开关管全家）。
//
// 面板本体的淡入 + 位移由样式表里**早就有的** .ov-panel 过渡负责（与开关无关，
// 关掉也照常有）；这里只加内容区那一层很快的微错峰。
//
// 三条硬规矩，都是高频开合逼出来的：
//   ① **连开连关不许叠**：上一次没收干净就先收，再强制一次样式刷新（`void offsetWidth`）
//      才重新打标记——不刷的话「摘了又立刻加回同一个属性」在浏览器眼里等于没变，
//      动画会接着上一次的进度演，而不是从头。
//   ② **开着时内容重渲不重播**：标记只在「打开」这一瞬间挂，模块重渲把标记连同
//      DOM 一起换掉，新 DOM 直接是终态——与仪式各幕同一条「体面收场」。
//   ③ **静止态不留 transform**：位移只加在浮层内容块自己身上，放完就擦。
//      **绝不往浮层的祖先上加 transform**——那会改掉 position:fixed 的包含块，
//      而本仓的弹出物（peek/cmenu 等）正是因为面板有 transform 才挂到 body 上的。
const OVERLAY_MARK = 'kansoOpen'
let overlayEntranceOn = false
let overlayCleanup: (() => void) | null = null

/** 开关（与启动仪式同一个）。关掉时把还在演的那一次也收掉。 */
export const setOverlayEntranceEnabled = (enabled: boolean) => {
  overlayEntranceOn = enabled && !reduceMotion()
  if (!overlayEntranceOn) {
    overlayCleanup?.()
    overlayCleanup = null
  }
}

/** 浮层内容的顶层块：从 body 往下走，一路只有独苗就再往下一层（最多三层）。 */
const overlayBlocks = (body: HTMLElement): HTMLElement[] => {
  let layer = [...body.children] as HTMLElement[]
  for (let depth = 0; depth < 3 && layer.length === 1; depth++) {
    const next = [...layer[0].children] as HTMLElement[]
    if (!next.length) break
    layer = next
  }
  return layer
}

/**
 * 浮层打开的那一瞬间调一次（铆的 openOverlay）。关掉/减少动态效果时是彻底的空转。
 */
export const playOverlayEntrance = (body: HTMLElement | null) => {
  overlayCleanup?.() // ① 上一次还没收干净就先收
  overlayCleanup = null
  if (!overlayEntranceOn || !body) return

  const blocks = overlayBlocks(body)
  const plan = launchOverlayPlan(blocks.length, LAUNCH_OVERLAY_TIMING)
  if (!plan.total) return
  // ① 强制刷一次样式：摘了标记又立刻加回来，不刷的话浏览器根本看不出变化，
  // 动画会接着上一次的进度演。连开连关正是这条路。
  void body.offsetWidth

  const marked: HTMLElement[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let settled = false

  const done = () => {
    if (settled) return
    settled = true
    if (timer !== null) clearTimeout(timer)
    timer = null
    for (const el of marked) {
      el.removeEventListener('animationend', onEnd)
      delete el.dataset[OVERLAY_MARK]
      // ③ 静止态不留 transform：行内动画属性全擦掉
      el.style.animationDelay = ''
      el.style.animationDuration = ''
    }
    marked.length = 0
    if (overlayCleanup === done) overlayCleanup = null
  }
  const onEnd = (event: Event) => {
    if (animationNameOf(event) === 'kanso-overlay-block') done()
  }

  plan.blocks.forEach((block, index) => {
    const el = blocks[index]
    if (!el) return
    el.dataset[OVERLAY_MARK] = '1'
    el.style.animationDelay = `${block.delay}ms`
    el.style.animationDuration = `${block.duration}ms`
    marked.push(el)
  })
  const last = marked[marked.length - 1]
  if (!last) return
  last.addEventListener('animationend', onEnd)
  // animationend 未必来得了（浮层被关掉、内容被重渲换走），兜底一定要有
  timer = setTimeout(done, plan.total + LAUNCH_GUARD_TIMING.overlaySlack)
  overlayCleanup = done
}

const reduceMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

const animationNameOf = (event: Event): string =>
  (event as AnimationEvent).animationName ?? ''

// ---- 第零幕 · 欢迎返港 ----
//
// 全屏一层，挂 body（**不挂进面板**：面板既裁 overflow 又有 transform 包含块，
// 挂进去的浮层不是被裁就是定位飞掉）。两样东西：正中一块铭牌、最底一行小字。
//
// **一只表都不转**：落幕由「三件真事到齐」与「摆满 minShow」两个条件说了算，
// 门一开就按 launchWelcomeLeaveAt 算出还差多久，挂一记 setTimeout 等到那一刻——
// 没有 interval、没有 rAF，这一屏从挂上去到摘掉全程零重绘。
//（上一版有条进度条，需要一只 60ms 的表逐帧重画；铭牌不需要。）
//
// 四条退出路径，全部汇到同一个 close()：等满了 → 淡出结束 / 点一下或按一下键 /
// 封顶看门狗 / 启动失败时 cancel()。**只有 cancel() 不放行第一幕**——那时屏幕上
// 要摆的是启动失败的说明，不是动画。

/** 淡出的 animationend 未必来得了（窗口被最小化、动画名被别的规则盖掉）时的兜底宽限。 */
const { welcomeFadeSlack: WELCOME_FADE_SLACK_MS } = LAUNCH_GUARD_TIMING

export interface LaunchWelcomeHandle {
  /**
   * 报一件「真就绪」。三件齐了门才开。
   *
   * @param nickname 只有 `snapshot` 那一件带得出提督名（快照回放到达的那一刻才知道）。
   *   取不到就别传，屏幕上那行招呼会留在回退称呼上。同一件报两次以第一次为准。
   */
  noteReady(signal: LaunchWelcomeSignal, nickname?: unknown): void
  /**
   * 第零幕落幕之后做什么（正常路径上就是点第一幕的火）。
   *
   * 注册得比落幕还晚（启动比欢迎屏慢）时**当场就调**——不然第一幕永远等不到人。
   * 被 cancel() 收掉的那一路不调：启动都失败了，别再往屏幕上放动画。
   */
  done(handler: () => void): void
  /** 启动失败：立刻撤，且不放行第一幕。幂等。 */
  cancel(): void
}

/**
 * 挂欢迎屏。**与 armLaunchGlow 同一刻**同步调用（整屏罩暗那一下）。
 *
 * 返回 null = 这次不挂（开关关着）。此时**什么都没做**——一个节点、一个监听都不加。
 * 减少动态效果时**照挂**（它是缓冲不是动画），只是淡入淡出改硬切；minShow 照等。
 */
export const armLaunchWelcome = (enabled: boolean): LaunchWelcomeHandle | null => {
  if (!enabled) return null
  if (typeof document === 'undefined' || !document.body) return null

  const timing = LAUNCH_WELCOME_TIMING
  // 「静」= 系统要求减少动态效果。等待本身照旧，只是不做淡入淡出。
  const calm = reduceMotion()

  const layer = document.createElement('div')
  layer.id = WELCOME_ID
  // 铭牌本体。两段各写各的 textContent（分字号分色），拼起来是一整句招呼；
  // 排版靠样式表，这边一个字都不拼 HTML。
  const box = document.createElement('div')
  box.className = 'kw-box'
  const lead = document.createElement('span')
  lead.className = 'kw-lead'
  lead.textContent = LAUNCH_WELCOME_LEAD
  const name = document.createElement('span')
  name.className = 'kw-name'
  // 开屏这一刻快照还没回来，先摆回退称呼；提督名一到就换（多半在淡入还没完的时候）
  name.textContent = launchWelcomeName(null)
  box.appendChild(lead)
  box.appendChild(name)
  const skip = document.createElement('div')
  skip.className = 'kw-skip'
  skip.textContent = LAUNCH_WELCOME_SKIP_HINT
  layer.appendChild(box)
  layer.appendChild(skip)
  if (!calm) {
    // 时长一律从参数表写进行内（与其余各幕同一条纪律：样式表里不写死毫秒数）
    box.style.animationDuration = `${timing.fade}ms`
    skip.style.animationDuration = `${timing.fade}ms`
  }
  document.body.appendChild(layer)

  const startedAt = Date.now()
  const ready = new Set<string>()
  /** 门是第几毫秒开的；null = 还没开（铭牌就一直摆着等） */
  let openedAt: number | null = null
  let holdTimer: ReturnType<typeof setTimeout> | null = null
  let capWatchdog: ReturnType<typeof setTimeout> | null = null
  let fadeWatchdog: ReturnType<typeof setTimeout> | null = null
  let handoff: (() => void) | null = null
  let leaving = false // 已经开始淡出
  let over = false // 已经收摊
  let aborted = false // 被 cancel 收掉：第一幕不放行

  /** 收摊：撤节点、退监听、停表，然后（除非是 cancel 那一路）放行第一幕。 */
  const close = () => {
    if (over) return
    over = true
    if (holdTimer !== null) clearTimeout(holdTimer)
    holdTimer = null
    if (capWatchdog !== null) clearTimeout(capWatchdog)
    capWatchdog = null
    if (fadeWatchdog !== null) clearTimeout(fadeWatchdog)
    fadeWatchdog = null
    document.removeEventListener('pointerdown', skipNow, true)
    document.removeEventListener('keydown', skipNow, true)
    layer.removeEventListener('animationend', onFadeEnd)
    layer.remove()
    const next = handoff
    handoff = null
    next?.()
  }

  const onFadeEnd = (event: Event) => {
    if (animationNameOf(event) === 'kanso-welcome-out') close()
  }

  /** 等够了：淡出，淡完才放行第一幕（露出罩暗态的正常面板，紧接着点火）。 */
  const leave = () => {
    if (leaving || over) return
    leaving = true
    if (holdTimer !== null) clearTimeout(holdTimer)
    holdTimer = null
    if (calm) {
      close() // 硬切：不做淡出
      return
    }
    layer.classList.add(WELCOME_OUT_CLASS)
    layer.style.animationDuration = `${timing.fade}ms`
    layer.addEventListener('animationend', onFadeEnd)
    fadeWatchdog = setTimeout(close, timing.fade + WELCOME_FADE_SLACK_MS)
  }

  // 点哪儿、按哪个键都直接跳过。捕获阶段只旁听、不 preventDefault、不 stopPropagation
  //（与第一幕同一条：这一下点击本来要落在哪儿就还落在哪儿）。整套仪式一起跳到终态
  // 是靠第一幕自己那份同名监听——两边各自收各自的，谁都不依赖对方还在不在。
  const skipNow = () => close()

  document.addEventListener('pointerdown', skipNow, true)
  document.addEventListener('keydown', skipNow, true)
  // 封顶：三件真事有一件永远不来（进程卡住、IPC 丢了）也不能把玩家钉在这屏上。
  // 到点就落幕——不是硬切，落幕的样子与正常路径一致。
  capWatchdog = setTimeout(() => {
    if (over || leaving) return
    openedAt = openedAt ?? Date.now() - startedAt
    leave()
  }, timing.cap)

  return {
    noteReady: (signal, nickname) => {
      if (over) return
      // 提督名只认第一次：同一件报两次（重试路径）不该把已经写好的名字擦回回退称呼
      if (signal === 'snapshot' && !ready.has('snapshot')) {
        name.textContent = launchWelcomeName(nickname)
      }
      ready.add(signal)
      if (openedAt !== null || !launchWelcomeGateOpen(ready)) return
      // 门开了。还差多少最短展示就等多久——两个条件谁后到听谁的（判据在 shared）。
      openedAt = Date.now() - startedAt
      const rest = launchWelcomeLeaveAt(openedAt, timing) - openedAt
      if (rest <= 0) leave()
      else holdTimer = setTimeout(leave, rest)
    },
    done: (handler) => {
      if (aborted) return
      if (over) {
        handler() // 落幕比启动还早：当场放行，不然第一幕永远等不到人
        return
      }
      handoff = handler
    },
    cancel: () => {
      aborted = true
      handoff = null
      close()
    },
  }
}

/**
 * 罩暗，等 run()。**必须在坞位铺出来之前**同步调用：那时 .dock-group 还不存在，
 * 它们生出来时 body 上已经有 ARMED_CLASS，于是第一帧就是暗的——晚一步就会先亮
 * 一下再暗回去（闪一下比不做动画更难看）。
 *
 * 返回 null = 这次不放（开关关着、或系统要求减少动态效果）。此时**什么都没做**。
 */
export const armLaunchGlow = (enabled: boolean): LaunchGlowHandle | null => {
  if (!enabled) return null
  if (typeof document === 'undefined' || !document.body) return null
  if (reduceMotion()) return null

  const gameArea = document.querySelector<HTMLElement>('#game-area')
  if (!gameArea) return null

  const body = document.body
  const veil = document.createElement('div')
  veil.id = VEIL_ID
  veil.setAttribute('aria-hidden', 'true')
  gameArea.appendChild(veil)
  // 仪式态与罩暗态同时上：各幕的内容从**这一刻**起就隐身，而不是等那一幕开场才藏
  body.classList.add(ARMED_CLASS, CEREMONY_CLASS)

  // 第一幕写过行内动画属性的元素，收尾时逐个擦回去
  const touched: HTMLElement[] = []
  /** 跑起来的并行幕；落幕时逐个收 */
  const running: RunningStage[] = []
  let pending = 0
  let watchdog: ReturnType<typeof setTimeout> | null = null
  let stageWatchdog: ReturnType<typeof setTimeout> | null = null
  let handoffTimer: ReturnType<typeof setTimeout> | null = null
  let armWatchdog: ReturnType<typeof setTimeout> | null = setTimeout(() => endAll(), ARM_CAP_MS)
  let stages: readonly LaunchStage[] = []
  let started = false
  let act1Done = false
  let handedOff = false
  let over = false
  /** 最后一格亮透的那个元素，与它这一格分到的关键帧名——各幕接手的信号源 */
  let lastLit: HTMLElement | null = null
  let lastLitAnimation = ''

  const elementFor = (target: LaunchGlowTarget): HTMLElement | null => {
    if (target.kind === 'rail') return document.querySelector<HTMLElement>('#element-rail')
    if (target.kind === 'game') return veil
    const dock = document.querySelector<HTMLElement>(`.dock[data-dock="${target.dock}"]`)
    return dock?.querySelectorAll<HTMLElement>('.dock-group')[target.index] ?? null
  }

  const clearAnimation = (el: HTMLElement) => {
    el.style.animationName = ''
    el.style.animationDelay = ''
    el.style.animationDuration = ''
  }

  const onVeilEnd = (event: Event) => {
    if (animationNameOf(event) === 'kanso-glow-game') finishAct1()
  }

  // 最后一格亮透＝各幕接手的那一刻。**认名字**：animationend 会冒泡，格子里住着
  // 模块自己的动画（击沉碎裂卡之类），不认名字随便哪个子节点结束一下就把幕提前唤起来了。
  const onLitEnd = (event: Event) => {
    if (animationNameOf(event) === lastLitAnimation) handOffStages()
  }

  /** 第一幕收场：撤两个类、擦掉坞位与导航条的行内动画、把游戏区那层黑罩摘掉。 */
  const endAct1 = () => {
    if (act1Done) return
    act1Done = true
    if (watchdog !== null) clearTimeout(watchdog)
    watchdog = null
    veil.removeEventListener('animationend', onVeilEnd)
    lastLit?.removeEventListener('animationend', onLitEnd)
    lastLit = null
    body.classList.remove(ARMED_CLASS, RUN_CLASS)
    for (const el of touched) clearAnimation(el)
    touched.length = 0
    veil.remove()
  }

  /** 整场落幕（各幕都放完 / 用户点了一下 / 看门狗到点）。幂等。 */
  const endAll = () => {
    if (over) return
    over = true
    if (armWatchdog !== null) clearTimeout(armWatchdog)
    armWatchdog = null
    if (stageWatchdog !== null) clearTimeout(stageWatchdog)
    stageWatchdog = null
    if (handoffTimer !== null) clearTimeout(handoffTimer)
    handoffTimer = null
    document.removeEventListener('pointerdown', endAll, true)
    document.removeEventListener('keydown', endAll, true)
    // 仪式态无论走哪条路都要摘：漏了它那几块内容就永远隐身，比任何残留都严重
    body.classList.remove(CEREMONY_CLASS)
    endAct1()
    for (const stage of running) stage.end()
    running.length = 0
    pending = 0
  }

  /**
   * 并行各幕：谁先放完都不算完，**全部**收工才整场落幕。
   *
   * 现在「全部」里还多了一个第一幕：各幕与游戏区的淡入并排跑，各幕先收工是常事
   * （锐 1.53s vs 游戏区 1.8s），那时候落幕就等于把游戏区那层黑罩从半透明处一把撕掉。
   */
  const stageFinished = () => {
    if (over) return
    pending -= 1
    if (pending <= 0 && act1Done) endAll()
  }

  /**
   * 错峰入场：可选先盖一层扫过的罩，然后一批元素按给定次序逐个进场。
   *
   * 标记与行内延时都是**从外面加在挂载后的真实 DOM 上**的，一个字都不进模块的 HTML
   * 输出管线——被动重渲的逐字节闸门比的是「这次生成的字符串 vs 上次提交的字符串」，
   * 我们改的是 DOM，闸门看不见，也就污染不了它的判断。
   *
   * 反过来，模块真重渲时我们这边**必然**被推平（innerHTML 整换）。那时不重挂、
   * 不装 MutationObserver、不跟渲染器抢——新 DOM 直接就是终态，我们只要把手上的
   * 残留状态清掉。这条路上没有 animationend，收尾全靠看门狗。
   */
  const startStagger = (stage: LaunchStaggerStage): RunningStage | null => {
    const picked = stage.pick()
    if (!picked) return null
    const plan = launchStaggerPlan(picked.items.length, stage.timing, stage.alignEnd?.() ?? 0)
    if (!plan.total) return null // 既不带罩、又一个元素都没有：没得演

    const marked: HTMLElement[] = []
    let overlay: HTMLElement | null = null
    let settled = false

    const end = () => {
      overlay?.removeEventListener('animationend', onEnd)
      overlay?.remove()
      overlay = null
      for (const el of marked) {
        el.removeEventListener('animationend', onEnd)
        delete el.dataset[MARK]
        clearAnimation(el)
      }
      marked.length = 0
    }
    // animationend **会冒泡**，所以「放完了」必须认名字：舰娘行里就住着别的动画
    // （击沉碎裂卡 ru-shatter-in 挂在行的子节点上），不认名字它先结束一下，
    // 整幕就被提前收掉了。用前缀是为了容下一幕里的多个变体（镝的左右两条）。
    const onEnd = (event: Event) => {
      const name = animationNameOf(event)
      if (!name.startsWith(stage.animation) && name !== stage.overlay?.animation) return
      if (settled) return
      settled = true
      end()
      stageFinished()
    }

    if (stage.overlay && plan.loading > 0) {
      overlay = document.createElement('div')
      overlay.className = stage.overlay.className
      overlay.setAttribute('aria-hidden', 'true')
      // 扫过的那道亮带/扫描线是罩层里的一个子节点，与罩层同长
      const sweep = document.createElement('i')
      sweep.style.animationDuration = `${plan.loading}ms`
      overlay.appendChild(sweep)
      overlay.style.animationDuration = `${plan.loading}ms`
      picked.host.appendChild(overlay)
    }

    picked.items.forEach((el, index) => {
      const row = plan.rows[index]
      if (!row) return
      el.dataset[MARK] = stage.mark
      el.style.animationDelay = `${row.delay}ms`
      el.style.animationDuration = `${row.duration}ms`
      marked.push(el)
    })

    // 谁最后结束就听谁：有元素时是最后一个，一个都没有（面板还在等数据）时是罩自己
    const last = marked[marked.length - 1]
    if (last) last.addEventListener('animationend', onEnd)
    else overlay?.addEventListener('animationend', onEnd)
    return { total: plan.total, end }
  }

  /**
   * 数字自检：先乱滚，再从**共同终点倒排**的时刻表逐位锁定（位数不同也齐收）。
   *
   * **一只共享 interval 驱动全部数字**——不做每个数字一只表，也不挂 rAF 常驻循环；
   * 一次性，锁完即停。文本乱滚没法纯 CSS，这是整套里唯一允许的定时器。
   */
  const startDigits = (stage: LaunchDigitsStage): RunningStage | null => {
    const cells: { el: HTMLElement; real: string }[] = []
    for (const el of stage.pick()) {
      const real = el.textContent ?? ''
      if (digitCountOf(real)) cells.push({ el, real })
    }
    if (!cells.length) return null

    const plan = launchDigitsPlan(cells.map((cell) => digitCountOf(cell.real)), LAUNCH_DIGITS_TIMING)
    const startedAt = Date.now()
    let timer: ReturnType<typeof setInterval> | null = null
    let settled = false

    const end = () => {
      if (timer !== null) clearInterval(timer)
      timer = null
      for (const cell of cells) {
        if (cell.el.isConnected && cell.el.textContent !== cell.real) cell.el.textContent = cell.real
      }
      cells.length = 0
    }
    const paint = () => {
      const elapsed = Date.now() - startedAt
      const done = elapsed >= plan.end
      for (const cell of cells) {
        // **离开文档的一律不再写**：那一格已经被重渲换掉了，我们手上这份 real 是
        // 重渲之前的旧值。「乱滚期间真实值变了以重渲后的为准，不追」——不追的意思
        // 就是既不去找新元素，也不再往旧元素上写（写了也没人看见，纯属白费）。
        if (!cell.el.isConnected) continue
        const text = done
          ? cell.real
          : scrambleDigits(cell.real, elapsed, plan.end, LAUNCH_DIGITS_TIMING, Math.random)
        if (cell.el.textContent !== text) cell.el.textContent = text
      }
      if (done && !settled) {
        settled = true
        end()
        stageFinished()
      }
    }
    // 先立刻画一帧乱滚态：等到第一个 tick 才动的话，交接那一瞬间数字还是真值
    paint()
    timer = setInterval(paint, LAUNCH_DIGITS_TIMING.tick)
    return { total: plan.total, end }
  }

  /**
   * **各幕接手**：最后一格亮透的那一刻（`litUntil`），不等游戏区那层黑罩淡完。
   *
   * 触发有两条，谁先到听谁的、handOffStages 自己幂等：最后一格的 animationend
   * （窗口在后台时定时器会被节流，动画事件更贴谱），与一记落在 litUntil 的定时器
   * （那一格被重铺、动画名被别的规则盖掉时，事件永远不来）。
   */
  const handOffStages = () => {
    if (over || handedOff) return
    handedOff = true
    if (handoffTimer !== null) clearTimeout(handoffTimer)
    handoffTimer = null
    lastLit?.removeEventListener('animationend', onLitEnd)
    lastLit = null
    // 各幕**并行**开演：几个面板各演各的，仪式总长按最长那一幕算，不是相加
    let longest = 0
    for (const stage of stages) {
      const run = stage.kind === 'digits' ? startDigits(stage) : startStagger(stage)
      if (!run) continue // 这一幕没得演（页不在前台 / 面板上没有它要的东西）
      running.push(run)
      pending += 1
      longest = Math.max(longest, run.total)
    }
    // **先让各幕都接手自己的元素，再摘仪式态，同一帧内做完**：进场动画 fill-mode
    // 是 both（起点就是 opacity 0）、数字也已经被画成乱滚态，所以交接期间什么都没露。
    // 次序反过来（先摘后接手）就会在这一帧闪一下真容——那正是修过一次的毛病。
    body.classList.remove(CEREMONY_CLASS)
    if (!pending) {
      // 一幕都没得演。第一幕还在放游戏区那段淡入，等它自己落幕（finishAct1）
      if (act1Done) endAll()
      return
    }
    // 看门狗至少要等到第一幕也该收尾的那一刻：各幕比游戏区的淡入短是常事，
    // 按 longest 定时的话，它会在黑罩淡到一半时把整场收掉，画面「啪」地跳亮。
    const act1Rest = LAUNCH_GLOW_TIMING.gameGap + LAUNCH_GLOW_TIMING.gameFade
    stageWatchdog = setTimeout(endAll, Math.max(longest, act1Rest) + WATCHDOG_SLACK_MS)
  }

  /**
   * **第一幕落幕**：游戏区那层黑罩淡完（或看门狗到点）。各幕早在 litUntil 就接手了，
   * 这里只负责撤第一幕自己那套；各幕要是还在演，整场落幕仍得等它们。
   *
   * 仍然兜一次 handOffStages：万一 litUntil 那两条触发都没到（定时器被节流、
   * 最后一格被重铺），也绝不能让各幕连同仪式态一起被漏在这里。
   */
  const finishAct1 = () => {
    if (over) return
    endAct1()
    handOffStages()
    if (!pending) endAll()
  }

  const run = (layout: LaunchGlowLayout, registry?: readonly LaunchStage[]) => {
    if (over || started) return
    started = true
    if (armWatchdog !== null) clearTimeout(armWatchdog)
    armWatchdog = null
    stages = registry ?? []
    // 随机数在这里注入：顺序、抖动、点火变体全从这一个流里出，护栏喂定种子的那份。
    const steps = launchGlowSequence(layout, Math.random, LAUNCH_GLOW_TIMING)
    const litUntil = launchGlowLitUntilMs(steps)
    for (const step of steps) {
      const el = elementFor(step.target)
      if (!el) continue
      // 关键帧本体在 index.html：kanso-glow-a/b/c 是三套点火节奏，
      // kanso-glow-game 是游戏区那套柔和脉冲。
      el.style.animationName = `kanso-glow-${step.variant}`
      el.style.animationDelay = `${step.delay}ms`
      el.style.animationDuration = `${step.duration}ms`
      touched.push(el)
      // 最后一格亮透＝各幕接手的信号。记下它分到的是哪一套点火节奏：animationend
      // 会冒泡，收信号时得认名字（同一格里住着模块自己的动画）。
      if (step.target.kind !== 'game' && step.delay + step.duration === litUntil) {
        lastLit = el
        lastLitAnimation = el.style.animationName
      }
    }
    // 两个信号，各管一件事：
    //   · 最后一格亮透（lastLit 的 animationend / litUntil 那记定时器）→ 并行各幕接手；
    //   · 罩层淡完（veil 的 animationend）→ 第一幕自己落幕。罩层永远是最后一个结束的，
    //     所以「第一幕整体放完了」仍旧只认它这一个信号，不必逐元素数。
    veil.addEventListener('animationend', onVeilEnd)
    lastLit?.addEventListener('animationend', onLitEnd)
    handoffTimer = setTimeout(handOffStages, litUntil)
    watchdog = setTimeout(finishAct1, launchGlowTotalMs(steps) + WATCHDOG_SLACK_MS)
    body.classList.add(RUN_CLASS)
  }

  // 点哪儿都直接到终态（所有幕一起收）。捕获阶段只旁听、不 preventDefault、
  // 不 stopPropagation：这一下点击本来要落在哪个按钮上，就还落在哪个按钮上。
  //
  // **从罩暗那一刻就听，而不是等 run()**：第零幕的欢迎屏正盖在罩暗态上面，
  // 玩家在那期间点的那一下（提示语写的就是「点击跳过动画」）必须当场把整场收掉。
  // 只在 run() 里听的话，那一下只能收掉欢迎屏，紧接着第一幕照演不误。
  // 顺带补上一个老口子：装配比动画长时，罩暗到点火之间那几秒里点屏幕原先毫无反应。
  document.addEventListener('pointerdown', endAll, true)
  document.addEventListener('keydown', endAll, true)

  return { run, cancel: endAll }
}
