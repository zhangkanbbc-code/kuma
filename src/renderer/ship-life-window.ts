// 人生记录窗：一艘舰娘的一生摊在一块面板上。
//
// 只读铭的本地账本（履历 + boss 击杀簿）与内核里那份舰队状态，不创建游戏 webview。
// 是哪一艘由主进程在 loadFile 时用查询串给定（`?roster=`），一扇窗只讲一艘——
// 换一艘是另开一扇，这里没有切换。
//
// 更新口径：**打开时查一次，窗口重新获得焦点时再查一次**。不订阅 mg 变更做全量重渲：
// 一场战斗能连推好几条补丁，而这页是给人慢慢看的，重建 DOM 只会把滚动位置抖掉。
import {
  esc,
  fmtDate,
  initKernel,
  initUiZoom,
  masterShipName,
  mg,
  openBattleInMainWindow,
  queryBossKills,
  queryMasterRaw,
  queryShipLife,
} from './kernel'
import { ensureMapCellLetters, mapCellLetter } from './map-cell-letter'
import { initLocalization, entityNamePlain } from './localization'
import { setAllowRemoteArt, setGameHost, setShipImageGraph, shipImageUrl } from './kcs-image'
import { lifeEventHtml, lifeJoinOriginText } from './ship-life-events'
import { shipLifeDamageText } from '../shared/ship-life-damage'
import { mapCodeOf } from '../shared/map-id'
import { MARRIED_LEVEL_CAP } from '../shared/ship-growth'

import type { ShipBossKillEntry, ShipLifeEvent, ShipLifeReport } from '../shared/mg-types'

const root = document.querySelector<HTMLElement>('#life-root')!
const windowConfig = require('@electron/remote').require('./config')

// 账本对这个查询的硬上限就是 200 条（ledger.queryShipLife 自己 clamp）。
const EVENT_LIMIT = 200

const rosterId = Number(new URLSearchParams(location.search).get('roster') ?? 0)

let life: ShipLifeReport | null = null
let kills: ShipBossKillEntry[] = []
let loadFailed = false
let refreshing = false

const DAY_MS = 24 * 3600 * 1000

const abyssName = (mstId: number) =>
  entityNamePlain('abyssShip', mstId, mg.master.ships[mstId]?.name ?? `深海舰 ${mstId}`)

/** `6-5 M 点`；图或点说不出来时只给能说的那半截，不拿 `#0` 冒充一个点。 */
const placeText = (map: number | null, cell: number | null): string => {
  if (!(map && map > 0)) return ''
  return cell == null ? mapCodeOf(map) : `${mapCodeOf(map)} ${mapCellLetter(map, cell)} 点`
}

/**
 * 一张能加载失败的图。第一顺位取不到就换下一张，全落空只留一个字。
 * （主界面那套 entity-art 的补图/降级挂在主窗口的 CSS 与全局监听上，这扇窗自带一份。）
 */
const artHtml = (urls: (string | null)[], initial: string, className: string): string => {
  const usable = urls.filter((url): url is string => !!url)
  if (!usable.length) return `<span class="art-fallback">${esc(initial)}</span>`
  return `<img src="${esc(usable[0])}" alt="" decoding="async"
    data-art-chain="${esc(usable.slice(1).join('|'))}"
    data-art-initial="${esc(initial)}" class="${className}">`
}

// 图挂了就顺着候选链往下换，链走完把图换成文字占位。捕获相接——error 不冒泡。
document.addEventListener(
  'error',
  (event) => {
    const img = event.target
    if (!(img instanceof HTMLImageElement) || !img.hasAttribute('data-art-chain')) return
    const chain = (img.getAttribute('data-art-chain') ?? '').split('|').filter(Boolean)
    const next = chain.shift()
    if (next) {
      img.setAttribute('data-art-chain', chain.join('|'))
      img.src = next
      return
    }
    const fallback = document.createElement('span')
    fallback.className = 'art-fallback'
    fallback.textContent = img.getAttribute('data-art-initial') || '?'
    img.replaceWith(fallback)
  },
  true,
)

const heroHtml = (report: ShipLifeReport | null): string => {
  // 形态只认在籍表里那一手。她要是已经离籍（拆了/当了素材/沉了），这里认不出
  // 是谁——履历行本身没有带形态号，不去别处凑一个，如实少说一句。
  const ship = mg.ships[rosterId]
  const mstId = ship?.shipId ?? 0
  const master = mstId > 0 ? mg.master.ships[mstId] : undefined
  const name = mstId > 0 ? entityNamePlain('ship', mstId, masterShipName(mstId)) : `舰娘 ${rosterId}`
  const yomi = master?.yomi && master.yomi !== '-' ? master.yomi : ''
  const typeName = master ? (mg.master.stypes[master.stype] ?? '') : ''
  const events = report?.events ?? []
  const join = events.find((event) => event.kind === 'join')
  const marriage = events.find((event) => event.kind === 'marriage')
  // 只有结过誓约的舰能越过 Lv99——这条是从等级看出来的，日期得另说（见下）
  const vowed = !!marriage || (ship != null && ship.lv > 99)

  const pills: string[] = []
  if (ship) {
    pills.push(
      `<span class="pill lv" title="${esc(`累计经验 ${ship.expTotal.toLocaleString()}${ship.lv > 99 ? ` · 婚后上限 Lv${MARRIED_LEVEL_CAP}` : ''}`)}">Lv <b>${ship.lv}</b></span>`,
    )
  }
  if (typeName) pills.push(`<span class="pill">${esc(typeName)}</span>`)
  if (join) {
    pills.push(
      `<span class="pill" title="从「加入镇守府」那一条数起">加入 <b>${Math.max(0, Math.floor((Date.now() - join.ts) / DAY_MS))}</b> 天</span>`,
    )
  } else if (report?.trackingSince) {
    pills.push(
      `<span class="pill" title="从账本第一条记录数起">记录 <b>${Math.max(0, Math.floor((Date.now() - report.trackingSince) / DAY_MS))}</b> 天</span>`,
    )
  }
  // 誓约那天在账本记账之前的，就只挂一枚牌、不带日期——没有的东西不显示，
  // 玩家自己看得见；判据（越过 Lv99）留在悬停里。
  if (marriage) {
    pills.push(`<span class="pill vow">誓约 <b>${esc(fmtDate(marriage.ts))}</b></span>`)
  } else if (vowed) {
    pills.push('<span class="pill vow" title="越过 Lv99 就是结过誓约">誓约</span>')
  }

  // 「加入镇守府」那一条在就写它；不在就什么都不写——页脚已经摆着记录起点。
  const originLine = join
    ? `<div class="hero-line"><b>${esc(fmtDate(join.ts))}</b> 加入镇守府<span class="where">${esc(lifeJoinOriginText(join))}</span></div>`
    : ''

  return `<header class="hero${vowed ? ' vowed' : ''}">
    <div class="hero-art">${artHtml(
      [
        mstId > 0 ? shipImageUrl(mstId, 'card') : null,
        mstId > 0 ? shipImageUrl(mstId, 'banner') : null,
      ],
      name.charAt(0) || '?',
      'card',
    )}</div>
    <div class="hero-copy">
      <div class="hero-name"><b>${esc(name)}</b>${yomi ? `<span class="yomi">${esc(yomi)}</span>` : ''}</div>
      <div class="hero-pills">${pills.join('')}</div>
      ${originLine}
      ${ship ? '' : '<div class="hero-line quiet">已离开仓库</div>'}
      ${report ? kpisHtml(report) : ''}
    </div>
  </header>`
}

const kpisHtml = (report: ShipLifeReport): string => {
  const rate = (value: number | null) => (value == null ? '—' : `${Math.round(value * 100)}%`)
  const hurt = shipLifeDamageText(report)
  const partial = hurt.partial ? ' partial' : ''
  const suffix = hurt.partial ? '（部分）' : ''
  return `<section class="kpis">
    <div class="kpi"><small>记录经验</small><b>+${report.expGained.toLocaleString()}</b></div>
    <div class="kpi"><small>出击</small><b>${report.sorties}</b></div>
    <div class="kpi" title="B 以上计胜利"><small>出击胜利 B+</small><b>${report.wins}/${report.battles} · ${rate(report.winRate)}</b></div>
    <div class="kpi"><small>演习胜利 B+</small><b>${report.practiceWins}/${report.practiceBattles} · ${rate(report.practiceWinRate)}</b></div>
    <div class="kpi"><small>MVP</small><b>${report.mvps}</b></div>
    <div class="kpi"><small>Boss 战</small><b>${report.bossBattles}</b></div>
    <div class="kpi"><small>终结 Boss</small><b>${kills.length}</b></div>
    <div class="kpi"><small>改造</small><b>${report.remodels}</b></div>
    <div class="kpi${partial}" title="${esc(hurt.dealtTitle)}"><small>造成伤害${suffix}</small><b>${hurt.dealt}</b></div>
    <div class="kpi${partial}" title="${esc(hurt.title)}"><small>承受伤害${suffix}</small><b>${hurt.damage}</b></div>
    <div class="kpi${partial}" title="${esc(hurt.title)}"><small>大破</small><b>${hurt.taiha}</b></div>
  </section>`
}

interface BossKillGroup {
  bossMstId: number
  /** 这一组的每一场，沿用查询的时间倒序 */
  entries: ShipBossKillEntry[]
  /** 最近一次终结它的时间 */
  latestTs: number
}

/**
 * 按敌旗舰把击杀簿合并成组。同一头 boss 打了十次就是一行 `×10`，不是十行。
 *
 * 组序 = 最近一次击杀倒序：查询本身按 ts DESC 给，所以「第一次遇到某个 mstId」的
 * 先后就已经是这个顺序，不必再排一次。按次数排会把刚打完的那一场沉到底下——
 * 这栏最常被问的是「最近谁死在她手上」，所以让位给时间。
 */
const groupKills = (entries: ShipBossKillEntry[]): BossKillGroup[] => {
  const byBoss = new Map<number, BossKillGroup>()
  for (const entry of entries) {
    const group = byBoss.get(entry.bossMstId)
    if (group) {
      group.entries.push(entry)
      if (entry.ts > group.latestTs) group.latestTs = entry.ts
    } else {
      byBoss.set(entry.bossMstId, {
        bossMstId: entry.bossMstId,
        entries: [entry],
        latestTs: entry.ts,
      })
    }
  }
  return [...byBoss.values()]
}

/** 展开着的那几组（记敌旗舰 mstId）。见 toggleKillGroup 那一段说明它为什么活在渲染之外。 */
const expandedBosses = new Set<number>()

/** 组里的一场：日期 / 海域点位 / 评级，点了让主窗口打开这一场的复盘。 */
const killBattleHtml = (entry: ShipBossKillEntry): string => {
  const where = placeText(entry.map, entry.cell)
  const jumpable = entry.snapshotId != null
  return `<button class="kill-battle${jumpable ? ' jump' : ''}"${
    jumpable
      ? ` data-battle="${entry.snapshotId}" title="打开这一场的复盘"`
      : ' disabled title="这一场的战斗快照已不在本地"'
  }>
    <time>${esc(fmtDate(entry.ts))}</time>
    <span class="where">${esc(where)}</span>
    ${entry.rank ? `<span class="rank">${esc(entry.rank)}</span>` : '<span></span>'}
  </button>`
}

/** 只打过一次的也走同一副骨架：一行 `×1`，点开里面就一场。形态统一好过省一次点击。 */
const killGroupHtml = (group: BossKillGroup): string => {
  const open = expandedBosses.has(group.bossMstId)
  const count = group.entries.length
  return `<div class="kill-group${open ? ' open' : ''}">
    <button class="kill-h" data-boss="${group.bossMstId}" data-count="${count}"
      aria-expanded="${open}" title="${esc(open ? '收起' : `展开这 ${count} 场`)}">
      <span class="kill-thumb">${artHtml([shipImageUrl(group.bossMstId, 'banner')], '', 'thumb')}</span>
      <span class="boss">${esc(abyssName(group.bossMstId))}</span>
      <span class="n">×${count}</span>
      <time>${esc(fmtDate(group.latestTs))}</time>
      <span class="caret" aria-hidden="true"></span>
    </button>
    <div class="kill-list">${group.entries.map(killBattleHtml).join('')}</div>
  </div>`
}

const killsHtml = (): string => {
  const maps = new Set(kills.map((entry) => entry.map).filter((map): map is number => !!map && map > 0))
  const groups = groupKills(kills)
  const body = groups.length
    ? groups.map(killGroupHtml).join('')
    : `<div class="empty" title="航空战、基地航空与支援射击的最后一击没有单舰归属，不摊给任何一艘">暂无 Boss 终结记录</div>`
  // 「场」仍是这一栏的口径（合并只是摆法），组数跟在后面，省得读者拿 6 去数 3 行。
  return `<div class="col kills">
    <div class="col-h"><b>击杀簿</b><span class="cnt">${
      kills.length ? `${kills.length} 场 · ${groups.length} 个 Boss · ${maps.size} 张海域` : ''
    }</span></div>
    <div class="col-body">${body}</div>
  </div>`
}

/** 履历里那一场的标题：点了让主窗口打开复盘（这扇窗自己没有复盘视图）。 */
const battleLink = (snapshotId: number, titleText: string) =>
  `<button class="replay-jump" data-battle="${snapshotId}">${esc(titleText)}</button>`

const timelineHtml = (report: ShipLifeReport): string => {
  const rows = report.events
    .map((event: ShipLifeEvent) => lifeEventHtml(event, { battleLink }))
    .join('')
  // 到顶了就把「最近」两个字写进计数：账本这个查询的上限就是 EVENT_LIMIT 条，
  // 不说的话这个数会被读成「她这辈子只做过这些事」。
  const capped = report.events.length >= EVENT_LIMIT
  return `<div class="col">
    <div class="col-h"><b>履历</b><span class="cnt"${
      capped ? ` title="账本这个查询的上限是 ${EVENT_LIMIT} 条"` : ''
    }>${capped ? '最近 ' : ''}${report.events.length} 条</span></div>
    <div class="col-body">${
      rows ? `<div class="life-timeline">${rows}</div>` : '<div class="empty">暂无履历记录</div>'
    }</div>
  </div>`
}

const render = () => {
  if (loadFailed) {
    root.innerHTML = '<div class="fatal">本地记录读取失败</div>'
    return
  }
  if (!life) {
    root.innerHTML = '<div class="loading">正在读取本地记录……</div>'
    return
  }
  const ship = mg.ships[rosterId]
  const name =
    ship && ship.shipId > 0
      ? entityNamePlain('ship', ship.shipId, masterShipName(ship.shipId))
      : `舰娘 ${rosterId}`
  document.title = `kuma · ${name}的一生`
  root.innerHTML = `<div class="life-app">
    ${heroHtml(life)}
    <main>${killsHtml()}${timelineHtml(life)}</main>
    <footer>
      <span>${esc(
        life.trackingSince ? `自 ${fmtDate(life.trackingSince)} 起记录` : '等待下一次舰队同步',
      )}</span>
      <span class="sp"></span>
      <span>舰娘 ID ${rosterId}</span>
    </footer>
  </div>`
}

/**
 * 摊开/合上一组。就地改 class，不重画整页——重画会把两栏的滚动位置一起抖掉，
 * 而这只是一次纯前端的展开，手上的数据一个字都没变，也不用再查一次账本。
 *
 * 展开状态记在 `expandedBosses` 里而不是 DOM 上：窗口重新获得焦点会重查重画
 * （见文件头的更新口径），状态活在渲染之外，摊开的那几组才不会自己合上。
 */
const toggleKillGroup = (head: HTMLElement) => {
  const bossMstId = Number(head.dataset.boss)
  if (!Number.isInteger(bossMstId) || bossMstId <= 0) return
  const open = !expandedBosses.has(bossMstId)
  if (open) expandedBosses.add(bossMstId)
  else expandedBosses.delete(bossMstId)
  head.closest('.kill-group')?.classList.toggle('open', open)
  head.setAttribute('aria-expanded', `${open}`)
  head.title = open ? '收起' : `展开这 ${head.dataset.count ?? ''} 场`
}

root.addEventListener('click', (event) => {
  const target = event.target as HTMLElement
  const head = target.closest<HTMLElement>('[data-boss]')
  if (head) {
    toggleKillGroup(head)
    return
  }
  const jump = target.closest<HTMLElement>('[data-battle]')
  if (!jump) return
  const snapshotId = Number(jump.dataset.battle)
  if (!Number.isInteger(snapshotId) || snapshotId <= 0) return
  void openBattleInMainWindow(snapshotId)
})

const refresh = async () => {
  if (refreshing) return
  refreshing = true
  try {
    const [report, bossKills] = await Promise.all([
      queryShipLife(rosterId, EVENT_LIMIT),
      queryBossKills(rosterId, 500),
    ])
    life = report
    kills = bossKills
    loadFailed = false
  } catch (error) {
    // 下层不再把读取故障吞成空结果，所以这里接得住。手上已经有一份就留着旧的，
    // 别把「这次没读出来」画成「她什么都没做过」。
    console.warn('[kanso] 人生记录读取失败', rosterId, error)
    if (!life) loadFailed = true
  } finally {
    refreshing = false
  }
  render()
}

const start = async () => {
  initUiZoom()
  if (!Number.isInteger(rosterId) || rosterId <= 0) {
    root.innerHTML = '<div class="fatal">没有指定舰娘</div>'
    return
  }
  // 立绘/横幅的取图口径与主窗口一致：本地缓存优先，缓存里没有才回退游戏自己的
  // 资源服务器，而那条回退在钥里可以关。主机名用上次识别到的那个（主窗口存的）。
  const remembered = windowConfig.get('kanso.lastGameHost', '')
  if (typeof remembered === 'string' && /^[\w.-]+$/.test(remembered)) setGameHost(remembered)
  setAllowRemoteArt(windowConfig.get('kanso.remoteArt', true) !== false)
  await initKernel()
  // 点位字母表到手之前先写 `#号`，到手再重画一次（与人生记录卡同一条路）
  ensureMapCellLetters(() => render())
  await Promise.all([
    initLocalization().catch((error) => console.warn('[kanso] 译名表读取失败', error)),
    // api_mst_shipgraph 的版本号：远端取图要带它绕过 CDN 的长期缓存
    queryMasterRaw()
      .then((raw) => setShipImageGraph(raw?.data?.api_mst_shipgraph ?? []))
      .catch((error) => console.warn('[kanso] 主数据读取失败', error)),
  ])
  await refresh()
  // 回到这扇窗时重查一次就够了：她在游戏里刚打完的那一场，切回来就在。
  window.addEventListener('focus', () => void refresh())
}

void start().catch((error) => {
  console.error('[kanso] ship life window failed', error)
  root.innerHTML = '<div class="fatal">人生记录加载失败</div>'
})
