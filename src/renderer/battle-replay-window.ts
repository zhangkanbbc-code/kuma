import { installThemeBoot } from './theme-boot'

installThemeBoot()

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
import { installAssetDisplayCapture, setAllowRemoteArt, setGameHost, setShipImageGraph } from './kcs-image'
import { loadAssetArchive } from './asset-archive'
import {
  battleReplayPlaceText,
  bootstrapBattleReplay,
  handleBattleReplayDetailClick,
  renderBattleReplayDetail,
} from './modules/di'

import { mountBattleAnim, type BattleAnimHost } from './battle-anim/player'
import { parseBattleReplayRequest, type BattleReplayView } from '../shared/battle-replay-request'

import type { BattleSnapshot, BattleSnapshotSummary } from '../shared/mg-types'

const { ipcRenderer } = require('electron')
const windowConfig = require('@electron/remote').require('./config')

const root = document.querySelector<HTMLElement>('#battle-replay-root')!
const status = document.querySelector<HTMLElement>('#battle-replay-status')!
const detail = document.querySelector<HTMLElement>('#battle-replay-detail')!
const animHost = document.querySelector<HTMLElement>('#battle-replay-anim')!
const viewsNav = document.querySelector<HTMLElement>('#battle-replay-views')!
const query = new URLSearchParams(location.search)
const initialSnapshotId = Number(query.get('snapshot') ?? 0)

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
// 「详情」是镝的复盘详表，「动画」是兵牌推演（renderer/battle-anim）。新开的窗默认详情，
// 回顾 / 战斗面板的「动画复盘」按钮带 view=animate 直达动画。
let view: BattleReplayView = query.get('view') === 'animate' ? 'animate' : 'detail'
let anim: BattleAnimHost | null = null
let animShownId = 0

const renderCurrent = () => {
  const snapshot = currentSnapshot
  if (!snapshot) return
  status.hidden = true
  viewsNav.hidden = false
  for (const button of viewsNav.querySelectorAll<HTMLElement>('[data-view]')) {
    button.classList.toggle('on', button.dataset.view === view)
  }
  document.title = `战斗复盘 · ${battleReplayPlaceText(snapshot)}`
  if (view === 'animate') {
    detail.hidden = true
    animHost.hidden = false
    anim ??= mountBattleAnim(animHost, { openSnapshot: (id) => void loadSnapshot(id) })
    anim.setActive(true)
    if (animShownId !== snapshot.id) {
      animShownId = snapshot.id
      anim.show(snapshot, trailIndex)
    } else {
      anim.setTrail(trailIndex)
    }
    return
  }
  anim?.setActive(false)
  animHost.hidden = true
  detail.hidden = false
  detail.dataset.snapshotId = `${snapshot.id}`
  renderBattleReplayDetail(detail, snapshot, { trailIndex })
}

viewsNav.addEventListener('click', (event) => {
  const next = (event.target as HTMLElement).closest<HTMLElement>('[data-view]')?.dataset.view
  if ((next !== 'detail' && next !== 'animate') || next === view) return
  view = next
  renderCurrent()
})

const showStatus = (text: string) => {
  status.textContent = text
  status.hidden = false
  status.classList.toggle('empty', currentSnapshot == null)
  if (!currentSnapshot) {
    detail.hidden = true
    animHost.hidden = true
    viewsNav.hidden = true
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
    console.warn('[kuma] 战斗复盘读取失败', id, error)
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
      console.warn('[kuma] 同次出击航迹读取失败', snapshot.sortieId, error)
      showStatus(trailFailedText)
    })
}

// 主进程送来的是快照 id（旧形状）或 { snapshotId, view }；形状见 shared/battle-replay-request
ipcRenderer.on('battle-replay:open', (_event: unknown, raw: unknown) => {
  const request = parseBattleReplayRequest(raw)
  if (!request) return
  if (request.view) view = request.view
  pendingSnapshotId = request.snapshotId
  if (!readyToLoad) return
  if (currentSnapshot?.id === request.snapshotId) renderCurrent()
  else void loadSnapshot(request.snapshotId)
})

detail.addEventListener('click', (event) => {
  if (!currentSnapshot) return
  handleBattleReplayDetailClick(detail, currentSnapshot, event.target as HTMLElement, {
    trailIndex,
    openSnapshot: (id) => void loadSnapshot(id),
  })
})

new ResizeObserver(() => {
  if (view !== 'detail') return
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
  installAssetDisplayCapture()
  await loadAssetArchive()
  const remembered = windowConfig.get('kuma.lastGameHost', '')
  if (typeof remembered === 'string' && /^[\w.-]+$/.test(remembered)) setGameHost(remembered)
  setAllowRemoteArt(windowConfig.get('kuma.remoteArt', true) !== false)
  installEquipIconFallback()
  installEntityArtFallback()
  await initKernel()
  const opencc = await queryLode('opencc-t2s')
  installZhSimplifier(opencc)
  await Promise.all([
    initLocalization().catch((error) => console.warn('[kuma] 译名表读取失败', error)),
    queryMasterRaw()
      .then((raw) => setShipImageGraph(raw?.data?.api_mst_shipgraph ?? []))
      .catch((error) => console.warn('[kuma] 主数据读取失败', error)),
  ])
  bootstrapBattleReplay(renderCurrent)
  readyToLoad = true
  void loadSnapshot(pendingSnapshotId)
  root.dataset.ready = 'true'
}

void start().catch((error) => {
  console.error('[kuma] battle replay window failed', error)
  showStatus(failedText)
})
