/** CSS 游戏行保底与卡片可用高度共用这一份比例。 */
export const DISTRACT_GAME_MIN_RATIO = 0.45
export const DISTRACT_CARD_MIN_ZOOM = 0.6

/** scrollHeight 是未乘 zoom 的布局高度；第二遍直接传重排后的高度，不再乘上一遍比例。 */
export const distractCardZoom = (
  availableHeight: number, naturalHeight: number, minZoom = DISTRACT_CARD_MIN_ZOOM,
): number => naturalHeight <= 0 ? 1 : Math.max(minZoom, Math.min(1, availableHeight / naturalHeight))
