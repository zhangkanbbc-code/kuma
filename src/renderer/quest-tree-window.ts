// 完整任务树独立窗口：只读 quests-scn 与铭的任务状态，不创建游戏 webview。
import {
  esc,
  focusQuestInMainWindow,
  initKernel,
  initUiZoom,
  lodeCredit,
  mg,
  onFilterInput,
  onMgChange,
  queryLode,
  uiGet,
  uiSet,
} from './kernel'
import {
  buildCompleteQuestForest,
  inferCompletedQuestCodes,
  pathCodesToQuest,
} from './quest-chain-tree'
import { mergeQuestPre } from '../shared/quest-pre-merge'
import { QUEST_PRE_ARBITRATION } from '../shared/quest-pre-arbitration'
import { questPreSourceNoteHtml } from './quest-pre-note'

import type {
  CompleteQuestTreeNode,
  QuestChainEntry,
} from './quest-chain-tree'
import type { MergedQuestPre, WwQuestPre } from '../shared/quest-pre-merge'
import type { LodeMeta } from './kernel'

interface FullQuest extends QuestChainEntry {
  desc: string
  memo2: string
  preInfo?: MergedQuestPre
}

type TreeStatus = 'active' | 'claim' | 'available' | 'completed' | 'unknown'

const CATEGORY_META: Record<string, { label: string; color: string }> = {
  A: { label: '编成', color: '#67c98a' },
  B: { label: '出击', color: '#e06c75' },
  C: { label: '演习', color: '#5ab8d8' },
  D: { label: '远征', color: '#8fb8e0' },
  E: { label: '补给·入渠', color: '#c9a86a' },
  F: { label: '工厂', color: '#a08a6a' },
  G: { label: '改装', color: '#b489ff' },
  S: { label: '限时', color: '#e8c66a' },
}

const STATUS_META: Record<TreeStatus, { label: string; color: string }> = {
  active: { label: '进行中', color: 'var(--accent)' },
  claim: { label: '待领奖励', color: 'var(--gold)' },
  available: { label: '尚未领取', color: 'var(--warn)' },
  completed: { label: '已完成', color: 'var(--ok)' },
  unknown: { label: '状态未同步', color: 'var(--dim)' },
}

const root = document.querySelector<HTMLElement>('#quest-tree-root')!
const { ipcRenderer } = require('electron')
let lodeMeta: LodeMeta | null = null
let quests: FullQuest[] = []
let byId = new Map<number, FullQuest>()
let byCode = new Map<string, FullQuest>()
let childrenByCode = new Map<string, FullQuest[]>()
let forest: CompleteQuestTreeNode[] = []
let inferredCompleted = new Set<string>()
let search = ''
let statusFilter = uiGet<TreeStatus | 'all'>('qn.fullTree.status', 'all')
let categoryFilter = uiGet<string>('qn.fullTree.category', 'all')
let selectedId = 0

const categoryOf = (code: string) =>
  code.match(/[A-Z]/g)?.find((letter) => CATEGORY_META[letter]) ?? 'other'

const periodOf = (code: string) => {
  const marker = code.charAt(1).toLowerCase()
  if (marker === 'd') return '日'
  if (marker === 'w') return '周'
  if (marker === 'm') return '月'
  if (marker === 'q') return '季'
  if (marker === 'y') return '年'
  return '单'
}

const isActive = (id: number) => {
  const observed = mg.quests[id]
  if (!observed) return false
  return mg.questActiveIds
    ? mg.questActiveIds.includes(id)
    : observed.state === 2
}

const statusOf = (entry: QuestChainEntry): TreeStatus => {
  const observed = mg.quests[entry.id]
  if (observed?.state === 3) return 'claim'
  if (isActive(entry.id)) return 'active'
  if (observed?.state === 1) return 'available'
  if (inferredCompleted.has(entry.code) && periodOf(entry.code) === '单') return 'completed'
  return 'unknown'
}

const normalize = (value: unknown) =>
  `${value ?? ''}`.normalize('NFKC').toLowerCase().replace(/\s+/g, '')

const matchesFilters = (entry: FullQuest) => {
  if (statusFilter !== 'all' && statusOf(entry) !== statusFilter) return false
  if (categoryFilter !== 'all' && categoryOf(entry.code) !== categoryFilter) return false
  if (!search) return true
  const needle = normalize(search)
  return normalize(`${entry.id} ${entry.code} ${entry.name} ${entry.desc} ${entry.memo2}`).includes(needle)
}

interface VisibleNode {
  node: CompleteQuestTreeNode
  children: VisibleNode[]
  matched: boolean
  priority: boolean
}

const filterNode = (node: CompleteQuestTreeNode): VisibleNode | null => {
  const children = node.children
    .map(filterNode)
    .filter((child): child is VisibleNode => !!child)
  const entry = byId.get(node.entry.id)
  const matched = !!entry && (matchesFilters(entry) || entry.id === selectedId)
  if (!matched && !children.length) return null
  const ownStatus = statusOf(node.entry)
  return {
    node,
    children,
    matched,
    priority:
      ownStatus === 'active' ||
      ownStatus === 'claim' ||
      children.some((child) => child.priority),
  }
}

const taskButtonHtml = (
  entry: QuestChainEntry,
  matched: boolean,
  contextOnly: boolean,
  onPath: boolean,
) => {
  const status = statusOf(entry)
  const meta = STATUS_META[status]
  const category = CATEGORY_META[categoryOf(entry.code)]
  return `<button class="task-node ${status}${entry.id === selectedId ? ' selected' : ''}${matched ? ' matched' : ''}${contextOnly ? ' context' : ''}${onPath ? ' on-path' : ''}"
    data-select-task="${entry.id}" title="${esc(meta.label)}">
    <i class="state" style="--state:${meta.color}"></i>
    <code>${esc(entry.code)}</code>
    <b>${esc(entry.name || `任务 ${entry.id}`)}</b>
    ${category ? `<span class="category" style="--category:${category.color}">${category.label}</span>` : ''}
  </button>`
}

const relationHtml = (node: CompleteQuestTreeNode) => {
  const extras = node.extraParents
    .map((parent) => `<button data-select-task="${parent.id}">${esc(parent.code)}</button>`)
    .join('')
  const unresolved = node.unresolvedParents.map(esc).join('、')
  if (!extras && !unresolved) return ''
  return `<div class="cross-links">${
    extras ? `<span>兼做 ${extras}</span>` : ''
  }${unresolved ? `<span class="missing">资料未收录：${unresolved}</span>` : ''}</div>`
}

const extraBadge = (node: CompleteQuestTreeNode) => {
  if (!node.extraParents.length) return ''
  const codes = node.extraParents.map((parent) => parent.code).join(' ')
  return `<span class="and-req" title="主前置之外还要同时完成：${esc(codes)}">兼 ${esc(codes)}</span>`
}

let focusPath = new Set<string>()

const renderTreeNode = (view: VisibleNode, depth: number, filtersActive: boolean): string => {
  const { node, children, matched, priority } = view
  const onPath = focusPath.has(node.entry.code)
  const line = `${taskButtonHtml(node.entry, matched, !matched, onPath)}${extraBadge(node)}`
  const relations = relationHtml(node)
  if (!children.length) {
    return `<li><div class="tree-line leaf"><i class="leaf-mark">•</i>${line}</div>${relations}</li>`
  }
  const opened = filtersActive || onPath || (!focusPath.size && (depth === 0 || priority))
  return `<li><details data-tree-code="${esc(node.entry.code)}"${opened ? ' open' : ''}>
    <summary><span class="twisty"></span>${line}<span class="child-count">${children.length}</span></summary>
    ${relations}
    <ul>${children.map((child) => renderTreeNode(child, depth + 1, filtersActive)).join('')}</ul>
  </details></li>`
}

const renderInspector = () => {
  const panel = root.querySelector<HTMLElement>('#tree-inspector')
  if (!panel) return
  const entry = byId.get(selectedId)
  if (!entry) {
    panel.innerHTML = '<div class="inspector-empty">点击树中的任务查看说明</div>'
    return
  }
  const status = statusOf(entry)
  const statusMeta = STATUS_META[status]
  const category = CATEGORY_META[categoryOf(entry.code)]
  const observed = mg.quests[entry.id]
  const progress =
    observed?.progressFlag === 2
      ? '游戏进度 80%+'
      : observed?.progressFlag === 1
        ? '游戏进度 50%+'
        : ''
  const links = (items: FullQuest[], empty: string) =>
    items.length
      ? items.map((item) => `<button data-select-task="${item.id}">${esc(item.code)} ${esc(item.name)}</button>`).join('')
      : `<span>${empty}</span>`
  const parents = entry.pre
    .map((code) => byCode.get(code))
    .filter((item): item is FullQuest => !!item)
  const children = childrenByCode.get(entry.code) ?? []
  panel.innerHTML = `<div class="inspector-head">
      <span><code>${esc(entry.code)}</code><i style="--category:${category?.color ?? 'var(--dim)'}">${category?.label ?? '其他'} · ${periodOf(entry.code)}任</i></span>
      <b>${esc(entry.name)}</b>
      <em style="--state:${statusMeta.color}">${statusMeta.label}</em>
      ${progress ? `<small>${progress}</small>` : ''}
    </div>
    <div class="inspector-body">
      <section><h3>任务说明</h3><p>${entry.desc ? esc(entry.desc) : '资料库尚未收录说明'}</p></section>
      ${entry.memo2 ? `<section><h3>补充说明</h3><p>${esc(entry.memo2)}</p></section>` : ''}
      <section><h3>全部前置${questPreSourceNoteHtml(entry.preInfo)}</h3><div class="relation-list">${links(parents, '无已知前置')}</div></section>
      <section><h3>直接后续</h3><div class="relation-list">${links(children, '无已知后续')}</div></section>
    </div>
    <button class="open-main" data-open-main="${entry.id}">在「任务」中打开 →</button>`
}

// 游戏一开任务所（questlist 补丁）就全量重绘：不留状态的话，翻到中部的滚动、
// 手动展开/收起、搜索框焦点全被抹掉。筛选没变才恢复（筛选变了要按新默认展开）。
// 主动定位某条任务时不能恢复旧的展开态，否则刚展开的路径会被旧状态盖回去。
let lastRenderSignature = ''
let revealTick = false
let pendingScroll = false
let pendingFocusId = 0

const render = () => {
  const filtersActive = !!search || statusFilter !== 'all' || categoryFilter !== 'all'
  const signature = `${search}|${statusFilter}|${categoryFilter}`
  const keepView = signature === lastRenderSignature && !revealTick
  revealTick = false
  lastRenderSignature = signature
  focusPath = new Set(pathCodesToQuest(forest, selectedId))
  const prevScroll = keepView ? root.querySelector<HTMLElement>('.tree-scroll')?.scrollTop : undefined
  const prevSearchEl = root.querySelector<HTMLInputElement>('#tree-search')
  const searchFocused = !!prevSearchEl && document.activeElement === prevSearchEl
  const searchSelection: [number, number] = [
    prevSearchEl?.selectionStart ?? 0,
    prevSearchEl?.selectionEnd ?? 0,
  ]
  const prevOpen = new Map<string, boolean>()
  if (keepView) {
    root
      .querySelectorAll<HTMLDetailsElement>('details[data-tree-code]')
      .forEach((node) => prevOpen.set(node.dataset.treeCode!, node.open))
  }
  const visibleForest = forest
    .map(filterNode)
    .filter((node): node is VisibleNode => !!node)
  const matchedCount = quests.filter(matchesFilters).length
  const statusCounts = Object.fromEntries(
    Object.keys(STATUS_META).map((status) => [
      status,
      quests.filter((entry) => statusOf(entry) === status).length,
    ]),
  )
  const categories = Object.entries(CATEGORY_META)
  root.innerHTML = `<div class="tree-app">
    <header>
      <div class="title"><b>完整任务树</b></div>
      <label class="search">⌕<input id="tree-search" placeholder="搜索编号、名称或说明" value="${esc(search)}"></label>
      <div class="tree-actions"><button data-expand-all>全部展开</button><button data-collapse-all>全部收起</button></div>
    </header>
    <div class="filter-row">
      <div class="status-filters">
        <button class="${statusFilter === 'all' ? 'on' : ''}" data-tree-status="all">全部 <b>${quests.length}</b></button>
        ${Object.entries(STATUS_META).map(([status, meta]) =>
          `<button class="${statusFilter === status ? 'on' : ''}" data-tree-status="${status}">
            <i style="--state:${meta.color}"></i>${meta.label}<b>${statusCounts[status]}</b>
          </button>`).join('')}
      </div>
      <label class="category-filter">分类<select id="tree-category">
        <option value="all">全部分类</option>
        ${categories.map(([key, meta]) =>
          `<option value="${key}"${categoryFilter === key ? ' selected' : ''}>${meta.label}</option>`).join('')}
      </select></label>
      <span class="shown-count">命中 <b>${matchedCount}</b> / ${quests.length}</span>
    </div>
    <main>
      <div class="tree-scroll"><ul class="complete-tree">${
        visibleForest.length
          ? visibleForest.map((node) => renderTreeNode(node, 0, filtersActive)).join('')
          : '<li class="tree-empty">暂无符合当前筛选条件的任务</li>'
      }</ul></div>
      <aside id="tree-inspector"></aside>
    </main>
    <footer>${lodeMeta ? `<span class="credit-mark" title="${esc(lodeCredit(lodeMeta))}">源</span>` : '任务资料未加载'}
      <span class="credit-mark" title="状态只使用本机已同步记录；未同步不等于未完成">口径</span></footer>
  </div>`
  if (prevOpen.size) {
    root.querySelectorAll<HTMLDetailsElement>('details[data-tree-code]').forEach((node) => {
      const was = prevOpen.get(node.dataset.treeCode!)
      if (was != null) node.open = was
    })
  }
  if (prevScroll != null) {
    const scroller = root.querySelector<HTMLElement>('.tree-scroll')
    if (scroller) scroller.scrollTop = prevScroll
  }
  if (searchFocused) {
    const next = root.querySelector<HTMLInputElement>('#tree-search')
    next?.focus()
    next?.setSelectionRange(searchSelection[0], searchSelection[1])
  }
  renderInspector()
  // 冒烟用的装配账：**「渲染跑完了」和「渲染出了节点」是两件事**。
  // 缺 quests-scn 时零节点是正确的降级（目录本来就是空的），不是故障；
  // 而渲染中途崩掉同样是零节点。只数节点分不开这两种，所以这里把两件事分开记：
  //   kansoQuestTree  = 这一轮渲染出的节点数（渲染跑完才会有这个属性）
  //   kansoQuestPack  = 任务目录包在不在（'1' / '0'）
  // 判据见 src/main/index.ts 的 probeQuestTree：有包就必须有节点，没包只要求渲染跑完。
  document.body.dataset.kansoQuestTree = `${root.querySelectorAll('.task-node').length}`
  document.body.dataset.kansoQuestPack = quests.length ? '1' : '0'
  if (pendingScroll) {
    pendingScroll = false
    requestAnimationFrame(() => {
      root.querySelector<HTMLElement>('.task-node.selected')?.scrollIntoView({ block: 'center' })
    })
  }
}

const selectTask = (id: number) => {
  if (!byId.has(id)) return
  if (selectedId === id) {
    renderInspector()
    return
  }
  selectedId = id
  revealTick = true
  pendingScroll = true
  render()
}

const focusTask = (id: number) => {
  if (!byId.has(id)) return
  selectedId = id
  revealTick = true
  pendingScroll = true
  render()
}

root.addEventListener('click', (event) => {
  const target = event.target as HTMLElement
  const select = target.closest<HTMLElement>('[data-select-task]')
  if (select) {
    event.preventDefault()
    event.stopPropagation()
    selectTask(Number(select.dataset.selectTask))
    return
  }
  const openMain = target.closest<HTMLElement>('[data-open-main]')
  if (openMain) {
    void focusQuestInMainWindow(Number(openMain.dataset.openMain))
    return
  }
  if (target.closest('[data-expand-all]')) {
    root.querySelectorAll<HTMLDetailsElement>('details').forEach((details) => {
      details.open = true
    })
    return
  }
  if (target.closest('[data-collapse-all]')) {
    root.querySelectorAll<HTMLDetailsElement>('details').forEach((details) => {
      details.open = false
    })
    return
  }
  const status = target.closest<HTMLElement>('[data-tree-status]')?.dataset.treeStatus as TreeStatus | 'all' | undefined
  if (status) {
    statusFilter = status
    uiSet('qn.fullTree.status', statusFilter)
    render()
  }
})

// 走 onFilterInput 而不是裸 input：render 会把整棵树连同输入框一起重建，
// 输入法的组合会话绑在那个元素上，换一次就断（见 kernel 第三道闸门）
onFilterInput(root, (event) => {
  const input = (event.target as HTMLElement).closest<HTMLInputElement>('#tree-search')
  if (!input) return
  const cursor = input.selectionStart ?? input.value.length
  search = input.value
  render()
  const next = root.querySelector<HTMLInputElement>('#tree-search')
  next?.focus()
  next?.setSelectionRange(cursor, cursor)
})

root.addEventListener('change', (event) => {
  const select = (event.target as HTMLElement).closest<HTMLSelectElement>('#tree-category')
  if (!select) return
  categoryFilter = select.value
  uiSet('qn.fullTree.category', categoryFilter)
  render()
})

const load = async () => {
  initUiZoom()
  ipcRenderer.on('quest-tree:focus', (_event: unknown, rawId: unknown) => {
    const id = Number(rawId)
    if (!Number.isInteger(id) || id <= 0) return
    if (!byId.has(id)) {
      pendingFocusId = id
      return
    }
    focusTask(id)
  })
  await initKernel()
  const pack = await queryLode('quests-scn')
  lodeMeta = pack?.meta ?? null
  quests = pack?.data && typeof pack.data === 'object'
    ? Object.entries<any>(pack.data).map(([idText, raw]) => ({
        id: Number(idText),
        code: `${raw?.code ?? '?'}`,
        name: `${raw?.name ?? ''}`,
        desc: `${raw?.desc ?? ''}`,
        memo2: `${raw?.memo2 ?? ''}`,
        pre: Array.isArray(raw?.pre) ? raw.pre.map(String) : [],
      }))
    : []
  // 与任务管理器同一份双源合并口径（补缺/修悬空/标冲突），树和详情才不会各说各话
  const wwPack = await queryLode('wikiwiki-quests')
  const wwByCode = new Map<string, WwQuestPre>(
    wwPack?.data && typeof wwPack.data === 'object'
      ? Object.entries<any>(wwPack.data).map(([code, raw]) => [code, raw as WwQuestPre])
      : [],
  )
  const knownCodes = new Set(quests.map((entry) => entry.code))
  for (const entry of quests) {
    const merged = mergeQuestPre(
      entry.pre,
      wwByCode.get(entry.code),
      knownCodes,
      QUEST_PRE_ARBITRATION.get(entry.code),
    )
    entry.pre = merged.pre
    entry.preInfo = merged
  }
  byId = new Map(quests.map((entry) => [entry.id, entry]))
  byCode = new Map(quests.map((entry) => [entry.code, entry]))
  childrenByCode = new Map()
  for (const entry of quests) {
    for (const parent of entry.pre) {
      const children = childrenByCode.get(parent) ?? []
      children.push(entry)
      childrenByCode.set(parent, children)
    }
  }
  for (const children of childrenByCode.values()) children.sort((left, right) => left.id - right.id)
  forest = buildCompleteQuestForest(quests)
  inferredCompleted = inferCompletedQuestCodes(
    quests,
    Object.values(mg.quests).map((quest) => quest.no),
  )
  selectedId =
    pendingFocusId && byId.has(pendingFocusId)
      ? pendingFocusId
      : quests.find((entry) => statusOf(entry) === 'active')?.id ??
        quests.find((entry) => statusOf(entry) === 'claim')?.id ??
        quests[0]?.id ??
        0
  pendingFocusId = 0
  pendingScroll = true
  onMgChange((keys) => {
    if (!keys.some((key) => ['quests', 'questActiveIds', 'questExecCount'].includes(key))) return
    inferredCompleted = inferCompletedQuestCodes(
      quests,
      Object.values(mg.quests).map((quest) => quest.no),
    )
    render()
  })
  render()
}

void load().catch((error) => {
  console.error('[kanso] complete quest tree window failed', error)
  root.innerHTML = '<div class="loading">完整任务树读取失败 · 关闭窗口后重试</div>'
})
