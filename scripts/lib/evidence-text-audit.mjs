import ts from 'typescript'

// 公开出处只记来源、核对日期和结论；不携带账号状态或个人记录。
export const FORBIDDEN_EVIDENCE_WORDS = ['用户', '玩家提供', '账本', '遭遇志', '本机', '实况', '截图', '他的']
const fieldName = /evidence|note|source|basis|reason|correction|voter|^why$|出处|订正/i
const correctionTable = /CORRECTION|ARBITRATION|HEARD_.*NAMES|TRANSCRIPTION_FIX|PLAYBACK_(MISMATCH|MATCH)|SHIP_STAT_(PATCH|SUSPECT)|TRUE_BY_RULE/i

export function textErrors(entries) {
  return entries.flatMap(({ file, field, text }) => FORBIDDEN_EVIDENCE_WORDS
    .filter(word => text.includes(word))
    .map(word => `${file}:${field}: 禁词「${word}」: ${text}`))
}

export function jsonEvidenceTexts(value, file, field = '$', selected = false) {
  if (typeof value === 'string') return selected ? [{ file, field, text: value }] : []
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, child]) =>
    jsonEvidenceTexts(child, file, `${field}.${key}`, selected || fieldName.test(key)))
}

// 用语法树解码字符串和模板片段，支持嵌套对象、数组、拼接、计算属性及订正表。
// 不执行被扫描代码，正常运行时文案不属于出处字段。
export function codeEvidenceTexts(source, file) {
  const root = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS)
  const entries = []
  const constants = new Map()
  function index(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
      !(ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      constants.set(node.name.text, node.initializer)
    }
    ts.forEachChild(node, index)
  }
  index(root)
  function literal(node, seen = new Set()) {
    if (ts.isStringLiteralLike(node)) return node.text
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) return literal(node.expression, seen)
    if (ts.isIdentifier(node) && constants.has(node.text) && !seen.has(node.text)) {
      return literal(constants.get(node.text), new Set([...seen, node.text]))
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = literal(node.left, seen), right = literal(node.right, seen)
      if (left !== undefined && right !== undefined) return left + right
    }
    if (ts.isTemplateExpression(node)) {
      let result = node.head.text
      for (const span of node.templateSpans) {
        const value = literal(span.expression, seen)
        if (value === undefined) return undefined
        result += value + span.literal.text
      }
      return result
    }
  }
  function visit(node, selected = false, field = '$') {
    if (selected) {
      const text = literal(node)
      if (text !== undefined) {
        const { line } = root.getLineAndCharacterOfPosition(node.getStart(root))
        entries.push({ file, field: `${field}@${line + 1}`, text })
        return
      }
    }
    if (ts.isPropertyAssignment(node)) {
      const key = ts.isComputedPropertyName(node.name) ? node.name.expression : node.name
      const name = key.text ?? key.getText(root)
      visit(node.initializer, selected || fieldName.test(name), `${field}.${name}`)
      return
    }
    if (ts.isVariableDeclaration(node)) {
      const name = node.name.getText(root)
      if (node.initializer) visit(node.initializer, selected || (!ts.isArrowFunction(node.initializer) && !ts.isFunctionExpression(node.initializer) && (fieldName.test(name) || correctionTable.test(name))), name)
      return
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const name = node.left.getText(root)
      visit(node.right, selected || fieldName.test(name), name)
      return
    }
    if (selected && (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node))) {
      const { line } = root.getLineAndCharacterOfPosition(node.getStart(root))
      entries.push({ file, field: `${field}@${line + 1}`, text: node.text })
    }
    ts.forEachChild(node, child => visit(child, selected, field))
  }
  visit(root)
  return entries
}
