import { DISTRACT_CARD_MIN_ZOOM, DISTRACT_GAME_MIN_RATIO, distractCardZoom } from '../shared/distract-card-fit'
import type { DistractSide } from '../shared/distract-mode'

let observer: ResizeObserver | null = null
let observedDock: HTMLElement | null = null
let observedCard: HTMLElement | null = null
let frame = 0
let side: DistractSide = 'bottom'

const fit = () => {
  frame = 0
  const workbench = document.querySelector<HTMLElement>('#workbench')!
  const dock = document.querySelector<HTMLElement>('[data-distract-card]')
  const card = dock?.querySelector<HTMLElement>('.di-app')
  if (!dock || !card) return
  if (dock !== observedDock || card !== observedCard) {
    observer?.disconnect()
    observer = new ResizeObserver(() => scheduleDistractCardFit(side))
    observer.observe(workbench)
    observer.observe(dock)
    observer.observe(card)
    observedDock = dock
    observedCard = card
  }

  const vertical = side === 'top' || side === 'bottom'
  const outerHeight = vertical
    ? workbench.clientHeight - workbench.clientHeight * DISTRACT_GAME_MIN_RATIO
    : workbench.clientHeight
  // 上下 auto 行不能反过来限制量尺；先按游戏保底给预算，再扣掉坞边框。
  const availableHeight = Math.max(0, (vertical ? outerHeight : dock.clientHeight) -
    (vertical ? dock.offsetHeight - dock.clientHeight : 0))
  dock.style.setProperty('--distract-card-space', `${outerHeight}px`)
  card.style.setProperty('--distract-card-height', 'none')
  card.style.setProperty('--distract-card-overflow', 'hidden')
  card.style.setProperty('--distract-card-zoom', '1')
  const firstZoom = distractCardZoom(availableHeight, card.scrollHeight)
  card.style.setProperty('--distract-card-zoom', `${firstZoom}`)
  // zoom 改变排版宽度后再量一次；只做两遍，不把观察器回调当收敛循环。
  const zoom = distractCardZoom(availableHeight, card.scrollHeight)
  card.style.setProperty('--distract-card-zoom', `${zoom}`)
  card.style.setProperty('--distract-card-height', `${availableHeight / zoom}px`)
  card.style.setProperty('--distract-card-overflow', zoom === DISTRACT_CARD_MIN_ZOOM ? 'auto' : 'hidden')
}

export const scheduleDistractCardFit = (nextSide: DistractSide) => {
  side = nextSide
  document.querySelector<HTMLElement>('#workbench')!.style.setProperty(
    '--distract-game-min', `${DISTRACT_GAME_MIN_RATIO * 100}%`,
  )
  if (!frame) frame = requestAnimationFrame(fit)
}

export const stopDistractCardFit = () => {
  observer?.disconnect()
  observer = null
  if (frame) cancelAnimationFrame(frame)
  frame = 0
  observedDock?.style.removeProperty('--distract-card-space')
  for (const name of ['--distract-card-zoom', '--distract-card-height', '--distract-card-overflow']) {
    observedCard?.style.removeProperty(name)
  }
  document.querySelector<HTMLElement>('#workbench')!.style.removeProperty('--distract-game-min')
  observedDock = null
  observedCard = null
}
