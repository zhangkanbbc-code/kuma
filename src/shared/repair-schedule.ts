// 入渠排程：把待修的舰摊到现有渠位上，算「什么时候能全员就绪」。
//
// 逐舰时长相加得到的是**总工时**，不是完工时刻——有几个渠就能并行几艘，
// 相加会把 4 渠并行的活算成单渠串行，数字大出好几倍。

export interface RepairSlot {
  /** 该渠最早可接下一艘的时刻。空渠 = 现在；占用中 = 当前这艘的完工时刻 */
  freeAt: number
}

export interface RepairPlanInput {
  now: number
  /** 各渠当前状态 */
  slots: RepairSlot[]
  /** 待修各舰的入渠时长（毫秒） */
  durations: number[]
}

export interface RepairPlan {
  /**
   * 全员就绪的时刻——**含正在修的那些**。
   * 占用中的渠即使不再接新活，它当前那艘也得修完才算全员好。
   */
  finishAt: number
  /** 从现在算起还要多久 */
  remainMs: number
  /** 逐舰相加的总工时——跟完工时刻不是一回事，两个都有用 */
  totalMs: number
  /** 参与排程的渠位数 */
  slotCount: number
  /** 有几艘得排队等空渠（超出渠位数的部分） */
  queued: number
}

/**
 * 最长优先（LPT）分配：每次把最长的那艘塞进最早空闲的渠。
 *
 * 这是经典的多机调度近似解——最优解是 NP-hard，但 LPT 的完工时刻不会超过
 * 最优的 4/3。对「大概几点能全好」这个用途足够，而且顺序直觉上也对：
 * 先安排最久的，短的用来填空隙。
 *
 * 注意**已被占用的渠不是立刻可用**：它得先把当前这艘修完。
 * 忽略这一点会把「4 渠全满」算成「4 渠全空」，给出过于乐观的时刻。
 */
export const planRepairs = (input: RepairPlanInput): RepairPlan | null => {
  const durations = input.durations.filter((ms) => Number.isFinite(ms) && ms > 0)
  const totalMs = durations.reduce((sum, ms) => sum + ms, 0)
  if (!input.slots.length) return null
  // 渠的可用时刻不能早于现在：已经到点但还没去领的，也是现在才空出来
  const free = input.slots.map((slot) => Math.max(input.now, slot.freeAt))
  if (!durations.length) {
    // 没有待修的，但渠里可能还躺着在修的——那时「全员就绪」不是现在
    const idle = Math.max(...free)
    return {
      finishAt: idle,
      remainMs: Math.max(0, idle - input.now),
      totalMs: 0,
      slotCount: free.length,
      queued: 0,
    }
  }
  for (const ms of [...durations].sort((a, b) => b - a)) {
    let earliest = 0
    for (let i = 1; i < free.length; i += 1) {
      if (free[i] < free[earliest]) earliest = i
    }
    free[earliest] += ms
  }
  const finishAt = Math.max(...free)
  return {
    finishAt,
    remainMs: Math.max(0, finishAt - input.now),
    totalMs,
    slotCount: free.length,
    queued: Math.max(0, durations.length - free.length),
  }
}
