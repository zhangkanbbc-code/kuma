// 锚 (Ma) · 事件流控制台。被动监听到的 /kcsapi 事件实时列表（调试/验收用）。
import { esc, fmtTime, mg, onMgChange, trackMountCleanup } from '../kernel'
import { mapCodeOf } from '../../shared/map-id'
import { registerModule } from '../mu'

const remote = require('@electron/remote')

const broadcaster = remote.require('./game-api-broadcaster')

const MAX_ROWS = 300
let eventCount = 0
let paneEl: HTMLElement | null = null
let log: HTMLElement | null = null
let countBadge: HTMLElement | null = null
let emptyHint: HTMLElement | null = null
let reconcileSummary: HTMLElement | null = null
let reconcileList: HTMLElement | null = null

type ApiRequestInfo = [string | undefined, string | undefined, string]

const DISCREPANCY_LABEL = {
  sunk: '击沉数',
  mvp: 'MVP',
  rank: '战果',
  hp: '耐久',
}

const renderReconciliation = () => {
  if (!reconcileSummary || !reconcileList) return
  const session = mg.battleReconciliation
  reconcileSummary.textContent = `本次会话对账 ${session.checked} 场 · 不一致 ${session.mismatched} 场`
  reconcileList.innerHTML = session.records.length
    ? session.records.map((record) => {
        const at = record.practice
          ? '演习'
          : `${mapCodeOf(record.map)}${record.cell > 0 ? ` · 节点 ${record.cell}` : ''}`
        const items = record.discrepancies.map((item) =>
          `<span><b>${DISCREPANCY_LABEL[item.kind]}</b>${item.who ? ` ${esc(item.who)}` : ''} 本地 ${esc(`${item.ours}`)} · 游戏 ${esc(`${item.game}`)}</span>`,
        ).join('')
        return `<div class="reconcile-row"><time>${fmtTime(record.ts)}</time><strong>${esc(at)}</strong>${items}</div>`
      }).join('')
    : '<div class="reconcile-empty">当前会话暂无本地派生值与游戏返回值差异</div>'
}

const pushRow = (kind: 'req' | 'res' | 'err', pathName: string, ts: number, size?: number) => {
  if (!log || !countBadge || !emptyHint) return
  eventCount += 1
  countBadge.textContent = `${eventCount} 事件`
  emptyHint.style.display = 'none'

  const li = document.createElement('li')
  const sizeText = size != null ? (size > 1024 ? `${(size / 1024).toFixed(1)}k` : `${size}`) : ''
  const path = document.createElement('span')
  path.className = 'ev-path'
  path.title = pathName
  path.textContent = pathName
  li.innerHTML = `<span class="ev-time">${fmtTime(ts)}</span><span class="ev-badge ${kind}">${kind}</span>`
  li.appendChild(path)
  li.insertAdjacentHTML('beforeend', `<span class="ev-size">${sizeText}</span>`)
  // 面板不可见时不做视口补偿：scrollTop / offsetHeight 都会强制同步布局，
  // 而看不见的列表没有视口要钉（隐藏面板 scrollTop 恒 0）。事件风暴下这是
  // 每条报文一次白做的 reflow，且与游戏画面同一根主线程。
  const keepViewport = paneEl?.classList.contains('active') === true && log.scrollTop > 1
  const previousTop = keepViewport ? log.scrollTop : 0
  log.prepend(li)
  const insertedHeight = keepViewport ? li.offsetHeight : 0
  while (log.children.length > MAX_ROWS) {
    log.lastElementChild?.remove()
  }
  // 新事件插在顶部：用户停留在旧记录中时，以新增行高度补偿，视口仍钉在同一条记录。
  if (keepViewport) log.scrollTop = previousTop + insertedHeight
}

registerModule({
  id: 'anchor',
  title: '诊断',
  order: 10,
  mount(pane) {
    paneEl = pane
    pane.innerHTML = `
      <div id="console-head">
        <span id="event-count">0 事件</span>
        <details id="reconcile-audit">
          <summary id="reconcile-summary">本次会话对账 0 场 · 不一致 0 场</summary>
          <div id="reconcile-list"></div>
        </details>
      </div>
      <ul id="event-log"></ul>
      <div id="empty-hint">
        尚未产生游戏请求 · 登录后显示 /kcsapi 同步事件
      </div>`
    log = pane.querySelector('#event-log')
    countBadge = pane.querySelector('#event-count')
    emptyHint = pane.querySelector('#empty-hint')
    reconcileSummary = pane.querySelector('#reconcile-summary')
    reconcileList = pane.querySelector('#reconcile-list')
    renderReconciliation()
    onMgChange((keys) => {
      if (keys.includes('battleReconciliation')) renderReconciliation()
    })

    // 这三条监听住在**主进程**，装配失败重试时不退掉就永远留在那边：
    // 一条报文推两行、eventCount 翻倍，本模块的诊断结论直接是错的。
    // （换新面板元素只能丢掉挂在 pane 上的监听，broadcaster 上的必须显式退。）
    const onApiRequest = (
      _method: string,
      [, pathName]: ApiRequestInfo,
      _body: string,
      ts: number,
    ) => {
      if (pathName?.startsWith('/kcsapi')) pushRow('req', pathName, ts)
    }
    const onApiResponse = (
      _method: string,
      [, pathName]: ApiRequestInfo,
      body: string,
      _post: string,
      ts: number,
    ) => {
      if (pathName?.startsWith('/kcsapi')) pushRow('res', pathName, ts, body?.length)
    }
    const onApiError = ([, pathName, url]: ApiRequestInfo, status?: number) => {
      pushRow('err', `${pathName ?? url} (${status ?? '?'})`, Date.now())
    }
    broadcaster.addListener('network.on.request', onApiRequest)
    broadcaster.addListener('network.on.response', onApiResponse)
    broadcaster.addListener('network.error', onApiError)
    trackMountCleanup(() => {
      broadcaster.removeListener('network.on.request', onApiRequest)
      broadcaster.removeListener('network.on.response', onApiResponse)
      broadcaster.removeListener('network.error', onApiError)
    })
  },
})
