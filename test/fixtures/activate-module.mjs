// 铆（mu）的模块激活行为：把公开的 `activateModule` 原样切出来编译。
//
// 这条 seam 只观察布局状态：专注、坞折叠、格内 active。DOM 桩只承接函数必经的
// classList.remove；真正要钉的是自动切页与玩家导航在专注态下的不同语义。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const source = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'mu.ts'), 'utf8').replace(/\r\n/g, '\n')

const start = source.indexOf('// 切到指定模块（链的跳转路由用）')
const end = source.indexOf('// 游戏打开远征页时', start)
assert.ok(start >= 0 && end > start, 'mu.ts 里找不到 activateModule，夹具锚点要跟着改')
const ACTIVATE_MODULE = source.slice(start, end)

const HARNESS = `
type DockId = 'left' | 'right' | 'bottom'

export const layout: any = {
  docks: {
    left: [],
    right: [],
    bottom: [{ mods: ['qn', 'bi'], active: 'qn' }],
  },
  collapsed: { left: true, right: true, bottom: true },
  focus: true,
  shelved: [],
}

const removedClasses: string[] = []
const distract = { on: false }
const document: any = {
  querySelector: (_selector: string) => ({
    classList: { remove: (name: string) => removedClasses.push(name) },
  }),
}
const isOverlay = (_id: string) => false
const overlayOpen: string | null = null
const openOverlay = (_id: string) => {}
const moduleVisible = (_id: string) => true
const isShelved = (id: string) => layout.shelved.includes(id)
const layoutAll = () => {}
const saveLayout = () => {}
const locate = (id: string) => {
  for (const dock of ['left', 'right', 'bottom'] as DockId[]) {
    const gi = layout.docks[dock].findIndex((group: any) => group.mods.includes(id))
    if (gi >= 0) return { dock, gi }
  }
  return null
}
const setCollapsed = (dock: DockId, collapsed: boolean) => {
  layout.collapsed[dock] = collapsed
}
const activateIn = (dock: DockId, gi: number, id: string) => {
  layout.docks[dock][gi].active = id
}

${ACTIVATE_MODULE}

export { removedClasses }
`

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-activate-module-'))
const entry = path.join(dir, 'activate-module.ts')
fs.writeFileSync(entry, HARNESS)
const outfile = path.join(dir, 'activate-module.cjs')
buildSync({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'silent',
})
const loaded = createRequire(import.meta.url)(outfile)

export const reset = () => {
  loaded.layout.docks = {
    left: [],
    right: [],
    bottom: [{ mods: ['qn', 'bi'], active: 'qn' }],
  }
  loaded.layout.collapsed = { left: true, right: true, bottom: true }
  loaded.layout.focus = true
  loaded.layout.shelved = []
  loaded.removedClasses.length = 0
}

export const activateModule = (id, options) => loaded.activateModule(id, options)
export const snapshot = () => ({
  focus: loaded.layout.focus,
  collapsed: { ...loaded.layout.collapsed },
  active: loaded.layout.docks.bottom[0].active,
  removedClasses: [...loaded.removedClasses],
})
