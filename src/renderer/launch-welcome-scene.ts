// 季节层只拥有自己创建的节点与场景监听；欢迎屏的四条退场路统一调用 dispose。
// 位移、摆动与旋转分层承载；动画只挂 HTML 且只用 replace，界面线程忙时仍由合成线程推进。
import { LAUNCH_SEASON_TIMING as T } from '../shared/launch-glow'
import type { WelcomeScene, WelcomeSeason } from '../shared/launch-welcome-scene'

const SVG_NS = 'http://www.w3.org/2000/svg'
type Node = HTMLElement | SVGElement
type Css = Record<string, string | number | (() => string | number)>
type Motion = [name: string, duration: number, delay?: number, easing?: string, repeat?: boolean, fill?: string]
interface Plate { x: number; y: number; w: number; h: number; cx: number; cy: number }

export interface WelcomeSceneMount { syncPlate(): void; dispose(): void }

/** 以后按活动海域 id 登记基调幕。通用作战灯不依赖基调，旧夏活示例不登记。 */
export const WELCOME_EVENT_TONES: Partial<Record<number, (stage: WelcomeSceneStage, scene: Extract<WelcomeScene, { key: 'event' }>) => void>> = {}

export interface WelcomeSceneStage {
  scene: HTMLElement
  deco: HTMLElement
  plate: Plate
  width: number
  height: number
  html(parent: Node, className: string, css?: Css): HTMLElement
  glyph(parent: Node, symbol: string, width: number, height: number, css?: Css): HTMLElement
  svg(parent: Node, width: number, height: number): SVGSVGElement
  shape(parent: SVGSVGElement, tag: string, attrs: Css, className?: string): SVGElement
  motion(node: HTMLElement, ...motions: Motion[]): void
  random(min: number, max: number): number
}

export const mountWelcomeScene = (
  layer: HTMLElement,
  box: HTMLElement,
  selection: WelcomeScene,
  calm: boolean,
  random: () => number = Math.random,
): WelcomeSceneMount | null => {
  if (selection.key === 'base') return null
  // 外部 SVG 的渐变 stop 不继承 use 的 token；构建时从同一主题表生成两份 sprite。
  const symbols = `./assets/launch-welcome-${document.documentElement.dataset.theme}.svg#`
  const bindings: (() => void)[] = []
  const listeners: (() => void)[] = []
  const W = 1600
  let scale = window.innerWidth / W, H = window.innerHeight / scale
  const P: Plate = { x: 0, y: 0, w: 0, h: 0, cx: W / 2, cy: H / 2 }
  const wrapper = document.createElement('div')
  wrapper.className = 'kw-plate'
  if (!calm) wrapper.style.animationDuration = `${T.fixed.plateIn}ms`
  box.parentNode!.insertBefore(wrapper, box)
  wrapper.appendChild(box)
  const scene = document.createElement('div')
  scene.className = 'ks-scene'
  scene.setAttribute('aria-hidden', 'true')
  layer.insertBefore(scene, wrapper)
  const deco = document.createElement('div')
  deco.className = 'ks-deco'
  deco.setAttribute('aria-hidden', 'true')
  wrapper.appendChild(deco)
  layer.dataset.welcomeScene = selection.key

  const style = (node: Node, css: Css) => {
    for (const [key, value] of Object.entries(css)) {
      const write = () => node.style.setProperty(key, String(typeof value === 'function' ? value() : value))
      write()
      if (typeof value === 'function') bindings.push(write)
    }
  }
  const px = (value: number) => `${value.toFixed(1)}px`
  const motion = (node: HTMLElement, ...motions: Motion[]) => {
    if (calm) return
    node.style.animation = motions.map(([name, duration, delay = 0, easing = 'linear', repeat = false, fill = 'backwards']) =>
      `kuma-season-${name} ${duration}ms ${easing} ${delay}ms ${repeat ? 'infinite' : '1'} ${fill}`).join(', ')
  }
  const stage: WelcomeSceneStage = {
    scene, deco, plate: P, width: W, height: H, random: (a, b) => a + random() * (b - a), motion,
    html(parent, className, css = {}) {
      const node = document.createElement('div')
      node.className = className
      style(node, css)
      parent.appendChild(node)
      return node
    },
    svg(parent, width, height) {
      const node = document.createElementNS(SVG_NS, 'svg')
      // 引用负原点 symbol 时外层必须从 (0,0) 起，不能重复 symbol 的负原点。
      node.setAttribute('viewBox', `0 0 ${width} ${height}`)
      node.setAttribute('aria-hidden', 'true')
      node.setAttribute('class', 'ks-svg')
      parent.appendChild(node)
      return node
    },
    shape(parent, tag, attrs, className = '') {
      const node = document.createElementNS(SVG_NS, tag)
      if (className) node.setAttribute('class', className)
      for (const [key, value] of Object.entries(attrs)) {
        const write = () => node.setAttribute(key, String(typeof value === 'function' ? value() : value))
        write()
        if (typeof value === 'function') bindings.push(write)
      }
      parent.appendChild(node)
      return node
    },
    glyph(parent, symbol, width, height, css = {}) {
      const node = stage.html(parent, `ks-symbol ks-${symbol}`, { width: `${width}px`, height: `${height}px` })
      stage.shape(stage.svg(node, width, height), 'use', { href: `${symbols}sym-${symbol}`, width, height })
      style(node, css)
      return node
    },
  }
  const measure = () => {
    const rect = box.getBoundingClientRect()
    Object.assign(P, { x: rect.left / scale, y: rect.top / scale, w: rect.width / scale, h: rect.height / scale,
      cx: (rect.left + rect.width / 2) / scale, cy: (rect.top + rect.height / 2) / scale })
    deco.style.width = px(P.w)
    deco.style.height = px(P.h)
  }
  style(scene, { width: px(W), height: px(H), transform: `scale(${scale})` })
  style(deco, { transform: `scale(${scale})` })
  measure()
  motion(scene, ['fade', T.sceneFade, 0, 'ease'])
  // 保持图形在光晕等 HTML 装饰之下。
  const art = stage.html(scene, 'ks-art')
  // 装饰的取景框随名字宽度同步，节点与动画始终是同一批，不会中途换幕或重播。
  const decoArt = ['valentine', 'spring', 'xmas'].includes(selection.key) ? stage.html(deco, 'ks-art') : null
  const decoration = selection.key === 'xmas' ? stage.svg(decoArt!, P.w, P.h) : null
  if (decoration) bindings.push(() => decoration.setAttribute('viewBox', `0 0 ${P.w} ${P.h}`))
  const R = stage.random
  const range = (r: readonly number[]) => R(r[0], r[1])
  const shuffle = (n: number) => {
    const indices = Array.from({ length: n }, (_, i) => i)
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [indices[i], indices[j]] = [indices[j], indices[i]] }
    return indices
  }
  const ring = (at: number) => {
    const node = stage.html(deco, 'ks-ring')
    motion(node, ['fade', T.fixed.ring, at, 'ease'])
  }
  const horizon = (offset: number) => {
    const node = stage.html(scene, 'ks-horizon', { top: () => px(P.y + P.h + offset) })
    motion(node, ['fade', T.fixed.horizon, 0, 'ease'])
  }
  // 铭牌正后方的同源 --bg0 柔衬，让高密度动态背景不抢铭牌读性，且不碰铭牌本体。
  const plateHalo = () => {
    const node = stage.html(scene, 'ks-plate-halo', {
      left: () => px(P.cx - (P.w * .78 + 110)), top: () => px(P.cy - (P.h * .85 + 72)),
      width: () => px(P.w * 1.56 + 220), height: () => px(P.h * 1.7 + 144),
    })
    motion(node, ['fade', T.fixed.washIn, 0, 'ease'])
  }
  const wash = (className: string, css: Css = { left: '0px', top: '0px', right: '0px', bottom: '0px' }) => {
    const node = stage.html(scene, className, css)
    scene.insertBefore(node, art)
    motion(node, ['fade', T.fixed.washIn, 0, 'ease'])
    return node
  }
  // 包裹与图形保持同样尺寸/中心，多段运动沿用既定嵌套顺序。
  const inner = (node: HTMLElement) => {
    const child = stage.html(node, 'ks-motion')
    for (const content of Array.from(node.children)) if (content !== child) child.appendChild(content)
    return child
  }
  const fall = (node: HTMLElement, x: number, y: number, endX: number, endY: number, duration: number, at: number, sway: number, swayDuration: number, once = false) => {
    const t = random()
    style(node, { '--x0': px(x), '--y0': px(y), '--x1': px(endX), '--y1': px(endY), '--sw': px(sway),
      transform: `translate(${px(x + (endX - x) * t)}, ${px(y + (endY - y) * t)})` })
    motion(node, ['fall', duration, at, 'linear', !once, once ? 'both' : 'backwards'])
    const swing = inner(node)
    motion(swing, ['sway', swayDuration * 2, -R(0, swayDuration), 'ease-in-out', true])
    return swing
  }
  // 两个独立的 CSS 伪元素共享一个不动的容器，雨滴、微粒与暖尘仍各走各的轨迹与延时。
  const pairedParticle = (kind: 'rain' | 'mote' | 'dust', i: number, nodes: HTMLElement[], css: Css, motions: Motion[]) => {
    const slot = i % 2 ? 'b' : 'a'
    const host = i % 2 ? nodes[nodes.length - 1] : stage.html(scene, `ks-pair ks-${kind}`)
    if (!(i % 2)) nodes.push(host)
    style(host, Object.fromEntries(Object.entries(css).map(([key, value]) => [`--${slot}-${key}`, value])))
    if (!calm) {
      style(host, { [`--${slot}-motion`]: motions.map(([name, duration, at = 0, easing = 'linear', repeat = false]) =>
        `kuma-season-${name} ${duration}ms ${easing} ${at}ms ${repeat ? 'infinite' : '1'} backwards`).join(', ') })
    }
  }

  const seasons: Record<WelcomeSeason, () => void> = {
    newyear() {
      horizon(70)
      const d = () => Math.max(240, Math.min(320, P.w * 1.15))
      const clip = stage.html(scene, 'ks-sun-clip', { height: () => px(P.y + P.h + 70) })
      // 纯水平低空晨曦（无任何放射状光芒），让初日从暖色海天相接处升起。
      const dawn = stage.html(clip, 'ks-ny-dawn', { left: '0px', right: '0px', top: () => px(P.y + P.h + 70 - 300), height: '300px' })
      motion(dawn, ['fade', T.fixed.sunHalo, T.fixed.sunRiseAt, 'ease'])
      const halo = stage.html(clip, 'ks-sun-halo', { left: () => px(P.cx - d() * 1.35), top: () => px(P.y + P.h + 70 - d() * 1.63), width: () => px(d() * 2.7), height: () => px(d() * 2.7) })
      motion(halo, ['fade', T.fixed.sunHalo, T.fixed.sunHaloAt, 'ease'])
      const sun = stage.html(clip, 'ks-sun', { left: () => px(P.cx - d() / 2), top: () => px(P.y + P.h + 70 - d() * .78), width: () => px(d()), height: () => px(d()), '--rise': () => px(d() * .95) })
      motion(sun, ['sun-rise', T.fixed.sunRise, T.fixed.sunRiseAt, 'cubic-bezier(.16,.72,.24,1)'])
      const seaGlow = stage.html(scene, 'ks-ny-sea-glow', { left: () => px(P.cx - d() * 1.45), top: () => px(P.y + P.h + 71), width: () => px(d() * 2.9), height: '140px' })
      motion(seaGlow, ['fade', T.fixed.sunHalo, T.fixed.sunHaloAt, 'ease'])
      for (let row = 0; row < 8; row++) for (let i = 0; i < (row < 3 ? 2 : 1); i++) {
        const w = R(18, 56) * (1 - row * .07), spread = R(-1, 1) * .42 * (1 - row * .07)
        const glint = stage.html(scene, 'ks-sun-glint-in', { left: () => px(P.cx + spread * d() - w / 2), top: () => px(P.y + P.h + 79 + row * 10.5), width: px(w) })
        const shine = stage.html(glint, 'ks-sun-glint')
        const at = range(T.newyear.glintAt)
        motion(glint, ['fade', T.fixed.glintIn, at, 'ease'])
        motion(shine, ['twinkle', range(T.newyear.glint), at + T.fixed.glintIn, 'ease-in-out', true, 'none'])
      }
      ring(T.newyear.ringAt)
    },
    setsubun() {
      const backdrop = stage.html(scene, 'ks-sb-backdrop')
      scene.insertBefore(backdrop, art)
      const spill = stage.html(scene, 'ks-sb-spill')
      scene.insertBefore(spill, art)
      motion(spill, ['sb-breathe', T.fixed.sbBreathe, 0, 'ease-in-out', true, 'none'])
      if (!calm) spill.style.animationDirection = 'alternate'
      const shoji = stage.html(scene, 'ks-sb-shoji', { height: () => px(P.y + P.h + 150) })
      scene.insertBefore(shoji, art)
      motion(shoji, ['fade', T.fixed.shojiIn, 0, 'ease'])
      const eave = stage.html(scene, 'ks-sb-eave')
      scene.insertBefore(eave, art)
      const deck = stage.html(scene, 'ks-sb-deck', { top: () => px(P.y + P.h + 144) })
      scene.insertBefore(deck, art)
      motion(deck, ['fade', T.fixed.horizon, 0, 'ease'])
      const masu = stage.glyph(art, 'masu', 62, 40, { left: '11%', top: () => px(P.y + P.h + 112) })
      motion(masu, ['fade', T.fixed.masuIn, T.fixed.masuAt, 'ease'])
      const dusts: HTMLElement[] = []
      for (let i = 0; i < 8; i++) {
        const dur = range(T.setsubun.dust)
        pairedParticle('dust', i, dusts, {
          left: `${R(6, 48).toFixed(1)}%`, top: `${R(18, 66).toFixed(1)}%`,
          size: px(R(3, 5.2)), op: R(.36, .58).toFixed(2), direction: 'alternate',
        }, [['sb-dust', dur, -R(0, T.setsubun.dust[0]), 'ease-in-out', true]])
      }
      // 14 粒豆：左侧 9 粒从檐边枡木盒上方抛射而出，右侧 5 粒呼应回撒。
      for (let i = 0; i < 14; i++) {
        const left = i < 9
        const duration = range(T.setsubun.toss), at = (left ? T.setsubun.leftAt : T.setsubun.rightAt) + R(0, T.setsubun.spread)
        const x0 = left ? W * .125 : W + 30
        const dx = left ? R(-450, 100) : R(60, 510), roll = (left ? 1 : -1) * R(26, 62)
        const y0 = left ? 116 : 148, yp = R(-300, -130), yf = R(164, 246), bounce = R(24, 42)
        const depth = (yf - 164) / 82, sc = (.84 + depth * .32).toFixed(3)
        const bean = stage.html(scene, 'ks-bean-flight', { '--x0': px(x0), '--x1': () => px(P.cx + dx), '--x2': () => px(P.cx + dx + roll),
          '--y0': () => px(P.y + P.h + y0), '--yp': () => px(P.y + P.h + yp), '--yf': () => px(P.y + P.h + yf), '--yb': () => px(P.y + P.h + yf - bounce),
          '--rot': `${R(0, 180)}deg`, '--spin': `${R(-520, 520)}deg`, '--sc': sc,
          transform: () => `translate(${px(P.cx + dx + roll)}, ${px(P.y + P.h + yf)}) scale(var(--sc)) rotate(var(--rot))` })
        const arc = stage.html(bean, 'ks-motion'), seed = stage.html(arc, 'ks-bean')
        motion(bean, ['bean-x', duration, at])
        motion(arc, ['bean-y', duration, at])
        motion(seed, ['bean-spin', duration, at, 'cubic-bezier(.18,.78,.28,1)'])
        const shadow = stage.html(scene, 'ks-bean-shadow', { left: () => px(P.cx + dx + roll - 6.5), top: () => px(P.y + P.h + yf + 4), transform: `scale(${sc})` })
        motion(shadow, ['fade', T.fixed.beanShadow, at + Math.round(duration * .9), 'ease'])
      }
      plateHalo()
      const hit = stage.html(deco, 'ks-bean ks-bean-hit', { left: () => px(P.w * .72), top: '-4px', '--rot': '12deg' })
      motion(hit, ['bean-drop', T.setsubun.hitDuration, T.setsubun.hitAt])
      // 沉一下的也是包裹层：.kw-box 原有的裁切与入场机制不改。
      if (!calm) {
        wrapper.style.animation = `kuma-welcome-in ${T.fixed.plateIn}ms ease both, kuma-season-nudge ${T.fixed.nudge}ms ease-out ${T.setsubun.hitAt + T.setsubun.nudgeAt}ms backwards`
      }
    },
    valentine() {
      wash('ks-val-blush')
      const tiers = [
        { count: 7, size: [12, 17], op: [.22, .34], sw: [8, 15] },
        { count: 7, size: [18, 25], op: [.35, .48], sw: [14, 22] },
        { count: 4, size: [26, 34], op: [.46, .60], sw: [18, 28] },
      ]
      let index = 0
      tiers.forEach((tier, depth) => {
        for (let i = 0; i < tier.count; i++, index++) {
          const s = range(tier.size), x = R(60, W - 60), duration = range(T.valentine.rise[depth]), opacity = range(tier.op)
          const heart = stage.glyph(art, 'heart', s, s * .92, { '--x': px(x), '--y0': px(H + 30), '--y1': px(R(-60, 160)), '--sw': px(range(tier.sw)), '--op': opacity,
            transform: `translate(${px(x)}, ${px(R(120, H - 60))})`, opacity })
          const at = index < 8 ? -R(duration * .15, duration * .6) : range(T.valentine.start)
          motion(heart, ['rise', duration, at, 'linear', true], ['rise-o', duration, at, 'linear', true])
          motion(inner(heart), ['sway', range(T.valentine.sway[depth]) * 2, -R(0, T.valentine.sway[depth][1]), 'ease-in-out', true])
        }
      })
      const horizontal = stage.html(deco, 'ks-ribbon-h', { top: '5.5px' })
      const vertical = stage.html(deco, 'ks-ribbon-v', { left: () => px(P.w - 17.5) })
      motion(horizontal, ['grow-x', T.fixed.ribbonH, T.fixed.ribbonHAt, 'cubic-bezier(.3,.7,.2,1)'])
      motion(vertical, ['grow-y', T.fixed.ribbonV, T.fixed.ribbonVAt, 'cubic-bezier(.3,.7,.2,1)'])
      const bow = stage.glyph(decoArt!, 'bow', 66, 45, { transform: () => `translate(${px(P.w - 48)}, -13px)` })
      style(bow, { '--bx': () => px(P.w - 48), '--by': '-13px' })
      motion(bow, ['bow-pop', T.fixed.bowPop, T.fixed.bowPopAt, 'cubic-bezier(.3,1.6,.5,1)'])
      const bowSwing = inner(bow)
      style(bowSwing, { 'transform-origin': '50% 38%' })
      motion(bowSwing, ['bow-sway', T.fixed.bowSway, T.fixed.bowSwayAt, 'ease-in-out', true, 'none'])
    },
    spring() {
      wash('ks-spring-air')
      for (let i = 0; i < 12; i++) {
        const y = R(120, 660), x = W + 40, duration = range(T.spring.gust), s = R(15, 23)
        const node = stage.glyph(art, 'petal', s, s * 1.04, { opacity: R(.74, .95), '--r0': `${R(0, 360)}deg` })
        const swing = fall(node, x, y, -80, y + R(160, 320), duration, range(T.spring.gustAt), R(8, 20), range(T.spring.gustSway), true)
        if (calm) node.style.display = 'none'
        else motion(inner(swing), ['flutter', range(T.spring.flutter), 0, 'linear', true])
      }
      // 远中近三层飘落：尺寸、速度、摆幅与不透明度耦合，建立春季花吹雪的纵深。
      const tiers = [
        { count: 8, size: [10, 14], op: [.38, .56], sw: [10, 20], drift: [280, 420] },
        { count: 9, size: [14, 18], op: [.58, .78], sw: [16, 28], drift: [380, 520] },
        { count: 5, size: [18, 23], op: [.78, .94], sw: [24, 38], drift: [460, 620] },
      ]
      let index = 0
      tiers.forEach((tier, depth) => {
        for (let i = 0; i < tier.count; i++, index++) {
          const x = R(260, W + 260), duration = range(T.spring.fall[depth]), s = range(tier.size)
          const node = stage.glyph(art, 'petal', s, s * 1.04, { opacity: range(tier.op), '--r0': `${R(0, 360)}deg` })
          const swing = fall(node, x, -40, x - range(tier.drift), H + 40, duration,
            index < 10 ? -R(0, duration) : range(T.spring.fallAt), range(tier.sw), range(T.spring.sway[depth]), false)
          if (!calm) motion(inner(swing), ['flutter', range(T.spring.flutter), 0, 'linear', true])
          else node.style.transform += ' rotate(var(--r0))'
        }
      })
      plateHalo()
      for (const [i, fraction] of [.16, .58, .88].entries()) {
        const node = stage.glyph(decoArt!, 'petal', 16, 16.6, { '--lx': px(R(50, 110)), '--rf': `${R(-35, 35)}deg`, '--land-x': () => px(P.w * fraction - 7), transform: () => `translate(${px(P.w * fraction - 7)}, -9px) rotate(var(--rf))` })
        motion(node, ['petal-land', T.fixed.petalLand, T.spring.landAt[i]])
      }
    },
    tsuyu() {
      wash('ks-tsuyu-mist', { left: '0px', right: '0px', top: () => px(P.y + P.h + 70), bottom: '0px' })
      const drops: HTMLElement[] = []
      if (!calm) for (let i = 0; i < 40; i++) {
        const far = i < 16
        pairedParticle('rain', i, drops, {
          x0: px(R(0, W + 300)), size: px(far ? R(36, 62) : R(58, 96)), op: far ? R(.2, .38) : R(.4, .66), w: far ? '1px' : '1.6px',
        }, [['rain', range(T.tsuyu.rain), range(i < 10 ? T.tsuyu.firstAt : T.tsuyu.rainAt), 'linear', true]])
      }
      for (let i = 0; i < 10; i++) {
        const w = R(54, 128), x = R(110, W - 110), offset = R(130, H - 46 - P.y - P.h)
        const ripple = stage.html(scene, 'ks-ripple', { left: px(x - w / 2), top: () => px(P.y + P.h + offset - w * .13), width: px(w), height: px(w * .26) })
        motion(ripple, ['ripple', range(T.tsuyu.ripple), range(T.tsuyu.rippleAt), 'cubic-bezier(.2,.6,.3,1)', true])
      }
      const teru = stage.html(scene, 'ks-teru', { left: () => px(P.cx - 22), height: () => px(P.y - 30), '--from': () => px(30 - P.y) })
      motion(teru, ['teru-drop', T.fixed.teruDrop, T.fixed.teruAt, 'cubic-bezier(.3,1.35,.5,1)'])
      const swing = stage.html(teru, 'ks-teru-swing')
      motion(swing, ['teru-swing', T.fixed.teruSwing, T.fixed.teruSwingAt, 'ease-in-out', true])
      stage.html(swing, 'ks-teru-string', { height: () => px(P.y - 96) })
      const doll = stage.svg(swing, 44, 74)
      doll.classList.add('ks-teru-doll')
      stage.shape(doll, 'use', { href: `${symbols}sym-teru`, width: 44, height: 74 })
    },
    summer() {
      horizon(110)
      const colors = ['var(--fw-a)', 'var(--fw-b)', 'var(--fw-c)']
      T.summer.starts.forEach((at, k) => {
        const spot = () => ({ x: range([[330, 620], [980, 1270], [640, 960]][k]), y: R(140, 310) })
        let position = spot()
        const shell = stage.html(scene, 'ks-firework', { left: px(position.x), top: px(position.y), '--c': colors[k], '--rise': () => px(P.y + P.h + 110 - position.y) })
        const trail = stage.html(shell, 'ks-fw-trail')
        motion(trail, ['fw-trail', T.summer.cycle, at], ['fw-trail-o', T.summer.cycle, at])
        const flash = stage.html(shell, 'ks-fw-flash')
        motion(flash, ['fw-flash', T.summer.cycle, at])
        const gravity = stage.html(shell, 'ks-fw-gravity')
        motion(gravity, ['fw-gravity', T.summer.cycle, at])
        const radius = R(124, 174)
        let spark: HTMLElement
        for (let i = 0; i < 38; i++) {
          const outer = i < 26, angle = 360 / (outer ? 26 : 12) * (outer ? i : i - 26) + R(outer ? -6 : -9, outer ? 6 : 9)
          if (!(i % 2)) spark = stage.html(gravity, 'ks-fw-sparks')
          const slot = i % 2 ? 'b' : 'a'
          style(spark!, {
            [`--${slot}-angle`]: `${angle}deg`,
            [`--${slot}-radius`]: px(radius * R(outer ? .72 : .4, outer ? 1.08 : .58)),
            [`--${slot}-len`]: px(outer ? R(13, 19) : R(9, 13)),
            [`--${slot}-c`]: colors[outer ? k : (k + 1) % 3],
          })
          if (!calm) style(spark!, { '--spark-motion': `kuma-season-fw-spread ${T.summer.cycle}ms linear ${at}ms infinite backwards, kuma-season-fw-spark-o ${T.summer.cycle}ms linear ${at}ms infinite backwards` })
        }
        // 水面反光带一层同色微晕，与六道细波纹同周期同位置联动。
        const reflection = stage.html(scene, 'ks-fw-reflection')
        style(reflection, { left: px(position.x - 50), top: () => px(P.y + P.h + 117), '--c': colors[k] })
        stage.html(reflection, 'ks-fw-water-glow')
        let d = ''
        for (let row = 0; row < 6; row++) { const w = R(14, 46) * (1 - row * .1), x = 50 + R(-10, 10); d += `M${x - w / 2} ${row * 9 + 1}h${w}` }
        stage.shape(stage.svg(reflection, 100, 60), 'path', { d, fill: 'none', stroke: 'var(--c)', 'stroke-width': 2, 'stroke-linecap': 'round' })
        motion(reflection, ['fw-reflection', T.summer.cycle, at])
        if (!calm) {
          for (const node of [trail, flash, gravity, reflection]) node.style.animationIterationCount = 'infinite'
          const reroll = (event: Event) => {
            if (event.target !== trail || (event as AnimationEvent).animationName !== 'kuma-season-fw-trail') return
            position = spot()
            style(shell, { left: px(position.x), top: px(position.y), '--rise': px(P.y + P.h + 110 - position.y) })
            style(reflection, { left: px(position.x - 50) })
          }
          shell.addEventListener('animationiteration', reroll)
          listeners.push(() => shell.removeEventListener('animationiteration', reroll))
        } else { trail.style.display = 'none'; flash.style.display = 'none' }
      })
      plateHalo()
    },
    sanma() {
      const backdrop = stage.html(scene, 'ks-sm-backdrop')
      scene.insertBefore(backdrop, art)
      const sheen = stage.html(scene, 'ks-sm-sheen', { top: () => px(H * .215) })
      scene.insertBefore(sheen, art)
      motion(sheen, ['fade', T.fixed.washIn, 0, 'ease'])
      const line = stage.html(scene, 'ks-sm-horizon', { top: () => px(H * .215) })
      scene.insertBefore(line, art)
      motion(line, ['fade', T.fixed.horizon, 0, 'ease'])
      // 三盏海面集鱼灯 + 体积光束（主灯带高亮内芯光锥）
      const lamps = [
        { x: W * .24, main: false, beamW: 370, ang: '-13deg' },
        { x: W * .50, main: true, beamW: 560, ang: '1deg' },
        { x: W * .76, main: false, beamW: 360, ang: '14deg' },
      ]
      lamps.forEach((lamp, i) => {
        const beam = stage.html(scene, 'ks-sm-beam', {
          left: px(lamp.x - lamp.beamW / 2), top: () => px(H * .215), width: px(lamp.beamW), height: () => px(H * .82), '--ang': lamp.ang,
        })
        scene.insertBefore(beam, art)
        motion(beam, ['sm-beam-in', T.fixed.smBeamIn, T.sanma.lampAt[i], 'cubic-bezier(.18,.7,.26,1)'])
        const cone = stage.html(beam, 'ks-sm-beam-cone')
        motion(cone, ['sm-beam-sway', T.sanma.beamSway[i], T.sanma.beamSwayAt[i], 'ease-in-out', true, 'none'])
        if (!calm) cone.style.animationDirection = 'alternate'
        if (lamp.main) {
          const core = stage.html(beam, 'ks-sm-beam-cone ks-sm-beam-core')
          motion(core, ['sm-beam-sway', T.sanma.beamSway[i] - T.sanma.coreSwayDelta, T.sanma.beamSwayAt[i], 'ease-in-out', true, 'none'])
          if (!calm) core.style.animationDirection = 'alternate'
        }
        const bulb = stage.html(scene, `ks-sm-lamp${lamp.main ? ' ks-sm-lamp-main' : ''}`, { left: px(lamp.x), top: () => px(H * .213) })
        scene.insertBefore(bulb, art)
        motion(bulb, ['sm-lamp-ignite', T.fixed.smLampIgnite, T.sanma.lampAt[i], 'ease'])
      })
      // 海面浮光短线
      const surfGlints = [
        { left: '19%', top: .224, w: 92 }, { left: '43%', top: .222, w: 166 },
        { left: '47%', top: .238, w: 100 }, { left: '72%', top: .226, w: 84 },
      ]
      surfGlints.forEach((g, i) => {
        const el = stage.html(scene, 'ks-sm-surf-glint', { left: g.left, top: () => px(H * g.top), width: px(g.w) })
        scene.insertBefore(el, art)
        motion(el, ['sm-surf-glint', T.sanma.surfGlint[i], T.sanma.surfGlintAt[i], 'ease-in-out', true])
        if (!calm) el.style.animationDirection = 'alternate'
      })
      // 水下声呐探鱼圈（透视压扁）
      const sonar = stage.html(scene, 'ks-sm-sonar', { top: () => px(H * .74) })
      scene.insertBefore(sonar, art)
      for (const at of T.sanma.sonarAt) {
        const ringEl = stage.html(sonar, 'ks-sm-sonar-ring')
        motion(ringEl, ['sm-sonar', T.fixed.smSonarPing, at, 'cubic-bezier(.16,.66,.3,1)', true])
      }
      // 上浮微光浮游颗粒（成对伪元素承载，10 粒仅占 5 节点）
      const motes: HTMLElement[] = []
      for (let i = 0; i < 10; i++) {
        pairedParticle('mote', i, motes, {
          left: `${R(20, 80).toFixed(1)}%`, top: `${R(36, 86).toFixed(1)}%`,
          size: px(R(3, 5.2)), op: R(.28, .56).toFixed(2), dx: px(R(-22, 22)),
        }, [['sm-mote', range(T.sanma.mote), -R(0, T.sanma.moteOffset), 'linear', true]])
      }
      // 趋光鱼群（远景 5 条 + 近景 8 条）：精修 210×26 刀身，近景过主光束时触发双闪。
      const addFish = (length: number, yPct: number, rise: number, pitch: number, duration: number, at: number, opacity: number, calmPct: number, hasGlint: boolean) => {
        const h = length * 26 / 210
        const lane = stage.html(art, 'ks-symbol ks-saury', {
          width: px(length), height: px(h), opacity,
          '--sx0': px(-length - 60), '--sx1': px(W + 60),
          '--fish-y0': () => px(H * yPct), '--fish-y1': () => px(H * yPct - rise),
          transform: () => `translate(${px(W * calmPct)}, ${px(H * yPct)})`,
        })
        motion(lane, ['swim', duration, at, 'linear', true])
        const pitchBox = stage.html(lane, 'ks-motion', { transform: `rotate(${pitch}deg)` })
        const bobBox = stage.html(pitchBox, 'ks-motion')
        motion(bobBox, ['bob', range(T.sanma.bob), -R(0, T.sanma.bobOffset), 'ease-in-out', true])
        const tailBox = stage.html(bobBox, 'ks-motion', { 'transform-origin': '86% 50%' })
        motion(tailBox, ['wig', range(T.sanma.wig), 0, 'ease-in-out', true])
        if (!calm) { bobBox.style.animationDirection = 'alternate'; tailBox.style.animationDirection = 'alternate' }
        stage.shape(stage.svg(tailBox, 210, 26), 'use', { href: `${symbols}sym-saury`, width: 210, height: 26 })
        if (hasGlint) {
          const glintBox = stage.html(tailBox, 'ks-sm-glint')
          stage.shape(stage.svg(glintBox, 210, 26), 'use', { href: `${symbols}sym-saury-glint`, width: 210, height: 26 })
          motion(glintBox, ['glint', duration, at, 'linear', true])
        }
      }
      const farSchool = [
        { yPct: .31, calmPct: .24 }, { yPct: .35, calmPct: .44 }, { yPct: .33, calmPct: .60 },
        { yPct: .38, calmPct: .15 }, { yPct: .36, calmPct: .35 },
      ]
      farSchool.forEach((f, i) => addFish(R(118, 144), f.yPct, 36, -1.6, T.sanma.far, T.sanma.farAt[i], .36, f.calmPct, false))
      const nearSchool = [
        { yPct: .68, calmPct: .31, len: 214 }, { yPct: .73, calmPct: .41, len: 232 },
        { yPct: .70, calmPct: .51, len: 202 }, { yPct: .78, calmPct: .25, len: 224 },
        { yPct: .75, calmPct: .60, len: 218 }, { yPct: .82, calmPct: .37, len: 194 },
        { yPct: .85, calmPct: .47, len: 208 }, { yPct: .72, calmPct: .17, len: 204 },
      ]
      nearSchool.forEach((f, i) => addFish(f.len, f.yPct, 68, -2.8, T.sanma.near, T.sanma.nearAt[i], .95, f.calmPct, true))
      plateHalo()
    },
    halloween() {
      // 雾夜残月港湾：防波堤与水面锚定在南瓜底缘 P.y + P.h + 38，缩放/改名全程贴合。
      const backdrop = stage.html(scene, 'ks-hw-backdrop', { '--hw-sea-y': () => px(P.y + P.h + 74) })
      scene.insertBefore(backdrop, art)
      const moonWrap = stage.html(scene, 'ks-hw-moon-wrap', { top: () => px(Math.max(48, P.y * .28)) })
      scene.insertBefore(moonWrap, art)
      motion(moonWrap, ['fade', T.fixed.hwMoonIn, 0, 'ease'])
      stage.html(moonWrap, 'ks-hw-moon')
      const cloud = stage.html(moonWrap, 'ks-hw-cloud')
      motion(cloud, ['hw-cloud', T.fixed.hwCloudDrift, 0, 'ease-in-out', true, 'none'])
      if (!calm) cloud.style.animationDirection = 'alternate'
      const waterline = stage.html(scene, 'ks-hw-waterline', { top: () => px(P.y + P.h + 74) })
      scene.insertBefore(waterline, art)
      const moonSea = stage.html(scene, 'ks-hw-moon-sea', { top: () => px(P.y + P.h + 78) })
      scene.insertBefore(moonSea, art)
      motion(moonSea, ['hw-glint', T.fixed.hwGlintSoft, 0, 'ease-in-out', true, 'none'])
      if (!calm) moonSea.style.animationDirection = 'alternate'
      const pier = stage.html(scene, 'ks-hw-pier', { top: () => px(P.y + P.h - 14) })
      scene.insertBefore(pier, art)
      motion(pier, ['fade', T.fixed.hwPierIn, 0, 'ease'])
      const pierSvg = stage.svg(pier, 800, 84)
      pierSvg.setAttribute('preserveAspectRatio', 'none')
      stage.shape(pierSvg, 'path', { d: 'M0 54 L195 54 L222 46 L256 46 L264 56 L512 56 L526 44 L684 44 L710 52 L800 52 L800 84 L0 84 Z M64 42 H74 V54 H64 Z M660 34 H668 V44 H660 Z' }, 'ks-hw-pier-fill')
      stage.shape(pierSvg, 'path', { d: 'M0 54 L195 54 L222 46 L256 46 M526 44 L684 44' }, 'ks-hw-pier-rim')
      const mistOffsets = [20, 62]
      mistOffsets.forEach((dy, i) => {
        const mist = stage.html(scene, 'ks-hw-mist', { top: () => px(P.y + P.h + dy), opacity: i ? .75 : 1 })
        scene.insertBefore(mist, art)
        motion(mist, ['hw-mist', T.halloween.mist[i], T.halloween.mistAt[i], 'ease-in-out', true, 'none'])
        if (!calm) mist.style.animationDirection = 'alternate'
      })
      const positions = [{ dx: -150, w: 118 }, { dx: P.w + 34, w: 92 }, { dx: P.w + 138, w: 66 }]
      const order = shuffle(3), on: number[] = []
      order.forEach((index, i) => { on[index] = T.halloween.firstAt + i * T.halloween.step + R(-T.halloween.jitter, T.halloween.jitter) })
      positions.forEach(({ dx, w }, i) => {
        const h = w * 100 / 120
        const xOf = () => P.x + (i ? P.w + (i === 1 ? 34 : 138) : dx)
        const shadow = stage.html(scene, 'ks-hw-pk-shadow', { left: () => px(xOf() + w * .08), top: () => px(P.y + P.h + 34), width: px(w * .84) })
        scene.insertBefore(shadow, art)
        const water = stage.html(scene, 'ks-hw-pk-water', { left: () => px(xOf() + w * .1), top: () => px(P.y + P.h + 78), width: px(w * .8) })
        scene.insertBefore(water, art)
        const waterLines = stage.html(water, 'ks-hw-pk-water-lines')
        motion(water, ['pk-ignite', T.fixed.hwWaterIgnite, on[i]])
        motion(waterLines, ['pk-flicker', T.fixed.pkFlicker, on[i] + T.fixed.pkIgnite, 'linear', true, 'none'])
        const halo = stage.html(scene, 'ks-pumpkin-halo', { left: () => px(xOf() - w * .9), top: () => px(P.y + P.h + 38 - h * .45 - w * 1.4), width: px(w * 2.8), height: px(w * 2.8) })
        const haloLight = stage.html(halo, 'ks-motion ks-pumpkin-light')
        motion(halo, ['pk-ignite', T.fixed.pkIgnite, on[i]])
        motion(haloLight, ['pk-flicker', T.fixed.pkFlicker, on[i] + T.fixed.pkIgnite, 'linear', true, 'none'])
        const position: Css = { left: () => px(xOf()), top: () => px(P.y + P.h + 38 - h) }
        const pumpkin = stage.glyph(art, 'pumpkin', w, h)
        const carve = stage.glyph(art, 'pk-face', w, h, { fill: 'var(--pk-carve)' })
        const lit = stage.glyph(art, 'pk-lit', w, h)
        for (const node of [pumpkin, carve, lit]) {
          style(node, position)
        }
        for (const node of [pumpkin, carve]) {
          motion(node, ['pk-wake', T.fixed.pkWake, on[i], 'ease'])
          motion(inner(node), ['pk-appear', T.fixed.pkAppear, 0, 'ease'])
        }
        motion(lit, ['pk-ignite', T.fixed.pkIgnite, on[i]])
        motion(inner(lit), ['pk-flicker', T.fixed.pkFlicker, on[i] + T.fixed.pkIgnite, 'linear', true, 'none'])
      })
      const last = Math.max(...on)
      const glow = stage.html(scene, 'ks-pumpkin-glow', { left: () => px(P.cx - P.w * .9 - 90), top: () => px(P.cy - 130), width: () => px(P.w * 1.8 + 180), height: '260px' })
      motion(glow, ['fade', T.fixed.pkGlow, last + T.halloween.glowAfter, 'ease'])
      plateHalo()
      if (!calm) {
        for (let i = 0; i < 4; i++) {
          const leftSide = i % 2 === 0
          const x0 = leftSide ? P.x - R(40, 140) : P.x + P.w + R(40, 140), y0 = P.y + P.h + R(-10, 26)
          const x3 = leftSide ? R(-240, -90) : R(W + 90, W + 240), y3 = R(-140, 70)
          const x1 = x0 + (x3 - x0) * .28 + R(-50, 50), y1 = y0 - R(120, 210), x2 = x0 + (x3 - x0) * .64 + R(-50, 50), y2 = y1 + (y3 - y1) * .45 + R(-40, 50), s = R(46, 64)
          const bat = stage.glyph(art, 'bat', s, s * 30 / 64, { '--x0': px(x0 - s / 2), '--y0': px(y0 - s * 15 / 64), '--x1': px(x1 - s / 2), '--y1': px(y1 - s * 15 / 64), '--x2': px(x2 - s / 2), '--y2': px(y2 - s * 15 / 64), '--x3': px(x3 - s / 2), '--y3': px(y3 - s * 15 / 64) })
          motion(bat, ['bat-fly', range(T.halloween.bat), last + T.halloween.batsAfter + i * T.halloween.batStep, 'cubic-bezier(.3,.1,.6,1)', false, 'both'])
          const wings = inner(bat)
          motion(wings, ['flap', range(T.halloween.flap), 0, 'ease-in-out', true])
          wings.style.animationDirection = 'alternate'
        }
        const cross = stage.glyph(art, 'bat', 40, 19, { '--cy': px(R(110, 200)) })
        motion(cross, ['bat-cross', T.fixed.batCross, last + T.halloween.crossingAfter, 'linear', true])
        const wings = inner(cross)
        motion(wings, ['flap', T.halloween.crossingFlap, 0, 'ease-in-out', true])
        wings.style.animationDirection = 'alternate'
      }
    },
    xmas() {
      wash('ks-xmas-sky')
      const ground = () => P.y + P.h + 200, crest = () => P.y + P.h + 20
      const groundLayer = stage.html(art, 'ks-ground')
      const groundSvg = stage.svg(groundLayer, W, H)
      bindings.push(() => groundSvg.setAttribute('viewBox', `0 0 ${W} ${H}`))
      stage.shape(groundSvg, 'path', { d: () => `M-40 ${ground()}Q800 ${crest()} 1640 ${ground()}L1640 ${H + 40}L-40 ${H + 40}Z` }, 'ks-snowbank')
      motion(groundLayer, ['fade', T.fixed.groundIn, 0, 'ease'])
      const trees = [{ x: () => P.x - 175, h: 300 }, { x: () => P.x + P.w + 125, h: 196 }, { x: () => P.x + P.w + 232, h: 138 }]
      const foot = (x: number) => { const t = (x + 40) / 1680; return ground() - 2 * t * (1 - t) * (ground() - crest()) + 6 }
      trees.forEach((tree, i) => {
        const w = tree.h * 100 / 160
        const node = stage.glyph(art, 'fir', w, tree.h, { '--tree-x': () => px(tree.x() - w / 2), '--tree-y': () => px(foot(tree.x()) - tree.h), transform: 'translate(var(--tree-x), var(--tree-y))' })
        motion(node, ['tree-in', T.fixed.treeIn, T.xmas.treesAt[i], 'cubic-bezier(.2,.7,.3,1)'])
      })
      const span = () => P.w + 44, sags = Math.max(2, Math.round(span() / 150)), count = Math.max(6, Math.round(span() / 24))
      const wire = stage.shape(decoration!, 'path', { d: () => `M-22 -3${Array.from({ length: sags }, (_, i) => `Q${(i + .5) * span() / sags - 22} 23 ${(i + 1) * span() / sags - 22} -3`).join('')}` }, 'ks-wire')
      wire.setAttribute('fill', 'none')
      // 长提督名下灯泡多时按总预算压缩步长，保证树顶星在 2.4s 淡出前稳稳亮起。
      const bulbStep = Math.min(T.xmas.step, Math.floor(T.xmas.budget / Math.max(1, count - 1)))
      const onAt: number[] = []
      shuffle(count).forEach((index, i) => { onAt[index] = T.xmas.firstAt + i * bulbStep })
      const starsAt = T.xmas.firstAt + (count - 1) * bulbStep + T.xmas.starAfter
      const star = stage.html(scene, 'ks-star', { left: () => px(trees[0].x() - 13), top: () => px(foot(trees[0].x()) - trees[0].h + trees[0].h * .025 - 13) })
      const starSvg = stage.svg(star, 22, 22)
      stage.shape(starSvg, 'use', { href: `${symbols}sym-star`, width: 22, height: 22 })
      const starLight = inner(star)
      starLight.classList.add('ks-star-light')
      motion(star, ['star-pop', T.fixed.starPop, starsAt, 'cubic-bezier(.3,1.6,.5,1)'])
      motion(starLight, ['star-twinkle', T.fixed.starTwinkle, starsAt + T.fixed.starPop, 'ease-in-out', true, 'none'])
      const layers = [{ count: 16, size: [2, 3.2], opacity: .35, sw: [8, 20] }, { count: 10, size: [3.6, 5], opacity: .6, sw: [16, 32] }, { count: 5, size: [6, 8.5], opacity: .8, sw: [24, 44] }]
      layers.forEach((snow, depth) => {
        for (let i = 0; i < snow.count; i++) {
          const x = R(-40, W + 40), endX = x + R(-80, 60), duration = range(T.xmas.snow[depth]), t = random(), s = range(snow.size) * 2.2
          const flake = stage.html(scene, 'ks-snow-fall', { '--x0': px(x), '--y0': '-24px', '--x1': px(endX), '--y1': px(H + 24), '--sw': px(range(snow.sw)), '--size': px(s), '--op': snow.opacity,
            transform: `translate(${px(x + (endX - x) * t)}, ${px(-24 + (H + 48) * t)})` })
          const crystal = stage.html(flake, 'ks-snow')
          motion(flake, ['fall', duration, -R(0, duration), 'linear', true])
          motion(crystal, ['sway', range(T.xmas.sway) * 2, -R(0, T.xmas.sway[1]), 'ease-in-out', true])
        }
      })
      const colors = ['var(--bulb-1)', 'var(--bulb-2)', 'var(--bulb-3)', 'var(--bulb-4)']
      const shells: (() => string)[] = [], caps: (() => string)[] = []
      for (let i = 0; i < count; i++) {
        const t = (i + .5) / count, u = t * sags % 1, x = () => t * span() - 22, y = -2 + 52 * u * (1 - u)
        shells.push(() => `M${x() - 3.5} ${y}h7v6q0 4-3.5 4t-3.5-4Z`)
        caps.push(() => `M${x() - 2.5} ${y - 2}h4v3h-4Z`)
        const bulb = stage.html(deco, 'ks-bulb-on', { left: () => px(x() - 3.5), top: px(y), '--c': colors[i % 4] })
        const light = stage.html(bulb, 'ks-bulb')
        motion(bulb, ['bulb-on', T.fixed.bulbOn, onAt[i]])
        motion(light, ['bulb-twinkle', T.fixed.bulbTwinkle, onAt[i] + T.fixed.bulbOn + (i % 2 ? T.xmas.alternate : 0), 'ease-in-out', true, 'none'])
      }
      stage.shape(decoration!, 'path', { d: () => shells.map((path) => path()).join(''), fill: 'var(--bulb-off)' })
      stage.shape(decoration!, 'path', { d: () => caps.map((path) => path()).join(''), fill: 'var(--wire)' })
    },
  }

  if (selection.key === 'event') {
    const grid = stage.html(scene, 'ks-grid')
    motion(grid, ['fade', T.fixed.gridIn, 0, 'ease'], ['grid-drift', T.fixed.gridDrift, 0, 'linear', true])
    plateHalo()
    const xs: number[] = []
    let x = 0
    for (const lamp of selection.lamps) { if (lamp.breakBefore) x += 22; xs.push(x); x += 34 }
    const row = stage.html(scene, 'ks-lamps', { left: () => px(P.cx - (xs.at(-1) ?? 0) / 2), top: () => px(P.y + P.h + 46) })
    // 按图数压缩点亮步长，确保 5~7 图全通时的连金线与铭牌金边完整落在 2.4s 之内。
    const lampStep = Math.min(T.event.step, Math.floor(T.event.budget / Math.max(1, selection.lamps.length - 1)))
    const at = (i: number) => T.event.firstAt + i * lampStep
    const lastAt = at(selection.lamps.length - 1)
    const waveAt = lastAt + T.event.waveAfter
    const finishedAt = waveAt + selection.lamps.length * T.event.waveStep
    const current = selection.lamps.findIndex((lamp) => lamp.state !== 'done')
    for (let i = 0; i < selection.lamps.length; i++) {
      const lamp = selection.lamps[i]
      if (i > 0) {
        if (!lamp.breakBefore) {
          const route = stage.html(row, 'ks-route', { left: px(xs[i - 1]), width: px(xs[i] - xs[i - 1]) })
          motion(route, ['fade', T.fixed.routeIn, T.fixed.routeAt, 'ease'])
        } else if (!selection.complete) {
          const tick = stage.html(row, 'ks-break-tick', { left: px((xs[i - 1] + xs[i]) / 2) })
          motion(tick, ['fade', T.fixed.routeIn, T.fixed.routeAt, 'ease'])
        }
        if ((!lamp.breakBefore && (selection.complete || i <= current)) || (lamp.breakBefore && selection.complete)) {
          const done = stage.html(row, 'ks-route ks-route-done', { left: px(xs[i - 1]), width: px(xs[i] - xs[i - 1]) })
          motion(done, ['grow-x', lamp.breakBefore ? T.fixed.routeJoin : lampStep, lamp.breakBefore ? finishedAt + T.event.joinAfter : at(i - 1)])
        }
      }
      const isFinal = i === selection.lamps.length - 1
      const node = stage.html(row, `ks-lamp ks-lamp-${lamp.state}${isFinal ? ' ks-lamp-final' : ''}`, { left: px(xs[i]), '--c': lamp.state === 'done' ? 'var(--gold)' : 'var(--accent)' })
      node.dataset.mapId = String(lamp.mapId)
      motion(node, ['fade', T.fixed.lampIn, T.fixed.lampAt, 'ease'])
      const on = at(i) + (lamp.state === 'current' ? T.event.currentAfter : 0)
      if (lamp.state === 'current') {
        if (!calm) {
          const ping = stage.html(node, 'ks-lamp-ping')
          motion(ping, ['lamp-ping', T.fixed.lampPing, on + T.fixed.lampOn, 'ease-out', true])
        }
        const light = stage.html(node, 'ks-lamp-current-light')
        motion(light, ['lamp-breathe', T.fixed.lampBreathe, on + T.fixed.lampOn, 'ease-in-out', true, 'none'])
      }
      if (!calm && lamp.state !== 'empty') {
        style(node, { '--lamp-motion': `kuma-season-lamp-on ${T.fixed.lampOn}ms linear ${on}ms backwards${selection.complete
          ? `, kuma-season-lamp-wave ${T.fixed.lampWave}ms ease-out ${waveAt + i * T.event.waveStep}ms 1`
          : ''}` })
      }
    }
    if (selection.complete) ring(finishedAt + T.event.ringAfter)
    WELCOME_EVENT_TONES[selection.mapAreaId]?.(stage, selection)
  } else seasons[selection.key]()

  // 启动后才生效的界面缩放与窗口改大小都走原来的铭牌同步口。
  // 只更新几何与绑定值，不换节点、不重写 animation，进行中的动画继续走。
  const syncPlate = () => {
    scale = window.innerWidth / W
    H = window.innerHeight / scale
    stage.height = H
    style(scene, { width: px(W), height: px(H), transform: `scale(${scale})` })
    style(deco, { transform: `scale(${scale})` })
    measure()
    for (const bind of bindings) bind()
  }
  window.addEventListener('resize', syncPlate)
  listeners.push(() => window.removeEventListener('resize', syncPlate))

  return {
    syncPlate,
    dispose() {
      for (const remove of listeners) remove()
      listeners.length = 0
      bindings.length = 0
      scene.remove()
      deco.remove()
      wrapper.style.animation = ''
      delete layer.dataset.welcomeScene
    },
  }
}
