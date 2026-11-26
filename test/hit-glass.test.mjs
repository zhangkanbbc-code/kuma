// 名卡单调缺角与修理演出（实验性，维护者裁决 2026-11-26，交接包「被弹缺角与损管维修」）。
//
// 一、单调缺角（src/shared/hit-glass.ts）
//   hitGlassGeometry(shipId, seedKey, width, height) → 一艘舰这一轮带伤的全部顶点，**与档位无关**；
//   hitGlassLayers(geo, tier) → 该档要画的层：cuts（被崩掉的区域）、cracks、bevels、facets、shard（跨入本档时崩飞的那块）。
//   坐标是像素，原点在行左上角。档位只决定开哪几条既有路径：小破→中破→大破→击沉只会沿原缝切开、延伸，不重算、不跳位。
//   四种冲击构型 arch：0 右上角、1 右下角、2 顶缘 V 口、3 底缘 V 口，在舰队内交错，避免全队一个样。
//   裁决：缺口只切底色与特效层，油弹、疲劳、装备、血字照常压在上面（数据永远完整）。
//
// 二、修理演出判定（src/shared/repair-fx.ts）
//   createRepairWatch().observe(ships, { sortie, repairItems }) → Map<id, { kind, before, after, max }>
//   kind：dock 入渠完成（自然出渠、用桶）、berth 母港泊地修理落账、anchorage 出击中紧急泊地修理、
//         damecon 要员（42）发动、goddess 女神（43）发动。
//   repairItems 由调用方从战斗状态取：Map<id, { item: 42 | 43, key }>，key 是「哪一战哪一舰」的去重签名。
//
// 三、文案（维护者 11-26 选定）：飘字「要员发动 / 女神发动 / 入渠完成 / +N 泊修」，不带符号、不写百分比。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { runtimeHost } from '../scripts/lib/player-view-runtime.mjs'

const require = createRequire(import.meta.url)
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const load = (name) => {
  const file = path.join(ROOT, 'dist', 'shared', `${name}.js`)
  assert.ok(fs.existsSync(file), `缺少 src/shared/${name}.ts（构建后在 dist/shared/${name}.js）`)
  return require(file)
}

// ---- 几何工具 ----

const onSegment = ([px, py], [ax, ay], [bx, by], tol) => {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) <= tol
}
/** 点在多边形内或边上（含容差）。 */
const covers = (poly, pt, tol = 0.6) => {
  for (let i = 0; i < poly.length; i++) if (onSegment(pt, poly[i], poly[(i + 1) % poly.length], tol)) return true
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
const area = (poly) => Math.abs(poly.reduce((sum, [x, y], i) => {
  const [nx, ny] = poly[(i + 1) % poly.length]
  return sum + x * ny - nx * y
}, 0)) / 2
const xs = (poly) => poly.map(([x]) => x)
const ys = (poly) => poly.map(([, y]) => y)

const TIERS = ['light', 'medium', 'heavy', 'sunk']
const H = 46
const SAMPLES = []
for (const width of [520, 760]) for (let id = 1; id <= 40; id++) for (const seed of [1, 2, 3]) SAMPLES.push({ id, seed, width })

// ---- 一、单调缺角 ----

test('缺角几何：同舰同种子同宽度逐字稳定；换舰、换受伤周期都换一套', () => {
  const { hitGlassGeometry } = load('hit-glass')
  const a = hitGlassGeometry(101, 1, 640, H)
  assert.deepEqual(hitGlassGeometry(101, 1, 640, H), a)
  assert.notDeepEqual(hitGlassGeometry(101, 2, 640, H), a, '修满后再受伤（seedKey 变了）要换一套')
  assert.notDeepEqual(hitGlassGeometry(102, 1, 640, H), a, '不同舰不雷同')
  assert.ok([0, 1, 2, 3].includes(a.arch), `arch 只有 0～3 四种构型，拿到 ${a.arch}`)
})

test('缺角几何与档位无关：取各档的层不改几何，同档重取逐字相同', () => {
  const { hitGlassGeometry, hitGlassLayers } = load('hit-glass')
  for (const { id, seed, width } of SAMPLES.slice(0, 30)) {
    const geo = hitGlassGeometry(id, seed, width, H)
    const before = JSON.stringify(geo)
    for (const tier of TIERS) assert.deepEqual(hitGlassLayers(geo, tier), hitGlassLayers(geo, tier))
    assert.equal(JSON.stringify(geo), before, '取层不许改几何（档位只决定开哪几条既有路径）')
  }
})

test('小破只有预埋细裂、不缺角；中破、大破各缺一块，击沉两块', () => {
  const { hitGlassGeometry, hitGlassLayers } = load('hit-glass')
  for (const { id, seed, width } of SAMPLES) {
    const geo = hitGlassGeometry(id, seed, width, H)
    const light = hitGlassLayers(geo, 'light')
    assert.equal(light.cuts.length, 0, `#${id}/${seed} 小破不许缺角`)
    assert.equal(light.shard, null, '小破没有崩飞的碎角')
    assert.ok(light.cracks.length >= 1, '小破至少预埋一条细裂')
    assert.equal(hitGlassLayers(geo, 'medium').cuts.length, 1)
    assert.equal(hitGlassLayers(geo, 'heavy').cuts.length, 1)
    assert.equal(hitGlassLayers(geo, 'sunk').cuts.length, 2)
  }
})

test('跨档只沿原缝扩切：中破的缺口整块落在大破缺口里，击沉沿用大破那一块原样不动', () => {
  const { hitGlassGeometry, hitGlassLayers } = load('hit-glass')
  for (const { id, seed, width } of SAMPLES) {
    const geo = hitGlassGeometry(id, seed, width, H)
    const [mid] = hitGlassLayers(geo, 'medium').cuts
    const [heavy] = hitGlassLayers(geo, 'heavy').cuts
    for (const pt of mid) assert.ok(covers(heavy, pt), `#${id}/${seed}@${width} 中破缺口的顶点 ${pt} 跑到了大破缺口外面（跳位）`)
    assert.ok(area(heavy) > area(mid), '大破的缺口比中破大')
    const sunk = hitGlassLayers(geo, 'sunk').cuts
    assert.ok(sunk.some((cut) => JSON.stringify(cut) === JSON.stringify(heavy)), `#${id}/${seed} 击沉要原样保留大破那块缺口`)
  }
})

test('四种构型的落点：角缺贴右缘，V 口落在行宽 50%～86% 之间；顶缘构型贴顶、底缘构型贴底', () => {
  const { hitGlassGeometry, hitGlassLayers } = load('hit-glass')
  for (const { id, seed, width } of SAMPLES) {
    const geo = hitGlassGeometry(id, seed, width, H)
    const [cut] = hitGlassLayers(geo, 'heavy').cuts
    const tag = `#${id}/${seed}@${width} arch ${geo.arch}`
    if (geo.arch === 0 || geo.arch === 1) {
      assert.ok(Math.max(...xs(cut)) >= width - 0.5, `${tag} 角缺要贴右缘`)
    } else {
      assert.ok(Math.min(...xs(cut)) >= width * 0.5 && Math.max(...xs(cut)) <= width * 0.86, `${tag} V 口越界：${xs(cut)}`)
    }
    if (geo.arch === 0 || geo.arch === 2) assert.ok(Math.min(...ys(cut)) <= 0.5, `${tag} 要贴顶缘`)
    else assert.ok(Math.max(...ys(cut)) >= H - 0.5, `${tag} 要贴底缘`)
    for (const [, y] of cut) assert.ok(y >= -0.5 && y <= H + 0.5, `${tag} 缺口超出行高`)
  }
})

test('击沉多出的那块小角在右缘、贴大破缺口的对侧边', () => {
  const { hitGlassGeometry, hitGlassLayers } = load('hit-glass')
  for (const { id, seed, width } of SAMPLES) {
    const geo = hitGlassGeometry(id, seed, width, H)
    const heavy = JSON.stringify(hitGlassLayers(geo, 'heavy').cuts[0])
    const extra = hitGlassLayers(geo, 'sunk').cuts.find((cut) => JSON.stringify(cut) !== heavy)
    const tag = `#${id}/${seed}@${width} arch ${geo.arch}`
    assert.ok(Math.max(...xs(extra)) >= width - 0.5, `${tag} 对侧小角要贴右缘`)
    if (geo.arch === 0 || geo.arch === 2) assert.ok(Math.max(...ys(extra)) >= H - 0.5, `${tag} 大破在顶，小角就在底`)
    else assert.ok(Math.min(...ys(extra)) <= 0.5, `${tag} 大破在底，小角就在顶`)
  }
})

test('缺口不吃掉整行：大破缺口不超过行面积 5%，击沉两块合计不超过 7%', () => {
  const { hitGlassGeometry, hitGlassLayers } = load('hit-glass')
  for (const { id, seed, width } of SAMPLES) {
    const geo = hitGlassGeometry(id, seed, width, H)
    const row = width * H
    assert.ok(area(hitGlassLayers(geo, 'heavy').cuts[0]) <= row * 0.05, `#${id}/${seed}@${width} 大破缺口过大`)
    const sunk = hitGlassLayers(geo, 'sunk').cuts.reduce((sum, cut) => sum + area(cut), 0)
    assert.ok(sunk <= row * 0.07, `#${id}/${seed}@${width} 击沉缺口过大`)
  }
})

test('崩飞的碎角：中破、大破、击沉各有一块，小破没有；中破飞走的就是中破缺口那一块，击沉飞走的是对侧小角', () => {
  const { hitGlassGeometry, hitGlassLayers } = load('hit-glass')
  for (const { id, seed, width } of SAMPLES) {
    const geo = hitGlassGeometry(id, seed, width, H)
    const mid = hitGlassLayers(geo, 'medium')
    const heavy = hitGlassLayers(geo, 'heavy')
    const sunk = hitGlassLayers(geo, 'sunk')
    assert.ok(mid.shard && heavy.shard && sunk.shard, `#${id}/${seed} 中破以上每次跨档都要有碎角崩飞`)
    for (const pt of mid.shard) assert.ok(covers(mid.cuts[0], pt), '中破崩飞的碎角要落在中破缺口里')
    for (const pt of heavy.shard) assert.ok(covers(heavy.cuts[0], pt), '大破崩飞的碎角要落在大破缺口里')
    const extra = sunk.cuts.find((cut) => JSON.stringify(cut) !== JSON.stringify(heavy.cuts[0]))
    for (const pt of sunk.shard) assert.ok(covers(extra, pt), '击沉崩飞的是对侧小角')
  }
})

test('全队不雷同：四种构型各占一成半到三成半；任意六艘相邻舰至少两种构型', () => {
  const { hitGlassGeometry } = load('hit-glass')
  const count = [0, 0, 0, 0]
  for (let id = 1; id <= 400; id++) count[hitGlassGeometry(id, 1, 640, H).arch]++
  for (const [arch, n] of count.entries()) assert.ok(n >= 60 && n <= 140, `构型 ${arch} 占 ${n}/400，分布失衡`)
  for (let seed = 1; seed <= 60; seed++) {
    const arches = new Set([101, 102, 103, 104, 105, 106].map((id) => hitGlassGeometry(id, seed, 640, H).arch))
    assert.ok(arches.size >= 2, `seed ${seed}：六艘舰全是同一种缺角`)
  }
})

// ---- 裁决①：缺口只切底色与特效层，数据列不被裁 ----

test('样式表：开关作用域里不给编队行本身和数据列加 clip-path（缺口只切底色与特效层）', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const splitTop = (sel) => {
    const out = []
    let depth = 0
    let cur = ''
    for (const ch of sel) {
      if (ch === '(') depth++
      if (ch === ')') depth--
      if (ch === ',' && depth === 0) { out.push(cur); cur = '' } else cur += ch
    }
    return [...out, cur].map((s) => s.trim()).filter(Boolean)
  }
  const DATA = /^(?:\.ship(?![\w-])|.*:is\([^)]*\.(?:who|hpc|fa2|cond|eq|ship-detail)\b|\.(?:who|hpc|fa2|cond|eq|ship-detail)\b)/
  const bad = []
  for (const m of html.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = m[2]
    if (!/(?:^|;|\s)clip-path\s*:/.test(decls)) continue
    for (const sel of splitTop(m[1])) {
      if (!/\[data-(?:hit|crack|fracture|glass|repair|weld)/.test(sel) && !/data-hit-fx/.test(sel)) continue
      const last = sel.split(/\s*>\s*|\s+/).filter(Boolean).pop()
      if (DATA.test(last)) bad.push(sel)
    }
  }
  assert.deepEqual(bad, [], '这些选择器会把数据列或整行裁掉（缺口只许切底色与特效层）')
})

// ---- 二、修理演出判定 ----

const ship = (id, nowhp, extra = {}) => ({ id, nowhp, maxhp: 40, docked: false, berthRepairing: false, ...extra })

test('首次见到只记基线，状态不变不报', () => {
  const { createRepairWatch } = load('repair-fx')
  const watch = createRepairWatch()
  assert.equal(watch.observe([ship(1, 10, { docked: true })], { sortie: false }).size, 0)
  assert.equal(watch.observe([ship(1, 10, { docked: true })], { sortie: false }).size, 0)
})

test('母港：在渠的舰出渠且修满 → 入渠完成；没进渠直接修满（入渠时用桶）也算入渠完成', () => {
  const { createRepairWatch } = load('repair-fx')
  const watch = createRepairWatch()
  watch.observe([ship(1, 10, { docked: true }), ship(2, 12)], { sortie: false })
  const fx = watch.observe([ship(1, 40), ship(2, 40)], { sortie: false })
  assert.deepEqual(fx.get(1), { kind: 'dock', before: 10, after: 40, max: 40 })
  assert.deepEqual(fx.get(2), { kind: 'dock', before: 12, after: 40, max: 40 })
})

test('母港：在泊地修理范围内的舰回血 → 泊修落账，带回血前后', () => {
  const { createRepairWatch } = load('repair-fx')
  const watch = createRepairWatch()
  watch.observe([ship(3, 30, { berthRepairing: true })], { sortie: false })
  assert.deepEqual(watch.observe([ship(3, 34, { berthRepairing: true })], { sortie: false }).get(3), { kind: 'berth', before: 30, after: 34, max: 40 })
})

test('掉血、在渠里不动、不认得来源的回血都不报', () => {
  const { createRepairWatch } = load('repair-fx')
  const watch = createRepairWatch()
  watch.observe([ship(1, 30), ship(2, 10, { docked: true }), ship(3, 30)], { sortie: false })
  const fx = watch.observe([ship(1, 20), ship(2, 10, { docked: true }), ship(3, 34)], { sortie: false })
  assert.equal(fx.size, 0, JSON.stringify([...fx]))
})

test('出击中：没有损管信号的回血 → 紧急泊地修理', () => {
  const { createRepairWatch } = load('repair-fx')
  const watch = createRepairWatch()
  watch.observe([ship(4, 28)], { sortie: true })
  assert.deepEqual(watch.observe([ship(4, 33)], { sortie: true }).get(4), { kind: 'anchorage', before: 28, after: 33, max: 40 })
})

test('出击中：要员、女神按战斗信号报，不看血量涨跌；同一签名只报一次', () => {
  const { createRepairWatch } = load('repair-fx')
  const watch = createRepairWatch()
  watch.observe([ship(5, 30), ship(6, 6)], { sortie: true })
  const items = new Map([[5, { item: 42, key: '3:5:42' }], [6, { item: 43, key: '3:6:43' }]])
  const fx = watch.observe([ship(5, 8), ship(6, 40)], { sortie: true, repairItems: items })
  assert.deepEqual(fx.get(5), { kind: 'damecon', before: 30, after: 8, max: 40 }, '要员拉回两成，血量可能比战前还低，照样算要员')
  assert.deepEqual(fx.get(6), { kind: 'goddess', before: 6, after: 40, max: 40 })
  assert.equal(watch.observe([ship(5, 8), ship(6, 40)], { sortie: true, repairItems: items }).size, 0, '同一战同一舰重画不重播')
})

test('离队再回来按首次见到处理', () => {
  const { createRepairWatch } = load('repair-fx')
  const watch = createRepairWatch()
  watch.observe([ship(7, 10, { docked: true })], { sortie: false })
  watch.observe([], { sortie: false })
  assert.equal(watch.observe([ship(7, 40)], { sortie: false }).size, 0)
})

// ---- 三、文案（维护者 11-26 选定）与开关说明 ----

test('飘字用选定的四句：要员发动、女神发动、入渠完成、+N 泊修；交接包原稿的符号与「损管发动」「全复原」不进界面', () => {
  const dir = path.join(ROOT, 'src', 'renderer')
  const files = [path.join(dir, 'index.html'), ...fs.readdirSync(path.join(dir, 'modules')).filter((f) => f.endsWith('.ts')).map((f) => path.join(dir, 'modules', f))]
  const all = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n')
  for (const text of ['要员发动', '女神发动', '入渠完成']) assert.ok(all.includes(text), `界面里找不到「${text}」`)
  assert.match(all, /泊修/, '泊修回血要飘「+N 泊修」')
  // 单个「✦」「⚡」在 kuma 里本来就有别的用途（闪光、暴击星标），只查交接包原稿的整句。
  for (const text of ['损管发动', '全复原', '⚡ 损管', '✦ 女神', '入渠完成 ✓']) assert.ok(!all.includes(text), `「${text}」是交接包原稿，维护者选了不带符号的那套`)
})

test('开关说明不再写「仅出击生效」：泊地修理与入渠完成发生在母港', () => {
  const yu = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'modules', 'yu.ts'), 'utf8')
  const at = yu.indexOf('const hitShakeCardHtml')
  assert.ok(at >= 0)
  const card = yu.slice(at, yu.indexOf('\nconst ', at + 10))
  assert.doesNotMatch(card, /仅出击生效/)
  assert.match(card, /config\.get\('kuma\.hitShake', false\)/, '仍是同一个开关、默认关')
})

// ---- 四、编队行怎么接玻璃层（接入在 shipRow 里，不在外面改字符串） ----

test('编队行：玻璃挂件的属性挂在行上、图层进 .dmg-fx、连接线紧跟行首；旧裂纹层不再输出', async () => {
  const { reset, renderRow, setGlassFx, setHitCrack, setHitFracture, setHitShake } = await import('./fixtures/render-ru-row.mjs')
  const flat = (html) => html.replace(/\s+/g, ' ')
  reset({ names: { 1: '吹雪' } })
  setHitShake({})
  setHitFracture({})
  setHitCrack({})
  setGlassFx({ 5: { attrs: ' data-weld="1"', layers: '<span class="glass-host"></span>', tether: '<span class="berth-tether"></span>', wash: true } })
  const html = flat(renderRow({ id: 5, shipId: 1, nowhp: 30 }))
  const tag = html.match(/<div class="ship[^"]*"[^>]*>/)?.[0] ?? ''
  assert.match(tag, /\sdata-weld="1"/, '挂件属性要在行标签上')
  assert.match(html, /<div class="ship[^"]*"[^>]*>\s*<span class="berth-tether"><\/span>/, '连接线紧跟行首')
  assert.match(html, /<span class="dmg-fx" aria-hidden="true"><span class="dmg-wash"><\/span><span class="glass-host"><\/span>/, '没有伤势时也要给余韵一层底色，再放玻璃层')
  setGlassFx({ 5: { attrs: '', layers: '<span class="glass-host"></span>', tether: '', wash: false } })
  setHitCrack({ 5: 'heavy' })
  const heavy = flat(renderRow({ id: 5, shipId: 1, nowhp: 8 }))
  assert.match(heavy, /class="dmg-scan"><\/span><span class="glass-host">/, '有伤势时玻璃层接在伤势底色之后')
  assert.doesNotMatch(heavy, /dmg-fracture/, '旧的横向裂纹层已被玻璃层取代')
  setGlassFx({})
  setHitCrack({})
  assert.doesNotMatch(flat(renderRow({ id: 5, shipId: 1, nowhp: 40 })), /dmg-fx|glass-host|berth-tether/, '没有挂件也没伤势时不留痕迹')
})


// 2026-11-26 他报「编队的动画消失是1帧消失」：余韵到点、泊修撤下都是硬切。
// 交接包：女神余韵「自然淡去」、入渠水青「约 2–3 秒后归于平静」。切 ru.ts 真代码跑，计时器与时钟换成假的。
const fadeHarness = () => {
  let now = 1000
  const timers = []
  const rows = new Map()
  const rowOf = (id) => {
    if (!rows.has(id)) rows.set(id, { attrs: new Map(), removed: [] })
    const state = rows.get(id)
    return {
      setAttribute: (key, value) => state.attrs.set(key, value),
      removeAttribute: (key) => state.attrs.delete(key),
      querySelector: (selector) => ({ remove: () => state.removed.push(selector) }),
    }
  }
  const pane = { querySelector: (selector) => rowOf(Number(selector.match(/data-ship="(\d+)"/)[1])) }
  const { api } = runtimeHost().extract('src/renderer/modules/ru.ts', [
    'FX_FADE_MS', 'transientAura', 'berthFxFlagIds', 'berthFxRepairIds',
    'activeTransientAura', 'scheduleAuraCleanup', 'noteBerthFade', 'shipGlassFx',
  ], {
    pane,
    Date: { now: () => now },
    setTimeout: (cb, ms) => { timers.push({ cb, at: now + ms }); return timers.length },
    clearTimeout: () => {},
    hitShakeEnabled: () => true,
    shipHitCrack: () => null,
    dockOf: () => null,
    weldedShips: new Set(),
    pendingRepairFx: new Map(),
    fractureSeeds: new Map(),
    cachedRowWidth: 540,
    cachedRowHeight: 48,
  })
  const advance = (ms) => {
    now += ms
    for (let due = timers.filter((t) => t.at <= now); due.length; due = timers.filter((t) => t.at <= now)) {
      for (const timer of due) timers.splice(timers.indexOf(timer), 1)
      for (const timer of due) timer.cb()
    }
  }
  const attrsOf = (id) => api.shipGlassFx({ id, nowhp: 40, maxhp: 40 }, false)?.attrs ?? ''
  return { api, advance, rows, attrsOf, now: () => now }
}

test('余韵退场：到点先挂 data-aura-fade 淡出，FX_FADE_MS 后再撤，不再一帧消失', () => {
  for (const [kind, hold] of [['dock', 2600], ['goddess', 4500]]) {
    const { api, advance, rows, attrsOf, now } = fadeHarness()
    api.transientAura.set(7, { kind, until: now() + hold })
    api.scheduleAuraCleanup(7, hold)
    assert.match(attrsOf(7), new RegExp(`data-repair-aura="${kind}"`))
    assert.doesNotMatch(attrsOf(7), /data-aura-fade/)
    advance(hold)
    assert.equal(rows.get(7).attrs.get('data-aura-fade'), '1', `${kind} 到点就地挂淡出`)
    assert.match(attrsOf(7), new RegExp(`data-repair-aura="${kind}" data-aura-fade="1"`), '淡出期间重画也续挂')
    advance(api.FX_FADE_MS - 1)
    assert.equal(rows.get(7).attrs.has('data-aura-fade'), true, '淡出没播完不撤')
    advance(1)
    assert.equal(rows.get(7).attrs.has('data-aura-fade'), false)
    assert.equal(api.shipGlassFx({ id: 7, nowhp: 40, maxhp: 40 }, false), null, '淡完不留痕迹')
  }
})

test('泊修常驻态退场：撤下的工作舰与受修舰续挂原属性淡出，重新亮起就取消淡出', () => {
  const { api, advance, rows, attrsOf } = fadeHarness()
  // 上一次渲染 7 是工作舰、8 在受修，这一次两者都不在了
  api.noteBerthFade(new Set([7]), new Set([8]))
  assert.match(attrsOf(7), /data-berth-role="flag" data-berth-fade="1"/)
  assert.match(attrsOf(8), /data-berth-repair="1" data-berth-fade="1"/)
  assert.match(api.shipGlassFx({ id: 8, nowhp: 30, maxhp: 40 }, false).tether, /berth-tether/, '连接线淡出期间还在')
  advance(api.FX_FADE_MS)
  assert.equal(api.shipGlassFx({ id: 7, nowhp: 40, maxhp: 40 }, false), null)
  assert.equal(api.shipGlassFx({ id: 8, nowhp: 30, maxhp: 40 }, false), null)
  assert.ok(rows.get(8).removed.some((selector) => selector.includes('berth-tether')), '淡完就地拆连接线')
  // 9 刚撤下又在下一次渲染里亮起：取消淡出，照常显示
  api.noteBerthFade(new Set([9]), new Set())
  api.berthFxFlagIds.add(9)
  api.noteBerthFade(new Set(), new Set())
  assert.match(attrsOf(9), /data-berth-role="flag"/)
  assert.doesNotMatch(attrsOf(9), /data-berth-fade/)
})

test('退场淡出样式：时长与 FX_FADE_MS 同值，金色血条做成可淡掉的叠层，减少动态时不播', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8')
  const ru = fs.readFileSync(path.join(ROOT, 'src/renderer/modules/ru.ts'), 'utf8')
  const fadeMs = Number(ru.match(/const FX_FADE_MS = (\d+)/)[1])
  const durations = [...html.matchAll(/animation: ru-fx-fade-(?:shadow|out|fc) (\d+)ms/g)].map((m) => Number(m[1]))
  assert.equal(durations.length, 3)
  for (const ms of durations) assert.equal(ms, fadeMs)
  assert.match(html, /\[data-repair-aura="goddess"\] \.hpc \.bar > i::after \{[^}]*linear-gradient\(90deg, var\(--gold\), var\(--hit-goddess\)\)/)
  assert.doesNotMatch(html, /\[data-repair-aura="goddess"\] \.hpc \.bar > i \{[^}]*background:/, '渐变不能直接换底色，否则淡不掉')
  const reduced = html.slice(html.indexOf('.fleet-skin .ship.left.leaving,'))
  for (const selector of ['.ship[data-aura-fade="1"],', '.ship[data-berth-fade="1"] .fc,']) {
    assert.ok(reduced.slice(0, reduced.indexOf('{ animation: none; }')).includes(selector), selector)
  }
})

// 2026-11-26 查出：被弹参数只活一次渲染、修理底色只挂一次，掉血后 250ms 的「编队任务反查」重画
// 输出就变了、整块换 DOM，演出被拦腰截断（他感觉「几乎一眨眼就完成」的主因）。
test('演出期间重画续挂同一份被弹参数与修理底色，播完才撤', () => {
  let now = 1000
  const { api } = runtimeHost().extract('src/renderer/modules/ru.ts', ['activeHits', 'repairWashUntil', 'shipHitShake', 'shipGlassFx'], {
    Date: { now: () => now },
    hitShakeEnabled: () => true,
    shipHitCrack: () => null,
    dockOf: () => null,
    weldedShips: new Set(),
    pendingRepairFx: new Map(),
    fractureSeeds: new Map(),
    berthFxFlagIds: new Set(),
    berthFxRepairIds: new Set(),
    berthFadeFlag: new Map(),
    berthFadeRepair: new Map(),
    activeTransientAura: () => null,
    cachedRowWidth: 540,
    cachedRowHeight: 48,
  })
  const params = { severity: 3, totalMs: 1460 }
  api.activeHits.set(5, { params, until: now + params.totalMs })
  const ship = { id: 5, nowhp: 25, maxhp: 40 }
  assert.equal(api.shipHitShake(ship), params, '第一次渲染')
  now += 300
  assert.equal(api.shipHitShake(ship), params, '250ms 后的反查重画还是同一份，输出不变就不换 DOM')
  now += 1160
  assert.equal(api.shipHitShake(ship), null, '播完才撤')
  api.repairWashUntil.set(6, now + 1500)
  assert.match(api.shipGlassFx({ id: 6, nowhp: 40, maxhp: 40 }, false).layers, /fx-flash/)
  now += 1500
  assert.equal(api.shipGlassFx({ id: 6, nowhp: 40, maxhp: 40 }, false), null)
})

test('中破 V 构型按方案三：两道裂纹从缺口尖端放射，不画外圈 B 与暗面；角缺构型照旧', () => {
  // 维护者裁决 2026-11-26：原稿外圈 B 与缺口 A 都是 V、彼此平行，读起来像「≫」双裂纹，审片页对比后定方案三
  const { hitGlassGeometry, hitGlassLayers } = load('hit-glass')
  let vArch = 0, corner = 0
  for (const { id, seed, width } of SAMPLES) {
    const geo = hitGlassGeometry(id, seed, width, H)
    const mid = hitGlassLayers(geo, 'medium')
    const tag = `#${id}/${seed}@${width} arch ${geo.arch}`
    const lines = [...mid.cracks, ...mid.subCracks].map((line) => JSON.stringify(line))
    if (geo.arch === 2 || geo.arch === 3) {
      vArch++
      const apex = JSON.stringify(geo.lineA[1])
      assert.ok([...mid.cracks, ...mid.subCracks].every((line) => JSON.stringify(line[0]) === apex), `${tag} 中破裂纹都从缺口尖端出发`)
      assert.ok(!lines.includes(JSON.stringify(geo.lineB)), `${tag} 中破不画外圈 B`)
      assert.deepEqual(mid.facets, [], `${tag} 中破不画 A、B 之间的暗面`)
      assert.deepEqual(hitGlassLayers(geo, 'heavy').bevels, [geo.lineB], `${tag} 大破照旧沿 B 崩开`)
    } else {
      corner++
      assert.ok(lines.includes(JSON.stringify(geo.lineB)), `${tag} 角缺构型照旧画外圈 B`)
      assert.deepEqual(mid.facets, [geo.shardB])
    }
  }
  assert.ok(vArch > 0 && corner > 0, '样本两类构型都要有')
})

test('带伤入渠：行挂 data-docked，红黄告警与故障撤掉、换成缓慢脉冲的恢复光；裂纹照留', () => {
  // 维护者裁决 2026-11-26：入渠期间裂纹保留（②），告警换恢复光（同日）
  let docked = true
  const { api } = runtimeHost().extract('src/renderer/modules/ru.ts', ['shipGlassFx'], {
    Date: { now: () => 1000 },
    hitShakeEnabled: () => true,
    shipHitCrack: () => 'heavy',
    dockOf: () => (docked ? { id: 1 } : null),
    weldedShips: new Set(),
    pendingRepairFx: new Map(),
    repairWashUntil: new Map(),
    fractureSeeds: new Map([[5, 1]]),
    berthFxFlagIds: new Set(),
    berthFxRepairIds: new Set(),
    berthFadeFlag: new Map(),
    berthFadeRepair: new Map(),
    activeTransientAura: () => null,
    cachedRowWidth: 540,
    cachedRowHeight: 48,
  })
  const ship = { id: 5, nowhp: 8, maxhp: 40 }
  const fx = api.shipGlassFx(ship, false)
  assert.match(fx.attrs, /data-docked="1"/)
  assert.match(fx.layers, /<svg class="glass-svg"/, '裂纹与缺角照留')
  assert.doesNotMatch(api.shipGlassFx(ship, true).attrs, /data-docked/, '击沉不挂')
  docked = false
  assert.doesNotMatch(api.shipGlassFx(ship, false).attrs, /data-docked/, '没入渠不挂')

  const css = fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8')
  assert.match(css, /\.ship\[data-docked="1"\]\[data-crack\] :is\(\.dmg-hazard, \.dmg-scan, \.dmg-ember, \.glitch-bars\) \{ display: none; \}/)
  assert.match(css, /\.ship\[data-docked="1"\]\[data-crack\] \{[^}]*animation: ru-dock-recover 4\.2s ease-in-out infinite;/)
  assert.match(css, /@keyframes ru-dock-recover \{[^}]*var\(--hit-aqua\)/)
  assert.match(css, /\.ship\[data-docked="1"\]\[data-crack\] \.hpc \.num \.st \{ animation: none; \}/, '大破徽标不再故障闪')
  const reduced = css.slice(css.indexOf('.fleet-skin .ship.left.leaving,'))
  assert.ok(reduced.slice(0, reduced.indexOf('{ animation: none; }')).includes('.ship[data-docked="1"][data-crack],'), '减少动态时恢复光不脉冲')
})

test('一次跨几档就崩落几块：小破直跳大破 A、B 一起掉（＝大破减小破那整块），中破到击沉 B、C', () => {
  // 2026-11-26 他要：从小破蔓延到大破时，大破与小破之间差的那片玻璃要崩落，不能只飞外圈那一条
  const geo = { topSide: true, shardA: [[1, 1]], shardB: [[2, 2]], shardC: [[3, 3]] }
  const run = (prevTier, tier) => {
    const calls = []
    const { api } = runtimeHost().extract('src/renderer/modules/ru.ts', ['runPostRenderHitFx'], {
      pendingShards: [{ shipId: 5, geo, tier, prevTier }],
      pendingRepairFx: new Map(),
      document: { visibilityState: 'visible' },
      window: { matchMedia: () => ({ matches: false }) },
      launchFlyingShard: (_row, _geo, poly, _tier, _dx, _dy, _rot, delay, isOpp) => calls.push([poly === geo.shardA ? 'A' : poly === geo.shardB ? 'B' : 'C', delay, isOpp]),
      scheduleAuraCleanup: () => {},
      mg: { ships: {}, slotitems: {} },
    })
    api.runPostRenderHitFx({ querySelector: () => ({}) })
    return calls
  }
  assert.deepEqual(run('light', 'medium').map(([piece]) => piece), ['A'])
  assert.deepEqual(run('medium', 'heavy').map(([piece]) => piece), ['B'])
  assert.deepEqual(run('light', 'heavy'), [['A', 0, false], ['B', 50, false]], '小破直跳大破：A 与 B 先后掉')
  assert.deepEqual(run('none', 'heavy').map(([piece]) => piece), ['A', 'B'])
  assert.deepEqual(run('medium', 'sunk').map(([piece]) => piece), ['B', 'C'])
  assert.deepEqual(run('light', 'sunk').map(([piece, , opp]) => [piece, opp]), [['A', false], ['B', false], ['C', true]])
  assert.deepEqual(run('heavy', 'sunk').map(([piece]) => piece), ['C'])
})

test('中破 / 大破左端是向右辐射的微光，只要柔光、不要任何线条', () => {
  // 维护者裁决 2026-11-26：「改成向右辐射的微光」「不要加这种有点突兀的线，就用微光就行了」
  // （取代 11-25 交接稿的「左端微斜纹损管刻度」）
  const css = fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8')
  for (const tier of ['medium', 'heavy']) {
    const at = css.indexOf(`.fleet-skin .ship[data-crack="${tier}"] .dmg-hazard {`)
    assert.ok(at >= 0, tier)
    const rule = css.slice(at, css.indexOf('}', at))
    assert.match(rule, /background: radial-gradient\(ellipse [^;]*at 0% 50%/, `${tier}：从左锚向右扩散的柔光`)
    assert.doesNotMatch(rule, /repeating-/, `${tier}：不要斜纹，也不要放射细线`)
  }
})
