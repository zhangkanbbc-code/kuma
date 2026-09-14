interface ModuleCommandOptions {
  self: string
  hostOf: (mod: string) => string
  relay: (to: string, mod: string, name: string, payload: unknown) => Promise<boolean>
}

/** 模块命令只把参数送到宿主窗；接收端用 runLocal，绝不再转发。 */
export const createModuleCommandBus = ({ self, hostOf, relay }: ModuleCommandOptions) => {
  const commands = new Map<string, Map<string, (payload: unknown) => void>>()
  const register = <T>(mod: string, name: string, fn: (payload: T) => void) => {
    if (!commands.has(mod)) commands.set(mod, new Map())
    commands.get(mod)!.set(name, (payload) => fn(payload as T))
  }
  const runLocal = (mod: string, name: string, payload: unknown): boolean => {
    const fn = commands.get(mod)?.get(name)
    if (!fn) return false
    fn(payload)
    return true
  }
  const run = async (mod: string, name: string, payload: unknown): Promise<void> => {
    if (!commands.get(mod)?.has(name)) return
    const host = hostOf(mod)
    if (host !== self && await relay(host, mod, name, payload)) return
    runLocal(mod, name, payload)
  }
  return { register, run, runLocal }
}
