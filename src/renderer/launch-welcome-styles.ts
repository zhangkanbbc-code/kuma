// 第零幕可选风格渲染（科技控制台 / 二次元 OP / 交互式机甲舱门）。
// 全部 DOM/SVG 均由节点工厂构造，文本只写 textContent，动画仅动 opacity / transform 且时长全部来自 shared/launch-glow.ts。
// 预览设计基准为 1020×574（16:9）：背景层铺满视口，HUD 层与铭牌置于居中的 .kw-st-stage 按 min(vw/1020, vh/574) 等比缩放。
import {
  LAUNCH_MECH_TIMING as MT,
  LAUNCH_STYLE_TIMING as ST,
  type LaunchWelcomeSignal,
} from '../shared/launch-glow'
import { ADMIRAL_RANK_LABELS, type WelcomeBriefCache } from '../shared/launch-welcome-brief'
import {
  isAnimeWelcomeStyle,
  isCicWelcomeStyle,
  type CustomWelcomeStyle,
} from '../shared/launch-welcome-style'

const SVG_NS = 'http://www.w3.org/2000/svg'
const DESIGN_W = 1020
const DESIGN_H = 574
const RESOURCE_CAP = 350000
const RESOURCE_LOW = 50000
const SHIP_FREE_WARN = 5

type CssMap = Record<string, string | number>

export interface WelcomeStyleMount {
  syncPlate(): void
  noteSignal(signal: LaunchWelcomeSignal, allReady: boolean): void
  setNudge?(line: string): void
  beginOpen?(calm: boolean): void
  dispose(): void
}

const el = (parent: HTMLElement, tag: string, className = '', text?: string): HTMLElement => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  parent.appendChild(node)
  return node
}

const div = (parent: HTMLElement, className = '', text?: string): HTMLElement =>
  el(parent, 'div', className, text)

const span = (parent: HTMLElement, className = '', text?: string): HTMLElement =>
  el(parent, 'span', className, text)

const bold = (parent: HTMLElement, className = '', text?: string): HTMLElement =>
  el(parent, 'b', className, text)

const setCss = (node: HTMLElement | SVGElement, map: CssMap) => {
  for (const [key, value] of Object.entries(map)) node.style.setProperty(key, String(value))
}

const anim = (
  node: HTMLElement,
  calm: boolean,
  specs: readonly [name: string, duration: number, delay?: number, easing?: string, repeat?: boolean | 'alternate', fill?: string][],
) => {
  if (calm) return
  node.style.animation = specs
    .map(([name, dur, delay = 0, easing = 'ease', repeat = false, fill = 'both']) => {
      const iter = repeat ? 'infinite' : '1'
      const dir = repeat === 'alternate' ? ' alternate' : ''
      return `kuma-season-${name} ${dur}ms ${easing} ${delay}ms ${iter}${dir} ${fill}`
    })
    .join(', ')
}

const svgNode = (parent: HTMLElement | SVGElement, tag: string, attrs: Record<string, string | number>, className = ''): SVGElement => {
  const node = document.createElementNS(SVG_NS, tag)
  if (className) node.setAttribute('class', className)
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value))
  parent.appendChild(node)
  return node
}

const fmtNum = (n: number): string => Math.max(0, Math.round(n)).toLocaleString('en-US')

const pad2 = (n: number): string => (n < 10 ? `0${n}` : `${n}`)

const fmtClock = (ts: number): string => {
  const d = new Date(ts)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

const fmtDuration = (ms: number): string => {
  const totalMin = Math.max(0, Math.floor(ms / 60000))
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return h > 0 ? `${pad2(h)}h ${pad2(m)}m` : `${pad2(m)}m`
}

const fmtRemain = (ms: number): string => {
  const totalMin = Math.max(1, Math.ceil(ms / 60000))
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return `${pad2(h)}:${pad2(m)}`
}

const fmtAdmiral = (brief: WelcomeBriefCache): string => {
  const parts: string[] = []
  if (brief.admiralLevel != null) parts.push(`Lv.${brief.admiralLevel}`)
  if (brief.admiralRank != null) {
    const rank = ADMIRAL_RANK_LABELS[brief.admiralRank]
    if (rank) parts.push(rank)
  }
  return parts.join(' · ')
}

const RESOURCE_SPECS = [
  { lbl: '燃料', color: 'var(--kw-res-fuel)' },
  { lbl: '弹药', color: 'var(--kw-res-ammo)' },
  { lbl: '钢材', color: 'var(--kw-res-steel)' },
  { lbl: '铝土', color: 'var(--kw-res-baux)' },
] as const

const expeditionRowsOf = (brief: WelcomeBriefCache, now: number) =>
  ([2, 3, 4] as const).map((fleet) => {
    const found = brief.expeditions.find((e) => e.fleet === fleet)
    if (!found) return { label: `${fleet}队`, status: '未派出', tone: 'dim' as const }
    const no = found.missionId > 0 ? ` #${pad2(found.missionId)}` : ''
    if (found.returnAt <= now) return { label: `${fleet}队${no}`, status: '已归港', tone: 'ok' as const }
    return { label: `${fleet}队${no}`, status: `余 ${fmtRemain(found.returnAt - now)}`, tone: 'sub' as const }
  })

const ndockSummaryOf = (brief: WelcomeBriefCache, now: number) => {
  if (!brief.ndocks.length) return { active: '0/4 渠', detail: '全渠空闲', tone: 'sub' as const }
  const first = brief.ndocks.slice().sort((a, b) => a.completeAt - b.completeAt)[0]
  const done = first.completeAt <= now
  const who = first.shipName ? `${first.shipName} ` : `${first.dock}渠 `
  const detail = done ? `${who}已出渠` : `${who}${fmtRemain(first.completeAt - now)}`
  const active = brief.ndocks.length >= 4 ? '4/4 满渠' : `${brief.ndocks.length}/4 渠`
  const tone: 'ok' | 'warn' | 'sub' = done ? 'ok' : brief.ndocks.length >= 4 ? 'warn' : 'sub'
  return { active, detail, tone }
}

const spriteBase = (): string => {
  const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
  return `./assets/launch-welcome-${theme}.svg#`
}

const viewportScale = (): number => {
  const vw = window.innerWidth || DESIGN_W
  const vh = window.innerHeight || DESIGN_H
  return Math.max(0.4, Math.min(vw / DESIGN_W, vh / DESIGN_H))
}

// =========================================================================
// 方案一：科技控制台（CIC 冰青 / 琥珀）
// =========================================================================
const mountCicStyle = (
  layer: HTMLElement,
  box: HTMLElement,
  skip: HTMLElement,
  brief: WelcomeBriefCache | null,
  calm: boolean,
): WelcomeStyleMount => {
  const T = ST.cic
  const now = Date.now()

  // 铺满视口的背景网格层
  const bg = div(layer, 'kw-st-layer kw-cic-layer')
  bg.setAttribute('aria-hidden', 'true')
  layer.insertBefore(bg, box)
  anim(bg, calm, [['st-fade', T.sceneFade, 0, 'ease']])
  div(bg, 'kw-cic-grid')

  // 1020×574 设计基准缩放舞台：雷达、四角、顶栏、左右简报、铭牌与跳过提示同比例缩放
  const stage = div(layer, 'kw-st-stage kw-cic-stage')
  layer.insertBefore(stage, box)

  const hud = div(stage, 'kw-st-layer kw-cic-hud')
  hud.setAttribute('aria-hidden', 'true')
  anim(hud, calm, [['st-fade', T.sceneFade, 0, 'ease']])

  const polar = div(hud, 'kw-cic-polar')
  anim(polar, calm, [['st-polar-boot', T.polarBoot, T.polarAt, 'cubic-bezier(.16,.84,.3,1)']])

  const sweep = div(polar, 'kw-cic-sweep')
  anim(sweep, calm, [
    ['st-fade', T.radarIn, T.radarAt, 'ease', false, 'both'],
    ['st-spin', T.radarSpin, T.radarAt, 'linear', true, 'none'],
  ])

  const ringsSvg = svgNode(polar, 'svg', { viewBox: '0 0 380 380', width: 380, height: 380 }, 'kw-cic-polar-svg')
  svgNode(ringsSvg, 'circle', { cx: 190, cy: 190, r: 165, fill: 'none', 'stroke-width': 1 }, 'kw-cic-ring')
  svgNode(ringsSvg, 'circle', { cx: 190, cy: 190, r: 114, fill: 'none', 'stroke-width': 1, 'stroke-dasharray': '3 5' }, 'kw-cic-ring')
  svgNode(ringsSvg, 'circle', { cx: 190, cy: 190, r: 66, fill: 'none', 'stroke-width': 0.9 }, 'kw-cic-ring')
  svgNode(ringsSvg, 'line', { x1: 190, y1: 8, x2: 190, y2: 372, 'stroke-width': 0.8, 'stroke-dasharray': '4 6' }, 'kw-cic-ring')
  svgNode(ringsSvg, 'line', { x1: 8, y1: 190, x2: 372, y2: 190, 'stroke-width': 0.8, 'stroke-dasharray': '4 6' }, 'kw-cic-ring')

  const ticksWrap = div(polar, 'kw-cic-ticks')
  anim(ticksWrap, calm, [['st-spin-rev', T.ticksSpin, 0, 'linear', true, 'none']])
  const ticksSvg = svgNode(ticksWrap, 'svg', { viewBox: '0 0 380 380', width: 380, height: 380 }, 'kw-cic-polar-svg')
  for (let i = 0; i < 36; i++) {
    const a = i * 10
    const major = i % 3 === 0
    const r1 = major ? 168 : 174
    const r2 = 182
    const rad = (a * Math.PI) / 180
    svgNode(
      ticksSvg,
      'line',
      {
        x1: (190 + Math.cos(rad) * r1).toFixed(1),
        y1: (190 + Math.sin(rad) * r1).toFixed(1),
        x2: (190 + Math.cos(rad) * r2).toFixed(1),
        y2: (190 + Math.sin(rad) * r2).toFixed(1),
        'stroke-width': major ? 1.2 : 0.8,
      },
      major ? 'kw-cic-ring-strong' : 'kw-cic-ring',
    )
  }

  // 仅在有真实快照时画 2F/3F/4F 雷达回波，按真实远征状态着色，绝不编造。
  if (brief) {
    const blipCoords = [
      { left: '69%', top: '27%' },
      { left: '78%', top: '68%' },
      { left: '26%', top: '64%' },
    ]
    const exps = expeditionRowsOf(brief, now)
    exps.forEach((entry, idx) => {
      const blip = div(polar, 'kw-cic-blip')
      blip.dataset.brief = `blip-${idx + 2}`
      const toneColor =
        entry.tone === 'ok' ? 'var(--kw-cic-ok)' : entry.tone === 'dim' ? 'var(--kw-cic-warn)' : 'var(--kw-cic-pri)'
      setCss(blip, { left: blipCoords[idx].left, top: blipCoords[idx].top, '--kw-bc': toneColor })
      const delay = T.blipDelays[idx]
      anim(blip, calm, [['st-blip-ping', T.blipCycle, delay, 'ease-out', true, 'both']])
      const ring = div(blip, 'kw-cic-blip-ring')
      anim(ring, calm, [['st-blip-ring', T.blipCycle, delay, 'ease-out', true, 'both']])
      div(blip, 'kw-cic-blip-core')
      const tagText = entry.tone === 'ok' ? `${idx + 2}F 归港` : entry.tone === 'dim' ? `${idx + 2}F 待命` : `${idx + 2}F 远征`
      span(blip, 'kw-cic-blip-tag kw-mono', tagText)
    })
  }

  const scanUp = div(hud, 'kw-cic-scan kw-cic-scan-up')
  const scanDown = div(hud, 'kw-cic-scan kw-cic-scan-down')
  anim(scanUp, calm, [['st-scan-up', T.scan, T.scanAt, 'cubic-bezier(.2,.72,.28,1)']])
  anim(scanDown, calm, [['st-scan-down', T.scan, T.scanAt, 'cubic-bezier(.2,.72,.28,1)']])

  for (const pos of ['tl', 'tr', 'bl', 'br'] as const) {
    const corner = div(hud, `kw-cic-corner ${pos}`)
    anim(corner, calm, [[`st-corner-${pos}`, T.corner, T.cornerAt, 'cubic-bezier(.18,.84,.3,1)']])
  }

  const topHud = div(hud, 'kw-cic-top kw-mono')
  anim(topHud, calm, [['st-fade', T.topHud, T.topHudAt, 'ease']])
  const leftBrand = span(topHud)
  span(leftBrand, '', 'KUMA // ')
  span(leftBrand, 'kw-cic-hi', 'CIC')
  if (brief) {
    const snapSpan = span(topHud, '', `上次快照 ${fmtClock(brief.savedAt)} · 离线 ${fmtDuration(now - brief.savedAt)}`)
    snapSpan.dataset.brief = 'top'
    const admiralText = fmtAdmiral(brief)
    if (admiralText) {
      const admSpan = span(topHud, '', admiralText)
      admSpan.dataset.brief = 'admiral'
    } else {
      span(topHud, '', 'DATA LINK')
    }
  } else {
    span(topHud, '', 'STANDBY · NO CACHED BRIEF')
  }

  // 仅在有真实快照时渲染左右简报面板；无快照时零 [data-brief] 节点。
  if (brief) {
    const leftSide = div(hud, 'kw-cic-side left')
    leftSide.dataset.brief = 'left'
    anim(leftSide, calm, [['st-panel-in', T.panel, T.panelLeftAt, 'cubic-bezier(.18,.84,.3,1)']])
    const lHead = div(leftSide, 'kw-cic-side-head')
    bold(lHead, '', '资源库存')
    span(lHead, 'kw-mono', 'LAST')

    RESOURCE_SPECS.forEach((spec, idx) => {
      const value = brief.materials[idx]
      const warn = value < RESOURCE_LOW
      const pct = Math.min(1, Math.max(0.06, value / RESOURCE_CAP)).toFixed(3)
      const rowDelay = T.rowBase + idx * T.rowStep
      const row = div(leftSide, 'kw-cic-row')
      anim(row, calm, [['st-row-in', T.row, rowDelay, 'cubic-bezier(.2,.8,.3,1)']])
      const rHead = div(row, 'kw-cic-row-head')
      span(rHead, 'kw-cic-row-lbl', spec.lbl)
      span(rHead, `kw-cic-row-val kw-mono${warn ? ' warn' : ''}`, fmtNum(value))
      const track = div(row, 'kw-cic-bar-track')
      const fill = div(track, 'kw-cic-bar-fill')
      setCss(fill, { '--kw-fill': pct, '--kw-bar-c': warn ? 'var(--kw-cic-warn)' : spec.color })
      anim(fill, calm, [['st-bar-load', T.bar, rowDelay + T.barOffset, 'cubic-bezier(.18,.84,.28,1)']])
    })

    const lFoot = div(leftSide, 'kw-cic-side-foot kw-mono')
    anim(lFoot, calm, [['st-row-in', T.row, T.footAt, 'ease']])
    const bucketWrap = span(lFoot)
    span(bucketWrap, '', '桶 ')
    bold(bucketWrap, '', fmtNum(brief.buckets))
    const shipWrap = span(lFoot)
    span(shipWrap, '', '船位 ')
    const shipWarn = brief.ships[1] > 0 && brief.ships[1] - brief.ships[0] <= SHIP_FREE_WARN
    bold(shipWrap, shipWarn ? 'warn' : '', `${brief.ships[0]}/${brief.ships[1]}`)

    const rightSide = div(hud, 'kw-cic-side right')
    rightSide.dataset.brief = 'right'
    anim(rightSide, calm, [['st-panel-in', T.panel, T.panelRightAt, 'cubic-bezier(.18,.84,.3,1)']])
    const rHead = div(rightSide, 'kw-cic-side-head')
    bold(rHead, '', '母港勤务')
    span(rHead, 'kw-mono', 'CACHED')

    const expGroup = div(rightSide, 'kw-cic-ops-group')
    anim(expGroup, calm, [['st-row-in', T.row, T.opsExpAt, 'cubic-bezier(.2,.8,.3,1)']])
    for (const exp of expeditionRowsOf(brief, now)) {
      const line = div(expGroup, 'kw-cic-ops-line')
      const tag = span(line, 'kw-cic-ops-tag kw-mono')
      const dot = span(tag, 'kw-cic-ops-dot')
      const dotColor =
        exp.tone === 'ok' ? 'var(--kw-cic-ok)' : exp.tone === 'dim' ? 'var(--kw-cic-dim)' : 'var(--kw-cic-pri)'
      setCss(dot, { '--kw-dot-c': dotColor })
      span(tag, '', exp.label)
      if (exp.tone === 'ok') span(line, 'kw-cic-ops-badge', exp.status)
      else span(line, 'kw-mono kw-cic-ops-sub', exp.status)
    }

    const ndock = ndockSummaryOf(brief, now)
    const ndGroup = div(rightSide, 'kw-cic-ops-group kw-cic-ops-sep')
    anim(ndGroup, calm, [['st-row-in', T.row, T.opsNdockAt, 'cubic-bezier(.2,.8,.3,1)']])
    const ndLine1 = div(ndGroup, 'kw-cic-ops-line')
    span(ndLine1, 'kw-cic-row-lbl', '入渠')
    span(ndLine1, `kw-cic-row-val kw-mono ${ndock.tone}`, ndock.active)
    const ndLine2 = div(ndGroup, 'kw-cic-ops-line kw-cic-ops-detail')
    span(ndLine2, 'kw-cic-row-lbl', '进度')
    span(ndLine2, `kw-mono kw-cic-row-val ${ndock.tone}`, ndock.detail)

    const rFoot = div(rightSide, 'kw-cic-side-foot kw-mono')
    anim(rFoot, calm, [['st-row-in', T.row, T.footAt, 'ease']])
    const questText =
      brief.senka != null ? `现役任务 ${brief.activeQuests} · 战果 ${fmtNum(brief.senka)}` : `现役任务 ${brief.activeQuests}`
    span(rFoot, 'kw-cic-ops-sub', questText)
  }

  div(hud, 'kw-cic-plate-halo')

  const plateWrap = div(stage, 'kw-cic-plate')
  const eyebrow = div(
    plateWrap,
    'kw-cic-eyebrow kw-mono',
    brief ? 'LAST SESSION BRIEF · STAGE 00' : 'BRIDGE INITIALIZATION · STAGE 00',
  )
  anim(eyebrow, calm, [['st-fade', T.eyebrow, T.eyebrowAt, 'ease']])

  const frame = div(plateWrap, 'kw-cic-frame')
  anim(frame, calm, [['st-plate-lock', T.plateLock, T.plateLockAt, 'cubic-bezier(.18,.84,.28,1)']])
  const pulse = div(frame, 'kw-cic-ready-pulse')
  const calL = div(frame, 'kw-cic-caliper left')
  const calR = div(frame, 'kw-cic-caliper right')
  anim(calL, calm, [['st-clamp-left', T.clamp, T.clampAt, 'cubic-bezier(.18,.88,.26,1)']])
  anim(calR, calm, [['st-clamp-right', T.clamp, T.clampAt, 'cubic-bezier(.18,.88,.26,1)']])
  frame.appendChild(box)
  const boxHair = div(frame, 'kw-cic-box-hair')
  anim(boxHair, calm, [['st-grow-x', T.boxLine, T.boxLineAt, 'cubic-bezier(.2,.8,.3,1)']])

  const gateRow = div(plateWrap, 'kw-cic-gate-row kw-mono')
  anim(gateRow, calm, [['st-fade', T.gateRow, T.gateRowAt, 'ease']])
  const ledMap = new Map<LaunchWelcomeSignal, HTMLElement>()
  for (const [signal, label] of [
    ['snapshot', 'SNAP'],
    ['lode', 'LODE'],
    ['panes', 'PANE'],
  ] as const) {
    const item = span(gateRow, 'kw-cic-gate-item')
    const led = span(item, 'kw-cic-gate-led')
    const ledOn = span(led, 'kw-cic-gate-led-on')
    span(item, '', label)
    ledMap.set(signal, ledOn)
  }
  const gateStatus = span(gateRow, 'kw-cic-gate-status', '· READY')
  stage.appendChild(skip)
  let pulsed = false

  return {
    syncPlate() {
      // 铭牌宽度变化由缩放舞台内居中排版自动贴合，无需重排动画。
    },
    noteSignal(signal, allReady) {
      const ledOn = ledMap.get(signal)
      if (ledOn && !ledOn.classList.contains('on')) {
        ledOn.classList.add('on')
        anim(ledOn, calm, [['st-led-lock', T.ledLock, 0, 'ease-out']])
      }
      if (allReady && !pulsed) {
        pulsed = true
        gateStatus.classList.add('on')
        anim(gateStatus, calm, [['st-fade', T.readyStatus, 0, 'ease']])
        if (!calm) {
          anim(pulse, false, [['st-ready-pulse', T.readyPulse, 0, 'cubic-bezier(.16,.78,.28,1)']])
          anim(calL, false, [['st-clamp-snap-l', T.clampSnap, 0, 'ease-out']])
          anim(calR, false, [['st-clamp-snap-r', T.clampSnap, 0, 'ease-out']])
        }
      }
    },
    dispose() {
      bg.remove()
      stage.remove()
    },
  }
}

// =========================================================================
// 方案二：二次元 OP（碧蓝清透海空 / 黄昏彗星）
// =========================================================================
const mountAnimeStyle = (
  layer: HTMLElement,
  box: HTMLElement,
  skip: HTMLElement,
  style: 'anime-blue' | 'anime-dusk',
  calm: boolean,
  random: () => number,
): WelcomeStyleMount => {
  const T = ST.anime
  const dusk = style === 'anime-dusk'
  const sym = spriteBase()
  const rnd = (a: number, b: number) => a + random() * (b - a)
  const bindings: (() => void)[] = []

  // 铺满视口的背景海空、云海、岬角与大气元素层
  const scene = div(layer, 'kw-st-layer kw-an-layer')
  scene.setAttribute('aria-hidden', 'true')
  layer.insertBefore(scene, box)
  anim(scene, calm, [['st-fade', T.sceneFade, 0, 'ease']])

  div(scene, 'kw-an-sky')

  const skyClip = div(scene, 'kw-an-sky-clip')
  const cloudsWrap = div(skyClip, 'kw-an-clouds')
  anim(cloudsWrap, calm, [['st-cloud-rise', T.cloudRise, T.cloudAt, 'cubic-bezier(.16,.8,.28,1)']])
  const cloudsSvg = svgNode(cloudsWrap, 'svg', { viewBox: '0 0 800 150', preserveAspectRatio: 'none' }, 'kw-an-clouds-svg')
  const defs = svgNode(cloudsSvg, 'defs', {})
  const gSh = svgNode(defs, 'linearGradient', { id: 'kw-an-cloud-sh', x1: 0, y1: 0, x2: 0, y2: 1 })
  svgNode(gSh, 'stop', { offset: '0', style: 'stop-color:var(--kw-an-cloud-sh)', 'stop-opacity': '.92' })
  svgNode(gSh, 'stop', { offset: '.72', style: 'stop-color:var(--kw-an-cloud-sh)', 'stop-opacity': '.76' })
  svgNode(gSh, 'stop', { offset: '1', style: 'stop-color:var(--kw-an-sky-3)', 'stop-opacity': '.28' })
  const gHi = svgNode(defs, 'linearGradient', { id: 'kw-an-cloud-hi', x1: 0, y1: 0, x2: 0, y2: 1 })
  svgNode(gHi, 'stop', { offset: '0', style: 'stop-color:var(--kw-an-cloud-hi)', 'stop-opacity': '1' })
  svgNode(gHi, 'stop', { offset: '.76', style: 'stop-color:var(--kw-an-cloud-hi)', 'stop-opacity': '.92' })
  svgNode(gHi, 'stop', { offset: '1', style: 'stop-color:var(--kw-an-sky-3)', 'stop-opacity': '.45' })

  svgNode(cloudsSvg, 'path', {
    d: 'M-20 150 L-20 100 C8 76 42 74 68 88 C94 46 144 36 184 62 C214 34 264 38 292 76 C322 72 346 96 364 126 C382 146 416 146 444 128 C472 102 504 86 538 82 C572 36 632 26 676 58 C712 28 764 36 792 72 L820 82 L820 150 Z',
    fill: 'url(#kw-an-cloud-sh)',
  })
  svgNode(cloudsSvg, 'path', {
    d: 'M-20 150 L-20 112 C14 90 48 92 74 104 C104 62 152 56 188 80 C216 56 258 62 284 94 C312 92 332 114 352 142 C362 150 454 150 468 140 C494 114 526 100 562 96 C596 54 648 48 690 74 C724 52 768 58 796 88 L820 98 L820 150 Z',
    fill: 'url(#kw-an-cloud-hi)',
  })
  svgNode(cloudsSvg, 'path', {
    d: 'M76 102 C104 62 152 56 188 80 C216 56 258 62 284 94',
    fill: 'none',
    'stroke-width': 2,
    'stroke-linecap': 'round',
  }, 'kw-an-cloud-rim')
  svgNode(cloudsSvg, 'path', {
    d: 'M562 95 C596 54 648 48 690 74 C724 52 768 58 796 88',
    fill: 'none',
    'stroke-width': 2,
    'stroke-linecap': 'round',
  }, 'kw-an-cloud-rim')

  const horizonGlow = div(scene, 'kw-an-horizon-glow')
  anim(horizonGlow, calm, [['st-fade', T.horizonIn, 0, 'ease']])

  const capeWrap = div(scene, 'kw-an-cape')
  anim(capeWrap, calm, [['st-fade', T.capeIn, T.capeAt, 'ease']])
  const capeSvg = svgNode(capeWrap, 'svg', { viewBox: '0 0 800 56', preserveAspectRatio: 'none' }, 'kw-an-cape-svg')
  svgNode(capeSvg, 'path', { d: 'M0 50 Q64 40 134 48 L158 56 L0 56 Z', opacity: '.68' }, 'kw-an-cape-fill')
  svgNode(capeSvg, 'path', { d: 'M584 56 L618 46 Q676 34 742 40 L800 36 L800 56 Z', opacity: '.86' }, 'kw-an-cape-fill')
  svgNode(capeSvg, 'path', { d: 'M618 46 Q676 34 742 40', fill: 'none', 'stroke-width': 1.2 }, 'kw-an-cape-rim')
  svgNode(capeSvg, 'path', { d: 'M674 38 L677 18 L682 18 L685 38 Z' }, 'kw-an-cloud-hi-fill')
  svgNode(capeSvg, 'rect', { x: 676.2, y: 16, width: 6.6, height: 2.4, rx: 1 }, 'kw-an-accent-fill')
  svgNode(capeSvg, 'circle', { cx: 679.5, cy: 17, r: 2.2, opacity: '.9' }, 'kw-an-star-fill')
  svgNode(capeSvg, 'path', { d: 'M214 54 L219 40 L224 54 Z', opacity: '.9' }, 'kw-an-cloud-hi-fill')
  svgNode(capeSvg, 'path', { d: 'M211 54.5 L227 54.5 L224 56 L214 56 Z', opacity: '.76' }, 'kw-an-cape-fill')

  div(scene, 'kw-an-horizon-line')

  const slashA = div(scene, 'kw-an-slash')
  setCss(slashA, { left: '0', '--kw-w': '150px', '--kw-c': 'var(--kw-an-slash-a)' })
  anim(slashA, calm, [['st-op-slash', T.slashA, T.slashAAt, 'cubic-bezier(.18,.78,.24,1)']])
  const slashB = div(scene, 'kw-an-slash')
  setCss(slashB, { left: '0', '--kw-w': '52px', '--kw-c': 'var(--kw-an-slash-b)' })
  anim(slashB, calm, [['st-op-slash', T.slashB, T.slashBAt, 'cubic-bezier(.18,.78,.24,1)']])

  const flarePos = [
    { left: '14%', top: '16%', sz: 84 },
    { left: '23%', top: '27%', sz: 36 },
    { left: '72%', top: '72%', sz: 66 },
  ]
  flarePos.forEach((fp, i) => {
    const f = div(scene, 'kw-an-flare')
    setCss(f, { left: fp.left, top: fp.top, width: `calc(${fp.sz}px * var(--kw-scale))`, height: `calc(${fp.sz}px * var(--kw-scale))` })
    const ft = T.flares[i]
    anim(f, calm, [
      ['st-flare-drift', ft.dur, ft.delay, 'ease-in-out', 'alternate', 'none'],
      ['st-fade', T.flareIn, ft.inAt, 'ease', false, 'both'],
    ])
  })

  const windPos = [
    { left: '8%', top: '24%', w: 160 },
    { left: '54%', top: '19%', w: 126 },
  ]
  windPos.forEach((wp, i) => {
    const w = div(scene, 'kw-an-wind')
    setCss(w, { left: wp.left, top: wp.top, width: `calc(${wp.w}px * var(--kw-scale))` })
    const wt = T.winds[i]
    anim(w, calm, [['st-wind-sweep', wt.dur, wt.delay, 'ease-out', true, 'both']])
  })

  const gullDefs = [
    { rx0: 0.09, ry0: 0.34, rx1: 0.54, ry1: 0.17, rcx: 0.26, rcy: 0.26, w: 28 },
    { rx0: 0.14, ry0: 0.38, rx1: 0.59, ry1: 0.22, rcx: 0.31, rcy: 0.30, w: 20 },
    { rx0: 0.58, ry0: 0.31, rx1: 0.94, ry1: 0.16, rcx: 0.70, rcy: 0.24, w: 18 },
  ]
  gullDefs.forEach((gd, i) => {
    const h = Math.round((gd.w * 14) / 36)
    const gull = div(scene, 'kw-an-gull')
    setCss(gull, { width: `calc(${gd.w}px * var(--kw-scale))`, height: `calc(${h}px * var(--kw-scale))` })
    const applyCoords = () => {
      const W = window.innerWidth || DESIGN_W
      const H = window.innerHeight || DESIGN_H
      setCss(gull, {
        '--kw-x0': `${Math.round(W * gd.rx0)}px`,
        '--kw-y0': `${Math.round(H * gd.ry0)}px`,
        '--kw-x1': `${Math.round(W * gd.rx1)}px`,
        '--kw-y1': `${Math.round(H * gd.ry1)}px`,
        '--kw-cx': `${Math.round(W * gd.rcx)}px`,
        '--kw-cy': `${Math.round(H * gd.rcy)}px`,
      })
    }
    applyCoords()
    bindings.push(applyCoords)
    const gt = T.gulls[i]
    anim(gull, calm, [['st-gull-glide', gt.dur, gt.delay, 'linear', true, 'both']])
    const wing = div(gull, 'kw-an-gull-wing')
    anim(wing, calm, [['st-gull-flap', gt.flap, 0, 'ease-in-out', 'alternate', 'none']])
    const gSvg = svgNode(wing, 'svg', { viewBox: '0 0 36 14' }, 'kw-an-svg-fill kw-an-gull-fill')
    svgNode(gSvg, 'use', { href: `${sym}sym-gull`, width: 36, height: 14 })
  })

  const starPos = [
    { left: '20%', top: '20%', sz: 16 },
    { left: '78%', top: '24%', sz: 18 },
    { left: '65%', top: '16%', sz: 12 },
    { left: '34%', top: '73%', sz: 15 },
    { left: '54%', top: '76%', sz: 17 },
    { left: '66%', top: '72%', sz: 13 },
    { left: '26%', top: '82%', sz: 12 },
  ]
  starPos.forEach((sp, i) => {
    const star = div(scene, 'kw-an-star')
    setCss(star, { left: sp.left, top: sp.top, width: `calc(${sp.sz}px * var(--kw-scale))`, height: `calc(${sp.sz}px * var(--kw-scale))` })
    anim(star, calm, [['st-star-twinkle', T.stars[i], T.starDelays[i], 'ease-in-out', true, 'both']])
    const sSvg = svgNode(star, 'svg', { viewBox: '0 0 24 24' }, 'kw-an-svg-fill kw-an-star-fill')
    svgNode(sSvg, 'use', { href: `${sym}sym-star4`, width: 24, height: 24 })
  })

  const glintPos = [
    { left: '18%', top: '72%', w: 72 },
    { left: '38%', top: '70.5%', w: 96 },
    { left: '48%', top: '75%', w: 62 },
    { left: '60%', top: '71%', w: 80 },
    { left: '42%', top: '81%', w: 56 },
    { left: '72%', top: '79%', w: 48 },
  ]
  glintPos.forEach((gp, i) => {
    const gl = div(scene, 'kw-an-sea-glint')
    setCss(gl, { left: gp.left, top: gp.top, width: `calc(${gp.w}px * var(--kw-scale))` })
    anim(gl, calm, [['st-sea-sparkle', T.glints[i], T.glintDelays[i], 'ease-in-out', 'alternate', 'both']])
  })

  const petalCount = dusk ? 10 : 7
  for (let i = 0; i < petalCount; i++) {
    const sz = Math.round(rnd(11, 16))
    const rx0 = rnd(0.14, 0.92)
    const rdx = rnd(0.14, 0.25)
    const rcx = rnd(0.1, 0.88)
    const rcy = rnd(0.14, 0.74)
    const dur = Math.round(rnd(T.petalDur[0], T.petalDur[1]))
    const delay = -Math.round(rnd(0, T.petalDelayMax))
    const flut = Math.round(rnd(T.petalFlut[0], T.petalFlut[1]))
    const petal = div(scene, 'kw-an-petal')
    setCss(petal, { width: `calc(${sz}px * var(--kw-scale))`, height: `calc(${sz}px * var(--kw-scale))` })
    const applyPetal = () => {
      const W = window.innerWidth || DESIGN_W
      const H = window.innerHeight || DESIGN_H
      const x0 = Math.round(W * rx0)
      setCss(petal, {
        '--kw-x0': `${x0}px`,
        '--kw-x1': `${x0 - Math.round(W * rdx)}px`,
        '--kw-cx': `${Math.round(W * rcx)}px`,
        '--kw-cy': `${Math.round(H * rcy)}px`,
        '--kw-y1': `${Math.round(H + 40)}px`,
      })
    }
    applyPetal()
    bindings.push(applyPetal)
    anim(petal, calm, [['st-petal-fall', dur, delay, 'linear', true, 'both']])
    const spin = div(petal, 'kw-an-petal-spin')
    anim(spin, calm, [['st-petal-flutter', flut, 0, 'ease-in-out', 'alternate', 'none']])
    const pSvg = svgNode(spin, 'svg', { viewBox: '0 0 20 20' }, 'kw-an-svg-fill kw-an-petal-fill')
    svgNode(pSvg, 'use', { href: `${sym}sym-an-petal`, width: 20, height: 20 })
  }

  // 全宽信箱上下条（高与字号按 --kw-scale 等比缩放，贴齐窗口上下边）
  const barTop = div(layer, 'kw-an-bar-top kw-mono')
  layer.insertBefore(barTop, box)
  anim(barTop, calm, [['st-bar-down', T.barIn, 0, 'cubic-bezier(.18,.84,.28,1)']])
  const ep = span(barTop)
  span(ep, '', 'CHINJUFU // ')
  span(ep, 'kw-an-bar-hi', 'EP.00')
  span(barTop, '', dusk ? 'MAGIC HOUR · TWILIGHT HARBOR' : 'CLEAR COASTAL PORT · NAVAL BASE')

  // 1020×574 设计基准缩放舞台：标题卡、日文副标、铭牌、装饰与黄昏彗星整体等比缩放
  const stage = div(layer, 'kw-st-stage kw-an-stage')
  layer.insertBefore(stage, box)

  if (dusk) {
    const comet = div(stage, 'kw-an-comet')
    anim(comet, calm, [['st-comet-glide', T.comet, T.cometAt, 'cubic-bezier(.22,.64,.36,1)', true, 'both']])
    const cSvg = svgNode(comet, 'svg', { viewBox: '0 0 130 18', width: 160, height: 22 }, 'kw-an-svg-block')
    const cDefs = svgNode(cSvg, 'defs', {})
    const cGrad = svgNode(cDefs, 'linearGradient', { id: 'kw-an-comet-g', x1: 0, y1: 0, x2: 1, y2: 0 })
    svgNode(cGrad, 'stop', { offset: '0', style: 'stop-color:var(--kw-an-accent)', 'stop-opacity': '0' })
    svgNode(cGrad, 'stop', { offset: '.55', style: 'stop-color:var(--kw-an-accent)', 'stop-opacity': '.48' })
    svgNode(cGrad, 'stop', { offset: '.88', style: 'stop-color:var(--kw-an-accent2)', 'stop-opacity': '.88' })
    svgNode(cGrad, 'stop', { offset: '1', style: 'stop-color:var(--kw-an-star)', 'stop-opacity': '1' })
    svgNode(cSvg, 'path', { d: 'M0 7 L118 9', fill: 'none', stroke: 'url(#kw-an-comet-g)', 'stroke-width': 2.2, 'stroke-linecap': 'round' })
    svgNode(cSvg, 'path', { d: 'M18 11 L114 10', fill: 'none', stroke: 'url(#kw-an-comet-g)', 'stroke-width': 1, 'stroke-linecap': 'round', opacity: '.68' })
    svgNode(cSvg, 'use', { href: `${sym}sym-star4`, x: 111, y: 2, width: 14, height: 14 }, 'kw-an-star-fill')
  }

  const plateWrap = div(stage, 'kw-an-plate')

  const jp = div(plateWrap, 'kw-an-jp', 'おかえりなさい、提督')
  anim(jp, calm, [['st-jp-rise', T.jpRise, T.jpAt, 'cubic-bezier(.18,.84,.28,1)']])

  const cardWrap = div(plateWrap, 'kw-an-card-wrap')
  anim(cardWrap, calm, [['st-card-pop', T.cardPop, T.cardPopAt, 'cubic-bezier(.16,.88,.26,1)']])

  const badge = div(cardWrap, 'kw-an-star-badge')
  anim(badge, calm, [
    ['st-badge-pop', T.badgePop, T.badgePopAt, 'cubic-bezier(.2,1.5,.4,1)', false, 'both'],
    ['st-badge-breathe', T.badgeBreathe, T.badgeBreatheAt, 'ease-in-out', 'alternate', 'none'],
  ])
  const bSvg = svgNode(badge, 'svg', { viewBox: '0 0 24 24', width: 20, height: 20 }, 'kw-an-svg-block kw-an-accent2-fill')
  svgNode(bSvg, 'use', { href: `${sym}sym-star4`, width: 24, height: 24 })

  const cardShell = div(cardWrap, 'kw-an-card-shell')
  const accentBar = div(cardShell, 'kw-an-accent-bar')
  anim(accentBar, calm, [['st-bar-grow-y', T.accentBar, T.accentBarAt, 'cubic-bezier(.18,.86,.28,1)']])
  cardShell.appendChild(box)
  const sheen = div(cardShell, 'kw-an-card-sheen')
  anim(sheen, calm, [['st-card-sheen', T.cardSheen, T.cardSheenAt, 'cubic-bezier(.2,.7,.3,1)']])

  const subLine = div(plateWrap, 'kw-an-sub-line kw-mono', 'WELCOME BACK TO PORT')
  anim(subLine, calm, [['st-fade', T.subLine, T.subLineAt, 'ease']])

  const barBot = div(layer, 'kw-an-bar-bot')
  anim(barBot, calm, [['st-bar-up', T.barIn, 0, 'cubic-bezier(.18,.84,.28,1)']])
  span(barBot, 'kw-mono kw-an-bar-brand', 'KUMA WORKBENCH')
  barBot.appendChild(skip)

  return {
    syncPlate() {
      for (const fn of bindings) fn()
    },
    noteSignal() {
      // 二次元 OP 无 HUD 指示灯。
    },
    dispose() {
      scene.remove()
      barTop.remove()
      stage.remove()
      barBot.remove()
    },
  }
}

// =========================================================================
// 方案三：交互式机甲舱门（双开 / 四向 + VR 弧面目镜 + 球磨催门彩蛋）
// =========================================================================
const mountMechStyle = (
  layer: HTMLElement,
  box: HTMLElement,
  skip: HTMLElement,
  style: 'mech-split' | 'mech-quad',
  brief: WelcomeBriefCache | null,
  calm: boolean,
): WelcomeStyleMount => {
  const now = Date.now()
  const isSplit = style === 'mech-split'
  setCss(layer, { '--kw-hover-dur': `${MT.hoverTransition}ms` })
  skip.textContent = '点击舱门 / Enter / 空格 解封 · Esc 跳过'

  const flash = div(layer, 'kw-mech-flash')
  flash.setAttribute('aria-hidden', 'true')
  layer.insertBefore(flash, box)

  const rig = div(layer, 'kw-mech-rig')
  layer.insertBefore(rig, box)

  const doorLeaves: HTMLElement[] = []
  let seamGlow: SVGElement | null = null

  if (isSplit) {
    const leftDoor = div(rig, 'kw-mech-leaf left-door')
    const lIn1 = div(leftDoor, 'kw-mech-inset')
    setCss(lIn1, { left: 'calc(22px * var(--kw-scale))', top: 'calc(24px * var(--kw-scale))', width: '30%', height: 'calc(42px * var(--kw-scale))' })
    const lIn2 = div(leftDoor, 'kw-mech-inset')
    setCss(lIn2, { left: 'calc(22px * var(--kw-scale))', bottom: 'calc(24px * var(--kw-scale))', width: '26%', height: 'calc(38px * var(--kw-scale))' })
    const lb1 = div(leftDoor, 'kw-mech-bolt')
    setCss(lb1, { left: 'calc(30px * var(--kw-scale))', top: 'calc(32px * var(--kw-scale))' })
    const lb2 = div(leftDoor, 'kw-mech-bolt')
    setCss(lb2, { left: 'calc(30px * var(--kw-scale))', bottom: 'calc(32px * var(--kw-scale))' })
    const lt = div(leftDoor, 'kw-mech-tick')
    setCss(lt, { left: 'calc(22px * var(--kw-scale))', top: 'calc(74px * var(--kw-scale))' })
    const ls1 = div(leftDoor, 'kw-mech-stencil kw-mono', 'BAY-00L // SEAL')
    setCss(ls1, { left: 'calc(44px * var(--kw-scale))', top: 'calc(38px * var(--kw-scale))' })
    const ls2 = div(leftDoor, 'kw-mech-stencil kw-mono', 'HYDRAULIC NOMINAL')
    setCss(ls2, { left: 'calc(44px * var(--kw-scale))', bottom: 'calc(36px * var(--kw-scale))' })
    const lh = div(leftDoor, 'kw-mech-hazard')
    setCss(lh, { left: 'calc(64px * var(--kw-scale))', top: 'calc(74px * var(--kw-scale))' })

    const rightDoor = div(rig, 'kw-mech-leaf right-door')
    const rIn1 = div(rightDoor, 'kw-mech-inset')
    setCss(rIn1, { right: 'calc(22px * var(--kw-scale))', top: 'calc(24px * var(--kw-scale))', width: '28%', height: 'calc(42px * var(--kw-scale))' })
    const rIn2 = div(rightDoor, 'kw-mech-inset')
    setCss(rIn2, { right: 'calc(22px * var(--kw-scale))', bottom: 'calc(24px * var(--kw-scale))', width: '30%', height: 'calc(38px * var(--kw-scale))' })
    const rb1 = div(rightDoor, 'kw-mech-bolt')
    setCss(rb1, { right: 'calc(30px * var(--kw-scale))', top: 'calc(32px * var(--kw-scale))' })
    const rb2 = div(rightDoor, 'kw-mech-bolt')
    setCss(rb2, { right: 'calc(30px * var(--kw-scale))', bottom: 'calc(32px * var(--kw-scale))' })
    const rt = div(rightDoor, 'kw-mech-tick')
    setCss(rt, { right: 'calc(22px * var(--kw-scale))', bottom: 'calc(70px * var(--kw-scale))' })
    const rs1 = div(rightDoor, 'kw-mech-stencil kw-mono', 'ARMOR // 00R')
    setCss(rs1, { right: 'calc(44px * var(--kw-scale))', top: 'calc(38px * var(--kw-scale))' })
    const rs2 = div(rightDoor, 'kw-mech-stencil kw-mono', 'KUMA OS · LOCKED')
    setCss(rs2, { right: 'calc(44px * var(--kw-scale))', bottom: 'calc(36px * var(--kw-scale))' })
    const rh = div(rightDoor, 'kw-mech-hazard')
    setCss(rh, { right: 'calc(64px * var(--kw-scale))', bottom: 'calc(70px * var(--kw-scale))' })

    doorLeaves.push(leftDoor, rightDoor)

    const seamSvg = svgNode(rig, 'svg', { viewBox: '0 0 100 100', preserveAspectRatio: 'none' }, 'kw-mech-seam-svg')
    svgNode(seamSvg, 'line', { x1: 56, y1: 0, x2: 44, y2: 100, 'vector-effect': 'non-scaling-stroke' }, 'kw-mech-seam-shadow')
    svgNode(seamSvg, 'line', { x1: 56, y1: 0, x2: 44, y2: 100, 'vector-effect': 'non-scaling-stroke' }, 'kw-mech-seam-base')
    seamGlow = svgNode(seamSvg, 'line', { x1: 56, y1: 0, x2: 44, y2: 100, 'vector-effect': 'non-scaling-stroke' }, 'kw-mech-seam-glow')
  } else {
    const quadSpecs = [
      { cls: 'tl', label: 'SHUTTER-01 // UL', inset: { left: 'calc(18px * var(--kw-scale))', top: 'calc(18px * var(--kw-scale))' }, lbl: { left: 'calc(28px * var(--kw-scale))', top: 'calc(28px * var(--kw-scale))' }, tick: { left: 'calc(18px * var(--kw-scale))', bottom: 'calc(16px * var(--kw-scale))' } },
      { cls: 'tr', label: 'SHUTTER-02 // UR', inset: { right: 'calc(18px * var(--kw-scale))', top: 'calc(18px * var(--kw-scale))' }, lbl: { right: 'calc(28px * var(--kw-scale))', top: 'calc(28px * var(--kw-scale))' }, tick: null },
      { cls: 'bl', label: 'SHUTTER-03 // BL', inset: { left: 'calc(18px * var(--kw-scale))', bottom: 'calc(18px * var(--kw-scale))' }, lbl: { left: 'calc(28px * var(--kw-scale))', bottom: 'calc(28px * var(--kw-scale))' }, tick: null },
      { cls: 'br', label: 'SHUTTER-04 // BR', inset: { right: 'calc(18px * var(--kw-scale))', bottom: 'calc(18px * var(--kw-scale))' }, lbl: { right: 'calc(28px * var(--kw-scale))', bottom: 'calc(28px * var(--kw-scale))' }, tick: { right: 'calc(18px * var(--kw-scale))', top: 'calc(16px * var(--kw-scale))' } },
    ] as const
    for (const qs of quadSpecs) {
      const q = div(rig, `kw-mech-quad ${qs.cls}`)
      const inset = div(q, 'kw-mech-inset')
      setCss(inset, { ...qs.inset, width: '44%', height: 'calc(32px * var(--kw-scale))' })
      const lbl = div(q, 'kw-mech-stencil kw-mono', qs.label)
      setCss(lbl, qs.lbl)
      if (qs.tick) {
        const tick = div(q, 'kw-mech-tick')
        setCss(tick, qs.tick)
      }
      doorLeaves.push(q)
    }
    const seamSvg = svgNode(rig, 'svg', { viewBox: '0 0 100 100', preserveAspectRatio: 'none' }, 'kw-mech-seam-svg')
    for (const [x1, y1, x2, y2] of [
      [50, 0, 50, 100],
      [0, 50, 100, 50],
    ]) {
      svgNode(seamSvg, 'line', { x1, y1, x2, y2, 'vector-effect': 'non-scaling-stroke' }, 'kw-mech-seam-shadow')
      svgNode(seamSvg, 'line', { x1, y1, x2, y2, 'vector-effect': 'non-scaling-stroke' }, 'kw-mech-seam-base')
      svgNode(seamSvg, 'line', { x1, y1, x2, y2, 'vector-effect': 'non-scaling-stroke' }, 'kw-mech-seam-glow')
    }
  }

  const seamGlowWrap = div(rig, 'kw-mech-seam-pulse')
  seamGlowWrap.setAttribute('aria-hidden', 'true')
  if (seamGlow) seamGlow.setAttribute('data-seam', '1')

  // 铺满视口的目镜外缘暗角
  const vignette = div(rig, 'kw-mech-vignette')
  vignette.setAttribute('aria-hidden', 'true')

  // 1020×574 设计基准缩放舞台：VR 弧面目镜双翼、光学弧、顶栏、中央舱锁铭牌与催门彩蛋整体等比缩放
  const stage = div(rig, 'kw-st-stage kw-mech-stage')

  const visor = div(stage, 'kw-mech-visor')
  const arcsSvg = svgNode(visor, 'svg', { viewBox: '0 0 1000 562', preserveAspectRatio: 'none' }, 'kw-mech-arcs-svg')
  svgNode(arcsSvg, 'path', { d: 'M254 68 Q222 281 254 494', fill: 'none', 'stroke-width': 1.2, 'stroke-dasharray': '5 7' }, 'kw-mech-arc')
  svgNode(arcsSvg, 'path', { d: 'M746 68 Q778 281 746 494', fill: 'none', 'stroke-width': 1.2, 'stroke-dasharray': '5 7' }, 'kw-mech-arc')
  svgNode(arcsSvg, 'path', { d: 'M244 276 H258 M742 276 H756', fill: 'none', 'stroke-width': 1.6, opacity: '.68' }, 'kw-mech-arc-tick')

  const vTop = div(visor, 'kw-mech-vtop kw-mono')
  anim(vTop, calm, [['st-fade', MT.visorTopIn, MT.visorTopAt, 'ease']])
  const vLink = span(vTop)
  span(vLink, '', 'VISOR ')
  bold(vLink, '', 'LINK')
  if (brief) {
    span(vTop, '', '·')
    const snapSpan = span(vTop, '', `上次快照 ${fmtClock(brief.savedAt)}（离线 ${fmtDuration(now - brief.savedAt)}）`)
    snapSpan.dataset.brief = 'top'
    const adm = fmtAdmiral(brief)
    if (adm) {
      span(vTop, '', '·')
      const admSpan = span(vTop, '', adm)
      admSpan.dataset.brief = 'admiral'
    }
  }

  let leftWing: HTMLElement | null = null
  let rightWing: HTMLElement | null = null
  if (brief) {
    leftWing = div(visor, 'kw-mech-wing left')
    leftWing.dataset.brief = 'left'
    anim(leftWing, calm, [['st-wing-in-l', MT.wingIn, MT.wingLeftAt, 'cubic-bezier(.18,.84,.28,1)']])
    const lHead = div(leftWing, 'kw-mech-vw-head')
    bold(lHead, '', '资材简报')
    span(lHead, 'kw-mono', 'LAST')
    RESOURCE_SPECS.forEach((spec, idx) => {
      const value = brief.materials[idx]
      const warn = value < RESOURCE_LOW
      const pct = Math.min(1, Math.max(0.06, value / RESOURCE_CAP)).toFixed(3)
      const resRow = div(leftWing!, 'kw-mech-vw-res')
      const top = div(resRow, 'kw-mech-vw-res-top')
      span(top, '', spec.lbl)
      bold(top, `kw-mono${warn ? ' warn' : ''}`, fmtNum(value))
      const track = div(resRow, 'kw-mech-vw-track')
      const fill = div(track, 'kw-mech-vw-fill')
      setCss(fill, { '--kw-fill': pct, '--kw-fc': warn ? 'var(--kw-cic-warn)' : spec.color })
      anim(fill, calm, [['st-bar-load', MT.barFill, MT.barBase + idx * MT.barStep, 'cubic-bezier(.18,.84,.28,1)']])
    })
    const lFoot = div(leftWing, 'kw-mech-vw-foot kw-mono')
    const bWrap = span(lFoot)
    span(bWrap, '', '桶 ')
    bold(bWrap, '', fmtNum(brief.buckets))
    const sWrap = span(lFoot)
    span(sWrap, '', '船位 ')
    const shipWarn = brief.ships[1] > 0 && brief.ships[1] - brief.ships[0] <= SHIP_FREE_WARN
    bold(sWrap, shipWarn ? 'warn' : '', `${brief.ships[0]}/${brief.ships[1]}`)

    rightWing = div(visor, 'kw-mech-wing right')
    rightWing.dataset.brief = 'right'
    anim(rightWing, calm, [['st-wing-in-r', MT.wingIn, MT.wingRightAt, 'cubic-bezier(.18,.84,.28,1)']])
    const rHead = div(rightWing, 'kw-mech-vw-head')
    bold(rHead, '', '母港勤务')
    span(rHead, 'kw-mono', 'HUD')
    const expOps = div(rightWing, 'kw-mech-vw-ops')
    for (const exp of expeditionRowsOf(brief, now)) {
      const line = div(expOps, 'kw-mech-vw-line')
      const tag = span(line, 'kw-mech-vw-tag kw-mono')
      const dot = span(tag, 'kw-mech-vw-dot')
      const dc = exp.tone === 'ok' ? 'var(--kw-mech-ok)' : exp.tone === 'dim' ? 'var(--kw-mech-dim)' : 'var(--kw-mech-pri)'
      setCss(dot, { '--kw-dc': dc })
      span(tag, '', exp.label)
      if (exp.tone === 'ok') span(line, 'kw-mech-vw-pill', exp.status)
      else span(line, 'kw-mono kw-mech-vw-sub', exp.status)
    }
    const ndock = ndockSummaryOf(brief, now)
    const ndOps = div(rightWing, 'kw-mech-vw-ops kw-mech-vw-sep')
    const ndLine = div(ndOps, 'kw-mech-vw-line')
    span(ndLine, '', '入渠')
    if (ndock.tone === 'ok') span(ndLine, 'kw-mech-vw-pill', ndock.detail)
    else span(ndLine, `kw-mono kw-mech-vw-val ${ndock.tone}`, `${ndock.active} · ${ndock.detail}`)
    const rFoot = div(rightWing, 'kw-mech-vw-foot kw-mono')
    const qWrap = span(rFoot)
    span(qWrap, '', '任务 ')
    bold(qWrap, '', `${brief.activeQuests}`)
    if (brief.senka != null) {
      const kWrap = span(rFoot)
      span(kWrap, '', '战果 ')
      bold(kWrap, '', fmtNum(brief.senka))
    }
  }

  // 球磨催门彩蛋槽位：初始空文本，三件就绪后迟迟不点时由调度写入 textContent。
  const nudgeEl = div(visor, 'kw-mech-nudge')
  nudgeEl.dataset.nudge = '1'

  // 中央舱锁铭牌区：仅 .kw-mech-core-hit（静止热区）承接悬停，内部动画节点 pointer-events: none，杜绝卡尺颜色抖动。
  const coreWrap = div(stage, 'kw-mech-core')
  const coreTag = div(coreWrap, 'kw-mech-core-tag kw-mono')
  const coreDot = span(coreTag, 'kw-mech-core-dot')
  anim(coreDot, calm, [['st-pulse-dot', MT.dotPulse, 0, 'ease-in-out', true, 'none']])
  const coreTagText = span(coreTag, '', 'COCKPIT SEALED · SYNCING')

  const coreHit = div(coreWrap, 'kw-mech-core-hit')
  const plateFrame = div(coreHit, 'kw-mech-plate-frame')
  const clampL = div(plateFrame, 'kw-mech-clamp l')
  const clampR = div(plateFrame, 'kw-mech-clamp r')
  plateFrame.appendChild(box)

  const cta = div(coreHit, 'kw-mech-cta kw-mono', '▶ 点击舱门解封并启动工作台')
  anim(cta, calm, [['st-cta-breathe', MT.ctaBreathe, 0, 'ease-in-out', true, 'none']])

  const gateRow = div(coreWrap, 'kw-mech-gate-row kw-mono')
  const ledMap = new Map<LaunchWelcomeSignal, HTMLElement>()
  for (const [signal, label] of [
    ['snapshot', 'SNAP'],
    ['lode', 'LODE'],
    ['panes', 'PANE'],
  ] as const) {
    const item = span(gateRow, 'kw-mech-gate-item')
    const led = span(item, 'kw-mech-gate-led')
    const ledOn = span(led, 'kw-mech-gate-led-on')
    span(item, '', label)
    ledMap.set(signal, ledOn)
  }
  stage.appendChild(skip)

  return {
    syncPlate() {
      // 居中 flex + 相对锁扣自动贴合铭牌宽度。
    },
    noteSignal(signal, allReady) {
      const ledOn = ledMap.get(signal)
      if (ledOn && !ledOn.classList.contains('on')) {
        ledOn.classList.add('on')
        anim(ledOn, calm, [['st-led-lock', ST.cic.ledLock, 0, 'ease-out']])
      }
      if (allReady) {
        coreTagText.textContent = 'COCKPIT SEALED · VISOR READY'
      }
    },
    setNudge(line: string) {
      nudgeEl.textContent = line
      nudgeEl.classList.add('show')
      if (!calm) {
        nudgeEl.style.animation = 'none'
        void nudgeEl.offsetWidth
        anim(nudgeEl, false, [['st-nudge-in', MT.nudgeIn, 0, 'cubic-bezier(.18,.84,.28,1)']])
      }
    },
    beginOpen(isCalm: boolean) {
      layer.classList.add('kw-mech-open')
      if (isCalm) return
      anim(rig, false, [['st-hatch-recoil', MT.recoil, 0, 'ease-out']])
      anim(flash, false, [['st-flash-open', MT.flashOpen, MT.flashAt, 'ease-out']])
      anim(seamGlowWrap, false, [['st-seam-blaze', MT.seamBlaze, 0, 'ease-out']])
      anim(vignette, false, [['st-visor-fade', MT.visorFade, MT.visorFadeAt, 'ease-out', false, 'forwards']])
      anim(visor, false, [['st-visor-fade', MT.visorFade, MT.visorFadeAt, 'ease-out', false, 'forwards']])
      if (leftWing) anim(leftWing, false, [['st-wing-out-l', MT.wingOut, MT.wingOutAt, 'cubic-bezier(.4,0,.8,1)', false, 'forwards']])
      if (rightWing) anim(rightWing, false, [['st-wing-out-r', MT.wingOut, MT.wingOutAt, 'cubic-bezier(.4,0,.8,1)', false, 'forwards']])
      anim(coreWrap, false, [['st-core-unlock', MT.coreUnlock, MT.coreUnlockAt, 'cubic-bezier(.3,0,.7,1)', false, 'forwards']])
      anim(clampL, false, [['st-clamp-pop-l', MT.clampPop, 0, 'ease-out', false, 'forwards']])
      anim(clampR, false, [['st-clamp-pop-r', MT.clampPop, 0, 'ease-out', false, 'forwards']])
      if (isSplit) {
        anim(doorLeaves[0], false, [['st-slide-left', MT.doorSlide, MT.doorDelay, 'cubic-bezier(.52,.02,.22,1)', false, 'forwards']])
        anim(doorLeaves[1], false, [['st-slide-right', MT.doorSlide, MT.doorDelay, 'cubic-bezier(.52,.02,.22,1)', false, 'forwards']])
      } else {
        const names = ['st-quad-tl', 'st-quad-tr', 'st-quad-bl', 'st-quad-br'] as const
        doorLeaves.forEach((leaf, idx) => {
          anim(leaf, false, [[names[idx], MT.quadSlide, MT.doorDelay, 'cubic-bezier(.52,.02,.22,1)', false, 'forwards']])
        })
      }
    },
    dispose() {
      flash.remove()
      rig.remove()
    },
  }
}

export const mountWelcomeStyle = (
  layer: HTMLElement,
  box: HTMLElement,
  skip: HTMLElement,
  style: CustomWelcomeStyle,
  brief: WelcomeBriefCache | null,
  calm: boolean,
  random: () => number = Math.random,
): WelcomeStyleMount => {
  layer.dataset.welcomeStyle = style
  if (calm) layer.classList.add('kw-calm')

  const applyScale = () => {
    layer.style.setProperty('--kw-scale', viewportScale().toFixed(4))
  }
  applyScale()

  const inner = isCicWelcomeStyle(style)
    ? mountCicStyle(layer, box, skip, brief, calm)
    : isAnimeWelcomeStyle(style)
      ? mountAnimeStyle(layer, box, skip, style, calm, random)
      : mountMechStyle(layer, box, skip, style, brief, calm)

  const onResize = () => {
    applyScale()
    inner.syncPlate()
  }
  window.addEventListener('resize', onResize)

  return {
    syncPlate: onResize,
    noteSignal: inner.noteSignal,
    setNudge: inner.setNudge,
    beginOpen: inner.beginOpen,
    dispose() {
      window.removeEventListener('resize', onResize)
      inner.dispose()
    },
  }
}
