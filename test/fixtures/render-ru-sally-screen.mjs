// 切出真实札判定、标签渲染与开图监听；状态及重画队列留在内存，不接玩家账本。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ru = fs.readFileSync(path.join(ROOT, 'src/renderer/modules/ru.ts'), 'utf8').replace(/\r\n/g, '\n')
const cut = (from, to) => {
  const start = ru.indexOf(from)
  const end = ru.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `札选图夹具锚点缺失：${from}`)
  return ru.slice(start, end)
}
const HARNESS = `
import { EventEmitter } from 'node:events'
import { activeEventAreaIds, sallyVerdict } from './src/shared/sally-lock'
import { isEventMapArea, mapAreaOf, mapCodeOf } from './src/shared/map-id'
type PlayerShip = { sallyArea: number }
export const mg: any = { sortie: null, eventAreas: {}, mapGauges: {} }
const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
const eventGuideUrl = () => null
${cut('let lastOpenedMapArea:', '\n// 出击识别札。')}
${cut('const RANK_NAME:', '\nconst eventRunningNow')}
${cut('const currentSallyVerdict = ', '\n/**\n * 出击中的大破名单')}
const broadcaster = new EventEmitter()
const pane = {}
const pending: (() => void)[] = []
const warnOnEventMapOpen = () => {}
const deferPassive = (_pane: any, _id: string, fn: () => void) => pending.push(fn)
let ships: PlayerShip[] = [{ sallyArea: 1 }]
let html = ''
const render = () => { html = sallyFlagHtml(ships) }
${cut('    const onMapOpen = ', '\n    // 这条监听住在')}
export const reset = (area: number | null, selecting = true, sortie: any = null, limitFlag = 0) => {
  lastOpenedMapArea = area
  atMapSelect = selecting
  mg.sortie = sortie
  mg.eventAreas = { 62: { closed: false } }
  mg.mapGauges = { 621: { limitFlag, selectedRank: 4, cleared: false } }
  activeAreasCache = null
  pending.length = 0
  render()
}
export const flag = () => html
export const open = (areaId: number) => broadcaster.emit('kancolle.map.open', { areaId, ts: 10000 })
export const redraw = () => {
  const count = pending.length
  pending.splice(0).forEach((fn) => fn())
  return count
}
export { noteSortieArea, render }
`
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-ru-sally-screen-'))
const outfile = path.join(dir, 'sally.cjs')
buildSync({
  stdin: { contents: HARNESS, resolveDir: ROOT, sourcefile: 'sally-screen-fixture.ts', loader: 'ts' },
  outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
})
export const scene = createRequire(import.meta.url)(outfile)
