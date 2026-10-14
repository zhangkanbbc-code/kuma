// 这是给下一次启动准备的快照记忆，不持有本次欢迎屏的 DOM 或把手。
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
