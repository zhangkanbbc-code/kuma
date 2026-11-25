// 被弹动画（实验性，维护者裁决 2026-11-25）：收到战斗报文、编队里有舰娘掉血时，在锐的编队行播一次——
//   · 名牌抖动，幅度随这一下扣掉的血量（占最大耐久的比例）变大；
//   · 血条从掉血前动画扣到掉血后；
//   · 剩余血量越低，glitch 感越强；
//   · 角色名卡出现轻微的碎裂感，同样随剩余血量变低而加重。
// 钥「实验性」一张卡开关，默认关。演习不改编队血量（store 的 syncBattleHp 对演习直接跳过），
// 所以只有出击会触发；首次见到、回血、出击外的变化都不播。
//
// 判据是两块纯逻辑，放 src/shared/hit-shake.ts：
//   hitShakeParams({ before, after, max }) → { shake, glitch, shatter, from, to } | null
//     三个强度都归一到 0～1，具体曲线由施工方设计，这里只钉单调与边界；from / to 是血条百分比。
//   createHpWatch() → { observe(ships, { battle }) }：返回本次掉血的 Map<id, { before, after, max }>。
// 编队行在 shipRow 之外用 shipHitShake(ship) 取一次性参数，有参数时挂 data-hit 与 --hit-* 变量。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { renderRow, reset, setHitCrack, setHitFracture, setHitShake } from './fixtures/render-ru-row.mjs'

const require = createRequire(import.meta.url)
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const hitModule = () => {
  const file = path.join(ROOT, 'dist', 'shared', 'hit-shake.js')
  assert.ok(fs.existsSync(file), '缺少 src/shared/hit-shake.ts（构建后在 dist/shared/hit-shake.js）')
  return require(file)
}
const flat = (html) => html.replace(/\s+/g, ' ')
const glassModule = () => require(path.join(ROOT, 'dist', 'shared', 'hit-glass.js'))
const glassVars = (id, seed) => {
  const { hitGlassCssVars, hitGlassGeometry } = glassModule()
  return hitGlassCssVars(hitGlassGeometry(id, seed, 540, 48))
}

// ---- 动画参数 ----

test('没掉血就没有动画：持平、回血、最大耐久为 0 都给 null', () => {
  const { hitShakeParams } = hitModule()
  assert.equal(hitShakeParams({ before: 30, after: 30, max: 40 }), null)
  assert.equal(hitShakeParams({ before: 20, after: 30, max: 40 }), null)
  assert.equal(hitShakeParams({ before: 5, after: 0, max: 0 }), null)
})

test('三个强度都在 0～1 之间，血条起止是掉血前后的百分比', () => {
  const { hitShakeParams } = hitModule()
  for (const [before, after] of [[40, 39], [40, 30], [40, 20], [40, 10], [40, 1], [40, 0], [12, 3]]) {
    const p = hitShakeParams({ before, after, max: 40 })
    assert.ok(p, `${before}→${after}`)
    for (const key of ['shake', 'glitch', 'shatter']) {
      assert.ok(p[key] >= 0 && p[key] <= 1, `${key}=${p[key]} 越界（${before}→${after}）`)
    }
    assert.equal(p.from, (before / 40) * 100)
    assert.equal(p.to, (after / 40) * 100)
  }
})

test('抖动随这一下扣的血变大：同样掉到 20，从 40 掉的比从 25 掉的抖得更狠', () => {
  const { hitShakeParams } = hitModule()
  const big = hitShakeParams({ before: 40, after: 20, max: 40 })
  const small = hitShakeParams({ before: 25, after: 20, max: 40 })
  assert.ok(big.shake > small.shake, `${big.shake} 应大于 ${small.shake}`)
  // 扣得再少也要能看出来动了一下
  assert.ok(hitShakeParams({ before: 40, after: 39, max: 40 }).shake > 0)
})

test('剩余血量越低，glitch 与碎裂越强（同样扣 5 点，剩 5 的比剩 30 的更重）', () => {
  const { hitShakeParams } = hitModule()
  const remaining = [35, 30, 20, 10, 5, 1].map((after) => hitShakeParams({ before: after + 5, after, max: 40 }))
  for (let i = 1; i < remaining.length; i++) {
    assert.ok(remaining[i].glitch >= remaining[i - 1].glitch, `glitch 不单调：剩 ${[35, 30, 20, 10, 5, 1][i]}`)
    assert.ok(remaining[i].shatter >= remaining[i - 1].shatter, `碎裂不单调：剩 ${[35, 30, 20, 10, 5, 1][i]}`)
  }
  assert.ok(remaining.at(-1).glitch > remaining[0].glitch)
  assert.ok(remaining.at(-1).shatter > remaining[0].shatter)
})

// ---- 掉血侦测 ----

test('首次见到只记基线；出击中掉血才报，回血与出击外的变化都只更新基线', () => {
  const { createHpWatch } = hitModule()
  const watch = createHpWatch()
  const ship = (id, nowhp, maxhp = 40) => ({ id, nowhp, maxhp })
  assert.equal(watch.observe([ship(1, 40), ship(2, 30)], { battle: true }).size, 0, '首次见到不报')
  const hit = watch.observe([ship(1, 25), ship(2, 30)], { battle: true })
  assert.deepEqual([...hit.entries()], [[1, { before: 40, after: 25, max: 40 }]])
  assert.equal(watch.observe([ship(1, 25), ship(2, 30)], { battle: true }).size, 0, '没变化不报')
  assert.equal(watch.observe([ship(1, 40), ship(2, 30)], { battle: true }).size, 0, '回血不报')
  assert.equal(watch.observe([ship(1, 10), ship(2, 30)], { battle: false }).size, 0, '出击外掉血不报')
  // 出击外那次已经把基线更新成 10，再在出击中掉到 5 才报 10→5
  assert.deepEqual([...watch.observe([ship(1, 5)], { battle: true }).entries()], [[1, { before: 10, after: 5, max: 40 }]])
})

test('舰娘离队后再回来按首次见到处理，不拿离队前的血量比', () => {
  const { createHpWatch } = hitModule()
  const watch = createHpWatch()
  watch.observe([{ id: 1, nowhp: 40, maxhp: 40 }], { battle: true })
  watch.observe([], { battle: true })
  assert.equal(watch.observe([{ id: 1, nowhp: 10, maxhp: 40 }], { battle: true }).size, 0)
})

// ---- 编队行 ----

test('有动画参数时，行挂 data-hit 与 --hit-shake / --hit-glitch / --hit-shatter / --hp-from', () => {
  reset({ names: { 1: '吹雪' } })
  setHitShake({
    5: { shake: 0.6, glitch: 0.3, shatter: 0.2, from: 100, to: 62.5, dmg: 15, severity: 3, crossedTier: true, glitchBurst: false, ghostDurMs: 720 },
  })
  const html = flat(renderRow({ id: 5, shipId: 1, nowhp: 25 }))
  const row = html.match(/<div class="ship[^"]*"[^>]*>/)?.[0] ?? ''
  assert.match(row, /\sdata-hit(?:="[^"]*")?[\s>]/)
  for (const [name, value] of [['--hit-shake', '0.6'], ['--hit-glitch', '0.3'], ['--hit-shatter', '0.2'], ['--hp-from', '100%']]) {
    assert.match(row, new RegExp(`${name}:\\s*${value.replace('.', '\\.')}`), `${name} 没挂到行上：${row}`)
  }
})

test('没有动画参数（开关关着或没掉血）时，行上没有任何被弹痕迹', () => {
  reset({ names: { 1: '吹雪' } })
  setHitShake({})
  assert.doesNotMatch(flat(renderRow({ id: 5, shipId: 1, nowhp: 25 })), /data-hit|--hit-|--hp-from/)
})

test('击沉的行交给已有的碎裂演出，不叠被弹动画', () => {
  reset({ names: { 1: '吹雪' }, sortie: { active: true, practice: false, escaped: [] }, sunk: [5] })
  setHitShake({ 5: { shake: 1, glitch: 1, shatter: 1, from: 20, to: 0 } })
  assert.doesNotMatch(flat(renderRow({ id: 5, shipId: 1, nowhp: 0 })), /data-hit|--hit-/)
})

// ---- 钥「实验性」 ----

test('钥「实验性」有被弹动画的开关，默认关', () => {
  const { SETTINGS_SECTIONS } = require(path.join(ROOT, 'dist', 'shared', 'settings-sections.js'))
  const experimental = SETTINGS_SECTIONS.find((section) => section.id === 'experimental')
  assert.ok(experimental.cards.includes('hit-shake'), '实验性那一类里应有 hit-shake 卡')
  const yu = fs.readFileSync(path.join(ROOT, 'src/renderer/modules/yu.ts'), 'utf8')
  assert.match(yu, /'hit-shake':\s*\w+/)
  assert.match(yu, /'kuma\.hitShake',[\s\S]{0,400}?config\.get\('kuma\.hitShake', false\)|config\.get\('kuma\.hitShake', false\)/)
})

// ---- 常驻裂纹（维护者裁决 2026-11-25：碎裂停留到修满才消失；11-26 改：带伤入渠期间也保留，出渠修满时洗净） ----
// 按当前耐久判：带伤就有裂纹，在不在渠里都一样；修满（自然出渠、用桶、泊修回满、女神）才消失。
// 不靠记住「刚被打过」，重启后照样在。
// 同日续裁：**裂纹不以深浅来展示**，按伤势档分三套——小破、中破、大破各一套图样，越重裂纹越多、越长，
// 每一套都同样清楚；没到小破的擦伤不显示。档位判据用 shared/battle-damage 的 damageTierOf，不另写阈值。

const battleDamage = () => require(path.join(ROOT, 'dist', 'shared', 'battle-damage.js'))
const shipTag = (html) => flat(html).match(/<div class="ship[^"]*"[^>]*>/)?.[0] ?? ''

test('裂纹档位：满血、擦伤、最大耐久为 0 都没有；带伤时与破损档逐点一致，入渠中照样保留', () => {
  const { hitCrackTier } = hitModule()
  const { damageTierOf } = battleDamage()
  assert.equal(hitCrackTier({ nowhp: 40, maxhp: 40, docked: false }), null)
  assert.equal(hitCrackTier({ nowhp: 8, maxhp: 40, docked: true }), 'heavy', '带伤入渠期间保留，出渠修满时才洗净（11-26）')
  assert.equal(hitCrackTier({ nowhp: 40, maxhp: 40, docked: true }), null)
  assert.equal(hitCrackTier({ nowhp: 5, maxhp: 0, docked: false }), null)
  assert.equal(hitCrackTier({ nowhp: 31, maxhp: 40, docked: false }), null, '没到小破的擦伤不显示')
  for (const maxhp of [40, 77, 80]) {
    for (let nowhp = 1; nowhp < maxhp; nowhp++) {
      assert.equal(hitCrackTier({ nowhp, maxhp, docked: false }), damageTierOf(nowhp, maxhp), `${nowhp}/${maxhp}`)
    }
  }
})

test('裂纹档位的边界：75%、50%、25% 各自落在较重的那一档', () => {
  const { hitCrackTier } = hitModule()
  const tier = (nowhp) => hitCrackTier({ nowhp, maxhp: 40, docked: false })
  assert.deepEqual([31, 30, 21, 20, 11, 10, 1].map(tier), [null, 'light', 'light', 'medium', 'medium', 'heavy', 'heavy'])
})

test('编队行：有裂纹时挂 data-crack="<档位>" 与随机几何变量，不挂 --hit-crack 强度变量；没有裂纹不留痕迹', () => {
  reset({ names: { 1: '吹雪' } })
  setHitShake({})
  const varsCss = glassVars(5, 1)
  setHitFracture({ 5: varsCss })
  for (const tier of ['light', 'medium', 'heavy']) {
    setHitCrack({ 5: tier })
    const row = shipTag(renderRow({ id: 5, shipId: 1, nowhp: 10 }))
    assert.match(row, new RegExp(`\\sdata-crack="${tier}"`), row)
    assert.doesNotMatch(row, /--hit-crack/, '裂纹不以深浅展示：行上不该有强度变量')
    assert.match(row, /--fc-tilt:-?[\d.]+deg/, '随机几何变量（头像倾斜与裁角）应挂在行上')
    assert.equal((row.match(/\sstyle="/g) ?? []).length, 1, '只能有一个 style 属性')
  }
  setHitCrack({})
  setHitFracture({})
  assert.doesNotMatch(flat(renderRow({ id: 5, shipId: 1, nowhp: 10 })), /data-crack|--hit-crack|--fc-tilt:/)
})

test('被弹动画与常驻裂纹可同时挂在一行上，只有一个 style 属性', () => {
  reset({ names: { 1: '吹雪' } })
  setHitShake({
    5: { shake: 0.7, glitch: 0.6, shatter: 0.5, from: 50, to: 25, dmg: 10, severity: 4, crossedTier: true, glitchBurst: true, ghostDurMs: 880 },
  })
  setHitCrack({ 5: 'heavy' })
  setHitFracture({ 5: glassVars(5, 1) })
  const html = flat(renderRow({ id: 5, shipId: 1, nowhp: 10 }))
  const row = shipTag(html)
  assert.match(row, /\sdata-hit(?:="[^"]*")?[\s>]/)
  assert.match(row, /\sdata-hit-sev="4"/)
  assert.match(row, /\sdata-hit-cross="1"/)
  assert.match(row, /\sdata-glitch-burst="1"/)
  assert.match(row, /\sdata-crack="heavy"/)
  for (const name of ['--hit-shake', '--hit-glitch', '--hit-shatter', '--hp-from', '--hp-to', '--fc-tilt', '--g-delay']) {
    assert.match(row, new RegExp(`${name}:`), name)
  }
  assert.doesNotMatch(row, /--hit-crack/)
  assert.equal((row.match(/\sstyle="/g) ?? []).length, 1, '只能有一个 style 属性')
  assert.match(html, /class="hp-ghost crit"/)
  assert.match(html, /class="dmg-pop sev-4"[^>]*>-10!<\/span>/)
  assert.match(html, /class="glitch-bars"/)
})

test('行上的头像裁角与故障错相变量：同舰同种子稳定、换舰或新受伤周期分化（缺角几何本身见 hit-glass.test.mjs）', () => {
  assert.equal(glassVars(101, 1), glassVars(101, 1))
  assert.notEqual(glassVars(101, 1), glassVars(102, 1))
  assert.notEqual(glassVars(101, 1), glassVars(101, 2))
  for (let id = 1; id <= 30; id++) {
    const { hitGlassGeometry } = glassModule()
    const v = hitGlassGeometry(id, id * 7, 540, 48)
    assert.match(v.fcClipHeavy, /^polygon\(/)
    assert.match(v.fcClipSunk, /^polygon\(/)
    assert.ok(v.gDelay < 0 && Math.abs(v.gDelay) < v.gDur)
  }
})

test('跨入大破危险线时触发 glitchBurst 与 4 档冲击', () => {
  const { hitShakeParams } = hitModule()
  const scratch = hitShakeParams({ before: 40, after: 37, max: 40 })
  const toHeavy = hitShakeParams({ before: 20, after: 8, max: 40 })
  assert.equal(scratch.severity, 1)
  assert.equal(scratch.glitchBurst, false)
  assert.equal(toHeavy.severity, 4)
  assert.equal(toHeavy.crossedTier, true)
  assert.equal(toHeavy.glitchBurst, true)
})

test('击沉与退避的行不挂常驻裂纹', () => {
  reset({ names: { 1: '吹雪' }, sortie: { active: true, practice: false, escaped: [{ rosterId: 5, role: 'escaped' }] } })
  setHitCrack({ 5: 'heavy' })
  setHitFracture({})
  assert.doesNotMatch(flat(renderRow({ id: 5, shipId: 1, nowhp: 3 })), /data-crack/)
  reset({ names: { 1: '吹雪' }, sortie: { active: true, practice: false, escaped: [] }, sunk: [5] })
  setHitCrack({ 5: 'heavy' })
  assert.doesNotMatch(flat(renderRow({ id: 5, shipId: 1, nowhp: 0 })), /data-crack/)
})

test('样式表对账：三档裂纹、4 档抖动、危险线 Glitch 与 reduced-motion 护栏均在位', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8')
  for (const tier of ['light', 'medium', 'heavy']) {
    assert.match(html, new RegExp(`\\.ship\\[data-crack="${tier}"\\]`), `index.html 里找不到 .ship[data-crack="${tier}"]`)
  }
  assert.match(html, /@keyframes ru-hit-shake-4/)
  assert.match(html, /@keyframes ru-glitch-slice/)
  assert.match(html, /@keyframes ru-glitch-burst-bars/)
  const reduced = html.slice(html.indexOf('@media (prefers-reduced-motion: reduce)'))
  assert.match(reduced, /\.fleet-skin \.ship\[data-crack="heavy"\]/)
  assert.match(reduced, /\.fleet-skin \.ship\[data-hit\]/)
  assert.match(reduced, /\.fleet-skin \.ship\[data-glitch-burst\]/)
})

// ---- 重设计审阅后的三条修正（维护者裁决 2026-11-25） ----
// 1. 被弹动画是实验性、默认关：开关关着时，击沉演出与编队行必须和改动前一模一样——
//    击沉行不拿随机裂纹变量，原有的行骨架、舰列与击沉样式逐字不动（开关打开时另写带作用域的覆盖）。
// 2. 跨线爆发只在「这一下打穿大破线」时触发；本来就大破、再挨一下不爆发。
// 3. 行上的被弹参数一律由 hitShakeParams 给全，渲染侧不再写兜底推算。

test('实验开关关着时，击沉行与带伤行都拿不到随机裂纹变量', async () => {
  const { setFracture, fractureOf } = await import('./fixtures/render-hit-fracture.mjs')
  setFracture({ enabled: false, sunk: [5] })
  assert.equal(fractureOf({ id: 5, nowhp: 0 }), '', '开关关着：击沉演出照旧用原来的固定裂纹')
  assert.equal(fractureOf({ id: 6, nowhp: 10 }), '')
  setFracture({ enabled: true, sunk: [5] })
  assert.match(fractureOf({ id: 5, nowhp: 0 }), /--fc-tilt:-?[\d.]+deg/, '开关开着：击沉沿用同一套随机裂纹')
  assert.match(fractureOf({ id: 6, nowhp: 10 }), /--fc-tilt:-?[\d.]+deg/)
})

test('随机裂纹：满血不挂；带伤期间（含入渠中）不跳位；修满后再受伤换一套', async () => {
  const { setFracture, updateFracture, fractureOf } = await import('./fixtures/render-hit-fracture.mjs')
  setFracture({ enabled: true })
  assert.equal(fractureOf({ id: 7, nowhp: 40 }), '')
  const first = fractureOf({ id: 7, nowhp: 20 })
  assert.notEqual(first, '')
  assert.equal(fractureOf({ id: 7, nowhp: 12 }), first, '同一轮受伤内重画不跳位')
  updateFracture({ docked: [7] })
  assert.equal(fractureOf({ id: 7, nowhp: 12 }), first, '带伤入渠期间裂纹原样保留（11-26），等出渠洗净')
  updateFracture({ docked: [] })
  assert.equal(fractureOf({ id: 7, nowhp: 40 }), '', '出渠修满就洗净')
  assert.notEqual(fractureOf({ id: 7, nowhp: 30 }), first, '修满后再受伤换一套')
})

test('跨线爆发只在这一下打穿大破线时触发', () => {
  const { hitShakeParams } = hitModule()
  assert.equal(hitShakeParams({ before: 20, after: 8, max: 40 }).glitchBurst, true, '中破 → 大破')
  assert.equal(hitShakeParams({ before: 40, after: 0, max: 40 }).glitchBurst, true, '满血一击打到 0')
  assert.equal(hitShakeParams({ before: 9, after: 5, max: 40 }).glitchBurst, false, '本来就大破，再挨一下不爆发')
  assert.equal(hitShakeParams({ before: 30, after: 21, max: 40 }).glitchBurst, false)
})

test('行上的被弹档位与伤害数直接用参数，不另行推算', () => {
  const ru = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'modules', 'ru.ts'), 'utf8')
  assert.doesNotMatch(ru, /hit\.severity\s*\?\?/, 'severity 由 hitShakeParams 给全，不写兜底')
  assert.doesNotMatch(ru, /hit\.dmg\s*\?\?/, 'dmg 由 hitShakeParams 给全，不写兜底')
  assert.doesNotMatch(ru, /hit\.ghostDurMs\s*\?\?/, 'ghostDurMs 由 hitShakeParams 给全，不写兜底')
})

test('开关关着时不改原有样式：行骨架、舰列与击沉演出的规则逐字同改动前', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8').replace(/\r\n/g, '\n')
  const norm = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim()
  const block = (head) => {
    const at = html.indexOf('\n    ' + head + ' {')
    assert.ok(at >= 0, `index.html 里找不到「${head} {」：原有规则要原样留着，开关打开时的样式另写带作用域的覆盖`)
    let depth = 1
    let j = html.indexOf('{', at) + 1
    while (depth) { if (html[j] === '{') depth++; else if (html[j] === '}') depth--; j++ }
    return norm(html.slice(at + 1, j))
  }
  const ORIGINAL = {
    '.fleet-skin .ships': '.fleet-skin .ships { flex: 1; overflow-y: auto; }',
    '.fleet-skin .ship': '.fleet-skin .ship { display: grid; grid-template-columns: 48px minmax(96px, 1fr) 100px 52px 40px 150px; align-items: center; gap: 0 8px; padding: 8px 14px; cursor: pointer; border-bottom: 1px solid var(--line-soft); border-left: 2px solid transparent; }',
    '.fleet-skin .ship.shattered': '.fleet-skin .ship.shattered { position: relative; border-left-color: var(--dim); background: linear-gradient(90deg, rgba(0, 0, 0, .34), rgba(0, 0, 0, .1) 60%, transparent); filter: brightness(.72) contrast(1.06); animation: ru-shatter-in 620ms var(--motion-ease) both; }',
    '.fleet-skin .ship.shattered .shatter': '.fleet-skin .ship.shattered .shatter { position: absolute; inset: 0; pointer-events: none; z-index: 2; background: linear-gradient(72deg, transparent calc(24% - 1.4px), color-mix(in srgb, var(--glow-shatter) 95%, transparent) 24%, transparent calc(24% + 1.4px)), linear-gradient(-58deg, transparent calc(43% - 1.1px), color-mix(in srgb, var(--glow-shatter) 80%, transparent) 43%, transparent calc(43% + 1.1px)), linear-gradient(96deg, transparent calc(63% - 1.2px), color-mix(in srgb, var(--glow-shatter) 72%, transparent) 63%, transparent calc(63% + 1.2px)), linear-gradient(-104deg, transparent calc(81% - .9px), color-mix(in srgb, var(--glow-shatter) 60%, transparent) 81%, transparent calc(81% + .9px)); filter: drop-shadow(1px 1px 0 rgba(0, 0, 0, .75)); }',
    '.fleet-skin .ship.shattered .shatter::before': ".fleet-skin .ship.shattered .shatter::before { background: linear-gradient(24deg, transparent calc(50% - 1px), color-mix(in srgb, var(--glow-shatter) 60%, transparent) 50%, transparent calc(50% + 1px)), linear-gradient(160deg, rgba(0, 0, 0, .5), rgba(0, 0, 0, .16)); clip-path: polygon(18% 0, 46% 0, 33% 100%, 8% 100%); }",
    '.fleet-skin .ship.shattered .fc': '.fleet-skin .ship.shattered .fc { transform: rotate(-9deg) translate(-2px, 2px); clip-path: polygon(0 0, 76% 0, 100% 26%, 100% 54%, 62% 100%, 0 100%); filter: brightness(.6) saturate(.35); }',
    '@keyframes ru-shatter-in': '@keyframes ru-shatter-in { 0% { transform: translateX(0); filter: brightness(1.5) contrast(1.06); } 18% { transform: translateX(-3px); } 34% { transform: translateX(2px); } 52% { transform: translateX(-1px); } 100% { transform: none; filter: brightness(.72) contrast(1.06); } }',
  }
  for (const [head, expected] of Object.entries(ORIGINAL)) assert.equal(block(head), expected, head)
})
