import { esc } from './kernel'
import { fillLineGaps } from '../shared/senka-ranking'
import type { SenkaRankingView } from '../shared/senka-ranking'

const ranks = [5, 20, 100, 500] as const
const labels = { 5: '联合·5位', 20: '一群·20位', 100: '二群·100位', 500: '三群·500位' }

export const senkaRankingHtml = (view: SenkaRankingView): string => {
  const refresh = view.refreshAt == null ? null : new Date(view.refreshAt + 9 * 3600_000)
  const time = refresh ? `${refresh.getUTCMonth() + 1}月${refresh.getUTCDate()}日 ${refresh.getUTCHours()}:00 刷新` : ''
  const server = view.server
    ? `<span${view.serverInferred ? ' title="按当前账号的服务器补记"' : ''}>${esc(view.server.name)}</span>`
    : ''
  const heading = `<div class="sd-h">排行<i>${server}${server && time ? ' · ' : ''}${time}</i></div>`
  const series = ranks.map(rank => ({ rank, line: fillLineGaps(view.lines[rank]) }))
  const points = series.flatMap(({ line }) => line)
  if (view.refreshAt == null && !points.length) {
    // 与 zi.ts 的指路一致：游戏菜单原字必须保留，玩家才找得到。
    return `<div class="sd-block sd-rank">${heading}<div class="sd-note2">本月还没打开过游戏排行页 · 在游戏「戦績表示 → ランキング」打开后自动读取</div></div>`
  }
  const rows = view.rows.map(({ rank, nickname, senka, own }) =>
    `<div class="sd-rank-row${own ? ' me' : ''}"><span class="r">第${rank}名</span><span class="n">${esc(nickname)}</span><b>${Math.round(senka).toLocaleString()}</b></div>`,
  ).join('')
  const chart = (() => {
    if (!points.length) return '<svg class="sd-rank-chart" viewBox="0 0 480 180"></svg>'
    const days = [...new Set(points.map(point => point.day))].sort()
    const first = Date.parse(days[0])
    const last = Date.parse(days[days.length - 1])
    const low = Math.min(...points.map(point => point.senka))
    const high = Math.max(...points.map(point => point.senka))
    const step = Math.max(1, Math.ceil((high - low) / 4 / 100) * 100)
    const bottom = Math.floor(low / step) * step
    const top = Math.max(bottom + step, Math.ceil(high / step) * step)
    const x = (day: string) => last === first ? 260 : 52 + (Date.parse(day) - first) / (last - first) * 412
    const y = (value: number) => 150 - (value - bottom) / (top - bottom) * 138
    const ticks: string[] = []
    for (let value = bottom; value <= top; value += step) {
      ticks.push(`<path class="sd-rank-grid" d="M52 ${y(value)}H464"/><text x="46" y="${y(value) + 3}" text-anchor="end">${value.toLocaleString()}</text>`)
    }
    // 日期按实际间距定位；只标最多五天，避免密集日期挤在一起。
    const dayLabels = days.filter((_, i) => i % Math.max(1, Math.ceil((days.length - 1) / 4)) === 0)
      .map(day => `<text x="${x(day)}" y="171" text-anchor="middle">${Number(day.slice(5, 7))}/${Number(day.slice(8))}</text>`).join('')
    const lines = series.map(({ rank, line }) => {
      if (!line.length) return ''
      if (line.length === 1) return `<circle class="ln-${rank}" cx="${x(line[0].day)}" cy="${y(line[0].senka)}" r="3"/>`
      const estimates = line.filter(point => point.estimated).map(point =>
        `<circle class="ln-${rank} est" cx="${x(point.day)}" cy="${y(point.senka)}" r="3"/>`,
      ).join('')
      return `<polyline class="ln-${rank}" points="${line.map(point => `${x(point.day)},${y(point.senka)}`).join(' ')}"/>${estimates}`
    }).join('')
    return `<svg class="sd-rank-chart" viewBox="0 0 480 180">${ticks.join('')}${dayLabels}${lines}</svg>`
  })()
  const legend = ranks.map(rank => `<span class="ln-${rank}">${labels[rank]}${view.lines[rank].length ? '' : ' · 暂无'}</span>`).join('')
  return `<div class="sd-block sd-rank">${heading}<div class="sd-rank-rows">${rows}</div>${chart}<div class="sd-rank-legend">${legend}</div>${view.undecoded > 0 ? `<div class="sd-note2">本月有${view.undecoded}页排行未能解读</div>` : ''}</div>`
}
