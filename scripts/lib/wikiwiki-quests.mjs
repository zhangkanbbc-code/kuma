import { htmlText, tableGrid } from '../map-intel.mjs'

// wikiwiki 任務 各分类页的表结构（2026-08 实测）：
//   ID | 任務名 | 内容 | 獲得ボーナス(燃/弾/鋼/ボ/その他 五列) | 開放条件/備考 | 実装
// 任務名列带 <a class="anchor" name="id-A2">，開放条件列的前提写法：
//   (A1)はじめての「編成」！ 達成後            —— 单前置
//   (A35)… 及び (B14)… 達成後                 —— 多前置 AND
//   (B42)… 及び () 達成後？ / 【検証中】       —— wiki 自己标不确定
// 前提码只认「達成後/クリア後」语境；備考里顺带提到的任务码不当前置收。

/** 任务码：A1 / B100 / Bd1 / Bq13 / WB02（结婚任务）。 */
const CODE = /^[A-Z]{1,2}[a-z]?\d+$/

const codesInText = (text) =>
  [...`${text ?? ''}`.matchAll(/\(([A-Z]{1,2}[a-z]?\d+)\)/g)].map((match) => match[1])

const codesInAnchors = (html) =>
  [...`${html ?? ''}`.matchAll(/#id-([A-Za-z0-9]+)/g)]
    .map((match) => match[1])
    .filter((code) => CODE.test(code))

export const parseWikiwikiQuestPage = (html, pageName = '') => {
  const entries = []
  const warnings = []
  const tables = [...`${html ?? ''}`.matchAll(/<table\b[^>]*>[\s\S]*?<\/table\s*>/gi)].map(
    (match) => match[0],
  )
  for (const table of tables) {
    const grid = tableGrid(table)
    const headerAt = grid.findIndex((row) => {
      const labels = row.map((cell) => cell?.text ?? '')
      return (
        labels.includes('ID') &&
        labels.includes('任務名') &&
        labels.some((label) => label.includes('開放条件'))
      )
    })
    if (headerAt < 0) continue
    const labels = grid[headerAt].map((cell) => cell?.text ?? '')
    const idCol = labels.indexOf('ID')
    const nameCol = labels.indexOf('任務名')
    const condCol = labels.findIndex((label) => label.includes('開放条件'))
    for (const row of grid.slice(headerAt + 1)) {
      const code = `${row[idCol]?.text ?? ''}`.trim()
      if (!CODE.test(code)) continue
      const nameCell = row[nameCol]
      const nameJp = `${nameCell?.text ?? ''}`.trim()
      if (!nameJp) continue
      // 锚点自带码；与 ID 列对不上说明表错位，宁可整行报警不收
      const anchor = `${nameCell?.html ?? ''}`.match(/name\s*=\s*"?id-([A-Za-z0-9]+)"?/)?.[1]
      if (anchor && anchor !== code) {
        warnings.push(`${pageName}: 行 ${code} 的锚点是 id-${anchor}，表可能错位，跳过`)
        continue
      }
      const cond = row[condCol]
      const condText = htmlText(cond?.html ?? '', ' ')
      const referenced = [
        ...new Set([...codesInText(condText), ...codesInAnchors(cond?.html)]),
      ].filter((ref) => ref !== code)
      const isPrereqContext = /達成後|クリア後|達成で/.test(condText)
      entries.push({
        code,
        nameJp,
        // 前提码只在達成後语境下收；其余引用（同时出现/备注顺带提及）留在 raw 里
        pre: isPrereqContext ? referenced : [],
        mentioned: isPrereqContext ? [] : referenced,
        // wiki 自己没把握的（達成後？/【検証中】/空括号）如实带出，对账时降权
        uncertain: /達成後？|【検証中】|\(\s*\)/.test(condText),
        condRaw: condText,
        page: pageName,
      })
    }
  }
  return { entries, warnings }
}
