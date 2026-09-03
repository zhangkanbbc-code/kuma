/**
 * 玩家可见文案的语料收集器（供 `player-copy-ratchet.test.mjs` 用，不是测试文件本身）。
 *
 * 出处：2026-09-01《文案审计·三把尺子复扫》「扫描方法」一节的取语料配方，
 * 原样搬成可复用函数——审计那一轮是人肉一次性脚本，跑完就没了；
 * 棘轮闸门要每次 `npm test` 都重跑，所以收进仓里。
 *
 * 配方四条：
 * 1. **TS 编译器 AST 穷举，不按行 grep**。只收 `StringLiteral` /
 *    `NoSubstitutionTemplateLiteral` / `TemplateHead|Middle|Tail`，
 *    注释因此天然被排除——按行 grep 会把维护者注释当成玩家文案，
 *    实测 `打不到`「夜战转昼」这些**已经退役的词**在注释里还留着十几处，
 *    grep 一扫全是假阳性，闸门第一天就会被绕过去。
 * 2. **行号直接数 `\n`，不用 `getLineAndCharacterOfPosition`**：
 *    审计当天实测后者在 `quest-fleet-rules.ts` 上偏了 14 行。
 *    这里数的是喂给 `createSourceFile` 的同一份字符串，按构造必然一致。
 * 3. **开发者面剔除**：`console.*` / `safeConsole` / `perfLog` 调用表达式整棵子树跳过。
 * 4. **调试门后剔除**：函数体首句是 `if (!DEBUG_UI) return …` 的整个函数跳过
 *    （审计豁免了 `ji.ts` 的按推测档名试听那一块，就是这个形状）。
 *
 * 另外两条是跑现仓时才发现、审计报告没写的：
 * - **正则源串**要剔。`quest-*-rules.ts` 里大量 `new RegExp` 的源串含中日文字符，
 *   其中就有 `“”`（用来匹配上游原文的弯引号），会把 B13 那条弯引号闸门打成假阳性。
 * - **SQL 行注释**要剔。`mg/ledger.ts` 的建表语句是一整条模板字面量，
 *   里面的 `-- 中文注释` 是代码注释而不是文案（实测撞上「再也…了」那一条）。
 *
 * 两层语料：
 * - `tierA`「玩家面」= 渲染层 `.ts` + 渲染层 `.html` + 随包矿脉的 `meta.note`。
 *   句式类闸门只打这一层——主/共享层混着维护者台账散文，句式正则在那儿必然误报，
 *   而误报会让人绕过闸门（比漏网更贵）。
 * - `tierB`「送达面」= `src/main/**` + `src/shared/**`（剔台账字段/正则源/开发者面之后）。
 *   只打「已定稿替换词的旧形」那种一词一判的词形闸门。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const CJK = /[\u4e00-\u9fff]/ // CJK 基本区

const rel = (file) => path.relative(ROOT, file).split(path.sep).join('/')

const walk = (dir, exts) => {
  const out = []
  const pending = [dir]
  while (pending.length) {
    const cur = pending.pop()
    let entries
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true })
    } catch {
      continue // 矿脉目录在新克隆上可能整个不存在，这不是错误
    }
    for (const entry of entries) {
      const child = path.join(cur, entry.name)
      if (entry.isDirectory()) pending.push(child)
      else if (exts.some((ext) => entry.name.endsWith(ext))) out.push(child)
    }
  }
  return out.sort()
}

/** 开发者面：这些调用里的串玩家永远看不到。 */
const DEV_CALL = /^(?:console\.|safeConsole\b|perfLog|process\.std(?:out|err)\.)/

/**
 * 维护者台账字段。审计的排除清单原话：「`src/shared` 与 `src/main/mg` 的维护者台账字段
 *（`bgm-heard.note`、`quest-*-rules` 的裁决注、`fit-bonus-corrections` 等）不上屏」。
 *
 * 名单**故意不收 `note`**：`shared/hist-fleets.ts` 的 `note` 是玩家可见的编队史简介
 *（「白露型四姊妹編成的驱逐队，隶属第四水雷战队。」），收了会一次挖掉 386 条真语料。
 * 台账里那些 `note` 现仓一条闸门都不撞，撞上了再逐条走豁免表。
 */
const LEDGER_KEYS = new Set([
  'why',
  'memo',
  'memo2',
  'evidence',
  'basis',
  'rationale',
  'deferred',
  'provisional',
  'sourceNote',
  'sourceNotes',
  'sourceJp',
  'verdict',
])

/** 正则源串的指纹（在**已解转义**的文本上判，普通文案不会长这样）。 */
const REGEX_SOURCE = /\(\?[:!=<]|\\[sdwSDWbB]|\[\^|\|\[/

const stripSqlComments = (text) => text.replace(/^[ \t]*--[^\n]*$/gm, '')

const collectFromTs = (file, layer) => {
  const text = fs.readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const found = []

  // 直接数换行：喂给 createSourceFile 的就是这一份 text，按构造不可能偏。
  const lineOf = (pos) => {
    let line = 1
    for (let i = 0; i < pos && i < text.length; i++) if (text.charCodeAt(i) === 10) line++
    return line
  }

  const inLedgerField = (node) => {
    if (layer === 'renderer') return false // 渲染层没有台账
    let cur = node.parent
    for (let depth = 0; cur && depth < 10; depth++, cur = cur.parent) {
      if (ts.isPropertyAssignment(cur) && LEDGER_KEYS.has(cur.name.getText(sf))) return true
    }
    return false
  }

  const isDebugGated = (node) => {
    const body = node.body
    if (!body || !ts.isBlock(body)) return false
    const first = body.statements[0]
    if (!first || !ts.isIfStatement(first)) return false
    const cond = first.expression
    return (
      ts.isPrefixUnaryExpression(cond) &&
      cond.operator === ts.SyntaxKind.ExclamationToken &&
      /DEBUG_UI/.test(cond.operand.getText(sf))
    )
  }

  const visit = (node) => {
    if (ts.isCallExpression(node) && DEV_CALL.test(node.expression.getText(sf))) return
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node) ||
        ts.isMethodDeclaration(node)) &&
      isDebugGated(node)
    ) {
      return
    }
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      node.kind === ts.SyntaxKind.TemplateHead ||
      node.kind === ts.SyntaxKind.TemplateMiddle ||
      node.kind === ts.SyntaxKind.TemplateTail
    ) {
      const raw = stripSqlComments(node.text ?? '')
      if (CJK.test(raw) && !REGEX_SOURCE.test(raw) && !inLedgerField(node)) {
        found.push({ file: rel(file), line: lineOf(node.getStart(sf)), text: raw, layer })
      }
      return
    }
    ts.forEachChild(node, visit)
  }

  visit(sf)
  return found
}

/**
 * 结构性闸门用的整句语料。与上面的历史判例语料不同，这一路把模板插值还原为
 * `〔插值〕` 后再判断，并把调用、属性与函数宿主一并带出，供确认框/悬停/空态豁免。
 */
const collectStructuralFromTs = (file, layer) => {
  const text = fs.readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const found = []
  const lineOf = (pos) => {
    let line = 1
    for (let i = 0; i < pos && i < text.length; i++) if (text.charCodeAt(i) === 10) line++
    return line
  }
  const inLedgerField = (node) => {
    if (layer === 'renderer') return false
    let cur = node.parent
    for (let depth = 0; cur && depth < 10; depth++, cur = cur.parent) {
      if (ts.isPropertyAssignment(cur) && LEDGER_KEYS.has(cur.name.getText(sf))) return true
    }
    return false
  }
  const isDebugGated = (node) => {
    const body = node.body
    if (!body || !ts.isBlock(body)) return false
    const first = body.statements[0]
    if (!first || !ts.isIfStatement(first)) return false
    const cond = first.expression
    return (
      ts.isPrefixUnaryExpression(cond) &&
      cond.operator === ts.SyntaxKind.ExclamationToken &&
      /DEBUG_UI/.test(cond.operand.getText(sf))
    )
  }
  const contextOf = (node) => {
    const calls = []
    const properties = []
    const functions = []
    let cur = node.parent
    for (let depth = 0; cur && depth < 14; depth++, cur = cur.parent) {
      if (ts.isCallExpression(cur)) calls.push(cur.expression.getText(sf))
      if (ts.isPropertyAssignment(cur)) properties.push(cur.name.getText(sf).replace(/^['"]|['"]$/g, ''))
      if (ts.isFunctionDeclaration(cur) || ts.isMethodDeclaration(cur)) {
        if (cur.name) functions.push(cur.name.getText(sf))
      } else if (
        (ts.isArrowFunction(cur) || ts.isFunctionExpression(cur)) &&
        ts.isVariableDeclaration(cur.parent) &&
        cur.parent.name
      ) {
        functions.push(cur.parent.name.getText(sf))
      }
    }
    return { calls, properties, functions }
  }
  const add = (node, raw) => {
    const value = stripSqlComments(raw)
    if (!CJK.test(value) || REGEX_SOURCE.test(value) || inLedgerField(node)) return
    found.push({
      file: rel(file),
      line: lineOf(node.getStart(sf)),
      text: value,
      layer,
      ...contextOf(node),
    })
  }
  const visit = (node) => {
    if (ts.isCallExpression(node) && DEV_CALL.test(node.expression.getText(sf))) return
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node) ||
        ts.isMethodDeclaration(node)) &&
      isDebugGated(node)
    ) {
      return
    }
    if (ts.isTemplateExpression(node)) {
      add(
        node,
        node.head.text +
          node.templateSpans.map((span) => `〔插值〕${span.literal.text}`).join(''),
      )
      for (const span of node.templateSpans) visit(span.expression)
      return
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      add(node, node.text ?? '')
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

/** html 按行取（行号天然精确）；HTML 注释与 CSS 块注释按空格抹掉，行号不动。 */
const collectFromHtml = (file) => {
  const text = fs
    .readFileSync(file, 'utf8')
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  return text
    .split('\n')
    .map((line, i) => ({ file: rel(file), line: i + 1, text: line.trim(), layer: 'html' }))
    .filter((row) => CJK.test(row.text))
}

/**
 * 矿脉包的 `meta.note` 经钥的「矿脉数据包」卡上屏（审计 B23）。
 * 这一格还兼着 B23 的「七之四」约束：note 在 `assets/lodes/*.json` 与
 * `scripts/build-*.mjs` 的生成模板里各有一份，只改一处、重跑合成器就打回原形——
 * 闸门打的是产物那一份，回潮当场就红。
 * 多数包已 gitignore，新克隆上整个目录可能不存在：读不到就当没有，不报错。
 */
const collectFromLodes = () => {
  const rows = []
  for (const file of walk(path.join(ROOT, 'assets/lodes'), ['.json'])) {
    let raw
    let meta
    try {
      raw = fs.readFileSync(file, 'utf8')
      meta = JSON.parse(raw)?.meta
    } catch {
      continue // 半截包/手改坏的包不是本闸门的事，lode-health 那套管
    }
    const metaOffset = raw.search(/"meta"\s*:/)
    for (const field of ['name', 'source', 'note']) {
      const text = meta?.[field]
      if (typeof text !== 'string' || !CJK.test(text)) continue
      const offset = raw.indexOf(`"${field}"`, metaOffset)
      if (offset < 0) continue
      const line = raw.slice(0, offset).split('\n').length
      rows.push({ file: rel(file), line, text, layer: 'lode', field })
    }
  }
  return rows
}

/** 一趟全量解析约 1.4 秒，同一次 `node --test` 里会被多条断言反复要——缓一份。 */
let cached = null
let structuralCached = null

export const collectPlayerCopy = () => {
  if (cached) return cached
  const tierA = []
  for (const file of walk(path.join(ROOT, 'src/renderer'), ['.ts'])) {
    tierA.push(...collectFromTs(file, 'renderer'))
  }
  for (const file of walk(path.join(ROOT, 'src/renderer'), ['.html'])) {
    tierA.push(...collectFromHtml(file))
  }
  tierA.push(...collectFromLodes())

  const tierB = []
  for (const file of walk(path.join(ROOT, 'src/main'), ['.ts'])) {
    tierB.push(...collectFromTs(file, 'main'))
  }
  for (const file of walk(path.join(ROOT, 'src/shared'), ['.ts'])) {
    tierB.push(...collectFromTs(file, 'shared'))
  }

  cached = { tierA, tierB }
  return cached
}

export const collectStructuralPlayerCopy = () => {
  if (structuralCached) return structuralCached
  const tierA = []
  for (const file of walk(path.join(ROOT, 'src/renderer'), ['.ts'])) {
    tierA.push(...collectStructuralFromTs(file, 'renderer'))
  }
  for (const row of walk(path.join(ROOT, 'src/renderer'), ['.html']).flatMap(collectFromHtml)) {
    tierA.push({ ...row, calls: [], properties: [], functions: [] })
  }
  for (const row of collectFromLodes()) {
    tierA.push({ ...row, calls: [], properties: [row.field], functions: [] })
  }

  const tierB = []
  for (const file of walk(path.join(ROOT, 'src/main'), ['.ts'])) {
    tierB.push(...collectStructuralFromTs(file, 'main'))
  }
  for (const file of walk(path.join(ROOT, 'src/shared'), ['.ts'])) {
    tierB.push(...collectStructuralFromTs(file, 'shared'))
  }

  structuralCached = { tierA, tierB }
  return structuralCached
}
