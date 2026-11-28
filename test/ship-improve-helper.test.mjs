// 舰娘图鉴的「装备改修助手」（他 2026-11-28 要「给舰娘的图鉴加入装备改修助手」）：
// 这一形态能当哪些装备的改修二号舰、星期几、★max 能不能顺手更新；日程照改修资料，游戏实测改过的那天照实测画。
// 渲染段原样从 ji.ts 切出来真编译，资料用随包改修表，实测用随包维护者实测（周六村雨改二改不了 22 号对水上电探）。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'

const require = createRequire(import.meta.url)
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const source = fs.readFileSync(path.join(ROOT, 'src/renderer/modules/ji.ts'), 'utf8').replace(/\r\n/g, '\n')
const sliceBetween = (from, to, label) => {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start + from.length)
  assert.ok(start >= 0 && end > start, `ji.ts 里找不到「${label}」，这条守卫的锚点要跟着改`)
  return source.slice(start, end)
}
const CHIPS = `${sliceBetween('const CALENDAR_WEEKDAY_CHIPS = [', '] as const', 'CALENDAR_WEEKDAY_CHIPS')}] as const`
const WEEK = sliceBetween('/** 七枚圆点的周历', '/** 素材现在手上有几件', 'improveWeekHtml')
const FACT_SOURCE = sliceBetween('/** 实测的出处', '/** 这件装备的全部实测', 'improveFactSource')
const HELPER = sliceBetween('// ---- 装备改修助手（舰娘图鉴）----', 'const equipMatrixHtml = (', '装备改修助手')
const abs = (...parts) => path.join(ROOT, ...parts).replace(/\\/g, '/')

const HARNESS = `
import type { ImproveFact } from '${abs('src', 'shared', 'improve-observed.ts')}'
export const stub: any = { table: [], facts: new Map(), day: 6, equips: {}, ships: {}, held: {} }
const esc = (s: unknown) => \`\${s ?? ''}\`.replace(/[&<>"']/g, (c) => \`&#\${c.charCodeAt(0)};\`)
let eoByEquip = new Map<number, any>()
export const setTable = (rows: any[]) => { eoByEquip = new Map(rows.map((row) => [row.eq_id, row])) }
const improveFactsNow = () => stub.facts
const jstDayOfWeek = () => stub.day
const JST_WEEKDAY_LABELS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
const fmtMonthDay = (ts: number) => new Date(ts).toISOString().slice(5, 10)
const masterShipName = (id: number) => stub.ships[id] ?? \`舰娘 #\${id}\`
const friendlyEquips = { get: (id: number) => stub.equips[id] }
const equipInstancesOf = (id: number) => Array.from({ length: stub.held[id] ?? 0 }, (_, i) => [\`\${i}\`, { mstId: id }])
const equipVisualLink = (id: number) => \`<a class="el" data-mstEquip="\${id}">\${esc(stub.equips[id]?.api_name ?? \`#\${id}\`)}</a>\`

${CHIPS}

${WEEK}

${FACT_SOURCE}

${HELPER}

export { shipImproveHelperHtml, improveHelperEntries }
`
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-ship-improve-helper-'))
const entry = path.join(dir, 'helper.ts')
fs.writeFileSync(entry, HARNESS)
const outfile = path.join(dir, 'helper.cjs')
buildSync({ entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' })
const loaded = require(outfile)
fs.rmSync(dir, { recursive: true, force: true })

const obs = require(path.join(ROOT, 'dist/shared/improve-observed.js'))
const table = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/lodes/equip-improve.json'), 'utf8')).data
const MURASAME_K2 = 498
const SAT = 6

const setup = (extra = {}) => {
  loaded.setTable(table)
  Object.assign(loaded.stub, {
    facts: obs.improveFactsOf([], table),
    day: SAT,
    equips: { 28: { api_name: '22号対水上電探', api_type: [5, 8, 12, 11] }, 13: { api_name: '61cm四連装魚雷', api_type: [1, 2, 5, 5] } },
    ships: { [MURASAME_K2]: '村雨改二' },
    held: { 28: 2 },
    ...extra,
  })
}
const rowOf = (html, eq) => html.split('<div class="ih-row').find((part) => part.includes(`data-mstEquip="${eq}"`)) ?? ''

test('村雨改二：资料里当二号舰的装备全列，周六实测不可的 22 号划掉那天并挂实测，★max 能更新的写目标，持有数照实', () => {
  setup()
  const tableEquips = table.filter((e) => e.improvement.some((imp) => imp.helpers.some((h) => h.ship_ids.includes(MURASAME_K2)))).map((e) => e.eq_id)
  assert.ok(tableEquips.includes(28), '资料前提：村雨改二是 22 号的二号舰')
  const html = loaded.shipImproveHelperHtml(MURASAME_K2, [MURASAME_K2])
  for (const eq of tableEquips) assert.ok(rowOf(html, eq), `资料里的 ${eq} 要列出来`)
  const radar = rowOf(html, 28)
  assert.match(radar, /<span class="day out" title="星期六 · 实测不可（维护者实测 11-28）">六<\/span>/)
  assert.match(radar, /<span class="ti-observed" title="星期六实测不可（维护者实测 11-28）">实测<\/span>/)
  assert.match(radar, /<i>持有 2<\/i>/)
  assert.match(radar, /<span class="ih-to">★max 可更新 → <a class="el" data-mstEquip="\d+">/)
  assert.doesNotMatch(radar, /^ today/, '周六实测不可：不算今天能改')
  // 61cm 四连装鱼雷：维护者实测周六可
  assert.match(rowOf(html, 13), /class="day on[^"]*"[^>]*>六</)
})

test('今天能改的排前面、标出来；抬头写共几件、今天几件', () => {
  setup()
  const html = loaded.shipImproveHelperHtml(MURASAME_K2, [MURASAME_K2])
  const entries = loaded.improveHelperEntries(MURASAME_K2)
  const todayCount = [...entries.values()].filter((entry) => entry.days.has(SAT)).length
  assert.match(html, new RegExp(`<span class="aux ok">共 ${entries.size} 件 · 星期六可改 ${todayCount} 件</span>`))
  const parts = html.split('<div class="ih-row').slice(1)
  const flags = parts.map((part) => part.startsWith(' today'))
  assert.deepEqual(flags, [...flags].sort((a, b) => Number(b) - Number(a)), '今天能改的全在前面')
  assert.equal(flags.filter(Boolean).length, todayCount)
})

test('游戏清单实测可、资料完全没写的装备也列出来（点亮那天加框）', () => {
  const facts = obs.improveFactsOf([{ ts: Date.parse('2026-11-28T16:50:00+09:00'), day: SAT, flagship: 182, helper: MURASAME_K2, items: [585] }], table, [])
  setup({ facts })
  const html = loaded.shipImproveHelperHtml(MURASAME_K2, [MURASAME_K2])
  assert.match(rowOf(html, 585), /<span class="day on observed" title="星期六 · 实测可（游戏实测 11-28）">六<\/span>/)
})

test('这一形态不当二号舰、同链别的形态当：点名那个形态（可点）；整条链都不当就不出这一段', () => {
  setup()
  const html = loaded.shipImproveHelperHtml(999998, [999998, MURASAME_K2])
  assert.match(html, /<span class="aux">本形态暂无<\/span>/)
  assert.match(html, /本形态暂无 · 同改装链 <a data-helper-form="498">村雨改二<\/a> \d+ 件/)
  assert.equal(loaded.shipImproveHelperHtml(999998, [999998, 999999]), '')
})
