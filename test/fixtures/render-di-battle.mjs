// 把镝战斗面板的几段渲染函数**原样切出来**真编译一遍，好让护栏对着产物 HTML 下断言。
//
// 做法照搬 test/air-special-attack.test.mjs 的「渲染产物」一节与 render-di-heading.mjs：
// 整段从 di.ts 切走，源码一个字不改，它引用到的外部名字在这里补桩。
// **不断言源码文本**——判断写反、护卫段错位、缺省当发动，正则一条也拦不住。
//
// 一次编译出若干段，共用同一份桩：
// - `logHtml`        战斗流水（对空炮火行、支援编成行、卡特琳娜行、逐击标签）
// - `resultStripHtml` 结果条（可退避 / 解锁海域两枚芯片）
// - `airlineHtml`    战斗抬头（阻塞气球）
// - `battleDropChipHtml` 掉落卡（入手台词的悬停）
// - `seaCardHtml`    右栏海图卡（本图 Boss 本期尚未击破）
// - `navCardHtml`    节点卡（含泊地修理行）
// - `alertBannerHtml` 警告条（大破三档：强制返航 / 请选择撤退 / 二队旗舰受保护）
// - `blockedBossNightHtml` 夜战阻断条（敌联合的夜战交战对象判别式）
// - 基地防空的收纳判据（`baseDefenseSettled` / `baseDefenseEnRoute` / `baseDefenseTucked`
//   / `bodyBattleOf`）——它们与战果槽同在一段切片里，跟着一起编出来
//
// 桩只补这几段**真的会执行到**的名字；其余分支里的名字留成自由变量。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const source = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'modules', 'di.ts'), 'utf8')

const sliceBetween = (from, to, label) => {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `di.ts 里找不到「${label}」，这条守卫的锚点要跟着改`)
  return source.slice(start, end)
}

const DROP_CHIP = sliceBetween(
  'const battleDropChipHtml = (s: SortieView, b: BattleView): string => {',
  '// 「撤退还是进击」之外',
  '掉落卡 battleDropChipHtml',
)
const AIRLINE = sliceBetween(
  'const airlineHtml = (b: BattleView, s: SortieView): string => {',
  'const battleShipExpandKey =',
  '战斗抬头 airlineHtml',
)
const RESULT_STRIP = sliceBetween(
  'const resultStripHtml = (b: BattleView): string => {',
  'const logHtml = (b: BattleView, expanded: boolean): string => {',
  '结果条 resultStripHtml',
)
const LOG_HTML = sliceBetween(
  'const logHtml = (b: BattleView, expanded: boolean): string => {',
  '// ---- 右栏 ----',
  '战斗流水 logHtml',
)
const SEA_CARD = sliceBetween(
  'const seaCardHtml = (s: SortieView): string => {',
  'const sortieStatCardHtml =',
  '海图卡 seaCardHtml',
)
// 泊地修理那一行连同它挂进去的节点卡一起切：只切行渲染的话，
// 「算出来了但没挂上去」这种漏法一条护栏也拦不住。
const NAV_CARD = sliceBetween(
  'const anchorageRepairLinesHtml = (s: SortieView): string =>',
  '// 掉落：整轮累计',
  '节点卡 navCardHtml（含泊地修理行）',
)
// 夜战阻断条：判别式换成算分制之后，这一段有三个出口（null / 打不到 / 打得到），
// 只钉源码文本的话「阈值写反」会整片绿。末锚取下一个函数名，好把它自己的注释收全。
const BLOCKED_NIGHT = sliceBetween(
  'const blockedBossNightHtml = (s: SortieView, b: BattleView): string | null => {',
  'const baseDefenseMetrics = (b: BattleView) => {',
  '夜战阻断条 blockedBossNightHtml',
)
// 战果槽（含航行中的「前往 X 点」与基地防空那一支）连同 headingBannerHtml 一起切：
// 防空要摞在预测上方，切了防空不切预测就看不出它到底摞上去没有。
// 追击提示的敌联合判别式也在这一段里（enemyNightTargetOf 引的是真的那一份）。
const OUTCOME_BANNER = sliceBetween(
  'const HEADING_ARROW_SVG =',
  '// 对空CI 只有编号是游戏口径',
  '战果槽 outcomeBannerHtml（含 headingBannerHtml）',
)
// 大破警告条连同它的 isTaiha 一起切：切了判定不切阈值，
// 「0.25 写成 0.5」这种改法照样一片绿。
const IS_TAIHA = sliceBetween(
  'const isTaiha = (ship: BattleShipView) =>',
  '\ntype NightDeck = 1 | 2',
  '大破判定 isTaiha',
)
// 退避提示行与警告条一起切：报文给了 offer 却没接上，只切警告条是看不出来的。
const ALERT_BANNER = sliceBetween(
  'const escapeOfferNoteOf = (b: BattleView): string => {',
  'const verdictHtml =',
  '警告条 alertBannerHtml（含退避提示行）',
)

// 空壳海图的判据**引真的那一份**，不补桩：桩一写成 `Boolean(entry?.spots)`
// 就把被修掉的那个 bug 在测试里复活了，护栏会对着旧行为绿。
// esbuild 是 bundle 模式、入口写在临时目录，所以这里给绝对路径（正斜杠，Windows 也认）。
const FCD_TOPOLOGY = path.join(ROOT, 'src', 'shared', 'fcd-topology.ts').replace(/\\/g, '/')
// 大破分档同理：桩一写成「有大破就红档」，旗舰特例有没有接上就看不出来了。
const TAIHA_VERDICT = path.join(ROOT, 'src', 'shared', 'taiha-verdict.ts').replace(/\\/g, '/')
// 夜战交战对象的判别式同理：桩成「有活口就打不到」，就把要修的那个 bug 在测试里复活了。
const ENEMY_NIGHT = path.join(ROOT, 'src', 'shared', 'enemy-night-target.ts').replace(/\\/g, '/')
// 活动图判据也引真的那一份：桩成 `area >= 40` 之类的自造阈值，
// 「友军提示只在活动图出声」这一条就变成了对着桩绿，真判据改了也照样不红。
const MAP_ID = path.join(ROOT, 'src', 'shared', 'map-id.ts').replace(/\\/g, '/')
// 特攻的名字表与分段表也引真的那一份：流水把「同一次特攻的几段」收成一组正是照分段表
// 定上限的，桩一写成自造的表，「该成组的没成、不该成的成了」就对着桩绿。
const SPECIAL_ATTACK = path
  .join(ROOT, 'src', 'shared', 'fleet-special-attack.ts')
  .replace(/\\/g, '/')

const HARNESS = `
import { fcdTopologyUsable } from '${FCD_TOPOLOGY}'
import { flagshipHasDameconIn, isTaihaShip, taihaVerdictOf } from '${TAIHA_VERDICT}'
import { enemyNightTargetOf, isPtShipName } from '${ENEMY_NIGHT}'
import { isEventMapArea } from '${MAP_ID}'
import { SPECIAL_ATTACK_SEGMENT_ORDER, specialAttackLabel } from '${SPECIAL_ATTACK}'

type BattleView = any
type BattleAttack = any
type BattleSide = any
type BattleShipView = any
type SortieView = any
type AirSpecialAttackView = any

const ENT: any = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (c: string) => ENT[c])

const PHASE_LABEL: any = new Proxy({}, { get: (_t, key) => [String(key), String(key)] })
// 制空档位照 di.ts 那张表的原词（原来是缩写桩）：防空摘要行把这一格原样拼进去，
// 缩写桩会让「摘要用的是不是既有文案」这条护栏对着一个不存在的词绿。
const SEIKU: any = ['制空均衡', '制空权确保', '航空优势', '航空劣势', '制空权丧失']
const DETECTION: any = { 1: '索敌成功', 2: '索敌失败' }
const NODE_EVENT: any = { 2: '资源', 4: '战斗', 5: 'Boss', 6: '无事' }

const shipAt = (battle: any, side: any, index: number) => {
  const list = side === 0 ? battle.fShips : side === 1 ? battle.eShips : (battle.friendShips ?? [])
  return list.find((s: any) => s.index === index)
}
const nameAt = (battle: any, side: any, index: number) => {
  const ship = shipAt(battle, side, index)
  return ship ? ship.name : side === 0 ? \`我\${index + 1}\` : side === 1 ? \`敌\${index + 1}\` : \`友军\${index + 1}\`
}
const shipLinkAt = (battle: any, side: any, index: number) => esc(nameAt(battle, side, index))
const battleShipName = (ship: any) => ship.name
const battleDefeated = (_battle: any, ship: any) => ship.hpEnd <= 0
const requiredSunkForA = (count: number) => Math.ceil(count * 0.7)

const equipmentLinkHtml = (id: number, _max: number | null = 12) => \`<i data-equip="\${id}">装备\${id}</i>\`
const elink = (_kind: string, id: number, name: string) => \`<i data-id="\${id}">\${name}</i>\`
const elinkHtml = (_kind: string, id: number, body: string) => \`<i data-id="\${id}">\${body}</i>\`
const entityNamePlain = (_kind: string, _id: number, name: string) => name
const entityNameHtml = (_kind: string, _id: number, name: string, _o?: any) => esc(name)
const isAbyssMstId = (id: number) => id >= 1500
const attackEquipmentReliable = (_stype: any) => true
// 只有种别 1 给出装备条件与明细：好让「带条件的长注记」与「光杆种别号的短注记」
// 两条路各有一个真实形状可跑，其余种别照旧走空条件那一支。
const aaciDescribe = (kind: any) => ({
  label: \`类型\${kind}\`,
  condition: kind === 1 ? '高角炮×2 + 电探' : '',
  detail: kind === 1 ? '装备条件：高角炮×2 + 电探' : '',
  title: \`对空CI \${kind}\`,
})
// 弹着观测/夜战 CI 那两张表由别处定；桩让用例自己把名字放进 ciType，好试不同长度的标。
// **数字走真表**：特攻的名字与「这几段是不是同一次特攻」出自同一份 shared 表，
// 桩成假名字的话，组头亮的是不是玩家看惯的那枚标就无从验起。
const ciLabel = (kind: any, ci: any) =>
  typeof ci === 'string'
    ? ci
    : typeof ci === 'number'
      ? (specialAttackLabel(ci, kind === 'night' ? 'night' : 'day') ?? null)
      : null
const battleHitState = (hit: any) => hit.hitState ?? (hit.miss ? 'miss' : hit.damage > 0 ? 'hit' : 'unknown')
const shipThumbHtml = (_id: number, _name: string, _o?: any) => '<i class="thumb"></i>'
const firstDropBadgeInSortieHtml = (..._a: any[]) => ''
const unownedShipBadgeHtml = (_id: number) => ''

const isDamageOnlyBattle = (battle: any) => battle.kind === 'airraid' || battle.kind === 'radar'
const battleTypeLabel = (battle: any) => \`\${battle.kind}\`
const battleForecastLead = (battle: any) => \`\${battle.kind}·\`
const rankLabel = (rank: string, _p: any) => rank
const actualEngagementText = (battle: any) => (battle.engagement === 1 ? '同航战' : '')
const myAirPower = (_s: any) => null
// 防空那几个数照真的那份口径算（原来是一律 0 的哑桩）：摘要行的「基地未受损 /
// N 个基地受损」正是从 damagedBases 出来的，哑桩会让受损那一支永远试不到。
const baseDefenseMetrics = (b: any) => ({
  air: b.air,
  baseDamage: b.fShips.reduce((sum: number, ship: any) => sum + Math.max(0, ship.hpStart - ship.hpEnd), 0),
  damagedBases: b.fShips.filter((ship: any) => ship.hpEnd < ship.hpStart).length,
  fLost: b.air ? b.air.fLost + b.air.fLost2 : 0,
  eLost: b.air ? b.air.eLost + b.air.eLost2 : 0,
})
const mapIdOf = (area: number, no: number) => area * 10 + no
const mapCodeOf = (mapId: number) => \`\${Math.floor(mapId / 10)}-\${mapId % 10}\`
const mapKeyOf = (s: any) => \`\${s.mapArea}-\${s.mapNo}\`
const cellLetter = (_s: any, cell: number) => \`\${cell}\`
const nodeEventName = (n: any) => (n.eventId === 5 ? 'Boss 战' : '战斗')
const routeTallyFor = (_s: any) => ({ tally: new Map() })
// 战果槽用到的两个：方位角算不出来就走朝右那一支（fcdMap 桩是 null，本来就算不出）
const sortieHeadingDeg = (..._a: any[]) => null
const rankOutcomeWord = (rank: string) => (rank === 'S' ? '完胜' : '胜')
const travelledEdges = (..._a: any[]) => []
const fcdMap: any = null

// 顶层 slotitems 是旗舰 damecon 的账本回退要查的那张表（master.slotitems 是主数据，两回事）。
// friendlyRequest 刻意**不给初值**：那正是「从没收到过 set_friendly_request」的未知态，
// 也是这份桩的默认局面（用例要开要請时自己往上挂）。
const mg: any = { master: { ships: {}, slotitems: {}, ready: false }, decks: [], ships: {}, slotitems: {} }
let selectedLogStage: number | null = null
// 阶段折叠集合住在 logHtml 外面，切片够不着——空集 = 默认全展开，正是要钉的默认态。
// 用例要试折叠就自己往里塞 stage.order。
const collapsedLogStages = new Set<number>()
// 基地防空的展开集合同样住在切片外面。空集 = **默认收纳**（与阶段折叠正好相反），
// 正是要钉的默认态；用例要试展开就自己塞 baseDefenseFoldKey(battle)。
const expandedBaseDefense = new Set<string>()

// 节点卡走的是**非战斗点**那一支（泊地修理格就是非战斗点）；
// 分歧那几个名字给最平淡的桩，敌编成那一支里的名字留成自由变量。
const BATTLE_EVENTS = new Set([4, 5, 7, 10])
const currentNode = (s: any) => s.nodes.find((n: any) => n.cell === s.currentCell) ?? null
const spotBranches = (..._a: any[]) => []
const branchTallyText = (..._a: any[]) => ''
const isActiveBranchSpot = (..._a: any[]) => false

${DROP_CHIP}
${AIRLINE}
${RESULT_STRIP}
${LOG_HTML}
${SEA_CARD}
${NAV_CARD}
${BLOCKED_NIGHT}
${OUTCOME_BANNER}
${IS_TAIHA}
${ALERT_BANNER}

export {
  mg,
  battleDropChipHtml,
  airlineHtml,
  resultStripHtml,
  logHtml,
  seaCardHtml,
  navCardHtml,
  anchorageRepairLinesHtml,
  alertBannerHtml,
  blockedBossNightHtml,
  outcomeBannerHtml,
  headingBannerHtml,
  collapsedLogStages,
  expandedBaseDefense,
  baseDefenseSettled,
  baseDefenseEnRoute,
  baseDefenseFoldKey,
  baseDefenseTucked,
  bodyBattleOf,
}
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-di-battle-'))
  const entry = path.join(dir, 'panel.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'panel.cjs')
  buildSync({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  })
  return outfile
})()

const loaded = createRequire(import.meta.url)(bundle)

export const renderLog = (battle, expanded = true) => loaded.logHtml(battle, expanded)
export const renderResultStrip = (battle) => loaded.resultStripHtml(battle)
export const renderAirline = (battle, sortie = { active: false, practice: false }) =>
  loaded.airlineHtml(battle, sortie)
export const renderDropChip = (sortie, battle) => loaded.battleDropChipHtml(sortie, battle)
export const renderSeaCard = (sortie) => loaded.seaCardHtml(sortie)
export const renderNavCard = (sortie) => loaded.navCardHtml(sortie)
export const renderAlertBanner = (sortie) => loaded.alertBannerHtml(sortie)
export const renderBlockedBossNight = (sortie) => loaded.blockedBossNightHtml(sortie, sortie.battle)
export const renderOutcomeBanner = (sortie) => loaded.outcomeBannerHtml(sortie)
export const renderHeadingBanner = (sortie) => loaded.headingBannerHtml(sortie)
/** 折叠集合是同一份引用：用例改它，下一次 renderLog 就照着改后的画。 */
export const collapsedLogStages = loaded.collapsedLogStages

// ---- 基地防空的收纳（判据 + 主体让位）----
//
// 判据整段引真的那一份：桩成「是防空就收」之类的话，「结算完没完」「还在不在航行中」
// 这三条腿写反了照样一片绿。展开集合也是同一份引用，用例塞了键下一次渲染就照着走。
export const expandedBaseDefense = loaded.expandedBaseDefense
export const baseDefenseSettled = (battle) => loaded.baseDefenseSettled(battle)
export const baseDefenseEnRoute = (sortie) => loaded.baseDefenseEnRoute(sortie)
export const baseDefenseFoldKey = (battle) => loaded.baseDefenseFoldKey(battle)
export const baseDefenseTucked = (sortie) => loaded.baseDefenseTucked(sortie)
/** 面板主体这一层看到的战斗：收纳时是 null，四段渲染跟着退回航行态。 */
export const bodyBattleOf = (sortie) => loaded.bodyBattleOf(sortie)

/**
 * 摆一次友军要請状态。`null` = 把键整个删掉，也就是**未知**
 * （从没收到过 set_friendly_request）——那是默认局面，与「flag 为 0」不是一回事。
 */
export const setFriendlyRequest = (value) => {
  if (value == null) delete loaded.mg.friendlyRequest
  else loaded.mg.friendlyRequest = value
}

/** 一条能喂进上面任何一段的最小战斗视图；逐例只覆盖自己关心的键。 */
export const battleOf = (patch = {}) => ({
  kind: 'day',
  practice: false,
  hasNight: false,
  fFormation: 1,
  eFormation: 1,
  engagement: 1,
  fShips: Array.from({ length: 12 }, (_, i) => shipOf(i, `我舰${i + 1}`)),
  eShips: Array.from({ length: 6 }, (_, i) => shipOf(i, `敌舰${i + 1}`)),
  friendShips: [],
  stages: [],
  attacks: [],
  air: null,
  air2: null,
  airInjection: null,
  flarePos: null,
  detection: null,
  nightContact: null,
  smokeType: 0,
  activeDeck: null,
  hasSupport: false,
  flavorVoices: [],
  prediction: {
    rank: 'S',
    perfect: true,
    sure: true,
    fGauge: 0,
    fTaken: 0,
    eGauge: 100,
    fSunk: 0,
    fCount: 6,
    eSunk: 6,
    eCount: 6,
  },
  result: null,
  ts: 0,
  ...patch,
})

export const shipOf = (index, name) => ({
  index,
  name,
  mstId: 100 + index,
  fleet: index >= 6 ? 'escort' : 'main',
  position: index >= 6 ? index - 6 : index,
  hpStart: 50,
  hpEnd: 50,
  hpMax: 50,
  escaped: false,
  sunk: false,
  defeated: false,
  damageDealt: 0,
  repairItemUsed: null,
})

export const airOf = (patch = {}) => ({
  seiku: 0,
  fCount: 10,
  fLost: 0,
  eCount: 10,
  eLost: 0,
  fLost2: 0,
  eLost2: 0,
  touchF: -1,
  touchE: -1,
  aaCutinIdx: null,
  aaCutinKind: null,
  ...patch,
})

export const stageOf = (order, label, air = null, patch = {}) => ({
  order,
  phase: 'air',
  label,
  source: 'api_kouku',
  simultaneous: false,
  air,
  ...patch,
})

export const sortieOf = (patch = {}) => ({
  active: true,
  practice: false,
  mapArea: 1,
  mapNo: 5,
  deckId: 1,
  bossCell: -1,
  nodes: [],
  currentCell: 1,
  cellData: [],
  selectRoute: [],
  practiceOpponent: null,
  battle: null,
  battleCount: 1,
  drops: [],
  sunkShips: [],
  anchorageRepairs: [],
  airBaseStrikes: {},
  bossCleared: null,
  startTs: 0,
  updatedTs: 0,
  ...patch,
})
