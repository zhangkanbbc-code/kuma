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
const ru = read('src/renderer/modules/ru.ts')
const qa = read('src/renderer/modules/qa.ts')
const lg = read('src/renderer/modules/lg.ts')
const localization = read('src/renderer/localization.ts')
const shared = (name) => JSON.stringify(path.join(ROOT, `src/shared/${name}.ts`))

const harness = `
import { fmtReturnClock, repairClockText } from ${shared('return-clock')}
import { decksOnExpedition } from ${shared('expedition-state')}
import { qpTaskGroups } from ${shared('qp-types')}
import { buildExpeditionOverlap } from ${shared('quest-expedition-overlap')}
import { normalizeExpeditionDispNo } from ${JSON.stringify(path.join(ROOT, 'src/renderer/expedition-name-index.ts'))}
type Deck = any
type QRow = any
export const mg: any = { decks: [], master: { missions: {} } }
export let qp: any
export const setQuest = (value: any) => { qp = value }
const combinedEscortState = () => null
const deckOnSortie = () => false
const fleetHasUnsupplied = () => false
const fleetLabel = (deck: any) => ({ canonical: '第' + deck.id + '舰队' })
const clean = (value: unknown) => String(value ?? '').trim()
export const names: any = { expedition: {} }
const tables = names
${cut(localization, 'export const localizedEntry =', '\nexport const localizedEntityId =')}
${cut(localization, 'export const entityNamePlain =', '\nconst domainOfLink =')}
${cut(read('src/renderer/expedition-label.ts'), 'export const expeditionLabel =', '\n}')}
}
const supplyIconHtml = () => ''
const isCompactMode = () => false
const qpTaskLabel = () => '远征'
const FLAG_TEXT = () => ''
export const lib = new Map()
const questVerdicts = () => new Map()
const elink = (kind: string, id: number, label: string) => '<a data-kind="' + kind + '" data-id="' + id + '">' + esc(label) + '</a>'
${cut(qn, 'const expeditionDisplayName =', '\n// 追踪任务的可读标签')}
${cut(qn, 'const expeditionTogetherHtml =', '\nconst detailHtml =').replace(
  'quests: [...lib.values()].map(({ id, code, pre }) => ({ id, code, pre })),',
  'quests: [...lib.values()].map(({ id, code }) => ({ id, code, pre: [] })),',
)}
const window = { innerWidth: 800, innerHeight: 600 }
${cut(kernel, 'export const esc =', '\nexport const fmtTime =')}
${cut(kernel, 'export const fmtCountdown =', '\n// 短格式')}
${cut(kernel, 'export const fmtCountdownShort =', '\n// 下一个 JST 整点时刻')}
${cut(kernel, 'export const fmtTime =', '\nexport const fmt')}
${cut(kernel, 'export const updateCountdowns =', '\n// ---- 公共工具 ----')}
${cut(header, "type HeaderFoldGroup =", '\nconst docksHtml =')}
export const routes: any = {}
const registerEntityRoute = (kind: string, route: any) => { routes[kind] = route }
const masterShipName = (id: number) => mg.master.ships[id].name
const isBuildSpoilerEnabled = () => extras.buildSpoiler
const shipThumbHtml = (id: number, name: string) => '<img data-ship="' + id + '" alt="' + esc(name) + '">'
const activateModule = () => {}
${cut(header, 'const docksHtml =', '\n// 建造坞。此前它在界面上')}
${cut(header, 'const isLargeBuild =', '\nconst practiceInfo =')}
export const runHeaderTick = (host: any, foldPopoverEl: any = null) => {
  const onTick = (callback: () => void) => callback()
  const syncFoldChipStates = () => {}
${cut(header, '  onTick(() => {', '\n  render()\n}')}
}
const fleetShips = (deck: any) => deck.ships
const AIR_BASE_TAB_ID = 0
const focusFleet = () => {}
export const navigations: any[] = []
const navigate = (ref: any) => navigations.push(ref)
${cut(ru, "registerEntityRoute('fleet',", "\nregisterEntityRoute('fleetShip',")}
export const notices: any[] = []
export const extras = { expeditionEarly: false, buildSpoiler: false }
const fireOnce = (_key: string, run: () => void) => run()
const notify = (...args: any[]) => notices.push(args)
const expFireTs = (ts: number) => ts - (extras.expeditionEarly ? 60000 : 0)
export const notifyExpeditions = () => {
  const now = Date.now()
${cut(lg, '  // 远征返港（可提前 1 分）', '\n  // 入渠 / 建造')}
}
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
export { expeditionsHtml, deckStatusHtml, fleetStatusHtml, qpDetailHtml, syncExpeditionChipStates, expeditionDisplayName, expeditionTogetherHtml }
export { buildDocksHtml }
export { docksHtml }
const starSumOf = () => 0
${cut(qa, "registerEntityRoute('ship',", "\nregisterEntityRoute('shipCapacity',")}
export const renderRepairSub = (dock: any) => {
  const row = { dock }
  const hurt = null
  const ship: any = {}
${cut(qa, '  const dockSub =', '\n  const band =')}
  return dockSub
}
export const runQaTick = (pane: any, lastCountdownTick: number) => {
  const onTick = (callback: () => void) => callback()
  const render = () => {}
  const deferPassive = () => {}
${cut(qa, '  onTick(() => {', '\n  })')}
  })
}
export const renderRepairVerdict = (ships: any[]) => {
  const scopeShips = () => ships
  const engagedShips = (ships: any[]) => ships
  const shipIssues = (ship: any) => ({ docked: !!dockOf(ship.id), tired: !!ship.ready })
  const dockOf = (id: number) => mg.ndocks.find((dock: any) => dock.shipId === id)
  const fatigueReadyTs = (id: number) => ships.find((ship) => ship.id === id).ready
  const FATIGUE_READY_COND = 40
  const sallyFlagHtml = () => ''
${cut(ru, 'const verdictHtml =', '\n// ---- 联合舰队 ----')}
  return verdictHtml({ id: 1 } as any)
}
export const runRuRepairTick = (pane: any) => {
${cut(ru, '  updateCountdowns(pane)\n  const now =', '\n  // 到点翻面的那一趟。')}
}
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
