import { htmlText, tableGrid } from '../map-intel.mjs'

const ID = /^(?:\d{1,2}|[A-Z]\d)$/

const number = (value) => {
  const parsed = Number.parseInt(`${value ?? ''}`.replace(/[^\d]/g, ''), 10)
  return Number.isInteger(parsed) ? parsed : null
}

const timeText = (value) => {
  const match = `${value ?? ''}`.match(/(\d{1,3}):(\d{2})(?::\d{2})?/)
  return match ? `${match[1]}:${match[2]}` : ''
}

const rewardPair = (amount, minutes) =>
  amount > 0 ? [amount, minutes > 0 ? Math.round((amount * 60) / minutes) : null] : null

const ITEM_NAMES = [
  '高速修復材',
  '高速建造材',
  '開発資材',
  '改修資材',
  '家具箱(小)',
  '家具箱(中)',
  '家具箱(大)',
]

const parseRewardText = (raw, minutes) => {
  const text = `${raw ?? ''}`.replace(/\s+/g, ' ').trim()
  const amountOf = (name) => number(text.match(new RegExp(`${name.replace(/[()]/g, '\\$&')}×(\\d+)`))?.[1]) ?? 0
  const items = []
  for (const name of ITEM_NAMES) {
    const match = text.match(
      new RegExp(`${name.replace(/[()]/g, '\\$&')}×(\\d+)(?:[～~〜](\\d+))?`),
    )
    if (!match) continue
    items.push({
      name,
      count: Number.parseInt(match[2] ?? match[1], 10),
      min: Number.parseInt(match[1], 10),
    })
  }
  return {
    hqExp: number(text.match(/(\d+)\s*EXP/i)?.[1]) ?? 0,
    fuel: rewardPair(amountOf('燃料'), minutes),
    ammo: rewardPair(amountOf('弾薬'), minutes),
    steel: rewardPair(amountOf('鋼材'), minutes),
    baux: rewardPair(amountOf('ボーキサイト'), minutes),
    items,
  }
}

const quickRewardRows = (tables) => {
  for (const table of tables) {
    const grid = tableGrid(table)
    const header = grid.findIndex((row) => {
      const labels = row.map((cell) => cell?.text ?? '')
      return labels.includes('提督') && labels.includes('艦娘') && labels.includes('最低数')
    })
    if (header < 0) continue
    const labels = grid[header].map((cell) => cell?.text ?? '')
    const col = (label) => labels.indexOf(label)
    const map = new Map()
    for (const row of grid.slice(header + 1)) {
      const id = `${row[0]?.text ?? ''}`.trim()
      if (!ID.test(id)) continue
      map.set(id, {
        shipExp: number(row[col('艦娘')]?.text) ?? 0,
      })
    }
    if (map.size >= 50) return map
  }
  return new Map()
}

const extractStats = (text) => {
  const stats = {}
  const names = { 火力: '火力', 対空: '对空', 対潜: '对潜', 索敵: '索敌' }
  for (const [jp, zh] of Object.entries(names)) {
    const match = text.match(new RegExp(`${jp}\\s*(\\d+)`))
    if (match) stats[zh] = Number.parseInt(match[1], 10)
  }
  return Object.keys(stats).length ? stats : null
}

const translateComposition = (raw) => {
  const beforeSample = `${raw ?? ''}`
    .replace(/^.*?(?=(?:最低|全)\s*\d+\s*隻)/, '')
    .split('／')[0]
    .replace(/(?:最低|全)\s*\d+\s*隻[。．、,\s]*/g, '')
    .replace(/艦種自由/g, '任意')
    .replace(/\((駆)\+海防\)/g, '$1/海防')
    .replace(/潜水母艦/g, '@潜母舰@')
    .replace(/護衛空母/g, '护卫空母')
    .replace(/軽空母/g, '轻空母')
    .replace(/正規空母/g, '正规空母')
    .replace(/航空戦艦/g, '航战')
    .replace(/練習巡洋艦/g, '练巡')
    .replace(/練巡/g, '练巡')
    .replace(/重巡/g, '重巡')
    .replace(/軽巡/g, '轻巡')
    .replace(/水母/g, '水母')
    .replace(/護母/g, '护卫空母')
    .replace(/軽母/g, '轻空母')
    .replace(/航戦/g, '航战')
    .replace(/空母/g, '空母')
    .replace(/海防/g, '海防')
    .replace(/駆/g, '驱逐')
    .replace(/軽/g, '轻巡')
    .replace(/重/g, '重巡')
    .replace(/潜/g, '潜水')
    .replace(/@潜水母舰@|@潜母舰@/g, '潜水母舰')
    .replace(/他/g, '其他')
    .replace(/旗艦固定/g, '必须旗舰')
    .replace(/必要/g, '')
    .replace(/(\d+)\s*隻/g, '*$1')
    .replace(/[。．]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  // “または”复合编成暂不压扁为单一路径，交给旧中文结构兜底。
  return /または|或いは/.test(beforeSample) ? null : beforeSample || null
}

const requirementFacts = (raw, levelText) => {
  const text = `${raw ?? ''}`.replace(/\s+/g, ' ').trim()
  const minShips =
    number(text.match(/最低\s*(\d+)\s*隻/)?.[1]) ??
    number(text.match(/全\s*(\d+)\s*隻/)?.[1])
  const levels = [...`${levelText ?? ''}`.matchAll(/\bLv\s*(\d+)/gi)]
    .map((match) => Number.parseInt(match[1], 10))
  const drumShips = number(text.match(/(\d+)\s*隻以上にドラム缶/)?.[1])
  const drumTotal = number(text.match(/ドラム缶[^。]*?合計\s*(\d+)\s*個以上/)?.[1])
  const great = text.match(/((?:旗艦Lv|キラキラ艦|合計\d+個以上)[^。]*(?:大成功確定|大成功)[^。]*)/)?.[1]
  return {
    flagLv: levels[0] ?? null,
    fleetLv: levels[1] ?? null,
    minShips,
    composition: translateComposition(text),
    rawComposition: text,
    stats: extractStats(text),
    drumTotal,
    drumShips,
    greatNote: great ?? null,
  }
}

const detailTable = (tables) =>
  tables
    .map((table) => ({ table, grid: tableGrid(table), text: htmlText(table) }))
    .find(({ grid, text }) =>
      grid.length > 100 &&
      /難度/.test(text) &&
      /消費燃料/.test(text) &&
      /必要旗艦Lv/.test(text),
    )?.grid ?? []

export const parseWikiwikiExpeditionPage = (html) => {
  const tables = [...`${html ?? ''}`.matchAll(/<table\b[^>]*>[\s\S]*?<\/table\s*>/gi)]
    .map((match) => match[0])
  const grid = detailTable(tables)
  const quick = quickRewardRows(tables)
  const entries = {}
  for (let index = 0; index < grid.length - 2; index++) {
    const base = grid[index]
    const reward = grid[index + 1]
    const requirement = grid[index + 2]
    const id = `${base?.[0]?.text ?? ''}`.trim()
    if (
      !ID.test(id) ||
      `${reward?.[0]?.text ?? ''}`.trim() !== id ||
      `${requirement?.[0]?.text ?? ''}`.trim() !== id
    ) {
      continue
    }
    const time = timeText(base[4]?.text)
    const minutesMatch = time.match(/^(\d+):(\d{2})$/)
    const minutes = minutesMatch
      ? Number.parseInt(minutesMatch[1], 10) * 60 + Number.parseInt(minutesMatch[2], 10)
      : 0
    const facts = requirementFacts(requirement[3]?.text, requirement[2]?.text)
    const rewards = parseRewardText(reward[3]?.text, minutes)
    entries[id] = {
      id,
      nameJp: `${base[1]?.text ?? ''}`.trim(),
      difficulty: `${base[2]?.text ?? ''}`.trim(),
      descriptionJp: `${base[3]?.text ?? ''}`.trim(),
      time,
      useFuelText: `${base[5]?.text ?? ''}`.trim(),
      useBullText: `${base[6]?.text ?? ''}`.trim(),
      tags: [
        /月一回|マンスリー/.test(`${base[1]?.text ?? ''} ${base[3]?.text ?? ''}`) ? '月常' : '',
        /交戦遠征|交戦[ⅠI1-3]?型/.test(`${base[1]?.text ?? ''} ${base[3]?.text ?? ''}`)
          ? '交战型'
          : '',
      ].filter(Boolean),
      monthly: /月一回|マンスリー/.test(`${base[1]?.text ?? ''} ${base[3]?.text ?? ''}`),
      combat: /交戦遠征|交戦[ⅠI1-3]?型/.test(`${base[1]?.text ?? ''} ${base[3]?.text ?? ''}`)
        ? '交战型'
        : null,
      ...facts,
      rewards: {
        ...rewards,
        shipExp: quick.get(id)?.shipExp ?? 0,
        // 身份与左右栏语义优先使用 api_mst_mission；这里只保留页面原文中的范围。
        greatItems: [],
      },
    }
  }
  if (Object.keys(entries).length < 60) {
    throw new Error(`wikiwiki 远征清洗仅得 ${Object.keys(entries).length} 条（预期至少 60）`)
  }
  return entries
}
