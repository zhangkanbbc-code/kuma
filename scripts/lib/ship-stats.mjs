// 舰娘成长三维（回避 / 对潜 / 索敌）端点表的**第一方汇编**。
//
// ---- 这一层解决什么 ----
//
// 这三项的 [Lv1, Lv99] 端点游戏不在主数据里下发（api_mst_ship 没有这三个字段），
// 而它们同时是两处的地基：
//   ① 面板反推的七项扩展——回避/对潜/索敌的「裸值」要按等级插值算出来才能反推加成；
//   ② 图鉴舰娘卷的三维上限展示。
// 从前 ② 直接读 `wikiwiki-ship-max`，那个包**无许可声明、不随发行版**，
// 于是发布版那一格只能显示占位（发布已知限制之一）。本汇编一次解决两处。
//
// ---- 三张票，各自的分工不一样 ----
//
//   · **kcwiki 基座**（`kcwiki-ships` 的 `数据.回避/对潜/索敌` = [Lv1, Lv99]）：
//     CC BY-NC-SA 3.0，可随包。**唯一被整表读进来当值的票。**
//   · **wikiwiki**（`wikiwiki-ship-max`，无许可声明、不随包）：在这里**只投票，不供值**——
//     逐格答「你跟基座一样吗」，一样就把印证从 `single` 升到 `multi`。
//     它真正供出去的值只有 `src/shared/ship-stats-patches.ts` 里**逐条转写、带依据**的
//     那 64 格。这就是「转写事实」与「搬表」的分界：一张 2500 格的表照抄是搬表，
//     几十格分歧逐条带证据地记下来不是。范式同 `map-drops` 读现包票。
//   · **账本一手**：`api_kaihi/api_taisen/api_sakuteki` 的 `[1]` 就是该形态 Lv99 上限
//     （游戏对持有形态直接下发）。它也在补丁台账里，标 `via: 'ledger'`。
//     运行时还会**再来一次**：持有形态一律现取现用，不吃包里那一格（见 `growthEndpoints`）。
//
// ---- 印证四档 ----
//
//   `ledger` 账本一手裁定 / `multi` 两 wiki 独立一致 / `patched` 分歧按裁决取一侧 /
//   `single` 只有基座一票（wikiwiki 那张表没有这一格，或者维护者本机压根没有那个包）。
//
// ---- 两道自维护的护栏 ----
//
//   ① **自失效**：每条补丁钉着写下时 kcwiki 基座那一格的值。上游改了那一格就跳过并告警，
//      不拿过期裁决去改一个已经变样的东西。
//   ② **新漂移检测**：wikiwiki 与出包值不一致、又不在补丁台账也不在「疑似解析错」清单里的格，
//      一律进 `unresolved` 报出来。那说明 2026-08-22 那次裁决之后上游又动过——
//      要么补一条补丁，要么补一条挂牌，不许静默。

import { readFileSync } from 'node:fs'

import { userDataPathIfAny } from './data-dir.mjs'
import {
  SHIP_STAT_GAPS,
  SHIP_STAT_PATCHES,
  SHIP_STAT_SUSPECT_CELLS,
} from '../../src/shared/ship-stats-patches.ts'

/** kcwiki `数据` 里的中文项名 → 我们的键。 */
const KCWIKI_FIELD = { evasion: '回避', asw: '对潜', los: '索敌' }
/** wikiwiki-ship-max 的字段名 → 我们的键。 */
const WIKIWIKI_FIELD = { evasion: 'kaihi', asw: 'taisen', los: 'sakuteki' }
const KEYS = ['evasion', 'asw', 'los']
const ENDS = ['init', 'max']
const stateFieldOf = (end) => (end === 'init' ? 'initState' : 'maxState')

/** kcwiki 用 -1 标缺数据，照实当缺；成对才认。 */
const pairOf = (raw) =>
  Array.isArray(raw) && raw.length >= 2 && Number(raw[0]) >= 0 && Number(raw[1]) >= 0
    ? [Number(raw[0]), Number(raw[1])]
    : null

const emptyPair = () => ({ init: null, initState: null, max: null, maxState: null })

/**
 * 汇编。
 *
 * @param shipTable     `assets/lodes/kcwiki-ships.json` 的 `data`（基座票，供值）
 * @param wikiwikiTable `assets/lodes/wikiwiki-ship-max.json` 的 `data`（投票票，可缺）
 * @param masterShips   主数据 `api_mst_ship` 数组——只用来取形态名；没有就退回 kcwiki 的日文名
 */
export const buildShipStats = ({
  shipTable,
  wikiwikiTable = null,
  masterShips = [],
  compiledAt = new Date().toISOString(),
}) => {
  const entries = Object.values(shipTable ?? {}).filter((one) => Number.isInteger(one?.ID))
  if (!entries.length) throw new Error('kcwiki-ships 基座为空，拒绝出包')

  const nameOf = new Map(
    (masterShips ?? []).map((one) => [Number(one?.api_id), String(one?.api_name ?? '')]),
  )
  const forms = {}
  const warnings = []
  const unresolved = []

  // ---- 第一遍：基座 ----
  for (const entry of entries) {
    const formId = Number(entry.ID)
    const form = { name: nameOf.get(formId) || String(entry.日文名 ?? entry.中文名 ?? `#${formId}`) }
    for (const key of KEYS) {
      const pair = pairOf(entry.数据?.[KCWIKI_FIELD[key]])
      form[key] = pair
        ? { init: pair[0], initState: 'single', max: pair[1], maxState: 'single' }
        : emptyPair()
    }
    forms[`${formId}`] = form
  }

  // ---- 第二遍：补丁台账（供值） ----
  for (const patch of SHIP_STAT_PATCHES) {
    const existing = forms[`${patch.formId}`]
    const current = existing?.[patch.key]?.[patch.end]
    const baseNow = Number.isInteger(current) ? current : null
    // 自失效：基座那一格还是台账记下它时的样子吗
    if (existing && baseNow !== patch.base) {
      warnings.push(
        `补丁失效跳过：${patch.name}(${patch.formId}) ${patch.key}.${patch.end} ` +
          `台账记的基座值 ${patch.base ?? '缺'}，现在是 ${baseNow ?? '缺'}——上游改过这一格，重核后再改台账`,
      )
      continue
    }
    if (!existing) {
      // 基座整条没有这个形态（kcwiki 系统性停收的那批 / 新实装）：补丁台账自己把它建起来
      forms[`${patch.formId}`] = {
        name: nameOf.get(patch.formId) || patch.name,
        evasion: emptyPair(),
        asw: emptyPair(),
        los: emptyPair(),
      }
    }
    const slot = forms[`${patch.formId}`][patch.key]
    slot[patch.end] = patch.value
    slot[stateFieldOf(patch.end)] = patch.via === 'ledger' ? 'ledger' : 'patched'
  }

  // ---- 第三遍：wikiwiki 投票（升 multi / 报新漂移） ----
  const patchedCells = new Set(
    SHIP_STAT_PATCHES.map((one) => `${one.formId}|${one.key}|${one.end}`),
  )
  const suspectCells = new Set(
    SHIP_STAT_SUSPECT_CELLS.map((one) => `${one.formId}|${one.key}|${one.end}`),
  )
  let voted = 0
  if (wikiwikiTable && Object.keys(wikiwikiTable).length) {
    for (const [formId, form] of Object.entries(forms)) {
      const vote = wikiwikiTable[formId]
      if (!vote) continue
      for (const key of KEYS) {
        for (const end of ENDS) {
          const field = end === 'init' ? `${WIKIWIKI_FIELD[key]}Init` : WIKIWIKI_FIELD[key]
          const their = vote[field]
          if (!Number.isInteger(their)) continue
          const slot = form[key]
          if (!Number.isInteger(slot?.[end])) continue
          voted += 1
          if (slot[end] === their) {
            // 已经是 ledger / patched 的不降档也不改口径——它们的证据比「两 wiki 一致」硬
            if (slot[stateFieldOf(end)] === 'single') slot[stateFieldOf(end)] = 'multi'
            continue
          }
          const cell = `${formId}|${key}|${end}`
          if (patchedCells.has(cell) || suspectCells.has(cell)) continue
          unresolved.push({
            formId: Number(formId),
            name: form.name,
            key,
            end,
            packed: slot[end],
            wikiwiki: their,
            why: '2026-08-22 那次逐格裁决之后新出现的分歧——补一条补丁或一条挂牌，别静默',
          })
        }
      }
    }
  } else {
    warnings.push(
      'wikiwiki-ship-max 不在本机（或为空）：第二张票缺席，所有格停留在 single。' +
        '出包的值不受影响（值本来就来自基座 + 补丁台账），只是印证说不到 multi。',
    )
  }

  // ---- 统计 ----
  const stats = { forms: 0, cells: 0, ledger: 0, multi: 0, patched: 0, single: 0, gaps: 0, voted }
  for (const form of Object.values(forms)) {
    stats.forms += 1
    for (const key of KEYS) {
      for (const end of ENDS) {
        const state = form[key]?.[stateFieldOf(end)]
        if (!state) {
          stats.gaps += 1
          continue
        }
        stats.cells += 1
        stats[state] += 1
      }
    }
  }

  return {
    data: {
      schemaVersion: 1,
      compiledAt,
      voters: {
        kcwiki: '舰娘百科「模块:舰娘数据」的 数据.回避/对潜/索敌 = [Lv1, Lv99] 端点对（基座，供值）',
        wikiwiki:
          '艦これ攻略 Wiki「艦船最大値」总表与定向舰页——只投票不供值；供值的只有 ship-stats-patches.ts 里逐条转写带依据的分歧格',
        ledger:
          '本机账本一手：api_kaihi/api_taisen/api_sakuteki 的 [1]，游戏对持有形态直接下发的 Lv99 上限',
      },
      forms,
    },
    stats,
    warnings,
    unresolved,
    suspects: SHIP_STAT_SUSPECT_CELLS,
    gaps: SHIP_STAT_GAPS,
  }
}

/** 主数据快照里的 api_mst_ship（维护者本机有账本才有；没有就返回空数组）。 */
export const loadMasterShips = ({ snapshotPath = null } = {}) => {
  const file =
    snapshotPath ?? userDataPathIfAny('snapshots', 'kcsapi_api_start2_getData.json')
  if (!file) return []
  try {
    const body = JSON.parse(readFileSync(file, 'utf8'))?.body?.api_data
    return Array.isArray(body?.api_mst_ship) ? body.api_mst_ship : []
  } catch (_error) {
    return []
  }
}
