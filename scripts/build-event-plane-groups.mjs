#!/usr/bin/env node
// 生成《活动陆航特効分组事实表》——第一方随包资料包。
//
// 这是**合成器，不是日常工序**：往后维护直接改 assets/lodes/event-plane-groups.json，
// 或者改本文件下面那张台账再重跑。跑法：
//   node scripts/build-event-plane-groups.mjs
//
// ── 这张表记的是什么 ───────────────────────────────────────────────
// 本期活动给一部分机体分了「特効组」。舰上机吃 A/B 组，**基地（陆航）只吃 C 组**，
// 一件装备可以同属多组，算哪一侧就只看哪一侧的组。倍率本身（哪张图哪个点 C2 是多少）
// 在 `event-bonus` 包里，**这张表只答「哪架飞机属于哪个 C 组」**——两件事分开存，
// 因为倍率每期都换、分组表是另一个页面上的另一张表。
//
// 三条机制原文（两家措辞一致，见下方 maintainerNote 的出处）：
//   · 陆航的 C 组倍率对**所在队伍中的 4 架飞机全部生效**（整队倍率，不是单格倍率）；
//   · **同组不重复**：队里两架都是 C2 也只乘一次 1.2；异组才叠乘（C2×C3）；
//   · 搭载数归零则该件的特効失效（推荐搭配是满编规划，不涉及这一条）。
//
// ── 为什么是第一方表 ──────────────────────────────────────────────
// 与 equip-improve / equip-aa-evasion 同一套法理：**哪架机体属于哪个特効组是策划定的
// 客观事实**，由游戏决定，不属于任何转录者；攻略站是把事实抄下来的人。
// 所以 schema 是我们的、取舍是我们的、随源码分发。
//
// ── 置信度：两家一致，但**不是两票** ──────────────────────────────
// 名单核过两家：wikiwiki 活动页 E4/E5 的「航空機特効」表（表头 基地c → C1/C2/C3）
// 与 kcwiki《2026年夏季活动海外舰载机倍卡分组》。**两家 37/37 完全一致**，
// 但两家都写明自己转自同一份社区分类表（Google 表格「海外艦載機/基地特効分類2026 V0.9」，
// 最后更新 2026.07.28）——**同源转录，不算两票独立**。
// 一致性证明的是「誊抄没串行」，不证明上游那张表本身对。basis 照此写「同源转录」。
//
// ⚠️ 解析这两个页面各有一个会让人读错组别的坑，都已踩过并修掉：
//   · kcwiki wikitext：`|}` 是表尾不是单元格，漏掉它会让**每张表的最后一行**整体错位
//     一格——正好把 Do 17 Z-2 / Mosquito PR Mk.IV / Ho229 三件读成邻组；
//   · wikiwiki HTML：rowspan 的额度要在**本行就扣**，晚扣一行会让「機種」列失效那几行
//     整体左移，同样错组。
// 下面的台账是修掉这两个坑之后、两家逐行一致的结果，并已逐件对上游戏主数据
// （api_mst_slotitem，37/37 全部命中、0 条落空）。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT =
  process.env.KANSO_PLANE_GROUPS_OUT || path.join(ROOT, 'assets', 'lodes', 'event-plane-groups.json')

/** 这张表属于哪一期。与 event-bonus 包的 `page=` 期号对得上才生效——换期后整表自动退场。 */
const EVENT_PAGE = '2026年夏季活动'
/** 上游分类表自称的最终更新日（誊抄当时）——记进 meta，不是给玩家看的 */
const UPSTREAM_UPDATED_AT = '2026-07-28'
const TRANSCRIBED_AT = '2026-08-28'

/**
 * 台账：[装备主数据 id, C 组代号, 主数据原名]
 *
 * 名字只为人工比对留痕，消费端一律按 id 查表。顺序照上游表的分节
 * （艦戦→艦攻→艦爆→偵察→陸攻→陸戦局戦→噴式），只为比对方便。
 *
 * **C1 本期一个点都没有倍率**（深山/深山改 两件在表里，但 E1–E5 的 C1 列全是空）。
 * 照收不删：这是上游确实分了组、只是这期没给倍率，与「没查到」是两回事。
 */
const LEDGER = [
  // ── C1 ── 陸上攻撃機
  [396, 'C1', '深山改'],
  [395, 'C1', '深山'],

  // ── C2 ──
  // 艦上戦闘機
  [435, 'C2', 'Corsair Mk.II(Ace)'],
  [434, 'C2', 'Corsair Mk.II'],
  [473, 'C2', 'F4U-2 Night Corsair'],
  [252, 'C2', 'Seafire Mk.III改'],
  // 艦上攻撃機
  [481, 'C2', 'Mosquito TR Mk.33'],
  // 艦上爆撃機
  [475, 'C2', 'AU-1'],
  [476, 'C2', 'F4U-7'],
  [474, 'C2', 'F4U-4'],
  // 水上偵察機 / 艦上偵察機
  [515, 'C2', 'Sea Otter'],
  [423, 'C2', 'Fulmar(戦闘偵察/熟練)'],
  [471, 'C2', 'Loire 130M'],
  // 陸上攻撃機
  [433, 'C2', 'SM.79 bis(熟練)'],
  [479, 'C2', 'Mosquito FB Mk.VI'],
  // 陸軍戦闘機 / 局地戦闘機 / 陸上偵察機
  [516, 'C2', 'Me 262 A-1a/R1'],
  [253, 'C2', 'Spitfire Mk.IX(熟練)'],
  [251, 'C2', 'Spitfire Mk.V'],
  [250, 'C2', 'Spitfire Mk.I'],
  [480, 'C2', 'Mosquito PR Mk.IV'],
  // 噴式機
  [561, 'C2', 'Ho229'],

  // ── C3 ──
  // 艦上戦闘機
  [353, 'C3', 'Fw190 A-5改(熟練)'],
  [189, 'C3', 'Re.2005 改'],
  [159, 'C3', 'Fw190T改'],
  [158, 'C3', 'Bf109T改'],
  [184, 'C3', 'Re.2001 OR改'],
  [249, 'C3', 'Fulmar'],
  // 水上偵察機
  [510, 'C3', 'Walrus'],
  // 陸上攻撃機
  [406, 'C3', 'Do 217 K-2+Fritz-X'],
  [562, 'C3', 'Do 217 E-5+TV誘導型 Hs293D'],
  [405, 'C3', 'Do 217 E-5+Hs293初期型'],
  [432, 'C3', 'SM.79 bis'],
  [431, 'C3', 'SM.79'],
  [459, 'C3', 'B-25'],
  [401, 'C3', 'Do 17 Z-2'],
  // 陸軍戦闘機 / 局地戦闘機 / 大型飛行艇
  [354, 'C3', 'Fw190 D-9'],
  [178, 'C3', 'PBY-5A Catalina'],
]

const BASIS = `同源转录 · 两家一致但同根 ${UPSTREAM_UPDATED_AT}`

const seen = new Set()
for (const [eqId] of LEDGER) {
  if (seen.has(eqId)) throw new Error(`台账里 eq_id ${eqId} 出现了两次`)
  seen.add(eqId)
}

const data = {
  event: EVENT_PAGE,
  groups: LEDGER.reduce((acc, [eqId, group]) => {
    ;(acc[group] ??= []).push(eqId)
    return acc
  }, {}),
  names: Object.fromEntries(LEDGER.map(([eqId, , name]) => [eqId, name])),
  basis: BASIS,
}

const existing = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null

const pack = {
  meta: {
    id: 'event-plane-groups',
    name: '活动陆航特効分组事实表（第一方）',
    version: TRANSCRIBED_AT.replace(/-/g, '.'),
    source: 'kuma 活动陆航特効分组事实表（第一方整理）',
    // 内容没变就不动时间戳——幂等，重跑不产生假的「刚更新」
    fetchedAt: existing?.meta?.fetchedAt ?? new Date().toISOString(),
    upstreamUpdatedAt: UPSTREAM_UPDATED_AT,
    license: '第一方事实表：记的是游戏定的客观事实（哪架机体属于哪个特効组），随源码分发',
    note: '本期活动里哪架飞机属于哪个陆航特効组',
    maintainerNote: [
      `期号 ${EVENT_PAGE}：与 event-bonus 包的 page= 对不上就整表不生效，换期后自动退场，不拿上一期的名单套这一期。`,
      '舰上机吃 A/B 组、基地（陆航）只吃 C 组；一件装备可同属多组，算哪一侧就只看哪一侧。' +
        '本表只收 C 组——A/B 组上游同页有，但舰上那一侧目前没有消费端，收进来就是死数据。',
      '陆航 C 组倍率对所在队伍中的 4 架飞机全部生效（整队倍率）；同组不重复，异组叠乘；搭载归零则失效。',
      `名单核过两家：wikiwiki 活动页 E4/E5 的「航空機特効」表（表头 基地c → C1/C2/C3）与 ` +
        `kcwiki《2026年夏季活动海外舰载机倍卡分组》，37/37 完全一致。` +
        `**但两家都写明转自同一份社区分类表**（Google 表格「海外艦載機/基地特効分類2026 V0.9」，` +
        `自称最终更新 ${UPSTREAM_UPDATED_AT}）——同源转录，不算两票独立。` +
        `一致只证明誊抄没串行，不证明上游那张表本身对；要升格得靠账本实测。`,
      '两个解析坑（都踩过）：kcwiki wikitext 的 `|}` 是表尾不是单元格，漏掉它会让每张表的最后一行整体错位一格' +
        '（Do 17 Z-2 / Mosquito PR Mk.IV / Ho229 三件会被读成邻组）；' +
        'wikiwiki HTML 的 rowspan 额度要在本行就扣，晚扣一行会让「機種」列失效的那几行整体左移。',
      `37 件逐条对过游戏主数据 api_mst_slotitem，全部按名命中、0 条落空（誊抄于 ${TRANSCRIBED_AT}）。`,
      'C1（深山/深山改）本期一个点都没有倍率——上游确实分了这个组、只是这期没给数，与「没查到」是两回事，照收不删。',
      '维护直接改这张表，或改 scripts/build-event-plane-groups.mjs 的台账后重跑（幂等，内容没变不动 fetchedAt）。',
    ],
  },
  data,
}

const next = `${JSON.stringify(pack, null, 2)}\n`
// 只比内容，不比 fetchedAt：内容一致就一个字节都不写
if (existing && JSON.stringify(existing.data) === JSON.stringify(pack.data)) {
  console.log(`内容未变，未改动 ${path.relative(ROOT, OUT)}（${LEDGER.length} 条）`)
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, next, 'utf8')
  console.log(`已写出 ${path.relative(ROOT, OUT)}：${LEDGER.length} 条`)
}
