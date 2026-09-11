// 任务库（简中）：直接解析 zh.kcwiki 的「任务」与「任务/最新任务」两张页的 wikitext。
//
// 为什么自己解析而不是继续用 kcwikizh/kcQuests 的 quests-scn.json：
// 那个仓没有 LICENSE、连 README 都没有，而它的 src/kcwiki/constants.py 明写着
// 内容就是从这两个 zh.kcwiki 页面 action=raw 抓来的——也就是说数据本体一直受
// 站点的 CC BY-NC-SA 3.0 覆盖，卡住随包分发的只是中间那一层。去掉中间层，
// 同一份内容就能随发行版走。顺带甩掉它对 kcdata（同样无许可）的装备名依赖：
// 装备奖励的名字改从 zh.kcwiki「模块:舰娘装备数据改」取。
//
// 解析口径**逐条对齐 kcQuests 的既有实现**（src/kcwiki/quest.py + constants.py），
// 好让换源是纯粹的取数口替换、产物逐字节可对账，而不是顺手重新定义格式：
// 版式怪癖（如 [[6-1|中部海域哨戒战(6-1)]] 会留下 "「6-1|中部海域哨戒战(6-1)」"
// 这样带竖线的文本）也照原样保留——它们已经写进了消费端的既有行为。
// 编号合并在此基础上增加维护者定号保护与跨页改码日志；文本字段仍沿用上述口径。

// kcwiki 未定号或编号注释写错时由这里定号；code 去掉内部空白后匹配。
// asCode 可保留主页使用的任务码，内容仍取命中行，并阻止后续注释行恢复旧内容。
// 条目只记录公开来源与核对日期，不记录任何账号叙述。
export const MAINTAINER_QUEST_NO_CORRECTIONS = [
  { code: '2609Cw1', id: 384, basis: '游戏任务列表编号（2026-09-11 核）' },
  { code: '2609Cw2', id: 385, basis: '游戏任务列表编号（2026-09-11 核）' },
  { code: 'By17', id: 1050, basis: '游戏任务列表编号（2026-09-11 核）' },
  { code: 'By18', id: 1051, basis: '游戏任务列表编号（2026-09-11 核）' },
  { code: 'Cs8', id: 313, asCode: 'Cs1', basis: '游戏任务列表编号（2026-09-11 核）；「任务」页 313 编号为 Cs1、F40 前置亦引用 Cs1，「最新任务」页写作 Cs8 与之不一致，码按「任务」页保留，内容取「最新任务」页新行' },
]

/** action=raw 取这两张页；顺序即合并顺序，后者覆盖前者的同号条目。 */
// 普通注释行仍后者胜；仅已由维护者定号的条目拒绝后续同号异码注释行。
export const QUEST_PAGE_TITLES = ['任务', '任务/最新任务']

// kcQuests 的 BEFORE_PARSE_FILTERS：整页先把 HTML 标签换成一个空格。
// 注意它匹配不到 <!--…-->（`<` 后面必须是 `\w`），任务 api_id 就藏在那种注释里。
const HTML_TAG = /<\s*\/?\s*\w+\s*[^>]*>/g

// kcQuests 的 WT_FILTERS，顺序有意义（「「 的合并要排在 [[ → 「 之后）。
const WT_FILTERS = [
  [/'''/g, ''],
  [/\{\{/g, ''],
  [/\}\}/g, ''],
  [/\[\[/g, '「'],
  [/\]\]/g, '」'],
  [/[Gg]reen\|/g, ''],
  [/[Rr]ed\|/g, ''],
  [/color\|/g, ''],
  [/[x*](?=\d)/g, '×'],
  [/「「/g, '「'],
  [/」」/g, '」'],
]

const applyWtFilters = (text) => {
  let out = `${text}`
  for (const [pattern, replacement] of WT_FILTERS) out = out.replace(pattern, replacement)
  return out
}

/** 顶层 {{name|…}} 调用的原文（含首尾花括号），嵌套安全。 */
const templateSpans = (text, name) => {
  const out = []
  const re = new RegExp(`\\{\\{\\s*${name}\\s*\\|`, 'g')
  let m
  while ((m = re.exec(text))) {
    let depth = 0
    let i = m.index
    for (; i < text.length - 1; i++) {
      if (text[i] === '{' && text[i + 1] === '{') {
        depth++
        i++
      } else if (text[i] === '}' && text[i + 1] === '}') {
        depth--
        i++
        if (depth === 0) break
      }
    }
    if (depth !== 0) continue // 未闭合：宁可丢这一条，也不把后半页吃进来
    out.push(text.slice(m.index, i + 1))
    re.lastIndex = i + 1
  }
  return out
}

/**
 * 顶层 `|` 切分成参数。返回 `{ name, value }`：`name` 为空串表示位置参数。
 * `=` 只认顶层的第一个——`奖励 ={{装备奖励|编号=241}}` 里面那个不算。
 */
const splitArguments = (span) => {
  const inner = span.slice(2, -2)
  const parts = []
  let depth = 0
  let cur = ''
  for (let i = 0; i < inner.length; i++) {
    const two = inner.slice(i, i + 2)
    if (two === '{{' || two === '[[') {
      depth++
      cur += two
      i++
    } else if (two === '}}' || two === ']]') {
      depth--
      cur += two
      i++
    } else if (inner[i] === '|' && depth === 0) {
      parts.push(cur)
      cur = ''
    } else {
      cur += inner[i]
    }
  }
  parts.push(cur)
  return parts.slice(1).map((part) => {
    let level = 0
    for (let i = 0; i < part.length; i++) {
      const two = part.slice(i, i + 2)
      if (two === '{{' || two === '[[') {
        level++
        i++
      } else if (two === '}}' || two === ']]') {
        level--
        i++
      } else if (part[i] === '=' && level === 0) {
        return { name: part.slice(0, i).trim(), value: part.slice(i + 1).trim() }
      }
    }
    return { name: '', value: part.trim() }
  })
}

/** 把 `{{装备奖励|编号=241|…}}` 换成装备中文名（名字来自 kcwiki 装备模块）。 */
const substituteEquipRewards = (value, equipNames) => {
  let out = value
  for (const span of templateSpans(out, '装备奖励')) {
    const idArg = splitArguments(span).find((arg) => arg.name.startsWith('编号'))
    if (!idArg) continue
    const id = Number.parseInt(idArg.value.trim(), 10)
    const name = equipNames.get(id)
    if (!name) throw new Error(`装备奖励里的编号 ${idArg.value.trim()} 在装备名表里查不到`)
    out = out.split(span).join(name)
  }
  return out
}

/** `[[文件:X.jpg|link=白雪]]` → `「白雪」`（图片形式的舰娘奖励就是这么写的）。 */
const substituteLinkTargets = (value) => {
  let out = value
  const links = out.match(/\[\[[^[\]]*\]\]/g) ?? []
  for (const link of links) {
    const body = link.slice(2, -2)
    const bar = body.indexOf('|')
    if (bar < 0) continue
    for (const segment of body.slice(bar + 1).split('|')) {
      if (!segment.includes('link=')) continue
      out = out.split(link).join(`「${segment.replaceAll('link=', '')}」`)
      break
    }
  }
  return out
}

/**
 * 解析若干张任务页。
 *
 * @param {string[]} pages 每张页的 wikitext（顺序＝合并顺序，后者覆盖前者）
 *   维护者定号行总是写入，之后拒绝同号异码注释行；普通跨页改码仅记信息。
 * @param {Map<number,string>} equipNames 装备 mstId → 中文名
 * @returns {{ quests: Record<string, object>, stats: object }}
 */
export const parseKcwikiQuestPages = (pages, equipNames) => {
  const quests = {}
  let templates = 0
  let withoutId = 0
  let duplicates = 0
  const maintainerHits = []
  const conflictRows = []
  const crossPageCodeChanges = []
  const withoutIdRows = []
  const maintainerIds = new Set()
  const finalizedIds = new Set()
  const lastWrittenPage = new Map()
  for (const [pageIndex, page] of pages.entries()) {
    const text = `${page}`.replace(HTML_TAG, ' ')
    for (const span of templateSpans(text, '任务表')) {
      templates++
      // api_id 藏在模板内的第一个 HTML 注释里（`| 编号 =A1|<!--101-->|`）。
      // kcQuests 也是取「第一个注释」，注释为空的整条跳过——那是还没定号的任务。
      // 现在先读 code 与中文名：维护者定号优先于注释，未定号也保留可核对的行明细。
      const args = splitArguments(span)
      const quest = { code: '', desc: '', memo: '', memo2: '', name: '', pre: [] }
      for (const { name, value } of args) {
        if (name === '编号') quest.code = value.replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, '')
        if (name === '中文任务名字') quest.name = applyWtFilters(value)
      }
      const correction = MAINTAINER_QUEST_NO_CORRECTIONS.find(({ code }) => code === quest.code)
      const comment = span.match(/<!--([\s\S]*?)-->/)
      const id = correction ? String(correction.id) : comment?.[1]?.trim() ?? ''
      if (!/^\d+$/.test(id)) {
        withoutId++
        withoutIdRows.push({ code: quest.code, name: quest.name })
        continue
      }
      if (correction) maintainerHits.push({ code: quest.code, id: correction.id })
      quest.code = correction?.asCode ?? quest.code
      if (!correction && maintainerIds.has(id) && quests[id].code !== quest.code) {
        conflictRows.push({ id: Number(id), kept: quests[id].code, skipped: quest.code, name: quest.name })
        continue
      }
      // asCode 已选定新行内容：后来的同码注释行只计重复，不把新奖励换回旧奖励。
      if (!correction && finalizedIds.has(id)) {
        duplicates++
        continue
      }
      for (const { name, value } of args) {
        // kcQuests 的判据是 `value.encode().isalnum()`——纯 ASCII 字母数字才算前置码，
        // 空值与中文备注（「待确认」之类）自然落选。
        if (name.includes('前置') && /^[0-9A-Za-z]+$/.test(value)) quest.pre.push(value)
        if (name === '中文任务说明') quest.desc = applyWtFilters(value)
        if (name === '奖励') {
          quest.memo = applyWtFilters(substituteLinkTargets(substituteEquipRewards(value, equipNames)))
        }
        if (name === '备注') quest.memo2 = applyWtFilters(value)
      }
      if (quests[id]) {
        duplicates++
        if (lastWrittenPage.get(id) !== pageIndex && quests[id].code !== quest.code) {
          crossPageCodeChanges.push({ id: Number(id), from: quests[id].code, to: quest.code })
        }
      }
      // 同一条任务会在多个分类节里重复出现，kcQuests 的 dict.update 是后者胜，照抄。
      // 同页旧序号与周期码共存也沿用此口径；跨页改码只记信息，不改变写入结果。
      // 维护者定号行总是写入，并保护该 id 不被之后的异码注释行覆盖。
      quests[id] = { ...quest, memo: `奖励:${quest.memo}` }
      lastWrittenPage.set(id, pageIndex)
      if (correction) maintainerIds.add(id)
      if (correction?.asCode !== undefined) finalizedIds.add(id)
    }
  }
  return { quests, stats: {
    templates, withoutId, withoutIdRows, duplicates, maintainerHits,
    conflicts: conflictRows.length, conflictRows, crossPageCodeChanges, quests: Object.keys(quests).length,
  } }
}
