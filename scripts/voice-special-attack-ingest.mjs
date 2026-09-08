// 离线补录浏览器摘下的特殊攻击表。输入路径必须显式给出，不抓页面、不改主数据。
// node scripts/voice-special-attack-ingest.mjs <行表.json>
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadStart2MasterArray } from './lib/start2.mjs'
import { normalizeWikiwikiShipName, parseWikiwikiVoicePage } from './lib/wikiwiki-voice.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;')

/** 恢复摘录中 rowspan 省去的场景与适用列，再交给正式 HTML 解析器。 */
export const specialAttackForms = (page) => {
  const pageName = decodeURIComponent(page.page.replace(/^\/kancolle\//, ''))
  const base = pageName.replace(/改.*$/, '')
  const labels = page.rows[0]?.forms ?? []
  const names = labels.map(label => {
    if (/^(未改造|無印)$/.test(label)) return base
    if (/^改/.test(label)) return base + label
    // 摘录只有表头文字，链接标题已丢失：片假名表头以本页拉丁舰名恢复。
    if (/^[A-Za-z ]+$/.test(base) && /^[ァ-ヺー]+(?:改)?$/.test(label)) {
      return base + (label.endsWith('改') ? '改' : '')
    }
    return label
  })
  if (!labels.length) return []
  let group = ''
  let scenes = []
  let marks = []
  let html = '<table><tr><th colspan="2">イベント</th><th>セリフ</th>' +
    names.map(name => `<th><a href="/kancolle/${esc(name)}">${esc(name)}</a></th>`).join('') +
    '<th>備考</th></tr>'
  for (const row of page.rows) {
    if (row.grp !== group) {
      group = row.grp
      scenes = []
      marks = []
      html += `<tr><th colspan="${names.length + 4}">${esc(group)}</th><td>編集</td></tr>`
    }
    const cells = row.cells.slice()
    if (cells.at(-1) === '編集') cells.pop()
    const note = cells.pop() ?? ''
    const markAt = cells.findIndex(cell => /^[○◯〇⭕×]+$/.test(cell))
    if (markAt >= 0) marks = cells.splice(markAt)
    const ja = cells.pop() ?? ''
    if (cells.length) scenes = cells
    html += '<tr>' + (scenes.length > 1
      ? scenes.map(scene => `<td>${esc(scene)}</td>`).join('')
      : `<td colspan="2">${esc(scenes[0])}</td>`) +
      `<td>${esc(ja)}</td>` + marks.map(mark => `<td>${esc(mark)}</td>`).join('') +
      `<td>${esc(note)}</td></tr>`
  }
  html += '</table>'
  return parseWikiwikiVoicePage(html, pageName).map(form => ({ ...form,
    // 与既有完整页的表号隔开；尾部仍是解析器要求的“表号-行号”。
    lines: form.lines.map(line => ({ ...line, key: line.key.replace('#0-', '#900-') })),
  }))
}

export const ingestSpecialAttackRows = (pack, pages, ships) => {
  const idsByName = new Map()
  for (const ship of ships) {
    if (!(Number(ship.api_id) > 0 && Number(ship.api_sortno) > 0)) continue
    const name = normalizeWikiwikiShipName(ship.api_name)
    idsByName.set(name, [...(idsByName.get(name) ?? []), ship.api_id])
  }
  let added = 0
  for (const page of pages) for (const form of specialAttackForms(page)) {
    const ids = idsByName.get(normalizeWikiwikiShipName(form.name))
    if (!ids?.length) throw new Error(`主数据找不到形态：${form.name}`)
    for (const id of ids) {
      const rows = pack.data[id] ??= []
      for (const line of form.lines) {
        if (rows.some(row => row.page === line.page && row.scene === line.scene && row.ja === line.ja)) continue
        rows.push(line)
        added++
      }
    }
  }
  return added
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('用法：node scripts/voice-special-attack-ingest.mjs <行表.json>')
  const pages = JSON.parse(readFileSync(path.resolve(process.argv[2]), 'utf8'))
  const file = path.join(root, 'assets', 'lodes', 'wikiwiki-voice.json')
  const pack = JSON.parse(readFileSync(file, 'utf8'))
  const ships = loadStart2MasterArray('api_mst_ship', root)
  if (!ships.length) throw new Error('缺少 api_mst_ship 主数据')
  const added = ingestSpecialAttackRows(pack, pages, ships)
  if (added) writeFileSync(file, `${JSON.stringify(pack)}\n`)
  console.log(`特殊攻击底本：并入 ${added} 行`)
}
