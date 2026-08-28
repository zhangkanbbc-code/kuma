import { tableGrid } from '../map-intel.mjs'

/**
 * wikiwiki 逐舰页的「舰娘档案」解析:CV / 画师 / 舰级+番舰 / 初期装备。
 *
 * 为什么有这个包:kcwiki-ships(kcwiki-luatable ships.json)自 2023 年的
 * 霧島改二丙起系统性停收新形态(2026-08-11 实测缺 89 个),这四项字段在
 * 那 89 个形态上全部落空,而属性/消耗有主数据一手兜底、三维有
 * wikiwiki-ship-max 兜底,唯独这四项没有第二来源。按「实体级回退」纪律,
 * kcwiki 收录的形态仍以 kcwiki 为准,本包只补它没有的实体。
 *
 * 页面形状(2026-08-11 日枝丸/杉等实测):
 *   · CV 与画师在语音折叠块的「CV：井上喜久子、イラストレーター：赤坂ゆづ」
 *     一行里;旧页有「イラスト/絵師」变体。
 *   · 舰级在首个性能表的「◯◯級 2番艦」单元格(級/型混用,消费端搜索
 *     已做 级↔型 归一)。
 *   · 初期装备在性能表「搭載|装備」表头之后的行:[搭载数, 装备名] /
 *     [未装備] / [装備不可]。装备名对不上主数据时整个形态不发
 *     initialEquips(残缺列表会被当成完整初期配置,宁缺勿错)。
 */

const decodeText = (t) =>
  `${t ?? ''}`
    .replace(/<br[^>]*>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;|&#160;| /g, ' ')
    .trim()

const normName = (s) =>
  `${s}`
    .replace(/\s+/g, '')
    .replace(/＋/g, '+')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/／/g, '/')
    .replace(/＆/g, '&')
    .toLowerCase()

export const parseShipProfilePage = (html, { itemByNorm }) => {
  const text = decodeText(html)
  const out = {}
  const warnings = []

  const cv = text.match(/CV[：:]\s*([^、，,\n<]+)/)
  if (cv) out.cv = cv[1].trim().replace(/[（(].*$/, '').trim()
  const artist = text.match(/(?:イラストレーター|イラスト|絵師)[：:]\s*([^、，,\n<]+)/)
  if (artist) out.artist = artist[1].trim().replace(/[（(].*$/, '').trim()

  const tables = [...`${html ?? ''}`.matchAll(/<table\b[^>]*>[\s\S]*?<\/table\s*>/gi)].slice(0, 3)
  for (const match of tables) {
    const grid = tableGrid(match[0])
    // 舰级:含「N番艦」的单元格(限性能表,避免撞上図鑑説明里的「二番艦」叙述)
    if (!out.shipClass) {
      for (const row of grid) {
        for (const cell of row) {
          const cellText = decodeText(cell?.text ?? '')
          const m = cellText.match(/^([^\s]{1,20}?[級型])\s*(\d{1,3})\s*番艦([\s\S]*)$/m)
          if (m) {
            out.shipClass = [m[1], Number(m[2])]
            // 番艦之后通常跟着舰种字样(「松型 7番艦 駆逐艦」)——同名形态用它
            // 验证裸名页归属(Glorious 巡洋戦艦/正規空母 两形态同名)
            const stype = m[3].replace(/[\s|]+/g, ' ').trim()
            if (stype) out.stypeText = stype
            break
          }
        }
        if (out.shipClass) break
      }
    }
    // 初期装备:「搭載|装備」双列表头,或无搭载舰的单格「装備」表头
    if (!out.initialEquips) {
      const headIndex = grid.findIndex((row) => {
        const cells = row.map((cell) => decodeText(cell?.text ?? '')).filter(Boolean)
        const set = new Set(cells)
        return set.has('装備') && (set.size === 1 || set.has('搭載'))
      })
      if (headIndex >= 0) {
        const slots = []
        let ok = true
        for (const row of grid.slice(headIndex + 1)) {
          const cells = row.map((cell) => decodeText(cell?.text ?? '')).filter(Boolean)
          if (!cells.length) continue
          const joined = cells.join(' ')
          if (/装備不可/.test(joined)) continue // 锁死槽不算初期装备位
          if (/^(改造チャート|図鑑説明|最大消費量)/.test(joined)) break
          if (/未装備|^-$/.test(joined)) {
            slots.push(-1)
            continue
          }
          // [搭载数, 装备名] 或只有装备名;「★+3」是初始改修星级标注,不属于名字
          const name = (cells.length >= 2 ? cells[cells.length - 1] : cells[0]).replace(/★\+?\d+\s*$/, '').trim()
          if (/^\d+$/.test(name)) continue
          const id = itemByNorm.get(normName(name))
          if (!id) {
            warnings.push(`初期装备名对不上主数据:「${name}」`)
            ok = false
            break
          }
          slots.push(id)
        }
        if (ok && slots.length) out.initialEquips = slots
      }
    }
  }
  return { profile: out, warnings }
}

export const buildItemNameIndex = (items) =>
  new Map(items.map((item) => [normName(item.api_name), Number(item.api_id)]))
