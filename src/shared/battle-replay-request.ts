// 打开战斗复盘窗的请求：哪一场、直达哪个视图。
//
// 走的还是原来那两条通道（window:battle-replay 进主进程、battle-replay:open 进复盘窗），
// 不新增 IPC：旧调用方只传一个数字（快照 id）照旧能用，要直达动画视图的传对象。
// 主进程与复盘窗都用这一份解析，免得两头各认一种形状。

export type BattleReplayView = 'detail' | 'animate'

export interface BattleReplayRequest {
  snapshotId: number
  /** null = 不指定，复盘窗保持当前视图（新开的窗默认详情） */
  view: BattleReplayView | null
}

export const parseBattleReplayRequest = (raw: unknown): BattleReplayRequest | null => {
  const object = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
  const snapshotId = Number(object ? object.snapshotId : raw)
  if (!Number.isInteger(snapshotId) || snapshotId <= 0) return null
  const view = object && (object.view === 'detail' || object.view === 'animate') ? object.view : null
  return { snapshotId, view }
}
