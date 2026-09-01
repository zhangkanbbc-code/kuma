// 试听的悬浮迷你播放条：默认右下角一枚小胶囊，一行摆完
// 「在听什么 · 播放/暂停 · 拖到哪 · 时间」，**按住空白处可以整条挪走**。
//
// 它解决的是「想从哪里听就从哪里听」——♪ 词条与语音钮只有开关两态，一首三分钟的曲子
// 想跳到副歌无处可跳；而词条本身长在模块面板里，翻一页就看不见了。
//
// ---- 两条不许违反的纪律 ----
//
// ① **挂 body，只挂一次**。模块面板既裁 overflow 又是 transform 包含块：长在模块行里的
//    浮层 absolute 会被裁掉、fixed 会算错位置（仓史踩过）。而模块 HTML 是被动重渲、
//    整块重画的，任何住在模块行里的持久 UI 都活不过下一次刷新。所以这枚节点在装配时
//    一次性挂进 body，此后**只切显隐、绝不重建**，与任何模块的渲染路径零交集。
//    ——挪窝那一段跟着沾光：位置写在这枚常驻节点的行内样式上，任何模块重渲都碰不到它。
// ② **状态一律问总机**（renderer/preview-audio），自己不记「现在在放谁」。播放/暂停也是
//    转手交给总机——绕过去直接 audio.play() 就漏掉了压游戏音量那一步，表现是
//    「从条子上续播，游戏还哑着」，而且不报错。
import { activePreview, onPreviewChange, toggleActivePreview } from './preview-audio'

/** 这几件事发生时进度或时长可能变了，条子要跟着重画。 */
const AUDIO_EVENTS = ['play', 'pause', 'timeupdate', 'durationchange', 'loadedmetadata'] as const

let host: HTMLElement | null = null
let nameEl: HTMLElement | null = null
let toggleEl: HTMLButtonElement | null = null
let seekEl: HTMLInputElement | null = null
let timeEl: HTMLElement | null = null

/** 此刻挂着监听的那个 Audio。播放器换了实例就要摘旧挂新，否则条子会盯着一个死实例。 */
let bound: HTMLAudioElement | null = null

/**
 * 玩家的手正按在滑条上。
 *
 * 拖动期间 `timeupdate` 每秒来四次，照写就是「手往右拖、滑块自己弹回去」——
 * 拖不动。所以拖动态期间**只认滑条自己的值**，松手（change）那一下才写回 currentTime。
 */
let dragging = false

// ═══════════════════════════════ 挪窝 ═══════════════════════════════
//
// 2026-09-01 用户点的：条子钉死在右下角，右下角那一块内容就被它压着看不见。
// 按住空白处（曲名、时间、内边距）拖走，播放/暂停钮与进度滑条照旧只管自己的事。
//
// **位置只记在这一次运行里，重启回默认的右下角。** 选这一头而不是落进 config：
// ① 条子是随试听来去的临时件（播完就退场），玩家拖它是因为「此刻这一块被挡着」，
//    而挡不挡取决于当下开着哪个模块——把一次性的躲避动作腌成长期设置并不对味。
// ② 右下角这个默认位不是随手放的：它与 Toast 堆的让位规则、与提示卡/菜单/大图的
//    层级次序是一起定的。持久化等于让一个随手拖出来的坐标长期盖掉这套协调。
// ③ 「重启回默认位」本身就是免费的退路——位置拖坏了（换屏、改缩放）关掉再开就正了，
//    不必再为此长一枚「还原位置」的按钮。
// 换窗口大小/换屏/改界面缩放时的兜底见 refit()：夹不回视口内就整个撤回默认位。

/** 离视口边缘至少留这么多，免得拖到只剩一条缝、再也捏不住 */
const EDGE = 8

/** 拖到过哪里（视口坐标，左上角）。null = 还在默认位，由 CSS 的 right/bottom 说了算。 */
let placed: { x: number; y: number } | null = null

/** 这一趟拖拽。null = 手没按着。尺寸与起手落差在按下那一拍量一次，move 里绝不再量。 */
let carry: { id: number; dx: number; dy: number; w: number; h: number } | null = null

/** 上一次画完之后条子是不是露着。只在「藏→露」那一拍重夹位置，不必每帧都去问布局。 */
let visible = false

/** 把一个坐标夹进视口。视口比条子还小（窄窗）时贴边留住左上角——那头有曲名和钮。 */
const fit = (value: number, size: number, viewport: number): number => {
  const max = viewport - size - EDGE
  return max < EDGE ? EDGE : Math.min(Math.max(value, EDGE), max)
}

/**
 * 把 `placed` 写进节点。**一帧里只动 left/top 这两个坐标**：
 * 不碰宽高内外边距（那些会牵动布局），也不给它任何过渡（拖拽要的就是跟手）。
 * 回默认位时把四个值一起清掉，重新交还给样式表里的 right/bottom。
 */
const applyPlaced = () => {
  if (!host) return
  if (!placed) {
    host.style.left = ''
    host.style.top = ''
    host.style.right = ''
    host.style.bottom = ''
    return
  }
  host.style.left = `${placed.x}px`
  host.style.top = `${placed.y}px`
  host.style.right = 'auto'
  host.style.bottom = 'auto'
}

/**
 * 右下角那一叠 Toast 得给条子让位——但只有条子**真在右下角**时才该让。
 * 拖走之后还顶着 54px，就是为一个已经不在那儿的东西空出一块。
 */
const syncToastLift = (on: boolean) => {
  if (on && !placed) document.body.classList.add('kanso-preview-on')
  else document.body.classList.remove('kanso-preview-on')
}

/**
 * 视口变了（窗口缩放、拖去另一块屏、界面缩放系数改了）：把记着的位置重新夹一遍。
 *
 * 夹不下去（视口已经比条子还小）就**整个撤回默认位**——宁可回右下角，
 * 也不留一枚半截在屏外、连拖都拖不回来的条子。
 */
const refit = () => {
  if (!host || !placed) return
  const rect = host.getBoundingClientRect()
  // 量不到尺寸（节点还没上屏）就别算，等下一次露头时再夹
  if (!(rect.width > 0) || !(rect.height > 0)) return
  if (window.innerWidth < rect.width + EDGE * 2 || window.innerHeight < rect.height + EDGE * 2) {
    placed = null
  } else {
    placed = {
      x: fit(placed.x, rect.width, window.innerWidth),
      y: fit(placed.y, rect.height, window.innerHeight),
    }
  }
  applyPlaced()
  // 撤回默认位就意味着条子又回到右下角了，Toast 得重新让位
  syncToastLift(visible)
}

/** 这些是控件，按在它们上面不算拖：钮要点得动，滑条要拖得动刻度。 */
const CONTROLS = 'button, input'

const onPointerDown = (event: PointerEvent) => {
  if (!host || event.button !== 0) return
  const target = event.target as HTMLElement | null
  if (target?.closest(CONTROLS)) return
  const rect = host.getBoundingClientRect()
  carry = {
    id: event.pointerId,
    dx: event.clientX - rect.left,
    dy: event.clientY - rect.top,
    w: rect.width,
    h: rect.height,
  }
  // 不 preventDefault 就会顺手选中曲名的文字，拖出一道蓝底
  event.preventDefault()
  // 捕获之后 move/up 一律回到这枚节点上，手滑出窗口再回来也接得住
  host.setPointerCapture(event.pointerId)
}

const onPointerMove = (event: PointerEvent) => {
  if (!carry || event.pointerId !== carry.id || !host) return
  // 挡板推迟到真动了才铺（与坞分隔条那条拖拽循环同一口径）：按下不动＝纯点击，
  // 不该平白多出一层挡在游戏区上的东西。
  host.classList.add('pb-dragging')
  placed = {
    x: fit(event.clientX - carry.dx, carry.w, window.innerWidth),
    y: fit(event.clientY - carry.dy, carry.h, window.innerHeight),
  }
  applyPlaced()
  syncToastLift(visible)
}

const onPointerUp = (event: PointerEvent) => {
  if (!carry || event.pointerId !== carry.id) return
  if (host) {
    if (host.hasPointerCapture(carry.id)) host.releasePointerCapture(carry.id)
    host.classList.remove('pb-dragging')
  }
  carry = null
}

const mmss = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--'
  const total = Math.floor(seconds)
  return `${Math.floor(total / 60)}:${`${total % 60}`.padStart(2, '0')}`
}

/**
 * 能拖的时长。
 *
 * 远端 mp3 在拿到元数据之前 duration 是 NaN，直播式的流则是 Infinity——两种都**不能拖**
 * （没有终点，滑条的刻度无从谈起）。这里统一折成 0，由调用方据此禁用滑条、时长位写「--:--」，
 * 而不是渲染一根拖了没反应的假滑条。
 */
const seekableDuration = (audio: HTMLAudioElement | null): number => {
  const value = audio?.duration
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

const currentTimeOf = (audio: HTMLAudioElement | null): number => {
  const value = audio?.currentTime
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/** 只画，不改状态。总机叫一声、Audio 报一次事件，都落到这里。 */
const paint = () => {
  if (!host || !nameEl || !toggleEl || !seekEl || !timeEl) return
  const info = activePreview()
  if (!info) {
    // 播完 / 出错 / 从来没开过口：条子退场，状态清零。
    // 位置**不清**：同一次运行里再听下一首，它还在玩家上次挪到的地方。
    bindAudio(null)
    host.classList.remove('show')
    visible = false
    syncToastLift(false)
    seekEl.value = '0'
    return
  }
  bindAudio(info.audio)
  host.classList.add('show')
  // 藏着的这段时间里窗口可能被拉小/换了屏，露头这一拍先把位置夹回视口内。
  // 只在「藏→露」那一拍问一次布局——paint 每秒被 timeupdate 叫四次，每次都量就是白烧。
  if (!visible) {
    visible = true
    refit()
  }
  syncToastLift(true)

  nameEl.textContent = info.label || '试听'
  nameEl.title = info.label || '试听'
  toggleEl.textContent = info.playing ? '⏸' : '▶'
  toggleEl.setAttribute('aria-label', info.playing ? '暂停' : '继续播放')
  toggleEl.title = info.playing ? '暂停' : '接着放'

  const duration = seekableDuration(info.audio)
  const at = currentTimeOf(info.audio)
  if (duration > 0) {
    seekEl.disabled = false
    seekEl.max = `${duration}`
    if (!dragging) seekEl.value = `${Math.min(at, duration)}`
  } else {
    // 时长还不知道（或根本没有终点）：滑条禁用，时间照走。
    // 摆一根拖了没反应的滑条比没有滑条更糟。
    seekEl.disabled = true
    seekEl.max = '0'
    seekEl.value = '0'
  }
  const shown = dragging && duration > 0 ? Number(seekEl.value) : at
  timeEl.textContent = `${mmss(shown)} / ${duration > 0 ? mmss(duration) : '--:--'}`
}

function bindAudio(audio: HTMLAudioElement | null) {
  if (bound === audio) return
  if (bound) for (const type of AUDIO_EVENTS) bound.removeEventListener(type, paint)
  bound = audio
  if (bound) for (const type of AUDIO_EVENTS) bound.addEventListener(type, paint)
  // 换了一条就不该还锁在上一条的拖动态里
  dragging = false
}

const applySeek = () => {
  const info = activePreview()
  const audio = info?.audio ?? null
  const duration = seekableDuration(audio)
  const target = Number(seekEl?.value)
  dragging = false
  if (audio && duration > 0 && Number.isFinite(target)) {
    // 远端 mp3 的跳转靠服务器认 Range（Chromium 自己会发范围请求）；不认就跳不动，
    // 那是服务器的事，这里能做的只是不写出界的值。file:// 的档案实物天然跳得动。
    try {
      audio.currentTime = Math.min(Math.max(0, target), duration)
    } catch (error) {
      // 元数据还没到手时写 currentTime 会抛。吞掉就成了「拖了没反应还查不出为什么」
      console.warn('[kanso] 试听跳转失败', target, error)
    }
  }
  paint()
}

const build = (): HTMLElement => {
  const el = document.createElement('div')
  el.id = 'preview-bar'
  el.setAttribute('role', 'group')
  el.setAttribute('aria-label', '试听')

  nameEl = document.createElement('span')
  nameEl.className = 'pb-name'

  toggleEl = document.createElement('button')
  toggleEl.className = 'pb-toggle'
  toggleEl.type = 'button'
  toggleEl.addEventListener('click', () => {
    toggleActivePreview()
    paint()
  })

  seekEl = document.createElement('input')
  seekEl.className = 'pb-seek'
  seekEl.type = 'range'
  seekEl.min = '0'
  seekEl.max = '0'
  seekEl.step = '0.01'
  seekEl.value = '0'
  seekEl.setAttribute('aria-label', '播放进度')
  // input 在拖动全程连发（键盘方向键也走它）：进拖动态，时间位跟着手走，但先不动 currentTime。
  seekEl.addEventListener('input', () => {
    dragging = true
    paint()
  })
  // change 是松手（或键盘操作结束）那一下：此刻才真跳。
  seekEl.addEventListener('change', applySeek)

  timeEl = document.createElement('span')
  timeEl.className = 'pb-time'

  // 挪窝。按在钮/滑条上的那一下在 onPointerDown 里就被让开了，控件不被劫持。
  el.addEventListener('pointerdown', onPointerDown)
  el.addEventListener('pointermove', onPointerMove)
  el.addEventListener('pointerup', onPointerUp)
  // 指针被系统收走（切窗口、触摸被手势接管）：与松手同样收摊，别把条子粘在手上
  el.addEventListener('pointercancel', onPointerUp)

  el.appendChild(nameEl)
  el.appendChild(toggleEl)
  el.appendChild(seekEl)
  el.appendChild(timeEl)
  return el
}

/**
 * 装条子。**整个装配期只跑一次**，此后这枚节点一直住在 body 里，靠 `.show` 切显隐。
 * 没有任何模块会重建它，也没有任何 onMgChange 路径经过它。
 */
export const initPreviewBar = () => {
  if (host) return
  host = build()
  document.body.appendChild(host)
  onPreviewChange(paint)
  // 窗口大小/界面缩放一变，记着的落点就可能落到屏外了。这里只夹坐标，不重建任何东西。
  window.addEventListener('resize', refit)
  paint()
}
