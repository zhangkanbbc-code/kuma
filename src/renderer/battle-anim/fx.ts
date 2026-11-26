// 动画复盘的像素特效层：两张 canvas——底下一张画海面（昼夜、阻塞气球），上面一张画弹道、飞机、爆炸、烟幕。
//
// 做法：
// - 像素风：逻辑像素 PX = 3，所有图形按 PX 网格取整绘制，关闭图像平滑。
// - 颜色一律从 kuma 的颜色变量取（getComputedStyle 读宿主元素），根节点 data-theme / data-cvd 变了就重读，
//   跟着浅色主题与色觉模式走；读不到才用退路色。分得清敌我与伤害档的颜色都走变量。
// - 时间：特效按绝对时刻（performance.now 的毫秒）排程，由播放器按倍速换算好再交进来。
//   引擎只管「什么时刻画什么」与「什么时刻触发命中回调」，不碰兵牌与血量。
// - 没有活动的特效时播放器就停掉 rAF（hasActive），离屏 / 暂停零空转。

import { AIR_HANDOFF } from '../../shared/battle-anim-script'

export interface Pt {
  x: number
  y: number
}

export const PX = 3

interface Palette {
  ally: string
  foe: string
  friend: string
  shell: string
  heavy: string
  torpedo: string
  radar: string
  fire: string
  spark: string
  smoke: string
  water: string
  seaTop: string
  seaBottom: string
  night: string
  wave: string
  flare: string
}

// 调色板每一格取哪个变量（都在复盘窗根块里定义过，浅色主题与色觉模式各自覆盖）。
// 一个写死的颜色都不留（test/theme-no-literal-colors）：变量缺席时退回宿主的文字色。
const TOKEN: Record<keyof Palette, string> = {
  ally: '--accent',
  foe: '--entity-abyss',
  friend: '--ok',
  shell: '--gold',
  heavy: '--warn',
  torpedo: '--accent-ink',
  radar: '--bad',
  fire: '--warn',
  spark: '--text',
  smoke: '--sub',
  water: '--text',
  seaTop: '--accent-wash',
  seaBottom: '--bg0',
  night: '--night',
  wave: '--line',
  flare: '--gold',
}

interface Track {
  start: number
  end: number
  render: (p: number, now: number) => void
}

interface Cue {
  at: number
  fn: () => void
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const easeOut = (t: number) => 1 - (1 - t) * (1 - t)
const easeIn = (t: number) => t * t
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)
const clamp01 = (t: number) => Math.max(0, Math.min(1, t))

export type PlaneKind = 'bomb' | 'torpedo' | 'generic' | 'jet' | 'night' | 'seaplane' | 'asw' | 'heavy'

export class FxEngine {
  private sea: HTMLCanvasElement
  private fx: HTMLCanvasElement
  private seaCtx: CanvasRenderingContext2D
  private ctx: CanvasRenderingContext2D
  private host: HTMLElement
  private tracks: Track[] = []
  private cues: Cue[] = []
  private width = 0
  private height = 0
  private palette = {} as Palette
  private night = false
  private balloon: Pt[] = []
  private balloonLit = false
  private smokeLevel = 0
  private smokeBox: { left: number; right: number; top: number; bottom: number } | null = null
  private observer: MutationObserver

  constructor(sea: HTMLCanvasElement, fx: HTMLCanvasElement, host: HTMLElement) {
    this.sea = sea
    this.fx = fx
    this.host = host
    this.seaCtx = sea.getContext('2d')!
    this.ctx = fx.getContext('2d')!
    this.refreshPalette()
    // 主题 / 色觉模式切换：重读颜色，重画海面
    this.observer = new MutationObserver(() => {
      this.refreshPalette()
      this.drawSea()
    })
    this.observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-cvd'] })
  }

  destroy() {
    this.observer.disconnect()
    this.tracks = []
    this.cues = []
  }

  refreshPalette() {
    const style = getComputedStyle(this.host)
    const fallback = style.color
    const next = {} as Palette
    for (const [key, token] of Object.entries(TOKEN) as [keyof Palette, string][]) {
      next[key] = style.getPropertyValue(token).trim() || fallback
    }
    this.palette = next
  }

  resize(width: number, height: number) {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1))
    this.width = width
    this.height = height
    for (const canvas of [this.sea, this.fx]) {
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
    }
    for (const ctx of [this.seaCtx, this.ctx]) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.imageSmoothingEnabled = false
    }
    this.drawSea()
  }

  /** 海面状态：昼夜、阻塞气球位置（我方阵地上空）、烟幕层数与覆盖区 */
  setScene(scene: { night: boolean; balloon: Pt[]; smoke: number; smokeBox: FxEngine['smokeBox'] }) {
    const changed = scene.night !== this.night || scene.balloon.length !== this.balloon.length
    this.night = scene.night
    this.balloon = scene.balloon
    this.smokeLevel = scene.smoke
    this.smokeBox = scene.smokeBox
    if (changed) this.drawSea()
    this.drawStatic()
  }

  setBalloonLit(lit: boolean) {
    this.balloonLit = lit
    this.drawSea()
  }

  clear() {
    this.tracks = []
    this.cues = []
    this.drawStatic()
  }

  hasActive(): boolean {
    return this.tracks.length > 0 || this.cues.length > 0
  }

  // 暂停时整层时间冻住：特效一律按 now()（扣掉暂停时长的时钟）排程与绘制，继续播放时从停下那一帧接着走
  private frozenAt: number | null = null
  private pausedTotal = 0

  now(): number {
    return (this.frozenAt ?? performance.now()) - this.pausedTotal
  }

  get frozen(): boolean {
    return this.frozenAt != null
  }

  freeze() {
    if (this.frozenAt == null) this.frozenAt = performance.now()
  }

  thaw() {
    if (this.frozenAt == null) return
    this.pausedTotal += performance.now() - this.frozenAt
    this.frozenAt = null
  }

  /** 已排下的特效（含飞机撤出、爆炸淡出）与回调全部走完的时刻；没有就是 0。播放器据此定一步何时真正结束 */
  idleAt(): number {
    let end = 0
    for (const track of this.tracks) end = Math.max(end, track.end)
    for (const cue of this.cues) end = Math.max(end, cue.at)
    return end
  }

  /** 推进一帧：触发到点的回调、画出当前的特效 */
  tick(now: number) {
    if (this.cues.length) {
      const due = this.cues.filter((cue) => cue.at <= now)
      if (due.length) {
        this.cues = this.cues.filter((cue) => cue.at > now)
        for (const cue of due.sort((a, b) => a.at - b.at)) cue.fn()
      }
    }
    this.tracks = this.tracks.filter((track) => track.end > now)
    this.drawStatic()
    for (const track of this.tracks) {
      if (now < track.start) continue
      track.render(clamp01((now - track.start) / Math.max(1, track.end - track.start)), now)
    }
  }

  /** 到某个时刻执行一次（命中结算、血条落下） */
  cue(at: number, fn: () => void) {
    this.cues.push({ at, fn })
  }

  private add(start: number, duration: number, render: Track['render']) {
    this.tracks.push({ start, end: start + Math.max(1, duration), render })
  }

  // ---- 绘制原语 ----

  private dot(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string, alpha = 1) {
    const s = Math.max(PX, Math.round(size / PX) * PX)
    ctx.globalAlpha = alpha
    ctx.fillStyle = color
    ctx.fillRect(Math.round(x / PX) * PX - s / 2, Math.round(y / PX) * PX - s / 2, s, s)
    ctx.globalAlpha = 1
  }

  private drawSea() {
    const ctx = this.seaCtx
    const { width, height } = this
    if (!width || !height) return
    const p = this.palette
    const grad = ctx.createLinearGradient(0, 0, 0, height)
    grad.addColorStop(0, this.night ? p.seaBottom : p.seaTop)
    grad.addColorStop(1, p.seaBottom)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, width, height)
    // 夜战：整片海压一层夜色
    if (this.night) {
      ctx.globalAlpha = 0.14
      ctx.fillStyle = p.night
      ctx.fillRect(0, 0, width, height)
      ctx.globalAlpha = 1
    }
    // 像素浪纹：固定种子，每次重画同一片海
    let seed = 7
    const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280)
    ctx.fillStyle = p.wave
    ctx.globalAlpha = this.night ? 0.35 : 0.55
    for (let i = 0; i < Math.round((width * height) / 9000); i += 1) {
      const x = Math.round((rand() * width) / PX) * PX
      const y = Math.round((rand() * height) / PX) * PX
      const len = PX * (2 + Math.floor(rand() * 4))
      ctx.fillRect(x, y, len, PX)
    }
    ctx.globalAlpha = 1
    // 阻塞气球：我方阵地上空，钢缆垂到海面；航空阶段亮起
    for (const b of this.balloon) {
      ctx.fillStyle = this.balloonLit ? p.flare : p.smoke
      ctx.globalAlpha = this.balloonLit ? 0.95 : 0.6
      for (let y = b.y + PX * 4; y < Math.min(height, b.y + 90); y += PX * 2) ctx.fillRect(Math.round(b.x / PX) * PX, y, PX / 1.5, PX)
      ctx.fillRect(Math.round(b.x / PX) * PX - PX * 3, b.y - PX * 2, PX * 7, PX * 4)
      ctx.fillRect(Math.round(b.x / PX) * PX - PX * 2, b.y - PX * 3, PX * 5, PX * 6)
      ctx.globalAlpha = 1
    }
  }

  // 每帧的底：清空特效层，画持续存在的烟幕
  private drawStatic() {
    const ctx = this.ctx
    ctx.clearRect(0, 0, this.width, this.height)
    if (this.smokeLevel > 0 && this.smokeBox) {
      const box = this.smokeBox
      const t = performance.now() / 1000
      const count = 10 + this.smokeLevel * 8
      for (let i = 0; i < count; i += 1) {
        const fx = (i * 0.618) % 1
        const fy = (i * 0.37) % 1
        const x = lerp(box.left, box.right, fx) + Math.sin(t * 0.6 + i) * 8
        const y = lerp(box.top, box.bottom, fy) + Math.cos(t * 0.4 + i * 1.3) * 5
        const size = PX * (5 + (i % 4) * 2)
        this.dot(ctx, x, y, size, this.palette.smoke, 0.16 + this.smokeLevel * 0.06)
      }
    }
  }

  // ---- 命中表现 ----

  explosion(at: Pt, start: number, big = false) {
    const ctx = this.ctx
    const p = this.palette
    const shards = Array.from({ length: big ? 16 : 10 }, (_, i) => ({
      a: (i / (big ? 16 : 10)) * Math.PI * 2 + Math.random() * 0.4,
      v: (big ? 34 : 22) * (0.6 + Math.random() * 0.6),
    }))
    this.add(start, big ? 620 : 460, (t) => {
      const r = easeOut(t)
      this.dot(ctx, at.x, at.y, (big ? 18 : 12) * (1 - t * 0.6), p.spark, 1 - t)
      this.dot(ctx, at.x, at.y, (big ? 26 : 18) * r, p.fire, 0.55 * (1 - t))
      for (const s of shards) {
        this.dot(ctx, at.x + Math.cos(s.a) * s.v * r, at.y + Math.sin(s.a) * s.v * r, PX * (t < 0.5 ? 2 : 1), t < 0.4 ? p.spark : p.fire, 1 - t)
      }
    })
  }

  splash(at: Pt, start: number, tall = false) {
    const ctx = this.ctx
    const color = this.palette.water
    this.add(start, tall ? 640 : 480, (t) => {
      const h = (tall ? 34 : 18) * Math.sin(Math.PI * Math.min(1, t * 1.2))
      for (let y = 0; y < h; y += PX) this.dot(ctx, at.x + Math.sin(y) * PX, at.y - y, PX * (tall ? 2 : 1.4), color, 0.85 * (1 - t))
      this.dot(ctx, at.x - 8 * t, at.y, PX, color, 0.7 * (1 - t))
      this.dot(ctx, at.x + 8 * t, at.y, PX, color, 0.7 * (1 - t))
    })
  }

  ring(at: Pt, start: number, color: string, radius = 22, duration = 560) {
    const ctx = this.ctx
    this.add(start, duration, (t) => {
      const r = radius * easeOut(t)
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 10) this.dot(ctx, at.x + Math.cos(a) * r, at.y + Math.sin(a) * r * 0.55, PX, color, 1 - t)
    })
  }

  /** 命中点的结果：落空水花 / 命中爆炸（暴击、击沉更大）/ 鱼雷高水柱 / 爆雷水下冲击 */
  impact(at: Pt, start: number, o: { miss: boolean; big?: boolean; torpedo?: boolean; asw?: boolean }) {
    if (o.miss) return this.splash({ x: at.x + 10, y: at.y + 6 }, start)
    if (o.asw) {
      this.ring(at, start, this.palette.torpedo, 18)
      this.ring(at, start + 140, this.palette.torpedo, 28, 640)
      return this.splash(at, start + 60, true)
    }
    if (o.torpedo) {
      this.splash(at, start, true)
      return this.explosion(at, start + 80, o.big)
    }
    this.explosion(at, start, o.big)
  }

  /**
   * 闪避残影：兵牌侧身让开后，原位留下的那条边（让开的反方向那侧）化成一列像素虚线，拖出三道短速度线，随即淡去。
   * dir 是让开的方向：-1 往左，残影留在原来的右边。
   */
  afterimage(box: { x: number; y: number; w: number; h: number }, start: number, duration: number, side: 0 | 1 | 2, dir: -1 | 1) {
    if (!box.w || !box.h) return
    const ctx = this.ctx
    const p = this.palette
    const color = side === 1 ? p.foe : side === 2 ? p.friend : p.ally
    const top = box.y - box.h / 2
    const bottom = box.y + box.h / 2
    const edge = box.x - (dir * box.w) / 2
    this.add(start, duration, (t) => {
      const alpha = 0.6 * (1 - t)
      for (let y = top + PX; y < bottom; y += PX * 2) this.dot(ctx, edge, y, PX, color, alpha)
      const reach = PX * (2 + 5 * easeOut(t))
      for (const f of [0.28, 0.5, 0.72]) {
        const y = top + box.h * f
        for (let k = 0; k <= reach; k += PX) this.dot(ctx, edge - dir * (PX * 2 + k), y, PX, color, alpha * (1 - k / (reach + PX)))
      }
    })
  }

  // ---- 弹道 ----

  /** 炮弹：抛物线飞过去，炮口一闪；heavy = 特攻的粗亮弹，radar = 先扫描锁定再远程抛射 */
  shot(o: { from: Pt; to: Pt; at: number; travel: number; kind: 'shell' | 'heavy' | 'radar'; miss: boolean; big?: boolean; onImpact?: () => void }) {
    const ctx = this.ctx
    const p = this.palette
    const color = o.kind === 'heavy' ? p.heavy : o.kind === 'radar' ? p.radar : p.shell
    let start = o.at
    if (o.kind === 'radar') {
      // 雷达扇形扫过目标 + 四角锁定框
      const scan = o.travel * 0.6
      this.add(start, scan, (t) => {
        const r = 40 + 260 * t
        for (let a = -0.25; a <= 0.25; a += 0.05) {
          const dir = Math.atan2(o.to.y - o.from.y, o.to.x - o.from.x) + a
          this.dot(ctx, o.from.x + Math.cos(dir) * r, o.from.y + Math.sin(dir) * r, PX, p.radar, 0.6 * (1 - t))
        }
      })
      this.add(start + scan * 0.5, scan + o.travel, (t) => {
        const s = 20 - 6 * t
        const blink = Math.floor(t * 8) % 2 === 0 ? 1 : 0.4
        for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          this.dot(ctx, o.to.x + dx * s, o.to.y + dy * s * 0.6, PX * 1.5, p.radar, blink)
        }
      })
      start += scan
    }
    const flash = { x: o.from.x + Math.sign(o.to.x - o.from.x) * 10, y: o.from.y }
    this.add(start, 160, (t) => this.dot(ctx, flash.x, flash.y, (o.kind === 'heavy' ? 14 : 9) * (1 - t), p.spark, 1 - t))
    const lob = o.kind === 'radar' ? 90 : o.kind === 'heavy' ? 46 : 36
    const target = o.miss ? { x: o.to.x + 18, y: o.to.y + 10 } : o.to
    this.add(start, o.travel, (t) => {
      const x = lerp(flash.x, target.x, t)
      const y = lerp(flash.y, target.y, t) - Math.sin(Math.PI * t) * lob
      this.dot(ctx, x, y, o.kind === 'heavy' ? PX * 2.6 : PX * 2, color)
      const tx = lerp(flash.x, target.x, Math.max(0, t - 0.05))
      const ty = lerp(flash.y, target.y, Math.max(0, t - 0.05)) - Math.sin(Math.PI * Math.max(0, t - 0.05)) * lob
      this.dot(ctx, tx, ty, PX * 1.4, color, 0.45)
    })
    const hitAt = start + o.travel
    this.impact(o.to, hitAt, { miss: o.miss, big: o.big || o.kind === 'heavy' })
    if (o.onImpact) this.cue(hitAt, o.onImpact)
    return hitAt
  }

  /** 鱼雷：贴着海面拖一道白色航迹，命中炸起高水柱 */
  torpedo(o: { from: Pt; to: Pt; at: number; travel: number; miss: boolean; big?: boolean; onImpact?: () => void }) {
    const ctx = this.ctx
    const p = this.palette
    const target = o.miss ? { x: o.to.x + 24, y: o.to.y + 16 } : o.to
    this.splash(o.from, o.at)
    this.add(o.at, o.travel + 300, (t, now) => {
      const head = clamp01((now - o.at) / o.travel)
      for (let s = 0; s <= head; s += 0.025) {
        const fade = 1 - (head - s) * 2.4
        if (fade <= 0) continue
        this.dot(ctx, lerp(o.from.x, target.x, s), lerp(o.from.y, target.y, s) + PX, PX, p.torpedo, fade * (head >= 1 ? 1 - t : 1))
      }
    })
    const hitAt = o.at + o.travel
    this.impact(o.to, hitAt, { miss: o.miss, torpedo: true, big: o.big })
    if (o.onImpact) this.cue(hitAt, o.onImpact)
    return hitAt
  }

  /** 水面反潜：声呐扇形扫中目标，高抛深水炸弹，水下双层冲击环 */
  depthCharge(o: { from: Pt; to: Pt; at: number; travel: number; miss: boolean; onImpact?: () => void }) {
    const ctx = this.ctx
    const p = this.palette
    const sonar = o.travel * 0.45
    this.add(o.at, sonar, (t) => {
      const r = 30 + 200 * t
      const dir = Math.atan2(o.to.y - o.from.y, o.to.x - o.from.x)
      for (let a = -0.3; a <= 0.3; a += 0.06) this.dot(ctx, o.from.x + Math.cos(dir + a) * r, o.from.y + Math.sin(dir + a) * r, PX, p.torpedo, 0.5 * (1 - t))
    })
    const start = o.at + sonar
    this.add(start, o.travel, (t) => {
      this.dot(ctx, lerp(o.from.x, o.to.x, t), lerp(o.from.y, o.to.y, t) - Math.sin(Math.PI * t) * 52, PX * 1.6, p.water)
    })
    const hitAt = start + o.travel
    this.impact(o.to, hitAt, { miss: o.miss, asw: true })
    if (o.onImpact) this.cue(hitAt, o.onImpact)
    return hitAt
  }

  // ---- 飞机 ----

  private drawPlane(x: number, y: number, dir: number, color: string, kind: PlaneKind, alpha = 1) {
    const ctx = this.ctx
    const d = dir >= 0 ? 1 : -1
    const big = kind === 'heavy'
    // 机身 + 主翼（后掠翼给喷气式）
    for (let i = -2; i <= 2; i += 1) this.dot(ctx, x + i * PX * d, y, PX, color, alpha)
    const span = big ? 4 : 3
    const sweep = kind === 'jet' ? -1 : 0
    for (let i = 1; i <= span; i += 1) {
      this.dot(ctx, x + sweep * i * PX * d, y - i * PX, PX, color, alpha)
      this.dot(ctx, x + sweep * i * PX * d, y + i * PX, PX, color, alpha)
    }
    this.dot(ctx, x - 2 * PX * d, y - PX, PX, color, alpha)
    if (kind === 'night') this.dot(ctx, x + 2 * PX * d, y, PX, this.palette.flare, alpha)
    if (kind === 'seaplane') {
      this.dot(ctx, x - PX * d, y + 2 * PX, PX, color, alpha * 0.8)
      this.dot(ctx, x + PX * d, y + 2 * PX, PX, color, alpha * 0.8)
    }
  }

  /**
   * 飞机打一击：从己方一侧飞到目标上空 / 前方，按种类投下炸弹或鱼雷，再绕后拉升返航（绝不撞船）。
   * kind 由真实数据定：bomb 炸弹、torpedo 鱼雷、generic 不明（旧快照没有标记）、jet 喷式、
   * night 夜间舰载机、seaplane 水上轰炸机、asw 航空反潜、heavy 陆攻大型机。
   */
  plane(o: { from: Pt; to: Pt; at: number; travel: number; kind: PlaneKind; side: 0 | 1 | 2; miss: boolean; big?: boolean; onImpact?: () => void }) {
    const ctx = this.ctx
    const p = this.palette
    const color = o.side === 1 ? p.foe : o.side === 2 ? p.friend : p.ally
    const dir = o.to.x >= o.from.x ? 1 : -1
    const torpedoRun = o.kind === 'torpedo'
    const speed = o.kind === 'jet' ? 0.7 : 1
    const approach = o.travel * 0.62 * speed
    const release: Pt = torpedoRun
      ? { x: o.to.x - dir * 70, y: o.to.y - 6 }
      : { x: o.to.x - dir * 14, y: o.to.y - (o.kind === 'heavy' ? 74 : 60) }
    const exit: Pt = { x: o.to.x + dir * 140, y: Math.max(16, o.to.y - 130) }
    // 进场
    this.add(o.at, approach, (t) => {
      const e = easeInOut(t)
      const x = lerp(o.from.x, release.x, e)
      const y = lerp(o.from.y, release.y, e) - Math.sin(Math.PI * e) * (torpedoRun ? 10 : 24)
      this.drawPlane(x, y, dir, color, o.kind)
      if (o.kind === 'jet') this.dot(ctx, x - dir * PX * 4, y, PX * 2, p.fire, 0.7)
    })
    // 投弹后绕后拉升
    const climbStart = o.at + approach
    this.add(climbStart, o.travel * 0.7, (t) => {
      const e = easeIn(t)
      this.drawPlane(lerp(release.x, exit.x, e), lerp(release.y, exit.y, e), dir, color, o.kind, 1 - t * 0.7)
    })
    const drop = o.travel * 0.38
    const hitAt = climbStart + drop
    if (torpedoRun) {
      // 航空鱼雷：溅水入海，贴海冲向目标
      this.splash(release, climbStart)
      this.add(climbStart, drop, (t) => this.dot(ctx, lerp(release.x, o.to.x, t), lerp(release.y + 6, o.to.y, t), PX, p.torpedo))
      this.impact(o.to, hitAt, { miss: o.miss, torpedo: true, big: o.big })
    } else if (o.kind === 'asw') {
      this.add(climbStart, drop, (t) => this.dot(ctx, release.x, lerp(release.y, o.to.y, easeIn(t)), PX * 1.4, p.water))
      this.impact(o.to, hitAt, { miss: o.miss, asw: true })
    } else {
      // 炸弹：重力下坠；generic（不明种类）也画成下落的弹，不冒充鱼雷
      const count = o.kind === 'heavy' ? 3 : o.kind === 'generic' ? 1 : 2
      for (let i = 0; i < count; i += 1) {
        const offset = (i - (count - 1) / 2) * 8
        this.add(climbStart + i * 40, drop, (t) => {
          const e = easeIn(t)
          this.dot(ctx, lerp(release.x + offset, o.to.x + offset * 0.5, e), lerp(release.y, o.to.y, e), PX * 1.3, p.shell)
        })
      }
      this.impact(o.to, hitAt, { miss: o.miss, big: o.big || o.kind === 'heavy' })
    }
    if (o.onImpact) this.cue(hitAt, o.onImpact)
    return hitAt
  }

  /**
   * 双方机群缠斗：从各自一侧飞进中空，绕着交叉的椭圆盘旋、互射曳光，
   * 按真实击坠比例坠海（每方画 planes 架，坠落 round(planes × lost / count)）。
   * handoff 是这一方接着要飞几趟投弹：盘旋到 AIR_HANDOFF 时，前这么多架幸存机不返航，
   * 把它们当时的位置交回去，由播放器从那里接着飞去投弹（缠斗与空袭连成一气）；其余幸存机调头飞回己方。
   */
  dogfight(o: {
    center: Pt
    at: number
    duration: number
    ally: { count: number; lost: number }
    foe: { count: number; lost: number }
    allySide?: 0 | 2
    handoff?: { ally: number; foe: number }
  }): { at: number; ally: Pt[]; foe: Pt[] } {
    const ctx = this.ctx
    const p = this.palette
    const shown = (count: number) => Math.max(1, Math.min(7, Math.round(count / 12)))
    const groups = [
      { key: 'ally' as const, color: o.allySide === 2 ? p.friend : p.ally, from: -1, count: o.ally.count, lost: o.ally.lost, keep: o.handoff?.ally ?? 0, planes: 0, down: 0 },
      { key: 'foe' as const, color: p.foe, from: 1, count: o.foe.count, lost: o.foe.lost, keep: o.handoff?.foe ?? 0, planes: 0, down: 0 },
    ]
    for (const g of groups) {
      g.planes = shown(g.count)
      // 有击坠又要接着投弹：至少画两架，一架坠海、一架飞出去投弹
      if (g.keep > 0 && g.lost > 0) g.planes = Math.max(2, g.planes)
      g.down = g.count ? Math.round((g.planes * g.lost) / g.count) : 0
      if (g.lost > 0 && g.down === 0) g.down = 1
      // 显示架数是按比例缩的，四舍五入可能把全队算没；要投弹的一方至少留一架活着
      if (g.keep > 0) g.down = Math.min(g.down, g.planes - 1)
    }
    const enter = o.duration * 0.25
    const circle = o.duration * (AIR_HANDOFF - 0.25)
    const leave = o.duration * (1 - AIR_HANDOFF)
    const handed = { at: o.at + enter + circle, ally: [] as Pt[], foe: [] as Pt[] }
    for (const g of groups) {
      for (let i = 0; i < g.planes; i += 1) {
        const falls = i < g.down
        const phase = (i / g.planes) * Math.PI * 2
        const startX = o.center.x + g.from * (this.width * 0.42)
        const startY = o.center.y - 40 + i * 9
        const orbit = (t: number): Pt => ({
          x: o.center.x + Math.cos(phase + t * Math.PI * 2.4 * -g.from) * (70 + i * 5) * (g.from < 0 ? 1 : 0.85),
          y: o.center.y + Math.sin(phase + t * Math.PI * 2.4) * (26 + i * 2),
        })
        this.add(o.at, enter, (t) => {
          const target = orbit(0)
          const e = easeOut(t)
          this.drawPlane(lerp(startX, target.x, e), lerp(startY, target.y, e), -g.from, g.color, 'generic')
        })
        this.add(o.at + enter, circle, (t) => {
          const pos = orbit(t)
          const next = orbit(t + 0.02)
          this.drawPlane(pos.x, pos.y, next.x - pos.x, g.color, 'generic')
          if (Math.floor(t * 20 + i) % 5 === 0) this.dot(ctx, pos.x + (next.x - pos.x) * 4, pos.y + (next.y - pos.y) * 4, PX, p.spark, 0.9)
        })
        const tail = orbit(1)
        if (falls) {
          // 中空起火，拖着烟坠海，落海一朵水花
          const fallStart = o.at + enter + circle * (0.4 + (i / Math.max(1, g.down)) * 0.4)
          const sea = { x: tail.x + g.from * 20, y: Math.min(this.height - 20, tail.y + 120) }
          this.explosion(tail, fallStart)
          this.add(fallStart, leave + circle * 0.2, (t) => {
            const e = easeIn(t)
            const x = lerp(tail.x, sea.x, e)
            const y = lerp(tail.y, sea.y, e)
            this.drawPlane(x, y, g.from, p.fire, 'generic', 1 - t * 0.5)
            this.dot(ctx, x - g.from * 6, y - 6, PX * 2, p.smoke, 0.5 * (1 - t))
          })
          this.splash(sea, fallStart + leave + circle * 0.2)
        } else if (i - g.down < g.keep) {
          // 这一架接着去投弹：缠斗画到这里为止，位置交给播放器
          handed[g.key].push(tail)
        } else {
          const home = { x: o.center.x + g.from * (this.width * 0.45), y: tail.y - 40 }
          this.add(o.at + enter + circle, leave, (t) => {
            const e = easeIn(t)
            this.drawPlane(lerp(tail.x, home.x, e), lerp(tail.y, home.y, e), g.from, g.color, 'generic', 1 - t * 0.6)
          })
        }
      }
    }
    return handed
  }

  /** 对空炮火 / 对空 CI：发动舰周围炸开一圈高射弹幕 */
  aaBurst(at: Pt, start: number, duration: number) {
    const ctx = this.ctx
    const p = this.palette
    const bursts = Array.from({ length: 14 }, (_, i) => ({ dx: Math.cos(i * 2.4) * (30 + (i % 4) * 14), dy: -30 - (i % 5) * 16, delay: (i / 14) * 0.6 }))
    this.add(start, duration, (t) => {
      for (const b of bursts) {
        const local = (t - b.delay) / 0.3
        if (local < 0 || local > 1) continue
        this.dot(ctx, at.x + b.dx, at.y + b.dy, PX * (1 + local * 2), p.spark, 1 - local)
        this.dot(ctx, at.x + b.dx * local * 0.2, at.y + b.dy * local, PX, p.shell, 0.6 * (1 - local))
      }
    })
  }

  /** 照明弹：在发动方一侧上空升起、缓缓下落 */
  flare(at: Pt, start: number, duration: number) {
    const ctx = this.ctx
    const p = this.palette
    this.add(start, duration, (t) => {
      const y = at.y - 80 + t * 30
      this.dot(ctx, at.x, y, PX * 3, p.flare, 1 - t * 0.5)
      this.dot(ctx, at.x, y, PX * 10, p.flare, 0.12 * (1 - t))
    })
  }

  /** 卡特琳娜救援：双发飞行艇贴海掠过 */
  rescue(start: number, duration: number, count: number) {
    const ctx = this.ctx
    const p = this.palette
    this.add(start, duration, (t) => {
      const x = lerp(-30, this.width * 0.5, easeOut(t))
      const y = this.height - 60
      this.drawPlane(x, y, 1, p.ally, 'heavy', 1 - t * 0.3)
      for (let i = 0; i < count; i += 1) this.dot(ctx, x - 20 - i * 12, y + 14, PX * 2, p.water, 0.8 * (1 - t))
    })
  }
}
