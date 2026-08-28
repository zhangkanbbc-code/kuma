// 跨重启回放的出击切片必须落成「非现役」（2026-08-25 补护栏）。
//
// ---- 这条规则守的不是账目，是母港里的语音字幕 ----
// `voice-subtitle` 有两处闸门读 `mg.sortie.active`：
//   · modeFor —— `active && battle` 时台词改道成顶部弹幕，底部字幕条不再出；
//   · 演习拦截 —— `active && practice` 时整场一个字都不出。
// 落盘快照里的 sortie 完全可能是 `active: true`（艦素在出击/演习会话中途被关掉，
// 那一刻的 domainSnapshot 就长这样）。若原样复活，这两道闸会在**母港**里持续误伤，
// 窗口任意长——直到下一条 port 报文才关。表现就是「字幕间歇性消失」。
//
// ---- 为什么现在才有护栏 ----
// 规则本身自 2026-08-23 起就在 store.ts 的 hydrateDomain 里（实跑验证过：
// 喂 active:true 进去，出来就是 active:false，practice/updatedTs/battle 原样）。
// 缺的一直是护栏——而它正是那种**写反了不报错、只在母港静默咬人**的判断，
// 源码正则也挡不住（共享记忆 source-pattern-guards-miss-logic-bugs）。
//
// ⚠️ 护栏**不许** import store.ts：那个文件一 import 就会打开用户的真账本并跑迁移。
// 所以判据抽在 shared/sortie-restore，这里对着它真跑。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import sortieRestore from '../dist/shared/sortie-restore.js'

const { restoreSortieAcrossRestart } = sortieRestore
const store = fs.readFileSync(new URL('../src/main/mg/store.ts', import.meta.url), 'utf8')

/** 一场「被关掉时还在打」的会话，字段尽量摆满，好断言其余原样。 */
const liveSortie = () => ({
  active: true,
  practice: true,
  mapArea: 6,
  mapNo: 5,
  deckId: 2,
  bossCell: 12,
  nodes: [{ cell: 3 }, { cell: 12 }],
  currentCell: 12,
  cellData: [{ no: 3, passed: 1 }],
  selectRoute: [4, 5],
  practiceOpponent: { name: '对手' },
  battle: { kind: 'day', fFormation: 1 },
  battleCount: 3,
  drops: [{ mstId: 200 }],
  sunkShips: [{ mstId: 100 }],
  anchorageRepairs: [{ cell: 12, ships: [], steel: 0 }],
  escaped: [{ rosterId: 102, role: 'escaped' }],
  airBaseStrikes: { 1: [] },
  bossCleared: null,
  startTs: 1_700_000_000_000,
  updatedTs: 1_700_000_123_456,
})

test('active:true 的快照回放后一律非现役', () => {
  const restored = restoreSortieAcrossRestart(liveSortie())
  assert.equal(restored.active, false, '僵尸会话复活了——母港里字幕会被改道/静默，窗口任意长')
})

test('除 active 外一个字段都不许动（镝的复盘靠它们，且不许伪造时间戳）', () => {
  const before = liveSortie()
  const restored = restoreSortieAcrossRestart(before)
  for (const key of Object.keys(before)) {
    if (key === 'active') continue
    assert.deepEqual(restored[key], before[key], `${key} 被改动了`)
  }
  // updatedTs 尤其点名：它是那场会话最后一次更新的时刻，重启不是一次「更新」
  assert.equal(restored.updatedTs, 1_700_000_123_456)
  assert.equal(restored.practice, true)
  assert.deepEqual(restored.battle, { kind: 'day', fFormation: 1 })
  // 不就地改入参
  assert.equal(before.active, true, '就地改了入参')
})

test('已经是 active:false 的快照回放后不被改动', () => {
  const before = { ...liveSortie(), active: false }
  const restored = restoreSortieAcrossRestart(before)
  assert.deepEqual(restored, before, 'active:false 的快照被动过了')
})

test('sunkShips 缺席补成数组，已有的原样不动', () => {
  // 后加的字段，更老的快照没有它。留 undefined 会逼渲染层每个消费点各自 ?? [] 兜一遍
  const { sunkShips: _drop, ...withoutSunk } = liveSortie()
  assert.deepEqual(restoreSortieAcrossRestart(withoutSunk).sunkShips, [])
  assert.deepEqual(restoreSortieAcrossRestart({ ...withoutSunk, sunkShips: null }).sunkShips, [])
  const kept = [{ mstId: 100 }]
  assert.equal(restoreSortieAcrossRestart({ sunkShips: kept }).sunkShips, kept, '原有的数组被换掉了')
})

test('anchorageRepairs 缺席补成数组，已有的原样不动', () => {
  // 泊地修理是 2026-08-26 才加的字段，比它早的快照一份都没有
  const { anchorageRepairs: _drop, ...without } = liveSortie()
  assert.deepEqual(restoreSortieAcrossRestart(without).anchorageRepairs, [])
  assert.deepEqual(
    restoreSortieAcrossRestart({ ...without, anchorageRepairs: null }).anchorageRepairs,
    [],
  )
  const kept = [{ cell: 12, ships: [], steel: 0 }]
  assert.equal(
    restoreSortieAcrossRestart({ anchorageRepairs: kept }).anchorageRepairs,
    kept,
    '原有的数组被换掉了',
  )
})

test('escaped 缺席补成数组，已有的原样不动', () => {
  // 退避名单同样是后加的字段（2026-08-26）
  const { escaped: _drop, ...without } = liveSortie()
  assert.deepEqual(restoreSortieAcrossRestart(without).escaped, [])
  assert.deepEqual(restoreSortieAcrossRestart({ ...without, escaped: null }).escaped, [])
  const kept = [{ rosterId: 102, role: 'escaped' }]
  assert.equal(restoreSortieAcrossRestart({ escaped: kept }).escaped, kept, '原有的数组被换掉了')
})

test('回放路径确实走这条判据，没人绕过去', () => {
  assert.ok(
    store.includes('const restored = restoreSortieAcrossRestart(data.sortie)'),
    'hydrateDomain 没走共享判据——绕过去就等于把这条护栏架空',
  )
  // 就地手写 active:false 的老形态不许回潮（回潮了判据就有两份，迟早漂移）
  assert.ok(
    !/\{ \.\.\.data\.sortie, active: false \}/.test(store),
    '又在 hydrateDomain 里手搓了一份 active:false',
  )
  // store.ts 里 sortie.active 的写入点清点。每一处都得回答同一个问题：
  // **它会不会在母港把 active 留成 true**（留成 true 就会静默掐掉语音字幕）。
  //   · `active: true`  —— newSortie 的默认值（出击/演习开战）；
  //   · `active: false` —— 演习「只看对手编成」那一条：看一眼不是一场会话
  //                        （2026-08-25，用户报的「字幕间歇性消失」的真凶）；
  //   · `.active = false` —— 回港 reducer 的收尾。
  // 回放那一处（hydrateDomain）已经收口进 shared/sortie-restore，不在这份计数里。
  // 只数代码里的写入点：注释里提到「newSortie 默认 active: true」不算一处，
  // 否则解释得越清楚这条护栏越容易假红。
  const codeOnly = store
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim()
      return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*')
    })
    .join('\n')
  const writes = codeOnly.match(/active: true|active: false|\.active = false/g) ?? []
  assert.equal(
    writes.length,
    3,
    `store.ts 里 sortie.active 的写入点变了（现在 ${writes.length} 处）——新增一处就要问：它会不会在母港把 active 留成 true`,
  )
})
