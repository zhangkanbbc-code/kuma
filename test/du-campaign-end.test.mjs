import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import { transformSync } from 'esbuild'

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8')
const du = read('../src/renderer/modules/du.ts')
const kernel = read('../src/renderer/kernel.ts')
const cut = (source, start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length)
  assert.ok(a >= 0 && b > a, `缺少渲染代码：${start}`)
  return source.slice(a, b)
}
const endsAt = Date.parse('2026-11-11T13:00:00+09:00')
const campaign = { key: 'pumpkin', zhLabel: '南瓜', jpName: '南瓜', seasonNote: '万圣节前后', stock: 7, quests: [], endsAt, remainingUsableUntilMaintenance: true }
const runtime = (now) => {
  const clock = { now }
  const context = vm.createContext({
    module: { exports: {} },
    Date: class extends Date { static now() { return clock.now } },
    campaignHistory: [], mg: { quests: {}, useitemsTs: null },
    CAMPAIGN_PERIOD_LABEL: {},
  })
  vm.runInContext(transformSync([
    cut(kernel, 'export const esc =', '\nexport const fmtTime ='),
    cut(kernel, 'export const fmtTime =', '\nexport const jstHourOf ='),
    cut(kernel, 'export const fmtDurationLong =', '\nexport const masterShipName ='),
    cut(kernel, 'export const updateCountdowns =', '\n// ---- 公共工具 ----'),
    cut(du, 'const CAMPAIGN_PERIOD_ORDER', '\nconst render = () =>'),
    'globalThis.api = { campaignCardHtml, fmtDateTime, fmtDurationLong, updateCountdowns, updateCampaignCountdowns }',
  ].join('\n'), { loader: 'ts', format: 'cjs' }).code, context)
  return { clock, ...context.api }
}

test('结束前卡片沿用日期格式与月周日时倒计时，放在持有数旁', () => {
  const api = runtime(endsAt - (39 * 24 + 5) * 3600000)
  const html = api.campaignCardHtml(campaign)
  assert.ok(html.includes(`任务结束 ${api.fmtDateTime(endsAt)}`))
  assert.ok(html.includes(`<span data-cdl="${endsAt}" data-cdl-done="已结束">1月1周2日5时</span>`))
  assert.ok(html.indexOf('持有 <b>7</b>') < html.indexOf('任务结束 '))
  assert.match(html, /data-campaign-stock-until="\d+" hidden>剩余南瓜可用至下次维护/)
  assert.doesNotMatch(html, /已重置/)
})

test('同一卡片的倒计时随既有刷新跨过结束时刻，无需重画', () => {
  const api = runtime(endsAt - 3600000)
  const html = api.campaignCardHtml(campaign)
  const attrs = /<span data-cdl="(\d+)" data-cdl-done="([^"]+)">([^<]+)<\/span>/.exec(html)
  assert.ok(attrs)
  const el = { dataset: { cdl: attrs[1], cdlDone: attrs[2] }, textContent: attrs[3] }
  const legacy = { dataset: { cdl: attrs[1] }, textContent: '' }
  const noteAttrs = /data-campaign-stock-until="(\d+)"( hidden)?>/.exec(html)
  assert.ok(noteAttrs)
  const note = { dataset: { campaignStockUntil: noteAttrs[1] }, hidden: !!noteAttrs[2] }
  const root = { querySelectorAll: selector => selector === '[data-cdl]' ? [el, legacy]
    : selector === '[data-campaign-stock-until]' ? [note] : [] }
  assert.equal(el.textContent, '1时00分')
  assert.equal(note.hidden, true)
  api.clock.now += 1800000
  api.updateCampaignCountdowns(root)
  assert.equal(el.textContent, '0时30分')
  assert.equal(note.hidden, true)
  for (const now of [endsAt, endsAt + 86400000]) {
    api.clock.now = now
    api.updateCampaignCountdowns(root)
    assert.equal(el.textContent, '已结束')
    assert.equal(note.hidden, false)
    assert.equal(legacy.textContent, '已重置', '未设置到点文案的原有倒计时保持不变')
    const after = api.campaignCardHtml(campaign)
    assert.match(after, /data-cdl-done="已结束">已结束<\/span>/)
    assert.match(after, /持有 <b>7<\/b>/)
    assert.doesNotMatch(after, /已重置/)
  }
})

test('维护者裁决 2026-11-13：结束后持有 3 显示期限，持有 0 不显示，道具名取中文标签', () => {
  const api = runtime(endsAt)
  const html = api.campaignCardHtml({ ...campaign, stock: 3 })
  assert.ok(html.includes(`任务结束 ${api.fmtDateTime(endsAt)} · <span data-cdl="${endsAt}" data-cdl-done="已结束">已结束</span>`))
  assert.ok(html.includes(`<div class="gnote2" data-campaign-stock-until="${endsAt}">剩余南瓜可用至下次维护</div>`))
  assert.doesNotMatch(api.campaignCardHtml({ ...campaign, stock: 0 }), /data-campaign-stock-until|剩余南瓜/)
  assert.match(api.campaignCardHtml({ ...campaign, zhLabel: '秋刀鱼' }), /剩余秋刀鱼可用至下次维护/)
})

test('未登记剩余道具期限时仅保留任务结束行', () => {
  const api = runtime(endsAt)
  const { remainingUsableUntilMaintenance: _, ...withoutNote } = campaign
  const html = api.campaignCardHtml(withoutNote)
  assert.ok(html.includes(`任务结束 ${api.fmtDateTime(endsAt)}`))
  assert.doesNotMatch(html, /data-campaign-stock-until|可用至下次维护/)
  assert.equal(html, api.campaignCardHtml({ ...campaign, remainingUsableUntilMaintenance: false }))
})

test('未登记结束时刻时保留原卡片 HTML', () => {
  const api = runtime(endsAt)
  const { endsAt: _, ...undated } = campaign
  assert.equal(api.campaignCardHtml(undated), `<div class="card" style="--hc:var(--gold)">
    <div class="h"><b>南瓜</b><span>南瓜</span>
      <span class="aux">历届时节：万圣节前后</span></div>
    <div class="cq-stock">持有 <b>7</b></div>
    ${''}
    ${''}
    <div class="gnote2">现役任务暂无该道具相关项</div>
  </div>`)
})
