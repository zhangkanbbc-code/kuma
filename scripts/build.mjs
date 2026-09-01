// 构建分三路：
// - 主进程 src/main：逐文件转译、不打包（webview preload 的 remote.require('./xxx')
//   要求模块保持独立文件）；
// - 共享运行时代码 src/shared：逐文件转译到 dist/shared，供主进程按相对路径加载；
// - 渲染层 src/renderer：打包成单个 iife（模块化开发，铆的各面板一个文件一个模块）。
//   electron / @electron/remote / node 内建走运行时 require（nodeIntegration 渲染层可用）。
//
// `--release` 是**发行版**构建（npm run package:win 走这一路），与开发构建的差别
// 只有 sourcemap 一项，逐路的取舍写在各自的 build() 上面。默认（不带这个标）是
// 开发构建，行为一个字节都没变——测试与 npm start 跑的都还是那份。
import { build } from 'esbuild'
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RELEASE = process.argv.includes('--release')

const root = path.join(fileURLToPath(import.meta.url), '..', '..')
const mainOut = path.join(root, 'dist', 'main')
const sharedOut = path.join(root, 'dist', 'shared')
const rendererOut = path.join(root, 'dist', 'renderer')

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(p, out)
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(p)
  }
  return out
}

// 主进程是逐文件输出；先清理旧产物，避免已删除的模块继续残留在 dist。
rmSync(mainOut, { recursive: true, force: true })
rmSync(sharedOut, { recursive: true, force: true })
rmSync(rendererOut, { recursive: true, force: true })

// 主进程与共享层的内联 map **发行版也留着**（1.55MB 代码带 4.66MB map）。
// 它不是死重量：env.ts 开了 process.setSourceMapsEnabled(true)，crash.log 里记的栈
// 因此落回 .ts 的行号（护栏在 test/build-output.test.mjs「主进程的崩溃栈能落回 .ts 源文件」）。
// 正式包 DevTools 是关的，crash.log 就是唯一一条排查线索——玩家把它发回来，
// 那份栈读不读得懂决定了这条线索有没有用。剥掉省 4.66MB，代价是每条崩溃记录
// 都变成 dist/main/*.js 的行号，不划算。
await build({
  entryPoints: walk(path.join(root, 'src', 'main')),
  outdir: mainOut,
  outbase: path.join(root, 'src', 'main'),
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: 'inline',
})

await build({
  entryPoints: walk(path.join(root, 'src', 'shared')),
  outdir: sharedOut,
  outbase: path.join(root, 'src', 'shared'),
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: 'inline',
})

await build({
  entryPoints: {
    index: path.join(root, 'src', 'renderer', 'index.ts'),
    'resource-trend': path.join(root, 'src', 'renderer', 'resource-trend-window.ts'),
    'quest-tree': path.join(root, 'src', 'renderer', 'quest-tree-window.ts'),
    'ship-life': path.join(root, 'src', 'renderer', 'ship-life-window.ts'),
    browse: path.join(root, 'src', 'renderer', 'browse-window.ts'),
  },
  outdir: rendererOut,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome130',
  external: ['electron', '@electron/remote', 'fs', 'https', 'path', 'url'],
  // 渲染层用**外挂** .js.map，不内联。
  //
  // 内联那份占了整个包的 72%（2.87MB / 3.96MB），而它对崩溃日志毫无帮助：
  // 渲染层是 <script> 加载的 bundle，Node 的 --enable-source-maps 管不着它，
  // crash-guard 记下的 Error.stack 拿到的一直是打包后的位置。
  // 唯一读它的是 DevTools——而 DevTools 对外挂 map 一样能读，还只在打开时才取。
  //
  // 发行版连外挂那份也不生成（三个 map 合计 5.46MB，占 app.asar 的 18%）。
  // 上一段那句「唯一读它的是 DevTools」在正式包里就是判死：DevTools 由
  // KANSO_DEVTOOLS 环境变量把门，玩家那边根本不会开，而真要开它调渲染层的人
  // 手上有源码、自己 npm run build 就有 map。
  sourcemap: RELEASE ? false : true,
})

mkdirSync(rendererOut, { recursive: true })
cpSync(path.join(root, 'src', 'renderer', 'index.html'), path.join(rendererOut, 'index.html'))
cpSync(
  path.join(root, 'src', 'renderer', 'resource-trend.html'),
  path.join(rendererOut, 'resource-trend.html'),
)
cpSync(
  path.join(root, 'src', 'renderer', 'quest-tree.html'),
  path.join(rendererOut, 'quest-tree.html'),
)
cpSync(
  path.join(root, 'src', 'renderer', 'ship-life.html'),
  path.join(rendererOut, 'ship-life.html'),
)
cpSync(path.join(root, 'src', 'renderer', 'browse.html'), path.join(rendererOut, 'browse.html'))
rmSync(path.join(rendererOut, 'assets'), { recursive: true, force: true })
cpSync(path.join(root, 'src', 'renderer', 'assets'), path.join(rendererOut, 'assets'), {
  recursive: true,
})
console.log(`[kanso] build ok${RELEASE ? '（发行版：渲染层不出 sourcemap）' : ''}`)
