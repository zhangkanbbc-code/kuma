// wikiwiki「改修表」→ 装备改修详表(equip-upgrades 同构包)。
//
// 为什么换源:2026-08-11 与 EO EquipmentUpgrades.json 全量对账,EO 名单虽 372/372
// 齐平,但内容系统性停在 2025 年初——9 条新增更新链缺失(12.7cm連装高角砲(後期型)→改二、
// 12cm単装高角砲E型→E型改、試製 23号電探改三→SCレーダー改(後期調整型) 等)、
// 新改造形态(吹雪改三/日向改二/龍鳳改二/千歳航系)整体缺席、多处曜日仍是游戏
// 重排前的旧表、「二番舰不要」的日程行完全丢失。wikiwiki 改修表随每次维护活跃更新,
// 按「同域单基准」整体替换,产出与 EO 相同的数据形状,消费端不感知换源。
//
// 表结构的三个实测事实(解析器建立在这三条上,变了要重新核对):
//   1. 行 = 改修値段位(初期/★6/★max)×排版行;曜日与二番舰按**行**水平对齐可信,
//      「段位↔二番舰」的对应只是单元格 rowspan 的视觉打包,不携带语义。
//   2. 表头「開発資材」等在窄列里带换行,匹配一律先去空白;消費装備与アイテム
//      同在一格,按行拆 token。
//   3. 旧消耗值裹在 <del> 里(游戏调整后编者保留旧值),解码前必须整段剥掉,
//      否则「2/3」+「1/2」会粘成「2/31/2」。
//
// 二番舰的展开口径:表里写基础形态名(如「睦月」)代表该舰**所有以此为前缀的形态**
// (睦月/睦月改/睦月改二),写具体形态名(如「吹雪改二」)就只指那一个形态——
// 佐证是 EO 停更前的展开与该口径逐舰吻合,且 wiki 对天数不同的新形态(吹雪改三)
// 会另起一行单独列。前缀之外再限制在同一改造家族里,防止「熊野」误吞「熊野丸」。
// 「二番舰不要(―)」写成 ship_ids:[-1]:消费端过滤 >0 后自然落进
// 「无需指定二号舰」分支,今日改修的 helperReady 判定也随之成立。

const DAY_HEADS = ['日', '月', '火', '水', '木', '金', '土']

const decodeCell = (t) =>
  t
    .replace(/<(?:del|s|strike)[^>]*>[\s\S]*?<\/(?:del|s|strike)>/g, '')
    .replace(/<\/a>\s*<a/g, '</a>\n<a')
    .replace(/<br[^>]*>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t　]+/g, ' ')
    .trim()

// rowspan/colspan 全展开——不展开的话「改修値」段位格只出现在首行,
// 后续行的列号全体左移,曜日会被读成二番舰。
const parseTable = (tableHtml) => {
  const rows = []
  const pending = []
  for (const tr of tableHtml.split(/<tr[ >]/).slice(1)) {
    const cells = [...tr.matchAll(/<(t[hd])([^>]*)>([\s\S]*?)<\/t[hd]>/g)]
    const row = []
    let col = 0
    const fill = () => {
      while (pending[col] && pending[col].left > 0) {
        row[col] = pending[col].text
        pending[col].left--
        col++
      }
    }
    for (const cell of cells) {
      fill()
      const text = decodeCell(cell[3])
      const rowspan = Number((cell[2].match(/rowspan="?(\d+)/) ?? [])[1] ?? 1)
      const colspan = Number((cell[2].match(/colspan="?(\d+)/) ?? [])[1] ?? 1)
      for (let k = 0; k < colspan; k++) {
        row[col] = text
        if (rowspan > 1) pending[col] = { left: rowspan - 1, text }
        col++
      }
    }
    fill()
    rows.push(row)
  }
  return rows
}

// 名字归一:全半角/波浪线/ASCII 大小写的差异只在排版,不构成不同装备/舰
// (wiki 出现过「Saratoga MK.II」对主数据「Saratoga Mk.II」;主数据内部无
// 仅大小写不同的名字,加载时有断言兜着)
const norm = (s) =>
  `${s}`
    .replace(/\s+/g, '')
    .replace(/＋/g, '+')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/／/g, '/')
    .replace(/＆/g, '&')
    .replace(/〜/g, '~')
    .replace(/～/g, '~')
    .toLowerCase()

// 尾部的 ?/？ 是 wiki 的「未検証」标记,*†‡ 是脚注锚——都不是名字的一部分
const stripNotes = (line) => line.replace(/※.*$/, '').replace(/[*†‡?？]+$/g, '').trim()

// 「FletcherMkII」这类 wiki 手滑拼写(实名 Fletcher Mk.II)的退路:去掉点再比。
// 只在严格匹配失败时启用;去点后撞名的键直接作废,宁缺不错。
const dotless = (s) => s.replace(/\./g, '')
const buildLooseMap = (entries) => {
  const map = new Map()
  for (const [key, value] of entries) {
    const loose = dotless(key)
    if (loose === key) continue
    map.set(loose, map.has(loose) && map.get(loose) !== value ? null : value)
  }
  return map
}

export class KaishuParseError extends Error {}

// minRows:整包残缺熔断线。真抓取用默认值;fixture 测试传小值。
export const parseKaishuHtml = (html, { items, ships, useitems }, { minRows = 500 } = {}) => {
  const itemByNorm = new Map(items.map((i) => [norm(i.api_name), Number(i.api_id)]))
  if (itemByNorm.size !== new Set(items.map((i) => `${i.api_name}`)).size) {
    throw new KaishuParseError('装备主数据里出现仅大小写/全半角不同的名字,norm 归一化会撞名——先解决冲突再抓')
  }
  const useitemByNorm = new Map(useitems.map((i) => [norm(i.api_name), Number(i.api_id)]))
  const shipIdsByNorm = new Map()
  for (const ship of ships) {
    const key = norm(ship.api_name)
    if (!shipIdsByNorm.has(key)) shipIdsByNorm.set(key, [])
    shipIdsByNorm.get(key).push(Number(ship.api_id))
  }
  const shipLoose = buildLooseMap([...shipIdsByNorm.keys()].map((key) => [key, key]))
  const canonShipKey = (key) => (shipIdsByNorm.has(key) ? key : (shipLoose.get(dotless(key)) ?? null))

  // 改造家族 = aftershipid 连通分量 ∪ 同名形态(宗谷三形态同名不同链)
  const familyOf = new Map()
  const find = (x) => {
    let r = x
    while (familyOf.get(r) !== r) r = familyOf.get(r)
    let cur = x
    while (familyOf.get(cur) !== r) {
      const next = familyOf.get(cur)
      familyOf.set(cur, r)
      cur = next
    }
    return r
  }
  const union = (a, b) => {
    if (!familyOf.has(a)) familyOf.set(a, a)
    if (!familyOf.has(b)) familyOf.set(b, b)
    familyOf.set(find(a), find(b))
  }
  for (const ship of ships) {
    const id = Number(ship.api_id)
    if (!familyOf.has(id)) familyOf.set(id, id)
    const after = Number.parseInt(`${ship.api_aftershipid ?? ''}`, 10)
    if (Number.isInteger(after) && after > 0) union(id, after)
  }
  for (const sameName of shipIdsByNorm.values()) {
    for (let i = 1; i < sameName.length; i++) union(sameName[0], sameName[i])
  }

  // 「睦月」→ 睦月/睦月改/睦月改二;「吹雪改二」→ 仅吹雪改二(改三另起行)
  const expandHelper = (rawNorm) => {
    const nameNorm = canonShipKey(rawNorm)
    if (!nameNorm) return null
    const baseIds = shipIdsByNorm.get(nameNorm)
    if (!baseIds?.length) return null
    const families = new Set(baseIds.map((id) => find(id)))
    const out = new Set(baseIds)
    for (const ship of ships) {
      const id = Number(ship.api_id)
      if (norm(ship.api_name).startsWith(nameNorm) && families.has(find(id))) out.add(id)
    }
    return [...out].sort((a, b) => a - b)
  }

  // ---- 逐节收行 ----
  const sections = html.split(/<h3[^>]*>/).slice(1)
  const rawRows = []
  const categories = []
  for (const section of sections) {
    const category = decodeCell(section.slice(0, section.indexOf('</h3>')))
    if (/コメント|検索|ガイド|掲示板|リンク|最新の/.test(category)) continue
    const tables = section
      .split(/<table/)
      .slice(1)
      .map((t) => t.slice(0, t.indexOf('</table>')))
    let sectionRows = 0
    for (const tableHtml of tables) {
      const rows = parseTable(tableHtml)
      if (!rows.length || !rows[0].some((c) => c && c.includes('改修する装備'))) continue
      // 表头两行合并定位列;窄列表头(開発\n資材)先去空白再比对
      const headerRows = rows.filter((r) =>
        r.some((c) => c && (c.includes('改修する装備') || norm(c) === '曜日' || norm(c) === '日')),
      )
      const cols = { stage: -1, res: -1, dev: -1, screw: -1, consume: -1, days: [], helper: -1, convert: -1 }
      for (const headerRow of headerRows) {
        headerRow.forEach((cell, index) => {
          const key = norm(cell ?? '')
          if (key === '改修値') cols.stage = index
          else if (key === '資源') cols.res = index
          else if (key === '開発資材') cols.dev = index
          else if (key === '改修資材') cols.screw = index
          else if (key.includes('消費装備') && cols.consume < 0) cols.consume = index
          else if (DAY_HEADS.includes(key) && cols.days.length < 7 && !cols.days.includes(index)) cols.days.push(index)
          else if (key === '二番艦') cols.helper = index
          else if (key.includes('更新先')) cols.convert = index
        })
      }
      if (cols.days.length !== 7 || cols.helper < 0 || cols.stage < 0) {
        throw new KaishuParseError(`「${category}」的表头定位失败(day=${cols.days.length} helper=${cols.helper} stage=${cols.stage})——改修表版式变了,解析器要跟着改`)
      }
      const headerSet = new Set(headerRows)
      for (const row of rows) {
        if (headerSet.has(row)) continue
        const equip = (row[0] ?? '').split('\n')[0].trim()
        if (!equip || equip.includes('改修する装備')) continue
        const dayCells = cols.days.map((i) => row[i] ?? '')
        if (!dayCells.some((c) => /[◯○●×△▲―─\-]/.test(c))) continue
        sectionRows++
        rawRows.push({
          category,
          equip,
          stage: (row[cols.stage] ?? '').trim(),
          res: (row[cols.res] ?? '').trim(),
          devmats: (row[cols.dev] ?? '').trim(),
          screws: (row[cols.screw] ?? '').trim(),
          consume: (row[cols.consume] ?? '').trim(),
          days: dayCells.map((c) => /[◯○●△▲]/.test(c)),
          helper: (row[cols.helper] ?? '').trim(),
          convert: cols.convert >= 0 ? (row[cols.convert] ?? '').trim() : '',
        })
      }
    }
    if (sectionRows) categories.push({ category, rows: sectionRows })
  }
  if (rawRows.length < minRows) {
    throw new KaishuParseError(`改修表只解析出 ${rawRows.length} 行——页面结构大概率变了,不能拿残缺结果顶替整包`)
  }

  // ---- 装备名对齐(解析不出就抛错,不静默丢) ----
  const byEquip = new Map()
  for (const raw of rawRows) {
    const id = itemByNorm.get(norm(raw.equip))
    if (!id) throw new KaishuParseError(`改修表装备名对不上主数据:「${raw.equip}」(${raw.category})`)
    if (!byEquip.has(id)) byEquip.set(id, [])
    byEquip.get(id).push(raw)
  }

  const parsePair = (text) => {
    const m = text.match(/^(\d+)(?:\s*\/\s*(\d+))?$/)
    if (!m) return null
    return [Number(m[1]), Number(m[2] ?? m[1])]
  }

  const parseConsume = (cell, selfId, context) => {
    const equips = []
    const consumable = []
    // 窄列会把长名折行(「Fletcher改 Mod.2」实测被折成两行),
    // 所以单行解析失败时先并入下一行重试,还不行才报错。
    const lines = cell.split('\n').map((line) => stripNotes(line.trim()))
    for (let index = 0; index < lines.length; index++) {
      let line = lines[index]
      if (!line || /^[―─\-×]$/.test(line) || /^なし$/.test(line)) continue
      if (/^[（(].*[)）]$/.test(line)) continue
      let m = line.match(/^(.+?)[x×](\d+)$/)
      let merged = 0
      while ((!m || !resolveConsumeName(norm(m[1]), selfId)) && merged < 2 && index + 1 < lines.length) {
        line = `${line}${lines[index + 1]}`
        lines[index + 1] = ''
        merged++
        m = line.match(/^(.+?)[x×](\d+)$/)
      }
      if (!m) throw new KaishuParseError(`消費装備 token 解析失败:「${line}」(${context})`)
      const hit = resolveConsumeName(norm(m[1]), selfId)
      if (!hit) throw new KaishuParseError(`消費装備/アイテム名对不上主数据:「${m[1]}」(${context})`)
      if (hit.domain === 'equip') equips.push({ id: hit.id, eq_count: Number(m[2]) })
      else consumable.push({ id: hit.id, eq_count: Number(m[2]) })
    }
    return { equips, consumable }
  }

  const resolveConsumeName = (nameNorm, selfId) => {
    if (nameNorm === '同装備') return { domain: 'equip', id: selfId }
    const itemId = itemByNorm.get(nameNorm)
    if (itemId) return { domain: 'equip', id: itemId }
    const useId = useitemByNorm.get(nameNorm)
    if (useId) return { domain: 'item', id: useId }
    return null
  }

  // 「宗谷(特務艦)」这类括注消歧:剥括号重试,同名家族展开会把正确形态收进来
  const expandHelperLoose = (line) => {
    const direct = expandHelper(norm(line))
    if (direct) return direct
    const stripped = norm(line.replace(/[（(][^（()）]*[)）]$/, ''))
    if (stripped && stripped !== norm(line)) return expandHelper(stripped)
    return null
  }

  const parseHelpers = (cell, context) => {
    const ids = new Set()
    let none = false
    // resolved 保留「上一个成功匹配的原文」——折行的名字(Fletcher/改 Mod.2)
    // 单行必然失败,失败时与上一行原文拼接重试;拼接命中就用合并名**替换**
    // 上一行的解析结果,而不是各算一舰。
    const resolved = []
    for (let line of cell.split(/[\n、・]/)) {
      line = stripNotes(line.trim())
      if (!line) continue
      if (/^[―─\-×◯○]$/.test(line) || /不要|なし/.test(line)) {
        none = true
        continue
      }
      if (/^[（(].*[)）]$/.test(line)) continue
      if (/改修値|変化|分岐|参照|下記|上記|以降|まで|メンテ/.test(line)) continue
      const direct = expandHelperLoose(line)
      if (direct) {
        resolved.push({ text: line, ids: direct })
        continue
      }
      const prev = resolved[resolved.length - 1]
      const mergedIds = prev ? expandHelperLoose(`${prev.text}${line}`) : null
      if (mergedIds) {
        resolved[resolved.length - 1] = { text: `${prev.text}${line}`, ids: mergedIds }
        continue
      }
      throw new KaishuParseError(`二番舰名对不上主数据:「${line}」(${context})`)
    }
    for (const entry of resolved) for (const id of entry.ids) ids.add(id)
    return { ids: [...ids], none }
  }

  const parseConvert = (cell) => {
    for (const segment of cell.split('⇒').slice(1)) {
      const lines = segment.split('\n')
      // 更新先的名字也可能被窄列折行:逐步并入后续行,直到命中或撞上注记行
      for (let take = 1; take <= Math.min(lines.length, 3); take++) {
        const joined = lines.slice(0, take).join('')
        if (take > 1 && /※/.test(lines[take - 1])) break
        const star = joined.match(/★\+?(\d+)/)
        const name = stripNotes(joined.replace(/★\S*/g, '').trim())
        if (!name || /更新不可/.test(name)) break
        const id = itemByNorm.get(norm(name))
        if (id) return { id_after: id, lvl_after: star ? Number(star[1]) : 0 }
        if (take === Math.min(lines.length, 3)) {
          throw new KaishuParseError(`更新先装备名对不上主数据:「${name}」`)
        }
      }
    }
    return null
  }

  // ---- 组装 EO 同构行 ----
  const outRows = []
  const warnings = []
  for (const [eqId, rowsOfEquip] of [...byEquip.entries()].sort((a, b) => a[0] - b[0])) {
    // 变体 = 更新先分组;强化-only 行(更新不可/空)合并进 null 组
    const variants = new Map()
    for (const raw of rowsOfEquip) {
      const context = `${raw.equip} ${raw.stage}`
      const convert = parseConvert(raw.convert)
      const key = convert ? `${convert.id_after}:${convert.lvl_after}` : 'null'
      if (!variants.has(key)) variants.set(key, { convert, helperMasks: new Map(), stages: new Map() })
      const variant = variants.get(key)
      const mask = raw.days.reduce((m, on, i) => (on ? m | (1 << i) : m), 0)
      if (mask) {
        const { ids, none } = parseHelpers(raw.helper, context)
        for (const id of ids) variant.helperMasks.set(id, (variant.helperMasks.get(id) ?? 0) | mask)
        if (none) variant.helperMasks.set(-1, (variant.helperMasks.get(-1) ?? 0) | mask)
      }
      // 段位→消耗:初期=p1 ★6(个别表细分到★7/★8,归并进 p2,首行=★6 优先)=p2
      // ★max=conv(仅当有更新先)。两段模型与 EO 同构,消费端的推满预算按它算。
      const stageKey = /初期/.test(raw.stage) ? 'p1' : /max|更新/i.test(raw.stage) ? 'conv' : /[6-9]/.test(raw.stage) ? 'p2' : null
      if (stageKey && !variant.stages.has(stageKey)) {
        const dev = parsePair(raw.devmats)
        const screw = parsePair(raw.screws)
        if (dev && screw) {
          const consume = parseConsume(raw.consume, eqId, context)
          variant.stages.set(stageKey, {
            devmats: dev[0],
            devmats_sli: dev[1],
            screws: screw[0],
            screws_sli: screw[1],
            equips: consume.equips,
            consumable: consume.consumable,
          })
        } else if (![raw.devmats, raw.screws].every((cell) => /^[-―─/\s]*$/.test(cell))) {
          // 「-/-」是更新不可行的正常占位,不算解析失败
          warnings.push(`资材列未解析:「${raw.equip}」${raw.stage} dev=「${raw.devmats}」screw=「${raw.screws}」`)
        }
      }
      const resMatch = raw.res.match(/燃:?(\d+)[\s\S]*?弾:?(\d+)[\s\S]*?鋼:?(\d+)[\s\S]*?ボ:?(\d+)/)
      if (resMatch && !variant.res) {
        variant.res = {
          fuel: Number(resMatch[1]),
          ammo: Number(resMatch[2]),
          steel: Number(resMatch[3]),
          baux: Number(resMatch[4]),
        }
      }
    }

    const improvement = []
    for (const variant of variants.values()) {
      // 同曜日集合的舰并成一条,与 EO 的 helpers 形状一致
      const byMask = new Map()
      for (const [shipId, mask] of variant.helperMasks) {
        if (!byMask.has(mask)) byMask.set(mask, [])
        byMask.get(mask).push(shipId)
      }
      const helpers = [...byMask.entries()].map(([mask, shipIds]) => ({
        ship_ids: shipIds.sort((a, b) => a - b),
        days: DAY_HEADS.map((_, i) => i).filter((i) => mask & (1 << i)),
      }))
      const costs = { ...(variant.res ?? {}) }
      if (variant.stages.has('p1')) costs.p1 = variant.stages.get('p1')
      if (variant.stages.has('p2')) costs.p2 = variant.stages.get('p2')
      if (variant.convert && variant.stages.has('conv')) costs.conv = variant.stages.get('conv')
      improvement.push({ convert: variant.convert, helpers, costs })
    }
    // 有更新先的变体排前面,与 EO 的习惯一致(抽屉「方案 1」多半是主路线)
    improvement.sort((a, b) => Number(Boolean(b.convert)) - Number(Boolean(a.convert)))
    outRows.push({
      eq_id: eqId,
      improvement,
      convert_to: improvement.filter((imp) => imp.convert).map((imp) => ({ ...imp.convert })),
      upgrade_for: [],
    })
  }

  // 反查:谁的改修消耗这件装备(校验器要求该字段,形状随 EO)
  const usedBy = new Map()
  for (const row of outRows) {
    for (const imp of row.improvement) {
      for (const stage of [imp.costs?.p1, imp.costs?.p2, imp.costs?.conv]) {
        for (const need of stage?.equips ?? []) {
          if (need.id === row.eq_id) continue
          if (!usedBy.has(need.id)) usedBy.set(need.id, new Set())
          usedBy.get(need.id).add(row.eq_id)
        }
      }
    }
  }
  for (const row of outRows) {
    row.upgrade_for = [...(usedBy.get(row.eq_id) ?? [])].sort((a, b) => a - b)
  }

  // 页脚 Last-modified(JST)是上游「多新」的一手凭据
  const modified = html.match(/Last-modified:\s*(\d{4}-\d{2}-\d{2})\s*\([^)]*\)\s*(\d{2}:\d{2}:\d{2})/)
  const upstreamUpdatedAt = modified ? `${modified[1]}T${modified[2]}+09:00` : null

  return {
    rows: outRows,
    upstreamUpdatedAt,
    stats: {
      equips: outRows.length,
      dataRows: rawRows.length,
      categories,
      warnings,
      noneHelperEquips: outRows.filter((row) =>
        row.improvement.some((imp) => imp.helpers.some((h) => h.ship_ids.includes(-1))),
      ).length,
    },
  }
}
