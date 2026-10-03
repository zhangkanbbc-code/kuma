import { esc } from './kernel'
import type { SenkaCalendarModel } from '../shared/senka-calendar'

export const senkaCalendarHtml = (model: SenkaCalendarModel): string => {
  const cells = model.weeks.flat().map(cell => {
    if (!cell) return '<div class="sc-cell blank"></div>'
    const { day, date, gain, rank, rankDelta, future, today, tail = 0 } = cell
    const heat = !future && gain > 0 && model.maxGain > 0 ? (gain / model.maxGain).toFixed(2) : '0'
    return `<div class="sc-cell${today ? ' today' : ''}${future ? ' future' : ''}" data-day="${esc(day)}" style="--heat:${heat}">
      <div class="sc-d">${date}</div>
      ${gain > 0 && !future ? `<div class="sc-g">+${Math.round(gain)}</div>` : ''}
      ${rank != null && !future ? `<div class="sc-r">第${rank}名${rankDelta ? ` <span class="${rankDelta > 0 ? 'up' : 'down'}">${rankDelta > 0 ? '↑' : '↓'}${Math.abs(rankDelta)}</span>` : ''}</div>` : ''}
      ${Math.round(tail) > 0 ? `<div class="sc-t" title="22点后的战果，计入下月">↪+${Math.round(tail)}</div>` : ''}
    </div>`
  }).join('')
  return `<div class="sc-nav"><button data-cal-nav="-1"${model.canPrev ? '' : ' disabled'}>‹</button><span>${esc(model.label)}</span><button data-cal-nav="1"${model.canNext ? '' : ' disabled'}>›</button></div>
    ${Math.round(model.head) > 0 ? `<div class="sc-head">上月末22点后 +${Math.round(model.head)} 计入本月</div>` : ''}
    <div class="sc-grid">${['一', '二', '三', '四', '五', '六', '日'].map(day => `<span class="sc-wd">${day}</span>`).join('')}${cells}</div>
    <div class="sc-total">本月 +${Math.round(model.total)}${model.latestRank != null ? ` · 第${model.latestRank}名` : ''}</div>`
}
