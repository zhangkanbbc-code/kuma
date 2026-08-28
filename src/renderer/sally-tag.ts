// 出击识别札（贴条）的显示口径。
//
// 铎的「锁船标签」卡与锐的编队行共用这一份配色——两处各写一份，
// 同一个札在两个面板里会是两种颜色，用户没法对照。
//
// 只做显示，不做判断：「这支队能不能进那张图」拿不到判据，见 shared/sally-lock。
import { esc } from './kernel'
import { sallyTagNameOf } from '../shared/sally-names'

export const TAG_COLORS = [
  '#67c98a', '#e8a04c', '#5ab8d8', '#b489ff', '#e06c75', '#8fb87a', '#c9a86a',
  '#8fa8c0', '#e0a94a', '#7db4d8', '#d8b8ff', '#ff9fae', '#8fe0cc', '#e8c66a',
]

export const sallyTagColor = (tag: number): string =>
  TAG_COLORS[(Math.max(1, tag) - 1) % TAG_COLORS.length]

/**
 * 编队行里贴在血条左边的小标记。
 *
 * 札号是游戏给的编号；对应哪支「舰队名」（第三十一战队、多号作战部队……）
 * 游戏一个字都不下发——名字来自第一方每期手录的 shared/sally-names，
 * 查不到就照旧只显示号（`sallyTagNameOf` 返回 null 时不编名字）。
 * 编号本身始终留在标记上：攻略表是按编号排的。
 */
export const sallyMarkHtml = (tag: number, areaId?: number | null): string => {
  if (tag > 0) {
    const named = sallyTagNameOf(areaId, tag)
    const title = named
      ? `出击识别札 ${tag} · ${named.name}\n对应哪支部队看「活动」里的锁船标签卡`
      : `出击识别札 ${tag}\n对应哪支部队看「活动」里的锁船标签卡`
    return `<span class="sally-mark" style="--tag:${sallyTagColor(tag)}"
      title="${esc(title)}">${tag}</span>`
  }
  return `<span class="sally-mark none"
    title="${esc('还没有札\n出击活动图后会被永久打上该阶段对应的札，不可逆')}">—</span>`
}
