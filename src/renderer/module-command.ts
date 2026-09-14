import { ipcRenderer } from 'electron'
import { createModuleCommandBus } from '../shared/module-command'
import { POP_RELAY_CHANNEL } from '../shared/pop-module'
import { hostFor } from './link'
import { getPopModule } from './mu'

// 铆接收命令、模块顶层登记命令，两者有循环依赖；首次登记时再取本窗身份。
let bus: ReturnType<typeof createModuleCommandBus> | undefined
const getBus = () => bus ??= createModuleCommandBus({
  self: getPopModule() ?? 'main',
  hostOf: hostFor,
  relay: (to, mod, name, payload) =>
    ipcRenderer.invoke(POP_RELAY_CHANNEL, { to, kind: 'command', payload: { mod, name, payload } }),
})

export const registerModuleCommand = <T>(mod: string, name: string, fn: (payload: T) => void) =>
  getBus().register(mod, name, fn)

export const runModuleCommand = (mod: string, name: string, payload: unknown): Promise<void> =>
  getBus().run(mod, name, payload)

export const receiveModuleCommand = (raw: unknown) => {
  if (!raw || typeof raw !== 'object') return
  const { mod, name, payload } = raw as Record<string, unknown>
  if (typeof mod !== 'string' || typeof name !== 'string') return
  getBus().runLocal(mod, name, payload)
}
