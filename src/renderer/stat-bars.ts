// 属性条的公共渲染件：敌我共用一根固定刻度。图鉴（鉴·舰娘/深海）与列表详情预览
// 共用同一根刻度与同一套分层色语——两处各画一套，同一艘舰会在两个面板里
// 长出不同长度的条。
//
// 「刻度 0—cap」只写进悬停（相当于坐标轴刻度，是数据不是声明）；
// 发布侧一律写「刻度」，不写「固定标尺」（2026-08-20 立）。
import { esc } from './kernel'

const STAT_SCALE: Record<string, number> = {
  耐久: 1000,
  火力: 300,
  装甲: 300,
  雷装: 300,
  对空: 300,
  运: 100,
  回避: 200,
  对潜: 200,
  索敌: 200,
  雷击命中: 100, // 深海侧 KC3 估算(kc3_tacc),实测值域 15-70
}
export const statScale = (label: string) => STAT_SCALE[label.replace(/\*$/, '')] ?? 300
export const statWidth = (value: number, cap: number) =>
  Math.max(0, Math.min(100, (Number(value) / cap) * 100))

// 强化分层段：初始之后每一段声明自己的来源（装备给予/等级成长/婚后99+/结婚/改修），
// 数值文本与轨道同色。值为 null 的段直接不画——缺资料不硬造（数据诚实）。
export interface StatLayerSegment {
  value: number | null
  kind: 'equip' | 'grow' | 'over99' | 'marriage' | 'mod'
}

export const statRowLayered = (
  label: string,
  init: number | null,
  segments: StatLayerSegment[],
  tip: string,
): string => {
  const cap = statScale(label)
  const drawn = segments.filter(
    (segment): segment is StatLayerSegment & { value: number } => segment.value != null,
  )
  const peak = Math.max(init ?? 0, ...drawn.map((segment) => segment.value))
  const title = `${label}刻度 0—${cap}${peak > cap ? ` · ${peak} 已超出刻度` : ''}${tip ? `\n${tip}` : ''}`
  let reached = init ?? 0
  let track = init != null ? `<i class="f1" style="width:${statWidth(init, cap)}%"></i>` : ''
  let text = `<b>${init ?? '?'}</b>`
  for (const segment of drawn) {
    const width = Math.max(0, statWidth(segment.value, cap) - statWidth(reached, cap))
    if (width > 0) track += `<i class="sg-${segment.kind}" style="width:${width}%"></i>`
    // 装备给予是**现在就在身上的**，写成增量「+N」；→ 只留给要靠强化/成长
    // 才能到的未来态（用户 2026-08-11 纠正）。裸值未知时拆不出增量，仍画 →。
    if (segment.kind === 'equip' && init != null) {
      const delta = segment.value - reached
      text += `<span class="sg-t-equip plus">${delta >= 0 ? '+' : ''}${delta}</span>`
    } else {
      text += `<span class="to">→</span><span class="sg-t-${segment.kind}">${segment.value}</span>`
    }
    reached = Math.max(reached, segment.value)
  }
  return `<div class="stat" title="${esc(title)}"><span class="k">${label}</span>
    <span class="v">${text}</span>
    <div class="track">${track}</div></div>`
}
