// 逐星加成 × 改修表的两源夹缝台账（自扩展体检待裁 4，2026-08-23 挂账）。
//
// 台账**不参与任何判定**，所以它坏了不会有任何报错表现——护栏就是它唯一的自检。
// 这里钉三件事：
//   ① 台账与随包实况逐条对得上（多一条、少一条、指纹变了都要当场报）；
//   ② 每一条都写全了两个源各自的说法（缺任一侧就不算「记下来了」）；
//   ③ 渲染层**没有**因为这张台账改口径——连坐照旧，数据一格没动。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  PENDING_IMPROVE_STAR_GAPS,
  diffImproveStarGaps,
  improveStarGapRows,
  improveStarTableFingerprint,
  improveUpstreamRefs,
} from '../scripts/lib/improve-star-gap.mjs'

const root = path.join(fileURLToPath(import.meta.url), '..', '..')
const pack = (id) => {
  const file = path.join(root, 'assets', 'lodes', `${id}.json`)
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).data : null
}

test('指纹与渲染层 starRows 同一套筛选口径', () => {
  const ten = (v) => Array.from({ length: 10 }, () => v)
  // 不足 10 列的属性行界面上不显示，指纹也不该收
  assert.equal(improveStarTableFingerprint({ 対空: ['+1', '+2'] }), '')
  // 10 列全空的同理（akashi 常留一整行空格）
  assert.equal(improveStarTableFingerprint({ 対空: ten('  ') }), '')
  // 有内容的照收，空格归一成短横，属性名按字典序
  assert.equal(
    improveStarTableFingerprint({ 雷撃: ten('+1'), 対空: [...ten('+2').slice(0, 9), ''] }),
    '対空[+2/+2/+2/+2/+2/+2/+2/+2/+2/-];雷撃[+1/+1/+1/+1/+1/+1/+1/+1/+1/+1]',
  )
  assert.equal(improveStarTableFingerprint(null), '')
})

test('台账逐条写全了两个源各自的说法', () => {
  assert.ok(
    PENDING_IMPROVE_STAR_GAPS.length,
    '夹缝台账空了？那要么真清空了（改修表收录齐了），要么有人把它删了',
  )
  const seen = new Set()
  for (const entry of PENDING_IMPROVE_STAR_GAPS) {
    assert.ok(Number.isInteger(entry.equipId) && entry.equipId > 0, '装备 mstId 不对')
    assert.ok(!seen.has(entry.equipId), `${entry.equipId} 在台账里出现了两次`)
    seen.add(entry.equipId)
    assert.ok(entry.equipName, `${entry.equipId} 缺日文原名（给人读的锚）`)
    // akashi 那一侧：逐星表的逐格指纹，不能是空串
    assert.match(
      entry.akashiStarTable,
      /^[^\[]+\[[^\]]+\]/,
      `${entry.equipId} 的 akashi 逐星表指纹形状不对`,
    )
    // 改修表那一侧：null = 连条目都没有。这一条**必须**明写，
    // 不写就分不清「改修表说不可改修」与「我们没去查」
    assert.equal(entry.improveLedger, null, `${entry.equipId} 的改修表说法没记`)
    assert.equal(typeof entry.withinImproveCoverage, 'boolean', `${entry.equipId} 没记覆盖内外`)
    assert.ok(Object.isFrozen(entry))
  }
  // 覆盖内外两档都得说得出来：24 件在覆盖内（那份资料的口径是「不可改修」），
  // 577 一件在覆盖之外（它还没收录到这个号，回答不了）
  const outside = PENDING_IMPROVE_STAR_GAPS.filter((entry) => !entry.withinImproveCoverage)
  assert.deepEqual(outside.map((entry) => entry.equipId), [577])
})

test('每条都要说得出「最后一次回上游看是什么时候」与「改修表在别处提没提过它」', () => {
  // 2026-08-24 复核：25 条一条没收敛，所以条目不删（口径与 event-bonus /
  // map-drops / map-enemy-comps 三处台账一致），只多带复核日期与 upstreamRef。
  // 没有日期就分不清「这轮真去看过」与「上一轮抄下来放到现在」。
  for (const entry of PENDING_IMPROVE_STAR_GAPS) {
    assert.match(
      entry.recheckedAt ?? '',
      /^\d{4}-\d{2}-\d{2}$/,
      `${entry.equipId} 缺复核日期：待裁项要能说清最后一次去看是什么时候`,
    )
    assert.ok(
      ['convert', 'consume', 'convert+consume', 'absent'].includes(entry.upstreamRef),
      `${entry.equipId} 的 upstreamRef 不是四档之一：${entry.upstreamRef}`,
    )
  }
  // 「改修表根本不知道这几件装备」是错的说法，钉住这一条：至少 191 是
  // 毘式40mm連装機銃 的更新先（原文 ⇒★+1），彩雲(54) 是 4 处改修的消费装备。
  const refOf = (id) => PENDING_IMPROVE_STAR_GAPS.find((entry) => entry.equipId === id)?.upstreamRef
  assert.equal(refOf(191), 'convert')
  assert.equal(refOf(54), 'consume')
})

test('upstreamRef 分得清「更新先 / 消费装备 / 一次没提」，不把自消耗算成别人提到它', () => {
  const refs = improveUpstreamRefs([
    {
      eq_id: 10,
      // 「同装備x1」解析出来就是自己：这不叫「别人提到它」，10 不该进表
      improvement: [{ costs: { p1: { equips: [{ id: 10 }] }, conv: { equips: [{ id: 20 }] } } }],
      convert_to: [{ id_after: 30, lvl_after: 0 }],
    },
    {
      eq_id: 40,
      improvement: [{ costs: { p2: { equips: [{ id: 30 }] } } }],
      convert_to: [{ id_after: 50, lvl_after: 1 }],
    },
  ])
  assert.equal(refs.get(20), 'consume', '别人改修消耗它 → consume')
  assert.equal(refs.get(50), 'convert', '它是别人的更新先 → convert')
  assert.equal(refs.get(30), 'convert+consume', '两样都占的要合并写，不能只报一样')
  assert.equal(refs.get(10), undefined, '自消耗被算成了「别人提到它」')
  assert.equal(refs.get(999), undefined, '没提到的号不该凭空出现')
  // 空包/坏包不许崩，也不许瞎认
  assert.equal(improveUpstreamRefs(null).size, 0)
  assert.equal(improveUpstreamRefs([{ eq_id: 1 }]).size, 0)
})

test('upstreamRef 变了要当场报，不是默默跟着实况走', () => {
  const akashi = { items: { 7: { item_remodel: { 火力: Array.from({ length: 10 }, () => '+1') } } } }
  const upgrades = [{ eq_id: 9, improvement: [{ costs: {} }], convert_to: [{ id_after: 7, lvl_after: 0 }] }]
  const ledger = [
    {
      equipId: 7,
      equipName: '样本',
      akashiStarTable: '火力[+1/+1/+1/+1/+1/+1/+1/+1/+1/+1]',
      improveLedger: null,
      withinImproveCoverage: true,
      upstreamRef: 'absent', // 台账记的是「一次没提」，实况已经是别人的更新先
      recheckedAt: '2026-08-24',
    },
  ]
  const { rows } = diffImproveStarGaps({ akashi, upgrades, ledger })
  assert.deepEqual(rows, [{ kind: 'upstreamref', equipId: 7, ledger: 'absent', live: 'convert' }])
  // 对上了就不该报
  const same = diffImproveStarGaps({
    akashi,
    upgrades,
    ledger: [{ ...ledger[0], upstreamRef: 'convert' }],
  })
  assert.deepEqual(same.rows, [])
})

test('台账 × 随包实况逐条对得上', () => {
  const akashi = pack('akashi-list')
  const upgrades = pack('equip-upgrades')
  if (!akashi || !upgrades) return // 两个包都随仓库分发；真缺了由 test:lodes 那条护栏报
  const { rows, summary } = diffImproveStarGaps({ akashi, upgrades })
  assert.deepEqual(
    rows,
    [],
    '台账与实况对不上——多半是上游改了逐星表或改修表收录了新号，要重新核这几条：' +
      rows.map((row) => `${row.equipId}(${row.kind})`).join('、'),
  )
  assert.equal(summary.ledger, summary.live)
  // 实况这一侧独立复算一遍：夹缝里的 id 集合与台账逐个相等
  assert.deepEqual(
    improveStarGapRows({ akashi, upgrades }).map((row) => row.equipId),
    PENDING_IMPROVE_STAR_GAPS.map((entry) => entry.equipId),
  )
})

test('挂账不改数据：渲染层的连坐照旧，逐星表仍在改修闸门下游', () => {
  // 「只列，未动」是这条待裁的全部内容。护栏钉住它，免得哪天有人顺手把
  // starTable 提到闸门外——那会让本来不可改修的装备摆出一张逐星加成表。
  const ji = fs.readFileSync(path.join(root, 'src', 'renderer', 'modules', 'ji.ts'), 'utf8')
  const gate = ji.indexOf("if (!eo?.improvement?.length) {")
  const star = ji.indexOf('const starTable = starRows')
  assert.ok(gate > 0 && star > gate, '逐星表跑到改修闸门上游去了——这条待裁还没裁')
  // 台账住在维护者侧的 scripts/，运行时一行不读它
  const runtime = ['src/renderer/modules/ji.ts', 'src/main/lode.ts', 'src/shared/equip-sources.ts']
  for (const file of runtime) {
    const full = path.join(root, file)
    if (!fs.existsSync(full)) continue
    assert.doesNotMatch(
      fs.readFileSync(full, 'utf8'),
      /improve-star-gap|PENDING_IMPROVE_STAR_GAPS/,
      `${file} 读了维护者侧的台账`,
    )
  }
})
