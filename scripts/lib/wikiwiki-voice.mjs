import { htmlText, tableGrid } from '../map-intel.mjs'

const CIRCLE = /^[○◯〇⭕]+$/

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
  const out = new Map()
  let smallDamageIndex = 0
  for (let rowIndex = formHeaderIndex + 1; rowIndex < grid.length; rowIndex++) {
    const row = grid[rowIndex]
    const ja = `${row[sentenceCol]?.text ?? ''}`.trim()
    if (!ja) continue
    const applicable = formColumns.filter(({ col }) => CIRCLE.test(`${row[col]?.text ?? ''}`.trim()))
    if (!applicable.length) continue

    const sceneParts = uniqueParts(row.slice(0, sentenceCol))
    const scene = sceneParts.join(' / ')
    let voiceId = null
    if (hourly) {
      const hour = Number.parseInt(sceneParts.at(-1) ?? '', 10)
      if (Number.isInteger(hour) && hour >= 0 && hour <= 23) voiceId = 30 + hour
    } else {
      voiceId = coreVoiceId(scene, smallDamageIndex)
      if (/(^|\/)小破($|\/)/.test(scene) && !/旗艦大破/.test(scene)) smallDamageIndex++
    }

    for (const { name } of applicable) {
      const lines = out.get(name) ?? []
      const key = `${pageName}#${tableIndex}-${rowIndex}`
      const line = {
        key,
        scene,
        ja,
        page: pageName,
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

  return [...merged].map(([name, lines]) => ({ name, lines }))
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
      const ja = `${row[1]?.text ?? ''}`.trim()
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
