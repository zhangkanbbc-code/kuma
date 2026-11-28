// 历史战损（维护者 2026-11-28 定）：返港后弹孔转成四角碎裂、积水抽干转成锈渍，入渠按进度原路缩回 / 除净。
// 「四角碎裂会随伤害累计……最大伤害的展示会大致让左右两边的上下碎裂重合形成那种『一个玻璃板摔碎两边』的感觉」
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const load = (name) => require(path.join(ROOT, 'dist', 'shared', `${name}.js`))
const scar = load('hit-scar')
const damage = load('hit-damage')
const glass = load('hit-glass')

const W = 1000
const H = 46
const zones = glass.rowZonesOf({ width: W, height: H, whoRight: 300 })
const CORNERS = ['lt', 'lb', 'rt', 'rb']

test('四角碎裂随伤害累计、跟着伤势档：擦伤一角、小破两角、中破三角、再深四角；每个角只长不缩，到大破线全部长满', () => {
  for (const seed of [1, 2, 3, 7, 19]) {
    const geo = scar.scarGeometry(105, seed, W, H)
    assert.deepEqual([...geo.order].sort(), [...CORNERS].sort(), '四个角都在、各一次')
    let prev = scar.scarExtents(geo, 0)
    assert.ok(CORNERS.every((c) => prev[c] === 0), '没伤就没有')
    for (let loss = 0.01; loss <= 1.0001; loss += 0.01) {
      const cur = scar.scarExtents(geo, loss)
      for (const c of CORNERS) assert.ok(cur[c] >= prev[c] - 1e-9, `${c} 在缺失 ${loss.toFixed(2)} 时缩了`)
      prev = cur
    }
    const lit = (loss) => CORNERS.filter((c) => scar.scarExtents(geo, loss)[c] > 0).length
    assert.deepEqual([0.05, 0.2, 0.25, 0.45, 0.5, 0.6].map(lit), [1, 1, 2, 2, 3, 4], '擦伤 1、小破 2、中破 3、再深 4')
    assert.ok(['rt', 'rb'].includes(geo.order[0]), '第一个角在右端（左端压着头像）')
    assert.ok(['lt', 'lb'].includes(geo.order[1]), '第二个角在左端')
    // 一亮起就看得清（他 11-28 看实机「没有补状态呀」：擦伤只有几个像素）
    const first = scar.scarExtents(geo, 0.03)[geo.order[0]]
    assert.ok(first >= 0.45, `擦伤那一角一亮起就长到 ${first}`)
    assert.ok(scar.scarParts(first).chip >= 0.5, '碎角一亮起就有一半大')
    assert.ok(CORNERS.every((c) => scar.scarExtents(geo, scar.SCAR_FULL_LOSS)[c] === 1), '大破线全部长满')
  }
})

test('最大伤害：左右两头各自的上下主裂在中段接上（玻璃板摔碎两头），之前接不上；碎裂都贴着两端', () => {
  for (const seed of [1, 4, 9, 23]) {
    const geo = scar.scarGeometry(311, seed, W, H)
    for (const side of ['l', 'r']) {
      const top = geo.corners[`${side}t`].main
      const bot = geo.corners[`${side}b`].main
      assert.deepEqual(top.at(-1), bot.at(-1), `${side} 端上下两道主裂终点重合`)
      const meetY = top.at(-1)[1]
      assert.ok(meetY > H * 0.3 && meetY < H * 0.7, '在中段接上')
      const fromEdge = (x) => (side === 'l' ? x : W - x)
      for (const corner of [`${side}t`, `${side}b`]) {
        const g = geo.corners[corner]
        assert.ok(g.main.every(([x]) => fromEdge(x) <= 32), `${corner} 主裂贴着端边`)
        assert.ok(g.chip.every(([x]) => fromEdge(x) <= 36), `${corner} 碎角在角上`)
        assert.ok([...g.branches[0], ...g.branches[1]].every(([x]) => fromEdge(x) <= 130), `${corner} 支裂不伸到行中段`)
      }
    }
    const ext = (loss) => scar.scarExtents(geo, loss)
    const merged = (loss, side) => scar.scarMerge(ext(loss)[`${side}t`], ext(loss)[`${side}b`])
    assert.equal(merged(0.5, 'l') + merged(0.5, 'r'), 0, '中破还没摔碎两头')
    assert.equal(merged(0.75, 'l'), 1)
    assert.equal(merged(0.75, 'r'), 1)
  }
})

test('四角碎裂的标记：同一份伤逐字节一样；伤加重只把每条裂纹画长、碎角放大，几何不跳位', () => {
  const svg = (loss, seedKey = 3) => scar.hitScarSvg({ id: 105, shipId: 105, seedKey, zones, loss })
  assert.equal(svg(0), '')
  assert.equal(svg(0.4), svg(0.4))
  assert.notEqual(svg(0.4, 3), svg(0.4, 4), '换一轮带伤（种子）换一套')
  const offsets = (html) => new Map([...html.matchAll(/data-scar="([^"]+)" pathLength="100" d="([^"]+)"[^>]*stroke-dashoffset="([\d.]+)"/g)].map((m) => [m[1], { d: m[2], off: Number(m[3]) }]))
  let prev = offsets(svg(0.1))
  for (const loss of [0.2, 0.35, 0.5, 0.65, 0.75]) {
    const cur = offsets(svg(loss))
    for (const [key, { d, off }] of prev) {
      assert.ok(cur.has(key), `${key} 到缺失 ${loss} 不见了`)
      assert.equal(cur.get(key).d, d, `${key} 的路径跳位了`)
      assert.ok(cur.get(key).off <= off + 1e-9, `${key} 缩回去了`)
    }
    prev = cur
  }
  assert.match(svg(0.75), /class="scar-facet"/, '两头接上时碎板显出来')
  assert.doesNotMatch(svg(0.4), /class="scar-facet"/)
  assert.match(svg(0.4), /<mask id="scar-safe-105">/, '内容列下面压淡')
})

test('锈渍：旧水线上一道断续的锈痕、贴着它的碎锈点与往下淌的锈迹，按 (舰, 种子) 稳定；水线越高越密；入渠时只调浓淡', () => {
  const rust = (level, strength = 1, seedKey = 2) => scar.hitRustSvg({ shipId: 105, seedKey, width: W, height: H, level, strength })
  assert.equal(rust(0), '')
  assert.equal(rust(30, 0), '')
  assert.equal(rust(30), rust(30))
  assert.notEqual(rust(30, 1, 2), rust(30, 1, 3))
  const spots = (html) => (html.match(/<ellipse /g) ?? []).length
  assert.ok(spots(rust(50)) > spots(rust(10)), '积过的水越多锈斑越密')
  assert.match(rust(30, 0.4), /class="rust-svg"[^>]*opacity="0\.40"/)
  const lineY = H * (1 - 30 / 100)
  for (const m of rust(30).matchAll(/<ellipse cx="[\d.]+" cy="([\d.]+)"/g)) {
    const dy = Number(m[1]) - lineY
    assert.ok(dy >= -1.5 && dy <= 4, `碎锈点贴着潮线、偏下方：${dy}`)
  }
  const tide = [...rust(30).matchAll(/<polyline points="([^"]+)"/g)].map((m) => m[1].split(' ').map((pt) => pt.split(',').map(Number)))
  assert.ok(tide.length >= 3, '潮线是断断续续的几段')
  assert.ok(tide.flat().every(([, y]) => Math.abs(y - lineY) <= 1.5), '潮线就在旧水线上')
})

test('返港：弹孔收口、积水抽干、倾侧扶正，四角碎裂长到现在的缺失血量，锈线取历次最高液面', () => {
  const { returnToPort, emptyDamageState } = damage
  const state = { ...emptyDamageState(5), holes: [{ idx: 1 }], water: 34, listDeg: 0.9, dominant: 'torp', scar: 0.1, rust: 20 }
  const next = returnToPort(state, 12, 40)
  assert.deepEqual(next, { ...state, holes: [], water: 0, listDeg: 0, scar: 0.7, rust: 34, current: 0 })
  assert.equal(returnToPort({ ...next, water: 12 }, 12, 40).rust, 34, '这次积的水没上次高，锈线不降')
  assert.equal(next.seedKey, 5, '同一轮带伤，种子不换')
})

test('没有逐发战报：只按缺失血量给四角碎裂，不编弹孔和积水', () => {
  const { syntheticDamageState } = damage
  assert.deepEqual(syntheticDamageState(3, 20, 40, false), syntheticDamageState(3, 20, 40, false))
  const s = syntheticDamageState(3, 10, 40, false)
  assert.equal(s.holes.length, 0)
  assert.equal(s.water, 0)
  assert.equal(s.scar, 0.75)
  assert.equal(syntheticDamageState(3, 40, 40, false).scar, undefined, '满血什么都没有')
  assert.equal(syntheticDamageState(3, 10, 40, true).dominant, 'asw')
})

const chainBattle = (hpStart, hpEnd, damages, { max = 31 } = {}) => ({
  practice: false,
  fShips: [{ index: 0, rosterId: 7, hpStart, hpEnd, hpMax: max }],
  eShips: [{ index: 0, mstId: 1501 }],
  attacks: damages.map((d, i) => ({ phase: 'gun1', side: 1, attacker: 0, stage: i + 1, action: 0, ciKind: null, ciType: null, hits: [{ target: 0, damage: d }] })),
})

test('重启后照账本按出击分段：之前出击的弹孔在段尾转成四角碎裂，只有眼下这次出击的还是弹孔；在港时全部转掉', () => {
  const deps = { seedKey: 1, zones, stypeOf: () => 2, targetStype: 2 }
  const a1 = chainBattle(31, 27, [3, 1])
  const a2 = chainBattle(27, 24, [2, 1])
  const b1 = chainBattle(24, 20, [4])
  const sortieOf = (battle) => (battle === b1 ? 11 : 10)
  const inSortie = damage.replayDamageChain([a1, a2, b1], 7, deps, undefined, { sortieOf, current: 11 })
  assert.equal(inSortie.holes.length, 1, '眼下这次出击挨的一下是弹孔')
  assert.equal(inSortie.scar, damage.returnToPort(inSortie, 24, 31).scar, '上一次出击返港时的缺失血量')
  assert.ok(Math.abs(inSortie.scar - (1 - 24 / 31)) < 0.01)
  const inPort = damage.replayDamageChain([a1, a2, b1], 7, deps, undefined, { sortieOf, current: null })
  assert.equal(inPort.holes.length, 0, '在港：全是历史战损')
  assert.ok(Math.abs(inPort.scar - (1 - 20 / 31)) < 0.01)
  const legacy = damage.replayDamageChain([a1, a2, b1], 7, deps)
  assert.equal(legacy.holes.length, 5, '不分段时照旧逐发')
})

test('入渠：四角碎裂按维修进度原路缩回（与血条同步），锈渍前七成进度里除净；入渠特色按锈渍挑除锈', () => {
  assert.equal(damage.dockScar(0.6, null), 0.6)
  assert.equal(damage.dockScar(0.6, 0.5), 0.3)
  assert.equal(damage.dockScar(0.6, 1), 0)
  assert.equal(damage.dockRustStrength(null), 1)
  assert.equal(damage.dockRustStrength(0.35), 0.5)
  assert.equal(damage.dockRustStrength(0.7), 0)
  assert.equal(damage.dockKindOf({ water: 0, rust: 30, dominant: 'shell' }, false), 'torp', '锈重的修锈')
  assert.equal(damage.dockKindOf({ water: 0, rust: 4, dominant: 'shell' }, false), 'shell')
})

test('样式表：四角碎裂与锈渍有层；在渠鱼雷伤换成贴着锈线来回的除锈光（只动 transform），减少动态时不播；抽水光退役', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8')
  assert.match(css, /\.fleet-skin \.ship :is\(\.scar-svg, \.rust-svg\) \{[^}]*position: absolute; inset: 0;/)
  for (const token of ['--hit-scar', '--hit-scar-rim', '--hit-rust', '--hit-rust-deep']) {
    assert.equal((css.match(new RegExp(`${token}:`, 'g')) ?? []).length, 2, `${token} 深浅两套都有`)
  }
  const at = css.indexOf('@keyframes ru-dock-derust {')
  const block = css.slice(at, css.indexOf('}\n    }', at))
  assert.deepEqual([...new Set([...block.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]))], ['transform'])
  assert.match(css, /\.fleet-skin \.ship \.dock-derust \{[^}]*animation: ru-dock-derust [^;]*infinite alternate;/, '来回走')
  assert.match(css, /\.fleet-skin \.ship \.dock-derust,\s*\.fleet-skin \.ship \.dock-sub-bubble \{ display: none; \}/)
  assert.doesNotMatch(css, /dock-pump-sheen|ru-dock-pump/)
})

test('保底：旧伤＋这一趟记下的掉血要等于实际缺失；没记到的补成四角碎裂，出击中回了血先扣旧伤', () => {
  const { reconcileScar, emptyDamageState } = damage
  const base = { ...emptyDamageState(3), scar: 0.2, current: 0.3 }
  assert.equal(reconcileScar(base, 20, 40), base, '0.2 + 0.3 = 缺失 0.5：对得上就原样返回')
  assert.equal(reconcileScar(base, 8, 40).scar, 0.5, '实际缺失 0.8、只记到 0.3：没记到的 0.3 补进旧伤')
  assert.equal(reconcileScar(base, 30, 40).scar, 0, '出击中泊地修理回到缺失 0.25：旧伤先扣到 0')
  assert.equal(reconcileScar({ ...emptyDamageState(3) }, 10, 40).scar, 0.75, '一点记录都没有：整段按缺失给碎裂')
})

test('这一趟记下的掉血随战报累加，返港并进四角碎裂后归零；重放出来的与实际血量对得上', () => {
  const deps = { seedKey: 1, zones, stypeOf: () => 2, targetStype: 2 }
  const a1 = chainBattle(31, 27, [3, 1])
  const b1 = chainBattle(27, 20, [4, 3])
  const sortieOf = (battle) => (battle === b1 ? 11 : 10)
  const s = damage.replayDamageChain([a1, b1], 7, deps, undefined, { sortieOf, current: 11 })
  assert.ok(Math.abs(s.current - 7 / 31) < 0.01, '这一趟掉了 7')
  assert.ok(Math.abs(s.scar - 4 / 31) < 0.01, '上一趟返港时缺 4')
  assert.equal(damage.reconcileScar(s, 20, 31), s, '旧伤＋这一趟 = 现在缺失：保底不动')
  assert.equal(damage.returnToPort(s, 20, 31).current, 0)
})

test('编队：保底接在每次观察里——出击中按实际血量核、所有舰回满就清；新见到的带伤舰出击中也先给保底碎裂', () => {
  const ru = fs.readFileSync(path.join(ROOT, 'src/renderer/modules/ru.ts'), 'utf8')
  assert.match(ru, /\} else if \(held && !sunk && ship\.nowhp < ship\.maxhp\) \{[^}]*reconcileScar\(held, ship\.nowhp, ship\.maxhp\)/)
  assert.match(ru, /for \(const id of damageStates\.keys\(\)\) \{\s*const ship = mg\.ships\[id\]\s*if \(ship && ship\.nowhp >= ship\.maxhp && !isSunkInSortie\(id\)\) \{\s*damageStates\.delete\(id\)/, '不在眼前的舰回满了也清')
  assert.match(ru, /state = sunk \? emptyDamageState\(nextDamageSeed\(\)\) : syntheticDamageState\(nextDamageSeed\(\), ship\.nowhp, ship\.maxhp, isSubShip\(ship\)\)/, '出击中也先给保底')
  assert.match(ru, /const next = sunk \? replayed : reconcileScar\(replayed, ship\.nowhp, ship\.maxhp\)/, '账本重放的结果也再核一遍')
})
