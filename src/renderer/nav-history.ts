// 导航历史的纯双栈（2026-08-16 用户点的：从列表跳进图鉴就回不来了，
// 只能一步步重新点）。各方向最多 limit 层：
// - record(prev)：发生新导航时把「离开前那层」压入返回栈；前进栈随之作废
//   （与浏览器一致：回头走了新路，原来的「前方」就不存在了）；
// - goBack/goForward：当前层压入对面栈，弹出并返回目标层；空栈返回 null 且不动账。
// 这里只管栈的账，不含任何 DOM/状态还原——那些留在使用方。
export interface NavHistory<T> {
  record(prev: T): void
  goBack(current: T): T | null
  goForward(current: T): T | null
  backCount(): number
  forwardCount(): number
  peekBack(): T | null
  peekForward(): T | null
}

export const createNavHistory = <T>(limit: number): NavHistory<T> => {
  const back: T[] = []
  const forward: T[] = []
  const push = (stack: T[], item: T) => {
    stack.push(item)
    if (stack.length > limit) stack.shift() // 挤掉最老的一层，最近的 limit 层留下
  }
  return {
    record(prev) {
      push(back, prev)
      forward.length = 0
    },
    goBack(current) {
      const target = back.pop()
      if (target === undefined) return null
      push(forward, current)
      return target
    },
    goForward(current) {
      const target = forward.pop()
      if (target === undefined) return null
      push(back, current)
      return target
    },
    backCount: () => back.length,
    forwardCount: () => forward.length,
    peekBack: () => back[back.length - 1] ?? null,
    peekForward: () => forward[forward.length - 1] ?? null,
  }
}
