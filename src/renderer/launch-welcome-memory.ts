// 这是给下一次启动准备的快照记忆（季节幕 + 可选风格的「上次退出」简报），
// 不持有本次欢迎屏的 DOM 或把手。
import { LAUNCH_MECH_TIMING } from '../shared/launch-glow'
import {
  WELCOME_BRIEF_CONFIG_KEY,
  readWelcomeBrief,
  sameWelcomeBriefData,
  welcomeBriefOf,
  type WelcomeBriefCache,
  type WelcomeBriefConfig,
  type WelcomeBriefPlayerInput,
} from '../shared/launch-welcome-brief'
import { rememberWelcomeScene } from '../shared/launch-welcome-scene'
import type { WelcomeSceneConfig, WelcomeSceneInput } from '../shared/launch-welcome-scene'

export interface WelcomeSceneMemorySources {
  config: WelcomeSceneConfig
  input(): Promise<WelcomeSceneInput | null>
  subscribe(changed: (keys: string[]) => void): () => void
  report(error: unknown): void
}

export const createWelcomeSceneMemory = (sources: WelcomeSceneMemorySources) => {
  let unsubscribe: (() => void) | null = null
  let enabled = false
  let revision = 0
  const refresh = async () => {
    const mine = ++revision
    try {
      const input = await sources.input()
      if (enabled && mine === revision && input) rememberWelcomeScene(sources.config, input)
    } catch (error) {
      sources.report(error)
    }
  }
  return {
    setEnabled(next: boolean) {
      if (next === enabled) return
      enabled = next
      ++revision
      unsubscribe?.()
      unsubscribe = null
      if (!enabled) return
      unsubscribe = sources.subscribe((keys) => {
        if (keys.some((key) => ['master', 'quests', 'useitems', 'mapGauges'].includes(key))) void refresh()
      })
      void refresh()
    },
  }
}

let memory: ReturnType<typeof createWelcomeSceneMemory> | null = null
export const installWelcomeSceneMemory = (sources: WelcomeSceneMemorySources, enabled: boolean) => {
  memory = createWelcomeSceneMemory(sources)
  memory.setEnabled(enabled)
}
export const setWelcomeSceneMemoryEnabled = (enabled: boolean) => memory?.setEnabled(enabled)

// ---- 可选开幕风格的「上次退出」快照简报记忆（仅科技控制台与机甲舱门启用） ----
const BRIEF_WATCH_KEYS = ['basic', 'materials', 'ships', 'decks', 'ndocks', 'quests', 'master']

export interface WelcomeBriefMemorySources {
  config: WelcomeBriefConfig
  player(): WelcomeBriefPlayerInput | null
  shipNameOf(mstId: number): string | undefined
  subscribe(changed: (keys: string[]) => void): () => void
  report(error: unknown): void
  now?: () => number
  throttleMs?: number
}

export const createWelcomeBriefMemory = (sources: WelcomeBriefMemorySources) => {
  const nowOf = sources.now ?? Date.now
  const throttleMs = sources.throttleMs ?? LAUNCH_MECH_TIMING.briefThrottle
  let unsubscribe: (() => void) | null = null
  let enabled = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let dirty = false
  let lastSaved: WelcomeBriefCache | null = null
  let lastWriteAt = 0

  const flush = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    if (!enabled) return
    dirty = false
    try {
      const next = welcomeBriefOf(sources.player(), nowOf(), sources.shipNameOf)
      if (!next) return
      if (lastSaved === null) lastSaved = readWelcomeBrief(sources.config)
      if (sameWelcomeBriefData(next, lastSaved)) return
      sources.config.set(WELCOME_BRIEF_CONFIG_KEY, next)
      lastSaved = next
      lastWriteAt = nowOf()
    } catch (error) {
      sources.report(error)
    }
  }

  const schedule = () => {
    if (!enabled) return
    dirty = true
    const elapsed = nowOf() - lastWriteAt
    if (lastWriteAt === 0 || elapsed >= throttleMs) {
      flush()
      return
    }
    if (timer === null) {
      timer = setTimeout(flush, Math.max(0, throttleMs - elapsed))
    }
  }

  const onUnload = () => {
    if (enabled && dirty) flush()
  }

  return {
    setEnabled(next: boolean) {
      if (next === enabled) return
      enabled = next
      if (timer !== null) clearTimeout(timer)
      timer = null
      dirty = false
      unsubscribe?.()
      unsubscribe = null
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('beforeunload', onUnload)
      }
      if (!enabled) return
      lastSaved = readWelcomeBrief(sources.config)
      unsubscribe = sources.subscribe((keys) => {
        if (keys.some((key) => BRIEF_WATCH_KEYS.includes(key))) schedule()
      })
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('beforeunload', onUnload)
      }
      schedule()
    },
  }
}

let briefMemory: ReturnType<typeof createWelcomeBriefMemory> | null = null
export const installWelcomeBriefMemory = (sources: WelcomeBriefMemorySources, enabled: boolean) => {
  briefMemory = createWelcomeBriefMemory(sources)
  briefMemory.setEnabled(enabled)
}
export const setWelcomeBriefMemoryEnabled = (enabled: boolean) => briefMemory?.setEnabled(enabled)
