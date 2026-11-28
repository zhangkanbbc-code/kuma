// 编队血条的档色跟着宽度过渡（2026-11-28 他报血条「颜色抽动」，要「自然流畅一点」）。
//
// 血条按档上色（index.html 的 .hp-g / .hp-y / .hp-o / .hp-r / .hp-d），整块重画时类名一换，整条颜色当场跳过去，
// 而宽度还在 0.42 秒里慢慢走——颜色先到、宽度后到，看着就是一抽。现在颜色也排进同一条时间线：
// 宽度每跨过一条档线，恰好在那一刻到新档的颜色，两条档线之间平滑过渡；入渠 ↔ 出渠在整段里渐变。
// 这里只算「哪个时刻该是哪一档」，颜色取值在样式表（--hpbar-*），纯逻辑、无 DOM。

export type BarTone = 'g' | 'y' | 'o' | 'r' | 'd'

/** 与 ru.ts 的 hpClassOf 同一套档线：≤25% 红、≤50% 橙、≤75% 黄、其余绿；在渠为水青 */
export const barToneAt = (pct: number, docked: boolean): BarTone =>
  docked ? 'd' : pct <= 25 ? 'r' : pct <= 50 ? 'o' : pct <= 75 ? 'y' : 'g'

export interface BarToneStop {
  /** 在宽度动画里的位置（0..1，与宽度同一条缓动：宽度在这一刻正好压在档线上） */
  offset: number
  tone: BarTone
}

const LINES = [25, 50, 75] as const

/**
 * 宽度从 from 走到 to（百分比）时颜色的关键位置。起点是起点那一档，终点是终点那一档，
 * 中间每跨一条档线加一处（到线那一刻换成线那一侧的新档）。在渠 ↔ 出渠不按档线切，整段渐变。
 * 全程同一档就给空数组（不必加颜色动画）。
 */
export const barToneStops = (from: number, to: number, fromDocked: boolean, toDocked: boolean): BarToneStop[] => {
  const start = barToneAt(from, fromDocked)
  const end = barToneAt(to, toDocked)
  const stops: BarToneStop[] = [{ offset: 0, tone: start }]
  if (!fromDocked && !toDocked && Math.abs(to - from) > 1e-9) {
    const up = to > from
    const crossed = LINES.filter((x) => (up ? from <= x && x < to : to <= x && x < from))
    if (!up) crossed.reverse()
    for (const x of crossed) {
      stops.push({ offset: (x - from) / (to - from), tone: barToneAt(up ? x + 1e-6 : x, false) })
    }
  }
  stops.push({ offset: 1, tone: end })
  return stops.every((stop) => stop.tone === start) ? [] : stops
}
