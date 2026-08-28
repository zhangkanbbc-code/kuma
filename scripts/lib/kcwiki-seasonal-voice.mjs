// zh.kcwiki「季节性/*」页的季节限定台词解析。
//
// 为什么单独一个域、而不是并进 kcwiki-voice：
// 舰娘页上的「====季节限定语音====」小节里**一行台词都没有**，
// 它整段是 `{{#widget:SeasonalSubtitle|id=080}}` 这样的挂件调用（实测时雨页 / 雪风页），
// 真正的文本住在 `季节性/2015年圣诞节` 这类独立页上。
// kcwiki-voice 的抓取器至今把这些页外的段落当「未匹配到 mstId 的段落」丢掉——
// 那句日志里的「多为季节限定等非形态小节」说的就是这件事。
//
// **穷举过再下结论**（上一批的教训）：2026-08-22 拉过 zh.kcwiki 的
// Module 名字空间全表（82 项，见下方 note），没有任何一个模块存台词；
// 台词只以 wikitext 的 `{{台词翻译表}}` 形式存在。所以这里只能解析 wikitext。
//
// ---- 日中对照，两列都收（2026-08-22 撤销了原来的「只收中文」）----
// 原来这里只落中文，理由是把任务域 2026-08-21 的「日文原文不进分发物」口径类推过来。
// **那条类推被用户当日推翻了**：台词的逐字转写权利归 C2，而随包早就有
// `kcwiki-voice` 的 ja 列与整份 `subtitle-ja`——这一列与它们**同级同灰度，不加深**。
// 于是日文补回来：台词卷本来就该是日中对照，只给中文是半张表。
// 译文缺失仍旧如实留空，绝不拿日文顶上；反过来上游没转日文的行也照实留空
//（2024 十一周年那几张页只填了中文，实测 91 行）。
// `--seasonal-voice-audit` 那份维护者侧材料照旧留着——它带着**每一次列出**的原始行，
// 是回溯「这一句当年在哪张页上怎么写的」的底本，不因为包里有了 ja 就没用了。

// 场景 token → 槽位的实测对照表已挪到 `src/shared/voice-scene-slots.ts`
//（走 Node 的类型剥离直接 import .ts，与 fetch-lodes 引 cjk-fold 同一条路）。
// 挪的理由：图鉴的**常规台词区**也要用同一份来反算播放地址——
// 2026-08-22 用户实机报出国後的「秘书舰1」行没有播放钮，根因就是那边只靠
// 日文文本匹配、没用这张现成的实证表。两处各写一份必然漂移，而漂移的表现是
// 「有些行莫名其妙没有播放钮」，不报错。
export {
  VOICE_SCENE_SLOTS as SEASONAL_SCENE_SLOTS,
  parseVoiceKey as parseSeasonalVoiceKey,
} from '../../src/shared/voice-scene-slots.ts'
export { buildShipFormCodeMap } from '../../src/shared/voice-scene-slots.ts'

import { parseVoiceKey } from '../../src/shared/voice-scene-slots.ts'
import { normalizeVoiceText } from '../../src/shared/voice-text.ts'

/**
 * 页名 → 季节标识。`季节性/2015年圣诞节` → { id: '2015-圣诞节', year: 2015, name: '圣诞节' }。
 *
 * 季节名取**页名**而不是档名里的罗马字（Christmas / Seika / Setubunn…）：
 * 页名是中文、是 kcwiki 自己的分类口径，而档名罗马字同一个季节有多种拼法
 * （Setubunn / Setsubunn / Setsubun 三种都出现过），拿它当分组键会把一个季节劈成三份。
 */
export const parseSeasonPageTitle = (rawTitle) => {
  const title = `${rawTitle ?? ''}`.trim()
  if (!title.startsWith('季节性/')) return null
  const label = title.slice('季节性/'.length)
  const matched = /^(\d{4})年(.+)$/.exec(label)
  if (matched) {
    return {
      id: `${matched[1]}-${matched[2]}`,
      title: label,
      year: Number(matched[1]),
      name: matched[2],
    }
  }
  // `Comptiq2018年6月号特典语音` 这类没有「YYYY年<季节>」形状的特典页：
  // 年份认得出就带上，认不出宁可不写，别拿页名里的任意数字当年份。
  const loose = /(\d{4})/.exec(label)
  return {
    id: label,
    title: label,
    ...(loose ? { year: Number(loose[1]) } : {}),
    name: label,
  }
}

// 形态码表（`buildShipFormCodeMap`）2026-08-22 起也住在 shared：运行时的台词归属校正
//（同一个文件里的归属校正那一段）要用同一份——kcwiki 会把改形态的档名塞进基础形态，
// 抓取器与图鉴两边都得按同一套码把行挪回它自己的形态。各写一份必然漂移，
// 而漂移的表现是「有些台词莫名其妙归错了舰」，不报错。

// ---- wikitext 取值 ----

/** 提取 `{{name|…}}` 模板调用（嵌套花括号安全）。 */
export const seasonalTemplateCalls = (text, name) => {
  const out = []
  const source = `${text ?? ''}`
  const re = new RegExp(`\\{\\{\\s*${name}\\s*[|\\n]`, 'g')
  let matched
  while ((matched = re.exec(source))) {
    let depth = 0
    let index = matched.index
    for (; index < source.length - 1; index++) {
      if (source[index] === '{' && source[index + 1] === '{') {
        depth++
        index++
      } else if (source[index] === '}' && source[index + 1] === '}') {
        depth--
        index++
        if (depth === 0) break
      }
    }
    out.push(source.slice(matched.index + 2, index - 1))
  }
  return out
}

/** 顶层 `|` 分割成 `名=值`（不切开嵌套模板/链接内部的 `|`）。 */
export const seasonalParams = (inner) => {
  const parts = []
  let depth = 0
  let current = ''
  const source = `${inner ?? ''}`
  for (let index = 0; index < source.length; index++) {
    const two = source.slice(index, index + 2)
    if (two === '{{' || two === '[[') {
      depth++
      current += two
      index++
      continue
    }
    if (two === '}}' || two === ']]') {
      depth--
      current += two
      index++
      continue
    }
    if (source[index] === '|' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += source[index]
  }
  parts.push(current)
  const map = {}
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    map[part.slice(0, eq).trim()] = part.slice(eq + 1).trim()
  }
  return map
}

const stripWiki = (value) =>
  `${value ?? ''}`
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/\{\{\s*(?:ruby-zh|ruby-ja|lang)\s*\|([^|{}]*)(?:\|[^{}]*)?\}\}/gi, '$1')
    .replace(/\{\{[^|{}]*\|([^{}]*)\}\}/g, '$1')
    .replace(/\{\{([^|{}]+)\}\}/g, '$1')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, '$1')
    // 页面里混进过不可见的格式控制字符（舰娘名字段实测有 U+200E 左至右标记），
    // 留着会让后续按名对照整条落空。Cf 类一次清干净，别只删见过的那一个。
    .replace(/\p{Cf}/gu, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()

/**
 * 一张季节性页 → 台词行数组。
 *
 * 返回的行**保留 `ja`**：它是回连语音槽位与维护者对账用的中间量，
 * 由调用方在落盘前丢掉（随包产物不含日文，见文件头）。
 */
export const parseSeasonalVoicePage = (text, pageTitle) => {
  const source = `${text ?? ''}`
  if (/^\s*#\s*(?:重定向|REDIRECT)/i.test(source)) return []
  const season = parseSeasonPageTitle(pageTitle)
  if (!season) return []
  const out = []
  for (const inner of seasonalTemplateCalls(source, '台词翻译表')) {
    const params = seasonalParams(inner)
    const zh = stripWiki(params['中文译文'])
    const ja = stripWiki(params['日文台词'])
    if (!zh && !ja) continue
    const key = stripWiki(params['档名'])
    const parsed = parseVoiceKey(key)
    out.push({
      key,
      code: parsed.code,
      // 裸编号档名（`1188`、`320`…）没有形态码、也没有舰娘名字：它们是**短剧/群像语音**
      // ——多位舰娘同台的一段演出，归属不属于任何单一形态。此前整条被丢弃。
      // 实证锚点：用户台账里游戏请求过 `/kcs/sound/kc9997/1188.mp3`，
      // 而 `1188` 的档名就在 2017 年秋季活动决战前夜页上带着中文译文（西村舰队短剧）。
      // 其余 6 条（2019 节分的 320~325）形状与语境相同，一并按短剧收；
      // **不断言它们一定在 kc9997**——匹配只在游戏真的请求那个档名时才发生，
      // 猜错的后果是「这一条没字幕」，不会变成一句假话。
      skit: /^\d{1,5}$/.test(key) ? key : '',
      // 页面自己写了「场合」时以它为准（58 行有），否则用档名 token 推
      scene: stripWiki(params['场合']) || parsed.scene,
      slot: parsed.slot,
      name: stripWiki(params['舰娘名字']),
      no: stripWiki(params['编号']),
      zh,
      ja,
      season: season.id,
    })
  }
  return out
}

/** 档名尾部的年份（`005-Sec1Christmas2015` → 2015）。没有就 null，不猜。 */
export const seasonalKeyYear = (key) => {
  const tail = `${key ?? ''}`.split('-').slice(1).join('-')
  const matched = /((?:19|20)\d\d)/.exec(tail)
  return matched ? Number(matched[1]) : null
}

/**
 * 行数组 + 形态码表 → 随包结构。
 *
 * 归属**先按档名的形态码**（实测 25152 行里命中 99.7%），码落空才退到舰娘名字；
 * 两条都落空的行整条弃用——季节页里有 57 行是任务/NPC 语音，压根没有舰娘归属，
 * 硬塞给某艘舰不如不收。
 *
 * ---- 为什么 25152 行只落 5420 条 ----
 * **每张季节页都会把往年同季节的台词一并列出**（2016年圣诞节那页同时列着
 * Christmas2013/2014/2015 的行）。所以「行数」不是台词条数：
 * 台词的身份是**档名**（它自带舰形态 + 场景 + 季节 + 年份），实测 25152 行里
 * 只有 5420 个不同档名。按档名去重，同时把它落回**自己那一年**的季节分组：
 * 档名带年份就找同年那张页，找不到（或档名没年份，如 `005-2ndAnniv`）才退到
 * 最早列出它的那一页。不这么做的话，一条 2015 年的圣诞台词会在 2016/2017/…
 * 每个圣诞分组里各出现一次。
 */
export const buildSeasonalVoicePack = (rows, codeMap, nameMap, seasons) => {
  const ships = {}
  // 短剧/群像语音：多位舰娘同台的一段演出，没有单一形态归属，单开一栏。
  const skits = {}
  const stats = {
    total: rows.length,
    kept: 0,
    byCode: 0,
    byName: 0,
    dropped: 0,
    withoutZh: 0,
    withSlot: 0,
    duplicateListings: 0,
    divergentText: 0,
    skits: 0,
  }
  const seasonYear = (id) => seasons[id]?.year ?? null

  // ① 先按 (mstId, 档名) 归并，选出这条台词的「本家」那一次列出
  const grouped = new Map()
  for (const row of rows) {
    if (row.skit) {
      // 同一段短剧被多张页列过时，取最早那一张（与台词的「本家」同一条口径）
      const known = skits[row.skit]
      const earlier =
        !known || (seasonYear(row.season) ?? 9999) < (seasonYear(known.season) ?? 9999)
      if (earlier) {
        skits[row.skit] = {
          season: row.season,
          ...(row.scene ? { scene: row.scene } : {}),
          // 日文原文**照原样落盘**，不过标点归一：那条体例管的是我们的中文译文
          ja: `${row.ja ?? ''}`,
          zh: normalizeVoiceText(row.zh), // 译文缺失如实留空，不拿日文顶上
        }
        if (!known) stats.skits++
      }
      continue
    }
    let mstId = row.code ? (codeMap.get(row.code) ?? null) : null
    if (mstId != null) stats.byCode++
    if (mstId == null && row.name) {
      mstId = nameMap.get(row.name) ?? null
      if (mstId != null) stats.byName++
    }
    if (mstId == null) {
      stats.dropped++
      continue
    }
    const groupKey = `${mstId} ${row.key}`
    const known = grouped.get(groupKey)
    if (!known) {
      grouped.set(groupKey, { mstId, rows: [row] })
      continue
    }
    known.rows.push(row)
    stats.duplicateListings++
  }

  for (const { mstId, rows: listings } of grouped.values()) {
    const keyYear = seasonalKeyYear(listings[0].key)
    const sameYear = listings.filter((row) => seasonYear(row.season) === keyYear)
    const pool = keyYear != null && sameYear.length ? sameYear : listings
    // 同年有多张页列过就取最早那一张（首次公布的那一季）；档名没年份同理
    const home = [...pool].sort(
      (left, right) =>
        (seasonYear(left.season) ?? 9999) - (seasonYear(right.season) ?? 9999) ||
        left.season.localeCompare(right.season),
    )[0]
    // 译文在不同页上被改写过时如实计数；本家那份为准，本家空着才拿别处的补
    if (new Set(listings.map((row) => row.zh)).size > 1) stats.divergentText++
    // 落盘前过一道**中文标点体例归一**（行尾不写句号、省略号后不许再接句号）：
    // 判据与理由见 src/shared/voice-text.ts。放在这里而不是只在显示期做，
    // 是因为这个包会被整份重抓——不在落盘那一步治，每次重抓都会把体例冲回去。
    const zh = normalizeVoiceText(home.zh || listings.find((row) => row.zh)?.zh || '')
    if (!zh) stats.withoutZh++
    if (home.slot != null) stats.withSlot++
    const list = (ships[mstId] ??= [])
    list.push({
      season: home.season,
      key: home.key,
      ...(home.scene ? { scene: home.scene } : {}),
      ...(home.slot != null ? { slot: home.slot } : {}),
      // 日文原文**照原样落盘**（标点归一那条体例管的是我们的中文译文，不管原文转写）。
      // 本家那一季没转日文时退到别的季列过的同一档名——同一个档名指的是同一句台词；
      // 两边都没有就照实留空（2024 十一周年那几张页只填了中文）。
      ja: `${home.ja || listings.find((row) => row.ja)?.ja || ''}`,
      // 译文缺失如实留空，不拿日文顶上
      zh,
    })
    stats.kept++
  }
  for (const list of Object.values(ships)) {
    list.sort(
      (left, right) =>
        (seasons[right.season]?.year ?? 0) - (seasons[left.season]?.year ?? 0) ||
        left.season.localeCompare(right.season) ||
        (left.slot ?? 99) - (right.slot ?? 99) ||
        left.key.localeCompare(right.key),
    )
  }
  return { data: { schemaVersion: 1, seasons, ships, skits }, stats }
}
