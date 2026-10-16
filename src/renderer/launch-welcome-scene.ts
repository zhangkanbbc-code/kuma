// 季节层只拥有自己创建的节点与场景监听；欢迎屏的四条退场路统一调用 dispose。
// 位置、构图与 symbol 采用 2026-10-15 定稿；位移、摆动与旋转分层承载。
// 动画只挂 HTML，且只用 replace，界面线程忙时仍由合成线程推进。
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
  // 保持原先整张 SVG 的绘制层级：图形在光晕等 HTML 装饰之下。
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
  // 包裹与图形保持同样尺寸/中心，多段运动沿用定稿的嵌套顺序。
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
  // 两个独立的 CSS 伪元素共享一个不动的容器，雨滴仍各走各的轨迹与延时。
  const pairedParticle = (kind: 'rain' | 'current', i: number, nodes: HTMLElement[], css: Css, motions: Motion[]) => {
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
      const halo = stage.html(clip, 'ks-sun-halo', { left: () => px(P.cx - d() * 1.35), top: () => px(P.y + P.h + 70 - d() * 1.63), width: () => px(d() * 2.7), height: () => px(d() * 2.7) })
      motion(halo, ['fade', T.fixed.sunHalo, T.fixed.sunHaloAt, 'ease'])
      const sun = stage.html(clip, 'ks-sun', { left: () => px(P.cx - d() / 2), top: () => px(P.y + P.h + 70 - d() * .78), width: () => px(d()), height: () => px(d()), '--rise': () => px(d() * .95) })
      motion(sun, ['sun-rise', T.fixed.sunRise, T.fixed.sunRiseAt, 'cubic-bezier(.16,.72,.24,1)'])
      for (let row = 0; row < 8; row++) for (let i = 0; i < (row < 3 ? 2 : 1); i++) {
        const w = R(12, 46) * (1 - row * .06), spread = R(-1, 1) * .42 * (1 - row * .07)
        const glint = stage.html(scene, 'ks-sun-glint-in', { left: () => px(P.cx + spread * d() - w / 2), top: () => px(P.y + P.h + 79 + row * 10.5), width: px(w) })
        const shine = stage.html(glint, 'ks-sun-glint')
        const at = range(T.newyear.glintAt)
        motion(glint, ['fade', T.fixed.glintIn, at, 'ease'])
        motion(shine, ['twinkle', range(T.newyear.glint), at + T.fixed.glintIn, 'ease-in-out', true, 'none'])
      }
      ring(T.newyear.ringAt)
    },
    setsubun() {
      for (const left of [true, false]) for (let i = 0; i < 9; i++) {
        const duration = range(T.setsubun.toss), at = (left ? T.setsubun.leftAt : T.setsubun.rightAt) + R(0, T.setsubun.spread)
        const x0 = left ? -30 : W + 30, dx = left ? R(-540, -70) : R(70, 540), roll = (left ? 1 : -1) * R(4, 24)
        const y0 = R(30, 110), yp = R(-430, -250), yf = R(-16, 16), bounce = R(10, 22)
        const bean = stage.html(scene, 'ks-bean-flight', { '--x0': px(x0), '--x1': () => px(P.cx + dx), '--x2': () => px(P.cx + dx + roll),
          '--y0': () => px(P.y + P.h + 150 + y0), '--yp': () => px(P.y + P.h + 150 + yp), '--yf': () => px(P.y + P.h + 150 + yf), '--yb': () => px(P.y + P.h + 150 + yf - bounce),
          '--rot': `${R(0, 180)}deg`, '--spin': `${R(-560, 560)}deg`, transform: () => `translate(${px(P.cx + dx + roll)}, ${px(P.y + P.h + 150 + yf)}) rotate(var(--rot))` })
        const arc = stage.html(bean, 'ks-motion'), seed = stage.html(arc, 'ks-bean')
        motion(bean, ['bean-x', duration, at])
        motion(arc, ['bean-y', duration, at])
        motion(seed, ['bean-spin', duration, at, 'cubic-bezier(.2,.7,.3,1)'])
        const shadow = stage.html(scene, 'ks-bean-shadow', { left: () => px(P.cx + dx + roll - 6.5), top: () => px(P.y + P.h + 155 + yf) })
        motion(shadow, ['fade', T.fixed.beanShadow, at + duration, 'ease'])
      }
      const hit = stage.html(deco, 'ks-bean ks-bean-hit', { left: () => px(P.w * .7), top: '-4px', '--rot': '12deg' })
      motion(hit, ['bean-drop', T.setsubun.hitDuration, T.setsubun.hitAt])
      // 沉一下的也是包裹层：.kw-box 原有的裁切与入场机制不改。
      // 包裹只承接短促位移，不覆盖它从欢迎屏继承的淡入。
      if (!calm) {
        wrapper.style.animation = `kuma-welcome-in ${T.fixed.plateIn}ms ease both, kuma-season-nudge ${T.fixed.nudge}ms ease-out ${T.setsubun.hitAt + T.setsubun.nudgeAt}ms backwards`
      }
    },
    valentine() {
      for (let i = 0; i < 18; i++) {
        const s = R(13, 32), x = R(60, W - 60), duration = range(T.valentine.rise), opacity = R(.28, .55)
        const heart = stage.glyph(art, 'heart', s, s * .92, { '--x': px(x), '--y0': px(H + 30), '--y1': px(R(-60, 160)), '--sw': px(R(10, 26)), '--op': opacity,
          transform: `translate(${px(x)}, ${px(R(120, H - 60))})`, opacity })
        const at = i < 8 ? -R(duration * .15, duration * .6) : range(T.valentine.start)
        motion(heart, ['rise', duration, at, 'linear', true], ['rise-o', duration, at, 'linear', true])
        motion(inner(heart), ['sway', range(T.valentine.sway) * 2, -R(0, T.valentine.sway[1]), 'ease-in-out', true])
      }
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
      for (let i = 0; i < 34; i++) {
        const gust = i < 12, y = gust ? R(120, 660) : -40, x = gust ? W + 40 : R(260, W + 260)
        const duration = range(gust ? T.spring.gust : T.spring.fall), s = R(gust ? 15 : 12, gust ? 23 : 20)
        const node = stage.glyph(art, 'petal', s, s * 1.04, { opacity: R(gust ? .75 : .5, gust ? .95 : .9), '--r0': `${R(0, 360)}deg` })
        const swing = fall(node, x, y, gust ? -80 : x - R(360, 600), gust ? y + R(160, 320) : H + 40, duration,
          gust ? range(T.spring.gustAt) : i < 22 ? -R(0, duration) : range(T.spring.fallAt), R(gust ? 8 : 14, gust ? 20 : 38), range(gust ? T.spring.gustSway : T.spring.sway), gust)
        if (calm && gust) node.style.display = 'none'
        if (!calm) {
          motion(inner(swing), ['flutter', range(T.spring.flutter), 0, 'linear', true])
        } else node.style.transform += ' rotate(var(--r0))'
      }
      for (const [i, fraction] of [.16, .58, .88].entries()) {
        const node = stage.glyph(decoArt!, 'petal', 16, 16.6, { '--lx': px(R(50, 110)), '--rf': `${R(-35, 35)}deg`, '--land-x': () => px(P.w * fraction - 7), transform: () => `translate(${px(P.w * fraction - 7)}, -9px) rotate(var(--rf))` })
        motion(node, ['petal-land', T.fixed.petalLand, T.spring.landAt[i]])
      }
    },
    tsuyu() {
      const drops: HTMLElement[] = []
      if (!calm) for (let i = 0; i < 40; i++) pairedParticle('rain', i, drops, {
        x0: px(R(0, W + 300)), size: px(R(40, 90)), op: R(.3, .62),
      }, [['rain', range(T.tsuyu.rain), range(i < 10 ? T.tsuyu.firstAt : T.tsuyu.rainAt), 'linear', true]])
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
        const radius = R(120, 170)
        let spark: HTMLElement
        for (let i = 0; i < 38; i++) {
          const outer = i < 26, angle = 360 / (outer ? 26 : 12) * (outer ? i : i - 26) + R(outer ? -5 : -8, outer ? 5 : 8)
          if (!(i % 2)) spark = stage.html(gravity, 'ks-fw-sparks')
          const slot = i % 2 ? 'b' : 'a'
          style(spark!, { [`--${slot}-angle`]: `${angle}deg`, [`--${slot}-radius`]: px(radius * R(outer ? .78 : .42, outer ? 1.06 : .56)), [`--${slot}-c`]: colors[outer ? k : (k + 1) % 3] })
          if (!calm) style(spark!, { '--spark-motion': `kuma-season-fw-spread ${T.summer.cycle}ms linear ${at}ms infinite backwards, kuma-season-fw-spark-o ${T.summer.cycle}ms linear ${at}ms infinite backwards` })
        }
        // 六道水面反光用一个 SVG path，构图和每发花火仍共用原周期。
        const reflection = stage.html(scene, 'ks-fw-reflection')
        style(reflection, { left: px(position.x - 50), top: () => px(P.y + P.h + 117), '--c': colors[k] })
        let d = ''
        for (let row = 0; row < 6; row++) { const w = R(12, 42) * (1 - row * .1), x = 50 + R(-10, 10); d += `M${x - w / 2} ${row * 9 + 1}h${w}` }
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
    },
    sanma() {
      const currents: HTMLElement[] = []
      for (let i = 0; i < 6; i++) pairedParticle('current', i, currents, {
        top: px(R(110, H - 70)), left: px(R(-200, W - 600)), width: px(R(400, 900)), dx: px(-R(120, 260)), direction: 'alternate',
      }, [['drift', range(T.sanma.current), -R(0, T.sanma.current[0]), 'ease-in-out', true]])
      for (const near of [true, false]) {
        const size = near ? 1 : .62, duration = near ? T.sanma.near : T.sanma.far, at = near ? 0 : T.sanma.farAt
        const placed: { x: number; y: number }[] = []
        for (let i = 0; i < (near ? 11 : 6); i++) {
          let x = 0, y = 0
          for (let attempt = 0; attempt < 40; attempt++) {
            x = R(0, 430 * size); y = R(-95, 95) * size
            if (!placed.some((p) => Math.abs(p.x - x) < 175 * size && Math.abs(p.y - y) < 17 * size)) break
          }
          placed.push({ x, y })
          const length = R(150, 190) * size, bob = range(T.sanma.bob), bobAt = -R(0, T.sanma.bob[1]), wig = range(T.sanma.wig)
          const css: Css = { '--sx0': px(-(620 * size + 30) + x), '--sx1': px(W + 30 + x), '--fish-y': () => px((near ? P.y + P.h + 150 : P.y - 200) + y),
            transform: () => `translate(${px(P.cx - 260 * size + x)}, var(--fish-y))`, '--op': near ? 1 : .55, opacity: near ? 1 : .55 }
          const fish = stage.glyph(art, 'saury', length, length * 22 / 170, css)
          const glint = stage.glyph(art, 'saury-glint', length, length * 22 / 170, css)
          for (const node of [fish, glint]) {
            motion(node, ['swim', duration, at, 'linear', true])
            const float = inner(node), tail = inner(float)
            motion(float, ['bob', bob, bobAt, 'ease-in-out', true])
            motion(tail, ['wig', wig, 0, 'ease-in-out', true])
            if (!calm) { float.style.animationDirection = 'alternate'; tail.style.animationDirection = 'alternate' }
          }
          if (!calm) {
            glint.style.animation += `, kuma-season-glint ${duration}ms linear ${at + R(T.sanma.glintAt, duration * .7)}ms infinite backwards`
          } else glint.style.opacity = '0'
        }
      }
    },
    halloween() {
      const positions = [{ dx: -150, w: 118 }, { dx: P.w + 34, w: 92 }, { dx: P.w + 138, w: 66 }]
      const order = shuffle(3), on: number[] = []
      order.forEach((index, i) => { on[index] = T.halloween.firstAt + i * T.halloween.step + R(-T.halloween.jitter, T.halloween.jitter) })
      positions.forEach(({ dx, w }, i) => {
        const h = w * 100 / 120
        const halo = stage.html(scene, 'ks-pumpkin-halo', { left: () => px(P.x + (i ? P.w + (i === 1 ? 34 : 138) : dx) - w * .9), top: () => px(P.y + P.h + 38 - h * .45 - w * 1.4), width: px(w * 2.8), height: px(w * 2.8) })
        const haloLight = stage.html(halo, 'ks-motion ks-pumpkin-light')
        motion(halo, ['pk-ignite', T.fixed.pkIgnite, on[i]])
        motion(haloLight, ['pk-flicker', T.fixed.pkFlicker, on[i] + T.fixed.pkIgnite, 'linear', true, 'none'])
        const position: Css = { left: () => px(P.x + (i ? P.w + (i === 1 ? 34 : 138) : dx)), top: () => px(P.y + P.h + 38 - h) }
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
      if (!calm) {
        for (let i = 0; i < 4; i++) {
          const x0 = P.cx + R(-30, 30), y0 = P.cy + R(-8, 8), x3 = i % 2 ? R(W + 90, W + 240) : R(-240, -90), y3 = R(-160, 60)
          const x1 = x0 + (x3 - x0) * .28 + R(-50, 50), y1 = y0 - R(100, 170), x2 = x0 + (x3 - x0) * .64 + R(-50, 50), y2 = y1 + (y3 - y1) * .45 + R(-40, 50), s = R(46, 66)
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
      const onAt: number[] = []
      shuffle(count).forEach((index, i) => { onAt[index] = T.xmas.firstAt + i * T.xmas.step })
      const starsAt = T.xmas.firstAt + (count - 1) * T.xmas.step + T.xmas.starAfter
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
      // 小灯的暗壳/吊头仍是两条 SVG path；原先每两盏共用静止容器的发光层，
      // 改为每盏独立的点亮/闪烁两层，避免同一伪元素上的两条 opacity 动画。
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
    const xs: number[] = []
    let x = 0
    for (const lamp of selection.lamps) { if (lamp.breakBefore) x += 22; xs.push(x); x += 34 }
    const row = stage.html(scene, 'ks-lamps', { left: () => px(P.cx - (xs.at(-1) ?? 0) / 2), top: () => px(P.y + P.h + 46) })
    const at = (i: number) => T.event.firstAt + i * T.event.step
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
        }
        if ((!lamp.breakBefore && (selection.complete || i <= current)) || (lamp.breakBefore && selection.complete)) {
          const done = stage.html(row, 'ks-route ks-route-done', { left: px(xs[i - 1]), width: px(xs[i] - xs[i - 1]) })
          motion(done, ['grow-x', lamp.breakBefore ? T.fixed.routeJoin : T.event.step, lamp.breakBefore ? finishedAt + T.event.joinAfter : at(i - 1)])
        }
      }
      const node = stage.html(row, `ks-lamp ks-lamp-${lamp.state}`, { left: px(xs[i]), '--c': lamp.state === 'done' ? 'var(--gold)' : 'var(--accent)' })
      node.dataset.mapId = String(lamp.mapId)
      motion(node, ['fade', T.fixed.lampIn, T.fixed.lampAt, 'ease'])
      const on = at(i) + (lamp.state === 'current' ? T.event.currentAfter : 0)
      if (lamp.state === 'current') {
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
