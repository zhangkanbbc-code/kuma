// 动画复盘的播放器：编译剧本、按步调度特效与血量结算、播控、时间轴、同步流水、同次出击航迹切场。
//
// 播放模型：`index` 是当前显示的那一步。播放 = 依次「演」下一步：先铺这一步开始时的局面，
// 再按步的种类排特效，命中那一刻把这一步结算完的局面（after）铺上去、血条走两拍；
// 步的时长到了接着演下一步。拖时间轴 / 点流水 / 后退 = 直接把那一步的 after 铺上去，不演。
// 单步前进 = 只演这一步。系统要求减少动画时不放弹道，局面逐步直接落定。
// 离屏、窗口切到「详情」、暂停且没有残留特效时停掉 rAF。

import { compileBattleAnimScript } from '../../shared/battle-anim-script'
import { HIT_FX } from '../../shared/fleet-fx-timing'
import { esc, mg } from '../kernel'
import { PHASE_LABEL, SEIKU } from '../modules/di'
import { BattleStage } from './stage'
import { stepText, trailLabel } from './labels'

import type { AnimHit, AnimMarkerKind, AnimSide, BattleAnimScript, BattleAnimStep } from '../../shared/battle-anim-script'
import type { BattleSnapshot, BattleSnapshotSummary, BattleView } from '../../shared/mg-types'
import type { PlaneKind, Pt } from './fx'

const SPEEDS = [0.5, 1, 1.5, 2, 4] as const

// 维护者 2026-11-26：「战斗的动画不要急，一发打完，停顿一下，再接下一发；空袭就自动拉长这一轮的时间，
// 等飞机撤出了、动画淡出了再进行下一步」。所以一步何时结束不再只看剧本给的时长，取三者最晚：
// 剧本时长、这一步排下的特效全部走完（fx.idleAt）、命中后血条两拍落定；之后再停 STEP_GAP_MS。
const STEP_GAP_MS = 420
// 同一次出手的连击：前一发落地，停一下再打下一发
const HIT_GAP_MS = 260
// 落空时目标侧身一闪（维护者 2026-11-26「miss 的话让攻击对象有一个闪身的动画」）：弹着前 DODGE_LEAD_MS 开始让，
// 落点溅水时正好让到位，停一下再回原位，整个 DODGE_MS
const DODGE_MS = 620
const DODGE_LEAD_MS = 200
// 命中结算后血条两拍走完要多久：取最重那档（编队被弹的残影延迟 + 下降，shared/fleet-fx-timing）
const SETTLE_MS = HIT_FX.drainAt[4] + HIT_FX.drainDur[4]

// 这一步有没有人掉血 / 回血：没有就不必等血条
const changesHp = (step: BattleAnimStep): boolean =>
  (['f', 'e', 'friend'] as const).some((side) =>
    step.after[side].some((ship) => ship.hp !== step.before[side].find((prior) => prior.index === ship.index)?.hp),
  )

const MARKER_TEXT: Record<AnimMarkerKind, string> = {
  smoke: '烟幕',
  night: '进入夜战',
  day: '转入昼战',
  special: '特殊攻击',
  repair: '应急修理',
  taiha: '我方大破',
  'flagship-down': '敌旗舰击沉',
}

export interface BattleAnimHost {
  show(snapshot: BattleSnapshot, trailIndex: readonly BattleSnapshotSummary[]): void
  setTrail(trailIndex: readonly BattleSnapshotSummary[]): void
  /** 动画视图是否正显示着：切到「详情」时暂停并停掉 rAF */
  setActive(active: boolean): void
  destroy(): void
}

const stypeOf = (mstId: number) => mg.master.ships[mstId]?.stype ?? null
const slotTypeOf = (mstId: number) => mg.master.slotitems[mstId]?.type2 ?? null

// 航空命中画哪种飞机：报文里记下的鱼雷 / 炸弹标记为准，喷式、陆攻、夜间各按阶段；没有标记就画「不明」
const planeKindsOf = (step: Extract<BattleAnimStep, { kind: 'air' }>, hit: AnimHit): PlaneKind[] => {
  if (step.jet) return ['jet']
  if (step.phase === 'lbas') return hit.airKind === 'torpedo' ? ['torpedo'] : hit.airKind ? ['heavy'] : ['heavy']
  if (hit.airKind === 'both') return ['torpedo', 'bomb']
  if (hit.airKind === 'torpedo') return ['torpedo']
  if (hit.airKind === 'bomb') return ['bomb']
  return ['generic']
}

export const mountBattleAnim = (host: HTMLElement, opts: { openSnapshot: (id: number) => void }): BattleAnimHost => {
  host.innerHTML = `<div class="ba-app">
    <div class="ba-top"><div class="ba-trail"></div></div>
    <div class="ba-main">
      <div class="ba-stage-host"></div>
      <aside class="ba-log"><header><b>战斗流水</b><span class="ba-log-count"></span></header><ol></ol></aside>
    </div>
    <footer class="ba-controls">
      <div class="ba-buttons">
        <button class="ba-btn primary" data-act="play" title="播放 / 暂停（空格）">▶</button>
        <button class="ba-btn" data-act="prev-stage" title="上一阶段（Shift + ←）">⏮</button>
        <button class="ba-btn" data-act="prev" title="上一步（←）">‹</button>
        <button class="ba-btn" data-act="next" title="下一步（→）">›</button>
        <button class="ba-btn" data-act="next-stage" title="下一阶段（Shift + →）">⏭</button>
        <button class="ba-btn" data-act="restart" title="从头播放（R）">↺</button>
        <button class="ba-btn speed" data-act="speed" title="播放倍速">1x</button>
      </div>
      <div class="ba-scrub">
        <div class="ba-scrub-meta"><span class="ba-now"></span><span class="ba-count"></span></div>
        <div class="ba-track" role="slider" tabindex="0" aria-label="战斗时间轴">
          <div class="ba-progress"></div>
          <div class="ba-markers"></div>
          <div class="ba-knob"></div>
        </div>
      </div>
      <label class="ba-toggle" title="零伤害、全落空的出手一笔带过"><input type="checkbox" data-act="skip"><span>跳过零伤</span></label>
    </footer>
  </div>`
  const app = host.querySelector<HTMLElement>('.ba-app')!
  const stageHost = app.querySelector<HTMLElement>('.ba-stage-host')!
  const trailEl = app.querySelector<HTMLElement>('.ba-trail')!
  const logList = app.querySelector<HTMLElement>('.ba-log ol')!
  const logCount = app.querySelector<HTMLElement>('.ba-log-count')!
  const playBtn = app.querySelector<HTMLButtonElement>('[data-act="play"]')!
  const speedBtn = app.querySelector<HTMLButtonElement>('[data-act="speed"]')!
  const skipBox = app.querySelector<HTMLInputElement>('[data-act="skip"]')!
  const track = app.querySelector<HTMLElement>('.ba-track')!
  const progressEl = app.querySelector<HTMLElement>('.ba-progress')!
  const thumbEl = app.querySelector<HTMLElement>('.ba-knob')!
  const markersEl = app.querySelector<HTMLElement>('.ba-markers')!
  const nowEl = app.querySelector<HTMLElement>('.ba-now')!
  const countEl = app.querySelector<HTMLElement>('.ba-count')!

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')

  let snapshot: BattleSnapshot | null = null
  let battle: BattleView | null = null
  let script: BattleAnimScript | null = null
  let stage: BattleStage | null = null
  let trail: readonly BattleSnapshotSummary[] = []
  let index = 0
  let pending = true // 当前这一步还没演过（刚打开时停在序幕之前）
  let playing = false
  let speed = 1
  let active = true
  let stepTimer: number | null = null
  let stepStartedAt = 0
  // 这一步真正结束的时刻（特效、血条都落定再停一口气）；时间轴的步内进度按它算
  let stepEndsAt = 0
  // 命中后血条两拍落定的时刻（choreograph 排结算时记下）
  let settleAt = 0
  let raf = 0
  // 每一步在时间轴上的起点（1.0x 毫秒）
  let offsets: number[] = []

  const cancelStep = () => {
    if (stepTimer != null) window.clearTimeout(stepTimer)
    stepTimer = null
    stage?.fx.clear()
    stage?.clearFlashes()
    stage?.thaw()
    stage?.hideCutin()
    stage?.hideCard()
  }

  const loop = () => {
    raf = 0
    if (!stage || !active) return
    const now = stage.fx.now()
    stage.fx.tick(now)
    paintProgress(now)
    // 暂停时时间冻住：画完这一帧就停，继续播放时再起
    if (!stage.fx.frozen && (playing || stage.fx.hasActive())) raf = requestAnimationFrame(loop)
  }
  const ensureLoop = () => {
    if (!raf && active) raf = requestAnimationFrame(loop)
  }

  const paintProgress = (now = stage?.fx.now() ?? 0) => {
    if (!script) return
    const total = script.totalMs || 1
    const step = script.steps[index]
    let at = offsets[index] ?? 0
    if (pending) at = offsets[index] ?? 0
    else if (playing && step) at += step.durationMs * Math.min(1, (now - stepStartedAt) / Math.max(1, stepEndsAt - stepStartedAt))
    else if (step) at += step.durationMs
    const pct = Math.max(0, Math.min(100, (at / total) * 100))
    progressEl.style.width = `${pct}%`
    thumbEl.style.left = `${pct}%`
  }

  const updateUi = () => {
    if (!script || !battle) return
    playBtn.textContent = playing ? '❚❚' : '▶'
    speedBtn.textContent = `${speed}x`
    countEl.textContent = `${index + 1} / ${script.steps.length}`
    const step = script.steps[index]
    nowEl.textContent = step ? stepText(battle, step).title : ''
    for (const item of logList.querySelectorAll<HTMLElement>('li')) {
      const on = Number(item.dataset.step) === index
      item.classList.toggle('on', on)
      if (on) item.scrollIntoView({ block: 'nearest' })
    }
    for (const button of trailEl.querySelectorAll<HTMLElement>('[data-snapshot]')) {
      button.classList.toggle('on', Number(button.dataset.snapshot) === snapshot?.id)
    }
    paintProgress()
  }

  const toneOf = (step: BattleAnimStep): string =>
    step.phase ? PHASE_LABEL[step.phase]?.[1] ?? '' : step.kind

  const setHud = (step: BattleAnimStep) => {
    if (!stage || !battle) return
    const text = stepText(battle, step)
    stage.setBanner(text.title, text.detail, toneOf(step))
  }

  // 序幕卡：阵型与航向、索敌、深海开幕台词（日文原文照录）
  const introCard = (step: BattleAnimStep) => {
    if (!battle) return ''
    const text = stepText(battle, step)
    const voice = battle.flavorVoices?.[0]
    return `<div class="ba-card-title">${esc(text.title)}</div>
      <div class="ba-card-sub">${esc(text.detail)}</div>
      ${voice ? `<div class="ba-voice"><b>${esc([voice.className, voice.shipName].filter(Boolean).join(' '))}</b><span>${esc(voice.message)}</span></div>` : ''}`
  }

  const outroCard = (step: BattleAnimStep) => {
    if (!battle) return ''
    const text = stepText(battle, step)
    return `<div class="ba-card-title rank">${esc(text.title)}</div><div class="ba-card-sub">${esc(text.detail)}</div>`
  }

  // 静帧：把第 i 步结算完的局面铺上去
  const seek = (i: number) => {
    if (!script || !stage) return
    cancelStep()
    index = Math.max(0, Math.min(script.steps.length - 1, i))
    pending = false
    const step = script.steps[index]
    stage.applyFrame(step.after, { animate: false, speed })
    setHud(step)
    if (step.kind === 'intro') stage.showCard(introCard(step))
    if (step.kind === 'outro') stage.showCard(outroCard(step))
    if (step.kind === 'special-cutin' && battle) {
      const text = stepText(battle, step)
      stage.showCutin(text.title, text.detail)
    }
    updateUi()
    ensureLoop()
  }

  // 暂停就停在这一帧：飞机、弹道、闪避都冻住，不再自己演完
  const pause = () => {
    playing = false
    if (stepTimer != null) window.clearTimeout(stepTimer)
    stepTimer = null
    stage?.freeze()
    updateUi()
  }

  // 等这一步演完再往下（继续播放、单步演到一半时按播放都走这里）
  const armNext = () => {
    if (stepTimer != null) window.clearTimeout(stepTimer)
    stepTimer = window.setTimeout(() => {
      stepTimer = null
      if (playing) next()
    }, Math.max(0, stepEndsAt - (stage?.fx.now() ?? 0)))
  }

  const next = () => {
    if (!script) return
    if (index < script.steps.length - 1) run(index + 1)
    else {
      playing = false
      updateUi()
    }
  }

  // 演第 i 步
  const run = (i: number) => {
    if (!script || !stage || !battle) return
    cancelStep()
    index = i
    pending = false
    const step = script.steps[i]
    const t0 = stage.fx.now()
    stepStartedAt = t0
    const scale = 1 / speed
    const skip = skipBox.checked && step.dull
    stage.applyFrame(step.before, { animate: false, speed })
    setHud(step)
    if (skip || reduced.matches) {
      stage.applyFrame(step.after, { animate: false, speed })
      if (step.kind === 'special-cutin') {
        const text = stepText(battle, step)
        stage.showCutin(text.title, text.detail)
      }
      updateUi()
      const hold = skip ? 120 : step.durationMs * 0.5
      stepEndsAt = t0 + hold * scale
      armNext()
      ensureLoop()
      return
    }
    settleAt = 0
    choreograph(step, t0, scale)
    updateUi()
    stepEndsAt = Math.max(t0 + step.durationMs * scale, stage.fx.idleAt(), settleAt) + STEP_GAP_MS * scale
    armNext()
    ensureLoop()
  }

  // 在某个时刻把这一步结算完的局面铺上去；有人掉血时记下血条落定的时刻，这一步要等它
  const commit = (step: BattleAnimStep, at: number, animate = true) => {
    if (animate && changesHp(step)) settleAt = Math.max(settleAt, at + SETTLE_MS / speed)
    stage!.fx.cue(at, () => stage?.applyFrame(step.after, { animate, speed }))
  }
  const commitLater = commit

  // 落空：目标在弹着前侧身让开；这一步要等它回到原位再往下走
  const evade = (side: AnimSide, index: number, impact: number) => {
    const s = stage!
    const start = impact - DODGE_LEAD_MS / speed
    const span = DODGE_MS / speed
    s.fx.cue(start, () => s.dodge(side, index, span))
    settleAt = Math.max(settleAt, start + span)
  }

  // 按种类排这一步的特效；命中时刻铺 after
  const choreograph = (step: BattleAnimStep, t0: number, scale: number) => {
    const s = stage!
    const b = battle!
    const at = (ms: number) => t0 + ms * scale
    const dur = (ms: number) => ms * scale
    const size = s.size
    const mid: Pt = { x: size.width / 2, y: size.height * 0.48 }
    // 照明弹从投放舰头顶升起、缓缓落下
    const fireFlares = (startMs: number, spanMs: number) => {
      b.flarePos?.forEach((pos, side) => {
        if (pos >= 0) s.fx.flare(s.anchor(side as AnimSide, pos), at(startMs), dur(spanMs))
      })
    }
    switch (step.kind) {
      case 'intro':
        s.showCard(introCard(step))
        // 夜战点 / 拂晓战开场就是夜：照明弹在序幕里升起（昼转夜的在转场那一步）
        if (step.after.env.flare) fireFlares(step.durationMs * 0.45, step.durationMs * 0.5)
        return
      case 'smoke':
        commitLater(step, at(200), false)
        return
      case 'transition': {
        commitLater(step, at(step.durationMs * 0.35), false)
        if (step.after.env.flare) fireFlares(step.durationMs * 0.45, step.durationMs * 0.5)
        return
      }
      case 'air': {
        // 一波航空战连着演：双方机群飞进中空缠斗，盘旋到 strikeAtMs 时活下来的攻击机直接从缠斗里扑向目标，
        // 对空弹幕在它们进场途中打，投弹后拉升离场；不投弹的幸存机调头返航
        s.showChips(step.after)
        // 每一击要飞几趟（按机种：鱼雷、炸弹各一趟）
        const flights = step.strikes.flatMap((hit, n) => planeKindsOf(step, hit).map((kind, k) => ({ hit, n, kind, k })))
        const sideOf = (attackerSide: AnimSide) => (attackerSide === 1 ? 'foe' : 'ally')
        const handed =
          step.clash && step.air
            ? s.fx.dogfight({
                center: mid,
                at: at(0),
                duration: dur(step.clashMs),
                ally: { count: step.air.fCount, lost: step.air.fLost },
                foe: { count: step.air.eCount, lost: step.air.eLost },
                allySide: step.phase === 'friendlyAir' ? 2 : 0,
                handoff: {
                  ally: flights.filter((flight) => sideOf(flight.hit.attackerSide) === 'ally').length,
                  foe: flights.filter((flight) => sideOf(flight.hit.attackerSide) === 'foe').length,
                },
              })
            : null
        const strikeAt = at(step.strikeAtMs)
        if (step.aaciShip != null) {
          s.flash(0, step.aaciShip, 'aaci', dur(step.aaciMs + 400))
          s.fx.aaBurst(s.anchor(0, step.aaciShip), strikeAt, dur(step.aaciMs + 300))
        }
        if (!flights.length) return commitLater(step, at(step.durationMs * 0.8), false)
        const stagger = Math.min(110, ((step.durationMs - step.strikeAtMs) * 0.3) / step.strikes.length)
        const used = { ally: 0, foe: 0 }
        let last = 0
        flights.forEach(({ hit, n, kind, k }) => {
          const to = s.anchor(hit.targetSide, hit.target)
          const side = sideOf(hit.attackerSide)
          const pool = handed?.[side] ?? []
          let from: Pt
          let start: number
          let travel: number
          if (pool.length) {
            // 从缠斗里那架幸存机当时的位置直接飞出去，同一刻一齐扑出；一架要分几趟时稍稍错开位置，
            // 落点靠飞行时长错开
            const slot = used[side]++
            const spot = pool[slot % pool.length]
            const round = Math.floor(slot / pool.length)
            from = { x: spot.x, y: spot.y + round * 8 }
            start = handed!.at
            travel = dur(1150 + (n % 4) * 90 + k * 60)
          } else {
            from = { x: s.edge(hit.attackerSide).x, y: s.edge(hit.attackerSide).y + (n % 4) * 18 + k * 14 }
            start = strikeAt + dur(n * stagger + k * 90)
            travel = dur(1500)
          }
          const impact = s.fx.plane({ from, to, at: start, travel, kind, side: hit.attackerSide, miss: hit.damage === 0, big: hit.critical })
          last = Math.max(last, impact)
          if (hit.damage > 0) s.fx.cue(impact, () => s.flash(hit.targetSide, hit.target, hit.protect ? 'protect' : 'hit', 420))
          else evade(hit.targetSide, hit.target, impact)
        })
        commit(step, last)
        if (step.rescue) s.fx.rescue(last + dur(120), dur(1000), step.rescue)
        return
      }
      case 'support': {
        let last = 0
        step.hits.forEach((hit, n) => {
          const to = s.anchor(hit.targetSide, hit.target)
          const impact =
            step.mode === 'gun'
              ? s.fx.shot({ from: { x: -10, y: size.height - 40 - (n % 3) * 20 }, to, at: at(n * 120), travel: dur(820), kind: 'shell', miss: hit.damage === 0, big: hit.critical })
              : s.fx.plane({ from: s.edge(0), to, at: at(n * 120), travel: dur(1400), kind: 'generic', side: 0, miss: hit.damage === 0, big: hit.critical })
          last = Math.max(last, impact)
          if (hit.damage === 0) evade(hit.targetSide, hit.target, impact)
        })
        commit(step, last || at(step.durationMs * 0.5))
        return
      }
      case 'torpedo-salvo': {
        let last = 0
        step.torpedoes.forEach((hit, n) => {
          const from = s.anchor(hit.side, hit.attacker)
          const to = s.anchor(hit.targetSide, hit.target)
          const impact = s.fx.torpedo({ from, to, at: at(60 + (n % 6) * 30), travel: dur(1150), miss: hit.damage === 0, big: hit.critical })
          last = Math.max(last, impact)
          if (hit.damage > 0) s.fx.cue(impact, () => s.flash(hit.targetSide, hit.target, hit.protect ? 'protect' : 'hit', 420))
          else evade(hit.targetSide, hit.target, impact)
        })
        commit(step, last || at(step.durationMs * 0.5))
        return
      }
      case 'special-cutin': {
        const text = stepText(b, step)
        s.showCutin(text.title, text.detail)
        for (const who of step.participants) s.flash(step.side, who, 'special', dur(step.durationMs))
        return
      }
      case 'attack': {
        s.flash(step.side, step.attacker, 'acting', dur(step.durationMs * 0.6))
        const from = s.anchor(step.side, step.attacker)
        let last = 0
        // 连击一发一发来：前一发落地，停 HIT_GAP_MS 再打下一发
        let next = at(120)
        step.hits.forEach((hit) => {
          const to = s.anchor(hit.targetSide, hit.target)
          const start = next
          const miss = hit.hitState === 'miss' || (hit.damage === 0 && hit.hitState !== 'hit')
          const common = { from, to, at: start, miss, big: hit.critical }
          let impact = 0
          switch (step.weapon) {
            case 'shell':
              impact = s.fx.shot({ ...common, travel: dur(620), kind: 'shell' })
              break
            case 'special':
              impact = s.fx.shot({ ...common, travel: dur(680), kind: 'heavy' })
              break
            case 'radar-shell':
              impact = s.fx.shot({ ...common, travel: dur(700), kind: 'radar' })
              break
            case 'torpedo':
              impact = s.fx.torpedo({ ...common, travel: dur(900) })
              break
            case 'gun-torpedo':
              s.fx.shot({ ...common, travel: dur(620), kind: 'shell', miss: true })
              impact = s.fx.torpedo({ ...common, travel: dur(900) })
              break
            case 'asw':
              impact = s.fx.depthCharge({ ...common, travel: dur(620) })
              break
            case 'air-asw':
              impact = s.fx.plane({ ...common, travel: dur(1200), kind: 'asw', side: step.side })
              break
            case 'night-carrier':
              impact = s.fx.plane({ ...common, travel: dur(1200), kind: 'night', side: step.side })
              break
            case 'seaplane':
              impact = s.fx.plane({ ...common, travel: dur(1200), kind: 'seaplane', side: step.side })
              break
            case 'gun-seaplane':
              // 水上轰炸机先起飞；主炮掐着时间开火，炮弹和炸弹同一刻落到目标
              impact = s.fx.plane({ ...common, travel: dur(1200), kind: 'seaplane', side: step.side })
              s.fx.shot({ ...common, at: impact - dur(620), travel: dur(620), kind: 'shell' })
              break
            case 'carrier': {
              const kinds: PlaneKind[] = step.aircraft
                ? [...(step.aircraft.torpedo ? (['torpedo'] as const) : []), ...(step.aircraft.bomb ? (['bomb'] as const) : [])]
                : []
              const list = kinds.length ? kinds : (['generic'] as PlaneKind[])
              list.forEach((kind, k) => {
                impact = Math.max(impact, s.fx.plane({ ...common, from: { x: from.x, y: from.y - 8 + k * 14 }, at: start + k * dur(90), travel: dur(1200), kind, side: step.side }))
              })
              break
            }
          }
          last = Math.max(last, impact)
          next = impact + dur(HIT_GAP_MS)
          if (!miss) s.fx.cue(impact, () => s.flash(hit.targetSide, hit.target, hit.protect ? 'protect' : 'hit', 420))
          else evade(hit.targetSide, hit.target, impact)
        })
        commit(step, last || at(step.durationMs * 0.5))
        return
      }
      case 'outro':
        s.applyFrame(step.after, { animate: false, speed })
        s.showCard(outroCard(step))
        return
    }
  }

  const play = () => {
    if (!script || !stage) return
    playing = true
    // 停在一步中间：从停下的那一帧接着演完这一步，再往下
    if (!pending && stage.fx.now() < stepEndsAt) {
      stage.thaw()
      armNext()
      updateUi()
      ensureLoop()
      return
    }
    stage.thaw()
    if (pending) run(index)
    else if (index >= script.steps.length - 1) run(0)
    else run(index + 1)
  }

  // 阶段分组：同一个 stage 的步算一段；序幕 / 转场 / 烟幕 / 尾声各自成段
  const groupOf = (i: number) => {
    const step = script?.steps[i]
    return step ? `${step.stage ?? `k${i}`}` : ''
  }
  const stageStart = (i: number) => {
    let at = i
    while (at > 0 && groupOf(at - 1) === groupOf(i)) at -= 1
    return at
  }

  const buildLog = () => {
    if (!script || !battle) return
    logList.innerHTML = script.steps
      .map((step, i) => {
        const text = stepText(battle!, step)
        const phase = step.phase ? PHASE_LABEL[step.phase]?.[0] ?? '' : ''
        return `<li data-step="${i}" class="${step.dull ? 'dull' : ''}"><span class="ph">${esc(phase)}</span><span class="t">${esc(text.title)}</span><span class="d">${esc(text.detail)}</span></li>`
      })
      .join('')
    logCount.textContent = `${script.steps.length} 步`
  }

  const buildMarkers = () => {
    if (!script) return
    const total = script.totalMs || 1
    markersEl.innerHTML = script.markers
      .map((marker) => {
        const left = (((offsets[marker.step] ?? 0) + script!.steps[marker.step].durationMs / 2) / total) * 100
        return `<i class="ba-marker ${marker.kind}" style="left:${left}%" title="${esc(MARKER_TEXT[marker.kind])}"></i>`
      })
      .join('')
  }

  const buildTrail = () => {
    trailEl.innerHTML = trail.length > 1
      ? trail.map((row) => `<button data-snapshot="${row.id}"${row.isBoss ? ' class="boss"' : ''}>${esc(trailLabel(row))}</button>`).join('')
      : ''
  }

  // 拖时间轴：按 1.0x 时间比例落到对应的步
  const stepAtFraction = (fraction: number) => {
    if (!script) return 0
    const target = fraction * script.totalMs
    let i = 0
    while (i < script.steps.length - 1 && offsets[i + 1] <= target) i += 1
    return i
  }
  let dragging = false
  const scrubTo = (event: PointerEvent) => {
    const rect = track.getBoundingClientRect()
    const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)))
    const i = stepAtFraction(fraction)
    if (i !== index || pending) {
      pause()
      seek(i)
    }
  }
  track.addEventListener('pointerdown', (event) => {
    dragging = true
    track.setPointerCapture(event.pointerId)
    scrubTo(event)
  })
  track.addEventListener('pointermove', (event) => {
    if (dragging) scrubTo(event)
  })
  track.addEventListener('pointerup', () => {
    dragging = false
  })

  app.addEventListener('click', (event) => {
    const target = event.target as HTMLElement
    const trailButton = target.closest<HTMLElement>('[data-snapshot]')
    if (trailButton) {
      const id = Number(trailButton.dataset.snapshot)
      if (id && id !== snapshot?.id) opts.openSnapshot(id)
      return
    }
    const logItem = target.closest<HTMLElement>('.ba-log li')
    if (logItem) {
      pause()
      seek(Number(logItem.dataset.step))
      return
    }
    const act = target.closest<HTMLElement>('[data-act]')?.dataset.act
    if (!act || !script) return
    if (act === 'play') playing ? pause() : play()
    else if (act === 'next') {
      pause()
      if (pending) run(index)
      else if (index < script.steps.length - 1) run(index + 1)
    } else if (act === 'prev') {
      pause()
      seek(index - 1)
    } else if (act === 'next-stage') {
      pause()
      let i = index
      while (i < script.steps.length - 1 && groupOf(i) === groupOf(index)) i += 1
      seek(i)
    } else if (act === 'prev-stage') {
      pause()
      const start = stageStart(index)
      seek(start < index ? start : stageStart(Math.max(0, start - 1)))
    } else if (act === 'restart') {
      pause()
      cancelStep()
      index = 0
      pending = true
      play()
    } else if (act === 'speed') {
      const at = SPEEDS.indexOf(speed as (typeof SPEEDS)[number])
      speed = SPEEDS[(at + 1) % SPEEDS.length]
      updateUi()
    }
  })

  const onKey = (event: KeyboardEvent) => {
    if (!active || !script) return
    const target = event.target as HTMLElement | null
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
    const click = (act: string) => app.querySelector<HTMLElement>(`[data-act="${act}"]`)?.click()
    if (event.key === ' ') click('play')
    else if (event.key === 'ArrowRight') click(event.shiftKey ? 'next-stage' : 'next')
    else if (event.key === 'ArrowLeft') click(event.shiftKey ? 'prev-stage' : 'prev')
    else if (event.key === 'r' || event.key === 'R') click('restart')
    else return
    event.preventDefault()
  }
  window.addEventListener('keydown', onKey)
  // 勾完「跳过零伤」把焦点还回去，不然空格只会反复勾它，不再播放 / 暂停
  skipBox.addEventListener('change', () => skipBox.blur())

  return {
    show(next, trailIndex) {
      pause()
      cancelStep()
      stage?.destroy()
      stage = null
      snapshot = next
      battle = next.sortie.battle
      trail = trailIndex
      buildTrail()
      if (!battle) {
        stageHost.innerHTML = '<div class="ba-empty">暂无这一场的战斗记录</div>'
        script = null
        // 上一场的流水、步数、标记与进度一并清掉
        logList.innerHTML = ''
        logCount.textContent = ''
        markersEl.innerHTML = ''
        countEl.textContent = ''
        nowEl.textContent = ''
        progressEl.style.width = '0%'
        thumbEl.style.left = '0%'
        return
      }
      script = compileBattleAnimScript(battle, { stypeOf, slotTypeOf })
      offsets = []
      let sum = 0
      for (const step of script.steps) {
        offsets.push(sum)
        sum += step.durationMs
      }
      stage = new BattleStage(stageHost, battle, { seikuText: (seiku) => SEIKU[seiku] ?? '' })
      index = 0
      pending = true
      const intro = script.steps[0]
      stage.applyFrame(intro.before, { animate: false, speed })
      setHud(intro)
      stage.showCard(introCard(intro))
      buildLog()
      buildMarkers()
      updateUi()
      // 打开即播：从序幕开始演
      play()
    },
    setTrail(trailIndex) {
      trail = trailIndex
      buildTrail()
      updateUi()
    },
    setActive(next) {
      active = next
      if (!next) pause()
      else {
        stage?.layout()
        ensureLoop()
      }
    },
    destroy() {
      pause()
      cancelStep()
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey)
      stage?.destroy()
      host.innerHTML = ''
    },
  }
}

