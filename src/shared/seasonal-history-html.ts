// 两处回顾共用短文案；纯渲染函数可直接行为测试。
import type { CampaignHistory, CampaignReceipt, CampaignReward, ObservedQuest } from './seasonal-history'
import { CAMPAIGN_MATERIAL_NAMES } from './seasonal-history'

const esc = (text: unknown) => `${text ?? ''}`.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)
export interface CampaignHtmlContext {
  nameOf: (reward: CampaignReward) => string
  time: (ts: number) => string
}
export const campaignRecipeLabel = (recipe: string): string => ({
  yokan: '南瓜羊羹', party: 'Party Gift', powerup: '近代化改修', quest: '任务消耗', other: '其他', unknown: '未识别',
}[recipe] ?? recipe)

export const campaignRewardsHtml = (rewards: CampaignReward[], ctx: CampaignHtmlContext): string =>
  rewards.map(r => `${esc(r.kind === 'material' ? CAMPAIGN_MATERIAL_NAMES[r.id - 1] ?? '未识别' : r.kind === 'unknown' ? '未识别' : ctx.nameOf(r))}${r.count > 0 ? ` ×${r.count}` : ''}`).join(' + ') || '未识别'

const receiptHtml = (r: CampaignReceipt, ctx: CampaignHtmlContext) =>
  `<div class="gnote2">${esc(ctx.time(r.ts))} · ${esc(campaignRecipeLabel(r.recipe))}${r.recipe === 'unknown' && r.exchangeType != null ? ` #${r.exchangeType}` : ''} · 花 ${r.cost ?? '未识别'} 个 · ${r.recipe === 'powerup' ? r.target?.mstId ? esc(ctx.nameOf({ kind: 'unknown', id: r.target.mstId, count: 1, name: 'ship' })) : r.target?.rosterId ? `舰娘 #${r.target.rosterId}` : '对象未识别' : campaignRewardsHtml(r.rewards, ctx)}</div>`

const taskLabel = (q: { no?: number; code?: string; title?: string }) =>
  `${esc(q.code)} / #${q.no} ${esc(q.title?.replace(/^【[^】]*】/, ''))}`

export const questHistoryHtml = (quests: ObservedQuest[], keep: string, ctx: CampaignHtmlContext): string => {
  if (!quests.length) return ''
  return `<details class="shi-event-drops gnote2" data-keep="quests:${esc(keep)}"><summary>本季任务 · ${quests.length}</summary><div>${quests.map(q =>
    `<div><b>#${q.no} ${esc(q.title.replace(/^【[^】]*】/, ''))}</b> · ${q.claims.length ? '已完成' : '未完成'}${q.lastSeen ? ` · 最后见于 ${esc(ctx.time(q.lastSeen))}` : ''}${q.claims.map(c => `<div>${esc(ctx.time(c.ts))}${c.selectNo != null ? ` · 选择 ${esc(c.selectNo)}` : ''}${c.selectNo2 != null ? ` / ${esc(c.selectNo2)}` : ''} · ${campaignRewardsHtml(c.rewards, ctx)}</div>`).join('')}</div>`).join('')}</div></details>`
}

export const campaignSummaryHtml = (h: CampaignHistory, ctx: CampaignHtmlContext): string => {
  const taskTimes = h.sources.filter(s => s.no != null).reduce((times, s) => times + s.times, 0)
  const sources = [taskTimes ? `任务 ${taskTimes} 次` : '', ...h.sources.filter(s => s.no == null).map(s => `其他 ${s.count} 个`)].filter(Boolean).join(' · ')
  return `<div class="cq-row"><b>获得 ${h.gained} · 花掉 ${h.spent}${h.stock == null ? '' : ` · 现有 ${h.stock}`}</b></div>
   <div class="gnote2">来源 ${sources || '暂无记录'}</div>
   <div class="gnote2">去向 ${h.uses.map(u => `${esc(campaignRecipeLabel(u.recipe))}${u.recipe === 'quest' ? ` ${taskLabel(u)}` : ''} ${u.times} 次${u.recipe === 'quest' ? ` · ${u.count} 个` : ''}`).join(' · ') || '暂无记录'}</div>
   ${h.rewards.length ? `<div class="gnote2">换得：${campaignRewardsHtml(h.rewards, ctx)}</div>` : ''}
   ${h.party.map(r => `<div class="gnote2">已领：${campaignRewardsHtml(r.rewards, ctx)} · ${esc(ctx.time(r.ts))}</div>`).join('')}`
}

export const campaignRecordsHtml = (h: CampaignHistory, ctx: CampaignHtmlContext, archive = false): string => {
  const key = `${h.key}:${h.opened}`
  const rows = [...h.receipts].reverse()
  const detail = `${h.sources.map(s => `<div class="gnote2">${s.no == null ? '其他来源' : `#${s.no} ${esc(s.title.replace(/^【[^】]*】/, ''))}`} · 得到 ${s.count} 个</div>`).join('')}
    ${rows.map(r => receiptHtml(r, ctx)).join('')}
    ${[...(h.taskUses ?? [])].reverse().map(u => `<div class="gnote2">${esc(ctx.time(u.ts))} · 任务消耗 · 花 ${u.count} 个 · ${taskLabel(u)}</div>`).join('')}
    ${h.otherUses.map(u => `<div class="gnote2">${esc(ctx.time(u.ts))} · 其他 · 花 ${u.count} 个</div>`).join('')}`
  const details = `<details class="shi-event-drops gnote2" data-keep="campaign:${esc(key)}"><summary>来源与去向</summary><div>${detail}</div></details>`
  if (archive) return `${details}${questHistoryHtml(h.quests, key, ctx)}`
  return `${rows.length ? '<div class="gnote2">兑换记录</div>' : ''}${rows.slice(0, 3).map(r => receiptHtml(r, ctx)).join('')}${rows.length > 3 ? `<details class="op-more" data-keep="campaign-records:${esc(key)}"><summary>全部记录 · ${rows.length}</summary>${rows.map(r => receiptHtml(r, ctx)).join('')}</details>` : ''}${details}${questHistoryHtml(h.quests, key, ctx)}`
}
