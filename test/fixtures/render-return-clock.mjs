// 切出三处真实渲染与顶栏 tick；只给无关的布局、名称查询和供给状态打桩。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const cut = (src, from, to) => {
  const start = src.indexOf(from)
  const end = src.indexOf(to, start + from.length)
  assert.ok(start >= 0 && end > start, `切不到真实渲染代码：${from}`)
  return src.slice(start, end)
}
const header = read('src/renderer/header-status.ts')
const bi = read('src/renderer/modules/bi.ts')
const qn = read('src/renderer/modules/qn.ts')
const kernel = read('src/renderer/kernel.ts')
const shared = (name) => JSON.stringify(path.join(ROOT, `src/shared/${name}.ts`))

const harness = `
import { fmtReturnClock } from ${shared('return-clock')}
import { decksOnExpedition } from ${shared('expedition-state')}
import { qpTaskGroups } from ${shared('qp-types')}
type Deck = any
type QRow = any
export const mg: any = { decks: [], master: { missions: {} } }
export let qp: any
export const setQuest = (value: any) => { qp = value }
const combinedEscortState = () => null
const deckOnSortie = () => false
const fleetHasUnsupplied = () => false
const fleetLabel = (deck: any) => ({ canonical: '第' + deck.id + '舰队' })
const entityNamePlain = (_kind: string, _id: number, name: string) => name
const supplyIconHtml = () => ''
const isCompactMode = () => false
const qpTaskLabel = () => '远征'
const FLAG_TEXT = () => ''
const window = { innerWidth: 800, innerHeight: 600 }
${cut(kernel, 'export const esc =', '\nexport const fmtTime =')}
${cut(kernel, 'export const fmtCountdownShort =', '\n// 下一个 JST 整点时刻')}
${cut(header, "type HeaderFoldGroup =", '\nconst docksHtml =')}
${cut(bi, 'const expeditionDecks =', '\nconst freeDecks =')}
${cut(bi, 'const deckStatusHtml =', '\n// ---- 紧凑态：编队状态悬停卡 ----')}
${cut(bi, 'let fleetCard:', '\n/**\n * 被动重渲')}
${cut(qn, 'const qpDetailHtml =', '\n  // 「本地计数」四字')}
  return lines.join('')
}
export const renderCard = (deckId: number) => {
  fleetCard = { innerHTML: '', style: {}, classList: { add() {} }, offsetWidth: 100, offsetHeight: 30 } as any
  showFleetCard({ dataset: { fleetPeek: String(deckId) }, getBoundingClientRect: () => ({ left: 10, top: 10, bottom: 30 }) } as any)
  return fleetCard!.innerHTML
}
export { expeditionsHtml, deckStatusHtml, fleetStatusHtml, qpDetailHtml, syncExpeditionChipStates }
`

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-return-clock-'))
const entry = path.join(dir, 'render.ts')
const outfile = path.join(dir, 'render.cjs')
let renderer
try {
  fs.writeFileSync(entry, harness)
  buildSync({ entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' })
  renderer = createRequire(import.meta.url)(outfile)
} finally {
  fs.rmSync(dir, { recursive: true, force: true })
}

// 模块加载完成后夹具只留内存；不启动浏览器或 Electron。
export { renderer }
