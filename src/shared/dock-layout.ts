// 坞位布局落盘前的一道过滤：**临时视图不许被固化成默认页**。
//
// 起因（2026-08-22 用户实机报出）：钦/镖那一格每次启动都停在镖（远征）。
// 根因是「跟游戏走」这个临时切换会被写进配置——游戏打开远征页时，
// `followGameMissionScene` 把那一格切到 `bi`，而切标签这个动作本身就调
// `saveLayout()`；于是玩家每天开局派一次远征，配置里的 active 就被改成 `bi` 一次。
// 离开远征页时虽然会还原，但只要在跟随态里退出应用（或游戏就停在远征页），
// 固化下来的就是 `bi`。他天天开局派远征，于是天天被钉死在那一页。
//
// 一般化的口径：**「跟着外部状态临时切过去」的视图，落盘时要写切过去之前那一页。**
// 判据做成纯函数放在这里，护栏能真跑一遍（渲染层的 mu.ts 脱不开 Electron）。

export interface DockGroupLike {
  mods: string[]
  active?: string
  size?: number
}

export interface DockLayoutLike {
  docks: Record<string, DockGroupLike[]>
}

/** 「此刻是临时切过去的」：哪个坞、第几格、切过去**之前**那一页是谁。 */
export interface TransientTab {
  dock: string
  gi: number
  id: string
}

/**
 * 落盘用的布局快照。处于临时切换态时，把那一格的 active 换回切换前那一页。
 *
 * 只在需要时浅拷贝（大多数调用没有临时态，原样返回，零开销）；
 * 拷贝也只拷到被改的那一格，其余共享——这份东西马上要被 JSON 序列化，够用。
 */
export const layoutForPersist = <T extends DockLayoutLike>(
  layout: T,
  transient: TransientTab | null | undefined,
): T => {
  if (!transient) return layout
  const groups = layout.docks?.[transient.dock]
  const group = groups?.[transient.gi]
  if (!group) return layout
  // 那一页已经不在这一格里了（用户把它拖走/搁置了）：什么都别改，
  // 写一个不存在的 active 比写 bi 更糟
  if (!group.mods.includes(transient.id)) return layout
  if (group.active === transient.id) return layout
  const nextGroups = groups.map((entry, index) =>
    index === transient.gi ? { ...entry, active: transient.id } : entry,
  )
  return { ...layout, docks: { ...layout.docks, [transient.dock]: nextGroups } }
}
