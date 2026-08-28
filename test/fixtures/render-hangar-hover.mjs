// 把两处「格納庫増設拆成 原量+增量」的悬停**原样切出来**真编译一遍：
// 锐（ru）编成行里的空装备格芯片，与鉴（ji-lab）组合实验室里的装备格上限小字。
//
// ⚠️ 为什么不能只用正则匹配源码：这一段全是**字符串拼接**，而它的两种错法
// 都不改变源码里出现过的字样——
//   · 加法的两截取反（写成 `${extra}+${cap}`）→ 源码照样含「+」与「格納庫増設」；
//   · 分支条件写反（`extra > 0` 写成 `extra >= 0`）→ 没扩过的格也冒出「2+0」。
// 两者都只在产物 HTML 上看得出来，所以对着渲染结果下断言。
//
// 内核的 `hangarExpansionOf` 也引真的那一份（与 fixtures/kernel-hangar 同一手法切片）：
// 桩一写成「返回 1」，「增量 = 一手值 − 主数据原量」这一半就在测试里被抹掉了。
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
const jiLab = read('src', 'renderer', 'modules', 'ji-lab.ts')

// 切到「旧记忆退场」之前：那几行读 uiGet/uiSet，要 @electron/remote
const HANGAR = cut(
  kernel,
  '// ---- 格納庫増設：读实例侧的一手上限 ----',
  '// 推断层的旧记忆',
  '内核的格納庫増設三件套',
)
// 起点取搭载余量分档那一段（就在 equipChips 上面）：芯片里的搭载角标要调用它，
// 桩一个就等于把分档从这份切片里抹掉。
const EQUIP_CHIPS = cut(
  ru,
  '// 舰载机搭载角标的余量三档',
  '\n// 展开区的度量行（06 稿）',
  '锐的装备芯片 equipChips（含搭载余量分档）',
)
const SLOT_PICKER = cut(
  jiLab,
  'const slotPickerHtml = () => {',
  '\n// ---- 两份 datalist',
  '鉴的实验室装备格 slotPickerHtml',
)

const HARNESS = `
type PlayerShip = any

export const mg: any = { ships: {}, master: { ships: {}, slotitems: {} }, slotitems: {} }

const ENT: any = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (c: string) => ENT[c])

${HANGAR}

// 这条护栏只看容量那一截，芯片里其余的名字一律给最平淡的桩
const PLANE_ICONS = new Set<number>([16])
const entityNamePlain = (_kind: string, _id: number, name: string) => name
const equipTypeIconHtml = (_iconId: number, o: any = {}) =>
  \`<span class="equip-icon\${o.className ? ' ' + o.className : ''}"\${o.title ? \` title="\${esc(o.title)}"\` : ''}>\${o.overlay ?? ''}</span>\`
const equipPeekIconHtml = (_mstId: number, iconId: number, name: string, o: any = {}) =>
  equipTypeIconHtml(iconId, { ...o, title: undefined, 'aria-label': name })

${EQUIP_CHIPS}

// 实验室那一段：选中哪一艘、虚拟槽里放了什么，都是模块级状态
export const state: any = { rosterId: 0, slots: [], flagship: true }
const shipOf = (rosterId: number) => mg.ships[rosterId]
const masterShipOf = (mstId: number) => mg.master.ships[mstId]
const equipDisplayName = (mstId: number) => \`装备#\${mstId}\`

${SLOT_PICKER}

export { equipChips, slotPickerHtml }
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-hangar-hover-'))
  const entry = path.join(dir, 'hover.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'hover.cjs')
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

/**
 * 摆一局：一艘在册舰 + 它那一形态的主数据。
 *
 * @param ship  `{ rosterId, mstId, onslotMax?, slot?, slotEx? }`——`onslotMax` 缺省 =
 *              这艘舰没被扩过（真报文里那个键根本不存在，不是空数组）
 * @param maxEq 这一形态各格的主数据标准搭载
 */
export const reset = (ship, maxEq) => {
  const { rosterId, mstId, onslotMax, slot, slotEx = 0 } = ship
  mgReset()
  loaded.mg.ships[rosterId] = {
    id: rosterId,
    shipId: mstId,
    slot: slot ?? maxEq.map(() => 0),
    slotEx,
    onslot: maxEq.map(() => 0),
    ...(onslotMax ? { onslotMax } : {}),
  }
  loaded.mg.master.ships[mstId] = { maxEq, slotNum: maxEq.filter((n) => n > 0).length }
  loaded.state.rosterId = rosterId
  loaded.state.slots = (slot ?? maxEq.map(() => 0)).slice()
}

const mgReset = () => {
  loaded.mg.ships = {}
  loaded.mg.master.ships = {}
  loaded.mg.master.slotitems = {}
  loaded.mg.slotitems = {}
}

/** 锐的编成行装备芯片（空格那几枚带 title）。 */
export const renderEquipChips = (rosterId) => loaded.equipChips(loaded.mg.ships[rosterId])

/** 鉴的实验室装备格（原量 + 增量小字）。 */
export const renderSlotPicker = () => loaded.slotPickerHtml()

/** 把一段 HTML 里所有 `title="…"` 抠出来，按出现顺序给回。 */
export const titlesOf = (html) =>
  [...html.matchAll(/title="([^"]*)"/g)].map((m) => m[1])
