// 铭 (Mg) · 状态查看器。M1 验收工具页：资源/舰队/入渠/建造的原始视图。
import {
  applyPaneHtml,
  debugApplyPatch,
  debugEmitMarriage,
  esc,
  fleetLabel,
  fmtCountdown,
  fmtTime,
  masterShipName,
  mg,
  onMgChange,
  onTick,
} from '../kernel'
import { ensureShipStatsLode, growthGateReport } from '../fleet-calc'
import { SHIP_GROWTH_LABEL } from '../../shared/ship-growth'
import { debugShowVoiceCue } from '../voice-subtitle'
import { bgmPreviewHtml } from '../bgm-preview'
import { ensureBgmNames } from '../bgm-names'
import type { KcsBgmKind } from '../../shared/kcs-bgm'
import type { SortieView } from '../../shared/mg-types'
import { elink } from '../link'
import { registerModule } from '../mu'
import { entityNameHtml, entityTermHtml } from '../localization'

const MAT_LABELS = ['燃料', '弹药', '钢材', '铝土', '高速建造材', '高速修复材', '开发资材', '改修资材']

let pane: HTMLElement
let renderPending = false

// 这一页只读这六样。其余补丁（quests / slotitems / sortie / portLogs…）跟这五块
// 视图无关，不过滤就是任何一次补丁都重建 5 段 innerHTML。
// 注意 lastPortTs **不能**进这张表：主进程每条补丁都捎带它（main/mg/index.ts），
// 列进来等于不过滤；返港时刻由下面的 onTick 每秒重画，不靠补丁驱动。
const WATCHED_KEYS = ['master', 'materials', 'ships', 'decks', 'ndocks', 'kdocks']

const renderFreshness = () => {
  const el = pane.querySelector<HTMLElement>('.mg-freshness')!
  if (!mg.lastPortTs) {
    el.textContent = '尚无返港记录——登录游戏并返港一次即可'
    el.className = 'mg-freshness'
    return
  }
  const stale = Date.now() - mg.lastPortTs > 30 * 60 * 1000
  el.textContent = `最近返港：${fmtTime(mg.lastPortTs)}${stale ? '（可能已过期）' : ''}`
  el.className = `mg-freshness${stale ? ' stale' : ''}`
}

const renderMaterials = () => {
  const box = pane.querySelector<HTMLElement>('.mg-materials')!
  // 输出没变就别换块（口径见 kernel commitPaneHtml）：块里全是可点的实体链接，
  // 按下与抬起之间换掉它，那一次点击就不会发生
  applyPaneHtml(
    box,
    'materials',
    !mg.materials
      ? '<span style="color:var(--dim)">等待游戏自然提供</span>'
      : mg.materials
          .map((v, i) => `<div class="mat-tile"><small>${entityTermHtml('material', i, MAT_LABELS[i])}</small><b>${v.toLocaleString()}</b></div>`)
          .join(''),
  )
}

const renderDecks = () => {
  const box = pane.querySelector<HTMLElement>('.mg-decks')!
  if (!mg.decks.length) {
    applyPaneHtml(box, 'decks', '<span style="color:var(--dim)">等待游戏自然提供</span>')
    return
  }
  const html = mg.decks
    .map((deck) => {
      const { canonical, custom } = fleetLabel(deck)
      const onMission = deck.mission?.[0] > 0
      const rows = deck.ships
        .filter((id) => id > 0)
        .map((id) => {
          const ship = mg.ships[id]
          if (!ship) return `<div class="mg-ship"><span class="ship-name">#${id}</span></div>`
          const ratio = ship.maxhp > 0 ? ship.nowhp / ship.maxhp : 1
          const hpClass = ratio <= 0.25 ? 'hp-low' : ratio <= 0.5 ? 'hp-mid' : ''
          const condClass = ship.cond >= 50 ? 'cond-high' : ship.cond < 20 ? 'cond-low' : ''
          return (
            `<div class="mg-ship">` +
            `<span class="ship-name">${entityNameHtml('ship', ship.shipId, masterShipName(ship.shipId), { compact: true })}</span>` +
            `<span class="ship-lv">Lv.${ship.lv}</span>` +
            `<span class="ship-hp ${hpClass}">${ship.nowhp}/${ship.maxhp}</span>` +
            `<span class="ship-cond ${condClass}">${ship.cond}</span>` +
            `</div>`
          )
        })
        .join('')
      return (
        `<div class="mg-deck"><div class="mg-deck-head"><b>${elink('fleet', deck.id, canonical)}</b>` +
        (custom ? `<span class="deck-custom">「${entityTermHtml('fleet', deck.id, custom)}」</span>` : '') +
        (onMission ? `<span class="deck-badge">远征中</span>` : '') +
        `</div>${rows}</div>`
      )
    })
    .join('')
  applyPaneHtml(box, 'decks', html)
}

const renderNdocks = () => {
  const box = pane.querySelector<HTMLElement>('.mg-ndocks')!
  if (!mg.ndocks.length) {
    applyPaneHtml(box, 'ndocks', '<span style="color:var(--dim)">等待游戏自然提供</span>')
    return
  }
  const html = mg.ndocks
    .map((dock) => {
      let body = '<span style="color:var(--dim)">—</span>'
      let timer = ''
      if (dock.shipId > 0) {
        const ship = mg.ships[dock.shipId]
        body = ship
          ? entityNameHtml('ship', ship.shipId, masterShipName(ship.shipId), { compact: true })
          : esc(`#${dock.shipId}`)
        const text = fmtCountdown(dock.completeTime)
        timer = `<span class="dock-timer${text === '完成' ? ' done' : ''}">${text}</span>`
      }
      return `<div class="mg-dock"><span class="dock-no">${dock.id}</span><span class="dock-body">${body}</span>${timer}</div>`
    })
    .join('')
  applyPaneHtml(box, 'ndocks', html)
}

const renderKdocks = () => {
  const box = pane.querySelector<HTMLElement>('.mg-kdocks')!
  if (!mg.kdocks.length) {
    applyPaneHtml(box, 'kdocks', '<span style="color:var(--dim)">等待游戏自然提供</span>')
    return
  }
  const html = mg.kdocks
    .map((dock) => {
      let body = '<span style="color:var(--dim)">—</span>'
      let timer = ''
      if (dock.state === -1) {
        body = '<span style="color:var(--dim)">未解锁</span>'
      } else if (dock.state > 0) {
        body = entityNameHtml('ship', dock.createdShipId, masterShipName(dock.createdShipId), { compact: true })
        const text = dock.state === 3 ? '完成' : fmtCountdown(dock.completeTime)
        timer = `<span class="dock-timer${text === '完成' ? ' done' : ''}">${text}</span>`
      }
      return `<div class="mg-dock"><span class="dock-no">${dock.id}</span><span class="dock-body">${body}</span>${timer}</div>`
    })
    .join('')
  applyPaneHtml(box, 'kdocks', html)
}

// ---- 成长标定台账（维护者侧）----
//
// 回避/对潜/索敌的成长端点游戏不在主数据里下发，社区表**会无声腐坏**——
// C2 历年单独抬高过不少舰的成长上限，官方公告只说「谁的哪一项 up」，不说加多少。
// 面板反推那三项因此逐 (形态, 项) 过标定闸门：拿空槽舰验 `面板 == 插值(端点, 等级)`，
// 零残差才启用。**残差非零的那几格就是这张台账**——用户的舰队是端点表的持续校验器，
// 闸门抓到什么，维护者就该照着去改 `ship-stats-patches.ts`。
//
// 摆在诊断面板而不是正式界面：玩家玩游戏时不需要看「哪张社区表过期了」，
// 他只需要那一项别出错数（闸门已经替他挡掉了）。
const renderGrowthGate = () => {
  const box = pane.querySelector<HTMLElement>('.mg-growth-gate')
  if (!box) return
  const report = growthGateReport()
  if (!report.packed) {
    applyPaneHtml(box, 'growth-gate', '<span style="color:var(--dim)">成长端点包还没到</span>')
    return
  }
  const { pass, fail, unverified, noEndpoint } = report.tally
  const head =
    `<div class="mg-sim-note">过闸 ${pass} · <b>禁用 ${fail}</b> · 未验 ${unverified} · 缺端点 ${noEndpoint}` +
    `（未验 = 这个形态你手上每一艘都装着东西，没有空装备的样本可验；照常出数但界面标软一档）</div>`
  const rows = report.failures
    .map(
      (one) =>
        `<div class="mg-ship"><span class="ship-name">${entityNameHtml('ship', one.formId, one.name ?? `#${one.formId}`, { compact: true })}</span>` +
        `<span class="ship-lv">${esc(SHIP_GROWTH_LABEL[one.key])}</span>` +
        `<span class="ship-lv">Lv.${one.lv ?? '?'}</span>` +
        `<span class="ship-hp">期望 ${one.expected} / 实测 ${one.observed}</span>` +
        `<span class="ship-cond hp-low">${one.residual! > 0 ? '+' : ''}${one.residual}</span></div>`,
    )
    .join('')
  applyPaneHtml(
    box,
    'growth-gate',
    head +
      (rows ||
        '<span style="color:var(--dim)">没有残差：验得到的每一格都与端点表对得上</span>'),
  )
}

// ---- 按号试听：战斗曲 / 母港曲（KANSO_DEBUG_UI=1 才存在）----
//
// 这把钥匙最初为 109 / 122 / 123 / 152 / 153 那五桩悬案而造：拆包层与 EN Fandom
// 各说各话（122↔123、152↔153 还是两对整齐对调），可那五个号**不在任何一张现役图上**——
// 鉴的海域卷没有能挂 ♪ 的行，正式界面里根本没处听。音轨却仍在游戏自己的资源服务器上：
// `bgmAudioUrl` 按 cipher 对任意号都算得出来。所以填号 → 点 ♪ → 听到的就是那个号
// 当下的实际音轨。
//
// **2026-08-24 提督用它逐号听完，五桩全部闭案**：122/123 拆包层对（Fandom 写反）；
// 109 是同曲改题（旧题出撃前夜 → 现行 OST 名決戦前夜）；152/153 是拆包层整对错位。
// 判词与证据链在 scripts/lib/kcwiki-bgm.mjs 的 KNOWN_TRANSCRIPTION_FIXES 和
// 耳测清单-BGM.md 第五节。字形总校那条「碟轨号旁证」两头都应验了：152/153 碟序是倒的、
// 122/123 是顺的——与终审逐格同向。钥匙留着：往后再有号源打架，终审还走这条路。
//
// **2026-08-24 加了母港树那一档**。母港曲本来不缺名字（号即主数据 id），可有一类
// **画面主题曲**（出击选择、编成等 UI 场景曲）设不成母港曲、不上蓄音机，主数据永远不给名，
// 界面里同样没有能挂 ♪ 的行——与上面那五桩悬案同病，于是同一把钥匙加一个树的开关。
// 两棵树是两套编号，所以树必须显式选，绝不替维护者猜。
//
// **不新开出口**：这里只是把 `bgmPreviewHtml` 拼出来的那一枚 ♪ 词条摆进面板，
// 播放仍旧由 `initBgmPreview` 那条唯一的全局委托接管——档案实物 → 本机缓存 → 现取，
// 一次点击一次请求；钥里关掉「不联网补取美术资源」而档案里又没有时，
// 它照旧退化成点不响的说明文字（这里不做例外，维护者也该看见玩家看见的那一面）。
// 曲名同样走那一份收口（母港：主数据 → 耳测母港层；战斗：誊写层 → 耳测战斗层），
// 查不到就只写编号，绝不在这里编。
const BGM_PROBE_DEFAULT = 109
const BGM_PROBE_TREES: readonly [KcsBgmKind, string][] = [
  ['battle', '战斗树'],
  ['port', '母港树'],
]

/**
 * 资源路径只有三位数（`bgm/<树>/NNN_XXXX.mp3`），越界一律不认。
 * 整串必须是数字：`parseInt` 会把「12.5」悄悄读成 12，那是替维护者做决定，
 * 而这把钥匙的全部价值就在于「听到的确实是我填的那个号」。
 */
const probeBgmId = (raw: string): number | null => {
  if (!/^\d{1,3}$/.test(raw.trim())) return null
  const id = Number(raw.trim())
  return id >= 1 && id <= 999 ? id : null
}

/** 认不出来的值一律当战斗树——那是默认档，不是「随便挑一棵」 */
const probeBgmTree = (raw: string | undefined): KcsBgmKind => (raw === 'port' ? 'port' : 'battle')

const renderBgmProbe = () => {
  // 发布形态里这张卡整块不生成，取不到这两个元素就是正常的
  const slot = pane.querySelector<HTMLElement>('.mg-bgm-slot')
  const input = pane.querySelector<HTMLInputElement>('.mg-bgm-no')
  if (!slot || !input) return
  const id = probeBgmId(input.value)
  const tree = probeBgmTree(pane.querySelector<HTMLSelectElement>('.mg-bgm-tree')?.value)
  applyPaneHtml(
    slot,
    'bgm-probe',
    id
      ? bgmPreviewHtml(id, tree)
      : `<span style="color:var(--dim)">填 1–999 之间的${tree === 'port' ? '母港' : '战斗'}树编号</span>`,
  )
}

const renderAll = () => {
  renderPending = false
  renderFreshness()
  renderMaterials()
  renderDecks()
  renderNdocks()
  renderKdocks()
  renderGrowthGate()
  // 曲名表是异步到的：跟着全量重渲补一拍，拉到之后编号自己会变成曲名。
  // 输出没变就整段跳过（applyPaneHtml），所以不会在按下与抬起之间把 ♪ 换掉。
  renderBgmProbe()
}

// ---- 沉浸特效模拟台（KANSO_DEBUG_UI=1 才存在）----
//
// 应急修理发动、我方被击沉、ケッコンカッコカリ 这几件事，真机上没法按需复现：
// 分别要故意浪费一枚稀有道具、真沉一艘舰、烧掉一枚不可再生的戒指。
// 可它们又恰恰是**全靠视觉说话**的功能。
// 这张卡编的只有输入——一份 sortie 补丁，或一条 cue——之后全部交给生产代码路径：
// kernel 的 applyMgPatch / dispatchMarriage → 铃的 detectDamecon/detectSunk/detectTaiha/
// detectMarriage → 横幅、失色推导与花瓣。所以在这里看到的效果，就是真发生时的效果。
//
// 发布形态零痕迹：诊断模块本身就只在 KANSO_DEBUG_UI=1 时装配（mu.ts），
// 这里再门控一次——万一将来诊断面板被放进正式界面，这张卡也不该跟着出来。
const DEBUG_UI = process.env.KANSO_DEBUG_UI === '1'

type SimShip = {
  index: number
  rosterId: number | null
  mstId: number
  name: string
  lv: number
  hpEnd: number
  hpMax: number
  repairItemUsed?: number | null
  sunk?: boolean
}

/** 拿真编队第一队的在籍舰当素材：碎裂卡要能落在锐里真实存在的那一行上。 */
const simRoster = (): { rosterId: number; mstId: number; name: string; lv: number; maxhp: number }[] => {
  const deck = mg.decks.find((d) => d.id === 1) ?? mg.decks[0]
  const ids = (deck?.ships ?? []).filter((id) => id > 0)
  return ids.map((id) => {
    const ship = mg.ships[id]
    return {
      rosterId: id,
      mstId: ship?.shipId ?? 0,
      name: masterShipName(ship?.shipId ?? 0) || `#${id}`,
      lv: ship?.lv ?? 1,
      maxhp: ship?.maxhp || 40,
    }
  })
}

let simBattleNo = 100

const simPatch = (ships: SimShip[], sunk: SimShip[] = []) => {
  simBattleNo += 1
  const base = mg.sortie
  const sortie: SortieView = {
    ...(base ?? ({} as SortieView)),
    active: true,
    practice: false,
    mapArea: base?.mapArea || 3,
    mapNo: base?.mapNo || 5,
    deckId: 1,
    bossCell: base?.bossCell ?? -1,
    nodes: base?.nodes ?? [],
    currentCell: base?.currentCell ?? 12,
    cellData: base?.cellData ?? [],
    selectRoute: base?.selectRoute ?? [],
    battle: {
      ...(base?.battle ?? ({} as NonNullable<SortieView['battle']>)),
      practice: false,
      fShips: ships.map((ship) => ({
        index: ship.index,
        fleet: 'main' as const,
        position: ship.index,
        mstId: ship.mstId,
        rosterId: ship.rosterId,
        name: ship.name,
        lv: ship.lv,
        hpStart: ship.hpMax,
        hpEnd: ship.hpEnd,
        hpMax: ship.hpMax,
        damageDealt: 0,
        sunk: ship.sunk === true,
        defeated: ship.sunk === true,
        escaped: false,
        repairItemUsed: ship.repairItemUsed ?? null,
      })),
      eShips: [],
    } as NonNullable<SortieView['battle']>,
    battleCount: simBattleNo,
    drops: base?.drops ?? [],
    // 沉没名单在真实出击里是**累积**的（一路攒到返港），模拟也得照这个来：
    // 否则「击沉之后再模拟一次损管」会把哀悼态冲掉，看不到灰底上的横幅。
    // 已返港（active 落下）就当新一趟出击，从空开始。
    sunkShips: [
      ...(base?.active ? (base.sunkShips ?? []) : []),
      ...sunk
        .filter((ship) => !(base?.active ? base.sunkShips ?? [] : []).some((e) => e.rosterId === ship.rosterId))
        .map((ship) => ({
          rosterId: ship.rosterId ?? 0,
          mstId: ship.mstId,
          name: ship.name,
          lv: ship.lv,
          cell: base?.currentCell ?? 12,
          battleNo: simBattleNo,
          ts: Date.now(),
        })),
    ],
    anchorageRepairs: base?.anchorageRepairs ?? [],
    escaped: base?.escaped ?? [],
    airBaseStrikes: base?.airBaseStrikes ?? {},
    startTs: base?.startTs || Date.now(),
    updatedTs: Date.now(),
  }
  // 真实链路里 store.syncBattleHp 会把战斗 HP 回写到在籍舰，沉没舰因此是 0 血。
  // 模拟不带上这一笔的话，碎裂卡旁边会挂着一条满血条——那不是它真出现时的样子。
  const roster = shipsWithHp(sortie.sunkShips.map((entry) => [entry.rosterId, 0]))
  debugApplyPatch(roster ? { sortie, ships: roster } : { sortie })
}

/** 按 [rosterId, nowhp] 复制一份在籍表；没有要改的就返回 null（不发多余补丁）。 */
const shipsWithHp = (pairs: [number, number][]): Record<number, any> | null => {
  const touched = pairs.filter(([id]) => mg.ships[id])
  if (!touched.length) return null
  const next: Record<number, any> = { ...mg.ships }
  for (const [id, hp] of touched) next[id] = { ...next[id], nowhp: hp }
  return next
}

const simShipAt = (position: number, hpRatio: number): SimShip => {
  const roster = simRoster()
  const pick = roster[position] ?? roster[0]
  const hpMax = pick?.maxhp ?? 40
  return {
    index: position,
    rosterId: pick?.rosterId ?? null,
    mstId: pick?.mstId ?? 0,
    name: pick?.name ?? `模拟舰${position + 1}`,
    lv: pick?.lv ?? 1,
    hpMax,
    hpEnd: Math.max(0, Math.floor(hpMax * hpRatio)),
  }
}

/**
 * 婚礼台词的字幕（24 号槽＝ケッコンカッコカリ，见 voice-subtitle 的 WEDDING_VOICE_SLOT）。
 * 编队空着时退到睦月(1)——矿脉里 758/762 艘有这一句，随便挑一艘都看得到粉色档。
 */
const simWeddingVoice = (mstId: number) => {
  debugShowVoiceCue({ kind: 'ship', mstId: mstId > 0 ? mstId : 1, voiceId: 24 })
}

const SIM_ACTIONS: [string, string, () => void][] = [
  ['taiha', '大破横幅', () => simPatch([simShipAt(0, 0.2)])],
  [
    'crew',
    '应急修理 · 要員(42)',
    // 要員回两成耐久，人仍在大破线上——所以这一下同时也满足大破判据，
    // 两条横幅会一起挂着。这正是要看的那个场面（谁在上面）。
    () => simPatch([{ ...simShipAt(0, 0.2), repairItemUsed: 42 }]),
  ],
  ['goddess', '应急修理 · 女神(43)', () => simPatch([{ ...simShipAt(1, 1), repairItemUsed: 43 }])],
  [
    'both',
    '两档绿同屏',
    () =>
      simPatch([
        { ...simShipAt(0, 0.2), repairItemUsed: 42 },
        { ...simShipAt(1, 1), repairItemUsed: 43 },
      ]),
  ],
  [
    'sunk',
    '击沉 · 失色 + 碎裂卡',
    () => {
      const lost = { ...simShipAt(0, 0), sunk: true }
      simPatch([lost, simShipAt(1, 0.2)], [lost])
    },
  ],
  [
    'wedding',
    '婚舰 · 粉光 + 花瓣 + 字幕',
    // 戒指不可再生，这一套视觉在真机上没有第二次验收机会——所以模拟走的必须是
    // 与报文到达完全同一条派发路径（kernel 的 dispatchMarriage → 铃的 detectMarriage
    // → 横幅 / 外框 / 花瓣），编的只有 cue 本身。
    // 字幕另走一路：婚礼台词的染粉判据是**语音槽位 24**（ケッコンカッコカリ），
    // 与这条报文无关，所以这里顺带按真实语音请求的形状放一条 24 号槽的字幕，
    // 让粉色档能跟横幅同屏比对（见 simWeddingVoice）。
    () => {
      const pick = simRoster()[0]
      debugEmitMarriage({
        ts: Date.now(),
        rosterId: pick?.rosterId ?? null,
        mstId: pick?.mstId ?? null,
        level: pick?.lv ?? null,
      })
      simWeddingVoice(pick?.mstId ?? 0)
    },
  ],
  [
    'wedding-anon',
    '婚舰 · 认不出是哪一艘',
    // 降级路径：post/body 都没给出可用的 api_id 时，仍然庆祝，只是不指名。
    () => debugEmitMarriage({ ts: Date.now(), rosterId: null, mstId: null, level: null }),
  ],
  [
    'port',
    '返港 · 解除',
    () => {
      // 返港报文会整份重下在籍表，所以这里把模拟压过的血也一并还回去
      const ships = shipsWithHp(
        (mg.sortie?.sunkShips ?? []).map((entry) => [entry.rosterId, mg.ships[entry.rosterId]?.maxhp ?? 0]),
      )
      const sortie = mg.sortie ? { ...mg.sortie, active: false } : null
      debugApplyPatch(ships ? { sortie, ships } : { sortie })
    },
  ],
]

const simCardHtml = (): string =>
  DEBUG_UI
    ? `<div><div class="mg-section-title">沉浸特效模拟（KANSO_DEBUG_UI）</div>
        <div class="mg-sim">${SIM_ACTIONS.map(
          ([id, label]) => `<button type="button" data-sim="${id}">${esc(label)}</button>`,
        ).join('')}</div>
        <div class="mg-sim-note">编的只有输入（一份补丁 / 一条 cue），探测与呈现走的是生产代码路径。横幅需手动关闭，花瓣十几秒后自行退场。</div>
      </div>`
    : ''

// 给那些不在任何现役图上、界面里没处摆 ♪ 的号留的口子（战斗侧是几桩悬案，
// 母港侧是主数据永远不给名的画面主题曲），走的是和海域卷同一条播放链。
const bgmProbeCardHtml = (): string =>
  DEBUG_UI
    ? `<div><div class="mg-section-title">按号试听（KANSO_DEBUG_UI）</div>
        <div class="mg-bgm-probe">
          <select class="mg-bgm-tree">${BGM_PROBE_TREES.map(
            ([value, label], index) =>
              `<option value="${value}"${index === 0 ? ' selected' : ''}>${esc(label)}</option>`,
          ).join('')}</select>
          <input class="mg-bgm-no" type="number" min="1" max="999" step="1" value="${BGM_PROBE_DEFAULT}" />
          <span class="mg-bgm-slot"></span>
        </div>
        <div class="mg-sim-note">选树、填编号（1–999）再点 ♪，放的就是那个号当下的实际音轨；旁边显示的是本包对这个号的曲名说法，没有说法就只写编号。两棵树是两套编号，同一个号在两边是两首不同的曲，所以树要自己选。</div>
      </div>`
    : ''

registerModule({
  id: 'mgstate',
  title: '记录',
  order: 9,
  mount(el) {
    pane = el
    pane.innerHTML = `
      <div class="mg-freshness">尚无数据</div>
      <div><div class="mg-section-title">资源</div><div class="mg-materials mg-grid"></div></div>
      <div><div class="mg-section-title">舰队</div><div class="mg-decks"></div></div>
      <div><div class="mg-section-title">入渠</div><div class="mg-ndocks"></div></div>
      <div><div class="mg-section-title">建造</div><div class="mg-kdocks"></div></div>
      <div><div class="mg-section-title">成长标定台账</div><div class="mg-growth-gate"></div></div>
      ${simCardHtml()}
      ${bgmProbeCardHtml()}`
    // 端点包是异步到的：拉到之后补一拍，否则台账永远停在「包还没到」
    ensureShipStatsLode(() => {
      if (pane?.isConnected) renderGrowthGate()
    })
    if (DEBUG_UI) {
      // 委托挂在面板自身上，只挂一次；模拟卡是整块 innerHTML 里的静态内容，
      // renderAll 不重建它，所以不存在换块后掉绑定的问题。
      pane.addEventListener('click', (event) => {
        const button = (event.target as HTMLElement).closest<HTMLElement>('[data-sim]')
        if (!button) return
        SIM_ACTIONS.find(([id]) => id === button.dataset.sim)?.[2]()
      })
      // 换号/换树只重拼那一枚 ♪ 词条；♪ 的点击不在这里接，走 bgm-preview 的全局委托。
      // 两种事件都收：数字框改的是 input，下拉选的是 change（各浏览器对 select 的
      // input 事件支持不一，多挂一个不会重复渲染——applyPaneHtml 输出没变就整段跳过）。
      const onProbeEdit = (event: Event) => {
        const el = event.target as HTMLElement
        if (el.classList.contains('mg-bgm-no') || el.classList.contains('mg-bgm-tree')) {
          renderBgmProbe()
        }
      }
      pane.addEventListener('input', onProbeEdit)
      pane.addEventListener('change', onProbeEdit)
      // 曲名表按需拉一次：拉到之前 ♪ 上只写编号，拉到之后补一拍换成曲名
      ensureBgmNames(() => {
        if (pane?.isConnected) renderBgmProbe()
      })
    }
    onMgChange((keys) => {
      if (!keys.some((key) => WATCHED_KEYS.includes(key))) return
      // 不可见就只攒脏标记，露面时（onShow / 下一次 tick）一次补上。
      // 出击中 ships/materials 每场都变，对着看不见的面板重建 innerHTML 是纯浪费。
      // （ji/qa/du/shi 同款守卫。）
      if (!pane.classList.contains('active')) {
        renderPending = true
        return
      }
      renderAll()
    })
    onTick(() => {
      if (!pane.classList.contains('active')) return
      // 兜底：坞位重铺也会翻 active 类，那条路径不走 onShow。
      if (renderPending) return renderAll()
      renderFreshness()
      if (mg.ndocks.some((d) => d.shipId > 0)) renderNdocks()
      if (mg.kdocks.some((d) => d.state === 2)) renderKdocks()
    })
    renderAll()
  },
  onShow() {
    if (renderPending) renderAll()
  },
})
