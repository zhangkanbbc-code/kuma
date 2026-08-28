// 改修事实表的**合成器**（维护者侧，零网络，幂等可重跑）。
//
// ---- 这个脚本存在的理由 ----
// 改修数据原先走 `equip-upgrades` 这个自取包：上游没有可再分发的许可，于是它
// `bundle: false`，玩家那份产物里根本没有——**首发玩家打开改修卡看到的是一片「待补」**。
// 而改修的消耗、二号舰、开放星期、更新链是**游戏机制的客观事实**：它们由游戏决定，
// 不属于任何转录者。攻略站是把这些事实抄下来的人，不是这些事实的来源。
//
// 所以改修数据改成**第一方事实表随包**：结构是 kuma 自己的，每条带 `basis` 写明这一格
// 现在的置信等级（整理参照 / 官方公告 / 游戏内实测），实测到了就升级。
// 法理与维护口径写在产物的 `meta.maintainerNote` 里，跟着数据走。
//
// ---- 初始表怎么来 ----
// 这一版从开发树里已有的 `equip-upgrades` 包 + 校正台账 `shared/equip-upgrade-corrections`
// 合成：校正（322/294/21/66 四案与通则批量补档）在合成时**吃进事实表**，
// 从此事实表就是底座，不再叠一层。pending 逐条带过来，继续挂着等实测。
//
// 往后维护走两条路，都不需要这个脚本：
//   · 游戏内实测到了 → 直接改事实表那一格，basis 升级成「游戏内实测 YYYY-MM-DD」；
//   · 官方公告说了 → 同上，basis 写「官方公告 YYYY-MM-DD」。
// 与上游对照用 `scripts/diff-equip-improve.mjs`（那个才是抓取器降级后的去处）。
//
// 幂等：同样的输入产出同样的字节（`fetchedAt` 除外——那一格保留既有值，
// 只有内容真的变了才动）。重跑不会制造假的「刚更新」。
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(here, '..')
const UPSTREAM = path.join(ROOT, 'assets', 'lodes', 'equip-upgrades.json')
// 输出路径可用环境变量改道：幂等护栏拿它把产物写到临时目录去比字节，
// 测试期间不再碰仓里那份（并行跑的另外两份测试正在读它）。
const CANON = path.join(ROOT, 'assets', 'lodes', 'equip-improve.json')
const OUT = process.env.KANSO_EQUIP_IMPROVE_OUT || CANON
const DIST = path.join(ROOT, 'dist', 'shared', 'equip-upgrade-corrections.js')

// ---- basis 的档位 ----
//
// 事实表**随包分发**，所以每条的 basis 写的是「这一格现在有多硬」，
// 不是「我参照了谁」。判据来路（哪张表、哪一次裁决、为什么这么裁）留在
// `shared/equip-upgrade-corrections` 的头注与条目里，那是给维护者看的。
// 随包数据里逐条点名转录者，既是散布署名（纪律七之三），也把注意力从
// 「这个数可不可信」引到「这个数抄自谁」——玩家要的是前者。
//
// 四档，从弱到强：
const BASIS_DEFAULT = '整理参照·交叉核对'
const BASIS_RULE = '机制通则推定 · 2026-08-25'
const officialBasis = (date) => `整理参照·交叉核对 · 官方公告 ${date} 佐证`
const measuredBasis = (date) => `游戏内实测 ${date}`

/**
 * 逐件裁过的那四件：行级置信按**这一行凭什么**给，不照抄台账里的长篇判据。
 *
 * key 是 `eqId`，值是一个函数：拿到那一行，回答它属于哪一档。
 * 认行靠更新目标（`convert`）——比行序可靠，上游调过行序也不会认错。
 */
const JUDGED_ROW_BASIS = new Map([
  // 322 瑞雲改二(六三四空)：用户在游戏里点出来的那一件，两行同源
  [322, () => measuredBasis('2026-08-25')],
  // 294 12.7cm連装砲A型改二：照表补的一段，未实测
  [294, () => BASIS_DEFAULT],
  // 21 零式艦戦52型：龍鳳能改能更新是官方公告说的；瑞鶴那一整行是照表补的
  [
    21,
    (row) => (row.convert ? officialBasis('2024-05-29') : BASIS_DEFAULT),
  ],
  // 66 8cm高角砲：前半素材那次变更是官方公告说的；能代/阿賀野那行是按通则补的
  [
    66,
    (row) => (row.convert ? officialBasis('2026-03-13') : BASIS_RULE),
  ],
])

/**
 * `pending` 同样重写成不点名的说法。
 *
 * 挂牌的意义是「这一格还没定，别当准数用」，读的人不需要知道是哪两家资料打架。
 */
const PENDING_TEXT = new Map([
  [
    21,
    ['龍鳳的形态范围待核：官方公告只写了「龍鳳」，没说改造后的形态算不算，等游戏内实测'],
  ],
  [
    66,
    [
      '鈴谷航改二能不能当这件的二号舰待核：两份公开资料在这一格不一致，等游戏内实测',
      '官方公告里那次前半素材变更，写的菜单名与游戏内装备名对不上（近似的另有一件），' +
        '所以这条公告到底说的是哪一件待核；两件的前半素材现在都是同一件装备，从数据上分不出',
    ],
  ],
  [
    322,
    ['最上改二特的开放星期待核：公开资料那一格只写了最上改二，本表按上游把两者记作同样的星期'],
  ],
])

const die = (message) => {
  console.error(`[equip-improve] ${message}`)
  process.exit(1)
}

if (!existsSync(UPSTREAM)) {
  die(
    `找不到 ${path.relative(ROOT, UPSTREAM)}——先跑 npm run lodes:fetch 把开发树的自取包补齐。\n` +
      '（这个包不随发行版，只在维护者机器上存在；事实表一旦合成好，玩家侧就不需要它了。）',
  )
}
if (!existsSync(DIST)) die('dist 里没有校正台账，先跑 npm run build')

const corrections = (await import(pathToFileURL(DIST).href)).default
const {
  EQUIP_UPGRADE_CORRECTIONS,
  EQUIP_UPGRADE_LADDER_FILLS,
  applyEquipUpgradeCorrections,
} = corrections

const upstream = JSON.parse(readFileSync(UPSTREAM, 'utf8'))
const upstreamRows = Array.isArray(upstream.data) ? upstream.data : Object.values(upstream.data ?? {})
if (!upstreamRows.length) die('上游包里一条装备都没有，不合成')

const { rows, report } = applyEquipUpgradeCorrections(upstreamRows)
if (report.skipped.length) {
  die(
    `校正台账有 ${report.skipped.length} 条没生效：${JSON.stringify(report.skipped)}\n` +
      '上游变样了或同档消耗打架。**先把台账重审一遍**，不要合成一份带着过期判据的事实表。',
  )
}

const correctionFor = new Map(EQUIP_UPGRADE_CORRECTIONS.map((one) => [one.eqId, one]))
const fillFor = new Map(EQUIP_UPGRADE_LADDER_FILLS.map((one) => [one.eqId, one]))

/**
 * 一行的置信。
 *
 * 只有**被动过的行**才升到默认档以上：逐件裁过的那四件里，原样抄回上游的那几行
 * 与被补过的那一行来路不一样，分开标。判据是拿上游同一行逐字比对，
 * 比「我记得改了哪一行」可靠——上游哪天调了行序也不会认错。
 */
const rowBasis = (eqId, row, upstreamRow) => {
  const untouched = upstreamRow && JSON.stringify(row) === JSON.stringify(upstreamRow)
  if (untouched) return BASIS_DEFAULT
  const judged = JUDGED_ROW_BASIS.get(eqId)
  if (judged) return judged(row)
  // 通则补档那批：这一行的档位是按机制通则推出来的，不是哪份资料上抄的
  if (fillFor.has(eqId)) return BASIS_RULE
  return BASIS_DEFAULT
}

/** 行的稳定身份：更新目标 + 二号舰名单。用来在上游里找到对应的那一行 */
const rowKey = (row) =>
  [
    Number(row?.convert?.id_after) || 0,
    (row?.helpers ?? [])
      .flatMap((one) => (one?.ship_ids ?? []).map(Number))
      .sort((a, b) => a - b)
      .join('.'),
  ].join('#')

const data = rows
  .map((entry) => {
    const eqId = Number(entry.eq_id)
    const upstreamEntry = upstreamRows.find((one) => Number(one.eq_id) === eqId)
    const upstreamByKey = new Map(
      (upstreamEntry?.improvement ?? []).map((row) => [rowKey(row), row]),
    )
    const improvement = (entry.improvement ?? []).map((row) => ({
      convert: row.convert ?? null,
      helpers: (row.helpers ?? []).map((one) => ({
        ship_ids: [...(one.ship_ids ?? [])].map(Number),
        days: [...(one.days ?? [])].map(Number),
      })),
      costs: row.costs ?? {},
      basis: rowBasis(eqId, row, upstreamByKey.get(rowKey(row))),
    }))
    // pending 用不点名的说法重写（见 PENDING_TEXT）。台账里挂着牌、这里却没有，
    // 说明重写表漏了一件——宁可当场停，也不要悄悄把一条待核项吞掉
    const hasPending = Boolean(
      correctionFor.get(eqId)?.pending?.length || fillFor.get(eqId)?.pending?.length,
    )
    const pending = PENDING_TEXT.get(eqId)
    if (hasPending && !pending) die(`eq_id=${eqId} 台账里挂着待核项，但 PENDING_TEXT 里没有对应的说法`)
    if (pending && !hasPending) die(`eq_id=${eqId} 的 PENDING_TEXT 是多余的，台账里并没有待核项`)
    return {
      eq_id: eqId,
      improvement,
      ...(pending?.length ? { pending: [...pending] } : {}),
    }
  })
  .sort((a, b) => a.eq_id - b.eq_id)

// 「上一版」永远参照仓里那份（保持时间戳不因内容未变而跳动），与「写到哪」分开：
// 幂等护栏把输出改道到临时目录时，参照物仍是仓里的，否则每次都打新时间戳、字节必不同。
const previous = existsSync(CANON) ? JSON.parse(readFileSync(CANON, 'utf8')) : null
const sameContent = previous && JSON.stringify(previous.data) === JSON.stringify(data)

const out = {
  meta: {
    id: 'equip-improve',
    name: '装备改修事实表（第一方）',
    // 版号与 fetchedAt 同一条规矩：内容没变就留着上一版的。
    // 这里从前无条件打今天的日期，于是隔一天重跑就必然差一个字段——
    // 幂等护栏从 2026-08-26 起天天红，而它报的正是真事：版号在假装「刚更新」。
    version: sameContent
      ? previous.meta.version
      : new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
    source: 'kuma 改修事实表（第一方整理）',
    // 内容没变就不动时间戳：重跑一遍不该看起来像「刚更新过」
    fetchedAt: sameContent ? previous.meta.fetchedAt : new Date().toISOString(),
    upstreamUpdatedAt: null,
    license: '第一方事实表：记的是游戏机制的客观事实（消耗/二号舰/星期/更新链），随源码分发',
    note: '每件改修要花多少、能找谁当二号舰、开在星期几、推满之后能更新成什么',
    maintainerNote: [
      '**事实来源是游戏本身**（以官方公告为准）；整理时参照过公开攻略资料；校核靠官方公告、多份资料交叉、以及游戏内实测。',
      '改修的消耗、二号舰、开放星期、更新链都是**游戏机制的客观事实**——它们由游戏决定，不属于任何转录者。攻略站是把这些事实抄下来的人，不是这些事实的来源。所以这张表是 kuma 自己的第一方整理：schema 是我们的，取舍与判据是我们的，每条带 basis 写明置信等级。',
      '`basis` 三档，宽严递增：`整理参照·交叉核对`（照公开资料整理并互相核对过，多数条目是这一档）／`官方公告 YYYY-MM-DD`（官方自己说过这一格）／`游戏内实测 YYYY-MM-DD`（有人在游戏里点出来过）。**实测到了就升级**，别让一条已经验过的事实一直挂在最低档；反过来也不许把没验过的写成实测。',
      '行级 basis 与件级可以不同：同一件装备里，被逐条裁过的那一行与照抄上游的那一行来路不一样，分开标。',
      '`pending` 是**记下来但没裁**的分歧（两份资料互斥、或官方文说得不够细），只挂牌不改数据，等游戏内实测。别因为它挂着就去猜一个值填上。',
      '这一版由 `scripts/build-equip-improve.mjs` 从开发树的自取包 + 校正台账合成（那个自取包已退役，玩家侧从来没有过它）。**往后维护直接改这张表**：实测到了改那一格并升级 basis，不必再跑合成器。与上游对照用 `scripts/diff-equip-improve.mjs`。',
    ],
  },
  data,
}

// 先写旁边的临时文件再 rename 顶上去：rename 是原子替换，别处正在读的进程只会
// 看到旧的整份或新的整份，不会读到半截。2026-08-26 实证：node --test 多进程并行时，
// 幂等护栏这边原地重写、那边 ladder-fill 正在读，JSON.parse 撞上半截文件红过四次。
const tmp = `${OUT}.tmp-${process.pid}`
writeFileSync(tmp, `${JSON.stringify(out, null, 1)}\n`)
renameSync(tmp, OUT)

const tally = new Map()
for (const entry of data)
  for (const row of entry.improvement) tally.set(row.basis, (tally.get(row.basis) ?? 0) + 1)
const pendingCount = data.filter((one) => one.pending?.length).length

console.log(`[equip-improve] ${data.length} 件装备 · ${[...tally.values()].reduce((a, b) => a + b, 0)} 套方案`)
for (const [basis, count] of [...tally].sort((a, b) => b[1] - a[1]))
  console.log(`[equip-improve]   ${count} 行  ${basis}`)
console.log(`[equip-improve] ${pendingCount} 件挂着待核项`)
console.log(`[equip-improve] ${sameContent ? '内容未变，时间戳保持原样' : '已写入'} → ${path.relative(ROOT, OUT)}`)
