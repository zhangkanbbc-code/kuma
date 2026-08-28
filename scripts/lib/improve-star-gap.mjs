// 逐星加成 × 改修表的**两源夹缝台账**（形态照 `scripts/lib/fit-bonus-conflicts.mjs`
// 的 `PENDING_FIT_BONUS_CONFLICTS` 与 `scripts/lib/map-drop-windows.mjs` 的
// `PENDING_LIMITED_WINDOW_CLAIMS`）。
//
// ---- 夹缝是什么 ----
//
// 装备抽屉的「逐星加成」表写在 `if (!eo?.improvement?.length) return …` 的**下游**：
// 改修表（`equip-upgrades`，源自 wikiwiki 改修表）没有这件装备的改修方案时，
// 整段改修区早退成一句挂牌，akashi 那份逐星数据即使有也渲染不到。
//
// 于是这几件装备上两个源各说各的：
//   · **akashi-list**：给得出一张 ★1–★10 的逐星加成表（下面 `akashiStarTable` 逐格转写）；
//   · **改修表**：没有这件装备的改修行（`improveLedger: null`）。
//     其中 24 件落在覆盖号段**之内**（收到第 575 号），按那份资料的口径就是「不可改修」；
//     只有 577 号一件在覆盖之外，属于「还没收录到这个号」。
//     （「没有改修行」≠「整份表没提过它」——6 件在别人的行上出现过，见下面 08-24 复核。）
//
// ---- 为什么不动数据 ----
//
// 把 `starTable` 提到闸门外可以解开连坐，**但可能更糟**：若那些装备本来就不可改修，
// 摆一张逐星加成表就是显示一份不存在的东西。这是**两个源谁对**的数据问题，
// 按「歧义装备四方取票」的既定纪律该列清单让用户过目，不该由代码代拍。
// 所以这张表**不参与任何判定**，只被 `lodes:reconcile` 的报告带出来给人看
//（渲染层一行不读它，行为与 2026-08-23 之前逐字节一致）。
//
// ---- 自失效 ----
//
// `akashiStarTable` 是这一格此刻的**逐格指纹**（与渲染层 `starRows` 同一套筛选口径：
// 至少 10 列、且不全为空）。上游改一个数指纹就变，`test/improve-star-gap.test.mjs`
// 当场报「指纹已变，要重新核」，而不是让台账继续按一份已经不存在的分歧说话。
// 哪天用户裁完一条（或改修表收录了它），把那一行删掉即可，机制不变。
//
// ---- 2026-08-24 复核：25 条一条没动，但「改修表连条目都没有」这句话要改口 ----
//
// 两个包都重抓了：改修表上游 Last-modified 仍是 2026-08-17（**解析结果与上一版逐字节
// 相同**，372 件 / 411 套方案，0 条警告），akashi 换了两件新装备（579 / 580，都没有逐星表）
// 与两张逐星表（174 / 385，都不在本台账里）。于是 25 条**一条都没收敛**，指纹与覆盖内外
// 逐条对得上——`resolved` / `fingerprint` / `coverage` 三种失效一个都没触发。
//
// 复核新查出来的一件事，写进 `upstreamRef`：**改修表并不是「不知道这几件装备」**。
// 逐件回原页扫过之后，25 件里有 6 件在改修表正文里出现过，只是出现在别人的行上：
//   · 5 件是别人的**更新先**：100←九九式艦爆(江草隊) / 177←三式戦 飛燕一型丁 /
//     191←毘式40mm連装機銃（原文写明 ⇒★+1）/ 320←彗星一二型甲 / 504←銀河；
//   · 彩雲(54) 是 4 处改修的**消费装备**（紫雲 / S-51J / Swordfish Mk.II改(水偵型) /
//     SBD VS-2(偵察飛行隊)）。
// 也就是说这 6 件上改修表的口径是「这件装备我认得，但它自己没有改修方案」——
// 比「一次都没提到」（余下 19 件）更硬。191 那条尤其要留意：更新出来就带 ★+1，
// 逐星表在它身上**不是一份不存在的东西**，至少 ★1 那一格玩家真拿得到。
//
// 第二票去 kcwiki 找过了，**但不够格当第二票**：zh.kcwiki「模块:舰娘装备数据改」的
// `装备改修*` 字段（309 件）对这 25 件全部为空，方向上附议改修表——可它整体漏收 63 件
// 改修表有的可改修装备，其中 39 件还落在 ≤520 的老号段（烈風 一一型 53、Ju87C改 64、
// 天山一二型(友永隊) 94…），**这个源的「没有」本来就不可信**，附议不加分。
// 一手面板票（装上去看后面板）这边取不到。按可靠性阶梯只剩「日文侧近验一票 + 弱附议」，
// 够不上两票，所以 25 件**一件都不代拍**，整批留给主会话。
//
// 条目**不删**（口径与 event-bonus / map-drops / map-enemy-comps 三处台账一致）：
// 删了下一轮会把同一件事当新待裁项重新冒出来，而这一轮查到的东西就没了。
// 只多带 `recheckedAt` 与 `upstreamRef` 两个字段。
//
// ---- 2026-08-24 追加：不可改修 ≠ 拿不到 ★ ----
//
// 上面「为什么不动数据」那段担心的是：**若那些装备本来就不可改修，摆一张逐星加成表
// 就是显示一份不存在的东西**。顺着「逐装备页是不是比总表新」那一轮出网，把抽到的
// 几页的「入手方法」也读了——这句担心至少在查到的两件上**不成立**：
//   · 彩雲(54)：クォータリー 任務『航空戦隊演習(その弐)』的选择报酬就是 **★+2 彩雲**。
//     而且 wikiwiki 那页自己就按 ★ 档列装备加成（★+2~3 / ★+4~5 / ★+6~9），
//     与 akashi 逐星表里「空母ボーナス 在 ★2 给 索敵+1」这一格逐格对得上。
//   · 577：2026 夏活动 E3 突破报酬直接发 **(甲)★+8 ×1 / (乙)★+4 ×1**——玩家一到手
//     就是 ★8，逐星表里 ★4 与 ★8 那两格正是他要读的东西。
// （同轮查的 579 也一样：E4 突破选择报酬 (甲)★+6 ×1。它没有 akashi 逐星表，不在本台账。）
//
// 所以「不可改修」与「逐星表有用」在这些件上是同时成立的：★ 不是只能从改修工厂来。
// **但这一列只查了抽样的那几件**，余下 23 件的入手方法没有逐页去看（一轮出网只抽了 6 页）。
// 要裁之前该把这一列补齐——按「说没有之前先穷举」的规矩，这里写明的是
// 「查过 54 与 577，没查另外 23 件」，不是「另外 23 件拿不到 ★」。
//
// 另：577 那件的问法变了。台账原来记的是「改修表还没收录到这个号，回答不了」，
// 现在两站逐页都明说了：wikiwiki 2026-08-22 備考栏「改修不可」（无链纯文字），
// kcwiki 2026-08-08 正文「所缺的仅仅是目前暂未开放改修罢了」。**这是本轮唯一凑齐
// 两票的一条**——但两票的方向是「不可改修」，与 akashi 的逐星表并不互斥
//（akashi 从头到尾没说过它可改修，它那张表里根本没有改修可否这个字段），
// 所以仍然不是「谁对」的裁决，只是让主会话手里多一条硬事实。
// `withinImproveCoverage: false` 不改：那说的是**总表的号段**，仍然是准的。

/**
 * @typedef {object} ImproveStarGap
 * @property {number} equipId               装备 mstId
 * @property {string} equipName             装备日文原名（给人读的锚，不参与判定）
 * @property {string} akashiStarTable       akashi 那张逐星表的逐格指纹
 * @property {null} improveLedger           改修表此刻在这一格是怎么写的（`null` = 根本没有这一条）
 * @property {boolean} withinImproveCoverage 是否落在改修表的覆盖号段内
 *                                          （`true` = 那份资料的口径是「不可改修」；
 *                                           `false` = 它还没收录到这个号，回答不了）
 * @property {ImproveStarGapUpstreamRef} upstreamRef 改修表在**别人的行**上有没有提到它
 * @property {string} recheckedAt           最后一次回上游逐件复核的日期（YYYY-MM-DD）
 */

/**
 * @typedef {'convert' | 'consume' | 'convert+consume' | 'absent'} ImproveStarGapUpstreamRef
 *
 * `convert`  它是别人改修的**更新先**——改修表认得这件装备，只是不给它自己的改修行；
 * `consume`  它是别人改修的**消费装备**，同上；
 * `absent`   整份改修表一次都没提到它。
 */

/**
 * 一件装备的逐星表指纹。
 *
 * 口径必须与渲染层的 `starRows` 一致——那边筛掉「不足 10 列」与「10 列全空」的属性行，
 * 这里也筛。不然台账盯着的东西和界面上会显示的东西不是同一份。
 *
 * @param {Record<string, unknown[]> | null | undefined} remodel akashi 的 `item_remodel`
 * @returns {string} 没有可显示的行时返回空串
 */
export const improveStarTableFingerprint = (remodel) =>
  Object.entries(remodel ?? {})
    .filter(
      ([, values]) =>
        Array.isArray(values) &&
        values.length >= 10 &&
        values.slice(0, 10).some((value) => `${value ?? ''}`.trim()),
    )
    .map(
      ([stat, values]) =>
        `${stat}[${values
          .slice(0, 10)
          .map((value) => `${value ?? ''}`.trim() || '-')
          .join('/')}]`,
    )
    .sort()
    .join(';')

/**
 * 改修表在**别人的行**上是怎么提到这些装备的。
 *
 * 「没有自己的改修行」与「整份表一次都没提到」是两回事：前者是改修表**认得这件装备
 * 却不给它方案**（更硬的「不可改修」），后者只是沉默。台账要分得清这两句话，
 * 所以这一层从包里现算，而不是靠人记。
 *
 * @param {unknown} upgrades `equip-upgrades` 的 `data`
 * @returns {Map<number, ImproveStarGapUpstreamRef>} 只收 `convert` / `consume` 两类，其余按 `absent` 处理
 */
export const improveUpstreamRefs = (upgrades) => {
  const rows = Array.isArray(upgrades) ? upgrades : []
  const converted = new Set()
  const consumed = new Set()
  for (const row of rows) {
    for (const convert of row?.convert_to ?? []) {
      const id = Number(convert?.id_after)
      if (id > 0) converted.add(id)
    }
    for (const improvement of row?.improvement ?? []) {
      for (const stage of [improvement?.costs?.p1, improvement?.costs?.p2, improvement?.costs?.conv]) {
        for (const need of stage?.equips ?? []) {
          const id = Number(need?.id)
          // 「同装備x1」解析出来就是自己，那不算「别人提到它」
          if (id > 0 && id !== Number(row?.eq_id)) consumed.add(id)
        }
      }
    }
  }
  const out = new Map()
  for (const id of new Set([...converted, ...consumed])) {
    out.set(
      id,
      converted.has(id) && consumed.has(id)
        ? 'convert+consume'
        : converted.has(id)
          ? 'convert'
          : 'consume',
    )
  }
  return out
}

/**
 * 此刻真落在夹缝里的装备。
 *
 * @param {{ akashi: unknown, upgrades: unknown }} packs 两个包的 `data`
 * @returns {{ equipId: number, akashiStarTable: string, withinImproveCoverage: boolean,
 *            upstreamRef: ImproveStarGapUpstreamRef }[]} 按 mstId 升序
 */
export const improveStarGapRows = ({ akashi, upgrades }) => {
  const rows = Array.isArray(upgrades) ? upgrades : []
  const withScheme = new Set(
    rows.filter((row) => row?.improvement?.length).map((row) => Number(row.eq_id)),
  )
  const coverageMax = rows.reduce((max, row) => Math.max(max, Number(row?.eq_id) || 0), 0)
  const refs = improveUpstreamRefs(rows)
  const out = []
  for (const [key, item] of Object.entries(akashi?.items ?? {})) {
    const equipId = Number(key)
    if (!(equipId > 0) || withScheme.has(equipId)) continue
    const akashiStarTable = improveStarTableFingerprint(item?.item_remodel)
    if (!akashiStarTable) continue
    out.push({
      equipId,
      akashiStarTable,
      withinImproveCoverage: equipId <= coverageMax,
      upstreamRef: refs.get(equipId) ?? 'absent',
    })
  }
  return out.sort((left, right) => left.equipId - right.equipId)
}

/**
 * 台账 × 实况逐条比。两边对不上就是有人动了包（或动了台账），要人重核。
 *
 * @returns `{ rows, summary }`；rows 的 kind：
 *          `unlisted`    实况在夹缝里而台账没有这一条（要补一行）
 *          `resolved`    台账有而实况已经不在夹缝里（改修表收录了，或 akashi 撤了表——删这一行）
 *          `fingerprint` 两边都有，但逐星表的数变了（旧裁决作废，要重新核）
 *          `coverage`    覆盖内外的判定翻了（「不可改修」与「还没收录」互换，说法要跟着改）
 *          `upstreamref` 改修表提到它的方式变了（比如从「一次没提」变成「是谁的更新先」，
 *                        那多半意味着上游给它排了新链，值得回去看一眼）
 */
export const diffImproveStarGaps = ({ akashi, upgrades, ledger = PENDING_IMPROVE_STAR_GAPS }) => {
  const live = new Map(improveStarGapRows({ akashi, upgrades }).map((row) => [row.equipId, row]))
  const known = new Map(ledger.map((entry) => [entry.equipId, entry]))
  const rows = []
  for (const [equipId, row] of live) {
    const entry = known.get(equipId)
    if (!entry) {
      rows.push({ kind: 'unlisted', equipId, live: row.akashiStarTable })
      continue
    }
    if (entry.akashiStarTable !== row.akashiStarTable) {
      rows.push({ kind: 'fingerprint', equipId, ledger: entry.akashiStarTable, live: row.akashiStarTable })
    }
    if (entry.withinImproveCoverage !== row.withinImproveCoverage) {
      rows.push({ kind: 'coverage', equipId, ledger: entry.withinImproveCoverage, live: row.withinImproveCoverage })
    }
    if (entry.upstreamRef !== row.upstreamRef) {
      rows.push({ kind: 'upstreamref', equipId, ledger: entry.upstreamRef, live: row.upstreamRef })
    }
  }
  for (const [equipId] of known) {
    if (!live.has(equipId)) rows.push({ kind: 'resolved', equipId })
  }
  return {
    rows,
    summary: { ledger: known.size, live: live.size, mismatches: rows.length },
  }
}

/** @type {readonly ImproveStarGap[]} */
export const PENDING_IMPROVE_STAR_GAPS = Object.freeze([
  Object.freeze({
    equipId: 54,
    equipName: '彩雲',
    akashiStarTable:
      '空母​ボーナス[-/索敵+1/-/-/-/-/-/-/-/-];' +
      '索敵値[+1.20/+1.69/+2.07/+2.40/+2.68/+2.93/+3.17/+3.39/+3.60/+3.79]',
    improveLedger: null,
    withinImproveCoverage: true,
    upstreamRef: 'consume',
    recheckedAt: '2026-08-24',
  }),
  Object.freeze({
    equipId: 100,
    equipName: '彗星(江草隊)',
    akashiStarTable:
      '対潜[+0.2/+0.4/+0.6/+0.8/+1.0/+1.2/+1.4/+1.6/+1.8/+2.0];' +
      '爆装[+0.2/+0.4/+0.6/+0.8/+1.0/+1.2/+1.4/+1.6/+1.8/+2.0]',
    improveLedger: null,
    withinImproveCoverage: true,
    upstreamRef: 'convert',
    recheckedAt: '2026-08-24',
  }),
  Object.freeze({
    equipId: 138,
    equipName: '二式大艇',
    akashiStarTable:
      '索敵値[+1.20/+1.69/+2.07/+2.40/+2.68/+2.93/+3.17/+3.39/+3.60/+3.79]',
    improveLedger: null,
    withinImproveCoverage: true,
    upstreamRef: 'absent',
    recheckedAt: '2026-08-24',
  }),
  Object.freeze({
    equipId: 144,
    equipName: '天山一二型(村田隊)',
    akashiStarTable:
      '対潜[+0.2/+0.4/+0.6/+0.8/+1.0/+1.2/+1.4/+1.6/+1.8/+2.0];' +
      '雷装[+0.2/+0.4/+0.6/+0.8/+1.0/+1.2/+1.4/+1.6/+1.8/+2.0]',
    improveLedger: null,
    withinImproveCoverage: true,
    upstreamRef: 'absent',
    recheckedAt: '2026-08-24',
  }),
  Object.freeze({
    equipId: 173,
    equipName: 'Bofors 40mm四連装機関砲',
    akashiStarTable:
      '加重対空[+6.00/+8.48/+10.39/+12.00/+13.41/+14.69/+15.87/+16.97/+18.00/+18.97];' +
      '火力[+1.00/+1.41/+1.73/+2.00/+2.23/+2.44/+2.64/+2.82/+3.00/+3.16];' +
      '雷撃[+1.20/+1.69/+2.07/+2.40/+2.68/+2.93/+3.17/+3.39/+3.60/+3.79];' +
      '雷撃命中[+2.00/+2.82/+3.46/+4.00/+4.47/+4.89/+5.29/+5.65/+6.00/+6.32]',
    improveLedger: null,
    withinImproveCoverage: true,
    upstreamRef: 'absent',
    recheckedAt: '2026-08-24',
  }),
  Object.freeze({
    equipId: 177,
    equipName: '三式戦 飛燕(飛行第244戦隊)',
    akashiStarTable:
      '対空[+0.2/+0.4/+0.6/+0.8/+1.0/+1.2/+1.4/+1.6/+1.8/+2.0]',
    improveLedger: null,
    withinImproveCoverage: true,
    upstreamRef: 'convert',
    recheckedAt: '2026-08-24',
  }),
  Object.freeze({
    equipId: 178,
    equipName: 'PBY-5A Catalina',
    akashiStarTable:
      '索敵値[+1.20/+1.69/+2.07/+2.40/+2.68/+2.93/+3.17/+3.39/+3.60/+3.79]',
    improveLedger: null,
    withinImproveCoverage: true,
    upstreamRef: 'absent',
    recheckedAt: '2026-08-24',
  }),
  Object.freeze({
    equipId: 191,
    equipName: 'QF 2ポンド8連装ポンポン砲',
    akashiStarTable:
      '加重対空[+6.00/+8.48/+10.39/+12.00/+13.41/+14.69/+15.87/+16.97/+18.00/+18.97];' +
      '火力[+1.00/+1.41/+1.73/+2.00/+2.23/+2.44/+2.64/+2.82/+3.00/+3.16];' +
      '雷撃[+1.20/+1.69/+2.07/+2.40/+2.68/+2.93/+3.17/+3.39/+3.60/+3.79];' +
      '雷撃命中[+2.00/+2.82/+3.46/+4.00/+4.47/+4.89/+5.29/+5.65/+6.00/+6.32]',
    improveLedger: null,
    withinImproveCoverage: true,
    upstreamRef: 'convert',
    recheckedAt: '2026-08-24',
  }),
  Object.freeze({
    equipId: 207,
    equipName: '瑞雲(六三一空)',
    akashiStarTable:
      '爆装[+0.2/+0.4/+0.6/+0.8/+1.0/+1.2/+1.4/+1.6/+1.8/+2.0];' +
      '索敵値[+1.15/+1.62/+1.99/+2.30/+2.57/+2.81/+3.04/+3.25/+3.45/+3.63]',
    improveLedger: null,
    withinImproveCoverage: true,
    upstreamRef: 'absent',
    recheckedAt: '2026-08-24',
  }),
  Object.freeze({
    equipId: 218,
    equipName: '四式戦 疾風',
    akashiStarTable:
      '対空[+0.2/+0.4/+0.6/+0.8/+1.0/+1.2/+1.4/+1.6/+1.8/+2.0]',
    improveLedger: null,
    withinImproveCoverage: true,
    upstreamRef: 'absent',
    recheckedAt: '2026-08-24',
  }),
  Object.freeze({
    equipId: 320,
    equipName: '彗星一二型(三一号光電管爆弾搭載機)',
    akashiStarTable:
      '対潜[+0.2/+0.4/+0.6/+0.8/+1.0/+1.2/+1.4/+1.6/+1.8/+2.0];' +
      '爆装[+0.2/+0.4/+0.6/+0.8/+1.0/+1.2/+1.4/+1.6/+1.8/+2.0]',
    improveLedger: null,
    withinImproveCoverage: true,
    upstreamRef: 'convert',
    recheckedAt: '2026-08-24',
  }),
  Object.freeze({
    equipId: 358,
    equipName: '5inch 単装高角砲群',
    akashiStarTable:
      '命中[+1.00/+1.41/+1.73/+2.00/+2.23/+2.44/+2.64/+2.82/+3.00/+3.16];' +
      '夜戦火力[+1.00/+1.41/+1.73/+2.00/+2.23/+2.44/+2.64/+2.82/+3.00/+3.16];' +
      '対空[+0.70/+0.98/+1.21/+1.40/+1.56/+1.71/+1.85/+1.97/+2.10/+2.21];' +
      '火力[+0.2/+0.4/+0.6/+0.8/+1.0/+1.2/+1.4/+1.6/+1.8/+2.0];' +
      '艦隊防空[+2.00/+2.82/+3.46/+4.00/+4.47/+4.89/+5.29/+5.65/+6.00/+6.32]',
    improveLedger: null,
    withinImproveCoverage: true,
    upstreamRef: 'absent',
    recheckedAt: '2026-08-24',
  }),
  Object.freeze({
    equipId: 359,
    equipName: '6inch 連装速射砲 Mk.XXI',
    akashiStarTable:
      '命中[+1.00/+1.41/+1.73/+2.00/+2.23/+2.44/+2.64/+2.82/+3.00/+3.16];' +
      '夜戦命中[+1.30/+1.83/+2.25/+2.60/+2.90/+3.18/+3.43/+3.67/+3.90/+4.11];' +
      '夜戦火力[+1.00/+1.41/+1.73/+2.00/+2.23/+2.44/+2.64/+2.82/+3.00/+3.16];' +
      '火力[+1.00/+1.41/+1.73/+2.00/+2.23/+2.44/+2.64/+2.82/+3.00/+3.16]',
    improveLedger: null,
    withinImproveCoverage: true,
    upstreamRef: 'absent',
    recheckedAt: '2026-08-24',
  }),
  Object.freeze({
    equipId: 362,
    equipName: '5inch連装両用砲(集中配備)',
    akashiStarTable:
      '命中[+1.00/+1.41/+1.73/+2.00/+2.23/+2.44/+2.64/+2.82/+3.00/+3.16];' +
      '夜戦命中[+1.30/+1.83/+2.25/+2.60/+2.90/+3.18/+3.43/+3.67/+3.90/+4.11];' +
      '夜戦火力[+1.00/+1.41/+1.73/+2.00/+2.23/+2.44/+2.64/+2.82/+3.00/+3.16];' +
      '対空[+0.70/+0.98/+1.21/+1.40/+1.56/+1.71/+1.85/+1.97/+2.10/+2.21];' +
      '火力[+1.00/+1.41/+1.73/+2.00/+2.23/+2.44/+2.64/+2.82/+3.00/+3.16];' +
      '艦隊防空[+3.00/+4.24/+5.19/+6.00/+6.70/+7.34/+7.93/+8.48/+9.00/+9.48]',
    improveLedger: null,
    withinImproveCoverage: true,
    upstreamRef: 'absent',
    recheckedAt: '2026-08-24',
  }),
  Object.freeze({
    equipId: 363,
    equipName: 'GFCS Mk.37+5inch連装両用砲(集中配備)',
    akashiStarTable:
      '命中[+1.00/+1.41/+1.73/+2.00/+2.23/+2.44/+2.64/+2.82/+3.00/+3.16];' +
      '夜戦命中[+1.30/+1.83/+2.25/+2.60/+2.90/+3.18/+3.43/+3.67/+3.90/+4.11];' +
      '夜戦火力[+1.00/+1.41/+1.73/+2.00/+2.23/+2.44/+2.64/+2.82/+3.00/+3.16];' +
      '対空[+0.70/+0.98/+1.21/+1.40/+1.56/+1.71/+1.85/+1.97/+2.10/+2.21];' +
      '火力[+1.00/+1.41/+1.73/+2.00/+2.23/+2.44/+2.64/+2.82/+3.00/+3.16];' +
      '艦隊防空[+3.00/+4.24/+5.19/+6.00/+6.70/+7.34/+7.93/+8.48/+9.00/+9.48]',
    improveLedger: null,
    withinImproveCoverage: true,
    upstreamRef: 'absent',
    recheckedAt: '2026-08-24',
  }),
  Object.freeze({
    equipId: 366,
    equipName: '12.7cm連装砲D型改三',
    akashiStarTable:
      '命中[+1.00/+1.41/+1.73/+2.00/+2.23/+2.44/+2.64/+2.82/+3.00/+3.16];' +
      '夜戦命中[+1.30/+1.83/+2.25/+2.60/+2.90/+3.18/+3.43/+3.67/+3.90/+4.11];' +
      '夜戦火力[+1.00/+1.41/+1.73/+2.00/+2.23/+2.44/+2.64/+2.82/+3.00/+3.16];' +
      '火力[+1.00/+1.41/+1.73/+2.00/+2.23/+2.44/+2.64/+2.82/+3.00/+3.16]',
    improveLedger: null,
    withinImproveCoverage: true,
    upstreamRef: 'absent',
    recheckedAt: '2026-08-24',
  }),
  Object.freeze({
    equipId: 388,
    equipName: '銀河(江草隊)',
    akashiStarTable:
      '対空[+0.50/+0.70/+0.86/+1.00/+1.11/+1.22/+1.32/+1.41/+1.50/+1.58];' +
      '爆装[+0.70/+0.98/+1.21/+1.40/+1.56/+1.71/+1.85/+1.97/+2.10/+2.21];' +
      '雷撃[+0.70/+0.98/+1.21/+1.40/+1.56/+1.71/+1.85/+1.97/+2.10/+2.21]',
    improveLedger: null,
    withinImproveCoverage: true,
    upstreamRef: 'absent',
    recheckedAt: '2026-08-24',
  }),
  Object.freeze({
    equipId: 390,
    equipName: '16inch三連装砲 Mk.6+GFCS',
    akashiStarTable:
      '命中[+1.00/+1.41/+1.73/+2.00/+2.23/+2.44/+2.64/+2.82/+3.00/+3.16];' +
      '夜戦命中[+1.30/+1.83/+2.25/+2.60/+2.90/+3.18/+3.43/+3.67/+3.90/+4.11];' +
      '夜戦火力[+1.00/+1.41/+1.73/+2.00/+2.23/+2.44/+2.64/+2.82/+3.00/+3.16];' +
      '火力[+1.50/+2.12/+2.59/+3.00/+3.35/+3.67/+3.96/+4.24/+4.50/+4.74]',
    improveLedger: null,
    withinImproveCoverage: true,
    upstreamRef: 'absent',
    recheckedAt: '2026-08-24',
  }),
  Object.freeze({
    equipId: 406,
    equipName: 'Do 217 K-2+Fritz-X',
    akashiStarTable:
      '対空[+0.50/+0.70/+0.86/+1.00/+1.11/+1.22/+1.32/+1.41/+1.50/+1.58];' +
      '爆装[+0.70/+0.98/+1.21/+1.40/+1.56/+1.71/+1.85/+1.97/+2.10/+2.21];' +
      '雷撃[+0.70/+0.98/+1.21/+1.40/+1.56/+1.71/+1.85/+1.97/+2.10/+2.21]',
    improveLedger: null,
    withinImproveCoverage: true,
    upstreamRef: 'absent',
    recheckedAt: '2026-08-24',
  }),
  Object.freeze({
    equipId: 412,
    equipName: '水雷戦隊 熟練見張員',
    akashiStarTable:
      '命中[+1.00/+1.41/+1.73/+2.00/+2.23/+2.44/+2.64/+2.82/+3.00/+3.16];' +
      '夜戦火力[+1.00/+1.41/+1.73/+2.00/+2.23/+2.44/+2.64/+2.82/+3.00/+3.16];' +
      '火力[+1.00/+1.41/+1.73/+2.00/+2.23/+2.44/+2.64/+2.82/+3.00/+3.16]',
    improveLedger: null,
    withinImproveCoverage: true,
    upstreamRef: 'absent',
    recheckedAt: '2026-08-24',
  }),
  Object.freeze({
    equipId: 498,
    equipName: '九七式中戦車 新砲塔(チハ改)',
    akashiStarTable:
      '命中[+1.00/+1.41/+1.73/+2.00/+2.23/+2.44/+2.64/+2.82/+3.00/+3.16];' +
      '夜戦命中[+1.30/+1.83/+2.25/+2.60/+2.90/+3.18/+3.43/+3.67/+3.90/+4.11];' +
      '夜戦火力[+1.00/+1.41/+1.73/+2.00/+2.23/+2.44/+2.64/+2.82/+3.00/+3.16];' +
      '火力[+1.00/+1.41/+1.73/+2.00/+2.23/+2.44/+2.64/+2.82/+3.00/+3.16];' +
      '砲台特効倍率[+?/+?/+?/+?/+?/+?/+?/+?/+?/+?]',
    improveLedger: null,
    withinImproveCoverage: true,
    upstreamRef: 'absent',
    recheckedAt: '2026-08-24',
  }),
  Object.freeze({
    equipId: 504,
    equipName: '銀河(熟練)',
    akashiStarTable:
      '対空[+0.50/+0.70/+0.86/+1.00/+1.11/+1.22/+1.32/+1.41/+1.50/+1.58];' +
      '爆装[+0.70/+0.98/+1.21/+1.40/+1.56/+1.71/+1.85/+1.97/+2.10/+2.21];' +
      '雷撃[+0.70/+0.98/+1.21/+1.40/+1.56/+1.71/+1.85/+1.97/+2.10/+2.21]',
    improveLedger: null,
    withinImproveCoverage: true,
    upstreamRef: 'convert',
    recheckedAt: '2026-08-24',
  }),
  Object.freeze({
    equipId: 562,
    equipName: 'Do 217 E-5+TV誘導型 Hs293D',
    akashiStarTable:
      '対空[+0.50/+0.70/+0.86/+1.00/+1.11/+1.22/+1.32/+1.41/+1.50/+1.58];' +
      '爆装[+0.70/+0.98/+1.21/+1.40/+1.56/+1.71/+1.85/+1.97/+2.10/+2.21];' +
      '雷撃[+0.70/+0.98/+1.21/+1.40/+1.56/+1.71/+1.85/+1.97/+2.10/+2.21]',
    improveLedger: null,
    withinImproveCoverage: true,
    upstreamRef: 'absent',
    recheckedAt: '2026-08-24',
  }),
  Object.freeze({
    equipId: 568,
    equipName: '強風改二(熟練)',
    akashiStarTable:
      '対空[+0.2/+0.4/+0.6/+0.8/+1.0/+1.2/+1.4/+1.6/+1.8/+2.0]',
    improveLedger: null,
    withinImproveCoverage: true,
    upstreamRef: 'absent',
    recheckedAt: '2026-08-24',
  }),
  Object.freeze({
    equipId: 577,
    equipName: '61cm四連装(酸素)魚雷五型改三',
    akashiStarTable:
      '夜戦命中[+1.30/+1.83/+2.25/+2.60/+2.90/+3.18/+3.43/+3.67/+3.90/+4.11];' +
      '夜戦火力[+1.00/+1.41/+1.73/+2.00/+2.23/+2.44/+2.64/+2.82/+3.00/+3.16];' +
      '雷撃[+1.20/+1.69/+2.07/+2.40/+2.68/+2.93/+3.17/+3.39/+3.60/+3.79];' +
      '雷撃命中[+2.00/+2.82/+3.46/+4.00/+4.47/+4.89/+5.29/+5.65/+6.00/+6.32]',
    improveLedger: null,
    withinImproveCoverage: false,
    upstreamRef: 'absent',
    recheckedAt: '2026-08-24',
  }),
])
