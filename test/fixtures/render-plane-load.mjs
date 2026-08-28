// 锐（ru）编成行里那个舰载机搭载角标的**余量三档配色**：把真码切出来编译一遍。
//
// ⚠️ 为什么不能只用正则匹配源码：分档全是算术与字符串拼接，几种错法都不改变
// 源码里出现过的字样——
//   · 比例算反（写成 `capacity / onslot`）→ 源码照样有除号和两个名字；
//   · 断点方向写反（`ratio > 0.75` 写成 `<`）→ 满格的格会变红，源码字面没变；
//   · 分母拿主数据原量（`master.maxEq[i]`）而不是实例一手上限 → 扩过的格补满了
//     还是绿，只有喂一艘扩过的舰才看得出来。
// 三者都只在产物 HTML 的 class 上看得出来，所以对着渲染结果下断言。
//
// 内核的 `hangarSlotCapacity` 与模块里的 `PLANE_ICONS`、`planeLoadBand` 都引真的那一份
// （与 fixtures/render-hangar-hover 同一手法切片）：桩一写成常数，「分母取哪个」
// 和「哪些图标算舰载机」这两半就在测试里被抹掉了。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const read = (...rel) => fs.readFileSync(path.join(ROOT, ...rel), 'utf8').replace(/\r\n/g, '\n')

const cut = (source, from, to, label) => {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `找不到「${label}」，这条守卫的锚点要跟着改`)
  return source.slice(start, end)
}

const kernel = read('src', 'renderer', 'kernel.ts')
const ru = read('src', 'renderer', 'modules', 'ru.ts')

// 切到「旧记忆退场」之前：那几行读 uiGet/uiSet，要 @electron/remote
const HANGAR = cut(
  kernel,
  '// ---- 格納庫増設：读实例侧的一手上限 ----',
  '// 推断层的旧记忆',
  '内核的格納庫増設三件套',
)
const PLANE_ICONS = cut(
  ru,
  'const PLANE_ICONS = new Set(',
  '\ninterface ShipIssues',
  '锐的舰载机图标集 PLANE_ICONS',
)
const EQUIP_CHIPS = cut(
  ru,
  '// 舰载机搭载角标的余量三档',
  '\n// 展开区的度量行（06 稿）',
  '锐的装备芯片 equipChips（含搭载余量分档）',
)

const HARNESS = `
type PlayerShip = any

export const mg: any = { ships: {}, master: { ships: {}, slotitems: {} }, slotitems: {} }

const ENT: any = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (c: string) => ENT[c])

${HANGAR}

${PLANE_ICONS}

// 这条护栏只看搭载角标那一截，芯片里其余的名字一律给最平淡的桩
const entityNamePlain = (_kind: string, _id: number, name: string) => name
const equipTypeIconHtml = (_iconId: number, o: any = {}) =>
  \`<span class="equip-icon"\${o.title ? \` title="\${esc(o.title)}"\` : ''}>\${o.overlay ?? ''}</span>\`
const equipPeekIconHtml = (_mstId: number, iconId: number, _name: string, o: any = {}) =>
  equipTypeIconHtml(iconId, o)

${EQUIP_CHIPS}

export { equipChips, planeLoadBand }
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-plane-load-'))
  const entry = path.join(dir, 'load.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'load.cjs')
  buildSync({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  })
  return outfile
})()

const loaded = createRequire(import.meta.url)(bundle)

/** 分档纯函数本体（搭载数, 这一格的实际上限）→ 'g' | 'y' | 'r' | null。 */
export const planeLoadBand = (onslot, capacity) => loaded.planeLoadBand(onslot, capacity)

const PLANE_ICON_ID = 8 // 艦上攻撃機，在真的 PLANE_ICONS 集里
const GUN_ICON_ID = 1 // 小口径主砲，不在集里

/**
 * 摆一局：一艘装满了舰载机的舰。
 *
 * @param maxEq    这一形态各格的主数据标准搭载
 * @param onslot   各格当前搭载数
 * @param options  `onslotMax` = 实例一手上限（缺省 = 这艘舰没被格納庫増設扩过，
 *                 真报文里那个键根本不存在）；`iconIds` = 逐格装备的图标 id
 *                 （缺省全给舰载机）
 */
export const reset = (maxEq, onslot, { onslotMax, iconIds } = {}) => {
  loaded.mg.ships = {}
  loaded.mg.master.ships = {}
  loaded.mg.master.slotitems = {}
  loaded.mg.slotitems = {}

  const icons = iconIds ?? maxEq.map(() => PLANE_ICON_ID)
  // 装备实例 id 从 1 起，与格位一一对应；主数据 id 同号，图标按 icons 给
  maxEq.forEach((_cap, i) => {
    loaded.mg.slotitems[i + 1] = { id: i + 1, mstId: i + 1, level: 0, alv: 0 }
    loaded.mg.master.slotitems[i + 1] = { id: i + 1, name: `装备#${i + 1}`, iconId: icons[i] }
  })
  loaded.mg.ships[939] = {
    id: 939,
    shipId: 560,
    slot: maxEq.map((_cap, i) => i + 1),
    slotEx: 0,
    onslot,
    ...(onslotMax ? { onslotMax } : {}),
  }
  loaded.mg.master.ships[560] = { maxEq, slotNum: maxEq.length }
}

/** 锐的编成行装备芯片。 */
export const renderEquipChips = () => loaded.equipChips(loaded.mg.ships[939])

/**
 * 每一枚搭载角标的 `[档位, 数字]`，按格序给回。
 * 没上色的角标档位是 `null`；没有角标的格根本不进这张表。
 */
export const badgesOf = (html) =>
  [...html.matchAll(/<span class="pc(?: pc-([gyr]))?">(\d+)<\/span>/g)].map((m) => [
    m[1] ?? null,
    Number(m[2]),
  ])

export { GUN_ICON_ID, PLANE_ICON_ID }
