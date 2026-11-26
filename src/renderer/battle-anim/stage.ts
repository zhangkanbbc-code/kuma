// 动画复盘的兵牌舞台：DOM 兵牌层 + 两张特效 canvas（海面在下、特效在上）+ 顶部阶段条与环境标记。
//
// - 兵牌按实际阵型排开（shared/battle-anim-formation），舞台尺寸一变就重排；兵牌节点常驻，只改位置与内容。
// - 兵牌用 kuma 的小头像（entity-art 的 shipThumbHtml，缺图退回首字），中破起换受损图（setShipThumbTier 就地换，不重建节点）。
// - 血条两拍：命中那一刻实血落到新值、掉的那截变残影；停一口气后残影单向收干。
//   延迟与时长取编队被弹动画的节拍表（shared/fleet-fx-timing），全 kuma 同一种手感；按播放倍速缩放。
//   禁止给实血 / 残影写常驻 width 过渡：拖时间轴、静帧时一律直接落到终值。

import { damageTierOf } from '../../shared/battle-damage'
import { fitFormation, formationPoints } from '../../shared/battle-anim-formation'
import { HIT_FX } from '../../shared/fleet-fx-timing'
import { setShipThumbTier, shipThumbHtml } from '../entity-art'
import { esc } from '../kernel'
import { damageState, hpClass } from '../modules/di'
import { FxEngine, type Pt } from './fx'
import { shipNameOf } from './labels'

import type { AnimFrame, AnimShipState, AnimSide } from '../../shared/battle-anim-script'
import type { BattleShipView, BattleView } from '../../shared/mg-types'

interface TokenRefs {
  el: HTMLElement
  thumb: HTMLElement | null
  solid: HTMLElement
  ghost: HTMLElement
  num: HTMLElement
  stamp: HTMLElement
  dealt: HTMLElement
  meta: BattleShipView
  side: AnimSide
  cx: number
  cy: number
  w: number
  h: number
  /** 正在播的闪避动画（落空时侧身一闪） */
  dodging: Animation | null
}

const HUD_TOP = 58
const SIDE_GUTTER = 0.02
const CENTER_GAP = 0.05

// 被弹档 1–4（擦伤 / 小破线 / 中破线 / 大破线），与编队被弹动画同一种分档
const severityOf = (hp: number, hpMax: number): 1 | 2 | 3 | 4 => {
  const tier = damageTierOf(hp, hpMax)
  return tier === 'heavy' ? 4 : tier === 'medium' ? 3 : tier === 'light' ? 2 : 1
}

export class BattleStage {
  readonly root: HTMLElement
  readonly fx: FxEngine
  private layer: HTMLElement
  private banner: HTMLElement
  private chips: HTMLElement
  private cutin: HTMLElement
  private card: HTMLElement
  private tokens = new Map<string, TokenRefs>()
  private battle: BattleView
  private resizeObserver: ResizeObserver
  private width = 0
  private height = 0
  // 制空状态的叫法由播放器按镝的词表给（舞台不认词）；每次铺局面重建环境标记时都要用到
  private seikuText: (seiku: number) => string

  constructor(host: HTMLElement, battle: BattleView, words: { seikuText: (seiku: number) => string }) {
    this.battle = battle
    this.seikuText = words.seikuText
    host.innerHTML = `<div class="ba-stage">
      <canvas class="ba-sea" aria-hidden="true"></canvas>
      <div class="ba-hud">
        <div class="ba-banner"><b></b><span></span></div>
        <div class="ba-chips"></div>
      </div>
      <div class="ba-layer"></div>
      <canvas class="ba-fx" aria-hidden="true"></canvas>
      <div class="ba-cutin" hidden></div>
      <div class="ba-card" hidden></div>
    </div>`
    this.root = host.querySelector<HTMLElement>('.ba-stage')!
    this.layer = this.root.querySelector<HTMLElement>('.ba-layer')!
    this.banner = this.root.querySelector<HTMLElement>('.ba-banner')!
    this.chips = this.root.querySelector<HTMLElement>('.ba-chips')!
    this.cutin = this.root.querySelector<HTMLElement>('.ba-cutin')!
    this.card = this.root.querySelector<HTMLElement>('.ba-card')!
    this.fx = new FxEngine(
      this.root.querySelector<HTMLCanvasElement>('.ba-sea')!,
      this.root.querySelector<HTMLCanvasElement>('.ba-fx')!,
      this.root,
    )
    this.buildTokens()
    this.resizeObserver = new ResizeObserver(() => this.layout())
    this.resizeObserver.observe(this.root)
    this.layout()
  }

  destroy() {
    this.resizeObserver.disconnect()
    this.fx.destroy()
    this.root.remove()
  }

  private key(side: AnimSide, index: number) {
    return `${side}:${index}`
  }

  private buildTokens() {
    const battle = this.battle
    const sides: [AnimSide, readonly BattleShipView[]][] = [
      [0, battle.fShips],
      [1, battle.eShips],
      [2, battle.friendShips ?? []],
    ]
    for (const [side, ships] of sides) {
      for (const meta of ships) {
        const el = document.createElement('div')
        el.className = `ba-token side-${side}${meta.unattackable ? ' unattackable' : ''}${meta.escaped ? ' escaped' : ''}${meta.index === 0 || (meta.fleet === 'escort' && meta.index === 6) ? ' flag' : ''}`
        el.dataset.side = `${side}`
        el.dataset.index = `${meta.index}`
        const name = shipNameOf(battle, side, meta.index)
        el.title = `${name} Lv${meta.lv}`
        // 头像在上、舰名叠在头像底边；血条与血量数字并一行；累计输出是头像角上的小标
        el.innerHTML = `<span class="ba-art">${shipThumbHtml(meta.mstId, meta.name, { className: 'ba-thumb' })}
            <span class="ba-name">${esc(name)}</span><span class="ba-dealt"></span></span>
          <span class="ba-hprow"><span class="ba-hp"><i class="ba-solid"></i><i class="ba-ghost"></i></span><span class="ba-num"></span></span>
          <span class="ba-stamp"></span>`
        this.layer.appendChild(el)
        this.tokens.set(this.key(side, meta.index), {
          el,
          thumb: el.querySelector<HTMLElement>('.ship-thumb'),
          solid: el.querySelector<HTMLElement>('.ba-solid')!,
          ghost: el.querySelector<HTMLElement>('.ba-ghost')!,
          num: el.querySelector<HTMLElement>('.ba-num')!,
          stamp: el.querySelector<HTMLElement>('.ba-stamp')!,
          dealt: el.querySelector<HTMLElement>('.ba-dealt')!,
          meta,
          side,
          cx: 0,
          cy: 0,
          w: 0,
          h: 0,
          dodging: null,
        })
      }
    }
  }

  /** 按舞台尺寸重排兵牌（我方左、敌方右、NPC 友军在我方那半边下方） */
  layout() {
    const rect = this.root.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    this.width = rect.width
    this.height = rect.height
    this.fx.resize(rect.width, rect.height)
    const battle = this.battle
    const halfW = rect.width * (0.5 - SIDE_GUTTER - CENTER_GAP / 2)
    const top = HUD_TOP
    const usableH = rect.height - top - 14
    const friendH = battle.friendShips?.length ? usableH * 0.42 : 0
    type Box = { left: number; top: number; width: number; height: number }
    const groups: { side: AnimSide; ships: readonly BattleShipView[]; formation: number; box: Box }[] = [
      { side: 0, ships: battle.fShips, formation: battle.fFormation, box: { left: rect.width * SIDE_GUTTER, top, width: halfW, height: usableH - friendH } },
      { side: 1, ships: battle.eShips, formation: battle.eFormation, box: { left: rect.width * (0.5 + CENTER_GAP / 2), top, width: halfW, height: usableH } },
    ]
    // NPC 友军的阵型报文里没有，排成单横（同时入场、同时离场）
    if (battle.friendShips?.length) {
      groups.push({ side: 2, ships: battle.friendShips, formation: 5, box: { left: rect.width * SIDE_GUTTER, top: top + usableH - friendH, width: halfW, height: friendH } })
    }
    const pointsOf = (group: (typeof groups)[number]) => formationPoints(group.formation, group.ships.map((ship) => ship.index))
    // 敌我兵牌一样大：各自先试出能放多大，取最小的那个，大家都按它排
    const shared = Math.min(...groups.filter((group) => group.ships.length).map((group) => fitFormation(pointsOf(group), group.side === 1 ? 1 : 0, group.box).width))
    const place = (side: AnimSide, ships: readonly BattleShipView[], formation: number, box: Box) => {
      const fitted = fitFormation(formationPoints(formation, ships.map((ship) => ship.index)), side === 1 ? 1 : 0, box, shared)
      for (const token of fitted.tokens) {
        const refs = this.tokens.get(this.key(side, token.index))
        if (!refs) continue
        refs.cx = token.cx
        refs.cy = token.cy
        refs.w = fitted.width
        refs.h = fitted.height
        refs.el.style.width = `${fitted.width}px`
        refs.el.style.height = `${fitted.height}px`
        refs.el.style.transform = `translate(${token.cx - fitted.width / 2}px, ${token.cy - fitted.height / 2}px)`
        refs.el.classList.toggle('compact', fitted.width < 72)
      }
    }
    for (const group of groups) place(group.side, group.ships, group.formation, group.box)
  }

  /** 某艘舰兵牌的中心（特效的起止点） */
  anchor(side: AnimSide, index: number): Pt {
    const refs = this.tokens.get(this.key(side, index))
    if (refs) return { x: refs.cx, y: refs.cy }
    // 找不到就落在那一方阵地中央，不让特效飞出画面
    return { x: side === 1 ? this.width * 0.75 : this.width * 0.25, y: this.height * 0.5 }
  }

  /** 一方阵地的外侧边（飞机从这里进场） */
  edge(side: AnimSide): Pt {
    return { x: side === 1 ? this.width + 20 : -20, y: HUD_TOP + 20 }
  }

  get size() {
    return { width: this.width, height: this.height }
  }

  /**
   * 把一帧的状态铺到兵牌上。`animate` 为真时血条走两拍（命中结算那一刻用），
   * 否则直接落到终值（拖时间轴、静帧、跳步）。
   */
  applyFrame(frame: AnimFrame, { animate, speed }: { animate: boolean; speed: number }) {
    const groups: [AnimSide, AnimShipState[]][] = [
      [0, frame.f],
      [1, frame.e],
      [2, frame.friend],
    ]
    for (const [side, ships] of groups) {
      for (const ship of ships) {
        const refs = this.tokens.get(this.key(side, ship.index))
        if (refs) this.applyShip(refs, ship, animate, speed)
      }
    }
    const env = frame.env
    this.root.classList.toggle('night', env.night)
    this.root.classList.toggle('friend-in', env.friendVisible)
    // 夜战只有实际参战的那一队在前，另一队退到后面（联合舰队）
    for (const refs of this.tokens.values()) {
      // 联合舰队的护卫队才算第二队；游击部队的第 7 舰（舰位 6）仍在主力队里
      const deck = refs.meta.fleet === 'escort' ? 2 : 1
      const sideDeck = env.activeDeck ? (refs.side === 0 ? env.activeDeck[0] : refs.side === 1 ? env.activeDeck[1] : 0) : 0
      const benched = env.night && !!env.activeDeck && refs.side !== 2 && sideDeck !== 0 && deck !== sideDeck && this.isCombined(refs.side)
      refs.el.classList.toggle('benched', benched)
    }
    this.setChips(frame)
    this.fx.setScene({
      night: env.night,
      balloon: env.balloon ? this.balloonPoints() : [],
      smoke: env.smoke,
      smokeBox: env.smoke > 0 ? { left: this.width * 0.38, right: this.width * 0.62, top: HUD_TOP, bottom: this.height - 20 } : null,
    })
    this.fx.setBalloonLit(env.balloonHighlight)
  }

  private isCombined(side: AnimSide) {
    const ships = side === 0 ? this.battle.fShips : this.battle.eShips
    return ships.some((ship) => ship.fleet === 'escort')
  }

  private balloonPoints(): Pt[] {
    return [0.12, 0.24, 0.36].map((fx) => ({ x: this.width * fx, y: HUD_TOP + 26 }))
  }

  private applyShip(refs: TokenRefs, ship: AnimShipState, animate: boolean, speed: number) {
    const full = ship.hpMax > 0 ? ship.hpMax : 1
    const solidPct = Math.max(0, Math.min(100, (ship.hp / full) * 100))
    const droppedPct = Math.max(0, Math.min(100 - solidPct, ((ship.hpBefore - ship.hp) / full) * 100))
    const ratio = ship.hp / full
    refs.solid.className = `ba-solid hp-${hpClass(ratio)}`
    const { solid, ghost } = refs
    solid.style.transition = 'none'
    ghost.style.transition = 'none'
    ghost.style.left = `${solidPct}%`
    if (animate && ship.repairedThisStep) {
      // 应急修理：实血先空，停一口气后单向涨回
      solid.style.width = '0%'
      ghost.style.width = '0%'
      void solid.offsetWidth
      solid.style.transition = `width ${Math.round(720 / speed)}ms cubic-bezier(.2,.82,.28,1) ${Math.round(320 / speed)}ms`
      solid.style.width = `${solidPct}%`
    } else if (animate && droppedPct > 0) {
      solid.style.width = `${solidPct}%`
      ghost.style.width = `${droppedPct}%`
      void ghost.offsetWidth
      const severity = severityOf(ship.hp, ship.hpMax)
      ghost.style.transition = `width ${Math.round(HIT_FX.drainDur[severity] / speed)}ms cubic-bezier(.22,1,.36,1) ${Math.round(HIT_FX.drainAt[severity] / speed)}ms`
      ghost.style.width = '0%'
    } else {
      solid.style.width = `${solidPct}%`
      ghost.style.width = '0%'
    }
    refs.num.textContent = ship.unattackable ? '—' : `${ship.hp}/${ship.hpMax}`
    const state = ship.unattackable
      ? null
      : damageState(refs.meta, this.battle.practice, { hp: ship.hp, sunk: this.battle.practice ? ship.defeated : ship.sunk })
    refs.stamp.textContent = state?.[0] ?? ''
    refs.stamp.style.color = state?.[1] ?? ''
    refs.el.classList.toggle('stamped', !!state)
    refs.el.classList.toggle('down', this.battle.practice ? ship.defeated : ship.sunk)
    refs.dealt.textContent = ship.dealt > 0 ? `${ship.dealt}` : ''
    const tier = damageTierOf(ship.hp, full)
    setShipThumbTier(refs.thumb, { sunk: !this.battle.practice && ship.sunk, damaged: tier === 'medium' || tier === 'heavy' })
  }

  /** 航空战一开场就亮出新的制空状态（局面要等命中才落，环境标记不必等） */
  showChips(frame: AnimFrame) {
    this.setChips(frame)
  }

  private setChips(frame: AnimFrame) {
    const env = frame.env
    const chips: string[] = []
    if (env.seiku != null) chips.push(`<span class="ba-chip air">${esc(this.seikuText(env.seiku))}</span>`)
    if (env.smoke > 0) chips.push(`<span class="ba-chip smoke">烟幕 ×${env.smoke}</span>`)
    if (env.balloon) chips.push('<span class="ba-chip">阻塞气球</span>')
    if (env.flare) chips.push('<span class="ba-chip flare">照明弹</span>')
    if (env.nightContact) chips.push('<span class="ba-chip night">夜间触接</span>')
    this.chips.innerHTML = chips.join('')
  }

  setBanner(title: string, detail: string, tone = '') {
    this.banner.dataset.tone = tone
    this.banner.querySelector('b')!.textContent = title
    this.banner.querySelector('span')!.textContent = detail
  }

  /** 让一艘舰的兵牌闪一下：acting 出手、hit 被击中、protect 护卫、aaci 对空 */
  flash(side: AnimSide, index: number, kind: 'acting' | 'hit' | 'protect' | 'aaci' | 'special', duration: number) {
    const refs = this.tokens.get(this.key(side, index))
    if (!refs) return
    refs.el.classList.remove(kind)
    void refs.el.offsetWidth
    refs.el.classList.add(kind)
    window.setTimeout(() => refs.el.classList.remove(kind), duration)
  }

  /**
   * 落空：被瞄准的兵牌侧身一闪——往左让开（落空的弹着点都偏在目标右下，见 fx.impact），停一下再回原位，
   * 原位那条边留一道残影。同一艘还没闪完就不重来：齐射里几发同时落空只闪一次，不抖。
   * 用 translate 属性做，不碰排位用的 transform；位移按兵牌宽度取比例（取整像素，停住那一下字不发虚），大小兵牌看着一样。
   */
  dodge(side: AnimSide, index: number, duration: number) {
    const refs = this.tokens.get(this.key(side, index))
    if (!refs || refs.dodging?.playState === 'running') return
    const away = `${-Math.max(4, Math.round(refs.w * 0.14))}px 0`
    refs.dodging = refs.el.animate(
      [
        { translate: '0 0', easing: 'cubic-bezier(.2, .8, .3, 1)' },
        { translate: away, offset: 0.3 },
        { translate: away, offset: 0.55, easing: 'cubic-bezier(.45, 0, .3, 1)' },
        { translate: '0 0' },
      ],
      { duration },
    )
    this.fx.afterimage({ x: refs.cx, y: refs.cy, w: refs.w, h: refs.h }, this.fx.now(), duration * 0.6, side, -1)
  }

  /** 暂停：特效时钟冻住，正在闪的兵牌停在那一帧 */
  get frozen() {
    return this.fx.frozen
  }

  freeze() {
    this.fx.freeze()
    for (const refs of this.tokens.values()) refs.dodging?.pause()
  }

  thaw() {
    this.fx.thaw()
    for (const refs of this.tokens.values()) if (refs.dodging?.playState === 'paused') refs.dodging.play()
  }

  clearFlashes() {
    for (const refs of this.tokens.values()) {
      refs.el.classList.remove('acting', 'hit', 'protect', 'aaci', 'special')
      refs.dodging?.cancel()
      refs.dodging = null
    }
  }

  showCutin(title: string, detail: string) {
    this.cutin.innerHTML = `<b>${esc(title)}</b><span>${esc(detail)}</span>`
    this.cutin.hidden = false
  }

  hideCutin() {
    this.cutin.hidden = true
  }

  // 序幕 / 战果卡出现时顶部阶段条让开：同一句话不在两处各说一遍
  showCard(html: string) {
    this.card.innerHTML = html
    this.card.hidden = false
    this.root.classList.add('carded')
  }

  hideCard() {
    this.card.hidden = true
    this.root.classList.remove('carded')
  }
}
