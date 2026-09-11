/**
 * 突入字幕纵向接排，输入与输出均为画面高的百分比。
 * reserve 16 ≈ 僚舰封顶字号两行：2 × 6.5 × 1.2 = 15.6。
 * edge 3 与横向夹住的 3% / 97% 同一口径；gap 2 留出两句之间的空行感。
 */
export const cutinVerticalLayout = ({
  anchorY, leadHeight, wingHeight, edge = 3, reserve = 16, gap = 2,
}: {
  anchorY: number
  leadHeight: number
  wingHeight?: number
  edge?: number
  reserve?: number
  gap?: number
}): { leadCenter: number; wingCenter: number | null } => {
  let leadCenter = anchorY
  const leadBottomLimit = 100 - edge - reserve - gap
  if (leadCenter + leadHeight / 2 > leadBottomLimit) {
    leadCenter = Math.max(edge + leadHeight / 2, leadBottomLimit - leadHeight / 2)
  }
  const wingCenter = wingHeight === undefined ? null : Math.min(
    leadCenter + leadHeight / 2 + gap + wingHeight / 2,
    100 - edge - wingHeight / 2,
  )
  return { leadCenter, wingCenter }
}
