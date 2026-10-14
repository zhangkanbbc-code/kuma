// 季节企划看板（南瓜/秋刀鱼这类收集兑换）的抬头（2026-10-14 维护者截图）：
// 右上角原本挂着「活动海域未开放」——它只是说明「没有活动图所以显示企划」，跟企划本身无关，
// 摆在一眼位置像是南瓜祭的状态标签。裁决：去掉，抬头只留「季节企划 · 收集与兑换」。
// 视图段从 du.ts 原样切出来跑，外部名字补桩。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import { transformSync } from 'esbuild'

const du = readFileSync(new URL('../src/renderer/modules/du.ts', import.meta.url), 'utf8')
const a = du.indexOf('const CAMPAIGN_PERIOD_ORDER'), b = du.indexOf('const render = () =>', a)
assert.ok(a >= 0 && b > a, '缺少季节企划视图段')
const context = vm.createContext({
  campaignHistory: [],
  fmtDateTime: () => '2026-10-14 20:39',
  mg: { quests: { 984: { title: '【期間限定任務】14年目実りの秋、南瓜始め！', state: 2, progressFlag: 0 } }, useitemsTs: Date.parse('2026-10-14T20:39:14+09:00') },
  esc: (s) => `${s ?? ''}`.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
  elink: (_d, id, name) => `<a data-quest="${id}">${name}</a>`,
  fmtTime: () => '20:39:14',
  CAMPAIGN_PERIOD_LABEL: { limited: '限定', unknown: '目录未收录' },
})
vm.runInContext(transformSync(`${du.slice(a, b)}\nglobalThis.result = campaignViewHtml`, { loader: 'ts', format: 'cjs' }).code, context)
const html = context.result([{ key: 'pumpkin', zhLabel: '南瓜', jpName: '南瓜', seasonNote: '万圣节前后', stock: 0, quests: [{ no: 984, period: 'unknown' }] }])

test('季节企划抬头不再挂「活动海域未开放」，企划卡照旧', () => {
  assert.ok(!html.includes('活动海域未开放'))
  assert.match(html, /季节企划/)
  assert.match(html, /收集与兑换/)
  assert.match(html, /南瓜/)
  assert.match(html, /14年目実りの秋、南瓜始め/)
})
