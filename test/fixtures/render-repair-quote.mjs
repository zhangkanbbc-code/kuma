// 真编译 kernel 的时长格式、编队报价及完整详情预览；只为无关的界面依赖补桩。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const cut = (source, from, to) => {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `找不到产物测试的源码锚点：${from}`)
  return source.slice(start, end)
}

export const DURATIONS = cut(read('src/renderer/kernel.ts'), 'export const repairDuration =', '// H:MM:SS 倒计时')
const quote = cut(read('src/renderer/modules/ru.ts'), 'const repairQuoteHtml =', '\n/**')
const preview = cut(read('src/renderer/modules/qa.ts'), 'const previewHtml =', '\nconst cmpbarHtml =')
const shared = path.join(ROOT, 'src/shared/berth-repair.ts').replace(/\\/g, '/')

const harness = `
import { berthPerHpMs } from '${shared}'
type PlayerShip = any
type Row = any
const mg: any = { ships: {}, ndocks: [] }
const dockOf = (id: number) => mg.ndocks.find((d: any) => d.shipId === id)
const entityTermHtml = (_kind: string, _id: number, name: string) => name
const entityNameHtml = entityTermHtml
const masterShipName = () => '雪風改二'
const kcwikiByMst = new Map()
const shipProfileByMst = new Map()
const elink = entityTermHtml
const shipThumbHtml = () => ''
const isFavoriteRoster = () => false
const esc = (value: any) => String(value)
const fatigueBand = () => 'normal'
const instanceStatBarsHtml = () => ''
const equipLinesHtml = () => ''
const bonusLineHtml = () => ''
const shipRosterNote = () => ''
const noteTagsOf = () => []
const state = { compare: [] }
${DURATIONS}
${quote}
${preview}
export const renderFleetQuote = (ship: any, docked = false) => {
  mg.ndocks = docked ? [{ shipId: ship.id }] : []
  return repairQuoteHtml(ship)
}
export const renderPreview = (ship: any, docked = false) =>
  previewHtml({ ship, dock: docked ? {} : undefined, kai: { state: 'final' } })
`
const compiled = buildSync({
  stdin: { contents: harness, loader: 'ts', resolveDir: ROOT },
  bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent',
}).outputFiles[0].text
const module = { exports: {} }
runInNewContext(compiled, { module, exports: module.exports })
export const { repairDuration, repairDurationSeconds, renderFleetQuote, renderPreview } = module.exports
