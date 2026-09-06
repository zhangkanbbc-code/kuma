// 审计执行生产声明本身；AST 只负责取出依赖，不另写合并/取词判断。
// 每个模式使用独立函数作用域和模块缓存；文件系统只暴露读取，禁止 Electron/网络入口。
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { transformSync } from 'esbuild'
import { REPO_ROOT } from './bundled-lodes.mjs'

const parsed = new Map()
function sourceOf(relative) {
  const file = path.resolve(REPO_ROOT, relative)
  if (!parsed.has(file)) {
    const program = ts.createProgram([file], { noResolve: true, noLib: true })
    parsed.set(file, { source: program.getSourceFile(file), checker: program.getTypeChecker() })
  }
  return parsed.get(file)
}

export function runtimeHost(overrides = {}) {
  const cache = new Map()
  const readOnlyFs = Object.fromEntries(['statSync', 'readdirSync', 'readFileSync', 'existsSync'].map(k => [k, fs[k]]))
  function load(file) {
    file = path.resolve(file)
    if (!path.extname(file)) file += '.ts'
    if (cache.has(file)) return cache.get(file)
    const module = { exports: {} }
    cache.set(file, module.exports)
    const require = id => {
      if (Object.hasOwn(overrides, id)) return overrides[id]
      if (id === 'fs') return readOnlyFs
      if (id === 'path') return path
      if (id.startsWith('.')) return load(path.resolve(path.dirname(file), id))
      throw new Error(`审计禁止宿主依赖：${file} → ${id}`)
    }
    const code = transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs' }).code
    // 宿主入口仍由 require 白名单控制；纯模块放在独立函数作用域，避免数千个 VM realm。
    new Function('module', 'exports', 'require', code)(module, module.exports, require)
    cache.set(file, module.exports)
    return module.exports
  }
  function extract(relative, names, state = {}) {
    const { source, checker } = sourceOf(relative)
    const selected = new Set()
    const bindings = { ...state }
    const top = new Map()
    for (const statement of source.statements) {
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) top.set(declaration.name.text, declaration)
        }
      } else if (statement.name) top.set(statement.name.text, statement)
    }
    function visit(node) {
      if (ts.isTypeNode(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return
      if (ts.isIdentifier(node) && !Object.hasOwn(bindings, node.text)) {
        const symbol = checker.getSymbolAtLocation(node)
        for (const decl of symbol?.declarations ?? []) {
          if (ts.isImportSpecifier(decl) || ts.isImportClause(decl)) {
            const imp = ts.isImportClause(decl) ? decl.parent : decl.parent.parent.parent
            const id = imp.moduleSpecifier.text
            const imported = ts.isImportClause(decl) ? 'default' : decl.propertyName?.text ?? decl.name.text
            let mod
            try { mod = id === 'fs' ? { default: readOnlyFs } : id === 'path' ? { default: path } : Object.hasOwn(overrides, id) ? overrides[id] : load(path.resolve(path.dirname(source.fileName), id)) }
            catch (error) { throw new Error(`审计依赖 ${relative}: ${id}.${imported}`, { cause: error }) }
            if (!(imported in mod)) throw new Error(`生产依赖未提供：${id}.${imported}`)
            bindings[node.text] = mod[imported]
          } else if (top.get(node.text) === decl) include(decl)
        }
      }
      ts.forEachChild(node, visit)
    }
    function include(node) {
      if (selected.has(node)) return
      selected.add(node)
      visit(node)
    }
    for (const name of names) {
      if (!top.has(name)) throw new Error(`生产声明已移动：${relative} ${name}`)
      include(top.get(name))
    }
    const code = [...selected].sort((a, b) => a.pos - b.pos).map(node =>
      ts.isVariableDeclaration(node) ? `${node.parent.flags & ts.NodeFlags.Const ? 'const' : 'let'} ${node.getText(source)};` : node.getText(source).replace(/^export /, '')).join('\n')
    const compiled = transformSync(`${code}\nreturn {${names.join(',')}}`, { loader: 'ts', format: 'cjs' }).code
    return { api: new Function(...Object.keys(bindings), compiled)(...Object.values(bindings)) }
  }
  return { load: relative => load(path.resolve(REPO_ROOT, relative)), extract }
}

export const plainHtml = value => String(value ?? '').replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()

const sectionCache = new Map()
export function runProductionSection(relative, from, until, state, tail = '') {
  const file = path.resolve(REPO_ROOT, relative)
  const text = fs.readFileSync(file, 'utf8')
  const a = text.indexOf(from), b = text.indexOf(until, a + from.length)
  if (a < 0 || b <= a) throw new Error(`生产段落已移动：${relative} ${from}`)
  const keys = Object.keys(state)
  const cacheKey = JSON.stringify([relative, from, until, tail, keys])
  if (!sectionCache.has(cacheKey)) {
    const section = text.slice(a, b)
    const ast = ts.createSourceFile(file, section, ts.ScriptTarget.Latest, true)
    const assigned = ast.statements.flatMap(statement => {
      const expr = ts.isExpressionStatement(statement) ? statement.expression : null
      return expr && ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(expr.left) ? [expr.left.text] : []
    })
    const locals = assigned.filter(key => !keys.includes(key))
    const resultKeys = [...new Set([...keys, ...assigned])]
    const body = `${locals.length ? `let ${locals.join(',')};` : ''}\n${section}\n${tail}\nreturn {...globalThis, ${resultKeys.join(',')}}`
    sectionCache.set(cacheKey, new Function(...keys, 'globalThis', transformSync(body, { loader: 'ts' }).code))
  }
  return sectionCache.get(cacheKey)(...Object.values(state), {})
}

const inlineCache = new Map()
export function inlineProductionFunction(relative, marker, state) {
  const key = JSON.stringify([relative, marker, Object.keys(state)])
  if (inlineCache.has(key)) return inlineCache.get(key)(...Object.values(state))
  const { source } = sourceOf(relative)
  const matches = []
  function visit(node) {
    if (ts.isArrowFunction(node) && node.getText(source).includes(marker)) matches.push(node)
    ts.forEachChild(node, visit)
  }
  visit(source)
  const node = matches.sort((a, b) => (a.end - a.pos) - (b.end - b.pos))[0]
  if (!node) throw new Error(`生产内联函数已移动：${relative} ${marker}`)
  const script = new Function(...Object.keys(state), transformSync(`return (${node.getText(source)})()`, { loader: 'ts' }).code)
  inlineCache.set(key, script)
  return script(...Object.values(state))
}
