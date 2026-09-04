import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { transformSync } from 'esbuild'

import target from '../dist/shared/route-target.js'

const { resolveRouteTarget } = target

// 出发点用 'start' 标；其余点位类型对目标点判定无所谓
const SPOTS = {
  1: [10, 10, 'start'],
  A: [40, 20, ''],
  B: [70, 30, ''],
  A1: [55, 25, ''],
  G: [120, 60, ''],
  P: [160, 90, ''],
}
// 边号 → 终点字母（fcd 的 route[cell][1]）
const LETTER = { 30: 'G', 31: 'P', 32: 'B' }
const letterOf = (cell) => LETTER[cell] ?? null

test('候选是整张图的点位，出发点不在其中，排序认数字', () => {
  const view = resolveRouteTarget(SPOTS, [], letterOf, null)
  assert.deepEqual(view.candidates, ['A', 'A1', 'B', 'G', 'P'])
  assert.equal(view.target, null)
  assert.equal(view.targetIsSeenBoss, false)
})

test('多 Boss 的图默认最近打过的那个，不是点号最小/最大的那个', () => {
  // 62-5 那种多血条图：P 是新段 Boss，G 是旧段——玩家上一次打的是 P
  const view = resolveRouteTarget(
    SPOTS,
    [{ cell: 30, lastTs: 1_700_000_000 }, { cell: 31, lastTs: 1_800_000_000 }],
    letterOf,
    null,
  )
  assert.equal(view.target, 'P')
  assert.equal(view.targetIsSeenBoss, true)
})

test('手选压过默认：捞船党故意停在旧段 Boss，自动跟段是反功能', () => {
  const view = resolveRouteTarget(
    SPOTS,
    [{ cell: 30, lastTs: 1_700_000_000 }, { cell: 31, lastTs: 1_800_000_000 }],
    letterOf,
    'G',
  )
  assert.equal(view.target, 'G')
  assert.equal(view.targetIsSeenBoss, true)
})

test('选得了没打过 Boss 的普通点位，只是不算「打过的 Boss」', () => {
  const view = resolveRouteTarget(SPOTS, [{ cell: 30, lastTs: 1 }], letterOf, 'A1')
  assert.equal(view.target, 'A1')
  assert.equal(view.targetIsSeenBoss, false)
})

test('存着的选择不在这张图上就回落到默认，不留一个指向空处的目标', () => {
  // 海图包换版、活动图改建之后会出现这种存档
  const view = resolveRouteTarget(SPOTS, [{ cell: 30, lastTs: 1 }], letterOf, 'Z9')
  assert.equal(view.target, 'G')
  assert.equal(resolveRouteTarget(SPOTS, [], letterOf, '1').target, null, '出发点也不是候选')
})

test('一次 Boss 都没打过就说没有，不拿别的点冒充', () => {
  assert.equal(resolveRouteTarget(SPOTS, [], letterOf, null).target, null)
  assert.equal(resolveRouteTarget(SPOTS, undefined, letterOf, null).target, null)
  // 边号翻不出字母（本地记录比海图包新）同样算没有
  assert.equal(resolveRouteTarget(SPOTS, [{ cell: 99, lastTs: 9 }], letterOf, null).target, null)
})

// ---- 存档那一侧：编 ji.ts 里真的 setRouteTarget 跑 ----
//
// 裁剪靠的是**插入序**，而插入序在这里不是想当然的事：数字型键在对象里恒按数值
// 升序排，先删后插挪不动它。所以这一组不看源码文本，直接问「裁完之后剩下谁」。

const jiSource = fs
  .readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n')
const kernelSource = fs
  .readFileSync(new URL('../src/renderer/kernel.ts', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n')

// 键名也一起编进来：写死在夹具里就成了自证，改坏了照样绿
const SET_BLOCK = (() => {
  const from = 'const ROUTE_TARGET_KEY = '
  const to = '\nconst mapChronicle = new Map'
  const start = jiSource.indexOf(from)
  const end = jiSource.indexOf(to, start)
  assert.ok(start >= 0 && end > start, 'ji.ts 里找不到目标点存档那一段，这条守卫的锚点要跟着改')
  return jiSource.slice(start, end)
})()

const UI_STORE_BLOCK = (() => {
  const from = 'export const uiGet = '
  const to = '\n\n// 内部详情栏'
  const start = kernelSource.indexOf(from)
  const end = kernelSource.indexOf(to, start)
  assert.ok(start >= 0 && end > start, 'kernel.ts 里找不到 uiGet/uiSet，这条守卫的锚点要跟着改')
  return kernelSource.slice(start, end)
})()

const store = (() => {
  const source = `
export let saved: any = null
let remoteValue = 'B'
const remoteObject: Record<string, string> = {}
Object.defineProperty(remoteObject, '2-1', {
  enumerable: true,
  get: () => remoteValue,
  set: (value: string) => { remoteValue = value },
})
const kernelConfig = {
  get: (_key: string) => remoteObject,
  set: (key: string, value: unknown) => { saved = { key: key.slice(3), value } },
}
${UI_STORE_BLOCK}
${SET_BLOCK}
export const reset = () => { routeTargets = {}; saved = null }
export const resetFromRemote = () => { remoteValue = 'B'; routeTargets = uiGet(ROUTE_TARGET_KEY, {}); saved = null }
export const sourceValue = () => remoteValue
export const set = (code: string, letter: string) => {
  setRouteTarget(code, letter)
  return Object.keys(routeTargets)
}
`
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-route-target-'))
  const file = path.join(dir, 'store.cjs')
  fs.writeFileSync(file, transformSync(source, { loader: 'ts', format: 'cjs' }).code)
  return createRequire(fileURLToPath(import.meta.url))(file)
})()

test('选择按图落盘，落的是 ui 子树那一条；选回「未选」就把这张图的记录删掉', () => {
  store.reset()
  store.set('62-5', 'ZZ')
  assert.equal(store.saved.key, 'ji.routeTarget', '存档键要跟 ji.shipSort 同族')
  assert.deepEqual(store.saved.value, { '62-5': 'ZZ' })
  assert.deepEqual(store.set('62-5', ''), [], '选回占位项就是撤销，不该留一个空值')
  // 走 kernel 的 uiGet/uiSet 那条道（与 ji.shipSort 同族），不另开一条 remote 通道
  assert.match(jiSource, /let routeTargets = uiGet<Record<string, string>>\(ROUTE_TARGET_KEY/)
  assert.ok(!jiSource.includes("require('@electron/remote')"), '这一条不该自己拉 remote')
  // 选择器发的是海域码：换回数字 mapId 的话上面那条时序就静默失效了
  assert.match(jiSource, /data-map-route-target="\$\{esc\(code\)\}"/)
})

test('配置已有目标点时也能切换，不会在 remote 代理的不可配置属性上报错', () => {
  store.resetFromRemote()
  assert.doesNotThrow(() => store.set('2-1', 'A'))
  assert.deepEqual(store.saved, { key: 'ji.routeTarget', value: { '2-1': 'A' } })
  assert.equal(store.sourceValue(), 'B', '改本地副本不该绕过 config.set 直写主进程对象')
})

test('碰过的图回到队尾——这是裁剪能裁对人的前提', () => {
  store.reset()
  store.set('1-1', 'E')
  store.set('62-5', 'ZZ')
  const keys = store.set('1-1', 'F')
  assert.deepEqual(keys, ['62-5', '1-1'], '数字型键会按数值排死，这里必须是插入序')
})

test('超过 200 张图裁到 160，裁掉最久没碰的，最近碰过的留下', () => {
  store.reset()
  let keys = []
  for (let index = 0; index < 200; index++) keys = store.set(`${index}-1`, 'A')
  assert.equal(keys.length, 200, '刚好 200 不裁')
  // 最老的那张在裁剪前又被碰了一次：它该活下来，而不是因为「编号小」被裁
  store.set('0-1', 'B')
  keys = store.set('999-1', 'Z')
  assert.equal(keys.length, 160)
  assert.ok(keys.includes('0-1'), '刚碰过的那张被裁了，说明裁的是编号不是时序')
  assert.ok(keys.includes('999-1'))
  assert.ok(!keys.includes('1-1'), '最久没碰的那批该被裁掉')
  assert.deepEqual(store.saved.value, Object.fromEntries(keys.map((k) => [k, k === '0-1' ? 'B' : k === '999-1' ? 'Z' : 'A'])))
})
