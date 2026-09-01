// 铭 · 接线：锚(broadcaster) → 账本 + 归约器 → 推送渲染层。
// 启动时从最新快照回放，未开游戏也能看到「上次已知状态」（带时间戳标注新鲜度）。
import { app, BrowserWindow, ipcMain } from 'electron'

import broadcaster from '../game-api-broadcaster'
import {
  queryAbyssVoiceSightings,
  recordAbyssVoiceArchaeology,
} from '../abyss-voice-sightings'
import { isAbyssMstId } from '../../shared/kcs-domain'
import { onChronicleApi } from './chronicle'
import { appendPerf } from '../perf-log'
import ledger from './ledger'
import { getLode } from '../lode'
import { devSecretaryTypeOf } from '../../shared/factory-lookup'
import config from '../config'
import { mapIdOf } from '../../shared/map-id'
import {
  ITEM_USE_CATEGORY,
  createItemUseRefreshTracker,
  itemUseMaterialCategory,
} from '../../shared/item-use-materials'
import { questFixedSenka, senkaMonthEnd, senkaMonthStart } from '../../shared/senka'
import type { SenkaQuestOption } from '../../shared/senka'
import { questAnnualMonth, questPeriodFromCode } from '../../shared/quest-period'
import type { QuestPeriodKind } from '../../shared/quest-period'
import { onQuestApi, reconcileQuestProgress } from './quest-counter-host'
import { buildPowerupResultCue } from './powerup-result'
import { onShipLifeApi, primeShipLife } from './ship-life'
import * as store from './store'
import {
  flushVoiceUnmatched,
  recordVoiceUnmatched,
  voiceUnmatchedStats,
} from '../voice-diagnostics'
import { isGameWebContents, primeArtArchiveFromCache } from '../kcs-resource'
import { shipArtPaths } from '../ship-art-store'
import {
  noteShipCostumeBackfill,
  rememberPictureBookCostumes,
  shipCostumeBackfillCursor,
  shipCostumes,
} from '../ship-costume-store'
import { resourceVersionOf } from '../../shared/voice-request-gate'
import {
  clearVoiceArchive,
  keepVoiceBlob,
  voiceArchiveEntries,
  voiceArchiveStats,
} from '../voice-archive'
import {
  artArchiveEntries,
  artArchiveStats,
  clearArtArchive,
  keepArtBlob,
} from '../art-archive'
import {
  bgmArchiveEntries,
  bgmArchiveStats,
  clearBgmArchive,
  keepBgmBlob,
} from '../bgm-archive'
import { captureDisplayedArt, captureDisplayedVoice } from '../archive-capture'
import { clearVoiceAbsent, probeVoiceSlot, voiceAbsentEntries } from '../voice-probe'
import {
  applySlotitemInventoryMutation,
  destroyedSlotitemIds,
} from '../../shared/slotitem-mutation'

import type { FitObservationRecord } from '../../shared/fit-observation'
import type {
  MarriageCue,
  PowerupResultCue,
  Section,
  SlotitemInstance,
} from '../../shared/mg-types'

const MARRIAGE_PATH = '/kcsapi/api_req_kaisou/marriage'
const HANGAR_EXPAND_PATH = '/kcsapi/api_req_kaisou/hangar_expand'

const pickSections = (sections: Section[]) => {
  const state = store.getState()
  const patch: Record<string, unknown> = {}
  for (const section of new Set(sections)) {
    switch (section) {
      case 'master':
        patch.master = state.master
        break
      case 'basic':
        patch.basic = state.player.basic
        break
      case 'materials':
        patch.materials = state.player.materials
        break
      case 'ships':
        patch.ships = state.player.ships
        break
      case 'decks':
        patch.decks = state.player.decks
        patch.combinedFlag = state.player.combinedFlag // 联合编成随编队一起推
        // 泊地修理的计时锚点也是按队记的，且两个归零点（编成变更 / 回港落账）
        // 返回的切片里都有 decks——搭这班车走，不必为它单开一个 Section
        patch.berthSince = state.player.berthSince
        break
      case 'airBases':
        patch.airBases = state.player.airBases
        patch.airBasesTs = state.player.airBasesTs
        break
      case 'ndocks':
        patch.ndocks = state.player.ndocks
        break
      case 'kdocks':
        patch.kdocks = state.player.kdocks
        break
      case 'slotitems':
        patch.slotitems = state.player.slotitems
        break
      case 'quests':
        patch.quests = state.player.quests
        patch.questsTs = state.player.questsTs
        patch.questsFullTs = state.player.questsFullTs
        patch.questActiveIds = state.player.questActiveIds
        patch.questActiveTs = state.player.questActiveTs
        patch.questExecCount = state.player.questExecCount
        break
      case 'useitems':
        patch.useitems = state.player.useitems
        patch.useitemsTs = state.player.useitemsTs
        break
      case 'furnitures':
        patch.furnitures = state.player.furnitures
        break
      case 'portLogs':
        patch.portLogs = state.player.portLogs
        break
      case 'sortie':
        patch.sortie = state.sortie
        break
      case 'mapGauges':
        patch.mapGauges = state.mapGauges
        break
      case 'eventAreas':
        patch.eventAreas = state.eventAreas
        break
      case 'friendlyRequest':
        patch.friendlyRequest = state.player.friendlyRequest
        break
      case 'practice':
        patch.practice = state.player.practice
        break
      case 'record':
        patch.record = state.player.record
        break
      case 'payitems':
        patch.payitems = state.player.payitems
        break
      case 'battleReconciliation':
        patch.battleReconciliation = state.battleReconciliation
        break
    }
  }
  patch.lastPortTs = state.player.lastPortTs
  return patch
}

const broadcast = (sections: Section[]) => {
  if (!sections.length) return
  const patch = pickSections(sections)
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('mg:patch', patch)
    }
  }
}

const broadcastSortieScreen = (ts: number) => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('mg:sortie-screen', ts)
  }
}

const broadcastGameScene = (scene: 'mission' | 'away') => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('mg:game-scene', scene)
  }
}

const broadcastPowerupResult = (result: PowerupResultCue) => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('mg:powerup-result', result)
  }
}

// ケッコンカッコカリ。一手信号是**这条 path 到达**，这是只有主进程看得见的事实；
// 渲染层能自己推的只有「某舰 lv 99→100」，那是推断，而且首轮建基线会整段错过。
const broadcastMarriage = (cue: MarriageCue) => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('mg:marriage', cue)
  }
}

// 分类记账：path → 收支来源。port 只能确认“当前余额与上次已知余额的校准差额”；
// 它可能混有自然回复、基地航空消耗、跨登录操作与尚未单独归类的旧接口，
// 因此不能再把所有正负变化误称为「自然回复」。
const DELTA_CATEGORY: Record<string, string> = {
  '/kcsapi/api_req_hokyu/charge': '补给',
  '/kcsapi/api_req_nyukyo/start': '入渠',
  '/kcsapi/api_req_nyukyo/speedchange': '入渠',
  '/kcsapi/api_req_kousyou/createship': '建造',
  '/kcsapi/api_req_kousyou/createship_speedchange': '建造',
  '/kcsapi/api_req_kousyou/createitem': '开发',
  '/kcsapi/api_req_kousyou/destroyship': '解体',
  '/kcsapi/api_req_kousyou/destroyitem2': '废弃返还',
  '/kcsapi/api_req_kousyou/remodel_slot': '改修',
  '/kcsapi/api_req_mission/result': '远征',
  '/kcsapi/api_req_quest/clearitemget': '任务',
  '/kcsapi/api_req_air_corps/set_plane': '基地航空队',
  '/kcsapi/api_req_air_corps/supply': '基地航空队',
  '/kcsapi/api_req_map/start': '海域资源点',
  '/kcsapi/api_req_map/next': '海域资源点',
  '/kcsapi/api_port/port': '母港校准',
  // 用道具的资源**不在这两条回包里**（payitemuse 只回一个标志位，itemuse 本机零资源样本），
  // 到账走的是紧随其后的 api_get_member/material——归属判据在 shared/item-use-materials。
  // 这一条只兜「将来某种道具的响应自己带上了资源」那种情况。
  '/kcsapi/api_req_member/itemuse': ITEM_USE_CATEGORY,
}

// 用道具 → 下一包才到账，所以状态机跨包活着（见 shared/item-use-materials 的实测头注）。
const itemUseRefresh = createItemUseRefreshTracker()

/**
 * 任务资料库里这个任务的战果分值与周期口径。解不出固定战果就返回 null
 *（不是战果任务，或资料库没收录——两种都不该入账）。
 *
 * **分值一律从主进程自己的 quests-scn 现解**，不接受任何外部递来的数字：
 * 渲染层曾经把 senka 值一路 IPC 递进来，账本照写不误（那条通道 2026-09-01 已撤）。
 * 实时领奖与查账时的报文补记共用这一份，两条路解不出第二套口径。
 */
const questSenkaInfo = (
  questId: number,
): { senka: number; kind: QuestPeriodKind | null; annualMonth: number | null } | null => {
  if (!(questId > 0)) return null
  const entry = (getLode('quests-scn')?.data as any)?.[`${questId}`]
  if (!entry) return null
  const resetNote = `${entry.memo2 ?? ''}`
  const senka = questFixedSenka([entry.memo, entry.memo2].filter(Boolean).join(' | '))
  if (!senka) return null
  return {
    senka,
    kind: questPeriodFromCode(`${entry.code ?? ''}`, resetNote),
    annualMonth: questAnnualMonth(resetNote),
  }
}

const handleEvent = (
  apiPath: string,
  body: unknown,
  postBody: Record<string, string>,
  ts: number,
) => {
  // 每一包都推进一次：用道具那一包只负责武装，钱要到下一包才落地。
  // 放在最前面是因为它必须看见**所有**报文，而下面的分支随时会提前返回。
  const itemUseCategory = itemUseMaterialCategory(itemUseRefresh, apiPath, ts)
  // 废弃归约会立刻从库存删除实例；任务引擎仍要知道“删掉的是哪种装备”。
  // 只保留本次请求涉及的实例，不复制整份装备库。
  const destroyedSlotitems =
    apiPath === '/kcsapi/api_req_kousyou/destroyitem2'
      ? destroyedSlotitemIds(postBody).reduce<Record<number, SlotitemInstance>>((result, id) => {
          const item = store.getState().player.slotitems[id]
          if (item) result[id] = { ...item }
          return result
        }, {})
      : undefined
  const powerupTarget =
    apiPath === '/kcsapi/api_req_kaisou/powerup'
      ? store.getState().player.ships[Number(postBody.api_id)]
      : undefined
  // 近代化改修的**素材舰**在归约里当场被删（removeRosterShips），事后再问
  // 「刚才喂进去的是 3 艘什么舰」永远查不到——Gy1-Gy4/G10-G11 的素材舰种条件
  // 只能靠动作前这一份 在籍 id → 图鉴 id。只记本次涉及的几艘，不复制整份在籍表。
  const powerupShipIds =
    apiPath === '/kcsapi/api_req_kaisou/powerup'
      ? (() => {
          const ships = store.getState().player.ships
          const ids = [
            Number(postBody.api_id),
            ...`${postBody.api_id_items ?? ''}`.split(',').map((id) => Number(id)),
          ]
          const out: Record<number, number> = {}
          for (const id of ids) if (id > 0 && ships[id]) out[id] = ships[id].shipId
          return out
        })()
      : undefined
  // 结婚**前**那一刻的形态与等级（通常 Lv99）。必须在 store.handle 之前取：
  // 归约跑完那艘舰已经是 Lv100 了，「当时等级」就再也说不出来。
  // 认舰先认请求侧的 api_id（同族的 remodeling / open_exslot / powerup 都是这个键），
  // 响应体的 api_id 只做兜底——本机账本里这条 path 零样本，响应形状未经实证。
  // 两个都取不到就留 null：渲染层照样庆祝，只是不指名，绝不猜一艘。
  const marriageRosterId =
    apiPath === MARRIAGE_PATH
      ? [Number(postBody.api_id), Number((body as any)?.api_id)].find((id) => id > 0) ?? null
      : null
  const marriageTarget =
    marriageRosterId != null ? store.getState().player.ships[marriageRosterId] : undefined
  // 格納庫増設**之前**那一刻的各格搭载上限。与结婚同理，必须在 store.handle 之前取：
  // 归约跑完 ship.onslotMax 已经是新值，「原来是几」就再也说不出来了。
  //
  // 已扩过的舰读实例上的 onslotMax；没扩过的舰这一项本来就不存在，回落主数据 maxEq。
  // 同一格可以扩不止一次，所以第二次之后**只有实例值才是对的**，主数据永远是原量。
  const hangarCapsBefore =
    apiPath === HANGAR_EXPAND_PATH
      ? (() => {
          const current = store.getState()
          const ship = current.player.ships[Number(postBody.api_ship_id)]
          if (!ship) return null
          return ship.onslotMax ?? current.master.ships[ship.shipId]?.maxEq ?? null
        })()
      : null
  const expeditionDeckId =
    apiPath === '/kcsapi/api_req_mission/result'
      ? Number(postBody.api_deck_id ?? (body as any)?.api_deck_id ?? 0)
      : 0
  const expeditionMissionId =
    expeditionDeckId > 0
      ? store.getState().player.decks.find((deck) => deck.id === expeditionDeckId)?.mission?.[1] ?? 0
      : 0
  const prevMaterials = store.getState().player.materials
  // EO 特别战果只认「击破那一刻」（cleared 由 false 变 true）。cleared 是常驻状态，
  // 若按「观测到 cleared 就记」，跨战果月后去重窗口清空，月初第一个包会给每张
  // 仍缓存为已破的 EO 图凭空补一笔从未发生的战果。
  const prevEoCleared = new Set(
    Object.entries(store.getState().mapGauges)
      .filter(([, gauge]) => gauge?.cleared)
      .map(([id]) => Number(id)),
  )
  const sections = store.handle(apiPath, body, postBody, ts)
  const powerupResult =
    apiPath === '/kcsapi/api_req_kaisou/powerup'
      ? buildPowerupResultCue(
          powerupTarget,
          body,
          ts,
          // 改修余量要按主数据的 [初始, 上限] 算，实例自报的那对数不是这个意思
          store.getState().master.ships[
            Number((body as any)?.api_ship?.api_ship_id) || powerupTarget?.shipId || 0
          ],
        )
      : null
  if (apiPath === '/kcsapi/api_req_mission/result') {
    ledger.logExpeditionResult(ts, expeditionMissionId, expeditionDeckId, body)
  }
  if (
    apiPath === '/kcsapi/api_req_sortie/battleresult' ||
    apiPath === '/kcsapi/api_req_combined_battle/battleresult' ||
    apiPath === '/kcsapi/api_req_practice/battle_result'
  ) {
    const sortie = store.getState().sortie
    const snapshotId = sortie ? ledger.logBattleSnapshot(ts, sortie) : null
    if (snapshotId && sortie?.battle?.result) sortie.battle.result.snapshotId = snapshotId
  }
  // 任务精确计数 + 遭遇志：都在状态归约之后（依赖已更新的 sortie/decks）
  onQuestApi(apiPath, body, postBody, { destroyedSlotitems, expeditionMissionId, powerupShipIds })
  onChronicleApi(apiPath, body, postBody, ts)
  onShipLifeApi(apiPath, body, postBody, ts, sections, { hangarCapsBefore })
  // 任务领取 → 特别战果。**这一条报文就是任务战果唯一的合法入账证据**
  //（口径与二次翻车的现场见 shared/senka-quest-book）。
  //
  // **领奖报文里没有战果字段**：实测 clearitemget 只回 api_material 与 api_bounus，
  // 而 api_bounus 全是 type=1 的资源/道具——战果是服务器内部计入的，不随奖励下发。
  // 所以分值只能按任务查表（quests-scn 的奖励文本里写了「奖励:80战果」这类固定值），
  // 但「这一笔到底发生没发生」由报文说了算，不由任何推断说了算。
  if (apiPath === '/kcsapi/api_req_quest/clearitemget') {
    const questId = Number(postBody.api_quest_id) || 0
    const info = questSenkaInfo(questId)
    if (info) ledger.logQuestSenka(ts, questId, info.senka, info)
  }

  // 战果账：提督经验每涨一次就是一笔通常战果（× 7/10000）。
  // 只在返港报文里看得到当前值，所以记账点跟着 basic 走——
  // 也只在 basic 真的变了的包上跑（从前每个包都 SELECT 一次 senka_state）。
  if (sections.includes('basic')) {
    const basic = store.getState().player.basic
    if (typeof basic?.experience === 'number') ledger.logHqExp(ts, basic.experience)
  }
  // EO 海域攻略 → 一笔特别战果（只记本包造成的 false→true 跃迁；
  // 同一战果月同一海域只算一次的去重仍在 ledger 侧兜底）。
  //
  // **分值优先用游戏亲发的那个**（击破那一刻的 battleresult 带 api_get_exmap_rate），
  // 只在这一包、只给这一张图用——出击结束后 sortie.battle.result 还留着上一战的值，
  // 拿它去配后来某一包的跃迁就会张冠李戴。别的图（同一包里理论上不会有第二张跃迁，
  // 真有也只可能是 mapinfo 观测补记的）照旧走 ledger 里的兜底表。
  const reportedEo = (() => {
    if (
      apiPath !== '/kcsapi/api_req_sortie/battleresult' &&
      apiPath !== '/kcsapi/api_req_combined_battle/battleresult'
    ) {
      return null
    }
    const sortie = store.getState().sortie
    const senka = sortie?.battle?.result?.exmapSenka
    if (senka == null || !sortie || sortie.practice) return null
    const mapId = mapIdOf(sortie.mapArea, sortie.mapNo)
    return mapId > 0 ? { mapId, senka } : null
  })()
  for (const [id, gauge] of Object.entries(store.getState().mapGauges)) {
    if (!gauge?.cleared || prevEoCleared.has(Number(id))) continue
    ledger.logEoClear(ts, Number(id), reportedEo?.mapId === Number(id) ? reportedEo.senka : null)
  }

  // 资源变动记入 material_log（锱的曲线数据源）+ material_delta（收支分解数据源）
  const materials = store.getState().player.materials
  if (sections.includes('materials') && materials && `${materials}` !== `${prevMaterials}`) {
    ledger.logMaterials(ts, materials)
    if (prevMaterials) {
      const delta = materials.map((v, i) => v - prevMaterials[i])
      if (delta.some((v) => v !== 0)) {
        ledger.logDelta(ts, itemUseCategory ?? DELTA_CATEGORY[apiPath] ?? '其他', delta)
      }
    }
  }
  broadcast(sections)
  if (powerupResult) broadcastPowerupResult(powerupResult)
  // cue 排在 broadcast 之后：横幅上要写的舰名与它跳过去看到的那一行，
  // 必须已经是结婚后的状态。抢在状态落地前发，点进去看到的还是婚前那份。
  if (apiPath === MARRIAGE_PATH) {
    broadcastMarriage({
      ts,
      rosterId: marriageRosterId,
      mstId: marriageTarget?.shipId ?? null,
      level: marriageTarget?.lv ?? null,
    })
  }
  // 成功打开游戏的出击海域选择页后，让渲染层按最新编队状态做一次临行提醒。
  // 用 mapinfo 响应而不是猜 Canvas 点击坐标，缩放/改版后仍可靠。
  if (apiPath === '/kcsapi/api_get_member/mapinfo') broadcastSortieScreen(ts)
  // 玩家正在翻图鉴：把这一页的衣装归属学下来（不发请求，只读它返回的报文）
  if (apiPath === '/kcsapi/api_get_member/picture_book') learnCostumesFrom(body)
  // 打开远征页（api_get_member/mission）时底坞任务/远征格跟到远征；
  // 回母港、出击选择、演习、任务表都算离开，还原进页前那一格。
  if (apiPath === '/kcsapi/api_get_member/mission') broadcastGameScene('mission')
  if (
    apiPath === '/kcsapi/api_port/port' ||
    apiPath === '/kcsapi/api_get_member/mapinfo' ||
    apiPath === '/kcsapi/api_get_member/practice' ||
    apiPath === '/kcsapi/api_get_member/questlist'
  ) {
    broadcastGameScene('away')
  }
  // 领域状态落盘（去抖）：重启后仍能显示「最后一次抓到的内容」
  if (sections.some((s) => DOMAIN_SECTIONS.has(s))) scheduleDomainSave()
}

const DOMAIN_SECTIONS = new Set<Section>([
  'quests',
  'useitems',
  'slotitems',
  'practice',
  'record',
  'mapGauges',
  'eventAreas',
  'airBases',
  'sortie',
  // 友军要請只在玩家动开关那一刻下发一次，不落盘就等于每次重启都退回「未知」
  'friendlyRequest',
  // 母港舰队三件套。少了它们，重启后这三样只能回到「最后一次 port / require_info」
  // 那一刻的定格，定格之后派的远征、开的入渠与建造全部消失（判据写在 store.ts
  // 的 hydrateDomain 那侧）。这三条也正是让 `api_get_member/deck|ndock|kdock`
  // 这几个「不进原始快照」的端点第一次有了跨重启的落点。
  'decks',
  'ndocks',
  'kdocks',
])
let domainSaveTimer: ReturnType<typeof setTimeout> | null = null
const saveDomainNow = () => {
  if (domainSaveTimer) {
    clearTimeout(domainSaveTimer)
    domainSaveTimer = null
  }
  ledger.saveDomainState('domain', store.domainSnapshot())
}
const scheduleDomainSave = () => {
  if (domainSaveTimer) clearTimeout(domainSaveTimer)
  domainSaveTimer = setTimeout(() => {
    saveDomainNow()
  }, 1500)
}
app.on('before-quit', () => {
  if (domainSaveTimer) saveDomainNow()
  flushVoiceUnmatched()
})

type ApiRequestInfo = [string | undefined, string | undefined, string]

// 全量主数据（鉴的数据源）：内存缓存 + 时效戳，start2 到来时刷新
let masterRawCache: { ts: number; data: any } | null = null

const ensureMasterRaw = (): { ts: number; data: any } | null => {
  if (!masterRawCache) {
    const snapshot = ledger.loadSnapshot('/kcsapi/api_start2/getData')
    if (snapshot) {
      masterRawCache = {
        ts: snapshot.ts,
        data: (snapshot.body as any)?.api_data ?? snapshot.body ?? null,
      }
    }
  }
  return masterRawCache
}

/**
 * 「这个号是**当前主数据里真实存在的**深海形态吗」。按主数据时效戳缓存。
 *
 * 深海音轨的档名反解全靠它消歧：只按值域（≥1500）判的话，`30653910` 既能读成
 * 1539 也能读成 6539，反解见两解就弃权，本来收得下的一条会被拒。
 * 主数据还没同步时一律 false——**宁可拒收，不猜归属**。
 */
let abyssFormIds: Set<number> | null = null
let abyssFormMasterTs = 0
const isAbyssFormMstId = (mstId: number): boolean => {
  const raw = ensureMasterRaw()
  if (!raw?.data) return false
  if (!abyssFormIds || abyssFormMasterTs !== raw.ts) {
    abyssFormIds = new Set(
      ((raw.data.api_mst_ship ?? []) as any[])
        .map((ship) => Number(ship.api_id))
        .filter((id) => Number.isInteger(id) && isAbyssMstId(id)),
    )
    abyssFormMasterTs = raw.ts
  }
  return abyssFormIds.has(mstId)
}

/**
 * 「这个号是主数据里真实存在的一艘舰吗」。衣装归属的分界线全靠它。
 *
 * 图鉴条目的 `api_table_id` 把「本条目下的全部真实形态」与「本条目的衣装」
 * 混在一个数组里（村雨那条是 `[44, 244, 5191, …]`：前两个是村雨与村雨改），
 * 只有主数据能把两者分开。主数据还没到位时一律 false——那会让这一次一条都学不到，
 * **宁可学不到，也不能把 244 村雨改记成一套衣装**（判据见 shared/ship-costume）。
 */
let shipFormIds: Set<number> | null = null
let shipFormMasterTs = 0
const isShipMstId = (mstId: number): boolean => {
  const raw = ensureMasterRaw()
  if (!raw?.data) return false
  if (!shipFormIds || shipFormMasterTs !== raw.ts) {
    shipFormIds = new Set(
      ((raw.data.api_mst_ship ?? []) as any[])
        .map((ship) => Number(ship.api_id))
        .filter((id) => Number.isInteger(id) && id > 0),
    )
    shipFormMasterTs = raw.ts
  }
  return shipFormIds.has(mstId)
}

/**
 * 玩家翻图鉴时把衣装归属学下来，并让正开着的图鉴页跟上。
 *
 * **不发任何请求**：只解析游戏自己返回的那一份报文。
 */
const learnCostumesFrom = (apiData: unknown): number => {
  const learned = rememberPictureBookCostumes(apiData, isShipMstId)
  if (learned) broadcaster.emit('kancolle.shipcostume.learn', shipCostumes())
  return learned
}

/**
 * 启动后的一次性回灌：账本里躺着玩家过去翻图鉴留下的那些报文。
 *
 * 不回灌的话，这张表只对「本次会话里又翻了一遍图鉴」的舰有效——而衣装归属
 * 一旦学到就长期有效，没道理让玩家为了看到已经入档的衣装再去游戏里翻一次。
 * 扫过的用游标记住（见 ship-costume-store），下次启动只扫新的。
 *
 * 挪出启动那一拍（`setTimeout`）：几十份几万字的报文解析没必要跟窗口创建抢时间。
 */
const backfillShipCostumes = () => {
  try {
    // 主数据没到位时 `isShipMstId` 恒 false，这一轮一条都分不出来——**连扫都不扫**，
    // 更不能推游标（推了这段报文就永远不会再被扫）。判据落在主数据本身，
    // 不拿「学到 0 条」倒推（那是拿被验证系统自己的输出当判据）。
    if (!((ensureMasterRaw()?.data?.api_mst_ship ?? []) as any[]).length) return
    const rows = ledger.queryPictureBookBodies(shipCostumeBackfillCursor())
    if (!rows.length) return
    let learned = 0
    let lastId = 0
    for (const row of rows) {
      lastId = row.id
      let parsed: unknown
      try {
        parsed = JSON.parse(row.body)
      } catch (_e) {
        continue // 这一条报文坏了，跳过它继续——游标照样往前推
      }
      learned += rememberPictureBookCostumes((parsed as any)?.api_data ?? parsed, isShipMstId)
    }
    noteShipCostumeBackfill(lastId)
    if (learned) {
      console.log(`[kanso] mg: 衣装归属回灌 ${learned} 条（扫到 events #${lastId}）`)
      broadcaster.emit('kancolle.shipcostume.learn', shipCostumes())
    }
  } catch (error) {
    // 回灌失败只是历史归属没补上，实时那一路照旧；绝不让它拦住启动
    console.warn('[kanso] mg: 衣装归属回灌失败', error)
  }
}
setTimeout(backfillShipCostumes, 3_000).unref?.()

// mstId → 开发表（砲戦/水雷/空母/潜水系）。按主数据时效戳缓存 stype 索引。
let devStypeByMst: Map<number, number> | null = null
let devStypeMasterTs = 0
const secretaryDevTypeOf = (mstId: number): string | null => {
  const raw = ensureMasterRaw()
  if (!raw?.data) return null
  if (!devStypeByMst || devStypeMasterTs !== raw.ts) {
    devStypeByMst = new Map(
      ((raw.data.api_mst_ship ?? []) as any[]).map((s) => [
        Number(s.api_id),
        Number(s.api_stype) || 0,
      ]),
    )
    devStypeMasterTs = raw.ts
  }
  return devSecretaryTypeOf(devStypeByMst.get(mstId) ?? 0)
}

broadcaster.addListener(
  'network.on.response',
  (method: string, [, apiPath]: ApiRequestInfo, body: string, postBody: string, ts: number) => {
    if (!apiPath?.startsWith('/kcsapi')) return
    // 主进程既跑记账归约也代理游戏流量：这里慢一拍，游戏加载就顿一拍。
    // 超阈值按 API 路径记 perf.log（解析/记账/归约分段计时）。
    const startedAt = performance.now()
    let parsed: any
    let post: Record<string, string> = {}
    try {
      parsed = JSON.parse(body)
      post = JSON.parse(postBody || '{}')
    } catch (_e) {
      return
    }
    // api_result !== 1 的异常响应不入状态（锚已在广播前门控大多数情况）
    if (parsed?.api_result !== undefined && parsed.api_result !== 1) return
    // 开发方向由当刻秘书舰决定，响应体里没有这一项，只能记账时补。
    // reducer 还没跑，此刻读到的正是开发那一瞬的第一舰队旗舰。
    let secretaryMst: number | null = null
    if (apiPath === '/kcsapi/api_req_kousyou/createitem') {
      const player = store.getState().player
      const flagInst = player.decks?.[0]?.ships?.[0]
      secretaryMst = (flagInst && flagInst > 0 && player.ships[flagInst]?.shipId) || null
    }
    const parsedAt = performance.now()
    ledger.record(method, apiPath, body, postBody, ts, secretaryMst)
    const recordedAt = performance.now()
    const apiData = parsed?.api_data ?? parsed
    if (apiPath === '/kcsapi/api_start2/getData') {
      masterRawCache = { ts, data: apiData }
    }
    handleEvent(apiPath, apiData, post, ts)
    const total = performance.now() - startedAt
    if (total >= 100) {
      appendPerf(
        'main',
        'network-event',
        `${apiPath} 处理 ${total.toFixed(0)}ms（解析 ${(parsedAt - startedAt).toFixed(0)} · 记账 ${(recordedAt - parsedAt).toFixed(0)} · 归约 ${(performance.now() - recordedAt).toFixed(0)}，报文 ${(body.length / 1024).toFixed(0)}KB）`,
      )
    }
  },
)
// (曾在这里跟踪「工厂界面开没开」给建造坞剧透浮层用——进厂有必发请求
// preset_dev_items,但工厂**内部**子页切换零请求,浮层会挡在开发/解体界面上。
// 2026-08-12 用户拍板撤掉浮层,剧透显示收进顶栏建造坞预览卡,故本文件不跟踪工厂界面状态。)

// 鉴按需拉取全量主数据（不塞进 mg:patch，避免状态广播膨胀）。带时效戳。
ipcMain.handle('mg:master-raw', () => ensureMasterRaw())

// 渲染层初始状态拉取
ipcMain.handle('mg:get-state', () => store.getState())
ipcMain.handle('mg:voice-unmatched', (_event, input: unknown) => {
  if (input && typeof input === 'object') {
    recordVoiceUnmatched(input as Parameters<typeof recordVoiceUnmatched>[0])
  }
})
// 台账的三态计数（钥那一格用）：路径认不出 / 归属可解但无译文 / 目录认得但没这条
ipcMain.handle('mg:voice-unmatched-stats', () => voiceUnmatchedStats())
// 深海开幕语音的亲历台账：图鉴据此给「玩家自己遇到过」的那几条播放钮
ipcMain.handle('mg:abyss-voice-sightings', () => queryAbyssVoiceSightings())
// 耳测考古的收录口：调试门里逐条试听、听响了由提督点下来的那一条。
// **不发任何请求**——试听走的是渲染层既有的音轨出口，这里只管落账。
// 归属由档名结构自证（落盘层拿真主数据再判一次），拒收时返回 null。
ipcMain.handle('mg:abyss-voice-record', (_event, input: unknown) =>
  input && typeof input === 'object'
    ? recordAbyssVoiceArchaeology(input as { mstId?: unknown; voiceId?: unknown }, isAbyssFormMstId)
    : null,
)

// 「听过即存」的收货口：游戏页从 Chromium 缓存里读出来的语音字节。
//
// 这个 channel 对（不可信的）游戏页面上任何脚本都可达，所以两样都不裸信：
// 路径的形状由 voice-archive 那边的白名单正则再判一次，字节由它的大小上限拦一次。
// 最坏情况是页面往档案里塞了一段自己的音频——它塞不进别的目录（路径正则钉死
// /kcs/sound/ 且文件名由主进程按内容指纹另起），也塞不满盘（500 MB 上限 + 淘汰）。
ipcMain.on('kanso:voice-archive-blob', (event, input: unknown) => {
  if (!isGameWebContents(event.sender.id)) return
  if (!input || typeof input !== 'object') return
  const payload = input as { pathname?: unknown; url?: unknown; bytes?: unknown }
  const bytes = payload.bytes
  if (!(bytes instanceof Uint8Array)) return
  const kept = keepVoiceBlob({
    pathname: `${payload.pathname ?? ''}`,
    // 版本参数从 URL 里取（页面给的 url 同样不裸信，只走这一个提取器）：
    // 它是季节差分的身份，也是缓存键的一部分
    version: resourceVersionOf(`${payload.url ?? ''}`),
    bytes,
  })
  // 整条广播出去（含内容指纹）：界面据此当场点亮**并且**当场能播，
  // 不必等下次整表拉取才对得上实物文件名。
  if (kept) broadcaster.emit('kancolle.voice.archived', kept)
})

// 档案占用与清空：钥那一格用
ipcMain.handle('mg:voice-archive-stats', () => voiceArchiveStats())
ipcMain.handle('mg:voice-archive-clear', () => clearVoiceArchive())
ipcMain.handle('mg:voice-archive-entries', () => voiceArchiveEntries())

// 「见过即存」的立绘收货口。与语音那一个同样的口径：
// 这个 channel 对（不可信的）游戏页面上任何脚本都可达，所以三样都不裸信——
// 路径形状由 art-archive 的白名单正则再判一次，字节由它的大小上限与 PNG 魔数
// 各拦一次。最坏情况是页面往档案里塞了一张自己的 PNG：它塞不进别的目录
//（路径正则钉死 /kcs2/resources/ship/ 且文件名由主进程按内容指纹另起），
// 也塞不满盘（2 GB 上限 + 淘汰）。
ipcMain.on('kanso:art-archive-blob', (event, input: unknown) => {
  if (!isGameWebContents(event.sender.id)) return
  if (!input || typeof input !== 'object') return
  const payload = input as { pathname?: unknown; url?: unknown; bytes?: unknown }
  const bytes = payload.bytes
  if (!(bytes instanceof Uint8Array)) return
  const kept = keepArtBlob({
    pathname: `${payload.pathname ?? ''}`,
    version: resourceVersionOf(`${payload.url ?? ''}`),
    bytes,
  })
  // 整条广播出去（含内容指纹）：界面据此当场点亮**并且**当场看得见，
  // 不必等下次整表拉取才对得上实物文件名。
  if (kept) broadcaster.emit('kancolle.shipart.archived', kept)
})

// ---- 「显示/播放即入档」：艦素自己摆出来/播出去的那一份也进档案 ----
//
// 用户 2026-08-23 实机报的那处脱节：整张立绘好端端显示着，收集格却写「0/6 图种」。
// 根因是两本账——显示走缓存+回退，点亮认档案，而档案此前只收游戏页面那条钩子。
// 补法与判据写在 main/archive-capture 的文件头（含三类网络边界）。
//
// ⚠️ 这两个 channel 的发起方是**艦素自己的渲染层**，不是游戏页——所以这里
// 不能套 `isGameWebContents`（那会把自家的调用全挡掉）。形状仍旧不裸信：
// 路径正则与字节上限在 archive-capture 与两个 archive 模块里各判一次。
ipcMain.on('kanso:archive-capture-art', (_event, input: unknown) => {
  if (!input || typeof input !== 'object') return
  const payload = input as { pathname?: unknown; url?: unknown; version?: unknown }
  void captureDisplayedArt(payload.pathname, payload.url, payload.version).then((kept) => {
    // 与游戏页那条路同样整条广播出去：界面据此**当场**点亮，
    // 不必等下次整表拉取——「看见了」与「点亮了」中间不该隔一次重启。
    if (kept) broadcaster.emit('kancolle.shipart.archived', kept)
  })
})

ipcMain.on('kanso:archive-capture-voice', (_event, input: unknown) => {
  if (!input || typeof input !== 'object') return
  const payload = input as { pathname?: unknown; url?: unknown }
  void captureDisplayedVoice(payload.pathname, payload.url).then((kept) => {
    if (kept) broadcaster.emit('kancolle.voice.archived', kept)
  })
})

// ---- 「音频先行骨架」的探测口：**一次点击一格**，永不批量 ----
//
// 玩家点了台词卷里某个没有文字的占位行，才走到这里取那一条。
// 判据、边界与「与文本背书家法的关系」写在 shared/voice-probe-plan 的文件头。
// ⚠️ 这个通道**没有批量入口，也不许加**——打开一页扫 53 个槽等于把一次浏览
// 变成对游戏服务器的 53 连发，整个域的前提就是玩家逐个点。
ipcMain.handle('mg:voice-probe', async (_event, input: unknown) => {
  if (!input || typeof input !== 'object') return { verdict: 'error' }
  const payload = input as { pathname?: unknown; url?: unknown; recheck?: unknown }
  // `recheck` = 玩家点的是那个已知无配音的格子。它只让「已知没有」那道短路让路，
  // 钥开关、路径判据、超时那几道一律照旧（判据在 shared/voice-probe-plan）。
  const result = await probeVoiceSlot(payload.pathname, payload.url, payload.recheck === true)
  // 取到了就整条广播出去：那一格当场点亮并且当场能播（与显示即入档同一条路）
  if (result.verdict === 'kept' && result.entry) {
    broadcaster.emit('kancolle.voice.archived', result.entry)
  }
  // `sha1` 是**这一次取回来的字节**的指纹。舰娘页季节台词行上的「取现值」靠它如实回答「跟档案里已有的
  // 是不是同一份」——拿 `entry` 是不是空来推那件事，会把写盘失败误报成「本季没换季节版」。
  // `absentAt` 是「问的是哪一天」：那一格的悬停写它，重探再 404 时它换成今天。
  return {
    verdict: result.verdict,
    entry: result.entry,
    sha1: result.sha1,
    absentAt: result.absentAt,
  }
})

/**
 * 渲染层启动时取一次：哪几格已知官方没有语音、分别是哪一天问的。
 * 钥里那张「按月分组」的表读的也是这一份（分组判据在 shared，渲染层只消费）。
 */
ipcMain.handle('mg:voice-absent', () => voiceAbsentEntries())

/**
 * 台账清理。**只有玩家在钥里按下才走到这里**，没有任何自动调用方——
 * 2026-08-23 用户拍板把自动过期整个退役，清理权从此归他（理由在
 * shared/voice-probe-plan 的「90 天自动过期退役」那一段）。
 *
 * 月份形状在这里先判一次：`YYYY-MM` 或 `null`（= 全部）。别的一律当没说，
 * 一条都不删——「点了清理结果清掉别的月」比「点了没反应」糟得多。
 */
ipcMain.handle('mg:voice-absent-clear', (_event, input: unknown) => {
  const raw = (input as { month?: unknown } | null)?.month
  if (raw == null) return clearVoiceAbsent(null)
  const month = `${raw}`
  if (!/^\d{4}-\d{2}$/.test(month)) return voiceAbsentEntries().length
  return clearVoiceAbsent(month)
})

// 「响过即存」的 BGM 收货口。与语音/立绘同样的口径：这个 channel 对（不可信的）
// 游戏页面上任何脚本都可达，所以路径形状由 bgm-archive 的白名单正则再判一次，
// 字节由它的大小上限拦一次。最坏情况是页面往档案里塞了一段自己的 mp3：
// 它塞不进别的目录（路径正则钉死 /kcs2/resources/bgm/ 且文件名由主进程按内容
// 指纹另起），也塞不满盘（单条 8 MB 上限 + 玩家可设的总量上限与淘汰）。
ipcMain.on('kanso:bgm-archive-blob', (event, input: unknown) => {
  if (!isGameWebContents(event.sender.id)) return
  if (!input || typeof input !== 'object') return
  const payload = input as { pathname?: unknown; url?: unknown; bytes?: unknown }
  const bytes = payload.bytes
  if (!(bytes instanceof Uint8Array)) return
  const kept = keepBgmBlob({
    pathname: `${payload.pathname ?? ''}`,
    version: resourceVersionOf(`${payload.url ?? ''}`),
    bytes,
  })
  // 整条广播出去（含内容指纹）：海域卷的 ♪ 据此当场改走档案实物，
  // 不必等下次整表拉取才对得上实物文件名。
  if (kept) broadcaster.emit('kancolle.bgm.archived', kept)
})

ipcMain.handle('mg:bgm-archive-stats', () => bgmArchiveStats())
ipcMain.handle('mg:bgm-archive-clear', () => clearBgmArchive())
ipcMain.handle('mg:bgm-archive-entries', () => bgmArchiveEntries())

ipcMain.handle('mg:art-archive-stats', () => artArchiveStats())
ipcMain.handle('mg:art-archive-clear', () => clearArtArchive())
ipcMain.handle('mg:art-archive-entries', () => {
  // 顺路启动一次「吸收」：把 Chromium 缓存里已经有的立绘搬进档案。
  // 挂在这里是因为它要三样东西，而这里正好都齐：学到的真实路径、主数据里的
  // 版本号、以及「渲染层已经起来了」这个时机。函数自身幂等，一次运行只跑一遍。
  try {
    const graph = (ensureMasterRaw()?.data?.api_mst_shipgraph ?? []) as any[]
    const versionOf = new Map<number, string>()
    for (const row of graph) {
      const id = Number(row?.api_id)
      const version = Array.isArray(row?.api_version) ? row.api_version[0] : null
      if (id > 0 && version != null && `${version}`) versionOf.set(id, `${version}`)
    }
    primeArtArchiveFromCache(shipArtPaths(), (mstId) => versionOf.get(mstId) ?? null)
  } catch (error) {
    // 吸收是补历史，失败只是少补几张；绝不能因此让档案索引拉不到
    console.warn('[kanso] 立绘档案吸收启动失败', error)
  }
  return artArchiveEntries()
})

// 资源历史（锱的曲线数据源）
ipcMain.handle('mg:material-history', (_event, sinceTs: number) =>
  ledger.queryMaterials(typeof sinceTs === 'number' ? sinceTs : Date.now() - 7 * 24 * 3600 * 1000),
)

// 逐日资源快照（史的「每日资源」曲线）：每个本地自然日只回当天最后一条。
// 史本来就按自然日聚合，一年 366 个点；整年 21 万行搬回渲染层只是把主进程堵住
// （DatabaseSync 是同步调用）。sinceTs 传 0 = 从账本最早一条起（「全部」档）。
// untilTs 由渲染层给（它的曲线最后一格截在那一刻），不在这里取 Date.now()：
// 取数那一刻与画格子那一刻必须是同一个数，否则这中间进的行谁也算不进去。
ipcMain.handle('mg:material-daily', (_event, sinceTs: unknown, untilTs: unknown) =>
  ledger.queryDailyMaterials(
    typeof sinceTs === 'number' && Number.isFinite(sinceTs) && sinceTs > 0 ? Math.floor(sinceTs) : 0,
    typeof untilTs === 'number' && Number.isFinite(untilTs) && untilTs > 0
      ? Math.floor(untilTs)
      : Date.now(),
  ),
)

// 资源窗口首尾两行（铎的活动期净变化）：只要两头就别拉整段曲线
ipcMain.handle('mg:material-window', (_event, sinceTs: number) =>
  ledger.queryMaterialWindow(
    typeof sinceTs === 'number' ? sinceTs : Date.now() - 7 * 24 * 3600 * 1000,
  ),
)

// 通知历史（铃）：写入由渲染端按规则合成后送来，主进程只负责落盘与滚动。
// 会话号由渲染端启动时取一次，用来区分「本次开机产生的」和「上次留下的」。
ipcMain.handle('mg:notify-append', (_event, input: unknown) => {
  const n = (input ?? {}) as Record<string, unknown>
  if (typeof n.event !== 'string' || typeof n.title !== 'string') return null
  return ledger.appendNotice({
    ts: typeof n.ts === 'number' ? Math.floor(n.ts) : Date.now(),
    session: typeof n.session === 'number' ? Math.floor(n.session) : 0,
    event: n.event,
    title: n.title,
    detail: typeof n.detail === 'string' ? n.detail : '',
    ref: typeof n.ref === 'string' ? n.ref : null,
    read: n.read === true,
  })
})

ipcMain.handle('mg:notify-recent', (_event, limit?: unknown) =>
  ledger.recentNotices(typeof limit === 'number' ? limit : 400),
)

ipcMain.handle('mg:notify-read', (_event, ids: unknown) =>
  ledger.markNoticesRead(
    ids === 'all' ? 'all' : Array.isArray(ids) ? ids.filter((id): id is number => typeof id === 'number') : [],
  ),
)

ipcMain.handle('mg:notify-clear', () => ledger.clearNotices())

// ---- 记录保留与清理（钥）----
//
// 2026-08-23 用户拍板把日期自动清理整个退役（判据与理由在 shared/ledger-retention）。
// 这两个口是它的另一半：如实报出账本里都有哪几个月、占多大，以及**由他按下**的清理。
// ⚠️ 清理范围钉死在那四张滚动表（计划由 shared 给，永久表不可能出现在里面）。
ipcMain.handle('mg:ledger-retention', () => ledger.ledgerRetentionReport())

ipcMain.handle('mg:ledger-clear-month', (_event, input: unknown) => {
  const month = `${(input as { month?: unknown } | null)?.month ?? ''}`
  // 形状不对就一行都不删（shared 那边也会再判一次，这里先挡住明显的乱值）
  if (!/^\d{4}-\d{2}$/.test(month)) return 0
  return ledger.clearLedgerMonth(month)
})

// 道具履历（05 稿）：某道具的持有数变化时间线
ipcMain.handle('mg:useitem-history', (_event, itemId: number, limit?: number) =>
  ledger.queryUseitemHistory(itemId | 0, limit ?? 60),
)

ipcMain.handle('mg:useitem-changes', (_event, limit?: number) =>
  ledger.queryRecentUseitemChanges(typeof limit === 'number' ? limit : 200),
)

// 本机氪金记录（永久表）。补记入口只收 manual 一种；时刻限定在合理范围，
// 名称/数量在主进程再验一遍——渲染层的表单不是信任边界。
ipcMain.handle('mg:pay-log', () => ledger.queryPayLog())

ipcMain.handle('mg:pay-log-add', (_event, input: unknown) => {
  const raw = input as any
  const ts = Number(raw?.ts)
  const itemId = Number(raw?.itemId)
  const count = Number(raw?.count)
  const price = raw?.price == null ? null : Number(raw.price)
  const name = `${raw?.name ?? ''}`.trim().slice(0, 60)
  if (!Number.isFinite(ts) || ts < Date.UTC(2013, 0, 1) || ts > Date.now() + 86400_000) return null
  if (!Number.isInteger(itemId) || itemId <= 0) return null
  if (!Number.isInteger(count) || count <= 0 || count > 99) return null
  if (price !== null && (!Number.isInteger(price) || price < 0 || price > 100000)) return null
  if (!name) return null
  return ledger.recordPayLog({ ts, kind: 'manual', itemId, name, count, price, detail: null })
})

ipcMain.handle('mg:pay-log-remove', (_event, id: unknown) =>
  typeof id === 'number' && Number.isInteger(id) ? ledger.removeManualPayLog(id) : false,
)

// 道具履历的「变动原因」：变动时刻附近做过什么操作（归因是推断，不是记录）
// 时刻是毫秒（~1.7e12），绝不能用 | 0 截断成 int32
ipcMain.handle('mg:action-events', (_event, fromTs: unknown, toTs: unknown) => ({
  events:
    typeof fromTs === 'number' && typeof toTs === 'number'
      ? ledger.queryActionEvents(Math.floor(fromTs), Math.floor(toTs))
      : [],
  earliest: ledger.earliestEventTs(),
}))

// 道具收支合计（锱的战略道具卡）：一次拿回全部道具的近期增减
ipcMain.handle('mg:useitem-summary', (_event, sinceTs: number) =>
  ledger.queryUseitemSummary(
    typeof sinceTs === 'number' ? sinceTs : Date.now() - 30 * 24 * 3600 * 1000,
  ),
)

// 收支分类汇总（锱的收支分解数据源）
ipcMain.handle('mg:material-deltas', (_event, sinceTs: number) =>
  ledger.queryDeltaSummary(
    typeof sinceTs === 'number' ? sinceTs : Date.now() - 7 * 24 * 3600 * 1000,
  ),
)

// 装备加成的「你的实测」：读一件装备的全部历史观察（含已经卸下/升过星的那些）
ipcMain.handle('mg:fit-observations', (_event, equipMstId: unknown) =>
  typeof equipMstId === 'number' && Number.isInteger(equipMstId) && equipMstId > 0
    ? ledger.queryFitObservations(equipMstId)
    : [],
)

// 写入走单向 send：渲染层是在装备卷渲染时顺手落盘的，不能让它等一次 IPC 往返。
// 逐行校验在 ledger.recordFitObservations 里（账不接受说不出来源的数）。
ipcMain.on('mg:fit-observation-record', (_event, rows: unknown) => {
  if (!Array.isArray(rows) || !rows.length || rows.length > 200) return
  ledger.recordFitObservations(rows as FitObservationRecord[])
})

ipcMain.handle('mg:factory-stats', (_event, sinceTs: number) =>
  ledger.queryFactoryStats(
    typeof sinceTs === 'number' ? sinceTs : Date.now() - 90 * 24 * 3600 * 1000,
    secretaryDevTypeOf,
  ),
)

// 舰种表递进去，账本才能从快照还原「当场有没有练巡」并把演习样本归一成无练巡基线
ipcMain.handle('mg:exp-samples', () =>
  ledger.queryExpSamples((mstId) => store.getState().master.ships[mstId]?.stype ?? null),
)

ipcMain.handle('mg:senka', (_event, at?: number) => {
  const when = typeof at === 'number' ? at : Date.now()
  // EO 自动对账（2026-08-17 用户提议）：查账前先按本月海域页观测补齐漏记的
  // EO——重置点后观测到 cleared=1 必属本月，去重与实时路径共用账本同月同图闸
  const booked = ledger.autoBookEoFromMapinfo(when)
  if (booked.length) console.log(`[kanso] mg: senka 自动补记 EO ${booked.join(',')}`)
  // 任务侧同款（2026-09-01 重立）：只按账本里存着的 clearitemget 报文补，
  // 入账时刻取报文观测时刻。资料包没装就整段跳过——跳过是「这次没补」，
  // 而按不全的资料去解会把「解不出分值」记成「不是战果任务」，游标一过就永远补不回来。
  if (getLode('quests-scn')) {
    const quests = ledger.autoBookQuestSenkaFromEvents(when, questSenkaInfo)
    if (quests.length) console.log(`[kanso] mg: senka 自动补记任务 ${quests.join(',')}`)
  }
  const summary = ledger.querySenka(when)
  // 实际校准：renderer 经 uiSet 写进 config（ui.senka.calibration），这里组装。
  // 只认本战果月内的校准——过月后继承重算，旧校准自动失效。
  const saved = config.get('ui.senka.calibration', null) as { value?: number; ts?: number } | null
  if (
    saved &&
    typeof saved.value === 'number' &&
    typeof saved.ts === 'number' &&
    saved.ts >= summary.monthStart
  ) {
    const gained = ledger.sumSenkaBetween(saved.ts, senkaMonthEnd(when))
    summary.calibration = {
      value: saved.value,
      ts: saved.ts,
      gainedSince: gained,
      current: saved.value + gained,
    }
  }
  return summary
})
// 「渲染层递一个任务号进来、主进程就给它记一笔」的入口（mg:senka-log-quest）
// 2026-09-01 整个退役：那条路的触发端是渲染层的**推断**（前置满足 + 不在任务表
// = 已交付），推断在月初重置那一刻必然失真，于是「从没做过的任务」也被记进账。
// 现在任务战果只有一个写入口——账本里存着的 clearitemget 报文，实时一条路
// （上面的 onApi）、补记一条路（mg:senka 里的 autoBookQuestSenkaFromEvents），
// 两条走的是同一个 logQuestSenka。渲染层根本不再有写账的手，也就无所谓「判据坏了」。

// 重算任务战果：撤回本战果月自动补记的任务行（合成行，允许删的理由见
// ledger.clearAutoBookedQuestSenka），返回撤回笔数。撤回之后渲染层会重查一次账，
// mg:senka 顺手按报文证据重扫——有 clearitemget 的自己回来（且落在真实时刻），
// 靠推断混进来的回不来。
ipcMain.handle('mg:senka-clear-quest', () =>
  ledger.clearAutoBookedQuestSenka(senkaMonthStart(Date.now())),
)

/**
 * 手动补记的候选清单：任务资料库里带固定战果的那几条（现役 9 条，全是季常/年常）。
 * 分值与周期口径仍旧从主进程自己的 quests-scn 现解，与实时入账同一份。
 */
const senkaQuestCatalog = (): { id: number; code: string; name: string }[] => {
  const data = getLode('quests-scn')?.data as Record<string, any> | undefined
  if (!data) return []
  const out: { id: number; code: string; name: string }[] = []
  for (const [key, entry] of Object.entries(data)) {
    const id = parseInt(key, 10)
    if (!(id > 0) || !entry) continue
    if (!questSenkaInfo(id)) continue
    out.push({ id, code: `${entry.code ?? ''}`, name: `${entry.name ?? ''}` })
  }
  // 编码按「字母段 + 数字段」排，不能整串比字符串——Bq10 会排到 Bq2 前面
  const parts = (code: string) => {
    const match = code.match(/^([^0-9]*)(\d*)/)
    return { head: match?.[1] ?? code, num: Number(match?.[2] ?? '') || 0 }
  }
  return out.sort((left, right) => {
    const a = parts(left.code)
    const b = parts(right.code)
    return a.head.localeCompare(b.head) || a.num - b.num || left.id - right.id
  })
}

// 补记选单。taken 与 addManualQuestSenka 走同一个去重窗口，选单里标成已记的
// 按下去也必然被挡——两处各判一次迟早会说不到一块去。
ipcMain.handle('mg:senka-quest-options', (): SenkaQuestOption[] => {
  const catalog = senkaQuestCatalog()
  if (!catalog.length) return []
  const infos = catalog.map((row) => ({ ...row, info: questSenkaInfo(row.id)! }))
  const taken = ledger.questSenkaTaken(
    Date.now(),
    infos.map(({ id, info }) => ({ id, kind: info.kind, annualMonth: info.annualMonth })),
  )
  return infos.map(({ id, code, name, info }) => ({
    id,
    code,
    name,
    senka: info.senka,
    periodKind: info.kind,
    taken: taken[id] ?? null,
  }))
})

// 手动补记一笔任务战果。**渲染层只递任务号**——分值一律现解（f3543a3 撤掉的
// 那条「渲染层递数字进来、账本照写」的通道不再开第二次）。
ipcMain.handle('mg:senka-add-quest', (_event, questId: unknown) => {
  const id = Number(questId)
  if (!Number.isInteger(id) || id <= 0) return 'no-senka'
  const info = questSenkaInfo(id)
  if (!info) return 'no-senka'
  return ledger.addManualQuestSenka(Date.now(), id, info.senka, info)
})

// 删一条手动补记行。观测记下的那些行这里删不掉（账本里 kind/manual 两道门都要过）。
ipcMain.handle('mg:senka-remove-quest', (_event, id: unknown) =>
  typeof id === 'number' && Number.isInteger(id) ? ledger.removeManualQuestSenka(id) : false,
)

ipcMain.handle('mg:expedition-history', (_event, missionId: number, limit?: number) =>
  ledger.queryExpeditionHistory(missionId | 0, limit ?? 30),
)

// 在籍舰人生记录：实例级永久履历，首次同步只建基线，之后按确认事件增量记录。
ipcMain.handle('mg:ship-life', (_event, rosterId: number, limit?: number) =>
  ledger.queryShipLife(rosterId | 0, limit ?? 80),
)
ipcMain.handle('mg:ship-memorial', (_event, mstIds: number[]) =>
  ledger.queryShipMemorial(Array.isArray(mstIds) ? mstIds : []),
)
// 她的 boss 击杀簿：终结过敌旗舰的那几场。归属写在 battle 事件的 detail.bossKill 上，
// 不是单独的表（判据见 shared/boss-kill）。
ipcMain.handle('mg:ship-boss-kills', (_event, rosterId: number, limit?: number) =>
  ledger.queryBossKills(rosterId | 0, limit ?? 200),
)

// 启动回放：所有“完整/局部舰队快照”按真实时间灌回。
// ship3 常在改造后晚于 port；漏掉它会把舰娘恢复成旧形态，并污染人生记录。
export const rehydrate = () => {
  const apiOrder = [
    '/kcsapi/api_start2/getData',
    '/kcsapi/api_get_member/require_info',
    '/kcsapi/api_port/port',
    '/kcsapi/api_get_member/ship3',
  ]
  const replay: { ts: number; order: number; run: () => void }[] = []
  let slotitemBaselineTs = 0
  for (const [order, apiPath] of apiOrder.entries()) {
    const snapshot = ledger.loadSnapshot(apiPath)
    if (snapshot) {
      if (apiPath === '/kcsapi/api_get_member/require_info') {
        slotitemBaselineTs = Math.max(slotitemBaselineTs, snapshot.ts)
      }
      replay.push({
        ts: snapshot.ts,
        order,
        run: () => {
          const data = (snapshot.body as any)?.api_data ?? snapshot.body
          store.handle(apiPath, data, {}, snapshot.ts)
        },
      })
    }
  }
  // 领域状态（任务/道具/海域进度/演习/上次出击复盘）：游戏只在打开对应界面时才下发，
  // 不回灌的话每次重启都得再去点一遍才有数据。它与 require_info/start2 有重叠字段，
  // 必须按各自时间戳回放，不能固定让其中一份无条件覆盖另一份。
  const domain = ledger.loadDomainState('domain')
  if (domain) {
    if (domain.data?.slotitems && typeof domain.data.slotitems === 'object') {
      slotitemBaselineTs = Math.max(slotitemBaselineTs, domain.ts)
    }
    replay.push({
      ts: domain.ts,
      order: apiOrder.length,
      run: () => store.hydrateDomain(domain.data),
    })
  }
  // require_info 之外，游戏也可能单独下发完整装备表。以时间最新的完整表为基线，
  // 再只回放其后的增删事件；这样旧版本漏记的废弃也能在升级后自动纠正。
  const slotitemList = ledger.loadLatestSlotitemList()
  if (slotitemList) {
    slotitemBaselineTs = Math.max(slotitemBaselineTs, slotitemList.ts)
    replay.push({
      ts: slotitemList.ts,
      order: apiOrder.length + 1,
      run: () =>
        store.handle(
          '/kcsapi/api_get_member/slot_item',
          slotitemList.body,
          {},
          slotitemList.ts,
        ),
    })
  }
  const slotitemMutations = ledger.loadSlotitemMutationsSince(slotitemBaselineTs)
  slotitemMutations.forEach((event, index) => {
    replay.push({
      ts: event.ts,
      order: apiOrder.length + 2 + index,
      run: () => {
        applySlotitemInventoryMutation(
          store.getState().player.slotitems,
          event.path,
          event.body,
          event.post,
        )
      },
    })
  })
  replay.sort((a, b) => a.ts - b.ts || a.order - b.order).forEach((entry) => entry.run())
  const latestQuestList = ledger.loadLatestAuthoritativeQuestList()
  let recoveredQuestList = false
  if (
    latestQuestList &&
    latestQuestList.ts >= (store.getState().player.questsTs ?? 0)
  ) {
    store.handle(
      '/kcsapi/api_get_member/questlist',
      latestQuestList.body,
      latestQuestList.post,
      latestQuestList.ts,
    )
    recoveredQuestList = true
  }
  if (
    recoveredQuestList ||
    slotitemMutations.length > 0 ||
    (slotitemList && (!domain?.data?.slotitems || slotitemList.ts > domain.ts))
  ) {
    ledger.saveDomainState('domain', store.domainSnapshot())
  }
  if (domain) {
    console.log(`[kanso] mg: domain state restored (${new Date(domain.ts).toLocaleString()})`)
  }
  reconcileQuestProgress()
  primeShipLife(store.getState().player.lastPortTs ?? Date.now())
  console.log('[kanso] mg: rehydrated from snapshots')
}

rehydrate()
