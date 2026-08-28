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

/** action=raw 取这两张页；顺序即合并顺序，后者覆盖前者的同号条目。 */
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
 * @param {Map<number,string>} equipNames 装备 mstId → 中文名
 * @returns {{ quests: Record<string, object>, stats: object }}
 */
export const parseKcwikiQuestPages = (pages, equipNames) => {
  const quests = {}
  let templates = 0
  let withoutId = 0
  let duplicates = 0
  for (const page of pages) {
    const text = `${page}`.replace(HTML_TAG, ' ')
    for (const span of templateSpans(text, '任务表')) {
      templates++
      // api_id 藏在模板内的第一个 HTML 注释里（`| 编号 =A1|<!--101-->|`）。
      // kcQuests 也是取「第一个注释」，注释为空的整条跳过——那是还没定号的任务。
      const comment = span.match(/<!--([\s\S]*?)-->/)
      const id = comment?.[1]?.trim() ?? ''
      if (!/^\d+$/.test(id)) {
        withoutId++
        continue
      }
      const quest = { code: '', desc: '', memo: '', memo2: '', name: '', pre: [] }
      for (const { name, value } of splitArguments(span)) {
        if (name === '编号') quest.code = value.replace(/<!--[\s\S]*?-->/g, '').trim()
        // kcQuests 的判据是 `value.encode().isalnum()`——纯 ASCII 字母数字才算前置码，
        // 空值与中文备注（「待确认」之类）自然落选。
        if (name.includes('前置') && /^[0-9A-Za-z]+$/.test(value)) quest.pre.push(value)
        if (name === '中文任务名字') quest.name = applyWtFilters(value)
        if (name === '中文任务说明') quest.desc = applyWtFilters(value)
        if (name === '奖励') {
          quest.memo = applyWtFilters(substituteLinkTargets(substituteEquipRewards(value, equipNames)))
        }
        if (name === '备注') quest.memo2 = applyWtFilters(value)
      }
      if (quests[id]) duplicates++
      // 同一条任务会在多个分类节里重复出现，kcQuests 的 dict.update 是后者胜，照抄。
      quests[id] = { ...quest, memo: `奖励:${quest.memo}` }
    }
  }
  return { quests, stats: { templates, withoutId, duplicates, quests: Object.keys(quests).length } }
}
