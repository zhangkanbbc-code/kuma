// 弹卡（铃的右下那摞通知卡）落在哪：参照系 × 四角。**纯逻辑，不碰任何 node 内建**——
// 渲染层（铃的弹窗位置卡）要 import 它，而渲染层打包目标是 browser。
// 真正摆位置的是 modules/lg.ts 的 placeToastBox 与 index.html 的 #lg-toasts 那几条规则。
//
// 三个参照系：游戏画面（#game-wrapper 内绝对定位）/ kuma 窗口（body 上 fixed）/
// 整块屏幕（要一扇独立的置顶小窗，见 TOAST_ANCHORS_READY）。

export const TOAST_ANCHORS = ['game', 'app', 'screen'] as const
export type ToastAnchor = (typeof TOAST_ANCHORS)[number]

export const TOAST_CORNERS = ['tl', 'tr', 'bl', 'br'] as const
export type ToastCorner = (typeof TOAST_CORNERS)[number]

/** 玩家看到的参照系名字。id 与文案同处一份，别在渲染层另写一张表 */
export const TOAST_ANCHOR_LABEL: Record<ToastAnchor, string> = {
  game: '游戏画面',
  app: 'kuma 窗口',
  screen: '整块屏幕',
}

export const TOAST_CORNER_LABEL: Record<ToastCorner, string> = {
  tl: '左上',
  tr: '右上',
  bl: '左下',
  br: '右下',
}

/**
 * 眼下真能摆出来的参照系。
 *
 * screen 不在列：它要的不是一条 CSS 规则，而是一扇独立的置顶小窗
 *（frameless + alwaysOnTop + skipTaskbar + focusable:false 的 BrowserWindow，
 * 自带一份渲染层入口，弹卡内容与点击落点全靠 IPC 两头跑）。这一档没做，
 * 界面上那枚按钮是灰的，配置里万一存进了 screen 也会被 readToastPosition 退回默认。
 */
export const TOAST_ANCHORS_READY: readonly ToastAnchor[] = ['game', 'app']

/**
 * 叶子路径。**读写一律走叶子**，理由同 push-config：config 的 setByPath 写叶子时会把
 * 父对象就地变成「只有这一个键」的半份对象，整对象读到那份半份就不再回落默认值。
 */
export const TOAST_POSITION_PATHS = {
  anchor: 'kuma.toast.anchor',
  corner: 'kuma.toast.corner',
} as const

/**
 * 默认值 = 可配之前那个写死的落点（游戏画面右下角，用户 2026-08-11 定的）。
 * 从旧版升上来的人一个键都没存过，读出来的仍是原位。
 */
export const TOAST_POSITION_DEFAULTS = {
  anchor: 'game' as ToastAnchor,
  corner: 'br' as ToastCorner,
}

export interface ToastPosition {
  anchor: ToastAnchor
  corner: ToastCorner
}

/** config.get 的形状（渲染层给 remote 拿到的那份） */
export type ToastConfigReader = (path: string, fallback: unknown) => unknown

export const readToastPosition = (get: ToastConfigReader): ToastPosition => {
  const anchor = `${get(TOAST_POSITION_PATHS.anchor, TOAST_POSITION_DEFAULTS.anchor) ?? ''}`
  const corner = `${get(TOAST_POSITION_PATHS.corner, TOAST_POSITION_DEFAULTS.corner) ?? ''}`
  return {
    // 认不出的、以及还没实装的参照系一律退回默认：存了一个摆不出来的落点，
    // 弹卡就没有归宿，而通知丢失是这里最坏的失败方向
    anchor: (TOAST_ANCHORS_READY as readonly string[]).includes(anchor)
      ? (anchor as ToastAnchor)
      : TOAST_POSITION_DEFAULTS.anchor,
    corner: (TOAST_CORNERS as readonly string[]).includes(corner)
      ? (corner as ToastCorner)
      : TOAST_POSITION_DEFAULTS.corner,
  }
}
