// 崩溃记账（纯逻辑，不碰 electron 与 DOM，好让测试直接跑）。
//
// 界面侧的隔离一旦做起来，「模块崩了」就不再表现为黑屏，而是悄悄少一块数据——
// 所以记账本身必须靠得住：
//   · 同一处反复出错只累加计数，不能让一个每秒抛一次的 tick 回调把日志刷爆；
//   · 记满了挤掉最旧的，因为新错误比陈年旧账更有诊断价值；
//   · 通知订阅者时不能被订阅者自己的异常反噬——错误处理链再抛，就没有下一道了。

export interface CrashRecord {
  scope: string // 出错的环节，如 'mount:ji'、'kernel:patch'
  message: string
  stack: string | null
  count: number // 同一处重复出错的次数
  firstTs: number
  lastTs: number
  /**
   * 已知的良性噪音：浏览器报上来但并不代表任何代码出错的东西。
   * 仍然记账（高频出现本身是有意义的信号），但不进角标、不落盘——
   * 否则一条每次布局都来一遍的通知会让 ⚠ 常亮，人很快对它脱敏，
   * 真正的崩溃就被淹了。
   */
  benign: boolean
}

export interface CrashJournalOptions {
  /** 最多记多少个**不同**的出错点。重复出错只加计数，不占新格。 */
  maxDistinct?: number
  /** 每条新记录（含重复）都会经过这里：落盘、打日志之类的副作用挂在外面。 */
  onRecord?: (record: CrashRecord) => void
  now?: () => number
}

/** 把任意抛出物整理成可读的一行 + 调用栈。字符串、Error、随便什么对象都要能接住。 */
export const describeError = (error: unknown): { message: string; stack: string | null } => {
  if (error instanceof Error) {
    return { message: error.message || error.name, stack: error.stack ?? null }
  }
  if (typeof error === 'string') return { message: error, stack: null }
  if (error === null) return { message: 'null', stack: null }
  if (error === undefined) return { message: 'undefined', stack: null }
  try {
    const json = JSON.stringify(error)
    return { message: json === undefined ? String(error) : json, stack: null }
  } catch {
    return { message: String(error), stack: null }
  }
}

export interface CrashJournal {
  record(scope: string, error: unknown, benign?: boolean): CrashRecord
  list(): CrashRecord[]
  clear(): void
  /**
   * 返回退订函数。装配作用域内的订阅者（模块 mount）必须留得住这条通道：
   * 重试装配会再订阅一遍，同一条崩溃就重绘两次，旧那份还攥着上一张面板不放。
   * 进程生命周期的订阅者（顶栏角标）可以直接丢掉返回值。
   */
  subscribe(cb: (records: CrashRecord[]) => void): () => void
}

/**
 * 已知的良性噪音。每一条都要能说清「为什么它不代表出错」，
 * 拿不准的一律**不要**加进来——这张表越长，防线越形同虚设。
 */
const BENIGN_PATTERNS: readonly { re: RegExp; why: string }[] = [
  {
    // W3C 规范里这是「本轮还有观察者没通知到，需要再跑一轮」的提示，不是异常：
    // 回调里改了 class 或读了 scrollWidth 触发同步布局就会出现。
    // 特征是没有 error 对象、没有调用栈。旧版 Chrome 的文案是 loop limit exceeded。
    re: /ResizeObserver loop (completed with undelivered notifications|limit exceeded)/,
    why: 'ResizeObserver 需要再跑一轮的通知，非异常',
  },
]

export const benignReason = (message: string): string | null =>
  BENIGN_PATTERNS.find((p) => p.re.test(message))?.why ?? null

export const createCrashJournal = (options: CrashJournalOptions = {}): CrashJournal => {
  const maxDistinct = options.maxDistinct ?? 60
  const now = options.now ?? (() => Date.now())
  const records = new Map<string, CrashRecord>()
  const listeners: ((records: CrashRecord[]) => void)[] = []

  const list = () => [...records.values()].sort((a, b) => b.lastTs - a.lastTs)

  const emit = () => {
    const snapshot = list()
    // 订阅者名单先拷一份：回调里退订（自己退或退掉别人）会就地 splice，
    // 边遍历边删会把紧跟其后的那个订阅者整个跳过。
    for (const cb of [...listeners]) {
      try {
        cb(snapshot)
      } catch {
        // 订阅者自己炸了不能反过来拖垮记账：这里是最后一道，不能再往上抛。
      }
    }
  }

  return {
    record(scope, error, benign) {
      const { message, stack } = describeError(error)
      const key = `${scope} ${message}`
      const ts = now()
      const isBenign = benign ?? benignReason(message) != null
      let entry = records.get(key)
      if (entry) {
        entry.count += 1
        entry.lastTs = ts
      } else {
        if (records.size >= maxDistinct) {
          let oldestKey: string | null = null
          let oldestTs = Infinity
          for (const [k, v] of records) {
            if (v.lastTs < oldestTs) {
              oldestTs = v.lastTs
              oldestKey = k
            }
          }
          if (oldestKey != null) records.delete(oldestKey)
        }
        entry = { scope, message, stack, count: 1, firstTs: ts, lastTs: ts, benign: isBenign }
        records.set(key, entry)
      }
      try {
        options.onRecord?.(entry)
      } catch {
        // 落盘失败不能反过来制造新的崩溃
      }
      emit()
      return entry
    },
    list,
    clear() {
      records.clear()
      emit()
    },
    subscribe(cb) {
      listeners.push(cb)
      return () => {
        const at = listeners.indexOf(cb)
        if (at >= 0) listeners.splice(at, 1)
      }
    },
  }
}
