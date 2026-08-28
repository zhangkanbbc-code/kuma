// 分段折叠：给「标题 + 一大块内容」的段加开合，供图鉴与镝共用。
//
// 为什么需要：一页能堆到两三屏（实测图鉴海域详情约 2750px），想找中间那段得翻半天。
//
// 两个实现上的选择，改之前先看这里：
// - 状态按**标题文本**记，不按位置。渲染是整棵 innerHTML 换掉，位置索引对不上；
//   而同名段（几处都有「有关任务」）本来就该保持同一个开合习惯。
// - 用 MutationObserver 统一施加，不去改各处渲染出口——那些出口有十来个，
//   逐个补调用迟早漏一处。只能监听 childList：施加折叠改的是属性，
//   监听 attributes 会把自己再触发一遍。
//   **代价与补丁**：MutationObserver 的回调是微任务，排在 withViewStateKept 同步
//   还原滚动的后面，于是重渲染那一拍会先按「全展开」的虚高还原滚动、再被折回去夹掉
//   （2026-08-23 实机报的「点一下播放被往上拉好几屏」）。所以另把 apply 登记进
//   kernel 的 registerViewSettler，在还原之前同步跑一次；观察者保留当兜底。

import { registerViewSettler } from './kernel'

export interface FoldSpec {
  /** 每个可折叠段的根元素 */
  section: string
  /** 标题元素，必须是 section 的直接子元素 */
  head: string
  /** 从标题元素取出用来记忆的名字；取不出就跳过这一段 */
  title: (head: HTMLElement) => string
  /** 只对这些名字生效；不给就是「这个选择器命中的全都算」 */
  only?: ReadonlySet<string>
  /** 这些名字默认展开，其余默认折起来 */
  openByDefault?: ReadonlySet<string>
  /** 这些名字连折叠钮都不给——打开就要看的内容不该藏 */
  alwaysOpen?: ReadonlySet<string>
  /**
   * 默认全展开：这个选择器命中的段，除非玩家亲手折过，一律是展开的。
   *
   * 与 `openByDefault` 的区别是**名单从哪来**。`openByDefault` 要事先写死一份名字，
   * 而分类分组的组名跟着数据与筛选走（今天有哪些装备类别能改修、这张图鉴里有哪些
   * 舰种、这一卷有哪些海域），根本写不出名单。所以这一支反过来记「玩家折起来的那几个」，
   * 没记着的就是开着——名单是空的时候正是「全展开」。
   *
   * 口径对齐 2026-08-26 战斗流水阶段折叠那次拍板：**折叠只是玩家当场的收纳动作，
   * 不改变默认阅读**。
   */
  openAllByDefault?: boolean
}

/**
 * 这一段现在该不该是展开的。
 *
 * 抽成纯函数是为了「默认全展开」这条能脱开 DOM 测——折叠判断写反了，
 * 断言源码文本的护栏一条也拦不住（见共享层 source-pattern-guards-miss-logic-bugs）。
 *
 * 两支的记法是**相反**的：常规段记「开着的」，`openAllByDefault` 段记「折起来的」。
 */
export const sectionIsOpen = (
  spec: Pick<FoldSpec, 'openAllByDefault'>,
  name: string,
  opened: ReadonlySet<string>,
  closed: ReadonlySet<string>,
): boolean => (spec.openAllByDefault ? !closed.has(name) : opened.has(name))

/** 翻这一段的开合。改的是哪本账由 `openAllByDefault` 决定（见 `sectionIsOpen`）。 */
export const toggleSectionFold = (
  spec: Pick<FoldSpec, 'openAllByDefault'>,
  name: string,
  opened: Set<string>,
  closed: Set<string>,
): void => {
  const book = spec.openAllByDefault ? closed : opened
  if (book.has(name)) book.delete(name)
  else book.add(name)
}

/** 标题元素里第一个非空文本节点。适用于 `<div class=h>标题<span class=aux>…</span></div>` */
export const firstTextTitle = (head: HTMLElement): string => {
  for (const node of Array.from(head.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
      return node.textContent.trim()
    }
  }
  return ''
}

/** `<div class=h><b>标题</b><span class=r>…</span></div>` 这种把标题包在 <b> 里的 */
export const boldTitle = (head: HTMLElement): string =>
  head.querySelector(':scope > b')?.textContent?.trim() ?? ''

/** `战斗流水 · 12 事件` 这种标题与计数混在一行的，取分隔符前面那截 */
export const leadingTitle = (head: HTMLElement): string =>
  (head.textContent ?? '').split('·')[0]?.trim() ?? ''

interface FoldBooks {
  specs: FoldSpec[]
  /** 常规段记「开着的」 */
  opened: Set<string>
  /** `openAllByDefault` 段记「折起来的」 */
  closed: Set<string>
}

// 装过折叠的根 → 它那两本账。`revealSection` 要改的就是这两本，改 DOM 属性是不够的
// （见 revealSection 的注释）。按根挂 WeakMap：根一走，账跟着走。
const foldBooks = new WeakMap<HTMLElement, FoldBooks>()

const applySpec = (
  root: ParentNode,
  spec: FoldSpec,
  opened: Set<string>,
  closed: Set<string>,
) => {
  root.querySelectorAll<HTMLElement>(spec.section).forEach((section) => {
    const head = section.querySelector<HTMLElement>(`:scope > ${spec.head}`)
    const name = head ? spec.title(head) : ''
    if (!head || !name || spec.only?.has(name) === false) return
    if (spec.alwaysOpen?.has(name)) {
      section.removeAttribute('data-foldable')
      section.removeAttribute('data-open')
      head.removeAttribute('data-fold-head')
      return
    }
    head.setAttribute('data-fold-head', '')
    section.setAttribute('data-foldable', '')
    section.toggleAttribute('data-open', sectionIsOpen(spec, name, opened, closed))
  })
}

/**
 * 给一棵子树装上分段折叠。只在模块 mount 时调一次。
 *
 * @returns 当前展开的段名集合（诊断用；直接改它不会立刻反映到界面上）。
 *   **只含常规段**——`openAllByDefault` 的段记在另一本「折起来的」账上，不在这里。
 */
export const installSectionFolding = (root: HTMLElement, specs: FoldSpec[]): Set<string> => {
  const opened = new Set<string>()
  // `openAllByDefault` 段记的是**折起来的那几个**（空集 = 全展开），与 opened 相反，
  // 所以两本账分开放，别指望一个 Set 兼表两种语义。
  const closed = new Set<string>()
  for (const spec of specs) {
    for (const name of spec.openByDefault ?? []) opened.add(name)
  }
  const apply = () => {
    for (const spec of specs) applySpec(root, spec, opened, closed)
  }
  foldBooks.set(root, { specs, opened, closed })

  root.addEventListener('click', (event) => {
    const target = event.target as HTMLElement
    // 标题里常挂着实体链接与小开关（比如「展开全部 miss/零伤」），点它们各有各的事
    if (target.closest('.el, a, button, input, select, summary, .tg')) return
    const head = target.closest<HTMLElement>('[data-fold-head]')
    const section = head?.parentElement
    if (!head || !section?.hasAttribute('data-foldable')) return
    const spec = specs.find((s) => section.matches(s.section))
    const name = spec ? spec.title(head) : ''
    if (!spec || !name) return
    toggleSectionFold(spec, name, opened, closed)
    section.toggleAttribute('data-open', sectionIsOpen(spec, name, opened, closed))
  })

  // 换完 DOM 之后必须**同步**再施加一次，赶在滚动还原之前。
  // MutationObserver 的回调是微任务，排在同步还原的后面：先按「全展开」的高度
  // 把滚动放回去，紧接着几段折回默认态、页面矮下去，浏览器就把 scrollTop 夹上来
  // ——玩家看到的是「点一下播放被往上拉了好几屏」（见 kernel registerViewSettler）。
  registerViewSettler(root, apply)
  new MutationObserver(apply).observe(root, { childList: true, subtree: true })
  apply()
  return opened
}

/**
 * 让一个元素**真的露出来**：它若正落在折起来的段里，把那些段展开。
 *
 * 谁要它：页内跳转（节点图点一个点位 → 落到下面那一节敌编成）。折起来的段是
 * `display: none`（见 index.html 的 `[data-foldable]:not([data-open]) > *`），
 * 没有盒子——`scrollIntoView` 一寸也不滚、落地脉冲一个像素也不闪、
 * `getBoundingClientRect()` 全是 0。整件事静默空转，一行日志都不留，
 * 玩家看到的就是「点了没反应」（2026-08-28 用户实报，隔离实例上复现坐实）。
 *
 * **必须改账本，不能只改属性。** 只 `setAttribute('data-open')` 的话，下一次
 * 施加（重渲后的 registerViewSettler / MutationObserver）会照着 `opened`
 * 这本账把它折回去——图鉴正是被动重渲的重灾区，脉冲还没闪完就没了。
 *
 * 段可以套段，所以一路往上走到根，每一层折着的都开。
 *
 * @returns 有没有真的展开了什么（本来就开着 = false）。
 */
export const revealSection = (element: Element | null | undefined): boolean => {
  let root: Element | null = element ?? null
  let books: FoldBooks | undefined
  while (root) {
    books = foldBooks.get(root as HTMLElement)
    if (books) break
    root = root.parentElement
  }
  if (!books || !root) return false
  let changed = false
  let cursor: Element | null = element ?? null
  while (cursor) {
    const section = cursor.closest<HTMLElement>('[data-foldable]:not([data-open])')
    if (!section || !root.contains(section)) break
    const spec = books.specs.find((s) => section.matches(s.section))
    const head = spec ? section.querySelector<HTMLElement>(`:scope > ${spec.head}`) : null
    const name = spec && head ? spec.title(head) : ''
    // 认不出名字就停手：这一段的开合本来就没人记，硬开一次下一拍也会被折回去
    if (!spec || !name) break
    // 两支的记法是相反的（见 sectionIsOpen）
    if (spec.openAllByDefault) books.closed.delete(name)
    else books.opened.add(name)
    section.setAttribute('data-open', '')
    changed = true
    cursor = section.parentElement
  }
  return changed
}
