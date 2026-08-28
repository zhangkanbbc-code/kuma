import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.join(fileURLToPath(import.meta.url), '..', '..')
const mainOut = path.join(root, 'dist', 'main')
const rendererOut = path.join(root, 'dist', 'renderer')

const walkJs = (dir, out = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) walkJs(file, out)
    else if (entry.name.endsWith('.js')) out.push(file)
  }
  return out
}

test('compiled main-process shared runtime imports resolve from dist', () => {
  const imports = []
  for (const file of walkJs(mainOut)) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/require\(["']((?:\.\.\/)+shared\/[^"']+)["']\)/g)) {
      imports.push({ file, specifier: match[1] })
    }
  }

  assert.ok(imports.length > 0, 'expected at least one main-process runtime import from shared')
  for (const { file, specifier } of imports) {
    const requireFromOutput = createRequire(pathToFileURL(file))
    assert.doesNotThrow(
      () => requireFromOutput.resolve(specifier),
      `unresolved compiled dependency ${specifier} from ${path.relative(root, file)}`,
    )
  }
})

test('渲染层用外挂 sourcemap，主进程开着 source map 支持', () => {
  const bundle = readFileSync(path.join(rendererOut, 'index.js'), 'utf8')
  // 内联那份曾占整包 72%（2.87MB / 3.96MB），而渲染层是 <script> 加载的 bundle，
  // Node 的 source map 支持管不着它——Error.stack 拿到的一直是打包后的位置。
  // 唯一读它的 DevTools 对外挂 map 一样能读，还只在打开时才取。
  assert.doesNotMatch(
    bundle,
    /sourceMappingURL=data:application\/json/,
    '渲染层又内联 sourcemap 了：启动要白解析两三兆，换不来任何可读的崩溃栈',
  )
  assert.match(bundle, /sourceMappingURL=index\.js\.map/)
  assert.ok(readFileSync(path.join(rendererOut, 'index.js.map'), 'utf8').length > 0)

  // 主进程/共享层是逐文件转译带内联 map 的，但不开这一项那份 map 谁也不读，
  // crash.log 里记的栈会指向 dist/**/*.js 的行号而不是源文件。
  const env = readFileSync(path.join(root, 'src', 'main', 'env.ts'), 'utf8')
  assert.match(env, /process\.setSourceMapsEnabled\?\.\(true\)/)
  const entry = readFileSync(path.join(root, 'src', 'main', 'index.ts'), 'utf8')
  assert.match(entry, /^import '\.\/env'/m, 'env 必须是入口的第一个 import，否则先加载的模块建不出 map 缓存')
})

test('主进程的崩溃栈能落回 .ts 源文件', () => {
  // 直接在编译产物上验：这条纪律的价值全在「crash.log 里那一行读不读得懂」。
  // 必须先开再加载——Node 只给「启用之后编译的模块」建 map 缓存，
  // 这也正是它在 env.ts 里要排在所有业务模块之前的原因。
  process.setSourceMapsEnabled(true)
  const require_ = createRequire(pathToFileURL(path.join(root, 'test', 'anchor.cjs')))
  const target = path.join(root, 'dist', 'shared', 'land-base-attack.js')
  const lbas = require_(target)
  try {
    lbas.landBaseWavePower(null)
    assert.fail('预期抛错')
  } catch (error) {
    assert.match(
      error.stack.split('\n')[1],
      /land-base-attack\.ts:\d+/,
      '崩溃栈仍指向 dist 产物，source map 支持没生效',
    )
  }
})
