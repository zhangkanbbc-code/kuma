// 母港舰队三件套（编成 / 入渠 / 建造）跨重启的一整条链，**两端都切真码**：
//   主进程侧 —— store.ts 的 domainSnapshot / hydrateDomain、三个换算器、applyDeckUpdates，
//               以及真正会改这三样的那几个 reducer；
//   渲染侧   —— header-status.ts 的 expeditionsHtml / docksHtml / buildDocksHtml，
//               外加 kernel.ts 里真的 fmtCountdownShort、deckOnSortie 与 combinedEscortState。
//
// ⚠️ **不许直接 import store.ts**：那个文件一 import 就会打开用户的真账本并跑迁移。
//
// 为什么非得让链子从落盘一直连到 HTML：这次的 bug 长得一点也不像 bug。
// 「decks 不在 DOMAIN_SECTIONS 里」这句源码读起来毫无破绽——因为重启后编成确实还在
// （回放 api_port/port 快照带回来的）。只有把「回港之后才派出去的那一支」也走一遍
// 落盘→回灌→渲染，才看得见它在半路没了。正则匹配源码文本一条也拦不住这个。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const read = (...rel) => fs.readFileSync(path.join(ROOT, ...rel), 'utf8').replace(/\r\n/g, '\n')

const store = read('src', 'main', 'mg', 'store.ts')
const mgIndex = read('src', 'main', 'mg', 'index.ts')
const kernel = read('src', 'renderer', 'kernel.ts')
const header = read('src', 'renderer', 'header-status.ts')

const cutFrom = (src, from, to, label) => {
  const start = src.indexOf(from)
  assert.ok(start >= 0, `切不到「${label}」的起点，这条守卫的锚点要跟着改`)
  const end = to === null ? src.length : src.indexOf(to, start + from.length)
  assert.ok(end > start, `切不到「${label}」的终点，这条守卫的锚点要跟着改`)
  return src.slice(start, end)
}

/** 切一个 reducer 出来，改写成具名导出函数，**主体一个字不动**。 */
const asReducer = (name, head, label) => {
  const start = store.indexOf(head)
  assert.ok(start >= 0, `store.ts 里找不到「${label}」，这条守卫的锚点要跟着改`)
  const end = store.indexOf('\n  },\n', start)
  assert.ok(end > start, `「${label}」没有可识别的结尾`)
  return `export const ${name} = ${store.slice(start + head.indexOf('('), end + 4)}`
}

// ---- 主进程：换算器 + 全量替换 + 跨重启的那一对 ----
const CONVERTERS = cutFrom(
  store,
  'const toDeck = (raw: any): Deck => ({',
  '\n// 持有家具列表 → mst id 升序去重',
  'toDeck / toNdock / toKdock',
)
const APPLY_DECKS = cutFrom(
  store,
  'const applyDeckUpdates = (rawDecks: any, replaceAll: boolean) => {',
  '\n// ---- 出击/战斗 ----',
  'applyDeckUpdates',
)
// 回灌与快照是一对，中间没有别的东西，一刀切下来省得两处锚点各自漂移。
const SNAPSHOT_PAIR = cutFrom(
  store,
  'export const hydrateDomain = (data: any) => {',
  '// ---- 各字段的换算小工具 ----',
  '跨重启的回灌与快照 hydrateDomain / domainSnapshot',
)

const MISSION_START = asReducer(
  'missionStart',
  "'/kcsapi/api_req_mission/start': (body, post) => {",
  '远征派出 reducer',
)
const MISSION_RESULT = asReducer(
  'missionResult',
  "'/kcsapi/api_req_mission/result': (body, post, ts) => {",
  '远征结算 reducer',
)
const MEMBER_DECK = asReducer(
  'memberDeck',
  "'/kcsapi/api_get_member/deck': (body) => {",
  '编成全量 reducer',
)
const MEMBER_NDOCK = asReducer(
  'memberNdock',
  "'/kcsapi/api_get_member/ndock': (body, _post, ts) => {",
  '入渠全量 reducer',
)
const MEMBER_KDOCK = asReducer(
  'memberKdock',
  "'/kcsapi/api_get_member/kdock': (body) => {",
  '建造坞全量 reducer',
)

// ---- 落盘清单：真的那个 Set 本体（index.ts 一 import 就会开真账本，只能切）----
const DOMAIN_SECTIONS = cutFrom(
  mgIndex,
  'const DOMAIN_SECTIONS = new Set<Section>([',
  '\nlet domainSaveTimer',
  '落盘清单 DOMAIN_SECTIONS',
)

// ---- 渲染侧 ----
const FMT_SHORT = cutFrom(
  kernel,
  'export const fmtCountdownShort = (completeTime: number, doneText = ',
  '\n// 下一个 JST 整点时刻',
  'kernel 的 fmtCountdownShort',
)
const ESCORT_STATE = cutFrom(
  kernel,
  'export const deckOnSortie =',
  null,
  '内核的 deckOnSortie / combinedEscortState',
)
const HEADER_CHIPS = cutFrom(
  header,
  "type HeaderFoldGroup = 'expedition' | 'dock' | 'build'",
  '\n// 「在外 → 归来」发生在倒计时归零那一刻',
  '顶栏远征芯片 expeditionsHtml',
)
const HEADER_DOCKS = cutFrom(
  header,
  'const docksHtml = () => {',
  '\n// 建造坞。此前它在界面上',
  '顶栏入渠芯片 docksHtml',
)
const HEADER_BUILD = cutFrom(
  header,
  'const isLargeBuild = ',
  '\n// 建造坞预览卡。',
  '顶栏建造芯片 buildDocksHtml',
)

const HARNESS = `
type Section = string
type Deck = any
type Ndock = any
type Kdock = any

// ---- 主进程侧 ----
export const state: any = {
  player: { decks: [], ndocks: [], kdocks: [], ships: {}, berthSince: {} },
  mapGauges: {},
  eventAreas: {},
  sortie: null,
}
let pendingNdockStart: any = null
// 出击复盘那一支与本条守卫无关（它自己有 sortie-restore.test.mjs），给最平淡的桩。
const restoreSortieAcrossRestart = (s: any) => ({ ...s, active: false })
const upgradeBattleView = (b: any) => b
const runSortieHpAudit = (_ts: number, _announce: boolean): Section[] => []
const addMaterials4 = (_m: any) => false
const incrementUseitem = (_id: number, _n: number, _ts: number) => false
const patchBasicLevel = (_body: any) => false

${CONVERTERS}
${APPLY_DECKS}
${SNAPSHOT_PAIR}
${MISSION_START}
${MISSION_RESULT}
${MEMBER_DECK}
${MEMBER_NDOCK}
${MEMBER_KDOCK}

// 落盘清单本体。reducer 报回来的 section 只要有一项在这里面，主进程就会排一次
// 去抖落盘——「远征派出后 1.5 秒内就存下来了」这句话的全部依据就是它。
export ${DOMAIN_SECTIONS}

// ---- 渲染侧 ----
export const mg: any = {
  decks: [],
  ships: {},
  ndocks: [],
  kdocks: [],
  master: { missions: {} },
  combinedFlag: 0,
  sortie: null,
}
// 与本条守卫无关的，给最平淡的桩。转义用真口径（属性值里的引号必须被吃掉），
// 否则 title 断言会在一个假的转义上过关。
const esc = (s: unknown) => \`\${s ?? ''}\`.replace(/[&<>"']/g, (c) => \`&#\${c.charCodeAt(0)};\`)
const entityNamePlain = (_kind: string, _id: number, name: string) => name
const fleetLabel = (deck: any) => ({ canonical: \`第\${deck.id}舰队\`, custom: null })
const masterShipName = (mstId: number) => \`舰\${mstId}\`
const fleetHasUnsupplied = (_deck: any) => false
// 钥的剧透开关：默认关着（芯片写「待领」），与本条无关
const isBuildSpoilerEnabled = () => false

${FMT_SHORT}
${ESCORT_STATE}
${HEADER_CHIPS}
${HEADER_DOCKS}
${HEADER_BUILD}

export { expeditionsHtml, docksHtml, buildDocksHtml }
export { applyDeckUpdates, toDeck, toNdock, toKdock }
`

const loaded = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-fleet-restart-'))
  const entry = path.join(dir, 'fleet.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'fleet.cjs')
  buildSync({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  })
  return createRequire(import.meta.url)(outfile)
})()

// ---- 报文原样的小构造器（游戏就是这么发的：api_ 前缀、mission 定长四格）----

/** api_deck_port / api_get_member/deck 的一项。`mission` 缺省 = 没在远征。 */
export const rawDeck = (id, { mission = [0, 0, 0, 0], ships = [] } = {}) => ({
  api_id: id,
  api_name: `第${id}艦隊`,
  api_mission: mission,
  api_ship: ships,
})

export const rawNdock = (id, { shipId = 0, completeTime = 0, state = 0 } = {}) => ({
  api_id: id,
  api_ship_id: shipId,
  api_complete_time: completeTime,
  api_state: state,
})

export const rawKdock = (id, { state = 0, createdShipId = 0, completeTime = 0, fuel = 0 } = {}) => ({
  api_id: id,
  api_state: state,
  api_created_ship_id: createdShipId,
  api_complete_time: completeTime,
  api_item1: fuel,
})

// ---- 三条真实通道 ----

/**
 * 冷启动：把内存清成「这个进程刚起来，什么都没有」。
 * 落盘文件不在这里清——`restart()` 会把它带过来。
 */
export const coldBoot = () => {
  loaded.state.player = { decks: [], ndocks: [], kdocks: [], ships: {}, berthSince: {} }
  loaded.state.sortie = null
  loaded.mg.decks = []
  loaded.mg.ndocks = []
  loaded.mg.kdocks = []
  loaded.mg.ships = {}
  loaded.mg.master = { missions: {} }
  loaded.mg.combinedFlag = 0
  loaded.mg.sortie = null
}

/**
 * 回放 `api_port/port` 原始快照里的舰队那两段——**这是修复前唯一的恢复通道**。
 * 走的是 port reducer 里那两行同样的调用（applyDeckUpdates 全量替换 + toNdock）。
 */
export const replayPortSnapshot = ({ decks = [], ndocks = [] } = {}) => {
  loaded.applyDeckUpdates(decks, true)
  loaded.state.player.ndocks = ndocks.map(loaded.toNdock)
  syncToRenderer()
}

/** 回放 `api_get_member/require_info` 快照里的建造坞那一段（kdocks 的旧通道）。 */
export const replayRequireInfo = (kdocks = []) => {
  loaded.state.player.kdocks = kdocks.map(loaded.toKdock)
  syncToRenderer()
}

/** 领域快照落盘 → JSON 往返 → 回灌。返回真正写进 domain.json 的那份 data。 */
export const hydrateFromDomain = (persisted) => {
  loaded.hydrateDomain(persisted)
  syncToRenderer()
}

export const domainSnapshot = () => JSON.parse(JSON.stringify(loaded.domainSnapshot()))

/** 渲染层的 `mg:get-state` 初次拉取：主进程状态 → mg。 */
export const syncToRenderer = () => {
  loaded.mg.decks = loaded.state.player.decks
  loaded.mg.ndocks = loaded.state.player.ndocks
  loaded.mg.kdocks = loaded.state.player.kdocks
  loaded.mg.ships = loaded.state.player.ships
}

// ---- reducer 直通（都是真码）----

export const missionStart = (deckId, missionId, completeTime) =>
  loaded.missionStart(
    { api_complatetime: completeTime },
    { api_deck_id: `${deckId}`, api_mission_id: `${missionId}` },
  )
export const missionResult = (deckId, ts = 0) =>
  loaded.missionResult({ api_ship_id: [], api_get_exp_lvup: [] }, { api_deck_id: `${deckId}` }, ts)
export const memberDeck = (decks) => loaded.memberDeck(decks)
/** 主进程收到这批 section 后会不会排一次领域落盘（真的 DOMAIN_SECTIONS 说了算）。 */
export const wouldPersist = (sections) => sections.some((s) => loaded.DOMAIN_SECTIONS.has(s))
export const memberNdock = (ndocks, ts = 0) => loaded.memberNdock(ndocks, {}, ts)
export const memberKdock = (kdocks) => loaded.memberKdock(kdocks)

// ---- 读状态 ----

export const decks = () => loaded.state.player.decks
export const deckOf = (id) => loaded.state.player.decks.find((d) => d.id === id)
export const ndocks = () => loaded.state.player.ndocks
export const kdocks = () => loaded.state.player.kdocks

// ---- 读顶栏产物 ----

export const renderExpeditions = () => loaded.expeditionsHtml()
export const renderDocks = () => loaded.docksHtml()
export const renderBuildDocks = () => loaded.buildDocksHtml()

/** 从顶栏远征产物里把某一枚芯片整段抠出来（形态与 render-combined-escort 同源）。 */
export const expeditionChipOf = (deckId) => {
  const html = renderExpeditions()
  const re = new RegExp(`<span class="hs-chip exp[^"]*" data-fleet="${deckId}"[\\s\\S]*?</span>`)
  const hit = re.exec(html)
  assert.ok(hit, `顶栏产物里找不到第 ${deckId} 舰队的芯片\n${html}`)
  return hit[0]
}

/** 芯片上那几个字（<em> 或 <b> 里的文本） */
export const expeditionChipLabel = (deckId) => {
  const hit = /<(?:em|b)[^>]*>([^<]*)<\/(?:em|b)>/.exec(expeditionChipOf(deckId))
  return hit ? hit[1] : ''
}

/** 芯片挂着的绝对完成时刻——updateCountdowns 每秒读的就是它，倒计时对不对全看这个数 */
export const expeditionChipCds = (deckId) => {
  const hit = /data-cds="(\d+)"/.exec(expeditionChipOf(deckId))
  return hit ? Number(hit[1]) : null
}

export const expeditionChipClass = (deckId) => /class="([^"]*)"/.exec(expeditionChipOf(deckId))[1]
