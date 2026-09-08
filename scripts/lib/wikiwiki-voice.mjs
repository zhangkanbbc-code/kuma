import { htmlText, tableGrid } from '../map-intel.mjs'
import { decodeVoiceHtmlEntities, normalizeVoiceLine } from '../../src/shared/voice-lineage.ts'
import { foldVoiceLineForCompare } from '../../src/shared/voice-scene-slots.ts'

const CIRCLE = /^[○◯〇⭕]+$/

/** 去脚注及紧随英文的读音括号；括号后的孤立句号不属于台词。 */
export const cleanWikiwikiVoiceText = (value) => decodeVoiceHtmlEntities(value)
  .replace(/\*\d+/g, '')
  .replace(/([A-Za-z][A-Za-z\s]*[！!？?]?)\s*[（(][ァ-ヺー\s]+[）)]。?/g, '$1')
  .trim()

const specialAttackRows = (rows) => {
  const out = []
  let main = 900
  let night = 990
  for (const row of rows) {
    if (!/(^|\/)\s*特殊攻撃/.test(row.scene)) { out.push(row); continue }
    // 長門の旧句と現行句は同じ分岐。旧句は備考に残し、槽を一つ進めない。
    if (row.ja === '行くぞ、一斉射！て――ッ！！' && rows.some(line =>
      line.ja === '行くぞ、主砲一斉射！て――ッ！！')) continue
    const line = { ...row }
    if (line.ja === '行くぞ、主砲一斉射！て――ッ！！' && !line.note?.includes('旧句：')) {
      line.note = `${line.note ?? ''} / 旧句：行くぞ、一斉射！て――ッ！！`
    }
    // 2026-09-08 用户耳测：金剛／比叡的「特殊攻撃」行虽备注夜战号令，仍归 900 主线。
    // 各僚艦ボイス或备注点名僚舰的榛名式分支才从 990 起排。
    const nightAttack = /(?:金剛|比叡|榛名|霧島)僚艦/.test(line.note ?? '') || /各僚艦ボイス/.test(line.scene)
    delete line.voiceId
    if (!/汎用/.test(line.note ?? '')) {
      const slot = nightAttack ? night++ : main++
      if (slot <= (nightAttack ? 993 : 903)) line.voiceId = slot
    }
    out.push(line)
  }
  return out
}

const explicitSmallDamageSlot = (scene) => {
  const number = /(^|\/)\s*小破([12])\s*($|\/)/.exec(scene.normalize('NFKC'))?.[2]
  return number ? 18 + Number(number) : null
}

/** 本形态及 api_aftershipid 反向可达的前置形态；同句跨槽的证据丢弃，不跨谱系。 */
export const buildSmallDamageEvidence = ({ mstId, ships, subtitleJa, kcwikiVoice }) => {
  const predecessors = new Map()
  for (const ship of ships) {
    const after = Number(ship.api_aftershipid)
    if (after > 0) predecessors.set(after, [...(predecessors.get(after) ?? []), Number(ship.api_id)])
  }
  const evidence = new Map()
  const ambiguous = new Set()
  const add = (ja, slot) => {
    const folded = foldVoiceLineForCompare(normalizeVoiceLine(ja))
    if (!folded || ambiguous.has(folded)) return
    if (evidence.has(folded) && evidence.get(folded) !== slot) {
      evidence.delete(folded)
      ambiguous.add(folded)
    } else evidence.set(folded, slot)
  }
  const visited = new Set()
  const pending = [Number(mstId)]
  while (pending.length) {
    const id = pending.pop()
    if (visited.has(id)) continue
    visited.add(id)
    for (const slot of [19, 20]) add(subtitleJa[id]?.[slot], slot)
    for (const row of kcwikiVoice[id] ?? []) {
      const number = /-LightDmg([12])$/.exec(row.key)?.[1]
      if (number) add(row.ja, 18 + Number(number))
    }
    pending.push(...(predecessors.get(id) ?? []))
  }
  return evidence
}

/** 单一形态的已解析行；key 保留公开表格的页、表与行序，输入不改写。
 * evidence 可选：Map<折叠句, 19|20>；diagnostics 可选收集 swap / partial / conflict 及相关行。
 */
export const normalizeWikiwikiVoiceRows = (rows, evidence, diagnostics) => {
  const groups = new Map()
  for (const line of rows) {
    const match = /^(.*)#(\d+)-(\d+)$/.exec(line.key)
    if (!match) throw new Error(`wikiwiki 行缺少表内行序：${line.key}`)
    const group = `${match[1]}#${match[2]}`
    const entries = groups.get(group) ?? []
    entries.push({ line, row: Number(match[3]) })
    groups.set(group, entries)
  }
  const replacements = new Map()
  for (const entries of groups.values()) {
    const lines = specialAttackRows(entries.sort((a, b) => a.row - b.row).map(entry => entry.line)
      .filter(line => line.ja?.trim() && line.ja.trim() !== 'セリフ'))
    const sameLine = (left, right) =>
      foldVoiceLineForCompare(normalizeVoiceLine(left.ja)) ===
      foldVoiceLineForCompare(normalizeVoiceLine(right.ja))
    let smallDamageIndex = 0
    const smallDamage = []
    let explicitConflict = false
    for (const line of lines) {
      // wikiwiki 花月表（2026-09-07）：显式小破1/2（含全角与①②）直接归 19/20，不推进按列计数。
      const explicitSlot = explicitSmallDamageSlot(line.scene)
      if (explicitSlot != null) {
        replacements.set(line, { ...line, voiceId: explicitSlot })
        const evidenceSlot = evidence?.get(foldVoiceLineForCompare(normalizeVoiceLine(line.ja)))
        if (evidenceSlot != null && evidenceSlot !== explicitSlot) {
          explicitConflict = true
          diagnostics?.push({ type: 'conflict', reason: 'explicit-slot', rows: [line], slots: [evidenceSlot] })
        }
        continue
      }
      // wikiwiki 霧島改二丙表（2026-09-07）：小破按各形态的 ○ 行计数，占位词不占槽。
      if (/(^|\/)\s*小破\s*($|\/)/.test(line.scene)) {
        replacements.set(line, { ...line, voiceId: Math.min(20, 19 + smallDamageIndex++) })
        smallDamage.push(line)
        continue
      }
      // 舰娘百科 024/196-FleetOrg、024/196-Sortie、621-FleetOrg（2026-09-07）：
      // 出撃中与同形态編成同句的行属于 13，保留編成行即可。
      if (/(^|\/)\s*出撃\s*($|\/)/.test(line.scene) &&
          lines.some(other => /(^|\/)\s*編成\s*($|\/)/.test(other.scene) && sameLine(line, other))) continue
      // wikiwiki 霧島改二丙／飛龍改三／玉波改二表（2026-09-07）：
      // 旗艦大破重复同形态小破②或中破，不另占 20；独有句仍保留 20。
      // wikiwiki 春雨改二表（2026-09-07）：也可重复小破①；仍以同形态任一其他行同句为准。
      if (/旗艦大破/.test(line.scene) &&
          lines.some(other => !/旗艦大破/.test(other.scene) && sameLine(line, other))) continue
      const original = entries.find(entry => entry.line.key === line.key).line
      replacements.set(original, /旗艦大破/.test(line.scene) ? { ...line, voiceId: 20 } : { ...line })
    }
    // 规律⑤：wikiwiki 春雨改二、随包 subtitle-ja 405/323、舰娘百科 205-LightDmg1/2（2026-09-07）。
    // 无序号小破恰有两行时，先按规律①计数，再按自身／前置形态的同句证据对齐。
    // 双命中异槽按证据；单命中补另一槽并报告；无命中保留页序；同槽或显式序号矛盾不猜。
    if (evidence && smallDamage.length === 2) {
      const slots = smallDamage.map(line => evidence.get(foldVoiceLineForCompare(normalizeVoiceLine(line.ja))))
      const matched = slots.filter(slot => slot != null).length
      if (matched === 1) diagnostics?.push({ type: 'partial', rows: smallDamage, slots })
      if (matched === 2 && slots[0] === slots[1]) {
        diagnostics?.push({ type: 'conflict', reason: 'same-slot', rows: smallDamage, slots })
      } else if (matched && !explicitConflict) {
        const resolved = [slots[0] ?? 39 - slots[1], slots[1] ?? 39 - slots[0]]
        if (resolved[0] !== 19) diagnostics?.push({ type: 'swap', rows: smallDamage, slots: resolved })
        smallDamage.forEach((line, index) => {
          replacements.set(line, { ...line, voiceId: resolved[index] })
        })
      }
    }
  }
  return rows.flatMap(line => replacements.has(line) ? [replacements.get(line)] : [])
}

export const normalizeWikiwikiShipName = (value) =>
  `${value ?? ''}`
    .normalize('NFKD')
    // wikiwiki 的链接标题有时把拉丁字母变音符号省略（Béarn → Bearn），
    // 只折叠跟在 ASCII 拉丁字母后的组合符；日文浊点必须保留。
    .replace(/([A-Za-z])[\u0300-\u036f]+/g, '$1')
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/\s+/g, '')
    .trim()

const linkedPageName = (cell) => {
  const href = `${cell?.html ?? ''}`.match(
    /href=["'](?:https:\/\/(?:wikiwiki\.jp\/kancolle|w\.kcwiki\.moe))?\/(?:kancolle\/|\.\/)([^"'#?]+)(?:[?#][^"']*)?["']/i,
  )?.[1]
  if (href) {
    try {
      return decodeURIComponent(href)
    } catch (_error) {
      return href
    }
  }
  return `${cell?.text ?? ''}`.replace(/\s+/g, '')
}

const uniqueParts = (cells) => {
  const out = []
  for (const cell of cells) {
    const text = `${cell?.text ?? ''}`.trim()
    if (text && out.at(-1) !== text) out.push(text)
  }
  return out
}

const coreVoiceId = (scene, smallDamageIndex) => {
  if (/入手|ログイン/.test(scene)) return 1
  // 母港 1..3 就是顺序的 2..4。2026-08-12 实测钉死（此前 1/2 写反，刺鲅的
  // 母港台词文不对音被用户抓到）：拿 kcwiki 台词的日文原文回连 poi-subtitle
  // 编号，秘书舰1→2 共 108 例、秘书舰2→3 共 226 例、秘书舰3→4 共 220 例，
  // 无一例外；其余场景的既有映射同口径核对全部一致。
  if (/母港1/.test(scene)) return 2
  if (/母港2/.test(scene)) return 3
  if (/母港3/.test(scene)) return 4
  if (/建造完了/.test(scene)) return 5
  if (/修理完了/.test(scene)) return 6
  if (/帰投/.test(scene)) return 7
  if (/戦績表示/.test(scene)) return 8
  if (/装備1/.test(scene)) return 9
  if (/装備2/.test(scene)) return 10
  if (/入渠.*小破/.test(scene)) return 11
  if (/入渠.*中破/.test(scene)) return 12
  if (/(^|\/)編成($|\/)/.test(scene)) return 13
  if (/(^|\/)出撃($|\/)/.test(scene)) return 14
  if (/戦闘1|昼戦開始/.test(scene)) return 15
  if (/戦闘2|昼戦攻撃/.test(scene)) return 16
  if (/戦闘4|夜戦攻撃/.test(scene)) return 17
  if (/戦闘3|夜戦開始/.test(scene)) return 18
  if (/旗艦大破/.test(scene)) return 20
  const explicitSlot = explicitSmallDamageSlot(scene)
  if (explicitSlot != null) return explicitSlot
  if (/(^|\/)小破($|\/)/.test(scene)) return Math.min(20, 19 + smallDamageIndex)
  if (/中破|大破/.test(scene)) return 21
  if (/轟沈/.test(scene)) return 22
  if (/勝利MVP/.test(scene)) return 23
  if (/ケッコンカッコカリ/.test(scene)) return 24
  if (/図鑑説明/.test(scene)) return 25
  if (/装備3/.test(scene)) return 26
  if (/(^|\/)補給($|\/)/.test(scene)) return 27
  if (/ケッコン後母港/.test(scene)) return 28
  if (/放置時/.test(scene)) return 29
  return null
}

const voiceTable = (tableHtml, pageName, tableIndex) => {
  const grid = tableGrid(tableHtml)
  const rawRows = [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)]
  const headerIndex = grid.findIndex((row) => row.some((cell) => cell?.text === 'セリフ'))
  if (headerIndex < 0) return []
  const sentenceCol = grid[headerIndex].findIndex((cell) => cell?.text === 'セリフ')
  const formHeaderIndex = grid.findIndex(
    (row, index) => {
      if (index < headerIndex) return false
      const noteCol = row.findIndex((cell, col) => col > sentenceCol && cell?.text === '備考')
      const candidates = row.slice(sentenceCol + 1, noteCol > sentenceCol ? noteCol : undefined)
      return candidates.some((cell) =>
        /href=["'](?:https:\/\/(?:wikiwiki\.jp\/kancolle|w\.kcwiki\.moe))?\/(?:kancolle\/|\.\/)(?!::cmd)/i.test(
          `${cell?.html ?? ''}`,
        ),
      )
    },
  )
  if (sentenceCol < 0 || formHeaderIndex < 0) return []

  const formHeader = grid[formHeaderIndex]
  const formColumns = []
  for (let col = sentenceCol + 1; col < formHeader.length; col++) {
    const label = `${formHeader[col]?.text ?? ''}`.trim()
    if (/^(備考|追加)$/.test(label)) break
    if (!label || label === '改装段階') continue
    const name = linkedPageName(formHeader[col])
    if (name) formColumns.push({ col, name })
  }
  if (!formColumns.length) return []

  const hourly = grid[headerIndex].some((cell) => cell?.text === '時刻')
  const noteCol = formHeader.findIndex(cell => cell?.text === '備考')
  let group = ''
  const out = new Map()
  for (let rowIndex = formHeaderIndex + 1; rowIndex < grid.length; rowIndex++) {
    const row = grid[rowIndex]
    const cells = [...new Set(row.filter(Boolean))]
    if (cells[0]?.colspan >= 5 && cells.slice(1).every(cell => cell.text === '編集') &&
        /^\s*<th\b/i.test(rawRows[rowIndex][1])) {
      group = cells[0].text.replace(/\*\d+/g, '').trim()
      continue
    }
    const ja = cleanWikiwikiVoiceText(row[sentenceCol]?.text)
    if (!ja || ja === 'セリフ' || /項目毎削除してください|特殊攻撃専用ボイスです/.test(ja)) continue
    const applicable = formColumns.filter(({ col }) => CIRCLE.test(`${row[col]?.text ?? ''}`.trim()))
    if (!applicable.length) continue

    const sceneParts = uniqueParts(row.slice(0, sentenceCol))
    const scene = [group, ...sceneParts].filter(Boolean).join(' / ')
    const note = noteCol >= 0 ? `${row[noteCol]?.text ?? ''}`.replace(/\*\d+/g, '').trim() : ''
    let hourlyVoiceId = null
    if (hourly) {
      const hour = Number.parseInt(sceneParts.at(-1) ?? '', 10)
      if (Number.isInteger(hour) && hour >= 0 && hour <= 23) hourlyVoiceId = 30 + hour
    }

    for (const { name } of applicable) {
      const voiceId = hourly ? hourlyVoiceId : coreVoiceId(sceneParts.join('/'), 0)
      const lines = out.get(name) ?? []
      const key = `${pageName}#${tableIndex}-${rowIndex}`
      const line = {
        key,
        scene,
        ja,
        page: pageName,
        ...(note ? { note } : {}),
        ...(voiceId == null ? {} : { voiceId }),
      }
      if (!lines.some((known) => known.scene === scene && known.ja === ja)) lines.push(line)
      out.set(name, lines)
    }
  }
  return [...out].map(([name, lines]) => ({ name, lines }))
}

export const parseWikiwikiVoicePage = (html, pageName) => {
  const merged = new Map()
  const tables = [...`${html ?? ''}`.matchAll(/<table\b[^>]*>[\s\S]*?<\/table\s*>/gi)]
    .map((match) => match[0])
    .filter((table) => /セリフ/.test(htmlText(table)))

  for (const [tableIndex, table] of tables.entries()) {
    for (const form of voiceTable(table, pageName, tableIndex)) {
      const lines = merged.get(form.name) ?? []
      for (const line of form.lines) {
        if (!lines.some((known) => known.scene === line.scene && known.ja === line.ja)) lines.push(line)
      }
      merged.set(form.name, lines)
    }
  }

  return [...merged].map(([name, lines]) => ({ name, lines: normalizeWikiwikiVoiceRows(lines) }))
}

const abyssVoiceSlot = (scene) => {
  if (/開幕|戦闘開始|会敵/.test(scene)) return 'opening'
  if (/砲撃|航空攻撃|雷撃|攻撃/.test(scene)) return 'attack'
  if (/被弾|中破|大破/.test(scene)) return 'damage'
  if (/撃沈|海域突破|ゲージ破壊/.test(scene)) return 'sunk'
  return null
}

const abyssVoiceSuffix = (scene, pageName) => {
  const slot = abyssVoiceSlot(scene)
  if (slot === 'opening') return 10
  if (slot === 'attack') return /装甲破砕/.test(scene) ? 21 : 20
  if (slot === 'damage') return /装甲破砕/.test(scene) ? 31 : 30
  if (slot === 'sunk') return /(?:-壊|壊)$/.test(pageName) ? 41 : 40
  return null
}

export const parseWikiwikiAbyssVoicePage = (html, pageName) => {
  const ids = [
    ...new Set(
      [...htmlText(`${html ?? ''}`).matchAll(/\bNo\.\s*(\d{4})\b/gi)]
        .map((match) => Number(match[1]))
        .filter((id) => Number.isInteger(id) && id >= 1_500 && id <= 9_999),
    ),
  ]
  const lines = []
  const tables = [...`${html ?? ''}`.matchAll(/<table\b[^>]*>[\s\S]*?<\/table\s*>/gi)]
    .map((match) => match[0])
    .filter((table) => /セリフ/.test(htmlText(table)))

  for (const [tableIndex, table] of tables.entries()) {
    const grid = tableGrid(table)
    const headerIndex = grid.findIndex((row) => row.some((cell) => cell?.text === 'セリフ'))
    if (headerIndex < 0) continue
    for (let rowIndex = headerIndex + 1; rowIndex < grid.length; rowIndex++) {
      const row = grid[rowIndex]
      const scene = `${row[0]?.text ?? ''}`.trim()
      const ja = decodeVoiceHtmlEntities(row[1]?.text).trim()
      if (
        !scene ||
        !ja ||
        scene === ja ||
        /^[-―—なし]+$/.test(scene) ||
        /^[-―—なし]+$/.test(ja)
      ) {
        continue
      }
      const slot = abyssVoiceSlot(scene)
      const suffix = abyssVoiceSuffix(scene, pageName)
      const line = {
        key: `${pageName}#abyss-${tableIndex}-${rowIndex}`,
        scene,
        ja,
        page: pageName,
        ...(slot ? { slot } : {}),
        ...(suffix == null ? {} : { suffix }),
      }
      if (!lines.some((known) => known.scene === scene && known.ja === ja)) lines.push(line)
    }
  }

  return { ids, lines }
}
