// 动画复盘剧本编译器的全量真快照对拍。
//
// 只读打开本机账本（mg.sqlite），把 battle_snapshots 每一行经升级器（与读取路径同一个 upgradeBattleView）
// 交给 compileBattleAnimScript，逐场核：
//   ① 编译不抛异常；
//   ② 最后一步全舰血量 = 记录的终局血量（hpEnd）。对不上的再拿 kuma 现有的血量时间轴
//      （shared/battle-hp-timeline 的 shipHpTimeline）同一艘舰对照：时间轴也对不上的算「快照自带偏差」，
//      时间轴对得上而剧本对不上的算「编译器的错」；
//   ③ 最后一步累计输出 = damageDealt；
//   ④ 每一步里每艘舰 after.hpBefore === before.hp（多段连击不丢起点）。
// 只打印汇总与快照编号，不打印任何账号信息。需要先 npm run build（读 dist 产物）。
//
// 用法：node scripts/battle-anim-replay-audit.mjs [--examples=5]

import fs from 'node:fs'
import { createRequire } from 'node:module'
import { DatabaseSync } from 'node:sqlite'

import { userDataPath } from './lib/data-dir.mjs'

const require = createRequire(import.meta.url)
const { upgradeBattleView } = require('../dist/main/mg/battle.js')
const { compileBattleAnimScript } = require('../dist/shared/battle-anim-script.js')
const { shipHpTimeline } = require('../dist/shared/battle-hp-timeline.js')

const examples = Number(process.argv.find((arg) => arg.startsWith('--examples='))?.split('=')[1] ?? 5)

const masterFile = userDataPath('snapshots', 'kcsapi_api_start2_getData.json')
const master = (() => {
  const raw = JSON.parse(fs.readFileSync(masterFile, 'utf8'))
  return raw.body?.api_data ?? raw.body ?? raw.api_data ?? raw
})()
const stypeById = new Map(master.api_mst_ship.map((ship) => [ship.api_id, ship.api_stype]))
const stypeOf = (mstId) => stypeById.get(mstId) ?? null

const db = new DatabaseSync(userDataPath('mg.sqlite'), { readOnly: true })
const rows = db.prepare('SELECT id, snapshot FROM battle_snapshots ORDER BY id').all()

const buckets = new Map()
const note = (bucket, id) => {
  const entry = buckets.get(bucket) ?? { count: 0, ids: [] }
  entry.count += 1
  if (entry.ids.length < examples) entry.ids.push(id)
  buckets.set(bucket, entry)
}

let compiled = 0
let steps = 0
const kinds = new Map()
for (const row of rows) {
  let battle
  try {
    battle = upgradeBattleView(JSON.parse(row.snapshot)?.battle)
  } catch (error) {
    note(`升级器抛错：${String(error?.message ?? error).slice(0, 80)}`, row.id)
    continue
  }
  if (!battle) {
    note('快照里没有战斗', row.id)
    continue
  }
  const kindKey = `${battle.kind}${battle.practice ? '·演习' : ''}${battle.hasNight ? '·夜' : ''}`
  kinds.set(kindKey, (kinds.get(kindKey) ?? 0) + 1)
  let script
  try {
    script = compileBattleAnimScript(battle, { stypeOf })
  } catch (error) {
    note(`编译抛错（${kindKey}）：${String(error?.message ?? error).slice(0, 80)}`, row.id)
    continue
  }
  compiled += 1
  steps += script.steps.length
  const last = script.steps[script.steps.length - 1].after

  // ② 终局血量
  for (const [sideKey, metas, enemy] of [['f', battle.fShips, false], ['e', battle.eShips, true], ['friend', battle.friendShips ?? [], true]]) {
    for (const meta of metas) {
      if (meta.escaped || meta.unattackable) continue
      const ship = last[sideKey].find((entry) => entry.index === meta.index)
      if (!ship || ship.hp === meta.hpEnd) continue
      const side = sideKey === 'f' ? '我方' : sideKey === 'e' ? '敌方' : '友军'
      // 友军不在现有时间轴的口径里（它只分敌我两侧），单列
      if (sideKey === 'friend') {
        note(`终局血量不符·友军（${kindKey}）`, row.id)
        continue
      }
      const timeline = shipHpTimeline(battle.attacks, meta, enemy, battle.practice)
      note(timeline.mismatch ? `终局血量不符·快照自带偏差·${side}` : `终局血量不符·编译器的错·${side}（${kindKey}）`, row.id)
    }
  }
  // ③ 累计输出
  for (const [sideKey, metas] of [['f', battle.fShips], ['e', battle.eShips], ['friend', battle.friendShips ?? []]]) {
    for (const meta of metas) {
      const ship = last[sideKey].find((entry) => entry.index === meta.index)
      if (ship && ship.dealt !== meta.damageDealt) {
        note(`累计输出不符·${sideKey === 'f' ? '我方' : sideKey === 'e' ? '敌方' : '友军'}（${kindKey}）`, row.id)
      }
    }
  }
  // ④ 起点不丢
  let broken = false
  for (const step of script.steps) {
    for (const sideKey of ['f', 'e', 'friend']) {
      for (const ship of step.after[sideKey]) {
        const prior = step.before[sideKey].find((entry) => entry.index === ship.index)
        if (prior && prior.hp !== ship.hpBefore) broken = true
      }
    }
  }
  if (broken) note('起点被覆盖（after.hpBefore ≠ before.hp）', row.id)
}

console.log(`快照 ${rows.length} 场，编译成功 ${compiled} 场，共 ${steps} 步`)
console.log(`战型分布：${[...kinds].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join('、')}`)
if (!buckets.size) console.log('全部通过')
for (const [bucket, { count, ids }] of [...buckets].sort((a, b) => b[1].count - a[1].count)) {
  console.log(`  ${bucket}：${count}（例：${ids.join(', ')}）`)
}
process.exitCode = [...buckets.keys()].some((key) => key.includes('编译器的错') || key.includes('抛错') || key.includes('起点')) ? 1 : 0
