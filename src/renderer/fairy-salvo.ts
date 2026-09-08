import {
  fairyMirrored, salvoAllowed, type SpecialAttackFired,
} from '../shared/fairy-salvo'

export interface FairySalvoSource {
  active(): boolean
  practice(): boolean
  flagshipId(): number | undefined
  guns(): number[]
  imageUrl(id: number): string | null
  mirrors(): number[]
  writeMirrors(ids: number[]): void
  windowVisible(): boolean
  onSortieChange(cb: () => void): () => void
}

let source: FairySalvoSource
let enabled = false
type FairySalvoHandle = () => void
let cancel: FairySalvoHandle | null = null
export const initFairySalvo = (data: FairySalvoSource, on: boolean) => {
  source = data
  setFairySalvoEnabled(on)
}
export const setFairySalvoEnabled = (on: boolean) => {
  enabled = on
  refreshFairySalvo()
}
// 由镇壳既有的分心模式同步口调用；分心中不挂攻击、出击、媒体查询或文档钩子。
export const refreshFairySalvo = () => {
  cancel?.()
  cancel = source ? armFairySalvo(enabled, source) : null
}

/**
 * 2026-09-08 上午 Blink 合成层重叠判定读到失效裁剪节点，最强嫌疑是叠在游戏
 * 画面上的浮层增减。本彩蛋也覆盖游戏：默认关、只动 transform/opacity、仅一个
 * 动画根层、动画完整层移除、绝不在 game-wrapper 内挂节点。开启后若崩溃频率
 * 上升，第一个怀疑对象就是它。纠错钮另留四秒，不保留动画层或静止合成层。
 */
export const armFairySalvo = (on: boolean, data: FairySalvoSource): FairySalvoHandle | null => {
  if (!on || document.querySelector('#app')?.classList.contains('distract')) return null
  const media = window.matchMedia('(prefers-reduced-motion: reduce)')
  if (media.matches) return null
  const allowed = () => salvoAllowed({
    enabled: on,
    distract: !!document.querySelector('#app')?.classList.contains('distract'),
    visible: document.visibilityState === 'visible' && data.windowVisible(),
    reducedMotion: media.matches,
    practice: data.practice(),
  })
  const images = new Map<number, Promise<HTMLImageElement | null>>()
  // 每次挂接内每张只请求一次；404/离线记为空，不重试、不报错。
  const load = (id: number): Promise<HTMLImageElement | null> => {
    // 取址允许静态美术远端回退，加载结果共用本次挂接的缓存。
    const url = data.imageUrl(id)
    const cached = images.get(id)
    if (cached) return cached
    const pending = new Promise<HTMLImageElement | null>((resolve) => {
      if (!url) { resolve(null); return }
      const img = new Image()
      img.onload = () => { img.onload = img.onerror = null; resolve(img) }
      img.onerror = () => { img.onload = img.onerror = null; resolve(null) }
      img.src = url
    })
    images.set(id, pending)
    return pending
  }
  let active = data.active()
  const offSortie = data.onSortieChange(() => {
    const next = data.active()
    if (next && !active && allowed()) data.guns().forEach((id) => { void load(id) })
    active = next
  })
  let generation = 0
  let cleanupAnimation: (() => void) | null = null
  let cleanupButtons: (() => void) | null = null
  const clear = () => {
    generation++
    cleanupAnimation?.()
    cleanupButtons?.()
    cleanupAnimation = cleanupButtons = null
  }

  const play = (items: { id: number; img: HTMLImageElement }[], rect: DOMRect, replay = false,
    placements?: { center: number; width: number; height: number }[]) => {
    cleanupAnimation?.()
    if (!replay) cleanupButtons?.()
    const layer = document.createElement('div')
    layer.id = 'fx-fairy'
    Object.assign(layer.style, {
      position: 'fixed', pointerEvents: 'none', overflow: 'hidden', zIndex: '10000',
      left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
    })
    // 样式跟动画根层一起撤，不向 head 常驻注入；关键帧只有 transform / opacity。
    // 升起 250ms、站定 250ms 后开火；烟尘 600ms，四团错峰合计 660ms。
    // 最后一团散尽后再站 1500ms，沉回 250ms；重放原地立即开火，省去前 500ms。
    // 晚间再调慢：升起 400ms、站定 500ms；六团烟尘 1100ms、错峰 40ms 共 1300ms。
    // 散尽后站 2200ms、沉回 400ms：首播 4800ms，原地重放省去前 900ms 为 3900ms。
    const duration = replay ? 3900 : 4800
    const style = document.createElement('style')
    style.textContent = `
      @keyframes fairy-rise { 0% { transform:translateY(100%);opacity:0 } 1.4% { opacity:1 }
        7% { transform:translateY(-3%);opacity:1 } 8.3333% { transform:translateY(0);opacity:1 }
        91.6667% { transform:translateY(0);opacity:1 } 100% { transform:translateY(100%);opacity:0 } }
      @keyframes fairy-replay { 0%,89.7436% { transform:translateY(0);opacity:1 } 100% { transform:translateY(100%);opacity:0 } }
      @keyframes fairy-flash { 0% { transform:scale(.4);opacity:0 } 20% { transform:scale(1);opacity:1 } 100% { transform:scale(1.3);opacity:0 } }
      @keyframes fairy-smoke { 0% { transform:translate(0,0) scale(.2);opacity:0 }
        12% { opacity:.95 } 100% { transform:translate(var(--dx),var(--dy)) scale(3.0);opacity:0 } }
      @keyframes fairy-recoil { 0%,100% { transform:translateX(0) scaleX(var(--fairy-facing)) }
        25% { transform:translateX(-3%) scaleX(var(--fairy-facing)) } }
    `
    layer.appendChild(style)
    const height = Math.min(rect.height * .4, 360)
    const widths = items.map(({ img }) => height * img.naturalWidth / img.naturalHeight)
    const gap = Math.max(...widths) * .15
    const total = widths.reduce((a, b) => a + b, 0) + gap * (items.length - 1)
    const scale = Math.min(1, rect.width / total)
    let left = (rect.width - total * scale) / 2
    const positions: number[] = []
    const actors: HTMLElement[] = []
    items.forEach(({ id, img }, index) => {
      const width = placements?.[index].width ?? widths[index] * scale
      const actorHeight = placements?.[index].height ?? height * scale
      const center = placements?.[index].center ?? left + width / 2
      positions.push(center)
      const actor = document.createElement('div')
      actor.className = 'fairy-actor'
      actor.dataset.equip = `${id}`
      Object.assign(actor.style, { position: 'absolute', bottom: '0', left: `${center - width / 2}px`,
        width: `${width}px`, height: `${actorHeight}px`,
        animation: `${replay ? 'fairy-replay' : 'fairy-rise'} ${duration}ms both` })
      const art = img.cloneNode() as HTMLImageElement
      art.alt = ''
      const delay = replay ? 0 : 900
      const mirrored = fairyMirrored(id, data.mirrors())
      // 后坐只动本体，平移在镜像外叠加；不覆盖升沉，也不把烟尘一起拉回。
      Object.assign(art.style, { width: '100%', height: '100%', transform: mirrored ? 'scaleX(-1)' : 'none',
        animation: `fairy-recoil 120ms ${delay}ms both` })
      art.style.setProperty('--fairy-facing', mirrored ? '-1' : '1')
      actor.appendChild(art)
      // 炮口位置按右上象限近似；只镜像妖精，闪光和烟尘始终朝右。
      const flash = document.createElement('i')
      Object.assign(flash.style, { position: 'absolute', left: '82%', top: '35%', width: '26%', height: '26%',
        borderRadius: '50%', background: 'radial-gradient(circle,#fff 0%,#fff4b0 35%,transparent 70%)',
        opacity: '0', animation: `fairy-flash 140ms ${delay}ms both` })
      actor.appendChild(flash)
      const halo = document.createElement('i')
      Object.assign(halo.style, { position: 'absolute', left: '76%', top: '29%', width: '38%', height: '38%',
        borderRadius: '50%', background: 'radial-gradient(circle,rgba(255,255,255,.35) 0%,rgba(255,244,176,.18) 35%,transparent 70%)',
        opacity: '0', animation: `fairy-flash 140ms ${delay + 30}ms both` })
      actor.appendChild(halo)
      for (let i = 0; i < 6; i++) {
        const smoke = document.createElement('i')
        Object.assign(smoke.style, { position: 'absolute', left: '82%', top: `${30 + i * 3}%`, width: '42%', height: `${width * .42}px`,
          borderRadius: '50%', background: 'radial-gradient(circle,rgba(255,250,235,.95) 0%,rgba(225,218,200,.75) 45%,transparent 75%)',
          opacity: '0', animation: `fairy-smoke 1100ms ${delay + i * 40}ms both` })
        smoke.style.setProperty('--dx', `${width * (.45 + i * .17)}px`)
        smoke.style.setProperty('--dy', `${-actorHeight * (.2 + i * .07)}px`)
        actor.appendChild(smoke)
      }
      layer.appendChild(actor)
      actors.push(actor)
      left += width + gap * scale
    })
    document.body.appendChild(layer)
    let ended = false
    const remove = () => {
      ended = true
      clearTimeout(watchdog)
      layer.remove()
    }
    const done = () => {
      if (ended) return
      ended = true
      clearTimeout(watchdog)
      layer.remove()
      if (replay || !allowed()) return
      const buttons = document.createElement('div')
      buttons.id = 'fx-fairy-mirrors'
      Object.assign(buttons.style, { position: 'fixed', pointerEvents: 'none', zIndex: '10000',
        left: `${rect.left}px`, top: `${rect.bottom - 28}px`, width: `${rect.width}px`, height: '28px' })
      items.forEach(({ id, img }, index) => {
        const button = document.createElement('button')
        button.textContent = '妖精朝反了？点一下镜像'
        button.dataset.equip = `${id}`
        Object.assign(button.style, { position: 'absolute', pointerEvents: 'auto', left: `${positions[index]}px`,
          transform: 'translateX(-50%)', maxWidth: `${rect.width / items.length}px`, fontSize: '10px',
          color: 'var(--dim)', background: 'var(--bg1)', border: '1px solid var(--line)', cursor: 'pointer' })
        button.addEventListener('click', () => {
          if (!allowed()) { clear(); return }
          data.writeMirrors([...new Set([...data.mirrors(), id])].sort((a, b) => a - b))
          button.remove()
          // 纠错只原位、原尺寸重放这一只；其他钮保留到四秒，不再弹第二轮按钮。
          play([{ id, img }], rect, true, [{ center: positions[index], width: widths[index] * scale, height: height * scale }])
          if (!buttons.children.length) cleanupButtons?.()
        })
        buttons.appendChild(button)
      })
      document.body.appendChild(buttons)
      const removeButtons = () => { clearTimeout(buttonTimer); buttons.remove() }
      const buttonTimer = setTimeout(removeButtons, 4000)
      cleanupButtons = removeButtons
    }
    const last = actors.at(-1)!
    last.addEventListener('animationend', (event) => {
      if (event.target === last && ['fairy-rise', 'fairy-replay'].includes(event.animationName)) done()
    })
    // 动画 1400ms，丢 animationend 时最迟 1600ms 收层；重放同样封顶。
    // 上述旧总长现延为首播 2910ms / 重放 2410ms；看门狗统一在各自总长后 200ms 收层。
    // 晚间再延为首播 4800ms / 重放 3900ms，看门狗相应为 5000ms / 4100ms。
    const watchdog = setTimeout(done, duration + 200)
    cleanupAnimation = remove
  }
  const playFor = async (guns: number[], valid: () => boolean) => {
    if (!allowed() || !valid()) return
    clear()
    const token = generation
    const started = Date.now()
    const loaded = await Promise.all(guns.map(async (id) => ({ id, img: await load(id) })))
    if (token !== generation || !allowed() || !valid() || Date.now() - started > 1600) return
    const items = loaded.filter((item): item is { id: number; img: HTMLImageElement } => !!item.img?.naturalHeight)
    if (!items.length) return false
    const rect = document.querySelector('#game-wrapper')?.getBoundingClientRect()
    if (!rect?.width || !rect.height) return
    play(items, rect)
    return true
  }
  const onAttack = async (event: Event) => {
    const cue = (event as CustomEvent<SpecialAttackFired>).detail
    if (!allowed() || !data.active() || cue.mstId !== data.flagshipId()) return
    await playFor(data.guns(), () => data.active() && cue.mstId === data.flagshipId())
  }
  const onVisibility = () => { if (!allowed()) clear() }
  window.addEventListener('special-attack-fired', onAttack)
  document.addEventListener('visibilitychange', onVisibility)
  media.addEventListener('change', onVisibility)
  return () => {
    clear()
    offSortie()
    window.removeEventListener('special-attack-fired', onAttack)
    document.removeEventListener('visibilitychange', onVisibility)
    media.removeEventListener('change', onVisibility)
  }
}
