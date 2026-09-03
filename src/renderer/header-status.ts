// 游戏抬头状态条：常驻展示真正需要扫一眼的信息。
// 保持高密度、只读、可点击：提督/等级、八资源、2-4 队远征、入渠、演习快照。
import {
  applyPaneHtml,
  esc,
  combinedEscortState,
  deckOnSortie,
  fleetLabel,
  fmtCountdown,
  fmtCountdownShort,
  fmtTime,
  masterShipName,
  mg,
  nextMonthlyReset,
  nextJstTime,
  nextWeeklyReset,
  onMgChange,
  onTick,
  updateCountdowns,
} from './kernel'
import { MATERIAL_ICON_BY_INDEX, materialIconHtml, shipThumbHtml } from './entity-art'
import { countCapacitySlotitems } from './equip-capacity'
import { elink, navigate, registerEntityRoute } from './link'
import { entityNamePlain } from './localization'
import { activateModule } from './mu'
import { isBuildSpoilerEnabled, openNotifyRule } from './modules/lg'
import { fleetHasUnsupplied } from './modules/ru'
import { type KcsBgmCue } from '../shared/kcs-bgm'
import { bgmNameOf, ensureBgmNames } from './bgm-names'
import { materialCues, onMaterialCueChange } from './material-deltas'
import { headerFitStage } from '../shared/header-fit'

const HEADER_FIT_TOLERANCE_PX = 2

const RESOURCE_ORDER: [number, string, string][] = [
  [0, '燃', '燃料'],
  [1, '弹', '弹药'],
  [2, '钢', '钢材'],
  [3, '铝', '铝土'],
  [5, '桶', '高速修复材'],
  [4, '建', '高速建造材'],
  [6, '开', '开发资材'],
  [7, '螺', '改修资材'],
]

let host: HTMLElement | null = null
let currentBgm: KcsBgmCue | null = null
let foldPopoverEl: HTMLElement | null = null
let foldPopoverGroup: HeaderFoldGroup | null = null
let foldHideTimer: ReturnType<typeof setTimeout> | null = null

interface BgmBroadcaster {
  currentBgm?: KcsBgmCue | null
  addListener: (
    event: 'kancolle.bgm',
    listener: (cue: KcsBgmCue | null) => void,
  ) => unknown
}

const fitHeader = () => {
  if (!host) return
  host.classList.remove('compact', 'folded')
  const regular = { scrollWidth: host.scrollWidth, clientWidth: host.clientWidth }
  if (headerFitStage(regular, regular, HEADER_FIT_TOLERANCE_PX) === 'fit') {
    refreshFoldPopover()
    return
  }
  host.classList.add('compact')
  void host.offsetWidth
  const compact = { scrollWidth: host.scrollWidth, clientWidth: host.clientWidth }
  if (headerFitStage(regular, compact, HEADER_FIT_TOLERANCE_PX) === 'folded') {
    host.classList.add('folded')
  }
  refreshFoldPopover()
}

const fmtShort = (value: number) =>
  value >= 100000
    ? `${Math.round(value / 1000)}k`
    : value >= 10000
      ? `${(value / 1000).toFixed(1)}k`
      : value.toLocaleString()

const bgmHtml = () => {
  // 槽位常驻（2026-08-16 用户定的）：没在播放也占着位置，
  // 音乐响起时顶栏不再整条右移。空闲态波形不动、整块压暗。
  if (!currentBgm) {
    return `<span class="hs-bgm idle" title="当前未识别游戏 BGM">
      <i aria-hidden="true"><b></b><b></b><b></b></i>
      <span>未在播放</span><strong></strong>
    </span>`
  }
  const name =
    bgmNameOf(currentBgm.kind, currentBgm.id) ??
    `${currentBgm.kind === 'port' ? '母港' : '战斗'} BGM #${`${currentBgm.id}`.padStart(3, '0')}`
  return `<span class="hs-bgm" title="${esc(`正在播放 · ${name}`)}">
    <i aria-hidden="true"><b></b><b></b><b></b></i>
    <span>正在播放</span><strong>${esc(name)}</strong>
  </span>`
}

const RESOURCE_GLOW_CLASSES = ['glow-up', 'glow-down', 'leaving'] as const

const syncResourceGlow = () => {
  if (!host) return
  const cues = materialCues()
  host.querySelectorAll<HTMLElement>('.hs-res[data-resource]').forEach((resource) => {
    const cue = cues.get(Number(resource.dataset.resource))
    const target = cue
      ? [`glow-${cue.delta > 0 ? 'up' : 'down'}`, ...(cue.phase === 'leaving' ? ['leaving'] : [])]
      : []
    const current = RESOURCE_GLOW_CLASSES.filter((className) => resource.classList.contains(className))
    if (current.length === target.length && current.every((className) => target.includes(className))) return
    resource.classList.remove(...RESOURCE_GLOW_CLASSES)
    if (cue) {
      resource.style.setProperty('--glow-elapsed', `${Math.max(0, Date.now() - cue.phaseAt)}ms`)
      resource.classList.add(...target)
    } else {
      resource.style.removeProperty('--glow-elapsed')
    }
  })
}

const resourcesHtml = () => {
  if (!mg.materials) return '<span class="hs-muted">资源尚未同步</span>'
  return RESOURCE_ORDER.map(([idx, label, name]) => {
    const value = mg.materials![idx] ?? 0
    const state = idx === 7 && value < 50 ? ' bad' : idx === 5 && value >= 2700 ? ' warn' : ''
    return `<span class="hs-res${state}" data-resource="${idx}" title="${name} · 点击查看资源统计">
      ${materialIconHtml(MATERIAL_ICON_BY_INDEX[idx], { className: 'xs', title: label })}
      <b>${fmtShort(value)}</b>
    </span>`
  }).join('')
}

const capacityHtml = () => {
  const basic = mg.basic
  if (!basic) return ''
  const shipCount = Object.keys(mg.ships).length
  const equipCount = countCapacitySlotitems(mg.slotitems)
  const rows: string[] = []
  if (basic.maxShips > 0) {
    const remain = Math.max(0, basic.maxShips - shipCount)
    rows.push(`<span class="hs-cap${remain <= 5 ? ' bad' : remain <= 10 ? ' warn' : ''}"
      data-capacity="ship" title="舰娘仓库 ${shipCount}/${basic.maxShips} · 剩余 ${remain} · 点击打开清理视图">
      <i>舰</i><b>${shipCount}/${basic.maxShips}</b>
    </span>`)
  }
  if (basic.maxSlotitems > 0) {
    const remain = Math.max(0, basic.maxSlotitems - equipCount)
    rows.push(`<span class="hs-cap${remain <= 10 ? ' bad' : remain <= 20 ? ' warn' : ''}"
      data-capacity="equip" title="装备仓库 ${equipCount}/${basic.maxSlotitems} · 剩余 ${remain} · 点击打开装备仓库清理视图">
      <i>装</i><b>${equipCount}/${basic.maxSlotitems}</b>
    </span>`)
  }
  return rows.length ? `<span class="hs-group capacity"><span class="hs-label">库</span>${rows.join('')}</span>` : ''
}

type HeaderFoldGroup = 'expedition' | 'dock' | 'build'

const HEADER_FOLD_CHIP_CLASS: Record<HeaderFoldGroup, string> = {
  expedition: 'exp',
  dock: 'dock',
  build: 'build',
}

const foldGroupHtml = (
  group: HeaderFoldGroup,
  label: string,
  title: string,
  detailHtml: string,
) => `<span class="hs-group" data-group="${group}">
  <span class="hs-label">${label}</span>
  <span class="hs-chip hs-fold-chip ${HEADER_FOLD_CHIP_CLASS[group]}" data-group="${group}"
    title="${esc(title)}">${label}</span>
  <span class="hs-group-detail">${detailHtml}</span>
</span>`

const foldGroupDetailHtml = (group: HTMLElement): string =>
  group.querySelector<HTMLElement>('.hs-group-detail')!.innerHTML

// 远征芯片三态（2026-08-21 用户拍板：「在外一个颜色，归来一个颜色，未补给一个颜色」）。
// 优先级自上而下，互斥：
//   ① mission 进行中（倒计时未到）      → away        在外
//   ② mission 到点未收（倒计时已归零）  → back        归来，等着去港口收
//   ③ 无 mission 且队里有舰未补给       → unsupplied  未补给，派下一轮前得先补
//   ④ 无 mission 且补给满               → idle        中性
//
// 纯函数，不读 mg、不读时钟：「归来」要跟着倒计时逐拍翻，判定必须能拿任意 now 反复问。
// 判据取 `now >= returnAt`，与 fmtCountdownShort 的 `remain <= 0` 是同一刻——
// 文字翻成「返港」和边框翻成金色必须是同一拍，不能一个先一个后。
// 不用 api_mission[0]===2（帰投）：那一位要等游戏刷新母港才下发，而芯片自己的
// 倒计时早就到点了；以我们看得见的那个数为准。
//
// 联合编成的第 2 舰队**不走这四态**，在 expeditionsHtml 里先一步摘出去（见那处注释）。
// 这个函数保持三参、保持纯：它是逐拍 syncExpeditionChipStates 与全量渲染共用的那一份，
// 而「联合」既不看时钟也不看倒计时，塞进来只会让两条路都多背一个不用的参数。
type ExpeditionChipState = 'away' | 'back' | 'unsupplied' | 'idle'

const expeditionChipState = (
  returnAt: number, // 0 = 没在远征
  unsupplied: boolean,
  now: number,
): ExpeditionChipState =>
  returnAt > 0 ? (now >= returnAt ? 'back' : 'away') : unsupplied ? 'unsupplied' : 'idle'

const EXP_CHIP_CLASS: Record<ExpeditionChipState, string> = {
  away: ' on',
  back: ' on back',
  unsupplied: ' unsupplied',
  idle: '',
}

const expeditionsHtml = () => {
  if (!mg.decks.length) return '<span class="hs-muted">尚未同步</span>'
  const now = Date.now()
  return [2, 3, 4]
    .map((id) => {
      const deck = mg.decks.find((entry) => entry.id === id)
      if (!deck) return ''
      const { canonical } = fleetLabel(deck)
      // 联合第 2 舰队先摘出去：她的 mission 恒为 0，落到远征分支只会被判成空闲。
      // 自己具名出击的队同样要先判，最后才看远征位与空闲态。
      const escort = combinedEscortState(id)
      if (escort) {
        // 出击中沿用远征「在外」那一枚（--dock 边框 + 同色队号）：都是「这支队在外面」，
        // 不新造颜色。编队中留中性底，未补给仍翻警示色——随队出击回来没补给照样要提示。
        const unsupplied = escort === 'formed' && fleetHasUnsupplied(deck)
        return `<span class="hs-chip exp combined${
          escort === 'sortie' ? ' on' : unsupplied ? ' unsupplied' : ''
        }" data-fleet="${id}"
          title="${esc(
            `${canonical} · ${
              escort === 'sortie' ? '随联合舰队出击中' : '已编入联合舰队'
            }${unsupplied ? ' · 队内有舰未补给' : ''} · 点击查看舰队`,
          )}">
          <i>${id}</i><em>${escort === 'sortie' ? '出击中' : '编队中'}</em>
        </span>`
      }
      if (deckOnSortie(id)) {
        return `<span class="hs-chip exp on sortie" data-fleet="${id}"
          title="${esc(`${canonical} · 出击中 · 点击查看舰队`)}">
          <i>${id}</i><em>出击中</em>
        </span>`
      }
      if (deck.mission?.[0] > 0) {
        const mission = mg.master.missions[deck.mission[1]]
        const missionName = mission
          ? entityNamePlain('expedition', mission.dispNo, mission.name)
          : `远征 ${deck.mission[1]}`
        const state = expeditionChipState(deck.mission[2], false, now)
        return `<span class="hs-chip exp${EXP_CHIP_CLASS[state]}" data-fleet="${id}" data-timer="mission:${id}"
          title="${esc(`${canonical} · ${missionName}${state === 'back' ? ' · 已返港 · 前往港口领取' : ''} · 点击查看舰队`)}">
          <i>${id}</i><b data-cds="${deck.mission[2]}" data-cds-done="返港">${fmtCountdownShort(deck.mission[2], '返港')}</b>
        </span>`
      }
      // 未补给判定引锐的单一出处（编队抬头「补给满 / 未补给 N」同一份）。
      const state = expeditionChipState(0, fleetHasUnsupplied(deck), now)
      return `<span class="hs-chip exp${EXP_CHIP_CLASS[state]}" data-fleet="${id}"
        title="${esc(`${canonical}待命${state === 'unsupplied' ? ' · 队内有舰未补给' : ''} · 点击查看舰队`)}">
        <i>${id}</i><em>空闲</em>
      </span>`
    })
    .join('')
}

// 「在外 → 归来」发生在倒计时归零那一刻，不是下一次 mg 变更——所以边框色跟着 tick 翻，
// 与 updateCountdowns 把文字改成「返港」同一拍、同一个判据。
// 轻量路径：只 toggle 一个 class，不重生成 HTML、不碰输出闸门的记忆
// （闸门记的是「上次生成的字符串」，这里根本没生成新字符串；而一旦真到点，
// 下一次全量渲染产出的串必然不同——文字已经是「返港」——不会被误判成没变）。
const syncExpeditionChipStates = (root: HTMLElement) => {
  const now = Date.now()
  // 只有带倒计时的芯片才有「在外 / 归来」可翻。
  root.querySelectorAll<HTMLElement>('.hs-chip.exp.on:has([data-cds])').forEach((chip) => {
    const raw = chip.querySelector<HTMLElement>('[data-cds]')?.dataset.cds
    const state = expeditionChipState(raw ? parseInt(raw, 10) : 0, false, now)
    chip.classList.toggle('back', state === 'back')
  })
}

const docksHtml = () => {
  if (!mg.ndocks.length) return '<span class="hs-muted">尚未同步</span>'
  const used = mg.ndocks.filter((dock) => dock.shipId > 0)
  const total = mg.ndocks.length
  const rows = used
    .map((dock) => {
      const ship = mg.ships[dock.shipId]
      const name = ship
        ? entityNamePlain('ship', ship.shipId, masterShipName(ship.shipId))
        : `舰娘 #${dock.shipId}`
      // 看到倒计时的下一个问题就是「修的是谁、伤多重」——所以芯片指向在修的那艘舰
      // （2026-08-21 用户定的）。此前点击走 data-timer 自指：定位到芯片自己再闪一下，
      // 一个字的新信息都没有。
      //
      // etype 用 'ship' 而不是 'mstShip'：前者是在籍实例级（rosterId，qa.ts 那条路由），
      // 后者是图鉴级（mstId）。dock.shipId 正是 rosterId，要看的也正是「这一艘的伤势」。
      // 形态与建造坞芯片一致——直接写 `.el` + data-etype/data-eid，不走 elinkHtml
      // （理由见下面那段：class 属性会重复）。悬停预览卡随之免费得到。
      //
      // data-timer 必须留着：它是「计时引用 → 顶栏落点」这条定位路径的锚
      // （registerEntityRoute('timer') → focusHeaderTimer 靠 `[data-timer="ndock:N"]` 查找 + pulse）。
      // 改的只是「点这枚芯片本身」的行为，不是把锚拆掉。两者并存时的点击分流
      // 见 initHeaderStatus 里 data-timer 分支前的那道闸门。
      //
      // 查不到这艘舰（主数据未到位 / 账本里没有该 rosterId）就退回没有链接的普通芯片：
      // 名字降级成 `舰娘 #id`，也不许诺点击能看到谁。
      return `<span class="${ship ? 'el ' : ''}hs-chip dock on"${
        ship ? ` data-etype="ship" data-eid="${dock.shipId}"` : ''
      } data-timer="ndock:${dock.id}"
        title="${esc(`第${dock.id}渠 · ${name}${ship ? ' · 点击查看舰娘' : ''}`)}">
        <i>${dock.id}</i><b data-cds="${dock.completeTime}">${fmtCountdownShort(dock.completeTime)}</b>
      </span>`
    })
    .join('')
  return `<span class="hs-count" title="入渠使用数">${used.length}/${total}</span>${
    rows || '<span class="hs-chip dock"><em>空闲</em></span>'
  }`
}

// 建造坞。此前它在界面上**完全没有入口**：只有一条完成通知，
// 连 timerInfo 里那条 kdock 分支都是死的（没有任何地方产生 `kdock:` 的计时引用）。
// 与入渠同一形态摆在旁边，那条定位路径也就跟着活了。
//
// state：-1 锁 / 0 空 / 2 建造中 / 3 完成待领。
// 完成待领与建造中要分得开——「3」是可以去拿了，「2」还得等。
// recipeFuel 是投入的燃料（api_item1）。大型/通常的判据与铭里算高速建造材消耗的那处
// 同一条阈值（store.ts：> 1000 收 10 个否则 1 个），两处不能各用一个数。
const isLargeBuild = (dock: (typeof mg)['kdocks'][number]) => dock.recipeFuel > 1000

const buildDocksHtml = () => {
  const open = mg.kdocks.filter((dock) => dock.state >= 0)
  if (!open.length) return ''
  const busy = open.filter((dock) => dock.state === 2)
  const ready = open.filter((dock) => dock.state === 3)
  // 芯片本身就做成 EntityLink：peek 只认 `.el` + data-etype/data-eid（见 link.ts 的
  // mouseover 用 closest('.el')）。不走 elinkHtml 是因为它自己会写一个 class，
  // 再从 attrs 传第二个 class 会变成重复属性——后一个被浏览器丢掉，芯片样式就全没了。
  const chip = (dock: (typeof open)[number], cls: string, body: string, timer = false) =>
    `<span class="el hs-chip build ${cls}" data-etype="kdock" data-eid="${dock.id}"${
      timer ? ` data-timer="kdock:${dock.id}"` : ''
    }>${body}</span>`
  const rows = [
    // 芯片本体默认写「待领」——扫一眼抬头不该被剧透；选状态词不选动作词
    // （全应用金色语汇就是「待领取」，与任务芯片同一套话）。
    // 钥的剧透开关打开时例外（2026-08-12 用户定的）：换成所造舰娘名字的
    // 头两个字（2026-08-16 空闲态改两字宽后跟进），四个坞各造出了谁一眼分清；
    // 单字名（雪/電）就只有一个字。全名和头像仍在预览卡里。
    ...ready.map((dock) => {
      const spoiledChar =
        isBuildSpoilerEnabled() && dock.createdShipId > 0
          ? [...entityNamePlain('ship', dock.createdShipId, masterShipName(dock.createdShipId))]
              .slice(0, 2)
              .join('')
          : ''
      return chip(dock, 'ready', `<i>${dock.id}</i><b>${esc(spoiledChar || '待领')}</b>`)
    }),
    ...busy.map((dock) =>
      chip(
        dock,
        'on',
        `<i>${dock.id}</i><b data-cds="${dock.completeTime}">${fmtCountdownShort(dock.completeTime)}</b>`,
        true,
      ),
    ),
  ].join('')
  return foldGroupHtml(
    'build',
    '建',
    '建造 · 悬停展开',
    `<span class="hs-count" title="建造坞使用数">${busy.length + ready.length}/${open.length}</span>${
      rows || '<span class="hs-chip build"><em>空闲</em></span>'
    }`,
  )
}

// 建造坞预览卡。抬头那格只放得下一个数字，真正有用的几件事都在这里：
// 大型还是通常、什么时候好、现在抢完要几个高速建造材、还剩几个空坞。
registerEntityRoute('kdock', {
  colorClass: 'e-timer',
  open() {
    // 只读：建造在游戏里点。这里给个落点，免得点了毫无反应——
    // 工厂履历是本地能提供的最相关视图。
    activateModule('shi')
  },
  peek(ref) {
    const dock = mg.kdocks.find((entry) => entry.id === ref.num)
    if (!dock || dock.state < 0) return null
    const open = mg.kdocks.filter((entry) => entry.state >= 0)
    const idle = open.filter((entry) => entry.state === 0).length
    const large = isLargeBuild(dock)
    // 开了钥的「提前显示建造结果」才剧透；默认名字与头像都不出现。
    // 建造中与完成待领一视同仁——开关开着就是要看造的是谁
    //（2026-08-12 用户定的形态：剧透收在预览卡里，带舰娘小头像，不上游戏画面）。
    const spoiled = isBuildSpoilerEnabled() && dock.state >= 2 && dock.createdShipId > 0
    const spoiledName = spoiled
      ? entityNamePlain('ship', dock.createdShipId, masterShipName(dock.createdShipId))
      : ''
    const lines: string[] = []
    if (dock.state === 3) {
      lines.push(`${large ? '大型建造' : '通常建造'} · <b>完成待领</b>`)
      if (spoiled) lines.push(`结果 ${spoiledName}`)
    } else if (dock.state === 2) {
      lines.push(`${large ? '大型建造' : '通常建造'} · 建造中`)
      if (spoiled) lines.push(`结果 ${spoiledName}`)
      lines.push(
        `剩余 <b data-cds="${dock.completeTime}">${fmtCountdownShort(dock.completeTime)}</b> · 完成 ${fmtTime(dock.completeTime)}`,
      )
      // 现在抢完要几个高速建造材：与铭扣材料时用的是同一条阈值
      lines.push(`抢完需高速建造材 ×${large ? 10 : 1}`)
    } else {
      lines.push('空闲')
    }
    lines.push(`${open.length} 坞中 ${idle} 空`)
    return {
      title: `建造坞 ${dock.id}`,
      typeLabel: '建造',
      media: spoiled ? shipThumbHtml(dock.createdShipId, spoiledName, { className: 'preview' }) : undefined,
      lines,
      primary: '工厂履历',
    }
  },
  targets: () => [{ label: '工厂履历 · 回顾', run: () => activateModule('shi') }],
})

const practiceInfo = () => {
  const snapshot = mg.practice
  if (!snapshot) return null
  const reset = nextJstTime([3, 15])
  const fresh = snapshot.ts > reset - 12 * 3600000
  const total = snapshot.list.length
  const done = snapshot.list.filter((entry) => entry.state !== 0).length
  return { snapshot, reset, fresh, total, done, remain: Math.max(0, total - done) }
}

type PracticeEntry = NonNullable<(typeof mg)['practice']>['list'][number]

const practiceOpponentText = (entry: PracticeEntry): string => {
  const detail: string[] = []
  if (entry.rank) detail.push(entry.rank)
  if (typeof entry.level === 'number') detail.push(`Lv${entry.level}`)
  const flag = typeof entry.flagShipId === 'number'
    ? ` · 旗舰 ${masterShipName(entry.flagShipId)}`
    : ''
  return `${entry.state === 0 ? '○' : '✓'} ${entry.name}${detail.length ? ` ${detail.join(' ')}` : ''}${flag}`
}

const practiceOpponentHtml = (entry: PracticeEntry): string => {
  const detail: string[] = []
  if (entry.rank) detail.push(esc(entry.rank))
  if (typeof entry.level === 'number') detail.push(`Lv${entry.level}`)
  const flag = typeof entry.flagShipId === 'number'
    ? ` · 旗舰 ${elink('mstShip', entry.flagShipId, masterShipName(entry.flagShipId))}`
    : ''
  return `${entry.state === 0 ? '○' : '✓'} ${esc(entry.name)}${detail.length ? ` ${detail.join(' ')}` : ''}${flag}`
}

const practiceHtml = () => {
  const info = practiceInfo()
  if (!info) return ''
  const opponents = info.snapshot.list
    .map(practiceOpponentText)
    .join('\n')
  return `<span class="hs-group"><span class="hs-label">演</span>
    <span class="hs-chip practice${info.fresh ? (info.remain ? ' pending' : ' done') : ' stale'}"
      data-practice="current" data-timer="practice:current"
      title="${esc(`${info.fresh ? `未打 ${info.remain}/${info.total}` : '记录已过期'} · ${fmtTime(info.snapshot.ts)} 同步\n${opponents}\n点击查看演习提醒`)}">
      <i>演</i><b>${info.fresh ? `${info.remain}/${info.total}` : '旧'}</b>
      <em data-cds="${info.reset}" data-cds-done="已刷新">${fmtCountdownShort(info.reset, '已刷新')}</em>
    </span>
  </span>`
}

const syncFoldChipStates = () => {
  if (!host) return
  for (const group of host.querySelectorAll<HTMLElement>('.hs-group[data-group]')) {
    const fold = group.querySelector<HTMLElement>(':scope > .hs-fold-chip')!
    const detail = group.querySelector<HTMLElement>(':scope > .hs-group-detail')!
    const kind = group.dataset.group as HeaderFoldGroup
    const active =
      kind === 'expedition'
        ? !!detail.querySelector('.hs-chip.exp.on')
        : kind === 'dock'
          ? !!detail.querySelector('.hs-chip.dock.on')
          : !!detail.querySelector('.hs-chip.build.on')
    fold.classList.toggle('on', active)
    fold.classList.toggle('back', kind === 'expedition' && !!detail.querySelector('.hs-chip.exp.on.back'))
  }
}

function cancelFoldHide() {
  if (!foldHideTimer) return
  clearTimeout(foldHideTimer)
  foldHideTimer = null
}

function closeFoldPopover() {
  cancelFoldHide()
  foldPopoverEl?.remove()
  foldPopoverEl = null
  foldPopoverGroup = null
}

function scheduleFoldHide() {
  cancelFoldHide()
  foldHideTimer = setTimeout(closeFoldPopover, 150)
}

function placeFoldPopover(groupName: HeaderFoldGroup) {
  if (!host?.classList.contains('folded')) {
    closeFoldPopover()
    return
  }
  const anchor = host.querySelector<HTMLElement>(`.hs-fold-chip[data-group="${groupName}"]`)
  const group = anchor?.closest<HTMLElement>('.hs-group[data-group]')
  if (!anchor || !group) {
    closeFoldPopover()
    return
  }
  if (!foldPopoverEl) {
    foldPopoverEl = document.createElement('div')
    foldPopoverEl.className = 'header-fold-pop'
    foldPopoverEl.addEventListener('mouseenter', cancelFoldHide)
    foldPopoverEl.addEventListener('mouseleave', scheduleFoldHide)
    foldPopoverEl.addEventListener('click', (event) => handleHeaderClick(event.target as HTMLElement))
    document.body.appendChild(foldPopoverEl)
  }
  foldPopoverGroup = groupName
  foldPopoverEl.dataset.group = groupName
  foldPopoverEl.style.visibility = 'hidden'
  foldPopoverEl.innerHTML = foldGroupDetailHtml(group)
  const rect = anchor.getBoundingClientRect()
  const width = foldPopoverEl.offsetWidth
  const height = foldPopoverEl.offsetHeight
  let left = rect.left
  let top = rect.bottom + 6
  if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8
  if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 6)
  foldPopoverEl.style.left = `${Math.max(8, left)}px`
  foldPopoverEl.style.top = `${Math.max(8, top)}px`
  foldPopoverEl.style.visibility = 'visible'
}

function refreshFoldPopover() {
  if (foldPopoverGroup) placeFoldPopover(foldPopoverGroup)
}

const render = () => {
  if (!host) return
  const player = mg.basic
    ? `<span class="hs-player" title="当前提督"><b>${esc(mg.basic.nickname)}</b><em>Lv ${mg.basic.level}</em></span>`
    : '<span class="hs-player muted">尚未登录</span>'
  // 输出没变就整段不动 DOM（口径见 kernel commitPaneHtml）。顶栏是被动重渲最勤的一块
  // （basic/materials/decks/ndocks/ships/slotitems 任一变化都重建），
  // 而它上面全是可点的角标——按下与抬起之间换掉 DOM，那一次点击就不会发生。
  const changed = applyPaneHtml(host, 'header-status', `${bgmHtml()}${player}
    <span class="hs-group resources">${resourcesHtml()}</span>
    ${foldGroupHtml('expedition', '远', '远征 · 悬停展开', expeditionsHtml())}
    ${foldGroupHtml('dock', '渠', '入渠 · 悬停展开', docksHtml())}
    ${buildDocksHtml()}
    ${practiceHtml()}
    ${capacityHtml()}`)
  if (changed) fitHeader()
  syncResourceGlow()
  syncFoldChipStates()
}

const focusHeaderTimer = (raw: string) => {
  if (!host) return
  const target = host.querySelector<HTMLElement>(`[data-timer="${CSS.escape(raw)}"]`) ?? host
  target.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  target.classList.remove('pulse')
  requestAnimationFrame(() => target.classList.add('pulse'))
  setTimeout(() => target.classList.remove('pulse'), 2200)
}

const focusHeaderPractice = () => {
  focusHeaderTimer('practice:current')
}

function handleHeaderClick(target: HTMLElement) {
  const folded = target.closest<HTMLElement>('.hs-fold-chip[data-group]')
  if (folded) {
    const group = folded.dataset.group as HeaderFoldGroup
    closeFoldPopover()
    activateModule(group === 'expedition' ? 'bi' : group === 'dock' ? 'ji' : 'shi')
    return
  }
  const resource = target.closest<HTMLElement>('[data-resource]')
  if (resource) {
    navigate({ type: 'material', id: parseInt(resource.dataset.resource!, 10) })
    return
  }
  const capacity = target.closest<HTMLElement>('[data-capacity]')
  if (capacity) {
    navigate({
      type: capacity.dataset.capacity === 'ship' ? 'shipCapacity' : 'equipCapacity',
      id: 'current',
    })
    return
  }
  const fleet = target.closest<HTMLElement>('[data-fleet]')
  if (fleet) {
    navigate({ type: 'fleet', id: parseInt(fleet.dataset.fleet!, 10) })
    return
  }
  const practice = target.closest<HTMLElement>('[data-practice]')
  if (practice) {
    focusHeaderPractice()
    openNotifyRule('pracRefresh')
    return
  }
  // timer 自指是**最低优先级**的落点：芯片只要还有实体身份（`.el`），点击就归实体路由。
  //
  // 这道闸门非有不可，因为两条监听都会收到同一次点击：全局 EntityLink 的点击挂在
  // document 上，而这一条挂在 #header-status。冒泡由内向外——header 先吃到，
  // 于是不拦就是两条**都**跑：先把芯片自己闪一遍（focusHeaderTimer 自指），
  // 再打开实体视图。建造中的建造坞芯片（.el + data-timer 并存）此前正是如此，
  // 只是自指那一下发生在已经要跳走的芯片上，不显眼所以没被发现；入渠芯片改成
  // 实体链接后会撞上同一处，索性一并理顺，两种芯片共用这一条规则。
  //
  // 反向做法（在这里 stopPropagation 让 header 独吞）不行：link.ts 的 document 点击
  // 还兼着「点别处收起右键菜单」，掐掉冒泡会把那个收口一起掐了。
  if (target.closest('.el')) return
  const timer = target.closest<HTMLElement>('[data-timer]')
  if (timer) navigate({ type: 'timer', id: timer.dataset.timer! })
}

export const initHeaderStatus = (broadcaster?: BgmBroadcaster) => {
  host = document.querySelector<HTMLElement>('#header-status')
  if (!host) return
  currentBgm = broadcaster?.currentBgm ?? null
  // 曲名表到位后顶栏那一格要自己补上（拉取先于第一次播放时是无声的）
  ensureBgmNames(render)
  broadcaster?.addListener('kancolle.bgm', (cue) => {
    currentBgm = cue
    render()
  })
  new ResizeObserver(fitHeader).observe(host.closest('header')!)
  host.addEventListener('click', (event) => handleHeaderClick(event.target as HTMLElement))
  host.addEventListener('mouseover', (event) => {
    const folded = (event.target as HTMLElement).closest<HTMLElement>('.hs-fold-chip[data-group]')
    if (!folded) return
    cancelFoldHide()
    placeFoldPopover(folded.dataset.group as HeaderFoldGroup)
  })
  host.addEventListener('mouseout', (event) => {
    const folded = (event.target as HTMLElement).closest<HTMLElement>('.hs-fold-chip[data-group]')
    if (!folded || folded.contains(event.relatedTarget as Node | null)) return
    scheduleFoldHide()
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && foldPopoverEl) closeFoldPopover()
  })
  onMgChange((keys) => {
    if (keys.some((key) => ['basic', 'materials', 'decks', 'ndocks', 'kdocks', 'ships', 'slotitems', 'master', 'practice', 'sortie'].includes(key))) {
      render()
    }
  })
  onMaterialCueChange(syncResourceGlow)
  onTick(() => {
    updateCountdowns(host!)
    syncExpeditionChipStates(host!)
    if (foldPopoverEl) {
      updateCountdowns(foldPopoverEl)
      syncExpeditionChipStates(foldPopoverEl)
    }
    syncFoldChipStates()
  })
  render()
}

registerEntityRoute('practice', {
  colorClass: 'e-practice',
  open() {
    focusHeaderPractice()
  },
  peek() {
    const info = practiceInfo()
    if (!info) return null
    return {
      title: info.fresh ? `演习未完成 ${info.remain}/${info.total}` : '演习记录已过期',
      typeLabel: '演习状态',
      lines: [
        `刷新倒计时 <b>${fmtCountdown(info.reset)}</b>`,
        `同步于 ${fmtTime(info.snapshot.ts)}`,
        ...info.snapshot.list.slice(0, 5).map(practiceOpponentHtml),
      ],
      primary: '游戏抬头',
    }
  },
  targets: () => [{ label: '通知规则 · 演习提醒', run: () => openNotifyRule('pracRefresh') }],
})

const TIMER_EVENT: Record<string, string> = {
  ndock: 'dock',
  mission: 'expedition',
  kdock: 'build',
  reset: 'questReset',
}

const parseTimerRef = (raw: string | number): [kind: string, key: string] => {
  const [kind, key] = `${raw}`.split(':')
  return [kind ?? '', key ?? '']
}

const timerInfo = (
  kind: string,
  key: string,
): { ts: number; title: string; detail: string } | null => {
  if (kind === 'ndock') {
    const dock = mg.ndocks.find((entry) => entry.id === +key && entry.shipId > 0)
    if (!dock) return null
    const ship = mg.ships[dock.shipId]
    return {
      ts: dock.completeTime,
      title: `第${dock.id}渠 · ${
        ship
          ? entityNamePlain('ship', ship.shipId, masterShipName(ship.shipId))
          : `#${dock.shipId}`
      }`,
      detail: '入渠完成',
    }
  }
  if (kind === 'mission') {
    const deck = mg.decks.find((entry) => entry.id === +key && entry.mission?.[0] > 0)
    if (!deck) return null
    const mission = mg.master.missions[deck.mission[1]]
    return {
      ts: deck.mission[2],
      title: `远征 ${mission?.dispNo ?? deck.mission[1]}${
        mission
          ? ` · ${entityNamePlain('expedition', mission.dispNo, mission.name)}`
          : ''
      }`,
      detail: `第${deck.id}舰队返港`,
    }
  }
  if (kind === 'kdock') {
    const dock = mg.kdocks.find((entry) => entry.id === +key && entry.state === 2)
    if (!dock) return null
    return { ts: dock.completeTime, title: `建造坞 ${dock.id}`, detail: '建造完成' }
  }
  if (kind === 'reset') {
    const reset =
      key === 'weekly'
        ? nextWeeklyReset()
        : key === 'monthly'
          ? nextMonthlyReset()
          : nextJstTime([5])
    return {
      ts: reset,
      title: key === 'weekly' ? '周任重置' : key === 'monthly' ? '月任重置' : '日任重置',
      detail:
        key === 'weekly'
          ? '每周一 JST 05:00 重置'
          : key === 'monthly'
            ? '每月一日 JST 05:00 重置'
            : '每天 JST 05:00 重置',
    }
  }
  return null
}

registerEntityRoute('timer', {
  colorClass: 'e-timer',
  open(ref) {
    const [kind, key] = parseTimerRef(ref.id)
    if (kind === 'reset') activateModule('qn')
    else focusHeaderTimer(`${kind}:${key}`)
  },
  peek(ref) {
    const [kind, key] = parseTimerRef(ref.id)
    const info = timerInfo(kind, key)
    if (!info) return null
    return {
      title: info.title,
      typeLabel: '倒计时',
      lines: [
        `剩余 <b style="font-family:var(--mono)">${fmtCountdown(info.ts)}</b>`,
        `${info.detail} · ${fmtTime(info.ts)}`,
      ],
      primary: kind === 'reset' ? '任务面板' : '游戏抬头',
    }
  },
  targets(ref) {
    const [kind] = parseTimerRef(ref.id)
    const eventId = TIMER_EVENT[kind]
    return eventId
      ? [{ label: '通知规则 · 为该倒计时设提醒', run: () => openNotifyRule(eventId) }]
      : [{ label: '通知规则', disabled: true, hint: '该倒计时无对应通知事件' }]
  },
})
