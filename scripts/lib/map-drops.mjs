// 常规海域**掉落**的第一方汇编（用户 2026-08-22 拍板的多源汇编口径，批次 2）。
//
// ---- 与 map-enemy-comps 同族，但票的独立性判据**不一样** ----
//
// 编成那一批（scripts/lib/map-enemy-comps.mjs）把 kcwiki 与 wikiwiki 算成两张独立票，
// 理由是「一条是中文 wiki 编辑填的数字，一条是日文 wiki 的人读标注 + 我们自己的定号判据」。
// **掉落域不能照抄这个判断**，而且不是靠推测——kcwiki 的常规海域页页脚自己写着：
//
//     「主要数据来源为日wiki，补充数据来自英文wikia，如果有冲突默认以日wiki为准」
//
// 37 张常规海域页逐张核过，**37/37 都挂着这一行**（2026-08-22 实测，原文照录进包 meta）。
// 也就是说这一域里「两 wiki 都这么说」多半只是同一张票被抄了两遍。所以印证状态分四档：
//
//   · 多源一致    有本机遭遇志印证（第一方一手）+ 至少一张 wiki 票 —— 才算真的两条独立路径
//   · 同源转录    kcwiki 与 wikiwiki 都收了，但没有账本票；同祖，**不升级**
//   · 单源待印证  只有一家收；**照收不丢**（5-6 的 473 条、7-5 的 323 条不归零）
//   · 冲突待裁    见下面「掉落域的冲突长什么样」
//
// 印证状态只存数据内部与维护者侧工具，运行时一行都不读，UI 不逐条挂标（贞操锁禁令）。
//
// ---- 账本票按**图**归，不按点 ----
//
// `encounters.cell` 是罗盘 `api_no`（边号），要变成 wiki 的点位字母得再过一层推导
// （poi-fcd 的 route 表）。那一层的错法是「把掉落挂到错的点上」，比少一张票坏得多。
// 批次 1 已按这一档裁过，掉落票沿用：账本只印证「这张图确实掉过这条船」。
//
// ---- 掉落域的冲突长什么样 ----
//
// 编成域的冲突是「同一套阵容两边给了互斥的阵形/经验」——两边都在**断言**同一格。
// 掉落域没有这种结构：**未列出 ≠ 确认不掉**（这是本项目一直对玩家写明的口径），
// 所以一方收录、另一方沉默是覆盖差，不是互相否定。真正会互相否定的只有下面这几类，
// 逐条落 assets/review/map-drops-conflicts.json 等人裁，脚本一条都不代拍：
//
//   · node-missing        kcwiki 掉落表里的点位，现包这张图根本没有这个点
//   · limited-vs-plain    现包说「只在限定期掉」，kcwiki 把它列进常规掉落表
//   · empty-drop-*        空掉落标记与本机 S 胜样本对不上（见下）
//
// 裁完的**不删条目**：冲突每轮重算，删掉只会下一轮又冒出来当新的待裁项，而痕迹没了。
// 裁决按指纹落在 `RESOLVED_MAP_DROP_CONFLICTS` 里，认领上的条目照旧进台账，多带一句裁语。
//
// ---- 「空掉落」从哪来 ----
//
// kcwiki 掉落表没有对应字样（§2.4b 穷举过）。现行抓取器里那一格其实是**硬编码**的
// （scripts/map-intel.mjs:764 `code === '1-1' && node === 'C'`）。这一层不再硬编：
// 节点级的 `emptyDrop` 只从**现包票**取；本机账本能给的是图级的「S 胜 N 次、其中 M 次没掉」，
// 那是图级证据，不足以钉某一个点，所以只进冲突台账当待核项，不写进包。
//
// ---- 收什么、不收什么（§3.1 红线）----
//
// 收：`(图, 点) → mstId 集合` 这种事实三元组，加节点级的空掉落标记。
// 不收：kcwiki 掉落表里**红色粗体的稀有掉落标记**——那是编辑者归纳的稀有度分级，
//       属于「别人精编的成品表格」那一侧。解析器解得出来（`drops[].rare`），这一层故意不写进包。
// 限定期窗口（`limited` / `limitedOnly` / `limitedHistory`）**这一改不动**：它仍旧由底座
// map-intel 供，装配时按 (图, 点, 舰) 原样带过去（批次 4 才做第一方台账）。

import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'

import { userDataPathIfAny } from './data-dir.mjs'
import { KCWIKI_MAP_CODES, parseKcwikiMapPage } from './kcwiki-map.mjs'
import { foldCjkVariants } from '../../src/shared/cjk-fold.ts'
import { correctLegacyDropForm } from '../../src/shared/map-drop-corrections.ts'

const require = createRequire(import.meta.url)

/**
 * 掉落表里写法与舰娘表对不上的名字。**每条都要有锚定证据**，不许凭印象填。
 *
 * 判据分两种，写在 `KCWIKI_DROP_ALIAS_EVIDENCE` 里：
 *   · `legacy-anchor` —— 现包在**同一个 (图, 点)** 上也有这个 mstId。两张互相独立整理的表
 *     在同一格指着同一条船，才敢把这个写法钉到这个号上；
 *   · `user-verdict`  —— 现包那一票**本身就是错的**，由用户裁定改钉，并附一条机器可复核的判据。
 *     这一类不要求现包锚得上（要求它锚得上正好会把错值锁死）。
 * 逐条锚定核对由 test/map-drops.test.mjs 钉着，锚不上就是护栏红。
 */
export const KCWIKI_DROP_NAME_ALIASES = Object.freeze({
  // 「まるゆ」的另一种译名（舰娘表写「丸优」）。现包 3-5/H、4-5/T、6-1/I、6-1/K、6-2/K
  // 五个点与 kcwiki 逐点对上，5/5 全中。
  丸输: 163,
  // 曽/曾 异体，cjk-fold 表里没有这一对（那张表是从任务正文与远征名跑出来的，
  // 不含这个字）。现包 7-4/P 同点锚定。
  木曽: 101,
  // 三个形态都叫「宗谷」，掉落表只写两个字。链首 699 特务舰才是能掉的那个，见下方 evidence。
  宗谷: 699,
})

/** 每条别名凭什么钉到这个号上。`legacy-anchor` 靠现包同点，`user-verdict` 靠用户裁定 + 判据。 */
export const KCWIKI_DROP_ALIAS_EVIDENCE = Object.freeze({
  丸输: { kind: 'legacy-anchor', why: '现包 3-5/H、4-5/T、6-1/I、6-1/K、6-2/K 五个点逐点对上，5/5 全中' },
  木曽: { kind: 'legacy-anchor', why: '现包 7-4/P 同点锚定' },
  宗谷: {
    kind: 'user-verdict',
    supersedes: 645,
    decidedAt: '2026-08-22',
    why:
      '三个形态同名：699 宗谷(特務艦) / 645 宗谷(灯台補給) / 650 宗谷(南極観測)。' +
      '**改造后的形态不掉落**——这是本项目一贯的口径（鉴的掉点卷也按它把改造形态回退到未改造形态）。' +
      'kcwiki 舰娘页的 `获得.改造` 逐条可查：699 是 0（链首，不由改造得来），645 与 650 都是 1（改造而来）。' +
      '所以掉落表写「宗谷」只可能指 699。现包在 1-4/L 等点写的 645 是上游错值，' +
      '旧别名照着它锚，等于把错值锁死了。用户 2026-08-22 依 kcwiki 舰娘页裁定改钉 699。',
  },
})

// 现包那一票里指错形态的号，逐条改钉。台账住在 shared —— 汇编、出包护栏、运行时叠加
// 三处必须共用同一张表，各存一份就会各走各的（尤其运行时那一处漏了不报错，
// 只是限定期窗口悄悄消失）。理由与判据见 src/shared/map-drop-corrections.ts。
export { LEGACY_DROP_FORM_CORRECTIONS, correctLegacyDropForm } from '../../src/shared/map-drop-corrections.ts'

/**
 * 中文舰名 → mstId 的解析器。
 *
 * 三层依次试：舰娘表的「中文名」→「日文名」→ 两者的 CJK 折叠形
 * （`第四號海防艦` → `第四号海防舰`、`比叡` → 日文名直命中）。
 * 都不中再查上面的别名表。
 *
 * **两种情况一律硬错，不静默丢**（2026-08-11「杉@1-5 被静默丢掉」的教训）：
 *   ① 解析不出来 —— 少一条掉落线索，界面上看不出任何异常
 *   ② 同一个写法对应多个 mstId（实测只有「光荣」= Gloire 965 / Glorious 1022，
 *      两张掉落表里都没出现过）—— 半截的号比没有更危险
 */
export const buildDropNameResolver = (shipTable, aliases = KCWIKI_DROP_NAME_ALIASES) => {
  const byName = new Map()
  const put = (key, id) => {
    if (!key) return
    const seen = byName.get(key)
    if (!seen) {
      byName.set(key, id)
      return
    }
    if (seen === id || seen === 'ambiguous') return
    byName.set(key, 'ambiguous')
  }
  for (const entry of Object.values(shipTable ?? {})) {
    const id = Number(entry?.ID)
    if (!Number.isInteger(id) || id <= 0) continue
    for (const name of [entry['中文名'], entry['日文名']]) {
      if (!name) continue
      put(name, id)
      put(foldCjkVariants(name), id)
    }
  }
  return (name) => {
    const alias = aliases[name]
    if (alias) return { id: alias, via: 'alias' }
    for (const key of [name, foldCjkVariants(name)]) {
      const hit = byName.get(key)
      if (hit === 'ambiguous') return { id: null, via: 'ambiguous' }
      if (hit) return { id: hit, via: 'name' }
    }
    return { id: null, via: 'missing' }
  }
}

/** 一条待裁项的稳定指纹。上游改了那一格指纹就变，旧裁决自动失效要重核。 */
export const mapDropConflictFingerprint = (conflict) =>
  `${conflict.kind}@${conflict.map}/${conflict.node ?? '-'}` +
  `[${conflict.mstId ?? ''}]${JSON.stringify(conflict.detail ?? '')}`

/**
 * 已裁的待裁项（形态照 `scripts/lib/fit-bonus-conflicts.mjs` 的 KNOWN_FIT_BONUS_CONFLICTS）。
 *
 * 冲突本身是**每轮重新算出来的**——只要上游那两格还这么写，`buildMapDrops` 就还会把它列出来。
 * 所以裁决不能只落在随包台账里：台账那一条撤了 `conflict` 标，冲突台账下一轮照样把它当新的
 * 待裁项报回来，人再裁一遍。裁决要留在源码这张表里，按**指纹**认领：
 *   · 认领上了 → 条目照旧进 `assets/review/map-drops-conflicts.json`（**不删，痕迹要留着**），
 *     但多带 `verdict / decidedAt / why`，一眼看得出它已经结案，不再混在未裁的里面；
 *   · 认领不上（指纹变了 / 那一格上游改过了）→ 旧裁决**自动失效**，条目重新以未裁形态出现，
 *     同时 `staleMapDropVerdicts` 会把这条无主裁决报出来要求重核。
 *
 * **裁决不改数**：`limited` 这一档表示「两边并不互相否定，台账那一条照旧成立」，
 * 不是把 kcwiki 那一格抄进包里，也不是把 limitedOnly 摘掉。
 */
const LIMITED_VS_PLAIN_WHY =
  'kcwiki 的常规掉落表本身不区分限定/常驻——那张表没有「限定期」这个概念，限定条目一并混编在里面。' +
  '所以「它也出现在常规掉落表里」并不是对「只在限定期掉」的否定，两边不构成互斥断言，非真冲突。' +
  '互斥两票制的第二票由艦ログ（kanlog.info）的「開催中の期間限定ドロップ」名单给出' +
  '（2026-08-23 13:00 页面人工核阅；该站按其站点纪律不接受自动化抓取，kuma 没有对它的抓取脚本）：'

const limitedVsPlain = (fingerprint, kanlog) => ({
  fingerprint,
  verdict: 'limited',
  decidedAt: '2026-08-23',
  why: `${LIMITED_VS_PLAIN_WHY}${kanlog}。用户 2026-08-23 据此裁「限定」收案。`,
})

/** @type {readonly {fingerprint: string, verdict: string, decidedAt: string, why: string}[]} */
export const RESOLVED_MAP_DROP_CONFLICTS = Object.freeze([
  limitedVsPlain(
    'limited-vs-plain@1-3/J[953]{"wikiwiki":"limitedOnly · 2025-12-18 起","kcwiki":"列在常规掉落表里（该表不区分限定/常驻）"}',
    '1-3/J 的朝日仍列在开催中，批次「Xmas 2025/12/18～」与起始日与台账逐字吻合（样本 11/1575 全 S）',
  ),
  limitedVsPlain(
    'limited-vs-plain@1-4/L[527]{"wikiwiki":"limitedOnly · 2024-11-08 起","kcwiki":"列在常规掉落表里（该表不区分限定/常驻）"}',
    '1-4/L 的岸波仍列在开催中，批次「秋刀魚祭り 2024/11/8～」与起始日与台账逐字吻合（样本 20/2647）',
  ),
  limitedVsPlain(
    'limited-vs-plain@1-4/L[636]{"wikiwiki":"limitedOnly · 2024-10-18 起","kcwiki":"列在常规掉落表里（该表不区分限定/常驻）"}',
    '1-4/L 的伊47 仍列在开催中，批次「FleetHalloween! 2024/10/18～」与起始日与台账逐字吻合（样本 5/2647）',
  ),
  limitedVsPlain(
    'limited-vs-plain@1-4/L[699]{"wikiwiki":"limitedOnly · 2025-12-18 起","kcwiki":"列在常规掉落表里（该表不区分限定/常驻）"}',
    '1-4/L 的宗谷仍列在开催中，批次「Xmas 2025/12/18～」与起始日与台账逐字吻合' +
      '（样本 0/2647——列在开催中却一次都没出，是确率极低，不是窗口关了；「未出现 ≠ 确认不掉」）',
  ),
  limitedVsPlain(
    'limited-vs-plain@1-4/L[900]{"wikiwiki":"limitedOnly · 2026-05-01 起","kcwiki":"列在常规掉落表里（该表不区分限定/常驻）"}',
    '1-4/L 的山汐丸仍列在开催中，批次「菖蒲 2026/5/1～」与起始日与台账逐字吻合（样本 24/2647）',
  ),
  limitedVsPlain(
    'limited-vs-plain@4-4/K[120]{"wikiwiki":"limitedOnly · 2023-11-28 起","kcwiki":"列在常规掉落表里（该表不区分限定/常驻）"}',
    '4-4/K 的三隈仍列在开催中，批次「Xmas 2023/11/28～」与起始日与台账逐字吻合（样本 231/6098 = 3.79%）',
  ),
  limitedVsPlain(
    'limited-vs-plain@5-5/S[633]{"wikiwiki":"limitedOnly · 2023-06-14 起","kcwiki":"列在常规掉落表里（该表不区分限定/常驻）"}',
    '5-5/S 的夕暮仍列在开催中，批次「夕暮 2023/6/14～」与起始日与台账逐字吻合（样本 2/1074）',
  ),
])

/** 这一条待裁项裁过没有。认指纹不认位置——上游改了那一格，旧裁决就认领不上了。 */
export const mapDropConflictVerdict = (conflict) => {
  const fingerprint = mapDropConflictFingerprint(conflict)
  return RESOLVED_MAP_DROP_CONFLICTS.find((one) => one.fingerprint === fingerprint) ?? null
}

/**
 * 无主的旧裁决：表里写着、这一轮却一条都认领不上的。
 *
 * 它是指纹自失效的**另一半**。少了这一半，上游哪天把那一格改了，裁决会安安静静地
 * 不再生效，而冲突重新变成未裁项——看上去只是「又多了几条待裁」，谁也不知道
 * 是有一条裁决作废了。所以要显式报出来要求重核。
 */
export const staleMapDropVerdicts = (conflicts) => {
  const seen = new Set((conflicts ?? []).map((conflict) => mapDropConflictFingerprint(conflict)))
  return RESOLVED_MAP_DROP_CONFLICTS.filter((one) => !seen.has(one.fingerprint))
}

/** 印证状态（只给维护者侧工具与报告用；不进 UI）。四档口径见文件头。 */
export const dropCorroborationOf = (entry) => {
  const votes = entry?.votes ?? []
  if (votes.includes('ledger')) return '多源一致'
  return votes.length >= 2 ? '同源转录' : '单源待印证'
}

/**
 * 第三张票：本机遭遇志。**有 IO**，与上面的纯逻辑分开。
 *
 * 返回 `Map<图代号, { ids:Set<mstId>, sWins, sWinsWithoutDrop }>`。
 * 按图归不按点，理由见文件头。拿不到账本就返回空表——这张票缺席只是少一层印证，
 * 不该让整包抓不出来。
 */
export const loadLedgerDropVotes = ({ dbPath = null } = {}) => {
  const file = dbPath ?? userDataPathIfAny('mg.sqlite')
  const votes = new Map()
  if (!file || !existsSync(file)) return votes
  try {
    const { DatabaseSync } = require('node:sqlite')
    const db = new DatabaseSync(file, { readOnly: true })
    try {
      for (const row of db.prepare('SELECT map, rank, drop_mst FROM encounters').all()) {
        const map = Number(row.map)
        if (!Number.isInteger(map) || map <= 0) continue
        const code = `${Math.floor(map / 10)}-${map % 10}`
        const entry = votes.get(code) ?? { ids: new Set(), sWins: 0, sWinsWithoutDrop: 0 }
        const drop = Number(row.drop_mst)
        if (Number.isInteger(drop) && drop > 0) entry.ids.add(drop)
        // 「S 胜却什么都没掉」是空掉落最硬的一手证据——只是它只能钉到图，钉不到点。
        if (row.rank === 'S') {
          entry.sWins += 1
          if (!(Number.isInteger(drop) && drop > 0)) entry.sWinsWithoutDrop += 1
        }
        votes.set(code, entry)
      }
    } finally {
      db.close()
    }
  } catch (error) {
    console.warn(`[lodes]   本机遭遇志读不到（第三张票缺席）：${error.message}`)
  }
  return votes
}

/** 账本要给出「这张图确实存在空掉落」的待核提示，至少要有这么多 S 胜样本。 */
export const EMPTY_DROP_SAMPLE_FLOOR = 20

/**
 * 汇编。
 *
 * @param pages       Map<code, { html, title }>，由 fetchKcwikiMapPages 取得
 * @param legacy      现行 map-intel.json 的 `data.maps`（第二张票：wikiwiki 系既有条目）
 * @param ledger      loadLedgerDropVotes 的产物（第三张票，可缺）
 * @param shipTable   assets/lodes/kcwiki-ships.json 的 `data`（中文名 → mstId 的判据）
 * @param checkedAt   YYYY-MM-DD
 */
export const buildMapDrops = ({
  pages,
  legacy = {},
  ledger = new Map(),
  shipTable,
  checkedAt,
  contentDates = new Map(),
  codes = KCWIKI_MAP_CODES,
}) => {
  const resolve = buildDropNameResolver(shipTable)
  const maps = {}
  const conflicts = []
  // 裁过的照旧进台账（痕迹要留着），只是多带上裁语——认领靠指纹，认领不上就还是未裁项
  const addConflict = (conflict) => {
    const decided = mapDropConflictVerdict(conflict)
    conflicts.push(
      decided
        ? { ...conflict, verdict: decided.verdict, decidedAt: decided.decidedAt, why: decided.why }
        : conflict,
    )
  }
  const warnings = []
  const unresolved = new Map()
  const sourceNotes = new Set()
  const stats = {
    maps: 0,
    nodes: 0,
    ships: 0,
    multi: 0,
    transcribed: 0,
    single: 0,
    kcwikiOnly: 0,
    legacyOnly: 0,
    ledgerBacked: 0,
    emptyNodes: 0,
    kcwikiDropNodes: 0,
    aliasHits: 0,
  }

  for (const code of codes) {
    const page = pages.get(code)
    if (!page) {
      warnings.push(`${code} 没有页面，整图跳过（宁可缺一图，也不拿旧数冒充新抓）`)
      continue
    }
    const parsed = parseKcwikiMapPage(page.html)
    for (const warning of parsed.warnings) warnings.push(`${code}: ${warning}`)
    if (parsed.sourceNote) sourceNotes.add(parsed.sourceNote)
    const legacyNodes = legacy[code]?.nodes ?? {}
    const ledgerIds = ledger.get(code)?.ids ?? new Set()

    // kcwiki 侧：逐点解号。同一点同一条船在表里出现两次（按舰种分组时重复列）算一条。
    const kcwikiByNode = new Map()
    for (const [node, value] of Object.entries(parsed.nodes)) {
      if (!value.drops.length) continue
      stats.kcwikiDropNodes += 1
      const ids = new Set()
      for (const drop of value.drops) {
        const { id, via } = resolve(drop.name)
        if (!id) {
          const key = `${drop.name}|${via}`
          const at = unresolved.get(key) ?? { name: drop.name, via, at: [] }
          at.at.push(`${code}/${node}`)
          unresolved.set(key, at)
          continue
        }
        if (via === 'alias') stats.aliasHits += 1
        ids.add(id)
      }
      kcwikiByNode.set(node, ids)
    }

    const nodes = {}
    const nodeLetters = new Set([
      ...[...kcwikiByNode.keys()].filter((node) => kcwikiByNode.get(node).size),
      ...Object.keys(legacyNodes).filter(
        (node) => legacyNodes[node].ships?.length || legacyNodes[node].emptyDrop === 'confirmed',
      ),
    ])
    for (const node of [...nodeLetters].sort()) {
      const kcwikiIds = kcwikiByNode.get(node) ?? new Set()
      const legacyNode = legacyNodes[node]
      // 现包那一票里记错形态的号在这里改钉——不改的话同一个点会同时出现新旧两个号
      const legacyIds = new Set(
        (legacyNode?.ships ?? []).map((ship) => correctLegacyDropForm(ship.id)),
      )
      // kcwiki 给了一个现包这张图根本没有的点位——要么上游写错，要么我们的点位解析
      // 认错了字。**不静默丢**：条目照收，同时进台账等人核。
      if (kcwikiIds.size && !legacyNode) {
        addConflict({
          kind: 'node-missing',
          map: code,
          node,
          mstId: null,
          detail: {
            kcwiki: [...kcwikiIds].sort((a, b) => a - b),
            note: '舰娘百科掉落表给了这个点，现包这张图没有这个点位',
          },
        })
      }

      const ships = []
      for (const id of [...new Set([...kcwikiIds, ...legacyIds])].sort((a, b) => a - b)) {
        const votes = []
        if (kcwikiIds.has(id)) votes.push('kcwiki')
        if (legacyIds.has(id)) votes.push('wikiwiki')
        if (ledgerIds.has(id)) votes.push('ledger')
        ships.push({ id, votes })
        if (kcwikiIds.has(id) && !legacyIds.has(id)) stats.kcwikiOnly += 1
        if (!kcwikiIds.has(id) && legacyIds.has(id)) stats.legacyOnly += 1
      }
      if (!ships.length && legacyNode?.emptyDrop !== 'confirmed') continue

      // 现包说「只在限定期掉」，kcwiki 却把它列进常规掉落表——两边对**同一条船在
      // 平时掉不掉**给了相反的说法。kcwiki 没有限定期这个概念，所以这不一定是错，
      // 但它是玩家会当场吃亏的一格（以为平时能捞），逐条列出来等人裁。
      for (const ship of legacyNode?.ships ?? []) {
        const shipId = correctLegacyDropForm(ship.id)
        if (!ship.limitedOnly || !kcwikiIds.has(shipId)) continue
        addConflict({
          kind: 'limited-vs-plain',
          map: code,
          node,
          mstId: shipId,
          detail: {
            wikiwiki: `limitedOnly · ${ship.limited?.from ?? '?'} 起`,
            kcwiki: '列在常规掉落表里（该表不区分限定/常驻）',
          },
        })
      }

      const emptyDrop = legacyNode?.emptyDrop === 'confirmed' ? 'confirmed' : 'unknown'
      if (emptyDrop === 'confirmed') stats.emptyNodes += 1
      nodes[node] = {
        emptyDrop,
        ...(emptyDrop === 'confirmed' ? { emptyDropVotes: ['wikiwiki'] } : {}),
        ships,
      }
      stats.nodes += 1
      for (const ship of ships) {
        stats.ships += 1
        if (ship.votes.includes('ledger')) {
          stats.ledgerBacked += 1
          stats.multi += 1
        } else if (ship.votes.length >= 2) stats.transcribed += 1
        else stats.single += 1
      }
    }

    // 空掉落的账本旁证只能钉到图：够样本却一次都没空过 / 空过却没有任何点被标，
    // 两头都进台账当待核项，**不改包里的标记**。
    const seen = ledger.get(code)
    if (seen && seen.sWins >= EMPTY_DROP_SAMPLE_FLOOR) {
      const marked = Object.entries(nodes)
        .filter(([, value]) => value.emptyDrop === 'confirmed')
        .map(([node]) => node)
      if (seen.sWinsWithoutDrop > 0 && !marked.length) {
        addConflict({
          kind: 'empty-drop-candidate',
          map: code,
          node: null,
          mstId: null,
          detail: {
            ledger: `S 胜 ${seen.sWins} 次、其中 ${seen.sWinsWithoutDrop} 次没掉`,
            note: '本机账本见过空掉落，现包这张图一个点都没标——待核（账本只能钉到图，钉不到点）',
          },
        })
      }
      if (seen.sWinsWithoutDrop === 0 && marked.length) {
        addConflict({
          kind: 'empty-drop-unbacked',
          map: code,
          node: null,
          mstId: null,
          detail: {
            wikiwiki: `标了空掉落的点：${marked.join('、')}`,
            ledger: `S 胜 ${seen.sWins} 次，一次都没空过`,
            note: '样本够了却没印证到，待核',
          },
        })
      }
    }

    if (!Object.keys(nodes).length) {
      warnings.push(`${code} 一条掉落都没汇编出来`)
      continue
    }
    maps[code] = {
      source: 'kuma 汇编（舰娘百科掉落表 × 艦これ攻略 Wiki 既有条目 × 本机遭遇志）',
      sourceUrl: `https://zh.kcwiki.cn/wiki/${encodeURI(page.title ?? code)}`,
      checkedAt,
      revision: checkedAt.replaceAll('-', '.'),
      ...(contentDates.get(code) ? { contentDate: contentDates.get(code) } : {}),
      nodes,
    }
    stats.maps += 1
  }

  return {
    data: {
      schemaVersion: 1,
      compiledAt: checkedAt,
      voters: {
        kcwiki: '舰娘百科各海域页的「舰娘掉落表」（中文舰名，经舰娘表解成 mstId）',
        wikiwiki: '艦これ攻略 Wiki 各海域聚合页的确认掉落，现行 map-intel 里的既有条目',
        ledger: '本机遭遇志 encounters.drop_mst——第一方一手实测，按图归不按点',
      },
      // 上游自己写的来源自述，原文照录。掉落域算票的独立性判据全靠它，
      // 别只留我们自己的结论（37/37 图都挂着这一行，2026-08-22 实测）。
      sourceNotes: [...sourceNotes],
      maps,
    },
    stats,
    conflicts,
    warnings,
    unresolved: [...unresolved.values()],
  }
}
