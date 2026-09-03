import { mg, onMgChange, trackMountCleanup } from './kernel'

export type MaterialCue = {
  delta: number
  phase: 'active' | 'leaving'
  phaseAt: number
}

type MaterialCueState = MaterialCue & {
  holdTimer: ReturnType<typeof setTimeout> | null
  removeTimer: ReturnType<typeof setTimeout> | null
}

type MaterialCueListener = () => void

const HOLD_MS = 2400
const FADE_MS = 420
const cues = new Map<number, MaterialCueState>()
const listeners: MaterialCueListener[] = []
let materialBaseline: number[] | null = null
let cueChangeQueued = false

const flushCueChanges = () => {
  cueChangeQueued = false
  for (const listener of listeners) listener()
}

const emitCueChange = () => {
  if (cueChangeQueued) return
  cueChangeQueued = true
  // 浏览器按帧合并；没有 rAF 的测试环境按同一轮 microtask 合并。
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flushCueChanges)
  else queueMicrotask(flushCueChanges)
}

const queueMaterialDelta = (idx: number, delta: number) => {
  const phaseAt = Date.now()
  const cue = cues.get(idx) ?? {
    delta: 0,
    phase: 'active' as const,
    phaseAt,
    holdTimer: null,
    removeTimer: null,
  }
  if (cue.holdTimer) clearTimeout(cue.holdTimer)
  if (cue.removeTimer) clearTimeout(cue.removeTimer)
  cue.delta += delta
  cue.phase = 'active'
  cue.phaseAt = phaseAt
  cue.holdTimer = null
  cue.removeTimer = null
  if (cue.delta === 0) {
    cues.delete(idx)
    emitCueChange()
    return
  }
  cues.set(idx, cue)
  emitCueChange()
  cue.holdTimer = setTimeout(() => {
    if (cues.get(idx) !== cue) return
    cue.phase = 'leaving'
    cue.phaseAt = Date.now()
    cue.holdTimer = null
    emitCueChange()
    cue.removeTimer = setTimeout(() => {
      if (cues.get(idx) !== cue) return
      cues.delete(idx)
      emitCueChange()
    }, FADE_MS)
  }, HOLD_MS)
}

// 差值判定与提示生命周期只有这一份：顶栏与资源模块都从这里取，
// 首次载入/重启回灌只记基线。
const observeMaterialChanges = () => {
  const current = mg.materials
  if (!Array.isArray(current) || current.length < 8) {
    materialBaseline = null
    return
  }
  if (materialBaseline) {
    for (let idx = 0; idx < 8; idx++) {
      const before = Number(materialBaseline[idx])
      const after = Number(current[idx])
      if (Number.isFinite(before) && Number.isFinite(after) && after !== before) {
        queueMaterialDelta(idx, after - before)
      }
    }
  }
  materialBaseline = [...current]
}

observeMaterialChanges()
onMgChange((keys) => {
  if (keys.includes('materials')) observeMaterialChanges()
})

export const materialCues = (): ReadonlyMap<number, MaterialCue> =>
  new Map([...cues].map(([idx, cue]) => [idx, { delta: cue.delta, phase: cue.phase, phaseAt: cue.phaseAt }]))

export const onMaterialCueChange = (cb: MaterialCueListener) => {
  listeners.push(cb)
  trackMountCleanup(() => {
    const at = listeners.indexOf(cb)
    if (at >= 0) listeners.splice(at, 1)
  })
}
