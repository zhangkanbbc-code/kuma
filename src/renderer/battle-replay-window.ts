import {
  initKernel,
  initUiZoom,
  queryBattleRun,
  queryBattleSnapshot,
  queryLode,
  queryMasterRaw,
} from './kernel'
import { installEquipIconFallback } from './equip-icon'
import { installEntityArtFallback } from './entity-art'
import { initLocalization } from './localization'
import { installZhSimplifier } from './zh-simplify'
import { setAllowRemoteArt, setGameHost, setShipImageGraph } from './kcs-image'
import {
  battleReplayPlaceText,
  bootstrapBattleReplay,
  handleBattleReplayDetailClick,
  renderBattleReplayDetail,
} from './modules/di'

import type { BattleSnapshot, BattleSnapshotSummary } from '../shared/mg-types'

const { ipcRenderer } = require('electron')
const windowConfig = require('@electron/remote').require('./config')

const root = document.querySelector<HTMLElement>('#battle-replay-root')!
const status = document.querySelector<HTMLElement>('#battle-replay-status')!
const detail = document.querySelector<HTMLElement>('#battle-replay-detail')!
const initialSnapshotId = Number(new URLSearchParams(location.search).get('snapshot') ?? 0)

const missingText = '暂无这一场的复盘记录'
const loadingText = '复盘读取中'
const failedText = '复盘读取失败'
const trailFailedText = '同次出击航迹读取失败'

let currentSnapshot: BattleSnapshot | null = null
let trailIndex: readonly BattleSnapshotSummary[] = []
let battleLoadGeneration = 0
let narrow: boolean | null = null
let readyToLoad = false
let pendingSnapshotId = initialSnapshotId

const renderCurrent = () => {
  const snapshot = currentSnapshot
  if (!snapshot) return
  status.hidden = true
  detail.hidden = false
  detail.dataset.snapshotId = `${snapshot.id}`
  document.title = `战斗复盘 · ${battleReplayPlaceText(snapshot)}`
  renderBattleReplayDetail(detail, snapshot, { trailIndex })
}

const showStatus = (text: string) => {
  status.textContent = text
  status.hidden = false
  status.classList.toggle('empty', currentSnapshot == null)
  if (!currentSnapshot) {
    detail.hidden = true
    document.title = '战斗复盘'
  }
}

const loadSnapshot = async (id: number) => {
  const generation = ++battleLoadGeneration
  if (!currentSnapshot) showStatus(loadingText)
  let snapshot: BattleSnapshot | null
  try {
    snapshot = await queryBattleSnapshot(id)
  } catch (error) {
    if (generation !== battleLoadGeneration) return
    console.warn('[kanso] 战斗复盘读取失败', id, error)
    showStatus(failedText)
    return
  }
  if (generation !== battleLoadGeneration) return
  if (!snapshot) {
    showStatus(missingText)
    return
  }

  currentSnapshot = snapshot
  trailIndex = [snapshot]
  renderCurrent()
  void queryBattleRun(snapshot.sortieId)
    .then((rows) => {
      if (generation !== battleLoadGeneration || currentSnapshot?.id !== snapshot.id) return
      trailIndex = rows
      renderCurrent()
    })
    .catch((error) => {
      if (generation !== battleLoadGeneration) return
      console.warn('[kanso] 同次出击航迹读取失败', snapshot.sortieId, error)
      showStatus(trailFailedText)
    })
}

ipcRenderer.on('battle-replay:open', (_event: unknown, rawId: unknown) => {
  const id = Number(rawId)
  if (!Number.isInteger(id) || id <= 0) return
  pendingSnapshotId = id
  if (readyToLoad) void loadSnapshot(id)
})

detail.addEventListener('click', (event) => {
  if (!currentSnapshot) return
  handleBattleReplayDetailClick(detail, currentSnapshot, event.target as HTMLElement, {
    trailIndex,
    openSnapshot: (id) => void loadSnapshot(id),
  })
})

new ResizeObserver(() => {
  const next = detail.clientWidth < 700
  if (narrow === null) {
    narrow = next
    return
  }
  if (next === narrow) return
  narrow = next
  renderCurrent()
}).observe(detail)

const start = async () => {
  initUiZoom()
  const remembered = windowConfig.get('kanso.lastGameHost', '')
  if (typeof remembered === 'string' && /^[\w.-]+$/.test(remembered)) setGameHost(remembered)
  setAllowRemoteArt(windowConfig.get('kanso.remoteArt', true) !== false)
  installEquipIconFallback()
  installEntityArtFallback()
  await initKernel()
  const opencc = await queryLode('opencc-t2s')
  installZhSimplifier(opencc)
  await Promise.all([
    initLocalization().catch((error) => console.warn('[kanso] 译名表读取失败', error)),
    queryMasterRaw()
      .then((raw) => setShipImageGraph(raw?.data?.api_mst_shipgraph ?? []))
      .catch((error) => console.warn('[kanso] 主数据读取失败', error)),
  ])
  bootstrapBattleReplay(renderCurrent)
  readyToLoad = true
  void loadSnapshot(pendingSnapshotId)
  root.dataset.ready = 'true'
}

void start().catch((error) => {
  console.error('[kanso] battle replay window failed', error)
  showStatus(failedText)
})
