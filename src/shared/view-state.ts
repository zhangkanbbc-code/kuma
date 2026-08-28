// 全量重渲染时「这还是刚才那个元素吗」的判定键。
//
// innerHTML 重建后所有节点都是新的，要把展开态和输入焦点放回原处，就得有一把
// 重建前后都成立的键。这里刻意不用 nth-child 路径——DOM 结构一变就整体错位，
// 恢复到隔壁那一项比不恢复更糟。
//
// 两条都做成纯逻辑放在 shared，是为了能不带 DOM 环境直接测：
// 键算错的表现是「展开了另一段资料」「焦点跳到别的输入框」，肉眼未必立刻发现。

export interface KeyableElement {
  id?: string
  className?: string
  keep?: string // data-keep：调用方给的显式稳定键，优先级最高
  attributes?: ArrayLike<{ name: string; value: string }>
}

/**
 * <details> 的展开态键。
 * data-keep 优先；否则退回「class + 同 class 内序号」——同一次扫描共用 seen 计数器。
 * 序号法只在列表增删时会错位，所以动态列表该显式给 data-keep。
 */
export const detailsKey = (el: KeyableElement, seen: Map<string, number>): string => {
  if (el.keep) return `k:${el.keep}`
  const cls = el.className || 'details'
  const n = seen.get(cls) ?? 0
  seen.set(cls, n + 1)
  return `c:${cls}#${n}`
}

/**
 * 「下一帧再还原一次」到底还该不该还原。
 *
 * 尾随的那一次还原是为了对付**浏览器**在同步布局之后又动了滚动位置
 * （容器形态切换、抽屉宽度过渡触发的滚动锚定）。可它拿的是重建前那份旧快照，
 * 于是也会把**用户**在这一帧里刚滚出去的距离原样拽回来——2026-08-21 实测：
 * 重渲后滚 500px，两帧后回到原位，用户报的正是「短距离回退」。
 *
 * 判据：位置还是我们上一拍亲手写进去的那个，才认为「没人动过」。
 * `written` 记的必须是**写完之后读回来的实际值**（内容没撑开时浏览器会夹住），
 * 否则每次都判成「有人动过」，尾随还原等于没装。
 * 1px 容差是给亚像素滚动留的（界面缩放 1.15 时 scrollTop 常带小数），别放大。
 */
export const scrollUntouchedSince = (
  current: { top: number; left: number },
  written: { top: number; left: number } | undefined,
): boolean =>
  !!written && Math.abs(current.top - written.top) <= 1 && Math.abs(current.left - written.left) <= 1

// ---- 换完 DOM 之后的还原次序 ----
//
// 这四步的**先后本身就是判据**，所以做成数据放在这里，能不带 DOM 直接测：
// 次序写反了不报错，只是滚动落在别处，而那正是最难被发现的一类。
//
// 铁律：**会改变内容高度的收尾必须排在滚动还原之前**。滚动位置会被浏览器夹在
// 「当时的内容高度」里，先还原再变矮，夹掉的那一截就永远回不来了。
//   · `settle`  渲染之后由 JS 施加、且会改高度的收尾（分段折叠就是——它平时靠
//               MutationObserver 施加，而那是微任务，排在同步还原之后；
//               2026-08-23 用户实机报的「点一下播放被往上拉好几屏」就是它，
//               真浏览器复现：装了折叠丢 328px，不装折叠丢 0px）
//   · `details` <details> 的展开态（展开会撑高内容，同理）
//   · `focus`   焦点（用 preventScroll，本身不该动滚动）
//   · `scroll`  最后一步
export const VIEW_RESTORE_ORDER = ['settle', 'details', 'focus', 'scroll'] as const

export type ViewRestoreStep = (typeof VIEW_RESTORE_ORDER)[number]

/** 按上面那个次序逐步跑。调用方只管把四步各自的做法传进来。 */
export const runViewRestore = (steps: Record<ViewRestoreStep, () => void>): void => {
  for (const step of VIEW_RESTORE_ORDER) steps[step]()
}

/**
 * 换完 DOM 之后，这一次该跑哪些 `settle`。
 *
 * 收尾是按**装在哪棵子树上**登记的（折叠装在模块面板上），而重渲染可能发生在
 * 那棵子树本身、它的祖先、或它的某个后代上——三种都得跑，否则漏掉的那次
 * 就退回「先还原再折起来」的老毛病。
 *
 * `connected` 为假的一律丢掉：模块重试装配会换掉面板元素，旧登记指着一棵
 * 已经离开文档的树，再跑就是白跑（也让登记表不会随重挂无限长大）。
 */
export const settlersToRun = <T, E extends { root: T; connected: boolean }>(
  entries: readonly E[],
  target: T,
  contains: (ancestor: T, node: T) => boolean,
): E[] =>
  entries.filter(
    (entry) =>
      entry.connected &&
      (entry.root === target || contains(entry.root, target) || contains(target, entry.root)),
  )

/**
 * 焦点元素的重定位选择器：id 优先，否则取第一个非空 data-* 属性。
 * 两者都拿不到就返回 null（宁可不恢复，也不猜一个可能指向别处的选择器）。
 *
 * 一律走属性选择器而不是 `#id`：属性值是带引号的字符串，JSON.stringify 的转义规则
 * 正好对得上，于是不必依赖只有浏览器里才有的 CSS.escape——
 * 而 CSS.escape 那套标识符转义（"12" → "\31 2"）放进引号里本来就是错的。
 */
export const focusSelector = (el: KeyableElement): string | null => {
  if (el.id) return `[id=${JSON.stringify(el.id)}]`
  for (const attr of Array.from(el.attributes ?? [])) {
    if (attr.name.startsWith('data-') && attr.value) {
      return `[${attr.name}=${JSON.stringify(attr.value)}]`
    }
  }
  return null
}
