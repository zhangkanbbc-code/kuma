// 装备加成的第一方**自补层**（mstId 566–588，随包 kcwiki 底表整件没收的那 23 件）。
//
// 与修正台账的自失效判据**反过来**：修正台账盯「上游那一行变了没」，
// 自补层盯「上游开始收这件了没」——一旦收了就整条召回复审，不静默叠加也不静默丢弃。
// 那条召回护栏必须能真的变红，所以下面专门造一份「上游已覆盖」的 fixture 去撞它。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { loadStart2MasterArray } from '../scripts/lib/start2.mjs'
import { expectedFitBonus, fitPackCoverageMax, fitPackUncovered } from '../src/shared/fit-bonus.ts'
import { applyFitBonusCorrections } from '../src/shared/fit-bonus-corrections.ts'
import {
  applyFitBonusSupplement,
  FIT_BONUS_SUPPLEMENT,
  FIT_BONUS_SUPPLEMENT_PENDING,
} from '../src/shared/fit-bonus-supplement.ts'

const root = path.join(fileURLToPath(import.meta.url), '..', '..')
const pack = (equips) => ({ schemaVersion: 1, equipGroups: {}, equips, unresolved: [] })
const ship = (formId, ctype = -1, stype = -1, nationality = 0) => ({
  formId,
  ctype,
  stype,
  nationality,
})

// ---- ① 条目自洽 ----

test('自补层：每条都给得出来源页、最后编辑日期与印证状态', () => {
  assert.ok(FIT_BONUS_SUPPLEMENT.length > 0, '自补层空了？那 applyFitBonusSupplement 就是死代码')
  const seen = new Set()
  for (const entry of FIT_BONUS_SUPPLEMENT) {
    const at = `自补 ${entry.equipId} ${entry.equipName}`
    assert.ok(Number.isInteger(entry.equipId) && entry.equipId > 0, `${at} equipId 非法`)
    assert.ok(!seen.has(entry.equipId), `${at} 重复登记`)
    seen.add(entry.equipId)
    assert.ok(entry.source.includes('wikiwiki'), `${at} 没写日文出处是哪一页`)
    assert.match(entry.sourceUpdatedAt, /^\d{4}-\d{2}-\d{2}$/, `${at} 来源页最后编辑日期写法非法`)
    // 只有 wikiwiki 一张票，EO 那份是 NOASSERTION 一格都不许抄 —— 状态必须如实标
    assert.equal(entry.corroboration, '单源待印证', `${at} 印证状态被改了`)
    assert.match(entry.addedAt, /^\d{4}-\d{2}-\d{2}$/, `${at} 落盘日期写法非法`)
    // 没有规则的条目必须说清楚是「确认无」还是「挂牌」，不许既没规则又没交代
    if (!entry.rules.length) {
      assert.ok(
        entry.confirmedNone || entry.deferred?.length,
        `${at} 既没有规则也没说明为什么 —— 这就是静默丢`,
      )
    }
    for (const one of entry.rules) {
      assert.ok(one.via.length > 0, `${at} 有一行没写「対象艦」原文与落地依据`)
      const who = one.rule.who
      assert.ok(
        who.forms?.length || who.classes?.length || who.types?.length || who.all || who.nations?.length,
        `${at} 有一行的 who 是空的`,
      )
      // 国籍是「且」的过滤器：写了就必须落在国籍表的 12 个 id 里，不许出现自造编号
      for (const id of who.nations ?? []) {
        assert.ok(Number.isInteger(id) && id >= 1 && id <= 12, `${at} 有个国籍 id 越界：${id}`)
      }
      assert.ok(['perEquip', 'once', 'table'].includes(one.rule.stack), `${at} stack 非法`)
    }
    for (const text of entry.provisional ?? []) assert.ok(text.length > 4, `${at} 有条空的暫定标记`)
    for (const text of entry.deferred ?? []) assert.ok(text.length > 4, `${at} 有条空的挂牌记录`)
  }
})

test('自补层：转写不进来的那几件如实登在 PENDING 上，不冒充「它没有加成」', () => {
  const expected = FIT_BONUS_SUPPLEMENT.filter(
    (entry) => !entry.rules.length && !entry.confirmedNone,
  ).map((entry) => entry.equipId)
  assert.deepEqual([...FIT_BONUS_SUPPLEMENT_PENDING], expected)
  assert.ok(FIT_BONUS_SUPPLEMENT_PENDING.length > 0, 'PENDING 空了就该把那套机制一起删掉')
  // 「确认无」的那件**不在** PENDING 里：它是查过的结论，不是缺口
  const confirmedNone = FIT_BONUS_SUPPLEMENT.filter((entry) => entry.confirmedNone)
  assert.ok(confirmedNone.length > 0, '「确认无」的记录没了 —— 那件会被下一轮重查一遍')
  for (const entry of confirmedNone) {
    assert.ok(!FIT_BONUS_SUPPLEMENT_PENDING.includes(entry.equipId))
  }
})

// ---- ② 召回复审：上游一收录就变红 ----

test('自补层：上游开始收这件了就整条召回，绝不静默叠加到上游行上', () => {
  const target = FIT_BONUS_SUPPLEMENT.find((entry) => entry.rules.length)
  // 造一份「kcwiki 已经覆盖了这个 id」的包
  const covered = pack({
    [`${target.equipId}`]: {
      id: target.equipId,
      nameJa: target.equipName,
      nameZh: target.equipName,
      rules: [
        { row: 1, who: { all: true }, gain: { kind: 'flat', flat: { fire: 1 } }, stack: 'perEquip' },
      ],
    },
  })
  const skipped = []
  const result = applyFitBonusSupplement(covered, (entry, reason, detail) =>
    skipped.push([entry.equipId, reason, detail]),
  )
  const recalled = skipped.filter(([, reason]) => reason === 'recall')
  assert.equal(recalled.length, 1, '上游覆盖了却没召回 —— 那就是两层数会相加')
  assert.equal(recalled[0][0], target.equipId)
  assert.match(recalled[0][2], /人工比对/, '召回要说得出下一步该做什么')
  // 上游那一行原封不动，自补的行一条都没挂上去
  assert.deepEqual(result.data.equips[`${target.equipId}`], covered.equips[`${target.equipId}`])
  assert.deepEqual(
    expectedFitBonus(result.data, ship(1), [{ mstId: target.equipId, star: 0 }]).stats,
    { fire: 1 },
    '召回失灵的话这里会变成「上游 1 + 自补的那一份」',
  )
})

test('自补层：没有规则的条目本来就不该往包里加，理由分「确认无」与「挂牌」', () => {
  const skipped = []
  applyFitBonusSupplement(pack({}), (entry, reason, detail) =>
    skipped.push([entry.equipId, reason, detail]),
  )
  const empty = skipped.filter(([, reason]) => reason === 'empty')
  assert.equal(
    empty.length,
    FIT_BONUS_SUPPLEMENT.filter((entry) => !entry.rules.length).length,
  )
  assert.ok(empty.some(([, , detail]) => detail.includes('确认无')))
  assert.ok(empty.some(([, , detail]) => detail.includes('挂牌')))
})

test('自补层：加载顺序上它只补空位，已有的一格不碰', () => {
  const before = pack({
    '1': {
      id: 1,
      nameJa: 'x',
      nameZh: 'x',
      rules: [{ row: 1, who: { all: true }, gain: { kind: 'flat', flat: { aa: 9 } }, stack: 'once' }],
    },
  })
  const { data, applied } = applyFitBonusSupplement(before)
  assert.equal(applied, FIT_BONUS_SUPPLEMENT.filter((entry) => entry.rules.length).length)
  assert.deepEqual(data.equips['1'], before.equips['1'], '不相干的条目被动过了')
  assert.deepEqual(before.equips['566'], undefined, '原对象被就地改了 —— 纯函数破了')
})

// ---- ③ 真数据层 ----

const masterSlotItems = loadStart2MasterArray('api_mst_slotitem', root)
const packFile = path.join(root, 'assets', 'lodes', 'kcwiki-fit-bonus.json')
const realPack = fs.existsSync(packFile) ? JSON.parse(fs.readFileSync(packFile, 'utf8')).data : null

test(
  '真数据：自补的每个 id 在主数据里都是一件真装备，名字也对得上',
  { skip: masterSlotItems.length ? false : '缺 api_start2 主数据快照' },
  () => {
    const byId = new Map(masterSlotItems.map((item) => [Number(item.api_id), item]))
    for (const entry of FIT_BONUS_SUPPLEMENT) {
      const item = byId.get(entry.equipId)
      assert.ok(item, `自补 ${entry.equipId} 在主数据里根本没有这件装备`)
      assert.equal(
        `${item.api_name}`.replace(/／/g, '/'),
        `${entry.equipName}`.replace(/／/g, '/'),
        `自补 ${entry.equipId} 的名字与主数据对不上`,
      )
      assert.equal(
        Number(item.api_type?.[2]),
        entry.type2,
        `自补 ${entry.equipId} 的 api_type[2] 与主数据对不上`,
      )
    }
  },
)

test(
  '真包：自补层补上之后，覆盖边界推到 588，且仍挂牌的那几件算「暂无预期数据」',
  { skip: realPack ? false : '缺 assets/lodes/kcwiki-fit-bonus.json' },
  () => {
    assert.equal(fitPackCoverageMax(realPack), 565, '上游已经收到 566 以后了？自补层该重新比对')
    const corrected = applyFitBonusCorrections(realPack).data
    const skipped = []
    const { data, applied } = applyFitBonusSupplement(corrected, (entry, reason) =>
      skipped.push([entry.equipId, reason]),
    )
    assert.equal(applied, FIT_BONUS_SUPPLEMENT.filter((entry) => entry.rules.length).length)
    assert.deepEqual(
      skipped.filter(([, reason]) => reason === 'recall'),
      [],
      '真包里已经有自补的某个 id 了 —— 该条必须重新核',
    )
    assert.equal(fitPackCoverageMax(data), 588)
    // 覆盖边界一推，「取到票却转写不进来」的那几件会从「暂无预期数据」变成「它就是没加成」
    // ——那是把一个已知缺口说成了结论。supplementPending 就是拦这个的。
    assert.deepEqual([...(data.supplementPending ?? [])], [...FIT_BONUS_SUPPLEMENT_PENDING])
    for (const id of FIT_BONUS_SUPPLEMENT_PENDING) {
      assert.equal(fitPackUncovered(data, id), true, `${id} 有蓝字却被说成「没有加成」`)
    }
    for (const entry of FIT_BONUS_SUPPLEMENT) {
      if (!entry.rules.length) continue
      assert.equal(fitPackUncovered(data, entry.equipId), false, `${entry.equipId} 补进去了却还算未覆盖`)
    }
    // 「确认无」那件：查过了、它就是没有单体加成，不该再报「暂无预期数据」
    for (const entry of FIT_BONUS_SUPPLEMENT.filter((one) => one.confirmedNone)) {
      assert.equal(fitPackUncovered(data, entry.equipId), false)
    }
  },
)

test(
  '真包：抽三件逐格断言与日文原表一致（★ 分档、上記以外、类内筛名各一）',
  { skip: realPack ? false : '缺 assets/lodes/kcwiki-fit-bonus.json' },
  () => {
    const { data } = applyFitBonusSupplement(applyFitBonusCorrections(realPack).data)
    const at = (equipId, view, star) => expectedFitBonus(data, view, [{ mstId: equipId, star }]).stats

    // ① 584 Bofors 12cm単装両用砲：★ 分档 + 「上記以外の艦」
    //    Visby ★0~1 火力+2 回避+2 命中+1／★+2 火力+3／★+4 命中+2
    assert.deepEqual(at(584, ship(1062, 140, 2), 0), { fire: 2, evasion: 2, accuracy: 1 })
    assert.deepEqual(at(584, ship(1062, 140, 2), 2), { fire: 3, evasion: 2, accuracy: 1 })
    assert.deepEqual(at(584, ship(1062, 140, 2), 4), { fire: 3, evasion: 2, accuracy: 2 })
    //    Gotland 低一档；「上記以外の艦」只有 ★+2 起才有，且不含回避
    assert.deepEqual(at(584, ship(574, 89, 3), 4), { fire: 2, evasion: 1, accuracy: 2 })
    assert.deepEqual(at(584, ship(17, 30, 2), 0), {}, '够不到 ★+2 就一点都没有')
    assert.deepEqual(at(584, ship(17, 30, 2), 4), { fire: 1, accuracy: 1 })

    // ② 583 20.3cm／50 連装砲改(SHS改良弾)：改二形态有自己更深的基准行，不许被本级行盖住
    assert.deepEqual(at(583, ship(1056, 138, 5), 3), { fire: 6, accuracy: 4 }, 'Algérie改')
    assert.deepEqual(at(583, ship(1051, 138, 5), 3), { fire: 5, accuracy: 3 }, 'Algérie（未改）')

    // ③ 570 流星改(友永隊)：改造链上四层各吃各的档，「他」那一行不许把它们也算一遍
    assert.deepEqual(at(570, ship(1031, 17, 11), 10), { fire: 10, aa: 2, evasion: 2, accuracy: 5 })
    assert.deepEqual(at(570, ship(196, 17, 11), 0), { fire: 8, aa: 1, evasion: 1, accuracy: 2 })
    assert.deepEqual(at(570, ship(90, 17, 11), 0), { fire: 3, accuracy: 1 }, '蒼龍（未改）')
    assert.deepEqual(at(570, ship(136, 37, 9), 10), { fire: 1, accuracy: 2 }, '名单外的走「他」')
    assert.deepEqual(at(570, ship(136, 37, 9), 0), {}, '「他」那一行 ★6 才起步')
  },
)

// ---- ⑤ 国籍类目行（who.nations）----
//
// 上游的国籍类目一律是「国籍 × 舰种」的交，判据走 api_sort_id 号段
// （与图鉴筛选、任务条件同一份）。这四件是本层里带国籍行的全部装备，逐格钉住。
test(
  '真包：四件带国籍类目的装备逐格断言（イギリス艦 / 日駆逐 / 日軽巡 / 米英空母与その他）',
  { skip: realPack ? false : '缺 assets/lodes/kcwiki-fit-bonus.json' },
  () => {
    const { data } = applyFitBonusSupplement(applyFitBonusCorrections(realPack).data)
    const at = (equipId, view, star) => expectedFitBonus(data, view, [{ mstId: equipId, star }]).stats

    // ① 567 Sea Gladiator：整件只有「イギリス艦」一行，三档
    const arkRoyal = ship(515, 128, 11, 5)
    assert.deepEqual(at(567, arkRoyal, 0), { aa: 1, evasion: 2 })
    assert.deepEqual(at(567, arkRoyal, 7), { aa: 1, evasion: 3 })
    assert.deepEqual(at(567, arkRoyal, 8), { aa: 2, evasion: 3 })
    assert.deepEqual(at(567, ship(90, 17, 11, 1), 8), {}, '日本籍不吃「イギリス艦」')
    assert.deepEqual(at(567, ship(90, 17, 11, 0), 8), {}, '国籍判不出时不给')

    // ② 575 25mm連装機銃(熟練機銃員分隊)：「上記以外の日駆逐」与「上記以外の日軽巡」
    const jpDd = ship(9101, 9901, 2, 1) // 名单外的日本籍驱逐
    assert.deepEqual(at(575, jpDd, 0), { aa: 1, evasion: 1 })
    assert.deepEqual(at(575, jpDd, 10), { fire: 1, aa: 2, evasion: 2, accuracy: 1 })
    assert.deepEqual(at(575, ship(9102, 9901, 2, 4), 10), {}, '美国籍驱逐不在「日駆逐」里')
    assert.deepEqual(
      at(575, ship(9103, 38, 2, 1), 0),
      { fire: 1, aa: 1, evasion: 2 },
      '夕雲型走自己那一行，不掉进「上記以外の日駆逐」',
    )
    assert.deepEqual(at(575, ship(668, 41, 3, 1), 0), { aa: 3, evasion: 3 }, '矢矧改二乙是点过名的')
    assert.deepEqual(at(575, ship(9104, 9901, 3, 1), 0), { evasion: 1 }, '名单外的日本籍轻巡')
    assert.deepEqual(at(575, ship(9104, 9901, 3, 1), 10), { aa: 1, evasion: 2, accuracy: 1 })
    assert.deepEqual(at(575, ship(154, 56, 21, 1), 0), { fire: 1, aa: 2, evasion: 2 }, '香取是練習巡洋艦')

    // ③ 577 61cm四連装(酸素)魚雷五型改三：単体ボーナス1 与 2 是**相加**的两张表
    //    雪風改二 在 単体ボーナス2 的形态行里，同时吃 単体ボーナス1 的「上記以外の日駆逐」
    assert.deepEqual(
      at(577, ship(656, 30, 2, 1), 10),
      { fire: 1, torpedo: 5, evasion: 1, accuracy: 1 },
      '単体ボーナス2 的形态行不许把 単体ボーナス1 的舰种行压掉',
    )
    //    時雨改三在両表都点过名，「上記以外の日駆逐」把她排除掉
    assert.deepEqual(at(577, ship(961, 23, 2, 1), 10), { fire: 1, torpedo: 6, evasion: 2, accuracy: 2 })
    //    竹：単体ボーナス2 有她自己的行，単体ボーナス1 走日駆逐那一档
    assert.deepEqual(at(577, ship(642, 121, 2, 1), 10), { torpedo: 13, evasion: 2, accuracy: 1 })
    //    名单外的日本籍驱逐：只有 単体ボーナス1 的日駆逐行，且 ★+4 才起步
    assert.deepEqual(at(577, jpDd, 0), {}, '★+4 以下一格都没有')
    assert.deepEqual(at(577, jpDd, 4), { torpedo: 1 })
    assert.deepEqual(at(577, jpDd, 8), { torpedo: 2, accuracy: 1 })

    // ④ 578 SB2U-2：美英空母各一档，其余空母 + 三艘特务舰共用最后一档
    assert.deepEqual(at(578, ship(9201, 9902, 11, 4), 9), {
      fire: 1,
      aa: 1,
      evasion: 1,
      los: 1,
      accuracy: 1,
    })
    assert.deepEqual(at(578, ship(723, 9902, 11, 4), 9), {
      fire: 2,
      aa: 1,
      evasion: 2,
      los: 2,
      accuracy: 2,
    }, 'Lexington 是点过名的，不掉进「上記以外のアメリカ空母」')
    assert.deepEqual(at(578, arkRoyal, 9), { aa: 1, evasion: 1, los: 1, accuracy: 1 })
    assert.deepEqual(at(578, ship(9202, 9902, 11, 1), 9), { aa: 1, evasion: 1, accuracy: 1 }, '日本籍空母走「その他」')
    assert.deepEqual(at(578, ship(9202, 9902, 11, 1), 4), {}, '「その他」那一档 ★+4 整行是空的')
    assert.deepEqual(at(578, ship(9202, 9902, 11, 1), 7), { accuracy: 1 })
    assert.deepEqual(
      at(578, ship(900, 115, 22, 1), 9),
      { aa: 1, evasion: 1, accuracy: 1 },
      '山汐丸按 stype 不是空母，靠逐形态点名进「その他」那一档',
    )
    assert.deepEqual(at(578, ship(943, 119, 17, 1), 9), { aa: 1, evasion: 1, accuracy: 1 }, '熊野丸同上')
  },
)
