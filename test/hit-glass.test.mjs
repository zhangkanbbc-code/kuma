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
