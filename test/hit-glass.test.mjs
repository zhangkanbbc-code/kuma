// 名卡防弹玻璃弹孔、持续战损与修理演出（实验性；交接包「编队被弹与特色入渠动画」v2，维护者 2026-11-27 定稿，
// 取代 11-26 的单调缺角）。
//
// 一、弹孔几何（src/shared/hit-glass.ts）与持续战损（src/shared/hit-damage.ts）
//   buildBulletHole({ shipId, seedKey, idx, singleLoss, massive, kind, zones, existing }) → 一发的碎裂几何，
//   四种样式（防弹蛛网 / 斜射长裂 / 钢化碎冰 / 边缘崩缺）按种子确定性轮换；落点只挑 rowZonesOf 算出的留白；
//   新裂纹碰到旧裂纹或破口就停（T 型止裂）；单发高伤崩出直连弹着中心的不对称破口并飞出 6–8 块碎片。
//   applyHitReport(...) 把一段战报追加到这一轮带伤的战损上：炮击留弹孔（一阶段最多 5 个、累计最多 7 个），
//   鱼雷不留弹孔、进水（上限 52%）并右沉（顺时针正角），潜水舰按反潜画、只轻微进水。
//   holeRepairState(holes, hole, progress) → 入渠按单发威力轻→重逐孔逆向收口；hitGlassSvg 拼整张玻璃层。
//   坐标是像素，原点在行左上角。裁决：数据列永远压在弹孔上面（z-index 3），弹孔只切底色与特效层。
//
// 二、修理演出判定（src/shared/repair-fx.ts）
//   createRepairWatch().observe(ships, { sortie, repairItems, now }) → Map<id, { kind, before, after, max, bucket? }>
//   kind：dock 入渠完成（自然出渠、用桶；bucket 标出泼桶）、berth 母港泊地修理落账、anchorage 出击中紧急泊地修理、
//         damecon 要员（42）发动、goddess 女神（43）发动。
//   dockRepairProgress(completeTime, ndockTime, now) → 入渠维修进度 0..1，拿不到总工时给 null。
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

// ---- 几何工具（测试自己的尺子，不借被测模块的） ----

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
/** 两条线段严格相交（交点不在任一端点附近）时返回交点，否则 null */
const crossing = ([a, b], [c, d]) => {
  const r = [b[0] - a[0], b[1] - a[1]]
  const s = [d[0] - c[0], d[1] - c[1]]
  const den = r[0] * s[1] - r[1] * s[0]
  if (Math.abs(den) < 1e-9) return null
  const q = [c[0] - a[0], c[1] - a[1]]
  const t = (q[0] * s[1] - q[1] * s[0]) / den
  const u = (q[0] * r[1] - q[1] * r[0]) / den
  return t > 0.06 && t < 0.94 && u > 0.06 && u < 0.94 ? [a[0] + r[0] * t, a[1] + r[1] * t] : null
}
const segsOf = (pts) => pts.slice(1).map((p, i) => [pts[i], p])
const inRect = ([x, y], r) => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1

const H = 46
// 一行收起时的典型列位置（宽档 760 / 窄档 560）：舰名文字到 230 / 190，装备只占到一半
// 窄档里舰名列只到 W-388，主留白（舰名右缘到血条左缘）几乎没有，弹孔只能落在装备尾与上下缘
const layoutOf = (width) => ({
  width,
  height: H,
  whoRight: width > 600 ? 230 : width - 400,
  hpc: { x0: width - 380, x1: width - 280, y0: 9, y1: 37 },
  fa2: { x0: width - 272, x1: width - 220, y0: 17, y1: 29 },
  cond: { x0: width - 212, x1: width - 172, y0: 8, y1: 38 },
  eq: { x0: width - 164, x1: width - 14, y0: 12, y1: 34 },
  eqContentRight: width - 90,
})
const SHIPS = Array.from({ length: 40 }, (_, i) => i + 1)

/** 逐发打一轮：每发都用 applyHitReport 走真流程 */
const pound = (shipId, seedKey, width, hits, max = 60, kind = 'shell') => {
  const { applyHitReport, emptyDamageState } = load('hit-damage')
  const { rowZonesOf } = load('hit-glass')
  const zones = rowZonesOf(layoutOf(width))
  let state = emptyDamageState(seedKey)
  let hp = max
  for (const dmg of hits) {
    const report = kind === 'asw'
      ? { shellHits: [], torpHits: [], aswHits: [dmg], shellDmg: 0, torpDmg: 0, aswDmg: dmg, totalDmg: dmg, shellRatio: 0, torpRatio: 0, dominant: 'asw', fallback: false }
      : { shellHits: [dmg], torpHits: [], aswHits: [], shellDmg: dmg, torpDmg: 0, aswDmg: 0, totalDmg: dmg, shellRatio: 1, torpRatio: 0, dominant: 'shell', fallback: false }
    const after = Math.max(1, hp - dmg)
    state = applyHitReport({ shipId, state, report, before: hp, after, max, zones }).state
    hp = after
  }
  return { state, zones }
}

// ---- 一、弹孔几何与持续战损 ----

test('弹孔几何：同舰同种子同一串命中逐字稳定；换舰、换受伤周期都换一套', () => {
  const a = pound(101, 1, 760, [6, 9, 14]).state
  assert.deepEqual(pound(101, 1, 760, [6, 9, 14]).state, a)
  assert.notDeepEqual(pound(101, 2, 760, [6, 9, 14]).state.holes, a.holes, '修满后再受伤（seedKey 变了）要换一套')
  assert.notDeepEqual(pound(102, 1, 760, [6, 9, 14]).state.holes, a.holes, '不同舰不雷同')
})

test('四种碎裂样式都会出现，同舰相邻两发不重样', () => {
  const seen = new Set()
  for (const id of SHIPS) {
    const { holes } = pound(id, 3, 760, [5, 7, 9, 11]).state
    holes.forEach((hole, i) => {
      seen.add(hole.style)
      if (i > 0 && !holes[i - 1].edge && !hole.edge) assert.notEqual(hole.style, holes[i - 1].style, `#${id} 第 ${i + 1} 发与上一发同样式`)
    })
  }
  assert.deepEqual([...seen].sort(), ['edge-cleave', 'mosaic', 'spiderweb', 'starburst'])
})

test('落点只挑留白：弹着中心落在舰名右缘到血条左缘、装备尾到行右缘、或上下缘窄带里；边缘崩缺贴上下缘', () => {
  let inMain = 0
  for (const width of [560, 760]) {
    for (const id of SHIPS) {
      const { state, zones } = pound(id, 2, width, [4, 6, 8, 10, 12])
      const [main] = zones.safe
      for (const hole of state.holes) {
        if (hole.edge) {
          assert.ok(hole.y === 0 || hole.y === H, `#${id}@${width} 边缘崩缺要贴上下缘，拿到 y=${hole.y}`)
          continue
        }
        const zone = zones.safe.find((z) => hole.x >= z.x0 && hole.x <= z.x1 && hole.y >= z.y0 && hole.y <= z.y1)
        assert.ok(zone, `#${id}@${width} 弹孔 (${hole.x},${hole.y}) 不在任何留白里`)
        // 不在上下缘窄带的，一定避开了头像舰名、血条、油弹、疲劳与装备
        if (zone.y1 - zone.y0 > 8) for (const rect of zones.avoid) assert.ok(!inRect([hole.x, hole.y], rect), `#${id}@${width} 弹孔 (${hole.x},${hole.y}) 压在内容上 ${JSON.stringify(rect)}`)
        if (zone === main && width === 760) inMain++
      }
    }
  }
  assert.ok(inMain > 40, `宽档里舰名右缘到血条左缘是最宽的留白，平均每艘至少一个弹孔落在那里（只有 ${inMain} 个）`)
})

test('不叠成一团：同一轮的弹着中心两两相距不少于 36px（常规要 44px，放不下时放宽到 36px 再不行就不加）', () => {
  for (const id of SHIPS) {
    const { holes } = pound(id, 4, 560, [3, 4, 5, 6, 7, 8, 9]).state
    for (let i = 0; i < holes.length; i++) {
      for (let j = i + 1; j < holes.length; j++) {
        const d = Math.hypot(holes[i].x - holes[j].x, holes[i].y - holes[j].y)
        assert.ok(d >= 36, `#${id} 第 ${i + 1}、${j + 1} 个弹孔只隔 ${d.toFixed(1)}px`)
      }
    }
  }
})

test('T 型止裂：新弹孔的裂纹碰到旧裂纹或破口边就停，不穿过去', () => {
  const { holeSegments } = load('hit-glass')
  let checked = 0
  for (const id of SHIPS) {
    const { holes } = pound(id, 5, 560, [12, 14, 16, 18, 20], 50).state
    for (let k = 1; k < holes.length; k++) {
      const old = holeSegments(holes.slice(0, k))
      for (const ray of holes[k].rays) {
        const [sx, sy] = ray.pts[0]
        for (const seg of segsOf(ray.pts)) {
          for (const o of old) {
            checked++
            const hit = crossing(seg, o)
            // 起点 3px 内的交叉不算：弹着点本身就可能压在旧裂纹上，止裂判据从裂纹起点的 3% 之后才算（看不出来）
            if (hit && Math.hypot(hit[0] - sx, hit[1] - sy) > 3) assert.fail(`#${id} 第 ${k + 1} 个弹孔的裂纹在 (${hit[0].toFixed(1)},${hit[1].toFixed(1)}) 穿过了旧裂纹`)
          }
        }
      }
    }
  }
  assert.ok(checked > 1000, `样本太少（${checked}），这条护栏没量到东西`)
})

test('没有浮空黑块：每块破口都直连弹着中心，边缘崩缺的缺口贴着卡片上下缘', () => {
  let spalls = 0
  for (const id of SHIPS) {
    for (const hits of [[30], [22, 34], [9, 16, 26]]) {
      for (const hole of pound(id, 6, 760, hits, 60).state.holes) {
        for (const poly of hole.spallPolys) {
          spalls++
          if (hole.edge) assert.ok(poly.some(([, y]) => y === 0 || y === H), `#${id} 边缘崩缺的缺口没贴边`)
          else assert.ok(covers(poly, [hole.x, hole.y], 1.2), `#${id} ${hole.style} 破口没连到弹着中心 (${hole.x},${hole.y})`)
        }
      }
    }
  }
  assert.ok(spalls > 50, `样本里破口太少（${spalls}）`)
})

test('单发威力：擦伤是 1.4–2.5px 的针孔核、没有破口；单发高伤崩出破口并飞出 6–8 块碎片', () => {
  const { buildBulletHole, rowZonesOf, holePowerOf } = load('hit-glass')
  const zones = rowZonesOf(layoutOf(760))
  assert.deepEqual([0.05, 0.15, 0.3, 0.5].map((loss) => holePowerOf(loss, false)), [1, 2, 3, 4])
  assert.equal(holePowerOf(0.2, true), 4, '健康一炮直穿大破＝按最重那一档')
  for (const id of SHIPS) {
    for (const forcedStyle of ['spiderweb', 'starburst', 'mosaic']) {
      const pin = buildBulletHole({ shipId: id, seedKey: 1, idx: 1, singleLoss: 0.05, massive: false, kind: 'shell', zones, existing: [], forcedStyle })
      if (pin && !pin.edge) {
        assert.equal(pin.spallPolys.length, 0, `${forcedStyle} 擦伤不该有破口`)
        for (const [x, y] of pin.corePts) assert.ok(Math.hypot(x - pin.x, y - pin.y) <= 4, `${forcedStyle} 擦伤的弹核不许画成大圆盘`)
      }
      const big = buildBulletHole({ shipId: id, seedKey: 1, idx: 1, singleLoss: 0.6, massive: true, kind: 'shell', zones, existing: [], forcedStyle })
      if (big && !big.edge) {
        assert.ok(big.spallPolys.length >= 1, `${forcedStyle} 单发高伤要崩出破口`)
        assert.ok(big.shards.length >= 6 && big.shards.length <= 8, `${forcedStyle} 单发高伤飞出 ${big.shards.length} 块碎片`)
      }
    }
  }
})

test('上限：一个阶段最多新添 5 个弹孔，一轮带伤累计最多 7 个；放不下的不硬叠', () => {
  const { applyHitReport, emptyDamageState, HIT_CAPS } = load('hit-damage')
  const { rowZonesOf } = load('hit-glass')
  assert.equal(HIT_CAPS.holesPerStage, 5)
  assert.equal(HIT_CAPS.holesTotal, 7)
  const zones = rowZonesOf(layoutOf(760))
  const salvo = [2, 3, 3, 4, 4, 5, 5, 6, 6]
  const report = { shellHits: salvo, torpHits: [], aswHits: [], shellDmg: 38, torpDmg: 0, aswDmg: 0, totalDmg: 38, shellRatio: 1, torpRatio: 0, dominant: 'shell', fallback: false }
  for (const id of SHIPS.slice(0, 12)) {
    const first = applyHitReport({ shipId: id, state: emptyDamageState(1), report, before: 200, after: 162, max: 200, zones })
    assert.ok(first.newHoles.length <= 5, `#${id} 一阶段添了 ${first.newHoles.length} 个`)
    const heaviest = [...salvo].sort((a, b) => a - b).slice(-5)
    for (const hole of first.newHoles) assert.ok(heaviest.includes(Math.round(hole.singleLoss * 200)), `#${id} 命中太多时按最重的几发画`)
    const second = applyHitReport({ shipId: id, state: first.state, report, before: 162, after: 124, max: 200, zones })
    assert.ok(second.state.holes.length <= 7, `#${id} 累计 ${second.state.holes.length} 个`)
  }
})

test('鱼雷：不留弹孔，进水封顶 52%，破口侧（右侧）下沉＝正角；冲击峰值不超过 3.2°、常驻不超过 1.15°', () => {
  const { applyHitReport, emptyDamageState, HIT_CAPS } = load('hit-damage')
  const { rowZonesOf } = load('hit-glass')
  const zones = rowZonesOf(layoutOf(760))
  const torp = (dmg) => ({ shellHits: [], torpHits: [dmg], aswHits: [], shellDmg: 0, torpDmg: dmg, aswDmg: 0, totalDmg: dmg, shellRatio: 0, torpRatio: 1, dominant: 'torp', fallback: false })
  let state = emptyDamageState(1)
  let hp = 38
  for (const dmg of [10, 12, 9]) {
    const result = applyHitReport({ shipId: 102, state, report: torp(dmg), before: hp, after: hp - dmg, max: 38, zones })
    assert.equal(result.newHoles.length, 0, '鱼雷不留弹孔')
    assert.equal(result.motion.kind, 'torp')
    assert.ok(result.motion.leadMs > 0, '航迹先切入水线，冲击后挪')
    assert.ok(result.state.water <= HIT_CAPS.water, `进水 ${result.state.water}% 超过上限`)
    assert.ok(result.state.listDeg > 0 && result.state.listDeg <= 1.15, `常驻倾角 ${result.state.listDeg}`)
    assert.ok(result.motion.listPeak > 0 && result.motion.listPeak <= 3.2, `冲击峰值 ${result.motion.listPeak}`)
    assert.ok(result.state.listDeg >= state.listDeg, '倾角只增不减')
    state = result.state
    hp -= dmg
  }
  assert.equal(state.water, HIT_CAPS.water, '连吃三雷封顶')
})

test('炮雷混合：按战报占比各演各的——炮击那几发留弹孔，雷击那部分进水倾侧；雷击不到一半时按炮击后坐', () => {
  const { applyHitReport, emptyDamageState } = load('hit-damage')
  const { rowZonesOf } = load('hit-glass')
  const zones = rowZonesOf(layoutOf(760))
  const report = { shellHits: [9, 14], torpHits: [13], aswHits: [], shellDmg: 23, torpDmg: 13, aswDmg: 0, totalDmg: 36, shellRatio: 23 / 36, torpRatio: 13 / 36, dominant: 'mixed', fallback: false }
  const result = applyHitReport({ shipId: 103, state: emptyDamageState(1), report, before: 56, after: 20, max: 56, zones })
  assert.ok(result.newHoles.length >= 1 && result.newHoles.length <= 2)
  assert.ok(result.state.water > 0 && result.state.listDeg > 0)
  assert.equal(result.motion.kind, 'shell')
  assert.equal(result.state.dominant, 'mixed')
})

test('反潜：潜水舰只画耐压壳裂纹、轻微进水，深弹最多 3 颗，最后一颗起爆才扣血', () => {
  const { applyHitReport, emptyDamageState, HIT_CAPS } = load('hit-damage')
  const { aswDetonateAt } = load('fleet-fx-timing')
  const { rowZonesOf } = load('hit-glass')
  const zones = rowZonesOf(layoutOf(760))
  const report = { shellHits: [], torpHits: [], aswHits: [4, 5, 6, 3], shellDmg: 0, torpDmg: 0, aswDmg: 18, totalDmg: 18, shellRatio: 0, torpRatio: 0, dominant: 'asw', fallback: false }
  const result = applyHitReport({ shipId: 104, state: emptyDamageState(1), report, before: 24, after: 6, max: 24, zones })
  assert.equal(result.motion.kind, 'asw')
  assert.equal(result.motion.dropCount, 3)
  assert.equal(result.motion.leadMs, aswDetonateAt(3))
  assert.ok(aswDetonateAt(1) < aswDetonateAt(2) && aswDetonateAt(2) < aswDetonateAt(3))
  assert.ok(result.newHoles.length > 0 && result.newHoles.every((hole) => hole.kind === 'asw'))
  assert.ok(result.state.water > 0 && result.state.water <= HIT_CAPS.waterSub)
  assert.equal(result.state.listDeg, 0, '潜水舰不倾侧')
})

test('入渠逐孔逆向修补：轻的先修、最重的留到最后；每孔先收外环、再缩裂纹、最后闭合破口', () => {
  const { holeRepairState } = load('hit-glass')
  const { holes } = pound(106, 1, 760, [6, 30, 12], 48).state
  assert.ok(holes.length === 3)
  const order = [...holes].sort((a, b) => a.power - b.power || a.idx - b.idx)
  assert.ok(holes.every((hole) => holeRepairState(holes, hole, null).status === 'intact'), '不在渠不动')
  assert.ok(holes.every((hole) => holeRepairState(holes, hole, 0).status === 'intact'))
  assert.ok(holes.every((hole) => holeRepairState(holes, hole, 1).status === 'done'))
  const mid = holeRepairState(holes, order[0], 1 / 6)
  assert.equal(mid.status, 'healing')
  assert.ok(mid.ringRetract >= mid.rayRetract && mid.rayRetract >= mid.voidClose, '外环先收、裂纹次之、破口最后')
  assert.equal(holeRepairState(holes, order[2], 0.5).status, 'intact', '最重的那个还没轮到')
  let prev = -1
  for (let p = 0; p <= 1.0001; p += 0.05) {
    const done = holes.filter((hole) => holeRepairState(holes, hole, p).status === 'done').length
    assert.ok(done >= prev, '修好的只增不减')
    prev = done
  }
})

test('入渠扶正与抽水：0%→45% 倾角线性回正，积水随进度抽干', () => {
  const { dockListDeg, dockWater, dockKindOf } = load('hit-damage')
  assert.equal(dockListDeg(1.1, null), 1.1)
  assert.equal(dockListDeg(1.1, 0), 1.1)
  assert.ok(Math.abs(dockListDeg(1.1, 0.225) - 0.55) < 1e-9)
  assert.equal(dockListDeg(1.1, 0.45), 0)
  assert.equal(dockListDeg(1.1, 0.8), 0)
  assert.equal(dockWater(40, null), 40)
  assert.equal(dockWater(40, 0.5), 20)
  assert.equal(dockWater(40, 1), 0)
  assert.equal(dockKindOf(null, true), 'sub')
  assert.equal(dockKindOf({ water: 30, dominant: 'shell' }, false), 'torp', '积水多按抽水扶正')
  assert.equal(dockKindOf({ water: 0, dominant: 'torp' }, false), 'torp')
  assert.equal(dockKindOf({ water: 4, dominant: 'shell' }, false), 'shell')
})

test('玻璃层 SVG：内容区蒙版压浅、破口从裂纹层镂空、裂纹 pathLength=100；焊修光只沿裂纹与破口棱边，不画圆环', () => {
  const { hitGlassSvg } = load('hit-glass')
  const { state, zones } = pound(105, 1, 760, [8, 30, 14], 60)
  const intact = hitGlassSvg({ id: 105, holes: state.holes, tier: 'heavy', zones, progress: null })
  assert.match(intact, /<mask id="glass-safe-105">[^]*fill="rgb\(84,84,84\)"/, '内容区下的裂纹压到约三成')
  assert.match(intact, /<mask id="glass-void-105">[^]*class="hole-void-cut"/, '破口在 void mask 里镂空')
  assert.match(intact, /<g mask="url\(#glass-void-105\)">/)
  assert.match(intact, /class="hole-ray[^"]*"[^>]*pathLength="100"[^>]*stroke-dasharray="100 100"/)
  for (const progress of [0.2, 0.5, 0.8]) {
    const healing = hitGlassSvg({ id: 105, holes: state.holes, tier: 'heavy', zones, progress })
    for (const circle of healing.match(/<circle[^>]*>/g) ?? []) {
      assert.match(circle, /r="(?:0\.\d+|1\.\d+)"/, `只有针孔核的亮芯是圆，半径 1 上下：${circle}`)
      assert.doesNotMatch(circle, /stroke/, '不许画描边圆环')
    }
  }
  assert.equal(hitGlassSvg({ id: 105, holes: state.holes, tier: 'heavy', zones, progress: 1 }), '', '全修好就没有玻璃层')
  assert.equal(hitGlassSvg({ id: 105, holes: [], tier: 'heavy', zones, progress: null }), '')
})

test('进水液面：右侧（破口侧）更深；入渠扶正回 0° 时液面变平；水线上间歇有浪来回横穿整行', () => {
  const { hitWaterHtml } = load('hit-glass')
  const read = (html) => ({ top: Number(html.match(/--water-top:(-?[\d.]+)px/)[1]), tilt: Number(html.match(/--water-tilt:(-?[\d.]+)deg/)[1]) })
  const listed = hitWaterHtml({ level: 40, listNow: 1, listBase: 1, docked: false, width: 600, height: H })
  assert.ok(read(listed).tilt < 0, `液面往右升（右侧更深）：tilt ${read(listed).tilt}`)
  assert.match(listed, /^<span class="water-body"[^>]*><i class="surface"><\/i><i class="swell" style="[^"]+"><\/i><\/span>$/)
  const righted = hitWaterHtml({ level: 40, listNow: 0, listBase: 1, docked: true, width: 600, height: H })
  assert.equal(read(righted).tilt, 0, '扶正后液面水平')
  assert.match(righted, /class="water-body dock"/, '入渠里的水用入渠色')
  assert.ok(read(hitWaterHtml({ level: 50, listNow: 0, listBase: 0, docked: false, width: 600, height: H })).top < read(hitWaterHtml({ level: 20, listNow: 0, listBase: 0, docked: false, width: 600, height: H })).top, '水越多液面越高')
  assert.equal(hitWaterHtml({ level: 0.2, listNow: 0, listBase: 0, docked: false, width: 600, height: H }), '')
  // 浪（他 11-28 连报四次，见样式表注释）：浪是水线自己的一段起伏，间歇地从一端走到另一端再走回来；
  // 周期与错相按舰稳定随机，同一艘每次一样，换一艘就不一样
  const swellOf = (html) => {
    const m = html.match(/class="swell" style="--rt:([\d.]+)s;--rd:(-?[\d.]+)s"/)
    return { period: Number(m[1]), delay: Number(m[2]) }
  }
  const seeded = (seed) => hitWaterHtml({ level: 40, listNow: 1, listBase: 1, docked: false, width: 600, height: H, seed })
  assert.equal(seeded(105), seeded(105), '同一艘逐字节一样，重画不打断正在走的浪')
  assert.notEqual(seeded(105), seeded(106), '不同的舰浪不在同一拍')
  const periods = Array.from({ length: 40 }, (_, i) => swellOf(seeded(200 + i)))
  assert.ok(periods.every((s) => s.period >= 13 && s.period <= 19 && s.delay <= 0 && -s.delay < s.period * 2), '单程 13～19s，错相落在一来一回之内')
  const css = fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8')
  const rule = (selector) => css.slice(css.indexOf(`${selector} {`), css.indexOf('\n    }', css.indexOf(`${selector} {`)))
  const swell = rule('.fleet-skin .ship .water-body > .swell')
  // 与静水面是同一条线：水线只有这一条（水体不再另画顶边），平的部分与起伏同一个元素、同一个颜色
  assert.doesNotMatch(rule('.fleet-skin .ship .water-body > .surface'), /border/, '水体不另画水线，免得浪下面还压着一条平线')
  assert.match(swell, /left: calc\(-100% - 140px\); width: calc\(200% \+ 140px\);/, '水线左右各一行宽的平线，中间 140px 起伏')
  assert.match(swell, /linear-gradient\(black, black\) 0 7px \/ calc\(50% - 70px\) 1px no-repeat, linear-gradient\(black, black\) 100% 7px \/ calc\(50% - 70px\) 1px no-repeat, url\(/, '两段平线接在起伏两头')
  assert.match(swell, /M0 7\.5C[^']*140 7\.5'/, '起伏首尾都落在水线上，两头收平')
  assert.doesNotMatch(swell, /linear-gradient\(90deg/, '不靠淡出收两头')
  assert.match(swell, /animation: ru-water-slosh var\(--rt\) linear var\(--rd\) infinite alternate;/, '走到另一端后原路走回来')
  const slosh = css.slice(css.indexOf('@keyframes ru-water-slosh {'), css.indexOf('}\n    }', css.indexOf('@keyframes ru-water-slosh {')))
  assert.match(slosh, /0%, 20% \{ transform: translate3d\(0, 0, 0\); \}/, '起点停一阵')
  assert.match(slosh, /65%, 100% \{ transform: translate3d\(calc\(50% \+ 70px\), 0, 0\);/, '平移半条＝一行宽＋起伏宽：从行左端外走到右端外')
  assert.doesNotMatch(slosh, /opacity/, '不在半路淡入淡出')
  // 起伏高低不齐：浪峰（y 最小处）一个比一个高到中间、再往两头矮下去，不是等高的一排
  const wavePath = swell.match(/d='([^']+)'/)[1] // -webkit-mask 与 mask 各写一遍，取一次
  const crests = [...`${wavePath}'`.matchAll(/ (\d+) ([\d.]+)(?=C|')/g)].map((m) => [Number(m[1]), Number(m[2])]).filter(([, y]) => y < 7.5)
  assert.ok(crests.length >= 4, `起伏至少四个浪峰：${crests.length}`)
  assert.ok(new Set(crests.map(([, y]) => y)).size === crests.length, '浪峰高度各不相同')
  const tallest = crests.reduce((a, c) => (c[1] < a[1] ? c : a))
  assert.ok(tallest[0] > 50 && tallest[0] < 90, `最高的浪峰在中段：x=${tallest[0]}`)
  assert.match(css, /\.fleet-skin \.ship \.water-host \{[^}]*overflow: hidden;/, '行外那段被裁掉')
  assert.doesNotMatch(css, /\.water-body > \.(?:wave-[ab]|ripple)|ru-water-(?:roll|ripple|swell|phase)/, '整条滚动的正弦波、原地鼓起的涟漪、另画在水线上的浪串都已退役')
})

test('常驻循环动画只动 transform / opacity（合成线程，不逐帧重排重绘）：行级脉动、进水涟漪、焊修扫描', () => {
  // 2026-11-27 实测（无头 Chrome，12 排大破）：脉动原先动 box-shadow，每秒绘制 113ms；焊修扫描动 left，一条每秒重排约 48ms；
  // 进水动 SVG 里的 <g>，每帧重做 SVG 布局。改成只动 transform / opacity 后这几项归零
  const css = fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8')
  for (const name of ['ru-mid-breath', 'ru-heavy-heartbeat', 'ru-dock-recover', 'ru-water-slosh', 'ru-dock-scan', 'ru-dock-derust']) {
    const at = css.indexOf(`@keyframes ${name} {`)
    assert.ok(at >= 0, name)
    let depth = 0
    let end = css.indexOf('{', at)
    for (; end < css.length; end++) {
      if (css[end] === '{') depth++
      else if (css[end] === '}' && --depth === 0) break
    }
    const props = [...css.slice(at, end).matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1])
    assert.deepEqual([...new Set(props)].filter((p) => p !== 'transform' && p !== 'opacity'), [], `${name} 只许动 transform / opacity`)
  }
  assert.doesNotMatch(css, /\.fleet-skin \.ship\[data-crack="(?:medium|heavy)"\] \{[^}]*animation:/, '脉动不再挂在行上（挂在 ::after）')
})

test('头像裁角与故障错相：同舰同种子稳定、换舰或新受伤周期分化', () => {
  const { hitAvatarCssVars, hitAvatarVars } = load('hit-glass')
  assert.equal(hitAvatarCssVars(101, 1), hitAvatarCssVars(101, 1))
  assert.notEqual(hitAvatarCssVars(101, 1), hitAvatarCssVars(102, 1))
  assert.notEqual(hitAvatarCssVars(101, 1), hitAvatarCssVars(101, 2))
  for (let id = 1; id <= 30; id++) {
    const v = hitAvatarVars(id, id * 7)
    assert.match(v.fcClipHeavy, /^polygon\(/)
    assert.match(v.fcClipSunk, /^polygon\(/)
    assert.ok(v.gDelay < 0 && Math.abs(v.gDelay) < v.gDur)
  }
})

test('样式表：开关作用域里不给编队行本身和数据列加 clip-path（弹孔只切底色与特效层）', () => {
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
      if (!/\[data-(?:hit|crack|fracture|glass|repair|weld|listed|dock)/.test(sel) && !/data-hit-fx/.test(sel)) continue
      const last = sel.split(/\s*>\s*|\s+/).filter(Boolean).pop()
      if (DATA.test(last)) bad.push(sel)
    }
  }
  assert.deepEqual(bad, [], '这些选择器会把数据列或整行裁掉（弹孔只许切底色与特效层）')
})

test('样式表：数据列压在进水层与玻璃层上面；鱼雷倾侧、反潜浮沉与冲击后挪都在开关作用域的属性上，减少动态时不播', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8')
  assert.match(css, /\.fleet-skin \.ship \.water-host \{[^}]*z-index: 1;/)
  assert.match(css, /\.fleet-skin \.ship \.glass-host \{[^}]*z-index: 2;/)
  assert.match(css, /\.fleet-skin \.ship\[data-listed="1"\] \{[^}]*rotate\(var\(--list-deg/)
  assert.match(css, /@keyframes ru-hit-list \{[^]*?100% \{ transform: translate3d\(0, var\(--list-y, 0px\), 0\) rotate\(var\(--list-deg, 0deg\)\); \}/, '倾侧落定在常驻倾角')
  assert.match(css, /@keyframes ru-hit-shake-4 \{\s*0%, 100% \{ transform: translate3d\(0, var\(--list-y, 0px\), 0\) rotate\(var\(--list-deg, 0deg\)\); \}/, '倾着的行挨炮，抖完落回原倾角')
  assert.match(css, /\.ship\[data-hit\]\[data-hit-kind="asw"\] \{[^}]*ru-hit-heave[^}]*var\(--hit-lead, 0ms\)/)
  const reduced = css.slice(css.indexOf('.fleet-skin .ship.left.leaving,'))
  const list = reduced.slice(0, reduced.indexOf('{ animation: none; }'))
  for (const selector of ['.ship[data-hit][data-hit-kind="torp"],', '.ship[data-hit][data-hit-kind="asw"],', '.ship[data-crack]::after,', '.ship .water-body > i,']) {
    assert.ok(list.includes(selector), `减少动态时要停：${selector}`)
  }
  assert.match(reduced, /\.fleet-skin \.ship \.dock-weld-scan,\s*\.fleet-skin \.ship \.dock-derust,\s*\.fleet-skin \.ship \.dock-sub-bubble \{ display: none; \}/, '减少动态时不扫光、不除锈、不冒泡')
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
  assert.deepEqual(fx.get(1), { kind: 'dock', before: 10, after: 40, max: 40, bucket: false })
  assert.deepEqual(fx.get(2), { kind: 'dock', before: 12, after: 40, max: 40, bucket: true }, '没进过渠就修满＝入渠当场泼了桶')
})

test('母港：在渠里离预计修好还早就修满出来＝泼了高速修复桶；到点（含几十秒抖动）出来＝自然出渠', () => {
  const { createRepairWatch, BUCKET_EARLY_MS } = load('repair-fx')
  const now = 1_000_000_000
  const watch = createRepairWatch()
  watch.observe([
    ship(1, 10, { docked: true, dockCompleteAt: now + 3_600_000 }),
    ship(2, 10, { docked: true, dockCompleteAt: now - 5_000 }),
    ship(3, 10, { docked: true, dockCompleteAt: now + BUCKET_EARLY_MS - 1_000 }),
  ], { sortie: false, now: now - 60_000 })
  const fx = watch.observe([ship(1, 40), ship(2, 40), ship(3, 40)], { sortie: false, now })
  assert.equal(fx.get(1).bucket, true, '还差一小时就出来了')
  assert.equal(fx.get(2).bucket, false, '到点出渠')
  assert.equal(fx.get(3).bucket, false, '只早了不到一分半，按自然出渠')
})

test('入渠维修进度：1 − 剩余 / 总工时；拿不到总工时或预计修好时刻给 null，不猜', () => {
  const { dockRepairProgress } = load('repair-fx')
  assert.equal(dockRepairProgress(10_000, 8_000, 6_000), 0.5)
  assert.equal(dockRepairProgress(10_000, 8_000, 2_000), 0)
  assert.equal(dockRepairProgress(10_000, 8_000, 10_000), 1)
  assert.equal(dockRepairProgress(10_000, 8_000, 12_000), 1, '过点不超过 1')
  assert.equal(dockRepairProgress(10_000, 4_000, 0), 0, '剩余比总工时还长按 0')
  assert.equal(dockRepairProgress(10_000, 0, 6_000), null)
  assert.equal(dockRepairProgress(0, 8_000, 6_000), null)
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
    damageStates: new Map(),
    isSubShip: () => false,
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
    damageStates: new Map(),
    isSubShip: () => false,
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

test('带伤入渠：行挂 data-docked 与入渠特色层，红黄告警与故障撤掉、换成缓慢脉冲的恢复光；弹孔照留', () => {
  // 维护者裁决 2026-11-26：入渠期间裂纹保留（②），告警换恢复光（同日）；交接包 v2：特色层按伤势种类，弹孔随进度收口
  const { state } = pound(5, 1, 540, [8, 14], 40)
  let docked = true
  const { api } = runtimeHost().extract('src/renderer/modules/ru.ts', ['shipGlassFx'], {
    Date: { now: () => 1000 },
    hitShakeEnabled: () => true,
    shipHitCrack: () => 'heavy',
    dockOf: () => (docked ? { id: 1 } : null),
    isSubShip: () => false,
    weldedShips: new Set(),
    pendingRepairFx: new Map(),
    repairWashUntil: new Map(),
    damageStates: new Map([[5, state]]),
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
  assert.match(fx.attrs, /data-dock-kind="shell"/, '炮击伤入渠：逐孔焊修')
  assert.match(fx.layers, /<span class="dock-fx-layer"><span class="dock-weld-scan"><\/span><\/span>/)
  assert.match(fx.layers, /<svg class="glass-svg"/, '弹孔照留（拿不到维修进度时整片不动）')
  assert.doesNotMatch(api.shipGlassFx(ship, true).attrs, /data-docked/, '击沉不挂')
  docked = false
  assert.doesNotMatch(api.shipGlassFx(ship, false).attrs, /data-docked/, '没入渠不挂')

  const css = fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8')
  assert.match(css, /\.ship\[data-docked="1"\]\[data-crack\] :is\(\.dmg-hazard, \.dmg-scan, \.dmg-ember, \.glitch-bars\) \{ display: none; \}/)
  assert.match(css, /\.ship\[data-docked="1"\]\[data-crack\]::after \{[^}]*var\(--hit-aqua\)[^}]*animation: ru-dock-recover 4\.2s ease-in-out infinite;/, '恢复光脉动挂在 ::after、只调透明度')
  assert.match(css, /\.ship\[data-docked="1"\]\[data-crack\] \.hpc \.num \.st \{ animation: none; \}/, '大破徽标不再故障闪')
  const reduced = css.slice(css.indexOf('.fleet-skin .ship.left.leaving,'))
  assert.ok(reduced.slice(0, reduced.indexOf('{ animation: none; }')).includes('.ship[data-docked="1"][data-crack],'), '减少动态时恢复光不脉冲')
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

// ---- 五、审查修正（2026-11-27）：开关关着零变化、维修进度不让面板一直换 DOM、总工时不跨入渠沿用 ----

test('开关关着：在渠血条照旧是 45% 示意；开着才按维修进度画', async () => {
  const { reset, renderRow, setDock, setGlassFx, setHitCrack, setHitFracture, setHitShake } = await import('./fixtures/render-ru-row.mjs')
  reset({ names: { 1: '吹雪' } })
  setHitShake({})
  setHitCrack({})
  setHitFracture({})
  setGlassFx({})
  setDock({ 5: { completeTime: 2_000_000_000_000 } }, false)
  assert.match(renderRow({ id: 5, shipId: 1, nowhp: 10 }), /<div class="bar"><i style="width:45%"><\/i><\/div>/, '开关关着')
  setDock({ 5: { completeTime: 2_000_000_000_000 } }, true)
  assert.match(renderRow({ id: 5, shipId: 1, nowhp: 10 }), /<div class="bar"><i style="width:77%"><\/i><\/div>/, '开关开着：按真实维修进度')
  setDock({}, false)
})

test('维修进度：画进 HTML 的只按 10% 取整（无关重画不换 DOM），就地刷新按 1%；总工时只在同一次入渠里沿用', () => {
  let now = 0
  const dockSeen = new Map()
  const { api } = runtimeHost().extract('src/renderer/modules/ru.ts', ['dockProgressOf', 'DOCK_LIVE_STEP'], { dockSeen, Date: { now: () => now } })
  const ship = { id: 5, ndockTime: 10_000 }
  const dock = { completeTime: 10_000 }
  now = 3_700
  assert.equal(api.dockProgressOf(ship, dock), 0.3, '渲染用 10% 一档')
  assert.equal(api.dockProgressOf(ship, dock, now, api.DOCK_LIVE_STEP), 0.37, '就地刷新用 1%')
  now = 3_999
  assert.equal(api.dockProgressOf(ship, dock), 0.3, '同一档里再画一次，输出不变')
  // 报文在渠期间把总工时改小了：同一次入渠沿用记下的
  dockSeen.set(5, { completeTime: 10_000, total: 10_000 })
  assert.equal(api.dockProgressOf({ id: 5, ndockTime: 0 }, dock, 5_000, api.DOCK_LIVE_STEP), 0.5)
  // 泼桶后又挨打、重新入渠 20 分钟：预计修好时刻变了，不再拿上一次 6 小时的总工时算（否则一进渠就快修完了）
  dockSeen.set(5, { completeTime: 10_000, total: 6 * 3_600_000 })
  assert.equal(api.dockProgressOf({ id: 5, ndockTime: 1_200_000 }, { completeTime: 1_200_000 }, 0, api.DOCK_LIVE_STEP), 0)
})

test('减少动态效果：炮击 4 档后坐、大破行的后坐与心跳、头像顿挫也停（选择器比 [data-hit] 更具体，单列出来）', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8')
  const reduced = css.slice(css.indexOf('.fleet-skin .ship.left.leaving,'))
  const list = reduced.slice(0, reduced.indexOf('{ animation: none; }'))
  for (const selector of ['.fleet-skin .ship[data-hit][data-hit-sev],', '.fleet-skin .ship[data-hit][data-hit-sev] .fc,', '.fleet-skin .ship[data-hit][data-crack="heavy"],']) {
    assert.ok(list.includes(selector), `减少动态时要停：${selector}`)
  }
})

test('玻璃层宽度钉成像素：行宽变了弹孔原地不动、不被拉扁', () => {
  const { hitGlassSvg } = load('hit-glass')
  const { state, zones } = pound(7, 1, 760, [8, 12], 40)
  assert.match(hitGlassSvg({ id: 7, holes: state.holes, tier: 'medium', zones, progress: null }), /^<svg class="glass-svg" viewBox="0 0 760 46" preserveAspectRatio="none" style="width:760px">/)
})

test('开幕入场优先：带伤 / 入渠 / 被弹的舰娘行挂着自己的循环动画，入场期间也要先跟着一排排落位（2026-11-27 他报开门就已在场上）', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8')
  const at = css.indexOf("@media not (prefers-reduced-motion: reduce) {\n      .ws-pane.mod-ru .ships .ship[data-kuma-in='roster'] {")
  assert.ok(at >= 0, '入场优先那条要在「不减少动态」里，减少动态时整套入场本来就不播')
  const rule = css.slice(at, css.indexOf('}', css.indexOf('{', at + 50)))
  assert.match(rule, /animation-name: kuma-roster-row !important;/, '压过带伤行更具体的 animation 简写')
  assert.match(rule, /animation-iteration-count: 1 !important;/, '不能沿用心跳 / 呼吸的 infinite')
  assert.match(rule, /animation-fill-mode: both !important;/, '轮到之前停在首帧（透明）')
  assert.doesNotMatch(rule, /animation-(?:delay|duration)/, '起点与时长由 launch-glow 写在行内，这里不碰')
})

test('擦伤（没到小破线）也有弹孔 / 进水：行挂 data-glass，拿到定位、数据列压在上面，弹孔不被画到列表顶上（2026-11-27 白露）', () => {
  const { state } = pound(9, 1, 760, [4], 31)
  const { api } = runtimeHost().extract('src/renderer/modules/ru.ts', ['shipGlassFx'], {
    Date: { now: () => 1000 },
    hitShakeEnabled: () => true,
    shipHitCrack: () => null,
    dockOf: () => null,
    isSubShip: () => false,
    weldedShips: new Set(),
    pendingRepairFx: new Map(),
    repairWashUntil: new Map(),
    damageStates: new Map([[9, state]]),
    berthFxFlagIds: new Set(),
    berthFxRepairIds: new Set(),
    berthFadeFlag: new Map(),
    berthFadeRepair: new Map(),
    activeTransientAura: () => null,
    cachedRowWidth: 760,
    cachedRowHeight: 46,
  })
  const fx = api.shipGlassFx({ id: 9, nowhp: 27, maxhp: 31 }, false)
  assert.match(fx.attrs, /^ data-glass/)
  assert.match(fx.layers, /<svg class="glass-svg"/)
  const css = fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8')
  assert.match(css, /\.fleet-skin \.ship\[data-glass\],[^{]*\{\s*position: relative; isolation: isolate;/, '行要成为定位与层叠的容器')
  assert.match(css, /\.fleet-skin \.ship\[data-glass\] > :is\(\.fc, \.who, \.hpc, \.fa2, \.cond, \.eq, \.ship-detail\),[^{]*\{\s*position: relative; z-index: 3;/, '数据列压在玻璃与进水层上面')
})

// ---- 六、重启后照账本重放（2026-11-27 他报「受到伤害的次数跟弹孔不对应」：原先一律按伤势档补 1～3 个默认弹孔） ----

const chainBattle = (hpStart, hpEnd, damages, { practice = false, max = 31 } = {}) => ({
  practice,
  fShips: [{ index: 0, rosterId: 7, hpStart, hpEnd, hpMax: max }],
  eShips: [{ index: 0, mstId: 1501 }],
  attacks: damages.map((damage, i) => ({ phase: 'gun1', side: 1, attacker: 0, stage: i + 1, action: 0, ciKind: null, ciType: null, hits: [{ target: 0, damage }] })),
})

test('照账本找这一轮带伤：从最近一场往回接，接到满血开场为止；逐场重放，弹孔与命中逐发对应', () => {
  const { damageChainOf, replayDamageChain } = load('hit-damage')
  const { rowZonesOf } = load('hit-glass')
  const b1 = chainBattle(31, 27, [3, 1])
  const b2 = chainBattle(27, 27, [])
  const b3 = chainBattle(27, 24, [2, 1])
  const older = chainBattle(31, 31, [])
  const chain = damageChainOf([b3, b2, b1, older], { id: 7, nowhp: 24, maxhp: 31 })
  assert.equal(chain.status, 'done')
  assert.deepEqual(chain.battles, [b1, b2, b3], '从早到晚，满血开场那场之前的不要')
  const state = replayDamageChain(chain.battles, 7, { seedKey: 1, zones: rowZonesOf(layoutOf(1040)), stypeOf: () => 2, targetStype: 2 })
  assert.equal(state.holes.length, 4, '挨了四下就是四个弹孔')
})

test('照账本找这一轮带伤：中途回过血（泊修）、最大耐久对不上就算接不上；找不到满血开场时给出已接上的几场；演习跳过', () => {
  const { damageChainOf } = load('hit-damage')
  const ship = { id: 7, nowhp: 24, maxhp: 31 }
  assert.equal(damageChainOf([chainBattle(28, 24, [4]), chainBattle(31, 26, [5])], ship).status, 'broken', '26 → 28 中间回过血')
  assert.equal(damageChainOf([chainBattle(28, 25, [3])], ship).status, 'broken', '最近一场的终局血量不是现在的血量')
  assert.equal(damageChainOf([chainBattle(31, 24, [7], { max: 33 })], ship).status, 'broken')
  const open = damageChainOf([chainBattle(28, 24, [4]), chainBattle(30, 28, [2])], ship)
  assert.equal(open.status, 'open')
  assert.equal(open.battles.length, 2)
  assert.equal(open.startHp, 30, '链头之前的伤（31 → 30）补默认碎裂')
  assert.equal(damageChainOf([chainBattle(31, 10, [21], { practice: true }), chainBattle(31, 24, [7])], ship).status, 'done', '演习不改耐久，跳过')
})
