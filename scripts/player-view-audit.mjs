import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { BUNDLED_LODE_IDS, REPO_ROOT } from './lib/bundled-lodes.mjs'
import { userDataDir } from './lib/data-dir.mjs'
import { runtimeHost, plainHtml, runProductionSection, inlineProductionFunction } from './lib/player-view-runtime.mjs'

export const defaultDataDir = () => userDataDir()
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const link = (_kind, _id, label) => esc(label)
const source = 'src/renderer/modules/ji.ts'

export function assembleModes(dataDir = defaultDataDir()) {
  const host = runtimeHost({ './env': { ROOT: REPO_ROOT, APPDATA_PATH: dataDir } })
  const { loadAll } = host.extract('src/main/lode.ts', ['loadAll']).api
  const sources = { builtinDir: path.join(REPO_ROOT, 'assets/lodes'), builtinIds: BUNDLED_LODE_IDS }
  const userDir = path.join(dataDir, 'lodes')
  const userFiles = fs.existsSync(userDir) ? fs.readdirSync(userDir).filter(name => name.endsWith('.json')).map(name => path.join(userDir, name)) : []
  const player = loadAll(sources)
  for (const id of BUNDLED_LODE_IDS) if (!player.has(id)) throw new Error(`随包资料未成功装配：${id}`)
  return { player, developer: loadAll({ ...sources, userDir }), userFiles }
}

// 「格」是最终输出中的标量叶子；空串/null/空容器不计有值格。
// HTML 域先取可见文本；字幕按形态×槽计一格，不把一句台词拆成字符。
export function flatten(value, prefix = '', out = {}) {
  if (value == null || value === '') return out
  if (typeof value === 'object') {
    for (const key of Object.keys(value).sort()) flatten(value[key], prefix ? `${prefix}/${key}` : key, out)
  } else out[prefix] = value
  return out
}
export function compareViews(player, developer) {
  return [...new Set([...Object.keys(player), ...Object.keys(developer)])].map(domain => {
    const a = flatten(player[domain]), b = flatten(developer[domain])
    const differences = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().flatMap(key =>
      a[key] === b[key] ? [] : [{ domain, key, kind: !(key in a) ? '缺' : !(key in b) ? '多' : '差', player: a[key] ?? null, developer: b[key] ?? null }])
    return { domain, playerCells: Object.keys(a).length, developerCells: Object.keys(b).length, differences }
  })
}

async function consume(packs, raw) {
  const p = id => packs.get(id) ?? null
  const d = id => p(id)?.data
  const ships = raw.api_mst_ship ?? []
  const equips = raw.api_mst_slotitem ?? []
  const friendlyShips = new Map(ships.filter(s => s.api_sortno > 0).map(s => [s.api_id, s]))
  const friendlyEquips = new Map(equips.map(s => [s.api_id, s]))
  const abyssalShips = new Map(ships.filter(s => !s.api_sortno).map(s => [s.api_id, s]))
  const mg = { master: { ships: Object.fromEntries(ships.map(s => [s.api_id, { name: s.api_name, stype: s.api_stype, sortId: s.api_sort_id }])), slotitems: Object.fromEntries(equips.map(s => [s.api_id, { name: s.api_name }])), missions: {}, upgrades: {} }, ships: {}, slotitems: {}, decks: [], mapGauges: {}, eventAreas: {}, sortie: null }
  const host = runtimeHost({
    // uiGet/uiSet：界面偏好（如改修收藏名单）一律按空账户处理，审计看的是资料本身
    './kernel': { mg, esc, queryLode: async id => p(id), queryMasterRaw: async () => ({ data: raw }), masterShipName: id => mg.master.ships[id]?.name ?? String(id), uiGet: (_key, fallback) => fallback, uiSet: () => {} },
    './env': { ROOT: REPO_ROOT, APPDATA_PATH: '' },
  })
  const shared = name => host.load(`src/shared/${name}.ts`)
  const localization = host.extract('src/renderer/localization.ts', ['initLocalization', 'entityNamePlain', 'entityNameHtml', 'entityTermHtml', 'localizedEntityId'], { esc, queryLode: async id => p(id), installFoldToggle: () => {} }).api
  await localization.initLocalization()
  const common = { mg, esc, elink: link, ...localization, masterShipName: id => mg.master.ships[id]?.name ?? String(id), lodeCreditMark: () => '', lodeCredit: () => '', lodeCreditShort: () => '', useitemCount: () => 0, shipThumbHtml: () => '', fmtDateTime: value => String(value), fmtDate: value => new Date(value).toISOString().slice(0, 10) }
  const out = {}, signs = {}
  mg.master.upgrades = runProductionSection('src/main/mg/store.ts', "const upgrades: MgState['master']['upgrades'] = {}", 'const bgms:', { body: raw }, 'globalThis.result = upgrades').result
  const collectSigns = (domain, html) => {
    // 只从已执行的渲染输出取挂牌，不从源码/健康度影响说明猜测。
    const notices = String(html).match(/>[^<>]*(?:待补|暂无|未收录|尚未|未加载|资料缺失|待验证)[^<>]*</g) ?? []
    for (const notice of notices) (signs[domain] ??= new Set()).add(plainHtml(notice.slice(1, -1)))
  }
  const render = (domain, key, html) => {
    ;(out[domain] ??= {})[key] = plainHtml(html)
    collectSigns(domain, html)
  }

  for (const m of raw.api_mst_mission ?? []) mg.master.missions[m.api_id] = { dispNo: m.api_disp_no, name: m.api_name, time: m.api_time, deckNum: m.api_deck_num, details: m.api_details }
  const bi = host.extract('src/renderer/modules/bi.ts', ['allExpeds', 'checkShips'], {
    ...common, expedLocalizationLode: p('kcwiki-expedition') ? { ...p('kcwiki-expedition'), data: host.load('src/renderer/kcwiki-zh.ts').simplifyKcwikiExpeditionData(d('kcwiki-expedition')) } : null, expedLode: p('expedition-facts'),
    compViewOf: () => [], expeditionStatShipsOf: () => [], drumStock: () => 0,
    stypeOf: () => 0, isCveShip: () => false, drumCount: () => 0,
  }).api
  out['远征合并'] = {}; out['远征检查行'] = {}
  for (const e of bi.allExpeds()) {
    out['远征合并'][e.dispNo] = e
    out['远征检查行'][e.dispNo] = bi.checkShips(e, [])
    for (const row of out['远征检查行'][e.dispNo].rows) if (/资料缺失|待验证/.test(row.text)) (signs['远征检查行'] ??= new Set()).add(plainHtml(row.text))
  }

  const voice = host.extract('src/renderer/voice-subtitle.ts', ['loadData', 'captionsFor'], {
    ...common, queryLode: async id => p(id), queryMasterRaw: async () => ({ data: raw }),
    setShipGraph: () => {}, voicePlaybackObservationAt: () => null,
    canonicalAbyssalSpeakerLabel: value => value,
  }).api
  await voice.loadData()
  out['舰娘实时字幕'] = {}
  for (const id of friendlyShips.keys()) for (const slot of shared('voice-probe-plan').voiceSkeletonSlots({ mstId: id, covered: new Set() })) {
    out['舰娘实时字幕'][`${id}/${slot}`] = voice.captionsFor({ kind: 'ship', mstId: id, voiceId: slot }).map(line => line.text).join('\n')
  }
  out['深海字幕'] = {}
  const voiceIds = new Set(Object.keys(d('subtitle-enemies') ?? {}))
  for (const id of abyssalShips.keys()) for (const suffix of ['10', '11', '20', '21', '30', '31', '40', '41']) voiceIds.add(`${id >= 2000 ? id : String(id - 1000).padStart(4, '0')}${suffix}`)
  for (const voiceId of voiceIds) out['深海字幕'][voiceId] = voice.captionsFor({ kind: 'enemy', voiceId }).map(line => line.text).join('\n')

  await host.load('src/renderer/map-intel.ts').initMapIntel()
  const intel = shared('map-intel')
  const duState = { ...common, friendlyFleetMaps: d('event-friendly-fleets')?.maps ?? {}, friendlyFleetMeta: p('event-friendly-fleets')?.meta, mapIntelMeta: p('event-map-intel')?.meta, linkifyRewardText: esc, gimmickProgress: {}, friendlyFleetsOf: () => [], ensureFriendlyFleets: () => {}, ownedSpecialHtml: () => '', eventLifecycleLode: p('event-lifecycle'), eventArchives: [], eventAreaIds: new Set((raw.api_mst_maparea ?? []).filter(a => a.api_id >= 10).map(a => a.api_id)) }
  const du = host.extract('src/renderer/modules/du.ts', ['rewardCardHtml', 'gimmickCardHtml', 'extrasCardHtml', 'friendlyFleetMaterialsHtml'], duState).api
  const mapRenderer = host.extract(source, ['prefetchHtml', 'dropPoolHtml'], {
    ...common, abyssalShips, chainInstances: () => [], rootOf: new Map(), mapState: {}, expandedMapDrops: new Set(), localDropPoolHtml: () => '',
  }).api
  const bonus = host.extract('src/renderer/combat-forecast.ts', ['eventBonusContext', 'eventBonusOfShip'], common).api
  const period = host.extract(source, ['eventPeriodOf'], duState).api
  for (const domain of ['活动敌编成', '活动掉落', '活动机关', '活动航程', '活动奖励', '活动友军', '活动特效', '活动特效倍率', '活动截止日']) out[domain] = {}
  for (const [code, entry] of intel.mapIntelEntries()) {
    const [area, no] = code.split('-').map(Number)
    if (area < 10) continue
    const info = { api_maparea_id: area, api_no: no, api_id: area * 10 + no }
    out['活动截止日'][code] = period.eventPeriodOf(info)
    for (const [rank, difficulty] of ['丁', '丙', '乙', '甲'].entries()) {
      mg.mapGauges[info.api_id] = { selectedRank: rank + 1 }
      const key = `${code}/${difficulty}`, map = intel.mapIntelMap(code, difficulty)
      const ops = intel.eventOperationsOf(code, difficulty)
      out['活动敌编成'][key] = Object.fromEntries(Object.entries(map?.nodes ?? {}).map(([node, row]) => [node, row.enemyComps]))
      out['活动掉落'][key] = intel.mapDropPool(code, difficulty)
      out['活动航程'][key] = ops?.nodeDistances
      collectSigns('活动敌编成', mapRenderer.prefetchHtml(code, difficulty))
      collectSigns('活动掉落', mapRenderer.dropPoolHtml(code, info.api_id, difficulty))
      render('活动机关', key, du.gimmickCardHtml(info))
      render('活动奖励', key, du.rewardCardHtml(info))
      render('活动友军', key, du.friendlyFleetMaterialsHtml(code, ops, []))
      render('活动特效', key, du.extrasCardHtml(info))
    }
    // 同一张活动图逐节点×舰娘形态运行倍率消费，编成固定无装备；组员表另记以覆盖装备组。
    out['活动特效倍率'][`${code}/上下文`] = bonus.eventBonusContext(p('event-bonus'), info.api_id, null)
    const nodes = new Set(['甲', '乙', '丙', '丁'].flatMap(difficulty => Object.keys(intel.mapIntelMap(code, difficulty)?.nodes ?? {})))
    for (const node of nodes) {
      const context = bonus.eventBonusContext(p('event-bonus'), info.api_id, node)
      for (const id of friendlyShips.keys()) {
        const result = bonus.eventBonusOfShip({ shipId: id, slot: [], slotEx: 0 }, context)
        out['活动特效倍率'][`${code}/${node}/${id}`] = { multiplier: result.multiplier, certain: result.certain }
      }
    }
  }

  out['装备改修'] = {}; out['装备说明'] = {}
  const improve = shared('akashi-improve')
  for (const id of friendlyEquips.keys()) {
    const item = improve.akashiImproveItem(id, d('kcwiki-akashi-improve'), d('akashi-list'))
    out['装备改修'][id] = { schedule: (d('equip-improve') ?? []).find(e => e.eq_id === id), stars: item.item_remodel }
    out['装备说明'][id] = item.item_intro
  }
  out['任务前置链'] = {}
  const quests = Object.values(d('quests-scn') ?? {}), codes = new Set(quests.map(q => q.code))
  for (const q of quests) out['任务前置链'][q.code] = shared('quest-pre-merge').mergeQuestPre(q.pre, d('wikiwiki-quests')?.[q.code], codes, shared('quest-pre-arbitration').QUEST_PRE_ARBITRATION.get(q.code))

  const kcwikiByMst = new Map(Object.values(host.load('src/renderer/kcwiki-zh.ts').simplifyKcwikiShipsData(d('kcwiki-ships') ?? {})).map(row => [Number(row.ID), row]))
  const shipProfileByMst = new Map(Object.values(d('wikiwiki-ship-profile') ?? {}).map(row => [Number(row.shipId), row]))
  const rootOf = new Map([...shared('voice-lineage').buildVoiceFallbackIds(ships, raw.api_mst_shipupgrade)].map(([id, chain]) => [id, chain.at(-1)]))
  const jiState = { ...common, friendlyShips, friendlyEquips, kcwikiByMst, shipProfileByMst, rootOf,
    useitemMst: new Map((raw.api_mst_useitem ?? []).map(row => [row.api_id, row])),
    remodelFactsLode: p('remodel-facts'), itemExchangeLode: p('item-facts'),
    devRecipeLode: p('development-facts'), buildRecipeLode: p('construction-facts'), factoryOwnHtml: () => '', exchangeGetsHtml: esc,
  }
  // 图鉴加载时的 overlay、归属校正与深海音轨锚定原样执行。
  const voiceState = runProductionSection(source, '        installZhSimplifier(opencc)', '        // 三层第一方台账在', {
    ...jiState, ...shared('voice-overlay'), ...shared('voice-scene-slots'), ...shared('voice-lineage'),
    ...host.load('src/renderer/zh-simplify.ts'), ...shared('npc-voice-book'),
    v: p('kcwiki-voice'), sv: p('kcwiki-seasonal-voice'), w: p('wikiwiki-voice'), a: p('wikiwiki-abyss-voice'), ka: p('kuma-abyss-voice'),
    z: p('subtitle-zh'), j: p('subtitle-ja'), e: p('subtitle-enemies'), kv: p('kuma-voice'), kvZh: p('kuma-voice-zh'), npc: p('subtitle-npc'), opencc: p('opencc-t2s'),
    kcwikiLode: p('kcwiki-ships'), abyssalShips,
    resolveAbyssalName: name => [...abyssalShips.values()].find(s => s.api_name === name)?.api_id ?? null,
    localizedEntityId: localization.localizedEntityId,
  })
  const voiceRows = {}
  const rowRenderer = host.extract(source, ['voiceRowWithUrl'], { ...common }).api
  const rowHtml = (key, scene, ja, zh, slot) => {
    const html = rowRenderer.voiceRowWithUrl(key, scene, ja, zh, null)
    const cell = slot ?? shared('voice-scene-slots').voiceSlotOfKey(key) ?? `无槽:${shared('voice-lineage').normalizeVoiceLine(ja) || key}`
    const text = cls => plainHtml(html.match(new RegExp(`<[^>]+class="${cls}"[^>]*>([\\s\\S]*?)<\\/`))?.[1] ?? '')
    ;(voiceRows[cell] ??= []).push({ scene: text('vo-k'), ja: text('vo-ja'), zh: text('vo-zh') })
    return html
  }
  const book = host.extract(source, ['regularVoiceHtml', 'abyssDetailTabs'], {
    ...voiceState, ...jiState, abyssalShips,
    voiceFallbackOf: shared('voice-lineage').buildVoiceFallbackIds(ships, raw.api_mst_shipupgrade),
    abyssSameNameForms: shared('abyss-voice-file').buildAbyssVoiceSameNameForms([...abyssalShips.values()].map(s => ({ id: s.api_id, name: s.api_name }))),
    voiceRow: (_sourceId, _targetId, key, scene, ja, zh, correction) => rowHtml(key, scene, ja, zh, correction?.slot),
    voiceRowWithUrl: (key, scene, ja, zh) => rowHtml(key, scene, ja, zh),
    kumaVoiceUrl: () => null, kumaVoiceOffNote: () => '', skeletonRows: () => [],
    extraVoiceUrl: () => null, archivedExtraVoiceUrl: () => null,
    voiceState: () => ({ enabled: true }), bareArchiveRows: () => [], archiveVariantRows: () => [],
    abyssArchiveRows: () => [], abyssArchiveIndex: () => new Map(), ensureAbyssVoiceSightings: () => {}, abyssHeardVoiceId: () => null, abyssGuessBlock: () => '',
  }).api
  out['图鉴台词卷'] = {}; out['深海台词卷'] = {}; out['舰娘档案'] = {}
  for (const ship of ships) {
    for (const key of Object.keys(voiceRows)) delete voiceRows[key]
    const html = book.regularVoiceHtml(ship.api_id)
    const domain = ship.api_sortno ? '图鉴台词卷' : '深海台词卷'
    out[domain][ship.api_id] = structuredClone(voiceRows)
    // 借用注与页签属于实际显示；正文按行/语言对比，避免一行变化把整页计成一格。
    const notices = String(html).match(/<div class="vo-note">[\s\S]*?<\/div>/g) ?? []
    for (const notice of notices) (signs[domain] ??= new Set()).add(plainHtml(notice))
    if (!ship.api_sortno) out[domain][`${ship.api_id}/tabs`] = book.abyssDetailTabs(ship)
    else {
      const state = { ...jiState, wikiEntry: kcwikiByMst.get(ship.api_id), shipState: { selectedForm: ship.api_id }, ...shared('ship-class-name'), growthGapNote: '', equipTypeIconHtml: () => '' }
      render('舰娘档案', `${ship.api_id}/身份`, inlineProductionFunction(source, '// kcwiki 收录则整行 kcwiki;', state))
      if (!state.wikiEntry) render('舰娘档案', `${ship.api_id}/初期装备`, inlineProductionFunction(source, '// kcwiki 没收这一形态时,初期装备', state))
      else out['舰娘档案'][`${ship.api_id}/初期装备`] = state.wikiEntry.装备?.初期装备
    }
  }
  const ji = host.extract(source, ['needChipsHtml', 'itemFunctionHtml', 'itemExchangeHtml', 'devRecipeHtml', 'buildRefHtml'], jiState).api
  out['改造需求chip'] = {}; out['道具用途'] = {}; out['道具兑换'] = {}; out['建造参考'] = {}; out['开发参考'] = {}
  const remodelPairs = new Set([...friendlyShips.values()].filter(s => Number(s.api_aftershipid) > 0).map(s => `${s.api_id}/${Number(s.api_aftershipid)}`))
  for (const row of raw.api_mst_shipupgrade ?? []) if (row.api_current_ship_id > 0) remodelPairs.add(`${row.api_current_ship_id}/${row.api_id}`)
  for (const pair of remodelPairs) {
    const [current, target] = pair.split('/').map(Number)
    const result = ji.needChipsHtml(kcwikiByMst.get(current)?.改造?.图纸, target, current)
    // 分档格必须保留档名及缺项状态；同素材两档不能被 Object.fromEntries 后值覆盖。
    out['改造需求chip'][`${current}→${target}`] = Object.fromEntries(result.stages.map(group => [group.stage, {
      missing: group.missing,
      needs: Object.fromEntries(group.needs.map(need => [`${need.kind}:${need.id ?? need.name}`, { name: need.name, count: need.count }])),
    }]))
  }
  for (const ship of friendlyShips.values()) {
    render('建造参考', ship.api_id, ji.buildRefHtml(ship.api_id))
  }
  for (const item of raw.api_mst_useitem ?? []) {
    render('道具用途', item.api_id, ji.itemFunctionHtml(item.api_id))
    render('道具兑换', item.api_id, ji.itemExchangeHtml(item.api_id))
  }
  for (const item of equips) render('开发参考', item.api_id, ji.devRecipeHtml(item.api_name, item.api_id))
  const improveState = { ...jiState, eoByEquip: new Map((d('equip-improve') ?? []).map(e => [e.eq_id, e])), eoLode: p('equip-improve'),
    improveCoverageMax: shared('equip-sources').improvePackCoverageMax(d('equip-improve') ?? []), kcwikiAkashiLode: p('kcwiki-akashi-improve'), akashiListLode: p('akashi-list'),
    unlockedEquipCount: () => 0, equipVisualLink: (id, name) => esc(name ?? friendlyEquips.get(id)?.api_name ?? id), improvementMaterialLink: (_id, name) => esc(name),
    jstDayOfWeek: () => 0, JST_WEEKDAY_LABELS: ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'],
  }
  mg.materials = {}; mg.useitems = {}
  const improveRender = host.extract(source, ['improveSectionHtml', 'foldedNote'], improveState).api
  for (const e of equips) {
    const html = improveRender.improveSectionHtml(e, [])
    const intro = runProductionSection(source, '  const introLode =', '\n\n  return `', { ...improveState, ...improveRender, ...improve, e }, 'globalThis.result = introHtml').result
    // 展示域只采挂牌；数值差异由上面的逐星/日程/说明叶子报告。
    for (const [domain, rendered] of [['装备改修', html], ['装备说明', intro]]) {
      for (const notice of String(rendered).match(/>[^<>]*(?:待补|暂无|未收录|尚未|待验证)[^<>]*</g) ?? []) (signs[domain] ??= new Set()).add(plainHtml(notice.slice(1, -1)))
    }
  }
  out['日文带路说明'] = {}
  const routing = host.extract(source, ['wikiwikiRoutingHtml'], { ...common, wikiwikiRoutingLode: p('wikiwiki-routing'), routingRuleShipNameIndex: new Map() }).api
  for (const [code] of intel.mapIntelEntries()) render('日文带路说明', code, routing.wikiwikiRoutingHtml(code))
  return { domains: out, signs: Object.fromEntries(Object.keys(out).map(domain => [domain, [...(signs[domain] ?? [])].sort()])) }
}

export async function auditPlayerView({ dataDir = defaultDataDir(), masterFile = path.join(dataDir, 'snapshots/kcsapi_api_start2_getData.json') } = {}) {
  const modes = assembleModes(dataDir)
  const userFiles = modes.userFiles.map(file => ({ name: path.basename(file), sha256: hash(file) }))
  if (!modes.userFiles.length && !fs.existsSync(masterFile)) return { noDeveloperLayer: true, domains: [], signs: {}, userFiles: [] }
  const snapshot = json(masterFile)
  const raw = snapshot.body?.api_data ?? snapshot.data ?? snapshot.api_data
  if (!raw?.api_mst_ship?.length) throw new Error(`缺少可执行消费链的游戏主数据：${masterFile}`)
  const player = await consume(modes.player, raw)
  const developer = await consume(modes.developer, raw)
  for (const [index, file] of modes.userFiles.entries()) if (hash(file) !== userFiles[index].sha256) throw new Error(`审计期间用户包发生变化，请重跑：${file}`)
  return { noDeveloperLayer: !modes.userFiles.length, domains: compareViews(player.domains, developer.domains), signs: player.signs,
    master: { file: masterFile, sha256: hash(masterFile), ships: raw.api_mst_ship.length },
    userFiles,
    bundledIds: BUNDLED_LODE_IDS }
}

export function formatAudit(report) {
  if (report.noDeveloperLayer) return '无开发机层，口径检查按随包即开发机通过'
  const lines = ['| 消费域 | 玩家缺/差/多格 | 玩家有值格 | 开发机有值格 |', '| --- | ---: | ---: | ---: |']
  for (const row of report.domains) lines.push(`| ${row.domain} | ${row.differences.filter(d => d.kind === '缺').length}/${row.differences.filter(d => d.kind === '差').length}/${row.differences.filter(d => d.kind === '多').length} | ${row.playerCells} | ${row.developerCells} |`)
  for (const row of report.domains) {
    lines.push(`\n${row.domain}：前 20 条差异（共 ${row.differences.length}）`)
    for (const diff of row.differences.slice(0, 20)) lines.push(JSON.stringify(diff))
  }
  lines.push('\n玩家模式实际挂牌文案：', JSON.stringify(report.signs, null, 2))
  return lines.join('\n')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await auditPlayerView()
  console.log(formatAudit(report))
  const output = process.argv.find(arg => arg.startsWith('--json='))?.slice(7)
  if (output) fs.writeFileSync(path.resolve(output), JSON.stringify(report, null, 2) + '\n')
}
